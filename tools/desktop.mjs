/**
 * The desktop app (Electron): the game in its own window, see desktop/main.cjs.
 *
 *   npm run desktop                         builds the game and opens it in the app
 *   npm run desktop -- --smoke              ...to check itself: prints its frame rate and a save's round trip
 *                                           to disk and the sync folder, and quits (in a temporary data
 *                                           folder: the player's saves aren't touched). --fps=unlimited
 *                                           (display, or a number): at that cap; --bench: a crowd of 100 too
 *   npm run desktop -- --nobuild            ...with the last build as it is
 *   npm run desktop:build                   packages it for Windows: dist-desktop/out/Blueberry Playground
 *                                           <version> portable.exe (one file, nothing to install) and an installer
 *   npm run desktop:build -- --downloads    ...and copies the portable one to Downloads\Blueberry Playground <version>.exe
 *   npm run desktop:mac                     packages it for Macs with Apple silicon (from Windows): dist-desktop/out/
 *                                           Blueberry Playground <version> mac.tar.xz (--arch=x64: for Intel Macs);
 *                                           --downloads copies it there too. See packMac().
 *
 * The game is built as for the web (vite build) into dist-desktop/app/game, beside the app's
 * two scripts, its icon and a package.json of its own, so the packaged app holds only those
 * (none of the project's node_modules). The icon is the loading screen's blueberry, from index.html.
 */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { crc32, deflateSync, inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const out = 'dist-desktop';
const appDir = join(out, 'app');
const res = join(out, 'res');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const NAME = 'Blueberry Playground';

if (!args.includes('--nobuild') || !existsSync(join(appDir, 'game', 'index.html'))) {
  rmSync(appDir, { recursive: true, force: true });
  await build({ logLevel: 'warn', build: { outDir: join(appDir, 'game'), emptyOutDir: true } });
}
for (const f of ['main.cjs', 'preload.cjs']) copyFileSync(join('desktop', f), join(appDir, f));
writeFileSync(join(appDir, 'package.json'), JSON.stringify({
  name: pkg.name,
  productName: NAME,
  version: pkg.version,
  description: 'A physics sandbox',
  author: NAME,
  main: 'main.cjs',
}, null, 2));
makeIcons();

if (args.includes('--mac')) await packMac();
else if (args.includes('--package')) await pack();
else await launch();

/** Opens the app on the build (a self-check in a temporary data folder, removed after). */
async function launch() {
  const electron = require('electron');
  const passed = args.filter((a) => a !== '--nobuild');
  const data = passed.includes('--smoke') ? mkdtempSync(join(tmpdir(), 'bp-smoke-')) : null;
  if (data) passed.push(`--data=${data}`);
  const child = spawn(electron, [resolve(appDir), ...passed], { stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise((done) => child.on('close', (c) => done(c ?? 1)));
  if (data) rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  process.exit(code);
}

/** The portable .exe and the installer, with electron-builder. */
async function pack() {
  const builder = require('electron-builder');
  const dir = join(out, 'out');
  rmSync(dir, { recursive: true, force: true });
  await builder.build({
    projectDir: process.cwd(),
    targets: builder.Platform.WINDOWS.createTarget(['portable', 'nsis'], builder.Arch.x64),
    config: {
      appId: 'com.blueberryplayground.app',
      productName: NAME,
      directories: { app: appDir, output: dir, buildResources: res },
      electronVersion: require('electron/package.json').version,
      // (the Electron npm already unpacked: copied, rather than its zip unpacked again beside the output and moved in,
      // which a virus scanner still reading the new files can refuse)
      electronDist: dirname(require('electron')),
      asar: true,
      // (the game is one bundle already: false says the app's node_modules are seen to, so none are rebuilt or
      // added, where electron-builder would otherwise take the project's)
      beforeBuild: async () => false,
      // what a packaged game never uses: Electron's own "no app given" page, and WebGPU's shader compiler
      // (25 MB: the game draws with WebGL, whose compiler is d3dcompiler_47.dll, kept)
      afterPack: async ({ appOutDir }) => {
        for (const f of [join('resources', 'default_app.asar'), 'dxcompiler.dll', 'dxil.dll']) rmSync(join(appOutDir, f), { force: true });
      },
      compression: 'maximum',
      // (English only: Chromium's other languages are half the app's size again)
      electronLanguages: ['en-US'],
      win: { icon: join(res, 'icon.ico') },
      portable: { artifactName: '${productName} ${version} portable.${ext}' },
      nsis: { artifactName: '${productName} ${version} setup.${ext}', oneClick: false, allowToChangeInstallationDirectory: true, shortcutName: NAME },
      publish: null,
    },
  });
  const exe = join(dir, `${NAME} ${pkg.version} portable.exe`);
  console.log(`${exe}: ${(statSync(exe).size / 1e6).toFixed(1)} MB`);
  if (args.includes('--downloads')) {
    const to = join(homedir(), 'Downloads', `${NAME} ${pkg.version}.exe`);
    copyFileSync(exe, to);
    console.log(`copied to ${to}`);
  }
}

/**
 * The macOS app, made on Windows (electron-builder makes one only on a Mac): Electron's own
 * macOS build (downloaded once, and checked against Electron's published checksums) with
 * its Electron.app renamed throughout as electron-builder would (the app, its executable,
 * its helper apps and their Info.plists), the game put in as app.asar, our name, version
 * and icon, and Chromium's other languages and Electron's default app left out. It's packed
 * as a .tar.xz, which keeps the bundle's symlinks and file modes and comes in under 100 MB
 * (a zip doesn't: Electron's framework alone is 89 MB zipped, 56 MB in xz).
 *
 * It isn't signed (that needs a Mac): macOS calls it damaged until it's signed on the Mac
 * it's to run on, with the commands macSteps() prints.
 */
async function packMac() {
  const { downloadArtifact } = require('@electron/get');
  const asar = require('@electron/asar');
  const arch = args.find((a) => a.startsWith('--arch='))?.slice(7) ?? 'arm64';
  const version = require('electron/package.json').version;
  const zip = readFileSync(await downloadArtifact({ version, platform: 'darwin', arch, artifactName: 'electron' }));
  const APP = `${NAME}.app`;
  const appAsar = join(out, 'app.asar');
  await asar.createPackage(appDir, appAsar);
  const icon = iconImage();
  const entries = [];
  for (const e of readZip(zip)) {
    // (Chromium's languages but English, which it falls back to; Electron's own "no app given" app; its version number)
    const lang = /\/([^/]+)\.lproj\//.exec(e.name);
    if ((lang && lang[1] !== 'en') || e.name.endsWith('Contents/Resources/default_app.asar') || e.name === 'version') continue;
    const name = e.name
      .replace(/^Electron\.app\//, `${APP}/`)
      // (its licences in the app, not loose beside it)
      .replace(/^(LICENSE[^/]*)$/, `${APP}/Contents/Resources/$1`)
      .replace(`${APP}/Contents/MacOS/Electron`, `${APP}/Contents/MacOS/${NAME}`)
      .replaceAll('Electron Helper', `${NAME} Helper`);
    let data = e.data;
    if (name === `${APP}/Contents/Info.plist`) data = Buffer.from(appPlist(data.toString('utf8')));
    else if (/Helper[^/]*\.app\/Contents\/Info\.plist$/.test(name)) {
      data = Buffer.from(data.toString('utf8').replaceAll('Electron Helper', `${NAME} Helper`).replaceAll('com.github.Electron', 'com.blueberryplayground.app'));
    } else if (name === `${APP}/Contents/Resources/electron.icns`) data = icns([[128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([n, t]) => [t, icon(n)]));
    entries.push({ name, mode: e.mode, data });
  }
  entries.push({ name: `${APP}/Contents/Resources/app.asar`, mode: 0o100644, data: readFileSync(appAsar) });
  rmSync(appAsar, { force: true });
  const dir = join(out, 'out');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${NAME} ${pkg.version} mac${arch === 'arm64' ? '' : ` ${arch}`}.tar.xz`);
  console.log(`compressing ${entries.length} files (a few minutes)...`);
  await xz(tar(entries), file);
  console.log(`${file}: ${(statSync(file).size / 1e6).toFixed(1)} MB`);
  if (args.includes('--downloads')) {
    const to = join(homedir(), 'Downloads', basename(file));
    copyFileSync(file, to);
    console.log(`copied to ${to}`);
  }
  console.log(macSteps(basename(file)));
}

/** What to do on the Mac: unpack it, take off the "downloaded" mark, sign it there (unsigned, macOS calls it damaged), open it. */
function macSteps(file) {
  return `On the Mac, in Terminal (in the folder it was downloaded to):
  tar -xf "${file}"
  xattr -cr "${NAME}.app"
  codesign --force --deep --sign - "${NAME}.app"
  open "${NAME}.app"`;
}

/** The app's Info.plist: our name, executable, id, version and category, and no check of Electron's default app. */
function appPlist(xml) {
  const set = (key, value) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (!re.test(xml)) throw new Error(`no ${key} in Electron's Info.plist`);
    xml = xml.replace(re, `$1${value}$2`);
  };
  set('CFBundleDisplayName', NAME);
  set('CFBundleName', NAME);
  set('CFBundleExecutable', NAME);
  set('CFBundleIdentifier', 'com.blueberryplayground.app');
  set('CFBundleShortVersionString', pkg.version);
  set('CFBundleVersion', pkg.version);
  set('LSApplicationCategoryType', 'public.app-category.simulation-games');
  return xml.replace(/\s*<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<\/dict>\s*<\/dict>/, '');
}

/** A zip's files and folders (named with a / at the end): name, Unix mode (a symlink's data is where it points) and contents. */
function readZip(b) {
  let end = b.length - 22;
  while (end >= 0 && b.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const files = [];
  for (let n = b.readUInt16LE(end + 10), at = b.readUInt32LE(end + 16); n > 0; n--) {
    const method = b.readUInt16LE(at + 10);
    const size = b.readUInt32LE(at + 20);
    const nameLen = b.readUInt16LE(at + 28);
    const name = b.toString('utf8', at + 46, at + 46 + nameLen);
    const mode = b.readUInt32LE(at + 38) >>> 16;
    const local = b.readUInt32LE(at + 42);
    at += 46 + nameLen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
    if (name.endsWith('/')) {
      files.push({ name, mode: 0o40755, data: Buffer.alloc(0) });
      continue;
    }
    const from = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(from, from + size);
    files.push({ name, mode: mode || 0o100644, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
  }
  return files;
}

/** A tar (ustar) of `files` (and folders, named with a / at the end), with their folders (made 755), modes and symlinks. */
function tar(files) {
  const blocks = [];
  const dirs = new Set();
  const header = (name, mode, size, type, link = '') => {
    const h = Buffer.alloc(512);
    let prefix = '';
    // (a long path is split at a slash: up to 155 bytes of it before, 100 after)
    if (Buffer.byteLength(name) > 100) {
      let i = name.indexOf('/');
      while (i >= 0 && Buffer.byteLength(name.slice(i + 1)) > 100) i = name.indexOf('/', i + 1);
      if (i < 0 || Buffer.byteLength(name.slice(0, i)) > 155) throw new Error(`too long for a tar: ${name}`);
      prefix = name.slice(0, i);
      name = name.slice(i + 1);
    }
    h.write(name, 0);
    h.write((mode & 0o7777).toString(8).padStart(7, '0'), 100);
    h.write('0000000', 108);
    h.write('0000000', 116);
    h.write(size.toString(8).padStart(11, '0'), 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'), 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write(link, 157);
    h.write('ustar\0' + '00', 257, 'binary');
    h.write(prefix, 345);
    let sum = 0;
    for (const c of h) sum += c;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  for (const f of files) {
    const parts = f.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = `${parts.slice(0, i).join('/')}/`;
      if (dirs.has(d)) continue;
      dirs.add(d);
      blocks.push(header(d, 0o755, 0, '5'));
    }
    if (f.name.endsWith('/')) continue;
    if ((f.mode & 0o170000) === 0o120000) {
      blocks.push(header(f.name, f.mode, 0, '2', f.data.toString('utf8')));
      continue;
    }
    blocks.push(header(f.name, f.mode, f.data.length, '0'), f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** Writes `data` xz-compressed to `file`, with xz (Git for Windows has it): two threads, so the PC stays usable. */
async function xz(data, file) {
  const exe = ['C:/Program Files/Git/mingw64/bin/xz.exe', 'C:/Program Files/Git/usr/bin/xz.exe'].find((x) => existsSync(x)) ?? 'xz';
  const child = spawn(exe, ['-9', '-T2', '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  child.stdout.on('data', (c) => chunks.push(c));
  child.stdin.end(data);
  const code = await new Promise((done) => child.on('close', done));
  if (code !== 0) throw new Error(`xz failed (${code})`);
  writeFileSync(file, Buffer.concat(chunks));
}

/** An .icns of PNGs: its header, then each image under its type (ic07 128 px, ic08 256, ic09 512, ic10 1024). */
function icns(images) {
  const parts = images.map(([type, data]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  });
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(8 + parts.reduce((s, p) => s + p.length, 0), 4);
  return Buffer.concat([h, ...parts]);
}

/**
 * The app's icon: the loading screen's 15 x 15 pixel blueberry (index.html), each pixel
 * scaled up whole and centred, as a 256 px PNG for the window and a multi-size .ico for the .exe.
 */
function makeIcons() {
  const image = iconImage();
  mkdirSync(res, { recursive: true });
  writeFileSync(join(appDir, 'icon.png'), image(256));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(image);
  // an .ico of PNGs: a header, a directory entry per size, then the images
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let at = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s % 256;
    head[e + 1] = s % 256;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += pngs[i].length;
  });
  writeFileSync(join(res, 'icon.ico'), Buffer.concat([head, ...pngs]));
}

/** The blueberry as a PNG of any size (see makeIcons()). */
function iconImage() {
  const svg = /<svg class="ld-logo"[^>]*>([\s\S]*?)<\/svg>/.exec(readFileSync('index.html', 'utf8'));
  if (!svg) throw new Error('no blueberry in index.html to make the icon of');
  const N = 15;
  const grid = new Array(N * N).fill(null);
  for (const [, fill, d] of svg[1].matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]+)"/gi)) {
    const rgb = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16));
    for (const [, x, y, w, h] of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
      for (let j = 0; j < +h; j++) for (let i = 0; i < +w; i++) grid[(+y + j) * N + +x + i] = rgb;
    }
  }
  return (size) => {
    const k = Math.max(1, Math.floor(size / N));
    const off = Math.floor((size - N * k) / 2);
    const px = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = grid[Math.floor((y - off) / k) * N + Math.floor((x - off) / k)];
        if (!c || x < off || y < off || x >= off + N * k || y >= off + N * k) continue;
        px.set([...c, 255], (y * size + x) * 4);
      }
    }
    return png(size, px);
  };
}

/** A PNG of RGBA pixels. */
function png(size, px) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

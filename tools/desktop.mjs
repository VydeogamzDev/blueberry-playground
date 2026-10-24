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
import { dirname, join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

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

if (args.includes('--package')) await pack();
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
 * The app's icon: the loading screen's 15 x 15 pixel blueberry (index.html), each pixel
 * scaled up whole and centred, as a 256 px PNG for the window and a multi-size .ico for the .exe.
 */
function makeIcons() {
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
  const image = (size) => {
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

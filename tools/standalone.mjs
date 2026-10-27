/**
 * Builds the game as one HTML file that plays when opened from disk, with
 * nothing to install or serve, to send to people:
 *
 *   npm run standalone                    writes dist-standalone/Blueberry Playground.html
 *   npm run standalone -- --downloads     ...and copies it to your Downloads folder, as
 *                                         Blueberry Playground <version>.html (the version: package.json's)
 *   npm run standalone -- <path.html>     ...or there
 *   npm test -- --standalone              runs the self-tests on that page
 *
 * A page opened from disk can't load other files (scripts, the physics engine's
 * WebAssembly, sounds), so everything goes inside it. `vite build --mode
 * standalone` makes the game one script (see vite.config.ts); this packs it with
 * every other file of that build into one compressed archive, written into the
 * page as base64, beside a small loader that unpacks it on open (see
 * standalone-loader.js).
 */
import { build } from 'vite';
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const outDir = 'dist-standalone';
const out = join(outDir, 'Blueberry Playground.html');
const args = process.argv.slice(2);
// (npm on Windows can pass a quoted path on with cmd's ^ escapes in it, or split at its spaces)
const named = args.filter((a) => a !== '--downloads').join(' ').replace(/[\^"]/g, '').trim();
// (the version in the name: copies sent round can be told apart)
const copyTo = args.includes('--downloads') ? join(homedir(), 'Downloads', `Blueberry Playground ${version}.html`) : named;

await build({ mode: 'standalone', logLevel: 'warn' });

// the loader, with its inflate, as one plain script
const loader = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    target: 'es2017',
    lib: { entry: resolve('tools/standalone-loader.js'), formats: ['iife'], name: 'bpLoader' },
  },
});
const loaderCode = (Array.isArray(loader) ? loader[0] : loader).output[0].code;

let html = readFileSync(join(outDir, 'index.html'), 'utf8');
const main = /<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>\s*/.exec(html);
if (!main) throw new Error('no game script in the built page');
html = html.replace(main[0], '');
// the stylesheet goes in as it is, so the page is styled from the start
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, css) => `<style>${readFileSync(join(outDir, css), 'utf8')}</style>`);

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const path = relative(outDir, p).replaceAll('\\', '/');
    if (statSync(p).isDirectory()) walk(p);
    // (nor the MP3s made for Apple's browsers: a page opened from disk plays the Oggs)
    else if (!/\.(html|css|mp3)$/.test(path)) files.push([path, readFileSync(p)]);
  }
};
walk(outDir);
const index = { main: main[1], files: {} };
let at = 0;
for (const [path, data] of files) {
  index.files[path] = [at, data.length];
  at += data.length;
}
const head = Buffer.from(JSON.stringify(index));
const size = Buffer.alloc(4);
size.writeUInt32LE(head.length);
const raw = Buffer.concat([size, head, ...files.map(([, data]) => data)]);
const pack = deflateRawSync(raw, { level: 9 }).toString('base64');

const safe = (code) => code.replace(/<\/script/gi, '<\\/script');
html = html.replace('</body>', () => `<script type="application/octet-stream" id="bp-pack">${pack}</script>\n<script>${safe(loaderCode)}</script>\n</body>`);
writeFileSync(out, html);
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB (${files.length} files, ${(raw.length / 1e6).toFixed(1)} MB unpacked)`);
if (copyTo) {
  copyFileSync(out, copyTo);
  console.log(`copied to ${copyTo}`);
}

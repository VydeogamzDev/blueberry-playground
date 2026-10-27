/**
 * The home-screen icons (public/icons/), drawn from the blueberry on the loading
 * screen (index.html's .ld-logo, 15 x 15 pixels) at whole-pixel scale on the
 * game's background: the iPhone/iPad one (apple-touch-icon), and the manifest's.
 *   npm run icons
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const svg = /<svg class="ld-logo"[\s\S]*?<\/svg>/.exec(html)?.[0];
if (!svg) throw new Error('no logo in index.html');
const BG = [0x16, 0x17, 0x1a];
const N = 15;
/** The logo's pixels: [r, g, b] or null. */
const grid = Array.from({ length: N }, () => Array(N).fill(null));
for (const [, fill, d] of svg.matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]+)"/g)) {
  const rgb = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16));
  for (const [, x, y, w, h] of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
    for (let j = 0; j < +h; j++) for (let i = 0; i < +w; i++) grid[+y + j][+x + i] = rgb;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** An opaque square PNG `size` px across with the logo in the middle, `fill` of the width. */
function icon(size, fill) {
  const px = Math.floor((size * fill) / N);
  const off = Math.floor((size - px * N) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - off) / px);
      const gy = Math.floor((y - off) / px);
      const c = (x >= off && y >= off && gx < N && gy < N && grid[gy][gx]) || BG;
      row.set(c, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('public/icons/', root);
mkdirSync(out, { recursive: true });
// (a maskable icon is cut to a circle or rounded square: the logo keeps inside the middle 80%)
for (const [name, size, fill] of [['apple-touch-icon.png', 180, 0.75], ['icon-192.png', 192, 0.75], ['icon-512.png', 512, 0.75], ['icon-maskable-512.png', 512, 0.6]]) {
  writeFileSync(new URL(name, out), icon(size, fill));
}
console.log('icons written to public/icons/');

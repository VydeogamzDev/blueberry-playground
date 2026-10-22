/**
 * Renders every sprite into one PNG contact sheet for reviewing pixel art
 * outside the browser:  npx vitest run --config tools/vitest.config.ts
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { test } from 'vitest';
import { PixelArt, CLEAR } from '../src/art/PixelArt';
import * as P from '../src/art/props';
import * as I from '../src/art/items';
import { limbArt, figureArt, type LimbKey } from '../src/art/human';

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
function png(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sheet(file: string, rows: PixelArt[][], scale = 6, bg = 0x2b2e33): void {
  const gap = 4;
  const W = Math.max(...rows.map((r) => r.reduce((s, a) => s + a.w + gap, gap)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((a) => a.h)) + gap, gap);
  const img = new Uint8Array(W * scale * H * scale * 4);
  const put = (x: number, y: number, c: number) => {
    for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
      const o = ((y * scale + j) * W * scale + x * scale + i) * 4;
      img[o] = (c >> 16) & 255;
      img[o + 1] = (c >> 8) & 255;
      img[o + 2] = c & 255;
      img[o + 3] = 255;
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, ((x >> 3) + (y >> 3)) & 1 ? bg : bg + 0x060606);
  let y0 = gap;
  for (const r of rows) {
    let x0 = gap;
    for (const a of r) {
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const c = a.get(x, y);
        if (c !== CLEAR) put(x0 + x, y0 + y, c);
      }
      x0 += a.w + gap;
    }
    y0 += Math.max(...r.map((a) => a.h)) + gap;
  }
  writeFileSync(file, png(W * scale, H * scale, img));
}

const OUT = process.env.SHEET_DIR ?? '.';

test('art sheet', () => {
  const limbs: LimbKey[] = ['head', 'upperTorso', 'midTorso', 'lowerTorso', 'upperArmF', 'lowerArmF', 'handF', 'upperLegF', 'lowerLegF', 'footF', 'upperArmB'];
  const mod = (m: Record<string, unknown>) => Object.entries(m)
    .filter(([, f]) => typeof f === 'function')
    .flatMap(([k, f]) => {
      try {
        const r = (f as (...a: unknown[]) => unknown)();
        return r instanceof PixelArt ? [[k, r] as const] : [];
      } catch {
        return [];
      }
    });
  const props = mod(P as never).map(([, a]) => a);
  const items = mod(I as never).map(([, a]) => a);
  const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  sheet(`${OUT}/sheet_human.png`, [limbs.map((k) => limbArt('human', k)), limbs.map((k) => limbArt('android', k))], 8);
  sheet(`${OUT}/sheet_head.png`, [[limbArt('human', 'head'), limbArt('human', 'upperTorso'), limbArt('human', 'lowerTorso'), limbArt('human', 'footF')]], 16);
  sheet(`${OUT}/sheet_figure.png`, [[figureArt('human'), figureArt('android'), figureArt('human', undefined, undefined, 0)]], 6);
  sheet(`${OUT}/sheet_props.png`, chunks(props, 6), 4);
  sheet(`${OUT}/sheet_items.png`, chunks(items, 5), 6);
  console.log('props', mod(P as never).map(([k]) => k).join(','), '\nitems', mod(I as never).map(([k]) => k).join(','));
});

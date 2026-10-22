import { PixelArt, hex, shade, mix, type Color } from './PixelArt';
import { RNG } from '../engine/math';

export const WOOD = hex('#94693f');
export const WOOD_LIGHT = hex('#ad7f4e');
export const WOOD_DARK = hex('#6a4a2b');
export const STEEL = hex('#6d7680');
export const STEEL_LIGHT = hex('#8d97a1');
export const STEEL_DARK = hex('#4b525a');

/** Vertical cylinder shading (barrels, cans). */
function cylinder(a: PixelArt, x0: number, x1: number, y0: number, y1: number): void {
  const w = x1 - x0 + 1;
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0 + 0.5) / w;
    const f = 0.72 + 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.25));
    for (let y = y0; y <= y1; y++) {
      const c = a.get(x, y);
      if (c >= 0) a.set(x, y, shade(c, f));
    }
  }
}

function woodGrain(a: PixelArt, seed: number, x0: number, y0: number, w: number, h: number, base: Color): void {
  const rng = new RNG(seed);
  for (let y = y0; y < y0 + h; y++) {
    let x = x0 + rng.int(0, 6);
    while (x < x0 + w) {
      const len = rng.int(3, 9);
      if (rng.next() < 0.55) a.paintRect(x, y, len, 1, shade(base, rng.range(0.86, 0.94)));
      x += len + rng.int(2, 7);
    }
  }
}

export function crateArt(): PixelArt {
  const S = 28;
  const a = new PixelArt(S, S);
  a.rect(0, 0, S, S, WOOD);
  // inner planks
  for (let i = 0; i < 4; i++) {
    const y = 3 + i * 6;
    a.rect(3, y, S - 6, 5, i % 2 ? WOOD : shade(WOOD, 1.05));
    a.hline(3, S - 4, y + 5, shade(WOOD_DARK, 0.85));
  }
  woodGrain(a, 4, 3, 3, S - 6, S - 6, WOOD);
  // diagonal brace
  for (let k = -1; k <= 1; k++) a.line(3, S - 4 + k, S - 4, 3 + k, WOOD_LIGHT);
  a.line(3, S - 2, S - 2, 3, WOOD_DARK);
  // frame
  const frame = shade(WOOD_LIGHT, 0.98);
  a.rect(0, 0, S, 3, frame);
  a.rect(0, S - 3, S, 3, frame);
  a.rect(0, 0, 3, S, frame);
  a.rect(S - 3, 0, 3, S, frame);
  woodGrain(a, 9, 0, 0, S, 3, frame);
  woodGrain(a, 10, 0, S - 3, S, 3, frame);
  // nails
  const nail = hex('#b9b5ad');
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2], [1, S / 2], [S - 2, S / 2]]) a.set(x, y, nail);
  a.hline(3, S - 4, 3, WOOD_DARK);
  a.vline(3, 3, S - 4, WOOD_DARK);
  return a.bevel(1.1, 0.86).outline(0.5);
}

export function metalBoxArt(): PixelArt {
  const S = 22;
  const a = new PixelArt(S, S);
  a.rect(0, 0, S, S, STEEL);
  a.rect(3, 3, S - 6, S - 6, shade(STEEL, 0.9));
  a.hline(3, S - 4, 3, STEEL_DARK);
  a.vline(3, 3, S - 4, STEEL_DARK);
  a.hline(3, S - 4, S - 4, STEEL_LIGHT);
  a.vline(S - 4, 3, S - 4, STEEL_LIGHT);
  // cross brace
  a.line(5, 5, S - 6, S - 6, shade(STEEL, 1.08));
  a.line(5, S - 6, S - 6, 5, shade(STEEL, 1.08));
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2]]) {
    a.set(x, y, STEEL_LIGHT);
  }
  a.noise(0.03, 3);
  return a.bevel(1.12, 0.84).outline(0.5);
}

export function barrelArt(explosive: boolean): PixelArt {
  const W = 18;
  const H = 26;
  const a = new PixelArt(W, H);
  const body = explosive ? hex('#a5372a') : hex('#4f6779');
  a.roundRect(0, 0, W, H, 1, body);
  // rims and ribs
  const rib = shade(body, 0.7);
  const ribHi = shade(body, 1.25);
  for (const y of [0, H - 1]) a.hline(1, W - 2, y, shade(body, 0.85));
  for (const y of [7, 17]) {
    a.hline(0, W - 1, y, rib);
    a.hline(0, W - 1, y + 1, ribHi);
  }
  if (explosive) {
    // hazard band and flame glyph
    const yel = hex('#d9b136');
    a.rect(0, 10, W, 5, yel);
    for (let x = -4; x < W; x += 4) a.line(x, 14, x + 4, 10, hex('#2a2422'));
    a.rect(6, 2, 6, 4, hex('#d9cfbf'));
    a.set(8, 3, hex('#2a2422')).set(9, 3, hex('#2a2422')).set(9, 2, hex('#2a2422')).set(8, 4, hex('#2a2422')).set(9, 4, hex('#2a2422'));
    a.rect(6, 19, 6, 4, hex('#d9cfbf'));
    a.set(9, 20, hex('#2a2422')).set(8, 21, hex('#2a2422')).set(9, 21, hex('#2a2422')).set(10, 21, hex('#2a2422'));
  }
  cylinder(a, 0, W - 1, 0, H - 1);
  return a.outline(0.5);
}

export function chairArt(): PixelArt {
  const a = new PixelArt(16, 26);
  const w = shade(WOOD, 0.95);
  a.rect(0, 0, 3, 14, w); // backrest post
  a.rect(0, 2, 3, 1, WOOD_LIGHT);
  a.rect(0, 13, 16, 3, WOOD_LIGHT); // seat
  a.rect(0, 16, 3, 10, w); // back leg
  a.rect(13, 16, 3, 10, w); // front leg
  a.rect(3, 21, 10, 1, WOOD_DARK); // stretcher
  woodGrain(a, 5, 0, 0, 16, 26, w);
  return a.bevel(1.1, 0.85).outline(0.5);
}

export function tableArt(): PixelArt {
  const a = new PixelArt(48, 21);
  a.rect(0, 0, 48, 3, WOOD_LIGHT);
  a.rect(2, 3, 44, 2, WOOD_DARK);
  a.rect(3, 3, 3, 18, WOOD);
  a.rect(42, 3, 3, 18, WOOD);
  woodGrain(a, 8, 0, 0, 48, 3, WOOD_LIGHT);
  return a.bevel(1.1, 0.85).outline(0.5);
}

export function brickArt(): PixelArt {
  const a = new PixelArt(12, 6);
  const c = hex('#8a4632');
  a.rect(0, 0, 12, 6, c);
  a.noise(0.08, 21);
  const rng = new RNG(5);
  for (let i = 0; i < 5; i++) a.set(rng.int(1, 10), rng.int(1, 4), shade(c, 0.78));
  return a.bevel(1.12, 0.82, 1).outline(0.55);
}

export function beamArt(len = 96): PixelArt {
  const a = new PixelArt(len, 6);
  const c = hex('#646d74');
  a.rect(0, 0, len, 6, c);
  a.hline(0, len - 1, 0, shade(c, 1.2));
  a.hline(0, len - 1, 1, shade(c, 1.08));
  a.rect(0, 2, len, 2, shade(c, 0.82));
  a.hline(0, len - 1, 5, shade(c, 0.85));
  for (let x = 6; x < len - 3; x += 12) {
    a.set(x, 2, shade(c, 0.5)).set(x, 3, shade(c, 0.6));
  }
  a.noise(0.025, 13);
  return a.outline(0.55);
}

export function plankArt(len = 64): PixelArt {
  const a = new PixelArt(len, 5);
  a.rect(0, 0, len, 5, WOOD);
  woodGrain(a, 17, 0, 0, len, 5, WOOD);
  a.set(2, 2, hex('#a9a59c')).set(len - 3, 2, hex('#a9a59c'));
  return a.bevel(1.12, 0.84, 1).outline(0.55);
}

export function concreteBlockArt(): PixelArt {
  const a = new PixelArt(24, 16);
  const c = hex('#7b7e82');
  a.rect(0, 0, 24, 16, c);
  a.noise(0.06, 31);
  a.rect(4, 4, 6, 8, shade(c, 0.62));
  a.rect(14, 4, 6, 8, shade(c, 0.62));
  return a.bevel(1.1, 0.85).outline(0.55);
}

export function tireArt(): PixelArt {
  const a = new PixelArt(22, 22);
  const rubber = hex('#2d2d30');
  a.ellipse(0, 0, 22, 22, rubber);
  a.ellipse(5, 5, 12, 12, hex('#77808a'));
  a.ellipse(8, 8, 6, 6, hex('#4b5158'));
  // tread
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    a.set(Math.round(10.5 + Math.cos(t) * 10), Math.round(10.5 + Math.sin(t) * 10), hex('#1c1c1e'));
  }
  return a.bevel(1.25, 0.85).outline(0.6);
}

export function bucketArt(): PixelArt {
  const a = new PixelArt(14, 14);
  const c = hex('#5c7a8a');
  a.poly([[0, 0], [14, 0], [12, 14], [2, 14]], c);
  a.hline(0, 13, 1, shade(c, 1.2));
  cylinder(a, 0, 13, 0, 13);
  return a.outline(0.5);
}

export function glassPaneArt(): PixelArt {
  const a = new PixelArt(4, 40);
  a.rect(0, 0, 4, 40, hex('#8fb7c4'));
  a.vline(1, 2, 37, hex('#c8e2ea'));
  return a.outline(0.6);
}

export function ballArt(): PixelArt {
  const a = new PixelArt(12, 12);
  a.ellipse(0, 0, 12, 12, hex('#b0423a'));
  a.paintRect(0, 5, 12, 2, hex('#e0d8cc'));
  return a.bevel(1.25, 0.8).outline(0.55);
}

export { mix };

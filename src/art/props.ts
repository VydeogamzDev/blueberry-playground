import { PixelArt, mix, type Color } from './PixelArt';
import { RNG } from '../engine/math';
import {
  finish, WOOD, WOOD_PALE, WOOD_DARK, STEEL, STEEL_LT, BLUE_PAINT, RED, YELLOW, CONCRETE, BRICK, RUBBER, GLASS, WHITE,
  GUNMETAL, type Ramp,
} from './palette';

/** Horizontal wood grain: short darker streaks and the odd knot. */
function grain(a: PixelArt, r: Ramp, seed: number, x0: number, y0: number, w: number, h: number, vertical = false): void {
  const rng = new RNG(seed);
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  for (let j = 0; j < across; j++) {
    let i = rng.int(0, 5);
    while (i < along) {
      const len = rng.int(3, 8);
      if (rng.next() < 0.6) {
        for (let k = 0; k < len && i + k < along; k++) {
          const x = vertical ? x0 + j : x0 + i + k;
          const y = vertical ? y0 + i + k : y0 + j;
          if (a.get(x, y) === r[2]) a.set(x, y, r[1]);
        }
      }
      i += len + rng.int(2, 6);
    }
  }
}

/** Vertical cylinder shading over a region (barrels, buckets). */
function cylinder(a: PixelArt, x0: number, x1: number, y0: number, y1: number): void {
  const w = x1 - x0 + 1;
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0 + 0.5) / w;
    const d = t < 0.22 ? 1 : t < 0.38 ? 2 : t > 0.82 ? -1 : 0;
    if (!d) continue;
    for (let y = y0; y <= y1; y++) {
      const c = a.get(x, y);
      if (c < 0) continue;
      const r = rampOfAny(c);
      if (r) a.set(x, y, r[0][Math.max(0, Math.min(4, r[1] + (d === 2 ? 1 : d)))]);
    }
  }
}

const RAMPS: Ramp[] = [WOOD, WOOD_PALE, WOOD_DARK, STEEL, STEEL_LT, BLUE_PAINT, RED, YELLOW, CONCRETE, BRICK, RUBBER, GLASS, WHITE, GUNMETAL];
function rampOfAny(c: Color): [Ramp, number] | null {
  for (const r of RAMPS) {
    const i = r.indexOf(c);
    if (i >= 0) return [r, i];
  }
  return null;
}

export function crateArt(): PixelArt {
  const S = 28;
  const a = new PixelArt(S, S);
  const W = WOOD;
  a.rect(0, 0, S, S, W[2]);
  // inner planks with dark gaps
  for (let i = 0; i < 4; i++) {
    const y = 3 + i * 5.5;
    a.hline(3, S - 4, Math.round(y), W[1]);
  }
  grain(a, W, 4, 3, 3, S - 6, S - 6);
  // diagonal brace (lighter board) with a shadow under it
  for (let k = -1; k <= 1; k++) a.line(3, S - 4 + k, S - 4, 3 + k, WOOD_PALE[2]);
  a.line(4, S - 2, S - 2, 4, W[1]);
  // frame boards
  const F = WOOD_PALE;
  for (const [x, y, w, h] of [[0, 0, S, 3], [0, S - 3, S, 3], [0, 0, 3, S], [S - 3, 0, 3, S]]) a.rect(x, y, w, h, F[2]);
  grain(a, F, 9, 0, 0, S, 3);
  grain(a, F, 10, 0, S - 3, S, 3);
  grain(a, F, 11, 0, 3, 3, S - 6, true);
  grain(a, F, 12, S - 3, 3, 3, S - 6, true);
  // inner shadow under the frame
  a.hline(3, S - 4, 3, W[0]);
  a.vline(3, 3, S - 4, W[0]);
  a.hline(3, S - 4, S - 4, W[3]);
  a.vline(S - 4, 4, S - 4, W[3]);
  finish(a);
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2], [1, 13], [S - 2, 13]]) a.set(x, y, STEEL_LT[3]);
  return a;
}

export function metalBoxArt(): PixelArt {
  const S = 22;
  const a = new PixelArt(S, S);
  const M = STEEL;
  a.rect(0, 0, S, S, M[2]);
  // recessed panel
  a.rect(3, 3, S - 6, S - 6, M[1]);
  a.hline(3, S - 4, 3, M[0]);
  a.vline(3, 3, S - 4, M[0]);
  a.hline(4, S - 4, S - 4, M[3]);
  a.vline(S - 4, 4, S - 4, M[3]);
  // cross brace
  a.line(5, 5, S - 6, S - 6, M[2]);
  a.line(5, S - 6, S - 6, 5, M[2]);
  a.line(6, 5, S - 5, S - 6, M[3]);
  finish(a);
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2]]) a.set(x, y, M[4]);
  return a;
}

export function barrelArt(explosive: boolean): PixelArt {
  const W = 18;
  const H = 26;
  const a = new PixelArt(W, H);
  const B = explosive ? RED : BLUE_PAINT;
  a.roundRect(0, 0, W, H, 1, B[2]);
  // rolled rims and ribs
  a.hline(1, W - 2, 1, B[3]);
  a.hline(1, W - 2, H - 2, B[1]);
  for (const y of [7, 17]) {
    a.hline(0, W - 1, y, B[1]);
    a.hline(0, W - 1, y + 1, B[3]);
  }
  if (explosive) {
    // hazard band and flame glyph
    a.rect(0, 10, W, 5, YELLOW[2]);
    for (let x = -4; x < W; x += 4) a.line(x, 14, x + 4, 10, GUNMETAL[1]);
    const lbl = WHITE[2];
    const ink = GUNMETAL[0];
    a.rect(6, 2, 6, 4, lbl);
    a.set(8, 3, ink).set(9, 3, ink).set(9, 2, ink).set(8, 4, ink).set(9, 4, ink).set(10, 4, ink);
    a.rect(6, 20, 6, 4, lbl);
    a.set(9, 21, ink).set(8, 22, ink).set(9, 22, ink).set(10, 22, ink);
  } else {
    // bung cap
    a.rect(12, 2, 3, 2, STEEL[2]);
    a.set(12, 2, STEEL[3]);
  }
  cylinder(a, 0, W - 1, 0, H - 1);
  return finish(a, { light: false, shadow: false });
}

export function chairArt(): PixelArt {
  const a = new PixelArt(16, 26);
  const w = WOOD[2];
  a.rect(0, 0, 3, 14, w); // backrest post
  a.rect(0, 3, 3, 1, WOOD[1]);
  a.rect(0, 7, 3, 1, WOOD[1]);
  a.rect(0, 13, 16, 3, WOOD_PALE[2]); // seat
  a.rect(0, 16, 3, 10, w); // back leg
  a.rect(13, 16, 3, 10, w); // front leg
  a.rect(3, 21, 10, 1, WOOD_DARK[2]); // stretcher
  grain(a, WOOD_PALE, 5, 0, 13, 16, 3);
  return finish(a);
}

export function tableArt(): PixelArt {
  const a = new PixelArt(48, 21);
  a.rect(0, 0, 48, 3, WOOD_PALE[2]);
  a.rect(2, 3, 44, 2, WOOD_DARK[2]);
  a.rect(3, 3, 3, 18, WOOD[2]);
  a.rect(42, 3, 3, 18, WOOD[2]);
  grain(a, WOOD_PALE, 8, 0, 0, 48, 3);
  grain(a, WOOD, 9, 3, 5, 3, 16, true);
  grain(a, WOOD, 10, 42, 5, 3, 16, true);
  return finish(a);
}

export function brickArt(): PixelArt {
  const a = new PixelArt(12, 6);
  const B = BRICK;
  a.rect(0, 0, 12, 6, B[2]);
  const rng = new RNG(5);
  for (let i = 0; i < 7; i++) a.set(rng.int(1, 10), rng.int(1, 4), rng.next() < 0.5 ? B[1] : B[3]);
  return finish(a);
}

export function beamArt(len = 96): PixelArt {
  const a = new PixelArt(len, 6);
  const M = STEEL;
  // I-beam seen from the side: flanges top and bottom, web between
  a.rect(0, 0, len, 6, M[2]);
  a.rect(0, 2, len, 2, M[1]);
  for (let x = 6; x < len - 3; x += 12) a.set(x, 2, M[0]).set(x, 3, M[0]);
  finish(a);
  return a;
}

export function plankArt(len = 64): PixelArt {
  const a = new PixelArt(len, 5);
  a.rect(0, 0, len, 5, WOOD[2]);
  grain(a, WOOD, 17, 0, 0, len, 5);
  finish(a);
  a.set(2, 2, STEEL_LT[3]).set(len - 3, 2, STEEL_LT[3]);
  return a;
}

export function concreteBlockArt(): PixelArt {
  const a = new PixelArt(24, 16);
  const C = CONCRETE;
  a.rect(0, 0, 24, 16, C[2]);
  const rng = new RNG(31);
  for (let i = 0; i < 26; i++) a.set(rng.int(1, 22), rng.int(1, 14), rng.next() < 0.6 ? C[1] : C[3]);
  // the two hollow cores
  for (const x of [4, 14]) {
    a.rect(x, 4, 6, 8, C[0]);
    a.hline(x, x + 5, 11, C[1]);
    a.vline(x + 5, 4, 11, C[1]);
  }
  return finish(a);
}

export function tireArt(): PixelArt {
  const a = new PixelArt(22, 22);
  a.ellipse(0, 0, 22, 22, RUBBER[2]);
  // tread blocks around the rim
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2;
    a.set(Math.round(10.5 + Math.cos(t) * 9.6), Math.round(10.5 + Math.sin(t) * 9.6), RUBBER[1]);
  }
  a.ellipse(5, 5, 12, 12, RUBBER[1]);
  a.ellipse(6, 6, 10, 10, STEEL[2]);
  a.ellipse(8, 8, 6, 6, STEEL[1]);
  a.ellipse(9, 9, 4, 4, STEEL[3]);
  for (const [x, y] of [[10, 7], [14, 10], [11, 14], [7, 11]]) a.set(x, y, STEEL[0]);
  return finish(a);
}

export function bucketArt(): PixelArt {
  const a = new PixelArt(14, 14);
  const M = STEEL;
  a.poly([[0, 0], [14, 0], [12, 14], [2, 14]], M[2]);
  a.hline(0, 13, 1, M[3]);
  a.hline(1, 12, 5, M[1]);
  a.hline(2, 11, 10, M[1]);
  cylinder(a, 0, 13, 0, 13);
  return finish(a, { light: false, shadow: false });
}

export function glassPaneArt(): PixelArt {
  const a = new PixelArt(4, 40);
  a.rect(0, 0, 4, 40, GLASS[2]);
  a.vline(1, 2, 37, GLASS[4]);
  for (let y = 5; y < 36; y += 9) a.set(2, y, GLASS[3]);
  return finish(a, { light: false, shadow: false, soft: false });
}

export function ballArt(): PixelArt {
  const a = new PixelArt(12, 12);
  a.ellipse(0, 0, 12, 12, RED[2]);
  a.paintRect(0, 5, 12, 2, WHITE[2]);
  finish(a);
  a.set(3, 3, RED[4]);
  return a;
}

export { mix };

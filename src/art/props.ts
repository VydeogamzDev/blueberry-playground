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

export function crateArt(W = 28, H = 28): PixelArt {
  const a = new PixelArt(W, H);
  const R = WOOD;
  a.rect(0, 0, W, H, R[2]);
  // inner planks with dark gaps
  const boards = Math.max(1, Math.round((H - 6) / 5.5));
  for (let i = 0; i < boards; i++) {
    const y = 3 + (i * (H - 6)) / boards;
    a.hline(3, W - 4, Math.round(y), R[1]);
  }
  grain(a, R, 4, 3, 3, W - 6, H - 6);
  // diagonal brace (lighter board) with a shadow under it
  for (let k = -1; k <= 1; k++) a.line(3, H - 4 + k, W - 4, 3 + k, WOOD_PALE[2]);
  a.line(4, H - 2, W - 2, 4, R[1]);
  // frame boards
  const F = WOOD_PALE;
  for (const [x, y, w, h] of [[0, 0, W, 3], [0, H - 3, W, 3], [0, 0, 3, H], [W - 3, 0, 3, H]]) a.rect(x, y, w, h, F[2]);
  grain(a, F, 9, 0, 0, W, 3);
  grain(a, F, 10, 0, H - 3, W, 3);
  grain(a, F, 11, 0, 3, 3, H - 6, true);
  grain(a, F, 12, W - 3, 3, 3, H - 6, true);
  // inner shadow under the frame
  a.hline(3, W - 4, 3, R[0]);
  a.vline(3, 3, H - 4, R[0]);
  a.hline(3, W - 4, H - 4, R[3]);
  a.vline(W - 4, 4, H - 4, R[3]);
  finish(a);
  // nails at the corners, and down the sides of a tall one
  const ys = [1, H - 2];
  for (let n = Math.max(1, Math.round((H - 3) / 13)), i = 1; i < n; i++) ys.push(Math.round(1 + (i * (H - 3)) / n) - 1);
  for (const y of ys) a.set(1, y, STEEL_LT[3]).set(W - 2, y, STEEL_LT[3]);
  return a;
}

export function metalBoxArt(W = 22, H = 22): PixelArt {
  const a = new PixelArt(W, H);
  const M = STEEL;
  a.rect(0, 0, W, H, M[2]);
  // recessed panel
  a.rect(3, 3, W - 6, H - 6, M[1]);
  a.hline(3, W - 4, 3, M[0]);
  a.vline(3, 3, H - 4, M[0]);
  a.hline(4, W - 4, H - 4, M[3]);
  a.vline(W - 4, 4, H - 4, M[3]);
  // cross brace
  a.line(5, 5, W - 6, H - 6, M[2]);
  a.line(5, H - 6, W - 6, 5, M[2]);
  a.line(6, 5, W - 5, H - 6, M[3]);
  finish(a);
  for (const [x, y] of [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]]) a.set(x, y, M[4]);
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

/** Bricks laid in courses with mortar between, over whatever is filled in `a`. */
function brickwork(a: PixelArt, seed: number): void {
  const B = BRICK;
  const mortar = CONCRETE[3];
  const rng = new RNG(seed);
  for (let y = 0; y < a.h; y++) {
    const course = Math.floor(y / 6);
    const shift = course % 2 ? 6 : 0;
    for (let x = 0; x < a.w; x++) {
      if (!a.filled(x, y)) continue;
      a.set(x, y, y % 6 === 5 || (x + shift) % 12 === 11 ? mortar : B[2]);
    }
  }
  const n = Math.round((a.w * a.h) / 10);
  for (let i = 0; i < n; i++) {
    const x = rng.int(0, a.w - 1);
    const y = rng.int(0, a.h - 1);
    if (a.get(x, y) === B[2]) a.set(x, y, rng.next() < 0.5 ? B[1] : B[3]);
  }
}

/** A clay brick; made bigger, a stretch of brick wall. */
export function brickArt(W = 12, H = 6): PixelArt {
  const a = new PixelArt(W, H);
  const B = BRICK;
  if (W > 16 || H > 8) {
    a.rect(0, 0, W, H, B[2]);
    brickwork(a, 5);
    return finish(a);
  }
  a.rect(0, 0, W, H, B[2]);
  const rng = new RNG(5);
  const n = Math.round((7 * W * H) / 72);
  for (let i = 0; i < n; i++) a.set(rng.int(1, W - 2), rng.int(1, H - 2), rng.next() < 0.5 ? B[1] : B[3]);
  return finish(a);
}

export function beamArt(len = 96, H = 6): PixelArt {
  const a = new PixelArt(len, H);
  const M = STEEL;
  // I-beam seen from the side: flanges top and bottom, web between
  const f = Math.max(1, Math.round(H / 3));
  const web = H - 2 * f;
  a.rect(0, 0, len, H, M[2]);
  a.rect(0, f, len, web, M[1]);
  // holes along the web
  const hy = f + Math.max(0, Math.floor((web - 2) / 2));
  for (let x = 6; x < len - 3; x += 12) for (let y = hy; y < Math.min(f + web, hy + 2); y++) a.set(x, y, M[0]);
  finish(a);
  return a;
}

export function plankArt(len = 64, H = 5): PixelArt {
  const a = new PixelArt(len, H);
  a.rect(0, 0, len, H, WOOD[2]);
  grain(a, WOOD, 17, 0, 0, len, H);
  // boards 5 pixels wide side by side, each nailed at both ends
  for (let y = 5; y < H - 1; y += 5) a.hline(0, len - 1, y, WOOD_DARK[1]);
  finish(a);
  for (let y = 2; y < H; y += 5) a.set(2, y, STEEL_LT[3]).set(len - 3, y, STEEL_LT[3]);
  return a;
}

export function concreteBlockArt(W = 24, H = 16): PixelArt {
  const a = new PixelArt(W, H);
  const C = CONCRETE;
  a.rect(0, 0, W, H, C[2]);
  const rng = new RNG(31);
  const n = Math.round((26 * W * H) / 384);
  for (let i = 0; i < n; i++) a.set(rng.int(1, W - 2), rng.int(1, H - 2), rng.next() < 0.6 ? C[1] : C[3]);
  // the hollow cores
  if (H >= 12 && W >= 10) {
    const cores = Math.max(1, Math.round(W / 12));
    const gap = (W - cores * 6) / (cores + 1);
    for (let i = 0; i < cores; i++) {
      const x = Math.round(gap + i * (6 + gap));
      a.rect(x, 4, 6, H - 8, C[0]);
      a.hline(x, x + 5, H - 5, C[1]);
      a.vline(x + 5, 4, H - 5, C[1]);
    }
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

/** The bucket's sprite size: its bail (handle) over rows 0-6, the rim at rows 7-8, the base at rows 27-28. */
export const BUCKET_W = 22;
export const BUCKET_H = 29;

/** Where the bucket's left side starts on a row: the rim's lip sticks out, then it narrows to the base. */
function bucketSide(y: number): number {
  return y < 9 ? 0 : Math.round(1 + ((y - 9) * 2) / 19);
}

/** The pixels inside the bucket, from the rim down to its floor: where what it holds shows. */
export function bucketInside(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 7; y <= 26; y++) {
    const s = bucketSide(y) + (y < 9 ? 3 : 2);
    for (let x = s; x <= BUCKET_W - 1 - s; x++) out.push([x, y]);
  }
  return out;
}

/**
 * What's in a vessel cut away to show its `inside` (bucket, drum): `level` (0..1)
 * of a liquid of `color`, filling the lowest of it first (as for a flask), settled
 * to whichever side is down (`tilt`: its rotation, radians, counter-clockwise).
 */
function fillInside(a: PixelArt, inside: [number, number][], level: number, color: Color, tilt: number): void {
  const n = Math.round(Math.max(0, Math.min(1, level)) * inside.length);
  if (n <= 0) return;
  const gx = -Math.sin(tilt);
  const gy = Math.cos(tilt);
  const cells = inside.map(([x, y]) => [x, y, x * gx + y * gy] as [number, number, number]);
  cells.sort((p, q) => q[2] - p[2] || Math.abs(p[0] - (a.w - 1) / 2) - Math.abs(q[0] - (a.w - 1) / 2));
  const surface = cells[n - 1][2];
  const top = mix(color, 0xffffff, 0.22);
  const deep = mix(color, 0x000000, 0.18);
  for (let k = 0; k < n; k++) {
    const [x, y, h] = cells[k];
    a.set(x, y, h < surface + 0.9 ? top : h > surface + 6 ? deep : color);
  }
}

/**
 * A metal bucket, cut away to show its inside. `level` (0..1) of a liquid of
 * `color` lies in it, settled to whichever side is down (`tilt`: its rotation,
 * radians, counter-clockwise).
 */
export function bucketArt(level = 0, color = 0, tilt = 0): PixelArt {
  const W = BUCKET_W;
  const a = new PixelArt(W, BUCKET_H);
  const M = STEEL;
  for (let y = 7; y < BUCKET_H; y++) {
    const s = bucketSide(y);
    a.hline(s, W - 1 - s, y, M[2]);
  }
  // the inside: the far wall, in shadow, darker toward the bottom
  const inside = bucketInside();
  for (const [x, y] of inside) a.set(x, y, y < 12 ? M[1] : M[0]);
  // rolled rim, ribs round the sides, and the base
  for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) a.set(x, 7, M[3]);
  for (const y of [15, 22]) {
    const s = bucketSide(y);
    a.set(s, y, M[1]).set(s + 1, y, M[1]).set(W - 1 - s, y, M[1]).set(W - 2 - s, y, M[1]);
  }
  a.hline(3, W - 4, 27, M[1]);
  finish(a, { light: false, shadow: false });
  fillInside(a, inside, level, color, tilt);
  // the bail, hinged on lugs at the rim (drawn after the outline pass: it's a wire)
  let px = 1;
  let py = 7;
  for (let x = 1; x <= W - 2; x++) {
    const t = (x - (W - 1) / 2) / ((W - 3) / 2);
    const y = Math.round(7 - 7 * Math.sqrt(Math.max(0, 1 - t * t)));
    a.line(px, py, x, y, STEEL_LT[1]);
    px = x;
    py = y;
  }
  a.line(px, py, W - 2, 7, STEEL_LT[1]);
  a.set(1, 7, M[4]).set(W - 2, 7, M[4]);
  return a;
}

/** The open drum's sprite size: its rolled rim at row 0, ribs at rows 7 and 17, the base at rows 24-25, walls 2 px. */
export const DRUM_W = 18;
export const DRUM_H = 26;

/** The pixels inside the open drum, from the rim down to its floor: where what it holds shows. */
export function drumInside(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y <= DRUM_H - 3; y++) for (let x = 2; x <= DRUM_W - 3; x++) out.push([x, y]);
  return out;
}

/**
 * A steel drum with its lid off (the barrel), cut away to show its inside, with
 * `level` (0..1) of a liquid of `color` in it, settled to whichever side is down
 * (`tilt`, as bucketArt()).
 */
export function drumArt(level = 0, color = 0, tilt = 0): PixelArt {
  const W = DRUM_W;
  const H = DRUM_H;
  const a = new PixelArt(W, H);
  const B = BLUE_PAINT;
  a.rect(0, 0, W, H, B[2]);
  // the inside: the far wall, hollow (in the near wall's shadow on the left, lit on the
  // right) and in the rim's shadow at the top, its ribs pressed in
  const inside = drumInside();
  for (const [x, y] of inside) a.set(x, y, y < 3 || x < 5 ? B[0] : x > W - 5 ? B[2] : B[1]);
  for (const y of [7, 17]) {
    for (let x = 5; x <= W - 3; x++) a.set(x, y, B[0]).set(x, y + 1, x > W - 5 ? B[3] : B[2]);
  }
  // the walls lit from the left, the rolled rim, ribs round the sides, and the base
  a.vline(0, 0, H - 1, B[3]);
  a.vline(W - 1, 0, H - 1, B[1]);
  for (const x of [0, 1, W - 2, W - 1]) a.set(x, 0, B[4]);
  for (const y of [7, 17]) {
    for (const x of [0, 1, W - 2, W - 1]) a.set(x, y, B[1]).set(x, y + 1, B[3]);
  }
  a.hline(1, W - 2, H - 2, B[3]);
  a.hline(1, W - 2, H - 1, B[1]);
  finish(a, { light: false, shadow: false });
  fillInside(a, inside, level, color, tilt);
  return a;
}

export function glassPaneArt(W = 4, H = 40): PixelArt {
  const a = new PixelArt(W, H);
  a.rect(0, 0, W, H, GLASS[2]);
  glassGlints(a);
  return finish(a, { light: false, shadow: false, soft: false });
}

/** A highlight down the left side, glints, and on a wide pane a couple of diagonal streaks. */
function glassGlints(a: PixelArt): void {
  const { w: W, h: H } = a;
  const G = GLASS;
  for (let y = 2; y <= H - 3; y++) a.paint(1, y, G[4]);
  for (let y = 5; y < H - 4; y += 9) a.paint(2, y, G[3]);
  if (W < 10 || H < 6) return;
  const len = Math.min(W, H) * 0.5;
  for (const [fx, fy] of [[0.35, 0.3], [0.6, 0.55]]) {
    const x = Math.round(W * fx);
    const y = Math.round(H * fy);
    for (let k = -len / 2; k <= len / 2; k++) {
      a.paint(Math.round(x + k), Math.round(y - k), G[4]);
      a.paint(Math.round(x + k + 1), Math.round(y - k), G[3]);
    }
  }
}

/** Materials a drawn shape can be made of (see entities/Shape). */
export type ShapeMaterialId = 'wood' | 'metal' | 'concrete' | 'brick' | 'rubber' | 'glass';

/**
 * Dresses whatever is filled in `a` (a drawn shape's outline) in a material:
 * wood grain in boards, steel plate, concrete, brickwork, rubber or glass.
 */
export function materialArt(a: PixelArt, mat: ShapeMaterialId, seed = 7): PixelArt {
  const fill = (c: Color) => {
    for (let i = 0; i < a.px.length; i++) if (a.px[i] !== -1) a.px[i] = c;
  };
  const speckle = (r: Ramp, per: number, lo = 1, hi = 3) => {
    const rng = new RNG(seed);
    const n = Math.round((a.w * a.h) / per);
    for (let i = 0; i < n; i++) {
      const x = rng.int(0, a.w - 1);
      const y = rng.int(0, a.h - 1);
      if (a.get(x, y) === r[2]) a.set(x, y, rng.next() < 0.5 ? r[lo] : r[hi]);
    }
  };
  switch (mat) {
    case 'wood':
      fill(WOOD[2]);
      grain(a, WOOD, seed, 0, 0, a.w, a.h);
      for (let y = 5; y < a.h - 1; y += 6) for (let x = 0; x < a.w; x++) a.paint(x, y, WOOD_DARK[1]);
      return finish(a);
    case 'metal':
      fill(STEEL[2]);
      speckle(STEEL, 40);
      finish(a);
      // rivets in rows, clear of the edge
      for (let y = 3; y < a.h; y += 8) for (let x = 3; x < a.w; x += 8) {
        if (a.filled(x - 2, y) && a.filled(x + 2, y) && a.filled(x, y - 2) && a.filled(x, y + 2)) a.set(x, y, STEEL[4]);
      }
      return a;
    case 'concrete':
      fill(CONCRETE[2]);
      speckle(CONCRETE, 15);
      return finish(a);
    case 'brick':
      fill(BRICK[2]);
      brickwork(a, seed);
      return finish(a);
    case 'rubber':
      fill(RUBBER[2]);
      speckle(RUBBER, 30);
      return finish(a);
    case 'glass':
      fill(GLASS[2]);
      glassGlints(a);
      return finish(a, { light: false, shadow: false, soft: false });
  }
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

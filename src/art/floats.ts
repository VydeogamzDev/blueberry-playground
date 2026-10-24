import { PixelArt, mix } from './PixelArt';
import { finish, GLASS, GUNMETAL, STEEL, STEEL_LT, RED, ORANGE, WHITE, BLUE_PAINT, type Ramp } from './palette';

// Water and what goes with it (a block of water, a tank, a tap), what floats
// (a buoyancy tube, a big balloon) and the jet engine.

/** A block of water, `w` by `h` px: a pale crest, darker the deeper. */
export function waterArt(w = 32, h = 32): PixelArt {
  const a = new PixelArt(w, h);
  for (let y = 0; y < h; y++) {
    const k = Math.min(1, y / Math.max(8, h * 0.8));
    a.hline(0, w - 1, y, y === 0 ? 0xc4def0 : mix(0x5a96d6, 0x24538f, Math.floor(k * 4) / 4));
  }
  // a few glints on the surface and below it
  for (let x = 2; x < w - 3; x += 7) a.set(x, 2, 0x9cc4ea).set(x + 1, 2, 0x9cc4ea);
  for (let x = 5; x < w - 4 && h > 10; x += 11) a.set(x, Math.floor(h * 0.45), 0x6aa2dc).set(x + 1, Math.floor(h * 0.45), 0x6aa2dc);
  return a;
}

/** The wall thickness of a glass tank (px). */
export const TANK_WALL = 2;

/** A glass tank `w` by `h` px, open at the top: glass sides and bottom in a dark frame, empty inside. */
export function glassTankArt(w = 64, h = 40): PixelArt {
  const t = TANK_WALL;
  const a = new PixelArt(w, h);
  a.rect(0, 0, t, h, GLASS[2]);
  a.rect(w - t, 0, t, h, GLASS[2]);
  a.rect(0, h - t, w, t, GLASS[2]);
  finish(a, { light: false, shadow: false, soft: false });
  // the glass catching the light down each side, the frame round its rim and along the bottom
  for (let y = 3; y < h - 3; y++) {
    if (y % 9 !== 4) a.set(1, y, GLASS[4]);
    a.set(w - 2, y, GLASS[3]);
  }
  for (let x = 3; x < w - 3; x++) if (x % 11 !== 5) a.set(x, h - 2, GLASS[3]);
  a.rect(0, 0, t, 2, GUNMETAL[1]);
  a.rect(w - t, 0, t, 2, GUNMETAL[1]);
  a.hline(0, w - 1, h - 1, GUNMETAL[1]);
  return a;
}

export const TAP_W = 12;
export const TAP_H = 10;
/** Where a tap's water comes out (art px, at the bottom of its spout). */
export const TAP_SPOUT: [number, number] = [9, 10];

/** A tap: a flange to fix it by on the left, a pipe out to a spout turned down, a handle on top. */
export function tapArt(open = false): PixelArt {
  const a = new PixelArt(TAP_W, TAP_H);
  a.rect(0, 1, 2, 7, STEEL[2]);
  a.rect(2, 3, 9, 3, STEEL_LT[2]);
  a.rect(8, 5, 3, 4, STEEL_LT[2]);
  a.vline(6, 1, 2, STEEL[2]);
  if (open) a.rect(6, 0, 4, 1, BLUE_PAINT[2]);
  else a.rect(4, 0, 5, 1, BLUE_PAINT[2]);
  finish(a);
  a.rect(8, 9, 3, 1, GUNMETAL[0]);
  return a;
}

export const TUBE_W = 30;
export const TUBE_H = 10;

/** A buoyancy tube: a fat orange float, banded white, with a valve. */
export function tubeArt(): PixelArt {
  const a = new PixelArt(TUBE_W, TUBE_H);
  a.roundRect(0, 1, TUBE_W, TUBE_H - 1, 4, ORANGE[2]);
  for (const x of [7, 20]) a.rect(x, 1, 3, TUBE_H - 1, WHITE[3]);
  a.rect(14, 0, 2, 1, GUNMETAL[2]);
  finish(a);
  // its sheen along the top
  for (let x = 3; x < TUBE_W - 3; x++) if (x < 7 || (x > 9 && x < 20) || x > 22) a.set(x, 3, ORANGE[3]);
  return a;
}

export const JET_W = 44;
export const JET_H = 18;
/** Where its exhaust leaves (the nozzle's tip), and its intake's middle (art px). */
export const JET_NOZZLE: [number, number] = [0, 9];
export const JET_INTAKE: [number, number] = [44, 9];

/**
 * A jet engine side on: a fat nacelle with its intake lip at the front (right),
 * the nozzle and its cone at the back. `glow`: its nozzle hot (0 to 1).
 */
export function jetEngineArt(glow = 0): PixelArt {
  const a = new PixelArt(JET_W, JET_H);
  a.poly([[9, 1], [41, 1], [44, 4], [44, 14], [41, 17], [9, 17], [5, 13], [5, 5]], STEEL_LT[2]);
  a.poly([[0, 6], [6, 4], [6, 14], [0, 12]], GUNMETAL[2]);
  finish(a);
  a.rect(0, 8, 2, 2, glow > 0.5 ? 0xffb050 : glow > 0.15 ? 0xa04a24 : GUNMETAL[0]);
  // the intake lip, panel lines, a red band and a dark strake
  a.vline(42, 4, 13, STEEL[1]);
  a.vline(43, 5, 12, GUNMETAL[1]);
  for (const x of [17, 29]) a.vline(x, 2, 15, STEEL[2]);
  a.rect(34, 2, 2, 14, RED[2]);
  a.hline(9, 40, 13, STEEL_LT[1]);
  for (let x = 1; x < 6; x++) a.set(x, 6 + Math.floor(x / 3), GUNMETAL[3]);
  return a;
}

export const BIG_BALLOON_W = 24;
export const BIG_BALLOON_H = 38;
/** The big balloon's knot, where it's tied (art px). */
export const BIG_BALLOON_KNOT: [number, number] = [11.5, 29];

/** A big balloon: a great round envelope, its neck and knot, a long ribbon. */
export function bigBalloonArt(c: Ramp): PixelArt {
  const a = new PixelArt(BIG_BALLOON_W, BIG_BALLOON_H);
  a.ellipse(0, 0, 24, 27, c[2]);
  a.poly([[9, 25], [15, 25], [13, 29], [11, 29]], c[2]);
  finish(a);
  for (const [x, y] of [[5, 5], [6, 4], [7, 4], [5, 6], [4, 7], [6, 5]] as [number, number][]) a.set(x, y, c[4]);
  a.set(8, 3, c[3]).set(4, 9, c[3]).set(3, 10, c[3]);
  for (let y = 30; y < BIG_BALLOON_H; y++) a.set(y % 4 < 2 ? 11 : 12, y, WHITE[1]);
  return a;
}

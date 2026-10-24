import { PixelArt, type Color } from './PixelArt';
import { finish, draw, ramp, GUNMETAL, STEEL, STEEL_LT, YELLOW, POLYMER, LED_RED } from './palette';

// Round fused bombs, the thermonuclear bomb and the Fuse tool's icon. Same rules
// as every other sprite: palette ramps, finish() for outline and lighting,
// one-pixel details (fuses, digits) painted afterwards.

/** Fuse cord: tarred, braided twine (also the colors fuse cords are drawn in, see Connections). */
export const FUSE = ramp('#9c7a4e');
/** Cast iron, nearly black. */
const IRON = ramp('#3a3f4a', 1.15);
/** The bomb casing: pale grey paint. */
const CASING = ramp('#b9bcb4', 0.9);
const SCREEN = 0x1c1416;
const LED_DIM = 0x5a1d18;

// ------------------------------------------------------------------ round bomb

/** The round bomb's fuse, art pixels from its free end to where it goes into the neck. */
export const ROUND_FUSE: [number, number][] = [
  [17, 0], [16, 1], [15, 2], [14, 2], [13, 1], [12, 1], [11, 0], [10, 0], [9, 1], [8, 1], [8, 2],
];

const roundBombs = new Map<number, PixelArt>();

/** A round iron bomb with `left` pixels of its fuse not burnt yet (default: all of it). */
export function roundBombArt(left = ROUND_FUSE.length): PixelArt {
  let a = roundBombs.get(left);
  if (!a) roundBombs.set(left, (a = drawRoundBomb(left)));
  return a;
}

function drawRoundBomb(left: number): PixelArt {
  const a = new PixelArt(18, 22);
  a.ellipse(0, 6, 16, 16, IRON[2]);
  a.rect(5, 3, 6, 4, STEEL[1]);
  finish(a);
  // a glint on the iron, and the neck's lip
  a.set(4, 9, IRON[4]).set(5, 9, IRON[4]).set(4, 10, IRON[4]).set(3, 11, IRON[3]).set(6, 9, IRON[3]);
  a.hline(6, 9, 4, STEEL[3]);
  // the fuse is one pixel wide, so it is painted after the outline pass (it would be all outline)
  const n = ROUND_FUSE.length;
  for (let i = Math.max(0, n - left); i < n; i++) {
    const [x, y] = ROUND_FUSE[i];
    a.set(x, y, i % 2 ? FUSE[2] : FUSE[1]);
  }
  return a;
}

// ------------------------------------------------------------------ thermonuclear bomb

/** 3x5 digits for the bomb's countdown display. */
const DIGITS = [
  ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  ['XXX', '..X', 'XXX', 'X..', 'XXX'],
  ['XXX', '..X', 'XXX', '..X', 'XXX'],
  ['X.X', 'X.X', 'XXX', '..X', '..X'],
  ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  ['XXX', 'X..', 'XXX', 'X.X', 'XXX'],
  ['XXX', '..X', '..X', '..X', '..X'],
  ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
  ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
];

/** The radiation sign: a black trefoil on a yellow disc. */
const TREFOIL = [
  '..YYYYY..',
  '.YKYYYKY.',
  'YKKKYKKKY',
  'YKKKYKKKY',
  'YYYYKYYYY',
  'YYYYYYYYY',
  'YYYKKKYYY',
  '.YYKKKYY.',
  '..YYYYY..',
];

const nukes = new Map<string, PixelArt>();

/**
 * A thermonuclear bomb pointing right, its display showing `value` seconds:
 * bright while `counting` down, dim while it only shows the countdown it's set to.
 */
export function nukeArt(value: number, counting: boolean): PixelArt {
  const v = Math.max(0, Math.min(99, Math.round(value)));
  const key = `${v}:${counting}`;
  let a = nukes.get(key);
  if (!a) nukes.set(key, (a = drawNuke(v, counting)));
  return a;
}

function drawNuke(value: number, counting: boolean): PixelArt {
  const a = new PixelArt(64, 24);
  // tail fins, then the body over them: tail cone, barrel, rounded nose
  a.poly([[1, 0], [9, 0], [18, 6], [7, 6]], STEEL[2]);
  a.poly([[1, 24], [9, 24], [18, 18], [7, 18]], STEEL[2]);
  a.rect(0, 10, 8, 4, STEEL[2]);
  a.poly([[16, 4], [16, 20], [6, 16], [6, 8]], CASING[2]);
  a.rect(16, 4, 30, 16, CASING[2]);
  a.ellipse(36, 4, 28, 16, CASING[2]);
  // a yellow band round the nose
  a.paintRect(47, 0, 3, 24, YELLOW[2]);
  finish(a);
  // panel seams
  a.vline(16, 6, 17, CASING[1]);
  a.vline(34, 6, 17, CASING[1]);
  for (const x of [18, 32]) a.set(x, 6, CASING[3]).set(x, 17, CASING[3]);
  // the countdown display and its arming lamp
  a.rect(19, 7, 13, 9, GUNMETAL[0]);
  a.rect(20, 8, 11, 7, SCREEN);
  const ink: Color = counting ? LED_RED : LED_DIM;
  a.map(DIGITS[Math.floor(value / 10)], { X: ink }, 22, 9);
  a.map(DIGITS[value % 10], { X: ink }, 26, 9);
  a.set(30, 8, counting ? LED_RED : GUNMETAL[1]);
  a.map(TREFOIL, { Y: YELLOW[3], K: POLYMER[0] }, 36, 7);
  return a;
}

// ------------------------------------------------------------------ tool icon

/** The Fuse tool: a cord snaking up to a burning end. */
export function fuseToolIcon(): PixelArt {
  const a = finish(draw(12, 12, [
    '............',
    '............',
    '............',
    '........ff..',
    '.......fff..',
    '......fff...',
    '.....ff.....',
    '...fff......',
    '..fff.......',
    '.fff........',
    'ff..........',
    'f...........',
  ], { f: FUSE[3] }), { shadow: false, light: false });
  // the spark, painted after the outline pass so it stays bright
  a.set(10, 1, 0xfff4c4).set(9, 1, YELLOW[3]).set(11, 1, YELLOW[3]).set(10, 0, YELLOW[3]).set(10, 2, YELLOW[3]);
  a.set(9, 0, STEEL_LT[4]).set(11, 2, STEEL_LT[4]);
  return a;
}

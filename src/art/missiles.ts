import { PixelArt } from './PixelArt';
import { finish, ramp, type Ramp, GLASS, GUNMETAL, KHAKI, LAMP, LED_RED, RUBBER, STEEL, STEEL_LT, YELLOW } from './palette';
import { beltAround, tankSprocketArt, tankWheelArt } from './vehicles';

// The guided missiles, their launchers (squat tubes on a bipod and baseplate,
// or the top of a vertical launch cell) and the M113 missile carrier. Same rules
// as every other sprite: palette ramps, finish() for outline and lighting,
// one-pixel details painted afterwards.

type Pt = [number, number];

/** The mouse-guided missile's dark green, and the Spike's white. */
const DARK_GREEN = ramp('#3f5434');
const SPIKE_WHITE = ramp('#d6d6cf', 0.75);
/** The launchers' paint: olive drab for the mouse-guided one, sand for the Spike's. */
const DRAB = ramp('#535b39');
const SAND = KHAKI;
/** The M113's olive drab. */
const M113_DRAB = ramp('#5c6440');

export type MissileKind = 'guided' | 'spike';

// ------------------------------------------------------------------ the missiles

/** The missile's art size: its body is BODY pixels across (a cell holds one: see VLS). */
export const MISSILE = { w: 22, h: 8, body: 4 };

const missiles = new Map<MissileKind, PixelArt>();

/**
 * A missile pointing right: tail fins round the motor's nozzle, a pair of wings
 * at its middle, and its warhead. The mouse-guided one is dark green with a
 * stand-off probe on its nose; the Spike is white, its seeker's dark glass dome
 * on the nose and a yellow band round the warhead.
 */
export function missileArt(kind: MissileKind): PixelArt {
  let a = missiles.get(kind);
  if (!a) missiles.set(kind, (a = drawMissile(kind)));
  return a;
}

function drawMissile(kind: MissileKind): PixelArt {
  const P = kind === 'spike' ? SPIKE_WHITE : DARK_GREEN;
  const a = new PixelArt(MISSILE.w, MISSILE.h);
  // tail fins and mid wings, above and below the body
  for (const [y0, y1] of [[2, 0], [6, 8]] as const) {
    a.poly([[1, y0], [5, y0], [3.5, y1], [1, y1]], P[1]);
    a.poly([[8, y0], [12, y0], [11, y1], [9, y1]], P[1]);
  }
  a.rect(1, 2, 16, 4, P[2]);
  a.rect(0, 3, 1, 2, GUNMETAL[1]);
  if (kind === 'spike') {
    // the seeker's dome, rounded off
    a.rect(17, 2, 3, 4, P[2]);
    a.rect(20, 3, 2, 2, GLASS[1]);
  } else {
    a.rect(17, 2, 2, 4, P[2]);
    a.rect(19, 3, 3, 2, P[1]);
  }
  finish(a, { shadow: false });
  if (kind === 'spike') {
    a.set(14, 3, YELLOW[2]).set(14, 4, YELLOW[1]);
    a.set(21, 3, GLASS[3]).set(20, 3, GLASS[2]);
  } else {
    a.set(15, 3, YELLOW[2]).set(15, 4, YELLOW[1]);
    a.set(21, 3, P[3]);
  }
  a.set(0, 3, GUNMETAL[0]).set(0, 4, GUNMETAL[0]);
  return a;
}

// ------------------------------------------------------------------ the launchers

/**
 * The launcher on its bipod, facing right: art size, the tube's axis (from its
 * breech on the baseplate to its muzzle, art pixels: continuous, 0 at the art's
 * edge) and its half thickness.
 */
export const MORTAR = { w: 28, h: 23, breech: [5, 20] as Pt, muzzle: [24, 3] as Pt, half: 3 };
/** The tube's elevation off the baseplate (rad): the way a missile leaves it. */
export const MORTAR_ELEVATION = Math.atan2(MORTAR.breech[1] - MORTAR.muzzle[1], MORTAR.muzzle[0] - MORTAR.breech[0]);

const launchers = new Map<string, PixelArt>();

/**
 * A squat launch tube on a bipod, its breech in the socket of a baseplate (a
 * mortar's build); `loaded`, a missile's nose shows in the muzzle. The
 * mouse-guided one is olive with the gunner's control box and its wire on the
 * baseplate; the Spike's is sand, its command launch unit (sight and seeker
 * screen) clamped on top of the tube.
 */
export function launcherArt(kind: MissileKind, loaded: boolean): PixelArt {
  const key = `${kind}:${loaded}`;
  let a = launchers.get(key);
  if (!a) launchers.set(key, (a = drawLauncher(kind, loaded)));
  return a;
}

function drawLauncher(kind: MissileKind, loaded: boolean): PixelArt {
  const P = kind === 'spike' ? SAND : DRAB;
  const { w, h, breech: A, muzzle: B, half } = MORTAR;
  const a = new PixelArt(w, h);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / len;
  const uy = (B[1] - A[1]) / len;
  // (across the tube: its upper side first)
  const nx = uy;
  const ny = -ux;
  const along = (k: number, off: number): Pt => [A[0] + ux * len * k + nx * off, A[1] + uy * len * k + ny * off];
  // the bipod's legs, splayed down from the collar to their feet, and the screw that sets its height
  const collar = along(0.62, 0);
  a.line(Math.round(collar[0]), Math.round(collar[1]), 16, 21, GUNMETAL[2]);
  a.line(Math.round(collar[0]) + 1, Math.round(collar[1]), 17, 21, GUNMETAL[2]);
  a.line(Math.round(collar[0]), Math.round(collar[1]), 22, 21, GUNMETAL[2]);
  a.line(Math.round(collar[0]) + 1, Math.round(collar[1]), 23, 21, GUNMETAL[2]);
  a.rect(15, 21, 3, 2, GUNMETAL[1]);
  a.rect(21, 21, 3, 2, GUNMETAL[1]);
  // the baseplate, and the ball socket the breech sits in
  a.poly([[0, 20.5], [13, 20.5], [12, 23], [0.5, 23]], GUNMETAL[2]);
  a.ellipse(3, 17, 5, 5, GUNMETAL[2]);
  // the tube, with a band at its muzzle and the collar round its middle
  a.poly([along(0, half), along(1, half), along(1, -half), along(0, -half)], P[2]);
  a.poly([along(0.88, half + 0.6), along(1, half + 0.6), along(1, -half - 0.6), along(0.88, -half - 0.6)], P[2]);
  a.poly([along(0.55, half + 0.8), along(0.68, half + 0.8), along(0.68, -half - 0.8), along(0.55, -half - 0.8)], GUNMETAL[2]);
  if (kind === 'spike') {
    // the command launch unit on the tube's top, its sight looking along it
    const c0 = along(0.18, half + 0.5);
    const c1 = along(0.5, half + 0.5);
    a.poly([c0, c1, [c1[0] + nx * 5, c1[1] + ny * 5], [c0[0] + nx * 5, c0[1] + ny * 5]], GUNMETAL[2]);
  } else {
    // the gunner's control box with its stick, behind the baseplate
    a.rect(0, 15, 4, 4, GUNMETAL[2]);
  }
  finish(a);
  // the tube's seams in shadow along its underside, its muzzle's opening
  const m = along(1, 0);
  const mx = Math.floor(m[0] - ux * 0.8);
  const my = Math.floor(m[1] - uy * 0.8);
  if (loaded) {
    // the missile's nose in the muzzle, in its own paint
    const M = kind === 'spike' ? SPIKE_WHITE : DARK_GREEN;
    a.set(mx, my, M[3]).set(mx - 1, my + 1, M[2]).set(mx, my + 1, M[2]).set(mx - 1, my, M[3]);
    if (kind === 'spike') a.set(mx, my, GLASS[1]);
  } else a.set(mx, my, GUNMETAL[0]).set(mx - 1, my + 1, GUNMETAL[0]).set(mx, my + 1, GUNMETAL[0]).set(mx - 1, my, GUNMETAL[0]);
  for (let k = 0.08; k < 0.86; k += 0.11) {
    const [x, y] = along(k, -half + 0.5);
    a.paint(Math.floor(x), Math.floor(y), P[1]);
  }
  if (kind === 'spike') {
    // the sight's lens at the unit's front, its screen's glow at the back
    const [lx, ly] = along(0.49, half + 3);
    a.paint(Math.floor(lx), Math.floor(ly), GLASS[3]);
    const [sx, sy] = along(0.2, half + 3);
    a.paint(Math.floor(sx), Math.floor(sy), 0x9fe08a);
  } else {
    // the control stick, and the guidance wire's spool
    a.vline(2, 13, 14, STEEL[1]);
    a.set(2, 12, LED_RED);
    a.set(1, 16, GUNMETAL[0]).set(2, 16, GUNMETAL[0]);
  }
  a.set(2, 22, GUNMETAL[1]).set(10, 22, GUNMETAL[1]);
  return a;
}

/**
 * The top of a vertical launch cell (all of it that shows above ground in a
 * real silo): a box as tall as a landmine and as wide as two missiles side by
 * side and 5 px, each missile's cell under a hatch. The hatches flip open as
 * missiles go: the rows above the box are for those standing open.
 */
export const VLS = { w: MISSILE.body * 2 + 5, h: 9, top: 4, cells: [[2, 6], [7, 11]] as [number, number][] };

/** The cell's top with the hatches over cells shut, or that over cell `open` (0 or 1) flipped up. */
export function vlsArt(kind: MissileKind, open = -1): PixelArt {
  const key = `vls:${kind}:${open}`;
  let a = launchers.get(key);
  if (!a) launchers.set(key, (a = drawVls(kind, open)));
  return a;
}

function drawVls(kind: MissileKind, open: number): PixelArt {
  const P = kind === 'spike' ? SAND : DRAB;
  const { w, h, top, cells } = VLS;
  const a = new PixelArt(w, h);
  a.rect(0, top, w, h - top, P[2]);
  if (open >= 0) {
    // the hatch hinged at the cell's outer edge, standing up
    const [x0, x1] = cells[open];
    a.rect(open ? x1 - 1 : x0, 0, 1, top + 1, STEEL[2]);
  }
  finish(a);
  // the hatches over the cells, the frame between them, a stripe of warning paint along the front
  cells.forEach(([x0, x1], i) => {
    if (i === open) a.rect(x0, top, x1 - x0, 2, GUNMETAL[0]);
    else {
      a.hline(x0, x1 - 1, top, STEEL_LT[2]);
      a.hline(x0, x1 - 1, top + 1, STEEL[1]);
    }
  });
  a.vline(6, top, top + 1, P[1]);
  for (let x = 1; x < w - 1; x++) a.set(x, h - 2, (x >> 1) % 2 ? YELLOW[2] : GUNMETAL[1]);
  a.set(kind === 'spike' ? 1 : w - 2, top + 2, kind === 'spike' ? 0x9fe08a : LED_RED);
  return a;
}

// ------------------------------------------------------------------ the M113

/**
 * The M113A1 armoured personnel carrier with a missile launcher on its roof
 * (an M901-style carrier), facing right, at the real tanks' scale (28 sprite
 * pixels to its metre): a box of a hull with a long sloping glacis, the trim
 * vane folded on it, the driver's hatch and the commander's cupola, the
 * exhaust on the front of its side, the ramp at the back, and the launcher's
 * erector arm on the roof (the launcher itself is a part of its own: see
 * m113LauncherArt()). Five road wheels a side, the drive sprocket at the front
 * and the idler at the back (parts, drawn in front of the track). All points
 * are its art's pixels.
 */
export const M113 = {
  w: 140, h: 70,
  /** The idler (at the back), the road wheels, and the sprocket (at the front). */
  axles: [[12, 53], [30, 60], [48, 60], [66, 60], [84, 60], [102, 60], [122, 52]] as Pt[],
  /** The track's outer radius round each wheel (their colliders), and the road wheels' drawn size. */
  r: 9, wheel: 15,
  hull: [[1, 21], [2, 20], [116, 20], [136, 38], [137, 42], [131, 48], [1, 48]] as Pt[],
  /** The launcher's arm: where it pivots (the trunnion). */
  trunnion: [54, 6] as Pt,
  /** The commander in his cupola (the seat: hips under the roof); the engine, the fuel and the headlight. */
  hatch: [89, 18] as Pt, engine: [118, 30] as Pt, fuel: [20, 40] as Pt, lamp: [132, 33] as Pt,
  /** Over the cupola, where someone let go of gets in (x, y, width, height). */
  cabin: [78, 0, 32, 20] as [number, number, number, number],
  /** The stripe along the hull's side painted its team's colour (x0, y0, x1, y1). */
  band: [8, 26, 100, 29] as [number, number, number, number],
  paint: M113_DRAB as Ramp,
};

export function m113Art(): PixelArt {
  const D = M113;
  const P = D.paint;
  const a = new PixelArt(D.w, D.h);
  // the track, dark inside (its top run is behind the hull's side)
  beltAround(a, D.axles, D.r + 0.2, RUBBER[2]);
  beltAround(a, D.axles, D.r - 1.8, GUNMETAL[0]);
  a.poly(D.hull, P[2]);
  // the trim vane folded on the glacis, the driver's hatch, the commander's cupola
  a.poly([[116, 18.5], [119, 18.5], [138.5, 36.5], [137, 38.5]], P[2]);
  a.roundRect(102, 17, 10, 4, 1, P[2]);
  a.roundRect(83, 14, 12, 7, 1, P[2]);
  // the launcher's ring on the roof, and its erector arm
  a.roundRect(46, 17, 17, 4, 1, P[1]);
  a.rect(52, 7, 5, 12, P[2]);
  // the exhaust on the side, the ramp's step at the back
  a.roundRect(106, 23, 9, 8, 1, P[1]);
  a.rect(0, 43, 4, 3, P[1]);
  finish(a);
  // cleats along the ground
  for (let x = 2; x < D.w - 2; x += 3) {
    a.paint(x, D.h - 2, RUBBER[3]);
    a.paint(x, D.h - 1, RUBBER[2]);
  }
  // the roof's edge in the light, the hull's foot in shadow, bolts along its top and foot
  a.hline(3, 115, 21, P[3]);
  a.hline(2, 130, 47, P[1]);
  for (let x = 10; x < 112; x += 8) a.set(x, 23, P[3]).set(x, 45, P[1]);
  // the trim vane's ribs, the glacis' edge
  a.line(118, 20, 136, 37, P[3]);
  for (let k = 0; k < 4; k++) a.set(121 + k * 4, 25 + Math.round(k * 3.7), P[1]);
  // the ramp's edge and hinge at the back, the tail light
  a.vline(4, 22, 42, P[1]);
  a.rect(1, 23, 2, 3, LED_RED);
  // the exhaust's grille, the headlight and its guard
  for (let y = 25; y < 30; y += 2) a.hline(108, 112, y, GUNMETAL[0]);
  a.rect(131, 33, 3, 2, LAMP);
  a.set(132, 33, 0xfffbe0);
  a.line(130, 31, 135, 31, GUNMETAL[1]);
  // the cupola's vision blocks, the driver's periscopes, the tow eye
  for (let x = 85; x < 94; x += 3) a.set(x, 16, GLASS[2]);
  for (let x = 104; x < 111; x += 3) a.set(x, 18, GLASS[2]);
  a.set(134, 45, GUNMETAL[0]).set(133, 45, GUNMETAL[1]);
  // the arm's hydraulic ram, and the radio's whip antenna at the back of the roof
  a.vline(53, 9, 17, P[3]);
  a.vline(56, 9, 17, P[1]);
  a.vline(7, 3, 19, GUNMETAL[1]);
  a.rect(6, 18, 3, 2, GUNMETAL[2]);
  return a;
}

/** The launcher's art size, where it pivots on its arm, and its two tubes' muzzles (art pixels). */
export const M113_LAUNCHER = { w: 40, h: 16, pivot: [14, 15] as Pt, tubes: [[38, 6], [38, 12]] as Pt[] };

/**
 * The carrier's launcher, facing right: an armoured box (a "hammerhead") with
 * the sight's head on its top and the two launch tubes' muzzles at its front.
 */
export function m113LauncherArt(): PixelArt {
  const P = M113.paint;
  const a = new PixelArt(M113_LAUNCHER.w, M113_LAUNCHER.h);
  a.roundRect(0, 4, 36, 11, 1, P[2]);
  a.roundRect(4, 0, 14, 5, 1, P[2]);
  a.rect(35, 4, 4, 5, P[1]);
  a.rect(35, 10, 4, 5, P[1]);
  a.rect(12, 14, 5, 2, P[1]);
  finish(a);
  // the tubes' mouths, the sight's window, the doors over the tubes' backs
  for (const [x, y] of M113_LAUNCHER.tubes) a.rect(x - 1, y - 1, 2, 2, GUNMETAL[0]);
  a.rect(16, 1, 1, 3, GLASS[3]);
  a.vline(24, 6, 12, P[1]);
  a.hline(2, 33, 9, P[1]);
  a.hline(5, 16, 1, P[3]);
  return a;
}

/** The carrier's road wheel and its sprocket and idler. */
export function m113WheelArt(): PixelArt {
  return tankWheelArt(M113.wheel, M113.paint, 6);
}

export function m113SprocketArt(): PixelArt {
  return tankSprocketArt(M113.wheel + 1, M113.paint);
}

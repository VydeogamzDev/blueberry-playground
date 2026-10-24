import { PixelArt, CLEAR, type Color } from './PixelArt';
import {
  finish, ramp, type Ramp, RED, BLUE_PAINT, WHITE, OLIVE, KHAKI, GUNMETAL, STEEL, STEEL_LT, GLASS, RUBBER, LAMP, LED_RED, ORANGE, YELLOW, BRASS,
} from './palette';

// The car, the pickup, the SUV and the tanks, their wheels, the tanks' barrels
// and the shell. Same rules as every other sprite: palette ramps, finish() for
// outline and lighting, one-pixel details after it. The cars are drawn to the
// people's scale, roomy enough to sit them inside (see CarConfig.seats): what
// sits in them is drawn between the body and its front layer (seeThrough()).

type Pt = [number, number];

/** The dark of a wheel well. */
const WELL = RUBBER[0];
/** The black of a burnt-out cab, seen through its empty window frames. */
const SOOT = 0x1d1b1a;
/** Glass that is seen through: the cab, and whoever sits in it, are behind it (see seeThrough()). */
const PANE = new Set<Color>([GLASS[0], GLASS[1], GLASS[2], GLASS[3], SOOT]);

/**
 * A window: the sky reflected along its top, the dark of the cab low down,
 * seat backs standing behind where heads go (`seats`: seat points, see
 * CarConfig.seats), and a glint leaning the way the light falls, `glint` of
 * the way along (0: none).
 */
function glass(a: PixelArt, pts: Pt[], seats: Pt[] = [], glint = 0.35): void {
  const m = new PixelArt(a.w, a.h).poly(pts, 1);
  let x0 = a.w;
  let x1 = 0;
  let y0 = a.h;
  let y1 = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    if (!m.filled(x, y)) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = y0; y <= y1; y++) {
    const c = y - y0 < 2 ? GLASS[3] : (y - y0) / Math.max(1, y1 - y0) < 0.8 ? GLASS[2] : GLASS[1];
    for (let x = x0; x <= x1; x++) if (m.filled(x, y)) a.set(x, y, c);
  }
  // seat backs and headrests, dark against the far window
  for (const [sx, sy] of seats) {
    for (let y = sy - 27; y <= y1; y++) {
      const head = y < sy - 20;
      for (let x = sx - (head ? 12 : 13); x <= sx - (head ? 9 : 7); x++) if (m.filled(x, y)) a.set(x, y, head ? GLASS[1] : GLASS[0]);
    }
  }
  if (glint <= 0) return;
  const gx = Math.round(x0 + (x1 - x0) * glint);
  for (let i = 0; i <= y1 - y0; i++) {
    const x = gx + Math.round(i * 0.7);
    const y = y1 - i;
    if (m.filled(x, y) && (i + 1) % 6 !== 0) a.set(x, y, GLASS[4]);
    if (m.filled(x + 2, y) && i > 2 && i % 4 !== 0) a.set(x + 2, y, GLASS[4]);
  }
}

/**
 * Wheel arches cut out round the axles (`r`: the arch's radius), dark wells
 * above the tyres, and a lip round each in `lip`.
 */
function arches(a: PixelArt, axles: Pt[], r: number, lip: Color): void {
  for (const [ax, ay] of axles) {
    const cx = ax + 0.5;
    const cy = ay + 0.5;
    for (let y = Math.floor(cy - r - 2); y < a.h; y++) {
      for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) {
        if (!a.filled(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < r && y > ay) a.set(x, y, CLEAR);
        else if (d < r - 1.2) a.set(x, y, WELL);
        else if (d < r + 0.3) a.set(x, y, lip);
      }
    }
  }
}

/** A door seam (or a pillar's edge) down the paint from y0 to y1: over the paint only, not the sills or arches. */
function seam(a: PixelArt, x: number, y0: number, y1: number, P: Ramp): void {
  for (let y = y0; y <= y1; y++) if (P.includes(a.get(x, y))) a.set(x, y, P[0]);
}

/**
 * The front layer drawn over whoever sits inside: the body as it is, with the
 * windows taken out so they show through them (the glints stay on the glass)
 * and the wheel wells (the tyres are drawn in front of those). Only the rows
 * above `rows` (a tank's hull and turret, not its tracks).
 */
export function seeThrough(body: PixelArt, rows = body.h): PixelArt {
  const a = body.clone();
  for (let i = 0; i < a.px.length; i++) if (PANE.has(a.px[i]) || a.px[i] === WELL || i >= rows * a.w) a.px[i] = CLEAR;
  return a;
}

/**
 * Burnt out: the glass gone (a few shards left in the frames), the lamps dead
 * and the paint blistered off in patches. The char over it all is the
 * sprite's (Part.charred).
 */
export function wreckOf(body: PixelArt): PixelArt {
  const a = body.clone();
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const glassy = new Set<Color>([...PANE, GLASS[4]]);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const c = a.get(x, y);
      if (glassy.has(c)) {
        // shards hang on along the frame's edges
        const edge = !glassy.has(a.get(x - 1, y)) || !glassy.has(a.get(x, y - 1)) || !glassy.has(a.get(x + 1, y));
        a.set(x, y, edge && rnd() < 0.35 ? GLASS[1] : SOOT);
      } else if (c === LAMP || c === LED_RED || c === ORANGE[2]) a.set(x, y, GUNMETAL[0]);
    }
  }
  for (let k = 0; k < (a.w * a.h) / 160; k++) {
    const cx = Math.floor(rnd() * a.w);
    const cy = Math.floor(rnd() * a.h);
    const r = 1 + rnd() * 2.2;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const c = a.get(x, y);
      if (c === CLEAR || glassy.has(c) || c === SOOT || c === WELL || Math.hypot(x - cx, y - cy) > r || rnd() < 0.3) continue;
      a.set(x, y, rnd() < 0.6 ? 0x4a3a30 : 0x6a5646);
    }
  }
  return a;
}

/**
 * A tyre on a rim with five wheel nuts, `d` pixels across (`hub` the rim's
 * size); knobbly ones have blocks notched into their edge.
 */
export function tyreArt(d: number, hub: number, rim: Ramp, knobbly = false): PixelArt {
  const a = new PixelArt(d, d);
  const c = (d - 1) / 2;
  const o = (d - hub) / 2;
  a.ellipse(0, 0, d, d, RUBBER[2]);
  a.ellipse(o, o, hub, hub, rim[2]);
  a.ellipse(o + 2, o + 2, hub - 4, hub - 4, rim[1]);
  if (knobbly) {
    for (let i = 0; i < 16; i += 2) {
      const t = (i / 16) * Math.PI * 2;
      a.set(Math.round(c + Math.cos(t) * (d / 2 - 0.5)), Math.round(c + Math.sin(t) * (d / 2 - 0.5)), CLEAR);
    }
  }
  finish(a);
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 - Math.PI / 2;
    a.set(Math.round(c + Math.cos(t) * (hub / 2 - 2)), Math.round(c + Math.sin(t) * (hub / 2 - 2)), rim[0]);
  }
  a.set(Math.floor(c), Math.floor(c), STEEL_LT[3]);
  // tread
  const n = knobbly ? 8 : 14;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * Math.PI * 2;
    a.set(Math.round(c + Math.cos(t) * (d / 2 - 1.6)), Math.round(c + Math.sin(t) * (d / 2 - 1.6)), RUBBER[knobbly ? 3 : 1]);
  }
  return a;
}

/**
 * A small hatchback facing right: two doors a side, a sloping hatch, the
 * driver's seat and one behind it. `seats` are where they sit (see
 * CarConfig.seats): the windows show their seat backs.
 */
export const HATCH = {
  w: 122, h: 46, axles: [[17, 40], [103, 40]] as Pt[], seats: [[64, 33], [36, 33]] as Pt[],
};

export function hatchBodyArt(): PixelArt {
  const { w: W, h: H, axles, seats } = HATCH;
  const a = new PixelArt(W, H);
  const P = RED;
  // the shell: hatch, roof, windshield, hood and the body under them
  a.poly([[1, 27], [3, 21], [12, 2], [17, 0], [73, 0], [78, 2], [96, 20], [114, 23], [120, 26], [121, 30], [121, 41], [119, 44], [3, 44], [1, 41]], P[2]);
  // bumpers, and the sills between the wheels
  a.roundRect(0, 32, 6, 9, 1, GUNMETAL[2]);
  a.roundRect(115, 32, 7, 9, 1, GUNMETAL[2]);
  a.rect(30, 40, 60, 5, GUNMETAL[2]);
  // two-tone: the doors' lower half a shade deeper below the crease
  for (let y = 34; y < 40; y++) for (let x = 6; x < 115; x++) if (a.get(x, y) === P[2]) a.set(x, y, P[1]);
  arches(a, axles, 13.5, GUNMETAL[1]);
  // windows: the rear quarter, the back door's, the front door's, and the windshield seen edge on
  glass(a, [[8, 20], [15, 5], [21, 5], [21, 20]], [], 0.5);
  glass(a, [[25, 4], [49, 4], [49, 20], [25, 20]], [seats[1]], 0.62);
  glass(a, [[53, 4], [72, 4], [88, 20], [53, 20]], [seats[0]], 0.68);
  glass(a, [[76, 2], [78, 2], [95, 19], [93, 19]], [], 0);
  finish(a);
  // door seams and handles, the waist and the crease
  for (const x of [23, 51]) seam(a, x, 5, 39, P);
  seam(a, 90, 21, 39, P);
  a.hline(4, 113, 22, P[3]);
  a.hline(6, 114, 33, P[0]);
  for (const x of [44, 74]) {
    a.hline(x, x + 3, 25, GUNMETAL[0]);
    a.hline(x, x + 3, 24, P[3]);
  }
  // window frames
  a.hline(24, 50, 3, GUNMETAL[1]);
  a.hline(52, 72, 3, GUNMETAL[1]);
  a.hline(8, 88, 21, GUNMETAL[1]);
  // the mirror on the door at the foot of the A-pillar
  a.roundRect(84, 15, 5, 4, 1, P[1]);
  a.hline(85, 87, 15, P[3]);
  a.set(84, 18, GUNMETAL[1]);
  // lamps (headlight, indicator, tail light), the fuel cap and the grille's slots
  a.roundRect(115, 26, 6, 4, 1, LAMP);
  a.hline(116, 119, 26, 0xfffbe0);
  a.rect(114, 30, 3, 2, ORANGE[2]);
  a.rect(1, 25, 3, 6, LED_RED);
  a.vline(1, 25, 30, RED[1]);
  a.rect(12, 26, 3, 3, P[1]);
  a.set(12, 26, P[0]);
  for (let y = 33; y < 39; y += 2) a.hline(118, 121, y, GUNMETAL[0]);
  return a;
}

/**
 * A pickup facing right: a single cab, a long hood and an open bed behind,
 * with rails along the top of its side. The bed's floor (`bed.y`, an art row)
 * is the top of the chassis between the tailgate and the cab (`bed.x0` to
 * `bed.x1`; see the truck's shapes in catalog/vehicles.ts).
 */
export const PICKUP = {
  w: 166, h: 50, axles: [[36, 45], [136, 45]] as Pt[], seats: [[94, 35], [87, 34]] as Pt[],
  bed: { y: 31, x0: 4, x1: 66 },
};

export function truckBodyArt(): PixelArt {
  const { w: W, h: H, axles, seats } = PICKUP;
  const a = new PixelArt(W, H);
  const P = BLUE_PAINT;
  // the bed's side and the tailgate, the cab, the hood and the body under them
  a.poly([[1, 21], [67, 21], [67, 4], [70, 1], [101, 1], [104, 3], [120, 21], [158, 23], [164, 27], [165, 31], [165, 44], [162, 47], [4, 47], [1, 44]], P[2]);
  // bumpers, and the running board
  a.roundRect(0, 36, 6, 10, 1, GUNMETAL[2]);
  a.roundRect(157, 35, 9, 12, 1, STEEL_LT[2]);
  a.rect(50, 43, 70, 3, GUNMETAL[2]);
  // two-tone: the lower body a shade deeper below the crease
  for (let y = 37; y < 47; y++) for (let x = 0; x < W; x++) if (a.get(x, y) === P[2]) a.set(x, y, P[1]);
  arches(a, axles, 15.5, GUNMETAL[1]);
  // the cab's side window, and the windshield seen edge on
  glass(a, [[73, 4], [99, 4], [115, 20], [73, 20]], [seats[0]], 0.72);
  glass(a, [[103, 3], [105, 3], [120, 19], [118, 19]], [], 0);
  finish(a);
  // the bed rail with its stake pockets, the tailgate's seam and handle
  a.hline(2, 66, 21, STEEL_LT[3]);
  a.hline(2, 66, 22, STEEL_LT[1]);
  for (const x of [18, 34, 50]) a.rect(x, 23, 2, 2, P[0]);
  seam(a, 5, 22, 45, P);
  a.hline(2, 4, 27, GUNMETAL[0]);
  seam(a, 67, 21, 45, P);
  // the cab's door seams and handle, the crease, window frames
  seam(a, 71, 4, 45, P);
  seam(a, 121, 22, 45, P);
  a.hline(72, 119, 21, GUNMETAL[1]);
  a.hline(72, 101, 3, GUNMETAL[1]);
  a.hline(6, 156, 30, P[3]);
  a.hline(100, 103, 25, GUNMETAL[0]);
  a.hline(100, 103, 24, P[4]);
  // the mirror, lamps (headlight, indicator, tail light), the grille
  a.roundRect(115, 14, 6, 5, 1, STEEL_LT[2]);
  a.hline(116, 119, 14, STEEL_LT[4]);
  a.roundRect(158, 26, 7, 5, 1, LAMP);
  a.hline(159, 163, 26, 0xfffbe0);
  a.rect(155, 31, 3, 2, ORANGE[2]);
  a.rect(1, 23, 2, 8, LED_RED);
  a.set(1, 23, 0xff8a7a);
  for (let y = 32; y < 35; y++) a.hline(160, 164, y, y % 2 ? GUNMETAL[0] : STEEL_LT[3]);
  return a;
}

/**
 * A tall, boxy SUV facing right: a roof rack, a spare wheel on the tailgate,
 * dark cladding along the sills and round the arches, and two rows of seats
 * (the driver and the one behind on the near side, then the far side's).
 */
export const SUV = {
  w: 152, h: 52, axles: [[30, 47], [122, 47]] as Pt[], seats: [[80, 38], [73, 37], [50, 38], [43, 37]] as Pt[],
};

export function suvBodyArt(): PixelArt {
  const { w: W, h: H, axles, seats } = SUV;
  const a = new PixelArt(W, H);
  const P = WHITE;
  const C = GUNMETAL;
  // the shell: an upright tailgate, a long roof, the windshield and a short hood
  a.poly([[3, 44], [3, 6], [6, 3], [110, 3], [113, 5], [124, 22], [146, 24], [151, 28], [151, 45], [148, 49], [6, 49], [3, 46]], P[2]);
  // the cladding along the bottom, the bumpers, and the spare wheel edge on
  a.rect(3, 41, 148, 9, C[2]);
  a.roundRect(0, 38, 8, 11, 1, C[2]);
  a.roundRect(144, 36, 8, 12, 1, C[2]);
  a.roundRect(0, 17, 4, 18, 1, RUBBER[2]);
  // flared arches
  for (const [ax, ay] of axles) a.ellipse(ax - 17, ay - 17, 35, 35, C[2]);
  a.rect(0, 50, W, 2, CLEAR);
  arches(a, axles, 15.5, C[1]);
  // windows: the rear quarter, the back door's, the front door's, and the windshield seen edge on
  glass(a, [[7, 6], [32, 6], [32, 23], [7, 23]], [], 0.6);
  glass(a, [[36, 6], [60, 6], [60, 23], [36, 23]], [seats[2]], 0.62);
  glass(a, [[64, 6], [108, 6], [118, 23], [64, 23]], [seats[0]], 0.7);
  glass(a, [[112, 5], [114, 5], [124, 20], [122, 20]], [], 0);
  finish(a);
  // the roof rack: rails on three feet
  a.hline(9, 104, 0, C[1]);
  a.hline(9, 104, 1, C[3]);
  for (const x of [11, 56, 101]) a.set(x, 2, C[0]).set(x + 1, 2, C[0]);
  a.vline(9, 0, 2, C[0]);
  a.vline(104, 0, 2, C[0]);
  // door seams and handles, the waist and the crease, window frames
  for (const x of [34, 62]) seam(a, x, 6, 40, P);
  seam(a, 116, 24, 40, P);
  a.hline(5, 124, 24, P[3]);
  a.hline(4, 146, 33, P[1]);
  for (const x of [52, 86]) {
    a.hline(x, x + 3, 27, C[0]);
    a.hline(x, x + 3, 26, P[4]);
  }
  a.hline(6, 106, 5, C[1]);
  a.hline(6, 122, 23, C[1]);
  // the mirror, lamps (headlight, indicator, fog light, the tail light up the back), the grille
  a.roundRect(121, 16, 6, 5, 1, C[2]);
  a.hline(122, 125, 16, C[3]);
  a.roundRect(144, 26, 7, 5, 1, LAMP);
  a.hline(145, 149, 26, 0xfffbe0);
  a.rect(141, 31, 3, 2, ORANGE[2]);
  a.rect(146, 41, 4, 2, LAMP);
  a.rect(4, 26, 2, 9, LED_RED);
  a.set(4, 26, 0xff8a7a);
  for (let y = 32; y < 40; y += 2) a.hline(146, 150, y, C[0]);
  // the spare wheel's hub, and the side step
  a.vline(1, 22, 29, STEEL[3]);
  a.hline(40, 112, 45, C[3]);
  a.hline(40, 112, 46, C[0]);
  return a;
}

/** The tank's sprocket (rear), road wheels and idler (front): centers in hull art pixels. */
export const TANK_AXLES: [number, number][] = [[8, 29], [24, 35], [41, 35], [58, 35], [75, 35], [92, 35], [110, 29]];

/** Fills the outline a belt makes stretched round circles of radius `r` at `centers`. */
function beltAround(a: PixelArt, centers: [number, number][], r: number, c: Color): void {
  const pts: [number, number][] = [];
  for (const [x, y] of centers) {
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push([x + 0.5 + Math.cos(t) * r, y + 0.5 + Math.sin(t) * r]);
    }
  }
  a.poly(convexHull(pts), c);
}

/** Convex hull of points (monotone chain), in order round the outside. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Side view of a tank's hull facing right: the track round its wheels (drawn
 * as separate parts in front of it), the hull with a sloped glacis, and the
 * turret with its cupola and the mantlet the barrel hangs from.
 */
export function tankHullArt(): PixelArt {
  const W = 120;
  const a = new PixelArt(W, 44);
  const P = OLIVE;
  // the track, dark inside, with two return rollers under its top run
  beltAround(a, TANK_AXLES, 8.2, RUBBER[2]);
  beltAround(a, TANK_AXLES, 6.2, GUNMETAL[0]);
  for (const x of [49, 83]) a.ellipse(x, 24, 3, 3, GUNMETAL[2]);
  // hull over the track, a stowage box and the skirt's edge
  a.poly([[1, 21], [1, 15], [6, 11], [94, 11], [119, 18], [119, 21]], P[2]);
  a.rect(12, 13, 12, 4, P[1]);
  a.hline(2, 117, 19, P[1]);
  // turret, cupola and mantlet
  a.poly([[34, 11], [40, 3], [74, 3], [83, 9], [83, 11]], P[2]);
  a.roundRect(46, 0, 11, 4, 1, P[2]);
  a.rect(79, 4, 5, 7, GUNMETAL[2]);
  a.hline(36, 78, 10, P[1]);
  finish(a);
  // track links on both runs, cleats along the ground
  for (let x = 2; x < 118; x += 3) {
    a.paint(x, 22, RUBBER[3]);
    a.paint(x, 42, RUBBER[3]);
    a.paint(x, 43, RUBBER[2]);
  }
  for (let x = 30; x <= 90; x += 10) a.set(x, 14, P[3]);
  a.map(['..X..', 'XXXXX', '.XXX.', '.X.X.'], { X: WHITE[3] }, 56, 5);
  a.hline(48, 54, 1, P[3]);
  a.vline(42, 0, 2, GUNMETAL[1]);
  a.set(115, 18, LAMP).set(116, 18, LAMP);
  a.set(2, 16, LED_RED);
  return a;
}

/** A road wheel: rubber rim round a dished, bolted hub (drawn inside the track's belt). */
export function roadWheelArt(): PixelArt {
  const a = new PixelArt(12, 12);
  a.ellipse(0, 0, 12, 12, RUBBER[2]);
  a.ellipse(2, 2, 8, 8, OLIVE[2]);
  a.ellipse(4, 4, 4, 4, OLIVE[1]);
  finish(a);
  for (const [x, y] of [[5, 2], [9, 5], [6, 9], [2, 6]]) a.set(x, y, OLIVE[0]);
  a.set(5, 5, STEEL_LT[3]);
  return a;
}

/** The drive sprocket and idler at the track's ends: a toothed steel wheel. */
export function sprocketArt(): PixelArt {
  const a = new PixelArt(12, 12);
  a.ellipse(1, 1, 10, 10, GUNMETAL[2]);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    a.set(Math.round(5.5 + Math.cos(t) * 5.6), Math.round(5.5 + Math.sin(t) * 5.6), GUNMETAL[2]);
  }
  a.ellipse(3, 3, 6, 6, OLIVE[2]);
  finish(a);
  for (const [x, y] of [[5, 3], [8, 6], [5, 8], [3, 5]]) a.set(x, y, OLIVE[0]);
  a.set(5, 5, STEEL_LT[3]);
  return a;
}

/** The tank's gun barrel pointing right: collar at the mantlet, fume extractor, muzzle brake. */
export function tankBarrelArt(): PixelArt {
  const a = new PixelArt(40, 5);
  a.rect(0, 1, 36, 3, OLIVE[2]);
  a.rect(0, 0, 4, 5, OLIVE[2]);
  a.rect(17, 0, 6, 5, OLIVE[2]);
  a.rect(35, 0, 5, 5, GUNMETAL[2]);
  finish(a);
  a.vline(37, 1, 3, GUNMETAL[0]);
  a.set(39, 2, GUNMETAL[0]);
  return a;
}

/** A high-explosive tank shell in flight, nose to the right. */
export function shellArt(): PixelArt {
  const a = new PixelArt(10, 4);
  a.rect(0, 0, 7, 4, OLIVE[2]);
  a.poly([[7, 0], [10, 2], [7, 4]], OLIVE[2]);
  a.rect(1, 0, 2, 4, BRASS[2]);
  finish(a, { shadow: false });
  a.vline(5, 1, 2, YELLOW[2]);
  a.set(9, 2, GUNMETAL[1]);
  return a;
}

// ---- three real tanks ----------------------------------------------------------------

/** The Abrams' desert tan. */
const TAN = ramp('#b49b6c');
/** The Type 99A's digital woodland camouflage: the base green, a dark green, a pale khaki green and a brown. */
const PLA = [ramp('#5f6c3e'), ramp('#3d4a2c'), ramp('#8a8b5a'), ramp('#5b4934')] as const;
/** NATO's three-tone camouflage on the Leopard: green, brown and black. */
const NATO = [ramp('#526140'), ramp('#5e4a38'), ramp('#30312d', 1.1)] as const;

/** Smooth value noise in 0..1 over a grid of `cell` pixels: the same for the same seed (camouflage patches). */
function blotch(x: number, y: number, cell: number, seed: number): number {
  const hash = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const gx = x / cell;
  const gy = y / cell;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(gx - i);
  const v = s(gy - j);
  const top = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u;
  const bottom = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return top + (bottom - top) * v;
}

/** NATO three-tone: broad patches of green and brown, black between, spread out along the hull. */
function natoCamo(x: number, y: number): Ramp {
  const v = 0.7 * blotch(x, y * 1.6, 20, 5) + 0.3 * blotch(x, y, 8, 9);
  return v < 0.38 ? NATO[1] : v > 0.64 ? NATO[2] : NATO[0];
}

/** The PLA's digital woodland: the same kind of patches, made of three-pixel squares. */
function plaCamo(x: number, y: number): Ramp {
  const cx = Math.floor(x / 3);
  const cy = Math.floor(y / 3);
  const v = 0.75 * blotch(cx, cy, 5, 11) + 0.25 * blotch(cx, cy, 1, 12);
  return v < 0.34 ? PLA[1] : v < 0.6 ? PLA[0] : v < 0.76 ? PLA[2] : PLA[3];
}

/** Repaints the pixels in the ramp `P` (any shade) with the camouflage's, shade for shade. */
function camouflage(a: PixelArt, P: Ramp, camo: (x: number, y: number) => Ramp): void {
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const k = P.indexOf(a.get(x, y));
      if (k >= 0) a.set(x, y, camo(x, y)[k]);
    }
  }
}

/** A basket of stowage on a turret's back: a wire frame with kit showing through. */
function basket(a: PixelArt, x: number, y: number, w: number, h: number): void {
  a.roundRect(x + 1, y + 2, w - 3, h - 4, 1, KHAKI[1]);
  a.rect(x + 2, y + h - 7, 4, 5, OLIVE[1]);
  for (let i = x; i < x + w; i += 3) a.vline(i, y, y + h - 1, GUNMETAL[2]);
  a.hline(x, x + w - 1, y, GUNMETAL[3]);
  a.hline(x, x + w - 1, y + Math.floor(h / 2), GUNMETAL[2]);
  a.hline(x, x + w - 1, y + h - 1, GUNMETAL[1]);
}

/**
 * A real tank's side view facing right, at about 7/8 of the people's scale (28
 * sprite pixels to its metre), drawn from its outlines as the tank above is:
 * the track round its wheels (the wheels are parts, drawn in front), the hull,
 * a side skirt over the track's top run, the turret, and its own details. All
 * points are its art's pixels.
 */
export interface TankDesign {
  w: number;
  h: number;
  /** The track's outer radius round each wheel (the wheels' colliders), and the road wheels' drawn size. */
  r: number;
  wheel: number;
  /** The sprocket (at the back) first, then the road wheels, and the idler (at the front) last. */
  axles: Pt[];
  hull: Pt[];
  skirt: Pt[];
  turret: Pt[];
  /** The convex pieces its colliders are made of: the hull down to the skirt's foot, and the turret. */
  body: Pt[][];
  paint: Ramp;
  /** Camouflage over the paint (none: plain). */
  camo?: (x: number, y: number) => Ramp;
  /** Where the barrel pivots; the commander's hatch (the seat: the hips, under the roof); the engine, the fuel and the headlight. */
  trunnion: Pt;
  hatch: Pt;
  engine: Pt;
  fuel: Pt;
  lamp: Pt;
  /** Over the turret's top, where someone let go of gets in (x, y, width, height). */
  cabin: [number, number, number, number];
  /** Sights, hatches and stowage that stand out of the outline (drawn before the finish), and the details over it. */
  fit: (a: PixelArt, P: Ramp) => void;
  details: (a: PixelArt, P: Ramp) => void;
  barrel: GunDesign;
}

/** A tank's gun barrel pointing right: its length and the bore evacuator's span (pixels), sleeve joints, a muzzle sensor. */
export interface GunDesign {
  len: number;
  evacuator: [number, number];
  joints: number[];
  /** The muzzle reference sensor's little box on top at the muzzle. */
  sensor: boolean;
}

/** A barrel's height (pixels), and the row down its bore (it pivots at its collar's middle, and the shell leaves its end). */
export const GUN_H = 7;
export const GUN_BORE = 3;

/** The hull, track and turret of a TankDesign. */
export function tankArt(d: TankDesign): PixelArt {
  const a = new PixelArt(d.w, d.h);
  const P = d.paint;
  // the track, dark inside (its top run is behind the skirt)
  beltAround(a, d.axles, d.r + 0.2, RUBBER[2]);
  beltAround(a, d.axles, d.r - 1.8, GUNMETAL[0]);
  a.poly(d.hull, P[2]);
  a.poly(d.skirt, P[2]);
  a.poly(d.turret, P[2]);
  d.fit(a, P);
  finish(a);
  // cleats along the ground
  for (let x = 2; x < d.w - 2; x += 3) {
    a.paint(x, d.h - 2, RUBBER[3]);
    a.paint(x, d.h - 1, RUBBER[2]);
  }
  d.details(a, P);
  if (d.camo) camouflage(a, P, d.camo);
  return a;
}

/** A tank's gun barrel (see GunDesign): a collar at the mantlet, the thermal sleeve's joints, the bore evacuator. */
export function tankGunArt(g: GunDesign, P: Ramp, camo?: (x: number, y: number) => Ramp): PixelArt {
  const a = new PixelArt(g.len, GUN_H);
  const [e0, e1] = g.evacuator;
  a.rect(0, 1, g.len, 5, P[2]);
  a.rect(0, 0, 12, GUN_H, P[2]);
  a.roundRect(e0, 0, e1 - e0, GUN_H, 1, P[2]);
  if (g.sensor) a.rect(g.len - 6, 0, 4, 1, P[2]);
  finish(a);
  for (const x of g.joints) a.vline(x, 2, 4, P[1]);
  a.vline(e0 + 1, 1, 5, P[3]);
  a.vline(g.len - 1, 2, 4, GUNMETAL[0]);
  if (camo) camouflage(a, P, camo);
  return a;
}

/** A tank's road wheel, `d` pixels across: a rubber tyre on a dished disc, bolts round its hub. */
export function tankWheelArt(d: number, P: Ramp, bolts = 8): PixelArt {
  const a = new PixelArt(d, d);
  const hub = d - 10;
  a.ellipse(0, 0, d, d, RUBBER[2]);
  a.ellipse(2, 2, d - 4, d - 4, P[2]);
  a.ellipse(5, 5, hub, hub, P[1]);
  finish(a);
  const c = (d - 1) / 2;
  for (let i = 0; i < bolts; i++) {
    const t = (i / bolts) * Math.PI * 2;
    a.set(Math.round(c + Math.cos(t) * (hub / 2 - 1)), Math.round(c + Math.sin(t) * (hub / 2 - 1)), P[0]);
  }
  a.ellipse(Math.floor(c) - 1, Math.floor(c) - 1, 3, 3, P[3]);
  a.set(Math.floor(c), Math.floor(c), STEEL_LT[3]);
  return a;
}

/** A tank's drive sprocket and idler, `d` pixels across: a toothed steel ring round a painted hub. */
export function tankSprocketArt(d: number, P: Ramp): PixelArt {
  const a = new PixelArt(d, d);
  const c = (d - 1) / 2;
  a.ellipse(1, 1, d - 2, d - 2, GUNMETAL[2]);
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    a.set(Math.round(c + Math.cos(t) * (d / 2 - 0.3)), Math.round(c + Math.sin(t) * (d / 2 - 0.3)), GUNMETAL[2]);
  }
  a.ellipse(4, 4, d - 8, d - 8, P[2]);
  finish(a);
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    a.set(Math.round(c + Math.cos(t) * (d / 2 - 6)), Math.round(c + Math.sin(t) * (d / 2 - 6)), P[0]);
  }
  a.set(Math.floor(c), Math.floor(c), STEEL_LT[3]);
  return a;
}

/** Bolt heads in a row, every `step` pixels. */
function bolts(a: PixelArt, x0: number, x1: number, y: number, step: number, c: Color): void {
  for (let x = x0; x <= x1; x += step) a.set(x, y, c);
}

/**
 * The American M1A2 Abrams: a long, low hull with seven road wheels behind deep
 * skirts, and the flat, slab-sided turret reaching far back over the engine
 * deck to its bustle rack. On the roof the commander's cupola with its remote
 * weapon station, the independent thermal viewer on its post, the gunner's
 * sight and the loader's machine gun. Desert tan.
 */
export const ABRAMS: TankDesign = {
  w: 224, h: 76, r: 11, wheel: 18,
  axles: [[17, 54], [46, 64], [67, 64], [88, 64], [109, 64], [130, 64], [151, 64], [172, 64], [200, 57]],
  hull: [[1, 35], [4, 33], [172, 33], [222, 45], [222, 48], [210, 52], [1, 44]],
  skirt: [[28, 37], [188, 37], [207, 42], [207, 45], [199, 53], [30, 53], [28, 51]],
  turret: [[44, 10], [149, 9], [155, 10], [165, 22], [163, 26], [156, 33], [97, 33], [93, 28], [44, 28]],
  body: [
    [[1, 35], [4, 33], [172, 33], [222, 45], [222, 48], [210, 53], [30, 53], [1, 45]],
    [[30, 10], [149, 9], [155, 10], [165, 22], [163, 26], [156, 33], [30, 33]],
  ],
  paint: TAN,
  trunnion: [153, 19], hatch: [91, 19], engine: [14, 38], fuel: [60, 42], lamp: [218, 45], cabin: [44, 0, 112, 20],
  fit: (a, P) => {
    a.rect(30, 12, 14, 16, GUNMETAL[1]);
    // the commander's cupola and its weapon station (a heavy machine gun), the loader's hatch and gun
    a.rect(84, 6, 16, 3, P[2]);
    a.roundRect(99, 1, 9, 6, 1, P[2]);
    a.hline(108, 122, 3, GUNMETAL[2]);
    a.rect(62, 7, 12, 2, P[2]);
    a.rect(70, 5, 3, 2, GUNMETAL[2]);
    a.hline(73, 84, 5, GUNMETAL[2]);
    // the commander's thermal viewer on its post, the gunner's sight, the wind sensor
    a.rect(121, 4, 3, 5, P[1]);
    a.roundRect(117, 0, 11, 5, 1, P[2]);
    a.roundRect(133, 5, 14, 5, 1, P[2]);
    a.vline(52, 3, 9, GUNMETAL[2]);
    // the smoke grenade launchers on the turret's cheek, the gun shield
    a.roundRect(140, 12, 9, 6, 1, P[1]);
    a.rect(156, 14, 7, 10, P[1]);
  },
  details: (a, P) => {
    basket(a, 30, 12, 14, 16);
    // the roof's edge in the light, the turret's foot in shadow, stowage boxes along its side
    a.hline(45, 148, 10, P[3]);
    a.hline(97, 155, 32, P[1]);
    a.hline(98, 132, 17, P[3]);
    a.hline(98, 132, 24, P[1]);
    for (const x of [98, 115, 132]) a.vline(x, 17, 24, P[1]);
    a.hline(45, 92, 21, P[1]);
    // sights' glass, the cupola's vision blocks
    a.rect(127, 1, 1, 3, GUNMETAL[0]);
    a.rect(146, 6, 1, 3, GUNMETAL[0]);
    bolts(a, 86, 98, 7, 3, GUNMETAL[1]);
    // the launchers' tubes, the gun shield's edge
    for (let x = 141; x < 148; x += 2) a.set(x, 13, GUNMETAL[0]).set(x, 16, GUNMETAL[0]);
    a.vline(156, 14, 23, P[3]);
    // the deck's edge, the skirt's top, its panels, bolts and foot; the heavy front panel
    a.hline(4, 171, 34, P[3]);
    a.hline(29, 188, 37, P[3]);
    a.hline(31, 198, 52, P[1]);
    for (const x of [58, 88, 118, 148]) a.vline(x, 38, 51, P[1]);
    a.vline(149, 38, 51, P[0]);
    for (const x of [33, 63, 93, 123, 153]) bolts(a, x, x + 24, 39, 6, P[3]);
    // the driver's periscopes on the glacis, the lamps, the turbine's exhaust grille at the back
    for (const x of [177, 181, 185]) a.set(x, 35, GUNMETAL[0]).set(x, 36, GUNMETAL[1]);
    a.rect(215, 43, 3, 2, LAMP);
    a.set(216, 43, 0xfffbe0);
    a.rect(1, 36, 2, 3, LED_RED);
    for (let y = 38; y < 44; y += 2) a.hline(2, 5, y, GUNMETAL[0]);
  },
  barrel: { len: 130, evacuator: [54, 70], joints: [24, 38, 84, 98, 112], sensor: true },
};

/**
 * China's ZTZ-99A (Type 99A): a long hull on six big road wheels, with
 * reactive-armour bricks on the glacis and the skirt's front, and the turret's
 * arrowhead of add-on armour jutting forward over the gun. On the roof the
 * commander's panoramic sight, the laser dazzler, the gunner's sight and a
 * 12.7 mm machine gun; a stowage box on the turret's back. Digital woodland
 * camouflage.
 */
export const ZTZ99A: TankDesign = {
  w: 215, h: 74, r: 12, wheel: 20,
  axles: [[16, 52], [44, 61], [71, 61], [98, 61], [125, 61], [152, 61], [179, 61], [201, 54]],
  hull: [[1, 34], [4, 32], [160, 32], [213, 43], [213, 47], [204, 51], [1, 44]],
  skirt: [[28, 35], [174, 35], [196, 40], [196, 42], [187, 50], [30, 50], [28, 48]],
  turret: [[50, 9], [54, 8], [138, 8], [176, 19], [175, 22], [158, 30], [154, 32], [98, 32], [94, 28], [50, 28]],
  body: [
    [[1, 34], [4, 32], [160, 32], [213, 43], [213, 47], [204, 51], [30, 50], [1, 44]],
    [[40, 9], [138, 8], [176, 19], [175, 22], [154, 32], [40, 32]],
  ],
  paint: PLA[0], camo: plaCamo,
  trunnion: [148, 18], hatch: [108, 18], engine: [14, 37], fuel: [60, 41], lamp: [208, 44], cabin: [50, 0, 90, 18],
  fit: (a, P) => {
    a.roundRect(40, 10, 11, 18, 1, P[2]);
    // the commander's panoramic sight, his cupola with the heavy machine gun, the laser dazzler, the gunner's sight
    a.rect(98, 3, 4, 5, P[1]);
    a.roundRect(95, 0, 10, 4, 1, P[2]);
    a.rect(103, 6, 13, 2, P[2]);
    a.rect(112, 3, 5, 3, P[2]);
    a.hline(117, 132, 4, GUNMETAL[2]);
    a.roundRect(72, 2, 12, 6, 1, P[2]);
    a.roundRect(124, 4, 11, 4, 1, P[2]);
    // the smoke grenade launchers on the turret's side
    a.roundRect(128, 12, 12, 7, 1, P[1]);
  },
  details: (a, P) => {
    // the stowage box's lid, the roof's edge, the turret's foot
    a.hline(41, 49, 14, P[1]);
    a.hline(55, 137, 9, P[3]);
    a.hline(98, 153, 31, P[1]);
    a.hline(56, 92, 20, P[1]);
    // reactive-armour bricks along the arrowhead's upper face, in the light
    a.line(139, 9, 175, 19, P[3]);
    for (let k = 0; k < 5; k++) {
      const x = 143 + k * 7;
      const y = 10 + Math.round(k * 1.9);
      a.line(x, y, x - 2, y + 5, P[1]);
    }
    a.line(141, 15, 172, 23, P[1]);
    // the dazzler's lens, the sights' glass
    a.ellipse(81, 3, 3, 4, GUNMETAL[0]);
    a.set(82, 4, GLASS[4]);
    a.rect(104, 1, 1, 2, GUNMETAL[0]);
    a.rect(134, 5, 1, 2, GUNMETAL[0]);
    for (let x = 129; x < 139; x += 3) a.set(x, 13, GUNMETAL[0]).set(x, 17, GUNMETAL[0]);
    // the deck's edge, the skirt (bricks on its front panels), the glacis' bricks
    a.hline(4, 159, 33, P[3]);
    a.hline(29, 174, 35, P[3]);
    a.hline(31, 187, 49, P[1]);
    for (const x of [60, 90, 120]) a.vline(x, 36, 48, P[1]);
    for (let x = 148; x <= 184; x += 6) a.vline(x, 36, 48, P[0]);
    a.hline(148, 190, 40, P[1]);
    a.hline(148, 188, 44, P[1]);
    for (let x = 166; x < 210; x += 6) {
      const y = 32 + Math.round(((x - 160) * 11) / 53);
      a.line(x, y + 1, x + 1, y + 4, P[1]);
    }
    a.rect(206, 43, 3, 2, LAMP);
    a.set(207, 43, 0xfffbe0);
    a.rect(1, 35, 2, 3, LED_RED);
  },
  barrel: { len: 156, evacuator: [70, 90], joints: [26, 44, 104, 122, 140], sensor: false },
};

/**
 * Germany's Leopard 2A7: seven road wheels behind skirts (heavy armoured ones
 * at the front), extra armour on the lower glacis, and the turret's pointed
 * wedges of spaced armour on its face. On the roof the gunner's sight box, the
 * commander's tall periscope beside his hatch and the remote weapon station;
 * smoke launchers and stowage baskets at the back. NATO three-tone camouflage.
 */
export const LEOPARD2A7: TankDesign = {
  w: 218, h: 80, r: 12, wheel: 20,
  axles: [[17, 58], [44, 67], [66, 67], [88, 67], [110, 67], [132, 67], [154, 67], [176, 67], [199, 60]],
  hull: [[1, 37], [4, 35], [166, 35], [216, 47], [216, 52], [204, 56], [1, 48]],
  skirt: [[30, 39], [183, 39], [204, 44], [204, 46], [190, 57], [32, 57], [30, 55]],
  turret: [[52, 11], [146, 11], [180, 30], [176, 34], [152, 35], [100, 35], [96, 31], [52, 31]],
  body: [
    [[1, 37], [4, 35], [166, 35], [216, 47], [217, 56], [207, 58], [32, 57], [1, 48]],
    [[40, 11], [146, 11], [180, 30], [176, 34], [152, 35], [40, 35]],
  ],
  paint: NATO[0], camo: natoCamo,
  trunnion: [150, 22], hatch: [90, 21], engine: [14, 40], fuel: [62, 44], lamp: [212, 48], cabin: [52, 0, 100, 22],
  fit: (a, P) => {
    a.rect(40, 13, 12, 18, GUNMETAL[1]);
    // the commander's hatch and his periscope on its post, the weapon station, the gunner's sight
    a.rect(84, 8, 12, 3, P[2]);
    a.rect(101, 4, 4, 7, P[1]);
    a.roundRect(98, 0, 10, 5, 1, P[2]);
    a.roundRect(64, 4, 10, 7, 1, P[2]);
    a.hline(74, 86, 6, GUNMETAL[2]);
    a.roundRect(126, 6, 15, 6, 1, P[2]);
    // the smoke launchers, and the armour bolted onto the lower glacis
    a.roundRect(58, 14, 16, 6, 1, P[1]);
    a.poly([[203, 55], [216, 50], [217, 51], [217, 56], [207, 59]], P[2]);
  },
  details: (a, P) => {
    basket(a, 40, 13, 12, 18);
    // the wedge's face in the light, and where it stands off the turret's own face
    a.line(147, 12, 178, 30, P[3]);
    a.line(147, 13, 151, 34, P[1]);
    // the roof's edge, the turret's foot, the side armour's edge and bolts
    a.hline(53, 145, 12, P[3]);
    a.hline(100, 151, 34, P[1]);
    a.vline(122, 13, 33, P[1]);
    for (let y = 16; y < 33; y += 5) a.set(126, y, P[3]).set(142, y, P[3]);
    a.hline(53, 95, 24, P[1]);
    // the sights' glass, the periscope's head, the launchers' tubes
    a.rect(140, 7, 1, 3, GUNMETAL[0]);
    a.rect(107, 1, 1, 2, GUNMETAL[0]);
    for (let x = 59; x < 73; x += 3) a.set(x, 15, GUNMETAL[0]).set(x, 18, GUNMETAL[0]);
    // the deck's edge, the skirt: its panels and foot, the heavy front panels bolted on
    a.hline(4, 165, 36, P[3]);
    a.hline(31, 183, 39, P[3]);
    a.hline(33, 192, 56, P[1]);
    for (const x of [62, 92, 122]) a.vline(x, 40, 55, P[1]);
    a.vline(152, 40, 55, P[0]);
    bolts(a, 155, 185, 42, 6, P[3]);
    bolts(a, 155, 185, 53, 6, P[3]);
    a.line(204, 56, 216, 51, P[3]);
    a.rect(209, 47, 3, 2, LAMP);
    a.set(210, 47, 0xfffbe0);
    a.rect(1, 38, 2, 3, LED_RED);
  },
  barrel: { len: 166, evacuator: [66, 84], joints: [28, 46, 102, 122, 142], sensor: true },
};

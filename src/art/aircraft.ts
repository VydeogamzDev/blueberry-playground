import { PixelArt, CLEAR, type Color } from './PixelArt';
import { finish, ramp, type Ramp, GUNMETAL, STEEL, STEEL_LT, GLASS, LAMP, LED_RED, LED_GREEN, YELLOW, RED, ORANGE, BLUE_PAINT, WHITE, WOOD_PALE, WOOD_DARK, LEATHER } from './palette';
import { tyreArt } from './vehicles';
import { cached } from './rocketry';

// The aircraft (0.4.5): six aeroplanes and one of each of the other FAA aircraft
// categories, each drawn side on, facing right, at the people's scale (32 px to the
// metre, as the cars and tanks are), to the real one's measurements. Each design is
// laid out in metres from the tail (x) and the ground (y), so its seats, gear, wing
// and engines (see catalog/aircraft.ts) are where the real one's are.

export type Pt = [number, number];

/** Pixels to the metre (the game's: see engine/constants PX). */
export const PPM = 32;

/**
 * Where an aircraft is, in metres: x from its tail, y from the ground it stands on. Its
 * art runs from `top` down to `bottom` (the lowest axle), and from x = 0 to `len`.
 */
export interface Airframe {
  len: number;
  top: number;
  bottom: number;
  /** Its colliders: convex pieces (metres), each taken as the hull of its points. */
  pieces: Pt[][];
  /** Pieces that come off whole when it's torn apart (a fin, an engine, a wing). */
  whole: number[];
  /** Its wheels: x (m) and radius (m), the centre a radius off the ground. */
  wheels: { x: number; r: number; rim?: Ramp; hub?: number }[];
  /** Hips of whoever sits in it, the pilot's first (m), and how far each seat leans back (rad). */
  seats: Pt[];
  recline?: number[];
  /** Where people let go of get in (m: x0, y0, x1, y1). */
  cabin: [number, number, number, number];
  /** Centre of gravity, the engine that smokes when it's hurt, and the fuel that goes up (m). */
  cg: Pt;
  engine: Pt;
  fuel: Pt;
}

/** A metres-to-pixels sheet to draw an airframe on. */
export class Sheet {
  readonly a: PixelArt;
  constructor(readonly f: Pick<Airframe, 'len' | 'top' | 'bottom'>) {
    this.a = new PixelArt(Math.ceil(f.len * PPM) + 1, Math.ceil((f.top - f.bottom) * PPM) + 1);
  }

  /** A point (m) in art pixels. */
  p(x: number, y: number): Pt {
    return [x * PPM, (this.f.top - y) * PPM];
  }

  poly(pts: Pt[], c: Color): this {
    this.a.poly(pts.map(([x, y]) => this.p(x, y)), c);
    return this;
  }

  /** Only over pixels already drawn (paint on the skin). */
  over(pts: Pt[], c: Color, only?: (c: Color) => boolean): this {
    const m = new PixelArt(this.a.w, this.a.h).poly(pts.map(([x, y]) => this.p(x, y)), 1);
    for (let i = 0; i < m.px.length; i++) if (m.px[i] !== CLEAR && this.a.px[i] !== CLEAR && (!only || only(this.a.px[i]))) this.a.px[i] = c;
    return this;
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    return this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): this {
    const [px, py] = this.p(cx - rx, cy + ry);
    this.a.ellipse(Math.round(px), Math.round(py), Math.max(1, Math.round(rx * 2 * PPM)), Math.max(1, Math.round(ry * 2 * PPM)), c);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    const [a, b] = this.p(x0, y0);
    const [d, e] = this.p(x1, y1);
    this.a.line(Math.round(a), Math.round(b), Math.round(d), Math.round(e), c);
    return this;
  }

  /** A line drawn only over the skin (a panel line, a seam). */
  seam(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    const [a, b] = this.p(x0, y0);
    const [d, e] = this.p(x1, y1);
    const n = Math.max(Math.abs(d - a), Math.abs(e - b), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a + ((d - a) * i) / n);
      const y = Math.round(b + ((e - b) * i) / n);
      if (this.a.filled(x, y)) this.a.set(x, y, c);
    }
    return this;
  }

  /** A polygon's outline (an edge inside the silhouette: a fin over the fuselage). */
  edge(pts: Pt[], c: Color, closed = true): this {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      this.seam(x0, y0, x1, y1, c);
    }
    return this;
  }

  set(x: number, y: number, c: Color): this {
    const [px, py] = this.p(x, y);
    this.a.set(Math.round(px), Math.round(py), c);
    return this;
  }
}

/** A window pane: sky along its top, the dark of the cabin below (glass: shatters, and is seen through: see vehicles' seeThrough()). */
function pane(s: Sheet, pts: Pt[]): void {
  const m = new PixelArt(s.a.w, s.a.h).poly(pts.map(([x, y]) => s.p(x, y)), 1);
  let y0 = s.a.h;
  let y1 = 0;
  for (let y = 0; y < s.a.h; y++) for (let x = 0; x < s.a.w; x++) if (m.filled(x, y)) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = y0; y <= y1; y++) {
    const c = y - y0 < 2 ? GLASS[3] : (y - y0) / Math.max(1, y1 - y0) < 0.75 ? GLASS[2] : GLASS[1];
    for (let x = 0; x < s.a.w; x++) if (m.filled(x, y)) s.a.set(x, y, c);
  }
}

/** A row of cabin windows, `w` by `h` px, every `pitch` m from x0 back to x1 (skipping `skip`), their middles at `y`. */
function windowRow(s: Sheet, x0: number, x1: number, y: number, pitch: number, w: number, h: number, skip: [number, number][] = []): void {
  for (let x = x0; x >= x1; x -= pitch) {
    if (skip.some(([a, b]) => x >= a && x <= b)) continue;
    const [px, py] = s.p(x, y);
    const L = Math.round(px - w / 2);
    const T = Math.round(py - h / 2);
    s.a.roundRect(L, T, w, h, Math.min(2, Math.floor(w / 3)), GLASS[2]);
    s.a.hline(L + 1, L + w - 2, T, GLASS[3]);
    s.a.hline(L + 1, L + w - 2, T + h - 1, GLASS[1]);
  }
}

/** A door's outline (a rounded rectangle drawn on the skin), with its handle. */
function door(s: Sheet, x0: number, y0: number, x1: number, y1: number, c: Color): void {
  s.edge([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c);
  s.seam(x1 - 0.12, (y0 + y1) / 2, x1 - 0.12, (y0 + y1) / 2 + 0.1, c);
}

let legsIn = false;

/** An aircraft's art drawn with its gear retracted: its legs left off (its wheels are parts of their own, hidden). */
export function gearUp(art: () => PixelArt): PixelArt {
  legsIn = true;
  try {
    return art();
  } finally {
    legsIn = false;
  }
}

/** A landing-gear leg from the airframe at (x, yTop) down to its axle (x2, y2), `t` m thick. */
function leg(s: Sheet, x: number, yTop: number, x2: number, y2: number, t: number, P: Ramp = STEEL): void {
  if (legsIn) return;
  s.poly([[x - t / 2, yTop], [x + t / 2, yTop], [x2 + t / 2, y2], [x2 - t / 2, y2]], P[2]);
}

/** The paint the aircraft come in. */
const LINER = ramp('#e8eaec', 0.6);
const BELLY = ramp('#a4abb2', 0.8);
const NAVY = ramp('#22417a');
const SKY_BLUE = ramp('#3a7cc0');
const MAROON = ramp('#8a2130');
const GOLD = ramp('#c09a3c');
const SLATE = ramp('#45607e');
const VIPER = ramp('#8b949b', 0.8);
const VIPER_DK = ramp('#6d767d', 0.9);
const HOG = ramp('#5f666b', 0.9);
const DRAB = ramp('#3d4336', 1.0);
const OSPREY_GREY = ramp('#737b81', 0.9);
const GLIDER = ramp('#f2f2ec', 0.5);
const TUBE = ramp('#b9bec4', 0.8);
const POD = ramp('#e6e0d0', 0.7);
const RADOME = ramp('#585e63', 0.9);
const NOZZLE = ramp('#5b5550', 1.1);
const WICKER = WOOD_PALE;

/** The prop's spinner (a cone, `r` m round) at the nose (x, y) pointing right. */
function spinner(s: Sheet, x: number, y: number, r: number, len: number, P: Ramp): void {
  s.poly([[x - len, y + r], [x - len * 0.4, y + r * 0.9], [x, y + r * 0.2], [x, y - r * 0.2], [x - len * 0.4, y - r * 0.9], [x - len, y - r]], P[2]);
}

// ---------------------------------------------------------------- Boeing 737-800

/** The Boeing 737-800: 39.5 m long, the tail's top 12.5 m up, its belly 1.45 m off the ground. */
export const B738: Airframe = {
  len: 39.5, top: 12.6, bottom: 0.34,
  pieces: [
    // the nose, the cabin, the tail cone (upswept to the APU's exhaust)
    [[33, 1.45], [36, 1.45], [37.5, 1.6], [38.6, 2.0], [39.3, 2.6], [39.5, 3.15], [39.4, 3.6], [39.1, 4.1], [38.5, 4.6], [37.6, 5.0], [36.5, 5.2], [33, 5.21]],
    [[12.5, 1.45], [33, 1.45], [33, 5.21], [12.5, 5.21]],
    [[12.5, 1.45], [12.5, 5.21], [9.5, 5.21], [0.6, 4.55], [0, 4.3], [0.3, 4.05], [1.5, 3.7], [6, 2.5]],
    // the fin, the near engine, the wing's root, the tailplane
    [[9.0, 5.2], [3.2, 12.55], [1.6, 12.55], [0.5, 4.8]],
    [[27.7, 2.35], [27.75, 0.9], [27.4, 0.55], [25, 0.5], [23.6, 0.75], [23.0, 1.3], [23.1, 2.15], [24, 2.45], [26.5, 2.5]],
    [[16.8, 1.75], [24.5, 2.05], [23.5, 2.45], [16.5, 2.3]],
    [[5.4, 4.3], [0.2, 4.4], [0.2, 4.65], [4.8, 4.62]],
  ],
  whole: [3, 4, 6],
  wheels: [{ x: 20.0, r: 0.57, rim: STEEL_LT, hub: 20 }, { x: 35.6, r: 0.345, rim: STEEL_LT, hub: 12 }],
  seats: [[37.35, 3.2], [33.4, 3.0], [30.9, 3.0], [28.4, 3.0], [25.9, 3.0], [22.0, 3.0], [16.0, 3.0], [13.5, 3.0], [11.0, 3.0]],
  cabin: [9, 1.5, 38.5, 5.4],
  cg: [21.0, 2.9], engine: [24.2, 1.5], fuel: [20.5, 2.0],
};

export function b738Art(): PixelArt {
  const f = B738;
  const s = new Sheet(f);
  const P = LINER;
  // the far wing's winglet standing above the fuselage, behind it all
  s.poly([[14.9, 4.9], [14.1, 6.45], [13.7, 6.45], [14.0, 4.9]], BELLY[1]);
  // fuselage, fin, tailplane
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly([[12.0, 5.2], [9.0, 5.75], [8.6, 5.2]], NAVY[2]);
  s.poly(f.pieces[3], NAVY[2]);
  s.poly(f.pieces[6], BELLY[2]);
  // the belly fairing over the wing box, the near wing (swept and lifting to its winglet, in front of the fuselage)
  s.poly([[15.5, 1.45], [25.5, 1.45], [24.2, 1.2], [17.0, 1.2]], BELLY[2]);
  s.poly([[16.6, 1.7], [24.8, 2.0], [24.0, 2.45], [17.3, 3.1], [14.6, 4.05], [14.2, 3.95], [16.0, 1.95]], BELLY[1]);
  s.poly([[14.6, 4.05], [14.1, 4.0], [13.8, 6.45], [14.2, 6.45]], NAVY[1]);
  // the near engine on its pylon, the exhaust plug behind it
  s.poly([[22.0, 2.3], [25.8, 2.3], [26.0, 2.6], [22.6, 2.65]], BELLY[1]);
  s.poly(f.pieces[4], P[2]);
  s.poly([[23.1, 1.15], [22.2, 1.4], [23.1, 1.75]], NOZZLE[2]);
  s.rect(27.5, 0.65, 27.75, 2.25, STEEL_LT[2]);
  // gear legs and their doors
  leg(s, 20.0, 1.8, 20.0, 0.57, 0.28);
  leg(s, 35.6, 1.5, 35.6, 0.345, 0.2);
  s.rect(19.5, 1.25, 19.75, 1.9, BELLY[1]);
  // the cheatline under the windows, the belly
  s.over([[0, 1.0], [40, 1.0], [40, 2.15], [0, 2.15]], BELLY[2], (c) => c === P[2]);
  s.over([[0, 3.0], [40, 3.0], [40, 3.2], [0, 3.2]], NAVY[2], (c) => c === P[2]);
  s.over([[0, 2.7], [40, 2.7], [40, 2.8], [0, 2.8]], SKY_BLUE[2], (c) => c === P[2]);
  // the cockpit windows
  pane(s, [[37.1, 4.7], [38.05, 4.75], [38.7, 4.45], [38.55, 4.15], [37.15, 4.12]]);
  finish(s.a);
  // windows down the cabin (the overwing exits left out), doors fore and aft and the exits
  windowRow(s, 33.9, 8.4, 3.85, 0.508, 8, 11, [[19.1, 20.6]]);
  door(s, 35.2, 2.55, 36.1, 4.45, P[0]);
  door(s, 6.3, 2.75, 7.1, 4.45, P[0]);
  door(s, 19.2, 3.3, 19.75, 4.25, P[0]);
  door(s, 20.0, 3.3, 20.55, 4.25, P[0]);
  // panel lines, the fin's rudder, the engine's inlet lip and fan cowl seam, the wing's flap track fairings
  s.seam(33, 1.5, 33, 5.15, P[1]);
  s.seam(12.5, 1.5, 12.5, 5.15, P[1]);
  s.seam(1.9, 12.4, 0.75, 5.1, NAVY[0]);
  s.seam(25.9, 0.55, 25.9, 2.4, BELLY[0]);
  s.seam(27.45, 0.6, 27.45, 2.3, STEEL[1]);
  for (const x of [18.5, 21.0]) s.poly([[x, 1.85], [x + 0.6, 1.9], [x + 0.3, 1.55]], BELLY[0]);
  s.edge([[16.6, 1.7], [24.8, 2.0], [24.0, 2.45], [17.3, 3.1], [14.6, 4.05]], BELLY[0], false);
  // lights: the red beacon on the belly and the top, the landing light, the logo light on the tailplane
  s.set(20.5, 1.2, LED_RED).set(18.0, 5.25, LED_RED);
  s.rect(24.1, 1.95, 24.4, 2.05, LAMP);
  s.set(3.6, 4.65, 0xfff6d0);
  s.set(0.05, 4.3, GUNMETAL[0]);
  return s.a;
}

// ---------------------------------------------------------------- ATR 72-600

/** The ATR 72-600: a high-winged twin turboprop, 27.2 m long, its T-tail 7.65 m up. */
export const ATR72: Airframe = {
  len: 27.2, top: 7.7, bottom: 0.3,
  pieces: [
    [[21, 0.95], [25.0, 0.95], [26.3, 1.15], [27.0, 1.6], [27.2, 2.2], [26.9, 2.9], [26.3, 3.45], [25.3, 3.75], [24.2, 3.82], [21, 3.82]],
    [[9, 0.95], [21, 0.95], [21, 3.82], [9, 3.82]],
    [[9, 0.95], [9, 3.82], [7.5, 3.82], [0.3, 3.6], [0.1, 3.3], [3.0, 2.2]],
    [[6.2, 3.7], [2.7, 7.4], [1.1, 7.4], [0.35, 3.55]],
    // the near nacelle (under the wing, its front well ahead) and the wing's root
    [[18.4, 3.85], [18.5, 3.2], [17.6, 2.85], [12.0, 3.0], [11.0, 3.45], [11.4, 3.95]],
    [[12.0, 3.8], [15.0, 3.8], [14.9, 4.3], [12.4, 4.25]],
    [[3.4, 7.3], [0.4, 7.45], [0.5, 7.7], [3.0, 7.68]],
    // the main gear's sponson
    [[11.7, 0.6], [15.9, 0.6], [16.4, 1.1], [16.0, 1.6], [11.4, 1.6], [11.2, 1.1]],
  ],
  whole: [3, 4, 6],
  wheels: [{ x: 13.4, r: 0.42, rim: STEEL_LT, hub: 14 }, { x: 24.0, r: 0.3, rim: STEEL_LT, hub: 10 }],
  seats: [[25.15, 2.05], [22.0, 1.75], [19.6, 1.75], [17.2, 1.75], [14.8, 1.75], [12.4, 1.75], [10.0, 1.75]],
  cabin: [7, 0.9, 26.5, 4],
  cg: [14.25, 2.5], engine: [13.5, 3.4], fuel: [13.8, 4.0],
};

export function atr72Art(): PixelArt {
  const f = ATR72;
  const s = new Sheet(f);
  const P = LINER;
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly([[9.5, 3.8], [6.2, 4.3], [5.6, 3.75]], P[2]);
  s.poly(f.pieces[3], SKY_BLUE[2]);
  s.poly(f.pieces[6], P[2]);
  s.poly(f.pieces[7], BELLY[2]);
  // the wing on top, its fairing, the nacelle hung under it with the exhaust on its side
  s.poly([[11.4, 3.75], [16.6, 3.75], [16.0, 4.15], [12.0, 4.2]], P[2]);
  s.poly(f.pieces[5], P[1]);
  s.poly(f.pieces[4], P[2]);
  s.poly([[13.0, 3.15], [14.6, 3.1], [14.6, 3.35], [13.2, 3.35]], NOZZLE[2]);
  spinner(s, 18.95, 3.45, 0.42, 0.6, P);
  leg(s, 13.4, 0.9, 13.4, 0.42, 0.2);
  leg(s, 24.0, 1.0, 24.0, 0.3, 0.16);
  s.over([[0, 0.5], [30, 0.5], [30, 1.6], [0, 1.6]], BELLY[2], (c) => c === P[2]);
  s.over([[0, 2.15], [30, 2.15], [30, 2.3], [0, 2.3]], SKY_BLUE[2], (c) => c === P[2]);
  pane(s, [[24.6, 3.5], [25.55, 3.5], [26.3, 3.0], [24.75, 2.95]]);
  finish(s.a);
  windowRow(s, 22.2, 8.6, 2.6, 0.76, 8, 10);
  door(s, 2.9, 1.45, 3.75, 3.3, P[0]);
  door(s, 22.7, 1.2, 24.0, 3.2, P[0]);
  s.seam(5.9, 4.25, 1.0, 7.3, SKY_BLUE[0]);
  s.seam(17.6, 2.9, 17.6, 3.8, BELLY[0]);
  s.edge([[12.0, 3.8], [15.0, 3.8], [14.9, 4.3], [12.4, 4.25]], P[0]);
  s.set(13.7, 0.62, LED_RED).set(15.5, 4.2, LED_RED);
  s.rect(18.0, 3.0, 18.2, 3.1, LAMP);
  return s.a;
}

// ---------------------------------------------------------------- Cessna 172S

/** The Cessna 172S Skyhawk: a high-winged four-seater, 8.3 m long, 2.7 m to the top of its fin. */
export const C172: Airframe = {
  len: 8.3, top: 2.75, bottom: 0.19,
  pieces: [
    // the cowling (spinner and all), the cabin, the tail cone
    [[6.9, 0.75], [7.9, 0.85], [8.3, 1.15], [7.9, 1.45], [6.9, 1.6]],
    [[4.3, 0.65], [6.9, 0.7], [6.9, 1.6], [5.9, 1.98], [4.3, 1.98]],
    [[4.3, 0.65], [4.3, 1.98], [0.6, 1.3], [0.55, 1.0]],
    // the fin, the wing on the roof, the tailplane
    [[2.2, 1.45], [0.95, 2.72], [0.4, 2.72], [0.12, 1.15]],
    [[4.35, 1.95], [5.95, 1.95], [5.85, 2.18], [4.45, 2.14]],
    [[1.4, 1.15], [0.0, 1.17], [0.0, 1.3], [1.3, 1.3]],
  ],
  whole: [3, 4],
  wheels: [{ x: 5.4, r: 0.21, rim: STEEL_LT, hub: 7 }, { x: 7.25, r: 0.19, rim: STEEL_LT, hub: 6 }],
  seats: [[5.55, 0.98], [4.7, 1.0]],
  recline: [0.25, 0.25],
  cabin: [4.2, 0.6, 7.0, 2.2],
  cg: [5.72, 1.2], engine: [7.4, 1.2], fuel: [5.2, 2.05],
};

export function c172Art(): PixelArt {
  const f = C172;
  const s = new Sheet(f);
  const P = LINER;
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly([[3.6, 1.62], [2.1, 1.48], [2.2, 1.58]], P[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[5], P[2]).poly(f.pieces[4], P[2]);
  // the wing strut, the gear's spring legs and the nose leg
  s.line(5.25, 0.8, 4.85, 1.95, STEEL[1]);
  s.line(5.3, 0.8, 4.9, 1.95, STEEL[2]);
  leg(s, 5.25, 0.75, 5.4, 0.21, 0.08);
  leg(s, 7.15, 0.8, 7.25, 0.19, 0.07);
  spinner(s, 8.3, 1.15, 0.22, 0.32, STEEL_LT);
  // stripes down the side and up the fin
  s.over([[0, 1.0], [8.3, 1.13], [8.3, 1.22], [0, 1.09]], MAROON[2], (c) => c === P[2]);
  s.over([[0, 0.92], [8.3, 1.03], [8.3, 1.08], [0, 0.97]], GOLD[2], (c) => c === P[2]);
  s.over([[1.5, 2.05], [0.85, 2.72], [0.5, 2.72], [0.6, 2.4]], MAROON[2], (c) => c === P[2]);
  // the windscreen, the door's window, the rear window
  pane(s, [[6.85, 1.58], [5.95, 1.95], [5.85, 1.95], [5.9, 1.35]]);
  pane(s, [[5.0, 1.3], [5.85, 1.3], [5.85, 1.9], [5.0, 1.92]]);
  pane(s, [[4.35, 1.35], [4.9, 1.3], [4.9, 1.9], [4.4, 1.9]]);
  finish(s.a);
  door(s, 4.95, 0.7, 5.95, 1.95, P[0]);
  s.seam(6.9, 0.8, 6.9, 1.55, P[1]);
  s.seam(0.5, 2.55, 0.25, 1.35, P[1]);
  for (let x = 7.0; x < 7.9; x += 0.12) s.seam(x, 0.88, x, 0.95, GUNMETAL[1]);
  s.set(5.9, 2.15, LED_RED).set(0.1, 1.25, 0xfff6d0).set(0.8, 2.7, LED_RED);
  s.rect(5.95, 2.0, 6.05, 2.08, LAMP);
  return s.a;
}

// ---------------------------------------------------------------- Cirrus SR22

/** The Cirrus SR22: a low-winged composite four-seater with a parachute for the whole aircraft (CAPS), 7.9 m long. */
export const SR22: Airframe = {
  len: 7.95, top: 2.75, bottom: 0.2,
  pieces: [
    [[6.5, 0.95], [7.65, 1.05], [7.95, 1.32], [7.65, 1.6], [6.5, 1.68]],
    [[3.6, 0.85], [6.5, 0.9], [6.5, 1.68], [5.3, 1.98], [4.4, 1.98], [3.6, 1.82]],
    [[3.6, 0.85], [3.6, 1.82], [0.35, 1.47], [0.35, 1.2]],
    [[1.95, 1.55], [0.8, 2.72], [0.25, 2.72], [0.1, 1.3]],
    [[4.2, 0.72], [5.85, 0.78], [5.75, 1.0], [4.3, 0.98]],
    [[1.45, 1.3], [0.0, 1.35], [0.0, 1.47], [1.35, 1.45]],
  ],
  whole: [3, 4],
  wheels: [{ x: 5.0, r: 0.24, rim: STEEL_LT, hub: 8 }, { x: 7.0, r: 0.2, rim: STEEL_LT, hub: 6 }],
  seats: [[5.35, 1.15], [4.4, 1.15]],
  recline: [0.35, 0.3],
  cabin: [3.5, 0.8, 6.6, 2.1],
  cg: [5.45, 1.25], engine: [7.1, 1.3], fuel: [5.0, 0.85],
};

export function sr22Art(): PixelArt {
  const f = SR22;
  const s = new Sheet(f);
  const P = LINER;
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[5], P[2]);
  // the wing low under the cabin, the wheel spats over the mains and the nose leg
  s.poly(f.pieces[4], P[1]);
  s.poly([[4.65, 0.2], [5.4, 0.2], [5.45, 0.42], [5.0, 0.55], [4.6, 0.42]], P[2]);
  leg(s, 4.95, 0.75, 5.0, 0.45, 0.08);
  leg(s, 6.9, 0.95, 7.0, 0.2, 0.07);
  spinner(s, 7.95, 1.32, 0.24, 0.36, STEEL_LT);
  s.over([[0, 1.1], [8, 1.22], [8, 1.3], [0, 1.18]], SLATE[2], (c) => c === P[2]);
  s.over([[1.6, 1.9], [0.75, 2.72], [0.3, 2.72], [0.6, 2.3]], SLATE[2], (c) => c === P[2]);
  pane(s, [[6.45, 1.66], [5.35, 1.95], [5.25, 1.93], [5.35, 1.45]]);
  pane(s, [[4.25, 1.4], [5.25, 1.4], [5.25, 1.9], [4.45, 1.92], [4.25, 1.8]]);
  pane(s, [[3.7, 1.42], [4.15, 1.4], [4.15, 1.78], [3.75, 1.76]]);
  finish(s.a);
  door(s, 4.2, 0.95, 5.3, 1.95, P[0]);
  // the parachute's hatch behind the cabin (CAPS), its warning stripe
  s.edge([[3.0, 1.62], [3.5, 1.68], [3.5, 1.8], [3.0, 1.74]], RED[1]);
  s.seam(3.05, 1.6, 3.45, 1.66, RED[2]);
  s.seam(6.5, 0.98, 6.5, 1.62, P[1]);
  s.set(5.8, 0.98, LED_RED).set(0.1, 1.4, 0xfff6d0).set(0.65, 2.7, LED_RED);
  s.rect(5.85, 0.8, 5.95, 0.88, LAMP);
  return s.a;
}

// ---------------------------------------------------------------- F-16C Fighting Falcon

/** The F-16C: 15 m long, its fin 4.9 m up, a bubble canopy over the pilot's reclined seat and its intake under the nose. */
export const F16: Airframe = {
  len: 15.06, top: 4.9, bottom: 0.23,
  pieces: [
    [[11.0, 1.7], [13.0, 1.85], [14.3, 2.05], [15.06, 2.25], [14.3, 2.5], [13.0, 2.78], [11.0, 2.85]],
    [[4.0, 1.15], [11.0, 0.95], [11.3, 1.15], [11.0, 2.85], [9.6, 3.05], [4.0, 2.85]],
    [[4.0, 1.15], [4.0, 2.85], [1.2, 2.45], [0, 2.35], [0, 1.45], [1.2, 1.4]],
    [[5.5, 2.88], [2.6, 4.88], [1.6, 4.88], [1.2, 2.7]],
    [[12.2, 2.35], [8.6, 2.12], [2.5, 1.95], [2.4, 2.15], [8.0, 2.45]],
    [[3.2, 1.95], [0.2, 1.98], [0.2, 2.12], [2.9, 2.12]],
    // the canopy
    [[9.6, 2.8], [10.3, 3.2], [11.2, 3.38], [12.2, 3.25], [12.95, 2.8]],
  ],
  whole: [3, 5],
  wheels: [{ x: 6.1, r: 0.36, rim: STEEL_LT, hub: 12 }, { x: 11.05, r: 0.24, rim: STEEL_LT, hub: 8 }],
  seats: [[10.65, 2.45]],
  recline: [0.52],
  cabin: [9.5, 2.3, 13, 3.6],
  cg: [6.6, 2.05], engine: [1.5, 1.9], fuel: [7.5, 1.8],
};

export function f16Art(): PixelArt {
  const f = F16;
  const s = new Sheet(f);
  const P = VIPER;
  s.poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]).poly(f.pieces[0], RADOME[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[5], VIPER_DK[2]);
  // the ventral fins, the nozzle's petals, the wing and its strake, a missile on the wingtip rail
  s.poly([[3.6, 1.2], [4.6, 1.15], [4.0, 0.8], [3.3, 0.85]], VIPER_DK[2]);
  s.poly([[1.2, 1.38], [0, 1.45], [-0.05, 2.35], [1.2, 2.45]], NOZZLE[2]);
  s.poly(f.pieces[4], VIPER_DK[2]);
  s.rect(4.0, 2.0, 7.6, 2.12, WHITE[2]);
  s.poly([[7.6, 2.0], [7.9, 2.06], [7.6, 2.12]], WHITE[1]);
  s.poly([[4.0, 2.0], [4.3, 1.88], [4.3, 2.24], [4.0, 2.12]], WHITE[1]);
  // the intake's dark mouth, the gear legs (the nose leg on the intake, the mains under the wing)
  s.poly([[11.3, 1.15], [11.0, 0.95], [10.2, 1.0], [10.4, 1.3]], GUNMETAL[0]);
  leg(s, 6.1, 1.2, 6.1, 0.36, 0.14);
  leg(s, 10.9, 1.0, 11.05, 0.24, 0.11);
  pane(s, f.pieces[6]);
  finish(s.a);
  // panel lines, the gun's port on the strake, the pitot on the nose, the speed brakes at the tail
  s.seam(13.0, 1.9, 13.0, 2.75, RADOME[0]);
  s.seam(9.6, 2.82, 12.95, 2.8, GUNMETAL[1]);
  s.seam(5.5, 1.3, 5.5, 2.8, P[1]);
  s.seam(8.6, 1.1, 8.6, 2.8, P[1]);
  s.seam(1.9, 4.75, 1.3, 2.8, P[1]);
  s.rect(10.2, 2.45, 10.45, 2.55, GUNMETAL[0]);
  s.line(15.06, 2.25, 15.45, 2.25, STEEL[1]);
  s.seam(1.0, 2.4, 0.9, 1.5, P[0]);
  s.set(2.4, 4.85, LED_RED).set(9.0, 2.95, LED_RED);
  return s.a;
}

// ---------------------------------------------------------------- F-15EX Eagle II

const EAGLE = ramp('#7d878f', 0.85);
const EAGLE_DK = ramp('#5c656c', 0.9);

/** The F-15EX (0.5.1): a big two-seat twin-engined fighter, its boxy intakes beside the cockpit, two fins, two nozzles. */
export const F15EX: Airframe = {
  len: 19.45, top: 5.65, bottom: 0.27,
  pieces: [
    [[16.5, 1.75], [18.0, 1.95], [19.0, 2.15], [19.45, 2.3], [19.0, 2.5], [18.0, 2.75], [16.5, 2.95]],
    [[11.0, 1.2], [16.5, 1.75], [16.5, 2.95], [15.4, 3.2], [11.0, 3.0]],
    [[3.0, 1.3], [11.0, 1.2], [11.0, 3.0], [3.0, 2.85]],
    [[3.0, 1.3], [3.0, 2.85], [0.3, 2.75], [0.05, 2.6], [0.05, 1.5], [0.3, 1.4]],
    // the fins (one over the other), the wing, the stabilator, the canopy
    [[3.9, 2.8], [1.75, 5.65], [0.75, 5.65], [0.5, 2.7]],
    [[11.0, 2.25], [9.0, 2.1], [4.6, 1.95], [4.5, 2.15], [8.4, 2.45]],
    [[3.0, 1.9], [0.0, 1.95], [0.0, 2.12], [2.7, 2.12]],
    [[12.0, 3.0], [12.8, 3.45], [13.9, 3.62], [15.0, 3.45], [15.7, 3.12]],
  ],
  whole: [4, 6],
  wheels: [{ x: 7.9, r: 0.42, rim: STEEL_LT, hub: 13 }, { x: 14.6, r: 0.28, rim: STEEL_LT, hub: 9 }],
  seats: [[14.35, 2.62], [12.8, 2.7]],
  recline: [0.45, 0.45],
  cabin: [11.8, 2.4, 15.8, 3.9],
  cg: [8.4, 2.05], engine: [1.6, 2.0], fuel: [8.0, 2.0],
};

export function f15exArt(): PixelArt {
  const f = F15EX;
  const s = new Sheet(f);
  const P = EAGLE;
  // the far fin, a shade darker, behind the near one
  s.poly([[4.3, 2.8], [2.15, 5.5], [1.25, 5.5], [0.95, 2.7]], EAGLE_DK[1]);
  s.poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]).poly(f.pieces[3], P[2]).poly(f.pieces[0], RADOME[2]);
  s.poly(f.pieces[4], P[2]);
  // the boxy intake beside the cockpit and its dark mouth, the two nozzles one over the other
  s.poly([[10.4, 1.25], [12.9, 1.45], [12.9, 2.55], [10.4, 2.6]], EAGLE_DK[2]);
  s.poly([[12.9, 1.45], [12.6, 1.5], [12.6, 2.5], [12.9, 2.55]], GUNMETAL[0]);
  s.poly([[1.0, 1.42], [0.05, 1.55], [0.05, 2.02], [1.0, 2.08]], NOZZLE[2]);
  s.poly([[1.0, 2.12], [0.05, 2.18], [0.05, 2.62], [1.0, 2.72]], NOZZLE[1]);
  // the wing, the stabilator, the gear legs (the nose leg under the cockpit, the mains under the wing)
  s.poly(f.pieces[5], EAGLE_DK[2]);
  s.poly(f.pieces[6], EAGLE_DK[2]);
  leg(s, 7.9, 1.25, 7.9, 0.42, 0.16);
  leg(s, 14.45, 1.55, 14.6, 0.28, 0.12);
  pane(s, f.pieces[7]);
  finish(s.a);
  // panel lines, the canopy's frame between the seats, the gun's port at the wing root, the pitot,
  // the speed brake on the back, the tail's lights
  s.seam(16.5, 1.78, 16.5, 2.92, RADOME[0]);
  s.seam(12.0, 3.02, 15.7, 3.12, GUNMETAL[1]);
  s.seam(13.55, 3.0, 13.55, 3.58, GUNMETAL[1]);
  s.seam(6.0, 1.3, 6.0, 2.85, P[1]);
  s.seam(9.8, 1.25, 9.8, 2.95, P[1]);
  s.seam(3.0, 1.35, 3.0, 2.8, P[1]);
  s.seam(2.1, 5.55, 1.6, 2.9, P[1]);
  s.rect(10.0, 2.28, 10.3, 2.38, GUNMETAL[0]);
  s.seam(8.6, 2.98, 10.6, 3.0, P[0]);
  s.line(19.45, 2.3, 19.44, 2.3, STEEL[1]);
  s.set(1.75, 5.6, LED_RED).set(12.1, 3.1, LED_RED);
  return s.a;
}

// ---------------------------------------------------------------- A-10C Thunderbolt II

/** The A-10C: its two engines in pods high on the back, a straight wing, twin fins, and the GAU-8's barrels out of its nose. */
export const A10: Airframe = {
  len: 16.4, top: 4.5, bottom: 0.3,
  pieces: [
    [[12.0, 1.0], [14.0, 1.05], [16.0, 1.4], [16.3, 1.9], [16.0, 2.4], [15.0, 2.68], [12.0, 2.78]],
    [[4.0, 1.25], [12.0, 1.0], [12.0, 2.78], [4.0, 2.4]],
    [[4.0, 1.25], [4.0, 2.4], [0.5, 2.15], [0.3, 1.9], [0.5, 1.75]],
    // the far and near fins (one over the other), the near engine pod, the wing, the tailplane
    [[2.7, 1.55], [2.3, 4.25], [1.9, 4.47], [0.7, 4.47], [0.3, 4.2], [0.15, 1.7], [0.6, 1.45], [2.2, 1.4]],
    [[8.6, 3.1], [8.4, 3.65], [7.8, 3.78], [4.8, 3.7], [4.5, 3.1], [4.8, 2.5], [7.8, 2.42], [8.4, 2.55]],
    [[6.6, 1.25], [9.7, 1.25], [9.6, 1.7], [6.8, 1.65]],
    [[2.9, 2.15], [0.0, 2.15], [0.0, 2.35], [2.8, 2.35]],
    // the wheel pods under the wing
    [[8.1, 0.95], [10.5, 0.95], [10.6, 1.35], [8.2, 1.4]],
  ],
  whole: [3, 4, 5],
  wheels: [{ x: 8.85, r: 0.45, rim: STEEL_LT, hub: 14 }, { x: 14.2, r: 0.31, rim: STEEL_LT, hub: 10 }],
  seats: [[13.45, 2.2]],
  recline: [0.3],
  cabin: [12.2, 2.0, 15.2, 3.4],
  cg: [9.25, 2.0], engine: [5.0, 3.1], fuel: [8.0, 2.0],
};

export function a10Art(): PixelArt {
  const f = A10;
  const s = new Sheet(f);
  const P = HOG;
  s.poly(f.pieces[6], P[2]);
  s.poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]).poly(f.pieces[0], P[2]);
  s.poly(f.pieces[3], P[2]);
  // the engine's pylon and pod, its intake and exhaust
  s.poly([[6.0, 2.4], [7.4, 2.4], [7.2, 2.7], [6.2, 2.7]], P[1]);
  s.poly(f.pieces[4], P[2]);
  s.rect(8.35, 2.6, 8.62, 3.6, GUNMETAL[1]);
  s.poly([[4.5, 2.65], [4.15, 2.75], [4.15, 3.45], [4.5, 3.55]], NOZZLE[2]);
  // the wing, the gear pods, the canopy and its frame, the gun's barrels
  s.poly(f.pieces[5], P[1]);
  s.poly(f.pieces[7], P[2]);
  leg(s, 8.85, 1.0, 8.85, 0.45, 0.16);
  leg(s, 14.2, 1.1, 14.2, 0.31, 0.12);
  s.rect(15.8, 1.42, 16.6, 1.58, GUNMETAL[1]);
  pane(s, [[12.3, 2.75], [12.8, 3.15], [13.8, 3.3], [14.6, 3.15], [15.1, 2.72]]);
  finish(s.a);
  // a shark's mouth on the nose (as many wear), panel lines, the refuelling door, the armour bathtub's line
  s.poly([[16.25, 1.75], [15.0, 1.55], [14.6, 1.7], [15.0, 1.85], [16.25, 1.95]], 0x8a1f1f);
  for (let x = 14.8; x < 16.2; x += 0.14) s.seam(x, 1.6, x + 0.07, 1.75, 0xece6da).seam(x + 0.07, 1.9, x + 0.14, 1.8, 0xece6da);
  s.seam(12.0, 1.05, 12.0, 2.7, P[1]);
  s.seam(14.6, 3.1, 14.6, 2.75, GUNMETAL[1]);
  s.seam(12.2, 2.7, 15.1, 2.7, GUNMETAL[1]);
  s.seam(12.2, 1.9, 15.4, 1.95, P[1]);
  s.seam(1.3, 4.4, 0.6, 1.6, P[0]);
  s.rect(13.6, 1.25, 13.8, 1.35, GUNMETAL[0]);
  s.set(1.3, 4.45, LED_RED).set(9.3, 1.68, LED_GREEN);
  return s.a;
}

// ---------------------------------------------------------------- UH-60 Black Hawk

/** The UH-60 Black Hawk: its cabin 15.3 m nose to tail, the main rotor's hub 3.95 m up (the rotors are their own: see blades). */
export const UH60: Airframe = {
  len: 15.3, top: 4.7, bottom: 0.2,
  pieces: [
    [[11.0, 0.7], [13.5, 0.7], [15.0, 0.95], [15.3, 1.55], [14.6, 2.25], [13.4, 2.85], [11.0, 2.95]],
    [[7.0, 0.95], [11.0, 0.7], [11.0, 3.45], [7.4, 3.3], [7.0, 2.7]],
    [[7.0, 0.95], [7.0, 2.7], [1.8, 2.25], [1.8, 1.7]],
    // the tail pylon, the stabilator, the engines' hump and the rotor's mast
    [[2.2, 1.7], [1.8, 2.3], [1.0, 4.6], [0.3, 4.6], [0.0, 2.4], [0.4, 1.6]],
    [[1.5, 1.85], [0.0, 1.85], [0.0, 2.05], [1.4, 2.05]],
    [[11.6, 2.9], [11.2, 3.45], [9.6, 3.6], [7.6, 3.35], [7.4, 2.9]],
  ],
  whole: [3, 4],
  wheels: [{ x: 12.0, r: 0.38, rim: STEEL, hub: 12 }, { x: 1.2, r: 0.2, rim: STEEL, hub: 7 }],
  seats: [[13.7, 1.25], [12.85, 1.3], [10.4, 1.15], [9.5, 1.15], [8.6, 1.15]],
  recline: [0.15, 0.15, 0.05, 0.05, 0.05],
  cabin: [8.0, 0.7, 14.8, 2.9],
  cg: [10.2, 1.9], engine: [9.0, 3.3], fuel: [7.5, 1.4],
};

/** Where the main and tail rotors turn (m) and how far they reach. */
export const UH60_ROTOR = { hub: [10.2, 3.95] as Pt, r: 8.18, tail: [0.75, 3.6] as Pt, tailR: 1.67 };

export function uh60Art(): PixelArt {
  const f = UH60;
  const s = new Sheet(f);
  const P = DRAB;
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[4], P[1]).poly(f.pieces[5], P[2]);
  // the rotor's mast and hub, the exhausts, the main gear's struts and the tail wheel's
  s.rect(10.05, 3.4, 10.35, 3.9, GUNMETAL[2]);
  s.rect(9.7, 3.85, 10.7, 4.05, STEEL[2]);
  s.poly([[7.6, 3.1], [7.0, 3.0], [7.0, 3.25], [7.5, 3.3]], NOZZLE[2]);
  s.line(12.5, 1.1, 12.0, 0.38, STEEL[1]);
  leg(s, 12.6, 1.0, 12.0, 0.38, 0.12);
  leg(s, 1.4, 1.75, 1.2, 0.2, 0.1);
  // the windows: the windscreen, the cockpit's door, the gunner's window, the cabin's sliding door
  pane(s, [[14.55, 2.25], [13.45, 2.82], [13.3, 2.75], [13.4, 2.0]]);
  pane(s, [[12.6, 1.6], [13.35, 1.6], [13.35, 2.65], [12.6, 2.7]]);
  pane(s, [[11.4, 1.7], [12.4, 1.7], [12.4, 2.55], [11.4, 2.6]]);
  pane(s, [[9.3, 1.8], [10.6, 1.8], [10.6, 2.45], [9.3, 2.45]]);
  pane(s, [[13.6, 0.85], [14.4, 0.95], [14.6, 1.4], [13.8, 1.5]]);
  finish(s.a);
  door(s, 8.3, 0.85, 11.0, 2.6, P[0]);
  door(s, 12.5, 0.9, 13.4, 2.75, P[0]);
  s.seam(7.0, 1.0, 7.0, 2.65, P[1]);
  s.seam(11.0, 0.75, 11.0, 2.9, P[1]);
  // the stencilled star, a red light on the tail
  s.ellipse(4.3, 2.0, 0.22, 0.22, 0x1f231d).set(4.3, 2.0, 0x6a705e);
  s.set(0.6, 4.55, LED_RED).set(9.0, 0.75, LED_RED);
  return s.a;
}

// ---------------------------------------------------------------- V-22 Osprey

/** The V-22 Osprey: 17.5 m long, a high wing, and at its tip a nacelle that turns its rotor up for hovering and forward to fly as a plane. */
export const V22: Airframe = {
  len: 17.5, top: 5.45, bottom: 0.3,
  pieces: [
    [[14.0, 0.7], [15.5, 0.85], [17.0, 1.7], [17.5, 2.4], [16.5, 3.4], [15.2, 3.95], [14.0, 3.95]],
    [[5.0, 0.7], [14.0, 0.7], [14.0, 3.95], [5.0, 3.95]],
    [[5.0, 0.7], [5.0, 3.95], [0.2, 3.6], [1.5, 2.6]],
    // the H-tail's fins (one over the other) and tailplane, the wing on the roof, the sponson
    [[2.8, 3.3], [1.9, 5.4], [0.5, 5.4], [0.0, 3.4], [0.6, 2.9]],
    [[3.0, 3.45], [0.0, 3.5], [0.0, 3.7], [2.8, 3.65]],
    [[8.0, 3.9], [10.6, 3.9], [10.5, 4.45], [8.3, 4.4]],
    [[7.5, 0.45], [11.5, 0.45], [12.0, 0.9], [11.6, 1.45], [7.2, 1.45], [7.0, 0.9]],
  ],
  whole: [3, 4],
  wheels: [{ x: 9.0, r: 0.45, rim: STEEL, hub: 14 }, { x: 15.2, r: 0.3, rim: STEEL, hub: 10 }],
  seats: [[15.9, 1.5], [13.3, 1.2], [12.2, 1.2], [11.1, 1.2], [8.0, 1.2], [6.9, 1.2]],
  recline: [0.15, 0.05, 0.05, 0.05, 0.05, 0.05],
  cabin: [5.5, 0.7, 16.8, 3.9],
  cg: [9.4, 2.4], engine: [9.4, 4.5], fuel: [9.3, 4.1],
};

/** Where the nacelle turns on the wingtip (m), and how far ahead of that its rotor's hub is. */
export const V22_ROTOR = { pivot: [9.4, 4.45] as Pt, arm: 2.25, r: 5.79 };

export function v22Art(): PixelArt {
  const f = V22;
  const s = new Sheet(f);
  const P = OSPREY_GREY;
  s.poly(f.pieces[4], P[1]);
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[6], P[2]).poly(f.pieces[5], P[1]);
  s.poly([[13.0, 3.9], [7.0, 3.9], [7.6, 4.3], [12.3, 4.3]], P[2]);
  leg(s, 9.0, 0.6, 9.0, 0.45, 0.16);
  leg(s, 15.2, 0.85, 15.2, 0.3, 0.12);
  // the refuelling probe along the nose, the windows
  s.line(15.0, 3.75, 17.9, 3.25, STEEL[1]);
  pane(s, [[16.45, 3.35], [15.25, 3.9], [15.05, 3.85], [15.2, 2.75], [16.1, 2.6]]);
  pane(s, [[13.6, 2.4], [14.4, 2.4], [14.4, 3.0], [13.6, 3.0]]);
  for (const x of [12.4, 11.0, 9.6, 8.2, 6.8]) pane(s, [[x, 2.6], [x + 0.5, 2.6], [x + 0.5, 3.0], [x, 3.0]]);
  finish(s.a);
  door(s, 13.5, 0.8, 14.5, 2.3, P[0]);
  s.seam(1.5, 2.65, 4.8, 0.75, P[0]);
  s.seam(14.0, 0.75, 14.0, 3.9, P[1]);
  s.seam(5.0, 0.75, 5.0, 3.9, P[1]);
  s.seam(1.6, 5.3, 0.4, 3.0, P[0]);
  s.set(1.2, 5.35, LED_RED).set(9.5, 0.5, LED_RED);
  return s.a;
}

/** The V-22's nacelle side on, pointing right (its pivot at its left end): engine, gearbox and spinner. */
export function v22NacelleArt(): PixelArt {
  const a = new PixelArt(Math.round(3.3 * PPM), Math.round(1.25 * PPM));
  const P = OSPREY_GREY;
  const h = a.h;
  a.poly([[0, 6], [a.w - 22, 0], [a.w - 8, 3], [a.w - 1, h / 2], [a.w - 8, h - 3], [a.w - 22, h - 1], [0, h - 6]], P[2]);
  a.poly([[a.w - 12, 4], [a.w - 1, h / 2], [a.w - 12, h - 4]], STEEL_LT[2]);
  a.rect(2, h / 2 - 4, 10, 8, NOZZLE[2]);
  finish(a);
  a.vline(a.w - 24, 2, h - 3, P[1]);
  a.vline(a.w - 12, 4, h - 5, STEEL[1]);
  return a;
}

// ---------------------------------------------------------------- Schleicher ASK 21

/** The Schleicher ASK 21: a two-seat training glider, 8.35 m long, its T-tail 1.55 m up, on a nose wheel, a main wheel and a tail wheel. */
export const ASK21: Airframe = {
  len: 8.35, top: 1.6, bottom: 0.08,
  pieces: [
    [[5.6, 0.35], [7.2, 0.38], [8.0, 0.52], [8.35, 0.75], [8.1, 0.98], [7.3, 1.05], [5.6, 1.05]],
    [[4.3, 0.36], [5.6, 0.35], [5.6, 1.05], [4.3, 0.98]],
    [[4.3, 0.36], [4.3, 0.98], [0.4, 0.92], [0.3, 0.66]],
    [[1.55, 0.88], [0.8, 1.5], [0.5, 1.5], [0.4, 0.72]],
    [[1.0, 1.47], [0.0, 1.5], [0.0, 1.58], [0.9, 1.58]],
    [[4.15, 0.76], [5.4, 0.8], [5.3, 0.92], [4.2, 0.9]],
  ],
  whole: [3, 4],
  wheels: [{ x: 4.75, r: 0.18, rim: STEEL_LT, hub: 6 }, { x: 7.15, r: 0.12, rim: STEEL_LT, hub: 4 }, { x: 0.45, r: 0.08, rim: STEEL_LT, hub: 3 }],
  seats: [[6.5, 0.55], [5.45, 0.62]],
  recline: [0.75, 0.6],
  cabin: [5.0, 0.3, 7.6, 1.3],
  cg: [4.95, 0.75], engine: [4.8, 0.7], fuel: [4.7, 0.7],
};

export function ask21Art(): PixelArt {
  const f = ASK21;
  const s = new Sheet(f);
  const P = GLIDER;
  s.poly(f.pieces[0], P[2]).poly(f.pieces[1], P[2]).poly(f.pieces[2], P[2]);
  s.poly(f.pieces[3], P[2]).poly(f.pieces[4], P[2]).poly(f.pieces[5], P[1]);
  leg(s, 4.75, 0.38, 4.75, 0.18, 0.08, GUNMETAL);
  leg(s, 7.15, 0.4, 7.15, 0.12, 0.06, GUNMETAL);
  pane(s, [[7.6, 1.02], [7.0, 1.2], [5.6, 1.25], [5.1, 1.05], [5.2, 0.98]]);
  finish(s.a);
  s.over([[7.9, 0.5], [8.4, 0.5], [8.4, 1.0], [7.9, 1.0]], RED[2], (c) => c === P[2] || c === P[3] || c === P[1]);
  s.over([[0.9, 1.15], [0.8, 1.5], [0.5, 1.5], [0.5, 1.15]], RED[2], (c) => c === P[2] || c === P[3] || c === P[1]);
  s.seam(5.6, 1.04, 5.6, 0.4, P[1]);
  s.set(8.2, 0.65, GUNMETAL[0]);
  return s.a;
}

// ---------------------------------------------------------------- Cameron O-105 hot-air balloon

/** The basket of a Cameron O-105: wicker, 1.3 m across, with the burner over it on its frame (the envelope is its own: see balloonEnvelopeArt()). */
export const O105: Airframe = {
  len: 1.4, top: 2.75, bottom: 0,
  pieces: [
    [[0.05, 0], [1.35, 0], [1.35, 1.1], [0.05, 1.1]],
    [[0.3, 2.35], [1.1, 2.35], [1.05, 2.75], [0.35, 2.75]],
  ],
  whole: [1],
  wheels: [],
  seats: [[0.95, 0.75], [0.45, 0.75]],
  recline: [0, 0],
  cabin: [0, 0, 1.4, 2.0],
  cg: [0.7, 0.5], engine: [0.7, 2.55], fuel: [0.7, 0.4],
};

/** The burner's flame, and where the envelope's lines meet the frame (m). */
export const O105_BURNER: Pt = [0.7, 2.8];

export function o105Art(): PixelArt {
  const f = O105;
  const s = new Sheet(f);
  // the flexi poles up to the burner frame, the burner block
  s.rect(0.12, 1.0, 0.2, 2.45, LEATHER[1]);
  s.rect(1.2, 1.0, 1.28, 2.45, LEATHER[1]);
  s.rect(0.1, 2.35, 1.3, 2.45, STEEL[2]);
  s.poly(f.pieces[1], STEEL_LT[2]);
  s.rect(0.5, 2.25, 0.9, 2.35, GUNMETAL[2]);
  // the basket, leather-trimmed rim and base
  s.poly(f.pieces[0], WICKER[2]);
  s.rect(0.02, 1.0, 1.38, 1.12, LEATHER[2]);
  s.rect(0.05, 0, 1.35, 0.08, LEATHER[1]);
  finish(s.a);
  for (let y = 0.15; y < 1.0; y += 0.07) s.seam(0.1, y, 1.3, y, WOOD_DARK[2]);
  for (let x = 0.15; x < 1.35; x += 0.16) s.seam(x, 0.1, x, 0.98, WICKER[1]);
  s.seam(0.45, 2.7, 0.45, 2.4, GUNMETAL[1]).seam(0.95, 2.7, 0.95, 2.4, GUNMETAL[1]);
  return s.a;
}

/** Envelope: 2,975 m³, 17.5 m across and 19 m from its crown to its mouth (m). */
export const ENVELOPE = { w: 17.5, h: 19.0, mouth: 3.4 };

/** A hot-air balloon's envelope, side on: gores of colour from crown to mouth, the scoop round the mouth. */
export function balloonEnvelopeArt(): PixelArt {
  const W = Math.round(ENVELOPE.w * PPM);
  const H = Math.round(ENVELOPE.h * PPM);
  const a = new PixelArt(W, H);
  const R = W / 2;
  const cx = W / 2;
  const cy = R;
  const mouth = (ENVELOPE.mouth * PPM) / 2;
  const gores = [RED, YELLOW, BLUE_PAINT, YELLOW, RED, ORANGE, WHITE, ORANGE];
  for (let y = 0; y < H; y++) {
    // round above its equator, tapering in a curve to the mouth below it
    let half: number;
    if (y <= cy) half = Math.sqrt(Math.max(0, R * R - (cy - y) * (cy - y)));
    else {
      const t = (y - cy) / (H - cy);
      half = mouth + (R - mouth) * Math.cos((t * Math.PI) / 2) ** 1.4;
    }
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
      // the gores bulge round the envelope: their seams bunch toward its sides
      const u = Math.asin(Math.max(-1, Math.min(1, (x - cx) / Math.max(1, half))));
      const g = gores[Math.floor(((u / Math.PI + 0.5) * gores.length * 1.5) % gores.length)];
      const band = y > H * 0.45 && y < H * 0.52 ? WHITE : g;
      a.set(x, y, band[2]);
    }
  }
  finish(a);
  // load tapes down the seams, the parachute vent's ring at the crown
  for (let k = -4; k <= 4; k++) {
    for (let y = 2; y < H - 2; y++) {
      const half = y <= cy ? Math.sqrt(Math.max(0, R * R - (cy - y) * (cy - y))) : mouth + (R - mouth) * Math.cos((((y - cy) / (H - cy)) * Math.PI) / 2) ** 1.4;
      const x = Math.round(cx + Math.sin((k / 5) * (Math.PI / 2)) * half);
      if (a.filled(x, y) && y % 2 === 0) a.set(x, y, 0x4a2a20);
    }
  }
  a.hline(Math.round(cx - R * 0.25), Math.round(cx + R * 0.25), 3, 0x4a2a20);
  // the mouth's skirt
  for (let y = H - 14; y < H; y++) for (let x = 0; x < W; x++) if (a.filled(x, y)) a.set(x, y, (x + y) % 3 ? GUNMETAL[2] : GUNMETAL[1]);
  return a;
}

// ---------------------------------------------------------------- powered parachute

/** A two-seat powered parachute's cart, after the Buckeye Dream Machine: a tube frame on three wheels, a pusher prop in a cage behind. */
export const PPC: Airframe = {
  len: 3.3, top: 2.25, bottom: 0.25,
  pieces: [
    [[0.75, 0.4], [3.1, 0.4], [3.3, 0.6], [3.1, 1.1], [0.75, 1.1]],
    [[0.25, 0.5], [0.85, 0.5], [0.85, 2.2], [0.25, 2.2]],
    [[1.5, 1.05], [1.9, 1.05], [1.85, 2.25], [1.55, 2.25]],
  ],
  whole: [1],
  wheels: [{ x: 1.0, r: 0.25, rim: GUNMETAL, hub: 8 }, { x: 2.95, r: 0.22, rim: GUNMETAL, hub: 7 }],
  seats: [[2.45, 0.85], [1.75, 0.95]],
  recline: [0.15, 0.1],
  cabin: [1.2, 0.3, 3.1, 1.8],
  cg: [1.75, 0.9], engine: [0.65, 1.2], fuel: [1.2, 0.6],
};

/** Where the canopy's lines meet the cart (m), and where its prop turns. */
export const PPC_HANG: Pt = [1.7, 2.2];
export const PPC_PROP = { at: [0.15, 1.4] as Pt, r: 0.86 };

export function ppcArt(): PixelArt {
  const f = PPC;
  const s = new Sheet(f);
  // the cage round the prop, the frame, the mast up to the hang point
  s.edge([[0.2, 0.55], [0.2, 2.2], [0.9, 2.2], [0.9, 0.55]], TUBE[1]);
  for (const x of [0.2, 0.9]) s.rect(x - 0.03, 0.5, x + 0.03, 2.22, TUBE[2]);
  s.rect(0.2, 2.17, 0.9, 2.23, TUBE[2]);
  s.rect(1.65, 1.0, 1.75, 2.22, TUBE[2]);
  s.rect(1.55, 2.12, 1.85, 2.25, STEEL[2]);
  // the frame's rails, the seats, the engine and its tank
  s.poly(f.pieces[0], TUBE[2]);
  s.rect(0.85, 1.0, 1.35, 1.55, GUNMETAL[2]);
  s.rect(1.1, 0.45, 1.6, 0.75, 0xd8d0c0);
  s.poly([[2.0, 0.85], [2.75, 0.85], [2.6, 1.15], [2.1, 1.5], [1.95, 1.4]], LEATHER[2]);
  s.poly([[1.35, 0.95], [1.95, 0.95], [1.9, 1.2], [1.5, 1.6], [1.35, 1.5]], LEATHER[2]);
  leg(s, 1.0, 0.45, 1.0, 0.25, 0.06, GUNMETAL);
  leg(s, 2.95, 0.45, 2.95, 0.22, 0.06, GUNMETAL);
  finish(s.a);
  s.seam(0.8, 0.42, 3.15, 0.42, TUBE[0]);
  s.seam(0.8, 1.08, 3.0, 1.08, TUBE[0]);
  s.set(3.25, 0.6, LAMP);
  return s.a;
}

/** A ram-air canopy side on (its span is into the screen): 4.2 m of aerofoil, its cells' mouths at the front. */
export const CANOPY = { chord: 4.2, thick: 0.6 };

export function ppcCanopyArt(): PixelArt {
  const W = Math.round(CANOPY.chord * PPM);
  const H = Math.round(CANOPY.thick * PPM) + 4;
  const a = new PixelArt(W, H);
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    // a thick aerofoil: the leading edge at the right, its top curved, its bottom flat
    const top = H - 2 - (H - 3) * Math.sqrt(Math.max(0, 1 - ((t - 0.72) / 0.72) ** 2));
    const bot = H - 2 - (t > 0.9 ? (H - 4) * ((t - 0.9) / 0.1) * 0.5 : 0);
    for (let y = Math.floor(top); y <= bot; y++) a.set(x, y, (Math.floor(t * 9) % 2 ? YELLOW : RED)[2]);
  }
  finish(a);
  // the cells' open mouths at the leading edge
  for (let y = 4; y < H - 3; y++) a.set(W - 2, y, RED[0]);
  return a;
}

// ---------------------------------------------------------------- weight-shift trike

/** A weight-shift trike's carriage, after the Air Creation Tanarg 912: a pod on three wheels, two seats in tandem, the mast up to the wing's hang point, a pusher prop. */
export const TRIKE: Airframe = {
  len: 3.0, top: 2.95, bottom: 0.25,
  pieces: [
    [[0.55, 0.45], [2.4, 0.4], [2.95, 0.75], [2.8, 1.25], [2.2, 1.35], [0.55, 1.3]],
    [[1.3, 1.25], [1.6, 1.25], [1.55, 2.95], [1.4, 2.95]],
  ],
  whole: [1],
  wheels: [{ x: 0.8, r: 0.25, rim: GUNMETAL, hub: 8 }, { x: 2.55, r: 0.22, rim: GUNMETAL, hub: 7 }],
  seats: [[2.1, 0.95], [1.45, 1.1]],
  recline: [0.2, 0.15],
  cabin: [1.0, 0.3, 2.9, 1.8],
  cg: [1.55, 0.95], engine: [0.65, 1.0], fuel: [1.2, 0.6],
};

/** Its hang point (m), and its prop. */
export const TRIKE_HANG: Pt = [1.47, 2.92];
export const TRIKE_PROP = { at: [0.15, 1.05] as Pt, r: 0.87 };

export function trikeArt(): PixelArt {
  const f = TRIKE;
  const s = new Sheet(f);
  s.poly([[1.35, 1.2], [1.6, 1.2], [1.52, 2.95], [1.42, 2.95]], TUBE[2]);
  s.poly([[2.2, 1.3], [1.6, 1.3], [1.55, 1.9]], TUBE[1]);
  s.poly(f.pieces[0], POD[2]);
  s.rect(0.45, 0.75, 0.9, 1.25, GUNMETAL[2]);
  leg(s, 0.8, 0.5, 0.8, 0.25, 0.06, GUNMETAL);
  leg(s, 2.55, 0.45, 2.55, 0.22, 0.06, GUNMETAL);
  pane(s, [[2.8, 1.25], [2.45, 1.6], [2.3, 1.55], [2.5, 1.25]]);
  finish(s.a);
  s.over([[0.5, 0.75], [3.0, 0.8], [3.0, 0.88], [0.5, 0.83]], SKY_BLUE[2], (c) => POD.includes(c));
  s.seam(2.3, 0.45, 2.3, 1.3, POD[1]);
  s.set(2.9, 0.75, LAMP);
  return s.a;
}

/** The trike's wing side on: its keel and sail swept back from the nose, the control bar's A-frame hanging down to the pilot (its pivot at the hang point). */
export const TRIKE_WING = { w: 4.6, h: 2.1, hang: [2.65, 0.25] as Pt };

export function trikeWingArt(): PixelArt {
  const W = Math.round(TRIKE_WING.w * PPM);
  const H = Math.round(TRIKE_WING.h * PPM);
  const a = new PixelArt(W, H);
  const s = (x: number, y: number): Pt => [x * PPM, y * PPM];
  // the sail seen from the side: the root's aerofoil and the swept wing behind it, low tips
  a.poly([s(4.6, 0.2), s(4.2, 0.08), s(2.6, 0.02), s(0.0, 0.2), s(0.3, 0.42), s(2.4, 0.32), s(4.3, 0.33)], SKY_BLUE[2]);
  a.poly([s(2.4, 0.2), s(0.8, 0.3), s(1.4, 0.42), s(2.6, 0.32)], WHITE[2]);
  // the A-frame: two uprights down from the hang point to the base bar
  a.line(Math.round(2.65 * PPM), Math.round(0.3 * PPM), Math.round(3.4 * PPM), Math.round(2.05 * PPM), GUNMETAL[2]);
  a.line(Math.round(2.6 * PPM), Math.round(0.3 * PPM), Math.round(2.0 * PPM), Math.round(2.05 * PPM), GUNMETAL[1]);
  a.hline(Math.round(1.95 * PPM), Math.round(3.45 * PPM), Math.round(2.05 * PPM), STEEL[2]);
  finish(a, { shadow: false });
  return a;
}

// ---------------------------------------------------------------- props and rotors (drawn over the airframe)

/**
 * A propeller side on, `r` m from hub to tip: frame 0 to 3 its blades as they turn (seen
 * end on, longer and shorter), 4 a blur as it spins (faint, dithered: it's seen through).
 */
export const propArt = cached<string>((key) => {
  const [r, frame] = key.split(':').map(Number);
  const L = Math.max(4, Math.round(r * 2 * PPM));
  const a = new PixelArt(4, L);
  if (frame === 4) {
    for (let y = 0; y < L; y++) if (y % 3 !== 1) a.set(1 + (y % 2), y, y % 2 ? 0x5e646a : 0x7c838a);
    return a;
  }
  const k = [1, 0.55, 0.15, 0.6][frame];
  const half = Math.round((L / 2) * k);
  a.rect(1, Math.round(L / 2 - half), 2, Math.max(2, half * 2), GUNMETAL[1]);
  a.set(1, Math.round(L / 2 - half), GUNMETAL[3]).set(2, Math.round(L / 2 + half - 1), GUNMETAL[3]);
  return a;
});

/** A main rotor side on, `r` m from hub to tip: its blades (0 to 3) or their blur (4). */
export const bladesArt = cached<string>((key) => {
  const [r, frame] = key.split(':').map(Number);
  const L = Math.round(r * 2 * PPM);
  const a = new PixelArt(L, 4);
  if (frame === 4) {
    for (let x = 0; x < L; x++) if (x % 4 !== 2) a.set(x, 1 + (x % 2), x % 2 ? 0x585e64 : 0x767d84);
    return a;
  }
  const half = Math.round((L / 2) * [1, 0.7, 0.2, 0.7][frame]);
  a.rect(Math.round(L / 2 - half), 1, half * 2, 2, GUNMETAL[1]);
  return a;
});

/** A tail rotor face on, `r` m round: its blades at an angle (0 to 3) or the blurred disc (4). */
export const discArt = cached<string>((key) => {
  const [r, frame] = key.split(':').map(Number);
  const D = Math.round(r * 2 * PPM) | 1;
  const a = new PixelArt(D, D);
  const c = (D - 1) / 2;
  if (frame === 4) {
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= c && (x + y) % 3 === 0) a.set(x, y, d > c - 1.5 ? 0x7c838a : 0x5e646a);
    }
  } else {
    const t = (frame / 4) * Math.PI;
    for (const s of [0, Math.PI / 2]) {
      const dx = Math.cos(t + s) * c;
      const dy = Math.sin(t + s) * c;
      a.line(Math.round(c - dx), Math.round(c - dy), Math.round(c + dx), Math.round(c + dy), GUNMETAL[1]);
    }
  }
  a.set(Math.round(c), Math.round(c), STEEL_LT[3]);
  return a;
});

/** An aircraft's wheel (tyre and hub), `r` m round. */
export const wheelArt = cached<string>((key) => {
  const [r, hub, rim] = key.split(':');
  const d = Math.max(5, Math.round(Number(r) * 2 * PPM));
  return tyreArt(d, Math.min(d - 2, Number(hub)), rim === 'g' ? GUNMETAL : rim === 's' ? STEEL : STEEL_LT);
});

/** The wheelArt() key of one of a design's wheels. */
export function wheelKey(w: Airframe['wheels'][number]): string {
  return `${w.r}:${w.hub ?? Math.round(w.r * 40)}:${w.rim === GUNMETAL ? 'g' : w.rim === STEEL ? 's' : 'l'}`;
}

/** An art turned a quarter turn anticlockwise (its left end at the bottom): a tiltrotor's nacelle stood up. */
export function upright(src: PixelArt): PixelArt {
  const a = new PixelArt(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = src.get(x, y);
    if (c !== CLEAR) a.set(y, src.w - 1 - x, c);
  }
  return a;
}

// ---------------------------------------------------------------- the warbirds (0.5.0)

/**
 * A taildragger laid out level, as it flies (x from its tail, y up, the fuselage's datum
 * along x), with its main wheels' and tailwheel's centres where they hang in flight.
 */
export interface LevelFrame {
  pieces: Pt[][];
  whole: number[];
  main: { x: number; y: number; r: number; rim?: Ramp; hub?: number };
  tail: { x: number; y: number; r: number; rim?: Ramp; hub?: number };
  seats: Pt[];
  recline?: number[];
  cabin: [number, number, number, number];
  cg: Pt;
  engine: Pt;
  fuel: Pt;
}

/** A taildragger set down on its wheels: as it stands (an Airframe), the angle it sits at (rad, nose up), and its level layout's points as it stands. */
export interface Taildragger {
  f: Airframe;
  theta: number;
  pose: (x: number, y: number) => Pt;
}

/**
 * Sets a level layout down on its main wheels and its tailwheel: turned nose up about the
 * main wheels' centre until the tailwheel's on the ground too, then moved so its tail
 * is at x = 0 and its wheels stand on y = 0.
 */
export function sitDown(L: LevelFrame): Taildragger {
  const m = L.main;
  const t = L.tail;
  const dx = t.x - m.x;
  const dy = t.y - m.y;
  const R = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx);
  const theta = Math.PI - Math.asin((t.r - m.r) / R) - phi;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const turn = (x: number, y: number): Pt => [m.x + (x - m.x) * c - (y - m.y) * s, m.r + (x - m.x) * s + (y - m.y) * c];
  let x0 = Infinity;
  for (const pc of L.pieces) for (const [x, y] of pc) x0 = Math.min(x0, turn(x, y)[0]);
  const pose = (x: number, y: number): Pt => {
    const [u, v] = turn(x, y);
    return [u - x0, v];
  };
  const pieces = L.pieces.map((pc) => pc.map(([x, y]) => pose(x, y)));
  let len = 0;
  let top = 0;
  for (const pc of pieces) for (const [x, y] of pc) {
    len = Math.max(len, x);
    top = Math.max(top, y);
  }
  const [c0x, c0y, c1x, c1y] = L.cabin;
  const corners = [pose(c0x, c0y), pose(c1x, c0y), pose(c0x, c1y), pose(c1x, c1y)];
  const f: Airframe = {
    len: len + 0.05, top: top + 0.05, bottom: Math.min(m.r, t.r),
    pieces, whole: L.whole,
    wheels: [
      { x: pose(m.x, m.y)[0], r: m.r, rim: m.rim, hub: m.hub },
      { x: pose(t.x, t.y)[0], r: t.r, rim: t.rim, hub: t.hub },
    ],
    seats: L.seats.map(([x, y]) => pose(x, y)),
    recline: L.recline?.map((r) => r + theta),
    cabin: [Math.min(...corners.map((q) => q[0])), Math.min(...corners.map((q) => q[1])), Math.max(...corners.map((q) => q[0])), Math.max(...corners.map((q) => q[1]))],
    cg: pose(...L.cg), engine: pose(...L.engine), fuel: pose(...L.fuel),
  };
  return { f, theta, pose };
}

/** A sheet that draws a level layout's points as the taildragger stands (see sitDown()). */
class SitSheet extends Sheet {
  constructor(private readonly td: Taildragger) {
    super(td.f);
  }

  p(x: number, y: number): Pt {
    const [u, v] = this.td.pose(x, y);
    return super.p(u, v);
  }
}

/** A national marking: a black cross on white (a Balkenkreuz), or a red star edged white, `r` m across its middle at (x, y). */
function cross(s: Sheet, x: number, y: number, r: number): void {
  s.poly([[x - r, y - r * 0.35], [x + r, y - r * 0.35], [x + r, y + r * 0.35], [x - r, y + r * 0.35]], WHITE[3]);
  s.poly([[x - r * 0.35, y - r], [x + r * 0.35, y - r], [x + r * 0.35, y + r], [x - r * 0.35, y + r]], WHITE[3]);
  const k = r * 0.72;
  s.poly([[x - k, y - k * 0.22], [x + k, y - k * 0.22], [x + k, y + k * 0.22], [x - k, y + k * 0.22]], 0x16181a);
  s.poly([[x - k * 0.22, y - k], [x + k * 0.22, y - k], [x + k * 0.22, y + k], [x - k * 0.22, y + k]], 0x16181a);
}

function star(s: Sheet, x: number, y: number, r: number): void {
  const pts = (k: number): Pt[] => Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? k * 0.42 : k;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr] as Pt;
  });
  // (a five-pointed star isn't convex: drawn as its middle and five points)
  const draw = (k: number, c: Color) => {
    const p = pts(k);
    s.poly(p.filter((_, i) => i % 2 === 1), c);
    for (let i = 0; i < 10; i += 2) s.poly([p[i], p[(i + 1) % 10], p[(i + 9) % 10]], c);
  };
  draw(r, WHITE[3]);
  draw(r * 0.78, 0xc0222a);
}

/** The American star and bar: a white star on a blue disc, white bars out either side edged blue. */
function usStar(s: Sheet, x: number, y: number, r: number): void {
  const B = 0x1f3a78;
  s.poly([[x - r * 1.9, y - r * 0.42], [x + r * 1.9, y - r * 0.42], [x + r * 1.9, y + r * 0.42], [x - r * 1.9, y + r * 0.42]], B);
  s.poly([[x - r * 1.8, y - r * 0.3], [x + r * 1.8, y - r * 0.3], [x + r * 1.8, y + r * 0.3], [x - r * 1.8, y + r * 0.3]], WHITE[3]);
  s.poly(Array.from({ length: 12 }, (_, i): Pt => [x + Math.cos((i / 12) * Math.PI * 2) * r, y + Math.sin((i / 12) * Math.PI * 2) * r]), B);
  const p = Array.from({ length: 10 }, (_, i): Pt => {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.36 : r * 0.88;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
  });
  s.poly(p.filter((_, i) => i % 2 === 1), WHITE[3]);
  for (let i = 0; i < 10; i += 2) s.poly([p[i], p[(i + 1) % 10], p[(i + 9) % 10]], WHITE[3]);
}

/** Soft camouflage blotches along a fuselage's side from x0 to x1 (m), between y0 and y1, of `c` over the paint `under`. */
function mottle(s: Sheet, x0: number, x1: number, y0: number, y1: number, c: Color, under: Color, seed: number): void {
  let k = seed;
  const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
  for (let x = x0; x < x1; x += 0.25 + rnd() * 0.35) {
    const y = y0 + rnd() * (y1 - y0);
    const w = 0.12 + rnd() * 0.22;
    const h = 0.08 + rnd() * 0.14;
    s.over([[x - w, y], [x - w * 0.4, y + h], [x + w * 0.5, y + h * 0.8], [x + w, y - h * 0.2], [x + w * 0.3, y - h], [x - w * 0.6, y - h * 0.8]], c, (q) => q === under);
  }
}

/** The warbirds' paint: the Mustang's bare metal and olive anti-glare panel; the Focke-Wulf's greys over pale blue; the Yak's green over pale blue. */
const ALU = ramp('#b8bec4', 0.7);
const OD = ramp('#4c5236');
const RLM74 = ramp('#5e646a', 0.9);
const RLM76 = ramp('#a7b8c4', 0.7);
const SOV_GREEN = ramp('#5d6a3c');
const SOV_BLUE = ramp('#9fb4c4', 0.7);
const SOV_DARK = ramp('#3c4630');
const RLM75 = ramp('#73787e', 0.9);

/**
 * The North American P-51D Mustang (as it flies: its datum level): 9.83 m long, a
 * Packard Merlin under a long nose, the bubble canopy, the radiator's scoop under its
 * belly, a low laminar-flow wing. Bare metal, the olive anti-glare panel ahead of the
 * pilot, a yellow nose and invasion stripes on its belly.
 */
export const P51D_LEVEL: LevelFrame = {
  pieces: [
    [[6.6, 1.35], [9.25, 1.65], [9.83, 2.05], [9.25, 2.45], [6.6, 2.58]],
    [[3.3, 1.3], [4.2, 1.0], [5.6, 1.02], [6.6, 1.35], [6.6, 2.58], [5.85, 3.12], [4.5, 2.68], [3.3, 2.56]],
    [[3.3, 1.3], [3.3, 2.56], [1.0, 2.3], [0.12, 2.25], [0.2, 1.9], [1.0, 1.72]],
    [[1.65, 2.32], [0.6, 3.78], [0.15, 3.72], [0.0, 2.2]],
    [[4.6, 1.3], [7.05, 1.3], [7.05, 1.62], [4.6, 1.5]],
    [[1.45, 2.08], [0.0, 2.1], [0.0, 2.25], [1.35, 2.25]],
  ],
  whole: [3, 4],
  main: { x: 6.55, y: 0.345, r: 0.345, rim: STEEL_LT, hub: 11 },
  tail: { x: 0.95, y: 1.5, r: 0.16, rim: STEEL_LT, hub: 5 },
  seats: [[5.55, 2.12]],
  recline: [0.3],
  cabin: [4.6, 1.85, 6.6, 3.2],
  cg: [5.95, 1.9], engine: [8.3, 2.0], fuel: [6.0, 1.4],
};
export const P51D = sitDown(P51D_LEVEL);

export function p51dArt(): PixelArt {
  const td = P51D;
  const L = P51D_LEVEL;
  const s = new SitSheet(td);
  const P = ALU;
  s.poly(L.pieces[2], P[2]).poly(L.pieces[1], P[2]).poly(L.pieces[0], P[2]);
  s.poly(L.pieces[3], P[2]).poly(L.pieces[5], P[2]);
  // the wing, the gear legs and their doors, the spinner
  s.poly(L.pieces[4], P[1]);
  leg(s, 6.6, 1.3, L.main.x, L.main.y, 0.12);
  s.poly([[6.45, 1.28], [6.75, 1.28], [6.68, 0.75], [6.5, 0.75]], P[1]);
  leg(s, 1.0, 1.75, L.tail.x, L.tail.y, 0.08);
  spinner(s, 9.83, 2.05, 0.36, 0.6, P);
  pane(s, [[6.6, 2.56], [5.95, 3.1], [5.2, 3.12], [4.55, 2.7]]);
  finish(s.a);
  // the yellow nose, the olive anti-glare panel, invasion stripes, the scoop's mouth, exhausts, panel lines
  s.over([[9.0, 1.4], [9.9, 1.4], [9.9, 2.7], [9.0, 2.7]], YELLOW[2], (c) => c === P[2] || c === P[3] || c === P[1]);
  s.over([[6.6, 2.35], [9.1, 2.3], [9.1, 2.6], [6.6, 2.6]], OD[2], (c) => c === P[2] || c === P[3]);
  for (let i = 0; i < 5; i++) s.over([[2.3 + i * 0.2, 1.0], [2.5 + i * 0.2, 1.0], [2.5 + i * 0.2, 1.95], [2.3 + i * 0.2, 1.95]], i % 2 ? 0x16181a : WHITE[3], (c) => c === P[2] || c === P[1] || c === P[0]);
  s.poly([[5.6, 1.02], [5.65, 1.3], [5.5, 1.3]], GUNMETAL[0]);
  for (let x = 7.4; x < 8.6; x += 0.2) s.seam(x, 2.2, x + 0.08, 2.15, GUNMETAL[0]);
  s.seam(6.6, 1.4, 6.6, 2.5, P[1]);
  s.seam(4.5, 2.62, 3.3, 2.5, P[1]);
  s.seam(1.3, 3.6, 0.7, 2.3, P[1]);
  usStar(s, 3.0, 1.95, 0.3);
  s.set(0.45, 3.7, LED_RED).set(5.9, 1.48, LED_GREEN);
  return s.a;
}

/**
 * The Focke-Wulf Fw 190 A-8 (level): 9.0 m long, the BMW 801's big round cowling with
 * its cooling fan in the spinner, a short canopy, a low wing on wide-set gear. Grey
 * mottle over pale blue, a yellow panel under the cowling, black crosses edged white.
 */
export const FW190_LEVEL: LevelFrame = {
  pieces: [
    [[7.0, 1.36], [8.45, 1.3], [8.75, 1.55], [9.0, 2.0], [8.75, 2.45], [8.45, 2.7], [7.0, 2.64]],
    [[3.9, 1.3], [7.0, 1.36], [7.0, 2.64], [6.4, 2.66], [5.85, 3.12], [4.8, 3.06], [3.9, 2.62]],
    [[3.9, 1.3], [3.9, 2.62], [1.1, 2.25], [0.12, 2.2], [0.2, 1.85], [1.0, 1.72]],
    [[1.5, 2.28], [0.6, 3.55], [0.15, 3.5], [0.0, 2.15]],
    [[4.5, 1.3], [6.95, 1.32], [6.95, 1.62], [4.5, 1.48]],
    [[1.4, 2.06], [0.0, 2.08], [0.0, 2.22], [1.3, 2.22]],
  ],
  whole: [3, 4],
  main: { x: 6.5, y: 0.35, r: 0.35, rim: STEEL_LT, hub: 11 },
  tail: { x: 0.8, y: 1.48, r: 0.18, rim: STEEL_LT, hub: 5 },
  seats: [[5.35, 2.15]],
  recline: [0.25],
  cabin: [4.3, 1.85, 6.4, 3.2],
  cg: [5.95, 1.95], engine: [7.8, 2.0], fuel: [5.0, 1.5],
};
export const FW190 = sitDown(FW190_LEVEL);

export function fw190Art(): PixelArt {
  const td = FW190;
  const L = FW190_LEVEL;
  const s = new SitSheet(td);
  const P = RLM74;
  s.poly(L.pieces[2], P[2]).poly(L.pieces[1], P[2]).poly(L.pieces[0], P[2]);
  s.poly(L.pieces[3], P[2]).poly(L.pieces[5], P[2]);
  s.poly(L.pieces[4], RLM76[1]);
  leg(s, 6.55, 1.3, L.main.x, L.main.y, 0.13);
  s.poly([[6.35, 1.28], [6.7, 1.28], [6.62, 0.7], [6.42, 0.7]], P[1]);
  leg(s, 0.85, 1.75, L.tail.x, L.tail.y, 0.08);
  spinner(s, 9.0, 2.0, 0.42, 0.45, P);
  pane(s, [[6.4, 2.64], [5.9, 3.1], [4.85, 3.04], [4.0, 2.64]]);
  finish(s.a);
  // the pale blue underside, the yellow panel under the cowling, the cooling fan's blades in its mouth, exhausts
  s.over([[0, 1.0], [9.2, 1.0], [9.2, 1.75], [0, 1.95]], RLM76[2], (c) => c === P[2] || c === P[1] || c === P[0]);
  s.over([[7.1, 1.3], [8.4, 1.25], [8.4, 1.6], [7.1, 1.6]], YELLOW[2], (c) => c === RLM76[2] || c === P[2] || c === P[1]);
  for (let y = 1.55; y < 2.5; y += 0.18) s.seam(8.5, y, 8.62, y + 0.08, GUNMETAL[0]);
  for (let x = 7.2; x < 7.9; x += 0.16) s.seam(x, 1.7, x + 0.06, 1.65, GUNMETAL[0]);
  // the mottle along the side, panel lines, the fuselage band
  mottle(s, 0.8, 6.9, 1.95, 2.5, RLM75[2], P[2], 7);
  s.over([[1.6, 1.0], [2.0, 1.0], [2.0, 2.6], [1.6, 2.6]], 0xc8b040, (c) => c === P[2] || c === RLM76[2] || c === P[1]);
  s.seam(7.0, 1.4, 7.0, 2.6, P[1]);
  s.seam(3.9, 2.58, 3.9, 1.35, P[1]);
  cross(s, 3.0, 1.95, 0.3);
  cross(s, 0.75, 2.85, 0.2);
  s.set(0.45, 3.45, LED_RED).set(5.9, 1.48, LED_GREEN);
  return s.a;
}

/**
 * The Yakovlev Yak-9K (level): 8.5 m long, a slim Klimov V-12 under the nose and the
 * 45 mm NS-45's long barrel firing through the spinner, muzzle brake and all; the
 * canopy over a raised spine, the radiator's scoop under the wing. Green over pale
 * blue, red stars edged white.
 */
export const YAK9K_LEVEL: LevelFrame = {
  pieces: [
    [[6.5, 1.36], [8.0, 1.6], [8.5, 1.9], [8.0, 2.2], [6.5, 2.36]],
    [[3.6, 1.25], [4.2, 1.02], [5.2, 1.02], [6.5, 1.36], [6.5, 2.36], [6.1, 2.42], [5.5, 2.86], [4.6, 2.86], [3.6, 2.46]],
    [[3.6, 1.25], [3.6, 2.46], [1.0, 2.15], [0.12, 2.1], [0.2, 1.8], [1.0, 1.66]],
    [[1.4, 2.18], [0.55, 3.25], [0.15, 3.2], [0.0, 2.08]],
    [[4.3, 1.25], [6.5, 1.28], [6.5, 1.56], [4.3, 1.42]],
    [[1.3, 2.0], [0.0, 2.02], [0.0, 2.15], [1.2, 2.15]],
  ],
  whole: [3, 4],
  main: { x: 6.25, y: 0.32, r: 0.32, rim: STEEL_LT, hub: 10 },
  tail: { x: 0.8, y: 1.4, r: 0.15, rim: STEEL_LT, hub: 5 },
  seats: [[5.0, 2.08]],
  recline: [0.25],
  cabin: [4.0, 1.75, 6.1, 3.0],
  cg: [5.7, 1.85], engine: [7.4, 1.9], fuel: [5.3, 1.4],
};
export const YAK9K = sitDown(YAK9K_LEVEL);
/** The NS-45's muzzle, level (m): out past the spinner. */
export const YAK9K_MUZZLE: Pt = [8.95, 1.9];

export function yak9kArt(): PixelArt {
  const td = YAK9K;
  const L = YAK9K_LEVEL;
  const s = new SitSheet(td);
  const P = SOV_GREEN;
  s.poly(L.pieces[2], P[2]).poly(L.pieces[1], P[2]).poly(L.pieces[0], P[2]);
  s.poly(L.pieces[3], P[2]).poly(L.pieces[5], P[2]);
  s.poly(L.pieces[4], SOV_BLUE[1]);
  leg(s, 6.3, 1.27, L.main.x, L.main.y, 0.11);
  s.poly([[6.12, 1.25], [6.42, 1.25], [6.36, 0.7], [6.18, 0.7]], P[1]);
  leg(s, 0.85, 1.7, L.tail.x, L.tail.y, 0.07);
  // the cannon's barrel out through the spinner, and its muzzle brake
  s.rect(8.3, 1.86, 8.85, 1.94, GUNMETAL[2]);
  s.rect(8.78, 1.83, 8.95, 1.97, GUNMETAL[1]);
  spinner(s, 8.5, 1.9, 0.3, 0.42, P);
  pane(s, [[6.1, 2.4], [5.55, 2.84], [4.65, 2.84], [3.7, 2.46]]);
  finish(s.a);
  // pale blue underneath, the black-green blotches, exhausts, panel lines
  s.over([[0, 0.9], [8.6, 0.9], [8.6, 1.66], [0, 1.85]], SOV_BLUE[2], (c) => c === P[2] || c === P[1] || c === P[0]);
  mottle(s, 0.8, 7.7, 1.85, 2.3, SOV_DARK[2], P[2], 11);
  for (let x = 6.8; x < 7.7; x += 0.18) s.seam(x, 2.08, x + 0.07, 2.03, GUNMETAL[0]);
  s.seam(6.5, 1.42, 6.5, 2.3, P[1]);
  s.seam(3.6, 2.42, 3.6, 1.3, P[1]);
  star(s, 2.7, 1.9, 0.3);
  star(s, 0.7, 2.75, 0.22);
  s.set(0.4, 3.2, LED_RED).set(5.6, 1.45, LED_GREEN);
  return s.a;
}

import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { PixelArt } from '../art/PixelArt';
import { Human } from '../entities/Human';
import { Creature } from '../entities/Creature';
import { PX } from '../engine/constants';
import { clamp, lerpAngle, TAU } from '../engine/math';
import { isLiving, limbsOf, type LimbLike, type Living } from './VitalsPanel';
import { knowBones } from '../systems/Chunks';
import type { Part } from '../world/Part';

interface Pt {
  x: number;
  y: number;
}

/** One bone, in its limb's own frame: sprite pixels, y up, the way the body faces baked in. */
export type Bone =
  /** A long bone from a to b, `r` thick, with a knob `ka` / `kb` across at each end (0: none); `pair`: two knuckles side by side. */
  | { k: 'shaft'; ax: number; ay: number; bx: number; by: number; r: number; ka: number; kb: number; pair: boolean }
  /** A rounded bone: the skull, a shoulder blade, a hip. */
  | { k: 'oval'; x: number; y: number; rx: number; ry: number; rot: number }
  /** A block: a vertebra, the face; `hx` along `rot`, `hy` across. */
  | { k: 'block'; x: number; y: number; hx: number; hy: number; rot: number }
  /** A thin bone (rib, finger, jaw): a line through the points [x0, y0, x1, y1, ...]. */
  | { k: 'thin'; pts: number[] }
  /** A hole through the bone: an eye socket, a hip socket. */
  | { k: 'hole'; x: number; y: number; rx: number; ry: number };

interface Paths {
  fill: Path2D;
  thin: Path2D;
  holes: Path2D | null;
  crack: Path2D;
}

/** A limb's skeleton, built from its picture's size and its joints. */
export interface Bones {
  list: Bone[];
  /** The main bone in one piece, or snapped in two. */
  pieces: 1 | 2;
  /** Where it breaks (sprite px), the way the bone runs there, and how thick it is. */
  brk: { x: number; y: number; ux: number; uy: number; w: number };
  /** Drawing paths, made on first use. */
  paths: Paths | null;
}

/** What the x-ray shows of one limb (see skeleton()). */
export interface LimbBones {
  key: string;
  broken: boolean;
  /** Off the body: cut or torn off, or hanging from a limb that was. */
  severed: boolean;
  gone: boolean;
  bones: Bones;
}

/** What a limb's skeleton is built from: its picture's size, the way it faces and its joints. */
interface Geo {
  /** Half the limb picture's size (px). */
  hw: number;
  hh: number;
  /** Which way the body faces (1: right). */
  f: number;
  /** The joint to the parent (px); null for the root of the body. */
  P: Pt | null;
  /** The joint of the first child whose key starts with `prefix`. */
  kid(prefix: string): Pt | null;
}

/** Collects bones along an axis from P (where the limb hangs from its parent) to D (where it ends). */
class Build {
  readonly list: Bone[] = [];
  readonly P: Pt;
  readonly u: Pt;
  readonly v: Pt;
  readonly L: number;
  /** Half the main bone's thickness, and how far along the axis it breaks (fraction). */
  r = 0.7;
  brkAt = 0.5;

  constructor(P: Pt, D: Pt) {
    this.P = P;
    const dx = D.x - P.x;
    const dy = D.y - P.y;
    this.L = Math.hypot(dx, dy) || 1;
    this.u = { x: dx / this.L, y: dy / this.L };
    this.v = { x: -this.u.y, y: this.u.x };
  }

  /** `s` px along the axis and `t` across it. */
  at(s: number, t = 0): Pt {
    return { x: this.P.x + this.u.x * s + this.v.x * t, y: this.P.y + this.u.y * s + this.v.y * t };
  }

  /** A fraction `q` of the way along, `t` px across. */
  frac(q: number, t = 0): Pt {
    return this.at(q * this.L, t);
  }

  get rot(): number {
    return Math.atan2(this.u.y, this.u.x);
  }

  shaft(a: Pt, b: Pt, r: number, ka = 0, kb = ka, pair = false): void {
    this.list.push({ k: 'shaft', ax: a.x, ay: a.y, bx: b.x, by: b.y, r, ka, kb, pair });
  }

  oval(c: Pt, rx: number, ry: number, rot = 0): void {
    this.list.push({ k: 'oval', x: c.x, y: c.y, rx, ry, rot });
  }

  block(c: Pt, hx: number, hy: number, rot = 0): void {
    this.list.push({ k: 'block', x: c.x, y: c.y, hx, hy, rot });
  }

  thin(...pts: Pt[]): void {
    this.list.push({ k: 'thin', pts: pts.flatMap((p) => [p.x, p.y]) });
  }

  hole(c: Pt, rx: number, ry = rx): void {
    this.list.push({ k: 'hole', x: c.x, y: c.y, rx, ry });
  }

  /** `n` vertebrae spread along a line through `pts`, each `along` long and `across` wide (shrinking by `taper` toward the end). */
  chain(pts: Pt[], n: number, along: number, across: number, taper = 0): void {
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      lens.push(d);
      total += d;
    }
    for (let i = 0; i < n; i++) {
      const q = n === 1 ? 0.5 : i / (n - 1);
      let d = q * total;
      let j = 0;
      while (j < lens.length - 1 && d > lens[j]) d -= lens[j++];
      const a = pts[j];
      const b = pts[j + 1];
      const t = lens[j] ? d / lens[j] : 0;
      const k = 1 - taper * q;
      this.block({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, along * k, across * k, Math.atan2(b.y - a.y, b.x - a.x));
    }
  }
}

/** The middle of the picture's edge farthest from P: where a limb with nothing below it ends. */
function farEnd(P: Pt, g: Geo): Pt {
  const ex = g.hw - 0.6;
  const ey = g.hh - 0.6;
  let best: Pt = { x: 0, y: -ey };
  let bd = -1;
  for (const c of [{ x: 0, y: ey }, { x: 0, y: -ey }, { x: ex, y: 0 }, { x: -ex, y: 0 }]) {
    const d = Math.hypot(c.x - P.x, c.y - P.y);
    if (d > bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

const thickness = (g: Geo) => clamp(Math.min(g.hw, g.hh) * 0.3, 0.5, 1);

/** Upper arms and legs: one long bone, knuckled at both ends. */
function longBone(g: Geo): Build {
  const P = g.P ?? { x: 0, y: g.hh - 0.6 };
  const b = new Build(P, g.kid('') ?? farEnd(P, g));
  const r = (b.r = thickness(g));
  b.shaft(b.at(0.9), b.at(b.L - 0.9), r, r * 0.95, r * 0.95, true);
  return b;
}

/** Forearms and shins: two bones side by side, the thicker one in front. */
function forearm(g: Geo): Build {
  const P = g.P ?? { x: 0, y: g.hh - 0.6 };
  const b = new Build(P, g.kid('') ?? farEnd(P, g));
  const r = (b.r = thickness(g));
  const front = Math.sign(b.v.x * g.f) || 1;
  b.shaft(b.at(0.9, front * r * 0.5), b.at(b.L - 0.9, front * r * 0.5), r * 0.6, r * 0.6);
  b.shaft(b.at(1.1, -front * r * 0.6), b.at(b.L - 1.1, -front * r * 0.6), r * 0.42, r * 0.45);
  return b;
}

/** Wrist bones, then three fingers in two joints each; it breaks across the knuckles. */
function hand(g: Geo): Build {
  const P = g.P ?? { x: 0, y: g.hh - 0.6 };
  const b = new Build(P, farEnd(P, g));
  const w = g.hw * 0.38;
  const L = b.L;
  b.r = w;
  b.oval(b.at(0.75), 0.6, Math.max(0.6, g.hw * 0.5), b.rot);
  for (const t of [-1, 0, 1]) {
    b.thin(b.at(1.25, t * w * 0.85), b.at(0.6 * L, t * w));
    b.thin(b.at(0.6 * L + 0.35, t * w * 1.05), b.at(L, t * w * 1.1));
  }
  b.brkAt = (0.6 * L + 0.17) / L;
  return b;
}

/** Heel and ankle bones, three long bones to the toes and the toes. */
function foot(g: Geo): Build {
  const P = g.P ?? { x: -g.hw * 0.4 * g.f, y: g.hh - 0.5 };
  const b = new Build(P, farEnd(P, g));
  const L = b.L;
  b.r = 0.5;
  b.oval(b.at(0.5), 0.75, 0.6, b.rot);
  b.oval({ x: P.x - 1.0 * g.f, y: P.y - 1.2 }, 0.95, 0.65, 0);
  for (const t of [-0.38, 0, 0.38]) {
    b.thin(b.at(1.2, t * 0.8), b.at(0.66 * L, t));
    b.thin(b.at(0.66 * L + 0.35, t * 1.05), b.at(L, t * 1.1));
  }
  b.brkAt = 0.42;
  return b;
}

/** An animal's lower leg: the cannon bone down to the paw, toes pointing ahead. */
function paw(g: Geo): Build {
  const P = g.P ?? { x: 0, y: g.hh - 0.6 };
  const b = new Build(P, farEnd(P, g));
  const r = (b.r = clamp(g.hw * 0.3, 0.45, 0.9));
  const L = b.L;
  b.shaft(b.at(0.6), b.frac(0.6), r, r * 0.9, r * 0.5);
  for (const t of [-1, 0, 1]) {
    const end = b.at(L - 0.2, t * r * 0.7);
    b.thin(b.frac(0.68, t * r * 0.7), { x: end.x + 0.9 * g.f, y: end.y });
  }
  b.brkAt = 0.36;
  return b;
}

/** A tail: a row of vertebrae getting smaller to the tip. */
function tail(g: Geo): Build {
  const P = g.P ?? { x: 0, y: 0 };
  const b = new Build(P, farEnd(P, g));
  const n = Math.max(3, Math.round(b.L / 1.25));
  const across = Math.min(g.hw, g.hh) * 0.5;
  b.r = across;
  b.chain([b.at(0.5), b.at(b.L - 0.3)], n, 0.42, across, 0.45);
  return b;
}

/** A person's skull: the round braincase, the face toward where they look, the jaw, and the top of the neck. */
function skull(g: Geo): Build {
  const { hw, hh, f } = g;
  const P = g.P ?? { x: 0, y: -hh + 0.5 };
  const b = new Build(P, { x: P.x, y: hh });
  b.r = 0.8;
  b.oval({ x: -0.1 * hw * f, y: 0.24 * hh }, 0.78 * hw, 0.65 * hh);
  b.block({ x: 0.48 * hw * f, y: -0.25 * hh }, 0.28 * hw, 0.22 * hh);
  b.thin({ x: -0.16 * hw * f, y: -0.29 * hh }, { x: -0.04 * hw * f, y: -0.69 * hh }, { x: 0.52 * hw * f, y: -0.78 * hh }, { x: 0.68 * hw * f, y: -0.55 * hh });
  b.thin({ x: 0.4 * hw * f, y: -0.53 * hh }, { x: 0.68 * hw * f, y: -0.53 * hh });
  b.hole({ x: 0.48 * hw * f, y: 0.02 * hh }, 0.19 * hw, 0.155 * hh);
  b.hole({ x: 0.72 * hw * f, y: -0.22 * hh }, 0.07 * hw, 0.08 * hh);
  b.block({ x: P.x - 0.4 * f, y: P.y + 0.75 }, 0.6, 0.4);
  return b;
}

/** An animal's skull: braincase at the back, a long muzzle out to the nose, the jaw beneath. */
function muzzle(g: Geo): Build {
  const P = g.P ?? { x: -g.hw * 0.8 * g.f, y: 0 };
  const b = new Build(P, farEnd(P, g));
  const up = (p: Pt, h: number): Pt => ({ x: p.x, y: p.y + h * g.hh });
  b.r = 0.8;
  b.oval(up(b.frac(0.3), 0.35), 0.3 * b.L, 0.42 * g.hh, b.rot);
  b.shaft(up(b.frac(0.5), 0.05), b.frac(0.95), 0.22 * g.hh);
  b.thin(up(b.frac(0.28), -0.15), up(b.frac(0.6), -0.38), up(b.frac(0.93), -0.32));
  b.hole(up(b.frac(0.45), 0.45), 0.14 * g.hh);
  b.hole(up(b.frac(0.95), 0.1), 0.07 * g.hh);
  return b;
}

/** A person's chest: the spine down the back, ribs curving round to the breastbone, collarbone and shoulder blade. */
function ribcage(g: Geo): Build {
  const { hw, hh, f } = g;
  const N = g.kid('head') ?? { x: 0, y: hh - 0.5 };
  const W = g.kid('midTorso') ?? { x: 0, y: -hh + 1 };
  const S = g.kid('upperArm') ?? { x: 0, y: hh * 0.55 };
  const xb = -0.3 * hw * f;
  const b = new Build({ x: xb, y: N.y - 2.3 }, { x: xb, y: W.y });
  b.chain([{ x: N.x - 0.4 * f, y: N.y - 0.7 }, { x: xb, y: N.y - 2.3 }, { x: xb, y: W.y + 0.5 }], 7, 0.42, 0.7);
  for (let i = 0; i < 4; i++) {
    const y0 = N.y - 2.5 - i * 1.5;
    b.thin({ x: xb + 0.4 * f, y: y0 }, { x: xb + 1.9 * f, y: y0 + 0.1 }, { x: 0.36 * hw * f, y: y0 - 0.9 - i * 0.15 }, { x: 0.62 * hw * f, y: y0 - 1.9 - i * 0.2 });
  }
  b.thin({ x: 0.64 * hw * f, y: N.y - 2.7 }, { x: 0.6 * hw * f, y: N.y - 7.4 });
  b.thin({ x: 0.56 * hw * f, y: N.y - 1.7 }, { x: S.x + 0.2 * f, y: S.y + 0.5 });
  b.oval({ x: S.x - 1.1 * f, y: S.y - 1.5 }, 1.0, 1.9, 0.25 * f);
  return b;
}

/** The small of the back: three big vertebrae and a floating rib. */
function lumbar(g: Geo): Build {
  const { hw, hh, f } = g;
  const P = g.P ?? { x: 0, y: hh - 0.5 };
  const W = g.kid('lowerTorso') ?? { x: 0, y: -hh + 1 };
  const xb = -0.3 * hw * f;
  const b = new Build({ x: xb, y: P.y }, { x: xb, y: W.y });
  b.r = 0.85;
  b.chain([b.at(0.3), b.at(b.L - 0.3)], 3, 0.5, 0.85);
  b.thin({ x: xb + 0.5 * f, y: P.y - 0.7 }, { x: 0.25 * hw * f, y: P.y - 1.7 });
  return b;
}

/** A person's pelvis: the base of the spine, the hip bone's wing, the hip sockets and the bones below them. */
function pelvis(g: Geo): Build {
  const { hw, hh, f } = g;
  const P = g.P ?? { x: 0, y: hh - 0.5 };
  const H = g.kid('upperLeg') ?? { x: 0, y: -hh + 1.5 };
  const xb = -0.3 * hw * f;
  const b = new Build(P, H);
  b.r = 1;
  b.brkAt = 0.82;
  b.chain([{ x: xb, y: P.y - 0.4 }, { x: xb - 0.3 * f, y: P.y - 2 }], 2, 0.5, 0.8);
  b.oval({ x: -0.05 * hw * f, y: H.y + 2.3 }, 0.6 * hw, 0.3 * hh, 0.3 * f);
  b.oval(H, 1.15, 1.15);
  b.hole(H, 0.6);
  b.shaft({ x: H.x + 0.6 * f, y: H.y - 0.4 }, { x: 0.6 * hw * f, y: H.y - 1.1 }, 0.42, 0, 0.42);
  b.shaft({ x: H.x - 0.5 * f, y: H.y - 0.5 }, { x: -0.32 * hw * f, y: H.y - 1.25 }, 0.42, 0, 0.4);
  return b;
}

/** An animal's chest: the spine along the top from the neck, ribs sloping back beneath it, breastbone and shoulder blade. */
function chest(g: Geo): Build {
  const { hw, hh, f } = g;
  const Hd = g.kid('head') ?? { x: (hw - 1) * f, y: hh * 0.5 };
  const Hp = g.kid('hips') ?? { x: -(hw - 1) * f, y: 0 };
  const S = g.kid('upperFront') ?? { x: 0.4 * hw * f, y: -hh * 0.5 };
  const yT = hh * 0.45;
  const A = { x: Hd.x * 0.75, y: yT };
  const B = { x: Hp.x, y: yT - 0.2 };
  const b = new Build(A, B);
  b.chain([{ x: Hd.x - 0.3 * f, y: Hd.y - 0.3 }, A], 2, 0.45, 0.65);
  b.chain([A, B], Math.max(4, Math.round(b.L / 1.5)), 0.45, 0.7);
  for (let i = 0; i < 5; i++) {
    const x = A.x + (B.x - A.x) * (0.15 + 0.15 * i);
    b.thin({ x, y: yT - 0.4 }, { x: x - 0.5 * f, y: 0 }, { x: x - 1.0 * f, y: -0.62 * hh });
  }
  b.thin({ x: S.x + 1.4 * f, y: -0.58 * hh }, { x: A.x + (B.x - A.x) * 0.82, y: -0.66 * hh });
  b.oval({ x: S.x - 0.2 * f, y: (S.y + yT) / 2 }, 0.9, Math.max(0.8, (yT - S.y) * 0.42), 0.35 * f);
  return b;
}

/** An animal's hindquarters: the spine on to the tail, the pelvis tilted over the hip sockets. */
function haunch(g: Geo): Build {
  const { hw, hh, f } = g;
  const P = g.P ?? { x: (hw - 0.6) * f, y: 0 };
  const T = g.kid('tail') ?? farEnd(P, g);
  const Lg = g.kid('upperBack') ?? { x: -0.3 * hw * f, y: -hh * 0.5 };
  const yT = hh * 0.38;
  const A = { x: P.x - 0.6 * f, y: Math.min(P.y + 0.6, yT) };
  const B = { x: T.x + 0.5 * f, y: T.y };
  const b = new Build(A, B);
  b.chain([A, B], Math.max(3, Math.round(b.L / 1.5)), 0.45, 0.7);
  b.oval({ x: Lg.x + 0.7 * f, y: Lg.y + 1.7 }, 0.36 * hw, 0.28 * hh, -0.45 * f);
  b.oval(Lg, 1.0, 1.0);
  b.hole(Lg, 0.5);
  return b;
}

function role(key: string, animal: boolean): (g: Geo) => Build {
  if (key === 'head') return animal ? muzzle : skull;
  if (key === 'upperTorso') return ribcage;
  if (key === 'midTorso') return lumbar;
  if (key === 'lowerTorso') return pelvis;
  if (key === 'chest') return chest;
  if (key === 'hips') return haunch;
  if (key === 'tail') return tail;
  if (key.startsWith('hand')) return hand;
  if (key.startsWith('foot')) return foot;
  if (key.startsWith('lowerArm') || key.startsWith('lowerLeg')) return forearm;
  if (key.startsWith('lower')) return paw;
  return longBone;
}

/** The android's endoskeleton: rods with servo discs at the joints, plates for the round bones. */
function metal(o: Bone): Bone {
  if (o.k === 'shaft') return { ...o, r: o.r * 0.8, ka: o.ka ? o.r * 1.3 : 0, kb: o.kb ? o.r * 1.3 : 0, pair: false };
  if (o.k === 'oval') return { k: 'block', x: o.x, y: o.y, hx: o.rx * 0.9, hy: o.ry * 0.9, rot: o.rot };
  return o;
}

/** A small hash of a limb's key: where along it its bone breaks, and which way the pieces go. */
function hash(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Snaps the skeleton at `sb` px along its axis: what lies beyond is knocked
 * askew (turned by `kink` about the break and pushed apart a little), and a
 * bone the break runs through comes apart in two.
 */
function snap(list: Bone[], b: Build, sb: number, kink: number): Bone[] {
  const M = b.at(sb);
  const cs = Math.cos(kink);
  const sn = Math.sin(kink);
  const sx = b.u.x * 0.35 + b.v.x * 0.35;
  const sy = b.u.y * 0.35 + b.v.y * 0.35;
  const T = (x: number, y: number): Pt => {
    const dx = x - M.x;
    const dy = y - M.y;
    return { x: M.x + dx * cs - dy * sn + sx, y: M.y + dx * sn + dy * cs + sy };
  };
  const s = (x: number, y: number) => (x - b.P.x) * b.u.x + (y - b.P.y) * b.u.y;
  /** The point `gap` px short of the break (negative: past it) on a segment from p to q crossing it. */
  const cut = (px: number, py: number, qx: number, qy: number, gap: number): Pt => {
    const sp = s(px, py);
    const t = (sb - gap - sp) / (s(qx, qy) - sp);
    return { x: px + (qx - px) * t, y: py + (qy - py) * t };
  };
  const out: Bone[] = [];
  for (const o of list) {
    if (o.k === 'shaft') {
      // from the near end to the far one
      const flip = s(o.ax, o.ay) > s(o.bx, o.by);
      const [ax, ay, bx, by, ka, kb] = flip ? [o.bx, o.by, o.ax, o.ay, o.kb, o.ka] : [o.ax, o.ay, o.bx, o.by, o.ka, o.kb];
      const sa = s(ax, ay);
      const sz = s(bx, by);
      if (sz <= sb) out.push(o);
      else if (sa > sb) {
        const a = T(ax, ay);
        const z = T(bx, by);
        out.push({ ...o, ax: a.x, ay: a.y, bx: z.x, by: z.y, ka, kb });
      } else {
        const m1 = cut(ax, ay, bx, by, 0.2);
        const m2 = cut(ax, ay, bx, by, -0.2);
        const a = T(m2.x, m2.y);
        const z = T(bx, by);
        out.push({ ...o, ax, ay, bx: m1.x, by: m1.y, ka, kb: 0 });
        out.push({ ...o, ax: a.x, ay: a.y, bx: z.x, by: z.y, ka: 0, kb });
      }
    } else if (o.k === 'thin') {
      const p = o.pts;
      if (p.length === 4 && (s(p[0], p[1]) - sb) * (s(p[2], p[3]) - sb) < 0) {
        const [ax, ay, bx, by] = s(p[0], p[1]) < s(p[2], p[3]) ? p : [p[2], p[3], p[0], p[1]];
        const m1 = cut(ax, ay, bx, by, 0.2);
        const m2 = cut(ax, ay, bx, by, -0.2);
        const a = T(m2.x, m2.y);
        const z = T(bx, by);
        out.push({ k: 'thin', pts: [ax, ay, m1.x, m1.y] }, { k: 'thin', pts: [a.x, a.y, z.x, z.y] });
        continue;
      }
      let mean = 0;
      for (let i = 0; i < p.length; i += 2) mean += s(p[i], p[i + 1]);
      if (mean / (p.length / 2) <= sb) out.push(o);
      else {
        const q: number[] = [];
        for (let i = 0; i < p.length; i += 2) {
          const t = T(p[i], p[i + 1]);
          q.push(t.x, t.y);
        }
        out.push({ k: 'thin', pts: q });
      }
    } else if (s(o.x, o.y) <= sb) out.push(o);
    else {
      const c = T(o.x, o.y);
      out.push(o.k === 'hole' ? { ...o, x: c.x, y: c.y } : { ...o, x: c.x, y: c.y, rot: o.rot + kink });
    }
  }
  return out;
}

/** A limb's way of facing: a destroyed one goes by the nearest limb still there. */
function flipOf(l: LimbLike): number {
  let x = l;
  while (x.gone && x.parent) x = x.parent;
  return x.part.flip;
}

const px = (p: { x: number; y: number }): Pt => ({ x: p.x / PX, y: p.y / PX });

/** Builds a limb's skeleton from its picture's size and where its joints are. */
function build(l: LimbLike, f: number): Bones {
  const e = l.part.entity;
  const g: Geo = {
    hw: l.part.w / 2,
    hh: l.part.h / 2,
    f,
    P: l.parent ? px(l.a2) : null,
    kid: (prefix) => {
      for (const c of l.children) if (c.spec.key.startsWith(prefix)) return px(c.a1);
      return null;
    },
  };
  const b = role(l.spec.key, e instanceof Creature)(g);
  // (a chassis has no nostrils: only the eye stays, as the visor)
  let list = e instanceof Human && e.variant.kind === 'android' ? b.list.filter((o) => o.k !== 'hole' || o.rx >= 0.6).map(metal) : b.list;
  const h = hash(l.spec.key);
  const sb = b.L * clamp(b.brkAt + ((h % 17) - 8) * 0.01, 0.15, 0.9);
  const M = b.at(sb);
  if (l.broken) list = snap(list, b, sb, (h & 32 ? 1 : -1) * 0.24);
  return { list, pieces: l.broken ? 2 : 1, brk: { x: M.x, y: M.y, ux: b.u.x, uy: b.u.y, w: Math.max(b.r, 0.6) }, paths: null };
}

const built = new WeakMap<LimbLike, { flip: number; broken: boolean; bones: Bones }>();

/** A limb's skeleton (rebuilt when it breaks, mends or the body turns round). */
export function bonesOf(l: LimbLike): Bones {
  const flip = flipOf(l);
  const c = built.get(l);
  if (c && c.flip === flip && c.broken === l.broken) return c.bones;
  const bones = build(l, flip);
  built.set(l, { flip, broken: l.broken, bones });
  return bones;
}

/** Every limb's bones as the x-ray draws them. */
export function skeleton(e: Living): LimbBones[] {
  const out: LimbBones[] = [];
  for (const l of limbsOf(e)) out.push({ key: l.spec.key, broken: l.broken, severed: !l.gone && !l.attached, gone: l.gone, bones: bonesOf(l) });
  return out;
}

function circle(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

function compile(b: Bones): Paths {
  const fill = new Path2D();
  const thin = new Path2D();
  let holes: Path2D | null = null;
  for (const o of b.list) {
    switch (o.k) {
      case 'shaft': {
        const t = Math.atan2(o.by - o.ay, o.bx - o.ax);
        const h = Math.PI / 2;
        fill.moveTo(o.bx + Math.cos(t - h) * o.r, o.by + Math.sin(t - h) * o.r);
        fill.arc(o.bx, o.by, o.r, t - h, t + h);
        fill.arc(o.ax, o.ay, o.r, t + h, t + 3 * h);
        fill.closePath();
        // knuckles: two side by side, or one
        const nx = -Math.sin(t) * o.r * 0.45;
        const ny = Math.cos(t) * o.r * 0.45;
        for (const [x, y, k] of [[o.ax, o.ay, o.ka], [o.bx, o.by, o.kb]]) {
          if (!k) continue;
          if (o.pair) {
            circle(fill, x + nx, y + ny, k);
            circle(fill, x - nx, y - ny, k);
          } else circle(fill, x, y, k);
        }
        break;
      }
      case 'oval':
        fill.moveTo(o.x + o.rx * Math.cos(o.rot), o.y + o.rx * Math.sin(o.rot));
        fill.ellipse(o.x, o.y, o.rx, o.ry, o.rot, 0, TAU);
        break;
      case 'block': {
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        fill.moveTo(o.x + c * o.hx - s * o.hy, o.y + s * o.hx + c * o.hy);
        fill.lineTo(o.x - c * o.hx - s * o.hy, o.y - s * o.hx + c * o.hy);
        fill.lineTo(o.x - c * o.hx + s * o.hy, o.y - s * o.hx - c * o.hy);
        fill.lineTo(o.x + c * o.hx + s * o.hy, o.y + s * o.hx - c * o.hy);
        fill.closePath();
        break;
      }
      case 'thin':
        thin.moveTo(o.pts[0], o.pts[1]);
        for (let i = 2; i < o.pts.length; i += 2) thin.lineTo(o.pts[i], o.pts[i + 1]);
        break;
      case 'hole':
        holes ??= new Path2D();
        holes.moveTo(o.x + o.rx, o.y);
        holes.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, TAU);
        break;
    }
  }
  // the crack: a jagged line across the bone where it broke
  const { x, y, ux, uy, w } = b.brk;
  const crack = new Path2D();
  const pt = (s: number, t: number) => [x + ux * s - uy * t, y + uy * s + ux * t] as const;
  crack.moveTo(...pt(0.25, -1.5 * w));
  crack.lineTo(...pt(-0.3, -0.5 * w));
  crack.lineTo(...pt(0.3, 0.5 * w));
  crack.lineTo(...pt(-0.25, 1.5 * w));
  return { fill, thin, holes, crack };
}

/** The kind of bone a point (px in the limb's frame, y up) is on, if it's on one. */
function onBone(l: LimbLike, x: number, y: number): Bone['k'] | null {
  for (const o of bonesOf(l).list) {
    switch (o.k) {
      case 'shaft': {
        const dx = o.bx - o.ax;
        const dy = o.by - o.ay;
        const t = clamp(((x - o.ax) * dx + (y - o.ay) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
        if (Math.hypot(x - o.ax - dx * t, y - o.ay - dy * t) <= o.r + 0.5) return o.k;
        if ((o.ka && Math.hypot(x - o.ax, y - o.ay) <= o.ka + 0.5) || (o.kb && Math.hypot(x - o.bx, y - o.by) <= o.kb + 0.5)) return o.k;
        break;
      }
      case 'oval': {
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        const u = (x - o.x) * c + (y - o.y) * s;
        const v = -(x - o.x) * s + (y - o.y) * c;
        if ((u * u) / ((o.rx + 0.5) ** 2) + (v * v) / ((o.ry + 0.5) ** 2) <= 1) return o.k;
        break;
      }
      case 'block': {
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        if (Math.abs((x - o.x) * c + (y - o.y) * s) <= o.hx + 0.5 && Math.abs(-(x - o.x) * s + (y - o.y) * c) <= o.hy + 0.5) return o.k;
        break;
      }
      case 'thin':
        for (let i = 2; i < o.pts.length; i += 2) {
          const ax = o.pts[i - 2];
          const ay = o.pts[i - 1];
          const dx = o.pts[i] - ax;
          const dy = o.pts[i + 1] - ay;
          const t = clamp(((x - ax) * dx + (y - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
          if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= 0.6) return o.k;
        }
        break;
    }
  }
  return null;
}

// (a chunk shot out of a limb shows bone where the bone runs: see Chunks)
knowBones((l, x, y) => onBone(l as unknown as LimbLike, x, y));

/** The flesh as the x-ray shows it: each limb's outline filled in blue-grey, lighter round the edge. */
const sils = new WeakMap<PixelArt, HTMLCanvasElement>();
/** ...and a limb's with chunks shot out of it, made again as more go (keyed by how many pixels are gone). */
const carvedSils = new WeakMap<Part, { n: number; c: HTMLCanvasElement }>();

function silhouette(p: Part, android: boolean): HTMLCanvasElement {
  if (p.holeCount) {
    const k = carvedSils.get(p);
    if (k && k.n === p.holeCount) return k.c;
    const c = drawSilhouette(p.w, p.h, (x, y) => p.solidAt(x, y), android);
    carvedSils.set(p, { n: p.holeCount, c });
    return c;
  }
  const art = p.art;
  let c = sils.get(art);
  if (!c) sils.set(art, (c = drawSilhouette(art.w, art.h, (x, y) => art.filled(x, y), android)));
  return c;
}

function drawSilhouette(w: number, h: number, filled: (x: number, y: number) => boolean, android: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const inner = android ? [62, 76, 92, 205] : [70, 98, 124, 190];
  const rim = android ? [130, 150, 168, 225] : [140, 178, 206, 215];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      const edge = !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1);
      img.data.set(edge ? rim : inner, (y * w + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const BONE = { fill: '#e8eef1', edge: '#6d8698', hole: '#2c4256' };
const METAL = { fill: '#a9b4bd', edge: '#39424a', hole: '#20262c' };
const CRACK = '#ff4636';
const CUT = '#d83a2e';
const GHOST = 'rgba(255, 120, 108, 0.6)';
/** How long a fresh fracture flashes (s). */
const FLASH = 1.4;

/** A limb's place on the canvas: its frame (sprite px, y up) to device pixels. */
interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * X-ray (X): the people and animals turn to translucent blue-grey and show
 * their skeletons, each limb's bones built from its own picture and joints so
 * they follow every ragdoll pose. Broken bones show snapped with a red crack
 * (a fresh one flashes), cut-off limbs a red wound at the joint, and destroyed
 * ones the outline of the bones that are missing. The android shows a metal
 * endoskeleton. Drawn on a canvas over the sandbox.
 */
export class XRay {
  private game: Game;
  private controls: Controls;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private shown = false;
  /** Whether each limb was broken when last drawn, and when one broke (real seconds): a new fracture flashes. */
  private wasBroken = new WeakMap<LimbLike, boolean>();
  private broke = new WeakMap<LimbLike, number>();
  /** Each body's limbs from back to front. */
  private order = new WeakMap<Living, LimbLike[]>();
  private m: Mat = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  // the camera, this frame
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private cx = 0;
  private cy = 0;
  private dpr = 1;
  private alpha = 1;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.cv = document.createElement('canvas');
    this.cv.className = 'detail-view xray-view';
    root.prepend(this.cv);
    this.g = this.cv.getContext('2d')!;
  }

  /** Draws this frame's x-ray; `alpha` is how far between physics steps the sprites are drawn. */
  frame(alpha: number): void {
    const g = this.g;
    if (!this.controls.xray) {
      if (this.shown) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.cv.width, this.cv.height);
        this.shown = false;
      }
      return;
    }
    // fractures from before it was turned on don't flash
    if (!this.shown) this.wasBroken = new WeakMap();
    this.shown = true;
    const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2));
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) {
      this.cv.width = w;
      this.cv.height = h;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const r = this.game.renderer;
    this.camX = r.camX;
    this.camY = r.camY;
    this.zoom = r.zoom;
    this.cx = r.centerX;
    this.cy = r.height / 2;
    this.alpha = alpha;
    g.imageSmoothingEnabled = false;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // outlines and holes only where the bones are big enough to show them
    const fine = r.zoom >= 40;
    // a limb this far off screen can't reach into it
    const margin = r.zoom * dpr * 0.6;
    const now = performance.now() / 1000;
    for (const e of this.game.entities) {
      if (!isLiving(e) || e.destroyed) continue;
      const android = e instanceof Human && e.variant.kind === 'android';
      const st = android ? METAL : BONE;
      let order = this.order.get(e);
      if (!order) this.order.set(e, (order = [...limbsOf(e)].sort((a, b) => a.spec.layer - b.spec.layer)));
      for (const l of order) {
        const m = this.m;
        if (!this.place(l, m)) continue;
        if (m.e < -margin || m.e > w + margin || m.f < -margin || m.f > h + margin) continue;
        const bones = bonesOf(l);
        const P = (bones.paths ??= compile(bones));
        g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        if (l.gone) {
          // the bones that are missing, where they were
          g.setLineDash([0.9, 0.6]);
          g.lineWidth = 0.4;
          g.strokeStyle = GHOST;
          g.stroke(P.fill);
          g.stroke(P.thin);
          g.setLineDash([]);
          continue;
        }
        const p = l.part;
        g.transform(p.flip, 0, 0, -1, (-p.flip * p.w) / 2, p.h / 2);
        g.drawImage(silhouette(p, android), 0, 0);
        g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        if (fine) {
          g.lineWidth = 0.55;
          g.strokeStyle = st.edge;
          g.stroke(P.fill);
        }
        g.fillStyle = st.fill;
        g.fill(P.fill);
        if (fine) {
          g.lineWidth = 1.15;
          g.strokeStyle = st.edge;
          g.stroke(P.thin);
        }
        g.lineWidth = 0.6;
        g.strokeStyle = st.fill;
        g.stroke(P.thin);
        if (P.holes && fine) {
          // the android's visor glows while it runs
          g.fillStyle = android && l.spec.key === 'head' && e.alive ? '#7fe6ff' : st.hole;
          g.fill(P.holes);
        }
        this.marks(l, bones, P, now);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Breaks (a fresh one flashing) and the wounds where limbs came off, in the limb's frame. */
  private marks(l: LimbLike, bones: Bones, P: Paths, now: number): void {
    const g = this.g;
    const was = this.wasBroken.get(l);
    if (was === false && l.broken) this.broke.set(l, now);
    this.wasBroken.set(l, l.broken);
    if (l.broken) {
      const t = (now - (this.broke.get(l) ?? -Infinity)) / FLASH;
      const fresh = t < 1;
      if (fresh) {
        const { x, y } = bones.brk;
        g.fillStyle = `rgba(255, 210, 190, ${(1 - t) * 0.55})`;
        g.beginPath();
        g.arc(x, y, 1.2 + 1.5 * (1 - t), 0, TAU);
        g.fill();
        g.strokeStyle = `rgba(255, 70, 54, ${1 - t})`;
        g.lineWidth = 0.4;
        g.beginPath();
        g.arc(x, y, 1 + 5 * t, 0, TAU);
        g.stroke();
      }
      g.lineWidth = 0.5;
      g.strokeStyle = fresh && Math.sin(now * 40) > 0 ? '#ffffff' : CRACK;
      g.stroke(P.crack);
    }
    // a raw end where a limb was cut or torn off: on the piece, and on what it hung from
    let cut = l.severed && !!l.parent;
    for (const c of l.children) if (c.severed || c.gone) cut = true;
    if (!cut) return;
    g.strokeStyle = CUT;
    g.lineWidth = 0.45;
    g.beginPath();
    if (l.severed && l.parent) this.wound(l.a2);
    for (const c of l.children) if (c.severed || c.gone) this.wound(c.a1);
    g.stroke();
  }

  /** A ragged ring round a joint (local meters) on the path being drawn. */
  private wound(at: { x: number; y: number }): void {
    const x = at.x / PX;
    const y = at.y / PX;
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * TAU;
      const rr = i % 2 ? 0.55 : 1.05;
      if (i) this.g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else this.g.moveTo(x + rr, y);
    }
  }

  /**
   * Where a limb is drawn: from its part (between physics steps, as the sprites
   * are), or for one destroyed, where it would hang from its parent standing.
   */
  private place(l: LimbLike, m: Mat): boolean {
    if (!l.gone && !l.part.destroyed) {
      const p = l.part;
      const al = this.alpha;
      const x = p.px + (p.x - p.px) * al;
      const y = p.py + (p.y - p.py) * al;
      const a = lerpAngle(p.pa, p.a, al);
      const k = this.zoom * PX * this.dpr;
      const c = Math.cos(a);
      const s = Math.sin(a);
      m.a = k * c;
      m.b = -k * s;
      m.c = -k * s;
      m.d = -k * c;
      m.e = ((x - this.camX) * this.zoom + this.cx) * this.dpr;
      m.f = (-(y - this.camY) * this.zoom + this.cy) * this.dpr;
      return true;
    }
    if (!l.parent || !this.place(l.parent, m)) return false;
    const dx = (l.a1.x - l.a2.x) / PX;
    const dy = (l.a1.y - l.a2.y) / PX;
    m.e += m.a * dx + m.c * dy;
    m.f += m.b * dx + m.d * dy;
    return true;
  }
}

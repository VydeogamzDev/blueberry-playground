import { PX } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** How deep (m) things are, front to back, at most and at least (see aeroOf()). */
const DEPTH_MAX = 0.4;
const DEPTH_MIN = 0.03;
/** A flat face's pressure coefficient broadside on (a plate square to the air: ~1.2). */
const CN_FLAT = 1.2;
/** Most a face gives while the air still follows it (an airfoil's best, near stalling). */
const CN_ATTACHED = 1.3;
/** Skin friction along the faces (what an edge-on plate still feels). */
const CF = 0.01;
/** Pushes worth giving: an acceleration (m/s²) under this one (a walk's arm swing) is let go. */
const MIN_ACCEL = 0.2;
/** Below this speed (m/s) nothing is worth a look (a hand pushing a needle in, a walk). */
const MIN_SPEED2 = 2.5 * 2.5;

/** What a part's shape makes of the air, worked out once (see aeroOf()): its faces' areas, and an upper bound. */
interface AeroShape {
  /** Area (m²) of the faces whose normal is its y axis (along its length, x). */
  an: number;
  /** Area of the faces whose normal is its x axis (its ends). */
  au: number;
  /** The most acceleration per (density × speed²) the air can give it: ½·CN·max area / mass. */
  k: number;
  /** Its mass (kg), as it was then. */
  m: number;
}

const shapes = new WeakMap<Part, AeroShape>();

/**
 * Its faces against the air: a box its sprite's size, as deep as it is thick (a
 * pipe, a limb, a blade seen flat: what's long in the picture is thin across),
 * unless its spec says (see Part.depth: a board, a wing, a canopy are wide).
 */
function aeroOf(p: Part): AeroShape {
  let s = shapes.get(p);
  if (s && p.aeroFresh) return s;
  const lw = p.w * PX;
  const lh = p.h * PX;
  const d = p.depth ?? Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Math.min(lw, lh)));
  const m = Math.max(0.05, p.body.mass());
  const share = p.entity.dragShare;
  const an = lw * d * share;
  const au = lh * d * share;
  s = { an, au, k: (0.5 * CN_ATTACHED * Math.max(an, au)) / m, m };
  shapes.set(p, s);
  p.aeroFresh = true;
  return s;
}

/**
 * A face's normal force coefficient at `s`, the sine of the angle the air meets it
 * at: while the air still follows it (a few degrees), 2π·s, as a thin wing's lift
 * goes; once it stalls, the rough ~1.2·√s of a flat plate (broadside: 1.2).
 */
function cn(s: number): number {
  const attached = Math.min(CN_ATTACHED, 2 * Math.PI * s);
  if (s <= 0.12) return attached;
  const stalled = CN_FLAT * Math.sqrt(s);
  if (s >= 0.22) return stalled;
  const t = (s - 0.12) / 0.1;
  const k = t * t * (3 - 2 * t);
  return attached + (stalled - attached) * k;
}

/**
 * The air's push on everything moving through it, given before each step:
 * every part is a box against the air, each pair of its faces pushed along its
 * normal by ½ρv² × area × a coefficient that rises with the angle the air meets
 * it at (see cn()). So a thing falls no faster than its drag lets it (a person
 * about 50 m/s, a plank turning broadside), a plank flown nearly edge-on lifts as a
 * wing does, and engines top out where the air holds them back. The air is as
 * thick as the Atmosphere says where the part is.
 *
 * It costs a few multiplications a part: parts too slow for the air to matter
 * (MIN_SPEED2, MIN_ACCEL) are passed over before any call into the physics, and
 * asleep or frozen ones have no speed. Things that fly by their own rules
 * (Entity.ownFlight: missiles, rockets, shells, bolts) are left to them.
 */
export class Aero {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  step(dt: number): void {
    const g = this.game;
    const air = g.air;
    const layered = air.layered;
    const rho0 = air.densityAt(0);
    for (const e of g.entities) {
      if (e.destroyed || e.ownFlight) continue;
      for (const p of e.parts) {
        const vx = p.vx;
        const vy = p.vy;
        const v2 = vx * vx + vy * vy;
        if (v2 < MIN_SPEED2 || p.destroyed || p.frozen) continue;
        const rho = layered ? air.densityAt(p.y) : rho0;
        if (rho <= 1e-6) continue;
        const a = aeroOf(p);
        if (rho * a.k * v2 < MIN_ACCEL) continue;
        this.push(p, a, rho, vx, vy, v2, dt);
      }
    }
  }

  private push(p: Part, a: AeroShape, rho: number, vx: number, vy: number, v2: number, dt: number): void {
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    // the air's velocity past it in its own frame: along its length (u) and across (n)
    const vu = vx * c + vy * s;
    const vn = vy * c - vx * s;
    const v = Math.sqrt(v2);
    const q = 0.5 * rho * v2;
    // each pair of faces is pushed back along its normal
    const fn = -Math.sign(vn) * q * a.an * cn(Math.abs(vn) / v);
    const fu = -Math.sign(vu) * q * a.au * cn(Math.abs(vu) / v);
    // and the skin rubs along with the flow
    const skin = -0.5 * rho * v * CF * (a.an + a.au);
    let fx = fu * c - fn * s + skin * vx;
    let fy = fu * s + fn * c + skin * vy;
    // never more in a step than stops it (a light sheet on a long step would bounce back)
    const most = (0.8 * a.m * v) / dt;
    const f = Math.hypot(fx, fy);
    if (f > most) {
      fx *= most / f;
      fy *= most / f;
    }
    p.body.applyImpulse({ x: fx * dt, y: fy * dt }, true);
  }
}

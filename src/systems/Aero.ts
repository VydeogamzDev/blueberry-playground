import { PX } from '../engine/constants';
import { PK } from './Particles';
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
/** Whether something of its own build is ahead of a part, as last looked (see Aero.shaded()). */
const shade = new WeakMap<Part, { at: number; on: boolean }>();
/** Reentry heating (see Aero.reentry()): from this speed (m/s), and how much hotter the air ahead gets for the speed past it (the squeezed world's scale). */
const HOT_FROM = 250;
const HOT_K = 14;

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
/**
 * How hard the air holds back these parts going as one (the trajectory line's guess, see
 * Piloting.trajectory()): deceleration = this × ρ × v², their faces met at no particular angle.
 */
export function dragOf(parts: readonly Part[]): number {
  let area = 0;
  let mass = 0;
  for (const p of parts) {
    if (p.destroyed) continue;
    const a = aeroOf(p);
    area += (a.an + a.au) / 2;
    mass += a.m;
  }
  return mass > 0 ? (0.5 * CN_FLAT * area) / mass : 0;
}

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
    // (the wind, and thermals: the air moving, what's in it is pushed by its speed through the air, not over the ground)
    const ws = g.weather;
    const windy = ws.state.wind !== 0 || (g.map.world && ws.state.light > 0.5);
    for (const e of g.entities) {
      if (e.destroyed || e.ownFlight) continue;
      for (const p of e.parts) {
        let vx = p.vx;
        let vy = p.vy;
        if (windy && !p.destroyed && !p.frozen && !p.body.isSleeping()) {
          const w = ws.windAt(p.x, p.y);
          vx -= w.x;
          vy -= w.y;
        }
        const v2 = vx * vx + vy * vy;
        if (v2 < MIN_SPEED2 || p.destroyed || p.frozen) continue;
        const rho = layered ? air.densityAt(p.y) : rho0;
        if (rho <= 1e-6) continue;
        // (coming in from space fast, the air ahead of it heats it: see reentry())
        if (v2 > HOT_FROM * HOT_FROM && rho > 1e-5) this.reentry(p, rho, v2, dt);
        const a = aeroOf(p);
        if (rho * a.k * v2 < MIN_ACCEL) continue;
        this.push(p, a, rho, vx, vy, v2, dt);
      }
    }
  }

  /**
   * Reentry heating (0.4.0): past HOT_FROM the air in front of a part is squeezed hot
   * (the squeezed world's speeds are lower than the real ones, so it starts lower): it
   * takes the part toward that heat, faster the thicker the air. Something ahead of it
   * in its own build (a heat shield, a nose) shades it, and it heats far less. Hot enough,
   * it glows a trail behind it.
   */
  private reentry(p: Part, rho: number, v2: number, dt: number): void {
    const g = this.game;
    const v = Math.sqrt(v2);
    const to = g.air.tempAt(p.y) + (HOT_K * (v2 - HOT_FROM * HOT_FROM)) / 2010;
    if (p.temp >= to) return;
    const shaded = this.shaded(p, p.vx / v, p.vy / v);
    const k = (3 * Math.sqrt(rho / 1.225) * (v / 500) * (shaded ? 0.06 : 1)) / Math.sqrt(Math.max(0.5, p.mass / 10));
    g.heat.toward(p, to, k * dt);
    if (!shaded && to > 700 && Math.random() < Math.min(1, rho * 40)) {
      const back = (Math.hypot(p.w, p.h) * PX) / 2;
      g.particles.emit(PK.Fire, p.x - (p.vx / v) * back, p.y - (p.vy / v) * back, {
        vx: p.vx * 0.85, vy: p.vy * 0.85, life: 0.25, size: 0.25, size1: 0.05, color: 0xfff1c0, color1: 0xff5a1a, alpha: 0.9, alpha1: 0, gravity: 0, drag: 6,
      });
    }
  }

  /** Is something of its own build ahead of it, going this way (unit vector)? (Looked at every few steps.) */
  private shaded(p: Part, ux: number, uy: number): boolean {
    const c = shade.get(p);
    const now = this.game.time;
    if (c && now - c.at < 0.1 && now >= c.at) return c.on;
    let on = false;
    const r = (Math.hypot(p.w, p.h) * PX) / 2;
    for (const e of this.game.connections.builtWith(p.entity)) {
      for (const q of e.parts) {
        if (q === p || q.destroyed) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const ahead = dx * ux + dy * uy;
        if (ahead <= 0 || ahead > r + 3) continue;
        const side = Math.abs(dx * uy - dy * ux);
        if (side < (Math.max(q.w, q.h) * PX) / 2) {
          on = true;
          break;
        }
      }
      if (on) break;
    }
    shade.set(p, { at: now, on });
    return on;
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

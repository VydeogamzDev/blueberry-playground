import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Appliance } from './Appliance';
import type { PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import { ROTOR_FRAMES } from '../art/machines2';
import type { PixelArt } from '../art/PixelArt';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** The speeds a fan or propeller can be set to, as shares of its own (the context menu's). */
export const AIR_SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/** What blades and wind act on: things, not the floor and walls. */
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);
/** The floor and walls only (the wind doesn't blow through them). */
const WALLS = groups(GROUP.DEBRIS, GROUP.STATIC);
/** How often the blades look for what they touch, and the wind for what it reaches (s). */
const BLADE_T = 0.06;
const WIND_T = 0.1;

/** Where a rotor's blades are (art px, x1 and y1 excluded). */
export interface BladeZone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

let bladeBox: RAPIER.Cuboid | null = null;
let windBox: RAPIER.Cuboid | null = null;
let ray: RAPIER.Ray | null = null;

/**
 * Something with blades turning at its front while it's powered (and switched
 * on): a fan or a propeller. Whatever the blades touch is cut and flung out
 * the front; anything hard gets a clang and sparks instead.
 */
export abstract class Airscrew extends Appliance {
  /** Its speed as a share of its own (see AIR_SPEEDS). */
  speed = 1;
  private frames: (f: number) => PixelArt;
  private zone: BladeZone;
  private spin = 0;
  private shown = 0;
  private bladeT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, frames: (f: number) => PixelArt, zone: BladeZone, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.frames = frames;
    this.zone = zone;
  }

  /** Its push along its facing (a unit vector). */
  protected forward(): { x: number; y: number } {
    return this.main.localDir(this.main.flip, 0);
  }

  /** What the running rotor does besides cutting: blow (a fan) or pull itself along (a propeller). */
  protected abstract drive(dt: number): void;

  protected run(dt: number): void {
    this.drive(dt);
    this.game.sound.hold(this, 'machine/fan_loop', 0.18 + 0.14 * Math.min(2, this.speed), this.main.x, 0.75 + 0.35 * this.speed);
    if ((this.bladeT -= dt) > 0) return;
    this.bladeT = BLADE_T;
    this.cut();
  }

  /** What the blades touch: cut and flung, or clanged off. */
  private cut(): void {
    const p = this.main;
    const z = this.zone;
    const game = this.game;
    const phys = game.physics;
    const c = p.pixelToWorld((z.x0 + z.x1) / 2 - 0.5, (z.y0 + z.y1) / 2 - 0.5);
    const box = (bladeBox ??= new RAPIER.Cuboid(1, 1));
    box.halfExtents = { x: ((z.x1 - z.x0) / 2) * PX, y: ((z.y1 - z.y0) / 2) * PX };
    const hit = new Set<Part>();
    phys.world.intersectionsWithShape(c, p.body.rotation(), box, (col) => {
      const q = phys.partOf(col);
      if (q && !q.destroyed && q.entity !== this && !p.noCollide?.has(q) && !q.noCollide?.has(p)) hit.add(q);
      return true;
    }, undefined, THINGS);
    if (!hit.size) return;
    const f = this.forward();
    const s = this.speed;
    for (const q of hit) {
      const at = { x: (q.x + c.x) / 2, y: (q.y + c.y) / 2 };
      if (q.mat.sparks) {
        // something hard: the blades clang off it, throwing sparks
        game.particles.sparks(at.x, at.y, f.x, f.y, 3, 4);
        game.sound.impact(q.mat.sound, 0.4, at.x);
        if (!q.frozen) q.body.applyImpulseAtPoint({ x: f.x * 6 * s, y: f.y * 6 * s }, at, true);
        q.entity.damage(q, 2 * s, 'blunt', at, f);
        continue;
      }
      // soft: cut, and flung out the front with a bit of a spin
      q.entity.damage(q, 9 * s, 'cut', at, f);
      if (q.destroyed) continue;
      if (q.mat.bleeds) game.particles.blood(at.x, at.y, f.x, f.y + 0.3, 4 * s, 3, q.body);
      else game.particles.debris(at.x, at.y, f.x, f.y, 2, q.mat.debrisColor, 3);
      game.sound.slash(at.x);
      if (!q.frozen) {
        const m = Math.min(q.mass, 12);
        const side = (Math.random() - 0.5) * 2;
        const v = 3 + 3 * s;
        q.body.applyImpulseAtPoint({ x: (f.x - f.y * side * 0.4) * m * v, y: (f.y + f.x * side * 0.4) * m * v }, at, true);
      }
    }
  }

  /** The blades turn (on every screen: drawn as a frame is). */
  frame(dt: number): void {
    if (!this.live || this.destroyed) return;
    this.spin += dt * (14 + 22 * this.speed);
    const f = Math.floor(this.spin) % ROTOR_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(this.frames(f));
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    for (const s of AIR_SPEEDS) acts.push({ label: `Speed ${s * 100}%`, checked: this.speed === s, action: () => (this.speed = s) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), speed: this.speed };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.speed = AIR_SPEEDS.includes(x.speed as number) ? (x.speed as number) : 1;
  }
}

// ------------------------------------------------------------------ fan

/** How fast the wind leaves a fan at full speed (m/s), how far it reaches, and how wide it spreads (half the angle, rad). */
const WIND = 12;
const REACH = 10;
const SPREAD = 0.42;
/** Its draw behind it: a share of the wind, over a shorter reach. */
const DRAW = 0.35;
const DRAW_REACH = 4;
/** Push (N) per metre of a thing's breadth per m/s of wind past it. */
const PUSH = 45;
/**
 * How hard (N) it's pushed back as it blows, at full speed: far less than a propeller
 * pulls, so one standing on the floor stays put, but one built onto a cart on wheels
 * drives it along (blowing backward, it goes forward).
 */
const THRUST = 30;

/** Something in a fan's wind (or its draw), and how much of it the wind catches. */
interface Gust {
  part: Part;
  /** Its breadth across the wind (m), less what its own other parts shield. */
  breadth: number;
  /** In the draw behind, not the wind in front. */
  behind: boolean;
}

/**
 * A floor fan: while powered, it blows what's in front of it away (in a cone
 * that weakens with distance) and draws in what's behind it, light things more
 * than heavy ones, and is pushed back a little itself. What it's built into
 * (welded, hinged or pinned to it) it leaves be: a cart it's fixed to the back
 * of isn't drawn backward by it. Its exposed blades cut and fling whatever
 * touches them.
 */
export class Fan extends Airscrew {
  private gusts: Gust[] = [];
  private windT = 0;
  private dustT = 0;

  /** Its wind's speed at a point (m/s, along the wind), or 0 outside it. */
  private windAt(x: number, y: number, behind: boolean): number {
    const p = this.main;
    const f = this.forward();
    const dx = x - p.x;
    const dy = y - p.y;
    const along = (dx * f.x + dy * f.y) * (behind ? -1 : 1);
    const across = Math.abs(dx * -f.y + dy * f.x);
    const reach = behind ? DRAW_REACH : REACH;
    if (along <= 0 || along > reach) return 0;
    const ang = Math.atan2(across, along + 0.4);
    if (ang > SPREAD) return 0;
    const k = (1 - along / reach) * (1 - (ang / SPREAD) ** 2);
    return WIND * this.speed * k * (behind ? DRAW : 1);
  }

  /** Looks for what's in the wind and the draw (a few times a second: the wind itself is applied every step). */
  private gather(): void {
    const p = this.main;
    const phys = this.game.physics;
    const f = this.forward();
    const own = this.game.connections.builtWith(this);
    this.gusts.length = 0;
    const found = new Map<Entity, Part[]>();
    for (const behind of [false, true]) {
      const reach = behind ? DRAW_REACH : REACH;
      const dir = behind ? -1 : 1;
      const c = { x: p.x + f.x * dir * reach * 0.5, y: p.y + f.y * dir * reach * 0.5 };
      const box = (windBox ??= new RAPIER.Cuboid(1, 1));
      box.halfExtents = { x: reach * 0.5, y: Math.tan(SPREAD) * (reach + 0.4) };
      phys.world.intersectionsWithShape(c, Math.atan2(f.y, f.x), box, (col) => {
        const q = phys.partOf(col);
        if (!q || q.destroyed || q.frozen || own.has(q.entity) || p.noCollide?.has(q)) return true;
        if (!this.windAt(q.x, q.y, behind)) return true;
        let list = found.get(q.entity);
        if (!list) found.set(q.entity, (list = []));
        if (!list.includes(q)) list.push(q);
        return true;
      }, undefined, THINGS);
      for (const parts of found.values()) {
        // (the wind blows past a person's limbs one behind another: what it catches
        // is no more than the breadth of the whole of them, shared out)
        let sum = 0;
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of parts) {
          const b = this.breadth(q, f);
          sum += b;
          const t = q.x * -f.y + q.y * f.x;
          lo = Math.min(lo, t - b / 2);
          hi = Math.max(hi, t + b / 2);
        }
        const share = sum > 0 ? Math.min(1, (hi - lo) / sum) : 1;
        for (const q of parts) {
          if (this.open(q)) this.gusts.push({ part: q, breadth: this.breadth(q, f) * share, behind });
        }
      }
      found.clear();
    }
  }

  /** How broad a part is across the wind (m): its sprite's extent at right angles to `f`. */
  private breadth(q: Part, f: { x: number; y: number }): number {
    const u = q.localDir(1, 0);
    const n = { x: -f.y, y: f.x };
    return (q.w * Math.abs(u.x * n.x + u.y * n.y) + q.h * Math.abs(-u.y * n.x + u.x * n.y)) * PX;
  }

  /** No wall or hill between the fan and `q`. */
  private open(q: Part): boolean {
    const p = this.main;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) return true;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    r.origin = { x: p.x, y: p.y };
    r.dir = { x: dx / d, y: dy / d };
    return !this.game.physics.world.castRay(r, d, true, undefined, WALLS);
  }

  protected drive(dt: number): void {
    if ((this.windT -= dt) <= 0) {
      this.windT = WIND_T;
      this.gather();
    }
    const f = this.forward();
    for (const g of this.gusts) {
      const q = g.part;
      if (q.destroyed || q.frozen) continue;
      const w = this.windAt(q.x, q.y, g.behind);
      if (!w) continue;
      // the wind pushes it toward its own speed (it doesn't blow things along faster
      // than itself); behind the fan the air moves toward it too, so that draws things in
      const v = q.body.linvel();
      const rel = w - (v.x * f.x + v.y * f.y);
      if (rel <= 0) continue;
      const push = PUSH * g.breadth * rel * dt;
      q.body.applyImpulse({ x: f.x * push, y: f.y * push }, true);
    }
    // the air it throws forward pushes it back, less the nearer it goes to the wind's own speed
    const p = this.main;
    if (!p.frozen) {
      const v = p.body.linvel();
      const back = THRUST * this.speed * Math.min(1, Math.max(0, 1 + (v.x * f.x + v.y * f.y) / (WIND * this.speed)));
      p.body.applyImpulse({ x: -f.x * back * dt, y: -f.y * back * dt }, true);
    }
    // a little dust carried along in the wind, to see it by
    if ((this.dustT -= dt) > 0) return;
    this.dustT = 0.08 / Math.max(0.25, this.speed);
    const o = p.pixelToWorld(17, 4 + Math.random() * 12);
    const sp = WIND * this.speed * (0.5 + Math.random() * 0.4);
    this.game.particles.emit(PK.Dust, o.x, o.y, {
      vx: f.x * sp + (Math.random() - 0.5), vy: f.y * sp + (Math.random() - 0.5), life: 0.35 + Math.random() * 0.3,
      size: 0.04, size1: 0.02, color: 0xd8dde0, color1: 0xb8c0c4, alpha: 0.35, alpha1: 0, gravity: 0, drag: 1.5,
    });
  }
}

// ------------------------------------------------------------------ propeller

/** How fast (m/s, along its pull) a propeller stops pulling at full speed. */
export const PROP_TOP = 16;

/**
 * A propeller: while powered, it pulls along its facing (whatever it's fixed
 * to with it), less the faster it already goes that way. Its blades cut what
 * touches them; it doesn't blow things about.
 */
export class Propeller extends Airscrew {
  /** Its pull (N) from standing still at full speed. */
  force: number;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, frames: (f: number) => PixelArt, zone: BladeZone, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, frames, zone, x, y, opts);
    this.force = force;
  }

  protected drive(dt: number): void {
    const p = this.main;
    if (p.frozen) return;
    const f = this.forward();
    const v = p.body.linvel();
    const top = PROP_TOP * Math.sqrt(this.speed);
    const pull = this.force * this.speed * Math.min(1, Math.max(0, 1 - (v.x * f.x + v.y * f.y) / top));
    p.body.applyImpulse({ x: f.x * pull * dt, y: f.y * pull * dt }, true);
  }
}

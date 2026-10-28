import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import { clamp, wrapAngle, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
import { LineBatch } from '../systems/Connections';
import { isLiving } from '../systems/Fighting';
import { Prop, type PropConfig } from './Prop';
import { Car } from './Car';
import { MISSILE, MORTAR, MORTAR_ELEVATION, VLS, launcherArt, vlsArt, type MissileKind } from '../art/missiles';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ExplosionOpts } from '../systems/Explosions';
import type { ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import type { Passing } from './Tank';

/** How a kind of missile flies (see Missile). */
export interface MissileSpec {
  /** Its speed under its motor (m/s), how fast it gets there (m/s²), how fast it can turn (rad/s), and how long the motor burns (s). */
  cruise: number;
  accel: number;
  turn: number;
  burn: number;
  /**
   * It attacks from above (the Spike's top attack): it flies at a point over its
   * target, the higher the further off that is, and dives on it from close in.
   */
  loft: boolean;
}

/**
 * What a missile steers for: the cursor (see Game.cursor), a target it was sent
 * after (`part`, at the point `local` on it; or the whole `entity`'s middle; or,
 * neither, the point `at`), or nothing (it flies straight on).
 */
export type Guide =
  | { kind: 'cursor' }
  | { kind: 'target'; entity: Entity | null; part: Part | null; local: V2; at: V2 }
  | { kind: 'none' };

/** The way it leaves the tube: thrown out a few metres a second with its motor not yet lit, which lights once it's clear (a soft launch). */
const LAUNCH = 11;
const IGNITE = 0.09;
/**
 * A vertical launch (the TOR-M1's cold launch): a gas catapult throws it
 * straight up out of its cell at EJECT m/s, motor unlit; JETS_AFTER s later
 * gas jets in its nose turn it over toward what it's after, at up to JET_TURN
 * rad/s (for at most JETS_MAX s), and once it points there its motor lights.
 */
const EJECT = 20;
const JETS_AFTER = 0.14;
const JET_TURN = 7;
const JETS_MAX = 0.6;
/** How fast its fins take out any way it's sliding sideways (1/s): it flies where it points, a little behind on a hard turn. */
const LIFT = 10;
/** Seconds of flight after which a missile that has hit nothing goes off in the air. */
const MAX_FLIGHT = 14;
/** How far (m) a missile goes before it can hit what it came out of. */
const CLEAR = 2.5;
/** The longest (s) it goes through its own side it was fired past (see Missile.launch()). */
const PASS_MOST = 6;
/** Within this (m) of the cursor a mouse-guided missile holds its course (it would only circle the point). */
const CURSOR_NEAR = 1.2;
/**
 * Seeking a target, it looks ahead along its way (ray casts, as far as it goes
 * in LOOK_T s, at least LOOK_MIN m, never past the target) for anything in the
 * way; blocked, it tries turning DETOURS rad off it, upward first (over), then
 * down (round under), and keeps a clear one DETOUR_HOLD s before looking again.
 */
const LOOK_T = 0.55;
const LOOK_MIN = 4;
const DETOURS = [0.5, 1.0, 1.45, -0.6];
const DETOUR_HOLD = 0.1;
/** A lofting missile's height over its target (m): none within LOFT_FROM m of it, then LOFT m more per metre further off, up to LOFT_MAX. */
const LOFT_FROM = 8;
const LOFT = 0.3;
const LOFT_MAX = 6;
/**
 * The warhead: a blast like an RPG's, and a shaped charge's jet that goes
 * into what it struck (a vehicle's body, wherever on it it hit): a car is
 * wrecked outright, a tank's armour lets a share of it through.
 */
export const WARHEAD: ExplosionOpts & { jet: number } = { power: 120, radius: 3.4, damage: 240, shrapnel: 4, jet: 900 };
/** The tail's middle (art pixel), where the motor's flame comes out. */
const NOZZLE: [number, number] = [-0.5, MISSILE.h / 2 - 0.5];
/** What a missile's look ahead sees: anything solid. */
const SIGHT = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

type Phase = 'eject' | 'turn' | 'boost' | 'coast';
const PHASES: Phase[] = ['eject', 'turn', 'boost', 'coast'];

/** The body angle that points a part flipped `flip` at `heading` (rad: 0 right, up positive). */
export function angleFor(heading: number, flipped: boolean): number {
  return flipped ? heading - Math.PI : heading;
}

/**
 * A guided missile in flight. Out of the launcher it's thrown clear, motor
 * unlit (straight up out of a vertical cell, then turned over by gas jets in
 * its nose: see launch()); then its motor lights and it flies on under it,
 * steering for what it's guided to (see Guide) no faster than its fins turn
 * it, a seeking one round or over what's in its way; burnt out, it falls. It
 * goes off against the first thing it touches (not what it came out of, until
 * it's clear of that), its warhead's jet going into what it hit.
 */
export class Missile extends Entity {
  readonly main: Part;
  readonly spec: MissileSpec;
  readonly kind: MissileKind;
  guide: Guide = { kind: 'none' };
  phase: Phase = 'coast';
  /** Seconds in its phase, and in flight. */
  private t = 0;
  age = 0;
  /** Seconds of motor burn left. */
  burn = 0;
  /** Thrown up out of a vertical cell (see EJECT): it's turned over before its motor lights. */
  private cold = false;
  private spent = false;
  /** Where it was launched from (see CLEAR); where its tail was a step ago (the trail is laid along the way from there). */
  private start: V2 | null = null;
  /** How far on (m, across) it goes through its own side it was fired past (see launch()). */
  private passD = 0;
  private tail: V2 | null = null;
  /** The way round what's in its way it's taking (rad off the way to its target), and for how much longer before it looks again. */
  private detour = 0;
  private detourT = 0;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  /** Things its look ahead sees past: itself, what it came out of while it's still near, and its target. */
  private readonly seen = (c: RAPIER.Collider): boolean => {
    const q = this.game.physics.partOf(c);
    if (!q) return true;
    if (q.entity === this || this.main.noCollide?.has(q)) return false;
    const g = this.guide;
    return g.kind !== 'target' || q.entity !== g.entity;
  };

  constructor(game: Game, def: ItemDef, kind: MissileKind, spec: MissileSpec, art: PixelArt, shapes: ShapeSpec[], density: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.kind = kind;
    this.spec = spec;
    this.main = this.addPart({
      name: 'Missile', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, shapes, density,
      ccd: true, linearDamping: 0, angularDamping: 0, textureKey: def.id,
    });
  }

  /**
   * Sends it off pointing at `heading` (rad) at `speed` m/s on top of the
   * launcher's own `carry`, passing through `own` (its launcher, whoever's on
   * that) and guided by `guide`: `cold`, straight up out of a vertical cell to be
   * turned over (see EJECT), else out of a tube to light just clear of it. A
   * crew on a side fire it `past` their own in the way (see Tank.clear()).
   */
  launch(own: Part[], heading: number, speed: number, cold: boolean, guide: Guide, carry: V2 = { x: 0, y: 0 }, past?: Passing): void {
    const p = this.main;
    p.setNoCollide(past?.parts.length ? [...own, ...past.parts] : own);
    this.passD = past?.d ?? 0;
    p.body.setLinvel({ x: carry.x + Math.cos(heading) * speed, y: carry.y + Math.sin(heading) * speed }, true);
    this.guide = guide;
    this.cold = cold;
    this.setPhase('eject');
    this.start = { x: p.x, y: p.y };
  }

  canRest(): boolean {
    return false;
  }

  /** Where its nose points (rad: 0 right, up positive). */
  heading(): number {
    const r = this.main.body.rotation();
    return this.main.flip > 0 ? r : r + Math.PI;
  }

  private setHeading(h: number): void {
    const p = this.main;
    p.body.setRotation(this.main.flip > 0 ? h : h - Math.PI, false);
    p.body.setAngvel(0, false);
    p.moved();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
    // under its motor the wings hold it up (it flies where it's steered); otherwise it falls
    this.main.body.setGravityScale(phase === 'boost' ? 0 : 1, true);
  }

  preStep(dt: number): void {
    const p = this.main;
    // (frozen in flight: held where it is, motor and all, until it's let go)
    if (this.spent || p.destroyed || p.frozen) return;
    this.age += dt;
    this.t += dt;
    if (this.age > MAX_FLIGHT) {
      this.detonate();
      return;
    }
    // clear of what fired it (and past its own side), it can come down on it like on anything else
    const passing = !!this.start && this.age < PASS_MOST && Math.abs(p.x - this.start.x) < this.passD;
    if (p.noCollide && !passing && (!this.start || this.age > 2 || Math.hypot(p.x - this.start.x, p.y - this.start.y) > CLEAR)) p.setNoCollide(null);
    switch (this.phase) {
      case 'eject':
        // (it keeps pointing the way it was thrown)
        p.body.setAngvel(0, false);
        if (!this.cold && this.t >= IGNITE) this.ignite();
        else if (this.cold && this.t >= JETS_AFTER) this.setPhase('turn');
        break;
      case 'turn':
        this.jets(dt);
        break;
      case 'boost':
        this.fly(dt);
        this.burn -= dt;
        if (this.burn <= 0) this.setPhase('coast');
        break;
      case 'coast': {
        // burnt out: it falls like anything thrown, nose first
        const v = p.body.linvel();
        if (v.x * v.x + v.y * v.y > 1) this.setHeading(Math.atan2(v.y, v.x));
        break;
      }
    }
    this.exhaust();
  }

  /** Turned over by the gas jets in its nose toward what it's after (see EJECT), then lit once it points there. */
  private jets(dt: number): void {
    const p = this.main;
    const want = this.aim(dt);
    const h = this.heading();
    let d = 0;
    if (want) {
      d = wrapAngle(Math.atan2(want.y, want.x) - h);
      this.setHeading(h + clamp(d, -JET_TURN * dt, JET_TURN * dt));
    } else p.body.setAngvel(0, false);
    // puffs of gas from the nose, blown out on the side away from the turn
    const n = p.pixelToWorld(MISSILE.w - 4, MISSILE.h / 2 - 0.5);
    const side = d >= 0 ? -1 : 1;
    const ox = -Math.sin(h) * side;
    const oy = Math.cos(h) * side;
    const ps = this.game.particles;
    for (let i = 0; i < 2; i++) {
      const s = 3 + Math.random() * 4;
      ps.emit(PK.Smoke, n.x, n.y, {
        vx: ox * s + (Math.random() - 0.5), vy: oy * s + (Math.random() - 0.5), life: 0.2 + Math.random() * 0.3,
        size: 0.08, size1: 0.35 + Math.random() * 0.2, color: 0xe8e6e0, color1: 0xb8b6b0, alpha: 0.75, alpha1: 0, gravity: -0.02, drag: 4,
      });
    }
    if (this.t < dt * 1.5) this.game.sound.play('machine/air_release', { gain: 0.35, x: p.x, rate: 1.7 });
    if (!want || Math.abs(d) < 0.08 || this.t >= JETS_MAX) this.ignite();
  }

  /** The motor lights: a flash at the tail and the roar, and it flies on under it (see fly()). */
  private ignite(): void {
    const p = this.main;
    this.setPhase('boost');
    this.burn = this.spec.burn;
    const t = p.pixelToWorld(NOZZLE[0], NOZZLE[1]);
    this.game.particles.flash(t.x, t.y, 0.45);
    this.game.particles.smoke(t.x, t.y, 3, 0.2);
    this.game.sound.play('gun/rocket_launch', { gain: 0.8, x: p.x, rate: 1.2, vary: 0.05 });
  }

  /**
   * Under its motor: its nose turns toward where it's guided (at most its turn
   * rate), its fins take out what it slides sideways, and the motor drives it
   * on along its nose up to its speed.
   */
  private fly(dt: number): void {
    const p = this.main;
    const s = this.spec;
    const want = this.aim(dt);
    let h = this.heading();
    if (want) h += clamp(wrapAngle(Math.atan2(want.y, want.x) - h), -s.turn * dt, s.turn * dt);
    this.setHeading(h);
    const hx = Math.cos(h);
    const hy = Math.sin(h);
    const v = p.body.linvel();
    let along = v.x * hx + v.y * hy;
    const sx = v.x - hx * along;
    const sy = v.y - hy * along;
    along = along < s.cruise ? Math.min(s.cruise, along + s.accel * dt) : Math.max(s.cruise, along - s.accel * dt);
    const k = Math.exp(-LIFT * dt);
    p.body.setLinvel({ x: hx * along + sx * k, y: hy * along + sy * k }, true);
  }

  /** The way it wants to go (a unit vector), or null to hold its course. */
  private aim(dt: number): V2 | null {
    const p = this.main;
    const g = this.guide;
    if (g.kind === 'cursor') {
      const c = this.game.cursor;
      if (!c) return null;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = Math.hypot(dx, dy);
      return d < CURSOR_NEAR ? null : { x: dx / d, y: dy / d };
    }
    if (g.kind !== 'target') return null;
    const at = this.targetPoint(g);
    let ty = at.y;
    if (this.spec.loft) ty += clamp((Math.abs(at.x - p.x) - LOFT_FROM) * LOFT, 0, LOFT_MAX);
    const dx = at.x - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return null;
    return this.avoid({ x: dx / d, y: dy / d }, d, dt);
  }

  /** Where its target is now (followed as it moves: made again mirrored, it's the new one it goes for). */
  private targetPoint(g: Extract<Guide, { kind: 'target' }>): V2 {
    if (g.entity?.destroyed) {
      const next = this.game.successorOf(g.entity);
      if (next !== g.entity) g.part = null;
      g.entity = next;
    }
    if (g.part && !g.part.destroyed && g.part.entity === g.entity) g.at = g.part.localToWorld(g.local.x, g.local.y);
    else if (g.entity && !g.entity.destroyed) g.at = g.entity.center();
    return g.at;
  }

  /**
   * The way to go to get to the target `want` (unit) and `dist` m off: straight
   * there, or, with something in the way (looked for ahead: see LOOK_T), up over
   * it or down round it (see DETOURS).
   */
  private avoid(want: V2, dist: number, dt: number): V2 {
    const v = this.main.body.linvel();
    const look = Math.min(dist - 0.3, Math.max(LOOK_MIN, Math.hypot(v.x, v.y) * LOOK_T));
    if (look < 0.5) return want;
    const turn = (a: number): V2 => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      return { x: want.x * c - want.y * s, y: want.x * s + want.y * c };
    };
    if (this.detourT > 0) {
      this.detourT -= dt;
      return turn(this.detour);
    }
    if (this.clearAlong(want, look)) {
      this.detour = 0;
      return want;
    }
    // (turning anticlockwise lifts the way to the right: up is that way facing right, the other facing left)
    const up = want.x >= 0 ? 1 : -1;
    this.detourT = DETOUR_HOLD;
    for (const k of DETOURS) {
      const d = turn(k * up);
      if (!this.clearAlong(d, look)) continue;
      this.detour = k * up;
      return d;
    }
    // (boxed in: climb hard)
    this.detour = DETOURS[2] * up;
    return turn(this.detour);
  }

  /** Nothing in the way from its nose `len` m along `d`? */
  private clearAlong(d: V2, len: number): boolean {
    const p = this.main;
    const r = this.ray;
    r.origin = { x: p.x, y: p.y };
    r.dir = d;
    return !this.game.physics.world.castRay(r, len, true, undefined, SIGHT, undefined, undefined, this.seen);
  }

  /** The motor's flame and a thin trail of smoke while it burns, laid along the way it came; then the hot motor smokes a moment. */
  private exhaust(): void {
    const p = this.main;
    const t = p.pixelToWorld(NOZZLE[0], NOZZLE[1]);
    const from = this.tail ?? t;
    this.tail = t;
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const d = Math.hypot(dx, dy);
    const ps = this.game.particles;
    if (this.phase === 'boost') {
      const f = p.localDir(p.flip, 0);
      const n = Math.max(1, Math.ceil(d / 0.14));
      for (let i = 0; i < n; i++) {
        const k = (i + Math.random()) / n;
        const x = from.x + dx * k;
        const y = from.y + dy * k;
        const s = 2.5 + Math.random() * 2.5;
        ps.emit(PK.Fire, x, y, {
          vx: -f.x * s + (Math.random() - 0.5), vy: -f.y * s + (Math.random() - 0.5), life: 0.03 + Math.random() * 0.04,
          size: 0.1 + Math.random() * 0.05, size1: 0.03, color: 0xfff4c8, color1: 0xe0601c, alpha: 1, alpha1: 0.4, gravity: 0, drag: 3,
        });
        if (Math.random() < 0.75) {
          ps.emit(PK.Smoke, x, y, {
            vx: (Math.random() - 0.5) * 0.4, vy: 0.15 + Math.random() * 0.3, life: 1 + Math.random() * 1.2,
            size: 0.07, size1: 0.32 + Math.random() * 0.25, color: 0xd2d0ca, color1: 0x8e8c88, alpha: 0.45, alpha1: 0, gravity: -0.03, drag: 1.5,
          });
        }
      }
      this.game.sound.hold(this, 'machine/thruster_loop', 0.45, p.x, 1.6);
    } else if (this.phase === 'coast' && this.t < 1 && d > 0) {
      for (let i = Math.ceil(d / 0.35); i > 0; i--) {
        if (Math.random() > 0.6) continue;
        const k = Math.random();
        ps.emit(PK.Smoke, from.x + dx * k, from.y + dy * k, {
          vx: (Math.random() - 0.5) * 0.4, vy: 0.2 + Math.random() * 0.3, life: 0.7 + Math.random() * 0.7,
          size: 0.06, size1: 0.25, color: 0xb8b4ae, color1: 0x6e6c6a, alpha: 0.3, alpha1: 0, gravity: -0.03, drag: 1.5,
        });
      }
    }
  }

  /** Touching anything (the floor included) sets it off; not what fired it, while it's still near that. */
  postStep(): void {
    if (this.spent) return;
    const phys = this.game.physics;
    const world = phys.world;
    const p = this.main;
    let hit = false;
    let struck: Part | null = null;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (o) => {
        if (hit) return;
        const q = phys.partOf(o);
        if (q && (q.destroyed || p.noCollide?.has(q))) return;
        world.contactPair(c, o, (m) => {
          for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.02) hit = true;
        });
        if (hit) struck = q ?? null;
      });
    }
    if (hit) this.detonate(struck);
  }

  frame(): void {
    if (this.spent || this.phase !== 'boost') return;
    const t = this.main.pixelToWorld(NOZZLE[0], NOZZLE[1]);
    const flicker = 0.85 + Math.random() * 0.3;
    this.game.renderer.addLight(t.x, t.y, 2 * flicker, 0.6 * flicker, 0xffb060);
  }

  onImpact(info: ImpactInfo): void {
    if (info.other && this.main.noCollide?.has(info.other)) return;
    this.detonate(info.other);
  }

  onBullet(): void {
    this.detonate();
  }

  damage(_part: Part, amount: number, kind: DamageKind): void {
    if (kind !== 'fire' && amount > 5) this.detonate();
  }

  /**
   * Goes off: the blast, and the shaped charge's jet into what it struck (a
   * vehicle's body, wherever on the vehicle it hit; people and animals have the
   * blast to reckon with already).
   */
  detonate(struck: Part | null = null): void {
    if (this.spent || this.destroyed) return;
    this.spent = true;
    const t = this.main.body.translation();
    if (struck && !struck.destroyed && !struck.entity.destroyed && !isLiving(struck.entity)) {
      const e = struck.entity;
      const into = e instanceof Car ? e.body : struck;
      const h = this.heading();
      if (!into.destroyed) e.damage(into, WARHEAD.jet, 'explosion', { x: t.x, y: t.y }, { x: Math.cos(h), y: Math.sin(h) });
    }
    const { power, radius, damage, shrapnel } = WARHEAD;
    this.game.explosions.explode(t.x, t.y, { power, radius, damage, shrapnel, source: this });
    this.game.remove(this);
  }

  protected serializeExtra(): Record<string, unknown> {
    const g = this.guide;
    const x: Record<string, unknown> = { phase: this.phase, t: this.t, age: this.age, burn: this.burn, guide: g.kind };
    if (this.cold) x.cold = true;
    if (g.kind === 'target') x.at = [g.at.x, g.at.y];
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.age === 'number') this.age = x.age;
    this.cold = !!x.cold;
    const phase = PHASES.find((k) => k === x.phase) ?? 'coast';
    this.setPhase(phase);
    if (typeof x.t === 'number') this.t = x.t;
    if (typeof x.burn === 'number') this.burn = clamp(x.burn, 0, this.spec.burn);
    const at = x.at as number[] | undefined;
    if (x.guide === 'cursor') this.guide = { kind: 'cursor' };
    else if (x.guide === 'target' && Array.isArray(at) && at.every(Number.isFinite)) this.guide = { kind: 'target', entity: null, part: null, local: { x: 0, y: 0 }, at: { x: at[0], y: at[1] } };
  }

  /** The target it's after (by snapshot index), and which of its parts. */
  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const g = this.guide;
    if (g.kind !== 'target' || !g.entity || g.entity.destroyed) return undefined;
    const i = ref(g.entity);
    if (i < 0) return undefined;
    const part = g.part && !g.part.destroyed ? g.entity.parts.indexOf(g.part) : -1;
    return { target: i, part, local: [g.local.x, g.local.y] };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const g = this.guide;
    const e = get(links.target as number);
    if (g.kind !== 'target' || !e || e.destroyed) return;
    g.entity = e;
    const part = e.parts[links.part as number];
    const local = links.local as number[] | undefined;
    if (part && !part.destroyed && Array.isArray(local) && local.every(Number.isFinite)) {
      g.part = part;
      g.local = { x: local[0], y: local[1] };
    }
  }
}

// ---------------------------------------------------------------- the launchers

/** Seconds a launcher takes to have its next missile in. */
const RELOAD = 3;
/** Seconds a vertical cell's hatch stands open after a missile goes. */
const HATCH_OPEN = 0.7;

/** Where a missile leaves a vertical cell, and which way (up out of it): `cell` 0 or 1. */
function cellTop(p: Part, cell: number): V2 {
  const [x0, x1] = VLS.cells[cell];
  return p.pixelToWorld((x0 + x1) / 2 - 0.5, VLS.top - 0.5);
}

/**
 * A guided missile's launcher, set on the ground: a squat tube on a bipod and
 * baseplate, aimed by turning it (its missile leaves along the tube), or, set
 * to Vertical launch in its menu, the top of a vertical launch cell that throws
 * its missiles straight up and lets them turn over toward what they're after
 * (see Missile). It reloads by itself. Which it is is its config (`vertical`):
 * kept in saves and copies, and the menu makes it again the other way.
 */
export abstract class GuidedLauncher extends Prop {
  readonly kind: MissileKind;
  readonly vertical: boolean;
  loaded = true;
  /** Seconds until the next missile is in. */
  reload = 0;
  shots = 0;
  /** The cell the next missile goes from (vertical), and how long the last one's hatch stays open. */
  private cell = 0;
  private hatch = 0;
  /** Aimed with the cursor: F works it (when it's selected) whatever the cursor is over (see Controls). */
  readonly cursorAimed = true;
  protected readonly round: ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: MissileKind, round: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    this.round = round;
    this.vertical = opts.config?.vertical === true;
    if (this.vertical) this.config = { vertical: true };
    this.activatable = true;
  }

  /** Its look: loaded or not, or a cell's hatch open. */
  private show(): void {
    if (this.main.destroyed) return;
    this.main.setArt(this.vertical ? vlsArt(this.kind, this.hatch > 0 ? 1 - this.cell : -1) : launcherArt(this.kind, this.loaded));
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.hatch > 0 && (this.hatch -= dt) <= 0) this.show();
    if (this.loaded || (this.reload -= dt) > 0) return;
    this.loaded = true;
    this.show();
    this.game.sound.play('gun/rpg_reload', { gain: 0.35, x: this.main.x, rate: 1.15, vary: 0.04 });
  }

  /**
   * Fires the missile it has in, guided by `guide`: out of its tube along it,
   * or thrown straight up out of the next cell. False if it isn't loaded (it
   * clicks).
   */
  fire(guide: Guide): boolean {
    const p = this.main;
    const game = this.game;
    if (this.destroyed || p.destroyed) return false;
    if (!this.loaded) {
      game.sound.play('gun/dryfire', { gain: 0.4, x: p.x });
      return false;
    }
    let at: V2;
    let dir: V2;
    if (this.vertical) {
      at = cellTop(p, this.cell);
      dir = p.localDir(0, 1);
    } else {
      const [mx, my] = MORTAR.muzzle;
      at = p.pixelToWorld(mx - 0.5, my - 0.5);
      dir = p.localDir(Math.cos(MORTAR_ELEVATION) * p.flip, Math.sin(MORTAR_ELEVATION));
    }
    const heading = Math.atan2(dir.y, dir.x);
    // (its tail just inside the tube or the cell: it slides out from behind it)
    const back = (MISSILE.w / 2 - (this.vertical ? 3 : 6)) * PX;
    const c = { x: at.x + dir.x * back, y: at.y + dir.y * back };
    const m = game.spawn(this.round, c.x, c.y, { flip: this.flipped, angle: angleFor(heading, this.flipped) });
    if (!(m instanceof Missile)) return false;
    m.zBase = this.zBase - 0.01;
    for (const q of m.parts) q.updateZ();
    m.launch(this.parts, heading, this.vertical ? EJECT : LAUNCH, this.vertical, guide, p.velocityAt(at.x, at.y));
    this.loaded = false;
    this.reload = RELOAD;
    this.shots++;
    const ps = game.particles;
    if (this.vertical) {
      // the gas catapult's cloud out of the cell, and its hatch flipped open
      this.hatch = HATCH_OPEN;
      this.cell = 1 - this.cell;
      for (let i = 0; i < 14; i++) {
        const s = 1 + Math.random() * 3;
        const a = (Math.random() - 0.5) * 2.6;
        ps.emit(PK.Smoke, at.x, at.y, {
          vx: (dir.x * Math.cos(a) - dir.y * Math.sin(a)) * s, vy: (dir.y * Math.cos(a) + dir.x * Math.sin(a)) * s, life: 0.8 + Math.random() * 1.2,
          size: 0.12, size1: 0.6 + Math.random() * 0.4, color: 0xeeece6, color1: 0xbcbab4, alpha: 0.7, alpha1: 0, gravity: -0.04, drag: 3,
        });
      }
      game.sound.play('gun/launcher', { gain: 0.7, x: at.x, rate: 0.75, vary: 0.04 });
      game.sound.play('machine/air_release', { gain: 0.45, x: at.x, rate: 0.8 });
    } else {
      // a puff out of the muzzle, and the soft launch's gas out of the back
      ps.smoke(at.x + dir.x * 0.2, at.y + dir.y * 0.2, 3, 0.2);
      const b = p.pixelToWorld(MORTAR.breech[0] - 0.5, MORTAR.breech[1] - 0.5);
      for (let i = 0; i < 8; i++) {
        const s = 1 + Math.random() * 3;
        ps.emit(PK.Smoke, b.x, b.y, {
          vx: -dir.x * s + (Math.random() - 0.5), vy: -dir.y * s + (Math.random() - 0.5) * 0.5 + 0.3, life: 0.8 + Math.random() * 0.8,
          size: 0.12, size1: 0.45, color: 0xc8c6c0, color1: 0x8a8884, alpha: 0.5, alpha1: 0, gravity: -0.04, drag: 2.5,
        });
      }
      game.sound.play('gun/launcher', { gain: 0.8, x: at.x, rate: 0.9, vary: 0.04 });
    }
    this.show();
    game.renderer.shake(0.05);
    game.alarm(at.x, at.y, 25);
    return true;
  }

  /** Normal or vertical launch: it's made again the other way, its foot where it stands. */
  setVertical(on: boolean): void {
    if (on === this.vertical || this.destroyed) return;
    const p = this.main;
    const foot = p.localToWorld(0, (-p.h / 2) * PX);
    const up = p.localDir(0, 1);
    const h = (on ? VLS.h : MORTAR.h) / 2;
    this.game.rebuildEntity(this, on ? { vertical: true } : undefined, { x: foot.x + up.x * h * PX, y: foot.y + up.y * h * PX });
  }

  /** The launch menu's two entries. */
  protected launchActions(): ContextAction[] {
    return [
      { label: 'Normal launch', checked: !this.vertical, action: () => this.setVertical(false) },
      { label: 'Vertical launch', checked: this.vertical, action: () => this.setVertical(true) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const x: Record<string, unknown> = {};
    if (!this.loaded) x.reload = this.reload;
    if (this.cell) x.cell = 1;
    return Object.keys(x).length ? x : undefined;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.cell = x.cell === 1 ? 1 : 0;
    if (typeof x.reload === 'number') {
      this.loaded = false;
      this.reload = clamp(x.reload, 0, RELOAD);
    }
    this.show();
  }
}

/**
 * The mouse-guided launcher: Use fires, and the missile flies where the
 * cursor is (see Game.cursor), turning as it's moved.
 */
export class MouseLauncher extends GuidedLauncher {
  activate(): void {
    this.fire({ kind: 'cursor' });
  }

  contextActions(): ContextAction[] {
    return [{ label: this.loaded ? 'Fire' : 'Reloading…', hint: 'F', disabled: !this.loaded, action: () => this.activate() }, ...this.launchActions()];
  }
}

/** What the Spike's seeker has under its gate: a part of something at a point on it, or a point on the ground. */
interface Sighted {
  entity: Entity | null;
  part: Part | null;
  /** The point on the part it's on (part-local), and where that is now. */
  local: V2;
  at: V2;
}

/**
 * The reticle's measures (screen pixels): the corner brackets' half-size and
 * their arms' length, the gate's half-size; and how long (s) the gate must be
 * kept on something for the seeker to lock on.
 */
const BRACKET = 56;
const ARM = 15;
const GATE = 8;
const LOCK_TIME = 0.7;
/** Locked on, the lock holds while the target stays within this many brackets' size of the cursor. */
const HOLD_LOCK = 1.5;

/**
 * The Spike LR-II's launcher: a fire-and-forget seeker missile. Holding Use
 * switches its seeker on, a reticle round the cursor (corner brackets, and in
 * the middle the gate that locks on: see Reticles); kept on a vehicle, a person,
 * an animal (or failing those, anything solid) for LOCK_TIME, the gate locks on
 * and follows it. Letting go of Use with a lock fires, and the missile flies
 * itself to the target, over what's in the way and down on it from above; let
 * go without one, nothing fires.
 */
export class SpikeLauncher extends GuidedLauncher {
  /** What the gate is on, how long it's been on it (s), and what it has locked on. */
  sighted: Sighted | null = null;
  locking = 0;
  lock: Sighted | null = null;
  private beepT = 0;

  /** (Use only works its seeker: held down, see setActiveHeld()). */
  activate(): void {}

  setActiveHeld(on: boolean): void {
    const was = this.activeHeld;
    super.setActiveHeld(on);
    if (on === was) return;
    if (on) {
      this.sighted = this.lock = null;
      this.locking = 0;
      reticles(this.game).on.add(this);
      this.game.sound.play('machine/switch', { gain: 0.3, rate: 1.6, x: this.main.x });
      return;
    }
    reticleSets.get(this.game)?.on.delete(this);
    const lock = this.lock;
    this.sighted = this.lock = null;
    this.locking = 0;
    if (lock && !this.destroyed) this.fire({ kind: 'target', entity: lock.entity, part: lock.part, local: lock.local, at: { ...lock.at } });
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.activeHeld) this.seek(dt);
  }

  /** The seeker's part of a step: holding its lock, or locking on to what's under the gate. */
  private seek(dt: number): void {
    const c = this.game.cursor;
    const zoom = this.game.renderer.zoom;
    this.beepT -= dt;
    if (!c) {
      this.sighted = this.lock = null;
      this.locking = 0;
      return;
    }
    const lock = this.lock;
    if (lock) {
      const at = this.follow(lock);
      const reach = (BRACKET * HOLD_LOCK) / zoom;
      if (at && Math.abs(at.x - c.x) <= reach && Math.abs(at.y - c.y) <= reach) {
        if (this.beepT <= 0) this.beep(1.9, 0.45);
        return;
      }
      // (gone, or out of the seeker's view)
      this.lock = this.sighted = null;
      this.locking = 0;
      this.game.sound.play('medical/ecg_beep', { gain: 0.2, x: this.main.x, rate: 0.8 });
    }
    const s = this.under(c, GATE / zoom);
    const had = this.sighted;
    if (!s || !had || s.entity !== had.entity || (!s.entity && Math.hypot(s.at.x - had.at.x, s.at.y - had.at.y) > 0.5)) {
      this.sighted = s;
      this.locking = 0;
      return;
    }
    // (the gate stays on the point it found it at, as that moves)
    this.follow(had);
    this.locking += dt;
    if (this.locking >= LOCK_TIME) {
      this.lock = had;
      this.beep(1.9, 0.45);
      this.game.sound.play('medical/ecg_beep', { gain: 0.3, x: this.main.x, rate: 2.4 });
    } else if (this.beepT <= 0) this.beep(1.3, 0.15);
  }

  private beep(rate: number, every: number): void {
    this.beepT = every;
    this.game.sound.play('medical/ecg_beep', { gain: 0.18, x: this.main.x, rate, vary: 0 });
  }

  /** Where a sighted thing is now; null once it's gone. */
  private follow(s: Sighted): V2 | null {
    if (s.part) {
      if (s.part.destroyed) return null;
      s.at = s.part.localToWorld(s.local.x, s.local.y);
    } else if (s.entity) {
      if (s.entity.destroyed) return null;
      s.at = s.entity.center();
    }
    return s.at;
  }

  /**
   * What's under the gate at `c` (`r` m round it): a vehicle first, then a
   * person or an animal, then anything else solid (not this, nor a missile in
   * flight), and failing all that the ground there.
   */
  private under(c: V2, r: number): Sighted | null {
    const parts = this.game.pickAll(c.x, c.y, r, (q) => q.entity !== this && !(q.entity instanceof Missile));
    let best: Part | null = null;
    let rank = 3;
    for (const q of parts) {
      const k = q.entity instanceof Car ? 0 : isLiving(q.entity) ? 1 : 2;
      if (k < rank) {
        rank = k;
        best = q;
      }
    }
    if (best) {
      const near = Math.hypot(best.x - c.x, best.y - c.y) < best.reach ? c : { x: best.x, y: best.y };
      return { entity: best.entity, part: best, local: best.worldToLocal(near.x, near.y), at: { ...near } };
    }
    if (c.y <= WORLD.floor || this.game.env.solidAt(c.x, c.y)) return { entity: null, part: null, local: { x: 0, y: 0 }, at: { ...c } };
    return null;
  }

  /**
   * Its reticle (see Reticles): four corner brackets of a square round the
   * cursor, and the gate in the middle: on the cursor while it looks, round
   * what it's on (blinking, closing in) while it locks on, and once it's locked,
   * solid on the target, following it.
   */
  drawReticle(lines: LineBatch): void {
    const c = this.game.cursor;
    if (!c || this.destroyed) return;
    const px = 1 / this.game.renderer.zoom;
    const b = BRACKET * px;
    const l = ARM * px;
    const lock = this.lock;
    const s = this.sighted;
    const gate = lock?.at ?? s?.at ?? c;
    const g = (lock ? GATE : s ? GATE + 7 * (1 - this.locking / LOCK_TIME) : GATE) * px;
    const blink = !lock && !!s && Math.floor(this.game.time * 10) % 2 === 1;
    const col = lock ? LOCKED : s ? LOCKING : SEEKING;
    // (each line dark first, a little wider, then light over it: it shows on the sky and on the floor)
    for (const [w, dark] of [[3.5, true], [1.5, false]] as const) {
      const wid = w * px;
      const bc = dark ? SHADOW : SEEKING;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = c.x + sx * b;
          const y = c.y + sy * b;
          lines.seg(x, y, x - sx * l, y, wid, bc);
          lines.seg(x, y, x, y - sy * l, wid, bc);
        }
      }
      if (blink) continue;
      const gc = dark ? SHADOW : col;
      lines.seg(gate.x - g, gate.y - g, gate.x + g, gate.y - g, wid, gc);
      lines.seg(gate.x + g, gate.y - g, gate.x + g, gate.y + g, wid, gc);
      lines.seg(gate.x + g, gate.y + g, gate.x - g, gate.y + g, wid, gc);
      lines.seg(gate.x - g, gate.y + g, gate.x - g, gate.y - g, wid, gc);
      if (lock) lines.quad(gate.x, gate.y, (dark ? 4 : 2) * px, gc);
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: 'Fire: hold F on a target, let go once locked', disabled: true, action: () => {} }, ...this.launchActions()];
  }

  protected onDestroy(): void {
    // (without making the reticles' batch, if no seeker has been on yet)
    reticleSets.get(this.game)?.on.delete(this);
  }
}

// ---------------------------------------------------------------- the reticles

/** The reticle's colours: its dark edge, the brackets and a gate looking, locking on, and locked. */
const SHADOW = 0x101410;
const SEEKING = 0xe6ecdf;
const LOCKING = 0xffc040;
const LOCKED = 0xff4a36;

/**
 * The seekers' reticles, drawn over the sandbox each frame (one batch of lines
 * for the game, in front of everything and unlit) for each Spike launcher
 * whose seeker is on: they follow the camera as the world does, and go when
 * Use is let go or the launcher is removed.
 */
class Reticles {
  readonly on = new Set<SpikeLauncher>();
  private readonly lines: LineBatch;

  constructor(game: Game) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.lines = new LineBatch(64, 48, mat);
    this.lines.mesh.renderOrder = 31;
    game.renderer.scene.add(this.lines.mesh);
    game.frameHandlers.push(() => this.frame());
  }

  private frame(): void {
    const L = this.lines;
    L.begin();
    for (const s of this.on) {
      if (s.destroyed || !s.activeHeld) this.on.delete(s);
      else s.drawReticle(L);
    }
    L.end();
  }
}

const reticleSets = new WeakMap<Game, Reticles>();

function reticles(game: Game): Reticles {
  let r = reticleSets.get(game);
  if (!r) reticleSets.set(game, (r = new Reticles(game)));
  return r;
}

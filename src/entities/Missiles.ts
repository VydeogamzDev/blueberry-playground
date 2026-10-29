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
import { MISSILE, MISSILES, MORTAR, MORTAR_ELEVATION, VLS, launcherArt, vlsArt, type MissileKind, type MissileVersion } from '../art/missiles';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ExplosionOpts } from '../systems/Explosions';
import type { ContextAction, DamageKind, EntityConfig, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
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
  /** What goes off when it hits (see WARHEADS). */
  warhead: Warhead;
}

/**
 * What a missile steers for: the cursor of the player `by` who fired it (see
 * Game.cursorOf(); cursorGuide() makes it), `off` it if given (a Strike's
 * missiles each go for a point of their own round it), a target it was sent
 * after (`part`, at the point `local` on it; or the whole `entity`'s middle;
 * or, neither, the point `at`), or nothing (it flies straight on).
 */
export type Guide =
  | { kind: 'cursor'; by: number; off?: V2 }
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
/**
 * Burnt out, it glides (see glide()): its fins still bend its way toward what
 * it's after, at GLIDE of its turn rate at its motor's speed and less as it
 * slows (they work off the air going by); its nose held at most NOSE_OFF rad
 * off the way it's going; the air slows it by DRAG (1/s); and it falls.
 */
const GLIDE = 0.35;
const NOSE_OFF = 0.35;
const DRAG = 0.25;
/** Seconds after its motor burns out that a missile that has hit nothing goes off in the air. */
const AFTER_BURN = 6;
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
/** A warhead: its blast, and its shaped charge's jet into what it struck (see WARHEAD). */
export type Warhead = ExplosionOpts & { jet: number };
/**
 * The standard warhead: a blast like an RPG's, and a shaped charge's jet that
 * goes into what it struck (a vehicle's body, wherever on it it hit): a car is
 * wrecked outright, a tank's armour lets a share of it through.
 */
export const WARHEAD: Warhead = { power: 120, radius: 3.4, damage: 240, shrapnel: 4, jet: 900 };
/**
 * Each version's warhead (see MissileVersion): the cruise missile's twice the
 * charge, a Strike's five half of it each. A blast reaches as far as its
 * charge's cube root: twice the charge, 2^(1/3) times as far.
 */
export const WARHEADS: Record<MissileVersion, Warhead> = {
  standard: WARHEAD,
  cruise: { power: 240, radius: 3.4 * Math.cbrt(2), damage: 480, shrapnel: 8, jet: 1800 },
  strike: { power: 60, radius: 3.4 / Math.cbrt(2), damage: 120, shrapnel: 2, jet: 450 },
};
/** What a missile's look ahead sees: anything solid. */
const SIGHT = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

type Phase = 'eject' | 'turn' | 'boost' | 'coast';
const PHASES: Phase[] = ['eject', 'turn', 'boost', 'coast'];

/**
 * Guided by the cursor of whoever is firing it now (see Game.actor: in a
 * multiplayer game a guest's missile follows the guest's cursor), or of the
 * player `by`, for what fires while Use is held (remember who held it then).
 */
export function cursorGuide(game: Game, by = game.actor): Guide {
  return { kind: 'cursor', by };
}

/** The body angle that points a part flipped `flip` at `heading` (rad: 0 right, up positive). */
export function angleFor(heading: number, flipped: boolean): number {
  return flipped ? heading - Math.PI : heading;
}

/**
 * A guided missile in flight. Out of the launcher it's thrown clear, motor
 * unlit (straight up out of a vertical cell, then turned over by gas jets in
 * its nose: see launch()); then its motor lights and it flies on under it,
 * steering for what it's guided to (see Guide) no faster than its fins turn
 * it, a seeking one round or over what's in its way; burnt out, it glides on,
 * falling, its fins still turning it after what it's after (see glide()). It
 * goes off against the first thing it touches (not what it came out of, until
 * it's clear of that, nor the rest of its salvo: see Salvo), its warhead's jet
 * going into what it hit.
 */
export class Missile extends Entity {
  readonly main: Part;
  readonly spec: MissileSpec;
  readonly kind: MissileKind;
  readonly version: MissileVersion;
  guide: Guide = { kind: 'none' };
  phase: Phase = 'coast';
  /** Fired with others at one launch (a Strike's), that it never touches. */
  salvo: Salvo | null = null;
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
  /** Clear of what it came out of (and its side), it touches all but its salvo again. */
  private cleared = false;
  /** How far on (m, across) it goes through its own side it was fired past (see launch()). */
  private passD = 0;
  /** That side, whose soldiers' bullets don't meet it (see Passing). */
  firedFor: string | null = null;
  private tail: V2 | null = null;
  /** Its art's size (px), and that against the standard missile's (its flame and trail go by it). */
  private readonly size: { w: number; h: number };
  private readonly scale: number;
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

  constructor(game: Game, def: ItemDef, kind: MissileKind, version: MissileVersion, spec: MissileSpec, art: PixelArt, shapes: ShapeSpec[], density: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.kind = kind;
    this.version = version;
    this.spec = spec;
    this.size = MISSILES[version];
    this.scale = this.size.w / MISSILE.w;
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
   * crew on a side fire it `past` their own in the way (see Tank.clear()). One
   * of a salvo (see launchVolley()) passes through the rest of it all the way.
   */
  launch(own: Part[], heading: number, speed: number, cold: boolean, guide: Guide, carry: V2 = { x: 0, y: 0 }, past?: Passing): void {
    const p = this.main;
    p.setNoCollide([...own, ...(past?.parts ?? []), ...(this.salvo?.others(this) ?? [])]);
    this.cleared = false;
    this.passD = past?.d ?? 0;
    this.firedFor = past?.side ?? null;
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
    if (this.age > this.spec.burn + AFTER_BURN) {
      this.detonate();
      return;
    }
    // clear of what fired it (and past its own side), it can come down on it like on anything else (but its salvo)
    const passing = !!this.start && this.age < PASS_MOST && Math.abs(p.x - this.start.x) < this.passD;
    if (!this.cleared && !passing && (!this.start || this.age > 2 || Math.hypot(p.x - this.start.x, p.y - this.start.y) > CLEAR)) {
      this.cleared = true;
      p.setNoCollide(this.salvo?.others(this) ?? null);
    }
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
      case 'coast':
        this.glide(dt);
        break;
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
    const n = p.pixelToWorld(this.size.w - 4, this.size.h / 2 - 0.5);
    const side = d >= 0 ? -1 : 1;
    const ox = -Math.sin(h) * side;
    const oy = Math.cos(h) * side;
    const ps = this.game.particles;
    const k = this.scale;
    for (let i = 0; i < 2; i++) {
      const s = 3 + Math.random() * 4;
      ps.emit(PK.Smoke, n.x, n.y, {
        vx: ox * s + (Math.random() - 0.5), vy: oy * s + (Math.random() - 0.5), life: 0.2 + Math.random() * 0.3,
        size: 0.08 * k, size1: (0.35 + Math.random() * 0.2) * k, color: 0xe8e6e0, color1: 0xb8b6b0, alpha: 0.75, alpha1: 0, gravity: -0.02, drag: 4,
      });
    }
    if (this.t < dt * 1.5) this.game.sound.play('machine/air_release', { gain: 0.35 * k, x: p.x, rate: 1.7 });
    if (!want || Math.abs(d) < 0.08 || this.t >= JETS_MAX) this.ignite();
  }

  /** The middle of its tail, where the motor's flame comes out (world). */
  private nozzle(): V2 {
    return this.main.pixelToWorld(-0.5, this.size.h / 2 - 0.5);
  }

  /** The motor lights: a flash at the tail and the roar, and it flies on under it (see fly()). */
  private ignite(): void {
    const p = this.main;
    this.setPhase('boost');
    this.burn = this.spec.burn;
    const t = this.nozzle();
    this.game.particles.flash(t.x, t.y, 0.45 * this.scale);
    this.game.particles.smoke(t.x, t.y, 3, 0.2 * this.scale);
    this.game.sound.play('gun/rocket_launch', { gain: 0.8 * this.scale, x: p.x, rate: 1.2 / Math.sqrt(this.scale), vary: 0.05 });
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

  /**
   * Burnt out, it glides: falling, but its fins still work off the air going
   * by them, so its way bends after what it's after (at GLIDE of its turn rate
   * at its motor's speed, less as it slows), its nose held a little off its way
   * toward that, and the air slows it. With nothing to steer for, or too slow
   * for its fins to bite, it falls nose first.
   */
  private glide(dt: number): void {
    const p = this.main;
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y);
    if (speed < 1) return;
    const way = Math.atan2(v.y, v.x);
    const want = this.aim(dt);
    const d = want ? wrapAngle(Math.atan2(want.y, want.x) - way) : 0;
    const w = this.spec.turn * GLIDE * Math.min(1, speed / this.spec.cruise);
    const bend = clamp(d, -w * dt, w * dt);
    const s = speed * Math.exp(-DRAG * dt);
    p.body.setLinvel({ x: Math.cos(way + bend) * s, y: Math.sin(way + bend) * s }, true);
    this.setHeading(way + bend + clamp(d - bend, -NOSE_OFF, NOSE_OFF));
  }

  /** The way it wants to go (a unit vector), or null to hold its course. */
  private aim(dt: number): V2 | null {
    const p = this.main;
    const g = this.guide;
    if (g.kind === 'cursor') {
      const c = this.game.cursorOf(g.by);
      if (!c) return null;
      const dx = c.x + (g.off?.x ?? 0) - p.x;
      const dy = c.y + (g.off?.y ?? 0) - p.y;
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
    const t = this.nozzle();
    const from = this.tail ?? t;
    this.tail = t;
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const d = Math.hypot(dx, dy);
    const ps = this.game.particles;
    if (this.phase === 'boost') {
      // (a small missile's flame and trail are smaller, and laid further apart)
      const z = this.scale;
      const f = p.localDir(p.flip, 0);
      const n = Math.max(1, Math.ceil(d / (0.14 / z)));
      for (let i = 0; i < n; i++) {
        const k = (i + Math.random()) / n;
        const x = from.x + dx * k;
        const y = from.y + dy * k;
        const s = 2.5 + Math.random() * 2.5;
        ps.emit(PK.Fire, x, y, {
          vx: -f.x * s + (Math.random() - 0.5), vy: -f.y * s + (Math.random() - 0.5), life: 0.03 + Math.random() * 0.04,
          size: (0.1 + Math.random() * 0.05) * z, size1: 0.03, color: 0xfff4c8, color1: 0xe0601c, alpha: 1, alpha1: 0.4, gravity: 0, drag: 3,
        });
        if (Math.random() < 0.75) {
          ps.emit(PK.Smoke, x, y, {
            vx: (Math.random() - 0.5) * 0.4, vy: 0.15 + Math.random() * 0.3, life: 1 + Math.random() * 1.2,
            size: 0.07 * z, size1: (0.32 + Math.random() * 0.25) * z, color: 0xd2d0ca, color1: 0x8e8c88, alpha: 0.45, alpha1: 0, gravity: -0.03, drag: 1.5,
          });
        }
      }
      this.game.sound.hold(this, 'machine/thruster_loop', 0.45 * z, p.x, 1.6 / Math.sqrt(z));
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
    const t = this.nozzle();
    const flicker = (0.85 + Math.random() * 0.3) * this.scale;
    this.game.renderer.addLight(t.x, t.y, 2 * flicker, 0.6 * flicker, 0xffb060);
  }

  onImpact(info: ImpactInfo): void {
    if (info.other && this.main.noCollide?.has(info.other)) return;
    this.detonate(info.other);
  }

  onBullet(): void {
    if (!this.spared()) this.detonate();
  }

  damage(_part: Part, amount: number, kind: DamageKind): void {
    if (kind !== 'fire' && amount > 5 && !this.spared()) this.detonate();
  }

  /** One of its salvo went off just now: that blast and its shrapnel leave it be (see SALVO_SPARED). */
  private spared(): boolean {
    return !!this.salvo && this.game.time - this.salvo.blastAt < SALVO_SPARED;
  }

  /**
   * Goes off: the blast, and the shaped charge's jet into what it struck (a
   * vehicle's body, wherever on the vehicle it hit; people and animals have the
   * blast to reckon with already).
   */
  detonate(struck: Part | null = null): void {
    if (this.spent || this.destroyed) return;
    this.spent = true;
    const w = this.spec.warhead;
    const t = this.main.body.translation();
    if (this.salvo) this.salvo.blastAt = this.game.time;
    if (struck && !struck.destroyed && !struck.entity.destroyed && !isLiving(struck.entity)) {
      const e = struck.entity;
      const into = e instanceof Car ? e.body : struck;
      const h = this.heading();
      if (!into.destroyed) e.damage(into, w.jet, 'explosion', { x: t.x, y: t.y }, { x: Math.cos(h), y: Math.sin(h) });
    }
    const { power, radius, damage, shrapnel } = w;
    this.game.explosions.explode(t.x, t.y, { power, radius, damage, shrapnel, source: this });
    this.game.remove(this);
  }

  protected serializeExtra(): Record<string, unknown> {
    const g = this.guide;
    const x: Record<string, unknown> = { phase: this.phase, t: this.t, age: this.age, burn: this.burn, guide: g.kind };
    if (this.cold) x.cold = true;
    if (g.kind === 'target') x.at = [g.at.x, g.at.y];
    if (g.kind === 'cursor' && g.by !== 1) x.by = g.by;
    if (g.kind === 'cursor' && g.off) x.off = [g.off.x, g.off.y];
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
    const off = x.off as number[] | undefined;
    if (x.guide === 'cursor') {
      this.guide = { kind: 'cursor', by: typeof x.by === 'number' ? x.by : 1 };
      if (Array.isArray(off) && off.length === 2 && off.every(Number.isFinite)) this.guide.off = { x: off[0], y: off[1] };
    } else if (x.guide === 'target' && Array.isArray(at) && at.every(Number.isFinite)) this.guide = { kind: 'target', entity: null, part: null, local: { x: 0, y: 0 }, at: { x: at[0], y: at[1] } };
  }

  /** The target it's after (by snapshot index), and which of its parts; the rest of its salvo still flying. */
  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};
    const g = this.guide;
    const i = g.kind === 'target' && g.entity && !g.entity.destroyed ? ref(g.entity) : -1;
    if (g.kind === 'target' && g.entity && i >= 0) {
      const part = g.part && !g.part.destroyed ? g.entity.parts.indexOf(g.part) : -1;
      Object.assign(out, { target: i, part, local: [g.local.x, g.local.y] });
    }
    const mates = (this.salvo?.missiles ?? []).filter((m) => m !== this && !m.destroyed).map(ref).filter((k) => k >= 0);
    if (mates.length) out.salvo = mates;
    return Object.keys(out).length ? out : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    if (Array.isArray(links.salvo)) {
      // (the first of them back makes the salvo again; the rest join it)
      const mates = links.salvo.map((k) => (typeof k === 'number' ? get(k) : undefined)).filter((m): m is Missile => m instanceof Missile && !m.destroyed);
      const s = mates.find((m) => m.salvo)?.salvo ?? new Salvo();
      for (const m of [this, ...mates]) {
        m.salvo = s;
        if (!s.missiles.includes(m)) s.missiles.push(m);
      }
      this.main.setNoCollide(s.others(this));
    }
    const g = this.guide;
    const e = typeof links.target === 'number' ? get(links.target) : undefined;
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

/** How long (s) after one of a salvo goes off its blast and shrapnel leave the rest of it be. */
const SALVO_SPARED = 0.15;

/**
 * Missiles fired together at one launch (a Strike's five): their bodies are
 * kept from touching one another all the way (see Part.setNoCollide()), and
 * one going off doesn't set off the rest (they come in one after another on
 * the same target). Everything else they hit as any missile does.
 */
export class Salvo {
  readonly missiles: Missile[] = [];
  /** When one of them last went off (game time, s). */
  blastAt = -Infinity;

  /** The bodies of the rest of it still flying. */
  others(m: Missile): Part[] {
    const out: Part[] = [];
    for (const o of this.missiles) if (o !== m && !o.destroyed && !o.main.destroyed) out.push(o.main);
    return out;
  }
}

/** How many missiles a Strike sends out at one launch. */
export const STRIKE_COUNT = 5;
/**
 * A Strike's missiles leave fanned out STRIKE_FAN rad apart, each STRIKE_PACE
 * (a share of the launch's speed) faster than the one before; the mouse-guided
 * ones each go for a point of their own round the cursor, STRIKE_SPREAD m off
 * it across (half that up and down), so they don't fly as one.
 */
const STRIKE_FAN = 0.06;
const STRIKE_PACE = 0.06;
const STRIKE_SPREAD = 1.4;

/** A launch (see launchVolley()). */
export interface Volley {
  /** The missile fired (made by spawning it), and its version (one of it, or a Strike's five). */
  round: ItemDef;
  version: MissileVersion;
  /** The tube's mouth or the cell's top, the way out of it, and how far (art px) inside that the missile's tail sits. */
  at: V2;
  dir: V2;
  inset: number;
  flipped: boolean;
  /** What it's drawn just behind (the launcher's layer). */
  zBase: number;
  speed: number;
  cold: boolean;
  /** What guides each: a Strike's missiles go after these in turn (more missiles than these double up). */
  guides: Guide[];
  /** What fires it (and whoever's on that), the speed it carries the missiles on with, and its own side they're fired past. */
  own: Part[];
  carry: V2;
  past?: Passing;
}

/**
 * Fires a launch: one missile, or a Strike's five (see STRIKE_COUNT), fanned
 * out a little, each after its guide in turn, a salvo that never touches
 * itself (see Salvo). Every missile goes through Missile.launch(), `past`
 * included. Returns those fired.
 */
export function launchVolley(game: Game, v: Volley): Missile[] {
  const n = v.version === 'strike' ? STRIKE_COUNT : 1;
  const heading = Math.atan2(v.dir.y, v.dir.x);
  // (its tail just inside the tube or the cell: it slides out from behind it)
  const back = (MISSILES[v.version].w / 2 - v.inset) * PX;
  const fan = (i: number) => heading + (i - (n - 1) / 2) * STRIKE_FAN;
  const salvo = n > 1 ? new Salvo() : null;
  const out: Missile[] = [];
  // (all made first, so each is launched passing through every other)
  for (let i = 0; i < n; i++) {
    const h = fan(i);
    const m = game.spawn(v.round, v.at.x + Math.cos(h) * back, v.at.y + Math.sin(h) * back, { flip: v.flipped, angle: angleFor(h, v.flipped) });
    if (!(m instanceof Missile)) continue;
    m.zBase = v.zBase - 0.01;
    for (const q of m.parts) q.updateZ();
    m.salvo = salvo;
    salvo?.missiles.push(m);
    out.push(m);
  }
  out.forEach((m, i) => {
    const g = v.guides.length ? v.guides[i % v.guides.length] : ({ kind: 'none' } as Guide);
    m.launch(v.own, fan(i), v.speed * (1 + (i - (n - 1) / 2) * STRIKE_PACE), v.cold, spread(g, i, n), v.carry, v.past);
  });
  return out;
}

/** Missile `i` of `n`'s own guide: a target's its own copy (it follows that as it goes), a cursor's a point of its own round it for a Strike's. */
function spread(g: Guide, i: number, n: number): Guide {
  if (g.kind === 'target') return { ...g, local: { ...g.local }, at: { ...g.at } };
  if (g.kind !== 'cursor' || n < 2) return g;
  const a = (i / n) * Math.PI * 2 + Math.PI / 2;
  return { kind: 'cursor', by: g.by, off: { x: Math.cos(a) * STRIKE_SPREAD, y: Math.sin(a) * STRIKE_SPREAD * 0.5 } };
}

/** The versions (see MissileVersion) as their menus show them. */
const VERSIONS: [MissileVersion, string][] = [['standard', 'Standard'], ['cruise', 'Cruise'], ['strike', 'Strike (5)']];

/** The version a config (a launcher's, an M113's) asks for. */
export function versionOf(config: EntityConfig | undefined): MissileVersion {
  const v = config?.missile;
  return v === 'cruise' || v === 'strike' ? v : 'standard';
}

/** The menu's entries for which missile is fired: "Missile: Standard", "Cruise", "Strike (5)", the one in use ticked. */
export function versionActions(current: MissileVersion, set: (v: MissileVersion) => void): ContextAction[] {
  return VERSIONS.map(([v, label]) => ({ label: `Missile: ${label}`, checked: v === current, action: () => set(v) }));
}

// ---------------------------------------------------------------- the launchers

/** Seconds a launcher takes to have its next missile in. */
const RELOAD = 3;
/** Seconds a vertical cell's hatch stands open after a missile goes. */
const HATCH_OPEN = 0.7;

/** A launcher's config (see GuidedLauncher): none for a standard missile out of a tube. */
function launcherConfig(vertical: boolean, version: MissileVersion): EntityConfig | undefined {
  const c: EntityConfig = {};
  if (vertical) c.vertical = true;
  if (version !== 'standard') c.missile = version;
  return Object.keys(c).length ? c : undefined;
}

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
 * (see Missile). It reloads by itself. Its menu also picks which missile it
 * fires (see MissileVersion): the standard one, a cruise missile, or a
 * Strike's five. Both are its config (`vertical`, `missile`): kept in saves,
 * undo and copies; the menu makes it again the other way for its launch.
 */
export abstract class GuidedLauncher extends Prop {
  readonly kind: MissileKind;
  readonly vertical: boolean;
  version: MissileVersion;
  loaded = true;
  /** Seconds until the next missile is in. */
  reload = 0;
  shots = 0;
  /** The cell the next missile goes from (vertical), and how long the last one's hatch stays open. */
  private cell = 0;
  private hatch = 0;
  /** Aimed with the cursor: F works it (when it's selected) whatever the cursor is over (see Controls). */
  readonly cursorAimed = true;
  /** What it fires, by version. */
  protected readonly rounds: Record<MissileVersion, ItemDef>;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: MissileKind, rounds: Record<MissileVersion, ItemDef>, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    this.rounds = rounds;
    this.vertical = opts.config?.vertical === true;
    this.version = versionOf(opts.config);
    this.config = launcherConfig(this.vertical, this.version);
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
   * Fires the missile it has in (a Strike's five), guided by `guides` (a
   * Strike's missiles go after them in turn), past its own side in the way if
   * `past`: out of its tube along it, or thrown straight up out of the next
   * cell. False if it isn't loaded (it clicks).
   */
  fire(guides: Guide | Guide[], past?: Passing): boolean {
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
    const fired = launchVolley(game, {
      round: this.rounds[this.version], version: this.version, at, dir, inset: this.vertical ? 3 : 6, flipped: this.flipped, zBase: this.zBase,
      speed: this.vertical ? EJECT : LAUNCH, cold: this.vertical, guides: Array.isArray(guides) ? guides : [guides],
      own: this.parts, carry: p.velocityAt(at.x, at.y), past,
    });
    if (!fired.length) return false;
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
    this.game.rebuildEntity(this, launcherConfig(on, this.version), { x: foot.x + up.x * h * PX, y: foot.y + up.y * h * PX });
  }

  /** Which missile it fires from now on (the next one in is of it): kept in its config. */
  setVersion(v: MissileVersion): void {
    if (v === this.version || this.destroyed) return;
    this.version = v;
    this.config = launcherConfig(this.vertical, v);
    this.game.sound.play('gun/rpg_reload', { gain: 0.3, x: this.main.x, rate: 1.3, vary: 0.04 });
  }

  /** The menu's entries for its missile and its launch. */
  protected launchActions(): ContextAction[] {
    return [
      ...versionActions(this.version, (v) => this.setVersion(v)),
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
 * cursor of whoever fired it is (see cursorGuide()), turning as it's moved.
 */
export class MouseLauncher extends GuidedLauncher {
  activate(): void {
    this.fire(cursorGuide(this.game));
  }

  contextActions(): ContextAction[] {
    return [{ label: this.loaded ? 'Fire' : 'Reloading…', hint: 'F', disabled: !this.loaded, action: () => this.activate() }, ...this.launchActions()];
  }
}

/** What the Spike's seeker has under its gate: a part of something at a point on it, or a point on the ground. */
export interface Sighted {
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
/**
 * The gate stays on what it's on while that's no more than this (screen px)
 * further from the square's middle than the nearest: two about as near would
 * have it flick between them, starting over each time.
 */
const STICK = 6;

/** Something in the seeker's square (see SpikeLauncher.scan()): how far its nearest point is from the middle (m), and 0 for a target (a vehicle, a person, an animal), 1 for anything else. */
interface Seen extends Sighted {
  d: number;
  rank: number;
}

/**
 * The Spike LR-II's launcher: a fire-and-forget seeker missile. Holding Use
 * switches its seeker on, a reticle round the cursor (corner brackets, and the
 * gate that locks on: see Reticles). The seeker tracks everything in the
 * brackets' square, and its gate goes on the target nearest the middle (a
 * vehicle, a person or an animal: anything else solid only if there's no
 * target in it, and failing all that the ground under the cursor), following
 * it; kept in the square LOCK_TIME, it locks on. A lock holds while what it's
 * on stays in the square; out of it (or gone), it's dropped and the seeker
 * picks again. Letting go of Use with a lock fires, and the missile flies
 * itself to the target, over what's in the way and down on it from above; a
 * Strike's five go after the locked target and the other targets in the
 * square, nearest the middle first (more missiles than targets double up). Let
 * go without a lock, nothing fires.
 */
export class SpikeLauncher extends GuidedLauncher {
  /** What the gate is on, how long it's been on it (s), and what it has locked on. */
  sighted: Sighted | null = null;
  locking = 0;
  lock: Sighted | null = null;
  /** Everything in its square as of its last look, targets first, each nearest the middle first (see scan()). */
  tracked: Sighted[] = [];
  /** The square the seeker looks in (rebuilt as the view's zoom changes its size in the world). */
  private box: RAPIER.Cuboid | null = null;
  /**
   * Who holds its seeker on (their player number: see Game.actor; 0, no one):
   * it looks through their cursor (see Game.cursorOf()), and their screen
   * shows its reticle.
   */
  holder = 0;
  private beepT = 0;

  /** (Use only works its seeker: held down, see setActiveHeld()). */
  activate(): void {}

  setActiveHeld(on: boolean): void {
    const was = this.activeHeld;
    super.setActiveHeld(on);
    if (on === was) return;
    this.holder = on ? this.game.actor : 0;
    if (on) {
      this.sighted = this.lock = null;
      this.locking = 0;
      reticles(this.game).on.add(this);
      this.game.sound.play('machine/switch', { gain: 0.3, rate: 1.6, x: this.main.x });
      return;
    }
    reticleSets.get(this.game)?.on.delete(this);
    const lock = this.lock;
    const others = lock ? this.alsoTracked(lock) : [];
    this.sighted = this.lock = null;
    this.tracked = [];
    this.locking = 0;
    if (lock && !this.destroyed) this.fire([lock, ...others].map((s) => ({ kind: 'target', entity: s.entity, part: s.part, local: { ...s.local }, at: { ...s.at } })));
  }

  /**
   * The other targets in its square besides what it's locked on (`lock`), a
   * Strike's (they go after them too: see fire()); none if it's locked on
   * something that isn't a target, or isn't firing a Strike.
   */
  private alsoTracked(lock: Sighted): Sighted[] {
    if (this.version !== 'strike' || !lock.entity || !(lock.entity instanceof Car || isLiving(lock.entity))) return [];
    return this.tracked.filter((s) => s.entity && s.entity !== lock.entity && (s.entity instanceof Car || isLiving(s.entity))).slice(0, STRIKE_COUNT - 1);
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.activeHeld) this.seek(dt);
  }

  /**
   * The seeker's part of a step: it looks over its square (see scan()); locked
   * on, it holds the lock while that's in the square; else its gate goes on the
   * nearest target there, staying on it unless another is plainly nearer (see
   * STICK), and locks on once it's been on it LOCK_TIME.
   */
  private seek(dt: number): void {
    // (through the holder's cursor, its square as big as it's drawn on their screen)
    const c = this.game.cursorOf(this.holder);
    this.beepT -= dt;
    if (!c) {
      this.sighted = this.lock = null;
      this.tracked = [];
      this.locking = 0;
      return;
    }
    const zoom = c.zoom || this.game.renderer.zoom;
    const half = BRACKET / zoom;
    const seen = this.scan(c, half);
    this.tracked = seen;
    const lock = this.lock;
    if (lock) {
      const at = this.follow(lock);
      if (at && Math.abs(at.x - c.x) <= half && Math.abs(at.y - c.y) <= half) {
        if (this.beepT <= 0) this.beep(1.9, 0.45);
        return;
      }
      // (gone, or out of its square: it picks again)
      this.lock = this.sighted = null;
      this.locking = 0;
      this.game.sound.play('medical/ecg_beep', { gain: 0.2, x: this.main.x, rate: 0.8 });
    }
    const best = seen[0] ?? this.ground(c);
    const had = this.sighted;
    const still = had?.entity ? seen.find((s) => s.entity === had.entity) : undefined;
    if (had && still && best && still.rank === best.rank && still.d <= best.d + STICK / zoom) {
      // (on the same thing: the gate goes with it, onto the point of it nearest the middle)
      had.part = still.part;
      had.local = still.local;
      had.at = still.at;
    } else if (!(had && !had.entity && best && !best.entity && Math.hypot(best.at.x - had.at.x, best.at.y - had.at.y) <= 0.5)) {
      this.sighted = best;
      this.locking = 0;
      return;
    }
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
   * Everything solid in its square round `c` (`half` m each way from the
   * middle; not this, nor missiles in flight), each where the gate would go on
   * it: where the cursor is, if it's on it; else the middle of its part nearest
   * the square's middle, if that's in the square; else that part's nearest
   * point. Targets (vehicles, people, animals) come first, then anything else,
   * each nearest the middle first. (A wall in front of a tank doesn't take the
   * gate off it.)
   */
  private scan(c: V2, half: number): Seen[] {
    const phys = this.game.physics;
    if (this.box?.halfExtents.x !== half) this.box = new RAPIER.Cuboid(half, half);
    const near = new Map<Entity, Seen>();
    phys.world.intersectionsWithShape(c, 0, this.box, (col) => {
      const q = phys.partOf(col);
      const e = q?.entity;
      if (!q || !e || q.destroyed || e.destroyed || e === this || e instanceof Missile || col.isSensor()) return true;
      const proj = col.projectPoint(c, true);
      if (!proj) return true;
      const d = proj.isInside ? 0 : Math.hypot(proj.point.x - c.x, proj.point.y - c.y);
      const had = near.get(e);
      if (had && had.d <= d) return true;
      const mid = Math.abs(q.x - c.x) <= half && Math.abs(q.y - c.y) <= half;
      const at = d === 0 ? { x: c.x, y: c.y } : mid ? { x: q.x, y: q.y } : { x: proj.point.x, y: proj.point.y };
      near.set(e, { entity: e, part: q, local: q.worldToLocal(at.x, at.y), at, d, rank: e instanceof Car || isLiving(e) ? 0 : 1 });
      return true;
    });
    return [...near.values()].sort((a, b) => a.rank - b.rank || a.d - b.d);
  }

  /** The ground at the cursor, if it's on it: what the gate goes on with nothing in its square. */
  private ground(c: V2): Seen | null {
    if (c.y > WORLD.floor && !this.game.env.solidAt(c.x, c.y)) return null;
    return { entity: null, part: null, local: { x: 0, y: 0 }, at: { x: c.x, y: c.y }, d: 0, rank: 2 };
  }

  /**
   * Its reticle (see Reticles): four corner brackets of a square round the
   * cursor, and the gate: in the middle while it looks, round the target it's
   * on (blinking, closing in) while it locks on, and once it's locked, solid on
   * the target, following it. Firing a Strike, small gates mark the other
   * targets in the square its missiles will go after too.
   */
  drawReticle(lines: LineBatch): void {
    const c = this.game.cursor;
    if (!c || this.destroyed) return;
    // (a guest's copy: the gate kept on what it's on as that's shown moving here)
    if (this.game.net?.guest) {
      if (this.lock) this.follow(this.lock);
      if (this.sighted) this.follow(this.sighted);
      for (const t of this.tracked) this.follow(t);
    }
    const px = 1 / this.game.renderer.zoom;
    const b = BRACKET * px;
    const l = ARM * px;
    const lock = this.lock;
    const s = this.sighted;
    const gate = lock?.at ?? s?.at ?? c;
    const g = (lock ? GATE : s ? GATE + 7 * (1 - this.locking / LOCK_TIME) : GATE) * px;
    const blink = !lock && !!s && Math.floor(this.game.time * 10) % 2 === 1;
    const col = lock ? LOCKED : s ? LOCKING : SEEKING;
    const on = lock ?? s;
    const more = on ? this.alsoTracked(on) : [];
    const m = (GATE - 3) * px;
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
      for (const t of more) {
        const k = dark ? SHADOW : lock ? LOCKED : SEEKING;
        lines.seg(t.at.x - m, t.at.y - m, t.at.x + m, t.at.y - m, wid, k);
        lines.seg(t.at.x + m, t.at.y - m, t.at.x + m, t.at.y + m, wid, k);
        lines.seg(t.at.x + m, t.at.y + m, t.at.x - m, t.at.y + m, wid, k);
        lines.seg(t.at.x - m, t.at.y + m, t.at.x - m, t.at.y - m, wid, k);
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

  /**
   * A guest's copy shown as the host has it (see net/Guest): who holds its
   * seeker on (0: no one), what its gate is on and for how long (s), what it
   * has locked on, and (a Strike's) the targets in its square (on this game's
   * copies of them). The holder's reticle is drawn on their own screen.
   */
  showSeeker(holder: number, sighted: Sighted | null, locking: number, lock: Sighted | null, tracked: Sighted[] = []): void {
    this.holder = holder;
    this.sighted = sighted;
    this.locking = locking;
    this.lock = lock;
    this.tracked = tracked;
    if (holder) reticles(this.game).on.add(this);
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
 * whose seeker this screen's player holds on (in a multiplayer game, each
 * player sees their own: see SpikeLauncher.holder): they follow the camera as
 * the world does, and go when Use is let go or the launcher is removed.
 */
class Reticles {
  /** Every seeker held on, by anyone. */
  readonly on = new Set<SpikeLauncher>();
  private readonly lines: LineBatch;

  constructor(private game: Game) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.lines = new LineBatch(64, 48, mat);
    this.lines.mesh.renderOrder = 31;
    game.renderer.scene.add(this.lines.mesh);
    game.frameHandlers.push(() => this.frame());
  }

  private frame(): void {
    const L = this.lines;
    const me = this.game.net?.me ?? 1;
    L.begin();
    for (const s of this.on) {
      if (s.destroyed || !s.holder) this.on.delete(s);
      else if (s.holder === me) s.drawReticle(L);
    }
    L.end();
  }
}

const reticleSets = new WeakMap<Game, Reticles>();

/** The Spike launchers whose seekers are held on (by anyone: see SpikeLauncher.holder), for a host to tell its guests. */
export function heldSeekers(game: Game): Iterable<SpikeLauncher> {
  return reticleSets.get(game)?.on ?? [];
}

function reticles(game: Game): Reticles {
  let r = reticleSets.get(game);
  if (!r) reticleSets.set(game, (r = new Reticles(game)));
  return r;
}

import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Item, type HoldSpec } from './Item';
import { Firearm, type GunSpec } from './Firearm';
import { PK } from '../systems/Particles';
import { Liquid } from '../systems/Liquids';
import { flamethrowerArt, TORCH_MUZZLE, EXT_MUZZLE } from '../art/arsenal';
import type { PropConfig } from './Prop';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ValueEditor } from '../tools/Controls';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** What a spray looks for along its way: the floor and walls and anything solid (not things set to collide with nothing). */
const AHEAD = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/** A blob of spray in flight: burning fuel, or a puff of powder. */
interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** How a spray's blobs fly: speed off the nozzle (m/s), slowing (1/s), falling (share of gravity), lasting (s), spreading (rad). */
interface Flight {
  speed: number;
  drag: number;
  gravity: number;
  life: number;
  spread: number;
}

let ray: RAPIER.Ray | null = null;

/**
 * Blobs thrown from a nozzle, each flying on (slowing, sinking) until it meets
 * something or fades; looked for along each one's way every step, so a fast one
 * doesn't pass through things. `hit` hears what each met (null: the floor or a
 * wall) with the normal there; `fly` sees each one still flying.
 */
class Spray {
  readonly blobs: Blob[] = [];

  constructor(private game: Game, private flight: Flight) {}

  /** Throws a blob from `at` along `dir`, on top of the nozzle's own velocity `v`. */
  add(at: V2, dir: V2, v: V2): Blob {
    const f = this.flight;
    const a = (Math.random() - 0.5) * f.spread;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sp = f.speed * (0.85 + Math.random() * 0.3);
    const b: Blob = {
      x: at.x, y: at.y, vx: v.x + (dir.x * c - dir.y * s) * sp, vy: v.y + (dir.x * s + dir.y * c) * sp,
      age: 0, life: f.life * (0.8 + Math.random() * 0.4),
    };
    this.blobs.push(b);
    return b;
  }

  step(dt: number, skip: (p: Part) => boolean, hit: (b: Blob, q: Part | null, at: V2, n: V2) => void, fly?: (b: Blob) => void): void {
    const f = this.flight;
    const phys = this.game.physics;
    const k = Math.exp(-f.drag * dt);
    const g = this.game.gravity * f.gravity * dt;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    const past = (c: RAPIER.Collider) => {
      const q = phys.partOf(c);
      return !q || (!q.destroyed && !skip(q));
    };
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.age += dt;
      b.vx *= k;
      b.vy = b.vy * k + g;
      const d = Math.hypot(b.vx, b.vy) * dt;
      if (b.age > b.life || d < 1e-6) {
        this.blobs.splice(i, 1);
        continue;
      }
      r.origin = { x: b.x, y: b.y };
      r.dir = { x: (b.vx * dt) / d, y: (b.vy * dt) / d };
      const h = phys.world.castRayAndGetNormal(r, d, true, undefined, AHEAD, undefined, undefined, past);
      if (h) {
        const at = { x: b.x + r.dir.x * h.timeOfImpact, y: b.y + r.dir.y * h.timeOfImpact };
        this.blobs.splice(i, 1);
        hit(b, phys.partOf(h.collider) ?? null, at, { x: h.normal.x, y: h.normal.y });
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      fly?.(b);
    }
  }

  clear(): void {
    this.blobs.length = 0;
  }
}

/** The floor's height under x (the ground's top, on a map with ground). */
function floorAt(game: Game, x: number, y: number): number {
  return game.env.ground.length ? game.env.groundAt(x, y) : WORLD.floor;
}

// ------------------------------------------------------------------ flamethrower

/** Seconds of spraying a full tank lasts. */
const FUEL_TIME = 25;
/** Blobs of burning fuel thrown a second, and how they fly: they reach about 5 m. */
const TORCH_RATE = 30;
const FLAME: Flight = { speed: 16, drag: 2.2, gravity: 0.35, life: 0.5, spread: 0.1 };
/** Seconds a single Use (or a person's shot) sprays for. */
const TORCH_BURST = 0.6;
/** Oil a blob leaves soaked into what it hits, and on the floor (a flask's drop is 0.19). */
const SOAK = 0.035;
const DRIP = 0.05;

/**
 * A flamethrower. While its trigger is held it throws a stream of burning
 * fuel, about five metres: it sets alight whatever it reaches (burning fuel
 * sticks even to metal for a while) and leaves burning fuel on the floor. Its
 * tank lasts about 25 seconds (its menu shows what's left, and refills it).
 * People use it like a gun, from close in.
 */
export class Flamethrower extends Firearm {
  /** Fuel left (0..1). */
  fuel = 1;
  /** Spraying this step (shown on every screen: see frame()). */
  spraying = false;
  private burstT = 0;
  private emitT = 0;
  private readonly spray: Spray;
  private gauge = 1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
    this.spray = new Spray(game, FLAME);
  }

  /** A short burst of flame. */
  activate(): void {
    this.fire();
  }

  /** (a person's shot: a burst; they keep shooting while they fight) */
  fire(): void {
    if (this.destroyed) return;
    if (this.fuel <= 0) {
      this.game.sound.play('gun/dryfire', { gain: 0.35, x: this.main.x, rate: 0.8 });
      return;
    }
    this.burstT = Math.max(this.burstT, TORCH_BURST);
    this.shots++;
  }

  /** How far off (m) whoever uses it should keep: in close, though not right on top of them. */
  standOff(): number {
    return 1.6;
  }

  canRest(): boolean {
    return !this.spraying && this.spray.blobs.length === 0;
  }

  preStep(dt: number): void {
    if (this.burstT > 0) this.burstT = Math.max(0, this.burstT - dt);
    const want = this.activeHeld || this.powered || this.burstT > 0;
    const was = this.spraying;
    this.spraying = want && this.fuel > 0;
    const p = this.main;
    const game = this.game;
    if (this.spraying) {
      if (!was) game.sound.play('fire/whoosh', { gain: 0.5, x: p.x, rate: 1.3, vary: 0.05 });
      this.fuel = Math.max(0, this.fuel - dt / FUEL_TIME);
      if (this.fuel === 0) game.sound.play('gun/dryfire', { gain: 0.35, x: p.x, rate: 0.8 });
      game.sound.hold(this, 'fire/flamethrower_loop', 0.6, p.x);
      const m = p.pixelToWorld(TORCH_MUZZLE[0], TORCH_MUZZLE[1]);
      const fwd = this.forward();
      const v = p.body.linvel();
      this.emitT += dt * TORCH_RATE;
      for (; this.emitT >= 1; this.emitT--) {
        const b = this.spray.add(m, fwd, v);
        // the stream as it's seen: a flame flying with the blob, swelling and cooling as it goes
        game.particles.emit(PK.Fire, m.x, m.y, {
          vx: b.vx, vy: b.vy, life: b.life, size: 0.07, size1: 0.42 + Math.random() * 0.2,
          color: 0xfff0b0, color1: 0xc8320f, alpha: 1, alpha1: 0.25, gravity: FLAME.gravity * 0.5, drag: FLAME.drag,
        });
      }
      // it pushes back on whoever holds it
      if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * this.gun.recoil * dt, y: -fwd.y * this.gun.recoil * dt }, m, true);
      game.alarm(m.x, m.y, 6);
    }
    this.burn(dt);
    this.showGauge();
  }

  /** The burning fuel in flight: on what it meets it sticks and burns, and on the floor it pools and burns there. */
  private burn(dt: number): void {
    if (!this.spray.blobs.length) return;
    const game = this.game;
    const holder = this.holder;
    const heat = this.gun.damage;
    this.spray.step(dt, (q) => q.entity === this || q.entity === holder, (b, q, at, n) => {
      if (q) {
        // the fuel sticks and burns there, even on metal, until it's burnt off
        q.oil = Math.min(1, q.oil + SOAK);
        game.fire.ignite(q, 0.7);
        q.entity.damage(q, heat * 0.06, 'fire', at, { x: b.vx, y: b.vy });
        if (!q.frozen) q.body.applyImpulseAtPoint({ x: b.vx * 0.004, y: b.vy * 0.004 }, at, true);
      } else if (n.y > 0.5 && at.y < floorAt(game, at.x, at.y + 0.1) + 0.15 && game.puddles.open(at.x)) {
        game.puddles.add(Liquid.Oil, at.x, DRIP);
        game.puddles.igniteNear(at.x, 0.1);
      }
      // a lick of flame where it lands, spreading along what it hit
      if (Math.random() < 0.5) {
        game.particles.emit(PK.Fire, at.x, at.y, {
          vx: -n.y * (Math.random() - 0.5) * 3 + n.x, vy: n.x * (Math.random() - 0.5) * 3 + n.y + 0.6, life: 0.25 + Math.random() * 0.2,
          size: 0.18, size1: 0.05, color: 0xffd25a, color1: 0xc8320f, alpha: 1, alpha1: 0.4, gravity: -0.3, drag: 2,
        });
      }
    }, (b) => {
      // (now and then a flame trailing behind it, so the stream reads unbroken)
      if (Math.random() < 0.05) {
        game.particles.emit(PK.Fire, b.x, b.y, {
          vx: b.vx * 0.3, vy: b.vy * 0.3 + 0.5, life: 0.2, size: 0.2, size1: 0.06, color: 0xffd25a, color1: 0xb03414, alpha: 0.9, alpha1: 0.3, gravity: -0.3, drag: 2,
        });
      }
      // what the stream passes close by catches from it
      if (b.y < floorAt(game, b.x, b.y) + 0.2 && Math.random() < 0.2) game.puddles.igniteNear(b.x, 0.15);
    });
  }

  /** The tank's gauge in its art, as the fuel runs down. */
  private showGauge(): void {
    const g = this.fuel > 0.5 ? 1 : this.fuel > 0.15 ? 0.5 : 0;
    if (g === this.gauge || this.destroyed) return;
    this.gauge = g;
    this.main.setArt(flamethrowerArt(g));
  }

  /** The glow of the flame on everything round it (on every screen). */
  frame(): void {
    if (!this.spraying || this.destroyed) return;
    const p = this.main;
    const fwd = this.forward();
    const m = p.pixelToWorld(TORCH_MUZZLE[0], TORCH_MUZZLE[1]);
    const k = 0.85 + Math.random() * 0.3;
    this.game.renderer.addLight(m.x + fwd.x * 1.8, m.y + fwd.y * 1.8, 4.5 * k, 0.8 * k, 0xffa040);
  }

  /** Fills the tank again. */
  refill(): void {
    this.fuel = 1;
    this.showGauge();
    this.game.sound.play('liquid/splash', { gain: 0.3, x: this.main.x, rate: 0.8 });
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [
      { label: 'Spray', hint: 'hold F', disabled: this.fuel <= 0, action: () => this.activate() },
      { label: `Fuel: ${Math.round(this.fuel * 100)}%`, disabled: true, action: () => {} },
      { label: 'Refill fuel', disabled: this.fuel >= 0.999, action: () => this.refill() },
    ];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** Heat runs from a warm glow to a blaze; the push back on whoever holds it. */
  protected tuning(k: Parameters<Firearm['tuning']>[0]): ReturnType<Firearm['tuning']> {
    const t = super.tuning(k);
    if (k === 'damage') return { ...t, min: 0, max: 100 };
    if (k === 'recoil') return { ...t, max: 60, step: 1, unit: 'N' };
    return t;
  }

  /** Edit gun…: how hot it burns and how hard it pushes back. */
  editor(): ValueEditor {
    const ed = super.editor();
    const labels: Record<string, string> = { damage: 'Heat (burn on what it hits)', recoil: 'Push back' };
    ed.fields = ed.fields.filter((f) => f.key in labels).map((f) => ({ ...f, label: labels[f.key] }));
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    // (in steps of a hundredth: a guest's copy isn't sent every drop)
    if (this.fuel < 1) x.fuel = Math.ceil(this.fuel * 100) / 100;
    if (this.spraying) x.on = true;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.fuel = typeof x.fuel === 'number' ? clamp(x.fuel, 0, 1) : 1;
    this.spraying = x.on === true;
    this.showGauge();
  }

  protected onDestroy(): void {
    super.onDestroy();
    this.spray.clear();
  }
}

// ------------------------------------------------------------------ extinguisher

/** Puffs a second, and how they fly: a cloud reaching three metres or so. */
const PUFF_RATE = 28;
const PUFF: Flight = { speed: 11, drag: 3, gravity: 0.08, life: 0.75, spread: 0.22 };
/** Seconds a single Use sprays for. */
const PUFF_BURST = 0.8;
/** How much a puff damps a fire it reaches, and the shove it gives (N·s): enough to nudge light things. */
const DOUSE = 0.18;
const SHOVE = 0.18;
/** How far (m) round a puff the cloud reaches, and how much it damps there. */
const CLOUD = 0.25;
const CLOUD_DOUSE = 0.04;
/** The push back on whoever holds it while it sprays (N). */
const PUFF_RECOIL = 8;

let ball: RAPIER.Ball | null = null;

/**
 * A fire extinguisher. While its lever is held it sprays a cloud that puts
 * out whatever burns where it reaches (things, people, burning fuel on the
 * floor) and gives light things a little shove. It never runs out.
 */
export class Extinguisher extends Item {
  spraying = false;
  private burstT = 0;
  private emitT = 0;
  private cloudT = 0;
  private readonly spray: Spray;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.spray = new Spray(game, PUFF);
    this.activatable = true;
    this.usesPower = true;
  }

  activate(): void {
    this.burstT = PUFF_BURST;
  }

  canRest(): boolean {
    return !this.spraying && this.spray.blobs.length === 0;
  }

  preStep(dt: number): void {
    if (this.burstT > 0) this.burstT = Math.max(0, this.burstT - dt);
    const was = this.spraying;
    this.spraying = this.activeHeld || this.powered || this.burstT > 0;
    const p = this.main;
    const game = this.game;
    if (this.spraying) {
      if (!was) game.sound.play('machine/air_release', { gain: 0.4, x: p.x, rate: 1.2 });
      game.sound.hold(this, 'machine/extinguisher_loop', 0.55, p.x);
      const m = p.pixelToWorld(EXT_MUZZLE[0], EXT_MUZZLE[1]);
      const fwd = this.forward();
      const v = p.body.linvel();
      this.emitT += dt * PUFF_RATE;
      for (; this.emitT >= 1; this.emitT--) {
        const b = this.spray.add(m, fwd, v);
        game.particles.emit(PK.Smoke, m.x, m.y, {
          vx: b.vx, vy: b.vy, life: b.life * 1.6, size: 0.05, size1: 0.45 + Math.random() * 0.25,
          color: 0xf4f6f8, color1: 0xc9ced3, alpha: 0.8, alpha1: 0, gravity: PUFF.gravity, drag: PUFF.drag,
        });
      }
      if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * PUFF_RECOIL * dt, y: -fwd.y * PUFF_RECOIL * dt }, m, true);
    }
    this.puff(dt);
  }

  /** The puffs in flight: they damp what they reach (and all round them, every few steps), and put out burning fuel on the floor. */
  private puff(dt: number): void {
    if (!this.spray.blobs.length) return;
    const game = this.game;
    const holder = this.holder;
    this.cloudT -= dt;
    const cloud = this.cloudT <= 0;
    if (cloud) this.cloudT = 0.05;
    const damped = new Set<Part>();
    this.spray.step(dt, (q) => q.entity === this || q.entity === holder, (b, q, at, n) => {
      if (q) {
        const hot = q.burning > 0;
        game.fire.douse(q, DOUSE);
        if (hot && Math.random() < 0.3) game.particles.smoke(at.x, at.y, 1, 0.2);
        if (!q.frozen && q.entity.totalMass() < 40) q.body.applyImpulseAtPoint({ x: (b.vx / PUFF.speed) * SHOVE, y: (b.vy / PUFF.speed) * SHOVE }, at, true);
      }
      this.quench(at.x, at.y);
      // the powder billows out along what it hit
      if (Math.random() < 0.3) {
        game.particles.emit(PK.Smoke, at.x, at.y, {
          vx: -n.y * (Math.random() - 0.5) * 2 + n.x * 0.5, vy: n.x * (Math.random() - 0.5) * 2 + n.y * 0.5, life: 0.8 + Math.random() * 0.5,
          size: 0.15, size1: 0.5, color: 0xeef0f2, color1: 0xc9ced3, alpha: 0.6, alpha1: 0, gravity: 0, drag: 2,
        });
      }
    }, (b) => {
      if (!cloud) return;
      this.quench(b.x, b.y);
      game.physics.world.intersectionsWithShape({ x: b.x, y: b.y }, 0, (ball ??= new RAPIER.Ball(CLOUD)), (c) => {
        const q = game.physics.partOf(c);
        if (q && !q.destroyed && q.entity !== this && q.entity !== holder) damped.add(q);
        return true;
      }, undefined, AHEAD);
    });
    for (const q of damped) game.fire.douse(q, CLOUD_DOUSE);
  }

  /** The cloud near the floor at (x, y): burning fuel there goes out (a little water on each burning cell of it). */
  private quench(x: number, y: number): void {
    const game = this.game;
    if (y > floorAt(game, x, y) + 0.4) return;
    for (let dx = -CLOUD - 0.15; dx <= CLOUD + 0.15; dx += PX) {
      if (game.puddles.burningAt(x + dx)) game.puddles.add(Liquid.Water, x + dx, 0.02);
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Spray', hint: 'hold F', action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return this.spraying ? { on: true } : {};
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.spraying = x.on === true;
  }

  protected onDestroy(): void {
    super.onDestroy();
    this.spray.clear();
  }
}

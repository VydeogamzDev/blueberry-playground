import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Item, type HoldSpec } from './Item';
import { PK } from '../systems/Particles';
import {
  flareArt, FLARE_TIP, fireworkArt, FIREWORK_COLORS, ROCKET_FUSE, type FireworkColor,
} from '../art/gear';
import type { PropConfig } from './Prop';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

/** What heat and sparks reach: the floor and walls and anything solid. */
const SOLID = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/** The floor's height under x (the ground's top, on a map with ground). */
function floorAt(game: Game, x: number, y: number): number {
  return game.env.ground.length ? game.env.groundAt(x, y) : WORLD.floor;
}

// ------------------------------------------------------------------ flare

/** Seconds a flare burns. */
export const FLARE_BURN = 45;
/** How often (s) its flame looks round its tip for what it lights, and how far (m) it reaches. */
const FLARE_REACH_T = 0.25;
const FLARE_REACH = 0.25;
const FLARE_RED = 0xff3a2a;

let flareBall: RAPIER.Ball | null = null;

/**
 * A road flare. Strike it (Use) and it burns for most of a minute with a
 * fierce red light that lights up everything round it, spitting sparks and
 * smoke: whatever's soaked in oil, or fuel on the floor, catches from it, and
 * what burns easily (wood, cloth) does if it's held in the flame. Fire lights it too.
 */
export class Flare extends Item {
  lit = false;
  spent = false;
  /** Seconds of burning left. */
  left = FLARE_BURN;
  private reachT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.activatable = true;
  }

  activate(): void {
    this.light();
  }

  /** A fuse cord burning down to it lights it. */
  onFuse(): void {
    this.light();
  }

  light(): void {
    if (this.lit || this.spent || this.destroyed) return;
    this.lit = true;
    this.left = FLARE_BURN;
    this.main.setArt(flareArt('lit'));
    const t = this.tip();
    this.game.sound.play('fire/flare_ignite', { gain: 0.8, x: t.x, vary: 0.04 });
    this.game.particles.sparks(t.x, t.y, this.forward().x, this.forward().y, 8, 3);
  }

  private tip(): V2 {
    return this.main.pixelToWorld(FLARE_TIP[0], FLARE_TIP[1]);
  }

  canRest(): boolean {
    return !this.lit;
  }

  preStep(dt: number): void {
    const p = this.main;
    // a fire it lies in lights it
    if (!this.lit && !this.spent && p.burning > 0.1) this.light();
    if (!this.lit) return;
    if (p.burning > 0) this.game.fire.extinguish(p);
    this.left -= dt;
    if (this.left <= 0) {
      this.lit = false;
      this.spent = true;
      this.left = 0;
      p.setArt(flareArt('spent'));
      return;
    }
    const game = this.game;
    const t = this.tip();
    const fwd = this.forward();
    game.sound.hold(this, 'fire/flare_loop', 0.45, t.x);
    // red sparks spat out of the burning end, and a trail of pinkish smoke
    if (Math.random() < 0.6) {
      game.particles.emit(PK.Spark, t.x, t.y, {
        vx: fwd.x * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5, vy: fwd.y * (1 + Math.random() * 2) + Math.random() * 1.2,
        life: 0.2 + Math.random() * 0.3, color: 0xffd0c0, color1: FLARE_RED, alpha: 1, alpha1: 0.3, gravity: 0.6, drag: 2,
      });
    }
    if (Math.random() < 0.12) {
      game.particles.emit(PK.Smoke, t.x, t.y, {
        vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.4, life: 1.5 + Math.random(),
        size: 0.06, size1: 0.4, color: 0xe0b0b0, color1: 0x9a8888, alpha: 0.35, alpha1: 0, gravity: -0.05, drag: 1.2,
      });
    }
    this.reachT -= dt;
    if (this.reachT > 0) return;
    this.reachT = FLARE_REACH_T;
    this.burnNear(t);
  }

  /** What's in the flame at its tip: oil-soaked things and fuel on the floor catch; what burns easily heats up until it does. */
  private burnNear(t: V2): void {
    const game = this.game;
    const near: Part[] = [];
    game.physics.world.intersectionsWithShape(t, 0, (flareBall ??= new RAPIER.Ball(FLARE_REACH)), (c) => {
      const q = game.physics.partOf(c);
      if (q && !q.destroyed && q.entity !== this && q.entity !== this.holder) near.push(q);
      return true;
    }, undefined, SOLID);
    for (const q of near) {
      if (q.oil > 0.05) game.fire.ignite(q, 0.6);
      else game.fire.warm(q, 0.45);
    }
    if (t.y < floorAt(game, t.x, t.y) + 0.3) game.puddles.igniteNear(t.x, FLARE_REACH);
  }

  /** Its red light on everything round it (on every screen), flickering. */
  frame(): void {
    if (!this.lit || this.destroyed) return;
    const t = this.tip();
    const k = 0.85 + Math.random() * 0.25;
    this.game.renderer.addLight(t.x, t.y, 6.5 * k, 0.95 * k, FLARE_RED);
    this.game.renderer.addLight(t.x, t.y, 1.2, 0.8, 0xffd0c0);
  }

  damage(part: Part, amount: number, kind: DamageKind): void {
    if (kind === 'fire' || kind === 'explosion' || kind === 'laser') this.light();
    super.damage(part, amount, kind);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.lit) acts.push({ label: `Burning: ${Math.ceil(this.left)} s left`, disabled: true, action: () => {} });
    else acts.push({ label: this.spent ? 'Burnt out' : 'Strike', hint: 'F', disabled: this.spent, action: () => this.light() });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (whole seconds: a guest's copy isn't sent every step)
    if (this.spent) return { spent: true };
    return this.lit ? { lit: true, left: Math.ceil(this.left) } : {};
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.spent = x.spent === true;
    this.lit = !this.spent && x.lit === true;
    this.left = this.lit && typeof x.left === 'number' ? clamp(x.left, 0, FLARE_BURN) : this.spent ? 0 : FLARE_BURN;
    this.main.setArt(flareArt(this.spent ? 'spent' : this.lit ? 'lit' : 'new'));
  }
}

// ------------------------------------------------------------------ firework

export const FIREWORK_COLOR_LIST: { color: FireworkColor; label: string }[] = [
  { color: 'red', label: 'Red' },
  { color: 'green', label: 'Green' },
  { color: 'blue', label: 'Blue' },
  { color: 'gold', label: 'Gold' },
  { color: 'mixed', label: 'Mixed' },
];

type RocketState = 'idle' | 'fuse' | 'flight';
/** The fuse's burn (s, give or take a little), the motor's push (m/s²) and how long it burns (s). */
const FUSE = 1.3;
const PUSH = 26;
const MOTOR = 0.9;
/** It bursts once it's slowed to this climbing (m/s) after its motor's out, or this long after (s) at the latest. */
const APEX = 4;
const COAST = 0.8;
/** Knocked into something this hard (m/s) in flight, it bursts there. */
const CRASH = 7;
/** Stars in the burst, their speed (m/s), and how far (m) its heat and push reach. */
const STARS = 90;
const STAR_SPEED = 7;
export const BURST_REACH = 1.4;

let burstBall: RAPIER.Ball | null = null;

/**
 * A firework's burst at `c`: a shower of stars in its colour, a flash that
 * lights the room, and a singeing for what's right by it (but `self`, what's
 * bursting: a rocket, a crossbow's firework bolt).
 */
export function fireworkBurst(game: Game, c: V2, color: FireworkColor, self: Entity | null): void {
  const colors = FIREWORK_COLORS[color];
  for (let i = 0; i < STARS; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = STAR_SPEED * (i % 3 === 0 ? 0.55 : 0.85 + Math.random() * 0.3);
    const col = colors[i % colors.length];
    game.particles.emit(PK.Spark, c.x, c.y, {
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.1 + Math.random() * 0.8, size: PX * 1.5,
      color: 0xffffff, color1: col, alpha: 1, alpha1: 0, gravity: 0.25, drag: 1.4,
    });
  }
  game.particles.flash(c.x, c.y, 0.9, colors[0], 0.12);
  game.particles.smoke(c.x, c.y, 4, 0.5);
  game.renderer.addLight(c.x, c.y, 14, 1.1, colors[0], 0.6);
  game.sound.play('explosion/firework_burst', { gain: 1, x: c.x, vary: 0.05 });
  game.alarm(c.x, c.y, 25);
  // what's right by it is singed, set alight if it burns easily, and pushed
  const near: Part[] = [];
  game.physics.world.intersectionsWithShape(c, 0, (burstBall ??= new RAPIER.Ball(BURST_REACH)), (col) => {
    const q = game.physics.partOf(col);
    if (q && !q.destroyed && q.entity !== self) near.push(q);
    return true;
  }, undefined, SOLID);
  for (const q of near) {
    const dx = q.x - c.x;
    const dy = q.y - c.y;
    const d = Math.max(0.15, Math.hypot(dx, dy));
    const k = Math.max(0, 1 - d / BURST_REACH);
    q.entity.damage(q, 8 * k, 'fire', c, { x: dx / d, y: dy / d });
    if (k > 0.4 && q.mat.flammability > 0.3) game.fire.ignite(q, 0.4);
    if (!q.frozen) q.body.applyImpulse({ x: (dx / d) * 3 * k, y: (dy / d) * 3 * k }, true);
  }
}

/**
 * A firework rocket on its stick. Light the fuse (Use) and stand back: a
 * second later it shoots up trailing sparks and bursts high up in a shower of
 * coloured stars (its colour is picked in its menu). It bursts early if it
 * hits something on the way, or is shot; what's close to the burst is singed.
 */
export class Firework extends Item {
  color: FireworkColor = 'red';
  state: RocketState = 'idle';
  /** Seconds of the fuse left, and of the flight so far. */
  private t = 0;
  private flight = 0;
  private burst = false;
  private wasHeld: Part[] | null = null;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.activatable = true;
  }

  activate(): void {
    this.light();
  }

  onFuse(): void {
    this.light();
  }

  /** Lights the fuse. */
  light(): void {
    if (this.state !== 'idle' || this.destroyed) return;
    this.state = 'fuse';
    this.t = FUSE * (0.85 + Math.random() * 0.3);
    this.game.sound.click(this.main.x, 1.4);
  }

  /** Picks the colour it bursts in (and the paper it's wrapped in). */
  setColor(c: FireworkColor): void {
    if (c === this.color) return;
    this.color = c;
    this.main.setArt(fireworkArt(c));
  }

  canRest(): boolean {
    return this.state === 'idle';
  }

  private fuseAt(): V2 {
    return this.main.pixelToWorld(ROCKET_FUSE[0], ROCKET_FUSE[1]);
  }

  preStep(dt: number): void {
    const p = this.main;
    const game = this.game;
    if (this.state === 'idle') {
      if (p.burning > 0.1) this.light();
      return;
    }
    if (this.state === 'fuse') {
      const f = this.fuseAt();
      if (Math.random() < 0.6) {
        game.particles.emit(PK.Spark, f.x, f.y, {
          vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 0.1 + Math.random() * 0.2,
          color: 0xfff1b0, color1: 0xff7a1a, alpha1: 0.3, gravity: 0.6, drag: 2,
        });
      }
      game.sound.hold(this, 'explosion/fuse_loop', 0.3, f.x);
      this.t -= dt;
      if (this.t <= 0) this.launch();
      return;
    }
    this.fly(dt);
  }

  /** Off it goes, out of whoever's hand it's in (or free of its pin). */
  private launch(): void {
    const p = this.main;
    // (pinned upright, it's let go: that's how it's stood up to be lit)
    if (p.frozen) this.setFrozen(false);
    if (this.holder) {
      this.wasHeld = this.holder.parts;
      this.holder.dropItem(this);
    }
    if (this.wasHeld) p.setNoCollide(this.wasHeld);
    this.state = 'flight';
    this.flight = 0;
    this.game.sound.play('explosion/firework_launch', { gain: 0.9, x: p.x, vary: 0.05 });
    this.game.alarm(p.x, p.y, 10);
  }

  private fly(dt: number): void {
    const p = this.main;
    const game = this.game;
    this.flight += dt;
    if (p.noCollide && this.flight > 0.4) p.setNoCollide(null);
    const v = p.body.linvel();
    const up = p.localDir(0, 1);
    if (this.flight < MOTOR) {
      const j = PUSH * p.mass * dt;
      p.body.applyImpulse({ x: up.x * j, y: up.y * j }, true);
      // a stream of sparks out of its tail
      const f = this.fuseAt();
      for (let i = 0; i < 2; i++) {
        game.particles.emit(PK.Spark, f.x, f.y, {
          vx: -up.x * (2 + Math.random() * 3) + (Math.random() - 0.5), vy: -up.y * (2 + Math.random() * 3) + (Math.random() - 0.5),
          life: 0.25 + Math.random() * 0.35, color: 0xfff1b0, color1: 0xff8a2a, alpha1: 0.2, gravity: 0.5, drag: 1.5,
        });
      }
      if (Math.random() < 0.3) game.particles.smoke(f.x, f.y, 1, 0.12);
    } else if (v.y < APEX || this.flight > MOTOR + COAST) {
      this.explode();
      return;
    }
    // the stick keeps it pointing along its flight
    if (v.x * v.x + v.y * v.y > 4 && !p.frozen) {
      p.body.setRotation(Math.atan2(v.y, v.x) - Math.PI / 2, false);
      p.moved();
      p.body.setAngvel(0, false);
    }
  }

  /** In flight, it bursts against what it hits hard. */
  onImpact(info: ImpactInfo): void {
    if (this.state === 'flight' && this.flight > 0.15 && info.speed > CRASH) this.explode();
  }

  onBullet(_hit: BulletHit): void {
    this.explode();
  }

  damage(part: Part, amount: number, kind: DamageKind): void {
    if (kind === 'explosion' && amount > 10) this.explode();
    else if (kind === 'fire' || kind === 'explosion' || kind === 'laser' || kind === 'shock') this.light();
    else super.damage(part, amount, kind);
  }

  /** The burst (see fireworkBurst()). */
  explode(): void {
    if (this.burst || this.destroyed) return;
    this.burst = true;
    fireworkBurst(this.game, this.main.pixelToWorld(3, 2), this.color, this);
    this.game.remove(this);
  }

  /** Its motor's glow in flight (on every screen). */
  frame(): void {
    if (this.state !== 'flight' || this.flight >= MOTOR || this.destroyed) return;
    const f = this.fuseAt();
    this.game.renderer.addLight(f.x, f.y, 2.2, 0.6, 0xffb060);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.state === 'idle' ? 'Light the fuse' : 'Lit!', hint: 'F', disabled: this.state !== 'idle', action: () => this.light() }];
    for (const c of FIREWORK_COLOR_LIST) acts.push({ label: `Colour: ${c.label}`, checked: this.color === c.color, action: () => this.setColor(c.color) });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = {};
    if (this.color !== 'red') x.color = this.color;
    if (this.state !== 'idle') x.state = this.state;
    if (this.state === 'fuse') x.t = Math.round(this.t * 10) / 10;
    if (this.state === 'flight') x.flight = Math.round(this.flight * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.setColor(FIREWORK_COLOR_LIST.find((c) => c.color === x.color)?.color ?? 'red');
    this.state = x.state === 'fuse' || x.state === 'flight' ? x.state : 'idle';
    this.t = typeof x.t === 'number' ? clamp(x.t, 0, FUSE * 2) : 0;
    this.flight = typeof x.flight === 'number' ? clamp(x.flight, 0, MOTOR + COAST) : 0;
  }
}

import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import type { CaseLook } from '../systems/Casings';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { GunSound } from '../engine/Sound';
import type { PastOwn } from '../systems/Projectiles';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';
import type { EditField, ValueEditor } from '../tools/Controls';
import type { Passing } from './Tank';

export interface GunSpec {
  sound: GunSound;
  /** Muzzle position (art px). */
  muzzle: [number, number];
  /** Shell ejection port (art px); omit for revolvers. */
  eject?: [number, number];
  /** Fires continuously while activation is held. */
  auto: boolean;
  /** Shots per second. */
  rate: number;
  /** Bullet speed (m/s). */
  speed: number;
  /** Penetration energy per bullet. */
  energy: number;
  /** Damage per bullet. */
  damage: number;
  pellets?: number;
  /** Random spread (radians, full width). */
  spread: number;
  /** Recoil impulse (N*s). */
  recoil: number;
  /** Muzzle flash size (m). */
  flash: number;
  /** Momentum per energy unit transferred to what the bullet hits. */
  push?: number;
  /** A spent case's size in sprite pixels (length, width; by its sound if not given) and look. */
  case?: { len: number; wid: number; look?: CaseLook };
  /** (a shotgun's red shells: its cases are thrown as shells) */
  shellColor?: number;
  /** Seconds the barrel takes to spin up (miniguns). */
  spinUp?: number;
  /** Energy weapon: fires an instant beam of this color instead of bullets. */
  laser?: number;
}

/** The numbers Edit gun… changes (kept with the gun in saves when they differ from its kind's). */
type Tunable = 'recoil' | 'damage' | 'pellets' | 'rate' | 'energy';

/**
 * Edit gun…'s sliders and how far each goes. The fire rate is shown as the time
 * between shots; penetration (the bullet's energy) spans a log scale.
 */
const TUNING: (Omit<EditField, 'get' | 'set'> & { key: Tunable })[] = [
  { key: 'recoil', label: 'Recoil', unit: 'N·s', min: 0, max: 20, step: 0.1 },
  { key: 'damage', label: 'Power (damage per bullet)', min: 1, max: 300, step: 1 },
  { key: 'pellets', label: 'Bullets per shot', min: 1, max: 24, step: 1 },
  { key: 'rate', label: 'Time between shots', unit: 's', min: 0.02, max: 3, step: 0.01 },
  { key: 'energy', label: 'Penetration', min: 20, max: 12000, step: 10, log: true },
];

/** Seconds a gun that spins up fires for, once spun up, on a single activation. */
const BURST = 0.5;
/** Seconds what a soldier fires goes past their own side, once they've set it to (a burst's later rounds, a flintlock's hang fire: see Firearm.firePast()). */
const PAST_FOR = 0.5;

/** Each kind of gun's spent case (sprite pixels long and wide), unless its spec says. */
const CASE_SIZE: Partial<Record<GunSound, NonNullable<GunSpec['case']>>> = {
  pistol: { len: 2, wid: 1 }, smg: { len: 2, wid: 1 }, rifle: { len: 3, wid: 1 }, minigun: { len: 3, wid: 1 },
  sniper: { len: 4, wid: 1.5 }, shotgun: { len: 3, wid: 2 },
};

/** A gun: fires hitscan-style raycast bullets from its muzzle when activated. */
export class Firearm extends Item {
  /** This gun's own numbers: a copy of its kind's, so editing one gun leaves the others be. */
  readonly gun: GunSpec;
  /** Its kind's numbers (Reset puts them back). */
  private readonly stock: GunSpec;
  private cooldown = 0;
  private spin = 0;
  /** Seconds of firing left from a single activation (see activate()). */
  private burst = 0;
  shots = 0;
  /** Its holder's own side what it fires goes past (as Passing, and for bullets: see PastOwn), set by them just before, and when (game time; see firePast()). */
  private past: { by: Entity; pass: Passing; own: PastOwn; t: number } | null = null;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, ccd: true }, hold, x, y, opts);
    this.stock = gun;
    this.gun = { ...gun };
    this.activatable = true;
  }

  /**
   * Keeps firing while activation is held: automatic guns, and energy weapons
   * (there's nothing to work between shots: the beam keeps coming while the
   * trigger is held, by the player or by a person holding it).
   */
  get automatic(): boolean {
    return this.gun.auto || this.gun.laser !== undefined;
  }

  /** Its shots fly (bullets, a beam, a rocket, a bolt), so a soldier can fire them past their own side (see firePast()); a flame or a jolt can't be. */
  get flies(): boolean {
    return this.gun.speed > 0 || this.gun.laser !== undefined;
  }

  /**
   * A soldier on a side about to fire it (see Human.shoot()): what it fires
   * next goes through `pass`, those of their own side in the way, as if fired
   * from beside them (see Tank.clear()). It holds a moment (a burst's later
   * rounds, a flintlock's hang fire), and only while `by` holds it: anyone
   * else's shots hit whoever is in the way.
   */
  firePast(by: Entity, pass: Passing): void {
    this.past = { by, pass, own: { parts: new Set(pass.parts), d: pass.d, side: pass.side ?? null }, t: this.game.time };
  }

  /** What of its holder's own side a shot fired now goes past (see firePast()), or null: not a soldier's shot. */
  protected passing(): { pass: Passing; own: PastOwn } | null {
    const p = this.past;
    return p && p.by === this.holder && this.game.time - p.t <= PAST_FOR ? p : null;
  }

  /**
   * One shot (automatic guns keep firing while activation is held). A gun that
   * has to spin up first fires a short burst once it has: a single activation
   * (the menu, a pulse, Use on whoever holds it) would otherwise do nothing.
   */
  activate(): void {
    if (this.gun.spinUp) this.burst = BURST;
    else this.fire();
  }

  preStep(dt: number): void {
    this.cooldown -= dt;
    if (!this.automatic) return;
    const want = this.activeHeld || this.powered || this.burst > 0;
    if (this.gun.spinUp) {
      this.spin = Math.max(0, Math.min(1, this.spin + (want ? dt : -dt * 0.6) / this.gun.spinUp));
      if (this.spin > 0.02) this.game.sound.hold(this, 'machine/motor_loop', 0.15 + this.spin * 0.25, this.main.x, 0.6 + this.spin * 0.9);
      if (want && this.spin < 1) return;
    }
    if (this.burst > 0) this.burst = Math.max(0, this.burst - dt);
    if (want && this.cooldown <= 0) this.fire();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
  }

  fire(): void {
    if (this.cooldown > 0 || this.destroyed) return;
    const g = this.gun;
    const p = this.main;
    const game = this.game;
    this.cooldown = 1 / g.rate;
    this.shots++;
    const m = p.pixelToWorld(g.muzzle[0], g.muzzle[1]);
    const fwd = this.forward();
    game.alarm(m.x, m.y, g.laser !== undefined ? 5 : 16);
    const up = { x: -fwd.y * p.flip, y: fwd.x * p.flip };
    const own = this.passing()?.own;
    const past = own && (own.parts.size || own.side) ? own : null;
    if (g.laser !== undefined) {
      game.projectiles.laser(m.x, m.y, fwd.x, fwd.y, { damage: g.damage, color: g.laser, ignore: p.body, past });
      if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * g.recoil, y: -fwd.y * g.recoil }, m, true);
      game.particles.flash(m.x, m.y, g.flash, g.laser, 0.06);
      game.renderer.addLight(m.x, m.y, 1.5, 0.5, g.laser, 0.08);
      game.sound.gunshot(g.sound, m.x);
      return;
    }
    const n = g.pellets ?? 1;
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * g.spread;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = fwd.x * c - fwd.y * s;
      const dy = fwd.x * s + fwd.y * c;
      const sp = g.speed * (n > 1 ? 0.85 + Math.random() * 0.3 : 1);
      game.projectiles.fire(m.x, m.y, dx, dy, sp, {
        energy: g.energy, damage: g.damage, push: g.push ?? 0.004, ignore: p.body, tracer: true, past,
      });
    }
    // recoil: straight back plus a little muzzle climb
    if (!p.frozen) {
      const r = g.recoil;
      p.body.applyImpulseAtPoint({ x: -fwd.x * r + up.x * r * 0.25, y: -fwd.y * r + up.y * r * 0.25 }, m, true);
    }
    // effects
    const ps = game.particles;
    ps.flash(m.x + fwd.x * g.flash * 0.35, m.y + fwd.y * g.flash * 0.35, g.flash);
    game.renderer.addLight(m.x + fwd.x * 0.2, m.y + fwd.y * 0.2, 1.4 + g.flash * 2.5, 0.55, 0xffd890, 0.06);
    ps.flash(m.x + fwd.x * g.flash * 0.9, m.y + fwd.y * g.flash * 0.9, g.flash * 0.55, 0xffe6a0, 0.04);
    for (let i = 0; i < 3; i++) {
      ps.emit(PK.Spark, m.x, m.y, {
        vx: fwd.x * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2, vy: fwd.y * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2,
        life: 0.05 + Math.random() * 0.06, color: 0xfff1b0, color1: 0xff8a2a, alpha1: 0.2, gravity: 0, drag: 6,
      });
    }
    ps.smoke(m.x + fwd.x * 0.08, m.y + fwd.y * 0.08, n > 1 ? 3 : 1, 0.12 + g.flash * 0.3);
    if (g.eject) {
      const e = p.pixelToWorld(g.eject[0], g.eject[1]);
      const v = p.body.linvel();
      // out of the port, up and back over the shooter's hand
      const c = g.case ?? CASE_SIZE[g.sound] ?? { len: 2, wid: 1 };
      const kick = 2 + Math.random() * 1.5;
      game.casings.eject(
        e.x, e.y,
        v.x - fwd.x * (0.6 + Math.random()) + up.x * kick, v.y - fwd.y * (0.6 + Math.random()) + up.y * kick,
        c.look ?? (g.shellColor ? 'shell' : 'brass'), c.len, c.wid, p.body,
      );
    }
    game.sound.gunshot(g.sound, m.x);
    const shake = g.sound === 'sniper' ? 0.08 : g.sound === 'shotgun' ? 0.06 : 0.02;
    game.renderer.shake(shake);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Fire', hint: this.automatic ? 'hold F' : 'F', action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** A number as Edit gun… shows it (the fire rate as the time between shots). */
  private tuned(k: Tunable): number {
    const g = this.gun;
    return k === 'rate' ? 1 / g.rate : k === 'pellets' ? g.pellets ?? 1 : g[k];
  }

  /** One of Edit gun…'s sliders (a kind of gun can set its own range: see RocketLauncher). */
  protected tuning(k: Tunable): (typeof TUNING)[number] {
    return TUNING.find((x) => x.key === k)!;
  }

  /** Sets one as Edit gun… shows it, kept within its slider's range (a rate of 0 would never fire again). */
  private tune(k: Tunable, v: number): void {
    const t = this.tuning(k);
    const c = Math.min(t.max, Math.max(t.min, v));
    if (k === 'rate') this.gun.rate = 1 / c;
    else if (k === 'pellets') this.gun.pellets = Math.round(c);
    else this.gun[k] = c;
  }

  /** Edit gun… (see Controls): recoil, power, bullets per shot, time between shots and penetration, for this gun alone. */
  editor(): ValueEditor {
    const laser = this.gun.laser !== undefined;
    return {
      label: 'Edit gun…',
      title: `Edit ${this.label.toLowerCase()}`,
      // (a beam is one burn through whatever it can pass: no pellets or penetration to set)
      fields: TUNING.filter((t) => !laser || (t.key !== 'pellets' && t.key !== 'energy')).map(({ key }) => this.tuning(key)).map((t) => ({
        ...t,
        get: () => this.tuned(t.key),
        set: (v: number) => this.tune(t.key, v),
      })),
      reset: () => {
        const s = this.stock;
        Object.assign(this.gun, { recoil: s.recoil, damage: s.damage, pellets: s.pellets, rate: s.rate, energy: s.energy });
      },
    };
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const base = super.serializeExtra();
    const edited: Partial<Record<Tunable, number>> = {};
    let any = false;
    for (const { key } of TUNING) {
      const v = this.gun[key] ?? 1;
      if (v === (this.stock[key] ?? 1)) continue;
      edited[key] = v;
      any = true;
    }
    return any ? { ...base, gun: edited } : base;
  }

  protected restoreExtra(extra: Record<string, unknown>): void {
    super.restoreExtra(extra);
    const edited = extra.gun as Partial<Record<Tunable, unknown>> | undefined;
    for (const { key } of TUNING) {
      const v = edited?.[key];
      if (typeof v === 'number' && v >= 0 && v < Infinity && (key !== 'rate' || v > 0)) this.gun[key] = v;
    }
  }
}

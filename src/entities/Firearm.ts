import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import { PX } from '../engine/constants';
import type { Game } from '../world/Game';
import type { GunSound } from '../engine/Sound';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

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
  shellColor?: number;
  /** Seconds the barrel takes to spin up (miniguns). */
  spinUp?: number;
  /** Energy weapon: fires an instant beam of this color instead of bullets. */
  laser?: number;
}

/** A gun: fires hitscan-style raycast bullets from its muzzle when activated. */
export class Firearm extends Item {
  readonly gun: GunSpec;
  private cooldown = 0;
  private spin = 0;
  shots = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, ccd: true }, hold, x, y, opts);
    this.gun = gun;
    this.activatable = true;
  }

  /** One shot (automatic guns keep firing while activation is held). */
  activate(): void {
    if (!this.gun.spinUp) this.fire();
  }

  preStep(dt: number): void {
    this.cooldown -= dt;
    if (!this.gun.auto) return;
    const want = this.activeHeld || this.powered;
    if (this.gun.spinUp) {
      this.spin = Math.max(0, Math.min(1, this.spin + (want ? dt : -dt * 0.6) / this.gun.spinUp));
      if (this.spin > 0.02) this.game.sound.hold(this, 'machine/motor_loop', 0.15 + this.spin * 0.25, this.main.x, 0.6 + this.spin * 0.9);
      if (want && this.spin < 1) return;
    }
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
    const up = { x: -fwd.y * p.flip, y: fwd.x * p.flip };
    if (g.laser !== undefined) {
      game.projectiles.laser(m.x, m.y, fwd.x, fwd.y, { damage: g.damage, color: g.laser, ignore: p.body });
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
        energy: g.energy, damage: g.damage, push: g.push ?? 0.004, ignore: p.body, tracer: true,
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
      ps.emit(PK.Shell, e.x, e.y, {
        vx: v.x - fwd.x * (0.6 + Math.random()) + up.x * (2 + Math.random() * 1.5),
        vy: v.y - fwd.y * (0.6 + Math.random()) + up.y * (2 + Math.random() * 1.5),
        life: 4, size: PX * (g.sound === 'shotgun' ? 2 : 1), color: g.shellColor ?? 0xc9a43c, color1: 0xa8862e, gravity: 1, drag: 0.1,
      });
    }
    game.sound.gunshot(g.sound, m.x);
    const shake = g.sound === 'sniper' ? 0.08 : g.sound === 'shotgun' ? 0.06 : 0.02;
    game.renderer.shake(shake);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.gun.auto ? 'Fire (hold F)' : 'Fire', hint: 'F', action: () => this.fire() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }
}

import { clamp, type V2 } from '../engine/math';
import { Thruster } from './Machines';
import { Prop, type PropConfig } from './Prop';
import { BURN } from '../systems/Fuel';
import { PK } from '../systems/Particles';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Aircraft parts (0.4.0): a wing (the air's lift is systems/Aero's, as for any part: the
// wing tells its angle to the air and when it's stalled) and a helicopter rotor.

/** Past this angle to the air (degrees) a wing stalls: its lift falls away (see Aero cn()). */
export const STALL_DEG = 14;

/**
 * A wing: long, thin and wide (its span), so the air lifts it hard as it goes along it a
 * little nose up, and drops it when it's tipped too far (a stall: the pilot's readout
 * says STALL). Weld two flaps or elevators behind it to steer.
 */
export class Wing extends Prop {
  /** Its angle to the air (degrees, + nose up), and stalled. */
  aoa = 0;
  stalled = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  preStep(): void {
    const p = this.main;
    const v = Math.hypot(p.vx, p.vy);
    if (v < 4) {
      this.aoa = 0;
      this.stalled = false;
      return;
    }
    // (the chord points the way it faces; nose up: the chord above the way it's going, anticlockwise facing right)
    const c = p.localDir(p.flip, 0);
    this.aoa = (p.flip * Math.atan2(p.vx * c.y - p.vy * c.x, p.vx * c.x + p.vy * c.y) * 180) / Math.PI;
    this.stalled = Math.abs(this.aoa) > STALL_DEG && v > 8;
  }

  contextActions(): ContextAction[] {
    return [{ label: this.stalled ? `Stalled (${Math.round(this.aoa)}° to the air)` : `${Math.round(this.aoa)}° to the air`, disabled: true, action: () => {} }];
  }
}

/** How long (s) a rotor takes to spin up from still, and to run down. */
const ROTOR_UP = 2.5;
const ROTOR_DOWN = 4;

/**
 * A helicopter rotor: lifts straight up from its mast, as hard as it's spun (the throttle,
 * when flown: an engine on Throttle), and less in thin air; it takes a moment to spin up and
 * to run down. Its turbine burns fuel as a jet does. Weld it on top of a cabin.
 */
export class HeliRotor extends Thruster {
  /** How fast it's spinning (0 to 1). */
  spin = 0;
  private frameT = 0;
  private frameN = 0;
  private art: (k: number) => PixelArt;

  /** (a turboshaft's exhaust: warm, not a rocket's flame) */
  heatSignature(): number {
    return this.spin * 400;
  }

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, x, y, opts);
    this.art = art;
    this.burn = BURN.jet;
  }

  pushDir(): V2 {
    return this.main.localDir(0, 1);
  }

  pushAt(): V2 {
    return this.main.pixelToWorld(48, 4);
  }

  protected thrustDir(s: number): V2 {
    return this.main.localDir(0, s);
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    const p = this.main;
    let want = 0;
    if (this.running && !p.frozen) {
      const lvl = this.level();
      if (lvl > 0) {
        const got = this.fuelFor(this.force * this.thrust * lvl * this.burn * dt);
        this.dry = got <= 0;
        want = lvl * got;
      }
    } else this.dry = false;
    this.spin = want > this.spin ? Math.min(want, this.spin + dt / ROTOR_UP) : Math.max(want, this.spin - dt / ROTOR_DOWN);
    this.lit = this.spin;
    if (this.spin <= 0.001 || p.frozen) return;
    // (its blades bite the air: thinner air, less lift)
    const air = this.game.map.world ? this.game.air.thinness(p.y) : 1;
    const f = this.thrustDir(this.backwards ? -1 : 1);
    const push = this.force * this.thrust * this.spin * this.spin * air;
    const at = this.pushAt();
    p.body.applyImpulseAtPoint({ x: f.x * push * dt, y: f.y * push * dt }, at, true);
    this.game.sound.hold(this, 'machine/fan_loop', 0.2 + 0.4 * this.spin, p.x, 0.35 + 0.5 * this.spin);
    // the downwash kicks up dust under it
    const g = this.game;
    const ground = g.env.groundAt(p.x, p.y);
    const h = p.y - ground;
    if (h < 6 && Math.random() < this.spin * (1 - h / 6)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      g.particles.emit(PK.Smoke, p.x + side * Math.random() * 1.5, ground + 0.1, { vx: side * (3 + Math.random() * 3) * this.spin, vy: 0.3, life: 0.8, size: 0.15, size1: 0.5, color: 0xcfc6b4, color1: 0xb8b0a0, alpha: 0.4, alpha1: 0, gravity: 0, drag: 2 });
    }
  }

  frame(): void {
    // (a frame's worth, about: the blades' look only)
    this.frameT -= (1 / 60) * (2 + this.spin * 30);
    if (this.frameT > 0) return;
    this.frameT = 1;
    const k = this.spin > 0.6 ? 4 : this.spin > 0.02 ? (this.frameN = (this.frameN + 1) % 4) : 0;
    this.main.setArt(this.art(k));
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    acts.splice(1, 0, { label: `Rotor at ${Math.round(clamp(this.spin, 0, 1) * 100)}%`, disabled: true, action: () => {} });
    return acts;
  }
}

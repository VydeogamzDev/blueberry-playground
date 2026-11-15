import { clamp, type V2 } from '../engine/math';
import { Thruster } from './Machines';
import { Prop, type PropConfig } from './Prop';
import { BURN } from '../systems/Fuel';
import { PK } from '../systems/Particles';
import { waterOver } from '../systems/Breath';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Boat parts (0.4.0): a propeller and an outboard motor (they push only in water), a sail
// (the wind fills it: see Weather.windAt()), a ballast tank (a submarine's: flooded it
// sinks, blown it rises) and an anchor. See systems/Seafaring for depth and spray.

/** How deep (m) a point is under the water (0: not in it). */
export function depthAt(game: Game, x: number, y: number): number {
  const w = waterOver(game, x, y);
  return w === null ? 0 : Math.max(0, w - y);
}

/**
 * A boat propeller: its blades at the back, it pushes the way it faces while they're
 * under water (out of it, they only thrash the air), on power or the throttle; electric,
 * it needs no fuel.
 */
export class BoatPropeller extends Thruster {
  private frameN = 0;
  protected art: (k: number) => PixelArt;
  /** Where its blades are (art pixel), and how deep they must be to bite. */
  protected bladesPx: [number, number] = [2, 7];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, x, y, opts);
    this.art = art;
    this.burn = 0;
  }

  protected fuelFor(_kg: number): number {
    return 1;
  }

  /** (an electric motor under water: cool) */
  heatSignature(): number {
    return 0;
  }

  pushAt(): V2 {
    return this.main.pixelToWorld(this.bladesPx[0], this.bladesPx[1]);
  }

  /** How much of its push it gets where its blades are: all of it a little under water, none out of it. */
  bite(): number {
    const b = this.pushAt();
    return clamp(depthAt(this.game, b.x, b.y) / 0.25, 0, 1);
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    this.lit = 0;
    if (!this.running) {
      this.dry = false;
      return;
    }
    const p = this.main;
    if (p.frozen) return;
    const lvl = this.level();
    if (lvl <= 0) return;
    const got = this.fuelFor(this.force * this.thrust * lvl * this.burn * dt);
    this.dry = got <= 0;
    if (got <= 0) return;
    this.lit = lvl * got;
    const bite = this.bite();
    const s = this.backwards ? -1 : 1;
    const f = this.thrustDir(s);
    const b = this.pushAt();
    if (bite > 0) {
      const push = this.force * this.thrust * lvl * got * bite;
      p.body.applyImpulseAtPoint({ x: f.x * push * dt, y: f.y * push * dt }, b, true);
      if (Math.random() < 0.5 * lvl) {
        this.game.particles.emit(PK.Smoke, b.x - f.x * 0.3, b.y - f.y * 0.3, {
          vx: -f.x * 3 * lvl + (Math.random() - 0.5), vy: -f.y * 3 * lvl + 0.5, life: 0.6, size: 0.05, size1: 0.12, color: 0xdff2ff, color1: 0xbfe3f5, alpha: 0.7, alpha1: 0, gravity: -0.5, drag: 2,
        });
      }
    }
    this.churn(lvl);
  }

  /** Its sound running. */
  protected churn(lvl: number): void {
    this.game.sound.hold(this, 'machine/motor_loop', 0.1 + 0.15 * lvl, this.main.x, 0.9 + 0.4 * lvl);
  }

  /** Its blades turning (no flame: see Thruster). */
  protected exhaust(): void {}

  frame(): void {
    if (this.lit <= 0) return;
    this.frameN = (this.frameN + 1) % 2;
    this.main.setArt(this.art(this.frameN));
  }
}

/** An outboard motor: a petrol engine on a leg, its propeller at the foot; burns fuel as an engine does. */
export class Outboard extends BoatPropeller {
  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, force, art, x, y, opts);
    this.burn = BURN.engine * 6;
    this.bladesPx = [13, 21];
  }

  protected fuelFor(kg: number): number {
    return this.game.fuel.draw(this, kg);
  }

  heatSignature(): number {
    return this.lit * 150;
  }

  protected churn(lvl: number): void {
    const p = this.main;
    this.game.sound.hold(this, 'machine/motor_loop', 0.18 + 0.25 * lvl, p.x, 0.7 + 0.8 * lvl);
    if (Math.random() < 0.15) {
      const ex = p.pixelToWorld(2, 3);
      this.game.particles.smoke(ex.x, ex.y, 1, 0.08, false);
    }
  }

  frame(): void {
    this.main.setArt(this.art(this.lit > 0 ? 1 : 0));
  }
}

/** A sail's area (m²) and how hard the wind pushes it (drag coefficient, broadside). */
const SAIL = { area: 6, cd: 1.3 };

/**
 * A sail on a mast: the wind (Settings > World) fills it and pushes it along, harder the
 * faster the wind goes past it. F furls it (no push), and sets it again.
 */
export class Sail extends Prop {
  furled = false;
  /** How full it is (-1 .. 1, which way). */
  full = 0;
  private shown = NaN;
  private art: (k: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  preStep(dt: number): void {
    const p = this.main;
    const g = this.game;
    const at = p.pixelToWorld(13, 22);
    const w = g.weather.windAt(at.x, at.y);
    // the wind past it, across it (it stands up: the side-on wind fills it)
    const rel = w.x - p.vx;
    const want = this.furled ? 0 : clamp(rel / 8, -1, 1);
    this.full += (want - this.full) * Math.min(1, dt * 3);
    if (!this.furled && !p.frozen && Math.abs(rel) > 0.2) {
      const rho = g.map.world ? g.air.densityAt(at.y) : 1.225;
      // (only what of it stands up across the wind)
      const up = Math.abs(p.localDir(0, 1).y);
      const f = 0.5 * rho * SAIL.area * SAIL.cd * rel * Math.abs(rel) * up;
      p.body.applyImpulseAtPoint({ x: f * dt, y: 0 }, at, true);
    }
    const k = Math.round(this.full * 4) / 4;
    if (k !== this.shown && !this.destroyed) {
      this.shown = k;
      p.setArt(this.art(k * p.flip));
    }
  }

  activate(): void {
    this.furled = !this.furled;
    this.game.sound.play('machine/air_release', { gain: 0.25, x: this.main.x, rate: 0.6 });
  }

  contextActions(): ContextAction[] {
    return [{ label: this.furled ? 'Set the sail' : 'Furl the sail', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { furled: this.furled };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.furled = x.furled === true;
  }
}

/** What a ballast tank holds flooded (kg), and how fast (a share a second) it floods or blows. */
export const BALLAST = { kg: 400, rate: 0.12 };

/**
 * A ballast tank: under water, F (or a pulse) floods it and the craft grows heavier and
 * sinks; F again blows it out with air and it rises. Power reaching it floods it, power
 * gone blows it (wire a lever to it to dive). Its gauge shows how full.
 */
export class BallastTank extends Prop {
  /** Flooding (else blowing). */
  flooding = false;
  /** How full of water (0 .. 1). */
  fill = 0;
  private shown = -1;
  private art: (k: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.flooding = on;
  }

  preStep(dt: number): void {
    const p = this.main;
    // (it floods only with water round it to take in)
    const wet = depthAt(this.game, p.x, p.y) > 0;
    const was = this.fill;
    if (this.flooding && wet) this.fill = Math.min(1, this.fill + BALLAST.rate * dt);
    else if (!this.flooding) this.fill = Math.max(0, this.fill - BALLAST.rate * dt);
    if (this.fill !== was) {
      p.body.setAdditionalMassProperties(this.fill * BALLAST.kg, { x: 0, y: 0 }, this.fill * BALLAST.kg * 0.05, true);
      if (wet && Math.random() < 0.3) this.game.particles.emit(PK.Smoke, p.x + (Math.random() - 0.5) * 0.5, p.y + 0.2, { vx: 0, vy: 1.2, life: 0.8, size: 0.05, size1: 0.1, color: 0xdff2ff, alpha: 0.7, alpha1: 0, gravity: -0.5, drag: 1 });
    }
    const k = Math.round(this.fill * 5);
    if (k !== this.shown && !this.destroyed) {
      this.shown = k;
      p.setArt(this.art(k));
    }
  }

  activate(): void {
    this.flooding = !this.flooding;
    this.game.sound.play('machine/air_release', { gain: 0.35, x: this.main.x, rate: this.flooding ? 0.7 : 1.2 });
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${Math.round(this.fill * 100)}% flooded`, disabled: true, action: () => {} },
      { label: this.flooding ? 'Blow it (rise)' : 'Flood it (dive)', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { flooding: this.flooding, fill: this.fill };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.flooding = x.flooding === true;
    this.fill = typeof x.fill === 'number' && Number.isFinite(x.fill) ? clamp(x.fill, 0, 1) : 0;
    this.main.body.setAdditionalMassProperties(this.fill * BALLAST.kg, { x: 0, y: 0 }, this.fill * BALLAST.kg * 0.05, true);
  }
}

/**
 * An anchor: heavy, and on the bottom under water it digs in, holding what it's roped to;
 * F weighs it (lets it drag free) and drops it again.
 */
export class Anchor extends Prop {
  weighed = false;
  dug = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  preStep(): void {
    const p = this.main;
    const g = this.game;
    const ground = g.env.groundAt(p.x, p.y);
    const down = !this.weighed && p.y - ground < 0.5 && depthAt(g, p.x, p.y) > 0.2;
    if (down !== this.dug) {
      this.dug = down;
      // dug into the bottom: it hardly moves
      p.body.setLinearDamping(down ? 40 : p.linDamp);
      p.body.setAngularDamping(down ? 40 : 0.5);
    }
  }

  activate(): void {
    this.weighed = !this.weighed;
    this.game.sound.play('machine/rope_snap', { gain: 0.2, x: this.main.x, rate: 0.6 });
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.dug ? 'Dug in' : 'Not holding', disabled: true, action: () => {} },
      { label: this.weighed ? 'Drop anchor' : 'Weigh anchor', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { weighed: this.weighed };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.weighed = x.weighed === true;
  }
}

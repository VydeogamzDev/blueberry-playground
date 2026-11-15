import { Prop, type PropConfig } from './Prop';
import { isFuelStore } from '../systems/Fuel';
import { NITRO_S } from './Vehicles2';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Places (0.4.0): a ramp, a runway, a launch pad, a fuel pump and race gates. Laid where
// they're put (frozen); the World map has a set of them by its start (see
// worldPlaces()). Races and stunts are scored by systems/Races.

/** Something set where it's put: frozen as it's made. */
export class Fixture extends Prop {
  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions, background = false) {
    super(game, def, cfg, x, y, opts);
    this.main.setFrozen(true);
    // (seen behind what goes past it: it touches nothing)
    if (background) this.main.setNoCollideAll(true);
  }
}

/** How fast a fuel pump fills (kg/s, shared by the tanks), charges batteries (J/s) and refills nitro (s a second). */
export const PUMP = { fuel: 40, charge: 60000, nitro: 1.5, reach: 4 };

/**
 * A fuel pump: stop a build beside it (within 4 m, going under 1.5 m/s) and it fills
 * its tanks, charges its batteries and refills its nitro, its screen lit as it does.
 */
export class FuelPump extends Fixture {
  filling = false;
  private lookT = 0;
  private shown: boolean | null = null;
  private art: (on: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (on: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts, true);
    this.art = art;
  }

  preStep(dt: number): void {
    const g = this.game;
    if ((this.lookT -= dt) > 0) return;
    const span = 0.25 - this.lookT;
    this.lookT = 0.25;
    if (g.net?.guest) return;
    const me = this.main;
    let filled = false;
    for (const e of g.entities) {
      if (e.destroyed || e === this) continue;
      const p = e.parts[0];
      if (!p || p.destroyed || Math.abs(p.x - me.x) > PUMP.reach || Math.abs(p.y - me.y) > 3 || Math.hypot(p.vx, p.vy) > 1.5) continue;
      if (isFuelStore(e) && e.fuel < e.capacity - 1e-6) {
        e.fill(PUMP.fuel * span);
        filled = true;
      }
      const b = e as { charge?: number; capacity?: number; isPowerSource?: unknown };
      if (typeof b.charge === 'number' && typeof b.capacity === 'number' && b.isPowerSource && b.charge < b.capacity) {
        const was = b.charge;
        b.charge = Math.min(b.capacity, b.charge + PUMP.charge * span);
        if (was <= 0 && b.charge > 0) g.connections.recomputePower();
        filled = true;
      }
      const n = e as { left?: number; boosting?: boolean };
      if (e.def.id === 'nitro-bottle' && typeof n.left === 'number' && n.left < NITRO_S) {
        n.left = Math.min(NITRO_S, n.left + PUMP.nitro * span);
        filled = true;
      }
    }
    this.filling = filled;
    if (filled) g.sound.hold(this, 'machine/motor_loop', 0.12, me.x, 1.6);
    if (filled !== this.shown && !this.destroyed) {
      this.shown = filled;
      me.setArt(this.art(filled));
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: this.filling ? 'Filling up' : 'Stop a build beside it to fill it up', disabled: true, action: () => {} }];
  }
}

/**
 * A race gate: number 1, 2, 3… a checkpoint, 0 the start and finish. Go through the
 * start, then every checkpoint in order, and back through the start: a lap, timed (see
 * systems/Races). It lights as it's passed. Its menu sets its number.
 */
export class RaceGate extends Fixture {
  index: number;
  /** Lit (s left) after it's passed. */
  litT = 0;
  private shown: boolean | null = null;
  private art: (index: number, lit: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (index: number, lit: boolean) => PixelArt, index: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts, true);
    this.art = art;
    this.index = index;
    if (index) this.config = { index };
    game.races.addGate(this);
    this.show();
  }

  get label(): string {
    return this.index ? `Checkpoint ${this.index}` : 'Start / finish';
  }

  private show(): void {
    const lit = this.litT > 0;
    if (lit === this.shown || this.destroyed) return;
    this.shown = lit;
    this.main.setArt(this.art(this.index, lit));
  }

  /** Passed: it lights a moment. */
  passed(): void {
    this.litT = 2;
    this.show();
    this.game.sound.button(this.main.x);
  }

  preStep(dt: number): void {
    if (this.litT > 0) {
      this.litT -= dt;
      this.show();
    }
  }

  setIndex(i: number): void {
    this.index = i;
    this.config = i ? { index: i } : undefined;
    this.shown = null;
    this.main.setArt(this.art(i, false));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Start / finish', checked: this.index === 0, action: () => this.setIndex(0) }];
    for (let i = 1; i <= 8; i++) acts.push({ label: `Checkpoint ${i}`, checked: this.index === i, action: () => this.setIndex(i) });
    return acts;
  }

  protected onDestroy(): void {
    this.game.races.removeGate(this);
    super.onDestroy();
  }
}

/** Where the World's places are by its start (m from it): spawned with it, on its ground. */
export const WORLD_PLACES: { id: string; x: number; index?: number; flip?: boolean }[] = [
  { id: 'fuel-pump', x: -24 },
  { id: 'race-gate', x: -12 },
  { id: 'rocket-pad', x: -70 },
  { id: 'ramp', x: -150 },
  { id: 'ramp', x: -125, flip: true },
  { id: 'runway', x: 60 },
  { id: 'race-gate', x: 260, index: 1 },
  { id: 'race-gate', x: 480, index: 2 },
  { id: 'race-gate', x: 760, index: 3 },
];

/** Lays the World's places (see WORLD_PLACES) on its ground by the start: a new World, just switched to. */
export function worldPlaces(game: Game, get: (id: string) => ItemDef | undefined): void {
  for (const w of WORLD_PLACES) {
    const def = get(w.id);
    if (!def) continue;
    const ground = game.env.groundAt(w.x, 50);
    const half = def.halfHeight ?? 0.5;
    game.spawn(def, w.x, ground + half + 0.01, { flip: !!w.flip, ...(w.index ? { config: { index: w.index } } : {}) });
  }
}

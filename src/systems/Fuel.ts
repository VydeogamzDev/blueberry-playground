import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';

/**
 * Fuel (0.4.0): what engines burn, kept in tanks (see entities/Rocketry FuelTank).
 *
 * An engine draws from the tanks built into the same build as it, through welds,
 * hinges and the rest, but not across a decoupler (each stage of a rocket burns its
 * own). A build with no tank at all runs free, as everything did before there was
 * fuel, unless Settings > Physics says engines need it (see mode): then an engine
 * with no tank to draw on doesn't run.
 */

/** Something that holds fuel. */
export interface FuelStore {
  /** Fuel in it (kg) and how much it holds. */
  fuel: number;
  capacity: number;
  /** Fuel taken out (kg); returns what it had of that. */
  take(kg: number): number;
  /** Fuel put in (kg); returns what fitted. */
  fill(kg: number): number;
}

export function isFuelStore(e: Entity): e is Entity & FuelStore {
  return typeof (e as Partial<FuelStore>).take === 'function' && typeof (e as Partial<FuelStore>).capacity === 'number';
}

/** Something fuel doesn't pass through (a decoupler: a rocket's stages each burn their own). */
export function blocksFuel(e: Entity): boolean {
  return (e as { fuelWall?: boolean }).fuelWall === true;
}

/** How often (s) an engine's tanks are looked for again (something welded on, a stage let go). */
const RELOOK = 0.5;

/** Burn rates (kg of fuel a second, per newton of push at full): a rocket's, a jet's (it burns the air too), a car's. */
export const BURN = { rocket: 1 / 2500, jet: 1 / 18000, engine: 1 / 60000 };

export type FuelMode = 'normal' | 'infinite' | 'required';
export const FUEL_MODES: FuelMode[] = ['normal', 'infinite', 'required'];

export class Fuel {
  /**
   * Settings > Physics (kept with a save): tanks run dry ('normal': a build with no tank
   * runs free); never run dry ('infinite'); or engines need a tank in their build ('required').
   */
  mode: FuelMode = 'normal';
  private tanks = new Map<Entity, { at: number; list: (Entity & FuelStore)[] }>();

  constructor(private game: Game) {}

  /** The tanks `e` draws on: in its build, this side of any decoupler. */
  tanksOf(e: Entity): (Entity & FuelStore)[] {
    const now = this.game.time;
    const c = this.tanks.get(e);
    if (c && now - c.at < RELOOK && now >= c.at && c.list.every((t) => !t.destroyed)) return c.list;
    const list = this.game.connections.assemblyOf([e], true, blocksFuel).filter((x): x is Entity & FuelStore => !x.destroyed && isFuelStore(x));
    this.tanks.set(e, { at: now, list });
    return list;
  }

  /**
   * Burns `kg` for `e` from its tanks: the share of it there was (0 to 1). With no tank
   * in its build it runs free (1), unless engines need fuel (0).
   */
  draw(e: Entity, kg: number): number {
    if (this.mode === 'infinite') return 1;
    const list = this.tanksOf(e);
    if (!list.length) return this.mode === 'required' ? 0 : 1;
    if (kg <= 0) return list.some((t) => t.fuel > 0) ? 1 : 0;
    let want = kg;
    // evenly from those with some left (one drained, the rest make it up)
    for (let pass = 0; pass < 3 && want > 1e-9; pass++) {
      const full = list.filter((t) => t.fuel > 1e-9);
      if (!full.length) break;
      const each = want / full.length;
      for (const t of full) want -= t.take(each);
    }
    return Math.max(0, Math.min(1, 1 - want / kg));
  }

  /** The fuel left in these things' tanks, and what they hold (kg). */
  levelOf(ents: readonly Entity[]): { fuel: number; capacity: number } {
    let fuel = 0;
    let capacity = 0;
    for (const e of ents) {
      if (e.destroyed || !isFuelStore(e)) continue;
      fuel += e.fuel;
      capacity += e.capacity;
    }
    return { fuel, capacity };
  }

  /** Forgets what it found (a scene cleared or loaded). */
  clear(): void {
    this.tanks.clear();
  }
}

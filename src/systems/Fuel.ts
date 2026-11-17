import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';

/**
 * Fuel (0.4.0): what engines burn, kept in tanks (see entities/Rocketry FuelTank).
 *
 * An engine draws from the tanks built into the same build as it, through welds,
 * hinges and the rest, but not across a decoupler (each stage of a rocket burns its
 * own), unless a tank is set to feed a stage's engines (see FuelStore.feeds). An engine with no tank to draw on doesn't run (0.4.4: before, a build with
 * no tank at all ran free, as everything did before there was fuel; Settings > Physics
 * can still have it so, or have tanks never run dry: see mode).
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
  /**
   * Set to a stage (0.4.4), it feeds only the engines of that stage (see Entity.stage),
   * wherever they are in its build, across decouplers not yet fired: a rocket's lower
   * tanks can feed its upper stage's engines till they're dropped. 0 (or unset): the
   * engines on its side of any decoupler, whatever their stage.
   */
  feeds?: number;
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

export type FuelMode = 'required' | 'free' | 'infinite';
export const FUEL_MODES: FuelMode[] = ['required', 'free', 'infinite'];

export class Fuel {
  /**
   * Settings > Physics: engines burn the fuel in their build's tanks and run dry, and one
   * with no tank doesn't run ('required', as it starts); the same, but a build with no
   * tank at all runs free ('free'); or tanks never run dry and nothing needs one ('infinite').
   */
  mode: FuelMode = 'required';
  private tanks = new Map<Entity, { at: number; list: (Entity & FuelStore)[] }>();

  constructor(private game: Game) {}

  /**
   * The tanks `e` draws on: in its build, this side of any decoupler, but for those set to
   * feed another stage's engines; and those anywhere in its build set to feed its stage.
   */
  tanksOf(e: Entity): (Entity & FuelStore)[] {
    const now = this.game.time;
    const c = this.tanks.get(e);
    if (c && now - c.at < RELOOK && now >= c.at && c.list.every((t) => !t.destroyed)) return c.list;
    const C = this.game.connections;
    const stage = e.stage;
    const mine = (x: Entity): x is Entity & FuelStore => !x.destroyed && isFuelStore(x) && (!x.feeds || x.feeds === stage);
    const list = C.assemblyOf([e], true, blocksFuel).filter(mine);
    if (stage > 0) for (const x of C.assemblyOf([e])) if (mine(x) && x.feeds === stage && !list.includes(x)) list.push(x);
    this.tanks.set(e, { at: now, list });
    return list;
  }

  /**
   * Burns `kg` for `e` from its tanks: the share of it there was (0 to 1). With no tank
   * in its build it gets none (0), unless such builds run free (1).
   */
  draw(e: Entity, kg: number): number {
    if (this.mode === 'infinite') return 1;
    const list = this.tanksOf(e);
    if (!list.length) return this.mode === 'free' ? 1 : 0;
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

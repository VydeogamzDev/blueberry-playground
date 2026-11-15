import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Human } from '../entities/Human';
import { hasAir, type OxygenTank } from '../entities/Crew';

/** How often (s) who has air of their own is looked at again. */
const RELOOK = 0.5;
/** Air thinner than this (a share of the ground's) is breathed from the tank. */
const THIN = 0.6;

/**
 * Oxygen (0.4.0): air of their own for a person in space or under water. Someone
 * wearing a spacesuit helmet (see Crew Helmet) with an oxygen tank on their back, or
 * sat in a capsule seat (sealed) with one built into its craft, breathes from it (see
 * Breath: out of the water and at full air, however thin the air outside). The tank
 * runs down only while it's needed (thin air or water).
 */
export class Oxygen {
  private cache = new Map<Human, { at: number; tank: OxygenTank | null }>();

  constructor(private game: Game) {}

  /** Their tank, if they have air of their own: worn with a helmet, or in their sealed capsule's craft. */
  private tankOf(h: Human): OxygenTank | null {
    const g = this.game;
    const c = this.cache.get(h);
    if (c && g.time - c.at < RELOOK && g.time >= c.at && (!c.tank || hasAir(c.tank))) return c.tank;
    let tank: OxygenTank | null = null;
    const worn = g.connections.assemblyOf([h]);
    const helmet = worn.some((e) => (e as { helmet?: boolean }).helmet === true && !e.destroyed);
    if (helmet) tank = (worn.find(hasAir) as OxygenTank | undefined) ?? null;
    const v = h.seat?.vehicle as (Entity & { sealed?: boolean }) | undefined;
    if (!tank && v?.sealed && !v.destroyed) tank = (g.connections.assemblyOf([v]).find(hasAir) as OxygenTank | undefined) ?? null;
    // (a helmet on and sealed in, the capsule's air reaches them too)
    if (!tank && helmet && v && !v.destroyed) tank = (g.connections.assemblyOf([v]).find(hasAir) as OxygenTank | undefined) ?? null;
    this.cache.set(h, { at: g.time, tank });
    return tank;
  }

  /**
   * Have they air of their own this step (see Breath.step())? Breathing it in thin air
   * or under water runs their tank down.
   */
  supplied(h: Human): boolean {
    const t = this.tankOf(h);
    if (!t) return false;
    const head = h.limbs.get('head')?.part;
    if (head && !head.destroyed) {
      const thin = this.game.air.thinness(head.y) < THIN;
      if (thin || h.breath.under || h.breath.level !== null) t.breathe(this.game.stepDt);
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

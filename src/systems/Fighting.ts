import type { V2 } from '../engine/math';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { DamageKind } from '../world/types';

/** Something alive that can be knocked out or killed (people and animals). */
export interface Living extends Entity {
  alive: boolean;
  consciousness: number;
  readonly upright: boolean;
}

/** Something that can be set on someone (see Human.fight()). */
export interface Fighter extends Living {
  /** Who it's going for (null: nobody). */
  foe: Entity | null;
  /** Goes for `foe` until it's down for good; `back`: the foe fights back. False if it can't. */
  fight(foe: Entity, back?: boolean): boolean;
}

export function isLiving(e: Entity | null | undefined): e is Living {
  return !!e && typeof (e as Partial<Living>).alive === 'boolean' && typeof (e as Partial<Living>).consciousness === 'number';
}

export function isFighter(e: Entity | null | undefined): e is Fighter {
  return isLiving(e) && typeof (e as Partial<Fighter>).fight === 'function';
}

/** Still in the fight: alive, awake and still there. */
export function stillUp(e: Entity): boolean {
  return !e.destroyed && isLiving(e) && e.alive && e.consciousness > 0.3;
}

/** Up on its feet (not lying, nor partway up: nobody swings at someone getting up). */
export function onFeet(e: Living): boolean {
  const state = (e as { state?: string }).state;
  return state !== undefined ? e.alive && state === 'stand' : e.upright;
}

/** Where a blow is aimed: the head (the body, once that's gone). */
export function strikePoint(foe: Entity): V2 {
  const head = foe.parts.find((p) => !p.destroyed && p.name === 'Head');
  return head ? { x: head.x, y: head.y } : foe.center();
}

/** Sets each of them on the nearest of the others (they fight back, and so it goes on). Returns how many. */
export function setFighting(list: Entity[]): number {
  const fighters = list.filter((e): e is Fighter => isFighter(e) && e.alive);
  if (fighters.length < 2) return 0;
  // (on a team, the same side's left be: see Teams, which this can't import)
  const team = (e: Entity) => (e as { team?: string | null }).team ?? null;
  for (const a of fighters) {
    const c = a.center();
    const side = team(a);
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const b of fighters) {
      if (b === a || (side !== null && team(b) === side)) continue;
      const o = b.center();
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) a.fight(best, false);
  }
  return fighters.length;
}

/**
 * A blow from `by` connecting: if `striker` (a fist, a head, a swung weapon) is
 * touching any part of `foe` now, that part takes `dmg`, is knocked along `dir`
 * by `push` (N*s), and a hit is heard; one caught on a hand is mostly blocked.
 * Whoever is hit fights back. Returns the part hit (null: it hasn't connected).
 */
export function land(game: Game, by: Entity, striker: Part, foe: Entity, dmg: number, kind: DamageKind, dir: V2, push: number): Part | null {
  const world = game.physics.world;
  const found: { part: Part | null } = { part: null };
  for (const c of striker.colliders) {
    world.contactPairsWith(c, (other) => {
      if (found.part) return;
      const p = game.physics.partOf(other);
      if (!p || p.destroyed || p.entity !== foe) return;
      world.contactPair(c, other, (m) => {
        if (m.numContacts() > 0) found.part = p;
      });
    });
    if (found.part) break;
  }
  const p = found.part;
  if (!p) return null;
  const at = { x: (striker.x + p.x) / 2, y: (striker.y + p.y) / 2 };
  if (p.name === 'Hand') {
    dmg *= 0.3;
    push = 0;
  }
  if (isFighter(foe) && foe.alive && !foe.foe) foe.fight(by, false);
  foe.damage(p, dmg, kind, at, dir);
  if (!p.destroyed && !p.frozen) p.body.applyImpulse({ x: dir.x * push, y: dir.y * push }, true);
  // (a punch smacks; a heavy weapon's blow squelches too)
  const hard = Math.min(1, dmg / 60);
  if (p.mat.sound === 'flesh') game.sound.fleshHit(hard, at.x);
  else game.sound.impact(p.mat.sound, hard, at.x);
  return p;
}

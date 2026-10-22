import type RAPIER from '@dimforge/rapier2d-compat';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';

/** Seconds between rest checks. */
export const REST_CHECK = 0.5;

/**
 * Bodies wedged deep in a pile can buzz forever: the contact solver pushes them
 * apart every step and the joints push them back, so they never drop below the
 * sleep threshold even though they go nowhere. Entities that can tell they have
 * come to rest (`atRest`) are put to sleep here, but only in whole groups: a body
 * forced asleep while something it touches or is jointed to is still awake keeps
 * being integrated and wakes with a jolt. So a group sleeps only when everything
 * around it is asleep, fixed, or resting too.
 */
export function settle(game: Game, entities: Entity[]): void {
  const world = game.physics.world;
  let group = entities.filter((e) => e.atRest && !e.destroyed);
  if (!group.length) return;
  const handles = new Set<number>();
  const ok = (b: RAPIER.RigidBody | null) => !b || b.isFixed() || b.isSleeping() || handles.has(b.handle);
  const calm = (p: Part): boolean => {
    let bad = false;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (other) => {
        if (bad || ok(other.parent())) return;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) bad = true;
        });
      });
      if (bad) return false;
    }
    world.impulseJoints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
      const j = world.impulseJoints.get(h);
      if (!j || bad) return;
      const other = j.body1().handle === p.body.handle ? j.body2() : j.body1();
      if (!ok(other)) bad = true;
    });
    return !bad;
  };
  // drop anyone touching something that is still moving, until the group is stable
  for (;;) {
    handles.clear();
    for (const e of group) for (const p of e.parts) if (!p.destroyed) handles.add(p.body.handle);
    const keep = group.filter((e) => e.parts.every((p) => p.destroyed || calm(p)));
    if (keep.length === group.length) break;
    group = keep;
    if (!group.length) return;
  }
  for (const e of group) {
    for (const p of e.parts) {
      if (p.destroyed) continue;
      p.body.setLinvel({ x: 0, y: 0 }, false);
      p.body.setAngvel(0, false);
      p.body.sleep();
    }
  }
}

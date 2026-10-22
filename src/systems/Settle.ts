import type RAPIER from '@dimforge/rapier2d-compat';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';

/** Seconds between rest checks. */
export const REST_CHECK = 0.5;
/** How far (m, rad) parts may jiggle between checks and still count as at rest. */
const REST_DIST = 0.015;
const REST_ANGLE = 0.06;

/**
 * Marks entities whose parts have had no net movement for two checks in a row
 * (a second) as at rest. Jiggling in place doesn't count as movement.
 */
export function restCheck(entities: Entity[]): void {
  for (const e of entities) {
    if (e.destroyed) continue;
    const parts = e.parts.filter((p) => !p.destroyed && !p.frozen);
    const ref = e.restRef;
    let moved = ref.length !== parts.length * 3 || !e.canRest();
    let awake = false;
    for (let i = 0; i < parts.length && !moved; i++) {
      const p = parts[i];
      if (Math.abs(p.x - ref[i * 3]) > REST_DIST || Math.abs(p.y - ref[i * 3 + 1]) > REST_DIST) moved = true;
      else if (Math.abs(p.a - ref[i * 3 + 2]) > REST_ANGLE || Math.hypot(p.vx, p.vy) > 1) moved = true;
      else if (!p.body.isSleeping()) awake = true;
    }
    e.restChecks = moved ? 0 : e.restChecks + 1;
    e.restRef = parts.flatMap((p) => [p.x, p.y, p.a]);
    e.atRest = e.restChecks >= 2 && awake;
  }
}

/**
 * Bodies wedged deep in a pile can buzz forever: the contact solver pushes them
 * apart every step and the joints push them back, so they never drop below the
 * sleep threshold even though they go nowhere. Entities found at rest by
 * restCheck() are put to sleep here, but only in whole groups: a body
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
    const keep = group.filter((e) => e.parts.every((p) => p.destroyed || p.frozen || calm(p)));
    if (keep.length === group.length) break;
    group = keep;
    if (!group.length) return;
  }
  for (const e of group) {
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.setLinvel({ x: 0, y: 0 }, false);
      p.body.setAngvel(0, false);
      p.body.sleep();
    }
  }
}

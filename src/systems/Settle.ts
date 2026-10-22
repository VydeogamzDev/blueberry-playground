import type RAPIER from '@dimforge/rapier2d-compat';
import { PX } from '../engine/constants';
import { wrapAngle } from '../engine/math';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';

/** Seconds between rest checks. */
export const REST_CHECK = 0.5;
/**
 * How far (m) any point of a part may move between checks and still count as at
 * rest. Turning counts by how far it moves the part's corners, so a hand may
 * twitch through a wider angle than a torso.
 */
const REST_DIST = 0.015;
/**
 * Small links squeezed in a pile buzz in place at up to ~1 m/s (a few mm of
 * travel at the step rate); only faster than this counts as moving through.
 */
const REST_SPEED = 2;
/**
 * Links lighter than this share of their entity (hands, feet, forearms) only
 * count when they move fast: squeezed between heavy bodies in a pile they creep
 * a few centimeters back and forth for as long as the pile is awake.
 */
const LIGHT_LINK = 0.02;

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
    const mass = parts.length > 1 ? parts.reduce((m, p) => m + p.mass, 0) : 0;
    for (let i = 0; i < parts.length && !moved; i++) {
      const p = parts[i];
      if (mass && p.mass < mass * LIGHT_LINK) {
        if (Math.hypot(p.vx, p.vy) > REST_SPEED) moved = true;
        else if (!p.body.isSleeping()) awake = true;
      } else if (Math.abs(p.x - ref[i * 3]) > REST_DIST || Math.abs(p.y - ref[i * 3 + 1]) > REST_DIST) moved = true;
      else if (Math.abs(wrapAngle(p.a - ref[i * 3 + 2])) * Math.hypot(p.w, p.h) * PX * 0.5 > REST_DIST * 1.5) moved = true;
      else if (Math.hypot(p.vx, p.vy) > REST_SPEED) moved = true;
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
  const slept: Part[] = [];
  for (const e of group) {
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.setLinvel({ x: 0, y: 0 }, false);
      p.body.setAngvel(0, false);
      p.body.sleep();
      slept.push(p);
    }
  }
  game.slept.push(slept);
}

/**
 * A group put to sleep by settle() must also wake as one. When one member wakes
 * (a person deciding to get up, something landing on it), Rapier wakes its
 * island, but the members still flagged asleep keep being integrated without
 * being solved: they gather speed under gravity and are released all at once,
 * launching whatever lies among them. Called every step before the physics step.
 */
export function wakeSettled(game: Game): void {
  const groups = game.slept;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    let stirred = false;
    let live = 0;
    for (const p of g) {
      if (p.destroyed || p.frozen) continue;
      live++;
      const b = p.body;
      if (!b.isSleeping()) stirred = true;
      else {
        const v = b.linvel();
        if (Math.abs(v.x) + Math.abs(v.y) > 0.02) stirred = true;
      }
      if (stirred) break;
    }
    if (!stirred && live) continue;
    groups.splice(i, 1);
    for (const p of g) if (!p.destroyed && !p.frozen) p.body.wakeUp();
  }
}

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
 * A pile slumps and its limbs slide over each other for a long time at a few
 * cm/s. Something that has moved no more than this (m per check, and no part
 * faster than SLOW_SPEED) for SLOW_CHECKS checks in a row counts as at rest too.
 */
const SLOW_DIST = 0.1;
const SLOW_SPEED = 4;
const SLOW_CHECKS = 16;

/**
 * Marks entities whose parts have had no net movement for two checks in a row
 * (a second), or only slow creeping for eight seconds, as at rest. Jiggling in
 * place doesn't count as movement.
 */
export function restCheck(entities: Entity[]): void {
  for (const e of entities) {
    if (e.destroyed) continue;
    const parts = e.parts.filter((p) => !p.destroyed && !p.frozen);
    const ref = e.restRef;
    let still = ref.length === parts.length * 3 && e.canRest();
    let slow = still;
    let awake = false;
    const mass = parts.length > 1 ? parts.reduce((m, p) => m + p.mass, 0) : 0;
    for (let i = 0; i < parts.length && slow; i++) {
      const p = parts[i];
      if (!p.body.isSleeping()) awake = true;
      const v = Math.hypot(p.vx, p.vy);
      if (v > SLOW_SPEED) slow = false;
      if (v > REST_SPEED) still = false;
      if (mass && p.mass < mass * LIGHT_LINK) continue;
      const d = Math.max(Math.abs(p.x - ref[i * 3]), Math.abs(p.y - ref[i * 3 + 1]));
      // turning counts by how far it moves the corners
      const r = Math.abs(wrapAngle(p.a - ref[i * 3 + 2])) * Math.hypot(p.w, p.h) * PX * 0.5;
      if (d > REST_DIST || r > REST_DIST * 1.5) still = false;
      if (d > SLOW_DIST || r > SLOW_DIST) slow = false;
    }
    still &&= slow;
    e.restChecks = still ? e.restChecks + 1 : 0;
    e.slowChecks = slow ? e.slowChecks + 1 : 0;
    e.restRef = parts.flatMap((p) => [p.x, p.y, p.a]);
    e.atRest = (e.restChecks >= 2 || e.slowChecks >= SLOW_CHECKS) && awake;
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
  // separate heaps sleep (and wake) separately
  const owner = new Map<number, number>();
  group.forEach((e, i) => {
    for (const p of e.parts) if (!p.destroyed) owner.set(p.body.handle, i);
  });
  const root = group.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const join = (i: number, h: number | undefined) => {
    if (h !== undefined) root[find(i)] = find(h);
  };
  group.forEach((e, i) => {
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      for (const c of p.colliders) {
        world.contactPairsWith(c, (o) => {
          const b = o.parent();
          if (b) join(i, owner.get(b.handle));
        });
      }
      world.impulseJoints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
        const j = world.impulseJoints.get(h);
        if (j) join(i, owner.get((j.body1().handle === p.body.handle ? j.body2() : j.body1()).handle));
      });
    }
  });
  const heaps = new Map<number, Part[]>();
  group.forEach((e, i) => {
    const r = find(i);
    let slept = heaps.get(r);
    if (!slept) heaps.set(r, (slept = []));
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.setLinvel({ x: 0, y: 0 }, false);
      p.body.setAngvel(0, false);
      p.body.sleep();
      slept.push(p);
    }
  });
  for (const slept of heaps.values()) game.slept.push(slept);
}

/** Asleep but with a velocity: something pushed it without waking it. */
function moving(b: RAPIER.RigidBody): boolean {
  const v = b.linvel();
  return Math.abs(v.x) + Math.abs(v.y) > 0.02;
}

/**
 * A group put to sleep by settle() must also wake as one. When one member wakes
 * (a person deciding to get up, being dragged or shot), Rapier wakes its
 * island, but the members still flagged asleep keep being integrated without
 * being solved: they gather speed under gravity and are released all at once,
 * launching whatever lies among them. Called every step before the physics step,
 * so anything the game itself woke takes the whole group with it.
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
      if (!p.body.isSleeping() || moving(p.body)) {
        stirred = true;
        break;
      }
    }
    if (!stirred && live) continue;
    groups.splice(i, 1);
    for (const p of g) if (!p.destroyed && !p.frozen) p.body.wakeUp();
  }
}

/**
 * Rapier itself wakes the odd member of a sleeping pile when it refreshes the
 * pile's contacts. Unless the member is touching something awake from outside
 * the group (a crate landing on it), nothing is disturbing it: it goes straight
 * back to sleep, rather than waking the whole pile (which would start it
 * buzzing again) or staying awake alone (see wakeSettled()). Called every step
 * after the physics step.
 */
export function resleepSettled(game: Game): void {
  const world = game.physics.world;
  const groups = game.slept;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    // members still flagged asleep next to a woken one were integrated with it and may be moving too
    const woken = g.filter((p) => !p.destroyed && !p.frozen && (!p.body.isSleeping() || moving(p.body)));
    if (!woken.length) continue;
    const members = new Set<number>();
    for (const p of g) if (!p.destroyed) members.add(p.body.handle);
    let disturbed = false;
    for (const p of woken) {
      for (const c of p.colliders) {
        world.contactPairsWith(c, (o) => {
          const b = o.parent();
          if (disturbed || !b || b.isFixed() || b.isSleeping() || members.has(b.handle)) return;
          world.contactPair(c, o, (m) => {
            if (m.numContacts() > 0) disturbed = true;
          });
        });
      }
    }
    if (disturbed) {
      groups.splice(i, 1);
      for (const p of g) if (!p.destroyed && !p.frozen) p.body.wakeUp();
    } else {
      for (const p of g) {
        if (p.destroyed || p.frozen) continue;
        p.body.setLinvel({ x: 0, y: 0 }, false);
        p.body.setAngvel(0, false);
        p.body.sleep();
      }
    }
  }
}

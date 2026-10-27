import type RAPIER from '@dimforge/rapier2d-compat';
import { PX } from '../engine/constants';
import { wrapAngle } from '../engine/math';
import { handleIndex } from '../engine/Physics';
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
      if (!awake && !p.body.isSleeping()) awake = true;
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
  const resting = entities.filter((e) => e.atRest && !e.destroyed);
  if (!resting.length) return;
  const links = linksOf(game);
  const group = calmGroup(game, resting, links);
  if (!group.length) return;
  // separate heaps sleep (and wake) separately: whatever of them is near (touching or not) or jointed
  const owner = byBody(group, false);
  const own = byBody(group, true);
  const root = group.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const join = (i: number, j: number) => {
    if (i >= 0 && j >= 0) root[find(i)] = find(j);
  };
  for (const pairs of [links.contacts, links.joints]) {
    for (let k = 0; k < pairs.length; k += 3) {
      join(memberAt(own, pairs[k]), memberAt(owner, pairs[k + 1]));
      join(memberAt(own, pairs[k + 1]), memberAt(owner, pairs[k]));
    }
  }
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

/**
 * Who is near whom and what's jointed to what, as Rapier has it now: three numbers
 * a pair, two bodies' handles and flags (TOUCH, STILL1, STILL2: see
 * World.contactBodyPairs() and jointBodyPairs()). One call each, not a few for each
 * collider of everyone at rest: in a heap of a hundred people, a frame's worth.
 */
interface Links {
  contacts: Float64Array;
  joints: Float64Array;
}

/** The pair's colliders touch; its first body is fixed or asleep; its second is. */
const TOUCH = 1;
const STILL1 = 2;
const STILL2 = 4;

function linksOf(game: Game): Links {
  const world = game.physics.world;
  return { contacts: world.contactBodyPairs(), joints: world.jointBodyPairs() };
}

/** By its body's index (see handleIndex()), the member each part of a group is, + 1 (0: none); only the parts that move, if `moving`. */
function byBody(group: Entity[], moving: boolean): Int32Array {
  let n = 0;
  for (const e of group) for (const p of e.parts) if (!p.destroyed) n = Math.max(n, handleIndex(p.body.handle) + 1);
  const of = new Int32Array(n);
  group.forEach((e, i) => {
    for (const p of e.parts) if (!p.destroyed && !(moving && p.frozen)) of[handleIndex(p.body.handle)] = i + 1;
  });
  return of;
}

/** The member a body is part of (see byBody()), -1 for none. */
function memberAt(of: Int32Array, body: number): number {
  const k = handleIndex(body);
  return k < of.length ? of[k] - 1 : -1;
}

/**
 * Of a group of entities at rest, those that can sleep: touching or jointed to
 * nothing still moving, nor to anyone dropped for that, and so on.
 */
export function calmGroup(game: Game, group: Entity[], links = linksOf(game)): Entity[] {
  const member = byBody(group, false);
  const own = byBody(group, true);
  const dropped = group.map(() => false);
  /** The members whose bodies touch each one (only awake ones count). */
  const touchedBy: number[][] = group.map(() => []);
  const queue: number[] = [];
  // member i (-1: none) touches or is jointed to `body`: unless that's fixed or asleep, i is dropped, or will be with whoever it's part of
  const meet = (i: number, body: number, still: boolean) => {
    if (i < 0 || still || dropped[i]) return;
    const j = memberAt(member, body);
    if (j === i) return;
    if (j < 0) {
      dropped[i] = true;
      queue.push(i);
    } else touchedBy[j].push(i);
  };
  const { contacts, joints } = links;
  for (let k = 0; k < contacts.length; k += 3) {
    const f = contacts[k + 2];
    if (!(f & TOUCH)) continue;
    meet(memberAt(own, contacts[k]), contacts[k + 1], (f & STILL2) !== 0);
    meet(memberAt(own, contacts[k + 1]), contacts[k], (f & STILL1) !== 0);
  }
  for (let k = 0; k < joints.length; k += 3) {
    const f = joints[k + 2];
    meet(memberAt(own, joints[k]), joints[k + 1], (f & STILL2) !== 0);
    meet(memberAt(own, joints[k + 1]), joints[k], (f & STILL1) !== 0);
  }
  while (queue.length) {
    for (const i of touchedBy[queue.pop()!]) {
      if (dropped[i]) continue;
      dropped[i] = true;
      queue.push(i);
    }
  }
  return group.filter((_, i) => !dropped[i]);
}

/** Asleep but with a velocity: something pushed it without waking it. */
/**
 * What holds `e` has changed (a connection made afresh, loosened or cut): it,
 * and any group it was settled into, wake and count as moving again. Woken
 * alone, it would still read as at rest until the next check, and settle()
 * would put it straight back to sleep, hanging where it was held.
 */
export function stir(game: Game, e: Entity): void {
  const unrest = (x: Entity) => {
    x.atRest = false;
    x.restChecks = x.slowChecks = 0;
  };
  unrest(e);
  const groups = game.slept;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g.some((p) => p.entity === e)) continue;
    groups.splice(i, 1);
    for (const p of g) {
      unrest(p.entity);
      if (!p.destroyed && !p.frozen) p.body.wakeUp();
    }
  }
  for (const p of e.parts) if (!p.destroyed && !p.frozen) p.body.wakeUp();
}

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
 * the group (a crate landing on it) or tied to one, nothing is disturbing it:
 * it goes straight back to sleep, rather than waking the whole pile (which
 * would start it buzzing again) or staying awake alone (see wakeSettled()).
 * Called every step after the physics step.
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
      // tied to something awake from outside (a balloon's rope pulling): as calmGroup() has it
      world.impulseJoints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
        const j = world.impulseJoints.get(h);
        if (disturbed || !j) return;
        const o = j.body1().handle === p.body.handle ? j.body2() : j.body1();
        if (!o.isFixed() && !o.isSleeping() && !members.has(o.handle)) disturbed = true;
      });
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

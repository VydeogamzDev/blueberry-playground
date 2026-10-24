import { RAPIER } from '../engine/Physics';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';

/** Deeper than this (m) in new ground, a thing is lifted out (less, the physics eases it out). */
const DEEP = 0.02;
/** Left this far (m) over the ground it's lifted onto, to settle on it. */
const CLEAR = 0.005;

/**
 * Ground just laid where things are (the Terrain tool, or a map's ground made
 * again): whatever it went through is lifted out onto it, with everything
 * jointed to it, rather than shoved out at 10 m/s by the physics in a step.
 * (Frozen things stay where they are, and so does what's jointed to them.)
 */
export function liftOutOfGround(game: Game): void {
  const pieces = game.env.ground.map((g) => new RAPIER.ConvexPolygon(new Float32Array(g.pts.flat()), false));
  if (!pieces.length) return;
  const world = game.physics.world;
  // what's deep in a piece of the ground now
  const deep = new Set<Entity>();
  for (const shape of pieces) {
    world.intersectionsWithShape({ x: 0, y: 0 }, 0, shape, (c) => {
      const p = game.physics.partOf(c);
      if (p && !p.destroyed && !p.frozen && !deep.has(p.entity) && c.intersectsShape(shape, { x: 0, y: -DEEP }, 0)) deep.add(p.entity);
      return true;
    });
  }
  const done = new Set<Entity>();
  for (const e of deep) {
    if (done.has(e)) continue;
    const group = jointedTo(game, e);
    for (const g of group) done.add(g);
    if (group.some((g) => g.parts.some((p) => !p.destroyed && p.frozen))) continue;
    const colliders = group.flatMap((g) => g.parts.filter((p) => !p.destroyed).flatMap((p) => p.colliders));
    // (lifted by `up`, it's in no ground: the ground lowered by as much)
    const clear = (up: number) => colliders.every((c) => pieces.every((s) => !c.intersectsShape(s, { x: 0, y: -up }, 0)));
    let hi = 0.25;
    while (!clear(hi) && hi < 64) hi *= 2;
    if (!clear(hi)) continue;
    let lo = 0;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (clear(mid)) hi = mid;
      else lo = mid;
    }
    for (const g of group) g.translate(0, hi + CLEAR);
  }
}

/** An entity and everything held to it by joints (connections, a car's riders...), one way or another. */
function jointedTo(game: Game, e: Entity): Entity[] {
  const joints = game.physics.world.impulseJoints;
  const out = [e];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const p of out[i].parts) {
      if (p.destroyed) continue;
      joints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
        const j = joints.get(h);
        if (!j) return;
        for (const b of [j.body1(), j.body2()]) {
          const q = b.numColliders() ? game.physics.partOf(b.collider(0)) : undefined;
          if (q && !q.destroyed && !seen.has(q.entity)) {
            seen.add(q.entity);
            out.push(q.entity);
          }
        }
      });
    }
  }
  return out;
}

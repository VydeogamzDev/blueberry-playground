import type { Game } from './Game';
import type { Entity } from './Entity';
import type { V2 } from '../engine/math';
import { capture, instantiate, type Snapshot } from './Snapshot';

/** Further than this (m) from every player's view, a thing (and all it's joined to) is parked. */
export const PARK_AT = 2000;
/** A view this near (m) a parked thing brings it back. */
export const UNPARK_AT = 1800;
/** How often (s) things are looked over for parking. */
const EVERY = 1;

/**
 * Something parked: captured as it was and taken out of the world. Its positions
 * are local to where the floating origin was then (ox, oy; see world/Origin), and
 * (x, y) is where it truly is, its middle.
 */
export interface Parked {
  x: number;
  y: number;
  ox: number;
  oy: number;
  snap: Snapshot;
}

/**
 * The World map goes on for ever, and so could what's left about on it: whatever
 * is far from every player's view (PARK_AT) is parked, taken out of the world and
 * kept as it was, all it's joined to with it (wires, ropes, a rider, what's held),
 * and put back just so when someone comes near again (UNPARK_AT). Nothing parked
 * moves or costs anything; it's as if time stopped for it out of sight. Only on the
 * World, and only the host (or a lone player) parks: guests see it come and go.
 */
export class Parking {
  list: Parked[] = [];
  private game: Game;
  private t = 0;

  constructor(game: Game) {
    this.game = game;
  }

  step(dt: number): void {
    const g = this.game;
    if (!g.map.world || g.net?.guest) return;
    this.t += dt;
    if (this.t < EVERY) return;
    this.t = 0;
    const views = this.views();
    this.unpark(views);
    this.park(views);
  }

  /** Where the players are looking (local m): this screen's camera, and each guest's pointer. */
  private views(): V2[] {
    const g = this.game;
    const out: V2[] = [{ x: g.renderer.camX, y: g.renderer.camY }];
    for (const v of g.net?.views?.() ?? []) out.push(v);
    return out;
  }

  private park(views: V2[]): void {
    const g = this.game;
    const far = (x: number, y: number, d: number) => views.every((v) => (x - v.x) ** 2 + (y - v.y) ** 2 > d * d);
    const done = new Set<Entity>();
    for (const e of [...g.entities]) {
      if (e.destroyed || done.has(e)) continue;
      const p = e.parts.find((q) => !q.destroyed);
      if (!p || !far(p.x, p.y, PARK_AT)) continue;
      const group = this.groupOf(e);
      for (const m of group) done.add(m);
      // (all of it out of sight, a little nearer even: something reaching back toward a view stays)
      if (!group.every((m) => m.parts.every((q) => q.destroyed || far(q.x, q.y, PARK_AT - 100)))) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const m of group) {
        for (const q of m.parts) {
          if (q.destroyed) continue;
          sx += q.x;
          sy += q.y;
          n++;
        }
      }
      if (!n) continue;
      this.list.push({ x: sx / n + g.origin.x, y: sy / n + g.origin.y, ox: g.origin.x, oy: g.origin.y, snap: capture(g, group) });
      g.stats.quiet++;
      for (const m of group) g.remove(m);
      g.stats.quiet--;
    }
  }

  private unpark(views: V2[]): void {
    const g = this.game;
    const near = (k: Parked) => views.some((v) => (k.x - g.origin.x - v.x) ** 2 + (k.y - g.origin.y - v.y) ** 2 < UNPARK_AT * UNPARK_AT);
    const back = this.list.filter(near);
    if (!back.length) return;
    this.list = this.list.filter((k) => !back.includes(k));
    for (const k of back) instantiate(g, k.snap, { dx: k.ox - g.origin.x, dy: k.oy - g.origin.y });
  }

  /**
   * An entity and everything it's joined to, one way or another: connections (wires
   * too), and joints of its own (a rider in a seat, a held gun, a lodged blade).
   */
  private groupOf(e: Entity): Entity[] {
    const g = this.game;
    const joints = g.physics.world.impulseJoints;
    const out = [e];
    const seen = new Set(out);
    const add = (m: Entity | undefined) => {
      if (m && !m.destroyed && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    };
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      for (const a of g.connections.assemblyOf([m], false)) add(a);
      for (const p of m.parts) {
        if (p.destroyed) continue;
        joints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
          const j = joints.get(h);
          if (!j) return;
          for (const b of [j.body1(), j.body2()]) {
            const q = b.numColliders() ? g.physics.partOf(b.collider(0)) : undefined;
            add(q?.entity);
          }
        });
      }
    }
    return out;
  }

  clear(): void {
    this.list = [];
    this.t = 0;
  }
}

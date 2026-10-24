import { RAPIER } from '../engine/Physics';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import { LineBatch } from './Connections';

/** Flesh (or wiring) still holding a torn-off limb on: a stretchy spring between the two stumps. */
interface Tendon {
  joint: RAPIER.ImpulseJoint;
  a: Part;
  b: Part;
  /** The stumps' ends (local meters). */
  la: V2;
  lb: V2;
  /** How far it stretches before it starts to give (m), and how far it's given so far. */
  snap: number;
  strain: number;
  /** Thickness, unstretched (m). */
  width: number;
  outer: number;
  inner: number;
}

/**
 * Torn joints that haven't let go yet: a limb wrenched out of its socket hangs on
 * by stretched flesh, drawn as strands between the stumps that thin as they're
 * pulled, until they snap. One per body, drawn just behind its parts.
 */
export class Tendons {
  private game: Game;
  private list: Tendon[] = [];
  private batch: LineBatch | null = null;
  private z: number;

  constructor(game: Game, z: number) {
    this.game = game;
    this.z = z;
  }

  get count(): number {
    return this.list.length;
  }

  /**
   * Is `p` a limb hanging on by one? (Only the hanging end: the limb it hangs
   * from may have been cut off itself, and is no torn limb for that.)
   */
  holds(p: Part): boolean {
    return this.list.some((t) => t.b === p);
  }

  /** The parts outside `group` that strands tie it to (a torn limb's body, or the limb hanging from the body). */
  tiedTo(group: Set<Part>): Part[] {
    const out: Part[] = [];
    for (const t of this.list) {
      if (t.a.destroyed || t.b.destroyed) continue;
      if (group.has(t.b) && !group.has(t.a)) out.push(t.a);
      else if (group.has(t.a) && !group.has(t.b)) out.push(t.b);
    }
    return out;
  }

  /** Ties the stump of `b` back to `a`: stiff enough to hold the limb's weight with a sag, not to work it. */
  add(a: Part, la: V2, b: Part, lb: V2, width: number, colors: { outer: number; inner: number }): void {
    const m = b.mass;
    const k = Math.max(400, m * 400);
    const j = this.game.physics.world.createImpulseJoint(RAPIER.JointData.spring(0, k, m * 6, la, lb), a.body, b.body, true);
    j.setContactsEnabled(false);
    this.list.push({ joint: j, a, b, la, lb, snap: 0.4 + width * 4, strain: 0, width, outer: colors.outer, inner: colors.inner });
  }

  /**
   * Lets go of any that gave way (overstretched for a moment, or yanked out to more
   * than twice as far at once), or whose limb is gone; returns where each snapped.
   */
  step(dt: number): V2[] {
    const out: V2[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      const gone = t.a.destroyed || t.b.destroyed || !t.joint.isValid();
      const pa = gone ? null : t.a.localToWorld(t.la.x, t.la.y);
      const pb = gone ? null : t.b.localToWorld(t.lb.x, t.lb.y);
      if (pa && pb) {
        const over = Math.hypot(pa.x - pb.x, pa.y - pb.y) / t.snap - 1;
        if (over > 0) t.strain += over * dt;
        if (over < 1.5 && t.strain < 0.15) continue;
      }
      if (t.joint.isValid()) this.game.physics.world.removeImpulseJoint(t.joint, true);
      this.list.splice(i, 1);
      if (pa && pb) out.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    }
    return out;
  }

  /** Draws the strands: a red core and two of skin either side, thinning as they stretch. */
  draw(): void {
    if (!this.list.length && !this.batch) return;
    if (!this.batch) {
      this.batch = new LineBatch(48, this.z);
      this.game.renderer.scene.add(this.batch.mesh);
    }
    const b = this.batch;
    b.begin();
    for (const t of this.list) {
      if (t.a.destroyed || t.b.destroyed) continue;
      const pa = t.a.localToWorld(t.la.x, t.la.y);
      const pb = t.b.localToWorld(t.lb.x, t.lb.y);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy);
      const thin = Math.max(0.15, 1 - d / (t.snap * 2)) * (1 - t.strain * 4);
      const w = t.width * thin;
      // the strands part sideways as they're drawn out
      const nx = d > 1e-4 ? -dy / d : 0;
      const ny = d > 1e-4 ? dx / d : 0;
      const s = w * 0.6 * (1 - thin * 0.5);
      b.seg(pa.x + nx * s, pa.y + ny * s, pb.x + nx * s * 0.5, pb.y + ny * s * 0.5, w * 0.45, t.outer);
      b.seg(pa.x - nx * s, pa.y - ny * s, pb.x - nx * s * 0.5, pb.y - ny * s * 0.5, w * 0.35, t.outer);
      b.seg(pa.x, pa.y, pb.x, pb.y, w * 0.5, t.inner);
    }
    b.end();
  }

  /** Drops everything (the body is gone). */
  clear(): void {
    const world = this.game.physics.world;
    for (const t of this.list) if (t.joint.isValid()) world.removeImpulseJoint(t.joint, true);
    this.list.length = 0;
    if (this.batch) {
      this.game.renderer.scene.remove(this.batch.mesh);
      this.batch.mesh.geometry.dispose();
      this.batch = null;
    }
  }
}

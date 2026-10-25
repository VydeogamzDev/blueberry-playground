import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { ImpactInfo } from '../world/types';
import type { ImpactSound } from '../world/Materials';

/** Speed below which contacts are considered resting (no damage, no sound). */
const MIN_SPEED = 1.1;

/**
 * Converts Rapier contact-force events into gameplay impacts: approach speed is
 * measured from the velocities recorded before the step, so resting contact
 * (large force, no speed) does not count as an impact.
 */
export class Impacts {
  private game: Game;
  /** Impacts processed during the last step (for diagnostics). */
  lastCount = 0;
  /** Collider pairs already counted this step: the higher handle of each, by the lower. */
  private seen = new Map<number, number[]>();

  constructor(game: Game) {
    this.game = game;
  }

  process(): void {
    const phys = this.game.physics;
    const world = phys.world;
    let count = 0;
    const seen = this.seen;
    seen.clear();
    // all the events at once, as numbers (see drainContactForceEventsFlat): no object
    // made for each, and no call back into Rapier for its point
    const evs = phys.events.drainContactForceEventsFlat(world.bodies);
    for (let k = 0; k < evs.length; k += 8) {
      const h1 = evs[k];
      const h2 = evs[k + 1];
      const p1 = phys.partOf(h1) ?? null;
      const p2 = phys.partOf(h2) ?? null;
      if (!p1 && !p2) continue;
      if ((p1 && p1.destroyed) || (p2 && p2.destroyed)) continue;

      // quick reject using body-center velocities: first however they're moving
      // (bodies pressed together in a heap, going nowhere: most events there)...
      const v1x = p1 ? p1.vx : 0;
      const v1y = p1 ? p1.vy : 0;
      const v2x = p2 ? p2.vx : 0;
      const v2y = p2 ? p2.vy : 0;
      const maxAng = Math.max(p1 ? Math.abs(p1.av) : 0, p2 ? Math.abs(p2.av) : 0);
      // (Math.hypot() is a lot slower than this, thousands of times a step in a heap)
      const rx = v1x - v2x;
      const ry = v1y - v2y;
      if (Math.sqrt(rx * rx + ry * ry) + maxAng * 0.6 < MIN_SPEED) continue;
      // one impact per collider pair per step
      // (handles are opaque f64 bit patterns: no one number holds two, and turning them into strings is slow)
      const lo = h1 < h2 ? h1 : h2;
      const hi = h1 < h2 ? h2 : h1;
      const met = seen.get(lo);
      if (!met) seen.set(lo, [hi]);
      else if (met.includes(hi)) continue;
      else met.push(hi);
      const force = evs[k + 2];
      const dx = evs[k + 3];
      const dy = evs[k + 4];
      const dl = Math.sqrt(dx * dx + dy * dy);
      if (dl < 1e-6) continue;
      const nx = dx / dl;
      const ny = dy / dl;
      // ...then toward each other
      const quick = Math.abs(rx * nx + ry * ny);
      if (quick + maxAng * 0.6 < MIN_SPEED) continue;

      // contact point (where they touch first, as Rapier has it; else the part's middle)
      let px = evs[k + 5];
      let py = evs[k + 6];
      if (evs[k + 7] === 0) {
        const a = p1 ?? p2!;
        px = a.x;
        py = a.y;
      }

      // relative velocity at the contact point (pre-step)
      const va = velAt(p1, px, py);
      const vb = velAt(p2, px, py);
      const rvx = va.x - vb.x;
      const rvy = va.y - vb.y;
      const along = rvx * nx + rvy * ny;
      const speed = Math.abs(along);
      const sx = rvx - along * nx;
      const sy = rvy - along * ny;
      const slide = Math.sqrt(sx * sx + sy * sy);
      if (speed < MIN_SPEED) continue;
      count++;

      const m1 = p1 && !p1.frozen ? p1.mass : Infinity;
      const m2 = p2 && !p2.frozen ? p2.mass : Infinity;
      // orient the normal so it points into p1 (and out of p2): by p1, or against the
      // ground (no part on that side, whichever side it is), by p2
      let n1x = nx;
      let n1y = ny;
      if (p1 ? (p1.x - px) * nx + (p1.y - py) * ny < 0 : !!p2 && (p2.x - px) * nx + (p2.y - py) * ny > 0) {
        n1x = -nx;
        n1y = -ny;
      }
      // split the approach into each body's own motion (n1 points into p1)
      const s1 = Math.max(0, -(va.x * n1x + va.y * n1y));
      const s2 = Math.max(0, vb.x * n1x + vb.y * n1y);
      if (p1) {
        const info: ImpactInfo = {
          part: p1, other: p2, speed, force, point: { x: px, y: py }, normal: { x: n1x, y: n1y }, otherMass: m2, slide,
          selfSpeed: s1, otherSpeed: s2,
        };
        p1.entity.onImpact(info);
      }
      if (p2 && !p2.destroyed) {
        const info: ImpactInfo = {
          part: p2, other: p1, speed, force, point: { x: px, y: py }, normal: { x: -n1x, y: -n1y }, otherMass: m1, slide,
          selfSpeed: s2, otherSpeed: s1,
        };
        p2.entity.onImpact(info);
      }
      this.playSound(p1, p2, speed, m1, m2, px, py, n1x, n1y);
    }
    this.lastCount = count;
  }

  private playSound(p1: Part | null, p2: Part | null, speed: number, m1: number, m2: number, x: number, y: number, nx: number, ny: number): void {
    const mMin = Math.min(m1, m2, 200);
    const massF = Math.min(1, 0.25 + Math.sqrt(mMin) * 0.25);
    const strength = Math.min(1, (speed - MIN_SPEED) / 9) * massF;
    if (strength < 0.03) return;
    const s1: ImpactSound = p1 ? p1.mat.sound : 'stone';
    const s2: ImpactSound = p2 ? p2.mat.sound : 'stone';
    // the lighter object usually dominates the sound; but a blow on something soft
    // (a body, rubber) is a thud: the hard thing that hits it barely rings
    const soft1 = s1 === 'flesh' || s1 === 'rubber';
    const soft2 = s2 === 'flesh' || s2 === 'rubber';
    const primary = soft1 !== soft2 ? (soft1 ? s1 : s2) : m1 <= m2 ? s1 : s2;
    const secondary = primary === s1 ? s2 : s1;
    this.game.sound.impact(primary, strength, x);
    if (secondary !== primary && strength > 0.25) this.game.sound.impact(secondary, strength * (soft1 !== soft2 ? 0.35 : 0.5), x);
    // sparks on hard metal impacts
    const metal = (p1?.mat.sparks ?? true) && (p2?.mat.sparks ?? true);
    if (metal && speed > 7 && (s1 === 'metal' || s2 === 'metal')) {
      this.game.particles.sparks(x, y, nx, ny, Math.min(10, Math.round(speed / 2)), speed * 0.4);
    }
    if (speed > 6 && (s1 === 'wood' || s2 === 'wood') && Math.random() < 0.3) {
      const wood = s1 === 'wood' ? p1 : p2;
      if (wood) this.game.particles.debris(x, y, nx, ny, 2, wood.mat.debrisColor, 2);
    }
  }
}

function velAt(p: Part | null, x: number, y: number): { x: number; y: number } {
  if (!p || p.frozen) return { x: 0, y: 0 };
  const rx = x - p.x;
  const ry = y - p.y;
  return { x: p.vx - p.av * ry, y: p.vy + p.av * rx };
}

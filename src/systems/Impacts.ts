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
  private seen = new Set<string>();

  constructor(game: Game) {
    this.game = game;
  }

  process(): void {
    const phys = this.game.physics;
    const world = phys.world;
    let count = 0;
    const seen = this.seen;
    seen.clear();
    phys.events.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      // one impact per collider pair per step
      // (handles are opaque f64 bit patterns, so build a string key)
      const key = h1 < h2 ? `${h1}|${h2}` : `${h2}|${h1}`;
      if (seen.has(key)) return;
      seen.add(key);
      const p1 = phys.partOf(h1) ?? null;
      const p2 = phys.partOf(h2) ?? null;
      if (!p1 && !p2) return;
      if ((p1 && p1.destroyed) || (p2 && p2.destroyed)) return;
      const force = ev.totalForceMagnitude();
      const dir = ev.maxForceDirection();
      const dl = Math.hypot(dir.x, dir.y);
      if (dl < 1e-6) return;
      const nx = dir.x / dl;
      const ny = dir.y / dl;

      // quick reject using body-center velocities
      const v1x = p1 ? p1.vx : 0;
      const v1y = p1 ? p1.vy : 0;
      const v2x = p2 ? p2.vx : 0;
      const v2y = p2 ? p2.vy : 0;
      const quick = Math.abs((v1x - v2x) * nx + (v1y - v2y) * ny);
      const maxAng = Math.max(p1 ? Math.abs(p1.av) : 0, p2 ? Math.abs(p2.av) : 0);
      if (quick + maxAng * 0.6 < MIN_SPEED) return;

      // contact point
      let px = 0;
      let py = 0;
      let found = false;
      const c1 = world.getCollider(h1);
      const c2 = world.getCollider(h2);
      if (c1 && c2) {
        world.contactPair(c1, c2, (m) => {
          if (found || m.numSolverContacts() === 0) return;
          const pt = m.solverContactPoint(0);
          if (pt) {
            px = pt.x;
            py = pt.y;
            found = true;
          }
        });
      }
      if (!found) {
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
      const slide = Math.hypot(rvx - along * nx, rvy - along * ny);
      if (speed < MIN_SPEED) return;
      count++;

      const m1 = p1 && !p1.frozen ? p1.mass : Infinity;
      const m2 = p2 && !p2.frozen ? p2.mass : Infinity;
      // orient the normal so it points into each part
      let n1x = nx;
      let n1y = ny;
      if (p1 && (p1.x - px) * nx + (p1.y - py) * ny < 0) {
        n1x = -nx;
        n1y = -ny;
      }
      if (p1) {
        const info: ImpactInfo = {
          part: p1, other: p2, speed, force, point: { x: px, y: py }, normal: { x: n1x, y: n1y }, otherMass: m2, slide,
        };
        p1.entity.onImpact(info);
      }
      if (p2 && !p2.destroyed) {
        const info: ImpactInfo = {
          part: p2, other: p1, speed, force, point: { x: px, y: py }, normal: { x: -n1x, y: -n1y }, otherMass: m1, slide,
        };
        p2.entity.onImpact(info);
      }
      this.playSound(p1, p2, speed, m1, m2, px, py, n1x, n1y);
    });
    this.lastCount = count;
  }

  private playSound(p1: Part | null, p2: Part | null, speed: number, m1: number, m2: number, x: number, y: number, nx: number, ny: number): void {
    const mMin = Math.min(m1, m2, 200);
    const massF = Math.min(1, 0.25 + Math.sqrt(mMin) * 0.25);
    const strength = Math.min(1, (speed - MIN_SPEED) / 9) * massF;
    if (strength < 0.03) return;
    const s1: ImpactSound = p1 ? p1.mat.sound : 'stone';
    const s2: ImpactSound = p2 ? p2.mat.sound : 'stone';
    // the lighter object usually dominates the sound
    const primary = m1 <= m2 ? s1 : s2;
    const secondary = primary === s1 ? s2 : s1;
    this.game.sound.impact(primary, strength, x);
    if (secondary !== primary && strength > 0.25) this.game.sound.impact(secondary, strength * 0.5, x);
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

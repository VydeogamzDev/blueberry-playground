import { PX } from '../engine/constants';
import { PK } from './Particles';
import { waterOver } from './Breath';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** How often (s) depth is looked at. */
const EVERY = 0.25;

/**
 * How deep (m) each material holds out under water before the pressure crushes it (a
 * hull of it: the squeezed world's sea is shallow, so these are too).
 */
const CRUSH: Record<string, number> = {
  Wood: 45, Plastic: 40, Glass: 30, Rubber: 70, 'Sheet metal': 60, Metal: 160, Steel: 160, Stone: 300, Concrete: 300, Ablator: 80, Armour: 220,
};
const CRUSH_DEFAULT = 120;

/**
 * The sea (0.4.0): deep enough, the water's weight crushes what's down there (a
 * submarine's hull past its depth groans, then caves in, part by part); fast through the
 * surface, things throw up spray and leave a wake of foam.
 */
export class Seafaring {
  private t = 0;

  constructor(private game: Game) {}

  /** How deep `p`'s material holds out (m). */
  static crushDepth(p: Part): number {
    return CRUSH[p.mat.name] ?? CRUSH_DEFAULT;
  }

  step(dt: number): void {
    const g = this.game;
    if (g.net?.guest || (!g.map.water && !g.fluid.n)) return;
    this.t += dt;
    const look = this.t >= EVERY;
    const span = this.t;
    if (look) this.t = 0;
    for (const e of g.entities) {
      if (e.destroyed || (e as { alive?: boolean }).alive !== undefined) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.frozen) continue;
        // (between looks only what's fast enough to throw spray)
        if (!look && Math.abs(p.vx) < 3) continue;
        const level = waterOver(g, p.x, p.y);
        if (level === null) continue;
        const half = (Math.max(p.w, p.h) * PX) / 2;
        // spray and wake: crossing the surface fast
        if (Math.abs(p.y - level) < half + 0.1) {
          const v = Math.abs(p.vx);
          if (v > 3 && Math.random() < Math.min(1, v / 15)) {
            const back = -Math.sign(p.vx);
            g.particles.emit(PK.Smoke, p.x + back * half, level + 0.05, {
              vx: back * v * 0.25 + (Math.random() - 0.5), vy: 1 + Math.random() * v * 0.2, life: 0.5 + Math.random() * 0.5, size: 0.08, size1: 0.25,
              color: 0xffffff, color1: 0xd6ecf7, alpha: 0.8, alpha1: 0, gravity: 1, drag: 1,
            });
          }
          continue;
        }
        if (!look) continue;
        const depth = level - p.y;
        const crush = Seafaring.crushDepth(p);
        if (depth <= crush || !Number.isFinite(p.maxHp)) continue;
        // past its depth: the deeper, the faster it gives
        const k = Math.min(3, (depth - crush) / crush + 0.2);
        e.damage(p, p.maxHp * 0.25 * k * span, 'crush');
        if (Math.random() < 0.3) g.sound.impact('metal', 0.3, p.x);
      }
    }
  }
}

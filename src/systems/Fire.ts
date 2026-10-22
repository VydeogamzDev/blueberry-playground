import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** Burning parts: emit flames and smoke, char, take damage and spread to neighbours. */
export class Fire {
  private game: Game;
  private burning = new Set<Part>();
  private spreadTimer = 0;

  constructor(game: Game) {
    this.game = game;
  }

  get count(): number {
    return this.burning.size;
  }

  ignite(p: Part, amount = 0.6): void {
    if (p.destroyed || p.mat.flammability <= 0) return;
    p.burning = Math.min(1, Math.max(p.burning, amount));
    this.burning.add(p);
  }

  extinguish(p: Part): void {
    p.burning = 0;
    this.burning.delete(p);
  }

  step(dt: number): void {
    if (!this.burning.size) return;
    const g = this.game;
    this.spreadTimer -= dt;
    const doSpread = this.spreadTimer <= 0;
    if (doSpread) this.spreadTimer = 0.25;
    for (const p of this.burning) {
      if (p.destroyed) {
        this.burning.delete(p);
        continue;
      }
      const fl = p.mat.flammability;
      // fuel: very flammable materials grow, others die down
      p.burning += dt * (fl - 0.45) * 0.25 - dt * p.charred * 0.12;
      p.burning = Math.min(1, p.burning);
      if (p.burning <= 0.02) {
        this.extinguish(p);
        continue;
      }
      p.charred = Math.min(1, p.charred + dt * 0.06 * p.burning);
      p.entity.damage(p, dt * 6 * p.burning, 'fire');
      // flames
      const rate = 10 + p.burning * 55 * Math.sqrt((p.w * p.h) / 120);
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const ix = Math.floor(Math.random() * p.w);
          const iy = Math.floor(Math.random() * p.h);
          if (p.solidAt(ix, iy)) {
            const w = p.pixelToWorld(ix, iy);
            g.particles.fire(w.x, w.y, p.burning);
            if (Math.random() < 0.08) g.particles.smoke(w.x, w.y + 0.1, 1, 0.25, true);
          }
        }
        n -= 1;
      }
      if (doSpread && p.burning > 0.3) {
        for (const c of p.colliders) {
          g.physics.world.contactPairsWith(c, (other) => {
            const q = g.physics.partOf(other);
            if (q && q !== p && q.burning < 0.1 && Math.random() < q.mat.flammability * 0.35 * p.burning) this.ignite(q, 0.3);
          });
        }
      }
    }
  }

  clear(): void {
    for (const p of this.burning) p.burning = 0;
    this.burning.clear();
  }
}

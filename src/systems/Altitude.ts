import type { Game } from '../world/Game';
import { PX } from '../engine/constants';

/** Under this height (m, true), gravity is near enough the ground's to leave alone (within 0.2%). */
const FULL_G = 30;
/** Every this many steps, what's sunk into the ground is looked for (see unbury()). */
const BURY_EVERY = 4;
/** Left this far (m) over the ground, lifted out of it. */
const CLEAR = 0.02;
/** A part's damping is set again (see step()) once the air's thinned or thickened by this share of it. */
const DAMP_STEP = 0.1;

/**
 * The World map's heights (see world/Atmosphere, world/WorldGround): things weigh
 * less the higher they are, R² / (R + h)² of what they weigh on the ground; and
 * whatever has gone through the ground (too fast for a step to catch it on the
 * surface) is put back on top of it. Nothing on any other map.
 *
 * Cheap: one multiplication a part for the weight, and only parts above FULL_G pay
 * even that; the ground under each part is a lookup in its chunk's heights.
 */
export class Altitude {
  private game: Game;
  private k = 0;

  constructor(game: Game) {
    this.game = game;
  }

  step(dt: number): void {
    const g = this.game;
    // (a guest's copy is moved only by the host's poses)
    if (!g.map.world || g.net?.guest) return;
    const air = g.air;
    const pull = -g.gravity;
    const lift = (++this.k % BURY_EVERY) === 0;
    for (const e of g.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.frozen) continue;
        const b = p.body;
        if (b.isSleeping()) continue;
        // lighter up high: gravity's pull taken back by the share it's lost there
        if (p.y + air.base > FULL_G) {
          const lost = 1 - air.gravityAt(p.y);
          const s = b.gravityScale();
          // (0.4.0: and going round the planet fast, it falls round it: sideways at v, as much
          // of its weight is taken back as v² / (R + h) is of gravity: orbit, as fast as that's all of it)
          const round = (p.vx * p.vx) / (air.radius + p.y + air.base) / Math.max(0.1, pull);
          if ((lost > 0 || round > 0) && s !== 0) b.applyImpulse({ x: 0, y: b.mass() * pull * s * (lost + round) * dt }, false);
          // and its damping, the air's settling hold on it, fading with the air (in space, nothing
          // slows it): set again only when the air's changed by DAMP_STEP of it, a call now and then
          const want = p.linDamp * air.thinness(p.y);
          // (and all the way to none: the last step under DAMP_STEP would otherwise never be taken, and orbits decayed)
          if (Math.abs(want - p.linDampNow) > DAMP_STEP * p.linDamp || (want < 0.01 * p.linDamp && p.linDampNow !== 0)) {
            p.linDampNow = want < 0.01 * p.linDamp ? 0 : want;
            b.setLinearDamping(p.linDampNow);
          }
        } else if (p.linDampNow !== p.linDamp) {
          p.linDampNow = p.linDamp;
          b.setLinearDamping(p.linDamp);
        }
      }
      if (lift) this.unbury(e);
    }
  }

  /**
   * A thing fallen through the ground (its middle a whole half-size under the top
   * there): lifted back out onto it, its fall stopped. The ground's a heightfield,
   * a skin with nothing under it: a fast fall can pass through it in a step.
   */
  private unbury(e: Game['entities'][number]): void {
    const w = this.game.env.world;
    if (!w) return;
    let up = 0;
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      const r = (Math.max(p.w, p.h) * PX) / 2;
      const h = w.heightAt(p.x);
      if (p.y + r < h) up = Math.max(up, h - p.y + r + CLEAR);
    }
    if (up <= 0) return;
    e.translate(0, up);
    for (const p of e.parts) {
      if (p.destroyed || p.frozen) continue;
      const v = p.body.linvel();
      if (v.y < 0) p.body.setLinvel({ x: v.x, y: 0 }, true);
    }
  }
}

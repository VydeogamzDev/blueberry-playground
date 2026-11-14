import type { Part } from '../world/Part';

/**
 * Whole-body trauma: a body stopped (or flung) harder than it bears in a moment,
 * like a long fall onto hard ground (feet first or not), a crash or a blast, is hurt
 * inside, whatever part of it struck first (see Human, Creature). A limb's own knock
 * (see onImpact()) is only what that limb takes: before this, landing feet first from
 * 40 m broke the legs and left the rest unhurt, conscious and talking.
 *
 * It measures the change in the trunk's velocity over the last WINDOW seconds, less
 * what gravity did. Past `dv0` m/s it does harm, growing with the square of the
 * excess (see harm()). For a person, dv0 is 14 m/s, the speed a 10 m fall lands at;
 * 30 m down (22 m/s) is very likely fatal.
 */
const WINDOW = 0.06;
const N = 8;
/** (m/s) Past the tolerance, how much more makes harm 1 (see harm()). */
const DV_K = 7;

export class Jolt {
  private readonly vx = new Float32Array(N);
  private readonly vy = new Float32Array(N);
  private readonly at = new Float32Array(N);
  private head = 0;
  private n = 0;
  /** Of the jolt going on, the harm already done (see step()). */
  private done = 0;

  /** Forgets what came before: a body set moving by hand (thrown by a tool, a test) isn't jolted. */
  reset(): void {
    this.n = 0;
    this.done = 0;
  }

  /**
   * Takes this step's velocity of the trunk (`parts`, mass-weighted); returns the harm
   * newly done (0 none; 1 about what kills, see DV_K), each jolt counted once
   * as it builds.
   */
  step(parts: readonly Part[], time: number, gy: number, dv0: number): number {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const p of parts) {
      if (p.destroyed || p.detached) continue;
      mx += p.vx * p.mass;
      my += p.vy * p.mass;
      m += p.mass;
    }
    if (m <= 0) return 0;
    const vx = mx / m;
    const vy = my / m;
    // the worst change over any stretch of the window back to now
    let worst = 0;
    for (let k = 0, i = this.head; k < this.n; k++) {
      i = (i + N - 1) % N;
      const t = time - this.at[i];
      if (t > WINDOW + 1e-6) break;
      const dx = vx - this.vx[i];
      const dy = vy - this.vy[i] - gy * t;
      const d2 = dx * dx + dy * dy;
      if (d2 > worst) worst = d2;
    }
    this.vx[this.head] = vx;
    this.vy[this.head] = vy;
    this.at[this.head] = time;
    this.head = (this.head + 1) % N;
    if (this.n < N) this.n++;
    const dv = Math.sqrt(worst);
    if (dv <= dv0) {
      this.done = 0;
      return 0;
    }
    const h = harm(dv, dv0);
    if (h <= this.done) return 0;
    const add = h - this.done;
    this.done = h;
    return add;
  }
}

/** The harm of a jolt of `dv` m/s on a body that bears `dv0` (0 at it; 1 DV_K past it, then the square). */
export function harm(dv: number, dv0: number): number {
  const k = (dv - dv0) / DV_K;
  return k > 0 ? k * k : 0;
}

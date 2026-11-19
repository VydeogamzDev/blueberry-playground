import { smoothstep } from '../engine/math';

/**
 * The World map's ground (see world/Maps' WORLD_MAP): one height for every x,
 * going on for ever either way, made from a seed. Flat for FLAT m either side of
 * the start, then plains, rolling hills, mountains with ridges, mesas with cliff
 * edges and valleys, each region giving way to the next over kilometres.
 *
 * Heights are in true meters (x and the result both: the floating origin, see
 * world/Origin, is the caller's business), and the same for a seed on every
 * machine: only whole-number hashing and Math functions every engine rounds alike.
 */

/** How far (m) either side of the start the ground is flat (and at 0). */
export const FLAT = 200;
/** And east of the start, the airfield (0.4.5): flat on to here (m), long enough for an airliner to take off and land. */
export const AIRFIELD = 2600;
/** Over how much more (m) past FLAT the land rises into its own shape. */
const EASE = 300;
/** How far apart (m) the ground's heights are sampled for the physics and its drawing (see Environment's chunks). */
export const SAMPLE = 0.5;
/** How steep (rise over run) ground has to be to be bare rock. */
export const ROCK_SLOPE = 1.1;
/** Above this (m), mountains are bare rock whatever their slope. */
export const ROCK_HEIGHT = 240;

/** A number in [0, 1) for a whole number and a seed. */
function hash(i: number, seed: number): number {
  // (folded into 32 bits: past 2^31 lattice points out it repeats, thousands of km away)
  let h = (i | 0) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth gradient noise along a line, about −1..1, a feature every unit of x. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = hash(i, seed) * 2 - 1;
  const g1 = hash(i + 1, seed) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return 2 * ((1 - u) * g0 * f + u * g1 * (f - 1));
}

/** Octaves of noise, each twice as fine and half as tall: about −1..1. */
function fbm(x: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, seed + o * 101) * amp;
    norm += amp;
    x *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Sharp-crested ridges: 0 in the troughs, 1 along the crests. */
function ridges(x: number, seed: number): number {
  const a = 1 - Math.abs(noise(x, seed));
  const b = 1 - Math.abs(noise(x * 2.1, seed + 7));
  return a * a * 0.75 + b * b * 0.25;
}

/** The planet's radius (m: see Atmosphere.radius) and the way round it: go this far and the land repeats. */
export const PLANET_R = 30000;
export const AROUND = 2 * Math.PI * PLANET_R;
/** The last stretch (m) before the land meets its start again, blended into it. */
const SEAM = 3000;

export class TerrainGen {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  /**
   * The ground's height (m) at true x (m). Round the planet it comes back to where it
   * started (0.4.0: one orbit, AROUND m, sees the same land again), the last stretch
   * before the seam easing into what's past it.
   */
  heightAt(x: number): number {
    let w = ((x % AROUND) + AROUND * 1.5) % AROUND - AROUND / 2;
    if (w > AROUND / 2 - SEAM) {
      const t = smoothstep(AROUND / 2 - SEAM, AROUND / 2, w);
      return this.rawHeight(w) * (1 - t) + this.rawHeight(w - AROUND) * t;
    }
    if (w < -AROUND / 2) w += AROUND;
    return this.rawHeight(w);
  }

  /** The ground's height at x along the land as it's made, before it goes round. */
  private rawHeight(x: number): number {
    // (how far past the flat start, or the airfield east of it)
    const a = x < 0 ? -x : x > AIRFIELD ? x - AIRFIELD + FLAT : Math.min(x, FLAT);
    if (a <= FLAT) return 0;
    const s = this.seed;
    // what kind of land it is, changing every few kilometres: plains, hills, mountains
    const region = noise(x / 2600, s + 1);
    const hilly = smoothstep(-0.45, 0.2, region);
    const high = smoothstep(0.15, 0.6, region);
    let h = fbm(x / 420, s + 2, 4) * (8 + 40 * hilly);
    h += ridges(x / 1100, s + 3) * 320 * high;
    h += noise(x / 70, s + 4) * (0.6 + 2.5 * hilly);
    // mesas: flat tops stepping up and down at cliffs, where the land is that way
    const mesa = smoothstep(0.2, 0.42, noise(x / 1900, s + 5)) * (1 - high);
    if (mesa > 0) {
      const step = 16;
      const t = h / step;
      const k = Math.floor(t);
      const stepped = (k + smoothstep(0.84, 1, t - k)) * step;
      h += (stepped - h) * mesa;
    }
    // valleys cut down into it here and there
    const v = noise(x / 760, s + 6);
    if (v < -0.4) h -= 55 * smoothstep(-0.4, -0.8, v);
    // (and from the flat start, the land rises into its shape)
    return a < FLAT + EASE ? h * smoothstep(FLAT, FLAT + EASE, a) : h;
  }

  /** Is the ground at true x bare rock (steep, or high on a mountain)? */
  rockAt(x: number, h = this.heightAt(x)): boolean {
    if (h > ROCK_HEIGHT) return true;
    const slope = Math.abs(this.heightAt(x + SAMPLE) - this.heightAt(x - SAMPLE)) / (2 * SAMPLE);
    return slope > ROCK_SLOPE;
  }
}

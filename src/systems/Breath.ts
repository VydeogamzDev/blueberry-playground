import { clamp, wrapAngle, type V2 } from '../engine/math';
import { PK } from './Particles';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** The surface laps this far (m) over it: the mouth any nearer it than that is under water. */
const LAPS = 0.03;
/** Treading water, they keep their mouth this far (m) over the surface. */
const ABOVE = 0.1;
/** Out of the water, how long (s) a full breath takes to get back, and their strength for swimming. */
const REFILL = 4;
const REST = 20;
/** Short of this much air, they gasp coming up, and their senses go (see faint()). */
const GASP = 0.6;
const FAINT = 0.3;
/**
 * How far (m) either side of the mouth the particle water's surface is looked for (see
 * Fluid.levelNear()), and how far over it; not right over the head (what's lying on it).
 */
const NEAR = 0.45;
const NEAR_UP = 1.5;
const NEAR_SKIP = 0.16;
/** Their middle this near (m) the surface, or under it, they're in the water (not standing in it, or lying on the bottom). */
const DEEP = 0.25;
/** Water this deep (m) or shallower under them, they touch the bottom: they wade along it, and don't tire. */
const WADE = 1.3;
/** A head's buoyancy (see Part.buoyancy): heavier than water, the bone in it, so it goes under unless held up. */
export const HEAD_SINKS = 0.45;
/** A bubble's rise (m/s²). */
const BUBBLE_RISE = 4;

/** How long someone can go under. */
export interface Lungful {
  /** How long (s) a breath held lasts them, awake; and out cold (breathing the water in). */
  hold: number;
  holdOut: number;
  /** How long (s) after it runs out they die. */
  last: number;
  /** How long (s) they can keep themselves up, treading water. */
  tread: number;
  /** Their chest's buoyancy (see Part.buoyancy) full of air, and emptied of it. */
  full: number;
  empty: number;
}

/** The surface of the water over (x, y): the sea's there, or a body of water's round it (null: none). */
export function waterOver(game: Game, x: number, y: number): number | null {
  const sea = game.water.levelAt(x);
  const pool = game.fluid.levelNear(x, y, NEAR, NEAR_UP, NEAR_SKIP);
  return sea === null ? pool : pool === null ? sea : Math.max(sea, pool);
}

/**
 * A creature's breath, in water: with its mouth under, a held breath runs out
 * (quickly out cold, breathing the water in) and soon after it, it drowns; up
 * again it gasps for air and gets it back. Awake in water over its chest, it
 * treads water (see tread()), and tires.
 */
export class Breath {
  /** How much air they have (1: a full breath). */
  air = 1;
  /** How long (s) they've been without any. */
  starved = 0;
  /** How much of their strength for keeping afloat is spent (1: all of it). */
  spent = 0;
  /** The water's surface where they are, as of the last step (null: out of it). */
  level: number | null = null;
  /** Their mouth under it; and it up to their middle (in it, not standing in it). */
  under = false;
  deep = false;
  /** How deep the water is under their middle (m: to the ground, not what's sunk in it). */
  depth = 0;
  private bubbleT = 0;
  private bubbleSoundT = 0;
  /** The least air they had, under (they gasp coming up short of breath). */
  private least = 1;

  constructor(readonly spec: Lungful) {}

  /** Drowned: out of air long enough to die of it. */
  get drowned(): boolean {
    return this.starved > this.spec.last;
  }

  /** Short of air, as much as they can be awake (1: not at all): see the vitals. */
  get faint(): number {
    return clamp(this.air / FAINT, 0, 1);
  }

  /** In the water, but in their depth: they can touch the bottom. */
  get wading(): boolean {
    return this.deep && this.depth < WADE;
  }

  /** As much strength for keeping afloat as they've left (1: fresh; 0: spent; wading, they rest on the bottom). */
  get effort(): number {
    return this.wading ? 1 : clamp((1 - this.spent) * 1.6, 0, 1);
  }

  /** The buoyancy of their chest, for the air in it. */
  get buoyancy(): number {
    return this.spec.empty + (this.spec.full - this.spec.empty) * this.air;
  }

  /**
   * A step: where their mouth and middle are (the lower of the trunk, so lying
   * half out of the water they're still in it); awake, they hold their breath;
   * treading, they tire. Returns whether they've just come up gasping.
   */
  step(game: Game, dt: number, mouth: V2, middle: V2, awake: boolean, treading: boolean): boolean {
    const level = (this.level = waterOver(game, mouth.x, mouth.y));
    this.under = level !== null && level + LAPS > mouth.y;
    this.deep = level !== null && level > middle.y - DEEP;
    this.depth = level === null ? 0 : level - game.env.groundAt(middle.x, middle.y);
    let gasp = false;
    if (this.under) {
      this.air = Math.max(0, this.air - dt / (awake ? this.spec.hold : this.spec.holdOut));
      this.least = Math.min(this.least, this.air);
      if (this.air <= 0) this.starved += dt;
      this.bubbles(game, dt, mouth, level!, awake);
    } else {
      gasp = this.least < GASP;
      this.least = 1;
      this.air = Math.min(1, this.air + dt / REFILL);
      this.starved = Math.max(0, this.starved - dt * 2);
    }
    if (treading && !this.wading) this.spent = Math.min(1, this.spent + dt / this.spec.tread);
    else if (!this.deep || this.wading) this.spent = Math.max(0, this.spent - dt / REST);
    return gasp;
  }

  /** Back to a full breath, and fresh (healed). */
  reset(): void {
    this.air = 1;
    this.starved = this.spent = 0;
    this.least = 1;
  }

  /** Air let out of the mouth, rising: a few now and then held in, a stream breathing the water in. */
  private bubbles(game: Game, dt: number, at: V2, level: number, awake: boolean): void {
    this.bubbleT -= dt;
    this.bubbleSoundT -= dt;
    if (this.bubbleT > 0 || this.air <= 0) return;
    this.bubbleT = awake ? 0.5 + Math.random() * 1.2 : 0.08 + Math.random() * 0.15;
    if (this.bubbleSoundT <= 0) {
      this.bubbleSoundT = 0.5 + Math.random() * 0.3;
      game.sound.play('liquid/bubbles', { gain: awake ? 0.25 : 0.4, x: at.x, vary: 0.15 });
    }
    const depth = level - at.y;
    // (gone at the surface)
    const life = Math.sqrt((2 * depth) / BUBBLE_RISE) + 0.05;
    const n = awake ? 1 + Math.floor(Math.random() * 3) : 2;
    for (let i = 0; i < n; i++) {
      game.particles.emit(PK.Dust, at.x + (Math.random() - 0.5) * 0.06, at.y + i * 0.03, {
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.2,
        life,
        gravity: -BUBBLE_RISE / 9.81,
        drag: 2,
        size: (1 + Math.floor(Math.random() * 2)) / 32,
        color: 0xd6ecfa,
        alpha: 0.85,
        alpha1: 0.5,
      });
    }
  }
}

/**
 * Treading water: `head` and `chest` lifted (by as much as `effort` of what it
 * takes) to keep the mouth just over the surface, the chest held upright, and
 * the whole body (`parts`) paddled along at `swim` m/s (+ right): all of it at
 * once, so it isn't dragged over flat by the chest.
 */
export function tread(game: Game, head: Part, chest: Part, parts: readonly Part[], mouthY: number, level: number, effort: number, swim: number, dt: number): void {
  if (effort <= 0) return;
  const g = -game.gravity;
  const m = head.mass + chest.mass;
  const vy = (head.vy * head.mass + chest.vy * chest.mass) / m;
  const lift = clamp((level + ABOVE - mouthY) * 120 - vy * 12, 0, g * 2) * effort;
  if (lift > 0) for (const p of [head, chest]) p.body.applyImpulse({ x: 0, y: lift * p.mass * dt }, true);
  const b = chest.body;
  b.applyTorqueImpulse((-wrapAngle(chest.a) * 10 - chest.av * 3) * b.principalInertia() * effort * dt, true);
  if (!swim) return;
  let mass = 0;
  let mv = 0;
  for (const p of parts) {
    if (p.destroyed || p.frozen) continue;
    mass += p.mass;
    mv += p.mass * p.vx;
  }
  if (mass <= 0) return;
  const a = clamp((swim - mv / mass) * 6, -6, 6) * effort;
  for (const p of parts) if (!p.destroyed && !p.frozen) p.body.applyImpulse({ x: a * p.mass * dt, y: 0 }, true);
}

/**
 * Which way to swim for the shore from x (+1 right, -1 left; 0 none): the sea's
 * nearer edge with land at it (not the edge of the map). Out of the sea, none.
 */
export function shoreward(game: Game, x: number): number {
  const w = game.map.water;
  if (!w || x < w.x0 || x > w.x1) return 0;
  const edge = game.map.width / 2 - 1;
  const left = w.x0 > -edge ? x - w.x0 : Infinity;
  const right = w.x1 < edge ? w.x1 - x : Infinity;
  return left === Infinity && right === Infinity ? 0 : left < right ? -1 : 1;
}

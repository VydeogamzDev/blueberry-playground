import { PX } from '../engine/constants';
import { rotate, smoothstep, type V2 } from '../engine/math';
import { PixelArt, CLEAR } from '../art/PixelArt';
import { getItem } from '../catalog/items';
import { goreConfig, type Gore, type GoreKind } from '../entities/Gore';
import { sparkle, DRUG_GLOW } from '../entities/Medical';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/**
 * Growing back what a body has lost (the Regen drug: see Human and Creature).
 * Bit by bit, from the middle of the body outward, it mends one thing at a
 * time: a chunk shot out of a limb fills in, a broken bone knits, and a limb
 * missing from one still on the body grows back where it hung. What's left of
 * the old limb (cut off and lying about) is cast off as pieces of flesh of their
 * own (see entities/Gore); the new one takes its place in the body (its part in
 * the same place in the body's list: saves, undo and copies go by place) on a
 * new joint, and is drawn growing out of the stump, pale at first (see Growth).
 */

/**
 * Regen: seconds between one thing mended and the next (a limb grown back, a bone
 * knit, a chunk filled in), and how soon to look again with nothing to mend; how
 * long a limb takes to grow out; and what heals all the while, a second: blood (%),
 * pain and shock, a share of each limb's hit points and scorching, how fast its
 * wounds close (1/s, gone below `shut`), and every `wash` s the blood washes off
 * a share `washShare` of what's painted on it.
 */
export const REGEN = { every: 1.8, idle: 0.3, grow: 1.2, blood: 4, calm: 0.12, flesh: 0.08, close: 0.8, shut: 0.01, wash: 0.3, washShare: 0.12 };

/** What regrowing needs of a limb (a person's and an animal's both fit). */
export interface RegrowLimb {
  spec: { key: string };
  part: Part;
  joint: unknown;
  parent: RegrowLimb | null;
  children: RegrowLimb[];
  /** Its joint's anchors: on the parent's body, and on its own (local m). */
  a1: V2;
  a2: V2;
  severed: boolean;
  gone: boolean;
  broken: boolean;
  /** Joined to the body through intact joints. */
  attached: boolean;
  wounds: { ix: number; iy: number; rate: number }[];
}

/** What to mend next: a limb missing to grow back, a broken bone to knit, a limb with chunks shot out of it to fill in. */
export interface Mend<L> {
  limb: L;
  what: 'regrow' | 'knit' | 'fill';
}

/**
 * The next thing to mend, nearest the middle of the body first (`order` lists
 * parents before their children): a limb on the body with chunks shot out of
 * it or a broken bone, or one missing (blown off, cut off) from one on the body.
 * Never the head: without it they're dead.
 */
export function nextMend<L extends RegrowLimb>(order: readonly L[]): Mend<L> | null {
  for (const l of order) {
    if (!l.gone && l.attached) {
      if (l.part.holeCount > 0) return { limb: l, what: 'fill' };
      if (l.broken && l.parent) return { limb: l, what: 'knit' };
      continue;
    }
    if (!l.parent || l.spec.key === 'head' || l.parent.gone || !l.parent.attached) continue;
    return { limb: l, what: 'regrow' };
  }
  return null;
}

/**
 * What's left of a cut-off limb, and whatever still hangs from it, cast off the
 * body as it grows back: each of its parts a piece of flesh of its own (see
 * Gore) where it was, moving as it moved, hanging from the piece it hung from.
 * The parts are taken out of the body (their limbs are left gone, to grow back
 * in turn). The pieces made.
 */
export function castOff<L extends RegrowLimb>(e: Entity, l: L, kind: GoreKind): Gore[] {
  const chain: RegrowLimb[] = [];
  const take = (x: RegrowLimb) => {
    if (x.gone || x.part.destroyed) return;
    chain.push(x);
    for (const c of x.children) if (!c.severed && c.joint) take(c);
  };
  take(l);
  const def = getItem('gore');
  const made = new Map<RegrowLimb, Gore>();
  for (const x of chain) {
    const p = x.part;
    const art = new PixelArt(p.w, p.h);
    let n = 0;
    for (let y = 0; y < p.h; y++) {
      for (let i = 0; i < p.w; i++) {
        if (!p.solidAt(i, y)) continue;
        art.set(i, y, p.colorAt(i, y));
        n++;
      }
    }
    if (!def || !n) continue;
    // (the middle of its picture, as Part.pixelToLocal() has it)
    const at = p.localToWorld(p.spriteOffset.x * p.flip * PX, p.spriteOffset.y * PX);
    const g = e.game.spawn(def, at.x, at.y, { angle: p.bodyAngle, flip: p.flip === -1, config: goreConfig(art, kind) }) as Gore | null;
    if (!g) continue;
    const v = p.velocityAt(at.x, at.y);
    g.setVelocity(v.x, v.y, p.body.angvel());
    if (p.frozen) g.setFrozen(true);
    made.set(x, g);
  }
  for (const x of chain) {
    const up = x.parent ? made.get(x.parent) : undefined;
    const g = made.get(x);
    if (x !== l && up && g) up.hold(g.main, x.part.localToWorld(x.a2.x, x.a2.y));
  }
  for (const x of chain.reverse()) e.removePart(x.part);
  return [...made.values()];
}

/**
 * Pieces just cast off (see castOff()) don't push against what of the body they
 * lie on (a torn limb hung against it, and the new one grows where it hung):
 * they'd fly apart.
 */
export function keepApart(pieces: Gore[], e: Entity): void {
  const phys = e.game.physics;
  for (const g of pieces) {
    if (g.destroyed) continue;
    const q = g.main;
    // (found first, kept apart after: Rapier can't change a collider in the middle of a query)
    const under = new Set<Part>();
    phys.world.intersectionsWithShape({ x: q.x, y: q.y }, q.a, g.hullShape(), (hit) => {
      const o = phys.partOf(hit);
      if (o && o.entity === e && !o.destroyed) under.add(o);
      return true;
    });
    for (const o of under) {
      q.noCollideWith(o);
      o.noCollideWith(q);
    }
  }
}

/** Where a limb grows back: hanging from its parent at their joint, straight on from it (as they stand). Its middle, and its angle. */
export function placeOf(l: RegrowLimb): { x: number; y: number; a: number } {
  const p = l.parent!.part;
  const a = p.bodyAngle;
  const j = p.localToWorld(l.a1.x, l.a1.y);
  const o = rotate(l.a2.x, l.a2.y, a);
  return { x: j.x - o.x, y: j.y - o.y, a };
}

/** Puts a part just made (the last in the body's list) in the place of the one it replaces: saves, undo and copies go by place. */
export function swapIn(e: Entity, old: Part, part: Part): void {
  const i = e.parts.indexOf(old);
  if (i < 0 || e.parts[e.parts.length - 1] !== part) return;
  e.parts.pop();
  e.parts[i] = part;
}

/** A new limb takes after the body it grows on: pinned in place, weightless, or passing through things, as that is. */
export function likeBody(part: Part, body: Part): void {
  if (body.frozen) part.setFrozen(true);
  if (body.weightless) part.setWeightless(true);
  if (body.noCollideAll) {
    part.setNoCollideAll(true);
    part.refreshTint();
  }
}

/**
 * The raw end left on `p` where a limb came off (see Human.stump()) healed over
 * as the limb grows back on it: its wound there closed, its skin round the joint
 * (at `at`, local m) as it was.
 */
export function closeStump(p: Part, at: V2, wounds: { ix: number; iy: number }[]): void {
  const w = p.localToWorld(at.x, at.y);
  const { ix, iy } = p.worldToPixel(w.x, w.y);
  for (let j = -2; j <= 2; j++) {
    for (let i = -3; i <= 3; i++) {
      const c = p.art.get(ix + i, iy + j);
      if (c !== CLEAR) p.paintPixel(ix + i, iy + j, c);
    }
  }
  for (let k = wounds.length - 1; k >= 0; k--) if (Math.hypot(wounds[k].ix - ix, wounds[k].iy - iy) < 4.5) wounds.splice(k, 1);
}

/** A limb starting to grow back at `at` (world), or a bone knitting: a puff of the drug's sparkles and a soft wet sound. */
export function sprout(game: Game, at: V2, big: boolean): void {
  sparkle(game, at.x, at.y, DRUG_GLOW.regen, big ? 14 : 6, PX * (big ? 5 : 3));
  if (big) game.sound.squish(0.3, at.x, 0.6);
}

// ------------------------------------------------------------------ growing out

/** A limb growing back: its part as it grew, where its picture's middle was, and when it began (game time). */
interface Grower {
  limb: RegrowLimb;
  part: Part;
  offset: V2;
  t0: number;
  scene: number;
}

/**
 * Limbs growing back, drawn growing out of their stumps: small and pale at first,
 * full size and colour REGEN.grow s later. Only the drawing grows (the limb is all
 * there from the start): as each frame is drawn its sprite is shrunk toward its
 * joint (moved in by its sprite offset), and before each step it's put back as it
 * is, so what's painted on it and where it's hit come out right.
 */
export class Growth {
  private game: Game;
  private list: Grower[] = [];

  constructor(game: Game) {
    this.game = game;
    game.preStepHandlers.push(() => this.step());
    game.frameHandlers.push(() => this.frame());
  }

  /** Starts `l` (its part just made) growing out of its stump. */
  add(l: RegrowLimb): void {
    const p = l.part;
    this.list.push({ limb: l, part: p, offset: { ...p.spriteOffset }, t0: this.game.time, scene: this.game.sceneVersion });
  }

  /** Is this part still growing out? */
  growing(p: Part): boolean {
    return this.list.some((g) => g.part === p);
  }

  /** How far a limb has grown (0..1), going by how long it's been at it. */
  private grown(g: Grower): number {
    return smoothstep(0, 1, (this.game.time - g.t0) / REGEN.grow);
  }

  /** Before each step: drawn as they are again (and those grown, cut off again or gone, let be). */
  private step(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      const p = g.part;
      if (!p.destroyed) {
        p.spriteOffset = g.offset;
        p.sprite.w = (p.w + 2) * PX * p.flip;
        p.sprite.h = (p.h + 2) * PX;
      }
      if (p.destroyed || p.detached || g.limb.part !== p || g.scene !== this.game.sceneVersion || this.grown(g) >= 1) this.list.splice(i, 1);
    }
  }

  /** Each frame: drawn as far as each has grown, scaled about its joint, pale at first. */
  private frame(): void {
    for (const g of this.list) {
      const p = g.part;
      if (p.destroyed) continue;
      const k = this.grown(g);
      const s = 0.2 + 0.8 * k;
      const f = p.flip;
      // (its picture's middle drawn in toward the joint as it's shrunk about it: see Part.render())
      const from = g.limb.a2;
      const cx = g.offset.x * PX * f;
      const cy = g.offset.y * PX;
      p.spriteOffset = { x: (from.x + s * (cx - from.x)) / (PX * f), y: (from.y + s * (cy - from.y)) / PX };
      p.sprite.w = (p.w + 2) * PX * f * s;
      p.sprite.h = (p.h + 2) * PX * s;
      p.flash = Math.max(p.flash, 0.8 * (1 - k));
    }
  }
}

const growthOf = new WeakMap<Game, Growth>();

/** The game's limbs growing back (made the first time one does). */
export function growth(game: Game): Growth {
  let g = growthOf.get(game);
  if (!g) growthOf.set(game, (g = new Growth(game)));
  return g;
}

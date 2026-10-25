import { PX, WORLD } from '../engine/constants';
import { rotate } from '../engine/math';
import { fromRgb, type Color } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';

/** Liquid kinds carried by droplets (blood keeps its own on/off setting). */
export const enum Liquid {
  Blood = 0,
  Water = 1,
  Acid = 2,
  Oil = 3,
  /** A gorse's blood, which it spits (see Creature): it eats through flesh. No puddles of it, nor bucketfuls. */
  GorseBlood = 4,
}

export type LiquidName = 'water' | 'acid' | 'oil';

export const LIQUID_IDS: Record<LiquidName, Liquid> = { water: Liquid.Water, acid: Liquid.Acid, oil: Liquid.Oil };

/** Droplet shades per liquid (a few so streams don't look flat). */
export const LIQUID_COLORS: Record<number, number[]> = {
  [Liquid.Blood]: [0x7d0d0d, 0x941616, 0x660909],
  [Liquid.Water]: [0x3f7fc8, 0x5a96d6, 0x356fb0],
  [Liquid.Acid]: [0x86d633, 0x9fe84a, 0x6cb827],
  [Liquid.Oil]: [0x2b2620, 0x3a332a, 0x221e1a],
  [Liquid.GorseBlood]: [0xc9a227, 0xe0b83a, 0xa88518],
};

/** Corroded flesh/material left by acid. */
export const ACID_SCAR = 0x4d5a1f;
/** Flesh eaten raw by a gorse's blood. */
const GORSE_BURN = 0x7a2e1a;
/** Blood on a body: fresh, and the dark middle of a wound. */
const BLOOD = 0x7d0e0e;
const BLOOD_DARK = 0x5a0808;

/** Something that holds liquid poured into it (a bucket). */
export interface LiquidCatcher {
  /** A drop (`amount` drops: a particle of water, see Fluid) hit `part` at (x, y): returns whether it went in (and is used up there). */
  catchDrop(liquid: Liquid, part: Part, x: number, y: number, amount?: number): boolean;
}

/** A drop of water this near (m) water that flows joins it (else, on the floor, it pools up). */
const FLOWS_NEAR = 0.3;

const lastSound = new Map<string, number>();

/** Plays a liquid sound at most every `gap` seconds of game time (streams land many drops a second). */
export function liquidSound(game: Game, key: string, x: number, gain: number, gap: number): void {
  const t = lastSound.get(key) ?? -Infinity;
  if (game.time - t < gap && game.time >= t) return;
  lastSound.set(key, game.time);
  game.sound.play(key, { gain, x, vary: 0.12 });
}

/**
 * A droplet hit something: blood stains (splattered the faster it came, and the
 * way it came: see splat()), water puts out fires and washes off oil, acid eats
 * into whatever it lands on, oil soaks in and makes things burn. (vx, vy): how it
 * flew; `big`, a bigger drop. Returns whether it was caught (in a bucket): then
 * it's used up there.
 */
export function landDroplet(game: Game, liquid: Liquid, part: Part | null, x: number, y: number, nx: number, ny: number, r: number, g: number, b: number, vx = 0, vy = 0, big = false): boolean {
  // (a gorse's blood isn't caught in buckets, nor pools: it stains, as blood does)
  const gorse = liquid === Liquid.GorseBlood;
  if (part && !gorse && (part.entity as Entity & Partial<LiquidCatcher>).catchDrop?.(liquid, part, x, y)) return true;
  const ix = x - nx * PX * 0.5;
  const iy = y - ny * PX * 0.5;
  // drops landing on the floor pool up (on a map's ground they stain it, as on a wall);
  // water poured on something, or into water, is water that flows (see Fluid)
  const floor = !part && ny > 0.7 && y < WORLD.floor + PX * 6 && game.puddles.open(x);
  const flows = liquid === Liquid.Water && (!!part || game.fluid.near(x, y, FLOWS_NEAR));
  if (floor && liquid !== Liquid.Blood && !gorse && !flows) {
    game.puddles.add(liquid, x);
    liquidSound(game, 'liquid/drip', x, 0.18, 0.09);
  }
  switch (liquid) {
    case Liquid.Blood:
      if (part) splat(part, x, y, nx, ny, fromRgb(r * 255 * 0.85, g * 255 * 0.85, b * 255 * 0.85), vx, vy, big);
      else splatStain(game, ix, iy, nx, ny, r, g, b, vx, vy, big);
      return false;
    case Liquid.Water:
      if (part) {
        if (part.burning > 0) {
          // a flask's worth (~270 drops) puts out a few burning things, not a whole bonfire
          if (Math.random() < 0.3) game.particles.smoke(x, y + 0.05, 1, 0.12);
          liquidSound(game, 'liquid/steam', x, 0.35, 0.3);
        }
        game.fire.douse(part, 0.02);
        game.fire.splash(part, x, y);
        part.oil = Math.max(0, part.oil - 0.04);
      }
      if (flows) {
        game.fluid.fromDrop(x + nx * PX, y + ny * PX, vx, vy);
        return true;
      }
      if (!floor && Math.random() < 0.25) floorStain(game, ix, iy, ny, r * 0.5, g * 0.5, b * 0.6, 0.22);
      return false;
    case Liquid.Acid:
      if (part) {
        part.entity.damage(part, 0.9, 'acid', { x, y }, { x: -nx, y: -ny });
        if (!part.destroyed) part.paintAt(ix, iy, ACID_SCAR, 0, 0.7);
      } else floorStain(game, ix, iy, ny, 0.3, 0.38, 0.12, floor ? 0.4 : 0.8);
      if (Math.random() < 0.25) game.particles.smoke(x, y + 0.03, 1, 0.08);
      liquidSound(game, 'liquid/sizzle', x, part ? 0.35 : 0.2, 0.25);
      return false;
    case Liquid.Oil:
      if (part) {
        part.oil = Math.min(1, part.oil + 0.06);
        part.paintAt(ix, iy, 0x1d1a16, 0, 0.6);
        // oil on something already burning feeds the fire
        if (part.burning > 0.1) game.fire.ignite(part, Math.min(1, part.burning + 0.1));
      } else if (!floor) floorStain(game, ix, iy, ny, r, g, b, 0.85);
      return false;
    case Liquid.GorseBlood:
      // eats into flesh where it lands (worse than acid; a gorse is proof against it:
      // see Creature.damage()); anything else it only stains
      if (part) {
        if (part.mat.bleeds) {
          part.entity.damage(part, 1.6, 'acid', { x, y }, { x: -nx, y: -ny });
          if (!part.destroyed) part.paintAt(ix, iy, GORSE_BURN, 0, 0.8);
          if (Math.random() < 0.3) game.particles.smoke(x, y + 0.03, 1, 0.08);
          liquidSound(game, 'liquid/sizzle', x, 0.35, 0.25);
        } else if (!part.destroyed) part.paintAt(ix, iy, fromRgb(r * 255 * 0.8, g * 255 * 0.8, b * 255 * 0.8), 0, 0.6);
      } else floorStain(game, ix, iy, ny, r, g, b, 0.9);
      return false;
  }
  return false;
}

// ---- blood on bodies

/** How far a drop of blood streaks (px) for its speed (m/s), past `from`, a pixel for every `per`; at most `max`. */
const STREAK = { from: 2.5, per: 2.2, max: 4 };

/**
 * A drop of blood hitting a body stains the side of it we see: a little way in
 * from where it struck the outline, a bigger drop a blot, and a fast one streaks
 * on the way it flew (spatter from a shot is a spray of streaks, all one way).
 * Some of it runs down.
 */
function splat(p: Part, x: number, y: number, nx: number, ny: number, color: Color, vx = 0, vy = 0, big = false): void {
  const d = PX * (0.5 + Math.random() * 3);
  const s = (Math.random() - 0.5) * PX * 2;
  const wx = x - nx * d - ny * s;
  const wy = y - ny * d + nx * s;
  if (!p.paintAt(wx, wy, color, 0, 0.85)) return;
  const speed = Math.hypot(vx, vy);
  if (big) p.paintAt(wx + (Math.random() < 0.5 ? PX : -PX), wy + (Math.random() < 0.5 ? PX : -PX), color, 0, 0.7);
  const n = Math.min(STREAK.max, Math.floor((speed - STREAK.from) / STREAK.per) + 1);
  for (let k = 1; k <= n; k++) {
    const jx = (Math.random() - 0.5) * PX * 0.6;
    const jy = (Math.random() - 0.5) * PX * 0.6;
    if (!p.paintAt(wx + (vx / speed) * PX * k + jx, wy + (vy / speed) * PX * k + jy, color, 0, 0.75 - k * 0.12)) break;
  }
  if (Math.random() > 0.3) return;
  const { ix, iy } = p.worldToPixel(wx, wy);
  let at = { x: ix, y: iy };
  for (let n = 1 + Math.floor(Math.random() * 3); n > 0; n--) {
    const next = downhill(p, at.x, at.y);
    if (!next) break;
    at = next;
    p.paintPixel(at.x, at.y, color, 0.6);
  }
}

/** World down in a part's art space (art rows run down, and a mirrored sprite's columns the other way). */
function down(p: Part): { x: number; y: number } {
  const d = rotate(0, -1, -p.bodyAngle);
  return { x: d.x * p.flip, y: -d.y };
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** The next sprite pixel down from (x, y) the way gravity pulls now, wandering a little; null at the bottom edge. */
function downhill(p: Part, x: number, y: number): { x: number; y: number } | null {
  const d = down(p);
  const bx = Math.round(d.x);
  const by = Math.round(d.y);
  // now and then a pixel aside (across the way down)
  const r = Math.random();
  const side = r < 0.15 ? 1 : r < 0.3 ? -1 : 0;
  const sx = clamp1(bx - Math.round(d.y) * side);
  const sy = clamp1(by + Math.round(d.x) * side);
  if (p.solidAt(x + sx, y + sy)) return { x: x + sx, y: y + sy };
  return p.solidAt(x + bx, y + by) ? { x: x + bx, y: y + by } : null;
}

/**
 * Where a wound struck at (wx, wy) shows on a body's sprite: a pixel or two in
 * from the outline along (inX, inY) (into the body), so it reads as a wound in
 * the side we see rather than a nick in the edge. Always a solid pixel when
 * there's one near.
 */
export function woundSpot(p: Part, wx: number, wy: number, inX: number, inY: number): { x: number; y: number } {
  const l = Math.hypot(inX, inY);
  const d = l > 1e-6 ? (PX * (1 + Math.random() * 1.5)) / l : 0;
  // (a knock's direction may be given either way round: the side that's inside it)
  for (const s of [1, -1]) {
    const a = p.worldToPixel(wx + inX * d * s, wy + inY * d * s);
    if (d > 0 && p.solidAt(a.ix, a.iy)) return { x: a.ix, y: a.iy };
  }
  const b = p.worldToPixel(wx, wy);
  let best = 1e9;
  let out = { x: b.ix, y: b.iy };
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      if (p.solidAt(b.ix + i, b.iy + j) && i * i + j * j < best) {
        best = i * i + j * j;
        out = { x: b.ix + i, y: b.iy + j };
      }
    }
  }
  return out;
}

/** A wound's mark: a dark hole (or a darker blot) with wet blood round it, wider the worse it bleeds. */
export function paintWound(p: Part, x: number, y: number, rate: number, hole: boolean): void {
  const r = Math.min(2.4, 0.9 + rate * 0.6);
  const R = Math.ceil(r);
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const d = Math.hypot(i, j);
      if (d > r) continue;
      if (d < 0.5) p.paintPixel(x, y, hole ? 0x2a0505 : BLOOD_DARK);
      else p.paintPixel(x + i, y + j, d <= 1 ? 0x8a1212 : BLOOD, d <= 1 ? 0.8 : 0.55);
    }
  }
}

/** A trickle of blood running from a wound (see seep()). */
interface Trickle {
  x: number;
  y: number;
  /** Pixels to go (fractional), its length so far, and how many have run. */
  t: number;
  len: number;
  runs: number;
}

const trickles = new WeakMap<object, Trickle>();

/**
 * Blood seeping from a wound runs down the body: a trickle grows from it a
 * pixel at a time the way gravity pulls now, faster and further the worse it
 * bleeds; once it has run its course another starts beside it, so a bad wound
 * leaves a wide streak. Call each step the wound bleeds (`w`: the wound, its
 * sprite pixel and bleeding rate).
 */
export function seep(p: Part, w: { ix: number; iy: number; rate: number }, dt: number): void {
  let r = trickles.get(w);
  if (!r) trickles.set(w, (r = { x: w.ix, y: w.iy, t: 0, len: 0, runs: 0 }));
  r.t += dt * (1.5 + w.rate * 6);
  if (r.t < 1) return;
  r.t -= 1;
  const max = 3 + w.rate * 14;
  if (r.len >= max) {
    if (r.runs >= 1 + w.rate * 5) return;
    // the next one starts beside the wound, to one side or the other of the last
    r.runs++;
    r.len = 0;
    const d = down(p);
    const off = (r.runs % 2 ? 1 : -1) * Math.min(2, Math.ceil(r.runs / 2));
    r.x = w.ix - Math.round(d.y) * off;
    r.y = w.iy + Math.round(d.x) * off;
    if (!p.solidAt(r.x, r.y)) {
      r.x = w.ix;
      r.y = w.iy;
    }
  }
  const next = downhill(p, r.x, r.y);
  if (!next) {
    // run off the bottom edge: it drips from there
    r.len = max;
    return;
  }
  r.x = next.x;
  r.y = next.y;
  r.len++;
  p.paintPixel(r.x, r.y, BLOOD, Math.min(0.85, 0.5 + w.rate * 0.25));
}

/**
 * A drop of blood on the floor or a wall (the map's own): a stain where it hit, a
 * bigger drop's a blot; a fast one streaks along the surface the way it was going
 * (and flecks beyond), and on a wall some runs down.
 */
function splatStain(game: Game, x: number, y: number, nx: number, ny: number, r: number, g: number, b: number, vx: number, vy: number, big: boolean): void {
  floorStain(game, x, y, ny, r, g, b, 0.95);
  // along the surface, the way it was going
  let tx = -ny;
  let ty = nx;
  const along = vx * tx + vy * ty;
  if (along < 0) {
    tx = -tx;
    ty = -ty;
  }
  if (big) game.stains.add(x - tx * PX, y - ty * PX, r * 0.75, g * 0.75, b * 0.75, 0.9);
  const n = Math.min(STREAK.max + 1, Math.floor((Math.abs(along) - STREAK.from) / STREAK.per) + 1);
  for (let k = 1; k <= n; k++) game.stains.add(x + tx * PX * k, y + ty * PX * k, r * 0.78, g * 0.78, b * 0.78, 0.85 - k * 0.1);
  if (n > 1 && Math.random() < 0.5) {
    const k = n + 1 + Math.floor(Math.random() * 3);
    game.stains.add(x + tx * PX * k, y + ty * PX * k, r * 0.8, g * 0.8, b * 0.8, 0.8);
  }
  // on a wall, some runs down it
  if (Math.abs(ny) < 0.5 && Math.random() < 0.45) {
    for (let k = 1 + Math.floor(Math.random() * 3); k > 0; k--) game.stains.add(x, y - PX * k, r * 0.7, g * 0.7, b * 0.7, 0.7);
  }
}

function floorStain(game: Game, x: number, y: number, ny: number, r: number, g: number, b: number, a: number): void {
  game.stains.add(x, y, r * 0.8, g * 0.8, b * 0.8, a);
  // occasional spread into a small puddle on the floor
  if (ny > 0.7 && Math.random() < 0.35) game.stains.add(x + (Math.random() < 0.5 ? -PX : PX), y, r * 0.75, g * 0.75, b * 0.75, a * 0.95);
}

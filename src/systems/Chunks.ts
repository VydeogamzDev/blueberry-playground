import { PX } from '../engine/constants';
import { rotate, type V2 } from '../engine/math';
import { PixelArt, type Color } from '../art/PixelArt';
import { getItem } from '../catalog/items';
import { goreConfig, type Gore } from '../entities/Gore';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/**
 * Chunks shot out of a body. A heavy round (a rifle's, a sniper's, a shotgun's
 * pellets together at close range) takes a bite out of the outline where it
 * comes out, and a smaller one where it goes in: the pixels are carved off the
 * limb (see Part.carve()), the torn edge shows raw flesh, and bone where the
 * bone runs, and bits of flesh fly off with the blood. A limb shot clean through
 * breaks there, not at a joint: the smaller side comes off as a piece of its own
 * (see entities/Gore), what hung from it still hanging from it. One mostly shot
 * away, or blown apart, breaks up into pieces (breakUp()). A blade cuts a line
 * into a limb (sliceLimb()), and one cut through comes apart there the same way.
 * The trunk only loses chunks, and takes gashes.
 */

/** What a chunk needs of a limb (a person's or an animal's). */
export interface ChunkLimb {
  spec: { key: string };
  part: Part;
  joint: unknown;
  parent: ChunkLimb | null;
  children: ChunkLimb[];
  /** Its joint's anchors: on the parent's body, and on its own (local m). */
  a1: V2;
  a2: V2;
  severed: boolean;
  gone: boolean;
  wounds: { ix: number; iy: number; dx: number; dy: number; rate: number; spurt: boolean }[];
}

/** What a chunk does to the body a limb is on. */
export interface ChunkBody<L extends ChunkLimb> {
  readonly game: Game;
  sever(l: L, why: 'blast'): void;
  /** Blows it apart (into pieces: see breakUp()), flung `dir` if given. */
  gib(l: L, dir?: V2): void;
}

/** How a torn body looks: the raw edge (two shades), the bone where it shows, the bits that fly off, and whether it bleeds. */
export interface ChunkLook {
  raw: [Color, Color];
  bone: Color;
  bits: Color[];
  bleeds: boolean;
  /** What a piece torn off it is (see entities/Gore). */
  piece: 'flesh' | 'plating';
}

export const FLESH: ChunkLook = { raw: [0x9c1a1a, 0x6e0c0c], bone: 0xe6dcc8, bits: [0x8e1a1a, 0x6b0e0e, 0xc46b6b, 0xe3d9c4], bleeds: true, piece: 'flesh' };
/** An android's: plating over its frame and wiring. */
export const PLATING: ChunkLook = { raw: [0x3a3f46, 0x2a2e33], bone: 0xb87333, bits: [0x59616b, 0x3a3f46, 0xb87333], bleeds: false, piece: 'plating' };

/**
 * Under `from` J a round takes no chunk (a pistol's, a revolver's, a minigun's,
 * a lone shotgun pellet's only wound); over it the bite's radius (px) grows from
 * `base` by one for every `per` J more, to `max` (a rifle's comes out about 3 px
 * across, a sniper's 8: through a thigh). Rounds into the same spot (within
 * `near` px) within `window` s add up, and the more rounds strike the body at once
 * close together (within `close` m, wherever on it) the harder each spot's hit
 * (`cluster` more for each after the first): a shotgun's pellets at close range
 * tear wounds as one big slug would. A round into a wound already
 * shot through digs in further, but takes less (`dig` of the bite's radius).
 * Mostly (`gib`) shot away, a limb breaks up.
 */
const CHUNK = { from: 1050, base: 1.2, per: 900, max: 4, window: 0.02, near: 4.5, cluster: 0.25, close: 0.12, dig: 0.5, gib: 0.75 };
/** Bites where a round goes in, and where one that stops inside went in, against where one comes out. */
const SIDE = { in: 0.55, stop: 0.8, out: 1 };

/** The kind of bone at a point of a limb (its frame: px from its middle, y up): a long one, a skull or a blade, a block, or a rib or finger ('thin'). */
type BoneAt = (l: ChunkLimb, x: number, y: number) => 'shaft' | 'oval' | 'block' | 'thin' | 'hole' | null;
let boneAt: BoneAt | null = null;

/** How to tell where a limb's bones are: the x-ray's skeletons, given once they're loaded. */
export function knowBones(fn: BoneAt): void {
  boneAt = fn;
}

/** The torn edge's colour at a pixel: bone where a bone runs under the skin (not at the outline: that's flesh), ribs every other pixel, raw flesh round it. */
function rawAt(l: ChunkLimb, x: number, y: number, look: ChunkLook): Color {
  const p = l.part;
  if (!p.art.isRim(x, y) && boneAt) {
    const lc = p.pixelToLocal(x, y);
    const k = boneAt(l, lc.x / PX, lc.y / PX);
    if (k && k !== 'hole' && (k !== 'thin' || (x + y) % 2 === 0)) return look.bone;
  }
  return look.raw[(x + y) & 1];
}

interface Spot {
  t: number;
  x: number;
  y: number;
  /** The rounds' energy all told (J), and as it hit, with the rest striking the body at once (see CHUNK.cluster). */
  e: number;
  hit: number;
  side: keyof typeof SIDE;
}

/** Rounds striking each body just now (a shotgun's pellets): when the last did, and which, where (world). */
const volleys = new WeakMap<object, { t: number; rounds: Map<object, V2> }>();

/** Recent strikes on each part (pixel coordinates), to add up a blast's pellets. */
const spots = new WeakMap<Part, Spot[]>();

/**
 * A blast `frac` times as hard as a limb's hit points, as the energy (J) of a round
 * for the chunk it takes out of the side facing it (a bite, not the limb: a hand by
 * a grenade loses a few pixels): none for a lesser one.
 */
export function blastEnergy(frac: number): number {
  return frac < 0.9 ? 0 : CHUNK.from + Math.min(frac, 3) * 400;
}

/** The bite's radius (px) for this much energy (J) all in one spot. */
const radius = (e: number) => (e < CHUNK.from ? 0 : Math.min(CHUNK.max, CHUNK.base + (e - CHUNK.from) / CHUNK.per));

/**
 * A round of `energy` J striking `l` at `at` (world), flying `dir`: where it went in
 * (`in`), came out (`out`), or went in and stopped (`stop`). Takes the chunk, if
 * the round (with whatever else struck close by just now) was heavy enough.
 * `round`: the round itself, to count it once in a volley (see CHUNK.cluster;
 * a blast's bite, given none, is on its own).
 */
export function takeChunk<L extends ChunkLimb>(body: ChunkBody<L>, l: L, at: V2, dir: V2, energy: number, side: keyof typeof SIDE, look: ChunkLook, round?: object): void {
  const p = l.part;
  if (l.gone || p.destroyed || !(energy > 0)) return;
  const time = body.game.time;
  // (the bite's middle half a pixel outside where it struck: it comes out of the outline)
  const s = side === 'out' ? 1 : -1;
  const c = p.worldToPixelF(at.x + dir.x * s * PX * 0.5, at.y + dir.y * s * PX * 0.5);
  let v = volleys.get(p.entity);
  if (!v || time - v.t > CHUNK.window || v.t > time) volleys.set(p.entity, (v = { t: time, rounds: new Map() }));
  if (round && !v.rounds.has(round)) v.rounds.set(round, at);
  v.t = time;
  let volley = 1;
  if (round) {
    volley = 0;
    for (const q of v.rounds.values()) if (Math.hypot(q.x - at.x, q.y - at.y) < CHUNK.close) volley++;
  }
  let list = spots.get(p);
  if (!list) spots.set(p, (list = []));
  for (let i = list.length - 1; i >= 0; i--) if (time - list[i].t > CHUNK.window || list[i].t > time) list.splice(i, 1);
  let spot = list.find((q) => q.side === side && Math.hypot(q.x - c.x, q.y - c.y) < CHUNK.near);
  const e0 = spot?.hit ?? 0;
  if (spot) {
    const e = spot.e + energy;
    spot.x = (spot.x * spot.e + c.x * energy) / e;
    spot.y = (spot.y * spot.e + c.y * energy) / e;
    spot.e = e;
    spot.t = time;
  } else list.push((spot = { t: time, x: c.x, y: c.y, e: energy, hit: 0, side }));
  spot.hit = spot.e * (1 + CHUNK.cluster * (volley - 1));
  const r = radius(spot.hit) * SIDE[side];
  if (r < 0.5) return;
  // what it takes: its ring's worth of flesh more than the blast's pellets before it
  // took (half a crater for the first: the rest is outside the outline)...
  const r0 = radius(e0) * SIDE[side];
  const shape = craterOf(spot.hit);
  const need = Math.max(1, Math.round(0.35 * Math.PI * shape.deep * shape.wide * (r * r - r0 * r0)));
  // ...dug in further along the way it went where it's already shot away, a smaller
  // bite (the colliders keep the outline, so a second round comes out where the first did)
  const o0 = p.worldToPixelF(at.x, at.y);
  const o1 = p.worldToPixelF(at.x + dir.x * s * PX, at.y + dir.y * s * PX);
  const ul = Math.hypot(o1.x - o0.x, o1.y - o0.y) || 1;
  const ux = (o1.x - o0.x) / ul;
  const uy = (o1.y - o0.y) / ul;
  const dug = shotAway(p, spot.x, spot.y, r + 0.5);
  let px: number[] = [];
  for (let k = 0; k <= p.w + p.h && px.length < need * 2; k++) {
    const got = crater(p, spot.x - ux * k, spot.y - uy * k, k && dug ? r * CHUNK.dig : r, ux, uy, shape);
    if (got.length > px.length) px = got;
  }
  if (!px.length) return;
  const out = { x: dir.x * s, y: dir.y * s };
  tearOff(body, l, px, out, look, true);
  if (l.gone || p.destroyed) return;
  // (the trunk, that everything hangs from, is left to its wounds)
  if (!l.parent) return;
  // mostly shot away: what's left breaks up
  if (p.lost() > CHUNK.gib) {
    body.gib(l, out);
    return;
  }
  splitOff(body, l, look, out);
}

/**
 * A cut into a gash made before goes on from where that one stopped, if it goes
 * in within `near` px of where that one went in, near enough the same way (`turn`:
 * the cosine between them): so slash after slash at a limb hacks through it.
 */
const GASH = { near: 3, turn: 0.75, keep: 6 };

interface Gash {
  /** Where it went in, and the way it goes (pixel coordinates), and how deep (px). */
  x: number;
  y: number;
  ux: number;
  uy: number;
  len: number;
}

/** Each part's gashes, newest last. */
const gashes = new WeakMap<Part, Gash[]>();

/**
 * A blade's cut into `l`: `depth` px in from where its edge struck (`at`, world),
 * the way it was going (`dir`), from where that line meets it (`back` px before
 * `at` at the furthest). A line of it a pixel wide comes away, raw either side
 * (bone where it runs); one cut clean through takes the limb apart there, not at
 * its joint (see splitOff()), and the trunk only takes the gash. A cut into a gash
 * made before deepens it (see GASH). Whether it cut anything.
 */
export function sliceLimb<L extends ChunkLimb>(body: ChunkBody<L>, l: L, at: V2, dir: V2, depth: number, look: ChunkLook, back = 3): boolean {
  const p = l.part;
  if (l.gone || p.destroyed || !(depth > 0)) return false;
  // the way it goes in pixel coordinates (the sprite's y runs down, and may be mirrored)
  const c = p.worldToPixelF(at.x, at.y);
  const c1 = p.worldToPixelF(at.x + dir.x * PX, at.y + dir.y * PX);
  const ul = Math.hypot(c1.x - c.x, c1.y - c.y) || 1;
  const ux = (c1.x - c.x) / ul;
  const uy = (c1.y - c.y) / ul;
  // (in from where it meets the limb along the way it goes: the edge struck a pixel or two off it, or into a gash)
  let x = c.x - ux * back;
  let y = c.y - uy * back;
  for (let k = 0; k < (back + 9) * 2 && !p.solidAt(Math.floor(x), Math.floor(y)); k++) {
    x += ux * 0.5;
    y += uy * 0.5;
  }
  if (!p.solidAt(Math.floor(x), Math.floor(y))) {
    x = c.x;
    y = c.y;
  }
  let list = gashes.get(p);
  if (!list) gashes.set(p, (list = []));
  let g = list.find((q) => Math.hypot(q.x - x, q.y - y) < GASH.near && q.ux * ux + q.uy * uy > GASH.turn);
  if (g) g.len += depth;
  else {
    list.push((g = { x, y, ux, uy, len: depth }));
    if (list.length > GASH.keep) list.shift();
  }
  // (from a pixel and a half outside, so it starts at the outline)
  const px = line(p, g.x - g.ux * 1.5, g.y - g.uy * 1.5, g.x + g.ux * g.len, g.y + g.uy * g.len);
  if (!px.length) return false;
  const rim = rimOf(l, px, look);
  const lost0 = p.lost();
  p.carve(px, rim);
  const g0 = body.game;
  const end = p.pixelToWorld(px[px.length - 2], px[px.length - 1]);
  const n = px.length / 2;
  if (look.bleeds) g0.particles.splatter(end.x, end.y, dir.x, dir.y + 0.15, 4 + n * 2, 3 + n * 0.3, 0.3, p.body);
  else g0.particles.sparks(end.x, end.y, dir.x, dir.y, 3 + n, 4);
  p.hp -= p.maxHp * (p.lost() - lost0) * 0.8;
  // (the trunk, that everything hangs from, is left to its wounds)
  if (!l.parent) return true;
  // mostly cut away: what's left breaks up
  if (p.lost() > CHUNK.gib) body.gib(l, dir);
  else splitOff(body, l, look, dir);
  return true;
}

/** The solid pixels (x, y pairs) on a line from (x0, y0) to (x1, y1) (pixel coordinates), joined corner to corner: enough to part what's either side. */
function line(p: Part, x0: number, y0: number, x1: number, y1: number): number[] {
  const px: number[] = [];
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const xe = Math.floor(x1);
  const ye = Math.floor(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let k = 0; k <= p.w + p.h + 4; k++) {
    if (p.solidAt(x, y)) px.push(x, y);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return px;
}

/** Is any of it within `r` of (cx, cy) (pixel coordinates) shot away already? */
function shotAway(p: Part, cx: number, cy: number, r: number): boolean {
  if (!p.holeCount) return false;
  const R = Math.ceil(r) + 1;
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const ix = Math.floor(cx) + i;
      const iy = Math.floor(cy) + j;
      if (Math.hypot(ix + 0.5 - cx, iy + 0.5 - cy) <= r && p.art.filled(ix, iy) && !p.solidAt(ix, iy)) return true;
    }
  }
  return false;
}

/**
 * A bite's shape: as deep (along the way the round went) and as wide (across it)
 * as these times its radius. A rifle's tears a shallow crater out of the side,
 * wider than it's deep (it doesn't bore through a limb as wide as itself); from
 * `heavy` J (a battle rifle's) up, a round hole, as deep as it's wide.
 */
const CRATER = { deep: 0.7, wide: 1.2, heavy: 2600 };

function craterOf(e: number): { deep: number; wide: number } {
  const t = Math.max(0, Math.min(1, (e - CHUNK.from) / (CRATER.heavy - CHUNK.from)));
  return { deep: CRATER.deep + (1 - CRATER.deep) * t, wide: CRATER.wide + (1 - CRATER.wide) * t };
}

/** The solid pixels (x, y pairs) of a crater of radius `r` round (cx, cy) (pixel coordinates), the round going (ux, uy) (see CRATER). */
function crater(p: Part, cx: number, cy: number, r: number, ux: number, uy: number, shape: { deep: number; wide: number }): number[] {
  const px: number[] = [];
  const R = Math.ceil(r * shape.wide) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const a = r * shape.deep;
  const b = r * shape.wide;
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const ix = x0 + i;
      const iy = y0 + j;
      const dx = ix + 0.5 - cx;
      const dy = iy + 0.5 - cy;
      const along = dx * ux + dy * uy;
      const across = dy * ux - dx * uy;
      if ((along / a) ** 2 + (across / b) ** 2 <= 1 && p.solidAt(ix, iy)) px.push(ix, iy);
    }
  }
  return px;
}

/** The edge pixels (x, y pairs) are torn from: what's left round them, and its raw colour (x, y, colour triples). */
function rimOf(l: ChunkLimb, px: number[], look: ChunkLook): number[] {
  const p = l.part;
  const gone = new Set<number>();
  for (let k = 0; k < px.length; k += 2) gone.add(px[k + 1] * p.w + px[k]);
  const rim: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < px.length; k += 2) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const x = px[k] + i;
        const y = px[k + 1] + j;
        const key = y * p.w + x;
        if (seen.has(key) || gone.has(key) || !p.solidAt(x, y)) continue;
        seen.add(key);
        rim.push(x, y, rawAt(l, x, y, look));
      }
    }
  }
  return rim;
}

/** Pixels (x, y pairs) torn off `l`, flung `out`: the raw edge left, bits and blood, a wound, and the flesh's worth of harm. */
function tearOff<L extends ChunkLimb>(body: ChunkBody<L>, l: L, px: number[], out: V2, look: ChunkLook, wound: boolean): void {
  const p = l.part;
  const g = body.game;
  const rim = rimOf(l, px, look);
  const lost0 = p.lost();
  p.carve(px, rim);
  const n = px.length / 2;
  // where they were, in the world
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < px.length; k += 2) {
    sx += px[k];
    sy += px[k + 1];
  }
  const at = p.pixelToWorld(Math.round(sx / n), Math.round(sy / n));
  const ps = g.particles;
  for (let k = 0; k < Math.min(14, 2 + n); k++) ps.debris(at.x, at.y, out.x + (Math.random() - 0.5) * 0.8, out.y + Math.random() * 0.5, 1, look.bits[k % look.bits.length], 3 + Math.random() * 2);
  if (look.bleeds) ps.splatter(at.x, at.y, out.x, out.y + 0.1, 6 + n * 3, 4 + n * 0.4, 0.5, p.body);
  else ps.sparks(at.x, at.y, out.x, out.y, 4 + n, 5);
  if (n >= 10) g.sound.gib(at.x);
  else g.sound.squish(0.4 + n * 0.06, at.x, 0.8);
  // flesh gone is harm done, over what the round itself did
  p.hp -= p.maxHp * (p.lost() - lost0) * 0.8;
  if (!wound || !look.bleeds || !rim.length) return;
  // it bleeds from the torn edge (nearest where it struck), and pumps if it's big
  const cx = sx / n;
  const cy = sy / n;
  let best = 0;
  for (let k = 3; k < rim.length; k += 3) if (Math.hypot(rim[k] - cx, rim[k + 1] - cy) < Math.hypot(rim[best] - cx, rim[best + 1] - cy)) best = k;
  const local = rotate(out.x, out.y, -p.body.rotation());
  const ll = Math.hypot(local.x, local.y) || 1;
  const rate = 0.2 + n * 0.06;
  if (l.wounds.length >= 10) l.wounds[Math.floor(Math.random() * l.wounds.length)].rate += rate;
  else l.wounds.push({ ix: rim[best], iy: rim[best + 1], dx: local.x / ll, dy: local.y / ll, rate, spurt: n >= 8 });
}

/**
 * Its solid pixels in 4-connected pieces (only pixels with the same `owner`
 * joined, if given): each pixel's piece (-1: none), and each piece's size.
 */
function components(p: Part, owner?: Int32Array): { comp: Int32Array; sizes: number[] } {
  const w = p.w;
  const h = p.h;
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      if (comp[y0 * w + x0] >= 0 || !p.solidAt(x0, y0)) continue;
      const id = sizes.length;
      let n = 0;
      stack.push(y0 * w + x0);
      comp[y0 * w + x0] = id;
      while (stack.length) {
        const i = stack.pop()!;
        n++;
        const x = i % w;
        const y = (i - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || comp[j] >= 0 || !p.solidAt(nx, ny) || (owner && owner[j] !== owner[i])) continue;
          comp[j] = id;
          stack.push(j);
        }
      }
      sizes.push(n);
    }
  }
  return { comp, sizes };
}

/** The piece a joint's anchor (`v`, local m) is on: the one nearest it, within 2 px (-1 if it's shot away). */
function pieceAt(p: Part, comp: Int32Array, v: V2): number {
  const wv = p.localToWorld(v.x, v.y);
  const c = p.worldToPixel(wv.x, wv.y);
  let best = -1;
  let bd = 6.5;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const x = c.ix + i;
      const y = c.iy + j;
      if (x < 0 || y < 0 || x >= p.w || y >= p.h || comp[y * p.w + x] < 0 || i * i + j * j >= bd) continue;
      bd = i * i + j * j;
      best = comp[y * p.w + x];
    }
  }
  return best;
}

/**
 * Shot clean through, the limb is in pieces held together by nothing: it breaks
 * there. The biggest piece stays the limb (on its joint, or come off there if
 * the piece on the joint is the smaller); the rest come off as pieces of their
 * own (see entities/Gore), what hung from them still hanging from them, and a
 * stump left on the joint stays on what it hung from.
 */
function splitOff<L extends ChunkLimb>(body: ChunkBody<L>, l: L, look: ChunkLook, out: V2): void {
  const p = l.part;
  const { comp, sizes } = components(p);
  if (sizes.length < 2) return;
  const joined = !!l.joint && !!l.parent && !l.severed;
  const root = joined ? pieceAt(p, comp, l.a2) : -1;
  let keep = root >= 0 ? root : 0;
  for (let i = 0; i < sizes.length; i++) if (sizes[i] > sizes[keep]) keep = i;
  // (the joint itself shot away, or the piece on it lost: off it comes there)
  const rootAt = p.localToWorld(l.a2.x, l.a2.y);
  const parent = l.parent;
  if (joined && root !== keep) body.sever(l, 'blast');
  // what hung from the pieces lost comes off with them
  const hung: { c: ChunkLimb; piece: number; at: V2 }[] = [];
  for (const c of l.children) {
    if (c.severed || c.gone) continue;
    const k = pieceAt(p, comp, c.a1);
    if (k === keep) continue;
    const at = p.localToWorld(c.a1.x, c.a1.y);
    body.sever(c as L, 'blast');
    if (k >= 0) hung.push({ c, piece: k, at });
  }
  if (l.gone || p.destroyed) return;
  const lists: number[][] = sizes.map(() => []);
  for (let i = 0; i < comp.length; i++) if (comp[i] >= 0 && comp[i] !== keep) lists[comp[i]].push(i % p.w, Math.floor(i / p.w));
  const made = piecesOff(body, l, lists, look, out, 1.5, 0);
  for (const h of hung) made[h.piece]?.hold(h.c.part, h.at);
  if (joined && root >= 0 && root !== keep && parent && !parent.gone) made[root]?.hold(parent.part, rootAt);
  // gone from the limb, its torn edge raw
  const px = lists.flat();
  p.carve(px, rimOf(l, px, look));
}

/**
 * `l` blown apart (or shot to rags): what's left of it breaks up into a few
 * pieces (see entities/Gore), more the bigger it is, flung out from its middle
 * and along `dir` (a blast's way, a round's) if given. The limbs that hung from
 * it (`hung`, cut loose already) hang on from the piece their joint is on. The
 * part itself is the caller's to take away.
 */
export function breakUp<L extends ChunkLimb>(body: ChunkBody<L>, l: L, look: ChunkLook, hung: ChunkLimb[], dir?: V2): void {
  const p = l.part;
  if (p.destroyed) return;
  const solid: number[] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) solid.push(x, y);
  const n = solid.length / 2;
  if (!n) return;
  // a piece for every 20 px or so, 2 to 4 (a scrap stays whole): each pixel goes with the
  // nearest of as many points strewn over it, and each one's share is split where it isn't joined up
  const k = n < 12 ? 1 : Math.max(2, Math.min(4, Math.round(n / 20)));
  const seeds: number[] = [];
  for (let i = 0; i < k; i++) {
    // (well apart: the best spread of a few picked at random)
    let pick = 0;
    let far = -1;
    for (let t = 0; t < (i ? 8 : 1); t++) {
      const j = Math.floor(Math.random() * n) * 2;
      let d = Infinity;
      for (let s = 0; s < seeds.length; s += 2) d = Math.min(d, (solid[j] - seeds[s]) ** 2 + (solid[j + 1] - seeds[s + 1]) ** 2);
      if (d > far) {
        far = d;
        pick = j;
      }
    }
    seeds.push(solid[pick], solid[pick + 1]);
  }
  const owner = new Int32Array(p.w * p.h).fill(-1);
  for (let i = 0; i < solid.length; i += 2) {
    let best = 0;
    let bd = Infinity;
    for (let s = 0; s < seeds.length; s += 2) {
      const d = (solid[i] - seeds[s]) ** 2 + (solid[i + 1] - seeds[s + 1]) ** 2;
      if (d < bd) {
        bd = d;
        best = s / 2;
      }
    }
    owner[solid[i + 1] * p.w + solid[i]] = best;
  }
  const { comp, sizes } = components(p, owner);
  const lists: number[][] = sizes.map(() => []);
  for (let i = 0; i < comp.length; i++) if (comp[i] >= 0) lists[comp[i]].push(i % p.w, Math.floor(i / p.w));
  const made = piecesOff(body, l, lists, look, dir ?? { x: 0, y: 1 }, dir ? 3.5 : 1.5, 2.5);
  for (const c of hung) {
    if (c.gone || c.part.destroyed) continue;
    const i = pieceAt(p, comp, c.a1);
    if (i >= 0) made[i]?.hold(c.part, p.localToWorld(c.a1.x, c.a1.y));
  }
}

/** The fewest pixels a piece torn off is: fewer fly off as bits. */
const PIECE_MIN = 4;
/** The fastest a piece goes as the part it came off went (m/s), before it's flung. */
const PIECE_FLING = 9;

/**
 * `lists` (each a piece's pixels: x, y pairs) come off `l` as things of their own
 * (see entities/Gore), as they were on it and raw where they're torn from the
 * rest: moving as it moved, flung `out` at up to `speed` m/s more and out from its
 * middle at up to `burst`. They don't push against what of the body they lie on.
 * Scraps too small to be a piece fly off as bits. The pieces made (null for a
 * scrap), in order. (The pixels stay on the part: the caller's to carve away.)
 */
function piecesOff<L extends ChunkLimb>(body: ChunkBody<L>, l: L, lists: number[][], look: ChunkLook, out: V2, speed: number, burst: number): (Gore | null)[] {
  const p = l.part;
  const g = body.game;
  const def = getItem('gore');
  const mine = new Int32Array(p.w * p.h).fill(-1);
  lists.forEach((px, k) => {
    for (let i = 0; i < px.length; i += 2) mine[px[i + 1] * p.w + px[i]] = k;
  });
  const made: (Gore | null)[] = [];
  const f = p.flip;
  for (let k = 0; k < lists.length; k++) {
    const px = lists[k];
    const n = px.length / 2;
    made.push(null);
    if (!n) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < px.length; i += 2) {
      x0 = Math.min(x0, px[i]);
      x1 = Math.max(x1, px[i]);
      y0 = Math.min(y0, px[i + 1]);
      y1 = Math.max(y1, px[i + 1]);
    }
    if (n < PIECE_MIN || !def) {
      for (let i = 0; i < px.length; i += 2) {
        const w = p.pixelToWorld(px[i], px[i + 1]);
        g.particles.debris(w.x, w.y, out.x + (Math.random() - 0.5), out.y + Math.random() * 0.5, 1, p.colorAt(px[i], px[i + 1]), 2 + Math.random() * 2);
      }
      continue;
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const art = new PixelArt(w, h);
    for (let i = 0; i < px.length; i += 2) {
      const x = px[i];
      const y = px[i + 1];
      // raw where it's torn from the rest (flesh round it that isn't in it); the outline it had where it was the outline
      let torn = false;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) if ((q || j) && p.art.filled(x + q, y + j) && mine[(y + j) * p.w + x + q] !== k) torn = true;
      art.set(x - x0, y - y0, torn ? rawAt(l, x, y, look) : p.colorAt(x, y));
    }
    // where it was: its middle, from the part's (as Part.pixelToLocal() has it)
    const at = p.localToWorld((x0 + w / 2 - p.w / 2 + p.spriteOffset.x) * f * PX, (p.h / 2 - y0 - h / 2 + p.spriteOffset.y) * PX);
    const e = g.spawn(def, at.x, at.y, { angle: p.body.rotation(), flip: f === -1, config: goreConfig(art, look.piece) }) as Gore | null;
    if (!e) continue;
    made[k] = e;
    // (as the part moved, but no faster than a piece thrown hard: a blast that has just
    // struck a foot has it going at 40 m/s, and its pieces would land in the next room)
    const v = p.velocityAt(at.x, at.y);
    const vl = Math.hypot(v.x, v.y);
    if (vl > PIECE_FLING) {
      v.x *= PIECE_FLING / vl;
      v.y *= PIECE_FLING / vl;
    }
    const c = p.body.translation();
    const rx = at.x - c.x;
    const ry = at.y - c.y;
    const rl = Math.hypot(rx, ry) || 1;
    const s = speed * (0.4 + Math.random() * 0.6);
    const b = burst * (0.5 + Math.random() * 0.5);
    e.setVelocity(v.x + out.x * s + (rx / rl) * b + (Math.random() - 0.5) * 0.6, v.y + out.y * s + (ry / rl) * b + Math.random() * 0.6, p.body.angvel() + (Math.random() - 0.5) * 10);
    // (not against what of the body it lies on, nor the rest of it: they'd fly apart)
    const q = e.main;
    const apart = (a: Part, z: Part) => {
      (a.noCollide ??= new Set()).add(z);
      (z.noCollide ??= new Set()).add(a);
    };
    apart(q, p);
    for (const m of made) if (m && m !== e) apart(q, m.main);
    for (const col of q.colliders) {
      g.physics.world.intersectionsWithShape(col.translation(), col.rotation(), col.shape, (hit) => {
        const o = g.physics.partOf(hit);
        if (o && o !== q && o.entity === p.entity && !o.destroyed) apart(q, o);
        return true;
      });
    }
  }
  return made;
}

import { PX } from '../engine/constants';
import { PixelArt, type Color } from '../art/PixelArt';
import { getItem } from '../catalog/items';
import { debrisConfig, debrisMat, type Debris } from '../entities/Debris';
import type { Entity } from '../world/Entity';
import type { EntityState } from '../world/types';
import { GLASS } from '../world/Materials';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** The fewest pixels a broken piece is: fewer fly off as bits. */
const PIECE_MIN = 5;
/** The most pieces one break makes. */
const MOST = 24;
/** The fastest (m/s) a piece keeps of how the part was going (a nuke flings tanks at 45). */
const KEEP_MAX = 50;
/** The biggest piece's side (px): bigger ones are split again. */
const SIDE_MAX = 180;

/** How a part breaks (see fracture()). */
export interface Break {
  /** Where it was struck (world): a brittle thing breaks finest there. */
  at?: V2;
  /** The way the blow went (a unit vector): pieces are flung along it. */
  dir?: V2;
  /** How hard, 0..1 and more: more pieces, and flung faster. */
  force?: number;
  /**
   * Its components: for each art pixel, which one it's in (0: none). It comes apart at
   * their seams first (a tank's turret, a car's doors), then each as it would anyway.
   */
  parts?: Uint8Array;
  /** Components that come off in one piece (a tank's turret). */
  whole?: ReadonlySet<number>;
  /** Pixels that are glass (a car's windows, tempered): they burst into glittering bits, not pieces. */
  glass?: (c: Color) => boolean;
  /** The break these pieces share with others (a vehicle's wheels and body: see Debris.from), if not a new one. */
  from?: number;
}

/** A piece's pixels (x, y pairs), and what it's made of. */
interface Bit {
  px: number[];
  mat: string;
}

/** A shade of `c`, k times as bright (k < 1 darker), each channel kept in range. */
function shade(c: Color, k: number): Color {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** How a torn edge looks in a material: bright bare steel, pale splintered wood, crumbled stone. */
function edgeOf(c: Color, mat: string): Color {
  switch (mat) {
    case 'metal':
    case 'sheetMetal':
    case 'robot':
      return shade(c, 1.35) | 0x202020;
    case 'wood':
      return 0xc9a171;
    case 'glass':
      return shade(c, 1.2);
    case 'stone':
    case 'concrete':
      return shade(c, 0.8);
    default:
      return shade(c, 1.15);
  }
}

let breaks = 0;

/**
 * A thing as it stood, to be made again (see Structure.keep()): its parts where they
 * were, with what's to be mended (burns, paint, heat) and its motion left out (Repair
 * mends it whole anyway).
 */
function pristine(e: Entity): EntityState {
  const { uid: _uid, ...s } = e.serialize();
  return {
    ...s,
    parts: s.parts.map(({ x, y, a, frozen, hp, weightless }) => ({ x, y, a, vx: 0, vy: 0, av: 0, frozen, hp, ...(weightless ? { weightless } : {}) })),
  };
}

/**
 * How things not alive break (see fracture(), bulletMark()): the game's, so
 * entities reach it without importing the pieces it makes (which are entities).
 */
export class Structure {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /** Breaks a part into pieces (see fracture()); the part is the caller's to take away. */
  fracture(p: Part, b: Break = {}): Debris[] {
    return fracture(this.game, p, b);
  }

  /**
   * What broke into these pieces, kept by the biggest of them (see Debris.orig): Repair
   * on any piece of it gathers them up and makes it again (see Debris.repair()). A
   * piece broken again hands on what it kept.
   */
  keep(e: Entity, pieces: (Debris | null)[]): void {
    const snap = 'orig' in e ? (e as Debris).orig : pristine(e);
    if (!snap) return;
    let best: Debris | null = null;
    for (const d of pieces) if (d && !d.destroyed && (!best || d.main.mass > best.main.mass)) best = d;
    if (best) best.orig = snap;
  }

  /** A new break's number, for pieces of one thing broken a part at a time (see Break.from). */
  newBreak(): number {
    return ++breaks;
  }

  /**
   * A part come off whole, as a piece of its own (a wheel, a gun barrel): going on
   * as it went, `push` more along the blow. The part is the caller's to take away.
   */
  whole(p: Part, b: Break = {}): Debris | null {
    if (p.destroyed) return null;
    const px: number[] = [];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) px.push(x, y);
    if (px.length < PIECE_MIN * 2) {
      bits(this.game, p, px, b);
      return null;
    }
    return piecesOf(this.game, p, [{ px, mat: debrisMat(p.mat) }], b, Math.min(0.5, b.force ?? 0.3), b.from ?? 0)[0] ?? null;
  }

  /** A part run away molten: glowing drips, falling (the part is the caller's to take away). */
  melt(p: Part): void {
    const g = this.game;
    const n = Math.min(50, Math.max(4, Math.round(p.lost() < 1 ? (p.w * p.h) / 12 : 4)));
    const hot = p.temp > 1300 ? 0xfff0b0 : p.temp > 900 ? 0xffa030 : 0xd04010;
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(Math.random() * p.w);
      const iy = Math.floor(Math.random() * p.h);
      if (!p.solidAt(ix, iy)) continue;
      const at = p.pixelToWorld(ix, iy);
      g.particles.debris(at.x, at.y, (Math.random() - 0.5) * 0.6, -0.3 - Math.random() * 0.5, 1, p.mat.flammability > 0 ? p.colorAt(ix, iy) : hot, 1 + Math.random() * 1.5);
    }
    if (p.temp > 400) g.particles.smoke(p.x, p.y, 2, 0.4, false);
  }

  /** A round's hole or dent (see bulletMark()). */
  mark(p: Part, at: V2, normal: V2, dir: V2, exit: V2 | null, heavy: boolean): void {
    bulletMark(p, at, normal, dir, exit, heavy);
  }
}

/**
 * Breaks a part into pieces of itself (see entities/Debris), as what it's made of
 * breaks: glass into many shards, finest where it was struck; stone and concrete
 * into rubble; wood into a few splinters; steel tears into a few big pieces. A part
 * with components comes apart at their seams first. Each piece goes on as the part
 * was going, flung out from where it was struck, and along the blow; scraps too
 * small for a piece fly off as bits. The part itself is the caller's to take away
 * (all its pixels are in the pieces). The pieces made.
 */
export function fracture(game: Game, p: Part, b: Break = {}): Debris[] {
  if (p.destroyed) return [];
  const w = p.w;
  const h = p.h;
  const solid: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p.solidAt(x, y)) solid.push(x, y);
  // (tempered glass bursts into pellets: bits of its own colour, flung as the pieces are)
  const glassy = b.glass;
  if (glassy) {
    const gl: number[] = [];
    let j = 0;
    for (let i = 0; i < solid.length; i += 2) {
      if (glassy(p.colorAt(solid[i], solid[i + 1]))) gl.push(solid[i], solid[i + 1]);
      else (solid[j++] = solid[i]), (solid[j++] = solid[i + 1]);
    }
    solid.length = j;
    if (gl.length) bits(game, p, gl, b);
  }
  const n = solid.length / 2;
  const mat = debrisMat(p.mat);
  const m = p.mat;
  const force = Math.max(0, b.force ?? 0.5);
  if (n < PIECE_MIN * 2) {
    bits(game, p, solid, b);
    return [];
  }
  // how big a piece is: glass's a few pixels, steel's a big torn sheet, smaller the harder it's hit
  const sizeOf = (brittle: number) => (12 + (1 - brittle) * 140) / (0.6 + force * 0.8);
  let k = Math.max(2, Math.min(MOST, Math.round(n / sizeOf(m.brittle))));
  // the impact point in pixels (if any): a brittle thing's pieces gather there
  let ax = -1;
  let ay = -1;
  if (b.at) {
    const q = p.worldToPixelF(b.at.x, b.at.y);
    ax = q.x;
    ay = q.y;
  }
  const comp = b.parts;
  const owner = new Int32Array(w * h).fill(-1);
  // each component (or the whole, without them), and the glass in it, gets seeds by its size
  // (key: the component, twice over, and 1 more for its glass)
  const groups = new Map<number, number[]>();
  for (let i = 0; i < solid.length; i += 2) {
    const x = solid[i];
    const y = solid[i + 1];
    const c = (comp ? comp[y * w + x] : 0) * 2;
    let g = groups.get(c);
    if (!g) groups.set(c, (g = []));
    g.push(x, y);
  }
  if (groups.size > 1) k = Math.max(k, groups.size);
  let next = 0;
  /** Each owner's material (by its group: glass or the part's own). */
  const ownerMat: string[] = [];
  for (const [key, px] of groups) {
    const gn = px.length / 2;
    const isGlass = (key & 1) === 1;
    const gk = isGlass
      ? Math.max(1, Math.min(MOST, Math.round(gn / sizeOf(GLASS.brittle))))
      : b.whole?.has(key >> 1)
        ? 1
        : Math.max(1, Math.min(MOST, Math.round((k * gn) / n)));
    const seeds: number[] = [];
    for (let i = 0; i < gk; i++) {
      // near the blow, for what shatters; otherwise well spread (the best of a few at random)
      let pick = 0;
      let best = -1;
      const near = ax >= 0 && Math.random() < m.brittle * 0.6;
      for (let t = 0; t < (i ? 6 : 1); t++) {
        const j = Math.floor(Math.random() * gn) * 2;
        let score: number;
        if (near) score = -((px[j] - ax) ** 2 + (px[j + 1] - ay) ** 2);
        else {
          score = Infinity;
          for (let s = 0; s < seeds.length; s += 2) score = Math.min(score, (px[j] - seeds[s]) ** 2 + (px[j + 1] - seeds[s + 1]) ** 2);
        }
        if (score > best || t === 0) {
          best = score;
          pick = j;
        }
      }
      seeds.push(px[pick], px[pick + 1]);
    }
    for (let i = 0; i < px.length; i += 2) {
      let bi = 0;
      let bd = Infinity;
      for (let s = 0; s < seeds.length; s += 2) {
        const d = (px[i] - seeds[s]) ** 2 + (px[i + 1] - seeds[s + 1]) ** 2;
        if (d < bd) {
          bd = d;
          bi = s / 2;
        }
      }
      owner[px[i + 1] * w + px[i]] = next + bi;
    }
    for (let s = 0; s < seeds.length; s += 2) ownerMat.push(isGlass ? 'glass' : mat);
    next += seeds.length / 2;
  }
  // each one's share split where it isn't joined up (4-neighbours)
  const lists = connected(owner, w, h);
  // pieces too long a side split down the middle (a beam broken in two halves, not one long one)
  const out: Bit[] = [];
  for (const l of lists) {
    const lm = ownerMat[owner[l[1] * w + l[0]]] ?? mat;
    const halves: number[][] = [];
    splitLong(l, halves);
    for (const px of halves) out.push({ px, mat: lm });
  }
  return piecesOf(game, p, out, b, force, b.from ?? ++breaks);
}

/** Pixels grouped into pieces: those of one owner that touch (4-neighbours), each an x, y list. */
function connected(owner: Int32Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0 || seen[i]) continue;
    const o = owner[i];
    const list: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      list.push(x, y);
      if (x > 0 && !seen[j - 1] && owner[j - 1] === o) (seen[j - 1] = 1), stack.push(j - 1);
      if (x < w - 1 && !seen[j + 1] && owner[j + 1] === o) (seen[j + 1] = 1), stack.push(j + 1);
      if (y > 0 && !seen[j - w] && owner[j - w] === o) (seen[j - w] = 1), stack.push(j - w);
      if (y < h - 1 && !seen[j + w] && owner[j + w] === o) (seen[j + w] = 1), stack.push(j + w);
    }
    out.push(list);
  }
  return out;
}

/** Halves a piece across its long side until no side is past SIDE_MAX. */
function splitLong(l: number[], out: number[][]): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < l.length; i += 2) {
    x0 = Math.min(x0, l[i]);
    x1 = Math.max(x1, l[i]);
    y0 = Math.min(y0, l[i + 1]);
    y1 = Math.max(y1, l[i + 1]);
  }
  if (x1 - x0 < SIDE_MAX && y1 - y0 < SIDE_MAX) {
    out.push(l);
    return;
  }
  const alongX = x1 - x0 >= y1 - y0;
  const mid = alongX ? (x0 + x1) / 2 : (y0 + y1) / 2;
  const a: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < l.length; i += 2) ((alongX ? l[i] : l[i + 1]) < mid ? a : c).push(l[i], l[i + 1]);
  splitLong(a, out);
  splitLong(c, out);
}

/** Scraps of `p` (x, y pixel pairs) flying off as bits, coloured as they were. */
function bits(game: Game, p: Part, px: number[], b: Break): void {
  const dx = b.dir?.x ?? 0;
  const dy = b.dir?.y ?? 0.5;
  const step = Math.max(1, Math.floor(px.length / 2 / 40));
  for (let i = 0; i < px.length; i += 2 * step) {
    const at = p.pixelToWorld(px[i], px[i + 1]);
    game.particles.debris(at.x, at.y, dx + (Math.random() - 0.5), dy + Math.random() * 0.5, 1, p.colorAt(px[i], px[i + 1]), 2 + Math.random() * 3);
  }
}

/** The pieces of `p` (each its pixels and material) made things of their own, as fracture() says. */
function piecesOf(game: Game, p: Part, lists: Bit[], b: Break, force: number, from: number): Debris[] {
  const def = getItem('debris');
  const w = p.w;
  const mine = new Int32Array(w * p.h).fill(-1);
  lists.forEach(({ px }, k) => {
    for (let i = 0; i < px.length; i += 2) mine[px[i + 1] * w + px[i]] = k;
  });
  // (which pixels are solid, once: a torn edge is a pixel with a solid neighbour in another piece)
  const h = p.h;
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p.solidAt(x, y)) solid[y * w + x] = 1;
  const made: Debris[] = [];
  const f = p.flip;
  // (flung apart by the break itself, and on as the part was going: a blast's push, read
  // from the body as it is now, is in that)
  const speed = 1 + Math.min(2, force) * (1.5 + p.mat.brittle * 2.5);
  const lv = p.body.linvel();
  const av = p.body.angvel();
  const v0 = { x: lv.x, y: lv.y };
  const vl = Math.hypot(v0.x, v0.y);
  if (vl > KEEP_MAX) {
    v0.x *= KEEP_MAX / vl;
    v0.y *= KEEP_MAX / vl;
  }
  const origin = b.at ?? { x: p.x, y: p.y };
  for (let k = 0; k < lists.length; k++) {
    const { px, mat } = lists[k];
    const n = px.length / 2;
    if (n < PIECE_MIN || !def) {
      bits(game, p, px, b);
      continue;
    }
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
    const aw = x1 - x0 + 1;
    const ah = y1 - y0 + 1;
    const art = new PixelArt(aw, ah);
    for (let i = 0; i < px.length; i += 2) {
      const x = px[i];
      const y = px[i + 1];
      // torn where it broke from the rest; the outline it had where it was the outline
      let torn = false;
      for (let j = -1; j <= 1 && !torn; j++) {
        const yy = y + j;
        if (yy < 0 || yy >= h) continue;
        for (let q = -1; q <= 1; q++) {
          const xx = x + q;
          if ((q || j) && xx >= 0 && xx < w && solid[yy * w + xx] && mine[yy * w + xx] !== k) {
            torn = true;
            break;
          }
        }
      }
      const c = p.colorAt(x, y);
      art.set(x - x0, y - y0, torn ? edgeOf(c, mat) : c);
    }
    // where it was: its middle, from the part's (as Part.pixelToLocal() has it)
    const at = p.localToWorld((x0 + aw / 2 - w / 2 + p.spriteOffset.x) * f * PX, (p.h / 2 - y0 - ah / 2 + p.spriteOffset.y) * PX);
    const e = game.spawn(def, at.x, at.y, { angle: p.bodyAngle, flip: f === -1, config: debrisConfig(art, mat, from || undefined) }) as Debris | null;
    if (!e) continue;
    made.push(e);
    const q = e.main;
    q.charred = p.charred;
    q.oil = p.oil;
    if (p.temp !== q.temp) game.heat.set(q, p.temp);
    if (p.burning > 0.1) game.fire.ignite(q, p.burning * 0.8);
    // as the part went, spun as it spun, flung out from the blow and along it
    const rx = at.x - origin.x;
    const ry = at.y - origin.y;
    const rl = Math.hypot(rx, ry) || 1;
    const s = speed * (0.4 + Math.random() * 0.6);
    const along = b.dir ? speed * 0.6 * Math.random() : 0;
    const spin = Math.max(-25, Math.min(25, av + (Math.random() - 0.5) * (2 + Math.min(2, force) * 5)));
    // (and the part's own turning, at that point)
    const tx = -(at.y - p.y) * av;
    const ty = (at.x - p.x) * av;
    e.setVelocity(v0.x + tx + (rx / rl) * s + (b.dir?.x ?? 0) * along, v0.y + ty + (ry / rl) * s + (b.dir?.y ?? 0) * along + Math.random() * 0.5, spin);
  }
  // (fresh pieces don't push each other apart: their hulls overlap where the pixels didn't.
  // One group for them all, its pairs refused by Rapier itself: not a pair at a time, a
  // tank's thirty pieces were 870 calls and most of a nuke's slowest step)
  if (made.length > 1) {
    const group = 1_000_000 + Math.floor(Math.random() * 1e9);
    for (const d of made) d.main.group = group;
  }
  return made;
}

/**
 * A round's mark on something not alive: through a thin sheet (`through`), a
 * hole as wide as the round, where it went in and where it came out; stopped by
 * armour, a dent (dark in the middle, bright where the metal's pushed up).
 */
export function bulletMark(p: Part, at: V2, normal: V2, dir: V2, exit: V2 | null, heavy: boolean): void {
  if (p.destroyed) return;
  if (exit) {
    hole(p, at.x - normal.x * PX * 0.5, at.y - normal.y * PX * 0.5, heavy);
    hole(p, exit.x - dir.x * PX * 0.5, exit.y - dir.y * PX * 0.5, heavy);
    return;
  }
  const q = p.worldToPixel(at.x - normal.x * PX * 0.5, at.y - normal.y * PX * 0.5);
  const c = p.solidAt(q.ix, q.iy) ? p.colorAt(q.ix, q.iy) : p.mat.debrisColor;
  p.paintPixel(q.ix, q.iy, shade(c, 0.45));
  if (p.mat.sparks) for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Math.random() < 0.5 && p.solidAt(q.ix + i, q.iy + j)) p.paintPixel(q.ix + i, q.iy + j, shade(p.colorAt(q.ix + i, q.iy + j), 1.3), 0.6);
}

/** A hole at a world point: the pixel there (and round it, `wide`), its rim darkened. */
function hole(p: Part, x: number, y: number, wide: boolean): void {
  const q = p.worldToPixel(x, y);
  const px: number[] = [];
  const near = wide ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 0]];
  for (const [i, j] of near) if (p.solidAt(q.ix + i, q.iy + j)) px.push(q.ix + i, q.iy + j);
  if (!px.length) return;
  // (a part mustn't be shot away to nothing pixel by pixel: past a third of it gone, only marks)
  if (p.lost() > 0.33) {
    p.paintPixel(px[0], px[1], 0x141414);
    return;
  }
  const rim: number[] = [];
  for (let k = 0; k < px.length; k += 2) {
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = px[k] + i;
      const b = px[k + 1] + j;
      if (p.solidAt(a, b)) rim.push(a, b, shade(p.colorAt(a, b), 0.6));
    }
  }
  p.carve(px, rim);
}

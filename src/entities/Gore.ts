import { Prop, type PropConfig } from './Prop';
import { RAPIER } from '../engine/Physics';
import { PixelArt, CLEAR } from '../art/PixelArt';
import { MAT, type PhysMaterial } from '../world/Materials';
import { clamp, type V2 } from '../engine/math';
import { PX } from '../engine/constants';
import { toBase64, fromBase64 } from '../engine/base64';
import type { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { EntityConfig, ItemDef, SpawnOptions } from '../world/types';

/** What a piece is: torn flesh (a person's or an animal's), or an android's plating. */
export type GoreKind = 'flesh' | 'plating';

/** A piece torn off a body: its pixels as they were on it. */
export interface GoreConfig extends EntityConfig {
  w: number;
  h: number;
  /** Its pixels, row by row from the top: RGB and 255 where it's solid (0 elsewhere), base64. */
  px: string;
  kind: GoreKind;
}

/** Plating torn off an android: it's a machine's. */
const PLATE: PhysMaterial = { ...MAT.robot, name: 'Plating' };

/** The biggest piece kept whole (px a side): a body's parts are well within it. */
const MAX_SIDE = 48;

/** The pixels of the configs made by goreConfig(), which only read them out of base64 for a save. */
const artOfConfig = new WeakMap<object, PixelArt>();

/** A config from a save or a paste, made safe: a known kind, a size within limits, pixels to match (a scrap of flesh if not). */
export function readGoreConfig(c: EntityConfig | undefined): GoreConfig {
  // (one made here is safe as it is)
  if (c && artOfConfig.has(c)) return c as GoreConfig;
  const kind: GoreKind = c?.kind === 'plating' ? 'plating' : 'flesh';
  const w = Math.round(Number(c?.w));
  const h = Math.round(Number(c?.h));
  if (w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE && typeof c?.px === 'string') {
    try {
      const b = fromBase64(c.px);
      if (b.length === w * h * 4 && b.some((v, i) => i % 4 === 3 && v)) return { w, h, px: c.px, kind };
    } catch {
      // (not base64: the scrap below)
    }
  }
  const art = new PixelArt(3, 3).rect(0, 0, 3, 3, kind === 'flesh' ? 0x8e1a1a : 0x3a3f46);
  return goreConfig(art, kind);
}

/**
 * The config for a piece with these pixels (which mustn't change after): its base64 made
 * when it's first read, for a save or a copy (a blast tears off dozens of pieces at once).
 */
export function goreConfig(art: PixelArt, kind: GoreKind): GoreConfig {
  let px: string | undefined;
  const cfg: GoreConfig = {
    w: art.w,
    h: art.h,
    get px() {
      if (px === undefined) {
        const b = new Uint8Array(art.w * art.h * 4);
        for (let i = 0; i < art.px.length; i++) {
          const c = art.px[i];
          if (c === CLEAR) continue;
          b[i * 4] = (c >> 16) & 255;
          b[i * 4 + 1] = (c >> 8) & 255;
          b[i * 4 + 2] = c & 255;
          b[i * 4 + 3] = 255;
        }
        px = toBase64(b);
      }
      return px;
    },
    kind,
  };
  artOfConfig.set(cfg, art);
  return cfg;
}

function artOf(cfg: GoreConfig): PixelArt {
  const made = artOfConfig.get(cfg);
  if (made) return made;
  const a = new PixelArt(cfg.w, cfg.h);
  const b = fromBase64(cfg.px);
  for (let i = 0; i < cfg.w * cfg.h; i++) if (b[i * 4 + 3]) a.px[i] = (b[i * 4] << 16) | (b[i * 4 + 1] << 8) | b[i * 4 + 2];
  return a;
}

/** Its collider: the convex hull of its pixels (from its middle, y up), counter-clockwise. */
function hullOf(art: PixelArt): ShapeSpec & { kind: 'poly' } {
  // (of each row's first and last pixels' corners: those between are inside it)
  // Each corner is one number, x then y (in half pixels, made positive), sorted by
  // x then y as a typed array sorts numbers: pairs sorted with a comparison were a
  // good share of a piece's making, and a blast makes dozens.
  const keys: number[] = [];
  const key = (x: number, y: number) => (x * 2 + 256) * 1024 + y * 2 + 256;
  for (let y = 0; y < art.h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < art.w; x++) {
      if (art.px[y * art.w + x] === CLEAR) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 < 0) continue;
    const cy = art.h / 2 - y;
    for (const cx of x0 === x1 ? [x0 - art.w / 2] : [x0 - art.w / 2, x1 - art.w / 2]) keys.push(key(cx, cy), key(cx + 1, cy), key(cx, cy - 1), key(cx + 1, cy - 1));
  }
  const sorted = Int32Array.from(keys).sort();
  const n = sorted.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (Math.floor(sorted[i] / 1024) - 256) / 2;
    ys[i] = ((sorted[i] % 1024) - 256) / 2;
  }
  // (corners by their place in xs and ys)
  const cross = (o: number, a: number, b: number) => (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o]);
  const lower: number[] = [];
  for (let i = 0; i < n; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  return { kind: 'poly', pts: lower.slice(0, -1).concat(upper.slice(0, -1)).map((i): [number, number] => [xs[i], ys[i]]) };
}

/** How long a fresh piece of flesh drips (s), and how fast at first (drops a second). */
const DRIP = { time: 3, rate: 5 };

/** The most pieces about at once: past it the oldest goes (a long battle would pile them up, each a body to step). */
const MAX_PIECES = 200;
const piecesIn = new WeakMap<Game, Gore[]>();

/**
 * A piece torn off a body by a heavy round or a blast (see systems/Chunks): its
 * own pixels, raw at the torn edge, as a thing of its own that falls, tumbles and
 * can be picked up. Flesh drips for a while and bleeds where it's hit; enough
 * more harm and it goes to bits. What hung from it when it came off (a foot from
 * a shin shot through) may still hang from it.
 */
export class Gore extends Prop {
  private age = 0;
  /** Limbs that came off with it, hanging from it by their joint. */
  private holds: { part: Part; joint: RAPIER.ImpulseJoint; a: V2; b: V2 }[] = [];

  constructor(game: Game, def: ItemDef, cfg: GoreConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, goreProp(cfg), x, y, opts);
    this.config = cfg;
    let all = piecesIn.get(game);
    if (!all) piecesIn.set(game, (all = []));
    all.push(this);
    if (all.length > MAX_PIECES) game.remove(all.shift()!);
  }

  protected onDestroy(): void {
    const all = piecesIn.get(this.game);
    const i = all ? all.indexOf(this) : -1;
    if (i >= 0) all!.splice(i, 1);
  }

  get kind(): GoreKind {
    return (this.config as GoreConfig).kind;
  }

  get label(): string {
    return this.kind === 'flesh' ? 'Flesh' : 'Plating';
  }

  /** Hangs `part` from it by a joint at `at` (world): it came off with it. */
  /**
   * Its collider's shape, at its body's origin, for a query (made from the hull it was
   * made from: reading it back out of Rapier, which then works the hull out again, is slow).
   */
  hullShape(): RAPIER.ConvexPolygon {
    const pts = hullOfConfig.get(this.config as GoreConfig)!;
    const f = this.main.flip;
    const n = pts.length;
    const v = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      // (mirrored, it goes round the other way: taken backwards)
      const p = pts[f === 1 ? i : n - 1 - i];
      v[i * 2] = p[0] * PX * f;
      v[i * 2 + 1] = p[1] * PX;
    }
    return new RAPIER.ConvexPolygon(v, true);
  }

  hold(part: Part, at: V2): void {
    if (part.destroyed || this.main.destroyed) return;
    const a = this.main.worldToLocal(at.x, at.y);
    const b = part.worldToLocal(at.x, at.y);
    this.join(part, a, b);
  }

  private join(part: Part, a: V2, b: V2): void {
    const j = this.addJoint(RAPIER.JointData.revolute(a, b), this.main, part) as RAPIER.RevoluteImpulseJoint;
    // (limp, as it hung: a little either way of how it lies now)
    const rel = part.bodyAngle - this.main.bodyAngle;
    j.setLimits(rel - 0.6, rel + 0.6);
    this.main.noCollideWith(part);
    part.noCollideWith(this.main);
    this.holds.push({ part, joint: j, a, b });
  }

  preStep(dt: number): void {
    if (this.holds.some((h) => h.part.destroyed || !h.joint.isValid())) this.holds = this.holds.filter((h) => !h.part.destroyed && h.joint.isValid());
    if (this.kind !== 'flesh' || this.age > DRIP.time || this.main.frozen) return;
    this.age += dt;
    // a fresh piece drips, less and less, from a pixel on its underside
    if (Math.random() > DRIP.rate * (1 - this.age / DRIP.time) * dt) return;
    const p = this.main;
    for (let k = 0; k < 4; k++) {
      const ix = Math.floor(Math.random() * p.w);
      const iy = Math.floor(Math.random() * p.h);
      if (!p.solidAt(ix, iy)) continue;
      const w = p.pixelToWorld(ix, iy);
      this.game.particles.blood(w.x, w.y, 0, -1, 1, 0.3, p.body);
      return;
    }
  }

  onBullet(hit: Parameters<Prop['onBullet']>[0]): void {
    if (this.kind === 'flesh') this.game.particles.blood(hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y + 0.3, 6, 2.5, hit.part.body);
    super.onBullet(hit);
  }

  shatter(point?: V2): void {
    const p = this.main;
    if (this.kind === 'flesh' && !this.destroyed) {
      this.game.particles.blood(p.x, p.y, 0, 1, 10, 3, null);
      this.game.sound.squish(0.6, p.x);
    }
    super.shatter(point);
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const out: number[][] = [];
    for (const h of this.holds) {
      const i = h.part.destroyed || !h.joint.isValid() ? -1 : ref(h.part.entity);
      if (i >= 0) out.push([i, h.part.entity.parts.indexOf(h.part), h.a.x, h.a.y, h.b.x, h.b.y]);
    }
    return out.length ? { holds: out } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    if (!Array.isArray(links.holds)) return;
    for (const h of links.holds as unknown[]) {
      if (!Array.isArray(h) || h.length < 6 || !h.every((v) => Number.isFinite(v))) continue;
      const q = get(h[0])?.parts[h[1]];
      if (q && !q.destroyed) this.join(q, { x: h[2], y: h[3] }, { x: h[4], y: h[5] });
    }
  }
}

/** Each piece's hull, as goreProp() made its collider from it (see Gore.hullShape()). */
const hullOfConfig = new WeakMap<GoreConfig, [number, number][]>();

function goreProp(cfg: GoreConfig): PropConfig {
  const art = artOf(cfg);
  const n = art.px.reduce((s, c) => s + (c !== CLEAR ? 1 : 0), 0);
  const hull = hullOf(art);
  hullOfConfig.set(cfg, hull.pts);
  return {
    art: () => art,
    material: cfg.kind === 'flesh' ? MAT.flesh : PLATE,
    shapes: [hull],
    ownTexture: true,
    ccd: true,
    angularDamping: 0.6,
    // (a scrap goes to bits at a couple of rounds more, or a few bits of shrapnel; a forearm's worth takes a burst)
    hp: clamp(8 + n * 0.4, 10, 60) * (cfg.kind === 'flesh' ? 1 : 2),
  };
}

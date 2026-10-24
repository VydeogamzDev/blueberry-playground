import { Prop, type PropConfig } from './Prop';
import { RAPIER } from '../engine/Physics';
import { PixelArt, CLEAR } from '../art/PixelArt';
import { MAT, type PhysMaterial } from '../world/Materials';
import { clamp, type V2 } from '../engine/math';
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

/** A config from a save or a paste, made safe: a known kind, a size within limits, pixels to match (a scrap of flesh if not). */
export function readGoreConfig(c: EntityConfig | undefined): GoreConfig {
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

/** The config for a piece with these pixels. */
export function goreConfig(art: PixelArt, kind: GoreKind): GoreConfig {
  const b = new Uint8Array(art.w * art.h * 4);
  for (let i = 0; i < art.px.length; i++) {
    const c = art.px[i];
    if (c === CLEAR) continue;
    b[i * 4] = (c >> 16) & 255;
    b[i * 4 + 1] = (c >> 8) & 255;
    b[i * 4 + 2] = c & 255;
    b[i * 4 + 3] = 255;
  }
  return { w: art.w, h: art.h, px: toBase64(b), kind };
}

function artOf(cfg: GoreConfig): PixelArt {
  const a = new PixelArt(cfg.w, cfg.h);
  const b = fromBase64(cfg.px);
  for (let i = 0; i < cfg.w * cfg.h; i++) if (b[i * 4 + 3]) a.px[i] = (b[i * 4] << 16) | (b[i * 4 + 1] << 8) | b[i * 4 + 2];
  return a;
}

/** Its collider: the convex hull of its pixels (from its middle, y up). */
function hullOf(art: PixelArt): ShapeSpec {
  const pts: [number, number][] = [];
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      if (!art.filled(x, y)) continue;
      const cx = x - art.w / 2;
      const cy = art.h / 2 - y;
      pts.push([cx, cy], [cx + 1, cy], [cx, cy - 1], [cx + 1, cy - 1]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return { kind: 'poly', pts: lower.slice(0, -1).concat(upper.slice(0, -1)) };
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
  hold(part: Part, at: V2): void {
    if (part.destroyed || this.main.destroyed) return;
    const a = this.main.worldToLocal(at.x, at.y);
    const b = part.worldToLocal(at.x, at.y);
    this.join(part, a, b);
  }

  private join(part: Part, a: V2, b: V2): void {
    const j = this.addJoint(RAPIER.JointData.revolute(a, b), this.main, part) as RAPIER.RevoluteImpulseJoint;
    // (limp, as it hung: a little either way of how it lies now)
    const rel = part.body.rotation() - this.main.body.rotation();
    j.setLimits(rel - 0.6, rel + 0.6);
    (this.main.noCollide ??= new Set()).add(part);
    (part.noCollide ??= new Set()).add(this.main);
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

function goreProp(cfg: GoreConfig): PropConfig {
  const art = artOf(cfg);
  const n = art.px.reduce((s, c) => s + (c !== CLEAR ? 1 : 0), 0);
  return {
    art: () => art,
    material: cfg.kind === 'flesh' ? MAT.flesh : PLATE,
    shapes: [hullOf(art)],
    ownTexture: true,
    ccd: true,
    angularDamping: 0.6,
    // (a scrap goes to bits at a couple of rounds more, or a few bits of shrapnel; a forearm's worth takes a burst)
    hp: clamp(8 + n * 0.4, 10, 60) * (cfg.kind === 'flesh' ? 1 : 2),
  };
}

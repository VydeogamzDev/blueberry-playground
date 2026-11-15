import { PX } from '../engine/constants';
import { PixelArt } from '../art/PixelArt';
import { GUNMETAL, STEEL, WOOD } from '../art/palette';
import { MAT, type PhysMaterial } from '../world/Materials';
import { Prop, type PropConfig } from './Prop';
import type { ShapeSpec, Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, EntityConfig, ItemDef, SpawnOptions } from '../world/types';

// Rails (0.4.0): track laid with the Rails tool (the Shape tool's key twice), and what
// rides it: rail wheels and coaster cars hold to it (over the top of a loop too) and
// roll along it freely. See systems/Rails for how they're held on.

/** Rails: smooth steel (wheels on them slide almost freely; see systems/Rails). */
export const RAIL_MAT: PhysMaterial = { ...MAT.metal, name: 'Steel', friction: 0.04 };
/** A rail wheel: hard, and slick on the rail. */
export const RAIL_WHEEL_MAT: PhysMaterial = { ...MAT.metal, name: 'Steel', friction: 0 };
/** How thick a rail is (px), and the most a laid track may span (px, each way). */
export const RAIL_PX = 3;
export const TRACK_MOST = 2048;
/** A track's drive (see Track.drive): off, a chain lift, a launch (m/s along it). */
export const DRIVES = [0, 4, 18];

/** A track's config: its points (px from its middle, y up), and its drive. */
export interface TrackConfig {
  pts: number[];
  drive?: number;
}

/** A config as sent or saved, checked (null: not a track's). */
export function readTrackConfig(c: EntityConfig | undefined): TrackConfig | null {
  const pts = c?.pts;
  if (!Array.isArray(pts) || pts.length < 4 || pts.length > 4000 || pts.length % 2 || !pts.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= TRACK_MOST)) return null;
  const drive = typeof c!.drive === 'number' && DRIVES.includes(c!.drive) ? c!.drive : 0;
  return { pts: pts as number[], drive };
}

/** The track's picture: a steel rail along its points, on sleepers. */
function trackArt(pts: number[], w: number, h: number): PixelArt {
  const a = new PixelArt(w, h);
  const X = (i: number) => pts[i] + w / 2;
  const Y = (i: number) => h / 2 - pts[i + 1];
  // sleepers across it every so often
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dy = pts[i + 3] - pts[i + 1];
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    for (let s = (12 - run) % 12; s < len; s += 12) {
      const x = pts[i] + (dx * s) / len;
      const y = pts[i + 1] + (dy * s) / len;
      a.line(Math.round(x - nx * 3 + w / 2), Math.round(h / 2 - (y - ny * 3)), Math.round(x + nx * 3 + w / 2), Math.round(h / 2 - (y + ny * 3)), WOOD[1]);
    }
    run = (run + len) % 12;
  }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    for (let k = -1; k <= 1; k++) {
      const c = k === 1 ? STEEL[3] : k === 0 ? STEEL[2] : GUNMETAL[2];
      a.line(Math.round(X(i)), Math.round(Y(i)) - k, Math.round(X(i + 2)), Math.round(Y(i + 2)) - k, c);
    }
  }
  return a;
}

/** A track's look and build from its points. */
export function trackProp(cfg: TrackConfig): PropConfig & { w: number; h: number } {
  const p = cfg.pts;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
  }
  // (centred: the points are about its middle)
  const w = Math.ceil(2 * Math.max(Math.abs(x0), Math.abs(x1)) + 10);
  const h = Math.ceil(2 * Math.max(Math.abs(y0), Math.abs(y1)) + 10);
  const shapes: ShapeSpec[] = [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i];
    const dy = p[i + 3] - p[i + 1];
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    shapes.push({ kind: 'box', w: len + 1, h: RAIL_PX, x: (p[i] + p[i + 2]) / 2, y: (p[i + 1] + p[i + 3]) / 2, angle: Math.atan2(dy, dx), r: 0.2 });
  }
  const art = trackArt(p, w, h);
  return { art: () => art, material: RAIL_MAT, shapes, density: 200, ownTexture: true, w, h };
}

/**
 * A length of track, laid with the Rails tool: fixed where it's laid (frozen), a rail
 * anything can roll on, and that rail wheels and coaster cars hold to, round loops and
 * all. Its menu can make it a chain lift or a launch: what rides it is driven along it.
 */
export class Track extends Prop {
  /** Its centre line (m, in its body's frame), and whether it closes on itself. */
  readonly line: { x: number; y: number }[];
  readonly closed: boolean;
  /** Driven along it at this speed (m/s; 0 none), the way it was laid. */
  drive: number;
  /** Its line in the world, as of its pose then (see world()). */
  private worldLine: { x: number; y: number }[] = [];
  private worldAt = { x: NaN, y: NaN, a: NaN };
  /** Its bounds in the world (m), for a quick look. */
  bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(game: Game, def: ItemDef, cfg: TrackConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, trackProp(cfg), x, y, opts);
    this.config = { pts: cfg.pts, ...(cfg.drive ? { drive: cfg.drive } : {}) };
    this.drive = cfg.drive ?? 0;
    this.line = [];
    for (let i = 0; i < cfg.pts.length; i += 2) this.line.push({ x: cfg.pts[i] * PX, y: cfg.pts[i + 1] * PX });
    const a = this.line[0];
    const b = this.line[this.line.length - 1];
    this.closed = this.line.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < 0.4;
    this.main.setFrozen(true);
    game.rails.addTrack(this);
  }

  get label(): string {
    return this.drive ? (this.drive >= 10 ? 'Launch track' : 'Chain lift track') : 'Track';
  }

  /** Its line in the world now (worked out again only when it's moved). */
  world(): { x: number; y: number }[] {
    const p = this.main;
    const t = p.body.translation();
    const r = p.body.rotation();
    if (t.x === this.worldAt.x && t.y === this.worldAt.y && r === this.worldAt.a) return this.worldLine;
    this.worldAt = { x: t.x, y: t.y, a: r };
    const c = Math.cos(r);
    const s = Math.sin(r);
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    // (mirrored, its line is too)
    const f = p.flip;
    this.worldLine = this.line.map((q) => {
      const lx = q.x * f;
      const w = { x: t.x + lx * c - q.y * s, y: t.y + lx * s + q.y * c };
      b.x0 = Math.min(b.x0, w.x);
      b.y0 = Math.min(b.y0, w.y);
      b.x1 = Math.max(b.x1, w.x);
      b.y1 = Math.max(b.y1, w.y);
      return w;
    });
    this.bounds = b;
    return this.worldLine;
  }

  setDrive(v: number): void {
    this.drive = v;
    this.config = { ...(this.config ?? {}), drive: v || undefined };
    if (!v) delete this.config.drive;
  }

  contextActions(): ContextAction[] {
    return [
      { label: 'Plain track', checked: this.drive === 0, action: () => this.setDrive(0) },
      { label: `Chain lift (${DRIVES[1]} m/s)`, checked: this.drive === DRIVES[1], action: () => this.setDrive(DRIVES[1]) },
      { label: `Launch (${DRIVES[2]} m/s)`, checked: this.drive === DRIVES[2], action: () => this.setDrive(DRIVES[2]) },
    ];
  }

  frame(): void {
    // (a drive's track: its chain or its launch coils glint along it)
    if (!this.drive) return;
    const l = this.world();
    if (l.length < 2) return;
    const k = Math.floor((this.game.time * this.drive * 2) % l.length);
    const q = l[k];
    this.game.renderer.addLight(q.x, q.y, 0.6, 0.35, this.drive >= 10 ? 0x8fd8ff : 0xffd27a);
  }

  protected onDestroy(): void {
    this.game.rails.removeTrack(this);
    super.onDestroy();
  }
}

/** A point of something that holds to a track (see systems/Rails): on a part, where (m, its body's frame), and its wheel's radius (m). */
export interface RailContact {
  part: Part;
  lx: number;
  ly: number;
  r: number;
}

/** Something with rail contacts (a rail wheel, a coaster car). */
export interface RailRider {
  railContacts(): RailContact[];
}

/** A rail wheel's radius (px). */
export const RAIL_WHEEL_R = 7;

/**
 * A rail wheel: a flanged steel wheel. Brought to a track it holds to it (both ways:
 * round a loop, over a crest) and slides along it almost freely. Weld two to a
 * carriage (a plank, a box, a seat) and it rides the rails.
 */
export class RailWheel extends Prop implements RailRider {
  private contacts: RailContact[];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.contacts = [{ part: this.main, lx: 0, ly: 0, r: RAIL_WHEEL_R * PX }];
    game.rails.addRider(this);
  }

  railContacts(): RailContact[] {
    return this.contacts;
  }

  /** On a track (see systems/Rails). */
  get onTrack(): boolean {
    return this.game.rails.isOn(this.contacts[0]);
  }

  contextActions(): ContextAction[] {
    return [{ label: this.onTrack ? 'On the rails' : 'Off the rails', disabled: true, action: () => {} }];
  }

  protected onDestroy(): void {
    this.game.rails.removeRider(this);
    super.onDestroy();
  }
}


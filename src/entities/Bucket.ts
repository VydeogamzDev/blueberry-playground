import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { fromRgb, type PixelArt } from '../art/PixelArt';
import { bucketArt, bucketInside, drumArt, drumInside } from '../art/props';
import { Prop, type PropConfig } from './Prop';
import { Liquid, LIQUID_COLORS, type LiquidCatcher } from '../systems/Liquids';
import { DROP } from '../systems/Puddles';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/**
 * The bucket's walls and base (sprite pixels from its middle, y up; see
 * bucketArt()): open at the top, so things and liquid go in.
 */
export const BUCKET_SHAPES: ShapeSpec[] = [
  { kind: 'poly', pts: [[-10.5, 7.5], [-8, 7.5], [-6, -12.5], [-8, -14.5]] },
  { kind: 'poly', pts: [[10.5, 7.5], [8, 7.5], [6, -12.5], [8, -14.5]] },
  { kind: 'box', w: 16, h: 2, y: -13.5, r: 0.3 },
];

/** The open drum's (the barrel's) walls and base, as BUCKET_SHAPES (see drumArt()). */
export const DRUM_SHAPES: ShapeSpec[] = [
  { kind: 'box', w: 2, h: 26, x: -8, r: 0.3 },
  { kind: 'box', w: 2, h: 26, x: 8, r: 0.3 },
  { kind: 'box', w: 14, h: 2, y: -12, r: 0.3 },
];

/** A vessel's inside and look, in sprite pixels from its middle (y up). */
interface VesselSpec {
  /** Its rim and floor, and how far either side of the middle its inside reaches at a height. */
  rim: number;
  floor: number;
  innerHalf(y: number): number;
  /** Where the lips of its rim are (either side of the middle): what pours out goes over them. */
  lip: number;
  /** Its width over its depth (inside), for how much stays in it tipped over (see held()). */
  aspect: number;
  /** The pixels inside it, and its sprite with `level` (0..1) of a liquid of `color` in it, tilted `tilt`. */
  inside(): [number, number][];
  art(level: number, color: number, tilt: number): PixelArt;
  /** The sprites it has shown, by level, color and tilt (shared by every vessel of the kind), and how many pixels are inside it. */
  looks: Map<string, PixelArt>;
  cells: number;
}

const BUCKET: VesselSpec = {
  rim: 7.5,
  floor: -12.5,
  innerHalf: (y) => Math.min(8, 6 + ((y + 12.5) * 2) / 18),
  lip: 8.5,
  aspect: 0.7,
  inside: bucketInside,
  art: bucketArt,
  looks: new Map(),
  cells: 0,
};

const DRUM: VesselSpec = {
  rim: 13,
  floor: -11,
  innerHalf: () => 7,
  lip: 8,
  aspect: 0.58,
  inside: drumInside,
  art: drumArt,
  looks: new Map(),
  cells: 0,
};

/** Mass of what's in it, per square meter (as drawn): as the sea's water (see Water), so one swamped sinks. */
const LIQUID_DENSITY = 85;
/** The liquid inside is redrawn for this many tilts of it. */
const TILTS = 32;
/** Seconds between effects on whatever is dipped in it. */
const DIP = 0.2;
/** How fast (its fill a second) one held under in the sea fills. */
const FLOOD = 1.5;

/**
 * The share of a vessel that stays in it when it's tipped over (`c`: the
 * cosine of the tilt; `aspect`, its width over its depth): the surface stays
 * level, so past where it reaches the rim, the rest pours out.
 */
function held(c: number, aspect: number): number {
  const a = Math.acos(Math.max(-1, Math.min(1, c)));
  // lying on its side, nothing stays in (a bucket's sides flare out toward the rim)
  const lying = Math.max(0, Math.min(1, (1.45 - a) / 0.25));
  if (lying <= 0) return 0;
  const r = aspect * Math.tan(a);
  return (r <= 1 ? 1 - r / 2 : 1 / (2 * r)) * lying;
}

/**
 * Something open at the top that holds liquid: what's poured into it (from a
 * flask, say, or water that flows in, or held under in the sea) fills it, the
 * colors mixing if there's more than one liquid; tipped over, it pours out over
 * the lower side of the rim. Whatever is dipped in it gets wet (water puts out
 * fires), oily or burnt by acid.
 */
export class Vessel extends Prop implements LiquidCatcher {
  /** Drops of each liquid in it (by Liquid kind; a drop is DROP px² of it). */
  readonly contents = [0, 0, 0, 0];
  /** Drops it holds to the brim. */
  readonly capacity: number;
  private pour = 0;
  private dipT = 0;
  /** What its sprite shows (see refresh()): empty, it keeps the one all empty ones share. */
  private shown = '0:0:0';
  /** Mass of the liquid it was last weighed with (kg). */
  private load = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions, private readonly spec: VesselSpec) {
    super(game, def, cfg, x, y, opts);
    spec.cells ||= spec.inside().length;
    this.capacity = spec.cells / DROP;
  }

  get total(): number {
    return this.contents[0] + this.contents[1] + this.contents[2] + this.contents[3];
  }

  /** How full it is (0..1; a little over while it brims). */
  get level(): number {
    return this.total / this.capacity;
  }

  catchDrop(liquid: Liquid, part: Part, x: number, y: number, amount = 1): boolean {
    if (part !== this.main) return false;
    // only drops that come in at the top: below the rim, between the walls
    const s = this.spec;
    const l = part.worldToLocal(x, y);
    const lx = l.x / PX;
    const ly = l.y / PX;
    if (ly > s.rim + 0.5 || ly < s.floor - 1 || Math.abs(lx) > s.innerHalf(ly) + 1) return false;
    this.contents[liquid] += amount;
    this.weigh();
    return true;
  }

  preStep(dt: number): void {
    const p = this.main;
    const up = p.localDir(0, 1);
    const under = this.flood(dt);
    const total = this.total;
    if (total <= 0) return;
    if (under) this.pour = 0;
    else this.spill(dt, total, up.y);
    this.dipT -= dt;
    if (this.dipT <= 0 && up.y > 0.6) {
      this.dipT = DIP;
      this.dip();
    }
  }

  /**
   * Held under in the sea (the middle of its rim below the surface), the sea
   * pours in till it's full, and nothing pours out of it, however it's turned:
   * returns whether it's under.
   */
  private flood(dt: number): boolean {
    if (!this.game.map.water) return false;
    const rim = this.main.localToWorld(0, this.spec.rim * PX);
    const sea = this.game.water.levelAt(rim.x);
    if (sea === null || sea < rim.y + 0.03) return false;
    const room = this.capacity - this.total;
    if (room > 0) {
      this.contents[Liquid.Water] += Math.min(room, this.capacity * FLOOD * dt);
      this.weigh();
    }
    return true;
  }

  /** Tipped too far for what's in it, it pours out over the lower side of the rim. */
  private spill(dt: number, total: number, cos: number): void {
    const over = total / this.capacity - held(cos, this.spec.aspect);
    if (over <= 0) {
      this.pour = 0;
      return;
    }
    const p = this.main;
    // faster the further past holding it, a full one upturned emptying in about a second
    const rate = Math.min(1.5, 0.1 + over * 2.5);
    this.pour += dt * this.capacity * rate;
    const n = Math.min(Math.floor(this.pour), Math.ceil(total));
    if (n <= 0) return;
    this.pour -= n;
    const s = this.spec;
    const l = p.localToWorld(-s.lip * PX, s.rim * PX);
    const r = p.localToWorld(s.lip * PX, s.rim * PX);
    const side = r.y < l.y ? 1 : -1;
    const lip = side > 0 ? r : l;
    const out = p.localDir(side, 0.2);
    this.game.sound.hold(this, 'liquid/pour_loop', Math.min(0.45, 0.12 + rate * 0.3), lip.x, 0.75 + rate * 0.2);
    for (let k = 0; k < n; k++) {
      const kind = this.pick();
      if (kind < 0) break;
      this.contents[kind] = Math.max(0, this.contents[kind] - 1);
      this.game.particles.liquid(kind as Liquid, lip.x, lip.y, out.x, out.y - 0.3, 1, 0.5 + rate * 0.5, 0.35, p.body);
    }
    this.weigh();
  }

  /** One of the liquids in it, by how much there is of each (-1 if none). */
  private pick(): number {
    let r = Math.random() * this.total;
    for (let k = 0; k < 4; k++) {
      if (this.contents[k] <= 0) continue;
      r -= this.contents[k];
      if (r <= 0) return k;
    }
    for (let k = 3; k >= 0; k--) if (this.contents[k] > 0) return k;
    return -1;
  }

  /** Whatever is in it below the surface: water soaks it (and puts out fire), oil soaks in, acid burns. */
  private dip(): void {
    const g = this.game;
    const p = this.main;
    const s = this.spec;
    const depth = Math.min(1, this.level) * (s.rim - s.floor);
    if (depth < 1) return;
    let most = 0;
    for (let k = 1; k < 4; k++) if (this.contents[k] > this.contents[most]) most = k;
    const c = p.localToWorld(0, (s.floor + depth / 2) * PX);
    const found: Part[] = [];
    g.physics.world.intersectionsWithShape(c, p.body.rotation(), new RAPIER.Cuboid(s.innerHalf(s.floor + depth / 2) * PX, (depth / 2) * PX), (col) => {
      const q = g.physics.partOf(col);
      if (q && q !== p && !q.destroyed && !found.includes(q)) found.push(q);
      return true;
    });
    for (const q of found) {
      if (most === Liquid.Water) {
        g.fire.douse(q, 0.3);
        q.oil = Math.max(0, q.oil - 0.05);
      } else if (most === Liquid.Oil) {
        q.oil = Math.min(1, q.oil + 0.05);
      } else if (most === Liquid.Acid) {
        q.entity.damage(q, 0.5, 'acid', { x: q.x, y: q.y }, { x: 0, y: -1 });
      }
    }
  }

  /** Weighs it down with what it holds (only when that has changed by a fair bit). */
  private weigh(): void {
    const m = this.total * DROP * PX * PX * LIQUID_DENSITY;
    if (Math.abs(m - this.load) < 0.25 && (m > 0 || this.load === 0)) return;
    this.load = m;
    // the liquid's middle, about halfway up what it fills
    const s = this.spec;
    const f = Math.min(1, this.level);
    const depth = f * (s.rim - s.floor) * PX;
    const w = 2 * s.innerHalf(s.floor + (s.rim - s.floor) * f * 0.5) * PX;
    this.main.body.setAdditionalMassProperties(m, { x: 0, y: s.floor * PX + depth / 2 }, (m * (w * w + depth * depth)) / 12, false);
  }

  frame(): void {
    this.refresh();
  }

  /** What's in it looks like: the liquids' colors, mixed by how much there is of each (in eighths). */
  private color(): number {
    const t = this.total;
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    let most = 0;
    for (let k = 0; k < 4; k++) {
      if (this.contents[k] > this.contents[most]) most = k;
      const s = Math.round((this.contents[k] / t) * 8);
      if (!s) continue;
      const c = LIQUID_COLORS[k][0];
      r += ((c >> 16) & 255) * s;
      g += ((c >> 8) & 255) * s;
      b += (c & 255) * s;
      w += s;
    }
    return w ? fromRgb(r / w, g / w, b / w) : LIQUID_COLORS[most][0];
  }

  private refresh(): void {
    if (this.destroyed) return;
    // the art shows the level in whole pixels of the inside, settled to whichever side is down
    const { looks, cells } = this.spec;
    const n = Math.min(cells, Math.round(this.total * DROP));
    const turn = (this.main.a * this.main.flip) / (Math.PI * 2);
    const tilt = n > 0 ? ((Math.round(turn * TILTS) % TILTS) + TILTS) % TILTS : 0;
    const color = n > 0 ? this.color() : 0;
    const key = `${n}:${color}:${tilt}`;
    if (key === this.shown) return;
    this.shown = key;
    let art = looks.get(key);
    if (!art) {
      if (looks.size > 400) looks.clear();
      looks.set(key, (art = this.spec.art(n / cells, color, (tilt * Math.PI * 2) / TILTS)));
    }
    this.main.setArt(art);
  }

  contextActions(): ContextAction[] {
    return [{ label: `${Math.round(Math.min(1, this.level) * 100)}% full`, action: () => {} }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { contents: this.contents.slice() };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (Array.isArray(x.contents)) {
      for (let k = 0; k < 4; k++) this.contents[k] = Math.max(0, Number(x.contents[k]) || 0);
    }
    this.weigh();
    this.refresh();
  }
}

/** A metal bucket (see Vessel). */
export class Bucket extends Vessel {
  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts, BUCKET);
  }
}

/** A steel drum with its lid off (the barrel; see Vessel): a deeper bucket, straight-sided. */
export class Barrel extends Vessel {
  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts, DRUM);
  }
}

import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { fromRgb, type PixelArt } from '../art/PixelArt';
import { bucketArt, bucketInside } from '../art/props';
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

/** The inside, in the same pixels: from the rim down to its floor, innerHalf() either side of the middle. */
const RIM = 7.5;
const FLOOR = -12.5;
function innerHalf(y: number): number {
  return Math.min(8, 6 + ((y - FLOOR) * 2) / 18);
}
/** Its width over its depth (inside), for how much stays in it tipped over (see held()). */
const ASPECT = 0.7;
/** Mass of what's in it, per square meter (as drawn). */
const LIQUID_DENSITY = 40;
/** The liquid inside is redrawn for this many tilts of the bucket. */
const TILTS = 32;
/** Seconds between effects on whatever is dipped in it. */
const DIP = 0.2;

/** The sprites it has shown, by level, color and tilt (shared by every bucket). */
const looks = new Map<string, PixelArt>();
let insideCells = 0;

/**
 * The share of a bucket that stays in it when it's tipped over (`c`: the
 * cosine of the tilt): the surface stays level, so past where it reaches the
 * rim, the rest pours out.
 */
function held(c: number): number {
  const a = Math.acos(Math.max(-1, Math.min(1, c)));
  // its sides flare out toward the rim: lying on one, nothing stays in
  const lying = Math.max(0, Math.min(1, (1.45 - a) / 0.25));
  if (lying <= 0) return 0;
  const r = ASPECT * Math.tan(a);
  return (r <= 1 ? 1 - r / 2 : 1 / (2 * r)) * lying;
}

/**
 * A metal bucket that holds liquid: what's poured into its open top (from a
 * flask, say) fills it, the colors mixing if there's more than one liquid;
 * tipped over, it pours out over the lower side of the rim. Whatever is dipped
 * in it gets wet (water puts out fires), oily or burnt by acid.
 */
export class Bucket extends Prop implements LiquidCatcher {
  /** Drops of each liquid in it (by Liquid kind; a drop is DROP px² of it). */
  readonly contents = [0, 0, 0, 0];
  /** Drops it holds to the brim. */
  readonly capacity: number;
  private pour = 0;
  private dipT = 0;
  /** What its sprite shows (see refresh()): empty, it keeps the one all empty buckets share. */
  private shown = '0:0:0';
  /** Mass of the liquid it was last weighed with (kg). */
  private load = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    insideCells ||= bucketInside().length;
    this.capacity = insideCells / DROP;
  }

  get total(): number {
    return this.contents[0] + this.contents[1] + this.contents[2] + this.contents[3];
  }

  /** How full it is (0..1; a little over while it brims). */
  get level(): number {
    return this.total / this.capacity;
  }

  catchDrop(liquid: Liquid, part: Part, x: number, y: number): boolean {
    if (part !== this.main) return false;
    // only drops that come in at the top: below the rim, between the walls
    const l = part.worldToLocal(x, y);
    const lx = l.x / PX;
    const ly = l.y / PX;
    if (ly > RIM + 0.5 || ly < FLOOR - 1 || Math.abs(lx) > innerHalf(ly) + 1) return false;
    this.contents[liquid] += 1;
    this.weigh();
    return true;
  }

  preStep(dt: number): void {
    const total = this.total;
    if (total <= 0) return;
    const p = this.main;
    const up = p.localDir(0, 1);
    this.spill(dt, total, up.y);
    this.dipT -= dt;
    if (this.dipT <= 0 && up.y > 0.6) {
      this.dipT = DIP;
      this.dip();
    }
  }

  /** Tipped too far for what's in it, it pours out over the lower side of the rim. */
  private spill(dt: number, total: number, cos: number): void {
    const over = total / this.capacity - held(cos);
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
    const l = p.localToWorld(-8.5 * PX, RIM * PX);
    const r = p.localToWorld(8.5 * PX, RIM * PX);
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
    const depth = Math.min(1, this.level) * (RIM - FLOOR);
    if (depth < 1) return;
    let most = 0;
    for (let k = 1; k < 4; k++) if (this.contents[k] > this.contents[most]) most = k;
    const c = p.localToWorld(0, (FLOOR + depth / 2) * PX);
    const found: Part[] = [];
    g.physics.world.intersectionsWithShape(c, p.body.rotation(), new RAPIER.Cuboid(innerHalf(FLOOR + depth / 2) * PX, (depth / 2) * PX), (col) => {
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
    const f = Math.min(1, this.level);
    const depth = f * (RIM - FLOOR) * PX;
    const w = 14 * PX;
    this.main.body.setAdditionalMassProperties(m, { x: 0, y: FLOOR * PX + depth / 2 }, (m * (w * w + depth * depth)) / 12, false);
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
    const n = Math.min(insideCells, Math.round(this.total * DROP));
    const turn = (this.main.a * this.main.flip) / (Math.PI * 2);
    const tilt = n > 0 ? ((Math.round(turn * TILTS) % TILTS) + TILTS) % TILTS : 0;
    const color = n > 0 ? this.color() : 0;
    const key = `${n}:${color}:${tilt}`;
    if (key === this.shown) return;
    this.shown = key;
    let art = looks.get(key);
    if (!art) {
      if (looks.size > 400) looks.clear();
      looks.set(key, (art = bucketArt(n / insideCells, color, (tilt * Math.PI * 2) / TILTS)));
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

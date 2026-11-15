import { Prop, type PropConfig } from './Prop';
import { PixelArt, CLEAR } from '../art/PixelArt';
import { MAT, GLASS, ELECTRONICS, type PhysMaterial } from '../world/Materials';
import { clamp } from '../engine/math';
import { PX } from '../engine/constants';
import { artOf, hullOf, pixelsConfig, readPixels, type PixelsConfig } from './Gore';
import type { Game } from '../world/Game';
import type { EntityConfig, EntityState, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import { instantiate } from '../world/Snapshot';

/** What a broken piece can be made of (by name in its config: a save keeps the name). */
export const DEBRIS_MATS: Record<string, PhysMaterial> = {
  metal: MAT.metal,
  sheetMetal: MAT.sheetMetal,
  wood: MAT.wood,
  stone: MAT.stone,
  concrete: MAT.concrete,
  plastic: MAT.plastic,
  rubber: MAT.rubber,
  glass: GLASS,
  electronics: ELECTRONICS,
  robot: MAT.robot,
};

/** The name of the material nearest `m` among DEBRIS_MATS (the same one, or one that sounds and burns alike). */
export function debrisMat(m: PhysMaterial): string {
  for (const k in DEBRIS_MATS) if (DEBRIS_MATS[k] === m) return k;
  for (const k in DEBRIS_MATS) if (DEBRIS_MATS[k].name === m.name) return k;
  switch (m.sound) {
    case 'wood':
      return 'wood';
    case 'glass':
      return 'glass';
    case 'stone':
      return m.density > 200 ? 'concrete' : 'stone';
    case 'plastic':
      return 'plastic';
    case 'rubber':
      return 'rubber';
    default:
      return m.density < 200 ? 'sheetMetal' : 'metal';
  }
}

/** A broken piece: its pixels, what it's made of, and what it broke off (one thing's pieces share it: see Repair). */
export interface DebrisConfig extends EntityConfig, PixelsConfig {
  mat: string;
  /** The break it came from (pieces of one thing share it), if known. */
  from?: number;
}

/** How brittle a piece's material must be to be crushed smaller under a weight (stone, glass: see Debris.onLoad()). */
const CRUSHED = 0.5;

/** The biggest piece kept whole (px a side): a tank's hull comes apart well within it. */
const MAX_SIDE = 192;

/** A config from a save, a paste or a guest, made safe (a scrap of steel if it isn't). */
export function readDebrisConfig(c: EntityConfig | undefined): DebrisConfig {
  const mat = typeof c?.mat === 'string' && c.mat in DEBRIS_MATS ? c.mat : 'metal';
  const from = typeof c?.from === 'number' && Number.isFinite(c.from) ? c.from : undefined;
  const px = readPixels(c, MAX_SIDE);
  if (px) return px === (c as unknown) ? (c as DebrisConfig) : { ...px, mat, ...(from !== undefined ? { from } : {}) };
  return debrisConfig(new PixelArt(3, 3).rect(0, 0, 3, 3, DEBRIS_MATS[mat].debrisColor), mat);
}

/** The config for a piece with these pixels (which mustn't change after). */
export function debrisConfig(art: PixelArt, mat: string, from?: number): DebrisConfig {
  return pixelsConfig(art, from === undefined ? { mat } : { mat, from }) as DebrisConfig;
}

/** The pieces about, oldest first, by game (see Game.debrisCap). */
const piecesIn = new WeakMap<Game, Debris[]>();

/**
 * A piece broken off something not alive (see systems/Structure): torn steel,
 * a splinter, a shard of glass, rubble, a scrap of circuit board. It's its own
 * pixels, made of what it was, so it clangs, burns, glows hot, floats or sinks
 * as that does, and breaks up again, smaller, if it's hit hard enough. Only so
 * many lie about (Settings > Graphics > Debris): past that the oldest go.
 */
export class Debris extends Prop {
  /**
   * What it broke off, as that stood (the biggest piece of a break keeps it: see
   * Structure.keep()): Repair on any piece of the break makes it again (see repair()).
   */
  orig: EntityState | null = null;

  /** The floating origin moved (see world/Origin): the whole it was, kept for Repair, moves too. */
  shifted(dx: number, dy: number): void {
    super.shifted(dx, dy);
    if (this.orig) this.orig = { ...this.orig, parts: this.orig.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
  }

  constructor(game: Game, def: ItemDef, cfg: DebrisConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, debrisProp(cfg), x, y, opts);
    this.config = cfg;
    let all = piecesIn.get(game);
    if (!all) piecesIn.set(game, (all = []));
    all.push(this);
    while (all.length > Math.max(1, game.debrisCap)) game.remove(all.shift()!);
  }

  protected onDestroy(): void {
    const all = piecesIn.get(this.game);
    const i = all ? all.indexOf(this) : -1;
    if (i >= 0) all!.splice(i, 1);
  }

  get matName(): string {
    return (this.config as DebrisConfig).mat;
  }

  /** The break it came from (pieces of one thing share it). */
  get from(): number | undefined {
    return (this.config as DebrisConfig).from;
  }

  /**
   * Knocked, a piece fares as what it's made of does (see Prop.knock()): a strip of steel
   * or a scrap of tyre dropped or flung doesn't break smaller; glass does. Before, the
   * hit points a piece is given counted every knock against them, and a car's scraps went
   * on breaking up as they landed till it was crumbs.
   */
  onImpact(info: ImpactInfo): void {
    if (this.main.mat === GLASS) super.onImpact(info);
    else this.knock(info);
  }

  /**
   * Under a weight only brittle stuff is crushed smaller (glass, stone, concrete: see
   * Prop.onLoad()); steel bends and rubber squashes, and a piece of either lying under the
   * wreck it came off stays one piece.
   */
  onLoad(part: Part, other: Part, force: number, point: V2, normal: V2): void {
    if (part.mat.brittle >= CRUSHED) super.onLoad(part, other, force, point, normal);
  }

  /** A piece burnt through goes to ash, however big (see Prop.damage()). */
  protected get burnsAway(): boolean {
    return true;
  }

  /** Broken again, its pieces are of the same break (see repair()). */
  protected breakApart(point?: V2): Debris[] {
    if (this.melted || this.burnt) return super.breakApart(point);
    return this.game.structure.fracture(this.main, { at: point, dir: this.breakDir, force: this.breakForce, from: this.from });
  }

  /** The pieces of its break still about (itself among them). */
  private kin(): Debris[] {
    const from = this.from;
    if (from === undefined) return [this];
    return (piecesIn.get(this.game) ?? []).filter((d) => !d.destroyed && d.from === from);
  }

  /** Something to make again: the piece of a break whose biggest piece is about (see repair()), or hurt itself. */
  get damaged(): boolean {
    return this.kin().some((d) => d.orig) || super.damaged;
  }

  /**
   * Repair: the pieces of its break gathered up and what they were made again, mended,
   * where they lie (by their weight, across; as high as it stood). Without the piece
   * that kept it (taken away), just this piece mended.
   */
  repair(): void {
    const all = this.kin();
    const s = all.find((d) => d.orig)?.orig;
    if (!s) {
      super.repair();
      return;
    }
    let m = 0;
    let cx = 0;
    for (const d of all) {
      m += d.main.mass;
      cx += d.main.x * d.main.mass;
    }
    const live = s.parts.filter((p) => p.hp !== -1);
    const sx = live.reduce((t, p) => t + p.x, 0) / Math.max(1, live.length);
    const [e] = instantiate(this.game, { entities: [s], connections: [] }, { dx: cx / Math.max(1e-6, m) - sx });
    if (!e) {
      super.repair();
      return;
    }
    for (const d of all) this.game.remove(d);
    e.repair();
    e.setVelocity(0, 0);
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const x = super.serializeExtra();
    return this.orig ? { ...x, orig: this.orig } : x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    const o = x.orig as EntityState | undefined;
    if (o && typeof o === 'object' && typeof o.def === 'string' && Array.isArray(o.parts) && o.parts.length && o.def !== 'debris') this.orig = o;
  }

  get label(): string {
    switch (this.matName) {
      case 'wood':
        return 'Splinter';
      case 'glass':
        return 'Glass shard';
      case 'stone':
      case 'concrete':
        return 'Rubble';
      case 'plastic':
        return 'Plastic shard';
      case 'rubber':
        return 'Rubber scrap';
      case 'electronics':
        return 'Circuitry';
      default:
        return 'Scrap metal';
    }
  }
}

/** How many pieces of a game are about now. */
export function debrisCount(game: Game): number {
  return piecesIn.get(game)?.length ?? 0;
}

function debrisProp(cfg: DebrisConfig): PropConfig {
  const art = artOf(cfg);
  const mat = DEBRIS_MATS[cfg.mat] ?? MAT.metal;
  let n = 0;
  for (let i = 0; i < art.px.length; i++) if (art.px[i] !== CLEAR) n++;
  const area = n * PX * PX;
  return {
    art: () => art,
    material: mat,
    // (a few corners: it tumbles to a stop, as a broken piece does, rather than rolling off like a wheel;
    // a tiny one, a shard or a chip, with six about as round as a pebble, rolled on and on)
    shapes: [hullOf(art, n < 40 ? 4 : 6)],
    ownTexture: true,
    // (small, quick bits: a thin shard mustn't tunnel through the floor)
    ccd: n < 400,
    angularDamping: 0.8,
    // as strong as what it was, for its size (glass and splinters give way soonest)
    hp: clamp(mat.strength * area * 4 * (1 - mat.brittle * 0.5), 3, 4000),
  };
}

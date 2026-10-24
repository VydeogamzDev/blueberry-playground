import { SIZE_LIMITS, type ItemDef, type Category, type EntityConfig } from '../world/types';
import { PixelArt } from '../art/PixelArt';
import { Prop, WOOD_HP, type PropConfig } from '../entities/Prop';
import { Shape, readShapeConfig } from '../entities/Shape';
import { Bacon } from '../entities/Bacon';
import { Gore, readGoreConfig } from '../entities/Gore';
import { baconArt } from '../art/bacon';
import { Bucket, BUCKET_SHAPES } from '../entities/Bucket';
import { MAT, GLASS } from '../world/Materials';
import * as A from '../art/props';
import { PX } from '../engine/constants';
import { clamp } from '../engine/math';

export const ITEMS: ItemDef[] = [];
const byId = new Map<string, ItemDef>();

export function register(def: ItemDef): ItemDef {
  ITEMS.push(def);
  byId.set(def.id, def);
  return def;
}

export function getItem(id: string): ItemDef | undefined {
  return byId.get(id);
}

/** Lazily builds and caches a sprite. */
export function lazyArt(fn: () => PixelArt): () => PixelArt {
  let cached: PixelArt | null = null;
  return () => (cached ??= fn());
}

export function previewOf(art: () => PixelArt): () => HTMLCanvasElement {
  let c: HTMLCanvasElement | null = null;
  return () => (c ??= art().toCanvas(1));
}

export { GLASS };

/** A config's size in sprite pixels (within the limits), if it gives one. */
export function sizeOf(c: EntityConfig | undefined): [number, number] | null {
  const w = Number(c?.w);
  const h = Number(c?.h);
  if (!(w > 0 && h > 0)) return null;
  return [clamp(Math.round(w), SIZE_LIMITS.min, SIZE_LIMITS.max), clamp(Math.round(h), SIZE_LIMITS.min, SIZE_LIMITS.max)];
}

/** A resizable prop: its art at any size, and what else changes with the size. */
interface Sized {
  art: (w: number, h: number) => PixelArt;
  cfg?: (w: number, h: number) => Partial<PropConfig>;
}

function prop(
  id: string, name: string, category: Category, description: string,
  art: () => PixelArt, cfg: Omit<PropConfig, 'art'>, tags: string[] = [], sized?: Sized,
): ItemDef {
  const a = lazyArt(art);
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(a),
    halfHeight: 0,
    resizable: !!sized,
    create: (game, x, y, opts) => {
      const size = sized ? sizeOf(opts.config) : null;
      if (!sized || !size) return new Prop(game, def, { ...cfg, art: a }, x, y, opts);
      const [w, h] = size;
      const big = sized.art(w, h);
      const e = new Prop(game, def, { ...cfg, ...sized.cfg?.(w, h), art: () => big, ownTexture: true }, x, y, opts);
      e.config = { w, h };
      return e;
    },
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (a().h * PX) / 2 });
  return register(def);
}

export function registerProps(): void {
  // wooden things break: about three hard slams into the floor (10 m/s), or more long falls
  prop('crate', 'Wooden Crate', 'Objects', 'A sturdy wooden crate. Burns, and breaks if knocked about hard enough.', A.crateArt, { material: MAT.wood, hpPerKg: WOOD_HP }, ['box', 'wood'], { art: A.crateArt });
  prop('metal-box', 'Metal Box', 'Objects', 'A heavy steel box.', A.metalBoxArt, { material: MAT.metal, density: 190 }, ['crate', 'steel'], { art: A.metalBoxArt });
  prop('barrel', 'Barrel', 'Objects', 'An empty steel drum.', () => A.barrelArt(false), {
    material: MAT.sheetMetal, shapes: [{ kind: 'box', w: 18, h: 26, r: 1.5 }],
  }, ['drum', 'oil']);
  prop('chair', 'Chair', 'Objects', 'A simple wooden chair.', A.chairArt, {
    material: MAT.wood,
    hpPerKg: WOOD_HP,
    shapes: [
      { kind: 'box', w: 3, h: 14, x: -6.5, y: 6, r: 0.5 },
      { kind: 'box', w: 16, h: 3, x: 0, y: -1.5, r: 0.5 },
      { kind: 'box', w: 3, h: 10, x: -6.5, y: -8, r: 0.5 },
      { kind: 'box', w: 3, h: 10, x: 6.5, y: -8, r: 0.5 },
    ],
  }, ['seat', 'furniture']);
  prop('table', 'Table', 'Objects', 'A wooden table.', A.tableArt, {
    material: MAT.wood,
    hpPerKg: WOOD_HP,
    shapes: [
      { kind: 'box', w: 48, h: 5, x: 0, y: 8, r: 0.5 },
      { kind: 'box', w: 3, h: 16, x: -19.5, y: -2.5, r: 0.5 },
      { kind: 'box', w: 3, h: 16, x: 19.5, y: -2.5, r: 0.5 },
    ],
  }, ['desk', 'furniture']);
  prop('brick', 'Brick', 'Objects', 'A clay brick. Make it bigger for a stretch of wall.', A.brickArt, { material: MAT.stone, ccd: true }, ['stone', 'wall'], { art: A.brickArt });
  prop('concrete-block', 'Concrete Block', 'Objects', 'A heavy cinder block.', A.concreteBlockArt, { material: MAT.concrete }, ['cinder', 'stone', 'slab'], { art: A.concreteBlockArt });
  prop('beam', 'Metal Beam', 'Objects', 'A long steel I-beam. Great for building.', () => A.beamArt(96), {
    material: MAT.metal, density: 170,
  }, ['girder', 'steel', 'bar'], { art: A.beamArt });
  prop('short-beam', 'Short Beam', 'Objects', 'A short steel beam.', () => A.beamArt(48), { material: MAT.metal, density: 170 }, ['girder'], { art: A.beamArt });
  prop('plank', 'Wooden Plank', 'Objects', 'A long wooden plank.', () => A.plankArt(64), { material: MAT.wood, hpPerKg: WOOD_HP }, ['board', 'wood'], { art: A.plankArt });
  prop('tire', 'Tire', 'Objects', 'A bouncy rubber tire.', A.tireArt, {
    material: MAT.rubber, shapes: [{ kind: 'ball', r: 11 }], angularDamping: 0.05,
  }, ['wheel', 'rubber']);
  prop('ball', 'Rubber Ball', 'Objects', 'A bouncy ball.', A.ballArt, {
    material: MAT.rubber, shapes: [{ kind: 'ball', r: 6 }], restitution: 0.8, angularDamping: 0.05,
  }, ['bounce']);
  // a container: liquid poured in fills it, tipped over it pours out (see entities/Bucket)
  const bucketArt = lazyArt(() => A.bucketArt());
  const bucket: ItemDef = register({
    id: 'bucket', name: 'Bucket', category: 'Objects', tags: ['pail', 'container', 'water'],
    description: 'A metal bucket. Pour liquid in from a flask to fill it; tip it over to pour it out.',
    preview: previewOf(bucketArt), halfHeight: 0,
    create: (game, x, y, opts) => new Bucket(game, bucket, { art: bucketArt, material: MAT.sheetMetal, density: 22, shapes: BUCKET_SHAPES }, x, y, opts),
  });
  Object.defineProperty(bucket, 'halfHeight', { get: () => (bucketArt().h * PX) / 2 });
  prop('glass', 'Glass Pane', 'Objects', 'A fragile pane of glass. Shatters.', A.glassPaneArt, { material: GLASS, hp: 6 }, ['window'], {
    art: A.glassPaneArt,
    // as strong as panes of the same glass would be
    cfg: (w, h) => ({ hp: 6 * clamp((w * h) / 160, 0.5, 8) }),
  });
  const bacon: ItemDef = register({
    id: 'bacon', name: 'Bacon', category: 'Objects', tags: ['food', 'meat', 'pork', 'strip', 'pig'],
    description: 'A floppy strip of crispy bacon. Burns like meat. What a pig turns into when something big goes off next to it.',
    preview: previewOf(lazyArt(baconArt)), halfHeight: (6 * PX) / 2,
    create: (game, x, y, opts) => new Bacon(game, bacon, x, y, opts),
  });
  // torn off a body by a heavy round or a blast (see systems/Chunks; not in the toybox)
  const goreArt = lazyArt(() => new PixelArt(5, 4).rect(0, 0, 5, 4, 0x8e1a1a).rect(1, 1, 3, 2, 0x6e0c0c).set(2, 1, 0xe6dcc8));
  const gore: ItemDef = register({
    id: 'gore', name: 'Gore', category: 'Objects', description: 'A piece torn off a body.', tags: ['flesh', 'meat', 'chunk', 'gib'],
    preview: previewOf(goreArt), hidden: true,
    create: (game, x, y, opts) => new Gore(game, gore, readGoreConfig(opts.config), x, y, opts),
  });
  // drawn with the Shape tool (not in the toybox)
  const shapeArt = lazyArt(() => A.materialArt(new PixelArt(16, 16).rect(0, 0, 16, 16, 0), 'wood'));
  const shape: ItemDef = register({
    id: 'shape', name: 'Shape', category: 'Objects', description: 'Drawn with the Shape tool.', tags: ['custom', 'drawn'],
    preview: previewOf(shapeArt), hidden: true, resizable: true,
    create: (game, x, y, opts) => new Shape(game, shape, readShapeConfig(opts.config), x, y, opts),
  });
}

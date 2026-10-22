import type { ItemDef, Category } from '../world/types';
import type { PixelArt } from '../art/PixelArt';
import { Prop, type PropConfig } from '../entities/Prop';
import { MAT, type PhysMaterial } from '../world/Materials';
import * as A from '../art/props';
import { PX } from '../engine/constants';

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

export const GLASS: PhysMaterial = {
  ...MAT.plastic, name: 'Glass', density: 160, sound: 'glass', restitution: 0.1, bulletResistance: 300, flammability: 0, debrisColor: 0xa9d0dc,
};

function prop(
  id: string, name: string, category: Category, description: string,
  art: () => PixelArt, cfg: Omit<PropConfig, 'art'>, tags: string[] = [],
): ItemDef {
  const a = lazyArt(art);
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(a),
    halfHeight: 0,
    create: (game, x, y, opts) => new Prop(game, def, { ...cfg, art: a }, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (a().h * PX) / 2 });
  return register(def);
}

export function registerProps(): void {
  prop('crate', 'Wooden Crate', 'Objects', 'A sturdy wooden crate. Burns.', A.crateArt, { material: MAT.wood }, ['box', 'wood']);
  prop('metal-box', 'Metal Box', 'Objects', 'A heavy steel box.', A.metalBoxArt, { material: MAT.metal, density: 190 }, ['crate', 'steel']);
  prop('barrel', 'Barrel', 'Objects', 'An empty steel drum.', () => A.barrelArt(false), {
    material: MAT.sheetMetal, shapes: [{ kind: 'box', w: 18, h: 26, r: 1.5 }],
  }, ['drum', 'oil']);
  prop('chair', 'Chair', 'Objects', 'A simple wooden chair.', A.chairArt, {
    material: MAT.wood,
    shapes: [
      { kind: 'box', w: 3, h: 14, x: -6.5, y: 6, r: 0.5 },
      { kind: 'box', w: 16, h: 3, x: 0, y: -1.5, r: 0.5 },
      { kind: 'box', w: 3, h: 10, x: -6.5, y: -8, r: 0.5 },
      { kind: 'box', w: 3, h: 10, x: 6.5, y: -8, r: 0.5 },
    ],
  }, ['seat', 'furniture']);
  prop('table', 'Table', 'Objects', 'A wooden table.', A.tableArt, {
    material: MAT.wood,
    shapes: [
      { kind: 'box', w: 48, h: 5, x: 0, y: 8, r: 0.5 },
      { kind: 'box', w: 3, h: 16, x: -19.5, y: -2.5, r: 0.5 },
      { kind: 'box', w: 3, h: 16, x: 19.5, y: -2.5, r: 0.5 },
    ],
  }, ['desk', 'furniture']);
  prop('brick', 'Brick', 'Objects', 'A clay brick.', A.brickArt, { material: MAT.stone, ccd: true }, ['stone']);
  prop('concrete-block', 'Concrete Block', 'Objects', 'A heavy cinder block.', A.concreteBlockArt, { material: MAT.concrete }, ['cinder', 'stone']);
  prop('beam', 'Metal Beam', 'Objects', 'A long steel I-beam. Great for building.', () => A.beamArt(96), {
    material: MAT.metal, density: 170,
  }, ['girder', 'steel', 'bar']);
  prop('short-beam', 'Short Beam', 'Objects', 'A short steel beam.', () => A.beamArt(48), { material: MAT.metal, density: 170 }, ['girder']);
  prop('plank', 'Wooden Plank', 'Objects', 'A long wooden plank.', () => A.plankArt(64), { material: MAT.wood }, ['board', 'wood']);
  prop('tire', 'Tire', 'Objects', 'A bouncy rubber tire.', A.tireArt, {
    material: MAT.rubber, shapes: [{ kind: 'ball', r: 11 }], angularDamping: 0.05,
  }, ['wheel', 'rubber']);
  prop('ball', 'Rubber Ball', 'Objects', 'A bouncy ball.', A.ballArt, {
    material: MAT.rubber, shapes: [{ kind: 'ball', r: 6 }], restitution: 0.8, angularDamping: 0.05,
  }, ['bounce']);
  prop('bucket', 'Bucket', 'Objects', 'A metal bucket.', A.bucketArt, {
    material: MAT.sheetMetal, density: 80, shapes: [{ kind: 'poly', pts: [[-7, 7], [7, 7], [5, -7], [-5, -7]] }],
  }, ['pail']);
  prop('glass', 'Glass Pane', 'Objects', 'A fragile pane of glass. Shatters.', A.glassPaneArt, { material: GLASS, hp: 6 }, ['window']);
}

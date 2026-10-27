import { register, lazyArt, previewOf, prop, sizeOf, GLASS } from './items';
import { MAT } from '../world/Materials';
import { PX } from '../engine/constants';
import { clamp } from '../engine/math';
import * as F from '../art/floats';
import { BALLOON_RAMPS, type BalloonColor } from '../art/gear';
import { artRect, densityFor } from '../entities/Item';
import { Prop } from '../entities/Prop';
import { WaterBlock, Tap } from '../entities/WaterGear';
import { JetEngine, JET_FORCE } from '../entities/JetEngine';
import { Balloon, type BalloonKind } from '../entities/Balloon';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Category, ItemDef, SpawnOptions } from '../world/types';

// Water and what goes with it, things that float or fly, and the jet engine.
// Registered last (see registry.ts), so each comes last in its toybox category.

function item(
  id: string, name: string, category: Category, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[],
): ItemDef {
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/** Box shapes from art-pixel rects [x, y, w, h]. */
function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

/** A glass tank's walls at its size (px): its sides and its bottom, open at the top. */
function tankShapes(w: number, h: number): ShapeSpec[] {
  const t = F.TANK_WALL;
  return [
    { kind: 'box', w: t, h, x: -w / 2 + t / 2 },
    { kind: 'box', w: t, h, x: w / 2 - t / 2 },
    { kind: 'box', w, h: t, y: -h / 2 + t / 2 },
  ];
}

export function registerFloats(): void {
  // a block of water, at any size: it's water as soon as time runs (see entities/WaterGear)
  const water = lazyArt(() => F.waterArt());
  const waterDef: ItemDef = register({
    id: 'water', name: 'Water', category: 'Objects', tags: ['liquid', 'pool', 'swim', 'sea', 'fluid', 'wet'],
    description: 'A block of water, any size you like: as soon as time runs it falls, splashes and spreads, fills what it lands in and finds its level. Light things float in it and heavy ones sink; it puts out fires. Make it bigger with its handles.',
    preview: previewOf(water), halfHeight: 0, resizable: true,
    create: (game, x, y, opts) => {
      const size = sizeOf(opts.config);
      const art = size ? F.waterArt(size[0], size[1]) : water();
      const e = new WaterBlock(game, waterDef, { art: () => art, material: MAT.plastic, density: 85, ownTexture: !!size }, x, y, opts);
      if (size) e.config = { w: size[0], h: size[1] };
      return e;
    },
  });
  Object.defineProperty(waterDef, 'halfHeight', { get: () => (water().h * PX) / 2 });
  prop('glass-tank', 'Glass Tank', 'Objects',
    'A glass tank, open at the top: fill it with water (put Water in it, or run a tap into it) and see what floats. Any size. Glass: knock it hard or shoot it and it shatters, and out comes the water.',
    () => F.glassTankArt(), { material: GLASS, shapes: tankShapes(64, 40), density: 60, hp: 30 }, ['aquarium', 'fish tank', 'pool', 'container', 'water', 'glass'], {
      art: F.glassTankArt,
      cfg: (w, h) => ({ shapes: tankShapes(w, h), hp: 30 * clamp((w + h) / 104, 0.5, 4) }),
    });
  const tap = lazyArt(() => F.tapArt(false));
  const tapOpen = lazyArt(() => F.tapArt(true));
  item('tap', 'Water Tap', 'Machinery',
    'Water runs from its spout while it is on (activate it) or powered. Weld it up somewhere by its flange, over a tank or a bucket. Set its flow in its menu.',
    tap, (game, def, x, y, opts) => {
      const shapes = rects(F.TAP_W, F.TAP_H, [[0, 1, 2, 7], [2, 3, 9, 3], [8, 5, 3, 4]]);
      return new Tap(game, def, { art: tap, material: MAT.metal, shapes, density: densityFor(1.5, shapes) }, tapOpen, x, y, opts);
    }, ['faucet', 'water', 'pipe', 'fill', 'spout']);
  const tube = lazyArt(F.tubeArt);
  item('buoyancy-tube', 'Buoyancy Tube', 'Objects',
    'An inflatable float. Weld or tie it to something and it keeps it afloat: one holds about 100 kg up in water. Rubber: it bursts if shot or cut.',
    tube, (game, def, x, y, opts) => {
      const shapes: ShapeSpec[] = [{ kind: 'box', w: F.TUBE_W, h: F.TUBE_H - 1, y: -0.5, r: 4 }];
      const e = new Prop(game, def, { art: tube, material: MAT.rubber, shapes, density: densityFor(2, shapes), hp: 8, restitution: 0.4 }, x, y, opts);
      // (it's mostly air: the water holds it up five times as hard as its size alone would)
      e.main.buoyancy = 5;
      return e;
    }, ['float', 'pontoon', 'life', 'swim', 'raft', 'boat', 'buoy', 'inflatable']);
  const bigArts = Object.fromEntries(
    (Object.keys(BALLOON_RAMPS) as BalloonColor[]).map((c) => [c, lazyArt(() => F.bigBalloonArt(BALLOON_RAMPS[c]))]),
  ) as Record<BalloonColor, () => PixelArt>;
  const big: BalloonKind = {
    lift: 100, drag: 200, top: [12, 2], middle: [12, 13], knot: F.BIG_BALLOON_KNOT, bang: 1.6, shreds: 22, art: (c) => bigArts[c](),
  };
  const bigShapes: ShapeSpec[] = [{ kind: 'ball', r: 12, x: 0, y: F.BIG_BALLOON_H / 2 - 13.5 }];
  item('big-balloon', 'Big Balloon', 'Objects',
    'A great big balloon: one lifts a person off the ground, a handful lift a car. Tie it on with a rope to its knot, weld its knot to something, or use Tie to what’s below in its menu. It bursts at bullets, blades, fire and hard knocks.',
    bigArts.red, (game, def, x, y, opts) =>
      new Balloon(game, def, { art: bigArts.red, material: MAT.rubber, shapes: bigShapes, density: densityFor(5, bigShapes), restitution: 0.3, angularDamping: 4 }, x, y, opts, big),
    ['float', 'lift', 'helium', 'fly', 'weather', 'pop', 'air']);
  const jet = lazyArt(() => F.jetEngineArt(0));
  item('jet-engine', 'Jet Engine', 'Machinery',
    `Activate (or power) it and it spools up to a mighty push toward its intake: ${JET_FORCE} N, enough to fly a car. Its exhaust blows things far away and sets them alight; its intake sucks things in and tears them up. Weld it to something to fly it. Set its throttle in its menu. Crashed hard, it breaks, and its fuel goes up if it was running.`,
    jet, (game, def, x, y, opts) => {
      const shapes = rects(F.JET_W, F.JET_H, [[5, 1, 39, 16], [0, 4, 6, 10]]);
      return new JetEngine(game, def, { art: jet, material: MAT.metal, shapes, density: densityFor(80, shapes), angularDamping: 0.3, hp: 400 }, x, y, opts);
    }, ['jet', 'turbine', 'plane', 'aircraft', 'engine', 'thrust', 'rocket', 'fly']);
}

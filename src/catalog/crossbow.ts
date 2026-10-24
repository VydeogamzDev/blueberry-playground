import { register, lazyArt, previewOf } from './items';
import { MAT } from '../world/Materials';
import { PX } from '../engine/constants';
import * as C from '../art/crossbow';
import { artRect, densityFor, type HoldSpec } from '../entities/Item';
import { Crossbow, Bolt, BOLT_DAMAGE, BOLT_SPEED, COCK_TIME, type BoltKind } from '../entities/Crossbow';
import type { GunSpec } from '../entities/Firearm';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions } from '../world/types';

// The crossbow (with the firearms) and its bolts, one of each kind, which load
// it when dropped on it; registered from weapons.ts in catalog order.

function item(
  id: string, name: string, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[],
): ItemDef {
  const def: ItemDef = {
    id, name, category: 'Weapons', description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/**
 * The crossbow as a gun: what Edit gun… shows (the bolt's power, the cocking
 * time as the time between shots; see Crossbow), the bolt's speed off the
 * string and a little spread. No flash, no bullets: the bolt flies as a thing
 * of its own, with its own sounds.
 */
const CROSSBOW_GUN: GunSpec = {
  sound: 'pistol', muzzle: [31, 6], auto: false, rate: 1 / COCK_TIME, speed: BOLT_SPEED, energy: 0, damage: BOLT_DAMAGE, spread: 0.004, recoil: 0.6, flash: 0,
};
/** The trigger hand on the pistol grip, the other under the tiller: the butt against the shoulder. */
const CROSSBOW_HOLD: HoldSpec = { grip: [13, 11], grip2: [22, 9] };

const BOLT_ITEMS: { kind: BoltKind; name: string; desc: string; mass: number; tags: string[] }[] = [
  { kind: 'normal', name: 'Crossbow Bolt', desc: 'A crossbow bolt: it sinks into flesh and wood and stays in, and the wound bleeds. Drop it on a crossbow to load it with these.', mass: 0.07, tags: ['arrow', 'quarrel'] },
  { kind: 'poison', name: 'Poison Bolt', desc: 'A bolt with a poisoned head: whoever it sticks in is poisoned, as by a poison syringe. Drop it on a crossbow to load it with these.', mass: 0.07, tags: ['arrow', 'toxin', 'venom'] },
  { kind: 'explosive', name: 'Explosive Bolt', desc: 'A bolt with a small charge on its nose: it goes off on whatever it hits. Drop it on a crossbow to load it with these.', mass: 0.12, tags: ['arrow', 'bomb', 'blast'] },
  { kind: 'incendiary', name: 'Incendiary Bolt', desc: 'A bolt with fuel-soaked wrapping, lit as it is shot: it sets alight whatever it sticks in. Drop it on a crossbow to load it with these.', mass: 0.09, tags: ['arrow', 'fire', 'flaming'] },
  { kind: 'tranquilizer', name: 'Tranquilizer Bolt', desc: 'A dart of sedative: it puts whoever it hits to sleep, hardly hurting them. Drop it on a crossbow to load it with these.', mass: 0.07, tags: ['arrow', 'dart', 'sedative', 'sleep'] },
];

export function registerCrossbow(): void {
  // (filled in below: the crossbow is listed first, its bolts after it)
  const bolts = {} as Record<BoltKind, ItemDef>;
  const art = lazyArt(() => C.crossbowArt(2, 'normal'));
  const shapes = [artRect(34, 15, 0, 6, 13, 6, 0.5), artRect(34, 15, 12, 7, 19, 3, 0.4), artRect(34, 15, 11, 10, 4, 4, 0.5), artRect(34, 15, 25, 0, 4, 15, 0.5)];
  item('crossbow', 'Crossbow',
    'Activate to shoot a bolt; then the string is drawn back and the next bolt laid in (a second or so). Pick the bolts in its menu: normal ones stick in and bleed, poisoned ones poison, explosive ones blow up, incendiary ones set things alight, and tranquilizer darts put people to sleep.',
    art, (game, def, x, y, opts) =>
      new Crossbow(game, def, { art, material: MAT.wood, shapes, density: densityFor(3.2, shapes), angularDamping: 0.3 }, CROSSBOW_HOLD, CROSSBOW_GUN, bolts, x, y, opts),
    ['bow', 'bolt', 'arrow', 'archery', 'quiet', 'poison', 'explosive', 'incendiary', 'tranquilizer']);
  const boltShapes: ShapeSpec[] = [artRect(C.BOLT_W, C.BOLT_H, 0, 0.5, C.BOLT_W, 2, 0.5)];
  for (const b of BOLT_ITEMS) {
    const boltArt = lazyArt(() => C.boltArt(b.kind));
    const density = densityFor(b.mass, boltShapes);
    bolts[b.kind] = item(`bolt-${b.kind}`, b.name, b.desc, boltArt, (game, def, x, y, opts) =>
      new Bolt(game, def, { art: boltArt, material: MAT.wood, shapes: boltShapes, density, angularDamping: 0.3, linearDamping: 0, ccd: true }, b.kind, x, y, opts),
    ['crossbow', 'bolt', ...b.tags]);
  }
}

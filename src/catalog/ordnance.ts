import { register, lazyArt, previewOf } from './items';
import { MAT, GLASS } from '../world/Materials';
import { PX } from '../engine/constants';
import * as O from '../art/ordnance';
import { artRect, densityFor, type HoldSpec } from '../entities/Item';
import { Molotov } from '../entities/Molotov';
import { RocketLauncher, Rocket } from '../entities/RPG';
import type { GunSpec } from '../entities/Firearm';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Category, ItemDef, SpawnOptions } from '../world/types';

// The molotov cocktail (with the explosives) and the RPG (with the firearms),
// with the rocket it fires; registered from weapons.ts in catalog order.

function item(
  id: string, name: string, category: Category, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[], hidden = false,
): ItemDef {
  const def: ItemDef = {
    id, name, category, description, tags, hidden,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/**
 * The RPG as a gun: what Edit gun… shows (recoil, the warhead's power, the
 * reload time as the time between shots; see RocketLauncher), the rocket's
 * speed out of the tube and the flash at the muzzle. There are no bullets: the
 * rocket flies as a thing of its own, with its own sounds.
 */
const RPG_GUN: GunSpec = {
  sound: 'shotgun', muzzle: [31, 4.5], auto: false, rate: 1 / 2.2, speed: 22, energy: 0, damage: 220, spread: 0, recoil: 5, flash: 0.4,
};
/** The trigger hand on the pistol grip, the other on the front grip: the back of the tube rests on the shoulder. */
const RPG_HOLD: HoldSpec = { grip: [19, 9], grip2: [26, 8] };

export function registerRpg(): void {
  const rocketArt = lazyArt(O.rocketArt);
  const rocketShapes: ShapeSpec[] = [{ kind: 'ball', r: 3, x: 4 }, { kind: 'box', w: 9, h: 3, x: -3.5, r: 0.5 }];
  const rocket = item('rpg-rocket', 'Rocket', 'Weapons', 'A rocket fired from an RPG.', rocketArt, (game, def, x, y, opts) =>
    new Rocket(game, def, rocketArt(), rocketShapes, densityFor(2.5, rocketShapes), x, y, opts), [], true);
  const art = lazyArt(() => O.rpgArt(true));
  const shapes = [artRect(39, 11, 0, 2, 32, 6, 0.4), artRect(39, 11, 18, 8, 3, 3, 0.4), artRect(39, 11, 26, 7, 2, 3, 0.4)];
  item('rpg', 'RPG', 'Weapons',
    'A shoulder-fired rocket launcher. Activate to fire: the rocket speeds up as its motor burns and blows up on the first thing it hits. Reloads in a couple of seconds. Mind the back-blast.',
    art, (game, def, x, y, opts) =>
      new RocketLauncher(game, def, { art, material: MAT.metal, shapes, density: densityFor(7, shapes), angularDamping: 0.3 }, RPG_HOLD, RPG_GUN, rocket, x, y, opts),
    ['rocket', 'launcher', 'bazooka', 'rpg-7', 'missile', 'anti-tank']);
}

export function registerMolotov(): void {
  const art = lazyArt(() => O.molotovArt());
  const shapes = [artRect(9, 21, 0, 11, 9, 10, 1), artRect(9, 21, 3, 3, 3, 8, 0.5)];
  item('molotov', 'Molotov Cocktail', 'Explosives',
    'A bottle of oil with a rag in its neck. Light the rag (activate) and throw it: it smashes on whatever it hits and splashes burning oil over it and the floor. Unlit, it only splashes oil. A bullet breaks it too; left alone, the lit rag burns down into the bottle.',
    art, (game, def, x, y, opts) =>
      new Molotov(game, def, { art, material: GLASS, shapes, density: densityFor(0.9, shapes), angularDamping: 0.25, ccd: true }, { grip: [4, 15] }, x, y, opts),
    ['molotov', 'cocktail', 'firebomb', 'incendiary', 'bottle', 'fire', 'throw']);
}

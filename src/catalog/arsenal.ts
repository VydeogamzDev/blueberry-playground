import { register, lazyArt, previewOf } from './items';
import { MAT } from '../world/Materials';
import { PX } from '../engine/constants';
import * as G from '../art/gear';
import { artRect, densityFor, type HoldSpec } from '../entities/Item';
import { Chainsaw } from '../entities/Chainsaw';
import { Flamethrower, Extinguisher } from '../entities/Sprayers';
import { StunGun } from '../entities/StunGun';
import { StickyGrenade, GrenadeLauncher, LauncherRound } from '../entities/Grenades';
import { BurstRifle, BattleRifle, MachineGun, DoubleBarrel, Flintlock } from '../entities/MoreGuns';
import { Firearm } from '../entities/Firearm';
import { Spear, PowerHammer } from '../entities/MeleeGear';
import { Flare, Firework } from '../entities/Pyro';
import { Balloon } from '../entities/Balloon';
import { Prop } from '../entities/Prop';
import * as A from '../art/arsenal';
import type { GunSpec } from '../entities/Firearm';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Category, ItemDef, SpawnOptions } from '../world/types';

// More weapons and gear: power tools, sprayers, guns, grenades, pyrotechnics
// and a few odd things. Registered after the rest (see registry.ts), so each
// comes last in its toybox category.

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

/** Box shapes from art-pixel rects [x, y, w, h]. */
function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

// ------------------------------------------------------------------ melee

/** The trigger hand on the rear handle, the other on the wrap handle over the engine. */
const SAW_HOLD: HoldSpec = { grip: [5, 5], grip2: [16, 0], angle: 0.15 };

function registerChainsaw(): void {
  const art = lazyArt(() => G.chainsawArt(0));
  const shapes = rects(G.SAW_W, G.SAW_H, [[0, 0, 24, 12], [24, 5, 20, 6]], 0.5);
  item('chainsaw', 'Chainsaw',
    'Melee',
    'Activate to start it (and again to stop it). Running, the chain cuts into whatever the bar touches: limbs come off, and what is sawn on is torn to bits; wood and plastic too. On metal and stone it sparks, kicks back and stalls. Wired to power, it runs while powered.',
    art, (game, def, x, y, opts) =>
      new Chainsaw(game, def, { art, material: MAT.metal, shapes, density: densityFor(6, shapes), angularDamping: 0.4 }, SAW_HOLD, x, y, opts),
    ['saw', 'chain', 'power tool', 'motor', 'cut', 'gore', 'lumberjack']);
}

/** The spear's point: it stabs and lodges as a knife does, deeper; both edges cut a little. */
const SPEAR_BLADE = { blade: [44, 53] as [number, number], tipLen: 5, edge: 'both' as const, sharpness: 0.8, stab: true, maxDepth: 0.35, grip: 380 };

function registerMeleeGear(): void {
  const spear = lazyArt(G.spearArt);
  const spearShapes = rects(G.SPEAR_W, G.SPEAR_H, [[0, 1.5, 44, 2], [44, 0.5, 10, 4]], 0.5);
  item('spear', 'Spear', 'Melee',
    'A long spear. Stab with it and the point sinks in and lodges; throw it (fling it) and it flies point first and sticks in what it hits.',
    spear, (game, def, x, y, opts) =>
      new Spear(game, def, { art: spear, material: MAT.wood, shapes: spearShapes, density: densityFor(2.2, spearShapes), angularDamping: 0.3, ccd: true }, { grip: [14, 2], grip2: [26, 2] }, SPEAR_BLADE, x, y, opts),
    ['blade', 'stab', 'throw', 'javelin', 'pike', 'lance', 'sharp']);
  const ph = lazyArt(() => G.powerHammerArt(true));
  const phShapes = rects(G.PHAMMER_W, G.PHAMMER_H, [[0, 4, 22, 4], [22, 1, 14, 10]], 0.5);
  item('power-hammer', 'Power Hammer', 'Melee',
    'A heavy hammer with an air-driven piston in its head: when the head hits something hard enough (or on activate, while it touches something) the piston fires with a huge blow that throws even heavy things. Then it recharges its air.',
    ph, (game, def, x, y, opts) =>
      new PowerHammer(game, def, { art: ph, material: MAT.metal, shapes: phShapes, density: densityFor(6.5, phShapes), angularDamping: 0.3, ccd: true }, { grip: [3, 5], grip2: [14, 5], angle: 0.5 }, x, y, opts),
    ['hammer', 'blunt', 'piston', 'pneumatic', 'sledge', 'knockback']);
}

// ------------------------------------------------------------------ sprayers

/**
 * The flamethrower as a gun: Edit gun… sets its heat (damage, here the burn on
 * what the fuel hits) and its push back (recoil, here a steady push in N). It
 * has no bullets: speed 0 has people aim it straight at whoever they fight.
 */
const TORCH_GUN: GunSpec = {
  sound: 'none', muzzle: A.TORCH_MUZZLE, auto: true, rate: 30, speed: 0, energy: 0, damage: 12, spread: 0.1, recoil: 18, flash: 0,
};
/** The trigger hand on the pistol grip, the other on the front grip under the barrel. */
const TORCH_HOLD: HoldSpec = { grip: [8, 7], grip2: [26, 6] };
/** One hand on the carrying handle, the other aiming the horn. */
const EXT_HOLD: HoldSpec = { grip: [3, 2], grip2: [12, 9] };

function registerSprayers(): void {
  const torch = lazyArt(() => A.flamethrowerArt(1));
  const torchShapes = rects(A.TORCH_W, A.TORCH_H, [[0, 2, 36, 4], [7, 6, 3, 5], [12, 6, 13, 5], [26, 5, 2, 4]], 0.5);
  item('flamethrower', 'Flamethrower', 'Weapons',
    'Hold activate to throw a stream of burning fuel about five metres: it sets alight whatever it reaches, sticks and burns even on metal, and leaves burning fuel on the floor. A tank lasts about 25 seconds: its menu shows what is left, and refills it.',
    torch, (game, def, x, y, opts) =>
      new Flamethrower(game, def, { art: torch, material: MAT.metal, shapes: torchShapes, density: densityFor(9, torchShapes), angularDamping: 0.3 }, TORCH_HOLD, TORCH_GUN, x, y, opts),
    ['fire', 'flame', 'burn', 'napalm', 'incendiary', 'torch', 'gun']);
  const ext = lazyArt(A.extinguisherArt);
  const extShapes = [artRect(A.EXT_W, A.EXT_H, 1, 6, 10, 18, 2), ...rects(A.EXT_W, A.EXT_H, [[3, 0, 7, 6], [11, 6, 5, 6]], 0.5)];
  item('fire-extinguisher', 'Fire Extinguisher', 'Weapons',
    'Hold activate to spray: the cloud puts out whatever burns where it reaches (things, people, burning fuel on the floor) and gives light things a little shove. It never runs out.',
    ext, (game, def, x, y, opts) =>
      new Extinguisher(game, def, { art: ext, material: MAT.sheetMetal, shapes: extShapes, density: densityFor(6, extShapes), angularDamping: 0.3 }, EXT_HOLD, x, y, opts),
    ['fire', 'extinguish', 'spray', 'powder', 'foam', 'safety', 'red']);
}

/** The stun gun as a gun: Edit gun… sets the jolt's harm (damage) and the recharge time (the time between shots). */
const STUN_GUN: GunSpec = {
  sound: 'none', muzzle: A.STUN_MUZZLE, auto: false, rate: 1 / 1.2, speed: 0, energy: 0, damage: 4, spread: 0, recoil: 0.3, flash: 0,
};

function registerStunGun(): void {
  const art = lazyArt(() => A.stunGunArt(true));
  const shapes = rects(A.STUN_W, A.STUN_H, [[2, 0, 12, 5], [1, 4, 5, 5]], 0.4);
  item('stun-gun', 'Stun Gun', 'Weapons',
    'Activate to throw an arc of electricity a few metres: a person or an animal it hits jerks about and drops, knocked out for a few seconds and hardly hurt. Then it takes a moment to charge again.',
    art, (game, def, x, y, opts) =>
      new StunGun(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.6, shapes), angularDamping: 0.3 }, { grip: [3, 6] }, STUN_GUN, x, y, opts),
    ['taser', 'stunner', 'zap', 'electric', 'shock', 'knockout', 'non-lethal']);
}

// ------------------------------------------------------------------ grenades

/**
 * The launcher as a gun: Edit gun… sets the kick, the round's power and the
 * reload time; the round's speed out of the barrel makes people lob it high.
 */
const LAUNCHER_GUN: GunSpec = {
  sound: 'launcher', muzzle: G.LAUNCHER_MUZZLE, auto: false, rate: 1 / 1.8, speed: 26, energy: 0, damage: 150, spread: 0.01, recoil: 4, flash: 0.3,
};
/** The trigger hand at the wrist of the stock, the other under the fore-end. */
const LAUNCHER_HOLD: HoldSpec = { grip: [13, 6], grip2: [22, 8] };

function registerGrenades(): void {
  const sticky = lazyArt(() => G.stickyGrenadeArt(true));
  const stickyShapes: ShapeSpec[] = [{ kind: 'ball', r: 4.2, y: -1.5 }, artRect(G.STICKY_W, G.STICKY_H, 3, 0, 3, 4, 0.5)];
  item('sticky-grenade', 'Sticky Grenade', 'Explosives',
    'Pull the pin (activate) and throw it: it sticks to the first thing it touches (a person, a crate, a car, the floor or a wall) and goes off 3 seconds after the pin was pulled. Pull it off from its menu.',
    sticky, (game, def, x, y, opts) =>
      new StickyGrenade(game, def, { art: sticky, material: MAT.rubber, shapes: stickyShapes, density: densityFor(0.6, stickyShapes), angularDamping: 0.4, restitution: 0 }, { grip: [4, 6] },
        { power: 65, radius: 4.2, damage: 165, shrapnel: 18, fuse: 3, pin: [1, 1], pulled: lazyArt(() => G.stickyGrenadeArt(false)) }, x, y, opts),
    ['sticky', 'bomb', 'throw', 'grenade', 'glue', 'adhesive']);
  const roundArt = lazyArt(G.launcherRoundArt);
  const roundShapes: ShapeSpec[] = [artRect(G.ROUND_W, G.ROUND_H, 0, 0, G.ROUND_W, G.ROUND_H, 1)];
  const round = item('launcher-round', '40 mm Grenade', 'Weapons', 'A round fired from a grenade launcher.', roundArt, (game, def, x, y, opts) =>
    new LauncherRound(game, def, roundArt(), roundShapes, densityFor(0.23, roundShapes), x, y, opts), [], true);
  const art = lazyArt(() => G.launcherArt(false));
  const shapes = rects(G.LAUNCHER_W, G.LAUNCHER_H, [[0, 3, 12, 5], [11, 1, 23, 6], [18, 7, 9, 2]], 0.5);
  item('grenade-launcher', 'Grenade Launcher', 'Weapons',
    'Activate to lob a 40 mm grenade in an arc: it goes off on whatever it hits once it has flown a little way. Set its fuze to timed in its menu and the grenades bounce about for 2.5 seconds first. Reloads (broken open, the case thrown out) in under two seconds.',
    art, (game, def, x, y, opts) =>
      new GrenadeLauncher(game, def, { art, material: MAT.metal, shapes, density: densityFor(2.9, shapes), angularDamping: 0.3 }, LAUNCHER_HOLD, LAUNCHER_GUN, round, x, y, opts),
    ['launcher', 'grenade', 'm79', 'blooper', 'thumper', '40mm', 'explosive', 'gun']);
}

// ------------------------------------------------------------------ more guns

type GunClass = new (...a: ConstructorParameters<typeof Firearm>) => Firearm;

interface GunDef {
  id: string;
  name: string;
  desc: string;
  art: () => PixelArt;
  w: number;
  h: number;
  rects: [number, number, number, number][];
  mass: number;
  hold: HoldSpec;
  gun: GunSpec;
  make: GunClass;
  tags: string[];
}

const GUNS: GunDef[] = [
  {
    id: 'burst-rifle', name: 'Burst Rifle', make: BurstRifle, art: A.burstRifleArt, w: 32, h: 10, mass: 3.6,
    desc: 'A rifle that fires three rounds in quick succession each time it is activated. Accurate, and the bullets go through a body or two.',
    rects: [[0, 2, 26, 3], [9, 0, 7, 2], [26, 3, 6, 1], [8, 6, 2, 3], [13, 6, 3, 4]], hold: { grip: [9, 7], grip2: [20, 4] },
    gun: { sound: 'burst', muzzle: [32, 3], eject: [12, 2], auto: false, rate: 15, speed: 850, energy: 1300, damage: 32, spread: 0.012, recoil: 1.7, flash: 0.22, case: { len: 3, wid: 1 } },
    tags: ['gun', 'rifle', 'burst', 'm16', 'three-round'],
  },
  {
    id: 'battle-rifle', name: 'Battle Rifle', make: BattleRifle, art: A.battleRifleArt, w: 38, h: 7, mass: 4.4,
    desc: 'A heavy semi-automatic rifle fed by an eight-round clip: hard-hitting, accurate, and the empty clip flies out with a ping after the last shot.',
    rects: [[0, 1, 30, 4], [30, 2, 8, 2], [10, 0, 8, 1], [9, 5, 3, 2]], hold: { grip: [10, 5], grip2: [22, 4] },
    gun: { sound: 'battle', muzzle: [38, 2.5], eject: [13, 1], auto: false, rate: 5, speed: 850, energy: 2600, damage: 55, spread: 0.006, recoil: 3.2, flash: 0.26, case: { len: 3, wid: 1 } },
    tags: ['gun', 'rifle', 'garand', 'm1', 'clip', 'semi-automatic', 'ping'],
  },
  {
    id: 'machine-gun', name: 'Machine Gun', make: MachineGun, art: () => A.machineGunArt(0), w: 40, h: 10, mass: 10.5,
    desc: 'A belt-fed machine gun: it fires as long as activation is held, but the barrel heats up (glowing and smoking, the shots spreading wider) and too hot it stops until it has cooled down.',
    rects: [[0, 2, 31, 4], [31, 3, 9, 2], [18, 6, 6, 4], [13, 6, 2, 3], [10, 0, 12, 2]], hold: { grip: [13, 7], grip2: [26, 5] },
    gun: { sound: 'lmg', muzzle: [40, 3.5], eject: [16, 5], auto: true, rate: 11, speed: 800, energy: 1600, damage: 30, spread: 0.03, recoil: 1.6, flash: 0.26, case: { len: 3, wid: 1 } },
    tags: ['gun', 'lmg', 'm60', 'belt', 'automatic', 'overheat'],
  },
  {
    id: 'double-barrel', name: 'Double-Barrel Shotgun', make: DoubleBarrel, art: () => A.doubleBarrelArt(false), w: 36, h: 9, mass: 3.2,
    desc: 'Two barrels, two shots: one each time it is activated, or both at once from its menu. Then it is broken open, the spent shells thrown out and two more put in.',
    rects: [[0, 1, 14, 5], [13, 0, 23, 5], [15, 5, 10, 2], [3, 5, 4, 3]], hold: { grip: [6, 6], grip2: [20, 6] },
    gun: { sound: 'double', muzzle: A.DOUBLE_MUZZLES[0], auto: false, rate: 6, speed: 330, energy: 180, damage: 13, pellets: 9, spread: 0.2, recoil: 6.5, flash: 0.34, shellColor: 0xb0302a, push: 0.006, case: { len: 3, wid: 2 } },
    tags: ['gun', 'shotgun', 'double', 'break-action', 'coach gun', 'sawn-off'],
  },
  {
    id: 'flintlock', name: 'Flintlock Pistol', make: Flintlock, art: A.flintlockArt, w: A.FLINT_W, h: A.FLINT_H, mass: 1.2,
    desc: 'An old flintlock: the flint strikes, the powder in the pan flashes and a moment later it fires a heavy ball in a great cloud of smoke. One shot, then a few seconds to load again.',
    rects: [[4, 2, 17, 3], [0, 5, 5, 5], [5, 0, 2, 2]], hold: { grip: [3, 7] },
    gun: { sound: 'flintlock', muzzle: A.FLINT_MUZZLE, auto: false, rate: 10, speed: 260, energy: 700, damage: 65, spread: 0.035, recoil: 3.8, flash: 0.4 },
    tags: ['gun', 'pistol', 'pirate', 'musket', 'black powder', 'antique'],
  },
];

function registerGuns(): void {
  for (const g of GUNS) {
    const art = lazyArt(g.art);
    const shapes = rects(g.w, g.h, g.rects, 0.4);
    const density = densityFor(g.mass, shapes);
    item(g.id, g.name, 'Weapons', g.desc, art, (game, def, x, y, opts) =>
      new g.make(game, def, { art, material: MAT.metal, shapes, density, angularDamping: 0.3 }, g.hold, g.gun, x, y, opts), g.tags);
  }
}

/** Registers the lot, each in its category. */
// ------------------------------------------------------------------ pyrotechnics

function registerPyro(): void {
  const flare = lazyArt(() => G.flareArt('new'));
  const flareShapes = rects(G.FLARE_W, G.FLARE_H, [[0, 0, 16, 4]], 1);
  item('flare', 'Flare', 'Explosives',
    'A road flare. Strike it (activate) and it burns for 45 seconds with a fierce red light, spitting sparks. Fuel on the floor and oil-soaked things catch from it; held in its flame, wood and cloth catch too. Fire lights it as well.',
    flare, (game, def, x, y, opts) =>
      new Flare(game, def, { art: flare, material: MAT.plastic, shapes: flareShapes, density: densityFor(0.3, flareShapes), angularDamping: 0.3 }, { grip: [4, 2] }, x, y, opts),
    ['light', 'fire', 'signal', 'red', 'burn', 'torch']);
  const rocket = lazyArt(() => G.fireworkArt('red'));
  const rocketShapes = rects(G.ROCKET_W, G.ROCKET_H, [[1, 0, 5, 16], [2.5, 16, 2, 16]], 0.5);
  item('firework', 'Firework Rocket', 'Explosives',
    'Stand it up (freezing it there is fine) and light the fuse (activate): it shoots into the air trailing sparks and bursts high up in a shower of coloured stars. Pick its colour from its menu. It bursts early if it hits something or is shot.',
    rocket, (game, def, x, y, opts) =>
      new Firework(game, def, { art: rocket, material: MAT.plastic, shapes: rocketShapes, density: densityFor(0.4, rocketShapes), angularDamping: 0.6 }, { grip: [3, 24] }, x, y, opts),
    ['rocket', 'fireworks', 'celebration', 'sparks', 'colour', 'party', 'launch']);
}

// ------------------------------------------------------------------ balloon and weight

function registerOddities(): void {
  const balloon = lazyArt(() => G.balloonArt('red'));
  const balloonShapes: ShapeSpec[] = [{ kind: 'ball', r: 7, x: 0, y: 3 }];
  item('balloon', 'Balloon', 'Objects',
    'A balloon full of gas: it floats up and lifts what it is tied to (tie a rope to its knot). One holds up about 20 kg: a few lift a person. It bursts at bullets, blades, fire and hard knocks. Its colour is in its menu.',
    balloon, (game, def, x, y, opts) =>
      new Balloon(game, def, { art: balloon, material: MAT.rubber, shapes: balloonShapes, density: densityFor(0.8, balloonShapes), restitution: 0.4, angularDamping: 3 }, x, y, opts),
    ['float', 'lift', 'helium', 'party', 'pop', 'air']);
  const weight = lazyArt(G.weightArt);
  // (a trapezoid; densityFor() only counts boxes, so the poly's area is added by hand)
  const weightShapes: ShapeSpec[] = [
    { kind: 'poly', pts: [[-10, 8], [10, 8], [15, -13], [-15, -13]], r: 0.5 },
    artRect(G.WEIGHT_W, G.WEIGHT_H, 10, 0, 10, 6, 0.5),
  ];
  // (its area in px²: the trapezoid's and the ring's, and what their rounded edges add)
  const weightArea = (((20 + 30) / 2) * 21 + 10 * 6) * 1.081;
  item('weight', '1000 kg Weight', 'Objects',
    'A thousand kilograms of iron. Drop it on something.',
    weight, (game, def, x, y, opts) =>
      new Prop(game, def, { art: weight, material: MAT.metal, shapes: weightShapes, density: 1000 / (weightArea * PX * PX), friction: 0.8 }, x, y, opts),
    ['heavy', 'ton', 'iron', 'crush', 'anvil', 'cartoon']);
}

export function registerArsenal(): void {
  registerGuns();
  registerGrenades();
  registerSprayers();
  registerStunGun();
  registerChainsaw();
  registerMeleeGear();
  registerPyro();
  registerOddities();
}

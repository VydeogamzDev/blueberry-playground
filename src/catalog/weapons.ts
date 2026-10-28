import { register, lazyArt, previewOf, GLASS } from './items';
import type { ItemDef, Category } from '../world/types';
import type { PixelArt } from '../art/PixelArt';
import { PixelArt as Art } from '../art/PixelArt';
import { MAT, type PhysMaterial } from '../world/Materials';
import { PX } from '../engine/constants';
import * as I from '../art/items';
import * as M from '../art/machines';
import { barrelArt } from '../art/props';
import { Item, artRect, densityFor, type HoldSpec } from '../entities/Item';
import { Firearm, type GunSpec } from '../entities/Firearm';
import { Blade, type BladeSpec } from '../entities/Melee';
import { Explosive, type BlastSpec } from '../entities/Explosive';
import { Nuke } from '../entities/Nuke';
import { registerRpg, registerMolotov } from './ordnance';
import { registerCrossbow } from './crossbow';
import * as B from '../art/bombs';
import { Battery, Button, LightBulb, Motor, Thruster } from '../entities/Machines';
import { Syringe, SYRINGE_STEPS, type Drug } from '../entities/Syringe';
import { FirstAidKit, Bandage, Defibrillator } from '../entities/Medical';
import * as Med from '../art/medical';
import type { DefibLight, MonitorLamp } from '../art/medical';
import { HeartMonitor, LifeDetector } from '../entities/Monitors';
import { Switch, MotionSensor, Timer, LogicGate, Piston, ReversingSwitch, LEVER_STEPS, type LeverPos } from '../entities/Devices';
import { Flask, FLASK_TILTS } from '../entities/Flask';
import { LIQUID_IDS, type LiquidName } from '../systems/Liquids';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { SpawnOptions } from '../world/types';

type Factory = (game: Game, def: ItemDef, art: () => PixelArt, x: number, y: number, opts: SpawnOptions) => Entity;

function item(id: string, name: string, category: Category, description: string, artFn: () => PixelArt, make: Factory, tags: string[] = []): ItemDef {
  const art = lazyArt(artFn);
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, art, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/** Shapes from art-pixel rects [x, y, w, h]. */
function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

// ------------------------------------------------------------------ firearms

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
  tags?: string[];
}

const GUNS: GunDef[] = [
  {
    id: 'pistol', name: 'Pistol', desc: 'Semi-automatic 9mm handgun. Activate to fire.', art: I.pistolArt, w: 12, h: 7,
    rects: [[1, 0, 11, 4], [0, 4, 4, 3]], mass: 1.0, hold: { grip: [2, 5] },
    gun: { sound: 'pistol', muzzle: [12, 1], eject: [6, 0], auto: false, rate: 7, speed: 360, energy: 420, damage: 28, spread: 0.012, recoil: 1.6, flash: 0.16 },
    tags: ['gun', 'handgun', '9mm'],
  },
  {
    id: 'revolver', name: 'Revolver', desc: 'Heavy six-shooter. Hits hard, kicks hard.', art: I.revolverArt, w: 14, h: 7,
    rects: [[1, 0, 13, 4], [0, 4, 4, 3]], mass: 1.3, hold: { grip: [1, 5] },
    gun: { sound: 'revolver', muzzle: [14, 1], auto: false, rate: 3.5, speed: 420, energy: 750, damage: 44, spread: 0.008, recoil: 2.8, flash: 0.22 },
    tags: ['gun', 'handgun', 'magnum'],
  },
  {
    id: 'smg', name: 'Submachine Gun', desc: 'Compact automatic. Hold activate to spray.', art: I.smgArt, w: 20, h: 8,
    rects: [[0, 0, 14, 4], [14, 0.5, 6, 2], [3, 4, 2, 2], [8, 4, 2, 4]], mass: 2.8, hold: { grip: [4, 5], grip2: [9, 6] },
    gun: { sound: 'smg', muzzle: [20, 1], eject: [8, 0], auto: true, rate: 14, speed: 380, energy: 360, damage: 19, spread: 0.07, recoil: 0.8, flash: 0.14 },
    tags: ['gun', 'automatic', 'smg', 'uzi'],
  },
  {
    id: 'rifle', name: 'Assault Rifle', desc: 'Automatic rifle. Bullets pass through several bodies.', art: I.rifleArt, w: 30, h: 9,
    rects: [[0, 1, 25, 4], [24, 1.5, 6, 2], [8, 5, 3, 3], [13, 5, 3, 3]], mass: 3.8, hold: { grip: [9, 6], grip2: [20, 4] },
    gun: { sound: 'rifle', muzzle: [30, 2], eject: [12, 1], auto: true, rate: 9, speed: 820, energy: 1400, damage: 34, spread: 0.025, recoil: 1.9, flash: 0.24 },
    tags: ['gun', 'automatic', 'ak', 'm4'],
  },
  {
    id: 'shotgun', name: 'Shotgun', desc: 'Pump-action shotgun. Eight pellets per shell.', art: I.shotgunArt, w: 34, h: 6,
    rects: [[0, 0, 34, 4], [9, 4, 2, 2]], mass: 3.4, hold: { grip: [10, 4], grip2: [20, 3] },
    gun: {
      sound: 'shotgun', muzzle: [34, 1], eject: [12, 1], auto: false, rate: 1.3, speed: 330, energy: 170, damage: 12, pellets: 8,
      spread: 0.17, recoil: 6, flash: 0.32, shellColor: 0xb0302a, push: 0.006,
    },
    tags: ['gun', 'pump', 'scattergun'],
  },
  {
    id: 'sniper', name: 'Sniper Rifle', desc: 'Bolt-action rifle. Goes through almost anything.', art: I.sniperArt, w: 38, h: 8,
    rects: [[0, 2, 25, 4], [10, 0, 9, 2], [25, 2.5, 13, 2], [10, 6, 2, 2]], mass: 6.0, hold: { grip: [11, 6], grip2: [21, 5] },
    gun: { sound: 'sniper', muzzle: [38, 3], eject: [13, 3], auto: false, rate: 0.8, speed: 1000, energy: 6500, damage: 95, spread: 0, recoil: 7, flash: 0.32, push: 0.003 },
    tags: ['gun', 'rifle', 'bolt', 'scope'],
  },
  {
    id: 'minigun', name: 'Minigun', desc: 'Spins up, then shreds everything in front of it.', art: I.minigunArt, w: 30, h: 7,
    rects: [[1, 0, 29, 5], [4, 5, 2, 2], [11, 5, 4, 2]], mass: 14, hold: { grip: [5, 5], grip2: [12, 5] },
    gun: { sound: 'minigun', muzzle: [30, 2], eject: [9, 4], auto: true, rate: 30, spinUp: 0.6, speed: 700, energy: 1000, damage: 24, spread: 0.06, recoil: 0.9, flash: 0.22 },
    tags: ['gun', 'gatling', 'automatic'],
  },
  {
    id: 'laser-rifle', name: 'Laser Rifle', desc: 'Energy weapon. An instant beam that burns through flesh and wood and sets things alight.', art: M.laserRifleArt, w: 32, h: 9,
    rects: [[0, 1, 30, 4], [8, 5, 3, 4], [16, 5, 3, 2]], mass: 3.2, hold: { grip: [9, 6], grip2: [17, 5] },
    gun: { sound: 'laser', muzzle: [32, 2], auto: false, rate: 4, speed: 0, energy: 0, damage: 34, spread: 0, recoil: 0.3, flash: 0.14, laser: 0xff3b30 },
    tags: ['energy', 'beam', 'laser', 'sci-fi'],
  },
];

// ------------------------------------------------------------------ melee

interface MeleeDef {
  id: string;
  name: string;
  desc: string;
  art: () => PixelArt;
  w: number;
  h: number;
  rects: [number, number, number, number][];
  mass: number;
  material: PhysMaterial;
  hold: HoldSpec;
  blade?: BladeSpec;
  /** Blunt impact multiplier. */
  blunt?: number;
  tags?: string[];
}

const MELEE: MeleeDef[] = [
  {
    id: 'knife', name: 'Knife', desc: 'A sharp knife. Stabs, slices and sticks into things.', art: I.knifeArt, w: 15, h: 3,
    rects: [[0, 0.5, 5, 2], [5, 0, 10, 3]], mass: 0.3, material: MAT.metal, hold: { grip: [2, 1] },
    blade: { blade: [6, 14], tipLen: 4, edge: 'bottom', sharpness: 1, stab: true, maxDepth: 0.25, grip: 260 },
    tags: ['blade', 'stab', 'sharp'],
  },
  {
    id: 'sword', name: 'Sword', desc: 'A long double-edged blade. Can take limbs off.', art: I.swordArt, w: 42, h: 5,
    rects: [[0, 1, 8, 2], [7, 0, 1, 5], [8, 1, 33, 2]], mass: 1.4, material: MAT.metal, hold: { grip: [3, 1], angle: 0.5 },
    blade: { blade: [8, 41], tipLen: 5, edge: 'both', sharpness: 1.7, stab: true, maxDepth: 1, grip: 420 },
    tags: ['blade', 'katana', 'sharp'],
  },
  {
    id: 'axe', name: 'Axe', desc: 'A heavy chopping axe.', art: I.axeArt, w: 31, h: 11,
    rects: [[0, 2, 27, 2], [18, 0, 12, 11]], mass: 2.2, material: MAT.metal, hold: { grip: [4, 3], grip2: [12, 3], angle: 0.6 },
    blade: { blade: [18, 30], tipLen: 0, edge: 'bottom', sharpness: 2.4, stab: false, maxDepth: 0.1, grip: 300 },
    blunt: 1.5, tags: ['blade', 'chop', 'hatchet'],
  },
  {
    id: 'crowbar', name: 'Crowbar', desc: 'A steel crowbar. Blunt and heavy.', art: I.crowbarArt, w: 32, h: 6,
    rects: [[3, 2, 29, 2], [0, 0, 4, 4]], mass: 1.8, material: MAT.metal, hold: { grip: [6, 2], angle: 0.6 }, blunt: 3,
    tags: ['blunt', 'bar'],
  },
  {
    id: 'bat', name: 'Baseball Bat', desc: 'A wooden bat.', art: I.batArt, w: 32, h: 5,
    rects: [[0, 1, 12, 3], [12, 0.5, 20, 4]], mass: 1.0, material: MAT.wood, hold: { grip: [3, 2], grip2: [9, 2], angle: 0.7 }, blunt: 3,
    tags: ['blunt', 'club'],
  },
  {
    id: 'hammer', name: 'Sledgehammer', desc: 'A heavy hammer.', art: I.hammerArt, w: 30, h: 10,
    rects: [[0, 4, 24, 2], [23, 0, 7, 10]], mass: 3.0, material: MAT.metal, hold: { grip: [3, 5], grip2: [13, 5], angle: 0.5 }, blunt: 2.5,
    tags: ['blunt', 'mallet'],
  },
];

// ------------------------------------------------------------------ explosives

interface BombDef {
  id: string;
  name: string;
  desc: string;
  art: () => PixelArt;
  w: number;
  h: number;
  rects?: [number, number, number, number][];
  shapes?: ShapeSpec[];
  mass: number;
  material: PhysMaterial;
  hold: HoldSpec | null;
  blast: BlastSpec;
  tags?: string[];
}

const BOMBS: BombDef[] = [
  {
    id: 'grenade', name: 'Grenade', desc: 'Pull the pin (activate) and throw. 3 second fuse.', art: () => I.grenadeArt(true), w: 8, h: 11,
    shapes: [{ kind: 'ball', r: 3.8, y: -1.5 }, { kind: 'box', w: 4, h: 3, y: 3.5, r: 0.5 }], mass: 0.6, material: MAT.metal, hold: { grip: [3, 6] },
    blast: { power: 70, radius: 4.5, damage: 170, shrapnel: 28, fuse: 3, pin: [0, 1], pulled: lazyArt(() => I.grenadeArt(false)) },
    tags: ['frag', 'bomb', 'throw'],
  },
  {
    id: 'dynamite', name: 'Dynamite', desc: 'Light the fuse (activate). Also lit by fire.', art: I.dynamiteArt, w: 17, h: 5,
    rects: [[2, 0, 15, 5]], mass: 0.5, material: MAT.plastic, hold: { grip: [9, 2] },
    blast: { power: 110, radius: 5.5, damage: 230, fuse: 4, fusePoint: [0, 0], burnTime: 0.4 },
    tags: ['tnt', 'stick', 'bomb'],
  },
  {
    id: 'explosive-barrel', name: 'Explosive Barrel', desc: 'Goes off when shot, burned or hit hard.', art: () => barrelArt(true), w: 18, h: 26,
    shapes: [{ kind: 'box', w: 18, h: 26, r: 1.5 }], mass: 40, material: MAT.sheetMetal, hold: null,
    blast: { power: 190, radius: 7, damage: 280, incendiary: true, fuse: 0, sensitivity: 30, burnTime: 2.5 },
    tags: ['oil', 'drum', 'red'],
  },
  {
    id: 'c4', name: 'C4', desc: 'Plastic explosive. Detonates instantly when activated or wired.', art: I.c4Art, w: 14, h: 7,
    rects: [[0, 1, 14, 6]], mass: 0.7, material: MAT.plastic, hold: { grip: [7, 4] },
    blast: { power: 170, radius: 6, damage: 320, fuse: 0.05 },
    tags: ['plastic', 'charge', 'bomb'],
  },
  {
    id: 'landmine', name: 'Landmine', desc: 'Explodes when something steps on it.', art: I.mineArt, w: 16, h: 5,
    shapes: [{ kind: 'poly', pts: [[-7, -2.5], [7, -2.5], [5, 1.5], [-5, 1.5]], r: 0.5 }, artRect(16, 5, 5, 0, 6, 2)], mass: 3, material: MAT.metal, hold: null,
    blast: { power: 160, radius: 4.5, damage: 340, fuse: 0.25, pressure: true, shrapnel: 12 },
    tags: ['mine', 'trap', 'bomb'],
  },
  {
    id: 'bomb', name: 'Bomb', desc: 'A round black-powder bomb. Light the fuse (activate) and watch it burn down: 5 seconds. Fire and fuse cords light it too.',
    art: () => B.roundBombArt(), w: 18, h: 22,
    shapes: [{ kind: 'ball', r: 8, x: -1, y: -3 }, artRect(18, 22, 5, 3, 6, 4)], mass: 6, material: MAT.metal, hold: { grip: [8, 5] },
    blast: { power: 150, radius: 6.5, damage: 300, fuse: 5, fusePath: B.ROUND_FUSE, fuseArt: B.roundBombArt, burnTime: 0.3 },
    tags: ['round', 'cartoon', 'fuse', 'black powder'],
  },
];

function buttonArt(): PixelArt {
  const a = new Art(14, 6);
  a.blit(I.buttonCapArt(), 3, 0);
  a.blit(I.buttonBaseArt(), 0, 2);
  return a;
}

// ------------------------------------------------------------------ tools

const TOOLS: { id: string; tool: string; name: string; desc: string; tags: string[] }[] = [
  { id: 'tool-rope', tool: 'rope', name: 'Rope', desc: 'Drag from one object to another (or to the background) to tie a rope.', tags: ['string', 'cable', 'tie'] },
  { id: 'tool-weld', tool: 'weld', name: 'Fixed Connector', desc: 'Drag between two objects to weld them rigidly together. Click to weld an object to whatever is behind it, or to the background.', tags: ['weld', 'glue', 'attach'] },
  { id: 'tool-spring', tool: 'spring', name: 'Spring', desc: 'Drag between two objects to connect them with a spring.', tags: ['elastic', 'bungee'] },
  { id: 'tool-hinge', tool: 'hinge', name: 'Hinge', desc: 'Drag between two objects: they rotate freely around the start point. Click to hinge an object to whatever is behind it, or to the background.', tags: ['axle', 'joint', 'rotate'] },
  { id: 'tool-pin', tool: 'pin', name: 'Pin', desc: 'Click an object to pin it there: to whatever is behind it (it turns on the pin), else to the background. Drag from one object to another to hinge them.', tags: ['nail', 'anchor', 'fix'] },
  { id: 'tool-wire', tool: 'wire', name: 'Wire', desc: 'Connect devices electrically: batteries, buttons, lights, motors, guns, explosives. Power reaching a gun fires it, and reaching a bomb sets it off.', tags: ['cable', 'electric', 'power'] },
  { id: 'tool-fuse', tool: 'fuse', name: 'Fuse', desc: 'The Rope’s other kind (the Rope’s key twice). Drag between objects to lay a fuse cord; click a fuse to light it (fire and blasts light it too). It burns along and sets off the explosives it reaches, one after another.', tags: ['cord', 'wick', 'chain', 'detonate'] },
  { id: 'tool-remove', tool: 'remove', name: 'Remove Connections', desc: 'Click a connection (its line or its knot) to remove it; Shift+click an object to remove all of its connections; drag a box to remove every connection it crosses.', tags: ['delete', 'cut', 'detach'] },
  { id: 'tool-shape', tool: 'shape', name: 'Shape', desc: 'Draw solid objects: drag out a box (Shift: round), or click corner points and click the first one again. Pick the material below.', tags: ['draw', 'build', 'custom', 'polygon'] },
];

// ------------------------------------------------------------------ registration

export function registerWeapons(): void {
  for (const g of GUNS) {
    const shapes = rects(g.w, g.h, g.rects, 0.4);
    const density = densityFor(g.mass, shapes);
    item(g.id, g.name, 'Weapons', g.desc, g.art, (game, def, art, x, y, opts) =>
      new Firearm(game, def, { art, material: MAT.metal, shapes, density, angularDamping: 0.3 }, g.hold, g.gun, x, y, opts), g.tags);
  }
  registerRpg();
  registerCrossbow();
}

export function registerMelee(): void {
  for (const m of MELEE) {
    const shapes = rects(m.w, m.h, m.rects, 0.4);
    const density = densityFor(m.mass, shapes);
    item(m.id, m.name, 'Melee', m.desc, m.art, (game, def, art, x, y, opts) => {
      const cfg = { art, material: m.material, shapes, density, angularDamping: 0.3, ccd: true };
      const e = m.blade ? new Blade(game, def, cfg, m.hold, m.blade, x, y, opts) : new Item(game, def, cfg, m.hold, x, y, opts);
      e.blunt = m.blunt ?? 1;
      e.swings = true;
      return e;
    }, m.tags);
  }
}

export function registerExplosives(): void {
  for (const b of BOMBS) {
    const shapes = b.shapes ?? rects(b.w, b.h, b.rects ?? [[0, 0, b.w, b.h]], 0.5);
    const density = densityFor(b.mass, shapes);
    item(b.id, b.name, 'Explosives', b.desc, b.art, (game, def, art, x, y, opts) =>
      new Explosive(game, def, { art, material: b.material, shapes, density, angularDamping: 0.25 }, b.hold, b.blast, x, y, opts), b.tags);
  }
  registerMolotov();
  const nukeShapes = rects(64, 24, [[5, 4, 59, 16], [1, 0, 12, 4], [1, 20, 12, 4]], 1.5);
  item('nuke', 'Thermonuclear Bomb', 'Explosives', 'Set its yield (0.1 kt to 50 Mt) and countdown in its menu, then activate it. The smallest levels a block; the biggest, the whole map.',
    () => B.nukeArt(10, false), (game, def, art, x, y, opts) =>
      new Nuke(game, def, { art, material: MAT.metal, shapes: nukeShapes, density: densityFor(300, nukeShapes), angularDamping: 0.3 }, B.nukeArt, x, y, opts),
    ['nuclear', 'atomic', 'hydrogen', 'h-bomb', 'yield']);
}

// ------------------------------------------------------------------ medical

const SYRINGES: { drug: Drug; name: string; desc: string; tags: string[] }[] = [
  { drug: 'healing', name: 'Healing Syringe', desc: 'Push the needle into someone (or Use it touching them, or in their hand): over a second or so it closes wounds, mends bones, clears burns and blood, restores blood and gets them back up.', tags: ['heal', 'medkit', 'health'] },
  { drug: 'adrenaline', name: 'Adrenaline Syringe', desc: 'Kills pain and shock, wakes people up and gets them back on their feet fast. Each dose has them (or an animal) walking and running much faster for about 45 seconds.', tags: ['stim', 'wake', 'epinephrine'] },
  { drug: 'knockout', name: 'Knockout Syringe', desc: 'Sedative. Puts a person or an animal to sleep for half a minute.', tags: ['sedative', 'sleep', 'tranquilizer'] },
  { drug: 'life', name: 'Life Syringe', desc: 'Brings the dead back to life, healed, as long as they still have a head. Heals the living a little.', tags: ['revive', 'resurrect'] },
  { drug: 'poison', name: 'Poison Syringe', desc: 'Slowly drains the life out of whoever it is injected into, turning them a sickly green.', tags: ['toxin', 'kill', 'venom'] },
  { drug: 'death', name: 'Death Syringe', desc: 'Stops the heart the moment it goes in. A defibrillator can still start it again.', tags: ['kill', 'lethal', 'heart'] },
  { drug: 'coagulation', name: 'Coagulation Syringe', desc: 'Thickens the blood: every bleeding wound closes up over a few seconds, and new ones stop quickly for a while after.', tags: ['clot', 'bleeding', 'stop bleeding'] },
  { drug: 'painkiller', name: 'Painkiller Syringe', desc: 'Takes all pain away for about a minute: no writhing, no fainting from it, and they get up again sooner.', tags: ['morphine', 'pain', 'analgesic'] },
  { drug: 'strength', name: 'Ultra Strength Syringe', desc: 'For about a minute their muscles are far stronger: a firmer grip, and their punches send people flying.', tags: ['strong', 'steroid', 'super', 'power'] },
  { drug: 'freeze', name: 'Freeze Syringe', desc: 'Freezes them stiff where they stand, pale and blue, for about half a minute. Fire thaws them sooner.', tags: ['ice', 'cold', 'frozen', 'stiff'] },
  { drug: 'bone', name: 'Bone Eating Syringe', desc: 'Eats away at the bones: one breaks after another, every second or so, until none are left whole.', tags: ['break', 'fracture', 'osteo'] },
  { drug: 'acid', name: 'Acid Syringe', desc: 'Acid in the blood melts the body from the inside: the flesh blisters and drips, and limbs fall off one by one.', tags: ['melt', 'corrosive', 'dissolve'] },
  { drug: 'pink', name: 'Pink Syringe', desc: 'Nobody knows what is in it: it does what one of the other syringes does, a different one each time.', tags: ['random', 'mystery', 'surprise'] },
  { drug: 'zombie', name: 'Zombie Syringe', desc: 'Infects them: a few seconds later they turn, greying and shambling, and go for the living. A bite passes it on. Only destroying the head stops one for good.', tags: ['undead', 'virus', 'infect', 'infection'] },
  { drug: 'cure', name: 'Zombie Cure Syringe', desc: 'Clears the zombie infection, before or after they turn (as long as the head is whole): they are themselves again.', tags: ['antidote', 'undead', 'vaccine', 'infection'] },
  { drug: 'regen', name: 'Regeneration Syringe', desc: 'Over the next half a minute the body grows back what it has lost, one limb at a time from the stump out, and mends what is hurt: wounds close, bones knit, blood comes back. It does not raise the dead.', tags: ['regenerate', 'regrow', 'limbs', 'heal', 'restore'] },
];

export function registerMedical(): void {
  const shapes = rects(20, 7, [[0, 1, 15, 5], [15, 2, 2, 3], [17, 3, 3, 1]], 0.3);
  const density = densityFor(0.08, shapes);
  for (const s of SYRINGES) {
    // (its art with the plunger pushed in each step of the way, made when first needed)
    const steps = Array.from({ length: SYRINGE_STEPS + 1 }, (_, k) => lazyArt(() => I.syringeArt(I.DRUG_RAMPS[s.drug], 1 - k / SYRINGE_STEPS)));
    item(`syringe-${s.drug}`, s.name, 'Medical', s.desc, steps[0], (game, def, art, x, y, opts) => {
      const blade: BladeSpec = { blade: [15, 19], tipLen: 3, edge: 'none', sharpness: 0, stab: true, maxDepth: 0.08, grip: 140, stabSpeed: 1.4, stabDamage: 0.08 };
      return new Syringe(game, def, { art, material: MAT.plastic, shapes, density, angularDamping: 0.3, ccd: true }, { grip: [10, 3] }, blade, s.drug, (k) => steps[k](), x, y, opts);
    }, ['syringe', 'needle', 'drug', ...s.tags]);
  }
  const kitFull = lazyArt(() => Med.firstAidArt(false));
  const kitEmpty = lazyArt(() => Med.firstAidArt(true));
  const kitArt = (empty: boolean) => (empty ? kitEmpty() : kitFull());
  const kitShapes = rects(16, 13, [[0, 2, 16, 11], [4, 0, 8, 2]], 0.8);
  item('first-aid-kit', 'First Aid Kit', 'Medical', 'Drag it onto someone hurt (or Use it while it touches them): over a few seconds it patches up their wounds, bones, burns and blood. Three uses.',
    kitFull, (game, def, art, x, y, opts) =>
      new FirstAidKit(game, def, { art, material: MAT.plastic, shapes: kitShapes, density: densityFor(1.2, kitShapes), angularDamping: 0.3 }, { grip: [8, 1] }, kitArt, x, y, opts),
    ['medkit', 'heal', 'health', 'first aid', 'kit']);
  const rollShapes: ShapeSpec[] = [{ kind: 'ball', r: 4.5, x: -1.5, y: 0 }, artRect(12, 9, 4, 6, 8, 3)];
  item('bandage', 'Bandage', 'Medical', 'Drag it onto a bleeding limb (or Use it while it touches one) to wrap it: that limb stops bleeding, and the bandage stays on.',
    Med.bandageArt, (game, def, art, x, y, opts) =>
      new Bandage(game, def, { art, material: MAT.plastic, shapes: rollShapes, density: densityFor(0.1, rollShapes), angularDamping: 0.3 }, { grip: [4, 4] }, x, y, opts),
    ['gauze', 'wrap', 'bleeding', 'heal']);
  const lights = new Map<DefibLight, () => PixelArt>();
  const defibArt = (light: DefibLight) => {
    let a = lights.get(light);
    if (!a) lights.set(light, (a = lazyArt(() => Med.defibArt(light))));
    return a();
  };
  const defibShapes = rects(16, 11, [[0, 2, 16, 8], [4, 0, 6, 2]], 0.8);
  item('defibrillator', 'Defibrillator', 'Medical', 'Use it to charge it (a couple of seconds); charged, it shocks whoever its paddle (the front) is against. Restarts the heart of someone who died less than a minute ago; jolts the living awake.',
    () => defibArt('off'), (game, def, art, x, y, opts) =>
      new Defibrillator(game, def, { art, material: MAT.plastic, shapes: defibShapes, density: densityFor(2.5, defibShapes), angularDamping: 0.3 }, { grip: [7, 1] }, defibArt, x, y, opts),
    ['defib', 'aed', 'revive', 'shock', 'heart', 'paddles']);
  const lamps = new Map<MonitorLamp, () => PixelArt>();
  const monitorArt = (lamp: MonitorLamp) => {
    let a = lamps.get(lamp);
    if (!a) lamps.set(lamp, (a = lazyArt(() => Med.heartMonitorArt(lamp))));
    return a();
  };
  const monitorShapes = rects(20, 15, [[0, 0, 20, 14], [2, 14, 16, 1]], 0.8);
  item('heart-monitor', 'Heart Monitor', 'Medical', 'Use it next to someone to clip its leads on (or wire it to them): its screen traces their heartbeat and it beeps with every beat, each beat also powering its other wires for a moment. When the heart stops it flatlines, with a long tone.',
    () => monitorArt('off'), (game, def, art, x, y, opts) =>
      new HeartMonitor(game, def, { art, material: MAT.plastic, shapes: monitorShapes, density: densityFor(4, monitorShapes), angularDamping: 0.3 }, monitorArt, x, y, opts),
    ['ecg', 'ekg', 'heart', 'pulse', 'monitor', 'vitals', 'heartbeat']);
}

const FLASKS: { liquid: LiquidName; name: string; desc: string; tags: string[] }[] = [
  { liquid: 'water', name: 'Water Flask', desc: 'Puts out fires and washes off oil. Uncork and tip it over to pour; smash it to splash.', tags: ['water', 'bottle', 'extinguish'] },
  { liquid: 'acid', name: 'Acid Flask', desc: 'Corrosive acid: burns skin and eats into whatever it lands on.', tags: ['acid', 'bottle', 'corrosive'] },
  { liquid: 'oil', name: 'Oil Flask', desc: 'Soaks into things and makes them burn, even metal and people.', tags: ['oil', 'bottle', 'fuel', 'flammable'] },
];

export function registerLiquids(): void {
  const shapes: ShapeSpec[] = [{ kind: 'ball', r: 5, y: -3 }, artRect(10, 16, 3, 0, 4, 7)];
  const density = densityFor(0.6, shapes);
  for (const f of FLASKS) {
    const ramp = I.FLASK_RAMPS[f.liquid];
    const cache = new Map<string, PixelArt>();
    const art = (level: number, corked: boolean, tilt = 0) => {
      const k = `${level}:${corked}:${tilt}`;
      let a = cache.get(k);
      if (!a) cache.set(k, (a = I.flaskArt(ramp, level, corked, (tilt * Math.PI * 2) / FLASK_TILTS)));
      return a;
    };
    item(`flask-${f.liquid}`, f.name, 'Medical', f.desc, () => art(1, true), (game, def, a, x, y, opts) =>
      new Flask(game, def, { art: a, material: GLASS, shapes, density, hp: 5 }, LIQUID_IDS[f.liquid], art, x, y, opts), ['flask', 'liquid', ...f.tags]);
  }
}

export function registerMachinery(): void {
  item('battery', 'Battery', 'Machinery', 'Powers everything wired to it. Switched on in water, it electrifies it: whoever’s in it is shocked. Activate to switch on/off.', I.batteryArt, (game, def, art, x, y, opts) => {
    const shapes = rects(10, 16, [[0, 2, 10, 14], [3, 0, 4, 2]]);
    return new Battery(game, def, { art, material: MAT.metal, shapes, density: densityFor(2.5, shapes) }, x, y, opts);
  }, ['power', 'electric', 'cell']);
  item('button', 'Button', 'Machinery', 'Sends a pulse through its wires when pressed or activated: it switches lights, thrusters and motors, flips levers, fires guns and sets off bombs. It doesn’t carry a battery’s power (a Switch does).', buttonArt, (game, def, art, x, y, opts) => {
    const shapes = rects(14, 6, [[0, 2, 14, 4], [3, 0, 8, 2]]);
    return new Button(game, def, { art, material: MAT.metal, shapes, density: densityFor(1.2, shapes) }, x, y, opts);
  }, ['switch', 'trigger', 'electric']);
  const bulbOn = lazyArt(() => I.bulbArt(true));
  item('light', 'Light Bulb', 'Machinery', 'Lights up when powered or switched on.', () => I.bulbArt(false), (game, def, art, x, y, opts) => {
    const shapes: ShapeSpec[] = [{ kind: 'ball', r: 4, y: 2 }, artRect(8, 12, 2, 7, 4, 5)];
    return new LightBulb(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.25, shapes), hp: 4 }, bulbOn, x, y, opts);
  }, ['lamp', 'lightbulb', 'electric']);
  item('thruster', 'Thruster', 'Machinery', 'Pushes forward while active or powered: one lifts a person, a few lift a car. Set its thrust in its menu, from 300 N to 4800 N (1200 N to start with).', I.thrusterArt, (game, def, art, x, y, opts) => {
    const shapes = rects(14, 10, [[5, 1, 9, 8], [0, 1, 6, 8]]);
    // (a push 20 times its own weight from standing, fading toward THRUST_TOP m/s)
    return new Thruster(game, def, { art, material: MAT.metal, shapes, density: densityFor(6, shapes) }, 1200, x, y, opts);
  }, ['rocket', 'jet', 'engine']);
  const housing = lazyArt(I.motorHousingArt);
  const rotor = lazyArt(I.rotorArt);
  // (enough torque to swing a plank hanging from its rotor by one end up and round: 17 kg a metre out takes 170 N*m)
  item('motor', 'Motor', 'Machinery', 'An electric motor. Weld things to its rotor; activate or power it to spin. Set its speed and torque (100 to 1600 N·m) in its menu.', I.motorHousingArt, (game, def, _art, x, y, opts) =>
    new Motor(game, def, { housing, rotor, rotorShape: { kind: 'ball', r: 7 }, speed: 9, torque: 400 }, x, y, opts), ['engine', 'rotor', 'spin']);
  const wheel = lazyArt(I.wheelArt);
  item('motor-wheel', 'Motor Wheel', 'Machinery', 'A powered rubber wheel on a motor hub. Set its speed and torque (15 to 240 N·m) in its menu.', I.wheelArt, (game, def, _art, x, y, opts) =>
    new Motor(game, def, { housing: rotor, rotor: wheel, rotorShape: { kind: 'ball', r: 10 }, rotorMaterial: MAT.rubber, rotorDensity: 60, speed: 14, torque: 60, hubOnTop: true }, x, y, opts),
  ['wheel', 'car', 'drive']);
}

export function registerDevices(): void {
  const on = lazyArt(() => M.switchArt(true));
  item('switch', 'Switch', 'Machinery', 'A lever switch. On, it powers what is wired to it (gates and timers too); wired to a battery, it lets the power through only while on. A button’s pulse flips it.', () => M.switchArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(14, 12, [[0, 6, 14, 6], [5, 4, 4, 2]]);
    return new Switch(game, def, { art, material: MAT.metal, shapes, density: densityFor(1, shapes) }, on, x, y, opts);
  }, ['lever', 'toggle', 'electric']);
  const lever = new Map(LEVER_STEPS.map((p) => [p, lazyArt(() => M.reverserArt(p))]));
  item('reversing-switch', 'Reversing Switch', 'Machinery', 'A three-way lever: on, off and reverse (F steps through them, as does a button’s pulse). Wired like a Switch, but in reverse what it powers runs backwards: motors and motor wheels spin the other way, thrusters push backwards and pistons pull in.', () => M.reverserArt('off'), (game, def, art, x, y, opts) => {
    const shapes = rects(16, 12, [[0, 6, 16, 6], [6, 4, 4, 2]]);
    return new ReversingSwitch(game, def, { art, material: MAT.metal, shapes, density: densityFor(1, shapes) }, (p: LeverPos) => lever.get(p)!(), x, y, opts);
  }, ['lever', 'reverse', 'forward', 'backwards', 'direction', 'toggle', 'electric']);
  const seen = lazyArt(() => M.sensorArt(true));
  item('sensor', 'Motion Sensor', 'Machinery', 'A tripwire beam. Powers its wires and sends a pulse when something crosses it.', () => M.sensorArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(12, 10, [[0, 1, 12, 8]]);
    return new MotionSensor(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.6, shapes) }, seen, x, y, opts);
  }, ['detector', 'tripwire', 'laser', 'trigger']);
  const alive = lazyArt(() => Med.lifeDetectorArt(true));
  item('life-detector', 'Life Detector', 'Machinery', 'A sensor that only sees the living: while someone alive (a person or an animal, not a zombie or a body) is in its beam, it powers its wires, and it pulses them when one first comes into view.', () => Med.lifeDetectorArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(12, 10, [[0, 1, 12, 8]]);
    return new LifeDetector(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.6, shapes) }, alive, x, y, opts);
  }, ['sensor', 'detector', 'alive', 'life', 'heartbeat', 'trigger']);
  const tick = lazyArt(() => M.timerArt(true));
  item('timer', 'Timer', 'Machinery', 'Pulses its output (right side) every interval while on, or while its input (left side) is powered. Set the interval in its menu; a pulse on its input starts or stops it.', () => M.timerArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(14, 12, [[0, 0, 14, 12]]);
    return new Timer(game, def, { art, material: MAT.metal, shapes, density: densityFor(0.8, shapes) }, tick, x, y, opts);
  }, ['clock', 'pulse', 'repeat', 'delay']);
  const GATES: [GateKindId, string, string][] = [
    ['and', 'AND Gate', 'Output (right) is on when every input (left) is powered.'],
    ['or', 'OR Gate', 'Output (right) is on when any input (left) is powered.'],
    ['xor', 'XOR Gate', 'Output (right) is on when exactly one input (left) is powered.'],
    ['not', 'NOT Gate', 'Output (right) is on while its input (left) is not powered.'],
  ];
  for (const [kind, name, desc] of GATES) {
    const art = (out: boolean) => M.gateArt(kind, out);
    const lit = lazyArt(() => art(true));
    const dark = lazyArt(() => art(false));
    item(`gate-${kind}`, name, 'Machinery', desc + ' Wire inputs to the left half, outputs to the right half.', dark, (game, def, a, x, y, opts) => {
      const shapes = rects(16, 12, [[0, 0, 16, 12]]);
      return new LogicGate(game, def, { art: a, material: MAT.plastic, shapes, density: densityFor(0.4, shapes) }, kind, (o) => (o ? lit() : dark()), x, y, opts);
    }, ['logic', 'gate', kind]);
  }
  const base = lazyArt(M.pistonBaseArt);
  const rod = lazyArt(M.pistonRodArt);
  item('piston', 'Piston', 'Machinery', 'Pushes its plate out 1 m while on or powered. Weld things to the plate or the cylinder: several can lift one thing together, even set a little out of line.', M.pistonBaseArt, (game, def, _art, x, y, opts) =>
    new Piston(game, def, { base, rod, stroke: 1, force: 4000 }, x, y, opts), ['pusher', 'hydraulic', 'actuator']);
}

type GateKindId = 'and' | 'or' | 'xor' | 'not';

export function registerTools(): void {
  for (const t of TOOLS) {
    const art = lazyArt(() => I.toolIcon(t.tool));
    register({ id: t.id, name: t.name, category: 'Tools', description: t.desc, tags: t.tags, tool: t.tool, preview: previewOf(art) });
  }
}

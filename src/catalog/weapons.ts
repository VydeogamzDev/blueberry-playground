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
import { Battery, Button, LightBulb, Motor, Thruster } from '../entities/Machines';
import { Syringe, type Drug } from '../entities/Syringe';
import { Switch, MotionSensor, Timer, LogicGate, Piston } from '../entities/Devices';
import { Car } from '../entities/Car';
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
    blade: { blade: [6, 14], tipLen: 4, edge: 'bottom', sharpness: 1, stab: true, maxDepth: 0.22, grip: 260 },
    tags: ['blade', 'stab', 'sharp'],
  },
  {
    id: 'sword', name: 'Sword', desc: 'A long double-edged blade. Can take limbs off.', art: I.swordArt, w: 42, h: 5,
    rects: [[0, 1, 8, 2], [7, 0, 1, 5], [8, 1, 33, 2]], mass: 1.4, material: MAT.metal, hold: { grip: [3, 1], angle: 0.5 },
    blade: { blade: [8, 41], tipLen: 5, edge: 'both', sharpness: 1.7, stab: true, maxDepth: 0.6, grip: 420 },
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
    blast: { power: 70, radius: 4.5, damage: 170, shrapnel: 28, fuse: 3, pin: [0, 1] },
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
  { id: 'tool-pin', tool: 'pin', name: 'Pin', desc: 'Click an object to pin it to the background at that point.', tags: ['nail', 'anchor', 'fix'] },
  { id: 'tool-wire', tool: 'wire', name: 'Wire', desc: 'Connect devices electrically: batteries, buttons, lights, motors, guns, explosives.', tags: ['cable', 'electric', 'power'] },
  { id: 'tool-remove', tool: 'remove', name: 'Remove Connections', desc: 'Click an object to remove all of its connections.', tags: ['delete', 'cut', 'detach'] },
];

// ------------------------------------------------------------------ registration

export function registerWeapons(): void {
  for (const g of GUNS) {
    const shapes = rects(g.w, g.h, g.rects, 0.4);
    const density = densityFor(g.mass, shapes);
    item(g.id, g.name, 'Weapons', g.desc, g.art, (game, def, art, x, y, opts) =>
      new Firearm(game, def, { art, material: MAT.metal, shapes, density, angularDamping: 0.3 }, g.hold, g.gun, x, y, opts), g.tags);
  }
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
}

// ------------------------------------------------------------------ medical

const SYRINGES: { drug: Drug; name: string; desc: string; tags: string[] }[] = [
  { drug: 'healing', name: 'Healing Syringe', desc: 'Stab it into someone: heals wounds, burns and broken bones, restores blood and cures poison.', tags: ['heal', 'medkit', 'health'] },
  { drug: 'adrenaline', name: 'Adrenaline Syringe', desc: 'Kills pain and shock, wakes people up and gets them back on their feet fast.', tags: ['stim', 'wake', 'epinephrine'] },
  { drug: 'knockout', name: 'Knockout Syringe', desc: 'Sedative. Puts a person to sleep for half a minute.', tags: ['sedative', 'sleep', 'tranquilizer'] },
  { drug: 'life', name: 'Life Syringe', desc: 'Brings the dead back to life, as long as they still have a head.', tags: ['revive', 'resurrect'] },
  { drug: 'poison', name: 'Poison Syringe', desc: 'Slowly drains the life out of whoever it is injected into.', tags: ['toxin', 'kill', 'venom'] },
];

export function registerMedical(): void {
  const empty = lazyArt(() => I.syringeArt(null));
  const shapes = rects(20, 7, [[0, 1, 15, 5], [15, 2, 2, 3], [17, 3, 3, 1]], 0.3);
  const density = densityFor(0.08, shapes);
  for (const s of SYRINGES) {
    item(`syringe-${s.drug}`, s.name, 'Medical', s.desc, () => I.syringeArt(I.DRUG_RAMPS[s.drug]), (game, def, art, x, y, opts) => {
      const blade: BladeSpec = { blade: [15, 19], tipLen: 3, edge: 'none', sharpness: 0, stab: true, maxDepth: 0.08, grip: 140, stabSpeed: 1.4, stabDamage: 0.08 };
      return new Syringe(game, def, { art, material: MAT.plastic, shapes, density, angularDamping: 0.3, ccd: true }, { grip: [10, 3] }, blade, s.drug, empty, x, y, opts);
    }, ['syringe', 'needle', 'drug', ...s.tags]);
  }
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
  item('battery', 'Battery', 'Machinery', 'Powers everything wired to it. Activate to switch on/off.', I.batteryArt, (game, def, art, x, y, opts) => {
    const shapes = rects(10, 16, [[0, 2, 10, 14], [3, 0, 4, 2]]);
    return new Battery(game, def, { art, material: MAT.metal, shapes, density: densityFor(2.5, shapes) }, x, y, opts);
  }, ['power', 'electric', 'cell']);
  item('button', 'Button', 'Machinery', 'Sends a pulse through its wires when pressed or activated.', buttonArt, (game, def, art, x, y, opts) => {
    const shapes = rects(14, 6, [[0, 2, 14, 4], [3, 0, 8, 2]]);
    return new Button(game, def, { art, material: MAT.metal, shapes, density: densityFor(1.2, shapes) }, x, y, opts);
  }, ['switch', 'trigger', 'electric']);
  const bulbOn = lazyArt(() => I.bulbArt(true));
  item('light', 'Light Bulb', 'Machinery', 'Lights up when powered or switched on.', () => I.bulbArt(false), (game, def, art, x, y, opts) => {
    const shapes: ShapeSpec[] = [{ kind: 'ball', r: 4, y: 2 }, artRect(8, 12, 2, 7, 4, 5)];
    return new LightBulb(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.25, shapes), hp: 4 }, bulbOn, x, y, opts);
  }, ['lamp', 'lightbulb', 'electric']);
  item('thruster', 'Thruster', 'Machinery', 'Pushes forward while active or powered.', I.thrusterArt, (game, def, art, x, y, opts) => {
    const shapes = rects(14, 10, [[5, 1, 9, 8], [0, 1, 6, 8]]);
    return new Thruster(game, def, { art, material: MAT.metal, shapes, density: densityFor(3, shapes) }, 260, x, y, opts);
  }, ['rocket', 'jet', 'engine']);
  const housing = lazyArt(I.motorHousingArt);
  const rotor = lazyArt(I.rotorArt);
  item('motor', 'Motor', 'Machinery', 'An electric motor. Weld things to its rotor; activate or power it to spin.', I.motorHousingArt, (game, def, _art, x, y, opts) =>
    new Motor(game, def, { housing, rotor, rotorShape: { kind: 'ball', r: 7 }, speed: 9, torque: 80 }, x, y, opts), ['engine', 'rotor', 'spin']);
  const wheel = lazyArt(I.wheelArt);
  item('motor-wheel', 'Motor Wheel', 'Machinery', 'A powered rubber wheel on a motor hub.', I.wheelArt, (game, def, _art, x, y, opts) =>
    new Motor(game, def, { housing: rotor, rotor: wheel, rotorShape: { kind: 'ball', r: 10 }, rotorMaterial: MAT.rubber, rotorDensity: 60, speed: 14, torque: 60, hubOnTop: true }, x, y, opts),
  ['wheel', 'car', 'drive']);
}

export function registerDevices(): void {
  const on = lazyArt(() => M.switchArt(true));
  item('switch', 'Switch', 'Machinery', 'A lever switch. Power only flows through it while it is on. A pulse flips it.', () => M.switchArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(14, 12, [[0, 6, 14, 6], [5, 4, 4, 2]]);
    return new Switch(game, def, { art, material: MAT.metal, shapes, density: densityFor(1, shapes) }, on, x, y, opts);
  }, ['lever', 'toggle', 'electric']);
  const seen = lazyArt(() => M.sensorArt(true));
  item('sensor', 'Motion Sensor', 'Machinery', 'A tripwire beam. Powers its wires and sends a pulse when something crosses it.', () => M.sensorArt(false), (game, def, art, x, y, opts) => {
    const shapes = rects(12, 10, [[0, 1, 12, 8]]);
    return new MotionSensor(game, def, { art, material: MAT.plastic, shapes, density: densityFor(0.6, shapes) }, seen, x, y, opts);
  }, ['detector', 'tripwire', 'laser', 'trigger']);
  const tick = lazyArt(() => M.timerArt(true));
  item('timer', 'Timer', 'Machinery', 'Pulses its output (right side) every interval while on, or while its input (left side) is powered.', () => M.timerArt(false), (game, def, art, x, y, opts) => {
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
  item('piston', 'Piston', 'Machinery', 'Pushes its plate out 1 m while on or powered. Weld things to the plate or the cylinder.', M.pistonBaseArt, (game, def, _art, x, y, opts) =>
    new Piston(game, def, { base, rod, stroke: 1, force: 4000 }, x, y, opts), ['pusher', 'hydraulic', 'actuator']);
}

export function registerVehicles(): void {
  const body = lazyArt(M.carBodyArt);
  const wheel = lazyArt(M.carWheelArt);
  item('car', 'Car', 'Vehicles', 'A small hatchback. Activate to drive (or wire it to power); reverse from its menu.', M.carBodyArt, (game, def, _art, x, y, opts) =>
    new Car(game, def, { body, wheel, axles: [[15, 22], [59, 22]], wheelR: 8, speed: 22, torque: 170 }, x, y, opts), ['vehicle', 'auto', 'drive']);
}

type GateKindId = 'and' | 'or' | 'xor' | 'not';

export function registerTools(): void {
  for (const t of TOOLS) {
    const art = lazyArt(() => I.toolIcon(t.tool));
    register({ id: t.id, name: t.name, category: 'Tools', description: t.desc, tags: t.tags, tool: t.tool, preview: previewOf(art) });
  }
}

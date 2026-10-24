import { PixelArt, CLEAR } from './PixelArt';
import { finish, draw, GUNMETAL, POLYMER, RED, STEEL, STEEL_LT, WHITE, YELLOW, BRASS, WOOD, WOOD_DARK, OLIVE } from './palette';
import type { Color } from './PixelArt';

// Sprayers and odd guns (see entities/Sprayers, StunGun). They follow the guns'
// rules: pointing RIGHT, drawn from the palette's ramps, finished with its
// outline and lighting, and details a pixel across painted on afterwards.

// ------------------------------------------------------------------ flamethrower

export const TORCH_W = 36;
export const TORCH_H = 12;
/** Where the burning fuel leaves the nozzle (art px). */
export const TORCH_MUZZLE: [number, number] = [35, 3.5];

/** A flamethrower: a fuel tank slung under the tube, its gauge showing `fuel` (0..1) left. */
export function flamethrowerArt(fuel = 1): PixelArt {
  const a = new PixelArt(TORCH_W, TORCH_H);
  // stock, tube and the nozzle's shroud
  a.rect(0, 2, 6, 4, POLYMER[2]);
  a.rect(0, 6, 3, 2, POLYMER[2]);
  a.rect(5, 2, 21, 4, GUNMETAL[2]);
  a.rect(25, 3, 8, 2, STEEL[2]);
  a.rect(31, 1, 5, 6, GUNMETAL[2]);
  // pistol grip, the fuel tank under the tube, the front grip under the barrel
  a.rect(7, 6, 3, 5, POLYMER[2]);
  a.roundRect(12, 6, 13, 5, 2, RED[2]);
  a.rect(26, 5, 2, 4, POLYMER[2]);
  // the igniter under the nozzle
  a.rect(31, 7, 3, 2, YELLOW[2]);
  finish(a);
  // bands round the tank, its gauge (green to red as it empties), the trigger
  a.vline(15, 7, 9, RED[1]).vline(21, 7, 9, RED[1]);
  a.set(18, 7, WHITE[3]).set(19, 7, fuel > 0.5 ? 0x58c45a : fuel > 0.15 ? YELLOW[3] : 0xe0483a);
  a.set(11, 6, POLYMER[0]);
  // the fuel line from the tank up to the tube, the nozzle's bore and its pilot flame
  a.set(25, 6, BRASS[3]).set(25, 5, BRASS[2]);
  a.vline(35, 3, 4, GUNMETAL[0]);
  a.set(34, 8, 0x6ec8ff);
  return a;
}

// ------------------------------------------------------------------ extinguisher

export const EXT_W = 16;
export const EXT_H = 24;
/** The horn's mouth, where the spray comes out (art px). */
export const EXT_MUZZLE: [number, number] = [15, 8.5];

/** A fire extinguisher standing upright, its hose's horn pointing right. */
export function extinguisherArt(): PixelArt {
  const a = new PixelArt(EXT_W, EXT_H);
  // the cylinder, its valve, the carrying handle and the squeeze lever over it
  a.roundRect(1, 6, 10, 18, 3, RED[2]);
  a.rect(4, 3, 4, 4, GUNMETAL[2]);
  a.rect(0, 2, 7, 1, POLYMER[2]);
  a.rect(3, 0, 7, 1, POLYMER[2]);
  a.set(9, 1, POLYMER[2]);
  // the horn, flaring out to the right
  a.poly([[11, 7], [16, 5], [16, 12.5], [11, 10]], POLYMER[2]);
  finish(a);
  // the hose from the valve round to the horn
  a.hline(8, 10, 4, RUBBER_HOSE).vline(10, 5, 7, RUBBER_HOSE);
  // label, pressure gauge, a darker ring at the foot
  a.rect(3, 12, 6, 5, WHITE[2]);
  a.hline(4, 7, 13, RED[1]).hline(4, 6, 15, RED[1]);
  a.set(5, 4, WHITE[3]).set(6, 4, 0x58c45a);
  a.hline(3, 8, 22, RED[1]);
  a.set(15, 7, POLYMER[0]).set(15, 8, POLYMER[0]).set(15, 9, POLYMER[0]).set(15, 10, POLYMER[0]);
  a.set(2, 8, RED[4]).set(2, 9, RED[3]).set(2, 10, RED[3]);
  return a;
}
const RUBBER_HOSE = POLYMER[1];

// ------------------------------------------------------------------ stun gun

export const STUN_W = 15;
export const STUN_H = 9;
/** Between its two prongs, where the arc leaves it (art px). */
export const STUN_MUZZLE: [number, number] = [14.5, 1.5];

const stuns = new Map<boolean, PixelArt>();

/** A stun gun: a yellow pistol-shaped zapper, its light green when `charged`, red while it charges. */
export function stunGunArt(charged = true): PixelArt {
  let a = stuns.get(charged);
  if (!a) stuns.set(charged, (a = drawStun(charged)));
  return a;
}

function drawStun(charged: boolean): PixelArt {
  const a = new PixelArt(STUN_W, STUN_H);
  a.roundRect(2, 0, 11, 5, 1, YELLOW[2]);
  a.rect(12, 0, 3, 4, POLYMER[2]);
  a.poly([[2, 4], [6, 4], [5, 9], [1, 9]], POLYMER[2]);
  a.rect(6, 4, 3, 2, POLYMER[2]);
  finish(a);
  // black stripes, the trigger, the charge light, the prongs and the arc between them
  a.vline(9, 1, 3, POLYMER[1]).vline(10, 1, 3, POLYMER[1]);
  a.set(6, 5, YELLOW[3]).set(7, 5, CLEAR);
  a.set(4, 1, charged ? 0x58c45a : 0xe0483a);
  a.set(14, 0, STEEL_LT[3]).set(14, 3, STEEL_LT[3]);
  return a;
}

// ------------------------------------------------------------------ more guns

/** The guns' character-map palette (as art/items has it), with a belt of rounds. */
const PAL: Record<string, Color> = {
  S: GUNMETAL[2], s: GUNMETAL[1], M: GUNMETAL[1], d: GUNMETAL[0],
  K: POLYMER[2], G: POLYMER[2], g: POLYMER[1], t: POLYMER[0], m: GUNMETAL[2], n: GUNMETAL[1],
  W: WOOD[2], w: WOOD[1], O: OLIVE[2], o: OLIVE[1], y: BRASS[3],
};

function gun(rows: string[]): PixelArt {
  return finish(draw(rows[0].length, rows.length, rows, PAL));
}

/** A burst-fire rifle (an M16A2): carrying handle, ribbed handguard, a short curved magazine. */
export function burstRifleArt(): PixelArt {
  return gun([
    '.........SSSSSSS................',
    '.........S.....S........S.......',
    'KKKKKK..SSSSSSSSSKKKKKKKSS......',
    'KKKKKKKSSSSddSSSSKgKgKgKSSMMMMMS',
    'KKKKKKKSSSSSSSSSSKKKKKKKK.......',
    'KKKK...KKKKKKKKKK...............',
    'KK......GG.t.mm.................',
    '........Gg...mm.................',
    '.........G....mm................',
    '..............mm................',
  ]);
}

/** A semi-automatic battle rifle (an M1 Garand): a long wooden stock, the gas tube under the barrel. */
export function battleRifleArt(): PixelArt {
  return gun([
    '..........SSSSSSS.....................',
    'WWW.......SSSSSSSS..............S.....',
    'WWWWWWWWWWSSSSSSSSWWWWWWWWWWWWSSSSSSSS',
    'WwWWWWWWWWSSddSSSSWwwwwwwwwwwwMMMMMMMS',
    'WWWWWWWWWWWWWWWWWWWWWWWWWWWWW.........',
    '.WWWWWW..WW.t.WWW.....................',
    '...WWW.....KKK........................',
  ]);
}

/** How hot the machine gun's barrel looks: 0 cold, 1 warm, 2 glowing. */
export type BarrelHeat = 0 | 1 | 2;

const lmgs = new Map<BarrelHeat, PixelArt>();

/** A belt-fed machine gun (an M60): carrying handle, a box of belted rounds, the bipod folded under the barrel; the barrel glowing as it heats. */
export function machineGunArt(heat: BarrelHeat = 0): PixelArt {
  let a = lmgs.get(heat);
  if (a) return a;
  a = gun([
    '..................SSSS..................',
    '..........SSSSSSSSS..S..................',
    'KKKKK....SSSSSSSSSSSSSSKKKKKKKK.........',
    'KKKKKKKKKSSSSddSSSSSSSSKgKgKgKKMMMMMMMMS',
    'KKKKKKKKKSSSSSSSSSSSSSSKKKKKKKKMMMMMMMMS',
    'KKKK.....SSSSSSSSSSSSSSKKKKKKKKnnnnnnn..',
    'KK...........GG.t.OOOOOOyy..............',
    '.............Gg...OOOOOO.y..............',
    '..............G...OOOOOOy...............',
    '..................OOOOOO................',
  ]);
  if (heat) {
    const hot: Color[] = heat === 2 ? [0xff7a2a, 0xe0482a] : [0x8a4a3a, 0x6a3a34];
    for (let x = 31; x <= 38; x++) a.set(x, 3, hot[(x + 1) % 2]).set(x, 4, hot[x % 2]);
  }
  lmgs.set(heat, a);
  return a;
}

export const DOUBLE_W = 36;
export const DOUBLE_H = 9;
/** Where the shot leaves the barrels (upper, lower), and the breech the spent shells come out of (art px, closed). */
export const DOUBLE_MUZZLES: [number, number][] = [[35, 1.5], [35, 3.5]];
export const DOUBLE_BREECH: [number, number] = [13, 2.5];

const doubles = new Map<boolean, PixelArt>();

/** An over-and-under double-barrelled shotgun: closed, or broken open at the hinge to load. */
export function doubleBarrelArt(open = false): PixelArt {
  let a = doubles.get(open);
  if (a) return a;
  a = new PixelArt(DOUBLE_W, DOUBLE_H);
  const d = open ? 2 : 0;
  // stock with its pistol grip, the action, the two barrels and the fore-end under them
  a.poly([[0, 1], [10, 2], [10, 5], [8, 5], [6, 8], [3, 8], [5, 5], [0, 6]], WOOD[2]);
  a.rect(9, 1, 5, 5, GUNMETAL[2]);
  a.rect(13, d, 23, 2, GUNMETAL[2]);
  a.rect(13, 2 + d, 23, 3, GUNMETAL[1]);
  a.rect(15, 5 + d, 10, 2, WOOD[2]);
  finish(a);
  // the rib between the barrels, their bores, the trigger, chequering on the grip
  a.hline(14, 34, 2 + d, GUNMETAL[0]);
  a.set(35, 1 + d, GUNMETAL[0]).set(35, 3 + d, GUNMETAL[0]);
  a.set(10, 6, POLYMER[0]).set(10, 7, POLYMER[0]);
  a.set(5, 6, WOOD_DARK[2]).set(6, 5, WOOD_DARK[2]);
  if (open) a.vline(13, 2, 5, GUNMETAL[0]);
  doubles.set(open, a);
  return a;
}

export const FLINT_W = 21;
export const FLINT_H = 10;
/** The muzzle, and the priming pan where the flint's spark lights the powder (art px). */
export const FLINT_MUZZLE: [number, number] = [20, 2.5];
export const FLINT_PAN: [number, number] = [8, 1.5];

/** A flintlock pistol: a long barrel in a wooden stock, its cock holding the flint over the pan, brass at the butt. */
export function flintlockArt(): PixelArt {
  const a = new PixelArt(FLINT_W, FLINT_H);
  a.poly([[0, 7.5], [4, 3], [17, 3], [17, 5], [8, 5], [4, 10], [0, 10]], WOOD[2]);
  a.rect(6, 2, 15, 2, GUNMETAL[2]);
  a.rect(4, 3, 5, 2, STEEL[2]);
  a.rect(5, 0, 2, 3, STEEL[2]);
  finish(a);
  // brass butt cap, ramrod pipe and trigger guard; the trigger; the flint in the cock's jaws; the frizzen over the pan
  a.rect(0, 8, 2, 2, BRASS[2]).set(0, 8, BRASS[3]);
  a.hline(9, 16, 5, WOOD_DARK[1]);
  a.set(7, 6, BRASS[2]).set(8, 7, BRASS[2]).set(9, 6, BRASS[2]).set(8, 6, POLYMER[0]);
  a.set(6, 0, 0x8a8f96).set(7, 1, STEEL[3]);
  a.set(8, 1, STEEL[1]).set(8, 2, STEEL[3]);
  a.set(14, 2, BRASS[3]);
  return a;
}


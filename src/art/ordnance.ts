import { PixelArt } from './PixelArt';
import { finish, ramp, GLASS, GUNMETAL, OLIVE, POLYMER, STEEL, STEEL_LT, WOOD, YELLOW } from './palette';

// The molotov cocktail, and the RPG launcher with its rocket. Same rules as
// every other sprite: palette ramps, finish() for outline and lighting,
// one-pixel details (the rag, stripes, sights) painted afterwards.

// ------------------------------------------------------------------ molotov cocktail

/** Bottle glass: an old green beer bottle. */
const BOTTLE = ramp('#4f8a4a', 0.9);
/** The oil inside, seen through the green glass. */
const FILL = ramp('#3a4228', 1.1);
/** The rag: a strip of grubby cotton. */
const RAG = ramp('#d2c6a2', 0.8);
/** The burning end of a lit rag, and the scorched cloth just behind it. */
const EMBER = 0xffb040;
const SCORCHED = 0xa05a2c;

/** Glass shards flying off a smashed bottle. */
export const BOTTLE_SHARDS = BOTTLE[3];

/** The rag hanging out of the neck: its art pixels from the free end in (it burns down from there). */
export const RAG_PATH: [number, number][] = [[7, 6], [7, 5], [7, 4], [7, 3], [6, 2], [5, 1], [4, 0]];
/** The rag bunched up in the bottle's mouth: where the flame gets into the oil. */
export const RAG_KNOT: [number, number] = [4, 2];
const RAG_BASE: [number, number][] = [[3, 1], [4, 1], [3, 2], [4, 2], [5, 2]];

const molotovs = new Map<string, PixelArt>();

/**
 * A molotov cocktail standing upright, with `left` pixels of its rag's strip not
 * burnt yet (default: all of it); `lit`, the rag is burning where it's got to.
 */
export function molotovArt(left = RAG_PATH.length, lit = false): PixelArt {
  const key = `${left}:${lit}`;
  let a = molotovs.get(key);
  if (!a) molotovs.set(key, (a = drawMolotov(left, lit)));
  return a;
}

function drawMolotov(left: number, lit: boolean): PixelArt {
  const a = new PixelArt(9, 21);
  // lip, neck, sloping shoulders and the body, oil up to just under the shoulders
  a.rect(2, 3, 5, 1, BOTTLE[2]);
  a.rect(3, 4, 3, 5, BOTTLE[2]);
  a.poly([[3, 8], [6, 8], [9, 12], [0, 12]], BOTTLE[2]);
  a.roundRect(0, 11, 9, 10, 1, BOTTLE[2]);
  a.rect(1, 13, 7, 7, FILL[2]);
  finish(a);
  // the oil's surface, and light glinting off the glass
  a.hline(2, 6, 13, FILL[3]);
  a.set(2, 11, BOTTLE[4]).set(2, 15, BOTTLE[4]).set(2, 16, BOTTLE[4]).set(2, 17, BOTTLE[3]);
  a.set(4, 5, BOTTLE[3]).set(4, 6, BOTTLE[3]);
  // the rag, one pixel wide, so painted after the outline pass (it would be all outline)
  const n = RAG_PATH.length;
  for (let i = Math.max(0, n - left); i < n; i++) {
    const [x, y] = RAG_PATH[i];
    // (how far in from the flame: the burning end glows, the next is scorched)
    const k = lit ? i - (n - left) : -1;
    a.set(x, y, k === 0 ? EMBER : k === 1 ? SCORCHED : i % 2 ? RAG[2] : RAG[3]);
  }
  for (const [x, y] of RAG_BASE) a.set(x, y, RAG[2]);
  a.set(3, 1, RAG[3]).set(5, 2, RAG[1]);
  if (lit && left === 0) a.set(RAG_KNOT[0], RAG_KNOT[1], EMBER).set(3, 1, SCORCHED);
  return a;
}

// ------------------------------------------------------------------ RPG

/**
 * The rocket pointing right: tail fins, the motor's thin tube, the warhead's
 * olive bulb with a yellow band, and its steel nose cone.
 */
export function rocketArt(): PixelArt {
  const a = new PixelArt(16, 6);
  a.rect(1, 2, 8, 2, GUNMETAL[2]);
  a.rect(0, 1, 2, 4, GUNMETAL[1]);
  a.ellipse(9, 0, 6, 6, OLIVE[2]);
  a.poly([[14, 1], [16, 3], [14, 5]], STEEL[2]);
  finish(a, { shadow: false });
  a.vline(11, 1, 4, YELLOW[2]);
  a.set(15, 2, STEEL_LT[3]);
  return a;
}

/** Where the rocket's art sits on the loaded launcher's (its top-left pixel), and the first of its columns that shows out of the muzzle. */
export const ROCKET_IN_TUBE: [number, number] = [23, 2];
const ROCKET_SHOWS = 9;

/** How many of the rocket's columns show out of the muzzle once it's all the way in. */
export const WARHEAD_SHOWS = 16 - ROCKET_SHOWS;

const rpgs = new Map<string, PixelArt>();

/**
 * The launcher pointing right; `loaded`, with a rocket's warhead sticking out of
 * the muzzle, `inset` pixels short of all the way in (sliding in as it reloads).
 */
export function rpgArt(loaded: boolean, inset = 0): PixelArt {
  const key = `${loaded}:${inset}`;
  let a = rpgs.get(key);
  if (!a) rpgs.set(key, (a = drawRpg(loaded, inset)));
  return a;
}

function drawRpg(loaded: boolean, inset: number): PixelArt {
  const a = new PixelArt(39, 11);
  // the flared venturi at the back, the tube, and the wooden heat guard round its middle
  a.poly([[0, 1.5], [6, 3], [6, 7], [0, 8.5]], GUNMETAL[2]);
  a.rect(5, 3, 27, 4, GUNMETAL[2]);
  a.rect(10, 2, 13, 6, WOOD[2]);
  // the optical sight on top, the pistol grip below and a front grip by the muzzle
  a.rect(13, 0, 6, 2, GUNMETAL[1]);
  a.poly([[19, 8], [21, 8], [20, 11], [18, 11]], POLYMER[2]);
  a.rect(26, 7, 2, 3, POLYMER[2]);
  finish(a);
  // the guard's seam, the sight's lens, the trigger and the front sight post
  a.hline(11, 21, 5, WOOD[1]);
  a.set(13, 0, GLASS[3]);
  a.set(21, 8, POLYMER[0]);
  a.set(30, 2, GUNMETAL[1]);
  if (loaded && inset < WARHEAD_SHOWS) {
    // the warhead sticks out of the muzzle; the rest of the rocket is in the tube
    const r = rocketArt();
    const [ox, oy] = ROCKET_IN_TUBE;
    for (let y = 0; y < r.h; y++) {
      for (let x = ROCKET_SHOWS + inset; x < r.w; x++) if (r.filled(x, y)) a.set(ox + x - inset, oy + y, r.get(x, y));
    }
  } else a.set(31, 4, GUNMETAL[0]).set(31, 5, GUNMETAL[0]);
  return a;
}

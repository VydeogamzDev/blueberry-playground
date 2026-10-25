import { PixelArt, CLEAR } from './PixelArt';
import { finish, ramp, GUNMETAL, ORANGE, POLYMER, RED, STEEL, STEEL_LT, WHITE, WOOD, WOOD_DARK, WOOD_PALE, YELLOW, KHAKI, type Ramp } from './palette';
import { DRUG_RAMPS } from './items';

// The crossbow and its bolts. The crossbow follows the guns' rules (palette
// ramps, finish() for outline and lighting); the string and the bolts are one
// pixel thick, so they're painted pixel by pixel in ramp shades instead (an
// outline pass would turn them all to outline).

/** What a bolt does when it hits (see entities/Crossbow). */
export type BoltKind = 'normal' | 'poison' | 'explosive' | 'incendiary' | 'tranquilizer' | 'firework';

/** A bolt's head and fletching: each kind its own colour, so a glance tells them apart (in the groove, in flight, stuck in someone). */
const LOOKS: Record<BoltKind, { head: Ramp; fletch: Ramp }> = {
  normal: { head: STEEL_LT, fletch: WHITE },
  poison: { head: DRUG_RAMPS.poison, fletch: DRUG_RAMPS.poison },
  explosive: { head: RED, fletch: RED },
  incendiary: { head: ORANGE, fletch: YELLOW },
  tranquilizer: { head: DRUG_RAMPS.knockout, fletch: DRUG_RAMPS.knockout },
  firework: { head: ramp('#8a4aa8'), fletch: ramp('#3f8a4a') },
};

/** A bolt's size (art px): its nock at x = 0, its point at x = BOLT_W - 1, the shaft along the middle row. */
export const BOLT_W = 16;
export const BOLT_H = 3;

const bolts = new Map<string, PixelArt>();

/**
 * A bolt pointing right. `cut`: that many columns from the point are left out
 * (the part sunk into whatever it's stuck in, which would otherwise show on top of it).
 */
export function boltArt(kind: BoltKind, cut = 0): PixelArt {
  const key = `${kind}:${cut}`;
  let a = bolts.get(key);
  if (!a) bolts.set(key, (a = drawBolt(kind, cut)));
  return a;
}

function drawBolt(kind: BoltKind, cut: number): PixelArt {
  const a = new PixelArt(BOLT_W, BOLT_H);
  const { head, fletch } = LOOKS[kind];
  // the shaft, light wood, with the nock at the back
  a.hline(1, 12, 1, WOOD_PALE[2]);
  a.set(0, 1, POLYMER[1]);
  // three vanes: one above, one below, and the third seen edge-on along the shaft
  a.hline(1, 4, 0, fletch[3]).hline(1, 4, 2, fletch[1]).hline(1, 4, 1, fletch[2]);
  a.set(1, 0, fletch[2]).set(1, 2, fletch[0]);
  switch (kind) {
    case 'normal':
      // a steel broadhead: barbs either side, the point catching the light
      a.set(12, 0, head[1]).set(12, 2, head[0]).hline(12, 14, 1, head[2]).set(15, 1, head[4]);
      break;
    case 'poison':
      // a broadhead smeared dark with poison, a band of it round the shaft behind
      a.set(12, 0, head[2]).set(12, 2, head[0]).hline(12, 14, 1, head[1]).set(15, 1, STEEL_LT[3]);
      a.set(11, 1, head[3]);
      break;
    case 'explosive':
      // a red charge with a yellow band, and a steel striker on its nose
      a.hline(10, 13, 0, head[3]).hline(10, 13, 1, head[2]).hline(10, 13, 2, head[1]);
      a.set(11, 0, YELLOW[3]).set(11, 1, YELLOW[2]).set(11, 2, YELLOW[1]);
      a.set(14, 1, STEEL[2]).set(15, 1, STEEL_LT[3]);
      break;
    case 'incendiary':
      // a bundle of fuel-soaked wrapping, bound twice, behind a short spike
      a.hline(10, 13, 0, head[3]).hline(10, 13, 1, head[2]).hline(10, 13, 2, head[1]);
      a.set(10, 0, head[1]).set(10, 2, head[0]).set(12, 0, head[1]).set(12, 1, head[0]).set(12, 2, head[0]);
      a.set(14, 1, STEEL[2]).set(15, 1, STEEL_LT[3]);
      break;
    case 'tranquilizer':
      // a dart: a little vial of sedative behind a hollow needle
      a.hline(11, 13, 1, head[2]).set(12, 0, head[3]).set(12, 2, head[1]);
      a.set(14, 1, STEEL_LT[2]).set(15, 1, STEEL_LT[4]);
      break;
    case 'firework':
      // a little rocket: a paper tube with gold stars on it, its fuse at the back, under a gold cone
      a.hline(9, 13, 0, head[3]).hline(9, 13, 1, head[2]).hline(9, 13, 2, head[1]);
      a.set(10, 0, YELLOW[4]).set(12, 2, YELLOW[3]).set(8, 1, KHAKI[1]);
      a.set(14, 0, YELLOW[2]).set(14, 1, YELLOW[3]).set(14, 2, YELLOW[1]).set(15, 1, YELLOW[4]);
      break;
  }
  for (let x = BOLT_W - cut; x < BOLT_W; x++) for (let y = 0; y < BOLT_H; y++) a.set(x, y, CLEAR);
  return a;
}

/** Where a loaded bolt's art sits on the crossbow's (its top-left pixel): its nock at the latch, along the groove. */
export const BOLT_ON_BOW: [number, number] = [16, 5];
/** Where the string meets the tiller (its x) as it's drawn back: let go, half way, and caught on the latch. */
const STRING_AT = [25, 21, 16];
/** The tips of the prod's limbs, where the string is tied on. */
const TIP_TOP: [number, number] = [25, 0];
const TIP_BOTTOM: [number, number] = [25, 14];
const STRING = KHAKI[3];

const bows = new Map<string, PixelArt>();

/**
 * The crossbow pointing right, its string `draw`n back so far (0 let go, 1 half
 * way, 2 caught on the latch), with a bolt of the kind `bolt` in the groove, or none.
 */
export function crossbowArt(draw: number, bolt: BoltKind | null): PixelArt {
  const key = `${draw}:${bolt}`;
  let a = bows.get(key);
  if (!a) bows.set(key, (a = drawCrossbow(draw, bolt)));
  return a;
}

function drawCrossbow(draw: number, bolt: BoltKind | null): PixelArt {
  const a = new PixelArt(34, 15);
  // the stock: a butt set against the shoulder, narrowing to the wrist
  a.poly([[0, 5.5], [4, 5.5], [13, 7], [13, 10], [6, 10], [2, 11.5], [0, 11.5]], WOOD[2]);
  // the tiller running forward to the prod, the bolt's groove along its top
  a.rect(12, 7, 19, 3, WOOD[2]);
  // the pistol grip, and the trigger housing with the latch on top of the tiller
  a.poly([[12, 10], [15, 10], [14, 14], [11, 14]], POLYMER[2]);
  a.rect(14, 5, 4, 2, GUNMETAL[2]);
  // the prod: a steel riser round the tiller, its limbs sweeping up and down from it
  a.poly([[26, 5], [28, 5], [27, 0], [25, 0]], POLYMER[2]);
  a.poly([[26, 10], [28, 10], [27, 15], [25, 15]], POLYMER[2]);
  a.rect(26, 5, 3, 6, GUNMETAL[2]);
  finish(a);
  // the stock's grain and butt plate, the trigger, and a bolt holding the riser on
  a.hline(3, 9, 8, WOOD[1]);
  a.vline(0, 6, 10, WOOD_DARK[1]);
  a.set(15, 10, POLYMER[0]).set(15, 11, POLYMER[0]);
  a.set(27, 8, STEEL_LT[3]);
  // the string, from the limbs' tips to where it crosses the tiller
  const sx = STRING_AT[Math.max(0, Math.min(2, draw))];
  a.line(TIP_TOP[0], TIP_TOP[1], sx, 5, STRING);
  a.line(TIP_BOTTOM[0], TIP_BOTTOM[1], sx, 10, STRING);
  a.vline(sx, 5, 10, STRING);
  if (bolt) a.blit(boltArt(bolt), BOLT_ON_BOW[0], BOLT_ON_BOW[1]);
  return a;
}

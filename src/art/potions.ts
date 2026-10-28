import { draw, finish, GLASS, WOOD, type Ramp } from './palette';
import type { PixelArt } from './PixelArt';

// Splash potions (see entities/SplashPotion): a small round glass bottle with a
// cork in it, one picture for them all, its liquid in the colours of the drug
// it holds (a syringe's: see DRUG_RAMPS). Same rules as every other sprite:
// palette ramps, finish() for outline and lighting, one-pixel details after.

/** Its size (art px), and where it's held: by the neck. */
export const POTION_W = 7;
export const POTION_H = 11;
export const POTION_GRIP: [number, number] = [3, 3];

/**
 * A splash potion standing upright: a round glass bulb on a short neck with a
 * lip, corked, `liquid` (a drug's ramp) filling the bulb up to its shoulders.
 */
export function potionArt(liquid: Ramp): PixelArt {
  const a = draw(POTION_W, POTION_H, [
    '.......',
    '.......',
    '.ggggg.',
    '..ggg..',
    '..ggg..',
    '.ggggg.',
    'gLLLLLg',
    'gLLLLLg',
    'gLLLLLg',
    '.gLLLg.',
    '..ggg..',
  ], { g: GLASS[2], L: liquid[2] });
  finish(a, { shadow: false });
  // the liquid's surface catching the light, and a glint down its near side
  for (let x = 1; x <= 5; x++) a.set(x, 6, liquid[3]);
  a.set(1, 7, liquid[4]).set(1, 8, liquid[3]).set(5, 8, liquid[1]).set(4, 9, liquid[1]);
  // light off the glass above it
  a.set(2, 5, GLASS[4]).set(3, 3, GLASS[3]);
  // the cork in its mouth (a thin thing: all outline if it went through finish())
  a.set(2, 0, WOOD[3]).set(3, 0, WOOD[3]).set(4, 0, WOOD[2]);
  a.set(2, 1, WOOD[2]).set(3, 1, WOOD[2]).set(4, 1, WOOD[1]);
  return a;
}

import { PixelArt } from './PixelArt';
import { finish, ramp } from './palette';

// cooked lean and golden fat
const LEAN = ramp('#a3412a');
const FAT = ramp('#e0b27e', 0.8);

/** How far down (px) the top edge sits along the strip: cooked bacon ripples. */
const WAVE = [1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0];

/** The strip is made of this many links (see Bacon), each this many pixels long. */
export const BACON_LINK_W = 5;
export const BACON_LINKS = WAVE.length / BACON_LINK_W;

/** A whole strip, seen face on: lean along the edges and down the middle, fat between, a few crisp bits. */
export function baconArt(): PixelArt {
  const a = new PixelArt(WAVE.length, 6);
  WAVE.forEach((top, x) => {
    [LEAN[2], FAT[2], LEAN[2], FAT[2], LEAN[2]].forEach((c, i) => a.set(x, top + i, c));
  });
  for (const [x, y] of [[3, 1], [9, 3], [12, 2]]) a.set(x, y + WAVE[x], LEAN[1]);
  return finish(a);
}

const links: PixelArt[] = [];

/** Link i's piece of the strip. */
export function baconLinkArt(i: number): PixelArt {
  if (!links.length) {
    const a = baconArt();
    for (let k = 0; k < BACON_LINKS; k++) {
      const p = new PixelArt(BACON_LINK_W, a.h);
      for (let y = 0; y < a.h; y++) for (let x = 0; x < BACON_LINK_W; x++) p.set(x, y, a.get(k * BACON_LINK_W + x, y));
      links.push(p);
    }
  }
  return links[i];
}

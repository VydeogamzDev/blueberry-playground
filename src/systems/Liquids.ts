import { PX, WORLD } from '../engine/constants';
import { fromRgb } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** Liquid kinds carried by droplets (blood keeps its own on/off setting). */
export const enum Liquid {
  Blood = 0,
  Water = 1,
  Acid = 2,
  Oil = 3,
}

export type LiquidName = 'water' | 'acid' | 'oil';

export const LIQUID_IDS: Record<LiquidName, Liquid> = { water: Liquid.Water, acid: Liquid.Acid, oil: Liquid.Oil };

/** Droplet shades per liquid (a few so streams don't look flat). */
export const LIQUID_COLORS: Record<number, number[]> = {
  [Liquid.Blood]: [0x7d0d0d, 0x941616, 0x660909],
  [Liquid.Water]: [0x3f7fc8, 0x5a96d6, 0x356fb0],
  [Liquid.Acid]: [0x86d633, 0x9fe84a, 0x6cb827],
  [Liquid.Oil]: [0x2b2620, 0x3a332a, 0x221e1a],
};

/** Corroded flesh/material left by acid. */
const ACID_SCAR = 0x4d5a1f;

const lastSound = new Map<string, number>();

/** Plays a liquid sound at most every `gap` seconds of game time (streams land many drops a second). */
export function liquidSound(game: Game, key: string, x: number, gain: number, gap: number): void {
  const t = lastSound.get(key) ?? -Infinity;
  if (game.time - t < gap && game.time >= t) return;
  lastSound.set(key, game.time);
  game.sound.play(key, { gain, x, vary: 0.12 });
}

/**
 * A droplet hit something: blood stains, water puts out fires and washes off oil,
 * acid eats into whatever it lands on, oil soaks in and makes things burn.
 */
export function landDroplet(game: Game, liquid: Liquid, part: Part | null, x: number, y: number, nx: number, ny: number, r: number, g: number, b: number): void {
  const ix = x - nx * PX * 0.5;
  const iy = y - ny * PX * 0.5;
  // drops landing on the floor pool up
  const floor = !part && ny > 0.7 && y < WORLD.floor + PX * 6;
  if (floor && liquid !== Liquid.Blood) {
    game.puddles.add(liquid, x);
    liquidSound(game, 'liquid/drip', x, 0.18, 0.09);
  }
  switch (liquid) {
    case Liquid.Blood:
      if (part) part.paintAt(ix, iy, fromRgb(r * 255 * 0.85, g * 255 * 0.85, b * 255 * 0.85), 0, 0.85);
      else floorStain(game, ix, iy, ny, r, g, b, 0.95);
      return;
    case Liquid.Water:
      if (part) {
        if (part.burning > 0) {
          // a flask's worth (~270 drops) puts out a few burning things, not a whole bonfire
          part.burning -= 0.015;
          if (Math.random() < 0.3) game.particles.smoke(x, y + 0.05, 1, 0.12);
          liquidSound(game, 'liquid/steam', x, 0.35, 0.3);
          if (part.burning <= 0.02) game.fire.extinguish(part);
        }
        part.oil = Math.max(0, part.oil - 0.04);
      } else if (!floor && Math.random() < 0.25) floorStain(game, ix, iy, ny, r * 0.5, g * 0.5, b * 0.6, 0.22);
      return;
    case Liquid.Acid:
      if (part) {
        part.entity.damage(part, 0.9, 'acid', { x, y }, { x: -nx, y: -ny });
        if (!part.destroyed) part.paintAt(ix, iy, ACID_SCAR, 0, 0.7);
      } else floorStain(game, ix, iy, ny, 0.3, 0.38, 0.12, floor ? 0.4 : 0.8);
      if (Math.random() < 0.25) game.particles.smoke(x, y + 0.03, 1, 0.08);
      liquidSound(game, 'liquid/sizzle', x, part ? 0.35 : 0.2, 0.25);
      return;
    case Liquid.Oil:
      if (part) {
        part.oil = Math.min(1, part.oil + 0.06);
        part.paintAt(ix, iy, 0x1d1a16, 0, 0.6);
        // oil on something already burning feeds the fire
        if (part.burning > 0.1) game.fire.ignite(part, Math.min(1, part.burning + 0.1));
      } else if (!floor) floorStain(game, ix, iy, ny, r, g, b, 0.85);
      return;
  }
}

function floorStain(game: Game, x: number, y: number, ny: number, r: number, g: number, b: number, a: number): void {
  game.stains.add(x, y, r * 0.8, g * 0.8, b * 0.8, a);
  // occasional spread into a small puddle on the floor
  if (ny > 0.7 && Math.random() < 0.35) game.stains.add(x + (Math.random() < 0.5 ? -PX : PX), y, r * 0.75, g * 0.75, b * 0.75, a * 0.95);
}

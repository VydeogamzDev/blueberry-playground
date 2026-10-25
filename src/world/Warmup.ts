import { getItem } from '../catalog/items';
import type { Game } from './Game';

/**
 * The first heap of people crushed in a session ran at two thirds the frame rate of the
 * next: everything that does it was running for the first time, the game's own code
 * (injuries, gore, blood) and Rapier's (contacts and the solver in a dense heap) still being
 * compiled as it ran, and Rapier's memory still growing. So the game rehearses one while it
 * loads, under the loading screen: a pile of people, a slab slammed down on it, a few limbs
 * blown apart, a moment of it; then all of it is cleared away, as Clear does. `idle` is
 * awaited now and then, to draw the loading screen.
 */
export async function rehearseCrush(game: Game, idle: () => Promise<void>): Promise<void> {
  const human = getItem('human');
  const brick = getItem('brick');
  if (!human || !brick) return;
  const time = game.time;
  try {
    const people = [];
    for (let i = 0; i < 40; i++) {
      const e = game.spawn(human, -6 + (i % 20) * 0.6, 1 + Math.floor(i / 20) * 2);
      if (e) people.push(e);
    }
    for (let i = 0; i < 30; i++) game.step();
    await idle();
    game.spawn(brick, 0, 6.5, { config: { w: 512, h: 96 } })?.setVelocity(0, -20);
    for (let i = 0; i < 45; i++) {
      game.step();
      // (blasts' gore as well as the crush's: a heavy one blows a limb apart, see Human.damage())
      if (i === 20) {
        for (const e of people.slice(0, 6)) {
          for (const p of e.parts.slice(0, 4)) if (!p.destroyed) e.damage(p, 1000, 'explosion', { x: p.x, y: p.y }, { x: 0, y: 1 });
        }
      }
      if (i % 5 === 4) game.renderFrame(1 / 60, 1);
      if (i % 15 === 14) await idle();
    }
  } catch (e) {
    console.warn('warm-up:', e);
  }
  game.resetEnvironment();
  game.time = time;
}

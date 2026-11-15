import { WORLD } from '../engine/constants';
import type { Game } from './Game';

/** How far (m) the camera goes from local (0, 0) before the world is moved back round it (see rebase()). */
export const REBASE_AT = 1024;
/**
 * The world is moved by whole multiples of this (m): stains stay on their sprite
 * pixels, and what's tiled or hashed by world position stays put.
 */
export const REBASE_STEP = 64;

/**
 * The floating origin. On the World map, which goes on for ever every way, the
 * physics and the graphics card keep positions in 32-bit floats: good to a
 * millimetre only within 16 km of (0, 0), coarser further out (things jitter, slow
 * ones can't move at all). So positions everywhere are local, kept near (0, 0) by
 * moving everything back round the camera now and then (rebase()), and the true
 * position of anything is its local one plus (x, y) here, in 64-bit numbers. On
 * every other map the origin stays at (0, 0) and nothing ever moves.
 */
export class Origin {
  /** The true position (m) of local (0, 0). */
  x = 0;
  y = 0;
  /** Goes up with every move. */
  epoch = 0;
  /** Told after each move what was added to every local position (Controls, the multiplayer side, ...). */
  readonly listeners: ((dx: number, dy: number) => void)[] = [];

  /** Back to (0, 0), nothing moved (a new map: everything's gone). */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.epoch++;
  }
}

/** On the World map, once the camera's REBASE_AT from local (0, 0): everything moved back round it. */
export function maybeRebase(game: Game): void {
  if (!game.map.world) return;
  const r = game.renderer;
  if (Math.abs(r.camX) < REBASE_AT && Math.abs(r.camY) < REBASE_AT) return;
  rebase(game, Math.round(r.camX / REBASE_STEP) * REBASE_STEP, Math.round(r.camY / REBASE_STEP) * REBASE_STEP);
}

/**
 * Moves local (0, 0) to the local point (sx, sy): everything in the world, every
 * body, joint, effect, the camera and whatever anything keeps of where things are,
 * moves by (−sx, −sy), and the origin by (sx, sy). Nothing is seen to move. Done
 * between steps, never inside one.
 */
export function rebase(game: Game, sx: number, sy: number): void {
  if (!sx && !sy) return;
  const dx = -sx;
  const dy = -sy;
  const o = game.origin;
  o.x += sx;
  o.y += sy;
  o.epoch++;
  const world = game.physics.world;
  const env = game.env.body.handle;
  // every body (raw ones too: a lodged blade's slider, a hand dragging), and what's
  // held to the background by its anchor in the world
  world.bodies.forEach((b) => {
    if (b.handle === env) return;
    const t = b.translation();
    b.setTranslation({ x: t.x + dx, y: t.y + dy }, false);
  });
  world.impulseJoints.forEach((j) => {
    if (j.body1().handle === env) {
      const a = j.anchor1();
      j.setAnchor1({ x: a.x + dx, y: a.y + dy });
    }
    if (j.body2().handle === env) {
      const a = j.anchor2();
      j.setAnchor2({ x: a.x + dx, y: a.y + dy });
    }
  });
  for (const e of game.entities) if (!e.destroyed) e.shifted(dx, dy);
  // (the World map's floor and ceiling are far off below and above: they move with it;
  // its left and right are a window round the origin, and stay)
  WORLD.floor += dy;
  WORLD.ceiling += dy;
  game.air.base = o.y;
  game.env.shift(dx, dy);
  game.renderer.shift(dx, dy);
  game.particles.shift(dx, dy);
  game.stains.shift(dx, dy);
  game.casings.shift(dx, dy);
  game.projectiles.shift(dx, dy);
  game.explosions.shift(dx, dy);
  game.fire.shift(dx, dy);
  game.fluid.shift(dx, dy);
  game.weather.shift(dx, dy);
  game.connections.shift(dx, dy);
  game.races.shifted(dx, dy);
  if (game.cursor) game.cursor = { x: game.cursor.x + dx, y: game.cursor.y + dy };
  for (const h of o.listeners) h(dx, dy);
}

import { register, lazyArt, previewOf } from './items';
import { MAT, type PhysMaterial } from '../world/Materials';
import { PX } from '../engine/constants';
import * as F from '../art/flight';
import { artRect, densityFor } from '../entities/Item';
import { Thruster } from '../entities/Machines';
import { Cockpit, Gyroscope, HoverThruster, KeyTrigger, ThrottleLever, HOVER } from '../entities/Flight';
import type { PropConfig } from '../entities/Prop';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions } from '../world/types';

// The flight parts (0.3.0): what builds are flown with (see systems/Piloting).
// Registered after the rest of the Machinery (see registry.ts).

function item(
  id: string, name: string, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[],
): ItemDef {
  const def: ItemDef = {
    id, name, category: 'Flight', description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/** Box shapes from art-pixel rects [x, y, w, h]. */
function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

/** A one-part thing's make-up: its art, material, shapes and weight (kg). */
function cfg(art: () => PixelArt, material: PhysMaterial, shapes: ShapeSpec[], mass: number): PropConfig {
  return { art, material, shapes, density: densityFor(mass, shapes) };
}

/** How builds are flown, said once in each flight part's description. */
const FLY = 'Select what it’s built into (or the pilot in its cockpit) to fly it: W and S throttle, A and D move, Q and E turn.';

export function registerFlight(): void {
  const mini = lazyArt(F.miniThrusterArt);
  const miniShapes = rects(9, 6, [[3, 1, 6, 4], [0, 0, 4, 6]]);
  item('mini-thruster', 'Mini Thruster',
    `A small thruster: 300 N, enough to steer with, or for a few to lift something light. Pushes forward while active or powered; set its thrust in its menu. ${FLY}`,
    mini, (game, def, x, y, opts) => new Thruster(game, def, cfg(mini, MAT.metal, miniShapes, 1.5), 300, x, y, opts),
    ['rocket', 'jet', 'engine', 'small', 'rcs', 'steer', 'fly']);

  const hover = lazyArt(() => F.hoverThrusterArt(false));
  const hoverShapes = rects(18, 10, [[0, 1, 18, 6], [2, 6, 14, 4]]);
  item('hover-thruster', 'Hover Thruster',
    `Blows down from its underside to hold itself, and what it’s built into, at a height over whatever is under it (up to ${HOVER.max} m), and eases itself upright. Several hold a build level. Switched on, it holds the height it’s at; flown, the throttle sets the height. It burns fuel from a tank built in with it. ${FLY}`,
    hover, (game, def, x, y, opts) => new HoverThruster(game, def, cfg(hover, MAT.metal, hoverShapes, 8), x, y, opts),
    ['hover', 'float', 'levitate', 'thruster', 'engine', 'fly', 'hovercraft']);

  const gyro = lazyArt(() => F.gyroArt('0:0'));
  const gyroShapes: ShapeSpec[] = [{ kind: 'ball', r: 6.5, y: 1 }, artRect(14, 14, 0, 12, 14, 2)];
  item('gyroscope', 'Gyroscope Stabiliser',
    `Welded into a build, it holds it upright (or at the angle it’s set to hold), turning it back when it tips: strong enough for a cart or a small craft, three times as strong powered. Q and E turn the angle it holds. ${FLY}`,
    gyro, (game, def, x, y, opts) => new Gyroscope(game, def, cfg(gyro, MAT.metal, gyroShapes, 10), 400, false, x, y, opts),
    ['gyro', 'stabiliser', 'stabilizer', 'upright', 'balance', 'fly']);

  const bigGyro = lazyArt(() => F.gyroArt('0:1'));
  const bigGyroShapes: ShapeSpec[] = [{ kind: 'ball', r: 10, y: 1.5 }, artRect(22, 22, 0, 19, 22, 3)];
  item('industrial-gyroscope', 'Industrial Gyroscope',
    `A heavy gyroscope stabiliser, ten times as strong: it holds up a car, a truck or a big craft. ${FLY}`,
    bigGyro, (game, def, x, y, opts) => new Gyroscope(game, def, cfg(bigGyro, MAT.metal, bigGyroShapes, 45), 4000, true, x, y, opts),
    ['gyro', 'stabiliser', 'stabilizer', 'upright', 'balance', 'heavy', 'fly']);

  const key = lazyArt(() => F.keyTriggerArt(false));
  const keyShapes = rects(12, 8, [[0, 3, 12, 5], [2, 0, 8, 4]]);
  item('key-trigger', 'Key Trigger',
    'Wire it to things: its key (set in its menu: T, Y, U, I, O, P, K or L) works them, on while it’s held (or on and off each press, or a pulse each press). With no battery in its circuit, it powers it itself.',
    key, (game, def, x, y, opts) => new KeyTrigger(game, def, cfg(key, MAT.plastic, keyShapes, 0.4), x, y, opts),
    ['key', 'keyboard', 'button', 'trigger', 'switch', 'control', 'electric']);

  const seat = lazyArt(F.cockpitArt);
  const seatShapes = rects(F.COCKPIT.w, F.COCKPIT.h, [[0, 18, 24, 4], [3, 12, 13, 4], [0, 1, 5, 12], [18, 7, 4, 11]]);
  item('cockpit', 'Cockpit Seat',
    `Build it into something with engines and drop someone in it: it’s flown from here, its up the craft’s up. ${FLY}`,
    seat, (game, def, x, y, opts) => new Cockpit(game, def, cfg(seat, MAT.metal, seatShapes, 25), x, y, opts),
    ['seat', 'cockpit', 'pilot', 'chair', 'fly', 'drive', 'vehicle']);

  const lever = lazyArt(() => F.throttleLeverArt(0));
  const leverShapes = rects(14, 14, [[0, 10, 14, 4], [2, 6, 10, 4]]);
  item('throttle-lever', 'Throttle Lever',
    'Wired between power and engines (thrusters, jets, propellers, motors, lamps), it lets through as much of the power as it’s pulled, and they run that hard. On its own, it powers them itself. F pulls it a quarter further; set any share from its menu.',
    lever, (game, def, x, y, opts) => new ThrottleLever(game, def, cfg(lever, MAT.metal, leverShapes, 2), x, y, opts),
    ['throttle', 'lever', 'dimmer', 'power', 'speed', 'control', 'electric']);
}

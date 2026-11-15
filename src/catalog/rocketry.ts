import { register, lazyArt, previewOf } from './items';
import { MAT, ABLATOR, type PhysMaterial } from '../world/Materials';
import { PX } from '../engine/constants';
import * as R from '../art/rocketry';
import { artRect, densityFor } from '../entities/Item';
import { Prop, type PropConfig } from '../entities/Prop';
import {
  Canopy, ControlFlap, Decoupler, DockingPort, FuelTank, GimbalThruster, HeatShield, LandingLeg, LaunchClamp, Parachute, RcsThruster, SolidBooster,
} from '../entities/Rocketry';
import { CapsuleSeat, EjectionSeat, Helmet, OxygenTank, O2_LAST } from '../entities/Crew';
import { CameraPart, ScreenPart } from '../entities/Cameras';
import type { PixelArt } from '../art/PixelArt';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Category, ItemDef, SpawnOptions } from '../world/types';

// The rocketry parts (0.4.0): see entities/Rocketry. In the toybox's Flight & space.

function item(
  id: string, name: string, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[], hidden = false, category: Category = 'Flight',
): ItemDef {
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
    ...(hidden ? { hidden: true } : {}),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

export function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

export function cfg(art: () => PixelArt, material: PhysMaterial, shapes: ShapeSpec[], mass: number, more: Partial<PropConfig> = {}): PropConfig {
  return { art, material, shapes, density: densityFor(mass, shapes), ...more };
}

/** How builds are flown, said once in each part's description. */
const FLY = 'Select what it’s built into (or the pilot in its cockpit) to fly it.';
/** How stages work, said once in each stageable part's description. */
const STAGE = 'Give it a stage in its menu: flown, Enter fires the next stage.';

export function registerRocketry(): void {
  for (const size of ['small', 'big'] as const) {
    const art = lazyArt(() => R.fuelTankArt(size));
    const { w, h } = R.TANK[size];
    const shapes = rects(w, h, [[0, 1, w, h - 2]], 2);
    const fuel = size === 'small' ? 40 : 200;
    item(size === 'small' ? 'fuel-tank' : 'big-fuel-tank', size === 'small' ? 'Fuel Tank' : 'Big Fuel Tank',
      `Holds ${fuel} kg of fuel for the thrusters, jets and engines built into the same build (not across a decoupler: each stage burns its own). It gets lighter as it empties. Shot, it leaks; burning, or broken open full, it goes up. Fill it from its menu. ${FLY}`,
      art, (game, def, x, y, opts) => new FuelTank(game, def, cfg(art, MAT.sheetMetal, shapes, size === 'small' ? 6 : 25, { hollow: true }), fuel, x, y, opts),
      ['fuel', 'tank', 'rocket', 'propellant', 'gas', 'petrol', 'stage']);
  }

  const dec = lazyArt(R.decouplerArt);
  const decShapes = rects(32, 5, [[0, 0, 32, 5]]);
  item('decoupler', 'Decoupler',
    `Build it between a rocket’s stages: fired, it lets go of what’s fixed to its top side and throws the two apart. Fuel doesn’t pass it. ${STAGE} Or press F, or pulse it.`,
    dec, (game, def, x, y, opts) => new Decoupler(game, def, cfg(dec, MAT.metal, decShapes, 8), x, y, opts),
    ['decoupler', 'stage', 'separation', 'rocket', 'split']);

  for (const big of [false, true]) {
    const art = lazyArt(() => R.parachutePackArt(false));
    const shapes = rects(14, 9, [[0, 0, 14, 9]], 1.5);
    item(big ? 'big-parachute' : 'parachute', big ? 'Heavy Parachute' : 'Parachute',
      `Weld it to the top of what should come down slowly${big ? ' (a capsule, a car, a big rocket: about a tonne)' : ' (up to a few hundred kg)'}. Opened (the pilot’s chute key ], F, a pulse or its stage) its canopy pulls against the air; opened too fast, it tears. Open it again to cut it away. ${STAGE}`,
      art, (game, def, x, y, opts) => new Parachute(game, def, cfg(art, MAT.plastic, shapes, big ? 15 : 6), big, false, x, y, opts),
      ['parachute', 'chute', 'canopy', 'landing', 'slow', 'fall', 'rocket', 'capsule']);
  }
  const worn = lazyArt(() => R.parachutePackArt(true));
  const wornShapes = rects(9, 11, [[0, 0, 9, 11]], 1.5);
  item('backpack-parachute', 'Backpack Parachute',
    'Drop it onto someone: it straps onto their back, and if they fall fast from high up, it opens by itself (or open it from its menu, or press ] flying). Ejection seats give their pilot one.',
    worn, (game, def, x, y, opts) => new Parachute(game, def, cfg(worn, MAT.plastic, wornShapes, 4), false, true, x, y, opts),
    ['parachute', 'backpack', 'skydive', 'chute', 'jump', 'person', 'wear']);
  for (const big of [false, true]) {
    const art = lazyArt(() => R.canopyArt(big));
    const w = big ? 120 : 72;
    const h = big ? 34 : 22;
    const shapes = rects(w, h, [[2, 0, w - 4, Math.round(h * 0.55)]], 2);
    item(big ? 'parachute-canopy-big' : 'parachute-canopy', 'Parachute Canopy', 'A parachute’s canopy, out on its lines.',
      art, (game, def, x, y, opts) => new Canopy(game, def, cfg(art, MAT.plastic, shapes, big ? 12 : 4, { angularDamping: 3 }), big, x, y, opts),
      ['parachute'], true);
  }

  for (const wheel of [false, true]) {
    const art = lazyArt(R.legMountArt);
    item(wheel ? 'landing-gear' : 'landing-leg', wheel ? 'Landing Gear' : 'Landing Leg',
      wheel
        ? `A wheel on a strut that folds away: weld its mount under a plane. The pilot’s gear key [ (or F, or a pulse) folds it up and lets it down; it’s sprung, to take a landing. ${FLY}`
        : `A sprung leg that swings down to stand a rocket on (a shock absorber: it takes a landing), and folds up along it. Weld its mount on; the pilot’s gear key [ (or F, a pulse or its stage) folds it or lets it down. ${STAGE}`,
      art, (game, def, x, y, opts) => new LandingLeg(game, def, wheel, wheel ? 3500 : 6000, x, y, opts),
      wheel ? ['landing', 'gear', 'wheel', 'plane', 'undercarriage', 'fold'] : ['landing', 'leg', 'rocket', 'lander', 'shock', 'suspension']);
  }

  const boost = lazyArt(R.boosterArt);
  const boostShapes = rects(52, 10, [[5, 0, 41, 10], [0, 1, 6, 8], [46, 2, 6, 6]]);
  item('solid-booster', 'Solid Booster',
    `A solid rocket: lit (F, a pulse, its stage, or the throttle when flown) it pushes 9000 N till its 60 kg of propellant is gone, about 17 s, and nothing stops it. It needs no tank. Strap a few round a rocket for liftoff. ${STAGE}`,
    boost, (game, def, x, y, opts) => new SolidBooster(game, def, cfg(boost, MAT.sheetMetal, boostShapes, 25), 9000, 60, x, y, opts),
    ['booster', 'solid', 'rocket', 'srb', 'engine', 'stage', 'launch']);

  const rcs = lazyArt(R.rcsArt);
  const rcsShapes = rects(8, 6, [[0, 0, 6, 6], [5, 2, 3, 2]]);
  item('rcs-thruster', 'Turning Thruster',
    `A small cold-gas thruster (120 N) with its own bottle of gas: a few round a craft turn it in space, where fins and flaps do nothing. It pushes away from its nozzle. Refill it from its menu. ${FLY}`,
    rcs, (game, def, x, y, opts) => new RcsThruster(game, def, cfg(rcs, MAT.metal, rcsShapes, 1), 120, x, y, opts),
    ['rcs', 'thruster', 'turn', 'space', 'gas', 'small', 'attitude']);

  const gim = lazyArt(R.gimbalThrusterArt);
  const gimShapes = rects(18, 12, [[5, 1, 13, 10], [0, 0, 7, 12]]);
  item('gimbal-thruster', 'Swivelling Thruster',
    `A big thruster (5000 N) on a gimbal: flown, it turns its push a little to steer the craft, as real rockets do, with no other thrusters needed. It burns fuel from the tanks in its build. ${STAGE}`,
    gim, (game, def, x, y, opts) => new GimbalThruster(game, def, cfg(gim, MAT.metal, gimShapes, 30), 5000, x, y, opts),
    ['gimbal', 'thruster', 'rocket', 'engine', 'steer', 'vector', 'stage']);

  const shield = lazyArt(R.heatShieldArt);
  const shieldShapes = rects(40, 7, [[0, 3, 40, 4], [8, 0, 24, 4]]);
  item('heat-shield', 'Heat Shield',
    'Weld it to the front of what comes back down from space: coming in fast, the air heats whatever leads, past melting. The shield takes it, burning slowly away, and shades what’s behind it.',
    shield, (game, def, x, y, opts) => new HeatShield(game, def, cfg(shield, ABLATOR, shieldShapes, 20), x, y, opts),
    ['heat', 'shield', 'reentry', 'capsule', 'space', 'ablative']);

  const fin = lazyArt(R.finArt);
  const finShapes = rects(24, 16, [[0, 10, 24, 6], [6, 3, 12, 7], [8, 0, 6, 3]]);
  item('fin', 'Fin',
    'A rocket fin: weld a few round the tail and the air turns the rocket to fly point first, steady, as an arrow’s feathers do. Useless in space.',
    fin, (game, def, x, y, opts) => new Prop(game, def, cfg(fin, MAT.sheetMetal, finShapes, 3, { depth: 0.6 }), x, y, opts),
    ['fin', 'rocket', 'stability', 'tail', 'aero']);

  for (const plane of [false, true]) {
    const art = lazyArt(R.flapMountArt);
    item(plane ? 'elevator' : 'control-flap', plane ? 'Elevator' : 'Control Flap',
      plane
        ? `A plane’s tail flap on a hinge: weld its hinge on behind the wings and, flown, it swings to pitch the plane up or down (Q and E). Set its trim in its menu, or make it a landing flap on the wings (F lowers it, for more lift slow). ${FLY}`
        : `A steering flap on a hinge: weld it on a rocket’s tail (or a plane’s) and, flown, it swings to turn the craft as the air goes by (Q and E), whichever way that takes. ${FLY}`,
      art, (game, def, x, y, opts) => new ControlFlap(game, def, plane, x, y, opts),
      plane ? ['elevator', 'flap', 'plane', 'tail', 'trim', 'pitch', 'aileron'] : ['flap', 'fin', 'rudder', 'steer', 'rocket', 'control', 'surface']);
  }

  const clampArt = lazyArt(() => R.clampArt(false));
  const clampShapes = rects(16, 20, [[0, 0, 6, 20], [6, 4, 10, 8]]);
  item('launch-clamp', 'Launch Clamp',
    `Fixed where it’s put: weld it to a rocket on its pad. It holds it steady till its engines push harder than it weighs for a second, then lets go. ${STAGE} Or press F.`,
    clampArt, (game, def, x, y, opts) => new LaunchClamp(game, def, cfg(clampArt, MAT.metal, clampShapes, 40), x, y, opts),
    ['clamp', 'launch', 'pad', 'tower', 'rocket', 'hold']);

  const dock = lazyArt(() => R.dockingPortArt(false));
  const dockShapes = rects(8, 18, [[0, 0, 8, 18]]);
  item('docking-port', 'Docking Port',
    'Two of them face to face and close pull together (magnets) and lock, joining two craft into one. Press F to undock: they push apart.',
    dock, (game, def, x, y, opts) => new DockingPort(game, def, cfg(dock, MAT.metal, dockShapes, 12), x, y, opts),
    ['dock', 'docking', 'port', 'magnet', 'space', 'station', 'join']);
  const seatShapes = rects(24, 22, [[0, 18, 24, 4], [3, 12, 13, 4], [0, 1, 5, 12], [18, 7, 4, 11]]);
  const ej = lazyArt(R.ejectionSeatArt);
  item('ejection-seat', 'Ejection Seat',
    `A cockpit seat that throws its pilot clear: on the eject key ' (or F, or a pulse) it tears free of the craft and rockets up, then lets them go under a parachute (strapped on them if they’ve none). ${FLY}`,
    ej, (game, def, x, y, opts) => new EjectionSeat(game, def, cfg(ej, MAT.metal, seatShapes, 30), x, y, opts),
    ['eject', 'ejection', 'seat', 'cockpit', 'pilot', 'escape', 'parachute', 'plane']);
  const cap = lazyArt(R.capsuleSeatArt);
  item('capsule-seat', 'Capsule Seat',
    `A sealed cockpit seat: with an Oxygen Tank built into the same craft, its pilot breathes in space and under water. ${FLY}`,
    cap, (game, def, x, y, opts) => new CapsuleSeat(game, def, cfg(cap, MAT.metal, seatShapes, 35), x, y, opts),
    ['capsule', 'seat', 'cockpit', 'space', 'sealed', 'oxygen', 'astronaut', 'submarine']);
  const helm = lazyArt(R.helmetArt);
  const helmShapes: ShapeSpec[] = [{ kind: 'ball', r: 5 }];
  item('space-helmet', 'Spacesuit Helmet',
    'Drop it onto someone’s head: with an Oxygen Tank on their back (or sat in a capsule with one), they breathe in space and under water.',
    helm, (game, def, x, y, opts) => new Helmet(game, def, cfg(helm, MAT.plastic, helmShapes, 2), x, y, opts),
    ['helmet', 'space', 'spacesuit', 'astronaut', 'oxygen', 'diving', 'wear']);
  const o2 = lazyArt(R.oxygenTankArt);
  const o2Shapes = rects(6, 14, [[0, 2, 6, 12], [2, 0, 2, 3]], 1);
  item('oxygen-tank', 'Oxygen Tank',
    `Air for ${O2_LAST / 60} minutes of breathing: drop it onto someone’s back (with a Spacesuit Helmet on), or build it into a craft with a Capsule Seat. It only runs down where the air’s thin or under water.`,
    o2, (game, def, x, y, opts) => new OxygenTank(game, def, cfg(o2, MAT.metal, o2Shapes, 3), x, y, opts),
    ['oxygen', 'air', 'tank', 'scuba', 'space', 'astronaut', 'diving', 'wear']);
  const camArt = lazyArt(R.cameraArt);
  const camShapes = rects(12, 8, [[0, 1, 12, 7]], 1);
  item('camera-part', 'Camera',
    'A camera: wire it to a Screen to show what it sees, live (set how close it looks in its menu). Built into something flown, its view shows in a box in the corner of the screen too.',
    camArt, (game, def, x, y, opts) => new CameraPart(game, def, cfg(camArt, MAT.plastic, camShapes, 0.8), x, y, opts),
    ['camera', 'video', 'view', 'pip', 'rear view', 'screen', 'electric'], false, 'Machinery');
  const scrArt = lazyArt(R.screenArt);
  const scrShapes = rects(R.SCREEN.w, R.SCREEN.h, [[0, 0, R.SCREEN.w, 20], [13, 20, 6, 2]], 1);
  item('screen-part', 'Screen',
    'Wire it to a Camera: it shows what the camera sees, live.',
    scrArt, (game, def, x, y, opts) => new ScreenPart(game, def, cfg(scrArt, MAT.plastic, scrShapes, 2), x, y, opts),
    ['screen', 'monitor', 'display', 'tv', 'camera', 'video', 'electric'], false, 'Machinery');
}

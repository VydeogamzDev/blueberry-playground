import { register, lazyArt, previewOf, getItem } from './items';
import { ARMOUR, MAT, type PhysMaterial } from '../world/Materials';
import { PX } from '../engine/constants';
import * as V from '../art/vehicles2';
import * as P from '../art/power';
import { PixelArt } from '../art/PixelArt';
import { artRect, densityFor } from '../entities/Item';
import { CarEngine, Headlight, Horn, NitroBottle, NITRO_S, SuspensionStrut, TowHitch } from '../entities/Vehicles2';
import { Sensor } from '../entities/Sensors';
import { HeliRotor, Wing } from '../entities/Aircraft';
import { Anchor, BALLAST, BallastTank, BoatPropeller, Outboard, Sail } from '../entities/Boats';
import { AIRBAG, Airbag, FireSuppressor, SUPPRESSOR } from '../entities/Safety';
import { Grabber } from '../entities/Grabbers';
import { RailWheel, RAIL_WHEEL_MAT, RAIL_WHEEL_R } from '../entities/Rails';
import { CoasterCar, COASTER_WHEELS } from '../entities/Coaster';
import { Fixture, FuelPump, PUMP, RaceGate } from '../entities/Places';
import { AERIAL_BOMB, AerialBomb, BAY, BombBay, DISPENSER, Flare, FlareDispenser, HeatSeekerPod, POD, POD_ROCKETS, ROTARY_GUN, RocketPod, RotaryCannon } from '../entities/Combat';
import { ROCKET_SPEC } from './missiles';
import { Missile } from '../entities/Missiles';
import * as M from '../art/missiles';
import { Prop, type PropConfig } from '../entities/Prop';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Category, ItemDef, SpawnOptions } from '../world/types';

// Parts for home-made vehicles (0.4.0): see entities/Vehicles2. In the toybox's Vehicles.

const DRIVE = 'Fly it (select it, or sit someone in a cockpit seat in it): W and S throttle, A and D drive.';

function item(
  id: string, name: string, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[], category: Category = 'Vehicles',
): ItemDef {
  const def: ItemDef = {
    id, name, category, description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

export function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

function cfg(art: () => PixelArt, material: PhysMaterial, shapes: ShapeSpec[], mass: number): PropConfig {
  return { art, material, shapes, density: densityFor(mass, shapes) };
}

/** A strut's picture: its spring over its rod. */
function strutPreview(): PixelArt {
  const top = V.strutTopArt();
  const rod = V.strutRodArt();
  const a = new PixelArt(top.w, 30);
  a.blit(rod, 2, 14);
  a.blit(top, 0, 0);
  return a;
}

export function registerVehicles2(): void {
  const eng = lazyArt(() => V.engineArt(0));
  item('car-engine', 'Engine',
    `A petrol engine with a five-speed gearbox. Build it into a vehicle with motor wheels and it drives them: it pulls hard in the low gears and runs fast in top, changing gear by itself, its revs climbing through each. It burns fuel from a tank in the build (none: it runs free). ${DRIVE} The boost key ; with a nitro bottle in the build gives it more. Activate switches it off and on.`,
    eng, (game, def, x, y, opts) => new CarEngine(game, def, cfg(eng, MAT.metal, rects(22, 14, [[1, 0, 18, 14], [19, 8, 3, 2]]), 140), V.engineArt, x, y, opts),
    ['engine', 'motor', 'car', 'gearbox', 'gears', 'petrol', 'drive', 'revs']);
  item('suspension-strut', 'Suspension Strut',
    'A spring and a damper: weld its top to a vehicle and a wheel (a motor wheel’s hub) to the eye at the bottom of its rod. The wheel rides up over bumps and down into dips, and the vehicle stays on its wheels. Its menu sets how stiff it is.',
    strutPreview, (game, def, x, y, opts) => new SuspensionStrut(game, def, x, y, opts),
    ['suspension', 'strut', 'spring', 'damper', 'shock', 'car', 'wheel']);
  const nitro = lazyArt(() => V.nitroArt(4));
  item('nitro-bottle', 'Nitro Bottle',
    `Build it into a vehicle with an engine (or a jet): held, the boost key ; burns its ${NITRO_S} s of nitro to drive harder and faster. Activate refills it.`,
    nitro, (game, def, x, y, opts) => new NitroBottle(game, def, cfg(nitro, MAT.metal, rects(20, 8, [[0, 1, 20, 6]]), 8), V.nitroArt, x, y, opts),
    ['nitro', 'boost', 'nos', 'speed', 'car', 'race']);
  const hitch = lazyArt(() => V.hitchArt(false));
  item('tow-hitch', 'Tow Hitch',
    'Weld one to the back of a vehicle and another to what it tows (a trailer, a caravan, another car): bring the two balls together and they hitch, pinned so the trailer swings behind. Activate unhitches.',
    hitch, (game, def, x, y, opts) => new TowHitch(game, def, cfg(hitch, MAT.metal, rects(14, 8, [[0, 2, 10, 4], [10, 1, 4, 5]]), 5), V.hitchArt, x, y, opts),
    ['tow', 'hitch', 'trailer', 'towbar', 'car', 'pull']);
  const lamp = lazyArt(() => V.headlightArt(false));
  item('headlight', 'Headlight',
    'Lights the way it faces. The pilot’s lights key , switches every headlight in what’s flown on or off; F, or power through its wires, this one.',
    lamp, (game, def, x, y, opts) => new Headlight(game, def, cfg(lamp, MAT.metal, rects(8, 10, [[0, 0, 8, 10]]), 1.5), V.headlightArt, x, y, opts),
    ['light', 'headlight', 'lamp', 'beam', 'car', 'night']);
  const horn = lazyArt(V.hornArt);
  item('horn', 'Horn',
    'Honks: the pilot’s horn key (set one in Settings › Keys), F, a pulse or power reaching it.',
    horn, (game, def, x, y, opts) => new Horn(game, def, cfg(horn, MAT.metal, rects(14, 8, [[0, 1, 14, 6]]), 1), x, y, opts),
    ['horn', 'honk', 'hooter', 'car', 'sound']);
  const gm = (on: boolean) => P.sensorArt(`g:${on ? 1 : 0}`);
  item('g-meter', 'G-Meter',
    'Feels the g it’s put through (1 sat still, 0 falling free) and keeps the most it’s felt (its menu). Wired, it powers its wires past what it’s set to: an airbag’s trigger, a crash alarm. Build one in with a crash dummy.',
    () => gm(false), (game, def, x, y, opts) => new Sensor(game, def, cfg(() => gm(false), MAT.plastic, rects(16, 12, [[0, 0, 16, 12]]), 0.5), 'g', P.sensorArt, x, y, opts),
    ['g', 'gforce', 'meter', 'accelerometer', 'crash', 'sensor'], 'Vehicles');
  const bag = lazyArt(() => V.airbagArt(0));
  item('airbag', 'Airbag',
    `Build it into a car or a craft with a seat: a crash past ${AIRBAG.g} g (its own sensor), a pulse or power reaching it (a G-Meter wired to it, set lower) bursts it, and for ${AIRBAG.full} s whoever sits in it takes a third of the jolt. A seat belt (the seat’s menu) helps too. Spent, F packs it again.`,
    bag, (game, def, x, y, opts) => new Airbag(game, def, cfg(bag, MAT.plastic, rects(24, 24, [[0, 16, 10, 8]]), 2), V.airbagArt, x, y, opts),
    ['airbag', 'safety', 'crash', 'cushion', 'car', 'seatbelt']);
  const ext = lazyArt(V.extinguisherArt);
  item('fire-suppressor', 'Auto Fire Extinguisher',
    `Build it into a vehicle: the moment any of it, or anyone in it, catches fire within ${SUPPRESSOR.reach} m, it sprays it out, till its ${SUPPRESSOR.charge} s of charge are gone. F refills it.`,
    ext, (game, def, x, y, opts) => new FireSuppressor(game, def, cfg(ext, MAT.metal, rects(10, 20, [[1, 2, 8, 18]]), 6), x, y, opts),
    ['fire', 'extinguisher', 'suppressor', 'safety', 'automatic', 'car']);

  const claw = lazyArt(() => V.clawArt(false));
  item('claw', 'Claw',
    'A claw on a motor: F, a pulse or power reaching it shuts its jaws on whatever is between them and holds it fast (power gone, F again: it lets go). Hang it from a crane’s rope or weld it to an arm.',
    claw, (game, def, x, y, opts) => new Grabber(game, def, cfg(claw, MAT.metal, rects(20, 24, [[4, 0, 12, 11], [2, 12, 4, 10], [14, 12, 4, 10]]), 15), V.CLAW_JAW, 0.35, false, V.clawArt, x, y, opts),
    ['claw', 'grabber', 'gripper', 'grab', 'crane', 'arcade', 'hold'], 'Machinery');
  const hook = lazyArt(V.craneHookArt);
  item('crane-hook', 'Crane Hook',
    'A heavy hook for a crane’s rope (or a winch’s): whatever comes into its throat is caught and hangs from it. F lets go (and it catches again a moment later), or catches what’s in it.',
    hook, (game, def, x, y, opts) => new Grabber(game, def, cfg(hook, MAT.metal, rects(16, 26, [[2, 0, 12, 11], [7, 11, 3, 6], [3, 16, 3, 9], [3, 22, 9, 3], [10, 18, 3, 6]]), 25), V.HOOK_THROAT, 0.4, true, null, x, y, opts),
    ['hook', 'crane', 'lift', 'catch', 'rope', 'winch'], 'Machinery');

  const wing = lazyArt(() => V.wingArt(64));
  item('wing', 'Wing',
    'A wing, seen side on: going along it a little nose up, the air lifts it hard (the faster, the harder); tipped too far, it stalls and the lift falls away (the pilot’s readout says STALL). Weld it to a fuselage over its middle, an elevator behind, an engine in front: a plane.',
    wing, (game, def, x, y, opts) => new Wing(game, def, { art: wing, material: MAT.sheetMetal, shapes: rects(64, 8, [[0, 1, 64, 6]]), density: densityFor(30, rects(64, 8, [[0, 1, 64, 6]])), depth: 4 }, x, y, opts),
    ['wing', 'plane', 'lift', 'aerofoil', 'glider', 'stall'], 'Flight');
  const heli = lazyArt(() => V.heliArt(0));
  item('heli-rotor', 'Helicopter Rotor',
    'A rotor on a mast: spun up (F, or the throttle when flown) it lifts straight up from its mast, harder the faster it spins, less in thin air. It takes a moment to spin up and to run down, and burns fuel. Weld it on top of a cabin; tilt the craft (Q, E) to fly along.',
    heli, (game, def, x, y, opts) => new HeliRotor(game, def, cfg(heli, MAT.metal, rects(96, 16, [[40, 3, 16, 13]]), 60), 4500, V.heliArt, x, y, opts),
    ['helicopter', 'rotor', 'heli', 'chopper', 'lift', 'blades'], 'Flight');
}

export function registerBoats(): void {
  const prop = lazyArt(() => V.boatPropArt(0));
  item('boat-propeller', 'Boat Propeller',
    `A propeller on an electric shaft: under water it pushes the way it faces (out of the water it only thrashes the air). F, power or the throttle runs it. Weld it low at the back of a hull. ${DRIVE}`,
    prop, (game, def, x, y, opts) => new BoatPropeller(game, def, cfg(prop, MAT.metal, rects(18, 14, [[5, 5, 13, 4], [1, 1, 3, 12]]), 12), 3500, V.boatPropArt, x, y, opts),
    ['boat', 'propeller', 'screw', 'ship', 'submarine', 'water']);
  const out = lazyArt(() => V.outboardArt(false));
  item('outboard-motor', 'Outboard Motor',
    `A petrol motor on a leg with its propeller at the foot: clamp (weld) it to a boat’s back with the foot in the water. Burns fuel from the build’s tanks. ${DRIVE}`,
    out, (game, def, x, y, opts) => new Outboard(game, def, cfg(out, MAT.metal, rects(16, 26, [[0, 0, 14, 9], [5, 9, 4, 13], [3, 20, 12, 5]]), 35), 5000, (k) => V.outboardArt(k > 0), x, y, opts),
    ['outboard', 'boat', 'motor', 'engine', 'speedboat', 'water']);
  const sail = lazyArt(() => V.sailArt(0));
  item('sail', 'Sail',
    'A sail on its mast: the wind (Settings › World › Wind) fills it and pushes it along, the harder the faster the wind goes past. F furls it and sets it again. Weld it upright on a boat (or a cart).',
    sail, (game, def, x, y, opts) => new Sail(game, def, cfg(sail, MAT.wood, rects(26, 48, [[2, 0, 2, 48], [2, 42, 22, 2]]), 18), V.sailArt, x, y, opts),
    ['sail', 'boat', 'wind', 'mast', 'yacht', 'ship']);
  const tank = lazyArt(() => V.ballastArt(0));
  item('ballast-tank', 'Ballast Tank',
    `A submarine’s ballast: under water F (or a pulse, or power reaching it) floods it with ${BALLAST.kg} kg of water and the craft sinks; F again (or the power gone) blows it out and it rises. Its sight glass shows how full.`,
    tank, (game, def, x, y, opts) => new BallastTank(game, def, cfg(tank, MAT.metal, rects(24, 12, [[0, 0, 24, 12]]), 30), V.ballastArt, x, y, opts),
    ['ballast', 'submarine', 'sub', 'dive', 'tank', 'water']);
  const anchor = lazyArt(V.anchorArt);
  item('anchor', 'Anchor',
    'Heavy iron: rope it to a boat and drop it, and on the bottom under water it digs in and holds. F weighs it (lets it drag) and drops it again.',
    anchor, (game, def, x, y, opts) => new Anchor(game, def, cfg(anchor, MAT.metal, rects(16, 20, [[6, 0, 4, 18], [1, 13, 14, 7]]), 80), x, y, opts),
    ['anchor', 'boat', 'ship', 'moor', 'hold', 'water']);
}

export function registerCombat(): void {
  // (the heat-seeking missile is the heat seeker launcher's: see catalog/missiles)
  const heat = getItem('missile-heat');
  if (!heat) throw new Error('registerCombat: missile-heat (registerMissiles) not yet registered');
  const round: ItemDef = heat;
  const pod = lazyArt(() => V.heatPodArt(POD.rounds));
  item('heat-seeker-pod', 'Heat-Seeker Pod',
    `Two air-to-air missiles on a rail: weld it under a wing. The pilot’s fire key \\ (or F) fires one forward, and it goes after the hottest thing ahead of it: a rocket’s or a jet’s flame (on afterburner, more), something on fire. A flare in its eye pulls it off. It loads the next in ${POD.reload} s.`,
    pod, (game, def, x, y, opts) => new HeatSeekerPod(game, def, cfg(pod, MAT.metal, rects(32, 12, [[2, 0, 28, 11]]), 12), V.heatPodArt, () => round, x, y, opts),
    ['missile', 'heat', 'seeker', 'air', 'sidewinder', 'pod', 'jet', 'pilot', 'weapon'], 'Flight');
  const pellet = lazyArt(V.flarePelletArt);
  const flare: ItemDef = register({
    id: 'decoy-flare', name: 'Decoy Flare', category: 'Flight', description: 'A flare burning white-hot as it falls: heat seekers go for it.', tags: ['flare', 'decoy'], hidden: true,
    preview: previewOf(pellet),
    create: (game, x, y, opts) => new Flare(game, flare, cfg(pellet, MAT.metal, rects(4, 4, [[0, 0, 4, 4]]), 0.2), x, y, opts),
  });
  const disp = lazyArt(() => V.flareArt(6));
  item('flare-dispenser', 'Flare Dispenser',
    `${DISPENSER.flares} flares: the pilot’s flares key (Caps Lock), or F, throws out a pair behind and below, burning far hotter than any engine: a heat seeker after the craft goes for them instead. Its menu reloads it.`,
    disp, (game, def, x, y, opts) => new FlareDispenser(game, def, cfg(disp, MAT.metal, rects(14, 10, [[0, 0, 14, 10]]), 4), V.flareArt, () => flare, x, y, opts),
    ['flare', 'decoy', 'countermeasure', 'chaff', 'jet', 'pilot'], 'Flight');
  const bombArt = lazyArt(V.aerialBombArt);
  const bomb = item('aerial-bomb', 'Aerial Bomb',
    `A finned bomb: dropped (from a bomb bay, or let go of high up), it arms after ${AERIAL_BOMB.arm} s and goes off against the first thing it hits hard; its fins turn it nose down as it falls. Set down by hand it’s safe.`,
    bombArt, (game, def, x, y, opts) => new AerialBomb(game, def, cfg(bombArt, MAT.metal, rects(28, 10, [[0, 1, 27, 8]]), 50), x, y, opts),
    ['bomb', 'aerial', 'drop', 'bomber', 'explosive'], 'Explosives');
  const bay = lazyArt(() => V.bombBayArt(false));
  item('bomb-bay', 'Bomb Bay',
    `Weld it into a plane’s belly: the pilot’s bombs key 0 (or F) opens its doors and drops a bomb; ${BAY.bombs} in it. Its menu loads it again.`,
    bay, (game, def, x, y, opts) => new BombBay(game, def, cfg(bay, MAT.metal, rects(30, 12, [[0, 0, 30, 10]]), 40), V.bombBayArt, () => bomb, x, y, opts),
    ['bomb', 'bay', 'bomber', 'drop', 'plane', 'pilot'], 'Flight');
  // (0.5.0) the rotary cannon and the rocket pod, and the pod's rocket (not in the toybox)
  const rArt = lazyArt(() => M.missileArt('rocket', 'strike'));
  const rSize = M.MISSILES.strike;
  const rShapes: ShapeSpec[] = [{ kind: 'box', w: rSize.w - 2, h: 3, r: 0.8 }];
  const rocket: ItemDef = register({
    id: 'rocket-70mm', name: '70 mm Rocket', category: 'Weapons', description: 'An unguided rocket in flight.', tags: [], hidden: true,
    preview: previewOf(rArt),
    create: (game, x, y, opts) => new Missile(game, rocket, 'rocket', 'strike', ROCKET_SPEC, rArt(), rShapes, densityFor(1.5, rShapes), x, y, opts),
  });
  const rot = lazyArt(() => V.rotaryArt(0));
  item('rotary-cannon', 'Rotary Cannon',
    `A six-barrelled 20 mm rotary cannon (an M61 Vulcan): hold F, or weld it to a plane and hold the pilot’s fire key \\, and its barrels spin up and it fires ${ROTARY_GUN.rate} rounds a second, a stream of tracer that shreds cars and shoves back on what it’s welded to. ${ROTARY_GUN.rounds} rounds; its menu loads it again.`,
    rot, (game, def, x, y, opts) => new RotaryCannon(game, def, cfg(rot, MAT.metal, rects(V.ROTARY.w, V.ROTARY.h, [[0, 2, 15, 9], [15, 3, 33, 6]]), 110), V.rotaryArt, V.ROTARY.muzzle, x, y, opts),
    ['rotary', 'cannon', 'gatling', 'vulcan', 'm61', 'minigun', 'gun', 'gau', '20mm', 'pilot', 'weapon'], 'Weapons');
  const podArt = lazyArt(() => V.rocketPodArt(3));
  item('rocket-pod', 'Rocket Pod',
    `${POD_ROCKETS.rounds} unguided 70 mm rockets in a pod (a LAU-61): F fires one straight ahead (hold it to ripple them off), or weld it under a wing and press the pilot’s rockets key 9. Each flies on its motor for a second, dropping a little, and goes off on what it hits. Its menu loads it again.`,
    podArt, (game, def, x, y, opts) => new RocketPod(game, def, cfg(podArt, MAT.metal, rects(V.ROCKET_POD.w, V.ROCKET_POD.h, [[0, 2, 40, 10]]), 60), V.rocketPodArt, () => rocket, x, y, opts),
    ['rocket', 'pod', 'hydra', 'ffar', 'lau', 'unguided', 'salvo', 'pilot', 'weapon', 'jet', 'helicopter'], 'Weapons');
  const plate = lazyArt(() => V.armourArt(32, 8));
  item('armour-plate', 'Armour Plate',
    'A plate of hardened steel: weld it over what needs keeping safe. Rifle rounds stop in it (a sniper’s just), shrapnel bounces off, and it takes a blast that would tear sheet metal apart.',
    plate, (game, def, x, y, opts) => new Prop(game, def, cfg(plate, ARMOUR, rects(32, 8, [[0, 0, 32, 8]], 0.3), 60), x, y, opts),
    ['armour', 'armor', 'plate', 'steel', 'protection', 'tank']);
}

export function registerRails(): void {
  const wheel = lazyArt(V.railWheelArt);
  item('rail-wheel', 'Rail Wheel',
    'A flanged steel wheel for rails (lay track with the Rails tool: the Shape tool’s key twice). Brought to a track it holds to it, over crests and round loops, and rolls along it almost freely. Weld two under a carriage (a plank, a box, a seat): a railway wagon, a mine cart, a coaster.',
    wheel, (game, def, x, y, opts) => new RailWheel(game, def, { art: wheel, material: RAIL_WHEEL_MAT, shapes: [{ kind: 'ball', r: RAIL_WHEEL_R }], density: densityFor(6, [{ kind: 'ball', r: RAIL_WHEEL_R }]) }, x, y, opts),
    ['rail', 'wheel', 'train', 'track', 'coaster', 'railway', 'cart']);
  const car = lazyArt(V.coasterArt);
  const carShapes: ShapeSpec[] = [
    ...rects(38, 32, [[0, 14, 30, 8], [24, 9, 14, 13], [0, 1, 5, 13]]),
    ...COASTER_WHEELS.map(([x, y]): ShapeSpec => ({ kind: 'ball', r: RAIL_WHEEL_R, x: x - 19, y: 16 - y })),
  ];
  item('coaster-car', 'Coaster Car',
    'A roller coaster car: set it on a track (the Rails tool) and it holds to it and rolls, round the loops too. Drop someone in its seat: the lap bar holds them in. Lay a chain lift (the track’s menu) to haul it up the first hill, or a launch to fire it off.',
    car, (game, def, x, y, opts) => new CoasterCar(game, def, cfg(car, { ...MAT.metal, friction: 0 }, carShapes, 120), x, y, opts),
    ['coaster', 'roller coaster', 'ride', 'car', 'rail', 'track', 'theme park'], 'Vehicles');
}

/** A race gate's picture: the start's chequered banner (0), or a checkpoint's, lit once passed. */
const gateArt = (() => {
  const m = new Map<string, PixelArt>();
  return (index: number, lit: boolean): PixelArt => {
    const k = `${index ? 1 : 0}:${lit ? 1 : 0}`;
    let a = m.get(k);
    if (!a) {
      if (!index) a = V.startGateArt(lit);
      else {
        a = new PixelArt(40, 56);
        a.blit(V.checkpointArt(lit), 0, 0);
        a.rect(0, 48, 3, 8, 0x7f8a94);
        a.rect(37, 48, 3, 8, 0x7f8a94);
      }
      m.set(k, a);
    }
    return a;
  };
})();

export function registerPlaces(): void {
  const ramp = lazyArt(() => V.rampArt(128, 40));
  item('ramp', 'Ramp',
    'A jump ramp, set where it’s put: drive up it fast and fly. Landed upright, the time in the air and any flips score stunt points (the readout shows them).',
    ramp, (game, def, x, y, opts) => new Fixture(game, def, { art: ramp, material: MAT.wood, shapes: [{ kind: 'poly', pts: [[-64, -20], [64, -20], [64, 20]] }], density: 300 }, x, y, opts),
    ['ramp', 'jump', 'stunt', 'car', 'bike', 'kicker']);
  const runway = lazyArt(() => V.runwayArt(1280));
  item('runway', 'Runway',
    '40 m of tarmac to take off from and land on, with its centre line and lights, set where it’s put.',
    runway, (game, def, x, y, opts) => new Fixture(game, def, { art: runway, material: MAT.concrete, shapes: [{ kind: 'box', w: 1280, h: 6, r: 0 }], density: 300 }, x, y, opts),
    ['runway', 'airstrip', 'airport', 'plane', 'tarmac', 'landing']);
  const pad = lazyArt(V.launchPadArt);
  item('rocket-pad', 'Launch Pad',
    'A concrete launch pad with its flame trench and service tower: build a rocket on it (launch clamps hold it down till it lights).',
    pad, (game, def, x, y, opts) => new Fixture(game, def, { art: pad, material: MAT.concrete, shapes: [{ kind: 'box', w: 256, h: 16, y: -72, r: 0 }], density: 300 }, x, y, opts),
    ['launch', 'pad', 'rocket', 'space', 'tower', 'gantry']);
  const pump = lazyArt(() => V.fuelPumpArt(false));
  item('fuel-pump', 'Fuel Pump',
    `Stop a build beside it (within ${PUMP.reach} m): it fills its fuel tanks, charges its batteries and refills its nitro.`,
    pump, (game, def, x, y, opts) => new FuelPump(game, def, { art: pump, material: MAT.metal, shapes: rects(20, 44, [[3, 4, 14, 40]]), density: 200 }, V.fuelPumpArt, x, y, opts),
    ['fuel', 'pump', 'station', 'petrol', 'gas', 'refuel', 'charge']);
  const gate = lazyArt(() => gateArt(0, false));
  item('race-gate', 'Race Gate',
    'A race’s start and finish (its menu: or checkpoint 1 to 8). Drive or fly through the start, then each checkpoint in order and back through the start: a lap, timed, the best kept. Things go past it.',
    gate, (game, def, x, y, opts) => {
      const i = typeof opts.config?.index === 'number' && Number.isInteger(opts.config.index) ? Math.max(0, Math.min(8, opts.config.index)) : 0;
      return new RaceGate(game, def, { art: () => gateArt(i, false), material: MAT.metal, shapes: rects(40, 56, [[0, 0, 40, 56]]), density: 50 }, gateArt, i, x, y, opts);
    },
    ['race', 'checkpoint', 'lap', 'gate', 'start', 'finish', 'timer']);
}

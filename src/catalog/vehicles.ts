import { register, lazyArt, previewOf } from './items';
import type { ItemDef, SpawnOptions } from '../world/types';
import type { ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import { PixelArt } from '../art/PixelArt';
import { GUNMETAL, STEEL, STEEL_LT } from '../art/palette';
import { PX } from '../engine/constants';
import * as V from '../art/vehicles';
import { artRect, densityFor } from '../entities/Item';
import { Car, type CarConfig, type SeatSpec } from '../entities/Car';
import { Tank, Shell, type CannonSpec } from '../entities/Tank';

/** Collider outline from art pixels (x right, y down from the top-left), centered on the art. */
function artPoly(w: number, h: number, pts: [number, number][]): ShapeSpec {
  return { kind: 'poly', pts: pts.map(([x, y]) => [x - w / 2, h / 2 - y]) };
}

/** Polygon area (art pixels²): densityFor() leaves polygons out. */
function polyArea(pts: [number, number][]): number {
  let a = 0;
  pts.forEach(([x, y], i) => {
    const [u, v] = pts[(i + 1) % pts.length];
    a += x * v - u * y;
  });
  return Math.abs(a) / 2;
}

/** A body of convex pieces (art pixels), and the density that makes it weigh `kg`. */
function hull(w: number, h: number, kg: number, pieces: [number, number][][]): { shapes: ShapeSpec[]; density: number } {
  const area = pieces.reduce((s, p) => s + polyArea(p), 0) * PX * PX;
  return { shapes: pieces.map((p) => artPoly(w, h, p)), density: kg / area };
}

// The car, the SUV and the pickup are drawn to the people's scale, to sit them
// inside. Normal speeds are about three times the first little car's; the
// higher settings go to five and more. `blunt` keeps a hit at Normal to maiming
// (see CarConfig.blunt); the tank is slow, and heavy all the same.

/** Sitting at the wheel: knees up, a little reclined, hands out on the wheel. */
const DRIVE: SeatSpec['pose'] = {
  head: -0.3, upperLegF: 1.4, upperLegB: 1.4, lowerLegF: -0.75, lowerLegB: -0.75, footF: -0.6, footB: -0.6,
  upperArmF: 0.85, upperArmB: 0.85, lowerArmF: 0.5, lowerArmB: 0.5,
};
/** A passenger: as at the wheel, with the hands in the lap. */
const RIDE: SeatSpec['pose'] = { ...DRIVE, upperArmF: 0.25, upperArmB: 0.15, lowerArmF: 1.2, lowerArmB: 1.3 };
/** Down in a tank's hatch: crouched on the seat inside, head and shoulders out, hands on the rim. */
const HATCH_POSE: SeatSpec['pose'] = {
  head: -0.1, upperLegF: 2.1, upperLegB: 2.1, lowerLegF: -2.5, lowerLegB: -2.5, footF: 0.5, footB: 0.5,
  upperArmF: 0.3, upperArmB: 0.2, lowerArmF: 0.4, lowerArmB: 0.4,
};

/** Seats at art pixels, in the order they fill, each with its pose and drawing band. */
function seats(at: [number, number][], bands: number[], recline = 0.3): SeatSpec[] {
  return at.map((p, i) => ({ at: [p[0], p[1]], pose: i === 0 ? DRIVE : RIDE, recline, band: bands[i] }));
}

/** The front layer and the wreck (and its front layer) of a body. */
function burnt(body: () => PixelArt, rows?: number) {
  const wreck = lazyArt(() => V.wreckOf(body()));
  return {
    front: lazyArt(() => V.seeThrough(body(), rows)),
    frontOf: (a: PixelArt) => V.seeThrough(a, rows),
    wreck,
    wreckFront: lazyArt(() => V.seeThrough(wreck(), rows)),
  };
}

const H = V.HATCH;
const hatchArt = lazyArt(V.hatchBodyArt);
const CAR: CarConfig = {
  body: hatchArt, wheel: lazyArt(() => V.tyreArt(20, 12, STEEL)),
  ...hull(H.w, H.h, 330, [
    [[1, 27], [3, 21], [96, 20], [114, 23], [120, 26], [121, 30], [121, 41], [119, 43], [3, 43], [1, 41]],
    [[3, 21], [12, 2], [17, 0], [73, 0], [78, 2], [96, 20]],
  ]),
  wheelDensity: 60, axles: H.axles, wheelR: 10, speed: 15, torque: 320, headlight: [118, 27], pitch: 1, blunt: 0.25,
  // the driver at the wheel, and one behind (nearer the back, so further back in the drawing)
  seats: seats(H.seats, [1, 0]), cabin: [6, 0, 90, 38], ...burnt(hatchArt),
  engine: [108, 28], fuel: [12, 30], armour: 1, blast: { power: 110, radius: 5, damage: 220 },
};

// the bed floor is the top of the chassis; its walls are the tailgate and the back of the cab
const P = V.PICKUP;
const truckArt = lazyArt(V.truckBodyArt);
const TRUCK: CarConfig = {
  body: truckArt, wheel: lazyArt(() => V.tyreArt(24, 13, STEEL_LT)),
  ...hull(P.w, P.h, 560, [
    [[1, P.bed.y], [165, P.bed.y], [165, 44], [162, 47], [4, 47], [0, 45], [0, 36]],
    [[67, P.bed.y], [67, 4], [70, 1], [101, 1], [104, 3], [120, 21], [120, P.bed.y]],
    [[120, 21], [158, 23], [164, 27], [165, P.bed.y], [120, P.bed.y]],
    [[0, 21], [P.bed.x0 + 1, 21], [P.bed.x0 + 1, P.bed.y], [0, P.bed.y]],
  ]),
  wheelDensity: 60, axles: P.axles, wheelR: 12, speed: 13, torque: 500, headlight: [162, 28], pitch: 0.8, blunt: 0.3,
  // a bench in the cab: the driver, and a passenger on the far side
  seats: seats(P.seats, [1, 0]), cabin: [68, 0, 52, 36], ...burnt(truckArt),
  engine: [145, 30], fuel: [50, 36], armour: 1, blast: { power: 130, radius: 5.5, damage: 240 },
};

const S = V.SUV;
const suvArt = lazyArt(V.suvBodyArt);
const SUV: CarConfig = {
  body: suvArt, wheel: lazyArt(() => V.tyreArt(24, 14, GUNMETAL, true)),
  ...hull(S.w, S.h, 520, [
    [[0, 38], [3, 24], [124, 22], [146, 24], [151, 28], [151, 47], [148, 49], [3, 49], [0, 47]],
    // the cabin, with the spare wheel on the tailgate and the roof rack
    [[0, 34], [0, 18], [3, 6], [6, 3], [9, 0], [104, 0], [110, 3], [113, 5], [124, 22]],
  ]),
  wheelDensity: 60, axles: S.axles, wheelR: 12, speed: 14, torque: 480, headlight: [148, 28], pitch: 0.9, blunt: 0.25,
  // two rows of two: the far side's seats are drawn behind the near side's, the back row behind the front
  seats: seats(S.seats, [3, 2, 1, 0]), cabin: [4, 0, 120, 40], ...burnt(suvArt),
  engine: [136, 30], fuel: [20, 36], armour: 1, blast: { power: 130, radius: 5.5, damage: 240 },
};

// all seven wheels drive; the sprocket and idler sit higher, so the track's ends ramp up over what's in its way
const tankArt = lazyArt(V.tankHullArt);
const TANK: CarConfig = {
  body: tankArt, wheel: lazyArt(V.roadWheelArt), idler: { art: lazyArt(V.sprocketArt), axles: [0, 6] },
  shapes: [
    artPoly(120, 44, [[1, 21], [1, 15], [6, 11], [94, 11], [119, 18], [119, 21]]),
    artPoly(120, 44, [[34, 11], [40, 3], [74, 3], [83, 9], [83, 11]]),
    // the track's sloping ends, front and back (thin, as drawn round the idlers):
    // what it drives into is climbed, not shoved along by the round idler (a body
    // lying on the floor stands taller than the idler is off the ground)
    artPoly(120, 44, [[110, 21], [118, 29], [110, 37], [94, 42.5], [94, 40], [109, 35], [115.5, 29], [109, 23]]),
    artPoly(120, 44, [[10, 21], [2, 29], [10, 37], [26, 42.5], [26, 40], [11, 35], [4.5, 29], [11, 23]]),
  ],
  density: 650, wheelDensity: 400, axles: V.TANK_AXLES, wheelR: 8, speed: 4.5, torque: 480, headlight: [116, 18], pitch: 0.55, blunt: 1.2,
  bodyName: 'Hull', wheelName: 'Road wheel',
  // the commander, down in the cupola's hatch with head and shoulders out (the front layer is the hull and turret only)
  seats: [{ at: [51, 13], pose: HATCH_POSE, recline: 0, band: 0 }], cabin: [36, 0, 48, 14], noBelts: true, ...burnt(tankArt, 23),
  // armour: crashes and blasts that wreck a car barely mark it
  engine: [16, 14], fuel: [28, 16], armour: 0.08, blast: { power: 180, radius: 6.5, damage: 300 },
  // (its team's stripe along the hull: the star's on the turret)
  band: [26, 15, 92, 18],
};

const CANNON: Omit<CannonSpec, 'shell'> = {
  barrel: lazyArt(V.tankBarrelArt), shapes: [artRect(40, 5, 0, 1, 40, 3, 0.5)], density: 300,
  trunnion: [83, 7], pivot: [1, 2], muzzle: [39, 2], speed: 42, reload: 1.5, recoil: 500, limits: [-8, 35],
};

// The three real tanks are drawn near the people's scale (see V.TankDesign):
// twice the toy tank's size, several times its weight, and slower to get going.
// Their numbers keep to how the real ones compare: the Abrams' gas turbine is
// the quickest off the mark and the fastest; the Type 99A is lighter and its
// autoloader reloads quickest; the Leopard's long L/55 gun fires the fastest,
// flattest shell. Each barrel's limits are the real gun's.

/** What makes one real tank drive and shoot as it does. */
interface TankStats {
  /** The hull's weight (kg): the wheels, and a barrel of a fortieth of it (as a real gun is to its tank), come on top. */
  kg: number;
  speed: number;
  torque: number;
  pitch: number;
  gun: Pick<CannonSpec, 'speed' | 'reload' | 'recoil' | 'limits'>;
}

/** The track's sloping ends round the idler and the sprocket, down to the next road wheel's foot (as the tank's are). */
function trackEnds(d: V.TankDesign): [number, number][][] {
  const r = d.r;
  const end = (i: number, next: number, out: number): [number, number][] => {
    const [x, y] = d.axles[i];
    const [nx, ny] = d.axles[next];
    return [[x, y - r], [x + r * out, y], [x + r * 0.7 * out, y + r * 0.7], [x, y + r], [nx + 2 * out, ny + r - 0.5], [nx + 2 * out, ny + r - 3]];
  };
  const n = d.axles.length;
  return [end(n - 1, n - 2, 1), end(0, 1, -1)];
}

/** A real tank's config and cannon from its design (see art/vehicles.ts) and its numbers. */
function tankModel(d: V.TankDesign, s: TankStats): { cfg: CarConfig; cannon: Omit<CannonSpec, 'shell'> } {
  const body = lazyArt(() => V.tankArt(d));
  const n = d.axles.length;
  // (the front layer over the commander is the hull and turret: everything down to the skirt's foot)
  const foot = Math.max(...d.skirt.map(([, y]) => y));
  const cfg: CarConfig = {
    body, wheel: lazyArt(() => V.tankWheelArt(d.wheel, d.paint)), idler: { art: lazyArt(() => V.tankSprocketArt(d.wheel, d.paint)), axles: [0, n - 1] },
    ...hull(d.w, d.h, s.kg, [...d.body, ...trackEnds(d)]),
    wheelDensity: 300, axles: d.axles, wheelR: d.r, speed: s.speed, torque: s.torque, headlight: d.lamp, pitch: s.pitch, blunt: 1.3,
    bodyName: 'Hull', wheelName: 'Road wheel',
    seats: [{ at: d.hatch, pose: HATCH_POSE, recline: 0, band: 0 }], cabin: d.cabin, noBelts: true, ...burnt(body, foot + 1),
    engine: d.engine, fuel: d.fuel, armour: 0.06, blast: { power: 200, radius: 7, damage: 320 }, band: d.band,
  };
  const g = d.barrel;
  const shapes = [artRect(g.len, V.GUN_H, 0, 1, g.len, 5, 0.5)];
  const cannon: Omit<CannonSpec, 'shell'> = {
    barrel: lazyArt(() => V.tankGunArt(g, d.paint, d.camo)), shapes, density: densityFor(s.kg / 40, shapes),
    trunnion: d.trunnion, pivot: [3, V.GUN_BORE], muzzle: [g.len - 1, V.GUN_BORE], ...s.gun,
  };
  return { cfg, cannon };
}

// the wheels: 9 of 111 kg (the Leopard), 8 or 9 of 132 kg; hull, wheels and barrel together 3,300 to 3,800 kg
// (torque enough to be off the mark in a second or so: a tank that takes its real
// six seconds to get going feels stuck to the floor here)
const ABRAMS = tankModel(V.ABRAMS, {
  kg: 2600, speed: 7.5, torque: 980, pitch: 0.85,
  gun: { speed: 48, reload: 2, recoil: 1100, limits: [-10, 20] },
});
const ZTZ99A = tankModel(V.ZTZ99A, {
  kg: 2200, speed: 6.5, torque: 720, pitch: 0.6,
  gun: { speed: 46, reload: 1.1, recoil: 1150, limits: [-6, 18] },
});
const LEOPARD = tankModel(V.LEOPARD2A7, {
  kg: 2550, speed: 6, torque: 640, pitch: 0.5,
  gun: { speed: 58, reload: 2, recoil: 1250, limits: [-9, 20] },
});

/** The vehicle as it stands, wheels on (and its barrel, drawn first), for the toybox. */
function standing(cfg: CarConfig, under?: { art: () => PixelArt; x: number; y: number }): () => PixelArt {
  return lazyArt(() => {
    const body = cfg.body();
    const low = Math.max(...cfg.axles.map(([, ay]) => ay));
    const w = Math.max(body.w, under ? under.x + under.art().w : 0);
    const a = new PixelArt(w, Math.max(body.h, Math.ceil(low + 0.5 + cfg.wheelR)));
    if (under) a.blit(under.art(), under.x, under.y);
    a.blit(body, 0, 0);
    cfg.axles.forEach(([ax, ay], i) => {
      const idler = cfg.idler?.axles.includes(i) ? cfg.idler : undefined;
      const wheel = idler ? idler.art() : cfg.wheel();
      a.blit(wheel, Math.round(ax + 0.5 - wheel.w / 2), Math.round(ay + 0.5 - wheel.h / 2));
    });
    return a;
  });
}

function vehicle(
  id: string, name: string, description: string, cfg: CarConfig, preview: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Car, tags: string[],
): ItemDef {
  const def: ItemDef = {
    id, name, category: 'Vehicles', description, tags,
    preview: previewOf(preview),
    // from the body's middle down to the bottom of its wheels
    halfHeight: (Math.max(...cfg.axles.map(([, ay]) => ay)) + 0.5 - cfg.body().h / 2 + cfg.wheelR) * PX,
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  return register(def);
}

/** The explosive shell the tank fires (not in the toybox). */
function registerShell(): ItemDef {
  const art = lazyArt(V.shellArt);
  const shapes: ShapeSpec[] = [{ kind: 'box', w: 9, h: 3, r: 0.8 }];
  const blast = { power: 140, radius: 4.5, damage: 260, shrapnel: 10 };
  const def: ItemDef = register({
    id: 'tank-shell', name: 'Tank Shell', category: 'Vehicles', description: 'A high-explosive tank shell.', tags: [], hidden: true,
    preview: previewOf(art),
    create: (game, x, y, opts) => new Shell(game, def, art(), shapes, densityFor(5, shapes), blast, x, y, opts),
  });
  return def;
}

export function registerVehicles(): void {
  vehicle('car', 'Car', 'A small hatchback for two. Activate to drive (or wire it to power); reverse and top speed from its menu. Drop people on it to sit them inside; crash it hard enough and it blows up.', CAR, standing(CAR),
    (game, def, x, y, opts) => new Car(game, def, CAR, x, y, opts), ['vehicle', 'auto', 'drive', 'seats']);
  vehicle('truck', 'Pickup Truck', 'A heavy pickup with an open bed: things ride in the back, two people in the cab (drop them on it). Drives like the car, with more pull.', TRUCK, standing(TRUCK),
    (game, def, x, y, opts) => new Car(game, def, TRUCK, x, y, opts), ['vehicle', 'pickup', 'drive', 'cargo', 'seats']);
  vehicle('suv', 'SUV', 'A tall, boxy off-roader on big wheels that seats four: high clearance and strong pull.', SUV, standing(SUV),
    (game, def, x, y, opts) => new Car(game, def, SUV, x, y, opts), ['vehicle', 'jeep', '4x4', 'drive', 'seats']);
  const shell = registerShell();
  const gun: CannonSpec = { ...CANNON, shell };
  vehicle('tank', 'Tank', 'A heavy armoured tank: slow, but nothing stops it, and it crushes what it drives over. Fire its cannon with Use, from its menu or with a button wired to it. Select it to drive it with ← → and raise or lower the barrel with ↑ ↓ (or pick an elevation in its menu). Drop someone on the turret to put them in its hatch.', TANK,
    standing(TANK, { art: CANNON.barrel, x: CANNON.trunnion[0] - CANNON.pivot[0], y: CANNON.trunnion[1] - CANNON.pivot[1] }),
    (game, def, x, y, opts) => new Tank(game, def, TANK, gun, x, y, opts), ['vehicle', 'army', 'military', 'cannon', 'tracks']);
  const tank = (id: string, name: string, description: string, m: { cfg: CarConfig; cannon: Omit<CannonSpec, 'shell'> }, tags: string[]) => {
    const { cfg, cannon } = m;
    const spec: CannonSpec = { ...cannon, shell };
    vehicle(id, name, `${description} Select it to drive it with ← → and lay the gun with ↑ ↓; Use fires.`, cfg,
      standing(cfg, { art: cannon.barrel, x: cannon.trunnion[0] - cannon.pivot[0], y: cannon.trunnion[1] - cannon.pivot[1] }),
      (game, def, x, y, opts) => new Tank(game, def, cfg, spec, x, y, opts), ['vehicle', 'tank', 'army', 'military', 'cannon', 'tracks', ...tags]);
  };
  tank('tank-abrams', 'M1 Abrams', 'The American M1A2 Abrams, in desert tan: its gas turbine makes it the quickest tank off the mark and the fastest, and its 120 mm gun is loaded by hand. Its turret\'s face slopes back in angled slabs of armour over the gun.',
    ABRAMS, ['m1', 'm1a2', 'abrams', 'usa', 'american', 'turbine', '120mm']);
  tank('tank-ztz99a', 'ZTZ-99A', 'China\'s Type 99A, in digital camouflage: a little lighter than the others, with an arrowhead of reactive armour on its turret, and its 125 mm gun\'s autoloader reloads the fastest.',
    ZTZ99A, ['type 99', 'type 99a', 'ztz', 'china', 'chinese', 'autoloader', '125mm']);
  tank('tank-leopard', 'Leopard 2A7', 'Germany\'s Leopard 2A7, in NATO three-tone camouflage: a tall, slab-sided turret with a flat face, and the long L/55 120 mm gun fires the fastest, flattest shell.',
    LEOPARD, ['leopard', 'leo', '2a7', 'germany', 'german', 'l55', '120mm']);
}

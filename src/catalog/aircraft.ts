import { register, lazyArt, previewOf } from './items';
import { PixelArt } from '../art/PixelArt';
import { PX } from '../engine/constants';
import * as A from '../art/aircraft';
import { seeThrough, wreckOf } from '../art/vehicles';
import type { CarConfig, SeatSpec } from '../entities/Car';
import {
  Aircraft, PropPlane, Helicopter, Tiltrotor, Trike, PoweredParachute, HotAirBalloon,
  type FlightSpec, type Surface, type Powerplant,
} from '../entities/Planes';
import { MAT } from '../world/Materials';
import type { ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ItemDef, SpawnOptions } from '../world/types';

// The aircraft (0.4.5): the FAA's seven categories of aircraft, the aeroplanes two each of
// airliners, light aircraft and military jets. Each is laid out in metres (see
// art/aircraft.ts) and flies by the real one's numbers (see entities/Planes.ts): weights,
// wing and tail areas, engines and their thrust or power, its never-exceed speed and g limit.

type Pt = [number, number];

/** A design's art size (px) and a metres-to-pixels mapping (as its Sheet draws it). */
function grid(f: A.Airframe): { w: number; h: number; p: (x: number, y: number) => Pt } {
  return {
    w: Math.ceil(f.len * A.PPM) + 1,
    h: Math.ceil((f.top - f.bottom) * A.PPM) + 1,
    p: (x, y) => [x * A.PPM, (f.top - y) * A.PPM],
  };
}

/** The hull of a few points (px), counter-clockwise. */
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function area(pts: Pt[]): number {
  let a = 0;
  pts.forEach(([x, y], i) => {
    const [u, v] = pts[(i + 1) % pts.length];
    a += x * v - u * y;
  });
  return Math.abs(a) / 2;
}

/** Poses: at the controls (hands out on the yoke or stick), riding (hands in the lap), standing (in a balloon's basket). */
const PILOT: SeatSpec['pose'] = {
  head: -0.3, upperLegF: 1.35, upperLegB: 1.35, lowerLegF: -0.7, lowerLegB: -0.7, footF: -0.6, footB: -0.6,
  upperArmF: 0.75, upperArmB: 0.75, lowerArmF: 0.6, lowerArmB: 0.6,
};
const RIDER: SeatSpec['pose'] = { ...PILOT, upperArmF: 0.25, upperArmB: 0.15, lowerArmF: 1.2, lowerArmB: 1.3 };
const STAND: SeatSpec['pose'] = { upperArmF: 0.4, upperArmB: 0.3, lowerArmF: 0.8, lowerArmB: 0.9 };

interface Make {
  armour?: number;
  blast: { power: number; radius: number; damage: number };
  /** Its toughness against blasts (see CarConfig.tough). */
  tough?: number;
  stand?: boolean;
  noBelts?: boolean;
  material?: CarConfig['material'];
}

/** A vehicle config for an airframe: its colliders, wheels, seats, cabin and wreck from its design. */
function configOf(f: A.Airframe, body: () => PixelArt, spec: FlightSpec, o: Make): CarConfig {
  const g = grid(f);
  const pieces = f.pieces.map((pc) => hull(pc.map(([x, y]) => g.p(x, y))));
  const shapes: ShapeSpec[] = pieces.map((pts) => ({ kind: 'poly', pts: pts.map(([x, y]) => [x - g.w / 2, g.h / 2 - y]) }));
  const px2 = pieces.reduce((s, pc) => s + area(pc), 0) * PX * PX;
  const wheels = f.wheels;
  const meanR = wheels.length ? wheels.reduce((s, w) => s + w.r, 0) / wheels.length : 0.3;
  const front = lazyArt(() => seeThrough(body()));
  const wreck = lazyArt(() => wreckOf(body()));
  return {
    body, shapes,
    // (half its game weight in its colliders; the rest is added at its centre of gravity: see Aircraft.trimMass())
    density: (spec.gameKg * 0.5) / Math.max(0.1, px2),
    wheel: lazyArt(() => A.wheelArt(wheels.length ? A.wheelKey(wheels[0]) : '0.3:8:l')),
    wheelRs: wheels.map((w) => w.r * A.PPM),
    wheelArts: wheels.map((w) => () => A.wheelArt(A.wheelKey(w))),
    // (each wheel about a fiftieth of the game's aircraft)
    wheelDensity: (spec.gameKg * 0.02) / (Math.PI * meanR * meanR),
    axles: wheels.map((w) => g.p(w.x, w.r)),
    wheelR: wheels.length ? Math.max(...wheels.map((w) => w.r)) * A.PPM : 8,
    speed: 1, torque: 0, pitch: 1, blunt: 0.6,
    bodyName: 'Airframe', wheelName: 'Wheel',
    seats: f.seats.map(([x, y], i) => ({ at: g.p(x, y), pose: o.stand ? STAND : i === 0 ? PILOT : RIDER, recline: f.recline?.[i] ?? 0.2, band: i })),
    cabin: (() => {
      const [x0, y0, x1, y1] = f.cabin;
      const [a, b] = g.p(x0, y1);
      const [c, d] = g.p(x1, y0);
      return [a, b, c - a, d - b] as [number, number, number, number];
    })(),
    noBelts: o.noBelts,
    front, frontOf: (a) => seeThrough(a), wreck, wreckFront: lazyArt(() => seeThrough(wreck())),
    engine: g.p(...f.engine), fuel: g.p(...f.fuel),
    armour: o.armour ?? 1, blast: o.blast, tough: o.tough, wholeShapes: f.whole, trueKg: spec.trueKg + 150,
    material: o.material,
    damping: { linear: 0, angular: 0.05 },
  };
}

/** Converts a spec laid out in metres (its points) to art pixels. */
function specOf(f: A.Airframe, s: Omit<FlightSpec, 'cg'> & { cg?: Pt }): FlightSpec {
  const g = grid(f);
  const pt = (q: Pt): Pt => g.p(q[0], q[1]);
  const surf = (x?: Surface): Surface | undefined => (x ? { ...x, at: pt(x.at) } : undefined);
  const pw = s.power ? { ...s.power, at: s.power.at.map(pt), nozzle: s.power.nozzle ? pt(s.power.nozzle) : undefined, props: s.power.props?.map((p) => ({ ...p, at: pt(p.at) })) } as Powerplant : undefined;
  return {
    ...s,
    cg: pt(s.cg ?? f.cg),
    wing: surf(s.wing), tail: surf(s.tail), tips: surf(s.tips), power: pw,
    rotor: s.rotor ? { ...s.rotor, at: pt(s.rotor.at), tail: s.rotor.tail ? { ...s.rotor.tail, at: pt(s.rotor.tail.at) } : undefined } : undefined,
    gun: s.gun ? { ...s.gun, at: pt(s.gun.at) } : undefined,
    lights: s.lights ? Object.fromEntries(Object.entries(s.lights).map(([k, v]) => [k, pt(v as Pt)])) : undefined,
  };
}

interface Layer { art: PixelArt; x: number; y: number }

/** Arts laid over each other (at art px of the first), on a canvas as big as they all need. */
function compose(layers: Layer[]): PixelArt {
  const x0 = Math.min(...layers.map((l) => Math.round(l.x)));
  const y0 = Math.min(...layers.map((l) => Math.round(l.y)));
  const x1 = Math.max(...layers.map((l) => Math.round(l.x) + l.art.w));
  const y1 = Math.max(...layers.map((l) => Math.round(l.y) + l.art.h));
  const a = new PixelArt(x1 - x0, y1 - y0);
  for (const l of layers) a.blit(l.art, Math.round(l.x) - x0, Math.round(l.y) - y0);
  return a;
}

/** The art as it stands, wheels on (and what's drawn over it: rotors, a wing), for the toybox. */
function standing(f: A.Airframe, body: () => PixelArt, extra?: (p: (x: number, y: number) => Pt) => Layer[], under?: (p: (x: number, y: number) => Pt) => Layer[]): () => PixelArt {
  return lazyArt(() => {
    const g = grid(f);
    const layers: Layer[] = [...(under?.(g.p) ?? []), { art: body(), x: 0, y: 0 }];
    for (const w of f.wheels) {
      const t = A.wheelArt(A.wheelKey(w));
      const [x, y] = g.p(w.x, w.r);
      layers.push({ art: t, x: x - t.w / 2, y: y - t.h / 2 });
    }
    layers.push(...(extra?.(g.p) ?? []));
    return compose(layers);
  });
}

function aircraft(
  id: string, name: string, group: string, description: string, f: A.Airframe, preview: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[],
): ItemDef {
  const g = grid(f);
  const low = f.wheels.length ? Math.max(...f.wheels.map((w) => g.p(w.x, w.r)[1] + w.r * A.PPM)) : g.h;
  const def: ItemDef = {
    id, name, category: 'Aircraft', group, description, tags: ['aircraft', 'fly', 'pilot', ...tags],
    preview: previewOf(preview),
    halfHeight: (low + 0.5 - g.h / 2) * PX,
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  return register(def);
}

const KEYS = 'Select it (or whoever’s at the controls) to fly it: W and S the throttle, Q and E pitch, A or D the brakes, F starts the engines. Drop people on it to board.';

// ---------------------------------------------------------------- the numbers

const B738_SPEC = specOf(A.B738, {
  kind: 'plane', trueKg: 62000, ky: 7.5, gameKg: 6000,
  wing: { at: [20.4, 2.2], area: 124.6, ar: 10.3, incidence: 1, cl0: 0.25, clMax: 1.45, flapCl: 1.1, flapCd: 0.07, cd0: 0.006 },
  tail: { at: [3.3, 4.45], area: 32.8, ar: 6.2, incidence: -1.5, cl0: 0, clMax: 1.1, elevator: 25, tau: 0.45, downwash: true },
  cd0: 0.019, e: 0.78, mcrit: 0.76, wave: 3,
  power: { kind: 'jet', at: [[25.4, 1.45]], thrust: 234000, spool: 6, idle: 0.07, nozzle: [22.9, 1.45] },
  vne: 175, gLimit: 2.5, gear: 3.6, breakup: 15, pitchRate: 5, brake: 3.5, roll: 0.15,
  lights: { nav: [14.2, 4.0], beacon: [18.0, 5.25], strobe: [14.0, 6.4], landing: [24.2, 2.0] },
});

const ATR_SPEC = specOf(A.ATR72, {
  kind: 'plane', trueKg: 20000, ky: 5.2, gameKg: 2600,
  wing: { at: [14.2, 4.0], area: 61, ar: 12, incidence: 2, cl0: 0.3, clMax: 1.5, flapCl: 0.9, flapCd: 0.06, cd0: 0.007 },
  tail: { at: [1.9, 7.5], area: 11.7, ar: 4.5, incidence: -1.5, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.55, downwash: true },
  cd0: 0.024, e: 0.8, mcrit: 0.6, wave: 2,
  power: { kind: 'turboprop', at: [[18.9, 3.45]], thrust: 76000, power: 4.1e6, spool: 3, idle: 0.08, props: [{ at: [18.97, 3.45], r: 1.965 }] },
  vne: 129, gLimit: 2.5, gear: 3.6, breakup: 14, pitchRate: 6, brake: 3.5, roll: 0.15,
  lights: { nav: [15.0, 4.3], beacon: [15.5, 4.2], strobe: [1.0, 7.6], landing: [18.1, 3.05] },
});

const C172_SPEC = specOf(A.C172, {
  kind: 'plane', trueKg: 900, ky: 1.2, gameKg: 300,
  wing: { at: [5.58, 2.05], area: 16.2, ar: 7.47, incidence: 1.5, cl0: 0.3, clMax: 1.5, flapCl: 0.6, flapCd: 0.08, cd0: 0.008 },
  tail: { at: [0.9, 1.22], area: 3.2, ar: 3.8, incidence: -2, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.5, downwash: true },
  cd0: 0.024, e: 0.74,
  power: { kind: 'prop', at: [[8.2, 1.15]], thrust: 2700, power: 134000, spool: 0.8, idle: 0.15, props: [{ at: [8.29, 1.15], r: 0.965 }] },
  vne: 84, gLimit: 3.8, gear: 3, breakup: 13, pitchRate: 14, brake: 3, roll: 0.2,
  lights: { nav: [5.9, 2.15], beacon: [0.8, 2.7], strobe: [5.9, 2.15], landing: [6.0, 2.04] },
});

const SR22_SPEC = specOf(A.SR22, {
  kind: 'plane', trueKg: 1150, ky: 1.2, gameKg: 330,
  wing: { at: [5.35, 0.9], area: 13.5, ar: 10.1, incidence: 1.5, cl0: 0.3, clMax: 1.45, flapCl: 0.55, flapCd: 0.07, cd0: 0.006 },
  tail: { at: [0.75, 1.38], area: 3.0, ar: 4.2, incidence: -2, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.5, downwash: true },
  cd0: 0.02, e: 0.8,
  power: { kind: 'prop', at: [[7.9, 1.32]], thrust: 4000, power: 231000, spool: 0.8, idle: 0.12, props: [{ at: [7.96, 1.32], r: 0.99 }] },
  vne: 105, gLimit: 3.8, gear: 3, breakup: 13, pitchRate: 14, brake: 3, roll: 0.2, caps: true,
  lights: { nav: [5.8, 0.98], beacon: [0.65, 2.7], strobe: [5.8, 0.98], landing: [5.9, 0.85] },
});

const F16_SPEC = specOf(A.F16, {
  kind: 'plane', trueKg: 12000, ky: 2.6, gameKg: 1800,
  wing: { at: [6.7, 2.05], area: 27.87, ar: 3.56, incidence: 0, cl0: 0.05, clMax: 1.55, flapCl: 0.25, flapCd: 0.03, cd0: 0.004 },
  tail: { at: [1.7, 2.04], area: 5.92, ar: 2.5, incidence: 0, cl0: 0, clMax: 1.1, elevator: 25, tau: 1, downwash: true },
  cd0: 0.017, e: 0.75, mcrit: 0.88, wave: 1.3,
  power: { kind: 'jet', at: [[1.2, 1.9]], thrust: 76000, boost: 53000, spool: 4, idle: 0.08, nozzle: [-0.05, 1.9] },
  vne: 410, gLimit: 9, gear: 4.5, breakup: 16, pitchRate: 22, brake: 4, roll: 0.2,
  gun: { at: [10.4, 2.5], rate: 50, speed: 1050, damage: 70, energy: 9000, recoil: 100, rounds: 511 },
  flares: 30, eject: true,
  lights: { nav: [5.0, 2.1], beacon: [2.4, 4.85], strobe: [2.4, 4.85], landing: [6.1, 1.2] },
});

// (its engines' thrust line set to pass close by its centre of gravity, as the real one's are: thrust
// from that high up would pitch it down on the runway)
const A10_SPEC = specOf(A.A10, {
  kind: 'plane', trueKg: 14500, ky: 2.8, gameKg: 2100,
  wing: { at: [8.9, 1.45], area: 47, ar: 6.54, incidence: 1, cl0: 0.25, clMax: 1.55, flapCl: 0.4, flapCd: 0.05, cd0: 0.007 },
  tail: { at: [1.4, 2.25], area: 8.6, ar: 4.5, incidence: -1, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.5, downwash: true },
  cd0: 0.028, e: 0.8, mcrit: 0.68, wave: 3,
  power: { kind: 'jet', at: [[6.5, 2.45]], thrust: 80600, spool: 6, idle: 0.08, nozzle: [4.1, 3.1] },
  vne: 230, gLimit: 7.3, gear: 4.5, breakup: 17, pitchRate: 18, brake: 4, roll: 0.2,
  gun: { at: [16.6, 1.5], rate: 50, speed: 1010, damage: 140, energy: 25000, recoil: 600, rounds: 1174 },
  flares: 30, eject: true,
  lights: { nav: [9.3, 1.68], beacon: [1.3, 4.45], strobe: [1.3, 4.45], landing: [9.0, 1.0] },
});

const UH60_SPEC = specOf(A.UH60, {
  kind: 'heli', trueKg: 7700, ky: 2.65, gameKg: 1350,
  tail: { at: [0.75, 1.95], area: 4.2, ar: 3, incidence: 0, cl0: 0, clMax: 1.0 },
  cd0: 0, dragArea: 2.4, dragUp: 16, e: 0.8,
  power: { kind: 'rotor', at: [], thrust: 0, power: 2.82e6, spool: 3, idle: 1 },
  rotor: { at: A.UH60_ROTOR.hub, r: A.UH60_ROTOR.r, tail: { at: A.UH60_ROTOR.tail, r: A.UH60_ROTOR.tailR } },
  vne: 99, gLimit: 3.5, gear: 3.5, breakup: 15, pitchRate: 22, brake: 3, roll: 0.3,
  lights: { nav: [9.0, 0.75], beacon: [0.6, 4.55], strobe: [0.6, 4.55], landing: [14.4, 0.9] },
});

const V22_SPEC = specOf(A.V22, {
  kind: 'tiltrotor', trueKg: 21000, ky: 3.5, gameKg: 2900,
  wing: { at: [9.3, 4.2], area: 35.5, ar: 5.5, incidence: 3, cl0: 0.3, clMax: 1.45, flapCl: 0.5, flapCd: 0.06, cd0: 0.008 },
  tail: { at: [1.4, 3.6], area: 8, ar: 3, incidence: -1, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.5, downwash: true },
  cd0: 0.06, e: 0.75, mcrit: 0.55, wave: 2, dragUp: 30,
  power: { kind: 'rotor', at: [], thrust: 0, power: 9.18e6, spool: 3, idle: 1 },
  rotor: { at: A.V22_ROTOR.pivot, r: A.V22_ROTOR.r, n: 2 },
  vne: 160, gLimit: 3, gear: 4, breakup: 14, pitchRate: 14, brake: 3, roll: 0.2,
  lights: { nav: [9.5, 4.45], beacon: [1.2, 5.35], strobe: [1.2, 5.35], landing: [15.0, 0.9] },
});

const ASK21_SPEC = specOf(A.ASK21, {
  kind: 'glider', trueKg: 380, ky: 1.3, gameKg: 160,
  wing: { at: [4.78, 0.84], area: 17.95, ar: 16.1, incidence: 2, cl0: 0.4, clMax: 1.35, cd0: 0.004 },
  tail: { at: [0.45, 1.53], area: 1.7, ar: 4.5, incidence: -1.5, cl0: 0, clMax: 1.0, elevator: 25, tau: 0.5, downwash: true },
  cd0: 0.0075, e: 0.85,
  vne: 78, gLimit: 6.5, gear: 2.5, breakup: 11, pitchRate: 14, brake: 2, roll: 0.3,
});

const O105_SPEC = specOf(A.O105, {
  kind: 'balloon', trueKg: 420, ky: 0.6, gameKg: 140,
  cd0: 0, e: 1, vne: 60, gLimit: 4, gear: 6, breakup: 10, pitchRate: 0, brake: 0, roll: 0,
});

const PPC_SPEC = specOf(A.PPC, {
  kind: 'ppc', trueKg: 230, ky: 0.9, gameKg: 120,
  wing: { at: A.PPC_HANG, area: 46.5, ar: 2.6, incidence: 4, cl0: 0.35, clMax: 1.0, cd0: 0.05 },
  cd0: 0, dragArea: 0.8, e: 0.7,
  power: { kind: 'prop', at: [A.PPC_PROP.at], thrust: 1500, power: 48000, spool: 0.8, idle: 0.15, props: [{ at: A.PPC_PROP.at, r: A.PPC_PROP.r }] },
  vne: 25, gLimit: 3, gear: 3, breakup: 10, pitchRate: 0, brake: 2.5, roll: 0.3,
});

const TRIKE_SPEC = specOf(A.TRIKE, {
  kind: 'trike', trueKg: 300, ky: 1.0, gameKg: 130,
  wing: { at: A.TRIKE_HANG, area: 11.25, ar: 6.7, incidence: 6, cl0: 0.25, clMax: 1.3, cd0: 0.015 },
  tips: { at: A.TRIKE_HANG, area: 3.75, ar: 6.7, incidence: 1, cl0: 0, clMax: 1.1, cd0: 0.015 },
  cd0: 0, dragArea: 0.6, e: 0.7,
  power: { kind: 'prop', at: [A.TRIKE_PROP.at], thrust: 2000, power: 60000, spool: 0.8, idle: 0.15, props: [{ at: A.TRIKE_PROP.at, r: A.TRIKE_PROP.r }] },
  vne: 40, gLimit: 4, gear: 3, breakup: 10, pitchRate: 0, brake: 2.5, roll: 0.25,
});

// ---------------------------------------------------------------- the toybox

const blades = (k: string) => A.bladesArt(k);
const disc = (k: string) => A.discArt(k);
const props = (k: string) => A.propArt(k);

export function registerAircraft(): void {
  const COM = 'Airplane · Commercial';
  const GA = 'Airplane · General aviation';
  const MIL = 'Airplane · Military';

  const b738 = lazyArt(A.b738Art);
  const b738Cfg = configOf(A.B738, b738, B738_SPEC, { blast: { power: 260, radius: 10, damage: 340 }, tough: 3000 });
  aircraft('boeing-737', 'Boeing 737-800', COM,
    `The world’s workhorse airliner: 39.5 m long, 62 t as flown, two CFM56 turbofans of 117 kN each. It lifts off near 150 knots (77 m/s) with its flaps half down ([) and cruises at Mach 0.78 up where the air is thin; past 175 m/s low down it’s overspeed, and much past that it comes apart. Its gear takes a landing of 3.6 m/s down. ${KEYS}`,
    A.B738, standing(A.B738, b738),
    (game, def, x, y, opts) => new Aircraft(game, def, b738Cfg, B738_SPEC, x, y, opts),
    ['boeing', '737', 'airliner', 'jet', 'passenger', 'commercial', 'plane', 'airplane']);

  const atr = lazyArt(A.atr72Art);
  const atrCfg = configOf(A.ATR72, atr, ATR_SPEC, { blast: { power: 200, radius: 8, damage: 300 }, tough: 2400 });
  aircraft('atr-72', 'ATR 72-600', COM,
    `A regional turboprop airliner: a high wing, a T-tail and two 2,750 hp PW127 engines turning six-bladed props. 20 t as flown; off the ground at about 60 m/s, and it cruises near 140 m/s. Mind the props: they cut. ${KEYS}`,
    A.ATR72, standing(A.ATR72, atr),
    (game, def, x, y, opts) => new PropPlane(game, def, atrCfg, ATR_SPEC, props, x, y, opts),
    ['atr', 'turboprop', 'airliner', 'regional', 'propeller', 'commercial', 'plane', 'airplane']);

  const c172 = lazyArt(A.c172Art);
  const c172Cfg = configOf(A.C172, c172, C172_SPEC, { blast: { power: 90, radius: 4, damage: 160 } });
  aircraft('cessna-172', 'Cessna 172S Skyhawk', GA,
    `The most built aeroplane there is: a high-winged four-seater with a 180 hp engine. It flies off at about 28 m/s (55 knots), stalls at 26 and tops out near 64 m/s. ${KEYS}`,
    A.C172, standing(A.C172, c172),
    (game, def, x, y, opts) => new PropPlane(game, def, c172Cfg, C172_SPEC, props, x, y, opts),
    ['cessna', '172', 'skyhawk', 'light', 'propeller', 'general aviation', 'trainer', 'plane', 'airplane']);

  const sr22 = lazyArt(A.sr22Art);
  const sr22Cfg = configOf(A.SR22, sr22, SR22_SPEC, { blast: { power: 95, radius: 4, damage: 170 } });
  aircraft('cirrus-sr22', 'Cirrus SR22', GA,
    `A fast low-winged composite four-seater with a 310 hp engine, and a parachute for the whole aircraft: pull it (] or its menu) and the Cirrus Airframe Parachute System lowers it, and everyone in it, to the ground. ${KEYS}`,
    A.SR22, standing(A.SR22, sr22),
    (game, def, x, y, opts) => new PropPlane(game, def, sr22Cfg, SR22_SPEC, props, x, y, opts),
    ['cirrus', 'sr22', 'caps', 'parachute', 'light', 'propeller', 'general aviation', 'plane', 'airplane']);

  const f16 = lazyArt(A.f16Art);
  const f16Cfg = configOf(A.F16, f16, F16_SPEC, { blast: { power: 190, radius: 7, damage: 280 }, noBelts: true });
  aircraft('f-16', 'F-16C Fighting Falcon', MIL,
    `A single-engined fighter: 12 t, a 76 kN turbofan and 129 kN with its afterburner (hold ;), built for 9 g (it comes apart at half as much again). Hold \\ for its 20 mm M61 cannon, Caps Lock for flares, ' to eject. ${KEYS}`,
    A.F16, standing(A.F16, f16),
    (game, def, x, y, opts) => new Aircraft(game, def, f16Cfg, F16_SPEC, x, y, opts),
    ['f16', 'f-16', 'viper', 'falcon', 'fighter', 'jet', 'military', 'afterburner', 'gun', 'eject', 'plane', 'airplane']);

  const a10 = lazyArt(A.a10Art);
  const a10Cfg = configOf(A.A10, a10, A10_SPEC, { blast: { power: 200, radius: 7, damage: 290 }, armour: 0.6, noBelts: true, tough: 2600 });
  aircraft('a-10', 'A-10C Thunderbolt II', MIL,
    `The “Warthog”: a straight-winged, armoured ground-attack jet built round the GAU-8 Avenger, a 30 mm cannon whose rounds go through a tank’s armour (hold \\: its recoil slows the plane). Two engines high on its back, twin fins, flares (Caps Lock), an ejection seat ('). ${KEYS}`,
    A.A10, standing(A.A10, a10),
    (game, def, x, y, opts) => new Aircraft(game, def, a10Cfg, A10_SPEC, x, y, opts),
    ['a10', 'a-10', 'warthog', 'thunderbolt', 'gau-8', 'attack', 'jet', 'military', 'gun', 'eject', 'plane', 'airplane']);

  const uh60 = lazyArt(A.uh60Art);
  const uh60Cfg = configOf(A.UH60, uh60, UH60_SPEC, { blast: { power: 170, radius: 7, damage: 260 } });
  aircraft('uh-60', 'UH-60 Black Hawk', 'Rotorcraft',
    `A utility helicopter: two 1,890 hp turboshafts on a 16.4 m rotor. F starts it (its rotor takes a few seconds to come up to speed); W and S are its collective, Q and E tilt it (the cyclic) and tilted it goes that way. Its rotor and tail rotor cut what they meet and break on what they can’t. Engines off coming down, its rotor windmills (autorotation). Room for two pilots and three more.`,
    A.UH60, standing(A.UH60, uh60, (p) => {
      const r = A.bladesArt(`${A.UH60_ROTOR.r}:0`);
      const [x, y] = p(...A.UH60_ROTOR.hub);
      const d = A.discArt(`${A.UH60_ROTOR.tailR}:1`);
      const [tx, ty] = p(...A.UH60_ROTOR.tail);
      return [{ art: r, x: x - r.w / 2, y: y - 3 }, { art: d, x: tx - d.w / 2, y: ty - d.h / 2 }];
    }),
    (game, def, x, y, opts) => new Helicopter(game, def, uh60Cfg, UH60_SPEC, blades, disc, x, y, opts),
    ['uh-60', 'uh60', 'black hawk', 'blackhawk', 'helicopter', 'heli', 'chopper', 'rotor', 'rotorcraft', 'military']);

  const v22 = lazyArt(A.v22Art);
  const v22Cfg = configOf(A.V22, v22, V22_SPEC, { blast: { power: 210, radius: 8, damage: 300 }, tough: 2400 });
  const pivot = grid(A.V22).p(...A.V22_ROTOR.pivot);
  aircraft('v-22', 'V-22 Osprey', 'Powered-lift',
    `A tiltrotor: two 6,150 hp engines on its wingtips turn rotors that point straight up to take off and hover as a helicopter does, then turn ahead (A, D) to fly as a plane on its wing, near twice as fast. Don’t turn them ahead on the ground: they’re too big to clear it. W and S are its collective, Q and E pitch it. ${KEYS}`,
    A.V22, standing(A.V22, v22, (p) => {
      // (its nacelles stood up for take-off, the rotors over them)
      const n = A.upright(A.v22NacelleArt());
      const [x, y] = p(...A.V22_ROTOR.pivot);
      const r = A.bladesArt(`${A.V22_ROTOR.r}:0`);
      return [{ art: n, x: x - n.w / 2, y: y - n.h }, { art: r, x: x - r.w / 2, y: y - A.V22_ROTOR.arm * A.PPM - 2 }];
    }),
    (game, def, x, y, opts) => new Tiltrotor(game, def, v22Cfg, V22_SPEC, pivot, A.V22_ROTOR.arm, lazyArt(A.v22NacelleArt), blades, x, y, opts),
    ['v-22', 'v22', 'osprey', 'tiltrotor', 'tilt rotor', 'vtol', 'powered lift', 'military']);

  const ask = lazyArt(A.ask21Art);
  const askCfg = configOf(A.ASK21, ask, ASK21_SPEC, { blast: { power: 20, radius: 2, damage: 40 }, material: { ...MAT.plastic, name: 'Glass fibre' } });
  aircraft('ask-21', 'Schleicher ASK 21', 'Glider',
    `A two-seat glider: 17 m of wing for its 380 kg, gliding 34 m for each metre it sinks. F starts a winch launch (a cable to a winch 900 m ahead winds it up to a few hundred metres, and lets go); after that, find rising air. W and S work its airbrakes. Q and E pitch it.`,
    A.ASK21, standing(A.ASK21, ask),
    (game, def, x, y, opts) => new Aircraft(game, def, askCfg, ASK21_SPEC, x, y, opts),
    ['glider', 'sailplane', 'schleicher', 'ask 21', 'ask21', 'winch', 'soar']);

  const basket = lazyArt(A.o105Art);
  const env = lazyArt(A.balloonEnvelopeArt);
  const o105Cfg = configOf(A.O105, basket, O105_SPEC, { blast: { power: 110, radius: 4, damage: 180 }, stand: true, noBelts: true, material: { ...MAT.wood, name: 'Wicker' } });
  const ew = Math.round(A.ENVELOPE.w * A.PPM);
  const eh = Math.round(A.ENVELOPE.h * A.PPM);
  const mouth = (A.ENVELOPE.mouth * A.PPM) / 2;
  const envShape: ShapeSpec[] = [{
    kind: 'poly',
    pts: hull([
      ...Array.from({ length: 9 }, (_, i): Pt => {
        const t = Math.PI + (i / 8) * Math.PI;
        return [ew / 2 + Math.cos(t) * ew * 0.49, ew / 2 + Math.sin(t) * ew * 0.49];
      }),
      [ew * 0.02, ew / 2], [ew * 0.98, ew / 2], [ew / 2 - mouth, eh - 1], [ew / 2 + mouth, eh - 1], [ew * 0.12, eh * 0.72], [ew * 0.88, eh * 0.72],
    ]).map(([x, y]) => [x - ew / 2, eh / 2 - y]),
  }];
  const burner = grid(A.O105).p(...A.O105_BURNER);
  aircraft('hot-air-balloon', 'Hot-Air Balloon (Cameron O-105)', 'Lighter-than-air',
    `A 2,975 m³ envelope over a wicker basket for four. Hold W to fire the burner: hot air is lighter than the air round it, so it rises (give it a while: there’s a lot of air to heat); let go and it cools and sinks; hold S to open the vent at the crown. It drifts where the wind blows. Bullets hole the envelope and fire burns it; cooked past 125 °C its fabric gives. Insert holds its height.`,
    A.O105, lazyArt(() => {
      const e = env();
      const b = basket();
      const a = new PixelArt(e.w, e.h + Math.round(1.2 * A.PPM) + b.h);
      a.blit(e, 0, 0);
      a.blit(b, Math.round(e.w / 2 - b.w / 2), a.h - b.h);
      return a;
    }),
    (game, def, x, y, opts) => new HotAirBalloon(game, def, o105Cfg, O105_SPEC, env, envShape, burner, 1.2, x, y, opts),
    ['balloon', 'hot air', 'hot-air', 'cameron', 'envelope', 'basket', 'burner', 'lighter than air']);

  const ppc = lazyArt(A.ppcArt);
  const ppcCfg = configOf(A.PPC, ppc, PPC_SPEC, { blast: { power: 40, radius: 2.5, damage: 80 }, noBelts: true });
  const hang = grid(A.PPC).p(...A.PPC_HANG);
  aircraft('powered-parachute', 'Powered Parachute', 'Powered parachute',
    `A two-seat cart with a 65 hp pusher prop under a 46 m² ram-air canopy (after the Buckeye Dream Machine). Laid out behind it, the canopy fills and rises overhead once the cart runs fast enough (W); it flies at about 14 m/s whatever you do, more throttle to climb, less to sink. Q or E pulls the brakes to flare for landing. F starts the engine.`,
    A.PPC, standing(A.PPC, ppc),
    (game, def, x, y, opts) => new PoweredParachute(game, def, ppcCfg, PPC_SPEC, props, lazyArt(A.ppcCanopyArt), hang, x, y, opts),
    ['powered parachute', 'ppc', 'paraglider', 'paramotor', 'buckeye', 'canopy', 'ultralight']);

  const trike = lazyArt(A.trikeArt);
  const trikeCfg = configOf(A.TRIKE, trike, TRIKE_SPEC, { blast: { power: 45, radius: 2.5, damage: 90 }, noBelts: true });
  const thang = grid(A.TRIKE).p(...A.TRIKE_HANG);
  aircraft('trike', 'Weight-Shift Trike', 'Weight-shift-control',
    `A trike under a 15 m² flexwing, flown by shifting your weight (after the Air Creation Tanarg 912): Q and E push the bar out or pull it in, swinging the wing on its mast: out, it slows and climbs; in, it speeds up and dives. An 80 hp Rotax pushes it at about 28 m/s. W and S the throttle, F starts the engine.`,
    A.TRIKE, standing(A.TRIKE, trike, (p) => {
      const w = A.trikeWingArt();
      const [x, y] = p(...A.TRIKE_HANG);
      return [{ art: w, x: x - A.TRIKE_WING.hang[0] * A.PPM, y: y - A.TRIKE_WING.hang[1] * A.PPM }];
    }),
    (game, def, x, y, opts) => new Trike(game, def, trikeCfg, TRIKE_SPEC, props, lazyArt(A.trikeWingArt), thang, A.TRIKE_WING.hang, x, y, opts),
    ['trike', 'microlight', 'ultralight', 'flexwing', 'weight shift', 'hang glider', 'tanarg', 'air creation']);
}

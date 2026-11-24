import { register, lazyArt, previewOf } from './items';
import { MAT } from '../world/Materials';
import { PX } from '../engine/constants';
import { PixelArt } from '../art/PixelArt';
import * as A from '../art/missiles';
import { seeThrough, wreckOf } from '../art/vehicles';
import { artRect, densityFor } from '../entities/Item';
import { HeatLauncher, LIFT, Missile, MouseLauncher, SpikeLauncher, WARHEADS, type GuidedLauncher, type MissileSpec } from '../entities/Missiles';
import { Radar, RadarLauncher } from '../entities/Radar';
import { MissileCarrier } from '../entities/M113';
import type { CarConfig, SeatSpec } from '../entities/Car';
import type { CannonSpec } from '../entities/Tank';
import type { PropConfig } from '../entities/Prop';
import type { ShapeSpec } from '../world/Part';
import type { ItemDef, SpawnOptions } from '../world/types';
import type { Game } from '../world/Game';

// The guided missiles (not in the toybox: their launchers fire them), the
// mouse-guided launcher and the Spike LR-II's, with the weapons; and the M113
// missile carrier, with the vehicles.

type Pt = [number, number];

/** Collider outline from art pixels (x right, y down from the top-left), centered on the art. */
function artPoly(w: number, h: number, pts: Pt[]): ShapeSpec {
  return { kind: 'poly', pts: pts.map(([x, y]) => [x - w / 2, h / 2 - y]) };
}

/** Polygon area (art pixels²): densityFor() leaves polygons out. */
function polyArea(pts: Pt[]): number {
  let a = 0;
  pts.forEach(([x, y], i) => {
    const [u, v] = pts[(i + 1) % pts.length];
    a += x * v - u * y;
  });
  return Math.abs(a) / 2;
}

/**
 * How each standard missile flies: the mouse-guided one a little slower and
 * handier, to be steered by hand; the Spike faster, coming down on its target
 * from above.
 */
const SPECS: Record<A.MissileKind, MissileSpec> = {
  guided: { cruise: 24, accel: 40, turn: 4.6, burn: 8, loft: false, warhead: WARHEADS.standard },
  spike: { cruise: 30, accel: 45, turn: 4.6, burn: 8, loft: true, warhead: WARHEADS.standard },
  // (0.5.0) the heat seeker's (as the pod's: quick off the rail, fast, a short burn) and the radar-guided SAM's
  // (faster still, with a proximity fuse, to bring down aircraft); an unguided rocket's (see registerRockets)
  heat: { cruise: 110, accel: 220, turn: 5.5, burn: 4, loft: false, prox: 1.8, warhead: { ...WARHEADS.standard, power: 90, damage: 200, jet: 500 } },
  radar: { cruise: 150, accel: 320, turn: 6, burn: 6, loft: false, prox: 2.4, warhead: { ...WARHEADS.standard, power: 110, damage: 230, jet: 600 } },
  rocket: { cruise: 320, accel: 1100, turn: 0, burn: 1.1, loft: false, unguided: true, warhead: { power: 80, radius: 2.6, damage: 170, shrapnel: 3, jet: 350 } },
};

/**
 * A version's (see A.MissileVersion): the cruise missile's motor burns four
 * times as long, its warhead twice the standard's; a Strike's small missiles
 * are a little quicker and handier, their motors burn out sooner, and their
 * warheads are half the standard's.
 */
function specOf(kind: A.MissileKind, version: A.MissileVersion): MissileSpec {
  const s = SPECS[kind];
  // (a kind's own warhead, scaled as the standard one is to the version's)
  const w = (v: A.MissileVersion) => {
    const k = WARHEADS[v].power / WARHEADS.standard.power;
    if (s.warhead === WARHEADS.standard) return WARHEADS[v];
    return { ...s.warhead, power: s.warhead.power * k, damage: s.warhead.damage * k, jet: s.warhead.jet * k, radius: s.warhead.radius * Math.cbrt(k), shrapnel: Math.round((s.warhead.shrapnel ?? 0) * k) };
  };
  if (version === 'cruise') return { ...s, burn: s.burn * 4, warhead: w('cruise') };
  if (version === 'strike') return { ...s, cruise: s.cruise + 2, accel: s.accel * 1.2, turn: s.turn * 1.15, burn: s.burn * 0.6, warhead: w('strike') };
  // (0.5.0) a ballistic missile twice as fast, climbing high over its target to come down on it; an ICBM's three
  // three times as fast and each three times the warhead, higher still, its motor burning longer to get up there.
  // (0.5.1) Its fins turn it, and take out its slide, as much faster as it flies, so it turns as tight a circle as
  // its kind's standard one: with the standard's a radar-guided Ballistic (300 m/s) swung round a 50 m circle (and
  // slid wide of that), overshot a car 120 m off coming down on it and went off in the ground 23 m past it.
  if (version === 'ballistic') return { ...s, cruise: s.cruise * 2, accel: s.accel * 2, turn: s.turn * 2, lift: LIFT * 2, arc: [0.7, 300], warhead: w('ballistic') };
  if (version === 'icbm') return { ...s, cruise: s.cruise * 3, accel: s.accel * 3, turn: s.turn * 3, lift: LIFT * 3, burn: s.burn * 2, arc: [1, 800], warhead: w('icbm') };
  return s;
}

/** Each version's weight (kg). */
const MISSILE_KG: Record<A.MissileVersion, number> = { standard: 3, cruise: 5, strike: 1, ballistic: 4, icbm: 6 };

/** A missile of `kind` and `version` (not in the toybox). */
function missile(id: string, name: string, kind: A.MissileKind, version: A.MissileVersion): ItemDef {
  const art = lazyArt(() => A.missileArt(kind, version));
  const size = A.MISSILES[version];
  const shapes: ShapeSpec[] = [{ kind: 'box', w: size.w - 2, h: size.body, r: 0.8 }];
  const spec = specOf(kind, version);
  const def: ItemDef = register({
    id, name, category: 'Weapons', description: 'A guided missile in flight.', tags: [], hidden: true,
    preview: previewOf(art),
    create: (game, x, y, opts) => new Missile(game, def, kind, version, spec, art(), shapes, densityFor(MISSILE_KG[version], shapes), x, y, opts),
  });
  return def;
}

/** Each version of a kind's missile: the standard one keeps its first id (`missile-guided`, `missile-spike`). */
function missiles(kind: A.MissileKind, name: string): Record<A.MissileVersion, ItemDef> {
  return {
    standard: missile(`missile-${kind}`, `${name} Missile`, kind, 'standard'),
    cruise: missile(`missile-${kind}-cruise`, `${name} Cruise Missile`, kind, 'cruise'),
    strike: missile(`missile-${kind}-strike`, `${name} Strike Missile`, kind, 'strike'),
    ballistic: missile(`missile-${kind}-ballistic`, `${name} Ballistic Missile`, kind, 'ballistic'),
    icbm: missile(`missile-${kind}-icbm`, `${name} ICBM`, kind, 'icbm'),
  };
}

/** The launcher on its bipod: one convex piece from the baseplate's foot up the tube to its muzzle. */
const MORTAR_PTS: Pt[] = [[0, 20.5], [3, 17.8], [21.6, 0.4], [26.4, 5.6], [24, 23], [0, 23]];
const MORTAR_SHAPES = [artPoly(A.MORTAR.w, A.MORTAR.h, MORTAR_PTS)];
const MORTAR_KG = 18;
/** The vertical cell's box (the hatches above it don't count). */
const VLS_SHAPES = [artRect(A.VLS.w, A.VLS.h, 0, A.VLS.top, A.VLS.w, A.VLS.h - A.VLS.top, 0.4)];
const VLS_KG = 30;

/** A launcher's look and build, normal or vertical (see GuidedLauncher). */
function launcherCfg(kind: A.MissileKind, vertical: boolean): PropConfig {
  if (vertical) return { art: lazyArt(() => A.vlsArt(kind)), material: MAT.metal, shapes: VLS_SHAPES, density: densityFor(VLS_KG, VLS_SHAPES), ownTexture: true, angularDamping: 0.3 };
  const density = MORTAR_KG / (polyArea(MORTAR_PTS) * PX * PX);
  return { art: lazyArt(() => A.launcherArt(kind, true)), material: MAT.metal, shapes: MORTAR_SHAPES, density, angularDamping: 0.3 };
}

/** A guided launcher's item: normal or vertical by its config (see GuidedLauncher.setVertical()), firing `rounds` by version. */
type LauncherClass = new (game: Game, def: ItemDef, cfg: PropConfig, kind: A.MissileKind, rounds: Record<A.MissileVersion, ItemDef>, x: number, y: number, opts: SpawnOptions) => GuidedLauncher;

function launcher(id: string, name: string, kind: A.MissileKind, rounds: Record<A.MissileVersion, ItemDef>, make: LauncherClass, description: string, tags: string[]): void {
  const normal = launcherCfg(kind, false);
  const vertical = launcherCfg(kind, true);
  const def: ItemDef = register({
    id, name, category: 'Weapons', description, tags,
    preview: previewOf(normal.art),
    halfHeight: (A.MORTAR.h * PX) / 2,
    create: (game, x, y, opts) => new make(game, def, opts.config?.vertical === true ? vertical : normal, kind, rounds, x, y, opts),
  });
}

// ---- the M113

const D = A.M113;
/** Down in the commander's hatch: crouched on the seat inside, head and shoulders out, hands on the rim (as in a tank's). */
const HATCH_POSE: SeatSpec['pose'] = {
  head: -0.1, upperLegF: 2.1, upperLegB: 2.1, lowerLegF: -2.5, lowerLegB: -2.5, footF: 0.5, footB: 0.5,
  upperArmF: 0.3, upperArmB: 0.2, lowerArmF: 0.4, lowerArmB: 0.4,
};

/** The track's sloping ends round the idler and the sprocket, down to the next road wheel's foot (as the tanks' are). */
function trackEnds(): Pt[][] {
  const r = D.r;
  const end = (i: number, next: number, out: number): Pt[] => {
    const [x, y] = D.axles[i];
    const [nx, ny] = D.axles[next];
    return [[x, y - r], [x + r * out, y], [x + r * 0.7 * out, y + r * 0.7], [x, y + r], [nx + 2 * out, ny + r - 0.5], [nx + 2 * out, ny + r - 3]];
  };
  const n = D.axles.length;
  return [end(n - 1, n - 2, 1), end(0, 1, -1)];
}

/** The hull's weight (kg): seven wheels of 60 kg and the launcher's 60 come on top, about 1.6 t in all. */
const M113_KG = 1100;
/** The hull, the cupola and the launcher's arm on the roof, and the track's ends. */
const M113_PIECES: Pt[][] = [
  D.hull,
  [[83, 14], [95, 14], [95, 20], [83, 20]],
  [[52, 7], [57, 7], [57, 20], [52, 20]],
  ...trackEnds(),
];

function m113(rounds: Record<A.MissileVersion, ItemDef>): void {
  const round = rounds.standard;
  const body = lazyArt(A.m113Art);
  const wreck = lazyArt(() => wreckOf(body()));
  // (the front layer over the commander is the hull, down to the track)
  const rows = D.hull.reduce((m, [, y]) => Math.max(m, y), 0) + 1;
  const area = M113_PIECES.reduce((s, p) => s + polyArea(p), 0) * PX * PX;
  const cfg: CarConfig = {
    body, wheel: lazyArt(A.m113WheelArt), idler: { art: lazyArt(A.m113SprocketArt), axles: [0, D.axles.length - 1] },
    shapes: M113_PIECES.map((p) => artPoly(D.w, D.h, p)), density: M113_KG / area,
    wheelDensity: 240, axles: D.axles, wheelR: D.r, speed: 8, torque: 380, headlight: D.lamp, pitch: 0.75, blunt: 1.1,
    bodyName: 'Hull', wheelName: 'Road wheel',
    seats: [{ at: D.hatch, pose: HATCH_POSE, recline: 0, band: 0 }], cabin: D.cabin, noBelts: true,
    front: lazyArt(() => seeThrough(body(), rows)), frontOf: (a) => seeThrough(a, rows), wreck, wreckFront: lazyArt(() => seeThrough(wreck(), rows)),
    // light aluminium armour: a missile of its own kind wrecks it, a tank's shell does it great harm
    engine: D.engine, fuel: D.fuel, armour: 0.25, blast: { power: 170, radius: 6, damage: 280 }, band: D.band, trueKg: 12300,
  };
  const L = A.M113_LAUNCHER;
  const shapes = [artRect(L.w, L.h, 0, 4, 36, 11, 0.5), artRect(L.w, L.h, 4, 0, 14, 5, 0.5)];
  const gun: CannonSpec = {
    barrel: lazyArt(A.m113LauncherArt), shapes, density: densityFor(60, shapes),
    trunnion: D.trunnion, pivot: L.pivot, muzzle: L.tubes[0], speed: 60, reload: 3.5, recoil: 0, limits: [-10, 30], shell: round,
  };
  // the toybox's picture: the hull with its wheels on, the launcher on its arm above
  const top = L.pivot[1] - D.trunnion[1];
  const preview = lazyArt(() => {
    const a = new PixelArt(D.w, D.h + top);
    a.blit(gun.barrel(), D.trunnion[0] - L.pivot[0], 0);
    a.blit(body(), 0, top);
    D.axles.forEach(([ax, ay], i) => {
      const w = i === 0 || i === D.axles.length - 1 ? cfg.idler!.art() : cfg.wheel();
      a.blit(w, Math.round(ax + 0.5 - w.w / 2), Math.round(ay + 0.5 - w.h / 2) + top);
    });
    return a;
  });
  const def: ItemDef = register({
    id: 'm113', name: 'M113A1 Missile Carrier', category: 'Vehicles', tags: ['vehicle', 'apc', 'm113', 'm901', 'tow', 'missile', 'launcher', 'army', 'military', 'tracks', 'usa', 'american'],
    description: 'The M113A1 armoured personnel carrier with a missile launcher raised on its roof. Select it to drive it with A and D, and raise or lower the launcher with W and S. ' +
      'Use fires a missile you steer with the cursor; put it on a team and its crew find the nearest enemy and fire missiles that guide themselves onto it. Its menu picks the missile: standard, cruise or a Strike of five. ' +
      'Its thin aluminium armour won\'t stand much.',
    preview: previewOf(preview),
    // from the hull's middle down to the bottom of its wheels
    halfHeight: (Math.max(...D.axles.map(([, ay]) => ay)) + 0.5 - D.h / 2 + D.r) * PX,
    create: (game, x, y, opts) => new MissileCarrier(game, def, cfg, gun, rounds, x, y, opts),
  });
}

/** What every launcher's menu says of its missiles (see A.MissileVersion). */
const VERSIONS_TOLD = 'Its menu picks the missile: the standard one; a cruise missile, its motor burning four times as long and its warhead twice as big; ' +
  'a Strike, five small missiles at one launch that never hit each other; a ballistic missile, twice as fast, that climbs high and comes down on its target; ' +
  'or an ICBM, three missiles at once that never hit each other, each three times as fast with three times the warhead. Burnt out, a missile still steers as it falls.';

export function registerMissiles(): void {
  const guided = missiles('guided', 'Guided');
  const spike = missiles('spike', 'Spike');
  launcher('guided-launcher', 'Guided Missile Launcher', 'guided', guided, MouseLauncher,
    'An anti-tank missile on a squat launch tube. Activate (F) to fire: the dark green missile flies wherever the cursor is, turning as you move it, and blows up on what it hits, wrecking a car outright. ' +
    'Turn it to aim the tube (drag it and press A or D). Vertical launch, in its menu, puts it in a launch cell that throws the missile straight up, turns it over and then lights its motor. ' +
    VERSIONS_TOLD + ' A Strike\'s five spread out round the cursor.',
    ['missile', 'launcher', 'atgm', 'guided', 'wire', 'tow', 'anti-tank', 'mortar', 'vls', 'cruise', 'strike', 'salvo']);
  launcher('spike-launcher', 'Spike LR-II', 'spike', spike, SpikeLauncher,
    'A fire-and-forget anti-tank missile. Hold F to switch its seeker on: it tracks what\'s inside the reticle\'s square, and its small square goes on the vehicle, person or animal nearest the middle; ' +
    'keep that in the square until it locks on, then let go of F to fire. The white missile flies itself to the target, over or round what\'s in the way, and comes down on it from above. ' +
    'Let go before it locks and nothing fires. Vertical launch is in its menu. ' + VERSIONS_TOLD + ' A Strike\'s five go after the locked target and the others in the square, marked by small squares.',
    ['missile', 'launcher', 'atgm', 'spike', 'fire and forget', 'seeker', 'lock', 'anti-tank', 'mortar', 'vls', 'israel', 'cruise', 'strike', 'salvo']);
  m113(guided);
  launcher('heat-launcher', 'Heat-Seeking Missile Launcher', 'heat', missiles('heat', 'Heat-Seeking'), HeatLauncher,
    'A launcher for the heat-seeking missile (the pods’ air-to-air missile, on the ground). Activate (F) to fire: the grey missile leaves along the tube and goes after the hottest thing ahead of it, ' +
    'an engine, a jet’s flame (on afterburner, more), something burning, and goes off near it. A flare in its eye pulls it off; it won’t go after what fired it. Turn it to aim (drag it and press A or D). ' +
    'Vertical launch is in its menu. ' + VERSIONS_TOLD,
    ['missile', 'launcher', 'heat', 'seeker', 'infrared', 'stinger', 'sidewinder', 'sam', 'anti-air', 'aa', 'manpads', 'vls', 'cruise', 'strike', 'ballistic', 'icbm']);
  launcher('radar-launcher', 'Radar-Guided Missile Launcher', 'radar', missiles('radar', 'Radar-Guided'), RadarLauncher,
    'A surface-to-air missile launcher guided by a radar. Link a Radar to it (wire them together with the Wire tool, or build both into one thing), lock the radar on a target, then activate this (F): ' +
    'the fast pale missile flies to wherever the radar’s lock is, following it as the radar tracks it, and goes off near it, so it brings down aircraft. With no lock it flies straight on. ' +
    'Vertical launch is in its menu. ' + VERSIONS_TOLD,
    ['missile', 'launcher', 'radar', 'sam', 'patriot', 's-300', 'surface to air', 'anti-air', 'aa', 'guided', 'vls', 'cruise', 'strike', 'ballistic', 'icbm']);
  const radar = lazyArt(() => A.radarArt(0));
  const rShapes = [artRect(A.RADAR.w, A.RADAR.h, 3, 39, 54, 33, 0.5), artRect(A.RADAR.w, A.RADAR.h, 27, 20, 6, 15, 0.3), artRect(A.RADAR.w, A.RADAR.h, 8, 1, 44, 18, 0.3)];
  const rCfg: PropConfig = { art: radar, material: MAT.metal, shapes: rShapes, density: densityFor(900, rShapes), ownTexture: true, angularDamping: 0.3 };
  const rDef: ItemDef = register({
    id: 'radar', name: 'Radar', category: 'Weapons',
    description: 'A search and tracking radar on its shelter. Select it and hold F: green brackets flash round the cursor and pick out the vehicle or aircraft nearest their middle; keep it there a second and the radar locks on. ' +
      'Let go of F and the lock holds: a green box tracks the target, with its range, height and speed beside it, until it’s gone, out of range or hidden behind the ground too long. ' +
      'Wire it to a Radar-Guided Missile Launcher (or build both into one thing) and that launcher’s missiles fly to the lock.',
    tags: ['radar', 'lock', 'track', 'telemetry', 'sam', 'anti-air', 'aa', 'patriot', 'sensor', 'guidance'],
    preview: previewOf(radar),
    halfHeight: (A.RADAR.h * PX) / 2,
    create: (game, x, y, opts) => new Radar(game, rDef, rCfg, A.radarArt, x, y, opts),
  });
}

/** An unguided rocket's flight (see entities/Combat RocketPod). */
export const ROCKET_SPEC: MissileSpec = SPECS.rocket;

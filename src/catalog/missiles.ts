import { register, lazyArt, previewOf } from './items';
import { MAT } from '../world/Materials';
import { PX } from '../engine/constants';
import { PixelArt } from '../art/PixelArt';
import * as A from '../art/missiles';
import { seeThrough, wreckOf } from '../art/vehicles';
import { artRect, densityFor } from '../entities/Item';
import { Missile, MouseLauncher, SpikeLauncher, type MissileSpec } from '../entities/Missiles';
import { MissileCarrier } from '../entities/M113';
import type { CarConfig, SeatSpec } from '../entities/Car';
import type { CannonSpec } from '../entities/Tank';
import type { PropConfig } from '../entities/Prop';
import type { ShapeSpec } from '../world/Part';
import type { ItemDef } from '../world/types';

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
 * How each missile flies: the mouse-guided one a little slower and handier, to
 * be steered by hand; the Spike faster, coming down on its target from above.
 */
const SPECS: Record<A.MissileKind, MissileSpec> = {
  guided: { cruise: 24, accel: 40, turn: 4.6, burn: 8, loft: false },
  spike: { cruise: 30, accel: 45, turn: 4.6, burn: 8, loft: true },
};

/** A missile of `kind` (not in the toybox). */
function missile(id: string, name: string, kind: A.MissileKind): ItemDef {
  const art = lazyArt(() => A.missileArt(kind));
  const shapes: ShapeSpec[] = [{ kind: 'box', w: A.MISSILE.w - 2, h: A.MISSILE.body, r: 0.8 }];
  const def: ItemDef = register({
    id, name, category: 'Weapons', description: 'A guided missile in flight.', tags: [], hidden: true,
    preview: previewOf(art),
    create: (game, x, y, opts) => new Missile(game, def, kind, SPECS[kind], art(), shapes, densityFor(3, shapes), x, y, opts),
  });
  return def;
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

/** A guided launcher's item: normal or vertical by its config (see GuidedLauncher.setVertical()). */
function launcher(id: string, name: string, kind: A.MissileKind, round: ItemDef, make: typeof MouseLauncher | typeof SpikeLauncher, description: string, tags: string[]): void {
  const normal = launcherCfg(kind, false);
  const vertical = launcherCfg(kind, true);
  const def: ItemDef = register({
    id, name, category: 'Weapons', description, tags,
    preview: previewOf(normal.art),
    halfHeight: (A.MORTAR.h * PX) / 2,
    create: (game, x, y, opts) => new make(game, def, opts.config?.vertical === true ? vertical : normal, kind, round, x, y, opts),
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

function m113(round: ItemDef): void {
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
    engine: D.engine, fuel: D.fuel, armour: 0.25, blast: { power: 170, radius: 6, damage: 280 }, band: D.band,
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
      'Use fires a missile you steer with the cursor; put it on a team and its crew find the nearest enemy and fire missiles that guide themselves onto it. Its thin aluminium armour won\'t stand much.',
    preview: previewOf(preview),
    // from the hull's middle down to the bottom of its wheels
    halfHeight: (Math.max(...D.axles.map(([, ay]) => ay)) + 0.5 - D.h / 2 + D.r) * PX,
    create: (game, x, y, opts) => new MissileCarrier(game, def, cfg, gun, round, x, y, opts),
  });
}

export function registerMissiles(): void {
  const guided = missile('missile-guided', 'Guided Missile', 'guided');
  const spike = missile('missile-spike', 'Spike Missile', 'spike');
  launcher('guided-launcher', 'Guided Missile Launcher', 'guided', guided, MouseLauncher,
    'An anti-tank missile on a squat launch tube. Activate (F) to fire: the dark green missile flies wherever the cursor is, turning as you move it, and blows up on what it hits, wrecking a car outright. ' +
    'Turn it to aim the tube (drag it and press A or D). Vertical launch, in its menu, puts it in a launch cell that throws the missile straight up, turns it over and then lights its motor.',
    ['missile', 'launcher', 'atgm', 'guided', 'wire', 'tow', 'anti-tank', 'mortar', 'vls']);
  launcher('spike-launcher', 'Spike LR-II', 'spike', spike, SpikeLauncher,
    'A fire-and-forget anti-tank missile. Hold F to switch its seeker on, and keep the small square in the middle of the reticle on a vehicle, a person or an animal until it locks on; then let go of F to fire. ' +
    'The white missile flies itself to the target, over or round what\'s in the way, and comes down on it from above. Let go before it locks and nothing fires. Vertical launch is in its menu.',
    ['missile', 'launcher', 'atgm', 'spike', 'fire and forget', 'seeker', 'lock', 'anti-tank', 'mortar', 'vls', 'israel']);
  m113(guided);
}

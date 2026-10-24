import { WORLD } from '../engine/constants';
import { clamp } from '../engine/math';
import { cleanOutline, convexPieces, selfCrossing, signedArea, type Pt } from '../engine/geometry';
import { store } from '../engine/Store';

/**
 * A map's look: the tiles of its floor, walls and ground, its backdrop and the
 * colour around it (see Environment). The void has no floor at all: what falls
 * off its ground falls for ever (and is taken away, far down).
 */
export type ThemeId = 'concrete' | 'outdoors' | 'desert' | 'night' | 'snow' | 'void';

/** What a piece of ground is made of. 'ground' is the theme's own: concrete, earth under grass, sand or asphalt. */
export type TerrainMat = 'ground' | 'rock' | 'concrete' | 'brick' | 'windows' | 'metal';

/** A piece of static ground: a convex polygon, its corners in world meters (counter-clockwise once cleaned). */
export interface TerrainPiece {
  pts: [number, number][];
  mat?: TerrainMat;
}

/** A map to play on: the size of the room, its look and the ground built into it. */
export interface MapSpec {
  /** 'lab', 'hangar', … for the built-in ones; 'custom:<random id>' for the player's own. */
  id: string;
  name: string;
  /** Meters: the world spans −width/2 … +width/2. */
  width: number;
  /** The ceiling's height (m). */
  height: number;
  theme: ThemeId;
  /** Static ground that is part of the map. */
  terrain: TerrainPiece[];
  /**
   * A bare floor going on far past any view (the endless plate, see ENDLESS): it
   * has no ground, and what's sized to the world (puddles, the floor drawn) keeps
   * to a stretch around the camera instead.
   */
  endless?: boolean;
  /** A sea: water from x0 to x1 (m) up to `level` m, that things float or sink in (see systems/Water). */
  water?: MapWater;
  /** Weather of its own, set as the map is switched to (the Snow map's snow; see systems/Weather). */
  weather?: MapWeather;
}

export interface MapWater {
  x0: number;
  x1: number;
  level: number;
}

/** A map's own weather: how much rain, snow and fog (0..1), and the lightning chance (0..100). */
export interface MapWeather {
  rain?: number;
  snow?: number;
  fog?: number;
  lightning?: number;
}

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'concrete', name: 'Concrete hall' },
  { id: 'outdoors', name: 'Outdoors' },
  { id: 'desert', name: 'Desert' },
  { id: 'night', name: 'Night city' },
  { id: 'snow', name: 'Snow' },
  { id: 'void', name: 'Void (no floor)' },
];

/** Is it a map without a floor (see ThemeId)? */
export function floorless(spec: MapSpec): boolean {
  return spec.theme === 'void';
}

export const TERRAIN_MATS: { id: TerrainMat; name: string }[] = [
  { id: 'ground', name: 'Ground' },
  { id: 'rock', name: 'Rock' },
  { id: 'concrete', name: 'Concrete' },
  { id: 'brick', name: 'Brick' },
  { id: 'windows', name: 'Building' },
  { id: 'metal', name: 'Steel' },
];

/**
 * How big a map may be (m), and how much ground it may have: pieces, corners of
 * a piece, and of an outline before it's split into convex pieces. Stains keep
 * their pixels in 16 bits (±1024 m), so a map is at most 1000 m across.
 */
export const MAP_LIMITS = { minWidth: 40, maxWidth: 1000, minHeight: 12, maxHeight: 250, pieces: 600, corners: 32, outline: 64 };

/** How far below the floor ground may reach (m): into the floor slab, so it has no seam where it meets the floor. */
const BELOW = 2;
/** The smallest piece of ground kept (m²): two sprite pixels square. */
const MIN_AREA = (2 / 32) ** 2;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Is a counter-clockwise outline convex? */
function convex(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) return false;
  }
  return true;
}

/** Is (x, y) inside a counter-clockwise convex outline, or within `margin` m of it? */
export function contains(pts: [number, number][], x: number, y: number, margin = 0): boolean {
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1 < n ? i + 1 : 0];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    // (left of every edge: inside)
    if (ex * (y - a[1]) - ey * (x - a[0]) < -margin * Math.hypot(ex, ey)) return false;
  }
  return true;
}

/**
 * Ground as read from a file, a save or the Terrain tool, made safe to build:
 * each outline's corners finite and inside the map (clamped), counter-clockwise
 * without repeats, and split into convex pieces if it isn't convex. Outlines that
 * cross themselves, slivers, and pieces past the limits are dropped.
 */
export function cleanPieces(list: readonly unknown[], width: number, height: number): TerrainPiece[] {
  const out: TerrainPiece[] = [];
  const hw = width / 2;
  for (const raw of list) {
    const r = raw as Partial<TerrainPiece> | null;
    if (!r || !Array.isArray(r.pts) || r.pts.length < 3 || r.pts.length > MAP_LIMITS.outline) continue;
    const pts: Pt[] = [];
    for (const p of r.pts) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) break;
      pts.push([round(clamp(p[0], -hw, hw)), round(clamp(p[1], WORLD.floor - BELOW, WORLD.floor + height))]);
    }
    if (pts.length !== r.pts.length) continue;
    const outline = cleanOutline(pts);
    if (outline.length < 3 || selfCrossing(outline)) continue;
    const mat = r.mat !== 'ground' && TERRAIN_MATS.some((m) => m.id === r.mat) ? r.mat : undefined;
    for (const piece of convex(outline) ? [outline] : convexPieces(outline)) {
      if (out.length >= MAP_LIMITS.pieces) return out;
      if (piece.length < 3 || piece.length > MAP_LIMITS.corners || signedArea(piece) < MIN_AREA) continue;
      out.push(mat ? { pts: piece, mat } : { pts: piece });
    }
  }
  return out;
}

/** A fresh id for a map of the player's own. */
export function newMapId(): string {
  return 'custom:' + Math.random().toString(36).slice(2, 10);
}

/** Are two maps the same: the same id, name, size, look, ground, sea and weather? */
export function sameMap(a: MapSpec, b: MapSpec): boolean {
  return a === b || (a.id === b.id && a.name === b.name && a.width === b.width && a.height === b.height
    && a.theme === b.theme && JSON.stringify(a.terrain) === JSON.stringify(b.terrain)
    && JSON.stringify(a.water ?? null) === JSON.stringify(b.water ?? null) && JSON.stringify(a.weather ?? null) === JSON.stringify(b.weather ?? null));
}

/** A map's sea as read from a file, made safe: inside the map, its surface above the floor and under the ceiling (null: none). */
function cleanWater(raw: unknown, width: number, height: number): MapWater | null {
  const w = raw as Partial<MapWater> | null;
  if (!w || typeof w !== 'object' || ![w.x0, w.x1, w.level].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const hw = width / 2;
  const x0 = round(clamp(Math.min(w.x0!, w.x1!), -hw, hw));
  const x1 = round(clamp(Math.max(w.x0!, w.x1!), -hw, hw));
  const level = round(clamp(w.level!, WORLD.floor + 0.5, WORLD.floor + height - 1));
  return x1 - x0 >= 1 ? { x0, x1, level } : null;
}

/** A map's own weather as read from a file, made safe (null: none). */
function cleanMapWeather(raw: unknown): MapWeather | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: MapWeather = {};
  for (const [k, max] of [['rain', 1], ['snow', 1], ['fog', 1], ['lightning', 100]] as const) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = round(clamp(v, 0, max));
  }
  return Object.keys(out).length ? out : null;
}

/** Is it one of the built-in maps (as built in: changed, a map gets an id of its own)? */
export function isBuiltin(spec: MapSpec): boolean {
  return BUILTIN_MAPS.some((m) => m.id === spec.id);
}

/**
 * A map read from a file or a save, made safe to play: sizes clamped to the
 * limits, an unknown theme the concrete hall's, bad ground dropped (see
 * cleanPieces()). Null if it isn't a map at all. A built-in map comes back as
 * the built-in one itself; one changed since is given an id of its own.
 */
export function validateMap(data: unknown): MapSpec | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<Record<keyof MapSpec, unknown>>;
  if (typeof d.width !== 'number' || typeof d.height !== 'number' || !Number.isFinite(d.width) || !Number.isFinite(d.height)) return null;
  const width = Math.round(clamp(d.width, MAP_LIMITS.minWidth, MAP_LIMITS.maxWidth));
  const height = Math.round(clamp(d.height, MAP_LIMITS.minHeight, MAP_LIMITS.maxHeight));
  const theme = THEMES.find((t) => t.id === d.theme)?.id ?? 'concrete';
  const name = (typeof d.name === 'string' && d.name.trim().slice(0, 40)) || 'Untitled map';
  const id = typeof d.id === 'string' ? d.id : '';
  const base = BUILTIN_MAPS.find((m) => m.id === id);
  // (the endless plate has nothing to change: past the limits, it is only ever the built-in one)
  if (base?.endless) return base;
  const spec: MapSpec = { id, name, width, height, theme, terrain: cleanPieces(Array.isArray(d.terrain) ? d.terrain : [], width, height) };
  const water = cleanWater(d.water, width, height);
  if (water) spec.water = water;
  const weather = cleanMapWeather(d.weather);
  if (weather) spec.weather = weather;
  if (base) return sameMap(base, spec) ? base : { ...spec, id: newMapId() };
  if (!/^custom:[\w-]{1,40}$/.test(id)) spec.id = newMapId();
  return spec;
}

/** Sets the world's bounds (WORLD, which everything reads) to a map's. */
export function applyBounds(spec: MapSpec): void {
  WORLD.left = -spec.width / 2;
  WORLD.right = spec.width / 2;
  WORLD.ceiling = WORLD.floor + spec.height;
}

/** A map as a file of its own (Export). */
export function mapToJson(spec: MapSpec): string {
  return JSON.stringify({ blueberryMap: 1, map: spec });
}

/** A map from a file (Import): an exported one, or a bare map; null if it isn't one. */
export function mapFromJson(text: string): MapSpec | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as { blueberryMap?: unknown; map?: unknown } | null;
  return validateMap(d && typeof d === 'object' && d.blueberryMap ? d.map : data);
}

// ---- the player's own maps ---------------------------------------------------------

const STORE = 'blueberry-maps';

/** The player's own maps, kept in the browser (any access to its storage may throw: private windows, a full disk). */
export class CustomMaps {
  list: MapSpec[] = [];

  constructor() {
    this.load();
    // ones made in the other version (or imported) while this one plays
    store.onChange((keys, bySync) => {
      if (bySync && keys.includes(STORE)) this.load();
    });
  }

  private load(): void {
    this.list = [];
    try {
      const data = JSON.parse(store.getItem(STORE) ?? '[]') as unknown;
      if (!Array.isArray(data)) return;
      for (const d of data) {
        const m = validateMap(d);
        if (m && !isBuiltin(m) && !this.get(m.id)) this.list.push(m);
      }
    } catch {
      this.list = [];
    }
  }

  get(id: string): MapSpec | undefined {
    return this.list.find((m) => m.id === id);
  }

  /** Keeps a map, in place of the one with its id; false if the browser wouldn't store it. */
  save(spec: MapSpec): boolean {
    const before = this.list;
    const i = before.findIndex((m) => m.id === spec.id);
    this.list = i >= 0 ? before.map((m, k) => (k === i ? spec : m)) : [...before, spec];
    if (this.write()) return true;
    this.list = before;
    return false;
  }

  remove(id: string): boolean {
    const before = this.list;
    this.list = before.filter((m) => m.id !== id);
    if (this.write()) return true;
    this.list = before;
    return false;
  }

  private write(): boolean {
    try {
      store.setItem(STORE, JSON.stringify(this.list));
      return true;
    } catch {
      return false;
    }
  }
}

// ---- the built-in maps ---------------------------------------------------------------

/** A box of ground. */
function box(x0: number, y0: number, x1: number, y1: number, mat?: TerrainMat): TerrainPiece {
  return { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mat };
}

/**
 * A rounded hill from x0 to x1 on the floor, h high in the middle: an arch of a
 * parabola (convex, so one piece with no seams for things to catch on), its feet
 * carried on down into the floor slab. Its steepest slope is at the feet, about
 * 1.8 h / half its width.
 */
function hill(x0: number, x1: number, h: number, mat?: TerrainMat): TerrainPiece {
  const n = 12;
  const r = (x1 - x0) / 2;
  const c = (x0 + x1) / 2;
  // along the slope at the feet, half a metre down into the floor
  const dx = Math.min(4, (0.5 * r) / (2 * h));
  const pts: [number, number][] = [[x0 - dx, -0.5], [x1 + dx, -0.5]];
  for (let i = n; i >= 0; i--) {
    const u = (i / n) * 2 - 1;
    pts.push([c + u * r, h * (1 - u * u)]);
  }
  return { pts, mat };
}

/**
 * A flat-topped rise of ground `h` high from x1 to x2: up from the floor at x0
 * on a slope (x0 = x1: a sheer side), and down to it at x3 (x3 = x2: sheer).
 */
function rise(x0: number, x1: number, x2: number, x3: number, h: number, mat?: TerrainMat): TerrainPiece {
  // the slopes go on half a metre into the floor
  const a = x1 > x0 ? x0 - (0.5 * (x1 - x0)) / h : x0;
  const b = x3 > x2 ? x3 + (0.5 * (x3 - x2)) / h : x3;
  return { pts: [[a, -0.5], [b, -0.5], [x2, h], [x1, h]], mat };
}

/** A map as built in, its ground cleaned as any map's is (so a copy read back from a file is the same). */
function builtin(id: string, name: string, width: number, height: number, theme: ThemeId, terrain: TerrainPiece[], more: { water?: MapWater; weather?: MapWeather } = {}): MapSpec {
  const spec: MapSpec = { id, name, width, height, theme, terrain: cleanPieces(terrain, width, height) };
  const water = cleanWater(more.water, width, height);
  if (water) spec.water = water;
  const weather = cleanMapWeather(more.weather);
  if (weather) spec.weather = weather;
  return spec;
}

/** The sandbox as it always was: a concrete room 140 m across and 48 m high. */
export const LAB = builtin('lab', 'Lab', 140, 48, 'concrete', []);

/** A hall several hundred meters long: a mezzanine with a ramp up to it at one end, shipping containers at the other. */
const HANGAR = builtin('hangar', 'Hangar', 500, 120, 'concrete', [
  // (the mezzanine and its ramp are one piece: no seam at the top of the ramp)
  rise(-250, -250, -214, -174, 8, 'concrete'),
  box(212, -0.5, 224, 2.6, 'metal'),
  box(226, -0.5, 238, 2.6, 'metal'),
  box(218, 2.6, 230, 5.2, 'metal'),
]);

/**
 * Out of doors: rolling hills (gentle enough to walk over), a ramp to jump cars
 * off, a raised field cut by a trench, and more hills.
 */
const HILLS = builtin('hills', 'Hills', 360, 90, 'outdoors', [
  hill(-176, -120, 2.8),
  hill(-140, -84, 3.4),
  hill(-104, -64, 2.2),
  // a ramp rising to a sheer drop
  rise(-50, -38, -38, -38, 3),
  // the field, with the trench across it
  rise(-34, -20, 40, 40, 2.5),
  rise(46, 46, 104, 118, 2.5),
  { pts: [[70, 2.3], [73.2, 2.3], [73.6, 3.2], [72.4, 4], [70.6, 3.8]], mat: 'rock' },
  hill(112, 168, 3),
  hill(146, 178, 2),
]);

/** A night street of buildings of different heights with gaps between them: their flat roofs to play on. */
const ROOFTOPS = builtin('rooftops', 'Rooftops', 300, 80, 'night', [
  ...([[-150, -116, 18], [-109, -84, 24], [-79, -52, 15], [-46, -16, 21], [-11, 15, 18], [21, 48, 26], [55, 82, 16], [88, 116, 22], [122, 150, 19]] as const)
    .flatMap(([x0, x1, h]) => [box(x0, -0.5, x1, h, 'windows'), box(Math.max(-150, x0 - 0.25), h, Math.min(150, x1 + 0.25), h + 0.35, 'concrete')]),
  // things on the roofs: air conditioners, a water tank, a stairwell
  box(-140, 18.35, -137.6, 19.6, 'metal'),
  box(-30, 21.35, -26.5, 24.8, 'metal'),
  box(30, 26.35, 33.5, 29, 'brick'),
  box(95, 22.35, 97.4, 23.6, 'metal'),
  box(99, 22.35, 101.4, 23.6, 'metal'),
]);

/** A sand pit ringed by stone walls, with tiers rising behind them to the edges. */
const ARENA = builtin('arena', 'Arena', 200, 70, 'desert', [
  ...[-1, 1].flatMap((s) => {
    const side = (x0: number, x1: number, h: number) => box(Math.min(s * x0, s * x1), -0.5, Math.max(s * x0, s * x1), h, 'rock');
    return [side(28, 34, 8), side(34, 46, 10), side(46, 58, 12), side(58, 70, 14), side(70, 100, 16)];
  }),
]);

/**
 * How far (m) the endless plate goes each way from its middle. Physics and
 * drawing keep positions in 32-bit floats, which only hold a millimetre up to
 * 16 384 m out (and coarser steps further on, where things start to jitter):
 * so the plate ends just short of that, at walls 16 km out either way.
 */
export const ENDLESS_REACH = 16000;

/**
 * The endless plate: a bare concrete floor going on and on either way (to
 * ENDLESS_REACH), under a hall's high ceiling. Nothing on it but the floor.
 */
export const ENDLESS: MapSpec = { id: 'endless', name: 'Endless plate', width: ENDLESS_REACH * 2, height: 120, theme: 'concrete', terrain: [], endless: true };

/** A cramped room, 40 m across and 14 m high. */
const TINY = builtin('tiny', 'Tiny', 40, 14, 'concrete', []);

/** As big as a map can be: a kilometre of open field, a couple of low hills far out either way. */
const HUMONGOUS = builtin('humongous', 'Humongous', 1000, 250, 'outdoors', [hill(-420, -340, 6), hill(320, 410, 8)]);

/**
 * The whole floor tilted: one long slope rising 24 m across the map (about
 * 6 degrees), so anything round rolls away downhill, with a kicker halfway
 * down to jump what comes down it.
 */
const SLANTED = builtin('slanted', 'Slanted', 240, 80, 'concrete', [
  { pts: [[-120, -0.5], [120, -0.5], [120, 24]] },
  // (its foot buried in the slope, rising against it to a sheer drop facing downhill)
  { pts: [[0, 11.4], [10, 12.5], [0, 14.2]], mat: 'concrete' },
]);

/**
 * A tower 120 m tall beside the middle: brick walls round eleven floors, each
 * with a gap to drop through (on alternate sides), a doorway at the bottom,
 * and a roof with a low wall round it.
 */
const TOWER = builtin('tower', 'Tower', 160, 150, 'outdoors', [
  box(14, 3, 14.75, 119.4, 'brick'),
  box(27.25, -0.5, 28, 119.4, 'brick'),
  ...Array.from({ length: 11 }, (_, i) => {
    const y = (i + 1) * 10;
    return i % 2 ? box(14.75, y - 0.4, 25, y, 'concrete') : box(17, y - 0.4, 27.25, y, 'concrete');
  }),
  box(13.5, 119.4, 28.5, 120.4, 'concrete'),
  box(13.5, 120.4, 14, 121.4, 'concrete'),
  box(28, 120.4, 28.5, 121.4, 'concrete'),
]);

/** Stepped ground: a pyramid of metre-high steps in the middle, and blocks of different heights either side. */
const BLOCKS = builtin('blocks', 'Blocks', 200, 60, 'concrete', [
  ...Array.from({ length: 8 }, (_, i) => box(-36 + 4.5 * i, -0.5, 36 - 4.5 * i, i + 1, 'concrete')),
  ...([[-95, -85, 3], [-80, -74, 6], [-68, -60, 2], [60, 68, 4], [74, 80, 7], [86, 95, 2.5]] as const).map(([x0, x1, h]) => box(x0, -0.5, x1, h, 'brick')),
]);

/** No floor: a platform in the dark and a couple of ledges. What falls off is gone. */
const VOID = builtin('void', 'Void', 200, 80, 'void', [
  box(-16, -2, 16, 0, 'concrete'),
  box(-52, 5, -42, 5.5, 'metal'),
  box(34, 9, 46, 9.5, 'metal'),
]);

/** Snowy hills under falling snow, a plateau and a few rocks. */
const SNOW = builtin('snow', 'Snow', 300, 90, 'snow', [
  hill(-140, -90, 4),
  hill(-112, -62, 6),
  rise(-46, -30, -8, 6, 3),
  { pts: [[-20, 2.7], [-17.4, 2.7], [-17, 3.6], [-18.6, 4.3], [-19.8, 3.8]], mat: 'rock' },
  hill(30, 92, 5),
  hill(84, 132, 3),
  { pts: [[60, 0], [64, 0], [63, 6.4], [61.2, 6.9]], mat: 'rock' },
], { weather: { snow: 0.6 } });

/**
 * A sea over the left half, 9 m deep, with rocks on its bed; a sandy beach
 * rising out of it to the right, and a pier reaching out over the water.
 */
const SEA = builtin('sea', 'Sea', 300, 80, 'desert', [
  rise(-40, 10, 150, 150, 12),
  box(-30, 10.4, 6, 10.9, 'metal'),
  box(-28, -0.5, -27.4, 10.4, 'metal'),
  box(-16, -0.5, -15.4, 10.4, 'metal'),
  { pts: [[-96, 0], [-88, 0], [-91, 2.6]], mat: 'rock' },
  { pts: [[-62, 0], [-55, 0], [-56.5, 1.6], [-60, 1.9]], mat: 'rock' },
], { water: { x0: -150, x1: -2.5, level: 9 } });

/** Two cliffs 100 m high either side of a chasm down to the floor, a ledge partway down it. */
const ABYSS = builtin('abyss', 'Abyss', 240, 140, 'outdoors', [
  box(-120, -0.5, 6, 100, 'rock'),
  box(26, -0.5, 120, 100, 'rock'),
  box(6, 49.4, 9, 50, 'rock'),
]);

/** The maps that come with the game, the lab first. */
export const BUILTIN_MAPS: MapSpec[] = [LAB, HANGAR, HILLS, ROOFTOPS, ARENA, ENDLESS, TINY, HUMONGOUS, SLANTED, TOWER, BLOCKS, VOID, SNOW, SEA, ABYSS];

/** A built-in map by its id. */
export function builtinMap(id: string): MapSpec | undefined {
  return BUILTIN_MAPS.find((m) => m.id === id);
}

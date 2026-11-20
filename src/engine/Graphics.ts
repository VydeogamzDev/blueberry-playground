import { store } from './Store';
import { deviceClass } from './Device';

/**
 * The graphics and performance settings (Settings > Graphics): how much of the
 * screen's resolution is drawn, how many frames a second at most, how many
 * lights, effect particles and spent cases, and how hard the physics works.
 * Four presets set them all; each can then be changed on its own. Kept by each
 * copy of the game for itself (not synced: they suit the computer, see Store).
 */
export interface Graphics {
  /** Share of the screen's own resolution drawn (the picture is scaled up, pixel-sharp). */
  resolution: number;
  /** The most dynamic lights shown at once (muzzle flashes, fire, lamps); 0: none. */
  lights: number;
  /** Share of effect particles made: smoke, sparks, flames, dust (never blood or liquids, which leave marks). */
  particles: number;
  /** Spent cases left lying about at most (the oldest go first). */
  cases: number;
  /** Broken pieces (scrap, splinters, shards, rubble) left lying about at most (the oldest go first). */
  debris: number;
  /** Physics solver iterations: more hold stacks, joints and contraptions stiffer, for more time a step. */
  iterations: number;
  /** Physics steps: short ones while the scene allows ('auto'), or always the long one ('long': half as many). */
  step: 'auto' | 'long';
  /** Frames drawn a second at most: as many as the screen shows ('display'), a number, or as many as the computer can make ('unlimited'). */
  fps: FpsCap;
  /** Auto quality (0.5.0): while the frames fall behind, less resolution and fewer effects till they keep up (see AutoQuality). */
  auto: boolean;
}

export type FpsCap = 'display' | 'unlimited' | number;

export type PresetName = 'potato' | 'low' | 'medium' | 'high' | 'max';

/**
 * The presets, lightest first. High is the game as it has always been; Max is
 * stiffer physics and more cases about, within reason (a battle still runs).
 * Their frame rate cap is only where a first game starts (a touch screen's Medium:
 * 60): choosing a preset keeps the cap the player has (see presetOf()). Medium
 * chosen to lighten a heavy scene used to hold the frames to 60 as well, unasked.
 * Low (0.5.0) is where a Chromebook, an iPad or a phone starts (see Device): three
 * quarters of the resolution, a few lights, half the effects, few cases lying about,
 * auto quality taking the resolution lower when the graphics chip can't keep up. Auto
 * quality is on in all of them (and a preset leaves it as it is).
 */
export const PRESETS: Record<PresetName, Graphics> = {
  potato: { resolution: 0.5, lights: 0, particles: 0.25, cases: 20, debris: 40, iterations: 4, step: 'long', fps: 30, auto: true },
  low: { resolution: 0.75, lights: 4, particles: 0.5, cases: 20, debris: 120, iterations: 5, step: 'auto', fps: 60, auto: true },
  medium: { resolution: 0.75, lights: 8, particles: 0.5, cases: 80, debris: 120, iterations: 5, step: 'auto', fps: 60, auto: true },
  high: { resolution: 1, lights: 16, particles: 1, cases: 240, debris: 250, iterations: 6, step: 'auto', fps: 'display', auto: true },
  max: { resolution: 1, lights: 16, particles: 1, cases: 400, debris: 500, iterations: 12, step: 'auto', fps: 'display', auto: true },
};

export const PRESET_NAMES: { id: PresetName; label: string }[] = [
  { id: 'potato', label: 'Potato' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];

/** What each setting may be set to (iterations: any whole number in its range). */
export const GRAPHICS_RANGE = {
  resolution: [0.5, 0.75, 1],
  lights: [0, 4, 8, 16],
  particles: [0.25, 0.5, 0.75, 1],
  cases: [0, 20, 80, 240, 400],
  debris: [40, 120, 250, 500],
  iterations: { min: 1, max: 50 },
  fps: ['display', 30, 60, 75, 90, 120, 144, 165, 240, 360, 'unlimited'] as FpsCap[],
};

/** A frame rate cap as the game loop takes it (see Game.fpsCap): 0 the screen's, Infinity none. */
export function fpsLimit(cap: FpsCap): number {
  return cap === 'display' ? 0 : cap === 'unlimited' ? Infinity : cap;
}

const STORE = 'blueberry-graphics';
/** Where the iterations were kept before there were presets (still read once). */
const OLD_ITERATIONS = 'blueberry-iterations';

/** The preset these settings are, if they're one (else they're custom): whatever the frame rate cap (a preset leaves it be). */
export function presetOf(g: Graphics): PresetName | null {
  for (const { id } of PRESET_NAMES) {
    const p = PRESETS[id];
    if ((Object.keys(p) as (keyof Graphics)[]).every((k) => k === 'fps' || k === 'auto' || p[k] === g[k])) return id;
  }
  return null;
}

/** A setting kept in range: the nearest allowed value (a hand-edited store can say anything). */
function nearest(list: number[], v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

/**
 * The settings kept in the browser, or the defaults (with the iterations set
 * before presets, if any): High's; on a Chromebook, an iPad or a phone Low's, on a
 * weak one Potato's, and on another touch screen Medium's, kinder to its battery and
 * to a screen refreshing 120 times a second (see Device).
 */
export function firstPreset(): PresetName {
  return ({ weak: 'potato', low: 'low', touch: 'medium', desktop: 'high' } as const)[deviceClass()];
}

export function loadGraphics(): Graphics {
  const g = { ...PRESETS[firstPreset()] };
  try {
    const old = parseInt(store.getItem(OLD_ITERATIONS) ?? '');
    if (old >= GRAPHICS_RANGE.iterations.min && old <= GRAPHICS_RANGE.iterations.max) g.iterations = old;
    const raw = store.getItem(STORE);
    if (!raw) return g;
    const s = JSON.parse(raw) as Partial<Record<keyof Graphics, unknown>>;
    const R = GRAPHICS_RANGE;
    g.resolution = nearest(R.resolution, s.resolution, g.resolution);
    g.lights = nearest(R.lights, s.lights, g.lights);
    g.particles = nearest(R.particles, s.particles, g.particles);
    g.cases = nearest(R.cases, s.cases, g.cases);
    g.debris = nearest(R.debris, s.debris, g.debris);
    if (typeof s.iterations === 'number' && s.iterations >= R.iterations.min && s.iterations <= R.iterations.max) g.iterations = Math.round(s.iterations);
    if (s.step === 'auto' || s.step === 'long') g.step = s.step;
    if (R.fps.includes(s.fps as FpsCap)) g.fps = s.fps as FpsCap;
    if (typeof s.auto === 'boolean') g.auto = s.auto;
  } catch {
    // (private browsing, or a store that isn't ours: the defaults it is)
  }
  return g;
}

export function saveGraphics(g: Graphics): void {
  try {
    store.setItem(STORE, JSON.stringify(g));
    store.removeItem(OLD_ITERATIONS);
  } catch {
    // (not kept: they still apply until the page is closed)
  }
}

/** Meters per sprite pixel. All sprite art is authored on this grid. */
export const PX = 1 / 32;

/** Fixed physics timestep (seconds). */
export const FIXED_DT = 1 / 120;
/**
 * The step while a scene is too heavy to simulate in real time with FIXED_DT
 * (see Game.pickStep()): half as many steps for much the same results. Measured
 * over 60 seeded heaps of people and animals, they settle (median 26 s against
 * 22 s) and nothing launches; 100 people settling in heaps cost 1.1 s of CPU per
 * simulated second instead of 1.9.
 */
export const COARSE_DT = FIXED_DT * 2;

/**
 * Max physics steps per rendered frame before we drop time (spiral-of-death
 * guard); fewer when the steps are slow (see Game.loop).
 */
export const MAX_STEPS_PER_FRAME = 16;
/**
 * Milliseconds of physics a frame may spend. A scene too heavy to simulate in
 * real time within it runs in slow motion at a steady frame rate.
 */
export const STEP_BUDGET_MS = 13;
/**
 * Seconds short of a whole step that still count as a step due (see Game.loop):
 * frame timestamps are rounded and a display's frames jitter, so on a 60 Hz
 * screen at the 1/60 s step a frame often comes a hair short of one.
 */
export const STEP_SLACK = 0.001;

export const GRAVITY = -9.81;

/** Sandbox bounds (meters). The floor surface sits at y = 0. */
export const WORLD = {
  left: -70,
  right: 70,
  floor: 0,
  ceiling: 48,
  wallThickness: 4,
  floorThickness: 6,
};

/** Default camera zoom in CSS pixels per meter (2 screen px per sprite px). */
export const DEFAULT_ZOOM = 64;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 320;

/** Collision group bits. */
export const GROUP = {
  STATIC: 1 << 0,
  DYNAMIC: 1 << 1,
  DEBRIS: 1 << 2,
  NOCOLLIDE: 1 << 3,
  /** Dynamic parts that have no color (see systems/ContactGroups). */
  PLAIN: 1 << 4,
} as const;

/** The bits left over, handed out as colors by systems/ContactGroups. */
export const COLOR_SHIFT = 5;
export const COLOR_BITS = 0xffff & ~((1 << COLOR_SHIFT) - 1);

export function groups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

export const GROUPS_STATIC = groups(GROUP.STATIC, GROUP.DYNAMIC | GROUP.DEBRIS | GROUP.NOCOLLIDE);
export const GROUPS_DYNAMIC = groups(GROUP.DYNAMIC | GROUP.PLAIN, GROUP.STATIC | GROUP.DYNAMIC | GROUP.DEBRIS);
/** Debris (gibs, shells) collides with the world and objects but not other debris. */
export const GROUPS_DEBRIS = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
/** "No collide" objects only touch the static environment. */
export const GROUPS_NOCOLLIDE = groups(GROUP.NOCOLLIDE, GROUP.STATIC);

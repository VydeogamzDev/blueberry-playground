import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { clamp, rotate, smoothstep, wrapAngle, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import { MAT, type PhysMaterial } from '../world/Materials';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import { limbArt, faceColors, EYE, MOUTH, HUMAN_SKIN, type BodyKind, type LimbKey, type Skin } from '../art/human';
import { ramp } from '../art/palette';
import type { Item, Holder } from './Item';
import { adrenalineRush, type Drug } from './Syringe';
import { washBlood } from './Medical';
import { Tendons } from '../systems/Tendons';
import { FLESH, PLATING, breakUp, blastEnergy, gibNow, sliceLimb, takeChunk } from '../systems/Chunks';
import { isFighter, isLiving, land, onFeet, stillUp, strikePoint, type Fighter } from '../systems/Fighting';
import { allies, bombNear, dress, dye, enemies, isTeamId, lyingNear, nearestEnemy, TEAMS, undead, type TeamId } from '../systems/Teams';
import type { PixelArt } from '../art/PixelArt';
import { ACID_SCAR, Liquid, liquidSound, paintWound, seep, woundSpot } from '../systems/Liquids';
import { Breath, HEAD_SINKS, shoreward, tread, type Lungful } from '../systems/Breath';

interface LimbSpec {
  key: LimbKey;
  name: string;
  /** Standing-pose center (art px, facing right, y up from the soles). */
  cx: number;
  cy: number;
  layer: number;
  density: number;
  hp: number;
  shape: ShapeSpec;
  parent?: LimbKey;
  /** Joint position in the standing pose (px). */
  jx?: number;
  jy?: number;
  lo?: number;
  hi?: number;
  /** Standing muscle stiffness of the joint to the parent (N*m/rad). */
  muscle: number;
  /** Damage multiplier for blunt trauma. */
  fragility: number;
}

const box = (w: number, h: number, r: number, x = 0, y = 0): ShapeSpec => ({ kind: 'box', w, h, r, x, y });

// Parent limbs are listed before their children (creation order = part index order).
const SPECS: LimbSpec[] = [
  { key: 'upperTorso', name: 'Upper torso', cx: 0, cy: 38.5, layer: 8, density: 150, hp: 150, shape: box(8, 10, 1.5, 0, -1), muscle: 0, fragility: 1 },
  { key: 'head', name: 'Head', cx: 0.5, cy: 49, layer: 9, density: 46, hp: 70, shape: box(9, 10, 2.5, -0.5, 0), parent: 'upperTorso', jx: 0.5, jy: 44, lo: -0.7, hi: 0.5, muscle: 450, fragility: 1.9 },
  { key: 'midTorso', name: 'Middle torso', cx: 0, cy: 30.5, layer: 7, density: 165, hp: 120, shape: box(7, 7, 1), parent: 'upperTorso', jx: 0, jy: 33.5, lo: -0.3, hi: 0.55, muscle: 3200, fragility: 1 },
  { key: 'lowerTorso', name: 'Lower torso', cx: 0, cy: 25, layer: 6, density: 155, hp: 120, shape: box(8, 8, 1.5), parent: 'midTorso', jx: 0, jy: 28, lo: -0.3, hi: 0.55, muscle: 3200, fragility: 1 },
  { key: 'upperLegB', name: 'Upper leg', cx: 0, cy: 17.5, layer: 3, density: 135, hp: 90, shape: box(4, 11, 1.6), parent: 'lowerTorso', jx: 0, jy: 22.5, lo: -0.6, hi: 2.2, muscle: 3200, fragility: 1 },
  { key: 'lowerLegB', name: 'Lower leg', cx: 0, cy: 7.5, layer: 4, density: 85, hp: 75, shape: box(3.5, 11, 1.5), parent: 'upperLegB', jx: 0, jy: 12.5, lo: -2.6, hi: 0.02, muscle: 3200, fragility: 1 },
  { key: 'footB', name: 'Foot', cx: 1.5, cy: 1.5, layer: 5, density: 46, hp: 50, shape: box(8, 3, 1), parent: 'lowerLegB', jx: 0, jy: 2.5, lo: -0.6, hi: 0.7, muscle: 350, fragility: 0.8 },
  { key: 'upperLegF', name: 'Upper leg', cx: 0, cy: 17.5, layer: 10, density: 135, hp: 90, shape: box(4, 11, 1.6), parent: 'lowerTorso', jx: 0, jy: 22.5, lo: -0.6, hi: 2.2, muscle: 3200, fragility: 1 },
  { key: 'lowerLegF', name: 'Lower leg', cx: 0, cy: 7.5, layer: 11, density: 85, hp: 75, shape: box(3.5, 11, 1.5), parent: 'upperLegF', jx: 0, jy: 12.5, lo: -2.6, hi: 0.02, muscle: 3200, fragility: 1 },
  { key: 'footF', name: 'Foot', cx: 1.5, cy: 1.5, layer: 12, density: 46, hp: 50, shape: box(8, 3, 1), parent: 'lowerLegF', jx: 0, jy: 2.5, lo: -0.6, hi: 0.7, muscle: 350, fragility: 0.8 },
  { key: 'upperArmB', name: 'Upper arm', cx: 0, cy: 37, layer: 0, density: 46, hp: 70, shape: box(3, 11, 1.4), parent: 'upperTorso', jx: 0, jy: 42, lo: -2.0, hi: 3.1, muscle: 140, fragility: 1 },
  { key: 'lowerArmB', name: 'Lower arm', cx: 0, cy: 27.5, layer: 1, density: 35, hp: 60, shape: box(3, 10, 1.4), parent: 'upperArmB', jx: 0, jy: 32, lo: -0.05, hi: 2.6, muscle: 60, fragility: 1 },
  { key: 'handB', name: 'Hand', cx: 0, cy: 21, layer: 2, density: 26, hp: 40, shape: box(3, 4, 1.2), parent: 'lowerArmB', jx: 0, jy: 23, lo: -1.0, hi: 1.0, muscle: 12, fragility: 0.8 },
  { key: 'upperArmF', name: 'Upper arm', cx: 0, cy: 37, layer: 13, density: 46, hp: 70, shape: box(3, 11, 1.4), parent: 'upperTorso', jx: 0, jy: 42, lo: -2.0, hi: 3.1, muscle: 140, fragility: 1 },
  { key: 'lowerArmF', name: 'Lower arm', cx: 0, cy: 27.5, layer: 14, density: 35, hp: 60, shape: box(3, 10, 1.4), parent: 'upperArmF', jx: 0, jy: 32, lo: -0.05, hi: 2.6, muscle: 60, fragility: 1 },
  { key: 'handF', name: 'Hand', cx: 0, cy: 21, layer: 15, density: 26, hp: 40, shape: box(3, 4, 1.2), parent: 'lowerArmF', jx: 0, jy: 23, lo: -1.0, hi: 1.0, muscle: 12, fragility: 0.8 },
];

/** Live-tunable balance parameters (exposed for debugging). */
export const BALANCE = { kp: 42, kd: 4, dead: 0.05, amax: 7.5, torqueOnly: true, standDamping: 20, limpDamping: 0.7, stumble: 1.6 };

/** Failed attempts to stand before lying still until something changes. */
const GIVE_UP = 4;
/** Below this pain someone lying down stops writhing and goes still. */
const CALM_PAIN = 0.12;

/**
 * Walking and running: speeds (m/s), how far the legs swing from the hip (rad),
 * how far the knee bends as a foot comes forward (rad), how far the hips bend to
 * carry the body forward over the legs (rad), and how hard the torso is driven
 * toward the wanted speed (1/s, and m/s² at most). Live-tunable for debugging.
 * `top`: the fastest the legs carry anyone (m/s); asked for more (a run on
 * adrenaline), they'd outrun their own feet and go over.
 */
export const GAIT = {
  walk: 1.15, run: 2.2, swing: 0.36, runSwing: 0.45, lift: 0.8, runLift: 1.1,
  bend: 0.2, runBend: 0.35, drive: 5, accel: 2.5, runAccel: 4, top: 2.4,
};
/** Hip height above the soles (m). */
const HIP_Y = 22.5 * PX;
/** The trunk's center of mass above the soles, standing (m). */
const TRUNK_Y = 32 * PX;

/** Figure center height (px) used as the spawn reference point. */
const MID_Y = 27.25;
export const HUMAN_HALF_HEIGHT = MID_Y * PX;

type Pose = Partial<Record<LimbKey, number>>;

/**
 * A seat in a vehicle someone sits in (see Car): held there at the hips, in
 * the seat's pose (joint angles, facing right).
 */
export interface Seat {
  readonly pose: Partial<Record<LimbKey, number>>;
  /** Gets them out, onto their feet beside it ("Get out" in their menu). */
  leave(): void;
  /** A limb of theirs was taken hold of (pulled hard, they come out), or let go of (null). */
  grabbed(part: Part | null): void;
}

const POSE_STAND: Pose = { lowerArmF: 0.12, lowerArmB: 0.2, upperArmF: 0.04, upperArmB: -0.06, lowerLegF: -0.02, lowerLegB: -0.02 };
const POSE_DOWN: Pose = {
  head: -0.2, midTorso: 0.12, lowerTorso: 0.12, upperArmF: 0.6, upperArmB: 0.35, lowerArmF: 1.1, lowerArmB: 0.9,
  upperLegF: 0.55, upperLegB: 0.3, lowerLegF: -0.9, lowerLegB: -0.7, handF: 0.3, handB: 0.3, footF: 0.15, footB: 0.15,
};

/** Dry friction torque (N*m) in a limp body's joints, keyed by the child limb. */
const JOINT_FRICTION: Record<string, number> = {
  head: 2, midTorso: 7, lowerTorso: 7, upperLeg: 5, lowerLeg: 3, foot: 0.3,
  upperArm: 1.6, lowerArm: 0.9, hand: 0.1,
};

/** Climbing: knees drawn up under the body; once risen, arms reaching forward onto the top. */
const POSE_TUCK: Pose = {
  ...POSE_STAND, midTorso: 0.25, lowerTorso: 0.2, upperLegF: 1.1, upperLegB: 0.9, lowerLegF: -2.35, lowerLegB: -2.25, footF: 0.35, footB: 0.35,
};
const POSE_CLIMB: Pose = { ...POSE_TUCK, upperArmF: 1.9, upperArmB: 1.6, lowerArmF: 0.35, lowerArmB: 0.5 };
/** Letting themselves down off a ledge: knees a little bent for the landing, arms out. */
const POSE_DROP: Pose = { ...POSE_STAND, upperLegF: 0.55, upperLegB: 0.25, lowerLegF: -0.8, lowerLegB: -0.6, footF: 0.2, footB: 0.2, upperArmF: 0.7, upperArmB: 0.45, lowerArmF: 0.5, lowerArmB: 0.4 };
/** Crouching to jump: knees bent, leaning into it, arms swung back. */
const POSE_CROUCH: Pose = {
  ...POSE_STAND, midTorso: 0.2, lowerTorso: 0.25, upperLegF: 0.95, upperLegB: 0.8, lowerLegF: -1.55, lowerLegB: -1.45, footF: 0.6, footB: 0.6,
  upperArmF: -0.5, upperArmB: -0.6, lowerArmF: 0.3, lowerArmB: 0.3,
};
/** Poses for climbing and jumping (see updateMotors). */
const MOVE_POSES = { tuck: POSE_TUCK, reach: POSE_CLIMB, drop: POSE_DROP, stand: POSE_STAND, crouch: POSE_CROUCH };
type MovePose = keyof typeof MOVE_POSES;

/** A jump: how fast the body springs up (m/s; about 0.6 m high), after crouching for it (s). */
const JUMP = { vy: 3.4, crouch: 0.22 };
/** Coming up out of a landing's bent knees into the standing pose (s): snapped straight, the legs would spring them off the floor again. */
const SETTLE_T = 0.5;
/** The most the knees may be bent (rad) to straighten up again from a stumble without lying down first (see catching()). */
const KNEE_CATCH = 1.4;
/** How far past its joint's limits a broken bone lets a limb bend (rad). */
const BROKEN_GIVE = 1.1;
/** Going from one pose to the next, climbing or jumping (s): snapped, the feet whip round at 30-40 m/s. */
const POSE_EASE = 0.15;
/**
 * Under water (see Breath): a held breath lasts 18 s, gone limp 8, and 8 s after it's
 * out they drown; they can tread water half a minute. Limp, they float upright with
 * their face at the surface (and with no air left in them, sink).
 */
const LUNGFUL: Lungful = { hold: 18, holdOut: 8, last: 8, tread: 30, full: 2, empty: 1 };
/** Swimming for the shore (m/s), and how far (m) under the middle of the head the mouth is. */
const SWIM = 0.7;
/** In water this shallow (m), under their knees, they can get up in it (deeper, it lifts them off their feet). */
const STAND_DEPTH = 0.45;
const MOUTH_DOWN = 2.5 * PX;

interface Jump {
  /** Seconds since springing up (negative: still crouching for it). */
  t: number;
  /** Speed along the floor to carry on with (m/s, + right). */
  vx: number;
  /** How fast they spring up (m/s): JUMP.vy, unless it's a leap timed by a fighter (see route()). */
  vy: number;
  /** Has left the ground, and seconds since landing (negative: not yet). */
  off: boolean;
  landed: number;
  /** Past the top of it (legs reaching down for the floor from then on). */
  peaked: boolean;
  /** The pose the legs are in now (see jumpPose). */
  pose: MovePose;
}

/**
 * A climb: the trunk is carried along a path from (x0, y0) to (x1, y1) over
 * `dur` seconds, the legs tucked up while they clear the edge. 'up' rises
 * first and then moves on over the top; 'down' moves out over the edge and
 * then drops; 'over' goes up, across and down again (something narrow).
 */
interface Climb {
  kind: 'up' | 'down' | 'over';
  t: number;
  dur: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How high the trunk goes above the start on the way over. */
  peak: number;
}

/** Highest top (m above the floor under them) someone will climb onto, and deepest drop they'll climb down. */
export const CLIMB = { up: 1.1, down: 1.3 };

/**
 * A fighter finding a way to the foe (see route()): the deepest drop they'll jump
 * down (m: landing faster than about 7 m/s hurts the legs); the fastest they'll
 * leap across a gap (m/s along the floor) and how fast they spring up for it; a
 * hop down a drop (m/s, along and up); how high a thing they'll jump over (m: a
 * body lying in the way); how far ahead they look for the far side (m); how much
 * floor they want to land on beyond it (m); and how long a crouch a leap takes (s).
 */
const LEAP = { down: 2, vx: 3.2, vy: 3.4, hopVx: 1.4, hopVy: 1.1, hurdle: 0.55, look: 3.2, land: 0.5, crouch: 0.12 };

/** Aiming pose for an arm holding an item, and for a supporting arm. */
const AIM = { upper: 1.42, lower: 0.06, hand: 0 };
const SUPPORT = { upper: 1.15, lower: 0.75, hand: 0 };

interface Grip {
  item: Item;
  hand: Limb;
  joint: RAPIER.ImpulseJoint;
  support: { hand: Limb; joint: RAPIER.ImpulseJoint } | null;
  /** Seconds since the item was grabbed (aim control ramps in). */
  t: number;
}

/**
 * Fighting (see fight()), distances trunk to trunk (m): how near they come to punch;
 * how far beyond striking distance they wait between blows, stepping in to strike and
 * back out after (stepOut); how far off they shoot with a gun of no range of its own
 * (see RANGE); how long a punch, a swing and a kick take (s), the first `wind` of it
 * drawing back and the next `out` throwing it (a swing's: swingWind, swingOut); the
 * least pause between blows (s) and how much longer it may be (jitter: two fighters
 * alike don't fall into step); the chance of a second punch straight after the first
 * (combo), and of a kick instead of a punch (kicks); how much harder the muscles work
 * throwing a punch or kick, and a swing; how fast the arms may turn to the next pose
 * (rad/s), and throwing a blow; how fast they step in winding up a swing, and step
 * back (m/s); and how long one of them stays down before they're beaten (s).
 */
const FIGHT = {
  reach: 0.62, stepOut: 0.4, shoot: 6, punch: 0.4, swing: 0.8, kick: 0.55, wind: 0.4, out: 0.3, swingWind: 0.3, swingOut: 0.5,
  pause: 0.3, jitter: 0.6, combo: 0.35, kicks: 0.25, power: 3, swingPower: 1.5, slew: 9, slewOut: 30, lunge: 0.9, back: 0.85, beaten: 4,
};

/**
 * Swinging a weapon (see swingPath()), the hand placed relative to the shoulder (m,
 * x ahead, y up) and the weapon's angle above straight ahead (rad): on the shoulder
 * between blows, pointing up and back (rest: clear of the foe's swings, and of
 * whoever stands behind), drawn back further to swing (cock), then swung over and
 * down through the foe to `follow` past them, the hand thrown out `arm` toward them.
 * They strike from where the weapon meets the foe `sweet` of its length out from the grip.
 */
const SWING = { rest: { x: 0.06, y: 0.22, a: 2.3 }, cock: { x: 0, y: 0.26, a: 2.6 }, arm: 0.47, follow: 0.45, sweet: 0.72 };

/**
 * Shooting at a foe (see shoot()): how long the gun must be steady on them before the
 * first shot (s, and up to `settleJitter` more); how near on target (rad) counts as
 * steady, and it must be to fire; how often a shot goes for the head rather than the
 * body; about how far off a shot may go (rad); the pause between shots (s, and up to
 * `jitter` more); and how fast the aim is trimmed for the gun sagging under its weight
 * (per s: see shoot()).
 */
const SHOT = { settle: 0.4, settleJitter: 0.35, steady: 0.12, fire: 0.07, head: 0.2, spread: 0.03, pause: 0.35, jitter: 0.6, trim: 3 };

/**
 * How near and how far off they shoot from with each gun (m): nearer, they step back;
 * further, they walk in. (A launcher's are well clear of its blast; a flamethrower's
 * and a stun gun's within what they reach: about five and six metres. A flamethrower
 * isn't brought in any closer than it must be: a heavy thing held low, it doesn't tip
 * up far or steadily enough for someone right in front of them, and isn't fired.)
 */
const RANGE: Record<string, [number, number]> = {
  pistol: [4, 8], revolver: [4, 8], smg: [3, 7], rifle: [5, 11], shotgun: [2.5, 5], sniper: [8, 18], minigun: [4, 10], 'laser-rifle': [5, 12], crossbow: [5, 12],
  'burst-rifle': [5, 11], 'battle-rifle': [6, 14], 'machine-gun': [4, 11], 'double-barrel': [2, 4.5], flintlock: [3, 6.5],
  'grenade-launcher': [7, 14], flamethrower: [2, 5.5], 'stun-gun': [1.5, 4.5],
};
/** Any other gun's. */
const RANGE_ANY: [number, number] = [3.5, 9];

/**
 * On a team (see scan()): how often they look about for an enemy (s), how far off
 * they see one (m), how much nearer (m) another must be to leave the one they're
 * fighting for it, and how far (m) they'd go for a weapon lying about, empty-handed
 * against an armed foe.
 */
const SCAN = { every: 0.4, sight: 30, switch: 2, fetch: 3 };

/**
 * Zombies (see rise()): how long an infection takes to turn someone (s); how fast they
 * get about, of a person's pace; how much worse a mauling it takes to stop one than to
 * kill the living (see checkDeath()); a bite's harm, and the pause after a lunge (s);
 * how near (trunk to trunk, m) one comes to lunge at someone on their feet; and how
 * near its head has to get to someone to bite them (lying down, the hands can't reach).
 */
const ZOMBIE = { incubate: 10, pace: 0.5, trauma: 11, bite: 7, pause: 0.8, reach: 0.55, mouth: 0.7 };
/** A zombie's skin (in the clothes they had on), and its eye and mouth. */
const ZOMBIE_SKIN = ramp('#8d9a78', 0.85);
const ZOMBIE_EYE = 0xd8d27a;
const ZOMBIE_MOUTH = 0x3a1414;
/** Standing as a zombie: arms held out in front, head hung, a little hunched. */
const POSE_ZOMBIE: Pose = { ...POSE_STAND, head: -0.25, midTorso: 0.1, upperArmF: 1.35, upperArmB: 1.15, lowerArmF: 0.12, lowerArmB: 0.3, handF: -0.2, handB: -0.2 };
/** What still works on a zombie, whose heart doesn't beat: what acts on the flesh itself, Life and the Cure. */
const UNDEAD_DRUGS = new Set<Drug>(['healing', 'life', 'cure', 'freeze', 'bone', 'acid', 'strength']);

/** On Ultra Strength: how much stronger the muscles are and how much harder blows land, and how hard (m/s) whoever's hit is flung. */
const MIGHT = { muscle: 2.5, blow: 2.5, fling: 6 };

/**
 * A fire extinguisher in hand, out of a fight (see douse()): how often they look about
 * for a fire (s); how far off they see one (m across, and up or down); how near they
 * come to spray it (m); and how much of the fire on them the cloud they spray at their
 * own feet puts out in a second.
 */
const DOUSE = { every: 0.3, sight: 6, rise: 1.5, reach: 2, self: 0.9 };

/**
 * Going faster than this (m/s) past a free hand, a thing isn't taken: flung or swung at
 * them, it hits them; only what's brought to the hand and held there is taken.
 */
const TAKE_SPEED = 2.5;

/**
 * What a limb bears (N) pressed on by a thing (see onLoad()): more than a car's wheel
 * standing on it. Past that, each newton crushes it by CRUSHING hit points a second,
 * and one crushed well past its hit points is pressed flat (gone, in a mess): under a
 * tonne it takes about half a second, under a slab of many tonnes at once.
 */
export const LIMB_BEARS = 3000;
export const CRUSHING = 0.06;

/** Poses picked from the menu (see setPose()). */
export type PoseName = 'stumble' | 'cower' | 'sit' | 'flat';
const POSE_NAMES: [PoseName, string][] = [['stumble', 'Stumble'], ['cower', 'Cower'], ['sit', 'Sit'], ['flat', 'Flat pose']];
/** Cowering: crouched down, arms over the head, head tucked in. */
const POSE_COWER: Pose = { ...POSE_CROUCH, head: -0.5, upperArmF: 2.5, upperArmB: 2.2, lowerArmF: 2.2, lowerArmB: 2.3, handF: 0.4, handB: 0.4 };
/** Sitting on the floor: legs out in front, the back up straight, hands on the knees. */
const POSE_SIT: Pose = {
  head: 0.05, midTorso: 0.08, lowerTorso: 0.08, upperLegF: 1.5, upperLegB: 1.4, lowerLegF: -0.15, lowerLegB: -0.25, footF: 0.1, footB: 0.1,
  upperArmF: 0.7, upperArmB: 0.5, lowerArmF: 0.3, lowerArmB: 0.4,
};
/** Lying flat out, straight and still. */
const POSE_FLAT: Pose = { upperArmF: 0.05, upperArmB: -0.05 };

/** The parts of a person that show their team's colour (their shirt: see setTeam()). */
const SHIRT: LimbKey[] = ['upperTorso', 'midTorso', 'lowerTorso', 'upperArmF', 'upperArmB'];

const mix = (a: V2, b: V2, s: number): V2 => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });

/** A punch, or a swing of something held: the arm draws back, then drives the fist (or the weapon) at the foe. */
interface Blow {
  t: number;
  dur: number;
  side: 'F' | 'B';
  /** What is swung (null: a punch, or a kick). */
  item: Item | null;
  /** A kick with the front leg (at something too low to punch, or now and then). */
  kick: boolean;
  /** It's landed (each blow hurts once). */
  landed: boolean;
  /** How much of it goes on drawing back, and on throwing it (fractions; see blowStage()). */
  wind: number;
  out: number;
  /** What it's aimed at. */
  aim: 'head' | 'chest';
  /** A zombie's lunge to grab and bite (see maul()). */
  bite?: boolean;
}

/** Is it a gun (fired at a foe from a way off rather than swung)? A crossbow is (it has a projectile speed). */
function isGun(it: Item): it is Item & { fire(): void } {
  return ('gun' in it || 'projectileSpeed' in it) && typeof (it as { fire?: unknown }).fire === 'function';
}

/** How fast a gun's shot flies (m/s): Infinity for a beam, or a gun that doesn't say. */
function shotSpeed(gun: Item): number {
  if ('projectileSpeed' in gun) return (gun as Item & { projectileSpeed(): number }).projectileSpeed() || Infinity;
  const spec = (gun as Item & { gun?: { speed: number; laser?: number } }).gun;
  return spec && spec.laser === undefined && spec.speed > 0 ? spec.speed : Infinity;
}

/** How far a held weapon reaches beyond the hand (m): from its grip to its far end. */
function weaponReach(it: Item): number {
  return Math.max(0.2, (it.main.w - (it.hold?.grip[0] ?? 0)) * PX);
}

/** Something lying about worth picking up to fight with: a melee weapon or a gun (not one stuck in someone). */
function isWeapon(e: Entity): e is Item {
  const it = e as Item & { lodge?: unknown };
  return !!it.hold && !it.lodge && (e.def.category === 'Melee' || isGun(it));
}

interface Wound {
  ix: number;
  iy: number;
  /** Outward direction in part-local space. */
  dx: number;
  dy: number;
  rate: number;
  spurt: boolean;
}

interface Limb {
  spec: LimbSpec;
  part: Part;
  joint: RAPIER.RevoluteImpulseJoint | null;
  parent: Limb | null;
  children: Limb[];
  /** Joint anchors (local meters) for stress checks. */
  a1: V2;
  a2: V2;
  severed: boolean;
  gone: boolean;
  broken: boolean;
  /** Its joint's limits are the broken bone's (see setLimits()). */
  loose: boolean;
  /** Connected to the torso through intact joints. */
  attached: boolean;
  wounds: Wound[];
  stress: number;
  phase: number;
  /** Extra rotational inertia (small links get some so piles don't make them buzz). */
  extraI: number;
}

type State = 'stand' | 'down' | 'getup';

/** How the body stands over its feet: the tilt of the line from the feet (sx, sy) to the center of mass, and how fast it turns. */
interface Column {
  theta: number;
  omega: number;
  sx: number;
  sy: number;
  /** How far the center of mass is from the feet (m). */
  h: number;
  grounded: boolean;
}

interface Variant {
  kind: BodyKind;
  skin: Skin;
  skinKey: string;
  material: PhysMaterial;
  /** Damage multiplier. */
  toughness: number;
  bleeds: boolean;
}

export const VARIANTS: Record<string, Variant> = {
  human: { kind: 'human', skin: HUMAN_SKIN, skinKey: 'default', material: MAT.flesh, toughness: 1, bleeds: true },
  android: { kind: 'android', skin: HUMAN_SKIN, skinKey: 'default', material: MAT.robot, toughness: 0.45, bleeds: false },
};

export class Human extends Entity implements Holder {
  readonly variant: Variant;
  readonly limbs = new Map<LimbKey, Limb>();
  private order: Limb[] = [];
  private f: 1 | -1;

  alive = true;
  /** 0..1 */
  consciousness = 1;
  /** 0..100 blood volume */
  blood = 100;
  pain = 0;
  /** Long-term shock from trauma (0..1). */
  shock = 0;
  state: State = 'stand';
  private stateT = 0;
  private airT = 0;
  private held = false;
  private getupFails = 0;
  /** Where the torso lay when it gave up trying to stand (see rouse()). */
  private gaveUp: V2 | null = null;
  /** Extra tries earned by the pile shifting since it last got up or was roused. */
  private retries = 0;
  private getupBest = 0;
  private getupProgressT = 0;
  /** Just let go of (s left): whether they've landed on their feet is checked every step meanwhile. */
  private catchT = 0;
  /** Shuffling off someone they're lying on top of: which way, for how long, and how many goes so far. */
  private crawlDir = 0;
  private crawlT = 0;
  /** (each their own moment to look: a heap of people knocked down at once all looked in the same step) */
  private crawlCheck = Math.random() * 0.25;
  private crawls = 0;
  /** Where the trunk was at the last look while crawling, and how many looks in a row it hadn't moved. */
  private crawlX = 0;
  private crawlStuck = 0;
  /** When pinned() last looked (by `t`), and what it found. */
  private pinnedAt = -Infinity;
  private wasPinned = false;
  /** How long they've spent letting their legs down onto the floor this time (see lowerFeet()). */
  private feetT = 0;
  private motorTimer = 0;
  private motorSig = '';
  private deathT = 0;
  private t = Math.random() * 100;
  /** Forced limp (context menu). */
  limp = false;
  /** The vehicle seat they sit in (see sit()). */
  seat: Seat | null = null;
  /** Joint angles at the start of a get-up (blended toward the standing pose). */
  private blendFrom: Map<Limb, number> | null = null;
  /** Joint angles eased out of into the next pose, over settleDur s (see SETTLE_T, POSE_EASE). */
  private settleFrom: Map<Limb, number> | null = null;
  private settleT = 0;
  private settleDur = SETTLE_T;
  /** Items held in the hands. */
  private grips: Grip[] = [];
  /** Recently dropped items that still overlap the body. */
  private dropped: { item: Item; t: number }[] = [];

  // ---- getting about on foot (see think())
  /** Wanders about on its own (context menu); otherwise stays where it is put. */
  wander = false;
  private goal: 'idle' | 'walk' | 'flee' | 'fight' | 'douse' = 'idle';
  private goalT = 0;
  private targetX = 0;
  private fleeFrom = 0;
  /** Which way (-1/1) it was last stopped by something. */
  private blocked = 0;
  private cornered = false;
  private stuckT = 0;
  private turnT = 0;
  /** How long it has been unable to turn round to set off. */
  private turnWait = 0;
  private lookT = 0;
  /** Wanted speed (m/s) in the facing direction (below 0: stepping back, in a fight or a stumble). */
  private speed = 0;
  /** Stepping to catch their balance (see stumbleSpeed()). */
  private stumbling = false;
  /** Gait phase (rad), and how far the legs have gone over from standing to stepping (0..1). */
  private stride = 0;
  private gaitAmt = 0;
  /** The speed the legs are stepping for: the body's own speed, working up to the wanted one. */
  private pace = 0;
  /** What blockedAhead() last found in the way (null: nothing, or the ground or a wall). */
  private blocker: Part | null = null;
  /** Following someone ahead: the speed to keep to (0: nobody in the way). */
  private pacing = 0;
  /** Climbing up onto something, over it or down off a ledge (see climb()). */
  private climbing: Climb | null = null;
  /** Until they may climb again, and since they last finished a climb (s). */
  private climbCool = 0;
  private landT = 9;
  /** Some of them was frozen last step (see preStep()). */
  private wasFrozen = false;
  /** Waiting for the cool-down to climb again (see think()). */
  private climbWait = false;

  // ---- fighting (see fight())
  /** Who they're going for (null: nobody). */
  foe: Entity | null = null;
  /** The punch or swing being thrown, and until the next may be (s). */
  private blow: Blow | null = null;
  private blowT = 0;
  /** Which arm punched last (they take turns). */
  private lastFist: 'F' | 'B' = 'B';
  /** Shooting at the foe: until the next shot (s), and how far the gun is tipped up (+) or down to aim (rad). */
  private shotT = 0;
  private tilt = 0;
  /** Putting out a fire (see douse()): the extinguisher they're spraying, the burning part they're after, and until they next look about for one (s). */
  private dousing: Item | null = null;
  private fireAt: Part | null = null;
  private fireT = 0;
  /** Backing away from a foe too near to fire a launcher at (until a metre past its blast). */
  private backOff = false;
  /** How long the foe has been down (s): long enough, and they've won. */
  private foeDownT = 0;
  /** How long they've been down themselves in the fight (see FIGHT.beaten). */
  private downT = 0;
  /** The arm (and leg) targets last sent in the fight, when (by `t`), and whether they're still catching up (see fightIK()). */
  private fightPose = new Map<LimbKey, number>();
  private fightPoseT = 0;
  /** A weapon being drawn back to swing, and what it was stuck in, passed through until it's swung (see freeWeapon()). */
  private freed: { part: Part; from: Part[] } | null = null;
  private easingFists = false;
  private jumping: Jump | null = null;
  /** The side they fight for (see Teams): they go for anyone on another, and leave their own be (null: none). */
  team: TeamId | null = null;
  /** Until they next look about for an enemy, on a team (s; see scan()). */
  private scanT = Math.random() * 0.3;
  /** Stepping back from the foe this step, still facing them (see closeIn()), and whether there was room behind at the last look. */
  private backstep = false;
  private backClear = true;
  /** A weapon fought with: which, and the angle it's to point at (on the shoulder, or swung; see swingPath()). */
  private swingAt: { item: Item; angle: number } | null = null;
  /** Another punch coming straight after the last, before stepping back out. */
  private combo = false;
  /** Shooting: how long the gun has been steady on the foe (s), how long it must be before the next shot, which part of them it's aimed at, and how far off (rad). */
  private aimT = 0;
  private aimNeed = 0;
  private aimSpot: 'head' | 'chest' | 'belly' = 'chest';
  private aimErr = 0;
  /** How much higher than the foe the gun is aimed, for its sagging under its weight (rad; see shoot()). */
  private aimTrim = 0;
  /** Out of the gun's range: walking in until well inside it. */
  private closing = false;
  /** Getting away from a lit bomb or a fire close by: for how long (s) and from where (x); and until they next look for one (s). */
  private evadeT = 0;
  private evadeX = 0;
  private dangerT = 0;
  /** A weapon lying about they're going for (empty-handed against an armed foe), and for how long so far (s). */
  private fetch: Item | null = null;
  private fetchT = 0;
  /** Kept for looking along the line of fire (see friendInWay()). */
  private fireRay: RAPIER.Ray | null = null;
  /**
   * Finding a way to the foe (see route()): the speed to go at, as worked out at the
   * last look (0: off, jumping or climbing; null: walking on as anyone does); and for
   * how long (s) there's no way on to them which way (a drop, a wall), and until the
   * next fist shaken at them from there (s).
   */
  private approach: number | null = null;
  private noWayT = 0;
  private noWayDir = 1;
  private tauntT = 0;
  /** Stuck up high with the foe down below: until they next look for another way down (s), and the one they're off to (x, how high they set off from, for how long more: s). */
  private wayT = 0;
  private detourX = 0;
  private detourY = 0;
  private detourT = 0;
  /** A stumble would take them over a drop: they stand it out instead (see think()). */
  private edgeStep = false;

  // ---- zombies (see rise()) and poses (see setPose())
  /** Infected: how far it has got (0: not infected; at 1 they turn). */
  infection = 0;
  /** Turned: undead, and on a side of their own (see Teams). */
  zombie = false;
  /** Until the next groan (s), and how much of a Cure has gone in. */
  private groanT = 2 + Math.random() * 6;
  private cureDose = 0;
  /** The pose picked in the menu (null: none). */
  pose: PoseName | null = null;
  /** Until the next lurch in a Stumble (s). */
  private lurchT = 0;
  /** Frozen stiff (the Freeze drug): every joint locked where it was (see stiffen()). */
  private stiff = false;
  /** Until the next bone gives way to Bone Eating (s). */
  private boneT = 0;
  /** What the skin was last dressed for (a zombie's or their own: see frame()). */
  private dressedZombie = false;
  /** An android tinted by the Freeze (see tone()). */
  private toned = false;

  constructor(game: Game, def: ItemDef, variant: Variant, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.variant = variant;
    this.f = this.flipped ? -1 : 1;
    const f = this.f;
    const ang = opts.angle ?? 0;
    const tough = 1 / variant.toughness;
    for (const s of SPECS) {
      const off = rotate(s.cx * f * PX, (s.cy - MID_Y) * PX, ang);
      const part = this.addPart({
        name: s.name,
        art: limbArt(variant.kind, s.key, variant.skin, variant.skinKey),
        material: variant.material,
        x: x + off.x,
        y: y + off.y,
        angle: ang,
        shapes: [s.shape],
        density: s.density,
        layer: s.layer,
        ccd: true,
        linearDamping: 0.04,
        angularDamping: 0.7,
        maxHp: s.hp * tough,
        friction: s.key.startsWith('foot') ? 1.0 : undefined,
        forceThreshold: 30,
        textureKey: `${variant.kind}:${variant.skinKey}:${s.key}`,
      });
      if (s.key === 'upperTorso' && variant.material === MAT.flesh) part.buoyancy = LUNGFUL.full;
      if (s.key === 'head' && variant.material === MAT.flesh) part.buoyancy = HEAD_SINKS;
      const limb: Limb = {
        spec: s, part, joint: null, parent: null, children: [], a1: { x: 0, y: 0 }, a2: { x: 0, y: 0 },
        severed: false, gone: false, broken: false, loose: false, attached: true, wounds: [], stress: 0, phase: Math.random() * 10, extraI: 0,
      };
      // Hands, feet and forearms are tiny and get squeezed between heavy bodies in
      // piles, where their minute inertia makes the contact solve buzz. Tripling it
      // is invisible in normal motion but lets them settle.
      const small = /^(hand|foot|lowerArm)/.test(s.key);
      if (small) {
        limb.extraI = part.body.principalInertia() * 2;
        part.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, limb.extraI, true);
      }
      if (s.parent) {
        const parent = this.limbs.get(s.parent)!;
        limb.parent = parent;
        parent.children.push(limb);
        const ps = parent.spec;
        limb.a1 = { x: (s.jx! - ps.cx) * f * PX, y: (s.jy! - ps.cy) * PX };
        limb.a2 = { x: (s.jx! - s.cx) * f * PX, y: (s.jy! - s.cy) * PX };
        const j = this.addJoint(RAPIER.JointData.revolute(limb.a1, limb.a2), parent.part, part) as RAPIER.RevoluteImpulseJoint;
        j.configureMotorModel(RAPIER.MotorModel.ForceBased);
        if (f === 1) j.setLimits(s.lo!, s.hi!);
        else j.setLimits(-s.hi!, -s.lo!);
        limb.joint = j;
      }
      this.limbs.set(s.key, limb);
      this.order.push(limb);
    }
    this.state = 'down';
    this.setState('stand');
  }

  get label(): string {
    return this.def.name + (this.alive ? '' : ' (dead)');
  }

  limbOf(p: Part): Limb | undefined {
    for (const l of this.order) if (l.part === p) return l;
    return undefined;
  }

  private L(k: LimbKey): Limb {
    return this.limbs.get(k)!;
  }

  private ok(k: LimbKey): boolean {
    const l = this.limbs.get(k);
    return !!l && !l.gone && l.attached;
  }

  // ---------------------------------------------------------------- control

  /**
   * Can this body be put to sleep once it stops moving? Not while it is held,
   * holding something, getting up, or writhing in pain. Someone standing still,
   * or lying still where they can't get up (pinned, broken legs), may: anything
   * that disturbs them (a hit, a push, falling over) wakes them again.
   */
  canRest(): boolean {
    if (this.held || this.grips.length > 0) return false;
    if (this.strength() <= 0) return true;
    return this.state !== 'getup' && this.stateT > 3 && this.pain < CALM_PAIN && this.gaitAmt < 0.02;
  }

  /**
   * A failed attempt to stand. After a few (wedged in a pile of bodies, legs
   * trapped) it lies still instead of shoving the whole pile around forever,
   * until something changes: see rouse().
   */
  private failGetup(): void {
    this.getupFails++;
    // tangled up with other bodies, each go shoves the whole heap about (and sets
    // whoever it frees trying in turn): fewer goes, as animals on a heap get
    if (this.getupFails >= (this.amongBodies() ? 2 : GIVE_UP)) this.gaveUp = { x: this.L('upperTorso').part.x, y: this.L('upperTorso').part.y };
    this.setState('down');
  }

  /** Touching someone else, a person or an animal. */
  private amongBodies(): boolean {
    const world = this.game.physics.world;
    for (const l of this.order) {
      if (l.gone || !l.attached) continue;
      for (const c of l.part.colliders) {
        let hit = false;
        world.contactPairsWith(c, (o) => {
          const op = hit ? undefined : this.game.physics.partOf(o);
          if (!op || op.entity === this || op.frozen || !op.entity.canWalk) return;
          world.contactPair(c, o, (m) => {
            if (m.numContacts() > 0) hit = true;
          });
        });
        if (hit) return true;
      }
    }
    return false;
  }

  /** Something happened (a hit, a wound, being picked up): try standing again. */
  private rouse(): void {
    this.gaveUp = null;
    this.getupFails = 0;
    this.retries = 0;
  }

  /**
   * The pile it gave up in has shifted: one more try. Only one at a time, and
   * only a couple in all: two people wedged together would otherwise take
   * turns shifting each other and trying again forever.
   */
  private retry(): void {
    this.gaveUp = null;
    this.getupFails = GIVE_UP - 1;
    this.retries++;
  }

  /** Overall muscle strength 0..1. */
  private strength(): number {
    if (!this.alive || this.limp || this.stiff) return 0;
    return clamp(this.consciousness * (1 - this.shock * 0.6), 0, 1);
  }

  // ---------------------------------------------------------------- drugs

  /** Seconds left of each drug's effect. */
  readonly drugs = { adrenaline: 0, knockout: 0, poison: 0, painkiller: 0, strength: 0, freeze: 0, bone: 0, acid: 0, coagulation: 0 };
  private mendDose = 0;
  private lifeDose = 0;
  /** Seconds left out cold from a jolt (see stun()). */
  stunned = 0;
  /** Their breath, in water (see breathe()). */
  readonly breath = new Breath(LUNGFUL);

  /**
   * Knocked out for `secs` (a stun gun's jolt): down at once and coming round after,
   * as from a knockout. It's no drug, so it shows as none, and androids go down too.
   */
  stun(secs: number): void {
    if (!this.alive) return;
    this.stunned = Math.max(this.stunned, secs);
  }

  /** How much faster adrenaline has them walking, running, getting up and looking about (1: no faster; a zombie shambles slower). */
  get rush(): number {
    return (this.alive ? adrenalineRush(this.drugs.adrenaline) : 1) * (this.zombie ? ZOMBIE.pace : 1);
  }

  /** How much stronger Ultra Strength has them (1: no stronger; see MIGHT). */
  private get might(): number {
    return this.alive && this.drugs.strength > 0 ? MIGHT.muscle : 1;
  }

  /** Not infected, nor undead: a zombie goes for them (people, androids too; see Teams). */
  get prey(): boolean {
    return this.alive && !this.zombie && this.infection === 0;
  }

  /** Strides lengthen with the rush, so the legs don't have to make up all the extra speed by stepping faster. */
  private get reach(): number {
    return 1 + (this.rush - 1) * 0.3;
  }

  /** A syringe pushing `dose` (fraction of a full syringe) into the bloodstream. */
  inject(drug: Drug, dose: number): void {
    // (an android has no blood to carry anything round: only the Freeze, which locks
    // its joints wherever it goes in, does anything to one)
    if (!this.variant.bleeds && drug !== 'freeze') return;
    if (this.zombie && !UNDEAD_DRUGS.has(drug)) return;
    // (a heart that has stopped takes nothing round the body: only Life works on the
    // dead, the Zombie virus, which raises them, and the Cure, which keeps it from doing so)
    if (!this.alive && drug !== 'life' && drug !== 'cure' && drug !== 'zombie') return;
    const d = this.drugs;
    switch (drug) {
      case 'death':
        // the heart stops there and then
        this.die();
        break;
      case 'coagulation':
        d.coagulation = Math.min(60, d.coagulation + dose * 30);
        break;
      case 'painkiller':
        d.painkiller = Math.min(120, d.painkiller + dose * 60);
        this.pain = 0;
        break;
      case 'strength':
        d.strength = Math.min(120, d.strength + dose * 60);
        break;
      case 'freeze':
        d.freeze = Math.min(90, d.freeze + dose * 30);
        if (!this.stiff) this.stiffen(true);
        break;
      case 'bone':
        d.bone = Math.min(30, d.bone + dose * 15);
        break;
      case 'acid':
        d.acid = Math.min(40, d.acid + dose * 25);
        break;
      case 'zombie':
        this.infect();
        break;
      case 'cure':
        this.cure(dose);
        break;
      case 'healing':
        this.mend(dose);
        break;
      case 'life':
        if (this.alive) this.mend(dose * 0.6);
        else {
          // brings the dead back if there is still a head on the body (a part dose
          // wears off: see vitals; and none of it is any use without a head)
          const head = this.L('head');
          if (head.gone || !head.attached) break;
          this.lifeDose += dose;
          if (this.lifeDose >= 0.5) {
            this.lifeDose = 0;
            this.heal();
          }
        }
        break;
      case 'adrenaline':
        this.rouse();
        this.drugs.adrenaline = Math.min(90, this.drugs.adrenaline + dose * 45);
        this.drugs.knockout = Math.max(0, this.drugs.knockout - dose * 90);
        break;
      case 'knockout':
        this.drugs.knockout = Math.min(120, this.drugs.knockout + dose * 30);
        break;
      case 'poison':
        this.drugs.poison = Math.min(120, this.drugs.poison + dose * 40);
        break;
    }
  }

  /**
   * Healing over the injection: tissue, blood, burns and the blood on the skin,
   * and they come round and try to get up again; bones and wounds at the end.
   */
  private mend(dose: number): void {
    if (!this.alive) return;
    this.rouse();
    this.blood = Math.min(100, this.blood + dose * 60);
    this.pain = Math.max(0, this.pain - dose * 2);
    this.shock = Math.max(0, this.shock - dose * 2);
    this.consciousness = Math.min(1, this.consciousness + dose * 1.5);
    this.drugs.poison = 0;
    // (it gets them back up: a sedative is worn through as adrenaline does)
    this.drugs.knockout = Math.max(0, this.drugs.knockout - dose * 90);
    this.mendDose += dose;
    let face = false;
    for (const l of this.order) {
      if (l.gone) continue;
      const p = l.part;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * dose * 1.5);
      if (p.burning > 0) this.game.fire.extinguish(p);
      p.charred = Math.max(0, p.charred - dose * 1.5);
      p.refreshTint();
      // the blood washes off a pixel at a time, and the bleeding eases off at once
      if (washBlood(p, dose * 2.5) && l.spec.key === 'head') face = true;
      for (const w of l.wounds) w.rate *= Math.max(0, 1 - dose * 4);
      if (this.mendDose >= 0.6) {
        l.wounds.length = 0;
        l.broken = false;
      }
    }
    // (washing the face takes its expression with it)
    if (face) this.setFace();
    if (this.mendDose >= 0.6) {
      this.mendDose = 0;
      this.updateMotors(true);
    }
  }

  /**
   * A defibrillator's shock: a heart that stopped less than a minute ago starts
   * again, if the head and chest are whole. Only what stopped it is patched up
   * enough to keep it going: they come round weak, wounds and all. Whether it worked.
   */
  restart(): boolean {
    const head = this.L('head');
    const chest = this.L('upperTorso');
    if (this.alive || this.deathT > 60 || head.gone || !head.attached || head.part.hp <= 0 || chest.part.hp <= 0 || !this.L('midTorso').attached) return false;
    this.alive = true;
    this.deathT = 0;
    this.lifeDose = 0;
    // (what poisoned or sedated them is what the shock has to beat: it's gone)
    this.drugs.poison = this.drugs.knockout = 0;
    this.blood = Math.max(this.blood, 70);
    this.consciousness = 0.5;
    this.pain = Math.min(this.pain, 0.5);
    this.shock = Math.min(this.shock, 0.3);
    this.rouse();
    for (const l of this.order) {
      if (l.gone) continue;
      l.part.hp = Math.max(l.part.hp, l.part.maxHp * 0.6);
      l.part.refreshTint();
    }
    this.setFace();
    this.updateMotors(true);
    return true;
  }

  /**
   * The body's colour shows what's in it (set as each frame is drawn, on every screen:
   * what it goes by is sent to guests): frozen stiff, pale and blue; an infection
   * greying it as it takes hold; poison a sickly green, deeper as it drains them (in
   * eighths: it steps); Ultra Strength flushed; and a corpse's pallor coming over it.
   */
  private tone(): void {
    const d = this.drugs;
    // (an android only ever turns blue with the Freeze: otherwise its tint is left be,
    // once set back after it thaws)
    if (!this.variant.bleeds && !(d.freeze > 0) && !this.toned) return;
    this.toned = d.freeze > 0;
    let r = 1;
    let g = 1;
    let b = 1;
    if (d.freeze > 0) {
      r = 0.84;
      g = 0.95;
      b = 1.14;
    } else {
      if (this.infection > 0 && !this.zombie) {
        const k = Math.round(this.infection * 8) / 8;
        r -= 0.16 * k;
        g -= 0.05 * k;
        b -= 0.2 * k;
      }
      if (d.poison > 0 && this.alive) {
        const k = Math.round((0.45 + 0.55 * clamp((100 - this.blood) / 50, 0, 1)) * 8) / 8;
        r *= 1 - 0.24 * k;
        g *= 1 - 0.03 * k;
        b *= 1 - 0.32 * k;
      }
      if (d.strength > 0 && this.alive) {
        r *= 1.1;
        g *= 0.93;
        b *= 0.9;
      }
      if (!this.alive && this.variant.kind === 'human' && !this.zombie) {
        const k = Math.min(1, this.deathT / 25);
        r *= 1 - k * 0.12;
        g *= 1 - k * 0.1;
        b *= 1 - k * 0.04;
      }
    }
    for (const l of this.order) {
      if (l.gone || l.part.frozen || l.part.noCollideAll) continue;
      l.part.setTint(r, g, b);
    }
  }

  /** Infected with the zombie virus (a Zombie syringe, a zombie's bite): it takes hold over the next few seconds, and they turn (see rise()). */
  infect(): void {
    if (!this.variant.bleeds || this.zombie || this.infection > 0) return;
    this.infection = 1e-3;
  }

  /**
   * The infection has taken hold: they turn. The living drop where they stand and get
   * up again a zombie; the dead (their head still on) rise as one. Grey-green, slow and
   * feeling nothing, a zombie goes for the living and bites (see maul()); only its head
   * destroyed or taken off, or a far worse mauling than kills the living, stops it.
   */
  private rise(): void {
    const head = this.L('head');
    if (this.zombie || head.gone || !head.attached || head.part.hp <= 0) return;
    this.zombie = true;
    this.infection = 1;
    this.dropAll();
    this.stopFighting();
    this.pose = null;
    this.wander = true;
    const d = this.drugs;
    d.knockout = d.poison = d.painkiller = d.coagulation = d.adrenaline = 0;
    if (!this.alive) {
      // (what killed them patched up enough to stand on)
      this.alive = true;
      this.deathT = 0;
      this.consciousness = 0.35;
      for (const l of this.order) if (!l.gone) l.part.hp = Math.max(l.part.hp, l.part.maxHp * 0.4);
    } else this.stun(2);
    this.pain = this.shock = 0;
    this.rouse();
    this.redress();
    this.setFace();
    this.setState('down');
    this.groanT = 0.3;
    this.scanT = 0;
  }

  /**
   * The Zombie Cure: enough of it clears an infection, and a zombie (its head still
   * whole) is themselves again, in their own skin, coming round on the floor.
   */
  private cure(dose: number): void {
    if (!this.infection && !this.zombie) return;
    this.cureDose += dose;
    if (this.cureDose < 0.3) return;
    this.cureDose = 0;
    this.infection = 0;
    if (!this.zombie) return;
    this.zombie = false;
    this.wander = false;
    this.stopFighting();
    if (this.alive) {
      this.blood = Math.max(this.blood, 60);
      this.stun(2);
    }
    this.redress();
    this.setFace();
    this.updateMotors(true);
  }

  /** Every part in what they wear now: a zombie's skin or their own, in their side's colours (see teamArt()). */
  private redress(): void {
    this.dressedZombie = this.zombie;
    for (const l of this.order) if (!l.gone && !l.part.destroyed) dress(l.part, this.teamArt(l.spec.key, this.team));
  }

  /**
   * Frozen stiff (the Freeze drug; false: thawed): every joint locked where it is, so the
   * body keeps its shape like a statue (and falls over like one), its muscles no use.
   */
  private stiffen(on: boolean, quiet = false): void {
    if (this.stiff === on) return;
    this.stiff = on;
    for (const l of this.order) this.setLimits(l);
    const c = this.L('upperTorso').part;
    if (on) {
      this.stopFighting();
      this.setState('down');
      if (!quiet) this.game.sound.play('impact/glass_light', { gain: 0.45, x: c.x, rate: 1.5, vary: 0.1 });
    } else {
      this.rouse();
      if (!quiet) liquidSound(this.game, 'liquid/drip', c.x, 0.3, 0.2);
    }
    this.updateMotors(true);
  }

  /** Breaks a limb's bone (Break bone in the menu, Bone Eating) or mends it (Mend bone). */
  private setBroken(l: Limb, on: boolean): void {
    if (l.broken === on || l.gone) return;
    l.broken = on;
    const p = l.part;
    if (on) {
      this.game.sound.bone(p.x);
      if (this.alive && !this.zombie) this.pain = Math.min(1.5, this.pain + 0.35);
      // (a bruise where it went)
      if (this.variant.kind === 'human') p.paintAt(p.x, p.y, 0x5a2a3a, 1, 0.35);
      this.rouse();
    }
    this.updateMotors(true);
  }

  /** Bone Eating: another bone gives way (not the skull). Whether there was one left whole. */
  private eatBone(): boolean {
    const whole = this.order.filter((l) => !l.gone && l.joint && !l.broken && l.spec.key !== 'head');
    if (!whole.length) return false;
    this.setBroken(whole[Math.floor(Math.random() * whole.length)], true);
    return true;
  }

  /** Acid in the blood: every limb is eaten away (blistering, dripping, smoking) until it gives way and falls off. */
  private melt(dt: number): void {
    const ps = this.game.particles;
    let x = 0;
    for (const l of this.order) {
      if (l.gone) continue;
      const p = l.part;
      x = p.x;
      // (some go sooner than others)
      p.hp -= p.maxHp * 0.07 * (0.6 + (l.phase % 1) * 0.8) * dt;
      if (Math.random() < dt * 5) {
        const ix = Math.floor(Math.random() * p.w);
        const iy = Math.floor(Math.random() * p.h);
        p.paintPixel(ix, iy, ACID_SCAR, 0.8);
      }
      if (Math.random() < dt * 0.5) ps.liquid(Liquid.Acid, p.x, p.y, 0, -1, 1, 0.4, 0.8, p.body);
      if (Math.random() < dt * 0.6) ps.smoke(p.x, p.y + 0.05, 1, 0.06);
      if (p.hp <= 0 && l.joint && !l.severed) this.sever(l, 'cut');
    }
    if (this.alive && !this.zombie) this.pain = Math.min(1.5, this.pain + dt * 0.08);
    liquidSound(this.game, 'liquid/sizzle', x, 0.3, 0.7);
  }

  /** What's in them at work (some of it on the dead too), and an infection taking hold. */
  private afflict(dt: number): void {
    const d = this.drugs;
    if (d.freeze > 0) {
      // (thawing sooner by a fire)
      const burnt = this.order.some((l) => !l.gone && l.part.burning > 0);
      d.freeze = Math.max(0, d.freeze - dt * (burnt ? 8 : 1));
      if (d.freeze === 0) this.stiffen(false);
    }
    d.painkiller = Math.max(0, d.painkiller - dt);
    d.strength = Math.max(0, d.strength - dt);
    if (d.coagulation > 0) {
      d.coagulation = Math.max(0, d.coagulation - dt);
      // the blood thickens: every wound stops bleeding within a few seconds
      for (const l of this.order) for (const w of l.wounds) w.rate *= Math.exp(-dt * 1.2);
    }
    if (d.bone > 0) {
      d.bone = Math.max(0, d.bone - dt);
      if ((this.boneT -= dt) <= 0) {
        this.boneT = 0.6 + Math.random() * 0.6;
        if (!this.eatBone()) d.bone = 0;
      }
    }
    if (d.acid > 0) {
      d.acid = Math.max(0, d.acid - dt);
      this.melt(dt);
    }
    // the infection takes hold (in the dead too: they rise), and turns them once it has
    if (this.infection > 0 && this.infection < 1) {
      this.infection = Math.min(1, this.infection + dt / ZOMBIE.incubate);
      if (this.infection >= 1) this.rise();
    }
    if (this.zombie && this.alive && this.consciousness > 0.3 && (this.groanT -= dt) <= 0) {
      this.groanT = 5 + Math.random() * 9;
      this.game.sound.play('creature/zombie_groan', { gain: 0.35, x: this.L('upperTorso').part.x, vary: 0.12 });
    }
  }

  // ---------------------------------------------------------------- poses

  /**
   * A pose picked from the menu (null: none; picked again, it's let go of): Stumble
   * (they lurch about, catching themselves), Cower (crouched, arms over the head, going
   * nowhere), Sit (on the floor, legs out in front) or Flat pose (lying straight and still).
   */
  setPose(p: PoseName | null): void {
    this.pose = p;
    this.stopFighting();
    this.rouse();
    if (p === 'sit' || p === 'flat') this.setState('down');
    else if (this.state === 'stand') this.easeFrom(POSE_EASE * 2);
    this.lurchT = 0.4;
    this.updateMotors(true);
  }

  /** Stumbling about: now and then a lurch one way or the other, to catch with a few quick steps. */
  private lurch(dt: number): void {
    if ((this.lurchT -= dt) > 0) return;
    this.lurchT = 0.7 + Math.random() * 1.1;
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const k of ['upperTorso', 'midTorso', 'head'] as LimbKey[]) {
      const p = this.L(k).part;
      if (!this.L(k).gone && !p.frozen) p.body.applyImpulse({ x: dir * p.mass * (0.9 + Math.random() * 0.7), y: 0 }, true);
    }
  }

  /** Sitting: the trunk held up over the hips (as a seat would hold it), the legs out along the floor. */
  private sitUp(dt: number): void {
    const p = this.L('lowerTorso').part;
    if (this.L('lowerTorso').gone || p.frozen) return;
    const tau = clamp(-wrapAngle(p.a) * 260 - p.body.angvel() * 40, -180, 180);
    p.body.applyTorqueImpulse(tau * dt, true);
  }

  private legsWork(): boolean {
    for (const k of ['upperLegF', 'lowerLegF', 'upperLegB', 'lowerLegB'] as LimbKey[]) {
      const l = this.L(k);
      if (!this.ok(k) || l.broken || l.part.hp < l.part.maxHp * 0.3) return false;
    }
    return this.ok('lowerTorso') && this.ok('midTorso');
  }

  private setState(s: State): void {
    if (this.state === s) return;
    const wasUp = this.state === 'stand' || this.state === 'getup';
    const wasGettingUp = this.state === 'getup';
    this.state = s;
    this.stateT = 0;
    this.feetT = 0;
    this.stumbling = false;
    this.climbing = null;
    this.jumping = null;
    this.settleFrom = null;
    // getting up blends every joint from where it is now to the standing pose,
    // instead of snapping the limbs into place
    if (s === 'getup') {
      this.blendFrom = new Map();
      for (const l of this.order) {
        if (l.joint && l.parent && !l.gone) this.blendFrom.set(l, wrapAngle(l.part.body.rotation() - l.parent.part.body.rotation()));
      }
    } else this.blendFrom = null;
    // up before that blend is done (it may stand from half a second in): the rest
    // of the way eases in too. Snapped, a half-bent leg whips out at 10-17 m/s,
    // worst with the feet on something loose (another body's paw)
    if (s === 'stand' && wasGettingUp) this.easeFrom(SETTLE_T);
    this.applyDamping();
    this.updateMotors(true);
    // a person who stood still has fallen asleep: wake them so the change shows
    // (otherwise someone knocked out while standing stays frozen upright)
    for (const l of this.order) if (!l.gone && !l.part.frozen) l.part.body.wakeUp();
    if (s === 'down' && wasUp && this.strength() < 0.3) this.buckle();
  }

  /** Passing out on your feet: the knees give and the upper body pitches forward. */
  private buckle(): void {
    const f = this.f;
    const push = (k: LimbKey, vx: number) => {
      const l = this.L(k);
      if (!l.gone && l.attached && !l.part.frozen) l.part.body.applyImpulse({ x: l.part.mass * vx * f, y: 0 }, true);
    };
    push('upperTorso', 0.9);
    push('head', 0.9);
    push('lowerTorso', -0.5);
    push('lowerLegF', 0.6);
    push('lowerLegB', 0.6);
  }

  /** Standing (or sitting up in a seat) muscles hold posture firmly; a fallen body moves freely. */
  private applyDamping(): void {
    const firm = this.state === 'stand' || (this.seat !== null && this.strength() > 0.15);
    const ang = firm ? BALANCE.standDamping : BALANCE.limpDamping;
    for (const l of this.order) if (!l.gone && !this.isGrabbed(l.part)) l.part.body.setAngularDamping(ang);
  }

  private isGrabbed(p: Part): boolean {
    return this.held && this.grabbedPart === p;
  }

  private updateMotors(force = false): void {
    const str = this.strength();
    const conscious = str > 0.15;
    const f = this.f;
    const standing = this.state !== 'down' && conscious;
    // climbing (tucked up until the feet are over where they're going, then reaching
    // down for it) and jumping
    const movePose = standing ? (this.climbing ? this.climbPose() : this.jumping ? this.jumpPose() : '') : '';
    // sitting in a vehicle (see sit()), or on the floor (Sit: see setPose()): the seat's
    // pose, held as firmly as standing
    const seated = (this.seat !== null || this.pose === 'sit') && conscious;
    const upPose = this.pose === 'cower' ? POSE_COWER : this.zombie ? POSE_ZOMBIE : POSE_STAND;
    const pose = movePose ? MOVE_POSES[movePose] : standing ? upPose : seated ? this.seat?.pose ?? POSE_SIT : this.pose === 'flat' ? POSE_FLAT : POSE_DOWN;
    const writhe = !standing && !seated && conscious && this.pose !== 'flat' ? Math.min(0.9, this.pain * 0.9) : 0;
    // treading water: arms sculling, legs kicking (see breathe())
    const paddle = !standing && this.treading;
    // someone lying still stops tensing up: weak muscles pushing against a pile of
    // bodies never find a balance and keep the limbs creeping forever
    const relaxed = !standing && !seated && conscious && !this.held && this.pain < CALM_PAIN && !this.grips.length && this.stateT > 4 && !paddle;
    // re-sending identical motor targets would keep the bodies awake (and drifting)
    const getupRamp = this.state === 'getup' ? clamp(this.stateT / 1.2, 0.12, 1) : 1;
    const ik = standing ? this.holdIK() : null;
    const blow = standing ? this.fightIK() : null;
    // how much harder the muscles work throwing a blow (see FIGHT)
    const thrown = this.blow && this.blowStage(this.blow).stage === 'out' ? (this.blow.item ? FIGHT.swingPower : FIGHT.power) : 0;
    let ikSig = '';
    if (ik) for (const k in ik) ikSig += Math.round(ik[k as LimbKey]! * 40) + ',';
    if (blow) for (const k in blow) ikSig += 'b' + Math.round(blow[k as LimbKey]! * 40) + ',';
    // limp or relaxed joints only have friction: how strong they are doesn't matter
    const tone = standing || (conscious && !relaxed) ? Math.round(str * 50) : -1;
    const stepping = standing && this.gaitAmt > 0 && !this.climbing && !this.jumping;
    const settle = standing && this.settleFrom ? smoothstep(0, 1, this.settleT / this.settleDur) : 1;
    // held up off the ground, they keep their legs under them to land on
    const dangling = this.held && conscious && !standing && !seated;
    const might = this.might;
    const sig = `${standing}:${conscious}:${tone}:${Math.round(getupRamp * 20)}:${this.gripSig()}:${ikSig}:${relaxed}:${stepping}:${movePose}:${Math.round(settle * 20)}:${dangling}:${seated}:${this.pose}:${might}:${this.zombie}`;
    if (!force && !stepping && !paddle && (writhe === 0 || relaxed) && sig === this.motorSig) return;
    this.motorSig = sig;
    // (passing out in the seat, they slump in it)
    if (this.seat) this.applyDamping();
    for (const l of this.order) {
      const j = l.joint;
      if (!j || !j.isValid() || l.severed) continue;
      if (l.loose !== l.broken) this.setLimits(l);
      let target = (pose[l.spec.key] ?? 0) * f;
      const from = this.blendFrom?.get(l);
      if (from !== undefined) target = from + (target - from) * smoothstep(0, 1, this.stateT / 1.1);
      else if (settle < 1) {
        const s = this.settleFrom?.get(l);
        if (s !== undefined) target = s + (target - s) * settle;
      }
      const arm = l.spec.muscle < 500;
      // arms holding something aim it forward
      const hold = standing ? this.armRole(l) : null;
      const swing = blow?.[l.spec.key];
      let boost = 1;
      if (swing !== undefined) {
        // fists up, or swinging a weapon (held as firmly as when aiming); a blow
        // going out has the arm (or leg) put into it. Muscles only turn joints, so
        // nothing is torn by a fist that's blocked
        target = swing;
        // (the other hand on a weapon only goes along with it: see fightIK())
        boost = hold ? (hold.role === 'support' ? 1 : hold.seg === 'hand' ? 8 : 3.5) : 1.5;
        if (thrown && (l.spec.key.endsWith(this.blow!.side) || this.blow!.kick)) boost *= thrown;
      } else if (hold) {
        const t = ik?.[l.spec.key];
        if (t !== undefined) {
          // arms reach for the item's grips (inverse kinematics)
          target = t;
          boost = hold.role === 'aim' ? (hold.seg === 'hand' ? 8 : 3.5) : 1.5;
        } else {
          const pz = hold.role === 'aim' ? AIM : SUPPORT;
          target = (hold.seg === 'upper' ? pz.upper : hold.seg === 'lower' ? pz.lower : pz.hand) * f;
          boost = hold.role === 'aim' ? (hold.seg === 'hand' ? 8 : 3.5) : 1.5;
        }
      } else if (this.grips.length && !standing && conscious && l.spec.key.startsWith('hand')) boost = 6;
      else if (stepping) target += this.gait(l.spec.key) * f;
      // (a zombie's arms held out, and arms over the head cowering, take more holding up)
      if (standing && arm && swing === undefined && !hold && (this.zombie || this.pose === 'cower')) boost = 3;
      // getting up with something in hand (or fists up): those arms come round to it
      // gradually too (snapped there, the weight in hand flings them about, and the
      // attempt fails as flailing)
      if (from !== undefined && (swing !== undefined || hold)) target = from + (target - from) * smoothstep(0, 1, this.stateT / 1.1);
      if (writhe > 0 && arm) {
        target += Math.sin(this.t * (1.5 + l.phase * 0.2) + l.phase) * writhe * 0.55 * f;
      }
      if (paddle) {
        const k = l.spec.key;
        const back = k.endsWith('B') ? Math.PI : 0;
        if (k.startsWith('upperArm')) target = (0.9 + Math.sin(this.t * 4 + back) * 0.9) * f;
        else if (k.startsWith('lowerArm')) target = (0.5 + Math.sin(this.t * 4 + back + 1) * 0.5) * f;
        else if (k.startsWith('upperLeg')) target = Math.sin(this.t * 5 + back) * 0.4 * f;
        else if (k.startsWith('lowerLeg')) target = (-0.3 + Math.sin(this.t * 5 + back - 1) * 0.3) * f;
      }
      const K = l.spec.muscle * boost * might * (l.broken ? 0.05 : 1) * (l.attached ? 1 : 0);
      if (this.seat && !conscious && K > 0 && /^(upperLeg|lowerLeg|foot|midTorso|lowerTorso)/.test(l.spec.key)) {
        // slumped in a vehicle's seat, the back stays up and the legs in the footwell (gone
        // limp, they'd fold down through the floor, which they don't touch, and drag along the road)
        j.setMotorMaxForce(1e6);
        j.configureMotorPosition((this.seat.pose[l.spec.key] ?? 0) * f, K * 0.3, K * 0.3 * 0.004 + 0.3);
      } else if (!conscious || K <= 0 || relaxed) {
        // limp: dry joint friction. Limbs still flop under their own weight, but
        // small sustained loads (a pile of bodies) no longer make them creep forever.
        const fr = (JOINT_FRICTION[l.spec.key.replace(/[FB]$/, '')] ?? 1) * (this.alive ? 1 : 0.7) * (l.broken ? 0.2 : 1);
        j.configureMotorVelocity(0, fr * 30);
        j.setMotorMaxForce(fr);
      } else if (standing || seated) {
        j.setMotorMaxForce(1e6);
        // NB: Rapier's soft motors lose most of their stiffness when damping is high,
        // so damping stays small and body angular damping provides the rest
        j.configureMotorPosition(target, K * str * getupRamp, K * str * getupRamp * 0.003 + 0.3);
      } else if (dangling && !arm) {
        j.setMotorMaxForce(1e6);
        const tone = 0.35;
        j.configureMotorPosition((POSE_STAND[l.spec.key] ?? 0) * f, K * tone * str, K * tone * 0.004 + 0.3);
      } else {
        j.setMotorMaxForce(1e6);
        // lying down: weak muscle tone (and writhing when in pain, or treading water)
        const tone = paddle ? (arm ? 0.5 : 0.15) : arm ? 0.18 + writhe * 0.5 : 0.035;
        j.configureMotorPosition(target, K * tone * str, K * tone * 0.004 + 0.3);
      }
    }
  }

  /**
   * Sets a joint's range of movement for the way they face: a broken bone gives
   * way and bends well past where the joint would stop it (a knee the wrong way).
   * Frozen stiff, it's locked where it is.
   */
  private setLimits(l: Limb): void {
    const j = l.joint;
    if (!j || !j.isValid()) return;
    l.loose = l.broken;
    if (this.stiff && l.parent) {
      const a = wrapAngle(l.part.bodyAngle - l.parent.part.bodyAngle);
      j.setLimits(a - 0.01, a + 0.01);
      return;
    }
    const give = l.broken ? BROKEN_GIVE : 0;
    // (short of the half turn, where the joint's angle wraps round)
    const lo = Math.max(-2.9, l.spec.lo! - give);
    const hi = Math.min(2.9, l.spec.hi! + give);
    if (this.f === 1) j.setLimits(lo, hi);
    else j.setLimits(-hi, -lo);
  }

  /** Is something heavy lying on this person's head or torso? */
  private pinned(): boolean {
    // asked every step by someone lying waiting to get up, and it goes through
    // every contact of the trunk: it looks a few times a second
    if (this.t - this.pinnedAt < 0.25) return this.wasPinned;
    this.pinnedAt = this.t;
    const world = this.game.physics.world;
    let load = 0;
    for (const k of ['head', 'upperTorso', 'midTorso', 'lowerTorso'] as LimbKey[]) {
      const l = this.L(k);
      if (l.gone) continue;
      for (const c of l.part.colliders) {
        world.contactPairsWith(c, (o) => {
          const op = this.game.physics.partOf(o);
          if (!op || op.entity === this || op.frozen || op.y < l.part.y) return;
          world.contactPair(c, o, (m) => {
            if (m.numSolverContacts() > 0) load += op.mass;
          });
        });
      }
    }
    this.wasPinned = load > 6;
    return this.wasPinned;
  }

  /**
   * Down, but with the feet planted under a body that's still more or less
   * upright: let go of on their feet, or tipping and not yet over.
   */
  private catching(str: number): boolean {
    if (this.held || this.gaveUp || this.getupFails > 1 || str < 0.6 || this.pain > 0.8 || this.stateT < 0.03 || !this.legsWork()) return false;
    // (dropping onto their feet is fine: they land on them; being thrown sideways isn't)
    const up = this.L('upperTorso').part;
    if (Math.abs(up.vx) > 2.5 || up.vy > 2.5 || up.vy < -4.5) return false;
    // (folded up by a hard landing, the knees can't be straightened in one go: snapped
    // open, a folded leg kicks the body metres into the air. They go down and get up.)
    for (const k of ['lowerLegF', 'lowerLegB'] as LimbKey[]) {
      const l = this.L(k);
      if (!l.gone && l.attached && l.parent && Math.abs(wrapAngle(l.part.bodyAngle - l.parent.part.bodyAngle)) > KNEE_CATCH) return false;
    }
    const col = this.column();
    return col.grounded && Math.abs(col.theta) < 0.45 && Math.abs(col.omega) < 2 && this.grounded(true);
  }

  /** Limbs moving dangerously fast while trying to stand. */
  private flailing(): boolean {
    for (const l of this.order) if (!l.gone && l.attached && Math.hypot(l.part.vx, l.part.vy) > 9) return true;
    return false;
  }

  /**
   * Are the feet on something? With `solid`, other ragdolls don't count (people
   * can't get up while lying on a pile of bodies).
   */
  private grounded(solid = false): boolean {
    const world = this.game.physics.world;
    const ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: -1 });
    for (const k of ['footF', 'footB'] as LimbKey[]) {
      const l = this.L(k);
      if (l.gone || !l.attached) continue;
      ray.origin = { x: l.part.x, y: l.part.y };
      const hit = world.castRay(ray, 0.16, true, undefined, undefined, undefined, undefined, (c) => {
        const p = this.game.physics.partOf(c);
        if (!p) return true;
        if (p.entity === this) return false;
        return !solid || !(p.entity instanceof Human);
      });
      if (hit) return true;
    }
    return false;
  }

  /** First thing (not one of `skip`) straight below a point within `len` m: its part (none for the floor and walls), or null. */
  private below(x: number, y: number, len: number, skip: Entity[]): { part: Part | undefined } | null {
    const hit = this.game.physics.world.castRay(new RAPIER.Ray({ x, y }, { x: 0, y: -1 }), len, true, undefined, undefined, undefined, undefined, (c) => {
      const e = this.game.physics.partOf(c)?.entity;
      return !e || !skip.includes(e);
    });
    return hit ? { part: this.game.physics.partOf(hit.collider) } : null;
  }

  /** Who (a person or an animal) the trunk and legs are lying on, and which of them are (an arm across someone doesn't count). */
  private lyingOn(): { under: Entity | null; on: Part[] } {
    let under: Entity | null = null;
    const on: Part[] = [];
    for (const l of this.order) {
      if (l.gone || !l.attached || !/Torso|Leg|foot/.test(l.spec.key)) continue;
      // under its middle or either end (a heel propped on someone's head), along
      // its length: a foot is long sideways, a leg up and down
      const p = l.part;
      const r = (Math.max(p.w, p.h) / 2 - 2) * PX;
      const [ax, ay] = p.w > p.h ? [Math.cos(p.a), Math.sin(p.a)] : [-Math.sin(p.a), Math.cos(p.a)];
      for (const k of [0, 1, -1]) {
        const e = this.below(p.x + ax * r * k, p.y + ay * r * k, 0.3, [this])?.part?.entity;
        if (!e || !e.canWalk) continue;
        under ??= e;
        if (e === under) on.push(p);
        break;
      }
    }
    return { under, on };
  }

  /**
   * Lying on top of someone (or an animal) who is on the floor: the way to
   * shuffle off onto clear floor, or 0 (not on anyone, hemmed in both ways, or on
   * a heap of bodies: stirring that up only makes it worse).
   */
  private crawlOffDir(): number {
    const { under, on } = this.lyingOn();
    if (!under || !on.length) return 0;
    const theirs = under.parts.filter((p) => !p.destroyed);
    if (theirs.some((p) => this.below(p.x, p.y, 0.3, [this, under])?.part?.entity.canWalk)) return 0;
    // the shorter way to get all of them past the end of whoever it is, onto clear floor
    // (or anything that isn't a body)
    const xs = theirs.map((p) => p.x);
    const lo = Math.min(...xs) - 0.2;
    const hi = Math.max(...xs) + 0.2;
    const mn = Math.min(...on.map((p) => p.x));
    const mx = Math.max(...on.map((p) => p.x));
    const y = on.reduce((s, p) => s + p.y, 0) / on.length;
    const ways = [{ dir: 1, d: hi - mn, edge: hi }, { dir: -1, d: mx - lo, edge: lo }].sort((a, b) => a.d - b.d);
    // (already on the way: keep going rather than turn back)
    if (this.crawlT > 0) ways.sort((a, b) => (b.dir === this.crawlDir ? 1 : 0) - (a.dir === this.crawlDir ? 1 : 0));
    for (const w of ways) {
      const hit = this.below(w.edge + w.dir * 0.3, y + 0.3, 1.2, [this]);
      if (hit && !hit.part?.entity.canWalk) return w.dir;
    }
    return 0;
  }

  /** Shuffles the body along the top of whoever they're lying on, toward the floor. */
  private crawl(dt: number): void {
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      const ax = clamp((this.crawlDir * 0.9 - v.x) * 8, -12, 12);
      l.part.body.applyImpulse({ x: l.part.mass * ax * dt, y: l.part.mass * 4 * dt }, true);
    }
  }

  /** Lying with the feet in the air (a knee left propped up): lets the legs down onto the floor. */
  private lowerFeet(): void {
    for (const k of ['footF', 'footB', 'lowerLegF', 'lowerLegB'] as LimbKey[]) {
      const l = this.L(k);
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      l.part.body.applyImpulse({ x: 0, y: l.part.mass * Math.min(0, -0.6 - v.y) * 0.25 }, true);
    }
  }

  preStep(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    // unfrozen: the joints ease from where they were held into their pose (a pose's
    // easing that ran out while frozen would snap them, and bent legs kick them into the air)
    const frozen = this.parts.some((p) => p.frozen);
    if (this.wasFrozen && !frozen) {
      this.easeFrom(SETTLE_T);
      this.updateMotors(true);
    }
    this.wasFrozen = frozen;
    this.catchT -= dt;
    const str = this.strength();
    const conscious = str > 0.15;

    // ---- state machine
    // (how the body stands over its feet: worked out when wanted, which someone
    // lying down only does when about to get up)
    let colNow: Column | null = null;
    const column = () => (colNow ??= this.column());
    // (sitting in a vehicle is lying down as far as getting up goes: they stay put)
    // (nor sitting on the floor or lying flat out, posed: see setPose())
    if (!conscious || this.held || this.seat || this.pose === 'sit' || this.pose === 'flat') {
      if (this.state !== 'down') this.setState('down');
    } else if (this.state === 'stand' || this.state === 'getup') {
      const col = column();
      this.airT = col.grounded ? 0 : this.airT + dt;
      const tilt = Math.abs(col.theta);
      // only standing for a while counts as having got up (not toppling off a pile again)
      if (this.state === 'stand' && this.stateT > 3) this.getupFails = this.retries = this.crawls = 0;
      this.landT += dt;
      if (!this.legsWork()) this.setState('down');
      else if (this.climbing || this.jumping) {
        // carried along by the climb, or in the air: only a real tumble (knocked
        // over on the way) ends it
        this.airT = 0;
        if (Math.abs(wrapAngle(this.L('upperTorso').part.a)) > 1.1) this.setState('down');
      } else if (this.state === 'stand' && (tilt > (this.landT < 0.5 ? 0.9 : this.stumbling ? 0.8 : 0.62) || this.airT > (this.landT < 0.6 ? 0.6 : 0.35))) {
        if (this.stateT < 3) this.failGetup();
        else this.setState('down');
      } else if (this.state === 'getup' && this.flailing()) {
        // something is stopping the body from rising (pinned, tangled): give up
        this.failGetup();
      } else if (this.state === 'getup') {
        // keep trying while making progress
        if (tilt < this.getupBest - 0.05) {
          this.getupBest = tilt;
          this.getupProgressT = this.stateT;
        }
        if (tilt < 0.2 && col.grounded && this.stateT > 0.5) this.setState('stand'); else if (this.stateT - this.getupProgressT > 2.5 || this.stateT > 7) {
          this.failGetup();
        }
      }
    } else if (this.state === 'down') {
      const up = this.L('upperTorso').part;
      const rest = Math.hypot(up.vx, up.vy) < 0.6;
      // (in a fight, or on a team, they're quicker to be back up)
      const wait = ((this.foe || this.team ? 1.2 : 2.2) + this.getupFails * 1.5 + this.pain * 4) / this.rush;
      if (this.gaveUp && this.retries < 2 && Math.hypot(up.x - this.gaveUp.x, up.y - this.gaveUp.y) > 0.4) this.retry();
      // lying across someone: shuffle off onto the floor first (nobody gets up off a
      // body), looking a few times a second whether they're on (or still on) anyone
      this.crawlCheck -= dt;
      const look = this.crawlCheck <= 0;
      if (look) this.crawlCheck = 0.25;
      // (in water too deep to stand in, they swim, and that's all; with a shore to make
      // for, they swim and crawl right out of it: lying in the shallows, the water drags
      // at them too much to get up. See breathe())
      if (this.treading && (this.breath.depth > STAND_DEPTH || shoreward(this.game, up.x) !== 0)) this.crawlT = 0;
      else if (this.crawlT > 0) {
        this.crawlT -= dt;
        // off them, or getting nowhere (wedged in among them): stop
        if (look) {
          const x = this.L('midTorso').part.x;
          this.crawlStuck = Math.abs(x - this.crawlX) < 0.04 ? this.crawlStuck + 1 : 0;
          this.crawlX = x;
        }
        if (look && (this.crawlStuck >= 3 || !this.crawlOffDir())) this.crawlT = 0;
        else this.crawl(dt);
      } else if (look && !this.gaveUp && this.crawls < 4 && this.stateT > 1.2 && rest && str > 0.7 && this.legsWork() && !this.pinned() && (this.crawlDir = this.crawlOffDir())) {
        this.crawlT = 3;
        this.crawls++;
        this.crawlX = this.L('midTorso').part.x;
        this.crawlStuck = 0;
        this.stateT = Math.min(this.stateT, 1);
      } else if ((look || this.catchT > 0) && this.catching(str)) {
        // still on their feet, more or less (let go of upright, or caught mid-tip):
        // straighten up again instead of lying down first
        const tilt = Math.abs(column().theta);
        // (on their feet and tipping, they can step to catch it: see stumbleSpeed())
        if (tilt < 0.45) {
          this.setState('stand');
          this.easeFrom(SETTLE_T);
        } else {
          this.getupBest = tilt;
          this.getupProgressT = 0;
          this.setState('getup');
        }
      } else if (!this.gaveUp && this.stateT > wait && rest && this.legsWork() && str > 0.7 && this.pain < 0.6 && !this.pinned()) {
        const col = column();
        if (col.grounded && this.grounded(true)) {
          this.getupBest = Math.abs(col.theta);
          this.getupProgressT = 0;
          this.setState('getup');
        } else if (!col.grounded && !this.feetT && look && !this.lyingOn().under) {
          // on the floor with the feet up in the air: let the legs down first (once each time they go down)
          this.feetT = 1e-3;
        }
        if (this.feetT > 0 && this.feetT < 1.5) {
          this.feetT = Math.min(1.5, this.feetT + dt);
          this.lowerFeet();
        }
      }
    }

    // ---- what to do on its feet
    this.climbCool -= dt;
    if (this.settleFrom && (this.settleT += dt) > this.settleDur) this.settleFrom = null;
    if (conscious && this.state === 'stand' && !this.held && this.climbing) this.climb(dt);
    else if (conscious && this.state === 'stand' && !this.held && this.jumping) this.jumpStep(dt, column().grounded);
    else if (conscious && this.state === 'stand' && !this.held) this.think(dt);
    else {
      this.speed = 0;
      this.goalT -= dt;
    }
    // dropped writhing on the floor by the flames, extinguisher in hand: they spray
    // themselves all the same (and otherwise, off their feet or on to something else,
    // the lever is let go)
    const ext = conscious && this.state !== 'stand' && !this.held && this.grips.length ? this.extinguisher() : null;
    if (ext && this.order.some((l) => !l.gone && l.part.burning > 0.02)) this.sprayOwn(ext, dt);
    else if (this.dousing && (this.goal !== 'douse' || this.state !== 'stand' || !conscious || this.held)) this.stopDousing();
    // posed (see setPose()): lurching about, or sitting up
    if (conscious && !this.held && this.pose === 'stumble' && this.state === 'stand' && !this.climbing && !this.jumping) this.lurch(dt);
    else if (conscious && !this.held && this.pose === 'sit' && !this.seat) this.sitUp(dt);
    // fighting: knocked out (or killed), it's over for them; the punch or swing
    // under way is lost when knocked off their feet
    if (this.foe && !stillUp(this)) this.stopFighting();
    // knocked down and kept down as long as the foe waits over them (see closeIn()):
    // beaten, it's over for them too (up again, they'd only go at it once more)
    this.downT = this.foe && this.state !== 'stand' ? this.downT + dt : 0;
    if (this.downT > FIGHT.beaten) this.stopFighting();
    if (this.blow) {
      if (conscious && this.state === 'stand' && !this.held && !this.climbing && !this.jumping) this.strike(dt);
      else this.blow = null;
    }
    if (this.freed && (this.blow?.item?.main !== this.freed.part || this.blowStage(this.blow).stage !== 'back')) this.freeWeapon(null);
    this.blowT -= dt;

    // ---- muscles
    this.motorTimer -= dt;
    // stepping legs follow their gait every step, and easing into a pose (or throwing a blow) goes smoothly
    if (this.motorTimer <= 0 || this.gaitAmt > 0 || this.settleFrom || this.blow || this.easingFists) {
      this.motorTimer = 0.05;
      this.updateMotors(false);
    }

    if (this.grips.length && this.state === 'stand' && conscious) this.aim(str, dt);

    // ---- balance
    const flying = this.jumping && this.jumping.t >= 0 && this.jumping.landed < 0;
    if ((this.state === 'stand' || this.state === 'getup') && conscious && column().grounded && !this.climbing && !flying) {
      if (this.state === 'getup') {
        const ramp = clamp(this.stateT / 1.2, 0, 1);
        this.balance(column(), 16 * str, 9 * str, 4 + 14 * ramp, dt);
      } else {
        // (stumbling, everything goes into staying up: arms out, bent at the hips; but
        // posed to Stumble, they can't keep their balance well)
        const s = (this.stumbling ? BALANCE.stumble : 1) * (this.pose === 'stumble' ? 0.6 : 1);
        this.balance(column(), BALANCE.kp * str * s, BALANCE.kd * str * s, BALANCE.amax * s, dt);
      }
    }
    // (only someone on their feet walks)
    this.walk(dt, this.state === 'stand' && column().grounded);
  }

  // ---------------------------------------------------------------- getting about

  /**
   * Decides where to go while standing: someone left alone stays put, unless set
   * to wander about; anyone runs from blasts, gunfire and fire nearby (except
   * someone holding something, who stands their ground).
   */
  private think(dt: number): void {
    this.goalT -= dt;
    this.turnT -= dt;
    this.lookT -= dt;
    const c = this.L('upperTorso').part;
    const look = this.lookT <= 0;
    if (look) {
      this.lookT = 0.1 / this.rush;
      this.climbWait = false;
      const fire = this.grips.length ? null : this.game.fire.near(c.x, c.y, 2, this);
      if (fire) this.scare(fire.x, 2.5);
    }
    // cowering, they stay where they are, whatever happens
    if (this.pose === 'cower') {
      this.speed = 0;
      this.stumbling = false;
      return;
    }
    // on a team (or a zombie): an eye out for the enemy to go for (and the next, once one is beaten)
    if ((this.team || this.zombie) && (this.scanT -= dt) <= 0) this.scan(c);
    // a fire extinguisher in hand, and no fight on: an eye out for a fire to put out
    if (this.goal !== 'fight' && (this.fireT -= dt) <= 0) this.spotFire(c);
    // tipping further than standing still can hold (shoved, bumped, let go of
    // mid-swing): they step the way they're falling until the feet are back under them
    // (in a fight, stepping back rather than turning their back on the foe; and never
    // off a drop too deep to climb down: they'd rather go over where they stand)
    const lean = this.stumbleSpeed();
    if (lean && (look || !this.stumbling)) this.edgeStep = this.dropAhead(Math.sign(lean)) > CLIMB.down;
    if (lean && !this.edgeStep && (Math.sign(lean) === this.f || this.goal === 'fight' || this.turn())) {
      this.stumbling = true;
      this.speed = Math.sign(lean) === this.f ? Math.abs(lean) : -Math.abs(lean);
      return;
    }
    this.stumbling = false;
    let speed = 0;
    if (this.goal === 'flee') {
      if (this.goalT <= 0) this.rest();
      else speed = (Math.sign(c.x - this.fleeFrom) || this.f) * GAIT.run * this.rush;
    } else if (this.goal === 'walk') {
      const dx = this.targetX - c.x;
      if (Math.abs(dx) < 0.25 || this.goalT <= 0) this.rest();
      else speed = Math.sign(dx) * GAIT.walk * this.rush * clamp(Math.abs(dx) / 0.8, 0.5, 1);
    } else if (this.goal === 'fight') {
      speed = this.closeIn(c, dt);
      // stepping back from the foe, still facing them: no turning round, and only
      // with room behind (looked for a few times a second)
      if (this.backstep && speed) {
        if (look) this.backClear = !this.blockedAhead(true, 0.12) && this.dropAhead(-this.f) < 0.35;
        this.speed = this.backClear ? -Math.abs(speed) : 0;
        this.stuckT = 0;
        return;
      }
      // on the way to the foe: a drop to get down, a gap to leap, someone lying in the
      // way to jump (see route(): worked out as they look, and kept to until the next look)
      if (speed && Math.sign(speed) === this.f) {
        if (look) this.approach = this.route(speed);
        if (this.approach !== null) {
          this.speed = Math.min(Math.abs(speed), this.approach);
          this.stuckT = 0;
          return;
        }
      } else this.approach = null;
    } else if (this.goal === 'douse') speed = this.douse(c, dt);
    else if (this.goalT <= 0 && this.wander) this.decide();
    // people walk forwards: facing the wrong way, turn round first
    if (speed && Math.sign(speed) !== this.f && !this.turn()) {
      // no room to turn (someone at their heels): after a while, give up and go
      // some other time (running scared, keep trying)
      this.turnWait += dt;
      if (this.turnWait > 1.5 && this.goal !== 'flee') {
        this.blocked = Math.sign(speed);
        this.halt();
      }
      speed = 0;
    } else this.turnWait = 0;
    // someone ahead going the same way: fall in behind them at their pace
    // (until they next look, too)
    if (speed && (look ? this.blockedAhead() && this.blockerPace() > 0.3 : this.pacing > 0)) {
      if (look) {
        this.pacing = this.blockerPace() * 0.9;
        this.cornered = false;
      }
      speed = Math.sign(speed) * Math.min(Math.abs(speed), this.pacing);
    } else if (speed && look && Math.sign(speed) === this.f && (this.blockedAhead() ? this.climbUp() : this.dropAhead() > 0.35 && this.climbDown())) {
      // a box or a step in the way, or a ledge to get down off: climbing (see climb())
      this.pacing = 0;
      this.cornered = false;
      return;
    } else if (speed && this.climbCool > 0 && (look ? this.blockedAhead() || this.dropAhead() > 0.35 : this.climbWait)) {
      // just climbed: find their feet a moment before going on (or up, or down)
      this.climbWait = true;
      this.speed = 0;
      return;
    } else if (speed && (look ? this.blockedAhead() || this.dropAhead() > 0.35 || this.cliffAhead(Math.abs(speed)) : this.cornered)) {
      this.pacing = 0;
      // something in the way, or a drop: stop short of it (running scared, keep looking
      // for a way; in a fight, wait there a while: see melee() and gunfight(). Kept
      // stopped until the next look either way: going on in between, they'd creep
      // on over the edge a little at a time)
      this.blocked = this.f;
      speed = 0;
      if (this.goal === 'flee') this.cornered = true;
      else if (this.goal === 'fight') {
        this.cornered = true;
        // (the foe in the way, or the weapon they hold out: there already, see melee())
        if (!this.ofFoe(this.blocker)) {
          this.noWayT = 1;
          this.noWayDir = this.f;
        }
      } else this.halt();
    } else if (look) {
      this.cornered = false;
      this.pacing = 0;
    }
    // walked into something that the eyes missed: give up and try elsewhere later
    this.stuckT = speed && this.trunkVx() < Math.abs(speed) * 0.25 ? this.stuckT + dt : 0;
    if (this.stuckT > 2) {
      this.stuckT = 0;
      this.blocked = Math.sign(speed);
      speed = 0;
      this.halt();
    }
    this.speed = Math.abs(speed);
  }

  /** Done standing about (when wandering): off a few meters somewhere, or a while longer here. */
  private decide(): void {
    const c = this.L('upperTorso').part;
    // standing on a heap of bodies they stay put rather than stir it all up again
    if (!this.grounded(true)) {
      this.rest();
      this.goalT += 5 + Math.random() * 10;
      return;
    }
    if (Math.random() < 0.65) {
      let dir = this.blocked ? -this.blocked : Math.random() < 0.5 ? -1 : 1;
      this.blocked = 0;
      if (!this.clearTo(dir)) dir = -dir;
      if (!this.clearTo(dir)) {
        this.rest();
        this.goalT += 5 + Math.random() * 10;
        return;
      }
      const dist = 1.5 + Math.random() * 4;
      this.goal = 'walk';
      this.targetX = clamp(c.x + dir * dist, WORLD.left + 2, WORLD.right - 2);
      this.goalT = 6 + dist * 2;
    } else this.rest();
  }

  /** Sends them walking to x (context menu, scripts and tests); they get there if nothing is in the way. */
  goTo(x: number): void {
    this.goal = 'walk';
    this.targetX = clamp(x, WORLD.left + 1, WORLD.right - 1);
    this.goalT = 6 + Math.abs(x - this.L('upperTorso').part.x) * 2;
  }

  /** Stands still for `secs` seconds (scripts and tests). */
  stay(secs: number): void {
    this.rest();
    this.goalT = secs;
  }

  /** Facing left (-1) or right (1). */
  get facing(): 1 | -1 {
    return this.f;
  }

  get canWalk(): boolean {
    return true;
  }

  get upright(): boolean {
    return this.alive && this.state !== 'down';
  }

  /** Walking or running about. */
  get moving(): boolean {
    return this.gaitAmt > 0;
  }

  private rest(): void {
    this.goal = 'idle';
    this.goalT = this.wander ? 2 + Math.random() * 6 : 4 + Math.random() * 10;
  }

  /** Stopped by something in the way: stand about for a while (in a fight, they wait for their chance). */
  private halt(): void {
    if (this.goal !== 'fight') this.rest();
  }

  /**
   * Sets them on `foe` (someone, or some animal): they run at it and punch, or
   * swing what they hold, or with a gun shoot from a way off, until it's dead or
   * out cold (waiting while it's down). `back`: the foe fights back.
   */
  fight(foe: Entity, back = true): boolean {
    // (never one of their own side: see Teams)
    if (foe === this || !this.alive || !isLiving(foe) || !foe.alive || allies(this, foe)) return false;
    this.foe = foe;
    this.goal = 'fight';
    // (a win in an earlier fight doesn't count towards this one)
    this.foeDownT = 0;
    // (sizing each other up: they don't swing at the same moment)
    this.blowT = 0.2 + Math.random() * 0.6;
    this.shotT = 0.3 + Math.random() * 0.5;
    // (a gun is steadied on someone new a moment before the first shot)
    this.aimT = 0;
    this.aimNeed = SHOT.settle + Math.random() * SHOT.settleJitter;
    this.closing = false;
    // (a way to someone new is looked for afresh)
    this.noWayT = this.detourT = this.wayT = 0;
    if (back && isFighter(foe) && !foe.foe) foe.fight(this, false);
    return true;
  }

  /** Leaves off fighting. */
  stopFighting(): void {
    const was = this.goal === 'fight';
    this.foe = null;
    this.blow = null;
    this.easingFists = false;
    this.fightPose.clear();
    this.swingAt = null;
    this.combo = false;
    this.fetch = null;
    this.evadeT = 0;
    this.approach = null;
    this.noWayT = this.detourT = 0;
    // (on a team, they look for the next straight away)
    this.scanT = 0;
    if (!was) return;
    this.rest();
    // fists lowered gently (snapped back down, they'd whip about)
    if (this.state === 'stand' && !this.destroyed) this.easeFrom(0.4);
  }

  /**
   * On a team: looks about for the enemy to go for (see Teams.nearestEnemy()) and
   * goes for it, unless already fighting one about as near (or someone they were
   * set on who isn't on another side: they see that through). Empty-handed against
   * someone armed, they'll pick up a weapon lying close by first.
   */
  private scan(c: Part): void {
    this.scanT = SCAN.every * (0.7 + Math.random() * 0.6);
    const foe = this.foe;
    // (no way to get at the one they're after, for now: rather someone else)
    const stuck = this.noWayT > 0 && !this.grips.some((g) => isGun(g.item)) ? foe : null;
    const e = nearestEnemy(this, c.x, c.y, SCAN.sight, stuck);
    if (e && e !== foe) {
      const up = !!foe && stillUp(foe);
      const swap = !foe || !up || (stuck !== null && enemies(this, foe)) || (enemies(this, foe) && ((!onFeet(foe as Fighter) && onFeet(e)) || Math.abs(e.center().x - c.x) + SCAN.switch < Math.abs(foe.center().x - c.x)));
      if (swap) this.fight(e, false);
    }
    const now = this.foe;
    if (now instanceof Human && now.grips.length && !this.grips.length && !this.fetch && !this.zombie && Math.abs(now.center().x - c.x) > 2.5) {
      this.fetch = lyingNear(this.game, c.x, c.y, SCAN.fetch, isWeapon);
      this.fetchT = 0;
    }
  }

  /**
   * Puts something to hold straight into a free hand (the front one first): soldiers
   * armed for a battle (see ArmyPanel), a weapon picked up in a fight. Whether they did.
   */
  take(item: Item): boolean {
    if (!this.alive || this.zombie || this.destroyed || item.destroyed || item.holder || !item.hold) return false;
    const hand = (['handF', 'handB'] as LimbKey[]).find((k) => this.ok(k) && !this.handBusy(this.L(k)) && !this.L(k).part.frozen);
    if (!hand) return false;
    let it = item;
    // (items always face the way the person faces)
    if (it.flipped !== this.flipped) {
      const flipped = this.game.flipEntity(it) as Item | null;
      if (!flipped) return false;
      it = flipped;
    }
    this.attach(it, this.L(hand));
    return true;
  }

  /**
   * Fighting: goes for the foe and, near enough, faces it and fights: hand to hand
   * (see melee()), or with a gun from the distance it's fired from (see gunfight()).
   * Gets away from a lit bomb or a fire by them first, waits while the foe is down,
   * and stops once it's out of it. Returns the speed wanted, in the world's x
   * (see backstep: stepping back from the foe, still facing them).
   */
  private closeIn(c: Part, dt: number): number {
    const foe = this.foe;
    this.backstep = false;
    // (knocked down and staying down: beaten)
    this.foeDownT = foe && isLiving(foe) && !onFeet(foe) ? this.foeDownT + dt : 0;
    // (a zombie goes on at them, down or out cold, until they're dead or bitten)
    if (!foe || !stillUp(this) || (this.zombie ? foe.destroyed || !isLiving(foe) || !foe.alive || undead(foe) : !stillUp(foe) || this.foeDownT > FIGHT.beaten)) {
      this.stopFighting();
      return 0;
    }
    if (this.zombie) return this.maul(c, foe, dt);
    this.shotT -= dt;
    // a lit bomb whose blast would reach them, or fire right by them: away from it first
    if ((this.dangerT -= dt) <= 0) {
      this.dangerT = 0.25;
      const x = this.danger(c);
      if (x !== null) {
        this.evadeT = 1.5 + Math.random();
        this.evadeX = x;
        this.blow = null;
      }
    }
    if (this.evadeT > 0) {
      this.evadeT -= dt;
      return (Math.sign(c.x - this.evadeX) || -this.f) * GAIT.run * this.rush;
    }
    this.noWayT -= dt;
    // off round another way down to the foe (see wayDown()): until they're down it
    if (this.detourT > 0) {
      this.detourT -= dt;
      const d = this.detourX - c.x;
      if (Math.abs(d) > 0.3 && c.y > this.detourY - 0.3) return Math.sign(d) * GAIT.walk * this.rush;
      this.detourT = 0;
    }
    const dx = foe.center().x - c.x;
    const dir = Math.sign(dx) || this.f;
    const gun = this.grips.find((g) => isGun(g.item))?.item as (Item & { fire(): void }) | undefined;
    if (gun) return this.gunfight(gun, foe, Math.abs(dx), dir, dt);
    const held = this.grips[0]?.item ?? null;
    // (empty-handed against someone armed: the weapon lying close by they're going for)
    if (!held && this.fetch) {
      const s = this.fetching(c, dt);
      if (s !== null) return s;
    }
    return this.melee(held, foe, Math.abs(dx), dir, dt);
  }

  /** How much higher (m) the foe stands than they do: the lowest of each (the feet, or whatever they lie on). */
  private standsAbove(foe: Entity): number {
    let a = Infinity;
    for (const p of foe.parts) if (!p.destroyed && p.y < a) a = p.y;
    let b = Infinity;
    for (const l of this.order) if (!l.gone && l.attached && l.part.y < b) b = l.part.y;
    return a < Infinity && b < Infinity ? a - b : 0;
  }

  /** No way on toward the foe that way (a drop, a wall, seen a moment ago: see think())? */
  private noWay(dir: number): boolean {
    return this.noWayT > 0 && this.noWayDir === dir;
  }

  /** A lit bomb whose blast would reach them, or fire right by them: where it is (x), or null. */
  private danger(c: Part): number | null {
    const bomb = bombNear(this.game, c.x, c.y, this);
    if (bomb !== null) return bomb;
    const fire = this.game.fire.near(c.x, c.y - 0.5, 1.1, this);
    return fire ? fire.x : null;
  }

  /** On the way to pick up a weapon: the speed to go at (0 as it's picked up), or null once there's none to get. */
  private fetching(c: Part, dt: number): number | null {
    const it = this.fetch!;
    this.fetchT += dt;
    if (it.destroyed || it.holder || this.fetchT > 5) {
      this.fetch = null;
      return null;
    }
    const dx = it.main.x - c.x;
    if (Math.abs(dx) > 0.4) return Math.sign(dx) * GAIT.run * this.rush;
    // (stooping for it is left out: it's in hand)
    this.fetch = null;
    this.take(it);
    return 0;
  }

  /**
   * Hand to hand: comes to just out of the foe's reach and waits there; steps in to
   * strike (with a weapon, from as far as it reaches; with fists from close up:
   * punches, now and then two in a row, and kicks), and steps back out after. Waits
   * while the foe is down. With no way on to them (down a drop too deep, across a
   * gap too wide, up a wall), waits there shaking a fist at them, or goes round
   * another way down if there is one. Returns the speed wanted.
   */
  private melee(held: Item | null, foe: Entity, ad0: number, dir: number, dt: number): number {
    const strike = held ? this.strikeRange(held, foe) : FIGHT.reach;
    const ready = strike + FIGHT.stepOut;
    // (standing higher or lower than them, up on a box or down off a ledge: further to go)
    const up = this.standsAbove(foe);
    const ad = Math.abs(up) > 0.5 ? ad0 + Math.abs(up) : ad0;
    if (ad > strike && this.noWay(dir)) {
      if (dir !== this.f) {
        this.turn();
        return 0;
      }
      if (!this.blow && (this.tauntT -= dt) <= 0) {
        this.tauntT = 2 + Math.random() * 3;
        this.throwBlow(held);
      }
      // up high with them down below: another way down, looked for every so often
      if (up < -0.6 && (this.wayT -= dt) <= 0) {
        this.wayT = 2.5;
        const x = this.wayDown(-dir);
        if (x !== null) {
          this.detourX = x;
          this.detourY = this.L('upperTorso').part.y;
          this.detourT = 10;
          this.noWayT = 0;
          this.blow = null;
        }
      }
      return 0;
    }
    if (ad > ready + 0.4) {
      this.combo = false;
      // (a moment's wait once there, different every time: two coming together don't strike as one)
      if (this.blowT < 0.1) this.blowT = 0.1 + Math.random() * 0.5;
      return dir * (ad > ready + 1.5 ? GAIT.run : GAIT.walk) * this.rush;
    }
    if (dir !== this.f) {
      this.turn();
      return 0;
    }
    const b = this.blow;
    // winding up a swing: in onto them as it's drawn back (a punch or a kick is thrown standing)
    if (b) return b.item && b.t < b.dur * b.wind && ad > strike && !this.noWay(dir) ? dir * FIGHT.lunge * this.rush : 0;
    if (this.blowT > 0 || !onFeet(foe as Fighter)) {
      // between blows: back out to just beyond the foe's reach (another punch coming straight after: stay)
      if (this.combo) return 0;
      if (ad < ready - 0.2) {
        this.backstep = true;
        return -dir * FIGHT.back * this.rush;
      }
      return ad > ready + 0.2 ? dir * GAIT.walk * 0.6 * this.rush : 0;
    }
    // stepping in to strike (the foe in the way counts as near enough: walking on, they'd stop short of them)
    if (ad > strike + 0.1 && !(ad < strike + 0.6 && this.blockedAhead() && this.ofFoe(this.blocker))) return dir * GAIT.walk * this.rush;
    // too near to swing a weapon at: a step back first (if there's room behind)
    if (held && ad < strike - 0.4 && this.backClear) {
      this.backstep = true;
      return -dir * FIGHT.back * this.rush;
    }
    this.combo = false;
    this.throwBlow(held);
    return 0;
  }

  /**
   * A zombie going for someone: it shambles up to them (near enough to lunge at someone
   * on their feet; over the middle of someone lying down) and lunges, an arm out to grab
   * and the head in to bite (see bite()), down or not, until they're bitten. Returns the
   * speed wanted.
   */
  private maul(c: Part, foe: Entity, dt: number): number {
    this.noWayT -= dt;
    const dx = foe.center().x - c.x;
    const dir = Math.sign(dx) || this.f;
    const up = this.standsAbove(foe);
    const low = isLiving(foe) && !onFeet(foe);
    let ad = Math.abs(dx) + (Math.abs(up) > 0.5 ? Math.abs(up) : 0);
    // (someone lying down is bitten wherever is nearest: the whole length of them is in reach,
    // and their middle may be past their legs, which are in the way)
    if (low) for (const p of foe.parts) if (!p.destroyed) ad = Math.min(ad, Math.abs(p.x - c.x));
    const reach = low ? ZOMBIE.reach * 0.6 : ZOMBIE.reach;
    if (this.blow) return 0;
    // (the foe in the way counts as near enough: walking on, it would stop short of them)
    if (ad > reach + 0.15 && !(ad < reach + 0.6 && this.blockedAhead() && this.ofFoe(this.blocker))) return this.noWay(dir) ? 0 : dir * GAIT.walk * this.rush;
    if (dir !== this.f) {
      this.turn();
      return 0;
    }
    if (this.blowT <= 0) this.lunge(low);
    return 0;
  }

  /** A zombie's lunge: an arm thrown out to grab (one and then the other), bending right down to someone on the floor. */
  private lunge(low: boolean): void {
    const free = (['F', 'B'] as const).filter((s) => this.ok(`hand${s}`));
    const side = free.length > 1 ? (this.lastFist === 'F' ? 'B' : 'F') : free[0] ?? 'F';
    this.lastFist = side;
    const vary = 0.85 + Math.random() * 0.3;
    this.blow = { t: 0, dur: 0.75 * vary, side, item: null, kick: false, landed: false, wind: 0.4, out: 0.3, aim: low ? 'chest' : 'head', bite: true };
  }

  /** Aiming what they hold (tipped by `tilt`): at the foe, or at a fire. */
  private get aiming(): boolean {
    return this.goal === 'fight' || this.goal === 'douse';
  }

  /** The fire extinguisher in their hand, if they hold one. */
  private extinguisher(): Item | null {
    return this.grips.find((g) => g.item.def.id === 'fire-extinguisher' && !g.item.destroyed)?.item ?? null;
  }

  /** With an extinguisher in hand: the fire to put out (on themselves first, else the nearest about them), and off to it. */
  private spotFire(c: Part): void {
    this.fireT = DOUSE.every;
    let fire: Part | null = null;
    if (this.extinguisher()) {
      fire = this.order.find((l) => !l.gone && l.attached && l.part.burning > 0.05)?.part ?? null;
      const p = fire ? null : this.game.fire.near(c.x, c.y, DOUSE.sight, this);
      if (p && Math.abs(p.y - c.y) < DOUSE.rise) fire = p;
    }
    this.fireAt = fire;
    if (fire) this.goal = 'douse';
    else if (this.goal === 'douse') this.rest();
  }

  /**
   * Putting out a fire with the extinguisher in hand: up to it, facing it, they spray it
   * (aimed at it) until it's out. On fire themselves, they spray at their own feet and the
   * cloud billows up over them (the spray itself passes by whoever holds it). Returns the
   * speed wanted.
   */
  private douse(c: Part, dt: number): number {
    const ext = this.extinguisher();
    const p = this.fireAt;
    if (!ext || !p || p.destroyed || p.burning <= 0.02) {
      this.stopDousing();
      // (another fire, or none: looked for at once)
      this.fireT = 0;
      return 0;
    }
    const own = p.entity === this;
    const dx = p.x - c.x;
    const dir = own ? this.f : Math.sign(dx) || this.f;
    if (!own && Math.abs(dx) > DOUSE.reach) {
      this.stopDousing();
      return dir * GAIT.walk * this.rush;
    }
    if (dir !== this.f) {
      this.stopDousing();
      this.turn();
      return 0;
    }
    const m = ext.main;
    const tx = own ? m.x + this.f * 0.5 : p.x;
    const ty = own ? c.y - 1.3 : p.y;
    this.tilt = clamp(Math.atan2(ty - m.y, Math.max(0.2, Math.abs(tx - m.x))), -0.7, 0.7);
    if (own) this.sprayOwn(ext, dt);
    else this.spray(ext);
    return 0;
  }

  /** On fire with an extinguisher in hand, standing or on the floor: they spray themselves, and the cloud billowing up over them damps their flames. */
  private sprayOwn(ext: Item, dt: number): void {
    this.spray(ext);
    for (const l of this.order) if (!l.gone && l.part.burning > 0) this.game.fire.douse(l.part, DOUSE.self * dt);
  }

  /** The extinguisher's lever held down. */
  private spray(ext: Item): void {
    if (this.dousing === ext) return;
    this.stopDousing();
    this.dousing = ext;
    ext.setActiveHeld(true);
  }

  /** The extinguisher's lever let go. */
  private stopDousing(): void {
    if (this.dousing && !this.dousing.destroyed) this.dousing.setActiveHeld(false);
    this.dousing = null;
  }

  /** Is this (in the way) the foe, or something they hold? */
  private ofFoe(p: Part | null): boolean {
    return !!p && !!this.foe && (p.entity === this.foe || (p.entity as { holder?: unknown }).holder === this.foe);
  }

  /** How near (trunk to trunk) they come to swing a weapon at the foe: its far part meets their head with the arm thrown out. */
  private strikeRange(item: Item, foe: Entity): number {
    const r = weaponReach(item) * SWING.sweet;
    // (an animal's head, lower down: the weapon comes down onto it from nearer)
    const dy = strikePoint(foe).y - this.L('upperTorso').part.y - 0.1;
    return SWING.arm + Math.sqrt(Math.max(0, r * r - dy * dy));
  }

  /**
   * With a gun: walks in to within its range (see RANGE), steps back from a foe come
   * nearer than it's best fired at (and right away from one in a launcher's blast),
   * faces them and shoots. Returns the speed wanted.
   */
  private gunfight(gun: Item & { fire(): void }, foe: Entity, ad: number, dir: number, dt: number): number {
    // (a launcher's blast reaches back: shot from further off, and backed away from a foe come nearer than that)
    const clear = 'standOff' in gun ? (gun as { standOff(): number }).standOff() : 0;
    if (clear) {
      if (ad < clear) this.backOff = true;
      else if (ad > clear + 1) this.backOff = false;
      if (this.backOff) return -dir * GAIT.run * this.rush;
    }
    // (its own range if it has one, kept clear of a blast made bigger in Edit gun…)
    const [near, own] = RANGE[gun.def.id] ?? (clear ? [0, Math.max(FIGHT.shoot, clear + 2)] : RANGE_ANY);
    const far = Math.max(own, clear + 2);
    // beyond its range: in until well inside it (no way on to them: shot at from where they are)
    if (ad > far) this.closing = true;
    else if (ad < far - 1) this.closing = false;
    if (this.closing && !this.noWay(dir)) return dir * (ad > far + 2 ? GAIT.run : GAIT.walk) * this.rush;
    if (dir !== this.f) {
      this.turn();
      return 0;
    }
    this.shoot(gun, foe, dt);
    // too near for it: a few steps back, still facing them (right on top of them, they just shoot)
    if (ad < near && ad > 1.2) {
      this.backstep = true;
      return -dir * FIGHT.back * this.rush;
    }
    return 0;
  }

  /**
   * Aims at the foe (the body mostly, now and then the head; where they'll be by
   * the time the shot gets there, and above them for a slow shot that drops on its
   * way) and fires once the gun has been steady on them a moment, unless one of
   * their own side is in the line of fire.
   */
  private shoot(gun: Item & { fire(): void }, foe: Entity, dt: number): void {
    const m = gun.main;
    const p = this.aimPart(foe);
    const at = p ?? foe.center();
    let tx = at.x;
    let ty = at.y;
    const v = shotSpeed(gun);
    if (p && v < Infinity) {
      const t = Math.hypot(tx - m.x, ty - m.y) / v;
      tx += p.vx * t;
      ty += p.vy * t;
    }
    const x = Math.abs(tx - m.x);
    const y = ty - m.y;
    let angle = Math.atan2(y, x);
    if ('projectileSpeed' in gun && v < Infinity) {
      // (the low arc that comes down on them; out of reach, as far as it'll go; floating, straight at them)
      const g = -this.game.gravity;
      const disc = v ** 4 - g * (g * x * x + 2 * y * v * v);
      if (g > 0.05) angle = disc >= 0 ? Math.atan2(v * v - Math.sqrt(disc), g * x) : Math.PI / 4;
    }
    const want = clamp(angle + this.aimErr, -0.7, 0.7);
    // (the gun's weight holds it a little under where it's aimed: aimed that much higher)
    const off = wrapAngle(this.f * ((gun.hold?.angle ?? 0) + want) - m.body.rotation());
    this.aimTrim = clamp(this.aimTrim + off * this.f * dt * SHOT.trim, -0.3, 0.3);
    this.tilt = clamp(want + this.aimTrim, -0.7, 0.7);
    const err = Math.abs(off);
    this.aimT = err < SHOT.steady ? this.aimT + dt : 0;
    if (this.shotT > 0 || err > SHOT.fire || this.aimT < this.aimNeed) return;
    if (this.friendInWay(gun, Math.hypot(x, y) + 0.3)) {
      this.shotT = 0.15;
      return;
    }
    gun.fire();
    this.shotT = (SHOT.pause + Math.random() * SHOT.jitter) / this.rush;
    // (the next once it's steady again: at the body mostly, and a little off, maybe)
    this.aimNeed = 0.1;
    this.aimSpot = Math.random() < SHOT.head ? 'head' : Math.random() < 0.6 ? 'chest' : 'belly';
    this.aimErr = (Math.random() + Math.random() - 1) * SHOT.spread;
  }

  /** The part of the foe a shot goes for (an animal's chest for the body), or null if there's none of it left. */
  private aimPart(foe: Entity): Part | null {
    const want = this.aimSpot === 'head' ? 'Head' : this.aimSpot === 'chest' ? 'Upper torso' : 'Middle torso';
    let body: Part | null = null;
    for (const p of foe.parts) {
      if (p.destroyed) continue;
      if (p.name === want) return p;
      if (p.name === 'Chest' || p.name === 'Upper torso') body = p;
    }
    return body;
  }

  /** Is anyone on their side in the line of fire, out to `range` m (see Teams)? */
  private friendInWay(gun: Item, range: number): boolean {
    if (!this.team) return false;
    const m = gun.main;
    const ray = (this.fireRay ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    ray.origin = { x: m.x, y: m.y };
    ray.dir = gun.forward();
    let friend = false;
    this.game.physics.world.intersectionsWithRay(ray, range, true, (hit) => {
      const p = this.game.physics.partOf(hit.collider);
      if (p && !p.destroyed && allies(this, p.entity)) friend = true;
      return !friend;
    });
    return friend;
  }

  /** Starts a punch (with a free fist, each in turn), a kick (at something low down, or now and then), or a swing of what's in hand. */
  private throwBlow(held: Item | null): void {
    let side: 'F' | 'B';
    // (each a little quicker or slower: two fighters alike don't fall into step)
    const vary = (0.85 + Math.random() * 0.3) / this.rush;
    // too low for a fist to reach (an animal's head): a kick, if both legs will bear it; and now and then anyway
    const low = this.foe && strikePoint(this.foe).y < this.L('upperTorso').part.y - 0.5;
    if (!held && (low || (this.foe && Math.random() < FIGHT.kicks))) {
      if (['upperLegF', 'lowerLegF', 'footF', 'upperLegB', 'lowerLegB'].every((k) => this.ok(k as LimbKey))) {
        this.blow = { t: 0, dur: FIGHT.kick * vary, side: 'F', item: null, kick: true, landed: false, wind: FIGHT.wind, out: FIGHT.out, aim: 'chest' };
        return;
      }
      if (low) return;
    }
    if (held) {
      const g = this.grips.find((x) => x.item === held);
      if (!g) return;
      side = g.hand.spec.key.endsWith('F') ? 'F' : 'B';
    } else {
      const free = (['F', 'B'] as const).filter((s) => this.ok(`upperArm${s}`) && this.ok(`lowerArm${s}`) && this.ok(`hand${s}`) && !this.handBusy(this.L(`hand${s}`)));
      if (!free.length) return;
      side = free.length > 1 ? (this.lastFist === 'F' ? 'B' : 'F') : free[0];
      this.lastFist = side;
    }
    if (held) this.freeWeapon(held.main);
    // (at the head or the body: a weapon either, a fist mostly the head)
    this.blow = held
      ? { t: 0, dur: FIGHT.swing * vary, side, item: held, kick: false, landed: false, wind: FIGHT.swingWind, out: FIGHT.swingOut, aim: Math.random() < 0.5 ? 'head' : 'chest' }
      : { t: 0, dur: FIGHT.punch * vary, side, item: null, kick: false, landed: false, wind: FIGHT.wind, out: FIGHT.out, aim: Math.random() < 0.65 ? 'head' : 'chest' };
  }

  /** Where a blow is aimed: the foe's head or chest (an animal's head; whatever's left of them, once that's gone). */
  private blowTarget(foe: Entity, b: Blow | null): V2 {
    if (b?.aim === 'chest') for (const p of foe.parts) if (!p.destroyed && p.name === 'Upper torso') return { x: p.x, y: p.y };
    return strikePoint(foe);
  }

  /**
   * The blow under way: once drawn back, the fist (or the weapon) is thrown at
   * the foe's head or chest, and hurts them where it lands.
   */
  private strike(dt: number): void {
    const b = this.blow!;
    b.t += dt;
    // (a zombie with no hand left to grab with still bites)
    const end = b.item ? (b.item.destroyed || b.item.holder !== this ? null : b.item.main) : b.bite && !this.ok(`hand${b.side}`) ? this.L('head').part : this.L(b.kick ? 'footF' : `hand${b.side}`).part;
    if ((!this.foe && !b.item) || !end || end.destroyed || b.t >= b.dur) {
      this.blow = null;
      // (a swing on Use over: the arm goes back to holding it)
      if (!this.foe) this.fightPose.clear();
      // (now and then a second punch straight after the first, before stepping back out)
      this.combo = !b.item && !b.kick && !b.bite && !!this.foe && Math.random() < FIGHT.combo;
      this.blowT = b.bite ? ZOMBIE.pause * (0.8 + Math.random() * 0.5) : (this.combo ? FIGHT.pause * 0.5 : FIGHT.pause + Math.random() * FIGHT.jitter) / this.rush;
      return;
    }
    const { stage, s } = this.blowStage(b);
    // (a weapon lags behind its swing: it may meet them early in the follow-through)
    if (b.landed || !(stage === 'out' || (b.item && stage === 'guard' && s < 0.35))) return;
    // (swung on Use, at nothing in particular: it lands on whatever it meets)
    const foe = this.foe ?? this.struck(end);
    if (!foe) return;
    const at = this.foe ? this.blowTarget(foe, b) : strikePoint(foe);
    // (they've got round behind: it goes wide)
    if ((at.x - this.L('upperTorso').part.x) * this.f < 0) return;
    const dx = at.x - end.x;
    const dy = at.y - end.y;
    const d = Math.hypot(dx, dy) || 1;
    const u = { x: dx / d, y: dy / d };
    if (b.bite) {
      if (this.bite(foe, end, u)) b.landed = true;
      return;
    }
    // (on Ultra Strength, far harder: see MIGHT)
    const str = this.strength() * (this.might > 1 ? MIGHT.blow : 1);
    // a weapon hurts by its weight (and cuts, if it's a blade); a kick has a leg behind it
    const m = Math.min(4, b.item?.main.mass ?? 0);
    const dmg = (b.item ? 10 + 9 * m : b.kick ? 9 + Math.random() * 6 : 6 + Math.random() * 5) * str;
    const push = (b.item ? 6 + 5 * m : b.kick ? 8 + Math.random() * 4 : 5 + Math.random() * 4) * str;
    const kind = b.item && 'blade' in b.item ? 'cut' : 'blunt';
    if (land(this.game, this, end, foe, dmg, kind, u, push)) {
      b.landed = true;
      if (this.might > 1) this.fling(foe, u);
    }
  }

  /**
   * On Ultra Strength, a blow that lands sends whoever it hit flying (see MIGHT): away
   * from them, and up off their feet. (A kick meets them from below, nearly straight
   * up: they're flung back all the same, a little higher.)
   */
  private fling(foe: Entity, u: V2): void {
    const v = MIGHT.fling * Math.min(1, 150 / Math.max(1, foe.totalMass()));
    const up = 0.4 + 0.5 * Math.max(0, u.y);
    for (const p of foe.parts) {
      if (p.destroyed || p.frozen) continue;
      p.body.applyImpulse({ x: p.mass * v * this.f, y: p.mass * v * up }, true);
    }
    this.game.sound.play('impact/punch_heavy', { gain: 0.7, x: foe.center().x });
  }

  /**
   * A zombie's lunge reaching them: a bite where its hand (or head) meets them, or else
   * on whatever of them is near enough its hand or head (someone lying on the floor).
   * Whoever it bites is infected (see infect()) and fights back. Whether it bit.
   */
  private bite(foe: Entity, end: Part, u: V2): boolean {
    const dmg = ZOMBIE.bite * (0.7 + Math.random() * 0.6) * this.might;
    let at = land(this.game, this, end, foe, dmg, 'cut', u, 2);
    if (!at) {
      const head = this.L('head');
      let bd = ZOMBIE.mouth;
      for (const p of foe.parts) {
        if (p.destroyed) continue;
        const d = Math.min(Math.hypot(p.x - end.x, p.y - end.y), head.gone ? Infinity : Math.hypot(p.x - head.part.x, p.y - head.part.y));
        if (d < bd) {
          bd = d;
          at = p;
        }
      }
      if (!at) return false;
      foe.damage(at, dmg, 'cut', { x: at.x, y: at.y }, u);
      if (isFighter(foe) && foe.alive && !foe.foe) foe.fight(this, false);
    }
    (foe as Entity & { infect?(): void }).infect?.();
    this.game.sound.play('creature/zombie_bite', { gain: 0.6, x: at.x, vary: 0.1 });
    if (at.mat.bleeds && !at.destroyed) this.game.particles.blood(at.x, at.y, -u.x, 0.6, 8, 2, at.body);
    return true;
  }

  /**
   * A weapon about to be drawn back to swing, stuck in someone (pushed in on it,
   * or put down over it: pinched between an arm and the body, no muscle pulls it
   * out): it passes through what it's touching until it comes round (see preStep()).
   * Null: everything it passed through solid again.
   */
  private freeWeapon(part: Part | null): void {
    if (this.freed) for (const p of this.freed.from) this.freed.part.collideWith(p);
    this.freed = null;
    if (!part) return;
    const world = this.game.physics.world;
    const from: Part[] = [];
    for (const c of part.colliders) {
      world.contactPairsWith(c, (other) => {
        const p = this.game.physics.partOf(other);
        if (!p || p.destroyed || p.entity === this || p.entity === part.entity || from.includes(p) || part.noCollide?.has(p)) return;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0 && !from.includes(p)) from.push(p);
        });
      });
    }
    if (!from.length) return;
    for (const p of from) part.noCollideWith(p);
    this.freed = { part, from };
  }

  /** What a weapon swung on Use is touching (not its holder, nor itself). */
  private struck(end: Part): Entity | null {
    const world = this.game.physics.world;
    const found: { e: Entity | null } = { e: null };
    for (const c of end.colliders) {
      world.contactPairsWith(c, (other) => {
        const p = found.e ? null : this.game.physics.partOf(other);
        if (!p || p.destroyed || p.entity === this || p.entity === end.entity) return;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) found.e = p.entity;
        });
      });
      if (found.e) break;
    }
    return found.e;
  }

  /**
   * Arm targets in a fight: fists up in front of the chin, and the blow being
   * thrown, drawn back, out at the foe's head (or chest) and back to guard. A
   * weapon is held ready on the shoulder, and swung from there round through the
   * foe (see swingPath()), the other hand on it going along with it. The fist
   * moves along a smooth path: the arm muscles snapped straight to each pose
   * would whip it about at 30-40 m/s.
   */
  private fightIK(): Partial<Record<LimbKey, number>> | null {
    this.swingAt = null;
    const foe = this.foe;
    // (being removed, everything let go of: nothing to work out)
    // (a swing on Use, with no foe: at a point head high in front of them)
    const alone = !foe && !!this.blow?.item;
    if (this.destroyed || (!alone && (this.goal !== 'fight' || !foe || foe.destroyed))) return null;
    const out: Partial<Record<LimbKey, number>> = {};
    const f = this.f;
    const torso = this.L('upperTorso').part;
    const target = () => (foe ? this.blowTarget(foe, this.blow) : { x: torso.x + f * 1.1, y: torso.y + 0.2 });
    const kick = this.blow?.kick ? this.blow : null;
    // the weapon fought with (what's first in hand, unless they're shooting: a gun is
    // aimed, see holdIK()), held ready between swings too; or the one swung on Use
    const wg = foe ? (this.grips.some((g) => isGun(g.item)) ? undefined : this.grips[0]) : this.grips.find((g) => g.item === this.blow?.item);
    const wield = wg && !isGun(wg.item) ? wg : null;
    // (the other hand on it only goes along with it: not held to the fists' pace below)
    let along: 'F' | 'B' | null = null;
    if (kick) {
      // a kick: the knee drawn up, the leg flung out straight at it, and back down
      const hip = this.L('lowerTorso').part;
      const at = target();
      const reach = clamp(Math.atan2(Math.abs(at.x - hip.x), hip.y - at.y), 0.4, 1.5);
      const { stage, s } = this.blowStage(kick);
      const back = { x: reach * 0.6, y: -1.5 };
      const outLeg = { x: reach, y: -0.1 };
      const rest = { x: 0, y: -0.02 };
      const leg = stage === 'back' ? mix(rest, back, s) : stage === 'out' ? mix(back, outLeg, s) : mix(outLeg, rest, s);
      out.upperLegF = f * leg.x;
      out.lowerLegF = f * leg.y;
      out.footF = f * 0.3;
    }
    for (const side of ['F', 'B'] as const) {
      const sh = this.shoulder(side);
      if (!sh) continue;
      const hand = this.L(`hand${side}`);
      let a: { upper: number; lower: number; hand: number } | null;
      if (wield && wield.hand === hand) {
        const s = this.swingPath(wield, sh, torso, target());
        a = this.armIK(side, s.x, s.y, s.a);
        this.swingAt = { item: wield.item, angle: s.a };
      } else if (wield && wield.support?.hand === hand) {
        // (in the torso's frame, as all of these: see armIK())
        const g2 = wield.item.gripWorld(true);
        if (!g2) continue;
        const r = rotate(g2.x - sh.x, g2.y - sh.y, -torso.a);
        a = this.armIK(side, r.x, r.y, null);
        along = side;
      } else {
        const b = this.blow?.side === side && !kick && !this.blow.item ? this.blow : null;
        if (!b && (alone || this.handBusy(hand))) continue;
        // (kept in close: two guards held out meet in the middle, and every punch lands on a
        // fist; a zombie's arms are held out to grab)
        const guard = this.zombie ? { x: f * (side === 'F' ? 0.55 : 0.48), y: -0.04 } : { x: f * (side === 'F' ? 0.14 : 0.09), y: -0.1 };
        let p = guard;
        if (b) {
          const back = this.zombie ? { x: f * 0.35, y: 0.06 } : { x: f * 0.1, y: -0.02 };
          // (always out in front: a point behind the shoulder flips the arm right round)
          const at = target();
          let hit = rotate(at.x - sh.x, at.y - sh.y, -torso.a);
          hit = { x: f * Math.max(0.1, f * hit.x), y: hit.y };
          const { stage, s } = this.blowStage(b);
          p = stage === 'back' ? mix(guard, back, s) : stage === 'out' ? mix(back, hit, s) : mix(hit, guard, s);
        }
        a = this.armIK(side, p.x, p.y, null);
      }
      if (!a) continue;
      out[`upperArm${side}`] = a.upper;
      out[`lowerArm${side}`] = a.lower;
      out[`hand${side}`] = a.hand;
    }
    // a zombie lunging bends in at the hips to bite, right down to someone on the floor
    const bite = this.blow?.bite ? this.blow : null;
    if (bite) {
      const { stage, s } = this.blowStage(bite);
      const k = stage === 'back' ? s : stage === 'out' ? 1 : 1 - s;
      const lean = bite.aim === 'chest' ? 0.5 : 0.15;
      out.midTorso = f * lean * k;
      out.lowerTorso = f * lean * 0.8 * k;
      out.head = -f * 0.3 * k;
    }
    // turned toward at a limited rate (faster throwing a blow): snapped from one
    // pose to the next, putting their fists up whips the hands round at 20 m/s
    const dt = Math.min(0.1, this.t - this.fightPoseT);
    this.fightPoseT = this.t;
    const step = (this.blow && this.blowStage(this.blow).stage === 'out' ? FIGHT.slewOut : FIGHT.slew) * dt;
    this.easingFists = false;
    for (const k of Object.keys(out) as LimbKey[]) {
      const l = this.L(k);
      const was = this.fightPose.get(k) ?? (l.parent ? wrapAngle(l.part.a - l.parent.part.a) : out[k]!);
      const d = out[k]! - was;
      if (along && (k === `upperArm${along}` || k === `lowerArm${along}` || k === `hand${along}`)) {
        this.fightPose.set(k, out[k]!);
        continue;
      }
      if (Math.abs(d) > step) {
        out[k] = was + Math.sign(d) * step;
        this.easingFists = true;
      }
      this.fightPose.set(k, out[k]!);
    }
    for (const k of [...this.fightPose.keys()]) if (!(k in out)) this.fightPose.delete(k);
    return out;
  }

  /** How far the blow has got: drawing back, thrown out, or coming back to guard (each 0..1, eased). */
  private blowStage(b: Blow): { stage: 'back' | 'out' | 'guard'; s: number } {
    const k = b.t / b.dur;
    const w = b.wind;
    const o = b.out;
    if (k < w) return { stage: 'back', s: smoothstep(0, 1, k / w) };
    if (k < w + o) return { stage: 'out', s: smoothstep(0, 1, (k - w) / o) };
    return { stage: 'guard', s: smoothstep(0, 1, (k - w - o) / (1 - w - o)) };
  }

  /** Is this limb the business end of a blow being thrown (the fist and forearm, or the foot and shin)? */
  private throwing(l: Limb): boolean {
    const b = this.blow;
    if (!b || b.item) return false;
    const k = l.spec.key;
    return b.kick ? k === 'footF' || k === 'lowerLegF' : k === `hand${b.side}` || k === `lowerArm${b.side}`;
  }

  /**
   * Where the hand with a weapon goes (relative to the shoulder `sh`, in the torso's
   * frame: see armIK()) and the angle the weapon is held at (above straight ahead):
   * on the shoulder between swings (see SWING); in a swing drawn further back, then
   * the hand thrown out toward `at` as the weapon comes round over and down through
   * it, and back again. (A swing on Use, with no foe, starts and ends where it's held.)
   */
  private swingPath(g: Grip, sh: V2, torso: Part, at: V2): { x: number; y: number; a: number } {
    const f = this.f;
    const b = this.blow?.item === g.item ? this.blow : null;
    const rest = this.foe ? { x: f * SWING.rest.x, y: SWING.rest.y, a: SWING.rest.a } : { ...this.holdReach(g), a: g.item.hold?.angle ?? 0 };
    if (!b) return rest;
    const cock = { x: f * SWING.cock.x, y: SWING.cock.y, a: SWING.cock.a };
    // (always out in front: a point behind the shoulder flips the arm right round)
    const hit = rotate(at.x - sh.x, at.y - sh.y, -torso.a);
    const ahead = Math.max(0.1, f * hit.x);
    const k = Math.min(1, SWING.arm / (Math.hypot(ahead, hit.y) || 1));
    // (pointing straight at it as it gets there, and on past)
    const strike = { x: f * ahead * k, y: hit.y * k, a: Math.atan2(hit.y, ahead) - SWING.follow };
    const { stage, s } = this.blowStage(b);
    const [p, q] = stage === 'back' ? [rest, cock] : stage === 'out' ? [cock, strike] : [strike, rest];
    return { x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s, a: p.a + (q.a - p.a) * s };
  }

  /** Room to set off that way, turning round first if need be? */
  private clearTo(dir: number): boolean {
    return dir === this.f ? !this.blockedAhead() : !this.blockedAhead(true);
  }

  /** Runs away from x for a few seconds. */
  private scare(fromX: number, secs: number): void {
    // (a zombie fears nothing; someone cowering stays put)
    if (!this.alive || this.zombie || this.pose === 'cower' || this.grips.length || this.goal === 'fight') return;
    if (this.goal !== 'flee') this.goalT = 0;
    this.goal = 'flee';
    this.fleeFrom = fromX;
    this.goalT = Math.max(this.goalT, secs);
  }

  onAlarm(x: number, y: number, radius: number): void {
    if (!this.alive || this.consciousness < 0.3 || this.L('upperTorso').gone || this.grips.length || this.goal === 'fight') return;
    const c = this.L('upperTorso').part;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d > radius || d < 0.3) return;
    this.scare(x, 2 + 3 * (1 - d / radius));
  }

  /**
   * Is there something in the way just ahead (or behind: back = true), from the
   * shins up to the head, within `margin` m of the body?
   */
  private blockedAhead(back = false, margin = 0.3): boolean {
    const c = this.L('upperTorso').part;
    const world = this.game.physics.world;
    const dir = back ? -this.f : this.f;
    const ray = new RAPIER.Ray({ x: c.x, y: c.y }, { x: dir, y: 0 });
    const feet = this.ok('footF') ? this.L('footF').part.y : c.y - 1.05;
    const head = this.ok('head') ? this.L('head').part.y : c.y + 0.3;
    this.blocker = null;
    const other = (o: RAPIER.Collider) => {
      const p = this.game.physics.partOf(o);
      if (!p) return true;
      if (p.entity === this) return false;
      // what they hold goes along with them
      return !this.grips.some((g) => g.item === p.entity);
    };
    const cast = (y: number, range: number) => {
      ray.origin = { x: c.x, y };
      return world.castRay(ray, range, true, undefined, undefined, undefined, undefined, other);
    };
    for (const y of [head, c.y, c.y - 0.45, feet + 0.32, feet + 0.12]) {
      const hit = cast(y, 0.22 + margin);
      if (hit) {
        this.blocker = this.game.physics.partOf(hit.collider) ?? null;
        return true;
      }
    }
    // something lower than the knee (a brick): seen a stride further off, or the
    // foot reaching out in front kicks it along before the body gets that close
    if (!back) {
      const reach = 0.22 + margin + 0.25;
      const low = cast(feet + 0.12, reach);
      if (low && !cast(feet + 0.32, reach)) {
        this.blocker = this.game.physics.partOf(low.collider) ?? null;
        return true;
      }
    }
    return false;
  }

  /** How fast someone in the way is going the same way (m/s; 0 if they aren't, or it's a thing). */
  private blockerPace(): number {
    const b = this.blocker;
    if (!b || b.destroyed || !b.entity.canWalk) return 0;
    return Math.max(0, b.vx * this.f);
  }

  /** How far the floor falls away a step ahead (or that way: `dir`) (m; 0: it doesn't). */
  private dropAhead(dir: number = this.f): number {
    const g = this.groundUnder();
    if (g === null) return 0;
    const ahead = this.probe(this.L('upperTorso').part.x + dir * 0.45, g + 0.3, 0, -1, 3);
    return (ahead ? ahead.d : 3) - 0.3;
  }

  /**
   * A drop too high to climb down from, close enough that they need to stop for
   * it now: the legs take a moment to wind down, so the faster they go, the
   * farther ahead (dropAhead() only sees as far as the next stride).
   */
  private cliffAhead(speed: number): boolean {
    const g = this.groundUnder();
    if (g === null) return false;
    const ahead = this.probe(this.L('upperTorso').part.x + this.f * (0.45 + speed * 0.35), g + 0.3, 0, -1, CLIMB.down + 0.6);
    return !ahead || ahead.d - 0.3 > CLIMB.down;
  }

  /**
   * A fighter on the way to the foe, at a drop or someone lying in the way (looked
   * at a few times a second): climbs down a drop, or jumps down one too deep to
   * climb down but not too deep to land from; leaps a gap to floor about as high or
   * lower on the far side, if it's near enough; jumps over someone lying in the
   * way. Walks up to the edge for it first. Returns the speed to go at (0: they're
   * off), or null to go on as anyone walking does (see think(): climbing up onto
   * things, and stopping short of a drop there's no getting down).
   */
  private route(speed: number): number | null {
    if (this.climbCool > 0) return null;
    if (this.blockedAhead()) {
      // (not the foe: that's who they're after; nor anyone standing)
      const b = this.blocker?.entity;
      return b && b !== this.foe && b.canWalk && !b.upright ? this.hurdle() : null;
    }
    if (this.dropAhead() <= 0.35 && !this.cliffAhead(Math.abs(speed))) return null;
    const g = this.groundUnder();
    if (g === null) return null;
    const f = this.f;
    const c = this.trunkCenter();
    // how far ahead the edge is
    let edge = -1;
    for (let d = 0; d <= 1.6; d += 0.08) {
      if (!this.probe(c.x + f * d, g + 0.2, 0, -1, 0.5)) {
        edge = d;
        break;
      }
    }
    if (edge < 0) return null;
    // (walked up to slowly: off from close to the edge, the feet still on it)
    const near = edge < 0.36;
    const slow = GAIT.walk * 0.6;
    const below = this.probe(c.x + f * (edge + 0.3), g + 0.2, 0, -1, LEAP.down + 0.6);
    const depth = below ? below.d - 0.2 : Infinity;
    if (depth <= LEAP.down) {
      // down it: climbed down, if it's low enough and there's room to, else a hop down
      if (depth <= CLIMB.down && edge < 0.6 && this.climbDown()) return 0;
      if (!near) return slow;
      const T = (LEAP.hopVy + Math.sqrt(LEAP.hopVy ** 2 + 2 * this.pull * depth)) / this.pull;
      return this.leap(clamp((edge + 0.5) / T, 1, LEAP.hopVx * 1.6), LEAP.hopVy) ? 0 : null;
    }
    // a gap: across it, if the far side is near enough to reach (the trunk flying from
    // here to land a little way onto it)
    const far = this.farSide(c.x, g, edge);
    if (!far) return null;
    const T = (LEAP.vy + Math.sqrt(Math.max(0, LEAP.vy ** 2 - 2 * this.pull * (far.y - g)))) / this.pull;
    // (from where they'll be off: here, or once they've walked up to the edge)
    const vx = Math.max(1.5, (far.d - (near ? 0 : edge - 0.3) + LEAP.land) / T);
    if (vx > LEAP.vx) return null;
    if (!near) return slow;
    return !this.tethered() && this.leap(vx, LEAP.vy) ? 0 : null;
  }

  /**
   * Across a gap from an edge `edge` m ahead: where the nearest floor is (no more than
   * a little higher than `g`, nor deeper than LEAP.down; not someone) within LEAP.look
   * of x, with room on it to land: its height, and how far ahead it starts. Null: none.
   */
  private farSide(x: number, g: number, edge: number): { y: number; d: number } | null {
    const f = this.f;
    const top = g + 0.6;
    for (let d = edge + 0.2; d <= LEAP.look; d += 0.1) {
      const h = this.probe(x + f * d, top, 0, -1, 0.6 + LEAP.down);
      if (!h || h.part?.entity.canWalk) continue;
      const y = top - h.d;
      // (a wall rising on the far side: nothing to land on)
      if (y > g + 0.25) return null;
      for (const k of [0.3, LEAP.land + 0.3]) {
        const on = this.probe(x + f * (d + k), y + 0.3, 0, -1, 0.6);
        if (!on || Math.abs(0.3 - on.d) > 0.25) return null;
      }
      return { y, d };
    }
    return null;
  }

  /** Someone lying in the way: a jump over them, if they're low and short enough to clear, onto floor beyond. Returns the speed to go at (0: off), or null. */
  private hurdle(): number | null {
    const g = this.groundUnder();
    if (g === null) return null;
    const f = this.f;
    const c = this.trunkCenter();
    const top = g + LEAP.hurdle + 0.3;
    let over = false;
    for (let d = 0.2; d <= 2.2; d += 0.1) {
      const h = this.probe(c.x + f * d, top, 0, -1, LEAP.hurdle + 0.6);
      const y = h ? top - h.d : -Infinity;
      if (y > g + LEAP.hurdle) return null;
      if (y > g + 0.12) {
        over = true;
        continue;
      }
      // (no floor beyond: not here)
      if (Math.abs(y - g) > 0.15) return null;
      if (!over) continue;
      const vx = Math.max(1.5, (d + 0.3) / ((2 * LEAP.vy) / this.pull));
      return vx <= LEAP.vx && !this.tethered() && this.leap(vx, LEAP.vy) ? 0 : null;
    }
    return null;
  }

  /**
   * Stuck at the edge of somewhere high with the foe down below: another way down off
   * what they stand on, that way (`dir`), within 15 m: a drop they can get down, with
   * room under what they're on to come back along to the foe. Where to go (x: just
   * past the edge), or null.
   */
  private wayDown(dir: number): number | null {
    const g = this.groundUnder();
    if (g === null) return null;
    let y: number = g;
    const x0 = this.trunkCenter().x;
    const reach = CLIMB.up + 0.2;
    for (let d = 0.4; d <= 15; d += 0.4) {
      const x = x0 + dir * d;
      const h = this.probe(x, y + reach, 0, -1, reach + LEAP.down + 0.3);
      const top: number = h ? y + reach - h.d : -Infinity;
      // (a wall: no way on)
      if (top > y + CLIMB.up) return null;
      // (the floor goes on, up a step or down one)
      if (top >= y - 0.35) {
        y = top;
        continue;
      }
      if (top < y - LEAP.down) return null;
      // room under to come back
      return this.probe(x, top + 1.2, -dir, 0, d + 0.5) ? null : x + dir * 0.3;
    }
    return null;
  }

  /** A jump a fighter times themselves (see route()): a short crouch, then off at `vx` (m/s) along the way they face and `vy` up. Whether they did. */
  private leap(vx: number, vy: number): boolean {
    if (!this.jump()) return false;
    const j = this.jumping!;
    j.t = -LEAP.crouch;
    j.vx = vx * this.f;
    j.vy = vy;
    return true;
  }

  /**
   * The height of what they're standing on: the highest ground under either foot
   * (mid-stride the front one may be out over an edge already). Null: nothing.
   */
  private groundUnder(): number | null {
    let best = -Infinity;
    for (const k of ['footF', 'footB'] as LimbKey[]) {
      if (!this.ok(k)) continue;
      const p = this.L(k).part;
      const h = this.probe(p.x, p.y + 0.3, 0, -1, 1);
      if (h) best = Math.max(best, p.y + 0.3 - h.d);
    }
    return best > -Infinity ? best : null;
  }

  /** A ray from (x, y) in direction (dx, dy) that ignores this body (and what it holds): distance and what it hit, or null. */
  private probe(x: number, y: number, dx: number, dy: number, len: number): { d: number; part: Part | undefined } | null {
    const hit = this.game.physics.world.castRay(new RAPIER.Ray({ x, y }, { x: dx, y: dy }), len, true, undefined, undefined, undefined, undefined, (o) => {
      const p = this.game.physics.partOf(o);
      return !p || (p.entity !== this && !this.grips.some((g) => g.item === p.entity));
    });
    return hit ? { d: hit.timeOfImpact, part: this.game.physics.partOf(hit.collider) } : null;
  }

  /** The trunk's center of mass. */
  private trunkCenter(): V2 {
    let m = 0;
    let x = 0;
    let y = 0;
    for (const k of ['upperTorso', 'midTorso', 'lowerTorso'] as LimbKey[]) {
      const l = this.L(k);
      if (l.gone || !l.attached) continue;
      m += l.part.mass;
      x += l.part.x * l.part.mass;
      y += l.part.y * l.part.mass;
    }
    return m ? { x: x / m, y: y / m } : this.L('upperTorso').part;
  }

  /**
   * Something low in the way (a box, a step, a brick; never a person or an animal,
   * standing or lying): climbs up onto it if there's room to stand on top, or over
   * it if it's narrow with floor on the far side. Returns whether they set off.
   */
  private climbUp(): boolean {
    if (this.climbCool > 0 || this.blocker?.entity.canWalk || this.tethered() || !this.grounded(true)) return false;
    const f = this.f;
    const c = this.trunkCenter();
    const floor = this.probe(c.x, c.y, 0, -1, 2);
    if (!floor || floor.part?.entity.canWalk) return false;
    const groundY = c.y - floor.d;
    // the near side of it, just off the floor
    const face = this.probe(c.x, groundY + 0.06, f, 0, 0.9);
    if (!face || face.part?.entity.canWalk) return false;
    // its top
    const sky = groundY + CLIMB.up + 0.25;
    const top = this.probe(c.x + f * (face.d + 0.1), sky, 0, -1, CLIMB.up + 0.25);
    if (!top || top.part?.entity.canWalk) return false;
    const topY = sky - top.d;
    const dh = topY - groundY;
    if (dh < 0.1 || dh > CLIMB.up) return false;
    // nothing overhead on the way up
    const head = this.ok('head') ? this.L('head').part : this.L('upperTorso').part;
    if (this.probe(head.x, head.y, 0, 1, dh + 0.15)) return false;
    // how wide the top is
    let width = 0;
    while (width < 0.8) {
      const t = this.probe(c.x + f * (face.d + width + 0.04), topY + 0.2, 0, -1, 0.3);
      if (!t || Math.abs(topY + 0.2 - t.d - topY) > 0.08) break;
      width += 0.05;
    }
    if (width >= 0.3) {
      // onto it: room to stand up there (nothing on top, no wall)
      const x1 = face.d + Math.min(0.3, width - 0.12);
      for (const h of [0.25, 0.8, 1.4]) if (this.probe(c.x, topY + h, f, 0, x1 + 0.2)) return false;
      // (to full standing height up there, however crouched they set off: lower
      // and the legs would straighten into the top)
      this.climbing = { kind: 'up', t: 0, dur: 0.45 + dh * 0.95, x0: c.x, y0: c.y, x1: c.x + f * x1, y1: topY + TRUNK_Y + 0.03, peak: 0 };
    } else {
      // over it: something narrow, with floor at the same height on the far side and room to land
      if (dh > 0.6) return false;
      const x1 = face.d + width + 0.32;
      const far = this.probe(c.x + f * x1, topY + 0.3, 0, -1, dh + 0.6);
      if (!far || Math.abs(topY + 0.3 - far.d - groundY) > 0.12 || far.part?.entity.canWalk) return false;
      for (const h of [dh + 0.25, dh + 0.8, dh + 1.4]) if (this.probe(c.x, groundY + h, f, 0, x1 + 0.2)) return false;
      this.climbing = { kind: 'over', t: 0, dur: 0.6 + dh * 1.1, x0: c.x, y0: c.y, x1: c.x + f * x1, y1: c.y, peak: dh + 0.08 };
    }
    this.startClimb();
    return true;
  }

  /**
   * At a drop of up to CLIMB.down (the edge of a box they're on): lets
   * themselves down onto the floor below, if there's room. Returns whether they set off.
   */
  private climbDown(): boolean {
    if (this.climbCool > 0 || this.tethered()) return false;
    const f = this.f;
    const c = this.trunkCenter();
    const groundY = this.groundUnder();
    if (groundY === null) return false;
    // where the edge is (already behind the trunk: from here)
    let edge = -1;
    for (let d = 0; d <= 0.6; d += 0.04) {
      const h = this.probe(c.x + f * d, groundY + 0.2, 0, -1, 0.4);
      if (!h) {
        edge = d;
        break;
      }
    }
    if (edge < 0) return false;
    const x1 = edge + 0.42;
    const land = this.probe(c.x + f * x1, groundY + 0.2, 0, -1, CLIMB.down + 0.4);
    if (!land || land.part?.entity.canWalk) return false;
    const drop = land.d - 0.2;
    if (drop < 0.25 || drop > CLIMB.down) return false;
    // room down there to stand
    for (const h of [0.25, 0.8, 1.4]) if (this.probe(c.x + f * edge, groundY - drop + h, f, 0, x1 - edge + 0.2)) return false;
    // (standing tall down there: crouched, the legs would spring them back up off the floor)
    this.climbing = { kind: 'down', t: 0, dur: 0.4 + drop * 0.45, x0: c.x, y0: c.y, x1: c.x + f * x1, y1: groundY - drop + TRUNK_Y + 0.02, peak: 0.04 };
    this.startClimb();
    return true;
  }

  private startClimb(): void {
    this.speed = 0;
    this.climbCool = 0.6;
    this.easeFrom(POSE_EASE);
    this.updateMotors(true);
    for (const l of this.order) if (!l.gone && !l.part.frozen) l.part.body.wakeUp();
  }

  /** Where the climb carries the trunk at progress s (0..1). */
  private climbPath(k: Climb, s: number): V2 {
    let along: number;
    let rise: number;
    if (k.kind === 'up') {
      // up first, then over the top (the knees clear the edge before moving in)
      along = smoothstep(0.45, 1, s);
      rise = (k.y1 - k.y0) * smoothstep(0, 0.55, s);
    } else if (k.kind === 'down') {
      // out over the edge, then down
      along = smoothstep(0, 0.55, s);
      rise = (k.y1 - k.y0) * smoothstep(0.35, 1, s) + k.peak * Math.sin(Math.PI * clamp(s / 0.5, 0, 1));
    } else {
      along = smoothstep(0.2, 0.85, s);
      rise = k.peak * Math.sin(Math.PI * smoothstep(0, 1, s));
    }
    return { x: k.x0 + (k.x1 - k.x0) * along, y: k.y0 + rise };
  }

  /**
   * The pose for this moment of the climb: legs drawn up until the feet are over
   * where they're going, the arms reaching out once the body has risen (swung
   * out at once they'd shove the box away); going down, knees soft for the landing.
   */
  private climbPose(): MovePose {
    const k = this.climbing!;
    const s = k.t / k.dur;
    if (k.kind === 'down') return s < 0.4 ? 'tuck' : s < 0.75 ? 'drop' : 'stand';
    const tucked = k.kind === 'up' ? s < 0.82 : s > 0.08 && s < 0.7;
    return !tucked ? 'stand' : s > 0.3 ? 'reach' : 'tuck';
  }

  /**
   * Carries the body along the climb's path (the arms and legs doing the work
   * are a pose: the whole body is moved, held up against gravity and kept
   * upright), then sets them back down to walk on.
   */
  private climb(dt: number): void {
    const k = this.climbing!;
    this.speed = 0;
    const was = this.climbPose();
    k.t += dt;
    const s = Math.min(1, k.t / k.dur);
    const at = this.climbPath(k, s);
    const next = this.climbPath(k, Math.min(1, (k.t + dt) / k.dur));
    const c = this.trunkCenter();
    // stuck (something in the way, or pulled back): give up and let them drop
    if (Math.hypot(at.x - c.x, at.y - c.y) > 0.35 || k.t > k.dur + 0.6) {
      this.endClimb();
      return;
    }
    const vx = (next.x - at.x) / dt + (at.x - c.x) * 8;
    const vy = (next.y - at.y) / dt + (at.y - c.y) * 8;
    // kept upright: the whole body turned about its center as well as carried
    // along (every part is driven to the same velocity, which would hold onto
    // any lean it picked up, as the legs swing up at the start)
    const live = this.order.filter((l) => !l.gone && l.attached && !l.part.frozen);
    let m = 0;
    let mx = 0;
    let my = 0;
    for (const l of live) {
      m += l.part.mass;
      mx += l.part.x * l.part.mass;
      my += l.part.y * l.part.mass;
    }
    mx /= m;
    my /= m;
    const w = clamp(-wrapAngle(this.L('upperTorso').part.body.rotation()) * 8, -4, 4);
    for (const l of live) {
      const p = l.part;
      const v = p.body.linvel();
      const ax = clamp((vx - w * (p.y - my) - v.x) * 14, -30, 30);
      const ay = clamp((vy + w * (p.x - mx) - v.y) * 14, -30, 30) - this.game.gravity;
      p.body.applyImpulse({ x: p.mass * ax * dt, y: p.mass * ay * dt }, true);
    }
    if (this.climbPose() !== was) {
      this.easeFrom(POSE_EASE);
      this.updateMotors(true);
    }
    if (k.t >= k.dur) this.endClimb();
  }

  /** Jumps, if on their feet with the floor under them (carrying on the way they're walking). Returns whether they did. */
  jump(): boolean {
    if (!this.alive || this.state !== 'stand' || this.held || this.climbing || this.jumping) return false;
    if (!this.legsWork() || this.strength() < 0.5 || !this.grounded()) return false;
    this.jumping = { t: -JUMP.crouch, vx: this.trunkVx() * this.f, vy: JUMP.vy, off: false, landed: -1, peaked: false, pose: 'crouch' };
    this.speed = 0;
    this.easeFrom(POSE_EASE);
    this.updateMotors(true);
    for (const l of this.order) if (!l.gone && !l.part.frozen) l.part.body.wakeUp();
    return true;
  }

  /** Crouching for it, springing up, knees up in the air, soft knees to land on. */
  private jumpPose(): MovePose {
    const j = this.jumping!;
    if (j.t < 0) return 'crouch';
    if (j.landed >= 0) return 'drop';
    // (held bent until the feet are off the floor: straightening or drawing them up
    // against it, the legs would kick the body up far higher)
    if (!j.off) return 'crouch';
    return j.peaked ? 'drop' : 'tuck';
  }

  private jumpStep(dt: number, grounded: boolean): void {
    const j = this.jumping!;
    this.speed = 0;
    const before = j.t;
    j.t += dt;
    if (before < 0 && j.t >= 0) {
      for (const l of this.order) {
        if (l.gone || !l.attached || l.part.frozen) continue;
        const v = l.part.body.linvel();
        l.part.body.applyImpulse({ x: l.part.mass * (j.vx - v.x), y: l.part.mass * (j.vy - v.y) }, true);
      }
    }
    if (j.t > 0.08 && !grounded) j.off = true;
    if (j.off && this.L('midTorso').part.vy < 0.5) j.peaked = true;
    if (j.landed >= 0) j.landed += dt;
    else if (j.off && grounded) j.landed = 0;
    if (j.t >= 0 && j.landed < 0) this.airRight(dt);
    // (the pose follows the flight, which changes in the physics step: compared
    // with the one the legs were last put in, not with before this step's checks)
    const pose = this.jumpPose();
    if (pose !== j.pose) {
      j.pose = pose;
      this.easeFrom(POSE_EASE);
      this.updateMotors(true);
    }
    // down and steady (or they never got off the ground: something on top of them)
    if (j.landed > 0.25 || j.t > 2.5 || (j.t > 0.4 && !j.off)) this.endJump();
  }

  private endJump(): void {
    this.jumping = null;
    this.landT = 0;
    this.easeFrom(SETTLE_T);
    this.updateMotors(true);
  }

  /** Eases the joints from where they are now into their next targets over `dur` s, instead of snapping them there. */
  private easeFrom(dur: number): void {
    this.settleFrom = new Map();
    this.settleT = 0;
    this.settleDur = dur;
    for (const l of this.order) {
      if (l.joint && l.parent && !l.gone) this.settleFrom.set(l, wrapAngle(l.part.body.rotation() - l.parent.part.body.rotation()));
    }
  }

  /** In the air: the whole body turned back upright about its center of mass. */
  private airRight(dt: number): void {
    const live = this.order.filter((l) => !l.gone && l.attached && !l.part.frozen);
    let m = 0;
    let mx = 0;
    let my = 0;
    for (const l of live) {
      m += l.part.mass;
      mx += l.part.x * l.part.mass;
      my += l.part.y * l.part.mass;
    }
    if (!m) return;
    mx /= m;
    my /= m;
    const up = this.L('upperTorso').part.body;
    const alpha = clamp(-wrapAngle(up.rotation()) * 60 - up.angvel() * 12, -40, 40);
    for (const l of live) {
      const p = l.part;
      p.body.applyImpulse({ x: -p.mass * alpha * (p.y - my) * dt, y: p.mass * alpha * (p.x - mx) * dt }, true);
      p.body.applyTorqueImpulse(p.body.principalInertia() * alpha * dt, true);
    }
  }

  private endClimb(): void {
    this.climbing = null;
    this.landT = 0;
    this.climbCool = 0.4;
    this.updateMotors(true);
  }

  /** Horizontal speed of the torso, + forward. */
  private trunkVx(): number {
    let m = 0;
    let p = 0;
    for (const k of ['upperTorso', 'midTorso', 'lowerTorso'] as LimbKey[]) {
      const l = this.L(k);
      if (l.gone || !l.attached) continue;
      m += l.part.mass;
      p += l.part.mass * l.part.vx;
    }
    return m ? (p / m) * this.f : 0;
  }

  /**
   * Off balance: the speed (m/s, signed, world x) to step at to get the feet back
   * under the body, or 0. Where the body would come to rest over (its capture point:
   * the lean plus how fast it's going) is past the feet when standing still can't
   * hold it.
   */
  private stumbleSpeed(): number {
    // (walking, the body goes on ahead of the feet on purpose; holding something,
    // they stand their ground, unless they're fighting with it, or a soldier: and not
    // with something in pieces, which can't turn round with them, see tethered())
    const holding = this.grips.length > 0 && (!(this.foe || this.team) || this.grips.some((g) => g.item.parts.length !== 1));
    if ((this.gaitAmt > 0.05 && !this.stumbling) || holding || this.climbing || this.jumping || !this.legsWork()) return 0;
    const col = this.column();
    // (a foot comes off the ground with every step)
    if (!col.grounded) return this.stumbling ? this.speed * this.f : 0;
    const w0 = Math.sqrt(this.pull / col.h);
    const capture = col.h * (Math.sin(col.theta) + (col.omega * Math.cos(col.theta)) / w0);
    // (once stepping, they keep at it until they've really caught it)
    if (Math.abs(capture) < (this.stumbling ? 0.06 : 0.2)) return 0;
    // quick short steps, not strides: a running leg swings far too high to catch anything
    return Math.sign(capture) * clamp(Math.abs(capture) * 3, 0.6, GAIT.walk * 1.2);
  }

  /**
   * A joint's stepping motion (facing right) on top of the standing pose: the legs
   * swing in turn, each knee bending as its foot comes forward, the soles kept
   * level and the arms swinging against the legs.
   */
  private gait(key: LimbKey): number {
    const a = this.gaitAmt;
    const run = clamp((this.pace - GAIT.walk) / (GAIT.run - GAIT.walk), 0, 1);
    const swing = (GAIT.swing + (GAIT.runSwing - GAIT.swing) * run) * this.reach;
    // (rushed, the feet are hardly lifted: quick steps. A high knee's foot comes down
    // late, out ahead of them, and stops them dead every stride.)
    const lift = (GAIT.lift + (GAIT.runLift - GAIT.lift) * run) / Math.max(1, this.rush);
    const ph = this.stride + (key.endsWith('F') ? 0 : Math.PI);
    // (a zombie drags its far leg, hardly lifting it, and doesn't swing its arms)
    const drag = this.zombie && key.endsWith('B') ? 0.5 : 1;
    // bent forward a little at the hips: the feet drag on the floor as they push off,
    // which would tip a body held straight over backwards
    const sw = a * swing * Math.sin(ph) * (drag < 1 ? 0.75 : 1);
    const knee = -a * lift * Math.max(0, Math.cos(ph)) * drag;
    if (key.startsWith('upperLeg')) return sw + a * (GAIT.bend + (GAIT.runBend - GAIT.bend) * run);
    if (key.startsWith('lowerLeg')) return knee;
    // the sole kept about level through the swing
    if (key.startsWith('foot')) return -(sw + knee) * 0.8;
    if (this.zombie) return 0;
    if (key.startsWith('upperArm')) return -a * (0.3 + 0.35 * run) * Math.sin(ph);
    if (key.startsWith('lowerArm')) return a * (0.25 + 0.9 * run);
    return 0;
  }

  /**
   * Walking: the legs step at the rate that matches the speed, and the torso is
   * driven toward the wanted speed while the feet are on something.
   */
  private walk(dt: number, grounded: boolean): void {
    // (below 0: stepping back, still facing the same way, as from a foe)
    const want = this.state === 'stand' ? clamp(this.speed, -GAIT.top, GAIT.top) : 0;
    const back = want < 0 || (want === 0 && this.trunkVx() < -0.05) ? -1 : 1;
    // (a stumble can't wait for the legs to get going)
    this.gaitAmt = want !== 0 ? Math.min(1, this.gaitAmt + dt * (this.stumbling ? 6 : 3)) : Math.max(0, this.gaitAmt - dt * 3);
    if (!this.gaitAmt) return;
    // step for the speed the body is going (setting off, a little ahead of it), so the
    // feet keep up with it rather than flailing at a run from a standing start
    const w = Math.abs(want);
    const v = this.trunkVx() * back;
    this.pace = w ? clamp(v + 0.4, 0.5 * Math.min(w, GAIT.walk), w) : Math.max(0, v);
    const run = clamp((this.pace - GAIT.walk) / (GAIT.run - GAIT.walk), 0, 1);
    // each leg carries the body one sweep per half stride (stepping back, the stride runs backwards)
    const sweep = 2 * HIP_Y * Math.sin((GAIT.swing + (GAIT.runSwing - GAIT.swing) * run) * this.reach);
    const turn = 2 * Math.PI;
    this.stride = (((this.stride + back * turn * Math.max(0.8, this.pace / (2 * sweep)) * dt) % turn) + turn) % turn;
    if (!grounded || this.state !== 'stand' || this.climbing || this.jumping) return;
    // speed up toward the wanted speed (or slow to a stop), gently while the legs
    // are still getting into their stride: a body shoved ahead of its feet falls on its face
    const up = (GAIT.accel + (GAIT.runAccel - GAIT.accel) * run) * (0.3 + 0.7 * this.gaitAmt);
    const a = back < 0 && want < 0 ? clamp((want - this.trunkVx()) * GAIT.drive, -up, 4) : clamp((want - this.trunkVx()) * GAIT.drive, -4, up);
    let m = 0;
    for (const l of this.order) if (!l.gone && l.attached) m += l.part.mass;
    const trunk = (['upperTorso', 'midTorso', 'lowerTorso'] as LimbKey[]).map((k) => this.L(k)).filter((l) => !l.gone && l.attached && !l.part.frozen);
    const tm = trunk.reduce((s, l) => s + l.part.mass, 0);
    for (const l of trunk) l.part.body.applyImpulse({ x: m * a * this.f * (l.part.mass / tm) * dt, y: 0 }, true);
  }

  /** Pinned, tied, welded or holding something: they can't turn round in place. */
  private tethered(): boolean {
    // (what's in hand turns round with them, unless it's in pieces: see turn())
    if (this.grips.some((g) => g.item.parts.length !== 1)) return true;
    const world = this.game.physics.world;
    const held = this.grips.map((g) => g.item.main);
    const mine = new Set([...this.parts, ...held].map((p) => p.body.handle));
    let out = false;
    for (const p of [...this.order.filter((l) => !l.gone && l.attached).map((l) => l.part), ...held]) {
      if (p.frozen) return true;
      world.impulseJoints.forEachJointHandleAttachedToRigidBody(p.body.handle, (h) => {
        const j = world.impulseJoints.get(h);
        if (!j || out) return;
        const o = j.body1().handle === p.body.handle ? j.body2() : j.body1();
        if (!mine.has(o.handle)) out = true;
      });
      if (out) return true;
    }
    const things = new Set<Entity>([this, ...this.grips.map((g) => g.item)]);
    return this.game.connections.list.some((k) => things.has(k.a.entity) || (!!k.b && things.has(k.b.entity)));
  }

  /**
   * Turns round on the spot: the body is mirrored about its middle, keeping its
   * pose and motion (a sprite game's about-turn). What's in hand turns with
   * them: let go, mirrored and taken again in the same hand.
   */
  private turn(): boolean {
    if (this.turnT > 0) return false;
    if (this.tethered() || this.blockedAhead(true, 0.05)) {
      this.turnT = 0.3;
      return false;
    }
    this.turnT = 0.8;
    const live = this.order.filter((l) => !l.gone && l.attached);
    let m = 0;
    let mx = 0;
    for (const l of live) {
      m += l.part.mass;
      mx += l.part.x * l.part.mass;
    }
    const cx = mx / m;
    const world = this.game.physics.world;
    const held = this.grips.map((g) => ({ item: g.item, hand: g.hand, support: !!g.support }));
    for (const g of this.grips) {
      if (g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
      if (g.support?.joint.isValid()) world.removeImpulseJoint(g.support.joint, true);
    }
    this.grips = [];
    for (const l of live) {
      const v = l.part.body.linvel();
      l.part.mirror(cx);
      // turning round, not bouncing back
      l.part.body.setLinvel(v, false);
      l.part.vx = v.x;
      for (const w of l.wounds) w.dx = -w.dx;
    }
    this.f = this.f === 1 ? -1 : 1;
    this.flipped = this.f === -1;
    for (const l of live) {
      const j = l.joint;
      if (!j || !j.isValid() || !l.parent) continue;
      l.a1 = { x: -l.a1.x, y: l.a1.y };
      l.a2 = { x: -l.a2.x, y: l.a2.y };
      j.setAnchor1(l.a1);
      j.setAnchor2(l.a2);
      this.setLimits(l);
    }
    for (const h of held) {
      h.item.main.mirror(cx);
      h.item.flipped = !h.item.flipped;
      this.attach(h.item, h.hand, h.support, true);
    }
    // (the fists' last targets were for facing the other way: start again from the mirrored pose)
    this.fightPose.clear();
    this.updateMotors(true);
    for (const l of live) if (!l.part.frozen) l.part.body.wakeUp();
    return true;
  }

  /**
   * Whole-body "column" state: tilt of the center of mass about the support point
   * (the feet). Standing balance rotates the body rigidly about that point.
   */
  private column(): Column {
    let sx = 0;
    let n = 0;
    let sy = Infinity;
    const grounded = this.grounded();
    for (const k of ['footF', 'footB'] as LimbKey[]) {
      if (!this.ok(k)) continue;
      const p = this.L(k).part;
      sx += p.x;
      sy = Math.min(sy, p.y);
      n++;
    }
    if (!n) return { theta: Math.PI / 2, omega: 0, sx: 0, sy: 0, h: 1, grounded: false };
    sx /= n;
    let mx = 0;
    let my = 0;
    let vx = 0;
    let vy = 0;
    let m = 0;
    for (const l of this.order) {
      if (l.gone || !l.attached) continue;
      const pm = l.part.mass;
      mx += l.part.x * pm;
      my += l.part.y * pm;
      vx += l.part.vx * pm;
      vy += l.part.vy * pm;
      m += pm;
    }
    mx /= m;
    my /= m;
    vx /= m;
    vy /= m;
    const rx = mx - sx;
    const ry = my - sy;
    const h2 = Math.max(0.05, rx * rx + ry * ry);
    return { theta: Math.atan2(rx, ry), omega: (ry * vx - rx * vy) / h2, sx, sy, h: Math.sqrt(h2), grounded };
  }

  /**
   * Balance: drives the column tilt to zero by applying the forces/torques that
   * would rotate the whole body rigidly about the feet (muscles + reflexes).
   */
  private balance(col: Column, kp: number, kd: number, amax: number, dt: number): void {
    // the feet support the body passively while the center of mass stays over them,
    // so only push back once the body actually starts to tip (deadband)
    const theta = col.theta;
    const omega = col.omega;
    const dead = this.state === 'getup' || this.gaitAmt > 0 ? 0 : BALANCE.dead;
    const err = Math.sign(theta) * Math.max(0, Math.abs(theta) - dead);
    const alpha = clamp(-kp * err - kd * omega, -amax, amax);
    if (BALANCE.torqueOnly && this.state === 'stand') {
      // pure torques: no net linear force, so a standing person never creeps
      let I = 0;
      for (const l of this.order) {
        if (l.gone || !l.attached) continue;
        const rx = l.part.x - col.sx;
        const ry = l.part.y - col.sy;
        I += l.part.mass * (rx * rx + ry * ry) + l.part.body.principalInertia();
      }
      const tau = -I * alpha;
      // a body at rest inside the deadband is left alone so it can fall asleep
      if (Math.abs(tau) < 1.5) return;
      // Asleep, it isn't moving, so there is nothing to correct until something
      // wakes it. (Leaning on something it never gets inside the deadband, and
      // waking it to push would wake the whole pile it stands on.) Nor may a
      // torque be applied to a sleeping body without waking it: the velocity piles
      // up unsolved and is released all at once when something wakes it.
      if (this.L('upperTorso').part.body.isSleeping()) return;
      // distribute over the torso, where the "core" muscles act
      const share: [LimbKey, number][] = [['upperTorso', 0.4], ['midTorso', 0.3], ['lowerTorso', 0.3]];
      for (const [k, w] of share) {
        const l = this.L(k);
        if (l.gone || !l.attached || l.part.frozen) continue;
        l.part.body.applyTorqueImpulse(tau * w * dt, true);
      }
      return;
    }
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const k = l.spec.key;
      if (k.startsWith('lowerArm') || k.startsWith('hand')) continue;
      const p = l.part;
      const rx = p.x - col.sx;
      const ry = p.y - col.sy;
      const m = p.mass;
      p.body.applyImpulse({ x: m * alpha * ry * dt, y: -m * alpha * rx * dt }, true);
      p.body.applyTorqueImpulse(-p.body.principalInertia() * alpha * dt, true);
    }
  }

  postStep(dt: number): void {
    this.updateGrips(dt);
    // ---- joint stress: limbs tear off when stretched too far
    for (const l of this.order) {
      if (!l.joint || l.severed || !l.joint.isValid() || !l.parent) continue;
      // nothing is pulling at a joint between two sleeping bodies
      if (l.part.body.isSleeping() && l.parent.part.body.isSleeping()) {
        l.stress = Math.max(0, l.stress - dt);
        continue;
      }
      const pa = l.parent.part.localToWorld(l.a1.x, l.a1.y);
      const pb = l.part.localToWorld(l.a2.x, l.a2.y);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const hpF = l.part.hp / l.part.maxHp;
      // (on Ultra Strength the joints hold together against the muscles pulling on them)
      const limit = (0.11 + 0.12 * clamp(hpF, 0, 1)) * (this.variant.kind === 'android' ? 1.6 : 1) * (this.drugs.strength > 0 ? 1.4 : 1);
      if (d > limit) {
        l.stress += dt;
        if (l.stress > 0.03) this.rupture(l);
      } else l.stress = Math.max(0, l.stress - dt);
    }

    // ---- torn joints still hanging on: pulled too far, the last of it gives
    if (this.tendons?.count) {
      for (const at of this.tendons.step(dt)) {
        if (this.variant.bleeds) {
          this.game.particles.blood(at.x, at.y, 0, 0.5, 12, 2.5, null);
          this.game.sound.squish(0.6, at.x);
        } else this.game.particles.sparks(at.x, at.y, 0, 1, 8, 3);
        this.game.sound.tear(at.x);
      }
    }

    // ---- bleeding
    if (this.variant.bleeds) this.bleed(dt);

    // ---- vitals
    // a bad hit hurts for a while; the last twinges pass quickly
    this.pain = Math.max(0, this.pain - dt * 0.05 * (1 + this.pain));
    const d = this.drugs;
    d.adrenaline = Math.max(0, d.adrenaline - dt);
    d.knockout = Math.max(0, d.knockout - dt);
    d.poison = Math.max(0, d.poison - dt);
    this.stunned = Math.max(0, this.stunned - dt);
    // (the newer drugs, and an infection: see afflict())
    this.afflict(dt);
    if (this.alive) {
      if (d.adrenaline > 0 || this.zombie) {
        // no pain, no shock, and a fast recovery (a zombie feels nothing)
        this.pain = 0;
        this.shock = 0;
      }
      if (d.painkiller > 0) this.pain = 0;
      // poison drains the blood from the inside (and shows, greener the worse it gets: see tone())
      if (d.poison > 0) this.blood -= dt * 2.4;
      // (and under water, their breath runs out)
      const breathes = this.breathes;
      if (breathes) this.breathe(dt);
      const head = this.L('head');
      const headF = head.gone ? 0 : head.part.hp / head.part.maxHp;
      let target = 1;
      if (breathes) target = Math.min(target, this.breath.faint);
      if (headF < 0.5) target = Math.min(target, headF * 1.2);
      // (a zombie goes on with no blood left in it)
      if (this.blood < 65 && !this.zombie) target = Math.min(target, (this.blood - 40) / 25);
      if (this.pain > 0.9) target = Math.min(target, 0.4);
      if (d.knockout > 0 || this.stunned > 0) target = Math.min(target, 0.05);
      target = clamp(target, 0, 1);
      // consciousness drops fast, recovers slowly (quickly on adrenaline, and for a zombie)
      // (rates per step at 120 steps a second, the same at any step length)
      const up = d.adrenaline > 0 || this.zombie ? 0.03 : 0.004;
      const rate = target < this.consciousness ? 0.2 : up;
      this.consciousness += (target - this.consciousness) * (1 - Math.pow(1 - rate, dt * 120));
      this.shock = Math.max(0, this.shock - dt * 0.01);
      if (this.consciousness < 0.15 && this.state !== 'down') this.setState('down');
      this.checkDeath();
    } else {
      this.deathT += dt;
      // part of a Life dose wears off (a fifth of a syringe every ten seconds)
      // (a corpse's pallor comes over it: see tone())
      this.lifeDose = Math.max(0, this.lifeDose - dt * 0.02);
    }
  }

  /** Someone who needs air: flesh and blood, and not undead. */
  get breathes(): boolean {
    return this.variant.material === MAT.flesh && !this.zombie;
  }

  /** Treading water: awake and off their feet in water up to their middle, and not held or posed lying still. */
  get treading(): boolean {
    return this.alive && this.breath.deep && this.state === 'down' && this.strength() > 0.15 && !this.held && !this.seat && this.pose !== 'flat' && !this.limp;
  }

  /**
   * Their breath (see Breath): held under, it runs out, and they faint and drown;
   * up again they gasp for air. Awake in deep water, they tread it, swimming for
   * the shore, as long as their strength holds out (as heavy, the less air in them).
   */
  private breathe(dt: number): void {
    const head = this.L('head');
    if (head.gone || !head.attached) return;
    const chest = this.L('upperTorso').part;
    const mouth = head.part.localToWorld(0, -MOUTH_DOWN);
    const treading = this.treading;
    const awake = this.consciousness > 0.15;
    if (this.breath.step(this.game, dt, mouth, this.L('lowerTorso').part, awake, treading) && awake) {
      this.game.sound.play('creature/gasp', { gain: 0.5, x: mouth.x, vary: 0.1 });
    }
    chest.buoyancy = this.breath.buoyancy;
    if (treading && this.breath.level !== null) {
      const swim = shoreward(this.game, chest.x) * SWIM;
      tread(this.game, head.part, chest, this.order.filter((l) => !l.gone && l.attached).map((l) => l.part), mouth.y, this.breath.level, this.breath.effort * clamp(this.strength(), 0, 1), swim, dt);
    }
  }

  private checkDeath(): void {
    const head = this.L('head');
    const up = this.L('upperTorso');
    let cause = '';
    if (head.gone || head.part.hp <= 0) cause = 'head';
    else if (!head.attached) cause = 'decapitated';
    else if (up.part.hp <= 0) cause = 'torso';
    // (a zombie doesn't need its blood)
    else if (this.blood < 35 && !this.zombie) cause = 'blood';
    else if (this.breath.drowned) cause = 'drowned';
    else {
      let trauma = 0;
      // (a mangled limb counts as badly as a lost one, however far below nothing its health went)
      for (const l of this.order) if (!l.gone) trauma += clamp(1 - l.part.hp / l.part.maxHp, 0, 1.5) * (l.spec.cy > 24 ? 1.2 : 0.6);
      if (trauma > (this.zombie ? ZOMBIE.trauma : 6.5)) cause = 'trauma';
    }
    if (cause) this.die();
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.lifeDose = 0;
    this.dropAll();
    this.consciousness = 0;
    this.setState('down');
    this.updateMotors(true);
    this.setFace();
  }

  private setFace(): void {
    const head = this.L('head');
    if (head.gone) return;
    const p = head.part;
    const fc = faceColors(this.variant.kind, this.variant.skin);
    if (this.variant.kind === 'android') {
      const c = !this.alive ? fc.eyeDead : this.consciousness < 0.3 ? fc.eyeDim! : fc.eye;
      p.paintPixel(EYE.x - 1, EYE.y, c);
      p.paintPixel(EYE.x, EYE.y, c);
      return;
    }
    if (!this.alive) {
      p.paintPixel(EYE.x, EYE.y, fc.eyeDead);
      p.paintPixel(MOUTH.x, MOUTH.y, fc.mouthDead);
    } else if (this.consciousness < 0.3) {
      p.paintPixel(EYE.x, EYE.y, this.zombie ? ZOMBIE_SKIN[1] : fc.eyeClosed!);
    } else {
      // (a zombie stares, pale-eyed and slack-mouthed)
      p.paintPixel(EYE.x, EYE.y, this.zombie ? ZOMBIE_EYE : fc.eye);
      p.paintPixel(MOUTH.x, MOUTH.y, this.zombie ? ZOMBIE_MOUTH : fc.mouth);
    }
  }

  frame(_dt: number): void {
    // (turned or cured on the host, a guest's copy changes its skin as it hears of it)
    if (this.zombie !== this.dressedZombie) {
      this.redress();
      this.faceState = -1;
    }
    const want = !this.alive ? 0 : this.consciousness < 0.3 ? 1 : 2;
    if (want !== this.faceState) {
      this.faceState = want;
      this.setFace();
    }
    this.tone();
    this.tendons?.draw();
  }
  private faceState = 2;
  /** Limbs wrenched out of their joints that still hang on by flesh (see rupture()). */
  private tendons: Tendons | null = null;

  /**
   * (a limb hanging on by flesh pulls with the body it hangs from too, as the
   * body with it: dragged away, the flesh stretches and tears rather than the
   * hand just trailing behind the cursor)
   */
  limpMass(p: Part): number {
    const group = new Set(this.connectedParts(p));
    let m = super.limpMass(p);
    for (const q of this.tendons?.tiedTo(group) ?? []) m += super.limpMass(q);
    return m;
  }

  // ---------------------------------------------------------------- damage

  onGrab(p: Part, held: boolean, at?: V2): void {
    this.held = held;
    this.grabbedPart = held ? p : null;
    this.seat?.grabbed(held ? p : null);
    this.rouse();
    if (held) this.setState('down');
    else {
      this.stateT = 0;
      this.catchT = 0.6;
      this.applyDamping();
    }
    this.updateMotors(true);
    // let go of over a vehicle, they get in (last: getting in may turn them round, which makes them anew)
    if (!held && !this.seat && at) this.board(at);
  }
  private grabbedPart: Part | null = null;

  /** Let go of at `at`: gets into the vehicle it's over, if any has room (see Car.takeIn()). */
  private board(at: V2): void {
    for (const e of this.game.entities) {
      const v = e as Entity & { takeIn?: (who: Human, at: V2) => boolean };
      if (v !== this && !v.destroyed && v.takeIn?.(this, at)) return;
    }
  }

  /**
   * Sits them in a vehicle's seat (whoever has it holds them there: see Car),
   * or (null) out of it: `stand`, put on their feet beside it, they stay up if
   * they can.
   */
  sit(seat: Seat | null, stand = false): void {
    this.seat = seat;
    this.stateT = 0;
    if (seat || !stand || !this.alive || this.limp || this.strength() < 0.6 || !this.legsWork()) this.setState('down');
    else this.setState('stand');
    // (just out, they may still find their feet: see catching())
    if (!seat) this.catchT = 0.6;
    this.applyDamping();
    this.updateMotors(true);
  }

  onImpact(info: ImpactInfo): void {
    const l = this.limbOf(info.part);
    if (!l || l.gone) return;
    // arms and legs knocking against the foe's in a fight: what blows do is worked
    // out where they land (see strike()), fists and shins clashing don't break them
    if (this.foe && info.other?.entity === this.foe && /^(hand|lowerArm|upperArm|foot|lowerLeg)/.test(l.spec.key)) return;
    const mEff = info.part.mass * (l.spec.cy > 24 ? 2.6 : 2.2);
    // energy from this limb's own motion (falling onto something; not their own
    // feet set down climbing, nor the fist or foot of a blow they're throwing:
    // see strike()), at most a little over what the body as a whole carries (a
    // foot or a hand whipped down as they topple over hits fast, but nothing like
    // a body coming down: that's a fall, a slam or a throw)...
    const own = l.attached ? Math.min(info.selfSpeed, this.bodySpeed() * 1.5) : info.selfSpeed;
    const Eself = this.climbing || this.throwing(l) ? 0 : 0.5 * Math.min(mEff, info.otherMass) * own * own;
    // ...plus energy delivered by the other object, which the rest of the body
    // backs up (a crate dropped on a head crushes it against the body)
    const backing = l.attached ? Math.max(mEff, this.totalMass() * 0.8) : mEff;
    const blunt = (info.other?.entity as { blunt?: number } | undefined)?.blunt ?? 1;
    const Eother = 0.5 * Math.min(info.otherMass, backing) * info.otherSpeed * info.otherSpeed * blunt;
    const E = Eself + Eother;
    const frag = l.spec.fragility / this.variant.toughness;
    const E0 = (24 * mEff) / frag;
    if (E <= E0) return;
    // above that, the harm climbs fast: a head slammed into the floor at 10 m/s is
    // done for, a leg at 10 m/s breaks (falling over or landing a jump stays below E0)
    const frac = (E - E0) / ((55 * mEff) / frag);
    this.injure(l, frac * l.spec.hp, 'blunt', info.point, { x: -info.normal.x, y: -info.normal.y });
    if (this.variant.bleeds) this.game.sound.fleshHit(frac, info.point.x);
    else this.game.sound.impact('metal', frac, info.point.x);
    // a hard hit knocks a standing person over
    // (a lesser knock just shoves them: their balance decides whether they go over)
    if ((frac > 0.2 || Eother > 400) && this.state === 'stand' && l.spec.cy > 24) this.setState('down');
  }

  /**
   * Pressed on by a thing past what a limb bears (a weight set down on them, a slab
   * dropped on them): crushed, and in the end pressed flat. People in a heap don't
   * count: they squash the ones at the bottom only as hard as a knock does.
   */
  onLoad(part: Part, other: Part, force: number, point: V2, normal: V2): void {
    if (force <= LIMB_BEARS || other.entity.canWalk) return;
    const l = this.limbOf(part);
    if (!l || l.gone || this.heldItems().includes(other.entity as Item)) return;
    this.damage(part, (force - LIMB_BEARS) * CRUSHING * this.game.stepDt, 'crush', point, { x: -normal.x, y: -normal.y });
  }

  onBullet(hit: BulletHit): void {
    const l = this.limbOf(hit.part);
    if (!l || l.gone) return;
    let dmg = hit.damage / this.variant.toughness;
    if (l.spec.key === 'head') dmg *= 2.2;
    const p = l.part;
    p.flash = 0.6;
    this.addWound(l, hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y, 0.35 + dmg * 0.025, true);
    if (hit.exit) this.addWound(l, hit.exit.x, hit.exit.y, hit.dir.x, hit.dir.y, 0.3 + dmg * 0.03, true);
    if (this.variant.bleeds) {
      const ps = this.game.particles;
      ps.blood(hit.point.x, hit.point.y, -hit.dir.x + (Math.random() - 0.5), -hit.dir.y + 0.3, 6 + dmg * 0.3, 2.2, p.body);
      ps.mist(hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y, 2, 0.2);
      // spatter out of the exit wound: a cone of it, faster and more the harder the round
      if (hit.exit) ps.splatter(hit.exit.x, hit.exit.y, hit.dir.x, hit.dir.y, 8 + Math.sqrt(hit.energy) * 0.6, 3 + Math.sqrt(hit.energy) / 9, 0.35, p.body);
      this.game.sound.squish(0.3, hit.point.x, 0.5);
    } else {
      this.game.particles.sparks(hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y, 6, 4);
    }
    // a heavy round takes a chunk out where it comes out, and a nick where it goes in
    // (shot to pieces, or clean through, the limb may go: see Chunks)
    const look = this.variant.bleeds ? FLESH : PLATING;
    takeChunk(this, l, hit.point, hit.dir, hit.energy, hit.exit ? 'in' : 'stop', look, hit.round);
    if (hit.exit) takeChunk(this, l, hit.exit, hit.dir, hit.energy, 'out', look, hit.round);
    if (l.gone) return;
    // a bullet through the brain (not a stray fragment or a spent pellet: those
    // wound and stun, and kill only when they add up)
    if (l.spec.key === 'head' && hit.damage > 16 && this.variant.kind === 'human') {
      this.injure(l, dmg, 'bullet', hit.point, hit.dir);
      p.hp = Math.min(p.hp, 0);
      this.die();
      return;
    }
    if (l.spec.key === 'upperTorso') {
      this.addBleedTo(l, 0.8);
      this.shock = Math.min(1, this.shock + 0.15);
    }
    this.injure(l, dmg, 'bullet', hit.point, hit.dir);
    // heavy hits to the body or legs make people collapse
    const core = l.spec.key.endsWith('Torso');
    if (this.state !== 'down' && (dmg > 40 || (core && dmg > 24 && Math.random() < 0.5) || (l.spec.key.includes('Leg') && dmg > 20))) {
      this.setState('down');
    }
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    const l = this.limbOf(part);
    if (!l || l.gone) return;
    const amt = amount / this.variant.toughness;
    if (kind === 'fire') {
      part.hp -= amt * 0.55;
      this.pain = Math.min(1.5, this.pain + amt * 0.025);
      this.shock = Math.min(1, this.shock + amt * 0.002);
      // burning people drop and writhe
      if (this.state !== 'down' && part.burning > 0.35) this.setState('down');
      if (this.variant.kind === 'human' && Math.random() < amt * 0.6) {
        const w = part.pixelToWorld(Math.floor(Math.random() * part.w), Math.floor(Math.random() * part.h));
        part.paintAt(w.x, w.y, 0x2a1d17, 0, 0.25);
      }
      return;
    }
    if (kind === 'acid') {
      // eats into the skin: steady damage and a lot of pain, no bleeding
      part.hp -= amt;
      this.pain = Math.min(1.5, this.pain + amt * 0.04);
      return;
    }
    if (kind === 'laser') {
      // a burnt hole: full trauma, but cauterised (no bleeding)
      if (point && this.variant.kind === 'human') part.paintAt(point.x, point.y, 0x2a1d17, 1, 0.85);
      this.injure(l, amt, kind, point, dir);
      return;
    }
    if (kind === 'explosion') {
      // big blasts blow limbs apart (see gib()); lesser ones take a chunk out of the
      // side facing them, and may tear them off
      const frac = amt / l.spec.hp;
      if (frac > 3.2 && l.spec.key !== 'upperTorso') {
        this.gib(l, dir);
        return;
      }
      this.injure(l, amt, 'explosion', point, dir);
      if (point && dir && !l.gone) takeChunk(this, l, point, dir, blastEnergy(frac), 'stop', this.variant.bleeds ? FLESH : PLATING);
      if (l.gone) return;
      // (torn loose, a limb may still hang on by a strip of flesh)
      if (frac > 1.1 && l.joint && !l.severed && Math.random() < 0.6) {
        if (frac < 2 && Math.random() < 0.5) this.rupture(l);
        else this.sever(l, 'blast');
      }
      // shrapnel wounds
      if (point && Math.random() < Math.min(0.9, frac * 2)) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 1), 0.3 + frac, false);
      return;
    }
    if (kind === 'cut' || kind === 'stab') {
      if (point) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0), 0.25 + amt * 0.03, false, kind === 'cut' ? dir : undefined);
      this.injure(l, amt, kind, point, dir);
      return;
    }
    if (kind === 'crush') {
      // pressed on by a weight: its bones give, and in the end it's pressed flat
      this.injure(l, amt, kind, point, dir);
      if (l.gone) return;
      if (!l.broken && l.joint && l.spec.key !== 'head' && part.hp < l.spec.hp * 0.5) {
        l.broken = true;
        this.game.sound.bone(part.x);
        this.updateMotors(true);
      }
      // (the upper torso holds the rest together: crushed, it stays, as with blasts)
      if (part.hp < -l.spec.hp * 0.3 && l.spec.key !== 'upperTorso') this.gib(l, dir);
      return;
    }
    this.injure(l, amt, kind, point, dir);
  }

  /**
   * A blade's cut (see entities/Melee): it hurts as a cut does, and goes `depth` px
   * into the limb the way it went (from where that meets it, `back` px before `point`
   * at the furthest: see Chunks.sliceLimb()). A limb cut through comes apart where it
   * was cut, not at its joint, however hurt it is.
   */
  slice(part: Part, amount: number, point: V2, dir: V2, depth: number, back?: number): void {
    const l = this.limbOf(part);
    if (!l || l.gone) return;
    const amt = amount / this.variant.toughness;
    this.addWound(l, point.x, point.y, -dir.x, -dir.y, 0.25 + amt * 0.03, false, dir);
    this.injure(l, amt, 'cut', point, dir, false);
    if (!l.gone) sliceLimb(this, l, point, dir, depth / this.variant.toughness, this.variant.bleeds ? FLESH : PLATING, back);
  }

  /** Applies trauma to a limb and handles fractures, gibbing and death (and, for a cut, `sever`s a limb with nothing left at its joint: a stab only wounds). */
  private injure(l: Limb, dmg: number, kind: DamageKind, point?: V2, dir?: V2, sever = true): void {
    const p = l.part;
    p.hp -= dmg;
    // a real hit (not the knocks of flopping back down) makes it try again
    if (dmg > 6) this.rouse();
    this.pain = Math.min(1.5, this.pain + dmg / 90);
    this.shock = Math.min(1, this.shock + dmg / 600);
    if (l.spec.key === 'head') this.consciousness = Math.max(0, this.consciousness - dmg / l.spec.hp);
    if (kind === 'blunt') {
      if (point && this.variant.kind === 'human') {
        const bruise = dmg > l.spec.hp * 0.3 ? 0x5a2a3a : 0x7a4a52;
        p.paintAt(point.x, point.y, bruise, dmg > l.spec.hp * 0.25 ? 1 : 0, 0.35);
      }
      if (this.variant.bleeds && dmg > l.spec.hp * 0.2 && point) {
        this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0), dmg * 0.006, false);
        this.game.particles.blood(point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0) + 0.5, dmg * 0.3, 2.2, p.body);
      }
      // fractures: one hard knock, or a lesser one to a limb already badly hurt
      if (!l.broken && l.joint && l.spec.key !== 'head' && (dmg > l.spec.hp * 0.42 || (dmg > l.spec.hp * 0.15 && p.hp < l.spec.hp * 0.3))) {
        l.broken = true;
        this.game.sound.bone(p.x);
        this.updateMotors(true);
      }
      // crushed: a limb already spent, knocked hard again (or one enormous blow)
      if (p.hp < -l.spec.hp * 0.4 && dmg > l.spec.hp * 0.3) {
        // (the upper torso holds the rest together: it stays, as with blasts)
        if (l.spec.key === 'head') this.gib(l);
        else if (l.joint && Math.random() < 0.5) this.rupture(l);
        else if (l.joint) this.sever(l, 'blast');
      }
    }
    if (l.spec.key === 'head' && p.hp <= 0) this.die();
    if (l.spec.key === 'upperTorso' && p.hp <= 0) this.die();
    if (sever && kind === 'cut' && p.hp <= 0 && l.joint && !l.severed) this.sever(l, 'cut');
  }

  private addBleedTo(l: Limb, amount: number): void {
    if (!this.variant.bleeds || !l.wounds.length) return;
    l.wounds[l.wounds.length - 1].rate += amount;
  }

  /** Records a wound (entry or exit) and paints it on the sprite. */
  private addWound(l: Limb, wx: number, wy: number, ox: number, oy: number, rate: number, hole: boolean, cutDir?: V2): void {
    const p = l.part;
    // on the body a pixel or two in from where it struck (not a nick in the outline), on solid pixels
    const { x: bx, y: by } = woundSpot(p, wx, wy, -ox, -oy);
    if (this.variant.bleeds) {
      if (cutDir && !hole) {
        const ld = p.worldToLocal(p.x + cutDir.x, p.y + cutDir.y);
        const len = Math.hypot(ld.x, ld.y) || 1;
        const sx = Math.round((ld.x / len) * this.f);
        const sy = -Math.round(ld.y / len);
        for (let k = -2; k <= 2; k++) p.paintPixel(bx + sx * k, by + sy * k, k === 0 ? 0x3a0606 : 0x7d0e0e);
      } else {
        paintWound(p, bx, by, rate, hole);
      }
    } else {
      p.paintPixel(bx, by, 0x1a1c1f);
      for (const [i, j] of [[1, 0], [0, 1]]) p.paintPixel(bx + i, by + j, 0x3a3f45, 0.7);
    }
    if (!this.variant.bleeds) return;
    const local = rotate(ox, oy, -p.bodyAngle);
    const ll = Math.hypot(local.x, local.y) || 1;
    if (l.wounds.length >= 10) {
      l.wounds[Math.floor(Math.random() * l.wounds.length)].rate += rate;
      return;
    }
    l.wounds.push({ ix: bx, iy: by, dx: local.x / ll, dy: local.y / ll, rate, spurt: false });
  }

  private bleed(dt: number): void {
    const pulse = this.alive ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * Math.PI * 2 * 1.3)) : 0.2;
    const ps = this.game.particles;
    let total = 0;
    for (const l of this.order) {
      if (l.gone || !l.wounds.length) continue;
      const p = l.part;
      for (const w of l.wounds) {
        if (w.rate <= 0.005) continue;
        total += w.rate;
        // clotting (stumps clot slower)
        w.rate *= Math.exp(-dt * (w.spurt ? 0.02 : 0.045));
        if (this.blood <= 0) continue;
        // it runs down the body from the wound, too
        if (ps.bloodEnabled) seep(p, w, dt);
        const n = w.rate * pulse * dt * (w.spurt ? 26 : 12);
        if (Math.random() < n) {
          const wp = p.pixelToWorld(w.ix, w.iy);
          const d = rotate(w.dx, w.dy, p.bodyAngle);
          const sp = w.spurt ? 1.2 + w.rate * 0.9 * pulse : 0.15 + Math.random() * 0.3;
          ps.blood(wp.x, wp.y, d.x, d.y, w.spurt ? 2 : 1, sp, p.body);
        }
      }
    }
    if (total > 0) this.blood = Math.max(0, this.blood - total * dt * 0.5);
  }

  /** Detaches a limb (and its sub-chain) from its parent. */
  sever(l: Limb, why: 'tear' | 'cut' | 'blast'): void {
    if (!l.joint || l.severed || !l.parent) return;
    if (l.joint.isValid()) this.game.physics.world.removeImpulseJoint(l.joint, true);
    const ji = this.joints.indexOf(l.joint);
    if (ji >= 0) this.joints.splice(ji, 1);
    l.joint = null;
    l.severed = true;
    // the severed chain becomes its own collision group so it can hit the body
    const group = 1_000_000 + Math.floor(Math.random() * 1e9);
    const mark = (x: Limb) => {
      x.attached = false;
      x.part.group = group;
      x.part.detached = true;
      x.children.forEach(mark);
    };
    mark(l);
    // never let the stump faces push each other apart violently
    l.part.noCollideWith(l.parent.part);
    l.parent.part.noCollideWith(l.part);

    const pj = l.parent.part.localToWorld(l.a1.x, l.a1.y);
    const cj = l.part.localToWorld(l.a2.x, l.a2.y);
    if (this.variant.bleeds) {
      this.stump(l.parent, pj, 2.2, true);
      this.stump(l, cj, 0.9, false);
      const ps = this.game.particles;
      const d = { x: cj.x - l.part.x, y: cj.y - l.part.y };
      ps.blood(pj.x, pj.y, -d.x, -d.y + 0.5, 22, 3.5, l.parent.part.body);
      ps.blood(cj.x, cj.y, d.x, d.y, 14, 2.5, l.part.body);
      this.game.sound.squish(1, pj.x);
      this.pain = 1.5;
      this.shock = Math.min(1, this.shock + 0.35);
    } else {
      this.game.particles.sparks(pj.x, pj.y, 0, 1, 14, 4);
      this.game.sound.zap(pj.x);
    }
    if (why === 'tear') this.game.sound.tear(pj.x);
    if (l.spec.key === 'head' || l.spec.key === 'midTorso') this.die();
    this.updateMotors(true);
  }

  /**
   * A joint wrenched apart: the limb comes out of its socket (as when severed: the
   * muscles have nothing to pull on, and it bleeds) but stays hanging on by
   * stretched flesh until that's pulled too far (see Tendons).
   */
  rupture(l: Limb): void {
    const parent = l.parent;
    if (!l.joint || l.severed || !parent) return;
    this.sever(l, 'tear');
    if (l.gone || parent.gone) return;
    const p = l.part;
    const flesh = this.variant.bleeds ? { outer: this.variant.skin.skin[2], inner: 0x8e1a1a } : { outer: 0x3a3f46, inner: 0xb87333 };
    (this.tendons ??= new Tendons(this.game, this.zBase - 0.0004)).add(parent.part, l.a1, p, l.a2, Math.min(p.w, p.h) * PX, flesh);
  }

  private stump(l: Limb, at: V2, rate: number, spurt: boolean): void {
    const p = l.part;
    const { ix, iy } = p.worldToPixel(at.x, at.y);
    for (let j = -1; j <= 1; j++) for (let i = -2; i <= 2; i++) {
      const c = i === 0 && j === 0 ? 0xe6dcc8 : (i + j) % 2 ? 0x9c1a1a : 0x6e0c0c;
      p.paintPixel(ix + i, iy + j, c);
    }
    let bx = ix;
    let by = iy;
    if (!p.solidAt(bx, by)) {
      let best = 1e9;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        if (p.solidAt(ix + i, iy + j) && i * i + j * j < best) {
          best = i * i + j * j;
          bx = ix + i;
          by = iy + j;
        }
      }
    }
    const local = p.worldToLocal(at.x, at.y);
    const ll = Math.hypot(local.x, local.y) || 1;
    l.wounds.push({ ix: bx, iy: by, dx: local.x / ll, dy: local.y / ll, rate, spurt });
  }

  /**
   * Blows a limb apart: it breaks up into a few pieces (see Chunks.breakUp()),
   * flung `dir` (a blast's way) if given, in a burst of blood. What hung from it
   * is cut loose, hanging on from the piece it was joined to.
   */
  gib(l: Limb, dir?: V2): void {
    if (l.gone) return;
    // (a few at once wait their turn: see Chunks.gibNow())
    const later = () => {
      if (!this.destroyed) this.gib(l, dir);
    };
    if (!gibNow(this.game, l, later)) return;
    const p = l.part;
    const hung = l.children.filter((c) => !c.severed && !c.gone);
    for (const c of hung) this.sever(c, 'blast');
    if (l.joint) this.sever(l, 'blast');
    const ps = this.game.particles;
    const d = dir ?? { x: 0, y: 1 };
    if (this.variant.bleeds) {
      ps.splatter(p.x, p.y, d.x, d.y + 0.3, 50, 6, Math.PI, null);
      for (let i = 0; i < 12; i++) {
        const c = [0x8e1a1a, 0x6b0e0e, 0xc46b6b, 0xe3d9c4][i % 4];
        ps.debris(p.x, p.y, Math.random() - 0.5, 1, 1, c, 5);
      }
      this.game.sound.gib(p.x);
    } else {
      ps.sparks(p.x, p.y, 0, 1, 25, 7);
      ps.debris(p.x, p.y, 0, 1, 10, 0x59616b, 5);
      this.game.sound.impact('metal', 1, p.x);
      this.game.sound.spark(p.x);
    }
    breakUp(this, l, this.variant.bleeds ? FLESH : PLATING, hung, dir);
    l.gone = true;
    if (l.spec.key === 'head' || l.spec.key === 'upperTorso') this.die();
    this.removePart(p);
  }

  removePart(p: Part): void {
    const l = this.limbOf(p);
    if (l && !l.gone) {
      l.gone = true;
      for (const c of l.children) {
        if (c.joint && c.joint.isValid()) this.game.physics.world.removeImpulseJoint(c.joint, true);
        c.joint = null;
        c.severed = true;
        const mark = (x: Limb) => {
          x.attached = false;
          x.children.forEach(mark);
        };
        mark(c);
      }
      if (l.spec.key === 'head' || l.spec.key === 'upperTorso') this.die();
    }
    super.removePart(p);
  }

  // ---------------------------------------------------------------- UI / state

  heal(): void {
    // (without a head nothing brings them back: it would only start the clock again)
    const head = this.L('head');
    if (!this.alive && (head.gone || !head.attached)) return;
    this.rouse();
    for (const k of Object.keys(this.drugs) as (keyof typeof this.drugs)[]) this.drugs[k] = 0;
    this.stiffen(false);
    this.stunned = 0;
    this.alive = true;
    this.consciousness = 1;
    this.blood = 100;
    this.pain = 0;
    this.shock = 0;
    this.limp = false;
    this.deathT = 0;
    this.breath.reset();
    for (const l of this.order) {
      if (l.gone) continue;
      l.part.hp = l.part.maxHp;
      l.wounds.length = 0;
      l.broken = false;
      l.part.burning = 0;
      l.part.charred = 0;
      l.part.refreshTint();
      // (the blood and scorching washed off too; bandages stay on)
      washBlood(l.part, 1);
    }
    this.setFace();
    this.setState('down');
    this.updateMotors(true);
  }

  /** `part`: the limb right-clicked (its bone can be broken or mended). */
  contextActions(part?: Part): ContextAction[] {
    const acts: ContextAction[] = [];
    const seat = this.seat;
    if (seat) acts.push({ label: 'Get out', action: () => seat.leave() });
    if (this.alive) acts.push({ label: 'Jump', hint: 'J', disabled: this.state !== 'stand', action: () => this.jump() });
    if (this.grips.length) {
      acts.push({ label: 'Use held item', hint: 'F', action: () => this.activate() });
      acts.push({ label: this.grips.length > 1 ? 'Drop items' : `Drop ${this.grips[0].item.label.toLowerCase()}`, action: () => this.dropAll() });
    }
    if (this.alive) {
      acts.push({ label: 'Kill', action: () => this.die() });
      acts.push({ label: 'Limp', checked: this.limp, action: () => { this.limp = !this.limp; this.setState('down'); this.updateMotors(true); } });
      if (this.foe) acts.push({ label: 'Stop fighting', action: () => this.stopFighting() });
      acts.push({ label: 'Wander about', checked: this.wander, action: () => { this.wander = !this.wander; if (!this.wander) this.stay(4); else this.goalT = 0; } });
      // (picked again, a pose is let go of)
      for (const [p, label] of POSE_NAMES) acts.push({ label, checked: this.pose === p, action: () => this.setPose(this.pose === p ? null : p) });
    }
    const headless = this.L('head').gone || !this.L('head').attached;
    // (an android is repaired)
    acts.push({ label: this.variant.kind === 'android' ? 'Repair' : this.alive ? 'Heal' : 'Revive', disabled: !this.alive && headless, action: () => this.heal() });
    // the limb right-clicked: its bone broken, or mended (not the skull)
    const l = part ? this.limbOf(part) : undefined;
    if (l && !l.gone && l.joint && l.spec.key !== 'head') {
      acts.push(l.broken ? { label: 'Mend bone', action: () => this.setBroken(l, false) } : { label: 'Break bone', action: () => this.setBroken(l, true) });
    }
    return acts;
  }

  // ---------------------------------------------------------------- holding

  private gripSig(): string {
    return this.grips.map((g) => g.hand.spec.key + (g.support ? '+' : '')).join(',');
  }

  /** Is this arm segment involved in holding something? */
  private armRole(l: Limb): { role: 'aim' | 'support'; seg: 'upper' | 'lower' | 'hand'; grip: Grip } | null {
    if (!this.grips.length) return null;
    const k = l.spec.key;
    const side = k.endsWith('F') ? 'F' : k.endsWith('B') ? 'B' : '';
    if (!side || !(k.startsWith('upperArm') || k.startsWith('lowerArm') || k.startsWith('hand'))) return null;
    const seg = k.startsWith('upperArm') ? 'upper' : k.startsWith('lowerArm') ? 'lower' : 'hand';
    for (const g of this.grips) {
      if (g.hand.spec.key.endsWith(side)) return { role: 'aim', seg, grip: g };
      if (g.support && g.support.hand.spec.key.endsWith(side)) return { role: 'support', seg, grip: g };
    }
    return null;
  }

  private handBusy(l: Limb): boolean {
    return this.grips.some((g) => g.hand === l || g.support?.hand === l);
  }

  /** Called when an item is dropped near this person: grab it if a hand is close. */
  tryHold(item: Item, at?: V2): boolean {
    if (!this.alive || this.zombie || this.consciousness < 0.3 || item.holder || !item.hold || this.destroyed) return false;
    const gw = item.gripWorld();
    if (!gw) return false;
    let best: Limb | null = null;
    let bd = Infinity;
    for (const k of ['handF', 'handB'] as LimbKey[]) {
      const l = this.L(k);
      if (!this.ok(k) || this.handBusy(l) || l.part.frozen) continue;
      if (Math.hypot(item.main.vx - l.part.vx, item.main.vy - l.part.vy) > TAKE_SPEED) continue;
      // the hand must touch the item (long guns can't always get their grip right
      // onto the hand because the body is in the way)
      const touch = distToSprite(item.main, l.part.x, l.part.y);
      const d = Math.hypot(l.part.x - gw.x, l.part.y - gw.y);
      // or the item was let go with the cursor right on the hand (its body may have
      // been held back by the person while the cursor went through)
      const aim = at ? Math.hypot(l.part.x - at.x, l.part.y - at.y) : Infinity;
      const aimed = aim < 0.3 && distToSprite(item.main, at!.x, at!.y) < 0.6;
      // or it was shoved into them on the way and pushed the hand a little off the cursor
      const shoved = aim < 0.6 && this.touching(item);
      if ((d < 0.3 || touch < 0.15 || aimed || shoved) && d < bd) {
        bd = d;
        best = l;
      }
    }
    if (!best) return false;
    let it = item;
    if (it.flipped !== this.flipped) {
      // items always face the way the person faces
      const flipped = this.game.flipEntity(it) as Item | null;
      if (!flipped) return false;
      it = flipped;
    }
    this.attach(it, best);
    return true;
  }

  /** Is the item pressing against any part of this person? */
  private touching(item: Item): boolean {
    const world = this.game.physics.world;
    const mine = new Set(this.parts.filter((p) => !p.destroyed).map((p) => p.body.handle));
    for (const c of item.main.colliders) {
      let hit = false;
      world.contactPairsWith(c, (other) => {
        const b = other.parent();
        if (hit || !b || !mine.has(b.handle)) return;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) hit = true;
        });
      });
      if (hit) return true;
    }
    return false;
  }

  /** Puts the item in the hand (and the other hand on its second grip, if `support` and it's free); `quiet`: no sound. */
  private attach(item: Item, hand: Limb, support = true, quiet = false): void {
    const world = this.game.physics.world;
    const f = this.f;
    const hp = hand.part;
    const ip = item.main;
    // the item lines up with the hand, pointing where the fingers point
    const itemAngle = hp.body.rotation() - (f * Math.PI) / 2;
    const ha = { x: 0, y: -1 * PX };
    const hw = hp.localToWorld(ha.x, ha.y);
    const gl = item.gripLocal()!;
    const rg = rotate(gl.x, gl.y, itemAngle);
    ip.teleport(hw.x - rg.x, hw.y - rg.y, itemAngle);
    ip.body.setLinvel(hp.body.linvel(), true);
    ip.body.setAngvel(hp.body.angvel(), true);
    const joint = world.createImpulseJoint(RAPIER.JointData.fixed(ha, 0, gl, (f * Math.PI) / 2), hp.body, ip.body, true);
    joint.setContactsEnabled(false);
    // the item never collides with its holder
    for (const l of this.order) {
      if (l.gone) continue;
      ip.noCollideWith(l.part);
      l.part.noCollideWith(ip);
    }
    let steady: Grip['support'] = null;
    const g2 = support ? item.gripLocal(true) : null;
    if (g2) {
      const other = this.L(hand.spec.key === 'handF' ? 'handB' : 'handF');
      if (this.ok(other.spec.key) && !this.handBusy(other)) {
        const sj = world.createImpulseJoint(RAPIER.JointData.spring(0, 260, 3, ha, g2), other.part.body, ip.body, true);
        sj.setContactsEnabled(false);
        steady = { hand: other, joint: sj };
      }
    }
    item.holder = this;
    this.dropped = this.dropped.filter((d) => d.item !== item);
    this.grips.push({ item, hand, joint, support: steady, t: 0 });
    // A hand is ~1000x lighter (rotationally) than a rifle, which leaves the joint's
    // angular lock badly conditioned; give the hand some of the item's inertia.
    hp.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, hand.extraI + ip.body.principalInertia() * 0.5, true);
    this.activatable = true;
    if (!quiet) this.game.sound.impact(ip.mat.sound, 0.25, hp.x);
    this.updateMotors(true);
  }

  dropItem(item: Item): void {
    const i = this.grips.findIndex((g) => g.item === item);
    if (i < 0) return;
    const g = this.grips[i];
    this.grips.splice(i, 1);
    const world = this.game.physics.world;
    if (g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
    if (g.support && g.support.joint.isValid()) world.removeImpulseJoint(g.support.joint, true);
    if (!g.hand.part.destroyed) g.hand.part.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, g.hand.extraI, true);
    if (item.holder === this) item.holder = null;
    if (!item.destroyed) {
      this.dropped.push({ item, t: 0.3 });
      item.setActiveHeld(false);
    } else this.forgetItem(item);
    this.activatable = this.grips.length > 0;
    this.updateMotors(true);
  }

  dropAll(): void {
    for (const g of [...this.grips]) this.dropItem(g.item);
  }

  /** Restores contacts between a dropped item and this body. */
  private forgetItem(item: Item): void {
    const ip = item.main;
    for (const l of this.order) {
      ip.collideWith(l.part);
      l.part.collideWith(ip);
    }
  }

  private updateGrips(dt: number): void {
    for (const g of [...this.grips]) {
      const it = g.item;
      if (it.destroyed || !g.joint.isValid() || g.hand.gone || g.hand.part.destroyed || this.consciousness < 0.15) {
        this.dropItem(it);
        continue;
      }
      // a hard yank rips the item out of the hand (twice as hard on Ultra Strength)
      const a = g.hand.part.localToWorld(0, -PX);
      const b = it.gripWorld()!;
      if (Math.hypot(a.x - b.x, a.y - b.y) > (this.might > 1 ? 0.2 : 0.1)) {
        this.dropItem(it);
        continue;
      }
      if (g.support && (!g.support.joint.isValid() || g.support.hand.gone || !g.support.hand.attached)) {
        if (g.support.joint.isValid()) this.game.physics.world.removeImpulseJoint(g.support.joint, true);
        g.support = null;
        this.updateMotors(true);
      }
    }
    for (let i = this.dropped.length - 1; i >= 0; i--) {
      const d = this.dropped[i];
      d.t -= dt;
      if (d.item.destroyed) {
        this.dropped.splice(i, 1);
        continue;
      }
      if (d.t > 0) continue;
      const overlapping = this.order.some((l) => !l.gone && this.game.physics.overlaps(l.part, d.item.main));
      if (overlapping) d.t = 0.1;
      else {
        this.forgetItem(d.item);
        this.dropped.splice(i, 1);
      }
    }
  }

  /**
   * Keeps held items pointing straight ahead: a PD torque on the item, reacted on
   * the torso (the arm muscles shape the pose, this holds the aim).
   */
  private aim(str: number, dt: number): void {
    const torso = this.L('upperTorso').part;
    for (const g of this.grips) {
      const ip = g.item.main;
      if (ip.frozen) continue;
      g.t += dt;
      const m = ip.mass;
      // (a weapon in a fight: held on the shoulder, and swung round hard (see
      // swingPath()); a gun aimed at the foe: tipped onto them)
      const swung = this.swingAt?.item === g.item;
      const want = swung ? this.swingAt!.angle : (g.item.hold?.angle ?? 0) + (this.aiming ? this.tilt : 0);
      const err = wrapAngle(this.f * want - ip.body.rotation());
      // a gentle trim on top of the arm pose (the arm muscles do the lifting)
      const ramp = clamp(g.t / 0.8, 0, 1) * str * (!swung ? 1 : this.blow?.item === g.item ? 3 : 1.5);
      const kp = (30 + 20 * m) * ramp;
      const kd = (2.5 + 1.2 * m) * ramp;
      const cap = (6 + 5 * m) * ramp;
      const tau = clamp(kp * err - kd * (ip.body.angvel() - torso.body.angvel() * 0.5), -cap, cap);
      ip.body.applyTorqueImpulse(tau * dt, true);
      if (!torso.frozen) torso.body.applyTorqueImpulse(-tau * dt, true);
    }
  }

  /**
   * Joint targets (relative, radians) for arms holding items: the aiming hand is
   * placed in front of the shoulder (tucked in for two-handed items) so the item
   * points straight ahead, and a supporting hand reaches for the second grip.
   */
  private holdIK(): Partial<Record<LimbKey, number>> | null {
    if (!this.grips.length) return null;
    const out: Partial<Record<LimbKey, number>> = {};
    const f = this.f;
    for (const g of this.grips) {
      const side = g.hand.spec.key.endsWith('F') ? 'F' : 'B';
      if (!this.shoulder(side)) continue;
      const g1 = g.item.gripLocal();
      const g2 = g.support ? g.item.gripLocal(true) : null;
      const span = g1 && g2 ? Math.abs(g2.x - g1.x) : 0;
      const { x: reach, y: drop } = this.holdReach(g);
      const aim = this.armIK(side, reach, drop, (g.item.hold?.angle ?? 0) + (this.aiming ? this.tilt : 0));
      if (aim) {
        out[('upperArm' + side) as LimbKey] = aim.upper;
        out[('lowerArm' + side) as LimbKey] = aim.lower;
        out[('hand' + side) as LimbKey] = aim.hand;
      }
      if (g.support) {
        const s2 = g.support.hand.spec.key.endsWith('F') ? 'F' : 'B';
        // where the second grip will be once the aiming arm is in place
        const sup = this.armIK(s2, reach + f * span, drop + (g2 && g1 ? g2.y - g1.y : 0), null);
        if (sup) {
          out[('upperArm' + s2) as LimbKey] = sup.upper;
          out[('lowerArm' + s2) as LimbKey] = sup.lower;
          out[('hand' + s2) as LimbKey] = sup.hand;
        }
      }
    }
    return out;
  }

  /** Where the hand holding an item goes (relative to the shoulder: see armIK()): out in front, tucked in for a two-handed one. */
  private holdReach(g: Grip): V2 {
    const g1 = g.item.gripLocal();
    const g2 = g.support ? g.item.gripLocal(true) : null;
    const span = g1 && g2 ? Math.abs(g2.x - g1.x) : 0;
    return { x: this.f * (g2 ? clamp(0.6 - span, 0.24, 0.6) : 0.64), y: g2 ? -0.1 : -0.03 };
  }

  private shoulder(side: 'F' | 'B'): V2 | null {
    const upper = this.L(('upperArm' + side) as LimbKey);
    if (upper.gone || !upper.attached) return null;
    return this.L('upperTorso').part.localToWorld(upper.a1.x, upper.a1.y);
  }

  /**
   * Two-link IK (shoulder -> elbow -> palm) toward a point given relative to the
   * shoulder in the torso's frame. Working in the torso frame keeps the targets
   * constant: correcting for body lean through the shoulder would push the torso
   * further over (the aim controller handles the remaining tilt).
   * With `itemAngle`, the wrist turns so a held item points at that angle.
   */
  private armIK(side: 'F' | 'B', dx: number, dy: number, itemAngle: number | null): { upper: number; lower: number; hand: number } | null {
    const upper = this.L(('upperArm' + side) as LimbKey);
    if (upper.gone || !upper.attached) return null;
    const f = this.f;
    const L1 = 10 * PX;
    const L2 = 12 * PX;
    const d = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.002);
    const alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const gamma = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    // elbows bend forward: counter-clockwise for a right-facing body
    const theta1 = Math.atan2(dy, dx) - f * alpha + Math.PI / 2;
    let up = wrapAngle(theta1);
    const spec = upper.spec;
    up = f === 1 ? clamp(up, spec.lo!, spec.hi!) : clamp(up, -spec.hi!, -spec.lo!);
    const lower = f * (Math.PI - gamma);
    const theta2 = up + lower;
    const hand = itemAngle !== null ? clamp(wrapAngle(f * (Math.PI / 2 + itemAngle) - theta2), -1, 1) : 0;
    return { upper: up, lower, hand };
  }

  /** Items in hand (for tests and UI). */
  heldItems(): Item[] {
    return this.grips.map((g) => g.item);
  }

  /** Use: works what's in hand; a weapon with nothing to switch on (a bat, a sword) is swung instead. */
  activate(): void {
    for (const g of this.grips) {
      if (g.item.def.category === 'Melee' && g.item.activate === Entity.prototype.activate) this.swing(g.item);
      else g.item.activate();
    }
  }

  /** A swing of what's in hand at whatever is in front of them (see strike()). */
  private swing(item: Item): void {
    if (this.blow || this.state !== 'stand' || this.consciousness < 0.5) return;
    this.throwBlow(item);
  }

  setActiveHeld(on: boolean): void {
    super.setActiveHeld(on);
    for (const g of this.grips) g.item.setActiveHeld(on);
  }

  /**
   * Puts them on a side (see Teams), in its colour: a person's shirt, an android's
   * chest panel and shoulders. Null: on none (in their own clothes again).
   */
  setTeam(team: TeamId | null): void {
    this.team = team;
    for (const k of SHIRT) {
      const l = this.limbs.get(k);
      if (l && !l.gone) dress(l.part, this.teamArt(k, team));
    }
    // (their own side is left be)
    if (this.foe && allies(this, this.foe)) this.stopFighting();
    this.scanT = 0;
  }

  /** The sprite a part wears on a team (or on none). */
  private teamArt(k: LimbKey, team: TeamId | null): PixelArt {
    const { kind } = this.variant;
    // (a zombie in the clothes they had on, its skin grey-green)
    const skin = this.zombie && kind === 'human' ? { ...this.variant.skin, skin: ZOMBIE_SKIN } : this.variant.skin;
    const skinKey = this.zombie && kind === 'human' ? `${this.variant.skinKey}+zombie` : this.variant.skinKey;
    if (!team) return limbArt(kind, k, skin, skinKey);
    if (kind === 'human') return limbArt(kind, k, { ...skin, shirt: TEAMS[team].ramp }, `${skinKey}+${team}`);
    // (an android has no shirt: its chest panel, and a band round each shoulder)
    const base = limbArt(kind, k, skin, skinKey);
    if (k === 'upperTorso') return dye(`${kind}:${skinKey}:${k}`, base, team, 4, 8, 2, 8);
    if (k === 'upperArmF' || k === 'upperArmB') return dye(`${kind}:${skinKey}:${k}`, base, team, 2, 5);
    return base;
  }

  protected onDestroy(): void {
    this.foe = null;
    this.blow = null;
    this.fetch = null;
    this.freeWeapon(null);
    this.tendons?.clear();
    this.dropAll();
    for (const d of this.dropped) if (!d.item.destroyed) this.forgetItem(d.item);
    this.dropped.length = 0;
  }

  /** Short status line (shown in tooltips/tests). */
  status(): string {
    // (on adrenaline: how much faster it has them going)
    const drugs = (Object.keys(this.drugs) as (keyof typeof this.drugs)[]).filter((k) => this.drugs[k] > 0)
      .map((k) => ` · ${k}${k === 'adrenaline' && this.rush > 1.05 ? ` ×${this.rush.toFixed(1)}` : ''}`).join('');
    const undead = this.zombie ? ' · zombie' : this.infection > 0 ? ' · infected' : '';
    return `${this.alive ? (this.consciousness > 0.3 ? 'conscious' : 'unconscious') : 'dead'} · blood ${this.blood.toFixed(0)}%${drugs}${undead} · ${this.state}${this.climbing ? ' · climbing' : this.jumping ? ' · jumping' : ''}`;
  }

  /** Which way they're climbing right now (null: they aren't). */
  get climbKind(): Climb['kind'] | null {
    return this.climbing?.kind ?? null;
  }

  protected serializeExtra(): Record<string, unknown> {
    return {
      alive: this.alive,
      blood: this.blood,
      consciousness: this.consciousness,
      limp: this.limp,
      severed: this.order.filter((l) => l.severed && !l.gone).map((l) => l.spec.key),
      torn: this.order.filter((l) => l.severed && !l.gone && this.tendons?.holds(l.part)).map((l) => l.spec.key),
      broken: this.order.filter((l) => l.broken).map((l) => l.spec.key),
      standing: this.state === 'stand',
      wander: this.wander,
      drugs: { ...this.drugs },
      pain: this.pain,
      shock: this.shock,
      ...(this.stunned > 0 ? { stunned: this.stunned } : {}),
      ...(this.breath.air < 1 || this.breath.spent > 0 ? { breath: [this.breath.air, this.breath.starved, this.breath.spent] } : {}),
      ...(this.infection > 0 ? { infection: this.infection } : {}),
      ...(this.zombie ? { zombie: true } : {}),
      ...(this.pose ? { pose: this.pose } : {}),
      ...(this.alive ? {} : { deathT: this.deathT }),
      // each limb's wounds: where on it, which way they open, how fast they bleed, whether they spurt
      wounds: Object.fromEntries(this.order.filter((l) => !l.gone && l.wounds.length).map((l) => [l.spec.key, l.wounds.map((w) => [w.ix, w.iy, w.dx, w.dy, w.rate, w.spurt ? 1 : 0])])),
      ...(this.team ? { team: this.team } : {}),
    };
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const grips = this.grips.map((g) => ({ item: ref(g.item), hand: g.hand.spec.key })).filter((g) => g.item >= 0);
    // (who they're fighting, if that's saved too)
    const foe = this.foe ? ref(this.foe) : -1;
    if (!grips.length && foe < 0) return undefined;
    return foe >= 0 ? { grips, foe } : { grips };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const foe = typeof links.foe === 'number' ? get(links.foe) : undefined;
    if (foe) this.fight(foe, false);
    for (const g of (links.grips as { item: number; hand: LimbKey }[] | undefined) ?? []) {
      const it = get(g.item) as Item | undefined;
      const hand = this.limbs.get(g.hand);
      if (!it || !it.hold || it.holder || !hand || !this.ok(hand.spec.key) || this.handBusy(hand)) continue;
      if (it.flipped !== this.flipped) continue;
      this.attach(it, hand);
    }
  }

  attachedEntities(): Entity[] {
    return this.grips.map((g) => g.item);
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.limp = !!x.limp;
    this.wander = !!x.wander;
    Object.assign(this.drugs, (x.drugs as Partial<typeof this.drugs>) ?? {});
    this.zombie = x.zombie === true;
    this.infection = typeof x.infection === 'number' && Number.isFinite(x.infection) ? clamp(x.infection, 0, 1) : this.zombie ? 1 : 0;
    const pose = POSE_NAMES.find(([p]) => p === x.pose);
    this.pose = pose ? pose[0] : null;
    // (in a zombie's skin, and their side's colours, before the wounds and blood are painted back on)
    if (this.zombie) this.redress();
    if (isTeamId(x.team)) this.setTeam(x.team);
    // (limbs torn out but still hanging on by flesh are torn out again)
    const torn = (x.torn as LimbKey[]) ?? [];
    for (const k of (x.severed as LimbKey[]) ?? []) {
      const l = this.limbs.get(k);
      if (l && !l.gone) {
        if (torn.includes(k)) this.rupture(l);
        else this.sever(l, 'cut');
      }
    }
    for (const k of (x.broken as LimbKey[]) ?? []) {
      const l = this.limbs.get(k);
      if (l) l.broken = true;
    }
    // (after the severing: cutting them off again opened fresh stumps, and hurt)
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    this.blood = num(x.blood, 100);
    this.consciousness = num(x.consciousness, 1);
    this.pain = num(x.pain, this.pain);
    this.shock = num(x.shock, this.shock);
    this.stunned = num(x.stunned, 0);
    const br: unknown[] = Array.isArray(x.breath) ? x.breath : [];
    this.breath.air = clamp(num(br[0], 1), 0, 1);
    this.breath.starved = Math.max(0, num(br[1], 0));
    this.breath.spent = clamp(num(br[2], 0), 0, 1);
    if (this.variant.material === MAT.flesh) this.L('upperTorso').part.buoyancy = this.breath.buoyancy;
    const wounds = x.wounds as Record<string, unknown[][]> | undefined;
    if (wounds && typeof wounds === 'object') {
      for (const l of this.order) {
        if (l.gone) continue;
        const list = Array.isArray(wounds[l.spec.key]) ? wounds[l.spec.key] : [];
        l.wounds = list
          .filter((w) => Array.isArray(w) && w.slice(0, 5).every((v) => typeof v === 'number' && Number.isFinite(v)))
          .map((w) => ({ ix: w[0] as number, iy: w[1] as number, dx: w[2] as number, dy: w[3] as number, rate: Math.max(0, w[4] as number), spurt: !!w[5] }));
      }
    }
    if (x.alive === false) {
      this.die();
      this.deathT = num(x.deathT, 0);
    }
    // people who were standing stay up (flipping or duplicating someone shouldn't floor them)
    this.setState(x.standing && this.alive && this.consciousness > 0.5 ? 'stand' : 'down');
    this.updateMotors(true);
    // (frozen stiff in the shape they were saved in)
    if (this.drugs.freeze > 0) this.stiffen(true, true);
  }
}

/** Distance from a world point to a part's sprite rectangle (0 inside). */
function distToSprite(p: Part, wx: number, wy: number): number {
  const l = p.worldToLocal(wx, wy);
  const hw = (p.w * PX) / 2;
  const hh = (p.h * PX) / 2;
  const dx = Math.max(0, Math.abs(l.x) - hw);
  const dy = Math.max(0, Math.abs(l.y) - hh);
  return Math.hypot(dx, dy);
}

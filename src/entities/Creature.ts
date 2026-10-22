import { RAPIER } from '../engine/Physics';
import { GRAVITY, PX, WORLD } from '../engine/constants';
import { clamp, rotate, smoothstep, wrapAngle, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import { MAT } from '../world/Materials';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import { creatureArt, creatureFigure, CREATURE_EYE, type CreatureKind } from '../art/creatures';
import type { Drug } from './Syringe';
import { Human } from './Human';

interface CLimbSpec {
  key: string;
  name: string;
  /** Standing-pose center (art px, facing right, y up from the paws). */
  cx: number;
  cy: number;
  layer: number;
  density: number;
  hp: number;
  shape: ShapeSpec;
  parent?: string;
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

interface Species {
  kind: CreatureKind;
  specs: CLimbSpec[];
  /** Figure center height (px), the spawn reference point. */
  midY: number;
  /** Damage multiplier. */
  toughness: number;
  /** Dry friction torque (N*m) in limp joints. */
  friction: number;
  /** Lands on its feet: keeps righting itself in the air. */
  airRight: boolean;
  /** Hip height (px), which sets the length of a stride. */
  hipY: number;
  /** Walking and running speed (m/s), leg swing at a walk (rad) and how far the paws lift (rad). */
  gait: { walk: number; run: number; swing: number; lift: number };
  /** How high (m) a step or box it can leap up onto (0: it can't). */
  jump: number;
  /** Follows people about (dogs) rather than keeping to itself (cats). */
  social: boolean;
  /** Keeps its distance from people (foxes). */
  shy: boolean;
  /** How it carries its tail standing (rad, + up). */
  tail: number;
  /** How fast its wounds drain it (a small animal has less blood to lose). */
  bleedRate: number;
  sounds: { hurt: string; bad: string; pain: string; idle: string; die: string; alarm: string };
}

const box = (w: number, h: number, r: number, x = 0, y = 0): ShapeSpec => ({ kind: 'box', w, h, r, x, y });

/** Builds a quadruped's limbs from its proportions (parents first; chest is the root). */
function legs(
  m: number, frontX: number, backX: number, hipY: number,
  up: [w: number, h: number, cy: number], low: [w: number, h: number, cy: number, knee: number],
  densU: number, densL: number, hpU: number, hpL: number,
): CLimbSpec[] {
  const out: CLimbSpec[] = [];
  for (const side of ['B', 'F'] as const) {
    const near = side === 'F';
    for (const [end, x, parent, lu, hu, ll, hl] of [
      ['Front', frontX, 'chest', -0.9, 1.0, -0.5, 1.6],
      ['Back', backX, 'hips', -1.0, 0.9, -1.6, 0.5],
    ] as const) {
      const layer = (end === 'Back' ? 0 : 2) + (near ? 8 : 0);
      out.push({
        key: `upper${end}${side}`, name: end === 'Front' ? 'Front leg' : 'Hind leg', cx: x, cy: up[2], layer, density: densU, hp: hpU,
        shape: box(up[0], up[1], 1.2), parent, jx: x, jy: hipY, lo: lu, hi: hu, muscle: m, fragility: 1,
      });
      out.push({
        key: `lower${end}${side}`, name: end === 'Front' ? 'Front paw' : 'Hind paw', cx: x, cy: low[2], layer: layer + 1, density: densL, hp: hpL,
        shape: box(low[0], low[1], 1), parent: `upper${end}${side}`, jx: x, jy: low[3], lo: ll, hi: hl, muscle: m, fragility: 0.8,
      });
    }
  }
  return out;
}

const DOG: Species = {
  kind: 'dog',
  midY: 13.5,
  toughness: 1,
  friction: 3,
  airRight: false,
  hipY: 12,
  gait: { walk: 1.1, run: 3.2, swing: 0.42, lift: 0.9 },
  jump: 0.55,
  social: true,
  shy: false,
  tail: 0.15,
  bleedRate: 0.55,
  sounds: { hurt: 'creature/dog_yelp', bad: 'creature/dog_yelp', pain: 'creature/dog_whine', idle: 'creature/dog_bark', die: 'creature/dog_die', alarm: 'creature/dog_bark' },
  specs: [
    { key: 'chest', name: 'Chest', cx: 6, cy: 16, layer: 6, density: 110, hp: 120, shape: box(13, 9, 2), muscle: 0, fragility: 1 },
    { key: 'head', name: 'Head', cx: 17, cy: 22, layer: 7, density: 60, hp: 60, shape: box(10, 7, 2, 0, 0.5), parent: 'chest', jx: 12, jy: 20, lo: -0.6, hi: 0.5, muscle: 260, fragility: 1.8 },
    { key: 'hips', name: 'Hindquarters', cx: -6, cy: 15, layer: 5, density: 110, hp: 110, shape: box(11, 8, 2), parent: 'chest', jx: 0, jy: 16, lo: -0.35, hi: 0.35, muscle: 1800, fragility: 1 },
    { key: 'tail', name: 'Tail', cx: -16, cy: 18, layer: 4, density: 40, hp: 30, shape: box(8, 3, 1.2), parent: 'hips', jx: -12, jy: 17, lo: -0.8, hi: 0.9, muscle: 18, fragility: 0.8 },
    ...legs(1500, 9, -9, 12, [4, 8, 8.5], [4, 7, 3.5, 5.5], 70, 50, 70, 50),
  ],
};

const CAT: Species = {
  kind: 'cat',
  midY: 9.75,
  toughness: 0.85,
  friction: 0.35,
  airRight: true,
  hipY: 8.5,
  gait: { walk: 0.75, run: 2.2, swing: 0.45, lift: 0.9 },
  jump: 0.9,
  social: false,
  shy: false,
  tail: 0.15,
  bleedRate: 0.8,
  sounds: { hurt: 'creature/cat_hiss', bad: 'creature/cat_yowl', pain: 'creature/cat_meow', idle: 'creature/cat_meow', die: 'creature/cat_yowl', alarm: 'creature/cat_hiss' },
  specs: [
    { key: 'chest', name: 'Chest', cx: 4, cy: 11, layer: 6, density: 45, hp: 60, shape: box(8, 6, 1.5), muscle: 0, fragility: 1 },
    { key: 'head', name: 'Head', cx: 11, cy: 15.5, layer: 7, density: 28, hp: 35, shape: box(7, 6, 2, 0, 0), parent: 'chest', jx: 8, jy: 13.5, lo: -0.6, hi: 0.5, muscle: 22, fragility: 1.6 },
    { key: 'hips', name: 'Hindquarters', cx: -3.5, cy: 11, layer: 5, density: 45, hp: 55, shape: box(7, 5, 1.5), parent: 'chest', jx: 0, jy: 11, lo: -0.4, hi: 0.4, muscle: 150, fragility: 1 },
    { key: 'tail', name: 'Tail', cx: -10, cy: 15.5, layer: 4, density: 18, hp: 20, shape: box(3, 7, 1, -1.5, 0), parent: 'hips', jx: -7, jy: 12, lo: -0.7, hi: 1.0, muscle: 2, fragility: 0.8 },
    ...legs(60, 7, -5, 8.5, [3, 5, 6], [3, 4, 2, 4], 48, 40, 35, 28),
  ],
};

const PIG: Species = {
  kind: 'pig',
  midY: 8.5,
  toughness: 1.3,
  friction: 4,
  airRight: false,
  hipY: 6,
  gait: { walk: 0.7, run: 2.2, swing: 0.5, lift: 1.4 },
  jump: 0.2,
  social: false,
  shy: false,
  tail: 0,
  bleedRate: 0.45,
  sounds: { hurt: 'creature/pig_squeal', bad: 'creature/pig_squeal', pain: 'creature/pig_grunt', idle: 'creature/pig_oink', die: 'creature/pig_die', alarm: 'creature/pig_squeal' },
  specs: [
    { key: 'chest', name: 'Chest', cx: 4, cy: 11, layer: 6, density: 110, hp: 150, shape: box(13, 11, 3.5), muscle: 0, fragility: 0.9 },
    { key: 'head', name: 'Head', cx: 14.5, cy: 11.5, layer: 7, density: 75, hp: 80, shape: box(12, 9, 3, 0, -0.5), parent: 'chest', jx: 9.5, jy: 12, lo: -0.5, hi: 0.4, muscle: 700, fragility: 1.5 },
    { key: 'hips', name: 'Hindquarters', cx: -7, cy: 11, layer: 5, density: 110, hp: 140, shape: box(12, 11, 3.5), parent: 'chest', jx: -1.5, jy: 11, lo: -0.3, hi: 0.3, muscle: 2600, fragility: 0.9 },
    { key: 'tail', name: 'Tail', cx: -14.5, cy: 14, layer: 4, density: 30, hp: 20, shape: box(4, 4, 1.5), parent: 'hips', jx: -12.5, jy: 14, lo: -0.6, hi: 0.6, muscle: 6, fragility: 0.8 },
    ...legs(2400, 7, -8, 6, [4, 4, 4.5], [4, 3, 1.5, 2.75], 90, 70, 80, 60),
  ],
};

const FOX: Species = {
  kind: 'fox',
  midY: 11,
  toughness: 0.9,
  friction: 1.2,
  airRight: false,
  hipY: 10,
  gait: { walk: 1.0, run: 3.4, swing: 0.45, lift: 0.9 },
  jump: 0.6,
  social: false,
  shy: true,
  tail: -0.2,
  bleedRate: 0.7,
  sounds: { hurt: 'creature/fox_scream', bad: 'creature/fox_scream', pain: 'creature/fox_whine', idle: 'creature/fox_bark', die: 'creature/fox_die', alarm: 'creature/fox_bark' },
  specs: [
    { key: 'chest', name: 'Chest', cx: 5, cy: 13, layer: 6, density: 40, hp: 70, shape: box(11, 7, 2), muscle: 0, fragility: 1 },
    { key: 'head', name: 'Head', cx: 13.5, cy: 17.5, layer: 7, density: 30, hp: 40, shape: box(9, 6, 2, 0.5, -0.5), parent: 'chest', jx: 9.5, jy: 16, lo: -0.6, hi: 0.5, muscle: 70, fragility: 1.7 },
    { key: 'hips', name: 'Hindquarters', cx: -4.5, cy: 12.5, layer: 5, density: 40, hp: 60, shape: box(10, 7, 2), parent: 'chest', jx: 0, jy: 13, lo: -0.35, hi: 0.35, muscle: 500, fragility: 1 },
    { key: 'tail', name: 'Tail', cx: -14.5, cy: 12, layer: 4, density: 18, hp: 25, shape: box(11, 4, 1.5), parent: 'hips', jx: -9, jy: 13, lo: -0.7, hi: 0.6, muscle: 8, fragility: 0.8 },
    ...legs(300, 6, -6, 10, [3, 7, 7], [3, 6, 3, 4.5], 55, 45, 45, 35),
  ],
};

export const SPECIES: Record<CreatureKind, Species> = { dog: DOG, cat: CAT, pig: PIG, fox: FOX };

/** Catalog picture of a standing animal. */
export function creaturePreview(kind: CreatureKind): HTMLCanvasElement {
  const s = SPECIES[kind];
  return creatureFigure(kind, s.specs.map((l) => [l.key, l.cx, l.cy, l.layer] as [string, number, number, number])).toCanvas(1);
}

export const creatureHalfHeight = (kind: CreatureKind) => SPECIES[kind].midY * PX;

/** Lying down: front paws stretched out ahead, hind legs tucked under (joint angles facing right). */
const POSE_DOWN: Record<string, number> = { head: -0.25, tail: -0.3, upperFront: -0.7, lowerFront: 1.4, upperBack: 0.8, lowerBack: -1.4 };

/** Standing balance (rad/s^2 per rad, per rad/s, cap) and righting while getting up. */
const STAND = { kp: 40, kd: 7, amax: 9, dead: 0.04 };
/** Legs folded up under the body in a leap (facing right). */
const TUCK: Record<string, number> = { upperFront: -0.4, lowerFront: 1.3, upperBack: 0.5, lowerBack: -1.2 };
const RIGHT = { kp: 28, kd: 7, amax: 14 };

interface Wound {
  ix: number;
  iy: number;
  dx: number;
  dy: number;
  rate: number;
  spurt: boolean;
}

interface Limb {
  spec: CLimbSpec;
  part: Part;
  joint: RAPIER.RevoluteImpulseJoint | null;
  parent: Limb | null;
  children: Limb[];
  a1: V2;
  a2: V2;
  severed: boolean;
  gone: boolean;
  broken: boolean;
  attached: boolean;
  wounds: Wound[];
  stress: number;
}

type State = 'stand' | 'down' | 'getup';

/**
 * A four-legged animal: the same kind of muscle-driven ragdoll as a person,
 * with a chest and hindquarters on four two-part legs. It stands on its own,
 * gets back up after a fall, bleeds, breaks, loses limbs and reacts to syringes.
 */
export class Creature extends Entity {
  readonly species: Species;
  readonly limbs = new Map<string, Limb>();
  private order: Limb[] = [];
  private f: 1 | -1;

  alive = true;
  consciousness = 1;
  blood = 100;
  pain = 0;
  shock = 0;
  state: State = 'down';
  limp = false;
  private stateT = 0;
  private airT = 0;
  private leanT = 0;
  private held = false;
  private getupFails = 0;
  /** Where the chest lay when it gave up trying to stand. */
  private gaveUp: V2 | null = null;
  /** Extra tries earned by the pile shifting (see Human.retry). */
  private retries = 0;
  private getupBest = 0;
  private getupProgressT = 0;
  private motorTimer = 0;
  private motorSig = '';
  private t = Math.random() * 100;
  private blendFrom: Map<Limb, number> | null = null;
  /** In a leap: legs tucked up on the way up, then reaching for the ground (it stays reaching once over the top). */
  private legPose: '' | 'tuck' | 'reach' = '';
  /** Joint angles eased out of into the legs' next pose over easeDur s (snapped, the paws whip round). */
  private easeFrom: Map<Limb, number> | null = null;
  private easeT = 0;
  private easeDur = 0;
  /**
   * Seconds left of collapsing: four straight legs hold a body up like a table
   * even when limp, so a body that drops where it stands folds them first.
   */
  private foldT = 0;
  /** Seconds left of tail wagging, and until the next idle sound / wag. */
  private wag = 0;
  private idleT = 8 + Math.random() * 20;
  private voiceT = 0;
  private faceState = 2;
  readonly drugs = { adrenaline: 0, knockout: 0, poison: 0 };
  private mendDose = 0;
  private lifeDose = 0;

  // behaviour (see think())
  private goal: 'idle' | 'walk' | 'flee' = 'idle';
  /** Seconds left of standing about, walking somewhere or running. */
  private goalT = 2 + Math.random() * 4;
  private targetX = 0;
  private following: Human | null = null;
  private fleeFrom = 0;
  /** Direction it last walked into something, to try the other way next. */
  private blocked = 0;
  /** How long it has been trying to walk without getting anywhere, going by its smoothed speed. */
  private stuckT = 0;
  private vxSmooth = 0;
  /** Running scared with something in the way. */
  private cornered = false;
  /** Waiting to leap again at something it just came down from or bounced off. */
  private leapWait = false;
  private turnT = 0;
  /** How long it has been unable to turn round to set off. */
  private turnWait = 0;
  private lookT = 0;
  /** Wanted speed (m/s, + forward), and the phase and strength of the stepping legs. */
  private speed = 0;
  private stride = 0;
  private gaitAmt = 0;
  /** The speed the legs are stepping for: the body's own speed, working up to the wanted one. */
  private pace = 0;
  /** What blockedAhead() last found in the way (null: nothing, or the ground or a wall). */
  private blocker: Part | null = null;
  /** Following someone ahead: the speed to keep to (0: nobody in the way). */
  private pacing = 0;
  /** Seconds into a leap (0: not leaping), and until it may leap again. */
  private jumpT = 0;
  private jumpCool = 0;
  /** Seconds since it last landed from a leap. */
  private landT = 9;

  constructor(game: Game, def: ItemDef, species: Species, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.species = species;
    this.f = this.flipped ? -1 : 1;
    const f = this.f;
    const ang = opts.angle ?? 0;
    const tough = 1 / species.toughness;
    for (const s of species.specs) {
      const off = rotate(s.cx * f * PX, (s.cy - species.midY) * PX, ang);
      const part = this.addPart({
        name: s.name,
        art: creatureArt(species.kind, s.key),
        material: MAT.flesh,
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
        friction: s.key.startsWith('lower') ? 1.0 : undefined,
        forceThreshold: 20,
        textureKey: `${species.kind}:${s.key}`,
      });
      // light links get extra inertia so they don't buzz when squeezed in a pile
      if (s.key.startsWith('lower') || s.key === 'tail' || species.kind === 'cat') {
        part.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, part.body.principalInertia() * 2, true);
      }
      // a tail rests on the floor but passes over everything else: it would drag
      // on whatever the animal climbs over (a body, a crate) and hold it back
      if (s.key === 'tail') part.setOnlyStatic();
      const limb: Limb = {
        spec: s, part, joint: null, parent: null, children: [], a1: { x: 0, y: 0 }, a2: { x: 0, y: 0 },
        severed: false, gone: false, broken: false, attached: true, wounds: [], stress: 0,
      };
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
    this.setState('stand');
  }

  get label(): string {
    return this.def.name + (this.alive ? '' : ' (dead)');
  }

  private L(k: string): Limb {
    return this.limbs.get(k)!;
  }

  private limbOf(p: Part): Limb | undefined {
    for (const l of this.order) if (l.part === p) return l;
    return undefined;
  }

  private ok(k: string): boolean {
    const l = this.limbs.get(k);
    return !!l && !l.gone && l.attached;
  }

  // ---------------------------------------------------------------- control

  canRest(): boolean {
    if (this.held) return false;
    if (this.strength() <= 0) return true;
    // lying down it only whimpers: pain doesn't move it
    if (this.state === 'down') return this.stateT > 3;
    return this.state !== 'getup' && this.stateT > 3 && this.pain < 0.05 && this.wag <= 0 && this.gaitAmt < 0.02;
  }

  private strength(): number {
    if (!this.alive || this.limp) return 0;
    return clamp(this.consciousness * (1 - this.shock * 0.6), 0, 1);
  }

  private legsWork(): boolean {
    let good = 0;
    for (const l of this.order) {
      if (!l.spec.key.startsWith('upper')) continue;
      const low = l.children[0];
      if (this.ok(l.spec.key) && !l.broken && low && this.ok(low.spec.key) && !low.broken && l.part.hp > l.part.maxHp * 0.3) good++;
    }
    // three good legs are enough to stand on
    return good >= 3 && this.ok('hips');
  }

  /** Eases the joints from where they are now into their next targets over `dur` s, instead of snapping them there. */
  private startEase(dur: number): void {
    this.easeFrom = new Map();
    this.easeT = 0;
    this.easeDur = dur;
    for (const l of this.order) {
      if (l.joint && l.parent && !l.gone) this.easeFrom.set(l, wrapAngle(l.part.body.rotation() - l.parent.part.body.rotation()));
    }
  }

  private setState(s: State): void {
    if (this.state === s) return;
    if (s === 'down' && this.state !== 'down') this.foldT = 0.6;
    this.state = s;
    this.stateT = 0;
    if (s === 'getup') {
      this.blendFrom = new Map();
      for (const l of this.order) {
        if (l.joint && l.parent && !l.gone) this.blendFrom.set(l, wrapAngle(l.part.body.rotation() - l.parent.part.body.rotation()));
      }
    } else this.blendFrom = null;
    const ang = s === 'stand' ? 14 : 0.7;
    for (const l of this.order) if (!l.gone) l.part.body.setAngularDamping(ang);
    this.updateMotors(true);
    for (const l of this.order) if (!l.gone && !l.part.frozen) l.part.body.wakeUp();
  }

  private updateMotors(force = false): void {
    const str = this.strength();
    const conscious = str > 0.15;
    const f = this.f;
    const standing = this.state !== 'down' && conscious;
    const ramp = this.state === 'getup' ? clamp(this.stateT / 1.0, 0.15, 1) : 1;
    const wagging = (this.wag > 0 || this.gaitAmt > 0 || this.jumpT > 0) && standing;
    const folding = this.foldT > 0 && !conscious;
    // lying still it relaxes (see Human.updateMotors)
    const relaxed = !standing && conscious && this.pain < 0.35 && this.stateT > 4;
    // limp or relaxed joints only have friction: how strong it is doesn't matter
    // (and re-sending motors wakes the body)
    const tone = standing || (conscious && !relaxed) ? Math.round(str * 50) : -1;
    // (the body's own velocity: the part's copy is from the last step, from before the
    // spring. A little hop down off something doesn't tuck: the legs couldn't reach for
    // the floor again in time, and it would land on its nose)
    const vy = this.L('chest').part.body.linvel().y;
    const legPose = this.jumpT > 0 && standing ? (this.legPose === 'reach' || vy <= 0.3 || (!this.legPose && vy < 1.8) ? 'reach' : 'tuck') : '';
    if (legPose !== this.legPose) {
      // (only tucking up and letting go of it change the targets)
      if (standing && (legPose === 'tuck' || this.legPose === 'tuck')) this.startEase(0.12);
      this.legPose = legPose;
    }
    const ease = this.easeFrom ? smoothstep(0, 1, this.easeT / this.easeDur) : 1;
    const sig = `${standing}:${conscious}:${tone}:${Math.round(ramp * 20)}:${folding}:${relaxed}:${legPose}:${Math.round(ease * 20)}`;
    if (!force && !wagging && sig === this.motorSig) return;
    this.motorSig = wagging ? '' : sig;
    for (const l of this.order) {
      const j = l.joint;
      if (!j || !j.isValid() || l.severed) continue;
      const key = l.spec.key;
      let target = standing ? 0 : POSE_DOWN[key.replace(/[FB]$/, '')] ?? 0;
      if (key === 'head' && standing) target = 0.05;
      if (key === 'tail' && standing) target = this.wag > 0 ? Math.sin(this.t * 14) * 0.45 : this.species.tail;
      if (this.gaitAmt > 0 && standing && /^(upper|lower)/.test(key)) target = this.step(key);
      // legs tucked up on the way up, reaching for the ground on the way down
      if (legPose === 'tuck' && /^(upper|lower)/.test(key)) target = TUCK[key.replace(/[FB]$/, '')] ?? target;
      target *= f;
      const from = this.blendFrom?.get(l);
      if (from !== undefined) target = from + (target - from) * smoothstep(0, 1, this.stateT / 0.9);
      else if (ease < 1) {
        const e = this.easeFrom?.get(l);
        if (e !== undefined) target = e + (target - e) * ease;
      }
      // just come down from a leap: legs that give with the landing, firming up
      // again gradually (landing on stiff legs it bounces and pitches over more
      // often; snapped back to full strength they spring it off again)
      const soft = this.landT < 0.4 && /^(upper|lower)/.test(key) ? 0.35 + 0.65 * smoothstep(0.05, 0.4, this.landT) : 1;
      const K = l.spec.muscle * soft * (l.broken ? 0.05 : 1) * (l.attached ? 1 : 0);
      if (folding && K > 0) {
        // going limp where it stands: the legs give way
        j.setMotorMaxForce(1e6);
        j.configureMotorPosition(target, K * 0.12, K * 0.0005 + 0.02);
      } else if (!conscious || K <= 0 || relaxed) {
        const fr = this.species.friction * (l.spec.muscle / 1500 + 0.1) * (this.alive ? 1 : 0.7) * (l.broken ? 0.2 : 1);
        j.configureMotorVelocity(0, fr * 30);
        j.setMotorMaxForce(fr);
      } else if (standing) {
        j.setMotorMaxForce(1e6);
        j.configureMotorPosition(target, K * str * ramp, K * str * ramp * 0.003 + 0.3 * K / 1500);
      } else {
        // lying down: the head stays up a little, the legs folded loosely
        j.setMotorMaxForce(1e6);
        const tone = key === 'head' || key === 'tail' ? 0.25 : 0.08;
        j.configureMotorPosition(target, K * tone * str, K * tone * 0.004 + 0.02);
      }
    }
  }

  /** How many paws are on something solid (firm: the ground or something fixed, not a heap of bodies). */
  private pawsDown(firm = false, end = 'lower'): number {
    const world = this.game.physics.world;
    const ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: -1 });
    let n = 0;
    for (const l of this.order) {
      // a paw only counts the right way up (not a leg lying on its side)
      if (!l.spec.key.startsWith(end) || l.gone || !l.attached || Math.abs(wrapAngle(l.part.body.rotation())) > 1.2) continue;
      ray.origin = { x: l.part.x, y: l.part.y };
      const hit = world.castRay(ray, (l.spec.cy + 2) * PX, true, undefined, undefined, undefined, undefined, (c) => {
        const p = this.game.physics.partOf(c);
        return firm ? !p || p.frozen : !p || p.entity !== this;
      });
      if (hit) n++;
    }
    return n;
  }

  /**
   * Come down nose-first off a ledge with its hind legs still hooked up on it (a
   * shoe, the lip of a crate): front paws down, hind paws in the air. Righting
   * would only drive its hind legs into the ledge, and walking on drags them over
   * it and tips it onto its nose.
   */
  private perched(): boolean {
    if (this.tilt().err * this.f > -0.35) return false;
    return this.pawsDown(false, 'lowerFront') > 0 && this.pawsDown(false, 'lowerBack') === 0;
  }

  /** Body tilt from level (rad) and how fast it is turning. */
  private tilt(): { err: number; omega: number } {
    if (this.L('chest').gone) return { err: Math.PI / 2, omega: 0 };
    const c = this.L('chest').part;
    const h = this.ok('hips') ? this.L('hips').part : c;
    const err = wrapAngle(c.body.rotation() + wrapAngle(h.body.rotation() - c.body.rotation()) / 2);
    return { err, omega: (c.body.angvel() + h.body.angvel()) / 2 };
  }

  /** Is any part of the body touching something? */
  private touching(): boolean {
    const world = this.game.physics.world;
    for (const l of this.order) {
      if (l.gone || !l.attached) continue;
      for (const c of l.part.colliders) {
        let hit = false;
        world.contactPairsWith(c, (o) => {
          if (hit || this.game.physics.partOf(o)?.entity === this) return;
          world.contactPair(c, o, (m) => {
            if (m.numContacts() > 0) hit = true;
          });
        });
        if (hit) return true;
      }
    }
    return false;
  }

  /** Is something heavy lying on the body? */
  private pinned(): boolean {
    const world = this.game.physics.world;
    let load = 0;
    for (const k of ['chest', 'hips', 'head']) {
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
    return load > this.totalMass() * 0.4;
  }

  preStep(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    this.voiceT -= dt;
    const str = this.strength();
    const conscious = str > 0.15;
    const paws = this.pawsDown();
    const { err } = this.tilt();
    const tilt = Math.abs(err);
    // no paw on anything and touching nothing at all: falling (worked out below)
    let airborne = false;

    // ---- state machine
    if (!conscious || this.held) {
      if (this.state !== 'down') this.setState('down');
    } else if (this.state === 'stand' || this.state === 'getup') {
      airborne = !paws && !this.touching();
      this.airT = airborne ? this.airT + dt : 0;
      // leaning on something for a while counts as fallen too
      this.leanT = tilt > 0.5 && !airborne ? this.leanT + dt : 0;
      // cats twist round in the air and land on their feet
      this.landT += dt;
      if (this.jumpT > 0) {
        this.jumpT += dt;
        // landed (or it's been too long: it fell instead)
        if ((paws >= 2 && this.jumpT > 0.2) || this.jumpT > 1.4) {
          this.jumpT = 0;
          this.landT = 0;
        }
      }
      // (pitching onto its front paws as it lands, it still has a moment to catch itself)
      const fallen = this.jumpT > 0 || this.landT < 0.5
        ? tilt > 1.2
        : (this.species.airRight ? this.airT > 2.5 || (!airborne && tilt > 1.0) : tilt > 0.95 || this.airT > 0.45) || this.leanT > 1.5;
      // only standing for a while counts as having got up (not toppling off a pile again)
      if (this.state === 'stand' && this.stateT > 3) this.getupFails = this.retries = 0;
      if (!this.legsWork()) this.setState('down');
      else if (this.state === 'stand' && fallen) {
        if (this.stateT < 3) this.failGetup();
        else this.setState('down');
      }
      else if (this.state === 'getup') {
        if (tilt < this.getupBest - 0.05) {
          this.getupBest = tilt;
          this.getupProgressT = this.stateT;
        }
        if (tilt < 0.25 && paws >= 2 && this.stateT > 0.5) this.setState('stand');
        else if (this.stateT - this.getupProgressT > 2.5 || this.stateT > 6) this.failGetup();
      }
    } else {
      const c = this.L('chest').part;
      const rest = Math.hypot(c.vx, c.vy) < 0.6;
      const wait = 1.6 + this.getupFails * 1.5 + this.pain * 4;
      if (this.gaveUp && this.retries < 2 && Math.hypot(c.x - this.gaveUp.x, c.y - this.gaveUp.y) > 0.4) this.retry();
      const inAir = this.species.airRight && !paws && this.stateT > 0.3 && !this.touching();
      airborne = inAir;
      if ((inAir || (!this.gaveUp && this.stateT > wait && rest)) && this.legsWork() && str > 0.7 && this.pain < 0.6 && !this.held && !this.pinned()) {
        this.getupBest = tilt;
        this.getupProgressT = 0;
        this.setState(inAir ? 'stand' : 'getup');
      }
    }

    // ---- muscles
    if (this.foldT > 0) {
      this.foldT -= dt;
      if (this.foldT <= 0) this.updateMotors(true);
    }
    // ---- what to do on its feet
    if (conscious && this.state === 'stand' && !this.held) this.think(dt);
    else {
      this.speed = 0;
      this.goalT -= dt;
    }

    this.motorTimer -= dt;
    // stepping legs follow their gait every step
    if (this.easeFrom && (this.easeT += dt) > this.easeDur) this.easeFrom = null;
    if (this.motorTimer <= 0 || this.gaitAmt > 0 || this.jumpT > 0 || this.easeFrom) {
      this.motorTimer = 0.05;
      this.updateMotors(false);
    }

    // ---- balance: keep the back level (and roll back over when getting up)
    if (conscious && this.state !== 'down') {
      if (this.state === 'getup') {
        // the further over it lies, the harder it has to twist and scramble
        const r = clamp(this.stateT / 0.8, 0.2, 1);
        const over = 1 + Math.abs(err);
        this.right(RIGHT.kp * str * r, RIGHT.kd * str, RIGHT.amax * r * over, 0, false, dt);
        this.lift(str * r * (Math.abs(err) > 1.4 ? 1.3 : 1), dt);
      } else if (this.jumpT > 0 || (this.landT < 1 && Math.abs(err) > 0.2)) {
        // in a leap, and coming down from one (front paws first, it would pitch
        // over onto its nose)
        this.right(RIGHT.kp, RIGHT.kd, RIGHT.amax, 0, false, dt);
      } else if (paws >= 2 || (paws && this.gaitAmt > 0)) this.right(STAND.kp * str, STAND.kd * str, STAND.amax, STAND.dead, true, dt);
      // (only really in the air: propped on a heap with no paw finding footing, it
      // would push every step, never sleep, and keep waking the heap it's on)
      else if (this.species.airRight && airborne) this.right(RIGHT.kp, RIGHT.kd, RIGHT.amax * 1.5, 0, false, dt);
    }

    this.walk(dt, paws);
    this.idle(dt, conscious);
  }

  /**
   * Turns the whole body toward level. Standing uses pure torques on the trunk
   * (the legs pass them to the ground); getting up and air righting rotate the
   * body rigidly about its center of mass.
   */
  private right(kp: number, kd: number, amax: number, dead: number, torqueOnly: boolean, dt: number): void {
    const { err, omega } = this.tilt();
    const e = Math.sign(err) * Math.max(0, Math.abs(err) - dead);
    const alpha = clamp(-kp * e - kd * omega, -amax, amax);
    let mx = 0;
    let my = 0;
    let m = 0;
    const live = this.order.filter((l) => !l.gone && l.attached);
    for (const l of live) {
      mx += l.part.x * l.part.mass;
      my += l.part.y * l.part.mass;
      m += l.part.mass;
    }
    mx /= m;
    my /= m;
    let I = 0;
    for (const l of live) {
      const rx = l.part.x - mx;
      const ry = l.part.y - my;
      I += l.part.mass * (rx * rx + ry * ry) + l.part.body.principalInertia();
    }
    if (torqueOnly) {
      const tau = I * alpha;
      // small corrections leave a still body alone so it can fall asleep, and
      // asleep there is nothing to correct until something wakes it (see Human.balance)
      if (Math.abs(tau) < 1 || this.L('chest').part.body.isSleeping()) return;
      for (const k of ['chest', 'hips']) {
        const l = this.L(k);
        if (l.gone || !l.attached || l.part.frozen) continue;
        l.part.body.applyTorqueImpulse(tau * 0.5 * dt, true);
      }
      return;
    }
    for (const l of live) {
      const p = l.part;
      if (p.frozen) continue;
      const rx = p.x - mx;
      const ry = p.y - my;
      p.body.applyImpulse({ x: -p.mass * alpha * ry * dt, y: p.mass * alpha * rx * dt }, true);
      p.body.applyTorqueImpulse(p.body.principalInertia() * alpha * dt, true);
    }
  }

  /**
   * Getting up: the legs scrabble and push the trunk up off the ground, carrying
   * part of the body's weight until it is back on its feet. Never enough to lift
   * it clear, and it stops once the body is rising.
   */
  private lift(k: number, dt: number): void {
    if (Math.abs(this.tilt().err) < 0.3) return;
    const trunk = ['chest', 'hips'].map((key) => this.L(key)).filter((l) => !l.gone && l.attached && !l.part.frozen);
    let vy = 0;
    let m = 0;
    for (const l of this.order) {
      if (l.gone || !l.attached) continue;
      vy += l.part.vy * l.part.mass;
      m += l.part.mass;
    }
    if (!trunk.length || vy / m > 0.5) return;
    const tm = trunk.reduce((a, l) => a + l.part.mass, 0);
    const F = m * -GRAVITY * 0.7 * k;
    for (const l of trunk) l.part.body.applyImpulse({ x: 0, y: F * (l.part.mass / tm) * dt }, true);
  }

  // ---------------------------------------------------------------- behaviour

  /**
   * Decides where to go while on its feet: it stands about, wanders off a few
   * meters, runs from blasts, gunshots and fire, and dogs go to the nearest
   * person standing.
   */
  private think(dt: number): void {
    this.goalT -= dt;
    this.turnT -= dt;
    this.lookT -= dt;
    this.jumpCool -= dt;
    const c = this.L('chest').part;
    const look = this.lookT <= 0;
    if (look) {
      this.lookT = 0.1;
      this.leapWait = false;
      const fire = this.game.fire.near(c.x, c.y, 2.5, this);
      if (fire) this.scare(fire.x, 2.5);
      // a fox won't let anyone near it
      const near = this.species.shy && this.goal !== 'flee' ? this.nearestPerson(c.x, c.y, 3.5) : null;
      if (near) this.scare(near.limbs.get('upperTorso')!.part.x, 2);
    }
    const g = this.species.gait;
    let speed = 0;
    if (this.goal === 'flee') {
      if (this.goalT <= 0) this.rest();
      else speed = (Math.sign(c.x - this.fleeFrom) || this.f) * g.run;
    } else if (this.goal === 'walk') {
      const h = this.following;
      const tx = h ? (h.alive && h.state === 'stand' && !h.destroyed ? h.limbs.get('upperTorso')!.part.x : NaN) : this.targetX;
      const near = h ? 1.3 : 0.2;
      const dx = tx - c.x;
      if (Number.isNaN(dx) || Math.abs(dx) < near || this.goalT <= 0) {
        // glad to see them
        if (h && Math.abs(dx) < near * 1.5) this.wag = 1.5 + Math.random() * 1.5;
        this.rest();
      } else speed = Math.sign(dx) * g.walk * clamp(Math.abs(dx) / 0.6, 0.4, 1);
    } else if (this.goalT <= 0) this.decide();
    // it can only walk forwards: facing the wrong way, turn round first
    if (speed && Math.sign(speed) !== this.f && !this.turn()) {
      // no room to turn (someone at their heels): after a while, give up and go
      // some other time (running scared, keep trying)
      this.turnWait += dt;
      if (this.turnWait > 1.5 && this.goal !== 'flee') {
        this.blocked = Math.sign(speed);
        this.rest();
      }
      speed = 0;
    } else this.turnWait = 0;
    // something in the way (another animal, a person, a crate): stop short rather
    // than climb it (running scared, it keeps looking for a way through)
    let drop = speed && look && this.jumpT <= 0 ? this.dropAhead() : { depth: 0, edge: 0 };
    // front half already over an edge, hind paws still up on it: hop the rest of the way
    if (speed && look && this.jumpT <= 0 && !drop.depth) drop = this.hangingOver();
    if (this.jumpT > 0) {
      // in the air: keep going
    } else if (speed && look && this.blockedAhead() && this.leap()) {
      // up onto it
    } else if (drop.depth > 0.15 && drop.depth < 2.5 && this.hopDown(drop.edge)) {
      // down off a ledge
    } else if (speed && this.species.jump && this.jumpCool > 0 && (look ? this.blockedAhead() && !this.blocker?.entity.upright : this.leapWait)) {
      // just landed, or bounced off it: a moment before trying again
      this.leapWait = true;
      speed = 0;
    } else if (speed && drop.depth < 2.5 && (look ? this.blockedAhead() && this.blockerPace() > 0.3 : this.pacing > 0)) {
      // someone ahead going the same way: fall in behind them at their pace (until
      // it next looks, too)
      if (look) {
        this.pacing = this.blockerPace() * 0.9;
        this.cornered = false;
      }
      speed = Math.sign(speed) * Math.min(Math.abs(speed), this.pacing);
    } else if (speed && (drop.depth >= 2.5 || (look ? this.blockedAhead() : this.cornered))) {
      this.pacing = 0;
      this.blocked = this.f;
      speed = 0;
      if (this.goal === 'flee') this.cornered = true;
      else this.rest();
    } else if (look) {
      this.cornered = false;
      this.pacing = 0;
    }
    // walked into something: give up and try elsewhere later (smoothed: the chest
    // bobs about while the legs paddle on the spot)
    this.vxSmooth += (this.trunkVx() - this.vxSmooth) * Math.min(1, dt / 0.25);
    this.stuckT = speed && this.vxSmooth < Math.abs(speed) * 0.25 ? this.stuckT + dt : 0;
    // caught on something too low for it to have seen: try leaping it (from right
    // up against it), or at least a hop, first
    if (this.stuckT > 0.8 && this.jumpT <= 0 && !this.leap(true)) this.scramble();
    if (this.stuckT > 2) {
      this.stuckT = 0;
      this.blocked = Math.sign(speed);
      speed = 0;
      this.rest();
    }
    // hung up on the ledge it hopped off: a hop the rest of the way
    if (this.landT > 0.3 && this.landT < 1 && this.jumpT <= 0 && this.perched()) this.hopDown(0);
    // pitched back coming down from a leap: steady itself before walking on (pitched
    // onto its front paws it keeps going: pulling up short tips it over them)
    if (this.landT < 1 && this.tilt().err * this.f > 0.35) speed = 0;
    this.speed = Math.abs(speed);
  }

  /** Sends it walking to x (scripts and tests); it gets there if nothing is in the way. */
  goTo(x: number): void {
    this.goal = 'walk';
    this.following = null;
    this.targetX = x;
    this.goalT = 6 + Math.abs(x - this.L('chest').part.x) * 2;
  }

  /** Stands about for `secs` seconds before deciding what to do next (scripts and tests). */
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

  /** Done standing about: off somewhere, or stays put a while longer. */
  private decide(): void {
    const c = this.L('chest').part;
    const h = this.species.social ? this.nearestPerson(c.x, c.y, 18) : null;
    const hx = h ? h.limbs.get('upperTorso')!.part.x : 0;
    if (h && Math.abs(hx - c.x) > 2.2 && this.clearTo(Math.sign(hx - c.x))) {
      this.goal = 'walk';
      this.following = h;
      this.goalT = 25;
      return;
    }
    // standing on a heap of bodies or junk it stays put rather than stir it all up again
    if (this.pawsDown(true) < 2) {
      this.rest();
      this.goalT += 10 + Math.random() * 20;
      return;
    }
    if (Math.random() < 0.6) {
      // mostly away from whatever stopped it last time
      let dir = this.blocked ? -this.blocked : Math.random() < 0.5 ? -1 : 1;
      this.blocked = 0;
      if (!this.clearTo(dir)) dir = -dir;
      if (!this.clearTo(dir)) {
        // hemmed in (in a crowd, on a heap of bodies): it stays put, and stays still
        this.rest();
        this.goalT += 10 + Math.random() * 20;
        return;
      }
      const dist = 1 + Math.random() * 3.5;
      this.goal = 'walk';
      this.following = null;
      this.targetX = clamp(c.x + dir * dist, WORLD.left + 2, WORLD.right - 2);
      this.goalT = 6 + dist * 2;
    } else this.rest();
  }

  /** Room to set off that way, turning round first if it has to? */
  private clearTo(dir: number): boolean {
    return dir === this.f ? !this.blockedAhead() : !this.blockedAhead(true, 0.35);
  }

  private rest(): void {
    this.goal = 'idle';
    this.following = null;
    this.goalT = 3 + Math.random() * 8;
  }

  private nearestPerson(x: number, y: number, r: number): Human | null {
    let best: Human | null = null;
    let bd = r;
    for (const e of this.game.entities) {
      if (!(e instanceof Human) || e.destroyed || !e.alive || e.state !== 'stand') continue;
      const t = e.limbs.get('upperTorso')!.part;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Runs away from x for a few seconds. */
  private scare(fromX: number, secs: number): void {
    if (!this.alive) return;
    if (this.goal !== 'flee') {
      this.goalT = 0;
      if (this.voiceT <= 0 && this.consciousness > 0.5 && this.state === 'stand') {
        this.voiceT = 1.5;
        this.game.sound.play(this.species.sounds.alarm, { gain: 0.45, x: this.L('chest').part.x });
      }
    }
    this.goal = 'flee';
    this.following = null;
    this.fleeFrom = fromX;
    this.goalT = Math.max(this.goalT, secs);
  }

  onAlarm(x: number, y: number, radius: number): void {
    if (!this.alive || this.consciousness < 0.3 || this.L('chest').gone) return;
    const c = this.L('chest').part;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d > radius) return;
    // close by, it scrambles up off the floor to get away
    if (this.state === 'down' && d < radius * 0.6) this.rouse();
    this.scare(x, 2.5 + 4 * (1 - d / radius));
  }

  /**
   * Is there something solid just ahead (or behind: back = true), at head,
   * chest or knee height, within `margin` m of the nose (or tail)?
   */
  private blockedAhead(back = false, margin = 0.35): boolean {
    const c = this.L('chest').part;
    const cx = this.L('chest').spec.cx;
    let ext = 0;
    for (const s of this.species.specs) {
      if (s.shape.kind === 'box') ext = Math.max(ext, back ? cx - (s.cx - s.shape.w / 2) : s.cx + s.shape.w / 2 - cx);
    }
    const reach = ext * PX + margin;
    const world = this.game.physics.world;
    const ray = new RAPIER.Ray({ x: c.x, y: c.y }, { x: back ? -this.f : this.f, y: 0 });
    // head height too: a cat would walk in under a dog's belly
    const head = this.ok('head') ? this.L('head').part.y : c.y;
    this.blocker = null;
    for (const y of [head, c.y, c.y - this.species.hipY * 0.45 * PX]) {
      ray.origin = { x: c.x, y };
      const hit = world.castRay(ray, reach, true, undefined, undefined, undefined, undefined, (o) => {
        const p = this.game.physics.partOf(o);
        return !p || p.entity !== this;
      });
      if (hit) {
        this.blocker = this.game.physics.partOf(hit.collider) ?? null;
        return true;
      }
    }
    return false;
  }

  /** How fast what's in the way is going the same way (m/s; 0 if it isn't). */
  private blockerPace(): number {
    const b = this.blocker;
    if (!b || b.destroyed || !b.entity.canWalk) return 0;
    return Math.max(0, b.vx * this.f);
  }

  /**
   * Something low in the way that it can get up onto (a box, a step, someone lying
   * down: not anyone on their feet), with room on top: it leaps. Returns whether it
   * did. `close`: already right up against it (it springs from where it stands).
   */
  private leap(close = false): boolean {
    const J = this.species.jump;
    if (!J || this.jumpCool > 0 || this.pawsDown() < 2 || this.tethered()) return false;
    const c = this.L('chest').part;
    const world = this.game.physics.world;
    const mine = (o: RAPIER.Collider) => this.game.physics.partOf(o)?.entity === this;
    const down = new RAPIER.Ray({ x: c.x, y: c.y }, { x: 0, y: -1 });
    const floor = world.castRay(down, 1.5, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
    if (!floor) return false;
    const groundY = c.y - floor.timeOfImpact;
    const tall = c.y - groundY;
    // how far ahead it is: the nearest of just off the floor, knee and chest high
    // (a lying person's head is held up off the floor by the shoulders: under it,
    // a paw would catch on it on the way up)
    let face: RAPIER.RayColliderHit | null = null;
    for (const h of [0.06, tall * 0.5, tall * 0.9]) {
      const ahead = new RAPIER.Ray({ x: c.x, y: groundY + h }, { x: this.f, y: 0 });
      const hit = world.castRay(ahead, tall * 2.5 + 0.4, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
      if (hit && (!face || hit.timeOfImpact < face.timeOfImpact)) face = hit;
    }
    if (!face) return false;
    const what = this.game.physics.partOf(face.collider);
    // over or onto someone lying on the floor, never onto anyone on their feet
    if (what?.entity.upright) return false;
    // how high its top is
    const fx = c.x + this.f * (face.timeOfImpact + 0.12);
    const top = world.castRay(new RAPIER.Ray({ x: fx, y: groundY + J + tall + 0.3 }, { x: 0, y: -1 }), J + tall + 0.3, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
    if (!top) return false;
    const topY = groundY + J + tall + 0.3 - top.timeOfImpact;
    const dh = topY - groundY;
    if (dh < 0.05 || dh > J) return false;
    // room to land, and nothing overhead on the way
    const room = world.castRay(new RAPIER.Ray({ x: c.x, y: topY + tall + 0.05 }, { x: this.f, y: 0 }), face.timeOfImpact + 0.6, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
    const roof = world.castRay(new RAPIER.Ray({ x: c.x, y: c.y }, { x: 0, y: 1 }), dh + 0.3, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
    if (room || roof) return false;
    // where its paws are, ahead of and behind the chest
    const { front, back } = this.pawSpan();
    // how wide its top is, and how far the whole thing goes on before the floor
    // (and how high it gets on the way): a lying person's head is narrow, but the
    // rest of them is no floor to come down on
    const faceD = face.timeOfImpact;
    const from = groundY + J + tall + 0.3;
    let width = 0;
    let extent = 0;
    let high = topY;
    while (extent < 2.4) {
      const x = c.x + this.f * (faceD + extent + 0.04);
      const h = world.castRay(new RAPIER.Ray({ x, y: from }, { x: 0, y: -1 }), from - groundY, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
      const y = h ? from - h.timeOfImpact : groundY;
      if (y < groundY + 0.06) break;
      if (width === extent && y > topY - 0.06) width += 0.08;
      high = Math.max(high, y);
      extent += 0.08;
    }
    // Room on top for all four paws: up onto it. Too narrow: clean over all of it
    // if it can leap that far, or else over the narrow top, coming down on what's
    // behind it (someone lying there: on the rest of them). The paws have to be
    // above the top from when the front ones reach the near edge until the hind
    // ones are past the near edge (onto it) or the far one (over it): the arc
    // through those two points, a little higher, peaking between them.
    const g = -GRAVITY;
    // (only seen once right up against it, it springs from where it stands too)
    const runUp = faceD - front - 0.08;
    const x1 = close || runUp < 0.05 ? Math.max(0.15, runUp) : runUp;
    const arc = (x2: number, rise: number, peak = Infinity) => {
      const D = (x1 + x2) / 2;
      const d = (x2 - x1) / 2;
      const speed = Math.sqrt((g * (D * D - d * d)) / (2 * rise));
      const vy = (g * D) / speed;
      return speed > 0.6 && speed < 4.5 && vy * vy < 2 * g * peak ? { vx: speed * this.f, vy } : null;
    };
    // somewhere to come down on the far side
    const landing = (x2: number) => {
      const far = world.castRay(new RAPIER.Ray({ x: c.x + this.f * (x2 + front + 0.2), y: from }, { x: 0, y: -1 }), from - groundY + 0.3, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
      return !!far && Math.abs(from - far.timeOfImpact - groundY) < 0.3;
    };
    let v: { vx: number; vy: number } | null = null;
    if (width >= front + back + 0.25) v = arc(faceD + back + 0.08, dh + 0.14);
    else {
      const all = faceD + extent + back + 0.12;
      if (extent < 2.4 && landing(all)) v = arc(all, high - groundY + 0.14, J + 0.6);
      const narrow = faceD + width + back + 0.12;
      if (!v && landing(narrow)) v = arc(narrow, dh + 0.14);
    }
    if (!v) return false;
    const { vx, vy } = v;
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      l.part.body.applyImpulse({ x: l.part.mass * (vx - v.x), y: l.part.mass * (vy - v.y) }, true);
    }
    this.jumpT = 1e-3;
    this.jumpCool = 1.2;
    this.updateMotors(true);
    return true;
  }

  /**
   * The ground falling away ahead of the front paws: how far down (m; 0: it
   * doesn't) and how far ahead of the chest the edge is.
   */
  private dropAhead(): { depth: number; edge: number } {
    const c = this.L('chest').part;
    const world = this.game.physics.world;
    const mine = (o: RAPIER.Collider) => this.game.physics.partOf(o)?.entity === this;
    const none = { depth: 0, edge: 0 };
    const under = world.castRay(new RAPIER.Ray({ x: c.x, y: c.y }, { x: 0, y: -1 }), 1.5, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
    if (!under) return none;
    const front = this.pawSpan().front;
    for (let d = front + 0.04; d <= front + 0.2; d += 0.08) {
      const ahead = world.castRay(new RAPIER.Ray({ x: c.x + this.f * d, y: c.y }, { x: 0, y: -1 }), 4, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
      const depth = (ahead ? ahead.timeOfImpact : 4) - under.timeOfImpact;
      if (depth > 0.15) return { depth, edge: d };
    }
    return none;
  }

  /** Chest over a drop with the hindquarters still up on the ledge: how far down. */
  private hangingOver(): { depth: number; edge: number } {
    const world = this.game.physics.world;
    const mine = (o: RAPIER.Collider) => this.game.physics.partOf(o)?.entity === this;
    const below = (k: string) => {
      const p = this.L(k).part;
      const h = world.castRay(new RAPIER.Ray({ x: p.x, y: p.y }, { x: 0, y: -1 }), 4, true, undefined, undefined, undefined, undefined, (o) => !mine(o));
      return h ? p.y - h.timeOfImpact : -Infinity;
    };
    if (!this.ok('hips')) return { depth: 0, edge: 0 };
    const depth = below('hips') - below('chest');
    return depth > 0.15 && depth < 2.5 ? { depth, edge: 0 } : { depth: 0, edge: 0 };
  }

  /** Paw positions ahead of and behind the chest (m, standing). */
  private pawSpan(): { front: number; back: number } {
    const cx = this.L('chest').spec.cx;
    let front = 0;
    let back = 0;
    for (const sp of this.species.specs) {
      if (!sp.key.startsWith('lower')) continue;
      front = Math.max(front, sp.cx - cx);
      back = Math.max(back, cx - sp.cx);
    }
    return { front: front * PX, back: back * PX };
  }

  /**
   * At the edge of a drop (`edge` m ahead of the chest): a hop forward that
   * carries the hind paws over the edge too, so it lands on its feet rather than
   * its nose.
   */
  private hopDown(edge: number): boolean {
    // (straight after landing on a narrow top too: no waiting about on the edge)
    if (this.pawsDown() < 1 || this.tethered()) return false;
    // the hind paws over the edge before it has come back down to the ledge's height
    const g = -GRAVITY;
    const vy = 1.5;
    const tOver = (vy + Math.sqrt(vy * vy - 2 * g * 0.05)) / g;
    const vx = clamp((edge + this.pawSpan().back + 0.12) / tOver, 1, 3.5) * this.f;
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      l.part.body.applyImpulse({ x: l.part.mass * (vx - v.x), y: l.part.mass * (vy - v.y) }, true);
    }
    this.jumpT = 1e-3;
    this.jumpCool = 0.8;
    this.updateMotors(true);
    return true;
  }

  /** A spring up on the spot (carrying on, if it was walking). Returns whether it did. */
  jump(): boolean {
    const J = this.species.jump;
    if (!J || this.state !== 'stand' || this.held || this.jumpT > 0 || this.pawsDown() < 2 || this.tethered()) return false;
    const vy = Math.sqrt(2 * -GRAVITY * Math.min(J, 0.5));
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      l.part.body.applyImpulse({ x: 0, y: l.part.mass * (vy - v.y) }, true);
    }
    this.jumpT = 1e-3;
    this.jumpCool = 0.8;
    this.updateMotors(true);
    return true;
  }

  /**
   * Walking on the spot, its paws caught on something too low for it to have
   * seen (a shoe sticking up, a lip): a little hop forward over it.
   */
  private scramble(): boolean {
    const J = this.species.jump;
    if (!J || this.jumpCool > 0 || this.pawsDown() < 2 || this.tethered() || this.blockedAhead()) return false;
    const c = this.L('chest').part;
    const rise = Math.min(J, 0.25);
    const roof = this.game.physics.world.castRay(new RAPIER.Ray({ x: c.x, y: c.y }, { x: 0, y: 1 }), rise + 0.2, true, undefined, undefined, undefined, undefined, (o) => this.game.physics.partOf(o)?.entity !== this);
    if (roof) return false;
    const vy = Math.sqrt(2 * -GRAVITY * rise);
    const vx = 1.3 * this.f;
    for (const l of this.order) {
      if (l.gone || !l.attached || l.part.frozen) continue;
      const v = l.part.body.linvel();
      l.part.body.applyImpulse({ x: l.part.mass * (vx - v.x), y: l.part.mass * (vy - v.y) }, true);
    }
    this.jumpT = 1e-3;
    this.jumpCool = 1.2;
    this.updateMotors(true);
    return true;
  }

  /** Horizontal speed of the trunk, + forward. */
  private trunkVx(): number {
    let m = 0;
    let p = 0;
    for (const k of ['chest', 'hips']) {
      const l = this.L(k);
      if (l.gone || !l.attached) continue;
      m += l.part.mass;
      p += l.part.mass * l.part.vx;
    }
    return m ? (p / m) * this.f : 0;
  }

  /** A stepping leg's joint angle (facing right): diagonal pairs swing together, paws lifting as they go forward. */
  private step(key: string): number {
    const g = this.species.gait;
    const ph = this.stride + (key.endsWith('FrontF') || key.endsWith('BackB') ? 0 : Math.PI);
    const run = clamp((this.pace - g.walk) / (g.run - g.walk), 0, 1);
    if (key.startsWith('upper')) return this.gaitAmt * g.swing * (1 + 0.25 * run) * Math.sin(ph);
    const flex = this.gaitAmt * g.lift * Math.max(0, Math.cos(ph));
    return key.startsWith('lowerFront') ? flex : -flex;
  }

  /**
   * Walking: the legs step in a trot, at the rate that matches the speed, and
   * the trunk is driven toward the wanted speed while enough paws are down.
   */
  private walk(dt: number, paws: number): void {
    const want = this.state === 'stand' ? this.speed : 0;
    // (stopping from a run or landing from a hop, it keeps stepping until it has
    // braked: legs locked at a canter, it slides on past where it meant to stop)
    const coasting = this.state === 'stand' && this.trunkVx() > 0.3;
    this.gaitAmt = want > 0 ? Math.min(1, this.gaitAmt + dt * 4) : coasting && this.gaitAmt ? Math.max(0.3, this.gaitAmt - dt * 3) : Math.max(0, this.gaitAmt - dt * 3);
    if (!this.gaitAmt) return;
    const g = this.species.gait;
    // step for the speed the body is going (setting off, a little ahead of it): legs
    // flailing at a gallop from a standing start trip it up
    this.pace = want ? clamp(this.trunkVx() + 0.5, 0.5 * Math.min(want, g.walk), want) : Math.max(0, this.trunkVx());
    const run = clamp((this.pace - g.walk) / (g.run - g.walk), 0, 1);
    // each diagonal pair carries the body one sweep of the legs per half step
    const sweep = 2 * this.species.hipY * PX * Math.sin(g.swing * (1 + 0.25 * run));
    this.stride = (this.stride + 2 * Math.PI * Math.max(1.2, this.pace / (2 * sweep)) * dt) % (2 * Math.PI);
    if (paws < 2) return;
    // (stopping, it brakes rather than coasting on into whatever stopped it)
    // (slowing down, gently: braking hard pitches it onto its nose. But not so
    // gently it runs into someone ahead)
    const brake = this.blocker && !this.blocker.destroyed && this.blocker.entity.canWalk ? -4 : -2.5;
    const a = want ? clamp((want - this.trunkVx()) * 6, brake, (4 + 8 * run) * (0.3 + 0.7 * this.gaitAmt)) : clamp(-this.trunkVx() * 4, -3, 0);
    let m = 0;
    for (const l of this.order) if (!l.gone && l.attached) m += l.part.mass;
    const trunk = ['chest', 'hips'].map((k) => this.L(k)).filter((l) => !l.gone && l.attached && !l.part.frozen);
    const tm = trunk.reduce((s, l) => s + l.part.mass, 0);
    for (const l of trunk) l.part.body.applyImpulse({ x: m * a * this.f * (l.part.mass / tm) * dt, y: 0 }, true);
  }

  /** Pinned, tied, welded or stuck with something: it can't turn round in place. */
  private tethered(): boolean {
    const world = this.game.physics.world;
    const mine = new Set(this.parts.map((p) => p.body.handle));
    let out = false;
    for (const l of this.order) {
      if (l.gone || !l.attached) continue;
      if (l.part.frozen) return true;
      world.impulseJoints.forEachJointHandleAttachedToRigidBody(l.part.body.handle, (h) => {
        const j = world.impulseJoints.get(h);
        if (!j || out) return;
        const o = j.body1().handle === l.part.body.handle ? j.body2() : j.body1();
        if (!mine.has(o.handle)) out = true;
      });
      if (out) return true;
    }
    return this.game.connections.list.some((k) => k.a.entity === this || k.b?.entity === this);
  }

  /**
   * Turns round in place: the body is mirrored about its middle, keeping its
   * pose and motion (a sprite game's about-turn).
   */
  private turn(): boolean {
    if (this.turnT > 0) return false;
    // turning swings the head round to where the tail was: there has to be room
    if (this.tethered() || this.blockedAhead(true, 0.1)) {
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
    for (const l of live) {
      const v = l.part.body.linvel();
      l.part.mirror(cx);
      // it turns round, it doesn't bounce back
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
      if (this.f === 1) j.setLimits(l.spec.lo!, l.spec.hi!);
      else j.setLimits(-l.spec.hi!, -l.spec.lo!);
    }
    this.updateMotors(true);
    for (const l of live) if (!l.part.frozen) l.part.body.wakeUp();
    return true;
  }

  /** Tail wags and the odd bark or meow while healthy; whimpers while hurt. */
  private idle(dt: number, conscious: boolean): void {
    this.wag = Math.max(0, this.wag - dt);
    if (!conscious) return;
    const x = this.L('chest').part.x;
    if (this.state === 'down' && this.pain > 0.35) {
      if (this.voiceT <= 0) {
        this.voiceT = 3 + Math.random() * 4;
        this.game.sound.play(this.species.sounds.pain, { gain: 0.35 + Math.min(0.3, this.pain * 0.2), x });
      }
      return;
    }
    if (this.state !== 'stand' || this.pain > 0.1) return;
    this.idleT -= dt;
    if (this.idleT > 0) return;
    this.idleT = 15 + Math.random() * 35;
    if (this.species.kind === 'dog') this.wag = 2 + Math.random() * 2;
    if (Math.random() < 0.6 && this.voiceT <= 0) {
      this.voiceT = 2;
      this.game.sound.play(this.species.sounds.idle, { gain: 0.35, x });
    }
  }

  /** A failed attempt to stand; wedged in a crowd it lies still after a few, until something changes. */
  private failGetup(): void {
    this.getupFails++;
    // scrabbling about on top of a heap of bodies gets nowhere: give up sooner
    if (this.getupFails >= (this.onHeap() ? 2 : 4)) this.gaveUp = { x: this.L('chest').part.x, y: this.L('chest').part.y };
    this.setState('down');
  }

  /** Lying on other bodies rather than on the ground or something fixed. */
  private onHeap(): boolean {
    const world = this.game.physics.world;
    const ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: -1 });
    for (const k of ['chest', 'hips']) {
      const l = this.L(k);
      if (l.gone) continue;
      ray.origin = { x: l.part.x, y: l.part.y };
      const hit = world.castRay(ray, 0.6, true, undefined, undefined, undefined, undefined, (c) => this.game.physics.partOf(c)?.entity !== this);
      const p = hit && this.game.physics.partOf(hit.collider);
      if (p && !p.frozen && (p.entity instanceof Creature || p.entity instanceof Human)) return true;
    }
    return false;
  }

  /** Something happened (a hit, a wound, being picked up): try standing again. */
  private rouse(): void {
    this.gaveUp = null;
    this.getupFails = 0;
    this.retries = 0;
  }

  /** The pile it gave up in has shifted: one more try (see Human.retry). */
  private retry(): void {
    this.gaveUp = null;
    this.getupFails = 3;
    this.retries++;
  }

  private yelp(dmg: number): void {
    if (!this.alive || this.consciousness < 0.3 || this.voiceT > 0 || dmg < 6) return;
    this.voiceT = 0.7 + Math.random() * 0.6;
    const s = this.species.sounds;
    this.game.sound.play(dmg > 35 ? s.bad : s.hurt, { gain: clamp(0.4 + dmg / 80, 0.4, 0.9), x: this.L('chest').part.x });
  }

  postStep(dt: number): void {
    // ---- joint stress: limbs tear off when stretched too far
    for (const l of this.order) {
      if (!l.joint || l.severed || !l.joint.isValid() || !l.parent) continue;
      const pa = l.parent.part.localToWorld(l.a1.x, l.a1.y);
      const pb = l.part.localToWorld(l.a2.x, l.a2.y);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const limit = (0.09 + 0.1 * clamp(l.part.hp / l.part.maxHp, 0, 1)) * (this.species.kind === 'cat' ? 0.8 : 1);
      if (d > limit) {
        l.stress += dt;
        if (l.stress > 0.03) this.sever(l, 'tear');
      } else l.stress = Math.max(0, l.stress - dt);
    }

    this.bleed(dt);

    // ---- vitals
    this.pain = Math.max(0, this.pain - dt * 0.06 * (1 + this.pain));
    const d = this.drugs;
    d.adrenaline = Math.max(0, d.adrenaline - dt);
    d.knockout = Math.max(0, d.knockout - dt);
    d.poison = Math.max(0, d.poison - dt);
    if (!this.alive) return;
    if (d.adrenaline > 0) {
      this.pain = 0;
      this.shock = 0;
    }
    if (d.poison > 0) this.blood -= dt * 3;
    const head = this.L('head');
    const headF = head.gone ? 0 : head.part.hp / head.part.maxHp;
    let target = 1;
    if (headF < 0.5) target = Math.min(target, headF * 1.2);
    if (this.blood < 65) target = Math.min(target, (this.blood - 40) / 25);
    if (this.pain > 0.9) target = Math.min(target, 0.4);
    if (d.knockout > 0) target = Math.min(target, 0.05);
    target = clamp(target, 0, 1);
    const up = d.adrenaline > 0 ? 0.03 : 0.004;
    this.consciousness += (target - this.consciousness) * (target < this.consciousness ? 0.2 : up);
    this.shock = Math.max(0, this.shock - dt * 0.012);
    if (this.consciousness < 0.15 && this.state !== 'down') this.setState('down');
    this.checkDeath();
  }

  private checkDeath(): void {
    const head = this.L('head');
    const chest = this.L('chest');
    if (head.gone || head.part.hp <= 0 || !head.attached || chest.part.hp <= 0 || this.blood < 35) this.die();
    else {
      let trauma = 0;
      for (const l of this.order) if (!l.gone) trauma += Math.max(0, 1 - l.part.hp / l.part.maxHp) * (l.children.length > 1 || !l.parent ? 1.2 : 0.6);
      if (trauma > 5) this.die();
    }
  }

  die(): void {
    if (!this.alive) return;
    const loud = this.consciousness > 0.3;
    this.alive = false;
    this.consciousness = 0;
    this.wag = 0;
    if (loud) this.game.sound.play(this.species.sounds.die, { gain: 0.6, x: this.L('chest').part.x });
    this.setState('down');
    this.updateMotors(true);
    this.setFace();
  }

  private setFace(): void {
    const head = this.L('head');
    if (head.gone) return;
    const e = CREATURE_EYE[this.species.kind];
    head.part.paintPixel(e.x, e.y, !this.alive ? e.dead : this.consciousness < 0.3 ? e.closed : e.open);
  }

  frame(): void {
    const want = !this.alive ? 0 : this.consciousness < 0.3 ? 1 : 2;
    if (want !== this.faceState) {
      this.faceState = want;
      this.setFace();
    }
  }

  // ---------------------------------------------------------------- drugs

  inject(drug: Drug, dose: number): void {
    switch (drug) {
      case 'healing':
        this.mend(dose);
        break;
      case 'life':
        if (this.alive) this.mend(dose * 0.6);
        else {
          this.lifeDose += dose;
          const head = this.L('head');
          if (this.lifeDose >= 0.5 && !head.gone && head.attached) {
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
        // small animals go under quicker
        this.drugs.knockout = Math.min(120, this.drugs.knockout + dose * (this.species.kind === 'cat' ? 45 : 30));
        break;
      case 'poison':
        this.drugs.poison = Math.min(120, this.drugs.poison + dose * 40);
        break;
    }
  }

  private mend(dose: number): void {
    if (!this.alive) return;
    this.blood = Math.min(100, this.blood + dose * 60);
    this.pain = Math.max(0, this.pain - dose * 2);
    this.drugs.poison = 0;
    this.mendDose += dose;
    for (const l of this.order) {
      if (l.gone) continue;
      const p = l.part;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * dose * 1.5);
      if (p.burning > 0) this.game.fire.extinguish(p);
      p.charred = Math.max(0, p.charred - dose * 1.5);
      p.refreshTint();
      if (this.mendDose >= 0.6) {
        l.wounds.length = 0;
        l.broken = false;
      }
    }
    if (this.mendDose >= 0.6) {
      this.mendDose = 0;
      this.updateMotors(true);
    }
  }

  // ---------------------------------------------------------------- damage

  onGrab(_p: Part, held: boolean): void {
    this.held = held;
    this.rouse();
    if (held) {
      this.setState('down');
      if (this.alive && this.consciousness > 0.3 && this.voiceT <= 0 && this.species.kind === 'cat') {
        this.voiceT = 2;
        this.game.sound.play('creature/cat_hiss', { gain: 0.4, x: this.L('chest').part.x });
      }
    } else this.stateT = 0;
  }

  onImpact(info: ImpactInfo): void {
    const l = this.limbOf(info.part);
    if (!l || l.gone) return;
    const mEff = info.part.mass * 2.4;
    const Eself = 0.5 * Math.min(mEff, info.otherMass) * info.selfSpeed * info.selfSpeed;
    const backing = l.attached ? Math.max(mEff, this.totalMass() * 0.8) : mEff;
    const blunt = (info.other?.entity as { blunt?: number } | undefined)?.blunt ?? 1;
    const Eother = 0.5 * Math.min(info.otherMass, backing) * info.otherSpeed * info.otherSpeed * blunt;
    const E = Eself + Eother;
    const frag = l.spec.fragility / this.species.toughness;
    const E0 = (24 * mEff) / frag;
    if (E <= E0) return;
    const frac = (E - E0) / ((115 * mEff) / frag);
    this.injure(l, frac * l.spec.hp, 'blunt', info.point, { x: -info.normal.x, y: -info.normal.y });
    // a hard hit knocks it off its feet
    if ((frac > 0.1 || Eother > 3 * this.totalMass()) && this.state === 'stand') this.setState('down');
  }

  onBullet(hit: BulletHit): void {
    const l = this.limbOf(hit.part);
    if (!l || l.gone) return;
    let dmg = hit.damage / this.species.toughness;
    if (l.spec.key === 'head') dmg *= 2.2;
    hit.part.flash = 0.6;
    this.addWound(l, hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y, 0.35 + dmg * 0.025, 'hole');
    if (hit.exit) this.addWound(l, hit.exit.x, hit.exit.y, hit.dir.x, hit.dir.y, 0.3 + dmg * 0.03, 'hole');
    const ps = this.game.particles;
    ps.blood(hit.point.x, hit.point.y, -hit.dir.x + (Math.random() - 0.5), -hit.dir.y + 0.3, 6 + dmg * 0.3, 2.2, hit.part.body);
    if (hit.exit) ps.blood(hit.exit.x, hit.exit.y, hit.dir.x, hit.dir.y, 10 + dmg * 0.5, 4.5, hit.part.body);
    this.game.sound.squish(0.3, hit.point.x, 0.5);
    // a bullet through the brain (a stray fragment or a pellet wounds and stuns)
    if (l.spec.key === 'head' && hit.damage > 16) {
      this.injure(l, dmg, 'bullet', hit.point, hit.dir);
      hit.part.hp = Math.min(hit.part.hp, 0);
      this.die();
      return;
    }
    this.injure(l, dmg, 'bullet', hit.point, hit.dir);
    if (this.state !== 'down' && (dmg > 30 || (l.spec.key === 'chest' && dmg > 18))) this.setState('down');
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    const l = this.limbOf(part);
    if (!l || l.gone) return;
    const amt = amount / this.species.toughness;
    if (kind === 'fire') {
      part.hp -= amt * 0.55;
      this.pain = Math.min(1.5, this.pain + amt * 0.03);
      if (this.state !== 'down' && part.burning > 0.35) this.setState('down');
      if (Math.random() < amt * 0.6) {
        const w = part.pixelToWorld(Math.floor(Math.random() * part.w), Math.floor(Math.random() * part.h));
        part.paintAt(w.x, w.y, 0x2a1d17, 0, 0.3);
      }
      this.yelp(amt * 8);
      return;
    }
    if (kind === 'acid') {
      part.hp -= amt;
      this.pain = Math.min(1.5, this.pain + amt * 0.04);
      this.yelp(amt * 10);
      return;
    }
    if (kind === 'laser') {
      if (point) part.paintAt(point.x, point.y, 0x2a1d17, 1, 0.85);
      this.injure(l, amt, kind, point, dir);
      return;
    }
    if (kind === 'explosion') {
      const frac = amt / l.spec.hp;
      if (frac > 2.6 && l.spec.key !== 'chest') {
        this.gib(l);
        return;
      }
      this.injure(l, amt, 'explosion', point, dir);
      if (frac > 1.1 && l.joint && !l.severed && Math.random() < 0.6) this.sever(l, 'blast');
      if (point && Math.random() < Math.min(0.9, frac * 2)) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 1), 0.3 + frac, 'blot');
      return;
    }
    if (kind === 'cut' || kind === 'stab') {
      if (point) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0), 0.25 + amt * 0.03, kind === 'cut' ? 'cut' : 'blot', dir);
      this.injure(l, amt, kind, point, dir);
      return;
    }
    this.injure(l, amt, kind, point, dir);
  }

  private injure(l: Limb, dmg: number, kind: DamageKind, point?: V2, dir?: V2): void {
    const p = l.part;
    p.hp -= dmg;
    // a real hit (not the knocks of flopping back down) makes it try again, and get away
    if (dmg > 6) {
      this.rouse();
      if (point) this.scare(point.x - Math.sign(dir?.x ?? 0), 3);
    }
    this.pain = Math.min(1.5, this.pain + dmg / 70);
    this.shock = Math.min(1, this.shock + dmg / 500);
    if (l.spec.key === 'head') this.consciousness = Math.max(0, this.consciousness - dmg / l.spec.hp);
    this.yelp(dmg);
    if (kind === 'blunt') {
      if (dmg > l.spec.hp * 0.2 && point) {
        this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0), dmg * 0.006, 'blot');
        this.game.particles.blood(point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0) + 0.5, dmg * 0.3, 2.2, p.body);
      }
      if (!l.broken && dmg > l.spec.hp * 0.42 && l.joint && l.spec.key !== 'head') {
        l.broken = true;
        this.game.sound.bone(p.x);
        this.updateMotors(true);
      }
      if (p.hp < -l.spec.hp * 1.3 && dmg > l.spec.hp * 1.1) {
        if (l.spec.key === 'head' || l.spec.key === 'chest') this.gib(l);
        else if (l.joint) this.sever(l, 'blast');
      }
    }
    if ((l.spec.key === 'head' || l.spec.key === 'chest') && p.hp <= 0) this.die();
    if ((kind === 'cut' || kind === 'stab') && p.hp <= 0 && l.joint && !l.severed) this.sever(l, 'cut');
  }

  /** Nearest solid sprite pixel to (ix, iy). */
  private snap(p: Part, ix: number, iy: number): { x: number; y: number } {
    if (p.solidAt(ix, iy)) return { x: ix, y: iy };
    let best = 1e9;
    let out = { x: ix, y: iy };
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      if (p.solidAt(ix + i, iy + j) && i * i + j * j < best) {
        best = i * i + j * j;
        out = { x: ix + i, y: iy + j };
      }
    }
    return out;
  }

  private addWound(l: Limb, wx: number, wy: number, ox: number, oy: number, rate: number, look: 'hole' | 'cut' | 'blot', cutDir?: V2): void {
    const p = l.part;
    const { ix, iy } = p.worldToPixel(wx, wy);
    const { x: bx, y: by } = this.snap(p, ix, iy);
    if (look === 'hole') {
      p.paintPixel(bx, by, 0x2a0505);
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.paintPixel(bx + i, by + j, 0x8a1212, 0.75);
    } else if (look === 'cut' && cutDir) {
      const ld = p.worldToLocal(p.x + cutDir.x, p.y + cutDir.y);
      const len = Math.hypot(ld.x, ld.y) || 1;
      const sx = Math.round((ld.x / len) * this.f);
      const sy = -Math.round(ld.y / len);
      for (let k = -2; k <= 2; k++) p.paintPixel(bx + sx * k, by + sy * k, k === 0 ? 0x3a0606 : 0x7d0e0e);
    } else p.paintPixel(bx, by, 0x7d0e0e, 0.8);
    const local = rotate(ox, oy, -p.body.rotation());
    const ll = Math.hypot(local.x, local.y) || 1;
    if (l.wounds.length >= 8) {
      l.wounds[Math.floor(Math.random() * l.wounds.length)].rate += rate;
      return;
    }
    l.wounds.push({ ix: bx, iy: by, dx: local.x / ll, dy: local.y / ll, rate, spurt: false });
  }

  private bleed(dt: number): void {
    const pulse = this.alive ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * Math.PI * 2 * 1.6)) : 0.2;
    // a smaller animal has less blood to lose
    const loss = this.species.bleedRate;
    let total = 0;
    for (const l of this.order) {
      if (l.gone || !l.wounds.length) continue;
      const p = l.part;
      for (const w of l.wounds) {
        if (w.rate <= 0.005) continue;
        total += w.rate;
        w.rate *= Math.exp(-dt * (w.spurt ? 0.02 : 0.045));
        if (this.blood <= 0) continue;
        if (Math.random() < w.rate * pulse * dt * (w.spurt ? 26 : 12)) {
          const wp = p.pixelToWorld(w.ix, w.iy);
          const d = rotate(w.dx, w.dy, p.body.rotation());
          const sp = w.spurt ? 1.2 + w.rate * 0.9 * pulse : 0.15 + Math.random() * 0.3;
          this.game.particles.blood(wp.x, wp.y, d.x, d.y, w.spurt ? 2 : 1, sp, p.body);
        }
      }
    }
    if (total > 0) this.blood = Math.max(0, this.blood - total * dt * loss);
  }

  /** Detaches a limb (and everything below it) from its parent. */
  sever(l: Limb, why: 'tear' | 'cut' | 'blast'): void {
    if (!l.joint || l.severed || !l.parent) return;
    this.removeJoint(l.joint);
    l.joint = null;
    l.severed = true;
    const group = 1_000_000 + Math.floor(Math.random() * 1e9);
    const mark = (x: Limb) => {
      x.attached = false;
      x.part.group = group;
      x.part.detached = true;
      x.children.forEach(mark);
    };
    mark(l);
    (l.part.noCollide ??= new Set()).add(l.parent.part);
    (l.parent.part.noCollide ??= new Set()).add(l.part);
    const pj = l.parent.part.localToWorld(l.a1.x, l.a1.y);
    const cj = l.part.localToWorld(l.a2.x, l.a2.y);
    this.stump(l.parent, pj, 2, true);
    this.stump(l, cj, 0.8, false);
    const d = { x: cj.x - l.part.x, y: cj.y - l.part.y };
    this.game.particles.blood(pj.x, pj.y, -d.x, -d.y + 0.5, 18, 3.2, l.parent.part.body);
    this.game.particles.blood(cj.x, cj.y, d.x, d.y, 10, 2.4, l.part.body);
    this.game.sound.squish(0.9, pj.x);
    if (why === 'tear') this.game.sound.tear(pj.x);
    this.yelp(60);
    this.pain = 1.5;
    this.shock = Math.min(1, this.shock + 0.35);
    if (l.spec.key === 'head' || l.spec.key === 'hips') this.die();
    this.updateMotors(true);
  }

  private stump(l: Limb, at: V2, rate: number, spurt: boolean): void {
    const p = l.part;
    const { ix, iy } = p.worldToPixel(at.x, at.y);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      p.paintPixel(ix + i, iy + j, i === 0 && j === 0 ? 0xe6dcc8 : (i + j) % 2 ? 0x9c1a1a : 0x6e0c0c);
    }
    const { x: bx, y: by } = this.snap(p, ix, iy);
    const local = p.worldToLocal(at.x, at.y);
    const ll = Math.hypot(local.x, local.y) || 1;
    l.wounds.push({ ix: bx, iy: by, dx: local.x / ll, dy: local.y / ll, rate, spurt });
  }

  /** Destroys a limb in a shower of gore. */
  gib(l: Limb): void {
    if (l.gone) return;
    const p = l.part;
    for (const c of l.children) if (!c.severed) this.sever(c, 'blast');
    if (l.joint) this.sever(l, 'blast');
    const ps = this.game.particles;
    ps.blood(p.x, p.y, 0, 1, 40, 4.5, null);
    for (let i = 0; i < 20; i++) ps.debris(p.x, p.y, Math.random() - 0.5, 1, 1, [0x8e1a1a, 0x6b0e0e, 0xc46b6b, 0x8a6a48][i % 4], 5);
    this.game.sound.gib(p.x);
    l.gone = true;
    if (l.spec.key === 'head' || l.spec.key === 'chest') this.die();
    this.removePart(p);
  }

  removePart(p: Part): void {
    const l = this.limbOf(p);
    if (l && !l.gone) {
      l.gone = true;
      for (const c of l.children) {
        if (c.joint) this.removeJoint(c.joint);
        c.joint = null;
        c.severed = true;
        const mark = (x: Limb) => {
          x.attached = false;
          x.children.forEach(mark);
        };
        mark(c);
      }
      if (l.spec.key === 'head' || l.spec.key === 'chest') this.die();
    }
    super.removePart(p);
  }

  // ---------------------------------------------------------------- UI / state

  heal(): void {
    this.rouse();
    this.drugs.adrenaline = this.drugs.knockout = this.drugs.poison = 0;
    this.alive = true;
    this.consciousness = 1;
    this.blood = 100;
    this.pain = 0;
    this.shock = 0;
    this.limp = false;
    for (const l of this.order) {
      if (l.gone) continue;
      l.part.hp = l.part.maxHp;
      l.wounds.length = 0;
      l.broken = false;
      l.part.burning = 0;
      l.part.charred = 0;
      l.part.refreshTint();
    }
    this.setFace();
    this.setState('down');
    this.updateMotors(true);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.alive) {
      if (this.species.jump) acts.push({ label: 'Jump', hint: 'J', disabled: this.state !== 'stand', action: () => this.jump() });
      acts.push({ label: 'Kill', action: () => this.die() });
      acts.push({ label: 'Limp', checked: this.limp, action: () => { this.limp = !this.limp; this.setState('down'); this.updateMotors(true); } });
    }
    acts.push({ label: this.alive ? 'Heal' : 'Revive', action: () => this.heal() });
    return acts;
  }

  /** Short status line (shown in tooltips/tests). */
  status(): string {
    const drugs = (Object.keys(this.drugs) as (keyof typeof this.drugs)[]).filter((k) => this.drugs[k] > 0).map((k) => ` · ${k}`).join('');
    const doing = this.state !== 'stand' ? this.state : this.goal === 'flee' ? 'running' : this.following ? 'following' : this.goal === 'walk' ? 'walking' : 'standing';
    return `${this.alive ? (this.consciousness > 0.3 ? 'conscious' : 'unconscious') : 'dead'} · blood ${this.blood.toFixed(0)}%${drugs} · ${doing}`;
  }

  protected serializeExtra(): Record<string, unknown> {
    return {
      alive: this.alive,
      blood: this.blood,
      consciousness: this.consciousness,
      limp: this.limp,
      severed: this.order.filter((l) => l.severed && !l.gone).map((l) => l.spec.key),
      broken: this.order.filter((l) => l.broken).map((l) => l.spec.key),
      standing: this.state === 'stand',
      drugs: { ...this.drugs },
    };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.blood = (x.blood as number) ?? 100;
    this.consciousness = (x.consciousness as number) ?? 1;
    this.limp = !!x.limp;
    Object.assign(this.drugs, (x.drugs as Partial<typeof this.drugs>) ?? {});
    for (const k of (x.severed as string[]) ?? []) {
      const l = this.limbs.get(k);
      if (l && !l.gone) this.sever(l, 'cut');
    }
    for (const k of (x.broken as string[]) ?? []) {
      const l = this.limbs.get(k);
      if (l) l.broken = true;
    }
    if (x.alive === false) this.die();
    this.setState(x.standing && this.alive && this.consciousness > 0.5 ? 'stand' : 'down');
    this.updateMotors(true);
  }
}

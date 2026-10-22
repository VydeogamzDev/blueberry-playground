import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { clamp, rotate, smoothstep, wrapAngle, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import { MAT, type PhysMaterial } from '../world/Materials';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import { limbArt, faceColors, EYE, MOUTH, HUMAN_SKIN, type BodyKind, type LimbKey, type Skin } from '../art/human';
import type { Item, Holder } from './Item';
import type { Drug } from './Syringe';

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
export const BALANCE = { kp: 42, kd: 4, dead: 0.05, amax: 7.5, torqueOnly: true, standDamping: 20, limpDamping: 0.7 };

/** Failed attempts to stand before lying still until something changes. */
const GIVE_UP = 4;

/** Figure center height (px) used as the spawn reference point. */
const MID_Y = 27.25;
export const HUMAN_HALF_HEIGHT = MID_Y * PX;

type Pose = Partial<Record<LimbKey, number>>;
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
  /** Connected to the torso through intact joints. */
  attached: boolean;
  wounds: Wound[];
  stress: number;
  phase: number;
  /** Extra rotational inertia (small links get some so piles don't make them buzz). */
  extraI: number;
}

type State = 'stand' | 'down' | 'getup';

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
  private motorTimer = 0;
  private motorSig = '';
  private deathT = 0;
  private t = Math.random() * 100;
  /** Forced limp (context menu). */
  limp = false;
  /** Joint angles at the start of a get-up (blended toward the standing pose). */
  private blendFrom: Map<Limb, number> | null = null;
  /** Items held in the hands. */
  private grips: Grip[] = [];
  /** Recently dropped items that still overlap the body. */
  private dropped: { item: Item; t: number }[] = [];

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
      const limb: Limb = {
        spec: s, part, joint: null, parent: null, children: [], a1: { x: 0, y: 0 }, a2: { x: 0, y: 0 },
        severed: false, gone: false, broken: false, attached: true, wounds: [], stress: 0, phase: Math.random() * 10, extraI: 0,
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
    return this.state !== 'getup' && this.stateT > 3 && this.pain < 0.05;
  }

  /**
   * A failed attempt to stand. After a few (wedged in a pile of bodies, legs
   * trapped) it lies still instead of shoving the whole pile around forever,
   * until something changes: see rouse().
   */
  private failGetup(): void {
    this.getupFails++;
    if (this.getupFails >= GIVE_UP) this.gaveUp = { x: this.L('upperTorso').part.x, y: this.L('upperTorso').part.y };
    this.setState('down');
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
    if (!this.alive || this.limp) return 0;
    return clamp(this.consciousness * (1 - this.shock * 0.6), 0, 1);
  }

  // ---------------------------------------------------------------- drugs

  /** Seconds left of each drug's effect. */
  readonly drugs = { adrenaline: 0, knockout: 0, poison: 0 };
  private mendDose = 0;
  private lifeDose = 0;

  /** A syringe pushing `dose` (fraction of a full syringe) into the bloodstream. */
  inject(drug: Drug, dose: number): void {
    if (!this.variant.bleeds) return;
    switch (drug) {
      case 'healing':
        this.mend(dose);
        break;
      case 'life':
        if (this.alive) this.mend(dose * 0.6);
        else {
          this.lifeDose += dose;
          // brings the dead back if there is still a head on the body
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
        this.drugs.knockout = Math.min(120, this.drugs.knockout + dose * 30);
        break;
      case 'poison':
        this.drugs.poison = Math.min(120, this.drugs.poison + dose * 40);
        break;
    }
  }

  /** Healing over the injection: tissue, blood, burns; bones and wounds at the end. */
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
    this.state = s;
    this.stateT = 0;
    // getting up blends every joint from where it is now to the standing pose,
    // instead of snapping the limbs into place
    if (s === 'getup') {
      this.blendFrom = new Map();
      for (const l of this.order) {
        if (l.joint && l.parent && !l.gone) this.blendFrom.set(l, wrapAngle(l.part.body.rotation() - l.parent.part.body.rotation()));
      }
    } else this.blendFrom = null;
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

  /** Standing muscles hold posture firmly; a fallen body moves freely. */
  private applyDamping(): void {
    const ang = this.state === 'stand' ? BALANCE.standDamping : BALANCE.limpDamping;
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
    const pose = standing ? POSE_STAND : POSE_DOWN;
    const writhe = !standing && conscious ? Math.min(0.9, this.pain * 0.9) : 0;
    // someone lying still stops tensing up: weak muscles pushing against a pile of
    // bodies never find a balance and keep the limbs creeping forever
    const relaxed = !standing && conscious && writhe < 0.05 && !this.grips.length && this.stateT > 4;
    // re-sending identical motor targets would keep the bodies awake (and drifting)
    const getupRamp = this.state === 'getup' ? clamp(this.stateT / 1.2, 0.12, 1) : 1;
    const ik = standing ? this.holdIK() : null;
    let ikSig = '';
    if (ik) for (const k in ik) ikSig += Math.round(ik[k as LimbKey]! * 40) + ',';
    const sig = `${standing}:${Math.round(str * 50)}:${Math.round(getupRamp * 20)}:${this.gripSig()}:${ikSig}:${relaxed}`;
    if (!force && writhe === 0 && sig === this.motorSig) return;
    this.motorSig = sig;
    for (const l of this.order) {
      const j = l.joint;
      if (!j || !j.isValid() || l.severed) continue;
      let target = (pose[l.spec.key] ?? 0) * f;
      const from = this.blendFrom?.get(l);
      if (from !== undefined) target = from + (target - from) * smoothstep(0, 1, this.stateT / 1.1);
      const arm = l.spec.muscle < 500;
      // arms holding something aim it forward
      const hold = standing ? this.armRole(l) : null;
      let boost = 1;
      if (hold) {
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
      if (writhe > 0 && arm) {
        target += Math.sin(this.t * (1.5 + l.phase * 0.2) + l.phase) * writhe * 0.55 * f;
      }
      const K = l.spec.muscle * boost * (l.broken ? 0.05 : 1) * (l.attached ? 1 : 0);
      if (!conscious || K <= 0 || relaxed) {
        // limp: dry joint friction. Limbs still flop under their own weight, but
        // small sustained loads (a pile of bodies) no longer make them creep forever.
        const fr = (JOINT_FRICTION[l.spec.key.replace(/[FB]$/, '')] ?? 1) * (this.alive ? 1 : 0.7) * (l.broken ? 0.2 : 1);
        j.configureMotorVelocity(0, fr * 30);
        j.setMotorMaxForce(fr);
      } else if (standing) {
        j.setMotorMaxForce(1e6);
        // NB: Rapier's soft motors lose most of their stiffness when damping is high,
        // so damping stays small and body angular damping provides the rest
        j.configureMotorPosition(target, K * str * getupRamp, K * str * getupRamp * 0.003 + 0.3);
      } else {
        j.setMotorMaxForce(1e6);
        // lying down: weak muscle tone (and writhing when in pain)
        const tone = arm ? 0.18 + writhe * 0.5 : 0.035;
        j.configureMotorPosition(target, K * tone * str, K * tone * 0.004 + 0.3);
      }
    }
  }

  /** Is something heavy lying on this person's head or torso? */
  private pinned(): boolean {
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
    return load > 6;
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

  preStep(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    const str = this.strength();
    const conscious = str > 0.15;

    // ---- state machine
    const col = this.column();
    if (!conscious || this.held) {
      if (this.state !== 'down') this.setState('down');
    } else if (this.state === 'stand' || this.state === 'getup') {
      this.airT = col.grounded ? 0 : this.airT + dt;
      const tilt = Math.abs(col.theta);
      // only standing for a while counts as having got up (not toppling off a pile again)
      if (this.state === 'stand' && this.stateT > 3) this.getupFails = this.retries = 0;
      if (!this.legsWork()) this.setState('down');
      else if (this.state === 'stand' && (tilt > 0.62 || this.airT > 0.35)) {
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
      const wait = 2.2 + this.getupFails * 1.5 + this.pain * 4;
      if (this.gaveUp && this.retries < 2 && Math.hypot(up.x - this.gaveUp.x, up.y - this.gaveUp.y) > 0.4) this.retry();
      if (!this.gaveUp && this.stateT > wait && rest && col.grounded && this.legsWork() && str > 0.7 && this.pain < 0.6 && this.grounded(true) && !this.pinned()) {
        this.getupBest = Math.abs(col.theta);
        this.getupProgressT = 0;
        this.setState('getup');
      }
    }

    // ---- muscles
    this.motorTimer -= dt;
    if (this.motorTimer <= 0) {
      this.motorTimer = 0.05;
      this.updateMotors(false);
    }

    if (this.grips.length && this.state === 'stand' && conscious) this.aim(str, dt);

    // ---- balance
    if ((this.state === 'stand' || this.state === 'getup') && conscious && col.grounded) {
      if (this.state === 'getup') {
        const ramp = clamp(this.stateT / 1.2, 0, 1);
        this.balance(col, 16 * str, 9 * str, 4 + 14 * ramp, dt);
      } else this.balance(col, BALANCE.kp * str, BALANCE.kd * str, BALANCE.amax, dt);
    }
  }

  /**
   * Whole-body "column" state: tilt of the center of mass about the support point
   * (the feet). Standing balance rotates the body rigidly about that point.
   */
  private column(): { theta: number; omega: number; sx: number; sy: number; grounded: boolean } {
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
    if (!n) return { theta: Math.PI / 2, omega: 0, sx: 0, sy: 0, grounded: false };
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
    return { theta: Math.atan2(rx, ry), omega: (ry * vx - rx * vy) / h2, sx, sy, grounded };
  }

  /**
   * Balance: drives the column tilt to zero by applying the forces/torques that
   * would rotate the whole body rigidly about the feet (muscles + reflexes).
   */
  private balance(col: { theta: number; omega: number; sx: number; sy: number }, kp: number, kd: number, amax: number, dt: number): void {
    // the feet support the body passively while the center of mass stays over them,
    // so only push back once the body actually starts to tip (deadband)
    const dead = this.state === 'getup' ? 0 : BALANCE.dead;
    const err = Math.sign(col.theta) * Math.max(0, Math.abs(col.theta) - dead);
    const alpha = clamp(-kp * err - kd * col.omega, -amax, amax);
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
      const pa = l.parent.part.localToWorld(l.a1.x, l.a1.y);
      const pb = l.part.localToWorld(l.a2.x, l.a2.y);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const hpF = l.part.hp / l.part.maxHp;
      const limit = (0.11 + 0.12 * clamp(hpF, 0, 1)) * (this.variant.kind === 'android' ? 1.6 : 1);
      if (d > limit) {
        l.stress += dt;
        if (l.stress > 0.03) this.sever(l, 'tear');
      } else l.stress = Math.max(0, l.stress - dt);
    }

    // ---- bleeding
    if (this.variant.bleeds) this.bleed(dt);

    // ---- vitals
    this.pain = Math.max(0, this.pain - dt * 0.05);
    const d = this.drugs;
    d.adrenaline = Math.max(0, d.adrenaline - dt);
    d.knockout = Math.max(0, d.knockout - dt);
    d.poison = Math.max(0, d.poison - dt);
    if (this.alive) {
      if (d.adrenaline > 0) {
        // no pain, no shock, and a fast recovery
        this.pain = 0;
        this.shock = 0;
      }
      // poison drains the blood from the inside
      if (d.poison > 0) this.blood -= dt * 2.4;
      const head = this.L('head');
      const headF = head.gone ? 0 : head.part.hp / head.part.maxHp;
      let target = 1;
      if (headF < 0.5) target = Math.min(target, headF * 1.2);
      if (this.blood < 65) target = Math.min(target, (this.blood - 40) / 25);
      if (this.pain > 0.9) target = Math.min(target, 0.4);
      if (d.knockout > 0) target = Math.min(target, 0.05);
      target = clamp(target, 0, 1);
      // consciousness drops fast, recovers slowly (quickly on adrenaline)
      const up = d.adrenaline > 0 ? 0.03 : 0.004;
      this.consciousness += (target - this.consciousness) * (target < this.consciousness ? 0.2 : up);
      this.shock = Math.max(0, this.shock - dt * 0.01);
      if (this.consciousness < 0.15 && this.state !== 'down') this.setState('down');
      this.checkDeath();
    } else {
      this.deathT += dt;
      if (this.variant.kind === 'human') {
        const k = Math.min(1, this.deathT / 25);
        for (const l of this.order) {
          if (l.gone || l.part.frozen || l.part.noCollideAll) continue;
          l.part.material.uniforms.tint.value.setRGB(1 - k * 0.12, 1 - k * 0.1, 1 - k * 0.04);
        }
      }
    }
  }

  private checkDeath(): void {
    const head = this.L('head');
    const up = this.L('upperTorso');
    let cause = '';
    if (head.gone || head.part.hp <= 0) cause = 'head';
    else if (!head.attached) cause = 'decapitated';
    else if (up.part.hp <= 0) cause = 'torso';
    else if (this.blood < 35) cause = 'blood';
    else {
      let trauma = 0;
      for (const l of this.order) if (!l.gone) trauma += Math.max(0, 1 - l.part.hp / l.part.maxHp) * (l.spec.cy > 24 ? 1.2 : 0.6);
      if (trauma > 6.5) cause = 'trauma';
    }
    if (cause) this.die();
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
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
      p.paintPixel(EYE.x, EYE.y, fc.eyeClosed!);
    } else {
      p.paintPixel(EYE.x, EYE.y, fc.eye);
      p.paintPixel(MOUTH.x, MOUTH.y, fc.mouth);
    }
  }

  frame(_dt: number): void {
    const want = !this.alive ? 0 : this.consciousness < 0.3 ? 1 : 2;
    if (want !== this.faceState) {
      this.faceState = want;
      this.setFace();
    }
  }
  private faceState = 2;

  // ---------------------------------------------------------------- damage

  onGrab(p: Part, held: boolean): void {
    this.held = held;
    this.grabbedPart = held ? p : null;
    this.rouse();
    if (held) this.setState('down');
    else {
      this.stateT = 0;
      this.applyDamping();
    }
  }
  private grabbedPart: Part | null = null;

  onImpact(info: ImpactInfo): void {
    const l = this.limbOf(info.part);
    if (!l || l.gone) return;
    const mEff = info.part.mass * (l.spec.cy > 24 ? 2.6 : 2.2);
    // energy from this limb's own motion (falling onto something)...
    const Eself = 0.5 * Math.min(mEff, info.otherMass) * info.selfSpeed * info.selfSpeed;
    // ...plus energy delivered by the other object, which the rest of the body
    // backs up (a crate dropped on a head crushes it against the body)
    const backing = l.attached ? Math.max(mEff, this.totalMass() * 0.8) : mEff;
    const blunt = (info.other?.entity as { blunt?: number } | undefined)?.blunt ?? 1;
    const Eother = 0.5 * Math.min(info.otherMass, backing) * info.otherSpeed * info.otherSpeed * blunt;
    const E = Eself + Eother;
    const frag = l.spec.fragility / this.variant.toughness;
    const E0 = (24 * mEff) / frag;
    if (E <= E0) return;
    const frac = (E - E0) / ((115 * mEff) / frag);
    this.injure(l, frac * l.spec.hp, 'blunt', info.point, { x: -info.normal.x, y: -info.normal.y });
    // a hard hit knocks a standing person over
    if ((frac > 0.08 || Eother > 150) && this.state === 'stand' && l.spec.cy > 24) this.setState('down');
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
      if (hit.exit) ps.blood(hit.exit.x, hit.exit.y, hit.dir.x, hit.dir.y, 10 + dmg * 0.5, 4.5, p.body);
      this.game.sound.squish(0.3, hit.point.x);
    } else {
      this.game.particles.sparks(hit.point.x, hit.point.y, -hit.dir.x, -hit.dir.y, 6, 4);
    }
    // brain / heart shots
    if (l.spec.key === 'head' && dmg > 18 && this.variant.kind === 'human') {
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
      // big blasts tear off limbs or gib them entirely
      const frac = amt / l.spec.hp;
      if (frac > 2.6 && l.spec.key !== 'upperTorso') {
        this.gib(l);
        return;
      }
      this.injure(l, amt, 'explosion', point, dir);
      if (frac > 1.1 && l.joint && !l.severed && Math.random() < 0.6) this.sever(l, 'blast');
      // shrapnel wounds
      if (point && Math.random() < Math.min(0.9, frac * 2)) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 1), 0.3 + frac, false);
      return;
    }
    if (kind === 'cut' || kind === 'stab') {
      if (point) this.addWound(l, point.x, point.y, -(dir?.x ?? 0), -(dir?.y ?? 0), 0.25 + amt * 0.03, false, kind === 'cut' ? dir : undefined);
      this.injure(l, amt, kind, point, dir);
      return;
    }
    this.injure(l, amt, kind, point, dir);
  }

  /** Applies trauma to a limb and handles fractures, gibbing and death. */
  private injure(l: Limb, dmg: number, kind: DamageKind, point?: V2, dir?: V2): void {
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
      // fractures
      if (!l.broken && dmg > l.spec.hp * 0.42 && l.joint && l.spec.key !== 'head') {
        l.broken = true;
        this.game.sound.bone(p.x);
        this.updateMotors(true);
      }
      // catastrophic blunt trauma
      if (p.hp < -l.spec.hp * 1.3 && dmg > l.spec.hp * 1.1) {
        if (l.spec.key === 'head' || l.spec.muscle < 1) this.gib(l);
        else if (l.joint) this.sever(l, 'blast');
      }
    }
    if (l.spec.key === 'head' && p.hp <= 0) this.die();
    if (l.spec.key === 'upperTorso' && p.hp <= 0) this.die();
    if ((kind === 'cut' || kind === 'stab') && p.hp <= 0 && l.joint && !l.severed) this.sever(l, 'cut');
  }

  private addBleedTo(l: Limb, amount: number): void {
    if (!this.variant.bleeds || !l.wounds.length) return;
    l.wounds[l.wounds.length - 1].rate += amount;
  }

  /** Records a wound (entry or exit) and paints it on the sprite. */
  private addWound(l: Limb, wx: number, wy: number, ox: number, oy: number, rate: number, hole: boolean, cutDir?: V2): void {
    const p = l.part;
    const { ix, iy } = p.worldToPixel(wx, wy);
    // snap into the sprite so the wound sits on solid pixels
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
    if (this.variant.bleeds) {
      if (hole) {
        p.paintPixel(bx, by, 0x2a0505);
        for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.paintPixel(bx + i, by + j, 0x8a1212, 0.75);
      } else if (cutDir) {
        const ld = p.worldToLocal(p.x + cutDir.x, p.y + cutDir.y);
        const len = Math.hypot(ld.x, ld.y) || 1;
        const sx = Math.round((ld.x / len) * this.f);
        const sy = -Math.round(ld.y / len);
        for (let k = -2; k <= 2; k++) p.paintPixel(bx + sx * k, by + sy * k, k === 0 ? 0x3a0606 : 0x7d0e0e);
      } else {
        p.paintPixel(bx, by, 0x7d0e0e, 0.8);
      }
    } else {
      p.paintPixel(bx, by, 0x1a1c1f);
      for (const [i, j] of [[1, 0], [0, 1]]) p.paintPixel(bx + i, by + j, 0x3a3f45, 0.7);
    }
    if (!this.variant.bleeds) return;
    const local = rotate(ox, oy, -p.body.rotation());
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
        const n = w.rate * pulse * dt * (w.spurt ? 26 : 12);
        if (Math.random() < n) {
          const wp = p.pixelToWorld(w.ix, w.iy);
          const d = rotate(w.dx, w.dy, p.body.rotation());
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
    (l.part.noCollide ??= new Set()).add(l.parent.part);
    (l.parent.part.noCollide ??= new Set()).add(l.part);

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

  /** Destroys a limb in a shower of gore. */
  gib(l: Limb): void {
    if (l.gone) return;
    const p = l.part;
    // detach children so they fall free
    for (const c of l.children) if (!c.severed) this.sever(c, 'blast');
    if (l.joint) this.sever(l, 'blast');
    const ps = this.game.particles;
    if (this.variant.bleeds) {
      ps.blood(p.x, p.y, 0, 1, 50, 4.5, null);
      for (let i = 0; i < 26; i++) {
        const c = [0x8e1a1a, 0x6b0e0e, 0xc46b6b, 0xe3d9c4][i % 4];
        ps.debris(p.x, p.y, Math.random() - 0.5, 1, 1, c, 5);
      }
      this.game.sound.gib(p.x);
    } else {
      ps.sparks(p.x, p.y, 0, 1, 25, 7);
      ps.debris(p.x, p.y, 0, 1, 18, 0x59616b, 5);
      this.game.sound.impact('metal', 1, p.x);
      this.game.sound.spark(p.x);
    }
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
    this.rouse();
    this.drugs.adrenaline = this.drugs.knockout = this.drugs.poison = 0;
    this.alive = true;
    this.consciousness = 1;
    this.blood = 100;
    this.pain = 0;
    this.shock = 0;
    this.limp = false;
    this.deathT = 0;
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
    if (this.grips.length) {
      acts.push({ label: 'Use held item', hint: 'F', action: () => this.activate() });
      acts.push({ label: this.grips.length > 1 ? 'Drop items' : `Drop ${this.grips[0].item.label.toLowerCase()}`, action: () => this.dropAll() });
    }
    if (this.alive) {
      acts.push({ label: 'Kill', action: () => this.die() });
      acts.push({ label: 'Limp', checked: this.limp, action: () => { this.limp = !this.limp; this.setState('down'); this.updateMotors(true); } });
    }
    acts.push({ label: this.alive ? 'Heal' : 'Revive', action: () => this.heal() });
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
    if (!this.alive || this.consciousness < 0.3 || item.holder || !item.hold || this.destroyed) return false;
    const gw = item.gripWorld();
    if (!gw) return false;
    let best: Limb | null = null;
    let bd = Infinity;
    for (const k of ['handF', 'handB'] as LimbKey[]) {
      const l = this.L(k);
      if (!this.ok(k) || this.handBusy(l) || l.part.frozen) continue;
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

  private attach(item: Item, hand: Limb): void {
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
      (ip.noCollide ??= new Set()).add(l.part);
      (l.part.noCollide ??= new Set()).add(ip);
    }
    let support: Grip['support'] = null;
    const g2 = item.gripLocal(true);
    if (g2) {
      const other = this.L(hand.spec.key === 'handF' ? 'handB' : 'handF');
      if (this.ok(other.spec.key) && !this.handBusy(other)) {
        const sj = world.createImpulseJoint(RAPIER.JointData.spring(0, 260, 3, ha, g2), other.part.body, ip.body, true);
        sj.setContactsEnabled(false);
        support = { hand: other, joint: sj };
      }
    }
    item.holder = this;
    this.dropped = this.dropped.filter((d) => d.item !== item);
    this.grips.push({ item, hand, joint, support, t: 0 });
    // A hand is ~1000x lighter (rotationally) than a rifle, which leaves the joint's
    // angular lock badly conditioned; give the hand some of the item's inertia.
    hp.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, hand.extraI + ip.body.principalInertia() * 0.5, true);
    this.activatable = true;
    this.game.sound.impact('metal', 0.25, hp.x);
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
      ip.noCollide?.delete(l.part);
      l.part.noCollide?.delete(ip);
    }
  }

  private updateGrips(dt: number): void {
    for (const g of [...this.grips]) {
      const it = g.item;
      if (it.destroyed || !g.joint.isValid() || g.hand.gone || g.hand.part.destroyed || this.consciousness < 0.15) {
        this.dropItem(it);
        continue;
      }
      // a hard yank rips the item out of the hand
      const a = g.hand.part.localToWorld(0, -PX);
      const b = it.gripWorld()!;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.1) {
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
      const err = wrapAngle(this.f * (g.item.hold?.angle ?? 0) - ip.body.rotation());
      // a gentle trim on top of the arm pose (the arm muscles do the lifting)
      const ramp = clamp(g.t / 0.8, 0, 1) * str;
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
      const reach = g2 ? clamp(0.6 - span, 0.24, 0.6) : 0.64;
      const drop = g2 ? -0.1 : -0.03;
      const aim = this.armIK(side, f * reach, drop, g.item.hold?.angle ?? 0);
      if (aim) {
        out[('upperArm' + side) as LimbKey] = aim.upper;
        out[('lowerArm' + side) as LimbKey] = aim.lower;
        out[('hand' + side) as LimbKey] = aim.hand;
      }
      if (g.support) {
        const s2 = g.support.hand.spec.key.endsWith('F') ? 'F' : 'B';
        // where the second grip will be once the aiming arm is in place
        const sup = this.armIK(s2, f * (reach + span), drop + (g2 && g1 ? g2.y - g1.y : 0), null);
        if (sup) {
          out[('upperArm' + s2) as LimbKey] = sup.upper;
          out[('lowerArm' + s2) as LimbKey] = sup.lower;
          out[('hand' + s2) as LimbKey] = sup.hand;
        }
      }
    }
    return out;
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

  activate(): void {
    for (const g of this.grips) g.item.activate();
  }

  setActiveHeld(on: boolean): void {
    super.setActiveHeld(on);
    for (const g of this.grips) g.item.setActiveHeld(on);
  }

  protected onDestroy(): void {
    this.dropAll();
    for (const d of this.dropped) if (!d.item.destroyed) this.forgetItem(d.item);
    this.dropped.length = 0;
  }

  /** Short status line (shown in tooltips/tests). */
  status(): string {
    const drugs = (Object.keys(this.drugs) as (keyof typeof this.drugs)[]).filter((k) => this.drugs[k] > 0).map((k) => ` · ${k}`).join('');
    return `${this.alive ? (this.consciousness > 0.3 ? 'conscious' : 'unconscious') : 'dead'} · blood ${this.blood.toFixed(0)}%${drugs} · ${this.state}`;
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

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const grips = this.grips.map((g) => ({ item: ref(g.item), hand: g.hand.spec.key })).filter((g) => g.item >= 0);
    return grips.length ? { grips } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
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
    this.blood = (x.blood as number) ?? 100;
    this.consciousness = (x.consciousness as number) ?? 1;
    this.limp = !!x.limp;
    Object.assign(this.drugs, (x.drugs as Partial<typeof this.drugs>) ?? {});
    for (const k of (x.severed as LimbKey[]) ?? []) {
      const l = this.limbs.get(k);
      if (l && !l.gone) this.sever(l, 'cut');
    }
    for (const k of (x.broken as LimbKey[]) ?? []) {
      const l = this.limbs.get(k);
      if (l) l.broken = true;
    }
    if (x.alive === false) this.die();
    // people who were standing stay up (flipping or duplicating someone shouldn't floor them)
    this.setState(x.standing && this.alive && this.consciousness > 0.5 ? 'stand' : 'down');
    this.updateMotors(true);
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

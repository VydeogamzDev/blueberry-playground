import { RAPIER } from '../engine/Physics';
import { FIXED_DT, PX, WORLD } from '../engine/constants';
import { lerpAngle, rotate, wrapAngle, type V2 } from '../engine/math';
import { fromBase64 } from '../engine/base64';
import { Sprite, type Region } from '../engine/Sprites';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { Human } from './Human';
import { toggleRun, type HandSwitched } from './Machines';
import type { PixelArt } from '../art/PixelArt';
import type { LimbKey } from '../art/human';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

export interface CarConfig {
  body: () => PixelArt;
  /** The body's colliders (sprite pixels: see artRect()). */
  shapes: ShapeSpec[];
  /** Body density (kg/m^2). */
  density: number;
  wheel: () => PixelArt;
  wheelDensity: number;
  /** Wheel centers in body art pixels. */
  axles: [number, number][];
  /** Wheel radius (sprite px) of its collider: a tracked hull draws its wheels smaller, inside the belt. */
  wheelR: number;
  /** Wheels at these axles drawn with another sprite (a tracked hull's sprocket and idler). */
  idler?: { art: () => PixelArt; axles: number[] };
  /** Road speed at the Normal setting (m/s). */
  speed: number;
  /** Drive torque per wheel (N*m). */
  torque: number;
  /** Headlight (body art pixel), lit while driving. */
  headlight?: [number, number];
  /** Engine note: heavier vehicles rumble lower. */
  pitch: number;
  /**
   * How hard what it runs into is hit for its speed (see Human.onImpact()): a
   * car's front gives, so at Normal speed it maims and at Turbo it kills.
   */
  blunt: number;
  bodyName?: string;
  wheelName?: string;
  /** Its seats, the driver's first: people dropped on the cabin fill them in this order. */
  seats: SeatSpec[];
  /** Where someone let go of gets in (body art pixels: x, y, width, height). */
  cabin: [number, number, number, number];
  /** No seat belts to put on (a tank's hatch). */
  noBelts?: boolean;
  /** The body drawn again over whoever sits inside, windows cut out (see seeThrough()), and that of another look of the body. */
  front: () => PixelArt;
  frontOf: (body: PixelArt) => PixelArt;
  /** The stripe of the hull painted in its team's colour (a tank's: art px x0, y0, x1, y1, the ends left out). */
  band?: [number, number, number, number];
  /** The burnt-out body after it blows up (see wreckOf()), and its front layer. */
  wreck: () => PixelArt;
  wreckFront: () => PixelArt;
  /** Body art pixels: the engine (it smokes when the body is badly hurt) and the fuel tank (it goes up there). */
  engine: [number, number];
  fuel: [number, number];
  /** How much of a crash, a blast or a shot gets through (1: a car; a tank's armour lets little through). */
  armour: number;
  /** Its fuel going up (see Explosions). */
  blast: { power: number; radius: number; damage: number };
}

/** A seat in a vehicle (see Car.takeIn()). */
export interface SeatSpec {
  /** Where the hips go (body art pixel): the middle of the sitter's lower torso. */
  at: [number, number];
  /** Joint angles sat with (see Human's poses): legs out ahead, hands on the wheel or in the lap. */
  pose: Partial<Record<LimbKey, number>>;
  /** How far the seat leans back (rad). */
  recline: number;
  /**
   * Drawing order, 0 furthest back: the far side's seats behind the near side's,
   * the back row behind the front (whose seat backs hide the legs behind them).
   */
  band: number;
}

/** Top-speed settings (context menu), as multiples of a vehicle's Normal speed. */
export const GEARS = [
  { id: 'slow', label: 'Slow', k: 0.5 },
  { id: 'normal', label: 'Normal', k: 1 },
  { id: 'fast', label: 'Fast', k: 1.5 },
  { id: 'turbo', label: 'Turbo', k: 2.2 },
] as const;
export type Gear = (typeof GEARS)[number]['id'];

function gearOf(id: Gear) {
  return GEARS.find((g) => g.id === id) ?? GEARS[1];
}

/**
 * The fastest a wheel turns (rad/s): Rapier turns a body at most an eighth of a
 * turn a step, 94 rad/s at the usual step (a hair under, for the motor to reach
 * it). A car's small wheels top out at ~29 m/s, short of its Turbo's 33.
 */
const SPIN_MAX = (Math.PI / 4 / FIXED_DT) * 0.98;
/** How fast (m/s²) a vehicle no one drives slows down on the flat, rolling freely: nudged, it stops in a second or two. */
const ROLL_DRAG = 0.8;

/** Harm (hp) per N*s a vehicle bears down on a limb with, beyond what the limb takes in its stride (see crush()). */
const CRUSH = 0.7;

/**
 * Crashes (see onImpact()): a knock below `from` m/s (allowing for how light
 * what it hit is) does nothing, and beyond it the harm grows with the square:
 * `k` hp per (m/s)² out of the body's 100 (times its armour). Into a wall at
 * Normal speed it's dented; at Fast it smokes and may catch fire; at Turbo it
 * goes up.
 */
const CRASH = { from: 7, k: 0.4 };
/** Hurt below this (hp) the engine smokes; below `burns` the leaking fuel catches (and burning down to nothing, it goes up). */
const DAMAGE = { smokes: 60, burns: 25 };
/**
 * What its body bears pressed on by a weight (N: another car stacked on it, and more),
 * and the harm a second per newton past that (times its armour): a slab of several
 * tonnes set down on its roof crushes it in under a second (see onLoad()).
 */
const CRUSH_BEARS = 12000;
const CRUSHING = 0.003;
/**
 * What riders feel of a crash: the change of speed in a step (m/s) that starts to
 * hurt, harm per (m/s)² beyond it (a seat belt lets `belted` of it through), and
 * the sudden stop that sends anyone without a belt through the windscreen.
 */
const JOLT = { from: 6, k: 0.9, belted: 0.35, thrown: 12 };
/** Dragged this far (m) from the seat by the hand, for this long (s), a rider comes out. */
const PULL = { reach: 0.25, t: 0.05 };
/**
 * How long (s) the drive keys' say lasts unless it's renewed (see steer()): the
 * player's controls renew it every step, a guest's about thirty times a second
 * (over the network, with its delays), and a guest gone quiet lets go by itself.
 */
const HAND_HOLD = 0.3;
/**
 * Drawing depth over the body (see Car.zBase): the riders' bands, each deep
 * enough for a person's layers, start this far above it; the front layer goes
 * over them and the wheels over that.
 */
const Z_SEATS = 0.0025;
const Z_RIDER = 0.0165;

/** Someone sitting in a seat. */
interface Rider {
  who: Human;
  /** Holds their hips to the body. */
  joint: RAPIER.ImpulseJoint;
  /** The limb of theirs being dragged by the hand, and how long it's been pulled hard (see pulled()). */
  grabbed: Part | null;
  pull: number;
}

/** Harm building up in a limb that a vehicle bears down on: where, which way, and when it last did. */
interface Crush {
  dose: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  t: number;
}

/**
 * A wheeled vehicle: a body on motor-driven wheels (a car, a pickup, an SUV, a
 * tank's road wheels). Activate to drive the way it faces; wire it to power to
 * drive while powered; reverse and top speed from its menu. Hits people as hard
 * as you'd expect, and runs them over (see crush()).
 *
 * People let go of over its cabin get in (see takeIn()) and ride along, sitting
 * in its seats: held there at the hips, drawn between the body and its front
 * layer so they show through the windows. Crashes dent it, then it smokes, burns
 * and blows up (see onImpact()), leaving a burnt-out wreck.
 */
export class Car extends Entity implements HandSwitched {
  readonly body: Part;
  readonly wheels: Part[] = [];
  readonly cfg: CarConfig;
  on = false;
  heldOff = false;
  dir: 1 | -1 = 1;
  gear: Gear = 'normal';
  /** Read by Human/Creature onImpact() (see CarConfig.blunt). */
  readonly blunt: number;
  /** Riders are belted in: a crash hurts them less and never throws them out. */
  belts = false;
  /** Blown up: a burnt-out wreck that won't drive. */
  wrecked = false;
  private axles: RAPIER.RevoluteImpulseJoint[] = [];
  private applied = '';
  /** Switched off at speed: brakes down to a crawl, then rolls freely again. */
  private braking = false;
  /** Parked, the brakes stay on rather than letting it roll (a tank's tracks: it holds still when it fires). */
  protected parkBrake = false;
  /**
   * Driven by hand (see steer()): the way it's driven on screen (-1 left, 1
   * right, 0 not), a tank's barrel being raised (1) or lowered (-1), and how
   * much longer that holds unless renewed.
   */
  protected handX = 0;
  protected handAim = 0;
  private handT = 0;
  private crushed = new Map<Part, Crush>();
  /** Who sits in each seat (CarConfig.seats). */
  private riders: (Rider | null)[];
  /**
   * Others' parts kept from touching it (riders, what they hold, and those just
   * out who are still inside its outline), with their own collision groups to
   * go back to: see ghost().
   */
  private ghosts = new Map<Part, number>();
  private ghostT = 0;
  /** The hardest knock this step (see onImpact()). */
  private knock = 0;
  /** Its speed a moment ago, and its velocity then, for the riders (see ride()). */
  private cruise = 0;
  private cruiseX = 0;
  private cruiseY = 0;
  /** Wheels the blast tore off their axles. */
  private loose = new Set<number>();
  private smokeT = 0;
  private front: FrontLayer | null = null;
  /** The body's look, other than its own art (a tank's team stripe: see dressBody()). */
  protected look: PixelArt | null = null;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.cfg = cfg;
    this.blunt = cfg.blunt;
    this.activatable = true;
    this.usesPower = true;
    const art = cfg.body();
    // keep the wheels out of the floor
    const below = (Math.max(...cfg.axles.map(([, ay]) => ay)) + 0.5 - art.h / 2 + cfg.wheelR) * PX;
    y = Math.max(y, WORLD.floor + below + 0.02);
    // continuous collision: at speed it would pass through a leg in a step
    this.body = this.addPart({
      name: cfg.bodyName ?? 'Body', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, density: cfg.density,
      textureKey: def.id + ':body', layer: 1, shapes: cfg.shapes, ccd: true,
    });
    cfg.axles.forEach(([ax, ay], i) => {
      const l = this.body.pixelToLocal(ax, ay);
      const w = this.body.localToWorld(l.x, l.y);
      const idler = cfg.idler?.axles.includes(i) ? cfg.idler : undefined;
      // (barely bouncy: rubber's own bounce launches a fast car off every bump)
      const wheel = this.addPart({
        name: cfg.wheelName ?? 'Wheel', art: idler ? idler.art() : cfg.wheel(), material: MAT.rubber, x: w.x, y: w.y,
        density: cfg.wheelDensity, restitution: 0.1, textureKey: def.id + (idler ? ':idler' : ':wheel'), layer: 2,
        shapes: [{ kind: 'ball', r: cfg.wheelR }], angularDamping: 0.05, ccd: true,
      });
      const j = this.addJoint(RAPIER.JointData.revolute(l, { x: 0, y: 0 }), this.body, wheel) as RAPIER.RevoluteImpulseJoint;
      j.configureMotorModel(RAPIER.MotorModel.ForceBased);
      this.wheels.push(wheel);
      this.axles.push(j);
    });
    this.riders = cfg.seats.map(() => null);
    // depth for the riders and the front layer over them, kept from the next things made
    const top = this.frontZ + 0.0005 - this.zBase;
    for (let z = 0.02; z < top + 0.0005; z += 0.02) game.allocZ();
    // the wheels in front of it all
    for (const w of this.wheels) w.sprite.z = this.frontZ + 0.0005;
    this.apply();
  }

  /** Driven with the keys, or switched on by hand or powered (unless stopped by hand meanwhile: see HandSwitched), and not a wreck. */
  get driving(): boolean {
    return (this.handX !== 0 || ((this.on || this.powered) && !this.heldOff)) && !this.wrecked;
  }

  /** Who sits in seat `i` (null: nobody). */
  occupant(i: number): Human | null {
    return this.riders[i]?.who ?? null;
  }

  /** Drawing depth of the front layer: over every rider's band (see Z_SEATS). */
  private get frontZ(): number {
    return this.zBase + Z_SEATS + this.cfg.seats.length * Z_RIDER + 0.0005;
  }

  /** Road speed (m/s) at the current setting, or as fast as its wheels can turn (see SPIN_MAX). */
  get topSpeed(): number {
    return Math.min(this.cfg.speed * gearOf(this.gear).k, SPIN_MAX * this.cfg.wheelR * PX);
  }

  canRest(): boolean {
    return !this.driving && !this.braking;
  }

  private apply(): void {
    const sig = `${this.driving}:${this.dir}:${this.gear}:${this.braking || this.parkBrake}:${this.handX}`;
    if (sig === this.applied) return;
    this.applied = sig;
    // a little more pull in the higher settings keeps them lively
    const torque = this.cfg.torque * (0.25 + 0.75 * gearOf(this.gear).k);
    const spin = this.topSpeed / (this.cfg.wheelR * PX);
    // which way it goes on screen: as steered with the keys, else the way it faces (or backs up)
    const right = this.handX || this.dir * (this.flipped ? -1 : 1);
    // each wheel's share of the drag that slows the whole of it ROLL_DRAG m/s² on the flat
    const held = this.axles.filter((j) => j.isValid()).length;
    const roll = held && (this.totalMass() * ROLL_DRAG * this.cfg.wheelR * PX) / held;
    for (const j of this.axles) {
      if (!j.isValid()) continue;
      if (this.driving) {
        // wheels turn clockwise to drive right
        j.configureMotorVelocity(-spin * right, torque * 0.5);
        j.setMotorMaxForce(torque);
      } else if (this.braking || this.parkBrake) {
        j.configureMotorVelocity(0, torque * 0.5);
        j.setMotorMaxForce(torque * 0.6);
      } else {
        // free-rolling with a little drag (as heavy as it is: nudged, it comes to rest in a second or two)
        j.configureMotorVelocity(0, roll * 4);
        j.setMotorMaxForce(roll);
      }
    }
    for (const p of this.parts) if (!p.destroyed && !p.frozen) p.body.wakeUp();
  }

  preStep(dt: number): void {
    const b = this.body;
    // the keys stopped saying how to drive it (a guest gone quiet): let go
    if (this.handT > 0 && (this.handT -= dt) <= 0) this.handX = this.handAim = 0;
    // stopped by hand while powered: once the power's gone, the circuit has its say again
    if (this.heldOff && !this.powered) this.heldOff = false;
    if (this.driving) this.braking = true;
    // (braked to a near stop: let go below 1 m/s, a heavy car rolls on a long way)
    else if (this.braking && (b.destroyed || Math.hypot(b.vx, b.vy) < 0.15)) this.braking = false;
    this.apply();
    if (!this.driving || b.destroyed) return;
    // the engine note follows the road speed
    const w = this.wheels[0];
    const k = w && !w.destroyed ? (Math.abs(w.av - b.av) * this.cfg.wheelR * PX) / this.cfg.speed : 0;
    this.game.sound.hold(this, 'machine/motor_loop', 0.18 + Math.min(1, k) * 0.25, b.x, this.cfg.pitch * (0.5 + 0.6 * Math.sqrt(Math.min(2.5, k))));
  }

  postStep(dt: number): void {
    this.crush(dt);
    const b = this.body;
    if (b.destroyed) return;
    if (this.riders.some((r) => r)) this.ride(dt);
    // the hardest knock this step: a crash dents it, and a bad one sets the fuel off
    const k = this.knock;
    this.knock = 0;
    if (k > CRASH.from) this.harm((k - CRASH.from) ** 2 * CRASH.k * this.cfg.armour);
    this.smoulder(dt);
    if (this.ghosts.size && (this.ghostT -= dt) <= 0) {
      this.ghostT = 0.2;
      this.ghost();
    }
  }

  /**
   * The riders, after the step: anyone gone (deleted, cut free of their hips)
   * leaves their seat, someone dragged out by the hand comes out, and a crash
   * (the body's speed changing hard in a step) is felt in the seats.
   */
  private ride(dt: number): void {
    const b = this.body;
    const v = b.body.linvel();
    const speed = Math.hypot(v.x, v.y);
    const jolt = Math.hypot(v.x - b.vx, v.y - b.vy);
    // how fast it was going a moment ago (a crash may take a few steps to stop it
    // dead), and which way: a sudden stop going forward or back sends the
    // unbelted on through the windscreen, a hard landing doesn't
    this.cruise -= dt * 30;
    if (speed >= this.cruise) {
      this.cruise = speed;
      this.cruiseX = v.x;
      this.cruiseY = v.y;
    }
    // (only a knock jolts them: not being swung about by the hand)
    const hit = this.knock > 0 && jolt > JOLT.from;
    const c = Math.cos(b.a);
    const s = Math.sin(b.a);
    const along = this.cruiseX * c + this.cruiseY * s;
    const across = this.cruiseY * c - this.cruiseX * s;
    const stop = hit && Math.abs(along) > Math.abs(across) && this.cruise - speed >= JOLT.thrown;
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      if (!r) continue;
      const h = r.who;
      const hips = h.limbs.get('lowerTorso');
      if (h.destroyed || !r.joint.isValid() || !hips || hips.gone || !hips.attached) {
        this.release(i, 'free');
        continue;
      }
      if (r.grabbed && this.pulled(r, dt)) {
        this.release(i, 'free');
        continue;
      }
      if (!hit) continue;
      // thrown about in the seat: the head and chest take it
      const harm = (jolt - JOLT.from) ** 2 * JOLT.k * (this.belts ? JOLT.belted : 1);
      for (const key of ['head', 'upperTorso'] as LimbKey[]) {
        const l = h.limbs.get(key);
        if (l && !l.gone) h.damage(l.part, harm * 0.5, 'blunt', { x: l.part.x, y: l.part.y });
      }
      if (stop && !this.belts && !h.destroyed) this.release(i, 'thrown', { x: this.cruiseX * 0.8, y: this.cruiseY * 0.8 + 1.5 });
    }
  }

  /** Is the hand dragging this rider pulling them hard out of the seat (for long enough to count)? */
  private pulled(r: Rider, dt: number): boolean {
    const g = r.grabbed!;
    if (g.destroyed) {
      r.grabbed = null;
      return false;
    }
    // how far the drag's spring is stretched: the hand's anchor is the kinematic body on it
    const joints = this.game.physics.world.impulseJoints;
    let stretch = 0;
    joints.forEachJointHandleAttachedToRigidBody(g.body.handle, (hd) => {
      const j = joints.get(hd);
      if (!j || !j.isValid() || !j.body1().isKinematic()) return;
      const hand = j.body1().translation();
      const a = j.anchor2();
      const at = g.localToWorld(a.x, a.y);
      stretch = Math.max(stretch, Math.hypot(hand.x - at.x, hand.y - at.y));
    });
    r.pull = stretch > PULL.reach ? r.pull + dt : 0;
    return r.pull > PULL.t;
  }

  /**
   * Bumping into things: how hard a stop it was, for the speed it hit at and
   * how heavy what it hit is, all of it (a crate or a person is knocked aside
   * rather than stopping it, and anything that bleeds gives more still; a
   * tank's wheel is a tank). The worst this step counts (see postStep()); the
   * wheels take some of it.
   */
  onImpact(info: ImpactInfo): void {
    const p = info.part;
    if (this.wrecked || (p !== this.body && !this.wheels.includes(p))) return;
    const o = info.other;
    const mass = o && info.otherMass < Infinity ? Math.max(info.otherMass, o.entity.totalMass()) : Infinity;
    let k = info.speed * Math.min(1, mass / (0.5 * this.body.mass));
    if (o?.mat.bleeds) k *= 0.3;
    if (p !== this.body) k *= 0.5;
    this.knock = Math.max(this.knock, k);
  }

  /**
   * Harm comes to the body only (the wheels and a tank's barrel shrug it off):
   * blasts and knocks as much as its armour lets through, fire burning it down.
   * A big blast on a body already badly hurt sets the fuel off.
   */
  damage(part: Part, amount: number, kind: DamageKind): void {
    if (part !== this.body || this.wrecked) return;
    const a = this.cfg.armour;
    if (kind === 'explosion') {
      if (part.hp < 35 && amount * a > 40) this.explode();
      else this.harm(amount * 0.45 * a);
    } else if (kind === 'fire') this.harm(amount * 0.6 * Math.sqrt(a));
    else this.harm(amount * 0.1 * a);
  }

  /** Something heavy pressing on its body (a slab on its roof): past what it bears, crushed (see harm()). */
  onLoad(part: Part, other: Part, force: number): void {
    if (part !== this.body || this.wrecked || other.entity.canWalk || force <= CRUSH_BEARS) return;
    this.harm((force - CRUSH_BEARS) * CRUSHING * this.game.stepDt * this.cfg.armour);
  }

  /** Shot: a dent; into a body that's badly hurt, the shot may light the leaking fuel or set it off. */
  onBullet(hit: BulletHit): void {
    const b = this.body;
    if (hit.part !== b || this.wrecked) return;
    this.harm(hit.damage * 0.06 * this.cfg.armour);
    if (this.wrecked || b.hp >= 35 || Math.random() > 0.15) return;
    if (b.hp < 15) this.explode();
    else this.leak();
  }

  /** Takes `n` hp off the body: badly hurt it smokes, then burns; at nothing the fuel goes up. */
  private harm(n: number): void {
    const b = this.body;
    if (this.wrecked || b.destroyed || n <= 0) return;
    b.hp = Math.max(0, b.hp - n);
    if (b.hp <= 0) this.explode();
    else if (b.hp < DAMAGE.burns) this.leak();
  }

  /** Fuel leaks and catches: it burns, and burning on, it goes up (see damage()). */
  private leak(): void {
    const b = this.body;
    if (b.burning > 0.1) return;
    b.oil = Math.max(b.oil, 0.5);
    this.game.fire.ignite(b, 0.4);
  }

  /** Smoke from the engine of a body that's badly hurt: more, and darker, the worse it is. */
  private smoulder(dt: number): void {
    const b = this.body;
    if (this.wrecked || b.hp >= DAMAGE.smokes) return;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    const bad = 1 - b.hp / DAMAGE.smokes;
    this.smokeT = 0.3 - bad * 0.2;
    const e = b.pixelToWorld(this.cfg.engine[0], this.cfg.engine[1]);
    this.game.particles.smoke(e.x, e.y, 1, 0.25 + bad * 0.3, b.hp < 35);
  }

  /** The fuel goes up: a blast at the tank, and what's left is a burnt-out wreck (riders and all). */
  explode(): void {
    if (this.wrecked || this.destroyed || this.body.destroyed) return;
    const at = this.body.pixelToWorld(this.cfg.fuel[0], this.cfg.fuel[1]);
    this.game.explosions.explode(at.x, at.y, { ...this.cfg.blast, incendiary: true, shrapnel: 6, source: this });
    this.game.sound.play('explosion/debris', { gain: 0.8, x: at.x, vary: 0.1 });
    this.game.particles.debris(at.x, at.y, 0, 1, 12, 0x2c2a28, 6);
    this.wreck(true);
    // the blast tears wheels off their axles (a tank's stay in its track)
    if (!this.cfg.idler) this.wheels.forEach((_, i) => Math.random() < 0.5 && this.shed(i));
  }

  /** Burnt out: blackened, the glass gone, nothing left to drive it; `fresh` from the blast, still burning. */
  private wreck(fresh: boolean): void {
    const b = this.body;
    this.wrecked = true;
    this.on = this.heldOff = false;
    this.apply();
    b.hp = 0;
    b.setArt(this.cfg.wreck());
    b.charred = Math.max(b.charred, 0.7);
    this.front?.setArt(this.cfg.wreckFront());
    if (!fresh) return;
    for (const w of this.wheels) w.charred = Math.max(w.charred, 0.45);
    b.oil = Math.max(b.oil, 0.7);
    this.game.fire.ignite(b, 1);
  }

  /**
   * Mended: a wreck made whole again (in its own look, or its side's: see
   * dressBody()), and the wheels torn off put back on their axles.
   */
  repair(): void {
    const b = this.body;
    if (b.destroyed) return;
    if (this.wrecked) {
      this.wrecked = false;
      b.setArt(this.look ?? this.cfg.body());
      this.front?.setArt(this.look ? this.cfg.frontOf(this.look) : this.cfg.front());
    }
    super.repair();
    for (const i of this.loose) this.remount(i);
    this.loose.clear();
    this.apply();
  }

  /** A wheel torn off put back on its axle (unless it's gone altogether). */
  private remount(i: number): void {
    const w = this.wheels[i];
    if (!w || w.destroyed) return;
    const [ax, ay] = this.cfg.axles[i];
    const l = this.body.pixelToLocal(ax, ay);
    const at = this.body.localToWorld(l.x, l.y);
    w.teleport(at.x, at.y, w.body.rotation());
    w.body.setLinvel(this.body.body.linvel(), true);
    w.group = this.body.group;
    const j = this.addJoint(RAPIER.JointData.revolute(l, { x: 0, y: 0 }), this.body, w) as RAPIER.RevoluteImpulseJoint;
    j.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.axles[i] = j;
  }

  /** A wheel torn off its axle: it rolls away on its own, and knocks into the body like anything else. */
  private shed(i: number): void {
    const j = this.axles[i];
    if (j?.isValid()) this.removeJoint(j);
    const w = this.wheels[i];
    if (w && !w.destroyed) w.group = 0;
    this.loose.add(i);
  }

  // ---- riders -------------------------------------------------------------

  /**
   * Someone let go of at `at` (see Human.board()): over the cabin, they get in,
   * in the first free seat (the driver's first), turned round first if they
   * face the other way. False if it isn't for them, or it's full.
   */
  takeIn(who: Human, at: V2): boolean {
    if (this.destroyed || this.wrecked || this.body.destroyed || who.destroyed || who.seat) return false;
    const i = this.riders.indexOf(null);
    if (i < 0 || !this.overCabin(at, who)) return false;
    const hips = who.limbs.get('lowerTorso');
    if (!hips || hips.gone || !hips.attached) return false;
    let h: Entity | null = who;
    // (turned round they're made anew: see Game.flipEntity())
    if (who.flipped !== this.flipped) h = this.game.flipEntity(who);
    if (h instanceof Human && !h.destroyed) {
      this.seat(h, i);
      this.game.sound.play('machine/car_door', { gain: 0.38, x: this.body.x, vary: 0.05 });
    }
    return true;
  }

  /** Is the point, or the person's middle, over the cabin (or just above its roof)? */
  private overCabin(at: V2, who: Human): boolean {
    const [x, y, w, h] = this.cfg.cabin;
    const over = (p: V2) => {
      const q = this.body.worldToPixel(p.x, p.y);
      return q.ix >= x && q.ix < x + w && q.iy >= y - 12 && q.iy < y + h;
    };
    const mid = who.limbs.get('midTorso')?.part;
    return over(at) || (!!mid && !mid.destroyed && over(mid));
  }

  /** Sits someone in seat `i`: posed in it, held at the hips, drawn inside it and kept from touching it. */
  private seat(h: Human, i: number): void {
    const s = this.cfg.seats[i];
    const b = this.body;
    this.place(h, s);
    const hips = h.limbs.get('lowerTorso')!.part;
    const data = RAPIER.JointData.fixed(b.pixelToLocal(s.at[0], s.at[1]), s.recline * b.flip, { x: 0, y: 0 }, 0);
    const joint = this.game.physics.world.createImpulseJoint(data, b.body, hips.body, true);
    joint.setContactsEnabled(false);
    const r: Rider = { who: h, joint, grabbed: null, pull: 0 };
    this.riders[i] = r;
    h.sit({
      pose: s.pose,
      leave: () => this.riders[i] === r && this.release(i, 'out'),
      grabbed: (p) => {
        r.grabbed = p;
        r.pull = 0;
      },
    });
    // drawn behind the front layer, in the seat's band
    h.zBase = this.zBase + Z_SEATS + s.band * Z_RIDER;
    for (const p of h.parts) if (!p.destroyed) p.updateZ();
    this.ghost();
    this.showFront();
  }

  /**
   * Puts someone in a seat's pose: every limb where the pose has it, worked down
   * from the upper torso (turned so the hips lean back as the seat does) with
   * the hips on the seat, moving along with the body.
   */
  private place(h: Human, s: SeatSpec): void {
    const b = this.body;
    const f = h.flipped ? -1 : 1;
    const rel = (k: LimbKey) => (s.pose[k] ?? 0) * f;
    const pose = new Map<Part, { x: number; y: number; a: number }>();
    // (each joint's angle is the child's turn less its parent's)
    const a0 = b.body.rotation() + s.recline * f - rel('lowerTorso') - rel('midTorso');
    for (const l of h.limbs.values()) {
      if (l.gone || !l.attached) continue;
      const up = l.parent ? pose.get(l.parent.part) : undefined;
      if (!l.parent) pose.set(l.part, { x: 0, y: 0, a: a0 });
      if (!up) continue;
      const a = up.a + rel(l.spec.key);
      const j1 = rotate(l.a1.x, l.a1.y, up.a);
      const j2 = rotate(l.a2.x, l.a2.y, a);
      pose.set(l.part, { x: up.x + j1.x - j2.x, y: up.y + j1.y - j2.y, a });
    }
    const hips = pose.get(h.limbs.get('lowerTorso')!.part);
    if (!hips) return;
    const seat = b.pixelToWorld(s.at[0], s.at[1]);
    const av = b.body.angvel();
    for (const [p, q] of pose) {
      const x = seat.x + q.x - hips.x;
      const y = seat.y + q.y - hips.y;
      p.teleport(x, y, q.a);
      p.body.setLinvel(b.velocityAt(x, y), true);
      p.body.setAngvel(av, true);
    }
  }

  /**
   * Lets the rider in seat `i` go: 'out' gets out onto their feet beside the
   * door (as best they can), 'free' leaves them where they are (dragged out,
   * cut loose, or the car's gone), 'thrown' sends them on at `v`.
   */
  private release(i: number, how: 'out' | 'free' | 'thrown', v?: V2): void {
    const r = this.riders[i];
    if (!r) return;
    this.riders[i] = null;
    if (r.joint.isValid()) this.game.physics.world.removeImpulseJoint(r.joint, true);
    const h = r.who;
    if (!h.destroyed) {
      const stand = how === 'out' && this.stepOut(h, this.cfg.seats[i]);
      if (how === 'thrown' && v) for (const p of h.parts) if (!p.destroyed && !p.frozen) p.body.setLinvel(v, true);
      h.sit(null, stand);
      // drawn on its own again (in front: they're nearest to hand); they touch the car again once clear of it (see ghost())
      h.zBase = this.game.allocZ();
      for (const p of h.parts) if (!p.destroyed) p.updateZ();
      if (how === 'out') this.game.sound.play('machine/car_door', { gain: 0.32, x: h.parts[0].x, vary: 0.05 });
    }
    this.showFront();
  }

  /** Gets everyone out (the menu's "Get out" or "Everyone out"). */
  private everyoneOut(): void {
    for (let i = 0; i < this.riders.length; i++) this.release(i, 'out');
  }

  /**
   * Stands someone on the ground beside a seat's door, in the standing pose
   * they were made in. False (left where they are) when the car lies on its
   * side or its roof: they'll have to climb out.
   */
  private stepOut(h: Human, s: SeatSpec): boolean {
    const b = this.body;
    if (b.destroyed || Math.abs(wrapAngle(b.body.rotation())) > 0.6) return false;
    const f = h.flipped ? -1 : 1;
    const door = b.pixelToWorld(s.at[0] + 6, s.at[1]);
    // on whatever the wheels stand on (the floor, or what it's parked on)
    let soles = this.game.env.groundAt(door.x, door.y);
    this.wheels.forEach((w, i) => {
      if (!w.destroyed && !this.loose.has(i)) soles = Math.max(soles, Math.min(door.y, w.y - this.cfg.wheelR * PX));
    });
    for (const l of h.limbs.values()) {
      if (l.gone || !l.attached) continue;
      const x = door.x + l.spec.cx * f * PX;
      const y = soles + l.spec.cy * PX + 0.01;
      l.part.teleport(x, y, 0);
      l.part.body.setLinvel(b.velocityAt(x, y), true);
      l.part.body.setAngvel(0, true);
    }
    return true;
  }

  /**
   * Keeps riders (and what they hold) from touching the car or each other:
   * their parts go in its collision group (see Part.group). Once out, each gets
   * its own back when it's clear of the car and of those still inside.
   */
  private ghost(): void {
    const group = this.body.group;
    const want = new Set<Part>();
    for (const r of this.riders) {
      if (!r || r.who.destroyed) continue;
      for (const l of r.who.limbs.values()) if (!l.gone && l.attached) want.add(l.part);
      for (const it of r.who.heldItems()) for (const p of it.parts) if (!p.destroyed) want.add(p);
    }
    for (const p of want) {
      // (its own: it may still be in another car's, just out of that one)
      if (!this.ghosts.has(p)) this.ghosts.set(p, p.entity.selfCollide ? 0 : p.entity.id);
      p.group = group;
    }
    // the rest go back whole, each thing all at once (a person's limbs in two
    // groups would hit each other), once none of it is in the way
    const out = new Map<Entity, Part[]>();
    for (const p of this.ghosts.keys()) {
      if (want.has(p)) continue;
      // (cut loose meanwhile, a limb has a group of its own)
      if (p.destroyed || p.group !== group) {
        this.ghosts.delete(p);
        continue;
      }
      const list = out.get(p.entity);
      if (list) list.push(p);
      else out.set(p.entity, [p]);
    }
    for (const list of out.values()) {
      if (list.some((p) => this.touching(p, want))) continue;
      for (const p of list) {
        p.group = this.ghosts.get(p)!;
        this.ghosts.delete(p);
      }
    }
  }

  /** Does a part overlap the car, or any of those still inside it? */
  private touching(p: Part, inside: Set<Part>): boolean {
    const near = (q: Part) => {
      if (q.destroyed || Math.hypot(p.x - q.x, p.y - q.y) > p.reach + q.reach + 0.05) return false;
      for (const c1 of p.colliders) for (const c2 of q.colliders) if (c1.contactCollider(c2, 0.02)) return true;
      return false;
    };
    for (const q of this.parts) if (near(q)) return true;
    for (const q of inside) if (near(q)) return true;
    return false;
  }

  /** The front layer is drawn while anyone sits inside. */
  private showFront(): void {
    const any = this.riders.some((r) => r);
    if (any && !this.front && !this.body.destroyed) {
      this.front = new FrontLayer(this.body, this.wrecked ? this.cfg.wreckFront() : this.look ? this.cfg.frontOf(this.look) : this.cfg.front(), this.frontZ);
    } else if (!any && this.front) {
      this.front.dispose();
      this.front = null;
    }
  }

  /**
   * Running someone over. A wheel (or the floor pan) bearing down on a person's or
   * an animal's limb is too slow a contact to be an impact (see Impacts), so the
   * harm is worked out here from the load the solver puts through it: beyond what
   * the limb takes from someone standing on it, while the vehicle moves or its
   * wheels spin on it, harm builds up in the limb and lands as one blow when the
   * wheel rolls off (or sooner under a heavy one). A car's pass breaks bones the
   * way a hard knock does; a tank's crushes them.
   */
  private crush(dt: number): void {
    const game = this.game;
    const b = this.body;
    const now = game.time;
    const speed = b.destroyed ? 0 : Math.hypot(b.vx, b.vy);
    if (speed > 0.3 || this.driving) {
      const world = game.physics.world;
      for (const p of this.parts) {
        if (p.destroyed) continue;
        // a wheel spinning on someone grinds them even where it stands
        const v = p === b ? speed : Math.max(speed, Math.abs(p.av - b.av) * this.cfg.wheelR * PX);
        if (v < 0.3) continue;
        for (const c of p.colliders) {
          world.contactPairsWith(c, (o) => {
            const q = game.physics.partOf(o);
            if (!q || q.destroyed || q.frozen || q.entity === this || !q.entity.canWalk) return;
            world.contactPair(c, o, (m) => {
              const n = m.numContacts();
              if (!n) return;
              // pressing it down into what it lies on: not shoving it along, nor carrying it
              const nm = m.normal();
              const s = (q.x - p.x) * nm.x + (q.y - p.y) * nm.y < 0 ? -1 : 1;
              if (nm.y * s > -0.35) return;
              let impulse = 0;
              for (let i = 0; i < n; i++) impulse += m.contactImpulse(i);
              const over = impulse / dt - (150 + 20 * q.mass);
              if (over <= 0) return;
              let k = this.crushed.get(q);
              if (!k) this.crushed.set(q, (k = { dose: 0, x: q.x, y: q.y, dx: 0, dy: -1, t: now }));
              k.dose += over * dt * CRUSH * Math.min(2.5, 0.4 + v / 6);
              k.t = now;
              k.dx = nm.x * s;
              k.dy = nm.y * s;
              const pt = m.numSolverContacts() > 0 ? m.solverContactPoint(0) : null;
              if (pt) {
                k.x = pt.x;
                k.y = pt.y;
              }
            });
          });
        }
      }
    }
    // a limb it has rolled off (a few steps ago: contacts flicker) takes it all as one blow
    for (const [q, k] of this.crushed) {
      if (now - k.t < 0.03 && k.dose < q.maxHp * 0.6) continue;
      this.crushed.delete(q);
      if (q.destroyed || k.dose < 2) continue;
      q.entity.damage(q, k.dose, 'blunt', { x: k.x, y: k.y }, { x: k.dx, y: k.dy });
      if (q.mat.bleeds) game.sound.fleshHit(k.dose / q.maxHp, k.x);
      else game.sound.impact(q.mat.sound, k.dose / q.maxHp, k.x);
    }
  }

  frame(): void {
    const hl = this.cfg.headlight;
    if (!hl || !this.driving || this.body.destroyed) return;
    const b = this.body;
    const h = b.pixelToWorld(hl[0], hl[1]);
    const d = b.localDir(b.flip, 0);
    this.game.renderer.addLight(h.x + d.x * 1.4, h.y + d.y * 1.4, 2.4, 0.45, 0xfff2c0);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  /** Drives if it isn't driving, stops if it is, whatever powers it (see toggleRun()). */
  activate(): void {
    toggleRun(this, this.driving, this.powered);
    // (a wreck's switch clicks, and nothing happens)
    if (this.wrecked) this.on = this.heldOff = false;
    this.game.sound.click(this.body.x, this.driving ? 1 : 0.7);
    this.apply();
  }

  /**
   * Driven by hand (the drive keys, with it selected: see Controls.steer()):
   * `x` is the way to go on screen, -1 left or 1 right, forward or in reverse
   * whichever way it faces (0: let go, and it brakes as when switched off);
   * `aim` raises (1) or lowers (-1) a tank's barrel. It holds a moment
   * (HAND_HOLD) unless it's renewed.
   */
  steer(x: number, aim = 0): void {
    this.handX = Math.sign(x);
    this.handAim = Math.sign(aim);
    this.handT = this.handX || this.handAim ? HAND_HOLD : 0;
    this.apply();
  }

  /** Driven by its own crew (a tank on a side: see Tank): as steer() with the drive keys, the aim left be. */
  protected autoDrive(x: number): void {
    this.handX = Math.sign(x);
    this.handT = this.handX || this.handAim ? HAND_HOLD : 0;
    this.apply();
  }

  /**
   * The body in another look of the same art (a tank's team stripe; null: its
   * own), its paint kept, the front layer over the riders with it. A wreck stays
   * burnt out (it takes the look if it's ever repaired).
   */
  protected dressBody(art: PixelArt | null): void {
    this.look = art;
    if (this.wrecked || this.body.destroyed) return;
    const a = art ?? this.cfg.body();
    if (this.body.art !== a) {
      const paint = this.body.paintData();
      this.body.setArt(a);
      if (paint) this.body.restorePaint(paint);
    }
    this.front?.setArt(art ? this.cfg.frontOf(art) : this.cfg.front());
  }

  contextActions(): ContextAction[] {
    // (Drive stays first: the tank's menu puts its own Use, Fire, before it)
    const acts: ContextAction[] = [
      { label: this.driving ? 'Stop' : 'Drive', hint: 'F', disabled: this.wrecked, action: () => this.activate() },
      { label: 'Reverse', checked: this.dir === -1, action: () => { this.dir = this.dir === 1 ? -1 : 1; this.apply(); } },
    ];
    for (const g of GEARS) acts.push({ label: `Speed: ${g.label}`, checked: this.gear === g.id, action: () => { this.gear = g.id; this.apply(); } });
    const n = this.riders.filter((r) => r).length;
    if (n) acts.push({ label: n > 1 ? 'Everyone out' : 'Get out', action: () => this.everyoneOut() });
    if (!this.cfg.noBelts) acts.push({ label: 'Seat belts', checked: this.belts, action: () => (this.belts = !this.belts) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { on: this.on, dir: this.dir, gear: this.gear };
    if (this.heldOff) x.off = true;
    if (this.belts) x.belts = true;
    if (this.wrecked) x.wrecked = true;
    if (this.loose.size) x.loose = [...this.loose];
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.dir = x.dir === -1 ? -1 : 1;
    // (saves from before the setting drive at Normal)
    this.gear = GEARS.find((g) => g.id === x.gear)?.id ?? 'normal';
    this.belts = !!x.belts;
    if (x.wrecked) this.wreck(false);
    for (const i of (x.loose as number[] | undefined) ?? []) if (this.wheels[i]) this.shed(i);
    this.apply();
  }

  /** Who sits where (by snapshot index, -1 for an empty seat). */
  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    if (!this.riders.some((r) => r && !r.who.destroyed)) return undefined;
    return { seats: this.riders.map((r) => (r && !r.who.destroyed ? ref(r.who) : -1)) };
  }

  /** Sits them back down in their seats (posed afresh: a mirrored or moved copy fits all the same). */
  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const seats = links.seats as number[] | undefined;
    if (!seats || this.body.destroyed) return;
    seats.forEach((k, i) => {
      const h = get(k);
      if (i >= this.riders.length || this.riders[i] || !(h instanceof Human) || h.destroyed || h.seat || h.flipped !== this.flipped) return;
      this.seat(h, i);
    });
  }

  /** Riders go where it goes (flipped, duplicated, copied), with what they hold. */
  attachedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const r of this.riders) if (r && !r.who.destroyed) out.push(r.who, ...r.who.attachedEntities());
    return out;
  }

  protected onDestroy(): void {
    // riders are left where they sit, and fall
    for (let i = 0; i < this.riders.length; i++) this.release(i, 'free');
    // what was kept from touching it touches everything again
    for (const [p, g] of this.ghosts) if (!p.destroyed && p.group === this.body.group) p.group = g;
    this.ghosts.clear();
    this.front?.dispose();
    this.front = null;
  }
}

/**
 * The body drawn again over whoever sits inside, its windows and wheel wells
 * cut out (see seeThrough()): they show through the glass, and the doors hide
 * the rest of them. It follows the body each frame as the body's own sprite
 * does (see Part.render()), tinted, flashed and charred with it, and the body's
 * paint (bullet holes, blood, scorch) is copied onto it.
 */
class FrontLayer {
  private readonly sprite: Sprite;
  private readonly region: Region;
  /** Its art's pixels, and those with the body's paint on them (see sync()). */
  private base: Uint8Array;
  private readonly image: Uint8Array;
  /** The body's paintData() last copied (undefined: copy it again). */
  private paint: string | null | undefined = undefined;
  private syncT = 0;
  private readonly draw = (dt: number, alpha: number) => this.frame(dt, alpha);

  constructor(private readonly body: Part, art: PixelArt, z: number) {
    const game = body.entity.game;
    this.region = game.renderer.sprites.alloc(art.w + 2, art.h + 2);
    this.base = art.toRGBA(1);
    this.image = this.base.slice();
    this.sprite = new Sprite(this.region);
    this.sprite.w = (art.w + 2) * PX * body.flip;
    this.sprite.h = (art.h + 2) * PX;
    this.sprite.z = z;
    game.frameHandlers.push(this.draw);
    this.frame(0, 1);
  }

  /** Another art of the same size (burnt out). */
  setArt(art: PixelArt): void {
    this.base = art.toRGBA(1);
    this.paint = undefined;
  }

  private frame(dt: number, alpha: number): void {
    const b = this.body;
    if (b.destroyed) return;
    const s = this.sprite;
    s.x = b.px + (b.x - b.px) * alpha;
    s.y = b.py + (b.y - b.py) * alpha;
    s.a = lerpAngle(b.pa, b.a, alpha);
    const t = b.sprite;
    s.r = t.r;
    s.g = t.g;
    s.b = t.b;
    s.flash = b.flash > 0 ? Math.min(1, b.flash) : 0;
    s.charred = b.charred * 0.85;
    s.write();
    this.syncT -= dt;
    if (this.paint === undefined || this.syncT <= 0) {
      this.syncT = 0.25;
      this.sync();
    }
  }

  /** Copies the body's paint over, where the layer has the body's pixels (not through the windows). */
  private sync(): void {
    const data = this.body.paintData();
    if (data === this.paint) return;
    this.paint = data;
    const img = this.image;
    img.set(this.base);
    if (data) {
      const d = fromBase64(data);
      for (let j = 0; j + 7 <= d.length; j += 7) {
        const k = (d[j] | (d[j + 1] << 8) | (d[j + 2] << 16)) * 4;
        if (k + 4 > img.length || img[k + 3] === 0) continue;
        img[k] = d[j + 3];
        img[k + 1] = d[j + 4];
        img[k + 2] = d[j + 5];
      }
    }
    this.body.entity.game.renderer.sprites.upload(this.region, img);
  }

  dispose(): void {
    const game = this.body.entity.game;
    const i = game.frameHandlers.indexOf(this.draw);
    if (i >= 0) game.frameHandlers.splice(i, 1);
    this.sprite.dispose();
    game.renderer.sprites.release(this.region);
  }
}

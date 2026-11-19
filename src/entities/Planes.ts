import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { clamp, smoothstep, wrapAngle, type V2 } from '../engine/math';
import { Sprite, type Region } from '../engine/Sprites';
import { Car, type CarConfig } from './Car';
import { Human } from './Human';
import { Parachute, wearOn } from './Rocketry';
import { PK } from '../systems/Particles';
import { getItem } from '../catalog/items';
import { MAT } from '../world/Materials';
import { isGlass } from '../art/vehicles';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { PilotCommand, PilotHud } from '../systems/Piloting';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

// Aircraft (0.4.5): the prebuilt aeroplanes, a helicopter, a tiltrotor, a glider, a hot-air
// balloon, a powered parachute and a weight-shift trike. Each is a vehicle as the cars and
// tanks are (seats, crashes, fire, wrecks, coming apart along its sections, Repair: see Car),
// flown by its own flight model: the real aircraft's weight, wing, tail and engines, the air
// worked out where each surface is (its angle to the air, lift to the stall and past it,
// drag, the wing's downwash on the tail) and its push and turn given to the game's lighter
// body in proportion (see scale()), so it flies at the real one's speeds, climbs, stalls and
// glides as it does, whatever the game makes it weigh.

const DEG = Math.PI / 180;
const G0 = 9.81;
const RHO0 = 1.225;

/** A lifting surface: a wing, a tailplane, a canopy (see coeffs()). */
export interface Surface {
  /** Where it lifts: its aerodynamic centre (art px on the body). */
  at: [number, number];
  /** Its area (m²) and aspect ratio (span² / area). */
  area: number;
  ar: number;
  /** Its chord's angle to the body's (degrees, + nose up), and its lift with none (its camber). */
  incidence: number;
  cl0: number;
  /** Its lift at the stall (clean), and the flaps': the lift and drag they add, all the way down. */
  clMax: number;
  flapCl?: number;
  flapCd?: number;
  /** A tail: how far its elevator goes (degrees) and how much of it turns the air (1: all of it moves). */
  elevator?: number;
  tau?: number;
  /** A tail behind the wing, in the air the wing turns down. */
  downwash?: boolean;
  /** Its own drag at no lift. */
  cd0?: number;
}

/** What pushes it. */
export interface Powerplant {
  kind: 'jet' | 'prop' | 'turboprop' | 'rotor';
  /** Where each engine pushes (art px), along the body (a rotor's: see FlightSpec.rotor). */
  at: [number, number][];
  /** All of them together at a standstill on the ground (N), and the shafts' power (W: props, rotors). */
  thrust: number;
  power?: number;
  /** An afterburner's push on top (N), lit at full throttle with the boost key. */
  boost?: number;
  /** Seconds from idle to full, and idle as a share of full. */
  spool: number;
  idle: number;
  /** Where the exhaust comes out (art px), and props drawn turning (art px, radius m). */
  nozzle?: [number, number];
  props?: { at: [number, number]; r: number }[];
}

export type AircraftKind = 'plane' | 'glider' | 'heli' | 'tiltrotor' | 'ppc' | 'trike' | 'balloon';

export interface FlightSpec {
  kind: AircraftKind;
  /** What the real one weighs as it's flown, without who's aboard (kg), and how hard it is to pitch: its radius of gyration (m). */
  trueKg: number;
  ky: number;
  /** What its body (and what's fixed to it) weighs in the game (kg), and where its centre of gravity is (art px). */
  gameKg: number;
  cg: [number, number];
  wing?: Surface;
  tail?: Surface;
  /** A flexwing's swept tips, behind and lower than its root (see Trike). */
  tips?: Surface;
  /** The Mach number its drag starts to rise at (the shock waves on its wing), and how steeply. */
  mcrit?: number;
  wave?: number;
  /** The airframe's drag: a coefficient on the wing's area, or with no wing its drag area (m², Cd × A). */
  cd0: number;
  dragArea?: number;
  /** A wingless airframe's drag area moving up or down through the air (m²): a helicopter's fuselage from above. */
  dragUp?: number;
  /** The wing's span efficiency (Oswald). */
  e: number;
  power?: Powerplant;
  /** A helicopter's main rotor (art px of its hub, radius m) and tail rotor; a tiltrotor's (see Tiltrotor). */
  rotor?: { at: [number, number]; r: number; n?: number; tail?: { at: [number, number]; r: number } };
  /** Never exceed (m/s, as flown at sea level), and the g its wings are built for (they come off at half as much again). */
  vne: number;
  gLimit: number;
  /** The landing its gear takes (m/s down), and the crash it comes apart in (m/s). */
  gear: number;
  breakup: number;
  /** How fast Q and E pitch it (degrees a second). */
  pitchRate: number;
  /** On its wheels: the brakes' and the rolling's deceleration (m/s²). */
  brake: number;
  roll: number;
  gun?: { at: [number, number]; rate: number; speed: number; damage: number; energy: number; recoil: number; rounds: number };
  flares?: number;
  eject?: boolean;
  caps?: boolean;
  /** Its lights (art px): the navigation light, the red beacon, the white strobe, the landing light. */
  lights?: { nav?: [number, number]; beacon?: [number, number]; strobe?: [number, number]; landing?: [number, number] };
}

/** How long (s) the keys' say lasts unless renewed (see Car's HAND_HOLD). */
const HAND_HOLD = 0.3;
/** How fast W and S move the throttle (share a second). */
const THROTTLE_RATE = 0.5;
/** The pitch hold: how hard it turns to the angle it holds (1/s), and the turn rate's own (1/s), the trim's (1/s). */
const HOLD_K = 1.6;
const RATE_K = 5;
const TRIM_K = 2.5;
/** Pulling more than its gLimit times this, for this long (s), tears its wings off. */
const ULTIMATE = 1.5;
const OVERLOAD_T = 0.12;
/** Past vne times this, for this long (s), it flutters apart. */
const FLUTTER = 1.3;
const FLUTTER_T = 0.6;
/** A propeller's efficiency; a rotor's figure of merit. */
const PROP_ETA = 0.8;
const MERIT = 0.72;
/** A rotor or prop must be turning this fast (share) for a strike to cut. */
const STRIKE_SPIN = 0.25;

/**
 * The share of its hovering thrust a rotor (or prop rotor) has left climbing at `axial` m/s
 * along its shaft, by momentum theory: the air already coming through it, its power spread
 * over that and the air it pushes (the induced velocity, `vh` hovering). Fast along its shaft
 * it comes to a propeller's ηP / V.
 */
function inflow(Tmax: number, rho: number, A: number, axial: number): number {
  if (axial <= 0 || Tmax <= 0) return 1;
  const vh = Math.sqrt(Tmax / (2 * rho * A));
  const a = axial / 2;
  return vh / (a + Math.sqrt(a * a + vh * vh));
}

/** A wing's lift curve slope (per radian) for its aspect ratio. */
function liftSlope(ar: number): number {
  return (2 * Math.PI * ar) / (ar + 2);
}

/**
 * A surface's lift and drag coefficients at `a` (radians, its chord to the air, + nose up),
 * flaps `flap` (0 to 1) down: lift rising with the angle to the stall, then falling away to a
 * flat plate's (1.05 sin 2a: most at 45°, none broadside), the drag of its lift (induced) up
 * to the stall and a flat plate's past it.
 */
export function coeffs(s: Surface, a: number, flap: number, e: number): { cl: number; cd: number; stall: number } {
  const cla = liftSlope(s.ar);
  const fl = s.flapCl ?? 0;
  const clMax = s.clMax + fl * flap;
  const cl0 = s.cl0 + fl * flap * 0.6;
  const aS = (clMax - cl0) / cla;
  const aN = (-clMax * 0.75 - cl0) / cla;
  const flat = 1.05 * Math.sin(2 * a);
  let cl: number;
  let k = 0;
  if (a > aS) {
    k = smoothstep(0, 1, (a - aS) / (10 * DEG));
    cl = clMax * (1 - k) + flat * k;
  } else if (a < aN) {
    k = smoothstep(0, 1, (aN - a) / (10 * DEG));
    cl = (cl0 + cla * aN) * (1 - k) + flat * k;
  } else cl = cl0 + cla * a;
  const induced = (cl * cl) / (Math.PI * e * s.ar);
  const cd = (s.cd0 ?? 0) + (s.flapCd ?? 0) * flap + induced * (1 - k) + 1.2 * Math.sin(a) ** 2 * k;
  return { cl, cd, stall: k };
}

/** What a surface did this step (see Aircraft.surface()). */
interface Lift {
  x: number;
  y: number;
  fx: number;
  fy: number;
  /** Its angle to the air (rad), lift coefficient, the air's dynamic pressure (Pa) and its speed (m/s). */
  a: number;
  cl: number;
  q: number;
  v: number;
  stall: number;
}

/**
 * A sprite drawn over an aircraft, following a part as its own sprite does (a propeller's
 * blur, a rotor, a tiltrotor's nacelle, a canopy): its frames uploaded once each.
 */
export class Decal {
  private readonly sprite: Sprite;
  private readonly regions = new Map<PixelArt, Region>();
  private art: PixelArt | null = null;

  constructor(private readonly game: Game, first: PixelArt, z: number) {
    const r = this.regionOf(first);
    this.sprite = new Sprite(r);
    this.sprite.z = z;
    this.art = first;
  }

  private regionOf(a: PixelArt): Region {
    let r = this.regions.get(a);
    if (!r) {
      r = this.game.renderer.sprites.alloc(a.w + 2, a.h + 2);
      this.game.renderer.sprites.upload(r, a.toRGBA(1));
      this.regions.set(a, r);
    }
    return r;
  }

  /** Drawn this frame: `art` centred at (x, y), turned `a`, mirrored if `flip` is -1; hidden if `art` is null. */
  show(art: PixelArt | null, x: number, y: number, a: number, flip: 1 | -1, from?: Part): void {
    const s = this.sprite;
    if (!art) {
      s.w = s.h = 0;
      s.write();
      return;
    }
    if (art !== this.art) {
      s.setRegion(this.regionOf(art));
      this.art = art;
    }
    s.x = x;
    s.y = y;
    s.a = a;
    s.w = (art.w + 2) * PX * flip;
    s.h = (art.h + 2) * PX;
    if (from) {
      const t = from.sprite;
      s.r = t.r;
      s.g = t.g;
      s.b = t.b;
      s.charred = from.charred;
      s.flash = from.flash > 0 ? Math.min(1, from.flash) : 0;
    }
    s.write();
  }

  dispose(): void {
    this.sprite.dispose();
    for (const r of this.regions.values()) this.game.renderer.sprites.release(r);
    this.regions.clear();
  }
}

/** The g a moment ago, smoothed (see hud()). */
interface Keys {
  x: number;
  t: number;
  r: number;
  fire: boolean;
  boost: boolean;
}

/**
 * An aircraft (see the file's head). Selected (or someone in its seat selected), the keys fly it:
 *
 * - W and S: the throttle (a glider's airbrakes, a helicopter's collective), left where it's let go.
 * - Q and E: pitch it, anticlockwise or clockwise (the elevator, a rotor's cyclic, a trike's bar,
 *   a powered parachute's brakes). With stability assist on (` toggles it), let go, it holds its
 *   pitch; off, the elevator goes back to neutral.
 * - A or D: the wheel brakes (a tiltrotor's: its nacelles, forward or back).
 * - F (Use): starts or stops its engines (a glider: a winch launch).
 * - The pilot's keys: \ fires its gun, ; its afterburner, Caps Lock flares, ' ejects, ] its
 *   parachute (CAPS), [ its flaps, Insert the autopilot (holds its height).
 */
export class Aircraft extends Car {
  readonly spec: FlightSpec;
  readonly aircraft = true;
  /** The throttle (0 to 1: a glider's airbrakes), and the engines' spool (0 to 1). */
  T = 0;
  N = 0;
  /** The afterburner lit (0 to 1). */
  ab = 0;
  /** Flaps (0 to 1) and where they're going. */
  flaps = 0;
  flapsWant = 0;
  /** Stability assist: let go of Q and E, it holds the pitch it was at. */
  assist = true;
  autopilot: { alt: number } | null = null;
  /** The elevator (rad, its tail's way) and the pitch trim the hold has worked out (a share of full: see fly()). */
  elevator = 0;
  trim = 0;
  private hold = 0;
  private holding = false;
  /** Its wing's angle to the air (deg), stalled, and the g it pulls. */
  aoa = 0;
  stalled = false;
  gload = 1;
  /** A rotor or a prop's spin (0 to 1). */
  spin = 0;
  /** Broken: its rotor or props struck something; its tail rotor. */
  rotorGone = false;
  tailGone = false;
  /** Bullets left in its gun, flares, its parachute (CAPS) pulled, its pilot ejected. */
  rounds = 0;
  flaresLeft = 0;
  capsUsed = false;
  ejected = false;
  lights = true;
  protected keys: Keys = { x: 0, t: 0, r: 0, fire: false, boost: false };
  private keysT = 0;
  private gunT = 0;
  private overT = 0;
  private flutterT = 0;
  private strikeT = 0;
  /** The hardest knock on its body and on its wheels this step (m/s). */
  private hitBody = 0;
  private hitWheel = new Map<number, number>();
  /** Game mass and inertia over the real ones (see scale()), and when they were worked out. */
  protected kM = 0.1;
  protected kI = 0.1;
  private scaledAt = -Infinity;
  private lastV: V2 | null = null;
  private lastWingCl = 0;
  protected decals: Decal[] = [];
  private animT = 0;
  private frameN = 0;
  /** An ejection under way: its rocket's time left, the pilot thrown, and their chute to open. */
  private ejecting: { who: Human; t: number; pack: Parachute | null } | null = null;
  /** A glider's winch launch: the winch on the ground ahead (true x and y) and how long it's pulled. */
  winch: { x: number; y: number; t: number } | null = null;
  private strobeT = 0;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.spec = spec;
    this.ownFlight = true;
    this.rounds = spec.gun?.rounds ?? 0;
    this.flaresLeft = spec.flares ?? 0;
    this.hold = this.body.body.rotation();
    this.trimMass();
    this.apply();
  }

  /**
   * Its centre of gravity where the real one's is, and its weight and inertia in the
   * game's proportion: the colliders' own share, and the rest added at the right place.
   */
  private trimMass(): void {
    const s = this.spec;
    const rb = this.body.body;
    const mc = rb.mass();
    const cc = rb.localCom();
    const Ic = rb.principalInertia();
    const cg = this.body.pixelToLocal(s.cg[0], s.cg[1]);
    const M = Math.max(s.gameKg, mc * 1.25);
    const ma = M - mc;
    const ca = { x: (M * cg.x - mc * cc.x) / ma, y: (M * cg.y - mc * cc.y) / ma };
    const d2 = (p: { x: number; y: number }) => (p.x - cg.x) ** 2 + (p.y - cg.y) ** 2;
    const want = M * s.ky * s.ky;
    const have = Ic + mc * d2(cc) + ma * d2(ca);
    rb.setAdditionalMassProperties(ma, ca, Math.max(want - have, ma * 0.05), true);
  }

  /** Its centre of gravity in the world. */
  protected cgAt(): V2 {
    return this.body.pixelToWorld(this.spec.cg[0], this.spec.cg[1]);
  }

  /**
   * How much lighter the game's aircraft is than the real one, and how much easier to turn:
   * what's aboard counts the same in both (a person weighs what they weigh).
   */
  protected scale(): void {
    const now = this.game.time;
    if (now - this.scaledAt < 0.5 && now >= this.scaledAt) return;
    this.scaledAt = now;
    const c = this.cgAt();
    let mg = 0;
    let ig = 0;
    let crew = 0;
    let crewI = 0;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const m = p.mass;
      mg += m;
      ig += p.body.principalInertia() + (p === this.body ? 0 : m * ((p.x - c.x) ** 2 + (p.y - c.y) ** 2));
    }
    for (const r of this.riders) {
      if (!r || r.who.destroyed) continue;
      for (const p of r.who.parts) {
        if (p.destroyed) continue;
        crew += p.mass;
        crewI += p.mass * ((p.x - c.x) ** 2 + (p.y - c.y) ** 2);
      }
    }
    this.kM = (mg + crew) / (this.spec.trueKg + crew);
    this.kI = (ig + crewI) / (this.spec.trueKg * this.spec.ky ** 2 + crewI);
  }

  /** The wind where it is (m/s). */
  protected windAt(x: number, y: number): V2 {
    const ws = this.game.weather;
    if (ws.state.wind === 0 && !(this.game.map.world && ws.state.light > 0.5)) return { x: 0, y: 0 };
    return ws.windAt(x, y);
  }

  protected rhoAt(y: number): number {
    return this.game.air.densityAt(y);
  }

  /** Its engines running (switched on, and not a wreck). */
  get driving(): boolean {
    return this.on && !this.wrecked && !this.fried && this.spec.kind !== 'glider';
  }

  canRest(): boolean {
    const b = this.body;
    return !this.driving && this.spin < 0.01 && !this.winch && Math.hypot(b.vx, b.vy) < 0.05;
  }

  /** Off the ground (no wheel touching anything for a moment). */
  flying = false;
  private groundT = 0;
  /** Which wheels are on the ground this step, and the share of its weight they bear (the rest the wings or rotor hold up). */
  private contact: boolean[] = [];
  private support = 1;
  /** Its riders' parts' own damping, taken off while they ride (the airframe's drag is the whole of it). */
  private damped = new Map<Part, number>();
  /** The airframe's velocity before this step: what its gear meets the ground at (see onImpact()). */
  private preV = { x: 0, y: 0 };
  /** Is it aircraft (for Wheels: it rolls its own, see apply()). */
  readonly ownWheels = true;

  /** The wheels: free to roll (a little drag), held by the brakes (A or D), or parked (throttle shut, all but still). */
  /**
   * Its wheels. A wheel turns no faster than the physics lets a body turn (see Car's SPIN_MAX:
   * a light aircraft's small tyres would top out at 20 m/s), so rolling they slide without
   * friction, turned to look as they roll, and its rolling drag and brakes are pushes on the
   * airframe as the weight on them allows (none once the wings bear it all). Slow and stopped,
   * the brakes hold it with the tyres' grip (parked: the throttle closed).
   */
  protected apply(): void {
    if (!this.spec) return;
    const b = this.body;
    const n = this.wheels.length;
    if (!n || b.destroyed) return;
    const v = b.body.linvel();
    const speed = Math.hypot(v.x, v.y);
    const braking = this.keys.x !== 0 && this.spec.kind !== 'tiltrotor';
    const parked = this.T <= 0.001 && !this.winch && speed < 1.5 && !this.flying;
    const hold = (braking || parked) && speed < 2.5;
    const m = this.totalMass();
    const grip = this.game.wheels.groundGrip();
    let on = 0;
    for (let i = 0; i < n; i++) {
      const w = this.wheels[i];
      const j = (this as unknown as { axles: RAPIER.RevoluteImpulseJoint[] }).axles[i];
      if (!j || !j.isValid() || w.destroyed) continue;
      const col = w.colliders[0];
      const r = (w.w / 2) * PX;
      const f = hold ? (w.mat.friction ?? 0.9) * grip : 0;
      if (col?.isValid() && Math.abs(col.friction() - f) > 1e-3) {
        col.setFriction(f);
        // (Rapier averages two surfaces' friction: the least of them, so a free wheel's none is none)
        col.setFrictionCombineRule(f ? RAPIER.CoefficientCombineRule.Average : RAPIER.CoefficientCombineRule.Min);
      }
      if (hold) {
        // (stopped: locked, as Car's brakes are)
        j.configureMotorVelocity(0, (m * this.spec.brake * r) / n);
        j.setMotorMaxForce((m * this.spec.brake * r) / n);
      } else {
        j.setMotorMaxForce(0);
        // turned as it rolls along the ground under it (a locked wheel skids)
        if (this.contact[i]) {
          const along = v.x * Math.cos(b.a) + v.y * Math.sin(b.a);
          const spin = braking ? 0 : clamp(-along / r, -90, 90);
          w.body.setAngvel(b.body.angvel() + spin, true);
        }
      }
      if (this.contact[i]) on++;
    }
    if (!on || hold || speed < 0.05) return;
    // rolling drag and the brakes, along the ground, never turning it back the other way
    const decel = (braking ? this.spec.brake * grip : this.spec.roll) * this.support * (on / n);
    const dv = Math.min(decel * this.game.stepDt, speed);
    b.body.applyImpulse({ x: (-v.x / speed) * dv * m, y: (-v.y / speed) * dv * m }, true);
  }

  /**
   * Whoever rides it carried without the air's damping on them (see Part.linDamp): their
   * drag is the airframe's (strapped in at 60 m/s, a person's 0.04 a second was a third of a Cessna's thrust).
   */
  private undamp(): void {
    for (const r of this.riders) {
      if (!r) continue;
      for (const p of r.who.parts) {
        if (p.destroyed || this.damped.has(p) || p.linDamp === 0) continue;
        this.damped.set(p, p.linDamp);
        p.linDamp = p.linDampNow = 0;
        p.body.setLinearDamping(0);
      }
    }
  }

  protected release(i: number, how: 'out' | 'free' | 'thrown', v?: V2): void {
    const r = this.riders[i];
    if (r) {
      for (const p of r.who.parts) {
        const d = this.damped.get(p);
        if (d === undefined) continue;
        this.damped.delete(p);
        if (p.destroyed) continue;
        p.linDamp = p.linDampNow = d;
        p.body.setLinearDamping(d);
      }
    }
    super.release(i, how, v);
  }

  /** The keys (see the class's head): held a moment (HAND_HOLD) unless renewed. */
  steer(x: number, aim = 0, turn = 0, fire = false, boost = false): void {
    this.keys = { x: Math.sign(x), t: Math.sign(aim), r: Math.sign(turn), fire, boost };
    this.keysT = x || aim || turn || fire || boost ? HAND_HOLD : 0;
  }

  // ---- each step ------------------------------------------------------------

  preStep(dt: number): void {
    const b = this.body;
    if (this.keysT > 0 && (this.keysT -= dt) <= 0) this.keys = { x: 0, t: 0, r: 0, fire: false, boost: false };
    if (this.heldOff && !this.powered) this.heldOff = false;
    if (this.powered && !this.heldOff && !this.on && !this.wrecked) this.on = true;
    if (b.destroyed || b.frozen || this.destroyed) return;
    const lv = b.body.linvel();
    this.preV = { x: lv.x, y: lv.y };
    this.undamp();
    this.scale();
    this.onGround(dt);
    this.controls(dt);
    this.engines(dt);
    if (this.spec.kind === 'balloon') this.balloon(dt);
    else this.fly(dt);
    if (this.ejecting) this.ejectStep(dt);
    if (this.keys.fire) this.shoot(dt);
    else this.gunT = Math.max(0, this.gunT - dt);
    this.apply();
    this.noises();
  }

  /** On its wheels: any wheel touching something (looked at with a short ray down each). */
  private onGround(dt: number): void {
    let touching = false;
    const world = this.game.physics.world;
    const mine = (o: RAPIER.Collider) => this.game.physics.partOf(o)?.entity === this;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      this.contact[i] = false;
      if (w.destroyed || this.loose.has(i)) continue;
      const r = (w.w / 2) * PX;
      if (world.castRay(new RAPIER.Ray({ x: w.x, y: w.y }, { x: 0, y: -1 }), r + 0.12, true, undefined, undefined, undefined, undefined, (o) => !mine(o))) {
        touching = true;
        this.contact[i] = true;
      }
    }
    if (!this.wheels.length) {
      const b = this.body;
      touching = b.y - this.game.env.groundAt(b.x, b.y) < 1.5;
    }
    this.groundT = touching ? 0 : this.groundT + dt;
    this.flying = this.groundT > 0.3;
  }

  /** The throttle, the flaps, the pitch hold and the autopilot from the keys. */
  private controls(dt: number): void {
    const k = this.keys;
    if (k.t) {
      this.T = clamp(this.T + k.t * THROTTLE_RATE * dt, 0, 1);
      // (throttle opened, its engines start: no need for F first)
      if (k.t > 0 && !this.on && !this.wrecked && this.spec.power) this.on = true;
      if (this.autopilot && this.spec.kind !== 'heli') this.autopilot = null;
    }
    this.flaps += clamp(this.flapsWant - this.flaps, -dt / 4, dt / 4);
  }

  /** Spooling up or down (a jet slowly from idle, a piston engine at once), and the rotor or prop's spin. */
  private engines(dt: number): void {
    const s = this.spec;
    const pw = s.power;
    if (!pw) {
      this.N = 0;
      return;
    }
    const want = this.driving ? Math.max(pw.idle, this.T) : 0;
    const jet = pw.kind === 'jet';
    const up = (1 / pw.spool) * (jet ? 0.3 + this.N : 1);
    this.N += clamp(want - this.N, -dt * up * 1.5, dt * up);
    const abWant = jet && pw.boost && this.keys.boost && this.N > 0.95 ? 1 : 0;
    this.ab += clamp(abWant - this.ab, -dt * 4, dt * 3);
    // a rotor or prop spins with its engine (a rotor slowly: it's heavy), and a rotor windmills
    // as it comes down without power (autorotation)
    const rotor = pw.kind === 'rotor';
    const turning = this.driving && !this.rotorGone ? 1 : 0;
    let spinWant = turning;
    if (rotor && !turning && !this.rotorGone) {
      const v = this.body.body.linvel();
      spinWant = clamp(-v.y / 10, 0, 0.92);
    }
    const rate = rotor ? (spinWant > this.spin ? 1 / 8 : 1 / 25) : 1 / 1.2;
    this.spin += clamp(spinWant - this.spin, -dt * rate, dt * rate);
    if (this.rotorGone) this.spin = 0;
  }

  /**
   * The air on a surface (on the body, or `p`): its angle to the air there (`extra` rad more:
   * an elevator, a wing's downwash), its lift and drag, as a force at its point (real N).
   */
  protected surface(s: Surface, rho: number, extra = 0, p: Part = this.body, at?: V2, angle?: number): Lift | null {
    const w = at ?? p.pixelToWorld(s.at[0], s.at[1]);
    const v = p.velocityAt(w.x, w.y);
    const wind = this.windAt(w.x, w.y);
    const vx = v.x - wind.x;
    const vy = v.y - wind.y;
    const v2 = vx * vx + vy * vy;
    if (v2 < 0.25 || rho <= 1e-6) return null;
    const V = Math.sqrt(v2);
    const a0 = angle ?? p.body.rotation();
    const fx0 = Math.cos(a0) * p.flip;
    const fy0 = Math.sin(a0) * p.flip;
    const ux = -Math.sin(a0);
    const uy = Math.cos(a0);
    const vf = vx * fx0 + vy * fy0;
    const vu = vx * ux + vy * uy;
    const a = wrapAngle(Math.atan2(-vu, vf) + s.incidence * DEG + extra);
    const { cl, cd, stall } = coeffs(s, a, this.flaps, this.spec.e);
    const q = 0.5 * rho * v2;
    // lift across the air, on the side its top faces; drag along it
    let nx = -vy / V;
    let ny = vx / V;
    if (nx * ux + ny * uy < 0) {
      nx = -nx;
      ny = -ny;
    }
    const L = q * s.area * cl;
    const D = q * s.area * cd;
    return { x: w.x, y: w.y, fx: L * nx - (D * vx) / V, fy: L * ny - (D * vy) / V, a, cl, q, v: V, stall };
  }

  /** Real forces and moments this step (N, N m about the centre of gravity), given to the game's body at the end. */
  protected F = { x: 0, y: 0, m: 0 };

  protected addForce(fx: number, fy: number, x: number, y: number, c: V2): void {
    this.F.x += fx;
    this.F.y += fy;
    this.F.m += (x - c.x) * fy - (y - c.y) * fx;
  }

  /** The air, the engines and the pilot's pitch for everything but a balloon. */
  private fly(dt: number): void {
    const s = this.spec;
    const b = this.body;
    const c = this.cgAt();
    const rho = this.rhoAt(b.y);
    const sigma = rho / RHO0;
    this.F = { x: 0, y: 0, m: 0 };
    // the wing (a trike's, a powered parachute's own: see their classes)
    const wing = s.wing ? this.wingLift(s.wing, rho) : null;
    if (wing && s.kind === 'glider' && this.T > 0) {
      // (the airbrakes spoil some of the wing's lift too)
      wing.fx *= 1 - 0.2 * this.T;
      wing.fy *= 1 - 0.2 * this.T;
    }
    if (wing) {
      this.addForce(wing.fx, wing.fy, wing.x, wing.y, c);
      this.aoa = wing.a / DEG;
      this.stalled = wing.stall > 0.3 && wing.v > 8;
      this.lastWingCl = wing.cl;
    } else {
      this.aoa = 0;
      this.stalled = false;
    }
    // the pitch the pilot asks for: the tail's elevator, a rotor's cyclic
    const accWant = this.pitchDemand(dt);
    let authority = 0;
    let tailB = 0;
    if (s.tail) {
      // (how much the elevator turns it a radian: worked out from the tail's place and the air on it)
      const t = this.surface(s.tail, rho, this.tailExtra(0));
      if (t) {
        const tw = this.body.pixelToWorld(s.tail.at[0], s.tail.at[1]);
        const up = b.localDir(0, 1);
        const arm = (tw.x - c.x) * up.y - (tw.y - c.y) * up.x;
        tailB = (t.q * s.tail.area * liftSlope(s.tail.ar) * (s.tail.tau ?? 0.5) * arm) / (this.spec.trueKg * s.ky * s.ky);
        authority += Math.abs(tailB) * (s.tail.elevator ?? 20) * DEG;
      }
    }
    const rotorM = this.rotorAuthority(rho);
    authority += rotorM / (s.trueKg * s.ky * s.ky);
    // the turn asked of what can turn it (a share of full), and the trim that holds it there worked
    // out as it goes (on the ground, slow, nothing to trim: let go of it)
    const held = this.assist || !!this.autopilot;
    let u = held ? this.keys.r : 0;
    if (held && authority > 1e-4) {
      const k = accWant / authority;
      if (this.keys.r === 0) this.trim = clamp(this.trim + k * TRIM_K * dt * 0.2, -1, 1);
      u = clamp(k + this.trim, -1, 1);
    }
    if (!this.flying && Math.hypot(b.vx, b.vy) < 15) this.trim *= Math.max(0, 1 - dt * 2);
    if (!held) u = this.keys.r;
    // (on its wheels, the nose held down by the nose wheel: the stick all the way back, or forward, till it's turning as fast as asked)
    else if (!this.flying && this.keys.r && this.keys.r * b.body.angvel() < s.pitchRate * DEG) u = this.keys.r;
    // the elevator: the tail's share of the turn (its sign the way the tail turns it)
    const maxE = (s.tail?.elevator ?? 0) * DEG;
    const elev = clamp(u * Math.sign(tailB || 1) * maxE, -maxE, maxE);
    this.elevator += clamp(elev - this.elevator, -dt * 1.2, dt * 1.2);
    if (s.tail) {
      const t = this.surface(s.tail, rho, this.tailExtra(this.elevator));
      if (t) this.addForce(t.fx, t.fy, t.x, t.y, c);
    }
    if (rotorM > 0) this.F.m += u * rotorM;
    // the airframe's drag, at the centre
    const vb = b.velocityAt(c.x, c.y);
    const wind = this.windAt(c.x, c.y);
    const vx = vb.x - wind.x;
    const vy = vb.y - wind.y;
    const V = Math.hypot(vx, vy);
    if (V > 0.3) {
      let CdA = s.dragArea ?? s.cd0 * (s.wing?.area ?? 1);
      // near the speed of sound, shock waves on the wing: the drag rises steeply past its critical Mach
      if (s.mcrit) {
        const M = V / Math.sqrt(1.4 * 287 * (this.game.air.tempAt(b.y) + 273.15));
        if (M > s.mcrit) CdA *= 1 + (s.wave ?? 2) * 10 * Math.min(0.15, (M - s.mcrit) ** 2);
      }
      // a glider's airbrakes: paddles up out of its wings
      if (s.kind === 'glider') CdA += this.T * 1.2;
      const D = 0.5 * rho * V * CdA;
      this.addForce(-D * vx, -D * vy, c.x, c.y, c);
      if (s.dragUp) {
        // (broadside: its own frame's up and down)
        const up = b.localDir(0, 1);
        const vu = vx * up.x + vy * up.y;
        const Du = 0.5 * rho * V * Math.max(0, s.dragUp - CdA) * vu;
        this.addForce(-Du * up.x, -Du * up.y, c.x, c.y, c);
      }
    }
    this.thrust(rho, sigma, V, c);
    this.extraForces(rho, c, dt);
    // given to the game's body: a push in proportion to its mass, a turn to its inertia
    const k = this.kM * dt;
    b.body.applyImpulse({ x: this.F.x * k, y: this.F.y * k }, true);
    b.body.applyTorqueImpulse(this.F.m * this.kI * dt, true);
    this.support = clamp(1 - this.F.y / (s.trueKg * G0), 0, 1);
    this.loads(wing, dt);
  }

  /** The wing's air (a trike's turns with its bar: see Trike). */
  protected wingLift(w: Surface, rho: number): Lift | null {
    return this.surface(w, rho);
  }

  /** What the tail's angle to the air has besides its own: the wing's downwash, and the elevator. */
  private tailExtra(elevator: number): number {
    const t = this.spec.tail!;
    const down = t.downwash && this.spec.wing ? (2 * this.lastWingCl) / (Math.PI * this.spec.wing.ar) : 0;
    return elevator * (t.tau ?? 0.5) - down;
  }

  /** How hard (N m) its rotor can pitch it (none: no rotor, or not turning). */
  protected rotorAuthority(rho: number): number {
    const r = this.spec.rotor;
    if (!r || this.rotorGone || this.spin < 0.05) return 0;
    void rho;
    return this.spec.trueKg * G0 * 0.9 * this.spin * this.spin;
  }

  /**
   * The angular acceleration (rad/s², + anticlockwise) the pilot asks for: Q and E turn it
   * at its pitch rate; let go, with the assist on, it holds the angle it was let go at (the
   * autopilot steering that for the height it holds).
   */
  private pitchDemand(dt: number): number {
    const b = this.body;
    const w = b.body.angvel();
    const a = b.body.rotation();
    const rate = this.spec.pitchRate * DEG;
    let want: number;
    if (this.keys.r !== 0) {
      want = this.keys.r * rate;
      this.holding = false;
      if (this.autopilot) this.autopilot = null;
    } else if (this.assist || this.autopilot) {
      if (!this.holding) {
        this.holding = true;
        this.hold = a;
      }
      if (this.autopilot) this.steerToHeight(dt);
      // (stalled, the assist lets the nose down till the wing flies again)
      if (this.stalled && this.flying) this.hold -= this.body.flip * 12 * DEG * dt;
      want = clamp(wrapAngle(this.hold - a) * HOLD_K, -rate, rate);
    } else {
      this.holding = false;
      return 0;
    }
    return (want - w) * RATE_K;
  }

  /** The autopilot: noses it up or down a little toward the height it holds. */
  private steerToHeight(dt: number): void {
    const ap = this.autopilot!;
    const b = this.body;
    const alt = b.y + (this.game.map.world ? this.game.air.base : 0);
    const climb = clamp((ap.alt - alt) * 0.15, -6, 6);
    const v = Math.max(5, Math.hypot(b.vx, b.vy));
    const gamma = Math.asin(clamp(climb / v, -0.5, 0.5));
    const now = Math.asin(clamp(b.vy / v, -1, 1));
    const f = this.body.flip;
    if (this.spec.kind === 'heli') return;
    this.hold += clamp((gamma - now) * f * 0.6 * dt, -0.05, 0.05);
  }

  /** The engines' push this step (see Powerplant), and a rotor's lift. */
  private thrust(rho: number, sigma: number, V: number, c: V2): void {
    const s = this.spec;
    const pw = s.power;
    if (!pw || this.N <= 0.001) return;
    const b = this.body;
    const fwd = b.localDir(b.flip, 0);
    if (pw.kind === 'rotor') {
      this.rotorLift(rho, sigma, c);
      return;
    }
    const each = 1 / pw.at.length;
    let T: number;
    if (pw.kind === 'jet') {
      const a = Math.sqrt(1.4 * 287 * (this.game.air.tempAt(b.y) + 273.15));
      const M = V / a;
      // (a turbofan's push falls away with speed, a high-bypass one's (an airliner's, the A-10's) a fifth
      // by take-off speed; a fighter's low-bypass engine's hardly, and the ram air of going fast gives it more)
      const ram = pw.boost ? clamp(1 - 0.25 * M + 0.3 * M * M, 0.5, 1.6) : clamp(1 - 0.9 * M + 0.6 * M * M, 0.5, 1.2);
      T = (pw.thrust * this.N + (pw.boost ?? 0) * this.ab) * sigma ** 0.75 * ram;
    } else {
      if (this.rotorGone) return;
      // a propeller: its static push, giving way as it goes faster to what its power makes at that
      // speed (η P / V), the two blended (a fixed prop is no use at either end of its range)
      const P = (pw.power ?? 0) * this.N * sigma ** (pw.kind === 'prop' ? 1.1 : 0.8);
      const T0 = pw.thrust * this.N * sigma ** 0.9;
      const Tv = (PROP_ETA * P) / Math.max(1, V);
      T = (T0 > 0 && Tv > 0 ? 1 / Math.sqrt(1 / (T0 * T0) + 1 / (Tv * Tv)) : 0) * this.spin;
    }
    for (const at of pw.at) {
      const w = b.pixelToWorld(at[0], at[1]);
      this.addForce(fwd.x * T * each, fwd.y * T * each, w.x, w.y, c);
    }
  }

  /**
   * A helicopter's rotor: the most it can lift for its engines' power (momentum theory:
   * (FM P √(2ρA))^⅔), more in forward flight (translational lift) and near the ground
   * (ground effect), as much of that as the collective (the throttle) asks.
   */
  protected rotorLift(rho: number, sigma: number, c: V2): void {
    const s = this.spec;
    const r = s.rotor!;
    if (this.rotorGone || this.spin < 0.02) return;
    const b = this.body;
    const hub = b.pixelToWorld(r.at[0], r.at[1]);
    const up = b.localDir(0, 1);
    const P = (s.power!.power ?? 0) * Math.min(this.N, 1) * sigma ** 0.8 * 0.85;
    const A = Math.PI * r.r * r.r * (r.n ?? 1);
    let Tmax = (MERIT * P * Math.sqrt(2 * rho * A)) ** (2 / 3);
    const v = b.body.linvel();
    const across = Math.abs(v.x * up.y - v.y * up.x);
    Tmax *= 1 + 0.22 * smoothstep(4, 16, across);
    // (fast, its retreating blade stalls: the most it can lift falls away)
    Tmax *= 1 - 0.6 * smoothstep(65, 100, across);
    // (climbing, the air already coming down through it: less of its power lifts)
    Tmax *= inflow(Tmax, rho, A, v.x * up.x + v.y * up.y);
    const h = b.y - this.game.env.groundAt(b.x, b.y);
    if (h < 2 * r.r) Tmax *= 1 + 0.12 * (1 - h / (2 * r.r));
    const T = Tmax * this.T * this.spin * this.spin * (this.tailGone ? 0.7 : 1);
    this.addForce(up.x * T, up.y * T, hub.x, hub.y, c);
    // (its tail rotor gone, nothing holds the fuselage from turning with the rotor: it wallows)
    if (this.tailGone) this.F.m += Math.sin(this.game.time * 3.1) * T * 0.4;
  }

  /** A balloon's own (see HotAirBalloon). */
  protected balloon(dt: number): void {
    void dt;
  }

  /** Anything else a kind of aircraft has (a tiltrotor's nacelles, a winch's pull). */
  protected extraForces(rho: number, c: V2, dt: number): void {
    void rho;
    if (this.winch) this.winchPull(c, dt);
  }

  /**
   * What it bears: pulling more than its wings are built for (half as much again as its g
   * limit) tears them off, and past its never-exceed speed it flutters apart.
   */
  private loads(wing: Lift | null, dt: number): void {
    const s = this.spec;
    const b = this.body;
    const v = b.body.linvel();
    if (this.lastV) {
      const ax = (v.x - this.lastV.x) / dt;
      const ay = (v.y - this.lastV.y) / dt + G0;
      const up = b.localDir(0, 1);
      const n = (ax * up.x + ay * up.y) / G0;
      this.gload += (n - this.gload) * Math.min(1, dt * 8);
    }
    this.lastV = { x: v.x, y: v.y };
    if (this.wrecked) return;
    const wl = wing ? Math.hypot(wing.fx, wing.fy) / (s.trueKg * G0) : 0;
    this.overT = wl > s.gLimit * ULTIMATE ? this.overT + dt : 0;
    const eas = Math.hypot(v.x, v.y) * Math.sqrt(this.rhoAt(b.y) / RHO0);
    this.flutterT = eas > s.vne * FLUTTER ? this.flutterT + dt : 0;
    if (this.overT > OVERLOAD_T || this.flutterT > FLUTTER_T) {
      const at = wing ? { x: wing.x, y: wing.y } : this.cgAt();
      this.strain = this.toughness;
      this.dismantle(at, b.localDir(0, 1));
    }
  }

  // ---- crashes ---------------------------------------------------------------

  onImpact(info: ImpactInfo): void {
    const p = info.part;
    const o = info.other;
    // (its own shed wheel or torn-off piece weighs what it weighs, not the whole aircraft)
    const own = o?.entity === this;
    const mass = o && info.otherMass < Infinity ? (own ? info.otherMass : Math.max(info.otherMass, o.entity.totalMass())) : Infinity;
    const i = this.wheels.indexOf(p);
    let speed = info.speed;
    if (i >= 0) {
      // a tyre's hit is the airframe coming down on it: its own spin, 90 rad/s at speed, at a contact a
      // hair off its bottom read as a knock of metres a second every step it rolled (and wrecked it)
      const n = info.normal;
      const ov = o && !o.frozen ? o.body.linvel() : { x: 0, y: 0 };
      speed = Math.max(0, -((this.preV.x - ov.x) * n.x + (this.preV.y - ov.y) * n.y));
    }
    if (!own) super.onImpact(speed === info.speed ? info : { ...info, speed });
    // (a person or a crate hit isn't a crash into the ground)
    const k = speed * Math.min(1, mass / Math.max(1, this.body.mass * 0.3));
    if (p === this.body) this.hitBody = Math.max(this.hitBody, k);
    if (i >= 0) this.hitWheel.set(i, Math.max(this.hitWheel.get(i) ?? 0, k));
  }

  postStep(dt: number): void {
    super.postStep(dt);
    if (this.destroyed || this.body.destroyed) return;
    // a landing harder than its gear takes folds a leg; a crash harder than it's built for breaks it up
    // (one far past what the gear takes drives its strut up through the airframe: a crash)
    for (const [i, k] of this.hitWheel) {
      if (k > this.spec.breakup) this.hitBody = Math.max(this.hitBody, k);
      if (k > this.spec.gear && !this.loose.has(i)) {
        this.shed(i);
        this.game.sound.impact('metal', 1, this.wheels[i].x);
      }
    }
    this.hitWheel.clear();
    const k = this.hitBody;
    this.hitBody = 0;
    if (k > this.spec.breakup) {
      if (!this.wrecked) this.explode();
      if (!this.destroyed) {
        this.strain = this.toughness * Math.min(2.5, k / this.spec.breakup);
        this.dismantle(this.cgAt(), this.body.localDir(0, -1));
      }
      return;
    }
    if (this.spin > STRIKE_SPIN && (this.strikeT -= dt) <= 0) this.strikes();
  }

  /**
   * Its spinning blades meeting something (a rotor's tips, a prop's): what they hit is cut
   * and flung, and something solid (the ground, a wall, a heavy thing) breaks them off.
   */
  private strikes(): void {
    this.strikeT = 0.03;
    for (const [from, to] of this.bladeSpans()) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const L = Math.hypot(dx, dy);
      if (L < 0.1) continue;
      const g = this.game;
      const world = g.physics.world;
      const ray = new RAPIER.Ray(from, { x: dx / L, y: dy / L });
      const hit = world.castRay(ray, L, true, undefined, undefined, undefined, undefined, (o) => {
        const q = g.physics.partOf(o);
        if (!q) return true;
        if (q.entity === this || q.destroyed) return false;
        return !this.riders.some((r) => r && r.who === q.entity);
      });
      if (!hit) continue;
      const at = { x: from.x + (dx / L) * hit.timeOfImpact, y: from.y + (dy / L) * hit.timeOfImpact };
      const q = g.physics.partOf(hit.collider);
      g.particles.sparks(at.x, at.y, -dx / L, -dy / L, 8, 9);
      g.sound.impact('metal', 1, at.x);
      if (q && !q.frozen && q.mass < this.body.mass * 0.05) {
        q.entity.damage(q, 160 * this.spin, 'cut', at, { x: dx / L, y: dy / L });
        const side = { x: -dy / L, y: dx / L };
        q.body.applyImpulse({ x: side.x * q.mass * 14 * this.spin, y: side.y * q.mass * 14 * this.spin }, true);
        if (q.mat.bleeds) g.sound.fleshHit(1, at.x);
        continue;
      }
      this.bladesBroken(at);
      return;
    }
  }

  /** Where its spinning blades reach, as line segments (world): a prop's disc edge on, a rotor's span. */
  protected bladeSpans(): [V2, V2][] {
    const out: [V2, V2][] = [];
    const b = this.body;
    if (this.rotorGone) return out;
    const r = this.spec.rotor;
    if (r) {
      const hub = b.pixelToWorld(r.at[0], r.at[1]);
      const f = b.localDir(1, 0);
      out.push([hub, { x: hub.x + f.x * r.r, y: hub.y + f.y * r.r }], [hub, { x: hub.x - f.x * r.r, y: hub.y - f.y * r.r }]);
    }
    for (const p of this.spec.power?.props ?? []) {
      const c = b.pixelToWorld(p.at[0], p.at[1]);
      const u = b.localDir(0, 1);
      out.push([c, { x: c.x + u.x * p.r, y: c.y + u.y * p.r }], [c, { x: c.x - u.x * p.r, y: c.y - u.y * p.r }]);
    }
    return out;
  }

  /** Its blades break on something solid: they're gone (and the engine with them), shards flung off. */
  protected bladesBroken(at: V2): void {
    const g = this.game;
    this.rotorGone = true;
    this.spin = 0;
    g.particles.debris(at.x, at.y, 0, 1, 14, 0x4a5058, 7);
    g.sound.play('explosion/debris', { gain: 0.6, x: at.x, vary: 0.15 });
    this.harm(18);
  }

  // ---- guns, flares, ejection, the parachute ------------------------------------

  private shoot(dt: number): void {
    const gun = this.spec.gun;
    if (!gun || this.wrecked) return;
    const g = this.game;
    if (g.net?.guest) return;
    this.gunT -= dt;
    const b = this.body;
    while (this.gunT <= 0 && this.rounds > 0) {
      this.gunT += 1 / gun.rate;
      this.rounds--;
      const m = b.pixelToWorld(gun.at[0], gun.at[1]);
      const fwd = b.localDir(b.flip, 0);
      const spread = (Math.random() - 0.5) * 0.012;
      const dx = fwd.x * Math.cos(spread) - fwd.y * Math.sin(spread);
      const dy = fwd.x * Math.sin(spread) + fwd.y * Math.cos(spread);
      const v = b.body.linvel();
      const vx = dx * gun.speed + v.x;
      const vy = dy * gun.speed + v.y;
      const sp = Math.hypot(vx, vy);
      g.projectiles.fire(m.x + fwd.x * 0.3, m.y + fwd.y * 0.3, vx / sp, vy / sp, sp, { energy: gun.energy, damage: gun.damage, push: 0.006, ignore: b.body, tracer: true });
      // (the gun shoves back on the aircraft: an A-10's slows it)
      const k = this.kM;
      b.body.applyImpulse({ x: -fwd.x * gun.recoil * k, y: -fwd.y * gun.recoil * k }, true);
      g.particles.flash(m.x + fwd.x * 0.2, m.y + fwd.y * 0.2, 0.3);
      g.renderer.addLight(m.x + fwd.x * 0.4, m.y + fwd.y * 0.4, 2.2, 0.6, 0xffd890, 0.05);
      if (Math.random() < 0.3) g.particles.smoke(m.x, m.y, 1, 0.3);
      g.alarm(m.x, m.y, 30);
    }
    if (this.rounds > 0) g.sound.gunshot('minigun', b.pixelToWorld(gun.at[0], gun.at[1]).x);
    if (this.gunT < -1) this.gunT = 0;
  }

  /** A pair of flares out behind and below (heat seekers go for them). */
  private flare(): boolean {
    const g = this.game;
    const def = getItem('decoy-flare');
    if (!def || this.flaresLeft <= 0 || this.wrecked || g.net?.guest) return false;
    const b = this.body;
    const v = b.body.linvel();
    const back = b.localDir(-b.flip, 0);
    const down = b.localDir(0, -1);
    const at = b.pixelToWorld(this.spec.cg[0], this.spec.cg[1] + 10);
    for (let i = 0; i < 2 && this.flaresLeft > 0; i++) {
      this.flaresLeft--;
      const s = (i - 0.5) * 0.8;
      const f = g.spawn(def, at.x + back.x * 1.5, at.y + back.y * 1.5 - 0.6, {});
      if (!f) continue;
      f.parts[0]?.setNoCollide(this.parts);
      for (const p of f.parts) p.body.setLinvel({ x: v.x + back.x * 12 + down.x * 8 + s, y: v.y + back.y * 12 + down.y * 8 }, true);
    }
    g.sound.play('gun/launcher', { gain: 0.3, x: b.x, rate: 2.2, vary: 0.08 });
    return true;
  }

  /** The pilot's ejection seat fires: out through the canopy, rocketed clear, their chute opening at the top of the climb. */
  private eject(): boolean {
    if (!this.spec.eject || this.ejected || this.ejecting) return false;
    const r = this.riders[0];
    if (!r) return false;
    const who = r.who;
    this.release(0, 'free');
    if (who.destroyed) return false;
    this.ejected = true;
    const g = this.game;
    let pack = g.entities.find((e): e is Parachute => e instanceof Parachute && e.worn && e.wearer === who && e.state === 'packed') ?? null;
    if (!pack) {
      const def = getItem('backpack-parachute');
      const chest = who.limbs.get('upperTorso')?.part;
      if (def && chest && !chest.destroyed) {
        const e = g.spawn(def, chest.x, chest.y);
        if (e instanceof Parachute && wearOn(e, who)) pack = e;
      }
    }
    for (const p of who.parts) p.setNoCollide(this.parts);
    this.ejecting = { who, t: 0, pack };
    g.sound.play('explosion/firework_launch', { gain: 0.9, x: this.body.x });
    // (the canopy's glass goes with them)
    const top = this.body.pixelToWorld(this.cfg.seats[0].at[0], this.cfg.seats[0].at[1] - 30);
    g.structure.shatter(this.body, top, 40, isGlass, this.body.localDir(0, 1));
    return true;
  }

  private ejectStep(dt: number): void {
    const e = this.ejecting!;
    e.t += dt;
    const g = this.game;
    const up = this.body.localDir(0, 1);
    if (e.t < 0.3) {
      // its rocket: ~15 g for a third of a second, clear of the fin
      for (const p of e.who.parts) {
        if (p.destroyed) continue;
        const dv = 90 * dt;
        p.body.applyImpulse({ x: up.x * dv * p.mass, y: up.y * dv * p.mass }, true);
      }
      const chest = e.who.limbs.get('lowerTorso')?.part;
      if (chest) {
        g.particles.emit(PK.Fire, chest.x - up.x * 0.4, chest.y - up.y * 0.4, { vx: -up.x * 8, vy: -up.y * 8, life: 0.2, size: 0.2, size1: 0.05, color: 0xfff0b0, color1: 0xff6a20, alpha: 1, alpha1: 0.2, gravity: 0, drag: 2 });
        g.particles.smoke(chest.x, chest.y, 1, 0.35);
      }
      return;
    }
    const chest = e.who.limbs.get('upperTorso')?.part;
    if (!e.pack || e.pack.destroyed || e.pack.state !== 'packed' || e.who.destroyed || !chest) {
      this.ejecting = null;
      for (const p of e.who.parts) if (!p.destroyed) p.setNoCollide(null);
      return;
    }
    if (chest.vy < 3 || e.t > 2.5) {
      e.pack.open();
      for (const p of e.who.parts) if (!p.destroyed) p.setNoCollide(null);
      this.ejecting = null;
    }
  }

  /** Its parachute for the whole aircraft (the Cirrus' CAPS): out of its back on its lines, it lowers the lot. */
  private pullCaps(): boolean {
    if (!this.spec.caps || this.capsUsed || this.wrecked) return false;
    const g = this.game;
    const def = getItem('parachute-canopy-big');
    if (!def) return false;
    const b = this.body;
    this.capsUsed = true;
    const v = b.body.linvel();
    const sp = Math.hypot(v.x, v.y);
    const away = sp > 3 ? { x: -v.x / sp, y: -v.y / sp } : b.localDir(0, 1);
    const hatch = b.pixelToWorld(this.spec.cg[0] - 2.4 * 32 * 0.3, this.spec.cg[1] - 14);
    const at = { x: hatch.x + away.x * 2 + 0.6, y: hatch.y + Math.max(1.5, away.y * 2) };
    const c = g.spawn(def, at.x, at.y, { angle: Math.atan2(away.y, away.x) - Math.PI / 2 });
    if (!c) return false;
    for (const q of c.parts) q.body.setLinvel(v, true);
    const bottom = c.parts[0].pixelToWorld(c.parts[0].w / 2, c.parts[0].h - 1);
    const lines = g.connections.create('rope', b, hatch, c.parts[0], bottom, 6);
    if (lines) lines.breakAt = Infinity;
    g.sound.play('explosion/firework_launch', { gain: 0.7, x: b.x });
    g.sound.play('machine/air_release', { gain: 0.7, x: b.x, vary: 0.1 });
    this.on = false;
    return true;
  }

  // ---- the glider's winch ---------------------------------------------------------

  /** A winch launch: a cable to a winch 900 m ahead, wound in hard till it's high or let go. */
  private winchLaunch(): void {
    if (this.winch) {
      this.winch = null;
      this.game.sound.click(this.body.x, 1.2);
      return;
    }
    const b = this.body;
    const f = b.flip;
    const x = b.x + f * 900;
    this.winch = { x, y: this.game.env.groundAt(x, b.y), t: 0 };
    this.game.sound.play('machine/rope_snap', { gain: 0.3, x: b.x, rate: 0.6 });
  }

  private winchPull(c: V2, dt: number): void {
    const w = this.winch!;
    w.t += dt;
    const b = this.body;
    const hook = b.pixelToWorld(this.spec.cg[0], this.spec.cg[1] + 6);
    const dx = w.x - hook.x;
    const dy = w.y - hook.y;
    const d = Math.hypot(dx, dy);
    const above = Math.atan2(-dy, Math.abs(dx));
    // (it lets go once the cable's steep under it, it's over the winch, or a minute's gone)
    if (above > 70 * DEG || dx * b.flip < 30 || w.t > 60 || d < 1) {
      this.winch = null;
      // (let go of, the assist noses it over to glide, as a pilot does)
      if (this.assist) {
        this.holding = true;
        this.hold = 0;
      }
      this.game.sound.click(b.x, 1.4);
      return;
    }
    // a winch's pull, eased in over a second, its driver winding in to keep the glider near
    // 30 m/s (108 km/h: an ASK 21 is winched at no more than 150): up to near twice its weight
    // getting going, less once it's climbing fast
    const v = b.body.linvel();
    const V = Math.hypot(v.x, v.y);
    const T = this.spec.trueKg * G0 * clamp(1.1 + 0.25 * (30 - V), 0, 1.9) * Math.min(1, w.t);
    this.addForce((dx / d) * T, (dy / d) * T, hook.x, hook.y, c);
  }

  // ---- what's said, drawn and heard ---------------------------------------------

  pilotCommand(cmd: PilotCommand): boolean {
    switch (cmd) {
      case 'assist':
        this.assist = !this.assist;
        this.holding = false;
        return true;
      case 'autopilot':
        this.autopilot = this.autopilot ? null : { alt: this.body.y + (this.game.map.world ? this.game.air.base : 0) };
        this.holding = false;
        return true;
      case 'gear':
        if (!this.spec.wing?.flapCl) return false;
        this.flapsWant = this.flapsWant >= 1 ? 0 : this.flapsWant + 0.5;
        return true;
      case 'chutes':
        return this.pullCaps();
      case 'eject':
        return this.eject();
      case 'flares':
        return this.flare();
      case 'lights':
        this.lights = !this.lights;
        return true;
      case 'horn':
        this.game.sound.play('machine/horn', { gain: 0.3, x: this.body.x, rate: 1.6 });
        return true;
      default:
        return false;
    }
  }

  /** What the pilot's readout shows (see Controls.pilotHud()). */
  hud(): PilotHud {
    const b = this.body;
    const g = this.game;
    const v = b.body.linvel();
    const height = g.env.world ? b.y - g.env.groundAt(b.x, b.y) : b.y - WORLD.floor;
    const n = this.spec.power?.at.length ?? 0;
    const running = this.driving ? n : 0;
    const air = g.map.world ? { alt: b.y + g.origin.y, air: g.air.densityAt(b.y), temp: g.air.tempAt(b.y) } : {};
    return {
      speed: Math.hypot(v.x, v.y), height, climb: v.y, throttle: this.T, note: this.status(),
      engines: n, running, assist: this.assist || !!this.autopilot, kind: this.spec.wing ? 'plane' : 'craft',
      tilt: wrapAngle(b.body.rotation()), spin: b.body.angvel(), g: this.gload,
      ...(this.spec.wing ? { aoa: this.aoa * DEG, stall: this.stalled } : {}),
      ...air,
    };
  }

  /** A few words for its readout: what's set (flaps, the afterburner, the winch). */
  status(): string {
    const out: string[] = [];
    if (this.spec.kind === 'glider') out.push(`airbrakes ${Math.round(this.T * 100)}%`);
    if (this.flaps > 0.02) out.push(`flaps ${Math.round(this.flaps * 100)}%`);
    if (this.ab > 0.5) out.push('afterburner');
    if (this.winch) out.push('winch');
    if (this.autopilot) out.push(`autopilot ${Math.round(this.autopilot.alt)} m`);
    if (this.spec.gun) out.push(`${this.rounds} rounds`);
    if (this.rotorGone) out.push(this.spec.rotor ? 'ROTOR GONE' : 'PROP GONE');
    if (this.tailGone) out.push('TAIL ROTOR GONE');
    if (this.stalled) out.push('STALL');
    const v = this.body.body.linvel();
    if (Math.hypot(v.x, v.y) > this.spec.vne * Math.sqrt(RHO0 / this.rhoAt(this.body.y))) out.push('OVERSPEED');
    return out.join(', ');
  }

  private noises(): void {
    const s = this.spec;
    const pw = s.power;
    const b = this.body;
    const g = this.game;
    if (pw && this.N > 0.01 && this.driving) {
      const n = this.N;
      if (pw.kind === 'jet') {
        g.sound.hold(this, 'machine/jet_whine_loop', 0.1 + 0.3 * n, b.x, 0.55 + 0.6 * n);
        if (n > 0.3) g.sound.hold(this, 'machine/jet_roar_loop', 0.25 + 0.5 * ((n - 0.3) / 0.7) + this.ab * 0.3, b.x, 0.8 + 0.25 * n - this.ab * 0.1);
      } else if (pw.kind === 'prop') {
        g.sound.hold(this, 'machine/motor_loop', 0.18 + 0.3 * n, b.x, 0.55 + 0.7 * n);
        g.sound.hold(this, 'machine/fan_loop', 0.1 + 0.2 * n * this.spin, b.x, 1.4 + 0.6 * n);
      } else {
        g.sound.hold(this, 'machine/jet_whine_loop', 0.08 + 0.18 * n, b.x, 0.45 + 0.4 * n);
        g.sound.hold(this, 'machine/fan_loop', 0.2 + 0.4 * this.spin, b.x, (pw.kind === 'rotor' ? 0.3 : 0.9) + 0.4 * this.spin);
      }
    }
  }

  frame(dt: number): void {
    const b = this.body;
    if (b.destroyed) return;
    this.drawDecals(dt);
    this.drawLights(dt);
    const g = this.game;
    const pw = this.spec.power;
    // the afterburner's flame, a jet's heat and its trail high up, a rotor's downwash
    if (pw?.nozzle && this.driving && this.N > 0.05) {
      const n = b.pixelDrawn(pw.nozzle[0], pw.nozzle[1]);
      const back = b.localDir(-b.flip, 0);
      const v = b.body.linvel();
      if (this.ab > 0.1) {
        for (let i = 0; i < 3; i++) {
          g.particles.plume(PK.Fire, n.x, n.y, v.x, v.y, back.x * (25 + Math.random() * 10), back.y * (25 + Math.random() * 10), {
            life: 0.07 + Math.random() * 0.05, size: 0.55 * this.ab, size1: 0.15, color: 0xfff6d8, color1: 0xff7a30, alpha: 1, alpha1: 0, gravity: 0, drag: 3,
          });
        }
        g.renderer.addLight(n.x + back.x, n.y + back.y, 4, 0.8 * this.ab, 0xffb060);
      }
      const alt = b.y + (g.map.world ? g.air.base : 0);
      if (g.map.world && alt > 700 && alt < 1400 && Math.random() < 0.5) {
        g.particles.plume(PK.Smoke, n.x, n.y, v.x * 0.98, v.y * 0.98, 0, 0, { life: 3, size: 0.5, size1: 1.6, color: 0xf2f4f6, color1: 0xe8ecf0, alpha: 0.5, alpha1: 0, gravity: 0, drag: 0.3 });
      }
    }
    if (this.spec.rotor && this.spin > 0.3) {
      const ground = g.env.groundAt(b.x, b.y);
      const h = b.y - ground;
      const R = this.spec.rotor.r;
      if (h < R * 1.5 && Math.random() < this.spin * (1 - h / (R * 1.5))) {
        const side = Math.random() < 0.5 ? -1 : 1;
        g.particles.emit(PK.Smoke, b.x + side * Math.random() * R, ground + 0.1, { vx: side * (5 + Math.random() * 5) * this.spin, vy: 0.4, life: 1, size: 0.25, size1: 0.9, color: 0xcfc6b4, color1: 0xb8b0a0, alpha: 0.4, alpha1: 0, gravity: 0, drag: 1.5 });
      }
    }
    // the winch's cable
    const w = this.winch;
    if (w) {
      const hook = b.pixelDrawn(this.spec.cg[0], this.spec.cg[1] + 6);
      g.projectiles.drawBeam(hook.x, hook.y, w.x, w.y, 0.04, 0x30302c, 0);
    }
  }

  /** Its props and rotors drawn over it, turning as fast as they spin. */
  protected drawDecals(dt: number): void {
    this.animT -= dt * (2 + this.spin * 40);
    if (this.animT <= 0) {
      this.animT = 1;
      this.frameN = (this.frameN + 1) % 4;
    }
  }

  /** Which of a blade's frames to show: still, turning, or the blur (see art/aircraft propArt()). */
  protected bladeFrame(): number {
    return this.spin > 0.55 ? 4 : this.spin > 0.02 ? this.frameN : 0;
  }

  protected decalZ(): number {
    return this.frontZ + 0.0009;
  }

  private drawLights(dt: number): void {
    const L = this.spec.lights;
    if (!L || !this.lights || this.wrecked) return;
    const b = this.body;
    const g = this.game;
    this.strobeT = (this.strobeT + dt) % 1.2;
    if (L.nav) {
      const p = b.pixelDrawn(L.nav[0], L.nav[1]);
      g.renderer.addLight(p.x, p.y, 0.9, 0.35, b.flip > 0 ? 0xff3020 : 0x30ff60);
    }
    if (L.beacon && this.driving && this.strobeT < 0.12) {
      const p = b.pixelDrawn(L.beacon[0], L.beacon[1]);
      g.renderer.addLight(p.x, p.y, 1.6, 0.7, 0xff2a1a);
    }
    if (L.strobe && this.flying && (this.strobeT % 0.6) < 0.05) {
      const p = b.pixelDrawn(L.strobe[0], L.strobe[1]);
      g.renderer.addLight(p.x, p.y, 2.2, 0.9, 0xffffff);
    }
    if (L.landing && this.driving && (!this.flying || b.y - g.env.groundAt(b.x, b.y) < 120)) {
      const p = b.pixelDrawn(L.landing[0], L.landing[1]);
      const d = b.localDir(b.flip, 0);
      g.renderer.addLight(p.x + d.x * 1.6, p.y + d.y * 1.6 - 0.3, 2.4, 0.28, 0xfff2c0);
    }
  }

  // ---- menus, saves -------------------------------------------------------------

  activate(): void {
    if (this.spec.kind === 'glider') {
      this.winchLaunch();
      return;
    }
    if (this.wrecked) return;
    this.on = !this.on;
    if (this.powered && !this.on) this.heldOff = true;
    if (this.on && this.T < 0.01 && this.spec.power?.kind === 'rotor') this.T = 0;
    this.game.sound.click(this.body.x, this.on ? 1 : 0.7);
  }

  contextActions(): ContextAction[] {
    const s = this.spec;
    const acts: ContextAction[] = [];
    if (s.kind === 'glider') acts.push({ label: this.winch ? 'Let go of the winch' : 'Winch launch', hint: 'F', disabled: this.wrecked, action: () => this.winchLaunch() });
    else if (s.power) acts.push({ label: this.on ? 'Stop the engines' : 'Start the engines', hint: 'F', disabled: this.wrecked, action: () => this.activate() });
    const tl = s.kind === 'glider' ? 'Airbrakes' : s.kind === 'heli' || s.kind === 'tiltrotor' ? 'Collective' : 'Throttle';
    acts.push({ label: `${tl}: ${Math.round(this.T * 100)}% (W, S)`, disabled: true, action: () => {} });
    for (const t of [0, 0.5, 1]) acts.push({ label: `${tl} ${t * 100}%`, checked: Math.abs(this.T - t) < 0.01, action: () => (this.T = t) });
    if (s.wing?.flapCl) acts.push({ label: `Flaps: ${['up', 'half', 'down'][Math.round(this.flapsWant * 2)]} ([)`, action: () => this.pilotCommand('gear') });
    acts.push({ label: 'Stability assist (`)', checked: this.assist, action: () => this.pilotCommand('assist') });
    acts.push({ label: 'Autopilot: hold this height (Insert)', checked: !!this.autopilot, action: () => this.pilotCommand('autopilot') });
    if (s.gun) acts.push({ label: `Rearm the gun (${this.rounds} of ${s.gun.rounds})`, action: () => (this.rounds = s.gun!.rounds) });
    if (s.flares) acts.push({ label: `Flares: ${this.flaresLeft} (Caps Lock)`, action: () => this.flare() });
    if (s.eject && this.riders[0]) acts.push({ label: 'Eject the pilot (\')', danger: true, action: () => this.eject() });
    if (s.caps) acts.push({ label: this.capsUsed ? 'Parachute (CAPS) used' : 'Pull the parachute (CAPS: ])', danger: true, disabled: this.capsUsed, action: () => this.pullCaps() });
    if (this.capsUsed || this.ejected) acts.push({ label: 'Repack the parachute and seat', action: () => { this.capsUsed = false; this.ejected = false; } });
    if (this.rotorGone) acts.push({ label: s.rotor ? 'Rotor broken' : 'Propeller broken', disabled: true, action: () => {} });
    const n = this.riders.filter((r) => r).length;
    if (n) acts.push({ label: n > 1 ? 'Everyone out' : 'Get out', action: () => { for (let i = 0; i < this.riders.length; i++) this.release(i, 'out'); } });
    if (!this.cfg.noBelts) acts.push({ label: 'Seat belts', checked: this.belts, action: () => (this.belts = !this.belts) });
    return acts;
  }

  repair(): void {
    super.repair();
    this.rotorGone = this.tailGone = false;
    this.overT = this.flutterT = 0;
    this.rounds = this.spec.gun?.rounds ?? 0;
    this.flaresLeft = this.spec.flares ?? 0;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    x.T = Math.round(this.T * 1000) / 1000;
    x.N = Math.round(this.N * 1000) / 1000;
    x.sp = Math.round(this.spin * 1000) / 1000;
    if (this.flapsWant) x.fl = this.flapsWant;
    if (!this.assist) x.na = true;
    if (this.rotorGone) x.rg = true;
    if (this.tailGone) x.tg = true;
    if (this.spec.gun) x.rd = this.rounds;
    if (this.spec.flares) x.fs = this.flaresLeft;
    if (this.capsUsed) x.caps = true;
    if (this.ejected) x.ej = true;
    if (this.ab > 0.05) x.ab = Math.round(this.ab * 100) / 100;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
    this.T = num(x.T, 0);
    this.N = num(x.N, 0);
    this.spin = num(x.sp, 0);
    this.flapsWant = num(x.fl, 0);
    this.assist = !x.na;
    this.rotorGone = !!x.rg;
    this.tailGone = !!x.tg;
    this.ab = num(x.ab, 0);
    if (this.spec.gun && typeof x.rd === 'number') this.rounds = clamp(Math.round(x.rd), 0, this.spec.gun.rounds);
    if (this.spec.flares && typeof x.fs === 'number') this.flaresLeft = clamp(Math.round(x.fs), 0, this.spec.flares);
    this.capsUsed = !!x.caps;
    this.ejected = !!x.ej;
  }

  protected onDestroy(): void {
    super.onDestroy();
    for (const d of this.decals) d.dispose();
    this.decals = [];
  }
}

// ---------------------------------------------------------------- props and rotors

/** An aeroplane with propellers drawn turning on it (see Powerplant.props). */
export class PropPlane extends Aircraft {
  private props: Decal[] | null = null;
  private art: (key: string) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, art: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, x, y, opts);
    this.art = art;
  }

  protected drawDecals(dt: number): void {
    super.drawDecals(dt);
    const props = this.spec.power?.props ?? [];
    const b = this.body;
    const f = this.bladeFrame();
    this.props ??= props.map((p) => {
      const d = new Decal(this.game, this.art(`${p.r}:0`), this.decalZ());
      this.decals.push(d);
      return d;
    });
    props.forEach((p, i) => {
      const at = b.pixelDrawn(p.at[0], p.at[1]);
      this.props![i].show(this.rotorGone ? null : this.art(`${p.r}:${f}`), at.x, at.y, b.sprite.a, b.flip, b);
    });
  }
}

/**
 * A helicopter: its main rotor's blades seen side on over the cabin, its tail rotor's disc
 * face on at the tail (see FlightSpec.rotor). The collective (W, S) lifts it; Q and E tilt
 * it (the cyclic), and tilted, it goes that way.
 */
export class Helicopter extends Aircraft {
  private main: Decal | null = null;
  private tail: Decal | null = null;
  private blades: (key: string) => PixelArt;
  private disc: (key: string) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, blades: (key: string) => PixelArt, disc: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, x, y, opts);
    this.blades = blades;
    this.disc = disc;
  }

  protected drawDecals(dt: number): void {
    super.drawDecals(dt);
    const r = this.spec.rotor!;
    const b = this.body;
    const f = this.bladeFrame();
    if (!this.main) {
      this.main = new Decal(this.game, this.blades(`${r.r}:0`), this.decalZ());
      this.decals.push(this.main);
    }
    const hub = b.pixelDrawn(r.at[0], r.at[1] - 2);
    this.main.show(this.rotorGone ? null : this.blades(`${r.r}:${f}`), hub.x, hub.y, b.sprite.a, b.flip, b);
    if (r.tail) {
      if (!this.tail) {
        this.tail = new Decal(this.game, this.disc(`${r.tail.r}:0`), this.decalZ());
        this.decals.push(this.tail);
      }
      const t = b.pixelDrawn(r.tail.at[0], r.tail.at[1]);
      this.tail.show(this.tailGone ? null : this.disc(`${r.tail.r}:${f}`), t.x, t.y, b.sprite.a, b.flip, b);
    }
  }

  protected bladeSpans(): [V2, V2][] {
    const out = super.bladeSpans();
    const t = this.spec.rotor?.tail;
    if (t && !this.tailGone) {
      const b = this.body;
      const c = b.pixelToWorld(t.at[0], t.at[1]);
      const u = b.localDir(0, 1);
      out.push([c, { x: c.x + u.x * t.r, y: c.y + u.y * t.r }], [c, { x: c.x - u.x * t.r, y: c.y - u.y * t.r }]);
    }
    return out;
  }

  /** The tail rotor alone struck: it's gone, and the main rotor's turn is left unchecked. */
  protected bladesBroken(at: V2): void {
    const t = this.spec.rotor?.tail;
    if (t && !this.tailGone) {
      const c = this.body.pixelToWorld(t.at[0], t.at[1]);
      if (Math.hypot(at.x - c.x, at.y - c.y) <= t.r + 0.3) {
        this.tailGone = true;
        this.game.particles.debris(at.x, at.y, 0, 1, 8, 0x4a5058, 6);
        this.game.sound.play('explosion/debris', { gain: 0.4, x: at.x, vary: 0.15 });
        return;
      }
    }
    super.bladesBroken(at);
  }
}

/**
 * A tiltrotor (the V-22): its nacelles on the wingtips turn its rotors from straight up
 * (hovering, as a helicopter) to straight ahead (flying, as a plane, on its wing); A and D
 * turn them back or forward, ten degrees a second.
 */
export class Tiltrotor extends Aircraft {
  /** The nacelles' angle (degrees: 90 up, 0 ahead). */
  nacelle = 90;
  private nac: Decal | null = null;
  private rotorD: Decal | null = null;
  private nacArt: () => PixelArt;
  private blades: (key: string) => PixelArt;
  private pivot: [number, number];
  private arm: number;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, pivot: [number, number], arm: number, nacelle: () => PixelArt, blades: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, x, y, opts);
    this.pivot = pivot;
    this.arm = arm;
    this.nacArt = nacelle;
    this.blades = blades;
  }

  /** Its rotors' axis (world, a unit vector) and hub. */
  private axis(): { d: V2; hub: V2 } {
    const b = this.body;
    const t = this.nacelle * DEG;
    const fwd = b.localDir(b.flip, 0);
    const up = b.localDir(0, 1);
    const d = { x: fwd.x * Math.cos(t) + up.x * Math.sin(t), y: fwd.y * Math.cos(t) + up.y * Math.sin(t) };
    const p = b.pixelToWorld(this.pivot[0], this.pivot[1]);
    return { d, hub: { x: p.x + d.x * this.arm, y: p.y + d.y * this.arm } };
  }

  protected extraForces(rho: number, c: V2, dt: number): void {
    super.extraForces(rho, c, dt);
    const k = this.keys.x * this.body.flip;
    // (8° a second at most, as the real one's turn)
    if (k) this.nacelle = clamp(this.nacelle - k * 8 * dt, 0, 95);
  }

  /** Its two rotors: a helicopter's lift hovering, a propeller's push flying (whichever is less), along their axis. */
  protected rotorLift(rho: number, sigma: number, c: V2): void {
    const s = this.spec;
    const r = s.rotor!;
    if (this.rotorGone || this.spin < 0.02) return;
    const { d, hub } = this.axis();
    const P = (s.power!.power ?? 0) * Math.min(this.N, 1) * sigma ** 0.8 * 0.88;
    const A = Math.PI * r.r * r.r * (r.n ?? 2);
    const b = this.body;
    const v = b.body.linvel();
    const axial = v.x * d.x + v.y * d.y;
    let Tmax = (MERIT * P * Math.sqrt(2 * rho * A)) ** (2 / 3);
    const across = Math.abs(v.x * d.y - v.y * d.x);
    Tmax *= 1 + 0.2 * smoothstep(4, 16, across) * (this.nacelle / 90);
    // (climbing or flying ahead, the air coming through its rotors: in the end a propeller's η P / V)
    const T = Tmax * inflow(Tmax, rho, A, axial) * this.T * this.spin * this.spin;
    this.addForce(d.x * T, d.y * T, hub.x, hub.y, c);
  }

  /**
   * Hovering, its rotors' cyclic pitches it (two rotors, each tilting its thrust: three times a
   * helicopter's for its weight: enough to hold it against its rotors' push ahead, 2 m over its
   * centre of gravity, as they tilt); flying ahead, its tail does.
   */
  protected rotorAuthority(rho: number): number {
    return super.rotorAuthority(rho) * 3 * (0.15 + 0.85 * Math.sin(this.nacelle * DEG));
  }

  protected bladeSpans(): [V2, V2][] {
    if (this.rotorGone) return [];
    const { d, hub } = this.axis();
    const R = this.spec.rotor!.r;
    const s = { x: -d.y, y: d.x };
    return [[hub, { x: hub.x + s.x * R, y: hub.y + s.y * R }], [hub, { x: hub.x - s.x * R, y: hub.y - s.y * R }]];
  }

  protected drawDecals(dt: number): void {
    super.drawDecals(dt);
    const b = this.body;
    const R = this.spec.rotor!.r;
    const f = this.bladeFrame();
    if (!this.nac) {
      this.nac = new Decal(this.game, this.nacArt(), this.decalZ());
      this.rotorD = new Decal(this.game, this.blades(`${R}:0`), this.decalZ() + 0.0001);
      this.decals.push(this.nac, this.rotorD);
    }
    const p = b.pixelDrawn(this.pivot[0], this.pivot[1]);
    const t = this.nacelle * DEG * b.flip;
    const a = b.sprite.a + t;
    const len = (this.nacArt().w * PX) / 2;
    const dir = { x: Math.cos(a) * b.flip, y: Math.sin(a) * b.flip };
    this.nac.show(this.nacArt(), p.x + dir.x * len, p.y + dir.y * len, a, b.flip, b);
    const hub = { x: p.x + dir.x * this.arm, y: p.y + dir.y * this.arm };
    this.rotorD!.show(this.rotorGone ? null : this.blades(`${R}:${f}`), hub.x, hub.y, Math.atan2(dir.y, dir.x) + Math.PI / 2, 1, b);
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    x.nac = Math.round(this.nacelle * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (typeof x.nac === 'number' && Number.isFinite(x.nac)) this.nacelle = clamp(x.nac, 0, 95);
  }

  hud(): PilotHud {
    return { ...super.hud(), kind: 'plane' };
  }

  status(): string {
    const s = super.status();
    return `nacelles ${Math.round(this.nacelle)}°${s ? `, ${s}` : ''}`;
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    acts.splice(1, 0, { label: `Nacelles at ${Math.round(this.nacelle)}° (A, D)`, disabled: true, action: () => {} },
      { label: 'Nacelles up (hover)', checked: this.nacelle >= 89, action: () => (this.nacelle = 90) },
      { label: 'Nacelles ahead (fly)', checked: this.nacelle <= 1, action: () => (this.nacelle = 0) });
    return acts;
  }
}

/**
 * A wing hung over it on a pivot or on lines, drawn over it (a trike's flexwing, a powered
 * parachute's canopy): the wing's lift and drag act on it at the hang point.
 */
abstract class HungWing extends PropPlane {
  protected wingDecal: Decal | null = null;

  /** The wing's chord angle (world, rad) and where its centre is drawn (world) this frame. */
  protected abstract wingPose(drawn: boolean): { a: number; x: number; y: number };

  /**
   * The angle the wing's set from (rad): flying, the way it's going through the air. A hung wing
   * swings free on its hang point and lines up with the air as a weathervane does, at the angle its
   * rigging (or the bar) sets: so it flies at much the one speed, and the throttle makes it climb.
   * On the ground, slow, the cart's own.
   */
  protected airAngle(): number {
    const b = this.body;
    const v = b.body.linvel();
    const w = this.windAt(b.x, b.y);
    const vx = v.x - w.x;
    const vy = v.y - w.y;
    if (!this.flying && Math.hypot(vx, vy) < 8) return b.body.rotation();
    return Math.atan2(vy * b.flip, vx * b.flip);
  }
  protected abstract wingArt(): PixelArt;

  protected drawDecals(dt: number): void {
    super.drawDecals(dt);
    const b = this.body;
    if (!this.wingDecal) {
      this.wingDecal = new Decal(this.game, this.wingArt(), this.decalZ() - 0.0002);
      this.decals.push(this.wingDecal);
    }
    const w = this.wingPose(true);
    this.wingDecal.show(this.wingArt(), w.x, w.y, w.a, b.flip, b);
  }
}

/**
 * A weight-shift trike: its flexwing pivots on the mast's top, and the pilot's bar (Q and E)
 * swings it: pushed out, the wing's nose comes up and it slows and climbs; pulled in, it
 * dives faster. The wing is swept, its tips set lower than its root: they act as its tail.
 */
export class Trike extends HungWing {
  /** The bar (degrees, + the wing's nose up from where it trims). */
  bar = 0;
  private hang: [number, number];
  private wingImg: () => PixelArt;
  private wingHang: [number, number];

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, art: (key: string) => PixelArt, wing: () => PixelArt, hang: [number, number], wingHang: [number, number], x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, art, x, y, opts);
    this.hang = hang;
    this.wingImg = wing;
    this.wingHang = wingHang;
    // (no stability assist: the bar is held where it's left, as a trike's is)
    this.assist = false;
  }

  protected wingArt(): PixelArt {
    return this.wingImg();
  }

  protected wingPose(drawn: boolean): { a: number; x: number; y: number } {
    const b = this.body;
    const h = drawn ? b.pixelDrawn(this.hang[0], this.hang[1]) : b.pixelToWorld(this.hang[0], this.hang[1]);
    const a = (drawn ? b.sprite.a : b.body.rotation()) + this.bar * DEG * b.flip;
    const art = this.wingImg();
    // (the art's hang point is on the pivot)
    const ox = (art.w / 2 - this.wingHang[0] * 32) * PX * b.flip;
    const oy = (this.wingHang[1] * 32 - art.h / 2) * PX;
    return { a, x: h.x + ox * Math.cos(a) - oy * Math.sin(a), y: h.y + ox * Math.sin(a) + oy * Math.cos(a) };
  }

  /** The bar moves the whole wing's angle: its root and its tips (the "tail"). */
  protected wingLift(w: Surface, rho: number): ReturnType<Aircraft['surface']> {
    const b = this.body;
    const h = b.pixelToWorld(this.hang[0], this.hang[1]);
    const a = this.airAngle() + this.bar * DEG * b.flip;
    const f = { x: Math.cos(a) * b.flip, y: Math.sin(a) * b.flip };
    const at = { x: h.x + f.x * 0.25, y: h.y + f.y * 0.25 };
    return this.surface(w, rho, 0, b, at, a);
  }

  protected extraForces(rho: number, c: V2, dt: number): void {
    super.extraForces(rho, c, dt);
    // the bar: Q and E push it out or pull it in, and it stays where it's left
    if (this.keys.r) this.bar = clamp(this.bar + this.keys.r * this.body.flip * 10 * dt, -8, 6);
    // the swept tips behind, set lower: they hold its nose where the bar puts it
    const t = this.spec.tips;
    if (t) {
      const b = this.body;
      const h = b.pixelToWorld(this.hang[0], this.hang[1]);
      const a = this.airAngle() + this.bar * DEG * b.flip;
      const f = { x: Math.cos(a) * b.flip, y: Math.sin(a) * b.flip };
      const at = { x: h.x - f.x * 1.3, y: h.y - f.y * 1.3 };
      const tips = this.surface(t, rho, 0, b, at, a);
      if (tips) this.addForce(tips.fx, tips.fy, tips.x, tips.y, c);
    }
    // (the carriage hangs from the wing: it swings back under it)
    const b = this.body;
    this.F.m += -wrapAngle(b.body.rotation()) * this.spec.trueKg * G0 * 1.2 - b.body.angvel() * this.spec.trueKg * 1.5;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    x.bar = Math.round(this.bar * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (typeof x.bar === 'number' && Number.isFinite(x.bar)) this.bar = clamp(x.bar, -8, 6);
  }

  status(): string {
    const s = super.status();
    return `bar ${this.bar > 0 ? 'out' : this.bar < 0 ? 'in' : 'neutral'} ${Math.abs(Math.round(this.bar))}°${s ? `, ${s}` : ''}`;
  }
}

/**
 * A powered parachute: a cart on wheels under a ram-air canopy on long lines. Laid out behind
 * it on the ground, the canopy fills and rises over it once the cart runs fast enough; it
 * flies at the speed the canopy sets, the throttle making it climb or sink. Q and E pull its
 * brakes (a flare to land).
 */
export class PoweredParachute extends HungWing {
  /** The canopy: 0 laid out behind on the ground, 1 open overhead. */
  inflated = 0;
  private hang: [number, number];
  private canopyImg: () => PixelArt;
  private lineLen = 7;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, art: (key: string) => PixelArt, canopy: () => PixelArt, hang: [number, number], x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, art, x, y, opts);
    this.hang = hang;
    this.canopyImg = canopy;
    this.assist = false;
  }

  protected wingArt(): PixelArt {
    return this.canopyImg();
  }

  /** Where the canopy is: overhead and a little back on its lines, or laid out on the ground behind. */
  protected wingPose(drawn: boolean): { a: number; x: number; y: number } {
    const b = this.body;
    const h = drawn ? b.pixelDrawn(this.hang[0], this.hang[1]) : b.pixelToWorld(this.hang[0], this.hang[1]);
    const t = this.inflated;
    const ba = drawn ? b.sprite.a : b.body.rotation();
    // the lines' angle back from straight up: swung right back to the ground behind, laid out
    const swing = (1 - t) * 1.45 + 0.12 + this.brakes() * 0.15;
    const la = ba + swing * b.flip;
    const L = this.lineLen;
    const x = h.x - Math.sin(la) * L * 1;
    const y = h.y + Math.cos(la) * L;
    const ground = this.game.env.groundAt(x, y);
    return { a: ba - 0.08 * t * b.flip, x, y: Math.max(y, ground + 0.35) };
  }

  private brakes(): number {
    return this.keys.r !== 0 ? 1 : 0;
  }

  protected wingLift(w: Surface, rho: number): ReturnType<Aircraft['surface']> {
    const b = this.body;
    const v = b.body.linvel();
    const sp = Math.hypot(v.x, v.y);
    // (it fills as the cart runs, and falls back if it slows on the ground)
    const fill = sp > 6 || this.flying ? 1 : sp < 3 ? -1 : 0;
    this.inflated = clamp(this.inflated + fill * this.game.stepDt * 0.6, 0, 1);
    if (this.inflated < 0.6) return null;
    const p = this.wingPose(false);
    const brake = this.brakes();
    const l = this.surface({ ...w, incidence: w.incidence + brake * 9, cd0: (w.cd0 ?? 0) + brake * 0.12 }, rho, 0, b, { x: p.x, y: p.y }, this.airAngle());
    if (!l) return null;
    const k = (this.inflated - 0.6) / 0.4;
    l.fx *= k;
    l.fy *= k;
    // (it pulls along its lines on the hang point: the cart swings under it)
    const h = b.pixelToWorld(this.hang[0], this.hang[1]);
    l.x = h.x;
    l.y = h.y;
    return l;
  }

  protected extraForces(rho: number, c: V2, dt: number): void {
    super.extraForces(rho, c, dt);
    // hung under the canopy, the cart swings back level
    const b = this.body;
    if (this.inflated > 0.6) this.F.m += -wrapAngle(b.body.rotation()) * this.spec.trueKg * G0 * 2.5 - b.body.angvel() * this.spec.trueKg * 3;
  }

  frame(dt: number): void {
    super.frame(dt);
    const b = this.body;
    if (b.destroyed) return;
    // its lines from the hang point to the canopy's front and back
    const h = b.pixelDrawn(this.hang[0], this.hang[1]);
    const p = this.wingPose(true);
    const half = (this.canopyImg().w * PX) / 2;
    for (const s of [-0.8, 0.8]) {
      const x = p.x + Math.cos(p.a) * half * s * b.flip;
      const y = p.y + Math.sin(p.a) * half * s * b.flip;
      this.game.projectiles.drawBeam(h.x, h.y, x, y, 0.02, 0x2a2826, 0);
    }
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    x.inf = Math.round(this.inflated * 100) / 100;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (typeof x.inf === 'number' && Number.isFinite(x.inf)) this.inflated = clamp(x.inf, 0, 1);
  }

  status(): string {
    const s = super.status();
    return `canopy ${this.inflated >= 1 ? 'open' : this.inflated > 0 ? 'filling' : 'laid out'}${s ? `, ${s}` : ''}`;
  }
}

// ---------------------------------------------------------------- the hot-air balloon

/** Its envelope: volume (m³), the burner's heat (W), the heat it loses a degree over the air (W/K), and when its fabric starts to give (°C). */
const BALLOON = { volume: 2975, burner: 3.2e6, loss: 9000, vent: 90000, scorch: 125, cp: 1005 };

/**
 * A hot-air balloon (a Cameron O-105): a wicker basket under a 2,975 m³ envelope. The burner
 * (W, held) heats the air in it; hot air is lighter than the air round it, and the balloon
 * rises; let go, it cools and sinks; S opens the parachute vent to come down faster. It goes
 * where the wind takes it. Shot or burnt, its envelope leaks its heat; overheated, it scorches.
 */
export class HotAirBalloon extends Aircraft {
  readonly envelope: Part;
  /** The air inside (°C), and the holes in the envelope (each lets out heat). */
  inside = 95;
  holes = 0;
  burning = 0;
  venting = false;
  private burnerAt: [number, number];

  constructor(game: Game, def: ItemDef, cfg: CarConfig, spec: FlightSpec, envelope: () => PixelArt, shapes: ShapeSpec[], burner: [number, number], mouthUp: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, spec, x, y, opts);
    this.burnerAt = burner;
    const b = this.body;
    const art = envelope();
    const top = b.pixelToWorld(burner[0], burner[1]);
    const cy = top.y + mouthUp + (art.h / 2) * PX;
    this.envelope = this.addPart({
      name: 'Envelope', art, material: { ...MAT.plastic, name: 'Nylon', density: 2, flammability: 0.9, debrisColor: 0xc8402c }, x: top.x, y: cy, angle: b.body.rotation(),
      density: 0.4, textureKey: def.id + ':envelope', layer: 0, shapes, hollow: true, angularDamping: 0.5,
    });
    const j = RAPIER.JointData.fixed(b.pixelToLocal(burner[0], burner[1]), 0, this.envelope.worldToLocal(top.x, top.y), 0);
    this.addJoint(j, b, this.envelope);
    // (warm, a few degrees short of floating with what it weighs: it stands ready on its basket)
    const out = this.game.air.tempAt(b.y) + 273.15;
    const lift = Math.max(0.05, Math.min(0.5, spec.trueKg / (BALLOON.volume * this.rhoAt(b.y))));
    this.inside = out / (1 - lift) - 273.15 - 3;
  }

  /** The burner and the vent: W held burns, S held vents; the autopilot burns to hold its height. */
  private heat(dt: number): void {
    const b = this.body;
    const out = this.game.air.tempAt(b.y);
    let burn = this.keys.t > 0 ? 1 : 0;
    this.venting = this.keys.t < 0;
    if (this.autopilot && !this.keys.t) {
      const alt = b.y + (this.game.map.world ? this.game.air.base : 0);
      const want = clamp((this.autopilot.alt - alt) * 0.08 - b.vy * 0.5, -1, 1);
      burn = want > 0.15 ? 1 : 0;
    }
    if (this.wrecked || this.envelope.destroyed) burn = 0;
    this.burning = burn;
    const C = (this.game.air.densityAt(b.y) * BALLOON.volume * BALLOON.cp) / Math.max(1, (this.inside + 273.15) / (out + 273.15));
    const loss = (BALLOON.loss + this.holes * 2500 + (this.venting ? BALLOON.vent : 0)) * (this.inside - out);
    this.inside += ((burn * BALLOON.burner - loss) / Math.max(1e5, C)) * dt;
    this.inside = Math.max(out, Math.min(this.inside, 160));
    // (too hot, its fabric scorches and starts to give)
    if (this.inside > BALLOON.scorch && Math.random() < dt * 0.5) {
      this.holes++;
      this.envelope.charred = Math.min(0.8, this.envelope.charred + 0.05);
    }
    this.T = burn;
    this.N = burn;
  }

  protected balloon(dt: number): void {
    const b = this.body;
    const env = this.envelope;
    this.heat(dt);
    if (env.destroyed) return;
    const out = this.game.air.tempAt(env.y) + 273.15;
    const rho = this.rhoAt(env.y);
    const rhoIn = (rho * out) / (this.inside + 273.15);
    const g = G0 * this.game.air.gravityAt(env.y);
    const lift = BALLOON.volume * (rho - rhoIn) * g;
    // (an envelope burnt or torn open holds nothing)
    const k = this.kM;
    env.body.applyImpulse({ x: 0, y: lift * k * dt }, true);
    // the wind on the envelope (as round as a ball) and the basket
    for (const [p, CdA] of [[env, 0.45 * Math.PI * 8.75 * 8.75], [b, 1.6]] as [Part, number][]) {
      const v = p.body.linvel();
      const w = this.windAt(p.x, p.y);
      const vx = v.x - w.x;
      const vy = v.y - w.y;
      const V = Math.hypot(vx, vy);
      if (V < 0.05) continue;
      const D = 0.5 * rho * V * CdA * k * dt;
      p.body.applyImpulse({ x: -vx * D, y: -vy * D }, true);
    }
    this.aoa = 0;
    this.stalled = false;
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    if (part === this.envelope) {
      if (kind === 'fire') {
        this.holes += amount * 0.05;
        if (this.holes > 120) this.tearEnvelope();
      } else if (kind === 'explosion' || kind === 'cut') {
        this.holes += amount * 0.2;
        if (point && dir && kind === 'explosion') this.game.structure.bite(part, point, dir, Math.min(12, 2 + amount / 40));
        if (this.holes > 120) this.tearEnvelope();
      }
      return;
    }
    super.damage(part, amount, kind, point, dir);
  }

  onBullet(hit: BulletHit): void {
    if (hit.part === this.envelope) {
      // (a round goes through the fabric: a hole in and out, the heat leaking from them)
      this.holes += 1;
      // (nylon stops nothing: it leaves by the far side, where the envelope's drawn ends along its path)
      let exit = hit.exit;
      if (!exit) {
        const p = hit.part;
        const len = Math.hypot(hit.dir.x, hit.dir.y) || 1;
        const d = { x: hit.dir.x / len, y: hit.dir.y / len };
        const span = Math.hypot(p.w, p.h) * PX;
        for (let t = PX; t < span; t += PX) {
          const x = hit.point.x + d.x * t;
          const y = hit.point.y + d.y * t;
          const q = p.worldToPixel(x, y);
          if (p.solidAt(q.ix, q.iy)) exit = { x, y };
        }
      }
      this.game.structure.mark(hit.part, hit.point, hit.normal, hit.dir, exit, false);
      if (exit) this.holes += 1;
      return;
    }
    super.onBullet(hit);
  }

  /** The envelope torn open (burnt through, blown apart): its pieces fall, and the basket with them. */
  private tearEnvelope(): void {
    const e = this.envelope;
    if (e.destroyed) return;
    const g = this.game;
    const pieces = g.structure.fracture(e, { force: 0.6, from: g.structure.newBreak() });
    g.structure.keep(this, pieces);
    e.destroy();
    this.inside = g.air.tempAt(this.body.y);
  }

  frame(dt: number): void {
    super.frame(dt);
    const b = this.body;
    if (b.destroyed || !this.burning) return;
    const g = this.game;
    const p = b.pixelDrawn(this.burnerAt[0], this.burnerAt[1]);
    const up = b.localDir(0, 1);
    const v = b.body.linvel();
    for (let i = 0; i < 3; i++) {
      g.particles.plume(PK.Fire, p.x + (Math.random() - 0.5) * 0.15, p.y, v.x, v.y, up.x * (9 + Math.random() * 4), up.y * (9 + Math.random() * 4), {
        life: 0.12 + Math.random() * 0.08, size: 0.32, size1: 0.12, color: 0xfff2c0, color1: 0xff7a2a, alpha: 1, alpha1: 0, gravity: 0, drag: 2,
      });
    }
    g.renderer.addLight(p.x + up.x * 1.5, p.y + up.y * 1.5, 6, 0.9, 0xffb860);
    g.sound.hold(this, 'fire/flamethrower_loop', 0.55, p.x, 0.75);
  }

  hud(): PilotHud {
    return { ...super.hud(), kind: 'craft', throttle: this.burning };
  }

  status(): string {
    const parts = [`inside ${Math.round(this.inside)} °C`];
    if (this.venting) parts.push('venting');
    if (this.holes >= 1) parts.push(`${Math.round(this.holes)} holes`);
    if (this.inside > BALLOON.scorch) parts.push('TOO HOT');
    if (this.autopilot) parts.push(`autopilot ${Math.round(this.autopilot.alt)} m`);
    return parts.join(', ');
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions().filter((a) => !a.label.startsWith('Throttle') && !a.label.startsWith('Start') && !a.label.startsWith('Stop') && !a.label.startsWith('Stability'));
    acts.unshift({ label: `Air inside: ${Math.round(this.inside)} °C (W burns, S vents)`, disabled: true, action: () => {} },
      { label: 'Burn (heat it 20 °C)', action: () => (this.inside = Math.min(BALLOON.scorch - 5, this.inside + 20)) });
    if (this.holes >= 1) acts.push({ label: `Patch the envelope (${Math.round(this.holes)} holes)`, action: () => (this.holes = 0) });
    return acts;
  }

  repair(): void {
    super.repair();
    this.holes = 0;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x = super.serializeExtra();
    x.in = Math.round(this.inside * 10) / 10;
    if (this.holes) x.ho = Math.round(this.holes);
    if (this.burning) x.bu = 1;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (typeof x.in === 'number' && Number.isFinite(x.in)) this.inside = clamp(x.in, -80, 160);
    this.holes = typeof x.ho === 'number' && Number.isFinite(x.ho) ? clamp(x.ho, 0, 500) : 0;
    this.burning = x.bu ? 1 : 0;
  }
}

/** Is this an aircraft (see Controls: its keys, its readout)? */
export function isAircraft(e: unknown): e is Aircraft {
  return e instanceof Aircraft;
}

/** (the type of a lift worked out: see Aircraft.surface()) */
export type { Lift };

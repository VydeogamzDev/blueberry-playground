import { BATTERY_J } from '../systems/Power';
import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { BROKEN, WORN } from '../world/Entity';
import { Machine } from './Machine';
import { Prop, type PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import { PX } from '../engine/constants';
import { UNIT_QUAD } from '../engine/Renderer';
import { MAT, type PhysMaterial } from '../world/Materials';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import type { V2 } from '../engine/math';
import type { EditField, ValueEditor } from '../tools/Controls';
import { BURN } from '../systems/Fuel';
import { engineLevel, jobAction, pilotState, restorePilot, startedByHand, type Engine, type Job } from '../systems/Piloting';

/** A machine that runs while switched on by hand or while powered (thrusters, lamps, motors, pistons, timers). */
export interface HandSwitched {
  /** Switched on by hand. */
  on: boolean;
  /**
   * Switched off by hand while powered: it stays off until that power goes, and
   * the circuit has its say again at its next change.
   */
  heldOff: boolean;
}

/**
 * The F key (or a pulse) on a hand-switched machine: off if it's running, on if
 * not, whatever powers it.
 */
export function toggleRun(m: HandSwitched, running: boolean, powered: boolean): void {
  m.on = !running && !powered;
  m.heldOff = running && powered;
}

// ------------------------------------------------------------------ battery

/**
 * Powers everything wired to it while switched on, from its charge: what runs on it draws
 * it down, a solar panel or a generator on its wires charges it (see systems/Power), and
 * flat it gives no power. Settings' infinite fuel keeps it full.
 */
export class Battery extends Prop {
  on = true;
  /** Its charge and what it holds (J). */
  charge = BATTERY_J;
  readonly capacity = BATTERY_J;
  private blinkT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  isPowerSource(): boolean {
    return this.on && this.works && this.charge > 0;
  }

  get chargesWater(): boolean {
    return this.isPowerSource();
  }

  /**
   * Hurt, it shorts out inside: it heats up (the worse hurt, the faster), till its
   * casing smokes and catches; broken, it's dead (see works).
   */
  preStep(dt: number): void {
    super.preStep(dt);
    const c = this.condition;
    if (!this.on || c >= WORN || c < BROKEN || this.fried) return;
    this.game.heat.add(this.main, dt * 60 * (WORN - c) / (WORN - BROKEN));
    if (this.main.temp > 120 && Math.random() < dt * 3) this.game.particles.smoke(this.main.x, this.main.y + 0.1, 1, 0.15, true);
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.2 : 0.8);
    this.game.connections.recomputePower();
  }

  frame(dt: number): void {
    if (!this.on) return;
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      const k = this.charge / this.capacity;
      // (green, yellow under a third, red and quick under a tenth; flat, none)
      this.blinkT = k < 0.1 ? 0.45 : 0.9;
      if (k <= 0) return;
      const w = this.main.pixelToWorld(5, 1);
      this.game.particles.flash(w.x, w.y, PX * 2.5, k < 0.1 ? 0xff5a4a : k < 0.33 ? 0xffd04a : 0x8dff8a, 0.25);
    }
  }

  /** Charged back up (its menu). */
  recharge(): void {
    const flat = this.charge <= 0;
    this.charge = this.capacity;
    if (flat) this.game.connections.recomputePower();
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() },
      { label: `Charge: ${Math.round((this.charge / this.capacity) * 100)}%`, disabled: true, action: () => {} },
      { label: 'Recharge', action: () => this.recharge() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, charge: Math.round(this.charge) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    const was = this.charge;
    this.charge = typeof x.charge === 'number' && Number.isFinite(x.charge) ? Math.max(0, Math.min(this.capacity, x.charge)) : this.capacity;
    if ((was > 0) !== (this.charge > 0)) this.game.connections.recomputePower();
  }
}

// ------------------------------------------------------------------ button

/** Sends an activation pulse through its wires when pressed or activated. */
export class Button extends Prop {
  private cool = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  /**
   * A battery's power stops at it: it only pulses. (Carrying it, a button between
   * a battery and a lamp left the lamp lit for good, and pressing it only toggled
   * the battery and the lamp's own switch.)
   */
  conducts(): boolean {
    return false;
  }

  activate(): void {
    if (this.cool > 0) return;
    this.cool = 0.25;
    this.main.flash = 0.6;
    this.game.sound.button(this.main.x);
    this.game.connections.pulse(this);
  }

  preStep(dt: number): void {
    this.cool -= dt;
  }

  onImpact(info: ImpactInfo): void {
    // pressed by something landing on top
    // the contact normal points from the other body into the button
    const up = this.main.localDir(0, 1);
    const fromAbove = info.normal.x * up.x + info.normal.y * up.y < -0.5;
    if (info.otherSpeed > 1.3 && fromAbove) this.activate();
  }

  contextActions(): ContextAction[] {
    return [{ label: 'Press', hint: 'F', action: () => this.activate() }];
  }
}

// ------------------------------------------------------------------ light bulb

let glowTex: THREE.Texture | null = null;
/** A stepped, pixelated halo (three bands) to match the sprite style. */
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const N = 50;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      // a soft bloom; the light map does the actual lighting
      const a = r < 0.3 ? 0.24 : r < 0.6 ? 0.1 : r < 1 ? 0.035 : 0;
      const o = (y * N + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 232;
      img.data[o + 2] = 160;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  glowTex = t;
  return t;
}

/** Lights up when powered (or switched on by hand). */
export class LightBulb extends Prop implements HandSwitched {
  on = false;
  heldOff = false;
  private lit = false;
  private glow: THREE.Mesh;
  private artOn: () => PixelArt;
  private artOff: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, artOn: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.artOn = artOn;
    this.artOff = cfg.art;
    const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(UNIT_QUAD, mat);
    this.glow.scale.set(3.2, 3.2, 1);
    this.glow.position.z = 44.5;
    this.glow.renderOrder = 12;
    this.glow.visible = false;
    game.renderer.scene.add(this.glow);
  }

  activate(): void {
    toggleRun(this, this.lit, this.powered);
    this.game.sound.click(this.main.x, 1.1);
    this.refresh();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.refresh();
  }

  preStep(): void {
    // (held off with no power to hold it off from: a copy made without its battery)
    if (this.heldOff && !this.powered) this.heldOff = false;
  }

  private refresh(): void {
    const lit = (this.on || this.powered) && !this.heldOff;
    if (lit === this.lit || this.destroyed) return;
    this.lit = lit;
    this.main.setArt(lit ? this.artOn() : this.artOff());
    this.glow.visible = lit;
  }

  frame(): void {
    if (!this.lit) return;
    const p = this.main;
    const w = p.pixelToWorld(3.5, 3.5);
    this.glow.position.x = w.x;
    this.glow.position.y = w.y;
    this.game.renderer.addLight(w.x, w.y, 4.2, 0.6, 0xffe6a8);
  }

  onBullet(): void {
    this.shatter();
  }

  contextActions(): ContextAction[] {
    return [{ label: this.lit ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.refresh();
  }

  protected onDestroy(): void {
    this.game.renderer.scene.remove(this.glow);
    (this.glow.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ thruster

/** The pushes a thruster can be set to, as shares of its own (the context menu's; its editor sets any between). */
export const THRUSTS = [0.25, 0.5, 1, 2, 4];
/** The most a thruster, a motor, a fan or a propeller can be set to, as a share of its own (see setting()). */
export const SETTING_MAX = 4;

/** A share of its own an engine's setting can be (a save's, a guest's): THRUSTS' range, or 1. */
export function setting(v: unknown): number {
  return typeof v === 'number' && v >= 0 && v <= SETTING_MAX ? v : 1;
}

/** An editor field for an engine's setting, as a percentage of its own. */
export function settingField(key: string, label: string, get: () => number, set: (v: number) => void): EditField {
  return { key, label, unit: '%', min: 0, max: SETTING_MAX * 100, step: 1, get: () => Math.round(get() * 100), set: (v) => set(Math.min(SETTING_MAX, Math.max(0, v / 100))) };
}

/**
 * Pushes along its facing while active or powered (backwards, powered through a
 * reversing switch set to reverse). A rocket: it pushes as hard however fast it
 * goes, needing no air (only the air's drag holds it back: see systems/Aero).
 */
export class Thruster extends Prop implements HandSwitched, Engine {
  on = false;
  heldOff = false;
  /** Its push (N) from standing still, at the usual setting. */
  force: number;
  /** Its push as a share of the usual (see THRUSTS). */
  thrust = 1;
  job: Job = 'auto';
  pilotOut: number | null = null;
  pilotT = 0;

  /** How hot it looks to a heat seeker (see Missiles.heatOf()): its flame, as hard as it's burning. */
  heatSignature(): number {
    return this.lit * 1200;
  }

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.force = force;
  }

  get running(): boolean {
    if (this.pilotOut !== null) return this.pilotOut > 0 && this.works;
    return (this.on || this.powered) && !this.heldOff && this.works;
  }

  activate(): void {
    // (taken back from the pilot: it's its own again)
    if (this.pilotOut !== null) {
      this.pilotOut = null;
      this.pilotT = 0;
    }
    toggleRun(this, this.running, this.powered);
    // (switched on by hand, it doesn't wait for its stage: see startedByHand())
    if (this.running) startedByHand(this);
    this.game.sound.click(this.main.x, 0.9);
  }

  pushDir(): V2 {
    return this.main.localDir(this.main.flip, 0);
  }

  pushForce(): number {
    return this.force * this.thrust;
  }

  pushAt(): V2 {
    return { x: this.main.x, y: this.main.y };
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    else startedByHand(this);
  }

  canRest(): boolean {
    return !this.running;
  }

  /** Pushing backwards: powered through a reversing switch set to reverse (not under the pilot). */
  get backwards(): boolean {
    return this.pilotOut === null && this.powered && this.reversed;
  }

  /** Out of fuel: switched on, it pushes nothing (see systems/Fuel). */
  dry = false;
  /** Fuel it burns (kg a second for each newton at full: see BURN). */
  protected burn = BURN.rocket;
  /** How hard it ran last step (0 to 1: for its flame and light). */
  protected lit = 0;
  /** Its nozzle (art pixel): where the flame comes out. */
  protected nozzlePx: [number, number] = [0, 5];

  /** Engines can be given a stage (see Entity.stage): off till it's fired. */
  get stageable(): boolean {
    return true;
  }

  /** Its stage fired: it lights (and, flown, the throttle runs it). */
  fireStage(): void {
    this.staged = true;
    if (!this.running && this.pilotOut === null) {
      this.on = true;
      this.heldOff = false;
    }
  }

  /** How hard it runs now (0 to 1: see engineLevel()). */
  protected level(): number {
    return engineLevel(this, this.on);
  }

  /** Which way it pushes now (world): along its facing (`s` -1: reversed); a swivelling one, turned. */
  protected thrustDir(s: number): V2 {
    const p = this.main;
    return p.localDir(p.flip * s, 0);
  }

  /** The fuel it burns at full from its build's tanks (kg/s: see Piloting.buildStats()). */
  burnRate(): number {
    return this.force * this.thrust * this.burn;
  }

  /** The fuel for a step taken (kg): the share of it there was (see systems/Fuel). */
  protected fuelFor(kg: number): number {
    return this.game.fuel.draw(this, kg);
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    this.lit = 0;
    if (!this.running) {
      this.dry = false;
      return;
    }
    const p = this.main;
    if (p.frozen) return;
    const lvl = this.level();
    if (lvl <= 0) return;
    const got = this.fuelFor(this.force * this.thrust * lvl * this.burn * dt);
    this.dry = got <= 0;
    if (got <= 0) return;
    const s = this.backwards ? -1 : 1;
    const f = this.thrustDir(s);
    const push = this.force * this.thrust * lvl * got;
    p.body.applyImpulse({ x: f.x * push * dt, y: f.y * push * dt }, true);
    this.lit = lvl * got;
    this.exhaust(f, s);
  }

  /** The blast out of the nozzle, and its sound. */
  protected exhaust(f: V2, s: number): void {
    const p = this.main;
    const n = p.pixelToWorld(this.nozzlePx[0], this.nozzlePx[1]);
    // the blast out of the nozzle; pushing backwards, it's turned out to the
    // sides and forward, as a jet's thrust reverser turns it
    let ex = -f.x;
    let ey = -f.y;
    let sp = 5 + Math.random() * 3;
    if (s < 0) {
      const u = p.localDir(0, Math.random() < 0.5 ? 1 : -1);
      ex = -f.x * 0.5 + u.x;
      ey = -f.y * 0.5 + u.y;
      sp = 3 + Math.random() * 2;
    }
    // (in thin air the plume spreads wide, nothing round it to hold it in)
    const g = this.game;
    const thin = g.map.world ? g.air.thinness(p.y) : 1;
    const wide = 1 + 3 * (1 - thin);
    const ps = g.particles;
    ps.emit(PK.Fire, n.x, n.y, {
      vx: ex * sp + (Math.random() - 0.5) * wide, vy: ey * sp + (Math.random() - 0.5) * wide,
      life: (0.12 + Math.random() * 0.1) * (1 + (wide - 1) * 0.5), size: 0.12 * Math.sqrt(wide), size1: 0.03 * wide, color: 0xbfe7ff, color1: 0xff7a2a, alpha: 0.9, alpha1: 0.2, gravity: 0, drag: 2,
    });
    if (Math.random() < 0.15 * thin) ps.smoke(n.x + ex * 0.3, n.y + ey * 0.3, 1, 0.15);
    g.sound.hold(this, 'machine/thruster_loop', 0.45, p.x);
  }

  frame(): void {
    if (!this.running || this.main.frozen || this.lit <= 0) return;
    const n = this.main.pixelToWorld(this.nozzlePx[0], this.nozzlePx[1]);
    this.game.renderer.addLight(n.x, n.y, 1.8, 0.3 + Math.random() * 0.1, 0xffa860);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      // (named by the push, not by whether it's picked: a guest's pick is found by its name)
      ...THRUSTS.map((s) => ({ label: `Thrust ${Math.round(this.force * s)} N`, checked: this.thrust === s, action: () => (this.thrust = s) })),
      jobAction(this),
    ];
  }

  /** Edit thrust… (see Controls): its push, anywhere from none to four times its own. */
  editor(): ValueEditor {
    return {
      label: 'Edit thrust…',
      title: `Edit ${this.label.toLowerCase()}`,
      fields: [settingField('thrust', `Thrust (of ${this.force} N)`, () => this.thrust, (v) => (this.thrust = v))],
      reset: () => (this.thrust = 1),
      alive: () => !this.destroyed,
    };
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, thrust: this.thrust, ...pilotState(this) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    // (saves from before the setting push as hard as they did)
    this.thrust = setting(x.thrust);
    restorePilot(this, x);
  }
}

// ------------------------------------------------------------------ motor

/** The speeds a motor can be set to, as shares of its own (the context menu's). */
export const MOTOR_SPEEDS = [0.25, 0.5, 1, 2, 4];
/** The torques a motor can be set to, as shares of its own (the context menu's). */
export const MOTOR_TORQUES = [0.25, 0.5, 1, 2, 4];

export interface MotorConfig {
  housing: () => PixelArt;
  rotor: () => PixelArt;
  rotorShape: ShapeSpec;
  rotorMaterial?: PhysMaterial;
  rotorDensity?: number;
  /** Target speed (rad/s). */
  speed: number;
  /** Maximum torque (N*m). */
  torque: number;
  /** Draw the housing in front of the rotor (wheel hubs). */
  hubOnTop?: boolean;
}

/**
 * A housing with a powered rotor. Weld things to the rotor to spin them. Powered
 * through a reversing switch set to reverse, it turns the other way.
 */
export class Motor extends Machine implements HandSwitched, Engine {
  readonly housing: Part;
  readonly rotor: Part;
  private joint: RAPIER.RevoluteImpulseJoint;
  on = false;
  heldOff = false;
  dir: 1 | -1 = 1;
  job: Job = 'auto';
  pilotOut: number | null = null;
  pilotT = 0;
  /** Its speed as a share of its own (see MOTOR_SPEEDS). */
  speed = 1;
  /** Its torque as a share of its own (see MOTOR_TORQUES). */
  torque = 1;
  /** Driven by an engine in its build (0.4.0, see Vehicles2 CarEngine): its gear's share of its speed and torque. */
  drive: { speed: number; torque: number } | null = null;
  private cfg: MotorConfig;
  private applied = '';

  constructor(game: Game, def: ItemDef, cfg: MotorConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.cfg = cfg;
    this.activatable = true;
    this.usesPower = true;
    this.attachIgnoresBody = true;
    const ang = opts.angle ?? 0;
    this.housing = this.addPart({
      name: 'Housing', art: cfg.housing(), material: MAT.metal, x, y, angle: ang, density: 120, textureKey: def.id + ':h', layer: cfg.hubOnTop ? 3 : 0,
    });
    this.rotor = this.addPart({
      name: 'Rotor', art: cfg.rotor(), material: cfg.rotorMaterial ?? MAT.metal, x, y, angle: ang, layer: cfg.hubOnTop ? 0 : 2,
      shapes: [cfg.rotorShape], density: cfg.rotorDensity ?? 80, textureKey: def.id + ':r', angularDamping: 0.05,
    });
    this.joint = this.addJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 }), this.housing, this.rotor) as RAPIER.RevoluteImpulseJoint;
    this.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.joint.setMotorMaxForce(cfg.torque);
    this.apply();
    this.sturdy();
  }

  private running(): boolean {
    if (this.pilotOut !== null) return this.pilotOut !== 0 && this.works;
    return (this.on || this.powered) && !this.heldOff && this.works;
  }

  canRest(): boolean {
    return !this.running();
  }

  pushDir(): null {
    return null;
  }

  pushForce(): number {
    return this.cfg.torque * this.torque;
  }

  pushAt(): V2 {
    return { x: this.housing.x, y: this.housing.y };
  }

  private apply(): void {
    const run = this.running();
    let dir: number;
    let k: number;
    if (this.pilotOut !== null) {
      // under the pilot: a wheel motor (on Auto or Move) drives right for +, whichever
      // way it faces; on a job of another kind, it runs its own way
      const drive = this.job === 'auto' || this.job === 'move';
      dir = Math.sign(this.pilotOut) * this.dir * (drive && this.flipped ? -1 : 1);
      k = Math.abs(this.pilotOut);
    } else {
      dir = this.powered && this.reversed ? -this.dir : this.dir;
      k = this.on ? 1 : this.powered ? this.powerLevel : 1;
    }
    const ds = this.drive?.speed ?? 1;
    const dtq = this.drive?.torque ?? 1;
    const sig = `${run}:${dir}:${this.speed}:${this.torque}:${k}:${ds}:${dtq}`;
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    const torque = this.cfg.torque * this.torque * dtq;
    this.joint.setMotorMaxForce(torque);
    // target velocity is the rotor relative to the housing; by default rotors turn
    // clockwise, so wheels drive the way the motor faces
    if (run) this.joint.configureMotorVelocity(-this.cfg.speed * this.speed * ds * k * dir * (this.flipped ? -1 : 1), torque * 0.6);
    else this.joint.configureMotorVelocity(0, 0.02);
    this.rotor.body.wakeUp();
    this.housing.body.wakeUp();
  }

  activate(): void {
    // (taken back from the pilot: it's its own again)
    if (this.pilotOut !== null) {
      this.pilotOut = null;
      this.pilotT = 0;
    }
    toggleRun(this, this.running(), this.powered);
    this.game.sound.click(this.housing.x, this.running() ? 1.0 : 0.7);
    this.apply();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  preStep(): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    this.apply();
    if (!this.running()) return;
    // the hum rises with the rotor's speed
    const w = Math.min(2, Math.abs(this.rotor.av - this.housing.av) / this.cfg.speed);
    this.game.sound.hold(this, 'machine/motor_loop', 0.12 + Math.min(1, w) * 0.2, this.housing.x, 0.6 + w * 0.6);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running() ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      {
        label: 'Reverse', checked: this.dir === -1, action: () => {
          this.dir = this.dir === 1 ? -1 : 1;
          this.apply();
        },
      },
      ...MOTOR_SPEEDS.map((s) => ({
        label: `Speed ${s * 100}%`, checked: this.speed === s, action: () => {
          this.speed = s;
          this.apply();
        },
      })),
      ...MOTOR_TORQUES.map((s) => ({
        label: `Torque ${Math.round(this.cfg.torque * s)} N·m`, checked: this.torque === s, action: () => {
          this.torque = s;
          this.apply();
        },
      })),
      jobAction(this),
    ];
  }

  /** Edit motor… (see Controls): its speed and its torque, anywhere from none to four times its own. */
  editor(): ValueEditor {
    return {
      label: 'Edit motor…',
      title: `Edit ${this.label.toLowerCase()}`,
      fields: [
        settingField('speed', 'Speed', () => this.speed, (v) => (this.speed = v)),
        settingField('torque', `Torque (of ${this.cfg.torque} N·m)`, () => this.torque, (v) => (this.torque = v)),
      ],
      reset: () => {
        this.speed = 1;
        this.torque = 1;
      },
      alive: () => !this.destroyed,
    };
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, dir: this.dir, speed: this.speed, torque: this.torque, ...pilotState(this) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.dir = x.dir === -1 ? -1 : 1;
    this.speed = setting(x.speed);
    // (saves from before the setting turn as hard as they did)
    this.torque = setting(x.torque);
    restorePilot(this, x);
    this.apply();
  }
}

import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { Entity } from '../world/Entity';
import { Prop, type PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import { PX } from '../engine/constants';
import { UNIT_QUAD } from '../engine/Renderer';
import { MAT, type PhysMaterial } from '../world/Materials';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

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

/** Powers everything wired to it while switched on. */
export class Battery extends Prop {
  on = true;
  private blinkT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  isPowerSource(): boolean {
    return this.on;
  }

  get chargesWater(): boolean {
    return this.on;
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
      this.blinkT = 0.9;
      const w = this.main.pixelToWorld(5, 1);
      this.game.particles.flash(w.x, w.y, PX * 2.5, 0x8dff8a, 0.25);
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
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

/**
 * How fast (m/s, along its push) a thruster stops pushing: it pushes less the
 * faster it already goes that way, as a propeller does, so on its own it tops out
 * near this rather than flying off ever faster, yet it still lifts a load.
 */
export const THRUST_TOP = 20;

/** The pushes a thruster can be set to, as shares of its own (the context menu's). */
export const THRUSTS = [0.25, 0.5, 1, 2, 4];

/**
 * Pushes along its facing while active or powered (backwards, powered through a
 * reversing switch set to reverse).
 */
export class Thruster extends Prop implements HandSwitched {
  on = false;
  heldOff = false;
  /** Its push (N) from standing still, at the usual setting. */
  force: number;
  /** Its push as a share of the usual (see THRUSTS). */
  thrust = 1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.force = force;
  }

  get running(): boolean {
    return (this.on || this.powered) && !this.heldOff;
  }

  activate(): void {
    toggleRun(this, this.running, this.powered);
    this.game.sound.click(this.main.x, 0.9);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
  }

  canRest(): boolean {
    return !this.running;
  }

  /** Pushing backwards: powered through a reversing switch set to reverse. */
  get backwards(): boolean {
    return this.powered && this.reversed;
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    if (!this.running) return;
    const p = this.main;
    if (p.frozen) return;
    const s = this.backwards ? -1 : 1;
    const f = p.localDir(p.flip * s, 0);
    const v = p.body.linvel();
    const push = this.force * this.thrust * Math.min(1, Math.max(0, 1 - (v.x * f.x + v.y * f.y) / THRUST_TOP));
    p.body.applyImpulse({ x: f.x * push * dt, y: f.y * push * dt }, true);
    const n = p.pixelToWorld(0, 5);
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
    const ps = this.game.particles;
    ps.emit(PK.Fire, n.x, n.y, {
      vx: ex * sp + (Math.random() - 0.5), vy: ey * sp + (Math.random() - 0.5),
      life: 0.12 + Math.random() * 0.1, size: 0.12, size1: 0.03, color: 0xbfe7ff, color1: 0xff7a2a, alpha: 0.9, alpha1: 0.2, gravity: 0, drag: 2,
    });
    if (Math.random() < 0.15) ps.smoke(n.x + ex * 0.3, n.y + ey * 0.3, 1, 0.15);
    this.game.sound.hold(this, 'machine/thruster_loop', 0.45, p.x);
  }

  frame(): void {
    if (!this.running || this.main.frozen) return;
    const n = this.main.pixelToWorld(0, 5);
    this.game.renderer.addLight(n.x, n.y, 1.8, 0.3 + Math.random() * 0.1, 0xffa860);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      // (named by the push, not by whether it's picked: a guest's pick is found by its name)
      ...THRUSTS.map((s) => ({ label: `Thrust ${Math.round(this.force * s)} N`, checked: this.thrust === s, action: () => (this.thrust = s) })),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, thrust: this.thrust };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    // (saves from before the setting push as hard as they did)
    this.thrust = THRUSTS.includes(x.thrust as number) ? (x.thrust as number) : 1;
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
export class Motor extends Entity implements HandSwitched {
  readonly housing: Part;
  readonly rotor: Part;
  private joint: RAPIER.RevoluteImpulseJoint;
  on = false;
  heldOff = false;
  dir: 1 | -1 = 1;
  /** Its speed as a share of its own (see MOTOR_SPEEDS). */
  speed = 1;
  /** Its torque as a share of its own (see MOTOR_TORQUES). */
  torque = 1;
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
  }

  private running(): boolean {
    return (this.on || this.powered) && !this.heldOff;
  }

  canRest(): boolean {
    return !this.running();
  }

  private apply(): void {
    const run = this.running();
    const dir = this.powered && this.reversed ? -this.dir : this.dir;
    const sig = `${run}:${dir}:${this.speed}:${this.torque}`;
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    const torque = this.cfg.torque * this.torque;
    this.joint.setMotorMaxForce(torque);
    // target velocity is the rotor relative to the housing; by default rotors turn
    // clockwise, so wheels drive the way the motor faces
    if (run) this.joint.configureMotorVelocity(-this.cfg.speed * this.speed * dir * (this.flipped ? -1 : 1), torque * 0.6);
    else this.joint.configureMotorVelocity(0, 0.02);
    this.rotor.body.wakeUp();
    this.housing.body.wakeUp();
  }

  activate(): void {
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
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, dir: this.dir, speed: this.speed, torque: this.torque };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.dir = x.dir === -1 ? -1 : 1;
    this.speed = MOTOR_SPEEDS.includes(x.speed as number) ? (x.speed as number) : 1;
    // (saves from before the setting turn as hard as they did)
    this.torque = MOTOR_TORQUES.includes(x.torque as number) ? (x.torque as number) : 1;
    this.apply();
  }
}

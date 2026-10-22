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
export class LightBulb extends Prop {
  private manual = false;
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
    this.manual = !this.manual;
    this.game.sound.click(this.main.x, 1.1);
    this.refresh();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.refresh();
  }

  private refresh(): void {
    const lit = this.manual || this.powered;
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
    return [{ label: this.manual ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected onDestroy(): void {
    this.game.renderer.scene.remove(this.glow);
    (this.glow.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------ thruster

/** Pushes along its facing while active or powered. */
export class Thruster extends Prop {
  on = false;
  force: number;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, force: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.force = force;
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, 0.9);
  }

  preStep(dt: number): void {
    if (!(this.on || this.powered)) return;
    const p = this.main;
    if (p.frozen) return;
    const f = p.localDir(p.flip, 0);
    p.body.applyImpulse({ x: f.x * this.force * dt, y: f.y * this.force * dt }, true);
    const n = p.pixelToWorld(0, 5);
    const ps = this.game.particles;
    ps.emit(PK.Fire, n.x, n.y, {
      vx: -f.x * (5 + Math.random() * 3) + (Math.random() - 0.5), vy: -f.y * (5 + Math.random() * 3) + (Math.random() - 0.5),
      life: 0.12 + Math.random() * 0.1, size: 0.12, size1: 0.03, color: 0xbfe7ff, color1: 0xff7a2a, alpha: 0.9, alpha1: 0.2, gravity: 0, drag: 2,
    });
    if (Math.random() < 0.15) ps.smoke(n.x - f.x * 0.3, n.y - f.y * 0.3, 1, 0.15);
    this.game.sound.hold(this, 'machine/thruster_loop', 0.45, p.x);
  }

  frame(): void {
    if (!(this.on || this.powered) || this.main.frozen) return;
    const n = this.main.pixelToWorld(0, 5);
    this.game.renderer.addLight(n.x, n.y, 1.8, 0.3 + Math.random() * 0.1, 0xffa860);
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() }];
  }
}

// ------------------------------------------------------------------ motor

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

/** A housing with a powered rotor. Weld things to the rotor to spin them. */
export class Motor extends Entity {
  readonly housing: Part;
  readonly rotor: Part;
  private joint: RAPIER.RevoluteImpulseJoint;
  on = false;
  dir: 1 | -1 = 1;
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
    return this.on || this.powered;
  }

  private apply(): void {
    const run = this.running();
    const sig = `${run}:${this.dir}`;
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    // target velocity is the rotor relative to the housing; by default rotors turn
    // clockwise, so wheels drive the way the motor faces
    if (run) this.joint.configureMotorVelocity(-this.cfg.speed * this.dir * (this.flipped ? -1 : 1), this.cfg.torque * 0.6);
    else this.joint.configureMotorVelocity(0, 0.02);
    this.rotor.body.wakeUp();
    this.housing.body.wakeUp();
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.housing.x, this.on ? 1.0 : 0.7);
    this.apply();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.apply();
  }

  preStep(dt: number): void {
    this.apply();
    if (!this.running()) return;
    // the hum rises with the rotor's speed
    const w = Math.min(1, Math.abs(this.rotor.av - this.housing.av) / this.cfg.speed);
    this.game.sound.hold(this, 'machine/motor_loop', 0.12 + w * 0.2, this.housing.x, 0.6 + w * 0.6);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.on ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      {
        label: 'Reverse', action: () => {
          this.dir = this.dir === 1 ? -1 : 1;
          this.apply();
        },
      },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, dir: this.dir };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.dir = x.dir === -1 ? -1 : 1;
    this.apply();
  }
}

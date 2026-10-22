import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Entity } from '../world/Entity';
import { Prop, type PropConfig } from './Prop';
import { artRect } from './Item';
import { MAT } from '../world/Materials';
import type { PixelArt } from '../art/PixelArt';
import type { GateKind } from '../art/machines';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Connection, WireRole } from '../systems/Connections';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** Wires attached to the left half of the sprite are inputs, the right half outputs. */
function sideRole(e: Entity, c: Connection): WireRole {
  const mine = c.a.entity === e ? { p: c.a, l: c.la } : { p: c.b!, l: c.lb };
  return mine.l.x * mine.p.flip < 0 ? 'in' : 'out';
}

// ------------------------------------------------------------------ switch

/** A lever switch: power only passes through it while it is on. */
export class Switch extends Prop {
  on = false;
  private artOn: () => PixelArt;
  private artOff: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, artOn: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.artOff = cfg.art;
    this.artOn = artOn;
  }

  conducts(): boolean {
    return this.on;
  }

  activate(): void {
    this.set(!this.on);
  }

  /** A pulse flips the lever too, so buttons can toggle circuits. */
  onPulse(): void {
    this.set(!this.on);
  }

  private set(on: boolean): void {
    this.on = on;
    this.main.setArt(on ? this.artOn() : this.artOff());
    this.game.sound.click(this.main.x, on ? 1.15 : 0.85);
    this.game.connections.recomputePower();
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (!!x.on !== this.on) this.set(!!x.on);
  }
}

// ------------------------------------------------------------------ sensor

const SENSOR_RAY = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/**
 * A tripwire: watches along its facing and, while anything is in the beam, powers
 * its wires (and sends a pulse when something first crosses it).
 */
export class MotionSensor extends Prop {
  enabled = true;
  range = 8;
  private detecting = false;
  private holdT = 0;
  private scanT = 0;
  private hitAt = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private artOn: () => PixelArt;
  private artOff: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, artOn: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.artOff = cfg.art;
    this.artOn = artOn;
  }

  wireRole(): WireRole {
    return 'out';
  }

  isPowerSource(): boolean {
    return this.detecting;
  }

  get active(): boolean {
    return this.detecting;
  }

  private eye(): { x: number; y: number; dx: number; dy: number } {
    const p = this.main;
    const o = p.pixelToWorld(11, 4.5);
    const d = p.localDir(p.flip, 0);
    return { x: o.x + d.x * PX, y: o.y + d.y * PX, dx: d.x, dy: d.y };
  }

  preStep(dt: number): void {
    this.scanT -= dt;
    this.holdT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.03;
    let seen = false;
    if (this.enabled) {
      const e = this.eye();
      this.ray.origin = { x: e.x, y: e.y };
      this.ray.dir = { x: e.dx, y: e.dy };
      const hit = this.game.physics.world.castRay(this.ray, this.range, true, undefined, SENSOR_RAY, undefined, this.main.body);
      this.hitAt = hit ? hit.timeOfImpact : this.range;
      seen = !!hit && !!this.game.physics.partOf(hit.collider);
    }
    if (seen) this.holdT = 0.2;
    const now = seen || (this.detecting && this.holdT > 0);
    if (now === this.detecting) return;
    this.detecting = now;
    this.main.setArt(now ? this.artOn() : this.artOff());
    this.game.connections.recomputePower();
    if (now) {
      this.game.sound.button(this.main.x);
      this.game.connections.pulse(this, true);
    }
  }

  frame(): void {
    if (!this.enabled) return;
    const e = this.eye();
    const len = this.hitAt;
    // a faint dashed beam, brighter while tripped
    const col = this.detecting ? 0xff5040 : 0x8a2a22;
    this.game.projectiles.drawBeam(e.x, e.y, e.x + e.dx * len, e.y + e.dy * len, PX, col, 0, PX * 4);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.enabled ? 'Disable' : 'Enable', hint: 'F', action: () => this.activate() }];
    for (const r of [2, 4, 8, 16]) acts.push({ label: `Range ${r} m`, checked: this.range === r, action: () => (this.range = r) });
    return acts;
  }

  activate(): void {
    this.enabled = !this.enabled;
    this.game.sound.click(this.main.x, this.enabled ? 1.1 : 0.8);
  }

  protected serializeExtra(): Record<string, unknown> {
    return { enabled: this.enabled, range: this.range };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.enabled = x.enabled !== false;
    if (typeof x.range === 'number') this.range = x.range;
  }
}

// ------------------------------------------------------------------ timer

/**
 * Ticks while switched on or while its input (left) is powered: every interval it
 * pulses its output (right) and powers it for a moment.
 */
export class Timer extends Prop {
  on = false;
  interval = 1;
  private t = 0;
  private blinkT = 0;
  private artBlink: () => PixelArt;
  private artIdle: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, artBlink: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.artIdle = cfg.art;
    this.artBlink = artBlink;
  }

  wireRole(c: Connection): WireRole {
    return sideRole(this, c);
  }

  isPowerSource(): boolean {
    return this.blinkT > 0;
  }

  /** A pulse on the input starts or stops it. */
  onPulse(): void {
    this.activate();
  }

  private running(): boolean {
    if (this.on) return true;
    const C = this.game.connections;
    return C.wiresOf(this).some(({ c }) => this.wireRole(c) === 'in' && C.inputLive(c));
  }

  preStep(dt: number): void {
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.main.setArt(this.artIdle());
        this.game.connections.recomputePower();
      }
    }
    if (!this.running()) {
      this.t = 0;
      return;
    }
    this.t += dt;
    if (this.t < this.interval) return;
    this.t -= this.interval;
    this.blinkT = Math.min(0.15, this.interval * 0.4);
    this.main.setArt(this.artBlink());
    this.game.sound.click(this.main.x, 1.6);
    this.game.connections.recomputePower();
    this.game.connections.pulse(this, true);
  }

  activate(): void {
    this.on = !this.on;
    this.t = 0;
    this.game.sound.click(this.main.x, this.on ? 1.2 : 0.8);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.on ? 'Stop' : 'Start', hint: 'F', action: () => this.activate() }];
    for (const s of [0.25, 0.5, 1, 2, 5]) acts.push({ label: `Every ${s} s`, checked: this.interval === s, action: () => (this.interval = s) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, interval: this.interval };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    if (typeof x.interval === 'number') this.interval = x.interval;
  }
}

// ------------------------------------------------------------------ logic gates

/**
 * AND / OR / XOR / NOT. Inputs are wires on the left half, the output is the right
 * half. The output powers its wires while true and pulses them when it turns true;
 * pulses arriving at an input pass through when the gate allows it.
 */
export class LogicGate extends Prop {
  readonly kind: GateKind;
  out = false;
  private art: (out: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: GateKind, art: (out: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    this.art = art;
    this.usesPower = true;
    // NOT with nothing on its input is already true
    this.out = this.evaluate(0, 0);
    if (this.out) this.main.setArt(art(true));
  }

  wireRole(c: Connection): WireRole {
    return sideRole(this, c);
  }

  isPowerSource(): boolean {
    return this.out;
  }

  private inputs(): { n: number; high: number } {
    const C = this.game.connections;
    let n = 0;
    let high = 0;
    for (const { c } of C.wiresOf(this)) {
      if (this.wireRole(c) !== 'in') continue;
      n++;
      if (C.inputLive(c)) high++;
    }
    return { n, high };
  }

  private evaluate(n: number, high: number): boolean {
    switch (this.kind) {
      case 'and': return n > 0 && high === n;
      case 'or': return high > 0;
      case 'xor': return high % 2 === 1;
      case 'not': return high === 0;
    }
  }

  preStep(): void {
    const { n, high } = this.inputs();
    const out = this.evaluate(n, high);
    if (out === this.out) return;
    this.out = out;
    this.main.setArt(this.art(out));
    this.game.connections.recomputePower();
    if (out) this.game.connections.pulse(this, true);
  }

  onPulse(c: Connection): void {
    if (this.wireRole(c) !== 'in') return;
    const { n, high } = this.inputs();
    // the pulsed input counts as high for this instant
    const others = high - (this.game.connections.inputLive(c) ? 1 : 0);
    const pass = this.kind === 'or' || (this.kind === 'and' && others === n - 1) || (this.kind === 'xor' && others === 0);
    if (pass) this.game.connections.pulse(this);
  }
}

// ------------------------------------------------------------------ piston

export interface PistonConfig {
  base: () => PixelArt;
  rod: () => PixelArt;
  /** Stroke length (m). */
  stroke: number;
  /** Maximum push (N). */
  force: number;
}

/** A cylinder whose rod pushes out while on or powered. Weld things to its plate. */
export class Piston extends Entity {
  readonly base: Part;
  readonly rod: Part;
  on = false;
  private joint: RAPIER.PrismaticImpulseJoint;
  private cfg: PistonConfig;
  private applied = '';

  constructor(game: Game, def: ItemDef, cfg: PistonConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.cfg = cfg;
    this.activatable = true;
    this.usesPower = true;
    this.attachIgnoresBody = true;
    const f = this.flipped ? -1 : 1;
    const ang = opts.angle ?? 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    // retracted: the rod sits inside the cylinder with its plate at the open end
    const off = 6 * PX * f;
    this.base = this.addPart({ name: 'Cylinder', art: cfg.base(), material: MAT.metal, x, y, angle: ang, density: 140, textureKey: def.id + ':b', layer: 2 });
    this.rod = this.addPart({
      name: 'Rod', art: cfg.rod(), material: MAT.metal, x: x + off * c, y: y + off * s, angle: ang, density: 120, textureKey: def.id + ':r', layer: 0,
      shapes: [artRect(44, 14, 0, 5, 37, 4), artRect(44, 14, 37, 0, 7, 14)],
    });
    const data = RAPIER.JointData.prismatic({ x: off, y: 0 }, { x: 0, y: 0 }, { x: f, y: 0 });
    data.limitsEnabled = true;
    data.limits = [0, cfg.stroke];
    this.joint = this.addJoint(data, this.base, this.rod) as RAPIER.PrismaticImpulseJoint;
    this.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.joint.setMotorMaxForce(cfg.force);
    this.apply();
  }

  get extended(): boolean {
    return this.on || this.powered;
  }

  /** Current extension (m). */
  get extension(): number {
    const b = this.base.localToWorld(6 * PX * (this.flipped ? -1 : 1), 0);
    const d = this.base.localDir(this.flipped ? -1 : 1, 0);
    return (this.rod.x - b.x) * d.x + (this.rod.y - b.y) * d.y;
  }

  private apply(): void {
    const sig = String(this.extended);
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    this.joint.configureMotorPosition(this.extended ? this.cfg.stroke : 0, this.cfg.force * 4, this.cfg.force * 0.6);
    this.base.body.wakeUp();
    this.rod.body.wakeUp();
    this.game.sound.play('machine/switch', { gain: 0.35, rate: this.extended ? 0.7 : 0.6, x: this.base.x });
  }

  preStep(): void {
    this.apply();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.apply();
  }

  activate(): void {
    this.on = !this.on;
    this.apply();
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Retract' : 'Extend', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.apply();
  }
}

import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Entity } from '../world/Entity';
import { Prop, type PropConfig } from './Prop';
import { artRect } from './Item';
import { toggleRun, type HandSwitched } from './Machines';
import { MAT } from '../world/Materials';
import { stir } from '../systems/Settle';
import type { PixelArt } from '../art/PixelArt';
import type { GateKind } from '../art/machines';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Connection, WireRole } from '../systems/Connections';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** Wires attached to the left half of the sprite are inputs, the right half outputs. */
export function sideRole(e: Entity, c: Connection): WireRole {
  const mine = c.a.entity === e ? { p: c.a, l: c.la } : { p: c.b!, l: c.lb };
  return mine.l.x * mine.p.flip < 0 ? 'in' : 'out';
}

// ------------------------------------------------------------------ switch

/**
 * A lever switch: power only passes through it while it is on; in a circuit with
 * no battery (or other power), it powers the circuit itself while on.
 */
export class Switch extends Prop {
  on = false;
  private artOn: () => PixelArt;
  private artOff: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, artOn: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    // (it only lets power through: a pulse from powered logic, a timer's tick, flips it all the same)
    this.activatable = true;
    this.artOff = cfg.art;
    this.artOn = artOn;
  }

  conducts(): boolean {
    return this.on;
  }

  /** With no battery (or other power) in its circuit, it powers what it's wired to while on. */
  powersAlone(): boolean {
    return this.on;
  }

  activate(): void {
    this.set(!this.on);
  }

  /** A pulse flips the lever too (a button's, a timer's tick, a gate turning true), so circuits can be toggled. */
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
    // (quietly: a copy or a load isn't the lever being thrown; its wires come after)
    this.on = !!x.on;
    this.main.setArt(this.on ? this.artOn() : this.artOff());
  }
}

// ------------------------------------------------------------------ reversing switch

/** Where a reversing switch's lever is. */
export type LeverPos = 'on' | 'off' | 'reverse';
/** The way F (or a pulse) steps its lever along: off, on, reverse, and off again. */
export const LEVER_STEPS: LeverPos[] = ['off', 'on', 'reverse'];
const LEVER_LABEL: Record<LeverPos, string> = { on: 'On', off: 'Off', reverse: 'Reverse' };

/**
 * A three-way lever, wired like the Switch: on, power passes through it (with no
 * battery in its circuit, it powers the circuit itself); off, it doesn't; in
 * reverse, it does, turned round, so what that power runs runs backwards: motors
 * spin the other way, thrusters push backwards, pistons pull in.
 */
export class ReversingSwitch extends Prop {
  pos: LeverPos = 'off';
  private art: (pos: LeverPos) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (pos: LeverPos) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
  }

  conducts(): boolean {
    return this.pos !== 'off';
  }

  /** With no battery (or other power) in its circuit, it powers what it's wired to while on or in reverse. */
  powersAlone(): boolean {
    return this.pos !== 'off';
  }

  flips(): boolean {
    return this.pos === 'reverse';
  }

  private get nextPos(): LeverPos {
    return LEVER_STEPS[(LEVER_STEPS.indexOf(this.pos) + 1) % LEVER_STEPS.length];
  }

  activate(): void {
    this.set(this.nextPos);
  }

  /** A pulse steps the lever along too (a button's, a timer's tick). */
  onPulse(): void {
    this.set(this.nextPos);
  }

  set(pos: LeverPos): void {
    if (pos === this.pos) return;
    this.pos = pos;
    this.main.setArt(this.art(pos));
    this.game.sound.click(this.main.x, pos === 'on' ? 1.15 : pos === 'off' ? 0.85 : 0.65);
    this.game.connections.recomputePower();
  }

  contextActions(): ContextAction[] {
    const next = this.nextPos;
    return (['on', 'off', 'reverse'] as LeverPos[]).map((p) => ({
      label: LEVER_LABEL[p], checked: this.pos === p, hint: p === next ? 'F' : undefined, action: () => this.set(p),
    }));
  }

  protected serializeExtra(): Record<string, unknown> {
    return { pos: this.pos };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    // (quietly, as the Switch's)
    this.pos = LEVER_STEPS.includes(x.pos as LeverPos) ? (x.pos as LeverPos) : 'off';
    this.main.setArt(this.art(this.pos));
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
export class Timer extends Prop implements HandSwitched {
  on = false;
  heldOff = false;
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

  /** Its input (left side) is powered. */
  private fed(): boolean {
    const C = this.game.connections;
    return C.wiresOf(this).some(({ c }) => this.wireRole(c) === 'in' && C.live(c));
  }

  get running(): boolean {
    return this.runs(this.fed());
  }

  private runs(fed: boolean): boolean {
    return (this.on || fed) && !this.heldOff;
  }

  preStep(dt: number): void {
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.main.setArt(this.artIdle());
        this.game.connections.recomputePower();
      }
    }
    const fed = this.fed();
    // (held off only while its input is powered: that power gone, the input has its say again)
    if (this.heldOff && !fed) this.heldOff = false;
    if (!this.runs(fed)) {
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
    const fed = this.fed();
    toggleRun(this, this.runs(fed), fed);
    this.t = 0;
    this.game.sound.click(this.main.x, this.running ? 1.2 : 0.8);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.running ? 'Stop' : 'Start', hint: 'F', action: () => this.activate() }];
    for (const s of [0.25, 0.5, 1, 2, 5]) {
      acts.push({
        label: `Every ${s} s`, checked: this.interval === s, action: () => {
          this.interval = s;
          // (what it had counted toward a longer interval mustn't come out as a burst of pulses)
          this.t = Math.min(this.t, s);
        },
      });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, interval: this.interval };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
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
      if (C.live(c)) high++;
    }
    return { n, high };
  }

  private evaluate(n: number, high: number): boolean {
    switch (this.kind) {
      case 'and': return n > 0 && high === n;
      case 'or': return high > 0;
      // (exactly one, as it says: with three inputs on, it's off)
      case 'xor': return high === 1;
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
    const others = high - (this.game.connections.live(c) ? 1 : 0);
    const pass = this.kind === 'or' || (this.kind === 'and' && others === n - 1) || (this.kind === 'xor' && others === 0);
    if (pass) this.game.connections.pulse(this);
  }

  protected serializeExtra(): Record<string, unknown> {
    return { out: this.out };
  }

  /** A copy (a load, an undo) comes in with its output as it was, so what it powers doesn't see power newly arrive. */
  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.out !== 'boolean' || x.out === this.out) return;
    this.out = x.out;
    this.main.setArt(this.art(this.out));
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

/** Rapier's own joint calls, for what its spring joints don't offer (limits, a motor's target and strength). */
interface RawJoints {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
  jointConfigureMotorPosition(handle: number, axis: number, target: number, stiffness: number, damping: number): void;
  jointSetMotorMaxForce(handle: number, axis: number, force: number): void;
}
const rawJoints = (j: RAPIER.ImpulseJoint) => (j as unknown as { rawSet: RawJoints }).rawSet;

/**
 * How far (m) a piston's rod gives either way across its stroke, and how stiffly
 * (N/m per N of its push): pistons set a little out of line, lifting one thing
 * together, can't all slide straight along their own lines, and a rod that
 * couldn't give at all jammed (a few degrees out, two of them stuck a fifth of
 * the way up). Too little to see under an ordinary load.
 */
const ROD_PLAY = 0.08;
const ROD_HOLD = 25;
/**
 * The rod's joints measure its distance from points this far (m) off on the
 * cylinder, behind it and to its side: that far off, each distance changes only
 * along its own line (the slide, and the play across it).
 */
const FAR = 100;

/**
 * A cylinder whose rod pushes out while on or powered (powered through a
 * reversing switch set to reverse, it pulls in). Weld things to its plate.
 */
export class Piston extends Entity implements HandSwitched {
  readonly base: Part;
  readonly rod: Part;
  on = false;
  heldOff = false;
  /** Drives the rod along the cylinder (and keeps it from turning). */
  private joint: RAPIER.ImpulseJoint;
  /** Holds the rod in line with the cylinder, giving a little (see ROD_PLAY). */
  private side: RAPIER.ImpulseJoint;
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
    // not a prismatic joint, which can't give across its line at all: two spring
    // joints from far-off points, one the rod's distance from behind (the slide,
    // between its limits, driven by the motor; it keeps the rod from turning too),
    // one from its side (held in line by a stiff spring, within ROD_PLAY)
    const { LinX, AngX } = RAPIER.JointAxis;
    this.joint = this.addJoint(RAPIER.JointData.spring(FAR, 0, 0, { x: off - FAR * f, y: 0 }, { x: 0, y: 0 }), this.base, this.rod);
    const raw = rawJoints(this.joint);
    raw.jointSetLimits(this.joint.handle, LinX, FAR, FAR + cfg.stroke);
    raw.jointSetLimits(this.joint.handle, AngX, 0, 0);
    raw.jointSetMotorMaxForce(this.joint.handle, LinX, cfg.force);
    this.side = this.addJoint(RAPIER.JointData.spring(FAR, 0, 0, { x: off, y: FAR }, { x: 0, y: 0 }), this.base, this.rod);
    raw.jointSetLimits(this.side.handle, LinX, FAR - ROD_PLAY, FAR + ROD_PLAY);
    raw.jointConfigureMotorPosition(this.side.handle, LinX, FAR, cfg.force * ROD_HOLD, cfg.force * 0.6);
    raw.jointSetMotorMaxForce(this.side.handle, LinX, cfg.force);
    this.apply();
  }

  /** Its power drives it: powered, but not turned round by a reversing switch (which pulls it in). */
  private get pushed(): boolean {
    return this.powered && !this.reversed;
  }

  get extended(): boolean {
    return (this.on || this.pushed) && !this.heldOff;
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
    rawJoints(this.joint).jointConfigureMotorPosition(this.joint.handle, RAPIER.JointAxis.LinX, FAR + (this.extended ? this.cfg.stroke : 0), this.cfg.force * 4, this.cfg.force * 0.6);
    // (stirred, not just woken: a lift left resting up top was put to sleep with
    // what it holds, and woken alone it still counted as at rest, so a rest check
    // in the next moment could put it back to sleep up there for good)
    stir(this.game, this);
    this.game.sound.play('machine/switch', { gain: 0.35, rate: this.extended ? 0.7 : 0.6, x: this.base.x });
  }

  preStep(): void {
    // (held off only while its power pushes it: turned round, or gone, the circuit has its say again)
    if (this.heldOff && !this.pushed) this.heldOff = false;
    this.apply();
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  activate(): void {
    toggleRun(this, this.extended, this.pushed);
    this.apply();
  }

  contextActions(): ContextAction[] {
    return [{ label: this.extended ? 'Retract' : 'Extend', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.apply();
  }
}

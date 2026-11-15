import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Machine } from './Machine';
import { Prop, type PropConfig } from './Prop';
import { Motor } from './Machines';
import { artRect } from './Item';
import { rawJoints } from './Devices';
import { MAT } from '../world/Materials';
import * as V from '../art/vehicles2';
import type { PixelArt } from '../art/PixelArt';
import { PK } from '../systems/Particles';
import type { Booster, Commanded, PilotCommand } from '../systems/Piloting';
import type { Part } from '../world/Part';
import type { Connection } from '../systems/Connections';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Parts for home-made vehicles (0.4.0): an engine and its gearbox, a suspension strut, a
// nitro bottle, a tow hitch, a headlight and a horn.

/** The engine's gears: each a share of a wheel motor's own speed it lets the wheels reach, and of its torque it gives them. */
export const GEARS = [
  { speed: 0.8, torque: 3.5 },
  { speed: 1.4, torque: 2.4 },
  { speed: 2.2, torque: 1.6 },
  { speed: 3.2, torque: 1.15 },
  { speed: 4.5, torque: 0.85 },
];
/** The engine's revs: idling, where it changes up and down (rpm), and the most. */
const IDLE = 900;
const SHIFT_UP = 5200;
const SHIFT_DOWN = 2000;
const REDLINE = 6500;
/** Fuel it burns (kg/s) at full throttle, and idling. */
const ENGINE_BURN = 1 / 300;
const ENGINE_IDLE = 0.08;
/** Nitro: how much harder and faster it drives the wheels. */
const NITRO_K = 1.6;

/** A wheel motor's turn rate (rad/s) against its housing. */
function spinOf(m: Motor): number {
  return Math.abs(m.rotor.body.angvel() - m.housing.body.angvel());
}

/**
 * An engine: built into a vehicle with wheel motors, it drives them through a five-speed
 * gearbox that changes up and down by itself: low gears pull hard and slow, top gear runs
 * fast. It burns fuel from the build's tanks (with none, it runs free, as engines do), its
 * revs heard climbing through each gear. Off (F), the wheels run on their own power again.
 */
export class CarEngine extends Prop implements Booster {
  on = true;
  gear = 0;
  rpm = 0;
  boosting = false;
  /** Running (fuel to burn, switched on, whole). */
  running = false;
  private motors: Motor[] = [];
  private bottles: NitroBottle[] = [];
  private lookT = 0;
  private shiftT = 0;
  private smokeT = 0;
  private art: (k: number) => PixelArt;
  private artKey = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** On nitro: the boost key held with a nitro bottle in its build burning. */
  get nitro(): boolean {
    return this.bottles.some((b) => b.burning && !b.destroyed);
  }

  /** The wheel motors it drives: in its build. */
  driven(): Motor[] {
    return this.motors;
  }

  /** How hard it's being asked to drive (0 to 1): the most of its motors'. */
  private demand(): number {
    let d = 0;
    for (const m of this.motors) {
      if (m.destroyed) continue;
      if (m.pilotOut !== null) d = Math.max(d, Math.abs(m.pilotOut));
      else if ((m.on || m.powered) && !m.heldOff) d = Math.max(d, m.on ? 1 : m.powerLevel);
    }
    return d;
  }

  preStep(dt: number): void {
    const g = this.game;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.5;
      const build = g.connections.assemblyOf([this]);
      const next = build.filter((e): e is Motor => e instanceof Motor && !e.destroyed);
      for (const m of this.motors) if (!next.includes(m)) m.drive = null;
      this.motors = next;
      this.bottles = build.filter((e): e is NitroBottle => e instanceof NitroBottle && !e.destroyed);
    }
    const d = this.demand();
    const nitro = this.nitro;
    const burn = ENGINE_BURN * (ENGINE_IDLE + (1 - ENGINE_IDLE) * d) * (nitro ? 1.5 : 1) * dt;
    this.running = this.on && this.works && g.fuel.draw(this, burn) > 0.5;
    if (!this.running) {
      for (const m of this.motors) m.drive = null;
      this.rpm = Math.max(0, this.rpm - 4000 * dt);
      this.show(0);
      return;
    }
    // its revs: the fastest driven wheel's, through the gear it's in
    let w = 0;
    for (const m of this.motors) if (!m.destroyed) w = Math.max(w, spinOf(m) / Math.max(0.25, m.speed));
    const share = w / (14 * GEARS[this.gear].speed);
    const want = IDLE + clamp(share, 0, 1.2) * (REDLINE - IDLE) * 0.85 + (d > 0.05 && share < 0.15 ? 1500 * d : 0);
    this.rpm += (Math.min(REDLINE, want) - this.rpm) * Math.min(1, dt * 8);
    // the gearbox: up near the top of a gear, down near its bottom, and not again straight away
    this.shiftT -= dt;
    if (this.shiftT <= 0) {
      if (this.rpm > SHIFT_UP && this.gear < GEARS.length - 1 && d > 0.05) this.shift(1);
      else if (this.rpm < SHIFT_DOWN && this.gear > 0) this.shift(-1);
    }
    const n = nitro ? NITRO_K : 1;
    const gear = GEARS[this.gear];
    for (const m of this.motors) m.drive = { speed: gear.speed * n, torque: gear.torque * n };
    this.show(1);
  }

  private shift(by: number): void {
    this.gear += by;
    this.shiftT = 0.45;
    // (the revs drop as it changes up, rise as it changes down)
    this.rpm *= by > 0 ? GEARS[this.gear - 1].speed / GEARS[this.gear].speed : GEARS[this.gear + 1].speed / GEARS[this.gear].speed;
    this.game.sound.click(this.main.x, 0.6);
  }

  private show(k: number): void {
    if (k === this.artKey || this.destroyed) return;
    this.artKey = k;
    this.main.setArt(this.art(k));
  }

  frame(dt: number): void {
    if (!this.running) return;
    const p = this.main;
    const r = this.rpm / REDLINE;
    this.game.sound.hold(this, 'machine/motor_loop', 0.16 + r * 0.3, p.x, 0.45 + r * 1.3);
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12 - r * 0.07;
      const ex = p.pixelToWorld(21, 9);
      this.game.particles.smoke(ex.x, ex.y, 1, 0.1 + r * 0.1, false);
      if (this.nitro) {
        const d = p.localDir(p.flip, 0);
        this.game.particles.emit(PK.Fire, ex.x, ex.y, { vx: d.x * 6, vy: d.y * 6, life: 0.15, size: 0.18, size1: 0.04, color: 0xb8f0ff, color1: 0x3a7aff, alpha: 1, alpha1: 0, gravity: 0, drag: 3 });
      }
    }
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.1 : 0.8);
  }

  protected onDestroy(): void {
    for (const m of this.motors) m.drive = null;
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() },
      { label: this.running ? `Gear ${this.gear + 1}, ${Math.round(this.rpm / 100) * 100} rpm` : 'Not running', disabled: true, action: () => {} },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
  }
}

/** A nitro bottle's charge (s of boost). */
export const NITRO_S = 6;

/**
 * A nitro bottle: built into a vehicle with an engine, the boost key (;) burns it to drive
 * the wheels harder and faster (and a thruster or jet in the build harder) for a few
 * seconds; refilled from its menu.
 */
export class NitroBottle extends Prop implements Booster {
  boosting = false;
  left = NITRO_S;
  private art: (k: number) => PixelArt;
  private shown = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** Burning its nitro this step (the boost key held, some left). */
  burning = false;

  preStep(dt: number): void {
    this.burning = this.boosting && this.left > 0 && this.works;
    if (this.burning) {
      this.left = Math.max(0, this.left - dt);
      this.game.sound.hold(this, 'machine/air_release', 0.25, this.main.x, 1.4);
    }
    const k = Math.ceil((this.left / NITRO_S) * 4);
    if (k !== this.shown && !this.destroyed) {
      this.shown = k;
      this.main.setArt(this.art(k));
    }
  }

  /** Activate: a burst of boost while held isn't a thing by hand; refills it. */
  activate(): void {
    this.left = NITRO_S;
    this.game.sound.play('machine/air_release', { gain: 0.4, x: this.main.x, rate: 0.8 });
  }

  contextActions(): ContextAction[] {
    return [
      { label: `Nitro: ${Math.round((this.left / NITRO_S) * 100)}%`, disabled: true, action: () => {} },
      { label: 'Refill', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { left: this.left };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.left = typeof x.left === 'number' && Number.isFinite(x.left) ? clamp(x.left, 0, NITRO_S) : NITRO_S;
  }
}

/** How near (m) a tow hitch's ball must come to another's (or anything's) to hitch on. */
const HITCH_REACH = 0.35;

/**
 * A tow hitch: weld one on the back of a vehicle, another (or a hook, a ring) on what's to
 * be towed; brought together they hitch, pinned so the trailer swings behind. F, or its
 * menu, unhitches (and it won't hitch again for a moment).
 */
export class TowHitch extends Prop {
  pin: Connection | null = null;
  private coolT = 0;
  private lookT = 0;
  private art: (b: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (b: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** Where its ball is. */
  ball(): V2 {
    return this.main.pixelToWorld(12, 3.5);
  }

  get hitched(): boolean {
    return !!this.pin && this.game.connections.list.includes(this.pin);
  }

  preStep(dt: number): void {
    this.coolT -= dt;
    if (this.pin && !this.hitched) {
      this.pin = null;
      this.main.setArt(this.art(false));
    }
    if (this.hitched || this.coolT > 0) return;
    this.lookT -= dt;
    if (this.lookT > 0) return;
    this.lookT = 0.1;
    const me = this.ball();
    const mine = this.game.connections.assemblyOf([this]);
    for (const e of this.game.entities) {
      if (!(e instanceof TowHitch) || e === this || e.destroyed || e.hitched || e.coolT > 0 || mine.includes(e)) continue;
      const it = e.ball();
      if (Math.hypot(it.x - me.x, it.y - me.y) > HITCH_REACH) continue;
      this.hitch(e, { x: (me.x + it.x) / 2, y: (me.y + it.y) / 2 });
      return;
    }
  }

  private hitch(o: TowHitch, at: V2): void {
    const c = this.game.connections.create('pin', this.main, at, o.main, at);
    if (!c) return;
    this.pin = o.pin = c;
    this.main.setArt(this.art(true));
    o.main.setArt(this.art(true));
    this.game.sound.play('machine/car_door', { gain: 0.35, x: at.x, rate: 1.4 });
  }

  /** Unhitched (both ends). */
  unhitch(): void {
    const c = this.pin;
    if (c && this.game.connections.list.includes(c)) this.game.connections.remove(c);
    for (const e of this.game.entities) if (e instanceof TowHitch && e.pin === c) {
      e.pin = null;
      e.coolT = 1.5;
      e.main.setArt(this.art(false));
    }
    this.pin = null;
    this.coolT = 1.5;
    this.game.sound.click(this.main.x, 0.8);
  }

  activate(): void {
    if (this.hitched) this.unhitch();
  }

  contextActions(): ContextAction[] {
    return this.hitched ? [{ label: 'Unhitch', hint: 'F', action: () => this.unhitch() }] : [{ label: 'Bring another tow hitch to it to hitch on', disabled: true, action: () => {} }];
  }
}

/**
 * A headlight: lights the way it faces, on its own power or a battery's; the pilot's
 * lights key (,) switches every light in what's flown on and off, and F this one.
 */
export class Headlight extends Prop implements Commanded {
  on = false;
  private art: (b: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (b: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
    this.usesPower = true;
  }

  get lit(): boolean {
    return (this.on || this.powered) && this.works;
  }

  powerDraw(): number {
    return this.lit ? 40 : 0;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'lights') return false;
    this.activate();
    return true;
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.2 : 0.9);
    this.main.setArt(this.art(this.lit));
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    this.main.setArt(this.art(this.lit));
  }

  frame(): void {
    if (!this.lit) return;
    const p = this.main;
    const d = p.localDir(p.flip, 0);
    const lens = p.pixelToWorld(6, 5);
    // (a beam: a bright spot at the lens and pools of light down the way it faces)
    const r = this.game.renderer;
    r.addLight(lens.x, lens.y, 1.2, 0.8, 0xfff2c8);
    for (let i = 1; i <= 3; i++) r.addLight(lens.x + d.x * i * 2.2, lens.y + d.y * i * 2.2, 1.2 + i * 0.9, 0.5 - i * 0.1, 0xfff2c8);
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on === true;
    this.main.setArt(this.art(this.lit));
  }
}

/** A horn: the pilot's horn key (/), F, a pulse or power reaching it, and it honks. */
export class Horn extends Prop implements Commanded {
  private coolT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'horn') return false;
    this.activate();
    return true;
  }

  preStep(dt: number): void {
    this.coolT -= dt;
  }

  activate(): void {
    if (this.coolT > 0) return;
    this.coolT = 0.35;
    this.game.sound.play('machine/horn', { gain: 0.6, x: this.main.x, vary: 0.03 });
  }
}

/** A suspension strut's travel (m) and its spring and damper (per kg it carries). */
const STRUT = { travel: 0.22, stiff: 9000, damp: 700 };

/**
 * A suspension strut: weld its top to a vehicle and a wheel to its rod's eye; the rod rides
 * up and down on a spring and a damper, so the wheel follows the ground and the vehicle
 * rides over bumps instead of being thrown off them.
 */
export class SuspensionStrut extends Machine {
  readonly top: Part;
  readonly rod: Part;
  private joint: RAPIER.ImpulseJoint;
  private side: RAPIER.ImpulseJoint;
  /** How stiff it's set (a share of its own). */
  stiffness = 1;

  constructor(game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.attachIgnoresBody = true;
    const ang = opts.angle ?? 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const FAR = 50;
    const drop = 12 * PX;
    this.top = this.addPart({ name: 'Spring', art: V.strutTopArt(), material: MAT.metal, x, y, angle: ang, density: 160, textureKey: 'strut:t', layer: 2 });
    this.rod = this.addPart({
      name: 'Rod', art: V.strutRodArt(), material: MAT.metal, x: x + s * drop, y: y - c * drop, angle: ang, density: 140, textureKey: 'strut:r', layer: 1,
      shapes: [artRect(6, 16, 0, 10, 6, 6)],
    });
    // two spring joints from far-off points, as the piston has (see Piston): one along its
    // line (the ride, sprung and damped about the middle of its travel), one across it (held in line)
    const { LinX, AngX } = RAPIER.JointAxis;
    this.joint = this.addJoint(RAPIER.JointData.spring(FAR, 0, 0, { x: 0, y: FAR - drop }, { x: 0, y: 0 }), this.top, this.rod);
    const raw = rawJoints(this.joint);
    raw.jointSetLimits(this.joint.handle, LinX, FAR - STRUT.travel / 2, FAR + STRUT.travel / 2);
    raw.jointSetLimits(this.joint.handle, AngX, 0, 0);
    this.side = this.addJoint(RAPIER.JointData.spring(FAR, 0, 0, { x: FAR, y: -drop }, { x: 0, y: 0 }), this.top, this.rod);
    raw.jointSetLimits(this.side.handle, LinX, FAR - 0.01, FAR + 0.01);
    raw.jointConfigureMotorPosition(this.side.handle, LinX, FAR, 60000, 3000);
    raw.jointSetMotorMaxForce(this.side.handle, LinX, 60000);
    this.apply();
    this.sturdy();
  }

  get main(): Part {
    return this.top;
  }

  /** How far (m) the rod's pushed in from the middle of its travel (+: squashed). */
  get squash(): number {
    const d = this.top.localDir(0, -1);
    const a = this.top.localToWorld(0, -12 * PX);
    return -((this.rod.x - a.x) * d.x + (this.rod.y - a.y) * d.y);
  }

  private apply(): void {
    const raw = rawJoints(this.joint);
    raw.jointConfigureMotorPosition(this.joint.handle, RAPIER.JointAxis.LinX, 50, STRUT.stiff * this.stiffness, STRUT.damp * Math.sqrt(this.stiffness));
    raw.jointSetMotorMaxForce(this.joint.handle, RAPIER.JointAxis.LinX, STRUT.stiff * this.stiffness * STRUT.travel * 2);
  }

  canRest(): boolean {
    return true;
  }

  contextActions(): ContextAction[] {
    return [0.5, 1, 2, 4].map((k) => ({ label: ['Soft', 'Normal', 'Firm', 'Stiff'][[0.5, 1, 2, 4].indexOf(k)], checked: this.stiffness === k, action: () => {
      this.stiffness = k;
      this.apply();
    } }));
  }

  protected serializeExtra(): Record<string, unknown> {
    return { k: this.stiffness };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if ([0.5, 1, 2, 4].includes(x.k as number)) this.stiffness = x.k as number;
    this.apply();
  }
}

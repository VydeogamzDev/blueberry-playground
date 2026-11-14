import { RAPIER } from '../engine/Physics';
import { clamp, wrapAngle, type V2 } from '../engine/math';
import { Prop, type PropConfig } from './Prop';
import { toggleRun, type HandSwitched } from './Machines';
import { Human } from './Human';
import { placeInSeat, type SeatSpec } from './Car';
import { PK } from '../systems/Particles';
import { jobAction, pilotState, restorePilot, type Engine, type Job, type Steadier } from '../systems/Piloting';
import { GYRO_FRAMES, HOVER_NOZZLE, LEVER_STEPS, COCKPIT, gyroArt, hoverThrusterArt, keyTriggerArt, throttleLeverArt } from '../art/flight';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';
import type { ValueEditor } from '../tools/Controls';

// The flight parts (0.3.0): what builds are flown with (see systems/Piloting).

// ------------------------------------------------------------------ hover thruster

/** A hover thruster's push at full (N), the heights it holds (m), and how far down it feels for the ground. */
export const HOVER = { force: 2500, min: 0.5, max: 8, reach: 10 };

/**
 * Holds itself (and what it's built into) at a height over whatever is under it,
 * the ground or anything solid, pushing down as hard as that takes: several on a
 * build each hold their own corner, so it rides level. Switched on, it holds the
 * height it was at then; flown (see systems/Piloting), the throttle sets the
 * height (none: it lets down). It eases itself upright as well.
 */
export class HoverThruster extends Prop implements HandSwitched, Engine {
  on = false;
  heldOff = false;
  job: Job = 'auto';
  pilotOut: number | null = null;
  pilotT = 0;
  readonly hovers = true;
  /** The height it holds on its own (switched on: as high as it was then). */
  hold = 1.5;
  /** How hard it pushes now (0 to 1). */
  push = 0;
  private sum = 0;
  /** What it's built into, not felt for as the ground under it (looked over now and then). */
  private mine = new Set<Entity>();
  private mineAt = -Infinity;
  /** Its share of holding that up (kg): the build's weight over the hover thrusters in it. */
  private share = 10;
  private shownOn = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
  }

  get running(): boolean {
    if (this.pilotOut !== null) return this.pilotOut > 0 && this.works;
    return (this.on || this.powered) && !this.heldOff && this.works;
  }

  canRest(): boolean {
    return !this.running;
  }

  activate(): void {
    if (this.pilotOut !== null) {
      this.pilotOut = null;
      this.pilotT = 0;
    }
    const was = this.running;
    toggleRun(this, was, this.powered);
    if (!was && this.running) this.hold = clamp(this.height() ?? HOVER.min + 1, HOVER.min, HOVER.max);
    this.game.sound.click(this.main.x, 0.9);
  }

  setPowered(on: boolean): void {
    const was = this.running;
    super.setPowered(on);
    if (!on) this.heldOff = false;
    if (!was && this.running && this.pilotOut === null) this.hold = clamp(this.height() ?? HOVER.min + 1, HOVER.min, HOVER.max);
  }

  /** Its push: out of its top (it blows down). */
  pushDir(): V2 {
    return this.main.localDir(0, 1);
  }

  pushForce(): number {
    return HOVER.force;
  }

  pushAt(): V2 {
    return { x: this.main.x, y: this.main.y };
  }

  /** The height it's holding now: the pilot's throttle's, or its own. */
  get target(): number {
    return this.pilotOut !== null ? HOVER.min + this.pilotOut * (HOVER.max - HOVER.min) : this.hold;
  }

  /** How high its nozzles are over what's under them (m, along its push), or null past its reach. */
  height(): number | null {
    const g = this.game;
    if (g.time - this.mineAt > 1) {
      this.mineAt = g.time;
      this.mine = new Set(g.connections.assemblyOf([this]));
      let m = 0;
      let n = 0;
      for (const e of this.mine) {
        if (e instanceof HoverThruster) n++;
        for (const q of e.parts) if (!q.destroyed) m += q.mass;
      }
      this.share = m / Math.max(1, n);
    }
    const p = this.main;
    const d = this.pushDir();
    const o = p.pixelToWorld((HOVER_NOZZLE.x0 + HOVER_NOZZLE.x1) / 2, HOVER_NOZZLE.y);
    const ray = new RAPIER.Ray(o, { x: -d.x, y: -d.y });
    const hit = g.physics.world.castRay(ray, HOVER.reach, true, undefined, undefined, undefined, undefined, (c) => {
      const q = g.physics.partOf(c);
      return !q || !this.mine.has(q.entity);
    });
    return hit ? hit.timeOfImpact : null;
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    const p = this.main;
    const run = this.running && !p.frozen;
    if (run !== this.shownOn) {
      this.shownOn = run;
      p.setArt(hoverThrusterArt(run));
    }
    if (!run) {
      this.push = 0;
      this.sum = 0;
      return;
    }
    const d = this.pushDir();
    const h = this.height() ?? HOVER.reach;
    const err = this.target - h;
    const v = p.vx * d.x + p.vy * d.y;
    // its share of the build's weight, and as much again as it takes to come to the height
    // and stop there (a little more for what it's found it holds besides, near it)
    if (Math.abs(err) < 1.5) this.sum = clamp(this.sum + err * dt, -2, 2);
    const g = Math.abs(this.game.physics.world.gravity.y);
    const level = this.pilotOut !== null || this.on ? 1 : this.powerLevel;
    const f = clamp(this.share * (g + 6 * err - 4 * v + 1.5 * this.sum), 0, HOVER.force) * level;
    const k = (this.push = f / HOVER.force);
    p.body.applyImpulse({ x: d.x * f * dt, y: d.y * f * dt }, true);
    // it eases itself (and what it's on) upright
    const lean = wrapAngle(p.bodyAngle);
    p.body.applyTorqueImpulse(clamp(-2 * lean - 0.6 * p.av, -1, 1) * HOVER.force * 0.06 * level * dt, true);
    // the downdraught, and dust kicked up off what's under it
    const ps = this.game.particles;
    if (Math.random() < 0.3 + k) {
      const ix = HOVER_NOZZLE.x0 + Math.random() * (HOVER_NOZZLE.x1 - HOVER_NOZZLE.x0);
      const n = p.pixelToWorld(ix, HOVER_NOZZLE.y + 1);
      const s = 3 + k * 4;
      ps.emit(PK.Fire, n.x, n.y, {
        vx: -d.x * s + (Math.random() - 0.5), vy: -d.y * s + (Math.random() - 0.5),
        life: 0.08 + Math.random() * 0.08, size: 0.07, size1: 0.02, color: 0xcff2ff, color1: 0x6fb6ff, alpha: 0.6, alpha1: 0.1, gravity: 0, drag: 3,
      });
    }
    if (h < 2 && Math.random() < k * 0.3) ps.smoke(p.x - d.x * h + (Math.random() - 0.5) * 0.6, p.y - d.y * h + 0.05, 1, 0.1);
    this.game.sound.hold(this, 'machine/fan_loop', 0.12 + 0.18 * k, p.x, 1.3 + 0.4 * k);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      { label: 'Hold higher (+0.5 m)', action: () => (this.hold = Math.min(HOVER.max, this.hold + 0.5)) },
      { label: 'Hold lower (-0.5 m)', action: () => (this.hold = Math.max(HOVER.min, this.hold - 0.5)) },
      jobAction(this),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, hold: this.hold, ...pilotState(this) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.hold = typeof x.hold === 'number' ? clamp(x.hold, HOVER.min, HOVER.max) : 1.5;
    restorePilot(this, x);
  }
}

// ------------------------------------------------------------------ gyroscope

/** How fast Q and E turn the angle a gyroscope holds (rad/s), and the fastest it turns its build (rad/s). */
const GYRO = { rate: 1.5, spin: 2.5 };

/**
 * A gyroscope stabiliser: welded into a build, it holds it at an angle (upright, to
 * start with), turning it back as hard as it can when it's knocked or tipped, and
 * three times as hard powered. Flown, Q and E turn the angle it holds (see
 * systems/Piloting). It works without power; switched off, it lets go.
 */
export class Gyroscope extends Prop implements Steadier {
  on = true;
  /** The angle (rad, the world's) it holds its build at. */
  aim = 0;
  /** Its turning strength (N·m), unpowered. */
  readonly torque: number;
  private readonly big: boolean;
  private spin = 0;
  private shown = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, torque: number, big: boolean, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.torque = torque;
    this.big = big;
  }

  get running(): boolean {
    return this.on && this.works;
  }

  canRest(): boolean {
    return !this.running;
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.1 : 0.8);
  }

  pilotTurn(r: number, dt: number): void {
    if (r) this.aim = wrapAngle(this.aim + r * GYRO.rate * dt);
  }

  preStep(dt: number): void {
    const p = this.main;
    if (!this.running || p.frozen) return;
    // (as fast as it's off, the turn it wants; as hard as it can, to get it turning so)
    const err = wrapAngle(this.aim - p.bodyAngle);
    const want = clamp(3 * err, -GYRO.spin, GYRO.spin);
    const max = this.torque * (this.powered ? 3 * this.powerLevel || 1 : 1);
    const t = clamp((want - p.av) * 2, -1, 1) * max;
    p.body.applyTorqueImpulse(t * dt, true);
    this.game.sound.hold(this, 'machine/motor_loop', 0.05 + 0.08 * Math.min(1, Math.abs(t) / max), p.x, this.big ? 0.7 : 1.4);
  }

  frame(dt: number): void {
    if (!this.running) return;
    this.spin += dt * 30;
    const f = Math.floor(this.spin) % GYRO_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(gyroArt(`${f}:${this.big ? 1 : 0}`));
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() },
      { label: 'Hold upright', checked: Math.abs(this.aim) < 1e-3, action: () => (this.aim = 0) },
      { label: 'Hold as it is now', action: () => (this.aim = wrapAngle(this.main.bodyAngle)) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, aim: this.aim };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    this.aim = typeof x.aim === 'number' && Number.isFinite(x.aim) ? wrapAngle(x.aim) : 0;
  }
}

// ------------------------------------------------------------------ key trigger

/** The keys a key trigger can be set to: ones the game's own commands leave alone. */
export const TRIGGER_KEYS = ['KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyK', 'KeyL'];
/** Held: on while the key's down. Toggle: each press, on or off. Pulse: each press, a pulse (as a button's). */
export type TriggerMode = 'hold' | 'toggle' | 'pulse';
const MODES: TriggerMode[] = ['hold', 'toggle', 'pulse'];
const MODE_LABEL: Record<TriggerMode, string> = { hold: 'On while held', toggle: 'On / off each press', pulse: 'A pulse each press' };

/**
 * A key trigger: its key (one of TRIGGER_KEYS, set in its menu) works what it's
 * wired to: on while it's held (or toggled on and off, or a pulse each press). With
 * no battery in its circuit, it powers it itself, as a switch does.
 */
export class KeyTrigger extends Prop {
  key = 'KeyK';
  mode: TriggerMode = 'hold';
  /** On (held, or toggled on). */
  live = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  conducts(): boolean {
    return this.mode !== 'pulse' && this.live;
  }

  powersAlone(): boolean {
    return this.mode !== 'pulse' && this.live;
  }

  /** Its key pressed (or let go). */
  press(down: boolean): void {
    if (this.destroyed || !this.works) return;
    if (this.mode === 'hold') this.set(down);
    else if (!down) return;
    else if (this.mode === 'toggle') this.set(!this.live);
    else {
      this.main.flash = 0.6;
      this.game.sound.click(this.main.x, 1.2);
      this.game.connections.pulse(this);
    }
  }

  /** F (or a click on it): as its key pressed; held mode, on or off. */
  activate(): void {
    if (this.mode === 'hold') this.set(!this.live);
    else this.press(true);
  }

  private set(on: boolean): void {
    if (on === this.live) return;
    this.live = on;
    this.main.setArt(keyTriggerArt(on));
    this.game.sound.click(this.main.x, on ? 1.15 : 0.85);
    this.game.connections.recomputePower();
  }

  get label(): string {
    return `Key Trigger (${this.key.slice(3)})`;
  }

  contextActions(): ContextAction[] {
    return [
      { label: 'Press', hint: 'F', action: () => this.activate() },
      { label: `Key: ${this.key.slice(3)}`, action: () => (this.key = TRIGGER_KEYS[(TRIGGER_KEYS.indexOf(this.key) + 1) % TRIGGER_KEYS.length]) },
      { label: `Mode: ${MODE_LABEL[this.mode]}`, action: () => {
        this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
        if (this.live) this.set(false);
      } },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { key: this.key, mode: this.mode, live: this.live };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.key = TRIGGER_KEYS.includes(x.key as string) ? (x.key as string) : 'KeyK';
    this.mode = MODES.includes(x.mode as TriggerMode) ? (x.mode as TriggerMode) : 'hold';
    // (quietly: a copy or a load isn't the key being pressed; its wires come after)
    this.live = !!x.live && this.mode !== 'pulse';
    this.main.setArt(keyTriggerArt(this.live));
  }
}

/** A key pressed or let go (see Controls; a guest's, at the host): the key triggers set to it hear it. */
export function pressKey(game: Game, code: string, down: boolean): void {
  if (!TRIGGER_KEYS.includes(code)) return;
  for (const e of game.entities) if (e instanceof KeyTrigger && e.key === code) e.press(down);
}

// ------------------------------------------------------------------ cockpit

/** A cockpit's seat: hips on the cushion, leaning back a little, hands on the stick. */
const COCKPIT_SEAT: SeatSpec = {
  at: COCKPIT.hips, recline: 0.12, band: 0,
  pose: { head: -0.2, upperLegF: 1.35, upperLegB: 1.35, lowerLegF: -0.6, lowerLegB: -0.6, footF: -0.4, footB: -0.4, upperArmF: 0.95, upperArmB: 0.9, lowerArmF: 0.35, lowerArmB: 0.4 },
};

/**
 * A cockpit seat: built into something with engines, it's where it's flown from
 * (see systems/Piloting): its up is the craft's up. Someone let go of over it
 * sits in it, and selected, they stand for the craft: the keys fly it.
 */
export class Cockpit extends Prop {
  /** It's a cockpit (see Piloting.assemble()). */
  readonly cockpit = true;
  private rider: { who: Human; joint: RAPIER.ImpulseJoint; ghosts: Part[] } | null = null;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  /** Who sits in it, if anyone. */
  get pilot(): Human | null {
    return this.rider?.who ?? null;
  }

  /** Someone let go of over it (see Human.board()): they sit in it, if it's free. */
  takeIn(who: Human, at: V2): boolean {
    if (this.rider || this.destroyed || this.main.destroyed || who.destroyed || who.seat || !who.alive) return false;
    const q = this.main.worldToPixel(at.x, at.y);
    const mid = who.limbs.get('midTorso')?.part;
    const m = mid && !mid.destroyed ? this.main.worldToPixel(mid.x, mid.y) : null;
    const over = (p: { ix: number; iy: number } | null) => !!p && p.ix >= -2 && p.ix < COCKPIT.w + 2 && p.iy >= -14 && p.iy < COCKPIT.h;
    if (!over(q) && !over(m)) return false;
    const hips = who.limbs.get('lowerTorso');
    if (!hips || hips.gone || !hips.attached) return false;
    let h: Entity | null = who;
    // (turned round they're made anew: see Game.flipEntity())
    if (who.flipped !== this.flipped) h = this.game.flipEntity(who);
    if (h instanceof Human && !h.destroyed) this.seat(h);
    return true;
  }

  private seat(h: Human): void {
    const b = this.main;
    placeInSeat(h, b, COCKPIT_SEAT);
    const hips = h.limbs.get('lowerTorso')!.part;
    const data = RAPIER.JointData.fixed(b.pixelToLocal(COCKPIT.hips[0], COCKPIT.hips[1]), COCKPIT_SEAT.recline * b.flip, { x: 0, y: 0 }, 0);
    const joint = this.game.physics.world.createImpulseJoint(data, b.body, hips.body, true);
    joint.setContactsEnabled(false);
    const ghosts = h.parts.filter((p) => !p.destroyed);
    for (const p of ghosts) {
      p.noCollideWith(b);
      b.noCollideWith(p);
    }
    const r = { who: h, joint, ghosts };
    this.rider = r;
    h.sit({
      pose: COCKPIT_SEAT.pose,
      vehicle: this,
      leave: () => this.rider === r && this.release(true),
      // (pulled by a limb, they come out)
      grabbed: (p) => p && this.rider === r && this.release(false),
    });
    // drawn in front of the seat
    h.zBase = this.zBase + 0.001;
    for (const p of h.parts) if (!p.destroyed) p.updateZ();
    this.game.sound.play('machine/car_door', { gain: 0.25, x: b.x, vary: 0.05 });
  }

  /** Lets them go: onto their feet if they can (`stand`), or as they are. */
  release(stand: boolean): void {
    const r = this.rider;
    if (!r) return;
    this.rider = null;
    if (r.joint.isValid()) this.game.physics.world.removeImpulseJoint(r.joint, true);
    const b = this.main;
    for (const p of r.ghosts) {
      if (p.destroyed || b.destroyed) continue;
      p.collideWith(b);
      b.collideWith(p);
    }
    const h = r.who;
    if (h.destroyed) return;
    h.sit(null, stand);
    h.zBase = this.game.allocZ();
    for (const p of h.parts) if (!p.destroyed) p.updateZ();
  }

  preStep(): void {
    const r = this.rider;
    // (deleted, cut loose at the hips, or the seat broken: they're out)
    if (r && (r.who.destroyed || !r.joint.isValid() || r.who.seat === null)) this.release(false);
  }

  protected onDestroy(): void {
    this.release(false);
    super.onDestroy();
  }

  contextActions(): ContextAction[] {
    return this.rider ? [{ label: 'Get out', action: () => this.release(true) }] : [];
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const h = this.rider?.who;
    return h && !h.destroyed ? { pilot: ref(h) } : undefined;
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const h = get(links.pilot as number);
    if (this.rider || !(h instanceof Human) || h.destroyed || h.seat || h.flipped !== this.flipped || this.main.destroyed) return;
    this.seat(h);
  }

  /** Its pilot goes where it goes (flipped, duplicated, copied). */
  attachedEntities(): Entity[] {
    const h = this.rider?.who;
    return h && !h.destroyed ? [h, ...h.attachedEntities()] : [];
  }
}

// ------------------------------------------------------------------ throttle lever

/**
 * A throttle lever: wired between power and engines (or on its own, powering
 * them itself, as a switch does), it lets through as much of the power as it's
 * pulled: engines run that hard (see Entity.powerLevel). F steps it a quarter
 * further, round to off; its menu sets it to any share.
 */
export class ThrottleLever extends Prop {
  /** How far it's pulled (0 to 1). */
  level = 0;
  private shown = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.show();
  }

  conducts(): boolean {
    return this.level > 0;
  }

  powersAlone(): boolean {
    return this.level > 0;
  }

  passes(): number {
    return this.level;
  }

  activate(): void {
    this.set(this.level >= 1 - 1e-6 ? 0 : Math.min(1, Math.floor(this.level * 4 + 1e-6) / 4 + 0.25));
  }

  /** A pulse steps it on too (a button's, a timer's tick). */
  onPulse(): void {
    this.activate();
  }

  set(level: number): void {
    level = clamp(level, 0, 1);
    if (level === this.level) return;
    this.level = level;
    this.show();
    this.game.sound.click(this.main.x, 0.8 + level * 0.4);
    this.game.connections.recomputePower();
  }

  private show(): void {
    const step = Math.round(this.level * (LEVER_STEPS - 1));
    if (step === this.shown) return;
    this.shown = step;
    this.main.setArt(throttleLeverArt(step));
  }

  contextActions(): ContextAction[] {
    return [
      { label: `Pull further (${Math.round(this.level * 100)}%)`, hint: 'F', action: () => this.activate() },
      ...[0, 0.25, 0.5, 0.75, 1].map((v) => ({ label: v ? `Set to ${v * 100}%` : 'Off', checked: this.level === v, action: () => this.set(v) })),
    ];
  }

  /** Set… (see Controls): how far it's pulled, to the per cent. */
  editor(): ValueEditor {
    return {
      label: 'Set throttle…',
      title: 'Throttle lever',
      fields: [{ key: 'level', label: 'Pulled', unit: '%', min: 0, max: 100, step: 1, get: () => Math.round(this.level * 100), set: (v) => this.set(v / 100) }],
      reset: () => this.set(0),
      alive: () => !this.destroyed,
    };
  }

  protected serializeExtra(): Record<string, unknown> {
    return { level: this.level };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    // (quietly: a copy or a load isn't the lever being pulled; its wires come after)
    this.level = typeof x.level === 'number' ? clamp(x.level, 0, 1) : 0;
    this.show();
  }
}

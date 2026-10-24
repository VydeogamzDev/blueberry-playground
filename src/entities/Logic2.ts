import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Entity } from '../world/Entity';
import { Prop, type PropConfig } from './Prop';
import { Appliance } from './Appliance';
import { sideRole } from './Devices';
import { toggleRun, type HandSwitched } from './Machines';
import { isMetal } from './Electric';
import { MAT } from '../world/Materials';
import { METRONOME_FRAMES, SERVO, type DetectorKind } from '../art/machines2';
import type { PixelArt } from '../art/PixelArt';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Connection, WireRole } from '../systems/Connections';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// More logic and timing: a delay, a counter, a one-shot fuse, a metronome,
// metal and fire detectors, a siren, radios and a servo. Inputs are wires on the
// left half, outputs the right half, as on the gates and the timer.

/** Seconds an output that fires stays powered (a timer's tick). */
const BLINK = 0.15;

/** Is any of `e`'s input wires powered? */
function fedOf(e: Entity): boolean {
  const C = e.game.connections;
  return C.wiresOf(e).some(({ c }) => C.roleOf(e, c) === 'in' && C.live(c));
}

/**
 * Something that hears activations on its input: a pulse that came alone (a
 * button's), or power arriving (a lever thrown, a timer's tick, a gate turning
 * true), each counted once. A pulse that comes with power (the timer's) is the
 * power's arrival, so it's counted then.
 */
abstract class Listener extends Prop {
  /** Its input was powered at the last look. */
  protected fedWas = false;

  wireRole(c: Connection): WireRole {
    return sideRole(this, c);
  }

  onPulse(c: Connection): void {
    if (this.wireRole(c) !== 'in' || this.game.connections.live(c)) return;
    this.heard('pulse');
  }

  /** Looks at its input: power arriving (or going) is heard. */
  protected listen(): void {
    const fed = fedOf(this);
    if (fed === this.fedWas) return;
    this.fedWas = fed;
    this.heard(fed ? 'on' : 'off');
  }

  /** An activation on its input: a lone pulse, or its power arriving or going. */
  protected abstract heard(k: 'pulse' | 'on' | 'off'): void;

  protected serializeExtra(): Record<string, unknown> {
    return { fed: this.fedWas };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    // (a copy of one whose input was powered doesn't hear that power arrive again)
    this.fedWas = x.fed === true;
  }
}

// ------------------------------------------------------------------ lagbox

/** The delays a lagbox can be set to (s). */
export const LAG_DELAYS = [0.1, 0.25, 0.5, 1, 2, 5];
/** The most activations on their way through one at once. */
const LAG_MAX = 64;

/**
 * A lagbox: everything on its input comes out of its output `delay` seconds
 * later, as it went in: a pulse as a pulse, power arriving as power arriving
 * (and going as going), so a lever's power reaches a lamp a second late.
 */
export class Lagbox extends Listener {
  delay = 1;
  /** Its output is powered (power that went in `delay` s ago). */
  out = false;
  /** What's on its way through: when (game time) each comes out, and what it is. */
  private queue: { t: number; k: 'pulse' | 'on' | 'off' }[] = [];
  private art: (busy: boolean) => PixelArt;
  private busy = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (busy: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
  }

  isPowerSource(): boolean {
    return this.out;
  }

  /** Activate: a pulse goes in, as if one had come down its input. */
  activate(): void {
    this.game.sound.click(this.main.x, 1.3);
    this.heard('pulse');
  }

  /** Activations still on their way through. */
  get pending(): number {
    return this.queue.length;
  }

  protected heard(k: 'pulse' | 'on' | 'off'): void {
    if (this.queue.length < LAG_MAX) this.queue.push({ t: this.game.time + this.delay, k });
  }

  preStep(): void {
    this.listen();
    const now = this.game.time + 1e-9;
    for (let i = 0; i < this.queue.length;) {
      const q = this.queue[i];
      if (q.t > now) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.emit(q.k);
    }
    this.show();
  }

  /** What went in comes out. */
  private emit(k: 'pulse' | 'on' | 'off'): void {
    const C = this.game.connections;
    if (k === 'pulse') {
      this.game.sound.click(this.main.x, 1.5);
      C.pulse(this);
      return;
    }
    const on = k === 'on';
    if (on === this.out) return;
    this.out = on;
    C.recomputePower();
    if (on) C.pulse(this, true);
  }

  private show(): void {
    const busy = this.queue.length > 0 || this.out;
    if (busy === this.busy || this.destroyed) return;
    this.busy = busy;
    this.main.setArt(this.art(busy));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Send a pulse through', hint: 'F', action: () => this.activate() }];
    for (const d of LAG_DELAYS) {
      acts.push({
        label: `Delay ${d} s`, checked: this.delay === d, action: () => {
          // (what's already on its way comes out as much sooner or later)
          for (const q of this.queue) q.t += d - this.delay;
          this.delay = d;
        },
      });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (what's on its way, by the time left to a twentieth of a second)
    const now = this.game.time;
    const x: Record<string, unknown> = { ...super.serializeExtra(), delay: this.delay, out: this.out };
    if (this.queue.length) x.queue = this.queue.map((q) => [q.k, Math.max(0, Math.ceil((q.t - now) * 20) / 20)]);
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (LAG_DELAYS.includes(x.delay as number)) this.delay = x.delay as number;
    this.out = x.out === true;
    this.queue = [];
    if (Array.isArray(x.queue)) {
      for (const e of x.queue.slice(0, LAG_MAX)) {
        if (!Array.isArray(e) || (e[0] !== 'pulse' && e[0] !== 'on' && e[0] !== 'off') || typeof e[1] !== 'number' || !Number.isFinite(e[1])) continue;
        this.queue.push({ k: e[0], t: this.game.time + Math.min(Math.max(0, e[1]), 5) });
      }
    }
    this.show();
  }
}

// ------------------------------------------------------------------ counter

/** The counts a counter can be set to fire at. */
export const COUNTS = [2, 3, 4, 5, 10];

/**
 * A counter: counts the activations on its input, and on the Nth fires its
 * output (a pulse, and power for a moment, as a timer's tick) and starts again.
 * Its display shows the count so far.
 */
export class Counter extends Listener {
  /** It fires on this count. */
  target = 3;
  count = 0;
  /** Times it has fired (for tests). */
  fired = 0;
  private blinkT = 0;
  private art: (key: number) => PixelArt;
  private shown = -1;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (key: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
    this.show();
  }

  isPowerSource(): boolean {
    return this.blinkT > 0;
  }

  /** Activate: back to nought. */
  activate(): void {
    this.count = 0;
    this.game.sound.click(this.main.x, 0.9);
    this.show();
  }

  protected heard(k: 'pulse' | 'on' | 'off'): void {
    if (k === 'off') return;
    this.count++;
    if (this.count >= this.target) {
      this.count = 0;
      this.fired++;
      this.blinkT = BLINK;
      this.game.sound.click(this.main.x, 1.6);
      this.game.connections.recomputePower();
      this.game.connections.pulse(this, true);
    } else this.game.sound.click(this.main.x, 1.25);
    this.show();
  }

  preStep(dt: number): void {
    if (this.blinkT > 0 && (this.blinkT -= dt) <= 0) {
      this.game.connections.recomputePower();
      this.show();
    }
    this.listen();
  }

  private show(): void {
    const key = this.count + (this.blinkT > 0 ? 100 : 0);
    if (key === this.shown || this.destroyed) return;
    this.shown = key;
    this.main.setArt(this.art(key));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Reset count', hint: 'F', action: () => this.activate() }];
    for (const n of COUNTS) acts.push({ label: `Fire on count ${n}`, checked: this.target === n, action: () => this.setTarget(n) });
    return acts;
  }

  setTarget(n: number): void {
    this.target = n;
    if (this.count >= n) this.count = 0;
    this.show();
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), to: this.target, n: this.count };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (COUNTS.includes(x.to as number)) this.target = x.to as number;
    const n = typeof x.n === 'number' ? Math.floor(x.n) : 0;
    this.count = n >= 0 && n < this.target ? n : 0;
    this.show();
  }
}

// ------------------------------------------------------------------ activation fuse

/**
 * An activation fuse: the first activation on its input goes through (a pulse
 * out of its output) and burns it out; nothing more gets through until it's
 * reset (activate, or its menu).
 */
export class ActivationFuse extends Listener {
  blown = false;
  private art: (blown: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (blown: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
  }

  preStep(): void {
    this.listen();
  }

  protected heard(k: 'pulse' | 'on' | 'off'): void {
    if (k === 'off' || this.blown) return;
    this.blown = true;
    this.main.setArt(this.art(true));
    const w = this.main.pixelToWorld(8, 4);
    this.game.particles.sparks(w.x, w.y, 0, 1, 4, 2);
    this.game.sound.spark(w.x);
    this.game.connections.pulse(this);
  }

  /** Activate: a fresh fuse (if it's burnt out). */
  activate(): void {
    if (!this.blown) return;
    this.blown = false;
    this.main.setArt(this.art(false));
    this.game.sound.click(this.main.x, 1.2);
  }

  contextActions(): ContextAction[] {
    return [{ label: this.blown ? 'Reset fuse' : 'Fuse intact', hint: 'F', disabled: !this.blown, action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), blown: this.blown };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.blown = x.blown === true;
    this.main.setArt(this.art(this.blown));
  }
}

// ------------------------------------------------------------------ metronome

/** The rates a metronome can be set to (beats a minute). */
export const BPMS = [60, 90, 120, 180, 240];

/**
 * A metronome: while its input (left) is powered (and it's switched on) it
 * ticks at its rate, each beat firing its output (right) as a timer's tick does.
 */
export class Metronome extends Prop {
  on = true;
  bpm = 120;
  /** Beats so far (for tests). */
  beats = 0;
  private t = 0;
  private blinkT = 0;
  private phase = 0;
  private shown = 1;
  /** Ticking, as the host has it (a guest's copy swings its pendulum from this). */
  private live = false;
  private art: (frame: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (frame: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.art = art;
  }

  wireRole(c: Connection): WireRole {
    return sideRole(this, c);
  }

  isPowerSource(): boolean {
    return this.blinkT > 0;
  }

  get running(): boolean {
    return this.on && fedOf(this);
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.1 : 0.8);
  }

  preStep(dt: number): void {
    if (this.blinkT > 0 && (this.blinkT -= dt) <= 0) this.game.connections.recomputePower();
    this.live = this.running;
    if (!this.live) {
      this.t = 0;
      return;
    }
    this.t += dt;
    const period = 60 / this.bpm;
    if (this.t < period) return;
    this.t -= period;
    this.beats++;
    this.blinkT = Math.min(BLINK, period * 0.4);
    this.game.sound.play('machine/tick', { gain: 0.45, x: this.main.x, rate: this.beats % 4 === 1 ? 1.15 : 1 });
    this.game.connections.recomputePower();
    this.game.connections.pulse(this, true);
  }

  /** The pendulum swings (on every screen: drawn as a frame is). */
  frame(dt: number): void {
    if (!this.live || this.destroyed) return;
    this.phase += (dt * this.bpm) / 60;
    const f = Math.floor(this.phase * 2) % METRONOME_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(this.art(f));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
    for (const b of BPMS) acts.push({ label: `${b} beats a minute`, checked: this.bpm === b, action: () => (this.bpm = b) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, bpm: this.bpm, run: this.live };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    if (BPMS.includes(x.bpm as number)) this.bpm = x.bpm as number;
    this.live = x.run === true;
  }
}

// ------------------------------------------------------------------ detectors

/** The ranges a detector can be set to (m). */
export const DETECT_RANGES = [1, 2, 4, 8];
/** How wide (m) a detector's view is. */
const DETECT_WIDTH = 1;
/** How often it looks (s). */
const DETECT_T = 0.1;
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);

let viewBox: RAPIER.Cuboid | null = null;

/**
 * A detector: looks along its facing, out to its range and a metre wide, and
 * while it sees what it's for (metal things, or fire) powers its output and
 * pulses it when it first does, as the motion sensor does for anything.
 */
export class Detector extends Prop {
  readonly kind: DetectorKind;
  enabled = true;
  range = 4;
  detecting = false;
  private holdT = 0;
  private scanT = 0;
  private art: (on: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: DetectorKind, art: (on: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    this.activatable = true;
    this.art = art;
  }

  wireRole(): WireRole {
    return 'out';
  }

  isPowerSource(): boolean {
    return this.detecting;
  }

  /** Its view: from its front, along its facing. */
  private view(): { x: number; y: number; dx: number; dy: number } {
    const p = this.main;
    const o = p.pixelToWorld(11, 4.5);
    const d = p.localDir(p.flip, 0);
    return { x: o.x + d.x * PX, y: o.y + d.y * PX, dx: d.x, dy: d.y };
  }

  /** Does it see what it's for? */
  private sees(): boolean {
    const v = this.view();
    const phys = this.game.physics;
    const box = (viewBox ??= new RAPIER.Cuboid(1, 1));
    box.halfExtents = { x: this.range / 2, y: DETECT_WIDTH / 2 };
    const c = { x: v.x + (v.dx * this.range) / 2, y: v.y + (v.dy * this.range) / 2 };
    let seen = false;
    phys.world.intersectionsWithShape(c, Math.atan2(v.dy, v.dx), box, (col) => {
      const q = phys.partOf(col);
      if (!q || q.destroyed || q.entity === this) return true;
      seen = this.kind === 'metal' ? isMetal(q.mat) : q.burning > 0.05;
      return !seen;
    }, undefined, THINGS);
    if (seen || this.kind !== 'fire') return seen;
    // burning fuel on the floor in view
    const pz = this.game.puddles;
    for (let s = 0; s <= this.range; s += 0.25) {
      const x = v.x + v.dx * s;
      const y = v.y + v.dy * s;
      if (y - this.game.env.groundAt(x, y) < DETECT_WIDTH / 2 + 0.2 && pz.burningAt(x)) return true;
    }
    return false;
  }

  preStep(dt: number): void {
    this.scanT -= dt;
    this.holdT -= dt;
    if (this.scanT > 0) return;
    this.scanT = DETECT_T;
    const seen = this.enabled && !this.game.connections.jammed.has(this) && this.sees();
    if (seen) this.holdT = 0.3;
    const now = seen || (this.detecting && this.holdT > 0);
    if (now === this.detecting) return;
    this.detecting = now;
    this.main.setArt(this.art(now));
    this.game.connections.recomputePower();
    if (now) {
      this.game.sound.button(this.main.x);
      this.game.connections.pulse(this, true);
    }
  }

  /** Its view's edges, faint (brighter while it sees something). */
  frame(): void {
    if (!this.enabled || this.destroyed) return;
    const v = this.view();
    const nx = -v.dy * (DETECT_WIDTH / 2);
    const ny = v.dx * (DETECT_WIDTH / 2);
    const col = this.kind === 'metal' ? (this.detecting ? 0x6fb0ff : 0x24406a) : this.detecting ? 0xff9a3a : 0x6a3414;
    const ex = v.x + v.dx * this.range;
    const ey = v.y + v.dy * this.range;
    const pr = this.game.projectiles;
    for (const s of [-1, 1]) pr.drawBeam(v.x + nx * s, v.y + ny * s, ex + nx * s, ey + ny * s, PX * 0.8, col, 0, PX * 4);
    pr.drawBeam(ex - nx, ey - ny, ex + nx, ey + ny, PX * 0.8, col, 0, PX * 4);
  }

  activate(): void {
    this.enabled = !this.enabled;
    this.game.sound.click(this.main.x, this.enabled ? 1.1 : 0.8);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.enabled ? 'Disable' : 'Enable', hint: 'F', action: () => this.activate() }];
    for (const r of DETECT_RANGES) acts.push({ label: `Range ${r} m`, checked: this.range === r, action: () => (this.range = r) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { enabled: this.enabled, range: this.range, on: this.detecting };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.enabled = x.enabled !== false;
    if (DETECT_RANGES.includes(x.range as number)) this.range = x.range as number;
    const on = x.on === true;
    if (on !== this.detecting) {
      this.detecting = on;
      this.main.setArt(this.art(on));
    }
  }
}

// ------------------------------------------------------------------ siren

/**
 * A siren: wails while powered (and switched on), its beacon turning. Wired to
 * a detector or a sensor, it's an alarm.
 */
export class Siren extends Appliance {
  private flashT = 0;
  private lit = 0;
  private art: (lit: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (lit: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  protected run(): void {
    this.game.sound.hold(this, 'machine/siren_loop', 0.42, this.main.x);
  }

  protected changed(on: boolean): void {
    if (on || this.destroyed) return;
    this.lit = 0;
    this.main.setArt(this.art(0));
  }

  /** The beacon turns (on every screen). */
  frame(dt: number): void {
    if (!this.live || this.destroyed) return;
    this.flashT += dt;
    const lit = (Math.floor(this.flashT * 4) % 2) + 1;
    const w = this.main.pixelToWorld(5.5, 4);
    this.game.renderer.addLight(w.x, w.y, 4, 0.45 + 0.2 * Math.abs(Math.sin(this.flashT * Math.PI * 4)), 0xff3a28);
    if (lit === this.lit) return;
    this.lit = lit;
    this.main.setArt(this.art(lit));
  }
}

// ------------------------------------------------------------------ radio

/** The channels a radio can be set to. */
export const CHANNELS = [1, 2, 3, 4, 5, 6];

/** Each game's transmitters (a receiver asks them whether its channel is on). */
const transmitters = new WeakMap<Game, Set<RadioTransmitter>>();

function txOf(game: Game): Set<RadioTransmitter> {
  let s = transmitters.get(game);
  if (!s) transmitters.set(game, (s = new Set()));
  return s;
}

/**
 * A radio transmitter: whatever comes down its wires goes out on its channel,
 * to every receiver on it: a pulse as a pulse, power as power (while its wires
 * are powered, the receivers power theirs).
 */
export class RadioTransmitter extends Prop {
  channel = 1;
  /** Its wires are powered: its channel is on. */
  level = false;
  private blinkT = 0;
  private art: (key: string) => PixelArt;
  private shown = '';

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    // (it listens to power, it isn't set off by it)
    this.usesPower = true;
    this.art = art;
    txOf(game).add(this);
    this.show();
  }

  wireRole(): WireRole {
    return 'in';
  }

  /** The receivers on its channel (not those an EMP has knocked out). */
  private receivers(): RadioReceiver[] {
    const C = this.game.connections;
    return this.game.entities.filter((e): e is RadioReceiver => e instanceof RadioReceiver && !e.destroyed && e.channel === this.channel && !C.jammed.has(e));
  }

  /** A pulse goes out on its channel. */
  private send(): void {
    if (this.game.connections.jammed.has(this)) return;
    this.blinkT = BLINK;
    this.show();
    for (const r of this.receivers()) this.game.connections.pulse(r);
  }

  onPulse(): void {
    this.send();
  }

  /** Activate: sends a pulse, as if one had come down its wires. */
  activate(): void {
    this.game.sound.click(this.main.x, 1.4);
    this.send();
  }

  preStep(dt: number): void {
    if (this.blinkT > 0 && (this.blinkT -= dt) <= 0) this.show();
    const fed = fedOf(this);
    if (fed === this.level) return;
    this.level = fed;
    this.show();
    const C = this.game.connections;
    C.recomputePower();
    if (fed) for (const r of this.receivers()) C.pulse(r, true);
  }

  private show(): void {
    const key = `tx:${this.channel}:${this.level || this.blinkT > 0 ? 1 : 0}`;
    if (key === this.shown || this.destroyed) return;
    this.shown = key;
    this.main.setArt(this.art(key));
  }

  setChannel(ch: number): void {
    this.channel = ch;
    this.show();
    if (this.level) this.game.connections.recomputePower();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Transmit a pulse', hint: 'F', action: () => this.activate() }];
    for (const ch of CHANNELS) acts.push({ label: `Channel ${ch}`, checked: this.channel === ch, action: () => this.setChannel(ch) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ch: this.channel, on: this.level };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (CHANNELS.includes(x.ch as number)) this.channel = x.ch as number;
    this.level = x.on === true;
    this.show();
  }

  protected onDestroy(): void {
    txOf(this.game).delete(this);
    if (this.level) this.game.connections.recomputePower();
  }
}

/** A radio receiver: powers its wires while its channel is on, and passes on the pulses sent on it. */
export class RadioReceiver extends Prop {
  channel = 1;
  private art: (key: string) => PixelArt;
  private shown = '';

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.show();
  }

  wireRole(): WireRole {
    return 'out';
  }

  /** Some transmitter on its channel has its wires powered. */
  isPowerSource(): boolean {
    for (const t of txOf(this.game)) if (t.level && t.channel === this.channel && !t.destroyed) return true;
    return false;
  }

  preStep(): void {
    this.show();
  }

  private show(): void {
    const key = `rx:${this.channel}:${this.isPowerSource() ? 1 : 0}`;
    if (key === this.shown || this.destroyed) return;
    this.shown = key;
    this.main.setArt(this.art(key));
  }

  setChannel(ch: number): void {
    this.channel = ch;
    this.show();
    this.game.connections.recomputePower();
  }

  contextActions(): ContextAction[] {
    return CHANNELS.map((ch) => ({ label: `Channel ${ch}`, checked: this.channel === ch, action: () => this.setChannel(ch) }));
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ch: this.channel };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (CHANNELS.includes(x.ch as number)) this.channel = x.ch as number;
    this.show();
  }
}

// ------------------------------------------------------------------ servo

/** The angles a servo can be set to turn its arm to (degrees, up positive). */
export const SERVO_ANGLES = [-90, -45, 45, 90, 135];

export interface ServoConfig {
  housing: () => PixelArt;
  arm: () => PixelArt;
  /** Its strongest turn (N*m). */
  torque: number;
}

/**
 * A servo: while powered (or switched on by hand) it turns its arm to the
 * angle it's set to, and back to straight out when not. Weld things to the arm
 * (or fix the housing) to build with it.
 */
export class Servo extends Entity implements HandSwitched {
  readonly housing: Part;
  readonly arm: Part;
  on = false;
  heldOff = false;
  /** The angle it turns its arm to (degrees, up positive). */
  angle = 90;
  private joint: RAPIER.RevoluteImpulseJoint;
  private torque: number;
  private applied = '';

  constructor(game: Game, def: ItemDef, cfg: ServoConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.activatable = true;
    this.usesPower = true;
    this.attachIgnoresBody = true;
    this.torque = cfg.torque;
    const ang = opts.angle ?? 0;
    this.housing = this.addPart({ name: 'Housing', art: cfg.housing(), material: MAT.metal, x, y, angle: ang, density: 110, textureKey: def.id + ':h', layer: 0 });
    const art = cfg.arm();
    const f = this.housing.flip;
    const pv = this.housing.pixelToWorld(SERVO.pivot[0], SERVO.pivot[1]);
    const ap = SERVO.armPivot;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const lx = (ap[0] + 0.5 - art.w / 2) * f * PX;
    const ly = (art.h / 2 - ap[1] - 0.5) * PX;
    this.arm = this.addPart({
      name: 'Arm', art, material: MAT.metal, x: pv.x - (lx * c - ly * s), y: pv.y - (lx * s + ly * c), angle: ang, density: 90, textureKey: def.id + ':a', layer: 1,
    });
    const data = RAPIER.JointData.revolute(this.housing.pixelToLocal(SERVO.pivot[0], SERVO.pivot[1]), this.arm.pixelToLocal(ap[0], ap[1]));
    this.joint = this.addJoint(data, this.housing, this.arm) as RAPIER.RevoluteImpulseJoint;
    this.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.joint.setMotorMaxForce(cfg.torque);
    this.apply();
  }

  /** Turned to its angle (powered or on by hand, and not held off, nor knocked out by an EMP). */
  get turned(): boolean {
    return (this.on || this.powered) && !this.heldOff && !this.game.connections.jammed.has(this);
  }

  /** The arm's turn from straight out now (degrees, up positive). */
  get armAngle(): number {
    let a = this.arm.body.rotation() - this.housing.body.rotation();
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return (a * 180 * this.housing.flip) / Math.PI;
  }

  private target(): number {
    return this.turned ? (this.angle * Math.PI * this.housing.flip) / 180 : 0;
  }

  private apply(): void {
    const sig = `${this.turned}:${this.angle}`;
    if (sig === this.applied || !this.joint.isValid()) return;
    this.applied = sig;
    this.joint.configureMotorPosition(this.target(), this.torque * 4, this.torque * 0.6);
    this.housing.body.wakeUp();
    this.arm.body.wakeUp();
  }

  canRest(): boolean {
    return Math.abs(this.armAngle - (this.turned ? this.angle : 0)) < 2;
  }

  /** Frozen where it's put: only its housing is fixed, so its arm still turns. */
  get frozen(): boolean {
    return this.housing.frozen;
  }

  setFrozen(on: boolean): void {
    this.housing.setFrozen(on);
    this.arm.setFrozen(false);
  }

  preStep(): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    this.apply();
    // it whirs while the arm is on its way
    if (Math.abs(this.armAngle - (this.turned ? this.angle : 0)) > 3) this.game.sound.hold(this, 'machine/turret_loop', 0.12, this.housing.x, 1.8);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
    this.apply();
  }

  activate(): void {
    toggleRun(this, this.turned, this.powered);
    this.game.sound.click(this.housing.x, this.turned ? 1.2 : 0.9);
    this.apply();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.turned ? 'Turn back' : 'Turn', hint: 'F', action: () => this.activate() }];
    for (const a of SERVO_ANGLES) {
      acts.push({
        label: `Turns to ${a}°`, checked: this.angle === a, action: () => {
          this.angle = a;
          this.apply();
        },
      });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, angle: this.angle };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    if (SERVO_ANGLES.includes(x.angle as number)) this.angle = x.angle as number;
    this.apply();
  }
}

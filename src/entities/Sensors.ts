import { clamp } from '../engine/math';
import { PX, WORLD } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import { Listener } from './Logic2';
import { sideRole } from './Devices';
import { SEQ_PINS, SEQ_STEPS, type SensorKind } from '../art/power';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Connection, WireRole } from '../systems/Connections';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Sensors, a toggle and a step sequencer (0.4.0), and the power makers: a solar panel and
// a generator (see systems/Power for batteries running down). Inputs are wires on the left
// half, outputs the right half, as on the gates and the timer.

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** What each sensor can be set to (its unit), and what it starts at. */
export const SENSOR_STEPS: Record<SensorKind, { steps: number[]; unit: string; start: number; above: boolean }> = {
  altimeter: { steps: [2, 5, 10, 20, 50, 100, 300, 1000, 5000, 10000], unit: 'm', start: 50, above: false },
  speed: { steps: [1, 2, 5, 10, 20, 50, 100, 200, 340], unit: 'm/s', start: 10, above: true },
  tilt: { steps: [10, 20, 30, 45, 60, 90, 135], unit: '°', start: 45, above: true },
  fuel: { steps: [0, 10, 25, 50, 75, 100], unit: '%', start: 10, above: false },
  proximity: { steps: [0.5, 1, 2, 4, 8], unit: 'm', start: 2, above: false },
  g: { steps: [2, 3, 4, 6, 8, 10, 15, 20, 30], unit: 'g', start: 8, above: true },
};

const LABEL: Record<SensorKind, string> = { altimeter: 'height', speed: 'speed', tilt: 'tilt', fuel: 'fuel', proximity: 'nearest thing', g: 'g' };

/**
 * A sensor: reads its height over the ground (altimeter), its speed, how far it's tipped
 * from upright (tilt), the fuel left in its build's tanks (fuel gauge), or how near the
 * nearest other thing is (proximity); while the reading's past what it's set to (above or
 * below, in its menu), it powers its wires, and sends a pulse as it gets there.
 */
export class Sensor extends Prop {
  readonly kind: SensorKind;
  /** What it's set to, and whether it's on above it (else below). */
  limit: number;
  above: boolean;
  enabled = true;
  /** Its last reading, and (a g-meter) the most it's read since reset. */
  reading = 0;
  peak = 0;
  private lastV: { x: number; y: number; t: number } | null = null;
  private on = false;
  private scanT = 0;
  private art: (key: string) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: SensorKind, art: (key: string) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    this.art = art;
    this.limit = SENSOR_STEPS[kind].start;
    this.above = SENSOR_STEPS[kind].above;
    this.activatable = true;
  }

  wireRole(): WireRole {
    return 'out';
  }

  isPowerSource(): boolean {
    return this.on;
  }

  get active(): boolean {
    return this.on;
  }

  /** What it reads now, in its unit. */
  read(): number {
    const p = this.main;
    const g = this.game;
    switch (this.kind) {
      case 'altimeter': {
        const ground = g.env.world ? g.env.groundAt(p.x, p.y) : WORLD.floor;
        return p.y - (p.h * PX) / 2 - ground;
      }
      case 'speed':
        return Math.hypot(p.vx, p.vy);
      case 'tilt':
        return (Math.abs(wrap(p.bodyAngle)) * 180) / Math.PI;
      case 'fuel': {
        const tanks = g.fuel.tanksOf(this);
        const { fuel, capacity } = g.fuel.levelOf(tanks);
        return capacity > 0 ? (fuel / capacity) * 100 : 0;
      }
      case 'g': {
        // the g it feels: its acceleration less the pull of gravity (1 sat still), smoothed a little
        const now = { x: p.vx, y: p.vy, t: g.time };
        const was = this.lastV;
        this.lastV = now;
        if (!was || now.t - was.t <= 0 || now.t - was.t > 0.5) return this.reading || 1;
        const dt = now.t - was.t;
        const gy = g.gravity * (g.map.world ? g.air.gravityAt(p.y) : 1);
        const felt = Math.hypot((now.x - was.x) / dt, (now.y - was.y) / dt - gy) / 9.81;
        return this.reading + (Math.min(felt, 100) - this.reading) * 0.6;
      }
      case 'proximity': {
        const mine = new Set(g.connections.assemblyOf([this]));
        let best = Infinity;
        const r = this.limit + 3;
        for (const e of g.entities) {
          if (e.destroyed || mine.has(e)) continue;
          for (const q of e.parts) {
            if (q.destroyed) continue;
            const half = (Math.max(q.w, q.h) * PX) / 2;
            const dx = Math.abs(q.x - p.x);
            const dy = Math.abs(q.y - p.y);
            if (dx > r + half || dy > r + half) continue;
            best = Math.min(best, Math.max(0, Math.hypot(dx, dy) - half));
          }
        }
        return best;
      }
    }
  }

  preStep(dt: number): void {
    this.scanT -= dt;
    if (this.scanT > 0) return;
    // (a g-meter looks every step: a crash is over in a few)
    this.scanT = this.kind === 'g' ? 0 : 0.05;
    this.reading = this.read();
    this.peak = Math.max(this.peak, this.reading);
    const now = this.enabled && this.works && (this.above ? this.reading > this.limit : this.reading < this.limit || (this.kind === 'fuel' && this.limit === 0 && this.reading <= 0));
    if (now === this.on) return;
    this.on = now;
    this.show();
    this.game.connections.recomputePower();
    if (now) {
      this.game.sound.button(this.main.x);
      this.game.connections.pulse(this, true);
    }
  }

  private show(): void {
    if (!this.destroyed) this.main.setArt(this.art(`${this.kind}:${this.on ? 1 : 0}`));
  }

  activate(): void {
    this.enabled = !this.enabled;
    this.game.sound.click(this.main.x, this.enabled ? 1.1 : 0.8);
  }

  contextActions(): ContextAction[] {
    const s = SENSOR_STEPS[this.kind];
    const shown = Number.isFinite(this.reading) ? (this.reading >= 100 ? Math.round(this.reading) : this.reading.toFixed(1)) : '—';
    const acts: ContextAction[] = [
      { label: `Reads ${LABEL[this.kind]}: ${shown} ${s.unit}`, disabled: true, action: () => {} },
      { label: this.enabled ? 'Disable' : 'Enable', hint: 'F', action: () => this.activate() },
    ];
    if (this.kind === 'g') acts.splice(1, 0, { label: `Most: ${this.peak.toFixed(1)} g`, disabled: true, action: () => {} }, { label: 'Reset the most', action: () => (this.peak = 0) });
    if (this.kind !== 'proximity' && this.kind !== 'g') {
      acts.push({ label: 'On above', checked: this.above, action: () => (this.above = true) });
      acts.push({ label: 'On below', checked: !this.above, action: () => (this.above = false) });
    }
    for (const v of s.steps) acts.push({ label: `${this.kind === 'proximity' ? 'Within' : 'At'} ${v} ${s.unit}`, checked: this.limit === v, action: () => (this.limit = v) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { limit: this.limit, above: this.above, enabled: this.enabled };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (SENSOR_STEPS[this.kind].steps.includes(x.limit as number)) this.limit = x.limit as number;
    if (typeof x.above === 'boolean' && this.kind !== 'proximity') this.above = x.above;
    this.enabled = x.enabled !== false;
  }
}

/**
 * A toggle (a flip-flop): each pulse (or power arriving) on its input flips it; while
 * it's on its output's powered. Activate flips it by hand.
 */
export class Toggle extends Listener {
  on = false;
  private art: (on: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (on: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  isPowerSource(): boolean {
    return this.on && this.works;
  }

  activate(): void {
    this.flip();
  }

  protected heard(k: 'pulse' | 'on' | 'off'): void {
    if (k !== 'off') this.flip();
  }

  private flip(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.3 : 0.9);
    this.main.setArt(this.art(this.on));
    this.game.connections.recomputePower();
    if (this.on) this.game.connections.pulse(this, true);
  }

  preStep(): void {
    this.listen();
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.on = x.on === true;
    this.main.setArt(this.art(this.on));
  }
}

/**
 * A step sequencer: four outputs down its right side. Each pulse (or power arriving) on
 * its input moves it on a step, round and round: the output of the step it's on is
 * powered (and pulsed as it gets there), the others not. Activate steps it on by hand.
 */
export class Sequencer extends Listener {
  step = 0;
  /** How many of its steps it goes round (2 to 4). */
  steps = SEQ_STEPS;
  private art: (step: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (step: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  wireRole(c: Connection): WireRole {
    return sideRole(this, c);
  }

  /** Which output (0 top .. 3 bottom) a wire on its right side is on: the pin nearest where it's fixed. */
  pinOf(c: Connection): number {
    const mine = c.a.entity === this ? c.la : c.lb;
    const p = this.main;
    // (local y, up positive; the art's y runs down from its top)
    const artY = (p.h * PX) / 2 - mine.y;
    let best = 0;
    for (let i = 1; i < SEQ_PINS.length; i++) if (Math.abs(artY - (SEQ_PINS[i] + 1) * PX) < Math.abs(artY - (SEQ_PINS[best] + 1) * PX)) best = i;
    return best;
  }

  feeds(c: Connection): boolean {
    return this.pinOf(c) === this.step;
  }

  isPowerSource(): boolean {
    return this.works;
  }

  activate(): void {
    this.advance();
  }

  protected heard(k: 'pulse' | 'on' | 'off'): void {
    if (k !== 'off') this.advance();
  }

  private advance(): void {
    this.step = (this.step + 1) % this.steps;
    this.game.sound.click(this.main.x, 1.1 + this.step * 0.1);
    this.main.setArt(this.art(this.step));
    this.game.connections.recomputePower();
    this.game.connections.pulse(this, true);
  }

  preStep(): void {
    this.listen();
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Next step', hint: 'F', action: () => this.activate() }];
    for (const n of [2, 3, 4]) acts.push({ label: `${n} steps`, checked: this.steps === n, action: () => {
      this.steps = n;
      if (this.step >= n) this.step = 0;
      this.main.setArt(this.art(this.step));
      this.game.connections.recomputePower();
    } });
    acts.push({ label: 'Back to the first', action: () => {
      this.step = 0;
      this.main.setArt(this.art(0));
      this.game.connections.recomputePower();
    } });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), step: this.step, steps: this.steps };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if ([2, 3, 4].includes(x.steps as number)) this.steps = x.steps as number;
    const s = typeof x.step === 'number' ? Math.floor(x.step) : 0;
    this.step = s >= 0 && s < this.steps ? s : 0;
    this.main.setArt(this.art(this.step));
  }
}

// ------------------------------------------------------------------ power makers

/** A solar panel's most (W), facing the sun at noon; under this it gives no power. */
export const SOLAR_W = 120;
const SOLAR_MIN = 30;

/**
 * A solar panel: in daylight, facing up, it powers its wires and charges the batteries on
 * them (see systems/Power); the less it faces the sky and the darker it is, the less it
 * makes, and at night or face down, none.
 */
export class SolarPanel extends Prop {
  /** What it makes now (W). */
  output = 0;
  private lookT = 0;
  private art: (lit: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (lit: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  isPowerSource(): boolean {
    return this.output >= SOLAR_MIN && this.works;
  }

  /** How much (W) it makes, where and how it is. */
  make(): number {
    const p = this.main;
    const up = p.localDir(0, 1).y;
    const w = this.game.weather.state;
    // (above the cloud and the air, the sun's stronger)
    const thin = this.game.map.world ? 1 - clamp(this.game.air.densityAt(p.y) / 1.225, 0, 1) : 0;
    const sky = w.light * (1 - 0.5 * w.rain * (1 - thin)) * (1 - 0.6 * w.fog * (1 - thin));
    return Math.max(0, SOLAR_W * Math.max(0, up) * sky * (1 + 0.3 * thin));
  }

  preStep(dt: number): void {
    this.lookT -= dt;
    if (this.lookT > 0) return;
    this.lookT = 0.5;
    const was = this.isPowerSource();
    this.output = this.make();
    const now = this.isPowerSource();
    if (now !== was) {
      this.main.setArt(this.art(now));
      this.game.connections.recomputePower();
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: `Making ${Math.round(this.output)} W`, disabled: true, action: () => {} }];
  }
}

/** What a generator makes (W) running, and the fuel it burns (kg/s). */
export const GENERATOR_W = 1500;
const GENERATOR_BURN = 1 / 400;

/**
 * A generator: switched on (F, or a pulse), it burns fuel from the tanks in its build
 * (with none, it runs free, as engines do: see Settings' fuel) and powers its wires,
 * charging the batteries on them. Out of fuel, it coughs and stops.
 */
export class Generator extends Prop {
  on = false;
  private running = false;
  private shake = 0;
  private jig = false;
  private art: (key: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (key: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  get output(): number {
    return this.running ? GENERATOR_W : 0;
  }

  isPowerSource(): boolean {
    return this.running;
  }

  burnRate(): number {
    return this.on ? GENERATOR_BURN : 0;
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.1 : 0.8);
    if (this.on) this.game.sound.play('machine/car_door', { gain: 0.2, x: this.main.x, rate: 1.6 });
  }

  preStep(dt: number): void {
    let now = false;
    if (this.on && this.works) now = this.game.fuel.draw(this, GENERATOR_BURN * dt) > 0.5;
    if (this.on && !now && this.running) this.game.particles.smoke(this.main.x, this.main.y + 0.3, 3, 0.3);
    if (now !== this.running) {
      this.running = now;
      if (!now) this.on = false;
      this.game.connections.recomputePower();
      this.main.setArt(this.art(now ? 1 : 0));
    }
  }

  frame(dt: number): void {
    if (!this.running) return;
    const p = this.main;
    this.game.sound.hold(this, 'machine/motor_loop', 0.22, p.x, 0.75);
    this.shake += dt;
    if (this.shake > 0.06) {
      this.shake = 0;
      this.jig = !this.jig;
      this.main.setArt(this.art(this.jig ? 2 : 1));
      const ex = p.pixelToWorld(17, 4);
      if (Math.random() < 0.5) this.game.particles.smoke(ex.x, ex.y, 1, 0.12, false);
    }
  }

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Switch off' : 'Start it', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on === true;
  }
}


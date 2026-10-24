import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Prop, type PropConfig } from './Prop';
import { ecg, heartRate, isLiving, isSynthetic, limbMap, tick, type Living } from '../ui/VitalsPanel';
import type { MonitorLamp } from '../art/medical';
import type { PixelArt } from '../art/PixelArt';
import type { Connection, WireRole } from '../systems/Connections';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** The living thing at the other end of one of `e`'s connections (wired, welded, tied), or null. */
function livingAt(e: Entity, c: Connection): Living | null {
  const other = c.a.entity === e ? c.b?.entity : c.a.entity;
  return other && !other.destroyed && isLiving(other) ? other : null;
}

// ------------------------------------------------------------------ heart monitor

/** The trace: samples across the screen, how fast it sweeps (samples a second: about three beats show), and the gap running ahead of it. */
const TRACE = { n: 39, sweep: 15, gap: 3 };
/** The screen (art px): its left and right edges, the middle row, and how tall a spike stands. */
const SCREEN = { x0: 2.5, x1: 15.5, mid: 6.5, amp: 3.4 };
/** Where its leads plug in (art px), and how far off it can clip them onto someone (m). */
const LEADS = { socket: [0, 5.5] as [number, number], reach: 2.5 };
/** When in a beat it beeps (s): on the spike (see ecg), or on the android core's tick. */
const BEEP_AT = { heart: 0.185, core: 0.02 };
/** How long its other wires stay powered on each beat (s), and how fast the alarm lamp blinks (s). */
const BLIP = 0.12;
const ALARM_BLINK = 0.4;

/**
 * A bedside heart monitor. Its leads clip onto someone (Use it near them, or wire it
 * to them, or tie it to them any other way): its screen traces their heartbeat
 * live, it beeps with every beat, and each beat powers (and pulses) its other wires
 * for a moment. When the heart stops (or was never beating: a zombie's) it
 * flatlines with a long tone. An android shows its core's steady tick.
 */
export class HeartMonitor extends Prop {
  /** Whose heart it shows. */
  patient: Living | null = null;
  /** Its reading (beats a minute); 0: a flatline. */
  bpm = 0;
  /** Beats it has picked up (the tests count them). */
  beats = 0;
  muted = false;
  private samples = new Float32Array(TRACE.n);
  private cursor = 0;
  /** Seconds into the current beat, the strongest point of the wave since the last sample, and samples owed to the sweep. */
  private phase = 0;
  private peak = 0;
  private carry = 0;
  private lookT = 0;
  private blipT = 0;
  /** How long it has flatlined (s). */
  alarmT = 0;
  private shown: MonitorLamp = 'off';
  private art: (lamp: MonitorLamp) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (lamp: MonitorLamp) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** Its leads only listen (no power goes into the patient); every other wire is its output. */
  wireRole(c: Connection): WireRole {
    return livingAt(this, c) ? 'in' : 'out';
  }

  isPowerSource(): boolean {
    return this.blipT > 0;
  }

  /** Whoever its leads are on (wired to it, or tied to it any other way). */
  private findPatient(): Living | null {
    for (const c of this.game.connections.connectionsOf(this)) {
      const who = livingAt(this, c);
      if (who) return who;
    }
    return null;
  }

  /** The living thing nearest it, within reach of its leads. */
  private nearest(): Living | null {
    let best: Living | null = null;
    let bd: number = LEADS.reach;
    for (const e of this.game.entities) {
      if (e.destroyed || !isLiving(e)) continue;
      const c = e.center();
      const d = Math.hypot(c.x - this.main.x, c.y - this.main.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private leads(): Connection[] {
    return this.game.connections.connectionsOf(this).filter((c) => c.kind === 'wire' && livingAt(this, c));
  }

  /** Use: clips its leads onto the nearest person or animal (a wire to the chest), or takes them off. */
  activate(): void {
    const C = this.game.connections;
    const on = this.leads();
    if (on.length) {
      for (const c of on) C.remove(c);
      this.patient = null;
      this.game.sound.click(this.main.x, 0.8);
      return;
    }
    const who = this.nearest();
    const limbs = who ? limbMap(who) : null;
    const chest = (limbs?.get('upperTorso') ?? limbs?.get('chest'))?.part;
    if (!who || !chest || chest.destroyed) {
      this.game.sound.click(this.main.x, 1.8);
      return;
    }
    C.create('wire', this.main, this.main.pixelToWorld(LEADS.socket[0], LEADS.socket[1]), chest, { x: chest.x, y: chest.y });
    this.patient = who;
    this.lookT = 0.25;
    this.game.sound.click(this.main.x, 1.2);
  }

  postStep(dt: number): void {
    this.run(dt);
  }

  /** Moves the reading, the trace and the beat on by `dt` s of game time. */
  private run(dt: number): void {
    // (looked for a few times a second: going through the connections every step is waste)
    if ((this.lookT -= dt) <= 0) {
      this.lookT = 0.25;
      this.patient = this.findPatient();
    }
    const who = this.patient && !this.patient.destroyed ? this.patient : null;
    // the rate eases toward the reading; a heart that stops shows at once
    const rate = who ? heartRate(who) : 0;
    this.bpm = rate <= 0 ? 0 : this.bpm <= 0 ? rate : this.bpm + (rate - this.bpm) * Math.min(1, dt * 1.5);
    if (who && this.bpm > 0) {
      const core = isSynthetic(who);
      const wave = core ? tick : ecg;
      const at = core ? BEEP_AT.core : BEEP_AT.heart;
      const t0 = this.phase;
      this.phase += dt;
      if (t0 < at && this.phase >= at) this.beat();
      const period = 60 / this.bpm;
      if (this.phase >= period) this.phase -= period;
      // (the strongest of the wave over the step, so a spike between samples is never stepped over)
      for (const t of [this.phase, Math.max(0, this.phase - dt / 2)]) {
        const y = wave(t);
        if (Math.abs(y) > Math.abs(this.peak)) this.peak = y;
      }
    } else this.phase = 0;
    this.carry += dt * TRACE.sweep;
    while (this.carry >= 1) {
      this.carry -= 1;
      this.samples[this.cursor] = this.peak + (Math.random() - 0.5) * 0.03;
      this.cursor = (this.cursor + 1) % TRACE.n;
      this.peak = 0;
    }
    if (this.blipT > 0) {
      this.blipT -= dt;
      if (this.blipT <= 0 && !this.game.net?.guest) this.game.connections.recomputePower();
    }
    // flatline: a long tone while the heart it's on isn't beating
    if (who && this.bpm <= 0) {
      this.alarmT += dt;
      if (!this.muted) this.game.sound.hold(this, 'medical/ecg_flatline_loop', 0.2, this.main.x);
    } else this.alarmT = 0;
  }

  /** A heartbeat picked up: a beep, and its other wires powered (and pulsed) for a moment. */
  private beat(): void {
    this.beats++;
    this.blipT = BLIP;
    if (!this.muted) this.game.sound.play('medical/ecg_beep', { gain: 0.3, x: this.main.x, vary: 0 });
    // (a guest's game only shows the host's: what goes off, goes off there)
    if (this.game.net?.guest) return;
    this.game.connections.recomputePower();
    this.game.connections.pulse(this, true);
  }

  frame(dt: number): void {
    const g = this.game;
    // (a guest's game doesn't step it: its screen runs on the patient's vitals from the host)
    if (g.net?.guest && !g.paused) this.run(dt * g.timeScale);
    const lamp: MonitorLamp = !this.patient ? 'off'
      : this.bpm <= 0 ? (Math.floor(this.alarmT / ALARM_BLINK) % 2 ? 'off' : 'alarm')
      : this.blipT > 0 ? 'beat' : 'off';
    if (lamp !== this.shown && !this.main.destroyed) {
      this.shown = lamp;
      this.main.setArt(this.art(lamp));
    }
    if (this.patient) this.drawTrace();
  }

  /** The trace over its screen, sweeping left to right, a gap running ahead of it (glowing lines, drawn each frame). */
  private drawTrace(): void {
    const p = this.main;
    if (p.destroyed) return;
    const pj = this.game.projectiles;
    const col = this.bpm <= 0 ? 0xd0584a : this.patient && isSynthetic(this.patient) ? 0x6fd3ff : 0x5be37f;
    const span = SCREEN.x1 - SCREEN.x0;
    let prev: V2 | null = null;
    for (let i = 0; i < TRACE.n; i++) {
      const ahead = (i - this.cursor + TRACE.n) % TRACE.n;
      if (ahead < TRACE.gap) {
        prev = null;
        continue;
      }
      const sx = SCREEN.x0 + (span * i) / (TRACE.n - 1);
      // (it reads left to right whichever way the monitor faces)
      const ix = p.flip === 1 ? sx : SCREEN.x0 + SCREEN.x1 - sx;
      const iy = SCREEN.mid - clamp(this.samples[i], -0.45, 1.05) * SCREEN.amp;
      const w = p.pixelToWorld(ix - 0.5, iy - 0.5);
      if (prev) pj.drawBeam(prev.x, prev.y, w.x, w.y, PX * 0.7, col);
      prev = w;
    }
  }

  contextActions(): ContextAction[] {
    const on = this.leads().length > 0;
    return [
      on
        ? { label: 'Unclip leads', hint: 'F', action: () => this.activate() }
        : { label: 'Clip leads to nearest', hint: 'F', disabled: !this.nearest(), action: () => this.activate() },
      { label: this.muted ? 'Sound on' : 'Mute', action: () => (this.muted = !this.muted) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return this.muted ? { muted: true } : undefined;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.muted = x.muted === true;
  }
}

// ------------------------------------------------------------------ life detector

const LIFE_RAY = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/** Part of someone alive (a person or an animal, not a zombie), or of something one is holding. */
function aliveAt(p: Part | null | undefined): boolean {
  if (!p || p.destroyed || p.detached) return false;
  let e: Entity | null | undefined = p.entity;
  if (!isLiving(e)) e = (e as Entity & { holder?: Entity | null }).holder;
  return isLiving(e) && !e.destroyed && e.alive && !e.zombie;
}

/**
 * A motion sensor that only sees the living: looking along its facing, it powers its
 * wires while someone alive is the first thing in its beam (a person or an animal,
 * not a zombie, and not a body), and pulses them when one first comes into view.
 */
export class LifeDetector extends Prop {
  enabled = true;
  range = 4;
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
      const hit = this.game.physics.world.castRay(this.ray, this.range, true, undefined, LIFE_RAY, undefined, this.main.body);
      this.hitAt = hit ? hit.timeOfImpact : this.range;
      seen = !!hit && aliveAt(this.game.physics.partOf(hit.collider));
    }
    // (a moment's grace, so someone stirring in the beam doesn't flicker it)
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
    // a faint dashed beam, brighter while it sees someone
    this.game.projectiles.drawBeam(e.x, e.y, e.x + e.dx * len, e.y + e.dy * len, PX, this.detecting ? 0x5be37f : 0x2a6a34, 0, PX * 4);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.enabled ? 'Disable' : 'Enable', hint: 'F', action: () => this.activate() }];
    for (const r of [1, 2, 4, 8, 16]) acts.push({ label: `Range ${r} m`, checked: this.range === r, action: () => (this.range = r) });
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

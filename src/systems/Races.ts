import { PX } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { RaceGate } from '../entities/Places';

/** How high (m) over a gate's banner still counts as through it (a plane low over the course). */
const OVER = 4;
/** Off the ground by this much (m) more than it sits, it's in the air (a stunt). */
const AIR_FROM = 0.7;
/** The least air (s) that scores, and the points: a second in the air, a full flip. */
const AIR_MIN = 0.6;
const AIR_POINTS = 100;
const FLIP_POINTS = 500;

/** Something said (a lap, a checkpoint, a stunt), for the screen to show. */
export interface RaceNews {
  text: string;
  good: boolean;
}

/**
 * Races and stunts (0.4.0). What's driven or flown here (its main part: see
 * Controls.raced(), set each step) is watched: through the start/finish gate a lap
 * starts; through each checkpoint in order it goes on; back through the start with all
 * of them passed, the lap's done and timed (the best kept). Off the ground it's in the
 * air: landed upright again, the time in the air and the flips it turned score.
 */
export class Races {
  /** What's raced (set by Controls each step; null: nothing driven). */
  subject: Part | null = null;
  private gates = new Set<RaceGate>();
  private prev: { x: number; y: number; part: Part } | null = null;
  /** The lap under way: when it started, and the checkpoint it's to go through next. */
  lap: { t0: number; next: number } | null = null;
  laps = 0;
  best = Infinity;
  last: number | null = null;
  /** Stunts: points so far, and the jump under way (when it left the ground, how far it's turned). */
  score = 0;
  private jump: { t0: number; turn: number; a0: number } | null = null;
  /** How high it sits on the ground (m over it, settled): what's "in the air" is measured against. */
  private rest = new WeakMap<Part, number>();
  news: RaceNews[] = [];

  constructor(private game: Game) {}

  addGate(g: RaceGate): void {
    this.gates.add(g);
  }

  removeGate(g: RaceGate): void {
    this.gates.delete(g);
  }

  /** The highest checkpoint number there is (0: a start gate only). */
  private lastCheckpoint(): number {
    let n = 0;
    for (const g of this.gates) if (!g.destroyed) n = Math.max(n, g.index);
    return n;
  }

  private say(text: string, good = true): void {
    this.news.push({ text, good });
    if (this.news.length > 8) this.news.shift();
  }

  /** The race's state, as the pilot's readout shows it ('' with no gates or nothing raced). */
  status(): string {
    const out: string[] = [];
    if (this.gates.size && this.subject) {
      const n = this.lastCheckpoint();
      if (this.lap) out.push(`lap ${this.laps + 1} ${clock(this.game.time - this.lap.t0)} · next ${this.lap.next > n ? 'the finish' : `checkpoint ${this.lap.next}`}`);
      else out.push('through the start gate to race');
      if (this.best < Infinity) out.push(`best ${clock(this.best)}`);
    }
    if (this.score) out.push(`stunts ${this.score}`);
    return out.join(' · ');
  }

  reset(): void {
    this.lap = null;
    this.laps = 0;
    this.best = Infinity;
    this.last = null;
    this.score = 0;
    this.jump = null;
    this.prev = null;
  }

  /** The floating origin moved (see world/Origin). */
  shifted(dx: number, dy: number): void {
    if (this.prev) this.prev = { ...this.prev, x: this.prev.x + dx, y: this.prev.y + dy };
  }

  step(dt: number): void {
    const p = this.subject;
    if (!p || p.destroyed) {
      this.prev = null;
      this.jump = null;
      return;
    }
    const at = { x: p.x, y: p.y };
    const was = this.prev?.part === p ? this.prev : null;
    this.prev = { ...at, part: p };
    if (was) for (const g of this.gates) if (!g.destroyed && this.through(g, was, at)) this.passed(g);
    this.stunt(p, dt);
  }

  /** Did it go through `g` (across its line, between its foot and a little over its banner) on its way from `a` to `b`? */
  private through(g: RaceGate, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const q = g.main;
    const gx = q.x;
    if ((a.x - gx) * (b.x - gx) > 0 || a.x === b.x) return false;
    const k = (gx - a.x) / (b.x - a.x);
    const y = a.y + (b.y - a.y) * k;
    const half = (q.h * PX) / 2;
    return y >= q.y - half - 0.5 && y <= q.y + half + OVER;
  }

  private passed(g: RaceGate): void {
    const now = this.game.time;
    const n = this.lastCheckpoint();
    if (g.index === 0) {
      if (this.lap && this.lap.next > n && now - this.lap.t0 > 1) {
        const t = now - this.lap.t0;
        this.laps++;
        this.last = t;
        const best = t < this.best;
        if (best) this.best = t;
        this.say(`Lap ${this.laps}: ${clock(t)}${best ? ' · best!' : ''}`);
      } else if (this.lap && this.lap.next <= n && this.lap.next > 1) {
        this.say(`Missed checkpoint ${this.lap.next}: lap started again`, false);
      } else if (!this.lap) this.say('Go!');
      this.lap = { t0: now, next: 1 };
      g.passed();
      return;
    }
    if (!this.lap || g.index !== this.lap.next) return;
    this.lap.next++;
    g.passed();
    this.say(`Checkpoint ${g.index} of ${n}: ${clock(now - this.lap.t0)}`);
  }

  /** Air and flips: what's raced leaving the ground and landing again. */
  private stunt(p: Part, dt: number): void {
    const ground = this.game.env.groundAt(p.x, p.y);
    const h = p.y - ground;
    const slow = Math.hypot(p.vx, p.vy) < 0.5;
    // (sat still on the ground: how high it sits)
    if (slow && !this.jump) this.rest.set(p, h);
    const base = this.rest.get(p) ?? (p.h * PX) / 2;
    const up = h > base + AIR_FROM;
    if (!this.jump) {
      if (up && !slow) this.jump = { t0: this.game.time, turn: 0, a0: p.bodyAngle };
      return;
    }
    this.jump.turn += p.av * dt;
    if (up) return;
    const j = this.jump;
    this.jump = null;
    const air = this.game.time - j.t0;
    if (air < AIR_MIN) return;
    const flips = Math.floor((Math.abs(j.turn) + 0.6) / (Math.PI * 2));
    const upright = Math.cos(p.bodyAngle - j.a0) > 0.5;
    if (!upright) {
      this.say(`Crashed: ${air.toFixed(1)} s of air lost`, false);
      return;
    }
    const pts = Math.round(air * AIR_POINTS + flips * FLIP_POINTS);
    this.score += pts;
    this.say(`${flips ? `${flips} flip${flips > 1 ? 's' : ''}, ` : ''}${air.toFixed(1)} s air: +${pts}`);
  }
}

/** A time as m:ss.s. */
export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

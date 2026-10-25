import { PX } from '../engine/constants';
import { isLiving } from './Fighting';
import { PK } from './Particles';
import type { Drug } from '../entities/Syringe';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** How often (s) the current is traced through the water, and whoever's in it shocked. */
const TICK = 0.1;
/** How far (m) either way through the sea a current reaches, weaker the further. */
const SEA_REACH = 8;
/** How near (m) a source's own pixels water must be for it to be in it. */
const TOUCH = 0.08;
/** Harm a shock does (a tick, in the thick of it), and the sedative's worth of it (a tesla coil's arc is 0.12), up to KEPT_OUT s of it in them. */
const HARM = 1.5;
const DOSE = 0.04;
const KEPT_OUT = 2;
/** The chance a tick in it stops a heart in it. */
const HEART = 0.004;
/** Seconds whoever's shocked keeps jerking about after. */
const JOLT = 0.25;
const ARC = 0xbfe8ff;
const GLOW = 0x5aa8ff;

/** Where a heart is (see TeslaCoil's). */
const CHEST = new Set(['upperTorso', 'midTorso', 'chest']);

/** Someone a shock can knock out and stop the heart of: people and animals. */
interface Shockable {
  alive: boolean;
  drugs: { knockout: number };
  die(): void;
  inject(drug: Drug, dose: number): void;
  limbOf(p: Part): { spec: { key: string } } | undefined;
}

/**
 * Live water: a battery switched on, or a tesla coil running, in water puts a
 * current through it: through all of the body of water it's in (a tankful, not
 * a splash beside it), or the sea for SEA_REACH either way. Whoever's in it is
 * shocked over and over, the nearer the worse in the sea: hurt, jerked about,
 * soon knocked senseless (and so drowned, likely as not), maybe their heart
 * stopped. The water flickers blue and throws sparks.
 */
export class LiveWater {
  /** The live stretch of the sea (null: none): x from and to (m), and where its sources are. */
  sea: { x0: number; x1: number; at: number[] } | null = null;
  /** What's putting a current through water, as of the last tick. */
  sources: Entity[] = [];
  /** Shocks given (for tests). */
  shocks = 0;
  private t = 0;
  private jolted = new Map<Entity, number>();

  constructor(private readonly game: Game) {}

  /** A step: `show` a guest's, for the look of it only (nobody's hurt: the host's game does that). */
  step(dt: number, show = false): void {
    const g = this.game;
    for (const s of this.sources) if (!s.destroyed) g.sound.hold(this, 'machine/electric_loop', 0.22, s.parts[0]?.x);
    if (this.jolted.size) this.twitch(dt);
    if ((this.t -= dt) > 0) return;
    this.t = TICK;
    this.trace();
    if (!this.sources.length) return;
    this.sparkle();
    if (!show) this.shock();
  }

  /** Finds what's putting a current through water, and marks the water it runs through. */
  private trace(): void {
    const g = this.game;
    g.fluid.clearLive();
    this.sources = [];
    this.sea = null;
    const sea = g.map.water;
    for (const e of g.entities) {
      if (e.destroyed || !e.chargesWater) continue;
      let wet = false;
      for (const p of e.parts) {
        if (p.destroyed) continue;
        // its own pixels, every few, against the water round them
        const nx = Math.max(1, Math.round((p.w * PX) / 0.12));
        const ny = Math.max(1, Math.round((p.h * PX) / 0.12));
        for (let j = 0; j <= ny; j++) {
          for (let i = 0; i <= nx; i++) {
            const at = p.pixelToWorld((i / nx) * (p.w - 1), (j / ny) * (p.h - 1));
            if (g.fluid.markLive(at.x, at.y, TOUCH) > 0) wet = true;
            else if (g.fluid.liveNear(at.x, at.y, TOUCH)) wet = true;
            if (sea && at.x >= sea.x0 && at.x <= sea.x1 && at.y < sea.level) {
              wet = true;
              const s = (this.sea ??= { x0: Infinity, x1: -Infinity, at: [] });
              if (!s.at.includes(at.x)) s.at.push(at.x);
              s.x0 = Math.max(sea.x0, Math.min(s.x0, at.x - SEA_REACH));
              s.x1 = Math.min(sea.x1, Math.max(s.x1, at.x + SEA_REACH));
            }
          }
        }
      }
      if (wet) this.sources.push(e);
    }
  }

  /** How strong the current is at a part (0: none): in live water at all, and in the sea, how near a source. */
  private at(p: Part): number {
    const g = this.game;
    const r = (Math.max(p.w, p.h) / 2) * PX + 0.05;
    if (g.fluid.liveNear(p.x, p.y, r)) return 1;
    const s = this.sea;
    const sea = g.map.water;
    if (!s || !sea || p.x < s.x0 || p.x > s.x1) return 0;
    const hy = 0.5 * PX * (Math.abs(Math.cos(p.a)) * p.h + Math.abs(Math.sin(p.a)) * p.w);
    if (p.y - hy >= sea.level) return 0;
    let near = Infinity;
    for (const x of s.at) near = Math.min(near, Math.abs(p.x - x));
    return Math.max(0, 1 - near / SEA_REACH);
  }

  /** Everyone in live water: shocked, by the part of them most in it. */
  private shock(): void {
    const g = this.game;
    for (const e of g.entities) {
      if (e.destroyed || !isLiving(e)) continue;
      let best: Part | null = null;
      let k = 0;
      for (const p of e.parts) {
        if (p.destroyed) continue;
        const v = this.at(p);
        if (v > k) {
          k = v;
          best = p;
        }
      }
      if (!best || k <= 0.05) continue;
      this.shocks++;
      const h = e as unknown as Shockable;
      const wasAlive = h.alive;
      e.damage(best, HARM * k, 'shock', { x: best.x, y: best.y }, { x: 0, y: -1 });
      if (e.destroyed) continue;
      best.flash = Math.max(best.flash, 0.6 * k);
      this.jolted.set(e, JOLT);
      if (wasAlive && h.alive) {
        // (out cold while it lasts, coming round soon after)
        if (h.drugs.knockout < KEPT_OUT) h.inject('knockout', DOSE * k);
        // (with the current through their chest, it may stop the heart)
        const chest = e.parts.some((p) => !p.destroyed && CHEST.has(h.limbOf(p)?.spec.key ?? '') && this.at(p) > 0);
        if (chest && Math.random() < HEART * k) h.die();
      }
      if (Math.random() < 0.5 * k) {
        g.particles.sparks(best.x, best.y, 0, 1, 3, 2);
        g.sound.spark(best.x);
      }
    }
  }

  /** The live water throws sparks, and lights up round its sources. */
  private sparkle(): void {
    const g = this.game;
    const f = g.fluid;
    for (let k = 0; k < 3; k++) {
      const i = f.someLive();
      if (i < 0) break;
      g.particles.emit(PK.Spark, f.x[i], f.y[i], { vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 0.1, color: ARC, color1: GLOW, alpha1: 0.3, gravity: 0, drag: 4 });
    }
    const s = this.sea;
    if (s && g.map.water) {
      for (let k = 0; k < 3; k++) {
        const x = s.x0 + Math.random() * (s.x1 - s.x0);
        g.particles.emit(PK.Spark, x, g.map.water.level - Math.random() * 0.4, { vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 0.1, color: ARC, color1: GLOW, alpha1: 0.3, gravity: 0, drag: 4 });
      }
    }
    for (const e of this.sources) {
      const p = e.parts[0];
      if (p && !p.destroyed) g.renderer.addLight(p.x, p.y, 2.2, 0.5 + Math.random() * 0.3, GLOW, TICK);
    }
    if (Math.random() < 0.3) g.sound.zap(this.sources[0].parts[0]?.x);
  }

  /** Whoever's shocked jerks about. */
  private twitch(dt: number): void {
    for (const [e, t] of this.jolted) {
      if (e.destroyed || t <= dt) {
        this.jolted.delete(e);
        continue;
      }
      this.jolted.set(e, t - dt);
      for (const q of e.parts) {
        if (q.destroyed || q.frozen) continue;
        const j = Math.min(3, q.mass) * 0.25;
        q.body.applyImpulse({ x: (Math.random() - 0.5) * j, y: (Math.random() - 0.5) * j }, true);
      }
    }
  }

  /** Nothing live any more (a new map, a cleared scene). */
  clear(): void {
    this.sources = [];
    this.sea = null;
    this.jolted.clear();
    this.game.fluid.clearLive();
  }
}

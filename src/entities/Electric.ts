import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import type { V2 } from '../engine/math';
import { Appliance } from './Appliance';
import { PK } from '../systems/Particles';
import { isLiving } from '../systems/Fighting';
import { MAT, type PhysMaterial } from '../world/Materials';
import { TESLA_TOP } from '../art/machines2';
import type { PixelArt } from '../art/PixelArt';
import type { PropConfig } from './Prop';
import type { Drug } from './Syringe';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions } from '../world/types';

/** What a magnet pulls: things (not the floor and walls). */
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);

/** Iron and steel (and an android's frame): what a magnet pulls and what a metal detector finds. */
export function isMetal(m: PhysMaterial): boolean {
  return m === MAT.metal || m === MAT.sheetMetal || m === MAT.robot;
}

// ------------------------------------------------------------------ electromagnet

/** How far (m) an electromagnet reaches. */
export const MAGNET_REACH = 12;
/** Its pull (m/s² on what it pulls) close up, and how far off (m) that has fallen to half. */
const PULL = 60;
const HALF = 2;
/** The most it pulls one part with (N): a car's worth of steel isn't torn off its wheels. */
const PULL_MAX = 4000;
/** How often it looks for what's in reach (s); the pull itself goes on every step. */
const MAGNET_LOOK = 0.1;

let reachBall: RAPIER.Ball | null = null;

/**
 * An electromagnet: while powered (and switched on), it pulls metal things
 * toward itself from up to MAGNET_REACH m away, hardest close up; things are
 * pulled by their weight, and it's pulled toward them in turn.
 */
export class Electromagnet extends Appliance {
  private pulled: Part[] = [];
  private lookT = 0;
  private art: (on: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (on: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  protected changed(on: boolean): void {
    if (!on) this.pulled.length = 0;
    if (!this.destroyed) this.main.setArt(this.art(on));
  }

  /** The metal things in reach, a few times a second. */
  private look(): void {
    const p = this.main;
    const phys = this.game.physics;
    this.pulled.length = 0;
    phys.world.intersectionsWithShape({ x: p.x, y: p.y }, 0, (reachBall ??= new RAPIER.Ball(MAGNET_REACH)), (c) => {
      const q = phys.partOf(c);
      if (q && !q.destroyed && !q.frozen && q.entity !== this && isMetal(q.mat) && !this.pulled.includes(q)) this.pulled.push(q);
      return true;
    }, undefined, THINGS);
  }

  /** The pull (N) on `q` from `d` m off. */
  pullOn(q: Part, d: number): number {
    return Math.min(PULL_MAX, (q.mass * PULL) / (1 + (d / HALF) ** 2));
  }

  protected run(dt: number): void {
    if ((this.lookT -= dt) <= 0) {
      this.lookT = MAGNET_LOOK;
      this.look();
    }
    const p = this.main;
    const t = p.body.translation();
    let rx = 0;
    let ry = 0;
    for (const q of this.pulled) {
      if (q.destroyed || q.frozen) continue;
      const qt = q.body.translation();
      const dx = t.x - qt.x;
      const dy = t.y - qt.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05 || d > MAGNET_REACH) continue;
      const j = (this.pullOn(q, d) * dt) / d;
      q.body.applyImpulse({ x: dx * j, y: dy * j }, true);
      rx -= dx * j;
      ry -= dy * j;
    }
    // (and it toward them: a light magnet slides over to a heavy beam)
    if (!p.frozen && (rx || ry)) p.body.applyImpulse({ x: rx, y: ry }, true);
    this.game.sound.hold(this, 'machine/hum_loop', 0.22, p.x, 1.1);
  }

  frame(): void {
    if (!this.live || this.destroyed) return;
    const w = this.main.pixelToWorld(11, 12);
    this.game.renderer.addLight(w.x, w.y, 2.2, 0.22, 0x8fd8ff);
  }
}

// ------------------------------------------------------------------ tesla coil

/** How far (m) a tesla coil's arcs reach. */
export const TESLA_REACH = 6;
/** Seconds between its arcs: at least this, and up to this much more. */
const ARC_EVERY = 0.35;
const ARC_SPREAD = 0.6;
/** Harm an arc does where it strikes (shock), and how much it chars. */
const ARC_HARM = 14;
const ARC_CHAR = 0.12;
/** The chance an arc to the chest stops a heart. */
const ARC_HEART = 0.15;
/** The sedative's worth of an arc to the living (a stun gun's is 0.17). */
const ARC_DOSE = 0.12;
/** Seconds whoever's struck jerks about for. */
const JOLT = 0.5;
const ARC = 0xbfe8ff;
const GLOW = 0x5aa8ff;

/** Someone a jolt can stop the heart of (and the defibrillator start again): people and animals. */
interface Hearted {
  alive: boolean;
  die(): void;
  restart(): boolean;
  inject?(drug: Drug, dose: number): void;
  limbOf(p: Part): { spec: { key: string } } | undefined;
}

/** Where a heart is: the chest (a person's upper and middle torso, an animal's chest). */
const CHEST = new Set(['upperTorso', 'midTorso', 'chest']);

let arcBall: RAPIER.Ball | null = null;

/**
 * A tesla coil: while powered (and switched on), every so often it throws an
 * arc to something near it (rather a living thing, or metal), or to the floor:
 * a person struck is hurt, burnt and jolted (and an arc to the chest can stop
 * the heart), and anything that burns may catch.
 */
export class TeslaCoil extends Appliance {
  private arcT = ARC_EVERY;
  private art: (on: boolean) => PixelArt;
  /** Who's twitching from an arc, and for how much longer. */
  private jolted = new Map<Entity, number>();
  /** Arcs thrown (for tests). */
  arcs = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (on: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  protected changed(on: boolean): void {
    if (!this.destroyed) this.main.setArt(this.art(on));
  }

  get chargesWater(): boolean {
    return this.live;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.jolted.size) this.twitch(dt);
  }

  protected run(dt: number): void {
    this.game.sound.hold(this, 'machine/electric_loop', 0.16, this.main.x);
    if ((this.arcT -= dt) > 0) return;
    this.arcT = ARC_EVERY + Math.random() * ARC_SPREAD;
    this.strike();
  }

  /** Throws an arc: to something in reach (the living and metal most likely, and the nearest), else the floor, else the air. */
  strike(): void {
    const game = this.game;
    const phys = game.physics;
    const top = this.main.pixelToWorld(TESLA_TOP[0], TESLA_TOP[1]);
    const near: { q: Part; w: number }[] = [];
    let sum = 0;
    phys.world.intersectionsWithShape(top, 0, (arcBall ??= new RAPIER.Ball(TESLA_REACH)), (c) => {
      const q = phys.partOf(c);
      if (!q || q.destroyed || q.entity === this || this.main.noCollide?.has(q)) return true;
      const d = Math.hypot(q.x - top.x, q.y - top.y);
      if (d > TESLA_REACH) return true;
      const living = isLiving(q.entity) && q.entity.alive;
      const w = (living ? 3 : isMetal(q.mat) ? 2 : 1) / (0.5 + d);
      near.push({ q, w });
      sum += w;
      return true;
    }, undefined, THINGS);
    this.arcs++;
    let q: Part | null = null;
    let r = Math.random() * sum;
    for (const n of near) {
      r -= n.w;
      if (r <= 0) {
        q = n.q;
        break;
      }
    }
    if (!q && near.length) q = near[near.length - 1].q;
    let end: V2;
    if (q) end = { x: q.x + (Math.random() - 0.5) * PX * 4, y: q.y + (Math.random() - 0.5) * PX * 4 };
    else {
      // nothing near: down to the floor if it reaches, else a crackle into the air
      const fx = top.x + (Math.random() - 0.5) * 4;
      const fy = game.env.groundAt(fx, top.y);
      end = top.y - fy < TESLA_REACH ? { x: fx, y: fy } : { x: fx, y: top.y + (Math.random() - 0.2) * 2 };
    }
    this.bolt(top, end, !!q);
    game.sound.zap(top.x);
    game.sound.spark(end.x);
    game.particles.sparks(end.x, end.y, top.x - end.x, top.y - end.y, 6, 3);
    game.renderer.addLight(end.x, end.y, 1.8, 0.8, GLOW, 0.12);
    game.renderer.addLight(top.x, top.y, 2.4, 0.8, GLOW, 0.12);
    if (q) this.zap(q, end, top);
  }

  /** The arc into `q` at `at`: shock, scorch, a jolt, maybe fire, maybe a stopped heart. */
  private zap(q: Part, at: V2, from: V2): void {
    const game = this.game;
    const who = q.entity;
    const d = Math.hypot(at.x - from.x, at.y - from.y) || 1;
    const dir = { x: (at.x - from.x) / d, y: (at.y - from.y) / d };
    who.damage(q, ARC_HARM, 'shock', at, dir);
    if (who.destroyed || q.destroyed) return;
    // burnt where it struck
    q.charred = Math.min(1, q.charred + ARC_CHAR);
    q.refreshTint();
    q.paintAt(at.x, at.y, 0x1f1d1b, 1, 0.8);
    q.flash = 1;
    if (!q.frozen) q.body.applyImpulseAtPoint({ x: dir.x * 2, y: dir.y * 2 + 1 }, at, true);
    const living = isLiving(who) && who.alive;
    if (living) {
      who.damage(q, 3, 'fire', at, dir);
      const h = who as unknown as Partial<Hearted>;
      h.inject?.('knockout', ARC_DOSE);
      this.jolted.set(who, JOLT);
      const key = h.limbOf?.(q)?.spec.key;
      if (key && CHEST.has(key) && h.die && h.restart && Math.random() < ARC_HEART) h.die();
      // (only oil soaked into them sets the living alight)
      if (q.oil > 0.05) game.fire.ignite(q, 0.5);
    } else if ((q.mat.flammability > 0 || q.oil > 0) && Math.random() < 0.25 + q.mat.flammability * 0.5 + q.oil) {
      game.fire.ignite(q, 0.4);
    }
  }

  /** Whoever was struck jerks about, now and then sparking. */
  private twitch(dt: number): void {
    for (const [e, t] of this.jolted) {
      if (e.destroyed || t <= dt) {
        this.jolted.delete(e);
        continue;
      }
      this.jolted.set(e, t - dt);
      for (const q of e.parts) {
        if (q.destroyed || q.frozen) continue;
        const j = Math.min(3, q.mass) * 0.3;
        q.body.applyImpulse({ x: (Math.random() - 0.5) * j, y: (Math.random() - 0.5) * j }, true);
      }
      if (Math.random() < dt * 12) {
        const q = e.parts[Math.floor(Math.random() * e.parts.length)];
        if (q && !q.destroyed) this.game.particles.emit(PK.Spark, q.x, q.y, { vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, life: 0.12, color: ARC, color1: GLOW, alpha1: 0.3, gravity: 0, drag: 4 });
      }
    }
  }

  /** A jagged, branching arc from `a` to `b`, flickering once more a moment later. */
  private bolt(a: V2, b: V2, hit: boolean): void {
    const pr = this.game.projectiles;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let k = 0; k < 2; k++) {
      const n = Math.max(4, Math.round(len / 0.3));
      let px = a.x;
      let py = a.y;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const off = i === n ? 0 : (Math.random() - 0.5) * Math.min(0.5, len * 0.15);
        const x = a.x + dx * t + nx * off;
        const y = a.y + dy * t + ny * off;
        pr.drawBeam(px, py, x, y, hit ? 0.04 : 0.03, ARC, 0.1 + k * 0.06);
        pr.drawBeam(px, py, x, y, 0.12, GLOW, 0.08 + k * 0.05);
        // a short fork off now and then
        if (k === 0 && i < n && Math.random() < 0.25) {
          const fl = 0.15 + Math.random() * 0.3;
          const s = Math.random() < 0.5 ? -1 : 1;
          pr.drawBeam(x, y, x + (dx / len) * fl * 0.5 + nx * fl * s, y + (dy / len) * fl * 0.5 + ny * fl * s, 0.025, ARC, 0.08);
        }
        px = x;
        py = y;
      }
    }
  }

  frame(): void {
    if (!this.live || this.destroyed) return;
    const t = this.main.pixelToWorld(TESLA_TOP[0], TESLA_TOP[1] + 2);
    this.game.renderer.addLight(t.x, t.y, 1.6, 0.25 + Math.random() * 0.1, GLOW);
  }
}

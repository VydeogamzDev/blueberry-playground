import { RAPIER } from '../engine/Physics';
import { GROUP, groups } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import { PK } from '../systems/Particles';
import type { HandSwitched } from './Machines';
import type { PixelArt } from '../art/PixelArt';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** What an EMP reaches: things, not the floor and walls. */
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);

/** How far an EMP generator can be set to reach (m), and how long what it hits stays out (s). */
export const EMP_RADII = [4, 8, 12];
export const EMP_TIMES = [3, 8, 15];
/** Seconds before it can go off again. */
const RECHARGE = 2;
/** Seconds its ring takes to spread out to its reach. */
const RING_T = 0.35;
const RING = 0x9fd8ff;
const RING_GLOW = 0x4a8cff;

/** Each game's knocked-out things, and the game time each comes back (the latest of the blasts on it). */
const outages = new WeakMap<Game, Map<Entity, number>>();

function outagesOf(game: Game): Map<Entity, number> {
  let m = outages.get(game);
  if (!m) outages.set(game, (m = new Map()));
  return m;
}

/** Switched on and off by hand (a thruster, a lamp, a car...: see HandSwitched). */
function handSwitched(e: Entity): e is Entity & HandSwitched {
  const h = e as Partial<HandSwitched>;
  return typeof h.on === 'boolean' && typeof h.heldOff === 'boolean';
}

/** Driven with the keys (a car, a tank). */
interface Steered {
  steer(x: number, aim?: number): void;
}

function steered(e: Entity): e is Entity & Steered {
  return typeof (e as Partial<Steered>).steer === 'function';
}

/**
 * An EMP generator: activated (or pulsed, or reached by power), it lets off a
 * pulse that knocks out everything electrical within its reach for a while:
 * machines and lamps get no power and go dead (those switched on by hand are
 * switched off, and back on after), batteries and sensors give none, logic hears
 * nothing, turrets stop, and cars stall, even with someone at the keys.
 */
export class EmpGenerator extends Prop {
  radius = 8;
  duration = 8;
  /** Times it has gone off (for tests). */
  blasts = 0;
  private cool = 0;
  private ringT = 0;
  /** What it knocked out, until when, and the hand-switched ones it switched off (to switch back on). */
  private hit = new Set<Entity>();
  private switchedOff = new Set<Entity & HandSwitched>();
  private until = 0;
  private art: (charging: boolean) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (charging: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
  }

  activate(): void {
    this.blast();
  }

  /** Something it has knocked out, still out. */
  holds(e: Entity): boolean {
    return this.hit.has(e) && this.game.connections.jammed.has(e);
  }

  /** Goes off: everything within its reach is knocked out for its time. */
  blast(): void {
    if (this.cool > 0 || this.destroyed) return;
    const game = this.game;
    const C = game.connections;
    const phys = game.physics;
    const p = this.main;
    this.cool = RECHARGE;
    this.ringT = RING_T;
    this.blasts++;
    p.setArt(this.art(true));
    const found = new Set<Entity>();
    phys.world.intersectionsWithShape({ x: p.x, y: p.y }, 0, new RAPIER.Ball(this.radius), (col) => {
      const q = phys.partOf(col);
      if (q && !q.destroyed && q.entity !== this) found.add(q.entity);
      return true;
    }, undefined, THINGS);
    const until = game.time + this.duration;
    const map = outagesOf(game);
    for (const e of found) {
      if (e.destroyed) continue;
      map.set(e, Math.max(map.get(e) ?? 0, until));
      C.jammed.add(e);
      this.hit.add(e);
      const q = e.parts.find((r) => !r.destroyed);
      if (q) game.particles.sparks(q.x, q.y, 0, 1, 3, 2);
    }
    this.until = Math.max(this.until, until);
    C.recomputePower();
    // what was switched on by hand goes off (its own switch, so it shows), the power gone first
    for (const e of found) {
      if (e.destroyed || !handSwitched(e) || !e.on || e.heldOff) continue;
      e.activate();
      if (!e.on) this.switchedOff.add(e);
    }
    game.particles.flash(p.x, p.y, 0.6, RING, 0.12);
    game.renderer.addLight(p.x, p.y, this.radius * 0.8, 1, RING_GLOW, 0.3);
    game.sound.zap(p.x);
    game.sound.play('machine/zap', { gain: 0.6, x: p.x, rate: 0.45 });
    game.sound.spark(p.x);
  }

  preStep(dt: number): void {
    if (this.cool > 0 && (this.cool -= dt) <= 0 && !this.destroyed) this.main.setArt(this.art(false));
    if (this.ringT > 0) {
      this.ringT -= dt;
      this.ring(1 - Math.max(0, this.ringT) / RING_T);
    }
    if (!this.hit.size) return;
    if (this.game.time < this.until) {
      for (const e of this.hit) {
        // (a car with someone at the keys goes dead too)
        if (!e.destroyed && steered(e) && this.holds(e)) e.steer(0);
      }
      // now and then a spark off something it knocked out
      if (Math.random() < dt * 5) {
        const list = [...this.hit];
        const q = list[Math.floor(Math.random() * list.length)]?.parts.find((r) => !r.destroyed);
        if (q) {
          this.game.particles.emit(PK.Spark, q.x, q.y, {
            vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 0.15, color: RING, color1: RING_GLOW, alpha1: 0.3, gravity: 0, drag: 4,
          });
        }
      }
      return;
    }
    this.release(false);
  }

  /** Its ring, `k` of the way out to its reach. */
  private ring(k: number): void {
    const p = this.main;
    const r = Math.max(0.2, this.radius * k);
    const pr = this.game.projectiles;
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const x0 = p.x + Math.cos(a0) * r;
      const y0 = p.y + Math.sin(a0) * r;
      const x1 = p.x + Math.cos(a1) * r;
      const y1 = p.y + Math.sin(a1) * r;
      pr.drawBeam(x0, y0, x1, y1, 0.05, RING, 0.04);
      pr.drawBeam(x0, y0, x1, y1, 0.2 * (1 - k) + 0.05, RING_GLOW, 0.04);
    }
  }

  /**
   * What it knocked out comes back on: all of it once its time is up, or (taken
   * away early) what's still out on its account alone. What another blast has
   * knocked out since stays out until that one's time is up.
   */
  private release(early: boolean): void {
    const game = this.game;
    const C = game.connections;
    const map = outagesOf(game);
    const upTo = early ? this.until : game.time;
    for (const e of this.hit) {
      if ((map.get(e) ?? 0) > upTo + 1e-6) continue;
      map.delete(e);
      C.jammed.delete(e);
    }
    C.recomputePower();
    for (const e of this.switchedOff) {
      if (e.destroyed || e.on) continue;
      if (C.jammed.has(e)) {
        // still out on another's account: that one switches it back on
        const other = game.entities.find((g): g is EmpGenerator => g instanceof EmpGenerator && g !== this && g.hit.has(e));
        if (other) {
          other.switchedOff.add(e);
          continue;
        }
      }
      // (its power back already, it runs on that: switched on, it runs on after the power goes, as before)
      if (e.powered && !e.heldOff) e.on = true;
      else e.activate();
    }
    this.hit.clear();
    this.switchedOff.clear();
    this.until = 0;
  }

  protected onDestroy(): void {
    if (this.hit.size) this.release(true);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Go off', hint: 'F', disabled: this.cool > 0, action: () => this.activate() }];
    for (const r of EMP_RADII) acts.push({ label: `Reaches ${r} m`, checked: this.radius === r, action: () => (this.radius = r) });
    for (const t of EMP_TIMES) acts.push({ label: `Knocks out for ${t} s`, checked: this.duration === t, action: () => (this.duration = t) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (charging: a guest's copy shows its lamp)
    return { radius: this.radius, duration: this.duration, charging: this.cool > 0 };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (EMP_RADII.includes(x.radius as number)) this.radius = x.radius as number;
    if (EMP_TIMES.includes(x.duration as number)) this.duration = x.duration as number;
    this.main.setArt(this.art(x.charging === true));
  }

  /** What it has knocked out, for how much longer, and which of them it switched off. */
  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    if (!this.hit.size) return undefined;
    const live = [...this.hit].filter((e) => !e.destroyed);
    return {
      left: Math.max(0, this.until - this.game.time),
      hit: live.map(ref).filter((i) => i >= 0),
      off: [...this.switchedOff].filter((e) => !e.destroyed).map(ref).filter((i) => i >= 0),
    };
  }

  /** Knocks them out again for the time that was left (a copy, or a loaded scene). */
  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const left = typeof links.left === 'number' && Number.isFinite(links.left) ? Math.min(Math.max(0, links.left), 60) : 0;
    if (!left || !Array.isArray(links.hit)) return;
    const game = this.game;
    const C = game.connections;
    const map = outagesOf(game);
    this.until = game.time + left;
    for (const i of links.hit) {
      const e = typeof i === 'number' ? get(i) : undefined;
      if (!e || e.destroyed || e === this) continue;
      map.set(e, Math.max(map.get(e) ?? 0, this.until));
      C.jammed.add(e);
      this.hit.add(e);
    }
    if (Array.isArray(links.off)) {
      for (const i of links.off) {
        const e = typeof i === 'number' ? get(i) : undefined;
        if (e && this.hit.has(e) && handSwitched(e)) this.switchedOff.add(e);
      }
    }
    C.recomputePower();
  }
}

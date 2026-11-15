import { PK } from '../systems/Particles';
import { Prop, type PropConfig } from './Prop';
import type { PixelArt } from '../art/PixelArt';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

// Safety gear for what's driven and flown (0.4.0): an airbag and an automatic fire
// extinguisher. Seat belts are a seat's (see Car.belts, Cockpit.belted); g-LOC is the
// cockpit's (see Cockpit.strain).

/** An airbag: how hard (g) a crash sets it off by itself, how long it stays full (s), and how much of a jolt it lets through. */
export const AIRBAG = { g: 12, full: 2, cushion: 0.3 };
/** A seat belt: how much of a jolt it lets through (see cushionOf()). */
export const BELT_CUSHION = 0.6;

/**
 * An airbag: built into a vehicle (anywhere in it), a crash past 12 g (its own sensor) or
 * power reaching it (a wired g-meter set lower, a button) bursts it, and for a moment
 * whoever sits in the vehicle takes a third of the jolt (see cushionOf()). Spent, it
 * hangs there: F packs it again.
 */
export class Airbag extends Prop {
  /** Full (s left), 0: folded or spent. */
  full = 0;
  spent = false;
  private lastV: { x: number; y: number; t: number } | null = null;
  private felt = 1;
  private shown = -1;
  private art: (k: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (k: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
  }

  /** Bursts it (once: spent till packed again). */
  fire(): void {
    if (this.spent || !this.works || this.destroyed) return;
    this.spent = true;
    this.full = AIRBAG.full;
    const p = this.main;
    this.game.sound.play('machine/air_release', { gain: 0.7, x: p.x, rate: 1.6 });
    for (let i = 0; i < 8; i++) {
      this.game.particles.emit(PK.Smoke, p.x + (Math.random() - 0.5) * 0.4, p.y + (Math.random() - 0.5) * 0.4, {
        vx: (Math.random() - 0.5) * 2, vy: Math.random(), life: 0.8, size: 0.06, size1: 0.2, color: 0xffffff, alpha: 0.6, alpha1: 0, gravity: -0.2, drag: 2,
      });
    }
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (on) this.fire();
  }

  onPulse(): void {
    this.fire();
  }

  preStep(dt: number): void {
    const p = this.main;
    const g = this.game;
    // its own crash sensor: the g it's put through (less gravity's pull), looked at every step
    const now = { x: p.vx, y: p.vy, t: g.time };
    const was = this.lastV;
    this.lastV = now;
    if (was && now.t > was.t && now.t - was.t < 0.5 && !p.frozen) {
      const d = now.t - was.t;
      const felt = Math.hypot((now.x - was.x) / d, (now.y - was.y) / d - g.gravity) / 9.81;
      this.felt += (felt - this.felt) * 0.6;
      if (this.felt > AIRBAG.g) this.fire();
    }
    if (this.full > 0) this.full = Math.max(0, this.full - dt);
    const k = this.full > 0 ? 1 : 0;
    if (k !== this.shown && !this.destroyed) {
      this.shown = k;
      p.setArt(this.art(k));
    }
  }

  /**
   * Looked at mid-crash (see bagCushion()), between its own looks: a sudden enough stop
   * since this step began bursts it there and then, as a real one does in the first
   * hundredths of a second, before the riders are thrown forward.
   */
  sense(): void {
    const was = this.lastV;
    const p = this.main;
    if (this.spent || !was || p.frozen || p.destroyed) return;
    const d = Math.max(this.game.time - was.t, this.game.stepDt);
    const felt = Math.hypot((p.vx - was.x) / d, (p.vy - was.y) / d - this.game.gravity) / 9.81;
    if (felt > AIRBAG.g * 2) this.fire();
  }

  /** F: packs it again (spent), or sets it off. */
  activate(): void {
    if (this.spent && this.full <= 0) {
      this.spent = false;
      this.game.sound.button(this.main.x);
    } else this.fire();
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.full > 0 ? 'Full' : this.spent ? 'Spent' : 'Armed', disabled: true, action: () => {} },
      this.spent ? { label: 'Pack it again', hint: 'F', action: () => this.activate() } : { label: 'Set it off', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return this.spent ? { spent: true } : {};
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.spent = x.spent === true;
  }
}

const bagCache = new WeakMap<Entity, { at: number; bags: Airbag[] }>();

/**
 * How much of a jolt someone sat in `vehicle` takes (see Human.jolted()): a seat belt
 * lets 0.6 of it through, a full airbag in the vehicle's build 0.3; both, less.
 */
export function cushionOf(game: Game, vehicle: Entity): number {
  let k = 1;
  const v = vehicle as { belted?: boolean; belts?: boolean };
  if (v.belted || v.belts) k *= BELT_CUSHION;
  return k * bagCushion(game, vehicle);
}

/** An airbag's share alone (1: none full in `vehicle`'s build). */
export function bagCushion(game: Game, vehicle: Entity): number {
  let c = bagCache.get(vehicle);
  if (!c || game.time - c.at > 0.5 || game.time < c.at) {
    c = { at: game.time, bags: game.connections.assemblyOf([vehicle]).filter((e): e is Airbag => e instanceof Airbag) };
    bagCache.set(vehicle, c);
  }
  for (const b of c.bags) if (!b.destroyed && b.full <= 0) b.sense();
  return c.bags.some((b) => !b.destroyed && b.full > 0) ? AIRBAG.cushion : 1;
}

/** An automatic extinguisher: its charge (s of spraying), how far it reaches (m) and how hard it damps a fire (a second). */
export const SUPPRESSOR = { charge: 12, reach: 5, damp: 1.5 };

/**
 * An automatic fire extinguisher: built into a vehicle, it watches the build and the
 * people in it, and the moment any of it catches fire it sprays it out (as far as 5 m
 * off) till its 12 s of charge are gone. F refills it.
 */
export class FireSuppressor extends Prop {
  charge = SUPPRESSOR.charge;
  spraying = false;
  private lookT = 0;
  private ents: Entity[] = [];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  preStep(dt: number): void {
    const g = this.game;
    if (g.net?.guest) return;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.25;
      // (its build, and whoever rides in it)
      const set = new Set(g.connections.assemblyOf([this]));
      for (const e of [...set]) for (const a of e.attachedEntities()) set.add(a);
      this.ents = [...set];
    }
    this.spraying = false;
    if (this.charge <= 0 || !this.works || this.main.frozen) return;
    const me = this.main;
    const r2 = SUPPRESSOR.reach ** 2;
    for (const e of this.ents) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.burning <= 0 || (p.x - me.x) ** 2 + (p.y - me.y) ** 2 > r2) continue;
        this.spraying = true;
        g.fire.douse(p, SUPPRESSOR.damp * dt);
        if (Math.random() < 0.4) {
          g.particles.emit(PK.Smoke, p.x + (Math.random() - 0.5) * 0.3, p.y + (Math.random() - 0.5) * 0.3, {
            vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 0.8, life: 0.7, size: 0.08, size1: 0.3, color: 0xffffff, color1: 0xe8eef2, alpha: 0.7, alpha1: 0, gravity: -0.1, drag: 2,
          });
        }
      }
    }
    if (this.spraying) {
      this.charge = Math.max(0, this.charge - dt);
      g.sound.hold(this, 'machine/extinguisher_loop', 0.3, me.x, 1);
    }
  }

  activate(): void {
    this.charge = SUPPRESSOR.charge;
    this.game.sound.button(this.main.x);
  }

  contextActions(): ContextAction[] {
    return [
      { label: `Charge: ${Math.round((this.charge / SUPPRESSOR.charge) * 100)}%`, disabled: true, action: () => {} },
      { label: 'Refill', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { charge: this.charge };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.charge = typeof x.charge === 'number' && Number.isFinite(x.charge) ? Math.max(0, Math.min(SUPPRESSOR.charge, x.charge)) : SUPPRESSOR.charge;
  }
}

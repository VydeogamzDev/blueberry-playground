import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Item, type HoldSpec } from './Item';
import { PK } from '../systems/Particles';
import { chainsawArt, SAW_BAR, SAW_FRAMES } from '../art/gear';
import type { PropConfig } from './Prop';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { V2 } from '../engine/math';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** Seconds from the cord being pulled to the motor catching (the chain starts to run). */
const CRANK = 0.45;
/** How long the starting sound runs on as the engine idles (no idle loop over it meanwhile). */
const START_SOUND = 2.4;
/** Seconds between the bites the chain takes out of what it touches. */
const TICK = 0.1;
/** Harm a second at full revs to what it cuts: flesh, wood and the like, an android's shell, metal and stone. */
const CUT_FLESH = 70;
const CUT_SOFT = 70;
const CUT_SYNTH = 28;
const CUT_HARD = 4;
/** What the chain cuts through; what it sparks and skips on (see bite()). */
const FLESH = new Set(['Flesh', 'Bone']);
const SOFT = new Set(['Wood', 'Plastic', 'Rubber', 'Glass']);
/** How hard (N) the running chain drags what it touches along the bar. */
const CHAIN_PULL = 30;
/** Kickback off something hard: a shove (N·s) back and away from it, every so often (s). */
const KICK = 7;
const KICK_EVERY = 0.3;
/** Seconds held against metal or stone before the engine bogs down and stalls, and before it can be started again. */
const STALL = 1.6;
const RESTART = 1.2;
/** Past this share of its hit points below nothing, a cut-up limb is torn to bits (see Human.gib()). */
const SHRED = 0.6;
/** What the bar's cutting edge feels for: the floor and walls and anything solid (not things set to collide with nothing). */
const FEEL = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

/** A body that can have a limb torn to bits (people and animals: see Human.limbOf() and gib(), and Creature's). */
interface Gibbable {
  limbOf(p: Part): { spec: { hp: number }; gone: boolean; parent: unknown } | undefined;
  gib(limb: unknown): void;
}

let bar: RAPIER.Cuboid | null = null;

/**
 * A chainsaw. Use starts it (a pull on the cord; the motor catches a moment
 * later) and stops it again; power down a wire runs it, and so does a person
 * holding it in a fight. Running, its chain bites into whatever the bar touches:
 * flesh (limbs come off, and what's cut off is torn to bits if it's sawn on),
 * wood and plastic. On metal and stone it only throws sparks, kicks back and
 * bogs down, and held there it stalls. It runs lying about too, and bucks about
 * on the floor.
 */
export class Chainsaw extends Item {
  /** Switched on (Use): it runs, as it does while powered or while its holder fights. */
  on = false;
  /** The engine is running (whatever started it). */
  running = false;
  /** (people's blows with it are cuts: see Human) */
  readonly blade = true;
  /** Seconds until the motor catches after a start, and of the starting sound left. */
  private crank = 0;
  private startT = 0;
  /** How hard it's working (0 idle .. 1 flat out, cutting), and how bogged down on something hard (s). */
  private rev = 0;
  private bog = 0;
  /** Seconds before it can be started again after stalling. */
  private stallT = 0;
  private tickT = 0;
  private kickT = 0;
  /** Touching something this step: cutting it, or skipping on something hard. */
  private cutting = false;
  private hard = false;
  /** The chain's run round the bar (see frame()). */
  private chainT = 0;
  private shown = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, ccd: true }, hold, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.swings = true;
    this.blunt = 1.2;
  }

  /** Starts it, or stops it if it's running. */
  activate(): void {
    this.on = !this.running;
    if (!this.on) this.stop();
  }

  canRest(): boolean {
    return !this.running;
  }

  /** Does whoever holds it have someone to fight? Then it's kept running. */
  private fighting(): boolean {
    const h = this.holder as (Entity & { foe?: Entity | null; alive?: boolean }) | null;
    return !!h && !!h.foe && h.alive !== false;
  }

  preStep(dt: number): void {
    if (this.stallT > 0) this.stallT -= dt;
    const want = this.on || this.powered || this.fighting();
    if (want && !this.running && this.stallT <= 0) this.start();
    else if (!want && this.running) this.stop();
    if (!this.running) {
      this.rev = 0;
      return;
    }
    if (this.crank > 0) {
      this.crank -= dt;
      return;
    }
    this.startT -= dt;
    // flat out while cutting, or with the trigger held (Use held down, a fight); else idling
    const target = this.cutting || this.activeHeld || this.fighting() ? 1 : 0.15;
    this.rev += (target - this.rev) * Math.min(1, dt * (target > this.rev ? 6 : 2));
    // something hard under the bar: it bogs down, and held there, stalls
    this.bog = this.hard ? this.bog + dt : Math.max(0, this.bog - dt * 2);
    if (this.bog > STALL) {
      this.stall();
      return;
    }
    const p = this.main;
    const bogged = Math.min(1, this.bog / STALL);
    if (this.rev > 0.4 || this.startT <= 0) {
      const loud = this.rev > 0.4;
      this.game.sound.hold(this, loud ? 'machine/chainsaw_loop' : 'machine/chainsaw_idle_loop', loud ? 0.55 : 0.45, p.x, loud ? 0.88 + this.rev * 0.12 - bogged * 0.22 : 1);
    }
    // a wisp of exhaust now and then
    if (Math.random() < dt * (1 + this.rev * 3)) {
      const m = p.pixelToWorld(19, 11);
      this.game.particles.emit(PK.Smoke, m.x, m.y, {
        vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.3, life: 0.8 + Math.random() * 0.6,
        size: 0.05, size1: 0.22, color: 0x9a9894, color1: 0x6e6c6a, alpha: 0.35, alpha1: 0, gravity: -0.04, drag: 1.5,
      });
    }
  }

  /** A pull on the cord: the motor catches a moment later. */
  private start(): void {
    this.running = true;
    this.crank = CRANK;
    this.startT = START_SOUND;
    this.rev = 0;
    this.bog = 0;
    this.game.sound.play('machine/chainsaw_start', { gain: 0.8, x: this.main.x, vary: 0.03 });
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.on = false;
    this.cutting = this.hard = false;
    this.rev = 0;
    this.bog = 0;
  }

  /** Bogged down on something hard: the engine dies with a puff of smoke, and has to be started again. */
  private stall(): void {
    const m = this.main.pixelToWorld(19, 11);
    this.stop();
    this.stallT = RESTART;
    this.game.particles.smoke(m.x, m.y, 3, 0.2, true);
    this.game.sound.play('gun/dryfire', { gain: 0.5, x: m.x, rate: 0.6 });
  }

  postStep(dt: number): void {
    super.postStep(dt);
    this.cutting = this.hard = false;
    if (!this.running || this.crank > 0 || this.destroyed) return;
    this.tickT -= dt;
    this.kickT -= dt;
    const bite = this.tickT <= 0;
    if (bite) this.tickT = TICK;
    for (const t of this.touching()) this.chew(t.part, t.at, dt, bite);
  }

  /**
   * What the bar's edge touches: each part (null: the floor or a wall), and
   * where along the bar. Not the saw, nor whoever holds it.
   */
  private touching(): { part: Part | null; at: V2 }[] {
    const p = this.main;
    const phys = this.game.physics;
    const a = p.pixelToWorld(SAW_BAR.x0, (SAW_BAR.y0 + SAW_BAR.y1) / 2);
    const b = p.pixelToWorld(SAW_BAR.x1, (SAW_BAR.y0 + SAW_BAR.y1) / 2);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // (the bar and its cutters, and a hair more)
    bar ??= new RAPIER.Cuboid(((SAW_BAR.x1 - SAW_BAR.x0 + 1) / 2) * PX, ((SAW_BAR.y1 - SAW_BAR.y0 + 1) / 2 + 1.5) * PX);
    const found = new Map<Part | null, V2>();
    const holder = this.holder;
    phys.world.intersectionsWithShape(c, p.body.rotation(), bar, (col) => {
      const q = phys.partOf(col) ?? null;
      if (q && (q.destroyed || q.entity === this || q.entity === holder || q.noCollide?.has(p) || p.noCollide?.has(q))) return true;
      if (found.has(q)) return true;
      // where along the bar: nearest its middle line to what it touches (the floor: the bar's lowest point)
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let k: number;
      if (q) k = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy)));
      else k = a.y < b.y ? 0 : 1;
      found.set(q, { x: a.x + dx * k, y: a.y + dy * k });
      return true;
    }, undefined, FEEL, undefined, p.body);
    return [...found].map(([part, at]) => ({ part, at }));
  }

  /**
   * The running chain on `q` (null: the floor or a wall) at `at`: it drags it
   * along the bar and, each TICK, bites into it; something hard throws sparks
   * and kicks the saw back.
   */
  private chew(q: Part | null, at: V2, dt: number, bite: boolean): void {
    const game = this.game;
    const p = this.main;
    const fwd = this.forward();
    const up = p.localDir(0, 1);
    // which side of the bar it's on: the chain runs back along the bottom and out along the top
    const below = q ? (q.x - at.x) * up.x + (q.y - at.y) * up.y < 0 : true;
    const run = below ? { x: -fwd.x, y: -fwd.y } : fwd;
    const mat = q?.mat.name ?? 'Concrete';
    const flesh = FLESH.has(mat);
    const soft = flesh || SOFT.has(mat) || mat === 'Synthetic';
    const power = 0.35 + this.rev * 0.65;
    if (soft) {
      this.cutting = true;
      if (q && !q.frozen) q.body.applyImpulseAtPoint({ x: run.x * CHAIN_PULL * dt, y: run.y * CHAIN_PULL * dt }, at, true);
      if (!p.frozen) p.body.applyImpulseAtPoint({ x: -run.x * CHAIN_PULL * dt, y: -run.y * CHAIN_PULL * dt }, at, true);
    } else {
      this.hard = true;
      // sparks off the chain, flung the way it runs
      if (Math.random() < 0.5) game.particles.sparks(at.x, at.y, run.x, run.y, 2, 5);
      if (this.kickT <= 0 && !p.frozen) {
        this.kickT = KICK_EVERY * (0.7 + Math.random() * 0.6);
        const away = q ? { x: below ? up.x : -up.x, y: below ? up.y : -up.y } : { x: 0, y: 1 };
        const tip = p.pixelToWorld(SAW_BAR.x1, (SAW_BAR.y0 + SAW_BAR.y1) / 2);
        p.body.applyImpulseAtPoint({ x: (-fwd.x * 0.5 + away.x) * KICK, y: (-fwd.y * 0.5 + away.y) * KICK }, tip, true);
        game.sound.play('hit/metal', { gain: 0.25, x: at.x, rate: 1.3, vary: 0.1 });
      }
    }
    if (!bite || !q || q.destroyed) return;
    const rate = flesh ? CUT_FLESH : mat === 'Synthetic' ? CUT_SYNTH : soft ? CUT_SOFT : CUT_HARD;
    const who = q.entity;
    who.damage(q, rate * TICK * power, 'cut', at, run);
    if (flesh) {
      game.particles.blood(at.x, at.y, run.x, run.y + 0.3, 7, 3.5, q.destroyed ? null : q.body);
      if (Math.random() < 0.35) game.particles.debris(at.x, at.y, run.x, run.y + 0.5, 2, 0x8e1a1a, 3);
      if (Math.random() < 0.4) game.sound.squish(0.5, at.x, 0.6);
    } else if (soft) {
      // sawdust and chips, or an android's sparks
      if (mat === 'Synthetic') game.particles.sparks(at.x, at.y, run.x, run.y, 4, 4);
      else game.particles.debris(at.x, at.y, run.x, run.y + 0.4, 3, q.mat.debrisColor, 2.5);
    }
    // a limb sawn on past what it can take is torn to bits (not the chest, which has no
    // parent: it holds the rest together)
    const body = who as Entity & Partial<Gibbable>;
    if (flesh && !q.destroyed && body.limbOf && body.gib) {
      const l = body.limbOf(q);
      if (l && !l.gone && l.parent && q.hp < -l.spec.hp * SHRED) body.gib(l);
    }
  }

  /** The chain runs round the bar (on every screen: drawn as a frame is). */
  frame(dt: number): void {
    if (!this.running || this.crank > 0 || this.destroyed) return;
    this.chainT += dt * (8 + this.rev * 22) * (1 - Math.min(0.8, this.bog / STALL));
    const f = Math.floor(this.chainT) % SAW_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(chainsawArt(f));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.running ? 'Stop' : 'Start', hint: 'F', action: () => this.activate() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (always something: a guest's copy runs its chain round from this, and learns from the change that it's stopped)
    return { on: this.on, run: this.running };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on === true;
    const run = x.run === true;
    if (run && !this.running) {
      this.running = true;
      this.crank = 0;
      this.startT = 0;
    } else if (!run) this.running = false;
  }
}

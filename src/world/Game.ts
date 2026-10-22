import { capture, instantiateIndexed, mirror, mirrorLocal } from './Snapshot';
import { RAPIER, Physics } from '../engine/Physics';
import { Renderer } from '../engine/Renderer';
import { Sound } from '../engine/Sound';
import { FIXED_DT, MAX_STEPS_PER_FRAME, WORLD } from '../engine/constants';
import { Environment } from './Environment';
import { Particles, Stains } from '../systems/Particles';
import { Impacts } from '../systems/Impacts';
import { Projectiles } from '../systems/Projectiles';
import { Explosions } from '../systems/Explosions';
import { Connections } from '../systems/Connections';
import { Fire } from '../systems/Fire';
import type { Entity } from './Entity';
import type { Part } from './Part';
import type { ItemDef, SpawnOptions } from './types';
import { settle, REST_CHECK } from '../systems/Settle';

export interface GameHooks {
  onEntitiesChanged?: () => void;
  onPartRemoved?: (p: Part) => void;
  onEntityRemoved?: (e: Entity) => void;
}

/** Central hub: owns the world, systems, entity list and the fixed-step loop. */
export class Game {
  readonly renderer: Renderer;
  readonly physics: Physics;
  readonly sound = new Sound();
  readonly particles: Particles;
  readonly stains: Stains;
  readonly env: Environment;
  readonly impacts: Impacts;
  readonly projectiles: Projectiles;
  readonly explosions: Explosions;
  readonly connections: Connections;
  readonly fire: Fire;

  readonly entities: Entity[] = [];
  readonly hooks: GameHooks = {};
  private pendingRemoval: Entity[] = [];
  private stepping = false;
  private zCounter = 0;

  paused = false;
  timeScale = 1;
  /** Extra steps requested while paused (single-step). */
  stepRequests = 0;
  /** Simulated time in seconds. */
  time = 0;
  private acc = 0;
  private restTick = -1;
  private lastTime = 0;

  /** Called once per physics step before entity logic (drag forces, tools). */
  preStepHandlers: ((dt: number) => void)[] = [];
  /** Called once per rendered frame. */
  frameHandlers: ((dt: number, alpha: number) => void)[] = [];

  // perf stats
  fps = 60;
  stepMs = 0;
  frameMs = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.physics = new Physics();
    this.env = new Environment(this.physics, this.renderer.scene);
    this.particles = new Particles(this);
    this.stains = new Stains(this.renderer.scene);
    this.impacts = new Impacts(this);
    this.projectiles = new Projectiles(this);
    this.explosions = new Explosions(this);
    this.connections = new Connections(this);
    this.fire = new Fire(this);
    this.sound.panFor = (x) => {
      const r = this.renderer;
      return ((x - r.camX) * r.zoom) / (r.viewWidth / 2);
    };
  }

  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  allocZ(): number {
    this.zCounter = (this.zCounter + 1) % 1400;
    return this.zCounter * 0.02;
  }

  // ---- entities -------------------------------------------------------------

  /** Re-creates an entity (and anything it holds) mirrored around its center. */
  flipEntity(e: Entity): Entity | null {
    return this.flipEntities([e])[0] ?? null;
  }

  /**
   * Mirrors entities (with what they hold) as one group around their common
   * center, so a selected contraption keeps its layout. Returns the new copies
   * of `list`, in order.
   */
  flipEntities(list: Entity[]): Entity[] {
    const group: Entity[] = [];
    const add = (g: Entity) => {
      if (!g.destroyed && !group.includes(g)) group.push(g);
    };
    list.forEach(add);
    const mains = group.length;
    if (!mains) return [];
    for (const g of group.slice(0, mains)) g.attachedEntities().forEach(add);
    const index = new Map(group.map((g, i) => [g, i]));
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const g of group.slice(0, mains)) {
      for (const p of g.parts) {
        if (p.destroyed) continue;
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
      }
    }
    const c = mains === 1 ? group[0].center() : { x: (x0 + x1) / 2 };
    const snap = mirror(capture(this, group), c.x);
    // connections to things outside the group are re-made on the mirrored parts
    const outside = this.connections.list.flatMap((k) => {
      const ia = index.get(k.a.entity);
      const ib = k.b ? index.get(k.b.entity) : undefined;
      if (!k.b || (ia === undefined) === (ib === undefined)) return [];
      const mine = ia !== undefined ? k.a : k.b;
      const other = ia !== undefined ? k.b : k.a;
      return [{
        kind: k.kind, rest: k.rest, mineIsA: ia !== undefined, other,
        gi: (ia ?? ib)!, pi: mine.entity.parts.indexOf(mine),
        lm: ia !== undefined ? k.la : k.lb, lo: ia !== undefined ? k.lb : k.la,
      }];
    });
    for (const g of group) this.remove(g);
    const made = instantiateIndexed(this, snap);
    for (const k of outside) {
      const mine = made[k.gi]?.parts[k.pi];
      if (!mine || mine.destroyed || k.other.destroyed) continue;
      const lm = mirrorLocal(k.lm);
      const wm = mine.localToWorld(lm.x, lm.y);
      const wo = k.other.localToWorld(k.lo.x, k.lo.y);
      if (k.mineIsA) this.connections.create(k.kind, mine, wm, k.other, wo, k.rest);
      else this.connections.create(k.kind, k.other, wo, mine, wm, k.rest);
    }
    return made.slice(0, mains).filter((m): m is Entity => !!m);
  }

  spawn(def: ItemDef, x: number, y: number, opts: SpawnOptions = {}): Entity | null {
    if (!def.create) return null;
    x = Math.max(WORLD.left + 0.3, Math.min(WORLD.right - 0.3, x));
    const e = def.create(this, x, y, opts);
    this.entities.push(e);
    this.hooks.onEntitiesChanged?.();
    return e;
  }

  /** Schedules an entity for removal (safe to call mid-step). */
  remove(e: Entity): void {
    if (e.destroyed || this.pendingRemoval.includes(e)) return;
    if (this.stepping) {
      this.pendingRemoval.push(e);
      return;
    }
    this.removeNow(e);
  }

  private removeNow(e: Entity): void {
    if (e.destroyed) return;
    this.connections.removeFor(e);
    e.destroy();
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    this.hooks.onEntityRemoved?.(e);
    this.hooks.onEntitiesChanged?.();
  }

  onPartRemoved(p: Part): void {
    this.connections.removeForPart(p);
    this.hooks.onPartRemoved?.(p);
  }

  clearAll(): void {
    for (const e of [...this.entities]) this.removeNow(e);
    this.projectiles.clear();
    this.particles.clear();
    this.connections.clearAll();
  }

  /** Clears entities and all stains/effects. */
  resetEnvironment(): void {
    this.clearAll();
    this.stains.clear();
    this.fire.clear();
  }

  // ---- queries ----------------------------------------------------------------

  /** Returns the front-most part at a world point, within `radius` meters. */
  pick(x: number, y: number, radius = 0, filter?: (p: Part) => boolean): Part | null {
    const world = this.physics.world;
    let best: Part | null = null;
    let bestZ = -Infinity;
    world.intersectionsWithPoint({ x, y }, (c) => {
      const p = this.physics.partOf(c);
      if (p && !p.destroyed && (!filter || filter(p)) && p.mesh.position.z > bestZ) {
        best = p;
        bestZ = p.mesh.position.z;
      }
      return true;
    });
    if (best || radius <= 0) return best;
    let bestD = Infinity;
    world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(radius), (c) => {
      const p = this.physics.partOf(c);
      if (!p || p.destroyed || (filter && !filter(p))) return true;
      const proj = c.projectPoint({ x, y }, true);
      const d = proj ? Math.hypot(proj.point.x - x, proj.point.y - y) : radius;
      // prefer nearer; break near-ties by z
      if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && p.mesh.position.z > bestZ)) {
        best = p;
        bestD = d;
        bestZ = p.mesh.position.z;
      }
      return true;
    });
    return best;
  }

  /** Entities whose parts overlap a world-space rectangle. */
  entitiesInRect(x0: number, y0: number, x1: number, y1: number): Entity[] {
    const out = new Set<Entity>();
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hx = Math.abs(x1 - x0) / 2;
    const hy = Math.abs(y1 - y0) / 2;
    this.physics.world.intersectionsWithShape({ x: cx, y: cy }, 0, new RAPIER.Cuboid(Math.max(hx, 0.001), Math.max(hy, 0.001)), (c) => {
      const p = this.physics.partOf(c);
      if (p && !p.destroyed && !p.entity.destroyed) out.add(p.entity);
      return true;
    });
    return [...out];
  }

  // ---- simulation loop ------------------------------------------------------

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const t0 = performance.now();
    const realDt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    if (!this.paused) this.acc += realDt * this.timeScale;
    let steps = 0;
    const s0 = performance.now();
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    while (this.stepRequests > 0) {
      this.step();
      this.stepRequests--;
      steps++;
    }
    const stepTime = performance.now() - s0;
    if (steps > 0) this.stepMs = this.stepMs * 0.9 + (stepTime / steps) * 0.1;

    const alpha = this.paused ? 1 : Math.min(1, this.acc / FIXED_DT);
    this.renderFrame(realDt, alpha);
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  /** Runs per-frame logic and draws the scene. */
  renderFrame(realDt: number, alpha: number): void {
    for (const h of this.frameHandlers) h(realDt, alpha);
    for (const e of this.entities) {
      e.frame(realDt);
      for (const p of e.parts) if (!p.destroyed) p.render(alpha);
    }
    this.connections.frame(alpha);
    this.fire.frame();
    this.projectiles.frame();
    this.particles.frame();
    this.stains.frame(this.renderer.zoom * this.renderer.dpr);
    this.sound.rate = this.paused ? 1 : this.timeScale;
    this.sound.update(realDt);
    this.renderer.render(realDt);
  }

  /**
   * Synchronously simulates `seconds` of game time and renders once. Used by
   * automated tests (works even when the page is hidden and rAF is throttled).
   */
  advance(seconds: number, onStep?: (i: number) => void): void {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      onStep?.(i);
      this.step();
    }
    this.renderFrame(1 / 60, 1);
  }

  /** Advances the simulation by exactly one fixed step. */
  step(): void {
    const dt = FIXED_DT;
    this.stepping = true;
    for (const h of this.preStepHandlers) h(dt);
    for (const e of this.entities) if (!e.destroyed) e.preStep(dt);
    this.connections.preStep(dt);
    this.physics.step();
    this.impacts.process();
    this.projectiles.step(dt);
    for (const e of this.entities) if (!e.destroyed) e.postStep(dt);
    const tick = Math.floor(this.time / REST_CHECK);
    if (tick !== this.restTick) {
      this.restTick = tick;
      settle(this, this.entities);
    }
    for (const e of this.entities) for (const p of e.parts) if (!p.destroyed) p.sync();
    this.connections.postStep(dt);
    this.fire.step(dt);
    this.explosions.step(dt);
    this.particles.step(dt);
    this.time += dt;
    this.stepping = false;
    if (this.pendingRemoval.length) {
      const list = this.pendingRemoval;
      this.pendingRemoval = [];
      for (const e of list) this.removeNow(e);
    }
  }
}

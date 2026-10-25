import { capture, instantiateIndexed, mirror, mirrorLocal } from './Snapshot';
import { RAPIER, Physics } from '../engine/Physics';
import { Renderer } from '../engine/Renderer';
import { Sound } from '../engine/Sound';
import { Music } from '../engine/Music';
import { COARSE_DT, FIXED_DT, MAX_STEPS_PER_FRAME, STEP_BUDGET_MS, STEP_SLACK, WORLD } from '../engine/constants';
import { Environment } from './Environment';
import { applyBounds, LAB, type MapSpec } from './Maps';
import { Particles, Stains } from '../systems/Particles';
import { Casings } from '../systems/Casings';
import { Impacts } from '../systems/Impacts';
import { Projectiles } from '../systems/Projectiles';
import { Explosions } from '../systems/Explosions';
import { Connections } from '../systems/Connections';
import { Fire } from '../systems/Fire';
import { Weather } from '../systems/Weather';
import { Water } from '../systems/Water';
import { Fluid } from '../systems/Fluid';
import { stats } from './Stats';
import { Puddles } from '../systems/Puddles';
import { ContactGroups } from '../systems/ContactGroups';
import { liftOutOfGround } from '../systems/GroundLift';
import type { Entity } from './Entity';
import type { Part } from './Part';
import type { EntityConfig, ItemDef, SpawnOptions } from './types';
import { rotate, type V2 } from '../engine/math';
import { settle, restCheck, wakeSettled, resleepSettled, REST_CHECK } from '../systems/Settle';

/** Seconds the short step must look affordable before a heavy scene goes back to it (see Game.pickStep()). */
const BACK_AFTER = 2;

export interface GameHooks {
  onEntitiesChanged?: () => void;
  onPartRemoved?: (p: Part) => void;
  onEntityRemoved?: (e: Entity) => void;
}

/** What the game needs of a multiplayer session (see net/Session). */
export interface NetRole {
  /** Joined someone else's game: the world shown is theirs, copied, not simulated here. */
  readonly guest: boolean;
  /** A guest's step: where everything should be now (the host's poses, a moment ago). */
  pose(dt: number): void;
}

/** Central hub: owns the world, systems, entity list and the fixed-step loop. */
export class Game {
  readonly renderer: Renderer;
  readonly physics: Physics;
  readonly sound = new Sound();
  readonly music = new Music(this.sound);
  readonly particles: Particles;
  /** Spent cases thrown from guns. */
  readonly casings: Casings;
  readonly stains: Stains;
  readonly puddles: Puddles;
  readonly env: Environment;
  readonly impacts: Impacts;
  readonly projectiles: Projectiles;
  readonly explosions: Explosions;
  readonly connections: Connections;
  readonly contactGroups: ContactGroups;
  readonly fire: Fire;
  /** A map's sea, and the void's drop (see systems/Water). */
  readonly water: Water;
  readonly fluid: Fluid;
  /** Rain, snow, fog and lightning, and the world's light (Settings > World). */
  readonly weather: Weather;
  /** What players do, counted (the pause menu's statistics). */
  readonly stats = stats;

  readonly entities: Entity[] = [];
  readonly hooks: GameHooks = {};
  /** The map being played on: its size, look and ground (see world/Maps; switch with setMap()). */
  map: MapSpec = LAB;
  /** A multiplayer game, hosted or joined (null: playing alone). */
  net: NetRole | null = null;
  /** Inside renderFrame(): effects made then are each screen's own, not sent to guests (see net/Effects). */
  inFrame = false;
  /** Above 0, effects made aren't sent to guests: they make those themselves (fire's flames; see net/Effects). */
  fxMute = 0;
  /** Goes up whenever the whole scene is cleared away (a load, Clear): a host then sends its guests everything again. */
  sceneVersion = 0;
  private pendingRemoval: Entity[] = [];
  private stepping = false;
  private zCounter = 0;

  paused = false;
  timeScale = 1;

  /** Gravity (m/s², downward negative: GRAVITY on Earth); Settings > Physics changes it. */
  get gravity(): number {
    return this.physics.world.gravity.y;
  }

  setGravity(y: number): void {
    const w = this.physics.world;
    if (w.gravity.y === y) return;
    w.gravity = { x: 0, y };
    // (things at rest sleep: they'd stay hanging where they lay when it comes back on)
    w.bodies.forEach((b) => {
      if (b.isDynamic()) b.wakeUp();
    });
  }
  /** Extra steps requested while paused (single-step). */
  stepRequests = 0;
  /** Simulated time in seconds. */
  time = 0;
  /** Length of a physics step (s): FIXED_DT, or COARSE_DT while the scene is too heavy for real time (see pickStep()). */
  stepDt = FIXED_DT;
  /** Always the long step (Settings > Graphics' lightest physics), rather than the short one while the scene allows. */
  longSteps = false;
  /** How long (s) the step has looked worth changing (see pickStep()). */
  private pickT = 0;
  /** How long (s) the short step must look affordable before going back to it (see pickStep()). */
  private backAfter = BACK_AFTER;
  /** Real time (s) on the short step since a heavy scene last went back to it (Infinity: it hasn't). */
  private fineT = Infinity;
  private acc = 0;
  private restTick = -1;
  /** Groups of parts put to sleep together by settle(). */
  readonly slept: Part[][] = [];
  private lastTime = 0;

  /** Called once per physics step before entity logic (drag forces, tools). */
  preStepHandlers: ((dt: number) => void)[] = [];
  /** Called once per physics step after it, when things may be added and removed again. */
  postStepHandlers: (() => void)[] = [];
  /** Called once per rendered frame. */
  frameHandlers: ((dt: number, alpha: number) => void)[] = [];

  /**
   * Frames drawn a second at most (Settings > Graphics): 0 as many as the
   * screen shows, Infinity as many as the computer can make (more than the
   * screen shows aren't all seen: it's how fast the game could go).
   */
  fpsCap = 0;
  /** The screen's refresh (Hz): measured from the animation frames' spacing, unless set (see setDisplayHz()). */
  displayHz = 60;
  /**
   * Animation frames aren't held to the screen's refresh: the desktop app
   * started with its frame-rate limit off (see engine/Desktop). Then "as the
   * screen refreshes" is a cap like the others, at displayHz.
   */
  unthrottled = false;
  private hzSet = false;
  private rafAt = 0;
  /** The least spacing of the animation frames (ms), this couple of seconds and the last. */
  private rafMin = Infinity;
  private rafMinWas = Infinity;
  private rafWindow = 0;
  /** When the next capped frame is due (performance.now(), ms). */
  private nextFrame = 0;
  /** A message loop is making frames between the animation frames (see pump()). */
  private pumping = false;
  private pumpChannel: MessageChannel | null = null;

  // perf stats
  fps = 60;
  stepMs = 0;
  /** Simulated seconds per real second the loop managed (below timeScale when the scene is too heavy). */
  simRate = 1;
  /** The same smoothed but unclamped: a single frame's rate is usually 0 or over 1. */
  private rateAvg = 1;
  frameMs = 0;
  /** Milliseconds spent per stage, summed while set (see debug/bench). */
  prof: Record<string, number> | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.physics = new Physics();
    this.env = new Environment(this.physics, this.renderer.scene);
    this.particles = new Particles(this);
    this.casings = new Casings(this);
    this.stains = new Stains(this.renderer.scene);
    this.puddles = new Puddles(this, this.renderer.scene);
    this.impacts = new Impacts(this);
    this.projectiles = new Projectiles(this);
    this.explosions = new Explosions(this);
    this.connections = new Connections(this);
    this.contactGroups = new ContactGroups(this);
    this.fire = new Fire(this);
    // (the sea first: the weather's drops stop at its surface)
    this.water = new Water(this);
    this.fluid = new Fluid(this);
    this.weather = new Weather(this);
    this.frameHandlers.push((dt) => this.stats.frame(dt));
    this.sound.panFor = (x) => {
      const r = this.renderer;
      return ((x - r.camX) * r.zoom) / (r.viewWidth / 2);
    };
  }

  start(): void {
    this.lastTime = performance.now();
    // (from now on: the starter scene wasn't the player's doing)
    this.stats.counting = true;
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
        // (a limit stays, measured from the mirrored pose: the other end isn't mirrored)
        swing: k.limit !== undefined ? { limit: k.limit } : undefined,
        stiffness: k.stiffness,
        opts: k.opts,
      }];
    });
    for (const g of group) this.remove(g);
    const made = instantiateIndexed(this, snap);
    // (made again, not wired by anyone: see Stats)
    this.stats.quiet++;
    for (const k of outside) {
      const mine = made[k.gi]?.parts[k.pi];
      if (!mine || mine.destroyed || k.other.destroyed) continue;
      const lm = mirrorLocal(k.lm);
      const wm = mine.localToWorld(lm.x, lm.y);
      const wo = k.other.localToWorld(k.lo.x, k.lo.y);
      if (k.mineIsA) this.connections.create(k.kind, mine, wm, k.other, wo, k.rest, k.swing, k.stiffness, k.opts);
      else this.connections.create(k.kind, k.other, wo, mine, wm, k.rest, k.swing, k.stiffness, k.opts);
    }
    this.stats.quiet--;
    group.forEach((g, i) => {
      const m = made[i];
      if (m) this.successors.set(g, m);
    });
    return made.slice(0, mains).filter((m): m is Entity => !!m);
  }

  /**
   * What took the place of an entity made again (mirrored, or resized: see
   * flipEntities() and rebuild()), for whoever kept hold of the old one.
   */
  readonly successors = new WeakMap<Entity, Entity>();

  /** The entity that now stands for `e`: itself, or what it was made again as (null: gone). */
  successorOf(e: Entity): Entity | null {
    let at: Entity | undefined = e;
    for (let n = 0; at && at.destroyed && n < 50; n++) at = this.successors.get(at);
    return at && !at.destroyed ? at : null;
  }

  /**
   * Makes an object again with another config (a new size), its first part's
   * center moved to `at` (default: where it is), keeping its motion, damage
   * and fire, and every connection to it at the same place in the world.
   * Paint (wounds, scorch) is dropped: it was painted on the old sprite.
   */
  rebuildEntity(e: Entity, config: EntityConfig | undefined, at?: V2): Entity | null {
    if (e.destroyed || !e.def.create) return null;
    const p0 = e.parts[0];
    const t = p0.body.translation();
    const dx = at ? at.x - t.x : 0;
    const dy = at ? at.y - t.y : 0;
    const snap = capture(this, [e]);
    const s = snap.entities[0];
    s.config = config;
    s.parts = s.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy, paint: undefined }));
    const health = e.parts.map((p) => (Number.isFinite(p.maxHp) && p.maxHp > 0 ? p.hp / p.maxHp : 1));
    // anchors on it stay where they are in the world as its parts move
    const shifted = (p: Part, l: V2): V2 => {
      const r = rotate(dx, dy, -p.body.rotation());
      return { x: l.x - r.x, y: l.y - r.y };
    };
    for (const c of snap.connections) {
      c.la = shifted(e.parts[c.a[1]], c.la);
      if (c.b) c.lb = shifted(e.parts[c.b[1]], c.lb);
    }
    const outside = this.connections.connectionsOf(e).filter((k) => k.b && (k.a.entity === e) !== (k.b.entity === e)).map((k) => {
      const mineIsA = k.a.entity === e;
      const mine = mineIsA ? k.a : k.b!;
      return {
        kind: k.kind, rest: k.rest, mineIsA, other: mineIsA ? k.b! : k.a, pi: e.parts.indexOf(mine),
        lm: shifted(mine, mineIsA ? k.la : k.lb), lo: mineIsA ? k.lb : k.la,
        swing: k.limit !== undefined ? { limit: k.limit, ref: k.ref } : undefined,
        stiffness: k.stiffness,
        opts: k.opts,
      };
    });
    this.remove(e);
    const made = instantiateIndexed(this, snap)[0];
    if (!made) return null;
    made.parts.forEach((p, i) => {
      if (!p.destroyed && Number.isFinite(p.maxHp)) p.hp = p.maxHp * (health[i] ?? 1);
    });
    this.stats.quiet++;
    for (const k of outside) {
      const mine = made.parts[k.pi];
      if (!mine || mine.destroyed || k.other.destroyed) continue;
      const wm = mine.localToWorld(k.lm.x, k.lm.y);
      const wo = k.other.localToWorld(k.lo.x, k.lo.y);
      if (k.mineIsA) this.connections.create(k.kind, mine, wm, k.other, wo, k.rest, k.swing, k.stiffness, k.opts);
      else this.connections.create(k.kind, k.other, wo, mine, wm, k.rest, k.swing, k.stiffness, k.opts);
    }
    this.stats.quiet--;
    this.successors.set(e, made);
    return made;
  }

  spawn(def: ItemDef, x: number, y: number, opts: SpawnOptions = {}): Entity | null {
    if (!def.create) return null;
    x = Math.max(WORLD.left + 0.3, Math.min(WORLD.right - 0.3, x));
    const e = def.create(this, x, y, opts);
    this.entities.push(e);
    // (what things make of themselves in a step, a bolt loaded or a shell fired, isn't spawned by anyone)
    if (!this.stepping && !this.net?.guest) this.stats.spawned(e);
    this.hooks.onEntitiesChanged?.();
    return e;
  }

  /** A blast or a gunshot at (x, y): anything within `radius` m that can hear it reacts (animals run). */
  alarm(x: number, y: number, radius: number): void {
    for (const e of this.entities) if (!e.destroyed) e.onAlarm(x, y, radius);
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
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    if (e.destroyed) return;
    this.connections.removeFor(e);
    e.destroy();
    this.hooks.onEntityRemoved?.(e);
    this.hooks.onEntitiesChanged?.();
  }

  onPartRemoved(p: Part): void {
    this.connections.removeForPart(p);
    this.hooks.onPartRemoved?.(p);
  }

  clearAll(): void {
    this.sceneVersion++;
    for (const e of [...this.entities]) this.removeNow(e);
    this.slept.length = 0;
    this.projectiles.clear();
    this.particles.clear();
    this.casings.clear();
    this.connections.clearAll();
  }

  /** Clears entities and all stains/effects: liquid on the floor, fires, drops in the air, blasts still to go off. */
  resetEnvironment(): void {
    this.clearAll();
    this.stains.clear();
    this.puddles.clear();
    this.fluid.clear();
    this.fire.clear();
    this.explosions.clear();
  }

  // ---- maps -------------------------------------------------------------------

  /**
   * Switches to another map: clears the scene, sets the world's bounds (WORLD),
   * builds the map's room, ground and backdrop, and (moveCamera) puts the camera
   * over the middle of its floor at the usual zoom. A map the same size and look
   * as the one in play only has its ground rebuilt.
   */
  setMap(spec: MapSpec, moveCamera = true): void {
    const before = this.map;
    this.resetEnvironment();
    this.map = spec;
    // (a map with weather of its own brings it: the Snow map's snow)
    this.weather.onMap(before, spec);
    if (spec.width !== before.width || spec.height !== before.height || spec.theme !== before.theme || !spec.endless !== !before.endless) {
      applyBounds(spec);
      this.env.build(spec);
      this.puddles.resize();
      this.renderer.setBackdrop(this.env.backdrop);
      this.puddles.block(this.env);
    } else if (spec.terrain !== before.terrain) this.reshapeMap(spec);
    const r = this.renderer;
    if (moveCamera) {
      // (the zoom first: how high the view goes over the floor depends on it)
      r.zoom = r.targetZoom = r.fitZoom;
      const home = this.home();
      r.camX = home.x;
      r.camY = home.y;
    }
    r.clampCamera();
  }

  /** Changes the ground of the map in play, keeping the scene (the Terrain tool): `spec` is the same size and look. */
  reshapeMap(spec: MapSpec): void {
    this.map = spec;
    this.env.buildGround(spec);
    this.puddles.block(this.env);
    // (laid where things are: they stand on it, rather than being shot out of it)
    liftOutOfGround(this);
  }

  /** Where the camera goes home to: over the middle of the floor (or the ground there). */
  home(): V2 {
    const x = (WORLD.left + WORLD.right) / 2;
    return { x, y: this.env.groundAt(x, WORLD.ceiling) + this.renderer.floorLift };
  }

  // ---- queries ----------------------------------------------------------------

  /**
   * Colliders the scene queries can't be trusted with, to test one by one:
   * things spawned this step (not in them yet), and while time is paused
   * everything (things moved by hand then stay where the queries last saw them
   * until the next step: a crate dragged while paused couldn't be picked up
   * again where it was put, only where it had been).
   */
  private looseColliders(): RAPIER.Collider[] {
    if (!this.paused) return this.physics.fresh.filter((c) => c.isValid());
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    const out: RAPIER.Collider[] = [];
    for (const e of this.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) if (!p.destroyed) for (const c of p.colliders) out.push(c);
    }
    return out;
  }

  /**
   * Returns the part at a world point (else the nearest within `radius`
   * meters). Of several stacked there, the smallest: a bolt on a plate, a
   * grenade on a crate, a gun in a hand (of two about as big, the front one).
   */
  pick(x: number, y: number, radius = 0, filter?: (p: Part) => boolean): Part | null {
    const world = this.physics.world;
    const all = this.paused;
    const fresh = this.looseColliders();
    let best: Part | null = null;
    let bestZ = -Infinity;
    const onPoint = (c: RAPIER.Collider): boolean => {
      const p = this.physics.partOf(c);
      if (p && !p.destroyed && (!filter || filter(p)) && (!best || pickedOver(p, best))) {
        best = p;
        bestZ = p.z;
      }
      return true;
    };
    if (!all) world.intersectionsWithPoint({ x, y }, onPoint);
    for (const c of fresh) if (c.containsPoint({ x, y })) onPoint(c);
    if (best || radius <= 0) return best;
    let bestD = Infinity;
    const near = (c: RAPIER.Collider): boolean => {
      const p = this.physics.partOf(c);
      if (!p || p.destroyed || (filter && !filter(p))) return true;
      const proj = c.projectPoint({ x, y }, true);
      const d = proj ? Math.hypot(proj.point.x - x, proj.point.y - y) : radius;
      // prefer nearer; break near-ties by z
      if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && p.z > bestZ)) {
        best = p;
        bestD = d;
        bestZ = p.z;
      }
      return true;
    };
    if (!all) world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(radius), near);
    for (const c of fresh) {
      const proj = c.projectPoint({ x, y }, true);
      if (proj && Math.hypot(proj.point.x - x, proj.point.y - y) <= radius) near(c);
    }
    return best;
  }

  /** Every part at a world point (else within `radius`), in pick()'s order: the smallest first (Alt+click goes through them). */
  pickAll(x: number, y: number, radius = 0, filter?: (p: Part) => boolean): Part[] {
    const out = new Set<Part>();
    const take = (p: Part | null) => {
      if (p && !p.destroyed && (!filter || filter(p))) out.add(p);
    };
    const world = this.physics.world;
    const fresh = this.looseColliders();
    if (!this.paused) world.intersectionsWithPoint({ x, y }, (c) => (take(this.physics.partOf(c) ?? null), true));
    for (const c of fresh) if (c.containsPoint({ x, y })) take(this.physics.partOf(c) ?? null);
    if (!out.size && radius > 0) take(this.pick(x, y, radius, filter));
    return [...out].sort((a, b) => (pickedOver(a, b) ? -1 : pickedOver(b, a) ? 1 : 0));
  }

  /** Entities whose parts overlap a world-space rectangle. */
  entitiesInRect(x0: number, y0: number, x1: number, y1: number): Entity[] {
    const out = new Set<Entity>();
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hx = Math.abs(x1 - x0) / 2;
    const hy = Math.abs(y1 - y0) / 2;
    const box = new RAPIER.Cuboid(Math.max(hx, 0.001), Math.max(hy, 0.001));
    const add = (c: RAPIER.Collider) => {
      const p = this.physics.partOf(c);
      if (p && !p.destroyed && !p.entity.destroyed) out.add(p.entity);
      return true;
    };
    // (while paused, by hand: see looseColliders())
    if (this.paused) {
      for (const c of this.looseColliders()) if (c.intersectsShape(box, { x: cx, y: cy }, 0)) add(c);
    } else this.physics.world.intersectionsWithShape({ x: cx, y: cy }, 0, box, add);
    return [...out];
  }

  // ---- simulation loop ------------------------------------------------------

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    this.measureHz(now);
    const cap = this.fpsCap || (this.unthrottled ? this.displayHz : 0);
    if (!cap) return this.frameAt(now);
    this.capped(now, cap);
    // a cap above the screen's refresh (or none): a message loop makes the frames between (unthrottled, the animation frames come fast enough)
    if (this.fpsCap > this.displayHz * 1.05 && !this.pumping && !this.unthrottled) this.pump();
  };

  /**
   * The screen's refresh, from the animation frames: the least spacing between
   * them over a couple of seconds (a slow frame only makes one gap longer).
   */
  private measureHz(now: number): void {
    const gap = now - this.rafAt;
    this.rafAt = now;
    if (this.hzSet || !(gap > 1)) return;
    this.rafMin = Math.min(this.rafMin, gap);
    this.rafWindow += gap;
    if (this.rafWindow < 2000) return;
    this.displayHz = 1000 / Math.min(this.rafMin, this.rafMinWas);
    this.rafMinWas = this.rafMin;
    this.rafMin = Infinity;
    this.rafWindow = 0;
  }

  /** The screen's refresh, told rather than measured (the desktop app, whose animation frames may run unthrottled). */
  setDisplayHz(hz: number): void {
    this.displayHz = hz;
    this.hzSet = true;
  }

  /** A capped frame rate: a frame when one is due (called by the animation frames, and the message loop between them). */
  private capped(now: number, cap = this.fpsCap): void {
    const gap = 1000 / cap;
    // (from the animation frames, the one nearest when it's due: half a refresh early will do)
    const early = this.pumping || this.unthrottled ? 0.25 : 500 / this.displayHz;
    if (now + early < this.nextFrame) return;
    // (a long frame isn't made up for with a burst of quick ones)
    this.nextFrame = now - this.nextFrame > gap ? now + gap : this.nextFrame + gap;
    this.frameAt(now);
  }

  /**
   * Frames between the animation frames, for a cap above the screen's refresh
   * (or none): each as soon as it's due, by a message to itself, which isn't
   * held back as a timer is (a timer for the longer waits). Stops with a lower
   * cap, or a hidden page (where a worker runs the frames: see keepRunning()).
   */
  private pump(): void {
    const ch = (this.pumpChannel ??= new MessageChannel());
    this.pumping = true;
    ch.port1.onmessage = () => {
      if (!(this.fpsCap > this.displayHz * 1.05) || document.hidden) {
        this.pumping = false;
        return;
      }
      this.capped(performance.now());
      const wait = this.nextFrame - performance.now();
      if (wait > 4) setTimeout(() => ch.port2.postMessage(0), wait - 2);
      else ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  }

  /** The physics' share of a frame (ms): more when the frames come further apart (a cap under 60). */
  private get stepBudget(): number {
    return this.fpsCap > 0 && this.fpsCap < 60 ? (STEP_BUDGET_MS * 60) / this.fpsCap : STEP_BUDGET_MS;
  }

  /**
   * Keeps the game going while its tab is hidden (a multiplayer game: the others
   * are still playing in it), where the browser stops animation frames: a
   * worker's timer runs the frames instead, about 30 a second, undrawn. (Timers
   * on the page itself are slowed to once a second in a hidden tab; a worker's aren't.)
   */
  keepRunning(on: boolean): void {
    if (on === this.keepOn) return;
    this.keepOn = on;
    if (on) document.addEventListener('visibilitychange', this.onVisibility);
    else document.removeEventListener('visibilitychange', this.onVisibility);
    this.onVisibility();
  }

  private keepOn = false;
  private keeper: { stop(): void } | null = null;

  private onVisibility = (): void => {
    const want = this.keepOn && document.hidden;
    if (want === !!this.keeper) return;
    if (!want) {
      this.keeper!.stop();
      this.keeper = null;
      // (the animation frames take over again, from now)
      this.lastTime = performance.now();
      return;
    }
    const tick = () => this.frameAt(performance.now());
    try {
      const url = URL.createObjectURL(new Blob(['let t = 0; onmessage = (e) => { clearInterval(t); t = setInterval(() => postMessage(0), e.data); };'], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = tick;
      w.postMessage(33);
      this.keeper = { stop: () => w.terminate() };
    } catch {
      // (no workers here: the page's own timer, however slowed)
      const t = setInterval(tick, 33);
      this.keeper = { stop: () => clearInterval(t) };
    }
  };

  /**
   * Set once Rapier has panicked (a freed body asked about, say): every call into
   * it fails from then on, so the frames stop rather than throw, every one of them.
   */
  halted = false;

  private frameAt(now: number): void {
    if (this.halted) return;
    try {
      this.frameBody(now);
    } catch (e) {
      if (!/unreachable|recursive use|memory access out of bounds/.test(String(e))) throw e;
      this.halted = true;
      console.error('The physics engine broke; the game has stopped (reload to go on).', e);
    }
  }

  private frameBody(now: number): void {
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
    // a slow frame rate (a throttled tab, a slow GPU) still gets real time while
    // the physics is cheap; a heavy scene slows down rather than stalling: steps
    // stop when the next one wouldn't fit in the frame's budget
    const dt = this.stepDt;
    const due = dt - STEP_SLACK;
    while (this.acc >= due && steps < MAX_STEPS_PER_FRAME) {
      if (steps > 0 && performance.now() - s0 + this.stepMs > this.stepBudget) break;
      this.step();
      this.acc -= dt;
      steps++;
    }
    // time that didn't fit is dropped, not owed, all but the next step: a scene
    // that fits one step a frame and no more would otherwise lose a whole step
    // whenever a frame came a little late (and skip one when the next came early)
    if (this.acc >= due) this.acc = due - 1e-6;
    if (!this.paused && realDt > 0) {
      // clamped only after averaging: on a screen refreshing faster than the
      // physics steps, most frames take no step and the rest one, so clamping
      // each frame's rate read real time as slow motion
      const rate = (steps * dt) / realDt;
      this.rateAvg += (rate - this.rateAvg) * Math.min(1, realDt * 2);
      this.simRate = Math.min(this.rateAvg, this.timeScale);
    }
    while (this.stepRequests > 0) {
      this.step();
      this.stepRequests--;
      steps++;
    }
    const stepTime = performance.now() - s0;
    if (steps > 0) this.stepMs = this.stepMs * 0.9 + (stepTime / steps) * 0.1;
    if (!this.paused && realDt > 0) this.pickStep(realDt);

    const alpha = this.paused ? 1 : Math.min(1, Math.max(0, this.acc / dt));
    this.renderFrame(realDt, alpha);
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /**
   * A scene too heavy to keep up with in real time takes longer steps, half as
   * many, rather than running in slow motion (as soon as the steps cost more than
   * the frames allow, or after falling behind for a second);
   * it goes back to the short ones once they would fit in the frames' budget
   * easily for a couple of seconds. A short step costs about what a long one
   * does: it's the number of them that halves. A scene that turns out too heavy
   * again soon after (a lull in a battle) waits twice as long the next time.
   */
  private pickStep(realDt: number): void {
    if (this.longSteps) {
      if (this.stepDt !== COARSE_DT) {
        this.stepDt = COARSE_DT;
        this.acc = 0;
      }
      return;
    }
    const coarse = this.stepDt !== FIXED_DT;
    if (!coarse) this.fineT += realDt;
    // CPU per real second the short step would take, against what a second of
    // frames allows (a second at most, however fast the screen refreshes)
    const fineCost = (this.stepMs / FIXED_DT) * this.timeScale;
    const allowed = Math.min(1000, this.stepBudget * Math.max(1, this.fps));
    // too heavy for the short step: by the steps' own cost (half a second of it),
    // or by the slow motion (a second of it)
    const over = !coarse && fineCost > allowed;
    const change = coarse ? fineCost < allowed * 0.7 : over || this.simRate < this.timeScale * 0.9;
    this.pickT = change ? this.pickT + realDt : 0;
    if (this.pickT < (coarse ? this.backAfter : over ? 0.5 : 1)) return;
    this.pickT = 0;
    if (!coarse) this.backAfter = this.fineT < 10 ? Math.min(16, this.backAfter * 2) : BACK_AFTER;
    this.fineT = coarse ? 0 : Infinity;
    this.stepDt = coarse ? FIXED_DT : COARSE_DT;
    this.acc = 0;
  }

  /** Back to the short step, as if the scene had never been too heavy (tests time their own). */
  resetStep(): void {
    this.stepDt = FIXED_DT;
    this.pickT = 0;
    this.backAfter = BACK_AFTER;
    this.fineT = Infinity;
    this.rateAvg = this.simRate = this.timeScale;
  }

  /** Runs per-frame logic and draws the scene. */
  renderFrame(realDt: number, alpha: number): void {
    this.inFrame = true;
    try {
      this.drawFrame(realDt, alpha);
    } finally {
      this.inFrame = false;
    }
  }

  private drawFrame(realDt: number, alpha: number): void {
    const lap = this.lapper();
    for (const h of this.frameHandlers) h(realDt, alpha);
    for (const e of this.entities) {
      e.frame(realDt);
      for (const p of e.parts) if (!p.destroyed) p.render(alpha);
    }
    lap?.('frame: entities');
    this.connections.frame(alpha);
    this.fire.frame();
    this.puddles.frame();
    this.projectiles.frame();
    this.particles.frame();
    this.casings.frame();
    this.stains.frame(this.renderer.zoom * this.renderer.dpr);
    this.env.frame(this.renderer.camX);
    this.sound.rate = this.paused ? 1 : this.timeScale;
    this.sound.update(realDt);
    lap?.('frame: effects');
    // (a hidden tab kept running for a multiplayer game shows nothing: see keepRunning())
    if (!document.hidden) this.renderer.render(realDt);
    else this.renderer.skipFrame(realDt);
    lap?.('frame: draw');
  }

  /** While profiling, a function that adds the time since its last call to a stage. */
  private lapper(): ((stage: string) => void) | null {
    const prof = this.prof;
    if (!prof) return null;
    let t = performance.now();
    return (stage) => {
      const n = performance.now();
      prof[stage] = (prof[stage] ?? 0) + n - t;
      t = n;
    };
  }

  /**
   * Synchronously simulates `seconds` of game time and renders once. Used by
   * automated tests (works even when the page is hidden and rAF is throttled).
   */
  advance(seconds: number, onStep?: (i: number) => void): void {
    const n = Math.round(seconds / this.stepDt);
    for (let i = 0; i < n; i++) {
      onStep?.(i);
      this.step();
    }
    this.renderFrame(1 / 60, 1);
  }

  /** Advances the simulation by exactly one fixed step. */
  step(): void {
    const dt = this.stepDt;
    this.physics.setDt(dt);
    if (this.net?.guest) {
      this.guestStep(dt);
      return;
    }
    const lap = this.lapper();
    this.stepping = true;
    for (const h of this.preStepHandlers) h(dt);
    for (const e of this.entities) if (!e.destroyed) e.preStep(dt);
    lap?.('step: control');
    wakeSettled(this);
    this.contactGroups.update();
    lap?.('step: groups');
    this.physics.step();
    this.physics.readPoses(this.entities);
    resleepSettled(this);
    lap?.('step: physics');
    this.impacts.process();
    this.projectiles.step(dt);
    lap?.('step: impacts');
    for (const e of this.entities) if (!e.destroyed) e.postStep(dt);
    lap?.('step: control');
    const tick = Math.floor(this.time / REST_CHECK);
    if (tick !== this.restTick) {
      this.restTick = tick;
      restCheck(this.entities);
      settle(this, this.entities);
    }
    lap?.('step: settle');
    this.physics.syncAll(this.entities);
    this.connections.postStep(dt);
    lap?.('step: sync');
    this.fire.step(dt);
    this.weather.step(dt);
    this.water.step(dt);
    lap?.('step: effects');
    this.fluid.step(dt);
    lap?.('step: fluid');
    this.explosions.step(dt);
    this.particles.step(dt);
    this.casings.step(dt);
    this.puddles.step(dt);
    this.stats.step(this, dt);
    lap?.('step: effects');
    this.time += dt;
    this.stepping = false;
    if (this.pendingRemoval.length) {
      const list = this.pendingRemoval;
      this.pendingRemoval = [];
      for (const e of list) this.removeNow(e);
    }
    for (const h of this.postStepHandlers) h();
  }

  /**
   * A step in someone else's game: nothing is simulated here. Everything is put
   * where the host had it (moved, not pushed: the guest's bodies are kinematic),
   * and only what's for show runs on: particles, flames, bullets' tracers.
   * What the host's step did (blood, sounds, scorch) arrives from it.
   */
  private guestStep(dt: number): void {
    this.stepping = true;
    for (const h of this.preStepHandlers) h(dt);
    this.net!.pose(dt);
    this.physics.step();
    // (nothing here reads what bumped into what)
    this.physics.events.clear();
    this.physics.syncAll(this.entities);
    this.fire.showStep(dt);
    this.puddles.showStep(dt);
    this.fluid.step(dt, true);
    this.particles.step(dt);
    this.casings.step(dt);
    this.projectiles.step(dt);
    this.time += dt;
    this.stepping = false;
    if (this.pendingRemoval.length) {
      const list = this.pendingRemoval;
      this.pendingRemoval = [];
      for (const e of list) this.removeNow(e);
    }
    for (const h of this.postStepHandlers) h();
  }
}

/**
 * Whether `p` is picked rather than `q` where both are under the cursor: a thing
 * held over whoever holds it (else only the end of a long gun, past the hand,
 * arm and body, is the gun's), then the smaller (by its sprite's area), or of
 * two about as big, the one in front.
 */
function pickedOver(p: Part, q: Part): boolean {
  if (heldBy(p.entity, q.entity)) return true;
  if (heldBy(q.entity, p.entity)) return false;
  const ap = p.w * p.h;
  const aq = q.w * q.h;
  if (ap < aq * 0.8) return true;
  if (aq < ap * 0.8) return false;
  return p.z > q.z;
}
const heldBy = (item: Entity, e: Entity) => (item as { holder?: Entity | null }).holder === e;

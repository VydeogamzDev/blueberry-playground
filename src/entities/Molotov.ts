import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { Liquid } from '../systems/Liquids';
import { HEAT } from '../systems/Fire';
import { PK } from '../systems/Particles';
import { molotovArt, BOTTLE_SHARDS, RAG_KNOT, RAG_PATH } from '../art/ordnance';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { V2 } from '../engine/math';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

/** Approach speed (m/s) that smashes the bottle against anything: a throw, even a gentle lob, or a fall from waist height. */
const SHATTER_SPEED = 4.5;
/** Seconds a lit rag takes to burn down into the neck, where it sets the bottle off. */
export const RAG_TIME = 12;
/** Oil drops a smashed bottle splashes (a flask pours ~270; this holds about half as much). */
const DROPS = 140;
/** Heat (see Fire.warm()) that catches the rag, and that cracks the bottle in a fire. */
const CATCH = 0.4;
const BURST = 2.5;
/** How big (m) the gout of flame is where a lit bottle smashes. */
const FLARE = 1.3;

/**
 * A molotov cocktail: a bottle of oil with a rag stuffed in its neck. Use lights
 * the rag. Thrown at anything (dragged and flung), it smashes on a hard enough
 * knock and splashes oil over what it hit and the floor round it; a lit one sets
 * the splash alight. A bullet or a blast breaks it too, and a fire's heat
 * catches the rag and then cracks the glass. A lit rag left alone burns down
 * into the bottle and sets it off where it is.
 */
export class Molotov extends Item {
  lit = false;
  /** Seconds of rag left to burn. */
  timer = RAG_TIME;
  /** Its sprite as last drawn (the rag's length, and whether it burns). */
  private shown = `${RAG_PATH.length}:false`;
  private heat = 0;
  private broken = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.activatable = true;
  }

  /** Pixels of the rag's strip not burnt yet. */
  get ragLeft(): number {
    const n = RAG_PATH.length;
    return this.lit ? Math.max(0, Math.min(n, Math.ceil((n * this.timer) / RAG_TIME))) : n;
  }

  /** Where the rag burns: its strip's end, then the knot in the bottle's mouth. */
  private flamePoint(): V2 {
    const left = this.ragLeft;
    const [x, y] = left > 0 ? RAG_PATH[RAG_PATH.length - left] : RAG_KNOT;
    return this.main.pixelToWorld(x, y);
  }

  /** Lights the rag. */
  activate(): void {
    if (this.lit || this.broken || this.destroyed) return;
    this.lit = true;
    this.timer = RAG_TIME;
    const w = this.flamePoint();
    for (let i = 0; i < 5; i++) this.flame(w, 1.6);
    this.game.sound.play('fire/whoosh', { gain: 0.13, x: w.x, rate: 1.5 });
    this.refresh();
  }

  preStep(dt: number): void {
    if (!this.lit || this.broken) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      // burnt down into the neck: the oil goes up
      this.shatter(this.flamePoint());
      return;
    }
    this.refresh();
    const w = this.flamePoint();
    // a small flame licking up off the rag (a thrown bottle trails it) and a wisp of smoke
    if (Math.random() < dt * 60) this.flame(w, 1);
    if (Math.random() < dt * 2.5) this.game.particles.smoke(w.x, w.y + 0.1, 1, 0.1, true);
    this.game.sound.hold(this, 'fire/crackle_loop', 0.16, w.x, 1.3);
  }

  /** One tongue of the rag's flame at `w`, `size` times the usual. */
  private flame(w: V2, size: number): void {
    const s = PX * (2 + Math.random() * 1.5) * size;
    this.game.particles.emit(PK.Fire, w.x + (Math.random() - 0.5) * PX, w.y, {
      vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.6, life: 0.12 + Math.random() * 0.15,
      size: s, size1: s * 0.3, color: 0xffd25a, color1: 0xc8320f, alpha: 1, alpha1: 0.6, gravity: -0.3, drag: 1.4,
    });
  }

  frame(): void {
    if (!this.lit || this.destroyed) return;
    const w = this.flamePoint();
    const flicker = 0.8 + Math.random() * 0.4;
    this.game.renderer.addLight(w.x, w.y + 0.05, 1.3 * flicker, 0.4 * flicker, 0xffa040);
  }

  /** Redraws the sprite when the rag has burnt down another pixel (or caught). */
  private refresh(): void {
    if (this.destroyed) return;
    const left = this.ragLeft;
    const key = `${left}:${this.lit}`;
    if (key === this.shown) return;
    this.shown = key;
    this.main.setArt(molotovArt(left, this.lit));
  }

  onImpact(info: ImpactInfo): void {
    // (a knock from something very light, a spent case, doesn't do it)
    if (info.speed >= SHATTER_SPEED && info.otherMass > 0.3) this.shatter(info.point, info.normal);
  }

  onBullet(hit: BulletHit): void {
    this.shatter(hit.point, hit.dir);
  }

  damage(_part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    // a blast's heat sets the oil going as it smashes the bottle
    if (kind === 'explosion' && amount > 2) this.shatter(point, dir, true);
    else if (kind !== 'fire' && amount > 10) this.shatter(point, dir);
  }

  /** A fire's heat on it: the rag catches, then the glass cracks and the oil goes up. */
  onHeat(_p: Part, heat: number): void {
    if (this.broken) return;
    this.heat += heat;
    if (this.heat >= CATCH) this.activate();
    if (this.heat >= BURST) this.shatter(undefined, undefined, true);
  }

  /**
   * Smashes the bottle at `point` (default: its middle): glass flies, and the oil
   * splashes out along `dir` (default: up), off whatever it hit. With `ignite`
   * (a lit rag) it goes up in a gout of flame, and the splash burns where it lands.
   */
  shatter(point?: V2, dir?: V2, ignite = this.lit): void {
    if (this.broken || this.destroyed) return;
    this.broken = true;
    const p = this.main;
    const g = this.game;
    const c = point ?? { x: p.x, y: p.y };
    const d = dir && Math.hypot(dir.x, dir.y) > 1e-6 ? dir : { x: 0, y: 1 };
    // most of the oil in a fan off what it hit, the rest all round
    g.particles.liquid(Liquid.Oil, c.x, c.y, d.x, d.y, DROPS * 0.7, 3.4, 1.1, p.body);
    g.particles.liquid(Liquid.Oil, c.x, c.y, d.x, d.y, DROPS * 0.3, 2, Math.PI, p.body);
    for (let i = 0; i < 24; i++) {
      const ix = Math.floor(Math.random() * p.w);
      const iy = Math.floor(Math.random() * p.h);
      if (!p.solidAt(ix, iy)) continue;
      const w = p.pixelToWorld(ix, iy);
      g.particles.debris(w.x, w.y, d.x + (Math.random() - 0.5) * 2, d.y + 0.5, 1, BOTTLE_SHARDS, 3.5);
    }
    g.sound.play('impact/bottle_smash', { gain: 0.9, x: c.x });
    g.sound.play('liquid/splash', { gain: 0.4, x: c.x, rate: 0.9 });
    if (ignite) {
      g.fire.flare(c.x, c.y, FLARE);
      g.sound.play('fire/whoosh', { gain: 0.4, x: c.x });
      g.alarm(c.x, c.y, 10);
      spills(g).add(c.x, c.y);
    }
    g.remove(this);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (!this.lit) acts.push({ label: 'Light rag', hint: 'F', action: () => this.activate() });
    else acts.push({ label: 'Smash now', danger: true, action: () => this.shatter() });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    return this.lit ? { lit: true, timer: this.timer } : undefined;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (!x.lit) return;
    this.lit = true;
    this.timer = typeof x.timer === 'number' && x.timer > 0 ? Math.min(RAG_TIME, x.timer) : RAG_TIME;
    this.refresh();
  }
}

// ------------------------------------------------------------------ burning splashes

/** Seconds a lit splash goes on lighting the oil it lands in, after its drops have had time to fall to the floor. */
const SPLASH_TIME = 1;
/** How far (m) from where the bottle broke its oil comes down. */
const SPREAD = 2.4;
/** Seconds a splash burns where it came down on a map's ground (oil only pools on the floor). */
const GROUND_BURN = 7;
/** Flames across that patch of ground, how far apart (m), and how high they reach. */
const PATCH = 7;
const PATCH_STEP = 0.25;
const FLAMES = 0.45;
/** Seconds between warmings of what's in those flames. */
const WARM = 0.1;

/** A lit bottle's splash, burning on for a while where it came down (see Spills). */
interface Spill {
  x: number;
  y: number;
  /** Seconds since the bottle broke, and until the next look for oil to light. */
  t: number;
  next: number;
  /** How long (s) its drops go on landing: as long as they take to fall to the floor, and a little. */
  window: number;
  /**
   * On a map's ground: the ground's height under each of the patch's flames,
   * when the drops get down to it (s since the bottle broke), and the time to the
   * next warming of what's in the flames.
   */
  ground: { y: number[]; from: number; warm: number } | null;
  /** The scene it was splashed in: it's gone with it (a load, Clear). */
  scene: number;
}

/**
 * Lit splashes. A smashed bottle's oil is in the air for a moment before it
 * lands, so for a second or so after it breaks whatever the splash has soaked,
 * and the oil pooling on the floor, is set alight as it comes down. On a map's
 * ground, where oil doesn't pool, the splash burns where it fell for a few
 * seconds instead, warming (and lighting) whatever is in its flames.
 */
class Spills {
  private game: Game;
  private list: Spill[] = [];
  private found: Part[] = [];

  constructor(game: Game) {
    this.game = game;
    game.preStepHandlers.push((dt) => this.step(dt));
    game.frameHandlers.push(() => this.frame());
  }

  /** A lit bottle broke at (x, y). */
  add(x: number, y: number): void {
    const g = this.game;
    // (how long burning oil takes to fall h; with no gravity to speak of, it's on its way a while)
    const fall = (h: number) => Math.sqrt((2 * Math.max(0, h)) / Math.max(0.5, -g.gravity));
    const top = g.env.groundAt(x, y + 0.3);
    let ground: Spill['ground'] = null;
    if (top > WORLD.floor + PX || !g.puddles.open(x)) {
      const ys: number[] = [];
      for (let i = 0; i < PATCH; i++) ys.push(g.env.groundAt(x + (i - (PATCH - 1) / 2) * PATCH_STEP, y + 0.3));
      ground = { y: ys, from: fall(y - top) + 0.1, warm: 0 };
    }
    this.list.push({ x, y, t: 0, next: 0, window: fall(y - WORLD.floor) + SPLASH_TIME, ground, scene: g.sceneVersion });
  }

  private step(dt: number): void {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      const out = s.ground ? s.t > s.ground.from + GROUND_BURN : true;
      if (s.scene !== g.sceneVersion || (s.t > s.window && out)) {
        this.list.splice(i, 1);
        continue;
      }
      s.next -= dt;
      if (s.t <= s.window && s.next <= 0) {
        s.next = 0.08;
        this.light(s);
      }
      if (s.ground) this.burnGround(s, s.ground, dt);
    }
  }

  /** Lights the oil the splash has put down so far: soaked into things round where it broke, and pooling on the floor. */
  private light(s: Spill): void {
    const g = this.game;
    const r = Math.min(SPREAD, 0.5 + s.t * 3);
    if (!s.ground) g.puddles.igniteNear(s.x, r);
    g.physics.world.intersectionsWithShape({ x: s.x, y: s.y }, 0, new RAPIER.Ball(Math.min(1.6, r)), (c) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed && p.oil > 0.02 && p.burning < 0.05) this.found.push(p);
      return true;
    });
    for (const p of this.found) g.fire.ignite(p, 0.6);
    this.found.length = 0;
  }

  /** How hard a splash burns on a map's ground (0..1): not till its drops get down there, dying away over its last 2 s. */
  private groundHeat(s: Spill): number {
    if (!s.ground) return 0;
    const age = s.t - s.ground.from;
    return age < 0 ? 0 : Math.max(0, Math.min(1, (GROUND_BURN - age) / 2));
  }

  /** Flames over the patch of ground the splash came down on; they warm (and in time light) what's in them. */
  private burnGround(s: Spill, gr: NonNullable<Spill['ground']>, dt: number): void {
    const k = this.groundHeat(s);
    if (k <= 0) return;
    const g = this.game;
    for (let i = 0; i < PATCH; i++) {
      if (Math.random() < dt * 9 * k) g.particles.fire(s.x + (i - (PATCH - 1) / 2 + Math.random() - 0.5) * PATCH_STEP, gr.y[i] + PX, 0.3 + 0.5 * k);
    }
    g.sound.hold(s, 'fire/crackle_loop', 0.35 * k, s.x);
    gr.warm -= dt;
    if (gr.warm > 0) return;
    gr.warm = WARM;
    const lo = Math.min(...gr.y);
    const hi = Math.max(...gr.y) + FLAMES;
    g.physics.world.intersectionsWithShape({ x: s.x, y: (lo + hi) / 2 }, 0, new RAPIER.Cuboid((PATCH * PATCH_STEP) / 2, (hi - lo) / 2), (c) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed) this.found.push(p);
      return true;
    });
    for (const p of this.found) g.fire.warm(p, WARM * HEAT * k);
    this.found.length = 0;
  }

  /** Firelight over the patches of ground burning (once per rendered frame). */
  private frame(): void {
    for (const s of this.list) {
      const k = this.groundHeat(s);
      if (k <= 0) continue;
      const gy = s.ground!.y[(PATCH - 1) / 2];
      this.game.renderer.addLight(s.x, gy + 0.3, 1.6 + k, 0.5 * k * (0.85 + Math.random() * 0.3), 0xffa040);
    }
  }
}

const spillsOf = new WeakMap<Game, Spills>();

/** The game's lit splashes (made the first time a lit bottle breaks). */
function spills(game: Game): Spills {
  let s = spillsOf.get(game);
  if (!s) spillsOf.set(game, (s = new Spills(game)));
  return s;
}

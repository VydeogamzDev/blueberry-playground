import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import { PK } from './Particles';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';

export interface ExplosionOpts {
  /** Blast impulse scale (N*s at the center for a ~10 kg body). */
  power: number;
  radius: number;
  /** Damage at the center. */
  damage: number;
  /** Ignite flammable things. */
  incendiary?: boolean;
  /** Number of fragmentation bullets. */
  shrapnel?: number;
  source?: Entity | null;
}

interface Pending {
  x: number;
  y: number;
  o: ExplosionOpts;
  delay: number;
}

/** A nuclear blast still going on: its shock front spreading, its cloud rising (see Explosions.nuke()). */
interface Nuke {
  x: number;
  y: number;
  /** How far the shock front reaches, and the fireball inside it (m). */
  R: number;
  fireball: number;
  /** 0 for the smallest yield ... 1 for the biggest. */
  size: number;
  /** Push and harm at the center (as in ExplosionOpts). */
  power: number;
  damage: number;
  /** The shock front's speed (m/s) and how far out it has got (m). */
  speed: number;
  front: number;
  /** Seconds since the flash. */
  t: number;
  /** What lay in reach at the flash, nearest first, with how far off each was; the front has hit those before `next`. */
  parts: Part[];
  dist: number[];
  next: number;
  /** The boom has been heard (the front got to the camera, or as far as it goes). */
  heard: boolean;
}

const LOS_GROUPS = groups(GROUP.DEBRIS, GROUP.STATIC);

/** The smallest and biggest yields (kt) a thermonuclear bomb can be set to. */
export const NUKE_MIN_KT = 0.1;
export const NUKE_MAX_KT = 50000;

/**
 * How far a nuclear blast reaches (m) for its yield (kt): a city block's worth
 * for the smallest, the whole 140 m map for the biggest. Real blasts grow with
 * the cube root of the yield, which would make the biggest 80 times the
 * smallest; these grow more slowly (12 m to 150 m).
 */
export function nukeRadius(kt: number): number {
  return 12 * Math.pow(Math.min(NUKE_MAX_KT, Math.max(NUKE_MIN_KT, kt)) / NUKE_MIN_KT, 0.1925);
}

/** Parts a nuclear shock front may hit in one step; the rest wait for the next (a crowd mustn't stall a step). */
const NUKE_HITS_PER_STEP = 40;
/** How long a mushroom cloud keeps billowing (s). */
const CLOUD_TIME = 7;
/** The fastest a nuclear blast flings anything (m/s): any faster, it would go through the walls. */
const NUKE_FLING = 45;

export class Explosions {
  private game: Game;
  private pending: Pending[] = [];
  private nukes: Nuke[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  /** The point of a part nearest() last found nearest the blast. */
  private qx = 0;
  private qy = 0;
  /** A nuclear flash whiting out the screen: how white (0..1), how long it holds, then fades (s). */
  private white = 0;
  private whiteHold = 0;
  private whiteFade = 1;
  /** The element that whites the screen out, and the whiteness it shows. */
  private whiteEl: HTMLDivElement | null = null;
  private whiteShown = 0;

  constructor(game: Game) {
    this.game = game;
    game.frameHandlers.push(() => this.frame());
  }

  /** How white a nuclear flash has made the screen (0..1). */
  get whiteout(): number {
    return this.white;
  }

  /** Nuclear blasts still spreading or billowing. */
  get nuclear(): number {
    return this.nukes.length;
  }

  /** Queues an explosion (resolved at the end of the current step to keep chains stable). */
  explode(x: number, y: number, o: ExplosionOpts, delay = 0): void {
    // fuse cords tied to what's blowing up catch now, before it's gone
    if (o.source) this.game.connections.lightFrom(o.source);
    this.pending.push({ x, y, o, delay });
  }

  step(dt: number): void {
    if (this.nukes.length) this.stepNukes(dt);
    if (this.white > 0) {
      if (this.whiteHold > 0) this.whiteHold -= dt;
      else this.white = Math.max(0, this.white - dt / this.whiteFade);
    }
    if (!this.pending.length) return;
    const now = this.pending;
    this.pending = [];
    for (const p of now) {
      if (p.delay > 0) {
        p.delay -= dt;
        this.pending.push(p);
      } else this.detonate(p.x, p.y, p.o);
    }
  }

  private detonate(x: number, y: number, o: ExplosionOpts): void {
    const g = this.game;
    g.stats.add('explosions');
    const world = g.physics.world;
    const R = o.radius;
    // oil on the floor nearby catches, and fuse cords in the blast
    if (y - WORLD.floor < R) g.puddles.igniteNear(x, Math.sqrt(Math.max(0, R * R - (y - WORLD.floor) ** 2)));
    g.connections.igniteNear(x, y, R * 0.8);

    // ---- visuals & audio
    this.visuals(x, y, o);
    g.sound.explosion(o.power / 60, x);
    g.alarm(x, y, R * 3 + 6);
    const r = g.renderer;
    const dCam = Math.hypot(x - r.camX, y - r.camY);
    r.shake(Math.max(0, (o.power / 50) * (1 - dCam / 60)));

    // ---- physics: collect parts in range
    const parts = new Set<Part>();
    world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(R), (c) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed) parts.add(p);
      return true;
    });
    for (const p of parts) {
      if (p.entity === o.source && p.entity.destroyed) continue;
      const d = this.nearest(p, x, y);
      if (d > R) continue;
      let f = 1 - d / R;
      f = f * f * (0.4 + 0.6 * f) + 0.04;
      this.strike(p, x, y, f, o.power, o.damage, !!o.incendiary);
    }

    // ---- shrapnel
    const n = o.shrapnel ?? 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      g.projectiles.fire(x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05, Math.cos(a), Math.sin(a), 140 + Math.random() * 100, {
        energy: 140, damage: 14, push: 0.02, life: 0.25, tracer: false,
      });
    }

    this.scorch(x, y, R * 0.55, 40);
  }

  /** How far a part is from (x, y) at its nearest; the point is left in (qx, qy). */
  private nearest(p: Part, x: number, y: number): number {
    let best = Infinity;
    this.qx = p.x;
    this.qy = p.y;
    for (const c of p.colliders) {
      const proj = c.projectPoint({ x, y }, true);
      if (!proj) continue;
      const d = Math.hypot(proj.point.x - x, proj.point.y - y);
      if (d < best) {
        best = d;
        this.qx = proj.point.x;
        this.qy = proj.point.y;
      }
    }
    return Math.min(best, Math.hypot(p.x - x, p.y - y));
  }

  /**
   * Hits a part with a blast from (x, y), `f` as hard as at its center (less
   * behind a wall), at the point nearest() last found: flings it away, hurts it,
   * chars it and may set it alight. `fling` caps the speed it's given (m/s).
   */
  private strike(p: Part, x: number, y: number, f: number, power: number, damage: number, incendiary: boolean, fling = Infinity): void {
    const g = this.game;
    const qx = this.qx;
    const qy = this.qy;
    // line of sight against the static world (walls/floor) dampens the blast
    const dx = p.x - x;
    const dy = p.y - y;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.05) {
      this.ray.origin = { x, y };
      this.ray.dir = { x: dx / dl, y: dy / dl };
      const hit = g.physics.world.castRay(this.ray, dl, true, undefined, LOS_GROUPS);
      if (hit && hit.timeOfImpact < dl - 0.05) f *= 0.3;
    }
    const dirx = dl > 0.01 ? dx / dl : 0;
    const diry = dl > 0.01 ? dy / dl : 1;
    // impulse grows sub-linearly with mass so light things fly further
    const mass = p.frozen ? 0 : p.mass;
    const mag = power * f * Math.pow(Math.max(0.05, mass), 0.6) * 0.35;
    if (!p.frozen) {
      p.body.applyImpulseAtPoint({ x: dirx * mag, y: (diry + 0.25) * mag }, { x: qx, y: qy }, true);
      if (fling < Infinity) {
        const v = p.body.linvel();
        const s = Math.hypot(v.x, v.y);
        if (s > fling) p.body.setLinvel({ x: (v.x / s) * fling, y: (v.y / s) * fling }, true);
        const av = p.body.angvel();
        if (Math.abs(av) > 40) p.body.setAngvel(Math.sign(av) * 40, true);
      }
    }
    p.entity.damage(p, damage * f, 'explosion', { x: qx, y: qy }, { x: dirx, y: diry });
    if ((incendiary || f > 0.6) && Math.random() < p.mat.flammability * f * 1.5) g.fire.ignite(p, 0.5 + f * 0.5);
    if (f > 0.35) p.charred = Math.min(1, p.charred + f * 0.5);
  }

  /** Scorch marks on the walls and floor within `reach` of (x, y), found by `rays` rays. */
  private scorch(x: number, y: number, reach: number, rays: number): void {
    const g = this.game;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      this.ray.origin = { x, y };
      this.ray.dir = { x: Math.cos(a), y: Math.sin(a) };
      const hit = g.physics.world.castRayAndGetNormal(this.ray, reach, true, undefined, LOS_GROUPS);
      if (!hit) continue;
      const hx = x + Math.cos(a) * hit.timeOfImpact;
      const hy = y + Math.sin(a) * hit.timeOfImpact;
      const k = 1 - hit.timeOfImpact / reach;
      for (let j = 0; j < 3; j++) {
        const t = (Math.random() - 0.5) * PX * 6;
        g.stains.add(hx - hit.normal.x * PX * 0.5 - hit.normal.y * t, hy - hit.normal.y * PX * 0.5 + hit.normal.x * t, 0.06, 0.055, 0.05, 0.35 + k * 0.6);
      }
    }
  }

  private visuals(x: number, y: number, o: ExplosionOpts): void {
    const p = this.game.particles;
    const R = o.radius;
    p.flash(x, y, R * 1.1, 0xffe9b0, 0.1);
    this.game.renderer.addLight(x, y, R * 3.2, 1, 0xffd890, 0.45);
    p.flash(x, y, R * 0.55, 0xffffff, 0.06);
    // fireball core: a few big puffs that swell and darken
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * R * 0.12;
      p.emit(PK.Fire, x + Math.cos(a) * d, y + Math.sin(a) * d + R * 0.05, {
        vx: Math.cos(a) * R * 0.5, vy: Math.sin(a) * R * 0.5 + R * 0.4, life: 0.3 + Math.random() * 0.25,
        size: R * 0.16, size1: R * 0.3, color: 0xfff0b0, color1: 0x9a2a0c, alpha: 1, alpha1: 0, gravity: -0.3, drag: 5,
      });
    }
    const nFire = Math.round(30 + R * 14);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.5 + Math.random()) * R * 3.2;
      p.emit(PK.Fire, x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, life: 0.25 + Math.random() * 0.45,
        size: 0.12 + Math.random() * R * 0.17, size1: 0.05, color: 0xffe08a, color1: 0xb8300c, alpha: 1, alpha1: 0.2, gravity: -0.2, drag: 4,
      });
    }
    for (let i = 0; i < Math.round(10 + R * 3); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * R * 1.1;
      p.emit(PK.Smoke, x + Math.cos(a) * R * 0.15, y + Math.sin(a) * R * 0.15, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 + 0.9, life: 1.4 + Math.random() * 1.8,
        size: 0.3 + R * 0.06, size1: (0.5 + R * 0.16) * (1 + Math.random() * 0.5), color: 0x2e2b29, color1: 0x5a5856, alpha: 0.6, alpha1: 0, gravity: -0.1, drag: 2.5,
      });
    }
    p.sparks(x, y, 0, 1, Math.round(20 + R * 8), R * 6);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI;
      const s = 3 + Math.random() * R * 5;
      p.emit(PK.Ember, x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8 + Math.random() * 1.2,
        color: 0xffb040, color1: 0x801800, alpha: 1, alpha1: 0.2, gravity: 0.7, drag: 0.6, size: PX,
      });
    }
    p.debris(x, y, 0, 1, Math.round(10 + R * 4), 0x3d3a37, R * 4);
  }

  // ---- nuclear blasts -----------------------------------------------------------

  /**
   * A thermonuclear blast of `kt` kilotons at (x, y): a white flash, a fireball
   * that burns everything in it, a shock front that travels out to nukeRadius()
   * flinging and hurting what it passes (a few dozen parts a step at most, see
   * stepNukes()), and a mushroom cloud.
   */
  nuke(x: number, y: number, kt: number, source: Entity | null = null): void {
    const g = this.game;
    if (!g.net?.guest) g.stats.add('nukes');
    const R = nukeRadius(kt);
    const size = Math.log(Math.max(NUKE_MIN_KT, kt) / NUKE_MIN_KT) / Math.log(NUKE_MAX_KT / NUKE_MIN_KT);
    // what lies in reach, nearest first: the front gets to each in turn
    const found = new Set<Part>();
    g.physics.world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(R), (c) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed && p.entity !== source) found.add(p);
      return true;
    });
    const near = [...found].map((p) => ({ p, d: Math.min(R, Math.hypot(p.x - x, p.y - y)) })).sort((a, b) => a.d - b.d);
    this.nukes.push({
      x, y, R, fireball: R * 0.3, size, power: 260 + R * 4, damage: 3000, speed: 25 + R * 0.6, front: 0, t: 0,
      parts: near.map((n) => n.p), dist: near.map((n) => n.d), next: 0, heard: false,
    });
    // fuse cords and oil in the fireball catch
    const fb = R * 0.3;
    if (source) g.connections.lightFrom(source);
    g.connections.igniteNear(x, y, fb);
    if (y - WORLD.floor < fb) g.puddles.igniteNear(x, Math.sqrt(Math.max(0, fb * fb - (y - WORLD.floor) ** 2)));
    g.alarm(x, y, R * 3);
    // the flash whites out the whole screen, the longer the bigger it is
    this.white = Math.max(this.white, 0.8 + 0.2 * size);
    this.whiteHold = Math.max(this.whiteHold, 0.08 + 0.35 * size);
    this.whiteFade = 0.6 + 2.4 * size;
    g.renderer.addLight(x, y, R * 2.2, 1, 0xfff4dc, 1.2 + 2.5 * size);
    g.renderer.shake(1.5);
    g.particles.flash(x, y, Math.min(30, fb * 1.4), 0xffffff, 0.25);
    // a deep boom: the big blast slowed right down (the shock front brings another, see stepNukes())
    const rate = 0.6 - 0.28 * size;
    g.sound.play('explosion/large', { gain: 1, x, rate, vary: 0.03 });
    g.sound.play('explosion/large', { gain: 0.8, x, rate: rate * 0.75, delay: 0.1, vary: 0.03 });
    this.scorch(x, y, fb * 1.2, 64);
  }

  private stepNukes(dt: number): void {
    const g = this.game;
    for (let i = this.nukes.length - 1; i >= 0; i--) {
      const n = this.nukes[i];
      n.t += dt;
      n.front = Math.min(n.R, n.front + n.speed * dt);
      // the front strikes what it has got to
      let hits = 0;
      while (n.next < n.parts.length && n.dist[n.next] <= n.front && hits < NUKE_HITS_PER_STEP) {
        const p = n.parts[n.next++];
        if (p.destroyed || p.entity.destroyed) continue;
        this.nukeHit(n, p);
        hits++;
      }
      this.nukeVisuals(n, dt);
      if (!n.heard) {
        const r = g.renderer;
        const dCam = Math.hypot(r.camX - n.x, r.camY - n.y);
        if (n.front >= Math.min(n.R, dCam)) {
          // the shock front arrives where we are: the blast itself, and the ground shaking
          n.heard = true;
          const here = dCam <= n.R;
          g.sound.play('explosion/large', { gain: here ? 1 : 0.6, rate: 0.5 - 0.2 * n.size, vary: 0.03 });
          g.sound.play('explosion/debris', { gain: here ? 0.9 : 0.5, rate: 0.55, delay: 0.15 });
          r.shake(here ? 1.5 : 0.6);
        }
      }
      if (n.next >= n.parts.length && n.front >= n.R && n.t >= CLOUD_TIME) this.nukes.splice(i, 1);
    }
  }

  /** The shock front reaches a part: all-out inside the fireball (which burns it), falling away to nothing at the edge. */
  private nukeHit(n: Nuke, p: Part): void {
    const d = this.nearest(p, n.x, n.y);
    if (d > n.R) return;
    const inside = d <= n.fireball;
    const k = inside ? 1 : 1 - (d - n.fireball) / (n.R - n.fireball);
    this.strike(p, n.x, n.y, inside ? 1 : k * k * 0.85 + 0.03, n.power, n.damage, true, NUKE_FLING);
    if (inside && !p.destroyed) {
      p.charred = 1;
      this.game.fire.ignite(p, 1);
    }
  }

  /** The fireball, the shock ring with dust kicked off the floor, and the mushroom cloud: so many particles a second, whatever the step. */
  private nukeVisuals(n: Nuke, dt: number): void {
    const P = this.game.particles;
    const rnd = Math.random;
    const count = (perSec: number) => Math.floor(perSec * dt + rnd());
    const floor = WORLD.floor;
    // the fireball swells, rises and cools
    if (n.t < 0.6 + 0.9 * n.size) {
      const rf = n.fireball * Math.min(1, 0.35 + n.t * 2.5);
      const cy = n.y + n.t * n.fireball * 0.4;
      for (let k = count(240); k > 0; k--) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * rf;
        const s = Math.min(8, rf * (0.25 + rnd() * 0.25));
        P.emit(PK.Fire, n.x + Math.cos(a) * r, Math.max(floor, cy + Math.sin(a) * r), {
          vx: Math.cos(a) * rf * 0.4, vy: Math.sin(a) * rf * 0.4 + rf * 0.3, life: 0.4 + rnd() * 0.6,
          size: s, size1: s * 1.4, color: 0xfff4c4, color1: 0x9a2a0c, alpha: 1, alpha1: 0, gravity: -0.3, drag: 3,
        });
      }
    }
    // the shock front: a pale ring flying out with it, kicking dust up off the floor
    if (n.front < n.R) {
      for (let k = count(Math.min(700, n.front * 9)); k > 0; k--) {
        const a = rnd() * Math.PI * 2;
        const px = n.x + Math.cos(a) * n.front;
        const py = n.y + Math.sin(a) * n.front;
        if (py < floor || px < WORLD.left || px > WORLD.right) continue;
        P.emit(PK.Dust, px, py, {
          vx: Math.cos(a) * n.speed, vy: Math.sin(a) * n.speed, life: 0.18 + rnd() * 0.12,
          size: 0.5 + rnd() * 0.7, color: 0xe8e2d6, color1: 0xa8a29a, alpha: 0.55, alpha1: 0, gravity: 0, drag: 0,
        });
      }
      const h = n.y - floor;
      if (n.front > h) {
        const w = Math.sqrt(n.front * n.front - h * h);
        for (const side of [-1, 1]) {
          const gx = n.x + side * w;
          if (gx < WORLD.left || gx > WORLD.right) continue;
          for (let k = count(40); k > 0; k--) {
            P.emit(PK.Dust, gx, floor + 0.1, {
              vx: side * n.speed * (0.1 + rnd() * 0.2), vy: 1.5 + rnd() * 4, life: 1 + rnd() * 1.5,
              size: 0.6 + rnd() * 1.6, size1: 2 + rnd() * 2.5, color: 0x8a7a66, color1: 0x5a524a, alpha: 0.6, alpha1: 0, gravity: -0.05, drag: 1.2,
            });
          }
        }
      }
    }
    // the mushroom cloud: a cap rising on a stem, glowing at first, thinning out
    if (n.t < CLOUD_TIME) {
      const capR = Math.min(26, 3 + n.R * 0.2);
      const H = Math.max(2, Math.min(WORLD.ceiling - capR * 0.45 - 2 - n.y, 6 + n.R * 0.35));
      const ease = Math.exp(-n.t / 1.6);
      const cy = n.y + H * (1 - ease);
      const vy = (H / 1.6) * ease;
      const hot = Math.max(0, 1 - n.t / 2.5);
      const fade = 1 - n.t / CLOUD_TIME;
      for (let k = count(110 * fade + 20); k > 0; k--) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd());
        const ox = Math.cos(a) * r * capR;
        const oy = Math.sin(a) * r * capR * 0.45;
        const s = Math.min(9, capR * (0.2 + rnd() * 0.2));
        P.emit(PK.Smoke, n.x + ox, cy + oy, {
          vx: ox * 0.25, vy: vy + oy * 0.2, life: 3 + rnd() * 3, size: s, size1: s * 1.5,
          color: rnd() < hot ? 0xb4501e : 0x5e5650, color1: 0x2e2b29, alpha: 0.85, alpha1: 0, gravity: -0.02, drag: 0.8,
        });
      }
      const stemW = capR * 0.35;
      const stemTop = cy - capR * 0.3;
      if (stemTop > floor + 1) {
        for (let k = count(50 * fade + 10); k > 0; k--) {
          const s = Math.min(6, stemW * (0.5 + rnd() * 0.4));
          P.emit(PK.Smoke, n.x + (rnd() - 0.5) * stemW, floor + rnd() * (stemTop - floor), {
            vx: (rnd() - 0.5) * 0.6, vy: vy * 0.8 + rnd(), life: 2 + rnd() * 2, size: s, size1: s * 1.3,
            color: rnd() < hot ? 0x9a4a22 : 0x6e6660, color1: 0x3a3634, alpha: 0.75, alpha1: 0, gravity: -0.02, drag: 1,
          });
        }
      }
    }
  }

  /** Shows the nuclear flash's whiteout over the sandbox (a page element: the renderer draws only the world). */
  private frame(): void {
    if (this.white === this.whiteShown) return;
    this.whiteShown = this.white;
    let el = this.whiteEl;
    if (!el) {
      el = this.whiteEl = document.createElement('div');
      Object.assign(el.style, { position: 'fixed', inset: '0', background: '#fffdf4', pointerEvents: 'none', opacity: '0', display: 'none' });
      const cv = this.game.renderer.canvas;
      if (cv.parentElement) cv.parentElement.insertBefore(el, cv.nextSibling);
      else document.body.appendChild(el);
    }
    el.style.opacity = String(this.white);
    el.style.display = this.white > 0.003 ? 'block' : 'none';
  }

  clear(): void {
    this.pending.length = 0;
    this.nukes.length = 0;
    this.white = 0;
    this.whiteHold = 0;
  }
}

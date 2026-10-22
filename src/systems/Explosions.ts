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

const LOS_GROUPS = groups(GROUP.DEBRIS, GROUP.STATIC);

export class Explosions {
  private game: Game;
  private pending: Pending[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });

  constructor(game: Game) {
    this.game = game;
  }

  /** Queues an explosion (resolved at the end of the current step to keep chains stable). */
  explode(x: number, y: number, o: ExplosionOpts, delay = 0): void {
    this.pending.push({ x, y, o, delay });
  }

  step(dt: number): void {
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
    const world = g.physics.world;
    const R = o.radius;
    // oil on the floor nearby catches
    if (y - WORLD.floor < R) g.puddles.igniteNear(x, Math.sqrt(Math.max(0, R * R - (y - WORLD.floor) ** 2)));

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
      // nearest point on the part
      let best = Infinity;
      let qx = p.x;
      let qy = p.y;
      for (const c of p.colliders) {
        const proj = c.projectPoint({ x, y }, true);
        if (!proj) continue;
        const d = Math.hypot(proj.point.x - x, proj.point.y - y);
        if (d < best) {
          best = d;
          qx = proj.point.x;
          qy = proj.point.y;
        }
      }
      const d = Math.min(best, Math.hypot(p.x - x, p.y - y));
      if (d > R) continue;
      let f = 1 - d / R;
      f = f * f * (0.4 + 0.6 * f) + 0.04;
      // line of sight against the static world (walls/floor) dampens the blast
      const dx = p.x - x;
      const dy = p.y - y;
      const dl = Math.hypot(dx, dy);
      if (dl > 0.05) {
        this.ray.origin = { x, y };
        this.ray.dir = { x: dx / dl, y: dy / dl };
        const hit = world.castRay(this.ray, dl, true, undefined, LOS_GROUPS);
        if (hit && hit.timeOfImpact < dl - 0.05) f *= 0.3;
      }
      const dirx = dl > 0.01 ? dx / dl : 0;
      const diry = dl > 0.01 ? dy / dl : 1;
      // impulse grows sub-linearly with mass so light things fly further
      const mass = p.frozen ? 0 : p.mass;
      const mag = o.power * f * Math.pow(Math.max(0.05, mass), 0.6) * 0.35;
      if (!p.frozen) {
        p.body.applyImpulseAtPoint({ x: dirx * mag, y: (diry + 0.25) * mag }, { x: qx, y: qy }, true);
      }
      p.entity.damage(p, o.damage * f, 'explosion', { x: qx, y: qy }, { x: dirx, y: diry });
      if ((o.incendiary || f > 0.6) && Math.random() < p.mat.flammability * f * 1.5) g.fire.ignite(p, 0.5 + f * 0.5);
      if (f > 0.35) p.charred = Math.min(1, p.charred + f * 0.5);
    }

    // ---- shrapnel
    const n = o.shrapnel ?? 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      g.projectiles.fire(x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05, Math.cos(a), Math.sin(a), 140 + Math.random() * 100, {
        energy: 140, damage: 14, push: 0.02, life: 0.25, tracer: false,
      });
    }

    // ---- scorch marks on nearby static surfaces
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.ray.origin = { x, y };
      this.ray.dir = { x: Math.cos(a), y: Math.sin(a) };
      const hit = world.castRayAndGetNormal(this.ray, R * 0.55, true, undefined, LOS_GROUPS);
      if (!hit) continue;
      const hx = x + Math.cos(a) * hit.timeOfImpact;
      const hy = y + Math.sin(a) * hit.timeOfImpact;
      const k = 1 - hit.timeOfImpact / (R * 0.55);
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

  clear(): void {
    this.pending.length = 0;
  }
}

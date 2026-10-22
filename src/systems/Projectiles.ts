import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

export interface BulletOpts {
  /** Kinetic energy budget used for penetration (J-ish). */
  energy: number;
  /** Damage dealt at full energy. */
  damage: number;
  /** Momentum transferred per unit of absorbed energy. */
  push?: number;
  /** Body that the bullet ignores (the gun that fired it). */
  ignore?: RAPIER.RigidBody | null;
  life?: number;
  tracer?: boolean;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  energy0: number;
  damage: number;
  push: number;
  ignore: RAPIER.RigidBody | null;
  life: number;
  tx: number;
  ty: number;
  tracer: boolean;
  bounces: number;
}

const BULLET_GROUPS = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
const MAX_TRACERS = 512;

export class Projectiles {
  private game: Game;
  private bullets: Bullet[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private lineGeo = new THREE.BufferGeometry();
  private linePos = new Float32Array(MAX_TRACERS * 6);
  private lineCol = new Float32Array(MAX_TRACERS * 8);

  constructor(game: Game) {
    this.game = game;
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(this.lineGeo, mat);
    lines.frustumCulled = false;
    lines.position.z = 47;
    lines.renderOrder = 30;
    game.renderer.scene.add(lines);
  }

  get count(): number {
    return this.bullets.length;
  }

  fire(x: number, y: number, dx: number, dy: number, speed: number, o: BulletOpts): void {
    const l = Math.hypot(dx, dy) || 1;
    this.bullets.push({
      x, y, vx: (dx / l) * speed, vy: (dy / l) * speed,
      energy: o.energy, energy0: o.energy, damage: o.damage, push: o.push ?? 0.012,
      ignore: o.ignore ?? null, life: o.life ?? 1.2, tx: x, ty: y, tracer: o.tracer ?? true, bounces: 0,
    });
  }

  step(dt: number): void {
    const world = this.game.physics.world;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.tx = b.x;
      b.ty = b.y;
      b.vy += -9.81 * dt * 0.15;
      const speed = Math.hypot(b.vx, b.vy);
      let dx = b.vx / speed;
      let dy = b.vy / speed;
      let remaining = speed * dt;
      let ox = b.x;
      let oy = b.y;
      let alive = true;
      for (let hits = 0; hits < 8 && remaining > 1e-4; hits++) {
        this.ray.origin = { x: ox, y: oy };
        this.ray.dir = { x: dx, y: dy };
        const ign = b.ignore && b.ignore.isValid() ? b.ignore : undefined;
        const hit = world.castRayAndGetNormal(this.ray, remaining, true, undefined, BULLET_GROUPS, undefined, ign);
        if (!hit) {
          ox += dx * remaining;
          oy += dy * remaining;
          remaining = 0;
          break;
        }
        const toi = hit.timeOfImpact;
        const hx = ox + dx * toi;
        const hy = oy + dy * toi;
        const part = this.game.physics.partOf(hit.collider);
        const nx = hit.normal.x;
        const ny = hit.normal.y;
        if (!part) {
          // static world: chip the surface and stop (or ricochet at grazing angles)
          this.surfaceHit(hx, hy, nx, ny, dx, dy);
          const cos = -(dx * nx + dy * ny);
          if (cos < 0.35 && b.bounces < 1) {
            const d = dx * nx + dy * ny;
            dx = dx - 2 * d * nx;
            dy = dy - 2 * d * ny;
            b.vx = dx * speed * 0.6;
            b.vy = dy * speed * 0.6;
            b.energy *= 0.4;
            b.bounces++;
            ox = hx + nx * 0.01;
            oy = hy + ny * 0.01;
            remaining -= toi;
            this.game.sound.ricochet(hx);
            continue;
          }
          alive = false;
          ox = hx;
          oy = hy;
          break;
        }
        // find where the bullet would exit this collider
        const far = 4;
        const fx = hx + dx * far;
        const fy = hy + dy * far;
        this.ray.origin = { x: fx, y: fy };
        this.ray.dir = { x: -dx, y: -dy };
        const back = hit.collider.castRay(this.ray, far, true);
        const thickness = back >= 0 ? Math.max(PX, far - back) : PX * 4;
        const ex = hx + dx * thickness;
        const ey = hy + dy * thickness;
        const resist = part.mat.bulletResistance * thickness;
        const penetrates = b.energy > resist;
        const absorbed = penetrates ? resist : b.energy;
        const frac = Math.sqrt(Math.min(1, b.energy / b.energy0));
        // ricochet off hard material at grazing angles
        const cos = -(dx * nx + dy * ny);
        if (!penetrates && part.mat.sparks && cos < 0.3 && b.bounces < 2) {
          this.impulse(part, hx, hy, dx, dy, absorbed * 0.3 * b.push);
          this.game.particles.sparks(hx, hy, nx, ny, 5, 5);
          this.game.sound.ricochet(hx);
          const d = dx * nx + dy * ny;
          dx = dx - 2 * d * nx;
          dy = dy - 2 * d * ny;
          b.vx = dx * speed * 0.6;
          b.vy = dy * speed * 0.6;
          b.energy *= 0.45;
          b.bounces++;
          ox = hx + nx * 0.01;
          oy = hy + ny * 0.01;
          remaining -= toi;
          b.ignore = null;
          continue;
        }
        part.entity.onBullet({
          part,
          point: { x: hx, y: hy },
          normal: { x: nx, y: ny },
          dir: { x: dx, y: dy },
          energy: b.energy,
          damage: b.damage * frac * (penetrates ? 1 : 0.85),
          exit: penetrates ? { x: ex, y: ey } : null,
        });
        this.impulse(part, hx, hy, dx, dy, absorbed * b.push);
        this.materialFx(part, hx, hy, nx, ny, dx, dy, penetrates ? ex : null, ey);
        if (!penetrates) {
          alive = false;
          ox = hx;
          oy = hy;
          break;
        }
        const e0 = b.energy;
        b.energy -= resist;
        const k = Math.sqrt(b.energy / e0);
        b.vx *= k;
        b.vy *= k;
        remaining = Math.max(0, (remaining - toi - thickness) * k);
        ox = ex + dx * 0.003;
        oy = ey + dy * 0.003;
        b.ignore = part.body;
      }
      b.x = ox;
      b.y = oy;
      b.life -= dt;
      if (!alive || b.life <= 0 || b.energy < 15 || b.x < WORLD.left - 5 || b.x > WORLD.right + 5 || b.y < WORLD.floor - 5) {
        this.bullets.splice(i, 1);
      }
    }
  }

  private impulse(part: Part, x: number, y: number, dx: number, dy: number, mag: number): void {
    if (part.frozen) return;
    part.body.applyImpulseAtPoint({ x: dx * mag, y: dy * mag }, { x, y }, true);
  }

  private surfaceHit(x: number, y: number, nx: number, ny: number, dx: number, dy: number): void {
    const p = this.game.particles;
    p.sparks(x, y, nx - dx * 0.3, ny - dy * 0.3, 4, 4);
    p.debris(x, y, nx, ny, 3, 0x6b6d70, 2.5);
    p.smoke(x + nx * 0.05, y + ny * 0.05, 1, 0.15);
    // bullet hole stain
    this.game.stains.add(x - nx * PX * 0.5, y - ny * PX * 0.5, 0.12, 0.12, 0.13, 1);
    this.game.sound.bulletHit('stone', x);
  }

  private materialFx(part: Part, x: number, y: number, nx: number, ny: number, dx: number, dy: number, ex: number | null, ey: number): void {
    const p = this.game.particles;
    const m = part.mat;
    if (m.sparks) p.sparks(x, y, nx, ny, 5, 5);
    if (!m.bleeds) {
      p.debris(x, y, nx, ny, 3, m.debrisColor, 2.5);
      if (ex !== null) p.debris(ex, ey, dx, dy, 3, m.debrisColor, 3);
      // scorch the entry point
      part.paintAt(x - nx * PX * 0.5, y - ny * PX * 0.5, 0x1f1d1b, 0);
    }
    this.game.sound.bulletHit(m.sound, x);
  }

  frame(): void {
    let n = 0;
    for (const b of this.bullets) {
      if (!b.tracer || n >= MAX_TRACERS) continue;
      const o = n * 6;
      // stretch the tracer slightly behind the bullet for visibility
      const sx = b.x - b.vx * 0.012;
      const sy = b.y - b.vy * 0.012;
      this.linePos[o] = sx;
      this.linePos[o + 1] = sy;
      this.linePos[o + 2] = 0;
      this.linePos[o + 3] = b.x;
      this.linePos[o + 4] = b.y;
      this.linePos[o + 5] = 0;
      const c = n * 8;
      this.lineCol.set([1, 0.75, 0.35, 0.0, 1, 0.95, 0.75, 0.9], c);
      n++;
    }
    this.lineGeo.setDrawRange(0, n * 2);
    (this.lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.lineGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.bullets.length = 0;
  }
}

import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import { LineBatch } from './Connections';
import { PK } from './Particles';
import type { V2 } from '../engine/math';

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
  tracer: boolean;
  bounces: number;
}

const BULLET_GROUPS = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
const MAX_TRACERS = 512;

export interface LaserOpts {
  /** Burn damage to the first thing hit (less for each one it passes through). */
  damage: number;
  color: number;
  ignore?: RAPIER.RigidBody | null;
  range?: number;
}

interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  color: number;
  /** Game time the beam disappears; -1 = this frame only. */
  until: number;
  life: number;
  dash: number;
}

export class Projectiles {
  private game: Game;
  private bullets: Bullet[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private lineGeo = new THREE.BufferGeometry();
  private linePos = new Float32Array(MAX_TRACERS * 6);
  private lineCol = new Float32Array(MAX_TRACERS * 8);
  private beams: Beam[] = [];
  private beamBatch = new LineBatch(3000, 46.5);

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
    this.beamBatch.mesh.material = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.beamBatch.mesh.renderOrder = 29;
    game.renderer.scene.add(this.beamBatch.mesh);
  }

  /**
   * Draws a glowing beam: for `life` seconds of game time (fading), or for this
   * frame only when life is 0. `dash` > 0 draws it dashed.
   */
  drawBeam(x0: number, y0: number, x1: number, y1: number, w: number, color: number, life = 0, dash = 0): void {
    this.beams.push({ x0, y0, x1, y1, w, color, life, dash, until: life > 0 ? this.game.time + life : -1 });
  }

  /**
   * An instant energy beam: burns what it hits, passes through soft things (losing
   * strength) and stops at metal, stone and walls. Returns where it ended.
   */
  laser(x: number, y: number, dx: number, dy: number, o: LaserOpts): V2 {
    const world = this.game.physics.world;
    const g = this.game;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    let ox = x;
    let oy = y;
    let remaining = o.range ?? 60;
    let dmg = o.damage;
    let ign = o.ignore && o.ignore.isValid() ? o.ignore : undefined;
    let end = { x: x + dx * remaining, y: y + dy * remaining };
    for (let hits = 0; hits < 6; hits++) {
      this.ray.origin = { x: ox, y: oy };
      this.ray.dir = { x: dx, y: dy };
      const hit = world.castRayAndGetNormal(this.ray, remaining, true, undefined, BULLET_GROUPS, undefined, ign);
      if (!hit) {
        end = { x: ox + dx * remaining, y: oy + dy * remaining };
        break;
      }
      const hx = ox + dx * hit.timeOfImpact;
      const hy = oy + dy * hit.timeOfImpact;
      const nx = hit.normal.x;
      const ny = hit.normal.y;
      end = { x: hx, y: hy };
      const part = g.physics.partOf(hit.collider);
      g.particles.sparks(hx, hy, nx, ny, 4, 3);
      for (let i = 0; i < 3; i++) {
        g.particles.emit(PK.Spark, hx, hy, {
          vx: nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2, vy: ny * (1 + Math.random() * 2) + Math.random() * 1.5,
          life: 0.1 + Math.random() * 0.15, color: 0xffe0d0, color1: o.color, alpha1: 0, gravity: 0.3, drag: 3,
        });
      }
      if (Math.random() < 0.5) g.particles.smoke(hx + nx * 0.05, hy + ny * 0.05, 1, 0.12);
      if (!part) {
        g.stains.add(hx - nx * PX * 0.5, hy - ny * PX * 0.5, 0.1, 0.1, 0.1, 1);
        break;
      }
      // burn: damage, char and scorch, and sometimes set it alight
      part.entity.damage(part, dmg, 'laser', { x: hx, y: hy }, { x: dx, y: dy });
      if (part.destroyed) break;
      part.charred = Math.min(1, part.charred + 0.08);
      part.refreshTint();
      part.paintAt(hx - nx * PX * 0.5, hy - ny * PX * 0.5, 0x1f1d1b, 0);
      if (part.mat.flammability > 0 && Math.random() < 0.08 + part.mat.flammability * 0.25) g.fire.ignite(part, 0.35);
      if (!part.frozen) part.body.applyImpulseAtPoint({ x: dx * 0.6, y: dy * 0.6 }, { x: hx, y: hy }, true);
      if (part.mat.sparks) break;
      // through it: find the exit and carry on, weaker
      const far = 4;
      this.ray.origin = { x: hx + dx * far, y: hy + dy * far };
      this.ray.dir = { x: -dx, y: -dy };
      const back = hit.collider.castRay(this.ray, far, true);
      const thick = back >= 0 ? Math.max(PX, far - back) : PX * 4;
      ox = hx + dx * (thick + 0.003);
      oy = hy + dy * (thick + 0.003);
      remaining -= hit.timeOfImpact + thick;
      dmg *= 0.6;
      ign = part.body;
      if (remaining <= 0) break;
    }
    // glow: a wide dim beam with a bright core, and light where it hits
    this.drawBeam(x, y, end.x, end.y, PX * 3, o.color, 0.1);
    this.drawBeam(x, y, end.x, end.y, PX * 1.2, 0xfff0f0, 0.08);
    g.renderer.addLight(end.x, end.y, 1.6, 0.6, o.color, 0.1);
    return end;
  }

  get count(): number {
    return this.bullets.length;
  }

  fire(x: number, y: number, dx: number, dy: number, speed: number, o: BulletOpts): void {
    // (a gun's: shrapnel flies without tracers; a guest's are the host's, counted there)
    if (o.tracer !== false && !this.game.net?.guest) this.game.stats.add('bullets');
    const l = Math.hypot(dx, dy) || 1;
    this.bullets.push({
      x, y, vx: (dx / l) * speed, vy: (dy / l) * speed,
      energy: o.energy, energy0: o.energy, damage: o.damage, push: o.push ?? 0.012,
      ignore: o.ignore ?? null, life: o.life ?? 1.2, tracer: o.tracer ?? true, bounces: 0,
    });
  }

  step(dt: number): void {
    const world = this.game.physics.world;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.vy += this.game.gravity * dt * 0.15;
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
        // a guest's bullets are only tracers: what they hit, and how, is the host's (see net/Effects)
        if (this.game.net?.guest) {
          alive = false;
          ox = hx;
          oy = hy;
          break;
        }
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
          round: b,
        });
        // (shot to pieces by it, the part is gone, its body freed: asking Rapier about
        // the body would bring it down; a round that went through flies on)
        const gone = part.destroyed;
        if (!gone) {
          this.impulse(part, hx, hy, dx, dy, absorbed * b.push);
          this.materialFx(part, hx, hy, nx, ny, dx, dy, penetrates ? ex : null, ey);
        }
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
        b.ignore = gone ? null : part.body;
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
    if (part.frozen || part.destroyed) return;
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
    const B = this.beamBatch;
    const t = this.game.time;
    B.begin();
    for (const b of this.beams) {
      const k = b.until < 0 ? 1 : Math.max(0, (b.until - t) / b.life);
      const r = Math.round(((b.color >> 16) & 255) * k);
      const gg = Math.round(((b.color >> 8) & 255) * k);
      const bb = Math.round((b.color & 255) * k);
      const col = (r << 16) | (gg << 8) | bb;
      if (b.dash > 0) {
        const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
        const n = Math.floor(len / b.dash);
        for (let i = 0; i < n; i += 2) {
          const t0 = (i * b.dash) / len;
          const t1 = Math.min(1, ((i + 1) * b.dash) / len);
          B.seg(b.x0 + (b.x1 - b.x0) * t0, b.y0 + (b.y1 - b.y0) * t0, b.x0 + (b.x1 - b.x0) * t1, b.y0 + (b.y1 - b.y0) * t1, b.w, col);
        }
      } else B.seg(b.x0, b.y0, b.x1, b.y1, b.w, col);
    }
    B.end();
    this.beams = this.beams.filter((b) => b.until >= t);
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
    this.beams.length = 0;
    this.bullets.length = 0;
  }
}

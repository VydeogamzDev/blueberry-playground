import * as THREE from 'three';
import { landDroplet, Liquid, LIQUID_COLORS } from './Liquids';
import { RAPIER } from '../engine/Physics';
import { GROUP, PX, WORLD, groups } from '../engine/constants';
import type { Game } from '../world/Game';

const VERT = /* glsl */ `
attribute float psize;
attribute vec4 pcolor;
attribute float pshape;
uniform float uScale;
uniform float uPx;
varying vec4 vColor;
varying float vShape;
varying float vCells;
void main() {
  vColor = pcolor;
  vShape = pshape;
  // round particles are drawn on the sprite-pixel grid: one cell per art pixel
  vCells = clamp(floor(psize / uPx + 0.5), 2.0, 48.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, psize * uScale);
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vShape;
varying float vCells;
void main() {
  vec4 col = vColor;
  if (vShape > 0.5) {
    // pixel-grid disc
    vec2 c = (floor(gl_PointCoord * vCells) + 0.5) / vCells - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    if (vShape > 1.5) {
      // glow: stepped radial falloff (three bands, like hand-drawn light)
      col.a *= r < 0.45 ? 1.0 : r < 0.75 ? 0.55 : 0.22;
    }
  }
  if (col.a <= 0.01) discard;
  gl_FragColor = col;
}`;

export const enum PK {
  Blood = 0,
  Spark = 1,
  Smoke = 2,
  Fire = 3,
  Debris = 4,
  Flash = 5,
  Shell = 6,
  Dust = 7,
  Ember = 8,
}

/** Fire color steps, hottest first (flat pixel-art bands instead of blending). */
const FIRE_RAMP = [0xfff4c4, 0xffd45c, 0xffa034, 0xe8601e, 0xb03414, 0x5e2216];

/** A fixed-capacity, CPU-simulated batch of square point particles. */
class Layer {
  readonly cap: number;
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly size: Float32Array;
  readonly size1: Float32Array;
  readonly kind: Uint8Array;
  readonly col: Float32Array; // r,g,b,a per particle (start)
  readonly col1: Float32Array; // end color
  readonly grav: Float32Array;
  readonly drag: Float32Array;
  /** Per-particle random 0..1 (offsets color steps). */
  readonly seed: Float32Array;
  /** Liquid kind of droplets (see Liquids). */
  readonly liq: Uint8Array;
  readonly ignore: (RAPIER.RigidBody | null)[];
  readonly geo = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  readonly rgba: Float32Array;
  readonly psize: Float32Array;
  readonly shape: Float32Array;
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;

  constructor(cap: number, additive: boolean, z: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.size1 = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.col = new Float32Array(cap * 4);
    this.col1 = new Float32Array(cap * 4);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.seed = new Float32Array(cap);
    this.liq = new Uint8Array(cap);
    this.ignore = new Array(cap).fill(null);
    this.pos = new Float32Array(cap * 3);
    this.rgba = new Float32Array(cap * 4);
    this.psize = new Float32Array(cap);
    this.shape = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.rgba, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.psize, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pshape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 64 }, uPx: { value: PX } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.position.z = z;
    this.points.renderOrder = additive ? 20 : 10;
  }

  add(): number {
    if (this.count >= this.cap) {
      // overwrite a random old particle
      return Math.floor(Math.random() * this.cap);
    }
    return this.count++;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.max[i] = this.max[last];
    this.size[i] = this.size[last];
    this.size1[i] = this.size1[last];
    this.kind[i] = this.kind[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
    this.seed[i] = this.seed[last];
    this.liq[i] = this.liq[last];
    this.ignore[i] = this.ignore[last];
    this.ignore[last] = null;
    for (let k = 0; k < 4; k++) {
      this.col[i * 4 + k] = this.col[last * 4 + k];
      this.col1[i * 4 + k] = this.col1[last * 4 + k];
    }
  }

  upload(): void {
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.max[i];
      this.pos[i * 3] = this.x[i];
      this.pos[i * 3 + 1] = this.y[i];
      this.pos[i * 3 + 2] = 0;
      const kd = this.kind[i];
      for (let k = 0; k < 4; k++) this.rgba[i * 4 + k] = this.col[i * 4 + k] + (this.col1[i * 4 + k] - this.col[i * 4 + k]) * t;
      if (kd === PK.Fire) {
        // flat color steps: hotter particles (greener start color) start further up the ramp
        const heat = this.col[i * 4 + 1];
        const start = (1 - heat) * 2.2 + this.seed[i] * 0.8;
        const c = FIRE_RAMP[Math.min(FIRE_RAMP.length - 1, Math.floor(start + t * FIRE_RAMP.length))];
        this.rgba[i * 4] = ((c >> 16) & 255) / 255;
        this.rgba[i * 4 + 1] = ((c >> 8) & 255) / 255;
        this.rgba[i * 4 + 2] = (c & 255) / 255;
      } else if (kd === PK.Smoke) {
        // smoke thins out in visible steps
        this.rgba[i * 4 + 3] = Math.ceil(this.rgba[i * 4 + 3] * 5) / 5;
      }
      this.psize[i] = this.size[i] + (this.size1[i] - this.size[i]) * t;
      this.shape[i] = kd === PK.Flash ? 2 : kd === PK.Smoke || kd === PK.Fire || kd === PK.Dust ? 1 : 0;
    }
    this.geo.setDrawRange(0, this.count);
    for (const name of ['position', 'pcolor', 'psize', 'pshape']) {
      const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

export interface EmitOpts {
  vx?: number;
  vy?: number;
  life?: number;
  size?: number;
  size1?: number;
  color?: number;
  color1?: number;
  alpha?: number;
  alpha1?: number;
  gravity?: number;
  drag?: number;
  /** Body whose colliders this particle passes through (e.g. the bleeding limb). */
  ignore?: RAPIER.RigidBody | null;
  /** Liquid kind for droplets. */
  liquid?: number;
}

function unpack(c: number, out: Float32Array, o: number, a: number): void {
  out[o] = ((c >> 16) & 255) / 255;
  out[o + 1] = ((c >> 8) & 255) / 255;
  out[o + 2] = (c & 255) / 255;
  out[o + 3] = a;
}

const BLOOD_FILTER = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
/** Runoff only meets the floor and walls. */
const RUNOFF_FILTER = groups(GROUP.DEBRIS, GROUP.STATIC);
/** Flag on `liq` for a drop running off something on its way to the floor. */
const RUNOFF = 0x80;
/** Share of drops that run off what they hit (the rest soak in); blood always sticks. */
const RUNOFF_CHANCE: Record<number, number> = { [Liquid.Water]: 0.7, [Liquid.Acid]: 0.6, [Liquid.Oil]: 0.45 };

export class Particles {
  private smokeL = new Layer(3000, false, 44);
  private normal = new Layer(9000, false, 45);
  private fireL = new Layer(4000, false, 45.5);
  private additive = new Layer(4000, true, 46);
  private game: Game;
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  bloodEnabled = true;

  constructor(game: Game) {
    this.game = game;
    game.renderer.scene.add(this.smokeL.points, this.normal.points, this.fireL.points, this.additive.points);
    this.smokeL.points.renderOrder = 9;
    this.fireL.points.renderOrder = 11;
  }

  get count(): number {
    return this.smokeL.count + this.normal.count + this.fireL.count + this.additive.count;
  }

  emit(kind: PK, x: number, y: number, o: EmitOpts = {}): void {
    const L = kind === PK.Spark || kind === PK.Flash || kind === PK.Ember ? this.additive
      : kind === PK.Fire ? this.fireL : kind === PK.Smoke ? this.smokeL : this.normal;
    const i = L.add();
    L.x[i] = x;
    L.y[i] = y;
    L.vx[i] = o.vx ?? 0;
    L.vy[i] = o.vy ?? 0;
    L.life[i] = L.max[i] = o.life ?? 1;
    L.size[i] = o.size ?? PX;
    L.size1[i] = o.size1 ?? L.size[i];
    L.kind[i] = kind;
    L.grav[i] = o.gravity ?? 1;
    L.drag[i] = o.drag ?? 0;
    L.ignore[i] = o.ignore ?? null;
    L.liq[i] = o.liquid ?? 0;
    L.seed[i] = Math.random();
    const c = o.color ?? 0xffffff;
    unpack(c, L.col, i * 4, o.alpha ?? 1);
    unpack(o.color1 ?? c, L.col1, i * 4, o.alpha1 ?? o.alpha ?? 1);
  }

  /** Emits a fan of blood droplets. */
  blood(x: number, y: number, dx: number, dy: number, amount: number, speed = 2.5, ignore: RAPIER.RigidBody | null = null): void {
    if (!this.bloodEnabled) return;
    const n = Math.min(60, Math.round(amount));
    for (let k = 0; k < n; k++) {
      const s = speed * (0.3 + Math.random() * 0.9);
      const spread = 0.55;
      const ang = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * spread;
      const shadeRand = Math.random();
      const color = shadeRand < 0.33 ? 0x7d0d0d : shadeRand < 0.66 ? 0x941616 : 0x660909;
      this.emit(PK.Blood, x + (Math.random() - 0.5) * PX, y + (Math.random() - 0.5) * PX, {
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        life: 3,
        size: PX * (Math.random() < 0.3 ? 2 : 1),
        color,
        gravity: 1,
        drag: 0.4,
        ignore,
      });
    }
  }

  /** Emits droplets of a liquid (water, acid, oil) in a fan around (dx, dy). */
  liquid(kind: Liquid, x: number, y: number, dx: number, dy: number, amount: number, speed = 2.5, spread = 0.55, ignore: RAPIER.RigidBody | null = null): void {
    const n = Math.min(300, Math.round(amount));
    const shades = LIQUID_COLORS[kind];
    for (let k = 0; k < n; k++) {
      const s = speed * (0.3 + Math.random() * 0.9);
      const ang = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * spread;
      this.emit(PK.Blood, x + (Math.random() - 0.5) * PX, y + (Math.random() - 0.5) * PX, {
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        life: 3,
        size: PX * (Math.random() < 0.3 ? 2 : 1),
        color: shades[Math.floor(Math.random() * shades.length)],
        alpha: kind === Liquid.Water ? 0.8 : 1,
        gravity: 1,
        drag: 0.4,
        ignore,
        liquid: kind,
      });
    }
  }

  sparks(x: number, y: number, dx: number, dy: number, n: number, speed = 6): void {
    for (let k = 0; k < n; k++) {
      const ang = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * 0.9;
      const s = speed * (0.3 + Math.random());
      this.emit(PK.Spark, x, y, {
        vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life: 0.15 + Math.random() * 0.35,
        color: 0xfff1b0, color1: 0xff7a1a, alpha: 1, alpha1: 0.4, gravity: 0.8, drag: 1.5,
      });
    }
  }

  debris(x: number, y: number, dx: number, dy: number, n: number, color: number, speed = 3): void {
    for (let k = 0; k < n; k++) {
      const ang = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * 1.0;
      const s = speed * (0.3 + Math.random());
      const c = Math.random() < 0.5 ? color : ((color >> 1) & 0x7f7f7f) + 0x101010;
      this.emit(PK.Debris, x, y, {
        vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life: 2.5 + Math.random() * 2,
        color: c, size: PX * (Math.random() < 0.3 ? 2 : 1), gravity: 1, drag: 0.2, alpha1: 0.9,
      });
    }
  }

  smoke(x: number, y: number, n: number, size = 0.4, dark = false): void {
    for (let k = 0; k < n; k++) {
      const g = dark ? 0x2c2a29 : 0x6e6c6a;
      this.emit(PK.Smoke, x + (Math.random() - 0.5) * size, y + (Math.random() - 0.5) * size, {
        vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.8, life: 1.6 + Math.random() * 1.8,
        size: size * 0.5, size1: size * (1.4 + Math.random()), color: g, color1: 0x4a4948,
        alpha: 0.55, alpha1: 0, gravity: -0.05, drag: 1.2,
      });
    }
  }

  fire(x: number, y: number, intensity: number): void {
    // small flame tongues that rise, shrink and cool through the fire ramp
    const s = PX * (2.5 + intensity * 3 + Math.random() * 2);
    this.emit(PK.Fire, x + (Math.random() - 0.5) * PX * 2, y, {
      vx: (Math.random() - 0.5) * 0.5, vy: 1 + Math.random() * 1.4, life: 0.22 + Math.random() * 0.3,
      size: s, size1: s * 0.25, color: 0xffd25a, color1: 0xc8320f, alpha: 1, alpha1: 0.6, gravity: -0.3, drag: 1.4,
    });
    if (Math.random() < 0.04) {
      this.emit(PK.Ember, x, y, {
        vx: (Math.random() - 0.5) * 1.2, vy: 1.5 + Math.random() * 2, life: 0.6 + Math.random() * 0.8,
        color: 0xffb040, color1: 0x801800, alpha: 1, alpha1: 0.2, gravity: -0.05, drag: 0.8, size: PX,
      });
    }
  }

  flash(x: number, y: number, size: number, color = 0xfff0c0, life = 0.06): void {
    this.emit(PK.Flash, x, y, { life, size, size1: size * 0.6, color, color1: 0xff9a40, alpha: 1, alpha1: 0.6, gravity: 0 });
  }

  step(dt: number): void {
    this.stepLayer(this.smokeL, dt);
    this.stepLayer(this.normal, dt);
    this.stepLayer(this.fireL, dt);
    this.stepLayer(this.additive, dt);
  }

  private stepLayer(L: Layer, dt: number): void {
    const g = -9.81;
    const floor = WORLD.floor;
    const world = this.game.physics.world;
    for (let i = 0; i < L.count; i++) {
      L.life[i] -= dt;
      if (L.life[i] <= 0) {
        L.kill(i--);
        continue;
      }
      const kd = L.kind[i];
      const drag = Math.exp(-L.drag[i] * dt);
      L.vx[i] *= drag;
      L.vy[i] = L.vy[i] * drag + g * L.grav[i] * dt;
      const ox = L.x[i];
      const oy = L.y[i];
      const nx = ox + L.vx[i] * dt;
      const ny = oy + L.vy[i] * dt;
      if (kd === PK.Blood) {
        // ray-cast the droplet's path against the world so it can stain what it hits
        const dx = nx - ox;
        const dy = ny - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-5) {
          this.ray.origin = { x: ox, y: oy };
          this.ray.dir = { x: dx / d, y: dy / d };
          const ign = L.ignore[i];
          const liq = L.liq[i] & ~RUNOFF;
          const runoff = (L.liq[i] & RUNOFF) !== 0;
          const hit = world.castRayAndGetNormal(
            this.ray, d, true, undefined, runoff ? RUNOFF_FILTER : BLOOD_FILTER, undefined, ign && ign.isValid() ? ign : undefined,
          );
          if (hit) {
            const hx = ox + (dx / d) * hit.timeOfImpact;
            const hy = oy + (dy / d) * hit.timeOfImpact;
            const part = this.game.physics.partOf(hit.collider) ?? null;
            landDroplet(this.game, liq, part, hx, hy, hit.normal.x, hit.normal.y, L.col[i * 4], L.col[i * 4 + 1], L.col[i * 4 + 2]);
            if (part && Math.random() < (RUNOFF_CHANCE[liq] ?? 0)) {
              // trickles off and drips down to the floor
              L.x[i] = hx + hit.normal.x * PX * 0.5;
              L.y[i] = hy;
              L.vx[i] = L.vx[i] * 0.1 + hit.normal.x * 0.3;
              L.vy[i] = Math.min(0, L.vy[i] * 0.1);
              L.liq[i] = liq | RUNOFF;
              L.life[i] = Math.max(L.life[i], 2);
              continue;
            }
            L.kill(i--);
            continue;
          }
        }
        L.x[i] = nx;
        L.y[i] = ny;
        continue;
      }
      if ((kd === PK.Debris || kd === PK.Spark || kd === PK.Shell || kd === PK.Ember) && ny < floor + L.size[i] * 0.5) {
        L.x[i] = nx;
        L.y[i] = floor + L.size[i] * 0.5;
        L.vy[i] = -L.vy[i] * (kd === PK.Shell ? 0.45 : 0.3);
        L.vx[i] *= 0.6;
        if (Math.abs(L.vy[i]) < 0.3) L.vy[i] = 0;
        if (kd === PK.Shell && Math.abs(L.vy[i]) > 0.5) this.game.sound.casing(nx, L.size[i] > PX * 1.5);
        continue;
      }
      if (nx < WORLD.left || nx > WORLD.right) {
        L.vx[i] = -L.vx[i] * 0.3;
        continue;
      }
      L.x[i] = nx;
      // flames and smoke spread along the floor instead of sinking into it
      if (ny < floor && (kd === PK.Fire || kd === PK.Smoke || kd === PK.Dust || kd === PK.Flash)) {
        L.y[i] = floor;
        L.vy[i] = Math.abs(L.vy[i]) * 0.25;
        L.vx[i] *= 1.02;
        continue;
      }
      L.y[i] = ny;
    }
  }

  frame(): void {
    const s = this.game.renderer.zoom * this.game.renderer.dpr;
    for (const L of [this.smokeL, this.normal, this.fireL, this.additive]) {
      L.mat.uniforms.uScale.value = s;
      L.upload();
    }
  }

  clear(): void {
    for (const L of [this.smokeL, this.normal, this.fireL, this.additive]) L.count = 0;
  }
}

/** Permanent pixel stains on the static environment (blood on the floor, scorch marks). */
export class Stains {
  private cap = 60000;
  private n = 0;
  private head = 0;
  private pos: Float32Array;
  private rgba: Float32Array;
  private size: Float32Array;
  private shape: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  private occupied = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.cap * 3);
    this.rgba = new Float32Array(this.cap * 4);
    this.size = new Float32Array(this.cap).fill(PX);
    this.shape = new Float32Array(this.cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.rgba, 4));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('pshape', new THREE.BufferAttribute(this.shape, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 64 }, uPx: { value: PX } }, transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    pts.position.z = -18;
    pts.renderOrder = 1;
    scene.add(pts);
  }

  /** Adds a stain pixel snapped to the sprite-pixel grid. Re-staining a pixel darkens it. */
  add(x: number, y: number, r: number, g: number, b: number, a = 1): void {
    const ix = Math.floor(x / PX);
    const iy = Math.floor(y / PX);
    const key = ix * 100000 + iy;
    const existing = this.occupied.get(key);
    if (existing !== undefined) {
      const o = existing * 4;
      this.rgba[o] = this.rgba[o] * 0.85 + r * 0.15 * 0.8;
      this.rgba[o + 1] = this.rgba[o + 1] * 0.85 + g * 0.15 * 0.8;
      this.rgba[o + 2] = this.rgba[o + 2] * 0.85 + b * 0.15 * 0.8;
      this.rgba[o + 3] = Math.min(1, this.rgba[o + 3] + 0.1);
      this.markDirty(existing);
      return;
    }
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.n = Math.min(this.cap, this.n + 1);
    // evict the old occupant of this slot
    const ox = Math.floor(this.pos[i * 3] / PX);
    const oy = Math.floor(this.pos[i * 3 + 1] / PX);
    if (this.occupied.get(ox * 100000 + oy) === i) this.occupied.delete(ox * 100000 + oy);
    this.occupied.set(key, i);
    this.pos[i * 3] = (ix + 0.5) * PX;
    this.pos[i * 3 + 1] = (iy + 0.5) * PX;
    this.rgba[i * 4] = r;
    this.rgba[i * 4 + 1] = g;
    this.rgba[i * 4 + 2] = b;
    this.rgba[i * 4 + 3] = a;
    this.markDirty(i);
  }

  private markDirty(i: number): void {
    this.dirtyLo = Math.min(this.dirtyLo, i);
    this.dirtyHi = Math.max(this.dirtyHi, i);
  }

  frame(scale: number): void {
    this.mat.uniforms.uScale.value = scale;
    this.geo.setDrawRange(0, this.n);
    if (this.dirtyHi >= 0) {
      for (const name of ['position', 'pcolor']) {
        const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(this.dirtyLo * attr.itemSize, (this.dirtyHi - this.dirtyLo + 1) * attr.itemSize);
        attr.needsUpdate = true;
      }
      this.dirtyLo = Infinity;
      this.dirtyHi = -1;
    }
  }

  clear(): void {
    this.n = 0;
    this.head = 0;
    this.occupied.clear();
    this.rgba.fill(0);
    this.geo.setDrawRange(0, 0);
    this.markDirty(0);
    this.markDirty(this.cap - 1);
  }
}

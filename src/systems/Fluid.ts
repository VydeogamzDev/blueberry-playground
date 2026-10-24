import * as THREE from 'three';
import { PX, WORLD } from '../engine/constants';
import { UNIT_QUAD } from '../engine/Renderer';
import { liquidSound, LIQUID_COLORS, Liquid, type LiquidCatcher } from './Liquids';
import { DROP } from './Puddles';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Ground } from '../world/Environment';

/**
 * Water that flows: a few thousand particles that keep their distance from each
 * other (the double density relaxation of Clavet, Beaudoin and Poulin, 2005), so
 * that together they pour, splash, run downhill, find their level and fill what
 * holds them. They stay out of the ground and out of things (by their pixels:
 * a bucket's or a tank's hollow holds water), and push what they strike hard.
 * Things in it are held up by as much as they push aside, below the level of the
 * water round them (lighter than it they float, heavier they sink: see DENSITY),
 * and slowed as they move through it, and fires in it go out. A lone drop left
 * lying on the floor dries into a puddle (see Puddles); one in a bucket is
 * caught in it (see LiquidCatcher), and one in the sea is part of it.
 */

/** The spacing water settles at (m): each particle is this much of it, square. */
export const SPACING = 0.05;
/** How far (m) particles feel each other, and that squared. */
const H = SPACING * 2.2;
/** How far apart particles settle (m): as crowded as REST, a little nearer than SPACING (a block is made so, or it shrinks as it settles). */
const PACKED = SPACING * 0.9;
const H2 = H * H;
/** The density they settle at (as the kernel counts it: see relax()), how hard they keep to it, and how hard they keep apart up close. */
const REST = 2.1;
const STIFF = 30;
const NEAR = 60;
/** The furthest (m) a particle is pushed in one relaxation, and the fastest it goes (m/s): squeezed hard (something landing on it), water mustn't fly apart. */
const MOST_PUSH = SPACING * 0.35;
const MOST_SPEED = 14;
/** Water's mass per m² of sprite, as Materials have theirs (the sea's: see Water): flesh only just sinks, wood floats. */
const DENSITY = 85;
/** One particle's mass (kg). */
const MASS = DENSITY * SPACING * SPACING;
/** Drops (see Particles.liquid(), Puddles.DROP) to a particle: a flask's 270 or so make 20. */
export const DROPS_PER = (SPACING / PX) ** 2 / DROP;
/** The most there can be (fewer on a phone: it's the heaviest thing the game does with them). */
const MAX = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1600 : 3200;
/** How fast it slows what moves in it (1/s, all of it under), and its turning. */
const DRAG = 2.2;
const SPIN_DRAG = 2;
/** A particle striking something faster than this (m/s) pushes it (slower, it only flows round it). */
const PUSH_SPEED = 1;
/** The longest step (s) the water takes at a time. */
const STEP_MOST = 1 / 120;
/**
 * As much for water held up, lying in a body: faster than it stirs as it lies (m/s), but
 * not much (what moves through water must be slowed by what it shoves aside, or a float
 * and the water round it bob each other higher and higher).
 */
const PUSH_HELD = 0.5;
/** Of its speed along what it flows over, how much it loses each step. */
const SLIP = 0.02;
/** How much of how differently its neighbours move each particle takes on each step (viscosity: it damps the sloshing). */
const VISCOSITY = 0.08;
/** How fast water running over something alight damps it, a particle of it (as Fire.douse()'s, a second), and how often it splashes the rest of it (see Fire.splash()). */
const DOUSE = 2;
const DOUSE_SPLASH = 8;
/**
 * The water's push against a thing moving through it, per metre of breadth per
 * (m/s)²: half its density times a flat plate's drag (2), its density as
 * DENSITY's, per m² of sprite, over what that much water is deep (85 kg/m² of
 * 1000 kg/m³: 8.5 cm).
 */
const QUAD = 0.5 * 1000 * 2 * 0.085;
/** Density (as relax() has it) a particle needs to count as in a body of water (one on its surface has about 1.3) rather than spray. */
const BODY = 1;
/** A chest's buoyancy, for the air in it (see Part.buoyancy): someone in deep water floats, just. */
export const LUNGS = 4;
/** The most points of a part's outline float() weighs the water's pressure at. */
const RIM_MOST = 96;
/**
 * How far out from a point of an outline (px) water is looked for, and how near
 * there it must be: less than a tank's wall is thick, so the water in it isn't
 * taken for water outside it.
 */
const WET_OFF = 2;
const WET_R = 2;
/** Held up this much (see Fluid.held), water counts for what floats in it; and how fast that's taken in (1/s). */
const HELD = 0.5;
const HOLD_RATE = 6;
/** A particle on its own or in a film a particle thick (density under this, slower than STILL_SPEED) for LONE_TIME seconds dries up (on the floor, into a puddle). */
const LONE = 0.9;
const STILL_SPEED = 0.25;
const LONE_TIME = 1.5;
/**
 * A pool on the floor of no more than POOL_MOST particles (a few flasks' worth), all of it
 * slower than POOL_SPEED for POOL_TIME seconds, soaks into a puddle: a splash of water
 * beads up, as particles, and wouldn't spread out thin. More than that stays water.
 */
const POOL_MOST = 100;
const POOL_SPEED = 0.4;
const POOL_TIME = 0.5;
/** How far inside the pixel outside a part's face (px) a particle put back out of it is put. */
const ON_EDGE = 0.03;
/** Particles' collision radius against the room (m). */
const R = PX * 0.75;
/** Grid cells (spatial hash of particles, cell H). */
const TABLE = 8192;
/** Water going faster than this (m/s) is drawn out behind it, as far as it goes in STREAK_T s, up to STREAK_MOST m. */
const STREAK_SPEED = 1.5;
const STREAK_T = 0.025;
const STREAK_MOST = 0.15;
/** Speeds sent to guests are in steps of 1/VQ m/s (see pack()). */
const VQ = 512;

/** Pixel offsets round a pixel, nearest first, out to 6 px (where a particle inside something goes out to). */
const RING: [number, number][] = [];
for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) if ((i || j) && i * i + j * j <= 36) RING.push([i, j]);
RING.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uFoam;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.r < 0.5) discard;
  // a pale crest a pixel deep, then deeper water darker, in bands (as the sea's)
  float d = t.g * 255.0;
  if (d < 0.5) gl_FragColor = vec4(uFoam, 0.85);
  else {
    float k = floor(clamp(d / 40.0, 0.0, 1.0) * 4.0) / 4.0;
    gl_FragColor = vec4(mix(uMid, uDeep, k), 0.55 + 0.25 * k);
  }
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const rgb = (c: number) => new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);

/** The water, as captured for undo, saves and guests: so many particles, their positions and velocities (x, y, vx, vy each). */
export interface FluidState {
  n: number;
  xv: Float32Array;
}

/** What a part is in water for the step (see float()). */
interface Sampled {
  art: unknown;
  holes: number;
  /** Its solid pixels, a few px apart: body-local x, y (m). */
  pts: Float32Array;
  /**
   * Its outline, where water presses on it, a few px at a time: body-local x, y (m),
   * the way out of it there (a unit vector), and the length of outline (m) it stands for.
   */
  rim: Float32Array;
  /** The sprite area (m²) each of its solid pixels sampled stands for. */
  area: number;
}

export class Fluid {
  readonly max = MAX;
  /** How many particles there are. */
  n = 0;
  readonly x = new Float32Array(MAX);
  readonly y = new Float32Array(MAX);
  readonly vx = new Float32Array(MAX);
  readonly vy = new Float32Array(MAX);
  /** Where each was before the step, how crowded it was (see relax()), and how long it has lain alone. */
  private ox = new Float32Array(MAX);
  private oy = new Float32Array(MAX);
  private rho = new Float32Array(MAX);
  private lone = new Float32Array(MAX);
  /** How long each has been about still (slower than POOL_SPEED), and which search for a pool (see pools()) last came to it. */
  private rest = new Float32Array(MAX);
  private seen = new Int32Array(MAX);
  private seenAt = 0;
  private pool = new Int32Array(MAX);
  /**
   * How much each is held up by water under it (1) rather than falling free (0), as
   * of late: only held water presses on what's in it (a splash thrown up holds
   * nothing up), and its velocity at the step's start, to tell by.
   */
  private held = new Float32Array(MAX);
  private vy0 = new Float32Array(MAX);
  /** Spatial hash: first particle in each cell, the next in the same cell. */
  private head = new Int32Array(TABLE);
  private next = new Int32Array(MAX);
  /** A particle's neighbours, as relax() finds them. */
  private nb = new Int32Array(256);
  private nq = new Float32Array(256);
  private nx = new Float32Array(256);
  private ny = new Float32Array(256);
  /** Bounds of the particles (m), as of the last step. */
  private bx0 = 0;
  private by0 = 0;
  private bx1 = 0;
  private by1 = 0;
  private samples = new WeakMap<Part, Sampled>();
  /** What moves with each thing in the water, as of this step (see carriedMass()). */
  private carried = new Map<Entity, number>();
  /** Drops of water landed but not yet made a particle (see fromDrop()). */
  private drops = 0;
  private game: Game;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture | null = null;
  private field = new Float32Array(0);

  constructor(game: Game) {
    this.game = game;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex: { value: null },
        uDeep: { value: rgb(0x1d3f6b) },
        uMid: { value: rgb(LIQUID_COLORS[Liquid.Water][0]) },
        uFoam: { value: rgb(0xc4def0) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(UNIT_QUAD, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // (as the sea: in front of what's in it, under the light pass and the flames)
    this.mesh.renderOrder = 10.2;
    game.renderer.scene.add(this.mesh);
    game.frameHandlers.push(() => this.frame());
  }

  // ---- adding and taking away -------------------------------------------------

  /** A particle of water at (x, y) going (vx, vy); false if there's no room for more. */
  add(x: number, y: number, vx = 0, vy = 0): boolean {
    if (this.n >= MAX || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.ox[i] = x;
    this.oy[i] = y;
    this.rho[i] = REST;
    this.lone[i] = 0;
    this.rest[i] = 0;
    this.seen[i] = 0;
    this.held[i] = 0;
    return true;
  }

  /** A block of water `w` by `h` m centred on (x, y), at rest (as much as there's room for): how many particles it took. */
  addBlock(x: number, y: number, w: number, h: number, vx = 0, vy = 0): number {
    const cols = Math.max(1, Math.round(w / PACKED));
    const rows = Math.max(1, Math.round(h / PACKED));
    let made = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // (staggered a little, as water settles: rows straight above each other stack up unsteadily)
        const px = x - w / 2 + (c + 0.5 + (r % 2) * 0.25) * (w / cols);
        const py = y - h / 2 + (r + 0.5) * (h / rows);
        if (this.blocked(px, py)) continue;
        if (!this.add(px, py, vx, vy)) return made;
        made++;
      }
    }
    return made;
  }

  /** Is there water within `r` m of (x, y)? */
  near(x: number, y: number, r: number): boolean {
    if (!this.n || x < this.bx0 - r || x > this.bx1 + r || y < this.by0 - r || y > this.by1 + r) return false;
    const r2 = r * r;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - x;
      const dy = this.y[i] - y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  /** A drop of water landed at (x, y) going (vx, vy): every DROPS_PER of them make a particle there. */
  fromDrop(x: number, y: number, vx: number, vy: number): void {
    this.drops += 1;
    if (this.drops < DROPS_PER) return;
    this.drops -= DROPS_PER;
    this.add(x, y + PX, vx * 0.5, Math.max(vy * 0.3, -2));
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.ox[i] = this.ox[j];
    this.oy[i] = this.oy[j];
    this.rho[i] = this.rho[j];
    this.lone[i] = this.lone[j];
    this.rest[i] = this.rest[j];
    this.seen[i] = this.seen[j];
    this.held[i] = this.held[j];
  }

  clear(): void {
    this.n = 0;
    this.drops = 0;
  }

  /** Is (x, y) in the ground or the walls, or in a solid part? */
  private blocked(x: number, y: number): boolean {
    const g = this.game;
    if (x < WORLD.left || x > WORLD.right || y > WORLD.ceiling || (!g.env.floorless && y < WORLD.floor)) return true;
    if (g.env.ground.length && g.env.groundPieceAt(x, y)) return true;
    let hit = false;
    g.physics.world.intersectionsWithPoint({ x, y }, (c) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed && !p.noCollideAll) {
        const q = p.worldToPixel(x, y);
        if (p.solidAt(q.ix, q.iy)) hit = true;
      }
      return !hit;
    });
    return hit;
  }

  // ---- the step ------------------------------------------------------------------

  /**
   * A step of the host's (or a lone player's) game: the water moves and settles,
   * and moves what's in it. `show`: a guest's, only for show (it moves nothing,
   * and nothing dries up or is caught: the host's water arrives every so often).
   */
  step(dt: number, show = false): void {
    if (!this.n) return;
    const g = this.game;
    const grav = g.gravity;
    // (fast water steps more finely, so it doesn't jump through things: by how fast
    // much of it goes, not a drop or two stirring as it lies)
    const lim = (SPACING * 0.6) / dt;
    let over = 0;
    let over2 = 0;
    for (let i = 0; i < this.n; i++) {
      const s = Math.max(Math.abs(this.vx[i]), Math.abs(this.vy[i]));
      if (s > lim) {
        over++;
        if (s > lim * 2) over2++;
      }
    }
    const few = 2 + this.n * 0.02;
    // (and never more than STEP_MOST at a time: deep water, stepped longer, bursts up out of itself)
    const subs = Math.max(Math.ceil(dt / STEP_MOST - 1e-6), over2 > few ? 3 : over > few ? 2 : 1);
    const h = dt / subs;
    this.vy0.set(this.vy.subarray(0, this.n));
    for (let s = 0; s < subs; s++) {
      for (let i = 0; i < this.n; i++) {
        this.vy[i] += grav * h;
        this.ox[i] = this.x[i];
        this.oy[i] = this.y[i];
        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
      }
      this.hash();
      this.relax(h);
      this.room(h);
      this.things(h, show);
      for (let i = 0; i < this.n; i++) {
        let vx = (this.x[i] - this.ox[i]) / h;
        let vy = (this.y[i] - this.oy[i]) / h;
        const v = Math.hypot(vx, vy);
        if (v > MOST_SPEED) {
          vx *= MOST_SPEED / v;
          vy *= MOST_SPEED / v;
        }
        this.vx[i] = vx;
        this.vy[i] = vy;
      }
    }
    this.bounds();
    if (show) return;
    // (held up: it fell less than it would have, free)
    const ease = Math.min(1, dt * HOLD_RATE);
    for (let i = 0; i < this.n; i++) {
      const to = grav < -0.01 ? Math.min(1, Math.max(0, ((this.vy[i] - this.vy0[i]) / dt - grav) / -grav)) : 1;
      this.held[i] += (to - this.held[i]) * ease;
    }
    this.hash();
    this.float(dt);
    this.dry(dt);
  }

  /** Files each particle in the spatial hash. */
  private hash(): void {
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const k = cellKey(Math.floor(this.x[i] / H), Math.floor(this.y[i] / H));
      this.next[i] = this.head[k];
      this.head[k] = i;
    }
  }

  /**
   * Double density relaxation: each particle counts how crowded it is (its
   * neighbours within H, the nearer the more), and it and they are pushed apart
   * by as much as it's more crowded than water at rest (and pulled together by as
   * much as it's less: that's what holds a drop together), and pushed apart
   * harder still up close.
   */
  private relax(dt: number): void {
    const { x, y, head, next, nb, nq, nx, ny } = this;
    const dt2 = dt * dt;
    for (let i = 0; i < this.n; i++) {
      const xi = x[i];
      const yi = y[i];
      const cx = Math.floor(xi / H);
      const cy = Math.floor(yi / H);
      let m = 0;
      let rho = 0;
      let near = 0;
      // (how it and its neighbours have moved this step, for the viscosity)
      const mx = xi - this.ox[i];
      const my = yi - this.oy[i];
      let ax = 0;
      let ay = 0;
      let aw = 0;
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          for (let o = head[cellKey(cx + k, cy + j)]; o >= 0; o = next[o]) {
            if (o === i) continue;
            const dx = x[o] - xi;
            const dy = y[o] - yi;
            const r2 = dx * dx + dy * dy;
            if (r2 >= H2 || m >= 256) continue;
            const r = Math.sqrt(r2);
            const q = 1 - r / H;
            rho += q * q;
            near += q * q * q;
            ax += (x[o] - this.ox[o] - mx) * q;
            ay += (y[o] - this.oy[o] - my) * q;
            aw += q;
            nb[m] = o;
            nq[m] = q;
            // (two in the same spot: pushed apart any way at all)
            if (r > 1e-6) {
              nx[m] = dx / r;
              ny[m] = dy / r;
            } else {
              const a = Math.random() * Math.PI * 2;
              nx[m] = Math.cos(a);
              ny[m] = Math.sin(a);
            }
            m++;
          }
        }
      }
      this.rho[i] = rho;
      const P = STIFF * (rho - REST);
      const PN = NEAR * near;
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < m; k++) {
        const q = nq[k];
        const d = dt2 * (P * q + PN * q * q) * 0.5;
        const o = nb[k];
        x[o] += d * nx[k];
        y[o] += d * ny[k];
        sx -= d * nx[k];
        sy -= d * ny[k];
      }
      if (aw > 0) {
        sx += (ax / aw) * VISCOSITY;
        sy += (ay / aw) * VISCOSITY;
      }
      const sl = Math.hypot(sx, sy);
      const k = sl > MOST_PUSH ? MOST_PUSH / sl : 1;
      x[i] += sx * k;
      y[i] += sy * k;
    }
  }

  /** The room's floor, walls and ceiling, and the map's ground: what goes into them is put back on them, slipping a little along them. */
  private room(dt: number): void {
    const g = this.game;
    const { x, y, ox, oy } = this;
    const floor = g.env.floorless ? -Infinity : WORLD.floor + R;
    const ground = g.env.ground;
    for (let i = 0; i < this.n; i++) {
      if (y[i] < floor) {
        y[i] = floor;
        x[i] -= (x[i] - ox[i]) * SLIP;
      }
      if (x[i] < WORLD.left + R) x[i] = WORLD.left + R;
      else if (x[i] > WORLD.right - R) x[i] = WORLD.right - R;
      if (y[i] > WORLD.ceiling - R) y[i] = WORLD.ceiling - R;
      if (!ground.length) continue;
      const piece = g.env.groundPieceAt(x[i], y[i]);
      if (!piece) continue;
      const out = outOf(piece, x[i], y[i]);
      x[i] = out.x + out.nx * R;
      y[i] = out.y + out.ny * R;
      // (what it was going into the ground taken away, and a little of the rest)
      const vx = (x[i] - ox[i]) / dt;
      const vy = (y[i] - oy[i]) / dt;
      const vn = vx * out.nx + vy * out.ny;
      if (vn < 0) {
        ox[i] = x[i] - (vx - vn * out.nx) * (1 - SLIP) * dt;
        oy[i] = y[i] - (vy - vn * out.ny) * (1 - SLIP) * dt;
      }
    }
  }

  /**
   * Things: a particle that has gone into a part (by its pixels) is put back out
   * of it, the way it came in or the nearest way out, moving as the part does
   * there but for what it was going into it. Striking it hard, it pushes it.
   * One in a bucket's hollow is caught in it.
   */
  private things(dt: number, show: boolean): void {
    const g = this.game;
    const { x, y, ox, oy, head, next } = this;
    const floor = g.env.floorless ? -Infinity : WORLD.floor + R;
    const ground = g.env.ground.length > 0;
    for (const e of g.entities) {
      if (e.destroyed) continue;
      const catcher = show ? null : (e as Entity & Partial<LiquidCatcher>).catchDrop ? (e as Entity & LiquidCatcher) : null;
      for (const p of e.parts) {
        if (p.destroyed || p.noCollideAll) continue;
        const rr = (Math.hypot(p.w, p.h) * 0.5 + Math.hypot(p.spriteOffset.x, p.spriteOffset.y)) * PX + H;
        if (p.x + rr < this.bx0 || p.x - rr > this.bx1 || p.y + rr < this.by0 || p.y - rr > this.by1) continue;
        const f = p.flip;
        const c = Math.cos(p.a);
        const sn = Math.sin(p.a);
        const sox = p.spriteOffset.x;
        const soy = p.spriteOffset.y;
        const w2 = p.w / 2;
        const h2 = p.h / 2;
        // world -> sprite pixel (as Part.worldToPixelF())
        const pxOf = (wx: number, wy: number, out: { x: number; y: number }) => {
          const dx = wx - p.x;
          const dy = wy - p.y;
          const lx = dx * c + dy * sn;
          const ly = -dx * sn + dy * c;
          out.x = (lx / PX - sox * f) * f + w2;
          out.y = h2 - (ly / PX - soy);
        };
        // sprite pixel -> world (as Part.pixelToWorld(), but anywhere in the pixel: ix + 0.5 its middle)
        const worldAt = (fx: number, fy: number, out: { x: number; y: number }) => {
          const lx = (fx - w2 + sox) * f * PX;
          const ly = (h2 - fy + soy) * PX;
          out.x = p.x + lx * c - ly * sn;
          out.y = p.y + lx * sn + ly * c;
        };
        let jx = 0;
        let jy = 0;
        let tq = 0;
        const cx0 = Math.floor((p.x - rr) / H);
        const cx1 = Math.floor((p.x + rr) / H);
        const cy0 = Math.floor((p.y - rr) / H);
        const cy1 = Math.floor((p.y + rr) / H);
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let i = head[cellKey(cx, cy)]; i >= 0; i = next[i]) {
              // (a cell of the hash may hold particles from elsewhere; and one just caught is gone)
              if (!(Math.abs(x[i] - p.x) <= rr && Math.abs(y[i] - p.y) <= rr)) continue;
              pxOf(x[i], y[i], A);
              let ix = Math.floor(A.x);
              let iy = Math.floor(A.y);
              pxOf(ox[i], oy[i], B);
              const inside = p.solidAt(ix, iy);
              if (!inside) {
                if (catcher && catcher.catchDrop(Liquid.Water, p, x[i], y[i], DROPS_PER)) {
                  x[i] = NaN;
                  continue;
                }
                // (moving fast, it may have gone through a thin wall of it on the way)
                if (Math.abs(A.x - B.x) < 1.5 && Math.abs(A.y - B.y) < 1.5) continue;
              }
              // the way it came in, if it came from outside (through a thin wall too)
              let found = false;
              let nx = 0;
              let ny = 0;
              if (!p.solidAt(Math.floor(B.x), Math.floor(B.y))) {
                const steps = Math.min(24, Math.ceil(Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y)) * 2));
                let lx = Math.floor(B.x);
                let ly = Math.floor(B.y);
                for (let k = 1; k <= steps; k++) {
                  const t = k / steps;
                  const sx = Math.floor(B.x + (A.x - B.x) * t);
                  const sy = Math.floor(B.y + (A.y - B.y) * t);
                  if (p.solidAt(sx, sy)) {
                    // (across a corner of pixels: by the side of it, if that's open, the face it crossed was that one's)
                    if (sx !== lx && sy !== ly) {
                      if (!p.solidAt(sx, ly)) lx = sx;
                      else if (!p.solidAt(lx, sy)) ly = sy;
                    }
                    // (the face it crossed: art y runs down, and a mirrored sprite's x the other way)
                    nx = Math.sign(lx - sx) * f;
                    ny = -Math.sign(ly - sy);
                    ix = lx;
                    iy = ly;
                    found = true;
                    break;
                  }
                  lx = sx;
                  ly = sy;
                }
              }
              if (!inside && !found) continue;
              if (!found) {
                // the nearest pixel out of it (not into the floor or the ground: from under
                // something lying on them, water is squeezed out to the side)
                for (const [di, dj] of RING) {
                  if (p.solidAt(ix + di, iy + dj)) continue;
                  worldAt(ix + di + 0.5, iy + dj + 0.5, B);
                  if (B.y < floor || (ground && g.env.groundPieceAt(B.x, B.y))) continue;
                  nx = di * f;
                  ny = -dj;
                  ix += di;
                  iy += dj;
                  found = true;
                  break;
                }
              }
              if (!found) continue;
              // (how it was moving, before it's put back out)
              const vx = (x[i] - ox[i]) / dt;
              const vy = (y[i] - oy[i]) / dt;
              // out to the nearest point of the pixel outside: just off the face it crossed, where
              // it crossed it (put back in the pixel's middle, water lying on something couldn't
              // slide along it, and would fall half a pixel into it and be put back, over and over)
              worldAt(Math.min(Math.max(A.x, ix + ON_EDGE), ix + 1 - ON_EDGE), Math.min(Math.max(A.y, iy + ON_EDGE), iy + 1 - ON_EDGE), A);
              // (the face's way out, in the world)
              const nl = Math.hypot(nx, ny) || 1;
              const wnx = (nx * c - ny * sn) / nl;
              const wny = (nx * sn + ny * c) / nl;
              x[i] = A.x;
              y[i] = A.y;
              // (running over something alight, it damps it, and wets what's round it on that
              // body as it runs: as drops trickling over someone do, a flask's worth puts them out)
              if (!show && p.burning > 0) {
                g.fire.douse(p, DOUSE * dt);
                if (Math.random() < DOUSE_SPLASH * dt) g.fire.splash(p, x[i], y[i]);
              }
              // moving as the part does there, less what it was going into it
              const px = p.frozen ? 0 : p.vx - p.av * (y[i] - p.y);
              const py = p.frozen ? 0 : p.vy + p.av * (x[i] - p.x);
              let rx = vx - px;
              let ry = vy - py;
              const vn = rx * wnx + ry * wny;
              if (vn < 0) {
                rx -= vn * wnx;
                ry -= vn * wny;
                const thr = this.held[i] < HELD ? PUSH_SPEED : PUSH_HELD;
                if (!show && !p.frozen && -vn > thr) {
                  // it pushes what it strikes, by as much faster than that as it goes (water lying
                  // still only as it's struck: what's in it is held up by it as a whole, see float())
                  const ix2 = MASS * (vn + thr) * wnx;
                  const iy2 = MASS * (vn + thr) * wny;
                  jx += ix2;
                  jy += iy2;
                  tq += (x[i] - p.x) * iy2 - (y[i] - p.y) * ix2;
                }
              }
              ox[i] = x[i] - (px + rx * (1 - SLIP)) * dt;
              oy[i] = y[i] - (py + ry * (1 - SLIP)) * dt;
            }
          }
        }
        if (jx || jy) {
          p.body.applyImpulse({ x: jx, y: jy }, true);
          p.body.applyTorqueImpulse(tq, true);
        }
      }
    }
    // (those caught in a bucket)
    for (let i = this.n - 1; i >= 0; i--) if (Number.isNaN(x[i])) this.kill(i);
  }

  /** Where the particles are (m), with a cell's margin. */
  private bounds(): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const px = this.x[i];
      const py = this.y[i];
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    this.bx0 = x0 - H;
    this.by0 = y0 - H;
    this.bx1 = x1 + H;
    this.by1 = y1 + H;
  }

  /**
   * Things in water: each is held up by as much water as it pushes aside below the
   * level of the water round it (its pixels below it, by its buoyancy), at the
   * middle of what's under; slowed as it moves (and turns) through it, as it moves
   * against how the water flows there; and put out if it burns.
   */
  private float(dt: number): void {
    const g = this.game;
    const { x, y, head, next } = this;
    const up = -g.gravity;
    const margin = H * 1.5;
    this.carried.clear();
    for (const e of g.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.frozen || p.noCollideAll) continue;
        const rr = (Math.hypot(p.w, p.h) * 0.5 + Math.hypot(p.spriteOffset.x, p.spriteOffset.y)) * PX + margin;
        if (p.x + rr < this.bx0 || p.x - rr > this.bx1 || p.y + rr < this.by0 || p.y - rr > this.by1) continue;
        // the level of the water round it (spray doesn't count), and how it flows there
        let level = -Infinity;
        let wx = 0;
        let wy = 0;
        let wn = 0;
        const cx0 = Math.floor((p.x - rr) / H);
        const cx1 = Math.floor((p.x + rr) / H);
        const cy0 = Math.floor((p.y - rr) / H);
        const cy1 = Math.floor((p.y + rr) / H);
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let i = head[cellKey(cx, cy)]; i >= 0; i = next[i]) {
              if (Math.abs(x[i] - p.x) > rr || Math.abs(y[i] - p.y) > rr || this.rho[i] < BODY || this.held[i] < HELD) continue;
              if (y[i] > level) level = y[i];
              wx += this.vx[i];
              wy += this.vy[i];
              wn++;
            }
          }
        }
        if (!wn) continue;
        // (the surface is half a particle above the topmost)
        level += SPACING * 0.5;
        const s = this.sampled(p);
        const c = Math.cos(p.a);
        const sn = Math.sin(p.a);
        let under = 0;
        let ux0 = 0;
        for (let k = 0; k < s.pts.length; k += 2) {
          if (p.y + s.pts[k] * sn + s.pts[k + 1] * c >= level) continue;
          under++;
          ux0 += p.x + s.pts[k] * c - s.pts[k + 1] * sn;
        }
        if (!under) continue;
        // the water presses on its outline where there's water against it, as hard as
        // it's deep there: up on what floats in it, down on the bottom of a tank of it
        // (and of its outline under that level, how much is wet: a splash thrown up
        // round something isn't water it's in)
        const b = p.body;
        const com = b.worldCom();
        const press = p.weightless ? 0 : DENSITY * up;
        let fx = 0;
        let fy = 0;
        let tq = 0;
        let rim = 0;
        let wet = 0;
        const out = WET_OFF * PX;
        for (let k = 0; k < s.rim.length; k += 5) {
          const lx = s.rim[k];
          const ly = s.rim[k + 1];
          const len = s.rim[k + 4];
          const py = p.y + lx * sn + ly * c;
          if (py >= level) continue;
          const px = p.x + lx * c - ly * sn;
          const nx = s.rim[k + 2] * c - s.rim[k + 3] * sn;
          const ny = s.rim[k + 2] * sn + s.rim[k + 3] * c;
          rim += len;
          if (!this.wetAt(px + nx * out, py + ny * out, WET_R * PX, 1)) continue;
          wet += len;
          const f = press * len * (level - py);
          fx -= nx * f;
          fy -= ny * f;
          tq -= (px - com.x) * ny * f - (py - com.y) * nx * f;
        }
        const frac = (under / (s.pts.length / 2)) * (rim ? wet / rim : 1);
        if (frac <= 0) continue;
        // something lighter than its looks (air in it: a float, a chest) is held up more,
        // as much again as the water it's in for every buoyancy over 1, at the middle of it
        if (p.buoyancy > 1 && !p.weightless) {
          const lift = DENSITY * (p.buoyancy - 1) * up * s.area * under * (rim ? wet / rim : 1);
          fy += lift;
          tq += (ux0 / under - com.x) * lift;
        }
        const m = p.mass;
        const k = Math.min(1, DRAG * frac * dt);
        // (moving with the water: relative to how it flows there)
        const vx = p.vx - wx / wn;
        const vy = p.vy - wy / wn;
        // and the water in its way, by its breadth across how it'll be moving (a light float doesn't
        // shoot up and out; welded on something heavy, it moves as that does)
        const mm = carriedMass(g, p, this.carried);
        const ux = vx + (fx / mm) * dt;
        const uy = vy + (fy / mm + g.gravity * b.gravityScale()) * dt;
        const q = quadDrag(p, ux, uy, frac, dt, mm);
        b.applyImpulse({ x: fx * dt - vx * m * k - ux * q, y: fy * dt - vy * m * k - uy * q }, true);
        b.applyTorqueImpulse(tq * dt, true);
        b.setAngvel(b.angvel() * (1 - Math.min(1, SPIN_DRAG * frac * dt)), true);
        if (p.burning > 0 && frac > 0.3) g.fire.douse(p, 1);
      }
    }
  }

  /** Is there water (`need` particles or more, held up) within `r` m of (px, py)? */
  private wetAt(px: number, py: number, r: number, need = 2): boolean {
    const { x, y, head, next } = this;
    const r2 = r * r;
    let found = 0;
    const cx0 = Math.floor((px - r) / H);
    const cx1 = Math.floor((px + r) / H);
    const cy0 = Math.floor((py - r) / H);
    const cy1 = Math.floor((py + r) / H);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let i = head[cellKey(cx, cy)]; i >= 0; i = next[i]) {
          const dx = x[i] - px;
          const dy = y[i] - py;
          if (dx * dx + dy * dy < r2 && this.held[i] >= HELD && ++found >= need) return true;
        }
      }
    }
    return false;
  }

  /** A part's solid pixels, every few, and its outline: what float() weighs against the water. */
  private sampled(p: Part): Sampled {
    let s = this.samples.get(p);
    if (s && s.art === p.art && s.holes === p.holeCount) return s;
    const step = Math.max(1, Math.round(Math.max(p.w, p.h) / 12));
    const pts: number[] = [];
    // (the grid's margins even on both sides: a symmetrical thing is sampled so)
    for (let iy = Math.floor(((p.h - 1) % step) / 2); iy < p.h; iy += step) {
      for (let ix = Math.floor(((p.w - 1) % step) / 2); ix < p.w; ix += step) {
        if (!p.solidAt(ix, iy)) continue;
        const l = p.pixelToLocal(ix, iy);
        pts.push(l.x, l.y);
      }
    }
    // (too thin to sample: its middle)
    if (!pts.length) pts.push(0, 0);
    // its outline: the solid pixels beside one that isn't, and the way out of it at each
    // (the way the empty pixels round it lie, nearer ones counting more); taken together a
    // block of so many px at a time, those facing the same way (the top and bottom of a
    // thin plank kept apart). Not every so many in turn: down a box's sides that's every
    // pixel of one side and none of the other, and the water shoves it over.
    const edge: number[] = [];
    for (let iy = 0; iy < p.h; iy++) {
      for (let ix = 0; ix < p.w; ix++) {
        if (p.solidAt(ix, iy) && (!p.solidAt(ix - 1, iy) || !p.solidAt(ix + 1, iy) || !p.solidAt(ix, iy - 1) || !p.solidAt(ix, iy + 1))) edge.push(ix, iy);
      }
    }
    const every = Math.max(1, Math.ceil(edge.length / 2 / RIM_MOST));
    const bins = new Map<number, number[]>();
    for (let k = 0; k < edge.length; k += 2) {
      const ix = edge[k];
      const iy = edge[k + 1];
      let dx = 0;
      let dy = 0;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          if ((i || j) && !p.solidAt(ix + i, iy + j)) {
            const w = 1 / (i * i + j * j);
            dx += i * w;
            dy += j * w;
          }
        }
      }
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const way = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : dy > 0 ? 2 : 3;
      const key = ((Math.floor(iy / every) * 4096 + Math.floor(ix / every)) << 2) | way;
      let b = bins.get(key);
      if (!b) bins.set(key, (b = [0, 0, 0, 0, 0]));
      b[0] += ix;
      b[1] += iy;
      b[2] += dx / d;
      b[3] += dy / d;
      b[4]++;
    }
    const rim: number[] = [];
    for (const [sx, sy, snx, sny, n] of bins.values()) {
      const ix = sx / n;
      const iy = sy / n;
      const d = Math.hypot(snx, sny);
      if (d < 1e-6) continue;
      // (art y runs down, and a mirrored sprite's x the other way: as the part has it)
      const l = p.pixelToLocal(ix, iy);
      const o = p.pixelToLocal(ix + snx / d, iy + sny / d);
      const nl = Math.hypot(o.x - l.x, o.y - l.y) || 1;
      rim.push(l.x, l.y, (o.x - l.x) / nl, (o.y - l.y) / nl, n * PX);
    }
    s = { art: p.art, holes: p.holeCount, pts: new Float32Array(pts), rim: new Float32Array(rim), area: step * step * PX * PX };
    this.samples.set(p, s);
    return s;
  }

  /**
   * Water left lying alone (a drop, a film too thin to hold together) dries up: on
   * the floor into a puddle, elsewhere it's gone. What falls into the sea is the
   * sea's. Water fallen far into the void is gone.
   */
  private dry(dt: number): void {
    const g = this.game;
    const sea = g.map.water;
    const below = g.env.base - 5;
    // (first, while the hash is as the step left it)
    if (!g.env.floorless) this.pools(dt);
    for (let i = this.n - 1; i >= 0; i--) {
      const x = this.x[i];
      const y = this.y[i];
      if (sea && x >= sea.x0 && x <= sea.x1 && y < sea.level) {
        if (this.vy[i] < -3) liquidSound(g, 'liquid/splash', x, 0.2, 0.15);
        this.kill(i);
        continue;
      }
      if (y < below) {
        this.kill(i);
        continue;
      }
      const still = this.rho[i] < LONE && Math.abs(this.vx[i]) < STILL_SPEED && Math.abs(this.vy[i]) < STILL_SPEED;
      this.lone[i] = still ? this.lone[i] + dt : 0;
      if (this.lone[i] < LONE_TIME) continue;
      if (!g.env.floorless && y < WORLD.floor + PX * 3 && g.puddles.open(x)) g.puddles.add(Liquid.Water, x, DROP * DROPS_PER);
      this.kill(i);
    }
  }

  /** Small pools lying still on the floor soak into puddles (see POOL_MOST). */
  private pools(dt: number): void {
    const { x, y, vx, vy, rest, seen, pool, head, next } = this;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      rest[i] = Math.abs(vx[i]) < POOL_SPEED && Math.abs(vy[i]) < POOL_SPEED ? rest[i] + dt : 0;
      if (rest[i] >= POOL_TIME) any = true;
    }
    if (!any) return;
    // each pool found from a particle on the floor, through its neighbours: as soon as it's
    // too big, or some of it isn't still, it's left (and so is any pool that runs into it)
    const floor = WORLD.floor + R + PX;
    const first = this.seenAt + 1;
    const g = this.game;
    for (let s = 0; s < this.n; s++) {
      if (seen[s] >= first || y[s] >= floor || rest[s] < POOL_TIME) continue;
      const stamp = ++this.seenAt;
      let m = 0;
      let ok = true;
      seen[s] = stamp;
      pool[m++] = s;
      for (let q = 0; q < m && ok; q++) {
        const i = pool[q];
        const cx = Math.floor(x[i] / H);
        const cy = Math.floor(y[i] / H);
        for (let j = -1; j <= 1 && ok; j++) {
          for (let k = -1; k <= 1 && ok; k++) {
            for (let o = head[cellKey(cx + k, cy + j)]; o >= 0; o = next[o]) {
              const dx = x[o] - x[i];
              const dy = y[o] - y[i];
              if (dx * dx + dy * dy >= H2) continue;
              if (seen[o] === stamp) continue;
              if (seen[o] >= first || rest[o] < POOL_TIME || m >= POOL_MOST) {
                ok = false;
                break;
              }
              seen[o] = stamp;
              pool[m++] = o;
            }
          }
        }
      }
      // (left: what it got to stays marked, so a pool running into it later is left too)
      if (!ok) continue;
      // (last first: kill() moves the last particle into the gap)
      const members = Array.from(pool.subarray(0, m)).sort((a, b) => b - a);
      for (const i of members) {
        if (g.puddles.open(x[i])) g.puddles.add(Liquid.Water, x[i], DROP * DROPS_PER);
        this.kill(i);
      }
      // (the hash is out of date now: the rest next step)
      return;
    }
  }

  // ---- saving, undo, guests ----------------------------------------------------------

  capture(): FluidState {
    const xv = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      xv[i * 4] = this.x[i];
      xv[i * 4 + 1] = this.y[i];
      xv[i * 4 + 2] = this.vx[i];
      xv[i * 4 + 3] = this.vy[i];
    }
    return { n: this.n, xv };
  }

  restore(s: FluidState): void {
    this.clear();
    const n = Math.min(s.n, Math.floor(s.xv.length / 4));
    for (let i = 0; i < n; i++) this.add(s.xv[i * 4], s.xv[i * 4 + 1], s.xv[i * 4 + 2], s.xv[i * 4 + 3]);
    this.held.fill(1, 0, this.n);
    this.bounds();
  }

  /** The water for guests, smaller: where each particle is (x, y), and how fast it goes in 1/VQ m/s. */
  pack(): { n: number; xy: Float32Array; v: Int16Array } {
    const xy = new Float32Array(this.n * 2);
    const v = new Int16Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      xy[i * 2] = this.x[i];
      xy[i * 2 + 1] = this.y[i];
      v[i * 2] = Math.round(this.vx[i] * VQ);
      v[i * 2 + 1] = Math.round(this.vy[i] * VQ);
    }
    return { n: this.n, xy, v };
  }

  /** The host's water (see pack()). */
  unpack(n: number, xy: Float32Array, v: Int16Array): void {
    this.clear();
    const m = Math.min(n, xy.length >> 1, v.length >> 1);
    for (let i = 0; i < m; i++) this.add(xy[i * 2], xy[i * 2 + 1], v[i * 2] / VQ, v[i * 2 + 1] / VQ);
    this.held.fill(1, 0, this.n);
    this.bounds();
  }

  // ---- drawing -----------------------------------------------------------------------

  /**
   * Each frame: the particles are spread into a field over what of them is in view,
   * a pixel of it to a pixel of the world (fewer when there's a lot of it), and the
   * field drawn where it's thick enough, with how deep it is under the surface
   * there (for the shader's crest and darker depths).
   */
  private frame(): void {
    const r = this.game.renderer;
    if (!this.n) {
      this.mesh.visible = false;
      return;
    }
    // what's in view
    const hw = r.viewWidth / r.zoom / 2 + 0.5;
    const hh = r.height / r.zoom / 2 + 0.5;
    const x0 = Math.max(this.bx0, r.camX - hw);
    const x1 = Math.min(this.bx1, r.camX + hw);
    const y0 = Math.max(this.by0, r.camY - hh);
    const y1 = Math.min(this.by1, r.camY + hh);
    if (x1 <= x0 || y1 <= y0) {
      this.mesh.visible = false;
      return;
    }
    let cell = PX;
    while (((x1 - x0) / cell) * ((y1 - y0) / cell) > 600_000) cell *= 2;
    // (on whole pixels of the world, so it doesn't shimmer as the view moves)
    const gx0 = Math.floor(x0 / cell) - 3;
    const gy0 = Math.floor(y0 / cell) - 3;
    const need = { w: Math.ceil(x1 / cell) + 3 - gx0, h: Math.ceil(y1 / cell) + 3 - gy0 };
    // (a texture kept from frame to frame, made bigger as it needs to be: the water is drawn in its corner)
    let tex = this.tex;
    const cap = tex ? { w: tex.image.width, h: tex.image.height } : { w: 0, h: 0 };
    if (!tex || cap.w < need.w || cap.h < need.h || cap.w * cap.h > 4 * need.w * need.h + 65536) {
      tex?.dispose();
      const w = Math.ceil(need.w / 64) * 64;
      const h = Math.ceil(need.h / 64) * 64;
      tex = this.tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      this.mat.uniforms.uTex.value = tex;
    }
    const tw = tex.image.width;
    const th = tex.image.height;
    if (this.field.length < tw * th) this.field = new Float32Array(tw * th);
    const field = this.field;
    field.fill(0, 0, tw * th);
    // each particle spread round it (2.2 px across, falling off)
    const rad = Math.max(1.2, (PX * 2.2) / cell);
    const R2 = rad * rad;
    const ri = Math.ceil(rad);
    const splat = (fx: number, fy: number) => {
      if (fx < -ri || fy < -ri || fx > tw + ri || fy > th + ri) return;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      for (let j = -ri; j <= ri; j++) {
        const yy = iy + j;
        if (yy < 0 || yy >= th) continue;
        const dy = yy + 0.5 - fy;
        for (let k = -ri; k <= ri; k++) {
          const xx = ix + k;
          if (xx < 0 || xx >= tw) continue;
          const dx = xx + 0.5 - fx;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2) field[yy * tw + xx] += 1 - d2 / R2;
        }
      }
    };
    for (let i = 0; i < this.n; i++) {
      const fx = this.x[i] / cell - gx0;
      const fy = this.y[i] / cell - gy0;
      splat(fx, fy);
      // (going fast, drawn out behind it: a stream poured, not a string of beads)
      const v = Math.hypot(this.vx[i], this.vy[i]);
      if (v < STREAK_SPEED) continue;
      const len = Math.min(STREAK_MOST, v * STREAK_T) / cell;
      const steps = Math.ceil(len / 1.5);
      for (let s = 1; s <= steps; s++) {
        const t = (len * s) / steps / v;
        splat(fx - this.vx[i] * t, fy - this.vy[i] * t);
      }
    }
    // the texture: thick enough (r), and how deep under the surface, in world pixels (g)
    const data = tex.image.data as Uint8Array;
    const per = cell / PX;
    for (let xx = 0; xx < tw; xx++) {
      let depth = 0;
      for (let yy = th - 1; yy >= 0; yy--) {
        const o = (yy * tw + xx) * 4;
        const wet = field[yy * tw + xx] > 0.55;
        depth = wet ? depth + per : 0;
        data[o] = wet ? 255 : 0;
        data[o + 1] = Math.min(255, depth - per);
      }
    }
    tex.needsUpdate = true;
    this.mesh.visible = true;
    this.mesh.scale.set(tw * cell, th * cell, 1);
    this.mesh.position.set((gx0 + tw / 2) * cell, (gy0 + th / 2) * cell, 42);
  }
}

/** Scratch points. */
const A = { x: 0, y: 0 };
const B = { x: 0, y: 0 };

/**
 * The water's push against a part that would be moving through it at (vx, vy)
 * relative to it by the end of a step of `dt` (the other forces on it felt),
 * `frac` of it under: as the square of its speed, by its breadth across its way
 * (QUAD). As an impulse per m/s of that velocity, against it: worked out for
 * the speed it ends the step at (a light float's lift is many times its weight:
 * reckoned on its speed before, the drag could never catch up with it).
 */
export function quadDrag(p: Part, vx: number, vy: number, frac: number, dt: number, mass = p.mass): number {
  const s = Math.hypot(vx, vy);
  if (s < 1e-3 || mass <= 0) return 0;
  const ux = Math.cos(p.a);
  const uy = Math.sin(p.a);
  // (its sprite's extent at right angles to its way)
  const across = (p.w * Math.abs(ux * vy - uy * vx) + p.h * Math.abs(ux * vx + uy * vy)) / s;
  const c = (QUAD * across * PX * frac * dt) / mass;
  if (c <= 0) return 0;
  // (v' + c v'^2 = s)
  const v1 = (Math.sqrt(1 + 4 * c * s) - 1) / (2 * c);
  return (mass * (s - v1)) / s;
}

/**
 * The mass (kg) that moves with a part in water: its own, or, joined to other things
 * (a float welded or tied on something), all of theirs. `cache` keeps each thing's.
 */
export function carriedMass(g: Game, p: Part, cache: Map<Entity, number>): number {
  let m = cache.get(p.entity);
  if (m === undefined) {
    m = 0;
    const all = g.connections.assemblyOf([p.entity]);
    if (all.length > 1) for (const e of all) for (const q of e.parts) if (!q.destroyed) m += q.mass;
    cache.set(p.entity, m);
  }
  return Math.max(p.mass, m);
}

function cellKey(cx: number, cy: number): number {
  return (Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499)) & (TABLE - 1);
}

/** The nearest point on a piece of ground's outline to (x, y) (inside it), and the way out there. */
function outOf(g: Ground, x: number, y: number): { x: number; y: number; nx: number; ny: number } {
  const pts = g.pts;
  let best = Infinity;
  let bx = x;
  let by = y;
  let nx = 0;
  let ny = 1;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [ax, ay] = pts[i];
    const [cx, cy] = pts[(i + 1) % n];
    const ex = cx - ax;
    const ey = cy - ay;
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    const qx = ax + ex * t;
    const qy = ay + ey * t;
    const d = (x - qx) ** 2 + (y - qy) ** 2;
    if (d < best) {
      best = d;
      bx = qx;
      by = qy;
      const l = Math.sqrt(l2);
      nx = ey / l;
      ny = -ex / l;
    }
  }
  // (the outward side of that edge: away from where the point is, inside)
  if ((x - bx) * nx + (y - by) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: bx, y: by, nx, ny };
}

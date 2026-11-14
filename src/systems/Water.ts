import * as THREE from 'three';
import { PX, WORLD } from '../engine/constants';
import { UNIT_QUAD } from '../engine/Renderer';
import { PK } from './Particles';
import { liquidSound, LIQUID_COLORS, Liquid } from './Liquids';
import { carriedMass, quadDrag, floatShare, LIVE_FLICKER } from './Fluid';
import { isLiving } from './Fighting';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { MapSpec } from '../world/Maps';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';

/**
 * The sea's density, as Materials' (kg per m² of sprite): flesh (95) sinks
 * slowly, wood (55), plastic and rubber float, metal and stone sink fast.
 */
const DENSITY = 85;
/** How fast water slows what moves in it (1/s, all of it under), and its turning. */
const DRAG = 2.2;
const SPIN_DRAG = 2;
/** Coming down into the water faster than this (m/s), it splashes. */
const SPLASH_SPEED = 3;
/** How often (s) the void looks for what has fallen away. */
const FALL_EVERY = 0.5;
/** How far (m) below where the floor would be, in the void, fallen things are taken away. */
const FALL_DEPTH = 40;
/**
 * Held up harder or less hard than it's weighed down by more than this share of its
 * weight, something in the sea isn't floating still: drifting, unless it rests on something.
 */
const UNBALANCED = 0.1;
/** The same for something all under (it has no level to float at: see step()). */
const UNBALANCED_UNDER = 0.01;
/** Slower than this (m/s), something drifting might be taken for at rest: it's looked at. */
const SLOW = 0.3;
/** How often (s) what's slow in the sea is looked at, and what's asleep in it. */
const CHECK_EVERY = 0.25;
const CHECK_ASLEEP = 1;
/**
 * Bobbing on the surface, a float makes waves, and they carry its bobbing away: so much of
 * what would stop it dead (by how stiffly the water holds it at its level, and its weight).
 * The water's drag alone, by how much of it is under, left a light float riding high bobbing
 * for ever. All under, it has no waterline to make waves at, and none of this.
 */
const HEAVE_DAMP = 0.25;
/** Points a side in the grid over a hollow thing's box (see boxOf()). */
const BOX_GRID = 10;

const WATER_FRAG = /* glsl */ `
uniform float uLevel;
uniform vec2 uPhase;
uniform float uPx;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uFoam;
uniform vec2 uLive;
uniform float uTime;
varying vec2 vW;
void main() {
  // the surface in little stepped waves, a pixel or two either way
  float px = floor(vW.x / uPx);
  float wave = floor(1.2 * sin(px * 0.09 + uPhase.x) + 0.8 * sin(px * 0.023 - uPhase.y) + 0.5) * uPx;
  float y = floor(vW.y / uPx) * uPx;
  float d = uLevel + wave - y;
  if (d <= 0.0) discard;
  // a pale crest, then deeper water darker, in bands
  float k = floor(clamp(d / 8.0, 0.0, 1.0) * 4.0) / 4.0;
  if (d <= uPx * 1.5) gl_FragColor = vec4(uFoam, 0.85);
  else gl_FragColor = vec4(mix(uMid, uDeep, k), 0.4 + 0.25 * k);
  // a current through it (see LiveWater)
  if (vW.x > uLive.x && vW.x < uLive.y) gl_FragColor = ${LIVE_FLICKER}
}`;

const WORLD_VERT = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const rgb = (c: number) => new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);

/**
 * What a map does beyond its ground: its sea, and the void's bottomless drop.
 * Things in the sea are held up by as much water as they push aside (by their
 * sprite's area: lighter than water they float, heavier they sink, slowly
 * when only a little heavier), slowed as they move and turn in it, and put
 * out if they burn; coming down into it fast, they splash. On a map without a
 * floor, what falls far below where it would be is taken away. On a map with
 * neither, nothing is done.
 */
export class Water {
  private game: Game;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  /** The map the sea was drawn for. */
  private drawn: MapSpec | null = null;
  private t = 0;
  private fallT = 0;
  /** Grids over hollow things' boxes (see boxOf()). */
  private boxes = new WeakMap<Part, { art: unknown; pts: Float32Array }>();
  /** Till the next look at what's slow in the sea, and at what's asleep in it (s). */
  private checkT = 0;
  private sleepT = 0;
  /** What moves with each thing in the sea, as of this step (see carriedMass()). */
  private carried = new Map<Entity, number>();

  constructor(game: Game) {
    this.game = game;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uLevel: { value: 0 },
        uPhase: { value: new THREE.Vector2() },
        uPx: { value: PX },
        uDeep: { value: rgb(0x1d3f6b) },
        uMid: { value: rgb(LIQUID_COLORS[Liquid.Water][0]) },
        uFoam: { value: rgb(0xc4def0) },
        uLive: { value: new THREE.Vector2(1, -1) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(UNIT_QUAD, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // in front of what's in it (it's seen through the water), under the light pass and the flames
    this.mesh.renderOrder = 10.1;
    game.renderer.scene.add(this.mesh);
    game.frameHandlers.push((dt) => this.frame(dt));
  }

  /** The sea's surface at x (null: there's no sea there). */
  levelAt(x: number): number | null {
    const w = this.game.map.water;
    return w && x >= w.x0 && x <= w.x1 ? w.level : null;
  }

  /** A step of the host's (or a lone player's) game. */
  step(dt: number): void {
    const g = this.game;
    if (g.env.floorless) {
      this.fallT += dt;
      if (this.fallT >= FALL_EVERY) {
        this.fallT = 0;
        this.fallAway();
      }
    }
    const w = g.map.water;
    if (!w) return;
    const up = -g.gravity;
    this.carried.clear();
    // (what's slow, or asleep, in it is looked at now and then: drifting, or resting?)
    this.checkT -= dt;
    const look = this.checkT <= 0;
    if (look) this.checkT = CHECK_EVERY;
    this.sleepT -= dt;
    const lookAsleep = this.sleepT <= 0;
    if (lookAsleep) this.sleepT = CHECK_ASLEEP;
    for (const e of g.entities) {
      if (e.destroyed) continue;
      const living = isLiving(e);
      for (const p of e.parts) {
        if (p.destroyed || p.frozen || p.x < w.x0 || p.x > w.x1) continue;
        // how far down it reaches, turned as it is
        const hy = 0.5 * PX * (Math.abs(Math.cos(p.a)) * p.h + Math.abs(Math.sin(p.a)) * p.w);
        const bottom = p.y - hy;
        if (bottom >= w.level) continue;
        const b = p.body;
        const asleep = b.isSleeping();
        // (at rest on the bed, or floating still, it's left asleep: only now and then is it
        // looked at, whether it's hanging in the water instead)
        if (asleep && !lookAsleep) continue;
        const sunk = this.under(p, w.level, hy, living);
        if (!sunk) continue;
        const { under } = sunk;
        const m = p.mass;
        const gs = b.gravityScale();
        const lift = p.weightless ? 0 : sunk.lift * up;
        // neither held up as hard as it's weighed down nor resting on anything, it's drifting:
        // never at rest, however slowly it goes (see Entity.adriftAt), and if asleep, woken
        // (floating, a little either way is only bobbing about where it floats; all under, it
        // floats nowhere: as little as a hundredth either way, and it's on its way down or up)
        const unbalanced = Math.abs(lift - m * up * gs) > (under < 0.999 ? UNBALANCED : UNBALANCED_UNDER) * m * up;
        if (asleep) {
          if (unbalanced && !this.touching(p)) b.wakeUp();
          continue;
        }
        if (look && unbalanced && p.vx * p.vx + p.vy * p.vy < SLOW * SLOW && !this.touching(p)) e.adriftAt = g.time;
        if (p.vy < -SPLASH_SPEED && p.py - hy >= w.level) this.splash(p, w.level, -p.vy);
        const k = Math.min(1, DRAG * under * dt);
        const mm = carriedMass(g, p, this.carried);
        const uy = p.vy + (lift / mm + g.gravity * gs) * dt;
        // (the water in its way as thick through as it is: a pistol's no thicker than it weighs, see floatShare())
        const q = quadDrag(p, p.vx, uy, under * sunk.share, dt, mm);
        // (and its bobbing, carried off by the waves it makes: see HEAVE_DAMP)
        let heave = 0;
        if (sunk.stiff > 0) {
          const a = (2 * HEAVE_DAMP * Math.sqrt(sunk.stiff * up * mm) * dt) / mm;
          // (of what the drag left: together never more than stops it)
          heave = ((mm - q) * a) / (1 + a);
        }
        b.applyImpulse({ x: -p.vx * (m * k + q), y: -p.vy * m * k - uy * (q + heave) }, true);
        // held up at the middle of what's under (so a plank lies flat on the water and what's
        // top-heavy rolls over), or for living things (their lungs: see Breath), at their middle
        if (sunk.at) b.applyImpulseAtPoint({ x: 0, y: lift * dt }, sunk.at, true);
        else b.applyImpulse({ x: 0, y: lift * dt }, true);
        b.setAngvel(b.angvel() * (1 - Math.min(1, SPIN_DRAG * under * dt)), true);
        if (p.burning > 0 && under > 0.3) g.fire.douse(p, 1);
      }
    }
  }

  /**
   * How much of a part is under the sea at `level`, how hard (per m/s² of gravity) the
   * water holds it up, and where (null: at its middle). A living thing's limbs by their
   * size, as Breath has them float; anything else by its solid pixels under the surface,
   * as much as what it's made of floats (see floatShare()): not its whole picture's box,
   * which held up a chair's gaps and a pistol's empty corners and set them on the water.
   */
  private under(p: Part, level: number, hy: number, living: boolean): { under: number; lift: number; share: number; stiff: number; at: V2 | null } | null {
    if (living) {
      const under = Math.min(1, (level - (p.y - hy)) / (2 * hy));
      return { under, lift: DENSITY * p.buoyancy * p.w * p.h * PX * PX * under, share: 1, stiff: 0, at: null };
    }
    const s = this.game.fluid.sampled(p);
    // (with air in it, its whole picture's box: what's inside its walls is air, and holds it up too)
    const pts = p.hollow ? this.boxOf(p) : s.pts;
    const c = Math.cos(p.a);
    const sn = Math.sin(p.a);
    // each point stands for a cell round it, and counts as much of that as is under: counted
    // whole, what's under went up in steps as rows of them crossed the surface (a plank's one
    // row: all or nothing), and a light float bounced for ever between them
    const cw = p.hollow ? (p.w * PX) / BOX_GRID : Math.sqrt(s.area);
    const ch = p.hollow ? (p.h * PX) / BOX_GRID : cw;
    const tall = Math.max(1e-4, cw * Math.abs(sn) + ch * Math.abs(c));
    let n = 0;
    let ux = 0;
    let uy = 0;
    // (the cells the surface crosses: how much more goes under as it goes down, see stiff)
    let wet = 0;
    for (let k = 0; k < pts.length; k += 2) {
      const y = p.y + pts[k] * sn + pts[k + 1] * c;
      const f = (level - y) / tall + 0.5;
      if (f <= 0) continue;
      let w = 1;
      if (f < 1) {
        w = f;
        wet++;
      }
      n += w;
      ux += (p.x + pts[k] * c - pts[k + 1] * sn) * w;
      uy += y * w;
    }
    if (n <= 0) return null;
    const under = n / (pts.length / 2);
    const share = floatShare(p, s);
    const area = p.hollow ? p.w * p.h * PX * PX : s.area * (s.pts.length / 2) * share;
    const lift = DENSITY * p.buoyancy * area;
    // (stiff: how much harder it's held up for each metre further down, per m/s² of gravity)
    return { under, lift: lift * under, share, stiff: (lift * wet) / (tall * (pts.length / 2)), at: { x: ux / n, y: uy / n } };
  }

  /** A part's picture's box, a grid of points over it (body-local m): what's under of something hollow. */
  private boxOf(p: Part): Float32Array {
    let b = this.boxes.get(p);
    if (b && b.art === p.art) return b.pts;
    const n = BOX_GRID;
    const pts = new Float32Array(n * n * 2);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const l = p.pixelToLocal(((i + 0.5) / n) * p.w - 0.5, ((j + 0.5) / n) * p.h - 0.5);
        pts[k++] = l.x;
        pts[k++] = l.y;
      }
    }
    b = { art: p.art, pts };
    this.boxes.set(p, b);
    return pts;
  }

  /** Is it touching anything (resting on the bed, or on something else)? */
  private touching(p: Part): boolean {
    const world = this.game.physics.world;
    let hit = false;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (o) => {
        if (hit) return;
        const ob = o.parent();
        if (!ob || ob.handle === p.body.handle) return;
        world.contactPair(c, o, (man) => {
          if (man.numContacts() > 0) hit = true;
        });
      });
      if (hit) return true;
    }
    return false;
  }

  /** Water thrown up where something comes down into it, and its sound. */
  private splash(p: Part, level: number, speed: number): void {
    const g = this.game;
    const size = Math.sqrt(p.w * p.h) * PX;
    const n = Math.min(24, Math.round(speed * (2 + size * 6)));
    const shades = LIQUID_COLORS[Liquid.Water];
    for (let i = 0; i < n; i++) {
      g.particles.emit(PK.Debris, p.x + (Math.random() - 0.5) * size * 1.5, level + PX, {
        vx: (Math.random() - 0.5) * speed * 0.5, vy: speed * (0.3 + Math.random() * 0.5), life: 0.5 + Math.random() * 0.4,
        size: PX * (Math.random() < 0.3 ? 2 : 1), color: shades[i % shades.length], alpha: 0.9, alpha1: 0.5, gravity: 1, drag: 0.3,
      });
    }
    liquidSound(g, 'liquid/splash', p.x, Math.min(0.9, 0.25 + speed * 0.06), 0.12);
  }

  /** The void: whatever has fallen far below where the floor would be is gone. */
  private fallAway(): void {
    const g = this.game;
    const below = WORLD.floor - FALL_DEPTH;
    for (const e of g.entities) {
      if (e.destroyed) continue;
      let gone = true;
      for (const p of e.parts) {
        if (!p.destroyed && p.y > below) {
          gone = false;
          break;
        }
      }
      if (gone) g.remove(e);
    }
  }

  /** Each frame (every screen): the sea drawn, its waves moving on. */
  private frame(dt: number): void {
    const g = this.game;
    const w = g.map.water;
    if (!w) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    if (this.drawn !== g.map) {
      this.drawn = g.map;
      // from under the floor up to the crests of the waves
      const y0 = WORLD.floor - 1;
      const y1 = w.level + PX * 3;
      this.mesh.scale.set(w.x1 - w.x0, y1 - y0, 1);
      this.mesh.position.set((w.x0 + w.x1) / 2, (y0 + y1) / 2, 42);
      this.mat.uniforms.uLevel.value = w.level;
    }
    if (!g.paused) this.t += dt * g.timeScale;
    const tau = Math.PI * 2;
    this.mat.uniforms.uPhase.value.set((this.t * 1.7) % tau, (this.t * 1.1) % tau);
    // (a current through it: see LiveWater)
    const live = g.liveWater.sea;
    this.mat.uniforms.uLive.value.set(live ? live.x0 : 1, live ? live.x1 : -1);
    if (live) this.mat.uniforms.uTime.value = performance.now() / 1000;
  }
}

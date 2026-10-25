import * as THREE from 'three';
import { PX, WORLD } from '../engine/constants';
import { UNIT_QUAD } from '../engine/Renderer';
import { PK } from './Particles';
import { liquidSound, LIQUID_COLORS, Liquid } from './Liquids';
import { carriedMass, quadDrag, LIVE_FLICKER } from './Fluid';
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
    for (const e of g.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.frozen || p.x < w.x0 || p.x > w.x1) continue;
        // how far down it reaches, turned as it is
        const hy = 0.5 * PX * (Math.abs(Math.cos(p.a)) * p.h + Math.abs(Math.sin(p.a)) * p.w);
        const bottom = p.y - hy;
        if (bottom >= w.level) continue;
        const b = p.body;
        // (at rest on the bed, or floating still: left asleep)
        if (b.isSleeping()) continue;
        const under = Math.min(1, (w.level - bottom) / (2 * hy));
        if (p.vy < -SPLASH_SPEED && p.py - hy >= w.level) this.splash(p, w.level, -p.vy);
        const m = p.mass;
        const lift = p.weightless ? 0 : DENSITY * p.buoyancy * p.w * p.h * PX * PX * under * up;
        const k = Math.min(1, DRAG * under * dt);
        const mm = carriedMass(g, p, this.carried);
        const uy = p.vy + (lift / mm + g.gravity * b.gravityScale()) * dt;
        const q = quadDrag(p, p.vx, uy, under, dt, mm);
        b.applyImpulse({ x: -p.vx * (m * k + q), y: lift * dt - p.vy * m * k - uy * q }, true);
        b.setAngvel(p.av * (1 - Math.min(1, SPIN_DRAG * under * dt)), true);
        if (p.burning > 0 && under > 0.3) g.fire.douse(p, 1);
      }
    }
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

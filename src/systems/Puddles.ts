import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { Liquid, LIQUID_COLORS, liquidSound } from './Liquids';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

/** Floor cells, one per sprite pixel column. */
const N = Math.round((WORLD.right - WORLD.left) / PX);
/** Tallest a puddle is drawn (pixels). */
const ROWS = 4;
/** Liquid one droplet adds (px²): a flask pours ~270 drops, about what its bulb holds. */
export const DROP = 0.19;
/** Levelling sweeps per step. */
const SWEEPS = 6;
/** Seconds between effects on whatever lies in a puddle. */
const TOUCH = 0.1;

interface Kind {
  /** How fast it levels out. */
  flow: number;
  /** Thickness (px) below which it stops spreading. */
  film: number;
  /** Evaporation (px per second). */
  evap: number;
  alpha: number;
}

const KINDS: Record<number, Kind> = {
  [Liquid.Water]: { flow: 60, film: 0.45, evap: 0.012, alpha: 0.72 },
  [Liquid.Acid]: { flow: 50, film: 0.5, evap: 0.008, alpha: 0.85 },
  [Liquid.Oil]: { flow: 20, film: 0.7, evap: 0.0015, alpha: 0.95 },
};

const ACID_SCAR = 0x4d5a1f;

/** Puddles as captured for undo: the floor cells from lo to hi. */
export interface PuddleState {
  lo: number;
  hi: number;
  h: Float32Array;
  kind: Uint8Array;
  burn: Float32Array;
}

/**
 * Liquid lying on the floor. Drops that land on the floor pool up, run out level,
 * and slowly evaporate. Water in a puddle puts out whatever burns in it, acid eats
 * into anything lying in it, and oil soaks into things and burns, spreading along
 * the puddle.
 */
export class Puddles {
  private game: Game;
  private h = new Float32Array(N);
  private kind = new Uint8Array(N);
  private burn = new Float32Array(N);
  private lo = N;
  private hi = -1;
  private flipDir = false;
  private touchT = 0;
  private drawnLo = 0;
  private drawnHi = -1;
  private data = new Uint8Array(N * ROWS * 4);
  private tex: THREE.DataTexture;
  private mesh: THREE.Mesh;
  private dirty = false;

  constructor(game: Game, scene: THREE.Scene) {
    this.game = game;
    this.tex = new THREE.DataTexture(this.data, N, ROWS, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(N * PX, ROWS * PX), mat);
    this.mesh.position.set(WORLD.left + (N * PX) / 2, WORLD.floor + (ROWS * PX) / 2, 29.5);
    // over the bodies standing in it (they wade), under the light map and particles
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  private cell(x: number): number {
    return Math.max(0, Math.min(N - 1, Math.floor((x - WORLD.left) / PX)));
  }

  private cx(i: number): number {
    return WORLD.left + (i + 0.5) * PX;
  }

  /** Liquid (px²) at a floor x. */
  amountAt(x: number): number {
    return this.h[this.cell(x)];
  }

  kindAt(x: number): Liquid | null {
    const i = this.cell(x);
    return this.h[i] > 0 ? (this.kind[i] as Liquid) : null;
  }

  burningAt(x: number): boolean {
    return this.burn[this.cell(x)] > 0;
  }

  /** Total liquid on the floor (px²). */
  get total(): number {
    let s = 0;
    for (let i = this.lo; i <= this.hi; i++) s += this.h[i];
    return s;
  }

  /** A drop landed on the floor at x. */
  add(liquid: Liquid, x: number, amount = DROP): void {
    if (!KINDS[liquid]) return;
    const i = this.cell(x);
    if (this.h[i] > 0.05 && this.kind[i] !== liquid) {
      // water hitting burning oil puts that bit out; otherwise the bigger share wins
      if (liquid === Liquid.Water && this.burn[i] > 0) {
        this.burn[i] = Math.max(0, this.burn[i] - 0.5);
        liquidSound(this.game, 'liquid/steam', x, 0.35, 0.15);
      }
      if (amount > this.h[i]) this.kind[i] = liquid;
    } else this.kind[i] = liquid;
    this.h[i] += amount;
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
    this.dirty = true;
  }

  /** Sets oil burning around x (fire or explosions). */
  igniteNear(x: number, r: number): void {
    const a = this.cell(x - r);
    const b = this.cell(x + r);
    for (let i = Math.max(a, this.lo); i <= Math.min(b, this.hi); i++) {
      if (this.kind[i] === Liquid.Oil && this.h[i] > 0.1) this.burn[i] = Math.max(this.burn[i], 0.6);
    }
  }

  clear(): void {
    this.h.fill(0);
    this.burn.fill(0);
    this.lo = N;
    this.hi = -1;
    this.dirty = true;
  }

  /** The puddles as they are now. */
  capture(): PuddleState {
    const { lo, hi } = this;
    return { lo, hi, h: this.h.slice(lo, hi + 1), kind: this.kind.slice(lo, hi + 1), burn: this.burn.slice(lo, hi + 1) };
  }

  /** Puts the puddles back as captured. */
  restore(s: PuddleState): void {
    this.clear();
    if (s.hi < s.lo) return;
    this.h.set(s.h, s.lo);
    this.kind.set(s.kind, s.lo);
    this.burn.set(s.burn, s.lo);
    this.lo = s.lo;
    this.hi = s.hi;
  }

  step(dt: number): void {
    if (this.hi < this.lo) return;
    const h = this.h;
    const kind = this.kind;
    // ---- level out: each cell passes liquid to a lower neighbour (alternating
    // sweep direction so it doesn't drift one way)
    const lo = Math.max(0, this.lo - SWEEPS);
    const hi = Math.min(N - 1, this.hi + SWEEPS);
    const flow = (i: number, j: number) => {
      const a = h[i];
      if (a <= 0) return;
      const k = KINDS[kind[i]];
      const d = a - h[j];
      if (d <= 0 || a <= k.film) return;
      // different liquids don't run into each other
      if (h[j] > 0.05 && kind[j] !== kind[i]) return;
      const m = Math.min(d * 0.45, a - k.film, d * k.flow * dt);
      // a dry cell only gets wet with a real amount (slivers would just evaporate)
      if (m <= 1e-4 || (h[j] <= 0 && m < 0.1)) return;
      h[i] -= m;
      if (h[j] <= 0.05) kind[j] = kind[i];
      h[j] += m;
      if (this.burn[i] > 0 && kind[j] === Liquid.Oil && this.burn[j] <= 0 && Math.random() < dt * 3) this.burn[j] = 0.3;
    };
    // a few sweeps a step: liquid runs out to a level film in a second or two
    for (let it = 0; it < SWEEPS; it++) {
      this.flipDir = !this.flipDir;
      if (this.flipDir) for (let i = lo; i < hi; i++) flow(i, i + 1);
      else for (let i = hi; i > lo; i--) flow(i, i - 1);
    }
    for (let i = lo; i <= hi; i++) {
      if (h[i] <= 0) continue;
      const k = KINDS[kind[i]];
      let loss = k.evap * dt;
      // burning oil burns away and lights its neighbours
      if (this.burn[i] > 0) {
        loss += 0.06 * dt;
        this.burn[i] = Math.min(1, this.burn[i] + dt * 0.8);
        for (const j of [i - 1, i + 1]) {
          // flames run along an oil slick at about a metre a second
          if (j >= 0 && j < N && kind[j] === Liquid.Oil && h[j] > 0.1 && this.burn[j] <= 0 && Math.random() < dt * 30) this.burn[j] = 0.3;
        }
      }
      h[i] -= loss;
      if (h[i] < 0.03) {
        h[i] = 0;
        this.burn[i] = 0;
      }
    }
    // shrink the active range
    let a = lo;
    let b = hi;
    while (a <= b && h[a] <= 0) a++;
    while (b >= a && h[b] <= 0) b--;
    this.lo = a <= b ? a : N;
    this.hi = a <= b ? b : -1;
    this.dirty = true;
    this.touchT -= dt;
    if (this.touchT <= 0) {
      this.touchT = TOUCH;
      this.touch();
    }
    this.flames(dt);
  }

  /** Effects on things lying in a puddle. */
  private touch(): void {
    const g = this.game;
    const world = g.physics.world;
    const h = this.h;
    // each run of wet cells is checked with one thin box query
    let i = this.lo;
    while (i <= this.hi) {
      if (h[i] < 0.25) {
        i++;
        continue;
      }
      let j = i;
      let top = 0;
      while (j + 1 <= this.hi && h[j + 1] >= 0.25) j++;
      for (let k = i; k <= j; k++) top = Math.max(top, h[k]);
      const x0 = this.cx(i) - PX / 2;
      const x1 = this.cx(j) + PX / 2;
      const hh = (Math.min(ROWS, top) + 1) * PX * 0.5;
      const seen = new Set<Part>();
      world.intersectionsWithShape({ x: (x0 + x1) / 2, y: WORLD.floor + hh }, 0, new RAPIER.Cuboid((x1 - x0) / 2, hh), (c) => {
        const p = g.physics.partOf(c);
        if (p && !p.destroyed && !seen.has(p)) seen.add(p);
        return true;
      });
      for (const p of seen) this.soak(p, Math.max(i, Math.min(j, this.cell(p.x))));
      i = j + 1;
    }
  }

  private soak(p: Part, i: number): void {
    const g = this.game;
    const x = this.cx(i);
    switch (this.kind[i] as Liquid) {
      case Liquid.Water:
        if (p.burning > 0) {
          p.burning -= 0.3;
          if (p.burning <= 0.02) g.fire.extinguish(p);
          g.particles.smoke(p.x, WORLD.floor + PX * 3, 1, 0.12);
          liquidSound(g, 'liquid/steam', x, 0.4, 0.3);
        }
        p.oil = Math.max(0, p.oil - 0.05);
        break;
      case Liquid.Acid:
        p.entity.damage(p, 0.5, 'acid', { x, y: WORLD.floor }, { x: 0, y: -1 });
        if (!p.destroyed) p.paintAt(Math.max(p.x - 0.1, Math.min(p.x + 0.1, x)), WORLD.floor + PX, ACID_SCAR, 0, 0.5);
        this.h[i] = Math.max(0, this.h[i] - 0.03);
        if (Math.random() < 0.3) g.particles.smoke(x, WORLD.floor + PX * 2, 1, 0.07);
        liquidSound(g, 'liquid/sizzle', x, 0.3, 0.35);
        break;
      case Liquid.Oil:
        p.oil = Math.min(1, p.oil + 0.02);
        if (p.burning > 0.2) this.igniteNear(x, PX);
        else if (this.burn[i] > 0) g.fire.ignite(p, 0.4);
        break;
    }
  }

  /** Flames, light and crackle over burning oil. */
  private flames(dt: number): void {
    const g = this.game;
    let n = 0;
    let sx = 0;
    for (let i = this.lo; i <= this.hi; i++) {
      if (this.burn[i] <= 0) continue;
      n++;
      sx += i;
      if (Math.random() < dt * 9 * this.burn[i]) g.particles.fire(this.cx(i), WORLD.floor + PX, 0.35 + this.burn[i] * 0.4);
    }
    if (!n) return;
    const x = this.cx(sx / n);
    g.sound.hold(this, 'fire/crackle_loop', Math.min(0.6, 0.12 + n * 0.006), x);
  }

  /** Lights over burning oil (called once per rendered frame). */
  frame(): void {
    let run = 0;
    for (let i = this.lo; i <= this.hi + 1; i++) {
      if (i <= this.hi && this.burn[i] > 0) {
        run++;
        continue;
      }
      if (run > 2) {
        const mid = this.cx(i - run / 2);
        this.game.renderer.addLight(mid, WORLD.floor + 0.3, 1.2 + run * PX * 0.8, 0.5 * (0.85 + Math.random() * 0.3), 0xffa040);
      }
      run = 0;
    }
    if (this.dirty) this.draw();
  }

  private draw(): void {
    this.dirty = false;
    const d = this.data;
    // clear what was drawn last time, then draw the active range
    const c0 = Math.min(this.drawnLo, this.lo);
    const c1 = Math.max(this.drawnHi, this.hi);
    for (let i = c0; i <= c1; i++) for (let r = 0; r < ROWS; r++) d[(r * N + i) * 4 + 3] = 0;
    for (let i = this.lo; i <= this.hi; i++) {
      const a = this.h[i];
      if (a <= 0) continue;
      const k = KINDS[this.kind[i]];
      const base = LIQUID_COLORS[this.kind[i]][0];
      // whole pixels: a thin film shows as one row
      const rows = Math.min(ROWS, Math.max(1, Math.round(a)));
      for (let r = 0; r < rows; r++) {
        const surface = r === rows - 1;
        let col = surface ? lighten(base, 0.18) : base;
        if (this.burn[i] > 0 && surface) col = 0xd2691e;
        const o = (r * N + i) * 4;
        d[o] = (col >> 16) & 255;
        d[o + 1] = (col >> 8) & 255;
        d[o + 2] = col & 255;
        d[o + 3] = Math.round(255 * k.alpha * (a < 0.3 ? a / 0.3 : 1));
      }
    }
    this.drawnLo = this.lo;
    this.drawnHi = this.hi;
    this.tex.needsUpdate = true;
  }
}

function lighten(c: number, t: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (Math.round(r + (255 - r) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}

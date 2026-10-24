import * as THREE from 'three';
import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { Liquid, LIQUID_COLORS, liquidSound } from './Liquids';
import { HEAT } from './Fire';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Environment } from '../world/Environment';

/** Tallest a puddle is drawn (pixels). */
const ROWS = 4;
/**
 * The most floor cells drawn by one texture: a very wide map's floor is drawn in
 * strips (GPUs only take textures so wide), and only those a change touches go
 * to the GPU again.
 */
const STRIP = 4800;
/** Liquid one droplet adds (px²): a flask pours ~270 drops, about what its bulb holds. */
export const DROP = 0.19;
/** Levelling sweeps per step. */
const SWEEPS = 6;
/** Seconds between effects on whatever lies in a puddle. */
const TOUCH = 0.1;
/** How high (m) the flames of burning oil reach, heating what's over it. */
const FLAMES = 0.45;
/** The thinnest film of oil (px) that burns. */
const BURNS = 0.08;
/** Seconds burning oil that water reached stays out before flames nearby can light it again. */
const QUENCH = 1.5;
/**
 * Floor cells kept on an endless map (1024 m): not the whole floor, a stretch
 * of it that follows the camera (see follow()), so liquid costs no more however
 * far out it's poured. Liquid the stretch moves off is gone.
 */
const WINDOW = 32768;

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

/** Puddles as captured for undo: the floor cells from lo to hi (counted along the whole floor, from the left wall). */
export interface PuddleState {
  lo: number;
  hi: number;
  h: Float32Array;
  kind: Uint8Array;
  burn: Float32Array;
  /** How much of each cell's liquid is oil on top (none: a save from before oil floated, when a cell held one liquid). */
  oil?: Float32Array;
}

/**
 * Liquid lying on the floor. Drops that land on the floor pool up, run out level,
 * and slowly evaporate. Water in a puddle puts out whatever burns in it, acid eats
 * into anything lying in it, and oil soaks into things and burns, spreading along
 * the puddle. Oil floats on water or acid (each cell keeps the two layers apart):
 * lit, it burns there, and the acid under it still eats; water running in under
 * burning oil, or poured onto it, puts it out.
 */
export class Puddles {
  private game: Game;
  private scene: THREE.Scene;
  /** Floor cells, one per sprite pixel column across the world (see resize()); on an endless map, across WINDOW. */
  private n = 0;
  /** The first cell's place along the whole floor (cells from the left wall): 0 but on an endless map. */
  private base = 0;
  /** The cells are a stretch following the camera (an endless map; see follow()). */
  private endless = false;
  /** Each cell's liquid (px²), of `kind`: water or acid, with `oil` of it floating on top (a cell of oil alone is of kind Oil). */
  private h = new Float32Array(0);
  private kind = new Uint8Array(0);
  private oil = new Float32Array(0);
  /** How fiercely the oil in each cell burns (0..1); below 0, put out by water a moment ago (see QUENCH). */
  private burn = new Float32Array(0);
  /** Cells the map's ground stands on: liquid doesn't run in under it (see block()). */
  private blocked = new Uint8Array(0);
  private lo = 0;
  private hi = -1;
  private flipDir = false;
  private touchT = 0;
  private drawnLo = 0;
  private drawnHi = -1;
  /** The drawn floor in strips of STRIP cells at most (stripW each but the last): pixels, texture and mesh. */
  private strips: { w: number; data: Uint8Array; tex: THREE.DataTexture; mesh: THREE.Mesh }[] = [];
  private stripW = 1;
  private dirty = false;
  private seen = new Set<Part>();

  constructor(game: Game, scene: THREE.Scene) {
    this.game = game;
    this.scene = scene;
    this.resize();
  }

  /** Sizes the floor's cells to the world's width (a new map): any liquid on the floor is gone. */
  resize(): void {
    for (const s of this.strips) {
      this.scene.remove(s.mesh);
      s.tex.dispose();
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.endless = !!this.game.map.endless;
    const n = (this.n = this.endless ? WINDOW : Math.round((WORLD.right - WORLD.left) / PX));
    this.base = this.endless ? this.baseFor(this.game.renderer.camX) : 0;
    this.h = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.oil = new Float32Array(n);
    this.burn = new Float32Array(n);
    this.blocked = new Uint8Array(n);
    this.lo = n;
    this.hi = -1;
    this.drawnLo = n;
    this.drawnHi = -1;
    const count = Math.ceil(n / STRIP);
    this.stripW = Math.ceil(n / count);
    this.strips = [];
    for (let k = 0; k < count; k++) {
      const w = Math.min(this.stripW, n - k * this.stripW);
      const data = new Uint8Array(w * ROWS * 4);
      const tex = new THREE.DataTexture(data, w, ROWS, THREE.RGBAFormat);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * PX, ROWS * PX), mat);
      // over the bodies standing in it (they wade), under the light map and particles
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.strips.push({ w, data, tex, mesh });
    }
    this.place();
  }

  /** Puts the strips drawn over their cells. */
  private place(): void {
    this.strips.forEach((s, k) => s.mesh.position.set(WORLD.left + (this.base + k * this.stripW + s.w / 2) * PX, WORLD.floor + (ROWS * PX) / 2, 29.5));
  }

  /** Where the cells start on an endless map with the camera at x: it in their middle, all of them on the floor. */
  private baseFor(x: number): number {
    const all = Math.round((WORLD.right - WORLD.left) / PX);
    return Math.max(0, Math.min(all - this.n, Math.floor((x - WORLD.left) / PX) - (this.n >> 1)));
  }

  /**
   * On an endless map: keeps the cells under the camera's view. Once the view
   * nears either end of them they move along, the camera in their middle again,
   * and the liquid left behind is gone (as if it had soaked away).
   */
  private follow(): void {
    if (!this.endless) return;
    const r = this.game.renderer;
    // (the whole canvas either side, a little more: but never so much that it can't fit)
    const reach = Math.min(r.width / r.zoom + 16, this.n * PX * 0.4);
    if (this.at(r.camX - reach) >= 0 && this.at(r.camX + reach) < this.n) return;
    this.shift(this.baseFor(r.camX) - this.base);
  }

  /** Moves the cells `d` along the floor, keeping the liquid on those still in them. */
  private shift(d: number): void {
    if (!d) return;
    const n = this.n;
    for (const a of [this.h, this.kind, this.oil, this.burn]) {
      if (Math.abs(d) >= n) a.fill(0);
      else if (d > 0) a.copyWithin(0, d).fill(0, n - d);
      else a.copyWithin(-d, 0, n + d).fill(0, 0, -d);
    }
    this.base += d;
    this.lo = Math.max(0, this.lo - d);
    this.hi = Math.min(n - 1, this.hi - d);
    if (this.hi < this.lo) {
      this.lo = n;
      this.hi = -1;
    }
    this.place();
    this.block(this.game.env);
    // (everything drawn is in the wrong place now: all of it is drawn again)
    this.drawnLo = 0;
    this.drawnHi = n - 1;
    this.dirty = true;
  }

  /** Marks the floor cells the map's ground stands on, where liquid can't go. */
  block(env: Environment): void {
    this.blocked.fill(0);
    if (!env.ground.length && !env.floorless) return;
    const y = WORLD.floor + PX * 0.5;
    // (with no floor (the void), liquid lies only on ground whose top is where the floor would be)
    const under = WORLD.floor - PX * 0.5;
    for (let i = 0; i < this.n; i++) {
      if (!env.solidAt(this.cx(i), y) && !(env.floorless && !env.solidAt(this.cx(i), under))) continue;
      this.blocked[i] = 1;
      // ground laid over a puddle (the Terrain tool): what lay there is under it
      // now, not seeping out of it or burning inside it
      this.h[i] = 0;
      this.oil[i] = 0;
      this.burn[i] = 0;
    }
    this.dirty = true;
  }

  /** Is the floor at x open to liquid (not under the map's ground; on an endless map, in the cells kept)? */
  open(x: number): boolean {
    return this.kept(x) && !this.blocked[this.cell(x)];
  }

  /** The cell at x, counted from the first one kept (outside them below 0, or n and above). */
  private at(x: number): number {
    return Math.floor((x - WORLD.left) / PX) - this.base;
  }

  /** Is x over a cell kept? Always on a map of a size (x past its walls counts as at them). */
  private kept(x: number): boolean {
    if (!this.endless) return true;
    const i = this.at(x);
    return i >= 0 && i < this.n;
  }

  private cell(x: number): number {
    return Math.max(0, Math.min(this.n - 1, this.at(x)));
  }

  private cx(i: number): number {
    return WORLD.left + (this.base + i + 0.5) * PX;
  }

  /** Liquid (px²) at a floor x. */
  amountAt(x: number): number {
    return this.kept(x) ? this.h[this.cell(x)] : 0;
  }

  /** The liquid on top of a puddle at x: any oil floating there, else its water or acid. */
  kindAt(x: number): Liquid | null {
    const i = this.cell(x);
    if (!this.kept(x) || this.h[i] <= 0) return null;
    return this.oil[i] > 0.05 ? Liquid.Oil : (this.kind[i] as Liquid);
  }

  /** The water or acid in a puddle at x, under any oil on it (null: none, or oil alone). */
  underAt(x: number): Liquid | null {
    const i = this.cell(x);
    return this.kept(x) && this.h[i] - this.oil[i] > 0.05 ? (this.kind[i] as Liquid) : null;
  }

  /** Oil (px²) at a floor x, floating on whatever else is there. */
  oilAt(x: number): number {
    return this.kept(x) ? this.oil[this.cell(x)] : 0;
  }

  burningAt(x: number): boolean {
    return this.kept(x) && this.burn[this.cell(x)] > 0;
  }

  /** Total liquid on the floor (px²). */
  get total(): number {
    let s = 0;
    for (let i = this.lo; i <= this.hi; i++) s += this.h[i];
    return s;
  }

  /** A drop landed on the floor at x. */
  add(liquid: Liquid, x: number, amount = DROP): void {
    if (!KINDS[liquid] || !this.kept(x)) return;
    const i = this.cell(x);
    if (liquid === Liquid.Oil) {
      // oil floats on whatever is there
      if (this.h[i] <= 0) this.kind[i] = Liquid.Oil;
      this.oil[i] += amount;
    } else {
      // water hitting burning oil puts that bit out
      if (liquid === Liquid.Water && this.burn[i] > 0) {
        this.burn[i] = -QUENCH;
        liquidSound(this.game, 'liquid/steam', x, 0.35, 0.15);
      }
      // it goes in under any oil; water and acid meeting, the bigger share wins
      const under = this.h[i] - this.oil[i];
      if (under <= 0.05 || amount > under) this.kind[i] = liquid;
    }
    this.h[i] += amount;
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
    this.dirty = true;
  }

  /** Sets oil burning around x (fire or explosions). */
  igniteNear(x: number, r: number): void {
    if (!this.kept(x - r) && !this.kept(x + r) && !this.kept(x)) return;
    const a = this.cell(x - r);
    const b = this.cell(x + r);
    for (let i = Math.max(a, this.lo); i <= Math.min(b, this.hi); i++) {
      if (this.oil[i] > BURNS) this.burn[i] = Math.max(this.burn[i], 0.6);
    }
  }

  /** Floor cells of oil burning. */
  get burningCells(): number {
    let n = 0;
    for (let i = this.lo; i <= this.hi; i++) if (this.burn[i] > 0) n++;
    return n;
  }

  clear(): void {
    this.h.fill(0);
    this.oil.fill(0);
    this.burn.fill(0);
    this.lo = this.n;
    this.hi = -1;
    this.dirty = true;
  }

  /** The puddles as they are now. */
  capture(): PuddleState {
    const { lo, hi } = this;
    return { lo: this.base + lo, hi: this.base + hi, h: this.h.slice(lo, hi + 1), kind: this.kind.slice(lo, hi + 1), burn: this.burn.slice(lo, hi + 1), oil: this.oil.slice(lo, hi + 1) };
  }

  /** Puts the puddles back as captured (on an endless map, those in reach of the camera). */
  restore(s: PuddleState): void {
    this.clear();
    this.follow();
    // (cells past this map's floor are dropped: a save from a wider map; and those not kept)
    const lo = this.base;
    const hi = Math.min(s.hi, this.base + this.n - 1, s.lo + s.h.length - 1);
    if (s.lo < 0 || hi < Math.max(s.lo, lo)) return;
    const from = Math.max(0, lo - s.lo);
    const k = hi - (s.lo + from) + 1;
    const at = s.lo + from - this.base;
    this.h.set(s.h.subarray(from, from + k), at);
    this.kind.set(s.kind.subarray(from, from + k), at);
    this.burn.set(s.burn.subarray(from, from + k), at);
    if (s.oil) this.oil.set(s.oil.subarray(from, from + k), at);
    // (saved before oil floated: a cell of it was oil alone)
    else for (let i = at; i < at + k; i++) if (this.kind[i] === Liquid.Oil) this.oil[i] = this.h[i];
    this.lo = at;
    this.hi = at + k - 1;
  }

  step(dt: number): void {
    this.follow();
    if (this.hi < this.lo) return;
    const h = this.h;
    const kind = this.kind;
    const oil = this.oil;
    const burn = this.burn;
    const blocked = this.blocked;
    const OIL = KINDS[Liquid.Oil];
    // ---- level out: each cell passes liquid to a lower neighbour (alternating
    // sweep direction so it doesn't drift one way); water or acid runs out under
    // any oil and oil over it, each levelling by itself
    const lo = Math.max(0, this.lo - SWEEPS);
    const hi = Math.min(this.n - 1, this.hi + SWEEPS);
    const flow = (i: number, j: number) => {
      if (h[i] <= 0 || blocked[j]) return;
      const a = h[i] - oil[i];
      if (a > 0) {
        const k = KINDS[kind[i]];
        const b = h[j] - oil[j];
        const d = a - b;
        // (water and acid don't run into each other)
        if (d > 0 && a > k.film && (b <= 0.05 || kind[j] === kind[i])) {
          const m = Math.min(d * 0.45, a - k.film, d * k.flow * dt);
          // a dry cell only gets wet with a real amount (slivers would just evaporate)
          if (m > 1e-4 && (h[j] > 0 || m >= 0.1)) {
            h[i] -= m;
            if (b <= 0.05) kind[j] = kind[i];
            h[j] += m;
            // water running in under burning oil puts it out (spreading, not
            // the trickle of a puddle already all but level)
            if (burn[j] > 0 && kind[i] === Liquid.Water && m > dt * 1.2) burn[j] = -QUENCH;
          }
        }
      }
      const o = oil[i];
      const d = o - oil[j];
      if (d <= 0 || o <= OIL.film) return;
      const m = Math.min(d * 0.45, o - OIL.film, d * OIL.flow * dt);
      if (m <= 1e-4 || (h[j] <= 0 && m < 0.1)) return;
      oil[i] -= m;
      h[i] -= m;
      if (h[j] <= 0) kind[j] = Liquid.Oil;
      oil[j] += m;
      h[j] += m;
      if (burn[i] > 0 && burn[j] === 0 && oil[j] > BURNS && Math.random() < dt * 3) burn[j] = 0.3;
    };
    // a few sweeps a step: liquid runs out to a level film in a second or two
    for (let it = 0; it < SWEEPS; it++) {
      this.flipDir = !this.flipDir;
      if (this.flipDir) for (let i = lo; i < hi; i++) flow(i, i + 1);
      else for (let i = hi; i > lo; i--) flow(i, i - 1);
    }
    for (let i = lo; i <= hi; i++) {
      if (h[i] <= 0) continue;
      let o = oil[i];
      let a = h[i] - o;
      if (a > 0) a -= KINDS[kind[i]].evap * dt;
      if (o > 0) {
        o -= OIL.evap * dt;
        // burning oil burns away and lights its neighbours
        if (burn[i] > 0) {
          o -= 0.06 * dt;
          burn[i] = Math.min(1, burn[i] + dt * 0.8);
          // flames run along an oil slick at about a metre a second, and jump the
          // gaps in a dribbled trail of it (but not yet to oil water put out)
          for (let d = -2; d <= 2; d++) {
            const j = i + d;
            if (d === 0 || j < 0 || j >= this.n || oil[j] <= BURNS || burn[j] !== 0) continue;
            if (Math.random() < dt * (d === 1 || d === -1 ? 30 : 10)) burn[j] = 0.3;
          }
        }
      }
      if (burn[i] < 0) burn[i] = Math.min(0, burn[i] + dt);
      if (a < 0.03) a = 0;
      if (o < 0.03) {
        o = 0;
        burn[i] = 0;
      }
      oil[i] = o;
      h[i] = a + o;
      if (a <= 0 && o > 0) kind[i] = Liquid.Oil;
    }
    // shrink the active range
    let a = lo;
    let b = hi;
    while (a <= b && h[a] <= 0) a++;
    while (b >= a && h[b] <= 0) b--;
    this.lo = a <= b ? a : this.n;
    this.hi = a <= b ? b : -1;
    this.dirty = true;
    this.touchT -= dt;
    if (this.touchT <= 0) {
      this.touchT = TOUCH;
      this.touch();
    }
    this.flames(dt);
  }

  /** Effects on things lying in a puddle, and the heat of burning oil on things over it. */
  private touch(): void {
    const g = this.game;
    const world = g.physics.world;
    const h = this.h;
    const seen = this.seen;
    const collect = (c: RAPIER.Collider) => {
      const p = g.physics.partOf(c);
      if (p && !p.destroyed) seen.add(p);
      return true;
    };
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
      world.intersectionsWithShape({ x: (x0 + x1) / 2, y: WORLD.floor + hh }, 0, new RAPIER.Cuboid((x1 - x0) / 2, hh), collect);
      for (const p of seen) this.soak(p, Math.max(i, Math.min(j, this.cell(p.x))));
      seen.clear();
      i = j + 1;
    }
    // and each run of burning oil with a box as tall as its flames
    i = this.lo;
    while (i <= this.hi) {
      if (this.burn[i] <= 0) {
        i++;
        continue;
      }
      let j = i;
      let heat = 0;
      while (j + 1 <= this.hi && this.burn[j + 1] > 0) j++;
      for (let k = i; k <= j; k++) heat = Math.max(heat, this.burn[k]);
      const x0 = this.cx(i) - PX / 2;
      const x1 = this.cx(j) + PX / 2;
      world.intersectionsWithShape({ x: (x0 + x1) / 2, y: WORLD.floor + FLAMES / 2 }, 0, new RAPIER.Cuboid((x1 - x0) / 2, FLAMES / 2), collect);
      for (const p of seen) g.fire.warm(p, TOUCH * HEAT * heat);
      seen.clear();
      i = j + 1;
    }
  }

  private soak(p: Part, i: number): void {
    const g = this.game;
    const x = this.cx(i);
    // (lying in it, it's in both the water or acid and any oil on that)
    const under = this.h[i] - this.oil[i];
    if (under > 0.05 && this.kind[i] === Liquid.Water) {
      if (p.burning > 0) {
        g.particles.smoke(p.x, WORLD.floor + PX * 3, 1, 0.12);
        liquidSound(g, 'liquid/steam', x, 0.4, 0.3);
      }
      g.fire.douse(p, 0.3);
      p.oil = Math.max(0, p.oil - 0.05);
    } else if (under > 0.05 && this.kind[i] === Liquid.Acid) {
      p.entity.damage(p, 0.5, 'acid', { x, y: WORLD.floor }, { x: 0, y: -1 });
      if (!p.destroyed) p.paintAt(Math.max(p.x - 0.1, Math.min(p.x + 0.1, x)), WORLD.floor + PX, ACID_SCAR, 0, 0.5);
      this.h[i] -= Math.min(0.03, under);
      if (Math.random() < 0.3) g.particles.smoke(x, WORLD.floor + PX * 2, 1, 0.07);
      liquidSound(g, 'liquid/sizzle', x, 0.3, 0.35);
    }
    if (this.oil[i] > 0.05) {
      p.oil = Math.min(1, p.oil + 0.02);
      if (p.burning > 0.2) this.igniteNear(x, PX);
      else if (this.burn[i] > 0) g.fire.ignite(p, 0.4);
    }
  }

  /** A guest's step in a multiplayer game: the flames over burning oil, the puddles being the host's (see net/Guest). */
  showStep(dt: number): void {
    this.follow();
    if (this.hi >= this.lo) this.flames(dt);
  }

  /** Flames, light and crackle over burning oil (each screen in a multiplayer game makes its own). */
  private flames(dt: number): void {
    const g = this.game;
    g.fxMute++;
    try {
      this.burnFlames(g, dt);
    } finally {
      g.fxMute--;
    }
  }

  private burnFlames(g: Game, dt: number): void {
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
    this.follow();
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
    const sw = this.stripW;
    // clear what was drawn last time, then draw the active range
    const c0 = Math.min(this.drawnLo, this.lo);
    const c1 = Math.max(this.drawnHi, this.hi);
    for (let i = c0; i <= c1; i++) {
      const s = this.strips[(i / sw) | 0];
      const c = i % sw;
      for (let r = 0; r < ROWS; r++) s.data[(r * s.w + c) * 4 + 3] = 0;
    }
    for (let i = this.lo; i <= this.hi; i++) {
      const a = this.h[i];
      if (a <= 0) continue;
      const s = this.strips[(i / sw) | 0];
      const d = s.data;
      // whole pixels: a thin film shows as one row; any oil on top of the rest
      const rows = Math.min(ROWS, Math.max(1, Math.round(a)));
      const oily = this.oil[i] > 0.05 ? Math.min(rows, Math.max(1, Math.round(this.oil[i]))) : 0;
      for (let r = 0; r < rows; r++) {
        const kd = r >= rows - oily ? Liquid.Oil : this.kind[i];
        const k = KINDS[kd];
        const base = LIQUID_COLORS[kd][0];
        const surface = r === rows - 1;
        let col = surface ? lighten(base, 0.18) : base;
        if (this.burn[i] > 0 && surface) col = 0xd2691e;
        const o = (r * s.w + (i % sw)) * 4;
        d[o] = (col >> 16) & 255;
        d[o + 1] = (col >> 8) & 255;
        d[o + 2] = col & 255;
        d[o + 3] = Math.round(255 * k.alpha * (a < 0.3 ? a / 0.3 : 1));
      }
    }
    this.drawnLo = this.lo;
    this.drawnHi = this.hi;
    // only the strips drawn on go to the GPU again
    if (c1 >= c0) for (let k = (c0 / sw) | 0, last = Math.min(this.strips.length - 1, (c1 / sw) | 0); k <= last; k++) this.strips[k].tex.needsUpdate = true;
  }
}

function lighten(c: number, t: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (Math.round(r + (255 - r) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}

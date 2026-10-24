import { RAPIER } from '../engine/Physics';
import { PX, WORLD } from '../engine/constants';
import { PK } from './Particles';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';

/** Burning parts take turns at the slower work (heating neighbours, harm, scorching): each every SLICES steps. */
const SLICES = 24;
/** How far (m) past its sprite a fire heats things. */
const REACH = 0.08;
/** Heat a full fire gives whatever it reaches, per second (half as much again to things above it: flames rise). */
export const HEAT = 1.8;
/** Heat a thing loses per second away from a fire. */
const COOL = 0.3;
/** A thing catches once its heat times how readily it burns reaches this. */
const IGNITE = 0.6;
/** Seconds a soaked thing takes to dry out (it won't burn while wet). */
const DRY = 5;
/** How far (m) water landing on a body splashes over its other parts (see splash()). */
const SPLASH_R = 0.6;
/** Scorch marks spreading over burning things. */
const SCORCH = 0x1e1612;

/** Something that reacts to the heat of a fire beyond catching it (a flask of oil bursts). */
interface Heatable {
  onHeat(p: Part, heat: number): void;
}

/**
 * Burning parts: flames over the whole of them, smoke, glowing embers and
 * scorch marks; they char as their fuel burns away and die down once it's spent
 * (soaked-in oil burns hot and fast). Heat builds up in whatever touches a fire
 * or is very close to it, above it most of all, until it catches: sooner the
 * more flammable or oil-soaked it is. Water puts fires out and wets things so
 * they don't catch again until they dry.
 */
export class Fire {
  private game: Game;
  private burning = new Set<Part>();
  /** Heat built up in things near fires. */
  private heat = new Map<Part, number>();
  /** How wet things are (0..1). */
  private wet = new Map<Part, number>();
  /** Sparks thrown this step (x, y, count, speed), looked at once the step's queries are done. */
  private sparkQ: number[] = [];
  private turn = 0;
  private seen = new Set<Part>();

  constructor(game: Game) {
    this.game = game;
  }

  get count(): number {
    return this.burning.size;
  }

  /** The parts on fire now (rain puts out those it reaches: see Weather). */
  get burningParts(): ReadonlySet<Part> {
    return this.burning;
  }

  ignite(p: Part, amount = 0.6): void {
    if (p.destroyed) return;
    if (p.mat.flammability <= 0 && p.oil <= 0) {
      // what can't catch still feels the flame put to it (a molotov's rag catches,
      // a flask of oil cracks): as much heat as `amount` of a fire for a second
      (p.entity as Entity & Partial<Heatable>).onHeat?.(p, amount * HEAT);
      return;
    }
    p.burning = Math.min(1, Math.max(p.burning, amount));
    this.burning.add(p);
    this.heat.delete(p);
  }

  /** The nearest part burning within `r` m of (x, y), not counting `skip`'s own. */
  near(x: number, y: number, r: number, skip?: Entity): Part | null {
    let best: Part | null = null;
    let bd = r * r;
    for (const p of this.burning) {
      if (p.burning < 0.05 || p.entity === skip) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** In someone else's game: a part burns as much as the host says (shown, not simulated; see showStep). */
  show(p: Part, amount: number): void {
    p.burning = amount;
    if (amount > 0.02 && !p.destroyed) this.burning.add(p);
    else this.burning.delete(p);
  }

  extinguish(p: Part): void {
    p.burning = 0;
    this.burning.delete(p);
  }

  /** Water on a part: damps its fire (out once it's low) and wets it, so it won't catch again until it dries. */
  douse(p: Part, amount: number): void {
    this.wet.set(p, Math.min(1, (this.wet.get(p) ?? 0) + amount * 3));
    this.heat.delete(p);
    if (p.burning <= 0) return;
    p.burning -= amount;
    if (p.burning <= 0.02) this.extinguish(p);
  }

  /**
   * Water landing on a part runs and splashes over the rest of that body: its
   * other parts near (x, y) are damped and wetted a little too, so a flask
   * poured over someone puts them out, and a flame left on a hand doesn't light
   * the rest of them again as soon as they dry.
   */
  splash(p: Part, x: number, y: number): void {
    const parts = p.entity.parts;
    // (a body, an animal, a crate: not a contraption of hundreds of parts)
    if (parts.length > 40) return;
    for (const q of parts) {
      if (q === p || q.destroyed || (q.x - x) ** 2 + (q.y - y) ** 2 > SPLASH_R * SPLASH_R) continue;
      this.douse(q, 0.008);
    }
  }

  /**
   * Heat reaching a part from a fire (a full fire gives HEAT a second): it
   * catches once there's enough for what it's made of. Wet things don't.
   */
  warm(q: Part, amount: number): void {
    if (q.destroyed || q.burning >= 0.05) return;
    (q.entity as Entity & Partial<Heatable>).onHeat?.(q, amount);
    // (what's burnt out already won't catch again)
    const fl = q.mat.flammability * (1 - q.charred) + q.oil * 1.5;
    if (fl <= 0 || this.wet.has(q)) return;
    const h = (this.heat.get(q) ?? 0) + amount;
    if (h * fl >= IGNITE) this.ignite(q, Math.min(0.6, 0.2 + fl * 0.3));
    else this.heat.set(q, h);
  }

  /**
   * Sparks thrown at (x, y) (a ricochet, a laser, a blast) can light oil they
   * land on, soaked into things or lying on the floor. They're looked at once
   * the step's other queries are done (sparks fly from inside some of them).
   */
  sparks(x: number, y: number, n: number, speed: number): void {
    if (this.sparkQ.length < 128) this.sparkQ.push(x, y, n, speed);
  }

  /** A gout of flame at (x, y), `r` m across (a flask of oil bursting): it sets alight what it reaches. */
  flare(x: number, y: number, r: number): void {
    const g = this.game;
    for (let i = 0; i < 30; i++) g.particles.fire(x + (Math.random() - 0.5) * r, y + (Math.random() - 0.3) * r * 0.6, 1);
    g.particles.smoke(x, y + r * 0.3, 4, r * 0.6, true);
    g.renderer.addLight(x, y, 2 + r * 2, 0.8, 0xffa040, 0.3);
    if (y - WORLD.floor < r) g.puddles.igniteNear(x, r);
    // (its own list: a flare can go off while a fire is heating its neighbours)
    const caught: Part[] = [];
    g.physics.world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(r / 2), (c) => {
      const q = g.physics.partOf(c);
      if (q && !q.destroyed) caught.push(q);
      return true;
    });
    for (const q of caught) this.ignite(q, 0.8);
  }

  step(dt: number): void {
    this.turn = (this.turn + 1) % SLICES;
    const t = SLICES * dt;
    if (this.turn === 0) this.dry(t);
    if (this.sparkQ.length) this.flushSparks();
    if (!this.burning.size) return;
    // (in a multiplayer game each screen makes its own flames and crackle, from how much things burn)
    this.game.fxMute++;
    this.crackle();
    this.game.fxMute--;
    let k = 0;
    for (const p of this.burning) {
      if (p.destroyed) {
        this.burning.delete(p);
        continue;
      }
      // the fuel left: its own (less as it chars) and soaked-in oil, which burns
      // hot; the flames grow toward what it can feed and die down as it runs out
      const wet = this.wet.get(p) ?? 0;
      const fuel = p.mat.flammability * (1 - p.charred) + p.oil * 0.9;
      const target = fuel > 0.02 ? Math.min(1, 0.15 + fuel * 1.3) * (1 - wet) : 0;
      const rate = p.burning < target ? 0.4 + fuel : 0.35 + wet * 2;
      p.burning = Math.min(1, p.burning + (target - p.burning) * Math.min(1, dt * rate));
      if (p.burning <= 0.02) {
        this.extinguish(p);
        continue;
      }
      // what burns less readily chars sooner (a body burns out in about a minute, a crate in a little less)
      p.oil = Math.max(0, p.oil - dt * 0.05 * p.burning);
      p.charred = Math.min(1, p.charred + dt * p.burning * (0.03 + 0.04 * (1 - p.mat.flammability) + p.oil * 0.06));
      this.game.fxMute++;
      this.flames(p, dt);
      this.game.fxMute--;
      if ((k++ + this.turn) % SLICES === 0) this.tick(p, t);
    }
  }

  /** One crackle for all the fires, placed at their (heat-weighted) middle. */
  private crackle(): void {
    let heat = 0;
    let hx = 0;
    for (const p of this.burning) {
      heat += p.burning;
      hx += p.x * p.burning;
    }
    if (heat > 0.05) this.game.sound.hold(this, 'fire/crackle_loop', Math.min(0.7, 0.15 + heat * 0.12), hx / heat);
  }

  /**
   * A guest's step in a multiplayer game: only the flames and crackle, from how
   * much things burn in the host's game (see net/Guest); nothing spreads or burns down here.
   */
  showStep(dt: number): void {
    if (!this.burning.size) return;
    this.crackle();
    for (const p of this.burning) {
      if (p.destroyed || p.burning <= 0.02) this.burning.delete(p);
      else this.flames(p, dt);
    }
  }

  /** Flames licking up from all over a burning part, smoke, and embers glowing in its char. */
  private flames(p: Part, dt: number): void {
    const g = this.game;
    const size = Math.sqrt((p.w * p.h) / 120);
    let n = dt * p.burning * (12 + 45 * size);
    while (n > 0) {
      if (Math.random() < n) {
        const ix = Math.floor(Math.random() * p.w);
        const iy = Math.floor(Math.random() * p.h);
        if (p.solidAt(ix, iy)) {
          const w = p.pixelToWorld(ix, iy);
          g.particles.fire(w.x, w.y, p.burning);
          // more smoke as it chars and smoulders
          if (Math.random() < 0.06 + p.charred * 0.2) g.particles.smoke(w.x, w.y + 0.1, 1, 0.25, true);
        }
      }
      n -= 1;
    }
    let e = dt * p.burning * (0.4 + p.charred * 2) * (2 + 6 * size);
    while (e > 0) {
      if (Math.random() < e) {
        const ix = Math.floor(Math.random() * p.w);
        const iy = Math.floor(Math.random() * p.h);
        if (p.solidAt(ix, iy)) {
          const w = p.pixelToWorld(ix, iy);
          g.particles.emit(PK.Ember, w.x, w.y, {
            vx: 0, vy: 0.04, life: 0.3 + Math.random() * 0.6, size: PX,
            color: 0xffc050, color1: 0x8a1c00, alpha: 0.9, alpha1: 0, gravity: 0, drag: 0,
          });
        }
      }
      e -= 1;
    }
  }

  /** A burning part's slower work, every SLICES steps (`t` seconds' worth): harm, scorch marks, heating what's near it. */
  private tick(p: Part, t: number): void {
    const g = this.game;
    p.entity.damage(p, t * 6 * p.burning, 'fire');
    if (p.destroyed) return;
    let n = (t * p.burning * p.w * p.h) / 60;
    while (n > 0) {
      if (Math.random() < n) p.paintPixel(Math.floor(Math.random() * p.w), Math.floor(Math.random() * p.h), SCORCH, 0.3);
      n -= 1;
    }
    if (p.burning < 0.15) return;
    // whatever touches it or is very close: a box round its sprite, a little bigger
    const o = p.spriteOffset;
    const c = p.localToWorld(o.x * PX * p.flip, o.y * PX);
    const a = p.body.rotation();
    const hx = (p.w * PX) / 2 + REACH;
    const hy = (p.h * PX) / 2 + REACH;
    const seen = this.seen;
    g.physics.world.intersectionsWithShape(c, a, new RAPIER.Cuboid(hx, hy), (col) => {
      const q = g.physics.partOf(col);
      if (q && q !== p) seen.add(q);
      return true;
    });
    for (const q of seen) this.warm(q, t * HEAT * p.burning * (q.y > p.y + 0.1 ? 1.5 : 1));
    seen.clear();
    // and oil on the floor under it
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    if (c.y - ca * hy - sa * hx < WORLD.floor + PX * 2) g.puddles.igniteNear(c.x, ca * hx + sa * hy);
  }

  /** Things away from fires cool off, and wet ones dry (`t` seconds' worth). */
  private dry(t: number): void {
    for (const [p, h] of this.heat) {
      const v = h - t * COOL;
      if (v <= 0 || p.destroyed) this.heat.delete(p);
      else this.heat.set(p, v);
    }
    for (const [p, w] of this.wet) {
      const v = w - t / DRY;
      if (v <= 0 || p.destroyed) this.wet.delete(p);
      else this.wet.set(p, v);
    }
  }

  /** Sparks land: on oil-soaked things within their reach, and on oil on the floor (see sparks()). */
  private flushSparks(): void {
    const g = this.game;
    const q = this.sparkQ;
    for (let i = 0; i < q.length; i += 4) {
      const x = q[i];
      const y = q[i + 1];
      const r = 0.08 + q[i + 3] * 0.05;
      const chance = Math.min(1, q[i + 2] * 0.03);
      if (y - WORLD.floor < r && Math.random() < chance) g.puddles.igniteNear(x, r);
      g.physics.world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(r), (c) => {
        const p = g.physics.partOf(c);
        if (p && !p.destroyed && p.oil > 0.05 && p.burning < 0.05) this.seen.add(p);
        return true;
      });
      for (const p of this.seen) if (Math.random() < chance * p.oil * 2) this.ignite(p, 0.5);
      this.seen.clear();
    }
    q.length = 0;
  }

  /** Firelight: the biggest fires light their surroundings, flickering. */
  frame(): void {
    if (!this.burning.size) return;
    const list = [...this.burning].filter((p) => !p.destroyed);
    const size = (p: Part) => p.burning * Math.sqrt((p.w * p.h) / 120);
    list.sort((a, b) => size(b) - size(a));
    for (const p of list.slice(0, 6)) {
      const s = size(p);
      const flicker = 0.85 + Math.random() * 0.3;
      this.game.renderer.addLight(p.x, p.y + 0.15, 1.4 + Math.min(2.6, s * 2.2), Math.min(0.55, 0.2 + s * 0.3) * flicker, 0xff9a40);
    }
  }

  clear(): void {
    for (const p of this.burning) p.burning = 0;
    this.burning.clear();
    this.heat.clear();
    this.wet.clear();
    this.sparkQ.length = 0;
  }
}

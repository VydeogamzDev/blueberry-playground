import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { HEAT } from './Fire';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';

/** Hot parts take turns at the slower work (cooling, touching): each every SLICES steps. */
const SLICES = 6;
/** How hot (°C) a full fire burns. */
export const FLAME = 850;
/** Where metal and stone start to glow (°C: a dull red), and how much hotter is white hot. */
const GLOW_FROM = 480;
const GLOW_SPAN = 1000;
/** Skin burns against anything hotter than this (°C). */
const SCALDS = 55;
/** What burns catches against anything hotter than this (°C, a little short of wood's 300: heat builds up first). */
const KINDLES = 250;
/** How hot (°C) living things get, burning or not: they're mostly water (the flames are Fire's). */
const FLESH_TOP = 100;
/** How far (m) past its sprite a hot thing touches others. */
const REACH = 0.04;
/** How quickly heat flows between things touching (share of the difference a second). */
const CONDUCT = 0.6;

/** Something that reacts to its parts' temperature (a machine's insides failing, metal softening). */
interface TempAware {
  onTemp(p: Part, temp: number, t: number): void;
}

/**
 * Temperature: every part has one (Part.temp, °C), the air's (see Atmosphere)
 * unless something heats or chills it. Burning things climb toward a fire's
 * heat, flames heat what they reach (see Fire.warm()), and exhaust, lasers,
 * blasts and the nuke's flash heat things directly. Hot things cool back
 * toward the air (small ones faster, slower where it's thin), heat what
 * touches them (both ways, by their heat capacities), scald skin, light what
 * burns, and glow red to white hot if they don't burn themselves (metal, stone,
 * glass). Water chills them (with steam).
 *
 * Only parts away from the air's temperature are looked at (this.hot), each in
 * turn every SLICES steps: a scene at rest costs nothing.
 */
export class Heat {
  private game: Game;
  private hot = new Set<Part>();
  private turn = 0;
  private seen = new Set<Part>();

  constructor(game: Game) {
    this.game = game;
  }

  /** How many parts are away from the air's temperature. */
  get count(): number {
    return this.hot.size;
  }

  /** The parts away from the air's temperature. */
  get hotParts(): ReadonlySet<Part> {
    return this.hot;
  }

  /** Keeps an eye on a part (one catching fire: it climbs toward the fire's heat). */
  track(p: Part): void {
    if (!p.destroyed) this.hot.add(p);
  }

  /** Heats a part by `dT` degrees (chills it, negative). */
  add(p: Part, dT: number): void {
    if (p.destroyed || !dT) return;
    p.temp += dT;
    this.hot.add(p);
  }

  /** Sets a part's temperature (°C): a save loaded, a guest told. */
  set(p: Part, temp: number): void {
    if (p.destroyed) return;
    p.temp = temp;
    this.hot.add(p);
    this.glowOf(p);
  }

  /** Takes a share `k` (0..1) of the way from its temperature to `to`. */
  toward(p: Part, to: number, k: number): void {
    if (p.destroyed || k <= 0) return;
    p.temp += ((p.mat.bleeds ? Math.min(FLESH_TOP, to) : to) - p.temp) * Math.min(1, k);
    this.hot.add(p);
  }

  /** `joules` of heat into a part (warming by them over its mass and heat capacity). */
  energy(p: Part, joules: number): void {
    if (p.destroyed) return;
    this.add(p, joules / (Math.max(0.05, p.mass) * p.mat.heatCap));
  }

  /**
   * Heat from a fire's reach: `amount` as Fire measures it (HEAT a second from a
   * full fire), taking it toward a fire's heat, the slower the bigger it is.
   */
  fromFire(p: Part, amount: number): void {
    if (p.destroyed) return;
    const to = this.game.air.tempAt(p.y) + FLAME;
    if (p.temp >= to) return;
    this.toward(p, to, (amount * 0.12) / Math.sqrt(Math.max(0.3, p.mass)));
  }

  /** Water on a part: it cools fast toward the air, hissing if it was hot. */
  quench(p: Part, amount: number): void {
    if (p.destroyed || !this.hot.has(p)) return;
    const amb = this.game.air.tempAt(p.y);
    if (p.temp > 100 && Math.random() < 0.3) this.game.particles.smoke(p.x, p.y + 0.1, 1, 0.2, true);
    this.toward(p, amb, amount * 6);
  }

  /** Back to the air's temperature at once (mended: see Part.repair()). */
  reset(p: Part): void {
    p.temp = this.game.air.tempAt(p.y);
    p.glow = 0;
    this.hot.delete(p);
  }

  /** Forgets every part (the scene cleared). */
  clear(): void {
    this.hot.clear();
  }

  /**
   * The air's temperature changed (another map): what isn't hot or cold of its
   * own takes it at once.
   */
  settle(): void {
    const air = this.game.air;
    for (const e of this.game.entities) for (const p of e.parts) if (!this.hot.has(p)) p.temp = air.tempAt(p.y);
  }

  step(dt: number): void {
    this.turn = (this.turn + 1) % SLICES;
    if (!this.hot.size) return;
    const air = this.game.air;
    const t = SLICES * dt;
    let k = 0;
    for (const p of this.hot) {
      if (p.destroyed) {
        this.hot.delete(p);
        continue;
      }
      if ((k++ + this.turn) % SLICES !== 0) continue;
      const amb = air.tempAt(p.y);
      if (p.burning > 0.02) {
        // burning, it climbs toward the fire's heat (flesh toward boiling: its water holds it there)
        const to = p.mat.bleeds ? Math.min(FLESH_TOP, amb + FLAME * p.burning) : amb + FLAME * p.burning;
        p.temp += (to - p.temp) * Math.min(1, t * 0.8);
      } else {
        // cooling toward the air: small things faster, and slower in thin air (only glowing it away)
        const rate = (0.015 + 0.05 / Math.sqrt(Math.max(0.3, p.mass))) * (0.25 + 0.75 * air.thinness(p.y));
        p.temp += (amb - p.temp) * Math.min(1, t * rate);
      }
      if (Math.abs(p.temp - amb) < 0.5 && p.burning <= 0.02) {
        p.temp = amb;
        p.glow = 0;
        this.hot.delete(p);
        continue;
      }
      this.glowOf(p);
      // (what burns catches by itself once it's hot enough: a nuke's flash, a hot plate under it)
      if (p.temp > KINDLES && p.burning <= 0.02 && p.mat.flammability > 0) this.game.fire.warm(p, t * HEAT * Math.min(1, (p.temp - KINDLES) / 400));
      if (p.temp > SCALDS) this.touch(p, t);
      (p.entity as Entity & Partial<TempAware>).onTemp?.(p, p.temp, t);
    }
  }

  /** Red to white hot: only what doesn't burn itself (metal, stone, glass); burning things have their embers. */
  private glowOf(p: Part): void {
    p.glow = p.mat.flammability > 0 ? 0 : Math.max(0, Math.min(1, (p.temp - GLOW_FROM) / GLOW_SPAN));
  }

  /** What touches a hot part: heat flows into it, skin scalds, what burns kindles (`t` seconds' worth). */
  private touch(p: Part, t: number): void {
    const g = this.game;
    const o = p.spriteOffset;
    const c = p.localToWorld(o.x * PX * p.flip, o.y * PX);
    const seen = this.seen;
    g.physics.world.intersectionsWithShape(c, p.bodyAngle, new RAPIER.Cuboid((p.w * PX) / 2 + REACH, (p.h * PX) / 2 + REACH), (col) => {
      const q = g.physics.partOf(col);
      if (q && q !== p && !q.destroyed) seen.add(q);
      return true;
    });
    if (!seen.size) return;
    const cp = Math.max(0.05, p.mass) * p.mat.heatCap;
    for (const q of seen) {
      // heat flows from the hotter to the colder, by how much each holds
      if (p.temp > q.temp) {
        const cq = Math.max(0.05, q.mass) * q.mat.heatCap;
        const flow = (p.temp - q.temp) * Math.min(0.5, t * CONDUCT) * ((cp * cq) / (cp + cq));
        p.temp -= flow / cp;
        q.temp = Math.min(q.mat.bleeds ? FLESH_TOP : Infinity, q.temp + flow / cq);
        this.hot.add(q);
        this.glowOf(q);
      }
      // (a hot thing scalds skin; a feverish limb doesn't: someone's burns are Fire's)
      if (q.mat.bleeds) {
        if (!p.mat.bleeds && p.temp > SCALDS) q.entity.damage(q, (p.temp - SCALDS) * 0.01 * t, 'fire');
      } else if (p.temp > KINDLES && (q.mat.flammability > 0 || q.oil > 0)) g.fire.warm(q, t * HEAT * Math.min(1, (p.temp - KINDLES) / 400));
    }
    seen.clear();
  }
}

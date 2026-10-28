import { Item, type HoldSpec, type Holder } from './Item';
import type { PropConfig } from './Prop';
import { asPatient, glowOver, sparkle, DRUG_GLOW, type Patient } from './Medical';
import { PINK_DRUGS, type Drug } from './Syringe';
import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { PK } from '../systems/Particles';
import { DRUG_RAMPS } from '../art/items';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import type { BulletHit, ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

/**
 * A knock this fast (m/s) smashes it: thrown at anything, or dropped from about
 * shoulder height (a fall of 1.5 m). Set down, or dropped from the hand, it stays whole.
 */
export const SMASH_SPEED = 5.5;
/**
 * ...and thrown from someone's hand (Use), the first knock this fast breaks it
 * wherever it comes down: lobbed, it lands slower than SMASH_SPEED, and a thrown
 * potion bouncing off the floor whole is no use.
 */
const THROWN_SMASH = 2;
/**
 * The splash: how far (m) from where it broke it reaches anyone (from the middle of
 * the bottle to the nearest of them), how far out they still get a whole dose, and
 * the least share of one that does anything (a few drops); and how many drops fly.
 */
export const SPLASH = { radius: 1.8, full: 0.45, least: 0.12, drops: 70 };
/** Thrown from someone's hand (Use): how fast it leaves the hand (m/s), forward and up, and how fast it tumbles (rad/s). */
const THROW = { vx: 4.5, vy: 3, spin: 9 };
/** Heavier than this (kg), something between the splash and someone keeps it off them (a wall, a crate; not a gun lying about). */
const SHIELDS = 15;

/**
 * A splash potion: a small round glass bottle of one of the syringes' drugs.
 * Thrown (dragged and flung, or Use in someone's hand: they throw it ahead of
 * them), it smashes on a hard enough knock and splashes the drug over everyone
 * round where it broke, people and animals: a whole syringe's dose near the
 * middle, less further out, none past SPLASH.radius nor through a wall. Use
 * anywhere else smashes it where it is; a bullet or a blast breaks it too. A
 * Pink one picks one drug for the whole splash.
 */
export class SplashPotion extends Item {
  readonly drug: Drug;
  private broken = false;
  /** Thrown from a hand and not yet come down (see THROWN_SMASH). */
  private thrown = false;
  /** Kept for looking from the splash to whoever it might reach (see reaches()). */
  private ray: RAPIER.Ray | null = null;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, drug: Drug, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, x, y, opts);
    this.drug = drug;
    this.activatable = true;
  }

  /** Use: in someone's hand, they throw it ahead of them; anywhere else it's smashed where it is. */
  activate(): void {
    if (this.broken || this.destroyed) return;
    if (this.holder) this.throwFrom(this.holder);
    else this.shatter();
  }

  /** Thrown from someone's hand: let go of, flying off ahead of them and up, tumbling, to smash wherever it comes down. */
  private throwFrom(h: Entity & Holder): void {
    const dir = (h as Entity & { facing?: number }).facing ?? (this.main.flip as number);
    const p = this.main;
    const vx = p.vx;
    const vy = p.vy;
    h.dropItem(this);
    this.setVelocity(vx + dir * THROW.vx, vy + THROW.vy, -dir * THROW.spin);
    this.thrown = true;
    this.game.sound.swish(7, p.x);
  }

  onImpact(info: ImpactInfo): void {
    // (a knock from something very light, a spent case, doesn't do it; the thrower's
    // own hand can't knock it, out of reach of it for a moment as it's let go)
    const hard = this.thrown ? THROWN_SMASH : SMASH_SPEED;
    this.thrown = false;
    if (info.speed >= hard && info.otherMass > 0.3) this.shatter(info.point, info.normal);
    else super.onImpact(info);
  }

  onBullet(hit: BulletHit): void {
    this.shatter(hit.point, { x: -hit.dir.x, y: -hit.dir.y });
  }

  /**
   * Smashes it: glass flies, the drug splashes out in a burst of drops of its
   * colour, along `dir` (off what it hit) and all round, and everyone it reaches
   * gets their share of it (see splash()). It spreads from the bottle's middle,
   * not from where it struck (at its edge).
   */
  shatter(_point?: V2, dir?: V2): void {
    if (this.broken || this.destroyed) return;
    this.broken = true;
    this.shattered = true;
    const p = this.main;
    const g = this.game;
    const c = { x: p.x, y: p.y };
    const d = dir && Math.hypot(dir.x, dir.y) > 1e-6 ? dir : { x: 0, y: 1 };
    const drug = this.drug === 'pink' ? PINK_DRUGS[Math.floor(Math.random() * PINK_DRUGS.length)] : this.drug;
    this.drops(c, d);
    for (let i = 0; i < 16; i++) {
      const ix = Math.floor(Math.random() * p.w);
      const iy = Math.floor(Math.random() * p.h);
      if (!p.solidAt(ix, iy)) continue;
      const w = p.pixelToWorld(ix, iy);
      g.particles.debris(w.x, w.y, d.x + (Math.random() - 0.5) * 2, d.y + 0.5, 1, p.mat.debrisColor, 3);
    }
    g.sound.play('impact/bottle_smash', { gain: 0.75, x: c.x, rate: 1.25, vary: 0.08 });
    g.sound.play('liquid/splash', { gain: 0.5, x: c.x, rate: 1.1 });
    this.splash(c, drug);
    g.remove(this);
  }

  /** The drops of its drug flying out from where it broke, most of them off what it hit, and a mist of it hanging there a moment. */
  private drops(c: V2, d: V2): void {
    const g = this.game;
    const ramp = DRUG_RAMPS[this.drug];
    const out = Math.atan2(d.y, d.x);
    for (let k = 0; k < SPLASH.drops; k++) {
      // (two in three in a wide fan off what it hit, the rest all round)
      const a = k % 3 ? out + (Math.random() * 2 - 1) * 1.2 : Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 3;
      g.particles.emit(PK.Debris, c.x + (Math.random() - 0.5) * PX * 3, c.y + (Math.random() - 0.5) * PX * 3, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + 0.6, life: 0.6 + Math.random() * 0.8,
        size: PX * (Math.random() < 0.3 ? 2 : 1), color: ramp[1 + Math.floor(Math.random() * 3)],
        alpha: 1, alpha1: 0, gravity: 1, drag: 0.5,
      });
    }
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.6;
      const size = PX * (3 + Math.random() * 3);
      g.particles.emit(PK.Smoke, c.x, c.y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 + 0.2, life: 0.45 + Math.random() * 0.4,
        size, size1: size * 2.2, color: ramp[3], color1: ramp[2], alpha: 0.4, alpha1: 0, gravity: -0.05, drag: 3,
      });
    }
  }

  /**
   * Everyone (people and animals) the splash reaches gets the drug: a whole dose
   * within SPLASH.full of the nearest of their limbs still on them, less and less
   * further out, none past SPLASH.radius, nor if there's a wall (or anything big
   * and heavy) between (see reaches()).
   */
  private splash(c: V2, drug: Drug): void {
    const g = this.game;
    const color = DRUG_GLOW[drug];
    for (const e of g.entities) {
      const who = asPatient(e);
      if (!who || e.destroyed) continue;
      const near = nearestLimb(who, c);
      if (!near || near.d > SPLASH.radius) continue;
      const k = near.d <= SPLASH.full ? 1 : 1 - (near.d - SPLASH.full) / (SPLASH.radius - SPLASH.full);
      if (k < SPLASH.least || (near.d > SPLASH.full && !this.reaches(c, near.part))) continue;
      who.inject(drug, k);
      glowOver(g, who, color, Math.round(3 + k * 8));
      sparkle(g, near.part.x, near.part.y, color, Math.round(2 + k * 6), PX * 4);
    }
  }

  /** Nothing in the way from the splash's middle to this part: the floor, a wall, or anything big and heavy (people and animals don't shield each other). */
  private reaches(c: V2, part: Part): boolean {
    const dx = part.x - c.x;
    const dy = part.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return true;
    const ray = (this.ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    ray.origin = { x: c.x, y: c.y };
    ray.dir = { x: dx / len, y: dy / len };
    const phys = this.game.physics;
    const hit = phys.world.castRay(ray, len, true, undefined, undefined, undefined, undefined, (col) => {
      const p = phys.partOf(col);
      // (the floor and walls have no part: they shield)
      if (!p) return true;
      if (p.entity === this || p.destroyed || asPatient(p.entity)) return false;
      return p.frozen || p.mass > SHIELDS;
    });
    return !hit;
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.holder) {
      acts.push({ label: 'Throw', hint: 'F', action: () => this.activate() });
      acts.push({ label: 'Smash', danger: true, action: () => this.shatter() });
      acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    } else acts.push({ label: 'Smash', hint: 'F', danger: true, action: () => this.activate() });
    return acts;
  }
}

/** The limb of someone still on them (not cut off) nearest a point, and how far it is from it (m, to its outline's box). */
function nearestLimb(who: Patient, c: V2): { part: Part; d: number } | null {
  let best: Part | null = null;
  let bd = Infinity;
  for (const l of who.limbs.values()) {
    const p = l.part;
    if (l.gone || p.destroyed || p.detached) continue;
    const q = p.worldToLocal(c.x, c.y);
    const d = Math.hypot(Math.max(0, Math.abs(q.x) - (p.w * PX) / 2), Math.max(0, Math.abs(q.y) - (p.h * PX) / 2));
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best ? { part: best, d: bd } : null;
}

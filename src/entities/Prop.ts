import { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions, ImpactInfo, DamageKind, BulletHit } from '../world/types';
import { GLASS, type PhysMaterial } from '../world/Materials';
import { LOAD_MIN } from '../systems/Impacts';
import type { PixelArt } from '../art/PixelArt';
import type { V2 } from '../engine/math';

export interface PropConfig {
  art: () => PixelArt;
  material: PhysMaterial;
  shapes?: ShapeSpec[];
  density?: number;
  friction?: number;
  restitution?: number;
  ccd?: boolean;
  angularDamping?: number;
  linearDamping?: number;
  /** Hit points; props with finite HP shatter into debris when destroyed. */
  hp?: number;
  /** Hit points per kg instead: then knocks break it alike whatever its size (see onImpact()). */
  hpPerKg?: number;
  /** Its sprite is its own, not shared with the rest of its kind (a resized or drawn one). */
  ownTexture?: boolean;
}

/** Wooden things' hit points per kg: about three hard slams into the floor (10 m/s), or more long falls. */
export const WOOD_HP = 8;

/**
 * What a breakable thing bears pressed on by a weight (see onLoad()): newtons per hit
 * point (a glass tank, half a tonne), and past that, hit points a second per newton
 * over (a tonne on a glass tank breaks it in about half a second).
 */
const BEARS_PER_HP = 150;
const CRUSHING = 0.01;

/** A single rigid object: crates, boxes, planks, furniture... */
export class Prop extends Entity {
  readonly main: Part;
  protected cfg: PropConfig;
  /** Broken already: it's only taken away at the end of the step, and more hits may land meanwhile (a shotgun's pellets). */
  protected shattered = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.cfg = cfg;
    this.main = this.addPart({
      name: def.name,
      art: cfg.art(),
      material: cfg.material,
      x,
      y,
      angle: opts.angle ?? 0,
      shapes: cfg.shapes,
      density: cfg.density,
      friction: cfg.friction,
      restitution: cfg.restitution,
      ccd: cfg.ccd,
      angularDamping: cfg.angularDamping,
      linearDamping: cfg.linearDamping,
      textureKey: cfg.ownTexture ? undefined : def.id,
      maxHp: cfg.hp ?? Infinity,
    });
    if (cfg.hpPerKg) this.main.maxHp = this.main.hp = cfg.hpPerKg * this.main.mass;
  }

  /** Can be broken (shatters when its hit points run out). */
  get breakable(): boolean {
    return Number.isFinite(this.main.maxHp);
  }

  onImpact(info: ImpactInfo): void {
    if (!this.breakable) return;
    if (this.cfg.hpPerKg) {
      // sturdy things (wood): the harm grows with the knock's speed, not its square, so
      // a whip into the floor (25+ m/s) takes a third of it and drops and bumps little
      const mass = this.main.mass;
      const share = Math.min(1, info.otherMass / mass);
      const harm = share * mass * 0.14 * Math.max(0, info.speed - 6);
      if (harm > 0.5) this.damage(info.part, harm, 'blunt', info.point, info.normal);
      return;
    }
    const m = Math.min(info.otherMass, 400);
    let e = 0.5 * Math.min(m, this.main.mass * 6) * Math.max(0, info.speed - 4) ** 2;
    // glass is brittle: a heavy thing coming down on it shatters it, however light the glass
    // (it can't get out of the way: its own fall onto the floor counts only as above)
    if (this.main.mat === GLASS) e = Math.max(e, 0.5 * Math.min(info.otherMass, 2000) * Math.max(0, info.otherSpeed - 4) ** 2);
    if (e > 30) this.damage(info.part, e / 40, 'blunt', info.point, info.normal);
  }

  /** Pressed on by a weight past what it bears (a tonne set down on a glass tank): crushed till it breaks. */
  onLoad(part: Part, _other: Part, force: number, point: V2, normal: V2): void {
    if (!this.breakable) return;
    const bears = Math.max(LOAD_MIN, this.main.maxHp * BEARS_PER_HP);
    if (force > bears) this.damage(part, (force - bears) * CRUSHING * this.game.stepDt, 'crush', point, normal);
  }

  onBullet(hit: BulletHit): void {
    // glass shatters at a bullet, whatever gun it came from (a share of a pistol's damage left a pane standing)
    if (this.breakable && hit.part.mat === GLASS) {
      this.shatter(hit.point);
      return;
    }
    // same share of the bullet's damage as the default, but breakable props now break
    this.damage(hit.part, hit.damage * 0.2, 'bullet', hit.point, hit.dir);
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, _dir?: V2): void {
    if (!this.breakable) return;
    part.hp -= amount * (kind === 'fire' ? 0.3 : 1);
    if (part.hp <= 0 && !this.destroyed) this.shatter(point);
  }

  /** Breaks into debris particles and disappears. */
  shatter(_point?: V2): void {
    if (this.shattered) return;
    this.shattered = true;
    const p = this.main;
    const g = this.game;
    const n = Math.min(60, Math.round((p.w * p.h) / 10));
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(Math.random() * p.w);
      const iy = Math.floor(Math.random() * p.h);
      if (!p.solidAt(ix, iy)) continue;
      const w = p.pixelToWorld(ix, iy);
      g.particles.debris(w.x, w.y, (Math.random() - 0.5) * 2, 1, 1, p.mat.debrisColor, 3);
    }
    if (p.mat.sound === 'glass') g.sound.play('impact/glass_break', { gain: 0.9, x: p.x });
    else g.sound.impact(p.mat.sound, 1, p.x);
    g.remove(this);
  }
}

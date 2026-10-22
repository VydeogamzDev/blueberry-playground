import { Entity } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions, ImpactInfo, DamageKind, BulletHit } from '../world/types';
import type { PhysMaterial } from '../world/Materials';
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
}

/** A single rigid object: crates, boxes, planks, furniture... */
export class Prop extends Entity {
  readonly main: Part;
  protected cfg: PropConfig;

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
      textureKey: def.id,
      maxHp: cfg.hp ?? Infinity,
    });
  }

  onImpact(info: ImpactInfo): void {
    if (this.cfg.hp === undefined) return;
    const m = Math.min(info.otherMass, 400);
    const e = 0.5 * Math.min(m, this.main.mass * 6) * Math.max(0, info.speed - 4) ** 2;
    if (e > 30) this.damage(info.part, e / 40, 'blunt', info.point, info.normal);
  }

  onBullet(hit: BulletHit): void {
    // same share of the bullet's damage as the default, but breakable props now break
    this.damage(hit.part, hit.damage * 0.2, 'bullet', hit.point, hit.dir);
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, _dir?: V2): void {
    if (this.cfg.hp === undefined) return;
    part.hp -= amount * (kind === 'fire' ? 0.3 : 1);
    if (part.hp <= 0 && !this.destroyed) this.shatter(point);
  }

  /** Breaks into debris particles and disappears. */
  shatter(_point?: V2): void {
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

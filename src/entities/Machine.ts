import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import { BROKEN, Entity, WORN } from '../world/Entity';
import { hardness, softness } from '../world/Materials';
import type { Part } from '../world/Part';
import type { BulletHit, DamageKind, ImpactInfo } from '../world/types';
import { BLAST_K, FORCE, HP_PER_MPA, blastShare } from './Prop';

/**
 * A machine of several parts on joints of its own: a motor's housing and rotor, a
 * piston's barrel and rod, a servo, a turret on its stand. Each part is as strong as
 * its material is for its size, as a Prop is (see sturdy()). Hurt, it wears (see
 * Entity.works: past WORN it cuts in and out, past BROKEN it's dead). Once a part is
 * spent, the whole of it comes apart into pieces (see breakUp()). Before, these had
 * no hit points that did anything: a nuke left a motor running.
 */
export class Machine extends Entity {
  /** Come apart (see breakUp()). */
  private broke = false;

  /** Sets each part's hit points from its material and its size (call once its parts are made). */
  protected sturdy(): void {
    for (const p of this.parts) p.maxHp = p.hp = Math.max(4, p.mat.strength * p.solidPx() * PX * PX * HP_PER_MPA);
  }

  /** As sound as its most hurt part. */
  get condition(): number {
    let c = 1;
    for (const p of this.parts) if (!p.destroyed && p.maxHp > 0) c = Math.min(c, Math.max(0, p.hp) / p.maxHp);
    return c;
  }

  onBullet(hit: BulletHit): void {
    // (the share of a round's harm a Prop takes: see Prop.onBullet())
    this.damage(hit.part, hit.damage * 0.2, 'bullet', hit.point, hit.dir);
  }

  /** A knock, as a Prop of its material takes one (see Prop.onImpact()). */
  onImpact(info: ImpactInfo): void {
    const p = info.part;
    const mat = p.mat;
    const v0 = mat.toughness * 0.5;
    if (info.speed <= v0 || p.destroyed) return;
    const share = Math.min(1, info.otherMass / Math.max(0.05, p.mass)) * (info.other ? hardness(info.other.mat) : 1);
    const k = ((info.speed - v0) / (mat.toughness - v0)) ** 2 * share;
    if (k >= 0.004) this.damage(p, p.maxHp * k, 'blunt', info.point, info.normal);
  }

  /** Hot past a part's melting point: it runs away (see Prop.onTemp()), and the machine with it. */
  onTemp(p: Part, temp: number, t: number): void {
    const melt = p.mat.melt;
    if (!(temp >= melt) || p.destroyed || this.broke) return;
    p.hp -= p.maxHp * t * Math.min(1, 0.15 + (temp - melt) / melt);
    if (p.hp <= 0) this.breakUp(p, 0.15);
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    if (this.broke || part.destroyed) return;
    const before = part.hp;
    const worked = this.works;
    amount *= softness(part.mat, part.temp) * (kind === 'explosion' ? BLAST_K * blastShare(part) : 1) * (kind === 'fire' ? 0.3 : 1);
    part.hp -= amount;
    // knocked out of order: sparks (and smoke, once dead), and the power it made or passed on is gone
    const c = this.condition;
    if (part.hp > 0) {
      if (c < WORN && before / part.maxHp >= WORN) this.game.particles.sparks(part.x, part.y, 0, 1, 6, 3);
      if (worked && c < BROKEN) {
        this.game.particles.sparks(part.x, part.y, 0, 1, 10, 4);
        this.game.particles.smoke(part.x, part.y, 1, 0.25, true);
        this.game.connections.recomputePower();
      }
      return;
    }
    // (overkill breaks it finer: a nuke's shock, not a last pistol round)
    const over = Math.min(2, (amount - Math.max(0, before)) / Math.max(1, part.maxHp));
    this.breakUp(part, (FORCE[kind] ?? 0.5) * (1 + over), point, dir);
  }

  /**
   * Comes apart: the part that gave way in pieces, the rest of it whole (a motor's
   * rotor flies off its smashed housing), one break they all share (see
   * systems/Structure), and it's taken away.
   */
  breakUp(spent: Part, force: number, at?: V2, dir?: V2): void {
    if (this.broke || this.destroyed) return;
    this.broke = true;
    const g = this.game;
    const from = g.structure.newBreak();
    const pieces = [];
    for (const p of this.parts) {
      if (p.destroyed) continue;
      if (p === spent) pieces.push(...g.structure.fracture(p, { at, dir, force, from }));
      else pieces.push(g.structure.whole(p, { at, dir, force, from }));
    }
    g.structure.keep(this, pieces);
    g.sound.impact(spent.mat.sound, 1, spent.x);
    g.remove(this);
  }
}

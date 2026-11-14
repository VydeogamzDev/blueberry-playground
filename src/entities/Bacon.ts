import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { rotate } from '../engine/math';
import { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import { MAT, type PhysMaterial } from '../world/Materials';
import type { ItemDef, SpawnOptions } from '../world/types';
import { baconLinkArt, BACON_LINKS, BACON_LINK_W } from '../art/bacon';
import type { V2 } from '../engine/math';
import type { DamageKind } from '../world/types';
import { BLAST_K, HP_PER_MPA, blastShare } from './Prop';

/** Cooked meat: burns like meat, but doesn't bleed. */
export const BACON: PhysMaterial = { ...MAT.flesh, name: 'Bacon', bleeds: false, debrisColor: 0x9a4a2c };

/**
 * A strip of bacon: a few short links on loose, springy joints, so it flops
 * over whatever it lands on and wobbles when knocked. A pig caught full in a
 * big blast turns into a handful of these (see Creature.cook()).
 */
export class Bacon extends Entity {
  constructor(game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    const f = this.flipped ? -1 : 1;
    const ang = opts.angle ?? 0;
    const half = (BACON_LINK_W / 2) * PX;
    let prev: Part | null = null;
    for (let i = 0; i < BACON_LINKS; i++) {
      // (flipped, the links run the other way, so the strip is mirrored as a whole)
      const off = rotate((i - (BACON_LINKS - 1) / 2) * BACON_LINK_W * PX * f, 0, ang);
      const p = this.addPart({
        name: def.name,
        art: baconLinkArt(i),
        material: BACON,
        x: x + off.x,
        y: y + off.y,
        angle: ang,
        shapes: [{ kind: 'box', w: BACON_LINK_W, h: 3, r: 0.5 }],
        density: 8,
        ccd: true,
        angularDamping: 1.5,
        linearDamping: 0.1,
        textureKey: `bacon:${i}`,
      });
      // (as strong as meat is, for its size: a round or a blast near it tears a link off)
      p.maxHp = p.hp = Math.max(4, BACON.strength * p.solidPx() * PX * PX * HP_PER_MPA);
      // light links get extra inertia so they don't buzz when squeezed under something (as animals' paws do)
      p.body.setAdditionalMassProperties(0, { x: 0, y: 0 }, p.body.principalInertia() * 2, true);
      if (prev) {
        const j = this.addJoint(RAPIER.JointData.revolute({ x: half * f, y: 0 }, { x: -half * f, y: 0 }), prev, p) as RAPIER.RevoluteImpulseJoint;
        j.setLimits(-0.9, 0.9);
        j.configureMotorModel(RAPIER.MotorModel.ForceBased);
        // a weak spring back to straight: it sags and wobbles, but doesn't hang like a chain
        j.configureMotorPosition(0, 0.1, 0.002);
      }
      prev = p;
    }
  }

  /**
   * A link torn to bits by a round, a blade or a blast (or burnt away), as meat is:
   * before, bacon had no hit points that did anything, and a nuke going off on it left
   * it whole.
   */
  damage(part: Part, amount: number, kind: DamageKind, _point?: V2, _dir?: V2): void {
    if (part.destroyed || this.destroyed) return;
    part.hp -= amount * (kind === 'explosion' ? BLAST_K * blastShare(part) : kind === 'fire' ? 0.3 : 1);
    if (part.hp > 0) return;
    const g = this.game;
    for (let i = 0; i < 8; i++) {
      const w = part.pixelToWorld(Math.random() * part.w, Math.random() * part.h);
      g.particles.debris(w.x, w.y, (Math.random() - 0.5) * 2, 1, 1, BACON.debrisColor, 3);
    }
    g.sound.squish(0.4, part.x, 0.6);
    this.removePart(part);
  }
}

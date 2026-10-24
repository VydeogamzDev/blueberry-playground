import { RAPIER } from '../engine/Physics';
import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { rotate, type V2 } from '../engine/math';
import type { Part } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

export interface BladeSpec {
  /** Blade extent along x in art px [from, to]; the tip is at `to`. */
  blade: [number, number];
  /** Pixels back from the tip that count as the point. */
  tipLen: number;
  /** Sharp edge side: bottom/top of the sprite, both, or none (stab only). */
  edge: 'bottom' | 'top' | 'both' | 'none';
  /** Cut damage scale. */
  sharpness: number;
  /** Can stab and lodge. */
  stab: boolean;
  /** Maximum penetration depth (m). */
  maxDepth: number;
  /** Friction force holding a lodged blade (N). */
  grip: number;
  /** Point speed needed to stab in (m/s); needles go in easily. */
  stabSpeed?: number;
  /** Stab damage scale (needles barely hurt). */
  stabDamage?: number;
}

/** Materials a blade can sink into. */
const SOFT = new Set(['Flesh', 'Wood', 'Plastic', 'Rubber', 'Synthetic']);

const STAB_SPEED = 3.2;
const CUT_SPEED = 3.5;

interface Lodge {
  target: Part;
  slider: RAPIER.RigidBody;
  prism: RAPIER.ImpulseJoint;
  weld: RAPIER.ImpulseJoint;
  /** Depth at the moment of lodging (m). */
  depth0: number;
  axisLocal: V2;
  entryLocal: V2;
  t: number;
}

/**
 * A sharp weapon: slashing edges cut (and can sever limbs), points stab and lodge
 * into soft materials. A lodged blade slides along its axis against friction and
 * can be pulled back out.
 */
export class Blade extends Item {
  readonly blade: BladeSpec;
  lodge: Lodge | null = null;
  private unstickT = 0;
  private released: Part | null = null;
  private cutCooldown = new Map<Part, number>();

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blade: BladeSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, ccd: true }, hold, x, y, opts);
    this.blade = blade;
  }

  /** Dragging a lodged blade pulls on whatever it is stuck in. */
  dragMass(): number {
    const m = super.dragMass();
    return this.lodge ? m + Math.min(80, this.lodge.target.entity.totalMass()) : m;
  }

  onImpact(info: ImpactInfo): void {
    const o = info.other;
    const p = this.main;
    if (!o || o.destroyed || this.destroyed) return;
    if (this.lodge || (this.released === o && this.unstickT > 0)) return;
    if (this.holder && o.entity === this.holder) return;
    const pt = info.point;
    const { ix } = p.worldToPixel(pt.x, pt.y);
    const [b0, b1] = this.blade.blade;
    if (ix < b0 - 1) return; // hit with the handle
    const va = velAt(p, pt);
    const vb = velAt(o, pt);
    const rx = va.x - vb.x;
    const ry = va.y - vb.y;
    const speed = Math.hypot(rx, ry);
    const fwd = this.forward();
    const along = rx * fwd.x + ry * fwd.y;
    const soft = SOFT.has(o.mat.name);

    // ---- stab with the point
    const stabSpeed = this.blade.stabSpeed ?? STAB_SPEED;
    if (this.blade.stab && ix >= b1 - this.blade.tipLen && along > stabSpeed && along > speed * 0.72) {
      const massF = Math.sqrt(Math.min(4, this.totalMass() + (this.holder ? 2 : 0)) / 0.5);
      const dmg = (along - stabSpeed * 0.6) * 5.5 * massF * (this.blade.stabDamage ?? 1);
      o.entity.damage(o, dmg, 'stab', pt, fwd);
      if (soft) {
        this.game.sound.stab(pt.x);
        this.game.sound.squish(Math.min(1, along / 10) * 0.6, pt.x);
        const depth = Math.min(this.blade.maxDepth * 0.5, 0.02 + along * 0.006);
        this.stick(o, pt, depth);
      } else {
        this.game.sound.impact('metal', Math.min(1, along / 10), pt.x);
      }
      return;
    }

    // ---- slash with the edge
    if (this.blade.edge === 'none' || ix > b1 + 1 || speed < CUT_SPEED) return;
    const cd = this.cutCooldown.get(o) ?? 0;
    if (cd > this.game.time) return;
    // normal from the blade into the target, measured against the blade's "up"
    const up = { x: -fwd.y * p.flip, y: fwd.x * p.flip };
    const side = -(info.normal.x * up.x + info.normal.y * up.y);
    const e = this.blade.edge;
    const edgeOk = e === 'both' ? Math.abs(side) > 0.35 : e === 'bottom' ? side < -0.35 : side > 0.35;
    if (!edgeOk) return;
    const perp = Math.abs(rx * up.x + ry * up.y);
    if (perp < CUT_SPEED * 0.8) return;
    const massF = Math.sqrt(Math.min(6, this.totalMass() + (this.holder ? 3 : 0)) / 1);
    const dmg = (perp - CUT_SPEED * 0.6) * 3.2 * this.blade.sharpness * massF;
    this.cutCooldown.set(o, this.game.time + 0.12);
    const dir = { x: rx / speed, y: ry / speed };
    o.entity.damage(o, dmg, 'cut', pt, dir);
    if (soft) this.game.sound.slash(pt.x);
  }

  /** Lodges the blade into a part at a world point. */
  protected stick(target: Part, pt: V2, depth: number): void {
    const world = this.game.physics.world;
    const p = this.main;
    const fwd = this.forward();
    const tr = target.body.rotation();
    const axisLocal = rotate(fwd.x, fwd.y, -tr);
    const entryLocal = target.worldToLocal(pt.x, pt.y);
    // An intermediate slider body carries the prismatic constraint (which keeps
    // its bodies aligned) while a fixed joint holds the blade at its own angle.
    const slider = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pt.x, pt.y)
        .setRotation(tr)
        .setAdditionalMassProperties(0.08, { x: 0, y: 0 }, 0.0005)
        .setLinvel(target.vx, target.vy),
    );
    const prismData = RAPIER.JointData.prismatic(entryLocal, { x: 0, y: 0 }, axisLocal);
    prismData.limitsEnabled = true;
    prismData.limits = [-0.6, Math.max(0.01, this.blade.maxDepth - depth)];
    const prism = world.createImpulseJoint(prismData, target.body, slider, true);
    prism.setContactsEnabled(false);
    const unit = prism as RAPIER.PrismaticImpulseJoint;
    unit.configureMotorModel(RAPIER.MotorModel.ForceBased);
    unit.configureMotorVelocity(0, 2000);
    unit.setMotorMaxForce(this.blade.grip);
    const bladeLocal = p.worldToLocal(pt.x, pt.y);
    const weld = world.createImpulseJoint(
      RAPIER.JointData.fixed({ x: 0, y: 0 }, 0, bladeLocal, tr - p.body.rotation()),
      slider, p.body, true,
    );
    weld.setContactsEnabled(false);
    (p.noCollide ??= new Set()).add(target);
    (target.noCollide ??= new Set()).add(p);
    this.lodge = { target, slider, prism, weld, depth0: depth, axisLocal, entryLocal, t: 0 };
  }

  unstick(): void {
    const l = this.lodge;
    if (!l) return;
    this.lodge = null;
    const world = this.game.physics.world;
    if (l.slider.isValid()) world.removeRigidBody(l.slider);
    this.released = l.target;
    this.unstickT = 0.4;
  }

  postStep(dt: number): void {
    const l = this.lodge;
    if (!l) this.swing(dt);
    if (l) {
      if (l.target.destroyed || !l.prism.isValid() || !l.weld.isValid()) {
        this.unstick();
        return;
      }
      // how far the slider has moved along the axis from the entry point
      const s = l.slider.translation();
      const e = l.target.localToWorld(l.entryLocal.x, l.entryLocal.y);
      const ax = rotate(l.axisLocal.x, l.axisLocal.y, l.target.body.rotation());
      l.t = (s.x - e.x) * ax.x + (s.y - e.y) * ax.y;
      if (l.depth0 + l.t < 0.004) {
        // pulled out
        const fwd = this.forward();
        if (l.target.mat.bleeds) this.game.particles.blood(e.x, e.y, -fwd.x, -fwd.y, 8, 2.5, l.target.body);
        this.game.sound.squish(0.4, e.x);
        this.unstick();
      }
      return;
    }
    // re-enable contacts with the last target once they no longer overlap
    if (this.released) {
      this.unstickT -= dt;
      if (this.unstickT <= 0 && (this.released.destroyed || !this.game.physics.overlaps(this.main, this.released))) {
        this.main.noCollide?.delete(this.released);
        this.released.noCollide?.delete(this.main);
        this.released = null;
      } else if (this.unstickT <= 0) this.unstickT = 0.1;
    }
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const l = this.lodge;
    if (!l) return undefined;
    const ti = ref(l.target.entity);
    if (ti < 0) return undefined;
    // where the blade currently enters the target, in the target's frame
    const s = l.slider.translation();
    return { lodge: { target: [ti, l.target.entity.parts.indexOf(l.target)], at: l.target.worldToLocal(s.x, s.y), depth: l.depth0 + l.t } };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const d = links.lodge as { target: [number, number]; at: V2; depth: number } | undefined;
    if (!d) return;
    const target = get(d.target[0])?.parts[d.target[1]];
    if (!target || target.destroyed) return;
    this.stick(target, target.localToWorld(d.at.x, d.at.y), Math.max(0.005, d.depth));
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.lodge) acts.push({ label: 'Pull out', action: () => this.unstick() });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected onDestroy(): void {
    this.unstick();
    super.onDestroy();
  }
}

function velAt(p: Part, x: V2 | number, y?: number): V2 {
  const px = typeof x === 'number' ? x : x.x;
  const py = typeof x === 'number' ? y! : x.y;
  if (p.frozen) return { x: 0, y: 0 };
  return { x: p.vx - p.av * (py - p.y), y: p.vy + p.av * (px - p.x) };
}

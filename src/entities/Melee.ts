import { RAPIER } from '../engine/Physics';
import { Item, type HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { PX } from '../engine/constants';
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
  axisLocal: V2;
  /** Where it went in (the target's frame). */
  entryLocal: V2;
  /** How deep the point is (m), and how deep it has to go to come out of the far side. */
  t: number;
  through: number;
  /** Its point has come out of the far side. */
  out: boolean;
}

/** The most bodies one blade runs through at once. */
const SKEWER = 3;
/** How far back past where it went in (m) a lodged point must be drawn before it's out: jostled, a shallow one doesn't slip out. */
const PULL_OUT = 0.015;
/** Point speed (m/s) a blade already in someone needs to go on into the next thing (it's pushed through, not stabbed). */
const PUSH_IN = 1.2;
/** A slash's harm per pixel it cuts into a limb (see Chunks.sliceLimb()). */
export const CUT_PER_PX = 12;
/** A stab's point goes as deep as this much of its energy (J) over its grip takes it, besides the first 2 cm. */
const STAB_IN = 0.5;

/** What a blade can cut into: a person, an animal (see Human.slice()). */
export interface Sliceable {
  slice(part: Part, amount: number, point: V2, dir: V2, depth: number, back?: number): void;
}

/**
 * A sharp weapon: slashing edges cut into limbs (and through them: see
 * Chunks.sliceLimb()), points stab and lodge into soft materials. A lodged blade
 * slides along its axis against friction: pulled back out, or pushed on in up to
 * its hilt, out of the far side and on into whatever is behind (see SKEWER).
 */
export class Blade extends Item {
  readonly blade: BladeSpec;
  /** What it's stuck in, the first first. */
  lodges: Lodge[] = [];
  /** Parts it runs through that don't hold it: the rest of each body it's in (see enter()). */
  private passing = new Set<Part>();
  /** Parts it has just come out of, and how long (s) until it can touch them again. */
  private released = new Map<Part, number>();
  private cutCooldown = new Map<Part, number>();

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blade: BladeSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, ccd: true }, hold, x, y, opts);
    this.blade = blade;
  }

  /** What it went into first (null: it's in nothing). */
  get lodge(): Lodge | null {
    return this.lodges[0] ?? null;
  }

  /** Dragging a lodged blade pulls on whatever it is stuck in. */
  dragMass(): number {
    let m = super.dragMass();
    for (const l of this.lodges) m += Math.min(80, l.target.entity.totalMass());
    return m;
  }

  onImpact(info: ImpactInfo): void {
    const o = info.other;
    const p = this.main;
    if (!o || o.destroyed || this.destroyed) return;
    if (this.released.has(o) || this.passing.has(o) || this.lodges.some((l) => l.target === o)) return;
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
    const lodged = this.lodges.length > 0;

    // ---- stab with the point (or, already in something, pushed on into what's behind it)
    const stabSpeed = lodged ? PUSH_IN : (this.blade.stabSpeed ?? STAB_SPEED);
    if (this.blade.stab && ix >= b1 - this.blade.tipLen && along > stabSpeed && along > speed * 0.72) {
      if (lodged && !soft) return;
      const m = this.totalMass() + (this.holder ? 2 : 0);
      const massF = Math.sqrt(Math.min(4, m) / 0.5);
      const dmg = (along - stabSpeed * 0.6) * 5.5 * massF * (this.blade.stabDamage ?? 1);
      if (!soft) {
        o.entity.damage(o, dmg, 'stab', pt, fwd);
        this.game.sound.impact('metal', Math.min(1, along / 10), pt.x);
        return;
      }
      this.game.sound.stab(pt.x);
      this.game.sound.squish(Math.min(1, along / 10) * 0.6, pt.x);
      if (lodged) {
        this.enter([{ q: o, d: 0 }], pt, 0.005, dmg);
        return;
      }
      // as deep as its weight and speed drive it against the grip (up to most of its length),
      // and through whatever it meets on the way (its joints draw it in that far: moved
      // there at once, it would leave the solver behind, and fly apart when grabbed)
      const depth = Math.min(this.blade.maxDepth * 0.9, 0.02 + (STAB_IN * 0.5 * Math.min(6, m) * along * along) / this.blade.grip);
      this.enter(this.ahead(o, pt, depth), pt, depth, dmg);
      return;
    }
    if (lodged) return;

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
    // it cuts in the way the edge goes (into the target, whatever face of it it struck)
    let cx = rx / speed - info.normal.x * 0.4;
    let cy = ry / speed - info.normal.y * 0.4;
    const inward = -(cx * info.normal.x + cy * info.normal.y) / (Math.hypot(cx, cy) || 1);
    if (inward < 0.3) {
      cx -= info.normal.x * (0.3 - inward) * 2;
      cy -= info.normal.y * (0.3 - inward) * 2;
    }
    const cl = Math.hypot(cx, cy) || 1;
    const dir = { x: cx / cl, y: cy / cl };
    const into = o.entity as Entity & Partial<Sliceable>;
    if (soft && into.slice) into.slice(o, dmg, pt, dir, dmg / CUT_PER_PX);
    else o.entity.damage(o, dmg, 'cut', pt, dir);
    if (soft) this.game.sound.slash(pt.x);
  }

  /**
   * Lodges the blade into a part where it went in (`pt`, world), its point `depth` m
   * in (it's there: `driven` in just now, it comes out of the far side, if it's as
   * deep as that, next step: see postStep()).
   */
  protected stick(target: Part, pt: V2, depth: number, driven = false): void {
    const world = this.game.physics.world;
    const p = this.main;
    const fwd = this.forward();
    (p.noCollide ??= new Set()).add(target);
    (target.noCollide ??= new Set()).add(p);
    const tip = { x: pt.x + fwd.x * depth, y: pt.y + fwd.y * depth };
    const tr = target.body.rotation();
    const axisLocal = rotate(fwd.x, fwd.y, -tr);
    const entryLocal = target.worldToLocal(pt.x, pt.y);
    // An intermediate slider body (at the point) carries the prismatic constraint (which
    // keeps its bodies aligned) while a fixed joint holds the blade at its own angle.
    const slider = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(tip.x, tip.y)
        .setRotation(tr)
        .setAdditionalMassProperties(0.08, { x: 0, y: 0 }, 0.0005)
        .setLinvel(target.vx, target.vy),
    );
    // (in from where it went in, up to the hilt)
    const prismData = RAPIER.JointData.prismatic(entryLocal, { x: 0, y: 0 }, axisLocal);
    prismData.limitsEnabled = true;
    prismData.limits = [-0.6, Math.max(depth + 0.01, this.blade.maxDepth)];
    const prism = world.createImpulseJoint(prismData, target.body, slider, true);
    prism.setContactsEnabled(false);
    const unit = prism as RAPIER.PrismaticImpulseJoint;
    unit.configureMotorModel(RAPIER.MotorModel.ForceBased);
    unit.configureMotorVelocity(0, 2000);
    unit.setMotorMaxForce(this.blade.grip);
    const bladeLocal = p.worldToLocal(tip.x, tip.y);
    const weld = world.createImpulseJoint(
      RAPIER.JointData.fixed({ x: 0, y: 0 }, 0, bladeLocal, tr - p.body.rotation()),
      slider, p.body, true,
    );
    weld.setContactsEnabled(false);
    const through = thickness(target, pt, fwd);
    this.lodges.push({ target, slider, prism, weld, axisLocal, entryLocal, t: depth, through, out: !driven && depth > through });
  }

  /** The soft things from `pt` (where it struck `first`) to `depth` m on along it, as far along as each starts, nearest first. */
  private ahead(first: Part, pt: V2, depth: number): { q: Part; d: number }[] {
    const phys = this.game.physics;
    const hits = [{ q: first, d: 0 }];
    phys.world.intersectionsWithRay(new RAPIER.Ray(pt, this.forward()), depth, true, (hit) => {
      const q = phys.partOf(hit.collider);
      if (q && !q.destroyed && q.entity !== this && q.entity !== this.holder && SOFT.has(q.mat.name) && !hits.some((h) => h.q === q)) {
        hits.push({ q, d: hit.timeOfImpact });
      }
      return true;
    });
    return hits.sort((a, b) => a.d - b.d);
  }

  /**
   * Its point run on from `pt` (world) to `depth` m along it, through `hits` (see
   * ahead()), each hurt by less of the stab's harm (`dmg`) the further on it is. It
   * holds by one part of each body, up to SKEWER bodies (the heaviest of the parts
   * of it it goes into at once: a chest, not the arm in front of it), and goes
   * through the rest of that body (see passing): held by two limbs of a body, it
   * would lock the joint between them.
   */
  private enter(hits: { q: Part; d: number }[], pt: V2, depth: number, dmg: number): void {
    const fwd = this.forward();
    for (const { q, d } of hits) {
      if (!q.destroyed) q.entity.damage(q, dmg * (1 - (0.5 * d) / Math.max(depth, 0.01)), 'stab', { x: pt.x + fwd.x * d, y: pt.y + fwd.y * d }, fwd);
    }
    for (const { q, d } of hits) {
      if (q.destroyed || this.destroyed) continue;
      const mine = hits.filter((h) => h.q.entity === q.entity && !h.q.destroyed);
      const best = mine.filter((h) => h.d <= mine[0].d + 0.02).reduce((a, b) => (b.q.mass > a.q.mass ? b : a));
      const held = this.lodges.some((l) => l.target.entity === q.entity);
      if (q === best.q && !held && this.lodges.length < SKEWER) this.stick(q, { x: pt.x + fwd.x * d, y: pt.y + fwd.y * d }, depth - d, true);
      else this.pass(q);
    }
  }

  /** Through `q` without being held by it (see enter()). */
  private pass(q: Part): void {
    this.passing.add(q);
    (this.main.noCollide ??= new Set()).add(q);
    (q.noCollide ??= new Set()).add(this.main);
  }

  /** Pulled out of everything it's in. */
  unstick(): void {
    while (this.lodges.length) this.free(this.lodges[0]);
  }

  /** Out of one thing. */
  private free(l: Lodge): void {
    const i = this.lodges.indexOf(l);
    if (i < 0) return;
    this.lodges.splice(i, 1);
    if (l.slider.isValid()) this.game.physics.world.removeRigidBody(l.slider);
    this.released.set(l.target, 0.4);
    // (and out of the rest of that body: of everything, once it's out of all it was held by)
    for (const q of this.passing) {
      if (q.entity !== l.target.entity && this.lodges.length) continue;
      this.passing.delete(q);
      this.released.set(q, 0.4);
    }
  }

  postStep(dt: number): void {
    if (!this.lodges.length) this.swing(dt);
    for (const l of [...this.lodges]) {
      if (l.target.destroyed || !l.prism.isValid() || !l.weld.isValid()) {
        this.free(l);
        continue;
      }
      // how deep the point is: from where it went in, along the way it went
      const s = l.slider.translation();
      const e = l.target.localToWorld(l.entryLocal.x, l.entryLocal.y);
      const ax = rotate(l.axisLocal.x, l.axisLocal.y, l.target.body.rotation());
      l.t = (s.x - e.x) * ax.x + (s.y - e.y) * ax.y;
      if (l.t < -PULL_OUT) {
        // pulled out
        if (l.target.mat.bleeds) this.game.particles.blood(e.x, e.y, -ax.x, -ax.y, 8, 2.5, l.target.body);
        this.game.sound.squish(0.4, e.x);
        this.free(l);
        continue;
      }
      if (!l.out && l.t > l.through) {
        // run through: the point comes out of the far side
        l.out = true;
        const x = { x: e.x + ax.x * l.through, y: e.y + ax.y * l.through };
        l.target.entity.damage(l.target, 6, 'stab', x, { x: -ax.x, y: -ax.y });
        if (l.target.mat.bleeds) this.game.particles.splatter(x.x, x.y, ax.x, ax.y, 10, 2.5, 0.35, l.target.body);
        this.game.sound.squish(0.5, x.x);
      }
    }
    for (const q of this.passing) if (q.destroyed) this.passing.delete(q);
    // contacts with what it came out of come back once they no longer overlap
    for (const [q, t] of this.released) {
      const left = t - dt;
      if (left > 0) this.released.set(q, left);
      else if (q.destroyed || !this.game.physics.overlaps(this.main, q)) {
        this.main.noCollide?.delete(q);
        q.noCollide?.delete(this.main);
        this.released.delete(q);
      } else this.released.set(q, 0.1);
    }
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const at = (q: Part): [number, number] | null => {
      const i = ref(q.entity);
      return i < 0 ? null : [i, q.entity.parts.indexOf(q)];
    };
    const lodges = [];
    for (const l of this.lodges) {
      const target = at(l.target);
      if (target) lodges.push({ target, at: l.entryLocal, depth: l.t });
    }
    if (!lodges.length) return undefined;
    const passing = [...this.passing].map(at).filter((q) => q);
    return passing.length ? { lodges, passing } : { lodges };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    type Saved = { target: [number, number]; at: V2; depth: number };
    const old = links.lodge as Saved | undefined;
    const fwd = this.forward();
    for (const d of (links.lodges as Saved[] | undefined) ?? (old ? [old] : [])) {
      const target = get(d.target[0])?.parts[d.target[1]];
      if (!target || target.destroyed) continue;
      const depth = Math.max(0.005, d.depth);
      const at = target.localToWorld(d.at.x, d.at.y);
      // (a save from before blades went through things has where the point was)
      this.stick(target, old ? { x: at.x - fwd.x * depth, y: at.y - fwd.y * depth } : at, depth);
    }
    for (const [e, i] of (links.passing as [number, number][] | undefined) ?? []) {
      const q = get(e)?.parts[i];
      if (q && !q.destroyed && this.lodges.length) this.pass(q);
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (this.lodges.length) acts.push({ label: 'Pull out', action: () => this.unstick() });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected onDestroy(): void {
    this.unstick();
    super.onDestroy();
  }
}

/** How far (m) from `pt` (where a blade goes into `q`), going `dir`, to the far side of it. */
function thickness(q: Part, pt: V2, dir: V2): number {
  const step = PX * 0.5;
  let last = 0;
  for (let s = 0; s < 3; s += step) {
    const c = q.worldToPixel(pt.x + dir.x * s, pt.y + dir.y * s);
    if (q.solidAt(c.ix, c.iy)) last = s;
    else if (s - last > PX * 1.5) break;
  }
  return last + step;
}

function velAt(p: Part, x: V2 | number, y?: number): V2 {
  const px = typeof x === 'number' ? x : x.x;
  const py = typeof x === 'number' ? y! : x.y;
  if (p.frozen) return { x: 0, y: 0 };
  return { x: p.vx - p.av * (py - p.y), y: p.vy + p.av * (px - p.x) };
}

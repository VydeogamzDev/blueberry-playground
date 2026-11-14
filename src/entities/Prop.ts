import { BROKEN, Entity, WORN } from '../world/Entity';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions, ImpactInfo, DamageKind, BulletHit } from '../world/types';
import { GLASS, hardness, softness, type PhysMaterial } from '../world/Materials';
import { LOAD_MIN } from '../systems/Impacts';
import type { PixelArt } from '../art/PixelArt';
import type { V2 } from '../engine/math';
import type { Debris } from './Debris';
import { PX } from '../engine/constants';

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
  /** Never breaks (left out: as strong as its material and size make it, see Prop). */
  unbreakable?: boolean;
  /** How deep it is into the picture (m), where that isn't its thickness in it (a board's width: see systems/Aero). */
  depth?: number;
  /** There's air in it (a barrel, a float): water holds it up by its looks (see PartSpec.hollow). */
  hollow?: boolean;
  /** Its sprite is its own, not shared with the rest of its kind (a resized or drawn one). */
  ownTexture?: boolean;
}

/** Wooden things' hit points per kg: about three hard slams into the floor (10 m/s), or more long falls. */
export const WOOD_HP = 8;

/**
 * Hit points for each MPa of its material's strength, per m² of it (see the
 * constructor): a steel box ~800, a pistol ~45 (seven rifle rounds), a brick ~18.
 */
export const HP_PER_MPA = 6;

/**
 * A blast's harm to things not alive, for each of a person's: its overpressure
 * bears on the whole of a box's side, a panel, a door (C4 against a steel box
 * tears it open; a grenade beside one dents it).
 */
export const BLAST_K = 2.5;

/**
 * (m²) A blast bears on a thing for its size (see blastShare()): one this big (a steel
 * box) takes the whole of BLAST_K.
 */
const BLAST_AREA = 0.45;

/**
 * Of a blast's harm (see BLAST_K), the share a part takes for its size: the pressure
 * bears on it in proportion to its size, as its hit points are (see HP_PER_MPA), so a
 * knife fares as a steel box does, shape for shape; a small thing is thrown by a blast
 * rather than torn by it. Before, a knife 4 m from C4 was blown to bits.
 */
export function blastShare(p: Part): number {
  return Math.min(1, (p.solidPx() * PX * PX) / BLAST_AREA);
}

/** How hard each kind of harm breaks a thing that gives way to it (see Break.force). */
export const FORCE: Partial<Record<DamageKind, number>> = { explosion: 1, bullet: 0.35, crush: 0.6, blunt: 0.5, cut: 0.3, stab: 0.3, fire: 0.15, laser: 0.3, acid: 0.15, shock: 0.2 };

/**
 * What a breakable thing bears pressed on by a weight (see onLoad()): newtons per hit
 * point (a glass tank, half a tonne), and past that, hit points a second per newton
 * over (a tonne on a glass tank breaks it in about half a second).
 */
const BEARS_PER_HP = 150;
const CRUSHING = 0.01;

/**
 * A single rigid object: crates, boxes, planks, furniture, and every machine,
 * gun and gadget made of one part. As strong as what it's made of, for its size
 * (unless its config says: a glass pane's hit points, wood's per kg, or never), it
 * breaks when they run out into pieces of itself (see systems/Structure): steel
 * tears, glass shatters, wood splinters, stone crumbles. Rounds hole it or dent it,
 * knocks past a fifth of its material's toughness hurt it, heat past half its
 * melting point weakens it, and a weight it can't bear crushes it.
 */
export class Prop extends Entity {
  readonly main: Part;
  protected cfg: PropConfig;
  /** Broken already: it's only taken away at the end of the step, and more hits may land meanwhile (a shotgun's pellets). */
  protected shattered = false;
  /** How hard the harm that broke it was (0..1: see Break.force), for the pieces. */
  protected breakForce = 0.5;
  /** Which way it was struck as it broke, if known (pieces fly along it). */
  protected breakDir: V2 | undefined = undefined;
  /** It ran away molten (see onTemp()): drips, not pieces. */
  protected melted = false;

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
      depth: cfg.depth,
      hollow: cfg.hollow,
    });
    if (cfg.hpPerKg) this.main.maxHp = this.main.hp = cfg.hpPerKg * this.main.mass;
    else if (cfg.hp === undefined && !cfg.unbreakable) {
      // as strong as its material, for its size (its area: its mass over the material's density)
      const area = this.main.mass / Math.max(1, cfg.density ?? cfg.material.density);
      this.main.maxHp = this.main.hp = Math.max(4, cfg.material.strength * area * HP_PER_MPA);
    }
  }

  /** Can be broken (shatters when its hit points run out). */
  get breakable(): boolean {
    return Number.isFinite(this.main.maxHp);
  }

  get condition(): number {
    const p = this.main;
    return Number.isFinite(p.maxHp) && p.maxHp > 0 ? Math.max(0, p.hp) / p.maxHp : 1;
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
    const mat = this.main.mat;
    if (mat === GLASS || this.cfg.hp !== undefined) {
      const m = Math.min(info.otherMass, 400);
      let e = 0.5 * Math.min(m, this.main.mass * 6) * Math.max(0, info.speed - 4) ** 2;
      // glass is brittle: a heavy thing coming down on it shatters it, however light the glass
      // (it can't get out of the way: its own fall onto the floor counts only as above)
      if (mat === GLASS) e = Math.max(e, 0.5 * Math.min(info.otherMass, 2000) * Math.max(0, info.otherSpeed - 4) ** 2);
      if (e > 30) this.damage(info.part, e / 40, 'blunt', info.point, info.normal);
      return;
    }
    // tougher things: nothing under half their toughness, all of them at it; and only as
    // much as what hit them could give (a pebble at 30 m/s doesn't dent a steel box, the floor
    // does; a bat swung into someone isn't hurt, one swung into a post is)
    const v0 = mat.toughness * 0.5;
    if (info.speed <= v0) return;
    const share = Math.min(1, info.otherMass / Math.max(0.05, this.main.mass)) * (info.other ? hardness(info.other.mat) : 1);
    const k = ((info.speed - v0) / (mat.toughness - v0)) ** 2 * share;
    if (k < 0.004) return;
    if (k > 0.02) this.dent(info.part, info.point);
    this.damage(info.part, this.main.maxHp * k, 'blunt', info.point, info.normal);
  }

  /** A knock's dent: the pixels where it struck pushed in (darker). */
  private dent(p: Part, at: V2): void {
    const q = p.worldToPixel(at.x, at.y);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        if (Math.random() < 0.6 && p.solidAt(q.ix + i, q.iy + j)) p.paintPixel(q.ix + i, q.iy + j, 0x000000, 0.18);
      }
    }
  }

  /**
   * Hot: at its melting point it runs away, the faster the hotter (steel in a
   * nuke's fireball, plastic in a fire: see systems/Heat). Short of it, it's only
   * weaker (see softness()).
   */
  onTemp(p: Part, temp: number, t: number): void {
    if (!this.breakable || p.destroyed) return;
    const melt = p.mat.melt;
    if (!(temp >= melt)) return;
    p.hp -= p.maxHp * t * Math.min(1, 0.15 + (temp - melt) / melt);
    if (p.hp <= 0 && !this.destroyed) {
      this.melted = true;
      this.shatter();
    }
  }

  /**
   * How much more a blow does to it hot: past two fifths of its melting point it
   * loses its strength (steel at 1000 °C keeps a tenth of it), by up to 5 times.
   */
  protected softness(p: Part): number {
    return softness(p.mat, p.temp);
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

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    if (!this.breakable) return;
    const before = part.hp;
    const worked = this.works;
    amount *= this.softness(part) * (kind === 'explosion' ? BLAST_K * blastShare(part) : 1);
    part.hp -= amount * (kind === 'fire' ? 0.3 : 1);
    // (a machine knocked out of order: sparks, and the power it made or passed on is gone)
    if (this.usesPower || (this as Prop & { isPowerSource?(): boolean }).isPowerSource) {
      const c = this.condition;
      if (c < WORN && before / part.maxHp >= WORN && part.hp > 0) this.game.particles.sparks(part.x, part.y, 0, 1, 6, 3);
      if (worked && c < BROKEN && part.hp > 0) {
        this.game.particles.sparks(part.x, part.y, 0, 1, 10, 4);
        this.game.particles.smoke(part.x, part.y, 1, 0.25, true);
        this.game.connections.recomputePower();
      }
    }
    if (part.hp <= 0 && !this.destroyed) {
      // (overkill breaks it finer: a nuke's shock, not a last pistol round)
      const over = Math.min(2, (amount - Math.max(0, before)) / Math.max(1, part.maxHp));
      this.breakForce = (FORCE[kind] ?? 0.5) * (1 + over);
      this.breakDir = dir;
      this.shatter(point);
    }
  }

  /** Breaks into pieces of itself (see breakApart()) and is taken away. */
  shatter(point?: V2): void {
    if (this.shattered) return;
    this.shattered = true;
    const p = this.main;
    const g = this.game;
    g.structure.keep(this, this.breakApart(point));
    if (p.mat.sound === 'glass') g.sound.play('impact/glass_break', { gain: 0.9, x: p.x });
    else g.sound.impact(p.mat.sound, 1, p.x);
    g.remove(this);
  }

  /** Its pieces (see systems/Structure): flung out from `point`, as hard as it was broken. */
  protected breakApart(point?: V2): Debris[] {
    if (this.melted) {
      this.game.structure.melt(this.main);
      return [];
    }
    return this.game.structure.fracture(this.main, { at: point, dir: this.breakDir, force: this.breakForce });
  }
}

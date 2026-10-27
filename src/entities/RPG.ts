import { RAPIER } from '../engine/Physics';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
import { Firearm, type GunSpec } from './Firearm';
import { WARHEAD_SHOWS, rpgArt } from '../art/ordnance';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ExplosionOpts } from '../systems/Explosions';
import type { ValueEditor } from '../tools/Controls';
import type { V2 } from '../engine/math';
import type { ContextAction, DamageKind, ItemDef, SpawnOptions } from '../world/types';

/**
 * The middle of the rocket sitting in the loaded launcher, and the back of the
 * tube where the back-blast comes out, in the launcher's art pixels (see
 * art/ordnance: the rocket's art is placed at ROCKET_IN_TUBE).
 */
const ROCKET_AT: [number, number] = [30.5, 4.5];
const VENTURI: [number, number] = [0, 4.5];
/** The rocket's tail, where its motor's flame comes out (rocket art pixel). */
const NOZZLE: [number, number] = [0, 2.5];
/**
 * The rocket's motor: how hard it pushes (m/s²) and for how long (s). While it
 * burns the fins hold the rocket up, so that it flies nearly flat: gravity only
 * pulls on it this much.
 */
const THRUST = 45;
const BURN = 0.55;
const BURN_GRAVITY = 0.25;
/** Seconds of flight after which a rocket that has hit nothing goes off in the air. */
const MAX_FLIGHT = 6;
/** How far (m) a rocket goes before it can hit the launcher it came out of, or whoever holds that. */
const CLEAR = 2.5;
/** Seconds the next rocket takes to slide into the tube, at the end of the reload (its sound's clunk is as it seats). */
const SLIDE = 0.6;
/** The stock warhead's blast (Edit gun…'s Power scales it: see blastFor()). */
const BLAST = { power: 115, radius: 3.6, damage: 220, shrapnel: 6 };

/** The blast of a warhead that does `damage` at its center: the stock one's, bigger or smaller with it. */
function blastFor(damage: number): ExplosionOpts {
  const k = damage / BLAST.damage;
  return {
    power: BLAST.power * k,
    radius: BLAST.radius * Math.max(0.35, Math.min(1.4, Math.cbrt(k))),
    damage,
    shrapnel: Math.round(BLAST.shrapnel * Math.min(1.5, k)),
  };
}

/**
 * A shoulder-fired rocket launcher (an RPG). Use fires the rocket loaded in the
 * tube, with a back-blast out of the rear; then it reloads by itself (Edit
 * gun…'s reload time), the next warhead showing in the muzzle once it's in.
 * People hold it like the other guns; it fires lying about too, and on a pulse
 * down a wire.
 */
export class RocketLauncher extends Firearm {
  loaded = true;
  /** Seconds until the next rocket is in. */
  reload = 0;
  /** The next rocket has started going in (see SLIDE), and how far short of all the way it shows. */
  private sliding = false;
  private inset = -1;
  /** What it fires (makes a Rocket). */
  private readonly round: ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, round: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
    this.round = round;
  }

  /** Fires, or clicks while it's still reloading. */
  activate(): void {
    if (this.loaded) this.fire();
    else this.game.sound.play('gun/dryfire', { gain: 0.4, x: this.main.x });
  }

  /**
   * Reloads: for the last moments (SLIDE) the next rocket slides into the
   * muzzle, a pixel at a time, with the sound of it going in and seating.
   */
  preStep(dt: number): void {
    super.preStep(dt);
    if (this.loaded) return;
    this.reload -= dt;
    if (!this.sliding && this.reload <= SLIDE) {
      this.sliding = true;
      this.game.sound.play('gun/rpg_reload', { gain: 0.7, x: this.main.x, vary: 0.03 });
    }
    if (this.reload > 0) {
      const inset = Math.max(1, Math.ceil((Math.min(this.reload, SLIDE) / SLIDE) * WARHEAD_SHOWS));
      if (this.sliding && inset !== this.inset) {
        this.inset = inset;
        this.main.setArt(rpgArt(true, inset));
      }
      return;
    }
    this.loaded = true;
    this.inset = -1;
    this.main.setArt(rpgArt(true));
  }

  /** How far off (m) whoever fires it should keep from what they fire at: clear of its own blast. */
  standOff(): number {
    return blastFor(this.gun.damage).radius + 1.5;
  }

  /** Fires the rocket, if one is loaded. */
  fire(): void {
    if (!this.loaded || this.destroyed) return;
    const g = this.gun;
    const p = this.main;
    const game = this.game;
    const at = p.pixelToWorld(ROCKET_AT[0], ROCKET_AT[1]);
    const rocket = game.spawn(this.round, at.x, at.y, { flip: this.flipped, angle: p.body.rotation() });
    if (!(rocket instanceof Rocket)) return;
    this.loaded = false;
    this.reload = 1 / g.rate;
    this.sliding = false;
    this.inset = -1;
    this.shots++;
    p.setArt(rpgArt(false));
    const fwd = this.forward();
    // it leaves along the barrel: the launcher swung or spun round doesn't send it off
    // where it isn't pointed (it flies the way it faces), only its speed forward adds on
    const v = p.velocityAt(at.x, at.y);
    const speed = g.speed + Math.max(0, v.x * fwd.x + v.y * fwd.y);
    // it leaves through the launcher and past whoever holds it
    const own = this.holder ? [...this.parts, ...this.holder.parts] : this.parts;
    rocket.launch(own, fwd.x * speed, fwd.y * speed, blastFor(g.damage));
    // nearly recoilless: the back-blast takes most of the kick, a light shove is left
    if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * g.recoil, y: -fwd.y * g.recoil }, this.gripWorld() ?? at, true);
    this.backBlast(fwd);
    // the rocket pops out of the muzzle in a puff
    const ps = game.particles;
    const m = { x: at.x + fwd.x * 0.25, y: at.y + fwd.y * 0.25 };
    ps.flash(m.x, m.y, g.flash);
    ps.smoke(m.x, m.y, 4, 0.25);
    game.renderer.addLight(m.x, m.y, 2.5, 0.6, 0xffd890, 0.08);
    game.sound.play('gun/rocket_launch', { gain: 1.4, x: at.x, vary: 0.04 });
    game.renderer.shake(0.15);
    game.alarm(at.x, at.y, 30);
  }

  /** Flame, a flash and a cloud of smoke out of the back of the tube, and a shove for whatever stands just behind it. */
  private backBlast(fwd: V2): void {
    const game = this.game;
    const ps = game.particles;
    const b = this.main.pixelToWorld(VENTURI[0], VENTURI[1]);
    ps.flash(b.x - fwd.x * 0.35, b.y - fwd.y * 0.35, 0.9);
    ps.flash(b.x - fwd.x * 0.8, b.y - fwd.y * 0.8, 0.5, 0xffe6a0, 0.08);
    game.renderer.addLight(b.x - fwd.x * 0.6, b.y - fwd.y * 0.6, 4.5, 0.85, 0xffd890, 0.14);
    for (let i = 0; i < 14; i++) {
      const s = 5 + Math.random() * 10;
      ps.emit(PK.Fire, b.x, b.y, {
        vx: -fwd.x * s + (Math.random() - 0.5) * 3, vy: -fwd.y * s + (Math.random() - 0.5) * 3, life: 0.08 + Math.random() * 0.12,
        size: 0.1 + Math.random() * 0.12, size1: 0.04, color: 0xfff0b0, color1: 0xb8300c, alpha: 1, alpha1: 0.3, gravity: 0, drag: 6,
      });
    }
    for (let i = 0; i < 16; i++) {
      const s = 1 + Math.random() * 5;
      ps.emit(PK.Smoke, b.x - fwd.x * 0.2, b.y - fwd.y * 0.2, {
        vx: -fwd.x * s + (Math.random() - 0.5) * 1.5, vy: -fwd.y * s + (Math.random() - 0.5) * 1.5 + 0.3, life: 1.4 + Math.random() * 1.6,
        size: 0.2, size1: 0.6 + Math.random() * 0.6, color: 0x8a8682, color1: 0x5a5856, alpha: 0.6, alpha1: 0, gravity: -0.05, drag: 2.2,
      });
    }
    // (sparks that can light oil they're blown across)
    ps.sparks(b.x, b.y, -fwd.x, -fwd.y, 8, 7);
    const behind: Part[] = [];
    game.physics.world.intersectionsWithShape({ x: b.x - fwd.x * 0.8, y: b.y - fwd.y * 0.8 }, 0, new RAPIER.Ball(0.9), (c) => {
      const q = game.physics.partOf(c);
      if (q && !q.destroyed && !q.frozen && q.entity !== this && q.entity !== this.holder) behind.push(q);
      return true;
    });
    for (const q of behind) {
      const j = 6 * Math.sqrt(Math.min(q.mass, 40));
      q.body.applyImpulse({ x: -fwd.x * j, y: -fwd.y * j + j * 0.2 }, true);
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.loaded ? 'Fire' : 'Reloading…', hint: 'F', disabled: !this.loaded, action: () => this.fire() }];
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** The reload time goes from a quarter second (a rocket a fiftieth of a second would be a rocket minigun) to six. */
  protected tuning(k: Parameters<Firearm['tuning']>[0]): ReturnType<Firearm['tuning']> {
    const t = super.tuning(k);
    return k === 'rate' ? { ...t, min: 0.25, max: 6 } : t;
  }

  /** Edit gun…: the shove it gives, the warhead's power and the reload time (no bullets: no pellets, no penetration). */
  editor(): ValueEditor {
    const ed = super.editor();
    const labels: Record<string, string> = { recoil: 'Recoil', damage: 'Power (blast damage)', rate: 'Reload time' };
    ed.fields = ed.fields.filter((f) => f.key in labels).map((f) => ({ ...f, label: labels[f.key] }));
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const base = super.serializeExtra();
    return this.loaded ? base : { ...base, reload: this.reload };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (typeof x.reload !== 'number') return;
    this.loaded = false;
    this.reload = Math.max(0, x.reload);
    this.main.setArt(rpgArt(false));
  }
}

/**
 * An RPG's rocket in flight. Its motor pushes it on for a moment after it
 * leaves the tube, speeding it up and holding it nearly level; then it flies on
 * under gravity like anything thrown. It flies nose first, trailing flame and
 * smoke, and goes off against the first thing it touches: but not the launcher
 * it came out of, or whoever holds that, until it's well clear of them.
 */
export class Rocket extends Entity {
  readonly main: Part;
  private blast: ExplosionOpts;
  /** Seconds of motor burn left. */
  burn = 0;
  private age = 0;
  private spent = false;
  /** Where it left the tube (see CLEAR). */
  private start: V2 | null = null;
  /** Where its tail was a step ago: the trail is laid along the way from there. */
  private tail: V2 | null = null;

  constructor(game: Game, def: ItemDef, art: PixelArt, shapes: ShapeSpec[], density: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.blast = blastFor(BLAST.damage);
    this.main = this.addPart({
      name: 'Rocket', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, shapes, density,
      ccd: true, linearDamping: 0, angularDamping: 0, textureKey: def.id,
    });
  }

  /** Sends it off at (vx, vy) with its motor lit, passing through `own` (the launcher and its holder) and going off with `blast`. */
  launch(own: Part[], vx: number, vy: number, blast: ExplosionOpts): void {
    const p = this.main;
    p.setNoCollide(own);
    p.body.setLinvel({ x: vx, y: vy }, true);
    p.body.setGravityScale(BURN_GRAVITY, true);
    this.blast = blast;
    this.burn = BURN;
    this.start = { x: p.x, y: p.y };
  }

  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    const p = this.main;
    this.age += dt;
    if (this.age > MAX_FLIGHT) {
      this.detonate();
      return;
    }
    // clear of what fired it, it can come down on it like on anything else
    if (p.noCollide && (!this.start || this.age > 1.5 || Math.hypot(p.x - this.start.x, p.y - this.start.y) > CLEAR)) p.setNoCollide(null);
    const v = p.body.linvel();
    if (v.x * v.x + v.y * v.y > 1) {
      p.body.setRotation(Math.atan2(v.y * p.flip, v.x * p.flip), false);
      p.moved();
      p.body.setAngvel(0, false);
    }
    if (this.burn > 0) {
      this.burn = Math.max(0, this.burn - dt);
      const f = p.localDir(p.flip, 0);
      const j = THRUST * p.mass * dt;
      p.body.applyImpulse({ x: f.x * j, y: f.y * j }, true);
      // burnt out: from here on it falls like anything else
      if (this.burn === 0) p.body.setGravityScale(1, true);
    }
    this.exhaust();
  }

  /** The motor's flame and smoke while it burns, then a thinning trail of smoke: laid along the way it came, so it's unbroken however fast it goes. */
  private exhaust(): void {
    const p = this.main;
    const t = p.pixelToWorld(NOZZLE[0], NOZZLE[1]);
    const from = this.tail ?? t;
    this.tail = t;
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const d = Math.hypot(dx, dy);
    const ps = this.game.particles;
    if (this.burn > 0) {
      const f = p.localDir(p.flip, 0);
      const n = Math.max(1, Math.ceil(d / 0.12));
      for (let i = 0; i < n; i++) {
        const k = (i + Math.random()) / n;
        const x = from.x + dx * k;
        const y = from.y + dy * k;
        const s = 3 + Math.random() * 3;
        ps.emit(PK.Fire, x, y, {
          vx: -f.x * s + (Math.random() - 0.5), vy: -f.y * s + (Math.random() - 0.5), life: 0.04 + Math.random() * 0.04,
          size: 0.13 + Math.random() * 0.06, size1: 0.03, color: 0xfff0b0, color1: 0xd84a14, alpha: 1, alpha1: 0.4, gravity: 0, drag: 3,
        });
        if (Math.random() < 0.6) {
          ps.emit(PK.Smoke, x, y, {
            vx: (Math.random() - 0.5) * 0.6, vy: 0.2 + Math.random() * 0.4, life: 1.2 + Math.random() * 1.2,
            size: 0.1, size1: 0.45 + Math.random() * 0.3, color: 0xb0aca6, color1: 0x6e6c6a, alpha: 0.55, alpha1: 0, gravity: -0.03, drag: 1.5,
          });
        }
      }
      this.game.sound.hold(this, 'machine/thruster_loop', 0.6, p.x, 1.35);
    } else if (this.age < BURN + 1.2 && d > 0) {
      // the hot motor smokes a little longer
      for (let i = Math.ceil(d / 0.35); i > 0; i--) {
        if (Math.random() > 0.7) continue;
        const k = Math.random();
        ps.emit(PK.Smoke, from.x + dx * k, from.y + dy * k, {
          vx: (Math.random() - 0.5) * 0.4, vy: 0.2 + Math.random() * 0.3, life: 0.8 + Math.random() * 0.8,
          size: 0.08, size1: 0.3, color: 0xa8a49e, color1: 0x6e6c6a, alpha: 0.35, alpha1: 0, gravity: -0.03, drag: 1.5,
        });
      }
    }
  }

  /** Touching anything (the floor included) sets it off, however glancing the blow; not what fired it, while it's still clear of that. */
  postStep(): void {
    if (this.spent) return;
    const world = this.game.physics.world;
    const p = this.main;
    let hit = false;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (o) => {
        if (hit) return;
        const q = this.game.physics.partOf(o);
        if (q && (q.destroyed || p.noCollide?.has(q))) return;
        world.contactPair(c, o, (m) => {
          for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.02) hit = true;
        });
      });
    }
    if (hit) this.detonate();
  }

  frame(): void {
    if (this.spent) return;
    const p = this.main;
    if (this.burn > 0) {
      const t = p.pixelToWorld(NOZZLE[0], NOZZLE[1]);
      const flicker = 0.85 + Math.random() * 0.3;
      this.game.renderer.addLight(t.x, t.y, 2.4 * flicker, 0.7 * flicker, 0xffb060);
    } else this.game.renderer.addLight(p.x, p.y, 0.8, 0.25, 0xffb060);
  }

  onImpact(): void {
    this.detonate();
  }

  onBullet(): void {
    this.detonate();
  }

  damage(_part: Part, amount: number, kind: DamageKind): void {
    if (kind !== 'fire' && amount > 5) this.detonate();
  }

  detonate(): void {
    if (this.spent || this.destroyed) return;
    this.spent = true;
    const t = this.main.body.translation();
    this.game.explosions.explode(t.x, t.y, { ...this.blast, source: this });
    this.game.remove(this);
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const { power, radius, damage, shrapnel } = this.blast;
    return { burn: this.burn, age: this.age, blast: { power, radius, damage, shrapnel } };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.age === 'number') this.age = x.age;
    if (typeof x.burn === 'number' && x.burn > 0) {
      this.burn = Math.min(BURN, x.burn);
      this.main.body.setGravityScale(BURN_GRAVITY, true);
    }
    const b = x.blast as Partial<ExplosionOpts> | undefined;
    if (b && [b.power, b.radius, b.damage].every((v) => typeof v === 'number' && v > 0 && v < Infinity)) {
      this.blast = { power: b.power!, radius: b.radius!, damage: b.damage!, shrapnel: typeof b.shrapnel === 'number' ? b.shrapnel : 0 };
    }
  }
}

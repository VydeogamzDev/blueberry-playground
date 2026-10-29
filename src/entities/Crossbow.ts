import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Firearm, type GunSpec } from './Firearm';
import { Prop, type PropConfig } from './Prop';
import { sparkle, DRUG_GLOW } from './Medical';
import { fireworkBurst, BURST_REACH, FIREWORK_COLOR_LIST } from './Pyro';
import { PK } from '../systems/Particles';
import type { FireworkColor } from '../art/gear';
import { boltArt, crossbowArt, BOLT_ON_BOW, BOLT_W, type BoltKind } from '../art/crossbow';
import type { HoldSpec } from './Item';
import type { Drug, Injectable } from './Syringe';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { ValueEditor } from '../tools/Controls';
import type { BulletHit, ContextAction, DamageKind, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';
import type { Passing } from './Tank';

export type { BoltKind };

/** The kinds of bolt, in the crossbow's menu (Bolts: …) in this order. */
export const BOLTS: { kind: BoltKind; label: string }[] = [
  { kind: 'normal', label: 'Normal' },
  { kind: 'poison', label: 'Poison' },
  { kind: 'explosive', label: 'Explosive' },
  { kind: 'incendiary', label: 'Incendiary' },
  { kind: 'tranquilizer', label: 'Tranquilizer' },
  { kind: 'firework', label: 'Firework' },
];

/** A bolt's speed off the string (m/s): a heavy hunting crossbow's. */
export const BOLT_SPEED = 70;
/** The harm a bolt does sinking in at full speed (as a bullet's damage: a pistol's is 28). */
export const BOLT_DAMAGE = 50;
/** A tranquilizer dart's share of that: a prick, not a wound. */
const TRANQ_HARM = 0.12;
/** What a bolt sinks into, point first. Off metal, stone and glass it glances, or breaks. */
const SOFT = new Set(['Flesh', 'Bone', 'Wood', 'Plastic', 'Rubber']);
/** How fast (m/s) a bolt must be going into something, point first, to sink in; and to break on something hard it meets square on. */
const STICK_SPEED = 18;
const BREAK_SPEED = 40;
/** An explosive bolt's charge goes off on anything it meets faster than this (m/s); slower, it's only dropped. */
const ARM_SPEED = 8;
/** Below this speed (m/s) a bolt's flight is over: it falls and tumbles like any stick. */
const SPENT_SPEED = 5;
/** Seconds of flight after which a bolt that hit nothing is only a stick lying about. */
const MAX_FLIGHT = 6;
/** How far (m) a bolt goes before it can hit the crossbow it came off, or whoever holds that; and the longest (s) it goes through the side of the soldier who shot it. */
const CLEAR = 1.2;
const PASS_MOST = 1.5;
/** The drug in a poisoned bolt's head and in a tranquilizer dart, and how much (a full syringe is 1). */
const DOSE: Partial<Record<BoltKind, [Drug, number]>> = { poison: ['poison', 0.8], tranquilizer: ['knockout', 1] };
/** An explosive bolt's charge: a grenade's, much smaller. */
const BLAST = { power: 50, radius: 2.6, damage: 130, shrapnel: 4 };
/**
 * A firework bolt, heavier, leaves the string at this share of a bolt's speed,
 * its rocket lit; it bursts after this long (s) in flight if it's hit nothing.
 */
const FIREWORK_PACE = 0.5;
const FIREWORK_FUSE = 0.6;
/**
 * Spent bolts (stuck in things, or lying about) kept in a scene: past this the
 * oldest are taken away as more are fired, so a long fight doesn't fill it.
 */
const MAX_BOLTS = 24;
/**
 * Seconds from a shot to the next bolt in the groove (Edit gun… changes it),
 * and how far through that the string starts back, is half way, and catches on the latch.
 */
export const COCK_TIME = 1.2;
const DRAW_START = 0.1;
const DRAW_HALF = 0.4;
const LATCHED = 0.8;
/** From the bolt's nock to its point (m): the stretch of its flight path looked along for what's ahead. */
const LENGTH = (BOLT_W - 1) * PX;
/** What a bolt in flight looks for ahead of it: the floor and walls and anything solid (not things set to collide with nothing). */
const AHEAD = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);
/** A bolt stuck in something touches nothing (it would only snag on the floor and on the limbs round it). */
const NO_CONTACTS = groups(GROUP.NOCOLLIDE, 0);
const STILL: V2 = { x: 0, y: 0 };

let ray: RAPIER.Ray | null = null;

/** Every game's bolts, oldest first (see cull()). */
const quivers = new WeakMap<Game, Bolt[]>();

function boltsOf(game: Game): Bolt[] {
  let list = quivers.get(game);
  if (!list) quivers.set(game, (list = []));
  return list;
}

/** Takes away the oldest bolts that are done flying, past MAX_BOLTS. */
function cull(game: Game): void {
  const list = boltsOf(game);
  for (let i = 0; i < list.length && list.length > MAX_BOLTS; ) {
    const b = list[i];
    if (b.state === 'flying') {
      i++;
      continue;
    }
    list.splice(i, 1);
    game.remove(b);
  }
}

/**
 * A crossbow. Use looses the bolt in the groove; then the string is drawn
 * back and caught on the latch, and the next bolt laid in (a second or so),
 * before it can shoot again. Its menu picks the bolts it's loaded with: normal
 * ones, poisoned, explosive, incendiary or tranquilizer darts. People hold it
 * like a gun and shoot it at whoever they fight; it shoots lying about too, and
 * on a pulse down a wire.
 */
export class Crossbow extends Firearm {
  loaded = true;
  /** Seconds until the next bolt is in. */
  reload = 0;
  /** The kind of bolt it's loaded with. */
  bolt: BoltKind = 'normal';
  /** What it shoots, for each kind of bolt. */
  private readonly bolts: Record<BoltKind, ItemDef>;
  /** Which art it shows (see show()). */
  private shown = '2:normal';

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, bolts: Record<BoltKind, ItemDef>, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
    this.bolts = bolts;
  }

  /** Shoots, or clicks while the string is still being drawn back. */
  activate(): void {
    if (this.loaded) this.fire();
    else this.game.sound.play('gun/dryfire', { gain: 0.3, x: this.main.x, rate: 1.3 });
  }

  /** How fast (m/s) its bolt leaves it: a slow shot, that drops on its way to anything far off. */
  projectileSpeed(): number {
    return this.gun.speed * (this.bolt === 'firework' ? FIREWORK_PACE : 1);
  }

  /** How far off (m) whoever shoots it should keep from what they shoot at: clear of an explosive bolt's blast, or a firework's. */
  standOff(): number {
    return this.bolt === 'explosive' ? BLAST.radius + 1.5 : this.bolt === 'firework' ? BURST_REACH + 1.5 : 0;
  }

  /** Seconds from a shot to the next bolt in (Edit gun…'s cocking time). */
  private get cockTime(): number {
    return 1 / this.gun.rate;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.loaded) return;
    const T = this.cockTime;
    const was = 1 - this.reload / T;
    this.reload = Math.max(0, this.reload - dt);
    const k = 1 - this.reload / T;
    // the string drawn back (a creak), caught on the latch (a click), then the next bolt laid in the groove
    if (was < DRAW_START && k >= DRAW_START) this.game.sound.play('gun/crossbow_draw', { gain: 0.6, x: this.main.x });
    if (was < LATCHED && k >= LATCHED) this.game.sound.play('gun/crossbow_latch', { gain: 0.7, x: this.main.x });
    if (this.reload <= 0) this.loaded = true;
    this.show();
  }

  /** Its art for how far the string is drawn back, and the bolt in the groove (if one is in). */
  private show(): void {
    const k = this.loaded ? 1 : 1 - this.reload / this.cockTime;
    const draw = k < DRAW_HALF ? 0 : k < LATCHED ? 1 : 2;
    const bolt = this.loaded ? this.bolt : null;
    const key = `${draw}:${bolt}`;
    if (key === this.shown || this.destroyed) return;
    this.shown = key;
    this.main.setArt(crossbowArt(draw, bolt));
  }

  /** Looses the bolt, if one is in. */
  fire(): void {
    if (!this.loaded || this.destroyed) return;
    const g = this.gun;
    const p = this.main;
    const game = this.game;
    const speed = this.projectileSpeed();
    const at = p.pixelToWorld(BOLT_ON_BOW[0] + (BOLT_W - 1) / 2, BOLT_ON_BOW[1] + 1);
    const bolt = game.spawn(this.bolts[this.bolt], at.x, at.y, { flip: this.flipped, angle: p.body.rotation() });
    if (!(bolt instanceof Bolt)) return;
    this.loaded = false;
    this.reload = this.cockTime;
    this.shots++;
    const fwd = this.forward();
    const a = (Math.random() - 0.5) * g.spread;
    const dx = fwd.x * Math.cos(a) - fwd.y * Math.sin(a);
    const dy = fwd.x * Math.sin(a) + fwd.y * Math.cos(a);
    const v = p.body.linvel();
    // it leaves past the prod and whoever holds it (and a soldier's, past their own side in the way)
    const own = this.holder ? [...this.parts, ...this.holder.parts] : this.parts;
    bolt.launch(own, v.x + dx * speed, v.y + dy * speed, g.damage, this.passing()?.pass);
    if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * g.recoil, y: -fwd.y * g.recoil }, this.gripWorld() ?? at, true);
    cull(game);
    this.show();
    game.sound.play('gun/crossbow_release', { gain: 1, x: at.x, vary: 0.05 });
    // (hardly a sound: only what's close by hears it)
    game.alarm(at.x, at.y, 8);
  }

  /** Takes bolts of another kind: the one in the groove is swapped for one of them. */
  load(kind: BoltKind): void {
    if (kind === this.bolt) return;
    this.bolt = kind;
    this.show();
    this.game.sound.play('gun/crossbow_latch', { gain: 0.35, x: this.main.x, rate: 1.3 });
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.loaded ? 'Fire' : 'Cocking…', hint: 'F', disabled: !this.loaded, action: () => this.fire() }];
    for (const b of BOLTS) acts.push({ label: `Bolts: ${b.label}`, checked: this.bolt === b.kind, action: () => this.load(b.kind) });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  /** Edit gun…: the bolt's power and the cocking time (no bullets: no pellets, no penetration). */
  editor(): ValueEditor {
    const ed = super.editor();
    const labels: Record<string, string> = { damage: 'Power (damage per bolt)', rate: 'Cocking time' };
    ed.fields = ed.fields
      .filter((f) => f.key in labels)
      .map((f) => ({ ...f, label: labels[f.key], ...(f.key === 'rate' ? { min: 0.3 } : {}) }));
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (always something, the kind of bolt at least: a guest's copy learns of a finished reload from the change)
    const x: Record<string, unknown> = { ...super.serializeExtra(), bolt: this.bolt };
    if (!this.loaded) x.reload = this.reload;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.bolt = BOLTS.find((b) => b.kind === x.bolt)?.kind ?? 'normal';
    this.loaded = typeof x.reload !== 'number';
    this.reload = this.loaded ? 0 : clamp(x.reload as number, 0, this.cockTime);
    this.show();
  }
}

type BoltState = 'loose' | 'flying' | 'stuck';

/**
 * A crossbow bolt. Loosed, it flies nose first under gravity; meeting flesh or
 * wood point first and fast, it sinks in (welded to the part it hit, so it
 * moves with it) and hurts it as a bullet would, with what its kind adds:
 * poison, a sedative, fire, or (an explosive bolt, which never sticks) a small
 * blast. A firework bolt never sticks either: it trails sparks, and bursts in a
 * shower of coloured stars on whatever it meets, or a moment into its flight.
 * Off metal and stone it glances, or breaks against them head on. Spent, it's a
 * stick lying about: dropped on a crossbow, it loads it with its kind.
 */
export class Bolt extends Prop {
  readonly kind: BoltKind;
  state: BoltState = 'loose';
  /** The part it's stuck in. */
  target: Part | null = null;
  /** The harm it does sinking in at full speed (the crossbow's power). */
  power = BOLT_DAMAGE;
  private joint: RAPIER.ImpulseJoint | null = null;
  /** How deep (m) it's in, and how many of its pixels that hides (see boltArt()). */
  private depth = 0;
  private cut = 0;
  private age = 0;
  /** Where it was loosed from (see CLEAR), and how far on (m, across) it goes through the side of the soldier who shot it (see launch()). */
  private start: V2 | null = null;
  private passD = 0;
  /** That side, whose soldiers' bullets don't meet it (see Passing). */
  firedFor: string | null = null;
  /** The part it was just pulled out of: kept from touching it until it's clear of it. */
  private freed: Part | null = null;
  private freeT = 0;
  /** Heat an explosive or firework bolt has taken from a fire: enough, and the charge cooks off. */
  private heat = 0;
  private spent = false;
  /** The colour a firework bolt bursts in. */
  readonly color: FireworkColor = FIREWORK_COLOR_LIST[Math.floor(Math.random() * FIREWORK_COLOR_LIST.length)].color;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, kind: BoltKind, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.kind = kind;
    boltsOf(game).push(this);
  }

  /**
   * Sends it off at (vx, vy), passing through `own` (the crossbow and whoever
   * holds it), sinking in with `power`. A soldier on a side shoots it `past`
   * their own side in the way (see Firearm.firePast()).
   */
  launch(own: Part[], vx: number, vy: number, power: number, past?: Passing): void {
    const p = this.main;
    p.setNoCollide(past?.parts.length ? [...own, ...past.parts] : own);
    this.passD = past?.d ?? 0;
    this.firedFor = past?.side ?? null;
    p.body.setLinvel({ x: vx, y: vy }, true);
    p.body.setAngvel(0, true);
    this.power = power;
    this.state = 'flying';
    this.start = { x: p.x, y: p.y };
    // the wrapping on an incendiary bolt's head is lit as it goes
    if (this.kind === 'incendiary') {
      p.oil = 1;
      this.game.fire.ignite(p, 0.9);
    }
  }

  canRest(): boolean {
    return this.state !== 'flying';
  }

  /** Stuck in something, dragging it pulls on that. */
  dragMass(): number {
    const m = super.dragMass();
    return this.target ? m + Math.min(80, this.target.entity.totalMass()) : m;
  }

  preStep(dt: number): void {
    if (this.state !== 'flying') return;
    const p = this.main;
    this.age += dt;
    const passing = !!this.start && this.age < PASS_MOST && Math.abs(p.x - this.start.x) < this.passD;
    if (p.noCollide && !passing && (!this.start || this.age > 0.5 || Math.hypot(p.x - this.start.x, p.y - this.start.y) > CLEAR)) p.setNoCollide(null);
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y);
    if (this.kind === 'firework') {
      if (speed < SPENT_SPEED || this.age > FIREWORK_FUSE) {
        this.detonate();
        return;
      }
      this.trail();
    }
    if (speed < SPENT_SPEED || this.age > MAX_FLIGHT) {
      this.state = 'loose';
      return;
    }
    // nose first, the fletching keeping it so
    p.body.setRotation(Math.atan2(v.y * p.flip, v.x * p.flip), false);
    p.moved();
    p.body.setAngvel(0, false);
    this.look(speed * dt);
  }

  /** A firework bolt's rocket: a stream of sparks out of its tail, and its hiss. */
  private trail(): void {
    const game = this.game;
    const p = this.main;
    const f = p.localDir(p.flip, 0);
    const t = p.pixelToWorld(0, 1);
    for (let i = 0; i < 2; i++) {
      game.particles.emit(PK.Spark, t.x, t.y, {
        vx: -f.x * (2 + Math.random() * 3) + (Math.random() - 0.5), vy: -f.y * (2 + Math.random() * 3) + (Math.random() - 0.5),
        life: 0.2 + Math.random() * 0.3, color: 0xfff1b0, color1: 0xff8a2a, alpha1: 0.2, gravity: 0.5, drag: 1.5,
      });
    }
    if (Math.random() < 0.25) game.particles.smoke(t.x, t.y, 1, 0.1);
    game.sound.hold(this, 'explosion/fuse_loop', 0.35, t.x);
  }

  /** A firework bolt's rocket glows in flight (on every screen). */
  frame(): void {
    if (this.kind !== 'firework' || this.state !== 'flying' || this.destroyed) return;
    const t = this.main.pixelToWorld(0, 1);
    this.game.renderer.addLight(t.x, t.y, 2, 0.5, 0xffb060);
  }

  /**
   * Looks along its flight from its nock to as far as its point goes this step
   * for what it's about to hit, and hits it: before the physics would bounce it off.
   */
  private look(travel: number): void {
    const p = this.main;
    const phys = this.game.physics;
    const f = p.localDir(p.flip, 0);
    const tail = p.pixelToWorld(0, 1);
    const own = p.noCollide;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    r.origin = tail;
    r.dir = f;
    const past = own
      ? (c: RAPIER.Collider) => {
        const q = phys.partOf(c);
        return !q || !own.has(q);
      }
      : undefined;
    const hit = phys.world.castRayAndGetNormal(r, LENGTH + travel + 0.05, true, undefined, AHEAD, undefined, p.body, past);
    if (!hit) return;
    const q = phys.partOf(hit.collider) ?? null;
    if (q?.destroyed) return;
    const at = { x: tail.x + f.x * hit.timeOfImpact, y: tail.y + f.y * hit.timeOfImpact };
    const n = { x: hit.normal.x, y: hit.normal.y };
    // how fast it's going into what it met, point first, and how squarely (1: straight on;
    // starting inside it, there's no telling: it's taken as square)
    const v = p.body.linvel();
    const u = q && !q.frozen ? q.velocityAt(at.x, at.y) : STILL;
    const along = (v.x - u.x) * f.x + (v.y - u.y) * f.y;
    const nl = Math.hypot(n.x, n.y);
    const square = nl > 0.5 ? -(f.x * n.x + f.y * n.y) / nl : 1;
    this.strike(q, at, f, n, along, square);
  }

  /** What happens as it meets `q` (null: the floor or a wall) at `at`, going `along` m/s into it point first. */
  private strike(q: Part | null, at: V2, f: V2, n: V2, along: number, square: number): void {
    if (this.kind === 'firework') {
      this.detonate({ x: at.x - f.x * 0.1, y: at.y - f.y * 0.1 });
      return;
    }
    if (this.kind === 'explosive') {
      if (along > ARM_SPEED) this.detonate({ x: at.x - f.x * 0.06, y: at.y - f.y * 0.06 });
      else this.state = 'loose';
      return;
    }
    const soft = !!q && SOFT.has(q.mat.name);
    if (q && soft && along > STICK_SPEED && square > 0.35) {
      this.pierce(q, at, f, n, along);
      return;
    }
    if (!soft && along > BREAK_SPEED && square > 0.7) {
      this.splinter(q, at, f, n, along);
      return;
    }
    // it glances off (the physics does the bouncing), and tumbles on as a stick
    this.state = 'loose';
  }

  /** Sinks into `q`: hurts it as a bullet would (a wound that bleeds), then whatever its kind adds, and it stays in. */
  private pierce(q: Part, at: V2, f: V2, n: V2, along: number): void {
    const game = this.game;
    const p = this.main;
    const who = q.entity;
    const dmg = this.power * Math.min(1.2, (along / BOLT_SPEED) ** 2) * (this.kind === 'tranquilizer' ? TRANQ_HARM : 1);
    who.onBullet({ part: q, point: at, normal: n, dir: f, energy: dmg * 10, damage: dmg, exit: null });
    // (it broke what it hit, or was blown up by it)
    if (q.destroyed || this.destroyed) {
      this.state = 'loose';
      return;
    }
    if (!q.frozen) {
      const j = p.mass * along * 0.6;
      q.body.applyImpulseAtPoint({ x: f.x * j, y: f.y * j }, at, true);
    }
    const flesh = q.mat.bleeds;
    const dose = DOSE[this.kind];
    const into = who as Entity & Partial<Injectable>;
    if (dose && flesh && !q.detached && into.inject) {
      into.inject(dose[0], dose[1]);
      sparkle(game, at.x, at.y, DRUG_GLOW[dose[0]], 8);
    }
    if (this.kind === 'incendiary') {
      // the burning wrapping's fuel soaks in where it strikes
      q.oil = Math.min(1, q.oil + 0.4);
      game.fire.ignite(q, 0.8);
    }
    game.sound.play('hit/bolt', { gain: flesh ? 0.45 : 0.9, x: at.x, vary: 0.06 });
    if (!flesh) game.particles.debris(at.x, at.y, n.x, n.y, 3, q.mat.debrisColor, 2);
    const depth = flesh ? clamp(0.03 + along * 0.0022, 0.05, 0.2) : clamp(0.02 + along * 0.001, 0.03, 0.1);
    // its point `depth` past where it struck, moving as that part does
    const tip = p.pixelToWorld(BOLT_W - 1, 1);
    const t = p.body.translation();
    p.body.setTranslation({ x: t.x + at.x + f.x * depth - tip.x, y: t.y + at.y + f.y * depth - tip.y }, true);
    p.moved();
    p.body.setLinvel(q.frozen ? STILL : q.velocityAt(at.x, at.y), true);
    p.body.setAngvel(q.frozen ? 0 : q.body.angvel(), true);
    this.stick(q, depth);
  }

  /**
   * Breaks against something hard it met head on (`q`, or the floor or a wall),
   * in a spray of splinters, knocking it as a spent bullet would (glass breaks):
   * an incendiary one splashes its fire about.
   */
  private splinter(q: Part | null, at: V2, f: V2, n: V2, along: number): void {
    const game = this.game;
    if (q) {
      const dmg = this.power * Math.min(1.2, (along / BOLT_SPEED) ** 2) * 0.3;
      q.entity.onBullet({ part: q, point: at, normal: n, dir: f, energy: dmg * 10, damage: dmg, exit: null });
      if (!q.destroyed && !q.frozen) {
        const j = this.main.mass * along * 0.3;
        q.body.applyImpulseAtPoint({ x: f.x * j, y: f.y * j }, at, true);
      }
    }
    game.particles.sparks(at.x, at.y, n.x, n.y, 3, 3);
    game.sound.play('hit/bolt', { gain: 0.5, x: at.x, rate: 1.4, vary: 0.06 });
    if (this.kind === 'incendiary') game.fire.flare(at.x, at.y, 0.5);
    this.state = 'loose';
    this.shatter(at);
  }

  /** Holds it where it is in `q`, `depth` m deep: welded on, touching nothing. */
  private stick(q: Part, depth: number): void {
    const p = this.main;
    const c = p.body.translation();
    const data = RAPIER.JointData.fixed(q.worldToLocal(c.x, c.y), 0, { x: 0, y: 0 }, q.body.rotation() - p.body.rotation());
    this.joint = this.game.physics.world.createImpulseJoint(data, q.body, p.body, true);
    this.joint.setContactsEnabled(false);
    p.setNoCollide(null);
    // (left out of the contact groups' sorting: see ContactGroups)
    p.onlyStatic = true;
    p.contactGroups = NO_CONTACTS;
    for (const col of p.colliders) col.setCollisionGroups(NO_CONTACTS);
    this.state = 'stuck';
    this.target = q;
    this.depth = depth;
    this.setCut(Math.round(depth / PX));
  }

  /** Comes loose: pulled out (drawn back out the way it went in), or what it was stuck in is gone. */
  release(pulled = true): void {
    const q = this.target;
    const p = this.main;
    if (this.joint?.isValid()) this.game.physics.world.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.target = null;
    this.state = 'loose';
    // touching things again (only the floor and walls, set to collide with nothing)
    p.onlyStatic = false;
    p.setNoCollideAll(p.noCollideAll);
    this.setCut(0);
    if (!q || q.destroyed) return;
    if (pulled) {
      const f = p.localDir(p.flip, 0);
      const t = p.body.translation();
      const back = this.depth + 0.03;
      p.teleport(t.x - f.x * back, t.y - f.y * back, p.body.rotation());
      if (q.mat.bleeds) this.game.particles.blood(t.x, t.y, -f.x, -f.y, 6, 2, q.body);
      this.game.sound.squish(0.4, t.x);
    }
    p.noCollideWith(q);
    this.freed = q;
    this.freeT = 0.3;
  }

  private setCut(n: number): void {
    n = clamp(n, 0, BOLT_W - 5);
    if (n === this.cut || this.destroyed) return;
    this.cut = n;
    this.main.setArt(boltArt(this.kind, n));
  }

  postStep(dt: number): void {
    if (this.state === 'stuck') {
      if (!this.target || this.target.destroyed || !this.joint?.isValid()) this.release(false);
      return;
    }
    // (copied, or loaded, without what it was stuck in)
    if (this.cut) this.setCut(0);
    if (!this.freed) return;
    this.freeT -= dt;
    if (this.freeT > 0) return;
    if (this.freed.destroyed || !this.game.physics.overlaps(this.main, this.freed)) {
      this.main.collideWith(this.freed);
      this.freed = null;
    } else this.freeT = 0.1;
  }

  /** A knock the look ahead missed (along its side): it's knocked off its flight. An explosive one goes off, and a firework one in flight bursts. */
  onImpact(info: ImpactInfo): void {
    if (this.kind === 'explosive' && (this.state === 'flying' ? info.speed > ARM_SPEED : info.speed > 20)) {
      this.detonate();
      return;
    }
    if (this.kind === 'firework' && this.state === 'flying') {
      this.detonate();
      return;
    }
    if (this.state === 'flying') this.state = 'loose';
  }

  /** Does it carry a charge (that a shot, a blast or a fire sets off)? */
  private get charged(): boolean {
    return this.kind === 'explosive' || this.kind === 'firework';
  }

  onBullet(hit: BulletHit): void {
    if (this.charged) this.detonate();
    else super.onBullet(hit);
  }

  damage(part: Part, amount: number, kind: DamageKind, point?: V2, dir?: V2): void {
    if (!this.charged) return super.damage(part, amount, kind, point, dir);
    // a blast sets the charge off, and so does a fire, given time
    if (kind === 'explosion' && amount > 5) this.detonate();
    else if (kind === 'fire' && (this.heat += amount) > 4) this.detonate();
  }

  /** Its charge goes off (at `at`, or where it is): an explosive bolt's blast, or a firework bolt's burst. */
  detonate(at?: V2): void {
    if (this.spent || this.destroyed) return;
    this.spent = true;
    const t = at ?? this.main.body.translation();
    if (this.kind === 'firework') fireworkBurst(this.game, t, this.color, this);
    else this.game.explosions.explode(t.x, t.y, { ...BLAST, source: this });
    this.game.remove(this);
  }

  /** Let go of on a crossbow, it loads that with its kind (and is used up). */
  onGrab(_part: Part, held: boolean): void {
    if (held || this.state === 'stuck') return;
    const bow = this.bowAt();
    if (!bow) return;
    bow.load(this.kind);
    this.game.remove(this);
  }

  /** A crossbow it's lying on, or just over. */
  private bowAt(): Crossbow | null {
    const phys = this.game.physics;
    let bow: Crossbow | null = null;
    for (const c of this.main.colliders) {
      phys.world.contactPairsWith(c, (o) => {
        const e = phys.partOf(o)?.entity;
        if (!bow && e instanceof Crossbow && !e.destroyed) bow = e;
      });
    }
    if (bow) return bow;
    const p = this.main;
    for (const e of this.game.entities) if (e instanceof Crossbow && !e.destroyed && Math.hypot(e.main.x - p.x, e.main.y - p.y) < 0.45) return e;
    return null;
  }

  contextActions(): ContextAction[] {
    return this.state === 'stuck' ? [{ label: 'Pull out', action: () => this.release() }] : [];
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const q = this.target;
    if (this.state !== 'stuck' || !q) return undefined;
    const i = ref(q.entity);
    return i < 0 ? undefined : { stuck: [i, q.entity.parts.indexOf(q), this.depth] };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const s = links.stuck as [number, number, number] | undefined;
    if (!Array.isArray(s)) return;
    const q = get(s[0])?.parts[s[1]];
    // (it and what it was stuck in are back where they were: it's welded on again as they are)
    if (q && !q.destroyed) this.stick(q, Math.max(0, Number(s[2]) || 0));
  }

  protected serializeExtra(): Record<string, unknown> {
    // (always something: a guest's copy learns from the change that it's come loose)
    const x: Record<string, unknown> = { state: this.state };
    if (this.state === 'flying') x.age = this.age;
    if (this.power !== BOLT_DAMAGE) x.power = this.power;
    if (this.cut) x.cut = this.cut;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.power === 'number' && x.power >= 0 && x.power < Infinity) this.power = x.power;
    if (x.state === 'flying') {
      this.state = 'flying';
      this.age = typeof x.age === 'number' ? x.age : 0;
    }
    this.setCut(typeof x.cut === 'number' ? Math.round(x.cut) : 0);
  }

  protected onDestroy(): void {
    const list = boltsOf(this.game);
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
    // (its body is gone, and the weld with it)
    this.joint = null;
    this.target = null;
  }
}

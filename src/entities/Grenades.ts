import { RAPIER } from '../engine/Physics';
import { GROUP, groups } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
import { Explosive, type BlastSpec } from './Explosive';
import { Firearm, type GunSpec } from './Firearm';
import { launcherArt, LAUNCHER_MUZZLE, LAUNCHER_BREECH } from '../art/gear';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ExplosionOpts } from '../systems/Explosions';
import type { ValueEditor } from '../tools/Controls';
import type { ContextAction, DamageKind, ItemDef, SpawnOptions } from '../world/types';

/** Stuck on, it touches nothing (it would only snag on what's round it). */
const NO_CONTACTS = groups(GROUP.NOCOLLIDE, 0);
/** Seconds after leaving someone's hand before it can stick to anything (not to the hand that threw it). */
const THROWN = 0.35;

// ------------------------------------------------------------------ sticky grenade

/**
 * A sticky grenade. Pull the pin (Use) and throw it: it sticks to the first
 * thing it touches (a person, a crate, a car, the floor or a wall) and moves
 * with it until it goes off. Dragged about by hand it doesn't stick until let go.
 */
export class StickyGrenade extends Explosive {
  /** What it's stuck to (a part, or the floor and walls' body), and the weld. */
  target: Part | null = null;
  private wall = false;
  private joint: RAPIER.ImpulseJoint | null = null;
  /** Being dragged about with the mouse. */
  private grabbed = false;
  /** Who held it last, and how long ago it left their hand (see THROWN). */
  private thrower: Entity | null = null;
  private thrownT = 0;
  private held = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blast: BlastSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, blast, x, y, opts);
  }

  get stuck(): boolean {
    return !!this.joint;
  }

  /** Stuck to something, dragging it pulls on that. */
  dragMass(): number {
    const m = super.dragMass();
    return this.target ? m + Math.min(80, this.target.entity.totalMass()) : m;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    this.grabbed = held;
    if (!this.stuck) super.onGrab(part, held, at);
  }

  /** Stuck on, no one takes it. */
  offer(at?: V2): boolean {
    return this.stuck ? false : super.offer(at);
  }

  preStep(dt: number): void {
    // (who threw it: it won't stick to them for a moment)
    if (this.holder) {
      this.held = true;
      this.thrower = this.holder;
    } else if (this.held) {
      this.held = false;
      this.thrownT = THROWN;
    }
    if (this.thrownT > 0) this.thrownT -= dt;
    super.preStep(dt);
  }

  postStep(dt: number): void {
    super.postStep(dt);
    if (this.destroyed) return;
    if (this.stuck) {
      if (!this.joint!.isValid() || (this.target && this.target.destroyed)) this.release();
      return;
    }
    if (!this.armed || this.holder || this.grabbed) return;
    const hit = this.touching();
    if (hit) this.stick(hit.body, hit.part);
  }

  /** The first thing it's touching (not the hand that just threw it): its body, and its part if it's a thing. */
  private touching(): { body: RAPIER.RigidBody; part: Part | null } | null {
    const world = this.game.physics.world;
    const phys = this.game.physics;
    const p = this.main;
    let found: { body: RAPIER.RigidBody; part: Part | null } | null = null;
    for (const c of p.colliders) {
      world.contactPairsWith(c, (o) => {
        if (found) return;
        const q = phys.partOf(o) ?? null;
        if (q && (q.destroyed || q.entity === this || (this.thrownT > 0 && q.entity === this.thrower) || p.noCollide?.has(q))) return;
        const body = o.parent();
        if (!body) return;
        world.contactPair(c, o, (m) => {
          for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.02) found = { body, part: q };
        });
      });
      if (found) break;
    }
    return found;
  }

  /** Welds it where it is to `body` (a part's, or the floor and walls'): it moves with that and touches nothing else. */
  private stick(body: RAPIER.RigidBody, part: Part | null): void {
    const p = this.main;
    const c = p.body.translation();
    const t = body.translation();
    const r = body.rotation();
    const dx = c.x - t.x;
    const dy = c.y - t.y;
    const local = { x: dx * Math.cos(-r) - dy * Math.sin(-r), y: dx * Math.sin(-r) + dy * Math.cos(-r) };
    const data = RAPIER.JointData.fixed(local, 0, { x: 0, y: 0 }, r - p.body.rotation());
    this.joint = this.game.physics.world.createImpulseJoint(data, body, p.body, true);
    this.joint.setContactsEnabled(false);
    this.target = part;
    this.wall = !part;
    p.onlyStatic = true;
    p.contactGroups = NO_CONTACTS;
    for (const col of p.colliders) col.setCollisionGroups(NO_CONTACTS);
    this.game.sound.squish(0.5, c.x, 0.7);
    this.game.particles.emit(PK.Debris, c.x, c.y, { vx: (Math.random() - 0.5), vy: 0.5, life: 1.5, color: 0xb8692c, size: 1 / 32, gravity: 1 });
  }

  /** Comes off what it was stuck to (pulled off, or that's gone): it falls and touches things again. */
  release(): void {
    const p = this.main;
    if (this.joint?.isValid()) this.game.physics.world.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.target = null;
    this.wall = false;
    p.onlyStatic = false;
    p.setNoCollideAll(p.noCollideAll);
    // (pulled off, it's held in the hand: it doesn't stick again until let go)
    this.thrownT = THROWN;
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    if (this.stuck) acts.push({ label: 'Pull off', action: () => this.release() });
    return acts;
  }

  serializeLinks(ref: (e: Entity) => number): Record<string, unknown> | undefined {
    const q = this.target;
    if (!this.stuck || !q) return undefined;
    const i = ref(q.entity);
    return i < 0 ? undefined : { stuck: [i, q.entity.parts.indexOf(q)] };
  }

  restoreLinks(links: Record<string, unknown>, get: (i: number) => Entity | undefined): void {
    const s = links.stuck as [number, number] | undefined;
    if (!Array.isArray(s)) return;
    const q = get(s[0])?.parts[s[1]];
    if (q && !q.destroyed && !this.stuck) this.stick(q.body, q);
  }

  protected serializeExtra(): Record<string, unknown> | undefined {
    const x = super.serializeExtra();
    return this.wall ? { ...x, wall: true } : x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (x.wall === true && !this.stuck) this.stick(this.game.env.body, null);
  }

  protected onDestroy(): void {
    super.onDestroy();
    this.joint = null;
    this.target = null;
  }
}

// ------------------------------------------------------------------ grenade launcher

/** How the launcher's rounds go off: on whatever they hit, or once their time fuze runs out (bouncing about till then). */
export type LauncherMode = 'impact' | 'timed';
const MODES: { mode: LauncherMode; label: string }[] = [
  { mode: 'impact', label: 'Impact' },
  { mode: 'timed', label: 'Timed (2.5 s)' },
];
/** A round's blast (Edit gun…'s power scales it). */
const ROUND_BLAST = { power: 60, radius: 3.2, damage: 150, shrapnel: 10 };
/** Seconds a timed round's fuze runs; how far (m) and how long (s) a round flies before it's armed; how long at most it flies. */
const TIME_FUZE = 2.5;
const ARM_DIST = 1.5;
const ARM_TIME = 0.12;
const MAX_FLIGHT = 8;
/** How far (m) a round goes before it can hit the launcher, or whoever holds that. */
const CLEAR = 1.2;
/** When in the reload the launcher is broken open (the empty case flies out), the next round goes in, and it's snapped shut (shares of it). */
const OPEN_AT = 0.15;
const LOAD_AT = 0.55;
const SHUT_AT = 0.85;

function blastFor(damage: number): ExplosionOpts {
  const k = damage / ROUND_BLAST.damage;
  return {
    power: ROUND_BLAST.power * k,
    radius: ROUND_BLAST.radius * clamp(Math.cbrt(k), 0.35, 1.4),
    damage,
    shrapnel: Math.round(ROUND_BLAST.shrapnel * Math.min(1.5, k)),
  };
}

/**
 * A break-action grenade launcher. Use lobs a 40 mm grenade in an arc: it goes
 * off on whatever it hits (once it's flown far enough to arm), or, set to timed
 * in its menu, bounces about until its fuze runs out. Then it's broken open,
 * the empty case thrown out, the next round put in and snapped shut. People
 * use it like a gun, lobbing it at whoever they fight from out of its blast.
 */
export class GrenadeLauncher extends Firearm {
  loaded = true;
  /** Seconds until the next round is in. */
  reload = 0;
  mode: LauncherMode = 'impact';
  private open = false;
  private readonly round: ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, gun: GunSpec, round: ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, hold, gun, x, y, opts);
    this.round = round;
  }

  activate(): void {
    if (this.loaded) this.fire();
    else this.game.sound.play('gun/dryfire', { gain: 0.4, x: this.main.x });
  }

  /** How fast (m/s) its round leaves it: a slow lob, that people aim high to drop on whoever they fight. */
  projectileSpeed(): number {
    return this.gun.speed;
  }

  /** How far off (m) whoever fires it should keep from what they fire at: clear of the blast. */
  standOff(): number {
    return blastFor(this.gun.damage).radius + 1.5;
  }

  private get reloadTime(): number {
    return 1 / this.gun.rate;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.loaded) return;
    const T = this.reloadTime;
    const was = 1 - this.reload / T;
    this.reload = Math.max(0, this.reload - dt);
    const k = 1 - this.reload / T;
    const p = this.main;
    if (was < OPEN_AT && k >= OPEN_AT) this.breakOpen();
    if (was < LOAD_AT && k >= LOAD_AT) this.game.sound.play('gun/shell_in', { gain: 0.7, x: p.x, vary: 0.04 });
    if (was < SHUT_AT && k >= SHUT_AT) {
      this.setOpen(false);
      this.game.sound.play('gun/break_close', { gain: 0.8, x: p.x, vary: 0.04 });
    }
    if (this.reload <= 0) this.loaded = true;
  }

  /** Broken open at the hinge: the empty case thrown out of the breech. */
  private breakOpen(): void {
    const p = this.main;
    this.setOpen(true);
    this.game.sound.play('gun/break_open', { gain: 0.8, x: p.x, vary: 0.04 });
    const e = p.pixelToWorld(LAUNCHER_BREECH[0], LAUNCHER_BREECH[1]);
    const fwd = this.forward();
    const v = p.body.linvel();
    this.game.casings.eject(e.x, e.y, v.x - fwd.x * 1.5, v.y - fwd.y * 1.5 + 1.5, 'brass', 4, 3, p.body);
  }

  private setOpen(open: boolean): void {
    if (open === this.open || this.destroyed) return;
    this.open = open;
    this.main.setArt(launcherArt(open));
  }

  /** Lobs the round, if one is in. */
  fire(): void {
    if (!this.loaded || this.destroyed) return;
    const g = this.gun;
    const p = this.main;
    const game = this.game;
    const m = p.pixelToWorld(LAUNCHER_MUZZLE[0] - 3, LAUNCHER_MUZZLE[1]);
    const r = game.spawn(this.round, m.x, m.y, { flip: this.flipped, angle: p.body.rotation() });
    if (!(r instanceof LauncherRound)) return;
    this.loaded = false;
    this.reload = this.reloadTime;
    this.shots++;
    const fwd = this.forward();
    const a = (Math.random() - 0.5) * g.spread;
    const dx = fwd.x * Math.cos(a) - fwd.y * Math.sin(a);
    const dy = fwd.x * Math.sin(a) + fwd.y * Math.cos(a);
    const v = p.body.linvel();
    const own = this.holder ? [...this.parts, ...this.holder.parts] : this.parts;
    r.launch(own, v.x + dx * g.speed, v.y + dy * g.speed, this.mode, blastFor(g.damage));
    if (!p.frozen) p.body.applyImpulseAtPoint({ x: -fwd.x * g.recoil, y: -fwd.y * g.recoil }, this.gripWorld() ?? m, true);
    const ps = game.particles;
    const mz = p.pixelToWorld(LAUNCHER_MUZZLE[0], LAUNCHER_MUZZLE[1]);
    ps.flash(mz.x + fwd.x * 0.1, mz.y + fwd.y * 0.1, g.flash);
    ps.smoke(mz.x + fwd.x * 0.1, mz.y + fwd.y * 0.1, 3, 0.2);
    game.renderer.addLight(mz.x, mz.y, 1.8, 0.5, 0xffd890, 0.06);
    game.sound.gunshot('launcher', mz.x);
    game.renderer.shake(0.05);
    game.alarm(mz.x, mz.y, 16);
  }

  /** Rounds of another fuze: the next one fired goes off as set. */
  setMode(mode: LauncherMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.game.sound.click(this.main.x, 1.2);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.loaded ? 'Fire' : 'Reloading…', hint: 'F', disabled: !this.loaded, action: () => this.fire() }];
    for (const m of MODES) acts.push({ label: `Fuze: ${m.label}`, checked: this.mode === m.mode, action: () => this.setMode(m.mode) });
    if (this.holder) acts.push({ label: 'Drop', action: () => this.holder?.dropItem(this) });
    return acts;
  }

  protected tuning(k: Parameters<Firearm['tuning']>[0]): ReturnType<Firearm['tuning']> {
    const t = super.tuning(k);
    return k === 'rate' ? { ...t, min: 0.4, max: 6 } : t;
  }

  /** Edit gun…: the kick, the round's power and the reload time. */
  editor(): ValueEditor {
    const ed = super.editor();
    const labels: Record<string, string> = { recoil: 'Recoil', damage: 'Power (blast damage)', rate: 'Reload time' };
    ed.fields = ed.fields.filter((f) => f.key in labels).map((f) => ({ ...f, label: labels[f.key] }));
    return ed;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { ...super.serializeExtra() };
    if (this.mode !== 'impact') x.mode = this.mode;
    if (!this.loaded) x.reload = Math.round(this.reload * 10) / 10;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.mode = MODES.find((m) => m.mode === x.mode)?.mode ?? 'impact';
    if (typeof x.reload === 'number') {
      this.loaded = false;
      this.reload = clamp(x.reload, 0, this.reloadTime);
      const k = 1 - this.reload / this.reloadTime;
      this.setOpen(k >= OPEN_AT && k < SHUT_AT);
    } else {
      this.loaded = true;
      this.reload = 0;
      this.setOpen(false);
    }
  }
}

/**
 * A 40 mm grenade from the launcher. It flies nose first in an arc; once it's
 * flown far enough to arm, it goes off on the first thing it touches, or, with
 * a time fuze, bounces about until that runs out. A bullet or a blast sets it off.
 */
export class LauncherRound extends Entity {
  readonly main: Part;
  mode: LauncherMode = 'impact';
  private blast: ExplosionOpts = blastFor(ROUND_BLAST.damage);
  private age = 0;
  private armed = false;
  private flying = false;
  private spent = false;
  private start: V2 | null = null;

  constructor(game: Game, def: ItemDef, art: PixelArt, shapes: ShapeSpec[], density: number, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.main = this.addPart({
      name: 'Grenade', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, shapes, density,
      ccd: true, linearDamping: 0, angularDamping: 0.2, textureKey: def.id, restitution: 0.35,
    });
  }

  launch(own: Part[], vx: number, vy: number, mode: LauncherMode, blast: ExplosionOpts): void {
    const p = this.main;
    p.noCollide = new Set(own);
    p.body.setLinvel({ x: vx, y: vy }, true);
    this.mode = mode;
    this.blast = blast;
    this.flying = true;
    this.start = { x: p.x, y: p.y };
  }

  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    const p = this.main;
    this.age += dt;
    const travelled = this.start ? Math.hypot(p.x - this.start.x, p.y - this.start.y) : Infinity;
    if (!this.armed && this.age > ARM_TIME && travelled > ARM_DIST) this.armed = true;
    if (p.noCollide && (this.age > 1 || travelled > CLEAR)) p.noCollide = null;
    if ((this.mode === 'timed' && this.age > TIME_FUZE) || this.age > MAX_FLIGHT) {
      this.detonate();
      return;
    }
    const v = p.body.linvel();
    // spun as it left the barrel, it flies nose first until it first hits something
    if (this.flying && v.x * v.x + v.y * v.y > 4) {
      p.body.setRotation(Math.atan2(v.y * p.flip, v.x * p.flip), false);
      p.body.setAngvel(0, false);
      if (Math.random() < 0.3) {
        this.game.particles.emit(PK.Smoke, p.x, p.y, {
          vx: (Math.random() - 0.5) * 0.3, vy: 0.2, life: 0.5 + Math.random() * 0.4,
          size: 0.04, size1: 0.18, color: 0xb0aca6, color1: 0x8a8682, alpha: 0.3, alpha1: 0, gravity: -0.02, drag: 1.5,
        });
      }
    }
  }

  /** Touching anything once armed (the floor included), an impact round goes off; any first knock ends its nose-first flight. */
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
    if (!hit) return;
    this.flying = false;
    if (this.mode === 'impact' && this.armed) this.detonate();
  }

  onBullet(): void {
    this.detonate();
  }

  damage(_part: Part, amount: number, kind: DamageKind): void {
    if (kind === 'explosion' || kind === 'shock' || (kind !== 'fire' && amount > 10)) this.detonate();
  }

  detonate(): void {
    if (this.spent || this.destroyed) return;
    this.spent = true;
    const t = this.main.body.translation();
    this.game.explosions.explode(t.x, t.y, { ...this.blast, source: this });
    this.game.remove(this);
  }

  protected serializeExtra(): Record<string, unknown> {
    const { power, radius, damage, shrapnel } = this.blast;
    return { mode: this.mode, age: Math.round(this.age * 10) / 10, armed: this.armed, flying: this.flying, blast: { power, radius, damage, shrapnel } };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.mode = x.mode === 'timed' ? 'timed' : 'impact';
    if (typeof x.age === 'number') this.age = x.age;
    this.armed = x.armed === true;
    this.flying = x.flying === true;
    const b = x.blast as Partial<ExplosionOpts> | undefined;
    if (b && [b.power, b.radius, b.damage].every((v) => typeof v === 'number' && v > 0 && v < Infinity)) {
      this.blast = { power: b.power!, radius: b.radius!, damage: b.damage!, shrapnel: typeof b.shrapnel === 'number' ? b.shrapnel : 0 };
    }
  }
}

import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { clamp, rotate, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
import { isLiving, type Living } from '../systems/Fighting';
import { TEAMS, TEAM_IDS, dress, dye, isTeamId, teamOf, type TeamId } from '../systems/Teams';
import { TURRET, turretHeadArt, type TurretLook } from '../art/machines2';
import type { PixelArt } from '../art/PixelArt';
import type { GunSound } from '../engine/Sound';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import { densityFor } from './Item';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** What a turret is: its look, where it can turn, and its gun. */
export interface TurretSpec {
  base: () => PixelArt;
  baseShapes: ShapeSpec[];
  baseMass: number;
  /** Where its head turns on the base (base art px). */
  pivot: [number, number];
  /** The band of the base painted in its team's colour (art px: x0, y0, x1, y1, ends excluded). */
  band: [number, number, number, number];
  headShapes: ShapeSpec[];
  /** A laser's colour: it burns with a beam (the laser rifle's) rather than firing bullets. */
  laser?: number;
  /** Which way it looks when it has nothing to aim at, and how far either side of that it can turn (radians from the base's facing, up positive). */
  rest: number;
  arc: number;
  /** How far it sees (m). */
  range: number;
  /** Shots a second, harm per shot, and (for bullets) speed, punch through and spread. */
  rate: number;
  damage: number;
  speed?: number;
  energy?: number;
  spread: number;
  sound: GunSound;
}

/** How fast its head turns (rad/s). */
const TURN = 4;
/** How near its aim must be to the target's bearing before it fires (rad). */
const ON_TARGET = 0.07;
/** How often it looks for something to shoot (s). */
const SCAN = 0.12;
/** What its eye sees: anything solid. */
const SIGHT = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.DYNAMIC);

let ray: RAPIER.Ray | null = null;

/**
 * A sentry turret: a gun on a base that turns its head to the nearest living
 * thing within its arc and range it can see, and fires at it until it's dead
 * or gone. On from the start (activate switches it off and on); wired up, it
 * runs only while powered. Set to a team, it spares that team's people and animals.
 */
export class Turret extends Entity {
  readonly base: Part;
  readonly head: Part;
  readonly spec: TurretSpec;
  private joint: RAPIER.RevoluteImpulseJoint;
  /** Switched on (by hand: activate). */
  on = true;
  /** The side it's on: it doesn't shoot them (null: shoots anyone). */
  team: TeamId | null = null;
  /** Where its head points now, and where it wants it (radians from the base's facing, up positive). */
  aim: number;
  private want: number;
  target: Living | null = null;
  /** The target was in sight at the last look. */
  private seen = false;
  private scanT = Math.random() * SCAN;
  private cooldown = 0;
  shots = 0;
  private look: TurretLook = 'idle';
  /** Whether it has wires (worked out again when the wiring changes). */
  private wired = false;
  private wiredAt = -1;

  constructor(game: Game, def: ItemDef, spec: TurretSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.spec = spec;
    this.activatable = true;
    // (power runs it: a pulse switches it, power reaching it doesn't fire it)
    this.usesPower = true;
    this.aim = this.want = spec.rest;
    const ang = opts.angle ?? 0;
    this.base = this.addPart({
      name: 'Base', art: spec.base(), material: MAT.metal, x, y, angle: ang, shapes: spec.baseShapes, textureKey: def.id + ':base', layer: 0,
      density: densityFor(spec.baseMass, spec.baseShapes),
    });
    const art = turretHeadArt('idle', spec.laser !== undefined);
    const f = this.base.flip;
    const pv = this.base.pixelToWorld(spec.pivot[0], spec.pivot[1]);
    const angle = ang + spec.rest * f;
    const hp = TURRET.headPivot;
    const r = rotate((hp[0] + 0.5 - art.w / 2) * f * PX, (art.h / 2 - hp[1] - 0.5) * PX, angle);
    this.head = this.addPart({
      name: 'Head', art, material: MAT.metal, x: pv.x - r.x, y: pv.y - r.y, angle, shapes: spec.headShapes, layer: 1, density: 60,
    });
    const data = RAPIER.JointData.revolute(this.base.pixelToLocal(spec.pivot[0], spec.pivot[1]), this.head.pixelToLocal(hp[0], hp[1]));
    this.joint = this.addJoint(data, this.base, this.head) as RAPIER.RevoluteImpulseJoint;
    this.lockHead();
  }

  /** Runs: switched on, powered if it's wired, and not knocked out by an EMP. */
  get running(): boolean {
    return this.on && (this.powered || !this.isWired()) && !this.game.connections.jammed.has(this);
  }

  private isWired(): boolean {
    const C = this.game.connections;
    if (this.wiredAt !== C.version) {
      this.wiredAt = C.version;
      this.wired = C.wiresOf(this).length > 0;
    }
    return this.wired;
  }

  /** Holds the head at `aim`: the joint's limits close on that angle. */
  private lockHead(): void {
    if (!this.joint.isValid()) return;
    const a = this.aim * this.base.flip;
    this.joint.setLimits(a, a);
  }

  canRest(): boolean {
    return this.aim === this.want && !this.target;
  }

  /** Frozen where it's put (under a ceiling, say): only its base is fixed, so its head still turns. */
  get frozen(): boolean {
    return this.base.frozen;
  }

  setFrozen(on: boolean): void {
    this.base.setFrozen(on);
    this.head.setFrozen(false);
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.base.x, this.on ? 1.2 : 0.8);
    if (!this.on) this.target = null;
  }

  /** The bearing (radians from the base's facing, up positive) of a world point from its pivot. */
  private bearing(x: number, y: number): number {
    const b = this.base;
    const pv = b.pixelToWorld(this.spec.pivot[0], this.spec.pivot[1]);
    const l = rotate(x - pv.x, y - pv.y, -b.body.rotation());
    return Math.atan2(l.y, l.x * b.flip);
  }

  /** How far a bearing is outside its arc (0: inside). */
  private outside(a: number): number {
    let d = a - this.spec.rest;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.max(0, Math.abs(d) - this.spec.arc);
  }

  /** Where to aim at someone: their middle, a little high (the chest of someone standing). */
  private aimPoint(e: Living): V2 {
    const c = e.center();
    return { x: c.x, y: c.y + 0.12 };
  }

  /** Someone it would shoot: alive, not on its side, and not itself. */
  private hostile(e: Entity): e is Living {
    return isLiving(e) && e.alive && !e.destroyed && (this.team === null || teamOf(e) !== this.team);
  }

  /**
   * Can it see `e` from its pivot: the first thing along the way is them (or
   * something they hold)? Its own parts don't count.
   */
  private sees(e: Living, at: V2): boolean {
    const phys = this.game.physics;
    const pv = this.base.pixelToWorld(this.spec.pivot[0], this.spec.pivot[1]);
    const dx = at.x - pv.x;
    const dy = at.y - pv.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    r.origin = pv;
    r.dir = { x: dx / d, y: dy / d };
    const hit = phys.world.castRay(r, d + 0.3, true, undefined, SIGHT, undefined, undefined, (c) => phys.partOf(c)?.entity !== this);
    if (!hit) return true;
    const q = phys.partOf(hit.collider);
    if (!q) return false;
    return q.entity === e || e.attachedEntities().includes(q.entity);
  }

  /** Looks for the nearest living thing it may shoot that's within its arc and range and in sight (the one it has first). */
  private scan(): void {
    const sp = this.spec;
    const bx = this.base.x;
    const by = this.base.y;
    // (the one it has, as long as it's still there to shoot)
    const had = this.target;
    if (had && this.hostile(had) && this.inView(had)) {
      this.seen = true;
      return;
    }
    let best: Living | null = null;
    let bd = Infinity;
    for (const e of this.game.entities) {
      if (e === had || !this.hostile(e)) continue;
      const p0 = e.parts.find((p) => !p.destroyed);
      // (a rough look first: most things are nowhere near)
      if (!p0 || Math.abs(p0.x - bx) > sp.range + 2 || Math.abs(p0.y - by) > sp.range + 2) continue;
      const at = this.aimPoint(e);
      const d = Math.hypot(at.x - bx, at.y - by);
      if (d > sp.range || d >= bd || this.outside(this.bearing(at.x, at.y))) continue;
      if (!this.sees(e, at)) continue;
      bd = d;
      best = e;
    }
    if (best) this.game.sound.play('machine/switch', { gain: 0.3, rate: 1.7, x: bx });
    this.target = best;
    this.seen = !!best;
  }

  /** Within its range and arc, and in sight. */
  private inView(e: Living): boolean {
    const at = this.aimPoint(e);
    return Math.hypot(at.x - this.base.x, at.y - this.base.y) <= this.spec.range && !this.outside(this.bearing(at.x, at.y)) && this.sees(e, at);
  }

  preStep(dt: number): void {
    this.cooldown -= dt;
    const run = this.running;
    if (!run) this.target = null;
    else if ((this.scanT -= dt) <= 0) {
      this.scanT = SCAN;
      this.scan();
    }
    const t = this.target;
    if (t && !this.hostile(t)) this.target = null;
    if (this.target) {
      const at = this.aimPoint(this.target);
      this.want = clamp(this.bearing(at.x, at.y), this.spec.rest - this.spec.arc, this.spec.rest + this.spec.arc);
    } else if (run) this.want = this.spec.rest;
    if (this.aim !== this.want) {
      const d = this.want - this.aim;
      this.aim += Math.sign(d) * Math.min(Math.abs(d), TURN * dt);
      this.lockHead();
      this.base.body.wakeUp();
      this.head.body.wakeUp();
      if (Math.abs(d) > 0.02) this.game.sound.hold(this, 'machine/turret_loop', 0.14, this.head.x, 1.4);
    }
    this.show(!run ? 'off' : this.target ? 'alert' : 'idle');
    if (this.target && this.seen && Math.abs(this.want - this.aim) < ON_TARGET && this.cooldown <= 0) this.fire();
  }

  private show(look: TurretLook): void {
    if (look === this.look || this.destroyed) return;
    this.look = look;
    this.head.setArt(turretHeadArt(look, this.spec.laser !== undefined));
  }

  /** One shot along the barrel: a bullet with its tracer, or the laser's beam. */
  fire(): void {
    const sp = this.spec;
    const h = this.head;
    if (this.cooldown > 0 || this.destroyed || h.destroyed) return;
    const game = this.game;
    this.cooldown = 1 / sp.rate;
    this.shots++;
    const m = h.pixelToWorld(TURRET.muzzle[0], TURRET.muzzle[1]);
    const fwd = h.localDir(h.flip, 0);
    game.alarm(m.x, m.y, sp.laser !== undefined ? 5 : 14);
    if (sp.laser !== undefined) {
      game.projectiles.laser(m.x, m.y, fwd.x, fwd.y, { damage: sp.damage, color: sp.laser, ignore: h.body, range: sp.range + 4 });
      game.particles.flash(m.x, m.y, 0.14, sp.laser, 0.06);
      game.renderer.addLight(m.x, m.y, 1.5, 0.5, sp.laser, 0.08);
      game.sound.gunshot(sp.sound, m.x);
      return;
    }
    const a = (Math.random() - 0.5) * sp.spread;
    const c = Math.cos(a);
    const s = Math.sin(a);
    game.projectiles.fire(m.x, m.y, fwd.x * c - fwd.y * s, fwd.x * s + fwd.y * c, sp.speed ?? 400, {
      energy: sp.energy ?? 400, damage: sp.damage, push: 0.004, ignore: h.body, tracer: true,
    });
    const ps = game.particles;
    ps.flash(m.x + fwd.x * 0.05, m.y + fwd.y * 0.05, 0.14);
    game.renderer.addLight(m.x + fwd.x * 0.2, m.y + fwd.y * 0.2, 1.7, 0.55, 0xffd890, 0.06);
    for (let i = 0; i < 2; i++) {
      ps.emit(PK.Spark, m.x, m.y, {
        vx: fwd.x * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2, vy: fwd.y * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2,
        life: 0.05 + Math.random() * 0.06, color: 0xfff1b0, color1: 0xff8a2a, alpha1: 0.2, gravity: 0, drag: 6,
      });
    }
    if (Math.random() < 0.4) ps.smoke(m.x + fwd.x * 0.08, m.y + fwd.y * 0.08, 1, 0.12);
    const e = h.pixelToWorld(TURRET.eject[0], TURRET.eject[1]);
    const up = { x: -fwd.y * h.flip, y: fwd.x * h.flip };
    const kick = 1.5 + Math.random();
    game.casings.eject(e.x, e.y, -fwd.x * 0.6 + up.x * kick, -fwd.y * 0.6 + up.y * kick, 'brass', 2, 1, h.body);
    game.sound.gunshot(sp.sound, m.x);
  }

  /** Puts it on a side (or none): it spares them, and its band takes their colour. */
  setTeam(team: TeamId | null): void {
    this.team = team;
    const plain = this.spec.base();
    const [x0, y0, x1, y1] = this.spec.band;
    dress(this.base, team ? dye(this.def.id + ':base', plain, team, y0, y1, x0, x1) : plain);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
    acts.push({ label: 'Shoots: everyone', checked: this.team === null, action: () => this.setTeam(null) });
    for (const id of TEAM_IDS) acts.push({ label: `Spares: ${TEAMS[id].name}`, checked: this.team === id, action: () => this.setTeam(id) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (the aim to a few degrees: a guest's copy isn't sent every step of a turn)
    const x: Record<string, unknown> = { on: this.on, aim: Math.round(this.aim * 20) / 20, look: this.look };
    if (this.team) x.team = this.team;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    if (typeof x.aim === 'number' && Number.isFinite(x.aim)) {
      this.aim = this.want = clamp(x.aim, this.spec.rest - this.spec.arc, this.spec.rest + this.spec.arc);
      this.lockHead();
    }
    if (x.look === 'off' || x.look === 'idle' || x.look === 'alert') this.show(x.look);
    const team = isTeamId(x.team) ? x.team : null;
    if (team !== this.team) this.setTeam(team);
  }
}

import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { clamp, rotate, type V2 } from '../engine/math';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
import { isLiving, stillUp } from '../systems/Fighting';
import { blastClear, dye, enemies, isTeamId, isTeamMachine, nearestFoe, onSide, TEAM_IDS, type TeamId } from '../systems/Teams';
import { Car, type CarConfig } from './Car';
import type { PixelArt } from '../art/PixelArt';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { ExplosionOpts } from '../systems/Explosions';
import type { ContextAction, DamageKind, ItemDef, SpawnOptions } from '../world/types';

export interface CannonSpec {
  barrel: () => PixelArt;
  shapes: ShapeSpec[];
  density: number;
  /** Where the barrel pivots: on the hull's art, and on the barrel's (pixels). */
  trunnion: [number, number];
  pivot: [number, number];
  /** Barrel art pixel the shell leaves from. */
  muzzle: [number, number];
  /** Muzzle speed (m/s). */
  speed: number;
  /** Seconds between shots. */
  reload: number;
  /** Kick back on the hull (N*s). */
  recoil: number;
  /** How far the barrel goes down and up (degrees from the hull: the depression is negative). */
  limits: [number, number];
  /** What it fires (makes a Shell). */
  shell: ItemDef;
}

/** Barrel elevations offered in the menu (degrees above the hull), those the gun reaches. */
export const ELEVATIONS = [-5, 0, 5, 10, 20, 35];
/** How fast the barrel swings to an elevation picked in the menu (degrees per second). */
const TRAVERSE = 40;
/** How fast the aim keys raise or lower it (degrees per second): slow enough to lay it to a degree. */
const AIM_RATE = 15;
/** How far the barrel runs back on firing (sprite px) and how long it takes to run out again (s). */
const KICK_PX = 4;
const KICK_T = 0.35;
/**
 * On a side (see command()): how far it looks for an enemy (m), the range it
 * fights from (nearer, it backs off; further, it drives in), and how often it
 * looks about again (s).
 */
const SIGHT = 70;
const NEAR = 12;
const FAR = 40;
const LOOK = 0.4;
/** An enemy behind it this long (s), it turns round. */
const TURN_AFTER = 1.2;
/** How near (degrees) the barrel must be laid to where it should be before it fires. */
const LAID = 0.6;
/** Driven or laid by hand, its crew leave it to whoever does for this long (s). */
const HANDS_OFF = 4;
/** It holds its fire with anyone of its side within this (m) of where the shell would land (its blast's reach, 4.5 m, and a metre and a half more: what it flings). */
const CLEAR_BLAST = 6;
/** Nor does it drive on with one of its own side this near (m) in front of it (or behind, backing up). */
const GIVE_WAY = 3;

/**
 * Its own side a shell (or a missile) is fired past (see Tank.clear()): their
 * parts, how far on (m, across) it has gone by them, and the side: its soldiers'
 * bullets don't meet a round fired for it (see Projectiles.PastOwn).
 */
export interface Passing {
  parts: Part[];
  d: number;
  side?: string;
}

/**
 * A tank: a heavy hull on driven road wheels inside its track, with a cannon on
 * the turret. Use (F) fires an explosive shell, as with a gun, and held down it
 * fires again each time it has reloaded; so do "Fire" in its menu and a pulse
 * down a wire (a button). It drives from its menu ("Drive"), when wired to
 * power, or selected, with the drive keys (see Car.steer()); the aim keys
 * raise and lower the barrel smoothly within the gun's limits, and the menu
 * sets it to a few elevations.
 *
 * Put on a side (Team: in its menu), its crew fight for it: they drive at the
 * nearest enemy they can see to within range, lay the gun on them and fire,
 * past their own side, but holding fire while their own side is near where
 * it would land (see command(), clear()).
 */
export class Tank extends Car {
  readonly barrel: Part;
  readonly gun: CannonSpec;
  /** The elevation it's laid to (from the menu, or with the aim keys), and where the barrel is on its way there (degrees). */
  elevation = 5;
  private aim = 5;
  private joint: RAPIER.RevoluteImpulseJoint;
  private cooldown = 0;
  private kick = 0;
  shots = 0;
  /** The side it fights for (see Teams; null: none). */
  team: TeamId | null = null;
  readonly fightsForTeam = true;
  /** The enemy it's after, on a side. */
  foe: Entity | null = null;
  private lookT = 0;
  /** How long its foe has been behind it, and how much longer the crew leave it to whoever drove it by hand (s). */
  private behindT = 0;
  private handsOff = 0;

  constructor(game: Game, def: ItemDef, cfg: CarConfig, gun: CannonSpec, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.gun = gun;
    this.parkBrake = true;
    const hull = this.body;
    const art = gun.barrel();
    // the barrel hangs from the mantlet at its elevation, behind the turret's face
    const t = hull.pixelToWorld(gun.trunnion[0], gun.trunnion[1]);
    const angle = hull.body.rotation() + this.aimAngle();
    const r = rotate((gun.pivot[0] + 0.5 - art.w / 2) * hull.flip * PX, (art.h / 2 - gun.pivot[1] - 0.5) * PX, angle);
    this.barrel = this.addPart({
      name: 'Barrel', art, material: MAT.metal, x: t.x - r.x, y: t.y - r.y, angle, density: gun.density,
      textureKey: def.id + ':barrel', layer: 0, shapes: gun.shapes, ccd: true,
    });
    const data = RAPIER.JointData.revolute(hull.pixelToLocal(gun.trunnion[0], gun.trunnion[1]), this.barrel.pixelToLocal(gun.pivot[0], gun.pivot[1]));
    this.joint = this.addJoint(data, hull, this.barrel) as RAPIER.RevoluteImpulseJoint;
    this.lockBarrel();
  }

  /** The barrel's turn from the hull's (radians: up is clockwise when facing left). */
  private aimAngle(): number {
    return ((this.aim * Math.PI) / 180) * this.body.flip;
  }

  /** Holds the barrel at `aim`: the joint's limits close on that angle. */
  private lockBarrel(): void {
    if (!this.joint.isValid()) return;
    const a = this.aimAngle();
    this.joint.setLimits(a, a);
  }

  canRest(): boolean {
    return super.canRest() && this.aim === this.elevation && this.kick === 0;
  }

  preStep(dt: number): void {
    this.command(dt);
    super.preStep(dt);
    this.cooldown -= dt;
    // Use held down: the next shell as soon as it has reloaded
    if (this.activeHeld && this.cooldown <= 0) this.fire();
    if (this.kick > 0) {
      // the barrel runs back into the mantlet and eases out again
      this.kick = Math.max(0, this.kick - dt);
      this.barrel.spriteOffset.x = -KICK_PX * (this.kick / KICK_T) ** 2;
    }
    // the aim keys held: the barrel goes up or down as far as the gun goes (a wreck's is stuck)
    if (this.handAim && !this.wrecked) {
      const [lo, hi] = this.gun.limits;
      this.elevation = clamp(this.elevation + this.handAim * AIM_RATE * dt, lo, hi);
    }
    if (this.aim !== this.elevation) {
      const d = this.elevation - this.aim;
      this.aim += Math.sign(d) * Math.min(Math.abs(d), TRAVERSE * dt);
      this.lockBarrel();
      this.body.body.wakeUp();
      this.barrel.body.wakeUp();
      // the elevation drive whirs while it moves
      if (!this.barrel.destroyed) this.game.sound.hold(this, 'machine/turret_loop', 0.16, this.barrel.x);
    }
  }

  /** Fires a shell, once it has reloaded (past its own side in the way: see clear()). */
  fire(past?: Passing): void {
    const b = this.barrel;
    // (a burnt-out wreck's gun is as dead as its engine)
    if (this.cooldown > 0 || this.destroyed || this.wrecked || b.destroyed) return;
    const g = this.gun;
    const game = this.game;
    const m = b.pixelToWorld(g.muzzle[0], g.muzzle[1]);
    const fwd = b.localDir(b.flip, 0);
    const shell = game.spawn(g.shell, m.x, m.y, { flip: this.flipped, angle: b.body.rotation() });
    if (!(shell instanceof Shell)) return;
    this.cooldown = g.reload;
    this.shots++;
    const v = b.body.linvel();
    shell.launch(this, v.x + fwd.x * g.speed, v.y + fwd.y * g.speed, past);
    // the kick goes into the hull through the trunnion
    const hull = this.body;
    if (!hull.frozen) {
      const t = hull.pixelToWorld(g.trunnion[0], g.trunnion[1]);
      hull.body.applyImpulseAtPoint({ x: -fwd.x * g.recoil, y: -fwd.y * g.recoil }, t, true);
    }
    this.kick = KICK_T;
    // muzzle flash, sparks, a cloud of smoke and the bang
    const ps = game.particles;
    ps.flash(m.x + fwd.x * 0.3, m.y + fwd.y * 0.3, 0.8);
    ps.flash(m.x + fwd.x * 0.8, m.y + fwd.y * 0.8, 0.45, 0xffe6a0, 0.08);
    game.renderer.addLight(m.x + fwd.x * 0.5, m.y + fwd.y * 0.5, 6, 0.9, 0xffd890, 0.12);
    for (let i = 0; i < 10; i++) {
      const s = 6 + Math.random() * 10;
      ps.emit(PK.Spark, m.x, m.y, {
        vx: fwd.x * s + (Math.random() - 0.5) * 4, vy: fwd.y * s + (Math.random() - 0.5) * 4,
        life: 0.06 + Math.random() * 0.1, color: 0xfff1b0, color1: 0xff8a2a, alpha1: 0.2, gravity: 0, drag: 5,
      });
    }
    ps.smoke(m.x + fwd.x * 0.3, m.y + fwd.y * 0.3, 8, 0.5);
    game.sound.play('gun/cannon', { gain: 1.1, x: m.x, vary: 0.04 });
    game.sound.play('explosion/small', { gain: 0.35, x: m.x, rate: 0.7 });
    game.renderer.shake(0.3);
    game.alarm(m.x, m.y, 30);
  }

  /**
   * On a side, the crew's part each step: the nearest enemy in sight (looked
   * for a few times a second), driven at to within FAR m or backed off from to
   * NEAR, turned round for if they're behind it; the gun laid to land a shell on
   * them where they'll be by then, and fired once it's laid, reloaded, and none
   * of its side is near where it lands.
   */
  private command(dt: number): void {
    if (this.handsOff > 0) this.handsOff -= dt;
    const b = this.body;
    if (!this.team || this.wrecked || b.destroyed || b.frozen || this.handsOff > 0) {
      if (this.foe) {
        this.foe = null;
        if (this.handsOff <= 0) this.autoDrive(0);
      }
      return;
    }
    const dir = b.flip;
    if ((this.lookT -= dt) <= 0) {
      this.lookT = LOOK * (0.8 + Math.random() * 0.4);
      const t = b.pixelToWorld(this.gun.trunnion[0], this.gun.trunnion[1]);
      this.foe = nearestFoe(this, t.x, t.y, SIGHT, dir);
    }
    const foe = this.foe;
    if (!foe || !this.stillFoe(foe)) {
      if (foe) this.foe = null;
      this.behindT = 0;
      this.autoDrive(0);
      return;
    }
    const c = foe.center();
    const at = { x: c.x, y: c.y + (isLiving(foe) ? 0.1 : 0) };
    // behind it: it stops, and turns round
    if ((at.x - b.x) * dir < -1) {
      this.autoDrive(0);
      this.behindT += dt;
      if (this.behindT > TURN_AFTER && Math.abs(b.vx) < 0.5) this.turnRound();
      return;
    }
    this.behindT = 0;
    const d = Math.abs(at.x - b.x);
    const go = d > FAR ? dir : d < NEAR ? -dir : 0;
    this.autoDrive(go && !this.inTheWay(go) ? go : 0);
    const el = this.solve(at, foe);
    if (el === null) return;
    const [lo, hi] = this.gun.limits;
    this.elevation = clamp(el, lo, hi);
    if (el < lo - LAID || el > hi + LAID || this.cooldown > 0 || Math.abs(this.aim - this.elevation) > 0.3) return;
    // (the barrel itself there: not still swinging from the hull rocking)
    const laid = ((this.barrel.a - b.a) * 180) / Math.PI * dir;
    if (Math.abs(laid - el) > LAID) return;
    const past = this.clear(at, foe);
    if (past) this.fire(past);
  }

  /** Still worth a shell: on another side, up and about (a machine: not a wreck). */
  private stillFoe(e: Entity): boolean {
    if (e.destroyed || !enemies(this, e)) return false;
    return isLiving(e) ? stillUp(e) : !isTeamMachine(e) || !e.wrecked;
  }

  /**
   * The elevation (degrees from the hull) that lands a shell on `at`, led by as
   * far as `foe` goes in the shell's flight; null if a shell can't get there. (Its
   * flight has no drag: the low arc, worked out from the muzzle, which moves as
   * the barrel does.)
   */
  private solve(at: V2, foe: Entity): number | null {
    const b = this.body;
    const g = this.gun;
    const dir = b.flip;
    const grav = Math.max(0, -this.game.gravity);
    const v = g.speed;
    const t = b.pixelToWorld(g.trunnion[0], g.trunnion[1]);
    const len = (g.muzzle[0] - g.pivot[0]) * PX;
    // how fast it's going (its parts, by their weight)
    let fvx = 0;
    let m = 0;
    for (const p of foe.parts) {
      if (p.destroyed || p.frozen) continue;
      fvx += p.vx * p.mass;
      m += p.mass;
    }
    fvx = m > 0 ? fvx / m : 0;
    let up = 0;
    let tx = at.x;
    for (let k = 0; k < 3; k++) {
      const x = (tx - (t.x + Math.cos(up) * len * dir)) * dir;
      const y = at.y - (t.y + Math.sin(up) * len);
      if (x < 0.5) return null;
      if (grav < 0.1) up = Math.atan2(y, x);
      else {
        const v2 = v * v;
        const disc = v2 * v2 - grav * (grav * x * x + 2 * y * v2);
        if (disc < 0) return null;
        up = Math.atan((v2 - Math.sqrt(disc)) / (grav * x));
      }
      tx = at.x + fvx * (x / (v * Math.cos(up)));
    }
    // the world's elevation, less the hull's tilt the way it faces
    return ((up - b.body.rotation() * dir) * 180) / Math.PI;
  }

  /** One of its side just ahead of it the way it would drive (`go`: 1 right, -1 left): it waits for them. */
  private inTheWay(go: number): boolean {
    const b = this.body;
    const half = (b.w * PX) / 2;
    // (and as far again as it takes to stop: heavy, it rolls a long way on its brakes)
    const room = GIVE_WAY + Math.abs(b.vx) * 1.2;
    const own = this.attachedEntities();
    for (const a of onSide(this.game, this.team!)) {
      if (a.e === this || own.includes(a.e)) continue;
      const ahead = (a.x - b.x) * go - half;
      if (ahead > -half && ahead < room && Math.abs(a.y - b.y) < 3) return true;
    }
    return false;
  }

  /**
   * Whether a shell fired as the barrel's laid at `at` would hurt none of its
   * side (but its own riders): none within a blast's reach of where it lands
   * (null: it holds its fire). Those of its side between it and there it's
   * fired past (beside them, as a side-on view can't show: in a line of battle
   * they're all in its way, its own infantry and the tanks ahead of it): what
   * of them it goes through, and for how long. Laid on another side's machine
   * (`foe`), it's fired over the people in the way, whatever their side: tanks
   * fight it out over the heads of the infantry fighting theirs.
   */
  private clear(at: V2, foe: Entity): Passing | null {
    const b = this.barrel;
    const m = b.pixelToWorld(this.gun.muzzle[0], this.gun.muzzle[1]);
    const dir = this.body.flip;
    const reach = (at.x - m.x) * dir;
    const own = this.attachedEntities();
    const past: Passing = { parts: [], d: 0, side: this.team! };
    const over = isTeamMachine(foe);
    // (none of its side by where it lands: there, or on the first of the enemy in the way)
    if (!blastClear(this.game, this.team!, m.x, m.y, at, CLEAR_BLAST, (e) => e === this || own.includes(e), over)) return null;
    for (const side of TEAM_IDS) {
      const mine = side === this.team;
      if (!mine && !over) continue;
      for (const a of onSide(this.game, side)) {
        if (a.e === this || a.e === foe || own.includes(a.e) || (!mine && !isLiving(a.e))) continue;
        const s = (a.x - m.x) * dir;
        if (s < -1 || s > reach + 1) continue;
        // (a tank ahead is long: by its middle and as far again)
        past.d = Math.max(past.d, s + 4);
        for (const e of [a.e, ...a.e.attachedEntities()]) for (const p of e.parts) if (!p.destroyed) past.parts.push(p);
      }
    }
    return past;
  }

  /** Turns round where it stands (made again mirrored, once the step is over), riders, side and all. */
  private turnRound(): void {
    this.behindT = 0;
    const game = this.game;
    game.afterStep(() => {
      if (this.destroyed || this.wrecked || this.body.frozen) return;
      const b = this.body;
      // (dust kicked up off the tracks, and their brakes let off)
      game.particles.smoke(b.x, b.y - 0.6, 6, 0.6);
      game.sound.play('machine/air_release', { gain: 0.3, x: b.x, rate: 0.8 });
      game.flipEntity(this);
    });
  }

  /** Puts it on a side (or none): its crew fight for it (see command()), and a stripe of its colour goes round the turret. */
  setTeam(team: TeamId | null): void {
    this.team = team;
    this.foe = null;
    const band = this.cfg.band;
    this.dressBody(team && band ? dye(this.def.id + ':hull', this.cfg.body(), team, band[1], band[3], band[0], band[2], 0.4) : null);
  }

  /** Driven or laid by hand: the crew leave it be a while. */
  steer(x: number, aim = 0): void {
    super.steer(x, aim);
    if (x || aim) this.handsOff = HANDS_OFF;
  }

  /** Use fires it (driving is in its menu). */
  activate(): void {
    this.fire();
  }

  /** Starts or stops driving (the other vehicles' Use). */
  drive(): void {
    super.activate();
  }

  /** A pulse down a wire (a button) fires it; power drives it, as with the other vehicles. */
  onPulse(): void {
    this.fire();
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    // (the car's first entry, Drive/Stop, isn't on F here: F fires)
    acts[0] = { ...acts[0], hint: undefined, action: () => this.drive() };
    acts.splice(0, 0, { label: 'Fire', hint: 'F', disabled: this.wrecked, action: () => this.fire() });
    // (the aim keys lay it anywhere between: these are a few to pick)
    const [lo, hi] = this.gun.limits;
    for (const d of ELEVATIONS) {
      if (d < lo || d > hi) continue;
      acts.push({ label: `Barrel ${d < 0 ? `−${-d}` : d}°`, checked: Math.abs(this.elevation - d) < 0.05, action: () => {
        this.elevation = d;
        this.handsOff = HANDS_OFF;
      } });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    const x: Record<string, unknown> = { ...super.serializeExtra(), elevation: this.elevation, aim: this.aim };
    if (this.team) x.team = this.team;
    return x;
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    const [lo, hi] = this.gun.limits;
    if (typeof x.elevation === 'number') this.elevation = clamp(x.elevation, lo, hi);
    this.aim = typeof x.aim === 'number' ? clamp(x.aim, lo, hi) : this.elevation;
    this.lockBarrel();
    const team = isTeamId(x.team) ? x.team : null;
    if (team !== this.team) this.setTeam(team);
  }
}

/**
 * A tank shell in flight: a heavy slug under gravity that flies nose first and
 * goes off against the first thing it touches (but not the tank that fired it,
 * which it starts out inside the barrel of).
 */
export class Shell extends Entity {
  readonly main: Part;
  private blast: ExplosionOpts;
  private age = 0;
  private spent = false;
  /** How long (s) it goes through what it's launched past (see launch()). */
  private passT = 0.4;
  /** The side it was fired for, whose soldiers' bullets don't meet it (see Passing). */
  firedFor: string | null = null;

  constructor(game: Game, def: ItemDef, art: PixelArt, shapes: ShapeSpec[], density: number, blast: ExplosionOpts, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.blast = blast;
    this.main = this.addPart({
      name: 'Shell', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, shapes, density,
      ccd: true, linearDamping: 0, angularDamping: 0, textureKey: def.id,
    });
  }

  /**
   * Sends it off at (vx, vy), passing through whatever fired it, and through
   * `past` (its crew's own side it's fired past) till it has gone by them.
   */
  launch(from: Entity, vx: number, vy: number, past?: Passing): void {
    this.main.setNoCollide(past?.parts.length ? [...from.parts, ...past.parts] : from.parts);
    this.passT = Math.max(0.4, past ? past.d / Math.max(1, Math.abs(vx)) : 0);
    this.firedFor = past?.side ?? null;
    this.main.body.setLinvel({ x: vx, y: vy }, true);
  }

  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    const p = this.main;
    this.age += dt;
    // well clear of the barrel (and of its own side it was fired past), it can come down on its own tank (fired straight up)
    if (this.age > this.passT && p.noCollide) p.setNoCollide(null);
    if (this.age > 10) {
      this.detonate();
      return;
    }
    const v = p.body.linvel();
    if (v.x * v.x + v.y * v.y > 1) {
      p.body.setRotation(Math.atan2(v.y * p.flip, v.x * p.flip), false);
      p.moved();
      p.body.setAngvel(0, false);
    }
    if (Math.random() < 0.5) this.game.particles.smoke(p.x, p.y, 1, 0.12);
  }

  /** Touching anything (the floor included) sets it off, however glancing the blow. */
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
    if (!this.spent) this.game.renderer.addLight(this.main.x, this.main.y, 0.8, 0.35, 0xffb060);
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
}

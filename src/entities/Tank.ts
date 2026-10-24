import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import { clamp, rotate } from '../engine/math';
import { Entity } from '../world/Entity';
import { MAT } from '../world/Materials';
import { PK } from '../systems/Particles';
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
 * A tank: a heavy hull on driven road wheels inside its track, with a cannon on
 * the turret. Use (F) fires an explosive shell, as with a gun, and held down it
 * fires again each time it has reloaded; so do "Fire" in its menu and a pulse
 * down a wire (a button). It drives from its menu ("Drive"), when wired to
 * power, or selected, with the drive keys (see Car.steer()); the aim keys
 * raise and lower the barrel smoothly within the gun's limits, and the menu
 * sets it to a few elevations.
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

  /** Fires a shell, once it has reloaded. */
  fire(): void {
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
    shell.launch(this, v.x + fwd.x * g.speed, v.y + fwd.y * g.speed);
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
      acts.push({ label: `Barrel ${d < 0 ? `−${-d}` : d}°`, checked: Math.abs(this.elevation - d) < 0.05, action: () => (this.elevation = d) });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), elevation: this.elevation, aim: this.aim };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    const [lo, hi] = this.gun.limits;
    if (typeof x.elevation === 'number') this.elevation = clamp(x.elevation, lo, hi);
    this.aim = typeof x.aim === 'number' ? clamp(x.aim, lo, hi) : this.elevation;
    this.lockBarrel();
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

  constructor(game: Game, def: ItemDef, art: PixelArt, shapes: ShapeSpec[], density: number, blast: ExplosionOpts, x: number, y: number, opts: SpawnOptions) {
    super(game, def, opts.flip ?? false);
    this.blast = blast;
    this.main = this.addPart({
      name: 'Shell', art, material: MAT.metal, x, y, angle: opts.angle ?? 0, shapes, density,
      ccd: true, linearDamping: 0, angularDamping: 0, textureKey: def.id,
    });
  }

  /** Sends it off at (vx, vy), passing through whatever fired it. */
  launch(from: Entity, vx: number, vy: number): void {
    this.main.noCollide = new Set(from.parts);
    this.main.body.setLinvel({ x: vx, y: vy }, true);
  }

  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    const p = this.main;
    this.age += dt;
    // well clear of the barrel, it can come down on its own tank (fired straight up)
    if (this.age > 0.4 && p.noCollide) p.noCollide = null;
    if (this.age > 10) {
      this.detonate();
      return;
    }
    const v = p.body.linvel();
    if (v.x * v.x + v.y * v.y > 1) {
      p.body.setRotation(Math.atan2(v.y * p.flip, v.x * p.flip), false);
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

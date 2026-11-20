import { PX } from '../engine/constants';
import { PK } from '../systems/Particles';
import { Prop, type PropConfig } from './Prop';
import { launchVolley, Missile } from './Missiles';
import type { Commanded, PilotCommand, PilotWeapon } from '../systems/Piloting';
import type { PixelArt } from '../art/PixelArt';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

// Weapons for what's flown (0.4.0): a heat-seeker pod (the pilot's fire key), a flare
// dispenser (the flares key: heat seekers go for the flares), a bomb bay (the bombs key)
// and its bombs. Guns welded on fire on the pilot's fire key too (see Firearm.pilotFire()).

/** Everything `e` is built into, and whoever rides in it. */
function buildOf(game: Game, e: Entity): Set<Entity> {
  const set = new Set(game.connections.assemblyOf([e]));
  for (const x of [...set]) for (const a of x.attachedEntities()) set.add(a);
  return set;
}

/** A heat-seeker pod's missiles, and how long it takes to load the next (s). */
export const POD = { rounds: 2, reload: 4 };

/**
 * A heat-seeker pod: two air-to-air missiles on a rail. The pilot's fire key (or F)
 * fires one forward: it goes after the hottest thing ahead of it (an engine burning,
 * a jet on afterburner, something on fire), but a flare in its eye pulls it off.
 */
export class HeatSeekerPod extends Prop implements PilotWeapon {
  rounds = POD.rounds;
  private reloadT = 0;
  private held = false;
  private shown = -1;
  private art: (n: number) => PixelArt;
  private round: () => ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (n: number) => PixelArt, round: () => ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.round = round;
    this.activatable = true;
  }

  pilotFire(on: boolean): void {
    if (on && !this.held) this.fire();
    this.held = on;
  }

  /** Fires the next missile, if it has one (it clicks if not). The missile it fired, or null. */
  fire(): Missile | null {
    const p = this.main;
    const g = this.game;
    if (this.destroyed || !this.works || g.net?.guest) return null;
    if (this.rounds <= 0) {
      g.sound.play('gun/dryfire', { gain: 0.4, x: p.x });
      return null;
    }
    const dir = p.localDir(p.flip, 0);
    const at = p.pixelToWorld(16, 8 + (POD.rounds - this.rounds) * 3);
    const own = buildOf(g, this);
    const ownParts = [...own].flatMap((e) => e.parts.filter((q) => !q.destroyed));
    const [m] = launchVolley(g, {
      round: this.round(), version: 'standard', at, dir, inset: 0, flipped: this.flipped, zBase: this.zBase,
      speed: 8, cold: false, guides: [{ kind: 'none' }], own: ownParts, carry: p.velocityAt(at.x, at.y),
    });
    if (!m) return null;
    m.heatSeek = true;
    m.ignore = own;
    this.rounds--;
    this.reloadT = POD.reload;
    g.sound.play('gun/launcher', { gain: 0.6, x: at.x, rate: 1.3, vary: 0.05 });
    return m;
  }

  preStep(dt: number): void {
    if (this.rounds < POD.rounds && (this.reloadT -= dt) <= 0) {
      this.rounds++;
      this.reloadT = POD.reload;
    }
    if (this.rounds !== this.shown && !this.destroyed) {
      this.shown = this.rounds;
      this.main.setArt(this.art(this.rounds));
    }
  }

  activate(): void {
    this.fire();
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${this.rounds} of ${POD.rounds} missiles`, disabled: true, action: () => {} },
      { label: 'Fire', hint: 'F', action: () => this.activate() },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { rounds: this.rounds };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.rounds === 'number' && Number.isFinite(x.rounds)) this.rounds = Math.max(0, Math.min(POD.rounds, Math.round(x.rounds)));
  }
}

/** A flare: how long it burns (s), and how hot it looks to a heat seeker, at first (it fades). */
export const FLARE = { burn: 4, heat: 6000 };

/**
 * A flare: a pellet of magnesium burning white-hot as it falls, far hotter than any
 * engine to a heat seeker's eye (see Missiles.heatOf()). Burnt out, it's gone.
 */
export class Flare extends Prop {
  left = FLARE.burn;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, { ...cfg, linearDamping: 0.6 }, x, y, opts);
  }

  heatSignature(): number {
    return this.left > 0 ? FLARE.heat * (0.4 + 0.6 * (this.left / FLARE.burn)) : 0;
  }

  canRest(): boolean {
    return false;
  }

  preStep(dt: number): void {
    this.left -= dt;
    if (this.left <= 0) {
      if (!this.game.net?.guest) this.game.remove(this);
      return;
    }
    const p = this.main;
    if (Math.random() < 0.7) {
      this.game.particles.emit(PK.Smoke, p.x, p.y, {
        vx: (Math.random() - 0.5) * 0.4, vy: 0.3, life: 1.2, size: 0.08, size1: 0.35, color: 0xffffff, color1: 0xc8c8c8, alpha: 0.6, alpha1: 0, gravity: -0.1, drag: 1.5,
      });
    }
  }

  frame(): void {
    const p = this.main;
    this.game.renderer.addLight(p.x, p.y, 3, 0.9 * Math.min(1, this.left), 0xfff0c0);
  }
}

/** A flare dispenser's flares, how many it throws at once, and how fast. */
export const DISPENSER = { flares: 12, salvo: 2, speed: 9 };

/**
 * A flare dispenser: the pilot's flares key (Caps Lock), or F, throws out a pair of
 * flares behind and below; a heat seeker after the craft goes for them instead. Its
 * menu reloads it.
 */
export class FlareDispenser extends Prop implements Commanded {
  flares = DISPENSER.flares;
  private shown = -1;
  private art: (n: number) => PixelArt;
  private flare: () => ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (n: number) => PixelArt, flare: () => ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.flare = flare;
    this.activatable = true;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'flares') return false;
    this.dispense();
    return true;
  }

  /** Throws out a pair of flares (the flares it threw). */
  dispense(): Flare[] {
    const g = this.game;
    const p = this.main;
    if (this.destroyed || !this.works || g.net?.guest || this.flares <= 0) return [];
    const out: Flare[] = [];
    const back = p.localDir(-p.flip, 0);
    const down = p.localDir(0, -1);
    const own = [...buildOf(g, this)].flatMap((e) => e.parts.filter((q) => !q.destroyed));
    for (let i = 0; i < DISPENSER.salvo && this.flares > 0; i++) {
      this.flares--;
      const spread = (i - (DISPENSER.salvo - 1) / 2) * 0.6;
      const dx = back.x * 0.6 + down.x * 0.8 + down.y * spread;
      const dy = back.y * 0.6 + down.y * 0.8 - down.x * spread;
      const d = Math.hypot(dx, dy) || 1;
      const f = g.spawn(this.flare(), p.x + (dx / d) * 0.3, p.y + (dy / d) * 0.3, {});
      if (!(f instanceof Flare)) continue;
      f.main.setNoCollide(own);
      const v = p.velocityAt(p.x, p.y);
      f.main.body.setLinvel({ x: v.x + (dx / d) * DISPENSER.speed, y: v.y + (dy / d) * DISPENSER.speed }, true);
      out.push(f);
    }
    if (out.length) {
      g.sound.play('gun/launcher', { gain: 0.3, x: p.x, rate: 2.2, vary: 0.08 });
      g.particles.flash(p.x, p.y, 0.4);
    }
    return out;
  }

  preStep(): void {
    const k = Math.ceil((this.flares / DISPENSER.flares) * 6);
    if (k !== this.shown && !this.destroyed) {
      this.shown = k;
      this.main.setArt(this.art(k));
    }
  }

  activate(): void {
    this.dispense();
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${this.flares} flares`, disabled: true, action: () => {} },
      { label: 'Throw flares', hint: 'F', action: () => this.activate() },
      { label: 'Reload', action: () => (this.flares = DISPENSER.flares) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { flares: this.flares };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.flares === 'number' && Number.isFinite(x.flares)) this.flares = Math.max(0, Math.min(DISPENSER.flares, Math.round(x.flares)));
  }
}

/** An aerial bomb's blast, and how long after it's dropped it arms (s). */
export const AERIAL_BOMB = { power: 220, radius: 7, damage: 420, shrapnel: 8, arm: 0.5 };

/**
 * An aerial bomb: dropped (from a bomb bay, or let go of), half a second on it's armed,
 * and it goes off against the first thing it hits hard; on its fins it falls nose down.
 */
export class AerialBomb extends Prop {
  armT = AERIAL_BOMB.arm;
  /** Armed only once it's been dropped (from a bay, or thrown): set down by hand it's safe. */
  live = false;
  private gone = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
  }

  /** Dropped: it arms after a moment. */
  drop(): void {
    this.live = true;
    this.armT = AERIAL_BOMB.arm;
  }

  preStep(dt: number): void {
    const p = this.main;
    // (let go of high up: falling fast, it's live)
    if (!this.live && Math.hypot(p.vx, p.vy) > 12) this.drop();
    if (this.live && this.armT > 0) this.armT -= dt;
    // its fins: turned nose first into the way it's falling
    const v = Math.hypot(p.vx, p.vy);
    if (v > 4 && !p.frozen) {
      const want = Math.atan2(p.vy, p.vx) - (p.flip < 0 ? Math.PI : 0);
      let d = want - p.bodyAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.body.setAngvel(p.av + (d * 6 - p.av) * Math.min(1, dt * 4), true);
    }
  }

  onImpact(info: ImpactInfo): void {
    super.onImpact(info);
    if (this.live && this.armT <= 0 && info.speed > 4) this.detonate();
  }

  detonate(): void {
    if (this.gone || this.destroyed || this.game.net?.guest) return;
    this.gone = true;
    const p = this.main;
    const b = AERIAL_BOMB;
    this.game.explosions.explode(p.x, p.y, { power: b.power, radius: b.radius, damage: b.damage, shrapnel: b.shrapnel, source: this });
    this.game.remove(this);
  }

  activate(): void {
    this.detonate();
  }

  contextActions(): ContextAction[] {
    return [{ label: 'Detonate now', danger: true, action: () => this.detonate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    return this.live ? { live: true, armT: this.armT } : {};
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.live = x.live === true;
    if (typeof x.armT === 'number' && Number.isFinite(x.armT)) this.armT = Math.max(0, x.armT);
  }
}

/** A bomb bay's bombs, and how long its doors stay open after one drops (s). */
export const BAY = { bombs: 4, open: 0.8, gap: 0.35 };

/**
 * A bomb bay: built into the belly of a plane, the pilot's bombs key (0), or F, opens
 * its doors and drops a bomb (four in it). Its menu loads it again.
 */
export class BombBay extends Prop implements Commanded {
  bombs = BAY.bombs;
  private openT = 0;
  private gapT = 0;
  private shown: boolean | null = null;
  private art: (open: boolean) => PixelArt;
  private bomb: () => ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (open: boolean) => PixelArt, bomb: () => ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.bomb = bomb;
    this.activatable = true;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'bombs') return false;
    this.release();
    return true;
  }

  /** Drops a bomb out of its doors (the bomb dropped, or null: none left, or too soon after the last). */
  release(): AerialBomb | null {
    const g = this.game;
    const p = this.main;
    if (this.destroyed || !this.works || g.net?.guest || this.gapT > 0) return null;
    if (this.bombs <= 0) {
      g.sound.play('gun/dryfire', { gain: 0.4, x: p.x });
      return null;
    }
    const at = p.pixelToWorld(15, 13);
    const own = [...buildOf(g, this)].flatMap((e) => e.parts.filter((q) => !q.destroyed));
    const b = g.spawn(this.bomb(), at.x, at.y - 5 * PX, { flip: this.flipped, angle: p.bodyAngle });
    if (!(b instanceof AerialBomb)) return null;
    this.bombs--;
    this.openT = BAY.open;
    this.gapT = BAY.gap;
    b.main.setNoCollide(own);
    const v = p.velocityAt(at.x, at.y);
    b.main.body.setLinvel({ x: v.x, y: v.y - 1 }, true);
    b.drop();
    g.sound.play('machine/rope_snap', { gain: 0.3, x: p.x, rate: 0.7 });
    return b;
  }

  preStep(dt: number): void {
    if (this.openT > 0) this.openT -= dt;
    if (this.gapT > 0) this.gapT -= dt;
    const open = this.openT > 0;
    if (open !== this.shown && !this.destroyed) {
      this.shown = open;
      this.main.setArt(this.art(open));
    }
  }

  activate(): void {
    this.release();
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${this.bombs} of ${BAY.bombs} bombs`, disabled: true, action: () => {} },
      { label: 'Drop a bomb', hint: 'F', action: () => this.activate() },
      { label: 'Load it', action: () => (this.bombs = BAY.bombs) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { bombs: this.bombs };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.bombs === 'number' && Number.isFinite(x.bombs)) this.bombs = Math.max(0, Math.min(BAY.bombs, Math.round(x.bombs)));
  }
}

/** A rotary cannon's rounds, its rate at full spin (rounds a second), and how long it takes to spin up and down (s). */
export const ROTARY_GUN = { rounds: 500, rate: 100, spinUp: 0.35, spinDown: 1.4, speed: 1050, damage: 70, energy: 9000, recoil: 6 };

/**
 * A rotary cannon (0.5.0: an M61 Vulcan's build, six barrels of 20 mm): held F, or the
 * pilot's fire key built into a plane, spins its barrels up (a moment) and then it
 * fires a hundred rounds a second, a stream of tracer, shoving back on what it's
 * welded to. Let go and it spins down. Its menu loads it again.
 */
export class RotaryCannon extends Prop implements PilotWeapon {
  rounds = ROTARY_GUN.rounds;
  /** How fast its barrels turn (0 to 1), and how long to its next round (s). */
  spin = 0;
  private pilot = false;
  private next = 0;
  private turn = 0;
  private shown = -1;
  private readonly art: (turn: number) => PixelArt;
  private readonly muzzle: [number, number];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (turn: number) => PixelArt, muzzle: [number, number], x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.muzzle = muzzle;
    this.activatable = true;
  }

  pilotFire(on: boolean): void {
    this.pilot = on;
  }

  /** (F held fires it: see setActiveHeld().) */
  activate(): void {}

  canRest(): boolean {
    return this.spin <= 0;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    const g = this.game;
    const want = (this.activeHeld || this.pilot) && this.works && !this.destroyed;
    this.spin = want ? Math.min(1, this.spin + dt / ROTARY_GUN.spinUp) : Math.max(0, this.spin - dt / ROTARY_GUN.spinDown);
    if (this.spin > 0) {
      this.turn = (this.turn + this.spin * 30 * dt) % 3;
      const k = Math.floor(this.turn);
      if (k !== this.shown && !this.destroyed) {
        this.shown = k;
        this.main.setArt(this.art(k));
      }
      g.sound.hold(this, 'machine/motor_loop', 0.25 * this.spin, this.main.x, 0.8 + this.spin * 1.4);
    }
    if (!want || this.spin < 0.95 || g.net?.guest) {
      this.next = 0;
      return;
    }
    if (this.rounds <= 0) {
      if (this.next <= 0) g.sound.play('gun/dryfire', { gain: 0.3, x: this.main.x });
      this.next = 0.3;
      return;
    }
    this.next -= dt;
    const p = this.main;
    let shot = false;
    while (this.next <= 0 && this.rounds > 0) {
      this.next += 1 / ROTARY_GUN.rate;
      this.rounds--;
      shot = true;
      const m = p.pixelToWorld(this.muzzle[0], this.muzzle[1]);
      const fwd = p.localDir(p.flip, 0);
      const s = (Math.random() - 0.5) * 0.014;
      const dx = fwd.x * Math.cos(s) - fwd.y * Math.sin(s);
      const dy = fwd.x * Math.sin(s) + fwd.y * Math.cos(s);
      const v = p.velocityAt(m.x, m.y);
      const vx = dx * ROTARY_GUN.speed + v.x;
      const vy = dy * ROTARY_GUN.speed + v.y;
      const sp = Math.hypot(vx, vy);
      g.projectiles.fire(m.x + fwd.x * 0.1, m.y + fwd.y * 0.1, vx / sp, vy / sp, sp, { energy: ROTARY_GUN.energy, damage: ROTARY_GUN.damage, push: 0.006, ignore: p.body, tracer: true });
      p.body.applyImpulse({ x: -fwd.x * ROTARY_GUN.recoil, y: -fwd.y * ROTARY_GUN.recoil }, true);
      g.particles.flash(m.x + fwd.x * 0.15, m.y + fwd.y * 0.15, 0.25);
      if (Math.random() < 0.25) g.particles.smoke(m.x, m.y, 1, 0.25);
    }
    if (shot) {
      const m = p.pixelToWorld(this.muzzle[0], this.muzzle[1]);
      g.renderer.addLight(m.x, m.y, 2, 0.55, 0xffd890, 0.05);
      g.sound.gunshot('minigun', m.x);
      g.alarm(m.x, m.y, 30);
    }
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${this.rounds} of ${ROTARY_GUN.rounds} rounds`, disabled: true, action: () => {} },
      { label: 'Fire: hold F (or the pilot’s fire key)', disabled: true, action: () => {} },
      { label: 'Load it', action: () => (this.rounds = ROTARY_GUN.rounds) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { rounds: this.rounds };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.rounds === 'number' && Number.isFinite(x.rounds)) this.rounds = Math.max(0, Math.min(ROTARY_GUN.rounds, Math.round(x.rounds)));
  }
}

/** The rockets each launcher (a pod, an aircraft) has fired in the last moment (see launchRocket()). */
const recentRockets = new WeakMap<Entity, Missile[]>();

/** A rocket pod's rockets, how fast held F ripples them off (a second), and how fast they leave the tube (m/s). */
export const POD_ROCKETS = { rounds: 19, ripple: 8, launch: 30 };

/**
 * An unguided rocket pod (0.5.0: a LAU-61's build, nineteen 70 mm rockets): F, or the
 * pilot's rockets key (9) built into a plane, fires one straight ahead (held F ripples
 * them off); each flies on its motor for a second, falling a little, and goes off on
 * what it hits. Its menu loads it again.
 */
export class RocketPod extends Prop implements Commanded {
  rounds = POD_ROCKETS.rounds;
  private gap = 0;
  private shown = -1;
  private readonly art: (rows: number) => PixelArt;
  private readonly round: () => ItemDef;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (rows: number) => PixelArt, round: () => ItemDef, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.round = round;
    this.activatable = true;
  }

  pilotCommand(cmd: PilotCommand): boolean {
    if (cmd !== 'rockets' || this.rounds <= 0) return false;
    return !!this.fire();
  }

  activate(): void {
    this.fire();
  }

  /** Fires the next rocket straight ahead (none left: it clicks). The rocket, or null. */
  fire(): Missile | null {
    const g = this.game;
    const p = this.main;
    if (this.destroyed || !this.works || g.net?.guest || this.gap > 0) return null;
    if (this.rounds <= 0) {
      g.sound.play('gun/dryfire', { gain: 0.4, x: p.x });
      return null;
    }
    const row = (POD_ROCKETS.rounds - this.rounds) % 3;
    const at = p.pixelToWorld(38, 5 + row * 3);
    const own = [...buildOf(g, this)].flatMap((e) => e.parts.filter((q) => !q.destroyed));
    const m = launchRocket(g, this, this.round(), at, p.localDir(p.flip, 0), this.flipped, this.zBase, own, p.velocityAt(at.x, at.y));
    if (!m) return null;
    this.rounds--;
    this.gap = 1 / POD_ROCKETS.ripple;
    return m;
  }

  preStep(dt: number): void {
    super.preStep(dt);
    if (this.gap > 0) this.gap -= dt;
    if (this.activeHeld && this.gap <= 0 && this.rounds > 0) this.fire();
    const rows = Math.min(3, this.rounds);
    if (rows !== this.shown && !this.destroyed) {
      this.shown = rows;
      this.main.setArt(this.art(rows));
    }
  }

  contextActions(): ContextAction[] {
    return [
      { label: `${this.rounds} of ${POD_ROCKETS.rounds} rockets`, disabled: true, action: () => {} },
      { label: 'Fire a rocket', hint: 'F', action: () => this.activate() },
      { label: 'Load it', action: () => (this.rounds = POD_ROCKETS.rounds) },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { rounds: this.rounds };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.rounds === 'number' && Number.isFinite(x.rounds)) this.rounds = Math.max(0, Math.min(POD_ROCKETS.rounds, Math.round(x.rounds)));
  }
}

/**
 * Fires an unguided rocket (`round`) from `at` along `dir`, its tail in the tube, passing
 * through `own` (what fired it), carried on at `carry`: a rocket pod's, a warbird's.
 */
export function launchRocket(g: Game, from: Entity, round: ItemDef, at: { x: number; y: number }, dir: { x: number; y: number }, flipped: boolean, zBase: number, own: import('../world/Part').Part[], carry: { x: number; y: number }): Missile | null {
  const s = (Math.random() - 0.5) * 0.02;
  const h = Math.atan2(dir.y, dir.x) + s;
  const m = g.spawn(round, at.x, at.y, { flip: flipped, angle: flipped ? h - Math.PI : h });
  if (!(m instanceof Missile)) return null;
  m.zBase = zBase - 0.01;
  for (const q of m.parts) q.updateZ();
  // (rippled off one after another, they pass through each other: those still near the rail)
  const before = (recentRockets.get(from) ?? []).filter((r) => !r.destroyed && r.age < 1);
  recentRockets.set(from, [...before, m]);
  m.launch([...own, ...before.map((r) => r.main)], h, POD_ROCKETS.launch, false, { kind: 'none' }, carry);
  g.sound.play('gun/launcher', { gain: 0.5, x: at.x, rate: 1.5, vary: 0.08 });
  g.particles.smoke(at.x, at.y, 2, 0.2);
  return m;
}

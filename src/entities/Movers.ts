import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import { Appliance } from './Appliance';
import { BELT_FRAMES, WINCH_FRAMES } from '../art/machines2';
import type { PixelArt } from '../art/PixelArt';
import type { Part } from '../world/Part';
import type { Connection } from '../systems/Connections';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** What a launch platform throws: things on it, not the floor. */
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);

/** The strengths a launch platform can be set to: the speed (m/s) it throws things up at. */
export const LAUNCH_SPEEDS: { name: string; v: number }[] = [
  { name: 'Low', v: 6 },
  { name: 'Medium', v: 10 },
  { name: 'High', v: 15 },
  { name: 'Huge', v: 22 },
];

/** Seconds its plate stays up after a launch, and before it can launch again. */
const UP_T = 0.25;
const COOL = 0.4;

let plateBox: RAPIER.Cuboid | null = null;

/**
 * A launch platform: activated (or pulsed, or reached by power) its plate
 * springs up and throws whatever is on it straight up off it, at the speed its
 * strength is set to (everything joined to what's on it goes too, so a person
 * flies up whole, not just their feet).
 */
export class LaunchPad extends Prop {
  /** The speed (m/s) it throws things up at. */
  strength = 10;
  private cool = 0;
  private upT = 0;
  private art: (up: boolean) => PixelArt;
  /** Things thrown so far (for tests). */
  launched = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (up: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.art = art;
  }

  activate(): void {
    this.launch();
  }

  preStep(dt: number): void {
    this.cool -= dt;
    if (this.upT > 0 && (this.upT -= dt) <= 0) this.main.setArt(this.art(false));
  }

  /** What's lying on its plate: the things touching the strip just above it. */
  private onTop(): Set<Entity> {
    const p = this.main;
    const phys = this.game.physics;
    const found = new Set<Entity>();
    const box = (plateBox ??= new RAPIER.Cuboid(1, 1));
    box.halfExtents = { x: (p.w / 2) * PX, y: 3.5 * PX };
    // (from 3 px above the plate down into its top)
    phys.world.intersectionsWithShape(p.pixelToWorld(p.w / 2 - 0.5, 0), p.body.rotation(), box, (c) => {
      const q = phys.partOf(c);
      if (q && !q.destroyed && !q.frozen && q.entity !== this) found.add(q.entity);
      return true;
    }, undefined, THINGS);
    return found;
  }

  /** Springs the plate: what's on it goes up at its strength. */
  launch(): void {
    if (this.cool > 0 || this.destroyed) return;
    this.cool = COOL;
    this.upT = UP_T;
    const p = this.main;
    p.setArt(this.art(true));
    const game = this.game;
    game.sound.play('machine/air_release', { gain: 0.5, x: p.x, rate: 1.3 });
    game.sound.impact('metal', 0.6, p.x);
    const up = p.localDir(0, 1);
    for (const side of [-1, 1]) {
      const w = p.pixelToWorld(side < 0 ? 2 : p.w - 3, 4);
      game.particles.smoke(w.x, w.y, 2, 0.15);
    }
    const on = this.onTop();
    if (!on.size) return;
    // everything joined to what's on it, but not what the platform itself is built into
    const own = new Set(game.connections.assemblyOf([this]));
    for (const e of game.connections.assemblyOf(on)) {
      if (own.has(e)) continue;
      this.launched++;
      for (const q of e.parts) {
        if (q.destroyed || q.frozen) continue;
        const v = q.body.linvel();
        const dv = Math.max(0, this.strength - (v.x * up.x + v.y * up.y));
        q.body.setLinvel({ x: v.x + up.x * dv, y: v.y + up.y * dv }, true);
      }
    }
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [{ label: 'Launch', hint: 'F', action: () => this.launch() }];
    for (const s of LAUNCH_SPEEDS) acts.push({ label: `Strength: ${s.name}`, checked: this.strength === s.v, action: () => (this.strength = s.v) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (its plate up or down: a guest's copy shows it springing)
    return { strength: this.strength, up: this.upT > 0 };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    const s = LAUNCH_SPEEDS.find((l) => l.v === x.strength);
    if (s) this.strength = s.v;
    const up = x.up === true;
    if (up !== this.upT > 0) {
      this.upT = up ? UP_T : 0;
      this.main.setArt(this.art(up));
    }
  }
}

// ------------------------------------------------------------------ conveyor belt

/** The speeds a conveyor belt can be set to (m/s). */
export const BELT_SPEEDS = [0.5, 1, 2, 4];
/** How often it looks for what's on it (s); it carries them every step. */
const BELT_LOOK = 0.1;
/**
 * The most it speeds up or slows down what's on it (m/s²): well over what that
 * thing's own rub on the belt takes off it each step, so it keeps up with the belt.
 */
const BELT_GRIP = 25;

let beltBox: RAPIER.Cuboid | null = null;

/**
 * A conveyor belt: while powered (and switched on), it carries whatever lies on
 * its top along at its speed, forward or (reversed, in its menu) back.
 */
export class Conveyor extends Appliance {
  speed = 1;
  /** Runs the way it faces (1), or back (-1). */
  dir = 1;
  private riders: Part[] = [];
  private lookT = 0;
  private phase = 0;
  private shown = 0;
  private art: (frame: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (frame: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  protected changed(on: boolean): void {
    if (!on) this.riders.length = 0;
  }

  /** What lies on its top: the parts touching the strip just above it. */
  private gather(): void {
    const p = this.main;
    const phys = this.game.physics;
    this.riders.length = 0;
    const box = (beltBox ??= new RAPIER.Cuboid(1, 1));
    box.halfExtents = { x: (p.w / 2 - 2) * PX, y: 2.5 * PX };
    phys.world.intersectionsWithShape(p.pixelToWorld(p.w / 2 - 0.5, -1), p.body.rotation(), box, (c) => {
      const q = phys.partOf(c);
      if (q && !q.destroyed && !q.frozen && q.entity !== this && !this.riders.includes(q)) this.riders.push(q);
      return true;
    }, undefined, THINGS);
  }

  protected run(dt: number): void {
    if ((this.lookT -= dt) <= 0) {
      this.lookT = BELT_LOOK;
      this.gather();
    }
    const p = this.main;
    // along its top, the way it runs (the belt's own motion carried with it, if it moves)
    const t = p.localDir(p.flip * this.dir, 0);
    const bv = p.body.linvel();
    const most = BELT_GRIP * dt;
    for (const q of this.riders) {
      if (q.destroyed || q.frozen) continue;
      const v = q.body.linvel();
      const along = (v.x - bv.x) * t.x + (v.y - bv.y) * t.y;
      const dv = Math.max(-most, Math.min(most, this.speed - along));
      if (Math.abs(dv) < 1e-4) continue;
      q.body.setLinvel({ x: v.x + t.x * dv, y: v.y + t.y * dv }, true);
    }
    this.game.sound.hold(this, 'machine/motor_loop', 0.1, p.x, 0.55 + 0.12 * this.speed);
  }

  /** The ribs on its top run along (on every screen). */
  frame(dt: number): void {
    if (!this.live || this.destroyed) return;
    // (2 px a frame, so a fast belt's frames would blur: it's shown no faster than this)
    this.phase += dt * Math.min(this.speed * 16, 18) * this.dir;
    const f = ((Math.floor(this.phase) % BELT_FRAMES) + BELT_FRAMES) % BELT_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(this.art(f));
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    for (const s of BELT_SPEEDS) acts.push({ label: `Speed ${s} m/s`, checked: this.speed === s, action: () => (this.speed = s) });
    acts.push({ label: 'Reversed', checked: this.dir < 0, action: () => (this.dir = -this.dir) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), speed: this.speed, dir: this.dir };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (BELT_SPEEDS.includes(x.speed as number)) this.speed = x.speed as number;
    this.dir = x.dir === -1 ? -1 : 1;
  }
}

// ------------------------------------------------------------------ winch

/** The speeds a winch can reel at (m/s). */
export const WINCH_SPEEDS = [0.25, 0.5, 1, 2];
/** The shortest and longest it reels a rope to (m). */
const WINCH_MIN = 0.3;
const WINCH_MAX = 40;
/** How often it changes its ropes' length (s): each change re-makes the rope's joint. */
const WINCH_T = 0.1;
/**
 * How far past its length a rope may be pulled before the winch stops reeling
 * in (what it's tied to won't come). A heavy load hangs a little past it anyway,
 * more so on the long step; short of what snaps a rope (0.6 m).
 */
const WINCH_SLACK = 0.4;

/**
 * A winch: while powered (and switched on), it reels in (or, set so in its
 * menu, pays out) the ropes tied to it. Reeling in, it stalls while what's on
 * the end won't come.
 */
export class Winch extends Appliance {
  speed = 0.5;
  /** Reels in (1) or pays out (-1). */
  dir = 1;
  private reelT = 0;
  private turning = false;
  private phase = 0;
  private shown = 0;
  private art: (frame: number) => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (frame: number) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
  }

  /** The ropes tied to it. */
  ropes(): Connection[] {
    return this.game.connections.list.filter((c) => c.kind === 'rope' && (c.a.entity === this || c.b?.entity === this));
  }

  protected changed(on: boolean): void {
    if (!on) this.turning = false;
  }

  protected run(dt: number): void {
    if (this.turning) this.game.sound.hold(this, 'machine/motor_loop', 0.16, this.main.x, 0.5 + 0.2 * this.speed);
    if ((this.reelT -= dt) > 0) return;
    this.reelT = WINCH_T;
    const C = this.game.connections;
    const d = this.speed * WINCH_T;
    let turned = false;
    for (const c of this.ropes()) {
      if (this.dir > 0) {
        if (c.rest <= WINCH_MIN) continue;
        const a = c.a.localToWorld(c.la.x, c.la.y);
        const b = c.b ? c.b.localToWorld(c.lb.x, c.lb.y) : c.lb;
        if (Math.hypot(b.x - a.x, b.y - a.y) > c.rest + WINCH_SLACK) continue;
        C.setRest(c, Math.max(WINCH_MIN, c.rest - d));
      } else {
        if (c.rest >= WINCH_MAX) continue;
        C.setRest(c, Math.min(WINCH_MAX, c.rest + d));
      }
      turned = true;
    }
    this.turning = turned;
  }

  /** Its drum turns while it reels (on every screen). */
  frame(dt: number): void {
    if (!this.live || !this.turning || this.destroyed) return;
    this.phase += dt * (6 + 8 * this.speed) * this.dir;
    const f = ((Math.floor(this.phase) % WINCH_FRAMES) + WINCH_FRAMES) % WINCH_FRAMES;
    if (f === this.shown) return;
    this.shown = f;
    this.main.setArt(this.art(f));
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    acts.push({ label: 'Reels in', checked: this.dir > 0, action: () => (this.dir = 1) });
    acts.push({ label: 'Pays out', checked: this.dir < 0, action: () => (this.dir = -1) });
    for (const s of WINCH_SPEEDS) acts.push({ label: `Speed ${s} m/s`, checked: this.speed === s, action: () => (this.speed = s) });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    // (whether its drum turns: a guest's copy turns it too)
    return { ...super.serializeExtra(), speed: this.speed, dir: this.dir, turning: this.turning };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    if (WINCH_SPEEDS.includes(x.speed as number)) this.speed = x.speed as number;
    this.dir = x.dir === -1 ? -1 : 1;
    this.turning = x.turning === true;
  }
}

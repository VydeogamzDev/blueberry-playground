import { RAPIER } from '../engine/Physics';
import { GROUP, PX, groups } from '../engine/constants';
import { Prop, type PropConfig } from './Prop';
import { toggleRun, type HandSwitched } from './Machines';
import { PK } from '../systems/Particles';
import { jetEngineArt, JET_INTAKE, JET_NOZZLE } from '../art/floats';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** The throttle settings, as shares of its own push (the context menu's). */
export const JET_THROTTLES = [0.25, 0.5, 1, 2];
/** Its push (N) at full spool, at the usual throttle: it carries a car, or a few people. */
export const JET_FORCE = 9000;
/** How long (s) it takes to spool up from still to full, and to wind down again. */
const SPOOL_UP = 2.5;
const SPOOL_DOWN = 4;
/** How fast (m/s, along its push) it no longer pushes. */
const JET_TOP = 60;
/** Its exhaust: how fast it leaves at full spool (m/s), how far it reaches (m), how wide it spreads (half the angle, rad). */
const BLAST = 45;
const BLAST_REACH = 8;
const BLAST_SPREAD = 0.3;
/** Its intake's draw: how fast the air goes in at full spool (m/s), and from how far. */
const DRAW = 14;
const DRAW_REACH = 2.5;
const DRAW_SPREAD = 0.6;
/** Push (N) per metre of a thing's breadth per m/s of wind past it (as a fan's). */
const PUSH = 45;
/** How near the nozzle the exhaust burns (m), and its heat there at full spool (as a fire's: see Fire.warm()). */
const HOT_REACH = 2.2;
const HOT = 5;
/** How near its intake (m) things are pulled into the fan and torn up. */
const MAW = 0.35;
/** How often it looks for what's in its blast and its draw, and what its fan has caught (s). */
const LOOK_T = 0.1;

/** What acts on things: not the floor and walls. */
const THINGS = groups(GROUP.DEBRIS, GROUP.DYNAMIC);
/** The floor and walls only (its blast doesn't go through them). */
const WALLS = groups(GROUP.DEBRIS, GROUP.STATIC);

let lookBox: RAPIER.Cuboid | null = null;
let ray: RAPIER.Ray | null = null;

/** Something in its blast or its draw. */
interface Caught {
  part: Part;
  /** Its breadth across the wind (m). */
  breadth: number;
  /** In the draw in front, not the blast behind. */
  front: boolean;
}

/**
 * A jet engine: switched on (or powered) it spools up over a couple of seconds
 * to a mighty push along its facing (its intake's way), and winds down slowly
 * when switched off. Its exhaust blows things far away behind it and sets
 * them alight close up; its intake draws things in, and what reaches its fan
 * is torn up. Weld it to something to fly it.
 */
export class JetEngine extends Prop implements HandSwitched {
  on = false;
  heldOff = false;
  /** Its throttle, as a share of its own push (see JET_THROTTLES). */
  throttle = 1;
  /** How far it's spooled up (0 to 1). */
  spool = 0;
  private caught: Caught[] = [];
  private lookT = 0;
  private glow = 0;
  /** Its own assembly (what it's fixed to): its blast doesn't blow that. */
  private own = new Set<Entity>();

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
  }

  get running(): boolean {
    return (this.on || this.powered) && !this.heldOff;
  }

  activate(): void {
    toggleRun(this, this.running, this.powered);
    this.game.sound.click(this.main.x, 0.8);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
  }

  canRest(): boolean {
    return this.spool === 0;
  }

  /** Its push along its facing (a unit vector): toward its intake. */
  forward(): { x: number; y: number } {
    return this.main.localDir(this.main.flip, 0);
  }

  /** Its push now, as a share of its full push at the usual throttle. */
  get power(): number {
    return this.spool * this.spool * this.throttle;
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    const up = this.running;
    this.spool = up ? Math.min(1, this.spool + dt / SPOOL_UP) : Math.max(0, this.spool - dt / SPOOL_DOWN);
    if (this.spool === 0) {
      this.caught.length = 0;
      return;
    }
    const p = this.main;
    const f = this.forward();
    const k = this.power;
    if (!p.frozen && k > 0) {
      const v = p.body.linvel();
      const push = JET_FORCE * k * Math.min(1, Math.max(0, 1 - (v.x * f.x + v.y * f.y) / JET_TOP));
      p.body.applyImpulse({ x: f.x * push * dt, y: f.y * push * dt }, true);
    }
    if ((this.lookT -= dt) <= 0) {
      this.lookT = LOOK_T;
      this.look();
      this.maw();
    }
    this.blow(dt, f, k);
    this.exhaust(f, k);
    const s = this.spool;
    this.game.sound.hold(this, 'machine/jet_whine_loop', 0.08 + 0.3 * s, p.x, 0.55 + 0.6 * s);
    if (s > 0.3) this.game.sound.hold(this, 'machine/jet_roar_loop', 0.7 * Math.min(1, k) * ((s - 0.3) / 0.7), p.x, 0.8 + 0.25 * s);
  }

  /** The wind in front (into the intake) or behind (the exhaust) at a point: m/s along `f`, or 0 outside it. */
  private windAt(x: number, y: number, front: boolean, f: { x: number; y: number }): number {
    const p = this.main;
    const o = front ? p.pixelToWorld(JET_INTAKE[0], JET_INTAKE[1]) : p.pixelToWorld(JET_NOZZLE[0], JET_NOZZLE[1]);
    const dx = x - o.x;
    const dy = y - o.y;
    const along = (dx * f.x + dy * f.y) * (front ? 1 : -1);
    const across = Math.abs(dx * -f.y + dy * f.x);
    const reach = front ? DRAW_REACH : BLAST_REACH;
    const spread = front ? DRAW_SPREAD : BLAST_SPREAD;
    if (along < -0.2 || along > reach) return 0;
    const ang = Math.atan2(across, Math.max(0, along) + 0.5);
    if (ang > spread) return 0;
    const fall = (1 - Math.max(0, along) / reach) * (1 - (ang / spread) ** 2);
    // (both ways the air goes from the intake toward the nozzle: against its push)
    return -(front ? DRAW : BLAST) * fall;
  }

  /** What's in the blast and the draw (a few times a second: the wind is felt every step). */
  private look(): void {
    const p = this.main;
    const phys = this.game.physics;
    const f = this.forward();
    this.own = new Set(this.game.connections.assemblyOf([this]));
    this.caught.length = 0;
    const seen = new Set<Part>();
    for (const front of [true, false]) {
      const reach = front ? DRAW_REACH : BLAST_REACH;
      const spread = front ? DRAW_SPREAD : BLAST_SPREAD;
      const o = front ? p.pixelToWorld(JET_INTAKE[0], JET_INTAKE[1]) : p.pixelToWorld(JET_NOZZLE[0], JET_NOZZLE[1]);
      const d = front ? 1 : -1;
      const c = { x: o.x + f.x * d * reach * 0.5, y: o.y + f.y * d * reach * 0.5 };
      const box = (lookBox ??= new RAPIER.Cuboid(1, 1));
      box.halfExtents = { x: reach * 0.5 + 0.2, y: Math.tan(spread) * (reach + 0.5) };
      phys.world.intersectionsWithShape(c, Math.atan2(f.y, f.x), box, (col) => {
        const q = phys.partOf(col);
        if (!q || q.destroyed || seen.has(q) || this.own.has(q.entity)) return true;
        if (!this.windAt(q.x, q.y, front, f) || !this.open(o, q)) return true;
        seen.add(q);
        this.caught.push({ part: q, breadth: breadth(q, f), front });
        return true;
      }, undefined, THINGS);
    }
  }

  /** No wall or hill between `o` (its nozzle or intake) and `q`. */
  private open(o: { x: number; y: number }, q: Part): boolean {
    const dx = q.x - o.x;
    const dy = q.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) return true;
    const r = (ray ??= new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }));
    r.origin = { x: o.x, y: o.y };
    r.dir = { x: dx / d, y: dy / d };
    return !this.game.physics.world.castRay(r, d, true, undefined, WALLS);
  }

  /** The blast and the draw push what's in them toward the wind's speed; the exhaust burns what's near the nozzle. */
  private blow(dt: number, f: { x: number; y: number }, k: number): void {
    const game = this.game;
    const n = this.main.pixelToWorld(JET_NOZZLE[0], JET_NOZZLE[1]);
    for (const c of this.caught) {
      const q = c.part;
      if (q.destroyed) continue;
      const w = this.windAt(q.x, q.y, c.front, f) * Math.sqrt(k);
      if (!w) continue;
      // (w is along f, and negative: the wind goes the other way)
      const v = q.body.linvel();
      const rel = -w + (v.x * f.x + v.y * f.y);
      const push = PUSH * c.breadth * rel * dt;
      if (rel > 0 && !q.frozen) q.body.applyImpulse({ x: -f.x * push, y: -f.y * push }, true);
      if (c.front) continue;
      const d = Math.hypot(q.x - n.x, q.y - n.y);
      if (d < HOT_REACH && k > 0.15) {
        const h = HOT * Math.min(1, k) * (1 - d / HOT_REACH) * dt;
        game.fire.warm(q, h);
        if (q.mat.bleeds) q.entity.damage(q, h * 6, 'fire', { x: q.x, y: q.y }, { x: -f.x, y: -f.y });
      }
    }
  }

  /** What has reached its intake is drawn into the fan: torn up (or, if it's hard, it clangs and is thrown off). */
  private maw(): void {
    const k = this.power;
    if (k < 0.1) return;
    const game = this.game;
    const p = this.main;
    const f = this.forward();
    const m = p.pixelToWorld(JET_INTAKE[0], JET_INTAKE[1]);
    const hit: Part[] = [];
    game.physics.world.intersectionsWithShape(m, 0, new RAPIER.Ball(MAW), (col) => {
      const q = game.physics.partOf(col);
      if (q && !q.destroyed && q.entity !== this && !this.own.has(q.entity) && !hit.includes(q)) hit.push(q);
      return true;
    }, undefined, THINGS);
    for (const q of hit) {
      const at = { x: (q.x + m.x) / 2, y: (q.y + m.y) / 2 };
      const back = { x: -f.x, y: -f.y };
      if (q.mat.sparks) {
        game.particles.sparks(at.x, at.y, f.x, f.y, 6, 5);
        game.sound.impact(q.mat.sound, 0.7, at.x);
        q.entity.damage(q, 6 * k, 'blunt', at, back);
        if (!q.frozen) q.body.applyImpulseAtPoint({ x: f.x * 20 * k, y: f.y * 20 * k }, at, true);
        continue;
      }
      q.entity.damage(q, 30 * k, 'cut', at, back);
      if (q.destroyed) continue;
      if (q.mat.bleeds) game.particles.blood(at.x, at.y, -f.x, -f.y, 10, 6, q.body);
      else game.particles.debris(at.x, at.y, f.x, f.y, 3, q.mat.debrisColor, 4);
      game.sound.slash(at.x);
    }
  }

  /** Flame out of the nozzle, smoke as it spools, the nozzle's glow. */
  private exhaust(f: { x: number; y: number }, k: number): void {
    const p = this.main;
    const ps = this.game.particles;
    const n = p.pixelToWorld(JET_NOZZLE[0], JET_NOZZLE[1]);
    const s = this.spool;
    const hot = Math.min(1, k);
    for (let i = 0; i < 1 + Math.round(2 * hot); i++) {
      const sp = (8 + Math.random() * 6) * (0.4 + hot);
      ps.emit(PK.Fire, n.x, n.y, {
        vx: -f.x * sp + (Math.random() - 0.5) * 1.5 + p.vx, vy: -f.y * sp + (Math.random() - 0.5) * 1.5 + p.vy,
        life: 0.08 + 0.14 * hot + Math.random() * 0.06, size: 0.1 + 0.12 * hot, size1: 0.04,
        color: hot > 0.6 ? 0xd8f0ff : 0xffd080, color1: 0xff5a1a, alpha: 0.4 + 0.5 * hot, alpha1: 0.1, gravity: 0, drag: 2,
      });
    }
    // (smoky as it lights and spools, hardly at all running hot)
    if (Math.random() < 0.01 + 0.2 * (1 - s) * (1 - s)) ps.smoke(n.x - f.x * 0.6, n.y - f.y * 0.6, 1, 0.25, s < 0.5);
    const g = Math.round(hot * 3) / 3;
    if (g !== this.glow) {
      this.glow = g;
      p.setArt(jetEngineArt(g));
    }
  }

  frame(): void {
    if (this.spool < 0.2 || this.main.frozen) return;
    const n = this.main.pixelToWorld(JET_NOZZLE[0] + 2, JET_NOZZLE[1]);
    this.game.renderer.addLight(n.x, n.y, 1.2 + 2.2 * this.spool, 0.25 + 0.45 * Math.min(1, this.power) + Math.random() * 0.08, 0xffa860);
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      // (named by the push, not by whether it's picked: a guest's pick is found by its name)
      ...JET_THROTTLES.map((t) => ({ label: `Throttle ${Math.round(JET_FORCE * t)} N`, checked: this.throttle === t, action: () => (this.throttle = t) })),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, throttle: this.throttle, spool: Math.round(this.spool * 100) / 100 };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.throttle = JET_THROTTLES.includes(x.throttle as number) ? (x.throttle as number) : 1;
    this.spool = Math.min(1, Math.max(0, Number(x.spool) || 0));
  }
}

/** How broad a part is across the wind (m): its sprite's extent at right angles to `f`. */
function breadth(q: Part, f: { x: number; y: number }): number {
  const u = q.localDir(1, 0);
  const n = { x: -f.y, y: f.x };
  return (q.w * Math.abs(u.x * n.x + u.y * n.y) + q.h * Math.abs(-u.y * n.x + u.x * n.y)) * PX;
}

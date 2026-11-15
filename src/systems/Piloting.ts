import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import { PX, WORLD } from '../engine/constants';
import { wrapAngle } from '../engine/math';
import type { ContextAction } from '../world/types';

/**
 * Flying (or driving) anything built: select a build with engines in it (or the
 * person in its cockpit) and the keys fly it, as they drive a car (see Controls):
 *
 * - W and S: the throttle, up or down. It stays where it's left, even let go of
 *   (a rocket keeps climbing), and a hover thruster's height goes with it.
 * - A and D: move left or right. Engines pushing that way fire, wheel motors drive.
 * - Q and E: turn anticlockwise or clockwise. Gyroscopes turn the angle they hold,
 *   and engines off the centre of mass fire (or ease off) as their pushes turn it.
 *
 * Each engine has a job (see Job): on Auto it works its part out from which way it
 * pushes in the craft's frame (the cockpit's, or the build's as it was when taken
 * over) and where it is about the centre of mass: those along the main push (most
 * of the push the build has, the way most of it goes) are the throttle; others
 * move it; any far off the centre of mass turn it too. Its menu can set it by hand.
 */

/** What an engine does when its build is piloted (its menu's Job). */
export type Job = 'auto' | 'throttle' | 'move' | 'rotate' | 'always' | 'wire';
export const JOBS: Job[] = ['auto', 'throttle', 'move', 'rotate', 'always', 'wire'];
export const JOB_LABEL: Record<Job, string> = {
  auto: 'Auto', throttle: 'Throttle (W, S)', move: 'Move (A, D)', rotate: 'Turn (Q, E)', always: 'Always on', wire: 'Wire only',
};

/** Something piloting runs (a thruster, a jet, a propeller, a wheel motor, a hover thruster). */
export interface Engine {
  /** Its job (see Job). */
  job: Job;
  /**
   * Under the pilot: how hard it runs now (0 to 1; a wheel motor -1 to 1, + driving
   * right), or null: it's its own, run by its switch and its wires as ever.
   */
  pilotOut: number | null;
  /** The throttle its build was left at (0 to 1), kept with it (a save, a copy). */
  pilotT: number;
  /** Which way it pushes (world, a unit vector), or null: it turns wheels (a motor). */
  pushDir(): V2 | null;
  /** Its full push (N) (a motor's: its torque), to weigh it among the rest. */
  pushForce(): number;
  /** Where it pushes (world). */
  pushAt(): V2;
  /** A hover thruster: the throttle is the height it holds (see HoverThruster). */
  readonly hovers?: boolean;
}

/** Something piloting turns: a gyroscope, the angle it holds turned by Q and E. */
export interface Steadier {
  pilotTurn(r: number, dt: number): void;
}

/** An engine's menu entry for its job: each pick, the next (one entry, its label naming the job it has). */
export function jobAction(e: Engine): ContextAction {
  return { label: `Job: ${JOB_LABEL[e.job]}`, action: () => (e.job = JOBS[(JOBS.indexOf(e.job) + 1) % JOBS.length]) };
}

/** What of an engine's piloting is kept (a save, a copy, a guest's view of it). */
export function pilotState(e: Engine): Record<string, unknown> {
  return { job: e.job, pt: e.pilotT, po: e.pilotOut };
}

export function restorePilot(e: Engine, x: Record<string, unknown>): void {
  e.job = JOBS.includes(x.job as Job) ? (x.job as Job) : 'auto';
  e.pilotT = typeof x.pt === 'number' && x.pt >= 0 && x.pt <= 1 ? x.pt : 0;
  e.pilotOut = typeof x.po === 'number' && Math.abs(x.po) <= 1 ? x.po : null;
}

/**
 * How hard an engine runs (0 to 1) and whether it does: under the pilot, as the pilot
 * has it; its own, at full switched on by hand, or at the power its wires bring (a
 * throttle lever's: see Entity.powerLevel).
 */
export function engineLevel(e: Entity & Engine, on: boolean): number {
  if (e.pilotOut !== null) return Math.abs(e.pilotOut);
  return on ? 1 : e.powered ? e.powerLevel : 0;
}

export function isEngine(e: Entity): e is Entity & Engine {
  return typeof (e as Partial<Engine>).pilotT === 'number' && typeof (e as Partial<Engine>).pushAt === 'function';
}

function isSteadier(e: Entity): e is Entity & Steadier {
  return typeof (e as Partial<Steadier>).pilotTurn === 'function';
}

/** A pilot's keys this step: A/D (-1 to 1), W/S (-1 to 1), Q/E (1 anticlockwise, -1 clockwise). */
export interface PilotInput {
  x: number;
  t: number;
  r: number;
}

/** How an engine on Auto answers the pilot (see remix()). */
interface Mix {
  /** Along the main push: the throttle runs it. */
  lift: boolean;
  /** Its push across: 1 (right) or -1 (left) in the craft's frame, 0 neither. */
  mx: number;
  /** Turning it: 1 anticlockwise, -1 clockwise, 0 hardly. */
  rot: number;
  /** A wheel motor: A and D drive it. */
  drive: boolean;
}

/** A build being piloted. */
export interface Craft {
  /** What it is: the things held together (see Connections.assemblyOf()). */
  ents: Entity[];
  engines: (Entity & Engine)[];
  steadiers: (Entity & Steadier)[];
  /** The part its frame turns with (the cockpit, or the first engine), and that part's angle when it was taken over. */
  ref: Part;
  a0: number;
  /** Its throttle (0 to 1). */
  T: number;
  input: PilotInput;
  /** When it was last told (game time): a pilot renews it every step (a guest's, as its messages come). */
  told: number;
  /** Piloted on this screen (it gets the HUD). */
  mine: boolean;
  mix: Map<Entity, Mix>;
  mixAt: number;
  /** When it was put together, and the connections there were then (see assemble()). */
  madeAt: number;
  links: number;
  /** Its middle, frame and size as remix() last found them. */
  com: V2;
  frame: number;
  /** The angle it's held at, in its frame (see fly()): where it was when Q or E was last let go of. */
  hold: number;
  /**
   * Can its lifting engines level it (see fly())? Only with some turning it each way:
   * one alone off the middle (a plane's one engine under its wing), eased off to level
   * the craft, would only let it fall.
   */
  levels: boolean;
}

/** What the HUD shows of a craft (see Piloting.hudOf()). */
export interface PilotHud {
  /** m/s */
  speed: number;
  /** Above the floor (m). */
  height: number;
  /** Up (m/s). */
  climb: number;
  /** 0 to 1. */
  throttle: number;
  /** Its engines, and how many are running now. */
  engines: number;
  running: number;
  /** Fixed to the background somewhere (see Connections.fixedOf()): nothing it does moves it. */
  fixed?: boolean;
  /** On the World: its true height (m), and the air there: density (kg/m³) and temperature (°C). */
  alt?: number;
  air?: number;
  temp?: number;
}

/** How fast W and S move the throttle (a share a second). */
const T_RATE = 0.6;
/** How long (s) a pilot's word holds without being renewed (a guest's arrives every few steps). */
const HOLD = 0.3;
/** How long (s) a pilot's keys count without being said again: after that they're let go of (still flown, till HOLD). */
const KEYS_LAST = 0.1;
const NO_KEYS: PilotInput = { x: 0, t: 0, r: 0 };
/** How often (s) engines on Auto work out their jobs again (the build turns, a part comes off). */
const REMIX = 0.5;
/** How often (s) a craft's make-up is looked over again (something welded on or cut off). */
const REMAKE = 1;
/**
 * How far off the centre of mass an engine's push passes to turn it (see remix()): this
 * share of the build's size, but never more than TURNS_MAX (m). A tall rocket's jets side
 * by side under it, a metre or two apart, turn it (and level it) as a small drone's do;
 * against its size alone (a fifth of 12 m), none of them did, and nothing held it up.
 */
const TURNS = 0.2;
const TURNS_MAX = 0.5;
/** Levelling (see fly()): how hard the engines answer being off the angle held (per rad), and turning (per rad/s). */
const LEVEL = { k: 2.5, d: 0.8 };

export class Piloting {
  private game: Game;
  private crafts: Craft[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  /** The craft these are (part of), if it has anything to pilot: found, or put together. */
  craftOf(sel: readonly Entity[]): Craft | null {
    for (const c of this.crafts) if (sel.some((e) => c.ents.includes(e))) return c;
    const c = this.assemble(sel);
    if (c) this.crafts.push(c);
    return c;
  }

  /** Has the selection anything to pilot? (Cheap when it's already being flown.) */
  pilotable(sel: readonly Entity[]): boolean {
    for (const c of this.crafts) if (sel.some((e) => c.ents.includes(e))) return true;
    return this.assemble(sel) !== null;
  }

  /** A pilot's keys for the craft `sel` is part of, this step (see Controls.steer(), and a guest's 'pilot' at the host). */
  drive(sel: readonly Entity[], input: PilotInput, mine = true): Craft | null {
    const c = this.craftOf(sel);
    if (!c) return null;
    c.input = input;
    c.told = this.game.time;
    c.mine = mine;
    return c;
  }

  /** The craft piloted on this screen, if any (for the HUD). */
  get mine(): Craft | null {
    for (const c of this.crafts) if (c.mine) return c;
    return null;
  }

  private assemble(sel: readonly Entity[]): Craft | null {
    const ents = this.game.connections.assemblyOf(sel);
    const engines = ents.filter(isEngine);
    const steadiers = ents.filter(isSteadier);
    if (!engines.length && !steadiers.length) return null;
    const cockpit = ents.find((e) => (e as { cockpit?: boolean }).cockpit && !e.destroyed);
    const ref = (cockpit ?? engines[0] ?? steadiers[0]).parts[0];
    let T = 0;
    for (const e of engines) T = Math.max(T, e.pilotT);
    return {
      ents, engines, steadiers, ref,
      // (a cockpit's up is the craft's; otherwise the way it was when taken over)
      a0: cockpit ? 0 : ref.bodyAngle,
      T, input: { x: 0, t: 0, r: 0 }, told: this.game.time, mine: false,
      mix: new Map(), mixAt: -Infinity, madeAt: this.game.time, links: this.game.connections.list.length,
      com: { x: ref.x, y: ref.y }, frame: 0,
      hold: cockpit ? wrapAngle(ref.bodyAngle) : 0, levels: false,
    };
  }

  /** When strays() last looked. */
  private strayAt = -Infinity;

  /**
   * Engines under the pilot that no craft flies: what a save, a copy or a saved
   * contraption made while it was flown brings back (see restorePilot()). They're
   * left as letGo() leaves them: on the throttle and above nothing, it runs on (a
   * rocket saved climbing climbs on); anything else is its own again. Before, one
   * saved flown at nothing was held off for good: its switch did nothing, and nor
   * did its wires (a throttle lever wired to a rocket's jets).
   */
  private strays(): void {
    const flown = new Set<Entity>();
    for (const c of this.crafts) for (const e of c.engines) flown.add(e);
    for (const e of this.game.entities) {
      if (e.destroyed || flown.has(e) || !isEngine(e) || e.pilotOut === null) continue;
      if (!(e.pilotOut > 0 && Math.abs(e.pilotOut - e.pilotT) < 1e-6)) e.pilotOut = null;
    }
  }

  /** Each step, before the things in the world: the engines of each craft piloted run as the pilot has them. */
  step(dt: number): void {
    const now = this.game.time;
    // (or the clock's gone back: a new game, a load)
    if (now - this.strayAt > REMIX || now < this.strayAt) {
      this.strayAt = now;
      this.strays();
    }
    for (let i = this.crafts.length - 1; i >= 0; i--) {
      let c = this.crafts[i];
      if (now - c.told > HOLD || c.ref.destroyed) {
        this.letGo(c);
        this.crafts.splice(i, 1);
        continue;
      }
      if (now - c.madeAt > REMAKE) {
        c.madeAt = now;
        if (this.game.connections.list.length !== c.links) {
          // (something joined on or come off: what's held together now, keeping its throttle)
          const again = this.assemble([c.ref.entity]);
          if (!again) {
            this.letGo(c);
            this.crafts.splice(i, 1);
            continue;
          }
          for (const e of c.engines) if (!again.engines.includes(e)) this.release(e);
          Object.assign(again, { T: c.T, input: c.input, told: c.told, mine: c.mine, ref: c.ref, a0: c.a0, hold: c.hold });
          this.crafts[i] = c = again;
        }
      }
      this.fly(c, dt);
    }
  }

  private fly(c: Craft, dt: number): void {
    // (keys not said again for a moment are let go of: the pilot's gone, or a guest's word is late)
    const fresh = this.game.time - c.told <= KEYS_LAST;
    const { x, t, r } = fresh ? c.input : NO_KEYS;
    const T = (c.T = Math.min(1, Math.max(0, c.T + t * T_RATE * dt)));
    if (this.game.time - c.mixAt > REMIX) this.remix(c);
    // levelling: flying with no gyroscope in it, the engines that turn it ease off (or
    // push harder) to hold it at the angle it was left at, as a drone's do
    const now = wrapAngle(c.ref.bodyAngle - c.a0);
    if (r) c.hold = now;
    const level = !r && T > 0.02 && !c.steadiers.some((g) => !g.destroyed) ? Math.min(1, Math.max(-1, LEVEL.k * wrapAngle(c.hold - now) - LEVEL.d * c.ref.av)) : 0;
    for (const e of c.engines) {
      if (e.destroyed) continue;
      e.pilotT = T;
      const job = e.job;
      if (job === 'wire') {
        e.pilotOut = null;
        continue;
      }
      if (job === 'always') {
        e.pilotOut = 1;
        continue;
      }
      const m = c.mix.get(e);
      if (!m) continue;
      if (e.hovers) {
        e.pilotOut = T;
        continue;
      }
      if (m.drive) {
        // (a wheel motor: + drives right; on Throttle or Turn, it's run its own way)
        e.pilotOut = job === 'throttle' ? T : job === 'rotate' ? -r : x;
        continue;
      }
      const isLift = job === 'throttle' || (job === 'auto' && m.lift);
      const lift = !isLift ? 0 : level && m.rot && c.levels ? T * (1 + level * m.rot) : T;
      // (set to Move or Turn by hand, an engine that does neither fires on D, or on Q)
      const mx = job === 'move' && !m.mx ? 1 : m.mx;
      const rot = job === 'rotate' && !m.rot ? 1 : m.rot;
      const mv = (job === 'move' || job === 'auto') && x * mx > 0 ? 1 : 0;
      const turn = (job === 'rotate' || job === 'auto') && r ? r * rot : 0;
      e.pilotOut = job === 'rotate' ? (turn > 0 ? 1 : 0) : Math.min(1, Math.max(0, lift + mv + turn));
    }
    for (const g of c.steadiers) if (!g.destroyed) g.pilotTurn(r, dt);
  }

  /** Works out what each engine on Auto does (see Mix): which way it pushes in the craft's frame, and about its centre of mass. */
  private remix(c: Craft): void {
    c.mixAt = this.game.time;
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const e of c.ents) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.detached) continue;
        mx += p.x * p.mass;
        my += p.y * p.mass;
        m += p.mass;
      }
    }
    if (m <= 0) return;
    const com = (c.com = { x: mx / m, y: my / m });
    // (how far it reaches from there: to its parts' far corners, not just their middles: one long plank is as big as it is long)
    let size = 0.5;
    for (const e of c.ents) {
      for (const p of e.parts) if (!p.destroyed) size = Math.max(size, Math.hypot(p.x - com.x, p.y - com.y) + (Math.hypot(p.w, p.h) * PX) / 2);
    }
    const frame = (c.frame = c.ref.bodyAngle - c.a0);
    const cos = Math.cos(-frame);
    const sin = Math.sin(-frame);
    // the main push: the way (up, right, down or left, in the craft's frame) most of its push goes
    const ways = [0, 0, 0, 0];
    const dirs: (V2 | null)[] = [];
    for (const e of c.engines) {
      const d = e.destroyed || e.hovers ? null : e.pushDir();
      const dc = d ? { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos } : null;
      dirs.push(dc);
      if (!dc) continue;
      const f = e.pushForce();
      ways[0] += f * Math.max(0, dc.y);
      ways[1] += f * Math.max(0, dc.x);
      ways[2] += f * Math.max(0, -dc.y);
      ways[3] += f * Math.max(0, -dc.x);
    }
    let main = 0;
    for (let k = 1; k < 4; k++) if (ways[k] > ways[main] * 1.1) main = k;
    const ax = [0, 1, 0, -1][main];
    const ay = [1, 0, -1, 0][main];
    c.mix.clear();
    let up = false;
    let down = false;
    c.engines.forEach((e, i) => {
      const dc = dirs[i];
      if (!dc) {
        c.mix.set(e, { lift: false, mx: 0, rot: 0, drive: !e.hovers });
        return;
      }
      const d = e.pushDir()!;
      const at = e.pushAt();
      // (its turn about the middle per newton, against the build's size: the same in any frame)
      const tq = ((at.x - com.x) * d.y - (at.y - com.y) * d.x) / size;
      const lift = dc.x * ax + dc.y * ay > 0.7;
      const rot = Math.abs(tq) > Math.min(TURNS, TURNS_MAX / size) ? Math.sign(tq) : 0;
      if (lift && rot > 0) up = true;
      if (lift && rot < 0) down = true;
      c.mix.set(e, {
        lift,
        mx: !lift && Math.abs(dc.x) > 0.5 ? Math.sign(dc.x) : 0,
        rot,
        drive: false,
      });
    });
    c.levels = up && down;
  }

  /** The pilot's gone (deselected): engines on the throttle keep it, the rest are their own again. */
  private letGo(c: Craft): void {
    for (const e of c.engines) {
      if (e.destroyed) continue;
      const m = c.mix.get(e);
      const onThrottle = e.job === 'throttle' || e.hovers || (e.job === 'auto' && !!m?.lift);
      e.pilotOut = onThrottle && c.T > 0 ? c.T : null;
    }
  }

  private release(e: Entity & Engine): void {
    if (!e.destroyed) e.pilotOut = null;
  }

  /** A craft looked at but not flown here (a guest's HUD: the host flies it), kept a moment (see hudOf()). */
  private peek: { key: number; at: number; c: Craft } | null = null;

  /**
   * What the HUD shows of the craft `sel` is part of: its speed and height, its climb,
   * its throttle (as its engines have it, so a guest's, flown by the host, shows too).
   */
  hudOf(sel: readonly Entity[]): PilotHud | null {
    let c: Craft | null = null;
    for (const k of this.crafts) if (sel.some((e) => k.ents.includes(e))) c = k;
    if (!c) {
      const key = sel[0]?.id ?? -1;
      const pk = this.peek;
      if (pk && pk.key === key && Math.abs(this.game.time - pk.at) < REMAKE) c = pk.c;
      else {
        c = this.assemble(sel);
        this.peek = c ? { key, at: this.game.time, c } : null;
      }
    }
    if (!c || c.ref.destroyed) return null;
    const p = c.ref;
    let T = 0;
    let n = 0;
    let running = 0;
    for (const e of c.engines) {
      if (e.destroyed) continue;
      n++;
      T = Math.max(T, e.pilotT);
      if ((e.pilotOut ?? 0) !== 0) running++;
    }
    // (over the ground under it on the World, where the floor is far down out of sight)
    const g = this.game;
    const height = g.env.world ? p.y - g.env.groundAt(p.x, p.y) : p.y - WORLD.floor;
    const fixed = g.connections.fixedOf(c.ents).length > 0;
    return { speed: Math.hypot(p.vx, p.vy), height, climb: p.vy, throttle: T, engines: n, running, ...(fixed ? { fixed } : {}), ...(g.map.world ? { alt: p.y + g.origin.y, air: g.air.densityAt(p.y), temp: g.air.tempAt(p.y) } : {}) };
  }

  /** Forgets every craft (a scene cleared or loaded). */
  clear(): void {
    this.crafts.length = 0;
  }
}

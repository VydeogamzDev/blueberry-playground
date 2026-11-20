import { dragOf } from './Aero';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import { PX, WORLD } from '../engine/constants';
import { wrapAngle } from '../engine/math';
import { PK } from './Particles';
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
  /** Pushing nothing for want of air: a jet flamed out, a propeller in space (see AIR_GONE). */
  readonly starved?: boolean;
}

/**
 * Air this thin (a share of the ground's, about 3 km up on the World) is too little for
 * a jet to burn or a propeller to bite: the jet flames out, and both push nothing.
 */
export const AIR_GONE = 0.03;

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
  // (given a stage, it waits for it: see Entity.stage, Piloting.held())
  if (e.game.piloting.held(e)) return 0;
  if (e.pilotOut !== null) return Math.abs(e.pilotOut);
  return on ? 1 : e.powered ? e.powerLevel : 0;
}

/**
 * An engine with a stage switched on by hand (F) or by power down its wires (0.4.3): its
 * stage is as good as fired, for it. Before, it waited for its stage all the same, and
 * F on it, or a switch wired to it, did nothing that could be seen.
 */
export function startedByHand(e: Entity): void {
  if (e.stage > 0 && !e.staged) e.staged = true;
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
  /** Held: the craft's guns fire (see Piloting.weapons()); its boost (nitro, afterburners) burns. */
  fire?: boolean;
  boost?: boolean;
}

/**
 * The menu entry that steps a part's stage (see Entity.stage) on: none, 1 to 9, none.
 * (Its label starts STAGE_LABEL for a guest's pick to be found by: see Host.)
 */
export const STAGE_LABEL = 'Stage: ';
export function stageAction(e: Entity, also: readonly Entity[] = []): ContextAction {
  const auto = e.autoStaged ? ' (auto)' : '';
  return {
    label: `${STAGE_LABEL}${e.stage ? `${e.stage}${e.staged ? ' (fired)' : auto}` : 'none'}${also.length ? ` (all ${also.length + 1})` : ''}`,
    hint: 'next',
    action: () => {
      // (set by hand: the build's stages are the player's now, see autoStage(); several
      // selected, they all go to the next stage after this one's)
      const next = (e.stage + 1) % 10;
      for (const x of [e, ...also]) {
        if (!x.stageable) continue;
        x.stage = next;
        x.staged = false;
        x.autoStaged = false;
      }
    },
  };
}

/** A decoupler (see entities/Rocketry): read by what it is, so this needn't load it. */
function isDecoupler(e: Entity): e is Entity & { fired: boolean; readonly decoupler: true } {
  return (e as { decoupler?: boolean }).decoupler === true;
}

/** A pilot's one-off orders (0.4.0): the next stage, stability assist, the landing gear, the parachutes, ejecting. */
export type PilotCommand = 'stage' | 'assist' | 'gear' | 'chutes' | 'eject' | 'lights' | 'horn' | 'autopilot' | 'bombs' | 'flares' | 'rockets';
export const PILOT_COMMANDS: PilotCommand[] = ['stage', 'assist', 'gear', 'chutes', 'eject', 'lights', 'horn', 'autopilot', 'bombs', 'flares', 'rockets'];

/** Something a pilot's orders reach (see PilotCommand): legs and gear, parachutes, ejection seats. */
export interface Commanded {
  pilotCommand(cmd: PilotCommand): boolean;
}

function isCommanded(e: Entity): e is Entity & Commanded {
  return typeof (e as Partial<Commanded>).pilotCommand === 'function';
}

/** Something a pilot fires (a gun built into the craft): held, it fires. */
export interface PilotWeapon {
  pilotFire(on: boolean): void;
}

function isWeaponOf(e: Entity): e is Entity & PilotWeapon {
  return typeof (e as Partial<PilotWeapon>).pilotFire === 'function';
}

/** An engine that swivels to turn the craft (a gimballed thruster, a control flap): told the turn wanted (-1 to 1, + anticlockwise) and the craft's middle. */
export interface Swiveller {
  pilotSwivel(u: number, com: V2): void;
}

export function isSwiveller(e: Entity): e is Entity & Swiveller {
  return typeof (e as Partial<Swiveller>).pilotSwivel === 'function';
}

/** Something a craft's boost key works: nitro, an afterburner. */
export interface Booster {
  boosting: boolean;
}

function isBooster(e: Entity): e is Entity & Booster {
  return typeof (e as Partial<Booster>).boosting === 'boolean';
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
  /** Its push's lever about the middle (m): its turn at full is its push times this. */
  arm?: number;
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
  /** Its middle in the frame of `ref` (see remix()), for between looks. */
  comL?: V2;
  /** How hard it is to turn (kg m², about its middle: see remix()). */
  inertia?: number;
  /** Its speed against the speed of sound, last step (see wake()). */
  mach: number;
  frame: number;
  /** The angle it's held at, in its frame (see fly()): where it was when Q or E was last let go of. */
  hold: number;
  /**
   * Stability assist (0.4.0; on unless turned off): Q and E turn it at a steady rate, and
   * let go, every engine and gyroscope that can brakes the turn and holds the angle it was
   * at. Without it, let go of in space (where no air slows a spin) a craft tumbled on.
   */
  assist: boolean;
  /**
   * Autopilot (0.4.0): holds the height it was at when turned on (true height) with the
   * throttle, and its angle with the stability assist, till turned off or the pilot touches
   * the throttle or turns it.
   */
  auto: { alt: number } | null;
  /** Things in it the pilot's orders and fire key reach. */
  commanded: (Entity & Commanded)[];
  /** What swivels to turn it (see Swiveller). */
  swivels: (Entity & Swiveller)[];
  weapons: (Entity & PilotWeapon)[];
  boosters: (Entity & Booster)[];
  /** Was the fire key held last step (a gun's let go of once). */
  firing: boolean;
  /** Its velocity last step, and the g its pilot feels (smoothed; see fly()). */
  lastV: V2 | null;
  g: number;
  /**
   * Can its lifting engines level it (see fly())? Only with some turning it each way:
   * one alone off the middle (a plane's one engine under its wing), eased off to level
   * the craft, would only let it fall.
   */
  levels: boolean;
}

/** What the HUD shows of a craft (see Piloting.hudOf()). */
export interface PilotHud {
  /** Its pilot near blacking out from g (see Cockpit.strain): 0.5 greying, 1 out. */
  strain?: number;
  /** m/s */
  speed: number;
  /** Above the floor (m). */
  height: number;
  /** Up (m/s). */
  climb: number;
  /** 0 to 1. */
  throttle: number;
  /** Its engines, how many are running now, and how many would be but for the air (see Engine.starved). */
  engines: number;
  running: number;
  noAir?: number;
  /** Fixed to the background somewhere (see Connections.fixedOf()): nothing it does moves it. */
  fixed?: boolean;
  /** Its tanks: fuel left and what they hold (kg), when it has any; engines starved of it. */
  fuel?: number;
  fuelCap?: number;
  noFuel?: number;
  /** Its stages: the next to fire (0: none left) and how many there are. */
  stageNext?: number;
  stages?: number;
  /** Stability assist on (see Craft.assist). */
  assist?: boolean;
  /** What it is, for its dashboard: a car (wheels driven), a plane (wings), a rocket (stages, tanks), or anything else. */
  kind?: 'car' | 'plane' | 'rocket' | 'craft';
  /** Its angle from upright (rad, + anticlockwise), how hard it's turning (rad/s), and the g its pilot feels. */
  tilt?: number;
  spin?: number;
  g?: number;
  /** As high as it will get coasting from here, going up (true height, m; the World only). */
  apo?: number;
  /** The bottom of its path round the planet (true height, m), if that's above the ground: it's in orbit. */
  peri?: number;
  /** A plane's: its wings' angle to the air (rad) and whether they've stalled. */
  aoa?: number;
  stall?: boolean;
  /** A car's: its engine's revs and gear (see entities/Vehicles2). */
  rpm?: number;
  gear?: number;
  /** A few words of what's set (an aircraft's flaps, its afterburner, a balloon's heat: see entities/Planes). */
  note?: string;
  /** On the World: its true height (m), and the air there: density (kg/m³) and temperature (°C). */
  alt?: number;
  air?: number;
  temp?: number;
}

/**
 * Its path round the planet (the World: see Altitude's falling round it), from its true
 * height `h` and velocity: the top and bottom of it, as heights (m). Going fast enough to
 * leave, the top is Infinity.
 */
export function orbitOf(h: number, vx: number, vy: number, R: number, g0: number): { apo: number; peri: number } {
  const mu = g0 * R * R;
  const r = R + Math.max(0, h);
  const e2 = (vx * vx + vy * vy) / 2 - mu / r;
  if (e2 >= 0) return { apo: Infinity, peri: Infinity };
  const L = r * vx;
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * e2 * L * L) / (mu * mu)));
  const a = -mu / (2 * e2);
  return { apo: a * (1 + ecc) - R, peri: a * (1 - ecc) - R };
}

/** A build's numbers, while building (0.4.0: see Piloting.buildStats()). */
export interface BuildStats {
  /** Its weight (kg) and middle. */
  mass: number;
  com: V2;
  /** Its engines' push at full (N, the way most of it goes), where that acts and which way; against its weight. */
  thrust: number;
  cot: V2 | null;
  dir: V2 | null;
  twr: number;
  /** How long (s) its tanks' fuel lasts at full (Infinity: no tank, it runs free). */
  burn: number;
  /** The middle of its wings' and fins' lift (their area's), if it has any. */
  col: V2 | null;
  /** How fast it's going (m/s): the marks are shown only near still. */
  speed: number;
}

/** How fast W and S move the throttle (a share a second). */
const T_RATE = 0.6;
/** The fastest (m/s) the autopilot climbs or sinks to the height it holds. */
const AUTO_CLIMB = 6;
/** How long (s) a pilot's word holds without being renewed (a guest's arrives every few steps). */
const HOLD = 0.3;
/** How long (s) a pilot's keys count without being said again: after that they're let go of (still flown, till HOLD). */
const KEYS_LAST = 0.1;
const NO_KEYS: PilotInput = { x: 0, t: 0, r: 0 };
/** How often (s) engines on Auto work out their jobs again (the build turns, a part comes off). */
const REMIX = 0.5;
/** How often (s) a craft's make-up is looked over again (something welded on or cut off). */
const REMAKE = 1;
/** How often (s) what lets go of an engine (see Piloting.droppedAt()) is looked for again. */
const DROP_RELOOK = 0.5;
/**
 * How far off the centre of mass an engine's push passes to turn it (see remix()): this
 * share of the furthest any of its engines' does, and at least TURNS_MIN (m). Engines side
 * by side under a rocket turn it (and level it) as a small drone's do, however far apart:
 * against a fixed half metre (0.4.3), a second stage's three thrusters, 0.43 m apart, didn't,
 * and once the first stage was dropped nothing steered it.
 */
const TURNS = 0.25;
const TURNS_MIN = 0.06;
/** Levelling (see fly()): how hard the engines answer being off the angle held (per rad), and turning (per rad/s). */
const LEVEL = { k: 2.5, d: 0.8 };
/**
 * Stability assist (see fly()): the turn Q and E ask for (rad/s), how fast it turns back
 * to the angle held (per rad off), how hard the engines answer a turn off what's wanted
 * (per rad/s), and below what (of their full answer) it leaves them be.
 */
const ASSIST = { rate: 0.9, k: 1.6, d: 2.5, dead: 0.04, tau: 0.25 };

export class Piloting {
  private game: Game;
  private crafts: Craft[] = [];
  /** For each engine looked at (see droppedAt()): when, and the stage that lets go of it. */
  private drops = new WeakMap<Entity, { at: number; k: number }>();

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Is the engine `e` waiting for its stage (see Entity.stage)? It waits for the stage it
   * fires in (see firesIn()), till that's fired, or it's switched on by hand (see startedByHand()).
   */
  held(e: Entity): boolean {
    return e.stage > 0 && !e.staged && this.firesIn(e) > 0;
  }

  /**
   * The stage `e` fires in: its own; but an engine a decoupler lets go of (one of the stages
   * that comes off) is burning before that, in the stage before the decoupler's at the
   * latest. Before 0.4.3, the bottom engines of a rocket staged by hand, given the stage of
   * the decoupler over them (or one after it), waited till they were dropped to light.
   */
  firesIn(e: Entity): number {
    if (e.stage <= 0 || !isEngine(e)) return e.stage;
    const k = this.droppedAt(e);
    return k > 0 ? Math.min(e.stage, k - 1) : e.stage;
  }

  /**
   * The stage (not yet fired) that first lets go of `e` from its build's cockpit: the lowest
   * stage of the decouplers between them (0: none does). Looked for now and then (see DROP_RELOOK).
   */
  private droppedAt(e: Entity): number {
    const now = this.game.time;
    const c = this.drops.get(e);
    if (c && now - c.at < DROP_RELOOK && now >= c.at) return c.k;
    const ents = this.game.connections.assemblyOf([e]);
    const lay = this.layout(ents);
    for (const x of ents) if (isEngine(x)) this.drops.set(x, { at: now, k: lay?.drop.get(x) ?? 0 });
    const k = lay?.drop.get(e) ?? 0;
    this.drops.set(e, { at: now, k });
    return k;
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
    this.autoStage(ents);
    const engines = ents.filter(isEngine);
    const steadiers = ents.filter(isSteadier);
    const commanded = ents.filter(isCommanded);
    const weapons = ents.filter(isWeaponOf);
    const boosters = ents.filter(isBooster);
    const swivels = ents.filter(isSwiveller);
    if (!engines.length && !steadiers.length && !commanded.length && !swivels.length && !ents.some((e) => e.stage > 0)) return null;
    const cockpit = ents.find((e) => (e as { cockpit?: boolean }).cockpit && !e.destroyed);
    const ref = (cockpit ?? engines[0] ?? steadiers[0] ?? swivels[0] ?? commanded[0] ?? ents[0]).parts[0];
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
      assist: true, auto: null, commanded, weapons, boosters, swivels, firing: false, lastV: null, g: 1, mach: 0,
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
          Object.assign(again, { T: c.T, input: c.input, told: c.told, mine: c.mine, ref: c.ref, a0: c.a0, hold: c.hold, assist: c.assist, auto: c.auto, firing: c.firing, lastV: c.lastV, g: c.g, mach: c.mach });
          this.crafts[i] = c = again;
        }
      }
      this.fly(c, dt);
    }
  }

  private fly(c: Craft, dt: number): void {
    // (keys not said again for a moment are let go of: the pilot's gone, or a guest's word is late)
    const fresh = this.game.time - c.told <= KEYS_LAST;
    const input = fresh ? c.input : NO_KEYS;
    const { x, t, r } = input;
    // (the pilot's hand on the throttle or the turn takes it off autopilot)
    if (c.auto && (t || r)) c.auto = null;
    // (W on a craft whose engines all wait for stages: the first lights)
    if (t > 0 && !c.auto) this.launch(c);
    let T = (c.T = Math.min(1, Math.max(0, c.T + t * T_RATE * dt)));
    if (c.auto) {
      // autopilot: climb (or sink) toward the height it holds, no faster than AUTO_CLIMB,
      // the throttle eased to make the climb wanted
      const p = c.ref;
      const alt = p.y + (this.game.map.world ? this.game.air.base : 0);
      const want = Math.max(-AUTO_CLIMB, Math.min(AUTO_CLIMB, (c.auto.alt - alt) * 0.6));
      // (the throttle kept creeps toward what holds it; on top, a nudge for the climb missing now)
      const miss = want - p.vy;
      c.T = Math.min(1, Math.max(0, c.T + miss * 0.3 * dt));
      T = Math.min(1, Math.max(0, c.T + miss * 0.04));
    }
    if (this.game.time - c.mixAt > REMIX) this.remix(c);
    const now = wrapAngle(c.ref.bodyAngle - c.a0);
    const av = c.ref.av;
    if (r) c.hold = now;
    // the g its pilot feels: its acceleration less the pull of gravity (1 sat still, 0 falling free)
    {
      const p = c.ref;
      if (c.lastV) {
        const gy = this.game.gravity * (this.game.map.world ? this.game.air.gravityAt(p.y) : 1);
        const ax = (p.vx - c.lastV.x) / dt;
        const ay = (p.vy - c.lastV.y) / dt - gy;
        const g = Math.hypot(ax, ay) / 9.81;
        c.g += (Math.min(g, 40) - c.g) * Math.min(1, dt * 6);
      }
      c.lastV = { x: p.vx, y: p.vy };
    }
    // the turn wanted, -1 to 1 (+ anticlockwise)
    let u = 0;
    // levelling (no assist): with no gyroscope in it, the engines that turn it ease off (or
    // push harder) to hold it at the angle it was left at, as a drone's do
    let level = 0;
    if (c.assist) {
      // stability assist: Q and E ask for a steady turn; let go, a turn back to the angle
      // held, braked as it gets there. Only while flying (or asked): one sat on its pad
      // at no throttle, a little off level, doesn't fire its engines to right itself.
      const p = c.ref;
      const airborne = T > 0.02 || Math.hypot(p.vx, p.vy) > 1.5 || p.y - this.game.env.groundAt(p.x, p.y) > 2.5;
      if (r || airborne) {
        const want = r ? r * ASSIST.rate : Math.max(-ASSIST.rate, Math.min(ASSIST.rate, ASSIST.k * wrapAngle(c.hold - now)));
        // (as hard as closes the gap in ASSIST.tau for how hard its engines can turn it: a
        // light craft with strong engines far out, pushed full, overshot every step and back)
        const turnAcc = this.authority(c, r ? 1 : T) / Math.max(1e-3, c.inertia ?? 0);
        const gain = turnAcc > 0 ? Math.min(ASSIST.d, 1 / (turnAcc * Math.max(ASSIST.tau, dt * 2))) : ASSIST.d;
        u = Math.max(-1, Math.min(1, (want - av) * gain));
        if (!r && Math.abs(u) < ASSIST.dead) u = 0;
      }
    } else {
      u = r;
      level = !r && T > 0.02 && !c.steadiers.some((g) => !g.destroyed) ? Math.min(1, Math.max(-1, LEVEL.k * wrapAngle(c.hold - now) - LEVEL.d * av)) : 0;
    }
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
      // (set to Move or Turn by hand, an engine that does neither fires on D, or on Q)
      const mx = job === 'move' && !m.mx ? 1 : m.mx;
      const rot = job === 'rotate' && !m.rot ? 1 : m.rot;
      const mv = (job === 'move' || job === 'auto') && x * mx > 0 ? 1 : 0;
      let lift = 0;
      let turn = 0;
      if (isLift) {
        lift = T;
        // (one engine alone off the middle, eased off to turn the craft, would only let it fall: see Craft.levels)
        if (level && rot && c.levels) lift = T * (1 + level * rot);
        // (assisted: Q or E held, it turns as hard as it can; let go, it holds its angle by
        // easing off or pushing harder in proportion to the throttle, as levelling does)
        if (c.assist && rot) {
          if (r) turn = u * rot;
          else if (T > 0.02 && c.levels) lift = T * (1 + u * rot);
        } else if (!c.assist && r) turn = r * rot;
      } else if (job === 'rotate' || job === 'auto') turn = Math.max(0, u * rot);
      e.pilotOut = job === 'rotate' ? Math.max(0, u * rot) : Math.min(1, Math.max(0, lift + mv + turn));
    }
    for (const g of c.steadiers) if (!g.destroyed) g.pilotTurn(r, dt);
    // what swivels to turn it (gimballed thrusters, flaps) turns as the engines do
    if (c.swivels.length) {
      const com = c.comL && !c.ref.destroyed ? c.ref.localToWorld(c.comL.x, c.comL.y) : c.com;
      for (const e of c.swivels) if (!e.destroyed) e.pilotSwivel(c.assist ? u : r, com);
    }
    // its guns, held to fire; its boost
    const fire = !!input.fire;
    if (fire || c.firing) for (const w of c.weapons) if (!w.destroyed) w.pilotFire(fire);
    c.firing = fire;
    for (const b of c.boosters) if (!b.destroyed) b.boosting = !!input.boost;
    this.wake(c);
  }

  /**
   * What the air makes of a fast craft (0.4.0): through the speed of sound (as fast as
   * the air there is warm), a boom; fast through the cold air high up, contrails behind
   * its engines.
   */
  private wake(c: Craft): void {
    const g = this.game;
    const p = c.ref;
    if (p.destroyed) return;
    const v = Math.hypot(p.vx, p.vy);
    const rho = g.air.densityAt(p.y);
    const temp = g.air.tempAt(p.y);
    const sound = Math.sqrt(1.4 * 287 * Math.max(50, temp + 273.15));
    const mach = v / sound;
    if (c.mach < 1 && mach >= 1 && rho > 0.02) {
      g.sound.play('explosion/large', { gain: 0.5, x: p.x, vary: 0.15 });
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.particles.emit(PK.Smoke, p.x, p.y, { vx: Math.cos(a) * 6 + p.vx * 0.6, vy: Math.sin(a) * 6 + p.vy * 0.6, life: 0.7, size: 0.2, size1: 0.9, color: 0xffffff, color1: 0xdfe6ee, alpha: 0.6, alpha1: 0, gravity: 0, drag: 3 });
      }
    }
    c.mach = mach;
    // (contrails: the cold high air, fast; from each engine running, or the craft itself)
    if (v > 90 && temp < -25 && rho > 0.004 && Math.random() < 0.8) {
      const from = c.engines.filter((e) => !e.destroyed && (e.pilotOut ?? 0) > 0.05);
      const list = from.length ? from.map((e) => e.pushAt()) : [{ x: p.x, y: p.y }];
      // (laid along the way it came this step, a puff each metre or so: one a step, fast, was a string of beads)
      const dt = g.stepDt;
      const n = Math.min(6, Math.max(1, Math.ceil(v * dt)));
      for (const at of list.slice(0, 4)) {
        for (let i = 0; i < n; i++) {
          const f = 0.02 + ((i + Math.random()) / n) * dt;
          g.particles.emit(PK.Smoke, at.x - p.vx * f, at.y - p.vy * f, { vx: p.vx * 0.05, vy: p.vy * 0.05, life: 5, size: 0.12, size1: 0.7, color: 0xffffff, color1: 0xe6ecf2, alpha: 0.75, alpha1: 0, gravity: 0, drag: 0.3 });
        }
      }
    }
  }

  /**
   * A pilot's order to the craft `sel` is part of (see PilotCommand): whether anything
   * heard it. The next stage fires every part of the lowest stage number not yet fired.
   */
  command(sel: readonly Entity[], cmd: PilotCommand): boolean {
    // (an aircraft's its own: see entities/Planes; a guest's order to one comes here)
    const air = sel.filter((e): e is Entity & { pilotCommand(c: PilotCommand): boolean } => (e as { aircraft?: boolean }).aircraft === true);
    if (air.length) return air.map((a) => a.pilotCommand(cmd)).some(Boolean);
    const c = this.craftOf(sel);
    if (!c) return false;
    if (cmd === 'assist') {
      c.assist = !c.assist;
      c.hold = wrapAngle(c.ref.bodyAngle - c.a0);
      return true;
    }
    if (cmd === 'autopilot') {
      if (c.auto) c.auto = null;
      else {
        c.auto = { alt: c.ref.y + (this.game.map.world ? this.game.air.base : 0) };
        c.assist = true;
        c.hold = wrapAngle(c.ref.bodyAngle - c.a0);
      }
      return true;
    }
    if (cmd === 'stage') return this.stage(c);
    let heard = false;
    for (const e of c.commanded) if (!e.destroyed && e.pilotCommand(cmd)) heard = true;
    return heard;
  }

  /**
   * How hard (N m at full) the craft's engines can turn it (see fly()): the engines that
   * turn it by firing harder (lift engines, as hard as the throttle has them) and those
   * that only turn it; gyroscopes and swivelling parts keep their own.
   */
  private authority(c: Craft, T: number): number {
    let tq = 0;
    for (const e of c.engines) {
      // (not one waiting for its stage, out of air or fuel: counted, the craft was thought
      // ten times as quick to turn as it was, and Q and E only nudged the engines it had)
      if (e.destroyed || e.job === 'wire' || e.job === 'always' || this.held(e) || e.starved || (e as { dry?: boolean }).dry) continue;
      const m = c.mix.get(e);
      if (!m || !m.rot || !m.arm || m.drive || e.hovers) continue;
      const isLift = e.job === 'throttle' || (e.job === 'auto' && m.lift);
      tq += e.pushForce() * m.arm * (isLift ? Math.max(T, 0.05) : 1);
    }
    return tq;
  }

  /**
   * The next stage of the build `e` is part of, fired from outside the flying (its cockpit
   * activated: F): false if it has none left.
   */
  stageOf(e: Entity): boolean {
    // (flown: its craft; not: the build as it is, staged and let go of again)
    const c = this.crafts.find((k) => k.ents.includes(e)) ?? this.assemble([e]);
    return !!c && this.stage(c);
  }

  /**
   * Stages for a build with decouplers in it that no one's staged by hand (0.4.2), worked
   * out from where each thing is: the build is cut where each decoupler lets go (its top
   * side, see Decoupler.release()), and the pieces counted off from the cockpit's. The
   * engines furthest from it run from the start; each decoupler fires with the engines of
   * the piece it leaves the cockpit on, the next stage in. So a two-stage rocket climbs
   * on its lower engines, and Enter (or F on the cockpit) drops them and lights the upper
   * ones. Set any part's stage by hand and the build's stages are as set. Worked out again
   * as the build changes, until a stage is fired.
   */
  private autoStage(ents: Entity[]): void {
    const live = ents.filter((e) => !e.destroyed);
    if (live.some((e) => e.stage > 0 && !e.autoStaged)) return;
    if (live.some((e) => e.autoStaged && e.staged)) return;
    for (const e of live) if (e.autoStaged) {
      e.stage = 0;
      e.autoStaged = false;
    }
    const lay = this.layout(live);
    if (!lay || !lay.far) return;
    const { piece, level, tops, far } = lay;
    const give = (e: Entity, stage: number) => {
      if (stage <= 0 || stage > 9 || !e.stageable) return;
      e.stage = stage;
      e.staged = false;
      e.autoStaged = true;
    };
    for (const e of live) {
      const l = level.get(piece.get(e)!);
      if (l !== undefined && isEngine(e)) give(e, far - l);
    }
    for (const [d, up] of tops) {
      const ls = [piece.get(d)!, ...up.map((t) => piece.get(t)!)].map((p) => level.get(p)).filter((l): l is number => l !== undefined);
      if (ls.length) give(d, far - Math.min(...ls));
    }
  }

  /**
   * How a build comes apart (see autoStage(), droppedAt()), or null with no decoupler in
   * it: the pieces left were each decoupler to let go (of what's fixed to its top side, see
   * Decoupler.release()); each piece's level, how many decouplers from the cockpit's piece
   * (no cockpit: the piece of its highest part); the furthest; and for each thing in it,
   * the lowest stage of the decouplers not yet fired between it and the cockpit (0: none).
   */
  private layout(ents: readonly Entity[]): { piece: Map<Entity, number>; level: Map<number, number>; tops: Map<Entity, Entity[]>; far: number; drop: Map<Entity, number> } | null {
    const live = ents.filter((e) => !e.destroyed);
    const decs = live.filter((e) => isDecoupler(e) && !e.fired);
    if (!decs.length) return null;
    const C = this.game.connections;
    const PHYSICAL = new Set(['rope', 'weld', 'spring', 'hinge', 'pin', 'fuse']);
    // what each decoupler lets go of: what's fixed to its top side
    const cut = new Set<unknown>();
    const tops = new Map<Entity, Entity[]>();
    for (const d of decs) {
      const me = d.parts[0];
      const up: Entity[] = [];
      for (const k of C.connectionsOf(d)) {
        const other = k.a.entity === d ? k.b : k.a;
        if (!other || !PHYSICAL.has(k.kind)) continue;
        if (me.worldToLocal(other.x, other.y).y <= 0) continue;
        cut.add(k);
        up.push(other.entity);
      }
      tops.set(d, up);
    }
    // the pieces left
    const piece = new Map<Entity, number>();
    let n = 0;
    const set = new Set(live);
    for (const e of live) {
      if (piece.has(e)) continue;
      const stack = [e];
      piece.set(e, n);
      while (stack.length) {
        const x = stack.pop()!;
        for (const k of C.connectionsOf(x)) {
          if (!PHYSICAL.has(k.kind) || cut.has(k) || !k.b) continue;
          const y = k.a.entity === x ? k.b.entity : k.a.entity;
          if (!set.has(y) || piece.has(y)) continue;
          piece.set(y, n);
          stack.push(y);
        }
      }
      n++;
    }
    // counted off from the cockpit's piece (no cockpit: the piece of the highest thing in it)
    const cockpit = live.find((e) => (e as { cockpit?: boolean }).cockpit);
    let top = live[0];
    for (const e of live) if (e.parts[0] && top.parts[0] && e.parts[0].y > top.parts[0].y) top = e;
    const home = piece.get(cockpit ?? top)!;
    // (each link: the pieces either side of a decoupler, and the stage it fires in, if it has one)
    const links: [number, number, number][] = [];
    for (const d of decs) for (const t of tops.get(d)!) links.push([piece.get(d)!, piece.get(t)!, d.stage]);
    const level = new Map<number, number>([[home, 0]]);
    const drop = new Map<number, number>([[home, Infinity]]);
    for (let q = [home]; q.length; ) {
      const next: number[] = [];
      for (const at of q) {
        for (const [a, b, st] of links) {
          const to = a === at ? b : b === at ? a : -1;
          if (to < 0 || level.has(to)) continue;
          level.set(to, level.get(at)! + 1);
          drop.set(to, Math.min(drop.get(at)!, st > 0 ? st : Infinity));
          next.push(to);
        }
      }
      q = next;
    }
    let far = 0;
    for (const l of level.values()) far = Math.max(far, l);
    const dropOf = new Map<Entity, number>();
    for (const e of live) {
      const k = drop.get(piece.get(e)!);
      dropOf.set(e, k !== undefined && Number.isFinite(k) ? k : 0);
    }
    return { piece, level, tops, far, drop: dropOf };
  }

  /** Fires the craft's next stage (see Entity.stage): false if none is left. */
  private stage(c: Craft): boolean {
    const next = this.nextStage(c.ents);
    if (!next) return false;
    for (const e of c.ents) {
      if (e.destroyed || e.stage <= 0 || e.staged) continue;
      // (an engine let go of in this stage was burning already, or never lit: it's done with)
      const at = this.firesIn(e);
      if (at === next) e.fireStage();
      else if (at < next) e.staged = true;
    }
    // (a stage let go: what's flown is what's held together now)
    c.madeAt = -Infinity;
    return true;
  }

  /** The lowest stage among these not yet fired, as they fire (see firesIn(); 0: none). */
  private nextStage(ents: readonly Entity[]): number {
    let next = 0;
    for (const e of ents) {
      if (e.destroyed || e.stage <= 0 || e.staged) continue;
      const at = this.firesIn(e);
      if (at > 0 && (!next || at < next)) next = at;
    }
    return next;
  }

  /**
   * The throttle opened on a craft none of whose engines can run, all waiting for stages
   * (0.4.3): the next stage fires, if it lights engines and lets nothing go. Before, W did
   * nothing until Enter, and nothing said why.
   */
  private launch(c: Craft): void {
    for (const e of c.engines) if (!e.destroyed && e.job !== 'wire' && !this.held(e)) return;
    const next = this.nextStage(c.ents);
    if (!next) return;
    let engines = false;
    for (const e of c.ents) {
      if (e.destroyed || e.stage <= 0 || e.staged || this.firesIn(e) !== next) continue;
      if (isDecoupler(e)) return;
      if (isEngine(e)) engines = true;
    }
    if (engines) this.stage(c);
  }

  /** Is the autopilot on for the craft these are part of? */
  autopilotOf(sel: readonly Entity[]): boolean {
    for (const c of this.crafts) if (sel.some((e) => c.ents.includes(e))) return !!c.auto;
    return false;
  }

  /** Is stability assist on for the craft these are part of? */
  assistOf(sel: readonly Entity[]): boolean {
    for (const c of this.crafts) if (sel.some((e) => c.ents.includes(e))) return c.assist;
    return true;
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
    // (how hard it is to turn: each part's own, and its mass out from the middle)
    let inertia = 0;
    for (const e of c.ents) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed || p.detached) continue;
        inertia += p.body.principalInertia() + p.mass * ((p.x - com.x) ** 2 + (p.y - com.y) ** 2);
      }
    }
    c.inertia = inertia;
    // (kept in its frame too: it goes where the craft goes between looks)
    c.comL = c.ref.worldToLocal(com.x, com.y);
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
    // (each engine's lever about the middle (m, + anticlockwise): the same in any frame)
    const arms = c.engines.map((e, i) => {
      if (!dirs[i]) return 0;
      const d = e.pushDir()!;
      const at = e.pushAt();
      return (at.x - com.x) * d.y - (at.y - com.y) * d.x;
    });
    // (against those that can run now: not one waiting for a later stage)
    let reach = 0;
    c.engines.forEach((e, i) => {
      if (e.job !== 'wire' && e.job !== 'always' && !this.held(e)) reach = Math.max(reach, Math.abs(arms[i]));
    });
    const turns = Math.max(TURNS_MIN, reach * TURNS);
    c.engines.forEach((e, i) => {
      const dc = dirs[i];
      if (!dc) {
        c.mix.set(e, { lift: false, mx: 0, rot: 0, drive: !e.hovers });
        return;
      }
      const tq = arms[i] / size;
      const lift = dc.x * ax + dc.y * ay > 0.7;
      const rot = Math.abs(arms[i]) >= turns ? Math.sign(tq) : 0;
      if (lift && rot > 0) up = true;
      if (lift && rot < 0) down = true;
      c.mix.set(e, {
        lift,
        mx: !lift && Math.abs(dc.x) > 0.5 ? Math.sign(dc.x) : 0,
        rot,
        drive: false,
        arm: Math.abs(tq) * size,
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
    let noAir = 0;
    let noFuel = 0;
    for (const e of c.engines) {
      if (e.destroyed) continue;
      n++;
      T = Math.max(T, e.pilotT);
      if ((e.pilotOut ?? 0) === 0 && !(e as { on?: boolean }).on) continue;
      if (this.held(e)) continue;
      if (e.starved) noAir++;
      else if ((e as { dry?: boolean }).dry) noFuel++;
      else running++;
    }
    // (over the ground under it on the World, where the floor is far down out of sight)
    const g = this.game;
    const height = g.env.world ? p.y - g.env.groundAt(p.x, p.y) : p.y - WORLD.floor;
    const fixed = g.connections.fixedOf(c.ents).length > 0;
    const tank = g.fuel.levelOf(c.ents);
    // (its stages: as many as the highest numbered; counted, stages 1 and 3 read "3 of 2")
    let stages = 0;
    for (const e of c.ents) if (!e.destroyed) stages = Math.max(stages, e.stage);
    const next = this.nextStage(c.ents);
    // what it is, for its dashboard
    const wing = c.ents.find((e) => !e.destroyed && typeof (e as { aoa?: number }).aoa === 'number') as { aoa: number; stalled: boolean } | undefined;
    const motor = c.ents.find((e) => !e.destroyed && typeof (e as { rpm?: number }).rpm === 'number') as { rpm: number; gear: number } | undefined;
    const drives = [...c.mix.values()].some((m) => m.drive);
    // (its pilot's g strain: the view greying, going)
    const seat = c.ents.find((e) => !e.destroyed && typeof (e as { strain?: number }).strain === 'number' && (e as { pilot?: unknown }).pilot) as { strain: number } | undefined;
    const kind = stages || tank.capacity ? 'rocket' : wing ? 'plane' : motor || drives ? 'car' : 'craft';
    // as high as it gets coasting up (no air in the way: on the World, gravity weaker up high)
    // (on the World, its path round the planet: the top of it and, if it's going round, the bottom)
    let apo: number | undefined;
    let peri: number | undefined;
    if (g.map.world) {
      const o = orbitOf(p.y + g.air.base, p.vx, p.vy, g.air.radius, Math.abs(g.gravity));
      if (p.vy > 0 || o.peri > 0) apo = o.apo;
      if (o.peri > 0) peri = o.peri;
    }
    return {
      speed: Math.hypot(p.vx, p.vy), height, climb: p.vy, throttle: T, engines: n, running,
      ...(noAir ? { noAir } : {}), ...(noFuel ? { noFuel } : {}), ...(fixed ? { fixed } : {}),
      ...(tank.capacity ? { fuel: tank.fuel, fuelCap: tank.capacity } : {}),
      ...(stages ? { stageNext: next, stages } : {}),
      assist: c.assist, kind, tilt: wrapAngle(p.bodyAngle - c.a0), spin: p.av, g: c.g,
      ...(apo !== undefined ? { apo } : {}), ...(peri !== undefined ? { peri } : {}),
      ...(wing ? { aoa: (wing.aoa * Math.PI) / 180, stall: wing.stalled } : {}),
      ...(motor ? { rpm: motor.rpm, gear: motor.gear + 1 } : {}),
      ...(seat && seat.strain > 0 ? { strain: seat.strain } : {}),
      ...(g.map.world ? { alt: p.y + g.origin.y, air: g.air.densityAt(p.y), temp: g.air.tempAt(p.y) } : {}),
    };
  }

  /** The numbers of the build `sel` is part of (see BuildStats), or null if it has no engines nor wings. */
  buildStats(sel: readonly Entity[]): BuildStats | null {
    const g = this.game;
    const ents = g.connections.assemblyOf(sel);
    let m = 0;
    let mx = 0;
    let my = 0;
    let la = 0;
    let lx = 0;
    let ly = 0;
    let ref: Part | null = null;
    for (const e of ents) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        if (p.destroyed) continue;
        ref ??= p;
        m += p.mass;
        mx += p.x * p.mass;
        my += p.y * p.mass;
        // (wings, fins, flaps: deep into the picture, their area against the air)
        if ((p.depth ?? 0) >= 0.3) {
          const a = p.w * PX * (p.depth ?? 0);
          la += a;
          lx += p.x * a;
          ly += p.y * a;
        }
      }
    }
    const engines = ents.filter((e): e is Entity & Engine => isEngine(e) && !e.destroyed && !e.hovers);
    if (!ref || m <= 0 || (!engines.length && !la)) return null;
    let fx = 0;
    let fy = 0;
    let f = 0;
    let cx = 0;
    let cy = 0;
    let rate = 0;
    for (const e of engines) {
      const d = e.pushDir();
      if (!d) continue;
      const F = e.pushForce();
      const at = e.pushAt();
      fx += d.x * F;
      fy += d.y * F;
      f += F;
      cx += at.x * F;
      cy += at.y * F;
      rate += (e as { burnRate?(): number }).burnRate?.() ?? 0;
    }
    const thrust = Math.hypot(fx, fy);
    const weight = m * Math.abs(g.gravity) * (g.map.world ? g.air.gravityAt(my / m) : 1);
    const tank = g.fuel.levelOf(ents);
    const burn = g.fuel.mode === 'infinite' || (!tank.capacity && g.fuel.mode === 'free') ? Infinity : rate > 0 ? tank.fuel / rate : Infinity;
    return {
      mass: m, com: { x: mx / m, y: my / m },
      thrust, cot: f > 0 ? { x: cx / f, y: cy / f } : null, dir: thrust > 0 ? { x: fx / thrust, y: fy / thrust } : null,
      twr: weight > 0 ? thrust / weight : 0, burn,
      col: la > 0 ? { x: lx / la, y: ly / la } : null,
      speed: Math.hypot(ref.vx, ref.vy),
    };
  }

  /**
   * Where the craft flown here goes coasting from now (0.4.0: its trajectory line):
   * points along its path (local) for up to `secs` s, till it meets the ground, its
   * engines and the air left out (gravity weaker up high, and falling round the planet,
   * as on the World). Empty if nothing's flown, or it's sat still.
   */
  trajectory(secs = 90): V2[] {
    const c = this.mine;
    const g = this.game;
    if (!c || c.ref.destroyed) return [];
    const p = c.ref;
    let x = p.x;
    let y = p.y;
    let vx = p.vx;
    let vy = p.vy;
    const v = Math.hypot(vx, vy);
    if (v < 4 || y - g.env.groundAt(x, y) < 2) return [];
    const world = g.map.world;
    const g0 = Math.abs(g.gravity);
    const out: V2[] = [{ x, y }];
    // (the air holding it back, as thick as it is where it'll be)
    const k = dragOf(c.ents.flatMap((e) => e.parts));
    // (steps short enough for a fair curve: longer the faster, it's going a long way)
    const dt = Math.min(1, Math.max(0.05, 25 / Math.max(v, 1)));
    for (let t = 0; t < secs && out.length < 400; t += dt) {
      const gy = world ? -g0 * g.air.gravityAt(y) + (vx * vx) / (g.air.radius + y + g.air.base) : -g0;
      const s = Math.hypot(vx, vy);
      // (drag no more than stops it in a step)
      const d = Math.min(1 / dt, k * g.air.densityAt(y) * s);
      vx -= vx * d * dt;
      vy -= vy * d * dt;
      vy += gy * dt;
      x += vx * dt;
      y += vy * dt;
      out.push({ x, y });
      if (y < g.env.groundAt(x, y)) break;
    }
    return out;
  }

  /** Forgets every craft (a scene cleared or loaded). */
  clear(): void {
    this.crafts.length = 0;
  }
}

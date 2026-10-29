import type { V2 } from '../engine/math';
import type { ConnKind, ConnOpts } from '../systems/Connections';
import type { EntityConfig, EntityState } from '../world/types';
import type { Snapshot } from '../world/Snapshot';
import type { PowerId } from '../tools/Controls';
import type { ArrangeHow, LayerDir } from '../tools/Arrange';
import type { MapSpec } from '../world/Maps';
import type { Fx, Hold, PartRef } from './Effects';
import type { MusicPlan } from '../engine/Music';
import type { WeatherState } from '../systems/Weather';

/** Someone in the game (the host is player 1). */
export interface PlayerInfo {
  id: number;
  name: string;
  /** Their cursor's colour (CSS). */
  color: string;
}

/** A connection as the host has it: its number there, and its ends by part. */
export interface NetConn {
  id: number;
  kind: ConnKind;
  a: PartRef;
  la: V2;
  b: PartRef | null;
  lb: V2;
  rest: number;
  limit?: number;
  ref?: number;
  stiffness?: number;
  burn?: [number, number];
  end?: V2;
  opts?: ConnOpts;
}

/** The puddles on the floor (see PuddleState), their arrays as base64. */
/** The water (see Fluid.pack()): x, y as float32s, vx, vy as int16s, each in base64. */
export interface NetFluid {
  n: number;
  xy: string;
  v: string;
}

export interface NetPuddles {
  lo: number;
  hi: number;
  h: string;
  kind: string;
  burn: string;
  oil?: string;
}

// ---- host to guest ---------------------------------------------------------------------

/** Everything, when a guest joins (and again whenever the host's scene is replaced wholesale). */
export interface Welcome {
  t: 'welcome';
  you: number;
  players: PlayerInfo[];
  /** The scene as a save (see SaveLoad), with each entity's net id in its order. */
  save: string;
  ids: number[];
  conns: NetConn[];
  time: NetTime;
}

/**
 * The host's clock: paused or not, how fast, and how many solver iterations its
 * physics runs (the host's world is the one everyone sees, so its choice is everyone's).
 */
export interface NetTime {
  paused: boolean;
  scale: number;
  iterations?: number;
  /** Its gravity (m/s², downward negative). */
  gravity?: number;
  /** Its sandbox music's plan, the start on the host's clock: everyone hears the same track at the same place. */
  music?: MusicPlan;
  /** Its weather and world light (Settings > World): everyone's is the host's. */
  weather?: WeatherState;
}

/** What changed since the last tick (about twenty a second). */
export interface Tick {
  t: 'tick';
  /** The host's clock when it was sent (ms): poses are shown a moment behind it, smoothly. */
  ht: number;
  spawn?: { ids: number[]; ents: EntityState[] };
  gone?: number[];
  /** Parts destroyed (a limb blown off, a board snapped in two). */
  cut?: PartRef[];
  /** Parts made anew in their place in the body (a limb grown back: see Regrowth), after this tick's cuts. */
  grow?: PartRef[];
  /** Objects' own state (a lamp switched on, a bomb's fuse burning down), as serializeExtra() has it. */
  extra?: [number, Record<string, unknown>][];
  /** How people and animals are (see VITALS). */
  vitals?: [number, Record<string, unknown>][];
  /** Every connection, when any changed. */
  conns?: NetConn[];
  /** Poses of what moved: net id, part, x, y, angle (Float32, base64). */
  tf?: string;
  /** Part states that changed: net id, part, hp, burning, charred, flags (PART_FLAGS) (Float32, base64). */
  ps?: string;
  puddles?: NetPuddles;
  fluid?: NetFluid;
  fx?: Fx[];
  holds?: Hold[];
  time?: NetTime;
  /** The map, when its ground changed (the Terrain tool) or it was renamed: switching maps sends everything again. */
  map?: MapSpec;
  /** Where everyone's cursor is: player, x, y. */
  cursors?: [number, number, number][];
  /** Every seeker held on (see NetSeeker), when any changed: the player holding one draws its reticle. */
  seekers?: NetSeeker[];
  /** The host's statistics of the game (see Stats), now and then as they change. */
  stats?: Record<string, number>;
}

/** What a seeker's gate is on: a part (and the point on it, part-local m), a whole thing (its middle), or a point (world m). */
export type NetSight = { p: PartRef; local: [number, number] } | { e: number } | { at: [number, number] };

/**
 * A Spike launcher's seeker held on (see SpikeLauncher): its net id, the player
 * holding it, how long its gate has been on what it's on (s), what that is,
 * what it has locked on, and (firing a Strike) the targets in its square.
 */
export type NetSeeker = [number, number, number, NetSight | null, NetSight | null, NetSight[]?];

export interface PlayersMsg {
  t: 'players';
  list: PlayerInfo[];
}

/** A message for the guest's status bar (as its own game would show it). */
export interface ToastMsg {
  t: 'toast';
  msg: string;
}

export type HostMsg = Welcome | Tick | PlayersMsg | ToastMsg;

/** Part flags in a tick's part states. */
export const PART_FLAGS = { frozen: 1, left: 2, noCollide: 4 } as const;

// ---- guest to host -----------------------------------------------------------------------

/**
 * What a guest does to the world, for the host to do in its game. Entities are
 * by net id, parts by PartRef, connections by the host's numbers.
 */
export type GuestOp =
  | { op: 'hello'; name: string }
  /** Where their cursor is, and their view's zoom (screen px per m: a seeker's gate covers as much as it does on their screen). */
  | { op: 'cursor'; x: number; y: number; zoom?: number }
  | { op: 'spawn'; def: string; x: number; y: number; left: boolean; config?: EntityConfig; frozen?: boolean; active?: boolean; angle?: number }
  | { op: 'place'; snap: Snapshot; dx: number; dy: number; label: string; frozen?: boolean; active?: boolean }
  /** Z: takes back the newest thing this guest spawned. */
  | { op: 'unspawn' }
  | { op: 'delete' | 'freeze' | 'ignite' | 'duplicate' | 'flip' | 'jump' | 'weld' | 'activate' | 'release' | 'fightEach'; ids: number[] }
  | { op: 'weightless' | 'noCollide'; ids: number[]; on: boolean }
  | { op: 'rotate'; ids: number[]; angle: number }
  /** The drive keys held for these vehicles (-1, 0 or 1: left/right on screen, a tank's barrel down/up), renewed while held. */
  | { op: 'drive'; ids: number[]; x: number; aim: number }
  | { op: 'freezePart'; p: PartRef }
  | { op: 'rebuild'; id: number; config?: EntityConfig; at?: V2 }
  /** Takes hold of a part (`ids`: the selection, which moves with it; with time paused, their assemblies too, or with `alone` just them). */
  | { op: 'grab'; p: PartRef; x: number; y: number; ids: number[]; alone?: boolean }
  /** Where the hand holding it is now, how it's being turned (A/D), and snapping (Alt): the grid's size (m) and the angle's step (rad). */
  | { op: 'drag'; x: number; y: number; rot: number; snap: boolean; grid?: number; step?: number }
  | { op: 'drop'; x: number; y: number }
  | { op: 'power'; kind: PowerId | null; x: number; y: number; fx: number; fy: number }
  /** A connection (`more`: from the same first end to several things at once, as one edit). */
  | { op: 'connect'; kind: ConnKind; a: PartRef; wa: V2; b: PartRef | null; wb: V2; stiffness?: number; rest?: number; opts?: ConnOpts; more?: { b: PartRef | null; wb: V2 }[] }
  /** A connection's settings from its menu (see ConnOpts). */
  | { op: 'editConn'; conn: number; patch: Partial<Record<keyof ConnOpts, unknown>> }
  /** One end of a connection put down somewhere else (on a part, or the background: null). */
  | { op: 'moveEnd'; conn: number; end: 'a' | 'b'; p: PartRef | null; w: V2 }
  /** A rope's, spring's or fuse cord's length (m). */
  | { op: 'setRest'; conn: number; len: number }
  | { op: 'layer'; ids: number[]; dir: LayerDir }
  /** Things set to an angle (degrees). */
  | { op: 'setAngle'; ids: number[]; angle: number }
  | { op: 'arrange'; ids: number[]; how: ArrangeHow }
  | { op: 'nudge'; ids: number[]; dx: number; dy: number }
  /** Back to build: the scene as it was before time was last started (see History). */
  | { op: 'rewind' }
  | { op: 'unconnect'; conns: number[] }
  | { op: 'lightAt'; x: number; y: number; r: number }
  | { op: 'light'; conn: number; end: 0 | 1 }
  | { op: 'limit'; conn: number; rad: number | null }
  | { op: 'stiffness'; conn: number; k: number }
  | { op: 'fight'; a: number; b: number }
  | { op: 'edit'; id: number; key: string; v: number }
  | { op: 'editReset'; id: number }
  /** One of an object's own context-menu entries, by its label (and its submenu's). */
  | { op: 'act'; id: number; path: string[]; part?: number }
  | { op: 'time'; paused?: boolean; scale?: number; step?: boolean }
  | { op: 'clear' }
  /** Switches maps (the scene is cleared), or changes the ground of the one in play (the Terrain tool). */
  | { op: 'map' | 'terrain'; map: MapSpec }
  | { op: 'load'; save: string };

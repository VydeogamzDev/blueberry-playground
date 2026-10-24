import { RAPIER } from '../engine/Physics';
import { MAX_ZOOM, MIN_ZOOM, PX, WORLD } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import { SIZE_LIMITS, type ContextAction, type EntityConfig, type ItemDef } from '../world/types';
import { capture, instantiate, type Snapshot } from '../world/Snapshot';
import { loadFromString } from '../world/SaveLoad';
import { History } from '../world/History';
import { HINGE_LIMITS, RAMPS, SPRING_STIFFNESS, stiffnessStep, type ConnKind, type Connection } from '../systems/Connections';
import { PK } from '../systems/Particles';
import { getItem } from '../catalog/items';
import type { ShapeMaterialId } from '../art/props';
import type { ShapeForm } from '../entities/Shape';
import { Car } from '../entities/Car';
import { Tank } from '../entities/Tank';
import { cleanOutline, segmentsCross, selfCrossing, signedArea, type Pt } from '../engine/geometry';
import { ACTIONS, Bindings, isModifier, type ActionId } from './Bindings';
import { isLiving } from '../ui/VitalsPanel';
import { isFighter, setFighting, type Fighter } from '../systems/Fighting';
import { allies, teamActions } from '../systems/Teams';
import type { GuestOp } from '../net/protocol';
import type { MapSpec } from '../world/Maps';
import type { PartRef } from '../net/Effects';
import { ConnectTool, CONN_LABEL } from './ConnectTool';
import { Arrange, centreOf, dragPaused as dragPausedBy, type LayerDir } from './Arrange';
import { Placer, imagesOfParts, snapCenter } from './Placer';
import { boxOf } from './Guides';
import { connectionActions, connectionTitle } from '../ui/ConnectionMenu';
import { store } from '../engine/Store';

export { dragPaused } from './Arrange';

/** What the controls need in someone else's multiplayer game: edits go to the host (see net/Guest). */
export interface GuestLink {
  send(op: GuestOp): void;
  ref(p: Part): PartRef;
  ids(list: Entity[]): number[];
  /** A connection's number in the host's game. */
  conn(c: Connection): number;
}

export interface UIBridge {
  openContextMenu(sx: number, sy: number, title: string, actions: ContextAction[]): void;
  closeContextMenu(): void;
  isMenuOpen(): boolean;
  /** A panel is open over the sandbox (Settings, Controls, the pause menu, a dialog, Edit gun…): the keys are its. */
  isPanelOpen(): boolean;
  toast(msg: string): void;
  onArmedChanged(def: ItemDef | null): void;
  /** The tool bar's selection or tab changed. */
  onToolChanged(): void;
  toggleCatalog(): void;
  /** Shows or hides the toybox and the tool bar together. */
  toggleToybox(): void;
  /** Shows or hides all of the interface. */
  toggleInterface(): void;
  toggleHelp(): void;
  togglePauseMenu(): void;
  /** Closes an open panel (help, settings, the pause menu); false if none was open. */
  closeOverlays(): boolean;
  /** Switches the touch layout on (a finger touched the sandbox) or off (a mouse was used). */
  setTouchMode(on: boolean): void;
  refreshToolbar(): void;
  save(): void;
  load(): void;
  /** Asks for a name and saves these things as a contraption in the toybox. */
  saveContraption(list: Entity[]): void;
  /** A panel of sliders for an object's numbers (Edit gun…). */
  editValues(ed: ValueEditor): void;
}

/** One number in an object's edit panel. */
export interface EditField {
  /** Which number it is (for tests). */
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** The slider goes along a log scale (for numbers that span orders of magnitude). */
  log?: boolean;
  get(): number;
  set(v: number): void;
}

/** An object's numbers to change in a panel, offered in its context menu (an entity's editor()). */
export interface ValueEditor {
  /** The context menu's entry. */
  label: string;
  title: string;
  fields: EditField[];
  /** Back to its kind's numbers. */
  reset(): void;
  /** False once the object is gone (undone, deleted, a scene loaded over it): the panel closes. */
  alive?(): boolean;
  /** Buttons for values often wanted (Set angle's Level, 90°...), by their labels. */
  buttons?: [string, () => void][];
}

/** Dragging one of a resizable object's size handles. */
interface Resize {
  e: Entity;
  part: Part;
  /** Which handle: -1, 0 or 1 along the object's own x and y (0: that side doesn't change). */
  hx: number;
  hy: number;
  /** Its size (sprite pixels) before, and as the handle has it now. */
  w0: number;
  h0: number;
  w: number;
  h: number;
  /** A size being typed in ("1.2 x 0.5", in metres). */
  typed?: string;
}

/** Turning the selection by the round handle over it (time paused). */
interface Spin {
  list: Entity[];
  /** What it turns about, the cursor's angle from there when it started, and how far it has turned so far. */
  cx: number;
  cy: number;
  a0: number;
  turned: number;
  moved: boolean;
}

/** The Shape tool's outline in progress. */
export interface Draft {
  /** Corners placed so far (world). */
  pts: V2[];
  /** Where the button went down, until it's released. */
  press: V2 | null;
  /** Shift was held: a box dragged out is round. */
  round: boolean;
}

/** The Terrain tool, while a map is being edited: the Shape tool draws ground with it (see tools/TerrainTool). */
export interface TerrainEditor {
  /** Makes ground of what the Shape tool drew. */
  make(form: ShapeForm, pts: V2[]): void;
  /** Takes away the piece of ground at a point; false if there's none there. */
  removeAt(x: number, y: number): boolean;
  /** Stops editing. */
  stop(): void;
}

export interface Grab {
  part: Part;
  local: V2;
  anchor: RAPIER.RigidBody | null;
  joint: RAPIER.ImpulseJoint | null;
  frozenMove: boolean;
  offset: V2;
  savedDamping: number;
  /** Where the hand holding it is (it follows the cursor, see preStep()). */
  at: V2;
  /** A frozen object moved by hand: recorded for undo once it first moves. */
  moved?: boolean;
  /** Rotation asked for while paused and not yet applied (snapping turns in whole steps). */
  turn: number;
  /** The angle a rigid thing is held at (it doesn't swing round the hand); null for people and animals, which dangle. */
  hold: number | null;
  /** The rest of the selection, dragged along: each held at its middle, kept `off` from the cursor (see grabAlong()). */
  along?: (Grab & { off: V2 })[];
  /** Moved with time paused: only what's held (Ctrl as it was taken), not everything joined to it. */
  alone?: boolean;
  /** What moves with it while time is paused (its assembly, or with `alone` just it), worked out as it first moves so. */
  moveList?: Entity[];
}

/**
 * The tool bar's tools (keys 1-8), as in People Playground: dragging, then the
 * connections, grouped in slots whose key pressed again steps through the
 * slot's kinds (People Playground 1.15): the Rope slot's fuse cord. The Pin
 * pins to what's behind (or the background) with a click, as People
 * Playground's does, and hinges two things dragged from one to the other: the
 * old Hinge tool, still there for saves and scripts (`setTool('hinge')`).
 */
export type ToolId = 'drag' | ConnKind | 'remove' | 'shape';
export interface ToolSlot {
  id: ToolId;
  variants: ToolId[];
}
export const TOOL_SLOTS: ToolSlot[] = [
  { id: 'drag', variants: ['drag'] },
  { id: 'rope', variants: ['rope', 'fuse'] },
  { id: 'weld', variants: ['weld'] },
  { id: 'spring', variants: ['spring'] },
  { id: 'pin', variants: ['pin', 'hinge'] },
  { id: 'wire', variants: ['wire'] },
  { id: 'remove', variants: ['remove'] },
  { id: 'shape', variants: ['shape'] },
];
/** The slots' own tools, in key order (the tool bar's buttons). */
export const TOOLS: ToolId[] = TOOL_SLOTS.map((s) => s.id);

/** Which slot (from 0) a tool is in. */
export function toolSlot(id: ToolId): number {
  return TOOL_SLOTS.findIndex((s) => s.variants.includes(id));
}

/** The kinds of the slot a tool is in that show on the tool bar, under its button (the Pin's hinge doesn't: it's the same tool). */
export function slotVariants(id: ToolId): ToolId[] {
  const s = TOOL_SLOTS[toolSlot(id)];
  return s ? s.variants.filter((v) => v !== 'hinge') : [];
}

/** The tool bar's powers (Ctrl switches to them), as in People Playground. */
export type PowerId = 'push' | 'pull' | 'lift' | 'lightning' | 'pyro';
export const POWERS: PowerId[] = ['push', 'pull', 'lift', 'lightning', 'pyro'];

/**
 * Drag spring tuning: its natural frequency (rad/s) and damping ratio, for rigid
 * things (stiff, critically damped: they go where the cursor goes without
 * swinging round it) and for people and animals (softer, so a limb pulls the
 * body along without tearing at the joints; damped enough not to orbit), with
 * how fast the rest of their body's swinging about the hand dies away (1/s: they
 * dangle, but don't spin round it like a propeller); how fast a held thing turns
 * to the angle it's held at with A/D (1/s); how a rigid thing swings back to
 * that angle when whirled about (rad/s and damping ratio: loose enough to spin
 * round, damped so the spin dies away in a second or so) and its fastest spin
 * (rad/s); and how fast the hand can follow the cursor (m/s: about a hard throw).
 */
export const DRAG = { rigid: { freq: 22, ratio: 1 }, limp: { freq: 13, ratio: 0.45, sway: 4 }, holdRate: 14, spin: { freq: 4, ratio: 0.3, most: 30 }, maxSpeed: 25 };

/**
 * The powers: how far push, pull and lift reach (m) and how hard they act (m/s²);
 * how fast the cursor must flick (screen px/s) to throw lightning or flame, and
 * how far those go (m).
 */
export const POWER = { radius: 2.5, push: 90, pull: 55, lift: 14, flick: 1600, boltReach: 14, flameReach: 4.5 };

/** Slow motion's speed (People Playground's default: 20%). */
export const SLOW_MOTION = 0.2;

const SELECT_COLOR = 0xf2d16b;
const HOVER_COLOR = 0x9aa3ad;
/** A finger held this long without moving opens the context menu. */
const LONG_PRESS_MS = 500;
/** Screen pixels a finger may wander and still be a long press. */
const PRESS_SLOP = 10;
/** Commands that act again while their key auto-repeats. */
const REPEATS = new Set(ACTIONS.filter((a) => a.repeat).map((a) => a.id));
const PLACEMENT_STORE = 'blueberry-placement';
/** Two presses this close together (ms, screen px) are a double-click. */
const DOUBLE_MS = 350;
const DOUBLE_SLOP = 6;
/** The round handle that turns the selection: this far (screen px) over the top of the box round it. */
export const SPIN_HANDLE = 24;
/** Keys that type a size while a size handle is held. */
const SIZE_KEYS: Record<string, string> = {
  Period: '.', NumpadDecimal: '.', Comma: ' x ', KeyX: ' x ', NumpadMultiply: ' x ',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [[`Digit${i}`, String(i)], [`Numpad${i}`, String(i)]]).flat()),
};

/** The player's way of spawning (see Controls.placement): People Playground's keys unless they chose clicks. */
function loadPlacement(): 'keys' | 'click' {
  try {
    return store.getItem(PLACEMENT_STORE) === 'click' ? 'click' : 'keys';
  } catch {
    return 'keys';
  }
}

/** Where a dragged point may go: (x, y) kept inside the world. */
export function inWorld(x: number, y: number): V2 {
  return { x: clamp(x, WORLD.left + 0.05, WORLD.right - 0.05), y: clamp(y, WORLD.floor + 0.02, WORLD.ceiling - 0.05) };
}

/**
 * Takes hold of a part at a world point: a frozen one is moved by hand, anything
 * else hangs from a spring to a hand that follows the cursor (see stepGrab()).
 */
export function beginGrab(game: Game, part: Part, wx: number, wy: number): Grab {
  const local = part.worldToLocal(wx, wy);
  const limp = part.entity.canWalk;
  const g: Grab = {
    part, local, anchor: null, joint: null, frozenMove: part.frozen,
    offset: { x: part.x - wx, y: part.y - wy }, savedDamping: part.body.angularDamping(), at: { x: wx, y: wy }, turn: 0,
    hold: limp ? null : part.body.rotation(),
  };
  if (!part.frozen) {
    const world = game.physics.world;
    g.anchor = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(wx, wy));
    // Stiffness scales with the dragged entity's mass so everything follows the
    // cursor with the same feel. The spring is solved implicitly by Rapier, which
    // keeps articulated chains (ragdoll limbs) stable under strong pulls. (Of a
    // person or animal, only what's still joined to the part counts: a severed head
    // is light.)
    const M = Math.max(part.mass, limp ? part.entity.limpMass(part) : part.entity.dragMass());
    const { freq } = limp ? DRAG.limp : DRAG.rigid;
    const k = M * freq * freq;
    // (undamped: a spring joint only damps motion along itself, so whatever it holds
    // would circle the hand at a steady distance forever; see stepGrab())
    g.joint = world.createImpulseJoint(RAPIER.JointData.spring(0, k, 0, { x: 0, y: 0 }, local), g.anchor, part.body, true);
    g.joint.setContactsEnabled(false);
    part.body.setAngularDamping(Math.max(g.savedDamping, 1.5));
    part.body.wakeUp();
  }
  part.entity.onGrab(part, true);
  return g;
}

/**
 * Dragging one of a selection drags all of it: the others are each held by
 * their heaviest part (a person's torso, a car's body), by a hand of their own
 * that keeps where it was from the cursor.
 */
export function grabAlong(game: Game, g: Grab, list: Entity[]): void {
  const ent = g.part.entity;
  if (!list.includes(ent)) return;
  g.along = [];
  for (const e of list) {
    if (e === ent || e.destroyed) continue;
    const parts = e.parts.filter((p) => !p.destroyed);
    if (!parts.length) continue;
    const p = parts.reduce((a, b) => (b.mass > a.mass ? b : a));
    g.along.push({ ...beginGrab(game, p, p.x, p.y), off: { x: p.x - g.at.x, y: p.y - g.at.y } });
  }
}

/** Lets go of what a grab holds (`at`: where the cursor is). */
export function releaseGrab(game: Game, g: Grab, at: V2): void {
  for (const o of g.along ?? []) releaseGrab(game, o, { x: at.x + o.off.x, y: at.y + o.off.y });
  g.along = undefined;
  const world = game.physics.world;
  if (g.joint && g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
  if (g.anchor && g.anchor.isValid()) world.removeRigidBody(g.anchor);
  if (!g.part.destroyed) {
    g.part.body.setAngularDamping(g.savedDamping);
    g.part.entity.onGrab(g.part, false, at);
  }
}

/**
 * A physics step of dragging toward `t`, turning at `rot` (A/D: 1 or -1, more
 * with Shift). `moved` is called when a frozen thing first moves (for undo).
 * False if the held thing was frozen or unfrozen meanwhile: the grab must start again.
 */
export function stepGrab(g: Grab, t: V2, rot: number, dt: number, moved: () => void): boolean {
  if (g.along) stepAlong(g, t, rot, dt, moved);
  const { x: tx, y: ty } = t;
  if (g.frozenMove) {
    // was unfrozen while held: switch to physical dragging
    if (!g.part.frozen) return false;
    const ent = g.part.entity;
    const nx = tx + g.offset.x;
    const ny = ty + g.offset.y;
    const dx = nx - g.part.x;
    const dy = ny - g.part.y;
    if (!g.moved && (rot !== 0 || Math.abs(dx) + Math.abs(dy) > 1e-5)) {
      g.moved = true;
      moved();
    }
    if (Math.abs(dx) + Math.abs(dy) > 1e-5) {
      if (ent.frozen) ent.translate(dx, dy);
      else g.part.teleport(nx, ny, g.part.body.rotation());
    }
    if (rot !== 0) {
      const c = g.part.body.translation();
      if (ent.frozen) ent.rotateAbout(c.x, c.y, rot * 0.025);
      else g.part.teleport(c.x, c.y, g.part.body.rotation() + rot * 0.025);
    }
    return true;
  }
  // frozen while held: a spring can't move what's frozen, so it's moved by hand from now on
  if (g.part.frozen) {
    const world = g.part.entity.game.physics.world;
    if (g.joint && g.joint.isValid()) world.removeImpulseJoint(g.joint, true);
    if (g.anchor && g.anchor.isValid()) world.removeRigidBody(g.anchor);
    g.joint = g.anchor = null;
    g.part.body.setAngularDamping(g.savedDamping);
    return false;
  }
  // the hand chases the cursor no faster than a hard throw: a cursor that jumps
  // (a dropped frame, a tap on a touch screen) would fling it at hundreds of m/s
  const dx = tx - g.at.x;
  const dy = ty - g.at.y;
  const d = Math.hypot(dx, dy);
  const most = DRAG.maxSpeed * dt;
  const prev = g.at;
  g.at = d > most ? { x: g.at.x + (dx / d) * most, y: g.at.y + (dy / d) * most } : { x: tx, y: ty };
  g.anchor?.setNextKinematicTranslation(g.at);
  const b = g.part.body;
  // its motion relative to the hand dies away, every way: critically damped for
  // rigid things, less for people and animals, whose limbs pull the rest along
  const { freq, ratio } = g.hold === null ? DRAG.limp : DRAG.rigid;
  const f = 1 - Math.exp(-2 * ratio * freq * dt);
  const hx = (g.at.x - prev.x) / dt;
  const hy = (g.at.y - prev.y) / dt;
  // (a thing in one piece swings and spins in the hand; one of several, a car say,
  // or welded to others, is held firmly at its angle, or the rest of it would drag it round)
  if (g.hold !== null && g.part.entity.parts.length === 1 && !weldedOn(g.part)) {
    holdRigid(g, hx, hy, f, rot, dt);
    return true;
  }
  const v = b.linvel();
  b.setLinvel({ x: v.x - (v.x - hx) * f, y: v.y - (v.y - hy) * f }, true);
  if (g.hold === null) {
    // (only what's still joined to the held part swings with it: not a body whose
    // head is carried off)
    const s = 1 - Math.exp(-DRAG.limp.sway * dt);
    for (const p of g.part.entity.connectedParts(g.part)) {
      if (p === g.part || p.frozen) continue;
      const u = p.body.linvel();
      p.body.setLinvel({ x: u.x - (u.x - hx) * s, y: u.y - (u.y - hy) * s }, true);
      p.body.setAngvel(p.body.angvel() * (1 - s), true);
    }
  }
  if (g.hold !== null) {
    // a rigid thing stays at the angle it's held at, turned by A/D
    g.hold += rot * 5 * dt;
    b.setAngvel(clamp(wrapAngle(g.hold - b.rotation()) * DRAG.holdRate, -20, 20), true);
  } else if (rot !== 0) {
    const target = rot * 5;
    b.setAngvel(b.angvel() + (target - b.angvel()) * 0.2, true);
  }
  return true;
}

/** Whether a part is welded to another thing's (one piece of something bigger). */
function weldedOn(p: Part): boolean {
  return p.entity.game.connections.list.some((k) => k.kind === 'weld' && k.joint && k.b && k.a.entity !== k.b.entity && (k.a === p || k.b === p));
}

/** An angle brought into -π..π. */
function wrapAngle(a: number): number {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * A rigid thing in the hand: the held point keeps with the hand (its motion
 * relative to the hand damped by `f`), but the thing turns about it. Whirled,
 * a knife held by its handle swings and spins round; let be, the spin dies away
 * and it comes back to the angle it's held at (A/D turn that). It weighs nothing
 * in the hand: carried, not hung, so it doesn't tip over.
 */
function holdRigid(g: Grab, hx: number, hy: number, f: number, rot: number, dt: number): void {
  const b = g.part.body;
  const m = b.mass();
  const I = b.principalInertia();
  const com = b.worldCom();
  const at = g.part.localToWorld(g.local.x, g.local.y);
  const rx = at.x - com.x;
  const ry = at.y - com.y;
  const v = b.linvel();
  // (the step's gravity, taken back beforehand)
  v.y -= b.gravityScale() * g.part.entity.game.physics.world.gravity.y * dt;
  let w = b.angvel();
  // the impulse at the held point that takes `f` of its speed relative to the hand
  // away (solved with how hard that point is to push, mass and turning both)
  const ex = -(v.x - w * ry - hx) * f;
  const ey = -(v.y + w * rx - hy) * f;
  const k11 = 1 / m + (ry * ry) / I;
  const k22 = 1 / m + (rx * rx) / I;
  const k12 = (-rx * ry) / I;
  const det = k11 * k22 - k12 * k12;
  const jx = (k22 * ex - k12 * ey) / det;
  const jy = (k11 * ey - k12 * ex) / det;
  let vx = v.x + jx / m;
  let vy = v.y + jy / m;
  w += (rx * jy - ry * jx) / I;
  // a damped swing back to the held angle, turning it about the held point
  // (which stays where it is)
  g.hold! += rot * 5 * dt;
  const off = wrapAngle(g.hold! - b.rotation());
  let w1 = w;
  if (rot !== 0) w1 = off * DRAG.holdRate;
  else w1 += (DRAG.spin.freq * DRAG.spin.freq * off - 2 * DRAG.spin.ratio * DRAG.spin.freq * w1) * dt;
  w1 = clamp(w1, -DRAG.spin.most, DRAG.spin.most);
  vx += (w1 - w) * ry;
  vy -= (w1 - w) * rx;
  b.setLinvel({ x: vx, y: vy }, true);
  b.setAngvel(w1, true);
}

/** A step of the rest of the selection following the cursor (see grabAlong()). */
function stepAlong(g: Grab, t: V2, rot: number, dt: number, moved: () => void): void {
  const list = g.along!;
  // (one Move for undo, whichever of them moves first)
  const once = () => {
    if (g.moved) return;
    g.moved = true;
    moved();
  };
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.part.destroyed) {
      list.splice(i, 1);
      continue;
    }
    const at = inWorld(t.x + o.off.x, t.y + o.off.y);
    // (frozen or unfrozen while held: it starts again, moved by hand or hanging from one)
    if (!stepGrab(o, at, rot, dt, once)) {
      const game = o.part.entity.game;
      list[i] = { ...beginGrab(game, o.part, o.part.x, o.part.y), off: o.off };
    }
  }
}

/**
 * The powers (push, pull, lift, lightning, pyro), used at a point each physics
 * step while the button is held. One each for the player and, in a multiplayer
 * game, every guest (see net/Host).
 */
export class Powers {
  /** Game time until the next bolt or burst of flame. */
  private wait = 0;

  constructor(private game: Game) {}

  /**
   * A step of `kind` (null: none in use) at (x, y); `flick` is how fast the
   * cursor moves on screen (px/s, y down), which throws lightning and flame.
   */
  step(kind: PowerId | null, x: number, y: number, flick: V2, dt: number): void {
    this.wait -= dt;
    if (!kind) return;
    const fs = Math.hypot(flick.x, flick.y);
    // a flick's direction in the world (the screen's y runs down)
    const fx = flick.x / (fs || 1);
    const fy = -flick.y / (fs || 1);
    if (kind === 'lightning') {
      if (fs > POWER.flick && this.wait <= 0) {
        this.wait = 0.12;
        this.bolt(x, y, fx, fy);
      }
      return;
    }
    if (kind === 'pyro') {
      this.game.sound.hold(this, 'fire/crackle_loop', 0.35, x);
      for (let i = 0; i < 2; i++) this.game.particles.fire(x, y - 0.1, 0.8);
      // (frozen things too: they don't move, but they burn)
      for (const p of this.partsNear(x, y, 0.45, true)) this.game.fire.ignite(p, 0.7);
      this.game.connections.igniteNear(x, y, 0.3);
      if (y - WORLD.floor < 0.45) this.game.puddles.igniteNear(x, 0.3);
      if (fs > POWER.flick && this.wait <= 0) {
        this.wait = 0.08;
        this.flame(x, y, fx, fy, Math.min(1, fs / (POWER.flick * 2.5)));
      }
      return;
    }
    const R = POWER.radius;
    for (const p of this.partsNear(x, y, R)) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy) || 1e-3;
      const near = 1 - Math.min(1, d / R);
      const v = p.body.linvel();
      let ax = 0;
      let ay = 0;
      if (kind === 'push') {
        ax = (dx / d) * POWER.push * near;
        ay = (dy / d) * POWER.push * near;
      } else if (kind === 'pull') {
        // toward the cursor, braking near it so things gather there rather than overshoot
        const a = POWER.pull * (0.3 + 0.7 * near) * Math.min(1, d);
        ax = (-dx / d) * a - v.x * 3;
        ay = (-dy / d) * a - v.y * 3;
      } else {
        // lift: gravity cancelled, and a spring up (or down) to the cursor's height
        ax = -v.x * 1.5;
        ay = -this.game.gravity + clamp((y - p.y) * POWER.lift - v.y * 3, -20, 40);
      }
      const m = p.mass;
      p.body.applyImpulse({ x: ax * m * dt, y: ay * m * dt }, true);
    }
  }

  /** Loose parts within `r` of (x, y) (and frozen ones, with `frozen`). */
  private partsNear(x: number, y: number, r: number, frozen = false): Part[] {
    const out = new Set<Part>();
    this.game.physics.world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(r), (c) => {
      const p = this.game.physics.partOf(c);
      if (p && !p.destroyed && (frozen || !p.frozen)) out.add(p);
      return true;
    });
    return [...out];
  }

  /** Lightning from (x, y) along (dx, dy): a jagged bolt that shocks and knocks what it hits. */
  private bolt(x: number, y: number, dx: number, dy: number): void {
    const g = this.game;
    const world = g.physics.world;
    const ray = new RAPIER.Ray({ x, y }, { x: dx, y: dy });
    const hit = world.castRay(ray, POWER.boltReach, true, undefined, undefined, undefined, undefined, (c) => {
      const p = g.physics.partOf(c);
      return !p || !p.destroyed;
    });
    const len = hit ? hit.timeOfImpact : POWER.boltReach;
    const ex = x + dx * len;
    const ey = y + dy * len;
    // a few kinked segments, the kinks across the bolt
    const n = Math.max(3, Math.round(len / 0.6));
    let px = x;
    let py = y;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const off = i === n ? 0 : (Math.random() - 0.5) * 0.5;
      const qx = x + dx * len * t - dy * off;
      const qy = y + dy * len * t + dx * off;
      g.projectiles.drawBeam(px, py, qx, qy, PX * 1.5, 0xd8ecff, 0.14);
      px = qx;
      py = qy;
    }
    g.renderer.addLight(ex, ey, 5, 1.6, 0xb8d8ff, 0.12);
    g.particles.sparks(ex, ey, -dx, -dy, 14, 7);
    g.sound.zap(ex);
    const p = hit ? g.physics.partOf(hit.collider) : null;
    if (!p || p.destroyed) return;
    p.entity.damage(p, 28, 'shock', { x: ex, y: ey }, { x: dx, y: dy });
    p.charred = Math.min(1, p.charred + 0.25);
    // (6 m/s to a limb, no more push than that to anything over 20 kg: a car's 330 kg body only rocks)
    const kick = 6 * Math.min(20, Math.max(1, p.mass));
    if (!p.frozen) p.applyImpulseAt(dx * kick, dy * kick, ex, ey);
    if (Math.random() < 0.35) g.fire.ignite(p, 0.4);
  }

  /** A fan of flame from (x, y) along (dx, dy), setting alight what it reaches. */
  private flame(x: number, y: number, dx: number, dy: number, power: number): void {
    const g = this.game;
    const reach = POWER.flameReach * (0.4 + 0.6 * power);
    for (let i = 0; i < 14; i++) {
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
      const s = reach * (2 + Math.random() * 1.5);
      const sz = PX * (4 + Math.random() * 5);
      g.particles.emit(PK.Fire, x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.2,
        size: sz, size1: sz * 0.4, color: 0xffd25a, color1: 0xc8320f, alpha: 1, alpha1: 0.4, gravity: -0.5, drag: 2.2,
      });
    }
    for (const p of this.partsNear(x, y, reach, true)) {
      const ox = p.x - x;
      const oy = p.y - y;
      const d = Math.hypot(ox, oy) || 1e-3;
      // within the fan: about 30 degrees either side
      if ((ox * dx + oy * dy) / d > 0.85 || d < 0.5) g.fire.ignite(p, 0.8);
    }
  }
}

/** Mouse + keyboard interaction with the sandbox, with People Playground's controls. */
export class Controls {
  readonly game: Game;
  ui!: UIBridge;
  /** Undo/redo of the player's edits. */
  readonly history: History;
  /** The keys of every keyboard command. */
  readonly bindings = new Bindings();
  /** The connection tools and the Remove tool, and editing connections (see ConnectTool). */
  readonly connect: ConnectTool;
  /** Arranging things while building (see Arrange). */
  readonly arrange: Arrange;
  /** Putting things into the scene, with a ghost where they'll go (see Placer). */
  readonly placer: Placer;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  private keys = new Set<string>();
  /** Commands held by touch buttons rather than keys. */
  private held = new Set<ActionId>();
  /** A modifier key pressed with nothing else yet: released like that, it's a command (Ctrl: tools/powers). */
  private modTap: string | null = null;
  /** Commands whose key went down while there was something to place: they run when it's let go (see defers()). */
  readonly deferred = new Set<ActionId>();
  /** The toybox's selection: what Q and E spawn. */
  armed: ItemDef | null = null;
  /** The size or shape to spawn it with (eyedropped from a resized or drawn object). */
  armedConfig: EntityConfig | undefined;
  tool: ToolId = 'drag';
  /** How stiff the Spring tool's springs are (times the usual: see SPRING_STIFFNESS). */
  springStiffness = 1;
  /** What the Shape tool makes things of. */
  shapeMat: ShapeMaterialId = 'wood';
  /** The Shape tool's outline in progress. */
  draft: Draft | null = null;
  /** Editing the map: the Shape tool draws ground, and a right click takes it away (see tools/TerrainTool). */
  terrain: TerrainEditor | null = null;
  /** A size handle being dragged. */
  resize: Resize | null = null;
  /** The selection being turned by its round handle. */
  spin: Spin | null = null;
  power: PowerId = 'push';
  /** Which half of the tool bar is in use. */
  tab: 'tools' | 'powers' = 'tools';
  selection = new Set<Entity>();
  hover: Part | null = null;
  grab: Grab | null = null;
  /** The detail view (S): limb status and blast radii. */
  detail = false;
  /** X-ray (X): the bones of people and animals through their bodies. */
  xray = false;
  /** The person or animal whose vitals stay on screen (Vitals in its context menu). */
  vitalsPinned: Entity | null = null;
  /**
   * Waiting for a click on something (who to set someone on, after Fight… in
   * their menu): `pick` takes it, or says why not. Esc or a right click cancels.
   */
  private picking: { hint: string; pick: (e: Entity) => string | true } | null = null;
  /** What the context menu was opened for: it closes if one of them goes (its entries would act on what's gone). */
  private menuFor: Entity[] = [];
  /** Outline what's under the cursor. */
  hoverHighlights = true;
  /**
   * Snapping while building: connection ends to points worth joining at, and
   * moved things into line with their neighbours (Settings › Building turns
   * either off; the self-tests turn it off to press at exact points).
   */
  snapping = true;
  /** The next connection end goes exactly where the finger is (the touch bar's Free: Alt for one end). */
  freeAnchor = false;
  /** Touch: connections carry on from where each ended (the touch bar's Chain: Shift as it's let go). */
  chainTouch = false;
  /** Touch: dragging with time paused moves just what's dragged (the touch bar's Alone: Ctrl). */
  aloneTouch = false;
  /**
   * How the toybox's item is spawned with the mouse: 'keys', People Playground's
   * Q / E at the cursor (a click on empty space box-selects), or 'click', this
   * game's first way: its ghost always at the cursor, Q / E turn it, a click on
   * empty space puts it there. Kept in the browser.
   */
  placement: 'keys' | 'click' = loadPlacement();
  /** What the camera keeps centered (Follow in the context menu). */
  follow: Entity[] | null = null;
  private box: { x0: number; y0: number; additive: boolean } | null = null;
  private pan: { sx: number; sy: number; camX: number; camY: number } | null = null;
  clipboard: Snapshot | null = null;
  /** What was spawned or pasted, newest last: Z removes them in turn. */
  private creations: Entity[][] = [];
  private boxEl: HTMLDivElement;
  private outlined = new Set<Part>();
  /** Parts outlined in a connection tool's colour: where its ends would go (see ConnectTool.ends). */
  private toolOutlines = new Map<Part, number>();
  private activated = new Set<Entity>();
  /** The vehicles the drive and aim keys worked last step (see steer()). */
  private driven = new Set<Car>();
  /** The left button is held down with a power. */
  private powerOn = false;
  /** The cursor's speed on screen (px/s, smoothed), for flicks. */
  private flick: V2 = { x: 0, y: 0 };
  private lastS: V2 = { x: 0, y: 0 };
  readonly powers: Powers;
  /**
   * Playing in someone else's multiplayer game: what the player does to the world
   * is sent to the host to do (see net/Guest), rather than done here.
   */
  net: GuestLink | null = null;
  /** When a guest last sent where its cursor and hand are (ms). */
  private sentAt = 0;
  /** A guest's power was on when it last sent it (it sends once more, off). */
  private powerSent = false;
  /** The vehicles a guest last told the host to drive or aim (they're told once more to let go). */
  private driveSent: Car[] = [];
  /** The last press of the left button (for double-clicks). */
  private lastPress: { t: number; sx: number; sy: number } | null = null;
  /** Alt+click going through the parts stacked under the cursor: which, and the one picked last. */
  private cycle: { parts: Part[]; i: number; sx: number; sy: number } | null = null;

  // touch: fingers that went down on the sandbox, by pointer id
  private touches = new Map<number, { x: number; y: number }>();
  /** The finger that acts like the mouse; a second one pinches. */
  private primary = -1;
  private pinch: { d0: number; zoom0: number; wx: number; wy: number } | null = null;
  /** Two fingers that came down on the selection with time paused turn it (see touchDown()). */
  private twist: { a0: number; turned: number; list: Entity[]; cx: number; cy: number; moved: boolean } | null = null;
  /** After a pinch or a long press, the finger left down does nothing until lifted. */
  private touchIdle = false;
  private press: { sx: number; sy: number; timer: number } | null = null;
  /** Where a finger went down on empty space, until it moves or turns into a long press. */
  private tapAt: { sx: number; sy: number } | null = null;
  /** The last pointer used was a finger (touch layout, no hover). */
  touchMode = false;

  constructor(game: Game, canvas: HTMLCanvasElement) {
    this.game = game;
    this.history = new History(game);
    this.powers = new Powers(game);
    this.connect = new ConnectTool(this);
    this.arrange = new Arrange(this);
    this.placer = new Placer(this);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    document.body.appendChild(this.boxEl);

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.modTap = null;
      this.deferred.clear();
      this.releaseActivation();
      // (a key let go elsewhere: what it was placing is dropped, not placed)
      if (this.placer.ghost?.key) this.placer.cancel();
    });

    game.preStepHandlers.push((dt) => this.preStep(dt));
    game.postStepHandlers.push(() => this.offerHeld());
    game.frameHandlers.push((dt) => this.frame(dt));
    game.hooks.onEntityRemoved = (e) => {
      this.selection.delete(e);
      this.activated.delete(e);
      if (this.grab && this.grab.part.entity === e) this.endGrab();
      if (this.hover && this.hover.entity === e) this.hover = null;
      for (const p of e.parts) {
        this.outlined.delete(p);
        this.toolOutlines.delete(p);
      }
      if (this.menuFor.includes(e)) {
        this.menuFor = [];
        this.ui.closeContextMenu();
      }
    };
    game.hooks.onPartRemoved = (p) => {
      if (this.grab && this.grab.part === p) this.endGrab();
      if (this.hover === p) this.hover = null;
      if (this.connect.pending?.a.part === p) this.connect.cancel();
      this.outlined.delete(p);
      this.toolOutlines.delete(p);
    };
  }

  /** How near (m) the cursor must be to a thing to be on it. */
  pickRadius(): number {
    return 7 / this.game.renderer.zoom;
  }

  private updateMouse(e: { clientX: number; clientY: number }): void {
    this.sx = e.clientX;
    this.sy = e.clientY;
    const w = this.game.renderer.screenToWorld(this.sx, this.sy);
    this.wx = w.x;
    this.wy = w.y;
  }

  /** Is a command's key (or touch button) held down? */
  isHeld(id: ActionId): boolean {
    if (this.tutorialBlocks?.(id)) return false;
    return this.held.has(id) || this.bindings.keys(id).some((k) => this.keys.has(k));
  }

  /** While a tutorial step is on: whether it keeps the player off a command (a binding's id, or 'Ctrl+KeyZ'; see ui/TutorialLock). */
  tutorialBlocks: ((what: string) => boolean) | null = null;

  /** Ctrl (or ⌘) is held down. */
  get ctrlDown(): boolean {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('MetaLeft') || this.keys.has('MetaRight');
  }

  /** A finger is on the sandbox. */
  get fingerDown(): boolean {
    return this.touches.size > 0;
  }

  // ---- the toybox and the tool bar ------------------------------------------------

  /** Selects an item in the toybox (again: deselects it). */
  arm(def: ItemDef | null): void {
    if (this.armed === def) def = null;
    this.armed = def;
    this.armedConfig = undefined;
    if (!this.placer.ghost?.key) this.placer.cancel();
    this.ui?.onArmedChanged(this.armed);
  }

  setTool(id: ToolId): void {
    this.tab = 'tools';
    this.tool = id;
    this.toolChanged();
  }

  setPower(id: PowerId): void {
    this.tab = 'powers';
    this.power = id;
    this.toolChanged();
  }

  /**
   * The n-th (from 0) tool slot or power of the tab in use (keys 1-9). The key
   * of the slot in hand again steps through its kinds (the Rope slot's fuse
   * cord), or a spring's stiffness, as People Playground's keys step through
   * its tools' kinds.
   */
  selectSlot(n: number): void {
    if (this.tab === 'tools') {
      const slot = TOOL_SLOTS[n];
      if (!slot) return;
      const now = toolSlot(this.tool) === n;
      if (now && slot.id === 'spring') return this.connect.stepSpring();
      const kinds = slotVariants(slot.id);
      if (now && kinds.length > 1) {
        const next = kinds[(kinds.indexOf(this.tool) + 1) % kinds.length];
        this.setTool(next);
        this.ui?.toast(`${this.toolName(next)}`);
        return;
      }
      this.setTool(slot.id);
    } else if (n < POWERS.length) this.setPower(POWERS[n]);
  }

  /** A tool's name on the tool bar. */
  toolName(id: ToolId): string {
    const def = getItem(`tool-${id}`);
    return def?.name ?? (id === 'drag' ? 'Drag' : id);
  }

  toggleTab(): void {
    this.tab = this.tab === 'tools' ? 'powers' : 'tools';
    this.toolChanged();
  }

  private toolChanged(): void {
    this.connect.cancel();
    this.powerOn = false;
    this.draft = null;
    this.resize = null;
    this.ui?.onToolChanged();
  }

  /** The connection tool in use, if one is. */
  get toolKind(): ConnKind | 'remove' | null {
    return this.tab === 'tools' && this.tool !== 'drag' && this.tool !== 'shape' ? this.tool : null;
  }

  /** The Shape tool is in use. */
  get shaping(): boolean {
    return this.tab === 'tools' && this.tool === 'shape';
  }

  /** The power in use, if one is. */
  get powerKind(): PowerId | null {
    return this.tab === 'powers' ? this.power : null;
  }

  // ---- pointer --------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    this.game.sound.unlock();
    this.modTap = null;
    const touch = e.pointerType === 'touch';
    if (touch !== this.touchMode) {
      this.touchMode = touch;
      this.ui.setTouchMode(touch);
    }
    if (this.picking && !this.ui.isMenuOpen()) {
      this.updateMouse(e);
      this.pickAt(e.button);
      return;
    }
    if (touch && this.touchDown(e)) return;
    this.updateMouse(e);
    if (this.ui.isMenuOpen()) {
      this.ui.closeContextMenu();
      if (touch) {
        // the tap that closes a menu does nothing else, however long it's held
        this.cancelPress();
        this.touchIdle = true;
      }
      if (e.button !== 2) return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (e.button === 1) {
      e.preventDefault();
      this.pan = { sx: this.sx, sy: this.sy, camX: this.game.renderer.camX, camY: this.game.renderer.camY };
      this.follow = null;
      return;
    }
    if (e.button === 2) {
      // (a right click ends a chain of connections, or drops what was being placed)
      if (this.connect.busy) {
        this.connect.cancel();
        return;
      }
      if (this.placer.ghost?.solid) {
        this.placer.cancel();
        return;
      }
      // (a right click finishes the outline being drawn)
      if (this.draft?.pts.length) {
        this.finishDraft();
        return;
      }
      // (editing the map, it takes away the ground under it, rather than open a thing's menu)
      if (this.terrain && !this.game.pick(this.wx, this.wy, this.pickRadius()) && this.terrain.removeAt(this.wx, this.wy)) return;
      this.openMenuAtCursor();
      return;
    }
    if (e.button !== 0) return;

    if (this.powerKind) {
      this.cancelPress();
      this.powerOn = true;
      return;
    }
    if (this.shaping) {
      this.cancelPress();
      this.shapeDown(e.shiftKey || this.isHeld('fast'));
      return;
    }
    const tool = this.toolKind;
    if (tool) {
      // (a long press with a connection tool opens nothing: the finger is placing an end)
      this.cancelPress();
      if (tool === 'remove') this.connect.removeDown(e.shiftKey || this.isHeld('fast'));
      else this.connect.down();
      return;
    }
    const handle = this.handleAt(this.sx, this.sy);
    if (handle) {
      this.cancelPress();
      this.startResize(handle.hx, handle.hy);
      return;
    }
    if (this.groupHandleAt(this.sx, this.sy)) {
      this.cancelPress();
      this.arrange.startGroupResize();
      return;
    }
    if (this.spinHandleAt(this.sx, this.sy)) {
      this.cancelPress();
      this.startSpin();
      return;
    }
    // a connection's knot, with time paused: that end is picked up, to put down elsewhere
    if (this.connect.knotDown()) {
      this.cancelPress();
      return;
    }
    const multi = e.shiftKey || this.isHeld('fast');
    // (Ctrl, or ⌘ where Ctrl-click is a right click: with time paused, just this, not all joined to it)
    const alone = e.ctrlKey || e.metaKey || this.aloneTouch;
    const double = this.doublePress(e);
    let part = this.game.pick(this.wx, this.wy, this.pickRadius());
    // Alt+click: the next of the parts stacked under the cursor
    if (part && e.altKey && !touch) part = this.cycleAt(part);
    if (part) {
      const ent = part.entity;
      if (double && !multi) {
        // a double-click: its whole assembly (again: and what's wired to it)
        this.arrange.selectAssembly(ent);
      } else if (multi) {
        if (this.selection.has(ent)) this.selection.delete(ent);
        else this.selection.add(ent);
      } else if (!this.selection.has(ent)) {
        this.selection.clear();
        this.selection.add(ent);
      }
      this.refreshOutlines();
      this.startGrab(part, this.wx, this.wy, alone);
      return;
    }
    if (touch) {
      // a finger on empty space moves the view; a tap (lifted before it moves or
      // becomes a long press) shows where the toybox's item would go, or deselects
      this.pan = { sx: this.sx, sy: this.sy, camX: this.game.renderer.camX, camY: this.game.renderer.camY };
      this.tapAt = { sx: this.sx, sy: this.sy };
      return;
    }
    // placing with clicks: the ghost at the cursor goes down there, turned as it shows (Shift: on the grid)
    if (this.placement === 'click' && this.armed) {
      if (this.placer.clickHint) this.placer.place();
      else this.spawnArmed(false);
      return;
    }
    // the mouse on empty space draws a selection box
    if (!multi) this.selection.clear();
    this.refreshOutlines();
    this.box = { x0: this.wx, y0: this.wy, additive: multi };
  }

  /** Is this press the second of a double-click? */
  private doublePress(e: PointerEvent): boolean {
    const now = e.timeStamp || performance.now();
    const last = this.lastPress;
    const yes = !!last && now - last.t < DOUBLE_MS && Math.hypot(this.sx - last.sx, this.sy - last.sy) < DOUBLE_SLOP;
    this.lastPress = yes ? null : { t: now, sx: this.sx, sy: this.sy };
    return yes;
  }

  /** Alt+click: the parts stacked under the cursor in turn, smallest first (the status line says which). */
  private cycleAt(first: Part): Part {
    const c = this.cycle;
    const same = c && Math.hypot(this.sx - c.sx, this.sy - c.sy) < DOUBLE_SLOP && c.parts.includes(first);
    const parts = same ? c!.parts : this.game.pickAll(this.wx, this.wy);
    if (parts.length < 2) {
      this.cycle = null;
      return first;
    }
    const i = same ? (c!.i + 1) % parts.length : 1;
    this.cycle = { parts, i, sx: this.sx, sy: this.sy };
    return parts[i];
  }

  /**
   * Touch bookkeeping. The first finger acts like the mouse (and a long press is
   * a right click); a second one stops that and the two pinch-zoom and pan, or,
   * coming down on the selection with time paused, turn it.
   * Returns true when this finger is handled here rather than as a click.
   */
  private touchDown(e: PointerEvent): boolean {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 1) {
      this.primary = e.pointerId;
      this.touchIdle = false;
      this.startPress(e.clientX, e.clientY);
      return false;
    }
    // (two fingers on what's selected, with time paused: they turn it)
    const held = this.grab?.part.entity;
    const turnIt = this.game.paused && !!held && this.selection.has(held) && this.touches.size === 2;
    this.cancelPress();
    this.cancelGesture();
    this.touchIdle = true;
    const [a, b] = [...this.touches.values()];
    if (turnIt) {
      const list = this.arrange.moving([...this.selection], this.aloneTouch);
      const mid = centreOf(list);
      this.twist = { a0: Math.atan2(b.y - a.y, b.x - a.x), turned: 0, list, cx: mid.x, cy: mid.y, moved: false };
      return true;
    }
    const r = this.game.renderer;
    const w = r.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: r.zoom, wx: w.x, wy: w.y };
    return true;
  }

  /** Two fingers: the spread sets the zoom and the world point first between them stays between them. */
  private updatePinch(): void {
    const p = this.pinch!;
    const [a, b] = [...this.touches.values()];
    const r = this.game.renderer;
    r.zoom = clamp((p.zoom0 * Math.hypot(a.x - b.x, a.y - b.y)) / p.d0, MIN_ZOOM, MAX_ZOOM);
    r.targetZoom = r.zoom;
    const w = r.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    r.camX += p.wx - w.x;
    r.camY += p.wy - w.y;
    r.clampCamera();
  }

  /** Two fingers on the selection: turning them turns it (in the angle's steps with the build bar's Snap on). */
  private updateTwist(): void {
    const t = this.twist!;
    const [a, b] = [...this.touches.values()];
    // (the screen's y runs down: angles the other way)
    let want = -(Math.atan2(b.y - a.y, b.x - a.x) - t.a0);
    want = Math.atan2(Math.sin(want), Math.cos(want));
    if (this.arrange.dragSnap().grid) want = Math.round(want / this.arrange.angleStep) * this.arrange.angleStep;
    const d = want - t.turned;
    if (Math.abs(d) < 1e-4) return;
    if (!t.moved) {
      t.moved = true;
      this.history.record('Rotate');
    }
    if (this.net) this.net.send({ op: 'rotate', ids: this.net.ids(t.list), angle: d });
    else for (const e of t.list) if (!e.destroyed) e.rotateAbout(t.cx, t.cy, d);
    t.turned = want;
  }

  private startPress(sx: number, sy: number): void {
    this.cancelPress();
    const timer = window.setTimeout(() => {
      this.press = null;
      this.cancelGesture();
      this.touchIdle = true;
      this.openMenuAtCursor();
    }, LONG_PRESS_MS);
    this.press = { sx, sy, timer };
  }

  private cancelPress(): void {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  /** Drops whatever a press started: a drag, a pan, a box, a connection, a power. */
  private cancelGesture(): void {
    this.endGrab();
    this.pan = null;
    this.tapAt = null;
    this.box = null;
    this.boxEl.style.display = 'none';
    // (a connection waiting for its second tap waits on: two fingers may move the view meanwhile)
    if (this.connect.pending?.waiting) this.connect.pending.down = false;
    else this.connect.cancel();
    this.powerOn = false;
    this.resize = null;
    this.arrange.group = null;
    this.endSpin();
    if (this.draft) this.draft.press = null;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      // fingers on the UI (holding a touch-bar button) don't move the cursor
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.pinch) {
        this.updatePinch();
        return;
      }
      if (this.twist) {
        this.updateTwist();
        return;
      }
      if (e.pointerId !== this.primary || this.touchIdle) return;
      if (this.press && Math.hypot(e.clientX - this.press.sx, e.clientY - this.press.sy) > PRESS_SLOP) this.cancelPress();
      if (this.tapAt && Math.hypot(e.clientX - this.tapAt.sx, e.clientY - this.tapAt.sy) > PRESS_SLOP) this.tapAt = null;
    }
    this.updateMouse(e);
    if (this.pan) {
      const r = this.game.renderer;
      r.camX = this.pan.camX - (this.sx - this.pan.sx) / r.zoom;
      r.camY = this.pan.camY + (this.sy - this.pan.sy) / r.zoom;
      r.clampCamera();
    }
    if (this.box) {
      const a = this.game.renderer.worldToScreen(this.box.x0, this.box.y0);
      const x = Math.min(a.x, this.sx);
      const y = Math.min(a.y, this.sy);
      Object.assign(this.boxEl.style, {
        display: 'block', left: x + 'px', top: y + 'px', width: Math.abs(this.sx - a.x) + 'px', height: Math.abs(this.sy - a.y) + 'px',
      });
    }
    if (this.resize) this.updateResize(e.shiftKey || this.isHeld('fast'));
    if (this.arrange.group) this.arrange.updateGroupResize();
    if (this.spin) this.updateSpin();
  }

  private onUp(e: PointerEvent): void {
    this.modTap = null;
    const touch = e.pointerType === 'touch';
    if (touch) {
      if (!this.touches.delete(e.pointerId)) return;
      this.cancelPress();
      if (this.touches.size < 2) {
        this.pinch = null;
        if (this.twist) {
          if (this.twist.moved && !this.net) this.arrange.settle(this.twist.list.filter((x) => !x.destroyed));
          this.twist = null;
        }
      }
      const wasPrimary = e.pointerId === this.primary;
      if (!this.touches.size) this.primary = -1;
      if (wasPrimary) this.powerOn = false;
      if (!wasPrimary || this.touchIdle) {
        if (!this.touches.size) this.touchIdle = false;
        this.tapAt = null;
        return;
      }
      this.pan = null;
      if (this.tapAt && e.type === 'pointerup') {
        this.tapAt = null;
        this.updateMouse(e);
        // a tap on empty space: shows where the toybox's item will go (a tap on it again places it), or spawns it at once (Settings)
        if (this.armed) {
          if (this.arrange.settings.tapSpawn) this.spawnArmed(false);
          else this.placer.tap({ x: this.wx, y: this.wy });
        } else if (this.placer.waiting) this.placer.tap({ x: this.wx, y: this.wy });
        else this.clearSelection();
        return;
      }
      this.tapAt = null;
    }
    // a cancelled pointer (the browser took the gesture over) ends everything like a release
    if (e.type === 'pointercancel') {
      this.cancelGesture();
      return;
    }
    this.updateMouse(e);
    if (e.button === 1) this.pan = null;
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey || this.isHeld('fast') || this.chainTouch;
    this.powerOn = false;
    if (this.grab) this.endGrab();
    if (this.resize && !this.resize.typed) this.applyResize();
    if (this.arrange.group) this.arrange.applyGroupResize();
    if (this.spin) this.endSpin();
    if (this.draft?.press) this.shapeUp();
    if (this.box) {
      const ents = this.game.entitiesInRect(this.box.x0, this.box.y0, this.wx, this.wy);
      for (const en of ents) this.selection.add(en);
      this.box = null;
      this.boxEl.style.display = 'none';
      this.refreshOutlines();
    }
    if (this.connect.cut) this.connect.removeUp();
    else if (this.connect.draggingKnot) this.connect.knotUp(ctrl);
    else if (this.connect.pending) {
      this.connect.up(ctrl, shift);
      this.freeAnchor = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // (a rope's length while it's made, or one's under the cursor with time paused)
    if (this.connect.wheel(e.deltaY, e.shiftKey)) return;
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    this.game.renderer.zoomAt(this.sx, this.sy, f);
  }

  // ---- grabbing -------------------------------------------------------------

  /**
   * Takes hold of a part (and the rest of the selection, if it's in it). With
   * time paused it moves its whole assembly, or with `alone` (Ctrl) just it.
   */
  private startGrab(part: Part, wx: number, wy: number, alone = false): void {
    this.endGrab();
    const base = this.selection.has(part.entity) ? [...this.selection] : [part.entity];
    if (this.net) {
      // (a guest's drag is done in the host's game: here it's only the hand's place)
      this.grab = { part, local: part.worldToLocal(wx, wy), anchor: null, joint: null, frozenMove: part.frozen, offset: { x: 0, y: 0 }, savedDamping: 0, at: { x: wx, y: wy }, turn: 0, hold: null, alone };
      this.net.send({ op: 'grab', p: this.net.ref(part), x: wx, y: wy, ids: this.net.ids(base), ...(alone ? { alone: true } : {}) });
      return;
    }
    this.grab = beginGrab(this.game, part, wx, wy);
    this.grab.alone = alone;
    if (this.selection.size > 1) grabAlong(this.game, this.grab, [...this.selection]);
  }

  endGrab(): void {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    this.arrange.guides = [];
    if (this.net) {
      this.net.send({ op: 'drop', x: this.wx, y: this.wy });
      return;
    }
    releaseGrab(this.game, g, { x: this.wx, y: this.wy });
    // moved with time paused: the joints to what stayed are made again where it is now
    if (this.game.paused && g.moved && g.moveList) this.arrange.settle(g.moveList.filter((e) => !e.destroyed));
  }

  /** Something dragged into a person's free hand is taken out of the cursor's. */
  private offerHeld(): void {
    const g = this.grab;
    if (!g || g.frozenMove || g.part.destroyed || this.net) return;
    if (g.part.entity.offer(this.dragTarget())) this.endGrab();
  }

  /** Where the dragged point should go: the cursor, kept inside the world. */
  private dragTarget(): V2 {
    return inWorld(this.wx, this.wy);
  }

  /** How fast the held object turns (rad/s): A/D, faster with Shift. */
  private turnRate(): number {
    return this.rotateInput() * (this.isHeld('fast') ? 2.5 : 1);
  }

  private preStep(dt: number): void {
    // (a guest's drags, powers and driving are done in the host's game: see sendInput())
    if (this.net) return;
    this.powers.step(this.powerOn ? this.powerKind : null, this.wx, this.wy, this.flick, dt);
    this.steer();
    const g = this.grab;
    if (!g) return;
    if (g.part.destroyed) {
      this.endGrab();
      return;
    }
    const t = this.dragTarget();
    if (!stepGrab(g, t, this.turnRate(), dt, () => this.history.record('Move'))) this.startGrab(g.part, t.x, t.y, g.alone);
  }

  /**
   * Dragging with time paused moves what's held, everything joined to it
   * (Ctrl as it was taken: just it) and the rest of the selection straight to
   * the cursor, and A/D turn it about the held point. It lines up with what's
   * beside it; holding Alt snaps it to the grid instead.
   */
  private dragPaused(g: Grab, dt: number): void {
    if (g.part.destroyed) {
      this.endGrab();
      return;
    }
    if (!g.moveList) {
      const base = this.selection.has(g.part.entity) ? [...this.selection].filter((e) => !e.destroyed) : [g.part.entity];
      g.moveList = this.arrange.moving(base, !!g.alone);
    }
    const list = g.moveList.filter((e) => !e.destroyed);
    this.arrange.guides = dragPausedBy(g, list, this.dragTarget(), this.turnRate(), this.arrange.dragSnap(), dt, () => this.history.record('Move'));
  }

  /** Time starts with something held: the joints to what it moved away from are made again first. */
  private settleGrab(): void {
    const g = this.grab;
    if (!g || this.net || !g.moved || !g.moveList) return;
    this.arrange.settle(g.moveList.filter((e) => !e.destroyed));
    g.moveList = undefined;
  }

  private rotateInput(): number {
    let r = 0;
    if (this.isHeld('rotateLeft')) r += 1;
    if (this.isHeld('rotateRight')) r -= 1;
    return r;
  }

  // ---- the round handle that turns the selection ----------------------------------

  /** Where the turning handle is (screen): over the selection, with time paused and the Drag tool in hand. */
  spinHandle(): { x: number; y: number } | null {
    if (this.spin) return this.spinAt();
    if (!this.game.paused || !this.selection.size || this.tab !== 'tools' || this.tool !== 'drag' || this.grab || this.resize) return null;
    const b = boxOf([...this.selection]);
    if (!b) return null;
    const s = this.game.renderer.worldToScreen((b.x0 + b.x1) / 2, b.y1);
    return { x: s.x, y: s.y - SPIN_HANDLE - (this.touchMode ? 12 : 0) };
  }

  /** The handle as it's turned: round the middle, where the cursor is. */
  private spinAt(): { x: number; y: number } {
    const s = this.spin!;
    const r = this.game.renderer;
    const c = r.worldToScreen(s.cx, s.cy);
    const d = Math.max(30, Math.hypot(this.sx - c.x, this.sy - c.y));
    const a = Math.atan2(this.sy - c.y, this.sx - c.x);
    return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
  }

  private spinHandleAt(sx: number, sy: number): boolean {
    const h = this.spinHandle();
    return !!h && Math.hypot(h.x - sx, h.y - sy) < (this.touchMode ? 22 : 9);
  }

  private startSpin(): void {
    const list = this.arrange.moving([...this.selection], false);
    const b = boxOf([...this.selection]);
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    this.spin = { list, cx, cy, a0: Math.atan2(this.wy - cy, this.wx - cx), turned: 0, moved: false };
  }

  /** The handle dragged: the selection turns about the middle of its box to follow it (in the angle's steps with Alt). */
  private updateSpin(): void {
    const s = this.spin!;
    let want = Math.atan2(this.wy - s.cy, this.wx - s.cx) - s.a0;
    want = Math.atan2(Math.sin(want), Math.cos(want));
    const snap = this.arrange.dragSnap();
    if (snap.grid) want = Math.round(want / snap.angleStep) * snap.angleStep;
    const d = want - s.turned;
    if (Math.abs(d) < 1e-5) return;
    if (!s.moved) {
      s.moved = true;
      if (!this.net) this.history.record('Rotate');
    }
    if (this.net) this.net.send({ op: 'rotate', ids: this.net.ids(s.list), angle: d });
    else for (const e of s.list) if (!e.destroyed) e.rotateAbout(s.cx, s.cy, d);
    s.turned = want;
  }

  private endSpin(): void {
    const s = this.spin;
    this.spin = null;
    if (s?.moved && !this.net) this.arrange.settle(s.list.filter((e) => !e.destroyed));
  }

  /** How far the selection has been turned by its handle (degrees), for the label by it. */
  get spinAngle(): number | null {
    return this.spin ? (this.spin.turned * 180) / Math.PI : null;
  }

  // ---- driving --------------------------------------------------------------------

  /** -1, 0 or 1: which of two opposite commands is held (both: neither). */
  private axis(minus: ActionId, plus: ActionId): number {
    return (this.isHeld(plus) ? 1 : 0) - (this.isHeld(minus) ? 1 : 0);
  }

  /** The vehicles in the selection (cars, trucks, tanks): the drive keys are theirs while there are any. */
  private vehicles(): Car[] {
    const out: Car[] = [];
    for (const e of this.selection) if (e instanceof Car && !e.destroyed) out.push(e);
    return out;
  }

  /**
   * Each step: the drive keys drive the selected vehicles left or right on
   * screen (forward or in reverse, whichever way they face) and the aim keys
   * raise or lower the selected tanks' barrels; let go, or no longer selected,
   * they brake. (With time paused, nothing until it runs again.)
   */
  private steer(): void {
    const x = this.axis('driveLeft', 'driveRight');
    const aim = this.axis('aimDown', 'aimUp');
    const now = x || aim ? this.vehicles() : [];
    for (const v of this.driven) if (!now.includes(v) && !v.destroyed) v.steer(0, 0);
    this.driven.clear();
    for (const v of now) {
      v.steer(x, aim);
      this.driven.add(v);
    }
  }

  /** Is a command held by a key (or a touch button) that isn't also `other`'s? */
  private heldApart(id: ActionId, other: ActionId): boolean {
    const taken = this.bindings.keys(other);
    return this.held.has(id) || this.bindings.keys(id).some((k) => this.keys.has(k) && !taken.includes(k));
  }

  /** Driving what's selected along, the camera keeps it in view: still while it's near the middle, easing after it nearer the edges. */
  private keepInView(list: Entity[], dt: number): void {
    const r = this.game.renderer;
    let cx = 0;
    let cy = 0;
    for (const e of list) {
      const c = e.center();
      cx += c.x / list.length;
      cy += c.y / list.length;
    }
    const k = Math.min(1, dt * 3);
    const dx = cx - r.camX;
    const dy = cy - r.camY;
    const mx = (r.viewWidth / r.zoom) * 0.25;
    const my = (r.height / r.zoom) * 0.25;
    if (Math.abs(dx) > mx) r.camX += (dx - Math.sign(dx) * mx) * k;
    if (Math.abs(dy) > my) r.camY += (dy - Math.sign(dy) * my) * k;
    r.clampCamera();
  }

  // ---- connections (see ConnectTool) -------------------------------------------------

  /** Takes connections away (the Remove tool, with a snap; the context menu). */
  unconnect(list: Connection[], snap: boolean): void {
    this.connect.unconnect(list, snap);
  }

  /** How far a hinge (or pin) may swing (null: freely). */
  setLimit(c: Connection, rad: number | null): void {
    this.connect.setLimit(c, rad);
  }

  /** The menu of a connection (right-clicked, or long-pressed). */
  /** A connection's menu (`under`: the thing under the cursor, whose own menu it offers). */
  private openConnMenu(c: Connection, under: Part | null = null): void {
    const acts = connectionActions(this, c);
    if (under) acts.push({ label: `The ${under.entity.def.name}…`, action: () => this.openMenuFor(under) });
    this.ui.openContextMenu(this.sx, this.sy, connectionTitle(c), acts);
  }

  // ---- the Shape tool -------------------------------------------------------------

  /** The cursor (inside the world), on the snapping grid while Alt is held. */
  private snapped(): V2 {
    const t = this.dragTarget();
    if (!this.arrange.dragSnap().grid) return t;
    const g = this.arrange.settings.grid;
    return { x: Math.round(t.x / g) * g, y: Math.max(WORLD.floor, Math.round(t.y / g) * g) };
  }

  private shapeDown(round: boolean): void {
    const p = this.snapped();
    if (this.draft) this.draft.press = p;
    else this.draft = { pts: [], press: p, round };
  }

  /**
   * The button let go with the Shape tool: dragged out, a box (round with Shift);
   * clicked, a corner of an outline, which a click on its first corner (or on
   * its last again, or Enter, or a right click) finishes.
   */
  private shapeUp(): void {
    const d = this.draft;
    if (!d?.press) return;
    const press = d.press;
    d.press = null;
    const p = this.snapped();
    const zoom = this.game.renderer.zoom;
    const near = (a: V2, b: V2, px: number) => Math.hypot(a.x - b.x, a.y - b.y) * zoom < px;
    if (!d.pts.length && !near(press, p, 8)) {
      this.draft = null;
      this.makeShape(d.round || this.isHeld('fast') ? 'round' : 'box', [press, p]);
      return;
    }
    const first = d.pts[0];
    const last = d.pts[d.pts.length - 1];
    if (d.pts.length >= 3 && (near(p, first, 12) || near(p, last, 6))) {
      this.finishDraft();
      return;
    }
    if (last && near(p, last, 6)) return;
    // a corner whose edge would cross the outline isn't placed
    const P = (v: V2): Pt => [v.x, v.y];
    for (let i = 0; i + 2 < d.pts.length; i++) {
      if (segmentsCross(P(d.pts[i]), P(d.pts[i + 1]), P(last), P(p))) {
        this.ui.toast('The outline can’t cross itself');
        return;
      }
    }
    d.pts.push(p);
  }

  /** Makes the shape from the outline drawn so far. */
  finishDraft(): void {
    const d = this.draft;
    if (!d) return;
    if (d.pts.length < 3) {
      this.ui.toast('An outline needs at least three corners');
      return;
    }
    if (selfCrossing(d.pts.map((p): Pt => [p.x, p.y]))) {
      this.ui.toast('The outline can’t cross itself');
      return;
    }
    this.draft = null;
    this.makeShape('poly', d.pts);
  }

  cancelDraft(): void {
    this.draft = null;
  }

  /** Spawns a shape of the Shape tool's material filling these points' bounds (a polygon: through them). */
  makeShape(form: ShapeForm, pts: V2[]): Entity | null {
    // (editing the map, it's ground)
    if (this.terrain) {
      this.terrain.make(form, pts);
      return null;
    }
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    const w = Math.round((x1 - x0) / PX);
    const h = Math.round((y1 - y0) / PX);
    if (w < SIZE_LIMITS.min || h < SIZE_LIMITS.min) {
      this.ui.toast('Too thin to make');
      return null;
    }
    if (w > SIZE_LIMITS.max || h > SIZE_LIMITS.max) {
      this.ui.toast(`Too big: at most ${SIZE_LIMITS.max * PX} m across`);
      return null;
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const config: EntityConfig = { mat: this.shapeMat, form, w, h };
    if (form === 'poly') {
      const n = cleanOutline(pts.map((p): Pt => [(p.x - cx) / (x1 - x0), (p.y - cy) / (y1 - y0)]));
      if (n.length < 3 || signedArea(n) * w * h < 4) {
        this.ui.toast('Too thin to make');
        return null;
      }
      config.pts = n;
    }
    const y = Math.max(cy, WORLD.floor + (h * PX) / 2 + 0.01);
    if (this.net) {
      this.net.send({ op: 'spawn', def: 'shape', x: cx, y, left: false, config });
      return null;
    }
    this.history.record('Draw shape');
    const e = this.game.spawn(getItem('shape')!, cx, y, { config });
    if (!e) return null;
    this.created([e]);
    this.game.sound.place(cx, e.parts[0]?.mat.sound ?? 'wood');
    return e;
  }

  // ---- resizing -----------------------------------------------------------------

  /** The thing whose size handles show: the one selected, if it can be resized and isn't being dragged. */
  private resizable(): Entity | null {
    // (one removed while its handle is held: its body is gone, so let go of it)
    if (this.resize && (this.resize.e.destroyed || this.resize.part.destroyed)) this.resize = null;
    if (this.resize) return this.resize.e;
    if (this.selection.size !== 1 || this.tab !== 'tools' || this.tool !== 'drag' || this.grab) return null;
    const e = [...this.selection][0];
    if (e.destroyed || !e.def.resizable || e.parts.length !== 1 || e.parts[0].destroyed) return null;
    return e;
  }

  /** Where its size handles are on screen, and which way each pulls. */
  resizeHandles(): { x: number; y: number; hx: number; hy: number }[] {
    const e = this.resizable();
    if (!e) return [];
    const p = e.parts[0];
    const r = this.game.renderer;
    const out: { x: number; y: number; hx: number; hy: number }[] = [];
    for (const hx of [-1, 0, 1]) {
      for (const hy of [-1, 0, 1]) {
        if (!hx && !hy) continue;
        const w = p.localToWorld((hx * p.w * PX) / 2, (hy * p.h * PX) / 2);
        out.push({ ...r.worldToScreen(w.x, w.y), hx, hy });
      }
    }
    return out;
  }

  /** The size handle at a screen point, if there is one. */
  private handleAt(sx: number, sy: number): { hx: number; hy: number } | null {
    const reach = this.touchMode ? 16 : 8;
    let best: { hx: number; hy: number } | null = null;
    let bd = reach;
    for (const h of this.resizeHandles()) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** On the handle that resizes several selected things at once. */
  private groupHandleAt(sx: number, sy: number): boolean {
    const h = this.arrange.groupHandle();
    return !!h && Math.hypot(h.x - sx, h.y - sy) < (this.touchMode ? 16 : 8);
  }

  private startResize(hx: number, hy: number): void {
    const e = this.resizable();
    if (!e) return;
    const p = e.parts[0];
    this.resize = { e, part: p, hx, hy, w0: p.w, h0: p.h, w: p.w, h: p.h };
  }

  /** The size the handle has now: the side opposite stays put; Shift keeps a corner's proportions, Alt snaps. */
  private updateResize(keep: boolean): void {
    const r = this.resize!;
    if (r.part.destroyed) {
      this.resize = null;
      return;
    }
    // (a size being typed in holds it)
    if (r.typed) return;
    const l = r.part.worldToLocal(this.wx, this.wy);
    let w = r.hx ? (r.hx * l.x) / PX + r.w0 / 2 : r.w0;
    let h = r.hy ? (r.hy * l.y) / PX + r.h0 / 2 : r.h0;
    if (keep && r.hx && r.hy) {
      const k = Math.max(w / r.w0, h / r.h0);
      w = r.w0 * k;
      h = r.h0 * k;
    }
    const step = this.isHeld('snap') ? 4 : 1;
    const fit = (v: number) => clamp(Math.round(v / step) * step, SIZE_LIMITS.min, SIZE_LIMITS.max);
    r.w = fit(w);
    r.h = fit(h);
  }

  /** The outline it will have (world corners), while a handle is dragged (or several things scaled together). */
  resizePreview(): V2[] | null {
    const g = this.arrange.groupPreview();
    if (g) return g;
    const r = this.resize;
    if (!r || r.part.destroyed) return null;
    const cx = (r.hx * (r.w - r.w0) * PX) / 2;
    const cy = (r.hy * (r.h - r.h0) * PX) / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => r.part.localToWorld(cx + (sx * r.w * PX) / 2, cy + (sy * r.h * PX) / 2));
  }

  private applyResize(): void {
    const r = this.resize;
    this.resize = null;
    if (!r || r.e.destroyed || (r.w === r.w0 && r.h === r.h0)) return;
    const at = r.part.localToWorld((r.hx * (r.w - r.w0) * PX) / 2, (r.hy * (r.h - r.h0) * PX) / 2);
    this.history.record('Resize');
    this.rebuild(r.e, { ...(r.e.config ?? {}), w: r.w, h: r.h }, at);
  }

  /**
   * A key while a size handle is held types a size ("1.2 x 0.5", metres):
   * Enter makes it that size (about its middle), Backspace takes back a
   * character. True if the key was taken.
   */
  private typeSize(code: string): boolean {
    const r = this.resize;
    if (!r) return false;
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (!r.typed) return false;
      const [a, b] = r.typed.split('x').map((s) => parseFloat(s));
      const w = Number.isFinite(a) ? a : r.w * PX;
      const h = Number.isFinite(b) ? b : Number.isFinite(a) && !r.typed.includes('x') ? (a / (r.w0 * PX)) * r.h0 * PX : r.h * PX;
      this.resize = null;
      this.setSize(r.e, w / PX, h / PX);
      return true;
    }
    if (code === 'Backspace') {
      if (!r.typed) return false;
      r.typed = r.typed.trimEnd().slice(0, -1).trimEnd() || undefined;
      return true;
    }
    const ch = SIZE_KEYS[code];
    if (!ch) return false;
    if (ch.trim() === 'x' && (!r.typed || r.typed.includes('x'))) return true;
    r.typed = (r.typed ?? '') + ch;
    return true;
  }

  /** Makes a thing again at another size (see Game.rebuildEntity()), selected. */
  private rebuild(e: Entity, config: EntityConfig | undefined, at?: V2): Entity | null {
    if (this.net) {
      this.net.send({ op: 'rebuild', id: e.netId, config, at });
      return null;
    }
    const made = this.game.rebuildEntity(e, config, at);
    if (!made) return null;
    this.replaced(e, made);
    this.selection = new Set([made]);
    this.refreshOutlines();
    this.game.sound.place(made.parts[0].x, made.parts[0].mat.sound);
    return made;
  }

  /** A thing was made again (resized): what Z would take back and what the camera follows are the new one. */
  replaced(e: Entity, made: Entity): void {
    for (const list of this.creations) {
      const i = list.indexOf(e);
      if (i >= 0) list[i] = made;
    }
    if (this.follow) this.follow = this.follow.map((x) => (x === e ? made : x));
  }

  /** Resizes a thing about its middle to a size in sprite pixels (or back to its own size: undefined). */
  setSize(e: Entity, w?: number, h?: number): Entity | null {
    if (!e.def.resizable || e.parts.length !== 1) return null;
    if (!this.net) this.history.record('Resize');
    if (w === undefined || h === undefined) return this.rebuild(e, undefined);
    const fit = (v: number) => clamp(Math.round(v), SIZE_LIMITS.min, SIZE_LIMITS.max);
    return this.rebuild(e, { ...(e.config ?? {}), w: fit(w), h: fit(h) });
  }

  // ---- welding together, turning, lining up (see Arrange) ----------------------------

  /**
   * Welds together every two of these things that touch (each pair once, where
   * they meet; by their mounts, where they have them), so they move as one.
   * Returns how many welds it made.
   */
  weldTogether(list: Entity[]): number {
    return this.arrange.weldTogether(list);
  }

  /** Turns things about their middle; with time paused, all joined to them too. */
  rotateSelection(list: Entity[], angle: number): void {
    this.arrange.rotate(list, angle);
  }

  // ---- spawning (see Placer) -----------------------------------------------------------

  /** Spawns the toybox's item at the cursor (Q facing left, E facing right). */
  spawnArmed(left: boolean): void {
    this.placer.spawnArmed(left);
  }

  /**
   * While the toybox has something to spawn, Z (freeze) and F (activate) wait for
   * their key to be let go, and are dropped if something was spawned meanwhile:
   * held while spawning, they freeze it or switch it on instead. (On something
   * under the cursor or in hand they work at once, automatic fire and all.)
   */
  private defers(id: ActionId): boolean {
    if (!this.armed && !this.placer.ghost?.key) return false;
    return (id === 'freeze' || id === 'activate') && !this.grab && !this.hover;
  }

  /** Remembers what the player made, for Z. */
  created(list: Entity[]): void {
    if (!list.length) return;
    this.creations.push(list);
    if (this.creations.length > 200) this.creations.shift();
  }

  /** Z: deletes the newest thing spawned or pasted that's still about. */
  removeLastCreation(): void {
    // (the host keeps what each guest made)
    if (this.net) return this.net.send({ op: 'unspawn' });
    while (this.creations.length) {
      const list = this.creations.pop()!.filter((e) => !e.destroyed);
      if (list.length) {
        this.deleteEntities(list);
        return;
      }
    }
    this.ui.toast('Nothing left to remove');
  }

  // ---- selection helpers --------------------------------------------------------

  /** Entities affected by a keyboard command: selection, else the hovered entity. */
  targets(): Entity[] {
    if (this.selection.size) return [...this.selection].filter((e) => !e.destroyed);
    if (this.hover && !this.hover.entity.destroyed) return [this.hover.entity];
    return [];
  }

  /** The object being dragged, else the targets. */
  private heldOrTargets(): Entity[] {
    return this.grab && !this.grab.part.entity.destroyed ? [this.grab.part.entity] : this.targets();
  }

  /**
   * What F works: the object being dragged, else the one under the cursor (with
   * someone selected, pointing at a grenade and pressing F pulls its pin), else
   * the selection. Pointing at one of the selection works all of it, and pointing
   * at something F does nothing to (a crate, a body: say, what a gunner is aimed
   * at) still works the selection.
   */
  private activationTargets(): Entity[] {
    if (this.grab && !this.grab.part.entity.destroyed) return [this.grab.part.entity];
    const over = this.hover && !this.hover.entity.destroyed ? this.hover.entity : null;
    if (over && !this.selection.has(over) && (over.activatable || !this.selection.size)) return [over];
    return this.targets();
  }

  /** What Z freezes: what's being dragged (all of the selection, if it's one of them), else as F picks. */
  private freezeTargets(): Entity[] {
    const held = this.grab && !this.grab.part.entity.destroyed ? this.grab.part.entity : null;
    if (held) return this.selection.has(held) ? this.targets() : [held];
    return this.activationTargets();
  }

  refreshOutlines(): void {
    const want = new Map<Part, number>();
    for (const e of this.selection) for (const p of e.parts) if (!p.destroyed) want.set(p, SELECT_COLOR);
    // (a connection tool's ends: in its colour)
    for (const [p, c] of this.toolOutlines) if (!p.destroyed && !want.has(p)) want.set(p, c);
    if (this.hoverHighlights && this.hover && !this.hover.destroyed && !want.has(this.hover)) want.set(this.hover, HOVER_COLOR);
    for (const p of this.outlined) if (!want.has(p) && !p.destroyed) p.setOutline(false);
    for (const [p, c] of want) p.setOutline(true, c);
    this.outlined = new Set(want.keys());
  }

  selectAll(): void {
    this.selection = new Set(this.game.entities);
    this.refreshOutlines();
  }

  clearSelection(): void {
    this.selection.clear();
    this.refreshOutlines();
  }

  /** Spawning with Q / E (People Playground's) or with a click (see placement); kept for the next visit. */
  setPlacement(p: 'keys' | 'click'): void {
    this.placement = p;
    try {
      store.setItem(PLACEMENT_STORE, p);
    } catch {
      /* not kept: fine for this visit */
    }
  }

  deleteEntities(list: Entity[]): void {
    if (this.net) return this.net.send({ op: 'delete', ids: this.net.ids(list) });
    if (list.length) this.history.record(list.length > 1 ? `Delete ${list.length} objects` : 'Delete');
    for (const e of list) this.game.remove(e);
    this.refreshOutlines();
  }

  toggleFreeze(list: Entity[]): void {
    if (!list.length) return;
    if (this.net) return this.net.send({ op: 'freeze', ids: this.net.ids(list) });
    const freeze = !list.every((e) => e.frozen);
    this.history.record(freeze ? 'Freeze' : 'Unfreeze');
    for (const e of list) e.setFrozen(freeze);
    this.game.sound.click(this.wx, freeze ? 0.5 : 0.65);
  }

  /** Sets things alight, or puts them out if any of them is burning. */
  toggleFire(list: Entity[]): void {
    const parts = list.flatMap((e) => e.parts.filter((p) => !p.destroyed));
    if (!parts.length) return;
    const out = parts.some((p) => p.burning > 0.05);
    // nothing there would catch, nor mind the heat (see Fire.ignite()): it says so, rather than nothing happening
    if (!out && !parts.some((p) => p.mat.flammability > 0 || p.oil > 0 || 'onHeat' in p.entity)) {
      this.ui.toast(list.length > 1 ? 'None of these will burn: soak them in oil first' : `${list[0].label} won’t burn: soak it in oil first`);
      return;
    }
    if (this.net) return this.net.send({ op: 'ignite', ids: this.net.ids(list) });
    this.history.record(out ? 'Extinguish' : 'Ignite');
    for (const p of parts) {
      if (out) this.game.fire.extinguish(p);
      else this.game.fire.ignite(p, 0.8);
    }
  }

  setWeightless(list: Entity[], on: boolean): void {
    if (!list.length) return;
    if (this.net) return this.net.send({ op: 'weightless', ids: this.net.ids(list), on });
    this.history.record(on ? 'Make weightless' : 'Restore weight');
    for (const e of list) e.setWeightless(on);
  }

  activate(list: Entity[], held: boolean): void {
    if (this.net) {
      // (what's held on is let go again with the key: see releaseActivation())
      const fresh = held ? list.filter((e) => !this.activated.has(e)) : [];
      for (const e of fresh) this.activated.add(e);
      if (fresh.length) this.net.send({ op: 'activate', ids: this.net.ids(fresh) });
      return;
    }
    for (const e of list) {
      if (held) {
        if (!this.activated.has(e)) {
          e.activate();
          e.setActiveHeld(true);
          this.activated.add(e);
        }
      }
    }
  }

  /** Works things once (the context menu's Activate). */
  activateOnce(list: Entity[]): void {
    if (this.net) {
      const ids = this.net.ids(list);
      this.net.send({ op: 'activate', ids });
      this.net.send({ op: 'release', ids });
      return;
    }
    for (const e of list) e.activate();
  }

  setNoCollide(list: Entity[], on: boolean): void {
    if (!list.length) return;
    if (this.net) return this.net.send({ op: 'noCollide', ids: this.net.ids(list), on });
    this.history.record(on ? 'Disable collision' : 'Enable collision');
    for (const e of list) e.setNoCollide(on);
  }

  /** The camera keeps these centered until unfollowed (or the view is moved by hand). */
  setFollow(list: Entity[] | null): void {
    this.follow = list?.length ? list : null;
  }

  /** Selects the hovered object's kind in the toybox (to spawn more of it). */
  eyedrop(): void {
    const e = this.hover?.entity;
    const def = e?.def;
    if (!e || !def?.create) return;
    this.armed = def;
    // at its size, or in its shape
    this.armedConfig = e.config ? structuredClone(e.config) : undefined;
    this.ui.onArmedChanged(def);
    this.ui.toast(`Spawning ${e.label}`);
  }

  /** Undoes the last edit (see History). */
  undo(): void {
    // (one history for the whole game: the host's)
    if (this.net) return this.ui.toast('Only the host can undo');
    this.cancelForHistory();
    const label = this.history.undo();
    this.ui.toast(label === 'Play' ? 'Back to build: the scene as it was before Play' : label ? `Undid: ${label}` : 'Nothing to undo');
    this.ui.refreshToolbar();
  }

  redo(): void {
    if (this.net) return this.ui.toast('Only the host can redo');
    this.cancelForHistory();
    const label = this.history.redo();
    this.ui.toast(label ? `Redid: ${label}` : 'Nothing to redo');
    this.ui.refreshToolbar();
  }

  /**
   * Back to build: the scene as it was when time was last started after
   * building (Shift+Space, or the tool bar's ⟲ Back to build), paused.
   */
  rewind(): void {
    if (this.net) return this.net.send({ op: 'rewind' });
    const n = this.history.rewindDepth;
    if (!n) {
      this.ui.toast('Nothing to go back to: build with time paused, then press Play');
      return;
    }
    // (each step undone, so redo goes forward through them again)
    this.cancelForHistory();
    for (let i = 0; i < n; i++) this.history.undo();
    this.game.paused = true;
    this.ui.toast('Back to build: the scene as it was before Play');
    this.ui.refreshToolbar();
  }

  /** Lets go of whatever is in hand: the scene is about to be replaced. */
  private cancelForHistory(): void {
    this.endGrab();
    this.releaseActivation();
    this.connect.cancel();
    this.arrange.overlaps = [];
    this.arrange.group = null;
    this.spin = null;
    this.resize = null;
    this.clearSelection();
  }

  releaseActivation(): void {
    if (this.net && this.activated.size) this.net.send({ op: 'release', ids: this.net.ids([...this.activated]) });
    else for (const e of this.activated) e.setActiveHeld(false);
    this.activated.clear();
  }

  // ---- the touch bar: the keyboard commands for fingers ---------------------------

  /** What the touch bar acts on: the object being dragged, else the selection. */
  touchTargets(): Entity[] {
    if (this.grab && !this.grab.part.entity.destroyed) return [this.grab.part.entity];
    return [...this.selection].filter((e) => !e.destroyed);
  }

  /**
   * Holding a rotate button (dir 1 is left, -1 right): turns the dragged object
   * while held, or turns the selection a step per press (or what's about to be placed).
   */
  holdRotate(dir: 1 | -1, on: boolean): void {
    const id = dir === 1 ? 'rotateLeft' : 'rotateRight';
    if (!on) {
      this.held.delete(id);
      return;
    }
    if (this.placer.ghost?.solid) {
      this.placer.turn(dir * this.arrange.angleStep);
      return;
    }
    this.held.add(id);
    if (!this.grab) this.rotateSelection(this.touchTargets(), dir * this.arrange.angleStep);
  }

  /** The touch screen's drive and aim buttons: held as the keys are (see steer()). */
  holdDrive(id: 'driveLeft' | 'driveRight' | 'aimUp' | 'aimDown', on: boolean): void {
    if (on) this.held.add(id);
    else this.held.delete(id);
  }

  /** What the selection has for the drive buttons: a vehicle to drive, a tank to aim. */
  drivable(): { drive: boolean; aim: boolean } {
    const v = this.vehicles();
    return { drive: v.length > 0, aim: v.some((c) => c instanceof Tank) };
  }

  /** The touch bar's Flip: the selection, or what's about to be placed. */
  touchFlip(): void {
    if (this.placer.ghost?.solid) this.placer.mirror();
    else this.flip(this.touchTargets());
  }

  /** The context menu for the selection, at a screen point (the touch bar's More). */
  openMenuForSelection(sx: number, sy: number): void {
    const e = this.touchTargets()[0];
    const part = e?.parts.find((p) => !p.destroyed);
    if (!part) return;
    this.sx = sx;
    this.sy = sy;
    this.openMenuFor(part);
  }

  /** Duplicates keep held items, lodged blades and connections inside the selection. */
  duplicate(list: Entity[]): void {
    if (!list.length) return;
    if (this.net) return this.net.send({ op: 'duplicate', ids: this.net.ids(this.withAttached(list)) });
    this.history.record('Duplicate');
    const made = instantiate(this.game, capture(this.game, this.withAttached(list)), { dx: 0.6, dy: 0.3 });
    this.created(made);
    this.selection = new Set(made);
    this.refreshOutlines();
  }

  copy(list: Entity[]): void {
    if (!list.length) return;
    const all = this.withAttached(list);
    this.clipboard = capture(this.game, all);
    // (pictures of them as they are, for the ghost while pasting)
    const mid = snapCenter(this.clipboard);
    this.placer.clipImages = imagesOfParts(all.flatMap((e) => e.parts), mid.x, mid.y);
    this.ui.toast(`Copied ${list.length} object${list.length > 1 ? 's' : ''}`);
  }

  /** The list plus anything those entities hold. */
  withAttached(list: Entity[]): Entity[] {
    const out = new Set(list);
    for (const e of list) for (const a of e.attachedEntities()) out.add(a);
    return [...out];
  }

  paste(): void {
    this.placer.paste();
  }

  /** Mirrors the entities as one group (a single entity flips around its center). */
  flip(list: Entity[]): void {
    // something held faces the way whoever holds it does: flipping it turns them round with it
    // (flipped alone, it came out of their hand)
    list = [...new Set(list.map((e) => (e as Entity & { holder?: Entity | null }).holder ?? e))];
    if (this.net) return this.net.send({ op: 'flip', ids: this.net.ids(list) });
    if (list.length) this.history.record('Flip');
    const made = this.game.flipEntities(list);
    this.selection = new Set(made);
    this.refreshOutlines();
  }

  // ---- context menu ------------------------------------------------------------

  private openMenuAtCursor(): void {
    this.menuFor = [];
    const part = this.game.pick(this.wx, this.wy, this.pickRadius());
    // (on a connection itself: its own menu, which offers the thing under it too;
    // on something selected, the selection's as ever)
    const hit = this.connect.hit({ x: this.wx, y: this.wy });
    if (hit && !(part && this.selection.has(part.entity))) {
      this.openConnMenu(hit.c, part);
      return;
    }
    // (a long press on empty space on a touch screen while spawning stops spawning; on an object, its menu as ever)
    if (this.armed && this.touchMode && !part) {
      this.arm(null);
      return;
    }
    if (!part) {
      const k = (id: ActionId) => this.bindings.label(id) || undefined;
      const acts: ContextAction[] = [];
      if (this.clipboard) acts.push({ label: 'Paste', hint: k('paste'), action: () => this.paste() });
      acts.push({ label: 'Select all', hint: 'Ctrl+A', action: () => this.selectAll() });
      if (this.selection.size) acts.push({ label: 'Deselect', action: () => this.clearSelection() });
      if (this.follow) acts.push({ label: 'Unfollow', action: () => this.setFollow(null) });
      const time = this.bindings.label('time').split(' / ')[0];
      if (this.history.atCheckpoint && !this.net) acts.push({ label: 'Back to build (before Play)', hint: time ? `Shift+${time}` : undefined, action: () => this.rewind() });
      acts.push({ label: this.game.paused ? 'Resume time' : 'Pause time', hint: k('time'), action: () => this.togglePause() });
      this.ui.openContextMenu(this.sx, this.sy, 'Sandbox', acts);
      return;
    }
    this.openMenuFor(part);
  }

  /** The context menu for an object (and the rest of the selection, if it's in it), in People Playground's order. */
  private openMenuFor(part: Part): void {
    const e = part.entity;
    if (!this.selection.has(e)) {
      this.selection.clear();
      this.selection.add(e);
      this.refreshOutlines();
    }
    const list = this.targets();
    const multi = list.length > 1;
    const k = (id: ActionId) => this.bindings.label(id) || undefined;
    const acts: ContextAction[] = [];
    acts.push({ label: multi ? `Delete ${list.length} objects` : 'Delete', hint: k('delete'), danger: true, action: () => this.deleteEntities(list) });
    acts.push({ label: 'Copy', hint: k('copy'), action: () => this.copy(list) });
    if (this.clipboard) acts.push({ label: 'Paste', hint: k('paste'), action: () => this.paste() });
    const following = !!this.follow && list.every((x) => this.follow!.includes(x));
    acts.push({ label: following ? 'Unfollow' : 'Follow', action: () => this.setFollow(following ? null : list) });
    if (list.some((x) => x.activatable)) acts.push({ label: 'Activate', hint: k('activate'), action: () => this.activateOnce(list) });
    const burning = list.some((x) => x.parts.some((p) => !p.destroyed && p.burning > 0.05));
    acts.push({ label: burning ? 'Extinguish' : 'Ignite', hint: k('ignite'), action: () => this.toggleFire(list) });
    const allFrozen = list.every((x) => x.frozen);
    acts.push({ label: allFrozen ? 'Unfreeze' : 'Freeze', hint: k('freeze'), action: () => this.toggleFreeze(list) });
    if (!multi && e.parts.length > 1) {
      acts.push({ label: part.frozen ? `Unfreeze ${part.name.toLowerCase()}` : `Freeze ${part.name.toLowerCase()}`, action: () => this.freezePart(part) });
    }
    const nc = list.every((x) => x.noCollide);
    acts.push({ label: nc ? 'Enable collision' : 'Disable collision', hint: k('noCollide'), action: () => this.setNoCollide(list, !nc) });
    const light = list.every((x) => x.weightless);
    acts.push({ label: light ? 'Restore weight' : 'Make weightless', action: () => this.setWeightless(list, !light) });
    acts.push({ label: 'Flip', hint: k('flip'), action: () => this.flip(list) });
    acts.push({ label: 'Set angle…', action: () => this.arrange.openSetAngle(list) });
    acts.push({ label: 'Layer…', action: () => this.openLayerMenu(list) });
    acts.push({ label: 'Duplicate', hint: 'Ctrl+D', action: () => this.duplicate(list) });
    acts.push({ label: 'Duplicate mirrored', action: () => this.arrange.duplicateMirrored(list) });
    if (multi) {
      acts.push({ label: 'Weld together', action: () => this.weldTogether(list) });
      acts.push({ label: 'Arrange…', action: () => this.ui.openContextMenu(this.sx, this.sy, 'Arrange', this.arrange.arrangeActions(list)) });
    }
    const whole = this.game.connections.assemblyOf(list);
    if (whole.length > list.length) acts.push({ label: `Select assembly (${whole.length})`, action: () => this.arrange.selectAssembly(e) });
    acts.push(...this.arrange.overlapActions(e));
    acts.push({ label: 'Save as contraption…', action: () => this.ui.saveContraption(this.withAttached(list)) });
    if (!multi && e.def.resizable && e.config && e.def.id !== 'shape') acts.push({ label: 'Reset size', action: () => this.setSize(e) });
    const conns = list.flatMap((x) => this.game.connections.connectionsOf(x));
    if (conns.length) acts.push({ label: `Remove connections (${conns.length})`, action: () => this.unconnect(conns, false) });
    // how far the hinge (or pin) nearest the cursor may swing
    let hinge: Connection | null = null;
    let hd = Infinity;
    for (const c of multi ? [] : this.game.connections.connectionsOf(e)) {
      if (c.kind !== 'hinge' && c.kind !== 'pin') continue;
      const at = c.a.localToWorld(c.la.x, c.la.y);
      const d = Math.hypot(at.x - this.wx, at.y - this.wy);
      if (d < hd) {
        hd = d;
        hinge = c;
      }
    }
    if (hinge) {
      const c = hinge;
      const what = c.kind === 'pin' ? 'Pin' : 'Hinge';
      for (const deg of HINGE_LIMITS) {
        const rad = (deg * Math.PI) / 180;
        acts.push({
          label: deg ? `${what} swings ±${deg}°` : `${what} swings freely`,
          checked: deg ? c.limit !== undefined && Math.abs(c.limit - rad) < 1e-6 : c.limit === undefined,
          action: () => this.setLimit(c, deg ? rad : null),
        });
      }
    }
    // how stiff the spring nearest the cursor is
    const spring = multi ? null : this.game.connections.springAt(this.wx, this.wy, Infinity, e);
    if (spring) acts.push(...this.connect.springActions(spring));
    // its own numbers in a panel (a gun's recoil, power...)
    const ed = multi ? null : (e as Entity & { editor?(): ValueEditor | null }).editor?.() ?? null;
    if (ed) acts.push({ label: ed.label, action: () => this.editValues(ed, e) });
    // fuse cords tied to it are lit at its end
    const fuses = multi ? [] : this.game.connections.connectionsOf(e).filter((c) => c.kind === 'fuse' && !c.burn);
    if (fuses.length) {
      acts.push({ label: fuses.length > 1 ? `Light fuse cords (${fuses.length})` : 'Light fuse cord', action: () => {
        for (const c of fuses) this.connect.lightFuse(c, c.a.entity === e ? 0 : 1);
      } });
    }
    if (!multi && isLiving(e)) {
      acts.push({ label: 'Vitals', hint: k('vitals'), checked: this.vitalsPinned === e, action: () => (this.vitalsPinned = this.vitalsPinned === e ? null : e) });
    }
    // people and animals: set on someone, or on each other
    const fighters = list.filter((x): x is Fighter => isFighter(x) && x.alive);
    if (multi && fighters.length > 1) acts.push({ label: 'Fight each other', action: () => this.fightEach(fighters) });
    else if (!multi && isFighter(e) && e.alive) acts.push({ label: 'Fight…', action: () => this.pickFoe(e) });
    // and put on a side, all of them picked (see Teams)
    if (!this.net) acts.push(...teamActions(list, () => this.history.record('Set team')));
    if (!multi) acts.push(...(this.net ? this.forHost(e, e.contextActions(part), part) : e.contextActions(part)));
    this.ui.openContextMenu(this.sx, this.sy, multi ? `${list.length} objects` : e.label, acts);
    this.menuFor = list;
  }

  /** Bring to front, Send to back, one step either way (People Playground's render layers). */
  private openLayerMenu(list: Entity[]): void {
    const k = (id: ActionId) => this.bindings.label(id) || undefined;
    const go = (dir: LayerDir) => () => this.arrange.layer(list, dir);
    this.ui.openContextMenu(this.sx, this.sy, 'Layer', [
      { label: 'Bring to front', hint: k('layerFront'), action: go('front') },
      { label: 'Forward one', action: go('up') },
      { label: 'Back one', action: go('down') },
      { label: 'Send to back', hint: k('layerBack'), action: go('back') },
    ]);
    this.menuFor = list;
  }

  /**
   * An object's own context-menu entries in someone else's game: the host does
   * the one picked, to its own copy of the object.
   */
  private forHost(e: Entity, acts: ContextAction[], part?: Part | null): ContextAction[] {
    // (with the part clicked, for what's done to one of its parts: a bone broken, say)
    const at = part ? e.parts.indexOf(part) : -1;
    return acts.map((a) => ({ ...a, action: () => this.net?.send({ op: 'act', id: e.netId, path: [a.label], ...(at >= 0 ? { part: at } : {}) }) }));
  }

  /** People and animals picked together go for each other. */
  private fightEach(list: Fighter[]): void {
    if (this.net) return this.net.send({ op: 'fightEach', ids: this.net.ids(list) });
    setFighting(list);
  }

  /** The next click picks who `f` should go for (and they go for it straight away). */
  private pickFoe(f: Fighter): void {
    const click = this.touchMode ? 'Tap' : 'Click';
    this.picking = {
      hint: `${click} who to fight · ${this.touchMode ? 'tap empty space' : 'Esc or right-click'}: cancel`,
      pick: (e) => {
        if (f.destroyed || !f.alive) {
          this.picking = null;
          return 'They can no longer fight';
        }
        if (e === f) return 'Pick someone else to fight';
        if (this.net && isLiving(e)) {
          this.net.send({ op: 'fight', a: f.netId, b: e.netId });
          return true;
        }
        return f.fight(e) ? true : allies(f, e) ? 'They’re on the same side' : 'That can’t be fought: pick a person or an animal';
      },
    };
  }

  /** A single part of something frozen in place, or let go again. */
  private freezePart(part: Part): void {
    if (this.net) return this.net.send({ op: 'freezePart', p: this.net.ref(part) });
    this.history.record(part.frozen ? 'Unfreeze' : 'Freeze');
    part.setFrozen(!part.frozen);
  }

  /**
   * A click while picking: the left button picks what's under the cursor; any
   * other, or one on empty space, cancels (a finger has no Esc or right button).
   */
  private pickAt(button: number): void {
    const p = this.picking!;
    const part = button === 0 ? this.game.pick(this.wx, this.wy, this.pickRadius()) : null;
    if (!part) {
      this.picking = null;
      return;
    }
    const res = p.pick(part.entity);
    if (res === true) this.picking = null;
    else this.ui.toast(res);
  }

  /** Opens an object's edit panel; its first change is recorded for undo. */
  private editValues(ed: ValueEditor, e: Entity): void {
    let recorded = false;
    const record = () => {
      if (!recorded) this.history.record(ed.title);
      recorded = true;
    };
    // (in someone else's game the panel shows our copy's numbers, and the host's object is changed)
    const net = this.net;
    const id = e.netId;
    this.ui.editValues({
      ...ed,
      alive: () => !e.destroyed,
      fields: ed.fields.map((f) => ({
        ...f,
        set: (v: number) => {
          if (net) {
            f.set(v);
            net.send({ op: 'edit', id, key: f.key, v });
            return;
          }
          record();
          f.set(v);
        },
      })),
      reset: () => {
        if (net) {
          ed.reset();
          net.send({ op: 'editReset', id });
          return;
        }
        record();
        ed.reset();
      },
    });
  }

  // ---- keyboard -------------------------------------------------------------

  /** Switches to another map, clearing the scene (in someone else's game, the host does it for everyone). */
  switchMap(spec: MapSpec): void {
    if (this.net) return this.net.send({ op: 'map', map: spec });
    // (undo switches back, with the scene as it was)
    this.history.record('Switch map');
    this.game.setMap(spec);
    this.clearSelection();
  }

  /** The map in play with other ground (the Terrain tool; in someone else's game, the host changes it). */
  reshapeMap(spec: MapSpec): void {
    if (this.net) return this.net.send({ op: 'terrain', map: spec });
    this.game.reshapeMap(spec);
  }

  /** Clears the scene (the tool bar's Clear and Reset). */
  clearScene(label: string): void {
    if (this.net) return this.net.send({ op: 'clear' });
    this.history.record(label);
    this.game.resetEnvironment();
    this.clearSelection();
  }

  /** Replaces the scene with a saved one (a guest's goes into the host's game, for everyone). */
  loadScene(json: string, label: string): void {
    if (this.net) return this.net.send({ op: 'load', save: json });
    this.history.record(label);
    loadFromString(this.game, json);
    this.clearSelection();
  }

  /** The simulation speed (the tool bar's speed setting). */
  setTimeScale(s: number): void {
    if (this.net) return this.net.send({ op: 'time', scale: s });
    this.game.timeScale = s;
    this.ui.refreshToolbar();
  }

  /**
   * Pauses time, or starts it again. Started again after building, the scene as
   * it was is kept: undo (or ⟲ Back to build) goes back to it, paused, as
   * though the test run never happened.
   */
  togglePause(): void {
    // (time is the host's: it's shown here once the host has it)
    if (this.net) return this.net.send({ op: 'time', paused: !this.game.paused });
    if (this.game.paused) this.play();
    else this.history.paused();
    this.game.paused = !this.game.paused;
    this.ui.refreshToolbar();
  }

  /** Time is about to start after building: the checkpoint, and a word about parts pushed into each other. */
  private play(): void {
    this.settleGrab();
    if (!this.history.dirtySincePause) return;
    this.history.record('Play', { paused: true });
    const n = this.arrange.liveOverlaps().length;
    if (n) this.ui.toast(`${n} overlap${n > 1 ? 's' : ''} will fly apart · ${this.bindings.label('time') ? 'Shift+' + this.bindings.label('time') : 'Undo'}: back to build`);
    this.arrange.overlaps = [];
  }

  toggleSlowMotion(): void {
    if (this.net) return this.net.send({ op: 'time', scale: this.game.timeScale < 1 ? 1 : SLOW_MOTION });
    this.game.timeScale = this.game.timeScale < 1 ? 1 : SLOW_MOTION;
    this.ui.refreshToolbar();
  }

  /** One physics tick (pausing first). */
  step(): void {
    if (this.net) return this.net.send({ op: 'time', step: true });
    if (!this.game.paused) {
      this.history.paused();
      this.game.paused = true;
      this.ui.refreshToolbar();
    } else {
      // (a tick after building is a test too: the scene before it is kept)
      this.play();
      this.history.paused();
    }
    this.game.stepRequests++;
  }

  /** Alt+arrows with time paused and something selected: nudged a sprite pixel (Shift: 8). True if it was. */
  private nudgeKey(code: string, shift: boolean): boolean {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const d = dirs[code];
    if (!d || !this.game.paused || !this.selection.size) return false;
    const step = PX * (shift ? 8 : 1);
    this.arrange.nudge([...this.selection].filter((e) => !e.destroyed), d[0] * step, d[1] * step);
    return true;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    // keys typed into a box or setting are its own, but Esc leaves it (and closes its panel),
    // and a key let go there is let go (one held down before the box took the keys would stay held)
    const field = e.target as HTMLElement | null;
    const tag = field?.tagName;
    if (down && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
      if (e.code !== 'Escape') return;
      field!.blur();
    }
    // (Space or Enter on a button given the focus, by Tab or a panel opening, presses that button only)
    if (down && tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return;
    const code = e.code;
    const ids = this.bindings.actionsFor(code);
    if (!down) {
      this.keys.delete(code);
      // a modifier pressed and let go on its own: its command
      if (this.modTap === code) {
        this.modTap = null;
        for (const id of ids) this.command(id, false);
      }
      // Q, E or V let go: what they were placing goes where its ghost is
      for (const id of ids) if (id === 'spawnLeft' || id === 'spawnRight' || id === 'paste') this.placer.end(id);
      // Z or F held for spawning and let go without spawning anything: their own command now
      for (const id of ids) {
        if (!this.deferred.has(id) || this.isHeld(id)) continue;
        this.deferred.delete(id);
        this.command(id, false);
      }
      if (ids.includes('activate') && !this.isHeld('activate')) this.releaseActivation();
      if (ids.length && isModifier(code)) e.preventDefault();
      return;
    }
    const first = !this.keys.has(code);
    this.keys.add(code);
    // a panel open over the sandbox has the keys: only Esc (and the Controls key) get past it, to close it
    const covered = this.ui.isPanelOpen();
    if (isModifier(code)) {
      if (first && !covered) this.modTap = code;
      // (Alt would otherwise move the focus to the browser's menu)
      if (ids.length) e.preventDefault();
      return;
    }
    this.modTap = null;
    if (covered && code !== 'Escape' && !ids.some((id) => id === 'menu' || id === 'help')) return;
    // Escape always closes an open context menu first
    if (code === 'Escape' && this.ui.isMenuOpen()) {
      this.ui.closeContextMenu();
      return;
    }
    if (code === 'Escape' && this.picking) {
      this.picking = null;
      return;
    }
    // a size handle held: the keys type a size
    if (this.resize && !e.ctrlKey && !e.metaKey && this.typeSize(code)) {
      e.preventDefault();
      return;
    }
    // Enter finishes the outline being drawn
    if (code === 'Enter' && this.draft) {
      this.finishDraft();
      e.preventDefault();
      return;
    }
    // Alt+arrows nudge what's selected (time paused)
    if (e.altKey && !e.ctrlKey && this.nudgeKey(code, e.shiftKey)) {
      e.preventDefault();
      return;
    }
    // what's being placed: A/D turn it (placing with clicks, Q/E too), R mirrors it
    const clickHint = this.placer.clickHint;
    if (this.placer.ghost?.key || clickHint) {
      const turn = ids.find((id) => id === 'rotateLeft' || id === 'rotateRight' || (clickHint && (id === 'spawnLeft' || id === 'spawnRight')));
      if (turn && !this.tutorialBlocks?.(turn)) {
        this.placer.turn((turn === 'rotateLeft' || turn === 'spawnLeft' ? 1 : -1) * (e.shiftKey ? Math.PI / 2 : this.arrange.angleStep));
        e.preventDefault();
        return;
      }
      if (ids.includes('flip')) {
        if (first) this.placer.mirror();
        e.preventDefault();
        return;
      }
    }
    // G (slow motion's key) while placing, with Shift held or Q/E: the grid's size, then hidden
    if (ids.includes('slowmo') && this.placer.ghost && (this.placer.ghost.key || this.isHeld('fast'))) {
      if (first) this.arrange.cyclePlacingGrid();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (this.tutorialBlocks?.(`Ctrl+${code}`)) {
        e.preventDefault();
        return;
      }
      // the usual shortcuts, besides People Playground's keys
      if (code === 'KeyZ') {
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (code === 'KeyY') this.redo();
      else if (code === 'KeyD') this.duplicate(this.targets());
      else if (code === 'KeyC') this.copy(this.targets());
      else if (code === 'KeyV') this.paste();
      else if (code === 'KeyA') this.selectAll();
      else if (code === 'KeyS') this.ui.save();
      else if (code === 'KeyO') this.ui.load();
      else return;
      e.preventDefault();
      return;
    }
    if (!ids.length) return;
    for (const id of ids) {
      if (this.tutorialBlocks?.(id)) continue;
      if (first && this.defers(id)) this.deferred.add(id);
      // Q, E and V: held, a ghost shows where it will go; let go, it's placed (see Placer)
      else if (id === 'spawnLeft' || id === 'spawnRight' || id === 'paste') {
        // (placing with clicks, Q/E turn what's placed instead: see above)
        if (first && (id === 'paste' || this.placement !== 'click' || !this.armed)) this.placer.begin(id);
      } else if (first || REPEATS.has(id)) this.command(id, e.shiftKey);
    }
    e.preventDefault();
  }

  /** Runs a keyboard command (on its key going down). */
  command(id: ActionId, shift = false): void {
    if (this.tutorialBlocks?.(id)) return;
    switch (id) {
      case 'activate':
        this.activate(this.activationTargets(), true);
        break;
      case 'delete':
        // (drawing an outline, it takes back the last corner; on a connection, nothing selected, that goes)
        if (this.draft?.pts.length) this.draft.pts.pop();
        else if (!this.connect.deleteHovered()) this.deleteEntities(this.targets());
        break;
      case 'slowmo':
        this.toggleSlowMotion();
        break;
      case 'detail':
        this.detail = !this.detail;
        break;
      case 'xray':
        this.xray = !this.xray;
        break;
      case 'vitals': {
        // pins the vitals of the person or animal under the cursor (or selected); again, puts them away
        const e = this.targets().find(isLiving) ?? null;
        this.vitalsPinned = e && e !== this.vitalsPinned ? e : null;
        break;
      }
      case 'time':
        // (Shift: back to build, as it was before Play)
        if (shift && (this.net || this.history.atCheckpoint) && !this.tutorialBlocks?.('rewind')) this.rewind();
        else this.togglePause();
        break;
      case 'rewind':
        this.rewind();
        break;
      case 'step':
        this.step();
        break;
      case 'spawnLeft':
      case 'spawnRight':
        this.spawnArmed(id === 'spawnLeft');
        break;
      case 'rotateLeft':
      case 'rotateRight':
        // held while dragging, it turns what's held (see preStep()); otherwise a step for the selection
        if (!this.grab) this.rotateSelection([...this.selection], (id === 'rotateLeft' ? 1 : -1) * (shift || this.isHeld('fast') ? Math.PI / 2 : this.arrange.angleStep));
        break;
      case 'undo':
        this.removeLastCreation();
        break;
      case 'copy':
        this.copy(this.targets());
        break;
      case 'paste':
        this.paste();
        break;
      case 'freeze':
        this.toggleFreeze(this.freezeTargets());
        break;
      case 'ignite':
        this.toggleFire(this.heldOrTargets());
        break;
      case 'noCollide': {
        const list = this.targets();
        this.setNoCollide(list, !list.every((x) => x.noCollide));
        break;
      }
      case 'flip':
        this.flip(this.targets());
        break;
      case 'jump':
        if (this.net) this.net.send({ op: 'jump', ids: this.net.ids(this.targets()) });
        else for (const x of this.targets()) x.jump();
        break;
      case 'eyedrop':
        this.eyedrop();
        break;
      case 'hoverHighlights':
        this.hoverHighlights = !this.hoverHighlights;
        this.refreshOutlines();
        break;
      case 'layerFront':
      case 'layerBack':
        this.arrange.layer(this.targets(), id === 'layerFront' ? 'front' : 'back');
        break;
      case 'gridSize':
        this.arrange.cycleGrid();
        break;
      case 'angleStep':
        this.arrange.cycleAngle();
        break;
      case 'toolPower':
        this.toggleTab();
        break;
      case 'menu':
        if (this.ui.closeOverlays()) break;
        if (this.draft || this.resize || this.arrange.group || this.spin) {
          this.draft = null;
          this.resize = null;
          this.arrange.group = null;
          this.spin = null;
          break;
        }
        if (this.connect.busy) {
          this.connect.cancel();
          break;
        }
        if (this.placer.ghost?.solid) {
          this.placer.cancel();
          break;
        }
        this.ui.togglePauseMenu();
        break;
      case 'toybox':
        this.ui.toggleToybox();
        break;
      case 'toggleUi':
        this.ui.toggleInterface();
        break;
      case 'help':
        this.ui.toggleHelp();
        break;
      case 'zoomIn':
      case 'zoomOut': {
        const r = this.game.renderer;
        const c = r.worldToScreen(r.camX, r.camY);
        r.zoomAt(c.x, c.y, id === 'zoomIn' ? 1.25 : 0.8);
        break;
      }
      case 'recenter': {
        this.follow = null;
        const home = this.game.home();
        this.game.renderer.camX = home.x;
        this.game.renderer.camY = home.y;
        break;
      }
      default:
        if (id.startsWith('tool')) this.selectSlot(Number(id.slice(4)) - 1);
    }
  }

  // ---- per-frame ----------------------------------------------------------------

  private frame(dt: number): void {
    const r = this.game.renderer;
    // keyboard panning (with vehicles selected, keys the drive keys share drive them instead, and with tanks, the aim keys' aim them;
    // with Alt, time paused and something selected, the arrows nudge it instead)
    const speed = (900 / r.zoom) * dt * (this.isHeld('fast') ? 2.5 : 1);
    const cars = this.selection.size ? this.vehicles() : [];
    const tanks = cars.some((c) => c instanceof Tank);
    const nudging = this.game.paused && this.selection.size > 0 && (this.keys.has('AltLeft') || this.keys.has('AltRight'));
    let mx = 0;
    let my = 0;
    if (!nudging) {
      if (cars.length ? this.heldApart('panLeft', 'driveLeft') : this.isHeld('panLeft')) mx -= 1;
      if (cars.length ? this.heldApart('panRight', 'driveRight') : this.isHeld('panRight')) mx += 1;
      if (tanks ? this.heldApart('panUp', 'aimUp') : this.isHeld('panUp')) my += 1;
      if (tanks ? this.heldApart('panDown', 'aimDown') : this.isHeld('panDown')) my -= 1;
    }
    if (mx || my) {
      this.follow = null;
      r.camX += mx * speed;
      r.camY += my * speed;
      r.clampCamera();
    } else if (cars.length && !this.follow && this.axis('driveLeft', 'driveRight')) this.keepInView(cars, dt);
    // the camera keeps what it follows centered
    if (this.follow) {
      const live = this.follow.filter((e) => !e.destroyed);
      if (!live.length) this.follow = null;
      else {
        let cx = 0;
        let cy = 0;
        for (const e of live) {
          const c = e.center();
          cx += c.x / live.length;
          cy += c.y / live.length;
        }
        const k = Math.min(1, dt * 6);
        r.camX += (cx - r.camX) * k;
        r.camY += (cy - r.camY) * k;
        r.clampCamera();
      }
    }
    // world position under a stationary mouse changes as the camera moves
    const w = r.screenToWorld(this.sx, this.sy);
    this.wx = w.x;
    this.wy = w.y;
    // how fast the cursor moves on screen (flicks for the powers)
    const fdt = Math.max(dt, 1e-3);
    this.flick = {
      x: this.flick.x * 0.4 + ((this.sx - this.lastS.x) / fdt) * 0.6,
      y: this.flick.y * 0.4 + ((this.sy - this.lastS.y) / fdt) * 0.6,
    };
    this.lastS = { x: this.sx, y: this.sy };

    if (this.net) this.sendInput();
    else if (this.grab && this.game.paused) this.dragPaused(this.grab, dt);
    this.drawPowerReach();

    // hover (a finger only hovers what it's on)
    const busy = this.pan || this.box;
    const lifted = this.touchMode && !this.touches.size;
    const h = busy ? this.hover : this.grab ? this.grab.part : lifted ? null : this.game.pick(this.wx, this.wy, this.pickRadius());
    let changed = h !== this.hover;
    this.hover = h;
    // the connection tools: what's under the cursor, where ends would go, the ghosts; the placer's ghost
    this.connect.frame();
    this.placer.frame();
    if (this.cycle && !this.grab && Math.hypot(this.sx - this.cycle.sx, this.sy - this.cycle.sy) > DOUBLE_SLOP) this.cycle = null;
    // the parts the connection's ends are on, outlined in its colour
    const kind = this.connect.pending?.kind ?? (this.toolKind && this.toolKind !== 'remove' ? (this.toolKind === 'pin' ? 'hinge' : this.toolKind) : null);
    const col = kind ? RAMPS[kind][3] : 0;
    const want = new Map<Part, number>();
    for (const a of this.connect.ends) if (a.part) want.set(a.part, col);
    if (want.size !== this.toolOutlines.size || [...want.keys()].some((p) => !this.toolOutlines.has(p))) {
      this.toolOutlines = want;
      changed = true;
    }
    if (changed) this.refreshOutlines();
  }

  /**
   * A guest tells the host where its cursor is, and what its hand and power are
   * doing there (about thirty times a second: the host does the dragging), and
   * how it's driving the selected vehicles (see steer()).
   */
  private sendInput(): void {
    const now = performance.now();
    if (now - this.sentAt < 33) return;
    this.sentAt = now;
    const net = this.net!;
    net.send({ op: 'cursor', x: this.wx, y: this.wy });
    if (this.grab) {
      const t = this.dragTarget();
      const snap = this.arrange.dragSnap();
      net.send({ op: 'drag', x: t.x, y: t.y, rot: this.turnRate(), snap: snap.grid, grid: snap.gridSize, step: snap.angleStep });
    }
    const kind = this.powerOn ? this.powerKind : null;
    if (kind || this.powerSent) net.send({ op: 'power', kind, x: this.wx, y: this.wy, fx: this.flick.x, fy: this.flick.y });
    this.powerSent = !!kind;
    // (renewed while the keys are held: let go, or the guest gone, the host's vehicles let go by themselves soon after)
    const x = this.axis('driveLeft', 'driveRight');
    const aim = this.axis('aimDown', 'aimUp');
    const cars = x || aim ? this.vehicles() : [];
    const stop = this.driveSent.filter((v) => !cars.includes(v));
    if (stop.length) net.send({ op: 'drive', ids: net.ids(stop), x: 0, aim: 0 });
    if (cars.length) net.send({ op: 'drive', ids: net.ids(cars), x, aim });
    this.driveSent = cars;
  }

  /** Push, pull and lift show how far they reach around the cursor. */
  private drawPowerReach(): void {
    const kind = this.powerKind;
    if (kind !== 'push' && kind !== 'pull' && kind !== 'lift') return;
    if (this.touchMode && !this.powerOn) return;
    const R = POWER.radius;
    const n = 40;
    const col = this.powerOn ? 0x9fd0ff : 0x5d7186;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.game.projectiles.drawBeam(this.wx + Math.cos(a0) * R, this.wy + Math.sin(a0) * R, this.wx + Math.cos(a1) * R, this.wy + Math.sin(a1) * R, PX, col, 0, this.powerOn ? 0 : PX * 4);
    }
  }

  /** What's selected, while building: how many, how heavy, how big. */
  private selectionChip(): string {
    const list = [...this.selection].filter((e) => !e.destroyed);
    if (!list.length) return '';
    const b = boxOf(list);
    const kg = list.reduce((s, e) => s + e.parts.reduce((m, p) => m + (p.destroyed ? 0 : p.mass), 0), 0);
    const size = b ? ` · ${(b.x1 - b.x0).toFixed(2)} × ${(b.y1 - b.y0).toFixed(2)} m` : '';
    return `${list.length > 1 ? `${list.length} objects` : list[0].label} · ${kg < 10 ? kg.toFixed(1) : Math.round(kg)} kg${size}`;
  }

  /** Cursor hint for the status bar. */
  get hint(): string {
    const click = this.touchMode ? 'Tap' : 'Click';
    const hold = this.touchMode ? 'Hold a finger down' : 'Hold the left button';
    if (this.picking) return this.picking.hint;
    if (this.placer.ghost?.solid) {
      const g = this.placer.ghost;
      if (!g.key) return `Tap it again (or ✓) to place ${g.def?.name ?? 'it'} · tap elsewhere: move it · ⟲ ⟳ Flip: turn it`;
      const a = this.bindings.label('rotateLeft');
      const d = this.bindings.label('rotateRight');
      const rr = this.bindings.label('flip');
      const turned = g.angle ? ` · ${Math.round((g.angle * 180) / Math.PI)}°` : '';
      return `Let go to place${turned}${a || d ? ` · ${[a, d].filter(Boolean).join('/')}: turn` : ''}${rr ? ` · ${rr}: mirror` : ''}${this.game.paused ? ' · Alt: grid' : ''} · Esc: cancel`;
    }
    if (this.connect.busy || (this.toolKind && this.connect.label)) {
      return this.connect.label || 'Release over the target object';
    }
    if (this.resize) {
      const r = this.resize;
      if (r.typed !== undefined) return `Size: ${r.typed}▌ m · Enter: apply · Backspace · Esc: cancel`;
      return `${(r.w * PX).toFixed(2)} × ${(r.h * PX).toFixed(2)} m · type a size (1.2 x 0.5) · Shift: keep proportions · Alt: snap · Esc: cancel`;
    }
    if (this.arrange.group) return `${Math.round(this.arrange.group.k * 100)}% · Alt: in quarters · Esc: cancel`;
    if (this.spin) return `Turned ${Math.round(this.spinAngle!)}° · Alt: in ${this.arrange.settings.angle}° steps`;
    if (this.grab && this.game.paused && this.grab.moveList && !this.net) {
      const n = this.grab.moveList.length;
      const alone = this.grab.alone;
      return `${alone ? 'Moving just this' : n > 1 ? `Moving ${n} joined objects (Ctrl as you grab: just this)` : 'Moving'} · A/D: turn · Alt: grid`;
    }
    if (this.draft?.pts.length) {
      return `${click} corners · the first one${this.touchMode ? '' : ' or Enter'} finishes · ${this.bindings.label('delete') || 'Backspace'}: undo · Esc: cancel`;
    }
    if (this.shaping && this.terrain) {
      return this.touchMode
        ? 'Ground: drag out a box, or tap corners and the first one again · Remove tool: tap ground to take it away'
        : 'Ground: drag out a box (Shift: round), or click corners and then the first one again · right-click ground: take it away';
    }
    if (this.shaping) {
      return this.touchMode
        ? 'Drag out a box, or tap corner points and tap the first one again to finish'
        : 'Drag out a box (Shift: round), or click corners and then the first one again · Alt: snap';
    }
    if (!this.grab && !this.touchMode && this.handleAt(this.sx, this.sy)) return 'Drag to resize · Shift: keep proportions · Alt: snap';
    if (!this.grab && !this.touchMode && this.groupHandleAt(this.sx, this.sy)) return 'Drag to resize all of these together';
    if (!this.grab && !this.touchMode && this.spinHandleAt(this.sx, this.sy)) return `Drag to turn · Alt: ${this.arrange.settings.angle}° steps`;
    if (this.cycle) {
      const p = this.cycle.parts[this.cycle.i];
      return `${this.cycle.i + 1} of ${this.cycle.parts.length}: ${p.entity.parts.length > 1 ? `${p.name} (${p.entity.label})` : p.entity.label} · Alt+click: the next`;
    }
    if (this.connect.hoverConn && !this.touchMode) return this.connect.label;
    const t = this.toolKind;
    if (t === 'remove') return this.connect.label || `${click} a connection to remove it · Shift+${click.toLowerCase()} an object: all of its · drag a box across several`;
    if (t === 'spring') {
      const key = this.bindings.label(`tool${toolSlot('spring') + 1}` as ActionId);
      const name = (k: number) => SPRING_STIFFNESS[stiffnessStep(k)].name.toLowerCase();
      const over = this.touchMode ? null : this.connect.springUnder();
      if (over) return `This spring: ${name(over.stiffness ?? 1)}${key ? ` · ${key}: next stiffness` : ''} · right-click: choose`;
      return `Drag from one object to another to create a spring (${name(this.springStiffness)})${key ? ` · ${key} again: change stiffness` : ''}`;
    }
    if (t === 'fuse') return `Drag from one object to another to lay a fuse cord · ${click} a fuse to light it`;
    if (t === 'pin' || t === 'hinge') return `${click} an object to pin it to what’s behind (or the background) · drag from one to another: a hinge`;
    if (t) return `Drag from one object to another to create a ${t === 'weld' ? 'fixed connection' : CONN_LABEL[t].toLowerCase()}`;
    switch (this.powerKind) {
      case 'push': return `${hold} to push things away`;
      case 'pull': return `${hold} to pull things in`;
      case 'lift': return `${hold} to lift things up to the cursor`;
      case 'lightning': return `${hold} and flick ${this.touchMode ? 'it' : 'the mouse'} to throw lightning`;
      case 'pyro': return `${hold} to set things alight; flick ${this.touchMode ? 'it' : 'the mouse'} to throw flame`;
    }
    if (this.armed && !this.hover) {
      if (this.touchMode) return `Tap empty space to ${this.arrange.settings.tapSpawn ? 'spawn' : 'place'} ${this.armed.name} · long press to stop`;
      const l = this.bindings.label('spawnLeft');
      const rt = this.bindings.label('spawnRight');
      const z = this.bindings.label('freeze');
      const f = this.bindings.label('activate');
      const with_ = `${z ? ` · hold ${z}: frozen` : ''}${f ? ` · hold ${f}: activated` : ''}`;
      const g = this.bindings.label('slowmo');
      const grid = ` · Shift: on the grid${g ? ` (Shift+${g}: its size)` : ''}`;
      if (this.placement === 'click') {
        const r = this.bindings.label('flip');
        return `Click: place ${this.armed.name}${l && rt ? ` · ${l} / ${rt}: turn it` : ''}${r ? ` · ${r}: mirror it` : ''}${grid}${with_}`;
      }
      if (l || rt) return `Hold ${[rt, l].filter(Boolean).join(' / ')} and let go: spawn ${this.armed.name}${rt && l ? ' (facing right / left)' : ''}${grid}${with_}`;
    }
    // vehicles selected (and nothing else pointed at): how to drive them, and lay a tank's gun
    const cars = this.touchMode || !this.selection.size ? [] : this.vehicles();
    const drive = [this.bindings.label('driveLeft'), this.bindings.label('driveRight')].filter(Boolean).join(' ');
    if (cars.length && drive && (!this.hover || cars.includes(this.hover.entity as Car))) {
      const aim = [this.bindings.label('aimUp'), this.bindings.label('aimDown')].filter(Boolean).join(' ');
      const gun = aim && cars.some((c) => c instanceof Tank) ? ` · ${aim}: raise / lower the gun` : '';
      return `${drive}: drive ${cars.length > 1 ? 'the selected vehicles' : `the ${cars[0].label}`}${gun}`;
    }
    // building: what's selected
    if (this.game.paused && this.selection.size && !this.hover) return this.selectionChip();
    return '';
  }
}

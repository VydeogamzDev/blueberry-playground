import { PX } from '../engine/constants';
import { clamp, type V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import { SIZE_LIMITS, type ContextAction } from '../world/types';
import { capture, instantiate, mirror } from '../world/Snapshot';
import { attachPointsOf } from '../catalog/attach';
import { alignMove, boxOf, partBox, type Box, type Guide } from './Guides';
import { pixelLocal } from './AnchorSnap';
import type { Controls, Grab } from './Controls';
import { store } from '../engine/Store';

/** Snapping (hold Alt while moving things with time paused): the grid's sizes (m) and the angle's steps (degrees) to choose from. */
export const GRID_SIZES = [PX, 0.05, 0.1, 0.25, 0.5, 1];
export const ANGLE_STEPS = [1, 5, 15, 22.5, 45, 90];

/** The building settings (Settings › Building), kept in the browser. */
export interface BuildSettings {
  /** The grid things snap to (m). */
  grid: number;
  /** The steps angles snap to (degrees). */
  angle: number;
  /** Snap while moving: with Alt held (People Playground's way), or always (Alt turns it off). */
  snapMode: 'alt' | 'always';
  /** Connection ends snap to points worth joining at (see AnchorSnap). */
  anchors: boolean;
  /** A tap on empty space on a touch screen spawns at once, rather than showing where it will go first. */
  tapSpawn: boolean;
  /** The grid isn't drawn round what's being placed with Shift (it still snaps to it). */
  gridHidden: boolean;
}

const STORE = 'blueberry-building';
const DEFAULTS: BuildSettings = { grid: 0.1, angle: 15, snapMode: 'alt', anchors: true, tapSpawn: false, gridHidden: false };

export function loadBuildSettings(): BuildSettings {
  try {
    const s = JSON.parse(store.getItem(STORE) ?? '{}') as Partial<BuildSettings>;
    return {
      grid: GRID_SIZES.includes(Number(s.grid)) ? Number(s.grid) : DEFAULTS.grid,
      angle: ANGLE_STEPS.includes(Number(s.angle)) ? Number(s.angle) : DEFAULTS.angle,
      snapMode: s.snapMode === 'always' ? 'always' : 'alt',
      anchors: s.anchors !== false,
      tapSpawn: s.tapSpawn === true,
      gridHidden: s.gridHidden === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveBuildSettings(s: BuildSettings): void {
  try {
    store.setItem(STORE, JSON.stringify(s));
  } catch {
    /* not kept: fine for this visit */
  }
}

/** How a paused drag snaps (see dragPaused()). */
export interface DragSnap {
  /** To the grid (the reference point) and the angle steps. */
  grid: boolean;
  gridSize: number;
  /** Radians. */
  angleStep: number;
  /** Edges and middles line up with neighbours' (see Guides). */
  guides: boolean;
  /** Screen pixels a metre (for how near lines up). */
  zoom: number;
}

const SNAP_GRID = 0.1;
const SNAP_ANGLE = Math.PI / 12;

/**
 * The point of what's moved that keeps to the grid: one part's middle; several
 * things', the corner of the box round them nearest the cursor.
 */
function refPoint(list: Entity[], g: Grab, cursor: V2): V2 {
  const parts = list.flatMap((e) => e.parts.filter((p) => !p.destroyed));
  if (parts.length === 1) return { x: parts[0].x, y: parts[0].y };
  const b = boxOf(list);
  if (!b) return g.part.localToWorld(g.local.x, g.local.y);
  return { x: Math.abs(cursor.x - b.x0) < Math.abs(cursor.x - b.x1) ? b.x0 : b.x1, y: Math.abs(cursor.y - b.y0) < Math.abs(cursor.y - b.y1) ? b.y0 : b.y1 };
}

/**
 * Dragging with time paused: what's held (and the rest of `list` with it) goes
 * straight to `t`, and `rot` turns it about the held point. Snapping puts the
 * reference point on the grid and the turn in whole steps (`snap`: true for the
 * usual grid); with guides on, its edges and middle line up with neighbours'
 * nearby. `moved` is called the first time it moves (for undo). Returns the
 * guide lines to draw.
 */
export function dragPaused(g: Grab, list: Entity[], t: V2, rot: number, snap: boolean | DragSnap, dt: number, moved: () => void): Guide[] {
  const o: DragSnap = typeof snap === 'boolean' ? { grid: snap, gridSize: SNAP_GRID, angleStep: SNAP_ANGLE, guides: false, zoom: 0 } : snap;
  const at = g.part.localToWorld(g.local.x, g.local.y);
  let dx = t.x - at.x;
  let dy = t.y - at.y;
  let guides: Guide[] = [];
  if (o.grid) {
    const ref = refPoint(list, g, t);
    dx = Math.round((ref.x + dx) / o.gridSize) * o.gridSize - ref.x;
    dy = Math.round((ref.y + dy) / o.gridSize) * o.gridSize - ref.y;
  } else if (o.guides && o.zoom > 0) {
    const box = boxOf(list);
    if (box) {
      const game = g.part.entity.game;
      const r = alignMove(game, new Set(list), { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy }, o.zoom);
      dx += r.dx;
      dy += r.dy;
      guides = r.guides;
    }
  }
  g.turn += rot * 1.5 * dt;
  let turn = g.turn;
  if (o.grid) {
    const a = g.part.body.rotation();
    turn = Math.round((a + g.turn) / o.angleStep) * o.angleStep - a;
  }
  const moves = Math.abs(dx) + Math.abs(dy) > 1e-5;
  const turns = Math.abs(turn) > 1e-5;
  if (!moves && !turns) return guides;
  if (!g.moved) {
    g.moved = true;
    moved();
  }
  if (moves) for (const e of list) e.translate(dx, dy);
  const hx = at.x + dx;
  const hy = at.y + dy;
  if (turns) {
    for (const e of list) e.rotateAbout(hx, hy, turn);
    g.turn -= turn;
  }
  // the hand is where the held point is, so time starting again doesn't yank it away
  g.at = { x: hx, y: hy };
  g.anchor?.setTranslation(g.at, true);
  for (const a of g.along ?? []) {
    if (a.part.destroyed) continue;
    a.at = { x: a.part.x, y: a.part.y };
    a.off = { x: a.at.x - hx, y: a.at.y - hy };
    a.anchor?.setTranslation(a.at, true);
  }
  return guides;
}

/** Where a thing's mount is (a motor wheel's hub, a motor's housing): the part to fix it by, if it has one. */
export function mountPart(e: Entity): Part | null {
  for (const p of e.parts) {
    if (p.destroyed) continue;
    if (attachPointsOf(p).some((a) => a.role === 'mount')) return p;
  }
  return null;
}

/** The point of a thing's mount (world), on its mount part. */
function mountPoint(p: Part): V2 {
  const a = attachPointsOf(p).find((x) => x.role === 'mount');
  if (!a) return { x: p.x, y: p.y };
  const l = pixelLocal(p, a.x, a.y);
  return p.localToWorld(l.x, l.y);
}

/** One of several ways to line things up (the Arrange menu). */
export type ArrangeHow = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom' | 'spreadX' | 'spreadY' | 'stack';
export const ARRANGE: [ArrangeHow, string][] = [
  ['left', 'Align left'], ['centre', 'Align centres'], ['right', 'Align right'],
  ['top', 'Align tops'], ['middle', 'Align middles'], ['bottom', 'Align bottoms'],
  ['spreadX', 'Distribute across'], ['spreadY', 'Distribute up'], ['stack', 'Stack (each on the one below)'],
];

/** Which way to move something among the others drawn over it (its menu's Bring to front...). */
export type LayerDir = 'front' | 'back' | 'up' | 'down';

/** The multi-select resize: a corner handle on the box round several things scales them all. */
interface GroupResize {
  list: Entity[];
  box: Box;
  /** The handle's corner (world), and how much bigger it is now. */
  hx: number;
  hy: number;
  k: number;
}

/** Two parts pushed into each other while building: they'd fly apart as time runs. */
export interface Overlap {
  a: Part;
  b: Part;
}

/**
 * Arranging things while building: moving them as assemblies with time paused
 * (and the joints to what stays re-made where they end up), turning and
 * nudging them, setting their angle, their depth, lining several up, mirrored
 * copies, resizing several at once, welding together by their mounts, and
 * warning of parts pushed into each other.
 */
export class Arrange {
  readonly settings: BuildSettings = loadBuildSettings();
  /** The guide lines of the drag in progress (see EditOverlay). */
  guides: Guide[] = [];
  /** A multi-select resize in progress. */
  group: GroupResize | null = null;
  /** Parts pushed into each other by the last moves (tinted red while time is paused). */
  overlaps: Overlap[] = [];
  /** The things a double-click selected last (a second one widens the selection through wires). */
  private lastAssembly: Set<Entity> | null = null;
  /** Rigid units: the parts welded together, by part (see rigidUnits()). */
  private units = new Map<Part, number>();
  private unitsAt = -1;

  constructor(private c: Controls) {}

  private get game(): Game {
    return this.c.game;
  }

  saveSettings(): void {
    saveBuildSettings(this.settings);
  }

  /** Colliders where their bodies are now (moved by hand with time paused, they lag until the next step). */
  private fresh(): void {
    this.game.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /** How a paused drag snaps now (Alt, the settings, Ctrl+Alt for nothing at all). */
  dragSnap(): DragSnap {
    const c = this.c;
    const alt = c.isHeld('snap');
    const none = (alt && c.ctrlDown) || !c.snapping;
    const grid = !none && (this.settings.snapMode === 'always' ? !alt : alt);
    return { grid, gridSize: this.settings.grid, angleStep: (this.settings.angle * Math.PI) / 180, guides: !none && !grid, zoom: this.game.renderer.zoom };
  }

  /** The angle step, in radians. */
  get angleStep(): number {
    return (this.settings.angle * Math.PI) / 180;
  }

  /** Steps the grid's size (`dir` 1: the next bigger, round to the smallest). */
  cycleGrid(): void {
    const i = GRID_SIZES.indexOf(this.settings.grid);
    this.settings.grid = GRID_SIZES[(i + 1) % GRID_SIZES.length];
    this.saveSettings();
    this.c.ui.toast(`Grid: ${this.settings.grid === PX ? '1 px' : `${this.settings.grid} m`}`);
  }

  /**
   * G while placing (Shift held, or Q/E): the grid's next size and, after the
   * biggest, hidden (Shift still snaps to it), then the smallest again.
   */
  cyclePlacingGrid(): void {
    const s = this.settings;
    const i = GRID_SIZES.indexOf(s.grid);
    if (s.gridHidden) {
      s.gridHidden = false;
      s.grid = GRID_SIZES[0];
    } else if (i === GRID_SIZES.length - 1) s.gridHidden = true;
    else s.grid = GRID_SIZES[i + 1];
    this.saveSettings();
    this.c.ui.toast(s.gridHidden ? `Grid hidden (Shift still snaps to ${s.grid} m)` : `Grid: ${s.grid === PX ? '1 px' : `${s.grid} m`}`);
  }

  cycleAngle(): void {
    const i = ANGLE_STEPS.indexOf(this.settings.angle);
    this.settings.angle = ANGLE_STEPS[(i + 1) % ANGLE_STEPS.length];
    this.saveSettings();
    this.c.ui.toast(`Angle step: ${this.settings.angle}°`);
  }

  // ---- what moves together -----------------------------------------------------------

  /**
   * What moving these moves with time paused: the assemblies they're part of
   * (everything welded, hinged, roped... to them: see Connections.assemblyOf()),
   * or with `alone` just them (and what they hold).
   */
  moving(list: Entity[], alone: boolean): Entity[] {
    if (alone) {
      const out = new Set(list.filter((e) => !e.destroyed));
      for (const e of [...out]) for (const a of e.attachedEntities()) out.add(a);
      return [...out];
    }
    return this.game.connections.assemblyOf(list);
  }

  /**
   * Things were moved by hand with time paused: their welds, hinges and pins to
   * what stayed (or the background) are made again where they are now, and
   * parts pushed into others are flagged.
   */
  settle(moved: Entity[]): void {
    if (!moved.length || !this.game.paused) return;
    this.game.connections.rebaseFor(moved);
    this.checkOverlaps(moved);
  }

  /** Double-click: the whole assembly of what's under the cursor; again on it, everything wired to it too. */
  selectAssembly(e: Entity): void {
    const c = this.c;
    const physical = this.game.connections.assemblyOf([e]);
    const widen = !!this.lastAssembly && this.lastAssembly.has(e) && physical.every((x) => this.lastAssembly!.has(x)) && this.lastAssembly.size === c.selection.size;
    const list = widen ? this.game.connections.assemblyOf([e], false) : physical;
    c.selection = new Set(list);
    c.refreshOutlines();
    this.lastAssembly = new Set(list);
    if (list.length > 1) c.ui.toast(`${widen ? 'With what’s wired to it: ' : 'Assembly: '}${list.length} objects`);
  }

  // ---- turning, nudging, angles ---------------------------------------------------------

  /** Turns things about their middle (A/D with nothing held); with time paused, their assemblies, joints re-made after. */
  rotate(list: Entity[], angle: number): void {
    const c = this.c;
    if (!list.length) return;
    if (c.net) return c.net.send({ op: 'rotate', ids: c.net.ids(list), angle });
    c.history.record('Rotate', { coalesce: 'rotate' });
    const paused = this.game.paused;
    const all = paused ? this.moving(list, false) : list;
    const mid = centreOf(list);
    for (const e of all) e.rotateAbout(mid.x, mid.y, angle);
    if (paused) this.settle(all);
  }

  /** Moves things a little (Alt+arrows with time paused: a sprite pixel, Shift: 8), assemblies and all. */
  nudge(list: Entity[], dx: number, dy: number): void {
    const c = this.c;
    if (!list.length || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (c.net) return c.net.send({ op: 'nudge', ids: c.net.ids(list), dx, dy });
    c.history.record('Nudge', { coalesce: 'nudge' });
    const all = this.moving(list, false);
    for (const e of all) e.translate(dx, dy);
    this.settle(all);
  }

  /** A thing's angle (degrees, -180..180): its first part's. */
  angleOf(e: Entity): number {
    const p = e.parts.find((q) => !q.destroyed);
    if (!p) return 0;
    const a = (p.body.rotation() * 180) / Math.PI;
    return ((((a + 180) % 360) + 360) % 360) - 180;
  }

  /** Sets things' angles (degrees): each assembly turns about its own middle. */
  setAngle(list: Entity[], deg: number): void {
    const c = this.c;
    if (!list.length || !Number.isFinite(deg)) return;
    if (c.net) return c.net.send({ op: 'setAngle', ids: c.net.ids(list), angle: deg });
    c.history.record('Set angle', { coalesce: 'angle' });
    const done = new Set<Entity>();
    const all: Entity[] = [];
    for (const e of list) {
      if (e.destroyed || done.has(e)) continue;
      const unit = this.game.paused ? this.moving([e], false) : [e];
      for (const x of unit) done.add(x);
      let turn = ((deg - this.angleOf(e)) * Math.PI) / 180;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const mid = centreOf(unit);
      for (const x of unit) x.rotateAbout(mid.x, mid.y, turn);
      all.push(...unit);
    }
    if (this.game.paused) this.settle(all);
  }

  /** The Set angle… panel: a slider, and buttons for the right angles and Level. */
  openSetAngle(list: Entity[]): void {
    const c = this.c;
    const first = list.find((e) => !e.destroyed);
    if (!first) return;
    const set = (v: number) => this.setAngle(list.filter((e) => !e.destroyed), v);
    c.ui.editValues({
      label: 'Set angle…',
      title: list.length > 1 ? `Angle of ${list.length} objects` : `Angle of the ${first.label}`,
      fields: [{ key: 'angle', label: 'Angle', unit: '°', min: -180, max: 180, step: 1, get: () => Math.round(this.angleOf(first)), set }],
      reset: () => set(0),
      buttons: [['Level', () => set(0)], ['90°', () => set(90)], ['180°', () => set(180)], ['−90°', () => set(-90)]],
      alive: () => !first.destroyed,
    });
  }

  // ---- depth -------------------------------------------------------------------------------

  /** Brings things in front of the others (or behind them, or one past the next one over or under them). */
  layer(list: Entity[], dir: LayerDir): void {
    const c = this.c;
    list = list.filter((e) => !e.destroyed);
    if (!list.length) return;
    if (c.net) return c.net.send({ op: 'layer', ids: c.net.ids(list), dir });
    const others = this.game.entities.filter((e) => !e.destroyed && !list.includes(e));
    const zs = others.map((e) => e.zBase);
    const top = zs.length ? Math.max(...zs) : 0;
    const bottom = zs.length ? Math.min(...zs) : 0;
    const order = [...list].sort((a, b) => a.zBase - b.zBase);
    c.history.record({ front: 'Bring to front', back: 'Send to back', up: 'Forward one', down: 'Back one' }[dir]);
    if (dir === 'front' || dir === 'back') {
      // (kept in order among themselves; depths stay within what the drawing allows, 0..29)
      order.forEach((e, i) => e.setDepth(dir === 'front' ? Math.min(29, top + 0.02 * (i + 1)) : Math.max(-0.9, bottom - 0.02 * (order.length - i))));
      return;
    }
    // one past the nearest thing overlapping them in front (or behind)
    const box = boxOf(list);
    const over = others.filter((e) => {
      const b = boxOf([e]);
      return !!b && !!box && b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0;
    });
    const zNow = dir === 'up' ? Math.max(...list.map((e) => e.zBase)) : Math.min(...list.map((e) => e.zBase));
    const next = dir === 'up' ? over.filter((e) => e.zBase >= zNow).sort((a, b) => a.zBase - b.zBase)[0] : over.filter((e) => e.zBase <= zNow).sort((a, b) => b.zBase - a.zBase)[0];
    if (!next) {
      c.ui.toast(dir === 'up' ? 'Nothing over it to come in front of' : 'Nothing under it to go behind');
      return;
    }
    order.forEach((e, i) => e.setDepth(dir === 'up' ? Math.min(29, next.zBase + 0.005 * (i + 1)) : Math.max(-0.9, next.zBase - 0.005 * (order.length - i))));
  }

  // ---- lining up -------------------------------------------------------------------------

  /** Lines several things (each with its assembly) up, spreads them evenly, or stacks them. */
  arrange(list: Entity[], how: ArrangeHow): void {
    const c = this.c;
    list = list.filter((e) => !e.destroyed);
    if (list.length < 2) return;
    if (c.net) return c.net.send({ op: 'arrange', ids: c.net.ids(list), how });
    // the units that move: each thing's assembly, once
    const units: { ents: Entity[]; box: Box }[] = [];
    const seen = new Set<Entity>();
    for (const e of list) {
      if (seen.has(e)) continue;
      const ents = this.game.paused ? this.moving([e], false) : [e];
      for (const x of ents) seen.add(x);
      const box = boxOf(ents);
      if (box) units.push({ ents, box });
    }
    if (units.length < 2) {
      c.ui.toast('These are all one assembly: nothing to line up');
      return;
    }
    c.history.record(ARRANGE.find(([h]) => h === how)![1]);
    const all = units.reduce<Box>((b, u) => ({ x0: Math.min(b.x0, u.box.x0), y0: Math.min(b.y0, u.box.y0), x1: Math.max(b.x1, u.box.x1), y1: Math.max(b.y1, u.box.y1) }), { ...units[0].box });
    const move = (u: { ents: Entity[]; box: Box }, dx: number, dy: number) => {
      for (const e of u.ents) e.translate(dx, dy);
      u.box = { x0: u.box.x0 + dx, y0: u.box.y0 + dy, x1: u.box.x1 + dx, y1: u.box.y1 + dy };
    };
    const mid = (a: number, b: number) => (a + b) / 2;
    switch (how) {
      case 'left': for (const u of units) move(u, all.x0 - u.box.x0, 0); break;
      case 'right': for (const u of units) move(u, all.x1 - u.box.x1, 0); break;
      case 'centre': for (const u of units) move(u, mid(all.x0, all.x1) - mid(u.box.x0, u.box.x1), 0); break;
      case 'bottom': for (const u of units) move(u, 0, all.y0 - u.box.y0); break;
      case 'top': for (const u of units) move(u, 0, all.y1 - u.box.y1); break;
      case 'middle': for (const u of units) move(u, 0, mid(all.y0, all.y1) - mid(u.box.y0, u.box.y1)); break;
      case 'spreadX':
      case 'spreadY': {
        const x = how === 'spreadX';
        const lo = (b: Box) => (x ? b.x0 : b.y0);
        const hi = (b: Box) => (x ? b.x1 : b.y1);
        units.sort((a, b) => lo(a.box) + hi(a.box) - lo(b.box) - hi(b.box));
        const used = units.reduce((s, u) => s + hi(u.box) - lo(u.box), 0);
        const gap = (hi(all) - lo(all) - used) / (units.length - 1);
        let at = lo(all);
        for (const u of units) {
          const d = at - lo(u.box);
          move(u, x ? d : 0, x ? 0 : d);
          at = hi(u.box) + gap;
        }
        break;
      }
      case 'stack': {
        // each on top of the one below it, lined up on its middle
        units.sort((a, b) => a.box.y0 - b.box.y0);
        for (let i = 1; i < units.length; i++) {
          const below = units[i - 1].box;
          const u = units[i];
          move(u, mid(below.x0, below.x1) - mid(u.box.x0, u.box.x1), below.y1 - u.box.y0);
        }
        break;
      }
    }
    if (this.game.paused) this.settle(units.flatMap((u) => u.ents));
  }

  /** The Arrange menu, for several selected. */
  arrangeActions(list: Entity[]): ContextAction[] {
    return ARRANGE.map(([how, label]) => ({ label, action: () => this.arrange(list, how) }));
  }

  /**
   * A mirrored copy of these, put right beside them (flush against their right
   * side): the other half of something symmetrical, a wing or a leg.
   */
  duplicateMirrored(list: Entity[]): void {
    const c = this.c;
    const ents = this.moving(list, true);
    const box = boxOf(ents);
    if (!box) return;
    const snap = mirror(capture(this.game, ents), box.x1);
    if (c.net) return c.net.send({ op: 'place', snap, dx: 0, dy: 0, label: 'Duplicate mirrored' });
    c.history.record('Duplicate mirrored');
    const made = instantiate(this.game, snap);
    c.created(made);
    c.selection = new Set(made);
    c.refreshOutlines();
  }

  // ---- resizing several at once -------------------------------------------------------------

  /** The handle for resizing several things together: the top right corner of the box round them (screen). */
  groupHandle(): { x: number; y: number } | null {
    const c = this.c;
    if (this.group) return this.game.renderer.worldToScreen(this.group.hx, this.group.hy);
    if (c.selection.size < 2 || c.tab !== 'tools' || c.tool !== 'drag' || c.grab) return null;
    const list = [...c.selection].filter((e) => !e.destroyed);
    if (!list.some((e) => e.def.resizable && e.parts.length === 1)) return null;
    const b = boxOf(list);
    return b ? this.game.renderer.worldToScreen(b.x1, b.y1) : null;
  }

  startGroupResize(): void {
    const c = this.c;
    const list = [...c.selection].filter((e) => !e.destroyed);
    const box = boxOf(list);
    if (!box) return;
    this.group = { list, box, hx: box.x1, hy: box.y1, k: 1 };
  }

  /** The handle dragged: how much bigger (or smaller) about the box's middle. */
  updateGroupResize(): void {
    const g = this.group!;
    const c = this.c;
    const mx = (g.box.x0 + g.box.x1) / 2;
    const my = (g.box.y0 + g.box.y1) / 2;
    const d0 = Math.hypot(g.box.x1 - mx, g.box.y1 - my) || 1;
    let k = clamp(Math.hypot(c.wx - mx, c.wy - my) / d0, 0.2, 5);
    if (c.isHeld('snap')) k = Math.round(k * 4) / 4 || 0.25;
    g.k = k;
    g.hx = mx + (g.box.x1 - mx) * k;
    g.hy = my + (g.box.y1 - my) * k;
  }

  /** The outline it will have (world corners). */
  groupPreview(): V2[] | null {
    const g = this.group;
    if (!g) return null;
    const mx = (g.box.x0 + g.box.x1) / 2;
    const my = (g.box.y0 + g.box.y1) / 2;
    const s = (x: number, y: number) => ({ x: mx + (x - mx) * g.k, y: my + (y - my) * g.k });
    return [s(g.box.x0, g.box.y0), s(g.box.x1, g.box.y0), s(g.box.x1, g.box.y1), s(g.box.x0, g.box.y1)];
  }

  /**
   * Let go: each resizable thing is made again that much bigger, and moved
   * that much further from the middle; the rest only move.
   */
  applyGroupResize(): void {
    const g = this.group;
    this.group = null;
    const c = this.c;
    if (!g || Math.abs(g.k - 1) < 0.01) return;
    const list = g.list.filter((e) => !e.destroyed);
    const mx = (g.box.x0 + g.box.x1) / 2;
    const my = (g.box.y0 + g.box.y1) / 2;
    if (!c.net) c.history.record('Resize');
    let resized = 0;
    const made: Entity[] = [];
    for (const e of list) {
      const ctr = e.center();
      const to = { x: mx + (ctr.x - mx) * g.k, y: my + (ctr.y - my) * g.k };
      if (e.def.resizable && e.parts.length === 1) {
        const p = e.parts[0];
        const w = clamp(Math.round(p.w * g.k), SIZE_LIMITS.min, SIZE_LIMITS.max);
        const h = clamp(Math.round(p.h * g.k), SIZE_LIMITS.min, SIZE_LIMITS.max);
        const at = { x: p.x + to.x - ctr.x, y: p.y + to.y - ctr.y };
        if (c.net) {
          c.net.send({ op: 'rebuild', id: e.netId, config: { ...(e.config ?? {}), w, h }, at });
          resized++;
          continue;
        }
        const r = this.game.rebuildEntity(e, { ...(e.config ?? {}), w, h }, at);
        if (r) {
          c.replaced(e, r);
          made.push(r);
          resized++;
        }
      } else if (!c.net) {
        e.translate(to.x - ctr.x, to.y - ctr.y);
        made.push(e);
      }
    }
    if (!c.net) {
      c.selection = new Set(made);
      c.refreshOutlines();
      this.settle(made);
    }
    c.ui.toast(resized === list.length ? `Resized ${resized} objects` : `${resized} of ${list.length} resized (the rest can’t be: moved only)`);
  }

  // ---- welding together ---------------------------------------------------------------------

  /**
   * Welds together every two of these things that touch or overlap (each pair
   * once, where they meet), so they move as one. A thing with a mount (a motor
   * wheel's hub, a motor's housing) is welded by it, so what turns still turns.
   * Returns how many welds it made. With `only`, just the pairs with one of
   * those in them (something just placed, welded to what it's touching).
   */
  weldTogether(list: Entity[], only?: Set<Entity>): number {
    const c = this.c;
    if (c.net) {
      c.net.send({ op: 'weld', ids: c.net.ids(list) });
      return 0;
    }
    const C = this.game.connections;
    this.fresh();
    const parts = list.flatMap((e) => e.parts.filter((p) => !p.destroyed));
    const joined = (a: Part, b: Part) => C.list.some((k) => k.kind === 'weld' && ((k.a === a && k.b === b) || (k.a === b && k.b === a)));
    const pairs: [Part, Part, V2][] = [];
    const paired = (a: Entity, b: Entity) => pairs.some(([p, q]) => (p.entity === a && q.entity === b) || (p.entity === b && q.entity === a));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        let a = parts[i];
        let b = parts[j];
        if (a.entity === b.entity || paired(a.entity, b.entity)) continue;
        if (only && !only.has(a.entity) && !only.has(b.entity)) continue;
        let at: V2 | null = null;
        for (const ca of a.colliders) {
          for (const cb of b.colliders) {
            if (!ca.contactCollider(cb, 0.04)) continue;
            // where they meet: the point of each nearest the other, halfway
            const pa = ca.projectPoint(cb.translation(), true)?.point;
            const pb = pa ? cb.projectPoint(pa, true)?.point : null;
            if (pa && pb) at = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
            break;
          }
          if (at) break;
        }
        if (!at) continue;
        // by their mounts, where they have them (the weld holds at the mount: the rest still turns)
        const ma = mountPart(a.entity);
        const mb = mountPart(b.entity);
        if (ma && ma !== a) {
          a = ma;
          at = mountPoint(ma);
        }
        if (mb && mb !== b) {
          b = mb;
          if (!ma) at = mountPoint(mb);
        }
        if (joined(a, b)) continue;
        pairs.push([a, b, at]);
      }
    }
    if (!pairs.length) {
      if (!only) c.ui.toast('None of these touch each other: put them together first');
      return 0;
    }
    c.history.record('Weld together');
    for (const [a, b, at] of pairs) C.create('weld', a, at, b, at);
    this.game.sound.place(pairs[0][2].x, 'metal');
    c.ui.toast(`Welded together (${pairs.length} weld${pairs.length > 1 ? 's' : ''})`);
    this.overlaps = this.overlaps.filter((o) => !list.includes(o.a.entity) || !list.includes(o.b.entity));
    return pairs.length;
  }

  // ---- parts pushed into each other -----------------------------------------------------------

  /**
   * The rigid units: parts of things (not people or animals) welded together,
   * directly or through each other, numbered (see ContactGroups, which keeps a
   * unit's parts from colliding with each other, and the overlap warnings).
   */
  rigidUnits(): Map<Part, number> {
    const C = this.game.connections;
    if (this.unitsAt === C.version) return this.units;
    this.unitsAt = C.version;
    this.units = rigidUnitsOf(this.game);
    return this.units;
  }

  /**
   * Parts of these pushed more than a sprite pixel into parts of other things
   * (not welded into one with them, nor set not to collide with them): they'd
   * fly apart as time runs, so they're flagged.
   */
  checkOverlaps(moved: Entity[]): void {
    this.fresh();
    const units = this.rigidUnits();
    const set = new Set(moved);
    const out: Overlap[] = this.overlaps.filter((o) => !set.has(o.a.entity) && !set.has(o.b.entity) && this.stillOverlap(o));
    const mine = moved.flatMap((e) => e.parts.filter((p) => !p.destroyed && !p.noCollideAll && !p.onlyStatic));
    if (mine.length > 400) {
      this.overlaps = out;
      return;
    }
    const others = this.game.entities.flatMap((e) => (e.destroyed ? [] : e.parts.filter((p) => !p.destroyed && !p.noCollideAll && !p.onlyStatic)));
    for (const a of mine) {
      const ba = partBox(a);
      for (const b of others) {
        if (b.entity === a.entity || (set.has(b.entity) && b.entity.id < a.entity.id)) continue;
        if (a.noCollide?.has(b) || (units.get(a) !== undefined && units.get(a) === units.get(b))) continue;
        const bb = partBox(b);
        if (bb.x0 > ba.x1 || bb.x1 < ba.x0 || bb.y0 > ba.y1 || bb.y1 < ba.y0) continue;
        if (this.depth(a, b) > PX && !out.some((o) => (o.a === a && o.b === b) || (o.a === b && o.b === a))) out.push({ a, b });
      }
    }
    this.overlaps = out;
  }

  /** How far two parts are pushed into each other (m; 0: they aren't). */
  private depth(a: Part, b: Part): number {
    let most = 0;
    for (const ca of a.colliders) {
      for (const cb of b.colliders) {
        const k = ca.contactCollider(cb, 0);
        if (k && k.distance < 0) most = Math.max(most, -k.distance);
      }
    }
    return most;
  }

  private stillOverlap(o: Overlap): boolean {
    return !o.a.destroyed && !o.b.destroyed && this.depth(o.a, o.b) > PX;
  }

  /** The flagged overlaps still overlapping (checked again: things may have moved since). */
  liveOverlaps(): Overlap[] {
    if (!this.overlaps.length) return this.overlaps;
    this.fresh();
    this.overlaps = this.overlaps.filter((o) => this.stillOverlap(o));
    return this.overlaps;
  }

  /** Pushes the second of two overlapping parts' assemblies out of the first, the shortest way. */
  separate(o: Overlap): void {
    const c = this.c;
    this.fresh();
    const ca = o.a.colliders[0];
    const cb = o.b.colliders[0];
    const k = ca && cb ? ca.contactCollider(cb, 0) : null;
    if (!k) return;
    const n = k.normal1;
    const d = -k.distance + PX;
    const ids = [o.b.entity];
    if (c.net) return c.net.send({ op: 'nudge', ids: c.net.ids(ids), dx: n.x * d, dy: n.y * d });
    c.history.record('Separate');
    const all = this.moving(ids, false);
    for (const e of all) e.translate(n.x * d, n.y * d);
    this.settle(all);
  }

  /** A flagged part's menu entries: weld it to what it's pushed into, or push them apart. */
  overlapActions(e: Entity): ContextAction[] {
    const o = this.liveOverlaps().find((x) => x.a.entity === e || x.b.entity === e);
    if (!o) return [];
    const other = o.a.entity === e ? o.b.entity : o.a.entity;
    return [
      { label: `Weld to the ${other.label} it’s pushed into`, action: () => this.weldTogether([o.a.entity, o.b.entity]) },
      { label: 'Separate them', action: () => this.separate(o) },
    ];
  }
}

/** The middle of several things (the mean of their middles). */
export function centreOf(list: Entity[]): V2 {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const e of list) {
    if (e.destroyed) continue;
    const c = e.center();
    x += c.x;
    y += c.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/**
 * Parts of things that aren't alive, welded together directly or through each
 * other, numbered by unit (parts in no unit are left out).
 */
export function rigidUnitsOf(game: Game): Map<Part, number> {
  const parent = new Map<Part, Part>();
  const find = (p: Part): Part => {
    let r = p;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let q = p;
    while (parent.get(q) !== r) {
      const n = parent.get(q)!;
      parent.set(q, r);
      q = n;
    }
    return r;
  };
  const add = (p: Part) => {
    if (!parent.has(p)) parent.set(p, p);
  };
  const living = (p: Part) => p.entity.canWalk;
  /** The parts that go in with one of a thing's: all of them if they keep apart anyway (one self-collision group), else just it. */
  const withPart = (p: Part): Part[] => {
    const all = p.entity.parts.filter((q) => !q.destroyed);
    return p.group !== 0 && all.every((q) => q.group === p.group) ? all : [p];
  };
  for (const k of game.connections.list) {
    if (k.kind !== 'weld' || !k.b || !k.joint || k.opts?.collide) continue;
    if (k.a.destroyed || k.b.destroyed || living(k.a) || living(k.b)) continue;
    for (const end of [k.a, k.b]) {
      const ps = withPart(end);
      for (const p of ps) add(p);
      for (const p of ps) parent.set(find(p), find(end));
    }
    parent.set(find(k.a), find(k.b));
  }
  const ids = new Map<Part, number>();
  const out = new Map<Part, number>();
  for (const p of parent.keys()) {
    const r = find(p);
    if (!ids.has(r)) ids.set(r, ids.size + 1);
    out.set(p, ids.get(r)!);
  }
  return out;
}

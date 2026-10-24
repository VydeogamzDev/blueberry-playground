import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { ContextAction } from '../world/types';
import { RIGID_KINDS, SPRING_STIFFNESS, stiffnessStep, type ConnKind, type ConnOpts, type Connection } from '../systems/Connections';
import { ConnectionPreview, type ConnGhost } from '../systems/ConnectionPreview';
import { anchorLabel, candidates, snapAnchor, type Anchor, type SnapOpts } from './AnchorSnap';
import type { Controls } from './Controls';

/** What undo calls each connection tool's edit. */
export const CONN_LABEL: Record<ConnKind, string> = {
  rope: 'Rope', weld: 'Weld', spring: 'Spring', hinge: 'Hinge', pin: 'Pin', wire: 'Wire', fuse: 'Fuse cord',
};

/** Screen pixels the pointer may move between press and release and still be a click. */
const CLICK_SLOP = 4;
/** Screen pixels from a connection's line or knot within which the cursor is on it. */
const CONN_REACH = 4;
/** On a touch screen the anchor is this far (screen px) above the finger, so the finger doesn't hide it. */
export const RETICLE = 56;

/** A connection being made: its first end set, its second to come. */
interface Pending {
  kind: ConnKind;
  /** Its first end (on the background: a rope or spring from the wall). */
  a: Anchor;
  /** Where the button went down (screen), to tell a click from a drag. */
  sx: number;
  sy: number;
  /** The button is still down. */
  down: boolean;
  /** Click-click: the first end was clicked (or reached by a chain); the next click is the second. */
  waiting: boolean;
  /** A rope's or spring's length set with the wheel; null: the distance. */
  rest: number | null;
}

/** One end of a connection being dragged somewhere else (the Drag tool, time paused). */
interface KnotDrag {
  c: Connection;
  end: 'a' | 'b';
}

/** What the cursor is on: a connection's line, or one of its knots. */
export interface ConnHit {
  c: Connection;
  end: 'a' | 'b' | 'line';
}

/**
 * The connection tools (Rope, Fuse cord, Weld, Spring, Pin, Wire) and the Remove
 * tool, and editing connections already made (their menu, dragging their knots,
 * the wheel over a rope).
 *
 * Making one: the end snaps to a point worth joining at (see AnchorSnap); a ring
 * and a label say where before the button goes down. Press on A, drag to B (a
 * see-through ghost of the real thing follows, see ConnectionPreview), let go.
 * Let go over nothing, a weld, pin or wire is called off (Ctrl: fixed to the
 * background on purpose); a rope or spring is tied to the background. A click
 * welds or pins to whatever is behind (or the background), as People
 * Playground's pin does; with a rope, spring or wire it sets the first end and
 * the next click the second. Shift as the button comes up carries on from where
 * it ended (A→B→C). Ended on one of several things selected, it goes to each.
 */
export class ConnectTool {
  readonly preview: ConnectionPreview;
  pending: Pending | null = null;
  private knot: KnotDrag | null = null;
  /** The Remove tool's box, dragged out from here (world), cuts what crosses it. */
  cut: { x0: number; y0: number; sx: number; sy: number } | null = null;
  /** Where the end would go if pressed (or let go) now, and what it's on. */
  hover: Anchor | null = null;
  /** The connection the cursor is on (Drag, Remove and the connection tools). */
  hoverConn: ConnHit | null = null;
  /** The label by the cursor: what pressing or letting go would make. */
  label = '';
  /** The label is a warning (it's red). */
  labelBad = false;
  /** Where the anchors that would be made go, for the overlay's rings (the ends of every ghost). */
  ends: Anchor[] = [];

  constructor(private c: Controls) {
    this.preview = new ConnectionPreview(c.game);
  }

  /** Making a connection, moving one's end or cutting with a box. */
  get busy(): boolean {
    return !!(this.pending || this.knot || this.cut);
  }

  /** A knot being dragged (for the cursor hint). */
  get draggingKnot(): boolean {
    return !!this.knot;
  }

  cancel(): void {
    this.pending = null;
    this.knot = null;
    this.cut = null;
    this.preview.ghosts = [];
  }

  // ---- where ends go -------------------------------------------------------------

  /** The point the tool works at: the cursor; on a touch screen, a little above the finger. */
  point(): V2 {
    const c = this.c;
    if (!c.touchMode) return { x: c.wx, y: c.wy };
    return c.game.renderer.screenToWorld(c.sx, c.sy - RETICLE);
  }

  private opts(kind: ConnKind, exclude?: (p: Part) => boolean, skip?: Connection | null): SnapOpts {
    const c = this.c;
    // (Ctrl+Alt: nothing snaps)
    return {
      zoom: c.game.renderer.zoom, kind, touch: c.touchMode, free: c.isHeld('snap') || c.freeAnchor, com: c.isHeld('com'),
      snap: c.snapping && c.arrange.settings.anchors, exclude, skip, pickRadius: c.pickRadius(),
    };
  }

  /** The anchor under the tool's point for a connection of `kind`. */
  anchorAt(kind: ConnKind, exclude?: (p: Part) => boolean, skip?: Connection | null): Anchor {
    const p = this.point();
    return snapAnchor(this.c.game, p.x, p.y, this.opts(kind, exclude, skip));
  }

  /** The kind the tool in hand makes when dragged from one thing to another. */
  private dragKind(): ConnKind | null {
    const t = this.c.toolKind;
    if (!t || t === 'remove') return null;
    return t === 'pin' ? 'hinge' : t;
  }

  /** What a click with the Weld or Pin tool joins a part to: the part behind it there (not of its own), else the background. */
  private behind(a: Anchor): Part | null {
    if (!a.part) return null;
    const own = a.part.entity;
    return this.c.game.pick(a.world.x, a.world.y, 0, (p) => p.entity !== own);
  }

  /** The kind a click pins with: a hinge to the part behind; to the background, the Pin tool's pin (the Hinge tool's hinge). */
  private pinKind(behind: Part | null): ConnKind {
    return behind || this.c.tool === 'hinge' ? 'hinge' : 'pin';
  }

  // ---- pressing and letting go -----------------------------------------------------

  /** The button went down with a connection tool (not the Remove tool). */
  down(): void {
    const c = this.c;
    const kind = this.dragKind();
    if (!kind) return;
    const s = { x: c.sx, y: c.sy };
    const p = this.pending;
    if (p?.waiting) {
      // the second click of click-click (finished as it comes up)
      p.down = true;
      p.sx = s.x;
      p.sy = s.y;
      return;
    }
    const a = this.anchorAt(kind);
    if (!a.part) {
      const at = this.point();
      // (a click on a fuse cord lights it)
      if (c.toolKind === 'fuse' && this.lightAt(at.x, at.y, c.pickRadius() * 2 + 0.1)) return;
      if (kind !== 'rope' && kind !== 'spring' && kind !== 'fuse') {
        c.ui.toast(kind === 'wire' ? 'Start the wire on an object' : 'Start on an object');
        return;
      }
    }
    this.pending = { kind, a, sx: s.x, sy: s.y, down: true, waiting: false, rest: null };
  }

  /** The button came up: a connection made, a click's weld or pin, or click-click's first end set. */
  up(ctrl: boolean, shift: boolean): void {
    const c = this.c;
    const p = this.pending;
    if (!p || !p.down) return;
    p.down = false;
    if (p.a.part?.destroyed) {
      this.pending = null;
      return;
    }
    const click = !p.waiting && Math.hypot(c.sx - p.sx, c.sy - p.sy) < CLICK_SLOP;
    if (click) {
      if (c.toolKind === 'weld' || c.toolKind === 'pin' || c.toolKind === 'hinge') {
        this.pending = null;
        if (!p.a.part) return;
        const under = this.behind(p.a);
        const kind = c.toolKind === 'weld' ? 'weld' : this.pinKind(under);
        // (welded or pinned where it was clicked, to what's there)
        this.connect(kind, p.a, [{ part: under, local: under ? under.worldToLocal(p.a.world.x, p.a.world.y) : { ...p.a.world }, world: { ...p.a.world }, kind: under ? 'free' : 'background', name: '' }]);
        return;
      }
      // a click with the Fuse tool on a cord lights it; on a thing it starts a cord, as with the rope
      if (c.toolKind === 'fuse' && this.lightAt(p.a.world.x, p.a.world.y, c.pickRadius() * 2 + 0.1)) {
        this.pending = null;
        return;
      }
      // rope, spring, wire, fuse: the first end is set, the next click sets the second
      p.waiting = true;
      return;
    }
    this.finish(p, ctrl, shift);
  }

  /** The second end, where the tool's point is: made (to each selected thing, if it's on one of several). */
  private finish(p: Pending, ctrl: boolean, shift: boolean): void {
    const c = this.c;
    const plan = this.plan(p, ctrl);
    if (plan.why) {
      c.ui.toast(plan.why);
      // (a chain or click-click waits on for a better second end; a plain drag is over)
      if (!p.waiting) this.pending = null;
      return;
    }
    this.pending = null;
    if (!plan.targets.length) return;
    this.connect(p.kind, p.a, plan.targets, p.rest ?? undefined);
    // Shift as it was let go: on from where it ended (A→B→C)
    const last = plan.targets[0];
    if (shift && last.part && p.a.part) {
      this.pending = { kind: p.kind, a: last, sx: c.sx, sy: c.sy, down: false, waiting: true, rest: null };
    }
  }

  /**
   * Where a pending connection would go if let go now: its second ends (one per
   * selected thing, if it's on one of several), or why it can't go there.
   */
  plan(p: Pending, ctrl: boolean): { targets: Anchor[]; why?: string } {
    const c = this.c;
    const wire = p.kind === 'wire';
    const from = p.a.part;
    const exclude = (q: Part) => q === from || (wire && !!from && q.entity === from.entity);
    const b = this.anchorAt(p.kind, exclude);
    if (!b.part) {
      if (!from) return { targets: [], why: 'Both ends are on the background: end it on an object' };
      if (wire) {
        // (over another part of the same thing: say so)
        const own = this.anchorAt(p.kind, (q) => q === from).part;
        return { targets: [], why: own && own.entity === from.entity ? 'Wires must connect two different objects' : 'Wires must connect two objects' };
      }
      if (RIGID_KINDS.has(p.kind) && !ctrl) return { targets: [], why: 'Released over nothing: nothing made (hold Ctrl to fix it to the background)' };
      return { targets: [b] };
    }
    if (wire && from && b.part.entity === from.entity) return { targets: [], why: 'Wires must connect two different objects' };
    if (p.kind === 'weld' && from && this.welded(from, b.part)) return { targets: [], why: 'Already fixed together' };
    // onto one of several selected things: to each of them
    const ent = b.part.entity;
    const sel = c.selection;
    const out: Anchor[] = [b];
    if (from && sel.size > 1 && sel.has(ent)) {
      for (const e of sel) {
        if (e === ent || e.destroyed || e === from.entity) continue;
        const t = this.like(b, e, p.kind);
        if (t) out.push(t);
      }
    }
    return { targets: out };
  }

  /** Two parts already welded to each other. */
  private welded(a: Part, b: Part): boolean {
    return this.c.game.connections.list.some((k) => k.kind === 'weld' && ((k.a === a && k.b === b) || (k.a === b && k.b === a)));
  }

  /** The point on another thing like `b` (the attach point of the same name; else its middle), for connecting to several at once. */
  private like(b: Anchor, e: Entity, kind: ConnKind): Anchor | null {
    const parts = e.parts.filter((q) => !q.destroyed);
    if (!parts.length) return null;
    if (b.kind === 'attach') {
      for (const q of parts) {
        const m = candidates(q, kind).find((k) => k.kind === 'attach' && k.name === b.name);
        if (m) return { part: m.part, local: m.local, world: m.world, kind: 'attach', name: m.name, role: m.role };
      }
    }
    const main = parts.reduce((x, y) => (y.mass > x.mass ? y : x));
    // (its middle: where the centre of mass is, if that's where it is)
    const m = candidates(main, kind).find((k) => k.kind === 'centre' || k.kind === 'com');
    if (!m) return { part: main, local: { x: 0, y: 0 }, world: { x: main.x, y: main.y }, kind: 'centre', name: 'centre' };
    return { part: main, local: m.local, world: m.world, kind: m.kind, name: m.name };
  }

  /**
   * Makes connections of `kind` from `a` to each of `targets`, as one edit for
   * undo ("Wire ×4"), with its sound and a flash at the ends. A first end on the
   * background (a rope from the wall) is turned round: the first end is always on something.
   */
  connect(kind: ConnKind, a: Anchor, targets: Anchor[], rest?: number, opts?: ConnOpts): Connection[] {
    const c = this.c;
    const C = c.game.connections;
    const stiffness = kind === 'spring' ? c.springStiffness : undefined;
    const ends = targets.map((b) => (a.part ? { pa: a.part, wa: a.world, pb: b.part, wb: b.world } : { pa: b.part!, wa: b.world, pb: null, wb: a.world }));
    if (ends.some((e) => !e.pa)) return [];
    if (c.net) {
      const net = c.net;
      const [first, ...more] = ends;
      net.send({
        op: 'connect', kind, a: net.ref(first.pa), wa: first.wa, b: first.pb ? net.ref(first.pb) : null, wb: first.wb, stiffness, rest,
        ...(opts ? { opts } : {}),
        ...(more.length ? { more: more.map((e) => ({ b: e.pb ? net.ref(e.pb) : null, wb: e.wb })) } : {}),
      });
      return [];
    }
    c.history.record(ends.length > 1 ? `${CONN_LABEL[kind]} ×${ends.length}` : CONN_LABEL[kind]);
    const made: Connection[] = [];
    for (const e of ends) {
      // (several from one point: each its own length, unless one was set with the wheel)
      const k = C.create(kind, e.pa, e.wa, e.pb, e.wb, rest, undefined, stiffness, opts);
      if (k) made.push(k);
    }
    if (!made.length) return made;
    const at = made[0];
    c.game.sound.place(ends[0].wb.x, kind === 'rope' || kind === 'wire' || kind === 'fuse' ? 'wood' : 'metal');
    this.preview.flash(made.flatMap((k) => [C.endPoint(k, 'a'), C.endPoint(k, 'b')]));
    if (at.kind === 'wire') this.wiredSides(at);
    return made;
  }

  /**
   * Says which side of a gate or timer a wire was laid on (by where it was
   * clicked): a pulse into an output does nothing, so it had better be the side meant.
   */
  private wiredSides(k: Connection): void {
    const C = this.c.game.connections;
    const sides: string[] = [];
    for (const p of [k.a, k.b]) {
      if (!p) continue;
      const r = C.roleOf(p.entity, k);
      if (r !== 'both') sides.push(`the ${p.entity.label}’s ${r === 'in' ? 'input' : 'output'}`);
    }
    if (sides.length) this.c.ui.toast(`Wired to ${sides.join(' and ')}`);
  }

  // ---- the Remove tool --------------------------------------------------------------

  /**
   * The Remove tool pressed: on a connection's line or knot, it goes; Shift on
   * a thing, all of its connections go. Anywhere else a box is dragged out, and
   * every connection crossing it goes. (A plain click on a thing's body takes
   * nothing: it said so as the cursor came over it.)
   */
  removeDown(shift: boolean): void {
    const c = this.c;
    const at = this.point();
    const hit = this.hit(at);
    if (hit) {
      this.unconnect([hit.c], true);
      return;
    }
    const part = c.game.pick(at.x, at.y, c.pickRadius());
    if (part && shift) {
      const all = c.game.connections.connectionsOf(part.entity);
      if (all.length) this.unconnect(all, true);
      else c.ui.toast(`Nothing is connected to the ${part.entity.label}`);
      return;
    }
    // (editing the map: the ground clicked is taken away)
    if (!part && c.terrain?.removeAt(at.x, at.y)) return;
    this.cut = { x0: at.x, y0: at.y, sx: c.sx, sy: c.sy };
  }

  removeUp(): void {
    const c = this.c;
    const box = this.cut;
    this.cut = null;
    if (!box) return;
    if (Math.hypot(c.sx - box.sx, c.sy - box.sy) < CLICK_SLOP) {
      const part = c.game.pick(box.x0, box.y0, c.pickRadius());
      const n = part ? c.game.connections.connectionsOf(part.entity).length : 0;
      if (part && n) c.ui.toast(`Click a connection to remove it · Shift+click: all ${n} of the ${part.entity.label}’s`);
      else if (part) c.ui.toast(`Nothing is connected to the ${part.entity.label}`);
      else c.ui.toast('Click a connection to remove it, or drag a box across several');
      return;
    }
    const cut = this.crossing(box.x0, box.y0, this.point().x, this.point().y);
    if (cut.length) this.unconnect(cut, true);
  }

  /** The connections whose line (or knot) crosses a box. */
  crossing(x0: number, y0: number, x1: number, y1: number): Connection[] {
    const C = this.c.game.connections;
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1);
    const hy = Math.max(y0, y1);
    const inside = (p: V2) => p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy;
    return C.list.filter((k) => {
      if (k.kind === 'wire' && !C.showWires) return false;
      if (k.opts?.hidden && !C.showHidden) return false;
      const a = C.endPoint(k, 'a');
      const b = C.endPoint(k, 'b');
      if (inside(a) || inside(b)) return true;
      // (a straight line between its ends: near enough for a box)
      const edges: [V2, V2][] = [
        [{ x: lx, y: ly }, { x: hx, y: ly }], [{ x: hx, y: ly }, { x: hx, y: hy }],
        [{ x: hx, y: hy }, { x: lx, y: hy }], [{ x: lx, y: hy }, { x: lx, y: ly }],
      ];
      return edges.some(([p, q]) => crosses(a, b, p, q));
    });
  }

  /** Takes connections away (the Remove tool, with a snap; menus). */
  unconnect(list: Connection[], snap: boolean): void {
    const c = this.c;
    if (!list.length) return;
    if (c.net) return c.net.send({ op: 'unconnect', conns: list.map((k) => c.net!.conn(k)) });
    c.history.record(list.length > 1 ? `Remove ${list.length} connections` : 'Remove connection');
    const at = c.game.connections.endPoint(list[0], 'a');
    for (const k of list) c.game.connections.remove(k);
    if (snap) c.game.sound.snap(at.x);
  }

  // ---- connections already made ------------------------------------------------------

  /** The connection at a point (within a few screen pixels), and which of it. */
  hit(at: V2 = this.point()): ConnHit | null {
    const c = this.c;
    const r = (CONN_REACH * (c.touchMode ? 2.5 : 1)) / c.game.renderer.zoom;
    return c.game.connections.hitAt(at.x, at.y, r);
  }

  /**
   * The Drag tool pressed with time paused: on a connection's knot, that end is
   * picked up (to be put down somewhere else). False: not on a knot.
   */
  knotDown(): boolean {
    const c = this.c;
    if (!c.game.paused) return false;
    const h = this.hit();
    if (!h || h.end === 'line') return false;
    // (a hinge's or pin's only knot is its joint: moving it moves where it turns, on the same parts)
    this.knot = { c: h.c, end: h.end };
    return true;
  }

  /** A knot let go: its end goes where it was put (on the background: a rope or spring only, or with Ctrl). */
  knotUp(ctrl: boolean): void {
    const k = this.knot;
    this.knot = null;
    if (!k) return;
    const C = this.c.game.connections;
    if (!C.list.includes(k.c)) return;
    const other = k.end === 'a' ? k.c.b : k.c.a;
    const own = k.end === 'a' ? k.c.a : k.c.b;
    const exclude = (p: Part) => p === other || (k.c.kind === 'wire' && !!other && p.entity === other.entity);
    const to = this.anchorAt(k.c.kind, exclude, k.c);
    const was = C.endPoint(k.c, k.end);
    if (Math.hypot(to.world.x - was.x, to.world.y - was.y) < PX * 0.5 && to.part === own) return;
    if (!to.part) {
      if (k.c.kind === 'wire') {
        this.c.ui.toast('Wires must connect two objects');
        return;
      }
      if (RIGID_KINDS.has(k.c.kind) && !ctrl) {
        this.c.ui.toast('Put down over nothing: left where it was (hold Ctrl to fix it to the background)');
        return;
      }
    }
    this.moveEnd(k.c, k.end, to);
  }

  /** Moves one end of a connection to an anchor (see Connections.moveEnd()). */
  moveEnd(k: Connection, end: 'a' | 'b', to: Anchor): void {
    const c = this.c;
    if (c.net) {
      return c.net.send({ op: 'moveEnd', conn: c.net.conn(k), end, p: to.part ? c.net.ref(to.part) : null, w: to.world });
    }
    c.history.record(`Move ${CONN_LABEL[k.kind].toLowerCase()} end`);
    const made = c.game.connections.moveEnd(k, end, to.part, to.world);
    if (!made) {
      c.ui.toast('It can’t go there');
      return;
    }
    c.game.sound.place(to.world.x, k.kind === 'rope' || k.kind === 'wire' || k.kind === 'fuse' ? 'wood' : 'metal');
    this.preview.flash([to.world]);
  }

  /** A connection's settings changed (its menu), for undo (slider moves of one kind coalesce). */
  editConn(k: Connection, patch: Partial<Record<keyof ConnOpts, unknown>>, label: string): void {
    const c = this.c;
    if (c.net) return c.net.send({ op: 'editConn', conn: c.net.conn(k), patch });
    c.history.record(label, { coalesce: `conn:${k.id}:${Object.keys(patch).join()}` });
    c.game.connections.setOpts(k, patch);
  }

  /** A rope's, spring's or fuse cord's length (m). */
  setRest(k: Connection, len: number): void {
    const c = this.c;
    if (!Number.isFinite(len)) return;
    if (c.net) return c.net.send({ op: 'setRest', conn: c.net.conn(k), len });
    c.history.record('Length', { coalesce: `rest:${k.id}` });
    c.game.connections.setRest(k, len);
  }

  /**
   * The wheel: while a rope or spring is being made, its length; with time
   * paused, over one already made, that one's (a sprite pixel a notch, 10 cm
   * with Shift). False: the wheel zooms, as usual.
   */
  wheel(dy: number, fast: boolean): boolean {
    const c = this.c;
    const step = (fast ? 0.1 : PX) * (dy > 0 ? -1 : 1);
    const p = this.pending;
    if (p && (p.kind === 'rope' || p.kind === 'spring' || p.kind === 'fuse')) {
      const b = this.anchorAt(p.kind, (q) => q === p.a.part);
      const d = Math.hypot(b.world.x - p.a.world.x, b.world.y - p.a.world.y);
      p.rest = Math.min(40, Math.max(0.02, (p.rest ?? d) + step));
      return true;
    }
    if (!c.game.paused || p) return false;
    const h = this.hoverConn ?? this.hit();
    if (!h || (h.c.kind !== 'rope' && h.c.kind !== 'spring' && h.c.kind !== 'fuse')) return false;
    this.setRest(h.c, h.c.rest + step);
    return true;
  }

  /**
   * Delete with the cursor on a connection and nothing selected: that
   * connection goes (as a right-click deletes a wire in People Playground).
   */
  deleteHovered(): boolean {
    const c = this.c;
    const h = this.hoverConn;
    if (!h || c.selection.size || !c.game.connections.list.includes(h.c)) return false;
    this.unconnect([h.c], true);
    return true;
  }

  // ---- fuses, hinges and springs -----------------------------------------------------

  /** Lights the fuse cord passing near (x, y), if one does (a guest's lights in the host's game too). */
  lightAt(x: number, y: number, r: number): boolean {
    const c = this.c;
    const lit = c.game.connections.lightAt(x, y, r);
    if (lit && c.net) c.net.send({ op: 'lightAt', x, y, r });
    return lit;
  }

  /** Lights a fuse cord at one end. */
  lightFuse(k: Connection, end: 0 | 1): void {
    const c = this.c;
    c.game.connections.light(k, end);
    if (c.net) c.net.send({ op: 'light', conn: c.net.conn(k), end });
  }

  /** How far a hinge (or pin) may swing (null: freely). */
  setLimit(k: Connection, rad: number | null): void {
    const c = this.c;
    if (c.net) return c.net.send({ op: 'limit', conn: c.net.conn(k), rad });
    c.history.record(rad === null ? 'Free hinge' : 'Limit hinge', { coalesce: `limit:${k.id}` });
    c.game.connections.setLimit(k, rad);
  }

  /** The spring the cursor is on, if it's on one. */
  springUnder(): Connection | null {
    const c = this.c;
    return c.game.connections.springAt(c.wx, c.wy, Math.max(c.pickRadius(), PX * 4));
  }

  /**
   * The Spring tool's key pressed again: the spring under the cursor (else the
   * springs the tool makes from now on) gets the next stiffness, round to the
   * softest after the stiffest.
   */
  stepSpring(): void {
    const c = this.c;
    const k = this.springUnder();
    const s = SPRING_STIFFNESS[(stiffnessStep(k ? k.stiffness ?? 1 : c.springStiffness) + 1) % SPRING_STIFFNESS.length];
    if (k) this.setSpringStiffness(k, s.k);
    else c.springStiffness = s.k;
    c.game.sound.click(c.wx, 0.6 + stiffnessStep(s.k) * 0.15);
    c.ui.toast(`${k ? 'This spring' : 'New springs'}: ${s.name.toLowerCase()}`);
    c.ui.onToolChanged();
  }

  setSpringStiffness(k: Connection, s: number): void {
    const c = this.c;
    if (c.net) return c.net.send({ op: 'stiffness', conn: c.net.conn(k), k: s });
    c.history.record('Spring stiffness');
    c.game.connections.setStiffness(k, s);
  }

  /** The context menu's choice of stiffness for a spring. */
  springActions(k: Connection): ContextAction[] {
    const now = stiffnessStep(k.stiffness ?? 1);
    return SPRING_STIFFNESS.map((s, i) => ({
      label: `Spring: ${s.name.toLowerCase()}`,
      checked: i === now,
      action: () => this.setSpringStiffness(k, s.k),
    }));
  }

  // ---- each frame --------------------------------------------------------------------

  /**
   * What the cursor is on and what pressing or letting go would make: the
   * snapped anchor, the connection under it, the ghosts and the label (see
   * EditOverlay, which draws the rings and the label).
   */
  frame(): void {
    const c = this.c;
    const C = c.game.connections;
    const tool = c.toolKind;
    const dragTool = c.tab === 'tools' && c.tool === 'drag';
    this.label = '';
    this.labelBad = false;
    this.ends = [];
    this.hover = null;
    const ghosts: ConnGhost[] = [];
    C.highlights.clear();
    // hidden connections show while building: time paused, a connection tool in hand, or the detail view
    C.showHidden = c.game.paused || (!!tool && tool !== 'remove') || c.detail;
    const lifted = c.touchMode && !c.fingerDown;
    // the connection the cursor is on (not while something is held or dragged out)
    const free = !c.grab && !c.resize && !this.pending && !this.cut && !lifted;
    this.hoverConn = free && (dragTool || tool) && c.hoverHighlights ? this.hit() : null;
    if (this.knot) {
      this.knotFrame(ghosts);
    } else if (this.pending) {
      this.pendingFrame(this.pending, ghosts);
    } else if (this.cut) {
      const at = this.point();
      for (const k of this.crossing(this.cut.x0, this.cut.y0, at.x, at.y)) C.highlights.set(k, 0xd8463a);
    } else if (tool === 'remove') {
      const h = this.hoverConn;
      if (h) {
        C.highlights.set(h.c, 0xd8463a);
        this.label = `Click: remove this ${CONN_LABEL[h.c.kind].toLowerCase()}`;
      } else if (!lifted && c.hover) {
        const all = C.connectionsOf(c.hover.entity);
        if (all.length && c.isHeld('fast')) for (const k of all) C.highlights.set(k, 0xd8463a);
        this.label = all.length ? `Shift+click: remove all ${all.length} of its connections` : '';
      }
    } else if (tool && !lifted) {
      this.hoverFrame(tool);
    } else if (this.hoverConn) {
      C.highlights.set(this.hoverConn.c, 0xfff1b0);
      this.label = this.describe(this.hoverConn.c);
    }
    if (this.hoverConn && tool && tool !== 'remove' && !this.pending && !C.highlights.size) C.highlights.set(this.hoverConn.c, 0xfff1b0);
    this.preview.ghosts = ghosts;
  }

  /** A connection tool hovering: where the first end would go, and what a click would do. */
  private hoverFrame(tool: ConnKind): void {
    const kind = tool === 'pin' ? 'hinge' : tool;
    const a = this.anchorAt(kind);
    this.hover = a;
    if (a.part) this.ends = [a];
    const name = CONN_LABEL[tool === 'hinge' ? 'hinge' : tool];
    if (!a.part) {
      if (this.hoverConn && tool === 'fuse' && this.hoverConn.c.kind === 'fuse') this.label = 'Click: light this fuse cord';
      else if (tool === 'rope' || tool === 'spring' || tool === 'fuse') this.label = `${name} from the background`;
      else if (this.hoverConn) this.label = this.describe(this.hoverConn.c);
      return;
    }
    if (tool === 'weld' || tool === 'pin' || tool === 'hinge') {
      const under = this.behind(a);
      const to = under ? `${under.entity.label} behind` : 'the background';
      this.label = tool === 'weld' ? `Weld from ${anchorLabel(a)} · click: fix to ${to}` : `Pin ${anchorLabel(a)} to ${to} · drag: hinge to another`;
      return;
    }
    this.label = `${name} from ${anchorLabel(a)}`;
  }

  /** A connection being made: the ghost to where it would go, and the label saying what it would be. */
  private pendingFrame(p: Pending, ghosts: ConnGhost[]): void {
    const c = this.c;
    if (p.a.part?.destroyed) {
      this.pending = null;
      return;
    }
    // (the first end follows its part: time may be running)
    const a = p.a.part ? { ...p.a, world: p.a.part.localToWorld(p.a.local.x, p.a.local.y) } : p.a;
    p.a = a;
    const ctrl = c.ctrlDown;
    const plan = this.plan(p, ctrl);
    const name = CONN_LABEL[p.kind];
    const len = (b: Anchor) => p.rest ?? Math.hypot(b.world.x - a.world.x, b.world.y - a.world.y);
    if (plan.why) {
      const b = this.anchorAt(p.kind, (q) => q === a.part);
      ghosts.push({ kind: p.kind, a: a.world, b: b.world, rest: len(b), bad: true, wall: !b.part, wallA: !a.part });
      this.label = plan.why;
      this.labelBad = true;
      this.ends = b.part ? [a, b] : [a];
      return;
    }
    for (const b of plan.targets) ghosts.push({ kind: p.kind, a: a.world, b: b.world, rest: len(b), wall: !b.part, wallA: !a.part });
    this.ends = [a, ...plan.targets];
    const first = plan.targets[0];
    const ln = p.kind === 'rope' || p.kind === 'spring' || p.kind === 'fuse' ? ` ${len(first).toFixed(2)} m` : '';
    const slack = p.kind === 'rope' && p.rest !== null ? ` (slack ${(p.rest - Math.hypot(first.world.x - a.world.x, first.world.y - a.world.y)).toFixed(2)})` : '';
    let to: string;
    if (plan.targets.length > 1) {
      const kinds = new Set(plan.targets.map((t) => t.part?.entity.label));
      to = `${plan.targets.length} ${kinds.size === 1 ? plural([...kinds][0] ?? 'things') : 'things'}`;
    } else to = first.part ? anchorLabel(first) : 'background';
    const from = a.part ? '' : 'background ';
    const dist = p.kind === 'weld' && first.part ? ` · ${Math.hypot(first.world.x - a.world.x, first.world.y - a.world.y).toFixed(2)} m` : '';
    const chain = p.waiting ? ' · Esc: stop' : c.touchMode ? '' : ' · Shift: keep going';
    this.label = `${from}${name}${ln}${slack} → ${to}${dist}${chain}`;
  }

  /** A knot being dragged: the connection from its other end to where this one would go. */
  private knotFrame(ghosts: ConnGhost[]): void {
    const k = this.knot!;
    const C = this.c.game.connections;
    if (!C.list.includes(k.c)) {
      this.knot = null;
      return;
    }
    const other = k.end === 'a' ? k.c.b : k.c.a;
    const fixed = C.endPoint(k.c, k.end === 'a' ? 'b' : 'a');
    const to = this.anchorAt(k.c.kind, (p) => p === other, k.c);
    const bad = !to.part && (k.c.kind === 'wire' || (RIGID_KINDS.has(k.c.kind) && !this.c.ctrlDown));
    ghosts.push({ kind: k.c.kind, a: fixed, b: to.world, rest: k.c.kind === 'wire' ? undefined : k.c.rest, bad, wall: !to.part });
    C.highlights.set(k.c, 0xfff1b0);
    this.ends = to.part ? [to] : [];
    this.label = `${CONN_LABEL[k.c.kind]} end → ${to.part ? anchorLabel(to) : 'background'}${bad ? ' (hold Ctrl to fix it there)' : ''}`;
    this.labelBad = bad;
  }

  /** What a connection is, for the label by the cursor: "Rope 2.10 m · Crate ↔ Beam · right-click: edit · Del: delete". */
  describe(k: Connection): string {
    const c = this.c;
    const what = k.kind === 'rope' || k.kind === 'spring' || k.kind === 'fuse' ? `${CONN_LABEL[k.kind]} ${k.rest.toFixed(2)} m` : CONN_LABEL[k.kind];
    const ends = `${k.a.entity.label} ↔ ${k.b ? k.b.entity.label : 'background'}`;
    const del = c.bindings.label('delete').split(' / ')[0];
    const hidden = k.opts?.hidden ? ' (hidden)' : '';
    if (c.touchMode) return `${what}${hidden} · ${ends} · long-press: edit`;
    return `${what}${hidden} · ${ends} · right-click: edit${del && !c.selection.size ? ` · ${del}: delete` : ''}`;
  }
}

/** "Thrusters" from "Thruster". */
function plural(s: string): string {
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/i.test(s)) return s + 'es';
  return s + 's';
}

/** Whether segments ab and cd cross. */
function crosses(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

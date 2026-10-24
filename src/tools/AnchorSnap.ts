import { RAPIER } from '../engine/Physics';
import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { AttachRole, Part } from '../world/Part';
import type { ConnKind, Connection } from '../systems/Connections';
import { attachPointsOf } from '../catalog/attach';

/** What a connection's end snapped to (see snapAnchor()). */
export type AnchorKind = 'attach' | 'com' | 'centre' | 'anchor' | 'corner' | 'edge' | 'pixel' | 'free' | 'background';

/** Where a connection's end goes: a point on a part, or on the background. */
export interface Anchor {
  part: Part | null;
  /** The point in the part's own frame (m); for the background, the world point. */
  local: V2;
  world: V2;
  kind: AnchorKind;
  /** What the point is ("hub", "centre of mass", "corner"); '' for a plain point. */
  name: string;
  role?: AttachRole;
}

/** How to snap (see snapAnchor()). */
export interface SnapOpts {
  /** Screen pixels a metre (the camera's zoom). */
  zoom: number;
  /** The connection being made (the Pin tool's is 'pin'). */
  kind: ConnKind;
  /** A finger: the snapping reaches further. */
  touch?: boolean;
  /** Exactly where the cursor is (Alt held). */
  free?: boolean;
  /** At the centre of mass of what's under the cursor (M held, as in People Playground). */
  com?: boolean;
  /** Snapping is on (Settings; the self-tests turn it off to press at exact points). */
  snap?: boolean;
  /** Parts it may not go on (the connection's own other end, the thing a wire starts from). */
  exclude?: (p: Part) => boolean;
  /** A connection whose own ends don't count as anchors to snap to (one being moved). */
  skip?: Connection | null;
  /** How near (m) the cursor must come to a part to be on it. */
  pickRadius: number;
}

/** A point it could snap to, best first by `prio`; `reach` is how near (screen px) the cursor must come. */
export interface Candidate {
  part: Part;
  local: V2;
  world: V2;
  kind: AnchorKind;
  name: string;
  role?: AttachRole;
  prio: number;
  reach: number;
}

/** Screen pixels within which the named points (attach points, centres, other anchors) snap; corners and edges less. */
const REACH = 10;
const REACH_EDGE = 7;
/** A pin on a wheel or rotor finds its middle from this far (screen px). */
const REACH_WHEEL = 20;

const NAMES: Record<AnchorKind, string> = {
  attach: '', com: 'centre of mass', centre: 'centre', anchor: 'anchor', corner: 'corner', edge: 'edge', pixel: '', free: '', background: 'background',
};

/** A part that's a wheel or a rotor: round, one ball. */
export function isRound(p: Part): boolean {
  return p.colliders.length === 1 && p.colliders[0].shape.type === RAPIER.ShapeType.Ball;
}

/** A point in a part's frame from sprite pixels (from the art's top-left corner). */
export function pixelLocal(p: Part, x: number, y: number): V2 {
  return { x: (x - p.w / 2 + p.spriteOffset.x) * p.flip * PX, y: (p.h / 2 - y + p.spriteOffset.y) * PX };
}

/** The part's centre of mass, in its own frame. */
function localCom(p: Part): V2 {
  const c = p.body.localCom();
  return { x: c.x, y: c.y };
}

/**
 * The points on a part (and its machine) that a connection of `kind` snaps to,
 * best first: the attach points its kind declares (on whichever of its parts
 * they are: a motor wheel's hub is what's meant near the middle of its tyre),
 * its centre of mass, the middle of its picture, anchors already on it (a rope
 * and a wire on one hook), and its corners and the middles of its edges (not for
 * wires: ports and middles).
 */
export function candidates(p: Part, kind: ConnKind, touch = false, skip?: Connection | null): Candidate[] {
  const k = touch ? 1.6 : 1;
  const out: Candidate[] = [];
  const wire = kind === 'wire';
  const pin = kind === 'hinge' || kind === 'pin';
  const add = (part: Part, local: V2, ck: AnchorKind, prio: number, reach: number, name = NAMES[ck], role?: AttachRole) => {
    // (two points in one place: the better one only)
    if (out.some((o) => o.part === part && Math.hypot(o.local.x - local.x, o.local.y - local.y) < PX * 0.6)) return;
    out.push({ part, local, world: part.localToWorld(local.x, local.y), kind: ck, name, role, prio, reach: reach * k });
  };
  const e = p.entity;
  // the attach points: the picked part's first, then its machine's other parts'
  const parts = [p, ...e.parts.filter((q) => q !== p && !q.destroyed)];
  for (const q of parts) {
    for (const a of attachPointsOf(q)) {
      // wires go to ports and mounts, joints to axles, mounts and plates
      const fits = wire ? a.role !== 'axle' && a.role !== 'plate' : a.role !== 'in' && a.role !== 'out';
      if (!fits) continue;
      add(q, pixelLocal(q, a.x, a.y), 'attach', 1, REACH, a.name, a.role);
    }
  }
  add(p, localCom(p), 'com', 2, pin && isRound(p) ? REACH_WHEEL : REACH);
  add(p, { x: p.spriteOffset.x * p.flip * PX, y: p.spriteOffset.y * PX }, 'centre', 3, REACH);
  for (const c of p.entity.game.connections.list) {
    if (c === skip) continue;
    if (c.a === p) add(p, { ...c.la }, 'anchor', 4, REACH);
    if (c.b === p && c.kind !== 'weld' && c.kind !== 'hinge' && c.kind !== 'pin') add(p, { ...c.lb }, 'anchor', 4, REACH);
    if (c.b === p && c.kind === 'weld' && c.end) add(p, { ...c.end }, 'anchor', 4, REACH);
  }
  if (!wire) {
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        if (!sx && !sy) continue;
        add(p, pixelLocal(p, ((sx + 1) / 2) * p.w, ((1 - sy) / 2) * p.h), sx && sy ? 'corner' : 'edge', 5, REACH_EDGE);
      }
    }
  }
  return out;
}

/** The plain point under the cursor on a part, on its pixel grid (a sprite pixel's middle), so anchors sit neatly in the pixel art. */
function pixelPoint(p: Part, x: number, y: number): V2 {
  const { ix, iy } = p.worldToPixel(x, y);
  return p.pixelToLocal(ix, iy);
}

/**
 * Where a connection's end goes when the cursor is at (x, y): on the smallest
 * part there (see Game.pick()), at the best point within reach of the cursor
 * (see candidates()), else on the part's pixel grid; with nothing there, on the
 * background. Alt places it exactly at the cursor; M at the centre of mass of
 * what's under it (or, as in People Playground, of something just beside it).
 */
export function snapAnchor(game: Game, x: number, y: number, o: SnapOpts): Anchor {
  const filter = o.exclude ? (p: Part) => !o.exclude!(p) : undefined;
  let part = game.pick(x, y, o.pickRadius, filter);
  if (!part && o.com && !o.free) part = game.pick(x, y, (40 * (o.touch ? 1.6 : 1)) / o.zoom, filter);
  if (!part) return { part: null, local: { x, y }, world: { x, y }, kind: 'background', name: NAMES.background };
  const at = (local: V2, kind: AnchorKind, name = NAMES[kind], p: Part = part!, role?: AttachRole): Anchor => ({
    part: p, local, world: p.localToWorld(local.x, local.y), kind, name, role,
  });
  if (o.free) return at(part.worldToLocal(x, y), 'free');
  if (o.com) return at(localCom(part), 'com');
  if (o.snap === false) return at(part.worldToLocal(x, y), 'free');
  let best: Candidate | null = null;
  let bd = Infinity;
  const off = (c: Candidate) => (c.part === part ? 0 : 1);
  for (const c of candidates(part, o.kind, o.touch, o.skip)) {
    if (o.exclude?.(c.part)) continue;
    const d = Math.hypot(c.world.x - x, c.world.y - y) * o.zoom;
    if (d > c.reach) continue;
    // the best kind of point in reach; of two alike, one on the part under the cursor, then the nearer
    const better = !best || c.prio < best.prio || (c.prio === best.prio && (off(c) < off(best) || (off(c) === off(best) && d < bd)));
    if (better) {
      best = c;
      bd = d;
    }
  }
  if (best) return at(best.local, best.kind, best.name, best.part, best.role);
  return at(pixelPoint(part, x, y), 'pixel');
}

/** What an anchor is, for the labels by the cursor: "Motor Wheel · hub", "Plank (corner)", "background". */
export function anchorLabel(a: Anchor): string {
  if (!a.part) return 'background';
  const e = a.part.entity;
  const what = e.parts.length > 1 && a.kind !== 'attach' ? `${e.label} ${a.part.name.toLowerCase()}` : e.label;
  if (a.kind === 'attach') return `${what} · ${a.name}`;
  return a.name ? `${what} (${a.name})` : what;
}

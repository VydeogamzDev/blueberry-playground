import type R from '@dimforge/rapier2d-compat';
import { RAPIER } from '../engine/Physics';
import type { V2 } from '../engine/math';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';

/** A box lined up with the world's axes (m). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A line drawn while something snaps into line with something else, and the gap between them (see EditOverlay). */
export interface Guide {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The gap to the thing lined up with, side by side: where to label it, and how wide it is (m). */
  gap?: { x: number; y: number; m: number };
}

/** How far (m) round what's moved to look for things to line it up with. */
const NEAR = 3;

/** Where a part's shapes reach, as a box lined up with the world's axes (from its colliders, as it is now). */
export function partBox(p: Part): Box {
  const t = p.body.translation();
  const a = p.body.rotation();
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (lx: number, ly: number, r = 0) => {
    const x = t.x + lx * ca - ly * sa;
    const y = t.y + lx * sa + ly * ca;
    box.x0 = Math.min(box.x0, x - r);
    box.x1 = Math.max(box.x1, x + r);
    box.y0 = Math.min(box.y0, y - r);
    box.y1 = Math.max(box.y1, y + r);
  };
  for (const c of p.colliders) {
    const o = c.translationWrtParent() ?? { x: 0, y: 0 };
    const r = c.rotationWrtParent() ?? 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const local = (x: number, y: number, round = 0) => take(o.x + x * cr - y * sr, o.y + x * sr + y * cr, round);
    const s = c.shape;
    switch (s.type) {
      case RAPIER.ShapeType.Ball:
        local(0, 0, (s as RAPIER.Ball).radius);
        break;
      case RAPIER.ShapeType.Cuboid:
      case RAPIER.ShapeType.RoundCuboid: {
        const h = (s as RAPIER.Cuboid).halfExtents;
        const br = s.type === RAPIER.ShapeType.RoundCuboid ? (s as R.RoundCuboid).borderRadius : 0;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) local(sx * h.x, sy * h.y, br);
        break;
      }
      case RAPIER.ShapeType.Capsule: {
        const k = s as R.Capsule;
        local(0, -k.halfHeight, k.radius);
        local(0, k.halfHeight, k.radius);
        break;
      }
      case RAPIER.ShapeType.ConvexPolygon:
      case RAPIER.ShapeType.RoundConvexPolygon: {
        const v = (s as R.ConvexPolygon).vertices;
        const br = s.type === RAPIER.ShapeType.RoundConvexPolygon ? (s as R.RoundConvexPolygon).borderRadius : 0;
        for (let i = 0; i + 1 < v.length; i += 2) local(v[i], v[i + 1], br);
        break;
      }
      default:
        local(0, 0, p.reach);
    }
  }
  if (!Number.isFinite(box.x0)) return { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
  return box;
}

/** The box round all of these things' parts (null: none left). */
export function boxOf(ents: Iterable<Entity>): Box | null {
  let out: Box | null = null;
  for (const e of ents) {
    if (e.destroyed) continue;
    for (const p of e.parts) {
      if (p.destroyed) continue;
      const b = partBox(p);
      if (!out) out = { ...b };
      else {
        out.x0 = Math.min(out.x0, b.x0);
        out.y0 = Math.min(out.y0, b.y0);
        out.x1 = Math.max(out.x1, b.x1);
        out.y1 = Math.max(out.y1, b.y1);
      }
    }
  }
  return out;
}

/** A line things can be lined up with: at `at` along one axis, along the edge (or middle) of `box` (null: the floor). */
interface Line {
  at: number;
  box: Box | null;
  /** Which of the box's: -1 its low edge, 0 its middle, 1 its high edge. */
  side: -1 | 0 | 1;
}

/**
 * Something moved to `box` (already moved by the cursor): how much further to
 * move it so one of its edges or its middle lines up with a neighbour's (or its
 * bottom sits on the floor or the ground), when within `px` screen pixels of
 * that, on each axis; and the lines to draw for it, with the gap between the
 * two things where they sit side by side.
 */
export function alignMove(game: Game, moving: Set<Entity>, box: Box, zoom: number, px = 6): { dx: number; dy: number; guides: Guide[] } {
  const reach = px / zoom;
  const xs: Line[] = [];
  const ys: Line[] = [];
  const near = { x0: box.x0 - NEAR, y0: box.y0 - NEAR, x1: box.x1 + NEAR, y1: box.y1 + NEAR };
  const mx = (box.x0 + box.x1) / 2;
  for (const e of game.entities) {
    if (e.destroyed || moving.has(e)) continue;
    for (const p of e.parts) {
      if (p.destroyed || Math.abs(p.x - mx) > NEAR + (box.x1 - box.x0) / 2 + p.reach) continue;
      const b = partBox(p);
      if (b.x1 < near.x0 || b.x0 > near.x1 || b.y1 < near.y0 || b.y0 > near.y1) continue;
      xs.push({ at: b.x0, box: b, side: -1 }, { at: (b.x0 + b.x1) / 2, box: b, side: 0 }, { at: b.x1, box: b, side: 1 });
      ys.push({ at: b.y0, box: b, side: -1 }, { at: (b.y0 + b.y1) / 2, box: b, side: 0 }, { at: b.y1, box: b, side: 1 });
    }
  }
  // the floor, or the map's ground, under it
  ys.push({ at: game.env.groundAt(mx, box.y0 + reach + 0.01), box: null, side: 1 });
  // (-1, 0, 1: the moved box's low edge, middle, high edge)
  const pick = (lines: Line[], lo: number, hi: number) => {
    let best: { d: number; line: Line; mine: -1 | 0 | 1 } | null = null;
    for (const l of lines) {
      for (const mine of [-1, 0, 1] as const) {
        const d = l.at - (mine < 0 ? lo : mine > 0 ? hi : (lo + hi) / 2);
        if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, line: l, mine };
      }
    }
    return best;
  };
  const sx = pick(xs, box.x0, box.x1);
  const sy = pick(ys, box.y0, box.y1);
  const dx = sx ? sx.d : 0;
  const dy = sy ? sy.d : 0;
  const m = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
  const guides: Guide[] = [];
  if (sx) {
    const x = sx.line.at;
    const o = sx.line.box!;
    const g: Guide = { x0: x, y0: Math.min(o.y0, m.y0) - 0.15, x1: x, y1: Math.max(o.y1, m.y1) + 0.15 };
    if (sx.mine !== 0 && sx.line.side === -sx.mine) {
      // edge to edge, side by side: flush
      g.gap = { x, y: (Math.max(o.y0, m.y0) + Math.min(o.y1, m.y1)) / 2, m: 0 };
    } else {
      // lined up one above the other: the gap between them
      const gap = m.y0 >= o.y1 ? m.y0 - o.y1 : o.y0 >= m.y1 ? o.y0 - m.y1 : -1;
      if (gap >= 0) g.gap = { x, y: m.y0 >= o.y1 ? (m.y0 + o.y1) / 2 : (o.y0 + m.y1) / 2, m: gap };
    }
    guides.push(g);
  }
  if (sy) {
    const y = sy.line.at;
    const o = sy.line.box;
    const g: Guide = { x0: Math.min(o?.x0 ?? m.x0 - 0.5, m.x0) - 0.15, y0: y, x1: Math.max(o?.x1 ?? m.x1 + 0.5, m.x1) + 0.15, y1: y };
    if (o) {
      if (sy.mine !== 0 && sy.line.side === -sy.mine) {
        g.gap = { x: (Math.max(o.x0, m.x0) + Math.min(o.x1, m.x1)) / 2, y, m: 0 };
      } else {
        const gap = m.x0 >= o.x1 ? m.x0 - o.x1 : o.x0 >= m.x1 ? o.x0 - m.x1 : -1;
        if (gap >= 0) g.gap = { x: m.x0 >= o.x1 ? (m.x0 + o.x1) / 2 : (o.x0 + m.x1) / 2, y, m: gap };
      }
    }
    guides.push(g);
  }
  return { dx, dy, guides };
}

/** The point of a box nearest `p`: one of its corners. */
export function nearestCorner(b: Box, p: V2): V2 {
  return { x: Math.abs(p.x - b.x0) < Math.abs(p.x - b.x1) ? b.x0 : b.x1, y: Math.abs(p.y - b.y0) < Math.abs(p.y - b.y1) ? b.y0 : b.y1 };
}

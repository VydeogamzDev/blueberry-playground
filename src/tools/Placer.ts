import { PX } from '../engine/constants';
import type { V2 } from '../engine/math';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { ItemDef } from '../world/types';
import { instantiate, mirror, type Snapshot } from '../world/Snapshot';
import { getItem } from '../catalog/items';
import { alignMove, type Box, type Guide } from './Guides';
import type { Controls } from './Controls';

/** A group's middle (the mean of its parts) and its lowest part. */
export function snapCenter(snap: Snapshot): { x: number; y: number; minY: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  let minY = Infinity;
  for (const s of snap.entities) for (const p of s.parts) {
    if (p.hp === -1) continue;
    x += p.x;
    y += p.y;
    minY = Math.min(minY, p.y);
    n++;
  }
  return n ? { x: x / n, y: y / n, minY } : { x: 0, y: 0, minY: 0 };
}

/** A group turned by `angle` about its middle (parts, their motion, and anything tied to the background). */
export function rotateSnap(snap: Snapshot, angle: number): Snapshot {
  if (!angle) return snap;
  const c = snapCenter(snap);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (x: number, y: number): V2 => ({ x: c.x + (x - c.x) * cos - (y - c.y) * sin, y: c.y + (x - c.x) * sin + (y - c.y) * cos });
  return {
    entities: snap.entities.map((s) => ({
      ...s,
      parts: s.parts.map((p) => {
        if (p.hp === -1) return p;
        const at = turn(p.x, p.y);
        return { ...p, x: at.x, y: at.y, a: p.a + angle, vx: p.vx * cos - p.vy * sin, vy: p.vx * sin + p.vy * cos };
      }),
    })),
    connections: snap.connections.map((k) => (k.b ? k : { ...k, lb: turn(k.lb.x, k.lb.y), ...(k.end ? { end: turn(k.end.x, k.end.y) } : {}) })),
  };
}

/** A picture of one part of what's being placed, about the ghost's middle (m, radians). */
export interface GhostImage {
  img: CanvasImageSource;
  x: number;
  y: number;
  a: number;
  /** Its size (m), and where its picture sits on it (m, in its own frame). */
  w: number;
  h: number;
  ox: number;
  oy: number;
  flip: number;
}

/** What's about to be placed, shown where it will go. */
export interface Ghost {
  def: ItemDef | null;
  /** A group: a paste, a contraption. */
  snap: Snapshot | null;
  label: string;
  /** Mirrored (Q, or R while placing). */
  flip: boolean;
  /** Turned (A/D while placing; radians). */
  angle: number;
  /** Where its middle goes (world), snapped. */
  at: V2;
  /** Its pictures, unturned and unmirrored. */
  images: GhostImage[];
  /** Solid (a key held, or a finger's tap): released, it's placed. Otherwise a faint hint of what Q/E would spawn. */
  solid: boolean;
  /** The key held (let go: placed). */
  key: 'spawnLeft' | 'spawnRight' | 'paste' | null;
}

/** Pictures of live parts (for what's copied), about a middle. */
export function imagesOfParts(parts: Part[], cx: number, cy: number): GhostImage[] {
  return parts.filter((p) => !p.destroyed).sort((a, b) => a.z - b.z).map((p) => ({
    img: p.art.toCanvas(0), x: p.x - cx, y: p.y - cy, a: p.a, w: p.w * PX, h: p.h * PX, ox: p.spriteOffset.x * PX, oy: p.spriteOffset.y * PX, flip: p.flip,
  }));
}

/** Pictures of a group from its kinds' toybox pictures, one at each thing's first part (a contraption's: near enough to place it by). */
function imagesOfSnap(snap: Snapshot): GhostImage[] {
  const c = snapCenter(snap);
  const out: GhostImage[] = [];
  for (const s of snap.entities) {
    const def = getItem(s.def);
    const p = s.parts.find((q) => q.hp !== -1);
    if (!def || !p) continue;
    const img = def.preview();
    const w = Number(s.config?.w) > 0 ? Number(s.config!.w) * PX : (img.width - 2) * PX;
    const h = Number(s.config?.h) > 0 ? Number(s.config!.h) * PX : (img.height - 2) * PX;
    out.push({ img, x: p.x - c.x, y: p.y - c.y, a: p.a, w, h, ox: 0, oy: 0, flip: s.flip ? -1 : 1 });
  }
  return out;
}

/**
 * Putting things into the scene: the toybox's item spawned at the cursor (Q
 * facing left, E facing right), pastes and contraptions. While Q, E or V is
 * held a ghost shows where it will go (A/D turn it, R mirrors it; Shift puts it
 * on the grid; with time paused it lines up with what's beside or under it, or
 * the grid with Alt), and it's placed as the key comes up, as People Playground
 * places contraptions. Placing with clicks (Settings: the game's first way), the
 * ghost is always at the cursor, Q/E turn it and a click puts it there.
 * With the Weld tool in hand it's welded to whatever it lands on.
 */
export class Placer {
  ghost: Ghost | null = null;
  /** The ghost's guide lines (see EditOverlay). */
  guides: Guide[] = [];
  /** The grid drawn round the ghost while Shift snaps it to it (see EditOverlay), or null. */
  gridPatch: { at: V2; size: number } | null = null;
  /** Placing with clicks: how the ghost is turned and mirrored, kept from one placed to the next, and for what. */
  private hint = { def: null as ItemDef | null, angle: 0, flip: false };
  /** Pictures of what was last copied (live, so exact). */
  clipImages: GhostImage[] = [];

  constructor(private c: Controls) {}

  /** A key held: the solid ghost of the toybox's item (Q/E) or the clipboard (V); null if there's nothing to place. */
  begin(key: 'spawnLeft' | 'spawnRight' | 'paste'): boolean {
    const c = this.c;
    if (key === 'paste') {
      if (!c.clipboard) {
        c.ui.toast('Nothing copied yet');
        return false;
      }
      this.ghost = { def: null, snap: c.clipboard, label: 'Paste', flip: false, angle: 0, at: { x: c.wx, y: c.wy }, images: this.clipImages, solid: true, key };
      this.frame();
      return true;
    }
    const def = c.armed;
    if (!def) {
      c.ui.toast(`Pick something in the toybox first (${c.bindings.label('toybox') || 'the menu on the left'})`);
      return false;
    }
    this.ghost = this.ghostOf(def, key === 'spawnLeft');
    this.ghost.solid = true;
    this.ghost.key = key;
    this.frame();
    return true;
  }

  private ghostOf(def: ItemDef, left: boolean): Ghost {
    const c = this.c;
    if (def.snapshot) return { def, snap: def.snapshot, label: `Spawn ${def.name}`, flip: left, angle: 0, at: { x: c.wx, y: c.wy }, images: imagesOfSnap(def.snapshot), solid: false, key: null };
    const img = def.preview();
    const cfg = c.armedConfig;
    const w = Number(cfg?.w) > 0 ? Number(cfg!.w) * PX : (img.width - 2) * PX;
    const h = Number(cfg?.h) > 0 ? Number(cfg!.h) * PX : (img.height - 2) * PX;
    return { def, snap: null, label: `Spawn ${def.name}`, flip: left, angle: 0, at: { x: c.wx, y: c.wy }, images: [{ img, x: 0, y: 0, a: 0, w, h, ox: 0, oy: 0, flip: 1 }], solid: false, key: null };
  }

  /** The key let go: placed where the ghost is. */
  end(key: 'spawnLeft' | 'spawnRight' | 'paste'): void {
    const g = this.ghost;
    if (!g || g.key !== key) return;
    this.place();
  }

  /** Places the ghost where it is (and it's gone). */
  place(): Entity[] {
    const g = this.ghost;
    this.ghost = null;
    this.guides = [];
    if (!g) return [];
    const c = this.c;
    let made: Entity[] = [];
    if (g.snap) {
      let snap = g.snap;
      if (g.flip) snap = mirror(snap, snapCenter(snap).x);
      snap = rotateSnap(snap, g.angle);
      made = this.place_(snap, g.label, g.at);
      if (made.length) c.game.sound.place(g.at.x, made[0].parts[0]?.mat.sound ?? 'wood');
      if (made.length && g.def?.snapshot) c.game.stats.add('built');
      this.placedWith(made);
    } else if (g.def) {
      made = this.spawn(g.def, g.flip, g.at, g.angle);
    }
    this.weldIfFixing(made);
    return made;
  }

  cancel(): void {
    this.ghost = null;
    this.guides = [];
  }

  /** A held ghost turned (A/D; Q/E placing with clicks) by `angle`. */
  turn(angle: number): void {
    if (!this.ghost) return;
    this.ghost.angle += angle;
    if (!this.ghost.solid) this.hint.angle = this.ghost.angle;
  }

  /** A held ghost mirrored (R). */
  mirror(): void {
    if (!this.ghost) return;
    this.ghost.flip = !this.ghost.flip;
    if (!this.ghost.solid) this.hint.flip = this.ghost.flip;
  }

  /** Placing with clicks, the ghost at the cursor (the toybox's item, over empty space): a click puts it there. */
  get clickHint(): boolean {
    return this.c.placement === 'click' && !!this.ghost && !this.ghost.solid && this.ghost.def === this.c.armed;
  }

  /** The ghost's box (world) at its middle `at`: its pictures turned. */
  private boxAt(g: Ghost, at: V2): Box {
    const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const cos = Math.cos(g.angle);
    const sin = Math.sin(g.angle);
    for (const im of g.images) {
      const ix = g.flip ? -im.x : im.x;
      const ia = (g.flip ? -im.a : im.a) + g.angle;
      const cx = at.x + ix * cos - im.y * sin;
      const cy = at.y + ix * sin + im.y * cos;
      const ca = Math.abs(Math.cos(ia));
      const sa = Math.abs(Math.sin(ia));
      const hw = (im.w * ca + im.h * sa) / 2;
      const hh = (im.w * sa + im.h * ca) / 2;
      box.x0 = Math.min(box.x0, cx - hw);
      box.x1 = Math.max(box.x1, cx + hw);
      box.y0 = Math.min(box.y0, cy - hh);
      box.y1 = Math.max(box.y1, cy + hh);
    }
    if (!Number.isFinite(box.x0)) return { x0: at.x, y0: at.y, x1: at.x, y1: at.y };
    return box;
  }

  /**
   * Each frame: the ghost follows the cursor (kept out of the ground; with time
   * paused, lined up with what's beside or under it, or on the grid with Alt).
   * Without a key held, a faint one shows what Q/E would spawn there.
   */
  frame(): void {
    const c = this.c;
    this.guides = [];
    this.gridPatch = null;
    let g = this.ghost;
    if (!g || !g.solid) {
      // the faint one: the toybox's item, over empty space (Q/E being the way to spawn, or a click)
      const show = !!c.armed && !c.touchMode && !c.hover && !c.grab && c.tab === 'tools' && c.tool === 'drag' && !c.connect.busy && !c.ui.isMenuOpen();
      if (!show) {
        if (g && !g.solid) this.ghost = null;
        return;
      }
      if (!g || g.def !== c.armed) {
        // (placing with clicks, turned and mirrored as the last of the same was)
        if (this.hint.def !== c.armed) this.hint = { def: c.armed, angle: 0, flip: false };
        const click = c.placement === 'click';
        g = this.ghost = this.ghostOf(c.armed!, click && this.hint.flip);
        if (click) g.angle = this.hint.angle;
      }
    }
    if (c.touchMode && g.solid && !g.key) return;
    this.follow(g, { x: c.wx, y: c.wy });
  }

  /** The ghost's middle to `p`, snapped. */
  follow(g: Ghost, p: V2): void {
    const c = this.c;
    let at = { ...p };
    let box = this.boxAt(g, at);
    // (out of the ground: lifted till its bottom is on it)
    const stand = c.game.env.standAt(at.x, box.y0 + 0.02);
    const lifted = box.y0 < stand;
    if (lifted) {
      at.y += stand - box.y0 + 0.01;
      box = this.boxAt(g, at);
    }
    // Shift: on the grid, time running or not (drawn round it unless hidden: G while placing)
    const st = c.arrange.settings;
    if (c.isHeld('fast')) {
      // (on the floor: the grid line above, not into it)
      at = { x: Math.round(at.x / st.grid) * st.grid, y: (lifted ? Math.ceil : Math.round)(at.y / st.grid - 1e-6) * st.grid };
      if (!st.gridHidden) this.gridPatch = { at, size: st.grid };
    } else if (c.game.paused && g.solid) {
      const s = c.arrange.dragSnap();
      if (s.grid) {
        at = { x: Math.round(at.x / s.gridSize) * s.gridSize, y: Math.round(at.y / s.gridSize) * s.gridSize };
      } else if (s.guides) {
        const r = alignMove(c.game, new Set(), box, s.zoom);
        at = { x: at.x + r.dx, y: at.y + r.dy };
        this.guides = r.guides;
      }
    }
    g.at = at;
  }

  /** A finger's tap on empty space with something to spawn: the ghost shows there (a tap on it again places it). */
  tap(p: V2): void {
    const c = this.c;
    const g = this.ghost;
    if (g && g.solid && !g.key) {
      const b = this.boxAt(g, g.at);
      if (p.x >= b.x0 - 0.1 && p.x <= b.x1 + 0.1 && p.y >= b.y0 - 0.1 && p.y <= b.y1 + 0.1) {
        this.place();
        return;
      }
      this.follow(g, p);
      return;
    }
    if (!c.armed) return;
    const ng = this.ghostOf(c.armed, false);
    ng.solid = true;
    this.ghost = ng;
    this.follow(ng, p);
  }

  /** A ghost a finger put down, waiting for ✓ or a second tap. */
  get waiting(): boolean {
    return !!this.ghost && this.ghost.solid && !this.ghost.key;
  }

  // ---- placing at once (the click placement, the touch bar, tests) ---------------------------

  /** Spawns the toybox's item at the cursor at once (Q facing left, E facing right). */
  spawnArmed(left: boolean): void {
    const c = this.c;
    const def = c.armed;
    if (!def) {
      c.ui.toast(`Pick something in the toybox first (${c.bindings.label('toybox') || 'the menu on the left'})`);
      return;
    }
    if (def.snapshot) {
      // a contraption: the whole group, mirrored to face left
      const snap = left ? mirror(def.snapshot, snapCenter(def.snapshot).x) : def.snapshot;
      const made = this.place_(snap, `Spawn ${def.name}`, { x: c.wx, y: c.wy });
      if (made.length) c.game.sound.place(c.wx, made[0].parts[0]?.mat.sound ?? 'wood');
      if (made.length) c.game.stats.add('built');
      this.placedWith(made);
      this.weldIfFixing(made);
      return;
    }
    this.weldIfFixing(this.spawn(def, left, { x: c.wx, y: c.wy }, 0));
  }

  /** Spawns one thing with its middle at `at` (kept out of the floor and the map's ground). */
  private spawn(def: ItemDef, left: boolean, at: V2, angle: number): Entity[] {
    const c = this.c;
    if (!def.create) return [];
    const cfgH = Number(c.armedConfig?.h);
    const hh = cfgH > 0 ? (cfgH * PX) / 2 : def.halfHeight ?? 0.3;
    // (turned, it may be taller or shorter: the ghost already kept it out of the ground)
    const y = angle ? at.y : Math.max(at.y, c.game.env.standAt(at.x, at.y + hh) + hh + 0.01);
    if (c.net) {
      c.net.send({ op: 'spawn', def: def.id, x: at.x, y, left, config: c.armedConfig, frozen: c.isHeld('freeze'), active: c.isHeld('activate'), ...(angle ? { angle } : {}) });
      this.spawnedWith();
      return [];
    }
    c.history.record(`Spawn ${def.name}`);
    const e = c.game.spawn(def, at.x, y, { flip: left, config: c.armedConfig, ...(angle ? { angle } : {}) });
    if (!e) return [];
    c.created([e]);
    c.game.sound.place(at.x, e.parts[0]?.mat.sound ?? 'wood');
    this.placedWith([e]);
    return [e];
  }

  paste(): void {
    const c = this.c;
    const clip = c.clipboard;
    if (!clip) {
      c.ui.toast('Nothing copied yet');
      return;
    }
    this.place_(clip, 'Paste', { x: c.wx, y: c.wy });
  }

  /** Spawns a group centered on `at` (kept above the floor and out of the ground), selected; returns it. */
  place_(snap: Snapshot, label: string, at: V2): Entity[] {
    const c = this.c;
    const mid = snapCenter(snap);
    const env = c.game.env;
    let dy = Math.max(at.y - mid.y, env.standAt(at.x, mid.minY + at.y - mid.y) + 0.15 - mid.minY);
    // and out of the map's ground (a hill, a roof): lifted till no part's middle is inside it
    for (let k = 0; k < 3; k++) {
      let lift = 0;
      for (const s of snap.entities) for (const p of s.parts) {
        if (p.hp === -1) continue;
        const x = p.x + at.x - mid.x;
        const y = p.y + dy;
        const need = env.standAt(x, y) - y;
        if (need > 0) lift = Math.max(lift, need + 0.1);
      }
      if (!lift) break;
      dy += lift;
    }
    if (c.net) {
      c.net.send({ op: 'place', snap, dx: at.x - mid.x, dy, label, frozen: c.isHeld('freeze'), active: c.isHeld('activate') });
      return [];
    }
    c.history.record(label);
    const made = instantiate(c.game, snap, { dx: at.x - mid.x, dy });
    c.created(made);
    c.selection = new Set(made);
    c.refreshOutlines();
    return made;
  }

  /**
   * Spawning with Z (freeze) held freezes what's spawned, with F held switches it on (a
   * grenade's pin pulled, a gun fired); either key then does nothing of its own
   * when it's let go (see Controls.defers()).
   */
  placedWith(list: Entity[]): void {
    const c = this.c;
    if (!list.length) return;
    if (c.isHeld('freeze')) {
      for (const e of list) e.setFrozen(true);
      c.game.sound.click(c.wx, 0.5);
    }
    if (c.isHeld('activate')) {
      for (const e of list) if (e.activatable && !e.destroyed) e.activate();
    }
    this.spawnedWith();
  }

  /** Z or F held while spawning did their job there: they do nothing more when let go. */
  spawnedWith(): void {
    const c = this.c;
    if (c.isHeld('freeze')) c.deferred.delete('freeze');
    if (c.isHeld('activate')) c.deferred.delete('activate');
  }

  /** Placed with the Weld tool in hand: welded to whatever it's touching. */
  private weldIfFixing(made: Entity[]): void {
    const c = this.c;
    if (!made.length || c.tab !== 'tools' || c.tool !== 'weld') return;
    const near = new Set<Entity>(made);
    for (const e of made) {
      for (const p of e.parts) {
        if (p.destroyed) continue;
        const r = p.reach + 0.1;
        for (const o of c.game.entitiesInRect(p.x - r, p.y - r, p.x + r, p.y + r)) near.add(o);
      }
    }
    if (near.size > made.length) c.arrange.weldTogether([...near], new Set(made));
  }
}

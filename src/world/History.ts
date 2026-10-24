import type { Game } from './Game';
import { capture, instantiate, type SavedConnection, type Snapshot } from './Snapshot';
import type { StainState } from '../systems/Particles';
import type { PuddleState } from '../systems/Puddles';
import type { EntityState } from './types';
import type { MapSpec } from './Maps';

/** How many edits can be undone. */
const LIMIT = 40;
/** Edits of one kind this soon after each other (ms) are one step to undo (A/D turns, nudges, a slider dragged). */
const COALESCE_MS = 700;

interface Entry {
  label: string;
  snap: Snapshot;
  stains: StainState;
  puddles: PuddleState;
  /** The map it was on (undoing a switch of maps, or a load, switches back). */
  map: MapSpec;
  /** Taken as time started again after building (see record()): undoing it pauses time again. */
  paused?: boolean;
  /** Edits of this kind recorded right after it are part of it (see record()). */
  coalesce?: string;
  /** When it was recorded (ms). */
  at: number;
  /** Recorded with time paused (building), not as time started (see rewindDepth). */
  building?: boolean;
  /** An undone edit's flags, which the step redoing it gets back (see redo()). */
  undone?: { paused?: boolean; building?: boolean };
}

export interface RecordOpts {
  /** Edits with the same key, each within a moment of the last, are one step to undo. */
  coalesce?: string;
  /** Time is about to start again: undoing this puts the scene back as it was, paused (see Controls.togglePause()). */
  paused?: boolean;
}

/**
 * Undo/redo for the player's edits (spawning, deleting, connecting, freezing,
 * flipping, ...): before each one the whole scene is captured, and undoing puts
 * it back as it was at that moment: wounds, fire, stains and puddles included.
 * Only things in flight (particles, bullets) are not part of it.
 *
 * Undoing a move or a connection doesn't make the scene again: when nothing but
 * where things are and how they're connected differs, they're put back where
 * they were and the connections patched (see fastRestore()).
 */
export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  /** Something was edited since time was last paused (see record()): starting time again saves a checkpoint. */
  dirtySincePause = false;
  /** How the last undo or redo was done: 'fast' (patched) or 'full' (made again). For tests. */
  lastRestore: 'fast' | 'full' | null = null;

  constructor(private game: Game) {}

  /**
   * Call just before an edit; `label` names it ("Delete", "Spawn Human"). An
   * edit with the same `coalesce` key as the last one, a moment after it, isn't
   * a step of its own: the step before it already holds the scene as it was
   * before them all.
   */
  record(label: string, o: RecordOpts = {}): void {
    // (in someone else's game the edits are the host's, and so is the history)
    if (this.game.net?.guest) return;
    const now = performance.now();
    const last = this.past[this.past.length - 1];
    if (o.coalesce && last && last.coalesce === o.coalesce && now - last.at < COALESCE_MS && !this.future.length) {
      last.at = now;
      this.dirtySincePause ||= this.game.paused;
      return;
    }
    const e = this.capture(label);
    e.at = now;
    if (o.coalesce) e.coalesce = o.coalesce;
    if (o.paused) e.paused = true;
    else {
      this.dirtySincePause ||= this.game.paused;
      if (this.game.paused) e.building = true;
    }
    this.past.push(e);
    if (this.past.length > LIMIT) this.past.shift();
    this.future.length = 0;
  }

  /** Time was paused: edits from now on are building (see dirtySincePause). */
  paused(): void {
    this.dirtySincePause = false;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * How many undos go back to the scene as it was when time last started after
   * building (what was done to it as it ran undone too); 0: there's no such
   * checkpoint, or building has gone on since (see Controls.rewind()).
   */
  get rewindDepth(): number {
    for (let i = this.past.length - 1; i >= 0; i--) {
      const e = this.past[i];
      if (e.paused) return this.past.length - i;
      if (e.building) return 0;
    }
    return 0;
  }

  /** There's a checkpoint to go back to (see rewindDepth). */
  get atCheckpoint(): boolean {
    return this.rewindDepth > 0;
  }

  /** What undo would undo ("Weld ×4"), for the button's tooltip. */
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  /** Puts the scene back as it was before the last edit; returns that edit's label. */
  undo(): string | null {
    const e = this.past.pop();
    if (!e) return null;
    const f = this.capture(e.label);
    f.undone = { paused: e.paused, building: e.building };
    this.future.push(f);
    this.restore(e);
    return e.label;
  }

  /** Redoes the last undone edit; returns its label. */
  redo(): string | null {
    const e = this.future.pop();
    if (!e) return null;
    const back = this.capture(e.label);
    // (redone, a checkpoint is a checkpoint again: undoing it once more goes back to building)
    if (e.undone?.paused) back.paused = true;
    if (e.undone?.building) back.building = true;
    this.past.push(back);
    this.restore(e);
    return e.label;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.dirtySincePause = false;
  }

  private capture(label: string): Entry {
    const g = this.game;
    return { label, snap: capture(g, g.entities, true), stains: g.stains.capture(), puddles: g.puddles.capture(), map: g.map, at: performance.now() };
  }

  private restore(e: Entry): void {
    const g = this.game;
    if (e.paused) g.paused = true;
    if (e.map === g.map && this.fastRestore(e)) {
      this.lastRestore = 'fast';
    } else {
      this.lastRestore = 'full';
      if (e.map !== g.map) g.setMap(e.map, false);
      g.clearAll();
      g.fire.clear();
      // (a nuke's cloud and white-out, or a blast still to go off, belonged to the scene undone)
      g.explosions.clear();
      instantiate(g, e.snap);
    }
    g.stains.restore(e.stains);
    g.puddles.restore(e.puddles);
    // (back to build: the next Play keeps the scene again, to come back to again)
    if (e.paused) this.dirtySincePause = true;
  }

  /**
   * Puts the scene back without making it again, when the same things are in it
   * in the same order and nothing about them but where they are and how they're
   * moving differs (nor their wounds, fire, settings, what they hold): each part
   * is put back where it was, and the connections that differ are taken away or
   * made again. Anything else: false, and it's made again from scratch.
   */
  private fastRestore(e: Entry): boolean {
    const g = this.game;
    const live = g.entities.filter((x) => !x.destroyed);
    const want = e.snap.entities;
    if (live.length !== want.length || live.some((x, i) => x.id !== want[i].uid)) return false;
    // the same things, as they are now
    const now = capture(g, live, true);
    for (let i = 0; i < want.length; i++) if (stateKey(want[i]) !== stateKey(now.entities[i])) return false;
    // put back where they were
    for (let i = 0; i < want.length; i++) {
      const ent = live[i];
      want[i].parts.forEach((ps, k) => {
        const p = ent.parts[k];
        if (!p || p.destroyed || ps.hp === -1) return;
        p.teleport(ps.x, ps.y, ps.a);
        p.body.setLinvel({ x: ps.vx, y: ps.vy }, true);
        p.body.setAngvel(ps.av, true);
        p.sync();
        p.resetInterpolation();
      });
    }
    // and connections: the ones that differ, taken away and made again
    const sigs = new Map<string, number>();
    for (const c of want.length ? e.snap.connections : []) sigs.set(connKey(c), (sigs.get(connKey(c)) ?? 0) + 1);
    const C = g.connections;
    const ours = now.connections;
    const index = new Map(live.map((x, i) => [x, i]));
    // (now.connections lines up with the connections in the list whose ends are both in the scene)
    const listed = C.list.filter((c) => index.has(c.a.entity) && (!c.b || index.has(c.b.entity)));
    const keep = new Set<number>();
    ours.forEach((c, i) => {
      const k = connKey(c);
      const n = sigs.get(k) ?? 0;
      if (n > 0) {
        sigs.set(k, n - 1);
        keep.add(i);
      }
    });
    listed.forEach((c, i) => {
      if (!keep.has(i)) C.remove(c);
    });
    const missing = e.snap.connections.filter((c) => {
      const k = connKey(c);
      const n = sigs.get(k) ?? 0;
      if (n <= 0) return false;
      sigs.set(k, n - 1);
      return true;
    });
    if (missing.length) {
      const made = live.map((x) => x);
      // (put back, not wired by anyone: see Stats)
      g.stats.quiet++;
      for (const c of missing) {
        const pa = made[c.a[0]]?.parts[c.a[1]];
        if (!pa || pa.destroyed) continue;
        const pb = c.b ? made[c.b[0]]?.parts[c.b[1]] : null;
        if (c.b && (!pb || pb.destroyed)) continue;
        const wa = pa.localToWorld(c.la.x, c.la.y);
        const wb = pb ? pb.localToWorld(c.lb.x, c.lb.y) : { ...c.lb };
        const conn = C.create(c.kind, pa, wa, pb ?? null, wb, c.rest, c.limit !== undefined ? { limit: c.limit, ref: c.ref } : undefined, c.stiffness, c.opts);
        if (!conn) continue;
        // (exactly as it was: anchors re-read from the poses could be off by rounding)
        conn.la = { ...c.la };
        conn.lb = { ...c.lb };
        if (c.end) conn.end = { ...c.end };
        if (c.burn) conn.burn = { lo: c.burn[0], hi: c.burn[1] };
        if (c.loose) C.untie(conn);
      }
      g.stats.quiet--;
    }
    return true;
  }
}

/** Everything about an entity's state but where its parts are and how they move. */
function stateKey(s: EntityState): string {
  return JSON.stringify({ ...s, parts: s.parts.map(({ x: _x, y: _y, a: _a, vx: _vx, vy: _vy, av: _av, ...rest }) => rest) });
}

/** A connection as saved, its anchors rounded (to a tenth of a millimetre). */
function connKey(c: SavedConnection): string {
  const r = (v: number | undefined) => (v === undefined ? '' : v.toFixed(4));
  return [c.kind, c.a.join('.'), c.b ? c.b.join('.') : '-', r(c.la.x), r(c.la.y), r(c.lb.x), r(c.lb.y), r(c.rest), r(c.limit), r(c.ref), r(c.stiffness),
    c.end ? `${r(c.end.x)},${r(c.end.y)}` : '', c.burn ? c.burn.map((v) => v.toFixed(4)).join(',') : '', c.loose ? 'L' : '', c.opts ? JSON.stringify(c.opts) : ''].join('|');
}

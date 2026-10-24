import type { Game } from './Game';
import type { Entity } from './Entity';
import type { EntityState, PartState } from './types';
import type { ConnKind, ConnOpts } from '../systems/Connections';
import { getItem } from '../catalog/items';
import type { V2 } from '../engine/math';

export interface SavedConnection {
  kind: ConnKind;
  a: [number, number];
  la: V2;
  b: [number, number] | null;
  /** Local anchor on b, or the world anchor when b is the background. */
  lb: V2;
  rest: number;
  /** A hinge's swing limit (radians either side) and the relative angle it's measured from (see Connection). */
  limit?: number;
  ref?: number;
  /** A spring's stiffness, times the usual (see Connection). */
  stiffness?: number;
  /** A burning fuse cord's burnt stretch, [lo, hi] (see Connection.burn). */
  burn?: [number, number];
  /** A weld's far end, where its rod is drawn to (see Connection.end). */
  end?: V2;
  /** A fuse cord let go of at the end that blew up: it lies loose there, not tied to the background (see Connections.untie()). */
  loose?: boolean;
  /** Its settings from its menu (see ConnOpts); none: the usual. */
  opts?: ConnOpts;
}

/**
 * A group of entities with everything that ties them together: held items,
 * lodged blades (entity links) and ropes/welds/wires between them. Used by
 * save/load, duplicate, copy/paste and flipping.
 */
export interface Snapshot {
  entities: EntityState[];
  connections: SavedConnection[];
}

/**
 * The entities and the connections between them. With `uids` (for undo only,
 * never saved) each entity's state says which entity it was (see History).
 */
export function capture(game: Game, list: Entity[], uids = false): Snapshot {
  const ents = list.filter((e) => !e.destroyed);
  const index = new Map(ents.map((e, i) => [e, i]));
  const ref = (e: Entity) => index.get(e) ?? -1;
  // (one of them layered by hand: every one's depth, so their order among themselves is kept: see instantiateIndexed())
  const depths = ents.some((e) => e.layered);
  const entities = ents.map((e) => {
    const s = e.serialize();
    const links = e.serializeLinks(ref);
    const out = links ? { ...s, links } : s;
    if (uids) out.uid = e.id;
    if (depths) out.z = e.zBase;
    return out;
  });
  const connections: SavedConnection[] = [];
  for (const c of game.connections.list) {
    const ai = index.get(c.a.entity);
    if (ai === undefined) continue;
    const a: [number, number] = [ai, c.a.entity.parts.indexOf(c.a)];
    let b: [number, number] | null = null;
    if (c.b) {
      const bi = index.get(c.b.entity);
      if (bi === undefined) continue;
      b = [bi, c.b.entity.parts.indexOf(c.b)];
    }
    const lim = c.limit !== undefined ? { limit: c.limit, ref: c.ref } : {};
    const stiff = c.stiffness !== undefined ? { stiffness: c.stiffness } : {};
    const burn = c.burn ? { burn: [c.burn.lo, c.burn.hi] as [number, number] } : {};
    const loose = c.kind === 'fuse' && !c.b && !c.joint ? { loose: true } : {};
    const end = c.end ? { end: { ...c.end } } : {};
    const opts = c.opts ? { opts: { ...c.opts } } : {};
    connections.push({ kind: c.kind, a, la: { ...c.la }, b, lb: { ...c.lb }, rest: c.rest, ...lim, ...stiff, ...burn, ...loose, ...end, ...opts });
  }
  return { entities, connections };
}

export interface PlaceOpts {
  dx?: number;
  dy?: number;
}

/** Spawns a snapshot back into the world (optionally offset). */
export function instantiate(game: Game, snap: Snapshot, o: PlaceOpts = {}): Entity[] {
  return instantiateIndexed(game, snap, o).filter((e): e is Entity => !!e && !e.destroyed);
}

/** Like instantiate, but the result lines up with snap.entities (null where spawning failed). */
export function instantiateIndexed(game: Game, snap: Snapshot, o: PlaceOpts = {}): (Entity | null)[] {
  // (made again from a save, an undo or a paste: not spawned, nor wired, by anyone just now)
  game.stats.quiet++;
  try {
    return instantiateQuietly(game, snap, o);
  } finally {
    game.stats.quiet--;
  }
}

function instantiateQuietly(game: Game, snap: Snapshot, o: PlaceOpts): (Entity | null)[] {
  const dx = o.dx ?? 0;
  const dy = o.dy ?? 0;
  const move = (p: PartState): PartState => ({ ...p, x: p.x + dx, y: p.y + dy });
  const made: (Entity | null)[] = snap.entities.map((s) => {
    const def = getItem(s.def);
    if (!def) return null;
    const p0 = s.parts.find((p) => p.hp !== -1) ?? s.parts[0];
    const e = game.spawn(def, p0.x + dx, p0.y + dy, { flip: s.flip, config: s.config });
    e?.restore({ ...s, parts: s.parts.map(move) });
    return e;
  });
  // depths set by hand (Bring to front...): in the same order among themselves, fresh, so over what's there already as anything new is
  const deep = made.flatMap((e, i) => (e && Number.isFinite(snap.entities[i].z) ? [{ e, z: snap.entities[i].z! }] : []));
  if (deep.length) {
    deep.sort((a, b) => a.z - b.z);
    for (const { e } of deep) e.setDepth(game.allocZ());
  }
  const get = (i: number) => (i >= 0 ? made[i] ?? undefined : undefined);
  snap.entities.forEach((s, i) => {
    const e = made[i];
    if (e && !e.destroyed && s.links) e.restoreLinks(s.links, get);
  });
  for (const c of snap.connections) {
    const ea = made[c.a[0]];
    const pa = ea?.parts[c.a[1]];
    if (!ea || !pa || pa.destroyed) continue;
    let pb = null;
    if (c.b) {
      const eb = made[c.b[0]];
      pb = eb?.parts[c.b[1]] ?? null;
      if (!pb || pb.destroyed) continue;
    }
    const wa = pa.localToWorld(c.la.x, c.la.y);
    const wb = pb ? pb.localToWorld(c.lb.x, c.lb.y) : { x: c.lb.x + dx, y: c.lb.y + dy };
    const conn = game.connections.create(c.kind, pa, wa, pb, wb, c.rest, c.limit !== undefined ? { limit: c.limit, ref: c.ref } : undefined, c.stiffness, c.opts);
    if (conn && c.burn) conn.burn = { lo: c.burn[0], hi: c.burn[1] };
    if (conn && c.end) conn.end = pb ? { ...c.end } : { x: c.end.x + dx, y: c.end.y + dy };
    if (conn && c.loose) game.connections.untie(conn);
  }
  return made.map((e) => (e && !e.destroyed ? e : null));
}

/** Connection kinds that pin a point in place (their background anchor moves with the mirror). */
const RIGID = new Set<ConnKind>(['weld', 'hinge', 'pin']);

/** A local anchor on a mirrored part: the part's frame is mirrored about its own y axis. */
export const mirrorLocal = (l: V2): V2 => ({ x: -l.x, y: l.y });

/**
 * The links that survive mirroring: grips (re-made at the hands anyway), who's
 * fighting whom (flipping both fighters, they fight on) and who sits in a
 * vehicle's seats (sat down again in them). A lodged blade comes out: where it
 * went in isn't mirrored.
 */
function mirrorLinks(l: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!l || (!l.grips && l.foe === undefined && !l.seats)) return undefined;
  const out: Record<string, unknown> = {};
  if (l.grips) out.grips = l.grips;
  if (l.foe !== undefined) out.foe = l.foe;
  if (l.seats) out.seats = l.seats;
  return out;
}

/** Mirrors a snapshot left-right around x = cx. */
export function mirror(snap: Snapshot, cx: number): Snapshot {
  return {
    entities: snap.entities.map((s) => ({
      ...s,
      links: mirrorLinks(s.links),
      flip: !s.flip,
      parts: s.parts.map((p) => ({ ...p, x: 2 * cx - p.x, a: -p.a, vx: -p.vx, av: -p.av })),
    })),
    connections: snap.connections.map((c) => ({
      ...c,
      la: mirrorLocal(c.la),
      // ropes and springs keep hanging from the same spot; pins and welds to the
      // background follow the object
      lb: c.b ? mirrorLocal(c.lb) : RIGID.has(c.kind) ? { x: 2 * cx - c.lb.x, y: c.lb.y } : { ...c.lb },
      ...(c.end ? { end: c.b ? mirrorLocal(c.end) : { x: 2 * cx - c.end.x, y: c.end.y } } : {}),
      // (mirroring turns every angle the other way)
      ...(c.ref !== undefined ? { ref: -c.ref } : {}),
    })),
  };
}

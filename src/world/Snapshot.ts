import type { Game } from './Game';
import type { Entity } from './Entity';
import type { EntityState, PartState } from './types';
import type { ConnKind } from '../systems/Connections';
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

export function capture(game: Game, list: Entity[]): Snapshot {
  const ents = list.filter((e) => !e.destroyed);
  const index = new Map(ents.map((e, i) => [e, i]));
  const ref = (e: Entity) => index.get(e) ?? -1;
  const entities = ents.map((e) => {
    const s = e.serialize();
    const links = e.serializeLinks(ref);
    return links ? { ...s, links } : s;
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
    connections.push({ kind: c.kind, a, la: { ...c.la }, b, lb: { ...c.lb }, rest: c.rest });
  }
  return { entities, connections };
}

export interface PlaceOpts {
  dx?: number;
  dy?: number;
}

/** Spawns a snapshot back into the world (optionally offset). */
export function instantiate(game: Game, snap: Snapshot, o: PlaceOpts = {}): Entity[] {
  const dx = o.dx ?? 0;
  const dy = o.dy ?? 0;
  const move = (p: PartState): PartState => ({ ...p, x: p.x + dx, y: p.y + dy });
  const made: (Entity | null)[] = snap.entities.map((s) => {
    const def = getItem(s.def);
    if (!def) return null;
    const p0 = s.parts.find((p) => p.hp !== -1) ?? s.parts[0];
    const e = game.spawn(def, p0.x + dx, p0.y + dy, { flip: s.flip });
    e?.restore({ ...s, parts: s.parts.map(move) });
    return e;
  });
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
    game.connections.create(c.kind, pa, wa, pb, wb, c.rest);
  }
  return made.filter((e): e is Entity => !!e && !e.destroyed);
}

/** Mirrors a snapshot left-right around x = cx (connections are dropped). */
export function mirror(snap: Snapshot, cx: number): Snapshot {
  return {
    entities: snap.entities.map((s) => ({
      ...s,
      // only grips survive mirroring (they are re-made at the hands anyway)
      links: s.links?.grips ? { grips: s.links.grips } : undefined,
      flip: !s.flip,
      parts: s.parts.map((p) => ({ ...p, x: 2 * cx - p.x, a: -p.a, vx: -p.vx, av: -p.av })),
    })),
    connections: [],
  };
}

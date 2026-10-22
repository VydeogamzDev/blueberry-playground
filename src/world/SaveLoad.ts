import type { Game } from './Game';
import type { EntityState } from './types';
import type { ConnKind } from '../systems/Connections';
import { getItem } from '../catalog/items';
import type { V2 } from '../engine/math';

interface SavedConnection {
  kind: ConnKind;
  a: [number, number];
  la: V2;
  b: [number, number] | null;
  lb: V2;
  rest: number;
}

interface SaveData {
  version: 1;
  entities: EntityState[];
  connections: SavedConnection[];
  camera: { x: number; y: number; zoom: number };
}

export function saveToString(game: Game): string {
  const ents = game.entities.filter((e) => !e.destroyed);
  const index = new Map(ents.map((e, i) => [e, i]));
  const conns: SavedConnection[] = [];
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
    conns.push({ kind: c.kind, a, la: c.la, b, lb: c.lb, rest: c.rest });
  }
  const r = game.renderer;
  const data: SaveData = {
    version: 1,
    entities: ents.map((e) => e.serialize()),
    connections: conns,
    camera: { x: r.camX, y: r.camY, zoom: r.zoom },
  };
  return JSON.stringify(data);
}

export function loadFromString(game: Game, json: string): void {
  const data = JSON.parse(json) as SaveData;
  if (!data || data.version !== 1 || !Array.isArray(data.entities)) throw new Error('Unrecognized save format');
  game.clearAll();
  const made = data.entities.map((s) => {
    const def = getItem(s.def);
    if (!def) return null;
    const p0 = s.parts.find((p) => p.hp !== -1) ?? s.parts[0];
    const e = game.spawn(def, p0.x, p0.y, { flip: s.flip });
    e?.restore(s);
    return e;
  });
  for (const c of data.connections ?? []) {
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
    const wb = pb ? pb.localToWorld(c.lb.x, c.lb.y) : c.lb;
    game.connections.create(c.kind, pa, wa, pb, wb, c.rest);
  }
  if (data.camera) {
    game.renderer.camX = data.camera.x;
    game.renderer.camY = data.camera.y;
    game.renderer.zoom = data.camera.zoom;
  }
}

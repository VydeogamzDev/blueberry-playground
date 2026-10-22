import type { Game } from './Game';
import { capture, instantiate, type Snapshot } from './Snapshot';
import { arrayToBase64, fromBase64 } from '../engine/base64';

/** Stains (see StainState), their arrays as base64. */
interface SavedStains {
  n: number;
  head: number;
  xy: string;
  rgba: string;
}

/** Puddles (see PuddleState), their arrays as base64. */
interface SavedPuddles {
  lo: number;
  hi: number;
  h: string;
  kind: string;
  burn: string;
}

interface SaveData extends Snapshot {
  version: 1;
  camera: { x: number; y: number; zoom: number };
  /** The floor's stains and puddles (saves from before they were kept have none). */
  stains?: SavedStains;
  puddles?: SavedPuddles;
}

export function saveToString(game: Game): string {
  const r = game.renderer;
  const st = game.stains.capture();
  const pu = game.puddles.capture();
  const data: SaveData = {
    version: 1,
    ...capture(game, game.entities),
    camera: { x: r.camX, y: r.camY, zoom: r.zoom },
    stains: { n: st.n, head: st.head, xy: arrayToBase64(st.xy), rgba: arrayToBase64(st.rgba) },
    puddles: { lo: pu.lo, hi: pu.hi, h: arrayToBase64(pu.h), kind: arrayToBase64(pu.kind), burn: arrayToBase64(pu.burn) },
  };
  return JSON.stringify(data);
}

export function loadFromString(game: Game, json: string): void {
  const data = JSON.parse(json) as SaveData;
  if (!data || data.version !== 1 || !Array.isArray(data.entities)) throw new Error('Unrecognized save format');
  game.clearAll();
  game.fire.clear();
  instantiate(game, { entities: data.entities, connections: data.connections ?? [] });
  const st = data.stains;
  if (st) {
    const xy = new Int16Array(fromBase64(st.xy).buffer);
    const rgba = fromBase64(st.rgba);
    game.stains.restore({ n: Math.min(st.n, xy.length / 2, rgba.length / 4), head: st.head, xy, rgba });
  } else game.stains.clear();
  const pu = data.puddles;
  if (pu) {
    game.puddles.restore({ lo: pu.lo, hi: pu.hi, h: new Float32Array(fromBase64(pu.h).buffer), kind: fromBase64(pu.kind), burn: new Float32Array(fromBase64(pu.burn).buffer) });
  } else game.puddles.clear();
  if (data.camera) {
    game.renderer.camX = data.camera.x;
    game.renderer.camY = data.camera.y;
    game.renderer.zoom = data.camera.zoom;
  }
}

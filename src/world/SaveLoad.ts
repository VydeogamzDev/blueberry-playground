import type { Game } from './Game';
import type { Entity } from './Entity';
import { capture, instantiateIndexed, type Snapshot } from './Snapshot';
import { arrayToBase64, fromBase64 } from '../engine/base64';
import { LAB, sameMap, validateMap, type MapSpec } from './Maps';
import type { WeatherState } from '../systems/Weather';

/** Stains (see StainState), their arrays as base64. */
interface SavedStains {
  n: number;
  head: number;
  xy: string;
  /** xy in 32 bits, not 16 (a map too wide for 16: the endless plate). */
  wide?: boolean;
  rgba: string;
}

/** Puddles (see PuddleState), their arrays as base64. */
interface SavedPuddles {
  lo: number;
  hi: number;
  h: string;
  kind: string;
  burn: string;
  /** (saves from before oil floated on water have none) */
  oil?: string;
}

/** Water (see FluidState): each particle's x, y, vx, vy as float32s, in base64. */
interface SavedFluid {
  n: number;
  xv: string;
}

interface SaveData extends Snapshot {
  version: 1;
  camera: { x: number; y: number; zoom: number };
  /** The floor's stains and puddles (saves from before they were kept have none). */
  stains?: SavedStains;
  puddles?: SavedPuddles;
  /** The water (saves from before water flowed have none). */
  fluid?: SavedFluid;
  /** The map, in full, so that a custom one travels with the save (saves from before maps have none: the lab). */
  map?: MapSpec;
  /** The weather and the world's light (saves from before weather have none: it's left as it is). */
  weather?: WeatherState;
}

export function saveToString(game: Game): string {
  const r = game.renderer;
  const st = game.stains.capture();
  const pu = game.puddles.capture();
  const fl = game.fluid.capture();
  const data: SaveData = {
    version: 1,
    ...capture(game, game.entities),
    camera: { x: r.camX, y: r.camY, zoom: r.zoom },
    stains: { n: st.n, head: st.head, xy: arrayToBase64(st.xy), ...(st.xy instanceof Int32Array ? { wide: true } : {}), rgba: arrayToBase64(st.rgba) },
    puddles: { lo: pu.lo, hi: pu.hi, h: arrayToBase64(pu.h), kind: arrayToBase64(pu.kind), burn: arrayToBase64(pu.burn), ...(pu.oil ? { oil: arrayToBase64(pu.oil) } : {}) },
    ...(fl.n ? { fluid: { n: fl.n, xv: arrayToBase64(fl.xv) } } : {}),
    map: game.map,
    weather: { ...game.weather.state },
  };
  return JSON.stringify(data);
}

/**
 * Replaces the scene with a saved one; returns what was made, in the save's
 * order (null where something couldn't be). `camera: false` keeps the view.
 */
export function loadFromString(game: Game, json: string, o: { camera?: boolean } = {}): (Entity | null)[] {
  const data = JSON.parse(json) as SaveData;
  if (!data || data.version !== 1 || !Array.isArray(data.entities)) throw new Error('Unrecognized save format');
  // the map first: a scene saved on another one switches to it
  const map = (data.map && validateMap(data.map)) || LAB;
  if (!sameMap(game.map, map)) game.setMap(map, !data.camera || o.camera === false);
  if (data.weather) game.weather.apply(data.weather);
  game.clearAll();
  game.fire.clear();
  game.explosions.clear();
  const made = instantiateIndexed(game, { entities: data.entities, connections: data.connections ?? [] });
  // (the camera before the puddles: on an endless map, those kept are those around it)
  if (data.camera && o.camera !== false) {
    game.renderer.camX = data.camera.x;
    game.renderer.camY = data.camera.y;
    game.renderer.zoom = data.camera.zoom;
  }
  const st = data.stains;
  if (st) {
    const bytes = fromBase64(st.xy).buffer;
    const xy = st.wide ? new Int32Array(bytes) : new Int16Array(bytes);
    const rgba = fromBase64(st.rgba);
    game.stains.restore({ n: Math.min(st.n, xy.length / 2, rgba.length / 4), head: st.head, xy, rgba });
  } else game.stains.clear();
  const pu = data.puddles;
  if (pu) {
    const oil = pu.oil ? new Float32Array(fromBase64(pu.oil).buffer) : undefined;
    game.puddles.restore({ lo: pu.lo, hi: pu.hi, h: new Float32Array(fromBase64(pu.h).buffer), kind: fromBase64(pu.kind), burn: new Float32Array(fromBase64(pu.burn).buffer), oil });
  } else game.puddles.clear();
  const fl = data.fluid;
  if (fl?.n) game.fluid.restore({ n: fl.n, xv: new Float32Array(fromBase64(fl.xv).buffer) });
  else game.fluid.clear();
  return made;
}

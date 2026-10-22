import type { Game } from './Game';
import { capture, instantiate, type Snapshot } from './Snapshot';

interface SaveData extends Snapshot {
  version: 1;
  camera: { x: number; y: number; zoom: number };
}

export function saveToString(game: Game): string {
  const r = game.renderer;
  const data: SaveData = {
    version: 1,
    ...capture(game, game.entities),
    camera: { x: r.camX, y: r.camY, zoom: r.zoom },
  };
  return JSON.stringify(data);
}

export function loadFromString(game: Game, json: string): void {
  const data = JSON.parse(json) as SaveData;
  if (!data || data.version !== 1 || !Array.isArray(data.entities)) throw new Error('Unrecognized save format');
  game.clearAll();
  instantiate(game, { entities: data.entities, connections: data.connections ?? [] });
  if (data.camera) {
    game.renderer.camX = data.camera.x;
    game.renderer.camY = data.camera.y;
    game.renderer.zoom = data.camera.zoom;
  }
}

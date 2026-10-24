import type { Game } from '../world/Game';
import type { Controls, TerrainEditor } from './Controls';
import type { ShapeForm } from '../entities/Shape';
import type { V2 } from '../engine/math';
import type { Pt } from '../engine/geometry';
import { PX } from '../engine/constants';
import { cleanPieces, contains, isBuiltin, MAP_LIMITS, newMapId, type TerrainMat, type TerrainPiece } from '../world/Maps';

/**
 * The Terrain tool. While a map is edited, what the Shape tool draws (a box
 * dragged out, round with Shift, or an outline clicked out) becomes ground of the
 * map rather than a thing, and a right click on ground (or a click with the
 * Remove tool) takes that piece away. The scene stays as it is. A built-in map
 * becomes a custom copy of it at its first change.
 */
export class TerrainTool implements TerrainEditor {
  /** What the ground drawn is made of. */
  mat: TerrainMat = 'ground';
  /** The map has been changed since editing began. */
  changed = false;
  /** Called when editing ends. */
  onStop: (() => void) | null = null;

  constructor(private game: Game, private controls: Controls) {}

  /** Is the map being edited (with this tool)? */
  get active(): boolean {
    return this.controls.terrain === this;
  }

  /** Starts editing the map in play: the Shape tool draws ground. */
  start(): void {
    if (this.active) return;
    this.controls.terrain?.stop();
    this.changed = false;
    this.controls.terrain = this;
    this.controls.cancelDraft();
    this.controls.setTool('shape');
  }

  /** Ends editing: the Shape tool draws things again. */
  stop(): void {
    if (!this.active) return;
    this.controls.terrain = null;
    this.controls.cancelDraft();
    if (this.controls.tool === 'shape') this.controls.setTool('drag');
    this.onStop?.();
  }

  make(form: ShapeForm, pts: V2[]): void {
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    let outline: Pt[];
    if (form === 'poly') outline = pts.map((p): Pt => [p.x, p.y]);
    else if (form === 'round') {
      const n = 20;
      outline = Array.from({ length: n }, (_, i): Pt => {
        const a = (i / n) * Math.PI * 2;
        return [(x0 + x1) / 2 + (Math.cos(a) * (x1 - x0)) / 2, (y0 + y1) / 2 + (Math.sin(a) * (y1 - y0)) / 2];
      });
    } else outline = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const map = this.game.map;
    // (a concave outline comes back as several convex pieces)
    const made = x1 - x0 < PX * 2 || y1 - y0 < PX * 2 ? [] : cleanPieces([{ pts: outline, mat: this.mat }], map.width, map.height);
    if (!made.length) {
      this.controls.ui.toast('Too thin to make');
      return;
    }
    if (map.terrain.length + made.length > MAP_LIMITS.pieces) {
      this.controls.ui.toast(`A map holds at most ${MAP_LIMITS.pieces} pieces of ground`);
      return;
    }
    this.reshape([...map.terrain, ...made], 'Draw ground');
    this.wake(x0, y0, x1, y1);
    this.game.sound.place((x0 + x1) / 2, 'stone');
  }

  removeAt(x: number, y: number): boolean {
    const terrain = this.game.map.terrain;
    // (a few screen pixels' slop round its edge)
    const slop = 4 / this.game.renderer.zoom;
    for (let i = terrain.length - 1; i >= 0; i--) {
      const pts = terrain[i].pts;
      if (!contains(pts, x, y, slop)) continue;
      this.reshape(terrain.filter((_, k) => k !== i), 'Remove ground');
      // what lay on it falls
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      this.wake(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      this.game.sound.place(x, 'stone');
      return true;
    }
    return false;
  }

  /**
   * The map in play with this ground instead (an edit `label` names for undo,
   * which puts the ground back with the scene): a built-in map is copied (a
   * custom one) the first time it's changed.
   */
  private reshape(terrain: TerrainPiece[], label: string): void {
    const map = this.game.map;
    const copy = isBuiltin(map) ? { id: newMapId(), name: `${map.name} (edited)` } : {};
    this.controls.history.record(label);
    this.controls.reshapeMap({ ...map, ...copy, terrain });
    this.changed = true;
  }

  /** Wakes whatever is near ground just laid or taken away (asleep, it wouldn't notice). */
  private wake(x0: number, y0: number, x1: number, y1: number): void {
    for (const e of this.game.entitiesInRect(x0 - 1, y0 - 1, x1 + 1, y1 + 1)) {
      for (const p of e.parts) if (!p.destroyed && !p.frozen) p.body.wakeUp();
    }
  }
}

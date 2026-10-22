import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Entity } from '../world/Entity';
import type { SpawnOptions } from '../world/types';
import { getItem, ITEMS } from '../catalog/items';

/**
 * Scripted-interaction helpers exposed as `window.bp.kit` for automated testing
 * in the browser. Coordinates are world meters; time is simulated seconds.
 */
export function makeTestKit(game: Game, controls: Controls) {
  const cv = game.renderer.canvas;
  const r = game.renderer;
  const ev = (type: string, x: number, y: number, button = 0, target: EventTarget = cv, extra: PointerEventInit = {}) => {
    const s = r.worldToScreen(x, y);
    target.dispatchEvent(new PointerEvent(type, {
      clientX: s.x, clientY: s.y, button, buttons: type === 'pointerup' ? 0 : 1 << button, bubbles: true, pointerId: 1, ...extra,
    }));
  };
  const kit = {
    items: () => ITEMS.map((i) => i.id),
    reset(): void {
      game.resetEnvironment();
      controls.clearSelection();
      controls.arm(null);
      controls.history.clear();
      game.paused = false;
      game.timeScale = 1;
    },
    spawn(id: string, x: number, y: number, opts: SpawnOptions = {}): Entity {
      const def = getItem(id);
      if (!def) throw new Error('unknown item ' + id);
      return game.spawn(def, x, y, opts)!;
    },
    advance(seconds: number): void {
      game.advance(seconds);
    },
    /**
     * Runs `fn` with the game's frame loop held still, at the short step. Left
     * running, the loop steps the scene in real time whenever `fn` waits (by
     * however long that takes), and may pick the longer step for it.
     */
    async still<T>(fn: () => Promise<T>): Promise<T> {
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      // (the frame already asked for still runs, once)
      await new Promise((res) => setTimeout(res, 50));
      game.resetStep();
      try {
        return await fn();
      } finally {
        window.requestAnimationFrame = raf;
        const loop = game as unknown as { loop: FrameRequestCallback; lastTime: number };
        loop.lastTime = performance.now();
        window.requestAnimationFrame(loop.loop);
      }
    },
    down(x: number, y: number, button = 0, extra: PointerEventInit = {}): void {
      ev('pointerdown', x, y, button, cv, extra);
    },
    move(x: number, y: number): void {
      ev('pointermove', x, y, 0, window);
    },
    up(x: number, y: number, button = 0): void {
      ev('pointerup', x, y, button, window);
    },
    key(code: string, down = true, extra: KeyboardEventInit = {}): void {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, ...extra }));
    },
    press(code: string, extra: KeyboardEventInit = {}): void {
      kit.key(code, true, extra);
      kit.key(code, false, extra);
    },
    /** Drags from a point to another over `seconds`, then holds for `hold` seconds and releases. */
    drag(x0: number, y0: number, x1: number, y1: number, seconds = 0.5, hold = 0.5, release = true): void {
      kit.down(x0, y0);
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        kit.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        game.advance(seconds / n);
      }
      game.advance(hold);
      if (release) kit.up(x1, y1);
    },
    pose(e: Entity): [string, number, number, number][] {
      return e.parts.map((p) => [p.name, +p.x.toFixed(3), +p.y.toFixed(3), +p.a.toFixed(3)]);
    },
    /** Max |velocity| over all parts (stability probe). */
    maxSpeed(): number {
      let m = 0;
      for (const e of game.entities) for (const p of e.parts) if (!p.destroyed) m = Math.max(m, Math.hypot(p.vx, p.vy));
      return m;
    },
    lowestPoint(): number {
      let m = Infinity;
      for (const e of game.entities) for (const p of e.parts) if (!p.destroyed) m = Math.min(m, p.y);
      return m;
    },
    view(x: number, y: number, zoom = 64): void {
      r.camX = x;
      r.camY = y;
      r.zoom = zoom;
      game.renderFrame(1 / 60, 1);
    },
  };
  return kit;
}

import Peer from 'peerjs';
import type { DesktopBridge } from '../engine/Desktop';
import type { Game } from '../world/Game';
import type { UI } from '../ui/UI';
import { fpsLimit } from '../engine/Graphics';
import { rapierBuild } from '../engine/Physics';
import { store } from '../engine/Store';
import { sync } from '../engine/Sync';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Two peers in this page meet through the PeerJS server and pass a message over WebRTC, as two players' games do. */
function peerCheck(): Promise<string> {
  return new Promise((done) => {
    const a = new Peer({ debug: 0 });
    const b = new Peer({ debug: 0 });
    const end = (r: string) => {
      clearTimeout(timer);
      a.destroy();
      b.destroy();
      done(r);
    };
    const timer = setTimeout(() => end('FAILED: no message in 20 s'), 20000);
    for (const p of [a, b]) p.on('error', (e) => end(`FAILED: ${e.type}`));
    a.on('connection', (c) => c.on('data', (d) => end(d === 'hi' ? 'ok (a message over WebRTC, met through the PeerJS server)' : `FAILED: got ${String(d)}`)));
    let open = 0;
    const go = () => {
      if (++open < 2) return;
      const c = b.connect(a.id, { reliable: true });
      c.on('open', () => c.send('hi'));
    };
    a.on('open', go);
    b.on('open', go);
  });
}

/**
 * The desktop app checking itself (npm run desktop -- --smoke): that the game
 * started, how many frames a second it draws at the cap asked for (under the
 * main menu, then in the sandbox, and with --bench a crowd of 100 at real
 * time, as npm run bench -- --live times it in a browser), that a save goes
 * to disk and through the sync folder and back, and that multiplayer's
 * connections can be made from the app. The app prints the report
 * and quits (see desktop/main.cjs; its data and sync folders are temporary then).
 */
export async function desktopSmoke(d: DesktopBridge, game: Game, ui: UI, bootMs: number): Promise<void> {
  const report: Record<string, unknown> = { app: d.version, electron: d.electron, chrome: d.chrome, displayHz: d.displayHz, uncapped: d.uncapped, bootMs: Math.round(bootMs), rapier: rapierBuild };
  /** Frames drawn a second, over `ms`. */
  const fps = async (ms = 3000) => {
    let n = 0;
    const count = () => void n++;
    game.frameHandlers.push(count);
    const t0 = performance.now();
    await wait(ms);
    game.frameHandlers.splice(game.frameHandlers.indexOf(count), 1);
    return Math.round((n * 1000) / (performance.now() - t0));
  };
  try {
    const cap = d.smoke?.fps ?? 'display';
    report.cap = cap;
    game.fpsCap = fpsLimit(cap);
    const gl = game.renderer.gl.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    report.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    game.sound.muted = true;
    await wait(1500);
    report.fpsMenu = await fps();
    ui.mainMenu.close();
    report.fpsSandbox = await fps();
    if (d.uncapped && game.fpsCap > game.displayHz) {
      // (the browser's way past the refresh, for comparison: a message loop between the animation frames)
      game.unthrottled = false;
      report.fpsSandboxMessageLoop = await fps();
      game.unthrottled = true;
    }
    if (d.smoke?.bench) {
      const bench = (window as unknown as { bp: { benchLive(only: string, n: number, windows: number): Promise<{ windows: { speed: number; fps: number; step: number }[] }[]> } }).bp;
      const [pile] = await bench.benchLive('pile', 100, 4);
      report.pile100 = pile.windows.map((w) => `${w.speed}%/${w.fps}fps/${w.step}ms`).join(' ');
    }

    // a save, written to the app's file on disk and read back from it
    const key = 'blueberry-smoke';
    const value = `check ${Math.random().toString(36).slice(2)}`;
    const t0 = performance.now();
    store.setItem(key, value);
    store.flush();
    report.store = d.store.readBack(key) === value ? `ok (${store.kind}, ${(performance.now() - t0).toFixed(1)} ms)` : 'FAILED: not read back from disk';
    // and through the sync folder
    await sync.sync();
    const file = await d.sync.read();
    report.sync = file?.includes(value) ? `ok (${sync.status.folder})` : `FAILED: ${sync.status.error || 'not in the sync file'}`;
    store.removeItem(key);
    store.flush();
    report.multiplayer = await peerCheck();
  } catch (e) {
    report.error = String(e);
  }
  d.smokeDone(report);
}

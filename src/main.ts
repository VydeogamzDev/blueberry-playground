// the interface's pixel fonts, bundled (the standalone page is played offline)
import '@fontsource/dotgothic16/latin-400.css';
import '@fontsource/dotgothic16/latin-ext-400.css';
import '@fontsource/tiny5/latin-400.css';
import '@fontsource/tiny5/latin-ext-400.css';
import './style.css';
// (no browser zoom at a double tap, text selection or long-press menus over the game: the Game Interaction Protection Kit)
import './interaction-protection/game-interaction-protection.css';
import { installGameInteractionProtection } from './interaction-protection/game-interaction-protection.js';
import { offline } from './engine/Offline';
import { initPhysics, RAPIER, rapierBuild } from './engine/Physics';
import { Game } from './world/Game';
import { rehearseCrush } from './world/Warmup';
import { Controls, DRAG } from './tools/Controls';
import { UI } from './ui/UI';
import { registerAll } from './catalog/registry';
import { getItem, ITEMS } from './catalog/items';
import { makeTestKit } from './debug/testkit';
import { makeSelfTest } from './debug/selftest';
import { makeBench, makeLiveBench } from './debug/bench';
import { makeMixCheck } from './debug/mixcheck';
import { BALANCE, GAIT } from './entities/Human';
import { desktop } from './engine/Desktop';
import { sync } from './engine/Sync';
import { desktopSmoke } from './debug/smoke';

/**
 * The loading screen (in index.html): says what's being done and moves the bar
 * to `done` (0..1), then waits for it to be drawn before the next step holds
 * the page up. (A tab in the background draws nothing: it doesn't wait long.)
 */
function loading(step: string, done: number): Promise<void> {
  const el = document.getElementById('loading');
  const text = el?.querySelector('.ld-step');
  const bar = el?.querySelector<HTMLElement>('.ld-bar i');
  if (text) text.textContent = step;
  if (bar) bar.style.width = `${Math.round(done * 100)}%`;
  return new Promise((res) => {
    requestAnimationFrame(() => setTimeout(res, 0));
    setTimeout(res, 100);
  });
}

async function boot(): Promise<void> {
  const booted = performance.now();
  installGameInteractionProtection({ root: document.getElementById('app') });
  await loading('Starting the physics engine…', 0.1);
  // the saves the other version (browser or desktop) made, merged in meanwhile: before anything reads them
  const synced = sync.start();
  await initPhysics();
  await loading('Drawing the toys…', 0.3);
  registerAll();
  // every toybox picture now, a slice at a time, rather than each shelf's as it's first opened
  for (let i = 0; i < ITEMS.length; ) {
    const t0 = performance.now();
    while (i < ITEMS.length && performance.now() - t0 < 12) ITEMS[i++].preview();
    await loading(`Drawing the toys… ${i} / ${ITEMS.length}`, 0.3 + 0.45 * (i / ITEMS.length));
  }
  await loading('Building the sandbox…', 0.8);
  await synced;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas);
  if (desktop) {
    // (its animation frames may run unthrottled: the screen's refresh is told, not measured)
    game.setDisplayHz(desktop.displayHz);
    game.unthrottled = desktop.uncapped;
    desktop.onDisplayHz((hz) => game.setDisplayHz(hz));
  }
  // a crush rehearsed out of sight, so the player's first isn't the slowest (see world/Warmup; ?nowarm: not)
  let warmMs = 0;
  if (!new URLSearchParams(location.search).has('nowarm')) {
    await loading('Warming up…', 0.84);
    const t = performance.now();
    await rehearseCrush(game, () => loading('Warming up…', 0.86));
    warmMs = performance.now() - t;
  }
  const controls = new Controls(game, canvas);
  const ui = new UI(game, controls, document.getElementById('ui')!);
  sync.loaded();

  // Starter scene: a person next to a couple of crates.
  const human = getItem('human');
  if (human) game.spawn(human, -1.5, 0.95);
  const crate = getItem('crate');
  if (crate) game.spawn(crate, 2, 0.45);

  await loading('Loading sounds…', 0.92);
  // (the list of them: the recordings themselves load once a click lets the page make sound)
  await Promise.race([game.sound.ready(), new Promise((res) => setTimeout(res, 4000))]);

  game.start();
  // the title screen, under the loading screen as that fades
  ui.mainMenu.show();
  // (or straight back into the scene the physics engine broke in: see UI.halted())
  ui.carryOn();
  // the bar fills as the screen fades out over the running game (letting clicks through at once)
  void loading('Ready', 1);
  const screen = document.getElementById('loading');
  screen?.classList.add('done');
  setTimeout(() => screen?.remove(), 600);
  // playing offline (the website only): started once the game is going, on a timer (a hidden tab runs no animation frames)
  setTimeout(() => void offline.start().catch((e) => console.warn('Offline play unavailable:', e)), 2000);
  // (benchmarks time the sandbox as it's played, without the main menu over it; the self-tests close it themselves)
  const inSandbox = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
    ui.mainMenu.close();
    return fn(...a);
  };
  // exposed for debugging and automated tests in the browser console
  (window as unknown as { bp: unknown }).bp = { game, controls, ui, getItem, ITEMS, kit: makeTestKit(game, controls), selftest: makeSelfTest(game, controls), bench: inSandbox(makeBench(game, controls)), benchLive: inSandbox(makeLiveBench(game, controls)), mixcheck: makeMixCheck(game, controls), BALANCE, GAIT, RAPIER, rapierBuild, DRAG, warmMs, rehearse: () => rehearseCrush(game, async () => {}) };
  // (npm run desktop -- --smoke: the app checks itself and quits)
  if (desktop?.smoke) void desktopSmoke(desktop, game, ui, performance.now() - booted);
}

boot().catch((e) => {
  console.error(e);
  const screen = document.getElementById('loading');
  const text = screen?.querySelector('.ld-step');
  if (screen && text) {
    screen.classList.remove('done');
    screen.classList.add('failed');
    text.textContent = `Blueberry Playground couldn’t start: ${String(e)}`;
  } else document.body.innerHTML = `<div class="loading">Failed to start: ${String(e)}</div>`;
});

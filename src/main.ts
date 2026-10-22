import './style.css';
import { initPhysics, RAPIER } from './engine/Physics';
import { Game } from './world/Game';
import { Controls, DRAG } from './tools/Controls';
import { UI } from './ui/UI';
import { registerAll } from './catalog/registry';
import { getItem } from './catalog/items';
import { makeTestKit } from './debug/testkit';
import { makeSelfTest } from './debug/selftest';
import { BALANCE, GAIT } from './entities/Human';

async function boot(): Promise<void> {
  await initPhysics();
  registerAll();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas);
  const controls = new Controls(game, canvas);
  const ui = new UI(game, controls, document.getElementById('ui')!);
  void ui;

  // Starter scene: a person next to a couple of crates.
  const human = getItem('human');
  if (human) game.spawn(human, -1.5, 0.95);
  const crate = getItem('crate');
  if (crate) game.spawn(crate, 2, 0.45);

  game.start();
  document.getElementById('loading')?.remove();
  // exposed for debugging and automated tests in the browser console
  (window as unknown as { bp: unknown }).bp = { game, controls, ui, getItem, kit: makeTestKit(game, controls), selftest: makeSelfTest(game, controls), BALANCE, GAIT, RAPIER, DRAG };
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="loading">Failed to start: ${String(e)}</div>`;
});

/**
 * Plays the game with real touch events on an emulated phone (390x844) and
 * checks the touch layout and gestures: npm run test:touch
 */
import { openGame, sleep } from './browser.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
};

let page;
try {
  page = await openGame({ width: 400, height: 860, phone: true });
  const { send, evaluate: ev, errors } = page;
  console.log(`Touch checks on an emulated phone in ${page.browser} (headless)...\n`);
  // fingers: points are { x, y, id }
  const touch = (type, pts) => send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 4, radiusY: 4, force: 1 })),
  });
  const tap = async (p) => {
    await touch('touchStart', [p]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(150);
  };
  const longPress = async (p) => {
    await touch('touchStart', [p]);
    await sleep(700);
    await touch('touchEnd', []);
    await sleep(150);
  };
  /** Screen point of a world point given as a JS expression in the page. */
  const screenOf = (expr) => ev(`(() => { const p = ${expr}; const s = bp.game.renderer.worldToScreen(p.x, p.y); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  const centerOf = (selector) => ev(`(() => { const e = ${selector}; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const button = (label) => centerOf(`[...document.querySelectorAll('.touch-btn')].find((e) => e.textContent === ${JSON.stringify(label)})`);
  const chest = `bp.game.entities[0].limbs.get('upperTorso').part`;

  await sleep(500);
  await ev(`bp.kit.reset(); bp.game.sound.muted = true; true`);
  const lay = await ev(`({ touch: document.body.classList.contains('touch'), collapsed: document.querySelector('.catalog').classList.contains('collapsed'), tb: (() => { const r = document.querySelector('.toolbar').getBoundingClientRect(); return [r.left, r.right]; })(), w: innerWidth })`);
  check('a phone starts in the touch layout with the catalog folded', lay.touch && lay.collapsed, JSON.stringify(lay));
  check('the toolbar fits beside the catalog strip', lay.tb[0] >= 46 && lay.tb[1] <= lay.w, JSON.stringify(lay));

  await tap(await centerOf(`document.querySelector('.cat-btn[data-cat="Characters"]')`));
  const open = await ev(`({ open: !document.querySelector('.catalog').classList.contains('collapsed'), toolbar: getComputedStyle(document.querySelector('.toolbar')).display })`);
  check('tapping a category opens the catalog (over the toolbar)', open.open && open.toolbar === 'none', JSON.stringify(open));
  await tap(await centerOf(`[...document.querySelectorAll('.item')].find((e) => e.textContent.includes('Human'))`));
  const armed = await ev(`({ armed: bp.controls.armed?.id, collapsed: document.querySelector('.catalog').classList.contains('collapsed') })`);
  check('tapping an item arms it and folds the catalog', armed.armed === 'human' && armed.collapsed, JSON.stringify(armed));

  await tap(await screenOf('({ x: bp.game.renderer.camX, y: 1 })'));
  await sleep(1500);
  check('tapping empty space spawns it', (await ev(`bp.game.entities.length`)) === 1);
  const empty = await screenOf('({ x: bp.game.renderer.camX + 2.5, y: 3 })');
  await longPress(empty);
  const disarmed = await ev(`({ armed: bp.controls.armed, n: bp.game.entities.length, menu: !!document.querySelector('.ctx') })`);
  check('a long press while spawning stops spawning and spawns nothing', disarmed.armed === null && disarmed.n === 1, JSON.stringify(disarmed));
  await ev(`bp.ui.closeContextMenu(); true`);

  await tap(await centerOf(`document.querySelector('.tb-btn[title^="Undo"]')`));
  const undone = await ev(`bp.game.entities.length`);
  await tap(await centerOf(`document.querySelector('.tb-btn[title^="Redo"]')`));
  const redone = await ev(`bp.game.entities.length`);
  check('tapping Undo takes the spawn back and Redo puts it back', undone === 0 && redone === 1, `${undone}, then ${redone}`);

  const c0 = await screenOf(chest);
  const y0 = await ev(`${chest}.y`);
  await touch('touchStart', [c0]);
  for (let i = 1; i <= 20; i++) {
    await touch('touchMove', [{ x: c0.x, y: c0.y - i * 6 }]);
    await sleep(16);
  }
  await sleep(300);
  const lifted = await ev(`${chest}.y`);
  const barWhileHeld = await ev(`!document.querySelector('.touchbar').classList.contains('hidden')`);
  await touch('touchEnd', []);
  check('dragging a person with a finger lifts them', lifted > y0 + 0.8, `chest ${y0.toFixed(2)} -> ${lifted.toFixed(2)}`);
  check('the touch bar shows while something is held', barWhileHeld);
  await sleep(2500);

  await touch('touchStart', [await screenOf(chest)]);
  await sleep(700);
  const menu = await ev(`document.querySelector('.ctx .ctx-title')?.textContent ?? null`);
  await touch('touchEnd', []);
  await sleep(150);
  check('a long press on a person opens their menu, which stays open', menu === 'Human' && (await ev(`!!document.querySelector('.ctx')`)), String(menu));
  await tap(empty);
  check('tapping elsewhere closes the menu', await ev(`!document.querySelector('.ctx')`));

  await sleep(300);
  await tap(await screenOf(chest));
  const sel = await ev(`({ sel: bp.controls.selection.size, bar: !document.querySelector('.touchbar').classList.contains('hidden') })`);
  check('tapping a person selects them and shows the touch bar', sel.sel === 1 && sel.bar, JSON.stringify(sel));
  await tap(await button('Freeze'));
  check('Freeze freezes the selection', await ev(`bp.game.entities[0].frozen`));
  await tap(await button('Unfreeze'));
  check('Unfreeze unfreezes it', !(await ev(`bp.game.entities[0].frozen`)));
  await tap(await screenOf('({ x: bp.game.renderer.camX + 2.5, y: 3 })'));
  check('tapping empty space deselects', (await ev(`bp.controls.selection.size`)) === 0);

  // a held rotate button turns what another finger is dragging
  await ev(`bp.kit.reset(); bp.game.entities.length`);
  await ev(`bp.kit.spawn('crate', bp.game.renderer.camX, 0.45); bp.kit.advance(0.5); true`);
  const crate = await screenOf(`bp.game.entities[0].parts[0]`);
  const a0 = await ev(`bp.game.entities[0].parts[0].a`);
  await touch('touchStart', [{ ...crate, id: 1 }]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [{ x: crate.x, y: crate.y - i * 10, id: 1 }]);
    await sleep(16);
  }
  const rot = await button('⟲');
  await touch('touchStart', [{ x: crate.x, y: crate.y - 100, id: 1 }, { ...rot, id: 2 }]);
  await sleep(600);
  const a1 = await ev(`bp.game.entities[0].parts[0].a`);
  await touch('touchEnd', [{ x: crate.x, y: crate.y - 100, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(150);
  check('holding rotate turns the crate being dragged', Math.abs(a1 - a0) > 0.5, `angle ${a0.toFixed(2)} -> ${a1.toFixed(2)}`);
  check('and the button finger did not move the drag', (await ev(`bp.game.entities.length`)) === 1 && !(await ev(`!!bp.controls.grab`)));

  const z0 = await ev(`bp.game.renderer.zoom`);
  const m = { x: 220, y: 450 };
  await touch('touchStart', [{ x: m.x - 40, y: m.y, id: 1 }, { x: m.x + 40, y: m.y, id: 2 }]);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', [{ x: m.x - 40 - i * 4, y: m.y, id: 1 }, { x: m.x + 40 + i * 4, y: m.y, id: 2 }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(150);
  const z1 = await ev(`bp.game.renderer.zoom`);
  check('pinching out zooms in', z1 > z0 * 1.5, `${z0.toFixed(1)} -> ${z1.toFixed(1)}`);
  check('a pinch spawns and grabs nothing', (await ev(`bp.game.entities.length`)) === 1 && !(await ev(`!!bp.controls.grab`)));

  const cam0 = await ev(`bp.game.renderer.camX`);
  const p = await screenOf('({ x: bp.game.renderer.camX + 0.4, y: bp.game.renderer.camY + 0.8 })');
  await touch('touchStart', [p]);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', [{ x: p.x - i * 8, y: p.y }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(150);
  const cam1 = await ev(`bp.game.renderer.camX`);
  check('dragging empty space pans the view', cam1 > cam0 + 0.3, `${cam0.toFixed(2)} -> ${cam1.toFixed(2)}`);
  check('and spawns nothing', (await ev(`bp.game.entities.length`)) === 1);

  await ev(`bp.ui.toggleHelp(); true`);
  const helpTop = await ev(`(() => { const t = document.querySelector('.help-touch').getBoundingClientRect().top; const k = document.querySelector('.help-panel > .keys').getBoundingClientRect().top; return t < k; })()`);
  check('help lists the touch controls first', helpTop);
  await ev(`bp.ui.toggleHelp(); true`);
  check('no page errors', !errors.length, errors.join('\n      '));
} catch (e) {
  console.error(`Touch test run failed: ${e.message}`);
  results.push(false);
} finally {
  await page?.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} touch checks passed`);
process.exit(failed ? 1 : 0);

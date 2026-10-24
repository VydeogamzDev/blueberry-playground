import type { Test, TestCtx } from './types';
import type { UI } from '../../ui/UI';
import { DEFAULT_LAYOUT, LAYOUT_STORE, anchorPoint } from '../../ui/Layout';
import { store } from '../../engine/Store';

/** Where these tests keep their layouts: apart from the player's, and never synced. */
const TEST_KEY = 'blueberry-test-layouts';

/** The interface's layout (see Layout): moving, scaling, hiding, docking, named layouts, Reset, and the Default leaving everything be. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const ui = () => controls.ui as unknown as UI;
  const lay = () => ui().layout;
  /** Runs a check on layouts of its own, the player's put back after (whatever happens). */
  const apart = (fn: () => string | true): string | true => {
    kit.reset();
    if (ui().mainMenu.open) ui().mainMenu.close();
    ui().closeOverlays();
    const L = lay();
    store.removeItem(TEST_KEY);
    L.storeKey = TEST_KEY;
    L.reload();
    try {
      return fn();
    } finally {
      if (L.editing) L.cancel();
      L.viewSize = null;
      store.removeItem(TEST_KEY);
      L.storeKey = LAYOUT_STORE;
      L.reload();
    }
  };
  const box = (sel: string) => document.querySelector<HTMLElement>(`#ui > ${sel}`)!.getBoundingClientRect();
  const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;
  const at = (r: DOMRect) => `(${r.left.toFixed(1)}, ${r.top.toFixed(1)}) ${r.width.toFixed(0)}×${r.height.toFixed(0)}`;
  /** The interface's elements the layout has changed (a class or a style of its own). */
  const touched = () => [...document.getElementById('ui')!.children].filter((e) =>
    /\blay-(moved|scaled|sized|hidden|ghost|dock-right|dock-bottom|tb-sized|cols|cols-auto|open)\b/.test(e.className) || (e as HTMLElement).style.cssText.includes('--lay-'));
  /**
   * Drags a piece's frame in Edit layout (or a part of it: its handle) by
   * (dx, dy) screen px, as the mouse would; free: with Alt held (no snapping).
   */
  const drag = (id: string, dx: number, dy: number, free = true, part?: string): boolean => {
    const frame = document.querySelector<HTMLElement>(`.lay-frame[data-piece="${id}"]`);
    const target = part ? frame?.querySelector<HTMLElement>(part) : frame;
    if (!target) return false;
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const ev = (type: string, px: number, py: number, on: EventTarget) =>
      on.dispatchEvent(new PointerEvent(type, { clientX: px, clientY: py, button: 0, buttons: 1, pointerId: 41, isPrimary: true, altKey: free, bubbles: true, cancelable: true }));
    ev('pointerdown', x, y, target);
    for (let i = 1; i <= 5; i++) ev('pointermove', x + (dx * i) / 5, y + (dy * i) / 5, window);
    ev('pointerup', x + dx, y + dy, window);
    return true;
  };

  return [
    ['extra: layout: the Default layout leaves every piece where the game puts it', () => apart(() => {
      const L = lay();
      if (L.active !== DEFAULT_LAYOUT) return `the layout in use is ${L.active}, not the Default`;
      const changed = touched();
      if (changed.length) return `changed by the layout: ${changed.map((e) => e.className).join('; ')}`;
      const root = document.getElementById('ui')!;
      if (root.classList.contains('lay-tb-right') || root.classList.contains('lay-tb-bottom')) return 'the toybox is not on the left';
      const W = innerWidth;
      const H = innerHeight;
      const tb = box('.toolbar');
      if (!near(tb.right, W - 8, 1) || !near(tb.top, 8, 1)) return `the toolbar is at ${at(tb)}, not 8 px in from the top right of a window ${W} px wide`;
      const tools = box('.tools');
      if (tools.width && (!near(tools.right, W - 8, 1) || !near((tools.top + tools.bottom) / 2, H / 2, 1))) return `the tool bar is at ${at(tools)}, not 8 px in from the right, half way down`;
      const cat = box('.catalog');
      if (cat.width && (!near(cat.left, 0, 0.5) || !near(cat.top, 0, 0.5) || !near(cat.bottom, H, 1))) return `the toybox is at ${at(cat)}, not down the left`;
      // (the camera centres on what the toybox leaves free, as it always has)
      const open = !document.querySelector('#ui > .catalog')!.classList.contains('collapsed');
      const reach = !cat.width ? 0 : open ? cat.width : box('.catalog .cat-strip').width;
      const r = game.renderer;
      if (!near(r.insetLeft, reach, 1) || !near(r.centerX, reach + (W - reach) / 2, 1)) return `the camera centres at x ${r.centerX.toFixed(1)} (left inset ${r.insetLeft.toFixed(1)}), the toybox reaching ${reach.toFixed(1)} px in`;
      return true;
    })],
    ['extra: layout: a piece moved in Edit layout is kept, and is still there when the layouts are read again', () => apart(() => {
      const L = lay();
      const was = box('.tools');
      if (!was.width) return 'the tool bar is not shown';
      ui().editLayout();
      if (!L.editing) return 'Edit layout did not open';
      if (!game.paused) return 'time runs on while the layout is edited';
      if (!drag('tools', -300, -120)) return 'no frame on the tool bar';
      L.done();
      if (game.paused) return 'time stayed stopped after Done';
      const moved = box('.tools');
      if (!near(moved.left, was.left - 300) || !near(moved.top, was.top - 120)) return `dragged by (-300, -120) from ${at(was)}, it is at ${at(moved)}`;
      if (L.active === DEFAULT_LAYOUT) return 'the change went into the Default layout';
      L.reload();
      const again = box('.tools');
      if (!near(again.left, moved.left) || !near(again.top, moved.top)) return `read again, it is at ${at(again)}, not ${at(moved)}`;
      return true;
    })],
    ['extra: layout: a moved piece keeps its distance from its edges as the window changes size, and stays on a screen too small for it', () => apart(() => {
      const L = lay();
      const W = innerWidth;
      const H = innerHeight;
      ui().editLayout();
      // down towards the bottom right: kept by that corner
      if (!drag('tools', -40, H / 4 + 20)) return 'no frame on the tool bar';
      L.done();
      const r0 = box('.tools');
      const right0 = W - r0.right;
      const bottom0 = H - r0.bottom;
      // as if the window had been made 300 px narrower and 120 px shorter
      const view = { w: Math.max(720, W - 300), h: H - 120 };
      L.viewSize = view;
      L.apply();
      const r1 = box('.tools');
      if (!near(view.w - r1.right, right0) || !near(view.h - r1.bottom, bottom0)) {
        return `kept ${right0.toFixed(1)} px from the right and ${bottom0.toFixed(1)} from the bottom; in a ${view.w} × ${view.h} window ${(view.w - r1.right).toFixed(1)} and ${(view.h - r1.bottom).toFixed(1)}`;
      }
      // a place off the screen: pulled back onto it
      const mine = L.slots.find((s) => s.id === L.active);
      if (!mine) return 'no layout of the player’s in use';
      mine.layout.pieces.tools = { at: { ax: 0, ay: 0, dx: 5000, dy: -400 } };
      L.viewSize = { w: 720, h: 480 };
      L.apply();
      const r2 = box('.tools');
      if (r2.left < -0.5 || r2.top < -0.5 || r2.right > 720.5 || r2.bottom > 480.5) return `put 5000 px in from the left of a 720 × 480 screen, it is at ${at(r2)}`;
      // (and the sum itself: one bigger than the screen keeps its top left on it)
      const p = anchorPoint({ ax: 1, ay: 1, dx: -10, dy: -10 }, 100, 50, { w: 500, h: 300 });
      if (p.x !== 490 || p.y !== 290) return `kept 10 px in from the bottom right of 500 × 300, its anchor is at (${p.x}, ${p.y}), not (490, 290)`;
      const big = anchorPoint({ ax: 0.5, ay: 0, dx: 0, dy: 0 }, 900, 50, { w: 500, h: 300 });
      if (big.x !== 450) return `900 px wide on a 500 px screen, kept by its middle: its middle is at x ${big.x}, not 450 (its left edge at 0)`;
      return true;
    })],
    ['extra: layout: Hide in Edit layout hides a piece, and Show brings it back', () => apart(() => {
      const L = lay();
      const tools = document.querySelector<HTMLElement>('#ui > .tools')!;
      if (getComputedStyle(tools).display === 'none') return 'the tool bar is not shown to start with';
      const hide = () => document.querySelector<HTMLButtonElement>('.lay-frame[data-piece="tools"] button[data-act="hide"]');
      ui().editLayout();
      if (!hide()) return 'no Hide on the tool bar’s frame';
      hide()!.click();
      if (getComputedStyle(tools).display === 'none' || !tools.classList.contains('lay-ghost')) return 'while editing, the hidden tool bar should still show, faintly, to be shown again';
      L.done();
      if (getComputedStyle(tools).display !== 'none') return 'hidden, the tool bar still shows';
      L.reload();
      if (getComputedStyle(tools).display !== 'none') return 'read again, the hidden tool bar shows';
      ui().editLayout();
      if (hide()?.textContent !== 'Show') return `the frame’s button says ${hide()?.textContent ?? 'nothing'}, not Show`;
      hide()!.click();
      L.done();
      if (getComputedStyle(tools).display === 'none') return 'shown again, the tool bar stays hidden';
      return true;
    })],
    ['extra: layout: scaling the whole interface, and a piece by its corner, about the point it is kept by', () => apart(() => {
      const L = lay();
      const tb0 = box('.toolbar');
      ui().editLayout();
      L.setScale(1.5);
      const tb1 = box('.toolbar');
      if (!near(tb1.width, tb0.width * 1.5, 2) || !near(tb1.right, tb0.right, 1) || !near(tb1.top, tb0.top, 1)) {
        return `at 150% the toolbar is ${at(tb1)}, not ${(tb0.width * 1.5).toFixed(0)} px wide from the same top right as ${at(tb0)}`;
      }
      L.setScale(1);
      // the tool bar's corner handle dragged half as far out again: it grows about the middle of its right side
      const t0 = box('.tools');
      if (!drag('tools', -t0.width / 2, t0.height / 4, false, '.lay-scale')) return 'no scale handle on the tool bar’s frame';
      L.done();
      const t1 = box('.tools');
      if (!near(t1.height, t0.height * 1.5, 3) || !near(t1.right, t0.right, 1) || !near((t1.top + t1.bottom) / 2, (t0.top + t0.bottom) / 2, 1.5)) {
        return `scaled by its corner, the tool bar is ${at(t1)}, not 1.5 times ${at(t0)} about the middle of its right side`;
      }
      return true;
    })],
    ['extra: layout: the toybox docks on the right and along the bottom; the camera centres on the rest, the other pieces keep clear', () => apart(() => {
      const L = lay();
      const W = innerWidth;
      const H = innerHeight;
      const cat = document.querySelector<HTMLElement>('#ui > .catalog')!;
      if (getComputedStyle(cat).display === 'none') return 'the toybox is hidden';
      const shown = () => (cat.classList.contains('collapsed') ? cat.querySelector<HTMLElement>('.cat-strip')! : cat).getBoundingClientRect();
      const r = game.renderer;
      ui().editLayout();
      L.setDock('right');
      L.done();
      const right = shown();
      if (!near(right.right, W, 1) || right.left < W / 2) return `docked on the right, the toybox spans x ${right.left.toFixed(0)}..${right.right.toFixed(0)} of ${W}`;
      if (r.insetLeft !== 0 || !near(r.centerX, right.left / 2, 1.5)) return `docked on the right, the camera centres at x ${r.centerX.toFixed(1)}, not ${(right.left / 2).toFixed(1)} (left inset ${r.insetLeft})`;
      for (const sel of ['.toolbar', '.tools']) {
        const b = box(sel);
        if (b.width && b.right > right.left + 0.5) return `${sel} reaches x ${b.right.toFixed(0)}, under the toybox (from ${right.left.toFixed(0)})`;
      }
      L.setDock('bottom');
      const band = shown();
      if (!near(band.bottom, H, 1) || !near(band.left, 0, 1) || !near(band.right, W, 1)) return `along the bottom, the toybox is at ${at(band)}`;
      if (r.insetLeft !== 0 || !near(r.centerX, W / 2, 1)) return `along the bottom, the camera centres at x ${r.centerX.toFixed(1)}, not ${W / 2}`;
      const st = box('.status');
      if (st.height && st.bottom > band.top + 0.5) return `the stats reach y ${st.bottom.toFixed(0)}, under the toybox (from ${band.top.toFixed(0)})`;
      return true;
    })],
    ['extra: layout: the toybox made wider by its edge, and given more columns', () => apart(() => {
      const L = lay();
      const panel = document.querySelector<HTMLElement>('#ui > .catalog .cat-panel')!;
      const items = document.querySelector<HTMLElement>('#ui > .catalog .items')!;
      ui().editLayout();
      const w0 = panel.getBoundingClientRect().width;
      if (!drag('toybox', 100, 0, true, '.lay-size')) return 'no size handle on the toybox’s frame';
      const w1 = panel.getBoundingClientRect().width;
      if (!near(w1, w0 + 100, 1.5)) return `its edge dragged 100 px out, the toybox's panel went from ${w0.toFixed(1)} to ${w1.toFixed(1)} px wide`;
      L.setCols(4);
      const cols = getComputedStyle(items).gridTemplateColumns.split(' ').length;
      L.done();
      if (cols !== 4) return `4 columns asked for, the toybox shows ${cols}`;
      const cat = document.querySelector<HTMLElement>('#ui > .catalog')!;
      const reach = (cat.classList.contains('collapsed') ? cat.querySelector<HTMLElement>('.cat-strip')! : cat).getBoundingClientRect().width;
      if (!near(game.renderer.insetLeft, reach, 1)) return `the camera's left inset (${game.renderer.insetLeft.toFixed(1)}) is not the toybox's width (${reach.toFixed(1)})`;
      return true;
    })],
    ['extra: layout: named layouts save, switch, rename and delete; the Default stays', () => apart(() => {
      const L = lay();
      const base = box('.tools');
      ui().editLayout();
      drag('tools', -200, 0);
      L.done();
      const inA = box('.tools');
      const a = L.active;
      if (a === DEFAULT_LAYOUT) return 'moving a piece left the Default in use';
      L.rename('Test layout A');
      const b = L.saveAs('Test layout B');
      if (L.active !== b.id) return 'Save as did not put the new layout in use';
      ui().editLayout();
      drag('tools', 0, -100);
      L.done();
      const inB = box('.tools');
      const same = (r: DOMRect, s: DOMRect) => near(r.left, s.left) && near(r.top, s.top);
      L.use(DEFAULT_LAYOUT);
      if (!same(box('.tools'), base)) return `with the Default in use the tool bar is at ${at(box('.tools'))}, not ${at(base)}`;
      L.use(a);
      if (!same(box('.tools'), inA)) return `with layout A in use the tool bar is at ${at(box('.tools'))}, not ${at(inA)}`;
      L.use(b.id);
      if (!same(box('.tools'), inB)) return `with layout B in use the tool bar is at ${at(box('.tools'))}, not ${at(inB)}`;
      const names = L.slots.map((s) => s.name).join(', ');
      if (names !== 'Test layout A, Test layout B') return `the layouts are: ${names}`;
      // the one in use is remembered
      L.reload();
      if (L.active !== b.id) return `read again, the layout in use is ${L.active}, not B`;
      L.remove();
      if (L.active !== DEFAULT_LAYOUT) return `B deleted, ${L.active} is in use, not the Default`;
      if (L.slots.some((s) => s.id === b.id)) return 'B is still listed after Delete';
      if (!same(box('.tools'), base)) return 'B deleted, the tool bar is not back where the Default has it';
      L.remove();
      if (L.slots.length !== 1) return `Delete with the Default in use took a layout away (${L.slots.length} left)`;
      const pick = document.querySelector<HTMLSelectElement>('.set-layout');
      const listed = pick ? [...pick.options].map((o) => o.textContent).join(', ') : 'none';
      if (listed !== 'Default, Test layout A') return `Settings’ layouts: ${listed}`;
      return true;
    })],
    ['extra: layout: Reset to default puts every piece back, and the toybox on the left', () => apart(() => {
      const L = lay();
      const sels = ['.toolbar', '.tools', '.catalog'];
      const before = sels.map(box);
      ui().editLayout();
      drag('tools', -300, 60);
      drag('toolbar', -150, 200);
      L.setDock('right');
      L.setScale(1.25);
      if (near(box('.tools').left, before[1].left)) return 'the tool bar did not move';
      L.reset();
      L.done();
      for (let i = 0; i < sels.length; i++) {
        const r = box(sels[i]);
        if (!near(r.left, before[i].left, 1) || !near(r.top, before[i].top, 1) || !near(r.width, before[i].width, 1)) return `${sels[i]} is at ${at(r)} after Reset, not ${at(before[i])}`;
      }
      const left = touched();
      if (left.length) return `still changed by the layout after Reset: ${left.map((e) => e.className).join('; ')}`;
      return true;
    })],
    ['extra: layout: its key opens Edit layout and Esc finishes it, time stopped meanwhile', () => apart(() => {
      const L = lay();
      const b = controls.bindings;
      const keys = b.keys('layout');
      b.set('layout', ['F9']);
      try {
        kit.press('F9');
        if (!L.editing) return 'its key (bound to F9) did not open Edit layout';
        if (!game.paused) return 'time runs on while the layout is edited';
        kit.press('Space');
        if (!game.paused) return 'Space started time while the layout was edited';
        kit.press('Escape');
        if (L.editing) return 'Esc did not finish editing';
        if (game.paused) return 'time stayed stopped after editing';
        if (ui().isPanelOpen()) return 'a panel is open after Esc';
        return true;
      } finally {
        b.set('layout', keys);
      }
    })],
    ['extra: layout: a screen narrower than 700 px keeps the compact layout, and Edit layout waits for a wider one', () => apart(() => {
      const L = lay();
      const was = box('.tools');
      ui().editLayout();
      drag('tools', -250, 0);
      L.done();
      L.viewSize = { w: 600, h: 800 };
      L.apply();
      const r = box('.tools');
      if (!near(r.left, was.left) || !near(r.top, was.top)) return `on a 600 px screen the moved tool bar is at ${at(r)}, not where the game puts it (${at(was)})`;
      ui().editLayout();
      if (L.editing) return 'Edit layout opened on a 600 px screen';
      if (game.paused) return 'time stopped though Edit layout did not open';
      L.viewSize = null;
      L.apply();
      if (near(box('.tools').left, was.left)) return 'back on a wide screen, the moved tool bar is not where it was put';
      return true;
    })],
  ];
}

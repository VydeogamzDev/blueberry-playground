import type { Test, TestCtx } from './types';
import { CARRY_ON, type UI } from '../../ui/UI';
import type { Entity } from '../../world/Entity';
import type { ContextAction } from '../../world/types';
import { capture } from '../../world/Snapshot';
import { getItem } from '../../catalog/items';
import { TerrainTool } from '../../tools/TerrainTool';
import { validateMap } from '../../world/Maps';

/** Bugs found on the player's side (the controls, the interface): each one's fix, kept fixed. */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const ui = () => controls.ui as unknown as UI;
  /** The Controls' own steps these tests take one at a time. */
  const inside = controls as unknown as { openMenuAtCursor(): void; pickFoe(f: Entity): void };
  /** A right click on something (the mouse: not the touch layout). */
  const rightClick = (e: Entity) => {
    const p = e.parts.find((q) => !q.destroyed)!;
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
  };

  return [
    ['extra: bugs: saving or deleting another contraption leaves the one being spawned selected in the toybox', () => {
      kit.reset();
      const store = ui().contraptions;
      const snap = capture(game, [kit.spawn('crate', 0, 0.45)]);
      const made: string[] = [];
      try {
        const a = store.add('Bug test A', snap, '');
        if (!a) return 'could not save a contraption (no storage?)';
        made.push(a.id);
        const defA = store.items().find((d) => d.id === 'contraption:' + a.id)!;
        controls.arm(defA);
        const b = store.add('Bug test B', snap, '');
        if (b) made.push(b.id);
        if (controls.armed !== defA) return `saving another contraption ${controls.armed ? `selected ${controls.armed.name}` : 'deselected the one being spawned'}`;
        if (b) store.remove(b.id);
        if (controls.armed !== defA) return `deleting another contraption ${controls.armed ? `selected ${controls.armed.name}` : 'deselected the one being spawned'}`;
        store.rename(a.id, 'Bug test A2');
        if (controls.armed?.id !== defA.id || controls.armed.name !== 'Bug test A2') return `renamed, the one being spawned is ${controls.armed ? `"${controls.armed.name}"` : 'deselected'}`;
        store.remove(a.id);
        if (controls.armed) return 'deleting the contraption being spawned left it selected';
        return true;
      } finally {
        for (const id of made) store.remove(id);
        controls.arm(null);
      }
    }],
    ['extra: bugs: picking a speed or pressing a tool bar button leaves the keys to the game, and Esc in a setting closes its panel', () => {
      kit.reset();
      const sel = document.querySelector<HTMLSelectElement>('select[title="Simulation speed"]');
      if (!sel) return 'no speed setting on the tool bar';
      sel.focus();
      sel.value = '0.5';
      sel.dispatchEvent(new Event('change'));
      const scale = game.timeScale;
      const kept = document.activeElement === sel;
      controls.setTimeScale(1);
      if (scale !== 0.5) return `the speed setting set the speed to ${scale}`;
      if (kept) return 'the speed setting kept the keys (Space would open it, the arrows change the speed)';
      const settings = document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title="Settings"]');
      if (!settings) return 'no Settings button on the tool bar';
      settings.focus();
      settings.click();
      const pressed = document.activeElement === settings;
      ui().closeOverlays();
      if (pressed) return 'a tool bar button kept the keys (Enter would press it again)';
      // a setting in a panel with the keys: Esc leaves it and closes the panel
      ui().closeOverlays();
      ui().toggleHelp();
      const panel = document.querySelector<HTMLElement>('.help-panel');
      const overlay = panel?.parentElement;
      if (!panel || !overlay || overlay.classList.contains('hidden')) return 'the Controls panel did not open';
      const box = document.createElement('input');
      box.type = 'checkbox';
      panel.appendChild(box);
      box.focus();
      box.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
      const open = !overlay.classList.contains('hidden');
      const focused = document.activeElement === box;
      box.remove();
      ui().closeOverlays();
      if (open) return 'Esc with a setting focused left its panel open';
      if (focused) return 'Esc left the keys with the setting';
      return true;
    }],
    ['extra: bugs: a context menu closes when what it is for is removed (and not for anything else)', () => {
      kit.reset();
      const crate = kit.spawn('crate', 1, 0.45);
      const other = kit.spawn('crate', -1.5, 0.45);
      const bystander = kit.spawn('crate', 4, 0.45);
      kit.advance(0.3);
      rightClick(crate);
      if (!controls.ui.isMenuOpen()) return 'a right click on a crate opened no menu';
      game.remove(crate);
      if (controls.ui.isMenuOpen()) {
        controls.ui.closeContextMenu();
        return 'the crate’s menu stayed open once the crate was gone (its entries would act on it)';
      }
      rightClick(other);
      game.remove(bystander);
      const still = controls.ui.isMenuOpen();
      controls.ui.closeContextMenu();
      if (!still) return 'removing something else closed the menu';
      return true;
    }],
    ['extra: bugs: picking who to fight ends with a click on empty space (a finger has no Esc), and once the fighter is gone', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2, { flip: true });
      kit.advance(0.5);
      inside.pickFoe(a);
      if (!controls.hint.includes('who to fight')) return `picking, the hint reads "${controls.hint}"`;
      kit.down(0, 6);
      kit.up(0, 6);
      if (controls.hint.includes('who to fight')) return 'a click on empty space did not stop picking who to fight';
      if (a.foe) return 'a click on empty space set them on someone';
      // the fighter removed meanwhile: a click on someone says so, and ends it
      inside.pickFoe(a);
      game.remove(a);
      const head = b.limbs.get('head')!.part;
      kit.down(head.x, head.y);
      kit.up(head.x, head.y);
      if (controls.hint.includes('who to fight')) return 'picking who to fight went on with the fighter gone';
      if (b.foe) return 'the one picked was set on someone who is gone';
      return true;
    }],
    ['extra: bugs: on a touch screen while spawning, a long press on an object opens its menu; on empty space it stops spawning', () => {
      kit.reset();
      const crate = kit.spawn('crate', 1, 0.45);
      kit.advance(0.3);
      const was = controls.touchMode;
      controls.touchMode = true;
      try {
        controls.arm(getItem('crate')!);
        const p = crate.parts[0];
        kit.move(p.x, p.y);
        inside.openMenuAtCursor();
        const title = document.querySelector('.ctx .ctx-title')?.textContent ?? null;
        controls.ui.closeContextMenu();
        if (!controls.armed) return 'a long press on a crate while spawning stopped spawning rather than open its menu';
        if (title !== crate.label) return `a long press on a crate while spawning opened ${title === null ? 'no menu' : `the menu "${title}"`}`;
        kit.move(p.x, 5);
        inside.openMenuAtCursor();
        const menu = controls.ui.isMenuOpen();
        controls.ui.closeContextMenu();
        if (controls.armed) return 'a long press on empty space while spawning did not stop spawning';
        if (menu) return 'a long press on empty space while spawning opened a menu as well';
        return true;
      } finally {
        controls.touchMode = was;
        controls.arm(null);
      }
    }],
    ['extra: bugs: a context menu taller than the window stays on the screen (it scrolls)', () => {
      kit.reset();
      const acts: ContextAction[] = Array.from({ length: 90 }, (_, i) => ({ label: `Entry ${i + 1}`, action: () => {} }));
      for (const y of [20, window.innerHeight - 10]) {
        controls.ui.openContextMenu(20, y, 'A long menu', acts);
        const m = document.querySelector<HTMLElement>('.ctx');
        const r = m?.getBoundingClientRect();
        const scrolls = !!m && m.scrollHeight > m.clientHeight;
        controls.ui.closeContextMenu();
        if (!r) return 'no menu opened';
        if (r.top < 0 || r.bottom > window.innerHeight + 1) return `opened at y ${y}, the menu spans y ${r.top.toFixed(0)}..${r.bottom.toFixed(0)} in a window ${window.innerHeight} high`;
        if (!scrolls) return `opened at y ${y}, the menu (${r.height.toFixed(0)} px high) does not scroll to its last entries`;
      }
      return true;
    }],
    ['extra: bugs: the vitals of the one selected keep clear of the tool bar', () => {
      kit.reset();
      const h = human(0);
      controls.selection.add(h);
      kit.advance(0.1);
      const vit = document.querySelector<HTMLElement>('.vitals');
      const shown = !!vit && !vit.classList.contains('hidden');
      const a = vit?.getBoundingClientRect();
      const b = document.querySelector<HTMLElement>('.toolbar')?.getBoundingClientRect();
      controls.clearSelection();
      kit.advance(0);
      if (!shown || !a) return 'selecting a person showed no vitals';
      if (!b) return 'no tool bar';
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        return `in a window ${window.innerWidth} px wide the vitals (x ${a.left.toFixed(0)}..${a.right.toFixed(0)}, y ${a.top.toFixed(0)}..${a.bottom.toFixed(0)}) cover the tool bar (x ${b.left.toFixed(0)}..${b.right.toFixed(0)}, y ${b.top.toFixed(0)}..${b.bottom.toFixed(0)})`;
      }
      return true;
    }],
    ['extra: bugs: the map editing banner keeps Done on the screen, however long the map’s name', () => {
      kit.reset();
      const spec = validateMap({ id: 'custom:bugs-banner', name: 'A map with a name as long as they can be!', width: 140, height: 48, theme: 'concrete', terrain: [] });
      if (!spec) return 'could not make a map';
      game.setMap(spec);
      const tool = new TerrainTool(game, controls);
      tool.start();
      try {
        kit.advance(0);
        const done = [...document.querySelectorAll<HTMLElement>('.map-banner .panel-btn')].find((d) => d.textContent === 'Done');
        if (!done) return 'no Done button on the banner while editing the map';
        const r = done.getBoundingClientRect();
        if (r.width === 0 || r.left < 0 || r.right > window.innerWidth) return `Done spans x ${r.left.toFixed(0)}..${r.right.toFixed(0)} in a window ${window.innerWidth} px wide`;
        return true;
      } finally {
        tool.stop();
      }
    }],
    ['extra: bugs: ground drawn or taken away with the Terrain tool can be undone and redone', () => {
      kit.reset();
      const tool = new TerrainTool(game, controls);
      tool.start();
      try {
        const n0 = game.map.terrain.length;
        const id0 = game.map.id;
        kit.down(-2, 0.5);
        kit.move(0, 1.5);
        kit.move(2, 2.5);
        kit.up(2, 2.5);
        if (game.map.terrain.length !== n0 + 1) return `dragging out a box made ${game.map.terrain.length - n0} pieces of ground`;
        kit.down(-1.5, 1, 2);
        kit.up(-1.5, 1, 2);
        if (game.map.terrain.length !== n0) return 'a right click did not take the block away';
        controls.undo();
        if (game.map.terrain.length !== n0 + 1) return `undo after taking the block away left ${game.map.terrain.length - n0} pieces of ground`;
        controls.undo();
        if (game.map.terrain.length !== n0) return `undo after drawing the block left ${game.map.terrain.length - n0} pieces of ground`;
        if (game.map.id !== id0) return `with every change undone, the map in play is ${game.map.id}, not ${id0}`;
        controls.redo();
        if (game.map.terrain.length !== n0 + 1) return `redo put back ${game.map.terrain.length - n0} pieces of ground`;
        return true;
      } finally {
        tool.stop();
      }
    }],
    ['extra: bugs: the physics engine breaking says so, gives the details to send in, and the game carries on with the scene after a restart', () => {
      kit.reset();
      kit.spawn('crate', 1, 0.5);
      kit.advance(0.2);
      // a frame that breaks as Rapier does when it panics
      const boom = () => {
        throw new Error('RuntimeError: unreachable (a test)');
      };
      game.frameHandlers.push(boom);
      // (what it says in the console is this test's, not a page error)
      const said = console.error;
      console.error = () => {};
      try {
        (game as unknown as { frameAt(now: number): void }).frameAt(performance.now());
      } finally {
        console.error = said;
        game.frameHandlers.splice(game.frameHandlers.indexOf(boom), 1);
      }
      const box = document.querySelector('.halt-panel');
      try {
        if (!game.halted) return 'the frames went on';
        if (!box) return 'nothing said the game had stopped';
        const details = box.querySelector('textarea')?.value ?? '';
        if (!details.includes('unreachable (a test)')) return `the details don’t say what broke: “${details.slice(0, 120)}”`;
        if (![...box.querySelectorAll('button')].some((b) => b.textContent === 'Carry on')) return 'no way to carry on with the scene';
      } finally {
        box?.closest('.overlay')?.remove();
        game.halted = false;
      }
      // the scene as of the last edit (what's carried when the scene now can't be read), over a restart
      controls.history.clear();
      controls.history.record('A test');
      kit.spawn('human', -1, 1);
      const text = controls.history.lastSave();
      if (!text) return 'no save made of the last undo step';
      sessionStorage.setItem(CARRY_ON, text);
      kit.reset();
      ui().carryOn();
      if (sessionStorage.getItem(CARRY_ON) !== null) return 'the scene carried on was left to carry on again at the next start';
      const ids = game.entities.filter((e) => !e.destroyed).map((e) => e.def.id);
      if (ids.join() !== 'crate') return `carried on with ${ids.join(', ') || 'nothing'}: before the last edit there was a crate`;
      return true;
    }],
  ];
}

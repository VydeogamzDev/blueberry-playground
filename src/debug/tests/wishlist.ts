import type { Test, TestCtx } from './types';
import type { Firearm } from '../../entities/Firearm';
import { getItem } from '../../catalog/items';

/** Players' wishes for 0.2.4: dragged guns that keep their aim, putting back what's picked in the toybox, and water with no limit. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const deg = (rad: number) => (rad * 180) / Math.PI;
  /** The ticked-or-not menu item that starts with `label`, if the open menu has it. */
  const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.textContent ?? '').startsWith(label));
  return [
    ['extra: wishlist: an RPG or a rifle dragged by its grip, lifted and swung about, keeps the angle it was picked up at (it doesn’t swing round)', () => {
      for (const id of ['rpg', 'rifle']) {
        kit.reset();
        const g = kit.spawn(id, 0, 1.5) as Firearm;
        kit.advance(0.5);
        const p = g.parts[0];
        const a0 = p.a;
        const grip = g.gripWorld() ?? { x: p.x, y: p.y };
        kit.down(grip.x, grip.y);
        let worst = 0;
        // lifted, carried right, then back left, and held still
        const path: [number, number][] = [[0, 1.5], [1.5, 1.5], [-1.5, 1.2], [0, 1.5]];
        for (const [dx, dy] of path) {
          kit.move(grip.x + dx, grip.y + dy);
          for (let i = 0; i < 6; i++) {
            kit.advance(0.1);
            worst = Math.max(worst, Math.abs(deg(p.a - a0)));
          }
        }
        kit.up(p.x, p.y);
        if (worst > 8) return `the ${id} turned ${worst.toFixed(0)}° from where it was picked up while dragged`;
      }
      return true;
    }],
    ['extra: wishlist: B or Esc puts back the item picked in the toybox (Esc before the pause menu), and right-clicking empty space offers it', () => {
      kit.reset();
      const crate = getItem('crate')!;
      const key = controls.bindings.keys('disarm')[0];
      if (!key) return 'nothing is bound to putting back what’s picked';
      controls.arm(crate);
      kit.press(key);
      if (controls.armed) return `${key} didn’t put back the crate`;
      controls.arm(crate);
      kit.press('Escape');
      const pause = document.querySelector('.pause-panel')?.parentElement;
      const paused = !!pause && !pause.classList.contains('hidden');
      if (controls.armed) return 'Esc didn’t put back the crate';
      if (paused) {
        kit.press('Escape');
        return 'Esc opened the pause menu as well as putting back the crate';
      }
      controls.arm(crate);
      kit.down(6, 4, 2);
      kit.up(6, 4, 2);
      const item = menuItem(`Stop spawning ${crate.name}`);
      if (!item) {
        const offered = [...document.querySelectorAll('.ctx-item')].map((d) => d.textContent).join(', ') || 'no menu';
        controls.ui.closeContextMenu();
        controls.arm(null);
        return `right-clicking empty space while spawning crates offered: ${offered}`;
      }
      item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      if (controls.armed) return `“Stop spawning ${crate.name}” didn’t put it back`;
      if (game.entities.length) return `spawned ${game.entities.map((e) => e.def.id).join(', ')} on the way`;
      return true;
    }],
    ['extra: wishlist: with Water set to Infinite, more water than the usual limit pours, flows, is kept by undo and saves, and Limited stops more', () => {
      kit.reset();
      const f = game.fluid;
      const was = f.infinite;
      try {
        f.infinite = false;
        f.clear();
        const limit = f.max;
        const capped = f.addBlock(0, 0.5, 12, 0.9);
        if (capped !== limit) return `limited, a block of water made ${capped} particles (the limit is ${limit})`;
        f.clear();
        f.infinite = true;
        const made = f.addBlock(0, 0.5, 12, 0.9);
        if (made <= limit * 1.3) return `with no limit, the same block made only ${made} particles (the limit is ${limit})`;
        kit.advance(0.5);
        const bad = Array.from({ length: f.n }, (_, i) => i).filter((i) => !Number.isFinite(f.x[i]) || !Number.isFinite(f.y[i]) || f.y[i] < -0.2 || f.y[i] > 3);
        if (bad.length) return `${bad.length} of ${f.n} particles went wrong (e.g. at ${f.x[bad[0]]?.toFixed(2)}, ${f.y[bad[0]]?.toFixed(2)})`;
        if (f.n < limit * 1.3) return `only ${f.n} of ${made} particles are left after half a second`;
        // (what's saved comes back whole, even with the limit back on)
        const saved = f.capture();
        f.infinite = false;
        f.restore(saved);
        if (f.n !== saved.n) return `${saved.n} particles saved came back as ${f.n}`;
        if (f.add(0, 2)) return 'limited again, water still poured past the limit';
        return true;
      } finally {
        f.infinite = was;
        f.clear();
      }
    }],
  ];
}

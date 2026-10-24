import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import { saveToString, loadFromString } from '../../world/SaveLoad';

export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  /** Opens `e`'s context menu and picks the item starting with `label`; false if there's none. */
  const menu = (e: Entity, label: string): boolean => {
    const p = e.parts.find((q) => !q.destroyed)!;
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => d.textContent?.startsWith(label));
    if (!item) {
      controls.ui.closeContextMenu();
      return false;
    }
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };
  /** The fastest any part of these is moving (m/s). */
  const fastest = (list: Entity[]): number => {
    let v = 0;
    for (const e of list) for (const p of e.parts) if (!p.destroyed) v = Math.max(v, Math.hypot(p.body.linvel().x, p.body.linvel().y));
    return v;
  };
  const head = (h: Human) => h.limbs.get('head')!.part;
  /** Who they're fighting (read through this, the checks don't narrow it for the rest of the test). */
  const foeOf = (e: Human | Creature): Entity | null => e.foe;

  return [
    ['extra: fighting: Fight… then a click on someone sets two people on each other, until one of them is out of it', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2, { flip: true });
      kit.advance(1);
      // Esc lets go of the pick without starting anything
      if (!menu(a, 'Fight')) return 'no Fight… in a person’s context menu';
      if (!controls.hint.includes('who to fight')) return `picking, the hint reads "${controls.hint}"`;
      kit.press('Escape');
      if (controls.hint.includes('who to fight') || foeOf(a)) return 'Esc did not cancel picking who to fight';
      // a click on the other one starts it, and they fight back
      menu(a, 'Fight');
      const t = head(b);
      kit.down(t.x, t.y);
      kit.up(t.x, t.y);
      if (foeOf(a) !== b || foeOf(b) !== a) return `picked: A is fighting ${foeOf(a) ? 'someone else' : 'nobody'}, B ${foeOf(b) === a ? 'A' : foeOf(b) ? 'someone else' : 'nobody'}`;
      let top = 0;
      let t0 = 0;
      for (; t0 < 45 && (a.foe || b.foe); t0 += 0.25) {
        kit.advance(0.25);
        top = Math.max(top, fastest([a, b]));
      }
      if (a.foe || b.foe) return `after 45 s still fighting (heads ${head(a).hp.toFixed(0)}, ${head(b).hp.toFixed(0)})`;
      // blows landed: someone took a beating (and nothing was flung about)
      const beaten = [a, b].filter((h) => !h.upright || h.consciousness < 0.5 || head(h).hp < head(h).maxHp * 0.6).length;
      if (!beaten) return `it ended at ${t0.toFixed(1)} s with neither much hurt (heads ${head(a).hp.toFixed(0)}, ${head(b).hp.toFixed(0)})`;
      if (top > 20) return `something went flying at ${top.toFixed(0)} m/s`;
      const lost = [a, b].flatMap((h) => [...h.limbs.values()].filter((l) => l.severed || l.gone).map((l) => l.spec.key));
      if (lost.length) return `fists took off: ${lost.join(', ')}`;
      return true;
    }],
    ['extra: fighting: armed people win fast (a bat up close, a pistol from a way off); a person and a dog set on each other both fight', () => {
      // a bat: knocked out (or down and beaten) in a few swings
      kit.reset();
      const a = human(-2.5);
      const b = human(2.5, { flip: true });
      kit.advance(1);
      if (!arm(a, 'bat')) return 'could not put a bat in someone’s hand';
      a.fight(b);
      let t = 0;
      for (; t < 15 && a.foe; t += 0.25) kit.advance(0.25);
      if (a.foe) return `with a bat, still fighting after 15 s (head ${head(b).hp.toFixed(0)})`;
      if (head(b).hp > head(b).maxHp * 0.85 && b.upright) return 'with a bat, it ended without the other one hurt';
      // a pistol: shoots from where it is instead of closing in
      kit.reset();
      const c = human(-3);
      const d = human(3, { flip: true });
      kit.advance(1);
      const gun = arm(c, 'pistol');
      if (!gun) return 'could not put a pistol in someone’s hand';
      d.limbs.get('upperTorso')!.part.setFrozen(true);
      c.fight(d, false);
      kit.advance(3);
      const gap = Math.abs(d.limbs.get('upperTorso')!.part.x - c.limbs.get('upperTorso')!.part.x);
      if (gun.shots < 1) return 'with a pistol, it never fired';
      if (gap < 2) return `with a pistol, it closed in to ${gap.toFixed(1)} m`;
      // "Fight each other" on a person and a dog, both picked
      kit.reset();
      const p = human(-2);
      const dog = kit.spawn('dog', 2, 0.6, { flip: true }) as Creature;
      kit.advance(1.5);
      controls.selection.clear();
      controls.selection.add(p);
      controls.selection.add(dog);
      if (!menu(p, 'Fight each other')) return 'no Fight each other for a person and a dog picked together';
      controls.selection.clear();
      if (p.foe !== dog || dog.foe !== p) return 'Fight each other: they are not set on each other';
      let bites = 0;
      let blows = 0;
      const pd = p.damage.bind(p);
      p.damage = (...x) => { bites++; return pd(...x); };
      const dd = dog.damage.bind(dog);
      dog.damage = (...x) => { blows++; return dd(...x); };
      for (let i = 0; i < 40 && (p.foe || dog.foe) && (!bites || !blows); i++) kit.advance(0.25);
      if (!bites || !blows) return `in 10 s the dog bit ${bites} times, and was hit ${blows} times`;
      return true;
    }],
    ['extra: fighting: saved and loaded mid-fight they carry on; Stop fighting ends it', () => {
      kit.reset();
      const a = human(-2);
      const b = kit.spawn('pig', 2, 0.6, { flip: true }) as Creature;
      kit.advance(1);
      a.fight(b);
      kit.advance(0.5);
      loadFromString(game, saveToString(game));
      const a2 = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      const b2 = game.entities.find((e) => e.def.id === 'pig') as Creature | undefined;
      if (!a2 || !b2) return 'lost them in the save';
      if (a2.foe !== b2 || b2.foe !== a2) return 'loaded, they are no longer fighting each other';
      if (!menu(a2, 'Stop fighting')) return 'no Stop fighting in the fighter’s menu';
      if (foeOf(a2)) return 'Stop fighting left them fighting';
      return true;
    }],
  ];
}

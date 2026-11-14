import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { UI } from '../../ui/UI';
import { getItem } from '../../catalog/items';
import { grantMode } from '../../world/GrantMode';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Grant: short, broad and built different, in the toybox only in Grant mode (a secret setting). */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const ui = () => controls.ui as unknown as UI;
  const grant = (x: number, y = 0.9, flip = false) => kit.spawn('grant', x, y, { flip }) as Human;
  const person = (x: number, y = 0.9, flip = false) => kit.spawn('human', x, y, { flip }) as Human;
  /** How tall someone stands: the top of their head over the floor (m). */
  const height = (h: Human) => {
    const head = h.limbs.get('head')!.part;
    return head.y + head.h / 64;
  };
  /** Fires a frozen gun at height y, from 2.5 m to the left of x, `n` times. */
  const volley = (id: string, x: number, y: number, n: number) => {
    const g = kit.spawn(id, x - 2.5, y) as Firearm;
    g.setFrozen(true);
    kit.advance(0.1);
    for (let i = 0; i < n; i++) {
      g.fire();
      kit.advance(0.12);
    }
  };
  /** Does the same to a person and to Grant, spawned `y` up: who of them is alive after it. */
  const both = (harm: (who: Human) => void, y = 0.9): [boolean, boolean] => {
    const out: boolean[] = [];
    for (const make of [person, grant]) {
      kit.reset();
      const h = make(0, y);
      kit.advance(1.5);
      harm(h);
      out.push(h.alive);
    }
    return [out[0], out[1]];
  };
  return [
    ['extra: grant: Grant is in the toybox only in Grant mode, a setting Settings shows once "grant" is typed there (the keys spelling it out not reaching the scene)', () => {
      kit.reset();
      const was = { on: grantMode.on, found: grantMode.found };
      grantMode.found = false;
      const row = [...document.querySelectorAll<HTMLElement>('.settings-panel .set-row')].find((r) => r.textContent?.startsWith('Grant mode'));
      const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!row || !box) return 'no Grant mode row in Settings';
      row.classList.add('hidden');
      if (box.checked) box.click();
      /** The Grant mode row is to be seen in Settings (not merely without the class that hides it). */
      const shown = () => getComputedStyle(row).display !== 'none';
      const search = document.querySelector<HTMLInputElement>('.catalog .search')!;
      const listed = () => {
        search.value = 'grant';
        search.dispatchEvent(new Event('input'));
        const names = [...document.querySelectorAll('.catalog .items .item-name')].map((e) => e.textContent);
        search.value = '';
        search.dispatchEvent(new Event('input'));
        return names.includes('Grant');
      };
      const type = (word: string) => {
        for (const ch of word) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true }));
        }
      };
      try {
        if (listed()) return 'Grant is in the toybox with Grant mode off';
        if (!getItem('grant')?.hidden) return 'Grant is not hidden with Grant mode off';
        // (typed with Settings shut, it's nothing)
        type('grant');
        if (shown()) return '"grant" typed with Settings shut showed Grant mode';
        controls.setTimeScale(1);
        ui().closeOverlays();
        document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title="Settings"]')!.click();
        if (document.querySelector('.settings-panel')!.parentElement!.classList.contains('hidden')) return 'Settings did not open';
        if (shown()) return 'Grant mode is in Settings before "grant" was typed';
        type('grnt');
        if (shown()) return 'a word other than "grant" showed Grant mode';
        type('grant');
        // (G is slow motion: spelling it out in Settings doesn't slow the scene)
        if (game.timeScale !== 1) return `typing "grant" in Settings set the speed to ${game.timeScale}`;
        if (!shown()) return '"grant" typed in Settings did not show Grant mode';
        if (!grantMode.found) return 'Grant mode found is not kept';
        box.click();
        if (!grantMode.on) return 'ticking Grant mode did not turn it on';
        if (!listed()) return 'with Grant mode on, Grant is not in the toybox';
        box.click();
        if (grantMode.on || listed()) return 'Grant mode turned off, Grant is still in the toybox';
        // (and on a phone: the code put in the Code box)
        grantMode.found = false;
        row.classList.add('hidden');
        const code = document.querySelector<HTMLInputElement>('.settings-panel .set-code');
        if (!code) return 'no Code box in Settings';
        code.value = 'nope';
        code.dispatchEvent(new Event('input'));
        if (shown()) return 'a wrong code showed Grant mode';
        code.value = ' Grant';
        code.dispatchEvent(new Event('input'));
        if (!shown()) return '"Grant" put in the Code box did not show Grant mode';
        return true;
      } finally {
        ui().closeOverlays();
        controls.setTimeScale(1);
        if (box.checked !== was.on) box.click();
        grantMode.found = was.found;
        row.classList.toggle('hidden', !was.found);
      }
    }],
    ['extra: grant: Grant stands still about four fifths as tall as anyone, heavier, and gets up again knocked down', () => {
      kit.reset();
      const h = person(-0.6);
      const g = grant(0.6);
      kit.advance(2);
      if (g.state !== 'stand') return `Grant spawned ${g.state}`;
      if (kit.maxSpeed() > 0.08) return `Grant is still moving at ${kit.maxSpeed().toFixed(2)} m/s, 2 s after he was spawned`;
      const r = height(g) / height(h);
      if (r < 0.74 || r > 0.84) return `Grant is ${height(g).toFixed(2)} m tall to a person's ${height(h).toFixed(2)} m (${(r * 100).toFixed(0)}%)`;
      if (g.totalMass() < h.totalMass()) return `Grant weighs ${g.totalMass().toFixed(0)} kg, less than a person's ${h.totalMass().toFixed(0)}`;
      // (out cold a moment, as from a stun gun: he goes down)
      g.stun(1);
      let t = 0;
      let fell = false;
      while (t < 12 && !(fell && g.state === 'stand')) {
        fell ||= g.state !== 'stand';
        kit.advance(0.25);
        t += 0.25;
      }
      if (!fell) return 'stunned, Grant stayed on his feet (the test no longer tests getting up)';
      if (g.state !== 'stand') return `stunned for a second, Grant was still ${g.state} 12 s later`;
      return true;
    }],
    ['extra: grant: what kills anyone Grant lives through: 30 rifle rounds to the chest, a sniper round to the head, a grenade at his feet, a 40 m fall', () => {
      const chest = (h: Human) => h.limbs.get('upperTorso')!.part.y;
      const cases: [string, (h: Human) => void, number?][] = [
        ['30 rifle rounds to the chest', (h) => {
          volley('rifle', h.center().x, chest(h), 30);
          kit.advance(4);
        }],
        ['a sniper round to the head', (h) => {
          volley('sniper', h.center().x, h.limbs.get('head')!.part.y, 1);
          kit.advance(3);
        }],
        ['a grenade at the feet', (h) => {
          const g = kit.spawn('grenade', h.center().x + 0.25, 0.2) as unknown as { detonate(): void };
          g.detonate();
          kit.advance(5);
        }],
        // (not 30 m: through the air that's about 22 m/s, right on the edge; some live through it)
        ['a 40 m fall', () => kit.advance(6), 40],
      ];
      for (const [what, harm, y] of cases) {
        const [p, g] = both(harm, y);
        if (p) return `a person lived through ${what} (the test no longer tests anything)`;
        if (!g) return `${what} killed Grant`;
      }
      return true;
    }],
    ['extra: grant: Grant’s punch sends a person flying; the Death syringe only knocks him out, the Zombie virus doesn’t take, and a nuke still kills him', () => {
      kit.reset();
      const g = grant(-0.5);
      const h = person(0.6, 0.9, true);
      kit.advance(1);
      const x0 = h.center().x;
      g.fight(h);
      let far = 0;
      for (let t = 0; t < 6; t += 0.25) {
        kit.advance(0.25);
        far = Math.max(far, h.center().x - x0);
      }
      if (far < 2) return `a punch of Grant's knocked a person at most ${far.toFixed(1)} m back`;
      kit.reset();
      const g2 = grant(0);
      kit.advance(1);
      g2.inject('death', 1);
      kit.advance(1);
      if (!g2.alive) return 'the Death syringe killed Grant';
      if (g2.consciousness > 0.3) return 'the Death syringe did not knock Grant out';
      kit.advance(30);
      if (g2.consciousness < 0.9) return `30 s after the Death syringe, Grant has come round only ${(g2.consciousness * 100).toFixed(0)}%`;
      g2.inject('zombie', 1);
      kit.advance(15);
      if (g2.infection > 0 || g2.zombie) return 'the Zombie virus took hold of Grant';
      game.explosions.nuke(1, 0.5, 1, null);
      kit.advance(4);
      if (g2.alive) return 'Grant lived through a nuke going off a metre away';
      return true;
    }],
    ['extra: grant: hurt, Grant heals by himself and his blood comes back; saved and loaded, he is still Grant', () => {
      kit.reset();
      const g = grant(0);
      kit.advance(1);
      const arm = g.limbs.get('upperArmF')!;
      arm.part.hp = arm.part.maxHp * 0.2;
      g.blood = 60;
      kit.advance(20);
      if (arm.part.hp < arm.part.maxHp * 0.5) return `20 s on, his arm has healed only to ${((arm.part.hp / arm.part.maxHp) * 100).toFixed(0)}%`;
      if (g.blood < 75) return `20 s on, his blood is only back to ${g.blood.toFixed(0)}%`;
      const tall = height(g);
      loadFromString(game, saveToString(game));
      const back = game.entities.find((e): e is Human => e.def.id === 'grant');
      if (!back) return 'loaded, there is no Grant';
      kit.advance(2);
      if (back.state !== 'stand') return `loaded, Grant is ${back.state}`;
      if (Math.abs(height(back) - tall) > 0.05) return `loaded, Grant is ${height(back).toFixed(2)} m tall (was ${tall.toFixed(2)})`;
      if (!back.hardy) return 'loaded, Grant is no longer built different';
      return true;
    }],
  ];
}

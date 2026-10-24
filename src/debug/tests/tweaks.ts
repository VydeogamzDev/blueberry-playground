import type { Test, TestCtx } from './types';
import type { Firearm } from '../../entities/Firearm';
import type { Explosive } from '../../entities/Explosive';
import type { Human } from '../../entities/Human';
import type { ActionId } from '../../tools/Bindings';
import { TOOLS } from '../../tools/Controls';
import { getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Controls tweaks: spawning frozen or switched on, editing guns, the laser rifle in hand, spring stiffness, volume. */
export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  const key = (id: ActionId) => controls.bindings.keys(id)[0];
  const springKey = `tool${TOOLS.indexOf('spring') + 1}` as ActionId;
  const hp = (h: Human) => h.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  /** A gun's numbers as Edit gun… shows them. */
  const tuned = (g: Firearm) => Object.fromEntries(g.editor().fields.map((f) => [f.key, f.get()]));

  return [
    ['extra: tweaks: holding Z while spawning places it frozen and takes nothing back; Z on a thing freezes it', () => {
      kit.reset();
      const z = key('freeze');
      const e = key('spawnRight');
      if (z !== 'KeyZ') return `freeze is on ${z}, not Z`;
      if (!e) return 'spawn key unbound';
      controls.arm(getItem('crate')!);
      kit.move(-2, 1.5);
      kit.advance(0.05);
      kit.press(e);
      const first = game.entities[game.entities.length - 1];
      kit.move(1.5, 1.5);
      kit.advance(0.05);
      kit.key(z, true);
      kit.press(e);
      kit.key(z, false);
      const second = game.entities[game.entities.length - 1];
      if (game.entities.length !== 2) return `${game.entities.length} objects after two spawns, one with Z held`;
      if (first.destroyed) return 'Z held while spawning took back the crate before';
      if (!second.frozen) return 'the crate spawned with Z held is not frozen';
      if (first.frozen) return 'the crate spawned without Z is frozen';
      const y0 = second.parts[0].y;
      kit.advance(0.5);
      if (Math.abs(second.parts[0].y - y0) > 1e-4) return `the frozen crate moved (${y0.toFixed(3)} -> ${second.parts[0].y.toFixed(3)})`;
      // Z over a thing freezes (or unfreezes) it, and takes nothing away
      kit.move(first.parts[0].x, first.parts[0].y);
      kit.advance(0.05);
      kit.press(z);
      kit.move(second.parts[0].x, second.parts[0].y);
      kit.advance(0.05);
      kit.press(z);
      controls.arm(null);
      if (first.destroyed || second.destroyed) return `Z over a crate removed ${first.destroyed ? 'the first' : 'the second'}`;
      if (!first.frozen) return 'Z over the unfrozen crate did not freeze it';
      if (second.frozen) return 'Z over the frozen crate did not unfreeze it';
      return true;
    }],
    ['extra: tweaks: holding F while spawning a grenade pulls its pin (and F sets nothing else off)', () => {
      kit.reset();
      const f = key('activate');
      const e = key('spawnRight');
      if (!f || !e) return 'activate or spawn key unbound';
      // a selected grenade, which F alone would set off
      const other = kit.spawn('grenade', -3, 0.3) as Explosive;
      controls.selection.add(other);
      controls.arm(getItem('grenade')!);
      kit.move(2, 1);
      kit.advance(0.05);
      kit.key(f, true);
      kit.press(e);
      kit.key(f, false);
      const g = game.entities.find((x) => x !== other && x.def.id === 'grenade') as Explosive | undefined;
      if (!g) {
        controls.arm(null);
        return 'no grenade spawned';
      }
      if (!g.armed) return 'the grenade spawned with F held still has its pin in';
      if (other.armed) return 'F held while spawning also set off the selected grenade';
      // F let go with nothing spawned meanwhile does what it always does
      kit.press(f);
      controls.arm(null);
      if (!other.armed) return 'F on its own did not set off the selected grenade';
      return true;
    }],
    ['extra: tweaks: an edited gun keeps its numbers through save/load and copy/paste; new ones have the defaults', () => {
      kit.reset();
      const probe = kit.spawn('pistol', -4, 0.3) as Firearm;
      const stock = tuned(probe);
      game.remove(probe);
      const g = kit.spawn('pistol', 0, 1.5) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      // through the context menu's Edit gun… panel
      kit.down(g.main.x, g.main.y, 2);
      kit.up(g.main.x, g.main.y, 2);
      const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => d.textContent?.startsWith('Edit gun'));
      if (!item) {
        controls.ui.closeContextMenu();
        return 'no Edit gun… in the pistol’s context menu';
      }
      item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      const want: Record<string, number> = { recoil: 9, damage: 77, pellets: 4, rate: 0.5, energy: 2500 };
      for (const [k, v] of Object.entries(want)) {
        const box = document.querySelector<HTMLInputElement>(`.edit-panel .edit-row[data-key="${k}"] .edit-num`);
        if (!box) {
          controls.ui.closeOverlays();
          return `no ${k} box in the Edit gun… panel`;
        }
        box.value = String(v);
        box.dispatchEvent(new Event('change'));
      }
      controls.ui.closeOverlays();
      if (document.querySelector('.edit-panel')) return 'the Edit gun… panel did not close';
      const differs = (x: Firearm | undefined, ref: Record<string, number>, where: string): string | null => {
        if (!x) return `${where}: no pistol`;
        const got = tuned(x);
        for (const [k, v] of Object.entries(ref)) if (Math.abs(got[k] - v) > 1e-6) return `${where}: ${k} is ${got[k]}, not ${v}`;
        return null;
      };
      const pistols = () => game.entities.filter((x) => x.def.id === 'pistol') as Firearm[];
      let bad = differs(g, want, 'edited in the panel');
      if (bad) return bad;
      loadFromString(game, saveToString(game));
      const loaded = pistols()[0];
      if ((bad = differs(loaded, want, 'after save/load'))) return bad;
      controls.copy([loaded]);
      kit.move(3, 2);
      kit.advance(0.02);
      controls.paste();
      const pasted = pistols().find((x) => x !== loaded);
      if ((bad = differs(pasted, want, 'pasted'))) return bad;
      const later = kit.spawn('pistol', -3, 0.3) as Firearm;
      if ((bad = differs(later, stock, 'a pistol spawned afterwards'))) return bad;
      loaded.editor().reset();
      if ((bad = differs(loaded, stock, 'after Reset to defaults'))) return bad;
      return true;
    }],
    ['extra: tweaks: more bullets per shot fire more bullets', () => {
      kit.reset();
      const g = kit.spawn('pistol', 0, 2) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      const shot = () => {
        const n0 = game.projectiles.count;
        g.fire();
        return game.projectiles.count - n0;
      };
      const one = shot();
      kit.advance(0.5);
      g.editor().fields.find((f) => f.key === 'pellets')!.set(6);
      const six = shot();
      if (one !== 1 || six !== 6) return `bullets in flight from one shot: ${one} as it comes, ${six} with 6 per shot`;
      return true;
    }],
    ['extra: tweaks: a person holding the laser rifle fires it when activated, and keeps firing while held', () => {
      kit.reset();
      const a = human(-1.5);
      const b = human(1.5);
      kit.advance(1);
      const g = arm(a, 'laser-rifle');
      if (!g) return 'the person did not take the laser rifle';
      const hpA = hp(a);
      const hpB = hp(b);
      const s0 = g.shots;
      a.activate();
      kit.advance(0.1);
      if (g.shots === s0) return 'activating the person did not fire the laser rifle';
      if (hp(b) > hpB - 5) return `the person in front took ${(hpB - hp(b)).toFixed(1)} damage (the shooter took ${(hpA - hp(a)).toFixed(1)}; beam from ${g.main.x.toFixed(2)}, ${g.main.y.toFixed(2)} at ${g.main.a.toFixed(2)} rad)`;
      // held (F on the person), the beam keeps coming, like an automatic's bullets
      const s1 = g.shots;
      controls.activate([a], true);
      kit.advance(1);
      controls.releaseActivation();
      if (g.shots - s1 < 3) return `held for 1 s: ${g.shots - s1} beams (about ${Math.round(g.gun.rate)} expected)`;
      return true;
    }],
    ['extra: tweaks: the Spring tool’s key over a spring changes its stiffness, kept through save/load', () => {
      kit.reset();
      const top = kit.spawn('metal-box', 0, 3.6);
      top.setFrozen(true);
      const box = kit.spawn('crate', 0, 1.7);
      kit.advance(0.02);
      const tp = top.parts[0];
      const bp = box.parts[0];
      const c = game.connections.create('spring', tp, { x: tp.x, y: tp.y }, bp, { x: bp.x, y: bp.y });
      if (!c) return 'spring not made';
      // how far it hangs past its rest length, on average over a second
      const stretch = () => {
        let s = 0;
        let n = 0;
        game.advance(1, () => {
          s += Math.hypot(bp.x - tp.x, bp.y - tp.y) - c.rest;
          n++;
        });
        return s / n;
      };
      kit.advance(2);
      const soft = stretch();
      const k = key(springKey);
      if (!k) return 'the Spring tool has no key';
      controls.setTool('spring');
      kit.move(tp.x, (tp.y + bp.y) / 2);
      kit.advance(0.02);
      kit.press(k);
      const k1 = c.stiffness ?? 1;
      if (k1 <= 1) {
        controls.setTool('drag');
        return `stiffness ${k1} after pressing ${k} over the spring`;
      }
      kit.advance(2);
      const stiff = stretch();
      if (!(stiff < soft * 0.6)) {
        controls.setTool('drag');
        return `hangs ${soft.toFixed(3)} m past rest at first, ${stiff.toFixed(3)} m at ${k1}× stiffness`;
      }
      // away from springs, it sets the stiffness of the springs to be made
      kit.move(6, 4);
      kit.advance(0.02);
      const before = controls.springStiffness;
      kit.press(k);
      const after = controls.springStiffness;
      controls.springStiffness = 1;
      controls.setTool('drag');
      if (after === before) return `the key away from springs left new springs at ${before}×`;
      loadFromString(game, saveToString(game));
      const sp = game.connections.list.find((x) => x.kind === 'spring');
      if ((sp?.stiffness ?? 1) !== k1) return `after save/load the spring is ${sp ? (sp.stiffness ?? 1) + '×' : 'gone'} (was ${k1}×)`;
      return true;
    }],
    ['extra: tweaks: the volume settings set the master and effects gain, and are kept', () => {
      const s = game.sound;
      const vol = document.querySelector<HTMLInputElement>('input.set-volume');
      const fx = document.querySelector<HTMLInputElement>('input.set-effects');
      if (!vol || !fx) return 'no volume sliders in the settings';
      const was = { volume: s.volume, effects: s.effects, muted: s.muted };
      const slide = (el: HTMLInputElement, v: number) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input'));
      };
      s.unlock();
      s.setMuted(false);
      try {
        slide(vol, 0.25);
        slide(fx, 0.4);
        if (Math.abs(s.masterGain - 0.25) > 1e-6) return `master gain ${s.masterGain} with the volume at 0.25`;
        if (Math.abs(s.effectsGain - 0.4) > 1e-6) return `effects gain ${s.effectsGain} with the effects volume at 0.4`;
        const kept = JSON.parse(localStorage.getItem('blueberry-sound') ?? '{}') as { volume?: number; effects?: number };
        if (kept.volume !== 0.25 || kept.effects !== 0.4) return `not kept in the browser (${JSON.stringify(kept)})`;
        s.setMuted(true);
        if (s.masterGain !== 0) return `muted, the master gain is ${s.masterGain}`;
        return true;
      } finally {
        s.setVolume(was.volume);
        s.setEffects(was.effects);
        s.setMuted(was.muted);
        vol.value = String(was.volume);
        fx.value = String(was.effects);
      }
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Explosive } from '../../entities/Explosive';
import type { Firearm } from '../../entities/Firearm';
import type { Flask } from '../../entities/Flask';
import type { Human } from '../../entities/Human';
import type { Item } from '../../entities/Item';
import type { Entity } from '../../world/Entity';
import { PX } from '../../engine/constants';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/**
 * Logic gaps in items, weapons and the commands on them: things a player tries
 * in their first hour that did something other than the obvious (or nothing).
 */
export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  /** Steps the world until `done()`, or for `limit` s: how long it took (Infinity: it never was). */
  const until = (limit: number, done: () => boolean): number => {
    let t = 0;
    while (t < limit) {
      game.step();
      t += game.stepDt;
      if (done()) return t;
    }
    return Infinity;
  };
  /** The gap (m) between two things side by side, a left of b. */
  const gap = (a: Entity, b: Entity): number => {
    const pa = a.parts[0];
    const pb = b.parts[0];
    return pb.x - (pb.w * PX) / 2 - (pa.x + (pa.w * PX) / 2);
  };
  /** The pyro power held at (x, y) for `steps` physics steps, or until `done()`: how many it took. */
  const pyro = (x: number, y: number, steps: number, done: () => boolean = () => false): number => {
    let n = 0;
    while (n < steps && !done()) {
      controls.powers.step('pyro', x, y, { x: 0, y: 0 }, game.stepDt);
      game.step();
      n++;
    }
    return n;
  };
  const toast = () => document.querySelector('.toast')?.textContent ?? '';

  return [
    ['extra: logic: fire lights the round bomb (a burning crate beside it, or Ignite), as its description says', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      const bomb = kit.spawn('bomb', 0.75, 0.4) as Explosive;
      // (held still: a round bomb rolls)
      crate.setFrozen(true);
      bomb.setFrozen(true);
      kit.advance(0.2);
      game.fire.ignite(crate.parts[0], 1);
      const t = until(8, () => bomb.destroyed);
      if (!Number.isFinite(t)) {
        return `a bomb ${gap(crate, bomb).toFixed(2)} m from a burning crate never went off in 8 s (burning ${bomb.parts[0].burning.toFixed(2)}, armed ${bomb.armed})`;
      }
      kit.reset();
      const b = kit.spawn('bomb', 0, 0.4) as Explosive;
      b.setFrozen(true);
      kit.advance(0.2);
      controls.toggleFire([b]);
      const t2 = until(3, () => b.destroyed);
      if (!Number.isFinite(t2)) return `Ignite on a bomb: still there 3 s later (burning ${b.parts[0].burning.toFixed(2)}, armed ${b.armed})`;
      return true;
    }],
    ['extra: logic: an explosive barrel beside a fire catches and goes off ("goes off when ... burned")', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      const barrel = kit.spawn('explosive-barrel', 0.75, 0.42) as Explosive;
      crate.setFrozen(true);
      barrel.setFrozen(true);
      kit.advance(0.2);
      game.fire.ignite(crate.parts[0], 1);
      const t = until(10, () => barrel.destroyed);
      if (!Number.isFinite(t)) {
        return `an explosive barrel ${gap(crate, barrel).toFixed(2)} m from a burning crate still there after 10 s (burning ${barrel.parts[0].burning.toFixed(2)}, armed ${barrel.armed})`;
      }
      return true;
    }],
    ['extra: logic: one pistol shot sets off an explosive barrel ("goes off when shot")', () => {
      kit.reset();
      const barrel = kit.spawn('explosive-barrel', 3, 0.42) as Explosive;
      const gun = kit.spawn('pistol', 0, 0.45) as Firearm;
      kit.advance(0.3);
      gun.main.teleport(0, 0.45, 0);
      gun.setFrozen(true);
      gun.fire();
      kit.advance(0.3);
      if (!barrel.destroyed) return `one pistol shot (${gun.gun.damage} damage, ${barrel.blast.sensitivity} to set it off) left the barrel standing (armed ${barrel.armed})`;
      return true;
    }],
    ['extra: logic: someone stepping onto a landmine sets it off (a foot is light, but carries the whole person)', () => {
      kit.reset();
      const mine = kit.spawn('landmine', 0, 0.08) as Explosive;
      kit.advance(0.5);
      // standing on its top (16 cm up), as if they'd stepped onto it
      const h = kit.spawn('human', 0, 1.08) as Human;
      const t = until(1, () => mine.armed || mine.destroyed);
      if (!Number.isFinite(t)) {
        const feet = [h.limbs.get('footF')!, h.limbs.get('footB')!].map((l) => l.part.mass.toFixed(2)).join(' and ');
        return `someone standing on a landmine for 1 s did not set it off (feet of ${feet} kg; ${h.status()})`;
      }
      return true;
    }],
    ['extra: logic: a lightning bolt sets off C4', () => {
      kit.reset();
      const c4 = kit.spawn('c4', 3, 0.12) as Explosive;
      kit.advance(0.5);
      const p = c4.parts[0];
      // flicked to the right from 3 m away
      controls.powers.step('lightning', 0, p.y, { x: 4000, y: 0 }, game.stepDt);
      const t = until(1, () => c4.destroyed);
      if (!Number.isFinite(t)) return `C4 struck by lightning still there 1 s later (armed ${c4.armed}, burning ${p.burning.toFixed(2)}, charred ${p.charred.toFixed(2)})`;
      return true;
    }],
    ['extra: logic: a single activation of the minigun (menu, pulse, Use) spins it up and fires a short burst', () => {
      kit.reset();
      const g = kit.spawn('minigun', 0, 0.3) as Firearm;
      kit.advance(0.5);
      g.setFrozen(true);
      g.activate();
      kit.advance(1.6);
      const n = g.shots;
      if (n < 5) return `activated once, the minigun fired ${n} shots in 1.6 s (it spins up in ${g.gun.spinUp} s)`;
      kit.advance(1);
      if (g.shots !== n) return `activated once, it kept on firing: ${n} shots, then ${g.shots - n} more in the next second`;
      return true;
    }],
    ['extra: logic: a pistol shot shatters a glass pane', () => {
      kit.reset();
      const pane = kit.spawn('glass', 3, 1.5);
      pane.setFrozen(true);
      const gun = kit.spawn('pistol', 0, 1.5) as Firearm;
      kit.advance(0.3);
      gun.main.teleport(0, 1.5, 0);
      gun.setFrozen(true);
      const hp0 = pane.parts[0].hp;
      gun.fire();
      kit.advance(0.2);
      if (!pane.destroyed) return `a pistol shot through a glass pane left it standing (hp ${pane.parts[0].hp.toFixed(1)} of ${hp0.toFixed(1)})`;
      return true;
    }],
    ['extra: logic: Ignite on something that can\'t burn says so; on a molotov it lights the rag', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.45);
      kit.advance(0.3);
      controls.ui.toast('');
      controls.toggleFire([box]);
      if (box.parts[0].burning > 0) return `a dry metal box caught fire (${box.parts[0].burning.toFixed(2)})`;
      if (!toast().includes(box.label)) return `Ignite on a metal box did nothing, and the status bar says "${toast()}"`;
      if (controls.history.canUndo) return 'an Ignite that did nothing was kept for undo';
      const m = kit.spawn('molotov', 2, 0.4) as Entity & { lit: boolean };
      kit.advance(0.3);
      controls.toggleFire([m]);
      if (!m.lit || m.destroyed) return `Ignite on a molotov: its rag ${m.lit ? 'lit' : 'not lit'}, and it ${m.destroyed ? 'smashed' : 'is whole'}`;
      return true;
    }],
    ['extra: logic: the pyro power bursts a flask of oil, and sets a frozen plank alight', () => {
      kit.reset();
      const f = kit.spawn('flask-oil', 0, 0.3) as Flask;
      kit.advance(0.5);
      const n = pyro(f.main.x, f.main.y, 30, () => f.destroyed);
      if (!f.destroyed) return `held in the pyro's flame for ${n} steps, a flask of oil is still whole`;
      kit.reset();
      const plank = kit.spawn('plank', 0, 2).parts[0];
      plank.setFrozen(true);
      kit.advance(0.2);
      pyro(plank.x, plank.y, 10);
      if (plank.burning <= 0) return 'a frozen plank held in the pyro\'s flame for 10 steps did not catch';
      return true;
    }],
    ['extra: logic: flipping a gun someone holds turns them round with it, still in their hand', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const gun = arm(h, 'pistol');
      if (!gun) return 'could not put a pistol in someone\'s hand';
      controls.flip([gun]);
      const people = game.entities.filter((e) => e.def.id === 'human') as Human[];
      if (people.length !== 1) return `${people.length} people after flipping the gun`;
      const p = people[0];
      kit.advance(1);
      const loose = game.entities.filter((e) => e.def.id === 'pistol' && !p.heldItems().includes(e as Item)).length;
      if (p.heldItems().length !== 1) return `flipping the gun they held left them holding ${p.heldItems().length} things (${loose} pistol lying loose)`;
      if (p.flipped === h.flipped) return 'flipping the gun they held did not turn them round';
      return true;
    }],
    ['extra: logic: a bat in someone\'s hand can be dropped from its own menu', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const bat = arm(h, 'bat') as Item | undefined;
      if (!bat) return 'could not put a bat in someone\'s hand';
      const drop = bat.contextActions().find((a) => a.label === 'Drop');
      if (!drop) return `a held bat's own menu offers [${bat.contextActions().map((a) => a.label).join(', ')}], no Drop`;
      drop.action();
      if (h.heldItems().length) return 'Drop left the bat in their hand';
      return true;
    }],
    ['extra: logic: a grenade with its pin pulled no longer shows the pin, after save and load too', () => {
      kit.reset();
      const g = kit.spawn('grenade', 0, 0.3) as Explosive;
      g.setFrozen(true);
      kit.advance(0.2);
      const [px, py] = g.blast.pin!;
      const pin = g.main.art.get(px, py);
      g.activate();
      if (g.main.art.get(px, py) === pin) return 'its pin pulled, the grenade still shows it';
      loadFromString(game, saveToString(game));
      const back = game.entities.find((e) => e.def.id === 'grenade') as Explosive | undefined;
      if (!back?.armed) return 'loaded, the grenade was no longer live';
      if (back.main.art.get(px, py) === pin) return 'loaded, the live grenade shows its pin again';
      return true;
    }],
    ['extra: logic: a flask dropped from 3 m smashes and splashes, as glass does', () => {
      kit.reset();
      const f = kit.spawn('flask-water', 0, 3) as Flask;
      const t = until(2, () => f.destroyed);
      if (!Number.isFinite(t)) return `a flask dropped from 3 m landed whole (hp ${f.main.hp.toFixed(1)} of ${f.main.maxHp})`;
      kit.advance(2);
      if (game.puddles.total < 5) return `smashed, it splashed only ${game.puddles.total.toFixed(1)} px² of water on the floor`;
      return true;
    }],
  ];
}

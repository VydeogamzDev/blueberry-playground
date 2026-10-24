import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { ActionId } from '../../tools/Bindings';
import { Molotov, RAG_TIME } from '../../entities/Molotov';
import { RocketLauncher, Rocket } from '../../entities/RPG';
import { PX, WORLD } from '../../engine/constants';
import { Liquid } from '../../systems/Liquids';
import { getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** The molotov cocktail and the RPG. */
export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  const key = (id: ActionId) => controls.bindings.keys(id)[0];
  const hp = (h: Human) => h.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  /** (read fresh: a shot is fired by calls the type checker can't see into) */
  const shots = (g: Firearm) => g.shots;
  const rockets = () =>game.entities.filter((e): e is Rocket => e instanceof Rocket && !e.destroyed);
  /** Steps the world until `done()`, or for `limit` s: how long it took (Infinity: it never was). */
  const until = (done: () => boolean, limit: number): number => {
    let t = 0;
    while (t < limit) {
      game.step();
      t += game.stepDt;
      if (done()) return t;
    }
    return Infinity;
  };
  /** Floor cells (of 1 px) from -w to w m where `on` holds. */
  const cells = (on: (x: number) => boolean, w = 4) => {
    let n = 0;
    for (let x = -w; x < w; x += PX) if (on(x)) n++;
    return n;
  };
  /** Picks a bottle up by its middle with the drag tool, lifts it over head height and slams it down into the floor: whether it broke. */
  const fling = (m: Molotov): boolean => {
    const at = m.main.pixelToWorld(4, 16);
    kit.down(at.x, at.y);
    for (let t = 1; t <= 24; t++) {
      kit.move(at.x, at.y + (2.4 * t) / 24);
      kit.advance(1 / 60);
    }
    const top = at.y + 2.4;
    for (let t = 1; t <= 14 && !m.destroyed; t++) {
      kit.move(at.x, Math.max(-0.6, top - (3.2 * t) / 8));
      kit.advance(1 / 60);
    }
    kit.up(at.x, -0.6);
    return m.destroyed;
  };
  /** Follows a rocket until it goes off (or for `limit` s): how far it got from where it was, and whether it went off. */
  const follow = (r: Rocket, limit: number) => {
    const x0 = r.main.x;
    const y0 = r.main.y;
    let x = x0;
    let y = y0;
    let t = 0;
    while (t < limit && !r.destroyed) {
      x = r.main.x;
      y = r.main.y;
      game.step();
      t += game.stepDt;
    }
    return { dist: Math.hypot(x - x0, y - y0), t, gone: r.destroyed };
  };

  return [
    ['extra: weapons2: a lit molotov slammed into the floor breaks, and the oil it splashes burns', () => {
      kit.reset();
      const m = kit.spawn('molotov', 0, 0.34) as Molotov;
      kit.advance(0.5);
      m.activate();
      if (!m.lit) return 'Use did not light the rag';
      kit.advance(0.3);
      if (!fling(m)) return 'slammed into the floor, the bottle did not break';
      const t = until(() => game.puddles.burningCells > 0, 2);
      if (!Number.isFinite(t)) return `no burning oil on the floor 2 s after it broke (${game.puddles.total.toFixed(1)} px² of oil, ${game.fire.count} fires)`;
      kit.advance(1);
      if (!game.puddles.burningCells) return 'the oil on the floor went out within a second';
      // left alone, a lit rag burns down into the bottle and sets it off where it stands
      kit.reset();
      const n = kit.spawn('molotov', 0, 0.34) as Molotov;
      kit.advance(0.5);
      n.activate();
      n.timer = 0.5;
      if (!Number.isFinite(until(() => n.destroyed, 1))) return `a rag burnt down to the neck did not set the bottle off (${n.timer.toFixed(2)} s of rag left)`;
      if (!Number.isFinite(until(() => game.puddles.burningCells > 0 || game.fire.count > 0, 2))) return 'burnt down, it broke without any fire';
      return true;
    }],
    ['extra: weapons2: an unlit molotov smashed on the floor only splashes oil', () => {
      kit.reset();
      const m = kit.spawn('molotov', 0, 0.34) as Molotov;
      kit.advance(0.5);
      if (!fling(m)) return 'slammed into the floor, the bottle did not break';
      kit.advance(2);
      const oil = cells((x) => game.puddles.kindAt(x) === Liquid.Oil);
      if (game.puddles.total < 8 || oil < 10) return `little oil on the floor: ${game.puddles.total.toFixed(1)} px² over ${oil} cells`;
      if (game.puddles.burningCells || game.fire.count) return `unlit, it started a fire (${game.puddles.burningCells} floor cells, ${game.fire.count} things burning)`;
      return true;
    }],
    ['extra: weapons2: a lit molotov dropped on a head sets the person on fire', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const head = h.limbs.get('head')!.part;
      const m = kit.spawn('molotov', head.x, head.y + 1) as Molotov;
      m.activate();
      m.main.body.setLinvel({ x: 0, y: -10 }, true);
      if (!Number.isFinite(until(() => m.destroyed, 0.5))) return 'it did not break on the head';
      const t = until(() => h.parts.some((p) => !p.destroyed && p.burning > 0), 1.5);
      if (!Number.isFinite(t)) return 'the person it broke on did not catch fire';
      return true;
    }],
    ['extra: weapons2: holding F while spawning a molotov lights its rag', () => {
      kit.reset();
      const f = key('activate');
      const e = key('spawnRight');
      if (!f || !e) return 'activate or spawn key unbound';
      controls.arm(getItem('molotov')!);
      kit.move(2, 1);
      kit.advance(0.05);
      kit.key(f, true);
      kit.press(e);
      kit.key(f, false);
      controls.arm(null);
      const m = game.entities.find((x): x is Molotov => x instanceof Molotov);
      if (!m) return 'no molotov spawned';
      if (!m.lit) return 'spawned with F held, its rag is not lit';
      return true;
    }],
    ['extra: weapons2: a shot breaks a molotov, splashing oil but no fire', () => {
      kit.reset();
      const g = kit.spawn('pistol', -2.5, 1.2) as Firearm;
      g.setFrozen(true);
      const mz = g.main.pixelToWorld(g.gun.muzzle[0], g.gun.muzzle[1]);
      // (its middle in line with the muzzle)
      const m = kit.spawn('molotov', 0.3, mz.y + (16 - 10.5) * PX) as Molotov;
      m.setFrozen(true);
      kit.advance(0.1);
      g.fire();
      if (!Number.isFinite(until(() => m.destroyed, 0.3))) return 'shot, the bottle did not break';
      kit.advance(2);
      if (game.puddles.total < 3) return `little oil splashed onto the floor (${game.puddles.total.toFixed(1)} px²)`;
      if (game.puddles.burningCells || game.fire.count) return 'an unlit bottle shot started a fire';
      return true;
    }],
    ['extra: weapons2: an RPG lying on the floor fires on F and from a wire, the rocket flying off before it goes off', () => {
      kit.reset();
      const x0 = WORLD.right - 25;
      const g = kit.spawn('rpg', x0, 0.3) as RocketLauncher;
      if (!(g instanceof RocketLauncher)) return 'the RPG is not a rocket launcher';
      kit.advance(1);
      if (!g.loaded) return 'spawned unloaded';
      const f = key('activate');
      if (!f) return 'activate key unbound';
      controls.selection.add(g);
      kit.press(f);
      controls.clearSelection();
      const r = rockets()[0];
      if (!r) return 'F fired no rocket';
      if (g.loaded || g.shots !== 1) return `after a shot: loaded ${g.loaded}, ${g.shots} shots`;
      const a = follow(r, 4);
      if (!a.gone) return 'the rocket flew 4 s without going off';
      if (a.dist < 3) return `the rocket went off only ${a.dist.toFixed(2)} m from the tube`;
      if (g.destroyed) return 'the launcher was destroyed by its own rocket';
      // the reload, then a pulse down a wire from a button fires it again
      if (!Number.isFinite(until(() => g.loaded, 1 / g.gun.rate + 0.5))) return `not reloaded ${(1 / g.gun.rate + 0.5).toFixed(1)} s after firing`;
      const btn = kit.spawn('button', x0 - 3, 0.1);
      kit.advance(0.3);
      const b = btn.parts[0];
      if (!game.connections.create('wire', b, { x: b.x, y: b.y }, g.main, { x: g.main.x, y: g.main.y })) return 'could not wire a button to it';
      game.connections.pulse(btn);
      if (shots(g) !== 2 || !rockets().length) return `a pulse down the wire did not fire it (${g.shots} shots)`;
      const c = follow(rockets()[0], 4);
      if (!c.gone || c.dist < 3) return `the wired shot went off ${c.dist.toFixed(2)} m out${c.gone ? '' : ' (or not at all)'}`;
      return true;
    }],
    ['extra: weapons2: a person fires an RPG unhurt, and it must reload before a second rocket', () => {
      kit.reset();
      const h = human(WORLD.right - 30);
      kit.advance(1);
      const g = arm(h, 'rpg');
      if (!(g instanceof RocketLauncher)) return 'could not give someone the RPG';
      kit.advance(0.5);
      const hp0 = hp(h);
      h.activate();
      if (g.shots !== 1) return `Use in hand fired ${g.shots} rockets`;
      h.activate();
      if (shots(g) !== 1 || rockets().length !== 1) return `fired again straight away (${g.shots} shots, ${rockets().length} rockets)`;
      const a = follow(rockets()[0], 4);
      if (!a.gone) return 'the rocket flew 4 s without going off';
      if (a.dist < 3) return `the rocket went off only ${a.dist.toFixed(2)} m out`;
      kit.advance(1);
      if (!h.alive) return 'firing it killed the person holding it';
      if (hp(h) < hp0 * 0.97) return `the person holding it was hurt: ${hp0.toFixed(0)} -> ${hp(h).toFixed(0)} hp`;
      if (!Number.isFinite(until(() => g.loaded, 1 / g.gun.rate))) return 'not reloaded';
      if (g.holder !== h) return 'dropped it firing';
      // Edit gun… shows only what an RPG has: its kick, its warhead and its reload time
      const ed = g.editor();
      const keys = ed.fields.map((x) => x.key).sort().join(',');
      if (keys !== 'damage,rate,recoil') return `Edit gun… shows ${keys}`;
      ed.fields.find((x) => x.key === 'rate')!.set(1);
      h.activate();
      if (shots(g) !== 2) return 'reloaded, Use in hand did not fire it again';
      const t = until(() => g.loaded, 1.5);
      if (Math.abs(t - 1) > 0.05) return `with the reload time set to 1 s it reloaded in ${t.toFixed(2)} s`;
      return true;
    }],
    ['extra: weapons2: a lit molotov, a reloading RPG and its rocket in flight save, load and duplicate', () => {
      kit.reset();
      const m = kit.spawn('molotov', WORLD.right - 45, 0.34) as Molotov;
      const g = kit.spawn('rpg', WORLD.right - 30, 0.3) as RocketLauncher;
      kit.advance(0.5);
      m.activate();
      kit.advance(1);
      g.activate();
      kit.advance(0.15);
      if (!rockets().length) return 'no rocket in flight to save';
      const timer = m.timer;
      loadFromString(game, saveToString(game));
      const m2 = game.entities.find((e): e is Molotov => e instanceof Molotov);
      const g2 = game.entities.find((e): e is RocketLauncher => e instanceof RocketLauncher);
      if (!m2 || !g2) return 'loading lost the molotov or the RPG';
      if (!m2.lit || Math.abs(m2.timer - timer) > 0.05) return `loaded, the molotov is ${m2.lit ? `lit with ${m2.timer.toFixed(2)} s of rag (saved ${timer.toFixed(2)})` : 'unlit'}`;
      if (g2.loaded) return 'loaded, the RPG has a rocket in again at once';
      if (rockets().length !== 1) return `loaded, ${rockets().length} rockets in flight`;
      const r = follow(rockets()[0], 4);
      if (!r.gone) return 'the loaded rocket never went off';
      if (!Number.isFinite(until(() => g2.loaded, 3))) return 'the loaded RPG never finished reloading';
      controls.duplicate([m2, g2]);
      kit.advance(1);
      const ms = game.entities.filter((e): e is Molotov => e instanceof Molotov);
      const gs = game.entities.filter((e) => e instanceof RocketLauncher);
      if (ms.length !== 2 || gs.length !== 2) return `duplicating made ${ms.length} molotovs and ${gs.length} RPGs`;
      if (!ms.every((x) => x.lit && x.timer < RAG_TIME)) return 'the copy of a lit molotov is not lit';
      return true;
    }],
  ];
}

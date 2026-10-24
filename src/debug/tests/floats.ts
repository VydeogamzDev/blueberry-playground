import type { Test, TestCtx } from './types';
import type { Balloon } from '../../entities/Balloon';
import type { Human } from '../../entities/Human';
import type { JetEngine } from '../../entities/JetEngine';
import type { Entity } from '../../world/Entity';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { PX } from '../../engine/constants';

export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const f = game.fluid;
  /** A 3 m by 1.5 m glass tank on the floor at x 0, two thirds full and settled. */
  const fullTank = () => {
    kit.reset();
    const tank = kit.spawn('glass-tank', 0, 0.75, { config: { w: 96, h: 48 } });
    kit.advance(0.3);
    kit.spawn('water', 0, 0.75, { config: { w: 90, h: 34 } });
    kit.advance(3);
    return tank;
  };
  /** How many particles are inside the tank (x within ±1.45 m, under its rim). */
  const inTank = () => {
    let n = 0;
    for (let i = 0; i < f.n; i++) if (Math.abs(f.x[i]) < 1.45 && f.y[i] < 1.5) n++;
    return n;
  };
  /** The water's surface across the tank's middle: the highest and lowest tops of 0.3 m columns. */
  const surface = () => {
    const tops: number[] = [];
    for (let c = -1.2; c < 1.2; c += 0.3) {
      let top = -Infinity;
      for (let i = 0; i < f.n; i++) if (f.x[i] >= c && f.x[i] < c + 0.3) top = Math.max(top, f.y[i]);
      tops.push(top);
    }
    return { lo: Math.min(...tops), hi: Math.max(...tops) };
  };
  /** The water's level in the tank: the middle of those tops (a splash or a wave's crest isn't it). */
  const waterLevel = () => {
    const tops: number[] = [];
    for (let c = -1.35; c < 1.35; c += 0.3) {
      let top = -Infinity;
      for (let i = 0; i < f.n; i++) if (f.x[i] >= c && f.x[i] < c + 0.3) top = Math.max(top, f.y[i]);
      tops.push(top);
    }
    return tops.sort((a, b) => a - b)[Math.floor(tops.length / 2)];
  };
  const y = (e: Entity) => e.parts[0].y;

  return [
    ['extra: water: a block of water poured into a glass tank stays in it and settles flat', () => {
      fullTank();
      const n = f.n;
      if (n < 900) return `a 90 by 34 px block made only ${n} particles`;
      kit.advance(3);
      if (inTank() < n * 0.97) return `only ${inTank()} of ${n} particles are in the tank`;
      const s = surface();
      if (s.hi - s.lo > 0.15) return `its surface is uneven: ${s.lo.toFixed(2)} to ${s.hi.toFixed(2)} m`;
      if (s.hi < 0.85 || s.hi > 1.2) return `its surface is at ${s.hi.toFixed(2)} m (a 1.06 m block in a tank on the floor)`;
      return true;
    }],
    ['extra: water: a wooden crate floats in it, a metal box sinks, and a buoyancy tube welded on keeps a metal box up', () => {
      fullTank();
      const level = surface().hi;
      const crate = kit.spawn('crate', -0.9, level + 0.5);
      const box = kit.spawn('metal-box', 0, level + 0.5);
      const held = kit.spawn('metal-box', 0.9, level + 0.5);
      const hp = held.parts[0];
      const top = { x: hp.x, y: hp.y + (hp.h / 2) * PX };
      const tube = kit.spawn('buoyancy-tube', top.x, top.y + 0.15);
      if (!game.connections.create('weld', hp, top, tube.parts[0], top)) return 'the tube could not be welded on';
      kit.advance(6);
      const lvl = waterLevel();
      if (y(crate) < lvl - 0.25) return `the crate is under water (${y(crate).toFixed(2)} m, the surface at ${lvl.toFixed(2)} m)`;
      if (y(box) > 0.7) return `the metal box did not sink (${y(box).toFixed(2)} m)`;
      if (y(held) < lvl - 0.6) return `with a tube on, the metal box sank to ${y(held).toFixed(2)} m (the surface at ${lvl.toFixed(2)} m)`;
      return true;
    }],
    ['extra: water: someone thrown in floats up again, and the water puts out a fire', () => {
      fullTank();
      const h = kit.spawn('human', 0.4, 2.6) as Human;
      const crate = kit.spawn('crate', -0.8, 2.2);
      game.fire.ignite(crate.parts[0], 0.8);
      kit.advance(5);
      const head = h.limbs.get('head')!.part;
      if (head.y < 0.6) return `their head is at ${head.y.toFixed(2)} m, on the bottom`;
      if (crate.parts[0].burning > 0) return 'the crate still burns, floating in water';
      return true;
    }],
    ['extra: water: saved and loaded, and undone, the water is still there', () => {
      fullTank();
      const n = f.n;
      loadFromString(game, saveToString(game));
      if (Math.abs(f.n - n) > 2) return `loaded, there are ${f.n} particles, not ${n}`;
      kit.advance(1);
      if (inTank() < n * 0.95) return `loaded, only ${inTank()} of ${n} are still in the tank`;
      // (an edit after it, undone: the water comes back as it was)
      const before = f.n;
      controls.history.record('Test');
      f.clear();
      controls.undo();
      if (Math.abs(f.n - before) > 2) return `undone, there are ${f.n} particles, not ${before}`;
      // what a guest is sent comes out the same
      const s = f.pack();
      const x0 = f.x[10];
      const vy0 = f.vy[10];
      f.unpack(s.n, s.xy, s.v);
      if (f.n !== s.n || f.x[10] !== x0 || Math.abs(f.vy[10] - vy0) > 0.01) return 'packed for a guest and unpacked, the water changed';
      return true;
    }],
    ['extra: water: a tap runs into a tank while on, and stops when turned off', () => {
      kit.reset();
      kit.spawn('glass-tank', 0, 0.5, { config: { w: 64, h: 32 } });
      const tap = kit.spawn('tap', -0.2, 1.6);
      tap.setFrozen(true);
      kit.advance(0.5);
      if (f.n) return 'it ran before it was turned on';
      tap.activate();
      kit.advance(4);
      const n = f.n;
      if (n < 150) return `in 4 s it ran only ${n} particles`;
      let inside = 0;
      for (let i = 0; i < f.n; i++) if (Math.abs(f.x[i]) < 1 && f.y[i] < 1) inside++;
      if (inside < n * 0.8) return `only ${inside} of ${n} landed in the tank under it`;
      tap.activate();
      kit.advance(1);
      const after = f.n;
      kit.advance(1);
      if (f.n > after) return 'turned off, it still runs';
      return true;
    }],
    ['extra: balloons: a big balloon tied to what is below it lifts a person off the ground; a party balloon only holds up 20 kg', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const big = kit.spawn('big-balloon', 0.05, 3.2) as Balloon;
      big.setFrozen(true);
      big.contextActions().find((a) => a.label.startsWith('Tie'))!.action();
      const rope = game.connections.list.find((c) => c.kind === 'rope' && (c.a.entity === big || c.b?.entity === big));
      if (!rope) return 'Tie to what’s below made no rope';
      if (rope.b?.entity !== h && rope.a.entity !== h) return `it tied it to ${rope.b ? rope.b.entity.def.id : 'the floor'}, not the person below it`;
      big.setFrozen(false);
      kit.advance(3);
      const feet = Math.min(h.limbs.get('footF')!.part.y, h.limbs.get('footB')!.part.y);
      if (feet < 1) return `in 3 s it lifted their feet to ${feet.toFixed(2)} m`;
      // a party balloon on a 60 kg person: they stay down
      kit.reset();
      const h2 = human(0);
      kit.advance(1);
      const small = kit.spawn('balloon', 0, 2.6) as Balloon;
      small.setFrozen(true);
      small.tieBelow();
      small.setFrozen(false);
      kit.advance(2);
      const feet2 = Math.min(h2.limbs.get('footF')!.part.y, h2.limbs.get('footB')!.part.y);
      if (feet2 > 0.3) return `one party balloon lifted a person ${feet2.toFixed(2)} m`;
      return true;
    }],
    ['extra: jet engine: it spools up over seconds, flies itself pointing up, and winds down when switched off', () => {
      kit.reset();
      let jet = kit.spawn('jet-engine', 0, 1, { angle: Math.PI / 2 }) as JetEngine;
      if (jet.forward().y < 0) {
        game.remove(jet);
        jet = kit.spawn('jet-engine', 0, 1, { angle: -Math.PI / 2 }) as JetEngine;
      }
      kit.advance(0.5);
      jet.activate();
      kit.advance(0.5);
      if (jet.spool > 0.4) return `half a second on, it is ${(jet.spool * 100).toFixed(0)}% spooled up`;
      const y0 = y(jet);
      kit.advance(2.5);
      if (jet.spool < 0.99) return `3 s on, it is only ${(jet.spool * 100).toFixed(0)}% spooled up`;
      if (y(jet) < y0 + 5) return `pointing up and spooled up, it rose only ${(y(jet) - y0).toFixed(1)} m`;
      jet.activate();
      kit.advance(1);
      if (jet.spool > 0.85 || jet.spool < 0.5) return `a second after switching off it is at ${(jet.spool * 100).toFixed(0)}% (it winds down over 4 s)`;
      return true;
    }],
    ['extra: jet engine: its blast blows a crate behind it away and sets what is close alight; its intake tears up someone in front', () => {
      kit.reset();
      const jet = kit.spawn('jet-engine', 0, 1) as JetEngine;
      jet.setFrozen(true);
      const behind = kit.spawn('crate', -3, 0.45);
      const front = human(1.2);
      kit.advance(0.8);
      jet.activate();
      kit.advance(4);
      if (behind.parts[0].x > -5) return `the crate 3 m behind it is only at x ${behind.parts[0].x.toFixed(1)}`;
      if (front.alive) return 'someone standing 1.2 m in front of its intake is unhurt';
      // (a crate held in the exhaust, close to the nozzle: it shields what's behind it, and burns)
      const close = kit.spawn('crate', -1.2, 1.0);
      close.setFrozen(true);
      kit.advance(3);
      if (!close.parts.some((p) => p.burning > 0 || p.charred > 0)) return 'a crate held in its exhaust 1 m from the nozzle did not catch fire';
      return true;
    }],
  ];
}

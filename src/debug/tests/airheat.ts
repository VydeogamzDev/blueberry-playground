import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { LAB, BUILTIN_MAPS } from '../../world/Maps';

/** The air (drag and lift, systems/Aero) and temperature (systems/Heat). */
export default function tests({ game, kit }: TestCtx): Test[] {
  const speed = (e: Entity) => Math.hypot(e.parts[0].vx, e.parts[0].vy);
  /** A thing floating free (no gravity), flung at (vx, vy). */
  const fling = (id: string, x: number, y: number, angle: number, vx: number, vy: number) => {
    const e = kit.spawn(id, x, y, { angle });
    for (const p of e.parts) p.setWeightless(true);
    e.setVelocity(vx, vy);
    return e;
  };
  return [
    ['extra: air: a plank flung broadside slows far more than one flung edge-on; something small and heavy hardly at all', () => {
      kit.reset();
      const broad = fling('plank', -20, 20, 0, 0, 25);
      const edge = fling('plank', 0, 20, 0, 25, 0);
      const brick = fling('brick', 20, 20, 0, 25, 0);
      kit.advance(0.5);
      const b = speed(broad);
      const e = speed(edge);
      const k = speed(brick);
      if (b > 20) return `broadside it still goes ${b.toFixed(1)} m/s after half a second`;
      if (e < 22) return `edge-on it slowed to ${e.toFixed(1)} m/s`;
      if (k < 23) return `a brick slowed to ${k.toFixed(1)} m/s`;
      if (b >= e - 3) return `broadside ${b.toFixed(1)}, edge-on ${e.toFixed(1)} m/s: hardly different`;
      return true;
    }],
    ['extra: air: a plank flown a little nose-up lifts like a wing (nose-down: pushed down); edge-on it neither', () => {
      kit.reset();
      const tilt = 0.12;
      const up = fling('plank', -20, 20, tilt, 30, 0);
      const down = fling('plank', 0, 20, -tilt, 30, 0);
      const flat = fling('plank', 20, 20, 0, 30, 0);
      kit.advance(0.3);
      const vu = up.parts[0].vy;
      const vd = down.parts[0].vy;
      const vf = flat.parts[0].vy;
      if (vu < 1.5) return `nose-up it rose only ${vu.toFixed(2)} m/s`;
      if (vd > -1.5) return `nose-down it sank only ${vd.toFixed(2)} m/s`;
      if (Math.abs(vf) > 0.3) return `flat it moved ${vf.toFixed(2)} m/s up or down`;
      return true;
    }],
    ['extra: air: someone falling from high up tops out far below a fall in a vacuum (about 50 m/s, not faster and faster)', () => {
      kit.reset();
      // (dropped through a long fall's worth of speed, without the room for it: started at 45 m/s)
      const h = kit.spawn('human', 0, 30) as Human;
      kit.advance(0.05);
      h.setVelocity(0, -45);
      kit.advance(0.6);
      const v = h.bodySpeed();
      // in a vacuum: 45 + 9.81 × 0.6 ≈ 51
      if (v > 50) return `still ${v.toFixed(1)} m/s, as if no air held them back`;
      if (v < 30) return `slowed to ${v.toFixed(1)} m/s: the air is far too thick`;
      return true;
    }],
    ['extra: heat: metal heated white hot glows, then cools back toward the air over time, its glow fading', () => {
      kit.reset();
      const beam = kit.spawn('beam', 0, 3);
      beam.parts[0].setFrozen(true);
      kit.advance(0.1);
      const p = beam.parts[0];
      game.heat.set(p, 1200);
      kit.advance(0.1);
      if (p.glow < 0.5) return `at ${p.temp.toFixed(0)} °C it glows only ${p.glow.toFixed(2)}`;
      const t0 = p.temp;
      kit.advance(20);
      if (p.temp > t0 - 150) return `after 20 s it's still ${p.temp.toFixed(0)} °C`;
      if (p.glow >= 0.5) return `cooling, it still glows ${p.glow.toFixed(2)}`;
      kit.advance(300);
      if (p.temp > game.air.groundTemp + 15) return `after 5 minutes it's ${p.temp.toFixed(0)} °C`;
      if (p.glow > 0) return 'cold, it still glows';
      return true;
    }],
    ['extra: heat: a red-hot metal box sets a crate it lies against alight, and burns someone standing on a hot plate; water quenches it', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      const box = kit.spawn('metal-box', 0, 1.6);
      kit.advance(0.6);
      game.heat.set(box.parts[0], 750);
      kit.advance(8);
      if (crate.parts[0].burning < 0.05 && !crate.destroyed) return `the crate under a ${box.parts[0].temp.toFixed(0)} °C box didn't catch`;
      // someone standing on a hot steel plate
      kit.reset();
      const hot = kit.spawn('beam', 0, 0.2);
      hot.parts[0].setFrozen(true);
      const h = kit.spawn('human', 0, 1.3) as Human;
      kit.advance(1.2);
      const health = () => [...h.limbs.values()].reduce((s, l) => s + (l.part.destroyed ? 0 : l.part.hp), 0);
      game.heat.set(hot.parts[0], 600);
      const hp0 = health();
      kit.advance(1.5);
      if (health() >= hp0 - 3) return `standing on a 600 °C plate, they lost only ${(hp0 - health()).toFixed(1)} hp`;
      // and water on it
      const t0 = hot.parts[0].temp;
      for (let i = 0; i < 10; i++) game.fire.douse(hot.parts[0], 0.05);
      if (hot.parts[0].temp > t0 - 100) return `doused, it only cooled from ${t0.toFixed(0)} to ${hot.parts[0].temp.toFixed(0)} °C`;
      return true;
    }],
    ['extra: heat: a part\'s temperature is kept by save/load; the snow map\'s air is cold and the desert\'s hot', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.5);
      kit.advance(0.2);
      game.heat.set(box.parts[0], 640);
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.05);
      const back = game.entities.find((e) => e.def.id === 'metal-box');
      if (!back) return 'the box is gone after loading';
      if (Math.abs(back.parts[0].temp - 640) > 15) return `loaded at ${back.parts[0].temp.toFixed(0)} °C, not 640`;
      if (back.parts[0].glow <= 0) return 'loaded hot, it does not glow';
      const snow = BUILTIN_MAPS.find((m) => m.theme === 'snow');
      const desert = BUILTIN_MAPS.find((m) => m.theme === 'desert');
      try {
        if (snow) {
          game.setMap(snow);
          const c = kit.spawn('crate', 0, 1);
          if (c.parts[0].temp > 0) return `on the snow map a crate is ${c.parts[0].temp} °C`;
        }
        if (desert) {
          game.setMap(desert);
          const c = kit.spawn('crate', 0, 1);
          if (c.parts[0].temp < 30) return `on the desert map a crate is ${c.parts[0].temp} °C`;
        }
      } finally {
        game.setMap(LAB);
      }
      return true;
    }],
    ['extra: air: a scene of 60 things flung about costs the air little (under 0.4 ms a step)', () => {
      kit.reset();
      const things: Entity[] = [];
      for (let i = 0; i < 60; i++) things.push(fling(i % 2 ? 'plank' : 'crate', -30 + i, 10 + (i % 5) * 3, i * 0.3, 20 - (i % 7) * 5, 8));
      kit.advance(0.1);
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) game.aero.step(1 / 120);
      const ms = (performance.now() - t0) / 200;
      if (ms > 0.4) return `${ms.toFixed(3)} ms a step`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Battery } from '../../entities/Machines';
import type { FuelTank } from '../../entities/Rocketry';
import type { Generator, Sensor, Sequencer, SolarPanel, Toggle } from '../../entities/Sensors';
import { SEQ_PINS } from '../../art/power';
import { PX } from '../../engine/constants';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Power as a resource, sensors and the new logic (0.4.0: systems/Power, entities/Sensors). */
export default function tests({ game, kit }: TestCtx): Test[] {
  const C = game.connections;
  /** A chip's input is its left half, its output its right (this far from the middle). */
  const L = 6 / 32;
  const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
    C.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0))!;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** Runs `f` with Settings' fuel set to `mode`, then back. */
  const withMode = <T>(mode: 'free' | 'infinite' | 'required', f: () => T): T => {
    const was = game.fuel.mode;
    game.fuel.mode = mode;
    try {
      return f();
    } finally {
      game.fuel.mode = was;
    }
  };

  return [
    ['extra: power: a battery running a motor runs down; flat, the motor stops; recharged, it runs again; infinite fuel keeps it full', () => withMode('free', () => {
      kit.reset();
      const bat = kit.spawn('battery', -2, 0.3) as Battery;
      const motor = kit.spawn('motor', 1, 0.5);
      kit.advance(0.3);
      wire(bat, motor);
      kit.advance(0.5);
      if (!motor.powered) return 'the motor isn’t powered by the battery';
      const c0 = bat.charge;
      kit.advance(2);
      const used = c0 - bat.charge;
      // (a motor draws about 120 W: 2 s, 240 J)
      if (used < 100 || used > 600) return `2 s of a motor took ${used.toFixed(0)} J from the battery`;
      bat.charge = 50;
      kit.advance(1);
      if (bat.charge > 0) return `the battery should be flat: ${bat.charge.toFixed(0)} J left`;
      if (motor.powered) return 'flat, the battery still powers the motor';
      if (!bat.contextActions().some((a) => a.label === 'Charge: 0%')) return `its menu doesn’t show it flat: ${bat.contextActions().map((a) => a.label).join(', ')}`;
      bat.contextActions().find((a) => a.label === 'Recharge')!.action();
      kit.advance(0.1);
      if (!motor.powered) return 'recharged, the motor isn’t powered again';
      game.fuel.mode = 'infinite';
      const c1 = bat.charge;
      kit.advance(2);
      if (bat.charge !== c1) return `with infinite fuel the battery still ran down (${c1} → ${bat.charge})`;
      return true;
    })],
    ['extra: power: a solar panel facing the sun charges a flat battery and lights a lamp; face down, or at night, it makes nothing', () => withMode('free', () => {
      kit.reset();
      game.weather.set({ light: 1 });
      const sun = kit.spawn('solar-panel', -2, 0.3) as SolarPanel;
      const bat = kit.spawn('battery', 0, 0.3) as Battery;
      const lamp = kit.spawn('light', 2, 0.3);
      kit.advance(0.3);
      wire(sun, bat);
      wire(bat, lamp);
      bat.charge = 0;
      C.recomputePower();
      kit.advance(1.2);
      if (!(sun.output > 80)) return `facing up at noon the panel makes ${sun.output.toFixed(0)} W`;
      if (!lamp.powered) return 'the lamp isn’t lit by the panel';
      kit.advance(2);
      if (!(bat.charge > 50)) return `2 s of sun charged the battery to ${bat.charge.toFixed(0)} J`;
      // face down
      sun.main.teleport(sun.main.x, sun.main.y + 0.5, Math.PI);
      sun.setFrozen(true);
      kit.advance(1);
      if (sun.output > 1) return `face down it makes ${sun.output.toFixed(0)} W`;
      sun.setFrozen(false);
      sun.main.teleport(sun.main.x, sun.main.y, 0);
      game.weather.set({ light: 0.2 });
      kit.advance(1);
      const night = sun.output;
      game.weather.set({ light: 1 });
      if (sun.isPowerSource() && night >= 30) return `at night it makes ${night.toFixed(0)} W and still gives power`;
      return true;
    })],
    ['extra: power: a generator started burns its tank’s fuel and powers a lamp and charges a battery; its tank dry, it stops', () => withMode('free', () => {
      kit.reset();
      const gen = kit.spawn('generator', 0, 0.4) as Generator;
      const tank = kit.spawn('fuel-tank', 0, 1.6) as FuelTank;
      const bat = kit.spawn('battery', 2, 0.3) as Battery;
      const lamp = kit.spawn('light', 3.5, 0.3);
      kit.advance(0.4);
      weld(gen, tank, { x: 0, y: (gen.main.y + tank.main.y) / 2 });
      wire(gen, bat);
      wire(bat, lamp);
      bat.charge = 0;
      C.recomputePower();
      kit.advance(0.2);
      if (lamp.powered) return 'the lamp is lit before the generator’s started';
      gen.activate();
      kit.advance(1);
      if (!gen.isPowerSource()) return 'started, the generator doesn’t run';
      if (!lamp.powered) return 'the generator running doesn’t light the lamp';
      const f0 = tank.fuel;
      kit.advance(2);
      if (!(tank.fuel < f0)) return 'running, it burns no fuel from its tank';
      if (!(bat.charge > 1000)) return `2 s of the generator charged the battery to ${bat.charge.toFixed(0)} J`;
      tank.fuel = 0.0001;
      kit.advance(0.5);
      if (gen.isPowerSource()) return 'its tank dry, it still runs';
      return true;
    })],
    ['extra: sensors: an altimeter, a speed sensor, a tilt sensor, a fuel gauge and a proximity sensor each power a lamp when their reading’s past what they’re set to', () => withMode('free', () => {
      kit.reset();
      // altimeter (on below 50 m): on the ground, on; 60 m up (held there), off
      const alt = kit.spawn('altimeter', -6, 0.3) as Sensor;
      const lampA = kit.spawn('light', -6, 1.5);
      kit.advance(0.3);
      wire(alt, lampA, L, 0);
      kit.advance(0.3);
      if (!alt.active || !lampA.powered) return `on the ground the altimeter (below 50 m) is ${alt.active ? 'on' : 'off'}, reading ${alt.reading.toFixed(1)} m`;
      alt.main.teleport(alt.main.x, 60, 0);
      alt.setFrozen(true);
      kit.advance(0.3);
      if (alt.active) return `60 m up the altimeter (below 50 m) is still on, reading ${alt.reading.toFixed(1)} m`;
      alt.setFrozen(false);
      // speed (on above 10 m/s): thrown at 15 m/s, it's on (a chip alone falls at only ~6 m/s: its drag)
      const spd = kit.spawn('speed-sensor', -3, 20) as Sensor;
      kit.advance(0.05);
      if (spd.active) return 'the speed sensor is on at rest';
      spd.main.body.setLinvel({ x: 15, y: 0 }, true);
      let seen = false;
      game.advance(0.2, () => (seen ||= spd.active));
      if (!seen) return `thrown at 15 m/s the speed sensor never came on (above 10 m/s; read ${spd.reading.toFixed(1)})`;
      // tilt (on above 45°): lying on its side, on
      const tilt = kit.spawn('tilt-sensor', 0, 0.4, { angle: Math.PI / 2 }) as Sensor;
      const upright = kit.spawn('tilt-sensor', 1, 0.3) as Sensor;
      kit.advance(0.3);
      if (!tilt.active) return `on its side the tilt sensor is off (reads ${tilt.reading.toFixed(0)}°)`;
      if (upright.active) return `upright the tilt sensor is on (reads ${upright.reading.toFixed(0)}°)`;
      // fuel gauge (on below 10%): welded to a full tank, off; the tank nearly dry, on
      const tank = kit.spawn('fuel-tank', 4, 0.8) as FuelTank;
      const gauge = kit.spawn('fuel-gauge', 4.6, 0.6) as Sensor;
      kit.advance(0.3);
      weld(tank, gauge, { x: 4.45, y: 0.6 });
      kit.advance(0.6);
      if (gauge.active) return `on a full tank the fuel gauge (below 10%) is on (reads ${gauge.reading.toFixed(0)}%)`;
      tank.fuel = tank.capacity * 0.05;
      kit.advance(0.6);
      if (!gauge.active) return `on a tank at 5% the fuel gauge is off (reads ${gauge.reading.toFixed(0)}%)`;
      // proximity (within 2 m): nothing near, off; a box a metre off, on
      const prox = kit.spawn('proximity-sensor', 8, 0.3) as Sensor;
      kit.advance(0.3);
      if (prox.active) return `with nothing near the proximity sensor is on (nearest ${prox.reading.toFixed(1)} m)`;
      kit.spawn('metal-box', 9.3, 0.4);
      kit.advance(0.3);
      if (!prox.active) return `a box a metre off, the proximity sensor is off (nearest ${prox.reading.toFixed(1)} m)`;
      return true;
    })],
    ['extra: logic: a toggle flips on each press of a button wired to it; a step sequencer lights its lamps one at a time in turn, and keeps its step saved and loaded', () => {
      kit.reset();
      const btn = kit.spawn('button', -4, 0.3);
      const tog = kit.spawn('toggle', -2, 0.3) as Toggle;
      const lamp = kit.spawn('light', 0, 0.3);
      kit.advance(0.3);
      wire(btn, tog, 0, -L);
      wire(tog, lamp, L, 0);
      kit.advance(0.2);
      if (lamp.powered) return 'the toggle starts on';
      btn.activate();
      kit.advance(0.3);
      if (!tog.on || !lamp.powered) return 'one press: the toggle isn’t on';
      btn.activate();
      kit.advance(0.3);
      if (tog.on || lamp.powered) return 'two presses: the toggle isn’t off again';
      // the sequencer
      kit.reset();
      const b2 = kit.spawn('button', -4, 0.3);
      const seq = kit.spawn('step-sequencer', -1, 0.5) as Sequencer;
      const lamps = [0, 1, 2, 3].map((i) => kit.spawn('light', 2 + i * 1.2, 0.3));
      kit.advance(0.3);
      wire(b2, seq, 0, -L);
      const p = seq.main;
      for (let i = 0; i < 4; i++) {
        const ly = (p.h * PX) / 2 - (SEQ_PINS[i] + 1) * PX;
        C.create('wire', p, p.localToWorld(L, ly), lamps[i].parts[0], lamps[i].parts[0].localToWorld(0, 0));
      }
      kit.advance(0.2);
      const litOnes = () => lamps.map((l, i) => (l.powered ? i : -1)).filter((i) => i >= 0).join(',');
      if (litOnes() !== '0') return `at the start lamps ${litOnes() || 'none'} are lit (not just the first)`;
      for (const want of ['1', '2', '3', '0', '1']) {
        b2.activate();
        kit.advance(0.3);
        if (litOnes() !== want) return `pressed on to step ${want}: lamps ${litOnes() || 'none'} are lit`;
      }
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.3);
      const seq2 = game.entities.find((e) => e.def.id === 'step-sequencer') as Sequencer | undefined;
      if (!seq2 || seq2.step !== 1) return `loaded, the sequencer is on step ${seq2?.step}`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Motor } from '../../entities/Machines';
import type { JetEngine } from '../../entities/JetEngine';
import type { FuelTank } from '../../entities/Rocketry';
import type { CarEngine, Headlight, NitroBottle, SuspensionStrut, TowHitch } from '../../entities/Vehicles2';
import type { Sensor } from '../../entities/Sensors';
import type { Human } from '../../entities/Human';


/** Home-made vehicles' parts (0.4.0: entities/Vehicles2, systems/Wheels, the autopilot). */
export default function tests({ game, kit }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** A plank on two motor wheels (welded by their hubs), and what else is asked for welded on top. */
  const car = (extra: string[] = []) => {
    const plank = kit.spawn('plank', 0, 0.75);
    const wheels = [-0.9, 0.9].map((x) => kit.spawn('motor-wheel', x, 0.35) as Motor);
    kit.advance(0.3);
    for (const w of wheels) C.create('weld', plank.parts[0], { x: w.housing.x, y: w.housing.y }, w.housing, { x: w.housing.x, y: w.housing.y });
    const parts = extra.map((id, i) => {
      const e = kit.spawn(id, -0.6 + i * 0.6, 1.25);
      return e;
    });
    kit.advance(0.2);
    for (const e of parts) weld(plank, e, { x: e.parts[0].x, y: plank.parts[0].y + 0.05 });
    kit.advance(0.3);
    return { plank, wheels, parts };
  };
  /** Drives `ents` right for `s` s (A/D held): the speed it got to. */
  const drive = (ents: Entity[], s: number, boost = false) => {
    let top = 0;
    game.advance(s, () => {
      game.piloting.drive(ents, { x: 1, t: 0, r: 0, boost });
      top = Math.max(top, Math.abs(ents[0].parts[0].vx));
    });
    return top;
  };

  return [
    ['extra: vehicles: an engine built into a motor-wheel car drives it far faster than its wheels alone, changing up through its gears, and burns its tank’s fuel', () => {
      kit.reset();
      const plain = car();
      const slow = drive([plain.plank], 6);
      kit.reset();
      const fast = car(['car-engine', 'fuel-tank']);
      const eng = fast.parts[0] as CarEngine;
      const tank = fast.parts[1] as FuelTank;
      const f0 = tank.fuel;
      let gear = 0;
      let top = 0;
      game.advance(8, () => {
        game.piloting.drive([fast.plank], { x: 1, t: 0, r: 0 });
        gear = Math.max(gear, eng.gear);
        top = Math.max(top, Math.abs(fast.plank.parts[0].vx));
      });
      if (!eng.running) return 'the engine isn’t running';
      if (gear < 2) return `it only got to gear ${gear + 1} (top speed ${top.toFixed(1)} m/s)`;
      if (top < slow * 1.8) return `with the engine it reached ${top.toFixed(1)} m/s, without ${slow.toFixed(1)} m/s`;
      if (!(tank.fuel < f0)) return 'it burned no fuel';
      return true;
    }],
    ['extra: vehicles: the boost key with a nitro bottle in the build drives an engine car faster, and uses the nitro up; without the key, none goes', () => {
      kit.reset();
      const a = car(['car-engine']);
      drive([a.plank], 2);
      const v0 = drive([a.plank], 4);
      kit.reset();
      const b = car(['car-engine', 'nitro-bottle']);
      const bottle = b.parts[1] as NitroBottle;
      drive([b.plank], 2);
      if (bottle.left < 5.99) return `driving without the boost key used nitro (${bottle.left.toFixed(2)} s left)`;
      const v1 = drive([b.plank], 4, true);
      if (!(bottle.left < 3)) return `boosting 4 s left ${bottle.left.toFixed(2)} s of nitro`;
      if (v1 < v0 * 1.15) return `boosted it got to ${v1.toFixed(1)} m/s, without ${v0.toFixed(1)} m/s`;
      return true;
    }],
    ['extra: vehicles: a suspension strut gives under a weight hung on it, no further than its travel, and settles', () => {
      kit.reset();
      const s = kit.spawn('suspension-strut', 0, 2) as SuspensionStrut;
      s.top.setFrozen(true);
      const box = kit.spawn('metal-box', 0, 1.1);
      kit.advance(0.1);
      C.create('weld', s.rod, { x: s.rod.x, y: s.rod.y - 0.1 }, box.parts[0], { x: s.rod.x, y: s.rod.y - 0.1 });
      const sq0 = s.squash;
      kit.advance(2);
      const sag = sq0 - s.squash;
      if (Math.abs(sag) < 0.005) return `a box hung on it, the strut gave ${(sag * 100).toFixed(1)} cm`;
      if (Math.abs(s.squash) > 0.13) return `it went past its travel (${(s.squash * 100).toFixed(1)} cm from the middle)`;
      const before = s.squash;
      kit.advance(0.5);
      if (Math.abs(s.squash - before) > 0.01) return `it hasn’t settled (${(before * 100).toFixed(1)} → ${(s.squash * 100).toFixed(1)} cm)`;
      return true;
    }],
    ['extra: vehicles: two tow hitches brought together hitch (pinned), and unhitch on F', () => {
      kit.reset();
      const a = kit.spawn('tow-hitch', 0, 1) as TowHitch;
      const b = kit.spawn('tow-hitch', 3, 1, { flip: true }) as TowHitch;
      a.setFrozen(true);
      kit.advance(0.2);
      if (a.hitched || b.hitched) return 'hitched while apart';
      const ab = a.ball();
      const bb = b.ball();
      b.translate(ab.x - bb.x + 0.1, ab.y - bb.y);
      kit.advance(0.4);
      if (!a.hitched || !b.hitched || a.pin?.kind !== 'pin') return `brought together: hitched ${a.hitched}/${b.hitched}`;
      a.activate();
      kit.advance(0.2);
      if (a.hitched || b.hitched) return 'F didn’t unhitch them';
      return true;
    }],
    ['extra: vehicles: the lights key switches a car’s headlights, the horn key honks; a g-meter keeps the most g of a drop', () => {
      kit.reset();
      const c = car(['headlight', 'horn']);
      const lamp = c.parts[0] as Headlight;
      if (lamp.lit) return 'the headlight starts lit';
      if (!game.piloting.command([c.plank], 'lights') || !lamp.lit) return 'the lights key didn’t light the headlight';
      if (!game.piloting.command([c.plank], 'horn')) return 'nothing heard the horn key';
      game.piloting.command([c.plank], 'lights');
      if (lamp.lit) return 'the lights key again didn’t switch it off';
      kit.reset();
      const box = kit.spawn('metal-box', 0, 25);
      const gm = kit.spawn('g-meter', 0, 25.45) as Sensor;
      kit.advance(0.05);
      weld(box, gm, { x: 0, y: 25.35 });
      gm.peak = 0;
      kit.advance(4);
      if (!(gm.peak > 8)) return `a 25 m drop onto the floor read at most ${gm.peak.toFixed(1)} g`;
      return true;
    }],
    ['extra: vehicles: a crash dummy never wakes or bleeds, and says how a person would have fared', () => {
      kit.reset();
      const d = kit.spawn('crash-dummy', 0, 1) as Human;
      kit.advance(1);
      if (!d.dummyReport().startsWith('Unhurt')) return `standing, its report is “${d.dummyReport()}”`;
      d.translate(0, 40);
      kit.advance(4);
      const r = d.dummyReport();
      if (r === 'Unhurt') return 'dropped 40 m, it’s unhurt';
      if (d.consciousness > 0.05) return `it’s awake (${d.consciousness.toFixed(2)})`;
      if (d.blood < 100) return `it bled (${d.blood.toFixed(0)})`;
      return true;
    }],
    ['extra: vehicles: a tyre hurt badly goes flat (smaller, less grip); snow takes grip away; a wheel spun on the ground smokes and leaves marks', () => {
      kit.reset();
      const w = kit.spawn('motor-wheel', 0, 0.35) as Motor;
      kit.advance(0.7);
      const col = w.rotor.colliders[0];
      const r0 = col.radius();
      const f0 = col.friction();
      w.rotor.hp = w.rotor.maxHp * 0.5;
      kit.advance(0.7);
      if (!game.wheels.isFlat(w.rotor)) return 'at half its health the tyre isn’t flat';
      if (!(col.radius() < r0 * 0.9)) return `flat, its radius is ${(col.radius() / r0).toFixed(2)} of what it was`;
      w.rotor.hp = w.rotor.maxHp;
      kit.advance(0.7);
      if (game.wheels.isFlat(w.rotor) || Math.abs(col.radius() - r0) > 1e-4) return 'mended, it’s still flat';
      game.weather.set({ snow: 1 });
      kit.advance(0.7);
      const snowy = col.friction();
      game.weather.set({ snow: 0 });
      if (!(snowy < f0 * 0.6)) return `in snow its friction is ${snowy.toFixed(2)} (dry ${f0.toFixed(2)})`;
      // spun hard on the spot, held by its hub
      kit.reset();
      const s = kit.spawn('motor-wheel', 0, 0.35) as Motor;
      kit.advance(0.5);
      s.housing.setFrozen(true);
      const stains = () => game.stains.capture().n;
      const n0 = stains();
      game.advance(1, () => s.rotor.body.setAngvel(60, true));
      if (!(stains() > n0)) return 'spun on the floor, it left no marks';
      return true;
    }],
    ['extra: vehicles: the autopilot holds a hovering rocket at the height it was at; a jet’s afterburner pushes harder', () => {
      kit.reset();
      const tank = kit.spawn('fuel-tank', 0, 20.75);
      const thr = kit.spawn('thruster', 0, 20.2, { angle: Math.PI / 2 });
      tank.setFrozen(true);
      thr.setFrozen(true);
      kit.advance(0.1);
      weld(tank, thr, { x: 0, y: 20.45 });
      tank.setFrozen(false);
      thr.setFrozen(false);
      const ents = [tank];
      game.piloting.drive(ents, { x: 0, t: 0, r: 0 });
      game.piloting.command(ents, 'autopilot');
      if (!game.piloting.autopilotOf(ents)) return 'the autopilot didn’t come on';
      const y0 = tank.parts[0].y;
      let lo = y0;
      game.advance(10, () => {
        game.piloting.drive(ents, { x: 0, t: 0, r: 0 });
        lo = Math.min(lo, tank.parts[0].y);
      });
      const y = tank.parts[0].y;
      if (lo < 2) return `it fell to the floor (from ${y0.toFixed(1)} m)`;
      if (Math.abs(y - y0) > 3) return `10 s on autopilot it’s at ${y.toFixed(1)} m, from ${y0.toFixed(1)} m`;
      // the afterburner
      const g0 = game.gravity;
      const gain = (boost: boolean) => {
        kit.reset();
        game.setGravity(0);
        const jet = kit.spawn('jet-engine', 0, 5) as JetEngine;
        jet.activate();
        game.advance(4, () => jet.main.body.setLinvel({ x: 0, y: 0 }, true));
        const v0 = Math.hypot(jet.main.vx, jet.main.vy);
        game.advance(0.5, () => (jet.boosting = boost));
        return Math.hypot(jet.main.vx, jet.main.vy) - v0;
      };
      let dry: number;
      let wet: number;
      try {
        dry = gain(false);
        wet = gain(true);
      } finally {
        game.setGravity(g0);
      }
      if (!(wet > dry * 1.3)) return `0.5 s of a jet: ${dry.toFixed(2)} m/s gained, with the afterburner ${wet.toFixed(2)}`;
      return true;
    }],
  ];
}



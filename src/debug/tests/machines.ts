import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import { THRUST_TOP } from '../../entities/Machines';
import { saveToString, loadFromString } from '../../world/SaveLoad';

export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const C = game.connections;
  const at = (e: Entity) => ({ x: e.parts[0].x, y: e.parts[0].y });
  const wire = (a: Entity, b: Entity) => C.create('wire', a.parts[0], at(a), b.parts[0], at(b));
  /** Four thrusters pointing up, welded under a Metal Beam, with a lever on top wired to each (as a player builds it). */
  const rig = (battery: boolean) => {
    const beam = kit.spawn('beam', 0, 2.2);
    const b = beam.parts[0];
    const thrusters = [-1.2, -0.4, 0.4, 1.2].map((x) => kit.spawn('thruster', x, 1.4, { angle: Math.PI / 2 }));
    const lever = kit.spawn('switch', 0, 2.7);
    const cell = battery ? kit.spawn('battery', 0.8, 2.7) : null;
    kit.advance(0.6);
    for (const t of thrusters) {
      const p = t.parts[0];
      C.create('weld', p, { x: p.x, y: p.y + 0.1 }, b, { x: p.x + 0.25, y: b.y });
    }
    for (const e of cell ? [lever, cell] : [lever]) C.create('weld', e.parts[0], at(e), b, { x: e.parts[0].x - 0.3, y: b.y });
    for (const t of thrusters) wire(lever, t);
    if (cell) wire(cell, lever);
    kit.advance(0.5);
    return { beam, thrusters, lever: lever as Entity & { on: boolean }, cell: cell as (Entity & { on: boolean }) | null };
  };
  const powered = (list: Entity[]) => list.filter((e) => e.powered).length;

  return [
    ['extra: machines: a lever wired straight to thrusters (no battery) works them, and four lift a Metal Beam', () => {
      kit.reset();
      const r = rig(false);
      const y0 = r.beam.parts[0].y;
      if (powered(r.thrusters)) return `${powered(r.thrusters)} thrusters on before the lever was flipped`;
      r.lever.activate();
      if (powered(r.thrusters) !== 4) return `flipped on, the lever powers ${powered(r.thrusters)} of 4 thrusters`;
      kit.advance(1.5);
      const rose = r.beam.parts[0].y - y0;
      if (rose < 5) return `four thrusters lifted the beam only ${rose.toFixed(2)} m in 1.5 s`;
      r.lever.activate();
      if (powered(r.thrusters)) return `flipped off, ${powered(r.thrusters)} thrusters still powered`;
      return true;
    }],
    ['extra: machines: wired to a battery, a lever only lets its power through (two in a row: both must be on)', () => {
      kit.reset();
      const r = rig(true);
      const cell = r.cell!;
      if (!cell.on) return 'the battery starts off';
      if (powered(r.thrusters)) return 'the lever is off, yet the thrusters are powered';
      cell.activate();
      r.lever.activate();
      if (powered(r.thrusters)) return 'battery off, lever on: the lever powered them itself (a battery’s circuit is the battery’s)';
      cell.activate();
      if (powered(r.thrusters) !== 4) return `battery and lever on: ${powered(r.thrusters)} of 4 powered`;
      // a second lever between the first and a lamp
      const second = kit.spawn('switch', 3, 0.3);
      const lamp = kit.spawn('light', 4, 0.3);
      kit.advance(0.2);
      wire(r.lever, second);
      wire(second, lamp);
      if (lamp.powered) return 'the lamp lit through a second lever that is off';
      second.activate();
      if (!lamp.powered) return 'both levers on: the lamp is dark';
      r.lever.activate();
      if (lamp.powered) return 'the first lever off: the lamp still lit (the second powered it alone)';
      return true;
    }],
    ['extra: machines: a thruster alone tops out near its top speed; one lifts a person', () => {
      kit.reset();
      const lone = kit.spawn('thruster', 0, 0.6, { angle: Math.PI / 2 });
      kit.advance(0.3);
      lone.activate();
      kit.advance(1.2);
      const v = Math.hypot(lone.parts[0].vx, lone.parts[0].vy);
      if (v > THRUST_TOP * 1.05) return `alone it flies at ${v.toFixed(1)} m/s (top ${THRUST_TOP})`;
      if (v < THRUST_TOP * 0.7) return `alone it reaches only ${v.toFixed(1)} m/s`;
      kit.reset();
      const h = kit.spawn('human', 0, 1) as Human;
      kit.advance(1);
      const torso = h.limbs.get('midTorso')!.part;
      const t = kit.spawn('thruster', torso.x, torso.y, { angle: Math.PI / 2 });
      kit.advance(0.02);
      C.create('weld', t.parts[0], at(t), torso, { x: torso.x, y: torso.y });
      const y0 = torso.y;
      t.activate();
      kit.advance(2);
      if (torso.y - y0 < 2) return `one thruster lifted a person only ${(torso.y - y0).toFixed(2)} m in 2 s`;
      return true;
    }],
    ['extra: machines: a weld dragged between two things draws a rod out to where it was dragged, kept by save/load, copy and flip', () => {
      kit.reset();
      const a = kit.spawn('crate', -1, 0.45);
      const b = kit.spawn('crate', 1, 0.45);
      kit.advance(0.5);
      const pa = a.parts[0];
      const pb = b.parts[0];
      const c = C.create('weld', pa, { x: pa.x + 0.3, y: pa.y }, pb, { x: pb.x - 0.3, y: pb.y });
      if (!c?.end) return 'a weld dragged 1.4 m has no far end to draw its rod to';
      const touching = C.create('weld', pa, { x: pa.x, y: pa.y + 0.2 }, pb, { x: pa.x, y: pa.y + 0.2 });
      if (touching?.end) return 'a weld made where two things touch has a rod';
      if (touching) C.remove(touching);
      /** The rod's far end in the world, from its crate (b of the weld). */
      const tip = () => {
        const w = C.list.find((x) => x.kind === 'weld' && x.end);
        return w && w.b ? w.b.localToWorld(w.end!.x, w.end!.y) : null;
      };
      const before = tip()!;
      loadFromString(game, saveToString(game));
      const loaded = tip();
      if (!loaded || Math.hypot(loaded.x - before.x, loaded.y - before.y) > 0.02) return `after save/load the rod ends at ${JSON.stringify(loaded)}, not ${JSON.stringify(before)}`;
      const [ca, cb] = game.entities.filter((e) => e.def.id === 'crate');
      controls.copy([ca, cb]);
      kit.move(0, 4);
      controls.paste();
      if (C.list.filter((x) => x.kind === 'weld' && x.end).length !== 2) return 'the pasted copy’s weld lost its rod';
      game.flipEntities(game.entities.filter((e) => e.def.id === 'crate').slice(0, 2));
      if (C.list.filter((x) => x.kind === 'weld' && x.end).length !== 2) return 'flipped, a weld lost its rod';
      return true;
    }],
  ];
}

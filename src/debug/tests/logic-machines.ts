import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Explosive } from '../../entities/Explosive';
import type { Firearm } from '../../entities/Firearm';
import type { Motor, Thruster } from '../../entities/Machines';
import type { Switch, Timer } from '../../entities/Devices';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Machinery doing what a player expects of it: power, pulses, hand switches, connections. */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  /** A gate's or timer's input is its left half, its output its right (this far from the middle). */
  const L = 6 / 32;
  /** A wire between two things, `la`/`lb` m right of their middles. */
  const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
    C.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0))!;
  /** The first entry of a thing's own menu (its on/off). */
  const label = (e: Entity) => e.contextActions()[0]?.label ?? '';
  const toast = () => document.querySelector('.toast')?.textContent ?? '';
  const find = (id: string) => game.entities.find((e) => e.def.id === id)!;

  return [
    ['extra: logic: a lever with no battery wired to a gate’s input, or a timer’s, drives it', () => {
      kit.reset();
      const lever = kit.spawn('switch', -3, 0.3) as Switch;
      const tm = kit.spawn('timer', -1.5, 0.3) as Timer;
      const not = kit.spawn('gate-not', 0, 0.3);
      const lamp = kit.spawn('light', 1.5, 0.3);
      kit.advance(0.3);
      wire(lever, not, 0, -L);
      wire(not, lamp, L, 0);
      wire(lever, tm, 0, -L);
      kit.advance(0.1);
      if (!lamp.powered) return 'a NOT gate with nothing on its input doesn’t light its lamp';
      if (tm.running) return 'the timer runs before the lever is thrown';
      lever.activate();
      kit.advance(0.1);
      if (lamp.powered) return 'lever thrown (no battery): the NOT gate still sees its input off, and its lamp stays lit';
      if (!tm.running) return 'lever thrown (no battery): the timer wired to it doesn’t run';
      lever.activate();
      kit.advance(0.1);
      if (!lamp.powered || tm.running) return `lever thrown back: the lamp is ${lamp.powered ? 'lit' : 'dark'}, the timer ${tm.running ? 'runs' : 'stopped'}`;
      return true;
    }],
    ['extra: logic: power reaching C4 sets it off (a battery, a lever thrown), and fires a pistol once; a duplicate doesn’t fire', () => {
      kit.reset();
      const bat = kit.spawn('battery', -3, 0.4);
      const c4 = kit.spawn('c4', 3, 0.2) as Explosive;
      kit.advance(0.3);
      wire(bat, c4);
      if (!c4.armed) return 'C4 wired to a battery that is on didn’t go off';
      kit.reset();
      const lever = kit.spawn('switch', -1, 0.3) as Switch;
      const bomb = kit.spawn('c4', 1, 0.2) as Explosive;
      const gun = kit.spawn('pistol', 0, 1.5) as Firearm;
      gun.setFrozen(true);
      kit.advance(0.3);
      wire(lever, bomb);
      wire(lever, gun);
      kit.advance(0.2);
      if (bomb.armed || gun.shots) return `before the lever is thrown: the C4 is ${bomb.armed ? '' : 'not '}armed, the pistol fired ${gun.shots} times`;
      lever.activate();
      if (!bomb.armed) return 'C4 wired to a lever didn’t go off when the lever was thrown';
      if (gun.shots !== 1) return `a pistol wired to a lever fired ${gun.shots} times when the lever was thrown (want 1)`;
      kit.reset();
      const cell = kit.spawn('battery', -1, 0.4);
      const pistol = kit.spawn('pistol', 1, 1.5) as Firearm;
      pistol.setFrozen(true);
      kit.advance(0.3);
      wire(cell, pistol);
      if (pistol.shots !== 1) return `a pistol wired to a battery fired ${pistol.shots} times (want 1)`;
      controls.duplicate([cell, pistol]);
      kit.advance(0.3);
      const copy = game.entities.find((e) => e.def.id === 'pistol' && e !== pistol) as Firearm | undefined;
      if (!copy) return 'the duplicate has no pistol';
      if (copy.shots) return `the duplicated pistol fired ${copy.shots} times as it was made (its power came with it)`;
      if (pistol.shots !== 1) return `the first pistol fired ${pistol.shots} times by the time its copy was made`;
      return true;
    }],
    ['extra: logic: a button between a battery and a lamp switches the lamp (it doesn’t carry the power)', () => {
      kit.reset();
      const bat = kit.spawn('battery', -2, 0.4);
      const btn = kit.spawn('button', 0, 0.1);
      const lamp = kit.spawn('light', 2, 0.3);
      kit.advance(0.3);
      wire(bat, btn);
      wire(btn, lamp);
      kit.advance(0.1);
      if (lamp.powered) return 'the battery lit the lamp through the button before it was pressed';
      btn.activate();
      kit.advance(0.4);
      if (label(lamp) !== 'Switch off') return `pressed once, the lamp isn’t lit (its menu says "${label(lamp)}")`;
      btn.activate();
      kit.advance(0.4);
      if (label(lamp) !== 'Switch on') return `pressed again, the lamp is still lit (its menu says "${label(lamp)}")`;
      return true;
    }],
    ['extra: logic: Turn off works on a thruster, lamp, motor, piston and timer powered by a lever; thrown off and on, it runs them again', () => {
      kit.reset();
      const lever = kit.spawn('switch', -4, 0.3) as Switch;
      const things = [kit.spawn('thruster', -2.5, 0.3), kit.spawn('light', -1, 0.3), kit.spawn('motor', 0.5, 0.4), kit.spawn('piston', 2.5, 0.3), kit.spawn('timer', 5, 0.3)];
      const on: Record<string, string> = { thruster: 'Turn off', light: 'Switch off', motor: 'Turn off', piston: 'Retract', timer: 'Stop' };
      const off: Record<string, string> = { thruster: 'Turn on', light: 'Switch on', motor: 'Turn on', piston: 'Extend', timer: 'Start' };
      kit.advance(0.5);
      for (const e of things) e.setFrozen(true);
      for (const e of things) wire(lever, e, 0, e.def.id === 'timer' ? -L : 0);
      lever.activate();
      kit.advance(0.1);
      for (const e of things) if (label(e) !== on[e.def.id]) return `powered by the lever, the ${e.def.name}’s menu says "${label(e)}", not "${on[e.def.id]}"`;
      for (const e of things) e.contextActions()[0].action();
      kit.advance(0.1);
      for (const e of things) if (label(e) !== off[e.def.id]) return `switched off from its menu while powered, the ${e.def.name} runs on (its menu says "${label(e)}")`;
      if ((things[0] as Thruster).running) return 'switched off from its menu while powered, the thruster still pushes';
      lever.activate();
      kit.advance(0.1);
      lever.activate();
      kit.advance(0.1);
      for (const e of things) if (label(e) !== on[e.def.id]) return `the lever thrown off and on again, the ${e.def.name} doesn’t run (its menu says "${label(e)}")`;
      return true;
    }],
    ['extra: logic: a thruster and a lamp switched on by hand stay on through save/load, undo and flip; one held off stays off', () => {
      kit.reset();
      const t = kit.spawn('thruster', -1, 0.3);
      const lamp = kit.spawn('light', 1, 0.3);
      kit.advance(0.3);
      t.setFrozen(true);
      t.activate();
      lamp.activate();
      const both = (when: string) => {
        const a = label(find('thruster'));
        const b = label(find('light'));
        return a === 'Turn off' && b === 'Switch off' ? null : `after ${when}: the thruster’s menu says "${a}", the lamp’s "${b}" (both were on)`;
      };
      loadFromString(game, saveToString(game));
      const loaded = both('save/load');
      if (loaded) return loaded;
      controls.history.record('Spawn Wooden Crate');
      kit.spawn('crate', 4, 0.45);
      controls.history.undo();
      const undone = both('an undo');
      if (undone) return undone;
      game.flipEntities([find('thruster'), find('light')]);
      const flipped = both('a flip');
      if (flipped) return flipped;
      kit.reset();
      const lever = kit.spawn('switch', -1, 0.3) as Switch;
      const held = kit.spawn('thruster', 1, 0.3);
      kit.advance(0.3);
      held.setFrozen(true);
      wire(lever, held);
      lever.activate();
      held.contextActions()[0].action();
      loadFromString(game, saveToString(game));
      kit.advance(0.1);
      const after = find('thruster') as Thruster;
      if (!(find('switch') as Switch).on) return 'after save/load the lever is off';
      if (after.running) return 'a thruster switched off by hand while the lever powered it runs again after save/load';
      return true;
    }],
    ['extra: logic: a timer switched to a shorter interval partway through a count pulses once, then keeps time (no burst)', () => {
      kit.reset();
      const tm = kit.spawn('timer', 0, 0.3) as Timer;
      kit.advance(0.3);
      tm.interval = 5;
      tm.activate();
      kit.advance(4);
      let n = 0;
      const pulse = C.pulse;
      C.pulse = (from, fromPower) => {
        if (from === tm) n++;
        pulse.call(C, from, fromPower);
      };
      try {
        const every = tm.contextActions().find((a) => a.label === 'Every 0.25 s');
        if (!every) return 'no "Every 0.25 s" in the timer’s menu';
        every.action();
        kit.advance(0.6);
      } finally {
        delete (C as unknown as { pulse?: unknown }).pulse;
      }
      if (n < 2 || n > 4) return `switched from every 5 s to every 0.25 s four seconds in, it pulsed ${n} times in the next 0.6 s (want 2 to 4)`;
      return true;
    }],
    ['extra: logic: an XOR gate is on with exactly one input on, as it says (three on: off)', () => {
      kit.reset();
      const bat = kit.spawn('battery', -4, 0.4);
      const levers = [-2.5, -1.5, -0.5].map((x) => kit.spawn('switch', x, 0.3) as Switch);
      const gate = kit.spawn('gate-xor', 1, 0.3);
      const lamp = kit.spawn('light', 2.5, 0.3);
      kit.advance(0.3);
      for (const s of levers) {
        wire(bat, s);
        wire(s, gate, 0, -L);
      }
      wire(gate, lamp, L, 0);
      let got = '';
      for (const k of [0, 1, 2, 3]) {
        levers.forEach((s, i) => {
          if (s.on !== i < k) s.activate();
        });
        kit.advance(0.1);
        got += lamp.powered ? '1' : '0';
      }
      if (got !== '0100') return `XOR lamp with 0, 1, 2, 3 inputs on: ${got}, want 0100`;
      return true;
    }],
    ['extra: logic: the Remove tool by one rope’s end takes just that rope; on a rope in the air it cuts it; on a lone object it says so', () => {
      kit.reset();
      const a = kit.spawn('crate', -2, 0.45);
      const b = kit.spawn('crate', 0, 0.45);
      const c = kit.spawn('crate', 2, 0.45);
      kit.advance(0.5);
      const [pa, pb, pc] = [a.parts[0], b.parts[0], c.parts[0]];
      const r1 = C.create('rope', pa, { x: pa.x, y: pa.y }, pb, { x: pb.x - 0.2, y: pb.y + 0.2 })!;
      const r2 = C.create('rope', pc, { x: pc.x, y: pc.y }, pb, { x: pb.x + 0.2, y: pb.y + 0.2 })!;
      const ropes = () => C.list.filter((k) => k.kind === 'rope');
      const click = (x: number, y: number) => {
        kit.down(x, y);
        kit.up(x, y);
      };
      controls.setTool('remove');
      const end = pb.localToWorld(r1.lb.x, r1.lb.y);
      click(end.x, end.y);
      if (ropes().length !== 1 || ropes()[0] !== r2) {
        controls.setTool('drag');
        return `clicked by one rope’s end on the middle crate, ${2 - ropes().length} of its 2 ropes went${ropes().length === 1 ? ' (the other one)' : ''}`;
      }
      const wa = pc.localToWorld(r2.la.x, r2.la.y);
      const wb = pb.localToWorld(r2.lb.x, r2.lb.y);
      click((wa.x + wb.x) / 2, (wa.y + wb.y) / 2);
      if (ropes().length) {
        controls.setTool('drag');
        return 'clicked on a rope between two crates (not on either), it stays';
      }
      click(pa.x, pa.y);
      controls.setTool('drag');
      if (!toast().includes('Nothing is connected')) return `clicked on a crate with nothing tied to it, the status says "${toast()}"`;
      return true;
    }],
    ['extra: logic: a spring holds a motor hung by its rotor by its whole weight (42 kg, not the rotor’s 12)', () => {
      kit.reset();
      const top = kit.spawn('metal-box', 0, 3.4);
      top.setFrozen(true);
      const m = kit.spawn('motor', 0, 2) as Motor;
      const tp = top.parts[0];
      const rp = m.rotor;
      const s = C.create('spring', tp, { x: tp.x, y: tp.y }, rp, { x: rp.x, y: rp.y });
      if (!s) return 'spring not made';
      kit.advance(3);
      let sum = 0;
      let n = 0;
      game.advance(1, () => {
        sum += Math.hypot(rp.x - tp.x, rp.y - tp.y) - s.rest;
        n++;
      });
      const stretch = sum / n;
      if (stretch > 0.3) return `hung by its rotor, the ${m.totalMass().toFixed(0)} kg motor stretches its spring ${stretch.toFixed(2)} m (a crate stretches one about 0.14 m)`;
      return true;
    }],
    ['extra: logic: a motor swings a plank hanging from its rotor by one end up and round', () => {
      kit.reset();
      const m = kit.spawn('motor', 0, 2.6) as Motor;
      m.housing.setFrozen(true);
      // (the plank's top end on the rotor, hanging straight down)
      const plank = kit.spawn('plank', 0, 1.6, { angle: Math.PI / 2 });
      plank.setFrozen(true);
      C.create('weld', plank.parts[0], { x: 0, y: 2.55 }, m.rotor, { x: 0, y: 2.55 });
      plank.setFrozen(false);
      kit.advance(1);
      m.activate();
      let turned = 0;
      game.advance(3, () => {
        turned += (m.rotor.av - m.housing.av) * game.stepDt;
      });
      if (Math.abs(turned) < Math.PI * 2) return `in 3 s the motor turned the 17 kg plank hanging from it only ${((Math.abs(turned) * 180) / Math.PI).toFixed(0)}° (not once round)`;
      return true;
    }],
    ['extra: logic: a wire shows power only where it runs (not out of a lever that’s off)', () => {
      kit.reset();
      const bat = kit.spawn('battery', -2, 0.4);
      const lever = kit.spawn('switch', 0, 0.3) as Switch;
      const lamp = kit.spawn('light', 2, 0.3);
      kit.advance(0.3);
      const w1 = wire(bat, lever);
      const w2 = wire(lever, lamp);
      if (!C.live(w1)) return 'the wire from the battery to the lever shows no power';
      if (C.live(w2)) return 'the wire out of the lever (off) to the lamp shows power';
      lever.activate();
      if (!C.live(w2)) return 'lever on: the wire to the lamp shows no power';
      return true;
    }],
    ['extra: logic: the Wire tool says which side of a gate it wired, and won’t wire a person to themselves', () => {
      kit.reset();
      const bat = kit.spawn('battery', -2, 0.4);
      const gate = kit.spawn('gate-and', 0, 0.3);
      kit.advance(0.3);
      const into = gate.parts[0].localToWorld(-L, 0);
      const lay = (x0: number, y0: number, x1: number, y1: number) => {
        kit.down(x0, y0);
        kit.move(x1, y1);
        kit.up(x1, y1);
      };
      controls.setTool('wire');
      lay(bat.parts[0].x, bat.parts[0].y, into.x, into.y);
      if (!C.list.some((k) => k.kind === 'wire')) {
        controls.setTool('drag');
        return 'no wire laid from the battery to the gate';
      }
      if (!toast().includes('AND Gate’s input')) {
        controls.setTool('drag');
        return `wired to the gate’s left half, the status says "${toast()}"`;
      }
      const h = human(4);
      kit.advance(1);
      const hand = h.limbs.get('handF')!.part;
      const foot = h.limbs.get('footF')!.part;
      const n = C.list.length;
      lay(hand.x, hand.y, foot.x, foot.y);
      controls.setTool('drag');
      if (C.list.length !== n) return 'a wire was laid from a person’s hand to their own foot';
      if (!toast().includes('different')) return `wiring a person to themselves, the status says "${toast()}"`;
      return true;
    }],
  ];
}

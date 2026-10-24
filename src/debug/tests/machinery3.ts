import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Battery, Motor, Thruster } from '../../entities/Machines';
import type { Piston, ReversingSwitch, Switch } from '../../entities/Devices';
import { getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { PX } from '../../engine/constants';
import { REST_CHECK } from '../../systems/Settle';

export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const C = game.connections;
  const UP = Math.PI / 2;
  const deg = (d: number) => (d * Math.PI) / 180;
  const at = (e: Entity) => ({ x: e.parts[0].x, y: e.parts[0].y });
  const wire = (a: Entity, b: Entity) => C.create('wire', a.parts[0], at(a), b.parts[0], at(b));
  /** Picks an entry of something's own menu, by its label (as a guest's pick is found on the host: see net/Host's 'act'). */
  const pick = (e: Entity, label: string) => {
    const a = e.contextActions().find((x) => x.label === label);
    a?.action();
    return !!a;
  };
  const checked = (e: Entity) => e.contextActions().filter((a) => a.checked).map((a) => a.label).join(', ');
  const find = <T extends Entity>(id: string, i = 0) => game.entities.filter((e) => e.def.id === id && !e.destroyed)[i] as T;
  /** The push (N) a free thruster gives in a step from standing, 6 m up, along its facing (gravity's pull taken out). */
  const pushOf = (t: Thruster) => {
    const p = t.parts[0];
    t.translate(0, 6 - p.body.translation().y);
    t.setVelocity(0, 0);
    const f = p.localDir(p.flip, 0);
    game.step();
    const v = p.body.linvel();
    return p.mass * ((v.x / game.stepDt) * f.x + (v.y / game.stepDt - game.gravity) * f.y);
  };
  /** Where a reversing switch's lever is now (read afresh: a test's own checks would narrow it). */
  const posOf = (r: ReversingSwitch): string => r.pos;
  /** The rotor's spin relative to its housing (rad/s). */
  const spin = (m: Motor) => m.rotor.body.angvel() - m.housing.body.angvel();
  /** A piston at x pointing up (turned by `tilt`), standing on the floor, its cylinder frozen. */
  const upright = (x: number, tilt = 0) => {
    const p = kit.spawn('piston', x, 0.66, { angle: UP + tilt }) as Piston;
    p.base.setFrozen(true);
    return p;
  };
  /** A piston at x hanging from y pointing down (turned by `tilt`), its cylinder frozen. */
  const hanging = (x: number, y: number, tilt = 0) => {
    const p = kit.spawn('piston', x, y, { angle: -UP + tilt }) as Piston;
    p.base.setFrozen(true);
    return p;
  };
  const plate = (p: Piston) => p.rod.pixelToWorld(40, 6.5);
  /** Something laid across the pistons' plates and welded to each. */
  const across = (ps: Piston[], id: string, x: number, y: number, settle = 0.6) => {
    const e = kit.spawn(id, x, y);
    if (settle) kit.advance(settle);
    else e.setFrozen(true);
    for (const p of ps) C.create('weld', p.rod, plate(p), e.parts[0], plate(p));
    e.setFrozen(false);
    kit.advance(0.1);
    return e;
  };
  /** Runs pistons out for `s` seconds and back in for as long: their extensions out, then in. */
  const stroke = (ps: Piston[], s = 2) => {
    for (const p of ps) p.activate();
    kit.advance(s);
    const out = ps.map((p) => p.extension);
    for (const p of ps) p.activate();
    kit.advance(s);
    const back = ps.map((p) => p.extension);
    return { out, back, show: `out ${out.map((v) => v.toFixed(2)).join('/')}, back ${back.map((v) => v.toFixed(2)).join('/')}` };
  };

  return [
    ['extra: machinery3: a thruster’s thrust is set from its menu, 300 N to 4800 N (1200 N to start with), and it pushes that hard', () => {
      kit.reset();
      const desc = getItem('thruster')?.description ?? '';
      if (!desc.includes('300 N') || !desc.includes('4800 N')) return `the thruster’s description doesn’t give its range of thrust: "${desc}"`;
      const pushes: number[] = [];
      for (const label of ['Thrust 300 N', 'Thrust 1200 N', 'Thrust 4800 N']) {
        kit.reset();
        const t = kit.spawn('thruster', 0, 5, { angle: UP }) as Thruster;
        if (label === 'Thrust 1200 N' && checked(t) !== 'Thrust 1200 N') return `a new thruster’s menu has “${checked(t)}” picked, not Thrust 1200 N`;
        if (!pick(t, label)) return `the thruster’s menu has no “${label}”: ${t.contextActions().map((a) => a.label).join(', ')}`;
        if (checked(t) !== label) return `after picking “${label}”, its menu has “${checked(t)}” picked`;
        t.activate();
        pushes.push(pushOf(t));
      }
      const want = [300, 1200, 4800];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(pushes[i] - want[i]) > want[i] * 0.15) return `set to ${want[i]} N, the thruster pushes ${pushes.map((p) => p.toFixed(0)).join(' / ')} N (for 300 / 1200 / 4800)`;
      }
      return true;
    }],
    ['extra: machinery3: a motor’s and a motor wheel’s torque is set from their menus (today’s to start with): a wheel turned harder spins up faster, a weak motor can’t swing a plank round', () => {
      kit.reset();
      const m0 = kit.spawn('motor', -2, 1) as Motor;
      const w0 = kit.spawn('motor-wheel', 2, 1) as Motor;
      if (!checked(m0).includes('Torque 400 N·m')) return `a new motor’s menu has “${checked(m0)}” picked (not Torque 400 N·m)`;
      if (!checked(w0).includes('Torque 60 N·m')) return `a new motor wheel’s menu has “${checked(w0)}” picked (not Torque 60 N·m)`;
      // a motor wheel held by its hub, spun up from standing for a moment at each torque
      const spun: number[] = [];
      for (const label of ['Torque 15 N·m', 'Torque 60 N·m', 'Torque 240 N·m']) {
        kit.reset();
        const w = kit.spawn('motor-wheel', 0, 2) as Motor;
        w.housing.setFrozen(true);
        if (!pick(w, label)) return `the motor wheel’s menu has no “${label}”: ${w.contextActions().map((a) => a.label).join(', ')}`;
        w.activate();
        kit.advance(0.05);
        spun.push(Math.abs(spin(w)));
      }
      const show = spun.map((v) => v.toFixed(1)).join(' / ');
      if (spun[1] < spun[0] * 2.5 || spun[2] < spun[1] * 1.8) return `in 0.05 s the wheel spun up to ${show} rad/s at 15 / 60 / 240 N·m`;
      // at a quarter of its torque, a motor can't swing the 17 kg plank hanging from it up and over
      kit.reset();
      const m = kit.spawn('motor', 0, 2.6) as Motor;
      m.housing.setFrozen(true);
      const plank = kit.spawn('plank', 0, 1.6, { angle: UP });
      plank.setFrozen(true);
      C.create('weld', plank.parts[0], { x: 0, y: 2.55 }, m.rotor, { x: 0, y: 2.55 });
      plank.setFrozen(false);
      kit.advance(0.5);
      pick(m, 'Torque 100 N·m');
      m.activate();
      let turned = 0;
      let most = 0;
      game.advance(2, () => {
        turned += spin(m) * game.stepDt;
        most = Math.max(most, Math.abs(turned));
      });
      if (most > Math.PI * 0.75) return `at 100 N·m the motor swung the plank hanging from it ${((most * 180) / Math.PI).toFixed(0)}° round (it takes 170 N·m to lift it level)`;
      return true;
    }],
    ['extra: machinery3: thrust, torque and a reversing switch’s lever are kept by save/load, copy/paste and undo; a guest’s pick is found on the host whatever its setting', () => {
      kit.reset();
      const t = kit.spawn('thruster', -4, 0.3);
      const m = kit.spawn('motor', -1.5, 0.5);
      const w = kit.spawn('motor-wheel', 1, 0.4);
      const r = kit.spawn('reversing-switch', 3.5, 0.3);
      kit.advance(0.3);
      for (const e of [t, m, w, r]) e.setFrozen(true);
      // (a guest's copy, still at the usual settings, lists the same entries: its pick is found on the host's by name)
      const names = (e: Entity) => e.contextActions().map((a) => a.label).slice(1).join(', ');
      const before = [t, m, w].map(names);
      const picks: [Entity, string][] = [[t, 'Thrust 4800 N'], [m, 'Torque 100 N·m'], [w, 'Torque 240 N·m'], [r, 'Reverse']];
      for (const [e, label] of picks) if (!pick(e, label)) return `the ${e.def.name}’s menu has no “${label}”`;
      const after = [t, m, w].map(names);
      for (let i = 0; i < 3; i++) if (after[i] !== before[i]) return `its menu’s entries change with the setting (“${before[i]}” to “${after[i]}”): a guest’s pick wouldn’t be found on the host`;
      if (r.contextActions().map((a) => a.label).join(', ') !== 'On, Off, Reverse') return `the reversing switch’s menu is ${r.contextActions().map((a) => a.label).join(', ')}`;
      const settings = (i = 0) => {
        const th = find<Thruster>('thruster', i);
        const mo = find<Motor>('motor', i);
        const wh = find<Motor>('motor-wheel', i);
        const rs = find<ReversingSwitch>('reversing-switch', i);
        if (!th || !mo || !wh || !rs) return 'something is missing';
        const s = `thrust ${th.thrust}, motor torque ${mo.torque}, wheel torque ${wh.torque}, lever ${rs.pos}`;
        return s === 'thrust 4, motor torque 0.25, wheel torque 4, lever reverse' ? null : s;
      };
      // a guest's copy of each is told of it (as net/Guest has it: restoreExtra() of what serializeExtra() gives)
      const copy = kit.spawn('thruster', -4, 3);
      (copy as unknown as { restoreExtra(x: unknown): void }).restoreExtra((t as unknown as { serializeExtra(): unknown }).serializeExtra());
      if ((copy as Thruster).thrust !== 4) return `a guest’s copy told of the host’s thruster has thrust ${(copy as Thruster).thrust}`;
      game.remove(copy);
      loadFromString(game, saveToString(game));
      const loaded = settings();
      if (loaded) return `after save/load: ${loaded}`;
      controls.copy([find('thruster'), find('motor'), find('motor-wheel'), find('reversing-switch')]);
      kit.move(0, 5);
      controls.paste();
      const pasted = settings(1);
      if (pasted) return `the pasted copies: ${pasted}`;
      controls.history.record('Spawn Wooden Crate');
      kit.spawn('crate', 6, 0.45);
      controls.history.undo();
      const undone = settings();
      if (undone) return `after an undo: ${undone}`;
      return true;
    }],
    ['extra: machinery3: a reversing switch steps off, on, reverse, off with F; on, what it powers runs forward, in reverse backwards: the motor the other way, the thruster pushing back, the piston pulled in', () => {
      kit.reset();
      const r = kit.spawn('reversing-switch', -4, 0.3) as ReversingSwitch;
      const m = kit.spawn('motor', -1.5, 1.5) as Motor;
      const p = kit.spawn('piston', 1, 0.3) as Piston;
      const t = kit.spawn('thruster', 4, 6, { angle: UP }) as Thruster;
      kit.advance(0.3);
      m.housing.setFrozen(true);
      p.base.setFrozen(true);
      r.setFrozen(true);
      for (const e of [m, p, t]) wire(r, e);
      const things = [m, p, t];
      const state = () => things.map((e) => `${e.def.id} ${e.powered ? (e.reversed ? 'reversed' : 'forward') : 'off'}`).join(', ');
      if (r.pos !== 'off' || things.some((e) => e.powered)) return `as made: lever ${r.pos}, ${state()}`;
      // (F activates it)
      r.activate();
      if (posOf(r) !== 'on') return `F from off put the lever at ${r.pos}`;
      if (things.some((e) => !e.powered || e.reversed)) return `lever on (no battery): ${state()}`;
      kit.advance(1.2);
      const fwd = spin(m);
      const out = p.extension;
      const push = pushOf(t);
      if (Math.abs(fwd) < 4) return `lever on, the motor spins at ${fwd.toFixed(1)} rad/s`;
      if (out < 0.9) return `lever on, the piston is out ${out.toFixed(2)} m`;
      if (push < 1000) return `lever on, the thruster pushes ${push.toFixed(0)} N along its facing`;
      r.activate();
      if (posOf(r) !== 'reverse') return `F from on put the lever at ${r.pos}`;
      if (things.some((e) => !e.powered || !e.reversed)) return `lever in reverse: ${state()}`;
      kit.advance(1.2);
      const back = spin(m);
      if (Math.sign(back) === Math.sign(fwd) || Math.abs(back) < 4) return `in reverse the motor spins at ${back.toFixed(1)} rad/s (on: ${fwd.toFixed(1)})`;
      if (p.extension > 0.1) return `in reverse the piston is still out ${p.extension.toFixed(2)} m`;
      const pull = pushOf(t);
      if (pull > -1000) return `in reverse the thruster pushes ${pull.toFixed(0)} N along its facing (on: ${push.toFixed(0)})`;
      if (!checked(r).includes('Reverse')) return `in reverse its menu has “${checked(r)}” picked`;
      r.activate();
      if (posOf(r) !== 'off' || things.some((e) => e.powered)) return `F from reverse: lever ${r.pos}, ${state()}`;
      // picked from its menu, straight to reverse
      pick(r, 'Reverse');
      if (posOf(r) !== 'reverse' || !m.reversed) return `Reverse from its menu: lever ${r.pos}, ${state()}`;
      return true;
    }],
    ['extra: machinery3: in a battery’s circuit a reversing switch turns round only what is past it; a Switch, a lamp on the battery and a pulse work as before', () => {
      kit.reset();
      const bat = kit.spawn('battery', -5, 0.4) as Battery;
      const r = kit.spawn('reversing-switch', -3, 0.3) as ReversingSwitch;
      const lamp = kit.spawn('light', -5, 2);
      const m = kit.spawn('motor', -1, 1.5) as Motor;
      const lever = kit.spawn('switch', 1.5, 0.3) as Switch;
      const m2 = kit.spawn('motor', 3.5, 1.5) as Motor;
      const btn = kit.spawn('button', -3, 2);
      kit.advance(0.3);
      for (const e of [bat, r, lamp, lever, btn]) e.setFrozen(true);
      for (const x of [m, m2]) x.housing.setFrozen(true);
      wire(bat, r);
      wire(r, m);
      wire(bat, lamp);
      wire(bat, lever);
      wire(lever, m2);
      wire(btn, r);
      pick(r, 'Reverse');
      lever.activate();
      const show = () => [['lamp', lamp], ['motor past the reversing switch', m], ['motor past the Switch', m2]].map(([n, e]) => `${n} ${(e as Entity).powered ? ((e as Entity).reversed ? 'reversed' : 'forward') : 'off'}`).join(', ');
      if (!m.powered || !m.reversed || !lamp.powered || lamp.reversed || !m2.powered || m2.reversed) return `battery on, reversing switch in reverse, Switch on: ${show()}`;
      if (bat.reversed || r.reversed) return 'the battery or the reversing switch itself counts as reversed';
      kit.advance(0.6);
      if (spin(m) * spin(m2) >= 0) return `the motor past the reversing switch spins ${spin(m).toFixed(1)} rad/s, the one past the Switch ${spin(m2).toFixed(1)}: not opposite ways`;
      // the battery off: the reversing switch doesn't power its circuit alone (it's the battery's)
      bat.activate();
      if (m.powered || lamp.powered) return `battery off: ${show()}`;
      bat.activate();
      // a button's pulse steps the lever along (reverse to off, then on)
      btn.activate();
      if (r.pos !== 'off') return `a button’s pulse put the lever from reverse at ${r.pos}`;
      kit.advance(0.3);
      btn.activate();
      if (posOf(r) !== 'on' || !m.powered || m.reversed) return `a second pulse: lever ${r.pos}, ${show()}`;
      // saved and loaded in reverse, what it powers comes back reversed
      pick(r, 'Reverse');
      loadFromString(game, saveToString(game));
      kit.advance(0.6);
      const ms = game.entities.filter((e) => e.def.id === 'motor') as Motor[];
      const past = ms.find((x) => x.reversed);
      if ((find<ReversingSwitch>('reversing-switch')).pos !== 'reverse' || !past) return `after save/load the lever is at ${find<ReversingSwitch>('reversing-switch').pos} and ${ms.filter((x) => x.reversed).length} motors are reversed`;
      if (spin(past) * spin(ms.find((x) => x !== past)!) >= 0) return 'after save/load the two motors spin the same way';
      return true;
    }],
    ['extra: machinery3: pistons lifting one plank or beam together go all the way up and back down though set a few degrees out of line', () => {
      const scenes: [string, () => Piston[]][] = [
        ['two, one turned 3°', () => {
          const ps = [upright(-0.6), upright(0.6, deg(3))];
          across(ps, 'plank', 0, 1.65);
          return ps;
        }],
        ['two, one turned 3° the other way', () => {
          const ps = [upright(-0.6), upright(0.6, deg(-3))];
          across(ps, 'plank', 0, 1.65);
          return ps;
        }],
        ['two splayed 2° apart under a beam', () => {
          const ps = [upright(-1, deg(2)), upright(1, deg(-2))];
          across(ps, 'beam', 0, 1.68);
          return ps;
        }],
        ['three, the middle one turned 2°', () => {
          const ps = [upright(-1.1), upright(0, deg(2)), upright(1.1)];
          across(ps, 'beam', 0, 1.68);
          return ps;
        }],
        ['two hanging, pushing down, one turned 3°', () => {
          const ps = [hanging(-0.6, 3), hanging(0.6, 3, deg(3))];
          // (the plank held where it's welded on: nothing under it)
          across(ps, 'plank', 0, 3 - 0.875 - 0.08, 0);
          return ps;
        }],
      ];
      for (const [name, make] of scenes) {
        kit.reset();
        const ps = make();
        const s = stroke(ps);
        if (s.out.some((v) => v < 0.9) || s.back.some((v) => v > 0.1)) return `${name}: ${s.show}`;
      }
      return true;
    }],
    ['extra: machinery3: a lift left resting up top goes back down when switched off, even with a rest check the very next step', () => {
      kit.reset();
      const ps = [upright(-1.1), upright(1.1)];
      const beam = across(ps, 'beam', 0, 1.68);
      for (const p of ps) p.activate();
      kit.advance(2.5);
      // at rest up there, as the game's rest checks find a lift left a while (and put it to sleep with what it holds)
      for (const e of [...ps, beam]) {
        e.atRest = true;
        e.restChecks = 2;
      }
      // switched off just before a rest check: its first moment of moving mustn't count as resting
      while (Math.floor(game.time / REST_CHECK) === Math.floor((game.time - game.stepDt) / REST_CHECK)) game.step();
      for (const p of ps) p.activate();
      kit.advance(1.5);
      if (ps.some((p) => p.extension > 0.1)) return `switched off, the lift stayed up: out ${ps.map((p) => p.extension.toFixed(2)).join('/')}, ${ps.filter((p) => p.rod.body.isSleeping()).length} rods asleep`;
      return true;
    }],
    ['extra: machinery3: one piston still holds its rod straight in line with a load to one side, and keeps its stroke through save/load', () => {
      kit.reset();
      // lying along the floor, a crate welded on its plate hanging off to one side
      const p = kit.spawn('piston', -1, 1.5) as Piston;
      p.base.setFrozen(true);
      const crate = kit.spawn('crate', 0.1, 1.5 + 0.55);
      crate.setFrozen(true);
      C.create('weld', p.rod, plate(p), crate.parts[0], plate(p));
      crate.setFrozen(false);
      p.activate();
      kit.advance(1.5);
      const off = () => {
        // the rod's centre from the cylinder's line, and its turn from the cylinder's
        const b = p.base.body.translation();
        const r = p.rod.body.translation();
        const n = p.base.localDir(0, 1);
        return { across: Math.abs((r.x - b.x) * n.x + (r.y - b.y) * n.y), turn: Math.abs(p.rod.body.rotation() - p.base.body.rotation()) };
      };
      const o = off();
      if (p.extension < 0.9) return `with a ${crate.totalMass().toFixed(0)} kg crate on its plate the piston went out only ${p.extension.toFixed(2)} m`;
      if (o.across > 0.6 * PX || o.turn > deg(0.5)) return `with a ${crate.totalMass().toFixed(0)} kg crate on its plate its rod sags ${(o.across * 100).toFixed(1)} cm off the cylinder’s line, turned ${((o.turn * 180) / Math.PI).toFixed(2)}°`;
      loadFromString(game, saveToString(game));
      kit.advance(0.5);
      const q = find<Piston>('piston');
      if (q.extension < 0.9) return `after save/load the piston is out ${q.extension.toFixed(2)} m (was ${p.extension.toFixed(2)})`;
      if (Math.hypot(q.rod.body.linvel().x, q.rod.body.linvel().y) > 0.3) return 'after save/load the rod is moving';
      q.activate();
      kit.advance(1.5);
      if (q.extension > 0.1) return `after save/load it pulled in only to ${q.extension.toFixed(2)} m`;
      return true;
    }],
  ];
}

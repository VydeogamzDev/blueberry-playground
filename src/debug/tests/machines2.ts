import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { Prop } from '../../entities/Prop';
import type { Turret } from '../../entities/Turrets';
import type { Fan, Propeller } from '../../entities/Air';
import type { TeslaCoil } from '../../entities/Electric';
import type { LaunchPad, Conveyor, Winch } from '../../entities/Movers';
import type { EmpGenerator } from '../../entities/Emp';
import type { Thruster } from '../../entities/Machines';
import type { Car } from '../../entities/Car';
import type {
  Lagbox, Counter, ActivationFuse, Metronome, Detector, Siren, RadioTransmitter, RadioReceiver, Servo,
} from '../../entities/Logic2';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/**
 * The contraption toys doing what a player expects: turrets, the fan and the
 * propeller, the magnet, the tesla coil, the launch platform, and the logic
 * and timing parts (with their settings kept through save/load).
 */
export default function tests({ game, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  /** A 16 px chip's input is its left half, its output its right (this far from the middle); a metronome's, 12 px wide. */
  const L = 6 / 32;
  const M = 4 / 32;
  /** A wire between two things, `la`/`lb` m right of their (first parts') middles. */
  const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
    C.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0))!;
  const find = (id: string) => game.entities.find((e) => e.def.id === id)!;
  /** Hurt at all: bleeding, in pain, or dead. */
  const hurt = (h: Human) => !h.alive || h.blood < 100 || h.pain > 0;
  /** Steps until `done` (or `s` seconds go by); how long it took. */
  const until = (s: number, done: () => boolean, step = 0.1) => {
    let t = 0;
    while (t < s - 1e-6 && !done()) {
      kit.advance(step);
      t += step;
    }
    return t;
  };
  /** A pistol held still and pointing off to the right: its shots count the pulses it gets. */
  const counter = (x: number, y = 1.5) => {
    const g = kit.spawn('pistol', x, y) as Firearm;
    g.setFrozen(true);
    return g;
  };
  const reload = () => {
    loadFromString(game, saveToString(game));
    kit.advance(0.05);
  };

  return [
    // ---------------------------------------------------------------- turrets
    ['extra: machines2: a sentry turret shoots dead a person in front of it and leaves one behind it alone', () => {
      kit.reset();
      const tur = kit.spawn('sentry-turret', 0, 0.2) as Turret;
      const front = human(5);
      const back = human(-5);
      let turned = false;
      until(15, () => {
        if (tur.target === back) turned = true;
        return !front.alive;
      }, 0.25);
      if (front.alive) return `the person 5 m in front is alive after 15 s (${front.status()}); ${tur.shots} shots`;
      kit.advance(2);
      if (turned || tur.target === back) return 'it turned on the person behind it';
      if (hurt(back)) return `the person behind it was hurt (${back.status()})`;
      if (tur.target) return 'it still has a target with only the person behind it left';
      return true;
    }],
    ['extra: machines2: a sentry turret set to spare a team holds its fire at a teammate, and shoots once set to another', () => {
      kit.reset();
      const tur = kit.spawn('sentry-turret', 0, 0.2) as Turret;
      tur.setTeam('red');
      const mate = human(5);
      mate.setTeam('red');
      kit.advance(3);
      if (tur.shots || tur.target) return `it fired ${tur.shots} shots at its own side`;
      if (hurt(mate)) return `the teammate got hurt (${mate.status()})`;
      tur.setTeam('blue');
      until(4, () => tur.shots > 0 && hurt(mate));
      if (!tur.shots) return 'set to spare blue, it still holds its fire at someone on red';
      if (!hurt(mate)) return `${tur.shots} shots and the person on red isn’t hurt`;
      return true;
    }],
    ['extra: machines2: a sentry turret wired up runs only while powered, and activate switches it off', () => {
      kit.reset();
      const tur = kit.spawn('sentry-turret', 0, 0.2) as Turret;
      const bat = kit.spawn('battery', -2, 0.4);
      kit.advance(0.2);
      bat.activate();
      wire(bat, tur);
      const target = human(5);
      kit.advance(2);
      if (tur.running || tur.shots) return `wired to a battery that is off, it runs (${tur.shots} shots)`;
      if (hurt(target)) return 'unpowered, it hurt the person in front of it';
      bat.activate();
      until(3, () => tur.shots > 0);
      if (!tur.shots) return 'powered, it didn’t fire at the person in front of it';
      tur.activate();
      const n = tur.shots;
      kit.advance(1.5);
      if (tur.running || tur.shots !== n) return `switched off by hand while powered, it fired ${tur.shots - n} more shots`;
      tur.activate();
      kit.reset();
      // (not wired: on from the start)
      const lone = kit.spawn('sentry-turret', 0, 0.2) as Turret;
      if (!lone.running) return 'a turret with no wires isn’t on from the start';
      return true;
    }],
    ['extra: machines2: a ceiling turret (frozen in place) aims only below itself: it ignores a person level with it and shoots one below', () => {
      kit.reset();
      const low = kit.spawn('ceiling-turret', 0, 1.2) as Turret;
      low.setFrozen(true);
      const level = human(4);
      kit.advance(3);
      if (low.target || low.shots) return `it shot (${low.shots} times) at someone level with it`;
      if (hurt(level)) return 'the person level with it got hurt';
      kit.reset();
      const high = kit.spawn('ceiling-turret', 0, 3.5) as Turret;
      high.setFrozen(true);
      if (!high.frozen) return 'its base froze, yet it doesn’t read as frozen';
      const below = human(2);
      const a0 = high.head.body.rotation();
      until(5, () => high.shots > 2 && hurt(below));
      if (!high.shots) return `it didn’t fire at the person below it (aim ${(high.aim * 57.3).toFixed(0)}°)`;
      const turned = Math.abs(high.head.body.rotation() - a0);
      if (turned < 0.3) return `frozen, its head turned only ${(turned * 57.3).toFixed(0)}° toward them`;
      if (!hurt(below)) return `${high.shots} shots and the person below isn’t hurt`;
      return true;
    }],
    ['extra: machines2: a laser sentry burns a person in front of it', () => {
      kit.reset();
      const tur = kit.spawn('laser-sentry', 0, 0.2) as Turret;
      const h = human(6);
      until(6, () => tur.shots > 0 && hurt(h));
      if (!tur.shots) return 'it never fired';
      if (!hurt(h)) return `${tur.shots} beams and the person isn’t hurt`;
      return true;
    }],
    // ---------------------------------------------------------------- air
    ['extra: machines2: a fan blows a crate in front of it away and draws a ball behind it in; unpowered, it does neither', () => {
      kit.reset();
      const fan = kit.spawn('fan', 0, 0.32) as Fan;
      const crate = kit.spawn('crate', 1.3, 0.45) as Prop;
      const ball = kit.spawn('ball', -1.1, 0.3) as Prop;
      const bat = kit.spawn('battery', -4, 0.4);
      kit.advance(0.8);
      const c0 = crate.main.x;
      const b0 = ball.main.x;
      kit.advance(1.5);
      if (Math.abs(crate.main.x - c0) > 0.05 || Math.abs(ball.main.x - b0) > 0.1) return 'with no power the fan moved things';
      wire(bat, fan);
      kit.advance(1.5);
      const db = ball.main.x - b0;
      kit.advance(1.5);
      const dc = crate.main.x - c0;
      if (dc < 1) return `the crate in front was blown only ${dc.toFixed(2)} m in 3 s`;
      if (db < 0.2) return `the ball behind was drawn in only ${db.toFixed(2)} m in 1.5 s`;
      // switched off, the crate stays where it got to
      fan.activate();
      kit.advance(1);
      const c1 = crate.main.x;
      kit.advance(1.5);
      if (Math.abs(crate.main.x - c1) > 0.05) return 'switched off, the fan still blows';
      return true;
    }],
    ['extra: machines2: a fan’s blades cut a person standing at them, and fling them away', () => {
      kit.reset();
      const fan = kit.spawn('fan', 0, 0.32) as Fan;
      fan.setFrozen(true);
      const bat = kit.spawn('battery', -2, 0.4);
      const h = human(0.25);
      kit.advance(0.05);
      const x0 = h.center().x;
      wire(bat, fan);
      kit.advance(1);
      if (!hurt(h)) return 'the person at the blades isn’t hurt';
      const moved = h.center().x - x0;
      if (moved < 0.3) return `the person was flung only ${moved.toFixed(2)} m`;
      return true;
    }],
    ['extra: machines2: a propeller fixed on top of a crate lifts it while powered, and lets it down when switched off', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.44) as Prop;
      kit.advance(0.5);
      const top = crate.main.y + 14 / 32;
      const prop = kit.spawn('propeller', 0, top + 0.26, { angle: Math.PI / 2 }) as Propeller;
      kit.advance(0.05);
      C.create('weld', prop.main, { x: 0, y: top }, crate.main, { x: 0, y: top });
      const bat = kit.spawn('battery', -3, 0.4);
      kit.advance(0.3);
      const y0 = crate.main.y;
      if (prop.running) return 'it runs with no power';
      wire(bat, prop);
      kit.advance(2);
      const rise = crate.main.y - y0;
      if (rise < 1.5) return `the crate rose only ${rise.toFixed(2)} m in 2 s`;
      prop.activate();
      kit.advance(3);
      if (crate.main.y - y0 > 0.3) return `switched off, the crate is still ${(crate.main.y - y0).toFixed(2)} m up after 3 s`;
      return true;
    }],
    // ---------------------------------------------------------------- electric
    ['extra: machines2: an electromagnet pulls a metal box up to it, not a wooden crate; switched off, it lets go', () => {
      kit.reset();
      const mag = kit.spawn('electromagnet', 0, 3);
      mag.setFrozen(true);
      const box = kit.spawn('metal-box', 1.5, 0.36) as Prop;
      const crate = kit.spawn('crate', -1.5, 0.45) as Prop;
      // (the battery is steel too: out of the magnet's reach)
      const bat = kit.spawn('battery', -14, 0.4);
      kit.advance(0.6);
      const c0 = { x: crate.main.x, y: crate.main.y };
      const d0 = Math.hypot(box.main.x - mag.parts[0].x, box.main.y - mag.parts[0].y);
      wire(bat, mag);
      kit.advance(2);
      const d1 = Math.hypot(box.main.x - mag.parts[0].x, box.main.y - mag.parts[0].y);
      if (d1 > 0.9) return `the metal box is still ${d1.toFixed(2)} m off after 2 s (from ${d0.toFixed(2)} m)`;
      const cm = Math.hypot(crate.main.x - c0.x, crate.main.y - c0.y);
      if (cm > 0.05) return `the wooden crate moved ${cm.toFixed(2)} m`;
      bat.activate();
      kit.advance(2);
      if (box.main.y > 1) return `with the power off the metal box still hangs ${box.main.y.toFixed(2)} m up`;
      return true;
    }],
    ['extra: machines2: a tesla coil arcs to a person near it and hurts them, and sets a crate alight', () => {
      kit.reset();
      const coil = kit.spawn('tesla-coil', 0, 0.65) as TeslaCoil;
      const bat = kit.spawn('battery', -8, 0.4);
      const h = human(1.6);
      kit.advance(0.3);
      wire(bat, coil);
      until(5, () => coil.arcs >= 4 && hurt(h));
      if (coil.arcs < 4) return `only ${coil.arcs} arcs in 5 s`;
      if (!hurt(h)) return `${coil.arcs} arcs and the person 1.6 m off isn’t hurt`;
      const charred = h.parts.some((p) => p.charred > 0);
      if (!charred) return 'the person was struck but nowhere is burnt';
      kit.reset();
      const coil2 = kit.spawn('tesla-coil', 0, 0.65) as TeslaCoil;
      const bat2 = kit.spawn('battery', -8, 0.4);
      const crate = kit.spawn('crate', 1.3, 0.45) as Prop;
      kit.advance(0.3);
      wire(bat2, coil2);
      const t = until(10, () => crate.main.burning > 0 || crate.destroyed);
      if (!(crate.main.burning > 0) && !crate.destroyed) return `the crate never caught in ${t.toFixed(1)} s (${coil2.arcs} arcs)`;
      // switched off, no more arcs
      coil2.activate();
      kit.advance(0.1);
      const n = coil2.arcs;
      kit.advance(2);
      if (coil2.arcs !== n) return 'switched off, it still throws arcs';
      return true;
    }],
    // ---------------------------------------------------------------- launch platform
    ['extra: machines2: a launch platform throws a crate up at its strength; a button’s pulse launches it too', () => {
      const g = -game.gravity;
      // (a fresh crate each time: one that comes down on the plate may well bounce off it)
      const setUp = (strength: number) => {
        kit.reset();
        const pad = kit.spawn('launch-pad', 0, 0.2) as LaunchPad;
        const crate = kit.spawn('crate', 0, 0.85) as Prop;
        pad.strength = strength;
        kit.advance(0.8);
        return { pad, crate };
      };
      /** How high the crate on it goes once it's launched. */
      const fly = (strength: number) => {
        const { pad, crate } = setUp(strength);
        const y0 = crate.main.y;
        let peak = y0;
        pad.activate();
        for (let i = 0; i < 75; i++) {
          kit.advance(1 / 30);
          peak = Math.max(peak, crate.main.y);
        }
        return peak - y0;
      };
      const r10 = fly(10);
      const want10 = (10 * 10) / (2 * g);
      const r6 = fly(6);
      const want6 = (6 * 6) / (2 * g);
      if (Math.abs(r10 - want10) > want10 * 0.2) return `at Medium (10 m/s) the crate rose ${r10.toFixed(2)} m (want about ${want10.toFixed(2)})`;
      if (Math.abs(r6 - want6) > want6 * 0.25) return `at Low (6 m/s) the crate rose ${r6.toFixed(2)} m (want about ${want6.toFixed(2)})`;
      const { pad } = setUp(10);
      const button = kit.spawn('button', -2.5, 0.2);
      kit.advance(0.3);
      wire(button, pad);
      button.activate();
      if (pad.launched !== 1) return `a button wired to it launched ${pad.launched} things off it (want the crate: 1)`;
      return true;
    }],
    // ---------------------------------------------------------------- logic and timing
    ['extra: machines2: a lagbox passes power on its delay late, and a pulse too', () => {
      kit.reset();
      const lever = kit.spawn('switch', -2, 0.3);
      const lag = kit.spawn('lagbox', 0, 0.2) as Lagbox;
      const lamp = kit.spawn('light', 2, 0.3);
      kit.advance(0.3);
      wire(lever, lag, 0, -L);
      wire(lag, lamp, L, 0);
      kit.advance(0.1);
      if (lamp.powered) return 'the lamp is lit before anything went in';
      lever.activate();
      kit.advance(0.9);
      if (lamp.powered) return 'with a 1 s delay the lamp lit within 0.9 s';
      kit.advance(0.2);
      if (!lamp.powered) return 'with a 1 s delay the lamp isn’t lit 1.1 s after the lever';
      lever.activate();
      kit.advance(0.9);
      if (!lamp.powered) return 'the lamp went out within 0.9 s of the lever going off';
      kit.advance(0.2);
      if (lamp.powered) return 'the lamp is still lit 1.1 s after the lever went off';
      // a pulse, 0.25 s late
      kit.reset();
      const lag2 = kit.spawn('lagbox', 0, 0.2) as Lagbox;
      const gun = counter(2);
      kit.advance(0.3);
      wire(lag2, gun, L, 0);
      lag2.delay = 0.25;
      lag2.activate();
      kit.advance(0.2);
      if (gun.shots) return 'its pulse came out sooner than 0.25 s';
      kit.advance(0.1);
      if (gun.shots !== 1) return `0.3 s after a pulse went in, ${gun.shots} came out (want 1)`;
      return true;
    }],
    ['extra: machines2: a counter fires on the Nth pulse and starts again', () => {
      kit.reset();
      const button = kit.spawn('button', -2, 0.2);
      const cnt = kit.spawn('counter', 0, 0.2) as Counter;
      const gun = counter(2);
      kit.advance(0.3);
      wire(button, cnt, 0, -L);
      wire(cnt, gun, L, 0);
      const press = () => {
        button.activate();
        kit.advance(0.3);
      };
      // (read afresh each time: they change as the presses go)
      const shots = () => gun.shots;
      const count = () => cnt.count;
      press();
      press();
      if (shots() || count() !== 2) return `after 2 presses it fired ${shots()} times (count ${count()})`;
      press();
      if (shots() !== 1) return `on the 3rd press it fired ${shots()} times (want 1)`;
      if (count() !== 0) return `after firing it counts ${count()}, not 0`;
      cnt.setTarget(2);
      press();
      press();
      if (shots() !== 2) return `set to 2, two more presses fired it ${shots() - 1} times (want 1)`;
      press();
      cnt.activate();
      if (count() !== 0) return 'activate didn’t reset its count';
      return true;
    }],
    ['extra: machines2: an activation fuse passes the first pulse only, until it’s reset', () => {
      kit.reset();
      const button = kit.spawn('button', -2, 0.2);
      const fuse = kit.spawn('activation-fuse', 0, 0.2) as ActivationFuse;
      const gun = counter(2);
      kit.advance(0.3);
      wire(button, fuse, 0, -L);
      wire(fuse, gun, L, 0);
      const shots = () => gun.shots;
      const blown = () => fuse.blown;
      button.activate();
      kit.advance(0.3);
      if (shots() !== 1 || !blown()) return `the first pulse: ${shots()} shots, fuse ${blown() ? 'blown' : 'whole'}`;
      button.activate();
      kit.advance(0.3);
      button.activate();
      kit.advance(0.3);
      if (shots() !== 1) return `blown, it let ${shots() - 1} more pulses through`;
      fuse.activate();
      if (blown()) return 'activate didn’t reset it';
      button.activate();
      kit.advance(0.3);
      if (shots() !== 2) return `reset, the next pulse didn’t get through (${shots()} shots)`;
      return true;
    }],
    ['extra: machines2: a metronome ticks at its rate while powered, each beat counted downstream', () => {
      kit.reset();
      const lever = kit.spawn('switch', -2, 0.3);
      const met = kit.spawn('metronome', 0, 0.3) as Metronome;
      const cnt = kit.spawn('counter', 2, 0.2) as Counter;
      kit.advance(0.3);
      cnt.setTarget(10);
      wire(lever, met, 0, -M);
      wire(met, cnt, M, -L);
      kit.advance(1);
      if (met.beats) return `unpowered, it ticked ${met.beats} times`;
      lever.activate();
      kit.advance(3.05);
      if (Math.abs(met.beats - 6) > 1) return `at 120 a minute it ticked ${met.beats} times in 3 s (want 6)`;
      if (cnt.count !== met.beats) return `the counter on its output counted ${cnt.count} of its ${met.beats} beats`;
      lever.activate();
      kit.advance(0.1);
      met.bpm = 60;
      met.beats = 0;
      lever.activate();
      kit.advance(3.05);
      if (Math.abs(met.beats - 3) > 1) return `at 60 a minute it ticked ${met.beats} times in 3 s (want 3)`;
      lever.activate();
      const n = met.beats;
      kit.advance(2);
      if (met.beats !== n) return 'with its input off it still ticks';
      return true;
    }],
    ['extra: machines2: a metal detector sees a metal box, not a crate; a fire detector sees a crate once it burns', () => {
      kit.reset();
      const det = kit.spawn('metal-detector', 0, 0.2) as Detector;
      const lamp = kit.spawn('light', -1.5, 0.3);
      kit.spawn('crate', 1.8, 0.45);
      kit.advance(0.3);
      wire(det, lamp);
      kit.advance(0.5);
      if (det.detecting || lamp.powered) return 'it sees a wooden crate in front of it';
      const box = kit.spawn('metal-box', 3.2, 0.36);
      kit.advance(0.4);
      if (!det.detecting || !lamp.powered) return `a metal box 3.2 m in front (range ${det.range} m): it ${det.detecting ? 'sees it, but the lamp is dark' : 'doesn’t see it'}`;
      game.remove(box);
      kit.advance(0.6);
      if (det.detecting) return 'the metal box is gone and it still sees it';
      det.range = 2;
      kit.spawn('metal-box', 3.2, 0.36);
      kit.advance(0.4);
      if (det.detecting) return 'set to 2 m, it sees a metal box 3.2 m off';
      kit.reset();
      const fire = kit.spawn('fire-detector', 0, 0.2) as Detector;
      const crate = kit.spawn('crate', 1.8, 0.45) as Prop;
      kit.advance(0.5);
      if (fire.detecting) return 'the fire detector sees a crate that isn’t burning';
      game.fire.ignite(crate.main, 1);
      kit.advance(0.5);
      if (!fire.detecting) return 'the fire detector doesn’t see a burning crate 1.8 m in front';
      return true;
    }],
    ['extra: machines2: a siren runs while powered and switched on', () => {
      kit.reset();
      const siren = kit.spawn('siren', 0, 0.2) as Siren;
      const bat = kit.spawn('battery', -2, 0.4);
      kit.advance(0.3);
      if (siren.running) return 'it runs with no power';
      wire(bat, siren);
      kit.advance(0.1);
      if (!siren.running) return 'it doesn’t run while powered';
      siren.activate();
      kit.advance(0.1);
      if (siren.running) return 'switched off, it still runs';
      siren.activate();
      bat.activate();
      kit.advance(0.1);
      if (siren.running) return 'with the battery off, it still runs';
      return true;
    }],
    ['extra: machines2: radios carry power and pulses on their channel, and not on another', () => {
      kit.reset();
      const lever = kit.spawn('switch', -4, 0.3);
      const tx = kit.spawn('radio-transmitter', -2, 0.3) as RadioTransmitter;
      const rx = kit.spawn('radio-receiver', 3, 0.3) as RadioReceiver;
      const lamp = kit.spawn('light', 5, 0.3);
      kit.advance(0.3);
      wire(lever, tx);
      wire(rx, lamp);
      kit.advance(0.1);
      if (lamp.powered) return 'the lamp is lit before the transmitter is';
      lever.activate();
      kit.advance(0.1);
      if (!lamp.powered) return 'the transmitter’s wires powered: the lamp on the receiver isn’t lit';
      rx.setChannel(2);
      kit.advance(0.1);
      if (lamp.powered) return 'the receiver on channel 2 still powers its lamp from channel 1';
      tx.setChannel(2);
      kit.advance(0.1);
      if (!lamp.powered) return 'both on channel 2: the lamp isn’t lit';
      lever.activate();
      kit.advance(0.1);
      if (lamp.powered) return 'the lever off: the lamp is still lit';
      // a pulse
      kit.reset();
      const button = kit.spawn('button', -4, 0.2);
      const tx2 = kit.spawn('radio-transmitter', -2, 0.3) as RadioTransmitter;
      const rx2 = kit.spawn('radio-receiver', 3, 0.3) as RadioReceiver;
      const other = kit.spawn('radio-receiver', 4, 0.3) as RadioReceiver;
      // (one above the other: the first's shot doesn't hit the second)
      const gun = counter(6);
      const gun2 = counter(6, 2.6);
      kit.advance(0.3);
      other.setChannel(3);
      wire(button, tx2);
      wire(rx2, gun);
      wire(other, gun2);
      button.activate();
      kit.advance(0.2);
      if (gun.shots !== 1) return `a button’s pulse over the radio fired the pistol ${gun.shots} times (want 1)`;
      if (gun2.shots) return 'a receiver on another channel passed the pulse on';
      return true;
    }],
    ['extra: machines2: a servo turns its arm to its angle while powered, and back when not', () => {
      kit.reset();
      const servo = kit.spawn('servo', 0, 1) as Servo;
      servo.setFrozen(true);
      const bat = kit.spawn('battery', -2, 0.4);
      kit.advance(0.3);
      bat.activate();
      wire(bat, servo);
      kit.advance(0.5);
      if (Math.abs(servo.armAngle) > 5) return `unpowered, its arm is at ${servo.armAngle.toFixed(0)}°`;
      bat.activate();
      kit.advance(1);
      if (Math.abs(servo.armAngle - 90) > 5) return `powered, its arm turned to ${servo.armAngle.toFixed(0)}° (want 90°)`;
      bat.activate();
      kit.advance(1);
      if (Math.abs(servo.armAngle) > 5) return `power off, its arm is at ${servo.armAngle.toFixed(0)}° (want 0°)`;
      servo.angle = -45;
      servo.activate();
      kit.advance(1);
      if (Math.abs(servo.armAngle + 45) > 5) return `switched on by hand at -45°, its arm is at ${servo.armAngle.toFixed(0)}°`;
      return true;
    }],
    // ---------------------------------------------------------------- conveyor, winch, EMP
    ['extra: machines2: a conveyor belt carries a crate along at its speed, and back when reversed', () => {
      kit.reset();
      const belt = kit.spawn('conveyor-belt', 0, 0.16) as Conveyor;
      belt.setFrozen(true);
      const top = belt.main.y + 5 / 32;
      const crate = kit.spawn('crate', -0.6, top + 0.45) as Prop;
      const bat = kit.spawn('battery', -3, 0.4);
      kit.advance(0.6);
      const x0 = crate.main.x;
      kit.advance(1);
      if (Math.abs(crate.main.x - x0) > 0.03) return 'unpowered, it carried the crate';
      wire(bat, belt);
      kit.advance(0.3);
      const x1 = crate.main.x;
      kit.advance(1);
      const v = crate.main.x - x1;
      belt.dir = -1;
      kit.advance(0.3);
      const x2 = crate.main.x;
      kit.advance(0.6);
      const back = (crate.main.x - x2) / 0.6;
      if (Math.abs(v - 1) > 0.15) return `on a belt at 1 m/s the crate went ${v.toFixed(2)} m/s`;
      if (Math.abs(back + 1) > 0.2) return `reversed, the crate went ${back.toFixed(2)} m/s (want -1)`;
      belt.activate();
      kit.advance(0.5);
      const x3 = crate.main.x;
      kit.advance(0.5);
      if (Math.abs(crate.main.x - x3) > 0.03) return 'switched off, it still carries the crate';
      return true;
    }],
    ['extra: machines2: a winch reels in a rope tied to a crate and lifts it, pays it out, and stalls on what won’t come', () => {
      kit.reset();
      const winch = kit.spawn('winch', 0, 4) as Winch;
      winch.setFrozen(true);
      const crate = kit.spawn('crate', 0, 0.44) as Prop;
      const bat = kit.spawn('battery', -3, 0.4);
      kit.advance(0.5);
      const drum = winch.main.pixelToWorld(10, 4);
      const hook = { x: crate.main.x, y: crate.main.y + 0.42 };
      const rope = C.create('rope', winch.main, drum, crate.main, hook)!;
      winch.speed = 1;
      kit.advance(0.2);
      const y0 = crate.main.y;
      const r0 = rope.rest;
      kit.advance(1);
      if (rope.rest !== r0 || crate.main.y - y0 > 0.02) return 'unpowered, it reeled the rope in';
      wire(bat, winch);
      kit.advance(2);
      const rise = crate.main.y - y0;
      if (rise < 1.5) return `reeling in at 1 m/s, the crate rose only ${rise.toFixed(2)} m in 2 s (rope ${r0.toFixed(2)} → ${rope.rest.toFixed(2)} m)`;
      winch.dir = -1;
      const y1 = crate.main.y;
      kit.advance(1.5);
      if (y1 - crate.main.y < 1) return `paying out, the crate came down only ${(y1 - crate.main.y).toFixed(2)} m in 1.5 s`;
      // tied to something that won't come: it stops reeling once the rope is taut
      crate.setFrozen(true);
      winch.dir = 1;
      const span = Math.hypot(hook.x - drum.x, crate.main.y + 0.42 - drum.y);
      kit.advance(3);
      if (rope.rest < span - 0.6) return `reeling in against a frozen crate ${span.toFixed(2)} m off, the rope went down to ${rope.rest.toFixed(2)} m`;
      if (!C.list.includes(rope)) return 'reeling in against a frozen crate, the rope snapped';
      return true;
    }],
    ['extra: machines2: an EMP knocks out what’s in reach for its time (a lamp’s power, a turret, a thruster switched on by hand), then it all comes back', () => {
      kit.reset();
      const emp = kit.spawn('emp-generator', 0, 0.3) as EmpGenerator;
      emp.duration = 3;
      const bat = kit.spawn('battery', -2, 0.4);
      const lamp = kit.spawn('light', -3.5, 0.3);
      // (its flame out to the left, away from the rest)
      const thr = kit.spawn('thruster', -6, 0.5) as Thruster;
      thr.setFrozen(true);
      const tur = kit.spawn('sentry-turret', 5, 0.2) as Turret;
      const farBat = kit.spawn('battery', 16, 0.4);
      const farLamp = kit.spawn('light', 17.5, 0.3);
      kit.advance(0.3);
      wire(bat, lamp);
      wire(farBat, farLamp);
      thr.activate();
      kit.advance(0.2);
      if (!lamp.powered || !thr.running || !tur.running) return `before it goes off: lamp ${lamp.powered}, thruster ${thr.running}, turret ${tur.running}`;
      emp.activate();
      kit.advance(0.1);
      if (lamp.powered) return 'the lamp 3.5 m off is still lit';
      if (thr.running) return 'the thruster switched on by hand still runs';
      if (tur.running) return 'the turret still runs';
      if (!farLamp.powered) return 'a lamp 17.5 m off (out of its 8 m reach) went out';
      // a human walking into the turret's sight while it's out isn't shot
      const h = human(8);
      kit.advance(2.5);
      if (tur.shots) return `knocked out, the turret fired ${tur.shots} times`;
      if (lamp.powered || thr.running) return 'it came back before its 3 s were up';
      kit.advance(0.6);
      if (!lamp.powered) return 'the lamp didn’t light again after the 3 s';
      if (!thr.running) return 'the thruster didn’t start again after the 3 s';
      if (!tur.running) return 'the turret didn’t start again after the 3 s';
      until(3, () => tur.shots > 0);
      if (!tur.shots) return `back on, the turret didn’t fire at the person in front (${h.status()})`;
      return true;
    }],
    ['extra: machines2: an EMP stalls a car, even one driven with the keys; it’s kept out through save/load and drives again after', () => {
      kit.reset();
      const emp = kit.spawn('emp-generator', 0, 0.3) as EmpGenerator;
      emp.duration = 3;
      const car = kit.spawn('car', -5, 1, { flip: true }) as Car;
      kit.advance(1);
      car.activate();
      kit.advance(0.2);
      if (!car.driving) return 'switched on, the car doesn’t drive';
      emp.activate();
      kit.advance(0.1);
      if (car.driving) return 'the EMP went off and the car still drives';
      car.steer(-1);
      kit.advance(0.1);
      if (car.driving) return 'knocked out, the car drives with the keys';
      reload();
      const car2 = find('car') as Car;
      const emp2 = find('emp-generator') as EmpGenerator;
      if (!emp2.holds(car2)) return 'after save/load the car isn’t knocked out any more';
      kit.advance(0.5);
      if (car2.driving) return 'after save/load the knocked-out car drives';
      kit.advance(2.5);
      if (!car2.driving) return 'after its time the car didn’t start again';
      if (emp2.duration !== 3) return `after save/load its time is ${emp2.duration} s (want 3)`;
      return true;
    }],
    // ---------------------------------------------------------------- save/load
    ['extra: machines2: save/load keeps the contraption toys’ settings and what they were doing', () => {
      kit.reset();
      const tur = kit.spawn('sentry-turret', -6, 0.2, { flip: true }) as Turret;
      tur.setTeam('green');
      tur.activate();
      const fan = kit.spawn('fan', -4, 0.32) as Fan;
      fan.speed = 1.5;
      fan.activate();
      const pad = kit.spawn('launch-pad', -1, 0.2) as LaunchPad;
      pad.strength = 22;
      const button = kit.spawn('button', 2, 0.2);
      const lag = kit.spawn('lagbox', 4, 0.2) as Lagbox;
      // (past everything else: its shot hits nothing)
      const gun = counter(21);
      const cnt = kit.spawn('counter', 2, 1.5) as Counter;
      cnt.setFrozen(true);
      const fuse = kit.spawn('activation-fuse', 4, 1.5) as ActivationFuse;
      fuse.setFrozen(true);
      const met = kit.spawn('metronome', 8, 0.3) as Metronome;
      met.bpm = 60;
      met.activate();
      const det = kit.spawn('metal-detector', 10, 0.2, { flip: true }) as Detector;
      det.range = 2;
      det.activate();
      const tx = kit.spawn('radio-transmitter', 12, 0.3) as RadioTransmitter;
      tx.setChannel(4);
      const rx = kit.spawn('radio-receiver', 14, 0.3) as RadioReceiver;
      rx.setChannel(5);
      const servo = kit.spawn('servo', 17, 1) as Servo;
      servo.setFrozen(true);
      servo.angle = 45;
      servo.activate();
      const belt = kit.spawn('conveyor-belt', -10, 0.16) as Conveyor;
      belt.speed = 2;
      belt.dir = -1;
      const winch = kit.spawn('winch', -13, 0.3) as Winch;
      winch.speed = 0.25;
      winch.dir = -1;
      kit.advance(0.3);
      wire(button, cnt, 0, -L);
      wire(button, fuse, 0, -L);
      cnt.setTarget(4);
      // (two presses, as far apart as a button springs back up: the counter counts 2, and the first blew the fuse)
      button.activate();
      kit.advance(0.35);
      button.activate();
      kit.advance(0.35);
      wire(lag, gun, L, 0);
      lag.delay = 2;
      lag.activate();
      kit.advance(0.5);
      if (!fuse.blown) return 'before saving, the fuse wasn’t blown by the button';
      if (cnt.count !== 2) return `before saving, the counter counts ${cnt.count} (want 2)`;
      if (lag.pending !== 1) return `before saving, the lagbox has ${lag.pending} on their way (want 1)`;
      kit.advance(0.5);
      reload();
      const t2 = find('sentry-turret') as Turret;
      if (t2.team !== 'green' || t2.on) return `turret: team ${t2.team}, ${t2.on ? 'on' : 'off'} (want green, off)`;
      const f2 = find('fan') as Fan;
      if (f2.speed !== 1.5 || f2.on) return `fan: speed ${f2.speed}, ${f2.on ? 'on' : 'off'} (want 1.5, off)`;
      if ((find('launch-pad') as LaunchPad).strength !== 22) return 'launch platform: its strength is lost';
      const c2 = find('counter') as Counter;
      if (c2.target !== 4 || c2.count !== 2) return `counter: ${c2.count} of ${c2.target} (want 2 of 4)`;
      const m2 = find('metronome') as Metronome;
      if (m2.bpm !== 60 || m2.on) return `metronome: ${m2.bpm} a minute, ${m2.on ? 'on' : 'off'} (want 60, off)`;
      const d2 = find('metal-detector') as Detector;
      if (d2.range !== 2 || d2.enabled) return `detector: range ${d2.range} m, ${d2.enabled ? 'enabled' : 'disabled'} (want 2, disabled)`;
      if ((find('radio-transmitter') as RadioTransmitter).channel !== 4 || (find('radio-receiver') as RadioReceiver).channel !== 5) return 'radios: their channels are lost';
      const b2 = find('conveyor-belt') as Conveyor;
      if (b2.speed !== 2 || b2.dir !== -1) return `conveyor: ${b2.speed} m/s, ${b2.dir < 0 ? 'reversed' : 'forward'} (want 2, reversed)`;
      const w2 = find('winch') as Winch;
      if (w2.speed !== 0.25 || w2.dir !== -1) return `winch: ${w2.speed} m/s, ${w2.dir < 0 ? 'paying out' : 'reeling in'} (want 0.25, paying out)`;
      const s2 = find('servo') as Servo;
      if (s2.angle !== 45 || !s2.on) return `servo: ${s2.angle}°, ${s2.on ? 'on' : 'off'} (want 45°, on)`;
      kit.advance(0.5);
      if (Math.abs(s2.armAngle - 45) > 5) return `servo: after loading its arm is at ${s2.armAngle.toFixed(0)}° (want 45°)`;
      // what was on its way through the lagbox still comes out, on time
      const l2 = find('lagbox') as Lagbox;
      const g2 = find('pistol') as Firearm;
      if (l2.delay !== 2 || l2.pending !== 1) return `lagbox: delay ${l2.delay} s, ${l2.pending} on their way (want 2 s, 1)`;
      kit.advance(0.2);
      if (g2.shots) return 'lagbox: the pulse came out early after loading';
      kit.advance(0.5);
      if (g2.shots !== 1) return `lagbox: 2 s after it went in (across a save), ${g2.shots} pulses came out (want 1)`;
      // the fuse was blown by the button's pulse before saving
      const fu2 = find('activation-fuse') as ActivationFuse;
      if (!fu2.blown) return 'fuse: blown before saving, whole after loading';
      return true;
    }],
  ];
}

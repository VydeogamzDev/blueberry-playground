import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Track, RailWheel } from '../../entities/Rails';
import type { CoasterCar } from '../../entities/Coaster';
import type { Grabber } from '../../entities/Grabbers';
import type { Human } from '../../entities/Human';
import { PX } from '../../engine/constants';

/** Rails, rail wheels, coaster cars (0.4.0: entities/Rails, systems/Rails), the claw and the crane hook (entities/Grabbers). */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** A track laid along these points, as the Rails tool lays it. */
  const lay = (pts: { x: number; y: number }[]) => {
    const t = controls.layTrack(pts) as Track | null;
    if (!t) throw new Error('no track was laid');
    return t;
  };
  /** A coaster car on a level track at height `y` (its wheels on the rail), at `x`. */
  const car = (x: number, y: number) => kit.spawn('coaster-car', x, y + (7 + 1.5 + 9) * PX) as CoasterCar;
  const onRails = (c: CoasterCar) => c.railContacts().every((k) => game.rails.isOn(k));

  return [
    ['extra: rails: a coaster car set on a level track rolls along it on the rails', () => {
      kit.reset();
      lay([{ x: -12, y: 1 }, { x: 12, y: 1 }]);
      const c = car(-9, 1);
      kit.advance(0.3);
      if (!onRails(c)) return 'set on the track, the car isn’t on the rails';
      c.main.body.setLinvel({ x: 6, y: 0 }, true);
      kit.advance(2);
      if (!onRails(c)) return 'rolling, it came off the rails';
      if (!(c.main.x > -1)) return `2 s at 6 m/s it got to only x ${c.main.x.toFixed(2)}`;
      if (Math.abs(c.main.bodyAngle) > 0.1) return `it tipped to ${c.main.bodyAngle.toFixed(2)} rad`;
      return true;
    }],
    ['extra: rails: fast enough, a coaster car goes right round a loop, upside down at the top, and on out the other side; someone in it comes through alive', () => {
      kit.reset();
      const R = 4;
      const pts: { x: number; y: number }[] = [{ x: -26, y: 1 }, { x: 0, y: 1 }];
      for (let i = 1; i <= 64; i++) {
        const a = -Math.PI / 2 + (i / 64) * Math.PI * 2;
        // (round, drifting a little forward so it comes out ahead of where it went in)
        pts.push({ x: R * Math.cos(a) + (i / 64) * 1.2, y: 1 + R + R * Math.sin(a) });
      }
      pts.push({ x: 26, y: 1 });
      lay(pts);
      const c = car(-22, 1);
      const h = human(-24) as Human;
      kit.advance(0.5);
      c.takeIn(h, c.main.pixelToWorld(9, 12));
      if (c.pilot !== h) return 'they didn’t sit in the coaster car';
      kit.advance(0.3);
      for (const e of [c, h]) e.setVelocity(18, 0);
      let top = -Infinity;
      let flipped = false;
      let off = false;
      game.advance(5, () => {
        top = Math.max(top, c.main.y);
        if (Math.cos(c.main.bodyAngle) < -0.8) flipped = true;
        if (!onRails(c)) off = true;
      });
      if (off) return `it came off the rails (top ${top.toFixed(1)} m)`;
      if (!(top > 1 + R * 2 - 1)) return `it got only ${top.toFixed(1)} m up the ${R * 2} m loop`;
      if (!flipped) return 'it never went upside down';
      if (!(c.main.x > 3)) return `5 s on it’s at x ${c.main.x.toFixed(1)}: it didn’t come out of the loop`;
      if (c.pilot !== h) return 'the rider fell out';
      if (!h.alive) return 'the rider died';
      return true;
    }],
    ['extra: rails: a chain lift hauls a coaster car up a slope; rail wheels welded under a plank ride a track and roll off its end', () => {
      kit.reset();
      const t = lay([{ x: -6, y: 1 }, { x: 6, y: 7 }]);
      t.setDrive(4);
      const a = Math.atan2(6, 12);
      const n = { x: -Math.sin(a), y: Math.cos(a) };
      const off = (7 + 1.5 + 9) * PX;
      const c = kit.spawn('coaster-car', -4 + n.x * off, 2 + n.y * off, { angle: a }) as CoasterCar;
      kit.advance(0.2);
      const y0 = c.main.y;
      kit.advance(2.5);
      if (!onRails(c)) return 'on the chain lift it came off the rails';
      if (!(c.main.y > y0 + 2.5)) return `2.5 s on the chain lift it climbed only ${(c.main.y - y0).toFixed(2)} m`;
      // a wagon: a plank on two rail wheels
      kit.reset();
      lay([{ x: -8, y: 1 }, { x: 4, y: 1 }]);
      const wy = 1 + (7 + 1.5) * PX;
      const w1 = kit.spawn('rail-wheel', -6.6, wy) as RailWheel;
      const w2 = kit.spawn('rail-wheel', -5.4, wy) as RailWheel;
      const plank = kit.spawn('plank', -6, wy + 0.3);
      kit.advance(0.1);
      weld(plank, w1, { x: -6.6, y: wy + 0.15 });
      weld(plank, w2, { x: -5.4, y: wy + 0.15 });
      kit.advance(0.3);
      if (!w1.onTrack || !w2.onTrack) return 'the wagon’s wheels aren’t on the rails';
      for (const e of [plank, w1, w2]) e.setVelocity(5, 0);
      kit.advance(1);
      if (!w1.onTrack || !(plank.parts[0].x > -3)) return `the wagon didn’t roll along (at x ${plank.parts[0].x.toFixed(2)}, on: ${w1.onTrack})`;
      kit.advance(2.5);
      if (w2.onTrack) return 'past the end of the track the wagon’s still on it';
      return true;
    }],
    ['extra: grab: a claw shut on a crate holds it up, opened it drops it; a crane hook catches what comes into its throat and F lets it go', () => {
      kit.reset();
      const claw = kit.spawn('claw', 0, 3) as Grabber;
      // (the crate's top between its jaws, held there till they shut)
      const crate = kit.spawn('crate', 0, 3 - 0.31 - 0.3);
      kit.advance(0.05);
      claw.parts[0].setFrozen(true);
      crate.parts[0].setFrozen(true);
      claw.activate();
      crate.parts[0].setFrozen(false);
      if (!claw.held) return 'shut, the claw holds nothing';
      const y = crate.parts[0].y;
      kit.advance(1);
      if (Math.abs(crate.parts[0].y - y) > 0.1) return `held, the crate moved ${(crate.parts[0].y - y).toFixed(2)} m`;
      claw.activate();
      kit.advance(1);
      if (claw.held || !(crate.parts[0].y < y - 0.3)) return 'opened, the claw didn’t drop the crate';
      // the hook
      kit.reset();
      const hook = kit.spawn('crane-hook', 0, 4) as Grabber;
      kit.advance(0.05);
      hook.parts[0].setFrozen(true);
      const at = hook.main.pixelToWorld(7, 19);
      const ball = kit.spawn('ball', at.x, at.y);
      kit.advance(1);
      if (hook.held?.part.entity !== ball) return `the hook caught ${hook.held ? hook.held.part.entity.def.id : 'nothing'}`;
      hook.activate();
      kit.advance(0.6);
      if (hook.held) return 'F didn’t make the hook let go';
      return true;
    }],
  ];
}

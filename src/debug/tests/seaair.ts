import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Wing, HeliRotor } from '../../entities/Aircraft';
import type { Anchor, BallastTank, BoatPropeller } from '../../entities/Boats';
import { builtinMap } from '../../world/Maps';

/** Wings, rotors, wind and the sea's parts (0.4.0: entities/Aircraft, entities/Boats, systems/Seafaring, Weather.windAt()). */
export default function tests({ game, kit }: TestCtx): Test[] {
  const C = game.connections;
  const r = game.renderer;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** Runs `f` with gravity off, then back. */
  const weightless = <T>(f: () => T): T => {
    const g0 = game.gravity;
    game.setGravity(0);
    try {
      return f();
    } finally {
      game.setGravity(g0);
    }
  };
  const map = (id: string, x: number, y: number) => {
    kit.reset();
    game.setMap(builtinMap(id)!);
    r.camX = x;
    r.camY = y;
    kit.advance(0);
  };

  return [
    ['extra: air: a wing going along a little nose up is lifted hard; tipped too far, it says it’s stalled', () => weightless(() => {
      kit.reset();
      const A = (6 * Math.PI) / 180;
      const w = kit.spawn('wing', 0, 10, { angle: A }) as Wing;
      kit.advance(0.05);
      let lift = 0;
      // (held at its angle and level, as if flown: free, the air turns it into the wind, and
      // climbing, it meets the air at less; its lift read as the climb it gains each step)
      game.advance(0.3, () => {
        lift = w.main.vy / game.stepDt;
        w.main.body.setLinvel({ x: 30, y: 0 }, true);
        w.main.body.setRotation(A, true);
        w.main.body.setAngvel(0, true);
      });
      if (Math.abs(w.aoa - 6) > 2.5) return `6° nose up at 30 m/s its angle to the air reads ${w.aoa.toFixed(1)}°`;
      if (w.stalled) return 'at 6° it says it’s stalled';
      if (!(lift > 5)) return `at 30 m/s, 6° nose up, the air lifts it at only ${lift.toFixed(2)} m/s²`;
      w.main.teleport(0, 10, (30 * Math.PI) / 180);
      kit.advance(0.1);
      game.advance(0.2, () => {
        w.main.body.setLinvel({ x: 30, y: 0 }, true);
        w.main.body.setRotation((30 * Math.PI) / 180, true);
        w.main.body.setAngvel(0, true);
      });
      if (!w.stalled) return `30° nose up it isn’t stalled (reads ${w.aoa.toFixed(1)}°)`;
      return true;
    })],
    ['extra: air: a helicopter rotor spun up lifts what it’s on off the ground, after a moment spinning up', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.4);
      const rot = kit.spawn('heli-rotor', 0, 1.05) as HeliRotor;
      kit.advance(0.3);
      weld(box, rot, { x: 0, y: 0.75 });
      kit.advance(0.2);
      const y0 = box.parts[0].y;
      rot.activate();
      kit.advance(0.5);
      if (box.parts[0].y - y0 > 0.3) return 'it leapt up before the rotor spun up';
      kit.advance(4.5);
      if (!(rot.spin > 0.9)) return `5 s on, the rotor’s only at ${(rot.spin * 100).toFixed(0)}%`;
      if (!(box.parts[0].y - y0 > 1)) return `5 s on, it’s only ${(box.parts[0].y - y0).toFixed(2)} m up`;
      return true;
    }],
    ['extra: air: wind blows what’s in the air along, and fills a sail on a raft at sea', () => {
      kit.reset();
      game.weather.set({ wind: 1 });
      try {
        const plank = weightless(() => {
          // (stood on end: broadside to the wind)
          const p = kit.spawn('plank', 0, 10, { angle: Math.PI / 2 });
          game.advance(2, () => {});
          return p;
        });
        if (!(plank.parts[0].vx > 1)) return `in a gale, 2 s on, a plank in the air drifts at ${plank.parts[0].vx.toFixed(2)} m/s`;
        map('sea', -60, 10);
        game.weather.set({ wind: 1 });
        const raft = kit.spawn('buoyancy-tube', -60, 9.4);
        const sail = kit.spawn('sail', -60, 10.6);
        kit.advance(0.2);
        weld(raft, sail, { x: -60, y: 9.6 });
        const x0 = raft.parts[0].x;
        kit.advance(6);
        if (!(raft.parts[0].x - x0 > 3)) return `6 s in a gale the raft with a sail went ${(raft.parts[0].x - x0).toFixed(2)} m`;
      } finally {
        game.weather.set({ wind: 0 });
      }
      return true;
    }],
    ['extra: sea: a boat propeller under water drives a raft; out of the water it does nothing', () => {
      map('sea', -60, 10);
      // (a plank raft, the propeller under its back end)
      const raft = kit.spawn('plank', -60, 9.2);
      const prop = kit.spawn('boat-propeller', -60.9, 8.85) as BoatPropeller;
      kit.advance(0.05);
      weld(raft, prop, { x: -60.75, y: 9.05 });
      kit.advance(1.5);
      if (prop.bite() < 0.5) return `afloat, its blades bite ${prop.bite().toFixed(2)} of the water`;
      const x0 = raft.parts[0].x;
      prop.activate();
      kit.advance(4);
      if (!(raft.parts[0].x - x0 > 3)) return `4 s of the propeller moved the raft ${(raft.parts[0].x - x0).toFixed(2)} m`;
      // on dry land
      kit.reset();
      const p2 = kit.spawn('boat-propeller', 0, 0.3) as BoatPropeller;
      kit.advance(0.2);
      p2.activate();
      kit.advance(1);
      if (Math.abs(p2.main.vx) > 0.3) return `on dry land it pushed itself along at ${p2.main.vx.toFixed(2)} m/s`;
      return true;
    }],
    ['extra: sea: a ballast tank flooded sinks a float, blown it rises; an anchor dropped digs in; deep enough, the sea crushes a metal box', () => {
      map('ocean', -100, 200);
      const tube = kit.spawn('buoyancy-tube', -100, 200);
      const tank = kit.spawn('ballast-tank', -100, 199.4) as BallastTank;
      kit.advance(0.2);
      weld(tube, tank, { x: -100, y: 199.6 });
      kit.advance(2);
      const yf = tube.parts[0].y;
      if (yf < 198) return `with the tank empty the float sank to ${yf.toFixed(1)} m (the surface is at 200)`;
      tank.activate();
      game.advance(15, () => (r.camY = tube.parts[0].y));
      if (!(tube.parts[0].y < 194)) return `flooded 15 s it’s at ${tube.parts[0].y.toFixed(1)} m (${Math.round(tank.fill * 100)}% flooded)`;
      const low = tube.parts[0].y;
      tank.activate();
      game.advance(20, () => (r.camY = tube.parts[0].y));
      if (!(tube.parts[0].y > low + 3)) return `blown 20 s it went from ${low.toFixed(1)} to ${tube.parts[0].y.toFixed(1)} m`;
      // crushed: a metal box 190 m down (past its 160)
      const box = kit.spawn('metal-box', 40, 10);
      r.camX = 40;
      r.camY = 10;
      kit.advance(0.2);
      const hp0 = box.parts[0].hp;
      kit.advance(3);
      if (!(box.destroyed || box.parts[0].hp < hp0 * 0.9)) return `190 m down a metal box’s health went ${hp0.toFixed(0)} → ${box.parts[0].hp.toFixed(0)}`;
      // the anchor
      map('sea', -60, 4);
      const a = kit.spawn('anchor', -60, 3) as Anchor;
      kit.advance(3);
      if (!a.dug) return 'on the sea bed the anchor hasn’t dug in';
      a.activate();
      kit.advance(0.2);
      if (a.dug) return 'weighed, it’s still dug in';
      return true;
    }],
  ];
}

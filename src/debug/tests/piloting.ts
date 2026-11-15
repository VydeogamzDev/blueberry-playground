import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Thruster } from '../../entities/Machines';
import type { HoverThruster, KeyTrigger, ThrottleLever } from '../../entities/Flight';
import type { Car } from '../../entities/Car';
import type { Human } from '../../entities/Human';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { WORLD_MAP } from '../../world/Maps';

/** Flying what's built (systems/Piloting), the flight parts (entities/Flight), and the vehicles' new controls. */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** Holds a key for `s` seconds (game time), then lets it go. */
  const hold = (code: string, s: number) => {
    kit.key(code, true);
    kit.advance(s);
    kit.key(code, false);
  };
  /** A plank with a thruster pointing up near each end (and a cockpit on it in the middle). */
  const rocket = (seat = true) => {
    const plank = kit.spawn('plank', 0, 0.3);
    const l = kit.spawn('thruster', -0.75, 0.6, { angle: Math.PI / 2 }) as Thruster;
    const r = kit.spawn('thruster', 0.75, 0.6, { angle: Math.PI / 2 }) as Thruster;
    const cockpit = seat ? kit.spawn('cockpit', 0, 0.75) : null;
    kit.advance(0.3);
    for (const t of [l, r]) weld(plank, t, { x: t.main.x, y: plank.parts[0].y + 0.05 });
    if (cockpit) weld(plank, cockpit, { x: 0, y: plank.parts[0].y + 0.05 });
    kit.advance(0.2);
    return { plank, l, r, cockpit };
  };
  const angleOf = (p: Part) => Math.atan2(Math.sin(p.bodyAngle), Math.cos(p.bodyAngle));
  return [
    ['extra: piloting: a cockpit rocket climbs on W, keeps its throttle let go of (and deselected), and comes down on S', () => {
      kit.reset();
      const { plank, l, r, cockpit } = rocket();
      controls.selection = new Set([cockpit!]);
      const y0 = plank.parts[0].y;
      hold('KeyW', 1);
      if (l.pilotOut === null || r.pilotOut === null) return 'the thrusters aren’t under the pilot';
      const t = l.pilotT;
      if (t < 0.4) return `the throttle only went to ${t.toFixed(2)} in a second of W`;
      kit.advance(1);
      const y1 = plank.parts[0].y;
      if (y1 - y0 < 3) return `it only climbed ${(y1 - y0).toFixed(1)} m`;
      if (Math.abs(angleOf(plank.parts[0])) > 0.6) return `it tipped over (${angleOf(plank.parts[0]).toFixed(2)} rad)`;
      controls.selection = new Set();
      kit.advance(0.6);
      if (!l.running || !r.running) return 'deselected, its thrusters stopped';
      if (Math.abs(l.pilotT - t) > 0.01) return `deselected, its throttle went from ${t.toFixed(2)} to ${l.pilotT.toFixed(2)}`;
      controls.selection = new Set([cockpit!]);
      hold('KeyS', 2);
      if (l.pilotT > 0.01) return `S left the throttle at ${l.pilotT.toFixed(2)}`;
      if (l.running) return 'the throttle down, its thrusters still run';
      return true;
    }],
    ['extra: piloting: Q and E turn a two-thruster craft (the thruster on the side it turns from fires harder), A and D fire thrusters pushing that way', () => {
      kit.reset();
      const { plank, l, r } = rocket(false);
      const side = kit.spawn('mini-thruster', 0.2, 0.55) as Thruster;
      kit.advance(0.2);
      weld(plank, side, { x: side.main.x, y: plank.parts[0].y + 0.05 });
      kit.advance(0.1);
      controls.selection = new Set([plank]);
      kit.key('KeyQ', true);
      kit.advance(0.1);
      const q = { l: l.running, r: r.running };
      kit.key('KeyQ', false);
      if (!q.r || q.l) return `Q (anticlockwise): left ${q.l ? 'on' : 'off'}, right ${q.r ? 'on' : 'off'} (the right one should push it round)`;
      kit.advance(0.3);
      kit.key('KeyE', true);
      kit.advance(0.1);
      const e = { l: l.running, r: r.running };
      kit.key('KeyE', false);
      if (!e.l || e.r) return `E (clockwise): left ${e.l ? 'on' : 'off'}, right ${e.r ? 'on' : 'off'}`;
      kit.key('KeyD', true);
      kit.advance(0.1);
      const d = side.running;
      kit.key('KeyD', false);
      kit.key('KeyA', true);
      kit.advance(0.1);
      const a = side.running;
      kit.key('KeyA', false);
      if (!d || a) return `the thruster pushing right: on D ${d}, on A ${a}`;
      return true;
    }],
    ['extra: piloting: a hover craft rises to the height its throttle sets and holds it there, level', () => {
      kit.reset();
      const plank = kit.spawn('plank', 0, 1.2);
      const a = kit.spawn('hover-thruster', -0.7, 0.9) as HoverThruster;
      const b = kit.spawn('hover-thruster', 0.7, 0.9) as HoverThruster;
      kit.advance(0.3);
      for (const h of [a, b]) weld(plank, h, { x: h.main.x, y: (plank.parts[0].y + h.main.y) / 2 });
      kit.advance(0.2);
      controls.selection = new Set([plank]);
      hold('KeyW', 0.5);
      controls.selection = new Set();
      const want = a.target;
      kit.advance(5);
      const h = a.height();
      if (h === null) return 'it rose out of its own reach';
      if (Math.abs(h - want) > 0.6) return `it holds ${h.toFixed(2)} m over the floor; its throttle says ${want.toFixed(2)}`;
      const tilt = angleOf(plank.parts[0]);
      if (Math.abs(tilt) > 0.12) return `it rides tilted (${tilt.toFixed(2)} rad)`;
      if (Math.abs(plank.parts[0].vy) > 0.3) return `still bobbing at ${plank.parts[0].vy.toFixed(2)} m/s`;
      return true;
    }],
    ['extra: piloting: a gyroscope welded to a crate tipped on its corner rights it, and Q turns the angle it holds', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 1.2, { angle: 0.9 });
      const g = kit.spawn('gyroscope', 0, 1.2, { angle: 0.9 });
      kit.advance(0.05);
      weld(crate, g, { x: g.parts[0].x, y: g.parts[0].y });
      kit.advance(3);
      const a = angleOf(crate.parts[0]);
      if (Math.abs(a) > 0.12) return `the crate is still at ${a.toFixed(2)} rad`;
      controls.selection = new Set([crate]);
      hold('KeyQ', 0.5);
      kit.advance(1);
      const b = angleOf(crate.parts[0]);
      if (b < 0.3) return `Q only turned it to ${b.toFixed(2)} rad`;
      return true;
    }],
    ['extra: piloting: a key trigger wired to a thruster runs it while its key is held; a throttle lever half pulled runs one at half', () => {
      kit.reset();
      const key = kit.spawn('key-trigger', -1, 0.2) as KeyTrigger;
      const t = kit.spawn('thruster', 1, 0.3) as Thruster;
      t.setFrozen(true);
      kit.advance(0.2);
      C.create('wire', key.main, { x: key.main.x, y: key.main.y }, t.main, { x: t.main.x, y: t.main.y });
      kit.advance(0.1);
      if (t.running) return 'the thruster runs before the key is pressed';
      kit.key(key.key, true);
      kit.advance(0.1);
      if (!t.running) return `held ${key.key.slice(3)}: the thruster doesn’t run`;
      kit.key(key.key, false);
      kit.advance(0.1);
      if (t.running) return 'let go of: the thruster still runs';
      const lever = kit.spawn('throttle-lever', -1, 2) as ThrottleLever;
      const t2 = kit.spawn('thruster', 1, 2) as Thruster;
      t2.setFrozen(true);
      kit.advance(0.2);
      C.create('wire', lever.main, { x: lever.main.x, y: lever.main.y }, t2.main, { x: t2.main.x, y: t2.main.y });
      lever.set(0.5);
      kit.advance(0.1);
      if (!t2.running) return 'the lever half pulled: the thruster doesn’t run';
      if (Math.abs(t2.powerLevel - 0.5) > 0.01) return `the power reaching it is ${t2.powerLevel.toFixed(2)}, not 0.5`;
      return true;
    }],
    ['extra: piloting: someone dropped in a cockpit sits in it, and selected, they fly what it’s built into', () => {
      kit.reset();
      const { plank, cockpit } = rocket();
      const h = human(3);
      kit.advance(0.5);
      const c = cockpit!;
      const at = c.parts[0].pixelToWorld(9, 6);
      if (!(c as unknown as { takeIn(h: unknown, at: unknown): boolean }).takeIn(h, at)) return 'they didn’t get in';
      kit.advance(0.3);
      if (!h.seat) return 'they aren’t sat in it';
      controls.selection = new Set([h]);
      const y0 = plank.parts[0].y;
      hold('KeyW', 1.6);
      kit.advance(0.8);
      if (plank.parts[0].y - y0 < 2) return `flown from the pilot, it only rose ${(plank.parts[0].y - y0).toFixed(1)} m`;
      if (!h.seat) return 'they fell out on the way up';
      return true;
    }],
    ['extra: piloting: what’s left at a throttle is saved and loaded at it', () => {
      kit.reset();
      const { l } = rocket();
      controls.selection = new Set([l]);
      hold('KeyW', 0.6);
      controls.selection = new Set();
      const t = l.pilotT;
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.1);
      const back = game.entities.filter((e) => e.def.id === 'thruster') as Thruster[];
      if (back.length !== 2) return `${back.length} thrusters after loading`;
      if (back.some((b) => Math.abs(b.pilotT - t) > 0.01 || b.pilotOut === null || !b.running)) return `loaded: throttle ${back.map((b) => b.pilotT.toFixed(2)).join(', ')} (saved ${t.toFixed(2)}), running ${back.map((b) => b.running).join(', ')}`;
      return true;
    }],
    ['extra: piloting: saved while flown at no throttle (a contraption saved selected), a rocket’s thrusters answer the throttle lever wired to them once loaded', () => {
      kit.reset();
      const { plank, l, r } = rocket(false);
      const lever = kit.spawn('throttle-lever', 0, 1.2) as ThrottleLever;
      kit.advance(0.2);
      weld(plank, lever, { x: 0, y: plank.parts[0].y + 0.05 });
      for (const t of [l, r]) C.create('wire', lever.main, { x: lever.main.x, y: lever.main.y }, t.main, { x: t.main.x, y: t.main.y });
      // flown at nothing, and saved while it still is
      controls.selection = new Set([plank]);
      kit.advance(0.3);
      if (l.pilotOut !== 0) return `flown at no throttle, its thruster's pilot setting is ${l.pilotOut}`;
      const s = saveToString(game);
      controls.selection = new Set();
      kit.reset();
      loadFromString(game, s);
      kit.advance(1);
      const back = game.entities.filter((e) => e.def.id === 'thruster') as Thruster[];
      const lv = game.entities.find((e) => e.def.id === 'throttle-lever') as ThrottleLever | undefined;
      if (back.length !== 2 || !lv) return `${back.length} thrusters and ${lv ? 'a' : 'no'} lever after loading`;
      lv.set(1);
      kit.advance(0.2);
      if (back.some((t) => !t.running)) return `the lever pulled all the way: running ${back.map((t) => t.running).join(', ')} (pilot settings ${back.map((t) => t.pilotOut).join(', ')})`;
      return true;
    }],
    ['extra: piloting: a tall craft’s engines side by side under it level it and turn it (they were counted against its height, and none did)', () => {
      kit.reset();
      const { plank, l, r } = rocket(false);
      // a 10 m mast stood on the plank between them
      const mast = kit.spawn('beam', 0, 5.5, { angle: Math.PI / 2, config: { w: 320, h: 6 } });
      mast.setFrozen(true);
      plank.setFrozen(true);
      kit.advance(0.2);
      weld(plank, mast, { x: 0, y: plank.parts[0].y + 0.05 });
      controls.selection = new Set([plank]);
      kit.advance(0.7);
      const c = game.piloting.craftOf([plank]);
      if (!c) return 'nothing to fly';
      const m = [l, r].map((t) => c.mix.get(t));
      if (!c.levels || m.some((x) => !x?.rot)) return `levels ${c.levels}; the thrusters turn it ${m.map((x) => x?.rot).join(', ')}`;
      return true;
    }],
    ['extra: piloting: a plank plane takes off on its throttle: its wing set at an angle lifts it once it’s fast enough (set level, the same build stays down)', () => {
      /** A plank fuselage with a thruster behind it and a gyroscope on it (holding it level), and a plank wing over it at `inc` (rad). */
      const plane = (inc: number) => {
        kit.reset();
        game.setMap(WORLD_MAP);
        const r = game.renderer;
        r.camX = -100;
        r.camY = 3;
        game.step();
        const x0 = -100;
        const body = kit.spawn('plank', x0, 0.2);
        const t = kit.spawn('thruster', x0 - 2.47, 0.4);
        const g = kit.spawn('gyroscope', x0 + 1.2, 0.8);
        kit.advance(0.5);
        const fy = body.parts[0].y;
        const wing = kit.spawn('plank', x0 - 0.3, fy + 0.9, { angle: inc });
        wing.setFrozen(true);
        weld(body, t, { x: x0 - 2, y: fy });
        weld(body, g, { x: g.parts[0].x, y: fy + 0.1 });
        weld(body, wing, { x: wing.parts[0].x, y: fy + 0.5 });
        wing.setFrozen(false);
        kit.advance(0.5);
        controls.selection = new Set([body]);
        const p = body.parts[0];
        const x = p.x;
        let off = Infinity;
        let early = 0;
        let worst = 0;
        kit.key('KeyW', true);
        game.advance(8, (i) => {
          r.camX = p.x;
          r.camY = p.y;
          const up = p.y - game.env.groundAt(p.x, 1e6);
          if (i * game.stepDt < 2) early = Math.max(early, up);
          if (up > 3 && off === Infinity) off = p.x - x;
          worst = Math.max(worst, Math.abs(angleOf(p)));
        });
        kit.key('KeyW', false);
        return { off, early, worst, up: p.y - game.env.groundAt(p.x, 1e6), v: p.vx, run: p.x - x };
      };
      const f = plane(0.12);
      if (f.early > 0.6) return `it was ${f.early.toFixed(1)} m up in its first 2 s: pushed up, not lifted`;
      if (f.off === Infinity) return `in 8 s of W it got only ${f.up.toFixed(1)} m off the ground (${f.run.toFixed(0)} m run, ${f.v.toFixed(0)} m/s)`;
      if (f.v < 25) return `flying, it's only going ${f.v.toFixed(1)} m/s`;
      if (f.worst > 0.6) return `it tipped ${f.worst.toFixed(2)} rad`;
      const level = plane(0);
      if (level.off !== Infinity || level.up > 1) return `with its wing set level it still got ${level.up.toFixed(1)} m up`;
      return true;
    }],
    ['extra: piloting: someone standing on a plank rocket rides it up past 25 m/s unhurt, at either length of step', () => {
      // (people's limbs sweep for what they'd hit in a step (CCD), and Rapier held a plank
      // still where it ends the step: one flown up further in a step than it's thick, about
      // 22 m/s at 1/120 s and 11 m/s at the long step, caught the feet on its underside and
      // drove them through it, flinging both apart at hundreds of g; see tools/rapier/README)
      const was = game.stepDt;
      try {
        for (const dt of [1 / 120, 1 / 60]) {
          kit.reset();
          game.setMap(WORLD_MAP);
          game.stepDt = 1 / 120;
          const plank = kit.spawn('plank', 0, 0.3);
          const l = kit.spawn('thruster', -0.75, 0.6, { angle: Math.PI / 2 });
          const r = kit.spawn('thruster', 0.75, 0.6, { angle: Math.PI / 2 });
          kit.advance(0.3);
          for (const t of [l, r]) weld(plank, t, { x: t.parts[0].x, y: plank.parts[0].y + 0.05 });
          kit.advance(0.2);
          const h = kit.spawn('human', 0, 1.3) as Human;
          kit.advance(0.8);
          game.stepDt = dt;
          controls.selection = new Set([plank]);
          const p = plank.parts[0];
          let v = p.vy;
          let peak = 0;
          let fast = 0;
          kit.key('KeyW', true);
          game.advance(4, () => {
            peak = Math.max(peak, Math.abs(p.vy - v) / game.stepDt / 9.81);
            v = p.vy;
            fast = Math.max(fast, v);
          });
          kit.key('KeyW', false);
          controls.selection = new Set();
          const step = dt < 1 / 100 ? '1/120 s' : '1/60 s';
          if (fast < 25) return `at ${step}, the rocket only got to ${fast.toFixed(1)} m/s`;
          if (peak > 6) return `at ${step}, it was jolted at ${peak.toFixed(0)} g`;
          const feet = Math.min(...h.parts.map((q) => q.y)) - p.y;
          if (feet < 0) return `at ${step}, their feet went through the plank (${feet.toFixed(2)} m)`;
          if (!h.alive || h.consciousness < 0.9) return `at ${step}, they came out of it ${h.status()}`;
        }
        return true;
      } finally {
        game.stepDt = was;
      }
    }],
    ['extra: driving: the opposite key brakes a car before it reverses; Q tilts it back in the air', () => {
      kit.reset();
      const car = kit.spawn('car', -8, 0.8) as Car;
      kit.advance(0.5);
      controls.selection = new Set([car]);
      hold('KeyD', 2);
      const v0 = car.parts[0].vx;
      if (v0 < 3) return `D for 2 s: only ${v0.toFixed(1)} m/s`;
      kit.key('KeyA', true);
      kit.advance(0.25);
      const v1 = car.parts[0].vx;
      kit.advance(2.5);
      const v2 = car.parts[0].vx;
      kit.key('KeyA', false);
      if (v1 <= 0) return `A: it was going backwards ${v1.toFixed(1)} m/s within a quarter second (no braking)`;
      if (v1 >= v0) return `A: it didn’t slow (${v0.toFixed(1)} -> ${v1.toFixed(1)} m/s)`;
      if (v2 > -0.5) return `A held: it never went the other way (${v2.toFixed(1)} m/s)`;
      kit.reset();
      const air = kit.spawn('car', 0, 8) as Car;
      kit.advance(0.1);
      controls.selection = new Set([air]);
      kit.key('KeyQ', true);
      kit.advance(0.3);
      const av = air.parts[0].av;
      kit.key('KeyQ', false);
      if (av < 0.5) return `Q in the air: it turns at ${av.toFixed(2)} rad/s`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Thruster } from '../../entities/Machines';
import type { Firearm } from '../../entities/Firearm';
import type { Missile } from '../../entities/Missiles';
import type { AerialBomb, BombBay, FlareDispenser, HeatSeekerPod } from '../../entities/Combat';
import { Flare } from '../../entities/Combat';

/** Weapons for what's flown (0.4.0: entities/Combat, Firearm.pilotFire(), Missile.heatSeek) and armour plate. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  const hold = (code: string, s: number) => {
    kit.key(code, true);
    kit.advance(s);
    kit.key(code, false);
  };
  /** A cart to fly: a metal box with a thruster on it (so it's a craft), and `extra` welded to its top. */
  const craft = (extra: string, dy = 0.55) => {
    const box = kit.spawn('metal-box', 0, 0.4);
    const thr = kit.spawn('thruster', -0.7, 0.4, { angle: Math.PI });
    const w = kit.spawn(extra, 0, 0.4 + dy);
    kit.advance(0.3);
    weld(box, thr, { x: -0.5, y: 0.4 });
    weld(box, w, { x: 0, y: 0.4 + dy - 0.1 });
    kit.advance(0.2);
    controls.selection = new Set([box]);
    return { box, thr, w };
  };

  return [
    ['extra: combat: a gun welded into what’s flown fires on the pilot’s fire key: an automatic keeps firing while it’s held, a pistol once a press', () => {
      kit.reset();
      const { w } = craft('smg');
      const smg = w as Firearm;
      hold(controls.bindings.keys('pilotFire')[0], 0.6);
      if (!(smg.shots >= 3)) return `held 0.6 s, the SMG fired ${smg.shots}`;
      const n = smg.shots;
      kit.advance(0.4);
      if (smg.shots !== n) return 'let go of, the SMG went on firing';
      kit.reset();
      const r = craft('pistol').w as Firearm;
      hold(controls.bindings.keys('pilotFire')[0], 0.6);
      if (r.shots !== 1) return `a press held 0.6 s fired the pistol ${r.shots} times`;
      return true;
    }],
    ['extra: combat: a heat seeker goes for a lit engine ahead; flares thrown out in front of it pull it off', () => {
      kit.reset();
      // the target: a thruster burning on a fixed post, 55 m off
      const post = kit.spawn('metal-box', 55, 0.4);
      const hot = kit.spawn('thruster', 55, 1.2, { angle: Math.PI / 2 }) as Thruster;
      const cold = kit.spawn('metal-box', 30, 0.4);
      const pod = kit.spawn('heat-seeker-pod', 0, 1.5) as HeatSeekerPod;
      kit.advance(0.3);
      post.parts[0].setFrozen(true);
      weld(post, hot, { x: 55, y: 0.85 });
      pod.parts[0].setFrozen(true);
      hot.activate();
      kit.advance(0.3);
      if (!(hot.heatSignature() > 0)) return 'the lit thruster gives off no heat';
      const m = pod.fire() as Missile | null;
      if (!m) return 'the pod didn’t fire';
      if (!m.heatSeek) return 'its missile isn’t a heat seeker';
      kit.advance(0.25);
      const g = m.guide;
      if (g.kind !== 'target' || g.entity !== hot) return `0.25 s out it’s after ${g.kind === 'target' ? g.entity?.def.id : g.kind}`;
      if (cold.destroyed) return 'it hit the cold box';
      // flares in its eye, beside the thruster
      const disp = kit.spawn('flare-dispenser', 50, 6) as FlareDispenser;
      kit.advance(0.02);
      disp.parts[0].setFrozen(true);
      const fl = disp.dispense();
      if (fl.length !== 2) return `the dispenser threw ${fl.length} flares`;
      kit.advance(0.2);
      const g2 = m.guide;
      if (m.destroyed) return 'it hit before the flares could pull it off';
      if (g2.kind !== 'target' || !(g2.entity instanceof Flare)) return `with flares out in front it’s still after ${g2.kind === 'target' ? g2.entity?.def.id : g2.kind}`;
      return true;
    }],
    ['extra: combat: the bombs key drops a bomb out of the bay; it arms, falls nose down and goes off on the ground', () => {
      kit.reset();
      const g0 = game.gravity;
      const box = kit.spawn('metal-box', 0, 30);
      const bay = kit.spawn('bomb-bay', 0, 29.2) as BombBay;
      const thr = kit.spawn('thruster', -0.7, 30, { angle: Math.PI });
      kit.advance(0.05);
      weld(box, bay, { x: 0, y: 29.4 });
      weld(box, thr, { x: -0.5, y: 30 });
      box.parts[0].setFrozen(true);
      controls.selection = new Set([box]);
      kit.advance(0.1);
      const before = new Set(game.entities);
      hold(controls.bindings.keys('bombs')[0], 0.05);
      const b = game.entities.find((e) => !before.has(e) && e.def.id === 'aerial-bomb') as AerialBomb | undefined;
      if (!b) return 'the bombs key dropped no bomb';
      if (bay.bombs !== 3) return `${bay.bombs} bombs left in the bay`;
      if (!b.live) return 'the dropped bomb isn’t live';
      let nose = 0;
      let boom = false;
      game.advance(4, () => {
        if (!b.destroyed && b.main.vy < -15) nose = Math.max(nose, -Math.sin(b.main.bodyAngle));
        if (b.destroyed) boom = true;
      });
      void g0;
      if (!boom) return `4 s on the bomb is still there (at ${b.main.y.toFixed(1)} m)`;
      if (!(nose > 0.8)) return `falling fast, its nose was at most ${nose.toFixed(2)} down`;
      if (bay.destroyed || box.destroyed) return 'the bomb blew up its own plane';
      return true;
    }],
    ['extra: combat: (0.5.1) a bomb welded on a car doesn’t arm as the car speeds up; cut free and falling fast, it does', () => {
      kit.reset();
      const car = kit.spawn('car', -25, 0.8) as Entity & { gear: string; on: boolean; body: { vx: number } };
      const b = kit.spawn('aerial-bomb', -25, 2) as AerialBomb;
      kit.advance(0.5);
      const at = { x: b.main.x, y: b.main.y - 0.1 };
      const w = C.create('weld', car.parts[0], at, b.parts[0], at);
      car.gear = 'turbo';
      car.on = true;
      let top = 0;
      game.advance(3, () => {
        top = Math.max(top, car.body.vx);
      });
      if (top < 14) return `the car got up to only ${top.toFixed(1)} m/s`;
      if (b.live) return `welded on a car going ${top.toFixed(1)} m/s, the bomb armed itself`;
      // cut free high up, it falls fast and arms
      if (w) C.remove(w);
      car.on = false;
      b.main.teleport(-45, 30, 0);
      kit.advance(2);
      if (!b.live) return 'cut free and falling, it never armed';
      return true;
    }],
    ['extra: combat: an armour plate stops a sniper round that would have hit what’s behind it', () => {
      kit.reset();
      const plate = kit.spawn('armour-plate', 2, 1, { angle: Math.PI / 2 });
      const back = kit.spawn('crate', 5, 1);
      const sniper = kit.spawn('sniper', -2, 1) as Firearm;
      // (and the same without the plate)
      const back2 = kit.spawn('crate', 5, 4);
      const sniper2 = kit.spawn('sniper', -2, 4) as Firearm;
      kit.advance(0.05);
      for (const e of [plate, back, sniper, back2, sniper2]) e.parts[0].setFrozen(true);
      const hp0 = back.parts[0].hp;
      const hp2 = back2.parts[0].hp;
      sniper.fire();
      sniper2.fire();
      kit.advance(0.3);
      if (!(back2.destroyed || back2.parts[0].hp < hp2)) return 'with nothing in the way the round missed the crate (the test aims wrong)';
      if (plate.destroyed) return 'the sniper round broke the armour plate';
      if (back.destroyed || back.parts[0].hp < hp0) return 'the round went through the armour plate';
      return true;
    }],
  ];
}

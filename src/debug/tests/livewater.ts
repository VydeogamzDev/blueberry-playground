import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Entity } from '../../world/Entity';
import { builtinMap } from '../../world/Maps';

/** A current through water (see systems/LiveWater): batteries and tesla coils in it shock whoever's in it. */
export default function tests({ game, kit }: TestCtx): Test[] {
  const f = game.fluid;
  /** A 3 m by 1.5 m glass tank on the floor at x 0, two thirds full and settled. */
  const fullTank = () => {
    kit.reset();
    kit.spawn('glass-tank', 0, 0.75, { config: { w: 96, h: 48 } });
    kit.advance(0.3);
    kit.spawn('water', 0, 0.75, { config: { w: 90, h: 34 } });
    kit.advance(3);
  };
  const live = () => {
    let n = 0;
    for (let i = 0; i < f.n; i++) n += f.live[i];
    return n;
  };
  const wire = (a: Entity, b: Entity) => game.connections.create('wire', a.parts[0], a.parts[0].localToWorld(0, 0), b.parts[0], b.parts[0].localToWorld(0, 0))!;

  return [
    ['extra: live water: a battery dropped in a tank of water puts a current through all of it and knocks out whoever’s in it; beside the tank, or switched off, it doesn’t', () => {
      fullTank();
      const h = kit.spawn('human', 0.5, 2.2) as Human;
      kit.spawn('battery', 1.75, 0.3);
      kit.advance(2);
      if (live() || game.liveWater.shocks) return `with a battery beside the tank, ${live()} particles are live and ${game.liveWater.shocks} shocks given`;
      // (into the water clear of them: dropped onto them, it may come to rest on top, out of it)
      const bat = kit.spawn('battery', -1.0, 1.0);
      kit.advance(1.5);
      if (live() < f.n * 0.8) return `with a battery in it, only ${live()} of ${f.n} particles are live`;
      if (!game.liveWater.shocks) return 'nobody in the live water was shocked';
      if (h.consciousness > 0.3) return `shocked in the water, they're still awake (${h.consciousness.toFixed(2)})`;
      bat.activate();
      kit.advance(0.3);
      if (live()) return `switched off, ${live()} particles are still live`;
      const n = game.liveWater.shocks;
      kit.advance(1);
      if (game.liveWater.shocks !== n) return 'switched off, it still shocks';
      return true;
    }],
    ['extra: live water: a tesla coil running in a tank (wired to a battery out of it) puts a current through the water', () => {
      fullTank();
      const coil = kit.spawn('tesla-coil', -0.8, 0.9);
      const bat = kit.spawn('battery', -3, 0.4);
      const h = kit.spawn('human', 0.6, 2.2) as Human;
      kit.advance(1);
      if (live()) return 'switched off at the battery, the coil made the water live';
      wire(bat, coil);
      kit.advance(1.5);
      if (live() < f.n * 0.8) return `with the coil running in it, only ${live()} of ${f.n} particles are live`;
      if (h.consciousness > 0.3) return `in the live water, they're still awake (${h.consciousness.toFixed(2)})`;
      return true;
    }],
    ['extra: live water: a battery in the sea shocks people a few metres off, not those far away', () => {
      kit.reset();
      game.setMap(builtinMap('sea')!);
      const near = kit.spawn('human', -48, 10.5) as Human;
      const far = kit.spawn('human', -75, 10.5) as Human;
      kit.advance(3);
      kit.spawn('battery', -51, 9.6);
      kit.advance(2);
      if (!game.liveWater.sea) return 'the sea round the battery isn’t live';
      if (near.consciousness > 0.3) return `3 m from the battery in the sea, they're still awake (${near.consciousness.toFixed(2)})`;
      if (far.consciousness < 0.9) return `24 m from it, they were shocked too (${far.consciousness.toFixed(2)})`;
      return true;
    }],
  ];
}

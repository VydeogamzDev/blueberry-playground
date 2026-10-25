import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import { builtinMap } from '../../world/Maps';
import { readVitals } from '../../ui/VitalsPanel';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Breath under water (see systems/Breath): people and animals drown, tread water, and swim for the shore. */
export default function tests({ game, kit }: TestCtx): Test[] {
  /** The sea map (9 m deep left of x -2.5, its beach rising to the right), emptied. */
  const sea = () => {
    kit.reset();
    game.setMap(builtinMap('sea')!);
  };
  const knockedOut = (id: string, x: number) => {
    const e = kit.spawn(id, x, 10.5) as Human | Creature;
    e.inject('knockout', 1);
    return e;
  };
  const headOf = (e: Human | Creature) => e.limbs.get('head')!.part;

  return [
    ['extra: drowning: knocked out in the sea, someone and a dog go under and drown within half a minute; pulled out in time, they come round', () => {
      sea();
      const a = knockedOut('human', -50);
      const dog = knockedOut('dog', -40);
      const b = knockedOut('human', -60);
      kit.advance(6);
      if (!a.breath.under) return `out cold in the sea, their mouth isn't under water (head ${(headOf(a).y - 9).toFixed(2)} m from the surface)`;
      if (!dog.breath.under) return `out cold in the sea, the dog's nose isn't under water (head ${(headOf(dog).y - 9).toFixed(2)} m from the surface)`;
      if (a.breath.air > 0.6) return `6 s under, they've still ${a.breath.air.toFixed(2)} of their breath`;
      const v = readVitals(a, game);
      if (v.breaths !== 0 || !/water|drowning/.test(v.breathing)) return `under water, the vitals read ${v.breaths} breaths a minute, "${v.breathing}"`;
      // (one hauled out onto the beach)
      const c = b.limbs.get('upperTorso')!.part;
      b.translate(6 - c.x, 12.5 - c.y);
      kit.advance(20);
      if (a.alive) return `26 s out cold in the sea, they're still alive (air ${a.breath.air.toFixed(2)})`;
      if (dog.alive) return `26 s out cold in the sea, the dog's still alive (air ${dog.breath.air.toFixed(2)})`;
      if (!b.alive) return 'pulled out of the water after 6 s, they drowned all the same';
      if (b.breath.air < 0.99) return `20 s out of the water, they've only ${b.breath.air.toFixed(2)} of their breath back`;
      return true;
    }],
    ['extra: drowning: awake in the sea, someone treads water with their head up and swims for the shore, a dog paddles; far out, they tire, go under and drown', () => {
      sea();
      const near = kit.spawn('human', -12, 9.8) as Human;
      const far = kit.spawn('human', -100, 10.5) as Human;
      const dog = kit.spawn('dog', -60, 10.5) as Creature;
      const x0 = near.limbs.get('upperTorso')!.part.x;
      const dx0 = dog.limbs.get('chest')!.part.x;
      kit.advance(8);
      if (!far.treading) return `awake in deep water, they aren't treading it (state ${far.state})`;
      if (far.breath.under) return `treading water, their head is under (${(headOf(far).y - 9).toFixed(2)} m from the surface)`;
      if (dog.breath.under) return `paddling, the dog's nose is under (${(headOf(dog).y - 9).toFixed(2)} m from the surface)`;
      kit.advance(17);
      const x1 = near.limbs.get('upperTorso')!.part.x;
      if (!near.alive || near.breath.air < 0.5) return `near the shore, they ${near.alive ? `are short of breath (${near.breath.air.toFixed(2)})` : 'drowned'}`;
      if (x1 < x0 + 5) return `in 25 s they only swam ${(x1 - x0).toFixed(1)} m for the shore`;
      if (dog.limbs.get('chest')!.part.x < dx0 + 4) return `in 25 s the dog only paddled ${(dog.limbs.get('chest')!.part.x - dx0).toFixed(1)} m for the shore`;
      if (!dog.alive || dog.breath.air < 0.5) return 'the dog drowned paddling';
      kit.advance(45);
      if (far.alive) return `70 s out at sea, they're still afloat (spent ${far.breath.spent.toFixed(2)}, air ${far.breath.air.toFixed(2)})`;
      return true;
    }],
    ['extra: drowning: an android, with no lungs, sinks and doesn’t drown; saved under water, someone’s breath is as it was, and healing gives it all back', () => {
      sea();
      kit.spawn('android', -40, 10.5);
      const a = knockedOut('human', -50) as Human;
      kit.advance(5);
      const air = a.breath.air;
      if (air > 0.8 || air <= 0) return `5 s under, they've ${air.toFixed(2)} of their breath`;
      loadFromString(game, saveToString(game));
      const a2 = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      if (!a2) return 'loaded, they were gone';
      if (Math.abs(a2.breath.air - air) > 0.02) return `loaded, they had ${a2.breath.air.toFixed(2)} of their breath, not ${air.toFixed(2)}`;
      a2.heal();
      if (a2.breath.air !== 1) return `healed, they've only ${a2.breath.air.toFixed(2)} of their breath`;
      const bot2 = game.entities.find((e) => e.def.id === 'android') as Human | undefined;
      kit.advance(30);
      if (!bot2?.alive) return 'the android drowned';
      return true;
    }],
  ];
}

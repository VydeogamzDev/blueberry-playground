import { register, registerProps } from './items';
import { registerWeapons, registerMelee, registerExplosives, registerMedical, registerLiquids, registerMachinery, registerDevices, registerVehicles, registerTools } from './weapons';
import { Human, VARIANTS, HUMAN_HALF_HEIGHT } from '../entities/Human';
import { figurePreview } from '../art/human';
import { Creature, SPECIES, creaturePreview, creatureHalfHeight } from '../entities/Creature';
import type { ItemDef } from '../world/types';

let done = false;

function registerCharacters(): void {
  const human: ItemDef = register({
    id: 'human', name: 'Human', category: 'Characters', tags: ['person', 'ragdoll', 'man'],
    description: 'A living, breathing person. Bleeds, breaks and feels pain.',
    preview: (() => {
      let c: HTMLCanvasElement | null = null;
      return () => (c ??= figurePreview('human'));
    })(),
    halfHeight: HUMAN_HALF_HEIGHT,
    create: (game, x, y, opts) => new Human(game, human, VARIANTS.human, x, y, opts),
  });
  const android: ItemDef = register({
    id: 'android', name: 'Android', category: 'Characters', tags: ['robot', 'ragdoll', 'synthetic'],
    description: 'A synthetic humanoid. Much tougher than a human and does not bleed.',
    preview: (() => {
      let c: HTMLCanvasElement | null = null;
      return () => (c ??= figurePreview('android'));
    })(),
    halfHeight: HUMAN_HALF_HEIGHT,
    create: (game, x, y, opts) => new Human(game, android, VARIANTS.android, x, y, opts),
  });
  const animals = [
    { id: 'dog', name: 'Dog', tags: ['animal', 'pet', 'ragdoll', 'creature'] as string[], description: 'A big, friendly dog. Stands on four legs, gets back up, bleeds and yelps.' },
    { id: 'cat', name: 'Cat', tags: ['animal', 'pet', 'ragdoll', 'creature'] as string[], description: 'A small, light cat. Twists round in the air and lands on its feet.' },
  ] as const;
  for (const a of animals) {
    const def: ItemDef = register({
      id: a.id, name: a.name, category: 'Characters', tags: [...a.tags], description: a.description,
      preview: (() => {
        let c: HTMLCanvasElement | null = null;
        return () => (c ??= creaturePreview(a.id));
      })(),
      halfHeight: creatureHalfHeight(a.id),
      create: (game, x, y, opts) => new Creature(game, def, SPECIES[a.id], x, y, opts),
    });
  }
}

/** Registers every spawnable item, in catalog order. */
export function registerAll(): void {
  if (done) return;
  done = true;
  registerCharacters();
  registerProps();
  registerWeapons();
  registerMelee();
  registerExplosives();
  registerMedical();
  registerLiquids();
  registerMachinery();
  registerDevices();
  registerVehicles();
  registerTools();
}

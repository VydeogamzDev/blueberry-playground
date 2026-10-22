import { register, registerProps } from './items';
import { registerWeapons, registerMelee, registerExplosives, registerMedical, registerLiquids, registerMachinery, registerDevices, registerVehicles, registerTools } from './weapons';
import { Human, VARIANTS, HUMAN_HALF_HEIGHT } from '../entities/Human';
import { figurePreview } from '../art/human';
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

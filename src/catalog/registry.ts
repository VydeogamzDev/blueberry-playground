import { register, registerProps } from './items';
import { registerWeapons, registerMelee, registerExplosives, registerMedical, registerLiquids, registerMachinery, registerDevices, registerTools } from './weapons';
import { registerVehicles } from './vehicles';
import { registerArsenal } from './arsenal';
import { registerMissiles } from './missiles';
import { registerMachines2 } from './machines2';
import { registerFlight } from './flight';
import { registerRocketry } from './rocketry';
import { registerVehicles2, registerBoats, registerCombat, registerRails, registerPlaces } from './vehicles2';
import { registerFloats } from './floats';
import { registerPotions } from './potions';
import { Human, VARIANTS, HUMAN_HALF_HEIGHT, GRANT_HALF_HEIGHT } from '../entities/Human';
import { figurePreview, GRANT_SKIN, DUMMY_SKIN } from '../art/human';
import { grantMode } from '../world/GrantMode';
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
  const dummy: ItemDef = register({
    id: 'crash-dummy', name: 'Crash Dummy', category: 'Characters', tags: ['dummy', 'crash', 'test', 'ragdoll', 'car', 'safety'],
    description: 'A crash test dummy: never wakes, never bleeds, but is hurt just as a person would be. Sit it in what you build and crash it; its menu says whether a person would have lived. Build a g-meter in to see what the crash put it through.',
    preview: (() => {
      let c: HTMLCanvasElement | null = null;
      return () => (c ??= figurePreview('human', DUMMY_SKIN, 'dummy'));
    })(),
    halfHeight: HUMAN_HALF_HEIGHT,
    create: (game, x, y, opts) => new Human(game, dummy, VARIANTS.dummy, x, y, opts),
  });
  // (in the toybox only in Grant mode: see world/GrantMode)
  const grant: ItemDef = register({
    id: 'grant', name: 'Grant', category: 'Characters', tags: ['person', 'ragdoll', 'man', 'short', 'tough'],
    description: 'Grant. Short, broad and built different: near enough indestructible, he hits like a truck and heals by himself.',
    preview: (() => {
      let c: HTMLCanvasElement | null = null;
      return () => (c ??= figurePreview('human', GRANT_SKIN, 'grant', 'grant'));
    })(),
    halfHeight: GRANT_HALF_HEIGHT,
    create: (game, x, y, opts) => new Human(game, grant, VARIANTS.grant, x, y, opts),
  });
  Object.defineProperty(grant, 'hidden', { get: () => !grantMode.on, enumerable: true });
  const animals = [
    { id: 'dog', name: 'Dog', tags: ['animal', 'pet', 'ragdoll', 'creature'] as string[], description: 'A big, friendly dog. Stands on four legs, gets back up, bleeds and yelps.' },
    { id: 'cat', name: 'Cat', tags: ['animal', 'pet', 'ragdoll', 'creature'] as string[], description: 'A small, light cat. Twists round in the air and lands on its feet.' },
    { id: 'pig', name: 'Pig', tags: ['animal', 'farm', 'ragdoll', 'creature', 'hog'] as string[], description: 'A heavy, sturdy pig. Ambles about, oinking, and squeals when hurt.' },
    { id: 'fox', name: 'Fox', tags: ['animal', 'wild', 'ragdoll', 'creature'] as string[], description: 'A quick, wary fox. Runs from anyone who comes close.' },
    { id: 'cow', name: 'Cow', tags: ['animal', 'farm', 'ragdoll', 'creature', 'cattle', 'moo'] as string[], description: 'A big, heavy cow. Ambles about grazing and mooing, and kicks out at anything that startles it from behind.' },
    { id: 'gorse', name: 'Gorse', tags: ['animal', 'monster', 'hostile', 'ragdoll', 'creature', 'spider', 'bug'] as string[], description: 'A hostile four-legged thing of chitin. Goes for people and androids on sight, spitting its blood, which eats through flesh. Break its head and it can no longer spit. Acid does nothing to it; fire does a lot.' },
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
  registerPotions();
  registerLiquids();
  registerMachinery();
  registerDevices();
  registerVehicles();
  registerTools();
  registerArsenal();
  registerMissiles();
  registerMachines2();
  registerFlight();
  registerRocketry();
  registerVehicles2();
  registerBoats();
  registerCombat();
  registerRails();
  registerPlaces();
  registerFloats();
}

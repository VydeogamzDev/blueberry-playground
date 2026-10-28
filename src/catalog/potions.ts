import { register, lazyArt, previewOf, GLASS } from './items';
import { PX } from '../engine/constants';
import { DRUG_RAMPS } from '../art/items';
import { potionArt, POTION_GRIP, POTION_H, POTION_W } from '../art/potions';
import { artRect, densityFor } from '../entities/Item';
import { SplashPotion } from '../entities/SplashPotion';
import type { Drug } from '../entities/Syringe';
import type { ShapeSpec } from '../world/Part';
import type { ItemDef } from '../world/types';

// Splash potions: one for each syringe's drug, with the medical things
// (registered after them, in catalog order: see registry.ts).

/** How every one of them is used, after what its own drug does. */
const USE = 'Throw it (or Use it in someone’s hand): it smashes and splashes everyone within about 2 m, most near the middle.';

const POTIONS: { drug: Drug; name: string; desc: string; tags: string[] }[] = [
  { drug: 'healing', name: 'Splash Potion of Healing', desc: 'Heals whoever it splashes: wounds, bones, burns and blood.', tags: ['heal', 'health'] },
  { drug: 'adrenaline', name: 'Splash Potion of Adrenaline', desc: 'Wakes them up and has them on their feet and running fast.', tags: ['stim', 'speed', 'wake'] },
  { drug: 'knockout', name: 'Splash Potion of Knockout', desc: 'Puts people and animals to sleep.', tags: ['sleep', 'sedative', 'tranquilizer'] },
  { drug: 'life', name: 'Splash Potion of Life', desc: 'Brings the dead back to life, if they still have a head.', tags: ['revive', 'resurrect'] },
  { drug: 'poison', name: 'Splash Potion of Poison', desc: 'Slowly drains the life out of them.', tags: ['toxin', 'venom'] },
  { drug: 'death', name: 'Splash Potion of Death', desc: 'Stops the heart of anyone it splashes.', tags: ['kill', 'lethal'] },
  { drug: 'coagulation', name: 'Splash Potion of Coagulation', desc: 'Stops their bleeding.', tags: ['clot', 'bleeding'] },
  { drug: 'painkiller', name: 'Splash Potion of Painkiller', desc: 'Takes their pain away for a while.', tags: ['morphine', 'pain'] },
  { drug: 'strength', name: 'Splash Potion of Ultra Strength', desc: 'Makes their muscles far stronger for a while.', tags: ['strong', 'power'] },
  { drug: 'freeze', name: 'Splash Potion of Freezing', desc: 'Freezes them stiff where they stand.', tags: ['ice', 'cold', 'frozen'] },
  { drug: 'bone', name: 'Splash Potion of Bone Eating', desc: 'Their bones break one after another.', tags: ['break', 'fracture'] },
  { drug: 'acid', name: 'Splash Potion of Acid', desc: 'Melts them from the inside, limb by limb.', tags: ['melt', 'corrosive'] },
  { drug: 'pink', name: 'Splash Potion of Mystery', desc: 'Pink: it does what one of the others does, a different one each time.', tags: ['pink', 'random', 'surprise'] },
  { drug: 'zombie', name: 'Splash Potion of Zombification', desc: 'Infects them: they turn into zombies.', tags: ['zombie', 'undead', 'virus', 'infect'] },
  { drug: 'cure', name: 'Splash Potion of Zombie Cure', desc: 'Cures zombies and the infected.', tags: ['cure', 'antidote', 'undead'] },
  { drug: 'regen', name: 'Splash Potion of Regeneration', desc: 'Over half a minute their lost limbs grow back and their hurts mend.', tags: ['regenerate', 'regrow', 'limbs'] },
];

/** The splash potions, in the Medical category. */
export function registerPotions(): void {
  // a ball for the bulb, a box for the neck and cork
  const shapes: ShapeSpec[] = [{ kind: 'ball', r: 3.3, y: -2.3 }, artRect(POTION_W, POTION_H, 2, 0, 3, 5, 0.5)];
  const density = densityFor(0.35, shapes);
  for (const p of POTIONS) {
    const art = lazyArt(() => potionArt(DRUG_RAMPS[p.drug]));
    const def: ItemDef = {
      id: `potion-${p.drug}`, name: p.name, category: 'Medical', description: `${p.desc} ${USE}`,
      tags: ['potion', 'splash', 'throw', 'bottle', 'drug', ...p.tags],
      preview: previewOf(art),
      create: (game, x, y, opts) =>
        new SplashPotion(game, def, { art, material: GLASS, shapes, density, angularDamping: 0.25, ccd: true, hp: 5 }, { grip: POTION_GRIP }, p.drug, x, y, opts),
    };
    Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
    register(def);
  }
}

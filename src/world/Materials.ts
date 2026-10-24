export type ImpactSound = 'flesh' | 'wood' | 'metal' | 'stone' | 'plastic' | 'glass' | 'rubber' | 'none';

/** Physical + damage properties of a surface. Density is 2D (kg per m^2). */
export interface PhysMaterial {
  name: string;
  density: number;
  friction: number;
  restitution: number;
  sound: ImpactSound;
  /** Bullet "energy" lost per meter travelled through the material. */
  bulletResistance: number;
  /** 0 = fireproof, 1 = very flammable. */
  flammability: number;
  /** Does this material bleed when wounded? */
  bleeds: boolean;
  /** Sparks on bullet/metal impacts. */
  sparks: boolean;
  /** Color of debris/chips spawned from impacts. */
  debrisColor: number;
}

export const MAT = {
  flesh: {
    name: 'Flesh', density: 95, friction: 0.75, restitution: 0.02, sound: 'flesh',
    bulletResistance: 900, flammability: 0.25, bleeds: true, sparks: false, debrisColor: 0x7a1414,
  },
  bone: {
    name: 'Bone', density: 120, friction: 0.7, restitution: 0.05, sound: 'flesh',
    bulletResistance: 1400, flammability: 0.1, bleeds: true, sparks: false, debrisColor: 0xd8d0c0,
  },
  robot: {
    name: 'Synthetic', density: 125, friction: 0.6, restitution: 0.04, sound: 'metal',
    bulletResistance: 2600, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x5d6670,
  },
  wood: {
    name: 'Wood', density: 55, friction: 0.65, restitution: 0.12, sound: 'wood',
    bulletResistance: 700, flammability: 0.8, bleeds: false, sparks: false, debrisColor: 0x8a6239,
  },
  metal: {
    name: 'Metal', density: 280, friction: 0.45, restitution: 0.08, sound: 'metal',
    bulletResistance: 9000, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8c939b,
  },
  sheetMetal: {
    name: 'Sheet metal', density: 140, friction: 0.45, restitution: 0.1, sound: 'metal',
    bulletResistance: 2500, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8c939b,
  },
  stone: {
    name: 'Stone', density: 190, friction: 0.8, restitution: 0.04, sound: 'stone',
    bulletResistance: 6000, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8f6b5a,
  },
  plastic: {
    name: 'Plastic', density: 60, friction: 0.5, restitution: 0.25, sound: 'plastic',
    bulletResistance: 500, flammability: 0.5, bleeds: false, sparks: false, debrisColor: 0x55585c,
  },
  rubber: {
    name: 'Rubber', density: 70, friction: 1.2, restitution: 0.65, sound: 'rubber',
    bulletResistance: 600, flammability: 0.4, bleeds: false, sparks: false, debrisColor: 0x2a2a2a,
  },
  concrete: {
    name: 'Concrete', density: 220, friction: 0.85, restitution: 0.03, sound: 'stone',
    bulletResistance: 1e9, flammability: 0, bleeds: false, sparks: true, debrisColor: 0x6b6d70,
  },
} satisfies Record<string, PhysMaterial>;

export const GLASS: PhysMaterial = {
  ...MAT.plastic, name: 'Glass', density: 160, sound: 'glass', restitution: 0.1, bulletResistance: 300, flammability: 0, debrisColor: 0xa9d0dc,
};

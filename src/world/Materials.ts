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
  /**
   * How much it takes to break, as a yield strength (MPa, roughly the real
   * one's): steel's 250, wood's 40, glass's 50 (though it gives way at once).
   */
  strength: number;
  /** 0..1: how readily it shatters rather than bending and tearing (glass 1, steel near 0). */
  brittle: number;
  /**
   * How hard a knock it takes (m/s) to break it outright; half of it and less does
   * nothing (see Prop.onImpact()): a steel box shrugs off a fall a brick wouldn't.
   */
  toughness: number;
  /** Heat (J) a kilogram of it takes to warm a degree (see systems/Heat). */
  heatCap: number;
  /** Where it melts (°C): Infinity for what chars or burns away first. */
  melt: number;
  /** Does electricity run through it (a short across a battery, a shock)? */
  conducts: boolean;
}

export const MAT = {
  flesh: {
    name: 'Flesh', density: 95, friction: 0.75, restitution: 0.02, sound: 'flesh',
    bulletResistance: 900, flammability: 0.25, bleeds: true, sparks: false, debrisColor: 0x7a1414,
    strength: 1, brittle: 0, toughness: 20, heatCap: 3500, melt: Infinity, conducts: false,
  },
  bone: {
    name: 'Bone', density: 120, friction: 0.7, restitution: 0.05, sound: 'flesh',
    bulletResistance: 1400, flammability: 0.1, bleeds: true, sparks: false, debrisColor: 0xd8d0c0,
    strength: 130, brittle: 0.6, toughness: 25, heatCap: 1300, melt: Infinity, conducts: false,
  },
  robot: {
    name: 'Synthetic', density: 125, friction: 0.6, restitution: 0.04, sound: 'metal',
    bulletResistance: 2600, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x5d6670,
    strength: 300, brittle: 0.15, toughness: 60, heatCap: 900, melt: 1100, conducts: true,
  },
  wood: {
    name: 'Wood', density: 55, friction: 0.65, restitution: 0.12, sound: 'wood',
    bulletResistance: 700, flammability: 0.8, bleeds: false, sparks: false, debrisColor: 0x8a6239,
    strength: 40, brittle: 0.35, toughness: 30, heatCap: 1700, melt: Infinity, conducts: false,
  },
  metal: {
    name: 'Metal', density: 280, friction: 0.45, restitution: 0.08, sound: 'metal',
    bulletResistance: 9000, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8c939b,
    strength: 250, brittle: 0.05, toughness: 75, heatCap: 490, melt: 1450, conducts: true,
  },
  sheetMetal: {
    name: 'Sheet metal', density: 140, friction: 0.45, restitution: 0.1, sound: 'metal',
    bulletResistance: 2500, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8c939b,
    strength: 200, brittle: 0.05, toughness: 50, heatCap: 490, melt: 1450, conducts: true,
  },
  stone: {
    name: 'Stone', density: 190, friction: 0.8, restitution: 0.04, sound: 'stone',
    bulletResistance: 6000, flammability: 0.0, bleeds: false, sparks: true, debrisColor: 0x8f6b5a,
    strength: 60, brittle: 0.85, toughness: 30, heatCap: 840, melt: 1200, conducts: false,
  },
  plastic: {
    name: 'Plastic', density: 60, friction: 0.5, restitution: 0.25, sound: 'plastic',
    bulletResistance: 500, flammability: 0.5, bleeds: false, sparks: false, debrisColor: 0x55585c,
    strength: 40, brittle: 0.4, toughness: 35, heatCap: 1600, melt: 200, conducts: false,
  },
  rubber: {
    name: 'Rubber', density: 70, friction: 1.2, restitution: 0.65, sound: 'rubber',
    bulletResistance: 600, flammability: 0.4, bleeds: false, sparks: false, debrisColor: 0x2a2a2a,
    strength: 15, brittle: 0, toughness: 90, heatCap: 2000, melt: 260, conducts: false,
  },
  concrete: {
    name: 'Concrete', density: 220, friction: 0.85, restitution: 0.03, sound: 'stone',
    bulletResistance: 1e9, flammability: 0, bleeds: false, sparks: true, debrisColor: 0x6b6d70,
    strength: 40, brittle: 0.9, toughness: 28, heatCap: 880, melt: 1500, conducts: false,
  },
} satisfies Record<string, PhysMaterial>;

/**
 * How hard it is to knock into (0..1): what a knock against it does to the other
 * thing, for what steel or stone would (see Prop.onImpact()). Flesh gives (a bat
 * swung into someone is none the worse for it), rubber more, wood and plastic some.
 */
export function hardness(m: PhysMaterial): number {
  if (m.bleeds) return 0.03;
  switch (m.sound) {
    case 'rubber':
      return 0.12;
    case 'plastic':
      return 0.35;
    case 'wood':
      return 0.4;
    default:
      return 1;
  }
}

/**
 * How much more a blow does to something this hot (1 cold): past two fifths of
 * its melting point it loses its strength (steel at 1000 °C keeps a tenth of
 * it), by up to 5 times at the melting point.
 */
export function softness(m: PhysMaterial, temp: number): number {
  if (!(temp > m.melt * 0.4)) return 1;
  const k = Math.min(1, (temp - m.melt * 0.4) / (m.melt * 0.6));
  return 1 + 4 * k * k;
}

/** Glass: hard but brittle, it shatters rather than bending; it softens long before it melts. */
export const GLASS: PhysMaterial = {
  ...MAT.plastic, name: 'Glass', density: 160, sound: 'glass', restitution: 0.1, bulletResistance: 300, flammability: 0, debrisColor: 0xa9d0dc,
  strength: 50, brittle: 1, toughness: 12, heatCap: 840, melt: 1400, conducts: false,
};

/** What machines' insides are made of (circuit boards, wiring, cells): they give up long before their casings. */
export const ELECTRONICS: PhysMaterial = {
  ...MAT.plastic, name: 'Electronics', density: 90, sound: 'plastic', bulletResistance: 600, flammability: 0.3, debrisColor: 0x2f6b3a,
  strength: 30, brittle: 0.6, toughness: 20, heatCap: 1100, melt: 250, conducts: true,
};

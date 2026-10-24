import type { V2 } from '../engine/math';
import type { Game } from './Game';
import type { Entity } from './Entity';
import type { Part } from './Part';
import type { Snapshot } from './Snapshot';

export type Category = 'Characters' | 'Objects' | 'Weapons' | 'Melee' | 'Explosives' | 'Medical' | 'Machinery' | 'Vehicles' | 'Contraptions' | 'Tools';

export const CATEGORIES: { id: Category; icon: string; label: string }[] = [
  { id: 'Characters', icon: 'human', label: 'Characters' },
  { id: 'Objects', icon: 'crate', label: 'Objects' },
  { id: 'Weapons', icon: 'gun', label: 'Firearms' },
  { id: 'Melee', icon: 'sword', label: 'Melee' },
  { id: 'Explosives', icon: 'bomb', label: 'Explosives' },
  { id: 'Medical', icon: 'syringe', label: 'Medical' },
  { id: 'Machinery', icon: 'gear', label: 'Machinery' },
  { id: 'Vehicles', icon: 'car', label: 'Vehicles' },
  { id: 'Contraptions', icon: 'blueprint', label: 'Contraptions' },
  { id: 'Tools', icon: 'wrench', label: 'Tools' },
];

/** What an object was made with beyond its kind: a size, a drawn outline (see ItemDef.resizable). */
export type EntityConfig = Record<string, unknown>;

/** How small and large (sprite pixels) a resized or drawn object may be. */
export const SIZE_LIMITS = { min: 2, max: 512 };

export interface SpawnOptions {
  flip?: boolean;
  angle?: number;
  /** Its size or shape, when not the default (see Entity.config). */
  config?: EntityConfig;
}

export interface ItemDef {
  id: string;
  name: string;
  category: Category;
  description: string;
  preview: () => HTMLCanvasElement;
  /** Create the entity centered at (x, y). */
  create?: (game: Game, x: number, y: number, opts: SpawnOptions) => Entity;
  /** Tool items arm an interaction tool instead of spawning. */
  tool?: string;
  /** Approximate half-height in meters, used to keep spawns above the floor. */
  halfHeight?: number;
  /** Search keywords. */
  tags?: string[];
  /** Can be made any size: its config's w and h (sprite pixels) are its size. */
  resizable?: boolean;
  /** Not listed in the toybox (drawn shapes: made with the Shape tool). */
  hidden?: boolean;
  /** A saved contraption: spawns this group of things (see world/Contraptions). */
  snapshot?: Snapshot;
  /** A picture of it (a data URL), for contraptions. */
  thumb?: string;
}

export interface ContextAction {
  label: string;
  hint?: string;
  action: () => void;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export interface ImpactInfo {
  part: Part;
  other: Part | null;
  /** Approach speed along the contact normal before the step (m/s). */
  speed: number;
  /** Contact force magnitude reported by the solver (N). */
  force: number;
  point: V2;
  /** Normal pointing from `other` into `part`. */
  normal: V2;
  /** Mass of the other body (Infinity for static/frozen). */
  otherMass: number;
  /** Tangential (sliding) speed at contact. */
  slide: number;
  /** This part's own speed into the contact (m/s, >= 0). */
  selfSpeed: number;
  /** The other body's speed into this part (m/s, >= 0). */
  otherSpeed: number;
}

export type DamageKind = 'blunt' | 'bullet' | 'cut' | 'stab' | 'explosion' | 'fire' | 'crush' | 'shock' | 'laser' | 'acid';

export interface BulletHit {
  part: Part;
  point: V2;
  normal: V2;
  dir: V2;
  /** Remaining bullet energy factor (J). */
  energy: number;
  damage: number;
  exit: V2 | null;
  /** The round itself: the same for each hit it makes (one round through two limbs is one round). */
  round?: object;
}

export interface PartState {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  av: number;
  frozen: boolean;
  hp: number;
  /** Fire, char and soaked-in oil (0..1), when any. */
  burn?: number;
  char?: number;
  oil?: number;
  /** What wounds and scorching painted on the sprite, when anything (see Part.paintData()). */
  paint?: string;
  /** Ignores gravity (see Part.setWeightless()). */
  weightless?: boolean;
}

export interface EntityState {
  def: string;
  flip: boolean;
  parts: PartState[];
  /** Its size or shape, for resized and drawn objects (see Entity.config). */
  config?: EntityConfig;
  extra?: Record<string, unknown>;
  /** References to other entities in the same snapshot (held items, lodged blades). */
  links?: Record<string, unknown>;
  /** Its drawing depth, once put in front of or behind things by hand (see Entity.setDepth()). */
  z?: number;
  /** Which entity it was (undo's own captures only, never saved: see History). */
  uid?: number;
}

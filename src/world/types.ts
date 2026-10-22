import type { V2 } from '../engine/math';
import type { Game } from './Game';
import type { Entity } from './Entity';
import type { Part } from './Part';

export type Category = 'Characters' | 'Objects' | 'Weapons' | 'Melee' | 'Explosives' | 'Machinery' | 'Tools';

export const CATEGORIES: { id: Category; icon: string; label: string }[] = [
  { id: 'Characters', icon: 'human', label: 'Characters' },
  { id: 'Objects', icon: 'crate', label: 'Objects' },
  { id: 'Weapons', icon: 'gun', label: 'Firearms' },
  { id: 'Melee', icon: 'sword', label: 'Melee' },
  { id: 'Explosives', icon: 'bomb', label: 'Explosives' },
  { id: 'Machinery', icon: 'gear', label: 'Machinery' },
  { id: 'Tools', icon: 'wrench', label: 'Tools' },
];

export interface SpawnOptions {
  flip?: boolean;
  angle?: number;
  /** Spawn point is the object's bottom center rather than its center. */
  fromState?: boolean;
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

export type DamageKind = 'blunt' | 'bullet' | 'cut' | 'stab' | 'explosion' | 'fire' | 'crush' | 'shock';

export interface BulletHit {
  part: Part;
  point: V2;
  normal: V2;
  dir: V2;
  /** Remaining bullet energy factor (J). */
  energy: number;
  damage: number;
  exit: V2 | null;
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
}

export interface EntityState {
  def: string;
  flip: boolean;
  parts: PartState[];
  extra?: Record<string, unknown>;
  /** References to other entities in the same snapshot (held items, lodged blades). */
  links?: Record<string, unknown>;
}

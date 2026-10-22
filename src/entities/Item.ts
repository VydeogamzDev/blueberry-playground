import { Prop, type PropConfig } from './Prop';
import { PX } from '../engine/constants';
import type { Part, ShapeSpec } from '../world/Part';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ItemDef, SpawnOptions } from '../world/types';
import type { V2 } from '../engine/math';

/** Where a hand holds an item, in art pixels (x right, y down from the top). */
export interface HoldSpec {
  grip: [number, number];
  /** Support-hand grip for two-handed items. */
  grip2?: [number, number];
  /** Angle the item is held at (radians above horizontal); guns are held level. */
  angle?: number;
}

/** Anything that can hold items (people). */
export interface Holder {
  tryHold(item: Item, at?: V2): boolean;
  dropItem(item: Item): void;
}

/** Box collider from an art-pixel rect (top-left origin) relative to the sprite center. */
export function artRect(artW: number, artH: number, x: number, y: number, w: number, h: number, r = 0.5): ShapeSpec {
  return { kind: 'box', w, h, r, x: x + w / 2 - artW / 2, y: artH / 2 - (y + h / 2) };
}

/** Density (2D) that gives the given box shapes a total mass in kg. */
export function densityFor(mass: number, shapes: ShapeSpec[]): number {
  let area = 0;
  for (const s of shapes) {
    if (s.kind === 'box') area += s.w * s.h;
    else if (s.kind === 'ball') area += Math.PI * s.r * s.r;
    else if (s.kind === 'capsule') area += s.r * 2 * s.halfH * 2 + Math.PI * s.r * s.r;
  }
  return mass / Math.max(1e-6, area * PX * PX);
}

/** A single-part object that people can hold (weapons, tools). */
export class Item extends Prop {
  readonly hold: HoldSpec | null;
  /** The person currently holding this item. */
  holder: (Entity & Holder) | null = null;
  /** Blunt-impact multiplier (clubs and hammers hurt more than their mass suggests). */
  blunt = 1;
  /** Melee weapons whoosh when swung fast. */
  swings = false;
  private swishT = 0;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec | null, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.hold = hold;
  }

  /** Grip point in body-local meters. */
  gripLocal(second = false): V2 | null {
    const g = second ? this.hold?.grip2 : this.hold?.grip;
    if (!g) return null;
    return this.main.pixelToLocal(g[0], g[1]);
  }

  gripWorld(second = false): V2 | null {
    const l = this.gripLocal(second);
    return l ? this.main.localToWorld(l.x, l.y) : null;
  }

  /** Forward direction (toward the muzzle / tip) in world space. */
  forward(): V2 {
    return this.main.localDir(this.main.flip, 0);
  }

  postStep(dt: number): void {
    this.swing(dt);
  }

  /** Whoosh when the far end of a melee weapon moves fast through the air. */
  protected swing(dt: number): void {
    if (!this.swings) return;
    this.swishT -= dt;
    if (this.swishT > 0) return;
    const p = this.main;
    const tip = Math.hypot(p.vx, p.vy) + Math.abs(p.av) * (p.w * PX) * 0.5;
    if (tip > 7) {
      this.game.sound.swish(tip, p.x);
      this.swishT = 0.35;
    }
  }

  dragMass(): number {
    return this.totalMass() + (this.holder ? Math.min(80, this.holder.totalMass()) * 0.5 : 0);
  }

  onGrab(_part: Part, held: boolean, at?: V2): void {
    if (held || !this.hold || this.holder || this.destroyed) return;
    // dropping an item onto someone's hand makes them hold it
    for (const e of this.game.entities) {
      const h = e as Entity & Partial<Holder>;
      if (e !== this && !e.destroyed && h.tryHold && h.tryHold(this, at)) return;
    }
  }

  protected onDestroy(): void {
    if (this.holder) this.holder.dropItem(this);
    this.holder = null;
  }
}

export type { Part };

import { Blade, type BladeSpec } from './Melee';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

export type Drug = 'healing' | 'adrenaline' | 'knockout' | 'life' | 'poison';

/** Anything a syringe can inject into (people). */
export interface Injectable {
  inject(drug: Drug, dose: number): void;
}

/** Seconds a full syringe takes to empty once the needle is in. */
const INJECT_TIME = 0.7;

/**
 * A needle that stabs in easily and, while stuck in a person, pushes its dose
 * into them. Empty syringes stay in until pulled out, like any lodged blade.
 */
export class Syringe extends Blade {
  readonly drug: Drug;
  /** Fraction of the dose left. */
  fill = 1;
  private emptyArt: () => PixelArt;

  constructor(
    game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blade: BladeSpec, drug: Drug,
    emptyArt: () => PixelArt, x: number, y: number, opts: SpawnOptions,
  ) {
    super(game, def, cfg, hold, blade, x, y, opts);
    this.drug = drug;
    this.emptyArt = emptyArt;
  }

  postStep(dt: number): void {
    super.postStep(dt);
    const l = this.lodge;
    if (!l || this.fill <= 0 || !l.target.mat.bleeds) return;
    const into = l.target.entity as Entity & Partial<Injectable>;
    if (!into.inject) return;
    const dose = Math.min(this.fill, dt / INJECT_TIME);
    this.fill -= dose;
    into.inject(this.drug, dose);
    if (this.fill <= 1e-4) this.empty();
  }

  private empty(): void {
    this.fill = 0;
    this.main.setArt(this.emptyArt());
    this.game.sound.click(this.main.x, 1.8);
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    acts.unshift({ label: this.fill > 0 ? `${Math.round(this.fill * 100)}% full` : 'Empty', action: () => {} });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), fill: this.fill };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.fill = typeof x.fill === 'number' ? x.fill : 1;
    if (this.fill <= 0) this.main.setArt(this.emptyArt());
  }
}

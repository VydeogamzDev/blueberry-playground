import { Blade, type BladeSpec } from './Melee';
import type { HoldSpec } from './Item';
import type { PropConfig } from './Prop';
import { asPatient, glowOver, sparkle, touches, DRUG_GLOW } from './Medical';
import { PX } from '../engine/constants';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Entity } from '../world/Entity';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

export type Drug =
  | 'healing' | 'adrenaline' | 'knockout' | 'life' | 'poison'
  | 'death' | 'coagulation' | 'painkiller' | 'strength' | 'freeze' | 'bone' | 'acid' | 'pink' | 'zombie' | 'cure';

/** What a Pink syringe may turn out to hold: any of the others (one, chosen as the needle first goes in). */
export const PINK_DRUGS: Drug[] = ['healing', 'adrenaline', 'knockout', 'life', 'poison', 'death', 'coagulation', 'painkiller', 'strength', 'freeze', 'bone', 'acid', 'zombie', 'cure'];

/** Anything a syringe can inject into (people and animals). */
export interface Injectable {
  inject(drug: Drug, dose: number): void;
}

/** Seconds a full syringe takes to empty once the needle is in (or the plunger is pushed). */
const INJECT_TIME = 1.2;
/** Steps the plunger's stopper shows on its way up the barrel, full to empty. */
export const SYRINGE_STEPS = 8;
/** How close (m) flesh has to be ahead of the needle's point for it to go in when pushed in slowly. */
const PROBE = 0.02;

/**
 * How much faster adrenaline has someone (a person or an animal) moving and
 * reacting, from the seconds of it left in them (45 a dose, 90 at most): 1.65
 * times as fast on a dose, a little more on a second, fading out over its last
 * 15 s. 1: no faster.
 */
export function adrenalineRush(secs: number): number {
  return 1 + 0.65 * Math.min(1, secs / 15) + 0.15 * Math.min(1, Math.max(0, secs - 45) / 45);
}

/**
 * A needle that goes in easily and, while it's in someone (a person or an
 * animal), pushes its dose into them. A quick stab lodges it; pushed slowly
 * against someone by hand, it goes in all the same. Use (F) pushes the plunger
 * into whoever it touches, or, in someone's hand, into themselves. The stopper
 * shows how much is left. Empty syringes stay in until pulled out, like any
 * lodged blade.
 */
export class Syringe extends Blade {
  readonly drug: Drug;
  /** Fraction of the dose left. */
  fill = 1;
  /** What a Pink syringe turned out to hold (see PINK_DRUGS): chosen as it first goes into someone. */
  pinkAs: Drug | null = null;
  /** Its art with the plunger pushed in so many steps (see SYRINGE_STEPS). */
  private art: (step: number) => PixelArt;
  private shown = 0;
  /** Held by the cursor: pushed against someone, even slowly, the needle goes in. */
  private grabbed = false;
  /** The plunger pushed with the needle not lodged (Use while it touches someone, or on oneself): the limb it goes into. */
  private pressed: Part | null = null;
  /** Going in now (the puff and the sound start it). */
  private going = false;
  private fxT = 0;
  /** Lodged last step, and until (s) a needle just pulled out may be eased back in (it's still against them). */
  private wasIn = false;
  private outT = 0;

  constructor(
    game: Game, def: ItemDef, cfg: PropConfig, hold: HoldSpec, blade: BladeSpec, drug: Drug,
    art: (step: number) => PixelArt, x: number, y: number, opts: SpawnOptions,
  ) {
    super(game, def, cfg, hold, blade, x, y, opts);
    this.drug = drug;
    this.art = art;
    this.activatable = true;
  }

  onGrab(part: Part, held: boolean, at?: V2): void {
    this.grabbed = held;
    super.onGrab(part, held, at);
  }

  /** Pushed into someone, it's an injection, not something handed to them. */
  offer(at?: V2): boolean {
    if (this.lodge || this.pressed || (this.fill > 0 && this.needleAgainst())) return false;
    return super.offer(at);
  }

  postStep(dt: number): void {
    super.postStep(dt);
    if (this.wasIn && !this.lodge) this.outT = 0.5;
    this.wasIn = !!this.lodge;
    this.outT -= dt;
    if (this.fill <= 0 || this.destroyed) return;
    // pushed slowly against someone by hand (a stab needs speed: see Blade), the needle still goes in;
    // not while it's being drawn back, nor straight after it's been pulled out
    if (!this.lodge && !this.pressed && this.grabbed && !this.holder && this.outT <= 0) {
      const f = this.forward();
      const at = this.main.vx * f.x + this.main.vy * f.y > -0.05 ? this.needleAgainst() : null;
      if (at) this.slideIn(at);
    }
    // (a cut-off limb takes nothing to the body)
    const l = this.lodge;
    const into = l ? (l.target.mat.bleeds && !l.target.detached ? l.target : null) : this.pressed;
    const who = into && !into.destroyed ? (into.entity as Entity & Partial<Injectable>) : null;
    if (!into || !who?.inject) {
      this.pressed = null;
      this.going = false;
      return;
    }
    const dose = Math.min(this.fill, dt / INJECT_TIME);
    this.fill -= dose;
    who.inject(this.drug === 'pink' ? (this.pinkAs ??= PINK_DRUGS[Math.floor(Math.random() * PINK_DRUGS.length)]) : this.drug, dose);
    this.fx(into, dt);
    if (this.fill <= 1e-4) this.empty();
    else this.refresh();
  }

  /** The needle's point (world). */
  private tip(): V2 {
    return this.main.pixelToWorld(this.blade.blade[1], (this.main.h - 1) / 2);
  }

  /** Flesh of someone (a person or an animal) right at the needle's point: the part it would go into. */
  private needleAgainst(): Part | null {
    // (gone: its body is freed, and asking where it is would bring Rapier down)
    if (this.destroyed || this.main.destroyed) return null;
    const tip = this.tip();
    const f = this.forward();
    const d = PX * 0.5 + PROBE;
    const phys = this.game.physics;
    let hit = null as Part | null;
    phys.world.intersectionsWithPoint({ x: tip.x + f.x * d, y: tip.y + f.y * d }, (c) => {
      const p = phys.partOf(c);
      if (!p || p.destroyed || p.detached || !p.mat.bleeds || p.entity === this || p.entity === this.holder || !asPatient(p.entity)) return true;
      hit = p;
      return false;
    });
    return hit;
  }

  /** The needle eased in (rather than stabbed in: hardly hurts). */
  private slideIn(target: Part): void {
    const tip = this.tip();
    this.stick(target, tip, 0.02);
  }

  /** The puff where it goes in (bigger as it starts), and healing glowing all over the body as it works. */
  private fx(into: Part, dt: number): void {
    const color = DRUG_GLOW[this.drug];
    const at = this.lodge ? this.tip() : { x: into.x, y: into.y };
    if (!this.going) {
      this.going = true;
      this.fxT = 0;
      this.game.sound.play('medical/inject', { gain: 0.7, x: at.x });
      sparkle(this.game, at.x, at.y, color, 10, PX * 3);
    }
    this.fxT -= dt;
    if (this.fxT > 0) return;
    this.fxT = 0.1;
    sparkle(this.game, at.x, at.y, color, 2);
    // (healing and curing glow all over the body as they work, and frost spreads over it)
    if (this.drug === 'healing' || this.drug === 'life' || this.drug === 'cure' || this.drug === 'freeze') glowOver(this.game, into.entity, color, 3);
  }

  /** Use: pushes the plunger, into whoever holds it or whoever it's touching. With nobody there, a squirt into the air. */
  activate(): void {
    if (this.destroyed) return;
    if (this.fill <= 0) {
      this.game.sound.click(this.main.x, 1.8);
      return;
    }
    if (this.lodge || this.pressed) return;
    // in someone's hand: into their own arm
    const self = asPatient(this.holder);
    if (self) {
      const g = this.gripWorld() ?? this.main;
      let best: Part | null = null;
      for (const p of self.parts) {
        if (p.destroyed || p.detached || !p.mat.bleeds) continue;
        if (!best || Math.hypot(p.x - g.x, p.y - g.y) < Math.hypot(best.x - g.x, best.y - g.y)) best = p;
      }
      if (best) {
        this.pressed = best;
        return;
      }
    } else if (!this.holder) {
      const into = this.needleAgainst();
      if (into) {
        this.slideIn(into);
        return;
      }
      const t = touches(this).find((x) => x.part.mat.bleeds);
      if (t) {
        this.pressed = t.part;
        return;
      }
    }
    const tip = this.tip();
    const f = this.forward();
    sparkle(this.game, tip.x + f.x * PX * 2, tip.y + f.y * PX * 2, DRUG_GLOW[this.drug], 4, PX);
    this.game.sound.click(tip.x, 1.6);
  }

  /** The stopper moved up the barrel as far as the dose has gone in. */
  private refresh(): void {
    const step = this.fill <= 0 ? SYRINGE_STEPS : Math.min(SYRINGE_STEPS - 1, Math.round((1 - this.fill) * SYRINGE_STEPS));
    if (step === this.shown || this.destroyed) return;
    this.shown = step;
    this.main.setArt(this.art(step));
  }

  private empty(): void {
    this.fill = 0;
    this.pressed = null;
    this.going = false;
    this.refresh();
    this.game.sound.click(this.main.x, 1.8);
  }

  contextActions(): ContextAction[] {
    const acts = super.contextActions();
    if (this.fill > 0 && !this.lodge && !this.pressed) acts.unshift({ label: this.holder ? 'Inject themselves' : 'Inject', hint: 'F', action: () => this.activate() });
    acts.unshift({ label: this.fill > 0 ? `${Math.round(this.fill * 100)}% full` : 'Empty', action: () => {} });
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { ...super.serializeExtra(), fill: this.fill, ...(this.pinkAs ? { pinkAs: this.pinkAs } : {}) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    super.restoreExtra(x);
    this.fill = typeof x.fill === 'number' ? x.fill : 1;
    this.pinkAs = PINK_DRUGS.includes(x.pinkAs as Drug) ? (x.pinkAs as Drug) : null;
    this.refresh();
  }
}

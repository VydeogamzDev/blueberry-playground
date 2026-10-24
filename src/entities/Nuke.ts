import { Prop, type PropConfig } from './Prop';
import { NUKE_MAX_KT, NUKE_MIN_KT } from '../systems/Explosions';
import type { Game } from '../world/Game';
import type { PixelArt } from '../art/PixelArt';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/** The yields offered in its menu (kilotons), smallest to biggest. */
export const NUKE_YIELDS = [NUKE_MIN_KT, 1, 10, 100, 1000, 10000, NUKE_MAX_KT];
/** The countdowns offered (s). */
export const NUKE_COUNTDOWNS = [5, 10, 30, 60];

/** A yield as it reads: "0.1 kt", "10 kt", "1 Mt"... */
export function yieldLabel(kt: number): string {
  return kt >= 1000 ? `${kt / 1000} Mt` : `${kt} kt`;
}

/**
 * A thermonuclear bomb. Its menu sets the yield and the countdown; activating
 * it (or a pulse, or a fuse cord burning down to it) starts the countdown,
 * shown on its display, and at zero it goes off (see Explosions.nuke()).
 * Ordinary blasts and fire don't set it off.
 */
export class Nuke extends Prop {
  /** Yield (kt). */
  kt = 10;
  /** Seconds it counts down from once started. */
  countdown = 10;
  armed = false;
  timer = 0;
  private art: (value: number, counting: boolean) => PixelArt;
  /** What the display shows (see showTimer()). */
  private shown: string;
  private exploded = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, art: (value: number, counting: boolean) => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.art = art;
    this.activatable = true;
    // (the sprite it starts with shows the default countdown)
    this.shown = `${this.countdown}:false`;
  }

  get label(): string {
    return `${this.def.name} (${yieldLabel(this.kt)})`;
  }

  activate(): void {
    if (this.armed || this.exploded) return;
    this.armed = true;
    this.timer = this.countdown;
    this.game.sound.arm(this.main.x);
    this.showTimer();
  }

  /** A fuse cord burning down to it starts the countdown (see Connections). */
  onFuse(): void {
    this.activate();
  }

  disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    this.game.sound.click(this.main.x, 0.8);
    this.showTimer();
  }

  preStep(dt: number): void {
    if (!this.armed) return;
    const before = Math.ceil(this.timer);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.detonate();
      return;
    }
    if (Math.ceil(this.timer) !== before) {
      // a beep each second, a flash of the casing for the last few
      this.game.sound.click(this.main.x, this.timer < 3 ? 2.2 : 1.7);
      if (this.timer < 3) this.main.flash = 0.3;
    }
    this.showTimer();
  }

  /** The display: the seconds left while counting down, otherwise (dim) the countdown it's set to. */
  private showTimer(): void {
    const v = this.armed ? Math.max(0, Math.ceil(this.timer)) : this.countdown;
    const key = `${v}:${this.armed}`;
    if (key === this.shown) return;
    this.shown = key;
    this.main.setArt(this.art(v, this.armed));
  }

  detonate(): void {
    if (this.exploded || this.destroyed) return;
    this.exploded = true;
    const c = this.main.body.translation();
    this.game.explosions.nuke(c.x, c.y, this.kt, this);
    this.game.remove(this);
  }

  contextActions(): ContextAction[] {
    const acts: ContextAction[] = [];
    if (!this.armed) acts.push({ label: `Start countdown (${this.countdown} s)`, hint: 'F', action: () => this.activate() });
    else acts.push({ label: 'Stop countdown', action: () => this.disarm() });
    acts.push({ label: 'Detonate now', danger: true, action: () => this.detonate() });
    for (const kt of NUKE_YIELDS) acts.push({ label: `Yield: ${yieldLabel(kt)}`, checked: this.kt === kt, action: () => (this.kt = kt) });
    for (const s of NUKE_COUNTDOWNS) {
      acts.push({ label: `Countdown: ${s} s`, checked: this.countdown === s, action: () => {
        this.countdown = s;
        this.showTimer();
      } });
    }
    return acts;
  }

  protected serializeExtra(): Record<string, unknown> {
    return { kt: this.kt, countdown: this.countdown, ...(this.armed ? { armed: true, timer: this.timer } : {}) };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.kt === 'number' && x.kt > 0) this.kt = Math.min(NUKE_MAX_KT, Math.max(NUKE_MIN_KT, x.kt));
    if (typeof x.countdown === 'number' && x.countdown > 0) this.countdown = x.countdown;
    if (x.armed) {
      this.armed = true;
      this.timer = Number(x.timer) || this.countdown;
    }
    this.showTimer();
  }
}

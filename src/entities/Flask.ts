import { Prop, type PropConfig } from './Prop';
import type { Liquid } from '../systems/Liquids';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { V2 } from '../engine/math';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

type FlaskArt = (level: number, corked: boolean, tilt?: number) => PixelArt;

/** Seconds a full flask takes to pour out upside down. */
const POUR_TIME = 3;
/** The liquid inside is redrawn for this many tilts of the flask. */
export const FLASK_TILTS = 16;

/**
 * A glass flask of liquid. Uncork it and tip it over to pour; it shatters when
 * hit or shot hard enough and spills whatever is left.
 */
export class Flask extends Prop {
  readonly liquid: Liquid;
  /** Fraction full. */
  amount = 1;
  corked = true;
  private drip = 0;
  private shown = '';
  private art: FlaskArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, liquid: Liquid, art: FlaskArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.liquid = liquid;
    this.art = art;
    this.activatable = true;
  }

  activate(): void {
    this.corked = !this.corked;
    this.game.sound.click(this.main.x, this.corked ? 0.9 : 1.4);
    this.refresh();
  }

  /** Where the neck opens, and which way it points. */
  private mouth(): { p: V2; d: V2 } {
    return { p: this.main.pixelToWorld(4.5, 0), d: this.main.localDir(0, 1) };
  }

  preStep(dt: number): void {
    if (this.corked || this.amount <= 0) return;
    const { p, d } = this.mouth();
    // pours once the neck tips past ~70 degrees, faster the further over it goes
    const rate = Math.min(1, Math.max(0, (0.35 - d.y) / 1.35));
    if (rate <= 0) return;
    this.amount = Math.max(0, this.amount - (dt / POUR_TIME) * rate);
    this.game.sound.hold(this, 'liquid/pour_loop', 0.12 + rate * 0.3, p.x, 0.85 + rate * 0.3);
    this.drip += dt * 90 * rate;
    const n = Math.floor(this.drip);
    if (n > 0) {
      this.drip -= n;
      this.game.particles.liquid(this.liquid, p.x, p.y, d.x, d.y, n, 0.8, 0.25, this.main.body);
    }
  }

  frame(): void {
    this.refresh();
  }

  private refresh(): void {
    if (this.destroyed) return;
    // the art shows the level in eighths, settled to whichever side is down
    const level = Math.ceil(this.amount * 8) / 8;
    const turn = (this.main.a * this.main.flip) / (Math.PI * 2);
    const tilt = level > 0 && level < 1 ? ((Math.round(turn * FLASK_TILTS) % FLASK_TILTS) + FLASK_TILTS) % FLASK_TILTS : 0;
    const key = `${level}:${this.corked}:${tilt}`;
    if (key === this.shown) return;
    this.shown = key;
    this.main.setArt(this.art(level, this.corked, tilt));
  }

  shatter(point?: V2): void {
    if (this.amount > 0 && !this.destroyed) {
      const p = this.main;
      // the whole content splashes out (a pour is ~270 drops)
      this.game.particles.liquid(this.liquid, p.x, p.y, 0, 1, Math.round(20 + this.amount * 200), 2.2, Math.PI, p.body);
      this.game.sound.play('liquid/splash', { gain: 0.5 + this.amount * 0.4, x: p.x });
    }
    super.shatter(point);
  }

  onBullet(): void {
    this.shatter();
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.corked ? 'Uncork' : 'Cork', hint: 'F', action: () => this.activate() },
      { label: `${Math.round(this.amount * 100)}% full`, action: () => {} },
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { amount: this.amount, corked: this.corked };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    if (typeof x.amount === 'number') this.amount = x.amount;
    this.corked = x.corked !== false;
    this.refresh();
  }
}

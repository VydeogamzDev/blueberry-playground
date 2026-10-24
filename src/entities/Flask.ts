import { Prop, type PropConfig } from './Prop';
import { Liquid } from '../systems/Liquids';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { V2 } from '../engine/math';
import type { ContextAction, ImpactInfo, ItemDef, SpawnOptions } from '../world/types';

type FlaskArt = (level: number, corked: boolean, tilt?: number) => PixelArt;

/** Seconds a full flask takes to pour out upside down. */
const POUR_TIME = 3;
/** Heat (see Fire.warm()) at which a flask of oil in a fire cracks and bursts into flame: under two seconds in a big one. */
const BURST = 2.5;
/** The liquid inside is redrawn for this many tilts of the flask. */
export const FLASK_TILTS = 16;
/**
 * A knock this fast (m/s) smashes it, dropped from a couple of metres or flung at
 * something, as it does a molotov or a pane: by its own small weight alone (see
 * Prop.onImpact()) it took a 10 m fall.
 */
const SMASH_SPEED = 6;

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
  private heat = 0;

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
      // (once: it's only taken away at the end of the step, and the rest of a
      // shotgun's pellets, or the heat of another flame, may break it again meanwhile)
      this.amount = 0;
    }
    super.shatter(point);
  }

  onBullet(): void {
    this.shatter();
  }

  onImpact(info: ImpactInfo): void {
    // (a knock from something very light, a spent case, doesn't do it)
    if (info.speed >= SMASH_SPEED && info.otherMass > 0.3) this.shatter(info.point);
    else super.onImpact(info);
  }

  /** A fire's heat on it: glass full of oil cracks, and the oil goes up in a gout of flame. */
  onHeat(_p: Part, heat: number): void {
    if (this.liquid !== Liquid.Oil || this.amount <= 0 || this.destroyed) return;
    this.heat += heat;
    const p = this.main;
    if (this.heat < BURST) {
      // the oil inside smokes as it heats up
      const { p: m } = this.mouth();
      this.game.particles.smoke(m.x, m.y + 0.05, 1, 0.08);
      return;
    }
    const { x, y } = p;
    const r = 0.4 + this.amount * 0.6;
    // (broken first: the flare sets alight what it reaches, this flask among them)
    this.shatter();
    this.game.fire.flare(x, y, r);
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

import { Prop, type PropConfig } from './Prop';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/**
 * A machine that runs while it's powered and switched on (fans, the magnet,
 * the tesla coil, the siren): on from the start, activate (or a pulse)
 * switches it off and on again. Power reaching it never sets it off.
 */
export abstract class Appliance extends Prop {
  /** Switched on. */
  on = true;
  /** Running, as the host has it (a guest's copy is told: see restoreExtra()). */
  protected live = false;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
  }

  get running(): boolean {
    return this.on && this.powered;
  }

  canRest(): boolean {
    return !this.running;
  }

  activate(): void {
    this.on = !this.on;
    this.game.sound.click(this.main.x, this.on ? 1.1 : 0.8);
  }

  preStep(dt: number): void {
    const now = this.running;
    if (now !== this.live) {
      this.live = now;
      this.changed(now);
    }
    if (now) this.run(dt);
  }

  /** It started or stopped running (on every screen: a guest's copy hears of it in restoreExtra()). */
  protected changed(_running: boolean): void {}

  /** A step of running. */
  protected abstract run(dt: number): void;

  contextActions(): ContextAction[] {
    return [{ label: this.on ? 'Switch off' : 'Switch on', hint: 'F', action: () => this.activate() }];
  }

  protected serializeExtra(): Record<string, unknown> {
    // (always whether it runs: a guest's copy shows it running from this)
    return { on: this.on, run: this.live };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = x.on !== false;
    const run = x.run === true;
    if (run === this.live) return;
    this.live = run;
    this.changed(run);
  }
}

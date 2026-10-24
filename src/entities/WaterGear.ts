import { Prop, type PropConfig } from './Prop';
import { toggleRun, type HandSwitched } from './Machines';
import { PX } from '../engine/constants';
import { TAP_SPOUT } from '../art/floats';
import type { PixelArt } from '../art/PixelArt';
import type { Game } from '../world/Game';
import type { ContextAction, ItemDef, SpawnOptions } from '../world/types';

/**
 * A block of water: as soon as time runs, it's water (see systems/Fluid), as
 * much of it as there's room for, and it falls and spreads and fills what it's
 * in. Placed while paused, it waits as a block.
 */
export class WaterBlock extends Prop {
  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
  }

  canRest(): boolean {
    return false;
  }

  preStep(): void {
    const p = this.main;
    if (this.destroyed || p.noCollideAll) return;
    // (out of the way first: the water isn't kept out of its own block)
    p.setNoCollideAll(true);
    const w = p.w * PX;
    const h = p.h * PX;
    // (turned on its side, it's that way round)
    const side = Math.abs(Math.sin(p.a)) > Math.SQRT1_2;
    const made = this.game.fluid.addBlock(p.x, p.y, side ? h : w, side ? w : h, p.vx, p.vy);
    if (made) this.game.sound.play('liquid/splash', { gain: Math.min(0.8, 0.2 + made / 600), x: p.x, rate: 0.8 });
    this.game.remove(this);
  }
}

/** A tap's flows, as shares of its own (the context menu's), and its own: particles of water a second. */
export const TAP_FLOWS = [0.25, 0.5, 1, 2];
const TAP_RATE = 50;
/** How fast its water leaves the spout (m/s). */
const TAP_SPEED = 2.2;

/**
 * A tap: water runs from its spout while it's on (activate it) or powered.
 * Fix it somewhere by its flange with the weld tool, over a tank or a bucket.
 */
export class Tap extends Prop implements HandSwitched {
  on = false;
  heldOff = false;
  /** Its flow as a share of its own (see TAP_FLOWS). */
  flow = 1;
  private due = 0;
  private shown = false;
  private openArt: () => PixelArt;

  constructor(game: Game, def: ItemDef, cfg: PropConfig, openArt: () => PixelArt, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.activatable = true;
    this.usesPower = true;
    this.openArt = openArt;
  }

  get running(): boolean {
    return (this.on || this.powered) && !this.heldOff;
  }

  activate(): void {
    toggleRun(this, this.running, this.powered);
    this.game.sound.click(this.main.x, 1.1);
  }

  setPowered(on: boolean): void {
    super.setPowered(on);
    if (!on) this.heldOff = false;
  }

  preStep(dt: number): void {
    if (this.heldOff && !this.powered) this.heldOff = false;
    if (!this.running) {
      this.due = 0;
      return;
    }
    const p = this.main;
    const down = p.localDir(0, -1);
    const across = p.localDir(1, 0);
    this.due += TAP_RATE * this.flow * dt;
    while (this.due >= 1) {
      this.due -= 1;
      // (spread over the spout's mouth, so they don't start on top of each other)
      const o = p.pixelToWorld(TAP_SPOUT[0], TAP_SPOUT[1]);
      const s = (Math.random() - 0.5) * 2.4 * PX;
      const v = TAP_SPEED * (0.9 + Math.random() * 0.2);
      if (!this.game.fluid.add(o.x + across.x * s + down.x * PX, o.y + across.y * s + down.y * PX, p.vx + down.x * v, p.vy + down.y * v)) break;
    }
    this.game.sound.hold(this, 'liquid/pour_loop', 0.2 + 0.08 * this.flow, p.x);
  }

  /** The handle turned (on every screen: drawn as a frame is). */
  frame(): void {
    const run = this.running;
    if (run === this.shown) return;
    this.shown = run;
    this.main.setArt(run ? this.openArt() : this.cfg.art());
  }

  contextActions(): ContextAction[] {
    return [
      { label: this.running ? 'Turn off' : 'Turn on', hint: 'F', action: () => this.activate() },
      ...TAP_FLOWS.map((f) => ({ label: `Flow ${f * 100}%`, checked: this.flow === f, action: () => (this.flow = f) })),
    ];
  }

  protected serializeExtra(): Record<string, unknown> {
    return { on: this.on, off: this.heldOff, flow: this.flow };
  }

  protected restoreExtra(x: Record<string, unknown>): void {
    this.on = !!x.on;
    this.heldOff = !!x.off;
    this.flow = TAP_FLOWS.includes(x.flow as number) ? (x.flow as number) : 1;
  }
}

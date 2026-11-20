import { automated } from './Device';

/**
 * Auto quality (Settings > Graphics, 0.5.0): while the frames fall well behind (a
 * Chromebook, an iPad, a big scene), the game draws less until they keep up, and
 * gives it back once they have for a while. Held up by drawing (the frame's own work
 * leaves much of its time idle: the graphics chip is behind), it draws fewer pixels,
 * a step at a time (see RES_STEPS); held up by its own work, fewer effects (half the
 * smoke and sparks, four lights at most). What it gives back and finds too much again
 * soon after, it waits twice as long to try again.
 */
export const RES_STEPS = [1, 0.75, 0.5];

/** The frames fall behind when under this share of the rate aimed at, for SLOW_FOR seconds. */
const SLOW = 0.8;
const SLOW_FOR = 2.5;
/** They keep up at this share of it. */
const FAST = 0.95;
/** First wait (s) of keeping up before giving something back; doubles when that was too soon, up to MAX_WAIT. */
const BACK_AFTER = 20;
const MAX_WAIT = 240;
/** After a change, how long (s) before judging again (the frames settle). */
const HOLD = 3;

export class AutoQuality {
  /** Never under a browser a program drives (the self-tests, benchmarks: they'd measure something else each run). */
  allowed = !automated();
  enabled = this.allowed;
  /** Whether a step lower would draw fewer pixels (the settings know: see UI.drawnResolution()). */
  canDrop: () => boolean = () => false;
  /** How many steps of RES_STEPS down the resolution is. */
  res = 0;
  /** 1: fewer effects. */
  fx = 0;
  /** Told when res or fx changes (the settings are put into effect again). */
  onChange: () => void = () => {};
  private slowT = 0;
  private fastT = 0;
  private holdT = 0;
  private wait = BACK_AFTER;
  private t = 0;
  private raisedAt = -Infinity;

  /** Back to as set, now. */
  reset(): void {
    const was = this.res || this.fx;
    this.res = this.fx = 0;
    this.slowT = this.fastT = 0;
    this.wait = BACK_AFTER;
    if (was) this.onChange();
  }

  /**
   * Once a frame: `fps` the frames a second lately, `workMs` the frame's own work (steps,
   * logic, handing the picture over), `target` the rate aimed at.
   */
  update(dt: number, fps: number, workMs: number, target: number): void {
    if (!this.enabled) {
      if (this.res || this.fx) this.reset();
      return;
    }
    this.t += dt;
    this.holdT -= dt;
    this.slowT = fps < target * SLOW ? this.slowT + dt : 0;
    this.fastT = fps >= target * FAST ? this.fastT + dt : 0;
    if (this.holdT > 0) return;
    if (this.slowT > SLOW_FOR) {
      const drawing = workMs < (1000 / Math.max(1, fps)) * 0.6;
      const canRes = this.res < RES_STEPS.length - 1 && this.canDrop();
      if (drawing && canRes) this.res++;
      else if (this.fx < 1) this.fx++;
      else if (canRes) this.res++;
      else return;
      // (given back too soon: wait longer next time)
      if (this.t - this.raisedAt < HOLD + SLOW_FOR + 3) this.wait = Math.min(MAX_WAIT, this.wait * 2);
      this.changed();
    } else if ((this.res || this.fx) && this.fastT > this.wait) {
      // (effects back first, then the pixels)
      if (this.fx) this.fx--;
      else this.res--;
      this.raisedAt = this.t;
      this.changed();
    }
  }

  private changed(): void {
    this.slowT = this.fastT = 0;
    this.holdT = HOLD;
    this.onChange();
  }
}

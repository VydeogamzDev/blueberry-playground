import type { PilotHud } from '../systems/Piloting';

/** How long (s) the recorder keeps, and how often (s) it samples. */
const KEEP = 60;
const EVERY = 0.25;

/**
 * The flight recorder (0.4.0): what's flown, its height (blue) and speed (orange) over
 * the last minute, graphed in the pilot's readout, and its g (red ticks past 4 g). Starts
 * again when something else is flown, or time goes back (a load, an undo).
 */
export class FlightRecorder {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private at = -Infinity;
  private samples: { h: number; v: number; g: number }[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flight-graph';
    this.canvas.width = 240;
    this.canvas.height = 36;
    this.ctx = this.canvas.getContext('2d');
  }

  add(time: number, hud: PilotHud): void {
    if (time < this.at) this.samples.length = 0;
    if (time - this.at < EVERY) return;
    this.at = time;
    this.samples.push({ h: hud.alt ?? hud.height, v: hud.speed, g: hud.g ?? 1 });
    if (this.samples.length > KEEP / EVERY) this.samples.shift();
    this.draw();
  }

  private draw(): void {
    const c = this.ctx;
    if (!c) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const s = this.samples;
    if (s.length < 2) return;
    const line = (key: 'h' | 'v', color: string) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of s) {
        lo = Math.min(lo, p[key]);
        hi = Math.max(hi, p[key]);
      }
      if (hi - lo < 1) hi = lo + 1;
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.beginPath();
      s.forEach((p, i) => {
        const x = (i / (KEEP / EVERY - 1)) * W;
        const y = H - 2 - ((p[key] - lo) / (hi - lo)) * (H - 4);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.stroke();
    };
    line('h', '#6ab8ff');
    line('v', '#f2a33a');
    c.fillStyle = '#ff5a4a';
    s.forEach((p, i) => {
      if (p.g > 4) c.fillRect((i / (KEEP / EVERY - 1)) * W, 0, 2, Math.min(H, (p.g - 4) * 3));
    });
  }
}

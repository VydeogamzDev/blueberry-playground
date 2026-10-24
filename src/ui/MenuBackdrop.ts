import { getItem } from '../catalog/items';
import { PixelArt, hex } from '../art/PixelArt';

/** Screen pixels a backdrop pixel (the toys come out their size in the sandbox at its first zoom). */
const PIX = 2;
/** Things drifting past on a 1920 × 1080 screen (fewer on a smaller one). */
const COUNT = 16;
/** How far (backdrop pixels) the nearest layer sways after the cursor. */
const SWAY = 14;

/** A blueberry, with a face (as on the loading screen). */
const BERRY = [
  '.....ooooo.....',
  '...oommmmmmo...',
  '..ommcmcmcmmo..',
  '.omhlmcccmmmdo.',
  '.omhlmcccmmmdo.',
  'omllllmcmmmmmdo',
  'omlllmmmmmmmmdo',
  'omllmemmmemmddo',
  'omlmmemmmemmddo',
  'ommmpmmmmmpmddo',
  '.ommmmememmddo.',
  '.ommmmmemmdddo.',
  '..ommmmmmdddo..',
  '...oodddddoo...',
  '.....ooooo.....',
];
const BERRY_PAL: Record<string, number> = {
  o: hex('#1b1f3a'), d: hex('#2f3f88'), m: hex('#4762bb'), l: hex('#6687dc'), h: hex('#c3d2f5'), c: hex('#1f2648'),
  e: hex('#10132a'), p: hex('#a8679f'),
};

/**
 * The layers, far to near: how far they sway with the cursor, how big they're
 * drawn, how fast they fall (backdrop pixels a second) and in what colors, a
 * little lighter than the menu's dark the nearer they are (the blueberries a
 * little blue); `share`: of the things.
 */
const LAYERS = [
  { depth: 0.3, scale: 1, fall: [4, 9], ink: '#2f3237', berry: '#2f3446', share: 0.45 },
  { depth: 0.6, scale: 1, fall: [9, 16], ink: '#34373d', berry: '#333b53', share: 0.38 },
  { depth: 1, scale: 2, fall: [16, 26], ink: '#3a3d44', berry: '#394363', share: 0.17 },
] as const;

interface Kind {
  art: () => HTMLCanvasElement | undefined;
  /** How often it comes, against the others. */
  weight: number;
  scale: number;
  berry?: boolean;
}

const toy = (id: string, weight: number): Kind => ({ art: () => getItem(id)?.preview(), weight, scale: 1 });

/** What drifts past: the toybox's own pictures (any not in it are left out) and, most often, blueberries. */
const KINDS: Kind[] = [
  { art: () => new PixelArt(BERRY[0].length, BERRY.length).map(BERRY, BERRY_PAL).toCanvas(0), weight: 5, scale: 2, berry: true },
  toy('human', 3),
  toy('crate', 2),
  toy('barrel', 1),
  toy('tire', 1),
  toy('brick', 1),
  toy('ball', 1),
  toy('dog', 1),
  toy('cat', 1),
];

/** A kind's picture for a layer. */
interface Look {
  img: HTMLCanvasElement;
  weight: number;
  scale: number;
}

interface Thing {
  look: Look;
  layer: number;
  x: number;
  y: number;
  /** Turned (radians). */
  a: number;
  vx: number;
  vy: number;
  va: number;
  /** The slow drift, fall and spin a knock dies away to. */
  drift: number;
  fall: number;
  spin: number;
  /** Its reach from its middle, however it's turned. */
  r: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A picture as a shape in one color, with a tenth of its own shading showing through. */
function silhouette(src: HTMLCanvasElement, ink: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.9;
  g.fillStyle = ink;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function pick(looks: Look[]): Look {
  let n = Math.random() * looks.reduce((sum, l) => sum + l.weight, 0);
  for (const l of looks) if ((n -= l.weight) < 0) return l;
  return looks[looks.length - 1];
}

/**
 * The main menu's backdrop: the toys (people, crates, blueberries...) as dark
 * shapes tumbling slowly down through the dark, in three layers that drift
 * apart a little after the cursor, and now and then one knocked spinning.
 * Drawn small, a pixel every PIX screen pixels (the page scales it up, pixels
 * kept square), on a canvas of its own, and only between start() and stop():
 * while the menu is up.
 */
export class MenuBackdrop {
  readonly canvas = document.createElement('canvas');
  /** Animating (between start() and stop()). */
  running = false;
  /** Frames drawn so far. */
  frames = 0;
  private g: CanvasRenderingContext2D;
  /** Each layer's pictures (made the first time it starts: the toybox's are drawn by then). */
  private looks: Look[][] | null = null;
  private things: Thing[] = [];
  private w = 0;
  private h = 0;
  /** The screen may have changed size since the canvas was. */
  private stale = true;
  private raf = 0;
  private last = 0;
  /** Seconds to the next knock. */
  private kickIn = 3;
  /** The cursor, -1..1 across the screen and down it, and the layers' sway easing after it. */
  private aim = { x: 0, y: 0 };
  private off = { x: 0, y: 0 };

  constructor() {
    this.canvas.className = 'mm-backdrop';
    this.g = this.canvas.getContext('2d')!;
    window.addEventListener('resize', () => (this.stale = true));
  }

  start(): void {
    if (this.stale) this.fit();
    if (this.running) return;
    // (asked for less motion: a still picture)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.draw();
      return;
    }
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Where the cursor is, -1..1 across the screen and down it. */
  point(x: number, y: number): void {
    this.aim.x = x;
    this.aim.y = y;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    // (back from a hidden tab: no great leap)
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.stale) this.fit();
    this.step(dt);
    this.draw();
  };

  /** Sizes the canvas to the screen (the menu covers it all), and scatters the things over it afresh. */
  private fit(): void {
    this.stale = false;
    const w = Math.max(1, Math.ceil(window.innerWidth / PIX));
    const h = Math.max(1, Math.ceil(window.innerHeight / PIX));
    if (w === this.w && h === this.h) return;
    this.canvas.width = this.w = w;
    this.canvas.height = this.h = h;
    // (sizing a canvas resets how it draws)
    this.g.imageSmoothingEnabled = false;
    if (!this.looks) {
      const arts = KINDS.map((k) => k.art());
      this.looks = LAYERS.map((l) => {
        const looks: Look[] = [];
        KINDS.forEach((k, i) => {
          const src = arts[i];
          if (src?.width && src.height) looks.push({ img: silhouette(src, k.berry ? l.berry : l.ink), weight: k.weight, scale: k.scale * l.scale });
        });
        return looks;
      });
    }
    // as many for the screen's area (a phone's fewer), far ones first: they're drawn in this order
    const n = COUNT * Math.min(1.4, Math.max(0.45, (w * h) / (960 * 540)));
    this.things = [];
    LAYERS.forEach((l, layer) => {
      if (!this.looks![layer].length) return;
      for (let i = Math.max(1, Math.round(n * l.share)); i > 0; i--) {
        const t: Thing = { look: this.looks![layer][0], layer, x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0, drift: 0, fall: 0, spin: 0, r: 0 };
        this.place(t, true);
        this.things.push(t);
      }
    });
  }

  /** Puts a thing in afresh, as another toy: above the top (or, at first, anywhere). */
  private place(t: Thing, anywhere: boolean): void {
    const l = LAYERS[t.layer];
    t.look = pick(this.looks![t.layer]);
    t.r = (Math.hypot(t.look.img.width, t.look.img.height) * t.look.scale) / 2;
    const sway = SWAY * l.depth;
    t.x = rand(-sway, this.w + sway);
    t.y = anywhere ? rand(-t.r, this.h + t.r) : -t.r - sway - rand(0, this.h * 0.5);
    t.a = rand(0, Math.PI * 2);
    t.vx = t.drift = rand(-3, 3) * l.depth;
    t.vy = t.fall = rand(l.fall[0], l.fall[1]);
    t.va = t.spin = rand(0.08, 0.4) * (Math.random() < 0.5 ? -1 : 1);
  }

  private step(dt: number): void {
    // a knock dies away to the slow drift
    const ease = Math.min(1, dt * 0.6);
    for (const t of this.things) {
      t.vx += (t.drift - t.vx) * ease;
      t.vy += (t.fall - t.vy) * ease;
      t.va += (t.spin - t.va) * ease;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.a += t.va * dt;
      const m = t.r + SWAY;
      if (t.y > this.h + m || t.x < -m || t.x > this.w + m) this.place(t, false);
    }
    // now and then one in sight (nearer than the farthest) is knocked spinning, and up a little
    this.kickIn -= dt;
    if (this.kickIn <= 0) {
      this.kickIn = rand(4, 9);
      const near = this.things.filter((t) => t.layer > 0 && t.y > 0 && t.y < this.h);
      const t = near[Math.floor(Math.random() * near.length)];
      if (t) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const d = LAYERS[t.layer].depth;
        t.va += side * rand(2.5, 5);
        t.vx += side * rand(14, 26) * d;
        t.vy -= rand(10, 20) * d;
      }
    }
    // the layers ease after the cursor
    const k = Math.min(1, dt * 2.5);
    this.off.x += (this.aim.x - this.off.x) * k;
    this.off.y += (this.aim.y - this.off.y) * k;
  }

  private draw(): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    for (const t of this.things) {
      const d = LAYERS[t.layer].depth;
      const img = t.look.img;
      const c = Math.cos(t.a) * t.look.scale;
      const s = Math.sin(t.a) * t.look.scale;
      g.setTransform(c, s, -s, c, Math.round(t.x - this.off.x * SWAY * d), Math.round(t.y - this.off.y * SWAY * 0.6 * d));
      g.drawImage(img, -(img.width >> 1), -(img.height >> 1));
    }
    this.frames++;
  }
}

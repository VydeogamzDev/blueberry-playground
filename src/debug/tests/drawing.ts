import type { Test, TestCtx } from './types';
import type { Prop } from '../../entities/Prop';

/** What reaches the screen: sprites drawn from the atlas, and what's painted on them afterwards. */
export default function tests({ game, kit }: TestCtx): Test[] {
  const r = game.renderer;
  /** The picture `w` by `h` screen px round world point (x, y) as drawn now (RGBA). */
  const grab = (x: number, y: number, w: number, h: number): Uint8ClampedArray => {
    game.renderFrame(1 / 60, 1);
    const s = r.worldToScreen(x, y);
    const d = r.dpr;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(r.canvas, (s.x - w / 2) * d, (s.y - h / 2) * d, w * d, h * d, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  /** How many pixels differ between two grabs. */
  const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
    return n;
  };
  /** How many pixels are mostly red. */
  const reds = (a: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] > 150 && a[i + 1] < 70 && a[i + 2] < 70) n++;
    return n;
  };

  return [
    ['extra: drawing: a crate put down shows on screen, and paint put on it shows there the next frame', () => {
      kit.reset();
      const cam = { x: r.camX, y: r.camY, zoom: r.zoom };
      try {
        r.camX = 0;
        r.camY = 1;
        r.zoom = r.targetZoom = 64;
        const empty = grab(0, 0.5, 120, 120);
        const crate = kit.spawn('crate', 0, 0.5) as Prop;
        kit.advance(0.3);
        const drawn = grab(crate.main.x, crate.main.y, 120, 120);
        const n = changed(empty, drawn);
        // (a crate is 0.8 m across: at 64 px a metre, thousands of pixels)
        if (n < 1000) return `a crate in view changed ${n} pixels of the picture: it isn't drawn`;
        const before = reds(drawn);
        crate.main.paintAt(crate.main.x, crate.main.y, 0xff2020, 6);
        const painted = grab(crate.main.x, crate.main.y, 120, 120);
        const more = reds(painted) - before;
        if (more < 30) return `a red blot painted on the crate added ${more} red pixels to the picture`;
        return true;
      } finally {
        r.camX = cam.x;
        r.camY = cam.y;
        r.zoom = r.targetZoom = cam.zoom;
      }
    }],
  ];
}

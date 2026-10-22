import { RNG } from '../engine/math';

/** A color as 0xRRGGBB. */
export type Color = number;
export const CLEAR = -1;

export function hex(s: string): Color {
  return parseInt(s.replace('#', ''), 16);
}

export function rgb(c: Color): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

export function fromRgb(r: number, g: number, b: number): Color {
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return (cl(r) << 16) | (cl(g) << 8) | cl(b);
}

/** Multiplies a color's brightness. */
export function shade(c: Color, f: number): Color {
  const [r, g, b] = rgb(c);
  return fromRgb(r * f, g * f, b * f);
}

export function mix(a: Color, b: Color, t: number): Color {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return fromRgb(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function cssColor(c: Color, a = 1): string {
  const [r, g, b] = rgb(c);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/**
 * A tiny indexed raster used to author pixel-art sprites in code.
 * Row 0 is the TOP of the sprite. Pixels are 0xRRGGBB or CLEAR.
 */
export class PixelArt {
  readonly w: number;
  readonly h: number;
  readonly px: Int32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Int32Array(w * h).fill(CLEAR);
  }

  clone(): PixelArt {
    const p = new PixelArt(this.w, this.h);
    p.px.set(this.px);
    return p;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Color {
    return this.inside(x, y) ? this.px[y * this.w + x] : CLEAR;
  }

  filled(x: number, y: number): boolean {
    return this.get(x, y) !== CLEAR;
  }

  set(x: number, y: number, c: Color): this {
    x |= 0;
    y |= 0;
    if (this.inside(x, y)) this.px[y * this.w + x] = c;
    return this;
  }

  /** Sets only where the pixel is already filled. */
  paint(x: number, y: number, c: Color): this {
    if (this.filled(x, y)) this.set(x, y, c);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  /** Rect with only the existing filled pixels recolored. */
  paintRect(x: number, y: number, w: number, h: number, c: Color): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.paint(i, j, c);
    return this;
  }

  /** Rect with corners cut by `r` pixels (chamfered pixel corners). */
  roundRect(x: number, y: number, w: number, h: number, r: number, c: Color): this {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i : i >= w - r ? i - (w - r - 1) : 0;
        const dy = j < r ? r - j : j >= h - r ? j - (h - r - 1) : 0;
        if (dx + dy > r) continue;
        this.set(x + i, y + j, c);
      }
    }
    return this;
  }

  hline(x0: number, x1: number, y: number, c: Color): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: Color): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Filled ellipse fitting the given box. */
  ellipse(x: number, y: number, w: number, h: number, c: Color): this {
    const cx = x + w / 2 - 0.5;
    const cy = y + h / 2 - 0.5;
    const rx = w / 2;
    const ry = h / 2;
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const nx = (i - cx) / rx;
        const ny = (j - cy) / ry;
        if (nx * nx + ny * ny <= 1.0) this.set(i, j, c);
      }
    }
    return this;
  }

  /** Filled polygon via scanline (points in pixel coords). */
  poly(pts: [number, number][], c: Color): this {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[1] <= sy !== b[1] <= sy) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.set(x, y, c);
      }
    }
    return this;
  }

  /**
   * Paints a character map. Each char maps through `pal`; '.' and ' ' are skipped.
   */
  map(rows: string[], pal: Record<string, Color>, ox = 0, oy = 0): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === undefined) continue;
        this.set(ox + i, oy + j, c);
      }
    });
    return this;
  }

  /** Is (x,y) on the silhouette rim (4-neighbourhood touches empty)? */
  isRim(x: number, y: number): boolean {
    if (!this.filled(x, y)) return false;
    return !this.filled(x - 1, y) || !this.filled(x + 1, y) || !this.filled(x, y - 1) || !this.filled(x, y + 1);
  }

  /**
   * Top-left lighting: brightens pixels near the upper/left silhouette edge and
   * darkens pixels near the lower/right edge. Call before outline().
   */
  bevel(light = 1.14, dark = 0.84, depth = 2): this {
    const out = this.px.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (c === CLEAR) continue;
        let up = false;
        let down = false;
        for (let d = 1; d <= depth; d++) {
          if (!this.filled(x, y - d) || !this.filled(x - d, y)) up = true;
          if (!this.filled(x, y + d) || !this.filled(x + d, y)) down = true;
        }
        if (up && !down) out[y * this.w + x] = shade(c, light);
        else if (down && !up) out[y * this.w + x] = shade(c, dark);
      }
    }
    this.px.set(out);
    return this;
  }

  /** Darkens the silhouette rim to form an outline using each pixel's own hue. */
  outline(f = 0.55): this {
    const out = this.px.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isRim(x, y)) out[y * this.w + x] = shade(this.get(x, y), f);
      }
    }
    this.px.set(out);
    return this;
  }

  /** Random per-pixel brightness jitter for material texture. */
  noise(amount: number, seed: number, onlyColor?: Color): this {
    const rng = new RNG(seed);
    for (let i = 0; i < this.px.length; i++) {
      const c = this.px[i];
      const r = rng.next();
      if (c === CLEAR) continue;
      if (onlyColor !== undefined && c !== onlyColor) continue;
      this.px[i] = shade(c, 1 + (r * 2 - 1) * amount);
    }
    return this;
  }

  /** Multiplies every filled pixel. */
  tint(f: number): this {
    for (let i = 0; i < this.px.length; i++) if (this.px[i] !== CLEAR) this.px[i] = shade(this.px[i], f);
    return this;
  }

  flipX(): PixelArt {
    const p = new PixelArt(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) p.px[y * this.w + (this.w - 1 - x)] = this.px[y * this.w + x];
    return p;
  }

  /** Copies another art onto this one (CLEAR pixels skipped). */
  blit(src: PixelArt, ox: number, oy: number): this {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c !== CLEAR) this.set(ox + x, oy + y, c);
    }
    return this;
  }

  /** Renders to a canvas with a transparent border of `pad` pixels. */
  toCanvas(pad = 1, scale = 1): HTMLCanvasElement {
    const cw = (this.w + pad * 2) * scale;
    const ch = (this.h + pad * 2) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cw, ch);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (c === CLEAR) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const o = (((y + pad) * scale + sy) * cw + (x + pad) * scale + sx) * 4;
            img.data[o] = (c >> 16) & 255;
            img.data[o + 1] = (c >> 8) & 255;
            img.data[o + 2] = c & 255;
            img.data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

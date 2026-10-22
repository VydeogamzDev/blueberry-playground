import { PixelArt, CLEAR, rgb, fromRgb, shade, type Color } from './PixelArt';

/**
 * The shared palette. Every sprite is drawn from these five-step material ramps
 * (0 = outline/deepest shadow, 1 = shadow, 2 = base, 3 = light, 4 = highlight)
 * and finished with the same lighting pass, so all art shares one light
 * direction (top-left), one outline treatment and one contrast range.
 */
export type Ramp = readonly [Color, Color, Color, Color, Color];

const lookup = new Map<Color, { ramp: Ramp; level: number }>();

function toHsl(c: Color): [number, number, number] {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): Color {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (x: number) => {
    x = ((x % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return fromRgb(t(h / 360 + 1 / 3) * 255, t(h / 360) * 255, t(h / 360 - 1 / 3) * 255);
}

/** Moves hue `h` toward `target` by up to `deg` degrees. */
function hueToward(h: number, target: number, deg: number): number {
  let d = target - h;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(Math.abs(d), deg);
}

/**
 * Builds a hue-shifted ramp around a base color: shadows drift cool and
 * saturated, highlights drift warm and soft.
 */
export function ramp(base: string, contrast = 1): Ramp {
  const c = parseInt(base.replace('#', ''), 16);
  const [h, s, l] = toHsl(c);
  const k = contrast;
  const mk = (dl: number, hueTarget: number, hueDeg: number, sMul: number) =>
    fromHsl(s < 0.04 ? h : hueToward(h, hueTarget, hueDeg), s * sMul, dl);
  const r: Ramp = [
    mk(l * (1 - 0.6 * k), 245, 12, 0.78),
    mk(l * (1 - 0.27 * k), 245, 6, 0.9),
    c,
    mk(Math.min(0.92, l + (0.16 * l + 0.035) * k), 55, 5, 0.94),
    mk(Math.min(0.95, l + (0.34 * l + 0.08) * k), 55, 10, 0.84),
  ];
  r.forEach((col, level) => {
    if (!lookup.has(col)) lookup.set(col, { ramp: r, level });
  });
  return r;
}

/** Shifts a palette color along its ramp (falls back to brightness scaling). */
export function step(c: Color, d: number): Color {
  const e = lookup.get(c);
  if (!e) return shade(c, d > 0 ? 1 + 0.16 * d : 1 + 0.22 * d);
  return e.ramp[Math.max(0, Math.min(4, e.level + d))];
}

export function levelOf(c: Color): number {
  return lookup.get(c)?.level ?? 2;
}

// ---------------------------------------------------------------- materials

export const SKIN = ramp('#c39274', 0.85);
export const HAIR = ramp('#5a3d2b', 1.05);
export const SHIRT = ramp('#6a7f8e');
export const PANTS = ramp('#3f4a63');
export const SHOE = ramp('#4a382e');
export const LEATHER = ramp('#5c3f2c');
export const EYE_C = 0x1c1412;

export const WOOD = ramp('#9a6a40');
export const WOOD_PALE = ramp('#b98d5c');
export const WOOD_DARK = ramp('#6b4429');
export const STEEL = ramp('#7f8a94');
export const STEEL_LT = ramp('#a3adb5');
export const GUNMETAL = ramp('#4a515a', 1.1);
export const POLYMER = ramp('#3d3936', 1.1);
export const BRASS = ramp('#b38b3c');
export const COPPER = ramp('#a8603a');
export const CONCRETE = ramp('#808285');
export const BRICK = ramp('#94493a');
export const RUBBER = ramp('#2f3034', 1.2);
export const OLIVE = ramp('#56613b');
export const KHAKI = ramp('#b2a47c');
export const RED = ramp('#a8392d');
export const BLUE_PAINT = ramp('#4c6d82');
export const YELLOW = ramp('#d0a93a');
export const ORANGE = ramp('#cc7a2c');
export const GLASS = ramp('#93c3cf', 0.8);
export const WHITE = ramp('#d8d4ca', 0.8);
export const ROBOT = ramp('#8d98a3');
export const ROBOT_DK = ramp('#4c545e', 1.1);
export const GLOW = 0x6ee0ec;
export const LAMP = 0xfff0b0;
export const LED_RED = 0xe0483a;
export const LED_GREEN = 0x58c45a;

// ---------------------------------------------------------------- finishing

export interface FinishOpts {
  /** Darkest-step outline around the silhouette (default true). */
  outline?: boolean;
  /** One-pixel lit band just inside the top/left outline (default true). */
  light?: boolean;
  /** One-pixel shaded band just inside the bottom/right outline (default true). */
  shadow?: boolean;
  /** Top/left rim uses step 1 instead of 0 for a softer silhouette (default true). */
  soft?: boolean;
}

/**
 * The common lighting pass every sprite goes through: selective outline in each
 * pixel's own ramp, a top-left highlight and a bottom-right shadow band.
 * Pixels whose color is not in a ramp are treated with brightness scaling.
 */
export function finish(a: PixelArt, o: FinishOpts = {}): PixelArt {
  const outline = o.outline ?? true;
  const light = o.light ?? true;
  const shadow = o.shadow ?? true;
  const soft = o.soft ?? true;
  const out = a.px.slice();
  const rim = (x: number, y: number) => a.isRim(x, y);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const c = a.get(x, y);
      if (c === CLEAR) continue;
      const i = y * a.w + x;
      if (rim(x, y)) {
        if (!outline) continue;
        // which side of the silhouette is this rim pixel on?
        const lit = !a.filled(x, y - 1) || !a.filled(x - 1, y);
        const dark = !a.filled(x, y + 1) || !a.filled(x + 1, y);
        const toLevel = soft && lit && !dark ? 1 : 0;
        const e = lookup.get(c);
        out[i] = e ? e.ramp[Math.min(e.level, toLevel)] : shade(c, toLevel ? 0.7 : 0.5);
        continue;
      }
      const nearLit = rim(x, y - 1) || rim(x - 1, y);
      const nearDark = rim(x, y + 1) || rim(x + 1, y);
      // thin areas only get the highlight, so they don't turn to mud
      if (light && nearLit && !(nearDark && !shadow)) {
        if (!nearDark || shadow === false) out[i] = step(c, 1);
        else out[i] = c;
      } else if (shadow && nearDark && !nearLit) {
        out[i] = step(c, -1);
      }
    }
  }
  a.px.set(out);
  return a;
}

/** Depth tint for limbs on the far side of a body. */
export function farSide(a: PixelArt): PixelArt {
  const b = a.clone();
  for (let i = 0; i < b.px.length; i++) {
    const c = b.px[i];
    if (c === CLEAR) continue;
    const [r, g, bl] = rgb(c);
    b.px[i] = fromRgb(r * 0.7, g * 0.72, bl * 0.8);
  }
  return b;
}

/** Character-map painting with explicit palette entries. */
export function draw(w: number, h: number, rows: string[], pal: Record<string, Color>): PixelArt {
  const a = new PixelArt(w, h);
  a.map(rows, pal);
  return a;
}

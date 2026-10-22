import { PixelArt, type Color } from './PixelArt';
import {
  finish, GUNMETAL, POLYMER, STEEL, STEEL_LT, RED, YELLOW, GLASS, WHITE, RUBBER, LAMP, LED_RED, LED_GREEN, BLUE_PAINT,
} from './palette';

// Devices, the car and energy weapons. Same rules as every other sprite: palette
// ramps, finish() for outline and lighting, one-pixel details painted afterwards.

const LED_OFF = GUNMETAL[0];

/** 3x5 glyphs for gate labels (IEC symbols). */
const GLYPHS: Record<string, string[]> = {
  '&': ['.XX..', 'X..X.', '.XX..', 'X..XX', '.XXX.'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '>': ['X..', '.X.', '..X', '.X.', 'X..'],
  '=': ['...', 'XXX', '...', 'XXX', '...'],
};

function glyph(a: PixelArt, ch: string, x: number, y: number, c: Color): void {
  a.map(GLYPHS[ch], { X: c }, x, y);
}

/** A lever switch on a metal base; on = lever to the right, green LED. */
export function switchArt(on: boolean): PixelArt {
  const a = new PixelArt(14, 12);
  a.rect(0, 6, 14, 6, GUNMETAL[2]);
  a.rect(5, 5, 4, 2, GUNMETAL[1]);
  finish(a);
  // lever (two pixels wide) and its red knob
  const lever = on ? [[7, 5], [8, 4], [9, 3], [10, 2]] : [[6, 5], [5, 4], [4, 3], [3, 2]];
  for (const [x, y] of lever) a.set(x, y, STEEL_LT[2]).set(x + (on ? -1 : 1), y, STEEL_LT[3]);
  const kx = on ? 10 : 1;
  a.rect(kx, 0, 3, 3, RED[2]);
  a.set(kx, 0, RED[3]).set(kx + 2, 2, RED[1]);
  a.set(11, 9, on ? LED_GREEN : LED_OFF);
  a.set(2, 9, GUNMETAL[3]).set(5, 9, GUNMETAL[3]);
  return a;
}

/** A tripwire sensor looking right through its lens. */
export function sensorArt(active: boolean): PixelArt {
  const a = new PixelArt(12, 10);
  a.roundRect(0, 1, 9, 8, 1, POLYMER[2]);
  a.rect(9, 2, 3, 6, GUNMETAL[2]);
  a.rect(2, 3, 4, 4, POLYMER[1]);
  finish(a);
  a.vline(11, 3, 6, active ? LED_RED : RED[1]);
  a.vline(10, 3, 6, GUNMETAL[1]);
  a.set(11, 3, active ? 0xffb0a0 : RED[2]);
  a.set(3, 4, active ? LED_RED : LED_OFF);
  return a;
}

/** A timer box with a clock face; the LED blinks on every tick. */
export function timerArt(blink: boolean): PixelArt {
  const a = new PixelArt(14, 12);
  a.rect(1, 0, 12, 12, YELLOW[2]);
  a.rect(0, 4, 1, 4, STEEL_LT[2]);
  a.rect(13, 4, 1, 4, STEEL_LT[2]);
  a.ellipse(3, 2, 8, 8, WHITE[2]);
  finish(a);
  // clock hands and rim
  a.vline(6, 3, 6, GUNMETAL[0]);
  a.hline(7, 8, 6, GUNMETAL[0]);
  a.set(6, 6, RED[1]);
  a.set(11, 1, blink ? LED_GREEN : LED_OFF);
  return a;
}

export type GateKind = 'and' | 'or' | 'not' | 'xor';

/** A logic chip: inputs on the left, output on the right, IEC label. */
export function gateArt(kind: GateKind, out: boolean): PixelArt {
  const a = new PixelArt(16, 12);
  a.rect(2, 0, 12, 12, POLYMER[2]);
  // pins
  a.rect(0, 2, 2, 2, STEEL_LT[2]);
  if (kind !== 'not') a.rect(0, 8, 2, 2, STEEL_LT[2]);
  a.rect(14, 5, 2, 2, STEEL_LT[2]);
  finish(a);
  const ink = WHITE[3];
  if (kind === 'and') glyph(a, '&', 5, 4, ink);
  else if (kind === 'or') {
    glyph(a, '>', 4, 3, ink);
    a.hline(4, 6, 9, ink);
    glyph(a, '1', 8, 4, ink);
  } else if (kind === 'xor') {
    glyph(a, '=', 4, 4, ink);
    glyph(a, '1', 8, 4, ink);
  } else {
    glyph(a, '1', 6, 4, ink);
    // inversion bubble on the output
    a.set(13, 5, WHITE[2]).set(13, 6, WHITE[2]);
  }
  a.set(12, 1, out ? LED_GREEN : LED_OFF);
  return a;
}

/** Piston cylinder: mounting plate on the left, the rod comes out on the right. */
export function pistonBaseArt(): PixelArt {
  const a = new PixelArt(40, 12);
  a.rect(0, 0, 4, 12, GUNMETAL[2]);
  a.rect(4, 2, 34, 8, STEEL[2]);
  a.rect(37, 1, 3, 10, GUNMETAL[2]);
  a.hline(5, 36, 3, STEEL[3]);
  a.hline(5, 36, 4, STEEL[4]);
  a.hline(5, 36, 8, STEEL[1]);
  for (const x of [12, 24]) a.vline(x, 2, 9, STEEL[1]);
  finish(a);
  for (const y of [2, 9]) a.set(1, y, STEEL_LT[3]);
  a.rect(30, 5, 4, 2, YELLOW[2]);
  return a;
}

/** Piston rod with its pusher plate (plate on the right). */
export function pistonRodArt(): PixelArt {
  const a = new PixelArt(44, 14);
  a.rect(0, 5, 37, 4, STEEL_LT[2]);
  a.rect(37, 0, 7, 14, GUNMETAL[2]);
  a.hline(0, 36, 6, STEEL_LT[4]);
  finish(a);
  for (const y of [2, 11]) a.set(40, y, STEEL_LT[3]);
  return a;
}

/** Side view of a small hatchback, facing right (headlight on the right). */
export function carBodyArt(): PixelArt {
  const W = 76;
  const a = new PixelArt(W, 26);
  const P = RED;
  // lower body
  a.roundRect(0, 11, W, 11, 2, P[2]);
  // cabin
  a.poly([[13, 12], [22, 1], [50, 1], [62, 12]], P[2]);
  // windows
  a.poly([[17, 11], [24, 3], [35, 3], [35, 11]], GLASS[2]);
  a.poly([[38, 11], [38, 3], [49, 3], [57, 11]], GLASS[2]);
  // wheel arches
  for (const cx of [16, 60]) a.ellipse(cx - 9, 14, 18, 18, -1);
  // sills, bumpers and a door line
  a.rect(0, 17, 4, 4, GUNMETAL[2]);
  a.rect(W - 4, 17, 4, 4, GUNMETAL[2]);
  a.hline(26, 50, 18, P[1]);
  a.vline(37, 3, 20, P[1]);
  finish(a);
  a.hline(24, 34, 4, GLASS[4]);
  a.hline(39, 47, 4, GLASS[4]);
  a.rect(W - 3, 13, 2, 3, LAMP);
  a.rect(1, 13, 2, 3, LED_RED);
  a.set(33, 14, STEEL_LT[3]).set(34, 14, STEEL_LT[3]);
  a.set(47, 14, STEEL_LT[3]).set(48, 14, STEEL_LT[3]);
  return a;
}

/** Car wheel: tyre with a pressed-steel hub. */
export function carWheelArt(): PixelArt {
  const a = new PixelArt(16, 16);
  a.ellipse(0, 0, 16, 16, RUBBER[2]);
  a.ellipse(4, 4, 8, 8, STEEL[2]);
  a.ellipse(6, 6, 4, 4, STEEL[1]);
  finish(a);
  for (const [x, y] of [[7, 4], [11, 7], [8, 11], [4, 8]]) a.set(x, y, STEEL[0]);
  a.set(7, 7, STEEL_LT[3]);
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    a.set(Math.round(7.5 + Math.cos(t) * 6.6), Math.round(7.5 + Math.sin(t) * 6.6), RUBBER[1]);
  }
  return a;
}

/** Laser rifle pointing right: white shell, dark core, red emitter at the muzzle. */
export function laserRifleArt(): PixelArt {
  const a = new PixelArt(32, 9);
  a.rect(0, 1, 6, 4, WHITE[2]); // stock
  a.rect(6, 0, 18, 5, WHITE[2]); // body
  a.rect(24, 1, 6, 3, GUNMETAL[2]); // barrel shroud
  a.rect(30, 1, 2, 3, GUNMETAL[1]);
  a.rect(8, 5, 3, 4, POLYMER[2]); // grip
  a.rect(16, 5, 3, 2, POLYMER[2]); // fore grip
  a.rect(8, 2, 14, 2, BLUE_PAINT[1]); // core channel
  finish(a, { shadow: false });
  for (let x = 9; x < 21; x += 2) a.set(x, 2, 0x7fd8ff);
  a.set(31, 2, LED_RED).set(30, 2, RED[3]);
  a.set(25, 2, GUNMETAL[3]).set(27, 2, GUNMETAL[3]);
  return a;
}

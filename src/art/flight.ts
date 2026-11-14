import { PixelArt } from './PixelArt';
import { finish, GUNMETAL, STEEL, STEEL_LT, YELLOW, RED, BLUE_PAINT, COPPER, RUBBER, LED_GREEN, WHITE, OLIVE, POLYMER } from './palette';

// The flight parts (0.3.0): the mini and hover thrusters, the gyroscopes, the key
// trigger, the cockpit seat and the throttle lever. Same rules as every other sprite:
// palette ramps, finish() for outline and lighting, one-pixel details after.
// Everything faces right.

const LED_OFF = GUNMETAL[0];

/** Caches one sprite per key (the art is drawn once, however many there are). */
function cached<K>(make: (k: K) => PixelArt): (k: K) => PixelArt {
  const m = new Map<K, PixelArt>();
  return (k) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make(k)));
    return a;
  };
}

/** A small thruster: the big one's shape, a little over half its size. Pushes right. */
export function miniThrusterArt(): PixelArt {
  const a = new PixelArt(9, 6);
  a.rect(3, 1, 6, 4, GUNMETAL[3]);
  a.poly([[0, 0], [4, 1], [4, 5], [0, 6]], GUNMETAL[2]);
  finish(a);
  a.set(6, 2, YELLOW[2]).set(7, 2, YELLOW[2]);
  a.vline(0, 1, 4, COPPER[1]);
  return a;
}

/** Where a hover thruster's jets come out (art px, along its underside), and its width. */
export const HOVER_NOZZLE = { y: 9, x0: 3, x1: 15 };

/** A hover thruster: a flat pod, a grille of nozzles underneath blowing down; its light green when it holds. */
export const hoverThrusterArt = cached<boolean>((on) => {
  const a = new PixelArt(18, 10);
  a.roundRect(0, 1, 18, 6, 2, BLUE_PAINT[2]);
  a.rect(2, 6, 14, 3, GUNMETAL[2]);
  a.rect(3, 9, 12, 1, GUNMETAL[1]);
  finish(a);
  for (let x = 4; x < 15; x += 2) a.vline(x, 7, 9, GUNMETAL[0]);
  a.hline(2, 15, 2, BLUE_PAINT[3]);
  a.set(15, 3, on ? LED_GREEN : LED_OFF);
  return a;
});

/** The frames a gyroscope's disc turns through. */
export const GYRO_FRAMES = 4;

/** A gyroscope stabiliser: a disc spinning in a ring on a mounting plate (`big`: the industrial one). */
export const gyroArt = cached<string>((key) => {
  const [frame, big] = key.split(':').map(Number);
  const s = big ? 22 : 14;
  const a = new PixelArt(s, s);
  const m = big ? 3 : 2;
  a.rect(0, s - m, s, m, GUNMETAL[1]);
  a.ellipse(0, 0, s, s - m + 1, big ? OLIVE[2] : STEEL[2]);
  a.ellipse(m, m, s - 2 * m, s - 3 * m + 1, GUNMETAL[1]);
  finish(a);
  // the disc, edge on, its spokes turning
  const cx = (s - 1) / 2;
  const cy = (s - m) / 2;
  const r = s / 2 - m - 1;
  for (let k = 0; k < 3; k++) {
    const t = ((frame / GYRO_FRAMES) * (Math.PI * 2)) / 3 + (k * Math.PI * 2) / 3;
    const x = Math.round(cx + Math.cos(t) * r * 0.8);
    a.vline(x, Math.round(cy - r * 0.6), Math.round(cy + r * 0.6), STEEL_LT[3]);
  }
  a.set(Math.round(cx), Math.round(cy), COPPER[2]);
  if (big) {
    a.hline(2, s - 3, s - 2, YELLOW[2]);
    for (let x = 3; x < s - 3; x += 3) a.set(x, s - 2, GUNMETAL[0]);
  }
  return a;
});

/** A key trigger: a little box with one big key on top, lit while it's down. */
export const keyTriggerArt = cached<boolean>((down) => {
  const a = new PixelArt(12, 8);
  a.rect(0, 3, 12, 5, POLYMER[1]);
  a.roundRect(2, down ? 2 : 0, 8, down ? 2 : 4, 1, down ? YELLOW[3] : WHITE[3]);
  finish(a);
  a.hline(1, 10, 6, POLYMER[0]);
  a.set(10, 5, down ? LED_GREEN : LED_OFF);
  return a;
});

/** Where a cockpit's sitter's hips go (art px), and the stick's top. */
export const COCKPIT = { hips: [9, 12] as [number, number], w: 24, h: 22 };

/** A cockpit seat: a padded seat and back on a frame, a control stick ahead of it. Faces right. */
export function cockpitArt(): PixelArt {
  const a = new PixelArt(COCKPIT.w, COCKPIT.h);
  // the frame and floor
  a.rect(0, 18, 24, 4, GUNMETAL[2]);
  a.rect(4, 14, 10, 4, GUNMETAL[1]);
  // the seat and its back, leaning back a little
  a.roundRect(3, 12, 13, 3, 1, RUBBER[2]);
  a.poly([[0, 1], [4, 1], [6, 13], [2, 13]], RUBBER[2]);
  // the stick
  a.rect(19, 9, 2, 9, STEEL[2]);
  a.rect(18, 7, 4, 3, RUBBER[1]);
  finish(a);
  a.set(19, 7, RED[2]);
  a.vline(1, 3, 11, RUBBER[3]);
  a.hline(5, 14, 12, RUBBER[3]);
  a.set(22, 19, LED_GREEN);
  return a;
}

/** How far a throttle lever's handle can be pulled: its steps (shown). */
export const LEVER_STEPS = 5;

/** A throttle lever: a slotted quadrant, the handle forward (right) as far as it's pulled. */
export const throttleLeverArt = cached<number>((step) => {
  const a = new PixelArt(14, 14);
  a.rect(0, 10, 14, 4, GUNMETAL[2]);
  a.ellipse(1, 6, 12, 8, GUNMETAL[1]);
  a.rect(0, 10, 14, 4, GUNMETAL[2]);
  // the handle: from the pivot, back (left) at none to forward (right) at full
  const t = Math.PI * (0.85 - 0.7 * (step / (LEVER_STEPS - 1)));
  const px = 7;
  const py = 11;
  const ex = Math.round(px + Math.cos(t) * 8);
  const ey = Math.round(py - Math.sin(t) * 8);
  a.line(px, py, ex, ey, STEEL[2]);
  a.line(px - 1, py, ex - 1, ey, STEEL_LT[2]);
  a.rect(ex - 1, ey - 1, 3, 2, RED[2]);
  finish(a);
  a.set(12, 12, step > 0 ? LED_GREEN : LED_OFF);
  return a;
});

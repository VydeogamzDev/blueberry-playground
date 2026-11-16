import { PixelArt } from './PixelArt';
import { finish, GUNMETAL, STEEL, STEEL_LT, YELLOW, RED, ORANGE, COPPER, RUBBER, LED_GREEN, LED_RED, WHITE, POLYMER, KHAKI, BLUE_PAINT } from './palette';

// The rocketry parts (0.4.0): fuel tanks, the decoupler, parachutes, landing legs,
// boosters, small and swivelling thrusters, the heat shield, fins and flaps, the launch
// clamp and the docking port. Same rules as every other sprite: palette ramps,
// finish() for outline and lighting, one-pixel details after. Engines push right.

const LED_OFF = GUNMETAL[0];

/** Caches one sprite per key (the art is drawn once, however many there are). */
export function cached<K>(make: (k: K) => PixelArt): (k: K) => PixelArt {
  const m = new Map<K, PixelArt>();
  return (k) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make(k)));
    return a;
  };
}

/** Fuel tank sizes (art px). */
export const TANK = { small: { w: 12, h: 24 }, big: { w: 20, h: 44 } };

/** A fuel tank: a white cylinder standing up, an orange band, its valve on top. */
export const fuelTankArt = cached<'small' | 'big'>((size) => {
  const { w, h } = TANK[size];
  const a = new PixelArt(w, h);
  a.roundRect(0, 2, w, h - 4, 3, WHITE[2]);
  a.rect(1, 0, w - 2, 3, WHITE[3]);
  a.rect(1, h - 3, w - 2, 3, WHITE[1]);
  const band = Math.floor(h * 0.4);
  a.rect(0, band, w, Math.max(2, Math.floor(h / 10)), ORANGE[2]);
  a.rect(Math.floor(w / 2) - 1, 0, 2, 2, GUNMETAL[2]);
  finish(a);
  a.vline(2, 4, h - 5, WHITE[4]);
  return a;
});

/** A decoupler: a thin plate in hazard stripes, bolts along it. */
/** A decoupler: a steel band striped yellow, `w` × `h` (any size: it's resizable). */
export function decouplerArt(w = 32, h = 5): PixelArt {
  const a = new PixelArt(w, h);
  a.rect(0, 0, w, h, GUNMETAL[2]);
  finish(a);
  const mid = Math.max(1, Math.floor(h / 2) - 1);
  for (let x = 1; x < w - 1; x++) if (Math.floor((x + 1) / 3) % 2 === 0) for (let y = Math.max(1, mid - Math.floor((h - 5) / 2)); y <= Math.min(h - 2, mid + 1); y++) a.set(x, y, y === mid + 1 ? YELLOW[2] : YELLOW[3]);
  if (h >= 4) for (let x = 3; x < w; x += 7) a.set(x, h - 2, STEEL_LT[2]);
  return a;
}

/** A parachute pack: an orange bag with its ripcord handle (`worn`: a harness pack, smaller). */
export const parachutePackArt = cached<boolean>((worn) => {
  const w = worn ? 9 : 14;
  const h = worn ? 11 : 9;
  const a = new PixelArt(w, h);
  a.roundRect(0, 0, w, h, 2, ORANGE[2]);
  a.rect(1, h - 2, w - 2, 2, POLYMER[2]);
  finish(a);
  a.set(Math.floor(w / 2), 1, RED[3]).set(Math.floor(w / 2), 2, RED[2]);
  return a;
});

/** A parachute's canopy (open): a wide dome in alternating panels. `big`: the heavy one. */
export const canopyArt = cached<boolean>((big) => {
  const w = big ? 120 : 72;
  const h = big ? 34 : 22;
  const a = new PixelArt(w, h);
  a.ellipse(0, 0, w, h * 2, ORANGE[2]);
  // (the bottom half of the ellipse cut away: a dome)
  for (let y = h; y < h * 2; y++) for (let x = 0; x < w; x++) if (a.inside(x, y)) a.set(x, y, -1);
  const panels = big ? 8 : 6;
  for (let x = 0; x < w; x++) if (Math.floor((x / w) * panels) % 2) for (let y = 0; y < h; y++) if (a.filled(x, y)) a.set(x, y, WHITE[2]);
  finish(a);
  return a;
});

/** A landing leg: its mount (welded on) and its strut, folded or not; `wheel`: landing gear, a wheel at its foot. */
export const LEG = { mount: { w: 8, h: 8 }, strut: { w: 40, h: 5 }, foot: { w: 12, h: 4 } };

export function legMountArt(): PixelArt {
  const a = new PixelArt(LEG.mount.w, LEG.mount.h);
  a.roundRect(0, 0, 8, 8, 2, GUNMETAL[2]);
  finish(a);
  a.set(4, 4, STEEL_LT[3]);
  return a;
}

/** The strut: a long piston, its foot pad at the far end (right). */
export const legStrutArt = cached<boolean>((wheel) => {
  const { w, h } = LEG.strut;
  const a = new PixelArt(w, h + (wheel ? 0 : 4));
  a.rect(0, 0, w - (wheel ? 2 : 6), h, STEEL[2]);
  a.rect(0, 0, Math.floor(w * 0.45), h, GUNMETAL[2]);
  if (!wheel) a.rect(w - 8, 0, 8, h + 4, RUBBER[2]);
  finish(a);
  a.hline(2, Math.floor(w * 0.45) - 2, 1, GUNMETAL[3]);
  return a;
});

/** A landing gear wheel. */
export function gearWheelArt(): PixelArt {
  const a = new PixelArt(12, 12);
  a.ellipse(0, 0, 12, 12, RUBBER[2]);
  a.ellipse(3, 3, 6, 6, STEEL[2]);
  finish(a);
  a.set(6, 6, GUNMETAL[1]);
  return a;
}

/** A solid booster: a long white tube, a nose cap, its nozzle at the left (it pushes right). */
export function boosterArt(): PixelArt {
  const w = 52;
  const h = 10;
  const a = new PixelArt(w, h);
  a.rect(5, 0, w - 11, h, WHITE[2]);
  a.poly([[w - 6, 0], [w, 3], [w, 7], [w - 6, h]], WHITE[3]);
  a.poly([[0, 1], [6, 2], [6, 8], [0, 9]], GUNMETAL[2]);
  a.rect(18, 0, 3, h, RED[2]);
  finish(a);
  a.hline(7, w - 8, 2, WHITE[4]);
  return a;
}

/** A small turning thruster (cold gas): a little block with a nozzle each way it can puff (right). */
export function rcsArt(): PixelArt {
  const a = new PixelArt(8, 6);
  a.rect(0, 0, 6, 6, STEEL[2]);
  a.rect(5, 2, 3, 2, GUNMETAL[2]);
  finish(a);
  a.set(2, 2, LED_GREEN);
  return a;
}

/** A swivelling thruster: the big thruster's body on a gimbal ring, its bell nozzle on the left. */
export function gimbalThrusterArt(): PixelArt {
  const a = new PixelArt(18, 12);
  a.rect(6, 2, 12, 8, GUNMETAL[3]);
  a.poly([[0, 0], [7, 3], [7, 9], [0, 12]], COPPER[2]);
  a.rect(5, 1, 2, 10, STEEL[2]);
  finish(a);
  a.set(12, 4, YELLOW[2]).set(13, 4, YELLOW[2]);
  return a;
}

/** A heat shield: a shallow curved plate, dark and pitted. */
export function heatShieldArt(): PixelArt {
  const w = 40;
  const a = new PixelArt(w, 7);
  a.poly([[0, 6], [4, 2], [12, 0], [28, 0], [36, 2], [40, 6], [40, 7], [0, 7]], POLYMER[1]);
  finish(a);
  a.noise(0.25, 7, POLYMER[1]);
  return a;
}

/** A fin: a swept triangle, its root along the bottom. */
export function finArt(): PixelArt {
  const a = new PixelArt(24, 16);
  a.poly([[0, 16], [8, 0], [14, 0], [24, 16]], RED[2]);
  finish(a);
  return a;
}

/** A control flap: its hinge block and the flap itself (`plane`: a wider, paler elevator). */
export const flapMountArt = (): PixelArt => {
  const a = new PixelArt(6, 6);
  a.roundRect(0, 0, 6, 6, 2, GUNMETAL[2]);
  finish(a);
  a.set(3, 3, STEEL_LT[3]);
  return a;
};

export const flapArt = cached<boolean>((plane) => {
  const w = plane ? 36 : 24;
  const a = new PixelArt(w, 4);
  a.poly([[0, 0], [w, 1], [w, 3], [0, 4]], plane ? STEEL_LT[2] : RED[2]);
  finish(a);
  return a;
});

/** A launch clamp: a tower arm with a jaw at its end (closed, or open once it's let go). */
export const clampArt = cached<boolean>((open) => {
  const a = new PixelArt(16, 20);
  a.rect(0, 0, 6, 20, RED[1]);
  for (let y = 2; y < 19; y += 4) a.line(0, y, 5, y + 3, RED[2]);
  a.rect(6, 6, open ? 5 : 10, 4, GUNMETAL[2]);
  a.rect(open ? 10 : 14, 4, 2, 8, GUNMETAL[3]);
  finish(a);
  a.set(3, 1, open ? LED_GREEN : LED_RED);
  return a;
});

/** A docking port: a squat ring, its face (right) ridged; its light green while docked. */
export const dockingPortArt = cached<boolean>((docked) => {
  const a = new PixelArt(8, 18);
  a.rect(0, 1, 6, 16, STEEL[2]);
  a.rect(5, 0, 3, 18, STEEL_LT[2]);
  finish(a);
  for (let y = 2; y < 17; y += 3) a.set(6, y, GUNMETAL[1]);
  a.set(2, 8, docked ? LED_GREEN : LED_OFF);
  return a;
});

/** A spacesuit helmet (worn): a round white helmet with a gold visor. */
export function helmetArt(): PixelArt {
  const a = new PixelArt(10, 10);
  a.ellipse(0, 0, 10, 10, WHITE[2]);
  a.ellipse(4, 2, 6, 5, YELLOW[3]);
  finish(a);
  return a;
}

/** An oxygen tank (a person's, or a capsule's): a small blue bottle. */
export function oxygenTankArt(): PixelArt {
  const a = new PixelArt(6, 14);
  a.roundRect(0, 2, 6, 12, 2, BLUE_PAINT[2]);
  a.rect(2, 0, 2, 3, GUNMETAL[2]);
  finish(a);
  a.vline(1, 4, 11, BLUE_PAINT[3]);
  return a;
}

/** An ejection seat (a cockpit seat's size and shape: see art/flight COCKPIT): its rocket pack under the frame, the yellow-and-black pull handle over its back. */
export function ejectionSeatArt(): PixelArt {
  const a = new PixelArt(24, 22);
  a.rect(0, 18, 24, 4, GUNMETAL[2]);
  a.rect(4, 14, 10, 4, YELLOW[1]);
  a.roundRect(3, 12, 13, 3, 1, KHAKI[1]);
  a.poly([[0, 1], [4, 1], [6, 13], [2, 13]], KHAKI[1]);
  a.rect(19, 9, 2, 9, STEEL[2]);
  a.rect(18, 7, 4, 3, RUBBER[1]);
  finish(a);
  a.set(1, 0, YELLOW[2]).set(2, 0, RUBBER[1]).set(3, 0, YELLOW[2]);
  a.set(19, 7, RED[2]);
  for (let x = 5; x < 13; x += 2) a.set(x, 16, RUBBER[1]);
  return a;
}

/** A capsule seat: sealed in (a cockpit seat's size and shape), white, its oxygen bottle behind the back. */
export function capsuleSeatArt(): PixelArt {
  const a = new PixelArt(24, 22);
  a.rect(0, 18, 24, 4, WHITE[1]);
  a.rect(4, 14, 10, 4, WHITE[2]);
  a.roundRect(3, 12, 13, 3, 1, POLYMER[2]);
  a.poly([[0, 1], [4, 1], [6, 13], [2, 13]], POLYMER[2]);
  a.rect(19, 9, 2, 9, STEEL[2]);
  a.rect(18, 7, 4, 3, RUBBER[1]);
  finish(a);
  a.set(19, 7, RED[2]);
  a.set(22, 19, LED_GREEN).set(20, 19, BLUE_PAINT[3]);
  return a;
}

/** A camera part: a small boxy camera, its lens on the right (the way it looks). */
export function cameraArt(): PixelArt {
  const a = new PixelArt(12, 8);
  a.roundRect(0, 1, 9, 7, 1, GUNMETAL[2]);
  a.rect(8, 2, 4, 5, GUNMETAL[3]);
  a.rect(2, 0, 3, 2, GUNMETAL[1]);
  finish(a);
  a.set(10, 4, BLUE_PAINT[4]).set(11, 4, BLUE_PAINT[3]);
  a.set(2, 3, LED_RED);
  return a;
}

/** A screen part's size (art px) and the picture's window in it. */
export const SCREEN = { w: 32, h: 22, x: 2, y: 2, iw: 28, ih: 16 };

/** A screen part: a dark bezel on a little stand, the picture inside it (drawn over it, live). */
export function screenArt(): PixelArt {
  const a = new PixelArt(SCREEN.w, SCREEN.h);
  a.roundRect(0, 0, SCREEN.w, 20, 1, GUNMETAL[1]);
  a.rect(SCREEN.x, SCREEN.y, SCREEN.iw, SCREEN.ih, POLYMER[0]);
  a.rect(13, 20, 6, 2, GUNMETAL[2]);
  finish(a);
  a.set(29, 18, LED_GREEN);
  return a;
}

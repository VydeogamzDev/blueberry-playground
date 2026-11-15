import { PixelArt } from './PixelArt';
import { finish, GUNMETAL, STEEL, STEEL_LT, RED, YELLOW, WHITE, LED_GREEN, BLUE_PAINT, ORANGE, RUBBER, GLASS, BRASS, POLYMER, OLIVE, WOOD_DARK, ramp } from './palette';

// Parts for home-made vehicles (0.4.0): the engine and gearbox, the suspension strut, the
// nitro bottle, the tow hitch, the headlight and the horn; the boat's, the plane's and the
// rails' parts. Everything faces right.

const LED_OFF = GUNMETAL[0];

function cached<K>(make: (k: K) => PixelArt): (k: K) => PixelArt {
  const m = new Map<K, PixelArt>();
  return (k) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make(k)));
    return a;
  };
}

/** An engine block: a rocker cover, an air filter, an exhaust stub out the right; its lamp lit running (`key` 0 off, 1/2 running frames). */
export const engineArt = cached<number>((key) => {
  const a = new PixelArt(22, 14);
  a.rect(1, 4, 18, 10, GUNMETAL[2]);
  a.rect(2, 1, 14, 4, RED[2]);
  a.rect(5, 0, 6, 2, STEEL[2]);
  a.rect(19, 8, 3, 2, STEEL[1]);
  finish(a);
  for (let x = 3; x < 18; x += 3) a.vline(x, 6, 12, GUNMETAL[0]);
  a.hline(3, 14, 2, RED[3]);
  a.set(17, 5, key ? (key === 2 ? 0x9aff8a : LED_GREEN) : LED_OFF);
  return a;
});

/** A suspension strut's top: a mount plate and the spring's coils. */
export function strutTopArt(): PixelArt {
  const a = new PixelArt(10, 18);
  a.rect(0, 0, 10, 3, GUNMETAL[2]);
  a.rect(3, 3, 4, 15, STEEL[1]);
  finish(a);
  for (let y = 4; y < 17; y += 2) a.hline(1, 8, y, YELLOW[2]);
  return a;
}

/** A suspension strut's rod: a chrome shaft with an eye at the bottom for the wheel. */
export function strutRodArt(): PixelArt {
  const a = new PixelArt(6, 16);
  a.rect(2, 0, 2, 12, STEEL_LT[3]);
  a.rect(0, 11, 6, 5, GUNMETAL[2]);
  finish(a);
  a.set(2, 13, GUNMETAL[0]).set(3, 13, GUNMETAL[0]);
  return a;
}

/** A nitro bottle: a blue cylinder with a valve; `key` its fill (0 empty .. 4 full). */
export const nitroArt = cached<number>((fill) => {
  const a = new PixelArt(20, 8);
  a.roundRect(0, 1, 17, 6, 2, BLUE_PAINT[2]);
  a.rect(17, 3, 3, 2, BRASS[2]);
  finish(a);
  a.hline(2, 14, 2, BLUE_PAINT[4]);
  a.map(['X.X.X', 'XXX.X', 'X.X.X'], { X: WHITE[3] }, 4, 3);
  for (let i = 0; i < 4; i++) a.set(11 + i, 5, i < fill ? 0x6ae4ff : GUNMETAL[1]);
  return a;
});

/** A tow hitch: a bracket and a ball; the ball green-ringed while it's hitched. */
export const hitchArt = cached<boolean>((hitched) => {
  const a = new PixelArt(14, 8);
  a.rect(0, 2, 9, 4, GUNMETAL[2]);
  a.rect(8, 3, 2, 2, STEEL[2]);
  a.ellipse(10, 1, 4, 5, STEEL_LT[2]);
  finish(a);
  if (hitched) a.set(12, 0, LED_GREEN).set(13, 3, LED_GREEN);
  return a;
});

/** A headlight: a chrome bezel round a lens, lit or not. */
export const headlightArt = cached<boolean>((lit) => {
  const a = new PixelArt(8, 10);
  a.rect(0, 1, 4, 8, GUNMETAL[2]);
  a.ellipse(3, 0, 5, 10, STEEL_LT[2]);
  a.ellipse(4, 1, 3, 8, lit ? 0xfff6c0 : GLASS[1]);
  finish(a);
  if (lit) a.set(5, 3, WHITE[4]).set(5, 4, WHITE[4]);
  return a;
});

/** A horn: a trumpet bell on a little body. */
export function hornArt(): PixelArt {
  const a = new PixelArt(14, 8);
  a.rect(0, 2, 5, 4, POLYMER[2]);
  a.poly([[5, 3], [13, 0], [13, 7], [5, 5]], YELLOW[2]);
  finish(a);
  a.vline(12, 1, 6, YELLOW[4]);
  return a;
}

/** A g-meter: a round dial on a chip, its needle at `key` (0 .. 8: up to 8 g). */
export const gmeterArt = cached<number>((g) => {
  const a = new PixelArt(14, 14);
  a.ellipse(0, 0, 14, 14, GUNMETAL[2]);
  a.ellipse(2, 2, 10, 10, 0x14181c);
  finish(a);
  const ang = Math.PI * (1.25 - (Math.min(8, g) / 8) * 1.5);
  for (let r = 0; r < 4; r++) a.set(Math.round(7 + Math.cos(ang) * r), Math.round(7 - Math.sin(ang) * r), r > 2 ? RED[3] : WHITE[4]);
  a.set(7, 7, WHITE[3]);
  return a;
});

/** A boat propeller on its shaft housing (facing right: the blades at the back, on the left), blades blurred while it turns. */
export const boatPropArt = cached<number>((frame) => {
  const a = new PixelArt(18, 14);
  a.rect(6, 5, 12, 4, GUNMETAL[2]);
  a.rect(4, 6, 2, 2, BRASS[1]);
  if (frame === 0) {
    a.poly([[1, 1], [4, 0], [4, 6], [3, 6]], BRASS[2]);
    a.poly([[3, 8], [4, 8], [4, 14], [1, 13]], BRASS[2]);
  } else a.rect(1, 1, 3, 12, BRASS[1]);
  finish(a);
  return a;
});

/** An outboard motor: a cowled head on a long leg, the propeller at its foot. */
export const outboardArt = cached<boolean>((on) => {
  const a = new PixelArt(16, 26);
  a.roundRect(0, 0, 14, 9, 3, RED[2]);
  a.rect(5, 9, 4, 13, GUNMETAL[2]);
  a.rect(3, 20, 9, 3, GUNMETAL[1]);
  a.rect(12, 18, 3, 7, BRASS[2]);
  finish(a);
  a.hline(2, 11, 2, RED[4]);
  a.set(11, 4, on ? LED_GREEN : LED_OFF);
  return a;
});

const SAILCLOTH = ramp('#e9e2cf', 0.7);

/** A sail on its mast: `key` how full it is (-1 .. 1, which way the wind fills it). */
export const sailArt = cached<number>((full) => {
  const a = new PixelArt(26, 48);
  a.rect(2, 0, 2, 48, STEEL[1]);
  a.rect(2, 42, 22, 2, STEEL[1]);
  const bow = Math.round(full * 4);
  const pts: [number, number][] = [[4, 2], [4, 42], [23, 42]];
  // the leech, bellied out by the wind
  for (let y = 40; y > 2; y -= 4) pts.push([4 + Math.round(((y - 2) / 40) * 19) + Math.round(Math.sin(((y - 2) / 40) * Math.PI) * bow), y]);
  a.poly(pts, SAILCLOTH[2]);
  finish(a);
  a.line(4, 22, 14, 42, SAILCLOTH[1]);
  return a;
});

/** A ballast tank: a steel cylinder with a sight glass showing how full it is (`key` 0 .. 5). */
export const ballastArt = cached<number>((fill) => {
  const a = new PixelArt(24, 12);
  a.roundRect(0, 0, 24, 12, 4, STEEL[2]);
  finish(a);
  a.rect(4, 3, 16, 6, 0x1a2a34);
  a.rect(4, 3 + 6 - Math.round((fill / 5) * 6), 16, Math.round((fill / 5) * 6), 0x3b7ba8);
  a.hline(4, 19, 2, STEEL[4]);
  return a;
});

/** An anchor: a ring, a shank, a stock and two flukes. */
export function anchorArt(): PixelArt {
  const a = new PixelArt(16, 20);
  a.ellipse(6, 0, 4, 4, GUNMETAL[2]);
  a.rect(7, 3, 2, 14, GUNMETAL[2]);
  a.rect(3, 5, 10, 2, GUNMETAL[2]);
  a.poly([[1, 13], [3, 13], [8, 18], [13, 13], [15, 13], [8, 20]], GUNMETAL[2]);
  finish(a);
  return a;
}

/** A helicopter rotor's mast and hub (the blades are their own part). */
export function rotorHubArt(): PixelArt {
  const a = new PixelArt(12, 14);
  a.rect(4, 4, 4, 10, GUNMETAL[2]);
  a.rect(0, 10, 12, 4, GUNMETAL[1]);
  a.ellipse(3, 0, 6, 6, STEEL[2]);
  finish(a);
  return a;
}

/** A helicopter rotor's blades seen side on: a long thin bar; blurred (`spin`) it's faint and long. */
export const rotorBladeArt = cached<boolean>((spin) => {
  const a = new PixelArt(96, 4);
  if (spin) {
    a.rect(0, 1, 96, 2, 0x5a6068);
    for (let x = 0; x < 96; x += 3) a.set(x, 1, 0x7a828a);
  } else {
    a.rect(0, 1, 96, 2, GUNMETAL[2]);
    a.rect(44, 0, 8, 4, STEEL[2]);
  }
  finish(a, { shadow: false });
  return a;
});

/** A wing seen side on: an aerofoil, round at the front, thin behind. */
export function wingArt(len = 64): PixelArt {
  const a = new PixelArt(len, 8);
  a.poly([[0, 4], [3, 1], [10, 0], [len - 1, 3], [len - 1, 5], [10, 7], [3, 7]], STEEL_LT[2]);
  finish(a);
  a.hline(4, len - 6, 2, STEEL_LT[4]);
  return a;
}

/** A flare dispenser: a box of tubes; `n` flares left (0 .. 6) shown as red caps. */
export const flareArt = cached<number>((n) => {
  const a = new PixelArt(14, 10);
  a.rect(0, 0, 14, 10, OLIVE[2]);
  finish(a);
  for (let i = 0; i < 6; i++) a.set(2 + (i % 3) * 4, 2 + Math.floor(i / 3) * 4, i < n ? RED[3] : GUNMETAL[0]);
  return a;
});

/** A bomb bay: a box with two doors underneath, open or shut. */
export const bombBayArt = cached<boolean>((open) => {
  const a = new PixelArt(30, 12);
  a.rect(0, 0, 30, 10, OLIVE[2]);
  if (!open) a.rect(1, 9, 28, 3, OLIVE[1]);
  else {
    a.rect(0, 9, 3, 3, OLIVE[1]);
    a.rect(27, 9, 3, 3, OLIVE[1]);
  }
  finish(a);
  a.hline(2, 27, 2, OLIVE[3]);
  return a;
});

/** An armour plate: thick steel, rivets round its edge. */
export function armourArt(w = 32, h = 8): PixelArt {
  const a = new PixelArt(w, h);
  a.rect(0, 0, w, h, ramp('#596068', 1.1)[2]);
  finish(a);
  for (let x = 2; x < w - 1; x += 5) {
    a.set(x, 1, STEEL_LT[3]);
    a.set(x, h - 2, STEEL_LT[3]);
  }
  return a;
}

/** A fire extinguisher: a red cylinder, a black hose and a handle. */
export function extinguisherArt(): PixelArt {
  const a = new PixelArt(10, 20);
  a.roundRect(1, 5, 7, 15, 2, RED[2]);
  a.rect(3, 2, 3, 3, GUNMETAL[2]);
  a.rect(5, 0, 5, 2, GUNMETAL[2]);
  a.vline(0, 6, 14, RUBBER[1]);
  finish(a);
  a.rect(2, 10, 5, 4, WHITE[3]);
  return a;
}

/** A rail wheel: a steel wheel with a flange. */
export function railWheelArt(): PixelArt {
  const a = new PixelArt(16, 16);
  a.ellipse(0, 0, 16, 16, STEEL[1]);
  a.ellipse(2, 2, 12, 12, STEEL[2]);
  a.ellipse(6, 6, 4, 4, GUNMETAL[2]);
  finish(a);
  return a;
}

/** A checkpoint gate: two posts and a banner, chequered; lit green once passed. */
export const checkpointArt = cached<boolean>((passed) => {
  const a = new PixelArt(40, 48);
  a.rect(0, 0, 3, 48, STEEL[2]);
  a.rect(37, 0, 3, 48, STEEL[2]);
  a.rect(0, 0, 40, 8, passed ? 0x3aa04a : ORANGE[2]);
  finish(a);
  for (let x = 3; x < 37; x += 4) for (let y = 1; y < 7; y += 3) a.rect(x + ((y / 3) % 2 ? 2 : 0), y, 2, 2, WHITE[3]);
  return a;
});

/** A helicopter rotor, side on: its mast and hub, and its blades seen as they turn (`frame` 0..3: their span foreshortened; 4: blurred). */
export const heliArt = cached<number>((frame) => {
  const a = new PixelArt(96, 16);
  a.rect(45, 6, 6, 10, GUNMETAL[2]);
  a.rect(40, 12, 16, 4, GUNMETAL[1]);
  a.rect(44, 3, 8, 4, STEEL[2]);
  const half = [46, 30, 8, 30][frame % 4];
  if (frame === 4) {
    a.rect(2, 4, 92, 1, 0x6a7078);
    for (let x = 2; x < 94; x += 4) a.set(x, 4, 0x8a929a);
  } else a.rect(48 - half, 3, half * 2, 2, GUNMETAL[2]);
  finish(a);
  return a;
});

/** An airbag: folded in its module (0), or burst out of it, a big pale cushion (1). */
export const airbagArt = cached<number>((open) => {
  const a = new PixelArt(24, 24);
  if (open) {
    a.ellipse(2, 0, 22, 22, 0xe8e4da);
    a.ellipse(5, 3, 14, 14, 0xf4f1ea);
  }
  a.rect(0, 16, 10, 8, GUNMETAL[2]);
  finish(a);
  a.rect(2, 18, 6, 1, open ? GUNMETAL[0] : YELLOW[2]);
  a.set(8, 22, open ? LED_OFF : LED_GREEN);
  return a;
});

/** A heat-seeker pod: a rail under a pylon, with its missiles on it (`n` 0 to 2). */
export const heatPodArt = cached<number>((n) => {
  const a = new PixelArt(32, 12);
  a.rect(8, 0, 14, 3, GUNMETAL[2]);
  a.rect(2, 3, 28, 2, GUNMETAL[1]);
  for (let i = 0; i < n; i++) {
    const y = 5 + i * 3;
    a.rect(2, y, 26, 3, WHITE[2]);
    a.rect(28, y, 3, 3, RED[2]);
    a.rect(0, y - 1 + (i ? 1 : 0), 3, 1, GUNMETAL[2]);
  }
  finish(a);
  return a;
});

/** A flare: a white-hot pellet. */
export function flarePelletArt(): PixelArt {
  const a = new PixelArt(4, 4);
  a.rect(0, 0, 4, 4, 0xfff4c0);
  a.rect(1, 1, 2, 2, 0xffffff);
  return a;
}

/** A finned aerial bomb, nose to the right. */
export function aerialBombArt(): PixelArt {
  const a = new PixelArt(28, 10);
  a.roundRect(5, 1, 22, 8, 4, OLIVE[2]);
  a.rect(0, 0, 6, 2, OLIVE[1]);
  a.rect(0, 8, 6, 2, OLIVE[1]);
  a.rect(0, 4, 6, 2, OLIVE[1]);
  finish(a);
  a.vline(20, 2, 7, YELLOW[2]);
  return a;
}

/** A claw: a motor housing on top, two jaws below, open or shut (the grip point between their tips, at CLAW_JAW). */
export const CLAW_JAW: [number, number] = [10, 21];
export const clawArt = cached<boolean>((shut) => {
  const a = new PixelArt(20, 24);
  a.rect(4, 0, 12, 7, YELLOW[2]);
  a.rect(8, 7, 4, 4, GUNMETAL[2]);
  const o = shut ? 0 : 3;
  // the jaws: down and in
  a.rect(5 - o, 10, 4, 3, GUNMETAL[2]);
  a.rect(11 + o, 10, 4, 3, GUNMETAL[2]);
  a.rect(4 - o, 12, 3, 9, STEEL[2]);
  a.rect(13 + o, 12, 3, 9, STEEL[2]);
  a.rect(6 - o, 20, 3, 3, STEEL[1]);
  a.rect(11 + o, 20, 3, 3, STEEL[1]);
  finish(a);
  a.hline(5, 14, 2, YELLOW[3]);
  return a;
});

/** A crane hook: a block with the rope's eye on top, the hook curling up at the bottom (its throat at HOOK_THROAT). */
export const HOOK_THROAT: [number, number] = [7, 19];
export function craneHookArt(): PixelArt {
  const a = new PixelArt(16, 26);
  a.rect(5, 0, 6, 3, STEEL[2]);
  a.rect(2, 3, 12, 8, YELLOW[2]);
  a.rect(7, 11, 3, 6, STEEL[2]);
  a.rect(3, 16, 3, 7, STEEL[2]);
  a.rect(3, 22, 9, 3, STEEL[2]);
  a.rect(10, 18, 3, 6, STEEL[2]);
  finish(a);
  for (let x = 3; x < 13; x += 3) a.vline(x, 4, 9, GUNMETAL[2]);
  return a;
}

/** A roller coaster car, facing right: a seat with a lap bar in a red tub, a rail wheel front and back (centres at COASTER_WHEELS, radius 7). */
export function coasterArt(): PixelArt {
  const a = new PixelArt(38, 32);
  // the wheels
  for (const x of [6, 32]) {
    a.ellipse(x - 7, 18, 14, 14, STEEL[1]);
    a.ellipse(x - 4, 21, 8, 8, STEEL[2]);
    a.ellipse(x - 1, 24, 2, 2, GUNMETAL[2]);
  }
  // the tub, the nose rounded
  a.rect(0, 14, 30, 8, RED[2]);
  a.roundRect(24, 9, 14, 13, 4, RED[2]);
  // the seat back and cushion
  a.poly([[0, 1], [4, 1], [6, 13], [2, 13]], RUBBER[2]);
  a.roundRect(3, 12, 13, 3, 1, RUBBER[2]);
  // the lap bar
  a.rect(18, 6, 2, 9, YELLOW[2]);
  a.rect(13, 6, 6, 2, YELLOW[2]);
  finish(a);
  a.hline(1, 36, 17, RED[3]);
  a.hline(1, 36, 21, RED[1]);
  return a;
}

/** A ramp, rising to the right: `w` × `h` px, timber on a steel frame. */
export function rampArt(w = 128, h = 40): PixelArt {
  const a = new PixelArt(w, h);
  a.poly([[0, h - 1], [w - 1, 0], [w - 1, h - 1]], WOOD_DARK[2]);
  finish(a);
  for (let x = 6; x < w - 2; x += 8) a.line(x, h - 1 - Math.floor((x / (w - 1)) * (h - 1)), x, h - 1, GUNMETAL[1]);
  a.line(0, h - 1, w - 1, 0, YELLOW[2]);
  return a;
}

/** A runway: `w` px of tarmac, a white dashed centre line, threshold stripes and lights at each end. */
export function runwayArt(w = 1280): PixelArt {
  const a = new PixelArt(w, 6);
  a.rect(0, 0, w, 6, 0x34373b);
  a.hline(0, w - 1, 0, 0x44484d);
  for (let x = 40; x < w - 40; x += 32) a.hline(x, x + 15, 2, 0xe6e6e0);
  for (const x0 of [6, w - 30]) for (let k = 0; k < 6; k++) a.rect(x0 + k * 4, 1, 2, 3, 0xe6e6e0);
  for (let x = 2; x < w; x += 64) a.set(x, 0, x < 64 || x > w - 70 ? LED_GREEN : 0xffd27a);
  return a;
}

/** A launch pad: a concrete slab with a flame trench, a steel service tower at its left end. */
export function launchPadArt(): PixelArt {
  const w = 256;
  const a = new PixelArt(w, 160);
  // the tower: a lattice
  a.rect(4, 0, 4, 144, GUNMETAL[2]);
  a.rect(28, 0, 4, 144, GUNMETAL[2]);
  for (let y = 4; y < 144; y += 12) {
    a.line(8, y, 28, y + 12, GUNMETAL[1]);
    a.line(28, y, 8, y + 12, GUNMETAL[1]);
  }
  a.rect(0, 0, 40, 4, RED[2]);
  a.rect(32, 40, 40, 3, GUNMETAL[2]);
  a.rect(32, 90, 40, 3, GUNMETAL[2]);
  // the slab, its trench in the middle
  a.rect(0, 144, w, 16, 0x8a8c8f);
  a.rect(120, 148, 56, 12, 0x3e4044);
  finish(a);
  a.hline(0, w - 1, 144, 0xa9abae);
  for (let x = 44; x < w; x += 24) a.set(x, 145, YELLOW[2]);
  return a;
}

/** A fuel pump: a red cabinet with a hose and nozzle, its screen lit while it fills something (`on`). */
export const fuelPumpArt = cached<boolean>((on) => {
  const a = new PixelArt(20, 44);
  a.rect(0, 40, 20, 4, 0x8a8c8f);
  a.rect(3, 4, 14, 36, RED[2]);
  a.rect(2, 0, 16, 5, WHITE[2]);
  a.rect(5, 9, 10, 6, on ? 0x9aff8a : 0x23302a);
  a.rect(17, 18, 2, 14, RUBBER[2]);
  a.rect(16, 30, 4, 3, GUNMETAL[2]);
  finish(a);
  a.rect(6, 20, 8, 2, YELLOW[2]);
  return a;
});

/** A race's start/finish gate: posts and a chequered banner (`lit`: just crossed). */
export const startGateArt = cached<boolean>((lit) => {
  const a = new PixelArt(40, 56);
  a.rect(0, 0, 3, 56, STEEL[2]);
  a.rect(37, 0, 3, 56, STEEL[2]);
  a.rect(0, 0, 40, 10, WHITE[3]);
  finish(a);
  for (let x = 1; x < 39; x += 4) for (let y = 1; y < 9; y += 4) {
    a.rect(x, y, 2, 2, 0x1c1c1c);
    a.rect(x + 2, y + 2, 2, 2, 0x1c1c1c);
  }
  if (lit) a.hline(3, 36, 9, LED_GREEN);
  return a;
});

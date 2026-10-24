import { PixelArt, type Color } from './PixelArt';
import type { AttachPoint } from '../world/Part';
import {
  finish, GUNMETAL, POLYMER, STEEL, STEEL_LT, RED, YELLOW, WHITE, LED_RED, LED_GREEN, BLUE_PAINT, COPPER, OLIVE,
  WOOD, WOOD_DARK, BRASS, GLASS, ORANGE, RUBBER, KHAKI,
} from './palette';

// The contraption toys: turrets, fans, the magnet and the tesla coil, the launch
// platform and the logic and timing parts. Same rules as every other sprite:
// palette ramps, finish() for outline and lighting, one-pixel details after.
// Everything faces right; wire inputs are on the left, outputs on the right.

const LED_OFF = GUNMETAL[0];

/** 3x5 digits, for the counter's display and the radios' channel. */
const DIGITS: string[][] = [
  ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  ['XXX', '..X', 'XXX', 'X..', 'XXX'],
  ['XXX', '..X', '.XX', '..X', 'XXX'],
  ['X.X', 'X.X', 'XXX', '..X', '..X'],
  ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  ['XXX', 'X..', 'XXX', 'X.X', 'XXX'],
  ['XXX', '..X', '..X', '.X.', '.X.'],
  ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
  ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
];

function digit(a: PixelArt, n: number, x: number, y: number, c: Color): void {
  a.map(DIGITS[((n % 10) + 10) % 10], { X: c }, x, y);
}

/** Caches one sprite per key (the art is drawn once, however many there are). */
function cached<K>(make: (k: K) => PixelArt): (k: K) => PixelArt {
  const m = new Map<K, PixelArt>();
  return (k) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make(k)));
    return a;
  };
}

// ------------------------------------------------------------------ turrets

/** What a turret's eye shows: off (dark), looking (green), on a target (red). */
export type TurretLook = 'off' | 'idle' | 'alert';

/** Where the head turns on a turret's base, and the head's own pivot, muzzle and ejection port (art px). */
export const TURRET = {
  basePivot: [10, 1] as [number, number],
  ceilingPivot: [10, 7] as [number, number],
  headPivot: [5, 5] as [number, number],
  muzzle: [22, 4] as [number, number],
  eject: [9, 1] as [number, number],
};

/** A squat armoured base on a foot plate; its head turns on the yoke on top. */
export function sentryBaseArt(laser = false): PixelArt {
  const a = new PixelArt(20, 12);
  const body = laser ? WHITE : GUNMETAL;
  a.rect(8, 0, 4, 3, STEEL[2]);
  a.rect(3, 2, 14, 7, body[2]);
  a.rect(1, 8, 18, 4, GUNMETAL[1]);
  // the band painted in its team's colour (olive when on none)
  a.rect(4, 4, 12, 2, laser ? BLUE_PAINT[2] : OLIVE[2]);
  finish(a);
  for (const x of [3, 16]) a.set(x, 10, STEEL_LT[3]);
  for (const x of [6, 8, 11, 13]) a.set(x, 7, body[0]);
  a.set(10, 1, GUNMETAL[0]);
  return a;
}

/** A mounting plate to fix to a ceiling, the head hanging from the yoke under it. */
export function ceilingBaseArt(): PixelArt {
  const a = new PixelArt(20, 8);
  a.rect(0, 0, 20, 3, STEEL[2]);
  a.rect(4, 3, 12, 3, GUNMETAL[2]);
  a.rect(8, 5, 4, 3, STEEL[2]);
  // the band painted in its team's colour
  a.rect(5, 4, 10, 1, OLIVE[2]);
  finish(a);
  for (const x of [2, 17]) a.set(x, 1, STEEL_LT[4]);
  a.set(10, 7, GUNMETAL[0]);
  return a;
}

/** A gun on a pivot with a sensor eye on top; the eye shows what it's doing. */
function drawTurretHead(look: TurretLook, laser: boolean): PixelArt {
  const a = new PixelArt(22, 10);
  const shell = laser ? WHITE : GUNMETAL;
  a.rect(2, 0, 5, 2, POLYMER[2]);
  a.roundRect(0, 1, 11, 8, 1, shell[2]);
  if (laser) {
    a.rect(11, 2, 8, 5, WHITE[2]);
    a.rect(19, 3, 3, 3, GUNMETAL[1]);
    a.rect(3, 4, 14, 2, BLUE_PAINT[1]);
  } else {
    a.rect(11, 3, 9, 3, STEEL[1]);
    a.rect(20, 3, 2, 3, GUNMETAL[1]);
  }
  finish(a, laser ? { shadow: false } : {});
  if (laser) {
    for (let x = 4; x < 17; x += 2) a.set(x, 4, 0x7fd8ff);
    a.set(21, 4, LED_RED).set(20, 4, RED[3]);
  } else {
    for (const x of [13, 15, 17]) a.set(x, 4, GUNMETAL[0]);
    a.set(21, 4, GUNMETAL[0]);
  }
  a.set(5, 5, STEEL_LT[3]);
  const eye = look === 'alert' ? LED_RED : look === 'idle' ? LED_GREEN : LED_OFF;
  a.set(4, 1, eye).set(5, 1, eye);
  return a;
}

const sentryHeads = cached<TurretLook>((l) => drawTurretHead(l, false));
const laserHeads = cached<TurretLook>((l) => drawTurretHead(l, true));

export function turretHeadArt(look: TurretLook, laser = false): PixelArt {
  return laser ? laserHeads(look) : sentryHeads(look);
}

// ------------------------------------------------------------------ fan and propeller

/** Frames of a turning rotor, seen edge on. */
export const ROTOR_FRAMES = 4;

/**
 * A blade turning about the axle at (x, cy), seen edge on: its visible span
 * goes from full to short and back, the near half lit and the far half shaded
 * by turns.
 */
function blade(a: PixelArt, x: number, cy: number, half: number, frame: number): void {
  const k = [1, 0.7, 0.35, 0.7][frame % ROTOR_FRAMES];
  const h = Math.max(1, Math.round(half * k));
  const near = frame < 2 ? STEEL_LT : STEEL;
  const far = frame < 2 ? STEEL : STEEL_LT;
  a.rect(x, cy - h, 2, h, near[3]);
  a.rect(x, cy, 2, h, far[2]);
  a.vline(x + 1, cy - h, cy + h - 1, near[1]);
}

/** Where a fan's and a propeller's blades are (art px): what they touch is cut and flung. */
export const FAN_BLADES = { x0: 14, x1: 18, y0: 0, y1: 20 };
export const PROP_BLADES = { x0: 13, x1: 16, y0: 0, y1: 30 };

/** A floor fan: a motor on a foot, the blades turning at its front. */
export const fanArt = cached<number>((frame) => {
  const a = new PixelArt(18, 20);
  a.rect(0, 17, 12, 3, GUNMETAL[1]);
  a.rect(4, 14, 4, 3, GUNMETAL[2]);
  a.roundRect(0, 4, 12, 11, 2, GUNMETAL[2]);
  a.rect(12, 8, 2, 3, STEEL[2]);
  a.rect(13, 7, 2, 5, STEEL_LT[2]);
  blade(a, 15, 10, 10, frame);
  finish(a);
  for (const x of [3, 5, 7, 9]) a.vline(x, 7, 12, GUNMETAL[1]);
  a.set(1, 6, YELLOW[3]);
  return a;
});

/** A propeller pod: a motor in a nacelle, the long blade at its nose. */
export const propellerArt = cached<number>((frame) => {
  const a = new PixelArt(16, 30);
  a.roundRect(0, 11, 11, 8, 2, BLUE_PAINT[2]);
  a.rect(10, 12, 2, 6, GUNMETAL[2]);
  a.rect(12, 13, 2, 4, STEEL_LT[2]);
  blade(a, 14, 15, 15, frame);
  finish(a);
  a.hline(2, 8, 14, BLUE_PAINT[3]);
  a.set(2, 16, YELLOW[3]).set(3, 16, YELLOW[3]);
  return a;
});

// ------------------------------------------------------------------ electromagnet and tesla coil

/** A lifting electromagnet: a copper coil in an iron case, the pole face underneath. */
export const magnetArt = cached<boolean>((on) => {
  const a = new PixelArt(22, 14);
  a.rect(8, 0, 6, 3, STEEL[2]);
  a.roundRect(0, 3, 22, 9, 1, GUNMETAL[2]);
  a.rect(2, 5, 18, 5, COPPER[2]);
  a.rect(1, 11, 20, 3, STEEL_LT[2]);
  finish(a);
  for (let x = 3; x < 20; x += 2) a.vline(x, 5, 9, COPPER[1]);
  a.set(10, 1, GUNMETAL[0]).set(11, 1, GUNMETAL[0]);
  a.set(19, 4, on ? 0x8fd8ff : LED_OFF);
  return a;
});

/** Where a tesla coil's arcs leap from: the top of its toroid (art px). */
export const TESLA_TOP: [number, number] = [8, 4];

/** A tesla coil: a copper-wound column on a base, a steel toroid on top. */
export const teslaArt = cached<boolean>((on) => {
  const a = new PixelArt(16, 40);
  a.rect(0, 36, 16, 4, GUNMETAL[1]);
  a.rect(2, 31, 12, 6, GUNMETAL[2]);
  a.rect(5, 10, 6, 22, COPPER[2]);
  a.rect(7, 0, 2, 4, STEEL[2]);
  a.ellipse(0, 3, 16, 8, STEEL_LT[2]);
  finish(a);
  for (let y = 12; y < 31; y += 2) a.hline(6, 9, y, COPPER[1]);
  // hazard stripes on the base
  for (let x = 3; x < 13; x += 3) a.set(x, 33, YELLOW[2]).set(x + 1, 34, YELLOW[2]);
  a.set(12, 32, on ? 0x8fd8ff : LED_OFF);
  if (on) a.set(5, 5, 0xd8f4ff).set(6, 4, 0xd8f4ff);
  return a;
});

// ------------------------------------------------------------------ launch platform

/** A sprung launch plate on a base: down, or popped up (fired). */
export const launchPadArt = cached<boolean>((up) => {
  const a = new PixelArt(40, 12);
  a.rect(1, 6, 38, 6, GUNMETAL[2]);
  for (const x of [6, 32]) a.rect(x, up ? 2 : 4, 2, up ? 4 : 2, STEEL_LT[2]);
  a.rect(0, up ? 0 : 3, 40, 3, STEEL[2]);
  finish(a);
  // hazard stripes along its front
  for (let x = 3; x < 37; x += 4) {
    a.set(x, 8, YELLOW[2]).set(x + 1, 8, YELLOW[2]).set(x + 1, 9, YELLOW[2]).set(x + 2, 9, YELLOW[2]);
  }
  a.hline(2, 37, up ? 1 : 4, STEEL[3]);
  return a;
});

// ------------------------------------------------------------------ logic and timing

/** A chip in a coloured case with a pin on each side (in on the left, out on the right). */
function chip(a: PixelArt, body: readonly Color[]): void {
  a.rect(2, 0, 12, 12, body[2]);
  a.rect(0, 5, 2, 2, STEEL_LT[2]);
  a.rect(14, 5, 2, 2, STEEL_LT[2]);
}

/** A delay box: an hourglass on its face; the LED lit while a pulse is on its way through. */
export const lagboxArt = cached<boolean>((busy) => {
  const a = new PixelArt(16, 12);
  chip(a, BLUE_PAINT);
  finish(a);
  a.map(['XXXXX', '.X.X.', '..X..', '.X.X.', 'XXXXX'], { X: WHITE[3] }, 5, 4);
  a.set(7, 7, YELLOW[3]);
  a.set(12, 1, busy ? LED_GREEN : LED_OFF);
  return a;
});

/** A counter: the count so far on its display; the LED lit as it fires. */
export const counterArt = cached<number>((key) => {
  const n = key % 100;
  const lit = key >= 100;
  const a = new PixelArt(16, 12);
  chip(a, POLYMER);
  a.rect(4, 2, 8, 8, 0x1f3a24);
  finish(a);
  digit(a, n, 6, 3, 0x9adf6a);
  a.set(13, 1, lit ? LED_GREEN : LED_OFF);
  return a;
});

/** A glass cartridge fuse between brass caps: its wire whole, or burnt through. */
export const fuseArt = cached<boolean>((blown) => {
  const a = new PixelArt(16, 8);
  a.rect(3, 2, 10, 4, GLASS[2]);
  a.rect(0, 1, 4, 6, BRASS[2]);
  a.rect(12, 1, 4, 6, BRASS[2]);
  finish(a, { shadow: false });
  if (blown) {
    a.set(4, 4, ORANGE[1]).set(5, 4, ORANGE[1]).set(10, 3, ORANGE[1]).set(11, 4, ORANGE[1]);
    for (const [x, y] of [[7, 3], [8, 4], [7, 4], [9, 3]]) a.set(x, y, GUNMETAL[0]);
  } else {
    a.hline(4, 11, 4, ORANGE[3]);
    a.set(6, 3, ORANGE[3]).set(9, 3, ORANGE[3]);
  }
  a.set(4, 2, GLASS[4]).set(5, 2, GLASS[4]);
  return a;
});

/** Frames of a metronome's swing: left, middle, right, middle. */
export const METRONOME_FRAMES = 4;

/** A wooden metronome, its pendulum at `frame` of its swing. */
export const metronomeArt = cached<number>((frame) => {
  const a = new PixelArt(12, 16);
  a.poly([[1, 15], [10, 15], [7, 1], [4, 1]], WOOD[2]);
  a.rect(0, 14, 12, 2, WOOD_DARK[2]);
  a.rect(4, 6, 4, 7, WHITE[1]);
  finish(a);
  // the pendulum from its pivot low on the face up to the tip, a weight partway
  const tip = [[3, 2], [5, 1], [8, 2], [5, 1]][frame % METRONOME_FRAMES];
  a.line(5, 12, tip[0], tip[1], STEEL_LT[3]);
  const wx = Math.round(5 + (tip[0] - 5) * 0.55);
  a.rect(wx, 6, 2, 1, BRASS[3]);
  a.set(5, 12, GUNMETAL[0]);
  return a;
});

export type DetectorKind = 'metal' | 'fire';

/** A detector looking right through its front: a coil (metal) or a red lens (fire). */
export const detectorArt = cached<string>((key) => {
  const [kind, on] = key.split(':') as [DetectorKind, string];
  const active = on === '1';
  const a = new PixelArt(12, 10);
  a.roundRect(0, 1, 9, 8, 1, kind === 'metal' ? POLYMER[2] : WHITE[2]);
  a.rect(9, 2, 3, 6, kind === 'metal' ? BLUE_PAINT[2] : RED[1]);
  finish(a);
  if (kind === 'metal') {
    a.vline(10, 3, 6, active ? 0x8fd8ff : BLUE_PAINT[1]);
    a.set(3, 4, STEEL_LT[3]).set(4, 4, STEEL_LT[3]).set(3, 5, STEEL_LT[2]).set(4, 5, STEEL_LT[2]);
  } else {
    a.vline(10, 3, 6, active ? 0xffb04a : RED[2]);
    a.map(['.X.', 'XX.', 'XXX', '.X.'], { X: ORANGE[2] }, 2, 3);
  }
  a.set(6, 3, active ? LED_RED : LED_OFF);
  return a;
});

/** A siren on its base: the dome dark, or lit with its beacon toward one side or the other. */
export const sirenArt = cached<number>((lit) => {
  const a = new PixelArt(12, 12);
  a.rect(1, 9, 10, 3, GUNMETAL[2]);
  a.ellipse(1, 1, 10, 11, RED[2]);
  a.rect(1, 9, 10, 3, GUNMETAL[2]);
  finish(a, { shadow: !lit });
  if (lit) {
    const side = lit === 1 ? 3 : 7;
    a.rect(side, 3, 2, 4, 0xffb0a0);
    a.set(side, 2, 0xffffff);
  } else a.set(3, 3, RED[4]);
  a.hline(2, 9, 10, GUNMETAL[3]);
  return a;
});

/** A radio box with its aerial: a transmitter (dark, red tip) or a receiver (olive, green tip), its channel on its face. */
export const radioArt = cached<string>((key) => {
  const [kind, ch, on] = key.split(':');
  const tx = kind === 'tx';
  const a = new PixelArt(12, 16);
  a.vline(9, 1, 6, STEEL_LT[2]);
  a.roundRect(0, 6, 12, 10, 1, tx ? POLYMER[2] : OLIVE[2]);
  finish(a);
  a.set(9, 0, tx ? LED_RED : LED_GREEN);
  digit(a, Number(ch), 2, 8, WHITE[3]);
  for (const y of [9, 11, 13]) a.hline(7, 9, y, tx ? POLYMER[0] : OLIVE[0]);
  a.set(10, 8, on === '1' ? (tx ? LED_RED : LED_GREEN) : LED_OFF);
  return a;
});

/** Where a servo's arm turns on its housing, and the arm's own pivot (art px). */
export const SERVO = { pivot: [7, 6] as [number, number], armPivot: [2, 2] as [number, number] };

/** A servo's housing: a blue case with mounting tabs, the output horn in the middle. */
export function servoArt(): PixelArt {
  const a = new PixelArt(14, 12);
  a.rect(0, 4, 14, 4, BLUE_PAINT[1]);
  a.roundRect(1, 1, 12, 11, 1, BLUE_PAINT[2]);
  a.ellipse(4, 3, 7, 7, STEEL_LT[2]);
  finish(a);
  a.set(0, 5, GUNMETAL[0]).set(13, 5, GUNMETAL[0]);
  a.set(7, 6, GUNMETAL[0]);
  return a;
}

// ------------------------------------------------------------------ conveyor, winch, EMP

/** Frames of a conveyor's belt running: its ribs move along 2 px a frame. */
export const BELT_FRAMES = 4;

/** A conveyor belt: a rubber belt round a roller at each end, on a steel frame between them. */
export const conveyorArt = cached<number>((frame) => {
  const a = new PixelArt(64, 10);
  a.ellipse(0, 0, 10, 10, RUBBER[2]);
  a.ellipse(54, 0, 10, 10, RUBBER[2]);
  a.rect(5, 0, 54, 10, RUBBER[1]);
  a.rect(4, 2, 56, 6, GUNMETAL[2]);
  a.rect(5, 0, 54, 2, RUBBER[2]);
  finish(a);
  // the ribs on its top run, where they've got to
  for (let x = 6 + (frame % BELT_FRAMES) * 2; x < 58; x += 8) a.set(x, 1, RUBBER[3]).set(x + 1, 1, RUBBER[3]);
  for (const x of [4, 59]) {
    a.set(x, 4, STEEL_LT[3]).set(x, 5, STEEL_LT[2]);
  }
  for (let x = 12; x < 54; x += 10) a.set(x, 5, GUNMETAL[3]);
  a.hline(28, 35, 4, YELLOW[2]);
  return a;
});

/** Frames of a winch's drum turning. */
export const WINCH_FRAMES = 3;
/** Where a winch's rope comes off its drum (art px). */
export const WINCH_DRUM: [number, number] = [10, 4];

/** A winch: a drum wound with rope between two cheeks on a base, a gear on its side. */
export const winchArt = cached<number>((frame) => {
  const a = new PixelArt(20, 16);
  a.rect(0, 13, 20, 3, GUNMETAL[1]);
  a.rect(1, 3, 4, 11, GUNMETAL[2]);
  a.rect(15, 3, 4, 11, GUNMETAL[2]);
  a.rect(5, 4, 10, 8, KHAKI[2]);
  finish(a);
  // the turns of rope, shifting as it turns
  for (let y = 5 + (frame % WINCH_FRAMES); y < 12; y += 3) a.hline(5, 14, y, KHAKI[1]);
  // the gear's teeth on the near cheek, turning
  const teeth = [[2, 5], [3, 8], [2, 11]];
  for (let i = 0; i < teeth.length; i++) {
    const [x, y] = teeth[(i + frame) % teeth.length];
    a.set(x, y, i === 0 ? STEEL_LT[3] : GUNMETAL[0]);
  }
  a.set(17, 6, YELLOW[3]);
  return a;
});

/** An EMP generator: a copper ring on a case with a lightning mark; its lamp lit while it recharges. */
export const empArt = cached<boolean>((charging) => {
  const a = new PixelArt(18, 18);
  a.rect(0, 8, 18, 10, GUNMETAL[2]);
  a.rect(6, 4, 6, 4, STEEL[2]);
  a.ellipse(1, 0, 16, 6, COPPER[2]);
  finish(a);
  a.hline(4, 13, 2, COPPER[1]);
  a.map(['..X', '.X.', 'XXX', '.X.', 'X..'], { X: YELLOW[3] }, 7, 10);
  for (let x = 2; x < 16; x += 3) a.set(x, 16, YELLOW[2]);
  a.set(15, 10, charging ? LED_RED : LED_GREEN);
  return a;
});

// ------------------------------------------------------------------ attach points

const MOUNT = 'mount' as const;
const chipPorts = (w: number, y: number): AttachPoint[] => [
  { name: 'input', x: 0.5, y, role: 'in' },
  { name: 'output', x: w - 0.5, y, role: 'out' },
];

/**
 * Where connections snap to on these (see catalog/attach), by kind and part name,
 * in art pixels: what to fix each by, and the logic parts' ways in and out.
 */
export const MACHINES2_ATTACH: Record<string, Record<string, AttachPoint[]>> = {
  'sentry-turret': { Base: [{ name: 'base', x: 10, y: 11.5, role: MOUNT }] },
  'laser-sentry': { Base: [{ name: 'base', x: 10, y: 11.5, role: MOUNT }] },
  'ceiling-turret': { Base: [{ name: 'top', x: 10, y: 0.5, role: MOUNT }] },
  fan: { Fan: [{ name: 'foot', x: 6, y: 19.5, role: MOUNT }] },
  propeller: { Propeller: [{ name: 'mount', x: 0.5, y: 15, role: MOUNT }] },
  electromagnet: { Electromagnet: [{ name: 'hook', x: 11, y: 0.5, role: MOUNT }] },
  'tesla-coil': { 'Tesla Coil': [{ name: 'base', x: 8, y: 39.5, role: MOUNT }] },
  'launch-pad': { 'Launch Platform': [{ name: 'base', x: 20, y: 11.5, role: MOUNT }] },
  lagbox: { Lagbox: chipPorts(16, 6) },
  counter: { Counter: chipPorts(16, 6) },
  'activation-fuse': { 'Activation Fuse': chipPorts(16, 4) },
  metronome: { Metronome: [{ name: 'base', x: 6, y: 15.5, role: MOUNT }, ...chipPorts(12, 14.5)] },
  'metal-detector': { 'Metal Detector': [{ name: 'base', x: 4.5, y: 9.5, role: MOUNT }, { name: 'output', x: 0.5, y: 5, role: 'out' }] },
  'fire-detector': { 'Fire Detector': [{ name: 'base', x: 4.5, y: 9.5, role: MOUNT }, { name: 'output', x: 0.5, y: 5, role: 'out' }] },
  siren: { Siren: [{ name: 'base', x: 6, y: 11.5, role: MOUNT }] },
  'radio-transmitter': { 'Radio Transmitter': [{ name: 'base', x: 6, y: 15.5, role: MOUNT }, { name: 'input', x: 0.5, y: 11, role: 'in' }] },
  'radio-receiver': { 'Radio Receiver': [{ name: 'base', x: 6, y: 15.5, role: MOUNT }, { name: 'output', x: 11.5, y: 11, role: 'out' }] },
  servo: {
    Housing: [{ name: 'base', x: 7, y: 11.5, role: MOUNT }],
    Arm: [{ name: 'tip', x: 23, y: 2.5, role: 'plate' }],
  },
  'conveyor-belt': { 'Conveyor Belt': [{ name: 'left', x: 5, y: 9.5, role: MOUNT }, { name: 'right', x: 59, y: 9.5, role: MOUNT }] },
  winch: { Winch: [{ name: 'base', x: 10, y: 15.5, role: MOUNT }, { name: 'drum', x: WINCH_DRUM[0], y: WINCH_DRUM[1], role: 'plate' }] },
  'emp-generator': { 'EMP Generator': [{ name: 'base', x: 9, y: 17.5, role: MOUNT }] },
};

/** A servo's arm: a flat bar with holes, turning about its left end. */
export function servoArmArt(): PixelArt {
  const a = new PixelArt(26, 5);
  a.roundRect(0, 0, 26, 5, 2, STEEL[2]);
  finish(a);
  for (const x of [8, 14, 20]) a.set(x, 2, GUNMETAL[0]);
  a.set(2, 2, GUNMETAL[0]);
  return a;
}

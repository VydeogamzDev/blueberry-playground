import { PixelArt } from './PixelArt';
import { finish, GUNMETAL, POLYMER, STEEL, STEEL_LT, YELLOW, WHITE, LED_RED, LED_GREEN, BLUE_PAINT, ORANGE, RED, GLASS, OLIVE } from './palette';

// Power and sensing parts (0.4.0): the solar panel, the generator, the sensors, the toggle
// and the step sequencer. Same rules as the other machinery sprites: inputs on the left,
// outputs on the right, finish() for outline and lighting, single-pixel details after.

const LED_OFF = GUNMETAL[0];

function cached<K>(make: (k: K) => PixelArt): (k: K) => PixelArt {
  const m = new Map<K, PixelArt>();
  return (k) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make(k)));
    return a;
  };
}

/** A chip body (16 x 12) with an input pin on the left and an output pin on the right. */
function chip(a: PixelArt, body: readonly number[]): void {
  a.rect(2, 0, 12, 12, body[2]);
  a.rect(0, 5, 2, 2, STEEL_LT[2]);
  a.rect(14, 5, 2, 2, STEEL_LT[2]);
}

/** A solar panel: blue cells in a grid on a thin frame, a stub of a stand under it; `lit`: catching the sun (a glint). */
export const solarArt = cached<boolean>((lit) => {
  const a = new PixelArt(24, 8);
  a.rect(0, 0, 24, 4, STEEL[1]);
  a.rect(1, 0, 22, 3, 0x2a4a7a);
  a.rect(10, 4, 4, 4, GUNMETAL[2]);
  finish(a);
  for (let x = 4; x < 23; x += 4) a.vline(x, 0, 2, 0x5a7fb5);
  a.hline(1, 22, 1, 0x3d649e);
  if (lit) a.set(3, 0, WHITE[4]).set(4, 0, WHITE[4]).set(15, 0, WHITE[3]);
  a.set(12, 6, lit ? LED_GREEN : LED_OFF);
  return a;
});

/** A petrol generator in a tubular frame: a fuel cap on top, a pull start, its lamp lit while running; `frame` jiggles it. */
export const generatorArt = cached<number>((key) => {
  const run = key > 0;
  const a = new PixelArt(20, 14);
  a.rect(1, 3, 18, 10, RED[2]);
  a.rect(3, 5, 9, 6, GUNMETAL[2]);
  a.rect(13, 5, 4, 6, STEEL[2]);
  a.rect(0, 12, 20, 2, GUNMETAL[1]);
  a.rect(2, 0, 4, 3, GUNMETAL[2]);
  finish(a);
  for (let y = 6; y < 11; y += 2) a.hline(4, 10, y, GUNMETAL[0]);
  a.set(3, 1, YELLOW[3]).set(4, 1, YELLOW[3]);
  a.set(15, 4, run ? (key % 2 ? LED_GREEN : 0x9aff8a) : LED_OFF);
  a.set(14, 8, STEEL_LT[4]);
  return a;
});

export type SensorKind = 'altimeter' | 'speed' | 'tilt' | 'fuel' | 'proximity' | 'g';

/** A sensor: a chip with a dial for what it reads; its LED lit while its output's on. */
export const sensorArt = cached<string>((key) => {
  const [kind, on] = key.split(':') as [SensorKind, string];
  const a = new PixelArt(16, 12);
  const body = kind === 'proximity' ? OLIVE : kind === 'fuel' ? ORANGE : kind === 'tilt' ? BLUE_PAINT : kind === 'g' ? RED : POLYMER;
  chip(a, body);
  a.rect(4, 2, 8, 8, 0x14181c);
  finish(a);
  const c = 0x9adf6a;
  switch (kind) {
    case 'altimeter':
      // a mountain with an arrow over it
      a.map(['..X..', '.XXX.', 'XXXXX'], { X: c }, 5, 6);
      a.set(7, 3, c).set(6, 4, c).set(8, 4, c);
      break;
    case 'speed':
      // a dial with its needle
      a.map(['.XXX.', 'X...X', 'X..X.', '...X.'], { X: c }, 5, 4);
      a.set(7, 6, WHITE[4]);
      break;
    case 'tilt':
      // a bubble level, tipped
      a.line(4, 8, 11, 4, c);
      a.set(8, 5, WHITE[4]);
      break;
    case 'fuel':
      // a pump
      a.map(['XXX.', 'X.XX', 'XXX.', 'XXX.'], { X: c }, 5, 4);
      break;
    case 'proximity':
      // rings out from a dot
      a.map(['..X..', '.X.X.', 'X.X.X', '.X.X.', '..X..'], { X: c }, 5, 3);
      break;
    case 'g':
      // a g
      a.map(['.XXX', 'X..X', '.XXX', '...X', 'XXX.'], { X: c }, 6, 3);
      break;
  }
  a.set(13, 1, on === '1' ? LED_GREEN : LED_OFF);
  return a;
});

/** A toggle (flip-flop): two LEDs, one lit for its state. */
export const toggleArt = cached<boolean>((on) => {
  const a = new PixelArt(16, 12);
  chip(a, BLUE_PAINT);
  finish(a);
  a.rect(5, 3, 2, 2, on ? LED_OFF : LED_RED);
  a.rect(9, 3, 2, 2, on ? LED_GREEN : LED_OFF);
  a.map(['XXXX', 'X..X', 'XXXX'], { X: WHITE[3] }, 6, 7);
  if (on) a.set(8, 8, WHITE[3]).set(7, 8, 0x2a2a2a);
  return a;
});

/** How many steps a sequencer has. */
export const SEQ_STEPS = 4;
/** Where its outputs are along its right side (art y of each pin). */
export const SEQ_PINS = [2, 6, 10, 14];

/** A step sequencer: a tall chip, four output pins down its right side, the LED by the step it's on lit. */
export const sequencerArt = cached<number>((step) => {
  const a = new PixelArt(16, 18);
  a.rect(2, 0, 12, 18, POLYMER[2]);
  a.rect(0, 8, 2, 2, STEEL_LT[2]);
  for (const y of SEQ_PINS) a.rect(14, y, 2, 2, STEEL_LT[2]);
  finish(a);
  SEQ_PINS.forEach((y, i) => a.rect(10, y, 2, 2, i === step ? LED_GREEN : LED_OFF));
  a.map(['X.X', 'XXX', 'X.X'], { X: GLASS[3] }, 4, 8);
  return a;
});

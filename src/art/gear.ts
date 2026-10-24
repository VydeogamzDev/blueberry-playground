import { PixelArt, CLEAR } from './PixelArt';
import { finish, GUNMETAL, ORANGE, POLYMER, STEEL, STEEL_LT, WHITE, OLIVE, BRASS, WOOD, WOOD_DARK, WOOD_PALE, YELLOW, RUBBER, RED, BLUE_PAINT, KHAKI, CONCRETE, ramp, type Ramp } from './palette';
import type { Color } from './PixelArt';

// Power tools and other gear (see entities/Chainsaw and the rest). They follow
// the guns' rules: they point RIGHT, are drawn from the palette's ramps and
// finished with its outline and lighting; what's a pixel thin (a chain) is
// painted after the finishing pass, which would turn it all to outline.

// ------------------------------------------------------------------ chainsaw

/** The chainsaw's size (art px), and its guide bar: from its root to the nose, top and bottom rows. */
export const SAW_W = 44;
export const SAW_H = 12;
export const SAW_BAR = { x0: 24, x1: 43, y0: 5, y1: 10 };
/** Frames of the chain running round the bar (the cutters move a pixel each). */
export const SAW_FRAMES = 3;

const saws: PixelArt[] = [];

/** A chainsaw pointing right, its chain at `frame` (0..SAW_FRAMES-1) of its run round the bar. */
export function chainsawArt(frame = 0): PixelArt {
  const f = ((frame % SAW_FRAMES) + SAW_FRAMES) % SAW_FRAMES;
  return (saws[f] ??= drawSaw(f));
}

function drawSaw(f: number): PixelArt {
  const a = new PixelArt(SAW_W, SAW_H);
  // the guide bar (under the rest), its nose rounded
  a.rect(20, 5, 23, 6, STEEL_LT[2]);
  a.set(43, 7, STEEL_LT[2]).set(43, 8, STEEL_LT[2]);
  a.set(42, 5, CLEAR).set(42, 10, CLEAR);
  // rear handle: a closed loop, the throttle trigger under its top
  a.rect(0, 5, 9, 2, POLYMER[2]);
  a.rect(0, 5, 2, 7, POLYMER[2]);
  a.rect(0, 10, 9, 2, POLYMER[2]);
  // engine housing over the crankcase, the clutch cover over the bar's root
  a.roundRect(7, 2, 15, 8, 2, ORANGE[2]);
  a.rect(8, 9, 14, 3, POLYMER[2]);
  a.roundRect(19, 4, 5, 7, 1, POLYMER[2]);
  // the wrap handle arching over the housing, and the hand guard in front of it
  a.rect(11, 0, 11, 2, POLYMER[2]);
  a.rect(11, 0, 2, 3, POLYMER[2]);
  a.rect(20, 0, 2, 3, POLYMER[2]);
  a.rect(23, 0, 2, 5, POLYMER[1]);
  // muffler at the front of the crankcase
  a.rect(16, 10, 4, 2, STEEL[2]);
  finish(a);
  // trigger, starter grip, air filter vents, a stripe along the housing
  a.set(4, 7, POLYMER[0]).set(5, 7, POLYMER[0]);
  a.set(8, 3, WHITE[3]).set(9, 3, WHITE[2]);
  for (let x = 13; x <= 18; x += 2) a.set(x, 4, ORANGE[0]);
  a.hline(9, 18, 7, ORANGE[1]);
  a.hline(10, 17, 6, ORANGE[3]);
  // the bar's groove and its rivets
  a.hline(26, 40, 8, STEEL_LT[1]);
  a.set(27, 7, STEEL[1]).set(39, 7, STEEL[1]);
  // the chain round the bar: links shading one way and the other as they run,
  // cutters standing out along the top running toward the nose and back along the bottom
  for (let x = 24; x <= 41; x++) {
    a.set(x, 5, (x + f) % 2 ? GUNMETAL[1] : GUNMETAL[3]);
    a.set(x, 10, (x - f) % 2 ? GUNMETAL[1] : GUNMETAL[3]);
    if ((x - f + 30) % 3 === 0) a.set(x, 4, GUNMETAL[2]);
    if ((x + f) % 3 === 0) a.set(x, 11, GUNMETAL[2]);
  }
  a.set(42, 6, GUNMETAL[f % 2 ? 1 : 3]).set(43, 7, GUNMETAL[1]).set(43, 8, GUNMETAL[3]).set(42, 9, GUNMETAL[f % 2 ? 3 : 1]);
  return a;
}

// ------------------------------------------------------------------ grenades

/** The sticky grenade's coating: a tacky orange-brown goo over its body. */
const GOO = ramp('#b8692c', 0.9);

export const STICKY_W = 9;
export const STICKY_H = 12;

/** A sticky grenade: a round charge in a glistening tacky coat, a handle on top with its pin (`pinned`). */
export function stickyGrenadeArt(pinned: boolean): PixelArt {
  const a = new PixelArt(STICKY_W, STICKY_H);
  a.ellipse(0, 3, 9, 9, GOO[2]);
  a.rect(3, 0, 3, 4, STEEL[2]);
  a.set(6, 1, STEEL_LT[2]).set(7, 2, STEEL_LT[2]);
  finish(a);
  // the goo's sheen and drips, the lever
  a.set(2, 5, GOO[4]).set(3, 5, GOO[3]).set(2, 6, GOO[3]);
  a.set(6, 9, GOO[1]).set(4, 11, GOO[1]);
  a.set(5, 7, GOO[3]).set(1, 8, GOO[1]);
  if (pinned) a.set(1, 0, BRASS[3]).set(2, 0, BRASS[3]).set(1, 1, BRASS[3]).set(2, 2, BRASS[2]);
  return a;
}

/** The grenade launcher's size (art px); its barrel and fore-end drop at the hinge when it's broken open. */
export const LAUNCHER_W = 34;
export const LAUNCHER_H = 10;
/** Where the round leaves it, and the breech where the empty case comes out (art px, closed). */
export const LAUNCHER_MUZZLE: [number, number] = [33, 3.5];
export const LAUNCHER_BREECH: [number, number] = [17, 3.5];

const launchers = new Map<boolean, PixelArt>();

/** A break-action 40 mm grenade launcher (an M79): closed, or broken open to load. */
export function launcherArt(open = false): PixelArt {
  let a = launchers.get(open);
  if (!a) launchers.set(open, (a = drawLauncher(open)));
  return a;
}

function drawLauncher(open: boolean): PixelArt {
  const a = new PixelArt(LAUNCHER_W, LAUNCHER_H);
  const d = open ? 2 : 0;
  // wooden stock, the receiver, the fat barrel with its wooden fore-end under it
  a.poly([[0, 3], [12, 3], [12, 7], [5, 7], [0, 9]], WOOD[2]);
  a.rect(11, 2, 6, 5, GUNMETAL[2]);
  a.rect(17, 1 + d, 17, 6, GUNMETAL[2]);
  a.rect(18, 7 + d, 9, 2, WOOD[2]);
  // trigger guard, and the leaf sight standing on the barrel
  a.rect(12, 7, 4, 2, GUNMETAL[1]);
  a.rect(21, d, 2, 1, GUNMETAL[2]);
  finish(a);
  a.set(13, 7, CLEAR).set(14, 7, CLEAR);
  a.set(13, 7, GUNMETAL[0]);
  a.hline(1, 4, 8, WOOD_DARK[2]);
  // the bore, and (open) the breech with nothing in it
  a.vline(33, 2 + d, 5 + d, GUNMETAL[0]);
  if (open) a.vline(17, 3, 6, GUNMETAL[0]);
  return a;
}

export const ROUND_W = 8;
export const ROUND_H = 4;

/** A 40 mm grenade in flight, nose right: an olive body with a yellow band and a gold fuze. */
export function launcherRoundArt(): PixelArt {
  const a = new PixelArt(ROUND_W, ROUND_H);
  a.rect(0, 0, 5, 4, OLIVE[2]);
  a.rect(5, 0, 2, 4, BRASS[2]);
  a.set(7, 1, BRASS[2]).set(7, 2, BRASS[2]);
  finish(a, { outline: false });
  a.vline(1, 0, 3, YELLOW[2]);
  return a;
}

// ------------------------------------------------------------------ melee

export const SPEAR_W = 54;
export const SPEAR_H = 5;

/** A spear: a long ash shaft bound to a leaf-shaped steel head, pointing right. */
export function spearArt(): PixelArt {
  const a = new PixelArt(SPEAR_W, SPEAR_H);
  a.rect(0, 1.5, 45, 2, WOOD_PALE[2]);
  a.poly([[43.5, 2.5], [47.5, 0], [53.9, 2.5], [47.5, 5]], STEEL_LT[2]);
  a.rect(40, 1, 4, 3, WOOD_DARK[2]);
  a.rect(0, 1, 2, 3, STEEL[2]);
  finish(a, { shadow: false });
  // the binding's turns, the head's ridge and its edges catching the light
  for (let x = 40; x <= 43; x += 2) a.set(x, 1, WOOD_DARK[3]).set(x + 1, 3, WOOD_DARK[1]);
  a.hline(45, 52, 2, STEEL_LT[1]);
  a.hline(46, 50, 1, STEEL_LT[4]);
  return a;
}

export const PHAMMER_W = 36;
export const PHAMMER_H = 12;
/** The striking face: art columns from here to the right edge. */
export const PHAMMER_FACE = 32;

const phammers = new Map<boolean, PixelArt>();

/** A power hammer: a long handle with an air-driven piston in its heavy head; its light green when charged, red as it recharges. */
export function powerHammerArt(charged = true): PixelArt {
  let a = phammers.get(charged);
  if (a) return a;
  a = new PixelArt(PHAMMER_W, PHAMMER_H);
  // grip, handle tube, the head's cylinder and the striking face on its piston
  a.rect(0, 4, 8, 4, RUBBER[2]);
  a.rect(7, 5, 18, 2, STEEL[2]);
  a.roundRect(22, 1, 11, 10, 2, YELLOW[2]);
  a.rect(32, 2, 4, 8, STEEL[1]);
  // the air hose looping from the handle to the head
  a.rect(10, 7, 12, 1, RUBBER[1]);
  finish(a);
  a.set(9, 8, RUBBER[1]).set(10, 8, RUBBER[1]);
  // bands round the cylinder, its warning stripes, the charge light, the face's shine
  a.vline(25, 2, 9, YELLOW[1]).vline(29, 2, 9, YELLOW[1]);
  for (let y = 3; y <= 8; y += 2) a.set(27, y, POLYMER[1]);
  a.set(24, 3, charged ? 0x58c45a : 0xe0483a);
  a.vline(34, 3, 8, STEEL_LT[3]);
  for (let x = 1; x < 7; x += 2) a.set(x, 5, RUBBER[3]);
  a.set(31, 5, RED[2]).set(31, 6, RED[2]);
  phammers.set(charged, a);
  return a;
}

// ------------------------------------------------------------------ pyrotechnics

export const FLARE_W = 16;
export const FLARE_H = 4;
/** The striker end, where it burns (art px). */
export const FLARE_TIP: [number, number] = [15, 1.5];

/** How a road flare looks: new, burning, or burnt out. */
export type FlareLook = 'new' | 'lit' | 'spent';

const flares = new Map<FlareLook, PixelArt>();

/** A road flare: a red paper tube with its striker cap at the right end. */
export function flareArt(look: FlareLook = 'new'): PixelArt {
  let a = flares.get(look);
  if (a) return a;
  a = new PixelArt(FLARE_W, FLARE_H);
  a.rect(0, 0, 14, 4, RED[2]);
  a.rect(13, 0.5, 3, 3, look === 'spent' ? 0x2c2422 : RED[1]);
  finish(a);
  a.rect(4, 1, 4, 2, WHITE[2]);
  a.hline(5, 6, 1, RED[1]);
  a.set(0, 1, POLYMER[1]).set(0, 2, POLYMER[1]);
  if (look === 'lit') a.rect(14, 1, 2, 2, 0xffe0d0).set(13, 1, 0xff6a50).set(13, 2, 0xff6a50);
  if (look === 'spent') a.set(12, 0, 0x2c2422).set(12, 3, 0x3a2e2a).set(11, 1, 0x5a3a32);
  flares.set(look, a);
  return a;
}

/** A firework's colours, by name (what its burst lights up as; 'mixed' is a bit of each). */
export type FireworkColor = 'red' | 'green' | 'blue' | 'gold' | 'mixed';
export const FIREWORK_COLORS: Record<FireworkColor, Color[]> = {
  red: [0xff5040, 0xff8070],
  green: [0x50ff70, 0xa0ffb0],
  blue: [0x5aa8ff, 0xa0d0ff],
  gold: [0xffd060, 0xfff0b0],
  mixed: [0xff5040, 0x50ff70, 0x5aa8ff, 0xffd060, 0xe070ff],
};
const PAPER: Record<FireworkColor, Ramp> = {
  red: RED, green: ramp('#3f8a4a'), blue: BLUE_PAINT, gold: YELLOW, mixed: ramp('#8a4aa8'),
};

export const ROCKET_W = 7;
export const ROCKET_H = 32;
/** The fuse at the tube's foot, where the motor's sparks come out (art px). */
export const ROCKET_FUSE: [number, number] = [3, 16];

const rockets = new Map<FireworkColor, PixelArt>();

/** A firework rocket standing on its stick, pointing UP: a paper tube in its colour under a gold cone. */
export function fireworkArt(color: FireworkColor = 'red'): PixelArt {
  let a = rockets.get(color);
  if (a) return a;
  const paper = PAPER[color];
  a = new PixelArt(ROCKET_W, ROCKET_H);
  a.poly([[3.5, -0.2], [6, 4], [1, 4]], YELLOW[3]);
  a.rect(1, 4, 5, 12, paper[2]);
  a.rect(3, 16, 1, 16, WOOD_PALE[2]);
  finish(a, { shadow: false });
  a.set(3, 31, WOOD_PALE[1]);
  // gold stars on the paper, a band under the cone, the fuse at its foot
  a.hline(2, 4, 5, YELLOW[2]);
  a.set(2, 8, YELLOW[3]).set(4, 11, YELLOW[3]).set(3, 13, YELLOW[3]);
  a.set(4, 16, KHAKI[1]).set(5, 17, KHAKI[1]);
  rockets.set(color, a);
  return a;
}

// ------------------------------------------------------------------ balloon and weight

export type BalloonColor = 'red' | 'blue' | 'green' | 'yellow' | 'pink';
export const BALLOON_RAMPS: Record<BalloonColor, Ramp> = {
  red: ramp('#d0382e'), blue: ramp('#3c78d0'), green: ramp('#3ea84a'), yellow: ramp('#e8c032'), pink: ramp('#e86aa8'),
};
export const BALLOON_W = 14;
export const BALLOON_H = 22;
/** The knot at its neck, where a rope is tied (art px). */
export const BALLOON_KNOT: [number, number] = [6.5, 17];

const balloons = new Map<BalloonColor, PixelArt>();

/** A party balloon, its knot and a curl of ribbon under it. */
export function balloonArt(color: BalloonColor = 'red'): PixelArt {
  let a = balloons.get(color);
  if (a) return a;
  const c = BALLOON_RAMPS[color];
  a = new PixelArt(BALLOON_W, BALLOON_H);
  a.ellipse(0, 0, 14, 16, c[2]);
  a.poly([[5, 15], [8.5, 15], [7.5, 18], [6, 18]], c[2]);
  finish(a);
  // a shine on its upper left, the ribbon curling down from the knot
  a.set(3, 3, c[4]).set(4, 3, c[4]).set(3, 4, c[4]).set(4, 2, c[3]).set(2, 5, c[3]);
  a.set(7, 18, WHITE[1]).set(6, 19, WHITE[1]).set(7, 20, WHITE[1]).set(6, 21, WHITE[1]);
  balloons.set(color, a);
  return a;
}

export const WEIGHT_W = 30;
export const WEIGHT_H = 26;

/** Pixel digits and letters for the weight's stamp, 3 wide and 5 tall. */
const GLYPHS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  K: ['#.#', '##.', '#..', '##.', '#.#'],
  G: ['###', '#..', '#.#', '#.#', '###'],
};

/** A thousand-kilogram iron weight: a squat trapezoid with a ring on top, stamped 1000 KG. */
export function weightArt(): PixelArt {
  const a = new PixelArt(WEIGHT_W, WEIGHT_H);
  const IRON = GUNMETAL;
  a.rect(10, 0, 10, 2, IRON[2]);
  a.rect(10, 0, 2, 6, IRON[2]);
  a.rect(18, 0, 2, 6, IRON[2]);
  a.poly([[5, 5], [25, 5], [30, 26], [0, 26]], IRON[2]);
  finish(a);
  const stamp = (text: string, x0: number, y0: number) => {
    for (const ch of text) {
      const g = GLYPHS[ch];
      if (g) g.forEach((row, j) => [...row].forEach((v, i) => v === '#' && a.set(x0 + i, y0 + j, CONCRETE[4])));
      x0 += 4;
    }
  };
  stamp('1000', 7, 10);
  stamp('KG', 11, 17);
  return a;
}

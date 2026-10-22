import { PixelArt, type Color } from './PixelArt';
import {
  finish, draw, GUNMETAL, POLYMER, WOOD, WOOD_DARK, WOOD_PALE, OLIVE, STEEL, STEEL_LT, BRASS, COPPER, RED, KHAKI,
  YELLOW, ORANGE, GLASS, WHITE, RUBBER, LAMP, LED_RED, LED_GREEN, step,
} from './palette';

// ------------------------------------------------------------------ firearms
// All guns point RIGHT; the muzzle is at the right edge. Steel parts use the
// gunmetal ramp, frames and grips polymer, furniture wood or olive.

const GUN_PAL: Record<string, Color> = {
  S: GUNMETAL[2], // slide / receiver
  s: GUNMETAL[1],
  L: GUNMETAL[3],
  M: GUNMETAL[1], // barrel
  d: GUNMETAL[0], // ports / bore
  K: POLYMER[2], // frame
  G: POLYMER[2], // grip
  g: POLYMER[1],
  t: POLYMER[0], // trigger
  m: GUNMETAL[2], // magazine
  n: GUNMETAL[1],
  W: WOOD[2],
  w: WOOD[1],
  B: WOOD_DARK[2],
  b: WOOD_DARK[1],
  O: OLIVE[2],
  o: OLIVE[1],
  y: BRASS[3],
  l: GLASS[3],
};

function gun(rows: string[]): PixelArt {
  const a = draw(rows[0].length, rows.length, rows, GUN_PAL);
  return finish(a);
}

export function pistolArt(): PixelArt {
  return gun([
    '.SSSSSSSSSS.',
    '.SssSSdSSSSS',
    '.SssSSSSSSSS',
    '.KKKKKKKKKK.',
    '.GgGK.tK....',
    '.GGgG.KK....',
    'GgGG........',
  ]);
}

export function revolverArt(): PixelArt {
  return gun([
    '...SSSSSSSSSS.',
    '..SSSSSSSSSSSS',
    '.KSsSsSSKKKKK.',
    '.KSsSsSK......',
    'WWwK.tK.......',
    'WwWW.KK.......',
    'WWw...........',
  ]);
}

export function rifleArt(): PixelArt {
  return gun([
    '.........SSSSSSSS.............',
    'WWWWW...SSSSSSSSSWWWWWWWW.....',
    'WwWWWWWWSSddSSSSSWwwwwwwwMMMMS',
    'WWWWWwWWSSSSSSSSSWWWWWWWW.....',
    '.WWWWW..KKKKKKKKKKKKKKKK......',
    '..WWW...GG.t.mmm..............',
    '........Gg...mmm..............',
    '.........G....mmm.............',
    '...............mm.............',
  ]);
}

export function smgArt(): PixelArt {
  return gun([
    '....SSSSSSSSS.......',
    'KK.SSSSSSSSSSSMMMMMS',
    'KKKSSddSSSSSSS......',
    'K..KKKKKKKKKKK......',
    '...GG.t.mm..........',
    '...Gg...mm..........',
    '........mm..........',
    '........mn..........',
  ]);
}

export function shotgunArt(): PixelArt {
  return gun([
    '..........SSSSSSSSSSSSSSSSSSSSSSSS',
    'WWWW.....SSSSSSSSSSSSSSSSSSSSSSSSS',
    'WwWWWWWWWSSSSSSSWwWwWwWwWMMMMMMMMM',
    'WWWWWwWWKKKKKKKKWwWwWwWwWMMMMMMMM.',
    '.WWWWW...GG.t.....................',
    '..WWW....Gg.......................',
  ]);
}

export function sniperArt(): PixelArt {
  const a = gun([
    '..........SSSSSSSSS...................',
    '..........SSSSSSSSl...................',
    'OOOOOO.....KSSSSK.....................',
    'OOOOOOOOOOSSSSSSSSSOOOOOOMMMMMMMMMMMMS',
    'OoOOOOOOOOSSddSSSSSOoOoOO.............',
    '.OOOOOO...KKKKKKKKKKKKKKK.............',
    '...OOO....GG.t.mm.....................',
    '..........Gg...mm.....................',
  ]);
  a.set(18, 1, GLASS[3]);
  return a;
}

export function minigunArt(): PixelArt {
  return gun([
    '.....SSSSSSSSSSSSSSSSSSSSSSSS.',
    '..KKSSSSSSSSSSMMMSMMMMMMSMMMMS',
    '.KKKSSSSSSSSSSssssSssssssSssss',
    '.KKKSSSSSSSSSSMMMSMMMMMMSMMMMS',
    '..KKKKKKKKKKKKK...............',
    '....GG.t...mmmm...............',
    '....Gg.....mmmm...............',
  ]);
}

// ------------------------------------------------------------------ melee

const BL = STEEL_LT;

export function knifeArt(): PixelArt {
  const a = draw(15, 3, [
    '.....XBBBBBBBB.',
    'HHHHHXBBBBBBBBB',
    '.....XBBBBBBB..',
  ], { H: POLYMER[2], X: STEEL[1], B: BL[2] });
  finish(a, { shadow: false });
  a.set(1, 1, STEEL[3]).set(3, 1, STEEL[3]);
  for (let x = 6; x <= 12; x++) a.set(x, 2, BL[4]);
  return a;
}

export function swordArt(): PixelArt {
  const a = new PixelArt(42, 5);
  a.rect(1, 1, 6, 3, LEATHER_D);
  a.rect(0, 1, 1, 3, BRASS[2]);
  a.rect(7, 0, 1, 5, BRASS[2]);
  a.rect(8, 1, 32, 3, BL[2]);
  a.set(40, 2, BL[2]);
  a.set(39, 1, -1);
  finish(a, { shadow: false });
  for (let x = 2; x < 7; x += 2) a.set(x, 2, LEATHER_L);
  for (let x = 9; x < 39; x++) a.set(x, 2, BL[3]);
  for (let x = 9; x < 39; x++) a.set(x, 3, BL[4]);
  return a;
}
const LEATHER_D = WOOD_DARK[1];
const LEATHER_L = WOOD_DARK[3];

export function axeArt(): PixelArt {
  const a = new PixelArt(31, 11);
  a.rect(0, 2, 27, 2, WOOD_PALE[2]);
  a.rect(0, 2, 3, 2, WOOD_DARK[2]);
  a.rect(20, 0, 7, 5, STEEL[2]);
  a.poly([[19, 4], [28, 4], [30.5, 11], [17.5, 11]], STEEL[2]);
  a.set(22, 1, STEEL[1]).set(23, 1, STEEL[1]);
  finish(a);
  for (let x = 18; x <= 30; x++) if (a.filled(x, 10)) a.set(x, 10, BL[4]);
  for (let x = 19; x <= 29; x++) if (a.filled(x, 9) && a.filled(x, 10)) a.set(x, 9, BL[3]);
  return a;
}

export function crowbarArt(): PixelArt {
  const a = new PixelArt(32, 6);
  a.rect(3, 2, 27, 2, RED[2]);
  a.rect(29, 2, 3, 2, STEEL[2]);
  a.set(31, 3, -1);
  a.line(0, 0, 3, 3, RED[2]);
  a.line(1, 0, 3, 2, RED[2]);
  a.set(0, 1, RED[2]);
  a.set(0, 0, STEEL[2]).set(1, 0, STEEL[2]);
  return finish(a, { shadow: false });
}

export function batArt(): PixelArt {
  const a = new PixelArt(32, 5);
  a.poly([[0, 1.5], [12, 1.5], [31, 0], [31, 5], [12, 3.5], [0, 3.5]], WOOD_PALE[2]);
  a.rect(0, 1, 2, 3, WOOD_DARK[2]);
  a.rect(3, 1, 6, 3, RUBBER[2]);
  for (let x = 4; x < 9; x += 2) a.set(x, 2, RUBBER[1]);
  return finish(a);
}

export function hammerArt(): PixelArt {
  const a = new PixelArt(30, 10);
  a.rect(0, 4, 24, 2, WOOD_PALE[2]);
  a.rect(0, 4, 5, 2, RUBBER[2]);
  a.rect(23, 0, 7, 10, STEEL[2]);
  a.rect(23, 4, 7, 2, STEEL[1]);
  return finish(a);
}

// ------------------------------------------------------------------ explosives

export function grenadeArt(pinned: boolean): PixelArt {
  const a = new PixelArt(8, 11);
  a.ellipse(0, 3, 8, 8, OLIVE[2]);
  a.hline(1, 6, 6, OLIVE[1]);
  a.hline(1, 6, 8, OLIVE[1]);
  a.vline(3, 4, 9, OLIVE[1]);
  a.rect(2, 1, 4, 3, STEEL[2]);
  a.vline(6, 1, 6, STEEL_LT[2]); // spoon
  a.set(7, 2, STEEL_LT[2]);
  finish(a);
  if (pinned) a.set(0, 0, BRASS[3]).set(1, 0, BRASS[3]).set(0, 1, BRASS[3]).set(1, 2, BRASS[2]);
  return a;
}

export function dynamiteArt(): PixelArt {
  const a = new PixelArt(17, 5);
  a.rect(2, 0, 15, 5, RED[2]);
  a.rect(7, 0, 4, 5, KHAKI[3]);
  a.set(8, 2, RED[0]).set(9, 2, RED[0]);
  finish(a);
  a.line(0, 0, 2, 2, WHITE[2]);
  a.set(1, 0, WHITE[1]);
  return a;
}

export function c4Art(): PixelArt {
  const a = new PixelArt(14, 7);
  a.rect(0, 1, 14, 6, KHAKI[2]);
  a.hline(0, 13, 4, POLYMER[1]);
  a.rect(3, 0, 8, 2, POLYMER[2]);
  finish(a);
  a.set(4, 0, LED_RED).set(9, 0, LED_GREEN);
  a.set(1, 2, KHAKI[3]).set(12, 6, KHAKI[1]);
  return a;
}

export function mineArt(): PixelArt {
  const a = new PixelArt(16, 5);
  a.poly([[1, 5], [15, 5], [13, 1], [3, 1]], OLIVE[2]);
  a.rect(5, 0, 6, 2, STEEL[2]);
  a.hline(2, 13, 4, OLIVE[1]);
  return finish(a);
}

// ------------------------------------------------------------------ machinery

export function motorHousingArt(): PixelArt {
  const a = new PixelArt(16, 16);
  a.roundRect(0, 0, 16, 16, 2, GUNMETAL[3]);
  for (let y = 3; y < 13; y += 2) a.hline(2, 4, y, GUNMETAL[1]);
  a.rect(11, 2, 3, 2, YELLOW[2]);
  finish(a);
  return a;
}

export function rotorArt(): PixelArt {
  const a = new PixelArt(14, 14);
  a.ellipse(0, 0, 14, 14, STEEL[2]);
  a.ellipse(4, 4, 6, 6, STEEL[1]);
  a.hline(1, 12, 6, STEEL[1]);
  a.hline(1, 12, 7, STEEL[1]);
  finish(a);
  a.rect(6, 6, 2, 2, BRASS[3]);
  return a;
}

export function buttonBaseArt(): PixelArt {
  const a = new PixelArt(14, 4);
  a.rect(0, 0, 14, 4, GUNMETAL[2]);
  finish(a);
  a.set(1, 1, STEEL[3]).set(12, 1, STEEL[3]);
  return a;
}

export function buttonCapArt(): PixelArt {
  const a = new PixelArt(8, 3);
  a.rect(0, 0, 8, 3, RED[3]);
  return finish(a, { shadow: false });
}

export function batteryArt(): PixelArt {
  const a = new PixelArt(10, 16);
  a.rect(3, 0, 4, 2, STEEL_LT[2]);
  a.rect(0, 2, 10, 14, POLYMER[2]);
  a.rect(0, 2, 10, 4, ORANGE[2]);
  finish(a);
  a.map(['..YY', '.YY.', 'YYYY', '.YY.', 'YY..'], { Y: YELLOW[3] }, 3, 8);
  return a;
}

export function bulbArt(lit: boolean): PixelArt {
  const a = new PixelArt(8, 12);
  if (lit) {
    a.ellipse(0, 0, 8, 8, LAMP);
    a.ellipse(2, 2, 4, 4, 0xffffff);
  } else {
    a.ellipse(0, 0, 8, 8, GLASS[2]);
  }
  a.rect(2, 7, 4, 5, STEEL[2]);
  a.hline(2, 5, 9, STEEL[1]);
  a.hline(2, 5, 11, STEEL[0]);
  finish(a, { light: !lit, shadow: false });
  if (!lit) a.set(2, 2, GLASS[4]).set(2, 3, GLASS[4]);
  else for (const [x, y] of [[0, 3], [0, 4], [7, 3], [7, 4], [3, 0], [4, 0]]) a.set(x, y, 0xf3d27a);
  return a;
}

export function thrusterArt(): PixelArt {
  const a = new PixelArt(14, 10);
  a.rect(5, 1, 9, 8, GUNMETAL[3]);
  a.poly([[0, 0], [6, 2], [6, 8], [0, 10]], GUNMETAL[2]);
  a.vline(8, 1, 8, GUNMETAL[2]);
  finish(a);
  a.rect(10, 3, 2, 2, YELLOW[2]);
  a.vline(0, 1, 8, COPPER[1]);
  return a;
}

export function wheelArt(): PixelArt {
  const a = new PixelArt(20, 20);
  a.ellipse(0, 0, 20, 20, RUBBER[2]);
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    a.set(Math.round(9.5 + Math.cos(t) * 8.6), Math.round(9.5 + Math.sin(t) * 8.6), RUBBER[1]);
  }
  a.ellipse(4, 4, 12, 12, STEEL[2]);
  a.ellipse(6, 6, 8, 8, STEEL[1]);
  a.ellipse(8, 8, 4, 4, STEEL[3]);
  return finish(a);
}

// ------------------------------------------------------------------ tool icons (catalog previews)

function icon(rows: string[], pal: Record<string, Color>): PixelArt {
  return finish(draw(rows[0].length, rows.length, rows, pal), { shadow: false, light: false });
}

export function toolIcon(kind: string): PixelArt {
  const rope = WOOD_PALE[3];
  const steel = STEEL_LT[3];
  const gold = BRASS[3];
  const dark = GUNMETAL[2];
  switch (kind) {
    case 'rope':
      return icon(
        ['....bbbb....', '..bbbbbbbb..', '.bbb....bbb.', '.bb.bbbb.bb.', '.bb.b..b.bb.', '.bb.bbbb.bb.', '.bbb....bbb.', '..bbbbbbbb..', '....bbbbbb..', '.........bb.', '..........b.', '..........b.'],
        { b: rope },
      );
    case 'weld':
      return icon(
        ['ssssssss....', 'ssssssss....', 'ssddssss....', 'ssddssss....', 'ssssssssss..', 'ssssssssss..', '....ssddss..', '....ssddss..', '....ssssss..', '....ssssss..'],
        { s: steel, d: dark },
      );
    case 'spring':
      return icon(
        ['dddddddd', '.ssssss.', '..ssss..', '.ssssss.', '..ssss..', '.ssssss.', '..ssss..', '.ssssss.', 'dddddddd'],
        { s: steel, d: dark },
      );
    case 'hinge':
      return icon(
        ['ssss........', 'ssss........', 'ssssgg......', 'ssssgggg....', '....gddg....', '....gddg....', '....ggggssss', '......ggssss', '........ssss', '........ssss'],
        { s: steel, g: gold, d: dark },
      );
    case 'pin':
      return icon(['..gggg..', '.gggggg.', '.ggddgg.', '.gggggg.', '..gggg..', '...ss...', '...ss...', '...ss...', '....s...'], { g: gold, s: steel, d: dark });
    case 'wire':
      return icon(
        ['rr..........', 'rrr.........', '.rrr.....rr.', '..rrr...rrrr', '...rrrrrr.rr', '....rrrr..rr', '..........rr', '..dd.....rr.', '.dddd...rr..', '..dd....rr..'],
        { r: COPPER[3], d: dark },
      );
    case 'remove':
    default:
      return icon(
        ['rr........rr', 'rrr......rrr', '.rrr....rrr.', '..rrr..rrr..', '...rrrrrr...', '....rrrr....', '....rrrr....', '...rrrrrr...', '..rrr..rrr..', '.rrr....rrr.', 'rrr......rrr', 'rr........rr'],
        { r: step(RED[3], 0) },
      );
  }
}

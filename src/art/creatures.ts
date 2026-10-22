import { PixelArt, type Color } from './PixelArt';
import { finish, farSide, draw, ramp, type Ramp } from './palette';

// Animal sprites, drawn facing right like everything else: shared letter scheme
//   fur  d f F G   dark fur  q k K   light fur  l L   nose/pads n   eye e   inner ear/tongue p

export type CreatureKind = 'dog' | 'cat' | 'pig' | 'fox';

interface Coat {
  fur: Ramp;
  dark: Ramp;
  light: Ramp;
  nose: Color;
  eye: Color;
  pink: Color;
}

const COATS: Record<CreatureKind, Coat> = {
  dog: { fur: ramp('#a8703c'), dark: ramp('#5c3a22', 1.05), light: ramp('#dcc093', 0.85), nose: 0x1d1714, eye: 0x1d1410, pink: 0xc06a6a },
  cat: { fur: ramp('#8c8781'), dark: ramp('#4a4644', 1.05), light: ramp('#d8d3cb', 0.8), nose: 0xc98b88, eye: 0x9ccf4a, pink: 0xd29a96 },
  // dark = ears, snout and trotters
  pig: { fur: ramp('#e09f97', 0.9), dark: ramp('#b86f6c', 1.0), light: ramp('#f0c4bb', 0.8), nose: 0x7a3b3b, eye: 0x241614, pink: 0xd0827d },
  // dark = ear backs and stockings; light = white bib, muzzle and tail tip
  fox: { fur: ramp('#c8682c'), dark: ramp('#30251f', 1.05), light: ramp('#e9e1d3', 0.8), nose: 0x1a1412, eye: 0x24170f, pink: 0xc06a6a },
};

function pal(c: Coat): Record<string, Color> {
  return {
    d: c.fur[1], f: c.fur[2], F: c.fur[3], G: c.fur[4],
    q: c.dark[1], k: c.dark[2], K: c.dark[3],
    l: c.light[2], L: c.light[3],
    n: c.nose, e: c.eye, p: c.pink,
  };
}

/** Where the eye sits on each head sprite (for blinking and death). */
export const CREATURE_EYE: Record<CreatureKind, { x: number; y: number; open: Color; closed: Color; dead: Color }> = {
  dog: { x: 5, y: 3, open: COATS.dog.eye, closed: COATS.dog.fur[1], dead: 0x3a2a22 },
  cat: { x: 4, y: 3, open: COATS.cat.eye, closed: COATS.cat.fur[1], dead: 0x3d3a37 },
  pig: { x: 7, y: 4, open: COATS.pig.eye, closed: COATS.pig.fur[1], dead: 0x5a3434 },
  fox: { x: 6, y: 4, open: COATS.fox.eye, closed: COATS.fox.fur[1], dead: 0x3a2418 },
};

/**
 * The chest is drawn over the hindquarters: dropping its back outline lets the
 * two read as one body instead of two boxes.
 */
function openBack(a: PixelArt): PixelArt {
  for (let y = 1; y < a.h - 1; y++) {
    let x = 0;
    while (x < a.w && !a.filled(x, y)) x++;
    // the outline and the lit band inside it both take the fur color behind them
    if (x + 2 < a.w && a.filled(x + 2, y)) {
      const c = a.get(x + 2, y);
      a.set(x, y, c).set(x + 1, y, c);
    }
  }
  return a;
}

// ---------------------------------------------------------------- dog

function dogPart(base: string, c: Coat): PixelArt {
  const P = pal(c);
  switch (base) {
    case 'head': {
      // ear flops over the back of the skull; long muzzle to the right
      const a = draw(12, 10, [
        '..kkk.......',
        '.kKffff.....',
        'kKfFfFff....',
        'kkfffffffff.',
        'kkffffffffln',
        '.kfffflllll.',
        '.kkfflllll..',
        '..kffll.....',
        '...ffl......',
        '............',
      ], P);
      finish(a);
      a.set(5, 3, c.eye).set(4, 2, c.fur[1]);
      a.set(11, 4, c.nose).set(10, 3, c.fur[3]);
      a.set(9, 6, c.light[1]).set(8, 6, c.pink);
      return a;
    }
    case 'chest':
      return openBack(finish(draw(14, 11, [
        '..ffffffffff..',
        '.fFFFFFFFFFff.',
        'ffffffffffffff',
        'ffffffffffffff',
        'fffffffffffffl',
        'ffffffffffffll',
        'fffffffffflllL',
        'ffffffffflllll',
        '.ffffffflllll.',
        '..fffffflll...',
        '....ffff......',
      ], P)));
    case 'hips':
      return finish(draw(12, 9, [
        '.kkkkffffff.',
        'kKKkfFFFFFff',
        'kkkffffffffF',
        'kkfffffffffF',
        'fffffffffffl',
        'ffffffffffll',
        'ffffffffflll',
        '.fffffffffl.',
        '..ffffff....',
      ], P));
    case 'tail':
      return finish(draw(9, 4, [
        'kk.......',
        'kkkf.....',
        '.kffffff.',
        '...fffffF',
      ], P));
    case 'upperFront':
      return finish(draw(4, 8, ['ffff', 'fFff', 'ffff', 'ffff', 'ffff', 'fff.', 'fff.', 'fff.'], P));
    case 'lowerFront':
      return finish(draw(4, 7, ['fff.', 'fff.', 'fff.', 'fff.', 'ffl.', 'llll', 'lllL'], P));
    case 'upperBack':
      return finish(draw(5, 9, ['.fff.', 'fffff', 'fFfff', 'fffff', 'fffff', 'ffff.', '.fff.', '.fff.', '.fff.'], P));
    default: // lowerBack
      return finish(draw(5, 7, ['.fff.', '.fff.', '.fff.', '.fff.', '.ffl.', 'lllll', 'llllL'], P));
  }
}

// ---------------------------------------------------------------- cat

function catPart(base: string, c: Coat): PixelArt {
  const P = pal(c);
  switch (base) {
    case 'head': {
      // pointed ears, short muzzle, stripes on the brow
      const a = draw(9, 8, [
        '.k...k...',
        'kpk.kpk..',
        'kfkfkfff.',
        'fffffffff',
        'fffffffLn',
        '.fffflll.',
        '.fflllll.',
        '..ffll...',
      ], P);
      finish(a);
      a.set(4, 3, c.eye).set(5, 3, 0x1b1d12);
      a.set(8, 4, c.nose);
      return a;
    }
    case 'chest':
      return openBack(finish(draw(9, 7, [
        '.fkfkfff.',
        'fffffffff',
        'ffffffffl',
        'fffffffll',
        'ffffffllL',
        '.fffflll.',
        '..ffll...',
      ], P)));
    case 'hips':
      return finish(draw(8, 6, [
        '.kfkfkf.',
        'ffffffff',
        'ffffffff',
        'fffffffl',
        '.ffffffl',
        '..ffff..',
      ], P));
    case 'tail':
      // held up and curling over at the tip; too thin for an outline
      return finish(draw(7, 8, [
        '.kk....',
        'kfk....',
        'kf.....',
        'fk.....',
        'kf.....',
        '.kfk...',
        '..fkfk.',
        '....kfk',
      ], P), { outline: false });
    case 'upperFront':
      return finish(draw(3, 5, ['fff', 'fFf', 'fff', 'fff', 'ff.'], P));
    case 'lowerFront':
      return finish(draw(3, 4, ['ff.', 'ff.', 'fl.', 'llL'], P));
    case 'upperBack':
      return finish(draw(4, 6, ['ffff', 'fFff', 'ffff', 'fff.', '.ff.', '.ff.'], P));
    default: // lowerBack
      return finish(draw(4, 4, ['.ff.', '.ff.', '.fl.', 'lllL'], P));
  }
}

// ---------------------------------------------------------------- pig

function pigPart(base: string, c: Coat): PixelArt {
  const P = pal(c);
  switch (base) {
    case 'head': {
      // big head, ear flopped forward over the eye, flat snout on the end
      const a = draw(13, 11, [
        '..kk.........',
        '.kKKk........',
        '.fkkkk.......',
        'ffffffff.....',
        'fFfffffffff..',
        'fffffffffffpp',
        'ffffffffffppp',
        'ffffffffffppp',
        '.fffffffffpp.',
        '..ffflllll...',
        '....fff......',
      ], { ...P, p: c.pink });
      finish(a);
      a.set(7, 4, c.eye).set(6, 3, c.fur[1]);
      a.set(12, 6, c.nose).set(12, 7, c.nose);
      return a;
    }
    case 'chest':
      return openBack(finish(draw(13, 12, [
        '...fffffff...',
        '.ffFFFFFFFff.',
        'fffffffffffff',
        'fffffffffffff',
        'fffffffffffff',
        'fffffffffffff',
        'fffffffffffff',
        'ffffffffffffl',
        'fffffffffffll',
        '.fffffffffll.',
        '..ffffffffl..',
        '....fffff....',
      ], P)));
    case 'hips':
      return finish(draw(12, 12, [
        '...fffffff..',
        '.ffFFFFFFfff',
        'ffffffffffff',
        'ffffffffffff',
        'ffffffffffff',
        'ffffffffffff',
        'ffffffffffff',
        'ffffffffffff',
        'ffffffffffff',
        '.fffffffffff',
        '..ffffffffff',
        '....ffffff..',
      ], P));
    case 'tail':
      // a curl; too thin for an outline
      return finish(draw(6, 5, [
        '.kk...',
        'k..k..',
        'k.kk..',
        '.k..kk',
        '.....k',
      ], P), { outline: false });
    case 'upperFront':
      return finish(draw(4, 4, ['ffff', 'fFff', 'ffff', 'fff.'], P));
    case 'lowerFront':
      return finish(draw(4, 3, ['fff.', 'kkk.', 'kkkK'], P));
    case 'upperBack':
      return finish(draw(4, 4, ['ffff', 'fFff', 'ffff', '.fff'], P));
    default: // lowerBack
      return finish(draw(4, 3, ['.fff', '.kkk', 'kkkK'], P));
  }
}

// ---------------------------------------------------------------- fox

function foxPart(base: string, c: Coat): PixelArt {
  const P = pal(c);
  switch (base) {
    case 'head': {
      // tall pointed ears, long thin muzzle, white cheeks
      const a = draw(11, 9, [
        '.k..k......',
        '.kf.kf.....',
        'kffkfff....',
        'fFffffff...',
        'fffffffff..',
        'fffffffffff',
        '.fflllllll.',
        '..lllll....',
        '...ll......',
      ], P);
      finish(a);
      a.set(6, 4, c.eye).set(5, 3, c.fur[1]);
      a.set(10, 5, c.nose);
      return a;
    }
    case 'chest':
      return openBack(finish(draw(11, 8, [
        '..fffffff..',
        '.fFFFFFFff.',
        'fffffffffff',
        'ffffffffffl',
        'fffffffflll',
        'ffffffflllL',
        '.fffflllll.',
        '...ffll....',
      ], P)));
    case 'hips':
      return finish(draw(10, 7, [
        '.ffffffff.',
        'fFFFFFFfff',
        'ffffffffff',
        'ffffffffff',
        'ffffffffff',
        '.ffffffff.',
        '..ffff....',
      ], P));
    case 'tail':
      // big and bushy, white at the tip
      return finish(draw(12, 6, [
        '....ffffff..',
        '..ffFFFFfff.',
        'lLffffffffff',
        'lllffffffff.',
        '.llfffff....',
        '..ll........',
      ], P));
    case 'upperFront':
      return finish(draw(3, 7, ['fff', 'fFf', 'fff', 'fff', 'fff', 'ff.', 'kk.'], P));
    case 'lowerFront':
      return finish(draw(3, 6, ['kk.', 'kk.', 'kk.', 'kk.', 'kkk', 'kkK'], P));
    case 'upperBack':
      return finish(draw(4, 8, ['.ff.', 'ffff', 'fFff', 'ffff', 'fff.', '.ff.', '.ff.', '.kk.'], P));
    default: // lowerBack
      return finish(draw(4, 6, ['.kk.', '.kk.', '.kk.', '.kk.', 'kkkk', 'kkkK'], P));
  }
}

const PARTS: Record<CreatureKind, (base: string, c: Coat) => PixelArt> = { dog: dogPart, cat: catPart, pig: pigPart, fox: foxPart };

const cache = new Map<string, PixelArt>();

/** One body part's sprite; keys ending in B are the far-side legs (shaded darker). */
export function creatureArt(kind: CreatureKind, key: string): PixelArt {
  const ck = `${kind}:${key}`;
  let a = cache.get(ck);
  if (a) return a;
  const base = key.replace(/[FB]$/, '');
  a = PARTS[kind](base, COATS[kind]);
  if (/[a-z]B$/.test(key)) a = farSide(a);
  cache.set(ck, a);
  return a;
}

/** Composite of a standing animal for the catalog, from its part layout ([key, cx, cy] in px, y up). */
export function creatureFigure(kind: CreatureKind, layout: [string, number, number, number][]): PixelArt {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const [key, cx, cy] of layout) {
    const a = creatureArt(kind, key);
    minX = Math.min(minX, cx - a.w / 2);
    maxX = Math.max(maxX, cx + a.w / 2);
    maxY = Math.max(maxY, cy + a.h / 2);
  }
  const W = Math.ceil(maxX - minX) + 2;
  const H = Math.ceil(maxY) + 1;
  const out = new PixelArt(W, H);
  // far side first, then the body, then the near legs (by layer)
  for (const [key, cx, cy] of [...layout].sort((p, q) => p[3] - q[3])) {
    const a = creatureArt(kind, key);
    out.blit(a, Math.round(cx - a.w / 2 - minX + 1), Math.round(H - cy - a.h / 2));
  }
  return out;
}

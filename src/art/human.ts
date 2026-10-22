import { PixelArt, hex, shade, type Color } from './PixelArt';

export type LimbKey =
  | 'head' | 'upperTorso' | 'midTorso' | 'lowerTorso'
  | 'upperArmF' | 'lowerArmF' | 'handF'
  | 'upperArmB' | 'lowerArmB' | 'handB'
  | 'upperLegF' | 'lowerLegF' | 'footF'
  | 'upperLegB' | 'lowerLegB' | 'footB';

export type BodyKind = 'human' | 'android';

export interface Skin {
  skin: Color;
  hair: Color;
  shirt: Color;
  pants: Color;
  shoes: Color;
  belt: Color;
}

export const HUMAN_SKIN: Skin = {
  skin: hex('#d4a37f'),
  hair: hex('#3b2b20'),
  shirt: hex('#5b6c7b'),
  pants: hex('#3d424d'),
  shoes: hex('#2f2824'),
  belt: hex('#3b2d22'),
};

/** Face pixel positions on the head sprite (art coords) used for expressions. */
export const EYE = { x: 7, y: 5 };
export const MOUTH = { x: 8, y: 9 };

function finish(a: PixelArt, light = 1.1, dark = 0.86): PixelArt {
  return a.bevel(light, dark, 1).outline(0.55);
}

// ---------------------------------------------------------------- human

function humanHead(s: Skin): PixelArt {
  const a = new PixelArt(10, 11);
  const S = shade(s.skin, 0.86);
  a.map(
    [
      '..hhhhh...',
      '.hhhhhhhh.',
      'hhhhhhhhh.',
      'hhhhhhhss.',
      'hhhhsssbs.',
      'hhhEEssss.',
      'hhhEEsssss',
      'hhhssssss.',
      '.hhssssss.',
      '..sssssSs.',
      '...SsssS..',
    ],
    { h: s.hair, s: s.skin, S, E: shade(s.skin, 0.8), b: shade(s.hair, 0.9) },
  );
  // hair texture
  a.set(2, 1, shade(s.hair, 1.25)).set(4, 0, shade(s.hair, 1.2)).set(6, 1, shade(s.hair, 1.15)).set(1, 3, shade(s.hair, 0.85));
  finish(a, 1.08, 0.88);
  a.set(EYE.x, EYE.y, hex('#22180f'));
  a.set(MOUTH.x, MOUTH.y, shade(s.skin, 0.62));
  return a;
}

function humanUpperTorso(s: Skin): PixelArt {
  const a = new PixelArt(9, 12);
  const c = s.shirt;
  a.map(
    [
      '...sss...',
      '...sss...',
      '.cCCCCCc.',
      'ccccccccc',
      'ccccccccc',
      'ccccccccc',
      'ccccccccc',
      'cccccccc.',
      'cccccccc.',
      '.ccccccc.',
      '.ccccccc.',
      '.ccccccc.',
    ],
    { s: shade(s.skin, 0.9), c, C: shade(c, 0.8) },
  );
  a.vline(2, 4, 10, shade(c, 0.92));
  a.set(7, 5, shade(c, 1.08)).set(7, 6, shade(c, 1.08));
  return finish(a);
}

function humanMidTorso(s: Skin): PixelArt {
  const a = new PixelArt(8, 7);
  a.rect(0, 0, 8, 7, s.shirt);
  a.set(0, 0, -1).set(0, 6, -1);
  a.hline(2, 5, 3, shade(s.shirt, 0.92));
  return finish(a);
}

function humanLowerTorso(s: Skin): PixelArt {
  const a = new PixelArt(9, 8);
  a.map(
    [
      '.ccccccc.',
      'bbbbbbbBb',
      'ppppppppp',
      'ppppppppp',
      'ppppppppp',
      'ppppppppp',
      'pppppppp.',
      '.pppppp..',
    ],
    { c: s.shirt, b: s.belt, B: hex('#a08a5a'), p: s.pants },
  );
  a.vline(6, 3, 6, shade(s.pants, 0.85));
  return finish(a);
}

function humanUpperArm(s: Skin): PixelArt {
  const a = new PixelArt(4, 12);
  a.roundRect(0, 0, 4, 12, 1, s.skin);
  a.rect(0, 0, 4, 6, s.shirt);
  a.set(0, 0, -1).set(3, 0, -1);
  a.hline(0, 3, 5, shade(s.shirt, 0.78));
  return finish(a);
}

function humanLowerArm(s: Skin): PixelArt {
  const a = new PixelArt(4, 11);
  a.roundRect(0, 0, 4, 11, 1, s.skin);
  a.vline(3, 3, 8, shade(s.skin, 1.04));
  return finish(a);
}

function humanHand(s: Skin): PixelArt {
  const a = new PixelArt(4, 5);
  a.map(['.ss.', 'ssss', 'sssT', 'ssss', '.ss.'], { s: s.skin, T: shade(s.skin, 1.06) });
  a.set(1, 3, shade(s.skin, 0.85));
  return finish(a);
}

function humanUpperLeg(s: Skin): PixelArt {
  const a = new PixelArt(5, 12);
  a.roundRect(0, 0, 5, 12, 1, s.pants);
  a.vline(1, 2, 9, shade(s.pants, 0.9));
  return finish(a);
}

function humanLowerLeg(s: Skin): PixelArt {
  const a = new PixelArt(4, 12);
  a.roundRect(0, 0, 4, 12, 1, s.pants);
  a.hline(0, 3, 11, shade(s.pants, 0.75));
  return finish(a);
}

function humanFoot(s: Skin): PixelArt {
  const a = new PixelArt(8, 3);
  a.map(['ssssss..', 'sssssssS', 'kkkkkkkk'], { s: s.shoes, S: shade(s.shoes, 1.1), k: shade(s.shoes, 0.6) });
  a.set(4, 0, shade(s.shoes, 1.35));
  return finish(a, 1.15, 0.9);
}

// ---------------------------------------------------------------- android

const METAL = hex('#8c96a1');
const METAL_D = hex('#59616b');
const DARK = hex('#363b42');
const GLOW = hex('#64d8e6');

function androidHead(): PixelArt {
  const a = new PixelArt(10, 11);
  a.map(
    [
      '..mmmmmm..',
      '.mmmmmmmm.',
      'mmmmmmmmmm',
      'mmmmmmmmmm',
      'mmmmmvvvvm',
      'mmmBBvGGvm',
      'mmmBBvvvvm',
      'mmmmmmmmmm',
      '.mmmdddmmm',
      '..mmmmmmm.',
      '...dddddd.',
    ],
    { m: METAL, d: METAL_D, v: DARK, G: GLOW, B: METAL_D },
  );
  a.set(2, 1, shade(METAL, 1.2)).set(3, 2, shade(METAL, 1.12));
  finish(a, 1.12, 0.84);
  a.set(EYE.x - 1, EYE.y, GLOW).set(EYE.x, EYE.y, GLOW);
  return a;
}

function androidPlate(w: number, h: number, base: Color, opts: { light?: boolean; capTop?: boolean; capBottom?: boolean } = {}): PixelArt {
  const a = new PixelArt(w, h);
  a.roundRect(0, 0, w, h, 1, base);
  if (opts.capTop) a.rect(0, 0, w, 2, DARK);
  if (opts.capBottom) a.rect(0, h - 2, w, 2, DARK);
  if (h > 6) a.vline(Math.floor(w / 2), 3, h - 4, shade(base, 0.86));
  if (opts.light) a.set(w - 2, 3, GLOW);
  return finish(a, 1.14, 0.82);
}

function androidUpperTorso(): PixelArt {
  const a = new PixelArt(9, 12);
  a.map(
    [
      '...ddd...',
      '...ddd...',
      '.mmmmmmm.',
      'mmmmmmmmm',
      'mmvvvvvmm',
      'mmvmmmvmm',
      'mmvmmGvmm',
      'mmvvvvvm.',
      'mmmmmmmm.',
      '.mmmmmmm.',
      '.dmdmdmd.',
      '.ddddddd.',
    ],
    { m: METAL, d: DARK, v: METAL_D, G: GLOW },
  );
  return finish(a, 1.12, 0.84);
}

function androidLowerTorso(): PixelArt {
  const a = new PixelArt(9, 8);
  a.map(
    ['.ddddddd.', 'mmmmmmmmm', 'mmmmmmmmm', 'mmvvvvvmm', 'mmmmmmmmm', 'mmmmmmmmm', 'mmmmmmmm.', '.mmmmmm..'],
    { m: METAL_D, d: DARK, v: DARK },
  );
  return finish(a, 1.15, 0.85);
}

function androidFoot(): PixelArt {
  const a = new PixelArt(8, 3);
  a.map(['mmmmmm..', 'mmmmmmmm', 'dddddddd'], { m: METAL_D, d: DARK });
  return finish(a, 1.15, 0.9);
}

function androidHand(): PixelArt {
  const a = new PixelArt(4, 5);
  a.map(['dddd', 'mmmm', 'mmmm', 'm.mm', 'm.m.'], { m: METAL, d: DARK });
  return finish(a, 1.1, 0.85);
}

export interface BodyArt {
  get(key: LimbKey): PixelArt;
}

const cache = new Map<string, PixelArt>();

/** Returns the (cached) sprite for a body part. Back limbs are darker for depth. */
export function limbArt(kind: BodyKind, key: LimbKey, skin: Skin = HUMAN_SKIN, skinKey = 'default'): PixelArt {
  const ck = `${kind}:${skinKey}:${key}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const base = key.replace(/[FB]$/, '');
  let a: PixelArt;
  if (kind === 'human') {
    switch (base) {
      case 'head': a = humanHead(skin); break;
      case 'upperTorso': a = humanUpperTorso(skin); break;
      case 'midTorso': a = humanMidTorso(skin); break;
      case 'lowerTorso': a = humanLowerTorso(skin); break;
      case 'upperArm': a = humanUpperArm(skin); break;
      case 'lowerArm': a = humanLowerArm(skin); break;
      case 'hand': a = humanHand(skin); break;
      case 'upperLeg': a = humanUpperLeg(skin); break;
      case 'lowerLeg': a = humanLowerLeg(skin); break;
      default: a = humanFoot(skin); break;
    }
  } else {
    switch (base) {
      case 'head': a = androidHead(); break;
      case 'upperTorso': a = androidUpperTorso(); break;
      case 'midTorso': a = androidPlate(8, 7, METAL_D); break;
      case 'lowerTorso': a = androidLowerTorso(); break;
      case 'upperArm': a = androidPlate(4, 12, METAL, { capTop: true }); break;
      case 'lowerArm': a = androidPlate(4, 11, METAL, { capTop: true, light: true }); break;
      case 'hand': a = androidHand(); break;
      case 'upperLeg': a = androidPlate(5, 12, METAL, { capTop: true }); break;
      case 'lowerLeg': a = androidPlate(4, 12, METAL, { capTop: true }); break;
      default: a = androidFoot(); break;
    }
  }
  if (key.endsWith('B')) a = a.clone().tint(0.74);
  cache.set(ck, a);
  return a;
}

/** Composite preview of a standing figure (for the catalog). */
export function figurePreview(kind: BodyKind, skin: Skin = HUMAN_SKIN, skinKey = 'default'): HTMLCanvasElement {
  // standing layout in art pixels: [key, left, top]
  const W = 14;
  const H = 56;
  const out = new PixelArt(W, H);
  const place = (key: LimbKey, cx: number, cyFromBottom: number) => {
    const a = limbArt(kind, key, skin, skinKey);
    out.blit(a, Math.round(cx - a.w / 2), Math.round(H - cyFromBottom - a.h / 2));
  };
  const ox = 5;
  place('upperArmB', ox + 0.5, 37);
  place('lowerArmB', ox + 0.5, 27.5);
  place('handB', ox + 0.5, 21);
  place('upperLegB', ox + 0.5, 17.5);
  place('lowerLegB', ox + 0.5, 7.5);
  place('footB', ox + 2, 1.5);
  place('lowerTorso', ox, 25);
  place('midTorso', ox, 30.5);
  place('upperTorso', ox, 38.5);
  place('head', ox + 0.5, 49);
  place('upperLegF', ox, 17.5);
  place('lowerLegF', ox, 7.5);
  place('footF', ox + 1.5, 1.5);
  place('upperArmF', ox, 37);
  place('lowerArmF', ox, 27.5);
  place('handF', ox, 21);
  return out.toCanvas(1);
}

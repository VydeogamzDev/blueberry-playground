import { PixelArt, type Color } from './PixelArt';
import {
  finish, farSide, draw, ramp, SKIN, HAIR, SHIRT, PANTS, SHOE, LEATHER, BRASS, EYE_C, ROBOT, ROBOT_DK, GUNMETAL, GLOW,
  type Ramp,
} from './palette';

export type LimbKey =
  | 'head' | 'upperTorso' | 'midTorso' | 'lowerTorso'
  | 'upperArmF' | 'lowerArmF' | 'handF'
  | 'upperArmB' | 'lowerArmB' | 'handB'
  | 'upperLegF' | 'lowerLegF' | 'footF'
  | 'upperLegB' | 'lowerLegB' | 'footB';

export type BodyKind = 'human' | 'android';

/** How a body is made: anyone's, or Grant's (short, broad and built different). */
export type Build = 'standard' | 'grant';

export interface Skin {
  skin: Ramp;
  hair: Ramp;
  shirt: Ramp;
  pants: Ramp;
  shoes: Ramp;
  belt: Ramp;
}

export const HUMAN_SKIN: Skin = { skin: SKIN, hair: HAIR, shirt: SHIRT, pants: PANTS, shoes: SHOE, belt: LEATHER };
/** Grant: a black T-shirt, dark jeans and boots, a dark beard. */
export const GRANT_SKIN: Skin = {
  skin: ramp('#c08a66', 0.85), hair: ramp('#3a2a20', 1.1), shirt: ramp('#34363b', 1.1),
  pants: ramp('#33435e'), shoes: ramp('#2e2622', 1.2), belt: ramp('#2a2420', 1.1),
};
/** His sunglasses, and the glint on them. */
const SHADES = 0x15161a;
const GLINT = 0x6a7a8c;

/** Face pixel positions on the head sprite (art coords) used for expressions. */
export const EYE = { x: 7, y: 5 };
export const MOUTH = { x: 7, y: 8 };

/** Face colors for each expression state (Grant's eyes are behind his shades, whatever they're doing). */
export function faceColors(kind: BodyKind, skin: Skin = HUMAN_SKIN, build: Build = 'standard') {
  if (kind === 'android') return { eye: GLOW, eyeDim: 0x1f6b74, eyeDead: 0x2a2f35, mouth: -1, mouthDead: -1 };
  if (build === 'grant') return { eye: SHADES, eyeClosed: SHADES, eyeDead: SHADES, mouth: skin.skin[1], mouthDead: 0x3a1f1a };
  return { eye: EYE_C, eyeClosed: skin.skin[1], eyeDead: 0x4a3a33, mouth: skin.skin[1], mouthDead: 0x3a1f1a };
}

// Shared letter scheme for body sprites (light comes from the top-left):
//   skin  k s S W   hair  q h H J   shirt x c C   pants y p P   shoes f o O
function pal(s: Skin): Record<string, Color> {
  return {
    k: s.skin[1], s: s.skin[2], S: s.skin[3], W: s.skin[4], n: s.skin[0],
    q: s.hair[1], h: s.hair[2], H: s.hair[3], J: s.hair[4],
    x: s.shirt[1], c: s.shirt[2], C: s.shirt[3], X: s.shirt[0],
    y: s.pants[1], p: s.pants[2], P: s.pants[3], Y: s.pants[0],
    f: s.shoes[1], o: s.shoes[2], O: s.shoes[3], F: s.shoes[0],
    b: s.belt[2], B: s.belt[1], g: BRASS[3], G: BRASS[2],
    e: EYE_C,
  };
}

// ---------------------------------------------------------------- human

function humanHead(s: Skin): PixelArt {
  const a = draw(10, 11, [
    '..hhhhh...',
    '.hhhhhhhh.',
    'hhhhhhhhhh',
    'hhhhhhhhs.',
    'hhhhhhsss.',
    'hhhhssssss',
    'hhhsksssss',
    'hhhssssss.',
    '.hqssssss.',
    '..qssssss.',
    '...kssss..',
  ], pal(s));
  // a few lighter strands
  a.set(3, 1, s.hair[3]).set(4, 1, s.hair[3]).set(2, 2, s.hair[3]).set(6, 2, s.hair[3]);
  finish(a, { shadow: true });
  // face details go on after the lighting pass
  a.set(EYE.x, EYE.y, EYE_C);
  a.set(EYE.x, EYE.y - 1, s.hair[1]); // brow
  a.set(8, 4, s.hair[1]);
  a.set(8, 7, s.skin[1]); // under the nose
  a.set(MOUTH.x, MOUTH.y, s.skin[1]);
  a.set(4, 6, s.skin[1]).set(4, 5, s.skin[2]); // ear
  return a;
}

function humanUpperTorso(s: Skin): PixelArt {
  const a = draw(10, 12, [
    '....sss...',
    '....kss...',
    '.ccccXccc.',
    'ccCCcccCcc',
    'cCCccccCCc',
    'cCcccxcCcc',
    'cccccxcccc',
    'cccccxcccc',
    'ccccccccc.',
    '.cccccccc.',
    '.cccccccc.',
    '.cccccccc.',
  ], pal(s));
  return finish(a);
}

function humanMidTorso(s: Skin): PixelArt {
  const a = draw(9, 7, [
    '.ccccccc.',
    'cccccxccc',
    'cCcccxccc',
    'cCcccccxc',
    'cccccccxc',
    'ccccccccc',
    '.ccccccc.',
  ], pal(s));
  return finish(a);
}

function humanLowerTorso(s: Skin): PixelArt {
  const a = draw(10, 8, [
    '.cccccccc.',
    'bbbbbbbgGb',
    'pPpppppypp',
    'pPppppypPp',
    'ppppppyppp',
    'pppppppppp',
    'ppppypppp.',
    '.pppppppp.',
  ], pal(s));
  return finish(a);
}

function humanUpperArm(s: Skin): PixelArt {
  const a = draw(4, 12, [
    '.cc.',
    'cccc',
    'cccc',
    'cccc',
    'cccc',
    'xxxx',
    'ssss',
    'ssss',
    'ssss',
    'ssss',
    'ssks',
    '.ss.',
  ], pal(s));
  return finish(a, { shadow: false });
}

function humanLowerArm(s: Skin): PixelArt {
  const a = draw(4, 11, [
    '.ss.',
    'ssss',
    'ssss',
    'ssss',
    'ssss',
    'ssss',
    'ssss',
    'ssks',
    'ssss',
    'ssss',
    '.ss.',
  ], pal(s));
  return finish(a, { shadow: false });
}

function humanHand(s: Skin): PixelArt {
  const a = draw(4, 5, [
    '.ss.',
    'ssss',
    'ssss',
    'ssks',
    '.ss.',
  ], pal(s));
  return finish(a, { shadow: false });
}

function humanUpperLeg(s: Skin): PixelArt {
  const a = draw(6, 12, [
    '.pppp.',
    'pppppp',
    'pppppp',
    'ppppyp',
    'ppppyp',
    'pppppp',
    'pppppp',
    'pppppp',
    'pppppp',
    'pppppp',
    'pppppp',
    '.pppp.',
  ], pal(s));
  return finish(a);
}

function humanLowerLeg(s: Skin): PixelArt {
  const a = draw(5, 12, [
    '.ppp.',
    'ppppp',
    'ppppp',
    'ppppp',
    'ppppp',
    'ppppp',
    'pppyp',
    'ppppp',
    'ppppp',
    'ppppp',
    'yyyyy',
    'yyyyy',
  ], pal(s));
  return finish(a);
}

function humanFoot(s: Skin): PixelArt {
  const a = draw(8, 3, [
    'oooooo..',
    'oOOoooOo',
    'FFFFFFFF',
  ], pal(s));
  return finish(a, { shadow: false });
}

// ---------------------------------------------------------------- Grant
// Short arms and legs, a head like anyone's, a broad chest and a thick neck:
// a buzz cut, a full beard and sunglasses he never takes off.

function grantHead(s: Skin): PixelArt {
  const a = draw(10, 11, [
    '..qhhhq...',
    '.qhhhhhhq.',
    'qhhsssssss',
    'qhssssssss',
    'qhssssssss',
    'qhssssssss',
    'qhssssssss',
    'qhhssshhhh',
    '.qhhhhhshh',
    '..qhhhhhh.',
    '...qhhhh..',
  ], pal(s));
  finish(a, { shadow: true });
  // the shades, their arm back to the ear, and a glint
  for (let x = 6; x <= 9; x++) a.set(x, 4, SHADES);
  for (let x = 4; x <= 9; x++) a.set(x, EYE.y, SHADES);
  a.set(7, 4, GLINT);
  a.set(3, 5, s.skin[2]).set(3, 6, s.skin[1]); // ear
  a.set(9, 6, s.skin[3]); // nose
  a.set(MOUTH.x, MOUTH.y, s.skin[1]);
  return a;
}

function grantUpperTorso(s: Skin): PixelArt {
  const a = draw(12, 12, [
    '.....ssss...',
    '.....ksss...',
    '.cccccccXcc.',
    'cCCccccccCCc',
    'cCCCcccccCCc',
    'cCCcccxccCcc',
    'ccccccxccccc',
    'cccxcccccccc',
    'cccccccccccc',
    '.cccccccccc.',
    '.cccccccccc.',
    '.cccccccccc.',
  ], pal(s));
  return finish(a);
}

function grantMidTorso(s: Skin): PixelArt {
  const a = draw(11, 5, [
    '.ccccccccc.',
    'ccccccxcccc',
    'cCcccccxccc',
    'cCccccccccc',
    '.ccccccccc.',
  ], pal(s));
  return finish(a);
}

function grantLowerTorso(s: Skin): PixelArt {
  const a = draw(12, 8, [
    '.cccccccccc.',
    'bbbbbbbbbbgG',
    'pPpppppppypp',
    'pPppppppypPp',
    'ppppppppyppp',
    'pppppppppppp',
    'ppppppyyppp.',
    '.pppppppppp.',
  ], pal(s));
  return finish(a);
}

function grantUpperArm(s: Skin): PixelArt {
  const a = draw(5, 8, [
    '.ccc.',
    'ccccc',
    'ccccc',
    'xxxxx',
    'sssss',
    'sSsss',
    'sssks',
    '.sss.',
  ], pal(s));
  return finish(a, { shadow: false });
}

function grantLowerArm(s: Skin): PixelArt {
  const a = draw(5, 7, [
    '.sss.',
    'sssss',
    'sSsss',
    'sssss',
    'sssks',
    'sssss',
    '.sss.',
  ], pal(s));
  return finish(a, { shadow: false });
}

function grantUpperLeg(s: Skin): PixelArt {
  const a = draw(7, 7, [
    '.ppppp.',
    'ppppppp',
    'pppppyp',
    'pppppyp',
    'ppppppp',
    'ppppppp',
    '.ppppp.',
  ], pal(s));
  return finish(a);
}

function grantLowerLeg(s: Skin): PixelArt {
  // (his jeans over the tops of his boots)
  const a = draw(6, 7, [
    '.pppp.',
    'pppppp',
    'ppppyp',
    'pppppp',
    'yyyyyy',
    'oooooo',
    'oOoooo',
  ], pal(s));
  return finish(a);
}

// ---------------------------------------------------------------- android

const RB = ROBOT;
const RD = ROBOT_DK;
function rpal(): Record<string, Color> {
  return {
    m: RB[2], M: RB[3], L: RB[4], k: RB[1],
    d: RD[2], D: RD[1], u: RD[3],
    v: GUNMETAL[1], V: GUNMETAL[2],
    G: GLOW,
  };
}

function androidHead(): PixelArt {
  const a = draw(10, 11, [
    '..mmmmmm..',
    '.mMLMmmmm.',
    'mMMmmmmmmm',
    'mmmmmmmmmm',
    'mmmmmvvvvv',
    'mmdmmvVVVv',
    'mmdmmvvvvv',
    'mmmmmmmmmm',
    '.mmmmkkkm.',
    '..mmmmmmm.',
    '...dddddd.',
  ], rpal());
  finish(a);
  a.set(EYE.x - 1, EYE.y, GLOW).set(EYE.x, EYE.y, GLOW);
  return a;
}

function androidUpperTorso(): PixelArt {
  const a = draw(10, 12, [
    '....ddd...',
    '....ddd...',
    '.mmmmmmmm.',
    'mMMmmmmMmm',
    'mMvvvvvvmm',
    'mMvVVVVvmm',
    'mmvVVGVvmm',
    'mmvvvvvvmm',
    'mmmmmmmmm.',
    '.mmmmmmmm.',
    '.dmdmdmdm.',
    '.dddddddd.',
  ], rpal());
  return finish(a);
}

function androidMidTorso(): PixelArt {
  const a = draw(9, 7, [
    '.ddddddd.',
    'dddDdDddd',
    'duddddddd',
    'dudDdDddd',
    'duddddddd',
    'dddDdDddd',
    '.ddddddd.',
  ], rpal());
  return finish(a);
}

function androidLowerTorso(): PixelArt {
  const a = draw(10, 8, [
    '.dddddddd.',
    'mmmmmmmmmm',
    'mMmmmmmmmm',
    'mMvvvvvvmm',
    'mMmmmmmmmm',
    'mmmmmmmmmm',
    'mmmmmmmmm.',
    '.mmmmmmm..',
  ], rpal());
  return finish(a);
}

function androidLimb(w: number, h: number, glow = false): PixelArt {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const end = y < 2 || y >= h - 1;
      const corner = (y === 0 || y === h - 1) && (x === 0 || x === w - 1);
      r += corner ? '.' : end ? 'd' : x === 1 ? 'M' : x === w - 2 && y > 3 && y < h - 3 ? 'k' : 'm';
    }
    rows.push(r);
  }
  const a = draw(w, h, rows, rpal());
  finish(a, { shadow: w > 4 });
  if (glow) a.set(w - 2, 4, GLOW);
  return a;
}

function androidHand(): PixelArt {
  const a = draw(4, 5, ['dddd', 'mmmm', 'mMmm', 'mMmk', '.mm.'], rpal());
  return finish(a, { shadow: false });
}

function androidFoot(): PixelArt {
  const a = draw(8, 3, ['dddddd..', 'mMMmmmmm', 'vvvvvvvv'], rpal());
  return finish(a, { shadow: false });
}

const cache = new Map<string, PixelArt>();

/** Returns the (cached) sprite for a body part. Far-side limbs are darker for depth. */
export function limbArt(kind: BodyKind, key: LimbKey, skin: Skin = HUMAN_SKIN, skinKey = 'default', build: Build = 'standard'): PixelArt {
  const ck = `${kind}:${build}:${skinKey}:${key}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const base = key.replace(/[FB]$/, '');
  let a: PixelArt;
  if (build === 'grant') {
    switch (base) {
      case 'head': a = grantHead(skin); break;
      case 'upperTorso': a = grantUpperTorso(skin); break;
      case 'midTorso': a = grantMidTorso(skin); break;
      case 'lowerTorso': a = grantLowerTorso(skin); break;
      case 'upperArm': a = grantUpperArm(skin); break;
      case 'lowerArm': a = grantLowerArm(skin); break;
      case 'hand': a = humanHand(skin); break;
      case 'upperLeg': a = grantUpperLeg(skin); break;
      case 'lowerLeg': a = grantLowerLeg(skin); break;
      default: a = humanFoot(skin); break;
    }
  } else if (kind === 'human') {
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
      case 'midTorso': a = androidMidTorso(); break;
      case 'lowerTorso': a = androidLowerTorso(); break;
      case 'upperArm': a = androidLimb(4, 12); break;
      case 'lowerArm': a = androidLimb(4, 11, true); break;
      case 'hand': a = androidHand(); break;
      case 'upperLeg': a = androidLimb(6, 12); break;
      case 'lowerLeg': a = androidLimb(5, 12); break;
      default: a = androidFoot(); break;
    }
  }
  if (key.endsWith('B')) a = farSide(a);
  cache.set(ck, a);
  return a;
}

/** Standing layout used by previews: [key, center x, center y from the ground] in art px. */
export const STAND_LAYOUT: [LimbKey, number, number][] = [
  ['upperArmB', 0, 37], ['lowerArmB', 0, 27.5], ['handB', 0, 21],
  ['upperLegB', 0, 17.5], ['lowerLegB', 0, 7.5], ['footB', 1.5, 1.5],
  ['lowerTorso', 0, 25], ['midTorso', 0, 30.5], ['upperTorso', 0, 38.5], ['head', 0.5, 49],
  ['upperLegF', 0, 17.5], ['lowerLegF', 0, 7.5], ['footF', 1.5, 1.5],
  ['upperArmF', 0, 37], ['lowerArmF', 0, 27.5], ['handF', 0, 21],
];
/** Grant's (as his limbs are laid out in entities/Human). */
export const GRANT_LAYOUT: [LimbKey, number, number][] = [
  ['upperArmB', 0, 27.25], ['lowerArmB', 0, 20.75], ['handB', 0, 16],
  ['upperLegB', 0, 10], ['lowerLegB', 0, 5], ['footB', 0.5, 1.5],
  ['lowerTorso', 0, 15], ['midTorso', 0, 20], ['upperTorso', 0, 27], ['head', 0.5, 38],
  ['upperLegF', 0, 10], ['lowerLegF', 0, 5], ['footF', 0.5, 1.5],
  ['upperArmF', 0, 27.25], ['lowerArmF', 0, 20.75], ['handF', 0, 16],
];

/** Composite of a standing figure (for the catalog). */
export function figureArt(kind: BodyKind, skin: Skin = HUMAN_SKIN, skinKey = 'default', stagger = 1, build: Build = 'standard'): PixelArt {
  const grant = build === 'grant';
  const W = grant ? 18 : 16;
  const H = grant ? 45 : 56;
  const out = new PixelArt(W, H);
  const ox = grant ? 8 : 7;
  for (const [key, cx, cy] of grant ? GRANT_LAYOUT : STAND_LAYOUT) {
    const a = limbArt(kind, key, skin, skinKey, build);
    const back = key.endsWith('B') ? -stagger : 0;
    out.blit(a, Math.round(ox + cx + back - a.w / 2), Math.round(H - cy - a.h / 2));
  }
  return out;
}

export function figurePreview(kind: BodyKind, skin: Skin = HUMAN_SKIN, skinKey = 'default', build: Build = 'standard'): HTMLCanvasElement {
  return figureArt(kind, skin, skinKey, 1, build).toCanvas(1);
}

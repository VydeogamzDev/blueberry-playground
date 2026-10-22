import { PixelArt, hex, shade, type Color } from './PixelArt';

const P = (s: string) => hex(s);

// ------------------------------------------------------------------ firearms
// All guns point RIGHT; the muzzle is at the right edge.

const GUN_PAL: Record<string, Color> = {
  L: P('#7c858e'), // highlight
  S: P('#4c535a'), // receiver / slide
  s: P('#3f454b'),
  K: P('#33373c'), // frame
  G: P('#2e2a27'), // grip
  t: P('#1d1f22'), // trigger
  M: P('#2a2d30'), // barrel
  m: P('#3a3d41'), // magazine
  H: P('#3a3f44'), // handguard
  B: P('#4a3a2c'), // stock (wood/dark)
  W: P('#7a5636'), // wood
  w: P('#674629'),
  d: P('#1a1b1d'), // port / bore
};

function gun(rows: string[]): PixelArt {
  const a = new PixelArt(rows[0].length, rows.length);
  a.map(rows, GUN_PAL);
  return a.bevel(1.1, 0.88, 1).outline(0.6);
}

export function pistolArt(): PixelArt {
  return gun([
    '..LLLLLLLLL.',
    '.SSSSSSSSSSd',
    '.SSddSSSSSSS',
    '.KKKKKKKKKK.',
    '.GGGK.tK....',
    '.GGGG.KK....',
    'GGGG........',
  ]);
}

export function revolverArt(): PixelArt {
  return gun([
    '...LLLLLLLLLL.',
    '..SSSSSSSSSSSd',
    '.KSsssSSKKKKK.',
    '.KSsssSK......',
    'GGGK.tK.......',
    'GGGG.KK.......',
    'GGG...........',
  ]);
}

export function rifleArt(): PixelArt {
  return gun([
    '.........LLLLLLLL.............',
    'BBBBB...SSSSSSSSSHHHHHHHH.....',
    'BBBBBBBBSSddSSSSSHHHHHHHHMMMMd',
    'BBBBBBBBSSSSSSSSSHHHHHHHH.....',
    '.BBBBB..KKKKKKKKKKKKKKKK......',
    '..BBB...GG.t.mmm..............',
    '........GG...mmm..............',
    '.........G....mmm.............',
    '...............mm.............',
  ]);
}

export function smgArt(): PixelArt {
  return gun([
    '....LLLLLLLLL.......',
    'KK.SSSSSSSSSSSMMMMMd',
    'KKKSSddSSSSSSS......',
    'K..KKKKKKKKKKK......',
    '...GG.t.mm..........',
    '...GG...mm..........',
    '........mm..........',
    '........mm..........',
  ]);
}

export function shotgunArt(): PixelArt {
  return gun([
    '..........LLLLLLLLLLLLLLLLLLLLLLLL',
    'WWWW.....SSSSSSSSSSSSSSSSSSSSSSSSd',
    'WWWWWWWWWSSSSSSSwwwwwwwwwMMMMMMMMM',
    'WwWWWWWWKKKKKKKKWWWWWWWWWMMMMMMMM.',
    '.WWWWW...GG.t.....................',
    '..WWW....GG.......................',
  ]);
}

export function sniperArt(): PixelArt {
  return gun([
    '..........sSSSSSSSs...................',
    '..........SLLLLLLLS...................',
    'BBBBBB.....KSSSSK.....................',
    'BBBBBBBBBBSSSSSSSSSHHHHHHMMMMMMMMMMMMd',
    'BBBBBBBBBBSSddSSSSSHHHHHH.............',
    '.BBBBBB...KKKKKKKKKKKKKKK.............',
    '...BBB....GG.t.mm.....................',
    '..........GG...mm.....................',
  ]);
}

export function minigunArt(): PixelArt {
  return gun([
    '.....LLLLLLLLLLLLLLLLLLLLLLLL.',
    '..KKSSSSSSSSSSMMMMMMMMMMMMMMMd',
    '.KKKSSSSSSSSSSssssssssssssssss',
    '.KKKSSSSSSSSSSMMMMMMMMMMMMMMMd',
    '..KKKKKKKKKKKKK...............',
    '....GG.t...mmmm...............',
    '....GG.....mmmm...............',
  ]);
}

// ------------------------------------------------------------------ melee

const STEEL = P('#a9b1b9');
const STEEL_D = P('#6f777f');
const EDGE = P('#dfe5ea');

export function knifeArt(): PixelArt {
  const a = new PixelArt(15, 3);
  a.map(['.....XBBBBBBBB.', 'HHHHHXBBBBBBBBB', '.....XEEEEEEE..'], {
    H: P('#2c2724'), X: P('#4e555c'), B: STEEL, E: EDGE,
  });
  a.set(1, 1, P('#45403b')).set(3, 1, P('#45403b'));
  return a.outline(0.6);
}

export function swordArt(): PixelArt {
  const a = new PixelArt(42, 5);
  const blade = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  a.map(
    [
      '.......X..................................',
      'PHHHHHHX' + blade + '...',
      'PHHHHHHX' + 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE' + '.',
      '.......X..................................',
      '.......X..................................',
    ].map((r) => r.slice(0, 42)),
    { P: P('#8f7a3c'), H: P('#4a2f1f'), X: P('#9a8344'), B: STEEL, E: EDGE },
  );
  a.set(40, 1, -1);
  a.set(41, 2, -1);
  for (let x = 2; x < 7; x += 2) a.set(x, 1, P('#5d3d28'));
  return a.outline(0.6);
}

export function axeArt(): PixelArt {
  const a = new PixelArt(31, 11);
  a.rect(0, 2, 27, 2, P('#7a5636'));
  a.rect(0, 2, 4, 2, P('#5a3e26'));
  a.rect(21, 0, 6, 5, STEEL_D);
  a.poly([[20, 4], [28, 4], [30.5, 11], [17.5, 11]], STEEL);
  a.hline(18, 30, 10, EDGE);
  return a.bevel(1.1, 0.85, 1).outline(0.55);
}

export function crowbarArt(): PixelArt {
  const a = new PixelArt(32, 6);
  const red = P('#8e2b22');
  a.rect(3, 2, 27, 2, red);
  a.rect(29, 2, 3, 1, STEEL_D);
  a.line(0, 0, 3, 3, red);
  a.line(1, 0, 3, 2, red);
  a.set(0, 1, red);
  return a.bevel(1.2, 0.8, 1).outline(0.6);
}

export function batArt(): PixelArt {
  const a = new PixelArt(32, 5);
  const wood = P('#b98b54');
  a.poly([[0, 1.5], [12, 1.5], [31, 0], [31, 5], [12, 3.5], [0, 3.5]], wood);
  a.rect(0, 1, 2, 3, P('#3a2a1e'));
  a.rect(3, 1, 6, 3, P('#2b2b2e'));
  return a.bevel(1.12, 0.84, 1).outline(0.55);
}

export function hammerArt(): PixelArt {
  const a = new PixelArt(30, 10);
  a.rect(0, 4, 24, 2, P('#8a6239'));
  a.rect(0, 4, 5, 2, P('#2e2b28'));
  a.rect(23, 0, 7, 10, P('#5d646b'));
  a.rect(23, 0, 7, 1, P('#7c858e'));
  return a.bevel(1.12, 0.84, 1).outline(0.55);
}

// ------------------------------------------------------------------ explosives

export function grenadeArt(pinned: boolean): PixelArt {
  const a = new PixelArt(8, 11);
  const body = P('#4d5a33');
  a.ellipse(0, 3, 8, 8, body);
  a.hline(1, 6, 6, shade(body, 0.8));
  a.hline(1, 6, 8, shade(body, 0.8));
  a.vline(3, 4, 9, shade(body, 0.85));
  a.rect(2, 1, 4, 3, P('#5e646a'));
  a.vline(6, 1, 6, P('#8c939b')); // spoon
  a.set(7, 2, P('#8c939b'));
  if (pinned) {
    a.set(0, 0, P('#c9a43c')).set(1, 0, P('#c9a43c')).set(0, 1, P('#c9a43c')).set(1, 2, P('#c9a43c'));
  }
  return a.bevel(1.15, 0.82, 1).outline(0.55);
}

export function dynamiteArt(): PixelArt {
  const a = new PixelArt(17, 5);
  const red = P('#b0372b');
  a.rect(2, 0, 15, 5, red);
  a.rect(7, 0, 4, 5, P('#d8cfb8'));
  a.set(8, 2, P('#2a2422')).set(9, 2, P('#2a2422'));
  a.line(0, 0, 2, 2, P('#cdbd96'));
  a.set(1, 0, P('#cdbd96'));
  for (let y = 0; y < 5; y++) a.set(16, y, shade(red, 0.8));
  return a.bevel(1.2, 0.8, 1).outline(0.55);
}

export function c4Art(): PixelArt {
  const a = new PixelArt(14, 7);
  a.rect(0, 1, 14, 6, P('#bdb38f'));
  a.rect(3, 0, 8, 2, P('#2c2d2f'));
  a.set(4, 0, P('#c43a2c')).set(9, 0, P('#46b04a'));
  a.hline(0, 13, 4, P('#3c3c3c'));
  return a.bevel(1.1, 0.85, 1).outline(0.55);
}

export function mineArt(): PixelArt {
  const a = new PixelArt(16, 5);
  const c = P('#4b5532');
  a.poly([[1, 5], [15, 5], [13, 1], [3, 1]], c);
  a.rect(5, 0, 6, 2, P('#6d7276'));
  a.hline(2, 13, 4, shade(c, 0.75));
  return a.bevel(1.15, 0.8, 1).outline(0.55);
}

// ------------------------------------------------------------------ machinery

export function motorHousingArt(): PixelArt {
  const a = new PixelArt(16, 16);
  const c = P('#4a5058');
  a.roundRect(0, 0, 16, 16, 2, c);
  for (let y = 3; y < 13; y += 2) a.hline(2, 4, y, shade(c, 0.6));
  a.rect(12, 2, 2, 2, P('#d0a63a'));
  return a.bevel(1.15, 0.82).outline(0.55);
}

export function rotorArt(): PixelArt {
  const a = new PixelArt(14, 14);
  a.ellipse(0, 0, 14, 14, P('#8a939c'));
  a.ellipse(4, 4, 6, 6, P('#5b636b'));
  a.hline(1, 12, 6, P('#6d757d'));
  a.hline(1, 12, 7, P('#6d757d'));
  a.set(6, 6, P('#c9a43c')).set(7, 7, P('#c9a43c')).set(6, 7, P('#c9a43c')).set(7, 6, P('#c9a43c'));
  return a.bevel(1.2, 0.8).outline(0.55);
}

export function buttonBaseArt(): PixelArt {
  const a = new PixelArt(14, 4);
  a.rect(0, 0, 14, 4, P('#3d4248'));
  a.set(1, 1, P('#6d757d')).set(12, 1, P('#6d757d'));
  return a.bevel(1.15, 0.85, 1).outline(0.55);
}

export function buttonCapArt(): PixelArt {
  const a = new PixelArt(8, 3);
  a.rect(0, 0, 8, 3, P('#c0392b'));
  return a.bevel(1.25, 0.8, 1).outline(0.6);
}

export function batteryArt(): PixelArt {
  const a = new PixelArt(10, 16);
  a.rect(3, 0, 4, 2, P('#9aa2aa'));
  a.rect(0, 2, 10, 14, P('#2e3135'));
  a.rect(0, 2, 10, 4, P('#d07f26'));
  a.map(['..YY', '.YY.', 'YYYY', '.YY.', 'YY..'], { Y: P('#e4c34b') }, 3, 8);
  return a.bevel(1.15, 0.82).outline(0.55);
}

export function bulbArt(lit: boolean): PixelArt {
  const a = new PixelArt(8, 12);
  a.ellipse(0, 0, 8, 8, lit ? P('#fff2b3') : P('#9fb2b8'));
  if (!lit) a.set(2, 2, P('#d9e6ea')).set(2, 3, P('#d9e6ea'));
  else a.ellipse(2, 2, 4, 4, P('#ffffff'));
  a.rect(2, 7, 4, 5, P('#8f969d'));
  a.hline(2, 5, 9, P('#6a7178'));
  a.hline(2, 5, 11, P('#4b5157'));
  return a.outline(0.6);
}

export function thrusterArt(): PixelArt {
  const a = new PixelArt(14, 10);
  const c = P('#5a6168');
  a.rect(5, 1, 9, 8, c);
  a.poly([[0, 0], [6, 2], [6, 8], [0, 10]], P('#3d4247'));
  a.rect(9, 2, 3, 2, P('#d0a63a'));
  return a.bevel(1.15, 0.82).outline(0.55);
}

export function wheelArt(): PixelArt {
  const a = new PixelArt(20, 20);
  a.ellipse(0, 0, 20, 20, P('#2b2b2e'));
  a.ellipse(4, 4, 12, 12, P('#7c858e'));
  a.ellipse(8, 8, 4, 4, P('#3e444a'));
  return a.bevel(1.2, 0.85).outline(0.55);
}

// ------------------------------------------------------------------ tool icons (catalog previews)

function icon(rows: string[], pal: Record<string, Color>): PixelArt {
  const a = new PixelArt(rows[0].length, rows.length);
  a.map(rows, pal);
  return a;
}

export function toolIcon(kind: string): PixelArt {
  const brown = P('#a1825c');
  const steel = P('#a7b0b8');
  const gold = P('#d8c27a');
  const dark = P('#3a3d41');
  switch (kind) {
    case 'rope':
      return icon(
        ['....bbbb....', '..bb....bb..', '.b..bbbb..b.', '.b.b....b.b.', '.b.b.bb.b.b.', '.b.b....b.b.', '.b..bbbb..b.', '..bb....bb..', '....bbbb.b..', '.........b..', '..........b.', '..........b.'],
        { b: brown },
      );
    case 'weld':
      return icon(
        ['.ssssssss...', '.s......s...', '.s.dd...s...', '.s.dd...s...', '.s......sss.', '.ssssssss.s.', '....s.dd..s.', '....s.dd..s.', '....s.....s.', '....sssssss.'],
        { s: steel, d: dark },
      );
    case 'spring':
      return icon(
        ['dddddddd', '..s.....', '.....s..', '..s.....', '.....s..', '..s.....', '.....s..', '..s.....', 'dddddddd'].map((r) => r.replace(/\./g, '.')),
        { s: steel, d: dark },
      ).blit(icon(['ssssss', '......', 'ssssss', '......', 'ssssss', '......', 'ssssss'], { s: steel }), 1, 1);
    case 'hinge':
      return icon(
        ['ssss........', 'ssss........', 'ssssgg......', 'ssssgggg....', '....gddg....', '....gddg....', '....ggggssss', '......ggssss', '........ssss', '........ssss'],
        { s: steel, g: gold, d: dark },
      );
    case 'pin':
      return icon(['..gggg..', '.gggggg.', '.ggddgg.', '.gggggg.', '..gggg..', '...ss...', '...ss...', '...ss...', '....s...'], { g: gold, s: steel, d: dark });
    case 'wire':
      return icon(
        ['rr..........', '.rr.........', '..rr.....rr.', '...rr...r..r', '....rrrr...r', '...........r', '..........rr', '..dd.....r..', '.dddd...r...', '..dd....r...'],
        { r: P('#c0452f'), d: dark },
      );
    case 'remove':
    default:
      return icon(
        ['r..........r', '.r........r.', '..r......r..', '...r....r...', '....r..r....', '.....rr.....', '.....rr.....', '....r..r....', '...r....r...', '..r......r..', '.r........r.', 'r..........r'],
        { r: P('#d0584a') },
      );
  }
}

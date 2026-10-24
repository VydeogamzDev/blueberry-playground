import { PixelArt, CLEAR, type Color } from './PixelArt';
import { finish, draw, ramp, RED, WHITE, STEEL_LT, POLYMER, YELLOW, GUNMETAL, LED_RED, LED_GREEN } from './palette';

// ------------------------------------------------------------------ medical kit
// First aid kit, bandage and defibrillator. Same palette ramps and finishing
// pass as every other sprite.

/** Bandage gauze: its own off-white, so a bandage painted on a limb can be told from what's under it. */
export const GAUZE = ramp('#e9e4d4', 0.7);
/** Every colour a wrapped bandage is painted in (healing leaves these where they are). */
export const GAUZE_COLORS: ReadonlySet<Color> = new Set(GAUZE);

/** A red first aid kit with a white cross and a carrying handle; the cross greys out once it's used up. */
export function firstAidArt(empty: boolean): PixelArt {
  const a = draw(16, 13, [
    '.....hhhhhh.....',
    '....hh....hh....',
    '.RRRRRRRRRRRRRR.',
    'RRRRRRRRRRRRRRRR',
    'kkkLkkkkkkkkLkkk',
    'RRRRRRRWWRRRRRRR',
    'RRRRRRRWWRRRRRRR',
    'RRRRRWWWWWWRRRRR',
    'RRRRRWWWWWWRRRRR',
    'RRRRRRRWWRRRRRRR',
    'RRRRRRRWWRRRRRRR',
    'RRRRRRRRRRRRRRRR',
    '.RRRRRRRRRRRRRR.',
  ], { h: POLYMER[2], R: RED[2], k: RED[1], L: STEEL_LT[3], W: empty ? WHITE[1] : WHITE[4] });
  finish(a);
  // (one pixel thick, the handle would be all outline)
  for (let x = 5; x <= 10; x++) a.set(x, 0, POLYMER[2]);
  a.set(4, 1, POLYMER[1]).set(11, 1, POLYMER[1]);
  return a;
}

/** A roll of gauze bandage, end on, with its loose end unrolled along the bottom. */
export function bandageArt(): PixelArt {
  const a = new PixelArt(12, 9);
  a.ellipse(0, 0, 9, 9, GAUZE[2]);
  a.rect(4, 6, 8, 3, GAUZE[2]);
  finish(a);
  // the layers wound round the core
  for (const [x, y] of [[2, 3], [2, 4], [2, 5], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [5, 2], [4, 2]]) a.set(x, y, GAUZE[1]);
  a.set(4, 4, GAUZE[0]).set(3, 4, GAUZE[3]).set(5, 4, GAUZE[3]).set(4, 3, GAUZE[3]).set(4, 5, GAUZE[3]);
  // a frayed end
  a.set(11, 6, CLEAR).set(11, 8, CLEAR);
  return a;
}

/** What the defibrillator's light shows: off (flat), charging (blinks amber) or ready (green). */
export type DefibLight = 'off' | 'amber' | 'dark' | 'ready';

/**
 * A yellow defibrillator facing right: carrying handle, a screen with a heart
 * trace, a status light, and the paddle on its front (right) end.
 */
export function defibArt(light: DefibLight): PixelArt {
  const lamp = light === 'ready' ? LED_GREEN : light === 'amber' ? YELLOW[4] : light === 'dark' ? YELLOW[1] : LED_RED;
  const a = draw(16, 11, [
    '....hhhhhh......',
    '....h....h......',
    '.YYYYYYYYYYYYY..',
    'YYYYYYYYYYYYYYPP',
    'YYddddddYYYYYYPP',
    'YYddddddYYlYYYPP',
    'YYddddddYYYYYYPP',
    'YYYYYYYYYYYYYYPP',
    'YYbbYYbbYYYYYYPP',
    'YYYYYYYYYYYYYYPP',
    '.YYYYYYYYYYYYY..',
  ], { h: POLYMER[2], Y: YELLOW[2], d: GUNMETAL[0], l: lamp, b: POLYMER[1], P: STEEL_LT[2] });
  finish(a);
  for (let x = 4; x <= 9; x++) a.set(x, 0, POLYMER[2]);
  // the heart trace on the screen, the light, and the paddle's metal face
  const trace = light === 'ready' ? LED_GREEN : 0x2f7a3a;
  for (const [x, y] of [[2, 5], [3, 5], [4, 4], [5, 6], [6, 5], [7, 5]]) a.set(x, y, trace);
  a.set(10, 5, lamp);
  for (let y = 4; y <= 8; y++) a.set(14, y, STEEL_LT[y === 4 ? 4 : 3]);
  return a;
}

/** What a heart monitor's lamp shows: unlit, a beat (green), or the alarm of a stopped heart (red). */
export type MonitorLamp = 'off' | 'beat' | 'alarm';

/**
 * A bedside heart monitor: an off-white case with a dark screen (the trace is drawn
 * over it live, see HeartMonitor), its lamp and knobs on the right, a speaker
 * grille, and the socket its leads plug into on the left.
 */
export function heartMonitorArt(lamp: MonitorLamp): PixelArt {
  const a = draw(20, 15, [
    '.WWWWWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWWWWWWW',
    'WWddddddddddddddWWWW',
    'WWddddddddddddddWWWW',
    'WWddddddddddddddWWWW',
    'WWddddddddddddddWkkW',
    'WWddddddddddddddWkkW',
    'WWddddddddddddddWWWW',
    'WWddddddddddddddWkkW',
    'WWddddddddddddddWkkW',
    'WWddddddddddddddWWWW',
    'WWWWWWWWWWWWWWWWWWWW',
    'WWbWbWbWWWWWWWWWWWWW',
    '.WWWWWWWWWWWWWWWWWW.',
    '..kk............kk..',
  ], { W: WHITE[2], d: GUNMETAL[0], k: POLYMER[1], b: POLYMER[2] });
  finish(a);
  // a faint grid on the screen, the lamp, and the socket
  for (let x = 5; x < 16; x += 4) for (let y = 3; y < 10; y += 2) a.set(x, y, 0x1e3326);
  const c = lamp === 'beat' ? LED_GREEN : lamp === 'alarm' ? LED_RED : GUNMETAL[1];
  a.set(17, 3, c).set(18, 3, c);
  a.set(0, 5, STEEL_LT[3]).set(0, 6, STEEL_LT[2]);
  return a;
}

/** A life detector looking right through its lens, a heart on its side that lights while it sees someone alive. */
export function lifeDetectorArt(active: boolean): PixelArt {
  const a = new PixelArt(12, 10);
  a.roundRect(0, 1, 9, 8, 1, WHITE[2]);
  a.rect(9, 2, 3, 6, GUNMETAL[2]);
  finish(a);
  a.vline(11, 3, 6, active ? LED_GREEN : 0x2c5a32);
  a.vline(10, 3, 6, GUNMETAL[1]);
  a.set(11, 3, active ? 0xbff2b8 : 0x3d7a44);
  const heart = active ? LED_RED : RED[1];
  for (const [x, y] of [[3, 3], [5, 3], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [3, 5], [4, 5], [5, 5], [4, 6]]) a.set(x, y, heart);
  return a;
}

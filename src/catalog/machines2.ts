import { register, lazyArt, previewOf } from './items';
import { MAT, type PhysMaterial } from '../world/Materials';
import { PX } from '../engine/constants';
import { PixelArt } from '../art/PixelArt';
import * as M from '../art/machines2';
import { artRect, densityFor } from '../entities/Item';
import { Turret, type TurretSpec } from '../entities/Turrets';
import { Fan, Propeller } from '../entities/Air';
import { Electromagnet, TeslaCoil } from '../entities/Electric';
import { LaunchPad, Conveyor, Winch } from '../entities/Movers';
import { EmpGenerator } from '../entities/Emp';
import { Lagbox, Counter, ActivationFuse, Metronome, Detector, Siren, RadioTransmitter, RadioReceiver, Servo } from '../entities/Logic2';
import type { PropConfig } from '../entities/Prop';
import type { ShapeSpec } from '../world/Part';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions } from '../world/types';

// The contraption toys: turrets, fans, the magnet and the tesla coil, the launch
// platform, and more logic and timing parts. Registered after the rest (see
// registry.ts), so they come last in the Machinery toybox.

function item(
  id: string, name: string, description: string, art: () => PixelArt,
  make: (game: Game, def: ItemDef, x: number, y: number, opts: SpawnOptions) => Entity, tags: string[], halfHeight?: number,
): ItemDef {
  const def: ItemDef = {
    id, name, category: 'Machinery', description, tags,
    preview: previewOf(art),
    create: (game, x, y, opts) => make(game, def, x, y, opts),
  };
  if (halfHeight !== undefined) def.halfHeight = halfHeight;
  else Object.defineProperty(def, 'halfHeight', { get: () => (art().h * PX) / 2 });
  return register(def);
}

/** Box shapes from art-pixel rects [x, y, w, h]. */
function rects(w: number, h: number, list: [number, number, number, number][], r = 0.5): ShapeSpec[] {
  return list.map(([x, y, rw, rh]) => artRect(w, h, x, y, rw, rh, r));
}

/** A one-part thing's make-up: its art, material, shapes and weight (kg). */
function cfg(art: () => PixelArt, material: PhysMaterial, shapes: ShapeSpec[], mass: number): PropConfig {
  return { art, material, shapes, density: densityFor(mass, shapes) };
}

/** A turned copy of a sprite: a quarter turn clockwise (a turret's head hanging down, for its picture). */
function quarterTurn(a: PixelArt): PixelArt {
  const b = new PixelArt(a.h, a.w);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) b.set(a.h - 1 - y, x, a.get(x, y));
  return b;
}

/** A turret's picture: its head on its base, the head's pivot on the base's. */
function turretPreview(base: PixelArt, head: PixelArt, pivot: [number, number], headPivot: [number, number]): PixelArt {
  const ox = Math.max(0, headPivot[0] - pivot[0]);
  const oy = Math.max(0, headPivot[1] - pivot[1]);
  const hx = pivot[0] + ox - headPivot[0];
  const hy = pivot[1] + oy - headPivot[1];
  const a = new PixelArt(Math.max(base.w + ox, hx + head.w), Math.max(base.h + oy, hy + head.h));
  a.blit(base, ox, oy);
  a.blit(head, hx, hy);
  return a;
}

const SENTRY_BASE = rects(20, 12, [[3, 2, 14, 7], [1, 8, 18, 4], [8, 0, 4, 3]]);
const CEILING_BASE = rects(20, 8, [[0, 0, 20, 3], [4, 3, 12, 3], [8, 5, 4, 3]]);
const HEAD = rects(22, 10, [[0, 1, 11, 8], [11, 3, 11, 3], [2, 0, 5, 2]], 0.4);

function registerTurrets(): void {
  const sentryBase = lazyArt(() => M.sentryBaseArt(false));
  const laserBase = lazyArt(() => M.sentryBaseArt(true));
  const ceilingBase = lazyArt(M.ceilingBaseArt);
  const gun = { rate: 8, damage: 16, speed: 420, energy: 500, spread: 0.035, sound: 'smg' as const };
  const turrets: { id: string; name: string; desc: string; spec: TurretSpec; preview: () => PixelArt; tags: string[]; halfHeight?: number }[] = [
    {
      id: 'sentry-turret', name: 'Sentry Turret',
      desc: 'An automatic gun on a base. It turns to the nearest living thing in front of it (up to 45° up or down) that it can see, and fires until it’s dead or gone. On from the start: activate switches it off and on; wired up, it runs only while powered. Pick a side in its menu and it spares that team.',
      spec: { base: sentryBase, baseShapes: SENTRY_BASE, baseMass: 40, pivot: M.TURRET.basePivot, band: [4, 4, 16, 6], headShapes: HEAD, rest: 0, arc: Math.PI / 4, range: 22, ...gun },
      preview: () => turretPreview(sentryBase(), M.turretHeadArt('idle'), M.TURRET.basePivot, M.TURRET.headPivot),
      tags: ['sentry', 'turret', 'gun', 'automatic', 'defense', 'auto aim'],
    },
    {
      id: 'ceiling-turret', name: 'Ceiling Turret',
      desc: 'A sentry turret to hang under a ceiling (freeze it there, or pin or weld it): it only aims below itself, fires at the living things it sees until they’re dead or gone. Activate switches it off and on; wired up, it runs only while powered. Pick a side in its menu and it spares that team.',
      spec: { base: ceilingBase, baseShapes: CEILING_BASE, baseMass: 25, pivot: M.TURRET.ceilingPivot, band: [5, 4, 15, 5], headShapes: HEAD, rest: -Math.PI / 2, arc: (80 * Math.PI) / 180, range: 22, ...gun },
      preview: () => turretPreview(ceilingBase(), quarterTurn(M.turretHeadArt('idle')), M.TURRET.ceilingPivot, [4, 5]),
      tags: ['sentry', 'turret', 'gun', 'automatic', 'defense', 'hanging'],
      halfHeight: 24 * PX,
    },
    {
      id: 'laser-sentry', name: 'Laser Sentry',
      desc: 'A sentry turret with a laser: an instant beam that burns through flesh and wood and sets things alight. It turns to the nearest living thing in front of it that it can see, and burns it until it’s dead or gone. Activate switches it off and on; wired up, it runs only while powered. Pick a side in its menu and it spares that team.',
      spec: {
        base: laserBase, baseShapes: SENTRY_BASE, baseMass: 40, pivot: M.TURRET.basePivot, band: [4, 4, 16, 6], headShapes: HEAD, rest: 0, arc: Math.PI / 4, range: 24,
        laser: 0xff3b30, rate: 3, damage: 30, spread: 0, sound: 'laser',
      },
      preview: () => turretPreview(laserBase(), M.turretHeadArt('idle', true), M.TURRET.basePivot, M.TURRET.headPivot),
      tags: ['sentry', 'turret', 'laser', 'beam', 'automatic', 'defense', 'sci-fi'],
    },
  ];
  for (const t of turrets) {
    const preview = lazyArt(t.preview);
    item(t.id, t.name, t.desc, preview, (game, def, x, y, opts) => new Turret(game, def, t.spec, x, y, opts), t.tags, t.halfHeight);
  }
}

function registerAir(): void {
  const fanShapes = rects(18, 20, [[0, 4, 12, 11], [0, 17, 12, 3], [4, 14, 4, 3], [12, 7, 3, 5]]);
  item('fan', 'Fan',
    'Needs power. Blows what’s in front of it away and draws in what’s behind it, light things more than heavy ones. Its bare blades cut and fling whatever touches them. Set its speed in its menu; activate switches it off and on.',
    () => M.fanArt(0), (game, def, x, y, opts) =>
      new Fan(game, def, cfg(() => M.fanArt(0), MAT.metal, fanShapes, 15), M.fanArt, M.FAN_BLADES, x, y, opts),
    ['fan', 'wind', 'blow', 'air', 'blower', 'electric']);
  const propShapes = rects(16, 30, [[0, 11, 12, 8], [12, 13, 2, 4]]);
  item('propeller', 'Propeller',
    'Needs power. Pulls whatever it’s fixed to the way it faces: a few lift a contraption. Its blades cut what touches them. Set its speed in its menu; activate switches it off and on.',
    () => M.propellerArt(0), (game, def, x, y, opts) =>
      new Propeller(game, def, cfg(() => M.propellerArt(0), MAT.metal, propShapes, 4), M.propellerArt, M.PROP_BLADES, 600, x, y, opts),
    ['propeller', 'prop', 'rotor', 'fly', 'plane', 'helicopter', 'electric']);
}

function registerElectric(): void {
  const magnetShapes = rects(22, 14, [[0, 3, 22, 11], [8, 0, 6, 3]]);
  item('electromagnet', 'Electromagnet',
    'Needs power. Pulls metal things toward it from up to 12 m away, hardest close up (and itself toward them). Activate switches it off and on.',
    () => M.magnetArt(false), (game, def, x, y, opts) =>
      new Electromagnet(game, def, cfg(() => M.magnetArt(false), MAT.metal, magnetShapes, 30), M.magnetArt, x, y, opts),
    ['magnet', 'electromagnet', 'metal', 'pull', 'crane', 'electric']);
  const teslaShapes = rects(16, 40, [[0, 36, 16, 4], [2, 31, 12, 6], [5, 10, 6, 22], [0, 3, 16, 8], [7, 0, 2, 4]]);
  item('tesla-coil', 'Tesla Coil',
    'Needs power. Every so often it throws an arc of lightning to something within 6 m (or to the floor): people are hurt, burnt and jolted, and an arc to the chest can stop the heart; what burns may catch, and detonators go off. Activate switches it off and on.',
    () => M.teslaArt(false), (game, def, x, y, opts) =>
      new TeslaCoil(game, def, cfg(() => M.teslaArt(false), MAT.metal, teslaShapes, 35), M.teslaArt, x, y, opts),
    ['tesla', 'coil', 'lightning', 'arc', 'shock', 'electric', 'zap']);
}

function registerMovers(): void {
  const padShapes = rects(40, 12, [[0, 3, 40, 9]]);
  item('launch-pad', 'Launch Platform',
    'Activate it, pulse it or power it, and its plate springs up and throws whatever is on it straight up. Set its strength in its menu.',
    () => M.launchPadArt(false), (game, def, x, y, opts) =>
      new LaunchPad(game, def, cfg(() => M.launchPadArt(false), MAT.metal, padShapes, 60), M.launchPadArt, x, y, opts),
    ['launch', 'platform', 'spring', 'catapult', 'jump', 'pad', 'fling']);
  const beltShapes = rects(64, 10, [[0, 0, 64, 10]], 4);
  item('conveyor-belt', 'Conveyor Belt',
    'Needs power. Carries whatever lies on top of it along at its speed (set in its menu, or reversed). Freeze it, or fix it in place, to build a line. Activate switches it off and on.',
    () => M.conveyorArt(0), (game, def, x, y, opts) =>
      new Conveyor(game, def, cfg(() => M.conveyorArt(0), MAT.metal, beltShapes, 45), M.conveyorArt, x, y, opts),
    ['conveyor', 'belt', 'carry', 'factory', 'move', 'electric']);
  const winchShapes = rects(20, 16, [[0, 13, 20, 3], [1, 3, 18, 11]]);
  item('winch', 'Winch',
    'Needs power. Tie a rope from it to something: it reels the rope in (or pays it out, set in its menu) at its speed, and stalls while what’s on the end won’t come. Fix it in place first. Activate switches it off and on.',
    () => M.winchArt(0), (game, def, x, y, opts) =>
      new Winch(game, def, cfg(() => M.winchArt(0), MAT.metal, winchShapes, 25), M.winchArt, x, y, opts),
    ['winch', 'rope', 'reel', 'crane', 'hoist', 'pull', 'lift', 'electric']);
}

function registerEmp(): void {
  const shapes = rects(18, 18, [[0, 8, 18, 10], [6, 4, 6, 4], [1, 0, 16, 5]]);
  item('emp-generator', 'EMP Generator',
    'Activate it, pulse it or power it, and it lets off a pulse that knocks out everything electrical nearby for a while (both set in its menu): machines, lamps and turrets go dead, batteries and sensors give no power, and cars stall.',
    () => M.empArt(false), (game, def, x, y, opts) =>
      new EmpGenerator(game, def, cfg(() => M.empArt(false), MAT.metal, shapes, 20), M.empArt, x, y, opts),
    ['emp', 'pulse', 'electromagnetic', 'disable', 'jammer', 'blackout', 'electric']);
}

function registerLogic(): void {
  const chipShapes = rects(16, 12, [[0, 0, 16, 12]]);
  item('lagbox', 'Lagbox',
    'A delay: what comes in on its input (left) comes out of its output (right) a set time later, as it went in: pulses, and power arriving and going. Set the delay in its menu.',
    () => M.lagboxArt(false), (game, def, x, y, opts) =>
      new Lagbox(game, def, cfg(() => M.lagboxArt(false), MAT.plastic, chipShapes, 0.5), M.lagboxArt, x, y, opts),
    ['delay', 'lag', 'wait', 'logic', 'timer']);
  item('counter', 'Counter',
    'Counts the pulses (or power arriving) on its input (left); on the count it’s set to, it fires its output (right) as a timer’s tick does, and starts again. Activate resets the count.',
    () => M.counterArt(0), (game, def, x, y, opts) =>
      new Counter(game, def, cfg(() => M.counterArt(0), MAT.plastic, chipShapes, 0.5), M.counterArt, x, y, opts),
    ['count', 'tally', 'logic', 'number']);
  const fuseShapes = rects(16, 8, [[0, 1, 16, 6]]);
  item('activation-fuse', 'Activation Fuse',
    'Lets the first pulse (or power arriving) on its input (left) through to its output (right), then burns out: nothing more gets through until it’s reset (activate).',
    () => M.fuseArt(false), (game, def, x, y, opts) =>
      new ActivationFuse(game, def, cfg(() => M.fuseArt(false), MAT.plastic, fuseShapes, 0.2), M.fuseArt, x, y, opts),
    ['fuse', 'once', 'one shot', 'logic', 'breaker']);
  const metroShapes = rects(12, 16, [[1, 6, 10, 10], [3, 1, 6, 5]]);
  item('metronome', 'Metronome',
    'While its input (left) is powered, it ticks at its rate (set in its menu), each beat firing its output (right) as a timer’s tick does. Activate switches it off and on.',
    () => M.metronomeArt(1), (game, def, x, y, opts) =>
      new Metronome(game, def, cfg(() => M.metronomeArt(1), MAT.wood, metroShapes, 1), M.metronomeArt, x, y, opts),
    ['beat', 'tempo', 'tick', 'clock', 'pulse', 'logic']);
  const eyeShapes = rects(12, 10, [[0, 1, 12, 8]]);
  for (const kind of ['metal', 'fire'] as const) {
    const art = (on: boolean) => M.detectorArt(`${kind}:${on ? 1 : 0}`);
    const metal = kind === 'metal';
    item(`${kind}-detector`, metal ? 'Metal Detector' : 'Fire Detector',
      `Powers its wires (and sends a pulse) while ${metal ? 'a metal thing' : 'something burning'} is in front of it, out to its range (set in its menu). Activate switches it off and on.`,
      () => art(false), (game, def, x, y, opts) =>
        new Detector(game, def, cfg(() => art(false), MAT.plastic, eyeShapes, 0.6), kind, art, x, y, opts),
      metal ? ['metal', 'detector', 'sensor', 'magnet', 'trigger'] : ['fire', 'smoke', 'detector', 'sensor', 'alarm', 'trigger']);
  }
  const sirenShapes = rects(12, 12, [[1, 2, 10, 10]]);
  item('siren', 'Siren',
    'Wails, its beacon turning, while powered. Wire it to a detector or a sensor for an alarm. Activate switches it off and on.',
    () => M.sirenArt(0), (game, def, x, y, opts) =>
      new Siren(game, def, cfg(() => M.sirenArt(0), MAT.metal, sirenShapes, 1.5), M.sirenArt, x, y, opts),
    ['alarm', 'siren', 'beacon', 'warning', 'light', 'sound']);
  const radioShapes = rects(12, 16, [[0, 6, 12, 10]]);
  item('radio-transmitter', 'Radio Transmitter',
    'Sends whatever comes down its wires to every receiver on its channel (set in its menu), with no wire between them: pulses, and power while its wires are powered. Activate sends a pulse.',
    () => M.radioArt('tx:1:0'), (game, def, x, y, opts) =>
      new RadioTransmitter(game, def, cfg(() => M.radioArt('tx:1:0'), MAT.plastic, radioShapes, 1), M.radioArt, x, y, opts),
    ['radio', 'wireless', 'transmitter', 'remote', 'signal', 'logic']);
  item('radio-receiver', 'Radio Receiver',
    'Powers its wires while a transmitter on its channel (set in its menu) is powered, and passes on the pulses sent on it.',
    () => M.radioArt('rx:1:0'), (game, def, x, y, opts) =>
      new RadioReceiver(game, def, cfg(() => M.radioArt('rx:1:0'), MAT.plastic, radioShapes, 1), M.radioArt, x, y, opts),
    ['radio', 'wireless', 'receiver', 'remote', 'signal', 'logic']);
  const housing = lazyArt(M.servoArt);
  const arm = lazyArt(M.servoArmArt);
  const servoPreview = lazyArt(() => {
    const a = new PixelArt(30, 12);
    a.blit(housing(), 0, 0);
    a.blit(arm(), M.SERVO.pivot[0] - M.SERVO.armPivot[0], M.SERVO.pivot[1] - M.SERVO.armPivot[1]);
    return a;
  });
  item('servo', 'Servo',
    'Turns its arm to a set angle (in its menu) while powered or switched on, and back when not. Weld things to its arm, and fix its housing.',
    servoPreview, (game, def, x, y, opts) => new Servo(game, def, { housing, arm, torque: 400 }, x, y, opts),
    ['servo', 'arm', 'rotate', 'angle', 'actuator', 'hinge']);
}

/** Registers the contraption toys (after the rest: see registry.ts). */
export function registerMachines2(): void {
  registerTurrets();
  registerAir();
  registerElectric();
  registerMovers();
  registerLogic();
  registerEmp();
}

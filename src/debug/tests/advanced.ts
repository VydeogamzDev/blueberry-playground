import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Human } from '../../entities/Human';
import type { HeatShield } from '../../entities/Rocketry';
import type { OxygenTank } from '../../entities/Crew';
import type { Cockpit } from '../../entities/Flight';
import { wearOn } from '../../entities/Rocketry';
import { orbitOf } from '../../systems/Piloting';
import { WORLD_MAP, builtinMap } from '../../world/Maps';

/**
 * The 0.4.0 features hardest to get right, tested before the release: reentry heat and
 * the heat shield, oxygen (helmet, tank, capsule), the sonic boom and contrails, the
 * flight recorder, fins and steering flaps, and orbits on the World.
 */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const r = game.renderer;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** The World, the camera at local (x, y). */
  const world = (x = 0, y = 2) => {
    kit.reset();
    game.setMap(WORLD_MAP);
    r.camX = x;
    r.camY = y;
    r.zoom = r.targetZoom = 64;
    kit.advance(0);
  };
  /** The camera up to true height `y` (in hops of `hop` m, a step each), nothing carried. */
  const upTo = (y: number, hop = 500) => {
    for (;;) {
      const ty = r.camY + game.origin.y;
      const d = y - ty;
      if (Math.abs(d) < 1e-6) break;
      r.camY += Math.sign(d) * Math.min(hop, Math.abs(d));
      game.step();
    }
  };
  /** How high a part truly is (m over the World's datum). */
  const alt = (p: Part) => p.y + game.origin.y;
  /** Runs `s` seconds with the camera on `p` (so it and what's by it stay in play), `each` every step. */
  const follow = (p: Part, s: number, each?: () => void) =>
    game.advance(s, () => {
      r.camX = p.x;
      r.camY = p.y;
      each?.();
    });
  const hottest = (e: Entity) => Math.max(...e.parts.map((p) => p.temp));

  return [
    ['extra: reentry: falling fast into the air, a bare metal box heats far hotter than one behind a heat shield, and the shield burns away taking the heat', () => {
      world();
      upTo(4000);
      const y = r.camY;
      const bare = kit.spawn('metal-box', -3, y);
      const boxed = kit.spawn('metal-box', 3, y);
      const shield = kit.spawn('heat-shield', 3, y - 0.5) as HeatShield;
      kit.advance(0);
      weld(boxed, shield, { x: 3, y: y - 0.35 });
      for (const e of [bare, boxed, shield]) {
        e.setFrozen(false);
        e.setVelocity(0, -600);
      }
      let shieldTop = 0;
      follow(bare.parts[0], 2, () => (shieldTop = Math.max(shieldTop, shield.main.temp)));
      const tb = hottest(bare);
      const ts = hottest(boxed);
      if (!(tb > 300)) return `2 s falling from 4 km at 600 m/s the bare box got to only ${tb.toFixed(0)} °C`;
      if (!(ts < tb / 3)) return `the box behind the shield got to ${ts.toFixed(0)} °C, the bare one ${tb.toFixed(0)} °C`;
      if (!(shieldTop > ts)) return `the shield (${shieldTop.toFixed(0)} °C) stayed cooler than the box behind it (${ts.toFixed(0)} °C)`;
      if (shieldTop > 650 && !(shield.left < 1)) return `over its ablation heat (${shieldTop.toFixed(0)} °C) the shield didn’t burn away`;
      return true;
    }],
    ['extra: oxygen: under water, someone in a spacesuit helmet with an oxygen tank on their back breathes from it while someone without runs out of breath', () => {
      kit.reset();
      game.setMap(builtinMap('sea')!);
      const bare = kit.spawn('human', -60, 10.5) as Human;
      const suited = kit.spawn('human', -50, 10.5) as Human;
      kit.advance(0.2);
      const head = suited.limbs.get('head')!.part;
      const chest = suited.limbs.get('upperTorso')!.part;
      const helmet = kit.spawn('space-helmet', head.x, head.y);
      const tank = kit.spawn('oxygen-tank', chest.x, chest.y) as OxygenTank;
      kit.advance(0);
      if (!wearOn(helmet as never, suited, 'head') || !wearOn(tank as never, suited, 'back')) return 'the helmet and the tank didn’t strap on';
      // (a suit full of air floats them: each weighed down by a steel box at the belt, to go under)
      for (const h of [bare, suited]) {
        const hip = h.limbs.get('lowerTorso')!.part;
        const box = kit.spawn('metal-box', hip.x, hip.y);
        kit.advance(0);
        C.create('weld', hip, { x: hip.x, y: hip.y }, box.parts[0], { x: hip.x, y: hip.y });
        h.inject('knockout', 1);
      }
      kit.advance(8);
      if (!bare.breath.under) return 'out cold in the sea, the one without a suit isn’t under water';
      if (suited.breath.level === null || suited.breath.level < head.y) return `out cold in the sea, the suited one isn’t under water (head ${(head.y - 9).toFixed(2)} m from the surface, chest ${(chest.y - 9).toFixed(2)})`;
      if (!(bare.breath.air < 0.6)) return `8 s under without a suit, they’ve still ${bare.breath.air.toFixed(2)} of their breath`;
      if (!(suited.breath.air > 0.9)) return `8 s under in a suit, they’re down to ${suited.breath.air.toFixed(2)} of their breath`;
      if (!(tank.air < 600 - 5)) return `breathed from under water, the tank still has ${tank.air.toFixed(1)} s of air`;
      return true;
    }],
    ['extra: oxygen: 12 km up, someone sealed in a capsule seat with an oxygen tank in its craft stays awake; in a plain cockpit they pass out', () => {
      world();
      upTo(12000);
      const y = r.camY;
      const seat = (id: string, x: number, tank: boolean) => {
        const c = kit.spawn(id, x, y) as Cockpit;
        const base = kit.spawn('metal-box', x, y - 0.8);
        kit.advance(0);
        weld(c, base, { x, y: y - 0.45 });
        if (tank) {
          const t = kit.spawn('oxygen-tank', x + 0.6, y - 0.8);
          kit.advance(0);
          weld(base, t, { x: x + 0.4, y: y - 0.8 });
        }
        for (const e of [c, base]) e.setFrozen(true);
        const h = human(x - 1.5) as Human;
        h.translate(0, y - 1);
        kit.advance(0);
        c.takeIn(h, c.main.pixelToWorld(9, 12));
        return { c, h };
      };
      const sealed = seat('capsule-seat', -3, true);
      const open = seat('cockpit', 3, false);
      if (sealed.c.pilot !== sealed.h || open.c.pilot !== open.h) return 'they didn’t sit in their seats';
      follow(sealed.c.main, 25);
      if (!sealed.h.alive || !(sealed.h.consciousness > 0.8)) return `25 s at 12 km sealed in with air, their consciousness is ${sealed.h.consciousness.toFixed(2)}${sealed.h.alive ? '' : ' (dead)'}`;
      if (open.h.alive && open.h.consciousness > 0.3) return `25 s at 12 km in an open cockpit, their consciousness is still ${open.h.consciousness.toFixed(2)}`;
      return true;
    }],
    ['extra: aero: through the speed of sound a flown craft booms once; fast through the cold air high up it leaves contrails; the flight recorder graphs the flight', () => {
      world();
      upTo(1000);
      const y = r.camY;
      const plank = kit.spawn('plank', 0, y);
      const seat = kit.spawn('cockpit', 0, y + 0.45);
      const thr = kit.spawn('thruster', -0.6, y + 0.3);
      kit.advance(0);
      weld(plank, seat, { x: 0, y: y + 0.1 });
      weld(plank, thr, { x: -0.6, y: y + 0.1 });
      controls.selection = new Set([seat]);
      const p = plank.parts[0];
      const ents = [plank, seat, thr];
      // (the sound of the boom, and the contrail's long-lived white puffs)
      let booms = 0;
      let trails = 0;
      const play = game.sound.play.bind(game.sound);
      const emit = game.particles.emit.bind(game.particles);
      game.sound.play = ((id: string, o?: unknown) => {
        if (id === 'explosion/large') booms++;
        return play(id, o as never);
      }) as typeof game.sound.play;
      game.particles.emit = ((kind: number, x: number, yy: number, o: { life?: number }) => {
        if (o?.life === 5) trails++;
        return emit(kind, x, yy, o as never);
      }) as typeof game.particles.emit;
      const fly = (v: number, s: number) =>
        follow(p, s, () => {
          for (const e of ents) e.setVelocity(v, 0);
          game.piloting.drive([seat], { x: 0, t: 0, r: 0, boost: false });
        });
      try {
        const sound = Math.sqrt(1.4 * 287 * (game.air.tempAt(p.y) + 273.15));
        fly(120, 1);
        if (trails < 10) return `1 s at 120 m/s through air at ${game.air.tempAt(p.y).toFixed(0)} °C, ${trails} contrail puffs`;
        if (booms) return `at 120 m/s it boomed (${booms})`;
        fly(sound * 0.9, 0.5);
        if (booms) return `under the speed of sound (${(sound * 0.9).toFixed(0)} of ${sound.toFixed(0)} m/s) it boomed`;
        fly(sound * 1.1, 1);
        if (booms !== 1) return `through the speed of sound (${sound.toFixed(0)} m/s) it boomed ${booms} times`;
      } finally {
        game.sound.play = play;
        game.particles.emit = emit;
      }
      // the flight recorder: drawn into the pilot's readout as it's flown
      const g = document.querySelector<HTMLCanvasElement>('.flight-graph');
      if (!g) return 'no flight recorder graph in the readout';
      for (let i = 0; i < 12; i++) {
        fly(100, 0.25);
        game.renderFrame(0, 1);
      }
      const px = g.getContext('2d')!.getImageData(0, 0, g.width, g.height).data;
      let inked = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) inked++;
      if (inked < 20) return `flown 3 s, the flight recorder drew ${inked} pixels`;
      return true;
    }],
    ['extra: aero: fins on its tail turn a rocket thrown side-on to fly point first; a steering flap on a flown glider turns it the way Q and E ask', () => {
      world();
      upTo(600);
      const y = r.camY;
      // a beam with a fin above and below its tail (the left end), thrown along +x turned 70° off
      const beam = kit.spawn('beam', 0, y);
      const finA = kit.spawn('fin', -1.1, y + 0.35);
      const finB = kit.spawn('fin', -1.1, y - 0.35, { angle: Math.PI });
      kit.advance(0);
      weld(beam, finA, { x: -1.1, y: y + 0.1 });
      weld(beam, finB, { x: -1.1, y: y - 0.1 });
      const ents = [beam, finA, finB];
      const turn = 70 * (Math.PI / 180);
      for (const e of ents) e.rotateAbout(0, y, turn);
      kit.advance(0);
      for (const e of ents) e.setVelocity(60, 0);
      const b = beam.parts[0];
      follow(b, 2.5);
      const va = Math.atan2(b.vy, b.vx);
      const off = Math.abs(Math.atan2(Math.sin(b.bodyAngle - va), Math.cos(b.bodyAngle - va)));
      if (off > 0.45) return `2.5 s after being thrown 70° side-on, its nose is ${(off * 180 / Math.PI).toFixed(0)}° off the way it flies`;
      // the glider: a plank flying left, a cockpit on it, a steering flap trailing off its right end
      const spin = (u: number) => {
        kit.reset();
        world();
        upTo(600);
        const yy = r.camY;
        const plank = kit.spawn('plank', 0, yy);
        const seat = kit.spawn('cockpit', 0, yy + 0.45);
        const flap = kit.spawn('control-flap', 0.85, yy);
        kit.advance(0);
        weld(plank, seat, { x: 0, y: yy + 0.1 });
        weld(plank, flap, { x: 0.8, y: yy });
        const all = [plank, seat, flap];
        for (const e of all) e.setVelocity(-45, 0);
        const p = plank.parts[0];
        let av = 0;
        follow(p, 0.6, () => {
          game.piloting.drive([seat], { x: 0, t: 0, r: u, boost: false });
          av = p.av;
        });
        return av;
      };
      const q = spin(1);
      const e = spin(-1);
      if (!(q > 0.3)) return `Q (anticlockwise) turned the glider at ${q.toFixed(2)} rad/s`;
      if (!(e < -0.3)) return `E (clockwise) turned the glider at ${e.toFixed(2)} rad/s`;
      return true;
    }],
    ['extra: orbit: on the World, something 100 km up going sideways at orbital speed falls round the planet and stays up, as its apoapsis and periapsis say', () => {
      world();
      upTo(100000, 4000);
      const box = kit.spawn('metal-box', r.camX, r.camY);
      kit.advance(0);
      const p = box.parts[0];
      const R = game.air.radius;
      const h0 = alt(p);
      const g = Math.abs(game.gravity) * (R / (R + h0)) ** 2;
      const v = Math.sqrt(g * (R + h0));
      box.setVelocity(v, 0);
      kit.advance(0);
      const o = orbitOf(h0, v, 0, R, Math.abs(game.gravity));
      if (Math.abs(o.apo - h0) > h0 * 0.1 || Math.abs(o.peri - h0) > h0 * 0.1) return `at ${(h0 / 1000).toFixed(1)} km going ${v.toFixed(0)} m/s the readout says apoapsis ${(o.apo / 1000).toFixed(1)} km, periapsis ${(o.peri / 1000).toFixed(1)} km`;
      let lo = Infinity;
      let hi = -Infinity;
      follow(p, 40, () => {
        const h = alt(p);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      });
      if (lo < h0 * 0.85 || hi > h0 * 1.15) return `40 s in orbit it went between ${(lo / 1000).toFixed(1)} and ${(hi / 1000).toFixed(1)} km (from ${(h0 / 1000).toFixed(1)})`;
      if (!(Math.hypot(p.vx, p.vy) > v * 0.9)) return `40 s on it’s slowed to ${Math.hypot(p.vx, p.vy).toFixed(0)} m/s (from ${v.toFixed(0)})`;
      return true;
    }],
  ];
}

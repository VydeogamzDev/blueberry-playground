import type { Test, TestCtx } from './types';
import type { Aircraft } from '../../entities/Planes';
import type { Human } from '../../entities/Human';
import { ITEMS, getItem } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { WORLD_MAP } from '../../world/Maps';

/** The prebuilt aircraft (0.4.5): they stand, fly by the real ones' numbers, and come apart in a crash. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const r = game.renderer;
  const deg = (a: number) => (a * 180) / Math.PI;
  /** On the World's airfield, `x` m east of the start, standing on its gear. */
  const place = (id: string, x: number): Aircraft => {
    const lx = x - game.origin.x;
    const e = kit.spawn(id, lx, game.env.groundAt(lx, 1e6) + (getItem(id)?.halfHeight ?? 1) + 0.05) as Aircraft;
    return e;
  };
  /** Puts someone in its next seat, as letting go of them over its cabin does. */
  const board = (e: Aircraft, h: Human): boolean => {
    const [x, y, w, hh] = (e as unknown as { cfg: { cabin: [number, number, number, number] } }).cfg.cabin;
    return e.takeIn(h, e.parts[0].pixelToWorld(x + w / 2, y + hh / 2));
  };
  const world = () => {
    kit.reset();
    game.setMap(WORLD_MAP);
    r.camX = -game.origin.x;
    r.camY = 20;
    kit.advance(0);
  };
  /** Steps `s` seconds, the camera kept on `b` (things far from every camera are put away). */
  const fly = (e: Aircraft, s: number, each: (t: number) => void) => {
    const b = e.parts[0];
    const n = Math.round(s / game.stepDt);
    for (let i = 0; i < n && !b.destroyed; i++) {
      r.camX = b.x;
      r.camY = b.y;
      each(i * game.stepDt);
      game.step();
    }
  };

  return [
    ['aircraft: the Aircraft shelf has the seven FAA categories, two each of airliners and light aircraft, three military jets (0.5.1: the F-15EX)', () => {
      const list = ITEMS.filter((i) => i.category === 'Aircraft');
      const groups = new Map<string, number>();
      for (const i of list) groups.set(i.group ?? '', (groups.get(i.group ?? '') ?? 0) + 1);
      for (const [g, n] of [['Airplane · Commercial', 2], ['Airplane · General aviation', 2], ['Airplane · Military', 3]] as const) if (groups.get(g) !== n) return `${g}: ${groups.get(g) ?? 0}`;
      for (const g of ['Rotorcraft', 'Powered-lift', 'Glider', 'Lighter-than-air', 'Powered parachute', 'Weight-shift-control']) if (!groups.get(g)) return `no ${g}`;
      return true;
    }],
    ['aircraft: every aircraft spawns standing on its gear (or basket), upright and whole', () => {
      world();
      const ids = ITEMS.filter((i) => i.category === 'Aircraft').map((i) => i.id);
      const made = ids.map((id, i) => [id, place(id, -180 + i * 40)] as const);
      kit.advance(3);
      for (const [id, e] of made) {
        const b = e.parts[0];
        if (e.destroyed || e.wrecked) return `${id} broke standing`;
        if (Math.abs(deg(b.bodyAngle)) > 8) return `${id} stands at ${deg(b.bodyAngle).toFixed(0)}°`;
        if (Math.hypot(b.vx, b.vy) > 0.5 && id !== 'hot-air-balloon') return `${id} still moving at ${Math.hypot(b.vx, b.vy).toFixed(1)} m/s`;
      }
      return true;
    }],
    ['aircraft: a Cessna 172, selected, W held and Q at 28 m/s, lifts off within 400 m and climbs; the readout shows its speed', () => {
      world();
      const e = place('cessna-172', -150);
      const pilot = kit.spawn('human', e.parts[0].x - 4, e.parts[0].y + 1) as Human;
      kit.advance(0.3);
      if (!board(e, pilot)) return 'the pilot didn’t get in';
      kit.advance(0.5);
      controls.selection = new Set([e]);
      kit.key('KeyW', true);
      const b = e.parts[0];
      const x0 = b.x;
      let off = null as number | null;
      let rotate = -1;
      let hud = '';
      fly(e, 30, (t) => {
        const v = Math.hypot(b.vx, b.vy);
        if (rotate < 0 && v > 28) {
          rotate = t;
          kit.key('KeyQ', true);
        }
        if (rotate >= 0 && t - rotate > 1.5) kit.key('KeyQ', false);
        if (off === null && e.flying) off = b.x - x0;
        if (!hud) hud = controls.pilotHud() ? 'ok' : '';
      });
      kit.key('KeyW', false);
      kit.key('KeyQ', false);
      const alt = b.y - game.env.groundAt(b.x, 1e6);
      if (e.destroyed || e.wrecked) return 'it broke';
      if (!hud) return 'no readout while selected';
      if (e.T < 0.9) return `W held, the throttle's at ${e.T.toFixed(2)}`;
      if (off === null || off > 400) return `it left the ground after ${off?.toFixed(0)} m`;
      if (alt < 30) return `30 s on it's ${alt.toFixed(0)} m up`;
      if (!e.occupant(0)) return 'the pilot fell out';
      return true;
    }],
    ['aircraft: a Black Hawk hovers at about two thirds collective, climbs on more, and its rotor turns up first', () => {
      world();
      const e = place('uh-60', -100);
      kit.advance(0.5);
      e.activate();
      e.T = 0;
      const b = e.parts[0];
      fly(e, 8, () => {});
      if (e.spin < 0.95) return `rotor at ${e.spin.toFixed(2)} after 8 s`;
      e.T = 0.62;
      fly(e, 10, () => {});
      const vy = b.vy;
      const h = b.y - game.env.groundAt(b.x, 1e6);
      if (h < 3 || Math.abs(vy) > 1.5) return `at 62%: ${h.toFixed(1)} m up, ${vy.toFixed(1)} m/s`;
      e.T = 1;
      fly(e, 10, () => {});
      if (b.vy < 6 || b.vy > 14) return `full collective climbs at ${b.vy.toFixed(1)} m/s (want 6 to 14)`;
      return true;
    }],
    ['aircraft: a 737 flown into the ground goes up in flames and comes apart; the Cessna beside it too; a pilot in it is hurt', () => {
      world();
      const g0 = game.env.groundAt(-game.origin.x, 1e6);
      const jet = kit.spawn('boeing-737', -60 - game.origin.x, g0 + 30, { angle: -0.4 }) as Aircraft;
      const ces = kit.spawn('cessna-172', 40 - game.origin.x, g0 + 15, { angle: -0.6 }) as Aircraft;
      const pilot = kit.spawn('human', 40 - game.origin.x, g0 + 30) as Human;
      kit.advance(0.05);
      if (!board(ces, pilot)) return 'the pilot didn’t get in';
      for (const p of jet.parts) p.body.setLinvel({ x: 74, y: -32 }, true);
      for (const p of ces.parts) p.body.setLinvel({ x: 30, y: -25 }, true);
      kit.advance(2.5);
      if (!jet.destroyed) return `the 737 is whole (wrecked ${jet.wrecked})`;
      if (!ces.destroyed) return `the Cessna is whole (wrecked ${ces.wrecked})`;
      const debris = game.entities.filter((e) => !e.destroyed && e.def.id === 'debris').length;
      if (debris < 30) return `only ${debris} pieces`;
      if (!pilot.destroyed && pilot.alive && pilot.pain < 10 && pilot.blood > 99) return 'the pilot walked away untouched';
      return true;
    }],
    ['aircraft: a gentle landing (2 m/s down) keeps its gear on; a hard one (6 m/s) folds it', () => {
      world();
      const a = place('cessna-172', -120);
      const b2 = place('cessna-172', -60);
      kit.advance(0.5);
      // (from 0.15 m up: it reaches the ground at 2.3 and 6.2 m/s)
      for (const [e, vy] of [[a, -1.5], [b2, -6]] as const) {
        e.translate(0, 0.15);
        for (const p of e.parts) p.body.setLinvel({ x: 0, y: vy }, true);
      }
      kit.advance(1.5);
      const off = (e: Aircraft) => (e as unknown as { loose: Set<number> }).loose.size;
      if (a.wrecked || off(a)) return `2 m/s: ${off(a)} legs folded`;
      if (!off(b2)) return '6 m/s: the gear held';
      return true;
    }],
    ['aircraft: saved and loaded, a flying aircraft keeps its throttle, flaps and engines on', () => {
      world();
      const e = place('boeing-737', -150);
      kit.advance(0.3);
      e.on = true;
      e.T = 0.7;
      e.pilotCommand('flaps');
      kit.advance(1);
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.1);
      const g = game.entities.find((x) => x.def.id === 'boeing-737') as Aircraft | undefined;
      if (!g) return 'gone';
      if (Math.abs(g.T - 0.7) > 0.02 || !g.on) return `throttle ${g.T}, on ${g.on}`;
      if (g.flapsWant !== 0.5) return `flaps ${g.flapsWant}`;
      return true;
    }],
    // ---- 0.5.1
    ['aircraft: Q held half-loops an F-16 and an F-15EX (at 210 m/s on afterburner) round to fly back the other way, and pulls a Cessna up through 90° (0.5.1: the stick got half its pitch rate)', () => {
      for (const [id, v, past] of [['f-16', 210, 175], ['f-15ex', 210, 175], ['cessna-172', 60, 90]] as const) {
        world();
        const e = place(id, -150);
        e.translate(0, 250);
        for (const p of e.parts) p.body.setLinvel({ x: v, y: 0 }, true);
        e.on = true;
        e.T = e.N = 1;
        controls.selection = new Set([e]);
        const b = e.parts[0];
        let turned = 0;
        let last = b.bodyAngle;
        kit.key('KeyQ', true);
        kit.key('Semicolon', true);
        fly(e, 12, () => {
          const a = b.bodyAngle;
          turned += Math.atan2(Math.sin(a - last), Math.cos(a - last));
          last = a;
        });
        kit.key('KeyQ', false);
        kit.key('Semicolon', false);
        if (e.destroyed || e.wrecked) return `${id} came apart`;
        if (deg(turned) < past) return `${id}: in 12 s of Q it turned ${deg(turned).toFixed(0)}°`;
      }
      return true;
    }],
    ['aircraft: [ puts an F-15EX’s gear up only in the air (its wheels touch nothing and aren’t drawn), [ again brings it down; saved, it stays up', () => {
      world();
      const e = place('f-15ex', -150);
      kit.advance(1);
      controls.selection = new Set([e]);
      kit.press('BracketLeft');
      if (e.gearUp) return 'the gear went up on the ground';
      if ((e as unknown as { cfg: { bodyUp?: unknown } }).cfg.bodyUp === undefined) return 'no gear-up art';
      e.translate(0, 200);
      for (const p of e.parts) p.body.setLinvel({ x: 120, y: 0 }, true);
      e.on = true;
      e.T = e.N = 0.8;
      kit.advance(0.6);
      const body = e.parts[0];
      const legs = body.art;
      kit.press('BracketLeft');
      if (!e.gearUp) return 'the gear stayed down in the air';
      if (body.art === legs) return 'its picture kept its legs';
      const wheels = e.parts.slice(1, 3);
      if (wheels.some((w) => w.sprite.h !== 0 || !w.colliders.every((c) => c.isSensor()))) return 'a wheel still drawn or touching';
      if (!e.status().includes('gear up')) return `readout: ${e.status()}`;
      const s = saveToString(game);
      kit.press('BracketLeft');
      if (e.gearUp || wheels.some((w) => w.sprite.h === 0 || w.colliders.some((c) => c.isSensor()))) return '[ again left it up';
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.1);
      const g = game.entities.find((x) => x.def.id === 'f-15ex') as Aircraft | undefined;
      if (!g?.gearUp) return 'loaded, its gear was down';
      if (g.parts.slice(1, 3).some((w) => w.sprite.h !== 0)) return 'loaded, its wheels showed';
      return true;
    }],
    ['aircraft: an F-15EX’s heat seeker goes on 8 (not tool 8), . sets its flaps (not a step), W held at full lights its afterburner and S puts it out', () => {
      world();
      const e = place('f-15ex', -150);
      e.translate(0, 300);
      for (const p of e.parts) p.body.setLinvel({ x: 150, y: 0 }, true);
      e.on = true;
      e.T = e.N = 1;
      kit.advance(0.3);
      controls.selection = new Set([e]);
      const tool = controls.tool;
      const n = game.entities.length;
      kit.press('Digit8');
      if (controls.tool !== tool) return `8 picked a tool (${controls.tool})`;
      if (e.missilesLeft !== 3) return `8: ${e.missilesLeft} missiles left of 4`;
      if (game.entities.length <= n) return 'no missile flew';
      kit.press('Period');
      if (e.flapsWant !== 0.5) return `.: flaps ${e.flapsWant}`;
      fly(e, 1, () => {});
      if (e.wrecked || e.destroyed) return 'its own heat seeker hit it';
      kit.key('KeyW', true);
      fly(e, 1.5, () => {});
      if (e.ab < 0.5) return `W held at full: afterburner ${e.ab.toFixed(2)}`;
      kit.key('KeyW', false);
      fly(e, 0.5, () => {});
      if (e.ab < 0.5) return 'let go of W, the afterburner went out';
      kit.key('KeyS', true);
      fly(e, 0.3, () => {});
      kit.key('KeyS', false);
      fly(e, 0.6, () => {});
      if (e.ab > 0.2) return `S: afterburner still ${e.ab.toFixed(2)}`;
      return true;
    }],
    ['aircraft: \' reloads everything in what’s selected and what it’s built with: an F-15EX’s stores, a pod welded to a crate, a launcher', () => {
      world();
      const e = place('f-15ex', -150);
      e.translate(0, 300);
      for (const p of e.parts) p.body.setLinvel({ x: 150, y: 0 }, true);
      e.on = true;
      kit.advance(0.3);
      e.pilotCommand('missiles');
      e.pilotCommand('bombs');
      e.pilotCommand('rockets');
      e.pilotCommand('flares');
      e.rounds = 3;
      controls.selection = new Set([e]);
      kit.press('Quote');
      const s = e.spec;
      if (e.missilesLeft !== s.missiles!.length || e.bombsLeft !== s.bombs!.length || e.rocketsLeft !== s.rockets!.length) return `stores ${e.missilesLeft}/${e.bombsLeft}/${e.rocketsLeft}`;
      if (e.rounds !== s.gun!.rounds || e.flaresLeft !== s.flares) return `gun ${e.rounds}, flares ${e.flaresLeft}`;
      // a heat-seeker pod welded to a crate: the crate selected, the pod reloads
      const x = -100 - game.origin.x;
      const crate = kit.spawn('crate', x, game.env.groundAt(x, 1e6) + 0.6);
      const pod = kit.spawn('heat-seeker-pod', x, game.env.groundAt(x, 1e6) + 1.4) as unknown as { rounds: number; fire(): unknown } & import('../../world/Entity').Entity;
      kit.advance(0.3);
      game.connections.create('weld', crate.parts[0], { x: crate.parts[0].x, y: crate.parts[0].y + 0.4 }, pod.parts[0], { x: pod.parts[0].x, y: pod.parts[0].y });
      pod.fire();
      pod.fire();
      if ((pod.rounds as number) !== 0) return `the pod has ${pod.rounds} after firing both`;
      controls.selection = new Set([crate]);
      kit.press('Quote');
      if (pod.rounds !== 2) return `the welded pod reloaded to ${pod.rounds}`;
      return true;
    }],
    ['aircraft: orders to an aircraft whose airframe has gone are refused, and nothing breaks the physics (0.5.1: a crash report)', () => {
      world();
      const e = place('f-15ex', -150);
      kit.advance(0.5);
      controls.selection = new Set([e]);
      game.remove(e);
      kit.advance(0.05);
      for (const c of ['gear', 'flaps', 'rockets', 'bombs', 'missiles', 'flares', 'eject', 'reload', 'lights', 'autopilot'] as const) {
        if (e.pilotCommand(c)) return `${c} was heard by a removed aircraft`;
      }
      for (const k of ['BracketLeft', 'Period', 'Quote', 'Digit8', 'Digit9', 'Digit0', 'CapsLock', 'Slash']) kit.press(k);
      kit.advance(0.2);
      if (game.halted) return 'the game halted';
      const tank = kit.spawn('fuel-tank', -140 - game.origin.x, game.env.groundAt(-140 - game.origin.x, 1e6) + 1);
      kit.advance(0.5);
      try {
        tank.parts[0].body.setAdditionalMassProperties(1, { x: 0, y: 0 }, 0.1, true);
      } catch (err) {
        return `the physics was left broken: ${String(err).slice(0, 80)}`;
      }
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Thruster } from '../../entities/Machines';
import type { Human } from '../../entities/Human';
import type {
  Decoupler, DockingPort, FuelTank, GimbalThruster, LandingLeg, LaunchClamp, Parachute, SolidBooster,
} from '../../entities/Rocketry';
import type { EjectionSeat } from '../../entities/Crew';
import type { Part } from '../../world/Part';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { WORLD_MAP } from '../../world/Maps';

/** The rocketry parts (0.4.0: entities/Rocketry), fuel (systems/Fuel) and staging (systems/Piloting). */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  const hold = (code: string, s: number) => {
    kit.key(code, true);
    kit.advance(s);
    kit.key(code, false);
  };
  const tap = (code: string) => {
    kit.key(code, true);
    kit.advance(0.05);
    kit.key(code, false);
  };
  const lit = (t: Thruster) => (t as unknown as { lit: number }).lit;
  const r = game.renderer;
  /** The World, the camera at local (x, y). */
  const world = (x = 0, y = 2) => {
    kit.reset();
    game.setMap(WORLD_MAP);
    r.camX = x;
    r.camY = y;
    r.zoom = r.targetZoom = 64;
    kit.advance(0);
  };
  /** The camera to true (x, y) in hops, a step each, carrying `ents` along (or they're parked). */
  const travel = (x: number, y: number, ents: Entity[] = [], hop = 100) => {
    for (;;) {
      const tx = r.camX + game.origin.x;
      const ty = r.camY + game.origin.y;
      const d = Math.hypot(x - tx, y - ty);
      if (d < 1e-6) break;
      const f = Math.min(1, hop / d);
      const dx = (x - tx) * f;
      const dy = (y - ty) * f;
      r.camX += dx;
      r.camY += dy;
      for (const e of ents) {
        e.translate(dx, dy);
        for (const p of e.parts) p.body.setLinvel({ x: 0, y: 0 }, true);
      }
      game.step();
    }
  };
  const tru = (p: Part) => ({ x: p.x + game.origin.x, y: p.y + game.origin.y });
  /** A small fuel tank standing up with a thruster under it pointing up (a little rocket). */
  const tankRocket = (x = 0) => {
    const tank = kit.spawn('fuel-tank', x, 0.75) as FuelTank;
    const thr = kit.spawn('thruster', x, 0.2, { angle: Math.PI / 2 }) as Thruster;
    kit.advance(0.3);
    weld(tank, thr, { x, y: (tank.main.y + thr.main.y) / 2 });
    kit.advance(0.1);
    return { tank, thr };
  };
  return [
    ['extra: rocketry: a thruster burns the fuel in the tank built in with it, the tank gets lighter, and empty, the thruster stops pushing (its readout says so)', () => {
      kit.reset();
      game.fuel.mode = 'normal';
      const { tank, thr } = tankRocket();
      const full = tank.main.mass;
      tank.take(tank.fuel - 1);
      kit.advance(0.05);
      const light = tank.main.mass;
      if (full - light < 30) return `39 kg of fuel taken out, the tank went from ${full.toFixed(1)} to ${light.toFixed(1)} kg`;
      // (the tank fixed where it is: it stays put while it burns)
      tank.setFrozen(true);
      thr.activate();
      kit.advance(0.5);
      if (!(tank.fuel < 0.95)) return `half a second running, the tank still has ${tank.fuel.toFixed(2)} kg`;
      if (lit(thr) <= 0) return 'with fuel in its tank it isn’t pushing';
      kit.advance(3);
      if (tank.fuel > 1e-6) return `3.5 s at 1200 N (0.48 kg/s) and ${tank.fuel.toFixed(3)} kg left of 1`;
      if (!thr.dry || lit(thr) > 0) return `empty, it’s still pushing (dry ${thr.dry}, lit ${lit(thr)})`;
      controls.selection = new Set([tank]);
      thr.job = 'wire';
      kit.advance(0.1);
      const hud = game.piloting.hudOf([tank]);
      if (!hud?.noFuel || !hud.fuelCap) return `its readout doesn’t say it’s out of fuel (${JSON.stringify(hud)})`;
      tank.fill(5);
      kit.advance(0.2);
      if (thr.dry || lit(thr) <= 0) return 'filled again, it doesn’t light';
      return true;
    }],
    ['extra: rocketry: Settings’ fuel: infinite never runs a tank dry; needing a tank, a thruster with none doesn’t push; normal, a build with no tank runs free', () => {
      kit.reset();
      try {
        const { tank, thr } = tankRocket();
        tank.setFrozen(true);
        game.fuel.mode = 'infinite';
        thr.activate();
        kit.advance(1);
        if (tank.fuel < tank.capacity) return `infinite, the tank went down to ${tank.fuel.toFixed(2)} kg`;
        const lone = kit.spawn('thruster', 3, 0.3, { angle: -Math.PI / 2 }) as Thruster;
        game.fuel.mode = 'required';
        lone.activate();
        kit.advance(0.3);
        if (lit(lone) > 0) return 'needing a tank, a thruster with none pushes';
        game.fuel.mode = 'normal';
        kit.advance(0.3);
        if (lit(lone) <= 0) return 'normal, a thruster with no tank doesn’t push';
        return true;
      } finally {
        game.fuel.mode = 'normal';
      }
    }],
    ['extra: rocketry: a fuel tank shot leaks, and one burning with fuel in it goes up', () => {
      kit.reset();
      const tank = kit.spawn('fuel-tank', 0, 0.5) as FuelTank;
      kit.advance(0.3);
      tank.onBullet({ part: tank.main, point: { x: tank.main.x, y: tank.main.y }, dir: { x: 1, y: 0 }, damage: 1, speed: 400 } as never);
      const f0 = tank.fuel;
      kit.advance(2);
      if (tank.holes.length !== 1) return `${tank.holes.length} holes after one shot`;
      if (!(tank.fuel < f0 - 0.8)) return `holed, it only lost ${(f0 - tank.fuel).toFixed(2)} kg in 2 s`;
      game.fire.ignite(tank.main, 1);
      kit.advance(4);
      if (!tank.destroyed) return 'burning with fuel in it for 4 s, it didn’t go up';
      return true;
    }],
    ['extra: rocketry: fuel doesn’t cross a decoupler; Enter fires the stages in turn: the decoupler lets the top go (thrown apart), then the top’s engine lights', () => {
      kit.reset();
      game.fuel.mode = 'normal';
      const low = kit.spawn('big-fuel-tank', 0, 0.75) as FuelTank;
      const dec = kit.spawn('decoupler', 0, 1.53) as Decoupler;
      const top = kit.spawn('fuel-tank', 0, 1.98) as FuelTank;
      const thr = kit.spawn('thruster', 0.45, 1.98, { angle: Math.PI / 2 }) as Thruster;
      const seat = kit.spawn('cockpit', 0, 2.75);
      kit.advance(0.2);
      weld(low, dec, { x: 0, y: 1.47 });
      weld(dec, top, { x: 0, y: 1.6 });
      weld(top, thr, { x: 0.3, y: 1.98 });
      weld(top, seat, { x: 0, y: 2.4 });
      dec.stage = 1;
      thr.stage = 2;
      kit.advance(0.2);
      if (game.fuel.tanksOf(thr).includes(low)) return 'the top stage’s thruster draws on the tank below the decoupler';
      if (!game.fuel.tanksOf(thr).includes(top)) return 'the top stage’s thruster doesn’t draw on its own tank';
      controls.selection = new Set([seat]);
      hold('KeyW', 1);
      if (lit(thr) > 0) return 'its stage not fired, the thruster pushes on the throttle';
      const hud = game.piloting.hudOf([seat]);
      if (hud?.stageNext !== 1 || hud.stages !== 2) return `its readout says next stage ${hud?.stageNext} of ${hud?.stages}`;
      tap('Enter');
      if (!dec.fired) return 'Enter didn’t fire the decoupler';
      if (C.connectionsOf(dec).some((c) => c.a.entity === top || c.b?.entity === top)) return 'the decoupler still holds the top';
      if (!C.connectionsOf(dec).some((c) => c.a.entity === low || c.b?.entity === low)) return 'the decoupler let go of the stage below it too';
      kit.advance(0.1);
      if (!(top.main.vy > 0.3)) return `the top wasn’t thrown off (it goes ${top.main.vy.toFixed(2)} m/s up)`;
      tap('Enter');
      if (!thr.staged) return 'the second Enter didn’t fire the thruster’s stage';
      kit.advance(0.5);
      if (lit(thr) <= 0) return 'staged, on the throttle, the thruster doesn’t push';
      return true;
    }],
    ['extra: rocketry: a build with a decoupler stages itself: the lower engines climb, F on the cockpit drops them and lights the upper ones; a decoupler fires on power, and comes any size', () => {
      kit.reset();
      game.fuel.mode = 'normal';
      // engines under a bar, a decoupler on it, a beam on that with an engine hanging from each end, the cockpit on top
      const low = [-0.5, 0, 0.5].map((x) => kit.spawn('thruster', x, 0.23, { angle: Math.PI / 2 }) as Thruster);
      const bar = kit.spawn('short-beam', 0, 0.54);
      const dec = kit.spawn('decoupler', 0, 0.71) as Decoupler;
      const beam = kit.spawn('beam', 0, 0.88);
      const up = [-1.3, 1.3].map((x) => kit.spawn('thruster', x, 0.565, { angle: Math.PI / 2 }) as Thruster);
      const seat = kit.spawn('cockpit', 0, 1.35);
      kit.advance(0.2);
      for (const t of low) weld(bar, t, { x: t.main.x, y: 0.46 });
      weld(bar, dec, { x: 0, y: 0.64 });
      weld(dec, beam, { x: 0, y: 0.8 });
      for (const t of up) weld(beam, t, { x: t.main.x, y: 0.8 });
      weld(beam, seat, { x: 0, y: 0.95 });
      controls.selection = new Set([seat]);
      kit.advance(0.2);
      if (low.some((t) => t.stage !== 0)) return `the lower engines were given stages ${low.map((t) => t.stage).join(', ')}, not none (run from the start)`;
      if (dec.stage !== 1 || !dec.autoStaged) return `the decoupler is stage ${dec.stage}${dec.autoStaged ? '' : ' (not worked out)'}, not 1`;
      if (up.some((t) => t.stage !== 1 || !t.autoStaged)) return `the upper engines are stages ${up.map((t) => t.stage).join(', ')}, not 1 with the decoupler`;
      const hud = game.piloting.hudOf([seat]);
      if (hud?.stageNext !== 1) return `the readout's next stage is ${hud?.stageNext}`;
      hold('KeyW', 1);
      if (up.some((t) => lit(t) > 0)) return 'on the throttle before staging, the upper engines push';
      if (low.some((t) => lit(t) <= 0)) return 'on the throttle, the lower engines don’t push';
      // (F, pointing at nothing, the cockpit selected: it's activated)
      controls.hover = null;
      kit.press(controls.bindings.keys('activate')[0] ?? 'KeyF');
      if (!dec.fired) return 'F on the cockpit didn’t fire the decoupler';
      if (up.some((t) => !t.staged)) return 'F on the cockpit didn’t fire the upper engines’ stage';
      kit.advance(0.6);
      if (up.some((t) => lit(t) <= 0)) return 'staged, on the throttle, the upper engines don’t push';
      if (!(seat.parts[0].y - bar.parts[0].y > 0.6)) return `the stages didn't come apart (${(seat.parts[0].y - bar.parts[0].y).toFixed(2)} m)`;
      // set by hand, a build's stages are the player's
      kit.reset();
      const t2 = kit.spawn('thruster', 0, 0.23, { angle: Math.PI / 2 }) as Thruster;
      const d2 = kit.spawn('decoupler', 0, 0.5) as Decoupler;
      const s2 = kit.spawn('cockpit', 0, 0.95);
      kit.advance(0.1);
      weld(t2, d2, { x: 0, y: 0.42 });
      weld(d2, s2, { x: 0, y: 0.58 });
      t2.stage = 3;
      controls.selection = new Set([s2]);
      kit.advance(0.2);
      if (t2.stage !== 3 || d2.stage !== 0) return `staged by hand (engine 3), it was staged again: engine ${t2.stage}, decoupler ${d2.stage}`;
      // power switched to one fires it; and one made bigger is that size
      const sw = kit.spawn('switch', 6, 0.3);
      const d3 = kit.spawn('decoupler', 8, 0.1) as Decoupler;
      kit.advance(0.1);
      C.create('wire', sw.parts[0], { x: 6, y: 0.3 }, d3.parts[0], { x: 8, y: 0.1 });
      kit.advance(0.1);
      if (d3.fired) return 'wired to a switch that’s off, the decoupler fired';
      sw.activate();
      kit.advance(0.1);
      if (!d3.fired) return 'power switched on to the decoupler didn’t fire it';
      const big = kit.spawn('decoupler', -6, 2, { config: { w: 72, h: 8 } });
      if (!big.def.resizable || big.parts[0].w !== 72 || big.parts[0].h !== 8) return `a decoupler made 72 × 8 is ${big.parts[0].w} × ${big.parts[0].h} (resizable: ${big.def.resizable})`;
      return true;
    }],
    ['extra: rocketry: a parachute opened slows a falling tank to a gentle landing; opened at 120 m/s it tears', () => {
      kit.reset();
      const tank = kit.spawn('fuel-tank', 0, 40) as FuelTank;
      const chute = kit.spawn('parachute', 0, 40.55) as Parachute;
      kit.advance(0.05);
      weld(tank, chute, { x: 0, y: 40.45 });
      tank.main.body.setLinvel({ x: 0, y: -15 }, true);
      chute.main.body.setLinvel({ x: 0, y: -15 }, true);
      chute.activate();
      kit.advance(4);
      const c = chute.canopy;
      if (!c) return 'no canopy came out';
      if (c.torn) return 'opened at 15 m/s, it tore';
      const v = -tank.main.vy;
      if (v > 9 || v < 2) return `4 s under its canopy it falls at ${v.toFixed(1)} m/s (wanted 2 to 9)`;
      if (c.main.y < tank.main.y) return 'the canopy’s under the tank';
      // again, at 120 m/s
      kit.reset();
      const t2 = kit.spawn('fuel-tank', 0, 44) as FuelTank;
      const c2 = kit.spawn('parachute', 0, 44.55) as Parachute;
      kit.advance(0.05);
      weld(t2, c2, { x: 0, y: 44.45 });
      for (const e of [t2, c2]) e.main.body.setLinvel({ x: 0, y: -120 }, true);
      c2.activate();
      kit.advance(0.6);
      if (!c2.canopy?.torn) return 'opened at 120 m/s it held';
      return true;
    }],
    ['extra: rocketry: a backpack parachute dropped on someone straps on, and opens by itself as they fall from high up', () => kit.still(async () => {
      kit.reset();
      game.setMap(WORLD_MAP);
      kit.advance(0);
      const h = human(0) as Human;
      kit.advance(0.5);
      const chest = h.limbs.get('upperTorso')!.part;
      const pack = kit.spawn('backpack-parachute', chest.x, chest.y) as Parachute;
      kit.advance(0.05);
      pack.onGrab(pack.main, false, { x: chest.x, y: chest.y });
      if (pack.wearer !== h) return 'dropped on their chest, it didn’t strap on';
      // up 300 m and let go
      for (const e of [h, pack]) e.translate(0, 300);
      game.renderer.camY = chest.y;
      let most = 0;
      game.advance(12, () => {
        most = Math.max(most, -chest.vy);
        game.renderer.camX = chest.x;
        game.renderer.camY = chest.y;
      });
      if (pack.state === 'packed') return `falling ${most.toFixed(0)} m/s it didn’t open`;
      if (pack.canopy?.torn) return 'it tore opening';
      if (-chest.vy > 10) return `under their canopy they fall at ${(-chest.vy).toFixed(1)} m/s`;
      return true;
    })],
    ['extra: rocketry: landing legs fold up and come down on the gear key, and four of them stand a rocket dropped on them upright', () => {
      kit.reset();
      const tank = kit.spawn('big-fuel-tank', 0, 3);
      const legs = [-1, 1].map((s) => kit.spawn('landing-leg', s * 0.36, 2.4, { flip: s < 0 }) as LandingLeg);
      const thr = kit.spawn('thruster', 0, 2.2, { angle: Math.PI / 2 });
      kit.advance(0.05);
      for (const l of legs) weld(tank, l, { x: l.mount.x, y: l.mount.y });
      weld(tank, thr, { x: 0, y: 2.3 });
      for (const e of [tank, ...legs, thr]) e.setFrozen(false);
      kit.advance(3);
      const a = Math.atan2(Math.sin(tank.parts[0].bodyAngle), Math.cos(tank.parts[0].bodyAngle));
      if (Math.abs(a) > 0.3) return `dropped on its legs it tipped to ${a.toFixed(2)} rad`;
      if (tank.parts[0].y < 1.2) return `it sank to ${tank.parts[0].y.toFixed(2)} m (the legs folded under it)`;
      controls.selection = new Set([tank]);
      tap('BracketLeft');
      if (legs.some((l) => l.deployed)) return 'the gear key didn’t fold the legs';
      tap('BracketLeft');
      if (legs.some((l) => !l.deployed)) return 'the gear key again didn’t bring them down';
      return true;
    }],
    ['extra: rocketry: a swivelling thruster alone turns the rocket it’s under on Q, with no other engines or gyroscopes', () => {
      kit.reset();
      const tank = kit.spawn('big-fuel-tank', 0, 1.2) as FuelTank;
      const g = kit.spawn('gimbal-thruster', 0, 0.3, { angle: Math.PI / 2 }) as GimbalThruster;
      kit.advance(0.2);
      weld(tank, g, { x: 0, y: 0.45 });
      kit.advance(0.2);
      controls.selection = new Set([tank]);
      hold('KeyW', 2.2);
      const y = tank.main.y;
      if (y < 2) return `full throttle, it only rose to ${y.toFixed(2)} m`;
      const a0 = tank.main.bodyAngle;
      kit.key('KeyQ', true);
      let sw = 0;
      game.advance(0.8, () => {
        if (Math.abs(g.swivel) > Math.abs(sw)) sw = g.swivel;
      });
      kit.key('KeyQ', false);
      const turned = tank.main.bodyAngle - a0;
      if (Math.abs(sw) < 0.05) return `on Q it only swivelled ${sw.toFixed(3)} rad`;
      if (turned < 0.15) return `on Q it turned ${turned.toFixed(2)} rad (wanted anticlockwise)`;
      return true;
    }],
    ['extra: rocketry: a solid booster burns at full once lit, can’t be switched off, and burns out', () => {
      kit.reset();
      const b = kit.spawn('solid-booster', 0, 0.3, { angle: -Math.PI / 2 }) as SolidBooster;
      kit.advance(0.2);
      b.activate();
      kit.advance(1);
      const used = b.full - b.grain;
      if (used < 3 || used > 4.5) return `a second lit it burnt ${used.toFixed(2)} kg (9000 N: about 3.6)`;
      b.activate();
      kit.advance(0.2);
      if (!b.running) return 'activated again, it went out';
      b.grain = 0.5;
      kit.advance(0.5);
      if (b.running || b.grain > 0) return 'it didn’t burn out';
      return true;
    }],
    ['extra: rocketry: a launch clamp holds a rocket till its engines push harder than it weighs, then lets it go', () => {
      kit.reset();
      const { tank, thr } = tankRocket();
      const clamp = kit.spawn('launch-clamp', -0.45, 0.75) as LaunchClamp;
      kit.advance(0.1);
      weld(clamp, tank, { x: -0.25, y: 0.8 });
      thr.thrust = 0.25;
      thr.activate();
      kit.advance(1.5);
      if (clamp.open) return 'it let go with the engine pushing less than the rocket weighs';
      thr.thrust = 1;
      kit.advance(1.6);
      if (!clamp.open) return 'the engine out-pushing the weight for 1.5 s, it held on';
      kit.advance(1);
      if (tank.main.y < 2) return `let go, the rocket only rose to ${tank.main.y.toFixed(2)} m`;
      return true;
    }],
    ['extra: rocketry: two docking ports face to face pull together and lock; F undocks them', () => {
      kit.reset();
      const a = kit.spawn('docking-port', 0, 0.35) as DockingPort;
      const b = kit.spawn('docking-port', 0.7, 0.35, { flip: true }) as DockingPort;
      kit.advance(3);
      if (a.docked !== b) return `they didn’t dock (${(b.main.x - a.main.x).toFixed(2)} m apart)`;
      if (!C.connectionsOf(a).some((c) => c.kind === 'weld')) return 'docked, there’s no weld between them';
      a.activate();
      kit.advance(0.5);
      if (a.docked || C.connectionsOf(a).length) return 'F didn’t undock them';
      return true;
    }],
    ['extra: rocketry: saved and loaded, tanks keep their fuel, parts their stages, a fired decoupler stays fired and an open parachute stays open on its lines', () => {
      kit.reset();
      const tank = kit.spawn('fuel-tank', 0, 0.5) as FuelTank;
      const dec = kit.spawn('decoupler', 2, 0.3) as Decoupler;
      const chute = kit.spawn('parachute', -2, 6) as Parachute;
      kit.advance(0.2);
      tank.take(27.5);
      dec.stage = 3;
      dec.release();
      chute.stage = 2;
      chute.open();
      kit.advance(0.3);
      const save = saveToString(game);
      kit.reset();
      loadFromString(game, save);
      kit.advance(0.1);
      const t = game.entities.find((e) => e.def.id === 'fuel-tank') as FuelTank | undefined;
      const d = game.entities.find((e) => e.def.id === 'decoupler') as Decoupler | undefined;
      const c = game.entities.find((e) => e.def.id === 'parachute') as Parachute | undefined;
      if (!t || Math.abs(t.fuel - 12.5) > 0.01) return `the tank came back with ${t?.fuel} kg`;
      if (!d || d.stage !== 3 || !d.fired) return `the decoupler came back stage ${d?.stage}, fired ${d?.fired}`;
      if (!c || c.state !== 'open' || !c.canopy || !C.connectionsOf(c).some((k) => k.kind === 'rope')) return `the parachute came back ${c?.state}, canopy ${!!c?.canopy}`;
      if (c.stage !== 2) return `the parachute came back stage ${c.stage}`;
      return true;
    }],
    ['extra: rocketry: the eject key fires an ejection seat clear of its craft, and its pilot comes down under a parachute', () => {
      kit.reset();
      const plank = kit.spawn('plank', 0, 0.3);
      const seat = kit.spawn('ejection-seat', 0, 0.75) as EjectionSeat;
      const thr = kit.spawn('thruster', 0.8, 0.6, { angle: Math.PI / 2 });
      kit.advance(0.3);
      weld(plank, seat, { x: 0, y: 0.42 });
      weld(plank, thr, { x: 0.8, y: 0.42 });
      const h = human(-2) as Human;
      kit.advance(0.5);
      seat.takeIn(h, seat.main.pixelToWorld(9, 12));
      if (seat.pilot !== h) return 'they didn’t sit in the seat';
      const y0 = h.limbs.get('head')!.part.y;
      controls.selection = new Set([seat]);
      kit.advance(0.1);
      tap('Quote');
      if (!seat.fired) return 'the eject key didn’t fire the seat';
      if (C.connectionsOf(seat).some((c) => c.kind === 'weld')) return 'fired, the seat is still welded to the plank';
      let top = y0;
      // (thrown up, its chute opens near the top of the climb)
      game.advance(3, () => (top = Math.max(top, h.limbs.get('head')!.part.y)));
      if (top - y0 < 8) return `it only threw them ${(top - y0).toFixed(1)} m up`;
      if (seat.pilot) return 'they’re still in the seat';
      const pack = game.entities.find((e) => e.def.id === 'backpack-parachute') as Parachute | undefined;
      if (!pack || pack.wearer !== h || pack.state !== 'open') return `no open parachute on them (${pack ? pack.state : 'none'})`;
      if (!h.alive) return 'ejecting killed them';
      return true;
    }],
    ['extra: rocketry: a spacesuit helmet and an oxygen tank keep someone breathing 12 km up, where without them they pass out', () => kit.still(async () => {
      world();
      const a = human(-1) as Human;
      const b = human(1) as Human;
      kit.advance(0.6);
      const head = a.limbs.get('head')!.part;
      const chest = a.limbs.get('upperTorso')!.part;
      const helm = kit.spawn('space-helmet', head.x, head.y);
      const o2 = kit.spawn('oxygen-tank', chest.x, chest.y);
      helm.onGrab(helm.parts[0], false, { x: head.x, y: head.y });
      o2.onGrab(o2.parts[0], false, { x: chest.x, y: chest.y });
      if (!game.oxygen.supplied(a)) return 'helmet and tank on, they don’t have air of their own';
      const ents = [a, b, helm, o2];
      travel(0, 12000, ents);
      // (a frozen plank under them, up there)
      const floor = kit.spawn('plank', 0, r.camY - 1.3);
      floor.setFrozen(true);
      game.advance(25, () => {
        r.camX = 0;
      });
      if (a.breath.air < 0.9) return `with air of their own their breath is at ${a.breath.air.toFixed(2)}`;
      if (!(b.breath.air < 0.3)) return `without, 25 s up there their breath is still at ${b.breath.air.toFixed(2)}`;
      return true;
    })],
    ['extra: rocketry: coming down fast through the air heats what leads, past melting; a heat shield ahead takes it and shades what’s behind', () => kit.still(async () => {
      world();
      const bare = kit.spawn('metal-box', -3, 2);
      const box = kit.spawn('metal-box', 3, 2);
      const shield = kit.spawn('heat-shield', 3, 1.4, { angle: Math.PI });
      kit.advance(0.05);
      weld(box, shield, { x: 3, y: 1.55 });
      const ents = [bare, box, shield];
      travel(0, 2600, ents);
      for (const e of ents) for (const p of e.parts) p.body.setLinvel({ x: 0, y: -520 }, true);
      const t0 = box.parts[0].temp;
      game.advance(1.2, () => {
        r.camY = box.parts[0].y;
        for (const e of ents) for (const p of e.parts) p.body.setLinvel({ x: 0, y: -520 }, true);
      });
      const tb = bare.parts[0].temp;
      const ts = box.parts[0].temp;
      const sh = shield.parts[0].temp;
      if (tb < t0 + 300) return `bare, it only warmed to ${tb.toFixed(0)} °C`;
      if (ts > t0 + (tb - t0) * 0.3) return `behind the shield it got to ${ts.toFixed(0)} °C (bare: ${tb.toFixed(0)})`;
      if (sh < 300) return `the shield itself only got to ${sh.toFixed(0)} °C`;
      return true;
    })],
    ['extra: rocketry: on the World, something going sideways at orbital speed high up falls round the planet (keeps its height), and the readout says it’s in orbit', () => kit.still(async () => {
      world();
      const tank = kit.spawn('fuel-tank', 0, 2);
      const thr = kit.spawn('thruster', 0, 1.45, { angle: Math.PI / 2 });
      kit.advance(0.2);
      weld(tank, thr, { x: 0, y: 1.6 });
      const ents = [tank, thr];
      const h = 15000;
      travel(0, h, ents);
      const v = Math.sqrt((Math.abs(game.gravity) * game.air.radius ** 2) / (game.air.radius + h));
      for (const e of ents) for (const p of e.parts) p.body.setLinvel({ x: v, y: 0 }, true);
      const y0 = tru(tank.parts[0]).y;
      let lo = y0;
      let hi = y0;
      game.advance(15, () => {
        const p = tank.parts[0];
        r.camX = p.x;
        r.camY = p.y;
        const y = tru(p).y;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      });
      if (y0 - lo > 250) return `at ${v.toFixed(0)} m/s sideways it fell ${(y0 - lo).toFixed(0)} m in 15 s`;
      if (hi - y0 > 250) return `it rose ${(hi - y0).toFixed(0)} m`;
      controls.selection = new Set([tank]);
      kit.advance(0.05);
      const hud = game.piloting.hudOf([tank]);
      controls.selection = new Set();
      if (!hud?.peri || hud.peri < 10000) return `its readout gives the bottom of its path as ${hud?.peri}`;
      return true;
    })],
    ['extra: rocketry: a build’s readouts: its mass, push, push against weight and burn time', () => {
      kit.reset();
      const { tank, thr } = tankRocket();
      kit.advance(0.1);
      const s = game.piloting.buildStats([tank]);
      if (!s) return 'no readouts for a tank and a thruster';
      const m = tank.main.mass + thr.main.mass;
      if (Math.abs(s.mass - m) > 1) return `mass ${s.mass.toFixed(1)} (parts weigh ${m.toFixed(1)})`;
      if (Math.abs(s.thrust - 1200) > 1) return `push ${s.thrust.toFixed(0)} N (1200)`;
      if (Math.abs(s.twr - 1200 / (m * 9.81)) > 0.05) return `push against weight ${s.twr.toFixed(2)}`;
      if (Math.abs(s.burn - 40 / 0.48) > 2) return `burn time ${s.burn.toFixed(1)} s (40 kg at 0.48 kg/s: 83)`;
      if (!s.cot || !s.dir || s.dir.y < 0.99) return 'no push marker (or it points the wrong way)';
      return true;
    }],
  ];
}

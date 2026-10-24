import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Car } from '../../entities/Car';
import type { Flask } from '../../entities/Flask';
import type { Switch, Timer, LogicGate } from '../../entities/Devices';
import { RAPIER } from '../../engine/Physics';
import { Liquid } from '../../systems/Liquids';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Fixes to wiring, connections, vehicles, liquids and the ground (found by the bug hunt). */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const P = game.puddles;
  /** A gate's or timer's input is its left half, its output its right (this far from the middle). */
  const L = 6 / 32;
  /** A wire between two things, `la`/`lb` m right of their middles. */
  const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
    C.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0))!;
  /** The fastest any part of these moves now (m/s). */
  const fastest = (list: Entity[]) => {
    let v = 0;
    for (const e of list) for (const p of e.parts) if (!p.destroyed) v = Math.max(v, Math.hypot(p.vx, p.vy));
    return v;
  };
  /** An uncorked flask held still upside down at (x, y), pouring. */
  const pour = (id: string, x: number, y = 1.6): Flask => {
    const f = kit.spawn(id, x, y, { angle: Math.PI }) as Flask;
    f.setFrozen(true);
    f.activate();
    return f;
  };
  /** Pours a whole flask at x, then takes it away. */
  const pourAll = (id: string, x: number) => {
    const f = pour(id, x);
    kit.advance(3.4);
    f.main.teleport(-30, 2.6, 0);
  };
  /** Floor cells from x0 to x1 for which `on` holds. */
  const cells = (x0: number, x1: number, on: (x: number) => boolean) => {
    let n = 0;
    for (let x = x0; x < x1; x += 1 / 32) if (on(x)) n++;
    return n;
  };
  /** Lays a piece of ground (the Terrain tool's way) with these corners. */
  const lay = (pts: [number, number][]) => controls.reshapeMap({ ...game.map, terrain: [...game.map.terrain, { pts, mat: 'ground' }] });

  return [
    ['extra: systems: a pulse goes once round a ring of OR (or AND) gates fed by a button, and on to a lever', () => {
      for (const kind of ['gate-or', 'gate-and']) {
        kit.reset();
        const g1 = kit.spawn(kind, -3, 0.3) as LogicGate;
        const g2 = kit.spawn(kind, 0, 0.3) as LogicGate;
        const bt = kit.spawn('button', -6, 0.3);
        const lever = kit.spawn('switch', 3, 0.3) as Switch;
        kit.advance(0.3);
        wire(g1, g2, L, -L);
        wire(g2, g1, L, -L);
        wire(bt, g1, 0, -L);
        wire(g2, lever, L, 0);
        try {
          bt.activate();
          kit.advance(0.2);
        } catch (e) {
          return `${kind}: pressing the button threw ${(e as Error).message}`;
        }
        // (an AND with its other input off lets nothing through)
        if (kind === 'gate-or' && !lever.on) return 'the pulse round the ring of OR gates never flipped the lever on its way out';
      }
      return true;
    }],
    ['extra: systems: a timer’s ticks and a gate turning true flip a lever; a battery’s steady power doesn’t', () => {
      kit.reset();
      const tm = kit.spawn('timer', -3, 0.3) as Timer;
      const lever = kit.spawn('switch', 0, 0.3) as Switch;
      kit.advance(0.3);
      wire(tm, lever, L, 0);
      tm.interval = 0.5;
      tm.activate();
      let flips = 0;
      let was = lever.on;
      for (let i = 0; i < 44; i++) {
        kit.advance(0.05);
        if (lever.on !== was) flips++;
        was = lever.on;
      }
      if (flips < 3 || flips > 5) return `a timer ticking every 0.5 s flipped the lever ${flips} times in 2.2 s (want about 4)`;
      kit.reset();
      const cell = kit.spawn('battery', -6, 0.3);
      const not = kit.spawn('gate-not', -3, 0.3) as LogicGate;
      const lever2 = kit.spawn('switch', 0, 0.3) as Switch;
      const lever3 = kit.spawn('switch', 3, 0.3) as Switch;
      kit.advance(0.3);
      wire(cell, lever3, 0, 0);
      wire(not, lever2, L, 0);
      kit.advance(0.5);
      if (lever3.on) return 'a battery wired to a lever flipped it';
      // the NOT gate's input wired to the battery: it turns false, then (unwired) true again
      const w = wire(cell, not, 0, -L);
      kit.advance(0.2);
      const before = lever2.on;
      C.remove(w);
      kit.advance(0.2);
      if (lever2.on === before) return 'the NOT gate turning true again didn’t flip the lever on its output';
      kit.advance(1);
      if (lever2.on !== !before) return 'the gate staying true flipped the lever again';
      return true;
    }],
    ['extra: systems: taking a weld or hinge off a pair also tied by a spring or rope lets them collide again', () => {
      for (const [rigid, other] of [['weld', 'spring'], ['hinge', 'rope'], ['weld', 'weld']] as const) {
        kit.reset();
        const a = kit.spawn('crate', -1, 0.5).parts[0];
        const b = kit.spawn('crate', 0, 0.5).parts[0];
        kit.advance(0.3);
        const r = C.create(rigid, a, { x: a.x + 0.3, y: a.y }, b, { x: b.x - 0.3, y: b.y })!;
        C.create(other, a, { x: a.x + 0.3, y: a.y + 0.1 }, b, { x: b.x - 0.3, y: b.y + 0.1 });
        C.remove(r);
        const apart = !!a.noCollide?.has(b);
        if (other === 'weld' ? !apart : apart) return `${rigid} taken off a pair also tied by a ${other}: ${apart ? 'they still pass through each other' : 'they collide, though the other weld holds them'}`;
      }
      return true;
    }],
    ['extra: systems: a weld dragged to something far off holds the two rigidly, as drawn', () => {
      kit.reset();
      const a = kit.spawn('crate', -3, 0.6).parts[0];
      const b = kit.spawn('crate', 3, 0.6).parts[0];
      kit.advance(0.5);
      C.create('weld', a, { x: a.x, y: a.y }, b, { x: b.x, y: b.y });
      const rel = () => {
        const c = Math.cos(-a.a);
        const s = Math.sin(-a.a);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return { x: dx * c - dy * s, y: dx * s + dy * c, a: b.a - a.a };
      };
      kit.advance(0.1);
      const r0 = rel();
      a.body.applyImpulse({ x: 0, y: a.mass * 7 }, true);
      let worst = 0;
      let rose = 0;
      const y0 = b.y;
      for (let i = 0; i < 10; i++) {
        kit.advance(0.1);
        const r = rel();
        worst = Math.max(worst, Math.hypot(r.x - r0.x, r.y - r0.y), Math.abs(r.a - r0.a) * 6);
        rose = Math.max(rose, b.y - y0);
      }
      if (worst > 0.05) return `shoved, the far-welded crate moved ${worst.toFixed(2)} m against the other (or turned as much at 6 m)`;
      if (rose < 0.03) return 'the far-welded crate did not lift with the other';
      // held out from a frozen crate, 6 m away
      kit.reset();
      const f = kit.spawn('crate', 0, 5).parts[0];
      f.entity.setFrozen(true);
      const h = kit.spawn('crate', 6, 5).parts[0];
      kit.advance(0.02);
      const w = C.create('weld', f, { x: f.x, y: f.y }, h, { x: h.x, y: h.y })!;
      const hy = h.y;
      kit.advance(2);
      if (!C.list.includes(w) || hy - h.y > 0.05) return `held out 6 m from a frozen crate, the welded one sagged ${(hy - h.y).toFixed(2)} m${C.list.includes(w) ? '' : ' (the weld broke)'}`;
      return true;
    }],
    ['extra: systems: a spring stretched far snaps rather than flinging things; in use it bounces as it did', () => {
      kit.reset();
      const a = kit.spawn('crate', -25, 0.6).parts[0];
      const b = kit.spawn('crate', 25, 0.6).parts[0];
      kit.advance(0.5);
      const s = C.create('spring', a, { x: a.x, y: a.y }, b, { x: b.x, y: b.y }, 2, undefined, 8)!;
      let peak = 0;
      for (let i = 0; i < 10; i++) {
        kit.advance(0.05);
        peak = Math.max(peak, kit.maxSpeed());
      }
      if (peak > 5) return `a very strong spring made 48 m over its length flung a crate at ${peak.toFixed(1)} m/s`;
      if (C.list.includes(s)) return 'a spring stretched 48 m past its length did not snap';
      // a crate tied to another by a spring, dragged 20 m off: its partner isn't flung
      kit.reset();
      const c1 = kit.spawn('crate', -1, 2);
      const c2 = kit.spawn('crate', 1, 2);
      kit.advance(0.6);
      C.create('spring', c1.parts[0], { x: c1.parts[0].x, y: c1.parts[0].y }, c2.parts[0], { x: c2.parts[0].x, y: c2.parts[0].y }, 2);
      kit.advance(0.2);
      const p2 = c2.parts[0];
      kit.drag(p2.x, p2.y, 21, 2, 0.5, 0.2, true);
      let flung = 0;
      for (let i = 0; i < 20; i++) {
        kit.advance(0.05);
        flung = Math.max(flung, fastest([c1]));
      }
      if (flung > 12) return `dragging a spring-tied crate 20 m off flung the other at ${flung.toFixed(1)} m/s`;
      // hung from above and pulled down a metre: it bounces, and holds
      kit.reset();
      const hung = kit.spawn('crate', 0, 4).parts[0];
      kit.advance(0.02);
      const sp = C.create('spring', hung, { x: hung.x, y: hung.y }, null, { x: hung.x, y: hung.y + 2 })!;
      kit.advance(2);
      const rest = hung.y;
      kit.drag(hung.x, hung.y, hung.x, hung.y - 1, 0.4, 0.3, true);
      let hi = -Infinity;
      for (let i = 0; i < 20; i++) {
        kit.advance(0.05);
        hi = Math.max(hi, hung.y - rest);
      }
      if (!C.list.includes(sp)) return 'a crate on a spring, pulled down a metre and let go, snapped it';
      if (hi < 0.3) return `pulled down a metre and let go, the crate bounced up only ${hi.toFixed(2)} m past where it hung`;
      return true;
    }],
    ['extra: systems: bullets hit a crate falling fast across their path; scene queries see fast things where they are', () => {
      kit.reset();
      const t = kit.spawn('crate', -10, 8).parts[0];
      t.entity.setFrozen(true);
      kit.advance(0.05);
      const gun = kit.spawn('revolver', -30, 8);
      gun.activate();
      const bullets = (game.projectiles as unknown as { bullets: { x: number; y: number }[] }).bullets;
      if (!bullets.length) return 'the revolver did not fire';
      // where the crate falls to the bullet's height as the bullet gets there (420 m/s, 19 m)
      const by = bullets[0].y;
      const tArrive = (t.x - 0.45 - bullets[0].x) / 420;
      t.entity.setFrozen(false);
      t.teleport(-10, by + 10 * tArrive + 4.9 * tArrive * tArrive, 0);
      t.body.setLinvel({ x: 0, y: -10 }, true);
      const hp0 = t.hp;
      for (let i = 0; i < 24 && t.hp >= hp0; i++) game.step();
      if (t.hp >= hp0) return `a bullet passed through a crate falling at 10 m/s across its path (bullet at y ${by.toFixed(2)}, crate now at ${t.y.toFixed(2)})`;
      // a ray cast just after a step finds a body moving at 20 m/s by its trailing edge
      kit.reset();
      const c = kit.spawn('crate', 0, 8).parts[0];
      kit.advance(0.05);
      c.body.setLinvel({ x: 0, y: -20 }, true);
      for (let i = 0; i < 3; i++) {
        game.step();
        const tr = c.body.translation();
        const half = (c.h / 32) * 0.5;
        for (const dy of [half - 0.01, -half + 0.01]) {
          const hit = game.physics.world.castRay(new RAPIER.Ray({ x: tr.x - 3, y: tr.y + dy }, { x: 1, y: 0 }), 6, true);
          if (!hit || game.physics.partOf(hit.collider) !== c) return `a ray ${dy > 0 ? 'under the top' : 'over the bottom'} of a crate falling at 20 m/s missed it`;
        }
      }
      return true;
    }],
    ['extra: systems: a car no one drives, nudged, stops in a second or two; at Turbo it reaches its top speed', () => {
      for (const id of ['car', 'truck']) {
        kit.reset();
        const car = kit.spawn(id, 0, 1.5) as Car;
        kit.advance(1);
        const x0 = car.body.x;
        for (const p of car.parts) p.body.setLinvel({ x: 1.5, y: 0 }, true);
        let stop = Infinity;
        for (let t = 0.25; t <= 4; t += 0.25) {
          kit.advance(0.25);
          if (Math.abs(car.body.vx) < 0.05) {
            stop = t;
            break;
          }
        }
        if (stop > 2.5) return `a ${id} nudged to 1.5 m/s rolled on for over 2.5 s (${(car.body.x - x0).toFixed(2)} m)`;
        if (car.body.x - x0 > 2) return `a ${id} nudged to 1.5 m/s rolled ${(car.body.x - x0).toFixed(2)} m`;
      }
      kit.reset();
      const car = kit.spawn('car', -66, 1.5) as Car;
      kit.advance(0.5);
      for (const label of ['Speed: Turbo', 'Drive']) car.contextActions().find((a) => a.label === label)?.action();
      let top = 0;
      for (let i = 0; i < 30 && car.body.x < 55; i++) {
        kit.advance(0.2);
        top = Math.max(top, car.body.vx);
      }
      if (top < car.topSpeed * 0.93) return `at Turbo the car reached ${top.toFixed(1)} m/s of the ${car.topSpeed.toFixed(1)} it says`;
      return true;
    }],
    ['extra: systems: lightning rocks a car rather than launching it', () => {
      kit.reset();
      const car = kit.spawn('car', 0, 0.9) as Car;
      kit.advance(1.5);
      const y = car.body.y;
      controls.setPower('lightning');
      try {
        let peak = 0;
        kit.drag(-1.5, y, 1.5, y, 0.06, 0, false);
        for (let i = 0; i < 12; i++) {
          kit.advance(0.05);
          peak = Math.max(peak, fastest([car]));
        }
        kit.up(1.5, y);
        if (peak > 2) return `struck by lightning, the car flew off at ${peak.toFixed(1)} m/s`;
        kit.advance(2);
        if (fastest([car]) > 0.2) return `2 s after the lightning the car still rolls at ${fastest([car]).toFixed(2)} m/s`;
      } finally {
        controls.setPower('push');
      }
      return true;
    }],
    ['extra: systems: ground laid under someone’s feet (or through a crate) lifts them onto it gently', () => {
      kit.reset();
      const man = human(4);
      const crate = kit.spawn('crate', 10, 0.5);
      kit.advance(1.5);
      lay([[3, 0], [5, 0], [5, 0.3], [3, 0.3]]);
      lay([[9.8, 0], [12, 0], [12, 0.5], [9.8, 0.5]]);
      let peak = 0;
      for (let i = 0; i < 10; i++) {
        kit.advance(0.1);
        peak = Math.max(peak, fastest([man, crate]));
      }
      if (peak > 2) return `the new ground shot what stood in it out at ${peak.toFixed(1)} m/s`;
      const low = Math.min(...man.parts.filter((p: Part) => !p.destroyed).map((p: Part) => p.y));
      if (low < 0.28) return `the person is still in the new ground (lowest part at ${low.toFixed(2)} m, its top at 0.3)`;
      if (crate.parts[0].y < 0.85) return `the crate is still in the new ground (at ${crate.parts[0].y.toFixed(2)} m)`;
      return true;
    }],
    ['extra: systems: oil floats on water and burns there; acid under oil still eats; both kept by save/load', () => {
      kit.reset();
      pourAll('flask-water', 0);
      pourAll('flask-oil', 0);
      const both = cells(-1, 1, (x) => P.kindAt(x) === Liquid.Oil && P.underAt(x) === Liquid.Water);
      if (both < 15) return `oil poured on water: only ${both} cells with oil on water`;
      const json = saveToString(game);
      loadFromString(game, json);
      const after = cells(-1, 1, (x) => P.kindAt(x) === Liquid.Oil && P.underAt(x) === Liquid.Water);
      if (after < both * 0.9) return `after save/load ${after} of ${both} cells had oil on water`;
      P.igniteNear(0, 0.5);
      kit.advance(1);
      if (P.burningCells < 10) return `lit, oil on water burns over ${P.burningCells} cells`;
      kit.reset();
      pourAll('flask-oil', 0);
      pourAll('flask-acid', 0);
      const under = cells(-1, 1, (x) => P.underAt(x) === Liquid.Acid && P.oilAt(x) > 0.05);
      if (under < 15) return `acid poured on oil: only ${under} cells with acid under the oil`;
      const plank = kit.spawn('plank', 0, 0.3).parts[0];
      kit.advance(0.5);
      const hp0 = plank.hp;
      kit.advance(2);
      if (hp0 - plank.hp < 2) return `a plank lying in acid under oil lost only ${(hp0 - plank.hp).toFixed(1)} hp in 2 s`;
      return true;
    }],
    ['extra: systems: water poured on a burning oil slick puts it out for good', () => {
      kit.reset();
      pourAll('flask-oil', 0);
      P.igniteNear(0, 0.5);
      kit.advance(1);
      if (P.burningCells < 10) return `the oil slick barely lit (${P.burningCells} cells)`;
      const w = pour('flask-water', 0);
      kit.advance(4);
      w.main.teleport(-30, 2.6, 0);
      kit.advance(3);
      if (P.burningCells) return `a flask of water on the burning slick left ${P.burningCells} cells burning`;
      return true;
    }],
    ['extra: systems: liquid poured over a crate all ends up on the floor', () => {
      for (const id of ['flask-water', 'flask-acid', 'flask-oil']) {
        kit.reset();
        kit.spawn('crate', 0, 0.5);
        kit.advance(0.5);
        const f = pour(id, 0.1, 2.4);
        kit.advance(4.5);
        // (a flask's ~270 drops of 0.19 px² each)
        const poured = (1 - f.amount) * 270 * 0.19;
        f.main.teleport(-30, 2.6, 0);
        kit.advance(1);
        if (P.total < poured * 0.88) return `${id}: of ${poured.toFixed(1)} px² poured over a crate, ${P.total.toFixed(1)} reached the floor`;
      }
      return true;
    }],
  ];
}

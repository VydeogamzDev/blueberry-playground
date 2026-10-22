import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Human } from '../entities/Human';
import type { Firearm } from '../entities/Firearm';
import type { Explosive } from '../entities/Explosive';
import type { Blade } from '../entities/Melee';
import type { Motor } from '../entities/Machines';
import { getItem } from '../catalog/items';
import { makeTestKit } from './testkit';
import { saveToString, loadFromString } from '../world/SaveLoad';

interface Result {
  name: string;
  pass: boolean;
  detail: string;
  ms: number;
}

/**
 * The spec's quality checklist as automated, deterministic checks. Runs the
 * simulation synchronously (no real time needed) and returns pass/fail rows.
 * Usage in the browser console: `await bp.selftest()`.
 */
export function makeSelfTest(game: Game, controls: Controls) {
  const kit = makeTestKit(game, controls);
  const human = (x: number, opts = {}) => kit.spawn('human', x, 0.9, opts) as Human;
  const hp = (h: Human) => h.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  /** Drags a fresh gun into a person's front hand. */
  const arm = (h: Human, id = 'rifle'): Firearm | undefined => {
    const hand = h.limbs.get('handF')!.part;
    const g = kit.spawn(id, hand.x + 1.5 * (h.flipped ? -1 : 1), 0.3, { flip: h.flipped }) as Firearm;
    kit.advance(0.5);
    const gp = g.gripWorld()!;
    kit.drag(gp.x, gp.y, hand.x, hand.y, 0.6, 0.3, true);
    kit.advance(1.5);
    return h.heldItems()[0] as Firearm | undefined;
  };

  const tests: [string, () => string | true][] = [
    ['1. spawn a human: stands still', () => {
      kit.reset();
      const h = human(0);
      kit.advance(3);
      const head = h.limbs.get('head')!.part;
      if (h.state !== 'stand') return `state ${h.state}`;
      if (kit.maxSpeed() > 0.05) return `still moving ${kit.maxSpeed().toFixed(3)} m/s`;
      if (head.y < 1.4) return `head too low ${head.y.toFixed(2)}`;
      return true;
    }],
    ['2. drag a hand: body follows, joints hold', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const hand = h.limbs.get('handF')!.part;
      kit.drag(hand.x, hand.y, hand.x + 1.5, hand.y + 1.6, 0.6, 0.6, false);
      const lifted = h.limbs.get('lowerTorso')!.part.y;
      kit.up(0, 0);
      kit.advance(4);
      const sev = (h.serialize().extra as { severed: string[] }).severed;
      if (lifted < 0.85) return `torso not lifted (${lifted.toFixed(2)})`;
      if (sev.length) return `limbs torn: ${sev.join(',')}`;
      return true;
    }],
    ['3. heavy objects: crate stuns, steel box kills', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2);
      kit.advance(1);
      kit.spawn('crate', -2, 3.6);
      kit.spawn('metal-box', 2, 4.6);
      kit.advance(3);
      if (a.consciousness > 0.6 && a.alive && hp(a) > 1500) return `crate did nothing (${a.status()})`;
      if (b.alive) return `steel box did not kill (${b.status()})`;
      return true;
    }],
    ['4a. eight limp ragdolls piled: come to rest', () => {
      kit.reset();
      const hs: Human[] = [];
      for (let i = 0; i < 8; i++) hs.push(kit.spawn('human', (i % 2) * 0.3, 1 + i * 0.9, { angle: i * 0.7 }) as Human);
      for (const h of hs) h.limp = true;
      let peak = 0;
      let sum = 0;
      let n = 0;
      // a heap of eight bodies slumps for a while; judge it once it has had time to
      game.advance(12, (i) => {
        if (i < 960 || i % 6) return;
        for (const h of hs) for (const p of h.parts) {
          if (p.destroyed) continue;
          const v = Math.hypot(p.vx, p.vy);
          peak = Math.max(peak, v);
          sum += v;
          n++;
        }
      });
      if (sum / n > 0.05) return `still moving (mean ${(sum / n).toFixed(3)} m/s)`;
      if (peak > 5) return `launch: ${peak.toFixed(1)} m/s`;
      if (kit.lowestPoint() < -0.05) return 'something fell through the floor';
      return true;
    }],
    ['4b. eight conscious people piled: no launches', () => {
      kit.reset();
      for (let i = 0; i < 8; i++) kit.spawn('human', (i % 2) * 0.3, 1 + i * 0.9, { angle: i * 0.7 });
      let peak = 0;
      game.advance(8, (i) => {
        if (i > 240 && i % 10 === 0) peak = Math.max(peak, kit.maxSpeed());
      });
      if (peak > 9) return `launch: ${peak.toFixed(1)} m/s`;
      if (kit.lowestPoint() < -0.05) return 'something fell through the floor';
      return true;
    }],
    ['5. shoot a character: wounds, headshot kills', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const g = kit.spawn('pistol', -2.5, h.limbs.get('head')!.part.y + 0.03) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      const before = h.blood;
      g.fire();
      kit.advance(1);
      if (h.alive) return `headshot survived (${h.status()})`;
      if (!(h.blood < before)) return 'no bleeding';
      return true;
    }],
    ['6. explosion: throws objects, hurts people', () => {
      kit.reset();
      const h = human(2);
      const c = kit.spawn('crate', -1.2, 0.45);
      kit.advance(1);
      const before = hp(h);
      const gr = kit.spawn('grenade', 0, 0.3) as Explosive;
      gr.activate();
      kit.advance(3.4);
      if (!gr.destroyed) return 'grenade did not go off';
      if (c.parts[0].x > -1.5 && !c.destroyed) return 'crate not thrown';
      if (hp(h) >= before) return 'person unhurt';
      return true;
    }],
    ['7. freeze and stack', () => {
      kit.reset();
      const base = kit.spawn('crate', 0, 2);
      base.setFrozen(true);
      kit.spawn('crate', 0, 2.9);
      kit.spawn('crate', 0.1, 3.8);
      kit.advance(3);
      if (Math.abs(base.parts[0].y - 2) > 1e-4) return 'frozen crate moved';
      if (kit.maxSpeed() > 0.02) return `stack not at rest (${kit.maxSpeed().toFixed(3)})`;
      return true;
    }],
    ['8. rope holds its length', () => {
      kit.reset();
      const c = kit.spawn('crate', 0, 0.45);
      kit.advance(0.3);
      controls.arm(getItem('tool-rope')!);
      kit.down(0, 0.7);
      kit.move(0, 3.5);
      kit.up(0, 3.5);
      controls.arm(null);
      const conn = game.connections.list[0];
      if (!conn) return 'no rope created';
      kit.drag(0, 0.45, 2, 1.5, 0.5, 0.2, true);
      kit.advance(2);
      const a = c.parts[0].localToWorld(conn.la.x, conn.la.y);
      const d = Math.hypot(a.x - conn.lb.x, a.y - conn.lb.y);
      if (d > conn.rest + 0.03) return `rope stretched to ${d.toFixed(3)} (rest ${conn.rest.toFixed(3)})`;
      return true;
    }],
    ['9. pause / single step / resume', () => {
      kit.reset();
      const c = kit.spawn('crate', 0, 4);
      const loop = (game as unknown as { loop: (t: number) => void; lastTime: number });
      // drive the frame loop with synthetic timestamps (works with the tab hidden)
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      try {
        let t = performance.now();
        loop.lastTime = t;
        const run = (ms: number) => {
          const end = t + ms;
          while (t < end) loop.loop((t += 1000 / 60));
        };
        run(100);
        kit.press('Space');
        const y0 = c.parts[0].y;
        run(500);
        if (c.parts[0].y !== y0) return 'moved while paused';
        kit.press('Period');
        run(17);
        if (!(c.parts[0].y < y0)) return 'single step did nothing';
        kit.press('Space');
        const y1 = c.parts[0].y;
        run(200);
        if (!(c.parts[0].y < y1 - 0.05)) return 'did not resume';
      } finally {
        window.requestAnimationFrame = raf;
        game.paused = false;
      }
      return true;
    }],
    ['10. spawn/delete 300 objects x3: no leaks', () => {
      kit.reset();
      const w = game.physics.world;
      const ids = kit.items().filter((i) => !i.startsWith('tool-'));
      const base = [w.bodies.len(), w.colliders.len(), w.impulseJoints.len(), game.renderer.scene.children.length];
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let i = 0; i < 300; i++) kit.spawn(ids[i % ids.length], -30 + (i % 60), 1 + Math.floor(i / 60) * 2.2);
        kit.advance(0.6);
        game.clearAll();
        kit.advance(0.1);
      }
      const now = [w.bodies.len(), w.colliders.len(), w.impulseJoints.len(), game.renderer.scene.children.length];
      if (now.join() !== base.join()) return `leaked: ${base.join('/')} -> ${now.join('/')}`;
      if (game.physics.partByCollider.size) return 'collider map not empty';
      return true;
    }],
    ['extra: person holds and fires a rifle', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const held = arm(h);
      if (!held) return 'not held';
      if (h.state !== 'stand') return `fell over (${h.state})`;
      if (Math.abs(held.main.a) > 0.25) return `not aiming level (${held.main.a.toFixed(2)})`;
      h.activate();
      kit.advance(0.2);
      if (!held.shots) return 'did not fire';
      return true;
    }],
    ['extra: save/load keeps held guns and lodged knives', () => {
      kit.reset();
      const a = human(-1);
      const b = human(1.5);
      kit.advance(1);
      if (!arm(a)) return 'could not arm';
      const t = b.limbs.get('midTorso')!.part;
      const k = kit.spawn('knife', 0.6, t.y) as Blade;
      kit.advance(0.01);
      k.setVelocity(9, 0, 0);
      kit.advance(0.4);
      if (!k.lodge) return 'knife did not lodge';
      const json = saveToString(game);
      loadFromString(game, json);
      kit.advance(0.5);
      const people = game.entities.filter((e) => e.def.id === 'human') as Human[];
      const holder = people.find((h) => h.heldItems().length);
      if (!holder) return 'held gun not restored';
      const knife = game.entities.find((e) => e.def.id === 'knife') as Blade | undefined;
      if (!knife?.lodge) return 'lodged knife not restored';
      return true;
    }],
    ['extra: flipping a person keeps their gun and stance', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      if (!arm(h)) return 'could not arm';
      const n = game.flipEntity(h) as Human | null;
      if (!n) return 'flip failed';
      kit.advance(1.5);
      const g = n.heldItems()[0] as Firearm | undefined;
      if (!g) return 'dropped the gun';
      if (g.flipped !== n.flipped) return 'gun faces the wrong way';
      if (!n.status().endsWith('stand')) return `fell over (${n.status()})`;
      const fwd = g.forward();
      if (fwd.x * (n.flipped ? -1 : 1) < 0.9) return 'not aiming forward';
      return true;
    }],
    ['extra: duplicating a welded pair copies the weld', () => {
      kit.reset();
      const a = kit.spawn('crate', -0.5, 0.45);
      const b = kit.spawn('crate', 0.4, 0.45);
      kit.advance(0.3);
      controls.arm(getItem('tool-weld')!);
      kit.down(-0.5, 0.45);
      kit.move(0.4, 0.45);
      kit.up(0.4, 0.45);
      controls.arm(null);
      const conns = () => game.connections.list.length;
      if (conns() !== 1) return 'weld not made';
      controls.duplicate([a, b]);
      kit.advance(0.5);
      if (conns() !== 2) return `connections after duplicate: ${conns()}`;
      return true;
    }],
    ['extra: contraptions: car, button-fired gun, powered rotor', () => {
      kit.reset();
      const tool = (id: string, ax: number, ay: number, bx: number, by: number) => {
        controls.arm(getItem(id)!);
        kit.down(ax, ay);
        kit.move(bx, by);
        kit.up(bx, by);
        controls.arm(null);
      };
      // a plank on two motor wheels drives off
      const plank = kit.spawn('plank', -8, 0.9);
      const w1 = kit.spawn('motor-wheel', -8.7, 0.4) as Motor;
      const w2 = kit.spawn('motor-wheel', -7.3, 0.4) as Motor;
      kit.advance(0.6);
      tool('tool-weld', w1.housing.x, w1.housing.y, w1.housing.x, plank.parts[0].y);
      tool('tool-weld', w2.housing.x, w2.housing.y, w2.housing.x, plank.parts[0].y);
      w1.activate();
      w2.activate();
      // a button wired to a frozen pistol, pressed by a falling brick
      const btn = kit.spawn('button', 4, 0.1);
      const gun = kit.spawn('pistol', 5, 1.2) as Firearm;
      gun.setFrozen(true);
      kit.advance(0.5);
      tool('tool-wire', btn.parts[0].x, btn.parts[0].y, gun.parts[0].x, gun.parts[0].y);
      kit.spawn('brick', btn.parts[0].x, 1.2);
      // a battery powering a motor with a plank welded to its rotor
      const bat = kit.spawn('battery', 9, 0.3);
      const mot = kit.spawn('motor', 12, 3.5) as Motor;
      mot.housing.setFrozen(true);
      kit.advance(0.3);
      const blade = kit.spawn('plank', 13.15, 3.5);
      blade.setFrozen(true);
      tool('tool-weld', 11.95, 3.5, 12.5, 3.5);
      blade.setFrozen(false);
      tool('tool-wire', bat.parts[0].x, bat.parts[0].y, 11.85, 3.55);
      kit.advance(3);
      if (plank.parts[0].x < -5) return `car did not drive right (x ${plank.parts[0].x.toFixed(2)})`;
      if (!gun.shots) return 'falling brick did not fire the wired gun';
      if (Math.abs(mot.rotor.body.angvel()) < 1) return 'powered motor did not spin its blade';
      return true;
    }],
    ['extra: thrown knife lodges and pulls out', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const t = h.limbs.get('midTorso')!.part;
      const k = kit.spawn('knife', -1.2, t.y) as Blade;
      kit.advance(0.01);
      k.setVelocity(9, 0, 0);
      kit.advance(0.5);
      if (!k.lodge) return 'did not lodge';
      const p = k.main.pixelToWorld(2, 1);
      kit.drag(p.x, p.y, p.x - 1.2, p.y + 0.2, 0.6, 0.3, true);
      if (k.lodge) return 'could not pull out';
      return true;
    }],
  ];

  return async (): Promise<Result[]> => {
    const results: Result[] = [];
    for (const [name, fn] of tests) {
      const t0 = performance.now();
      let r: string | true;
      try {
        r = fn();
      } catch (e) {
        r = 'threw: ' + String(e);
      }
      results.push({ name, pass: r === true, detail: r === true ? 'ok' : r, ms: Math.round(performance.now() - t0) });
      await new Promise((res) => setTimeout(res, 0));
    }
    kit.reset();
    console.table(results);
    return results;
  };
}

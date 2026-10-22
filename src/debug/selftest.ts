import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Human } from '../entities/Human';
import type { Firearm } from '../entities/Firearm';
import type { Explosive } from '../entities/Explosive';
import type { Blade } from '../entities/Melee';
import type { Motor, LightBulb } from '../entities/Machines';
import type { Switch, MotionSensor, Timer, Piston } from '../entities/Devices';
import type { Car } from '../entities/Car';
import type { Syringe } from '../entities/Syringe';
import type { Flask } from '../entities/Flask';
import type { Creature } from '../entities/Creature';
import type { Entity } from '../world/Entity';
import { getItem } from '../catalog/items';
import { makeTestKit } from './testkit';
import { saveToString, loadFromString } from '../world/SaveLoad';
import { PX } from '../engine/constants';

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
      // bodies in the heap don't sink visibly into each other
      const world = game.physics.world;
      let sink = 0;
      for (const h of hs) for (const p of h.parts) {
        if (p.destroyed) continue;
        for (const c of p.colliders) {
          world.contactPairsWith(c, (o) => {
            const q = game.physics.partOf(o);
            if (!q || q.entity === h) return;
            world.contactPair(c, o, (m) => {
              for (let k = 0; k < m.numContacts(); k++) sink = Math.max(sink, -m.contactDist(k));
            });
          });
        }
      }
      if (sink > PX * 1.5) return `bodies overlap by ${(sink / PX).toFixed(1)} px`;
      return true;
    }],
    ['4b. eight conscious people piled: no launches', () => {
      kit.reset();
      for (let i = 0; i < 8; i++) kit.spawn('human', (i % 2) * 0.3, 1 + i * 0.9, { angle: i * 0.7 });
      let peak = 0;
      game.advance(8, (i) => {
        if (i > 240 && i % 10 === 0) peak = Math.max(peak, kit.maxSpeed());
      });
      // someone tumbling off the top of the pile reaches 7-9 m/s; solver launches are 15+
      if (peak > 12) return `launch: ${peak.toFixed(1)} m/s`;
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
      if (!k.lodge) return `knife did not lodge (knife at ${k.main.x.toFixed(2)}, ${k.main.y.toFixed(2)}; ${b.status()})`;
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
    ['extra: flipping keeps ropes, pins and welds', () => {
      kit.reset();
      const C = game.connections;
      // a crate on a rope from the background, with a brick welded to its side
      const a = kit.spawn('crate', 0, 2.5)!;
      const b = kit.spawn('brick', 0.62, 2.5)!;
      // a plank pinned to the background off its center
      const p = kit.spawn('plank', -4, 2.2)!;
      kit.advance(0.02);
      C.create('rope', a.parts[0], { x: a.parts[0].x, y: a.parts[0].y + 0.4 }, null, { x: 0, y: 4.5 });
      C.create('weld', a.parts[0], { x: 0.5, y: a.parts[0].y }, b.parts[0], { x: 0.5, y: a.parts[0].y });
      C.create('pin', p.parts[0], { x: -4.6, y: 2.2 }, null, { x: -4.6, y: 2.2 });
      kit.advance(1);
      const fa = game.flipEntity(a);
      const fp = game.flipEntity(p);
      if (!fa || !fp) return 'flip failed';
      kit.advance(1.5);
      const ka = C.connectionsOf(fa).map((c) => c.kind).sort().join(',');
      if (ka !== 'rope,weld') return `crate connections after flip: ${ka || 'none'}`;
      if (C.connectionsOf(b).length !== 1) return 'brick lost its weld';
      if (C.connectionsOf(fp).map((c) => c.kind).join() !== 'pin') return 'plank lost its pin';
      if (fa.parts[0].y < 1.5) return `crate fell (y ${fa.parts[0].y.toFixed(2)})`;
      if (fp.parts[0].y < 1.2) return `plank fell (y ${fp.parts[0].y.toFixed(2)})`;
      if (kit.maxSpeed() > 3) return `flip yanked things (${kit.maxSpeed().toFixed(1)} m/s)`;
      return true;
    }],
    ['extra: flipping a selected welded pair keeps its layout', () => {
      kit.reset();
      const a = kit.spawn('crate', -0.5, 0.45)!;
      const b = kit.spawn('brick', 0.42, 0.25)!;
      kit.advance(0.3);
      game.connections.create('weld', a.parts[0], { x: 0, y: 0.3 }, b.parts[0], { x: 0, y: 0.3 });
      kit.advance(0.3);
      const ax = a.parts[0].x;
      const bx = b.parts[0].x;
      const made = game.flipEntities([a, b]);
      kit.advance(1);
      if (made.length !== 2) return `flipped ${made.length} of 2`;
      const [na, nb] = made;
      const mid = (ax + bx) / 2;
      // mirrored as one group: the crate and brick swap sides around their middle
      if (Math.abs(na.parts[0].x - (2 * mid - ax)) > 0.08) return `crate at ${na.parts[0].x.toFixed(2)}, expected ${(2 * mid - ax).toFixed(2)}`;
      if (Math.abs(nb.parts[0].x - (2 * mid - bx)) > 0.08) return `brick at ${nb.parts[0].x.toFixed(2)}, expected ${(2 * mid - bx).toFixed(2)}`;
      if (game.connections.connectionsOf(na).length !== 1) return 'weld lost';
      return true;
    }],
    ['extra: lights: bulb and fire light the scene, night mode', () => {
      kit.reset();
      const r = game.renderer;
      const n = () => (r as unknown as { lightMat: { uniforms: { uLightN: { value: number } } } }).lightMat.uniforms.uLightN.value;
      kit.advance(0.1);
      if (n() !== 0) return `lights in an empty scene: ${n()}`;
      const bulb = kit.spawn('light', 0, 2)!;
      bulb.activate();
      kit.advance(0.1);
      if (n() !== 1) return `lit bulb gave ${n()} lights`;
      const crate = kit.spawn('crate', 3, 0.5)!;
      kit.advance(0.2);
      game.fire.ignite(crate.parts[0], 1);
      kit.advance(0.2);
      if (n() < 2) return 'fire gave no light';
      r.ambient = 0.2;
      kit.advance(0.1);
      r.ambient = 1;
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
      kit.advance(0.05);
      tool('tool-weld', 11.95, 3.5, 12.5, 3.5);
      if (!game.connections.list.some((c) => c.kind === 'weld' && c.b?.entity === blade)) return 'blade not welded to the rotor';
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
    ['extra: long guns dropped on a hand from either side get held', () => {
      for (const [id, side] of [['rifle', 1], ['sniper', -1], ['sniper', 1], ['shotgun', -1], ['minigun', -1], ['minigun', 1]] as const) {
        kit.reset();
        const h = human(0);
        kit.advance(1);
        const hand = h.limbs.get('handF')!.part;
        const hx = hand.x;
        const hy = hand.y;
        const g = kit.spawn(id, hx + side * 1.8, 0.3) as Firearm;
        kit.advance(0.5);
        // grabbed by the far end, so the body of the gun meets the person first and
        // shoves them; the cursor goes to where the hand was and is let go there
        const s = g.main.localToWorld(side * 0.5, 0);
        kit.down(s.x, s.y);
        for (let i = 1; i <= 36; i++) {
          const t = i / 36;
          kit.move(s.x + (hx - s.x) * t, s.y + (hy - s.y) * t);
          game.advance(1 / 60);
        }
        game.advance(0.3);
        kit.up(hx, hy);
        kit.advance(1);
        if (!g.holder) return `${id} from the ${side > 0 ? 'front' : 'back'} not held`;
      }
      return true;
    }],
    ['extra: syringes: heal, knock out, wake up, revive, poison', () => {
      // jab it into the torso across the spine (from above if they are lying down)
      const shoot = (h: Human, id: string): Syringe => {
        const t = h.limbs.get('midTorso')!.part;
        let dx = Math.cos(t.a);
        let dy = Math.sin(t.a);
        if (dy > 0) {
          dx = -dx;
          dy = -dy;
        }
        const s = kit.spawn(id, t.x - dx * 0.9, t.y - dy * 0.9, { angle: Math.atan2(dy, dx) }) as Syringe;
        kit.advance(0.01);
        s.setVelocity(dx * 6, dy * 6, 0);
        kit.advance(0.4);
        return s;
      };
      // healing: a broken, bleeding, poisoned person is mended
      kit.reset();
      let h = human(0);
      kit.advance(1);
      const leg = h.limbs.get('lowerLegF')!;
      leg.broken = true;
      leg.part.hp *= 0.4;
      h.blood = 70;
      h.drugs.poison = 30;
      const s = shoot(h, 'syringe-healing');
      kit.advance(1.5);
      if (s.fill > 0) return `healing syringe did not inject (${s.fill.toFixed(2)} left)`;
      if (leg.broken || leg.part.hp < leg.part.maxHp * 0.95 || h.blood < 99 || h.drugs.poison > 0) return `not healed (${h.status()})`;
      // knockout, then adrenaline wakes them and they get up
      kit.reset();
      h = human(0);
      kit.advance(1);
      shoot(h, 'syringe-knockout');
      kit.advance(2);
      if (h.consciousness > 0.2 || !h.status().endsWith('down')) return `knockout failed (${h.status()})`;
      shoot(h, 'syringe-adrenaline');
      kit.advance(6);
      if (h.consciousness < 0.8 || !h.status().endsWith('stand')) return `adrenaline did not wake them (${h.status()})`;
      // life brings back the dead
      kit.reset();
      h = human(0);
      kit.advance(1);
      h.die();
      kit.advance(1);
      shoot(h, 'syringe-life');
      kit.advance(1.5);
      if (!h.alive) return 'life syringe did not revive';
      // poison kills slowly
      kit.reset();
      h = human(0);
      kit.advance(1);
      shoot(h, 'syringe-poison');
      kit.advance(10);
      if (!h.alive) return 'poison killed too fast';
      kit.advance(25);
      if (h.alive) return `poison did not kill (${h.status()})`;
      return true;
    }],
    ['extra: laser rifle burns through people, stops at metal', () => {
      kit.reset();
      const h = human(0);
      const crate = kit.spawn('crate', 1.3, 0.5)!;
      const steel = kit.spawn('metal-box', 3, 0.4)!;
      const g = kit.spawn('laser-rifle', -3, 1.3) as Firearm;
      kit.advance(0.6);
      const t = h.limbs.get('midTorso')!.part;
      const hp0 = t.hp;
      // aimed level at the torso (and still: not tipping over from the drop)
      g.main.teleport(-3, t.y, 0);
      g.main.body.setLinvel({ x: 0, y: 0 }, true);
      g.main.body.setAngvel(0, true);
      kit.advance(0.02);
      g.fire();
      kit.advance(0.05);
      if (t.hp > hp0 - 10) return `torso barely hurt (${(hp0 - t.hp).toFixed(1)})`;
      if (h.blood < 99.5) return 'laser wound bled (should be cauterised)';
      // through the legs and on into the crate behind
      game.projectiles.laser(-3, 0.5, 1, 0, { damage: 34, color: 0xff3b30 });
      if (crate.parts[0].charred <= 0) return 'beam did not pass through to the crate';
      const end = game.projectiles.laser(-3, 0.35, 1, 0, { damage: 34, color: 0xff3b30 });
      if (Math.abs(end.x - (steel.parts[0].x - 0.34)) > 0.2) return `beam not stopped by the metal box (ended at x ${end.x.toFixed(2)})`;
      return true;
    }],
    ['extra: switch, motion sensor and timer', () => {
      const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
        game.connections.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0));
      kit.reset();
      const bat = kit.spawn('battery', -3, 0.4)!;
      const sw = kit.spawn('switch', -1.5, 0.3) as Switch;
      const lamp = kit.spawn('light', 0, 0.3) as LightBulb;
      kit.advance(0.3);
      wire(bat, sw);
      wire(sw, lamp);
      kit.advance(0.1);
      if (lamp.powered) return 'lamp powered through an open switch';
      sw.activate();
      kit.advance(0.1);
      if (!lamp.powered) return 'closed switch did not pass power';
      // a tripwire fires a wired pistol when a brick falls through its beam
      kit.reset();
      const sen = kit.spawn('sensor', -2, 0.25) as MotionSensor;
      const gun = kit.spawn('pistol', -2, 1.5) as Firearm;
      kit.advance(0.3);
      wire(sen, gun);
      kit.advance(0.2);
      if (gun.shots) return 'sensor fired with nothing in front';
      kit.spawn('brick', 0, 3);
      kit.advance(1.5);
      if (!gun.shots) return 'sensor did not fire the gun';
      // a timer fires a gun every half second
      kit.reset();
      const tm = kit.spawn('timer', -1, 0.3) as Timer;
      const g2 = kit.spawn('pistol', 1, 0.3) as Firearm;
      kit.advance(0.3);
      wire(tm, g2, 6 / 32, 0);
      tm.interval = 0.5;
      tm.activate();
      kit.advance(2.6);
      if (g2.shots < 4 || g2.shots > 6) return `timer fired ${g2.shots} times in 2.6 s`;
      return true;
    }],
    ['extra: logic gates: AND, OR, XOR, NOT truth tables', () => {
      const L = 6 / 32;
      const wire = (a: Entity, b: Entity, la = 0, lb = 0) =>
        game.connections.create('wire', a.parts[0], a.parts[0].localToWorld(la, 0), b.parts[0], b.parts[0].localToWorld(lb, 0));
      const want: Record<string, string> = { and: '0001', or: '0111', xor: '0110', not: '1100' };
      for (const kind of Object.keys(want)) {
        kit.reset();
        const bat = kit.spawn('battery', -3, 0.4)!;
        const s1 = kit.spawn('switch', -1.5, 0.3) as Switch;
        const s2 = kit.spawn('switch', -1.5, 1.2) as Switch;
        const g = kit.spawn('gate-' + kind, 0, 0.3)!;
        const lamp = kit.spawn('light', 1.5, 0.3) as LightBulb;
        kit.advance(0.3);
        wire(bat, s1);
        wire(bat, s2);
        wire(s1, g, 0, -L);
        if (kind !== 'not') wire(s2, g, 0, -L);
        wire(g, lamp, L, 0);
        let got = '';
        for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          if (s1.on !== !!a) s1.activate();
          if (s2.on !== !!b) s2.activate();
          kit.advance(0.1);
          got += lamp.powered ? '1' : '0';
        }
        if (got !== want[kind]) return `${kind}: got ${got}, want ${want[kind]}`;
      }
      return true;
    }],
    ['extra: piston pushes, car drives', () => {
      kit.reset();
      const p = kit.spawn('piston', -1, 0.3) as Piston;
      const crate = kit.spawn('crate', 0.9, 0.5)!;
      kit.advance(0.5);
      p.base.setFrozen(true);
      const x0 = crate.parts[0].x;
      p.activate();
      kit.advance(1.5);
      if (p.extension < 0.9) return `piston extended ${p.extension.toFixed(2)} m`;
      if (crate.parts[0].x - x0 < 0.25) return 'piston did not push the crate';
      p.activate();
      kit.advance(1.5);
      if (p.extension > 0.1) return 'piston did not retract';
      kit.reset();
      const car = kit.spawn('car', -6, 0.6) as Car;
      kit.advance(0.8);
      const cx = car.body.x;
      car.activate();
      kit.advance(3);
      if (car.body.x - cx < 8) return `car only drove ${(car.body.x - cx).toFixed(1)} m in 3 s`;
      if (Math.abs(car.body.a) > 0.5) return 'car tipped over';
      return true;
    }],
    ['extra: liquids: water, acid, oil, shattering', () => {
      // an uncorked flask held upside down over something
      const pour = (id: string, x: number, y: number): Flask => {
        const f = kit.spawn(id, x, y, { angle: Math.PI }) as Flask;
        f.setFrozen(true);
        f.activate();
        return f;
      };
      // water puts out a burning crate
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.5)!.parts[0];
      kit.advance(0.5);
      game.fire.ignite(crate, 1);
      kit.advance(0.5);
      if (crate.burning <= 0) return 'crate did not catch fire';
      const w = pour('flask-water', 0, 2.2);
      kit.advance(3.5);
      if (crate.burning > 0) return `water did not put out the fire (${crate.burning.toFixed(2)})`;
      if (w.amount > 0.05) return `flask did not empty (${w.amount.toFixed(2)} left)`;
      // acid hurts a person
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const hp0 = hp(h);
      const head = h.limbs.get('head')!.part;
      pour('flask-acid', head.x, head.y + 1.2);
      kit.advance(2);
      if (hp(h) > hp0 - 20) return `acid barely hurt (${(hp0 - hp(h)).toFixed(1)} hp)`;
      // oil makes a steel box burn
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.4)!.parts[0];
      kit.advance(0.5);
      game.fire.ignite(box, 0.6);
      if (box.burning > 0) return 'dry steel caught fire';
      pour('flask-oil', 0, 2);
      kit.advance(2.5);
      if (box.oil < 0.3) return `oil did not soak in (${box.oil.toFixed(2)})`;
      game.fire.ignite(box, 0.6);
      kit.advance(2);
      if (box.burning < 0.3) return `oiled steel did not burn (${box.burning.toFixed(2)})`;
      // a shot flask shatters and splashes acid on whoever is next to it
      kit.reset();
      const h2 = human(0);
      const f = kit.spawn('flask-acid', 0.35, 2.1) as Flask;
      f.setFrozen(true);
      const g = kit.spawn('pistol', -2.5, 2.1) as Firearm;
      kit.advance(0.5);
      g.main.teleport(-2.5, 2.1, 0);
      g.setFrozen(true);
      const hp1 = hp(h2);
      g.fire();
      kit.advance(0.1);
      if (!f.destroyed) return 'shot flask did not shatter';
      kit.advance(1.5);
      if (hp(h2) > hp1 - 10) return `splash barely hurt (${(hp1 - hp(h2)).toFixed(1)} hp)`;
      return true;
    }],
    ['extra: hinge and weld by clicking: to the background or what is behind', () => {
      const click = (id: string, x: number, y: number) => {
        controls.arm(getItem(id)!);
        kit.down(x, y);
        kit.up(x, y);
        controls.arm(null);
      };
      // a plank hinged to the background at one end swings down and hangs from it
      kit.reset();
      const plank = kit.spawn('plank', 0, 3)!.parts[0];
      plank.setFrozen(true);
      kit.advance(0.2);
      const end = plank.pixelToWorld(2, plank.h / 2);
      click('tool-hinge', end.x, end.y);
      const c = game.connections.list[0];
      if (!c || c.kind !== 'hinge' || c.b) return 'no background hinge';
      plank.setFrozen(false);
      // it swings like a pendulum: its middle passes right under the hinge
      let low = Infinity;
      let drift = 0;
      for (let i = 0; i < 40; i++) {
        kit.advance(0.1);
        low = Math.min(low, plank.y);
        const a = plank.localToWorld(c.la.x, c.la.y);
        drift = Math.max(drift, Math.hypot(a.x - end.x, a.y - end.y));
      }
      if (drift > 0.03) return `hinge drifted ${drift.toFixed(3)} m`;
      if (low > end.y - 0.8) return `plank did not swing down (lowest ${(end.y - low).toFixed(2)} m below the hinge)`;
      // a wheel clicked where it overlaps a crate is hinged to the crate
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45)!;
      const wheel = kit.spawn('tire', 0.3, 0.45)!;
      kit.advance(0.3);
      const w = wheel.parts[0];
      w.teleport(0.3, 0.45, 0);
      click('tool-hinge', w.x, w.y);
      const h = game.connections.list[0];
      const ends = h ? [h.a.entity, h.b?.entity] : [];
      if (!ends.includes(crate) || !ends.includes(wheel)) return `wheel not hinged to the crate (${h ? h.b?.entity.def.id ?? 'background' : 'none'})`;
      // tools find things spawned this very step (before physics has seen them)
      kit.reset();
      const fresh = kit.spawn('crate', 2, 2)!;
      click('tool-weld', 2, 2);
      const wc = game.connections.list[0];
      if (!wc || wc.a.entity !== fresh) return 'weld missed a just-spawned crate';
      kit.advance(1);
      if (Math.abs(fresh.parts[0].y - 2) > 0.02) return 'crate welded to the background fell';
      return true;
    }],
    ['extra: puddles: pool and spread, put out, burn, corrode', () => {
      const pour = (id: string, x: number) => {
        const f = kit.spawn(id, x, 1.8, { angle: Math.PI }) as Flask;
        f.setFrozen(true);
        f.activate();
      };
      const span = () => {
        let a = Infinity;
        let b = -Infinity;
        for (let x = -4; x < 4; x += 1 / 32) if (game.puddles.amountAt(x) > 0) [a, b] = [Math.min(a, x), Math.max(b, x)];
        return b - a;
      };
      // a flask of water pools and runs out into a thin, wide puddle
      kit.reset();
      pour('flask-water', 0);
      kit.advance(5);
      const vol = game.puddles.total;
      if (vol < 35 || vol > 60) return `water puddle holds ${vol.toFixed(1)} px² (want about a flask, ~50)`;
      if (span() < 1.5) return `puddle only ${span().toFixed(2)} m wide`;
      // poured over someone, it runs off them and pools at their feet
      kit.reset();
      human(0);
      pour('flask-water', 0);
      kit.advance(5);
      if (game.puddles.total < 20) return `water poured on a person left only ${game.puddles.total.toFixed(1)} px² on the floor`;
      // a smashed flask spills most of what it held
      kit.reset();
      const sm = kit.spawn('flask-oil', 0, 1) as Flask;
      sm.setFrozen(true);
      kit.advance(0.1);
      sm.shatter();
      kit.advance(4);
      if (game.puddles.total < 25) return `smashed flask spilled only ${game.puddles.total.toFixed(1)} px²`;
      kit.reset();
      pour('flask-water', 0);
      kit.advance(5);
      // a burning body dropped in water goes out
      const h = kit.spawn('human', 0, 0.4, { angle: Math.PI / 2 }) as Human;
      h.limp = true;
      for (const p of h.parts) game.fire.ignite(p, 1);
      kit.advance(2);
      if (h.parts.some((p) => p.burning > 0)) return 'water puddle did not put out a burning body';
      // acid eats into someone lying in it
      kit.reset();
      pour('flask-acid', 0);
      pour('flask-acid', 0.6);
      kit.advance(4);
      const v = kit.spawn('human', 0.3, 0.4, { angle: Math.PI / 2 }) as Human;
      v.limp = true;
      kit.advance(0.5);
      const hp0 = hp(v);
      kit.advance(3);
      if (hp(v) > hp0 - 50) return `acid puddle barely hurt (${(hp0 - hp(v)).toFixed(1)} hp)`;
      // oil: flames run along it and catch whoever stands in it; grenades light it too
      kit.reset();
      const s = human(0);
      pour('flask-oil', 0.3);
      pour('flask-oil', -0.3);
      kit.advance(4);
      game.puddles.igniteNear(-0.9, 0.1);
      kit.advance(3);
      if (!game.puddles.burningAt(0)) return 'fire did not spread along the oil';
      if (!s.parts.some((p) => p.burning > 0)) return 'person standing in burning oil did not catch fire';
      kit.reset();
      pour('flask-oil', 3);
      kit.advance(4);
      kit.spawn('grenade', 3.5, 0.2)!.activate();
      kit.advance(5);
      if (!game.puddles.burningAt(3)) return 'grenade did not light the oil';
      return true;
    }],
    ['extra: animals: dog, cat, pig and fox stand, get up, land on their feet', () => {
      kit.reset();
      const herd = ['dog', 'cat', 'pig', 'fox'].map((id, i) => kit.spawn(id, -3 + i * 2, 0.6) as Creature);
      for (const a of herd) a.stay(60);
      kit.advance(2);
      // settled: standing still for a while (a last shuffle of the feet is fine)
      let still = 0;
      for (let t = 0; t < 6 && still < 6; t += 0.1) {
        kit.advance(0.1);
        still = kit.maxSpeed() < 0.05 ? still + 1 : 0;
      }
      for (const a of herd) {
        if (a.state !== 'stand') return `${a.def.id} did not stand (${a.status()})`;
        if (Math.abs(a.parts[0].a) > 0.1) return `${a.def.id} leans ${a.parts[0].a.toFixed(2)} rad`;
      }
      if (still < 6) return `still moving ${kit.maxSpeed().toFixed(3)} m/s after 8 s`;
      // knocked over onto its back (or side), each gets back up
      const turns = [['dog', Math.PI], ['dog', Math.PI / 2], ['cat', -Math.PI / 2], ['cat', Math.PI], ['pig', Math.PI / 2], ['pig', Math.PI], ['fox', -Math.PI / 2], ['fox', Math.PI]] as const;
      for (const [id, angle] of turns) {
        kit.reset();
        const a = kit.spawn(id, 0, id === 'cat' ? 0.35 : 0.6, { angle }) as Creature;
        a.stay(60);
        let t = 0;
        while (t < 12 && !(a.state === 'stand' && Math.abs(a.parts[0].a) < 0.15 && t > 1)) {
          kit.advance(0.5);
          t += 0.5;
        }
        if (a.state !== 'stand') return `${id} lying at ${angle.toFixed(2)} rad did not get up (${a.status()})`;
      }
      // a cat dropped upside down turns over and lands on its feet
      kit.reset();
      const c2 = kit.spawn('cat', 0, 2.6, { angle: Math.PI }) as Creature;
      let landed: number | null = null;
      for (let i = 0; i < 30 && landed === null; i++) {
        kit.advance(0.05);
        if (c2.parts.some((p) => p.y < 0.12) || c2.state === 'down') landed = c2.parts[0].a;
      }
      kit.advance(1);
      if (landed === null || Math.abs(landed) > 0.5 || c2.state !== 'stand') return `cat did not land on its feet (tilt ${landed?.toFixed(2)}, ${c2.status()})`;
      return true;
    }],
    ['extra: animals: bleed, die from a headshot, revived by a syringe, saved', () => {
      kit.reset();
      const dog = kit.spawn('dog', -1, 0.6) as Creature;
      const cat = kit.spawn('cat', 1.5, 0.4) as Creature;
      kit.advance(1.5);
      // a shot through the cat's chest: it bleeds and goes down
      const chest = cat.limbs.get('chest')!.part;
      const g = kit.spawn('pistol', chest.x + 2.5, chest.y, { flip: true }) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      g.fire();
      kit.advance(1);
      if (!(cat.blood < 100)) return `shot cat is not bleeding (${cat.status()})`;
      g.destroy();
      // a headshot kills the dog
      const head = dog.limbs.get('head')!.part;
      const g2 = kit.spawn('pistol', head.x + 2.5, head.y - 0.02, { flip: true }) as Firearm;
      g2.setFrozen(true);
      kit.advance(0.05);
      g2.fire();
      kit.advance(1.5);
      if (dog.alive) return `headshot dog survived (${dog.status()})`;
      // and it drops where it stood instead of staying up on stiff legs
      if (dog.limbs.get('chest')!.part.y > 0.45) return `dead dog still standing (chest at ${dog.limbs.get('chest')!.part.y.toFixed(2)} m)`;
      g2.destroy();
      // a life syringe in the chest brings it back
      const t = dog.limbs.get('chest')!.part;
      const s = kit.spawn('syringe-life', t.x, t.y + 0.9, { angle: -Math.PI / 2 }) as Syringe;
      kit.advance(0.01);
      s.setVelocity(0, -6, 0);
      kit.advance(1.5);
      if (!dog.alive) return `life syringe did not revive the dog (fill ${s.fill.toFixed(2)}, ${dog.status()})`;
      // save and load keeps both, wounded cat included
      const blood = cat.blood;
      loadFromString(game, saveToString(game));
      kit.advance(0.2);
      const animals = game.entities.filter((e) => e.def.id === 'dog' || e.def.id === 'cat') as Creature[];
      if (animals.length !== 2) return `${animals.length} animals after loading`;
      const c3 = animals.find((a) => a.def.id === 'cat')!;
      if (Math.abs(c3.blood - blood) > 3) return `cat blood ${blood.toFixed(0)} -> ${c3.blood.toFixed(0)} after loading`;
      // a grenade next to them hurts both
      const d3 = animals.find((a) => a.def.id === 'dog')!;
      const before = d3.parts.reduce((n, p) => n + p.hp, 0);
      (kit.spawn('grenade', d3.parts[0].x + 0.6, 0.3) as Explosive).activate();
      kit.advance(3.5);
      if (d3.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.hp), 0) >= before) return 'grenade did not hurt the dog';
      return true;
    }],
    ['extra: animals walk where they are sent, turn round, and keep their feet in a crowd', () => {
      const chest = (a: Creature) => a.limbs.get('chest')!.part;
      for (const kind of ['dog', 'cat', 'pig', 'fox']) {
        for (const dx of [4, -4]) {
          kit.reset();
          const a = kit.spawn(kind, 0, 0.6) as Creature;
          kit.advance(1.5);
          a.goTo(dx);
          let t = 0;
          while (t < 12 && Math.abs(chest(a).x - dx) > 0.4) {
            kit.advance(0.25);
            t += 0.25;
            if (a.state !== 'stand') return `${kind} walking to ${dx}: fell over (${a.status()})`;
          }
          if (Math.abs(chest(a).x - dx) > 0.4) return `${kind} sent to ${dx} only got to ${chest(a).x.toFixed(2)}`;
          if (a.facing !== Math.sign(dx)) return `${kind} walked to ${dx} facing the other way`;
        }
      }
      // eight animals milling about together for 45 s
      kit.reset();
      const herd: Creature[] = [];
      for (let i = 0; i < 8; i++) herd.push(kit.spawn(['dog', 'cat', 'pig', 'fox'][i % 4], -9 + i * 2.5, 0.6) as Creature);
      // (how long each spent on the move: one that wanders off and back again went somewhere too)
      const walked = herd.map(() => 0);
      for (let i = 0; i < 180; i++) {
        game.advance(0.25, (k) => {
          if (k % 6 === 0) herd.forEach((a, j) => (walked[j] += a.moving ? 0.05 : 0));
        });
        const down = herd.find((a) => a.state !== 'stand');
        if (down) return `${down.def.id} fell over after ${(i * 0.25).toFixed(1)} s among the others (${down.status()})`;
      }
      const about = walked.filter((t) => t > 2).length;
      if (about < 4) return `only ${about} of 8 animals wandered about in 45 s (${walked.map((t) => t.toFixed(0)).join(', ')} s)`;
      return true;
    }],
    ['extra: animals run from gunshots and fire; dogs go to people', () => {
      const chest = (a: Creature) => a.limbs.get('chest')!.part;
      kit.reset();
      const dog = kit.spawn('dog', 0, 0.6) as Creature;
      const cat = kit.spawn('cat', 3, 0.5) as Creature;
      kit.advance(1.5);
      const d0 = chest(dog).x;
      const c0 = chest(cat).x;
      // a shot fired over their heads, off to the left
      (kit.spawn('pistol', -6, 2.5) as Firearm).fire();
      kit.advance(3);
      if (chest(dog).x - d0 < 3 || chest(cat).x - c0 < 3) return `ran ${(chest(dog).x - d0).toFixed(1)} m (dog), ${(chest(cat).x - c0).toFixed(1)} m (cat) from a gunshot`;
      if (dog.state !== 'stand' || cat.state !== 'stand') return `fell running away: ${dog.status()}; ${cat.status()}`;
      // a burning crate next to a dog
      kit.reset();
      const d2 = kit.spawn('dog', 0, 0.6) as Creature;
      kit.advance(1.5);
      const crate = kit.spawn('crate', 1.4, 0.4);
      kit.advance(0.5);
      game.fire.ignite(crate.parts[0], 1);
      kit.advance(3);
      if (chest(d2).x > -1.5) return `dog stayed by the fire (x ${chest(d2).x.toFixed(2)})`;
      // a dog trots over to the nearest person
      kit.reset();
      kit.spawn('human', 8, 0.9);
      const d3 = kit.spawn('dog', 0, 0.6) as Creature;
      let t = 0;
      while (t < 25 && Math.abs(chest(d3).x - 8) > 2.2) {
        kit.advance(0.5);
        t += 0.5;
      }
      if (Math.abs(chest(d3).x - 8) > 2.2) return `dog didn't come to the person (x ${chest(d3).x.toFixed(2)})`;
      // and a fox keeps away from them
      kit.reset();
      kit.spawn('human', 0, 0.9);
      const fox = kit.spawn('fox', 2.2, 0.6) as Creature;
      kit.advance(4);
      if (chest(fox).x < 4.5) return `fox stayed near a person (x ${chest(fox).x.toFixed(2)})`;
      return true;
    }],
    ['extra: conscious people and dogs lying in a pile stop squirming', () => {
      kit.reset();
      const all: Entity[] = [];
      for (let i = 0; i < 5; i++) all.push(kit.spawn('human', (i % 2) * 0.35, 0.25 + i * 0.35, { angle: (Math.PI / 2) * (i % 2 ? 1 : -1) }));
      for (let i = 0; i < 2; i++) all.push(kit.spawn('dog', 0.2 + i * 0.1, 2.4 + i * 0.6, { angle: Math.PI / 2 }));
      const parts = () => game.entities.flatMap((e) => e.parts).filter((p) => !p.destroyed);
      let t = 0;
      while (t < 45 && parts().some((p) => !p.body.isSleeping())) {
        kit.advance(1);
        t++;
      }
      const awake = parts().filter((p) => !p.body.isSleeping()).length;
      if (awake) return `${awake} bodies still moving after 45 s`;
      const out = all.filter((e) => (e as Human).consciousness < 0.3).length;
      if (out) return `${out} knocked out by the fall: the test needs them awake`;
      return true;
    }],
    ['extra: a pile of people lying for a minute: no launches when parts of it wake', () => {
      // people in a settled pile wake up one at a time (to get up, or when shoved);
      // the rest of their sleeping group must wake with them, not gather speed
      for (const run of [0, 1]) {
        kit.reset();
        const hs: Human[] = [];
        for (let i = 0; i < 8; i++) hs.push(kit.spawn('human', -3 + (i % 4) * 0.5 + 0.017 * run, 1 + Math.floor(i / 4) * 2.2, { angle: i * 0.7 }) as Human);
        kit.advance(2);
        let peak = 0;
        game.advance(48, (i) => {
          if (i % 2 === 0) peak = Math.max(peak, kit.maxSpeed());
        });
        if (peak > 20) return `run ${run}: launch at ${peak.toFixed(1)} m/s`;
        const dead = hs.filter((h) => !h.alive).length;
        if (dead) return `run ${run}: ${dead} died lying in the pile`;
      }
      return true;
    }],
    ['extra: a heap of people and props falls asleep, and wakes when disturbed', () => {
      kit.reset();
      for (let i = 0; i < 4; i++) human(-1.5 + i);
      const ids = ['crate', 'brick', 'plank', 'metal-box'];
      for (let i = 0; i < 40; i++) kit.spawn(ids[i % 4], -2 + (i % 8) * 0.55, 3 + Math.floor(i / 8) * 0.7);
      const parts = () => game.entities.flatMap((e) => e.parts).filter((p) => !p.destroyed);
      let t = 0;
      while (t < 60 && parts().some((p) => !p.frozen && !p.body.isSleeping())) {
        kit.advance(1);
        t++;
      }
      const awake = parts().filter((p) => !p.body.isSleeping()).length;
      if (awake) return `${awake} bodies still awake after 60 s`;
      // a crate dropped on it wakes it, without anything flying off
      kit.spawn('crate', 0, 4);
      let peak = 0;
      game.advance(3, (i) => {
        if (i % 6 === 0) peak = Math.max(peak, kit.maxSpeed());
      });
      if (!parts().some((p) => !p.body.isSleeping()) && peak < 0.5) return 'the heap did not react to a crate landing on it';
      if (peak > 12) return `launch when woken: ${peak.toFixed(1)} m/s`;
      return true;
    }],
    ['extra: people, animals and crates dropped in a heap settle and stay asleep', () => {
      // the conscious ones try to get up a few times, then give up until something
      // changes; those that make it up and walk off don't count
      kit.reset();
      for (let i = 0; i < 8; i++) kit.spawn('human', -1.5 + (i % 4) * 0.8, 1 + Math.floor(i / 4) * 2.2, { angle: i * 0.9 });
      for (let i = 0; i < 10; i++) kit.spawn(i % 2 ? 'cat' : 'dog', -2 + (i % 5) * 0.9, 5.5 + Math.floor(i / 5) * 1.2);
      for (let i = 0; i < 6; i++) kit.spawn('crate', -1.8 + i * 0.7, 8.5);
      const lying = () =>
        game.entities
          .filter((e) => (e as Human | Creature).state !== 'stand')
          .flatMap((e) => e.parts)
          .filter((p) => !p.destroyed && !p.frozen);
      kit.advance(4);
      let t = 4;
      let peak = 0;
      let asleepFor = 0;
      let first = 0;
      while (t < 150 && asleepFor < 20) {
        game.advance(1, (i) => {
          if (i % 6 === 0) peak = Math.max(peak, kit.maxSpeed());
        });
        t++;
        if (lying().some((p) => !p.body.isSleeping())) asleepFor = 0;
        else {
          asleepFor++;
          first ||= t;
        }
      }
      if (asleepFor < 20) {
        const awake = lying().filter((p) => !p.body.isSleeping()).length;
        return first ? `asleep at ${first} s, but still waking up again at ${t} s` : `${awake} of ${lying().length} bodies still awake after ${t} s`;
      }
      if (peak > 12) return `launch while settling: ${peak.toFixed(1)} m/s`;
      if (first > 50) return `took ${first} s to fall asleep`;
      return true;
    }],
    ['extra: people walk where they are sent, turn round, stop short of things and run from gunfire', () => {
      const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
      kit.reset();
      const h = human(0);
      kit.advance(1);
      h.goTo(5);
      kit.advance(8);
      if (h.state !== 'stand') return `fell walking (${h.status()})`;
      if (Math.abs(torso(h).x - 5) > 0.5) return `sent to 5 m, got to ${torso(h).x.toFixed(2)}`;
      h.goTo(1);
      kit.advance(8);
      if (h.state !== 'stand') return `fell walking back (${h.status()})`;
      if (h.facing !== -1) return 'did not turn round to walk back';
      if (Math.abs(torso(h).x - 1) > 0.5) return `sent back to 1 m, got to ${torso(h).x.toFixed(2)}`;
      // someone set wandering still is after a save and load
      h.wander = true;
      loadFromString(game, saveToString(game));
      const back = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      if (!back?.wander) return 'wandering was lost on save/load';
      // crates stacked too high to climb in the way: stop short of them
      kit.reset();
      const w = human(0);
      const crate = kit.spawn('crate', 3, 0.45);
      kit.spawn('crate', 3, 1.35);
      kit.advance(1);
      w.goTo(6);
      kit.advance(6);
      if (w.state !== 'stand') return `walked into a stack of crates and fell (${w.status()})`;
      if (torso(w).x > crate.parts[0].x - 0.4) return `walked into the crates (x ${torso(w).x.toFixed(2)})`;
      if (Math.abs(crate.parts[0].x - 3) > 0.1) return 'shoved the crates along';
      // the end of a beam raised higher than they'll climb down from: stop at the edge
      kit.reset();
      const beam = kit.spawn('beam', 0, 2.4);
      beam.setFrozen(true);
      const top = 2.4 + (beam.parts[0].h * PX) / 2;
      const p = kit.spawn('human', -0.5, top + 0.9) as Human;
      kit.advance(1.5);
      p.goTo(4);
      kit.advance(6);
      if (p.state !== 'stand' || torso(p).y < top + 0.5) return `walked off the end of a beam (${p.status()})`;
      // a shot fired over their heads: off and away (someone holding a gun stands their ground)
      kit.reset();
      const r = human(0);
      const armed = human(-3);
      if (!arm(armed)) return 'could not give someone a gun';
      kit.advance(1);
      const r0 = torso(r).x;
      const a0 = torso(armed).x;
      (kit.spawn('pistol', -6, 2.6) as Firearm).fire();
      kit.advance(3);
      if (r.state !== 'stand') return `fell running from a gunshot (${r.status()})`;
      if (torso(r).x - r0 < 2.5) return `ran only ${(torso(r).x - r0).toFixed(1)} m from a gunshot`;
      if (Math.abs(torso(armed).x - a0) > 0.3) return 'someone holding a gun ran off';
      return true;
    }],
    ['extra: people wandering about among animals keep their feet', () => {
      kit.reset();
      const hs: Human[] = [];
      for (let i = 0; i < 6; i++) {
        const h = human(-7 + i * 2.6, { flip: i % 2 === 1 });
        h.wander = true;
        hs.push(h);
      }
      for (let i = 0; i < 4; i++) kit.spawn(['dog', 'cat', 'pig', 'fox'][i], -6 + i * 3.5, 0.5);
      const was = hs.map((h) => h.state);
      const walked = hs.map(() => 0);
      let falls = 0;
      game.advance(40, (i) => {
        if (i % 12) return;
        hs.forEach((h, k) => {
          if (was[k] === 'stand' && h.state !== 'stand') falls++;
          was[k] = h.state;
          if (h.moving) walked[k] += 0.1;
        });
      });
      if (falls) return `${falls} fell over`;
      const about = walked.filter((t) => t > 2).length;
      if (about < 4) return `only ${about} of 6 walked about in 40 s (${walked.map((t) => t.toFixed(0)).join(', ')} s)`;
      return true;
    }],
    ['extra: animals leap up onto boxes and hop down the far side', () => {
      const chest = (a: Creature) => a.limbs.get('chest')!.part;
      const runs: [string, string, number, number][] = [
        ['dog', 'concrete-block', 0.25, 2.5], ['dog', 'concrete-block', 0.25, 1.5],
        ['fox', 'concrete-block', 0.25, 2.5], ['cat', 'crate', 0.44, 2.5], ['cat', 'crate', 0.44, 1.8],
      ];
      for (const [kind, box, y, at] of runs) {
        kit.reset();
        const a = kit.spawn(kind, 0, 0.6) as Creature;
        kit.spawn(box, at, y);
        kit.advance(1.5);
        a.goTo(5);
        let falls = 0;
        let up = false;
        let was = a.state;
        const log: string[] = [];
        let air = false;
        // where it stops (left standing about it wanders off again in a while)
        let stopped = NaN;
        game.advance(8, (i) => {
          const c = chest(a);
          if (Number.isNaN(stopped) && (a as unknown as { goal: string }).goal !== 'walk' && Math.abs(c.vx) < 0.05) stopped = c.x;
          const j = (a as unknown as { jumpT: number }).jumpT > 0;
          if (j !== air || a.state !== was) log.push(`${(i / 120).toFixed(2)}${j !== air ? (j ? ' up' : ' down') : ''}${a.state !== was ? ' ' + a.state : ''} ${c.x.toFixed(2)},${c.y.toFixed(2)} a${c.a.toFixed(2)} v${c.vx.toFixed(1)}`);
          air = j;
          if (was === 'stand' && a.state !== 'stand') falls++;
          was = a.state;
          if (c.y > 0.9) up = true;
        });
        if (!up) return `${kind} never left the floor for a ${box} ${at} m away`;
        if (falls) return `${kind} fell getting over a ${box} ${at} m away: ${log.join('; ')}`;
        if (Number.isNaN(stopped)) return `${kind} sent past a ${box} to 5 m never stopped (at ${chest(a).x.toFixed(2)}): ${log.join('; ')}`;
        if (Math.abs(stopped - 5) > 0.7) return `${kind} sent past a ${box} to 5 m stopped at ${stopped.toFixed(2)}: ${log.join('; ')}`;
      }
      // too high for it: it stops
      kit.reset();
      const d = kit.spawn('dog', 0, 0.6) as Creature;
      kit.spawn('crate', 2.5, 0.44);
      kit.advance(1.5);
      d.goTo(5);
      kit.advance(5);
      if (chest(d).x > 2) return 'dog got past a crate taller than it can jump';
      if (d.state !== 'stand') return `dog fell at a crate it couldn't jump (${d.status()})`;
      return true;
    }],
    ['extra: people climb up onto boxes and down the far side, and stop at people', () => {
      // (each in a lane of its own, all at once; started a little apart, as the
      // walk reaches the box at a different point in the stride)
      const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
      type Run = { what: string; at: number; climbs: boolean };
      const runs: Run[] = [
        { what: 'crate', at: 1.8, climbs: true }, { what: 'crate', at: 2.2, climbs: true }, { what: 'crate', at: 2.6, climbs: true },
        { what: 'metal-box', at: 2.2, climbs: true }, { what: 'brick', at: 2.2, climbs: true },
        { what: 'person', at: 2.5, climbs: false }, { what: 'body', at: 2.5, climbs: false },
      ];
      for (const shift of [0, 0.21]) {
        kit.reset();
        const lanes = runs.map((_, i) => -60 + i * 16 + shift);
        const things = runs.map((r, i) => {
          const x = lanes[i] + r.at;
          if (r.what === 'person') return kit.spawn('human', x, 0.9);
          if (r.what === 'body') {
            const b = kit.spawn('human', x, 0.3, { angle: Math.PI / 2 }) as Human;
            b.limp = true;
            return b;
          }
          return kit.spawn(r.what, x, r.what === 'brick' ? 0.1 : r.what === 'crate' ? 0.45 : 0.5);
        });
        const people = lanes.map((x) => human(x));
        kit.advance(1.5);
        const x0 = things.map((t) => t.parts[0].x);
        const hp0 = people.map((h) => h.parts.reduce((a, p) => a + p.hp, 0));
        people.forEach((h, i) => h.goTo(lanes[i] + 5));
        const seen = people.map(() => new Set<string>());
        const falls = people.map(() => 0);
        const was = people.map((h) => h.state);
        game.advance(10, () => people.forEach((h, i) => {
          if (h.climbKind) seen[i].add(h.climbKind);
          if (was[i] === 'stand' && h.state !== 'stand') falls[i]++;
          was[i] = h.state;
        }));
        for (let i = 0; i < runs.length; i++) {
          const { what, at, climbs } = runs[i];
          const h = people[i];
          const x = torso(h).x - lanes[i];
          const where = `a ${what} ${at} m off (start +${shift})`;
          if (falls[i] || h.state !== 'stand') return `fell at ${where}: ${h.status()}, ${[...seen[i]].join('/')}`;
          const hurt = hp0[i] - h.parts.reduce((a, p) => a + p.hp, 0);
          if (hurt > 1) return `hurt themselves (${hurt.toFixed(0)} hp) climbing ${where}`;
          if (climbs) {
            if (!seen[i].has('up') && !seen[i].has('over')) return `never climbed ${where}`;
            if (Math.abs(x - 5) > 0.5) return `sent past ${where} to 5 m, got to ${x.toFixed(2)} (${[...seen[i]].join('/')})`;
            if (what !== 'brick' && !seen[i].has('down')) return `got off ${where} without climbing down`;
            if (Math.abs(things[i].parts[0].x - x0[i]) > 0.3) return `shoved ${where} ${(things[i].parts[0].x - x0[i]).toFixed(2)} m`;
          } else {
            if (seen[i].size) return `climbed ${where}`;
            // (someone standing there sways and steps about: as close as they are now;
            // torsos 0.25 m wide touch 0.25 m apart. They usually stop 0.4 m short)
            const moved = things[i].parts[0].x - x0[i];
            const ahead = what === 'person' ? at + moved : at;
            if (x > ahead - 0.26) return `walked into ${where} (x ${x.toFixed(2)}, they moved ${moved.toFixed(2)})`;
            if (Math.abs(things[i].parts[0].x - x0[i]) > 0.15) return `shoved ${where} along`;
          }
        }
      }
      return true;
    }],
    ['extra: animals get over someone lying on the floor', () => {
      const chest = (a: Creature) => a.limbs.get('chest')!.part;
      const kinds = ['dog', 'cat', 'fox'];
      for (const at of [1.6, 2.2, 2.8]) {
        kit.reset();
        const lanes = kinds.map((_, i) => -50 + i * 30);
        const bodies = lanes.map((x) => {
          const b = kit.spawn('human', x + at, 0.3, { angle: Math.PI / 2 }) as Human;
          b.limp = true;
          return b;
        });
        kit.advance(2);
        const animals = kinds.map((k, i) => kit.spawn(k, lanes[i] - 0.5, 0.5) as Creature);
        kit.advance(1);
        const b0 = bodies.map((b) => b.limbs.get('midTorso')!.part.x);
        animals.forEach((a, i) => a.goTo(lanes[i] + 5.5));
        const falls = animals.map(() => 0);
        const was = animals.map((a) => a.state);
        // where each stops (left standing about it wanders off again in a while)
        const stopped = animals.map(() => NaN);
        game.advance(9, () => animals.forEach((a, i) => {
          if (was[i] === 'stand' && a.state !== 'stand') falls[i]++;
          was[i] = a.state;
          const c = chest(a);
          if (Number.isNaN(stopped[i]) && (a as unknown as { goal: string }).goal !== 'walk' && Math.abs(c.vx) < 0.05) stopped[i] = c.x;
        }));
        for (let i = 0; i < kinds.length; i++) {
          const a = animals[i];
          const x = (Number.isNaN(stopped[i]) ? chest(a).x : stopped[i]) - lanes[i];
          if (falls[i]) return `${kinds[i]} fell getting over a body ${at} m off (${a.status()})`;
          if (x < 4.5) return `${kinds[i]} sent past a body ${at} m off got to ${x.toFixed(2)}`;
          const moved = bodies[i].limbs.get('midTorso')!.part.x - b0[i];
          if (Math.abs(moved) > 0.4) return `${kinds[i]} shoved a body ${moved.toFixed(2)} m getting over it`;
        }
      }
      return true;
    }],
    ['extra: people and animals jump when told, and land on their feet', () => {
      type Case = { kind: string; walk: boolean };
      const cases: Case[] = [
        { kind: 'human', walk: false }, { kind: 'human', walk: true }, { kind: 'dog', walk: false }, { kind: 'dog', walk: true },
        { kind: 'cat', walk: false }, { kind: 'fox', walk: false },
      ];
      kit.reset();
      const lanes = cases.map((_, i) => -60 + i * 20);
      const ents = cases.map((c, i) => kit.spawn(c.kind, lanes[i], c.kind === 'human' ? 0.9 : 0.6) as Human | Creature);
      kit.advance(1.5);
      ents.forEach((e, i) => cases[i].walk && e.goTo(lanes[i] + 8));
      kit.advance(1);
      const trunk = (e: Human | Creature) => (e.def.id === 'human' ? (e as Human).limbs.get('midTorso') : (e as Creature).limbs.get('chest'))!.part;
      const y0 = ents.map((e) => trunk(e).y);
      for (let i = 0; i < ents.length; i++) if (!ents[i].jump()) return `${cases[i].kind} would not jump (${ents[i].status()})`;
      const rise = ents.map(() => 0);
      const falls = ents.map(() => 0);
      game.advance(3, () => ents.forEach((e, i) => {
        rise[i] = Math.max(rise[i], trunk(e).y - y0[i]);
        if (e.state !== 'stand') falls[i]++;
      }));
      for (let i = 0; i < ents.length; i++) {
        const what = `${cases[i].kind}${cases[i].walk ? ' walking' : ''}`;
        if (rise[i] < 0.25) return `${what} jumped only ${rise[i].toFixed(2)} m`;
        if (rise[i] > 0.9) return `${what} jumped ${rise[i].toFixed(2)} m`;
        if (falls[i]) return `${what} fell jumping (${ents[i].status()})`;
      }
      // nobody jumps lying down
      const lying = ents[0] as Human;
      lying.limp = true;
      kit.advance(1);
      if (lying.jump()) return 'someone lying limp jumped';
      return true;
    }],
    ['extra: someone standing on or beside a lying body leaves it where it is', () => {
      // (put right on the edge of it, someone may topple off: that's fair, but
      // whoever keeps their feet mustn't shove the body along)
      let stood = 0;
      for (const dx of [-0.15, 0.02, 0.07, 0.12]) {
        kit.reset();
        const lying = kit.spawn('human', 0, 0.5, { angle: Math.PI / 2 }) as Human;
        lying.limp = true;
        kit.advance(2);
        const t = lying.limbs.get('midTorso')!.part;
        const x0 = t.x;
        const end = Math.max(...lying.parts.filter((p) => !p.destroyed).map((p) => p.x));
        const st = kit.spawn('human', end + dx, 1.2) as Human;
        // (someone who topples off it crawls away, and may shove it a little doing so)
        let fell = false;
        game.advance(15, () => {
          if (st.state !== 'stand') fell = true;
        });
        if (fell || st.state !== 'stand') continue;
        stood++;
        if (Math.abs(t.x - x0) > 0.05) return `body pushed ${(t.x - x0).toFixed(3)} m along the floor (person at +${dx} m)`;
      }
      if (stood < 2) return `only ${stood} of 4 people put by the body kept their feet`;
      return true;
    }],
    ['extra: someone dropped across a lying body crawls off it and gets up', () => {
      let stood = 0;
      const tries: [number, number][] = [[-0.4, Math.PI / 2], [0, -Math.PI / 2], [0.3, Math.PI / 2], [0.5, -Math.PI / 2]];
      for (const [dx, angle] of tries) {
        kit.reset();
        const lying = kit.spawn('human', 0, 0.5, { angle: Math.PI / 2 }) as Human;
        lying.limp = true;
        kit.advance(2);
        const xs = lying.parts.map((p) => p.x);
        const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
        const h = kit.spawn('human', dx, 0.85, { angle }) as Human;
        kit.advance(25);
        if (h.state === 'stand') stood++;
        // nothing of the trunk still up on the body
        const trunk = (['upperTorso', 'midTorso', 'lowerTorso'] as const).map((k) => h.limbs.get(k)!.part);
        const on = trunk.some((p) => p.x > lo && p.x < hi && p.y > 0.28 && p.y < 0.6);
        if (on) return `still lying on the body 25 s after being dropped on it at ${dx} m (${h.status()})`;
      }
      if (stood < 2) return `only ${stood} of 4 dropped on a body got up again`;
      return true;
    }],
  ];

  /** Runs every test, or only those whose name contains `filter`. */
  return async (filter?: string): Promise<Result[]> => {
    const results: Result[] = [];
    // Repeatable runs: the real-time loop would step the world between tests by
    // however long they took, and sounds pick variants with Math.random as wall-
    // clock throttling allows. Hold the loop still and the sound off meanwhile.
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    const muted = game.sound.muted;
    game.sound.setMuted(true);
    await new Promise((res) => setTimeout(res, 50));
    for (const [name, fn] of tests) {
      if (filter && !name.includes(filter)) continue;
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
    game.sound.setMuted(muted);
    window.requestAnimationFrame = raf;
    (game as unknown as { lastTime: number }).lastTime = performance.now();
    window.requestAnimationFrame((game as unknown as { loop: FrameRequestCallback }).loop);
    kit.reset();
    console.table(results);
    return results;
  };
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Flask } from '../../entities/Flask';
import type { Motor, Thruster } from '../../entities/Machines';
import type { JetEngine } from '../../entities/JetEngine';
import type { Car } from '../../entities/Car';
import type { Prop } from '../../entities/Prop';
import { PX } from '../../engine/constants';
import { getItem } from '../../catalog/items';
import type { Balloon } from '../../entities/Balloon';
import type { Firearm } from '../../entities/Firearm';
import type { Fan } from '../../entities/Air';
import { capture, instantiate, type Snapshot } from '../../world/Snapshot';
import type { Contraptions } from '../../world/Contraptions';
import { Liquid } from '../../systems/Liquids';

/** A player's rocket, as saved as a contraption (see the test). */
const ROCKET = {'entities':[{'def':'short-beam','flip':true,'parts':[{'x':0.396,'y':0.5341,'a':0.0001,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}]},{'def':'short-beam','flip':true,'parts':[{'x':0.0068,'y':1.4182,'a':1.2215,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'config':{'w':52,'h':6}},{'def':'short-beam','flip':false,'parts':[{'x':0.7851,'y':1.4182,'a':-1.2215,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'config':{'w':52,'h':6}},{'def':'concrete-block','flip':true,'parts':[{'x':0.4101,'y':2.4585,'a':0,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}]},{'def':'thruster','flip':true,'parts':[{'x':0.0351,'y':0.2201,'a':-1.558,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'extra':{'on':false,'off':false,'thrust':2}},{'def':'thruster','flip':true,'parts':[{'x':0.6575,'y':0.2239,'a':-1.558,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'extra':{'on':false,'off':false,'thrust':2}},{'def':'switch','flip':true,'parts':[{'x':0.3402,'y':0.7571,'a':0,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'extra':{'on':true}},{'def':'short-beam','flip':true,'parts':[{'x':2.5054,'y':0.534,'a':0,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'config':{'w':87,'h':6}},{'def':'short-beam','flip':true,'parts':[{'x':-1.8072,'y':0.5378,'a':0,'vx':0,'vy':0,'av':0,'frozen':false,'hp':null}],'config':{'w':93,'h':6}}],'connections':[{'kind':'weld','a':[3,0],'la':{'x':0.1719,'y':-0.1719},'b':[2,0],'lb':{'x':-0.8854,'y':0.1063},'rest':0.232},{'kind':'weld','a':[3,0],'la':{'x':-0.1719,'y':-0.1719},'b':[1,0],'lb':{'x':0.8951,'y':0.0797},'rest':0.2428},{'kind':'weld','a':[1,0],'la':{'x':-0.6406,'y':0.0469},'b':[0,0],'lb':{'x':-0.6524,'y':0.2983},'rest':0.3288},{'kind':'weld','a':[2,0],'la':{'x':0.6719,'y':0.0156},'b':[0,0],'lb':{'x':0.6338,'y':0.258},'rest':0.2981},{'kind':'weld','a':[0,0],'la':{'x':-0.3594,'y':0.0156},'b':[4,0],'lb':{'x':-0.3295,'y':0.0057},'rest':0.2212},{'kind':'weld','a':[0,0],'la':{'x':0.2656,'y':0.0156},'b':[5,0],'lb':{'x':-0.3258,'y':0.0082},'rest':0.2166},{'kind':'weld','a':[4,0],'la':{'x':0.0031,'y':0.0},'b':[5,0],'lb':{'x':-0.0011,'y':-0.6224},'rest':0.6224},{'kind':'weld','a':[6,0],'la':{'x':0,'y':-0.0829},'b':[0,0],'lb':{'x':-0.0557,'y':0.1401},'rest':0.1573},{'kind':'wire','a':[6,0],'la':{'x':0.1406,'y':-0.0469},'b':[5,0],'lb':{'x':0.0469,'y':0.0156},'rest':0.5668},{'kind':'wire','a':[6,0],'la':{'x':-0.1094,'y':-0.0781},'b':[4,0],'lb':{'x':0.0781,'y':-0.0156},'rest':0.5769},{'kind':'weld','a':[7,0],'la':{'x':-1.125,'y':-0.0156},'b':[0,0],'lb':{'x':0.9844,'y':-0.0159},'rest':0.3452},{'kind':'weld','a':[8,0],'la':{'x':1.3125,'y':-0.0156},'b':[0,0],'lb':{'x':-0.8906,'y':-0.0119},'rest':0.2188}]} as unknown as Snapshot;

/** A player's car (four motor wheels at 400% welded under a beam, two posts, a box, a switch), as saved: driving along at 17 m/s. */
const CAR = {'entities':[{'def':'motor-wheel','flip':true,'parts':[{'x':-1.2059,'y':0.308,'a':0.0,'vx':16.97,'vy':-0.04,'av':0.0,'frozen':false,'hp':100},{'x':-1.2059,'y':0.308,'a':2.5741,'vx':16.97,'vy':-0.04,'av':-55.5,'frozen':false,'hp':100}],'extra':{'on':false,'off':false,'dir':-1,'speed':4,'torque':4}},{'def':'motor-wheel','flip':true,'parts':[{'x':-0.3743,'y':0.3081,'a':0.0,'vx':16.97,'vy':-0.04,'av':0.0,'frozen':false,'hp':100},{'x':-0.3743,'y':0.3081,'a':2.8825,'vx':16.97,'vy':-0.03,'av':-55.46,'frozen':false,'hp':100}],'extra':{'on':false,'off':false,'dir':-1,'speed':4,'torque':4}},{'def':'motor-wheel','flip':true,'parts':[{'x':0.5129,'y':0.3081,'a':0.0,'vx':16.97,'vy':-0.03,'av':0.0,'frozen':false,'hp':100},{'x':0.5129,'y':0.3081,'a':-0.1267,'vx':16.97,'vy':-0.03,'av':-55.49,'frozen':false,'hp':100}],'extra':{'on':false,'off':false,'dir':-1,'speed':4,'torque':4}},{'def':'motor-wheel','flip':true,'parts':[{'x':1.2653,'y':0.3081,'a':0.0,'vx':16.97,'vy':-0.03,'av':0.0,'frozen':false,'hp':100},{'x':1.2653,'y':0.3081,'a':-1.3282,'vx':16.97,'vy':-0.03,'av':-53.5,'frozen':false,'hp':100}],'extra':{'on':false,'off':false,'dir':-1,'speed':0.5,'torque':4}},{'def':'beam','flip':true,'parts':[{'x':-0.016,'y':0.7143,'a':0.0,'vx':16.97,'vy':-0.03,'av':0.0,'frozen':false,'hp':null,'paint':'lQAAWBYX/5cAAGIMDP+YAAB5EhL/9gAAckRG//gAAH4aGv/5AACDKiv/+gAAYhMT//sAAH4XF//9AABiICH/WAEAWgoL/1oBAHATE/9bAQBYCAj/XAEAfBIS/7sBAHUVFv+9AQB7ExP/vgEAYwsL/78BAHcREv8dAgBwMzf/HwIAdhsc/yACAHAzN/8='}]},{'def':'short-beam','flip':true,'parts':[{'x':-0.5931,'y':1.5597,'a':1.545,'vx':16.97,'vy':-0.04,'av':0.0,'frozen':false,'hp':null}]},{'def':'short-beam','flip':true,'parts':[{'x':0.0966,'y':1.5597,'a':1.545,'vx':16.97,'vy':-0.03,'av':0.0,'frozen':false,'hp':null,'paint':'XAAAeR8g/10AAFoKC/9eAAB7EhL/XwAAbAwM/2AAAF0KCv9hAAB9ExP/YgAAfBMT/48AAIlAQv+RAACMT1L/kgAAjE9S/5QAAGAhI//FAABgISP/xgAAcxgZ/w=='}]},{'def':'metal-box','flip':true,'parts':[{'x':1.1403,'y':1.216,'a':0.0,'vx':16.97,'vy':-0.03,'av':0.0,'frozen':false,'hp':null}]},{'def':'switch','flip':true,'parts':[{'x':-0.9871,'y':1.0597,'a':0.0,'vx':16.97,'vy':-0.04,'av':0.0,'frozen':false,'hp':null}],'extra':{'on':true}}],'connections':[{'kind':'weld','a':[4,0],'la':{'x':1.2656,'y':0.0156},'b':[3,0],'lb':{'x':-0.0156,'y':0.4219},'rest':0.4222,'end':{'x':0,'y':0}},{'kind':'weld','a':[4,0],'la':{'x':0.4844,'y':0.0469},'b':[2,0],'lb':{'x':-0.0445,'y':0.4531},'rest':0.4553,'end':{'x':0,'y':0}},{'kind':'weld','a':[4,0],'la':{'x':-0.3594,'y':0.0781},'b':[1,0],'lb':{'x':-0.0011,'y':0.4844},'rest':0.4844,'end':{'x':0,'y':0}},{'kind':'weld','a':[4,0],'la':{'x':-1.2031,'y':0.0156},'b':[0,0],'lb':{'x':-0.0132,'y':0.4219},'rest':0.4221,'end':{'x':0,'y':0}},{'kind':'weld','a':[5,0],'la':{'x':-0.6406,'y':-0.0156},'b':[4,0],'lb':{'x':-0.5779,'y':0.2046},'rest':0.189,'end':{'x':-0.5781,'y':0.0156}},{'kind':'weld','a':[6,0],'la':{'x':-0.6406,'y':-0.0469},'b':[4,0],'lb':{'x':0.1429,'y':0.2038},'rest':0.222,'end':{'x':0.1094,'y':-0.0156}},{'kind':'weld','a':[7,0],'la':{'x':-0.2031,'y':-0.2656},'b':[4,0],'lb':{'x':0.9531,'y':0.2361},'rest':0.2226,'end':{'x':0.9844,'y':0.0156}},{'kind':'weld','a':[8,0],'la':{'x':0.0,'y':-0.0829},'b':[4,0],'lb':{'x':-0.9711,'y':0.2626},'rest':0.2476,'end':{'x':-0.9531,'y':0.0156}},{'kind':'wire','a':[8,0],'la':{'x':-0.1406,'y':-0.0469},'b':[0,0],'lb':{'x':0,'y':0},'rest':0.7091},{'kind':'wire','a':[8,0],'la':{'x':0.1406,'y':-0.0781},'b':[1,0],'lb':{'x':0,'y':0},'rest':0.8226},{'kind':'wire','a':[8,0],'la':{'x':0.1406,'y':-0.0781},'b':[2,0],'lb':{'x':0,'y':0},'rest':1.5171},{'kind':'wire','a':[8,0],'la':{'x':0.1406,'y':-0.0781},'b':[3,0],'lb':{'x':0,'y':0},'rest':2.2166}]} as unknown as Snapshot;

/** Regression tests for bugs found in the simulation (one per fix). */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  /** Strands of flesh a body's torn-out limbs hang on by. */
  const strands = (h: Human) => (h as unknown as { tendons: { count: number } | null }).tendons?.count ?? 0;
  /** Who they're fighting (read through this, the checks don't narrow it for the rest of the test). */
  const foeOf = (h: Human): Entity | null => h.foe;
  const C = game.connections;
  /** Half the height of a thing as it's spawned (m). */
  const half = (id: string) => getItem(id)?.halfHeight ?? 0.5;

  return [
    ['extra: bugs: a player’s rocket (beams welded round a light one, two thrusters) climbs on its thrusters without shaking itself apart and spinning off', () => {
      kit.reset();
      // the player's "Not Working Rocket": a short beam with a long one welded to either end, an
      // A-frame and a concrete block on top, two thrusters under it, switched on by the switch
      const made = instantiate(game, ROCKET, { dy: 0.02 });
      const parts = made.map((e) => e.parts[0]);
      const block = parts[3];
      const y0 = block.y;
      const welds = C.list.filter((c) => c.kind === 'weld').length;
      if (!made.filter((e) => e.def.id === 'thruster').every((t) => (t as Thruster).running)) return 'the thrusters are not running';
      // (it shook itself apart within 2 s, and spun off at 100 rad/s)
      let most = 0;
      for (let i = 0; i < 16; i++) {
        kit.advance(0.25);
        for (const p of parts) most = Math.max(most, Math.abs(p.av));
      }
      if (most > 1.5) return `it spun up to ${most.toFixed(1)} rad/s`;
      if (C.list.filter((c) => c.kind === 'weld').length !== welds) return 'a weld broke';
      if (block.y - y0 < 3) return `it rose only ${(block.y - y0).toFixed(1)} m in 4 s`;
      return true;
    }],
    ['extra: bugs: a big balloon tied to someone who has stood still long enough to settle lifts them, its rope not snapping on them', () => {
      kit.reset();
      const h = human(0);
      kit.advance(5);
      if (!h.parts.every((p) => p.destroyed || p.body.isSleeping())) return 'they never settled, as the test needs';
      const big = kit.spawn('big-balloon', 0.05, 3.2) as Balloon;
      big.setFrozen(true);
      big.tieBelow();
      const rope = C.list.find((c) => c.kind === 'rope' && (c.a.entity === big || c.b?.entity === big));
      if (!rope || (rope.a.entity !== h && rope.b?.entity !== h)) return 'it was not tied to them';
      big.setFrozen(false);
      // (put straight back to sleep each step, they hung where they stood and the rope snapped in 0.15 s)
      kit.advance(3);
      if (!C.list.includes(rope)) return 'the rope snapped';
      const feet = Math.min(h.limbs.get('footF')!.part.y, h.limbs.get('footB')!.part.y);
      if (feet < 1) return `in 3 s it lifted their feet to ${feet.toFixed(2)} m`;
      return true;
    }],
    ['extra: bugs: an RPG or a grenade launcher spun round and swung fires along its barrel, not off to the side', () => {
      for (const id of ['rpg', 'grenade-launcher']) {
        kit.reset();
        const g = kit.spawn(id, 0, 20, { angle: 0.5 }) as Firearm;
        kit.advance(0.02);
        // (it fired 20-36 degrees off with what it was doing sideways: the round turns to fly the way it goes)
        g.main.body.setLinvel({ x: 2, y: 8 }, true);
        g.main.body.setAngvel(11, true);
        const fwd = g.forward();
        const before = new Set(game.entities);
        g.activate();
        const round = game.entities.find((e) => !before.has(e) && e.parts[0].body.linvel().x ** 2 + e.parts[0].body.linvel().y ** 2 > 25);
        if (!round) return `${id}: it fired nothing`;
        const v = round.parts[0].body.linvel();
        const off = (Math.abs(Math.atan2(fwd.x * v.y - fwd.y * v.x, fwd.x * v.x + fwd.y * v.y)) * 180) / Math.PI;
        const allow = (g.gun.spread * 90) / Math.PI + 1;
        if (off > allow) return `${id}: fired ${off.toFixed(1)} degrees off its barrel`;
      }
      return true;
    }],
    ['extra: bugs: a fan on the back of a cart, blowing backward, drives it forward (not back); one on the floor stays put', () => {
      kit.reset();
      // a beam on two free wheels, the fan welded on at its left end blowing left
      const cart = kit.spawn('beam', 0, 0.8).parts[0];
      for (const x of [-1.2, 1.2]) {
        const tire = kit.spawn('tire', x, 0.34).parts[0];
        C.create('pin', cart, { x, y: 0.34 }, tire, { x, y: 0.34 });
      }
      const fan = kit.spawn('fan', -1, 1.25, { flip: true }) as Fan;
      kit.advance(0.5);
      C.create('weld', fan.main, { x: -1, y: 0.9 }, cart, { x: -1, y: 0.9 });
      const bat = kit.spawn('battery', -6, 0.4);
      kit.advance(1);
      const x0 = cart.x;
      C.create('wire', bat.parts[0], { x: bat.parts[0].x, y: bat.parts[0].y }, fan.main, { x: fan.main.x, y: fan.main.y });
      // (its draw behind it pulled the cart it was fixed to backward, the way the wind blows)
      kit.advance(4);
      if (!fan.running) return 'the fan is not running';
      const moved = cart.x - x0;
      if (moved < 0.5) return `in 4 s the cart went ${moved.toFixed(2)} m forward`;
      // a fan standing on the floor at its top speed stays where it is, upright
      kit.reset();
      const floor = kit.spawn('fan', 0, 0.32) as Fan;
      floor.speed = 2;
      // (out of reach of its draw behind it)
      const bat2 = kit.spawn('battery', -6, 0.4);
      kit.advance(0.8);
      const f0 = floor.main.x;
      C.create('wire', bat2.parts[0], { x: bat2.parts[0].x, y: bat2.parts[0].y }, floor.main, { x: floor.main.x, y: floor.main.y });
      kit.advance(3);
      if (Math.abs(floor.main.x - f0) > 0.1) return `on the floor at full speed, the fan slid ${(floor.main.x - f0).toFixed(2)} m`;
      if (Math.abs(floor.main.a) > 0.2) return 'on the floor at full speed, the fan tipped over';
      return true;
    }],
    ['extra: bugs: a heavy weight breaks a glass tank, with water in it or not (a crate dropped on it doesn’t); a great slab dropped on someone presses them flat', () => {
      for (const water of [false, true]) {
        kit.reset();
        const tank = kit.spawn('glass-tank', 0, 0.8) as Prop;
        kit.advance(1);
        const top = tank.main.y + (tank.main.h * PX) / 2;
        if (water) {
          kit.spawn('water', 0, top - 0.7, { config: { w: tank.main.w - 4, h: Math.round(tank.main.h * 0.6) } });
          kit.advance(2);
        }
        // (a 1 t weight came down on it as a 100 kg one would, and sat in it, and it stood)
        kit.spawn('weight', 0, top + half('weight') + 2);
        kit.advance(3);
        if (!tank.destroyed) return `${water ? 'with water in it, ' : ''}a 1 t weight dropped 2 m onto a glass tank left it standing`;
      }
      kit.reset();
      const tank = kit.spawn('glass-tank', 0, 0.8) as Prop;
      kit.advance(1);
      kit.spawn('crate', 0, tank.main.y + (tank.main.h * PX) / 2 + half('crate') + 2);
      kit.advance(2);
      if (tank.destroyed) return 'a crate dropped 2 m into a glass tank broke it';
      // a slab of 12 t from 3 m: nothing much is left of them (it left them standing 15-30 cm thick)
      kit.reset();
      const h = human(0);
      kit.advance(1);
      kit.spawn('brick', 0, 2 + 2 + 3, { config: { w: 512, h: 128 } });
      kit.advance(3);
      const gone = [...h.limbs.values()].filter((l) => l.gone).length;
      if (gone < 10) return `under the slab, ${gone} of their ${h.limbs.size} limbs were pressed flat`;
      // a heap of people isn't heavy enough to crush the ones at the bottom
      kit.reset();
      const heap = [0, 1, 2, 3, 4, 5].map((i) => kit.spawn('human', (i % 2) * 0.3, 1 + Math.floor(i / 2) * 1.6) as Human);
      kit.advance(4);
      const lost = heap.reduce((n, p) => n + [...p.limbs.values()].filter((l) => l.gone).length, 0);
      if (lost) return `a heap of six people pressed ${lost} limbs flat`;
      return true;
    }],
    ['extra: bugs: a car under a slab of tonnes is crushed, a fuel drum under a 1 t weight goes off, and a jet engine run into a wall goes up', () => {
      kit.reset();
      const car = kit.spawn('car', 0, 1) as Car;
      kit.advance(1.5);
      kit.spawn('brick', 0, car.body.y + 0.8 + 1.5 + 2, { config: { w: 512, h: 96 } });
      kit.advance(3);
      if (!car.wrecked) return `a 9 t slab dropped 2 m on a car left it with ${car.body.hp.toFixed(0)} hp`;
      kit.reset();
      const drum = kit.spawn('explosive-barrel', 0, 0.5) as Prop;
      kit.advance(1);
      kit.spawn('weight', 0, drum.main.y + 0.42 + half('weight') + 2);
      kit.advance(3);
      if (!drum.destroyed) return 'a 1 t weight dropped on a fuel drum didn’t set it off';
      // (it hit the wall at 50 m/s and stopped there unhurt: it had no hit points)
      kit.reset();
      let jet = kit.spawn('jet-engine', 30, 0.6) as JetEngine;
      if (jet.forward().x < 0) jet = game.flipEntity(jet) as JetEngine;
      jet.activate();
      let blasts = 0;
      const ex = game.explosions;
      const explode = ex.explode;
      ex.explode = (x, y, o, d) => {
        blasts++;
        return explode.call(ex, x, y, o, d);
      };
      try {
        kit.advance(6);
      } finally {
        delete (ex as { explode?: unknown }).explode;
      }
      if (!jet.destroyed) return `run into the wall, the jet engine stood with ${jet.main.hp.toFixed(0)} hp`;
      if (!blasts) return 'wrecked while it ran, the jet engine didn’t go up';
      // one switched off, dropped 2 m, is only dented
      kit.reset();
      const off = kit.spawn('jet-engine', 0, 2.6) as JetEngine;
      kit.advance(2);
      if (off.destroyed) return 'a jet engine dropped 2 m broke';
      return true;
    }],
    ['extra: bugs: a player’s car saved on the move spawns still; someone standing between its posts, in front of them or lying on it rides off unhurt as it pulls away at full power', () => {
      const store = (controls.ui as unknown as { contraptions: Contraptions }).contraptions;
      const saved = store.add('test: car saved on the move', CAR, '');
      if (!saved) return 'it couldn’t be saved';
      const snap = store.defOf(saved).snapshot!;
      store.remove(saved.id);
      if (snap.entities.some((e) => e.parts.some((p) => p.vx || p.vy || p.av))) return 'saved at 17 m/s, it spawns moving';
      // (they used to step as if on the ground, left behind as it went, and walk back into its posts; a knock
      // nudging a hand or a foot counted as if the whole body were behind it: a hand came off at 3 m/s)
      for (const [where, x, y] of [['standing between its posts', -0.25, 2.2], ['standing in front of its posts', 0.62, 2.2], ['lying on it', 0.3, 1.4]] as const) {
        kit.reset();
        const made = instantiate(game, snap);
        const sw = made.find((e) => e.def.id === 'switch') as Entity & { on: boolean };
        if (sw.on) sw.activate();
        kit.advance(0.5);
        const h = kit.spawn('human', x, y, where === 'lying on it' ? { angle: Math.PI / 2 } : undefined) as Human;
        kit.advance(2);
        sw.activate();
        kit.advance(3);
        const chassis = made.find((e) => e.def.id === 'beam')!.parts[0];
        if (chassis.vx < 5) return `${where}: it got to only ${chassis.vx.toFixed(1)} m/s`;
        if (!h.alive || h.consciousness < 0.9) return `${where}: they were ${h.alive ? 'knocked out' : 'killed'}`;
        const hurt = [...h.limbs.values()].filter((l) => l.gone || l.broken || l.part.hp < l.spec.hp * 0.5).map((l) => l.spec.key);
        if (hurt.length) return `${where}: they were hurt: ${hurt.join(', ')}`;
      }
      return true;
    }],
    ['extra: bugs: a car built of a beam and two motor wheels pinned on by their hubs drives; someone welded into a chair on it rides at top speed unhurt', () => {
      kit.reset();
      const chassis = kit.spawn('beam', 0, 0.6).parts[0];
      const wheels: Motor[] = [];
      for (const x of [-1.2, 1.2]) {
        const w = kit.spawn('motor-wheel', x, 0.3125) as Motor;
        // (pinned, its hub turned on the pin and the wheel hardly moved the car)
        C.create('pin', chassis, { x, y: 0.3125 }, w.housing, { x, y: 0.3125 });
        wheels.push(w);
      }
      const chair = kit.spawn('chair', 0, 0.694 + 0.45).parts[0];
      kit.advance(0.8);
      C.create('weld', chassis, { x: 0, y: 0.694 }, chair, { x: 0, y: 0.694 });
      const h = kit.spawn('human', 0, 2.25) as Human;
      kit.advance(1.5);
      const hips = h.limbs.get('lowerTorso')!.part;
      C.create('weld', hips, { x: hips.x, y: hips.y }, chair, { x: hips.x, y: hips.y });
      kit.advance(0.3);
      // (only what the ride does to them counts: not a knock getting into the chair)
      const hp0 = new Map([...h.limbs.values()].map((l) => [l, l.part.hp]));
      for (const w of wheels) {
        w.speed = 4;
        w.torque = 4;
        w.activate();
      }
      // (riding along, their legs swung into the chair counted at the car's speed, not how fast they met it)
      kit.advance(4);
      if (Math.abs(chassis.vx) < 8) return `at top speed it went only ${Math.abs(chassis.vx).toFixed(1)} m/s`;
      if (!h.alive || h.consciousness < 0.9) return `the rider was ${h.alive ? 'knocked out' : 'killed'}`;
      const hurt = [...h.limbs.values()].filter((l) => l.gone || l.part.hp < hp0.get(l)! - l.spec.hp * 0.2).map((l) => l.spec.key);
      if (hurt.length) return `the ride hurt the rider: ${hurt.join(', ')}`;
      return true;
    }],
    ['extra: bugs: a copy of someone whose arm was cut off with a torn-out forearm hanging from it has one strand, not two', () => {
      kit.reset();
      const h = human(0);
      kit.advance(0.5);
      // the forearm wrenched out (hanging from the upper arm), then the upper arm cut off clean
      h.rupture(h.limbs.get('lowerArmF')!);
      h.sever(h.limbs.get('upperArmF')!, 'cut');
      if (strands(h) !== 1) return `before copying: ${strands(h)} strands (wanted 1)`;
      const h2 = instantiate(game, capture(game, [h]), { dx: 3 })[0] as Human | undefined;
      if (!h2) return 'could not copy them';
      const upper = h2.limbs.get('upperArmF')!;
      const fore = h2.limbs.get('lowerArmF')!;
      if (!upper.severed || !fore.severed) return `copied: upper arm severed ${upper.severed}, forearm ${fore.severed}`;
      // (the cut-off upper arm came back tied to the shoulder by flesh too)
      if (strands(h2) !== 1) return `copied: ${strands(h2)} strands (wanted 1: the forearm's)`;
      return true;
    }],
    ['extra: bugs: two people fighting, flipped together, fight on', () => {
      kit.reset();
      const a = human(-1);
      const b = human(1, { flip: true });
      kit.advance(0.5);
      if (!a.fight(b)) return 'could not set them fighting';
      kit.advance(0.2);
      if (foeOf(a) !== b || foeOf(b) !== a) return 'they were not fighting each other';
      const [a2, b2] = game.flipEntities([a, b]) as Human[];
      if (!a2 || !b2) return 'could not flip them';
      if (foeOf(a2) !== b2 || foeOf(b2) !== a2) {
        return `flipped: A is fighting ${foeOf(a2) === b2 ? 'B' : foeOf(a2) ? 'something else' : 'nobody'}, B ${foeOf(b2) === a2 ? 'A' : foeOf(b2) ? 'something else' : 'nobody'}`;
      }
      return true;
    }],
    ['extra: bugs: ground laid over a burning oil puddle takes it under: none left there, burning or seeping out', () => {
      kit.reset();
      const pu = game.puddles;
      pu.add(Liquid.Oil, 0, 30);
      kit.advance(1);
      if (pu.total < 10) return `the oil puddle is only ${pu.total.toFixed(1)} px²`;
      pu.igniteNear(0, 0.5);
      if (!pu.burningCells) return 'the oil did not light';
      // (the Terrain tool's way of changing the ground under a scene)
      game.reshapeMap({ ...game.map, id: 'custom:bugs', name: 'Bugs', terrain: [{ pts: [[-2, 0], [2, 0], [2, 1], [-2, 1]], mat: 'rock' }] });
      if (!game.env.solidAt(0, 0.5)) return 'the block of ground was not built';
      if (pu.total > 0.01 || pu.burningCells) return `under the new ground: ${pu.total.toFixed(1)} px² of oil, ${pu.burningCells} cells burning`;
      kit.advance(0.5);
      if (pu.total > 0.01) return `after 0.5 s, ${pu.total.toFixed(1)} px² of oil on the floor`;
      return true;
    }],
    ['extra: bugs: a fuse cord burning on from a blown-up end, copied, lies loose (not tied to the background)', () => {
      kit.reset();
      const [a, b] = [-2, 2].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.5);
      const pa = a.parts[0];
      const pb = b.parts[0];
      const cord = game.connections.create('fuse', pa, { x: pa.x, y: pa.y }, pb, { x: pb.x, y: pb.y });
      if (!cord) return 'could not lay the cord';
      // as when what's at its end blows up: lit there, and let go of it
      game.connections.lightFrom(a);
      if (cord.b || cord.joint || !cord.burn) return 'the cord was not let go of, burning, at the blown-up end';
      const copy = instantiate(game, capture(game, [b]), { dx: 6 })[0];
      const c2 = game.connections.list.find((k) => k.kind === 'fuse' && k.a.entity === copy);
      if (!copy || !c2) return 'the copy has no fuse cord';
      if (c2.joint) return 'the copied cord is tied to the background where its loose end lay';
      if (!c2.burn) return 'the copied cord is not burning';
      return true;
    }],
    ['extra: bugs: collision switched off and on again (N) for someone who has lost a limb: no crash, and it reads right', () => {
      kit.reset();
      const h = human(0);
      kit.advance(0.5);
      h.gib(h.limbs.get('lowerArmF')!);
      if (!h.parts.some((p) => p.destroyed)) return 'the forearm was not blown off';
      // (read through this, the checks don't narrow it for the rest of the test)
      const off = (): boolean => h.noCollide;
      try {
        // as N (or Disable collision in the menu) does it
        controls.setNoCollide([h], !off());
        if (!off()) return 'collision was not switched off';
        kit.advance(0.2);
        controls.setNoCollide([h], !off());
        if (off()) return 'collision was not switched back on';
        if (h.parts.some((p) => !p.destroyed && p.noCollideAll)) return 'a part still has collision off';
        kit.advance(0.2);
      } catch (err) {
        return `it threw: ${String(err)}`;
      }
      return true;
    }],
    ['extra: bugs: a flask hit twice in one step (a shotgun\'s pellets) breaks once: one splash of what it held', () => {
      kit.reset();
      const f = kit.spawn('flask-water', 0, 1.5) as Flask;
      f.setFrozen(true);
      kit.advance(0.3);
      // two hits inside the same step, when it's only taken away at the end of it
      let made = -1;
      const hit = () => {
        if (made >= 0 || f.destroyed) return;
        const n0 = game.particles.count;
        f.onBullet();
        f.onBullet();
        made = game.particles.count - n0;
      };
      game.preStepHandlers.push(hit);
      try {
        game.step();
      } finally {
        game.preStepHandlers.splice(game.preStepHandlers.indexOf(hit), 1);
      }
      if (made < 0) return 'it was never hit';
      if (!f.destroyed) return 'the flask is still there after the step';
      // (a full flask splashes 220 drops, and a few bits of glass)
      if (made > 330) return `${made} drops and bits from the two hits: it broke twice`;
      return true;
    }],
  ];
}

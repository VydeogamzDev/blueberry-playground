import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Debris, DebrisConfig } from '../../entities/Debris';
import type { Car } from '../../entities/Car';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** Things not alive coming apart (systems/Structure, entities/Debris). */
export default function tests({ game, kit }: TestCtx): Test[] {
  const solid = (p: Part) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) n++;
    return n;
  };
  const pieces = (x0 = -Infinity, x1 = Infinity) => game.entities.filter((e) => e.def.id === 'debris' && !e.destroyed && e.center().x > x0 && e.center().x < x1) as Debris[];
  const pixels = (l: Entity[]) => l.reduce((n, e) => n + solid(e.parts[0]), 0);
  /** A rifle round fired level from (x, y), going `dx`. */
  const rifle = (x: number, y: number, dx = 1) => game.projectiles.fire(x, y, dx, 0, 900, { energy: 1500, damage: 34, push: 0.004 });
  return [
    ['extra: destruction: blown up by C4, a steel box tears into a few big pieces of steel, a crate splinters, a pane of glass shatters into many small shards; the pieces are what it was', () => {
      kit.reset();
      const box = kit.spawn('metal-box', -12, 0.4);
      const crate = kit.spawn('crate', 0, 0.5);
      const pane = kit.spawn('glass', 12, 0.7);
      kit.advance(0.5);
      const before = [solid(box.parts[0]), solid(crate.parts[0]), solid(pane.parts[0])];
      for (const e of [box, crate, pane]) game.explosions.explode(e.center().x - 0.6, e.center().y, { power: 170, radius: 6, damage: 320 });
      kit.advance(0.1);
      const bits = [pieces(-20, -4), pieces(-4, 4), pieces(4, 20)];
      const names = ['steel box', 'crate', 'pane'];
      const mats = ['metal', 'wood', 'glass'];
      for (let i = 0; i < 3; i++) {
        const e = [box, crate, pane][i];
        if (!e.destroyed) return `the ${names[i]} is still whole (${e.parts[0].hp.toFixed(0)} of ${e.parts[0].maxHp.toFixed(0)} hp)`;
        if (bits[i].length < 2) return `the ${names[i]} broke into ${bits[i].length} pieces`;
        const wrong = bits[i].find((d) => d.matName !== mats[i]);
        if (wrong) return `a piece of the ${names[i]} is ${wrong.matName}, not ${mats[i]}`;
        // (scraps too small for a piece fly off as bits)
        // (glass shards are many and small: more of it goes to glitter)
        const kept = pixels(bits[i]) / before[i];
        if (kept < (i === 2 ? 0.4 : 0.7) || kept > 1.01) return `the ${names[i]}'s pieces are ${(kept * 100).toFixed(0)}% of it`;
      }
      const avg = (l: Debris[]) => pixels(l) / l.length;
      if (avg(bits[0]) < 25) return `the steel box's pieces average only ${avg(bits[0]).toFixed(0)} px: steel tears into big pieces`;
      if (avg(bits[2]) > avg(bits[0]) / 2) return `the glass shards (${avg(bits[2]).toFixed(0)} px) are no smaller than the steel's (${avg(bits[0]).toFixed(0)})`;
      // flung as hard as the blast flings whole things, no harder; then they lie about
      const fastest = Math.max(...pieces().map((d) => Math.hypot(d.main.vx, d.main.vy)));
      if (fastest > 45) return `a piece flew off at ${fastest.toFixed(0)} m/s`;
      kit.advance(4);
      // (on the floor: a shard flung high is still coming down)
      const flying = pieces().filter((d) => d.main.y < 0.6 && Math.hypot(d.main.vx, d.main.vy) > 1.5);
      if (flying.length > 2) return `${flying.length} pieces still sliding or rolling along the floor after 4 s (${flying.slice(0, 4).map((d) => `${d.matName} ${Math.hypot(d.main.vx, d.main.vy).toFixed(1)} m/s ${d.main.av.toFixed(0)} rad/s`).join(', ')})`;
      return true;
    }],
    ['extra: destruction: a grenade beside a steel box only hurts it; C4 against it breaks it; a brick wall’s bricks go to rubble', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.4);
      const bricks = [0, 1, 2].map((i) => kit.spawn('brick', 10, 0.15 + i * 0.27));
      kit.advance(0.5);
      game.explosions.explode(box.center().x - 0.9, box.center().y, { power: 70, radius: 4.5, damage: 170 });
      game.explosions.explode(10.6, 0.4, { power: 70, radius: 4.5, damage: 170 });
      kit.advance(0.1);
      if (box.destroyed) return 'a grenade beside a steel box broke it';
      if (box.parts[0].hp >= box.parts[0].maxHp) return 'a grenade beside a steel box did it no harm';
      const left = bricks.filter((b) => !b.destroyed).length;
      if (left > 1) return `${left} of 3 bricks a grenade went off beside are whole`;
      const rubble = pieces(5, 15);
      if (!rubble.length || rubble.some((d) => d.matName !== 'stone')) return `the bricks went to ${rubble.map((d) => d.matName).join(' ') || 'nothing'}`;
      return true;
    }],
    ['extra: destruction: a rifle round goes through a steel drum, leaving a hole each side; a solid steel box stops it with a dent', () => {
      kit.reset();
      const drum = kit.spawn('barrel', 0, 0.7);
      const box = kit.spawn('metal-box', 6, 0.4);
      kit.advance(0.5);
      const d = drum.parts[0];
      const b = box.parts[0];
      const d0 = d.holeCount;
      rifle(-3, d.y + 0.1);
      kit.advance(0.1);
      if (d.holeCount - d0 < 2) return `the drum has ${d.holeCount - d0} pixels shot out of it`;
      // (both sides: holes left and right of its middle)
      let left = 0;
      let right = 0;
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (d.art.filled(x, y) && !d.solidAt(x, y)) (x < d.w / 2 ? left++ : right++);
      if (!left || !right) return `holes only on one side of the drum (${left} left, ${right} right)`;
      rifle(3, b.y);
      kit.advance(0.1);
      if (b.holeCount) return `the steel box has ${b.holeCount} pixels shot out`;
      if (box.destroyed) return 'one round broke the steel box';
      return true;
    }],
    ['extra: destruction: steel white hot breaks under a blow it shrugs off cold, and past its melting point runs away', () => {
      kit.reset();
      const cold = kit.spawn('short-beam', -4, 0.3);
      const hot = kit.spawn('short-beam', 0, 0.3);
      const molten = kit.spawn('short-beam', 4, 0.3);
      kit.advance(0.3);
      game.heat.set(hot.parts[0], 1200);
      game.heat.set(molten.parts[0], 2600);
      for (const e of [cold, hot]) e.damage(e.parts[0], e.parts[0].maxHp * 0.5, 'blunt', { x: e.parts[0].x, y: e.parts[0].y + 0.1 }, { x: 0, y: -1 });
      kit.advance(0.1);
      if (cold.destroyed) return 'a blow of half its strength broke the cold beam';
      if (!hot.destroyed) return `the beam at 1200 °C took the same blow (${hot.parts[0].hp.toFixed(0)} of ${hot.parts[0].maxHp.toFixed(0)} left)`;
      kit.advance(6);
      if (!molten.destroyed) return `at ${molten.parts[0].temp.toFixed(0)} °C after 6 s, it's still there (${molten.parts[0].hp.toFixed(0)} hp)`;
      if (pieces(2, 6).length) return 'molten steel left solid pieces';
      return true;
    }],
    ['extra: destruction: pieces are saved and loaded as they were; past the Debris setting the oldest go; a piece hit hard breaks again', () => {
      kit.reset();
      const cap = game.debrisCap;
      try {
        for (let i = 0; i < 3; i++) {
          const c = kit.spawn('crate', -6 + i * 6, 0.5);
          kit.advance(0.2);
          game.explosions.explode(c.center().x - 0.6, c.center().y, { power: 170, radius: 3, damage: 320 });
          kit.advance(0.1);
        }
        kit.advance(2);
        const l = pieces();
        if (l.length < 6) return `three crates blown up left ${l.length} pieces`;
        const sig = (ls: Debris[]) => ls.map((d) => `${d.matName}:${solid(d.main)}`).sort().join(' ');
        // (put out first: a burning splinter burns away pixel by pixel in the meantime)
        for (const d of l) game.fire.extinguish(d.main);
        const before = sig(l);
        loadFromString(game, saveToString(game));
        const after = sig(pieces());
        if (after !== before) return `after save/load the pieces differ:\n${before}\n${after}`;
        game.debrisCap = 5;
        const c = kit.spawn('crate', 12, 0.5);
        kit.advance(0.2);
        game.explosions.explode(11.4, c.center().y, { power: 170, radius: 3, damage: 320 });
        kit.advance(0.1);
        if (pieces().length > 5) return `with the Debris setting at 5, ${pieces().length} pieces lie about`;
        if (!pieces(8, 16).length) return 'the newest pieces went, not the oldest';
        game.debrisCap = cap;
        const big = pieces().sort((a, b) => solid(b.main) - solid(a.main))[0];
        const n0 = solid(big.main);
        big.damage(big.main, big.main.maxHp * 4, 'explosion', { x: big.main.x, y: big.main.y }, { x: 0, y: 1 });
        kit.advance(0.05);
        if (!big.destroyed) return 'a piece hit hard did not break again';
        if (n0 >= 10 && !pieces().some((d) => solid(d.main) < n0)) return 'the piece broke, yet left nothing smaller';
        return true;
      } finally {
        game.debrisCap = cap;
      }
    }],
    ['extra: destruction: a nuke tears a car apart (windows burst, wheels off whole) and a tank in its fireball (the turret off whole, the gun and road wheels with it); a tank further out is only knocked about; C4 after C4 wrecks a car, then tears it apart', () => {
      kit.reset();
      const car = kit.spawn('car', -8, 1) as Car;
      const tank = kit.spawn('tank', 0, 1) as Car;
      const far = kit.spawn('tank', 13, 1) as Car;
      kit.advance(0.6);
      // (the break each one's pieces share: see Car.dismantle())
      const fromOf = new Map<Car, number>();
      for (const v of [car, tank, far]) {
        const tear = v.dismantle.bind(v);
        v.dismantle = (at, dir) => {
          fromOf.set(v, game.structure.newBreak() + 1);
          tear(at, dir);
        };
      }
      const tankParts = tank.parts.length;
      const turretPx = 300;
      game.explosions.nuke(tank.center().x, tank.center().y + 1, 1);
      for (let i = 0; i < 120 && !(car.destroyed && tank.destroyed); i++) game.step();
      const of = (v: Car) => pieces().filter((d) => (d.config as DebrisConfig).from === fromOf.get(v));
      if (!tank.destroyed) return `a tank in the fireball is still whole (strain ${tank.strain.toFixed(0)} of ${tank.toughness.toFixed(0)}, ${tank.body.temp.toFixed(0)} °C)`;
      if (!car.destroyed) return `a car 8 m from a nuke is still whole (strain ${car.strain.toFixed(0)} of ${car.toughness.toFixed(0)})`;
      const cp = of(car);
      const tp = of(tank);
      const mats = (l: Debris[]) => l.map((d) => d.matName).sort().join(' ');
      // (its windows, tempered glass, burst into glittering bits: no pieces of glass)
      if (cp.some((d) => d.matName === 'glass')) return `the car's windows came off as pieces: ${mats(cp)}`;
      if (cp.filter((d) => d.matName === 'rubber').length !== 2) return `the car's wheels didn't come off whole: ${mats(cp)}`;
      if (cp.filter((d) => d.matName === 'metal').length < 4) return `the car tore into only ${mats(cp)}`;
      const biggest = Math.max(...tp.filter((d) => d.matName === 'metal').map((d) => solid(d.main)));
      if (biggest < turretPx * 0.7) return `the tank's biggest piece is ${biggest} px: its turret didn't come off whole (${tp.length} pieces)`;
      // (its gun and road wheels: a piece each)
      if (tp.length < tankParts + 3) return `the tank came apart into only ${tp.length} pieces (it had ${tankParts} parts)`;
      kit.advance(3);
      if (far.destroyed) return `a tank ${(13).toFixed(0)} m off was torn apart too`;
      // C4 after C4 against a car: its fuel goes up first (a wreck), then it's torn apart
      kit.reset();
      const c2 = kit.spawn('car', 0, 1) as Car;
      kit.advance(0.6);
      let n = 0;
      let wreckedAt = 0;
      for (; n < 12 && !c2.destroyed; n++) {
        const at = c2.body.pixelToWorld(c2.body.w / 2, c2.body.h - 8);
        game.explosions.explode(at.x, at.y - 0.3, { power: 170, radius: 6, damage: 320 });
        kit.advance(0.05);
        if (c2.wrecked && !wreckedAt) wreckedAt = n + 1;
      }
      if (!c2.destroyed) return `${n} C4s under a car didn't tear it apart (strain ${c2.strain.toFixed(0)} of ${c2.toughness.toFixed(0)})`;
      if (n < 3) return `${n} C4 tore a car apart`;
      if (!wreckedAt || wreckedAt >= n) return `the car was torn apart without its fuel going up first (wrecked by C4 ${wreckedAt}, torn apart by ${n})`;
      return true;
    }],
    ['extra: destruction: Repair on any piece of something broken gathers its pieces up and makes it again, mended (a steel box, after a save and load; a car torn apart)', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.4);
      kit.advance(0.5);
      game.explosions.explode(-0.6, 0.4, { power: 170, radius: 6, damage: 320 });
      kit.advance(1);
      if (!box.destroyed) return 'C4 left the steel box whole';
      if (pieces().length < 2) return `the box broke into ${pieces().length} pieces`;
      loadFromString(game, saveToString(game));
      const small = pieces().reduce((a, d) => (d.main.mass < a.main.mass ? d : a));
      if (!small.damaged) return 'its smallest piece offers no Repair';
      small.repair();
      kit.advance(0.2);
      const boxes = game.entities.filter((e) => e.def.id === 'metal-box' && !e.destroyed);
      if (boxes.length !== 1) return `Repair on a piece made ${boxes.length} steel boxes`;
      if (pieces().length) return `${pieces().length} pieces of it are still about`;
      const bp = boxes[0].parts[0];
      if (bp.hp < bp.maxHp) return `the box made again is still hurt (${bp.hp.toFixed(0)} of ${bp.maxHp.toFixed(0)} hp)`;
      // a car torn apart, made again from any piece of it
      kit.reset();
      const car = kit.spawn('car', 0, 1) as Car;
      kit.advance(0.6);
      car.dismantle();
      kit.advance(0.5);
      if (!car.destroyed || pieces().length < 3) return `dismantled, the car left ${pieces().length} pieces`;
      pieces()[pieces().length - 1].repair();
      kit.advance(0.3);
      const cars = game.entities.filter((e) => e.def.id === 'car' && !e.destroyed) as Car[];
      if (cars.length !== 1) return `Repair on a piece of the car made ${cars.length} cars`;
      if (cars[0].wrecked) return 'the car made again is a wreck';
      if (pieces().length) return `${pieces().length} pieces of the car are still about`;
      return true;
    }],
    ['extra: destruction: machines of several parts wear and come apart: a motor shot again and again cuts out, then dies, then breaks; C4 beside a motor, a piston, a servo or a turret tears it into pieces of itself', () => {
      kit.reset();
      const motor = kit.spawn('motor', 0, 0.5) as Entity & { running?: boolean };
      kit.advance(0.3);
      motor.activate();
      kit.advance(0.2);
      const hub = motor.parts[0];
      if (!motor.works) return 'a new motor isn’t in working order';
      let sputtered = false;
      let died = false;
      for (let i = 0; i < 400 && !motor.destroyed; i++) {
        motor.damage(hub, hub.maxHp * 0.02, 'bullet', { x: hub.x, y: hub.y }, { x: 1, y: 0 });
        kit.advance(0.05);
        if (!motor.destroyed && motor.condition < 0.6 && motor.condition >= 0.25) {
          // (worn: on, off, on again)
          let on = 0;
          for (let k = 0; k < 20; k++) {
            kit.advance(0.05);
            if (motor.works) on++;
          }
          if (on > 0 && on < 20) sputtered = true;
        }
        if (!motor.destroyed && motor.condition < 0.25 && !motor.works) died = true;
      }
      if (!sputtered) return 'worn, the motor never cut in and out';
      if (!died) return 'hurt past broken, the motor still ran';
      if (!motor.destroyed) return 'shot to nothing, the motor is still whole';
      for (const id of ['motor', 'piston', 'servo', 'sentry-turret']) {
        kit.reset();
        const m = kit.spawn(id, 0, 0.5);
        kit.advance(0.5);
        const c = m.center();
        game.explosions.explode(c.x - 0.5, c.y, { power: 170, radius: 6, damage: 320 });
        kit.advance(0.5);
        if (!m.destroyed) return `C4 beside a ${id} left it whole (condition ${m.condition.toFixed(2)})`;
        if (pieces().length < 2) return `C4 tore a ${id} into ${pieces().length} pieces`;
      }
      return true;
    }],
    ['extra: destruction: a wire is cut by a knife falling through it, a blast beside it, a fire under it, rounds fired across it; a rope burns through where it’s tied to something on fire', () => {
      kit.reset();
      const C = game.connections;
      const link = (kind: 'wire' | 'rope', a: Entity, b: Entity) => C.create(kind, a.parts[0], a.parts[0].localToWorld(0, 0), b.parts[0], b.parts[0].localToWorld(0, 0))!;
      // battery and lamp held up in the air, 4 m apart: the wire between sags to about 3.7 m
      const pair = (x: number) => {
        const bat = kit.spawn('battery', x, 4);
        const lamp = kit.spawn('light', x + 4, 4);
        bat.setFrozen(true);
        lamp.setFrozen(true);
        return [bat, lamp];
      };
      const sets = [-22, -12, -2, 8].map(pair);
      kit.advance(0.2);
      const wires = sets.map(([b, l]) => link('wire', b, l));
      kit.advance(0.2);
      if (sets.some(([, l]) => !l.powered)) return 'the lamps don’t light before';
      const cut = (i: number) => !C.list.includes(wires[i]);
      // a knife falling flat through the first
      const knife = kit.spawn('knife', -20, 6.5);
      kit.advance(0.02);
      knife.setVelocity(0, -9);
      kit.advance(0.5);
      if (!cut(0)) return 'a knife falling through a wire at 9 m/s didn’t cut it';
      if (sets[0][1].powered) return 'the lamp whose wire was cut still lights';
      if (cut(1) || cut(2) || cut(3)) return 'the knife cut other wires too';
      // a small blast just under the second
      game.explosions.explode(-10, 3.2, { power: 60, radius: 4, damage: 60 });
      kit.advance(0.1);
      if (!cut(1)) return 'a blast just under a wire didn’t cut it';
      // a crate burning under the third
      const crate = kit.spawn('crate', 0, 3.2);
      crate.setFrozen(true);
      kit.advance(0.05);
      game.fire.ignite(crate.parts[0], 1);
      let t = 0;
      for (; t < 6 && !cut(2); t += 0.25) kit.advance(0.25);
      if (!cut(2)) return `a wire with a fire under it was still whole after ${t} s`;
      if (t < 1) return `a wire with a fire under it burnt through in ${t} s`;
      // rounds fired up across the fourth: one in a few cuts it
      let n = 0;
      for (; n < 30 && !cut(3); n++) {
        game.projectiles.fire(10, 1, 0, 1, 900, { energy: 1500, damage: 34, push: 0.004 });
        kit.advance(1 / 60);
      }
      if (!cut(3)) return '30 rifle rounds fired across a wire, and not one cut it';
      // a crate hung on a rope from a plank: the plank set on fire, the rope burns through
      kit.reset();
      const plank = kit.spawn('plank', 0, 5);
      plank.setFrozen(true);
      const load = kit.spawn('metal-box', 0, 3.5);
      kit.advance(0.2);
      const rope = link('rope', plank, load);
      kit.advance(0.5);
      const y0 = load.center().y;
      game.fire.ignite(plank.parts[0], 1);
      for (t = 0; t < 8 && C.list.includes(rope); t += 0.25) kit.advance(0.25);
      if (C.list.includes(rope)) return `a rope tied to a burning plank was still whole after ${t} s`;
      kit.advance(1);
      if (load.center().y > y0 - 1) return 'the rope burnt through, and what hung from it didn’t fall';
      return true;
    }],
    ['extra: destruction: a nuke’s EMP fries a battery and lamp well past its blast for good (till they’re repaired), not ones far off; an EMP generator fries what’s against it and only knocks out the rest', () => {
      kit.reset();
      const C = game.connections;
      const wire = (a: Entity, b: Entity) => C.create('wire', a.parts[0], a.parts[0].localToWorld(0, 0), b.parts[0], b.parts[0].localToWorld(0, 0))!;
      const pair = (x: number) => {
        const bat = kit.spawn('battery', x, 0.4);
        const lamp = kit.spawn('light', x + 0.8, 0.3);
        bat.setFrozen(true);
        lamp.setFrozen(true);
        return [bat, lamp];
      };
      // (past a 0.1 kt blast's 12 m, in its EMP's 36)
      const [bat, lamp] = pair(20);
      const [farBat, farLamp] = pair(-45);
      kit.advance(0.3);
      wire(bat, lamp);
      wire(farBat, farLamp);
      kit.advance(0.2);
      if (!lamp.powered || !farLamp.powered) return 'the lamps don’t light before';
      game.explosions.nuke(0, 1, 0.1);
      kit.advance(3);
      if (bat.destroyed || lamp.destroyed) return 'the battery or lamp 20 m off was destroyed by the blast';
      if (!bat.fried || !lamp.fried) return `20 m off: battery fried ${bat.fried}, lamp ${lamp.fried}`;
      if (lamp.powered) return 'the lamp 20 m off still lights';
      if (farBat.fried || !farLamp.powered) return 'the lamp 45 m off went out';
      kit.advance(5);
      if (lamp.powered) return 'the fried lamp came back by itself';
      bat.repair();
      lamp.repair();
      kit.advance(0.1);
      if (!lamp.powered) return 'repaired, the lamp doesn’t light';
      // an EMP generator: a thruster against it is fried, a battery 2 m off is only knocked out
      kit.reset();
      const emp = kit.spawn('emp-generator', 0, 0.3) as Entity & { duration: number };
      emp.duration = 2;
      // (its flame out to the left, away from the rest)
      const thr = kit.spawn('thruster', -0.75, 0.5) as Entity & { running: boolean };
      thr.setFrozen(true);
      const [b2, l2] = pair(2.4);
      kit.advance(0.3);
      wire(b2, l2);
      thr.activate();
      kit.advance(0.2);
      if (!thr.running || !l2.powered) return 'before the EMP generator goes off: nothing runs';
      emp.activate();
      kit.advance(2.5);
      if (!thr.fried) return 'a thruster against the EMP generator isn’t fried';
      if (b2.fried || l2.fried) return 'a battery and lamp 2 m off the EMP generator were fried';
      if (!l2.powered) return 'the lamp 2 m off didn’t come back';
      if (thr.running) return 'the fried thruster came back';
      return true;
    }],
  ];
}

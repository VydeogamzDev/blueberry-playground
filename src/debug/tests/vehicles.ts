import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Tank } from '../../entities/Tank';
import type { Human } from '../../entities/Human';
import type { Entity } from '../../world/Entity';
import type { LimbKey } from '../../art/human';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { PX } from '../../engine/constants';
import { wrapAngle } from '../../engine/math';
import { HATCH, PICKUP } from '../../art/vehicles';

export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const hp = (h: Human) => h.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  const broken = (h: Human) => [...h.limbs.values()].filter((l) => l.broken || l.severed || l.gone).length;
  /** Picks an item from a vehicle's context menu. */
  const menu = (v: Car, label: string) => v.contextActions().find((a) => a.label === label)?.action();
  /** Starts it driving, from its menu (a tank's Use fires instead). */
  const drive = (v: Car) => menu(v, 'Drive');
  /** Switches it on already going at its top speed, wheels turning with it. */
  const atSpeed = (v: Car) => {
    const s = v.topSpeed * (v.flipped ? -1 : 1);
    drive(v);
    v.setVelocity(s, 0);
    for (const w of v.wheels) w.body.setAngvel(-s / (v.cfg.wheelR * PX), true);
  };
  const part = (h: Human, key: LimbKey) => h.limbs.get(key)!.part;
  /** Drags someone by the middle up, over and down to (x, y), and lets go of them there (as a player lifts them in, not through the car's side). */
  const dropAt = (h: Human, x: number, y: number) => {
    const m = part(h, 'midTorso');
    // (high enough that their legs clear the roof: dragged across it, they'd shove the car along)
    const path = [{ x: m.x, y: m.y }, { x: m.x, y: y + 2.2 }, { x, y: y + 2.2 }, { x, y }];
    kit.down(m.x, m.y);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      // (at a walking pace: swung across fast, they'd be dashed against the roof)
      const n = Math.max(10, Math.round((Math.hypot(b.x - a.x, b.y - a.y) / 3) * 60));
      for (let i = 1; i <= n; i++) {
        kit.move(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
        game.advance(1 / 60);
      }
    }
    game.advance(0.15);
    kit.up(x, y);
  };
  /** How far a rider's hips are from their seat (m), or why they aren't in it. */
  const offSeat = (v: Car, i: number): number | string => {
    const h = v.occupant(i);
    if (!h || h.destroyed || !h.seat) return `nobody in seat ${i}`;
    const [sx, sy] = v.cfg.seats[i].at;
    const at = v.body.pixelToWorld(sx, sy);
    const hips = part(h, 'lowerTorso');
    return Math.hypot(hips.x - at.x, hips.y - at.y);
  };
  /** The first `n` seats taken, everyone's hips where their seat is: '' if so, otherwise what's wrong. */
  const seated = (v: Car, n: number): string => {
    for (let i = 0; i < n; i++) {
      const d = offSeat(v, i);
      if (typeof d === 'string') return d;
      if (d > 0.1) return `seat ${i}: the hips ${d.toFixed(2)} m from it`;
    }
    return '';
  };
  /** A wall of frozen crates three high at x. */
  const wall = (x: number) => {
    for (let k = 0; k < 3; k++) kit.spawn('crate', x, 0.45 + k * 0.88).setFrozen(true);
  };

  return [
    ['extra: vehicles: each sits on its wheels and drives off without tipping or taking off', () => {
      const far: Record<string, number> = { car: 20, truck: 15, suv: 15, tank: 8 };
      for (const id of Object.keys(far)) {
        kit.reset();
        const v = kit.spawn(id, -40, 0.5) as Car;
        kit.advance(1.5);
        const b = v.body;
        const R = v.cfg.wheelR * PX;
        const down = v.wheels.filter((w) => w.y - R < 0.03).length;
        if (down < 2) return `${id}: only ${down} wheels on the floor (lowest ${Math.min(...v.wheels.map((w) => w.y - R)).toFixed(2)} m up)`;
        if (Math.abs(b.a) > 0.05) return `${id}: sits tilted ${b.a.toFixed(2)} rad`;
        if (Math.hypot(b.vx, b.vy) > 0.05) return `${id}: still moving at ${Math.hypot(b.vx, b.vy).toFixed(2)} m/s after landing`;
        const x0 = b.x;
        drive(v);
        let tilt = 0;
        let lift = 0;
        game.advance(4, () => {
          tilt = Math.max(tilt, Math.abs(b.a));
          // the lowest wheel off the floor: the whole thing in the air
          lift = Math.max(lift, Math.min(...v.wheels.map((w) => w.y)) - R);
        });
        if (b.x - x0 < far[id]) return `${id}: drove only ${(b.x - x0).toFixed(1)} m in 4 s (top speed ${v.topSpeed} m/s)`;
        if (tilt > 0.35) return `${id}: tipped ${tilt.toFixed(2)} rad driving off`;
        if (lift > 0.1) return `${id}: took off (every wheel ${lift.toFixed(2)} m up)`;
      }
      return true;
    }],
    ['extra: vehicles: Turbo outruns Normal; speed, reverse and barrel elevation are saved', () => {
      const run = (gear: string) => {
        kit.reset();
        const c = kit.spawn('car', -62, 0.5) as Car;
        menu(c, `Speed: ${gear}`);
        kit.advance(0.5);
        drive(c);
        // the fastest it went (at Turbo it may reach the far wall before the time is up)
        let top = 0;
        game.advance(4, () => (top = Math.max(top, c.body.vx)));
        return top;
      };
      const normal = run('Normal');
      const turbo = run('Turbo');
      if (normal < 12) return `Normal only got up to ${normal.toFixed(1)} m/s in 4 s`;
      if (turbo < normal * 1.5) return `Turbo got up to ${turbo.toFixed(1)} m/s against Normal's ${normal.toFixed(1)}`;
      kit.reset();
      const c = kit.spawn('car', -10, 0.5) as Car;
      menu(c, 'Speed: Turbo');
      menu(c, 'Reverse');
      const t = kit.spawn('tank', 10, 0.6) as Tank;
      menu(t, 'Barrel 20°');
      kit.advance(1);
      loadFromString(game, saveToString(game));
      const c2 = game.entities.find((e) => e.def.id === 'car') as Car | undefined;
      const t2 = game.entities.find((e) => e.def.id === 'tank') as Tank | undefined;
      if (!c2 || !t2) return 'the car or the tank is missing after loading';
      if (c2.gear !== 'turbo' || c2.dir !== -1) return `the car came back at ${c2.gear}, direction ${c2.dir}`;
      if (t2.elevation !== 20) return `the tank's barrel came back set to ${t2.elevation}°`;
      kit.advance(1);
      const up = (wrapAngle(t2.barrel.a - t2.body.a) * 180) / Math.PI;
      if (Math.abs(up - 20) > 3) return `the barrel stands at ${up.toFixed(1)}° to the hull, not 20°`;
      return true;
    }],
    ['extra: vehicles: a car hitting someone maims them at Normal and kills them at Turbo', () => {
      const hit = (gear: string): Human => {
        kit.reset();
        const h = human(3);
        kit.advance(1);
        const c = kit.spawn('car', -3, 0.6) as Car;
        menu(c, `Speed: ${gear}`);
        kit.advance(0.2);
        atSpeed(c);
        kit.advance(1.5);
        return h;
      };
      const a = hit('Normal');
      if (a.alive && !broken(a)) return `hit at Normal: nothing broken (${a.status()})`;
      const b = hit('Turbo');
      if (b.alive) return `hit at Turbo: still alive (${b.status()})`;
      return true;
    }],
    ['extra: vehicles: running over someone lying down breaks bones; a tank crushes them', () => {
      const runOver = (id: string, gear: string, x0: number, seconds = 4) => {
        kit.reset();
        const h = kit.spawn('human', 2, 0.3, { angle: Math.PI / 2 }) as Human;
        h.limp = true;
        kit.advance(1.5);
        const hp0 = hp(h);
        const v = kit.spawn(id, x0, 0.6) as Car;
        menu(v, `Speed: ${gear}`);
        kit.advance(0.3);
        drive(v);
        kit.advance(seconds);
        return { h, lost: hp0 - hp(h), past: v.body.x > 4 };
      };
      const car = runOver('car', 'Slow', -4);
      if (!car.past) return 'the car never got past the person';
      if (!broken(car.h) && car.lost < 60) return `run over by the car: ${car.lost.toFixed(0)} hp lost, nothing broken (${car.h.status()})`;
      // (the tank slows right down climbing over them)
      const tank = runOver('tank', 'Normal', -6, 8);
      if (!tank.past) return 'the tank never got past the person';
      const crushed = [...tank.h.limbs.values()].some((l) => l.severed || l.gone);
      if (tank.h.alive && !crushed) return `run over by the tank: alive and whole, ${tank.lost.toFixed(0)} hp lost (${tank.h.status()})`;
      return true;
    }],
    ['extra: vehicles: the pickup carries a crate in its bed', () => {
      kit.reset();
      const t = kit.spawn('truck', -40, 0.5) as Car;
      kit.advance(1);
      const { bed } = PICKUP;
      const over = t.body.pixelToWorld((bed.x0 + bed.x1) / 2, 0);
      const crate = kit.spawn('crate', over.x, over.y + 0.6).parts[0];
      kit.advance(1.5);
      // in the truck's own frame: on the bed floor, between the tailgate and the cab
      const where = () => t.body.worldToLocal(crate.x, crate.y);
      const inBed = () => {
        const l = where();
        const floor = (PICKUP.h / 2 - bed.y) * PX;
        return !crate.destroyed && l.x > (bed.x0 - PICKUP.w / 2) * PX && l.x < (bed.x1 - PICKUP.w / 2) * PX && l.y > floor && l.y < floor + 0.8;
      };
      const show = () => `crate at ${where().x.toFixed(2)}, ${where().y.toFixed(2)} m from the truck's middle`;
      if (!inBed()) return `the crate did not land in the bed (${show()})`;
      const x0 = t.body.x;
      drive(t);
      kit.advance(3);
      if (t.body.x - x0 < 12) return `the truck only drove ${(t.body.x - x0).toFixed(1)} m in 3 s`;
      if (!inBed()) return `the crate fell out of the bed (${show()})`;
      return true;
    }],
    ['extra: vehicles: the tank fires shells that explode away from it', () => {
      kit.reset();
      const t = kit.spawn('tank', -30, 0.6) as Tank;
      kit.advance(1);
      const ex = game.explosions;
      const explode = ex.explode;
      const booms: number[] = [];
      ex.explode = (x, y, o, delay) => {
        booms.push(x);
        explode.call(ex, x, y, o, delay);
      };
      try {
        const hp0 = t.parts.map((p) => p.hp);
        menu(t, 'Fire');
        if (t.shots !== 1) return 'Fire in its menu did not fire';
        kit.advance(3);
        if (!booms.length) return 'the shell never went off';
        const d = booms[0] - t.body.x;
        if (d < 8) return `the shell went off ${d.toFixed(1)} m ahead of the tank`;
        if (game.entities.some((e) => e.def.id === 'tank-shell')) return 'a shell is left lying about';
        // (a stray fragment from the blast far ahead may come back and scratch it: that's not its own shot)
        const hurt = t.parts.findIndex((p, i) => p.destroyed || p.hp < hp0[i] * 0.9);
        if (hurt >= 0) return `the tank was hurt by its own shot (${t.parts[hurt].name}: ${hp0[hurt]} → ${t.parts[hurt].destroyed ? 'gone' : t.parts[hurt].hp.toFixed(1)})`;
        if (Math.abs(t.body.a) > 0.3) return `the recoil tipped it ${t.body.a.toFixed(2)} rad`;
        // a pulse down a wire (a button) fires it too
        t.onPulse();
        if (t.shots < 2) return 'a pulse did not fire it';
        kit.advance(3);
        if (booms.length < 2) return 'the second shell never went off';
        // Use (F) fires it, and held down it fires again once reloaded; it doesn't drive off
        const x0 = t.body.x;
        controls.selection = new Set([t]);
        kit.key('KeyF', true);
        kit.advance(0.1);
        // (read through a function: TypeScript takes shots to still be 1 from the check above)
        const shots = () => t.shots;
        if (shots() !== 3) return `Use fired ${shots() - 2} shells at once`;
        kit.advance(t.gun.reload + 0.2);
        kit.key('KeyF', false);
        if (shots() !== 4) return `Use held through a reload fired ${shots() - 3} more (not 1)`;
        kit.advance(t.gun.reload + 0.2);
        if (shots() !== 4) return 'it kept firing after Use was let go';
        if (!t.contextActions().some((a) => a.label === 'Drive')) return 'Use set it driving';
        // parked, its brakes hold it against the recoil
        if (Math.abs(t.body.x - x0) > 0.5) return `two shots shoved it ${(t.body.x - x0).toFixed(2)} m`;
      } finally {
        delete (ex as { explode?: unknown }).explode;
      }
      return true;
    }],
    ['extra: vehicles: someone dropped on the car sits in it, rides along, and gets out from its menu', () => {
      kit.reset();
      const c = kit.spawn('car', -30, 0.6) as Car;
      const h = human(-36);
      kit.advance(1.5);
      const [sx, sy] = HATCH.seats[0];
      const over = c.body.pixelToWorld(sx, 8);
      dropAt(h, over.x, over.y + 0.3);
      kit.advance(1);
      if (c.occupant(0) !== h || !h.seat) return `let go of over the cabin, they didn't get in (seat 0: ${c.occupant(0)?.label ?? 'empty'})`;
      let off = offSeat(c, 0);
      if (typeof off === 'string' || off > 0.08) return `sat down, the hips are ${typeof off === 'string' ? off : `${off.toFixed(2)} m from the seat`}`;
      // sitting: the thighs out ahead, near level (the seat leans back a little)
      const thigh = wrapAngle(part(h, 'upperLegF').a - c.body.a);
      if (thigh < 1.2 || thigh > 2.2) return `not sitting: the thighs at ${thigh.toFixed(2)} rad to the car`;
      const head = part(h, 'head');
      if (head.y < c.body.pixelToWorld(sx, sy - 20).y) return `slumped: the head at ${head.y.toFixed(2)} m`;
      const x0 = c.body.x;
      const hx0 = head.x;
      drive(c);
      kit.advance(3);
      if (c.body.x - x0 < 10) return `the car drove only ${(c.body.x - x0).toFixed(1)} m in 3 s`;
      off = offSeat(c, 0);
      if (typeof off === 'string' || off > 0.12) return `fell out on the way (${typeof off === 'string' ? off : `hips ${off.toFixed(2)} m from the seat`})`;
      if (head.x - hx0 < 10) return `the car went ${(c.body.x - x0).toFixed(1)} m, the rider only ${(head.x - hx0).toFixed(1)} m`;
      menu(c, 'Stop');
      kit.advance(5);
      if (Math.abs(c.body.vx) > 0.5) return `still rolling at ${c.body.vx.toFixed(1)} m/s 5 s after stopping`;
      menu(c, 'Get out');
      kit.advance(2);
      if (h.seat || c.occupant(0)) return 'still in the car after "Get out"';
      if (h.state !== 'stand') return `got out, but isn't standing (${h.status()})`;
      const feet = Math.min(part(h, 'footF').y, part(h, 'footB').y);
      if (feet > 0.25) return `standing ${feet.toFixed(2)} m off the floor`;
      const torso = part(h, 'upperTorso');
      if (Math.abs(torso.x - c.body.x) > 2.5) return `got out ${(torso.x - c.body.x).toFixed(1)} m from the car`;
      return true;
    }],
    ['extra: vehicles: seats fill from the driver\'s, a full car takes nobody, and a rider pulled hard comes out', () => {
      kit.reset();
      const c = kit.spawn('car', 0, 0.6) as Car;
      const a = human(-5);
      const b = human(-8);
      // (facing the other way: getting in, they turn round)
      const d = human(-11, { flip: true });
      kit.advance(1.5);
      const over = c.body.pixelToWorld(60, 10);
      for (const h of [a, b, d]) {
        dropAt(h, over.x, over.y);
        kit.advance(0.5);
      }
      if (c.occupant(0) !== a) return `the first in isn't at the wheel (seat 0: ${c.occupant(0) === b ? 'the second' : 'someone else'})`;
      if (c.occupant(1) !== b) return 'the second in isn\'t in the back';
      if (d.seat || d.destroyed) return 'a third got into a car for two';
      const bad = seated(c, 2);
      if (bad) return bad;
      // (the one turned away lies where they were let go of, on the car by the driver: put
      // down out of the way, or the driver is yanked up into them, and a hand that hits
      // someone at that speed is crushed)
      const dm = part(d, 'midTorso');
      d.translate(c.body.x - 5 - dm.x, 0);
      d.setVelocity(0, 0);
      kit.advance(1);
      // yanked up out of the car by the middle
      const m = part(a, 'midTorso');
      kit.drag(m.x, m.y, m.x, m.y + 3, 0.3, 0.3, true);
      kit.advance(0.5);
      if (a.seat || c.occupant(0)) return 'pulled hard by the hand, the driver stayed in the seat';
      if (a.destroyed || [...a.limbs.values()].some((l) => l.severed)) return 'pulled out, the driver came apart';
      kit.advance(1.5);
      // the free seat is taken by the next one let go of over it
      const again = c.body.pixelToWorld(60, 10);
      dropAt(d, again.x, again.y);
      kit.advance(0.5);
      const driver = c.occupant(0);
      if (!driver) return 'the driver\'s seat, free again, took nobody';
      if (driver.flipped !== c.flipped) return 'got in facing the wrong way';
      if (!d.destroyed && driver !== d) return 'someone else took the driver\'s seat';
      return true;
    }],
    ['extra: vehicles: someone dropped on the tank stands in its hatch, head and shoulders out', () => {
      kit.reset();
      const t = kit.spawn('tank', 0, 0.6) as Tank;
      const h = human(-6);
      const g = human(-9);
      kit.advance(1.5);
      const over = t.body.pixelToWorld(56, 2);
      dropAt(h, over.x, over.y + 0.3);
      kit.advance(1);
      if (t.occupant(0) !== h) return 'let go of over the turret, they didn\'t get in';
      const bad = seated(t, 1);
      if (bad) return bad;
      const top = t.body.pixelToWorld(51, 0).y;
      const head = part(h, 'head');
      if (head.y < top + 0.15) return `the head ${(head.y - top).toFixed(2)} m above the cupola: not out of the hatch`;
      dropAt(g, over.x, over.y + 0.3);
      kit.advance(0.5);
      if (g.seat) return 'a second person got into the tank';
      if (t.contextActions().some((a) => a.label === 'Seat belts')) return 'a tank\'s hatch has seat belts';
      return true;
    }],
    ['extra: vehicles: into a frozen wall at Turbo the car blows up, at Normal it\'s dented; running into someone does it no harm', () => {
      const ram = (gear: string, into: 'wall' | 'person') => {
        kit.reset();
        if (into === 'wall') wall(8);
        else human(8);
        kit.advance(1);
        const c = kit.spawn('car', -10, 0.6) as Car;
        menu(c, `Speed: ${gear}`);
        kit.advance(0.2);
        atSpeed(c);
        kit.advance(2);
        return c;
      };
      const turbo = ram('Turbo', 'wall');
      if (!turbo.wrecked) return `hit a wall at Turbo, it didn't blow up (the body at ${turbo.body.hp.toFixed(0)} hp)`;
      if (turbo.contextActions().find((a) => a.label === 'Drive')?.disabled !== true) return 'the wreck can still be driven';
      if (turbo.driving) return 'the wreck is still driving';
      const normal = ram('Normal', 'wall');
      if (normal.wrecked) return 'hit a wall at Normal, it blew up';
      if (normal.body.hp > 95) return `hit a wall at Normal, it took no harm (${normal.body.hp.toFixed(0)} hp)`;
      const person = ram('Normal', 'person');
      if (person.wrecked || person.body.hp < 99) return `ran into someone at Normal, it took ${(100 - person.body.hp).toFixed(0)} hp`;
      return true;
    }],
    ['extra: vehicles: a car rammed into a tank at Turbo blows up, and the tank shrugs it off', () => {
      kit.reset();
      const t = kit.spawn('tank', 10, 0.6) as Tank;
      kit.advance(1);
      const c = kit.spawn('car', -12, 0.6) as Car;
      menu(c, 'Speed: Turbo');
      kit.advance(0.2);
      atSpeed(c);
      kit.advance(2.5);
      if (!c.wrecked) return `hit the tank at Turbo, the car didn't blow up (${c.body.hp.toFixed(0)} hp)`;
      if (t.wrecked) return 'the tank blew up too';
      if (t.body.hp < 60) return `the tank was left at ${t.body.hp.toFixed(0)} hp`;
      return true;
    }],
    ['extra: vehicles: a hard crash throws an unbelted rider out; one belted in stays, hurt less', () => {
      const crash = (belts: boolean) => {
        kit.reset();
        wall(10);
        const c = kit.spawn('car', -30, 0.6) as Car;
        const h = human(-36);
        kit.advance(1);
        c.takeIn(h, c.body.pixelToWorld(60, 10));
        if (belts) menu(c, 'Seat belts');
        kit.advance(0.5);
        const hp0 = hp(h);
        drive(c);
        kit.advance(5);
        return { c, h, lost: hp0 - hp(h) };
      };
      const loose = crash(false);
      if (!loose.c.belts && loose.h.seat) return `unbelted, still in the seat after hitting a wall (the car at ${loose.c.body.hp.toFixed(0)} hp)`;
      const belted = crash(true);
      if (!belted.c.belts) return 'Seat belts in the menu did not put them on';
      if (!belted.h.seat) return 'belted in, thrown out all the same';
      if (belted.lost >= loose.lost) return `belted in, hurt as badly (${belted.lost.toFixed(0)} hp lost against ${loose.lost.toFixed(0)})`;
      return true;
    }],
    ['extra: vehicles: riders stay seated through save and load, duplicating and flipping; deleting a rider or the car leaves nothing behind', () => {
      kit.reset();
      const c = kit.spawn('suv', 0, 0.6) as Car;
      const a = human(-6);
      const b = human(-9);
      kit.advance(1);
      const over = c.body.pixelToWorld(80, 10);
      if (!c.takeIn(a, over) || !c.takeIn(b, over)) return 'could not seat two people';
      kit.advance(1);
      let bad = seated(c, 2);
      if (bad) return `seated: ${bad}`;
      loadFromString(game, saveToString(game));
      kit.advance(0.5);
      const suvs = () => game.entities.filter((e): e is Car => e.def.id === 'suv' && !e.destroyed);
      const c2 = suvs()[0];
      if (!c2) return 'no SUV after loading';
      if ((bad = seated(c2, 2))) return `after loading: ${bad}`;
      controls.duplicate([c2]);
      const copy = suvs().find((e) => e !== c2);
      if (!copy) return 'duplicating made no copy';
      // (moved clear of the first, riders and all)
      for (const e of [copy, ...copy.attachedEntities()] as Entity[]) e.translate(6, 0);
      kit.advance(0.5);
      if ((bad = seated(copy, 2))) return `the copy: ${bad}`;
      const people = game.entities.filter((e) => e.def.id === 'human').length;
      if (people !== 4) return `${people} people after duplicating two riders' car (not 4)`;
      const flipped = game.flipEntity(copy) as Car | null;
      kit.advance(0.5);
      if (!flipped || !flipped.flipped) return 'flipping the copy made no flipped SUV';
      if ((bad = seated(flipped, 2))) return `flipped: ${bad}`;
      if (!flipped.occupant(0)!.flipped) return 'the flipped SUV\'s driver faces the old way';
      // a rider deleted: the seat is free, and nothing is left holding on to the body
      const joints = (v: Car) => {
        let n = 0;
        game.physics.world.impulseJoints.forEachJointHandleAttachedToRigidBody(v.body.body.handle, () => n++);
        return n;
      };
      game.remove(flipped.occupant(1)!);
      kit.advance(0.5);
      if (flipped.occupant(1)) return 'a deleted rider still has their seat';
      if (joints(flipped) !== flipped.wheels.length + 1) return `${joints(flipped)} joints on the body, with ${flipped.wheels.length} wheels and one rider left`;
      // the car deleted: its riders are left to fall, out of their seats
      const left = [c2.occupant(0)!, c2.occupant(1)!];
      game.remove(c2);
      kit.advance(1.5);
      if (left.some((h) => h.destroyed || h.seat)) return 'the riders of a deleted car are gone, or still seated';
      // and a seat of the flipped one takes someone new
      const n = human(-12, { flip: true });
      kit.advance(1);
      if (!flipped.takeIn(n, flipped.body.pixelToWorld(80, 10)) || flipped.occupant(1) !== n) return 'the freed seat took nobody';
      return true;
    }],
    ['extra: vehicles: a driver who dies at the wheel stays slumped in the seat, not dragged along the road under the car', () => {
      kit.reset();
      const c = kit.spawn('car', -50, 0.6) as Car;
      const h = human(-55);
      kit.advance(1);
      const [sx, sy] = c.cfg.seats[0].at;
      if (!c.takeIn(h, c.body.pixelToWorld(sx, sy))) return 'could not seat them';
      menu(c, 'Speed: Turbo');
      drive(c);
      kit.advance(1);
      h.blood = 0;
      let low = Infinity;
      game.advance(3, () => (low = Math.min(low, ...h.parts.filter((p) => !p.destroyed).map((p) => p.y))));
      if (h.alive) return 'they did not die';
      if (c.occupant(0) !== h) return 'dead, they fell out of the seat';
      if (low < 0.15) return `dead at the wheel, they sank through the floor to ${low.toFixed(2)} m`;
      if (c.body.vx < 20) return `with them dead at the wheel, the car only got up to ${c.body.vx.toFixed(1)} m/s at Turbo`;
      return true;
    }],
  ];
}

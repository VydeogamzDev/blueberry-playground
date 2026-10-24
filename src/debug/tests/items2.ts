import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import { Chainsaw } from '../../entities/Chainsaw';
import { Flamethrower, Extinguisher } from '../../entities/Sprayers';
import { StunGun } from '../../entities/StunGun';
import { StickyGrenade, GrenadeLauncher, LauncherRound } from '../../entities/Grenades';
import { BurstRifle, BattleRifle, MachineGun, DoubleBarrel, Flintlock } from '../../entities/MoreGuns';
import { Spear, PowerHammer } from '../../entities/MeleeGear';
import { Flare, Firework } from '../../entities/Pyro';
import { Balloon } from '../../entities/Balloon';
import type { Item } from '../../entities/Item';
import { Liquid } from '../../systems/Liquids';
import { PX } from '../../engine/constants';
import { SAW_BAR, BALLOON_KNOT, PHAMMER_W, PHAMMER_H } from '../../art/gear';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** More weapons and gear (see catalog/arsenal): each does what it's for. */
export default function tests({ game, kit, human, arm }: TestCtx): Test[] {
  /** Steps the world until `done()`, or for `limit` s: how long it took (Infinity: it never was). */
  const until = (done: () => boolean, limit: number): number => {
    let t = 0;
    while (t < limit) {
      game.step();
      t += game.stepDt;
      if (done()) return t;
    }
    return Infinity;
  };
  const all = <T extends Entity>(cls: abstract new (...a: never[]) => T) => game.entities.filter((e): e is T => e instanceof cls && !e.destroyed);
  /** A chainsaw frozen in mid-air with the middle of its bar at (x, y), pointing right. */
  const sawAt = (x: number, y: number, s = kit.spawn('chainsaw', x, y) as Chainsaw): Chainsaw => {
    const m = s.main.pixelToWorld((SAW_BAR.x0 + SAW_BAR.x1) / 2, (SAW_BAR.y0 + SAW_BAR.y1) / 2);
    s.setFrozen(false);
    s.translate(x - m.x, y - m.y);
    s.setFrozen(true);
    return s;
  };
  const limb = (h: Human, k: Parameters<Human['limbs']['get']>[0]) => h.limbs.get(k)!;
  const armOff = (h: Human) => (['upperArmF', 'lowerArmF', 'handF'] as const).some((k) => limb(h, k).severed || limb(h, k).gone);
  /** (read fresh: a shot is fired by calls the type checker can't see into) */
  const shots = (g: { shots: number }) => g.shots;
  const near = (p: Part, x: number, y: number) => Math.hypot(p.x - x, p.y - y);
  /** Something held (by nobody) frozen in mid-air with its middle at (x, y), tipped `angle` rad down from level. */
  const hang = <T extends Entity>(id: string, x: number, y: number, angle = 0): T => {
    const e = kit.spawn(id, x, y, { angle: -angle }) as T;
    e.setFrozen(true);
    return e;
  };
  return [
    ['extra: items2: a running chainsaw cuts off the arm it is held against, and shreds it', () => {
      kit.reset();
      const h = human(2);
      kit.advance(1);
      const arm = limb(h, 'lowerArmF').part;
      const saw = sawAt(arm.x, arm.y);
      if (saw.running) return 'running as it is spawned';
      saw.activate();
      kit.advance(0.2);
      if (!saw.running) return 'Use did not start it';
      const hp0 = arm.hp;
      const t = until(() => armOff(h), 4);
      if (!Number.isFinite(t)) return `in 4 s it did not take the arm off (lower arm hp ${hp0.toFixed(0)} -> ${arm.hp.toFixed(0)}; ${near(arm, saw.main.x, saw.main.y).toFixed(2)} m from the saw)`;
      if (!h.alive) return 'cutting off an arm killed them';
      // what's cut off and still under the saw is torn to bits
      const hand = limb(h, 'handF');
      hand.part.setFrozen(true);
      sawAt(hand.part.x, hand.part.y, saw);
      if (!Number.isFinite(until(() => hand.gone, 4))) return `held on the hand for 4 s, it was not torn to bits (hp ${hand.part.hp.toFixed(0)})`;
      saw.activate();
      kit.advance(0.2);
      if (saw.running) return 'Use again did not stop it';
      return true;
    }],
    ['extra: items2: a chainsaw on steel sparks, kicks and stalls; it cuts through a wooden crate', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 0, 0.5);
      kit.advance(0.8);
      const top = box.parts[0].y + 0.35;
      const saw = sawAt(box.parts[0].x, top);
      saw.activate();
      const t = until(() => !saw.running, 4);
      if (!Number.isFinite(t)) return 'held on a steel box for 4 s, it never stalled';
      if (t < 1) return `it stalled after only ${t.toFixed(2)} s`;
      if (box.destroyed) return 'it cut through a steel box';
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      kit.advance(0.8);
      const saw2 = sawAt(crate.parts[0].x, crate.parts[0].y + 0.3);
      saw2.activate();
      const t2 = until(() => crate.destroyed, 8);
      if (!Number.isFinite(t2)) return `in 8 s it did not cut through a wooden crate (hp ${crate.parts[0].hp.toFixed(0)} of ${crate.parts[0].maxHp.toFixed(0)})`;
      if (!saw2.running) return 'it stalled on wood';
      return true;
    }],
    ['extra: items2: saving and loading keeps a chainsaw running', () => {
      kit.reset();
      const saw = kit.spawn('chainsaw', 0, 1) as Chainsaw;
      saw.setFrozen(true);
      saw.activate();
      kit.advance(1);
      loadFromString(game, saveToString(game));
      const s2 = all(Chainsaw)[0];
      if (!s2) return 'loading lost the chainsaw';
      if (!s2.running || !s2.on) return 'loaded, the chainsaw is not running';
      return true;
    }],
    ['extra: items2: a flamethrower sets a crate alight from 3 m and leaves burning fuel on the floor; its fuel runs down', () => {
      kit.reset();
      const crate = kit.spawn('crate', 3.2, 0.45);
      kit.advance(0.8);
      const g = hang<Flamethrower>('flamethrower', 0, crate.parts[0].y + 0.1);
      g.setActiveHeld(true);
      const t = until(() => crate.parts[0].burning > 0.1, 2);
      if (!Number.isFinite(t)) return `sprayed at for 2 s from 3 m, the crate did not catch (fuel ${g.fuel.toFixed(2)})`;
      kit.advance(1);
      g.setActiveHeld(false);
      // (a tank lasts 25 s)
      const used = (1 - g.fuel) * 25;
      if (Math.abs(used - (t + 1)) > 0.2) return `${(t + 1).toFixed(2)} s of spraying used ${used.toFixed(2)} s of fuel`;
      kit.reset();
      const g2 = hang<Flamethrower>('flamethrower', 0, 0.8, 0.45);
      g2.activate();
      kit.advance(0.6);
      if (!Number.isFinite(until(() => game.puddles.burningCells > 0, 1))) return 'pointed at the floor, it left no burning fuel there';
      // empty, it only clicks
      g2.fuel = 0.001;
      kit.advance(0.2);
      g2.activate();
      kit.advance(0.1);
      if (g2.spraying) return 'it sprays with an empty tank';
      return true;
    }],
    ['extra: items2: a fire extinguisher puts out a burning crate and burning fuel on the floor, and nudges a ball', () => {
      kit.reset();
      const crate = kit.spawn('crate', 2.2, 0.45);
      kit.advance(0.8);
      const c = crate.parts[0];
      c.oil = 0.6;
      game.fire.ignite(c, 1);
      kit.advance(1);
      if (c.burning < 0.2) return `set alight, the crate burns at only ${c.burning.toFixed(2)}`;
      const ex = hang<Extinguisher>('fire-extinguisher', 0, c.y + 0.1);
      ex.setActiveHeld(true);
      const t = until(() => c.burning === 0, 3);
      ex.setActiveHeld(false);
      if (!Number.isFinite(t)) return `sprayed for 3 s, the crate still burns (${c.burning.toFixed(2)})`;
      kit.advance(2);
      if (c.burning > 0) return 'put out, the crate caught again 2 s later';
      kit.reset();
      for (let x = 1.1; x <= 1.5; x += PX) game.puddles.add(Liquid.Oil, x, 0.4);
      kit.advance(0.5);
      game.puddles.igniteNear(1.3, 0.5);
      kit.advance(0.5);
      if (game.puddles.burningCells === 0) return 'the oil on the floor did not catch';
      const ex2 = hang<Extinguisher>('fire-extinguisher', 0, 0.8, 0.5);
      ex2.setActiveHeld(true);
      const t2 = until(() => game.puddles.burningCells === 0, 4);
      ex2.setActiveHeld(false);
      if (!Number.isFinite(t2)) return `sprayed for 4 s, ${game.puddles.burningCells} cells of oil on the floor still burn`;
      kit.reset();
      const ball = kit.spawn('ball', 1.4, 0.2);
      kit.advance(0.8);
      const x0 = ball.parts[0].x;
      const ex3 = hang<Extinguisher>('fire-extinguisher', 0, ball.parts[0].y + 0.08);
      ex3.setActiveHeld(true);
      kit.advance(2);
      ex3.setActiveHeld(false);
      if (ball.parts[0].x < x0 + 0.15) return `sprayed for 2 s, a ball moved only ${(ball.parts[0].x - x0).toFixed(2)} m`;
      return true;
    }],
    ['extra: items2: a stun gun knocks a person out for a few seconds, hardly hurting them; it must charge before another zap', () => {
      kit.reset();
      const h = human(3.5);
      kit.advance(1);
      const chest = limb(h, 'upperTorso').part;
      const s = hang<StunGun>('stun-gun', 0, chest.y);
      const hp0 = h.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.hp), 0);
      s.activate();
      if (shots(s) !== 1) return 'Use did not zap';
      s.activate();
      if (shots(s) !== 1) return 'it zapped again straight away';
      const t = until(() => h.consciousness < 0.3, 2);
      if (!Number.isFinite(t)) return `zapped from 3.5 m, they were not knocked out (consciousness ${h.consciousness.toFixed(2)}, knockout ${h.drugs.knockout.toFixed(1)} s)`;
      const hurt = hp0 - h.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.hp), 0);
      if (hurt > 15) return `a zap took ${hurt.toFixed(1)} hp off`;
      if (!h.alive) return 'a zap killed them';
      kit.advance(1.3);
      s.activate();
      if (shots(s) !== 2) return `charged again ${(1.3 + t).toFixed(1)} s later, Use did not zap`;
      const w = until(() => h.consciousness > 0.5, 20);
      if (!Number.isFinite(w)) return 'they never came round';
      return true;
    }],
    ['extra: items2: a sticky grenade sticks to a moving crate and goes off there; one thrown at the floor sticks to it', () => {
      kit.reset();
      const crate = kit.spawn('crate', -2, 0.45);
      kit.advance(0.8);
      const c = crate.parts[0];
      const g = kit.spawn('sticky-grenade', c.x, c.y + 0.75) as StickyGrenade;
      g.activate();
      if (!g.armed) return 'Use did not pull the pin';
      if (!Number.isFinite(until(() => g.stuck, 1))) return 'dropped onto a crate, it did not stick to it';
      if (g.target !== c) return `it stuck to ${g.target?.entity.def.id ?? 'the floor'}, not the crate`;
      // the crate shoved along: the grenade goes with it, staying where it stuck on it
      const l0 = c.worldToLocal(g.main.x, g.main.y);
      c.body.setLinvel({ x: 4, y: 3 }, true);
      c.body.setAngvel(3, true);
      kit.advance(0.5);
      const l1 = c.worldToLocal(g.main.x, g.main.y);
      const slid = Math.hypot(l1.x - l0.x, l1.y - l0.y);
      if (slid > 0.05) return `the crate was shoved and spun, the grenade moved ${slid.toFixed(2)} m on it`;
      let blast: { x: number; y: number } | null = null;
      const boom = game.explosions.explode.bind(game.explosions);
      game.explosions.explode = (x, y, o, d) => {
        if (o.source === g) blast = { x, y };
        boom(x, y, o, d);
      };
      try {
        until(() => g.destroyed, 3.5);
      } finally {
        delete (game.explosions as { explode?: unknown }).explode;
      }
      const at = blast as { x: number; y: number } | null;
      if (!at) return 'it never went off';
      if (Math.hypot(at.x - c.x, at.y - c.y) > 0.8) return `it went off ${Math.hypot(at.x - c.x, at.y - c.y).toFixed(2)} m from the crate it was stuck to`;
      kit.reset();
      const g2 = kit.spawn('sticky-grenade', 1, 1.5) as StickyGrenade;
      g2.activate();
      g2.main.body.setLinvel({ x: 3, y: -2 }, true);
      if (!Number.isFinite(until(() => g2.stuck, 1.5))) return 'thrown at the floor, it did not stick to it';
      const x0 = g2.main.x;
      kit.advance(1);
      if (Math.abs(g2.main.x - x0) > 0.02) return 'stuck to the floor, it still slides about';
      // saved and loaded, it's still stuck there
      loadFromString(game, saveToString(game));
      const g3 = all(StickyGrenade)[0];
      if (!g3 || !g3.stuck || !g3.armed) return `loaded, the grenade is ${g3 ? (g3.stuck ? 'stuck but not armed' : 'not stuck') : 'gone'}`;
      return true;
    }],
    ['extra: items2: a grenade launcher lobs a round that goes off where it lands; timed rounds bounce first; it must reload', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 6, 0.5);
      kit.advance(0.8);
      const g = hang<GrenadeLauncher>('grenade-launcher', 0, 1, -0.1);
      let blast: { x: number; y: number; t: number } | null = null;
      const boom = game.explosions.explode.bind(game.explosions);
      game.explosions.explode = (x, y, o, d) => {
        if (o.source instanceof LauncherRound) blast = { x, y, t: game.time };
        boom(x, y, o, d);
      };
      try {
        const t0 = game.time;
        g.activate();
        if (shots(g) !== 1 || all(LauncherRound).length !== 1) return `Use: ${g.shots} shots, ${all(LauncherRound).length} rounds in flight`;
        g.activate();
        if (shots(g) !== 1) return 'it fired again straight away';
        until(() => blast !== null, 3);
        const b = blast as { x: number; y: number; t: number } | null;
        if (!b) return 'the round never went off';
        if (b.x < 2) return `it went off only ${b.x.toFixed(2)} m out`;
        if (b.t - t0 > 1.5) return `an impact round took ${(b.t - t0).toFixed(2)} s to go off`;
        if (!Number.isFinite(until(() => g.loaded, 2.5))) return 'it never reloaded';
        // timed: it goes off 2.5 s after it's fired, wherever it has got to
        blast = null;
        g.setMode('timed');
        const t1 = game.time;
        g.activate();
        until(() => blast !== null, 4);
        const b2 = blast as { x: number; y: number; t: number } | null;
        if (!b2) return 'the timed round never went off';
        if (Math.abs(b2.t - t1 - 2.5) > 0.15) return `the timed round went off ${(b2.t - t1).toFixed(2)} s after firing`;
      } finally {
        delete (game.explosions as { explode?: unknown }).explode;
      }
      if (box.destroyed) return 'the steel box was destroyed';
      return true;
    }],
    ['extra: items2: burst rifle, battle rifle, machine gun, double barrel and flintlock each fire their own way', () => {
      kit.reset();
      const b = hang<BurstRifle>('burst-rifle', 0, 2);
      b.activate();
      kit.advance(0.4);
      if (shots(b) !== 3) return `a burst rifle fired ${b.shots} rounds on one Use`;
      kit.advance(0.3);
      b.activate();
      kit.advance(0.4);
      if (shots(b) !== 6) return `two bursts: ${b.shots} rounds`;
      kit.reset();
      const r = hang<BattleRifle>('battle-rifle', 0, 2);
      for (let i = 0; i < 8; i++) {
        r.activate();
        kit.advance(0.25);
      }
      if (shots(r) !== 8 || r.rounds !== 0 || r.reload <= 0) return `eight shots from a battle rifle: ${r.shots} fired, ${r.rounds} rounds left, reload ${r.reload.toFixed(2)}`;
      r.activate();
      if (shots(r) !== 8) return 'it fired a ninth round from an empty clip';
      kit.advance(2);
      r.activate();
      if (shots(r) !== 9 || (r.rounds as number) !== 7) return `a new clip in: ${r.shots} shots, ${r.rounds} rounds`;
      kit.reset();
      const m = hang<MachineGun>('machine-gun', 0, 2);
      m.setActiveHeld(true);
      const hot = until(() => m.overheated, 14);
      if (!Number.isFinite(hot)) return `held firing 14 s, it never overheated (heat ${m.heat.toFixed(2)}, ${m.shots} shots)`;
      if (hot < 5) return `it overheated after only ${hot.toFixed(1)} s`;
      const n = shots(m);
      kit.advance(1);
      if (shots(m) !== n) return 'overheated, it kept firing';
      if (!Number.isFinite(until(() => !m.overheated && shots(m) > n, 8))) return 'it never cooled down and fired again';
      m.setActiveHeld(false);
      kit.reset();
      const d = hang<DoubleBarrel>('double-barrel', 0, 2);
      d.activate();
      kit.advance(0.3);
      d.activate();
      if (shots(d) !== 2 || d.loaded !== 0) return `two shots from a double barrel: ${d.shots} fired, ${d.loaded} loaded`;
      d.activate();
      if (shots(d) !== 2) return 'it fired a third time without reloading';
      if (!Number.isFinite(until(() => d.loaded === 2, 3))) return 'it never reloaded';
      d.fireBoth();
      if (shots(d) !== 3 || (d.loaded as number) !== 0) return `both barrels at once: ${d.shots} shots, ${d.loaded} loaded`;
      kit.reset();
      const f = hang<Flintlock>('flintlock', 0, 2);
      f.activate();
      if (shots(f) !== 0) return 'the flintlock fired the instant the flint struck';
      kit.advance(0.3);
      if (shots(f) !== 1) return 'the flintlock did not fire after the flint struck';
      f.activate();
      kit.advance(0.3);
      if (shots(f) !== 1) return 'it fired again without loading';
      if (!Number.isFinite(until(() => f.loaded, 4))) return 'it never loaded again';
      return true;
    }],
    ['extra: items2: a spear pushed point first sticks in a crate; thrown backwards, it turns in the air and lands point first', () => {
      kit.reset();
      const crate = kit.spawn('crate', 2, 0.75, { config: { w: 48, h: 48 } });
      crate.setFrozen(true);
      kit.advance(0.2);
      const s = kit.spawn('spear', 0.2, 0.8) as Spear;
      s.main.body.setLinvel({ x: 8, y: 0 }, true);
      if (!Number.isFinite(until(() => !!s.lodge, 1))) return 'pushed point first into a crate at 8 m/s, it did not stick in';
      if (s.lodge?.target.entity !== crate) return `it stuck in ${s.lodge?.target.entity.def.id}, not the crate`;
      kit.reset();
      const crate2 = kit.spawn('crate', 2, 0.75, { config: { w: 48, h: 48 } });
      crate2.setFrozen(true);
      // pointing back the way it's thrown
      const s2 = kit.spawn('spear', -4, 1.8, { flip: true }) as Spear;
      kit.advance(0.05);
      s2.main.body.setLinvel({ x: 16, y: 0.5 }, true);
      const t = until(() => !!s2.lodge || s2.main.x > 3, 2);
      if (!s2.lodge) return `thrown backwards at a crate, it did not stick in (${Number.isFinite(t) ? 'it got past' : 'after 2 s'}; ${s2.main.x.toFixed(2)}, ${s2.main.y.toFixed(2)})`;
      if (s2.lodge.target.entity !== crate2) return `thrown, it stuck in ${s2.lodge.target.entity.def.id}`;
      return true;
    }],
    ['extra: items2: a power hammer swung into a crate throws it; its piston must recharge; it fires on Use while touching', () => {
      kit.reset();
      const crate = kit.spawn('crate', 1, 0.5);
      kit.advance(0.8);
      const c = crate.parts[0];
      const h = kit.spawn('power-hammer', c.x - 1.6, c.y + 0.1) as PowerHammer;
      h.setWeightless(true);
      h.main.body.setLinvel({ x: 6, y: 0 }, true);
      let top = 0;
      until(() => {
        top = Math.max(top, c.body.linvel().x);
        return !h.charged;
      }, 1);
      if (h.charged) return 'swung into a crate at 6 m/s, the piston did not fire';
      kit.advance(0.1);
      top = Math.max(top, c.body.linvel().x);
      if (top < 3) return `the piston's blow sent a ${crate.totalMass().toFixed(0)} kg crate off at only ${top.toFixed(1)} m/s`;
      if (!Number.isFinite(until(() => h.charged, 2))) return 'it never recharged';
      // pressed against a crate and Used: it fires into it
      kit.reset();
      const box = kit.spawn('crate', 1, 0.5);
      kit.advance(0.8);
      const b = box.parts[0];
      const h2 = kit.spawn('power-hammer', 0, b.y) as PowerHammer;
      const face = h2.main.pixelToWorld(PHAMMER_W, PHAMMER_H / 2);
      h2.translate(b.x - (b.w * PX) / 2 - face.x + 0.03, 0);
      h2.setFrozen(true);
      kit.advance(0.1);
      h2.activate();
      kit.advance(0.1);
      if (h2.charged) return 'pressed to a crate, Use did not fire the piston';
      if (b.body.linvel().x < 2 && b.x < 1.2) return `Used against a crate, it hardly moved it (${b.body.linvel().x.toFixed(1)} m/s)`;
      return true;
    }],
    ['extra: items2: a flare burns red and lights fuel on the floor; fire lights it; it burns out; saving keeps it burning', () => {
      kit.reset();
      const f = kit.spawn('flare', 0, 0.1) as Flare;
      kit.advance(0.5);
      const tip = f.main.pixelToWorld(15, 1.5);
      for (let x = tip.x - 0.3; x <= tip.x + 0.3; x += PX) game.puddles.add(Liquid.Oil, x, 0.4);
      kit.advance(1);
      if (game.puddles.burningCells > 0) return 'the oil caught before the flare was struck';
      f.activate();
      if (!f.lit) return 'Use did not light it';
      if (!Number.isFinite(until(() => game.puddles.burningCells > 0, 2))) return 'lit and lying in oil, it did not set the oil alight';
      const left = f.left;
      kit.advance(1);
      if (Math.abs(left - f.left - 1) > 0.05) return `it burnt ${(left - f.left).toFixed(2)} s in a second`;
      loadFromString(game, saveToString(game));
      const f2 = all(Flare)[0];
      if (!f2?.lit || Math.abs(f2.left - f.left) > 1.1) return `loaded, the flare is ${f2 ? (f2.lit ? `burning with ${f2.left.toFixed(1)} s left (was ${f.left.toFixed(1)})` : 'out') : 'gone'}`;
      f2.left = 0.3;
      kit.advance(0.5);
      if (f2.lit || !f2.spent) return 'it did not burn out';
      f2.activate();
      if (f2.lit) return 'a burnt-out flare lit again';
      kit.reset();
      const f3 = kit.spawn('flare', 0, 1) as Flare;
      f3.setFrozen(true);
      game.fire.ignite(f3.main, 0.5);
      if (!Number.isFinite(until(() => f3.lit, 0.5))) return 'set on fire, it did not light';
      return true;
    }],
    ['extra: items2: a firework rocket flies up and bursts high up; one that hits something on the way bursts there', () => {
      kit.reset();
      const r = kit.spawn('firework', 0, 0.52) as Firework;
      r.setFrozen(true);
      r.setColor('green');
      r.activate();
      if (r.state !== 'fuse') return 'Use did not light the fuse';
      kit.advance(0.6);
      if (r.state !== 'fuse') return `0.6 s after it was lit it is ${r.state}`;
      loadFromString(game, saveToString(game));
      const r2 = all(Firework)[0];
      if (!r2 || r2.state !== 'fuse' || r2.color !== 'green') return `loaded, the rocket is ${r2 ? `${r2.state} and ${r2.color}` : 'gone'}`;
      let top = 0;
      let x = 0;
      const t = until(() => {
        if (!r2.destroyed) {
          top = Math.max(top, r2.main.y);
          x = r2.main.x;
        }
        return r2.destroyed;
      }, 6);
      if (!Number.isFinite(t)) return `lit, it had not burst 6 s later (${r2.state}, ${r2.main.y.toFixed(1)} m up)`;
      if (top < 8) return `it burst only ${top.toFixed(1)} m up`;
      if (Math.abs(x) > 3) return `it flew off ${x.toFixed(1)} m sideways`;
      kit.reset();
      const box = kit.spawn('metal-box', 0, 5);
      box.setFrozen(true);
      const r3 = kit.spawn('firework', 0, 0.52) as Firework;
      r3.setFrozen(true);
      r3.activate();
      let hi = 0;
      until(() => {
        if (!r3.destroyed) hi = Math.max(hi, r3.main.y);
        return r3.destroyed;
      }, 4);
      if (!r3.destroyed) return 'flying into a box over it, it did not burst';
      if (hi > 5) return `with a box 5 m over it, it burst ${hi.toFixed(1)} m up`;
      return true;
    }],
    ['extra: items2: a balloon floats up and lifts the crate tied to it; shot, it pops and the crate falls; blades and fire pop it', () => {
      kit.reset();
      const free = kit.spawn('balloon', -3, 1) as Balloon;
      kit.advance(1);
      const rise = free.main.y - 1;
      if (rise < 1 || rise > 6) return `let go, it rose ${rise.toFixed(2)} m in a second`;
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.26, { config: { w: 16, h: 16 } });
      const b = kit.spawn('balloon', 0, 2) as Balloon;
      const c = crate.parts[0];
      kit.advance(0.05);
      const knot = b.main.pixelToWorld(BALLOON_KNOT[0], BALLOON_KNOT[1]);
      const rope = game.connections.create('rope', b.main, knot, c, { x: c.x, y: c.y + 0.24 });
      kit.advance(3);
      if (c.y < 1.2) return `tied to a balloon, a ${crate.totalMass().toFixed(1)} kg crate rose only to ${c.y.toFixed(2)} m in 3 s (balloon ${b.destroyed ? 'popped' : `at ${b.main.y.toFixed(2)} m, ${b.main.mass.toFixed(2)} kg`}; rope ${rope ? (game.connections.list.includes(rope) ? `of ${rope.rest.toFixed(2)} m` : 'broke') : 'not made'}; crate ${c.body.isSleeping() ? 'asleep' : 'awake'})`;
      const at = b.main.pixelToWorld(7, 8);
      const gun = hang<Item>('pistol', at.x - 3, at.y - 2.5 * PX + b.main.body.linvel().y * 0.02);
      gun.activate();
      if (!Number.isFinite(until(() => b.destroyed, 0.3))) return 'shot, the balloon did not pop';
      kit.advance(0.5);
      if (c.body.linvel().y > -1) return `the balloon popped, the crate did not fall (${c.body.linvel().y.toFixed(1)} m/s)`;
      kit.reset();
      const knife = hang<Item>('knife', 0, 2.5);
      const edge = knife.main.pixelToWorld(10, 2);
      const b2 = kit.spawn('balloon', edge.x, 1.2) as Balloon;
      if (!Number.isFinite(until(() => b2.destroyed, 2))) return `rising into a knife's edge, it did not pop (${b2.main.y.toFixed(2)} m up)`;
      const b3 = kit.spawn('balloon', 3, 1) as Balloon;
      b3.setFrozen(true);
      game.fire.ignite(b3.main, 0.5);
      if (!Number.isFinite(until(() => b3.destroyed, 0.3))) return 'set on fire, it did not pop';
      const b4 = kit.spawn('balloon', -3, 1) as Balloon;
      b4.setColor('blue');
      b4.setFrozen(true);
      loadFromString(game, saveToString(game));
      if (all(Balloon)[0]?.color !== 'blue') return 'loaded, a blue balloon is not blue';
      return true;
    }],
    ['extra: items2: the 1000 kg weight weighs a tonne and rests on the floor', () => {
      kit.reset();
      const w = kit.spawn('weight', 0, 2);
      const m = w.totalMass();
      if (Math.abs(m - 1000) > 30) return `it weighs ${m.toFixed(0)} kg`;
      kit.advance(2);
      const p = w.parts[0];
      if (Math.abs(p.y - 13 * PX) > 0.05) return `dropped, it came to rest with its middle ${p.y.toFixed(2)} m up (expected ${(13 * PX).toFixed(2)})`;
      return true;
    }],
    ['extra: items2: people fight with a stun gun (knocking their foe out), a flamethrower (setting them alight) and a chainsaw (cutting them)', () => {
      for (const id of ['stun-gun', 'flamethrower', 'chainsaw']) {
        kit.reset();
        const a = human(-3);
        const b = human(3, { flip: true });
        kit.advance(1);
        const g = arm(a, id);
        if (g?.def.id !== id) return `could not hand them the ${id}`;
        a.fight(b);
        const done = id === 'stun-gun' ? () => b.consciousness < 0.3
          : id === 'flamethrower' ? () => b.parts.some((p) => p.burning > 0.2)
            : () => b.parts.some((p) => p.hp < p.maxHp * 0.5) || [...b.limbs.values()].some((l) => l.severed);
        const t = until(done, 15);
        if (!Number.isFinite(t)) return `fighting with a ${id} for 15 s, the other was not ${id === 'stun-gun' ? 'knocked out' : id === 'flamethrower' ? 'set alight' : 'cut'} (${a.foe ? 'still fighting' : 'stopped fighting'})`;
        if (id === 'chainsaw' && !(g as unknown as Chainsaw).running && a.foe) return 'fighting with a chainsaw, it was not running';
      }
      return true;
    }],
  ];
}

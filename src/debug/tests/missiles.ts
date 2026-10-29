import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Tank } from '../../entities/Tank';
import type { Entity } from '../../world/Entity';
import type { V2 } from '../../engine/math';
import type { GuidedLauncher, Guide, Missile, SpikeLauncher } from '../../entities/Missiles';
import type { MissileCarrier } from '../../entities/M113';
import { STRIKE_COUNT } from '../../entities/Missiles';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** The guided missiles: the mouse-guided launcher, the Spike LR-II, vertical launch, the missile versions and the M113 missile carrier. */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const r = game.renderer;
  /** The missile of `id` in flight (the newest), if any. */
  const flying = (id: string): Missile | undefined => [...game.entities].reverse().find((e) => e.def.id === id && !e.destroyed) as Missile | undefined;
  /**
   * Steps `seconds` with the cursor held at `at` (no frames: those set it to
   * where the real pointer is), calling `each` after every step; stops early
   * when `each` returns true.
   */
  const fly = (seconds: number, at: V2 | null, each?: () => boolean | void): void => {
    const n = Math.round(seconds / game.stepDt);
    for (let i = 0; i < n; i++) {
      game.cursor = at && { ...at };
      game.step();
      if (each?.()) return;
    }
  };
  /** Runs `fn`, then lets go of F and puts the camera back as it was. */
  const tidy = <T>(fn: () => T): T => {
    const cam = { x: r.camX, y: r.camY, zoom: r.zoom };
    try {
      return fn();
    } finally {
      kit.key('KeyF', false);
      controls.releaseActivation();
      controls.clearSelection();
      r.camX = cam.x;
      r.camY = cam.y;
      r.zoom = r.targetZoom = cam.zoom;
    }
  };
  /** A wall of concrete, frozen in place, `h` m tall with its foot on the floor at x. */
  const wall = (x: number, h: number): Entity => {
    const w = kit.spawn('concrete-block', x, h / 2 + 0.02, { config: { w: 10, h: Math.round(h * 32) } });
    w.setFrozen(true);
    return w;
  };
  /** Where a missile went off: tracked while it flies, the last place it was seen. */
  const track = (id: string) => {
    const t = { last: null as V2 | null, top: -Infinity, gone: false, phases: [] as string[] };
    const look = (): boolean => {
      const m = flying(id);
      if (!m) {
        if (t.last) t.gone = true;
        return t.gone;
      }
      t.last = { x: m.main.x, y: m.main.y };
      t.top = Math.max(t.top, m.main.y);
      if (t.phases[t.phases.length - 1] !== m.phase) t.phases.push(m.phase);
      return false;
    };
    return { t, look };
  };

  return [
    ['extra: missiles: a mouse-guided missile turns after the cursor when it is moved in flight, and blows up near it, wrecking the car there', () => {
      kit.reset();
      const L = kit.spawn('guided-launcher', -12, 0.4) as GuidedLauncher;
      const car = kit.spawn('car', 6, 0.8) as Car;
      kit.advance(1);
      // first up and ahead, then down on the car once it's on its way
      const up = { x: -2, y: 7 };
      game.cursor = up;
      L.activate();
      const { t, look } = track('missile-guided');
      fly(0.7, up, look);
      const m = flying('missile-guided');
      if (!m) return `0.7 s after firing there's no missile in flight (shots: ${L.shots})`;
      if (m.phase !== 'boost') return `0.7 s after firing its motor isn't burning (${m.phase})`;
      if (t.top < 3.5) return `steered at a point 7 m up, it got only ${t.top.toFixed(1)} m high in 0.7 s`;
      const at = { x: car.body.x, y: car.body.y + 0.2 };
      fly(3, at, look);
      if (!t.gone || !t.last) return `3 s after the cursor moved down onto the car, the missile is still flying (at ${t.last?.x.toFixed(1)}, ${t.last?.y.toFixed(1)})`;
      const off = Math.hypot(t.last.x - at.x, t.last.y - at.y);
      if (off > 2.5) return `it went off ${off.toFixed(1)} m from the cursor (at ${t.last.x.toFixed(1)}, ${t.last.y.toFixed(1)})`;
      kit.advance(0.1);
      if (!car.wrecked) return `the car it hit isn't wrecked (hp ${car.body.hp.toFixed(0)})`;
      return true;
    }],
    ['extra: missiles: the Spike, selected, locks on a car behind a wall in its lock time with F held (the car isn\'t driven), fires as F is let go, goes over the wall and wrecks the car', () => tidy(() => {
      kit.reset();
      const L = kit.spawn('spike-launcher', -14, 0.4) as SpikeLauncher;
      const w = wall(-5, 3);
      const car = kit.spawn('car', 5, 0.8) as Car;
      kit.advance(1);
      // the launcher selected, the pointer on the car (hovered: F would drive a car it points at)
      controls.selection = new Set([L]);
      kit.view(0, 3, 40);
      kit.move(car.body.x, car.body.y + 0.2);
      kit.view(0, 3, 40);
      kit.key('KeyF', true);
      if (!L.activeHeld) return 'F with the launcher selected and the cursor on the car did not switch its seeker on';
      if (car.driving) return 'F drove the car the cursor was on, instead of working the selected launcher';
      // (the frames set the cursor where the pointer is: on the car)
      let lockedAt = -1;
      for (let i = 0; i < 12 && lockedAt < 0; i++) {
        kit.advance(0.1);
        if (L.lock) lockedAt = (i + 1) * 0.1;
      }
      if (lockedAt < 0) return `no lock after 1.2 s on the car (gate on ${L.sighted?.entity?.def.id ?? 'nothing'}, ${L.locking.toFixed(2)} s)`;
      if (lockedAt < 0.5) return `it locked on after only ${lockedAt.toFixed(1)} s`;
      if (L.lock?.entity !== car) return `it locked on ${L.lock?.entity?.def.id ?? 'the ground'}, not the car`;
      if (flying('missile-spike') || L.shots) return 'a missile was fired while F was still held';
      kit.key('KeyF', false);
      if (L.shots !== 1) return `letting go of F with a lock fired ${L.shots} missiles`;
      const { t, look } = track('missile-spike');
      // (the pointer goes elsewhere: fire and forget)
      fly(4, { x: -20, y: 10 }, look);
      if (!t.gone) return 'the missile was still flying 4 s after it was fired';
      if (t.top < 3.3) return `it never went higher than ${t.top.toFixed(1)} m, under the wall's top (3 m)`;
      if (w.destroyed || (t.last && Math.abs(t.last.x - w.parts[0].x) < 1)) return `it went off at the wall (${t.last?.x.toFixed(1)}, ${t.last?.y.toFixed(1)})`;
      kit.advance(0.1);
      if (!car.wrecked) return `the car isn't wrecked (hp ${car.body.hp.toFixed(0)}; the missile went off at ${t.last?.x.toFixed(1)}, ${t.last?.y.toFixed(1)})`;
      return true;
    })],
    ['extra: missiles: letting go of F before the Spike has locked on, or with nothing under its gate, fires nothing', () => {
      kit.reset();
      const L = kit.spawn('spike-launcher', -10, 0.4) as SpikeLauncher;
      const car = kit.spawn('car', 4, 0.8) as Car;
      kit.advance(1);
      const on = { x: car.body.x, y: car.body.y + 0.2 };
      L.setActiveHeld(true);
      fly(0.3, on);
      if (L.lock) return 'locked on after 0.3 s';
      if (L.sighted?.entity !== car) return `the gate on the car sees ${L.sighted?.entity?.def.id ?? 'nothing'}`;
      L.setActiveHeld(false);
      fly(0.5, on);
      if (L.shots || flying('missile-spike')) return 'let go of before it locked on, it fired';
      // held a long while on empty air
      L.setActiveHeld(true);
      fly(1.5, { x: 0, y: 6 });
      if (L.lock || L.sighted) return `held on empty air, it ${L.lock ? 'locked on' : 'sighted'} ${(L.lock ?? L.sighted)?.entity?.def.id ?? 'a point'}`;
      L.setActiveHeld(false);
      fly(0.5, { x: 0, y: 6 });
      if (L.shots || flying('missile-spike')) return 'let go of with nothing locked, it fired';
      if (!L.loaded) return 'it lost its missile without firing';
      return true;
    }],
    ['extra: missiles: a vertical launch throws the missile straight up with its motor off, turns it over with its nose jets, lights it, and it reaches its target', () => {
      kit.reset();
      const L = kit.spawn('guided-launcher', -8, 0.2, { config: { vertical: true } }) as GuidedLauncher;
      const car = kit.spawn('car', 6, 0.8) as Car;
      kit.advance(1);
      if (!L.vertical) return 'spawned with config vertical, it isn\'t a vertical launcher';
      const at = { x: car.body.x, y: car.body.y + 0.2 };
      game.cursor = at;
      const x0 = L.main.x;
      L.activate();
      const m = flying('missile-guided');
      if (!m) return 'nothing was fired';
      // the first tenth of a second: straight up, unlit
      let worst = '';
      fly(0.1, at, () => {
        const v = m.main.body.linvel();
        if (!worst && (m.phase !== 'eject' || Math.abs(v.x) > 0.5 || v.y < 15 || Math.sin(m.heading()) < 0.998)) {
          worst = `${m.phase}, going ${v.x.toFixed(1)}, ${v.y.toFixed(1)} m/s, nose at ${((m.heading() * 180) / Math.PI).toFixed(0)}°`;
        }
      });
      if (worst) return `thrown out of the cell it wasn't going straight up unlit: ${worst}`;
      if (Math.abs(m.main.x - x0) > 0.1) return `it left the cell ${(m.main.x - x0).toFixed(2)} m to the side`;
      const { t, look } = track('missile-guided');
      let litAt = -1;
      let headingLit = 0;
      let time = 0.1;
      fly(4, at, () => {
        time += game.stepDt;
        if (litAt < 0 && m.phase === 'boost') {
          litAt = time;
          headingLit = m.heading();
        }
        return look();
      });
      if (!t.phases.join(' ').startsWith('eject turn boost')) return `its phases went ${t.phases.join(' → ')}`;
      if (litAt < 0.15 || litAt > 0.9) return `its motor lit ${litAt.toFixed(2)} s after launch`;
      if (Math.cos(headingLit) < 0.3) return `lit pointing at ${((headingLit * 180) / Math.PI).toFixed(0)}°: not turned over toward the car to its right`;
      if (!t.gone) return 'still flying 4 s after launch';
      kit.advance(0.1);
      if (!car.wrecked) return `the car isn't wrecked (hp ${car.body.hp.toFixed(0)}; it went off at ${t.last?.x.toFixed(1)}, ${t.last?.y.toFixed(1)})`;
      return true;
    }],
    ['extra: missiles: a launcher\'s launch mode (from its menu) survives save and load, and undo and redo', () => {
      kit.reset();
      const a = kit.spawn('spike-launcher', -3, 0.4) as GuidedLauncher;
      kit.spawn('guided-launcher', 3, 0.4);
      kit.advance(0.5);
      controls.history.clear();
      controls.history.record('Vertical launch');
      const act = a.contextActions().find((c) => c.label === 'Vertical launch');
      if (!act) return `no Vertical launch in its menu (${a.contextActions().map((c) => c.label).join(', ')})`;
      act.action();
      const v = game.entities.find((e) => e.def.id === 'spike-launcher' && !e.destroyed) as GuidedLauncher | undefined;
      if (!v?.vertical) return 'Vertical launch left it a normal launcher';
      kit.advance(0.5);
      if (v.main.y > 0.3 || v.main.y < 0.05) return `as a vertical cell it rests at ${v.main.y.toFixed(2)} m (its box is 5 px tall)`;
      if (!v.contextActions().find((c) => c.label === 'Vertical launch')?.checked) return 'its menu doesn\'t tick Vertical launch';
      const kinds = () => game.entities.filter((e) => !e.destroyed).map((e) => `${e.def.id}:${(e as GuidedLauncher).vertical ? 'v' : 'n'}`).sort().join(' ');
      const before = kinds();
      loadFromString(game, saveToString(game));
      if (kinds() !== before) return `saved and loaded: ${kinds()}, not ${before}`;
      controls.undo();
      if (kinds() !== 'guided-launcher:n spike-launcher:n') return `undone: ${kinds()}`;
      controls.redo();
      if (kinds() !== before) return `redone: ${kinds()}, not ${before}`;
      return true;
    }],
    ['extra: missiles: an M113 on a team fires missiles that find an enemy tank and hurt it; off a team, F fires one that follows the cursor', () => tidy(() => {
      kit.reset();
      const m = kit.spawn('m113', -14, 1.5) as MissileCarrier;
      const foe = kit.spawn('tank-abrams', 14, 1.5, { flip: true }) as Tank;
      kit.advance(1);
      // (the tank held still, so it doesn't fight back)
      foe.setFrozen(true);
      foe.setTeam('blue');
      m.setTeam('red');
      const hp0 = foe.body.hp;
      fly(4, null);
      if (m.foe !== foe) return `on a team, it's after ${m.foe?.def.id ?? 'nothing'}`;
      if (!m.shots) return 'on a team, its crew fired nothing in 4 s';
      if (foe.body.hp > hp0 - 15) return `${m.shots} missiles fired, the tank's hull went from ${hp0.toFixed(0)} to ${foe.body.hp.toFixed(0)} hp`;
      // off the team: F (it selected, the cursor on the tank) fires a missile that goes where the cursor is
      m.setTeam(null);
      fly(m.reloadT + 0.1, null);
      const shots = m.shots;
      controls.selection = new Set([m]);
      kit.view(0, 3, 30);
      kit.move(foe.body.x, foe.body.y);
      kit.view(0, 3, 30);
      kit.key('KeyF', true);
      kit.key('KeyF', false);
      if (m.shots !== shots + 1) return `F with it selected off a team fired ${m.shots - shots} missiles`;
      const s = flying('missile-guided');
      if (!s || s.guide.kind !== 'cursor') return `what it fired is ${s ? `guided by ${s.guide.kind}` : 'gone'}`;
      const up = { x: m.body.x + 3, y: 9 };
      let top = 0;
      fly(1.2, up, () => {
        top = Math.max(top, s.main.y);
      });
      if (top < 6) return `steered at a point 9 m up, it got only ${top.toFixed(1)} m high`;
      return true;
    })],
    ['extra: missiles: the Spike\'s seeker tracks everything in its square and locks the target nearest the middle (not a wall nearer still); when that leaves the square it drops it and locks the next nearest', () => tidy(() => {
      kit.reset();
      const L = kit.spawn('spike-launcher', -16, 0.4) as SpikeLauncher;
      const a = human(-1.4);
      const b = human(2.6);
      const c = human(4.1);
      wall(0.6, 1.6);
      kit.advance(1);
      for (const h of [a, b, c]) h.setFrozen(true);
      // (the square: 56 screen px each way from the cursor, 4.7 m at this zoom)
      r.zoom = r.targetZoom = 12;
      const at = { x: 0, y: 1 };
      L.setActiveHeld(true);
      fly(0.2, at);
      const ids = (L.tracked as { entity: Entity | null }[]).map((s) => (s.entity === a ? 'a' : s.entity === b ? 'b' : s.entity === c ? 'c' : s.entity?.def.id ?? 'ground'));
      if (ids.slice(0, 3).join() !== 'a,b,c') return `in its square it tracks ${ids.join(', ')} (targets nearest the middle first: a, b, c)`;
      if (!ids.includes('concrete-block')) return `the wall in the square isn't tracked (${ids.join(', ')})`;
      if (L.sighted?.entity !== a) return `the gate is on ${L.sighted?.entity?.def.id ?? 'nothing'}, not the person nearest the middle`;
      fly(0.7, at);
      if (L.lock?.entity !== a) return `after 0.9 s it has locked on ${L.lock?.entity === b ? 'the second nearest' : L.lock?.entity?.def.id ?? 'nothing'}, not the nearest`;
      const ac = a.center();
      if (Math.abs(L.lock.at.x - ac.x) > 0.6) return `locked on the nearest, the gate is at x ${L.lock.at.x.toFixed(2)}, not on them (at ${ac.x.toFixed(2)})`;
      // the cursor moves on: the locked one is out of the square, the third the nearest now
      const on = { x: 4.6, y: 1 };
      fly(0.05, on);
      if (L.lock?.entity === a) return 'the locked target left the square, and the lock held';
      if (L.sighted?.entity !== c) return `the target out of the square, the gate went to ${L.sighted?.entity === b ? 'the second' : L.sighted?.entity?.def.id ?? 'nothing'}, not the nearest now`;
      fly(0.8, on);
      if (L.lock?.entity !== c) return `0.8 s on, it's locked on ${L.lock?.entity?.def.id ?? 'nothing'}, not the nearest in the square`;
      L.setActiveHeld(false);
      if (L.shots !== 1) return `let go of, locked, it fired ${L.shots}`;
      return true;
    })],
    ['extra: missiles: burnt out, a missile glides on, falling but still turning toward its target (one with nothing to steer for falls away)', () => {
      kit.reset();
      // (straight ahead while its motor burns; then, burnt out, up and ahead)
      const aim = { x: -4, y: 16 };
      const go = (y: number, guide: Guide): Missile => {
        const m = kit.spawn('missile-guided', -24, y, { angle: 0 }) as Missile;
        m.launch([], 0, 24, false, guide);
        return m;
      };
      const g = go(16, { kind: 'target', entity: null, part: null, local: { x: 0, y: 0 }, at: { ...aim } });
      const n = go(30, { kind: 'none' });
      fly(0.15, null);
      if (g.phase !== 'boost' || n.phase !== 'boost') return `0.15 s after launch they're not under their motors (${g.phase}, ${n.phase})`;
      g.burn = n.burn = 0.001;
      fly(0.05, null);
      // (read afresh: the steps since changed it)
      const phase: string = g.phase;
      if (phase !== 'coast') return `its motor burnt out, it's in ${phase}`;
      const angle = (m: Missile) => {
        const v = m.main.body.linvel();
        return Math.atan2(v.y, v.x);
      };
      if (g.guide.kind === 'target') g.guide.at = { x: aim.x, y: aim.y + 5 };
      const way0 = Math.atan2(aim.y + 5 - g.main.y, aim.x - g.main.x);
      fly(0.8, null);
      if (g.destroyed || n.destroyed) return 'a missile went off in the sky';
      const gw = angle(g);
      const nw = angle(n);
      const v = g.main.body.linvel();
      if (gw < nw + 0.3) return `burnt out, the guided one's way is ${gw.toFixed(2)} rad, the unguided's ${nw.toFixed(2)}: it didn't turn toward its target (${way0.toFixed(2)} rad off)`;
      if (Math.hypot(v.x, v.y) > 23.5) return `gliding, it's still going ${Math.hypot(v.x, v.y).toFixed(1)} m/s: the air doesn't slow it`;
      if (nw > -0.3) return `the one with nothing to steer for isn't falling away (its way ${nw.toFixed(2)} rad)`;
      return true;
    }],
    ['extra: missiles: a cruise missile\'s motor burns four times as long as the standard one\'s, and its blast does at least twice the harm', () => {
      kit.reset();
      // each sent after a point in the sky it circles round, until its motor burns out
      const go = (id: string, x: number): Missile => {
        const m = kit.spawn(id, x, 20, { angle: Math.PI / 2 }) as Missile;
        m.launch([], Math.PI / 2, 11, false, { kind: 'target', entity: null, part: null, local: { x: 0, y: 0 }, at: { x, y: 28 } });
        return m;
      };
      const s = go('missile-guided', -30);
      const k = go('missile-guided-cruise', 30);
      const lit: Record<string, number> = {};
      const out: Record<string, number> = {};
      let t = 0;
      fly(40, null, () => {
        t += game.stepDt;
        for (const [name, m] of [['s', s], ['k', k]] as const) {
          if (m.phase === 'boost' && lit[name] === undefined) lit[name] = t;
          if (m.phase === 'coast' && lit[name] !== undefined && out[name] === undefined) out[name] = t;
        }
        return out.s !== undefined && out.k !== undefined;
      });
      if (out.s === undefined || out.k === undefined) return `motors still burning after 40 s (standard ${s.phase}, cruise ${k.phase}${k.destroyed ? ', gone' : ''})`;
      const bs = out.s - lit.s;
      const bk = out.k - lit.k;
      if (Math.abs(bk / bs - 4) > 0.1) return `the standard motor burnt ${bs.toFixed(1)} s, the cruise ${bk.toFixed(1)} s (${(bk / bs).toFixed(2)} times)`;
      // the blast, a metre and a half over a tank held still (no jet: it struck nothing)
      kit.reset();
      const harm = (id: string, x: number): number => {
        const tank = kit.spawn('tank-abrams', x, 1.5) as Tank;
        kit.advance(1);
        tank.setFrozen(true);
        const hp = tank.body.hp;
        const m = kit.spawn(id, tank.body.x, tank.body.y + 2.2) as Missile;
        m.detonate();
        kit.advance(0.3);
        return hp - tank.body.hp;
      };
      const ws = s.spec.warhead;
      const wk = k.spec.warhead;
      if (wk.power !== ws.power * 2 || wk.damage !== ws.damage * 2 || wk.jet !== ws.jet * 2) return `the cruise warhead's power ${wk.power}, damage ${wk.damage}, jet ${wk.jet}: not twice the standard's (${ws.power}, ${ws.damage}, ${ws.jet})`;
      const hs = harm('missile-guided', -20);
      const hk = harm('missile-guided-cruise', 20);
      if (hs <= 0.5) return `the standard blast did the tank no harm (${hs.toFixed(1)} hp)`;
      if (hk < hs * 2) return `the cruise blast took ${hk.toFixed(1)} hp off a tank, the standard ${hs.toFixed(1)}: not twice as much`;
      return true;
    }],
    ['extra: missiles: a Strike sends out five small missiles that never touch one another, spread round the cursor, and they wreck the car there', () => {
      kit.reset();
      const L = kit.spawn('guided-launcher', -12, 0.4) as GuidedLauncher;
      const car = kit.spawn('car', 7, 0.8) as Car;
      kit.advance(1);
      const pick = L.contextActions().find((a) => a.label === 'Missile: Strike (5)');
      if (!pick) return `no Strike in its menu (${L.contextActions().map((a) => a.label).join(', ')})`;
      pick.action();
      if (L.version !== 'strike') return `picked Strike, it fires ${L.version}`;
      const at = { x: car.body.x, y: car.body.y + 0.3 };
      game.cursor = at;
      L.activate();
      const strike = () => game.entities.filter((e) => e.def.id === 'missile-guided-strike' && !e.destroyed) as Missile[];
      const five = strike();
      if (five.length !== STRIKE_COUNT) return `one launch sent out ${five.length} missiles`;
      if (L.shots !== 1) return `one launch counted ${L.shots} shots`;
      const last = new Map<Missile, V2>();
      let apart = 0;
      let wrongSet = '';
      fly(4, at, () => {
        const up = strike();
        for (const m of up) last.set(m, { x: m.main.x, y: m.main.y });
        if (up.length === STRIKE_COUNT && game.time > 0) {
          for (const m of up) {
            const others = up.filter((o) => o !== m).map((o) => o.main);
            if (!wrongSet && others.some((o) => !m.main.noCollide?.has(o))) wrongSet = `a missile ${m.age.toFixed(2)} s out would touch another of its five`;
          }
          for (const m of up) for (const o of up) apart = Math.max(apart, Math.hypot(m.main.x - o.main.x, m.main.y - o.main.y));
        }
        return up.length === 0;
      });
      if (wrongSet) return wrongSet;
      if (strike().length) return `${strike().length} of the five still flying 4 s on`;
      if (apart < 0.6) return `the five flew as one (at most ${apart.toFixed(2)} m apart)`;
      const far = [...last.values()].map((p) => Math.hypot(p.x - at.x, p.y - at.y)).filter((d) => d > 3.2);
      if (far.length) return `${far.length} of the five went off away from the cursor (${far.map((d) => d.toFixed(1)).join(', ')} m)`;
      kit.advance(0.1);
      if (!car.wrecked) return `the car under the cursor isn't wrecked (hp ${car.body.hp.toFixed(0)})`;
      return true;
    }],
    ['extra: missiles: a Spike Strike out of a vertical cell sends its five after the locked target and the other in the square (three and two), and wrecks both', () => tidy(() => {
      kit.reset();
      const L = kit.spawn('spike-launcher', -12, 0.2, { config: { vertical: true, missile: 'strike' } }) as SpikeLauncher;
      const near = kit.spawn('car', 5, 0.8) as Car;
      const other = kit.spawn('car', 10.5, 0.8) as Car;
      kit.advance(1);
      if (!L.vertical || L.version !== 'strike') return `spawned vertical with Strike, it's ${L.vertical ? 'vertical' : 'a tube'} firing ${L.version}`;
      r.zoom = r.targetZoom = 10;
      const at = { x: near.body.x, y: near.body.y + 0.2 };
      L.setActiveHeld(true);
      fly(0.9, at);
      if (L.lock?.entity !== near) return `locked on ${L.lock?.entity === other ? 'the further car' : L.lock?.entity?.def.id ?? 'nothing'}`;
      if (!L.tracked.some((s) => s.entity === other)) return 'the second car in the square isn\'t tracked';
      L.setActiveHeld(false);
      const five = game.entities.filter((e) => e.def.id === 'missile-spike-strike' && !e.destroyed) as Missile[];
      if (five.length !== STRIKE_COUNT) return `letting go sent out ${five.length} missiles`;
      const after = (e: Entity) => five.filter((m) => m.guide.kind === 'target' && m.guide.entity === e).length;
      if (after(near) !== 3 || after(other) !== 2) return `${after(near)} went after the locked car, ${after(other)} after the other`;
      fly(5, null, () => !game.entities.some((e) => e.def.id === 'missile-spike-strike' && !e.destroyed));
      kit.advance(0.1);
      if (!near.wrecked || !other.wrecked) return `the locked car is ${near.wrecked ? '' : 'not '}wrecked, the other ${other.wrecked ? '' : 'not '}wrecked`;
      return true;
    })],
    ['extra: missiles: the missile picked in a launcher\'s or an M113\'s menu survives save and load, and undo; a Strike\'s vertical cell keeps it when made a tube', () => {
      kit.reset();
      const g = kit.spawn('guided-launcher', -6, 0.4) as GuidedLauncher;
      const s = kit.spawn('spike-launcher', -2, 0.2, { config: { vertical: true } }) as GuidedLauncher;
      const m = kit.spawn('m113', 6, 1.5) as MissileCarrier;
      kit.advance(1);
      controls.history.clear();
      controls.history.record('Missile');
      const menu = (e: { contextActions(): { label: string; action(): void; checked?: boolean }[] }, label: string) => e.contextActions().find((a) => a.label === label);
      menu(g, 'Missile: Cruise')?.action();
      menu(s, 'Missile: Strike (5)')?.action();
      menu(m, 'Missile: Strike (5)')?.action();
      const read = () => {
        const one = (id: string) => game.entities.find((e) => e.def.id === id && !e.destroyed) as (Entity & { version?: string; vertical?: boolean }) | undefined;
        return ['guided-launcher', 'spike-launcher', 'm113'].map((id) => `${id}:${one(id)?.version}${one(id)?.vertical ? ':v' : ''}`).join(' ');
      };
      const want = 'guided-launcher:cruise spike-launcher:strike:v m113:strike';
      if (read() !== want) return `picked in their menus: ${read()}`;
      if (!menu(g, 'Missile: Cruise')?.checked) return 'the launcher\'s menu doesn\'t tick Missile: Cruise';
      loadFromString(game, saveToString(game));
      if (read() !== want) return `saved and loaded: ${read()}`;
      controls.undo();
      if (read() !== 'guided-launcher:standard spike-launcher:standard:v m113:standard') return `undone: ${read()}`;
      controls.redo();
      if (read() !== want) return `redone: ${read()}`;
      const v = game.entities.find((e) => e.def.id === 'spike-launcher' && !e.destroyed) as GuidedLauncher;
      v.setVertical(false);
      const t = game.entities.find((e) => e.def.id === 'spike-launcher' && !e.destroyed) as GuidedLauncher;
      if (t.vertical || t.version !== 'strike') return `made a tube, it's ${t.vertical ? 'still vertical' : 'a tube'} firing ${t.version}`;
      return true;
    }],
  ];
}

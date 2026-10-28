import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Tank } from '../../entities/Tank';
import type { Entity } from '../../world/Entity';
import type { V2 } from '../../engine/math';
import type { GuidedLauncher, Missile, SpikeLauncher } from '../../entities/Missiles';
import type { MissileCarrier } from '../../entities/M113';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** The guided missiles: the mouse-guided launcher, the Spike LR-II, vertical launch and the M113 missile carrier. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
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
  ];
}

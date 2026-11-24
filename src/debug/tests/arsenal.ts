import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Missile, SpikeLauncher, GuidedLauncher } from '../../entities/Missiles';
import type { Radar, RadarLauncher } from '../../entities/Radar';
import type { RotaryCannon, RocketPod } from '../../entities/Combat';
import type { Aircraft } from '../../entities/Planes';
import { ICBM_COUNT } from '../../entities/Missiles';
import { ITEMS, getItem } from '../../catalog/items';
import { WORLD_MAP } from '../../world/Maps';
import { battleTanks } from '../../ui/ArmyPanel';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/**
 * The 0.5.0 arsenal: the Ballistic and ICBM missiles, the heat-seeker launcher, the radar
 * and its radar-guided launcher, the T-90A, the rotary cannon, the rocket pod and the warbirds.
 */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const r = game.renderer;
  /** The World map, the camera at its start. */
  const world = () => {
    kit.reset();
    game.setMap(WORLD_MAP);
    r.camX = -game.origin.x;
    r.camY = 20;
    kit.advance(0);
  };
  /** Where the ground is at `x` m east of the World's start (local x), and that local x. */
  const at = (dx: number) => {
    const x = dx - game.origin.x;
    return { x, y: game.env.groundAt(x, 1e6) };
  };
  const onGround = (id: string, dx: number, opts?: Parameters<typeof kit.spawn>[3]) => {
    const g = at(dx);
    return kit.spawn(id, g.x, g.y + (getItem(id)?.halfHeight ?? 0.5) + 0.05, opts);
  };
  /** Steps `s` seconds, calling `each` first every step; stops when it returns true. */
  const run = (s: number, each?: () => boolean | void) => {
    const n = Math.round(s / game.stepDt);
    for (let i = 0; i < n; i++) {
      if (each?.()) return;
      game.step();
    }
  };
  const cruise = (m: Missile) => m.spec.cruise;
  const flyingNow = (pre: string) => game.entities.filter((e) => e.def.id.startsWith(pre) && !e.destroyed) as Missile[];
  const tidy = <T>(fn: () => T): T => {
    try {
      return fn();
    } finally {
      kit.key('KeyF', false);
      controls.releaseActivation();
      controls.clearSelection();
    }
  };

  return [
    ['arsenal: Ballistic and ICBM are in a launcher\'s menu; the Ballistic flies twice the standard\'s speed, the ICBM three times', () => {
      kit.reset();
      const L = kit.spawn('guided-launcher', -12, 0.4) as GuidedLauncher;
      kit.advance(0.5);
      const labels = L.contextActions().map((a) => a.label);
      for (const want of ['Missile: Ballistic', 'Missile: ICBM (3)']) if (!labels.includes(want)) return `no ${want} in its menu (${labels.join(', ')})`;
      const std = getItem('missile-guided');
      const bal = getItem('missile-guided-ballistic');
      const icbm = getItem('missile-guided-icbm');
      if (!std || !bal || !icbm) return 'the Ballistic or ICBM missile isn\'t in the catalog';
      const made = [std, bal, icbm].map((d, i) => kit.spawn(d.id, -10 + i * 4, 5) as Missile);
      const [s, b, c] = made.map(cruise);
      if (Math.abs(b / s - 2) > 0.01) return `Ballistic cruises at ${b} m/s, the standard ${s}: not twice`;
      if (Math.abs(c / s - 3) > 0.01) return `ICBM cruises at ${c} m/s, the standard ${s}: not three times`;
      return true;
    }],
    ['arsenal: a Spike ICBM launch sends out three missiles that never touch one another, and they wreck three cars 180 m off', () => tidy(() => {
      world();
      const L = onGround('spike-launcher', -150, { config: { missile: 'icbm' } }) as SpikeLauncher;
      const cars = [30, 36, 42].map((d) => onGround('car', d) as Car);
      kit.advance(0.5);
      if (L.version !== 'icbm') return `spawned with ICBM, it fires ${L.version}`;
      L.fire(cars.map((c) => ({ kind: 'target' as const, entity: c, part: null, local: { x: 0, y: 0 }, at: c.center() })));
      const three = flyingNow('missile-spike-icbm');
      if (three.length !== ICBM_COUNT) return `one launch sent out ${three.length} missiles`;
      let touching = '';
      let top = 0;
      run(16, () => {
        const up = flyingNow('missile-spike-icbm');
        for (const m of up) {
          if (!touching && up.some((o) => o !== m && !m.main.noCollide?.has(o.main))) touching = `a missile ${m.age.toFixed(2)} s out would touch another of its three`;
          top = Math.max(top, Math.hypot(m.main.vx, m.main.vy));
        }
        if (up.length) {
          r.camX = up[0].main.x;
          r.camY = up[0].main.y;
        }
        return up.length === 0 && game.time > 0.5;
      });
      if (touching) return touching;
      if (top < cruise(three[0]) * 0.6) return `the ICBMs got up to only ${top.toFixed(0)} m/s (cruise ${cruise(three[0])})`;
      kit.advance(0.2);
      const left = cars.filter((c) => !c.wrecked && !c.destroyed).length;
      if (left) return `${left} of the three cars not wrecked`;
      return true;
    })],
    ['arsenal: a Ballistic missile arcs high on its way and wrecks the car it was sent at', () => tidy(() => {
      world();
      const L = onGround('spike-launcher', -150, { config: { missile: 'ballistic' } }) as SpikeLauncher;
      const car = onGround('car', 30) as Car;
      kit.advance(0.5);
      const gy = at(-150).y;
      L.fire([{ kind: 'target', entity: car, part: null, local: { x: 0, y: 0 }, at: car.center() }]);
      const m = flyingNow('missile-spike-ballistic')[0];
      if (!m) return 'nothing fired';
      let top = -Infinity;
      run(14, () => {
        if (m.destroyed) return true;
        top = Math.max(top, m.main.y - gy);
        r.camX = m.main.x;
        r.camY = m.main.y;
      });
      if (top < 25) return `it went only ${top.toFixed(0)} m up on a 180 m shot`;
      kit.advance(0.2);
      if (!car.wrecked && !car.destroyed) return `the car isn't wrecked (hp ${car.body.hp.toFixed(0)})`;
      return true;
    })],
    ['arsenal: the heat-seeker launcher fires at nothing in particular, and its missile goes after a lit thruster and goes off by it', () => tidy(() => {
      kit.reset();
      const L = kit.spawn('heat-launcher', -20, (getItem('heat-launcher')?.halfHeight ?? 0.5) + 0.05);
      const post = kit.spawn('metal-box', 10, 25);
      const hot = kit.spawn('thruster', 10, 25.8, { angle: Math.PI / 2 });
      kit.advance(0.3);
      post.parts[0].setFrozen(true);
      game.connections.create('weld', post.parts[0], { x: 10, y: 25.45 }, hot.parts[0], { x: 10, y: 25.45 });
      hot.activate();
      kit.advance(0.3);
      L.activate();
      const m = flyingNow('missile-heat')[0];
      if (!m) return 'nothing fired';
      if (!m.heatSeek) return 'its missile doesn\'t seek heat';
      let after = '';
      let closest = Infinity;
      let t = 0;
      run(4, () => {
        t += game.stepDt;
        if (m.destroyed) return true;
        if (t > 0.5 && !after) after = m.guide.kind === 'target' ? m.guide.entity?.def.id ?? '?' : m.guide.kind;
        closest = Math.min(closest, Math.hypot(m.main.x - hot.parts[0].x, m.main.y - hot.parts[0].y));
      });
      if (after !== 'thruster') return `half a second out it was after ${after || 'nothing'}`;
      if (!m.destroyed) return 'still flying 4 s on';
      if (closest > 4) return `it came no nearer the thruster than ${closest.toFixed(1)} m`;
      return true;
    })],
    ['arsenal: a radar, selected, F held on a passing plane, locks it in about a second and keeps it when F is let go; its readout shows it', () => tidy(() => {
      world();
      const radar = onGround('radar', 0) as Radar;
      const g = at(-250);
      const ces = kit.spawn('cessna-172', g.x, g.y + 120) as Aircraft;
      const hold = () => {
        for (const p of ces.parts) {
          p.body.setLinvel({ x: 50, y: 0 }, true);
          p.body.setGravityScale(0, true);
        }
      };
      kit.advance(0.3);
      controls.selection = new Set([radar]);
      kit.view(radar.parts[0].x, radar.parts[0].y + 60, 3);
      kit.key('KeyF', true);
      let lockAt = -1;
      let t = 0;
      let flashed = false;
      run(2.5, () => {
        hold();
        game.cursor = { x: ces.parts[0].x, y: ces.parts[0].y };
        if (radar.candidate === ces) flashed = true;
        t += game.stepDt;
        if (radar.lock && lockAt < 0) lockAt = t;
        return lockAt >= 0;
      });
      if (!flashed) return 'it never began locking the plane';
      if (radar.lock !== ces) return `locked ${radar.lock?.def.id ?? 'nothing'} in 2.5 s`;
      if (lockAt < 0.5 || lockAt > 1.8) return `locked after ${lockAt.toFixed(2)} s`;
      kit.key('KeyF', false);
      run(0.5, hold);
      if (radar.lock !== ces) return 'it let go of the lock with F';
      const tele = radar.telemetry();
      if (!tele) return 'no telemetry with a lock';
      if (Math.abs(tele.speed - 50) > 5) return `the readout says ${tele.speed.toFixed(0)} m/s for a plane at 50`;
      if (tele.height < 100 || tele.height > 140) return `the readout says ${tele.height.toFixed(0)} m up for a plane 120 m up`;
      r.camX = radar.parts[0].x;
      r.camY = radar.parts[0].y + 60;
      game.renderFrame(1 / 60, 1);
      const tag = document.querySelector('.radar-tag') as HTMLElement | null;
      if (!tag || tag.style.display === 'none' || !/LOCK/.test(tag.textContent ?? '')) return `no LOCK readout drawn (${tag?.textContent ?? 'none'})`;
      return true;
    })],
    ['arsenal: a radar-guided launcher wired to a radar fires on the radar\'s lock, and its missile takes down the plane', () => tidy(() => {
      world();
      const radar = onGround('radar', 0) as Radar;
      const L = onGround('radar-launcher', 5, { config: { vertical: true } }) as RadarLauncher;
      kit.advance(0.5);
      game.connections.create('wire', radar.parts[0], radar.parts[0].pixelToWorld(5, 60), L.parts[0], { x: L.parts[0].x, y: L.parts[0].y }, 12);
      const g = at(-250);
      const ces = kit.spawn('cessna-172', g.x, g.y + 120) as Aircraft;
      const hold = () => {
        for (const p of ces.parts) {
          if (p.destroyed) continue;
          p.body.setLinvel({ x: 50, y: 0 }, true);
          p.body.setGravityScale(0, true);
        }
      };
      kit.advance(0.05);
      // fired with nothing locked: it doesn't guide
      controls.selection = new Set([radar]);
      kit.view(radar.parts[0].x, radar.parts[0].y + 60, 3);
      kit.key('KeyF', true);
      run(2, () => {
        hold();
        game.cursor = { x: ces.parts[0].x, y: ces.parts[0].y };
        return !!radar.lock;
      });
      kit.key('KeyF', false);
      if (radar.lock !== ces) return 'the radar didn\'t lock the plane';
      controls.clearSelection();
      L.activate();
      const m = flyingNow('missile-radar')[0];
      if (!m) return 'the launcher fired nothing';
      if (m.guide.kind !== 'radar') return `its missile is guided by ${m.guide.kind}, not the radar`;
      run(10, () => {
        if (!ces.destroyed && !ces.wrecked) hold();
        r.camX = ces.parts[0].x;
        r.camY = ces.parts[0].y;
        return m.destroyed;
      });
      kit.advance(0.2);
      if (!ces.wrecked && !ces.destroyed) return `the plane flew on (the missile ${m.destroyed ? 'went off' : 'still flying'})`;
      return true;
    })],
    ['arsenal: (0.5.1) a radar-guided Ballistic, and an ICBM, wreck a car 120 m off (they overshot it into the ground)', () => tidy(() => {
      for (const v of ['ballistic', 'icbm']) {
        world();
        const L = onGround('radar-launcher', 0, { config: { missile: v } }) as RadarLauncher;
        const car = onGround('car', 120) as Car;
        kit.advance(0.5);
        // (a radar's lock on the car, without the radar)
        L.fire({ kind: 'radar', radar: { destroyed: false, lockPoint: () => car.center(), lockEntity: () => car } });
        const ms = flyingNow(`missile-radar-${v}`);
        if (!ms.length) return `the ${v} launcher fired nothing`;
        run(6, () => {
          const up = ms.filter((m) => !m.destroyed);
          if (up.length) {
            r.camX = up[0].main.x;
            r.camY = up[0].main.y;
          }
          return !up.length;
        });
        kit.advance(0.2);
        if (!car.wrecked && !car.destroyed) return `the ${v} missiles missed the car (hp ${car.body.hp.toFixed(0)})`;
      }
      return true;
    })],
    ['arsenal: (0.5.1) a radar\'s lock survives save and load, and undo', () => tidy(() => {
      kit.reset();
      const radar = kit.spawn('radar', -10, (getItem('radar')?.halfHeight ?? 1) + 0.05) as Radar;
      const car = kit.spawn('car', 15, 0.8) as Car;
      kit.advance(0.5);
      controls.selection = new Set([radar]);
      kit.view(0, 5, 20);
      kit.key('KeyF', true);
      run(2, () => {
        game.cursor = car.center();
        return !!radar.lock;
      });
      kit.key('KeyF', false);
      controls.clearSelection();
      if (radar.lock !== car) return 'the radar didn\'t lock the car';
      const locked = () => {
        const rd = game.entities.find((e) => e.def.id === 'radar' && !e.destroyed) as Radar | undefined;
        return rd?.lockEntity()?.def.id ?? 'nothing';
      };
      loadFromString(game, saveToString(game));
      kit.advance(0.3);
      if (locked() !== 'car') return `saved and loaded, it's locked on ${locked()}`;
      controls.history.clear();
      controls.history.record('Box');
      kit.spawn('metal-box', 0, 3);
      kit.advance(0.1);
      controls.undo();
      kit.advance(0.3);
      if (locked() !== 'car') return `undone, it's locked on ${locked()}`;
      return true;
    })],
    ['arsenal: the T-90A is a tank a side can bring', () => {
      if (!getItem('tank-t90a')) return 'no T-90A in the catalog';
      if (!battleTanks().some((d) => d.id === 'tank-t90a')) return 'not among the tanks an army can bring';
      return true;
    }],
    ['arsenal: the rotary cannon spins up and pours rounds into a car till it\'s wrecked; the rocket pod ripples rockets that wreck another', () => {
      kit.reset();
      const gun = kit.spawn('rotary-cannon', -20, 0.4) as RotaryCannon;
      const car = kit.spawn('car', 0, 0.8) as Car;
      kit.advance(0.4);
      gun.parts[0].setFrozen(true);
      gun.setActiveHeld(true);
      kit.advance(0.2);
      const early = gun.rounds;
      kit.advance(2);
      gun.setActiveHeld(false);
      const fired = 500 - gun.rounds;
      if (fired < 100) return `fired only ${fired} rounds in 2.2 s`;
      if (500 - early > fired / 4) return `it fired ${500 - early} of them in the first 0.2 s: no spin-up`;
      kit.advance(0.5);
      if (!car.wrecked && !car.destroyed) return `the car under its fire isn't wrecked (hp ${car.body.hp.toFixed(0)})`;
      kit.reset();
      const pod = kit.spawn('rocket-pod', -30, 1.4) as RocketPod;
      const car2 = kit.spawn('car', 10, 0.8) as Car;
      kit.advance(0.4);
      pod.parts[0].setFrozen(true);
      const before = pod.rounds;
      pod.setActiveHeld(true);
      kit.advance(1.2);
      pod.setActiveHeld(false);
      if (before - pod.rounds < 6) return `held F for 1.2 s, it rippled off ${before - pod.rounds} rockets`;
      kit.advance(2);
      if (!car2.wrecked && !car2.destroyed) return `the car in front isn't wrecked (hp ${car2.body.hp.toFixed(0)})`;
      return true;
    }],
    ['arsenal: the three warbirds stand on their tailwheels, take off, climb, and let go their rockets and bombs without harming themselves', () => {
      const ids = ITEMS.filter((i) => i.group === 'Airplane · Warbirds').map((i) => i.id);
      for (const id of ['p-51d', 'fw-190', 'yak-9k']) if (!ids.includes(id)) return `no ${id} among the warbirds (${ids.join(', ')})`;
      for (const id of ids) {
        world();
        const e = onGround(id, -150) as Aircraft;
        kit.advance(1);
        const b = e.parts[0];
        if (e.wrecked || e.destroyed) return `${id} broke standing`;
        e.on = true;
        e.T = 1;
        const x0 = b.x;
        let off = -1;
        const theta = 13.5 * (Math.PI / 180);
        let t = 0;
        let released = 0;
        const hurt: string[] = [];
        const od = e.damage.bind(e);
        e.damage = (p, amount, kind, where, dir) => {
          if (amount > 5 && t > 42) hurt.push(`${kind} ${amount.toFixed(0)}`);
          return od(p, amount, kind, where, dir);
        };
        let alt = 0;
        run(48, () => {
          t += game.stepDt;
          if (b.destroyed) return true;
          r.camX = b.x;
          r.camY = b.y;
          const v = Math.hypot(b.vx, b.vy);
          alt = b.y - game.env.groundAt(b.x, 1e6);
          const datum = b.bodyAngle + theta;
          const want = (!e.flying ? (v < 30 ? 0 : 10) : 9) * (Math.PI / 180);
          e.steer(0, 0, datum < want - 0.01 ? 1 : datum > want + 0.01 ? -1 : 0, false, false);
          if (off < 0 && e.flying) off = b.x - x0;
          if (t > 42 && released < 4 && Math.round(t * 120) % 48 === 0) {
            e.pilotCommand('rockets');
            e.pilotCommand('bombs');
            released++;
          }
        });
        e.damage = od;
        if (off < 0) return `${id} never left the ground in 48 s`;
        if (off > 900) return `${id} took ${off.toFixed(0)} m to lift off`;
        if (alt < 80) return `${id} only ${alt.toFixed(0)} m up 48 s after starting its run`;
        if (e.wrecked || e.destroyed) return `${id} wrecked`;
        if (hurt.length) return `${id} hurt letting go its stores: ${hurt.slice(0, 4).join(', ')}`;
        if (e.rocketsLeft >= (e.spec.rockets?.length ?? 0)) return `${id} fired no rocket`;
      }
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Game } from '../../world/Game';
import type { Controls } from '../../tools/Controls';
import type { Session } from '../../net/Session';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { Human } from '../../entities/Human';
import { WORLD_MAP } from '../../world/Maps';
import { rebase } from '../../world/Origin';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** A second game's `window.bp` in an iframe, joining this one (see multiplayer.ts). */
interface Bp {
  game: Game;
  controls: Controls;
  ui: { session: Session };
  selftest?: unknown;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Waits up to `ms` for `fn` to come true (polling); returns whether it did. */
async function until(fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}

/**
 * The World map (0.3.0): endless both ways and up into space, kept near local
 * (0, 0) by a floating origin (see world/Origin), with what's far from every view
 * parked (world/Parking), the air thinning and gravity falling off with height.
 */
export default function tests({ game, kit }: TestCtx): Test[] {
  const r = game.renderer;
  /** The World, the camera at (x, y) (local: the origin's back at 0). */
  const world = (x = 0, y = 2) => {
    kit.reset();
    game.setMap(WORLD_MAP);
    r.camX = x;
    r.camY = y;
    r.zoom = r.targetZoom = 64;
    kit.advance(0);
  };
  /** Where a part truly is (local + origin). */
  const tru = (p: Part) => ({ x: p.x + game.origin.x, y: p.y + game.origin.y });
  /** The camera onto a part (the origin follows it there). */
  const watch = (p: Part) => {
    r.camX = p.x;
    r.camY = p.y;
  };
  /** A frozen plank to stand on, its top at true height y (true x). */
  const ledge = (x: number, y: number): Entity => {
    const e = kit.spawn('plank', x - game.origin.x, y - game.origin.y - 0.1);
    e.setFrozen(true);
    return e;
  };
  /** The camera moved to true (x, y) in hops of at most `hop` m, a step each (as if flown there). */
  const travel = (x: number, y: number, hop = 100) => {
    for (;;) {
      const tx = r.camX + game.origin.x;
      const ty = r.camY + game.origin.y;
      const d = Math.hypot(x - tx, y - ty);
      if (d < 1e-6) break;
      const f = Math.min(1, hop / d);
      r.camX += (x - tx) * f;
      r.camY += (y - ty) * f;
      game.step();
    }
  };
  const fmt = (v: { x: number; y: number }) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)})`;

  return [
    ['extra: world: something flung 4 km at 8 km up goes smoothly all the way, the origin moving under it, and stays near local (0, 0)', () => kit.still(async () => {
      world();
      const c = kit.spawn('crate', 0, 8000);
      const p = c.parts[0];
      watch(p);
      kit.advance(1 / 60);
      p.body.setLinvel({ x: 400, y: 0 }, true);
      const e0 = game.origin.epoch;
      let was = tru(p);
      let worst = 0;
      // (stepped, not drawn: 10 s of frames drawn would take a while in a headless browser)
      game.advance(10, () => {
        const now = tru(p);
        const v = Math.hypot(p.vx, p.vy);
        const d = Math.hypot(now.x - was.x, now.y - was.y);
        // (a jump: much further than it was going)
        worst = Math.max(worst, d - v * game.stepDt);
        was = now;
        watch(p);
      });
      const at = tru(p);
      if (worst > 1) return `its true place jumped ${worst.toFixed(2)} m in a frame`;
      if (game.origin.epoch - e0 < 3) return `the origin moved ${game.origin.epoch - e0} times`;
      if (at.x < 3800 || at.x > 4100) return `it got to true x ${at.x.toFixed(1)} (400 m/s for 10 s)`;
      if (Math.abs(p.x) > 1100 || Math.abs(p.y) > 1100) return `it's at local ${fmt(p)}`;
      return true;
    })],
    ['extra: world: at 20 km things weigh about a third of what they do on the ground and the air is all but gone', () => kit.still(async () => {
      world();
      const c = kit.spawn('crate', 0, 20000);
      const p = c.parts[0];
      watch(p);
      kit.advance(0.1);
      const v0 = p.vy;
      game.advance(0.5, () => watch(p));
      const a = (p.vy - v0) / 0.5;
      const want = -9.81 * (30 / 50) ** 2;
      if (Math.abs(a - want) > 0.4) return `it fell at ${a.toFixed(2)} m/s², not about ${want.toFixed(2)}`;
      const thin = game.air.thinness(p.y);
      if (thin > 1e-6) return `the air's ${thin} of the ground's`;
      const at = tru(p);
      if (Math.abs(at.y - 20000) > 20) return `it's at true height ${at.y.toFixed(1)}`;
      if (Math.abs(p.y) > 1100) return `it's at local y ${p.y.toFixed(1)}`;
      return true;
    })],
    ['extra: world: a person taken 3 km up runs out of breath and passes out; brought down in time, they breathe again', () => kit.still(async () => {
      world();
      travel(0, 3001);
      ledge(0, 3000);
      const h = kit.spawn('human', -game.origin.x, 3000.9 - game.origin.y) as Human;
      game.advance(18, () => watch(h.parts[0]));
      if (!h.alive) return 'they died up there in 18 s';
      if (h.consciousness > 0.2) return `they're still awake (${h.consciousness.toFixed(2)}) after 18 s at 3 km`;
      // down to the ground (the ledge left up there), the view with them
      h.translate(-game.origin.x - h.parts[0].x, game.env.groundAt(-game.origin.x, 1e6) + 1.2 - h.parts[0].y);
      watch(h.parts[0]);
      kit.advance(10);
      if (!h.alive) return 'they died once brought down';
      if (h.breath.faint < 1) return `they're still short of breath (${h.breath.faint.toFixed(2)}) after 10 s on the ground`;
      return true;
    })],
    ['extra: world: saved 5 km up and 3 km out, it loads back just where it was', () => kit.still(async () => {
      world();
      travel(3000, 5001);
      ledge(3000, 5000);
      const c = kit.spawn('crate', 3000 - game.origin.x, 5000.5 - game.origin.y);
      kit.advance(1);
      const before = tru(c.parts[0]);
      const o = { x: game.origin.x, y: game.origin.y };
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      if (!game.map.world) return `it loaded on ${game.map.id}`;
      if (game.origin.x !== o.x || game.origin.y !== o.y) return `the origin's ${fmt(game.origin)}, was ${fmt(o)}`;
      const back = game.entities.find((e) => e.def.id === 'crate' && !e.destroyed);
      if (!back) return 'the crate is gone';
      const at = tru(back.parts[0]);
      if (Math.hypot(at.x - before.x, at.y - before.y) > 0.05) return `the crate's at ${fmt(at)}, was ${fmt(before)}`;
      kit.advance(1);
      const later = tru(back.parts[0]);
      if (Math.abs(later.y - before.y) > 0.1) return `the crate fell to ${fmt(later)}`;
      return true;
    })],
    ['extra: world: what’s left behind is parked when the view goes 3 km off, and comes back just as it was', () => kit.still(async () => {
      world();
      const crate = kit.spawn('crate', 4, 1);
      const hang = kit.spawn('crate', -4, 3);
      kit.advance(0.2);
      game.connections.create('rope', hang.parts[0], { x: hang.parts[0].x, y: hang.parts[0].y + 0.4 }, null, { x: -4, y: 5.5 });
      const h = kit.spawn('human', 0, 1.1) as Human;
      kit.advance(3);
      const before = [crate, hang, h].map((e) => tru(e.parts[0]));
      travel(3000, game.env.groundAt(3000, 1e6) + 3);
      kit.advance(1.2);
      if (!game.parking.list.length) return 'nothing was parked';
      if (game.entities.some((e) => !e.destroyed)) return `${game.entities.filter((e) => !e.destroyed).length} things are still about 3 km off`;
      travel(0, 3);
      kit.advance(1.2);
      if (game.parking.list.length) return `${game.parking.list.length} still parked back home`;
      const crates = game.entities.filter((e) => e.def.id === 'crate' && !e.destroyed);
      const people = game.entities.filter((e) => e.def.id === 'human' && !e.destroyed) as Human[];
      if (crates.length !== 2 || people.length !== 1) return `${crates.length} crates and ${people.length} people came back`;
      const now = [...crates.sort((a, b) => b.parts[0].x - a.parts[0].x), people[0]].map((e) => tru(e.parts[0]));
      for (let i = 0; i < 3; i++) {
        if (Math.hypot(now[i].x - before[i].x, now[i].y - before[i].y) > 0.1) return `thing ${i} came back at ${fmt(now[i])}, was ${fmt(before[i])}`;
      }
      if (game.connections.list.filter((c) => c.kind === 'rope').length !== 1) return 'the rope didn’t come back';
      kit.advance(2);
      if (!people[0].alive || people[0].state !== 'stand') return `the person came back ${people[0].alive ? people[0].state : 'dead'}`;
      return true;
    })],
    ['extra: world: a busy scene shifted under itself again and again carries on as if nothing happened', () => kit.still(async () => {
      world();
      const h = kit.spawn('human', 0, 1.1) as Human;
      const low = kit.spawn('crate', 3, 0.45);
      const top = kit.spawn('crate', 3, 1.4);
      const hang = kit.spawn('crate', -4, 3);
      const car = kit.spawn('car', 9, 1);
      kit.advance(0.2);
      game.connections.create('rope', hang.parts[0], { x: hang.parts[0].x, y: hang.parts[0].y + 0.4 }, null, { x: -4, y: 5.5 });
      kit.advance(2.5);
      const all = [h, low, top, hang, car];
      const before = all.map((e) => tru(e.parts[0]));
      const hops: [number, number][] = [[64, 0], [-128, 64], [192, -64], [-64, 256], [256, -256], [-320, 0], [0, 128], [64, -128]];
      let k = 0;
      game.advance(3, (i) => {
        if (i % 40 === 0) rebase(game, ...hops[k++ % hops.length]);
      });
      kit.advance(0.5);
      const names = ['person', 'lower crate', 'top crate', 'hanging crate', 'car'];
      for (let i = 0; i < all.length; i++) {
        const at = tru(all[i].parts[0]);
        if (Math.hypot(at.x - before[i].x, at.y - before[i].y) > 0.15) return `the ${names[i]} went from ${fmt(before[i])} to ${fmt(at)}`;
      }
      if (!h.alive || h.state !== 'stand') return `the person is ${h.alive ? h.state : 'dead'}`;
      if (top.parts[0].y < low.parts[0].y + 0.5) return 'the stack fell';
      if (game.connections.list.filter((c) => c.kind === 'rope').length !== 1) return 'the rope went';
      const fast = all.flatMap((e) => e.parts).filter((p) => !p.destroyed && Math.hypot(p.vx, p.vy) > 1);
      if (fast.length) return `${fast.length} parts are still moving (${fast[0].entity.def.id} at ${Math.hypot(fast[0].vx, fast[0].vy).toFixed(1)} m/s)`;
      return true;
    })],
    ['extra: world: a balloon let go rises till the air thins at the clouds, and bursts', () => kit.still(async () => {
      world();
      const b = kit.spawn('balloon', 0, 3);
      const p = b.parts[0];
      let top = -Infinity;
      game.advance(240, () => {
        if (b.destroyed || (b as unknown as { popped: boolean }).popped) return;
        top = Math.max(top, tru(p).y);
        watch(p);
      });
      const popped = b.destroyed || (b as unknown as { popped: boolean }).popped;
      if (!popped) return `it's still whole at ${tru(p).y.toFixed(0)} m`;
      if (top < 500 || top > 900) return `it burst at ${top.toFixed(0)} m`;
      return true;
    })],
    ['extra: world: a blast 5 km up throws things less than one on the ground; in the thin air its wave is weaker', () => kit.still(async () => {
      const throwAt = (h: number): number => {
        world();
        if (h > 10) {
          travel(0, h + 1);
          ledge(0, h);
        }
        const c = kit.spawn('crate', 1 - game.origin.x, h + 0.45 - game.origin.y);
        kit.advance(0.3);
        game.explosions.explode(c.parts[0].x - 1.2, c.parts[0].y, { power: 120, radius: 4, damage: 0 });
        game.advance(1 / 30);
        return Math.hypot(c.parts[0].vx, c.parts[0].vy);
      };
      const low = throwAt(0);
      const high = throwAt(5000);
      if (low < 2) return `on the ground it threw the crate at only ${low.toFixed(1)} m/s`;
      if (high > low * 0.45 || high < low * 0.15) return `5 km up it threw it at ${high.toFixed(1)} m/s, on the ground ${low.toFixed(1)}`;
      return true;
    })],
    ['extra: world: a guest follows the host’s origin as it moves, and what they do lands where they meant', () => kit.still(async () => {
      // (a file:// page's iframe guest can't be reached: see multiplayer.ts)
      if (location.protocol === 'file:') return true;
      world();
      const crate = kit.spawn('crate', 4, 1);
      kit.advance(1);
      const frame = document.createElement('iframe');
      frame.src = location.href;
      frame.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:320px;border:0;opacity:0.02;pointer-events:none;z-index:1';
      document.body.appendChild(frame);
      const session = (window as unknown as { bp: Bp }).bp.ui.session;
      try {
        const bp = () => (frame.contentWindow as unknown as { bp?: Bp } | null)?.bp;
        if (!(await until(() => !!bp()?.selftest, 90000))) return 'the second game did not start';
        const g = bp()!;
        const code = await session.hostGame('local', 'Host');
        await g.ui.session.join('local', code, 'Guest');
        if (!(await until(() => (g.ui.session.guest?.you ?? 0) > 0 && session.players.length === 2, 5000))) return 'the guest never got the scene';
        const gg = g.game;
        if (!gg.map.world) return `the guest is on ${gg.map.id}`;
        const theirs = () => gg.entities.find((e) => e.netId === crate.netId && !e.destroyed) ?? null;
        // the host's view goes 1.5 km out and the crate's taken with it: the origin moves
        travel(1500, 3);
        crate.translate(r.camX - crate.parts[0].x, game.env.groundAt(r.camX, 1e6) + 0.6 - crate.parts[0].y);
        kit.advance(0.5);
        session.host!.tick(true);
        if (!(await until(() => gg.origin.x === game.origin.x && gg.origin.y === game.origin.y, 3000))) return `the guest's origin is ${fmt(gg.origin)}, the host's ${fmt(game.origin)}`;
        const near = () => {
          const t = theirs();
          return !!t && Math.hypot(t.parts[0].x - crate.parts[0].x, t.parts[0].y - crate.parts[0].y) < 0.05;
        };
        if (!(await until(near, 3000))) {
          const t = theirs();
          return `the guest's crate is at ${t ? fmt(t.parts[0]) : 'nowhere'}, the host's at ${fmt(crate.parts[0])}`;
        }
        // the host moves on again; before the guest hears of it, they spawn something where they see the crate
        const meant = tru(crate.parts[0]);
        const local = { x: meant.x - gg.origin.x, y: meant.y - gg.origin.y + 2 };
        travel(2600, 3);
        g.controls.net!.send({ op: 'spawn', def: 'brick', x: local.x, y: local.y, left: false, frozen: true });
        if (!(await until(() => game.entities.some((e) => e.def.id === 'brick' && !e.destroyed), 3000))) return 'the guest’s brick never came';
        const brick = game.entities.find((e) => e.def.id === 'brick' && !e.destroyed)!;
        const at = tru(brick.parts[0]);
        if (Math.hypot(at.x - meant.x, at.y - (meant.y + 2)) > 0.05) return `the guest's brick is at true ${fmt(at)}, meant for ${fmt({ x: meant.x, y: meant.y + 2 })}`;
        // and they're told: the same origin again
        session.host!.tick(true);
        if (!(await until(() => gg.origin.x === game.origin.x && gg.origin.y === game.origin.y, 3000))) return `the guest's origin stayed at ${fmt(gg.origin)}, the host's ${fmt(game.origin)}`;
        return true;
      } finally {
        session.leave();
        frame.remove();
      }
    })],
  ];
}

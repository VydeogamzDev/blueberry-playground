import type { Test, TestCtx } from './types';
import type { Game } from '../../world/Game';
import type { Controls } from '../../tools/Controls';
import type { UI } from '../../ui/UI';
import type { Session } from '../../net/Session';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { makeTestKit } from '../testkit';
import type { ItemDef } from '../../world/types';
import { RAPIER } from '../../engine/Physics';
import { builtinMap, LAB } from '../../world/Maps';

/** A game's `window.bp` (see main.ts), with multiplayer (not in the interface yet: these tests aren't run). */
interface Bp {
  game: Game;
  controls: Controls;
  ui: UI & { session: Session };
  kit: ReturnType<typeof makeTestKit>;
  getItem(id: string): ItemDef | undefined;
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
 * Multiplayer between this page (hosting) and a second copy of the game in an
 * iframe (joining), over the in-browser link (BroadcastChannel). The iframe's
 * game runs on its own, as a guest's would; this page's is stepped by hand.
 */
export default function tests(ctx: TestCtx): Test[] {
  // A file:// page is an origin of its own to Chrome, so its iframe guest can't be reached:
  // these pass there and are checked by the dev-server run.
  if (location.protocol === 'file:') return all(ctx).map(([name]) => [name, () => true]);
  return all(ctx);
}

function all({ game, controls, kit, human }: TestCtx): Test[] {
  const bp = () => (window as unknown as { bp: Bp }).bp;
  const session = () => bp().ui.session;
  let frame: HTMLIFrameElement | null = null;

  /** The second game (started once, kept for the following tests). */
  const other = async (): Promise<Bp> => {
    const ready = () => (frame?.contentWindow as unknown as { bp?: Bp & { selftest?: unknown } } | null)?.bp?.selftest;
    if (!ready()) {
      frame?.remove();
      frame = document.createElement('iframe');
      frame.src = location.href;
      frame.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:320px;border:0;opacity:0.02;pointer-events:none;z-index:1';
      document.body.appendChild(frame);
      if (!(await until(() => !!ready(), 90000))) throw new Error('the second game did not start');
    }
    return (frame!.contentWindow as unknown as { bp: Bp }).bp;
  };

  /** Hosts this game and has the other join it; returns the other's bp. */
  const play = async (): Promise<Bp> => {
    const g = await other();
    session().leave();
    g.ui.session.leave();
    const code = await session().hostGame('local', 'Host');
    await g.ui.session.join('local', code, 'Guest');
    if (!(await until(() => (g.ui.session.guest?.you ?? 0) > 0 && session().players.length === 2, 5000))) throw new Error('the guest never got the scene');
    return g;
  };

  const tick = () => session().host!.tick(true);
  const byNet = (g: Game, id: number) => g.entities.find((e) => e.netId === id && !e.destroyed) ?? null;
  const near = (a: number, b: number, d = 0.05) => Math.abs(a - b) < d;
  const kinematic = (e: Entity) => e.parts.every((p) => p.destroyed || p.body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased);

  return [
    ['extra: multiplayer: a guest who joins gets the host’s scene, moved only by the host, following it smoothly', () => kit.still(async () => {
      kit.reset();
      human(-1);
      const crate = kit.spawn('crate', 2, 0.45);
      kit.advance(0.5);
      const g = await play();
      const mine = game.entities.filter((e) => !e.destroyed);
      const theirs = g.game.entities.filter((e) => !e.destroyed);
      if (theirs.length !== mine.length) return `the guest has ${theirs.length} things, the host ${mine.length}`;
      for (const e of mine) {
        const t = byNet(g.game, e.netId);
        if (!t) return `the guest lacks ${e.def.id} (net id ${e.netId})`;
        if (t.def.id !== e.def.id) return `net id ${e.netId} is a ${e.def.id} for the host but a ${t.def.id} for the guest`;
        if (!kinematic(t)) return `the guest's ${t.def.id} isn't kinematic`;
      }
      if (!g.game.net?.guest) return 'the guest game isn’t a guest';
      // "Guest joined" is the host's news, not the guest's
      const toast = (d: Document) => d.querySelector('.toast')?.textContent ?? '';
      if (!toast(document).includes('Guest joined')) return `the host's status bar says "${toast(document)}", not that the guest joined`;
      if (toast(frame!.contentDocument!).includes('joined')) return `the guest was told "${toast(frame!.contentDocument!)}"`;
      // moved on the host: the guest's copy goes there too
      crate.parts[0].teleport(3, 2.5, 0.6);
      kit.advance(1 / 60);
      tick();
      const p = crate.parts[0];
      const q = byNet(g.game, crate.netId)!.parts[0];
      if (!(await until(() => near(q.x, p.x) && near(q.y, p.y) && near(q.a, p.a), 2000))) {
        return `the guest's crate is at (${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.a.toFixed(2)}), the host's at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.a.toFixed(2)})`;
      }
      // a fall on the host is shown as one: it goes through the poses in between
      // (spread over the time between the two ticks: as long as a few real ones)
      await sleep(150);
      kit.advance(0.3);
      tick();
      const ys: number[] = [];
      await until(() => {
        ys.push(q.y);
        return near(q.y, p.y, 0.01);
      }, 2000);
      const between = ys.filter((y) => y < 2.49 && y > p.y + 0.01).length;
      if (!near(q.y, p.y, 0.01)) return `the guest's crate stopped at y ${q.y.toFixed(3)}, not ${p.y.toFixed(3)}`;
      if (between < 2) return `the guest's crate jumped down (seen in between ${between} times)`;
      return true;
    })],
    ['extra: multiplayer: a guest hears the host’s music: the same track, at the same place in it, and keeps it after leaving', () => kit.still(async () => {
      kit.reset();
      const g = await play();
      tick();
      const same = () => {
        const a = game.music.planned;
        const b = g.game.music.planned;
        return !!a && !!b && a.file === b.file && Math.abs(a.pos - b.pos) < 0.3;
      };
      const show = () => `host ${JSON.stringify(game.music.planned)}, guest ${JSON.stringify(g.game.music.planned)}`;
      if (!game.music.planned) return `the host's music has no plan to share: ${show()}`;
      if (!(await until(same, 3000))) return `the guest's music isn't the host's: ${show()}`;
      // still together a moment later (the guest's clock follows the host's)
      await sleep(400);
      tick();
      if (!(await until(same, 1000))) return `400 ms on: ${show()}`;
      g.ui.session.leave();
      await sleep(100);
      if (!same()) return `after leaving, the guest's music jumped: ${show()}`;
      return true;
    })],
    ['extra: multiplayer: a guest’s Break bone, from a limb’s menu, breaks that limb in the host’s game', () => kit.still(async () => {
      kit.reset();
      const h = human(0) as Human;
      kit.advance(0.5);
      const g = await play();
      tick();
      if (!(await until(() => !!byNet(g.game, h.netId), 2000))) return 'the guest never got the person';
      const gh = byNet(g.game, h.netId)! as Human;
      const arm = h.limbs.get('lowerArmF')!;
      const theirArm = gh.parts[h.parts.indexOf(arm.part)];
      (g.controls as unknown as { openMenuFor(p: unknown): void }).openMenuFor(theirArm);
      const doc = frame!.contentDocument!;
      const item = [...doc.querySelectorAll<HTMLElement>('.ctx-item')].find((x) => x.textContent?.includes('Break bone'));
      if (!item) return `the guest's menu for the forearm has no Break bone: ${[...doc.querySelectorAll('.ctx-item')].map((x) => x.textContent).join(', ')}`;
      item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      if (!(await until(() => arm.broken, 2000))) return 'Break bone picked by the guest did not break the host’s forearm';
      if ([...h.limbs.values()].some((l) => l !== arm && l.broken)) return 'another of the host’s limbs broke';
      return true;
    })],
    ['extra: multiplayer: things spawned and removed, limbs lost and effects reach the guest', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const h = human(0) as Human;
      const barrel = kit.spawn('barrel', 3, 0.6);
      kit.advance(0.2);
      tick();
      if (!(await until(() => !!byNet(g.game, barrel.netId) && !!byNet(g.game, h.netId), 2000))) return 'the guest never got the person and barrel spawned after Clear';
      const gh = byNet(g.game, h.netId)!;
      // a forearm comes off
      const arm = h.limbs.get('lowerArmF')!.part;
      const i = h.parts.indexOf(arm);
      h.removePart(arm);
      tick();
      if (!(await until(() => gh.parts[i].destroyed, 2000))) return 'the guest’s person kept the forearm the host’s lost';
      const lost = (e: Entity) => e.parts.filter((p) => p.destroyed).map((p) => p.name).join(', ');
      if (lost(gh) !== lost(h)) return `the guest’s person lost ${lost(gh)}; the host’s ${lost(h)}`;
      // sparks: made there as here
      const n0 = g.game.particles.count;
      game.particles.sparks(1, 1.5, 0, 1, 30);
      tick();
      if (!(await until(() => g.game.particles.count >= n0 + 20, 2000))) return `the host's sparks didn't show for the guest (${g.game.particles.count - n0} particles)`;
      // gone
      controls.deleteEntities([barrel]);
      kit.advance(1 / 60);
      tick();
      if (!(await until(() => !byNet(g.game, barrel.netId), 2000))) return 'the barrel deleted by the host stayed for the guest';
      // the vitals: a person knocked out is knocked out there too
      h.consciousness = 0.05;
      tick();
      if (!(await until(() => (gh as unknown as Human).consciousness < 0.2, 2000))) return 'the guest’s person stayed conscious';
      return true;
    })],
    ['extra: multiplayer: what a guest does (spawn, drag, delete, pause) happens in the host’s game', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      const crate = kit.spawn('crate', 2, 0.45);
      kit.advance(0.3);
      tick();
      if (!(await until(() => !!byNet(g.game, crate.netId), 2000))) return 'the guest never got the crate';
      // spawning: what the guest puts down appears in the host's game
      const n0 = game.entities.length;
      g.controls.arm(g.getItem('barrel') ?? null);
      g.kit.move(-2, 2);
      // the guest's cursor is shown to the host, by name
      if (!(await until(() => session().cursors().some((c) => c.name === 'Guest' && near(c.x, -2, 0.1) && near(c.y, 2, 0.1)), 2000))) {
        return `the host doesn't see the guest's cursor at (-2, 2): ${JSON.stringify(session().cursors())}`;
      }
      g.controls.spawnArmed(false);
      g.controls.arm(null);
      if (!(await until(() => game.entities.length === n0 + 1, 2000))) return 'the barrel the guest spawned never appeared for the host';
      const made = game.entities[game.entities.length - 1];
      if (made.def.id !== 'barrel' || !near(made.parts[0].x, -2, 0.3)) return `the guest's spawn made a ${made.def.id} at x ${made.parts[0].x.toFixed(2)}`;
      // dragging: the guest takes hold of the crate and pulls it up
      const gc = byNet(g.game, crate.netId)!;
      const p = crate.parts[0];
      const x0 = p.x;
      const y0 = p.y;
      g.controls.net!.send({ op: 'grab', p: [crate.netId, 0], x: x0, y: y0, ids: [] });
      g.controls.net!.send({ op: 'drag', x: x0 - 1, y: y0 + 1.5, rot: 0, snap: false });
      await sleep(100);
      kit.advance(1);
      if (!near(p.x, x0 - 1, 0.25) || !near(p.y, y0 + 1.5, 0.25)) return `dragged by the guest to (${(x0 - 1).toFixed(2)}, ${(y0 + 1.5).toFixed(2)}), the crate is at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
      g.controls.net!.send({ op: 'drop', x: x0 - 1, y: y0 + 1.5 });
      await sleep(100);
      kit.advance(1);
      if (p.y > y0 + 0.2) return `let go, the crate stayed up at y ${p.y.toFixed(2)}`;
      // deleting
      g.controls.deleteEntities([gc]);
      if (!(await until(() => crate.destroyed, 2000))) return 'the crate the guest deleted is still there for the host';
      // time is everyone's: the guest pauses it for the host, and sees it paused
      g.controls.togglePause();
      if (!(await until(() => game.paused, 2000))) return 'the guest’s pause didn’t pause the host';
      tick();
      if (!(await until(() => g.game.paused, 2000))) return 'the guest isn’t shown time paused';
      g.controls.togglePause();
      if (!(await until(() => !game.paused, 2000))) return 'the guest couldn’t start time again';
      // undo is the host's
      if (g.controls.history.canUndo) return 'the guest has its own undo history';
      return true;
    })],
    ['extra: multiplayer: the host’s map switch reaches the guest; ground a guest draws is drawn for everyone', () => kit.still(async () => {
      const g = await play();
      controls.switchMap(builtinMap('hills')!);
      kit.spawn('crate', 0, 8);
      tick();
      if (!(await until(() => g.game.map.id === 'hills' && g.game.entities.some((e) => !e.destroyed), 2000))) return `the guest is on ${g.game.map.id}, not the hills`;
      // the guest's Terrain tool: a block of ground goes into the host's map, and back out to the guest
      const n0 = game.map.terrain.length;
      const block: [number, number][] = [[10, 10], [12, 10], [12, 11], [10, 11]];
      g.controls.reshapeMap({ ...g.game.map, id: 'mp-test', name: 'Hills (edited)', terrain: [...g.game.map.terrain, { pts: block, mat: 'rock' }] });
      if (g.game.map.terrain.length !== n0) return 'the guest changed its own copy of the map';
      if (!(await until(() => game.map.terrain.length === n0 + 1, 2000))) return 'the ground the guest drew never reached the host';
      tick();
      if (!(await until(() => g.game.map.terrain.length === n0 + 1, 2000))) return 'the host never sent the new ground back to the guest';
      if (g.game.env.standAt(11, 20) < 10.9) return `the guest's world has no ground at the new block (stands at ${g.game.env.standAt(11, 20).toFixed(2)})`;
      // a guest's switch of maps happens for everyone
      g.controls.switchMap(LAB);
      if (!(await until(() => game.map.id === 'lab', 2000))) return 'the guest’s switch to the lab didn’t happen for the host';
      tick();
      if (!(await until(() => g.game.map.id === 'lab', 2000))) return 'the guest isn’t shown the lab after switching';
      return true;
    })],
    ['extra: multiplayer: world2: the host’s weather, light and statistics of the game reach the guest, who can’t change the weather', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      game.weather.set({ rain: 0.6, fog: 0.5, light: 0.55 });
      tick();
      const show = () => `guest ${JSON.stringify(g.game.weather.state)}, host ${JSON.stringify(game.weather.state)}`;
      if (!(await until(() => JSON.stringify(g.game.weather.state) === JSON.stringify(game.weather.state), 2000))) return `the guest's weather isn't the host's: ${show()}`;
      if (g.game.renderer.ambient !== 0.55) return `the guest's world light is ${g.game.renderer.ambient}, not the host's dusk`;
      g.game.weather.set({ rain: 0 });
      if (g.game.weather.state.rain !== 0.6) return 'the guest changed the weather in the host’s game';
      // the host's counts of the game are the guest's "this game"
      const counting = game.stats.counting;
      game.stats.counting = true;
      game.stats.add('explosions', 2);
      game.stats.counting = counting;
      tick();
      const ok = await until(() => g.game.stats.game.explosions === game.stats.game.explosions, 2000);
      game.weather.reset();
      tick();
      if (!ok) return `the guest's game shows ${g.game.stats.game.explosions} explosions, the host's ${game.stats.game.explosions}`;
      return true;
    })],
    ['extra: multiplayer: Clear starts guests over; a guest who leaves, or whose host stops, keeps a working copy', () => kit.still(async () => {
      const g = await play();
      controls.clearScene('Clear all');
      kit.spawn('crate', 1, 0.45);
      tick();
      if (!(await until(() => g.game.entities.filter((e) => !e.destroyed).length === 1, 2000))) return `after Clear and a crate, the guest has ${g.game.entities.length} things`;
      // a big scene goes over in chunks (a message is cut up past 60 000 characters)
      const sent0 = session().host!.sent;
      for (let i = 0; i < 500; i++) kit.spawn('crate', -60 + (i % 50) * 2.4, 1 + Math.floor(i / 50) * 1.1).setFrozen(true);
      tick();
      const big = session().host!.sent - sent0;
      if (big < 60000) return `500 crates went in ${big} characters: no chunks to test`;
      if (!(await until(() => g.game.entities.filter((e) => !e.destroyed).length === 501, 4000))) return `of 501 things in ${big} characters, the guest got ${g.game.entities.filter((e) => !e.destroyed).length}`;
      controls.clearScene('Clear all');
      kit.spawn('crate', 1, 0.45);
      tick();
      if (!(await until(() => g.game.entities.filter((e) => !e.destroyed).length === 1, 3000))) return `after another Clear, the guest has ${g.game.entities.length} things`;
      // leaving: the copy stays, and moves by itself again
      g.ui.session.leave();
      if (g.game.net || g.controls.net) return 'left, the guest’s game is still a guest';
      const copy = g.game.entities.find((e) => !e.destroyed);
      if (!copy) return 'leaving emptied the guest’s game';
      if (kinematic(copy)) return 'left, the crate is still moved only by the host';
      if (!(await until(() => session().players.length === 1, 2000))) return 'the host still lists the guest who left';
      // the host stops: the guest carries on alone
      const g2 = await play();
      session().leave();
      if (game.net) return 'stopped hosting, the game is still a host';
      if (!(await until(() => !g2.game.net && g2.ui.session.role === 'off', 3000))) return 'the guest never noticed the host stopping';
      if (!g2.game.entities.some((e) => !e.destroyed)) return 'the host stopping emptied the guest’s game';
      frame?.remove();
      frame = null;
      return true;
    })],
  ];
}

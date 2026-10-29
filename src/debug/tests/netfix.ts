import type { Test, TestCtx } from './types';
import type { Game } from '../../world/Game';
import type { Controls } from '../../tools/Controls';
import type { UI } from '../../ui/UI';
import type { Session } from '../../net/Session';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Car } from '../../entities/Car';
import type { GuidedLauncher, Missile, SpikeLauncher } from '../../entities/Missiles';
import type { MissileCarrier } from '../../entities/M113';
import type { LineBatch } from '../../systems/Connections';
import type { makeTestKit } from '../testkit';
import type { ItemDef } from '../../world/types';
import type { V2 } from '../../engine/math';
import { RAPIER } from '../../engine/Physics';
import { PX } from '../../engine/constants';

/** A game's `window.bp` (see main.ts), with multiplayer. */
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
 * Multiplayer's flaws of 0.2.4 put right: what's aimed with a pointer (a guided
 * missile, the Spike's seeker) follows the pointer of the player who fired or
 * holds it, and limbs grown back on the host grow back for the guests. As in
 * multiplayer.ts: this page hosts, a second copy of the game in an iframe joins
 * (over BroadcastChannel) and runs on its own; this page's is stepped by hand.
 */
export default function tests(ctx: TestCtx): Test[] {
  // (a file:// page's iframe can't be reached: checked by the dev-server run, as multiplayer.ts's)
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
  const show = (p: V2 | null | undefined) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})` : 'nowhere');
  /** The newest of `id` in flight in the host's game. */
  const flying = (id: string): Missile | undefined => [...game.entities].reverse().find((e) => e.def.id === id && !e.destroyed) as Missile | undefined;

  /** The host's own pointer put at (x, y) (its frames set Game.cursor from it). */
  const hostAt = (x: number, y: number): string | null => {
    kit.view(0, 4, 20);
    kit.move(x, y);
    kit.view(0, 4, 20);
    const c = game.cursor;
    return c && near(c.x, x, 0.1) && near(c.y, y, 0.1) ? null : `the host's cursor went to ${show(c)}, not (${x}, ${y})`;
  };

  /** The guest's pointer put at (x, y), its view zoomed to 20 px a metre; waits for the host to hear of it. */
  const guestAt = async (g: Bp, x: number, y: number): Promise<string | null> => {
    g.kit.view(0, 4, 20);
    g.kit.move(x, y);
    const you = g.ui.session.guest!.you;
    const heard = () => {
      const c = game.cursorOf(you);
      return !!c && near(c.x, x, 0.15) && near(c.y, y, 0.15) && near(c.zoom, 20, 0.5);
    };
    if (await until(heard, 2000)) return null;
    return `the host has the guest's cursor at ${show(game.cursorOf(you))} (zoom ${game.cursorOf(you)?.zoom}), not (${x}, ${y}) at zoom 20`;
  };

  /**
   * Steps the host up to `seconds` (frames and all, as a player's game runs),
   * keeping the nearest `m` comes to each of `points`; stops once it's gone.
   */
  const follow = (m: Missile, seconds: number, points: V2[]): number[] => {
    const best = points.map(() => Infinity);
    for (let t = 0; t < seconds && !m.destroyed; t += 0.05) {
      kit.advance(0.05);
      if (m.destroyed) break;
      points.forEach((p, i) => (best[i] = Math.min(best[i], Math.hypot(m.main.x - p.x, m.main.y - p.y))));
    }
    return best;
  };

  /** A guest's copy of what the host has, once it's there. */
  const theirs = async <T extends Entity>(g: Bp, e: T): Promise<T | null> => {
    tick();
    return (await until(() => !!byNet(g.game, e.netId), 2000)) ? (byNet(g.game, e.netId) as T) : null;
  };

  const UP = { x: -4, y: 9 };
  const LOW = { x: 7, y: 1.2 };

  return [
    ['extra: netfix: a guest’s mouse-guided missile follows the guest’s cursor, not the host’s pointer elsewhere', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const L = kit.spawn('guided-launcher', -12, 0.4) as GuidedLauncher;
      kit.advance(0.5);
      const gl = await theirs(g, L);
      if (!gl) return 'the guest never got the launcher';
      const you = g.ui.session.guest!.you;
      const bad = hostAt(LOW.x, LOW.y) ?? (await guestAt(g, UP.x, UP.y));
      if (bad) return bad;
      // the guest works it (as F does: see Controls.command('activate'))
      g.controls.activate([gl], true);
      g.controls.releaseActivation();
      if (!(await until(() => L.shots === 1, 2000))) return `the guest's F fired ${L.shots} missiles`;
      const m = flying('missile-guided');
      if (!m) return 'nothing in flight';
      if (m.guide.kind !== 'cursor' || m.guide.by !== you) return `the guest's missile is guided by ${JSON.stringify(m.guide)}, not player ${you}'s cursor`;
      const [up, low] = follow(m, 2, [UP, LOW]);
      if (up > 2.5) return `it came no nearer than ${up.toFixed(1)} m to the guest's cursor at ${show(UP)}`;
      if (low < 4) return `it went to the host's pointer at ${show(LOW)} (${low.toFixed(1)} m off)`;
      return true;
    })],
    ['extra: netfix: the host’s own missiles still follow the host’s pointer, whatever the guest’s cursor does', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const L = kit.spawn('guided-launcher', -12, 0.4) as GuidedLauncher;
      kit.advance(0.5);
      if (!(await theirs(g, L))) return 'the guest never got the launcher';
      const bad = hostAt(UP.x, UP.y) ?? (await guestAt(g, LOW.x, LOW.y));
      if (bad) return bad;
      controls.activate([L], true);
      controls.releaseActivation();
      const m = flying('missile-guided');
      if (!m || L.shots !== 1) return `the host's F fired ${L.shots} missiles`;
      if (m.guide.kind !== 'cursor' || m.guide.by !== 1) return `the host's missile is guided by ${JSON.stringify(m.guide)}`;
      const [up, low] = follow(m, 2, [UP, LOW]);
      if (up > 2.5) return `it came no nearer than ${up.toFixed(1)} m to the host's pointer at ${show(UP)}`;
      if (low < 4) return `it went to the guest's cursor at ${show(LOW)} (${low.toFixed(1)} m off)`;
      return true;
    })],
    ['extra: netfix: an M113 a guest holds F on fires missiles that follow the guest’s cursor, the ones fired as it reloads too', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const m = kit.spawn('m113', -14, 1.5) as MissileCarrier;
      kit.advance(1);
      const gm = await theirs(g, m);
      if (!gm) return 'the guest never got the M113';
      const you = g.ui.session.guest!.you;
      const bad = hostAt(LOW.x, LOW.y) ?? (await guestAt(g, UP.x, UP.y));
      if (bad) return bad;
      g.controls.activate([gm], true);
      try {
        if (!(await until(() => m.shots === 1 && m.activeHeld, 2000))) return `the guest's F fired ${m.shots} missiles (held: ${m.activeHeld})`;
        const first = flying('missile-guided');
        if (first?.guide.kind !== 'cursor' || first.guide.by !== you) return `its first missile is guided by ${JSON.stringify(first?.guide)}`;
        for (let t = 0; t < 4.5 && m.shots < 2; t += 0.1) kit.advance(0.1);
        if (m.shots !== 2) return `F held 4.5 s, it fired ${m.shots} missiles`;
        const second = flying('missile-guided');
        if (!second || second === first || second.guide.kind !== 'cursor' || second.guide.by !== you) return `the one fired as it reloaded is guided by ${JSON.stringify(second?.guide)}`;
      } finally {
        g.controls.releaseActivation();
      }
      if (!(await until(() => !m.activeHeld, 2000))) return 'the guest let go of F, the host’s M113 still has it held';
      return true;
    })],
    ['extra: netfix: a guest holding a Spike’s seeker locks on what’s under the guest’s cursor, sees the reticle (the host doesn’t), and letting go fires at it', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const L = kit.spawn('spike-launcher', -14, 0.4) as SpikeLauncher;
      const car = kit.spawn('car', 5, 0.8) as Car;
      kit.advance(1);
      const gs = await theirs(g, L);
      const gcar = await theirs(g, car);
      if (!gs || !gcar) return 'the guest never got the launcher and the car';
      const you = g.ui.session.guest!.you;
      // the host's pointer in the empty air; the guest's on the car
      const bad = hostAt(-8, 7) ?? (await guestAt(g, car.body.x, car.body.y + 0.2));
      if (bad) return bad;
      // (how often each screen draws the seeker's reticle)
      let here = 0;
      let there = 0;
      const own = L.drawReticle.bind(L);
      L.drawReticle = (l: LineBatch) => {
        here++;
        own(l);
      };
      const copy = gs.drawReticle.bind(gs);
      gs.drawReticle = (l: LineBatch) => {
        there++;
        copy(l);
      };
      g.controls.activate([gs], true);
      try {
        if (!(await until(() => L.activeHeld, 2000))) return 'the guest’s F never switched the host’s seeker on';
        if (L.holder !== you) return `the seeker is held by player ${L.holder}, not the guest (${you})`;
        for (let i = 0; i < 15 && !L.lock; i++) kit.advance(0.1);
        if (!L.lock) return `no lock in 1.5 s with the guest's cursor on the car (the gate on ${L.sighted?.entity?.def.id ?? 'nothing'}, ${L.locking.toFixed(2)} s)`;
        if (L.lock.entity !== car) return `it locked on ${L.lock.entity?.def.id ?? 'the ground'}, not the car under the guest's cursor`;
        tick();
        if (!(await until(() => gs.holder === you && gs.lock?.entity === gcar && there > 0, 2000))) {
          return `the guest's screen shows the seeker held by ${gs.holder}, locked on ${gs.lock?.entity?.def.id ?? 'nothing'}, its reticle drawn ${there} times`;
        }
        if (here) return `the host's screen drew the guest's reticle (${here} times)`;
        // (the gate on the car as the guest sees it)
        const at = gs.lock!.at;
        const box = gcar.parts[0];
        if (Math.hypot(at.x - box.x, at.y - box.y) > 2) return `the guest's gate is at ${show(at)}, its car at ${show(box)}`;
        if (L.shots || flying('missile-spike')) return 'it fired while the guest still held F';
      } finally {
        g.controls.releaseActivation();
      }
      if (!(await until(() => L.shots === 1, 2000))) return `the guest let go of F with a lock: ${L.shots} missiles fired`;
      const s = flying('missile-spike');
      if (!s) return 'nothing in flight';
      if (s.guide.kind !== 'target' || s.guide.entity !== car) return `the missile is after ${JSON.stringify(s.guide.kind === 'target' ? s.guide.entity?.def.id : s.guide)}`;
      for (let t = 0; t < 6 && !s.destroyed; t += 0.1) kit.advance(0.1);
      if (!s.destroyed) return 'the missile was still flying 6 s after it was fired';
      kit.advance(0.1);
      if (!car.wrecked) return `the car isn't wrecked (hp ${car.body.hp.toFixed(0)})`;
      tick();
      if (!(await until(() => !gs.holder, 2000))) return 'let go, the guest still shows the seeker held';
      return true;
    })],
    ['extra: netfix: a limb grown back on the host grows back for the guest (small at first), and a guest who joins later sees the whole body', () => kit.still(async () => {
      const g = await play();
      kit.reset();
      tick();
      const h = human(0) as Human;
      kit.advance(0.5);
      const gh = await theirs(g, h);
      if (!gh) return 'the guest never got the person';
      const arm = h.limbs.get('lowerArmF')!;
      const hand = h.limbs.get('handF')!;
      const i = h.parts.indexOf(arm.part);
      const j = h.parts.indexOf(hand.part);
      // a forearm comes off (the hand with it, lying about)
      h.removePart(arm.part);
      tick();
      if (!(await until(() => gh.parts[i].destroyed, 2000))) return 'the guest’s person kept the forearm the host’s lost';
      const lost = (e: Entity) => e.parts.filter((p) => p.destroyed).map((p) => p.name).join(', ');
      const gore = (gm: Game) => gm.entities.filter((e) => !e.destroyed && e.def.id === 'gore').length;
      // Regen: the forearm grows back first
      h.inject('regen', 1);
      for (let t = 0; t < 4 && arm.part.destroyed; t += 0.1) kit.advance(0.1);
      if (arm.part.destroyed || h.parts[i] !== arm.part) return 'on Regen the host’s forearm never grew back';
      tick();
      const theirArm = () => gh.parts[i];
      if (!(await until(() => !theirArm().destroyed, 2000))) return 'the forearm grown back on the host isn’t there for the guest';
      const ga = theirArm();
      if (ga.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) return 'the guest’s new forearm moves by itself (it isn’t kinematic)';
      // (drawn growing out of the stump: small at first, then full size)
      const full = (ga.h + 2) * PX;
      const drawn = () => Math.abs(ga.sprite.h) / full;
      if (!(await until(() => drawn() < 0.9, 1000))) return `the guest’s new forearm is drawn full size (${drawn().toFixed(2)}) at once`;
      if (!(await until(() => drawn() > 0.99, 3000))) return `the guest’s new forearm never grew to full size (${drawn().toFixed(2)})`;
      // the hand next: what was left of it, lying about, is cast off as flesh
      const oldHand = gh.parts[j];
      const lying = h.parts[j];
      for (let t = 0; t < 4 && h.parts[j] === lying; t += 0.1) kit.advance(0.1);
      const newHand = h.parts[j];
      if (newHand === lying || newHand.destroyed || hand.part !== newHand) return 'on Regen the host’s hand never grew back';
      tick();
      if (!(await until(() => gh.parts[j] !== oldHand && !gh.parts[j].destroyed, 2000))) return 'the hand grown back on the host isn’t there for the guest';
      if (!oldHand.destroyed) return 'the guest still has the old hand lying about';
      // the body moves on the host: the new limbs go with it there
      h.limbs.get('midTorso')!.part.teleport(1, 1.6, 0.4);
      kit.advance(0.3);
      tick();
      const sameAt = () => [i, j].every((k) => near(gh.parts[k].x, h.parts[k].x, 0.08) && near(gh.parts[k].y, h.parts[k].y, 0.08));
      if (!(await until(sameAt, 2000))) {
        return `the guest's forearm and hand are at ${show(gh.parts[i])} ${show(gh.parts[j])}, the host's at ${show(h.parts[i])} ${show(h.parts[j])}`;
      }
      if (lost(gh) !== lost(h)) return `the guest's person has lost ${lost(gh) || 'nothing'}, the host's ${lost(h) || 'nothing'}`;
      if (!(await until(() => gore(g.game) === gore(game), 2000))) return `the guest has ${gore(g.game)} pieces of flesh lying about, the host ${gore(game)}`;
      // someone joining now gets the whole body
      const g2 = await play();
      tick();
      const gh2 = await theirs(g2, h);
      if (!gh2) return 'the guest who joined later never got the person';
      if (lost(gh2) !== lost(h)) return `to the guest who joined later the person has lost ${lost(gh2) || 'nothing'}, to the host ${lost(h) || 'nothing'}`;
      if (![i, j].every((k) => near(gh2.parts[k].x, h.parts[k].x, 0.1) && near(gh2.parts[k].y, h.parts[k].y, 0.1))) return 'to the guest who joined later the new forearm and hand are elsewhere';
      session().leave();
      frame?.remove();
      frame = null;
      return true;
    })],
  ];
}

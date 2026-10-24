import type { Test, TestCtx } from './types';
import type { Network } from '../../net/Link';
import { Friends, type Friend } from '../../net/Friends';
import { FriendsPanel } from '../../ui/FriendsPanel';

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
 * The friends list: two or three players in this page, each with a storage
 * key of their own, over the in-browser network (BroadcastChannel) rather than
 * the internet.
 */
export default function tests(ctx: TestCtx): Test[] {
  // (a file:// page may not have BroadcastChannel: these pass there and are checked by the dev-server run, as multiplayer's are)
  if (location.protocol === 'file:') return all(ctx).map(([name]) => [name, () => true]);
  return all(ctx);
}

function all({ kit }: TestCtx): Test[] {
  const KEY = 'blueberry-test-friends-';
  const made: Friends[] = [];

  /** A player on the in-browser network (`fresh`: a new one; else as kept in the storage, as after a reload). */
  const player = (who: string, name: string, fresh = true): Friends => {
    if (fresh) localStorage.removeItem(KEY + who);
    const f = new Friends({ net: 'local', key: KEY + who });
    made.push(f);
    if (name) f.rename(name);
    f.start();
    return f;
  };
  const entry = (f: Friends, code: string): Friend | undefined => f.list().find((e) => e.code === code);
  const show = (f: Friends) => JSON.stringify(f.list().map((e) => [e.name, e.rel, e.seen, e.doing?.st ?? '']));
  const up = (...fs: Friends[]) => until(() => fs.every((f) => f.up), 2000);

  /** Makes two players friends: one asks, the other accepts. */
  const befriend = async (a: Friends, b: Friends): Promise<string | true> => {
    const err = a.add(b.code);
    if (err) return `adding ${b.shownName}'s code failed: ${err}`;
    if (!(await until(() => entry(b, a.code)?.rel === 'incoming', 3000))) return `${b.shownName} never got ${a.shownName}'s request (their list: ${show(b)})`;
    b.accept(a.code);
    if (!(await until(() => entry(a, b.code)?.rel === 'friend' && entry(b, a.code)?.rel === 'friend', 3000))) {
      return `accepted, ${a.shownName} has ${show(a)} and ${b.shownName} has ${show(b)}`;
    }
    return true;
  };

  /** A test, its players taken off the network and their storage cleared afterwards, however it went. */
  const run = (fn: () => Promise<string | true>) => async (): Promise<string | true> => {
    kit.reset();
    try {
      return await fn();
    } finally {
      for (const f of made) f.stop();
      made.length = 0;
      for (const who of ['a', 'b', 'c']) localStorage.removeItem(KEY + who);
    }
  };

  return [
    ['extra: friends: a request accepted makes friends on both sides; the code, name and list survive a reload', run(async () => {
      const a = player('a', 'Ann');
      const b = player('b', 'Bob');
      if (!/^[A-HJKMNP-Z2-9]{6}$/.test(a.code)) return `Ann's friend code is "${a.code}"`;
      if (a.code === b.code) return 'two players got the same friend code';
      if (!(await up(a, b))) return `not on the in-browser network: "${a.problem || b.problem}"`;
      if (a.add(a.code) === null) return 'adding your own code was taken';
      if (a.add('XY') === null) return 'a two-letter code was taken';
      // typed as shown, in lower case
      const err = a.add(`${b.code.slice(0, 3)}-${b.code.slice(3)}`.toLowerCase());
      if (err) return `adding Bob's code failed: ${err}`;
      if (entry(a, b.code)?.rel !== 'sent') return `after adding Bob, Ann has ${show(a)}`;
      if (!(await until(() => entry(b, a.code)?.rel === 'incoming', 3000))) return `Bob never got Ann's request (his list: ${show(b)})`;
      const asks = entry(b, a.code)!;
      if (asks.name !== 'Ann') return `Ann's request reached Bob as from "${asks.name}"`;
      if (asks.doing) return 'Bob sees what Ann is doing before accepting her';
      // nobody's a friend one-sidedly
      if (entry(a, b.code)?.rel !== 'sent') return `before Bob answers, Ann has him as "${entry(a, b.code)?.rel}"`;
      b.accept(a.code);
      if (!(await until(() => entry(a, b.code)?.rel === 'friend' && entry(b, a.code)?.rel === 'friend', 3000))) {
        return `accepted, Ann has ${show(a)} and Bob has ${show(b)}`;
      }
      if (!(await until(() => entry(b, a.code)?.seen === 'online' && entry(b, a.code)?.doing?.st === 'sandbox' && entry(a, b.code)?.name === 'Bob', 2000))) {
        return `friends, Bob sees ${show(b)} and Ann ${show(a)}`;
      }
      // a reload: the same code, name and friends, from the browser's storage
      a.stop();
      const again = new Friends({ net: 'local', key: KEY + 'a' });
      if (again.code !== a.code) return `reloaded, Ann's code went from ${a.code} to ${again.code}`;
      if (again.name !== 'Ann') return `reloaded, Ann's name is "${again.name}"`;
      const bob = entry(again, b.code);
      if (bob?.rel !== 'friend' || bob.name !== 'Bob') return `reloaded, Ann's list is ${show(again)}`;
      if (!again.active) return 'reloaded, Ann wouldn’t go on the network with the game';
      return true;
    })],
    ['extra: friends: a request refused makes no one friends; a friend removed goes from both lists, even one away at the time', run(async () => {
      const a = player('a', 'Ann');
      const b = player('b', 'Bob');
      const c = player('c', 'Cat');
      if (!(await up(a, b, c))) return `not on the in-browser network: "${a.problem || b.problem || c.problem}"`;
      const news: string[] = [];
      c.onnews = (m) => news.push(m);
      const err = c.add(b.code);
      if (err) return `adding Bob's code failed: ${err}`;
      if (!(await until(() => entry(b, c.code)?.rel === 'incoming', 3000))) return `Bob never got Cat's request (his list: ${show(b)})`;
      b.refuse(c.code);
      if (entry(b, c.code)) return `refused, Cat is still on Bob's list: ${show(b)}`;
      if (!(await until(() => !entry(c, b.code), 3000))) return `refused by Bob, Cat still has ${show(c)}`;
      if (!news.some((m) => m.includes('turned down'))) return `Cat was told ${JSON.stringify(news)}`;
      await sleep(800);
      if (entry(b, c.code) || entry(c, b.code)) return `after a refusal, Bob has ${show(b)} and Cat ${show(c)}`;
      // removed, with both there
      const ok = await befriend(a, b);
      if (ok !== true) return ok;
      a.remove(b.code);
      if (entry(a, b.code)) return 'removed, Bob is still on Ann’s list';
      if (!(await until(() => !entry(b, a.code), 3000))) return `Ann removed Bob, but Bob still has ${show(b)}`;
      await sleep(800);
      if (entry(a, b.code) || entry(b, a.code)) return `a while after the removal, Ann has ${show(a)} and Bob ${show(b)}`;
      // removed while away: told on coming back
      const ok2 = await befriend(a, c);
      if (ok2 !== true) return ok2;
      c.stop();
      if (!(await until(() => entry(a, c.code)?.seen === 'offline', 2000))) return `Cat's game closed; Ann sees ${show(a)}`;
      a.remove(c.code);
      const back = player('c', '', false);
      if (entry(back, a.code)?.rel !== 'friend') return `Cat, back, has ${show(back)} (Ann as a friend, until told)`;
      if (!(await until(() => !entry(back, a.code), 3000))) return `Ann removed Cat while she was away; back, Cat still has ${show(back)}`;
      if (entry(a, c.code)) return `Cat coming back put her on Ann's list again: ${show(a)}`;
      return true;
    })],
    ['extra: friends: a friend is seen online, in the menu, hosting (with the room code), offline once their game closes; invitations reach friends', run(async () => {
      const a = player('a', 'Ann');
      const b = player('b', 'Bob');
      if (!(await up(a, b))) return `not on the in-browser network: "${a.problem || b.problem}"`;
      const ok = await befriend(a, b);
      if (ok !== true) return ok;
      if (!(await until(() => entry(b, a.code)?.seen === 'online', 2000))) return `friends, Bob sees ${show(b)}`;
      a.setActivity({ st: 'menu' });
      if (!(await until(() => entry(b, a.code)?.doing?.st === 'menu', 2000))) return `Ann went to the main menu; Bob sees ${show(b)}`;
      a.setActivity({ st: 'hosting', room: 'QWXYZ', net: 'local', n: 3 });
      if (!(await until(() => entry(b, a.code)?.doing?.room === 'QWXYZ', 2000))) return `Ann hosts game QWXYZ; Bob sees ${show(b)}`;
      const d = entry(b, a.code)!.doing!;
      if (d.st !== 'hosting' || d.n !== 3 || d.net !== 'local') return `Ann hosts QWXYZ (3 playing, over tabs); Bob sees ${JSON.stringify(d)}`;
      // an invitation
      const got: [string, string, Network][] = [];
      b.oninvite = (from, room, net) => got.push([from.code, room, net]);
      if (!a.invite(b.code, 'QWXYZ', 'local')) return 'Ann couldn’t invite Bob, online';
      if (!(await until(() => got.length > 0, 2000))) return 'Ann’s invitation never reached Bob';
      if (got[0][0] !== a.code || got[0][1] !== 'QWXYZ' || got[0][2] !== 'local') return `Bob got an invitation from ${got[0][0]} to ${got[0][1]} over ${got[0][2]}`;
      // no one else's
      const c = player('c', 'Cat');
      if (!(await up(c))) return 'Cat isn’t on the network';
      if (c.invite(b.code, 'AAAAA', 'local')) return 'Cat, no friend of Bob’s, could invite him';
      // Ann's game closes
      a.stop();
      if (!(await until(() => entry(b, a.code)?.seen === 'offline' && !entry(b, a.code)?.doing, 2000))) return `Ann's game closed; Bob sees ${show(b)}`;
      return true;
    })],
    ['extra: friends: in the Friends panel, Join beside a friend hosting (or on their invitation) joins their game; Invite while hosting', run(async () => {
      const a = player('a', 'Ann');
      const b = player('b', 'Bob');
      if (!(await up(a, b))) return `not on the in-browser network: "${a.problem || b.problem}"`;
      const ok = await befriend(a, b);
      if (ok !== true) return ok;
      a.setActivity({ st: 'hosting', room: 'HJKMN', net: 'local', n: 2 });
      if (!(await until(() => entry(b, a.code)?.doing?.room === 'HJKMN', 2000))) return `Ann hosts game HJKMN; Bob sees ${show(b)}`;
      // Bob's panel, with a stand-in for multiplayer that notes the games it's asked to join
      const joins: string[] = [];
      const session = { role: 'off' as 'off' | 'host' | 'guest', code: '', net: 'internet' as Network, players: [] as unknown[], busy: false };
      const box = document.createElement('div');
      const root = document.createElement('div');
      const panel = new FriendsPanel(b, session, box, () => {}, root, {
        join: async (net, room) => {
          joins.push(`${net}:${room}`);
        },
        toast: () => {},
        inMenu: () => false,
      });
      panel.render();
      const button = (label: string, within: Element) => [...within.querySelectorAll('button')].find((x) => x.textContent === label);
      const rowOf = (name: string) => [...box.querySelectorAll('.fr-row')].find((r) => r.querySelector('.fr-name')?.textContent === name);
      const ann = rowOf('Ann');
      if (!ann) return `Bob's panel doesn't list Ann: "${box.textContent}"`;
      if (!ann.textContent?.includes('Hosting')) return `Bob's panel says of Ann "${ann.textContent}"`;
      const join = button('Join', ann);
      if (!join) return 'no Join beside Ann, hosting';
      join.click();
      if (!(await until(() => joins.length > 0, 1000))) return 'Join did nothing';
      if (joins[0] !== 'local:HJKMN') return `Join beside Ann joined ${joins[0]}`;
      // her invitation: its Join joins too
      a.invite(b.code, 'HJKMN', 'local');
      const bar = root.querySelector('.fr-invite');
      if (!bar) return 'no invitation bar';
      if (!(await until(() => !bar.classList.contains('hidden'), 2000))) return 'Ann’s invitation never showed for Bob';
      if (!bar.textContent?.includes('Ann')) return `the invitation says "${bar.textContent}"`;
      button('Join', bar)?.click();
      if (!(await until(() => joins.length > 1, 1000))) return 'Join on the invitation did nothing';
      if (joins[1] !== 'local:HJKMN') return `Join on Ann's invitation joined ${joins[1]}`;
      if (!bar.classList.contains('hidden')) return 'the invitation stayed up after Join';
      // Bob hosts: Ann, online and not hosting, gets an Invite
      a.setActivity({ st: 'sandbox' });
      if (!(await until(() => entry(b, a.code)?.doing?.st === 'sandbox', 2000))) return `Ann stopped hosting; Bob sees ${show(b)}`;
      Object.assign(session, { role: 'host', code: 'PQRST', net: 'local', players: [1, 2] });
      panel.render();
      const invite = button('Invite', rowOf('Ann') ?? box);
      if (!invite) return `hosting, Bob has no Invite beside Ann: "${rowOf('Ann')?.textContent}"`;
      const got: string[] = [];
      a.oninvite = (from, room, net) => got.push(`${from.name}:${net}:${room}`);
      invite.click();
      if (!(await until(() => got.length > 0, 2000))) return 'Bob’s Invite never reached Ann';
      if (got[0] !== 'Bob:local:PQRST') return `Ann got the invitation ${got[0]}`;
      if (button('Invited', rowOf('Ann') ?? box)?.disabled !== true) return 'after inviting her, Ann’s Invite doesn’t say so';
      return true;
    })],
  ];
}

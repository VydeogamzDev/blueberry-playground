import type { Test, TestCtx } from './types';
import { fromFile, LISTS, memoryBacking, mergeStates, sameState, store, Store, toFile, type Backing, type SyncState } from '../../engine/Store';
import { Sync, sync as gameSync, type Folder } from '../../engine/Sync';
import { LAYOUT_STORE } from '../../ui/Layout';

const LIST = 'blueberry-contraptions';
const FRIENDS = 'blueberry-friends';
/** Merges are told the time, so no removal in these is old enough to be forgotten. */
const NOW = 1e6;

/** A store in memory, on a clock the test moves (each change at clock.t, or just after the last). */
function fresh(start = 1000): { s: Store; clock: { t: number } } {
  const clock = { t: start };
  return { s: new Store(memoryBacking(), () => clock.t), clock };
}

const ids = (s: SyncState | Store, key = LIST) => {
  const v = s instanceof Store ? s.getItem(key) : s.values[key];
  return (JSON.parse(v ?? '[]') as { id: string; name: string }[]).map((c) => `${c.id}:${c.name}`).join(' ');
};

/** One store taking in another's saves, as a sync does (and its game reading the list again, as Contraptions does). */
const pull = (into: Store, from: Store) => {
  into.adopt(mergeStates(into.state(), from.state(), NOW));
  into.getItem(LIST);
};

/** A sync folder in memory: the file's text, and how many times it was written. */
function memFolder(): Folder & { text: string | null; writes: number } {
  const f = {
    name: 'test folder',
    text: null as string | null,
    writes: 0,
    read: async () => f.text,
    write: async (t: string) => {
      f.text = t;
      f.writes++;
    },
  };
  return f;
}

export default function tests({ game, kit }: TestCtx): Test[] {
  return [
    ['extra: sync: the store keeps each key with when it changed; the same value again is no change, and graphics stay out of syncing', () => {
      const { s, clock } = fresh();
      const heard: string[] = [];
      s.onChange((keys, bySync) => heard.push(`${keys.join()}${bySync ? ' (sync)' : ''}`));
      s.setItem('blueberry-x', 'a');
      clock.t = 2000;
      s.setItem('blueberry-x', 'a');
      let t = s.state().times.keys['blueberry-x'];
      if (t?.t !== 1000) return `setting the same value again moved its time to ${t?.t}`;
      s.setItem('blueberry-x', 'b');
      t = s.state().times.keys['blueberry-x'];
      if (t?.t !== 2000 || t.b !== 1000) return `changed at 2000 (first kept at 1000): times ${JSON.stringify(t)}`;
      if (s.getItem('blueberry-x') !== 'b') return `read back ${s.getItem('blueberry-x')}`;
      s.setItem('blueberry-graphics', '{}');
      s.setItem('blueberry-test-friends-a', '{}');
      const st = s.state();
      if ('blueberry-graphics' in st.values || 'blueberry-test-friends-a' in st.values) return `synced keys: ${Object.keys(st.values).join(', ')} (graphics and the tests' own stay local)`;
      clock.t = 3000;
      s.removeItem('blueberry-x');
      if (s.getItem('blueberry-x') !== null) return 'removed, it is still there';
      if (s.state().times.gone['blueberry-x'] !== 3000) return `its removal was not noted (gone: ${JSON.stringify(s.state().times.gone)})`;
      if (heard.join(' | ') !== 'blueberry-x | blueberry-x | blueberry-graphics | blueberry-test-friends-a | blueberry-x') return `changes heard: ${heard.join(' | ')}`;
      return true;
    }],
    ['extra: sync: the game’s store is this browser’s localStorage (times kept beside), and a full storage still says so', () => {
      if (store.kind !== 'browser') return `the game's store is kept in ${store.kind}, not this browser's localStorage`;
      const key = 'blueberry-sync-check';
      try {
        store.setItem(key, 'one');
        if (localStorage.getItem(key) !== 'one') return 'a value set in the store is not in localStorage';
        if (!(localStorage.getItem('blueberry-store-times') ?? '').includes(key)) return 'no time kept for it in localStorage';
        localStorage.setItem(key, 'two');
        if (store.getItem(key) !== 'two') return 'a value set in localStorage is not read through the store';
      } finally {
        store.removeItem(key);
      }
      // (Contraptions and Maps say "storage full" when setItem throws, as localStorage's does)
      const full: Backing = { ...memoryBacking(), set: () => { throw new DOMException('full', 'QuotaExceededError'); } };
      const s = new Store(full);
      let heard = 0;
      s.onChange(() => heard++);
      let threw = false;
      try {
        s.setItem('blueberry-x', 'a');
      } catch {
        threw = true;
      }
      if (!threw) return 'a store that cannot keep anything did not throw';
      if (heard || Object.keys(s.state().times.keys).length) return 'a change that was not kept was noted as one';
      return true;
    }],
    ['extra: sync: a merge keeps the later change of each key (a removal too), the same either way round, and merging again changes nothing', () => {
      const { s: a, clock: ca } = fresh();
      const { s: b, clock: cb } = fresh();
      a.setItem('blueberry-one', 'a1');
      cb.t = 2000;
      b.setItem('blueberry-one', 'b1');
      ca.t = 3000;
      a.setItem('blueberry-two', 'a2');
      cb.t = 1500;
      b.setItem('blueberry-two', 'b2');
      b.setItem('blueberry-three', 'b3');
      const ab = mergeStates(a.state(), b.state(), NOW);
      const ba = mergeStates(b.state(), a.state(), NOW);
      const v = ab.values;
      if (v['blueberry-one'] !== 'b1' || v['blueberry-two'] !== 'a2' || v['blueberry-three'] !== 'b3' || Object.keys(v).length !== 3) return `merged: ${JSON.stringify(v)} (wanted one b1, two a2, three b3)`;
      if (!sameState(ab, ba)) return `a with b: ${JSON.stringify(ab)}; b with a: ${JSON.stringify(ba)}`;
      if (!sameState(mergeStates(ab, b.state(), NOW), ab) || !sameState(mergeStates(a.state(), ab, NOW), ab)) return 'merging the merged saves again changed them';
      // a same-moment tie: both copies still agree
      const { s: c } = fresh();
      const { s: d } = fresh();
      c.setItem('blueberry-tie', 'x');
      d.setItem('blueberry-tie', 'y');
      if (mergeStates(c.state(), d.state(), NOW).values['blueberry-tie'] !== mergeStates(d.state(), c.state(), NOW).values['blueberry-tie']) return 'two changes at the same moment merge differently either way round';
      // a removal later than the other's change wins; a change after it brings the key back
      pull(a, b);
      pull(b, a);
      cb.t = 5000;
      b.removeItem('blueberry-one');
      pull(a, b);
      if (a.getItem('blueberry-one') !== null) return `removed in b at 5000, a still has ${a.getItem('blueberry-one')}`;
      ca.t = 6000;
      a.setItem('blueberry-one', 'again');
      pull(b, a);
      if (b.getItem('blueberry-one') !== 'again') return `set again in a after b removed it: b has ${b.getItem('blueberry-one')}`;
      return true;
    }],
    ['extra: sync: lists merge by id: contraptions made on either side are all kept, one changed on both keeps the later change', () => {
      const { s: a, clock: ca } = fresh();
      const { s: b, clock: cb } = fresh();
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }]));
      pull(b, a);
      ca.t = 2000;
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }, { id: 'c2', name: 'Cannon' }]));
      cb.t = 2500;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Fast cart' }]));
      cb.t = 2600;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Fast cart' }, { id: 'c3', name: 'Crane' }]));
      const m = mergeStates(a.state(), b.state(), NOW);
      // (the other's order first: the shared file's stays put)
      if (ids(m) !== 'c1:Fast cart c3:Crane c2:Cannon') return `merged list: ${ids(m)} (wanted c1:Fast cart c3:Crane c2:Cannon)`;
      if (ids(mergeStates(b.state(), a.state(), NOW)) !== 'c1:Fast cart c2:Cannon c3:Crane') return `the other way round: ${ids(mergeStates(b.state(), a.state(), NOW))}`;
      const t = m.times.items[LIST];
      if (t?.c1 !== 2500 || t.c2 !== 2000 || t.c3 !== 2600) return `item times: ${JSON.stringify(t)}`;
      // a list kept before there were times (an old browser's): every item still kept
      const old = new Store(memoryBacking({ [LIST]: JSON.stringify([{ id: 'c9', name: 'Old one' }]) }));
      const n = mergeStates(old.state(), b.state(), NOW);
      if (ids(n) !== 'c1:Fast cart c3:Crane c9:Old one') return `an old list with a new one: ${ids(n)}`;
      return true;
    }],
    ['extra: sync: a removed item stays removed on the other side (a tombstone), and one made again after comes back', () => {
      const { s: a, clock: ca } = fresh();
      const { s: b, clock: cb } = fresh();
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }, { id: 'c2', name: 'Cannon' }]));
      pull(b, a);
      ca.t = 3000;
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }]));
      if (a.state().times.goneItems[LIST]?.c2 !== 3000) return `the removal was not noted: ${JSON.stringify(a.state().times.goneItems)}`;
      cb.t = 3500;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Red cart' }, { id: 'c2', name: 'Cannon' }]));
      pull(b, a);
      if (ids(b) !== 'c1:Red cart') return `b after taking in a's removal: ${ids(b)}`;
      pull(a, b);
      if (ids(a) !== 'c1:Red cart') return `a after taking b back: ${ids(a)}`;
      cb.t = 4000;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Red cart' }, { id: 'c2', name: 'Cannon II' }]));
      pull(a, b);
      if (ids(a) !== 'c1:Red cart c2:Cannon II') return `made again after its removal: a has ${ids(a)}`;
      return true;
    }],
    ['extra: sync: friends: both lists kept, the newer name, and the friend code the one kept longest', () => {
      const { s: a } = fresh();
      const { s: b, clock: cb } = fresh();
      const friend = (code: string) => ({ code, name: code.toLowerCase(), rel: 'friend', at: 1 });
      a.setItem(FRIENDS, JSON.stringify({ v: 1, code: 'AAAAAA', name: 'Ann', on: true, friends: [friend('XXXXXX')] }));
      cb.t = 2000;
      b.setItem(FRIENDS, JSON.stringify({ v: 1, code: 'BBBBBB', name: 'Bob', on: false, friends: [friend('YYYYYY')] }));
      for (const m of [mergeStates(a.state(), b.state(), NOW), mergeStates(b.state(), a.state(), NOW)]) {
        const f = JSON.parse(m.values[FRIENDS]) as { code: string; name: string; friends: { code: string }[] };
        const codes = f.friends.map((x) => x.code).sort().join(' ');
        if (f.code !== 'AAAAAA' || f.name !== 'Bob' || codes !== 'XXXXXX YYYYYY') return `merged: code ${f.code} (wanted the first kept, AAAAAA), name ${f.name} (wanted the later, Bob), friends ${codes}`;
      }
      return true;
    }],
    ['extra: sync: screen layouts merge slot by slot; the one in use is the copy’s that chose last', () => {
      if (!LISTS[LAYOUT_STORE]) return `the layouts (${LAYOUT_STORE}) are not merged slot by slot`;
      const { s: a, clock: ca } = fresh();
      const { s: b, clock: cb } = fresh();
      const slot = (id: string, name: string) => ({ id, name, layout: {} });
      const slots = (v: string | null) => (JSON.parse(v ?? '{}') as { slots: { id: string; name: string }[] }).slots.map((s) => s.name).sort().join(' ');
      a.setItem(LAYOUT_STORE, JSON.stringify({ active: 'l1', slots: [slot('l1', 'Wide')] }));
      cb.t = 2000;
      b.setItem(LAYOUT_STORE, JSON.stringify({ active: 'l2', slots: [slot('l2', 'Tall')] }));
      const m = mergeStates(a.state(), b.state(), NOW).values[LAYOUT_STORE];
      const active = (JSON.parse(m) as { active: string }).active;
      if (slots(m) !== 'Tall Wide' || active !== 'l2') return `merged: layouts ${slots(m)} (wanted both), in use ${active} (wanted the later choice, l2)`;
      pull(a, b);
      pull(b, a);
      // one deleted on one side stays deleted on the other
      ca.t = 3000;
      a.getItem(LAYOUT_STORE);
      a.setItem(LAYOUT_STORE, JSON.stringify({ active: 'l2', slots: [slot('l2', 'Tall')] }));
      pull(b, a);
      if (slots(b.getItem(LAYOUT_STORE)) !== 'Tall') return `after a deleted Wide, b has ${slots(b.getItem(LAYOUT_STORE))}`;
      return true;
    }],
    ['extra: sync: a list the game read before a merge isn’t cut short when the game writes it back', () => {
      const { s: a, clock: ca } = fresh();
      const { s: b, clock: cb } = fresh();
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }]));
      pull(b, a);
      cb.t = 2000;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }, { id: 'c2', name: 'Cannon' }]));
      // a's game still holds [c1] when the merge brings c2 (it doesn't read it again), and saves a new one of its own
      ca.t = 3000;
      a.adopt(mergeStates(a.state(), b.state(), NOW));
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }, { id: 'c4', name: 'Car' }]));
      if (ids(a) !== 'c1:Cart c4:Car c2:Cannon') return `after the game wrote back its list: ${ids(a)} (c2 came in by the merge)`;
      if (a.state().times.goneItems[LIST]?.c2) return 'c2 was noted as removed';
      // once the game has read it again, leaving one out is a removal
      a.getItem(LIST);
      ca.t = 4000;
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }, { id: 'c4', name: 'Car' }]));
      if (ids(a) !== 'c1:Cart c4:Car' || a.state().times.goneItems[LIST]?.c2 !== 4000) return `removed after a read: ${ids(a)}, gone ${JSON.stringify(a.state().times.goneItems[LIST])}`;
      return true;
    }],
    ['extra: sync: Export everything then Import everything brings every save over with its times; importing it again changes nothing', async () => {
      const { s: a, clock } = fresh();
      a.setItem('blueberry-player-name', 'Ann');
      clock.t = 1500;
      a.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }]));
      a.setItem('blueberry-graphics', '{"fps":"unlimited"}');
      const text = toFile(a.state(), 'test');
      const back = fromFile(text);
      if (!back || !sameState(back, a.state())) return 'the file does not read back as the saves written';
      if ('blueberry-graphics' in back.values) return 'graphics went into the file';
      const { s: b } = fresh();
      const s = new Sync(b);
      const n = await s.importText(text);
      if (n !== 2 || b.getItem('blueberry-player-name') !== 'Ann' || ids(b) !== 'c1:Cart') return `imported ${n} changes: name ${b.getItem('blueberry-player-name')}, contraptions ${ids(b)}`;
      if (!sameState(b.state(), a.state())) return 'the times did not come over with the saves';
      if ((await s.importText(text)) !== 0) return 'importing the same file again changed things';
      let refused = '';
      await s.importText('{"blueberryMap":1}').catch((e: Error) => (refused = e.message));
      if (!refused) return 'a file that is not a saves file was taken';
      // the game's own export: its saves, without the store's own bookkeeping
      const mine = fromFile(gameSync.exportText());
      if (!mine) return 'the game’s export does not read back';
      if (Object.keys(mine.values).some((k) => k === 'blueberry-store-times' || k === 'blueberry-graphics')) return `the game's export holds ${Object.keys(mine.values).join(', ')}`;
      return true;
    }],
    ['extra: sync: two copies sync through a shared folder: each one’s saves reach the other, removals too, and an unchanged file isn’t rewritten', async () => {
      const folder = memFolder();
      // (on today's clock: a sync forgets removals months old)
      const now = Date.now();
      const { s: a, clock: ca } = fresh(now);
      const { s: b, clock: cb } = fresh(now);
      const sa = new Sync(a);
      const sb = new Sync(b);
      a.setItem('blueberry-player-name', 'Ann');
      await sa.use(folder);
      if (folder.writes !== 1 || !folder.text?.includes('Ann')) return `the first copy linked: ${folder.writes} writes, file ${folder.text?.slice(0, 80)}`;
      cb.t = now + 1000;
      b.setItem(LIST, JSON.stringify([{ id: 'c1', name: 'Cart' }]));
      await sb.use(folder);
      if (b.getItem('blueberry-player-name') !== 'Ann') return `the second copy did not get the first's name (${b.getItem('blueberry-player-name')})`;
      await sa.sync();
      if (ids(a) !== 'c1:Cart') return `the first copy did not get the second's contraption (${ids(a)})`;
      const writes = folder.writes;
      await sa.sync();
      await sb.sync();
      if (folder.writes !== writes) return `nothing changed, yet the file was written ${folder.writes - writes} more times`;
      ca.t = now + 2000;
      a.getItem(LIST);
      a.setItem(LIST, '[]');
      await sa.sync();
      await sb.sync();
      if (ids(b) !== '') return `removed in the first copy, the second still has ${ids(b)}`;
      if (sa.status.error || sb.status.error || !sa.status.last) return `status: ${JSON.stringify(sa.status)} / ${JSON.stringify(sb.status)}`;
      // someone else's file of that name is left alone
      folder.text = 'not ours';
      const before = folder.writes;
      await sa.sync();
      if (folder.writes !== before || !sa.status.error) return `a file that isn't a sync file: written ${folder.writes - before} times, error "${sa.status.error}"`;
      return true;
    }],
    ['extra: sync: Settings has Saves and sync: where saves are kept, the folder to sync through (or why not), Export and Import everything', () => {
      kit.reset();
      const sec = [...document.querySelectorAll('.settings-panel .set-sec')].find((s) => s.querySelector('.panel-sub')?.textContent === 'Saves and sync');
      if (!sec) return 'no Saves and sync section in Settings';
      const rows = [...sec.querySelectorAll('.set-row')].map((r) => r.textContent ?? '');
      const kept = rows.find((r) => r.startsWith('Saves kept')) ?? '';
      if (!/in this browser|data folder|nowhere/.test(kept)) return `Saves kept says "${kept}"`;
      const buttons = [...sec.querySelectorAll('button')].map((b) => b.textContent ?? '');
      for (const want of ['Export everything…', 'Import everything…']) if (!buttons.includes(want)) return `no ${want} (buttons: ${buttons.join(', ')})`;
      if (gameSync.status.canLink ? !buttons.some((b) => b === 'Link folder…' || b === 'Change…') : !rows.some((r) => r.includes('can’t link a folder'))) return `canLink ${gameSync.status.canLink}, rows: ${rows.join(' | ')}`;
      return true;
    }],
    ['extra: sync: desktop V-sync: with the frame-rate limit off, "as the screen refreshes" still holds frames to the refresh', async () => {
      kit.reset();
      const g = game as unknown as { hzSet: boolean };
      const was = { cap: game.fpsCap, hz: game.displayHz, set: g.hzSet, free: game.unthrottled };
      const rate = async (ms: number) => {
        let n = 0;
        const count = () => void n++;
        game.frameHandlers.push(count);
        await new Promise((res) => setTimeout(res, ms));
        game.frameHandlers = game.frameHandlers.filter((h) => h !== count);
        return (n * 1000) / ms;
      };
      return kit.live(async () => {
        try {
          // (a 30 Hz screen, as the app would tell it, under animation frames that come faster)
          game.fpsCap = 0;
          game.setDisplayHz(30);
          game.unthrottled = true;
          await rate(300);
          const r = await rate(1500);
          if (r > 34 || r < 22) return `held to a 30 Hz screen: ${r.toFixed(1)} frames a second`;
          return true;
        } finally {
          game.fpsCap = was.cap;
          game.displayHz = was.hz;
          g.hzSet = was.set;
          game.unthrottled = was.free;
        }
      });
    }],
  ];
}

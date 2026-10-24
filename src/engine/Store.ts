import { desktop, type DesktopStore } from './Desktop';

/**
 * Everything the game keeps between visits (settings, key bindings, the quick
 * save, contraptions, maps, friends, tutorial progress) goes through here, with
 * localStorage's calls, so that it can be kept elsewhere and synced:
 * - in a browser, in its localStorage, as it always was;
 * - in the desktop app, in a file in the app's data folder (read as the window
 *   opens, before the game starts; the app writes changes to disk, see desktop/main.cjs);
 * - in memory only, where neither can be had (a private window that refuses storage).
 * Each key remembers when it was last changed, and each item of a list (see
 * LISTS) when it was, so that two copies of the game (the browser's and the
 * desktop's, or two computers') merge without losing what was made on either
 * side (see mergeStates, and Sync for the folder they meet in).
 */

/** Where the store keeps its times, beside the values. */
const TIMES_KEY = 'blueberry-store-times';
/** Kept by each copy for itself: graphics suit the computer (and the desktop app can draw past the browser's frame limit). */
const LOCAL = new Set(['blueberry-graphics', 'blueberry-iterations']);
/** A removal is remembered this long (ms), so a copy that hasn't synced in a while doesn't bring the thing back; then it's forgotten. */
const KEEP_GONE = 180 * 24 * 3600 * 1000;

/** Whether a key is the player's, to sync and export (not the store's own, a test's, or one kept per copy). */
export const synced = (key: string): boolean => key.startsWith('blueberry-') && key !== TIMES_KEY && !key.startsWith('blueberry-test-') && !LOCAL.has(key);

/** A list kept under one key, merged item by item (by id) rather than whole. */
export interface ListRule {
  /** Where the list is: the value itself, or this field of it. */
  field?: string;
  /** The items' id field. */
  id: string;
  /** Fields beside the list taken from the copy that has had the key longest: your friend code, which your friends know you by. */
  oldest?: string[];
}

export const LISTS: Record<string, ListRule> = {
  'blueberry-contraptions': { id: 'id' },
  'blueberry-maps': { id: 'id' },
  'blueberry-friends': { field: 'friends', id: 'code', oldest: ['code'] },
  // (the screen layouts saved by name; the one in use is the side's that chose last)
  'blueberry-layouts': { field: 'slots', id: 'id' },
};

/** When things changed (ms since 1970), kept beside the values for merging. A key with none (kept before there were times) counts as oldest. */
export interface Times {
  /** Each key's last change (t), and when it was first kept (b). */
  keys: Record<string, { t: number; b: number }>;
  /** Keys removed, and when: a removal syncs as one, rather than the other copy's value coming back. */
  gone: Record<string, number>;
  /** Lists: each item's last change, by id... */
  items: Record<string, Record<string, number>>;
  /** ...and the items removed, and when. */
  goneItems: Record<string, Record<string, number>>;
}

/** What two copies merge: the synced keys' values and their times. A sync or export file holds one (see toFile). */
export interface SyncState {
  values: Record<string, string>;
  times: Times;
}

export type StoreKind = 'browser' | 'desktop' | 'memory';

/** Where a store's values are (its times among them, under TIMES_KEY). */
export interface Backing {
  readonly kind: StoreKind;
  get(key: string): string | null;
  /** May throw (a browser's storage is full): the store passes that on, as localStorage does. */
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  /** Writes what's waiting now (the window is closing). */
  flush?(): void;
}

type Listener = (keys: string[], bySync: boolean) => void;

const noTimes = (): Times => ({ keys: {}, gone: {}, items: {}, goneItems: {} });

function parse(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Times as read from storage or a file: anything that isn't a time is dropped (a hand-edited file can say anything). */
function readTimes(raw: unknown): Times {
  const out = noTimes();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const each = (o: unknown, fn: (k: string, v: unknown) => void) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (k !== '__proto__') fn(k, v);
  };
  const r = (raw ?? {}) as Partial<Record<keyof Times, unknown>>;
  each(r.keys, (k, v) => {
    const t = num((v as { t?: unknown } | null)?.t);
    if (t !== null) out.keys[k] = { t, b: num((v as { b?: unknown }).b) ?? t };
  });
  each(r.gone, (k, v) => {
    const t = num(v);
    if (t !== null) out.gone[k] = t;
  });
  for (const f of ['items', 'goneItems'] as const) {
    each(r[f], (k, v) => {
      const m: Record<string, number> = {};
      each(v, (id, x) => {
        const t = num(x);
        if (t !== null) m[id] = t;
      });
      // (an empty one is none: two copies' times compare the same either way)
      if (Object.keys(m).length) out[f][k] = m;
    });
  }
  return out;
}

function listIn(data: unknown, rule: ListRule): unknown[] | null {
  const l = rule.field ? (data && typeof data === 'object' ? (data as Record<string, unknown>)[rule.field] : undefined) : data;
  return Array.isArray(l) ? l : null;
}

function idOf(item: unknown, rule: ListRule): string | null {
  const id = item && typeof item === 'object' ? (item as Record<string, unknown>)[rule.id] : undefined;
  return typeof id === 'string' && id !== '__proto__' ? id : null;
}

/** A list's items by id, in order (the first of an id, should one come twice). */
function byId(list: unknown[] | null, rule: ListRule): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const item of list ?? []) {
    const id = idOf(item, rule);
    if (id !== null && !m.has(id)) m.set(id, item);
  }
  return m;
}

/** The value with its list replaced (its other fields kept where they were). */
function withList(data: unknown, rule: ListRule, list: unknown[]): unknown {
  return rule.field ? { ...(data as object), [rule.field]: list } : list;
}

/** One copy's side of a key: its value and when that was set, or (no value) when it was removed (-1: never had it). */
interface Side {
  value: string | null;
  t: number;
  /** When the key was first kept (Infinity: not kept). */
  b: number;
}

function side(s: SyncState, key: string): Side {
  const value = Object.hasOwn(s.values, key) ? s.values[key] : null;
  const kt = s.times.keys[key];
  return value !== null ? { value, t: kt?.t ?? 0, b: kt?.b ?? 0 } : { value, t: s.times.gone[key] ?? -1, b: Infinity };
}

/**
 * Whether x's side of a key wins: the later change; at the same moment, a value
 * over a removal, and between two values the same one on both copies (the
 * greater), so that both copies come to the same answer.
 */
function wins(x: Side, y: Side): boolean {
  if (x.t !== y.t) return x.t > y.t;
  if (x.value === null || y.value === null) return x.value !== null;
  return x.value >= y.value;
}

/**
 * Merges two copies' saves: for each key the later change wins (a removal
 * too), and lists (see LISTS) are merged by id, item by item the same way, so
 * that things made on either side are all kept. b's order comes first (the
 * shared file's, which so stays put), then what only a has. The same two give
 * the same answer either way round, and merging the answer again changes
 * nothing (so two copies don't keep rewriting the file between them).
 */
export function mergeStates(a: SyncState, b: SyncState, now = Date.now()): SyncState {
  const out: SyncState = { values: {}, times: noTimes() };
  const cut = now - KEEP_GONE;
  const keys = new Set([...Object.keys(b.values), ...Object.keys(a.values), ...Object.keys(b.times.gone), ...Object.keys(a.times.gone)]);
  for (const k of keys) {
    if (!synced(k)) continue;
    const x = side(a, k);
    const y = side(b, k);
    const rule = LISTS[k];
    const list = rule && x.value !== null && y.value !== null ? mergeList(k, rule, a, b, x, y, out.times, cut) : null;
    if (list !== null) {
      out.values[k] = list;
      out.times.keys[k] = { t: Math.max(x.t, y.t), b: Math.min(x.b, y.b) };
      continue;
    }
    const [w, from] = wins(x, y) ? [x, a] : [y, b];
    if (w.value !== null) {
      out.values[k] = w.value;
      out.times.keys[k] = { t: w.t, b: Math.min(x.b, y.b) };
      if (rule) {
        // (the list came whole from one side: its items' times with it)
        if (from.times.items[k]) out.times.items[k] = { ...from.times.items[k] };
        const gone = Object.entries(from.times.goneItems[k] ?? {}).filter(([, t]) => t >= cut);
        if (gone.length) out.times.goneItems[k] = Object.fromEntries(gone);
      }
    } else if (w.t >= cut) out.times.gone[k] = w.t;
  }
  return out;
}

/** Two copies' lists, merged by id (see mergeStates); null if either isn't a list after all (then the newer is taken whole). */
function mergeList(k: string, rule: ListRule, a: SyncState, b: SyncState, x: Side, y: Side, times: Times, cut: number): string | null {
  const da = parse(x.value);
  const db = parse(y.value);
  const la = listIn(da, rule);
  const lb = listIn(db, rule);
  if (!la || !lb) return null;
  const ia = byId(la, rule);
  const ib = byId(lb, rule);
  const ta = a.times.items[k] ?? {};
  const tb = b.times.items[k] ?? {};
  const ga = a.times.goneItems[k] ?? {};
  const gb = b.times.goneItems[k] ?? {};
  const items: Record<string, number> = {};
  const gone: Record<string, number> = {};
  const list: unknown[] = [];
  for (const id of new Set([...ib.keys(), ...ia.keys(), ...Object.keys(gb), ...Object.keys(ga)])) {
    // (an item with no time was kept before there were times: oldest)
    const atA = ia.has(id) ? ta[id] ?? 0 : -1;
    const atB = ib.has(id) ? tb[id] ?? 0 : -1;
    const kept = Math.max(atA, atB);
    const removed = Math.max(ga[id] ?? -1, gb[id] ?? -1);
    if (removed > kept) {
      if (removed >= cut) gone[id] = removed;
      continue;
    }
    if (kept < 0) continue;
    let item = atA > atB ? ia.get(id) : ib.get(id);
    if (atA === atB && JSON.stringify(ia.get(id)) > JSON.stringify(ib.get(id))) item = ia.get(id);
    list.push(item);
    items[id] = kept;
  }
  // the rest of the value (and any items without an id) from the newer side
  const newer = wins(x, y) ? da : db;
  for (const item of newer === da ? la : lb) if (idOf(item, rule) === null) list.push(item);
  const data = withList(newer, rule, list) as Record<string, unknown>;
  if (rule.oldest && rule.field) {
    const older = (x.b !== y.b ? x.b < y.b : x.value! <= y.value!) ? da : db;
    for (const f of rule.oldest) data[f] = (older as Record<string, unknown>)[f];
  }
  if (Object.keys(items).length) times.items[k] = items;
  if (Object.keys(gone).length) times.goneItems[k] = gone;
  return JSON.stringify(data);
}

/** Recursively key-sorted JSON, to compare times (in whatever order their keys were made). */
function sorted(v: unknown): string {
  if (!v || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(sorted).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sorted((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** The same saves, the same times. */
export function sameState(a: SyncState, b: SyncState): boolean {
  const ka = Object.keys(a.values);
  if (ka.length !== Object.keys(b.values).length || ka.some((k) => a.values[k] !== b.values[k])) return false;
  return sorted(a.times) === sorted(b.times);
}

/** A sync or export file: one copy's saves, with their times. */
export function toFile(s: SyncState, from: string): string {
  return JSON.stringify({ blueberrySync: 1, from, at: Date.now(), values: s.values, times: s.times });
}

/** The saves in a sync or export file; null if it isn't one. */
export function fromFile(text: string): SyncState | null {
  const d = parse(text) as { blueberrySync?: unknown; values?: unknown; times?: unknown } | undefined;
  if (!d || typeof d !== 'object' || d.blueberrySync !== 1 || !d.values || typeof d.values !== 'object') return null;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.values)) if (synced(k) && typeof v === 'string') values[k] = v;
  return { values, times: readTimes(d.times) };
}

/** The game's store: localStorage's calls, with times kept for merging (see the top of this file). */
export class Store {
  readonly kind: StoreKind;
  private times: Times;
  private listeners = new Set<Listener>();
  /**
   * List items a merge changed since the game last read the list (null:
   * removed). The game may still hold the list as it read it before: when it
   * writes that back, these are kept as merged, not dropped as if it had
   * removed them.
   */
  private pending = new Map<string, Map<string, unknown>>();
  /** The last time given out: each change is later than the one before, even if the clock goes back. */
  private last = 0;

  constructor(private backing: Backing, private clock: () => number = Date.now) {
    this.kind = backing.kind;
    this.times = readTimes(parse(backing.get(TIMES_KEY)));
    for (const { t } of Object.values(this.times.keys)) this.last = Math.max(this.last, t);
    for (const t of Object.values(this.times.gone)) this.last = Math.max(this.last, t);
  }

  getItem(key: string): string | null {
    this.pending.delete(key);
    return this.backing.get(key);
  }

  setItem(key: string, value: string): void {
    value = String(value);
    const old = this.backing.get(key);
    const sync = synced(key);
    const rule = sync ? LISTS[key] : undefined;
    if (rule && this.pending.has(key)) value = this.keepPending(key, rule, value);
    // (the same again isn't a change: it would make an old setting look new to a merge)
    if (value === old) return;
    this.backing.set(key, value);
    if (sync) {
      const t = this.now();
      this.times.keys[key] = { t, b: this.times.keys[key]?.b ?? t };
      delete this.times.gone[key];
      if (rule) this.stamp(key, rule, old, value, t);
      this.saveTimes();
    }
    this.emit([key], false);
  }

  removeItem(key: string): void {
    if (this.backing.get(key) === null) return;
    this.backing.remove(key);
    this.pending.delete(key);
    if (synced(key)) {
      this.times.gone[key] = this.now();
      delete this.times.keys[key];
      delete this.times.items[key];
      delete this.times.goneItems[key];
      this.saveTimes();
    }
    this.emit([key], false);
  }

  /** The keys kept (the store's own aside). */
  keys(): string[] {
    return this.backing.keys().filter((k) => k !== TIMES_KEY);
  }

  /** Characters kept in all (about the bytes, in a file). */
  size(): number {
    let n = 0;
    for (const k of this.keys()) n += k.length + (this.backing.get(k)?.length ?? 0);
    return n;
  }

  /** Called after each change: the keys, and whether a merge made it (rather than the game). Returns a call that stops it. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The synced keys and their times: to merge, or to write to a file. */
  state(): SyncState {
    const values: Record<string, string> = {};
    for (const k of this.backing.keys()) {
      const v = synced(k) ? this.backing.get(k) : null;
      if (v !== null) values[k] = v;
    }
    return { values, times: readTimes(JSON.parse(JSON.stringify(this.times))) };
  }

  /**
   * Takes in merged saves (see mergeStates): the keys that differ are written,
   * and the times are the merge's. Returns the keys changed, and any that
   * couldn't be kept (a browser's storage full), which keep their own value and
   * time (the merge's then wins again next time, rather than this copy's
   * leftover passing for new).
   */
  adopt(s: SyncState): { changed: string[]; failed: string[] } {
    const changed: string[] = [];
    const failed: string[] = [];
    const was = this.times;
    this.times = readTimes(JSON.parse(JSON.stringify(s.times)));
    for (const k of new Set([...this.backing.keys(), ...Object.keys(s.values)])) {
      if (!synced(k)) continue;
      const mine = this.backing.get(k);
      const theirs = Object.hasOwn(s.values, k) ? s.values[k] : null;
      if (mine === theirs) continue;
      try {
        if (theirs === null) this.backing.remove(k);
        else this.backing.set(k, theirs);
      } catch {
        failed.push(k);
        for (const f of ['keys', 'gone', 'items', 'goneItems'] as const) {
          if (was[f][k] === undefined) delete this.times[f][k];
          else (this.times[f] as Record<string, unknown>)[k] = was[f][k];
        }
        continue;
      }
      const rule = LISTS[k];
      if (rule) this.notePending(k, rule, mine, theirs);
      changed.push(k);
    }
    for (const { t } of Object.values(this.times.keys)) this.last = Math.max(this.last, t);
    this.saveTimes();
    if (changed.length) this.emit(changed, true);
    return { changed, failed };
  }

  /** Writes what's waiting to disk now (the desktop's: its window is closing). */
  flush(): void {
    this.backing.flush?.();
  }

  private now(): number {
    this.last = Math.max(this.clock(), this.last + 1);
    return this.last;
  }

  private saveTimes(): void {
    try {
      this.backing.set(TIMES_KEY, JSON.stringify(this.times));
    } catch {
      // (storage full: the changes are kept, their times not; they merge as older than they are)
    }
  }

  private emit(keys: string[], bySync: boolean): void {
    for (const fn of this.listeners) {
      try {
        fn(keys, bySync);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** A list written by the game: new and changed items are stamped now, and those it no longer has are noted as removed. */
  private stamp(key: string, rule: ListRule, old: string | null, value: string, t: number): void {
    const before = byId(listIn(parse(old), rule), rule);
    const after = byId(listIn(parse(value), rule), rule);
    const items = (this.times.items[key] ??= {});
    const gone = (this.times.goneItems[key] ??= {});
    for (const [id, item] of after) {
      if (before.has(id) && JSON.stringify(before.get(id)) === JSON.stringify(item)) continue;
      items[id] = t;
      delete gone[id];
    }
    for (const id of before.keys()) {
      if (after.has(id)) continue;
      delete items[id];
      gone[id] = t;
    }
  }

  private notePending(key: string, rule: ListRule, mine: string | null, theirs: string | null): void {
    const before = byId(listIn(parse(mine), rule), rule);
    const after = byId(listIn(parse(theirs), rule), rule);
    const pend = this.pending.get(key) ?? new Map<string, unknown>();
    for (const [id, item] of after) if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) pend.set(id, item);
    for (const id of before.keys()) if (!after.has(id)) pend.set(id, null);
    if (pend.size) this.pending.set(key, pend);
  }

  /** The game's list with what a merge brought since it read it put back (see pending). */
  private keepPending(key: string, rule: ListRule, value: string): string {
    const pend = this.pending.get(key)!;
    const data = parse(value);
    const list = listIn(data, rule);
    if (!list) return value;
    const out: unknown[] = [];
    for (const item of list) {
      const id = idOf(item, rule);
      if (id === null || !pend.has(id)) out.push(item);
      else if (pend.get(id) !== null) out.push(pend.get(id));
    }
    const have = new Set(out.map((item) => idOf(item, rule)));
    for (const [id, item] of pend) if (item !== null && !have.has(id)) out.push(item);
    return JSON.stringify(withList(data, rule, out));
  }
}

export function memoryBacking(init: Record<string, string> = {}): Backing {
  const m = new Map(Object.entries(init));
  return {
    kind: 'memory',
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

function browserBacking(ls: Storage): Backing {
  return {
    kind: 'browser',
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? '').filter(Boolean),
  };
}

/** The desktop app's file, held here as read when the window opened; changes go to the app together, once per task. */
function desktopBacking(d: DesktopStore): Backing {
  const m = new Map(Object.entries(d.load()));
  let waiting: Record<string, string | null> | null = null;
  const send = () => {
    if (waiting) d.write(waiting);
    waiting = null;
  };
  const change = (k: string, v: string | null) => {
    if (!waiting) {
      waiting = {};
      queueMicrotask(send);
    }
    waiting[k] = v;
  };
  return {
    kind: 'desktop',
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
      change(k, v);
    },
    remove: (k) => {
      m.delete(k);
      change(k, null);
    },
    keys: () => [...m.keys()],
    flush: () => {
      d.flush(waiting ?? {});
      waiting = null;
    },
  };
}

function gameBacking(): Backing {
  if (typeof window === 'undefined') return memoryBacking();
  if (desktop) return desktopBacking(desktop.store);
  try {
    const ls = window.localStorage;
    ls.getItem(TIMES_KEY);
    return browserBacking(ls);
  } catch {
    // (a private window, or a browser told to keep nothing: kept until the page closes)
    return memoryBacking();
  }
}

/** The game's store (see Store). */
export const store = new Store(gameBacking());
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => store.flush());

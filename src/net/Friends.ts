import { cleanCode, randomCode, Wire, type Link, type Network } from './Link';
import { openBeacon, PresenceError, type Beacon } from './Presence';
import { cleanName } from './Host';
import { store as gameStore } from '../engine/Store';

/** Letters and digits in a friend code (a room code's alphabet; longer, as it's for keeps). */
export const FRIEND_CODE_LEN = 6;
/** Where it's all kept, unless told otherwise. */
const STORAGE_KEY = 'blueberry-friends';
/** Between looks for friends not connected (ms): the server is a free, shared one. */
const POLL = 30000;
/** The Friends panel opened looks again, if the last look was longer ago than this (ms). */
const REFRESH_GAP = 10000;
/** Between one call and the next in a look (ms): not all at once. */
const CALL_GAP = 250;
/** Someone long away is called every this many looks at most. */
const MAX_SKIP = 4;
/** Between tries to get on the network after it failed (ms). */
const RETRY = 60000;
/** A link silent this many looks long has died unnoticed (a background tab's timers run once a minute). */
const STALE_LOOKS = 5;
/** Two links between the same pair made within this long of each other were made together, both calling (ms): a call takes this long at most. */
const RACE = 20000;
/** How long a call from someone who's nothing to us is kept (ms), and a link let go of lingers (so the last word gets there). */
const STRANGER_WAIT = 10000;
const HANG_UP_WAIT = 600;
/** One invitation a friend this often at most (ms). */
const INVITE_GAP = 5000;
const MAX_FRIENDS = 100;
const MAX_REQUESTS = 20;
/** A request turned down is remembered this long to tell its sender (ms), then forgotten. */
const REFUSED_KEPT = 30 * 24 * 3600 * 1000;

/**
 * Where two players stand: `friend`, both agreed; `sent`, asked them;
 * `incoming`, they asked; `refused`, they asked and were told no (not shown:
 * kept until they've been told).
 */
type Rel = 'friend' | 'sent' | 'incoming' | 'refused';

/** What a player is doing, as their friends see it. */
export interface Activity {
  st: 'menu' | 'sandbox' | 'hosting' | 'playing';
  /** Hosting: the room code, what it's over, and how many are playing. */
  room?: string;
  net?: Network;
  n?: number;
}

/**
 * Whether a friend is there: `online`, connected now; `offline`, no answer
 * when last called; `unreachable`, there, but no connection could be made (a
 * firewall, or their browser blocks it); `checking`, not called yet.
 */
export type Seen = 'checking' | 'offline' | 'unreachable' | 'online';

/** Someone on the list, as the interface shows them. */
export interface Friend {
  readonly code: string;
  readonly name: string;
  readonly rel: 'friend' | 'sent' | 'incoming';
  readonly seen: Seen;
  /** What they're doing (friends who are online only). */
  readonly doing: Activity | null;
}

/** What friends say to each other: who they are and what they're doing, and invitations. */
type Msg =
  | { t: 'hi'; name: string; rel: Rel | 'none'; st?: Activity['st']; room?: string; net?: Network; n?: number }
  | { t: 'invite'; room: string; net: Network };

interface Entry {
  code: string;
  /** As they call themselves ('' before they've said). */
  name: string;
  rel: Rel;
  /** When it was added or last changed (Date.now()). */
  at: number;
  seen: Seen;
  doing: Activity | null;
  calling: boolean;
  /** Calls in a row they didn't answer (offline): they're called less often. */
  misses: number;
  invited: number;
}

/** A link to a friend: who called whom, when it was made, and when they were last heard (performance.now()). */
interface Conn {
  wire: Wire<Msg, Msg>;
  mine: boolean;
  at: number;
  heard: number;
}

interface Saved {
  v: 1;
  code: string;
  name: string;
  /** Presence on: the Friends panel was opened once, so it starts with the game. */
  on?: boolean;
  friends: { code: string; name: string; rel: Rel; at: number }[];
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export interface FriendsOptions {
  /** 'internet' (PeerJS), or 'local' (tabs of this browser: the tests'). */
  net?: Network;
  /** Where in the storage it's kept (the tests keep two players apart). */
  key?: string;
  /** Where it's kept (the game's store by default, see engine/Store; null: nowhere). */
  storage?: Store | null;
  /** Between looks for friends not connected (ms). */
  poll?: number;
}

/** A friend code as shown: in two halves, easier read out. */
export function showCode(code: string): string {
  return code.length === FRIEND_CODE_LEN ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

const validCode = (s: string) => s.length === FRIEND_CODE_LEN && cleanCode(s) === s;

function defaultStorage(): Store | null {
  return gameStore;
}

/** What a friend says they're doing, checked (null for nonsense). */
function activityOf(m: Extract<Msg, { t: 'hi' }>): Activity | null {
  const st = m.st;
  if (st !== 'menu' && st !== 'sandbox' && st !== 'hosting' && st !== 'playing') return null;
  if (st !== 'hosting') return { st };
  const room = cleanCode(String(m.room ?? '')).slice(0, 8);
  const n = Math.round(Number(m.n));
  return { st, room, net: m.net === 'local' ? 'local' : 'internet', n: n >= 1 && n <= 99 ? n : 1 };
}

/**
 * The friends list: who you are to others (a name, and a friend code kept in
 * the browser), who your friends are, and what they're up to.
 *
 * While the game is open, each player is on the friends network by their code
 * (see Presence). Friends who are both online keep a link between them, over
 * which each says who they are, where they stand (friends, asked, ...) and
 * what they're doing (in the menu, the sandbox, hosting a game: its code), as
 * it changes and once a look as a sign of life. Friends not connected are
 * called once a look (every 30 s; every 2 min for those long away), and when
 * the Friends panel opens; someone coming online calls their friends at once. Only names, where they stand,
 * what they're doing and invitations go between them.
 *
 * Asking: you add their code (`sent`); once they're reached, they have you as
 * `incoming`, to accept or refuse. Each says where they stand whenever they
 * meet, and both come round to the same thing, even when the answer was given
 * while the other was away: asked and accepted, friends; refused, the request
 * goes; removed, the other side lets go too.
 *
 * Nothing here throws, or waits on the network: when it can't get on, it says
 * why (`problem`) and tries again later.
 */
export class Friends {
  /** Your friend code: others add you by it. */
  readonly code: string;
  readonly net: Network;
  /** On the network: friends can reach you, and you them. */
  up = false;
  /** Why not ('' when it is, or before starting). */
  problem = '';
  /** A friend invites you to their game. */
  oninvite: ((from: Friend, room: string, net: Network) => void) | null = null;
  /** News for the player ("Ann accepted your friend request"). */
  onnews: ((msg: string) => void) | null = null;
  private _name = '';
  private on = false;
  private entries = new Map<string, Entry>();
  private links = new Map<string, Conn>();
  private beacon: Beacon | null = null;
  private opening = false;
  private halted = true;
  private pollMs: number;
  private pollTimer = 0;
  private retryTimer = 0;
  private lastLook = -Infinity;
  private looks = 0;
  private doing: Activity = { st: 'sandbox' };
  private listeners = new Set<() => void>();
  private store: Store | null;
  private key: string;
  private hooked = false;

  constructor(opts: FriendsOptions = {}) {
    this.net = opts.net ?? 'internet';
    this.key = opts.key ?? STORAGE_KEY;
    this.store = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.pollMs = opts.poll ?? POLL;
    const saved = this.load();
    this.code = saved?.code ?? randomCode(FRIEND_CODE_LEN);
    if (saved) {
      this._name = cleanName(saved.name, '');
      this.on = !!saved.on;
      const now = Date.now();
      for (const f of saved.friends) {
        if (f.rel === 'refused' && now - f.at > REFUSED_KEPT) continue;
        this.entries.set(f.code, this.entry(f.code, f.name, f.rel, f.at));
      }
    } else this.save();
  }

  /** Your name as you gave it ('' if you haven't). */
  get name(): string {
    return this._name;
  }

  /** Your name as friends see it. */
  get shownName(): string {
    return this._name || `Player ${this.code.slice(0, 3)}`;
  }

  /** Presence has been started once (the Friends panel opened): it starts with the game from then on. */
  get active(): boolean {
    return this.on;
  }

  /** Calls `fn` whenever something shown changes: the list, a friend's status, your name, the network. */
  listen(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Everyone on the list: friends, requests sent, requests to answer. */
  list(): Friend[] {
    const out: Friend[] = [];
    for (const e of this.entries.values()) if (e.rel !== 'refused') out.push(this.view(e));
    return out;
  }

  rename(name: string): void {
    const n = cleanName(name, '');
    if (n === this._name) return;
    this._name = n;
    this.save();
    for (const code of this.links.keys()) this.hello(code);
    this.changed();
  }

  /** Goes on the network (and from now on whenever the game opens). */
  start(): void {
    this.halted = false;
    if (!this.on) {
      this.on = true;
      this.save();
    }
    if (!this.hooked) {
      this.hooked = true;
      window.addEventListener('pagehide', this.pageHide);
      window.addEventListener('pageshow', this.pageShow);
    }
    void this.open();
  }

  /** Goes off it (the game closing; the tests). */
  stop(): void {
    this.halted = true;
    if (this.hooked) {
      this.hooked = false;
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('pageshow', this.pageShow);
    }
    this.close();
  }

  /** Looks for friends not connected now (or tries the network again), unless it just did: the Friends panel opening. */
  refresh(): void {
    const now = performance.now();
    if (now - this.lastLook < REFRESH_GAP) return;
    if (this.beacon) this.look(true);
    else if (this.on && !this.halted) {
      this.lastLook = now;
      void this.open();
    }
  }

  /** Asks someone to be friends, by their code; what's wrong, or null. */
  add(raw: string): string | null {
    const code = cleanCode(raw);
    if (code.length !== FRIEND_CODE_LEN) return `A friend code is ${FRIEND_CODE_LEN} letters and digits`;
    if (code === this.code) return 'That’s your own code: give it to a friend, and add theirs';
    const e = this.entries.get(code);
    if (e?.rel === 'friend') return `${e.name || showCode(code)} is already a friend`;
    if (e?.rel === 'sent') return 'Already asked: waiting for them to accept';
    if (e?.rel === 'incoming') {
      this.accept(code);
      return null;
    }
    if (!e && this.entries.size >= MAX_FRIENDS) return 'The friends list is full';
    // (one turned down earlier asks in turn now)
    if (e) this.set(e, 'sent');
    else this.entries.set(code, this.entry(code, '', 'sent', Date.now()));
    this.save();
    this.start();
    this.reach(code);
    this.changed();
    return null;
  }

  /** Says yes to someone's request. */
  accept(code: string): void {
    const e = this.entries.get(code);
    if (e?.rel !== 'incoming') return;
    this.set(e, 'friend');
    this.save();
    this.reach(code);
    this.changed();
  }

  /** Says no to someone's request: it goes from the list (and theirs, once they're told). */
  refuse(code: string): void {
    const e = this.entries.get(code);
    if (e?.rel !== 'incoming') return;
    this.set(e, 'refused');
    e.doing = null;
    this.save();
    this.hello(code);
    this.changed();
  }

  /** Takes someone off the list (a friend, or a request sent): they let go of you too, once they hear. */
  remove(code: string): void {
    if (!this.entries.delete(code)) return;
    this.save();
    this.hello(code);
    this.hangUp(code);
    this.changed();
  }

  /** Invites a friend who's online to the game you're hosting; false if they can't be told. */
  invite(code: string, room: string, net: Network): boolean {
    const c = this.links.get(code);
    if (this.entries.get(code)?.rel !== 'friend' || !c) return false;
    c.wire.send({ t: 'invite', room, net });
    return true;
  }

  /** What you're doing, for your friends (told to them as it changes). */
  setActivity(a: Activity): void {
    const d = this.doing;
    if (d.st === a.st && d.room === a.room && d.net === a.net && d.n === a.n) return;
    this.doing = a.st === 'hosting' ? { st: a.st, room: a.room, net: a.net, n: a.n } : { st: a.st };
    for (const [code] of this.links) if (this.entries.get(code)?.rel === 'friend') this.hello(code);
  }

  // ---- the network ---------------------------------------------------------------------

  private pageHide = () => this.close();
  private pageShow = (e: PageTransitionEvent) => {
    // (back from the browser's page cache: on again)
    if (e.persisted && !this.halted) void this.open();
  };

  private async open(): Promise<void> {
    if (this.beacon || this.opening || this.halted) return;
    this.opening = true;
    clearTimeout(this.retryTimer);
    try {
      const b = await openBeacon(this.net, this.code);
      if (this.halted || this.beacon) {
        b.close();
        return;
      }
      this.beacon = b;
      this.up = true;
      this.problem = '';
      b.onlink = (link, code) => this.adopt(code, link, false);
      b.onproblem = (why) => {
        this.problem = why;
        this.changed();
      };
      clearInterval(this.pollTimer);
      this.pollTimer = window.setInterval(() => this.look(), this.pollMs);
      // (coming online: friends hear at once)
      this.look(true);
    } catch (err) {
      this.problem = err instanceof Error ? err.message : String(err);
      const miss = err instanceof PresenceError ? err.miss : 'down';
      // (tried again later: the server back, the other tab closed)
      if (miss !== 'unsupported' && !this.halted) this.retryTimer = window.setTimeout(() => void this.open(), RETRY);
    } finally {
      this.opening = false;
      this.changed();
    }
  }

  /** Off the network: links closed, statuses unknown (the list stays). */
  private close(): void {
    clearInterval(this.pollTimer);
    clearTimeout(this.retryTimer);
    for (const c of this.links.values()) c.wire.close();
    this.links.clear();
    this.beacon?.close();
    this.beacon = null;
    this.up = false;
    this.problem = '';
    for (const e of this.entries.values()) {
      e.seen = 'checking';
      e.doing = null;
      e.calling = false;
    }
    this.changed();
  }

  /**
   * Calls everyone not connected whom we look for (friends, and those asked),
   * one after another; says hello to the rest. Someone away look after look is
   * called less often (down to every fourth look: they call us on coming
   * online anyway), unless it's `all` (the Friends panel opening).
   */
  private look(all = false): void {
    if (!this.beacon) return;
    const now = performance.now();
    this.lastLook = now;
    this.looks++;
    let i = 0;
    for (const e of this.entries.values()) {
      if ((e.rel !== 'friend' && e.rel !== 'sent') || e.calling || this.links.has(e.code)) continue;
      if (!all && e.misses > 1 && this.looks % Math.min(e.misses, MAX_SKIP) !== 0) continue;
      e.calling = true;
      window.setTimeout(() => void this.call(e), i++ * CALL_GAP);
    }
    // a sign of life on the links, and those silent too long let go
    const stale = this.pollMs * STALE_LOOKS;
    for (const [code, c] of [...this.links]) {
      if (now - c.heard > stale) this.drop(code, c);
      else this.hello(code);
    }
  }

  /** Gets in touch with someone now: hello if connected, else a call. */
  private reach(code: string): void {
    const e = this.entries.get(code);
    if (this.links.has(code)) this.hello(code);
    else if (e && this.beacon && !e.calling) {
      e.calling = true;
      void this.call(e);
    }
  }

  private async call(e: Entry): Promise<void> {
    const b = this.beacon;
    if (!b || this.links.has(e.code) || this.entries.get(e.code) !== e) {
      e.calling = false;
      return;
    }
    try {
      const link = await b.call(e.code);
      e.calling = false;
      if (this.beacon !== b) link.close();
      else this.adopt(e.code, link, true);
    } catch (err) {
      e.calling = false;
      // (they called us meanwhile, or we went off the network)
      if (this.links.has(e.code) || this.beacon !== b) return;
      const miss = err instanceof PresenceError ? err.miss : 'unreachable';
      if (miss === 'offline') e.misses++;
      const seen: Seen = miss === 'offline' ? 'offline' : miss === 'unreachable' ? 'unreachable' : e.seen;
      if (seen !== e.seen || e.doing) {
        e.seen = seen;
        e.doing = null;
        this.changed();
      }
    }
  }

  /**
   * A link to someone, called or calling. Both may call at once: of two links
   * made together between the same pair, both ends keep the one called by the
   * lower code. Otherwise the newer one is kept: they came back (a reload), and
   * the old one is dead, or soon will be.
   */
  private adopt(code: string, link: Link, mine: boolean): void {
    if (!validCode(code) || code === this.code) {
      link.close();
      return;
    }
    const now = performance.now();
    const old = this.links.get(code);
    const by = (m: boolean) => (m ? this.code : code);
    if (old && now - old.at < RACE && by(old.mine) !== by(mine) && by(old.mine) < by(mine)) {
      link.close();
      return;
    }
    const c: Conn = { wire: new Wire<Msg, Msg>(link), mine, at: now, heard: now };
    this.links.set(code, c);
    old?.wire.close();
    const e = this.entries.get(code);
    if (e) e.misses = 0;
    c.wire.onmessage = (m) => this.heard(code, c, m);
    c.wire.onclose = () => this.lost(code, c);
    this.hello(code);
    // someone who's nothing to us (and doesn't ask to be): hung up on soon
    window.setTimeout(() => {
      if (this.links.get(code) === c && !this.entries.has(code)) this.drop(code, c);
    }, STRANGER_WAIT);
  }

  private lost(code: string, c: Conn): void {
    if (this.links.get(code) !== c) return;
    this.links.delete(code);
    const e = this.entries.get(code);
    if (e && (e.seen !== 'offline' || e.doing)) {
      e.seen = 'offline';
      e.doing = null;
      this.changed();
    }
  }

  private drop(code: string, c: Conn): void {
    if (this.links.get(code) === c) this.links.delete(code);
    c.wire.close();
    const e = this.entries.get(code);
    if (e) {
      e.seen = 'checking';
      e.doing = null;
      this.changed();
    }
  }

  /** Lets go of the link to someone who's nothing to us now, once what was just said has gone. */
  private hangUp(code: string): void {
    const c = this.links.get(code);
    if (!c) return;
    window.setTimeout(() => {
      const rel = this.entries.get(code)?.rel;
      if (this.links.get(code) === c && (!rel || rel === 'refused')) this.drop(code, c);
    }, HANG_UP_WAIT);
  }

  /** Tells someone connected who we are, where we stand, and (friends only) what we're doing. */
  private hello(code: string): void {
    const c = this.links.get(code);
    if (!c) return;
    const rel = this.entries.get(code)?.rel ?? 'none';
    c.wire.send(rel === 'friend' ? { t: 'hi', name: this.shownName, rel, ...this.doing } : { t: 'hi', name: this.shownName, rel });
  }

  private heard(code: string, c: Conn, m: Msg): void {
    if (this.links.get(code) !== c || !m || typeof m !== 'object') return;
    c.heard = performance.now();
    if (m.t === 'hi') this.hi(code, m);
    else if (m.t === 'invite') this.invited(code, m);
  }

  /** Where they stand with us (`m.rel`), reconciled with where we stand with them. */
  private hi(code: string, m: Extract<Msg, { t: 'hi' }>): void {
    let e = this.entries.get(code);
    const before = e?.rel ?? 'none';
    const shown = e ? this.signature(e) : '';
    const name = cleanName(m.name, showCode(code));
    switch (m.rel) {
      case 'sent':
        // they ask: a request to answer (or both asked: friends)
        if (!e) {
          let asking = 0;
          for (const x of this.entries.values()) if (x.rel === 'incoming') asking++;
          if (asking < MAX_REQUESTS && this.entries.size < MAX_FRIENDS) {
            e = this.entry(code, name, 'incoming', Date.now());
            this.entries.set(code, e);
            this.news(`${name} wants to be your friend (see Friends)`);
          }
        } else if (e.rel === 'sent') {
          this.set(e, 'friend');
          this.news(`You and ${name} are friends now`);
        }
        break;
      case 'friend':
        if (e?.rel === 'sent') {
          this.set(e, 'friend');
          this.news(`${name} accepted your friend request`);
        }
        break;
      case 'refused':
        if (e?.rel === 'sent') {
          this.entries.delete(code);
          e = undefined;
          this.news(`${name} turned down your friend request`);
        }
        break;
      case 'none':
        // they removed us, or took back their request, or were told no: let go
        if (e && e.rel !== 'sent') {
          this.entries.delete(code);
          e = undefined;
        }
        break;
    }
    const renamed = !!e && e.name !== name;
    if (e) {
      e.name = name;
      e.seen = 'online';
      e.doing = e.rel === 'friend' ? activityOf(m) : null;
    }
    const after = e?.rel ?? 'none';
    if (after !== before || renamed) this.save();
    if (after !== before) this.hello(code);
    if (!e || e.rel === 'refused') this.hangUp(code);
    if (after !== before || (e ? this.signature(e) : '') !== shown) this.changed();
  }

  private invited(code: string, m: Extract<Msg, { t: 'invite' }>): void {
    const e = this.entries.get(code);
    if (e?.rel !== 'friend') return;
    const room = cleanCode(String(m.room ?? '')).slice(0, 8);
    const now = performance.now();
    if (!room || now - e.invited < INVITE_GAP) return;
    e.invited = now;
    this.oninvite?.(this.view(e), room, m.net === 'local' ? 'local' : 'internet');
  }

  // ---- the list ------------------------------------------------------------------------

  private entry(code: string, name: string, rel: Rel, at: number): Entry {
    return { code, name: cleanName(name, ''), rel, at, seen: 'checking', doing: null, calling: false, misses: 0, invited: -Infinity };
  }

  private set(e: Entry, rel: Rel): void {
    e.rel = rel;
    e.at = Date.now();
  }

  private view(e: Entry): Friend {
    return { code: e.code, name: e.name || showCode(e.code), rel: e.rel === 'refused' ? 'incoming' : e.rel, seen: e.seen, doing: e.doing };
  }

  /** What's shown of someone (a change to it is news to the interface). */
  private signature(e: Entry): string {
    const d = e.doing;
    return `${e.name}|${e.rel}|${e.seen}|${d ? `${d.st}|${d.room}|${d.net}|${d.n}` : ''}`;
  }

  private news(msg: string): void {
    this.onnews?.(msg);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private load(): Saved | null {
    let raw: string | null = null;
    try {
      raw = this.store?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Partial<Saved>;
      if (typeof s.code !== 'string' || !validCode(s.code)) return null;
      const rels: Rel[] = ['friend', 'sent', 'incoming', 'refused'];
      const friends = (Array.isArray(s.friends) ? s.friends : [])
        .filter((f) => f && typeof f.code === 'string' && validCode(f.code) && f.code !== s.code && rels.includes(f.rel))
        .slice(0, MAX_FRIENDS)
        .map((f) => ({ code: f.code, name: String(f.name ?? ''), rel: f.rel, at: Number(f.at) || Date.now() }));
      return { v: 1, code: s.code, name: String(s.name ?? ''), on: !!s.on, friends };
    } catch {
      return null;
    }
  }

  private save(): void {
    const s: Saved = {
      v: 1,
      code: this.code,
      name: this._name,
      on: this.on,
      friends: [...this.entries.values()].map((e) => ({ code: e.code, name: e.name, rel: e.rel, at: e.at })),
    };
    try {
      this.store?.setItem(this.key, JSON.stringify(s));
    } catch {
      // (a private window, or storage full: kept for this visit only)
    }
  }
}

import Peer, { type DataConnection } from 'peerjs';
import { LocalLink, PEER_PREFIX, PeerLink, tabId, type Link, type LocalMsg, type Network } from './Link';

/**
 * Why something on the friends network didn't work: `offline`, no one there
 * (a call); `unreachable`, there but no connection made (a firewall, or their
 * browser blocks it); `down`, the server can't be reached; `taken`, this friend
 * code is already online (the game open in another tab); `unsupported`, the
 * browser can't do it.
 */
export type Miss = 'offline' | 'unreachable' | 'down' | 'taken' | 'unsupported';

export class PresenceError extends Error {
  constructor(readonly miss: Miss, message: string) {
    super(message);
  }
}

/**
 * A player's presence on the friends network, while the game is open: friends
 * reach them by their friend code, and they call friends by theirs. Over the
 * internet it's a PeerJS peer of its own (`blueberry-playground-f-<code>`, on
 * the same free public server the games are found through); between tabs of
 * this browser, a BroadcastChannel (for the tests).
 */
export interface Beacon {
  /** Someone called: the link to them, and their friend code (as the network has it: it can't be faked). */
  onlink: ((link: Link, code: string) => void) | null;
  /** The server was lost (why), or is back (''). Links already made carry on meanwhile. */
  onproblem: ((why: string) => void) | null;
  /** Calls a friend by their code; fails with a PresenceError (offline, unreachable, down). */
  call(code: string): Promise<Link>;
  close(): void;
}

/** What a friend code is called on the PeerJS server. */
const presenceId = (code: string) => `${PEER_PREFIX}f-${code}`;
/** How long opening waits for the server (ms). */
const OPEN_WAIT = 20000;
/** How long a call waits for a friend who is there to connect (ms); one who isn't is known sooner. */
const CALL_WAIT = 15000;
/** Between tries to get back to the server after it dropped us (ms): it's a free one, shared. */
const RECONNECT_WAIT = 30000;
/** How long a call in this browser waits for an answer (ms): anyone there answers at once. */
const LOCAL_WAIT = 500;

const DOWN = 'Can’t reach the friends server: check the internet connection';

export async function openBeacon(net: Network, code: string): Promise<Beacon> {
  return net === 'local' ? openLocal(code) : openPeer(code);
}

// ---- over the internet (PeerJS) ------------------------------------------------------

/** The friend code in a presence peer's id ('' for anyone else's). */
function codeOf(peerId: string): string {
  const p = presenceId('');
  return peerId.startsWith(p) ? peerId.slice(p.length) : '';
}

async function openPeer(code: string): Promise<Beacon> {
  let peer: Peer;
  try {
    peer = new Peer(presenceId(code), { debug: 0 });
  } catch {
    throw new PresenceError('unsupported', 'This browser can’t connect to friends');
  }
  const res = await new Promise<true | string>((done) => {
    const timer = setTimeout(() => done('network'), OPEN_WAIT);
    peer.on('open', () => {
      clearTimeout(timer);
      done(true);
    });
    peer.on('error', (e) => {
      clearTimeout(timer);
      done(e.type);
    });
  });
  if (res === true) return new PeerBeacon(peer);
  peer.destroy();
  if (res === 'unavailable-id') throw new PresenceError('taken', 'The game is open in another tab or window: your friends see you there');
  if (res === 'browser-incompatible') throw new PresenceError('unsupported', 'This browser can’t connect to friends (it lacks WebRTC)');
  throw new PresenceError('down', DOWN);
}

class PeerBeacon implements Beacon {
  onlink: ((link: Link, code: string) => void) | null = null;
  onproblem: ((why: string) => void) | null = null;
  /** Calls waiting for an answer, by the peer called: how to give up on one. */
  private calls = new Map<string, (miss: Miss) => void>();
  private timer = 0;
  private closed = false;

  constructor(private peer: Peer) {
    peer.on('connection', (conn) => {
      const code = codeOf(conn.peer);
      // (only friend codes call here)
      if (!code) {
        conn.close();
        return;
      }
      conn.on('open', () => {
        if (!this.closed) this.onlink?.(new PeerLink(conn, null), code);
      });
    });
    peer.on('disconnected', () => {
      if (this.closed || peer.destroyed) return;
      this.onproblem?.('Lost the friends server: friends who come online can’t see you until it’s back');
      clearTimeout(this.timer);
      // (getting back fails while it's down: that comes back here, for another try later)
      this.timer = window.setTimeout(() => {
        if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
      }, RECONNECT_WAIT);
    });
    // (again after getting back)
    peer.on('open', () => this.onproblem?.(''));
    peer.on('error', (e) => {
      // no one with that id: the server says so (in the message) once the call has gone unanswered a few seconds
      if (e.type !== 'peer-unavailable') return;
      const id = /(\S+)$/.exec(e.message)?.[1] ?? '';
      this.calls.get(id)?.('offline');
    });
  }

  call(code: string): Promise<Link> {
    return new Promise<Link>((done, fail) => {
      const id = presenceId(code);
      let conn: DataConnection | undefined;
      try {
        conn = this.closed || this.peer.disconnected ? undefined : this.peer.connect(id, { reliable: true, serialization: 'raw' });
      } catch {
        conn = undefined;
      }
      if (!conn) {
        fail(new PresenceError('down', DOWN));
        return;
      }
      const c = conn;
      let settled = false;
      const miss = (m: Miss) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.calls.get(id) === miss) this.calls.delete(id);
        c.close();
        fail(new PresenceError(m, m === 'offline' ? 'Not online' : 'Couldn’t connect'));
      };
      const timer = window.setTimeout(() => miss('unreachable'), CALL_WAIT);
      this.calls.set(id, miss);
      c.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.calls.get(id) === miss) this.calls.delete(id);
        done(new PeerLink(c, null));
      });
      // (the connection couldn't be made: there, but out of reach)
      c.on('error', () => miss('unreachable'));
      c.on('close', () => miss('unreachable'));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    for (const miss of [...this.calls.values()]) miss('down');
    this.peer.destroy();
  }
}

// ---- between tabs of this browser (BroadcastChannel) -----------------------------------

const channelFor = (code: string) => new BroadcastChannel(`blueberry-friends:${code}`);

async function openLocal(code: string): Promise<Beacon> {
  try {
    return new LocalBeacon(code, channelFor(code));
  } catch {
    // (no BroadcastChannel, or not for this page: a file:// one, say)
    throw new PresenceError('unsupported', 'This browser can’t connect its tabs');
  }
}

/**
 * Presence between tabs: a channel named by the friend code, answered as a
 * local lobby is (see Link). Who calls says their code in their name on it.
 */
class LocalBeacon implements Beacon {
  onlink: ((link: Link, code: string) => void) | null = null;
  onproblem: ((why: string) => void) | null = null;
  private me: string;
  private links = new Map<string, LocalLink>();
  private open = true;
  private dialled = new Set<BroadcastChannel>();

  constructor(private code: string, private ch: BroadcastChannel) {
    this.me = `${code}:${tabId()}`;
    ch.onmessage = (ev) => {
      const m = ev.data as LocalMsg;
      if (m.k === 'hello' && !m.to && !this.links.has(m.from)) {
        const them = String(m.from).split(':')[0];
        if (!them) return;
        for (const [k, l] of this.links) if (l.closed) this.links.delete(k);
        const l = new LocalLink(ch, this.me, m.from, false);
        this.links.set(m.from, l);
        ch.postMessage({ k: 'ok', from: this.me, to: m.from } satisfies LocalMsg);
        this.onlink?.(l, them);
        return;
      }
      this.links.get(m.from)?.take(m);
    };
  }

  call(code: string): Promise<Link> {
    return new Promise<Link>((done, fail) => {
      if (!this.open) {
        fail(new PresenceError('down', DOWN));
        return;
      }
      let ch: BroadcastChannel;
      try {
        ch = channelFor(code);
      } catch {
        fail(new PresenceError('down', DOWN));
        return;
      }
      this.dialled.add(ch);
      const me = `${this.code}:${tabId()}`;
      let link: LocalLink | null = null;
      const timer = setTimeout(() => {
        this.dialled.delete(ch);
        ch.close();
        fail(new PresenceError('offline', 'Not online'));
      }, LOCAL_WAIT);
      ch.onmessage = (ev) => {
        const m = ev.data as LocalMsg;
        if (!link && m.k === 'ok' && m.to === me) {
          clearTimeout(timer);
          this.dialled.delete(ch);
          link = new LocalLink(ch, me, m.from, true);
          done(link);
          return;
        }
        link?.take(m);
      };
      ch.postMessage({ k: 'hello', from: me } satisfies LocalMsg);
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const l of this.links.values()) l.close();
    this.links.clear();
    // (calls still waiting give up)
    for (const ch of this.dialled) ch.close();
    this.dialled.clear();
    this.ch.close();
  }
}

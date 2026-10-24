import Peer, { type DataConnection } from 'peerjs';

/** A message channel to one other player: strings each way (see Wire for messages). */
export interface Link {
  send(s: string): void;
  onmessage: ((s: string) => void) | null;
  /** The other end went away (or the connection dropped). */
  onclose: (() => void) | null;
  close(): void;
}

/** A hosted game waiting for players: they join with its code. */
export interface Lobby {
  readonly code: string;
  onjoin: ((link: Link) => void) | null;
  /** The lobby itself was lost (the signalling server went away): no one else can join. */
  onlost: ((why: string) => void) | null;
  close(): void;
}

/**
 * How players find each other: over the internet (WebRTC, introduced by PeerJS's
 * free public server, after which the game's data goes straight between the
 * players), or between tabs of this browser (for trying it out, and the tests).
 */
export type Network = 'internet' | 'local';

/** Room codes: letters and digits that can't be mistaken for each other. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
/** What a room code is called on the PeerJS server (codes are short: this keeps them ours). */
export const PEER_PREFIX = 'blueberry-playground-';
/** How long joining waits for the host before giving up (ms). */
const JOIN_TIMEOUT = 15000;

/** A room code (or, longer, a friend code: see Friends). */
export function randomCode(len = CODE_LEN): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** A typed-in code as the host has it: capitals, nothing else. */
export function cleanCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function openLobby(net: Network): Promise<Lobby> {
  return net === 'local' ? openLocal() : openInternet();
}

export function joinLobby(net: Network, code: string): Promise<Link> {
  return net === 'local' ? joinLocal(code) : joinInternet(code);
}

// ---- over the internet (PeerJS) ------------------------------------------------------

export class PeerLink implements Link {
  onmessage: ((s: string) => void) | null = null;
  onclose: (() => void) | null = null;
  private closed = false;

  constructor(private conn: DataConnection, private owned: Peer | null) {
    conn.on('data', (d) => {
      if (typeof d === 'string') this.onmessage?.(d);
    });
    conn.on('close', () => this.gone());
    conn.on('error', () => this.gone());
  }

  send(s: string): void {
    if (!this.closed && this.conn.open) this.conn.send(s);
  }

  private gone(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
    this.conn.close();
    this.owned?.destroy();
  }
}

/** What went wrong, for people. */
export function peerError(type: string): string {
  switch (type) {
    case 'peer-unavailable': return 'No game with that code (check it, or ask the host for a new one)';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'Can’t reach the matchmaking server: check the internet connection';
    case 'browser-incompatible': return 'This browser can’t play online (it lacks WebRTC)';
    default: return `Connection failed (${type})`;
  }
}

async function openInternet(): Promise<Lobby> {
  // (a taken code is unlikely: try another few)
  for (let attempt = 0; ; attempt++) {
    const code = randomCode();
    const peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    const res = await new Promise<true | string>((done) => {
      peer.on('open', () => done(true));
      peer.on('error', (e) => done(e.type));
    });
    if (res === true) {
      const lobby: Lobby = {
        code,
        onjoin: null,
        onlost: null,
        close: () => peer.destroy(),
      };
      peer.on('connection', (conn) => {
        conn.on('open', () => lobby.onjoin?.(new PeerLink(conn, null)));
      });
      peer.on('disconnected', () => {
        // the server dropped us: try to get back (players already in stay connected meanwhile)
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (e) => {
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') lobby.onlost?.(peerError(e.type));
      });
      return lobby;
    }
    peer.destroy();
    if (res !== 'unavailable-id' || attempt >= 3) throw new Error(peerError(res));
  }
}

async function joinInternet(code: string): Promise<Link> {
  const peer = new Peer({ debug: 0 });
  return new Promise<Link>((done, fail) => {
    const timer = setTimeout(() => {
      peer.destroy();
      fail(new Error('The host didn’t answer: check the code, and that they’re still hosting'));
    }, JOIN_TIMEOUT);
    peer.on('error', (e) => {
      clearTimeout(timer);
      peer.destroy();
      fail(new Error(peerError(e.type)));
    });
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + cleanCode(code), { reliable: true, serialization: 'raw' });
      conn.on('open', () => {
        clearTimeout(timer);
        done(new PeerLink(conn, peer));
      });
    });
  });
}

// ---- between tabs of this browser (BroadcastChannel) -----------------------------------

export interface LocalMsg {
  k: 'hello' | 'ok' | 'msg' | 'bye';
  from: string;
  to?: string;
  s?: string;
}

export class LocalLink implements Link {
  onmessage: ((s: string) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(private ch: BroadcastChannel, private me: string, private them: string, private own: boolean) {}

  send(s: string): void {
    if (!this.closed) this.ch.postMessage({ k: 'msg', from: this.me, to: this.them, s } satisfies LocalMsg);
  }

  /** A message on the channel: ours if it's from them, to us. */
  take(m: LocalMsg): void {
    if (m.from !== this.them || m.to !== this.me || this.closed) return;
    if (m.k === 'msg') this.onmessage?.(m.s ?? '');
    else if (m.k === 'bye') {
      this.closed = true;
      // (a channel of its own, opened to call: done with)
      if (this.own) this.ch.close();
      this.onclose?.();
    }
  }

  close(): void {
    if (this.closed) return;
    this.ch.postMessage({ k: 'bye', from: this.me, to: this.them } satisfies LocalMsg);
    this.closed = true;
    if (this.own) this.ch.close();
  }
}

const channelFor = (code: string) => new BroadcastChannel(`blueberry-net:${cleanCode(code)}`);
export const tabId = () => Math.random().toString(36).slice(2, 10);

async function openLocal(): Promise<Lobby> {
  const code = randomCode();
  const ch = channelFor(code);
  const me = tabId();
  const links = new Map<string, LocalLink>();
  const lobby: Lobby = {
    code,
    onjoin: null,
    onlost: null,
    close: () => {
      for (const l of links.values()) l.close();
      ch.close();
    },
  };
  ch.onmessage = (ev) => {
    const m = ev.data as LocalMsg;
    if (m.k === 'hello' && !links.has(m.from)) {
      const l = new LocalLink(ch, me, m.from, false);
      links.set(m.from, l);
      ch.postMessage({ k: 'ok', from: me, to: m.from } satisfies LocalMsg);
      lobby.onjoin?.(l);
      return;
    }
    links.get(m.from)?.take(m);
  };
  return lobby;
}

async function joinLocal(code: string): Promise<Link> {
  const ch = channelFor(code);
  const me = tabId();
  return new Promise<Link>((done, fail) => {
    let link: LocalLink | null = null;
    const timer = setTimeout(() => {
      ch.close();
      fail(new Error('No game with that code in this browser'));
    }, 3000);
    ch.onmessage = (ev) => {
      const m = ev.data as LocalMsg;
      if (!link && m.k === 'ok' && m.to === me) {
        clearTimeout(timer);
        link = new LocalLink(ch, me, m.from, true);
        done(link);
        return;
      }
      link?.take(m);
    };
    ch.postMessage({ k: 'hello', from: me } satisfies LocalMsg);
  });
}

// ---- messages ----------------------------------------------------------------------------

/** Longest string sent in one piece (longer ones go in chunks: data channels have a limit). */
const CHUNK = 60000;

/**
 * Messages (plain objects, as JSON) over a link, long ones cut into chunks and
 * put back together at the other end.
 */
export class Wire<In, Out> {
  onmessage: ((m: In) => void) | null = null;
  onclose: (() => void) | null = null;
  private parts: string[] = [];
  /** Characters sent and received so far (for the network readout). */
  sent = 0;
  received = 0;

  constructor(readonly link: Link) {
    link.onmessage = (s) => this.receive(s);
    link.onclose = () => this.onclose?.();
  }

  send(m: Out): void {
    this.sendRaw(JSON.stringify(m));
  }

  /** A message already turned into JSON (the same one sent to everyone). */
  sendRaw(s: string): void {
    this.sent += s.length;
    if (s.length <= CHUNK) {
      this.link.send('=' + s);
      return;
    }
    for (let i = 0; i < s.length; i += CHUNK) this.link.send((i + CHUNK >= s.length ? '=' : '+') + s.slice(i, i + CHUNK));
  }

  private receive(s: string): void {
    this.received += s.length;
    // '+' starts or continues a message in chunks, '=' ends one
    this.parts.push(s.slice(1));
    if (s[0] !== '=') return;
    const all = this.parts.length === 1 ? this.parts[0] : this.parts.join('');
    this.parts = [];
    let m: In;
    try {
      m = JSON.parse(all) as In;
    } catch {
      return;
    }
    this.onmessage?.(m);
  }

  close(): void {
    this.link.close();
  }
}

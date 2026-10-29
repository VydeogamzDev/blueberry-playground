import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import { cleanCode, joinLobby, openLobby, type Network } from './Link';
import { NetHost } from './Host';
import { NetClient } from './Guest';
import type { PlayerInfo } from './protocol';

/** Someone else's cursor, for drawing it. */
export interface RemoteCursor extends PlayerInfo {
  x: number;
  y: number;
}

/**
 * Multiplayer, as the interface sees it: hosting a game, joining one by its
 * code, leaving; who's in it and where their cursors are.
 */
export class Session {
  host: NetHost | null = null;
  guest: NetClient | null = null;
  /** The room code of the game hosted or joined ('' playing alone). */
  code = '';
  /** What it was hosted or joined over (for friends: their Join needs it). */
  net: Network = 'internet';
  /** Busy hosting or joining (the dialog waits). */
  busy = false;
  /** Something changed: hosting, joined, left, who's in it. */
  onchange: (() => void) | null = null;

  constructor(private game: Game, private controls: Controls) {}

  get role(): 'off' | 'host' | 'guest' {
    return this.host ? 'host' : this.guest ? 'guest' : 'off';
  }

  get players(): PlayerInfo[] {
    return this.host?.players ?? this.guest?.players ?? [];
  }

  /** This player's number in the game (0 alone). */
  get me(): number {
    return this.host ? 1 : this.guest?.you ?? 0;
  }

  /** Starts hosting this game: others can join with the code it gets. */
  async hostGame(net: Network, name: string): Promise<string> {
    this.leave();
    this.busy = true;
    this.onchange?.();
    try {
      const lobby = await openLobby(net);
      const host = new NetHost(this.game, this.controls, lobby, name);
      host.onplayers = () => this.onchange?.();
      host.ontoast = (msg) => this.controls.ui.toast(msg);
      lobby.onlost = (why) => this.controls.ui.toast(`${why}: no one else can join now`);
      this.game.net = host.role;
      this.game.keepRunning(true);
      this.host = host;
      this.code = lobby.code;
      this.net = net;
      return lobby.code;
    } finally {
      this.busy = false;
      this.onchange?.();
    }
  }

  /** Joins someone's game by its code (what's here now is replaced by theirs). */
  async join(net: Network, code: string, name: string): Promise<void> {
    this.leave();
    const c = cleanCode(code);
    if (!c) throw new Error('Type in the code of the game to join');
    this.busy = true;
    this.onchange?.();
    try {
      const link = await joinLobby(net, c);
      const guest = new NetClient(this.game, this.controls, link, name);
      guest.onplayers = () => this.onchange?.();
      guest.onclose = () => {
        this.game.keepRunning(false);
        this.guest = null;
        this.code = '';
        this.controls.ui.toast('Lost the connection to the host: carrying on alone');
        this.onchange?.();
      };
      this.guest = guest;
      this.game.keepRunning(true);
      this.code = c;
      this.net = net;
    } finally {
      this.busy = false;
      this.onchange?.();
    }
  }

  /** Stops hosting, or leaves the game joined (keeping what's in it). */
  leave(): void {
    this.game.keepRunning(false);
    if (this.host) {
      this.host.stop();
      this.host = null;
      this.game.net = null;
    }
    if (this.guest) {
      const g = this.guest;
      this.guest = null;
      g.leave();
    }
    if (this.code) {
      this.code = '';
      this.onchange?.();
    }
  }

  /** Where everyone else's cursor is. */
  cursors(): RemoteCursor[] {
    const out: RemoteCursor[] = [];
    const who = new Map(this.players.map((p) => [p.id, p]));
    const add = (id: number, x: number, y: number) => {
      const p = who.get(id);
      if (p) out.push({ ...p, x, y });
    };
    if (this.host) {
      for (const g of this.host.guests.values()) if (g.cursor) add(g.id, g.cursor.x, g.cursor.y);
    } else if (this.guest) {
      for (const [id, c] of this.guest.cursors) add(id, c.x, c.y);
    }
    return out;
  }
}

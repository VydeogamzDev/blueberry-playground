import { showCode, type Activity, type Friend, type Friends } from '../net/Friends';
import type { Network } from '../net/Link';

/** What the Friends panel needs of multiplayer (the Session; the tests give it a stand-in). */
export interface FriendsSession {
  readonly role: 'off' | 'host' | 'guest';
  readonly code: string;
  readonly net: Network;
  readonly players: readonly unknown[];
  readonly busy: boolean;
}

/** What it needs of the rest of the interface. */
export interface FriendsHooks {
  /** Joins a game by its code (a friend's, from the list or an invitation); throws what went wrong. */
  join(net: Network, room: string): Promise<void>;
  toast(msg: string): void;
  /** The main menu is up (friends see "in the menu"). */
  inMenu(): boolean;
}

/** How long an invitation stays up unanswered (ms). */
const INVITE_SHOWN = 30000;
/** Between checks of what the player is doing, for their friends (ms). */
const SYNC_EVERY = 500;
/** How long a Remove waits for its second click (ms). */
const CONFIRM_WAIT = 3000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Friends in the order they're listed: requests to answer, then who's hosting, online, away; requests sent last. */
function rank(f: Friend): number {
  if (f.rel === 'incoming') return 0;
  if (f.rel === 'sent') return 5;
  if (f.seen !== 'online') return f.seen === 'offline' ? 4 : 3;
  return f.doing?.st === 'hosting' ? 1 : 2;
}

function doingText(d: Activity | null): string {
  switch (d?.st) {
    case 'hosting': return `Hosting a game · ${d.n ?? 1} playing`;
    case 'playing': return 'Online · in a game';
    case 'menu': return 'Online · in the menu';
    case 'sandbox': return 'Online · in the sandbox';
    default: return 'Online';
  }
}

/**
 * The Friends panel: your name and friend code, adding friends by theirs,
 * answering requests, and the list (who's online, who's hosting: Join; while
 * you host: Invite). Built into an overlay box the UI gives it, like the
 * Multiplayer panel. It also keeps the friends told what the player is doing,
 * and puts up their invitations.
 */
export class FriendsPanel {
  /** What changes (messages, the list), redrawn as it does; the fields above it stay put, so typing in them goes on. */
  private body: HTMLDivElement;
  private name: HTMLInputElement;
  private code: HTMLInputElement;
  private error = '';
  private news = '';
  /** The friend whose Remove was clicked once (it asks again), and when. */
  private confirm = { code: '', at: 0 };
  /** Friends invited while this game is hosted (their Invite says so). */
  private invited = new Set<string>();
  private invitedRoom = '';
  private shown = false;
  private lastSync = -Infinity;
  private invite: InviteBar;

  constructor(private friends: Friends, private session: FriendsSession, private box: HTMLDivElement, close: () => void, root: HTMLElement, private hooks: FriendsHooks) {
    box.classList.add('net-panel', 'fr-panel');
    box.appendChild(el('div', 'panel-title', 'Friends'));
    this.name = el('input', 'search net-input');
    this.name.placeholder = 'Your name';
    this.name.maxLength = 20;
    this.name.value = friends.name;
    this.name.onchange = () => friends.rename(this.name.value);
    this.code = el('input', 'search net-input net-code');
    this.code.placeholder = 'Their code';
    this.code.maxLength = 8;
    this.code.spellcheck = false;
    this.code.autocomplete = 'off';
    this.code.onkeydown = (e) => {
      if (e.key === 'Enter') this.add();
    };
    // who you are
    const me = el('div', 'set-row');
    me.append(el('span', '', 'Your name'), this.name);
    const head = el('div', 'net-head');
    const copy = this.button('Copy', () => {
      void navigator.clipboard?.writeText(showCode(friends.code)).catch(() => {});
      copy.textContent = 'Copied';
    }, 'net-copy');
    head.append(el('span', '', 'Your friend code'), el('span', 'net-room', showCode(friends.code)), copy);
    // adding
    const add = el('div', 'set-row');
    const right = el('div', 'net-inline');
    right.append(this.code, this.button('Add', () => this.add()));
    add.append(el('span', '', 'Add a friend'), right);
    this.body = el('div', 'net-body');
    box.append(
      me, head,
      el('div', 'panel-note net-small', 'Give it to friends: they add you with it, and you them with theirs.'),
      add, this.body,
      el('div', 'panel-note net-small', 'Friends see your name, whether you’re online, and the code of a game you host; nothing else. It goes through PeerJS’s free public server, as multiplayer does.'),
    );
    const shut = el('button', 'panel-close', 'Close');
    shut.onclick = close;
    box.appendChild(shut);
    this.invite = new InviteBar(root);
    friends.listen(() => {
      if (document.activeElement !== this.name && this.name.value !== friends.name) this.name.value = friends.name;
      if (this.shown) this.render();
    });
    friends.onnews = (msg) => {
      this.news = msg;
      hooks.toast(msg);
      if (this.shown) this.render();
    };
    friends.oninvite = (from, room, net) => {
      // (already there, or on the way)
      if (this.session.busy || (this.session.code === room && this.session.role !== 'off')) return;
      this.invite.show(`${from.name} invites you to their game`, () => void this.join(net, room));
    };
    // (on the network from the start, once it's been used)
    if (friends.active) friends.start();
    this.render();
  }

  /** Called every frame: notices the panel opening, and tells friends what the player's doing as it changes. */
  frame(): void {
    const overlay = this.box.parentElement;
    const shown = !!overlay && !overlay.classList.contains('hidden');
    if (shown && !this.shown) this.opened();
    this.shown = shown;
    const now = performance.now();
    if (now - this.lastSync < SYNC_EVERY) return;
    this.lastSync = now;
    const s = this.session;
    if (s.role === 'host') this.friends.setActivity({ st: 'hosting', room: s.code, net: s.net, n: s.players.length });
    else this.friends.setActivity({ st: s.role === 'guest' ? 'playing' : this.hooks.inMenu() ? 'menu' : 'sandbox' });
    if (s.role !== 'host' || s.code !== this.invitedRoom) {
      this.invitedRoom = s.role === 'host' ? s.code : '';
      this.invited.clear();
    }
  }

  /** The panel's up: on the network (from now on, whenever the game opens), and a fresh look for friends. */
  private opened(): void {
    this.error = '';
    this.news = '';
    this.friends.start();
    this.friends.refresh();
    this.render();
  }

  private button(label: string, fn: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', 'panel-btn' + (cls ? ' ' + cls : ''), label);
    b.onclick = fn;
    return b;
  }

  private add(): void {
    this.news = '';
    const err = this.friends.add(this.code.value);
    this.error = err ?? '';
    if (!err) this.code.value = '';
    this.render();
  }

  private async join(net: Network, room: string): Promise<void> {
    this.error = '';
    this.invite.hide();
    try {
      await this.hooks.join(net, room);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      this.hooks.toast(msg);
    }
    this.render();
  }

  private row(f: Friend): HTMLElement {
    const s = this.session;
    const r = el('div', 'fr-row');
    const state = f.rel !== 'friend' ? 'ask' : f.seen !== 'online' ? 'away' : f.doing?.st === 'hosting' ? 'hosting' : 'online';
    r.appendChild(el('i', `fr-dot fr-${state}`));
    const who = el('div', 'fr-who');
    who.appendChild(el('span', 'fr-name', f.name));
    let status: string;
    if (f.rel === 'incoming') status = 'Wants to be your friend';
    else if (f.rel === 'sent') status = f.seen === 'online' ? 'Request sent: waiting for them to accept' : 'Request sent: it reaches them when they’re online';
    else if (f.seen === 'online') status = doingText(f.doing);
    else if (f.seen === 'offline') status = 'Offline';
    else if (f.seen === 'unreachable') status = 'Can’t connect (their network or browser blocks it)';
    else status = this.friends.up ? 'Looking…' : 'Not known';
    who.appendChild(el('span', 'fr-status', status));
    r.appendChild(who);
    const acts = el('div', 'fr-acts');
    if (f.rel === 'incoming') {
      acts.append(
        this.button('Accept', () => this.friends.accept(f.code)),
        this.button('Refuse', () => this.friends.refuse(f.code)),
      );
    } else {
      const d = f.doing;
      if (f.seen === 'online' && d?.st === 'hosting' && d.room && !(s.role !== 'off' && s.code === d.room)) {
        const join = this.button('Join', () => void this.join(d.net ?? 'internet', d.room!));
        join.disabled = s.busy;
        acts.appendChild(join);
      } else if (f.rel === 'friend' && f.seen === 'online' && s.role === 'host' && d?.st !== 'hosting') {
        const sent = this.invited.has(f.code);
        const inv = this.button(sent ? 'Invited' : 'Invite', () => {
          if (this.friends.invite(f.code, s.code, s.net)) this.invited.add(f.code);
          else this.error = `Couldn’t reach ${f.name}`;
          this.render();
        });
        inv.disabled = sent;
        acts.appendChild(inv);
      }
      const sure = this.confirm.code === f.code && performance.now() - this.confirm.at < CONFIRM_WAIT;
      const label = f.rel === 'sent' ? 'Cancel' : sure ? 'Remove?' : '×';
      const rm = this.button(label, () => {
        if (f.rel === 'friend' && !sure) this.confirm = { code: f.code, at: performance.now() };
        else this.friends.remove(f.code);
        this.render();
      });
      rm.title = f.rel === 'sent' ? 'Take back the request' : `Remove ${f.name} from your friends`;
      acts.appendChild(rm);
    }
    r.appendChild(acts);
    return r;
  }

  render(): void {
    const fr = this.friends;
    const b = this.body;
    b.replaceChildren();
    if (this.error) b.appendChild(el('div', 'net-error', this.error));
    else if (this.news) b.appendChild(el('div', 'panel-note net-small fr-news', this.news));
    // the list
    const list = el('div', 'fr-list');
    const all = fr.list().sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
    for (const f of all) list.appendChild(this.row(f));
    if (!all.length) list.appendChild(el('div', 'panel-note fr-empty', 'No friends yet: add one with their code.'));
    b.appendChild(list);
    if (fr.problem) b.appendChild(el('div', 'net-error', fr.problem));
    else if (fr.active && !fr.up) b.appendChild(el('div', 'panel-note net-small', 'Connecting…'));
  }
}

/** A friend's invitation: who, with Join and Dismiss (over everything, the main menu too). */
class InviteBar {
  private el: HTMLDivElement;
  private text: HTMLSpanElement;
  private go: (() => void) | null = null;
  private timer = 0;

  constructor(root: HTMLElement) {
    this.el = el('div', 'fr-invite hidden');
    this.el.setAttribute('role', 'alert');
    this.text = el('span', 'fr-invite-text');
    const join = el('button', 'panel-btn', 'Join');
    join.onclick = () => this.go?.();
    const dismiss = el('button', 'panel-btn', 'Dismiss');
    dismiss.onclick = () => this.hide();
    const btns = el('div', 'fr-acts');
    btns.append(join, dismiss);
    this.el.append(this.text, btns);
    root.appendChild(this.el);
  }

  show(text: string, go: () => void): void {
    this.text.textContent = text;
    this.go = go;
    this.el.classList.remove('hidden');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), INVITE_SHOWN);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.go = null;
    this.el.classList.add('hidden');
  }
}

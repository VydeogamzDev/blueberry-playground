import type { Game } from '../world/Game';
import type { Session } from '../net/Session';
import type { Network } from '../net/Link';
import type { Friends } from '../net/Friends';
import { store } from '../engine/Store';

const NAME_KEY = 'blueberry-player-name';
/** How quickly drawn cursors catch up with where they were last heard to be (per second). */
const CURSOR_EASE = 18;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function storedName(): string {
  try {
    return store.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeName(name: string): void {
  try {
    store.setItem(NAME_KEY, name);
  } catch {
    // (a private window: asked again next time)
  }
}

/** The friends list, for the Multiplayer panel: a button to it, and one name for both. */
export interface MultiplayerFriends {
  service: Friends;
  open(): void;
}

/**
 * The Multiplayer panel: host a game (and see its code and who's in it), or
 * join one by its code; leave. Built into an overlay box the UI gives it.
 */
export class MultiplayerPanel {
  private error = '';
  private name: HTMLInputElement;
  private code: HTMLInputElement;
  private net: HTMLSelectElement;
  private body: HTMLDivElement;

  constructor(private session: Session, box: HTMLDivElement, close: () => void, private friends?: MultiplayerFriends) {
    box.classList.add('net-panel');
    box.appendChild(el('div', 'panel-title', 'Multiplayer'));
    this.body = el('div', 'net-body');
    box.appendChild(this.body);
    this.name = el('input', 'search net-input');
    this.name.placeholder = 'Your name';
    this.name.maxLength = 20;
    this.name.value = storedName();
    this.name.onchange = () => {
      storeName(this.name.value.trim());
      friends?.service.rename(this.name.value);
    };
    if (friends) {
      // one name for both: the friends list's (what friends know you by), or the one typed here before it had one
      const f = friends.service;
      if (!f.name && this.name.value) f.rename(this.name.value);
      const follow = () => {
        if (document.activeElement === this.name || !f.name || this.name.value === f.name) return;
        this.name.value = f.name;
        storeName(f.name);
      };
      follow();
      f.listen(follow);
    }
    this.code = el('input', 'search net-input net-code');
    this.code.placeholder = 'Code';
    this.code.maxLength = 8;
    this.code.spellcheck = false;
    this.code.onkeydown = (e) => {
      if (e.key === 'Enter') void this.join();
    };
    this.net = el('select', 'tb-select');
    for (const [v, label] of [['internet', 'Internet'], ['local', 'Tabs of this browser']] as const) {
      const o = el('option', '', label);
      o.value = v;
      this.net.appendChild(o);
    }
    const shut = el('button', 'panel-close', 'Close');
    shut.onclick = close;
    box.appendChild(shut);
    session.onchange = () => this.render();
    this.render();
  }

  private row(label: string, ...input: HTMLElement[]): HTMLElement {
    const r = el('div', 'set-row');
    r.appendChild(el('span', '', label));
    const right = el('div', 'net-inline');
    right.append(...input);
    r.appendChild(right);
    return r;
  }

  private button(label: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', 'panel-btn', label);
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  }

  private playerName(): string {
    const n = this.name.value.trim();
    storeName(n);
    return n;
  }

  private async host(): Promise<void> {
    this.error = '';
    try {
      await this.session.hostGame(this.net.value as Network, this.playerName());
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }

  private async join(): Promise<void> {
    this.error = '';
    try {
      await this.session.join(this.net.value as Network, this.code.value, this.playerName());
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }

  render(): void {
    const s = this.session;
    const b = this.body;
    b.replaceChildren();
    if (s.role === 'off') {
      b.appendChild(el('div', 'panel-note', 'Play in one sandbox together: one of you hosts, the others join with the host’s code.'));
      b.appendChild(this.row('Your name', this.name));
      b.appendChild(this.row('Connect over', this.net));
      const host = this.button(s.busy ? 'Starting…' : 'Host a game', () => void this.host(), s.busy);
      b.appendChild(this.row('Share this sandbox', host));
      const join = this.button(s.busy ? 'Joining…' : 'Join', () => void this.join(), s.busy);
      b.appendChild(this.row('Join a game', this.code, join));
      const friends = this.friends;
      if (friends) b.appendChild(this.row('Play with friends',this.button('Friends…', () => friends.open())));
      b.appendChild(el('div', 'panel-note net-small', 'Joining swaps what’s on your screen for the host’s sandbox. When you leave, you keep a copy of it.'));
    } else {
      const head = el('div', 'net-head');
      head.appendChild(el('span', '', s.role === 'host' ? 'Hosting · code' : 'Joined · code'));
      const code = el('span', 'net-room', s.code);
      head.appendChild(code);
      const copy = this.button('Copy', () => {
        void navigator.clipboard?.writeText(s.code).catch(() => {});
        copy.textContent = 'Copied';
      });
      copy.classList.add('net-copy');
      head.appendChild(copy);
      b.appendChild(head);
      const list = el('div', 'net-players');
      for (const p of s.players) {
        const r = el('div', 'net-player');
        const dot = el('i', 'net-dot');
        dot.style.background = p.color;
        r.append(dot, el('span', '', p.name + (p.id === s.me ? ' (you)' : p.id === 1 ? ' (host)' : '')));
        list.appendChild(r);
      }
      b.appendChild(list);
      b.appendChild(el('div', 'panel-note net-small', s.role === 'host'
        ? 'Friends join from Multiplayer with this code. Your game is the one everyone plays in: only you can undo, and it runs while this tab is open.'
        : 'Everything happens in the host’s game. Undo is the host’s.'));
      const leave = this.button(s.role === 'host' ? 'Stop hosting' : 'Leave', () => s.leave());
      const friends = this.friends;
      if (friends && s.role === 'host') {
        const btns = el('div', 'set-io');
        btns.append(this.button('Invite friends…', () => friends.open()), leave);
        b.appendChild(btns);
      } else b.appendChild(leave);
    }
    if (this.error) b.appendChild(el('div', 'net-error', this.error));
  }
}

/** Everyone else's cursors over the sandbox, with their names. */
export class RemoteCursors {
  private layer: HTMLDivElement;
  private els = new Map<number, { el: HTMLDivElement; x: number; y: number; name: string }>();

  constructor(private game: Game, private session: Session, root: HTMLElement) {
    this.layer = el('div', 'net-cursors');
    root.appendChild(this.layer);
  }

  frame(dt: number): void {
    const list = this.session.cursors();
    const seen = new Set<number>();
    const r = this.game.renderer;
    const k = 1 - Math.exp(-CURSOR_EASE * Math.min(dt, 0.1));
    for (const c of list) {
      seen.add(c.id);
      const s = r.worldToScreen(c.x, c.y);
      let e = this.els.get(c.id);
      if (!e) {
        const d = el('div', 'net-cursor');
        d.innerHTML = '<svg viewBox="0 0 12 16"><path d="M1 1v12l3.2-3 2.3 5 2-1-2.3-4.8H11z"/></svg><span></span>';
        this.layer.appendChild(d);
        e = { el: d, x: s.x, y: s.y, name: '' };
        this.els.set(c.id, e);
      }
      if (e.name !== c.name) {
        e.name = c.name;
        e.el.querySelector('span')!.textContent = c.name;
        e.el.style.color = c.color;
      }
      e.x += (s.x - e.x) * k;
      e.y += (s.y - e.y) * k;
      e.el.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px)`;
    }
    for (const [id, e] of this.els) {
      if (seen.has(id)) continue;
      e.el.remove();
      this.els.delete(id);
    }
  }
}

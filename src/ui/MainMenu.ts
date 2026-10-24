import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { ActionId } from '../tools/Bindings';
import { fetchAsset } from '../engine/assets';
import { version } from '../../package.json';
import { desktop } from '../engine/Desktop';
import { MenuBackdrop } from './MenuBackdrop';

/** What the main menu needs of the rest of the interface (see UI). */
export interface MainMenuUI {
  /** Opens the Maps panel (over the menu). */
  maps(): void;
  mapsOpen(): boolean;
  /** Opens the Settings panel. */
  settings(): void;
  /** Opens the Controls panel. */
  help(): void;
  /** Closes the panels and the context menu; false if none was open. */
  closeOverlays(): boolean;
}

export interface MainMenuOptions {
  /**
   * Multiplayer…: opens the multiplayer panel over the menu (no entry without
   * it). The menu stays up beneath: close() goes on to the sandbox.
   */
  multiplayer?: () => void;
  /**
   * The guided tours, listed on the Tutorials page (none without them): each
   * one's title, a line about it, how long it takes and whether it's been
   * done; `fresh`: none taken yet (the first is offered then).
   */
  tutorial?: { tours(): { id: string; title: string; blurb: string; minutes: number; done: boolean }[]; start(id: string): void; fresh(): boolean };
  /**
   * Friends…: opens the friends list over the menu (no entry without it). With
   * Multiplayer… as well, the two are a page of their own (Multiplayer).
   */
  friends?: () => void;
  /**
   * Battle…: the armies panel (no entry without it). The menu goes on to the
   * sandbox first, then calls it: the battle is set up and fought there.
   */
  battle?: () => void;
  /**
   * Quit: closes the game, for a wrapper that can (a desktop build). A browser
   * tab can't close itself, so in one there's no Quit, unless a script opened
   * the game's window (a script may close that again).
   */
  quit?: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** How long the menu takes to fade into the sandbox (as .main-menu's transition in the style sheet). */
const FADE_MS = 350;

/** The main list, and its submenus. */
type PageId = 'main' | 'tutorial' | 'multiplayer' | 'info';

/** A word on a page of the menu. */
interface Entry {
  /** What it says (the style sheet shows it lowercase, as People Playground's words). */
  label: string;
  /** A line about it, under the list while it's picked out. */
  hint: string;
  fn: () => void;
  /** Opens a submenu (marked ›). */
  sub?: boolean;
  /** Goes on to the sandbox (the confirming sound). */
  go?: boolean;
  /** Space above it: the first of a group. */
  gap?: boolean;
  cls?: string;
  badge?: string;
  /** More words after the label, about keys: left off on a touch screen. */
  keys?: string;
  /** A guided tour's: its id, how long it takes, whether it's been done, and a line about it, under its title. */
  tour?: { id: string; minutes: number; done: boolean; blurb: string };
}

/**
 * The authors in a credits file (public/sfx/CREDITS.md) by source, its "## "
 * sections (Kenney, OpenGameArt, Freesound, the music), from each "- Author:"
 * line, sorted.
 */
export function creditAuthors(md: string): [string, string[]][] {
  const out = new Map<string, Set<string>>();
  let source = '';
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^##\s+(.+)$/.exec(line);
    if (head) source = head[1].trim();
    const who = /^-\s*(?:Authors?|Artists?|Composers?):\s*(.+)$/i.exec(line);
    if (!who || !source) continue;
    // (a link's text only, and not the website after Kenney's name)
    const name = who[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s*\((?:www\.|https?:)[^)]*\)/g, '').replace(/[*_`]/g, '').trim();
    if (!name) continue;
    if (!out.has(source)) out.set(source, new Set());
    out.get(source)!.add(name);
  }
  return [...out].map(([s, names]) => [s, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))]);
}

/**
 * The title screen, as in People Playground: up as the game starts and from
 * the pause menu's Main menu, a dark screen hiding the sandbox (which runs on
 * behind it), the menu's words down the left and the name on the right, over
 * toys tumbling through the dark (see MenuBackdrop). Play (Continue, once
 * played), New sandbox and Maps lead to the sandbox; Tutorials, Multiplayer
 * (with the friends list) and Information are pages of their own, sliding in
 * over the list; Settings and Controls open their panels over it. The cursor
 * or ↑ / ↓ pick out a word, Enter takes it, Esc goes back. While it's up,
 * nothing the player presses reaches the sandbox.
 */
export class MainMenu {
  readonly el: HTMLDivElement;
  /** Changing them changes the entries the next time the menu shows. */
  readonly options: MainMenuOptions;
  /** The toys tumbling behind the words (drawn only while the menu is up). */
  readonly backdrop = new MenuBackdrop();
  open = false;
  /** How many times it has come up (the first, as the game started). */
  shown = 0;
  /** The player has been on to the sandbox: Play says Continue. */
  played = false;
  /** The page shown: the main list, or one of its submenus. */
  page: PageId = 'main';
  private game: Game;
  private controls: Controls;
  private ui: MainMenuUI;
  private pagesEl: HTMLDivElement;
  private pageEls = new Map<PageId, HTMLDivElement>();
  /** The word picked out (by the cursor or the keys): Enter takes it. */
  private selected: HTMLButtonElement | null = null;
  /** The word that opened the submenu shown: picked out again on the way back. */
  private opener: HTMLButtonElement | null = null;
  private hint: HTMLDivElement;
  private foot: HTMLDivElement;
  /** The menu's own panels over it (Credits, How to play). */
  private sheets: HTMLDivElement[] = [];
  private credits: HTMLDivElement;
  private creditList: HTMLDivElement;
  private howto: { overlay: HTMLDivElement; body: HTMLDivElement };
  private authors: Promise<void> | null = null;
  private hideTimer = 0;
  /** While the Maps panel opened from the menu is up: the scene then, and whether the map was being edited. */
  private watch: { scene: number; editing: boolean } | null = null;

  constructor(game: Game, controls: Controls, root: HTMLElement, ui: MainMenuUI, options: MainMenuOptions = {}) {
    this.game = game;
    this.controls = controls;
    this.ui = ui;
    this.options = options;

    // (an .overlay, so it stays up when the interface is hidden; the panels it opens go over it)
    this.el = el('div', 'overlay main-menu hidden');
    const inner = el('div', 'mm-inner');
    const side = el('nav', 'mm-side');
    side.setAttribute('aria-label', 'Main menu');
    this.pagesEl = el('div', 'mm-pages');
    this.hint = el('div', 'mm-hint');
    side.append(this.pagesEl, this.hint);
    const title = el('div', 'mm-title');
    title.setAttribute('role', 'heading');
    title.setAttribute('aria-level', '1');
    const name = el('div', 'mm-name');
    name.append(el('span', 'mm-name-a', 'blueberry'), ' ', el('span', 'mm-name-b', 'playground'));
    title.append(name, el('div', 'mm-tag', 'a physics sandbox'));
    this.foot = el('div', 'mm-foot');
    const credit = el('div', 'mm-ver', `v${version}${desktop ? ' Desktop' : ''} · three.js, Rapier and PeerJS · CC0 sounds and music`);
    inner.append(side, title, this.foot, credit);
    this.el.append(this.backdrop.canvas, inner);
    root.appendChild(this.el);
    // the first click or touch lets the page make sound (the menu's music waits for it)
    for (const ev of ['pointerdown', 'pointerup'] as const) this.el.addEventListener(ev, () => this.game.sound.unlock());
    this.el.addEventListener('pointermove', (e) => {
      // (the cursor over the menu doesn't pick out things in the sandbox behind; the backdrop sways after it)
      e.stopPropagation();
      this.backdrop.point((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    // (a word Tab moves to is the one picked out)
    this.pagesEl.addEventListener('focusin', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.mm-btn');
      if (b) this.select(b, true);
    });

    const credits = this.sheet(root, 'mm-credits', 'Credits');
    credits.body.append(
      el('p', '', 'Blueberry Playground: a physics sandbox in the spirit of People Playground, made with three.js (drawing), Rapier (physics) and PeerJS (multiplayer).'),
      el('div', 'panel-sub', 'Sounds and music'),
      el('p', '', 'CC0 (public domain) recordings by the contributors to Freesound, Kenney’s asset packs and OpenGameArt:'),
    );
    this.creditList = el('div', 'mm-credit-list');
    credits.body.appendChild(this.creditList);
    this.credits = credits.overlay;
    this.howto = this.sheet(root, 'mm-howto', 'How to play');

    // Keys don't reach the sandbox while the menu is up (Controls listens on
    // window): those sent to the page itself stop before Controls sees them...
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const t = e.target;
      if (t !== window && t !== document && t !== document.body && t !== document.documentElement) return;
      e.stopImmediatePropagation();
      this.onKey(e);
    }, true);
    // ...and those for a focused button or field (in a panel over the menu) once
    // that has had them, on their way up. (Key-ups go on: Controls only lets go
    // of what it holds on them.)
    document.addEventListener('keydown', (e) => {
      if (!this.open) return;
      e.stopPropagation();
      this.onKey(e);
    });
    game.frameHandlers.push(() => this.frame());
  }

  /** Puts the menu up on its main list (closing the panels open over the sandbox), with the menu's music. */
  show(): void {
    this.ui.closeOverlays();
    this.hideSheets();
    clearTimeout(this.hideTimer);
    if (!this.open) {
      this.open = true;
      this.shown++;
      this.game.music.play('menu');
    }
    this.el.classList.remove('hidden');
    this.render();
    this.go('main');
    this.backdrop.start();
    // (laid out hidden first, so it fades in)
    void this.el.offsetWidth;
    this.el.classList.add('shown');
  }

  /** On to the sandbox (Play): the menu fades out, and the sandbox's music comes on. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.played = true;
    this.watch = null;
    this.hideSheets();
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.el.classList.remove('shown');
    clearTimeout(this.hideTimer);
    // (it lets clicks through at once, as it fades; the backdrop stops once it's out of sight)
    this.hideTimer = window.setTimeout(() => {
      this.el.classList.add('hidden');
      this.backdrop.stop();
    }, FADE_MS);
    this.game.music.play('sandbox');
  }

  /** Credits: whose the sounds and music are. Resolves once their authors are listed (read from sfx/CREDITS.md). */
  showCredits(): Promise<void> {
    this.credits.classList.remove('hidden');
    this.authors ??= this.loadAuthors();
    return this.authors;
  }

  /** How to play: the essentials, with the player's own keys (or the touch screen's ways). */
  private showHowTo(): void {
    const b = this.controls.bindings;
    const keys = (...ids: ActionId[]) => ids.map((id) => b.label(id)).filter(Boolean).join(' / ');
    const touch = this.controls.touchMode;
    const rows: [string, string][] = touch
      ? [
          ['Toybox', 'Tap a toy on the left, then the floor: it spawns there'],
          ['Drag', 'Move things with a finger; drag empty space to look about'],
          ['Two fingers', 'Pinch to zoom'],
          ['Long press', 'Everything a thing can do, in its menu'],
          ['Bottom bar', 'Use, freeze, rotate, flip or delete the selected thing'],
          ['Tool bar', 'Ropes, welds, wires and the powers'],
        ]
      : [
          ['Toybox', 'Pick a toy on the left, then click where it goes'],
          [keys('spawnLeft', 'spawnRight'), 'Spawn it facing left / right'],
          ['Drag', 'Move things about with the left mouse button'],
          [keys('rotateLeft', 'rotateRight'), 'Turn what you’re holding'],
          ['Right-click', 'Everything a thing can do, in its menu'],
          [keys('activate'), 'Use it: fire a gun, light a fuse, start an engine'],
          [keys('time'), 'Stop or start time'],
          [keys('slowmo'), 'Slow motion'],
          ['Ctrl+Z', 'Undo'],
          [keys('menu'), 'The pause menu (and from there, back here)'],
        ];
    const list = el('div', 'keys');
    // (a command with no key left out)
    for (const [key, what] of rows) if (key) list.append(el('div', 'key', key), el('div', '', what));
    this.howto.body.textContent = '';
    this.howto.body.append(list, el('p', '', `All the rest${touch ? ': Controls' : ', and changing the keys: Controls & key bindings'}, on the main menu.`));
    this.howto.overlay.classList.remove('hidden');
  }

  /** A panel of the menu's own over it, closed by its Close, a click beside it or Esc: `body` for its content. */
  private sheet(root: HTMLElement, cls: string, title: string): { overlay: HTMLDivElement; body: HTMLDivElement } {
    const overlay = el('div', 'overlay hidden');
    const box = el('div', 'panel ' + cls);
    const body = el('div');
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => overlay.classList.add('hidden');
    box.append(el('div', 'panel-title', title), body, close);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    };
    root.appendChild(overlay);
    this.sheets.push(overlay);
    return { overlay, body };
  }

  /** Closes the menu's own panels; false if none was open. */
  private hideSheets(): boolean {
    const open = this.sheets.filter((s) => !s.classList.contains('hidden'));
    for (const s of open) s.classList.add('hidden');
    return open.length > 0;
  }

  private async loadAuthors(): Promise<void> {
    let text: string;
    try {
      const res = await fetchAsset('sfx/CREDITS.md');
      if (!res.ok) return;
      text = await res.text();
    } catch {
      // (no file: the credits say where the sounds are from, without the names)
      return;
    }
    for (const [source, names] of creditAuthors(text)) {
      this.creditList.append(el('div', 'mm-credit-src', source), el('div', 'mm-credit-names', names.join(', ')));
    }
  }

  /**
   * The pages: the main list (Play or Continue; Battle…, Multiplayer… and
   * Friends… only with somewhere to go; Quit only where the game can be closed)
   * and its submenus, all laid out at once, the ones not shown out of sight.
   */
  private render(): void {
    this.pagesEl.textContent = '';
    this.pageEls.clear();
    this.selected = this.opener = null;
    const o = this.options;
    const subs: [PageId, string, Entry[]][] = [];
    /** A submenu's word on the main list (or, with only one entry, that entry itself). */
    const sub = (id: PageId, label: string, hint: string, entries: Entry[]): Entry[] => {
      if (entries.length < 2) return entries;
      subs.push([id, label, entries]);
      return [{ label, hint, fn: () => this.enter(id), sub: true }];
    };
    const play: Entry[] = [
      this.played
        ? { label: 'Continue', hint: 'Back to the sandbox, as you left it', fn: () => this.close(), go: true, cls: 'mm-play' }
        : { label: 'Play', hint: 'Into the sandbox', fn: () => this.close(), go: true, cls: 'mm-play' },
      { label: 'New sandbox', hint: 'Everything cleared away, on this map (undo brings it back)', fn: () => this.newSandbox(), go: true },
      { label: 'Maps', hint: 'The ground to play on: pick one, or edit it', fn: () => this.maps() },
    ];
    const others: Entry[] = [];
    const tutorial = o.tutorial;
    const tours = tutorial?.tours() ?? [];
    if (tutorial && tours.length) {
      // (none taken yet: the first is the one to start with)
      const fresh = tutorial.fresh() ? 'new here?' : undefined;
      const list: Entry[] = tours.map((t, i) => ({
        label: t.title,
        hint: [t.blurb, `about ${t.minutes} minutes${t.done ? ', done' : ''}`].filter(Boolean).join(' · '),
        go: true,
        fn: () => {
          this.close();
          tutorial.start(t.id);
        },
        cls: 'mm-tour' + (fresh && !i ? ' mm-fresh' : ''),
        badge: i ? undefined : fresh,
        tour: { id: t.id, minutes: t.minutes, done: t.done, blurb: t.blurb },
      }));
      // (a page however few there are: a tour's title alone on the main list wouldn't say what it is)
      subs.push(['tutorial', 'Tutorials', list]);
      others.push({ label: 'Tutorials', hint: 'Guided tours of the sandbox, a group of things at a time', fn: () => this.enter('tutorial'), sub: true, badge: fresh });
    }
    const battle = o.battle;
    if (battle) {
      others.push({ label: 'Battle…', hint: 'Armies set against each other', go: true, fn: () => {
        this.close();
        battle();
      } });
    }
    const { multiplayer, friends } = o;
    const net: Entry[] = [];
    if (multiplayer) net.push({ label: 'Multiplayer…', hint: 'Host a game, or join one with its code', fn: () => multiplayer() });
    if (friends) net.push({ label: 'Friends…', hint: 'The people you play with, and their games', fn: () => friends() });
    others.push(...sub('multiplayer', 'Multiplayer', 'One sandbox, played together', net));
    const settings: Entry[] = [
      { label: 'Settings', hint: 'Volume, blood, physics quality and the rest', fn: () => this.ui.settings() },
      { label: 'Controls', keys: ' & key bindings', hint: 'Every key, and changing them', fn: () => this.ui.help() },
      ...sub('info', 'Information', 'How to play, and who made what', [
        { label: 'How to play', hint: 'The essentials, on one page', fn: () => this.showHowTo() },
        { label: 'Credits', hint: 'The tools, the sounds and the music, and their authors', fn: () => void this.showCredits() },
      ]),
    ];
    // (see MainMenuOptions.quit)
    const quit = o.quit ?? (window.opener ? () => window.close() : undefined);
    const groups: Entry[][] = [play, others, settings, quit ? [{ label: 'Quit', hint: 'Close the game', fn: quit }] : []];
    // (each group after the first set apart, as Quit is in People Playground)
    this.addPage('main', null, groups.filter((g) => g.length).flatMap((g, i) => g.map((e, j) => (i && !j ? { ...e, gap: true } : e))));
    for (const [id, label, entries] of subs) this.addPage(id, label, entries);
    const back = this.controls.bindings.label('menu');
    this.foot.textContent = back ? `Back here from the sandbox: ${back}, then Main menu` : '';
  }

  /** A page of words (a submenu's under its name, with Back at the foot). */
  private addPage(id: PageId, title: string | null, entries: Entry[]): void {
    const p = el('div', 'mm-page');
    p.dataset.page = id;
    if (title) p.appendChild(el('div', 'mm-head', title));
    for (const e of entries) p.appendChild(this.entry(e));
    if (id !== 'main') p.appendChild(this.entry({ label: 'Back', hint: 'To the main list', fn: () => this.back(), gap: true }));
    this.pagesEl.appendChild(p);
    this.pageEls.set(id, p);
  }

  private entry(e: Entry): HTMLButtonElement {
    const b = el('button', ['mm-btn', e.cls, e.sub && 'mm-sub', e.gap && 'mm-gap'].filter(Boolean).join(' '), e.label);
    b.dataset.hint = e.hint;
    if (e.keys) b.appendChild(el('span', 'mm-keys', e.keys));
    const t = e.tour;
    if (t) {
      b.dataset.tour = t.id;
      b.appendChild(el('span', 'mm-min', `about ${t.minutes} min`));
      if (t.done) b.appendChild(el('span', 'mm-done', '✓'));
    }
    if (e.badge) b.appendChild(el('span', 'mm-new', e.badge));
    if (t?.blurb) b.appendChild(el('span', 'mm-blurb', t.blurb));
    b.onclick = (ev) => {
      // (browsers let a page make sound only once it's been clicked; the self-tests' clicks don't count, see Music)
      if (ev.isTrusted) this.game.sound.unlock();
      this.game.sound.ui(e.go ? 'confirm' : 'click');
      this.select(b, false);
      e.fn();
    };
    // (the cursor picks out the word it's over; a finger's tap just takes it)
    b.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType === 'mouse') this.select(b, true);
    });
    return b;
  }

  /** Shows a page, picking out `pick` on it (else its first word). */
  private go(id: PageId, pick?: HTMLButtonElement | null): void {
    const to = this.pageEls.get(id);
    if (!to) return;
    for (const [pid, p] of this.pageEls) {
      p.classList.toggle('on', p === to);
      // (the main list slides off to the left as a submenu comes in from the right, and back)
      p.classList.toggle('past', pid === 'main' && id !== 'main');
    }
    this.page = id;
    this.select(pick?.isConnected ? pick : to.querySelector<HTMLButtonElement>('.mm-btn'), false);
  }

  /** Into a submenu (from the word picked out). */
  private enter(id: PageId): void {
    this.opener = this.selected;
    this.go(id);
  }

  /** Back to the main list, on the word that opened the submenu. */
  private back(): void {
    if (this.page !== 'main') this.go('main', this.opener);
  }

  /** Picks out a word (with a tick, for the player's own moves): it steps out, and its line shows under the list. */
  private select(b: HTMLButtonElement | null, tick: boolean): void {
    if (b === this.selected) return;
    this.selected?.classList.remove('sel');
    this.selected = b;
    this.hint.textContent = b?.dataset.hint ?? '';
    if (!b) return;
    b.classList.add('sel');
    // (the focus goes with it: Space takes it too, and so do screen readers)
    if (this.open && document.activeElement !== b) b.focus({ preventScroll: true });
    if (tick) this.game.sound.ui('hover');
  }

  /** New sandbox: everything cleared away (as the tool bar's Reset does: undo brings it back), the camera home, and on to it. */
  private newSandbox(): void {
    this.controls.clearScene('New sandbox');
    const home = this.game.home();
    this.game.renderer.camX = home.x;
    this.game.renderer.camY = home.y;
    this.close();
  }

  private maps(): void {
    this.ui.maps();
    this.watch = { scene: this.game.sceneVersion, editing: !!this.controls.terrain };
  }

  /** Whether a panel is open over the menu (the keys are its then). */
  private covered(): boolean {
    return !!this.el.parentElement?.querySelector(':scope > .overlay:not(.hidden):not(.main-menu)');
  }

  private onKey(e: KeyboardEvent): void {
    // (the player's key lets the page make sound, as anywhere else: see Music; the self-tests' don't)
    if (e.isTrusted) this.game.sound.unlock();
    if (e.code === 'Escape' || this.controls.bindings.keys('menu').includes(e.code)) {
      // Esc closes what's open over the menu, else goes back a page; the menu itself stays (Play leaves it)
      if (this.hideSheets() || this.ui.closeOverlays()) return;
      if (this.page !== 'main') {
        this.game.sound.ui('click');
        this.back();
      }
      return;
    }
    if (this.covered()) return;
    const words = [...(this.pageEls.get(this.page)?.querySelectorAll<HTMLButtonElement>('.mm-btn') ?? [])];
    if (!words.length) return;
    const at = this.selected ? words.indexOf(this.selected) : -1;
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const d = e.code === 'ArrowDown' ? 1 : -1;
      // (round from the last word to the first, and back)
      this.select(words[at < 0 ? (d > 0 ? 0 : words.length - 1) : (at + d + words.length) % words.length], true);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // (not the button's own Enter as well, nor again and again while it's held)
      if (!e.repeat) this.selected?.click();
    } else if (e.code === 'ArrowRight' && this.selected?.classList.contains('mm-sub')) {
      this.selected.click();
    } else if (e.code === 'ArrowLeft' && this.page !== 'main') {
      this.game.sound.ui('click');
      this.back();
    } else return;
    e.preventDefault();
  }

  private frame(): void {
    const w = this.watch;
    if (!this.open || !w) return;
    // a map picked in the Maps panel (which clears the scene), or its ground to edit: on to the sandbox
    if (this.game.sceneVersion !== w.scene || (this.controls.terrain && !w.editing)) this.close();
    else if (!this.ui.mapsOpen()) this.watch = null;
  }
}

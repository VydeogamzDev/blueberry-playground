import { clamp } from '../engine/math';
import { store } from '../engine/Store';

/**
 * The interface's layout: where each piece of the on-screen interface goes (the
 * toybox, the toolbar, the tools and powers, the vitals, the stats...), how big
 * it is and whether it's shown. Edit layout (Settings > Game, the pause menu, or
 * its key) stops time under a light veil and frames every piece: drag one to
 * move it (it snaps to the screen's edges, the other pieces and a grid; Alt:
 * exactly where it's put), its corner to scale it, its edge to size it, and the
 * toybox to the left, the right or the bottom to dock it there.
 *
 * A layout keeps only what the player changed: a piece left alone is where the
 * style sheet puts it (so the Default layout is the game as it always was). A
 * moved piece is kept by the edge, corner or middle of the screen it's nearest
 * (that point of the screen, plus pixels), so it keeps its place as the window
 * changes size, and it's pulled back in on a screen too small for it. Phones
 * keep their compact layout. The player's layouts have names, are kept with the
 * other saves (see Store), and go to and from small files.
 */

export type Dock = 'left' | 'right' | 'bottom';

/**
 * Where a moved piece goes: its own point at (ax, ay) of its size (0 its left or
 * top, 0.5 its middle, 1 its right or bottom) at the same point of the
 * screen's, plus (dx, dy) pixels.
 */
export interface Place {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
}

/** What the player changed about one piece (nothing: as the game has it). */
export interface PieceLayout {
  /** Moved: where to. */
  at?: Place;
  /** Its own scale (times the whole interface's). */
  scale?: number;
  hidden?: boolean;
  /** Its width (CSS px, before scaling): the vitals'; the toybox's panel, beside the screen's edge. */
  w?: number;
  /** The toybox's height along the bottom. */
  h?: number;
}

export interface ScreenLayout {
  /** The whole interface's scale (every piece's, times its own). */
  scale: number;
  /** The edge of the screen the toybox is on. */
  dock: Dock;
  /** The toybox's columns (0: as many as fit); unset, the game's: 3 at the side, as many as fit along the bottom. */
  cols?: number;
  pieces: Record<string, PieceLayout>;
}

export interface LayoutSlot {
  id: string;
  name: string;
  layout: ScreenLayout;
}

/** What the layout needs of the rest of the interface (see UI). */
export interface LayoutUI {
  toast(msg: string): void;
  /** A small question over everything: with `value`, a line to type in (see UI.dialog()). */
  dialog(title: string, text: string, value: string | null, okLabel: string, ok: (value: string) => void): void;
  /** Saves a file to the player's computer. */
  download(name: string, text: string): void;
  /** The toybox moved, changed size or was hidden: the camera centres on the rest (see UI.updateInset). */
  changed(): void;
  /** A button's click. */
  click(): void;
}

/** Where the player's layouts are kept (see Store). */
export const LAYOUT_STORE = 'blueberry-layouts';
/** The game's own layout: always there, and never changed, renamed or deleted. */
export const DEFAULT_LAYOUT = 'default';

/** Screens narrower than this (CSS px) keep the compact layout made for them (UI's NARROW). */
const NARROW = 700;
/** Snapping: how near (px) an edge must come to catch, the grid, the gap left beside another piece, and the screen's margin (the game's pieces sit that far in). */
const SNAP = 8;
const GRID = 8;
const GAP = 4;
const MARGIN = 8;
/** A piece's own scale, and the whole interface's. */
const SCALE = { min: 0.5, max: 2 };
/** The toybox: its panel's width at the side, its height along the bottom (px), and its columns at most. */
const TOYBOX = { w: [150, 600], h: [110, 600], cols: 8 };
/** How far (px) a place may be from its edge (a hand-edited file can say anything). */
const FAR = 10000;
/** The style properties a piece is put in place with. */
const VARS = ['--lay-x', '--lay-y', '--lay-tx', '--lay-ty', '--lay-cx', '--lay-cy', '--lay-ox', '--lay-oy', '--lay-s', '--lay-w'];

interface View {
  w: number;
  h: number;
}

/** One piece of the interface. */
interface PieceSpec {
  id: string;
  name: string;
  /** How to find it among the interface's elements. */
  sel: string;
  /** Its display when shown (editing shows every piece, even one with nothing to show yet). */
  display: string;
  /** The point (fractions of its size) the style sheet puts it by: it stays put as the piece is scaled. */
  anchor: [number, number];
  /** The shift the style sheet gives it to put that point there (one centred with left: 50%). */
  shift?: [string, string];
  /** The player may hide it ('mouse': not in the touch layout, where it's the only way to the menus). */
  hide?: true | 'mouse';
  /** Its width can be set (CSS px: least, most). */
  width?: [number, number];
  /** Only shown in the touch layout. */
  touch?: boolean;
}

const PIECES: PieceSpec[] = [
  { id: 'toybox', name: 'Toybox', sel: '.catalog', display: 'flex', anchor: [0, 0] },
  { id: 'toolbar', name: 'Toolbar', sel: '.toolbar', display: 'flex', anchor: [1, 0], hide: 'mouse' },
  { id: 'tools', name: 'Tools and powers', sel: '.tools', display: 'flex', anchor: [1, 0.5], shift: ['0px', '-50%'], hide: true },
  { id: 'vitals', name: 'Vitals', sel: '.vitals', display: 'block', anchor: [0, 0], hide: true, width: [200, 440] },
  { id: 'status', name: 'Stats', sel: '.status', display: 'block', anchor: [1, 1], hide: true },
  { id: 'hint', name: 'Hints', sel: '.hint', display: 'block', anchor: [0.5, 1], shift: ['-50%', '0px'], hide: true },
  { id: 'toast', name: 'Messages', sel: '.toast', display: 'block', anchor: [0.5, 0], shift: ['-50%', '0px'], hide: true },
  { id: 'banner', name: 'Map editing bar', sel: '.map-banner', display: 'flex', anchor: [0.5, 0], shift: ['-50%', '0px'] },
  { id: 'invite', name: 'Friend invitations', sel: '.fr-invite', display: 'flex', anchor: [0.5, 0], shift: ['-50%', '0px'], hide: true },
  { id: 'touchbar', name: 'Selection bar', sel: '.touchbar:not(.buildbar)', display: 'flex', anchor: [0.5, 1], shift: ['-50%', '0px'], touch: true },
  { id: 'buildbar', name: 'Build bar', sel: '.buildbar', display: 'flex', anchor: [0.5, 1], shift: ['-50%', '0px'], touch: true },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const touchLayout = (): boolean => document.body.classList.contains('touch');

/** Sets (or, null, clears) one of an element's style properties, only if it changes (each change lays the page out again). */
function setVar(e: HTMLElement, k: string, v: string | null): void {
  if (v === null) {
    if (e.style.getPropertyValue(k)) e.style.removeProperty(k);
  } else if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v);
}

/** How far to shift a span (start, size) to have it on the screen (0..span); one bigger than the screen starts at 0. */
const nudge = (start: number, size: number, span: number): number => (size > span || start < 0 ? -start : Math.min(0, span - start - size));

export function defaultLayout(): ScreenLayout {
  return { scale: 1, dock: 'left', pieces: {} };
}

/** A layout from the store or a file, made safe: anything odd or unknown is left as the game has it. */
export function cleanLayout(d: unknown): ScreenLayout {
  const L = defaultLayout();
  if (!d || typeof d !== 'object') return L;
  const o = d as Partial<Record<keyof ScreenLayout, unknown>>;
  if (num(o.scale)) L.scale = clamp(o.scale, SCALE.min, SCALE.max);
  if (o.dock === 'right' || o.dock === 'bottom') L.dock = o.dock;
  if (num(o.cols)) L.cols = clamp(Math.round(o.cols), 0, TOYBOX.cols);
  const pieces = (o.pieces && typeof o.pieces === 'object' ? o.pieces : {}) as Record<string, unknown>;
  for (const spec of PIECES) {
    const q = pieces[spec.id] as Partial<Record<keyof PieceLayout, unknown>> | undefined;
    if (!q || typeof q !== 'object') continue;
    const p: PieceLayout = {};
    const at = q.at as Partial<Record<keyof Place, unknown>> | undefined;
    if (spec.id !== 'toybox' && at && num(at.ax) && num(at.ay) && num(at.dx) && num(at.dy)) {
      p.at = { ax: clamp(at.ax, 0, 1), ay: clamp(at.ay, 0, 1), dx: clamp(at.dx, -FAR, FAR), dy: clamp(at.dy, -FAR, FAR) };
    }
    if (num(q.scale) && q.scale !== 1) p.scale = clamp(q.scale, SCALE.min, SCALE.max);
    if (q.hidden === true && spec.hide) p.hidden = true;
    const width = spec.id === 'toybox' ? TOYBOX.w : spec.width;
    if (width && num(q.w)) p.w = clamp(q.w, width[0], width[1]);
    if (spec.id === 'toybox' && num(q.h)) p.h = clamp(q.h, TOYBOX.h[0], TOYBOX.h[1]);
    if (Object.keys(p).length) L.pieces[spec.id] = p;
  }
  return L;
}

/**
 * Where a moved piece's anchor point goes on a screen view.w × view.h: at its
 * place, pulled in so all of the piece (w × h as drawn) is on the screen. One
 * bigger than the screen keeps its top left on it.
 */
export function anchorPoint(at: Place, w: number, h: number, view: View): { x: number; y: number } {
  const fit = (a: number, d: number, size: number, span: number) => Math.max(a * size, Math.min(span - (1 - a) * size, a * span + d));
  return { x: fit(at.ax, at.dx, w, view.w), y: fit(at.ay, at.dy, h, view.h) };
}

/** The place of a piece drawn at (left, top), w × h: kept by the edge, corner or middle of the screen it's nearest. */
export function placeFor(left: number, top: number, w: number, h: number, view: View): Place {
  const third = (c: number, span: number) => (c < span / 3 ? 0 : c > (span * 2) / 3 ? 1 : 0.5);
  const ax = third(left + w / 2, view.w);
  const ay = third(top + h / 2, view.h);
  const r = (v: number) => Math.round(v * 10) / 10;
  return { ax, ay, dx: r(left + ax * w - ax * view.w), dy: r(top + ay * h - ay * view.h) };
}

/** One piece found in the interface. */
interface Piece {
  spec: PieceSpec;
  el: HTMLElement;
  /** The nudge keeping one only scaled on the screen (see place()). */
  cx: number;
  cy: number;
  /** While the layout is edited: its frame, the frame's Hide and handles, and where the frame was last drawn. */
  frame?: HTMLDivElement;
  hideBtn?: HTMLButtonElement;
  scaleHandle?: HTMLElement;
  sizeHandle?: HTMLElement;
  drawn?: string;
}

/** A drag in Edit layout. */
interface Gesture {
  kind: 'move' | 'dock' | 'size' | 'scale' | 'bar';
  piece: Piece | null;
  x0: number;
  y0: number;
  /** What's dragged (the piece, or the edit bar) as it was drawn when the drag began. */
  box: DOMRect;
  /** The piece's own scale then, and its width (the toybox's height along the bottom). */
  scale: number;
  size: number;
  moved: boolean;
  /** The toybox dragged: the edge it would dock on. */
  dock?: Dock;
}

/** The edit bar's parts that show how things are. */
interface Bar {
  el: HTMLDivElement;
  rename: HTMLButtonElement;
  remove: HTMLButtonElement;
  size: HTMLInputElement;
  sizeVal: HTMLSpanElement;
  /** The piece picked: its size, Hide, Reset (the toybox: its edge and columns). */
  sel: HTMLDivElement;
}

export class Layout {
  /** The player's layouts (the Default isn't among them: it's the game's own). */
  slots: LayoutSlot[] = [];
  /** The layout in use: one of the slots' ids, or DEFAULT_LAYOUT. */
  active = DEFAULT_LAYOUT;
  editing = false;
  /** The screen size laid out for; null: the window's. (The tests set one, as if the window were resized.) */
  viewSize: View | null = null;
  /** Where the layouts are kept (the tests keep theirs apart, under a key that isn't synced). */
  storeKey = LAYOUT_STORE;
  /** The layout in place: the active slot's, or the game's own. */
  private cur: ScreenLayout = defaultLayout();
  private pieces: Piece[] = [];
  /** The layouts' drop-downs (Settings', the edit bar's), filled in afresh as layouts come and go. */
  private pickers: HTMLSelectElement[] = [];
  private veil: HTMLDivElement | null = null;
  private layer: HTMLDivElement | null = null;
  private bar: Bar | null = null;
  private guideX: HTMLDivElement | null = null;
  private guideY: HTMLDivElement | null = null;
  private zone: HTMLDivElement | null = null;
  private selected: Piece | null = null;
  private gesture: Gesture | null = null;
  /** The layouts as they were when editing began (Cancel puts them back), and what to do as it ends. */
  private before = '';
  private onEnd: (() => void) | null = null;

  constructor(
    private root: HTMLElement,
    private ui: LayoutUI,
  ) {
    this.read();
  }

  /** Finds the pieces (once the interface is built) and puts them where the layout in use says. */
  attach(): void {
    for (const spec of PIECES) {
      const e = this.root.querySelector<HTMLElement>(`:scope > ${spec.sel}`);
      if (!e) continue;
      e.classList.add('lay-piece');
      e.dataset.layName = spec.name;
      this.pieces.push({ spec, el: e, cx: 0, cy: 0 });
    }
    // a moved or scaled piece that changes size (the vitals showing, a hint getting longer) is kept on the screen
    if (typeof ResizeObserver !== 'undefined') {
      const watch = new ResizeObserver((entries) => {
        for (const en of entries) {
          const p = this.pieces.find((q) => q.el === en.target);
          if (p && p.spec.id !== 'toybox' && p.el.classList.contains('lay-scaled')) this.place(p);
        }
      });
      for (const p of this.pieces) watch.observe(p.el);
    }
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  /** The screen is wide enough for a layout (narrower, the compact layout made for phones stays). */
  fits(): boolean {
    return this.view().w >= NARROW;
  }

  /** Reads the layouts kept again and puts the one in use in place (as the game does as it starts; the tests use it). */
  reload(): void {
    this.read();
    this.apply();
    this.ui.changed();
    this.showSlots();
    if (this.editing) this.select(null);
  }

  /** Puts every piece where the layout in use says (or leaves it to the style sheet). */
  apply(): void {
    for (const p of this.pieces) this.place(p);
  }

  /** The edge the toybox is on now. */
  dock(): Dock {
    return this.fits() ? this.cur.dock : 'left';
  }

  /**
   * How far the toybox reaches in from its edge, `shown` being the part of it on
   * the screen (all of it, or its shelves alone while it's folded; null: hidden).
   * The pieces left where they were keep clear of it, and the camera centres on
   * the rest (the side it covers, for UI.updateInset).
   */
  toyboxInset(shown: HTMLElement | null): { left: number; right: number } {
    const dock = this.dock();
    const r = shown?.getBoundingClientRect();
    const reach = !r ? 0 : dock === 'bottom' ? r.height : r.width;
    setVar(this.root, '--lay-tb', `${reach}px`);
    return { left: dock === 'left' ? reach : 0, right: dock === 'right' ? reach : 0 };
  }

  // ---- the layouts --------------------------------------------------------------------

  /** Puts a layout in use (a slot's id, or DEFAULT_LAYOUT) and remembers it. */
  use(id: string): void {
    const slot = this.slots.find((s) => s.id === id);
    this.active = slot ? slot.id : DEFAULT_LAYOUT;
    this.cur = slot ? slot.layout : defaultLayout();
    this.write();
    this.apply();
    this.ui.changed();
    this.showSlots();
    if (this.editing) this.select(this.selected);
  }

  /** Keeps the layout in place under a new name, and uses that. */
  saveAs(name: string): LayoutSlot {
    const slot = this.add(name, JSON.parse(JSON.stringify(this.cur)) as ScreenLayout);
    this.use(slot.id);
    return slot;
  }

  /** Renames the layout in use (not the Default). */
  rename(name: string): void {
    const slot = this.slot();
    if (!slot || !name.trim()) return;
    slot.name = this.freeName(name, slot);
    this.write();
    this.showSlots();
  }

  /** Deletes the layout in use (never the Default, which is then used). */
  remove(): void {
    const slot = this.slot();
    if (!slot) return;
    this.slots = this.slots.filter((s) => s !== slot);
    this.use(DEFAULT_LAYOUT);
  }

  /** Every piece back where the game has it: the layout in use (one of the player's) forgets all its changes. */
  reset(): void {
    const slot = this.slot();
    if (!slot) return;
    slot.layout = this.cur = defaultLayout();
    this.write();
    this.apply();
    this.ui.changed();
    this.showSlots();
    if (this.editing) this.select(this.selected);
  }

  /** Docks the toybox on an edge of the screen. */
  setDock(dock: Dock): void {
    if (dock === this.cur.dock) return;
    this.own().dock = dock;
    this.apply();
    this.ui.changed();
    this.commit();
    if (this.editing) this.renderSelected();
  }

  /** The whole interface's scale. */
  setScale(v: number): void {
    v = clamp(v, SCALE.min, SCALE.max);
    if (v === this.cur.scale) return;
    this.own().scale = v;
    this.apply();
    this.ui.changed();
    this.commit();
    if (this.bar) {
      this.bar.size.value = String(Math.round(v * 100));
      this.bar.sizeVal.textContent = pct(v);
    }
  }

  /** The toybox's columns (0: as many as fit). */
  setCols(n: number): void {
    this.own().cols = clamp(Math.round(n), 0, TOYBOX.cols);
    this.apply();
    this.commit();
    if (this.editing) this.renderSelected();
  }

  /** Saves the layout in use to a file (see importLayout). */
  exportFile(): void {
    const name = this.slot()?.name ?? 'Default';
    const text = JSON.stringify({ blueberry: 'layout', version: 1, name, layout: this.cur }, null, 1);
    this.ui.download(`${name.replace(/[^\w\- ]+/g, '').trim() || 'layout'}.layout.json`, text);
  }

  /** Opens a layout file (see exportFile): it joins the layouts and is used. */
  importFile(): void {
    const f = el('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        const slot = this.importLayout(JSON.parse(await file.text()) as unknown, file.name.replace(/(\.layout)?\.json$/i, ''));
        this.ui.toast(slot ? `Added the layout “${slot.name}”` : 'That isn’t a layout file');
      } catch (err) {
        this.ui.toast('Import failed: ' + (err as Error).message);
      }
    };
    f.click();
  }

  /** Adds the layout in a file's contents and uses it; null if it isn't one. */
  importLayout(data: unknown, fallback = 'Imported layout'): LayoutSlot | null {
    const d = data as { blueberry?: unknown; name?: unknown; layout?: unknown } | null;
    if (!d || typeof d !== 'object' || d.blueberry !== 'layout') return null;
    const slot = this.add(typeof d.name === 'string' && d.name.trim() ? d.name : fallback, cleanLayout(d.layout));
    this.use(slot.id);
    return slot;
  }

  /** Settings' row: the layouts to switch between, and Edit layout. */
  picker(edit: () => void): HTMLElement {
    const box = el('div', 'lay-pick');
    const sel = el('select', 'tb-select set-layout');
    sel.title = 'The layout of the interface in use';
    sel.onchange = () => {
      this.use(sel.value);
      // (left focused, it would take the keys meant for the sandbox)
      sel.blur();
    };
    this.pickers.push(sel);
    const btn = el('button', 'panel-btn', 'Edit layout…');
    btn.title = 'Move, size and hide the pieces of the interface';
    btn.onclick = () => {
      this.ui.click();
      edit();
    };
    box.append(sel, btn);
    this.showSlots();
    return box;
  }

  /** The player's layout in use (null: the Default). */
  private slot(): LayoutSlot | null {
    return this.slots.find((s) => s.id === this.active) ?? null;
  }

  private add(name: string, layout: ScreenLayout): LayoutSlot {
    const slot = { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: this.freeName(name), layout };
    this.slots.push(slot);
    return slot;
  }

  /** A name no other layout has (“My layout 2”...); `self` may keep its own. */
  private freeName(name: string, self?: LayoutSlot): string {
    const base = name.trim().slice(0, 40) || 'My layout';
    const taken = (n: string) => n.toLowerCase() === 'default' || this.slots.some((s) => s !== self && s.name.toLowerCase() === n.toLowerCase());
    let out = base;
    for (let i = 2; taken(out); i++) out = `${base} ${i}`;
    return out;
  }

  /**
   * The layout to change: the one in use, or, while the Default is (it can't be
   * changed), a new one of the player's starting as it, used from now on.
   */
  private own(): ScreenLayout {
    if (this.slot()) return this.cur;
    const slot = this.add('My layout', JSON.parse(JSON.stringify(this.cur)) as ScreenLayout);
    this.active = slot.id;
    this.cur = slot.layout;
    this.write();
    this.showSlots();
    this.ui.toast(`The Default layout stays as it is: your changes go into “${slot.name}”`);
    return this.cur;
  }

  /** The player's changes to a piece, to change (in a layout of theirs: see own()). */
  private changeOf(id: string): PieceLayout {
    return (this.own().pieces[id] ??= {});
  }

  /** Keeps the layout in use as it is now (a piece with nothing changed left out). */
  private commit(): void {
    const L = this.cur;
    for (const [id, pl] of Object.entries(L.pieces)) {
      if (pl.scale === 1) delete pl.scale;
      if (!pl.hidden) delete pl.hidden;
      if (!Object.keys(pl).length) delete L.pieces[id];
    }
    if (this.slot()) this.write();
  }

  private data(): string {
    return JSON.stringify({ active: this.active, slots: this.slots });
  }

  private read(): void {
    let raw: string | null = null;
    try {
      raw = store.getItem(this.storeKey);
    } catch {
      raw = null;
    }
    this.parse(raw);
  }

  /** The layouts as kept (see data()); anything that isn't one is dropped. */
  private parse(raw: string | null): void {
    this.slots = [];
    this.active = DEFAULT_LAYOUT;
    try {
      const d = JSON.parse(raw ?? '{}') as { active?: unknown; slots?: unknown };
      if (Array.isArray(d.slots)) {
        for (const s of d.slots as unknown[]) {
          const { id, name, layout } = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
          if (typeof id !== 'string' || typeof name !== 'string' || id === DEFAULT_LAYOUT || this.slots.some((x) => x.id === id)) continue;
          this.slots.push({ id, name: name.trim().slice(0, 40) || 'My layout', layout: cleanLayout(layout) });
        }
      }
      if (typeof d.active === 'string' && this.slots.some((s) => s.id === d.active)) this.active = d.active;
    } catch {
      // (a store that isn't ours: the Default)
    }
    this.cur = this.slot()?.layout ?? defaultLayout();
  }

  private write(): void {
    try {
      store.setItem(this.storeKey, this.data());
    } catch {
      this.ui.toast('The layout wasn’t kept: the browser’s storage is full');
    }
  }

  /** The layouts' drop-downs and the edit bar's buttons, as the layouts are now. */
  private showSlots(): void {
    for (const sel of this.pickers) {
      sel.textContent = '';
      for (const s of [{ id: DEFAULT_LAYOUT, name: 'Default' }, ...this.slots]) {
        const o = el('option', '', s.name);
        o.value = s.id;
        sel.appendChild(o);
      }
      sel.value = this.active;
    }
    if (!this.bar) return;
    this.bar.rename.disabled = this.bar.remove.disabled = !this.slot();
    this.bar.size.value = String(Math.round(this.cur.scale * 100));
    this.bar.sizeVal.textContent = pct(this.cur.scale);
  }

  // ---- putting pieces in place ------------------------------------------------------------

  private view(): View {
    return this.viewSize ?? { w: window.innerWidth, h: window.innerHeight };
  }

  /** A piece's scale: the interface's times its own. */
  private scaleOf(p: Piece): number {
    const s = this.cur.scale * (this.cur.pieces[p.spec.id]?.scale ?? 1);
    return Math.round(clamp(s, SCALE.min * SCALE.min, SCALE.max * SCALE.max) * 1000) / 1000;
  }

  /** The point a piece is put and scaled by (fractions of its size). */
  private anchorOf(p: Piece): [number, number] {
    if (p.spec.id === 'toybox') {
      const dock = this.dock();
      return dock === 'right' ? [1, 0] : dock === 'bottom' ? [0, 1] : [0, 0];
    }
    const at = this.cur.pieces[p.spec.id]?.at;
    return at ? [at.ax, at.ay] : p.spec.anchor;
  }

  /** Whether the layout hides a piece (the toolbar never in the touch layout: it's the way to the menus there). */
  private hides(p: Piece): boolean {
    const { hide, id } = p.spec;
    if (!hide || !this.fits() || (hide === 'mouse' && touchLayout())) return false;
    return !!this.cur.pieces[id]?.hidden;
  }

  /**
   * Puts one piece in place. Left alone it has no class or style of ours (the
   * style sheet's place). Moved, its anchor point is put at its place (pulled
   * onto the screen) and it's scaled about that point; only scaled, it's scaled
   * about the point the style sheet puts it by, and nudged back onto the screen
   * should that take it off.
   */
  private place(p: Piece): void {
    const on = this.fits();
    const id = p.spec.id;
    const pl = (on ? this.cur.pieces[id] : undefined) ?? {};
    const e = p.el;
    const hidden = this.hides(p);
    e.classList.toggle('lay-hidden', hidden && !this.editing);
    // (while editing, one hidden shows faintly, to be shown again)
    e.classList.toggle('lay-ghost', hidden && this.editing);
    if (id === 'toybox') this.dockToybox(p, on ? this.cur : null);
    const width = on && p.spec.width && pl.w ? pl.w : 0;
    e.classList.toggle('lay-sized', !!width);
    setVar(e, '--lay-w', width ? `${width}px` : null);
    const s = on ? this.scaleOf(p) : 1;
    const at = id === 'toybox' ? undefined : pl.at;
    e.classList.toggle('lay-moved', !!at);
    e.classList.toggle('lay-scaled', s !== 1 || !!at);
    if (s === 1 && !at) {
      for (const k of VARS) if (k !== '--lay-w') setVar(e, k, null);
      p.cx = p.cy = 0;
      return;
    }
    const [ax, ay] = this.anchorOf(p);
    setVar(e, '--lay-s', String(s));
    setVar(e, '--lay-ox', `${ax * 100}%`);
    setVar(e, '--lay-oy', `${ay * 100}%`);
    const v = this.view();
    if (at) {
      setVar(e, '--lay-tx', `${-ax * 100}%`);
      setVar(e, '--lay-ty', `${-ay * 100}%`);
      setVar(e, '--lay-cx', null);
      setVar(e, '--lay-cy', null);
      p.cx = p.cy = 0;
      const pt = anchorPoint(at, e.offsetWidth * s, e.offsetHeight * s, v);
      setVar(e, '--lay-x', `${pt.x}px`);
      setVar(e, '--lay-y', `${pt.y}px`);
      return;
    }
    const [tx, ty] = p.spec.shift ?? ['0px', '0px'];
    setVar(e, '--lay-tx', tx);
    setVar(e, '--lay-ty', ty);
    setVar(e, '--lay-x', null);
    setVar(e, '--lay-y', null);
    if (id === 'toybox' || !e.offsetWidth) return;
    // (measured with the nudge it has now taken off)
    const r = e.getBoundingClientRect();
    p.cx = nudge(r.left - p.cx, r.width, v.w);
    p.cy = nudge(r.top - p.cy, r.height, v.h);
    setVar(e, '--lay-cx', p.cx ? `${p.cx}px` : null);
    setVar(e, '--lay-cy', p.cy ? `${p.cy}px` : null);
  }

  /** The toybox's edge, panel width, height along the bottom and columns; the pieces left alone keep clear of it. */
  private dockToybox(p: Piece, L: ScreenLayout | null): void {
    const e = p.el;
    const dock = L?.dock ?? 'left';
    const pl = L?.pieces.toybox ?? {};
    e.classList.toggle('lay-dock-right', dock === 'right');
    e.classList.toggle('lay-dock-bottom', dock === 'bottom');
    this.root.classList.toggle('lay-tb-right', dock === 'right');
    this.root.classList.toggle('lay-tb-bottom', dock === 'bottom');
    const w = dock !== 'bottom' && pl.w ? pl.w : 0;
    e.classList.toggle('lay-tb-sized', !!w);
    setVar(e, '--lay-tb-w', w ? `${w}px` : null);
    const h = dock === 'bottom' && pl.h ? Math.min(pl.h, this.view().h * 0.7) : 0;
    setVar(e, '--lay-tb-h', h ? `${h}px` : null);
    const cols = L?.cols;
    e.classList.toggle('lay-cols', !!cols);
    e.classList.toggle('lay-cols-auto', cols === 0);
    setVar(e, '--lay-tb-cols', cols ? String(cols) : null);
  }

  // ---- Edit layout -------------------------------------------------------------------------

  /**
   * Opens Edit layout: a veil over the sandbox, every piece shown and framed,
   * and the edit bar. False on a screen too narrow (it keeps the compact
   * layout). `end` runs as it closes (Done or Cancel).
   */
  edit(end?: () => void): boolean {
    if (this.editing) return true;
    if (!this.fits()) return false;
    this.editing = true;
    this.onEnd = end ?? null;
    this.before = this.data();
    this.root.classList.add('lay-editing');
    const touch = touchLayout();
    this.veil = el('div', 'lay-veil');
    const layer = el('div', 'lay-edit');
    layer.onpointerdown = (e) => {
      if (e.target === layer) this.select(null);
    };
    layer.oncontextmenu = (e) => e.preventDefault();
    for (const p of this.pieces) {
      if (p.spec.touch && !touch) continue;
      // (shown even with nothing to show yet: the vitals with nobody picked, the map's bar, the toybox folded)
      p.el.style.setProperty('display', p.spec.display, 'important');
      layer.appendChild(this.makeFrame(p));
    }
    this.pieces.find((p) => p.spec.id === 'toybox')?.el.classList.add('lay-open');
    this.guideX = el('div', 'lay-guide lay-gx hidden');
    this.guideY = el('div', 'lay-guide lay-gy hidden');
    this.zone = el('div', 'lay-zone hidden');
    layer.append(this.guideX, this.guideY, this.zone, this.buildBar());
    this.layer = layer;
    this.root.append(this.veil, layer);
    this.apply();
    this.select(null);
    this.frame();
    return true;
  }

  /** Closes Edit layout keeping the layout (Esc too). */
  done(): void {
    if (this.editing && this.data() !== this.before) this.ui.toast(`Layout kept: “${this.slot()?.name ?? 'Default'}”`);
    this.finish();
  }

  /** Closes Edit layout putting the layouts back as they were when it opened. */
  cancel(): void {
    if (!this.editing) return;
    if (this.data() !== this.before) {
      this.parse(this.before);
      this.write();
    }
    this.finish();
  }

  /** Each frame while editing: the frames follow their pieces (which change size as they're used). */
  frame(): void {
    if (!this.editing) return;
    const v = this.view();
    for (const p of this.pieces) {
      const f = p.frame;
      if (!f) continue;
      const r = p.el.getBoundingClientRect();
      // its name above it; below one at the top of the screen; inside one as tall as the screen
      const tag = r.top >= 20 ? '' : r.bottom <= v.h - 20 ? 'below' : 'inside';
      const [ax, ay] = this.anchorOf(p);
      const hidden = this.hides(p);
      const key = `${r.left},${r.top},${r.width},${r.height},${tag},${ax},${ay},${hidden},${this.dock()}`;
      if (key === p.drawn) continue;
      p.drawn = key;
      f.style.left = `${r.left}px`;
      f.style.top = `${r.top}px`;
      f.style.width = `${r.width}px`;
      f.style.height = `${r.height}px`;
      f.classList.toggle('below', tag === 'below');
      f.classList.toggle('inside', tag === 'inside');
      f.classList.toggle('ghost', hidden);
      if (p.hideBtn) p.hideBtn.textContent = hidden ? 'Show' : 'Hide';
      // the corner handle away from the point it's scaled about; the size handle on the edge that moves
      if (p.scaleHandle) p.scaleHandle.className = `lay-handle lay-scale ${ay > 0.5 ? 't' : 'b'}${ax > 0.5 ? 'l' : 'r'}`;
      if (p.sizeHandle) p.sizeHandle.className = `lay-handle lay-size ${this.sizeEdge(p)}`;
    }
  }

  private finish(): void {
    if (!this.editing) return;
    this.stopGesture();
    this.editing = false;
    this.root.classList.remove('lay-editing');
    for (const p of this.pieces) {
      p.el.style.removeProperty('display');
      p.el.classList.remove('lay-open');
      p.frame = p.hideBtn = p.scaleHandle = p.sizeHandle = p.drawn = undefined;
    }
    this.veil?.remove();
    this.layer?.remove();
    this.veil = this.layer = this.guideX = this.guideY = this.zone = null;
    if (this.bar) this.pickers = this.pickers.filter((s) => !this.bar!.el.contains(s));
    this.bar = null;
    this.selected = null;
    this.apply();
    this.ui.changed();
    const end = this.onEnd;
    this.onEnd = null;
    end?.();
  }

  /** A piece's frame: its name, Hide, and the handles to scale and size it. */
  private makeFrame(p: Piece): HTMLDivElement {
    const f = el('div', 'lay-frame');
    f.dataset.piece = p.spec.id;
    const toybox = p.spec.id === 'toybox';
    f.title = toybox ? 'Drag to the left, the right or the bottom of the screen to dock it there' : 'Drag to move (Alt: no snapping)';
    const tag = el('div', 'lay-tag');
    tag.appendChild(el('span', '', p.spec.name));
    if (p.spec.hide) {
      const b = el('button', '', 'Hide');
      b.dataset.act = 'hide';
      if (p.spec.hide === 'mouse' && touchLayout()) {
        b.disabled = true;
        b.title = 'It stays on a touch screen: it’s the way to the menus';
      }
      b.onclick = () => this.toggleHidden(p);
      tag.appendChild(b);
      p.hideBtn = b;
    }
    f.appendChild(tag);
    f.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('button, .lay-handle')) return;
      this.down(e, toybox ? 'dock' : 'move', p);
    };
    if (!toybox) {
      const h = el('i', 'lay-handle lay-scale br');
      h.title = 'Drag to scale';
      h.onpointerdown = (e) => this.down(e, 'scale', p);
      f.appendChild(h);
      p.scaleHandle = h;
    }
    if (toybox || p.spec.width) {
      const h = el('i', 'lay-handle lay-size r');
      h.title = toybox ? 'Drag to make the toybox wider or narrower (along the bottom: taller or shorter)' : 'Drag to make it wider or narrower';
      h.onpointerdown = (e) => this.down(e, 'size', p);
      f.appendChild(h);
      p.sizeHandle = h;
    }
    // the wheel scales it too
    f.onwheel = (e) => {
      e.preventDefault();
      const pl = this.changeOf(p.spec.id);
      pl.scale = clamp(Math.round((pl.scale ?? 1) * (e.deltaY < 0 ? 1.05 : 1 / 1.05) * 100) / 100, SCALE.min, SCALE.max);
      this.place(p);
      if (toybox) this.ui.changed();
      this.commit();
      if (this.selected === p) this.renderSelected();
    };
    p.frame = f;
    return f;
  }

  /** The edge of a piece its size handle is on: the one that moves as it's sized. */
  private sizeEdge(p: Piece): 'l' | 'r' | 't' {
    if (p.spec.id === 'toybox') return this.dock() === 'bottom' ? 't' : this.dock() === 'right' ? 'l' : 'r';
    return this.anchorOf(p)[0] > 0.5 ? 'l' : 'r';
  }

  /** The bar of Edit layout: the layouts, the interface's size, the piece picked, and Reset, Cancel and Done. */
  private buildBar(): HTMLDivElement {
    const bar = el('div', 'lay-bar');
    const btn = (row: HTMLElement, label: string, title: string, fn: () => void) => {
      const b = el('button', 'panel-btn', label);
      b.title = title;
      b.onclick = () => {
        this.ui.click();
        fn();
      };
      row.appendChild(b);
      return b;
    };
    const head = el('div', 'lay-bar-head');
    head.title = 'Drag to move this panel';
    head.append(el('span', 'lay-grip', '⠿'), el('div', 'panel-title', 'Edit layout'), el('span', 'lay-esc', 'Esc: done'));
    head.onpointerdown = (e) => this.down(e, 'bar', null);
    bar.appendChild(head);
    const slots = el('div', 'lay-row');
    slots.appendChild(el('span', 'lay-key', 'Layout'));
    const pick = el('select', 'tb-select');
    pick.title = 'Switch to another layout';
    pick.onchange = () => {
      this.use(pick.value);
      pick.blur();
    };
    this.pickers.push(pick);
    slots.appendChild(pick);
    btn(slots, 'Save as…', 'Keep this layout under a new name', () => {
      this.ui.dialog('Save layout as', 'Its name:', this.freeName('My layout'), 'Save', (name) => this.saveAs(name));
    });
    const rename = btn(slots, 'Rename…', 'Rename this layout', () => {
      const s = this.slot();
      if (s) this.ui.dialog('Rename layout', 'Its name:', s.name, 'Rename', (name) => this.rename(name));
    });
    const remove = btn(slots, 'Delete', 'Delete this layout (the Default is used again)', () => {
      const s = this.slot();
      if (s) this.ui.dialog('Delete layout', `Delete the layout “${s.name}” for good?`, null, 'Delete', () => this.remove());
    });
    btn(slots, 'Export…', 'Save this layout to a file', () => this.exportFile());
    btn(slots, 'Import…', 'Open a layout from a file', () => this.importFile());
    bar.appendChild(slots);
    const sizeRow = el('div', 'lay-row');
    sizeRow.appendChild(el('span', 'lay-key', 'Interface'));
    const size = this.slider(this.cur.scale, (v) => this.setScale(v));
    sizeRow.append(size.range, size.val);
    sizeRow.title = 'The size of every piece (each can be scaled on its own too)';
    bar.appendChild(sizeRow);
    const sel = el('div', 'lay-sel');
    bar.appendChild(sel);
    const foot = el('div', 'lay-foot');
    btn(foot, 'Reset to default', 'Every piece back where the game has it', () => this.reset());
    foot.appendChild(el('span', 'lay-gap'));
    btn(foot, 'Cancel', 'Put back everything changed since Edit layout opened', () => this.cancel());
    btn(foot, 'Done', 'Keep this layout (Esc too)', () => this.done());
    bar.appendChild(foot);
    this.bar = { el: bar, rename, remove, size: size.range, sizeVal: size.val, sel };
    this.showSlots();
    return bar;
  }

  /** A slider for a scale (50%–200%): `set` as it's dragged. */
  private slider(value: number, set: (v: number) => void): { range: HTMLInputElement; val: HTMLSpanElement } {
    const range = el('input', 'lay-range');
    range.type = 'range';
    range.min = String(SCALE.min * 100);
    range.max = String(SCALE.max * 100);
    range.step = '5';
    range.value = String(Math.round(value * 100));
    const val = el('span', 'lay-val', pct(value));
    range.oninput = () => {
      const v = parseInt(range.value) / 100;
      set(v);
      val.textContent = pct(v);
    };
    return { range, val };
  }

  /** The bar's part for the piece picked (or how to pick one). */
  private renderSelected(): void {
    const box = this.bar?.sel;
    if (!box) return;
    box.textContent = '';
    const p = this.selected;
    if (!p) {
      box.appendChild(el('div', 'lay-note',
        'Drag a piece to move it: it snaps to the screen’s edges, the other pieces and a grid (hold Alt to place it freely). ' +
        'Drag its corner to scale it, an edge to size it, the toybox to an edge to dock it. Click a piece for more.'));
      return;
    }
    const id = p.spec.id;
    const pl = this.cur.pieces[id] ?? {};
    const btn = (row: HTMLElement, label: string, title: string, fn: () => void, on = false) => {
      const b = el('button', 'panel-btn' + (on ? ' on' : ''), label);
      b.title = title;
      b.onclick = () => {
        this.ui.click();
        fn();
      };
      row.appendChild(b);
      return b;
    };
    const head = el('div', 'lay-row');
    head.appendChild(el('span', 'lay-sel-name', p.spec.name));
    if (p.spec.hide) {
      const b = btn(head, this.hides(p) ? 'Show' : 'Hide', 'Hide it, or show it again', () => this.toggleHidden(p));
      if (p.hideBtn?.disabled) b.disabled = true;
    }
    btn(head, 'Reset', 'Put it back where the game has it', () => this.resetPiece(p));
    box.appendChild(head);
    const size = el('div', 'lay-row');
    size.appendChild(el('span', 'lay-key', 'Size'));
    const s = this.slider(pl.scale ?? 1, (v) => {
      this.changeOf(id).scale = v;
      this.place(p);
      if (id === 'toybox') this.ui.changed();
    });
    s.range.onchange = () => this.commit();
    size.append(s.range, s.val);
    box.appendChild(size);
    if (id !== 'toybox') return;
    const dock = el('div', 'lay-row');
    dock.appendChild(el('span', 'lay-key', 'Dock'));
    for (const [d, label] of [['left', 'Left'], ['right', 'Right'], ['bottom', 'Bottom']] as [Dock, string][]) {
      btn(dock, label, d === 'bottom' ? 'Along the bottom of the screen' : `Down the ${d} of the screen`, () => this.setDock(d), this.cur.dock === d);
    }
    box.appendChild(dock);
    const cols = el('div', 'lay-row');
    cols.appendChild(el('span', 'lay-key', 'Columns'));
    // (unset: the game's, 3 at the side and as many as fit along the bottom)
    const n = this.cur.cols ?? (this.cur.dock === 'bottom' ? 0 : 3);
    btn(cols, '−', 'Fewer columns', () => this.setCols(n === 0 ? 3 : Math.max(1, n - 1)));
    cols.appendChild(el('span', 'lay-val', n === 0 ? 'Auto' : String(n)));
    btn(cols, '+', 'More columns', () => this.setCols(n === 0 ? 4 : Math.min(TOYBOX.cols, n + 1)));
    btn(cols, 'Auto', 'As many as fit', () => this.setCols(0), n === 0);
    box.appendChild(cols);
  }

  private select(p: Piece | null): void {
    this.selected = p;
    for (const q of this.pieces) q.frame?.classList.toggle('sel', q === p);
    this.renderSelected();
  }

  private toggleHidden(p: Piece): void {
    if (!p.spec.hide) return;
    const pl = this.changeOf(p.spec.id);
    pl.hidden = !pl.hidden;
    this.place(p);
    this.commit();
    p.drawn = undefined;
    this.frame();
    if (this.selected === p) this.renderSelected();
  }

  /** One piece back where the game has it (the toybox: on the left, with its columns). */
  private resetPiece(p: Piece): void {
    const id = p.spec.id;
    const L = this.cur;
    if (!L.pieces[id] && (id !== 'toybox' || (L.dock === 'left' && L.cols === undefined))) return;
    delete L.pieces[id];
    if (id === 'toybox') {
      L.dock = 'left';
      delete L.cols;
    }
    this.apply();
    this.ui.changed();
    this.commit();
    this.renderSelected();
  }

  // ---- dragging -----------------------------------------------------------------------------

  private down(e: PointerEvent, kind: Gesture['kind'], piece: Piece | null): void {
    if (e.button !== 0 || this.gesture) return;
    e.preventDefault();
    e.stopPropagation();
    if (piece && piece !== this.selected) this.select(piece);
    const target = kind === 'bar' ? this.bar?.el : piece?.el;
    if (!target) return;
    this.gesture = {
      kind,
      piece,
      x0: e.clientX,
      y0: e.clientY,
      box: target.getBoundingClientRect(),
      scale: piece ? this.cur.pieces[piece.spec.id]?.scale ?? 1 : 1,
      size: piece ? this.sizeOf(piece) : 0,
      moved: false,
    };
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
  }

  private move = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    const v = this.view();
    if (g.kind === 'bar') {
      const s = this.bar!.el.style;
      s.left = `${clamp(g.box.left + dx, 0, Math.max(0, v.w - g.box.width))}px`;
      s.top = `${clamp(g.box.top + dy, 0, Math.max(0, v.h - g.box.height))}px`;
      s.transform = 'none';
      return;
    }
    const p = g.piece!;
    const id = p.spec.id;
    if (g.kind === 'dock') {
      // the edge nearest the pointer
      const l = e.clientX;
      const r = v.w - e.clientX;
      const b = v.h - e.clientY;
      g.dock = b < Math.min(l, r) ? 'bottom' : l <= r ? 'left' : 'right';
      this.showZone(g.dock);
      return;
    }
    const pl = this.changeOf(id);
    if (g.kind === 'move') {
      const { width: w, height: h } = g.box;
      let left = g.box.left + dx;
      let top = g.box.top + dy;
      let lines: [number | null, number | null] = [null, null];
      if (!e.altKey) ({ left, top, lines } = this.snap(p, left, top, w, h));
      left = clamp(left, 0, Math.max(0, v.w - w));
      top = clamp(top, 0, Math.max(0, v.h - h));
      pl.at = placeFor(left, top, w, h, v);
      this.place(p);
      this.showGuides(lines);
    } else if (g.kind === 'scale') {
      // by how much farther the pointer is from the point it's scaled about
      const [ax, ay] = this.anchorOf(p);
      const x = g.box.left + ax * g.box.width;
      const y = g.box.top + ay * g.box.height;
      const k = Math.hypot(e.clientX - x, e.clientY - y) / Math.max(8, Math.hypot(g.x0 - x, g.y0 - y));
      const s = clamp(g.scale * k, SCALE.min, SCALE.max);
      pl.scale = e.altKey ? s : Math.round(s * 20) / 20;
      this.place(p);
    } else {
      const s = this.scaleOf(p);
      if (id === 'toybox') {
        if (this.cur.dock === 'bottom') pl.h = clamp(g.size - dy / s, TOYBOX.h[0], Math.min(TOYBOX.h[1], v.h * 0.7));
        else pl.w = clamp(g.size + (this.cur.dock === 'left' ? dx : -dx) / s, TOYBOX.w[0], TOYBOX.w[1]);
        this.place(p);
        this.ui.changed();
      } else if (p.spec.width) {
        // (one kept by its middle grows both ways: twice as fast)
        const ax = this.anchorOf(p)[0];
        pl.w = clamp(g.size + (dx * (ax > 0.5 ? -1 : ax === 0.5 ? 2 : 1)) / s, p.spec.width[0], p.spec.width[1]);
        this.place(p);
      }
    }
  };

  private up = (): void => {
    const g = this.stopGesture();
    if (!g?.moved || g.kind === 'bar') return;
    if (g.kind === 'dock') {
      if (g.dock) this.setDock(g.dock);
      return;
    }
    this.commit();
    if (this.selected === g.piece) this.renderSelected();
  };

  private stopGesture(): Gesture | null {
    const g = this.gesture;
    this.gesture = null;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    this.showGuides([null, null]);
    this.showZone(null);
    return g;
  }

  /** What a size handle starts from: a piece's width (unscaled), the toybox's panel's (its height along the bottom). */
  private sizeOf(p: Piece): number {
    const pl = this.cur.pieces[p.spec.id] ?? {};
    if (p.spec.id !== 'toybox') return pl.w ?? p.el.offsetWidth;
    const panel = p.el.querySelector<HTMLElement>('.cat-panel');
    return this.cur.dock === 'bottom' ? pl.h ?? panel?.offsetHeight ?? 220 : pl.w ?? panel?.offsetWidth ?? 236;
  }

  /**
   * A box being moved (screen px), snapped: its edges or middle to the screen's
   * edges, margins and middle, or to another piece's (in line with it, or
   * beside it), whichever is nearest within SNAP; else to the grid. Also the
   * lines it snapped to, to show (null: none).
   */
  private snap(p: Piece, left: number, top: number, w: number, h: number): { left: number; top: number; lines: [number | null, number | null] } {
    const v = this.view();
    // [line, which part of the box goes on it: 0 its start, 0.5 its middle, 1 its end]
    const xs: [number, number][] = [[0, 0], [MARGIN, 0], [v.w / 2, 0.5], [v.w - MARGIN, 1], [v.w, 1]];
    const ys: [number, number][] = [[0, 0], [MARGIN, 0], [v.h / 2, 0.5], [v.h - MARGIN, 1], [v.h, 1]];
    for (const q of this.pieces) {
      if (q === p || !q.frame) continue;
      const r = q.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      xs.push([r.left, 0], [r.right, 1], [(r.left + r.right) / 2, 0.5], [r.right + GAP, 0], [r.left - GAP, 1]);
      ys.push([r.top, 0], [r.bottom, 1], [(r.top + r.bottom) / 2, 0.5], [r.bottom + GAP, 0], [r.top - GAP, 1]);
    }
    const best = (start: number, size: number, lines: [number, number][]): [number, number | null] => {
      let d = SNAP + 1;
      let at: number | null = null;
      for (const [line, part] of lines) {
        const dd = line - (start + part * size);
        if (Math.abs(dd) < Math.abs(d)) {
          d = dd;
          at = line;
        }
      }
      return at === null ? [Math.round(start / GRID) * GRID, null] : [start + d, at];
    };
    const [x, gx] = best(left, w, xs);
    const [y, gy] = best(top, h, ys);
    return { left: x, top: y, lines: [gx, gy] };
  }

  private showGuides([x, y]: [number | null, number | null]): void {
    if (this.guideX) {
      this.guideX.classList.toggle('hidden', x === null);
      if (x !== null) this.guideX.style.left = `${Math.round(x)}px`;
    }
    if (this.guideY) {
      this.guideY.classList.toggle('hidden', y === null);
      if (y !== null) this.guideY.style.top = `${Math.round(y)}px`;
    }
  }

  /** Where the toybox dragged would dock (null: nowhere shown). */
  private showZone(dock: Dock | null): void {
    const z = this.zone;
    if (!z) return;
    z.classList.toggle('hidden', !dock);
    if (dock) z.className = `lay-zone ${dock}`;
  }
}

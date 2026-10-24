import type { ContextAction } from '../world/types';
import { CATEGORIES } from '../world/types';
import { ITEMS, getItem } from '../catalog/items';
import { POWERS, toolSlot, type ToolId } from '../tools/Controls';

/**
 * What a tutorial step lets the player use, besides what it names (see
 * TutorialLock): everything else on the toybox, the tool bar, the context menu
 * and the keyboard is greyed out and does nothing while the step is on.
 */
export interface Allow {
  /** Toybox entries, by id (alone: of their shelf, only these). */
  items?: string[];
  /** Toybox shelves (with no `items` on them: all they hold). */
  categories?: string[];
  /** Tools and powers, by id. */
  tools?: string[];
  /** Keyboard commands, by binding id ('freeze'), and Ctrl shortcuts by key ('Ctrl+KeyZ'). */
  actions?: string[];
  /** Context-menu entries, by label ('*': any). */
  menu?: string[];
  /** Tool bar buttons, by the start of their tooltip ('Maps'). */
  buttons?: string[];
  /** Nothing locked. */
  all?: boolean;
}

/**
 * Always to hand, whatever the step: looking about, stopping time, Esc (the
 * pause menu, and the way out), Shift (multiselect, chaining connections), the
 * Drag tool's key (back to bare hands, as its button always is), and showing the
 * toybox and the interface again (a step may need them, hidden before it).
 */
const SAFE = new Set(['panLeft', 'panRight', 'panUp', 'panDown', 'zoomIn', 'zoomOut', 'recenter', 'time', 'menu', 'fast', 'tool1', 'toybox', 'toggleUi']);
/** Tool bar buttons that do what a key does (allowed with it), by the start of their tooltip. */
const BUTTON_KEYS: [string, string][] = [
  ['Toggle time', 'time'], ['Step one tick', 'step'], ['Slow motion', 'slowmo'], ['X-ray', 'xray'], ['Controls', 'help'],
  ['Undo', 'Ctrl+KeyZ'], ['Redo', 'Ctrl+KeyY'], ['Quick save', 'Ctrl+KeyS'], ['Quick load', 'Ctrl+KeyO'], ['Back to build', 'rewind'],
];
/** The touch bar's buttons, as the keys they stand for. */
const TOUCH_KEYS: Record<string, string> = {
  Use: 'activate',
  Freeze: 'freeze',
  '⟲': 'rotateLeft',
  '⟳': 'rotateRight',
  Flip: 'flip',
  Delete: 'delete',
  '◀': 'driveLeft',
  '▶': 'driveRight',
  '▲': 'aimUp',
  '▼': 'aimDown',
};
/** What a greyed-out thing says when pointed at. */
export const LOCKED_NOTE = 'Not in this step';

/** A name as the step's text and the interface may each put it ("Edit gun…", "☑ Belts"): lower case, bare. */
const norm = (s: string) => s.replace(/[☑☐]/g, '').replace(/[….:]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

interface Rule {
  items: Set<string>;
  /** The shelves `items` are on (only those of them, there). */
  itemCats: Set<string>;
  cats: Set<string>;
  tools: Set<string>;
  actions: Set<string>;
  menu: Set<string>;
  buttons: string[];
  /** What the step's text names (in bold, or as keys): buttons, menu entries, toys, tools by those names are allowed. */
  names: Set<string>;
  all: boolean;
}

/**
 * Keeps the player to what the tutorial's step is about. While a step is on,
 * toybox shelves and entries, tool bar buttons, tools and powers, context-menu
 * entries and keyboard commands other than the ones it allows are greyed out
 * (with a tooltip saying why) and ignore clicks and keys; looking about, time's
 * pause and Esc always work, as does whatever the step is pointing at. Off
 * (`set(null)`), everything is as it was.
 */
export class TutorialLock {
  private rule: Rule | null = null;
  /** What the step points at now (a button, a toybox entry): never locked. */
  private target: Element | null = null;

  /** A shelf opened, a search typed, the touch bar shown: greyed out as they appear. */
  private watch: MutationObserver;

  constructor(private root: HTMLElement) {
    // (caught on the way down, before the button's own handler: a greyed-out one does nothing)
    const stop = (e: Event) => {
      if (!this.rule) return;
      this.flush();
      const t = e.target;
      if (t instanceof Element && t.closest('.tut-locked')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click', 'dblclick', 'contextmenu']) document.addEventListener(type, stop, true);
    this.watch = new MutationObserver(() => {
      if (this.rule) this.apply();
    });
    this.watch.observe(root, { childList: true, subtree: true });
  }

  get on(): boolean {
    return !!this.rule;
  }

  /**
   * Greys out what has just appeared, now (it would be before the next paint
   * anyway): for a click that comes in the same moment, as a script's does.
   */
  flush(): void {
    if (this.watch.takeRecords().length && this.rule) this.apply();
  }

  /** The step's allowance (null: no tour on, nothing locked); `names`: what its text names. */
  set(a: Allow | null, names: Iterable<string> = []): void {
    if (!a) {
      this.rule = null;
      this.target = null;
      this.apply();
      return;
    }
    const named = new Set([...names].map(norm).filter(Boolean));
    // the toys asked for, by id or by name ("click <b>Human</b>"): of their shelves, only those
    const items = new Set(a.items ?? []);
    for (const def of ITEMS) if (!def.tool && named.has(norm(def.name))) items.add(def.id);
    const itemCats = new Set([...items].map((id) => getItem(id)?.category).filter((c): c is NonNullable<typeof c> => !!c));
    this.rule = {
      items,
      itemCats,
      cats: new Set([...(a.categories ?? []), ...(a.items ?? []).map((id) => getItem(id)?.category ?? '')]),
      tools: new Set(a.tools ?? []),
      actions: new Set(a.actions ?? []),
      menu: new Set((a.menu ?? []).map(norm)),
      buttons: (a.buttons ?? []).map((b) => b.toLowerCase()),
      names: named,
      all: !!a.all,
    };
    this.apply();
  }

  /** What the step points at now (kept usable whatever the allowance). */
  setTarget(e: Element | null): void {
    if (e === this.target) return;
    this.target = e;
    if (this.rule) this.apply();
  }

  /** Does the step keep the player off this command (a binding's id, or 'Ctrl+KeyZ')? */
  blocks(what: string): boolean {
    const r = this.rule;
    return !!r && !r.all && !SAFE.has(what) && !r.actions.has(what);
  }

  /** May this context-menu entry be taken? */
  menuOk(label: string): boolean {
    const r = this.rule;
    if (!r || r.all || r.menu.has('*')) return true;
    // (a connection's menu's way to its thing's own: that one's entries are greyed in turn)
    if (/^The .+…$/.test(label)) return true;
    const n = norm(label);
    // by its label, or how it starts: "Speed" for "Speed: Turbo", "Barrel" for "Barrel 10°"
    const is = (w: string) => n === w || n.startsWith(`${w}:`) || n.startsWith(`${w} `);
    return r.names.has(n) || [...r.menu].some(is) || [...r.names].some((w) => w.length >= 3 && is(w));
  }

  /** Greys out a context menu's entries the step isn't about (before it's shown). */
  greyMenu(actions: ContextAction[]): void {
    if (!this.rule) return;
    for (const a of actions) {
      if (a.disabled || this.menuOk(a.label)) continue;
      a.disabled = true;
      a.hint = LOCKED_NOTE;
    }
  }

  /** May this toybox entry be picked? */
  itemOk(id: string, cat: string): boolean {
    const r = this.rule;
    if (!r || r.all || r.items.has(id)) return true;
    // a whole shelf allowed (but for the ones a step picks out of it)
    return this.categoryOk(cat) && !r.itemCats.has(cat);
  }

  /** May this toybox shelf be opened? */
  categoryOk(cat: string): boolean {
    const r = this.rule;
    if (!r || r.all || r.cats.has(cat) || r.names.has(norm(cat))) return true;
    const label = CATEGORIES.find((c) => c.id === cat)?.label;
    return !!label && r.names.has(norm(label));
  }

  private keyOk(id: string): boolean {
    return !this.blocks(id);
  }

  /** A tool bar button, by its tooltip. */
  private buttonOk(title: string): boolean {
    const r = this.rule!;
    const t = title.toLowerCase();
    if (r.buttons.some((b) => t.startsWith(b))) return true;
    const key = BUTTON_KEYS.find(([start]) => title.startsWith(start));
    if (key) return this.keyOk(key[1]);
    const n = norm(title);
    return [...r.names].some((w) => w.length >= 3 && n.startsWith(w));
  }

  /** A tool or power button (or one of a tool's kinds). */
  private toolOk(b: HTMLElement): boolean {
    const r = this.rule!;
    const id = b.dataset.tool ?? b.dataset.power ?? '';
    if (id === 'drag' || r.tools.has(id)) return true;
    if (b.dataset.tool) {
      const slot = toolSlot(id as ToolId);
      if (slot >= 0 && r.actions.has(`tool${slot + 1}`)) return true;
    }
    const names = [b.dataset.name ?? '', ...(b.dataset.names ?? '').split('|')].filter(Boolean);
    return names.some((n) => r.names.has(norm(n)));
  }

  /** The Tools ⇄ Powers switch: with its key, or a power to get to. */
  private tabOk(): boolean {
    const r = this.rule!;
    if (r.actions.has('toolPower') || POWERS.some((p) => r.tools.has(p))) return true;
    return [...this.root.querySelectorAll<HTMLElement>('.tool-btn[data-power]')].some((b) => r.names.has(norm(b.dataset.name ?? '')));
  }

  /** Greys out (or back) what the step isn't about. */
  apply(): void {
    const r = this.rule;
    const mark = (e: HTMLElement, ok: boolean) => {
      const t = this.target;
      const locked = !!r && !r.all && !ok && !(t && (e === t || e.contains(t) || t.contains(e)));
      if (locked) {
        e.classList.add('tut-locked');
        e.setAttribute('aria-disabled', 'true');
        // (its own tooltip kept aside, for after: the tooltip says why it does nothing)
        if (e.title !== LOCKED_NOTE) {
          e.dataset.tutTitle = e.title;
          e.title = LOCKED_NOTE;
        }
        if (e instanceof HTMLSelectElement) e.disabled = true;
      } else if (e.classList.contains('tut-locked')) {
        e.classList.remove('tut-locked');
        e.removeAttribute('aria-disabled');
        if (e.dataset.tutTitle !== undefined) {
          e.title = e.dataset.tutTitle;
          delete e.dataset.tutTitle;
        }
        if (e instanceof HTMLSelectElement) e.disabled = false;
      }
    };
    const all = (sel: string) => this.root.querySelectorAll<HTMLElement>(sel);
    if (!r) {
      for (const e of all('.tut-locked')) mark(e, true);
      return;
    }
    const title = (e: HTMLElement) => e.dataset.tutTitle ?? e.title;
    for (const e of all('.toolbar .tb-btn')) mark(e, this.buttonOk(title(e)));
    for (const e of all('.toolbar .tb-select')) mark(e, r.buttons.some((b) => title(e).toLowerCase().startsWith(b)));
    for (const e of all('.tools .tool-btn[data-tool], .tools .tool-btn[data-power]')) mark(e, this.toolOk(e));
    for (const e of all('.tools .tool-tab')) mark(e, this.tabOk());
    for (const e of all('.cat-strip .cat-btn[data-cat]')) mark(e, this.categoryOk(e.dataset.cat!));
    for (const e of all('.items .item[data-id]')) mark(e, this.itemOk(e.dataset.id!, e.dataset.cat ?? ''));
    for (const e of all('.items .items-btn')) mark(e, this.categoryOk('Contraptions'));
    for (const e of all('.touchbar .touch-btn, .drivepad .touch-btn')) {
      const label = e.textContent ?? '';
      // (the building bar's switches are a mouse's Alt and Shift: free; but for its ⟲, Back to build)
      const key = e.closest('.buildbar') ? (label === '⟲' ? 'rewind' : undefined) : TOUCH_KEYS[label];
      mark(e, key ? this.keyOk(key) || r.names.has(norm(label)) : true);
    }
  }
}

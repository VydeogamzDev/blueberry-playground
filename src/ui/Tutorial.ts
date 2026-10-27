import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Entity } from '../world/Entity';
import type { ActionId } from '../tools/Bindings';
import type { V2 } from '../engine/math';
import type { ConnKind, Connection } from '../systems/Connections';
import type { Category } from '../world/types';
import { getItem } from '../catalog/items';
import { ENDLESS, LAB } from '../world/Maps';
import { PX, WORLD } from '../engine/constants';
import { wrapAngle } from '../engine/math';
import { isLiving } from '../systems/Fighting';
import { NUKE_MIN_KT } from '../systems/Explosions';
import { LIQUID_IDS } from '../systems/Liquids';
import { Human } from '../entities/Human';
import { Creature } from '../entities/Creature';
import { Item } from '../entities/Item';
import { Firearm } from '../entities/Firearm';
import { Blade } from '../entities/Melee';
import { Crossbow } from '../entities/Crossbow';
import { Syringe } from '../entities/Syringe';
import { FirstAidKit, asPatient, needsCare } from '../entities/Medical';
import { Flask } from '../entities/Flask';
import { Bucket } from '../entities/Bucket';
import { Nuke } from '../entities/Nuke';
import { Explosive } from '../entities/Explosive';
import { Car, GEARS } from '../entities/Car';
import { Tank } from '../entities/Tank';
import { toolSlot, type PowerId, type ToolId } from '../tools/Controls';
import { TutorialLock, type Allow } from './TutorialLock';
import type { ContextAction } from '../world/types';
import { store } from '../engine/Store';

/** One thing the tutorial asks the player to do (or, `info`, to read). */
export interface TutorialStep {
  id: string;
  title: string;
  /** What to do (HTML: <b>, <kbd>), worded for a mouse and keyboard or for a touch screen. */
  text(t: Tutorial): string;
  /** Sets the stage as the step starts: spawns what it needs (again, if the player has broken it already). */
  setup?(t: Tutorial): void;
  /** Done yet? Asked every frame; never asked of an `info` step. */
  done?(t: Tutorial): boolean;
  /** What to point at: a thing or a point in the sandbox (an arrow over it), or a button (it glows). */
  target?(t: Tutorial): Entity | V2 | Element | null | undefined;
  /** Something the view keeps up with while the step is on (a car driving off), or null. */
  follow?(t: Tutorial): V2 | null;
  /** Does the step's job for a player who skips it, where later steps build on it (the rocket). */
  skipped?(t: Tutorial): void;
  /** Only something to read: a button goes on (labelled so). */
  info?: string;
  /** More buttons on an `info` step (the last one's: go on to the next tour, tidy up). */
  alts?: { label: string; action(t: Tutorial): void }[];
  /** Needs a keyboard (a key with no button for it): left out on a touch screen. */
  keyboard?: boolean;
  /**
   * What the player may use while the step is on, besides what its text names
   * (the keys it gives, the buttons, menu entries, toys and tools in bold) and
   * what it points at; everything else is greyed out (see TutorialLock).
   */
  allow?: Allow | ((t: Tutorial) => Allow);
}

/**
 * The tours, each about one part of the game and its mechanics together: the
 * basics (a couple of minutes), then about ten minutes each on people and
 * medicine, weapons, vehicles, the world, editing and saving, animals, and
 * building machines.
 */
export type TourId = 'basics' | 'people' | 'weapons' | 'vehicles' | 'world' | 'editing' | 'animals' | 'building';
/** (kept up here, not read off TOURS: progress is read before the steps further down are defined, if need be) */
const TOUR_IDS: TourId[] = ['basics', 'people', 'weapons', 'vehicles', 'world', 'editing', 'animals', 'building'];

/** A tour: its steps, and how the Tutorials panel (and the main menu) offer it. */
export interface Tour {
  id: TourId;
  title: string;
  /** What it covers, in a line. */
  blurb: string;
  /** About how long it takes. */
  minutes: number;
  steps: TutorialStep[];
}

/** A tour as offered: `done`, the player has been through it to the end. */
export interface TourInfo {
  id: TourId;
  title: string;
  blurb: string;
  minutes: number;
  done: boolean;
}

/** Where the browser keeps how far the player got with a tour (the basics' is the first tutorial's). */
export const storeKey = (id: TourId) => (id === 'basics' ? 'blueberry-tutorial' : `blueberry-tutorial-${id}`);

/**
 * Which tours the player has had, kept in the browser: finished ('done'), or
 * left part way ('left': not offered as new again, but not ticked either).
 * They're only ever offered, never forced.
 */
export class TourProgress {
  private kept = new Map<TourId, 'done' | 'left'>();

  constructor() {
    this.reload();
  }

  /** Reads it all again from the browser. */
  reload(): void {
    this.kept.clear();
    for (const id of TOUR_IDS) {
      let v: string | null = null;
      try {
        v = store.getItem(storeKey(id));
      } catch {
        /* nothing kept: all new */
      }
      if (v === 'done' || v === 'left') this.kept.set(id, v);
    }
  }

  /** Been through it to the end. */
  done(id: TourId): boolean {
    return this.kept.get(id) === 'done';
  }

  /** Had it: finished, or left part way. */
  had(id: TourId): boolean {
    return this.kept.has(id);
  }

  /** Remembers how far they got (a tour finished once stays finished). */
  mark(id: TourId, how: 'done' | 'left'): void {
    if (how === 'left' && this.kept.has(id)) return;
    this.kept.set(id, how);
    try {
      store.setItem(storeKey(id), how);
    } catch {
      /* not kept: offered as new again next time */
    }
  }
}

/** What the tutorial needs of the rest of the interface. */
export interface TutorialHooks {
  /** How many contraptions the player has saved in the toybox. */
  contraptions?(): number;
  /** Opens the Tutorials panel (a finished tour's "More tutorials…"). */
  tutorials?(): void;
}

/** Counts of what the player has made happen since the tutorial began (see hookAll()). */
const noneSeen = () => ({
  blasts: 0, nukes: 0, shots: 0, bolts: 0, menus: 0, undos: 0, redos: 0, pastes: 0, flips: 0, steps: 0, edits: 0, saves: 0, loads: 0, swings: 0,
  /** Radians turned with A/D (or the touch bar's ⟲ ⟳), all together. */
  turned: 0,
  powers: new Set<PowerId>(), paused: false, slow: false,
});
/** Seconds the tick of a finished step shows before the next one. */
const CHEER = 0.9;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The guided tour: a card over the sandbox asks for one thing at a time (spawn
 * someone, fling them, arm them, blow things up...), points at what to use, and
 * moves on by itself the moment it's done. A clean Lab to start; the props each
 * step needs are put out for it. Any step can be skipped, and the whole thing
 * left with ×. Only offered (from the main menu and the Tutorials panel), never forced.
 */
export class Tutorial {
  /** Running? */
  active = false;
  /** The step on (an index into steps). */
  index = 0;
  /** The tour on. */
  tour: TourId = 'basics';
  /** Which tours the player has had. */
  readonly progress = new TourProgress();
  /** Connections were numbered up to this when the step began (see made()). */
  mark = 0;
  /** What the tutorial put out (the player's own spawns are the rest). */
  readonly props = new Set<Entity>();
  /** The props steps refer back to, by name (the beam the rope goes to, the rocket's parts). */
  readonly refs = new Map<string, Entity>();
  /** A number a step keeps between its setup and its checks (ropes there were, the rocket's height). */
  n = 0;
  /** More numbers a step keeps between its setup and its checks, by name (cleared as each step begins). */
  memo: Record<string, number> = {};
  /** Counts of what the player has made happen since the tutorial began. */
  readonly seen = noneSeen();
  /** Greys out what the step on isn't about. */
  readonly lock: TutorialLock;

  private card: HTMLDivElement;
  private head: HTMLSpanElement;
  private title: HTMLSpanElement;
  private text: HTMLDivElement;
  private fill: HTMLDivElement;
  private btns: HTMLDivElement;
  private arrow: HTMLDivElement;
  private glowing: Element | null = null;
  /** Seconds left of a finished step's tick (0: none showing). */
  private cheer = 0;
  /** The view has been brought to what the step points at (only the once: then it's the player's). */
  private framed = false;
  private unhooks: (() => void)[] = [];
  /** While a step's text is read for what it names (see lockStep()): the keys it gives. */
  private heard: Set<string> | null = null;
  /** While a step's text is read for what it names: worded for a touch screen (true) or not, whatever this one is. */
  private touchAs: boolean | null = null;

  constructor(
    readonly game: Game,
    readonly controls: Controls,
    root: HTMLElement,
    readonly hooks: TutorialHooks = {},
  ) {
    this.card = el('div', 'tut-card hidden');
    const top = el('div', 'tut-head');
    this.head = el('span', 'tut-count');
    this.title = el('span', 'tut-title');
    const x = el('button', 'tut-x', '×');
    x.title = 'End the tutorial';
    x.onclick = () => {
      this.game.sound.ui('click');
      this.stop();
    };
    top.append(this.head, this.title, x);
    this.text = el('div', 'tut-text');
    const bar = el('div', 'tut-bar');
    this.fill = el('div', 'tut-fill');
    bar.appendChild(this.fill);
    this.btns = el('div', 'tut-btns');
    this.card.append(top, this.text, bar, this.btns);
    // (clicks on the card are the card's: nothing behind it is grabbed or spawned)
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(this.card);
    this.arrow = el('div', 'tut-arrow hidden');
    root.appendChild(this.arrow);
    this.lock = new TutorialLock(root);
    game.frameHandlers.push((dt) => this.frame(dt));
  }

  /** Has the player been through the basics (or left them) before? */
  get had(): boolean {
    return this.hadTour('basics');
  }

  /** Has the player been through a tour (or left it part way) before? */
  hadTour(tour: TourId): boolean {
    return this.progress.had(tour);
  }

  /** Every tour, as the Tutorials panel and the main menu offer them. */
  tours(): TourInfo[] {
    return TOURS.map(({ id, title, blurb, minutes }) => ({ id, title, blurb, minutes, done: this.progress.done(id) }));
  }

  get steps(): TutorialStep[] {
    return (TOURS.find((t) => t.id === this.tour) ?? TOURS[0]).steps;
  }

  get step(): TutorialStep {
    return this.steps[this.index];
  }

  get touch(): boolean {
    return this.touchAs ?? this.controls.touchMode;
  }

  /** A command's key as the player has it bound (<kbd>), or `fallback` if it has none. */
  key(id: ActionId, fallback = ''): string {
    this.heard?.add(id);
    const label = this.controls.bindings.label(id);
    return label ? `<kbd>${esc(label)}</kbd>` : fallback;
  }

  /** How to put the toybox's item down, the way this player places things (Settings › Spawning). */
  spawnHow(): string {
    return this.controls.placement === 'click' ? 'click the floor' : `point at the floor and press ${this.key('spawnRight', '<kbd>E</kbd>')}`;
  }

  /**
   * Starts the tour in a clean Lab (the scene there now is a Ctrl+Z away). Not in
   * someone else's game, nor while hosting one: the scene is everyone's.
   */
  start(tour: string = 'basics'): boolean {
    const want = TOURS.find((t) => t.id === tour);
    if (!want) return false;
    if (this.controls.net || this.game.net) {
      this.controls.ui.toast('Leave the multiplayer game to take the tutorial');
      return false;
    }
    if (this.active) this.stop(false);
    this.tour = want.id;
    this.controls.terrain?.stop();
    if (this.game.map.id !== LAB.id) this.controls.switchMap(LAB);
    this.controls.clearScene('Tutorial');
    this.controls.arm(null);
    this.controls.setTool('drag');
    if (this.game.paused) this.controls.togglePause();
    if (this.game.timeScale !== 1) this.controls.setTimeScale(1);
    const r = this.game.renderer;
    const home = this.game.home();
    r.camX = home.x;
    r.camY = this.floorView;
    this.props.clear();
    this.refs.clear();
    Object.assign(this.seen, noneSeen());
    this.hookAll();
    // (keys and commands the step on isn't about do nothing: see lockStep())
    this.controls.tutorialBlocks = (what) => this.lock.blocks(what);
    this.active = true;
    this.card.classList.remove('hidden');
    this.go(0);
    return true;
  }

  /**
   * Ends the tour (`had`: remembered as taken, so it isn't offered as new
   * again; from its last step, as finished).
   */
  stop(had = true): void {
    if (!this.active) return;
    const finished = this.index >= this.steps.length - 1;
    this.active = false;
    // (last hooked, first put back: two on one method would otherwise leave the first behind)
    for (const u of this.unhooks.splice(0).reverse()) u();
    // everything back as it was
    this.controls.tutorialBlocks = null;
    this.lock.set(null);
    this.card.classList.add('hidden');
    this.arrow.classList.add('hidden');
    this.glow(null);
    this.cheer = 0;
    if (had) this.progress.mark(this.tour, finished ? 'done' : 'left');
  }

  /** Goes on to step `i` (past the last: the end). */
  go(i: number): void {
    // (a step that needs a keyboard is left out on a touch screen)
    while (i < this.steps.length && this.touch && this.steps[i].keyboard) i++;
    if (i >= this.steps.length) {
      this.index = this.steps.length - 1;
      this.stop();
      return;
    }
    this.index = i;
    this.cheer = 0;
    this.framed = false;
    this.memo = {};
    this.card.classList.remove('cheer');
    const s = this.step;
    this.mark = this.game.connections.list.reduce((m, c) => Math.max(m, c.id), 0);
    s.setup?.(this);
    this.render();
    this.lockStep();
  }

  /**
   * Keeps the player to the step on: what it names (the keys its text gives,
   * whatever it names in bold: buttons, menu entries, toys, tools, worded for a
   * mouse or a touch screen alike, and Ctrl+key shortcuts), its own `allow`, and
   * what it points at; the rest is greyed out. An `info` step is only to read;
   * the last one ("Play!") is the tour over, and lets go.
   */
  private lockStep(): void {
    const s = this.step;
    if (s.info && this.index === this.steps.length - 1) return this.lock.set({ all: true });
    const names = new Set<string>();
    const keys = new Set<string>();
    if (!s.info) {
      for (const touch of [false, true]) {
        this.touchAs = touch;
        this.heard = keys;
        try {
          const html = s.text(this);
          for (const m of html.matchAll(/<(b|kbd)>(.*?)<\/\1>/g)) names.add(m[2].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'));
          for (const m of html.matchAll(/<kbd>Ctrl<\/kbd>\s*\+\s*<kbd>(\w)<\/kbd>/g)) keys.add(`Ctrl+Key${m[1].toUpperCase()}`);
        } finally {
          this.touchAs = null;
          this.heard = null;
        }
      }
    }
    const own = typeof s.allow === 'function' ? s.allow(this) : s.allow ?? {};
    this.lock.set({ ...own, actions: [...(own.actions ?? []), ...keys] }, names);
  }

  /** Skips the step on. */
  skip(): void {
    this.step.skipped?.(this);
    this.go(this.index + 1);
  }

  // ---- helpers for the steps ------------------------------------------------------------

  /**
   * Puts one of the toys out for the tutorial, standing on the ground at x (or
   * `dy` m above it, turned by `angle`; `frozen`: held there).
   */
  put(id: string, x: number, o: { flip?: boolean; dy?: number; angle?: number; frozen?: boolean } = {}): Entity | null {
    const def = getItem(id);
    if (!def) return null;
    // (turned a quarter, its half width is what it stands on)
    const hh = o.angle && Math.abs(Math.sin(o.angle)) > 0.7 ? (def.preview().width * PX) / 2 : def.halfHeight ?? 0.3;
    const y = this.game.env.standAt(x, WORLD.floor + hh + (o.dy ?? 0)) + hh + 0.01 + (o.dy ?? 0);
    const e = this.game.spawn(def, x, y, { flip: o.flip, angle: o.angle });
    if (!e) return null;
    if (o.frozen) e.setFrozen(true);
    this.props.add(e);
    return e;
  }

  /** The connections of a kind made since the step began (by the player: the tutorial makes none). */
  made(kind: ConnKind): Connection[] {
    return this.game.connections.list.filter((c) => c.kind === kind && c.id > this.mark);
  }

  /** Is there a connection of a kind between these two things (either way round)? */
  joined(kind: ConnKind, a: Entity, b: Entity | null): boolean {
    return this.game.connections.list.some(
      (c) => c.kind === kind && ((c.a.entity === a && (c.b?.entity ?? null) === b) || (c.a.entity === b && c.b?.entity === a)),
    );
  }

  /** A stack of `n` of a toy at x. */
  stack(id: string, x: number, n: number): Entity[] {
    const def = getItem(id);
    const h = (def?.halfHeight ?? 0.3) * 2 + 0.03;
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      const e = this.put(id, x, { dy: i * h });
      if (e) out.push(e);
    }
    return out;
  }

  /** A prop put out under a name, while it's still about. */
  ref(name: string): Entity | null {
    const e = this.refs.get(name);
    if (!e || !e.destroyed) return e ?? null;
    // (mirrored as someone took it in hand, or resized: made again, as another)
    const now = this.game.successorOf(e);
    if (now) {
      this.refs.set(name, now);
      if (this.props.delete(e)) this.props.add(now);
    }
    return now;
  }

  /** A prop kept under a name as it is now: what it was made again as, else itself, gone or not (for "used up" or "smashed"). */
  was(name: string): Entity | undefined {
    return this.ref(name) ?? this.refs.get(name);
  }

  /** Puts a prop out under a name (see ref()). */
  keep(name: string, e: Entity | null): Entity | null {
    if (e) this.refs.set(name, e);
    return e;
  }

  /** The things in the scene of a kind (alive ones only, for people and animals). */
  all(id: string): Entity[] {
    return this.game.entities.filter((e) => !e.destroyed && e.def.id === id && (!isLiving(e) || e.alive));
  }

  /** The tutorial's own of a kind, still about. */
  mine(id: string): Entity | null {
    for (const e of this.props) if (!e.destroyed && e.def.id === id && (!isLiving(e) || e.alive)) return e;
    return null;
  }

  /** The fastest any part of `e` moves (m/s). */
  speed(e: Entity): number {
    let v = 0;
    for (const p of e.parts) if (!p.destroyed) v = Math.max(v, Math.hypot(p.vx, p.vy));
    return v;
  }

  /** Where the sandbox's view is centered, on the floor. */
  floorAhead(dx = 0): V2 {
    return { x: this.game.renderer.camX + dx, y: WORLD.floor + 0.2 };
  }

  /** The floor in sight, left to right (m): clear of the toybox and the tool strip where they come down over it. */
  inSight(): { left: number; right: number } {
    const r = this.game.renderer;
    const floor = r.worldToScreen(r.camX, WORLD.floor).y;
    const side = (sel: string, edge: 'left' | 'right', or: number) => {
      const b = q(sel)?.getBoundingClientRect();
      return b && b.width > 0 && b.top < floor && b.bottom > floor - 120 ? b[edge] : or;
    };
    const left = r.screenToWorld(side('.catalog', 'right', 0), floor).x + 0.5;
    const right = r.screenToWorld(side('.toolbar', 'left', innerWidth), floor).x - 0.5;
    return { left: Math.max(WORLD.left + 1, left), right: Math.min(WORLD.right - 1, right) };
  }

  /**
   * A clear Lab again, part way through a tour (before a crash or a nuke, so
   * the rest isn't in the way), with the view back home. Ctrl+Z brings it back.
   */
  clean(): void {
    const c = this.controls;
    if (this.game.entities.some((e) => !e.destroyed)) c.ui.toast('Cleared the floor for this step (Ctrl+Z brings it all back)');
    c.terrain?.stop();
    if (this.game.map.id !== LAB.id) c.switchMap(LAB);
    c.clearScene('Tutorial');
    c.arm(null);
    c.setTool('drag');
    this.props.clear();
    this.refs.clear();
    const r = this.game.renderer;
    r.camX = this.game.home().x;
    r.camY = this.floorView;
  }

  /** The camera's height for the usual view of the floor (lower on a short screen, a phone's on its side: see Renderer.floorLift). */
  private get floorView(): number {
    return WORLD.floor + Math.min(3.2, this.game.renderer.floorLift);
  }

  // ---- running ----------------------------------------------------------------------

  /** Notes what the player makes happen: blasts, shots, bolts, menus opened, undos, powers used... */
  private hookAll(): void {
    const s = this.seen;
    const c = this.controls;
    this.hook(this.game.explosions, 'explode', () => s.blasts++);
    this.hook(this.game.explosions, 'nuke', () => {
      s.blasts++;
      s.nukes++;
    });
    this.hook(this.game.projectiles, 'fire', () => s.shots++);
    this.hook(this.game.projectiles, 'laser', () => s.shots++);
    this.hook(c.powers, 'bolt', () => s.bolts++);
    // (called every physics step: what's in use, or null)
    this.hook(c.powers, 'step', (kind) => {
      if (kind) s.powers.add(kind as PowerId);
    });
    this.hook(c.ui, 'openContextMenu', (...a) => {
      s.menus++;
      // (entries the step isn't about greyed out before it's shown)
      this.lock.greyMenu(a[3] as ContextAction[]);
    });
    this.hook(c.ui, 'editValues', () => s.edits++);
    this.hook(c.ui, 'save', () => s.saves++);
    this.hook(c.ui, 'load', () => s.loads++);
    this.hook(c, 'undo', () => s.undos++);
    this.hook(c, 'redo', () => s.redos++);
    this.hook(c, 'paste', () => s.pastes++);
    this.hook(c, 'duplicate', () => s.pastes++);
    // (V held and let go places the paste where its ghost is, through the placer: see Placer)
    this.hook(c.placer, 'place_', (...a) => {
      if (a[1] === 'Paste') s.pastes++;
    });
    this.hook(c.arrange, 'rotate', (...a) => (s.turned += Math.abs(Number(a[1]) || 0)));
    this.hook(c, 'flip', () => s.flips++);
    this.hook(c, 'step', () => s.steps++);
  }

  /** Has `obj[key](...)` note itself (`note` runs first, with the same arguments), until the tutorial ends. */
  hook(obj: object, key: string, note: (...args: unknown[]) => void): void {
    const o = obj as Record<string, unknown>;
    const fn = o[key];
    if (typeof fn !== 'function') return;
    const own = Object.prototype.hasOwnProperty.call(o, key);
    o[key] = function (this: unknown, ...args: unknown[]) {
      note(...args);
      return (fn as (...a: unknown[]) => unknown).apply(this, args);
    };
    this.unhooks.push(() => {
      if (own) o[key] = fn;
      else delete o[key];
    });
  }

  private render(): void {
    const s = this.step;
    // (counted without the steps left out on a touch screen)
    const shown = this.steps.filter((x) => !(this.touch && x.keyboard));
    const n = shown.length;
    const at = Math.max(0, shown.indexOf(s));
    this.head.textContent = `${at + 1}/${n}`;
    this.title.textContent = s.title;
    this.text.innerHTML = s.text(this);
    this.fill.style.width = `${(at / Math.max(1, n - 1)) * 100}%`;
    this.btns.textContent = '';
    const btn = (label: string, cls: string, fn: () => void) => {
      const b = el('button', 'tut-btn ' + cls, label);
      b.onclick = () => {
        this.game.sound.ui('click');
        fn();
      };
      this.btns.appendChild(b);
      return b;
    };
    for (const alt of s.alts ?? []) btn(alt.label, 'tut-alt', () => alt.action(this));
    if (s.info) btn(s.info, 'tut-next', () => this.skip());
    else btn('Skip step', 'tut-skip', () => this.skip());
  }

  /** Rewords the step on (for a step whose text hangs on something that has just changed). */
  refresh(): void {
    if (!this.active) return;
    this.text.innerHTML = this.step.text(this);
    this.lockStep();
  }

  private frame(dt: number): void {
    if (!this.active) return;
    this.dodge();
    const s = this.step;
    const follow = s.follow?.(this);
    if (follow) {
      const r = this.game.renderer;
      const k = Math.min(1, dt * 5);
      r.camX += (follow.x - r.camX) * k;
      // (up after something thrown high, and back down to the usual view of the floor: see point())
      r.camY += (Math.max(this.floorView, follow.y) - r.camY) * k;
      r.clampCamera();
    }
    if (this.game.paused) this.seen.paused = true;
    if (this.game.timeScale < 1) this.seen.slow = true;
    if (this.cheer > 0) {
      this.cheer -= dt;
      if (this.cheer <= 0) this.go(this.index + 1);
      return;
    }
    if (!s.info && s.done?.(this)) {
      // done: a tick, then the next
      this.cheer = CHEER;
      this.card.classList.add('cheer');
      this.title.textContent = `✓ ${s.title}`;
      this.arrow.classList.add('hidden');
      this.glow(null);
      this.game.sound.ui('confirm');
      return;
    }
    this.point(s.target?.(this) ?? null);
  }

  /** The card along to the right of the vitals while they show where it would cover them (selecting someone opens them). */
  private dodge(): void {
    const v = (q('.vitals') as HTMLElement | null)?.getBoundingClientRect();
    const w = this.card.offsetWidth;
    let x = innerWidth / 2;
    if (v && v.width > 0 && v.height > 0 && v.right > x - w / 2 - 8 && v.top < this.card.offsetTop + this.card.offsetHeight) {
      x = Math.max(x, Math.min(innerWidth - w / 2 - 8, v.right + 10 + w / 2));
    }
    const left = `${Math.round(x)}px`;
    if (this.card.style.left !== left) this.card.style.left = left;
  }

  /** Points at a thing or a place in the sandbox (the arrow), or a button (its glow). */
  private point(t: Entity | V2 | Element | null): void {
    // (what it points at is never greyed out)
    this.lock.setTarget(t instanceof Element ? t : null);
    if (t instanceof Element) {
      this.glow(t);
      this.arrow.classList.add('hidden');
      return;
    }
    this.glow(null);
    if (!t) {
      this.arrow.classList.add('hidden');
      return;
    }
    const at = 'parts' in t ? topOf(t) : t;
    if (!at) {
      this.arrow.classList.add('hidden');
      return;
    }
    let sc = this.game.renderer.worldToScreen(at.x, at.y);
    // off the screen as the step begins (a phone shows a few metres): the view goes to it, once
    if (!this.framed) {
      this.framed = true;
      const m = 60;
      if (sc.x < m || sc.x > innerWidth - m || sc.y < m || sc.y > innerHeight - m) {
        const r = this.game.renderer;
        r.camX = at.x;
        // (down to the usual view of the floor for something on it: left up high after a fling, the floor's out of sight)
        r.camY = Math.max(this.floorView, at.y - 1);
        r.clampCamera();
        sc = r.worldToScreen(at.x, at.y);
      }
    }
    this.arrow.classList.remove('hidden');
    this.arrow.style.transform = `translate(${Math.round(sc.x)}px, ${Math.round(sc.y)}px)`;
  }

  private glow(e: Element | null): void {
    if (e === this.glowing) return;
    this.glowing?.classList.remove('tut-glow');
    this.glowing = e;
    e?.classList.add('tut-glow');
    // (a button folded away under the tool bar's ⋯, on a phone: opened, so it's there to press)
    if (e?.classList.contains('tb-extra')) e.closest('.toolbar')?.classList.add('more-open');
  }
}

/**
 * Where the arrow points on a thing: the top of what's drawn of it above its middle, a few pixels
 * in (so a press at the tip lands on it, not on the air above); null if nothing of it is left.
 */
const topOf = (e: Entity): V2 | null => {
  let x = 0;
  let n = 0;
  for (const p of e.parts) {
    if (p.destroyed) continue;
    x += p.x;
    n++;
  }
  if (!n) return null;
  x /= n;
  let top = -Infinity;
  let near: { x: number; y: number } | null = null;
  for (const p of e.parts) {
    if (p.destroyed) continue;
    const r = (Math.hypot(p.w, p.h) * PX) / 2;
    if (!near || Math.abs(p.x - x) < Math.abs(near.x - x)) near = { x: p.x, y: p.y + r };
    if (Math.abs(p.x - x) > r) continue;
    // down the column from the top of its reach to the first pixel drawn
    for (let y = p.y + r; y > p.y - r && y > top; y -= PX) {
      const { ix, iy } = p.worldToPixel(x, y);
      if (p.solidAt(ix, iy)) {
        top = y;
        break;
      }
    }
  }
  // (nothing drawn there, a thing in pieces: over the piece nearest its middle)
  return top > -Infinity ? { x, y: top - 3 * PX } : near;
};

// ---- the steps ------------------------------------------------------------------------

const q = (sel: string) => document.querySelector(sel);
/** A button of the tool bar, by its tooltip's start. */
const toolbarBtn = (title: string) =>
  // (a greyed-out one's own tooltip is kept aside: see TutorialLock)
  [...document.querySelectorAll<HTMLElement>('.toolbar .tb-btn')].find((b) => (b.dataset.tutTitle ?? b.title).startsWith(title)) ?? null;
/** The touch bar's button so labelled (on a touch screen, while something is selected). */
const touchBtn = (label: string) => [...document.querySelectorAll<HTMLElement>('.touchbar:not(.hidden) .touch-btn, .drivepad:not(.hidden) .touch-btn:not(.hidden)')].find((b) => b.textContent === label) ?? null;
/** A person standing (or at least alive) for a step that needs one. */
const someone = (t: Tutorial, mineOnly = false): Entity | null => {
  const list = t.all('human').filter((e) => !mineOnly || t.props.has(e));
  return list.find((e) => !t.props.has(e)) ?? list[0] ?? null;
};
const holdsGun = (e: Entity) => e instanceof Human && e.heldItems().some((i) => !i.destroyed && i instanceof Firearm);
/** Someone with a rifle already in hand, put out left of the view on clear floor (for a step that needs a gunner). */
const armedGunner = (t: Tutorial) => {
  const x = openGround(t, [-5, -6.5, -3.5, -8, -2], 2.4);
  const h = t.put('human', x);
  const gun = t.put('rifle', x + 1.6);
  const hand = h instanceof Human ? h.limbs.get('handF')?.part : undefined;
  const grip = gun instanceof Firearm ? gun.gripWorld() : null;
  if (h instanceof Human && gun instanceof Firearm && hand && grip) {
    gun.translate(hand.x - grip.x, hand.y - grip.y);
    h.tryHold(gun, { x: hand.x, y: hand.y });
  }
};
/** The one thrown on the 'fling' step, once they've gone fast enough to count (noted in its memo). */
const flung = (t: Tutorial): Entity | null => {
  if (!t.memo.at) {
    const e = t.all('human').find((h) => t.speed(h) > 9);
    if (!e) return null;
    t.memo.id = e.id;
    t.memo.at = t.game.time;
  }
  return t.game.entities.find((e) => e.id === t.memo.id && !e.destroyed) ?? null;
};
const car = (t: Tutorial): Car | null => {
  const c = t.ref('car');
  return c instanceof Car ? c : null;
};
/** The car's bonnet (pointing at the cabin finds whoever sits in it). */
const bonnet = (c: Car): V2 => {
  const [x, y] = c.cfg.headlight ?? [110, 24];
  return c.body.pixelToWorld(x - 14, y - 4);
};
/** Puts out the car (and sits someone in it, if `driver`), unless it's there already. */
/** How far (m) the car is driven at Turbo into the wall: far enough to hit it at 20 m/s and more, and go up. */
const ROAD = 40;
const carOut = (t: Tutorial, driver: boolean): Car | null => {
  let c = car(t);
  if (!c) {
    // (with a long road ahead of it for the next step: see 'crash')
    // (left of the patient, clear of them and of what may still be burning on the right)
    // (on clear floor: put down on a body or a crate, it can roll over; and out of reach of a barrel)
    const p = t.ref('patient');
    const dx = (p && isLiving(p) && p.alive ? p.center().x : t.game.renderer.camX - 1.5) - 4 - t.game.renderer.camX;
    // (in sight: not under the toybox, where it can't be got at; right of them if there's no room left)
    const lo = t.inSight().left + 2.6 - t.game.renderer.camX;
    const dxs = [dx, dx - 2.5, dx - 5, dx - 7.5, dx + 8, dx + 10.5].filter((d) => d >= lo);
    const x = dxs.length ? openGround(t, dxs, 2.2, 8) : t.game.renderer.camX + lo;
    t.keep('car', t.put('car', Math.max(WORLD.left + 3, Math.min(x, WORLD.right - ROAD - 6))));
    c = car(t);
  }
  if (c && driver && !c.occupant(0)) {
    const h = t.ref('patient') ?? t.put('human', c.body.x - 3);
    const [sx, sy] = c.cfg.seats[0].at;
    if (h instanceof Human) c.takeIn(h, c.body.pixelToWorld(sx, sy));
  }
  return c;
};
/** Laid out from the car: a long road to a wall, a couple of barrels in front of it for luck (see 'crash'). */
const crashCourse = (t: Tutorial, c: Car) => {
  const x = c.body.x;
  const wall = Math.min(x + ROAD, WORLD.right - 3);
  // a clear road, under it too: what's left of the earlier steps (crates, guns, debris, bodies lying
  // about) would slow it down short of going up
  for (const e of [...t.game.entities]) {
    const at = e.destroyed || e === c || (e instanceof Human && e.seat) ? null : e.center();
    if (at && at.x > x - 2.5 && at.x < wall + 1.5) {
      t.game.remove(e);
      t.props.delete(e);
    }
  }
  t.put('explosive-barrel', wall - 1.7);
  t.put('explosive-barrel', wall - 1.1);
  for (const e of t.stack('crate', wall, 3)) e.setFrozen(true);
};
/** Where the view goes along with a vehicle on the move (null: it's still). */
const chase = (t: Tutorial, c: Car | null): V2 | null =>
  c && !c.body.destroyed && (c.driving || t.speed(c) > 1) ? { x: c.body.x + (c.body.vx < -0.5 ? -3 : 3), y: c.body.y } : null;

/** The Basics: spawn, throw, menus, guns, fire and explosions, powers, time and undo. */
export const BASICS: TutorialStep[] = [
  {
    id: 'hello',
    title: 'Welcome to the Playground',
    text: () =>
      'A quick tour, two minutes at most: spawn someone, throw them around, arm them, blow things up and bend time. ' +
      'Each step ends the moment you’ve done it. Skip any you know, or leave with ×.',
    info: 'Let’s go',
  },
  {
    id: 'spawn',
    title: 'Spawn someone',
    text: (t) =>
      `${openShelf(t, 'Characters', 'Human')}, then ${t.touch ? 'tap the floor' : t.spawnHow()}.`,
    setup: (t) => t.props.clear(),
    done: (t) => {
      const yes = t.game.entities.some((e) => e.def.id === 'human' && !e.destroyed && !t.props.has(e));
      // (spawning more on every tap or key would get in the way of the next steps)
      if (yes) t.controls.arm(null);
      return yes;
    },
    target: (t) => {
      if (t.controls.armed?.id === 'human') return t.floorAhead();
      const tile = [...document.querySelectorAll('.catalog:not(.collapsed) .item')].find((e) => e.querySelector('.item-name')?.textContent === 'Human');
      return tile ?? q('.cat-btn[data-cat="Characters"]');
    },
  },
  {
    id: 'fling',
    title: 'Throw them',
    text: (t) => (t.touch ? 'Drag them with your finger and <b>fling</b> them across the room!' : 'Grab them with the left mouse button and <b>fling</b> them across the room!'),
    setup: (t) => {
      if (!someone(t)) t.put('human', t.floorAhead().x);
    },
    // flung: watched down, the view going with them, before the next step, which is about
    // them (a body still flying is soon out of sight, and moving the view isn't taught)
    done: (t) => {
      const e = flung(t);
      if (!t.memo.at) return false;
      if (!e || t.game.time - t.memo.at > 5) return true;
      if (t.controls.grab?.part.entity === e || t.speed(e) > 1.5) {
        t.memo.calm = 0;
        return false;
      }
      if (!t.memo.calm) t.memo.calm = t.game.time;
      return t.game.time - t.memo.calm > 0.3;
    },
    follow: (t) => {
      const e = t.memo.at ? flung(t) : null;
      return e && t.controls.grab?.part.entity !== e ? e.center() : null;
    },
    target: (t) => (t.memo.at ? null : someone(t)),
  },
  {
    id: 'menu',
    title: 'Everything has a menu',
    text: (t) =>
      `${t.touch ? '<b>Long-press</b>' : '<b>Right-click</b>'} them: ignite, freeze, make them fight, check their vitals… Pick anything!`,
    setup: (t) => {
      if (!someone(t)) t.put('human', t.floorAhead().x);
      t.seen.menus = 0;
    },
    done: (t) => t.seen.menus > 0,
    target: (t) => (q('.ctx') ? null : someone(t)),
    // ("pick anything!")
    allow: { menu: ['*'] },
  },
  {
    id: 'arm',
    title: 'Hand them a gun',
    text: () => 'Drag the <b>rifle</b> onto the new person’s hand: they’ll hold it.',
    setup: (t) => {
      // (on clear floor: the one thrown may have come down just there)
      const x = openGround(t, [-5, -6.5, -3.5, -8, -2], 2.4);
      t.put('human', x);
      t.put('rifle', x + 1.6);
      // something to shoot at
      t.stack('crate', Math.min(WORLD.right - 3, x + 8), 3);
      t.put('explosive-barrel', Math.min(WORLD.right - 2, x + 9.3));
    },
    done: (t) => t.all('human').some(holdsGun),
    target: (t) => t.mine('rifle'),
  },
  {
    id: 'shoot',
    title: 'Open fire',
    text: (t) =>
      t.touch
        ? 'Tap the gunner to select them, then hold <b>Use</b>. (Hit the red barrel!)'
        : `Click the gunner to select them, then hold ${t.key('activate', '<kbd>F</kbd>')}. (Hit the red barrel!)`,
    setup: (t) => {
      t.seen.shots = 0;
      // (skipped the last step: here's one already armed)
      if (!t.all('human').some(holdsGun)) armedGunner(t);
    },
    // (or the barrel shot, sooner: what's left to aim at is burning crates)
    done: (t) => t.seen.shots >= 3 || (t.seen.shots > 0 && !t.all('explosive-barrel').length),
    target: (t) => {
      // the gunner knocked out or killed (the barrel goes off 7 m round), so the gun's dropped:
      // a fresh one, a moment later, or there'd be nobody left to fire
      if (t.all('human').some(holdsGun)) t.memo.unarmed = 0;
      else if (!t.memo.unarmed) t.memo.unarmed = t.game.time;
      else if (t.game.time - t.memo.unarmed > 1.5) {
        armedGunner(t);
        t.memo.unarmed = 0;
      }
      const gunner = t.all('human').find(holdsGun) ?? null;
      if (gunner && t.controls.selection.has(gunner)) return t.touch ? touchBtn('Use') : null;
      return gunner;
    },
  },
  {
    id: 'molotov',
    title: 'Light it up',
    text: (t) =>
      t.touch
        ? 'Tap the <b>Molotov</b>, tap <b>Use</b> to light its rag, then fling it at the pile!'
        : `Point at the <b>Molotov</b> and press ${t.key('activate', '<kbd>F</kbd>')} to light its rag, then throw it at the pile!`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      // (not on someone lying there: pointed at, it would be them that F went to)
      t.put('molotov', openGround(t, [-2, -3, -1, -4, 0, -5], 0.8));
      if (t.all('crate').length < 3) t.stack('crate', x + 4, 3);
      t.put('human', x + 5.3);
    },
    // (smashed: gone, its oil burning where it landed)
    done: (t) => ![...t.props].some((e) => e.def.id === 'molotov' && !e.destroyed),
    target: (t) => t.mine('molotov'),
  },
  {
    id: 'rpg',
    title: 'Bring out the big gun',
    text: (t) =>
      t.touch
        ? 'Tap the <b>RPG</b> on the floor, then tap <b>Use</b>.'
        : `Point at the <b>RPG</b> on the floor and press ${t.key('activate', '<kbd>F</kbd>')}.`,
    setup: (t) => {
      t.seen.blasts = 0;
      // (on bare floor: under someone lying there, F would go to them, not to it)
      const x = openGround(t, [-4, -5.5, -2.5, -7, -1, 1.5, -8.5, 3], 1.4);
      t.put('rpg', x);
      t.stack('crate', Math.min(WORLD.right - 3, x + 9), 3);
      t.put('explosive-barrel', Math.min(WORLD.right - 2, x + 10.3));
    },
    done: (t) => t.seen.blasts > 0,
    target: (t) => t.mine('rpg'),
  },
  {
    id: 'heal',
    title: 'Patch them up',
    text: (t) =>
      t.memo.took
        ? `They took the syringe from you: ${useOn(t, 'it, in their hand,')} and they inject themselves.`
        : `Someone got hurt (a broken arm, a nasty cut). Drag the green <b>healing syringe</b> into them, needle first, and watch them mend. ` +
          `(${t.touch ? 'Holding it, <b>Use</b>' : `Holding it, ${t.key('activate', '<kbd>F</kbd>')}`} injects whoever it touches; if it just bumps them, grab it and push again. ` +
          'More in the toybox’s Medical: bandages, a defibrillator…)',
    setup: (t) => {
      // (clear of the bodies, and of what's still burning from the Molotov and the RPG; hurt, but with time to save them)
      // (a barrel goes off 7 m round, and flings what's near it further)
      const x = openGround(t, [-1.5, 0.5, 2.5, 4.5, -3.5, 7, -6, 9.5, -8.5], 1.8, 11) + 1.5;
      const h = t.keep('patient', t.put('human', x - 1.5, { angle: Math.PI / 2 }));
      if (h instanceof Human) {
        const fore = h.limbs.get('lowerArmF');
        if (fore) fore.broken = true;
        const belly = h.limbs.get('midTorso')?.part;
        if (belly) h.damage(belly, 15, 'stab', { x: belly.x, y: belly.y + 0.08 }, { x: 0, y: -1 });
        h.blood = 70;
      }
      // (the needle towards them)
      t.keep('syringe', t.put('syringe-healing', x + 0.5, { flip: true }));
    },
    // (in: it empties as the dose goes in)
    done: (t) => {
      const s = t.was('syringe') as (Entity & { fill?: number }) | undefined;
      return !!s && (s.destroyed || (s.fill ?? 1) < 0.5);
    },
    target: (t) => {
      const s = refAs(t, 'syringe', Item);
      // let go by their hand, they took it: Use has them inject themselves
      if (s?.holder && !t.memo.took) {
        t.memo.took = 1;
        t.refresh();
      }
      return s?.holder ? useAt(t, s) : s;
    },
  },
  {
    id: 'car',
    title: 'Road trip',
    text: () =>
      'Now take them for a drive: grab them, <b>lift them up</b> over the <b>car</b> and let go, and in they get. ' +
      '(Pushed against it, the car just rolls away. It seats two; the SUV seats four.)',
    setup: (t) => {
      // (the spent syringe, stuck in them, would be what's grabbed)
      const used = t.ref('syringe');
      if (used) t.game.remove(used);
      carOut(t, false);
      if (!t.ref('patient')) t.keep('patient', t.put('human', t.game.renderer.camX - 1.5));
    },
    done: (t) => !!car(t)?.occupant(0),
    target: (t) => {
      const c = car(t);
      return t.controls.grab && c ? overSeat(c) : t.ref('patient') ?? someone(t);
    },
    skipped: (t) => {
      carOut(t, true);
    },
  },
  {
    id: 'crash',
    title: 'Floor it',
    text: (t) =>
      `It’s set to <b>Turbo</b> (its ${t.touch ? 'long-press' : 'right-click'} menu has the speeds and seat belts). ` +
      (t.touch ? 'Tap the front of the car, then <b>Use</b>' : `Point at the front of the car and press ${t.key('activate', '<kbd>F</kbd>')}`) +
      ' to drive, and don’t stop for the wall: hit anything that fast and a car blows up.',
    setup: (t) => {
      t.seen.blasts = 0;
      const c = carOut(t, true);
      if (!c) return;
      c.gear = 'turbo';
      crashCourse(t, c);
    },
    // the view goes along with it
    follow: (t) => chase(t, car(t)),
    done: (t) => t.seen.blasts > 0 || !!car(t)?.wrecked,
    target: (t) => {
      const c = car(t);
      return c && !c.driving ? bonnet(c) : null;
    },
  },
  {
    id: 'lightning',
    title: 'Call down lightning',
    text: (t) =>
      t.touch
        ? 'Tap <b>Tools ⇄</b> on the right to switch to the powers, tap <b>Lightning</b>, then drag and <b>flick</b> your finger.'
        : `Press ${t.key('toolPower', '<b>Tools ⇄</b>')} to switch to the powers, pick <b>Lightning</b>, then hold the mouse button and <b>flick</b> it.`,
    setup: (t) => {
      t.seen.bolts = 0;
      // (someone in sight to aim at: the crash may have left nobody, or nobody here)
      const v = t.inSight();
      if (!people(t).some((h) => h.alive && h.center().x > v.left && h.center().x < v.right)) t.put('human', t.game.renderer.camX + 2);
    },
    done: (t) => {
      if (t.seen.bolts === 0) return false;
      // back to dragging things about
      t.controls.setTool('drag');
      return true;
    },
    target: (t) => {
      const c = t.controls;
      if (c.tab !== 'powers') return q('.tool-tab');
      if (c.power !== 'lightning') return [...document.querySelectorAll<HTMLElement>('.tool-btn')].find((b) => b.dataset.name === 'Lightning') ?? null;
      return null;
    },
  },
  {
    id: 'time',
    title: 'Bend time',
    text: (t) =>
      t.touch
        ? 'Tap the <b>clock</b> in the tool bar for slow motion, <b>⏸</b> to stop time, then <b>▶</b> to let it run again.'
        : `${t.key('slowmo', '<b>The clock</b>')} is slow motion, ${t.key('time', '<b>⏸</b>')} stops time (move things while it’s stopped!). Try both, then let time run again.`,
    setup: (t) => {
      t.seen.paused = false;
      t.seen.slow = false;
    },
    done: (t) => t.seen.paused && t.seen.slow && !t.game.paused,
    target: (t) => (!t.seen.slow ? toolbarBtn('Slow motion') : !t.seen.paused || t.game.paused ? toolbarBtn('Toggle time') : null),
  },
  {
    id: 'undo',
    title: 'Undo anything',
    text: (t) =>
      t.touch
        ? 'Made a mess? Tap <b>↶</b> in the tool bar to undo it (↷ redoes).'
        : 'Made a mess? <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes your last change, <kbd>Ctrl</kbd>+<kbd>Y</kbd> redoes it.',
    setup: (t) => {
      t.seen.undos = 0;
    },
    done: (t) => t.seen.undos > 0,
    target: (t) => (t.touch ? toolbarBtn('Undo') : null),
  },
  {
    id: 'end',
    title: 'You’re ready!',
    text: (t) =>
      `More to find: other <b>Maps</b> (the map button up top), <b>Multiplayer</b> with friends, the <b>Shape</b> tool${keyNote(t, `tool${toolSlot('shape') + 1}` as ActionId)} to draw your own things, ` +
      `ropes, hinges and wires to build machines${t.touch ? '' : `, and ${t.key('xray', '<b>x-ray</b>')} to see bones`}. ` +
      `${t.touch ? 'The <b>?</b> button' : t.key('help', '<b>?</b>')} lists every control.`,
    info: 'Play!',
    alts: [
      {
        label: 'Clear the mess',
        action: (t) => {
          t.controls.clearScene('Clear all');
          t.stop();
        },
      },
      {
        label: 'More tutorials…',
        action: (t) => {
          t.stop();
          t.hooks.tutorials?.();
        },
      },
    ],
  },
];

// ---- building ---------------------------------------------------------------------

/**
 * The tool bar's button for a tool (or power), by its name ('Rope', 'Fixed
 * Connector'...): one on show; else, for a slot's other kind (the Rope's Fuse,
 * under it once it's picked; the Pin's hinge), the slot's button.
 */
const toolButton = (name: string) => {
  const all = [...document.querySelectorAll<HTMLElement>('.tool-btn')];
  const shown = (b: HTMLElement) => !b.closest('.hidden');
  return all.find((b) => b.dataset.name === name && shown(b))
    ?? all.find((b) => (b.dataset.names ?? '').split('|').includes(name))
    ?? (name === 'Hinge' ? all.find((b) => b.dataset.tool === 'pin') : undefined)
    ?? all.find((b) => b.dataset.name === name) ?? null;
};
/** "Rope (2)": a tool by name, with its key if it has one. */
const pick = (t: Tutorial, tool: ToolId, name: string) => {
  const slot = toolSlot(tool);
  const key = slot >= 0 && slot < 9 && !t.touch ? t.key(`tool${slot + 1}` as ActionId) : '';
  return `<b>${name}</b>${key ? ` (${key})` : ''}`;
};
/** Points at the tool to pick, then, once it's in hand, at `then` (the Pin and the hinge are one tool). */
const withTool = (t: Tutorial, tool: ToolId, name: string, then: Entity | V2 | null) => {
  const c = t.controls;
  const pin = (x: ToolId) => x === 'pin' || x === 'hinge';
  return c.tab === 'tools' && (c.tool === tool || (pin(tool) && pin(c.tool))) ? then : toolButton(name);
};
/** The knot of the rope tied to `e` (to cut), else `e`. */
const ropeKnot = (t: Tutorial, e: Entity | null): Entity | V2 | null => {
  const C = t.game.connections;
  const k = e ? C.connectionsOf(e).find((c) => c.kind === 'rope') : undefined;
  return k ? C.endPoint(k, k.a.entity === e ? 'a' : 'b') : e;
};
/** Drag, for a mouse or a finger. */
const drag = (t: Tutorial) => (t.touch ? 'drag your finger' : 'drag');
const clickTap = (t: Tutorial) => (t.touch ? 'tap' : 'click');
/** The rocket's pieces (see the steps from "rocket" on). */
const rocket = (t: Tutorial) => ({ beam: t.ref('beam'), left: t.ref('thrusterL'), right: t.ref('thrusterR'), lever: t.ref('lever') });
const rocketParts = (t: Tutorial): Entity[] => {
  const r = rocket(t);
  return [r.beam, r.left, r.right, r.lever].filter((e): e is Entity => !!e);
};
/** Where the view goes along with the rocket in flight (null: it's still). */
const rocketView = (t: Tutorial): V2 | null => {
  const b = rocket(t).beam;
  return b && !b.destroyed && t.speed(b) > 0.6 ? b.center() : null;
};
const ropes = (t: Tutorial) => t.game.connections.list.filter((c) => c.kind === 'rope').length;
/** Joins a to b with a connection from centre to centre, unless they are already (for skipped rocket steps). */
const join = (t: Tutorial, kind: ConnKind, a: Entity | null, b: Entity | null) => {
  if (!a || !b || t.joined(kind, a, b)) return;
  const pa = a.parts[0];
  const pb = b.parts[0];
  t.game.connections.create(kind, pa, { x: pa.x, y: pa.y }, pb, { x: pb.x, y: pb.y });
};

/** Building: every connection tool, power and pulses, fuses, shapes; then a rocket, saved to the toybox and flown. */
export const BUILDING: TutorialStep[] = [
  {
    id: 'b-hello',
    title: 'Let’s build machines',
    text: (t) =>
      'The tools on the right join things together and wire them up. You’ll try each one, then put them together into a <b>rocket</b> that flies. ' +
      `Tip: stop time (${t.touch ? '<b>⏸</b>' : t.key('time', '<b>⏸</b>')}) whenever you want to line things up.`,
    info: 'Start',
  },
  {
    id: 'b-rope',
    title: 'Rope',
    text: (t) =>
      `Pick ${pick(t, 'rope', 'Rope')} on the right, then ${drag(t)} from a crate up to the beam (or ${clickTap(t)} the crate, then the beam): the crate hangs from it. ` +
      `(The beam is <b>frozen</b> in the air: ${t.touch ? 'long-press anything' : t.key('freeze') ? `point at anything and press ${t.key('freeze')}, or right-click it` : 'right-click anything'} and choose Freeze.)`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.keep('anchor', t.put('beam', x, { dy: 3.4, frozen: true }));
      t.keep('crateA', t.put('crate', x - 0.9));
      t.keep('crateB', t.put('crate', x + 0.9));
    },
    done: (t) => t.made('rope').length > 0,
    target: (t) => withTool(t, 'rope', 'Rope', t.ref('crateA')),
  },
  {
    id: 'b-spring',
    title: 'Spring',
    text: (t) =>
      `${pick(t, 'spring', 'Spring')}: ${drag(t)} from the other crate up to the beam. Boing! ` +
      (t.touch ? '' : `Press ${t.key('tool4', 'its key')} again while the Spring tool is in hand for a stiffer one.`),
    done: (t) => t.made('spring').length > 0,
    target: (t) => withTool(t, 'spring', 'Spring', t.ref('crateB')),
  },
  {
    id: 'b-remove',
    title: 'Cut it loose',
    text: (t) =>
      `${pick(t, 'remove', 'Remove Connections')}: ${clickTap(t)} the rope the crate hangs from (its line, or its knot on the crate) to cut it… and down it comes. ` +
      (t.touch
        ? '(Drag a box from empty space to cut whatever it crosses.)'
        : '(Shift+click a thing to cut all of its connections; drag a box from empty space to cut whatever it crosses.)'),
    setup: (t) => {
      // (a rope to cut, if the rope step was skipped)
      const crate = t.ref('crateA');
      const anchor = t.ref('anchor');
      if (!ropes(t) && crate && anchor) {
        const p = crate.parts[0];
        t.game.connections.create('rope', p, { x: p.x, y: p.y + 0.3 }, anchor.parts[0], { x: p.x, y: anchor.parts[0].y });
      }
      t.n = ropes(t);
    },
    done: (t) => ropes(t) < t.n,
    target: (t) => withTool(t, 'remove', 'Remove Connections', ropeKnot(t, t.ref('crateA'))),
  },
  {
    id: 'b-weld',
    title: 'Fixed connector',
    text: (t) =>
      `${pick(t, 'weld', 'Fixed Connector')}: ${drag(t)} from one plank to the other. Now they’re one piece: lift one and the other comes too. ` +
      `(Things already touching: select them, ${menu(t)} one, <b>Weld together</b>.)`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.keep('plankA', t.put('plank', x - 4.4));
      t.keep('plankB', t.put('plank', x - 2.2));
    },
    done: (t) => {
      const a = t.ref('plankA');
      const b = t.ref('plankB');
      return !!a && !!b && t.joined('weld', a, b);
    },
    target: (t) => withTool(t, 'weld', 'Fixed Connector', t.ref('plankA')),
  },
  {
    id: 'b-hinge',
    title: 'A pin for a hinge',
    text: (t) =>
      `${pick(t, 'pin', 'Pin')}: ${drag(t)} from the top of the standing plank to the frozen post beside it (dragged from one thing to another, a pin is a hinge). It swings on the hinge like a door. ` +
      `(${Menu(t)} the plank to limit how far it swings.)`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.keep('post', t.put('short-beam', x + 3, { angle: Math.PI / 2, frozen: true, dy: 0.4 }));
      t.keep('door', t.put('plank', x + 3.5, { angle: Math.PI / 2 }));
    },
    done: (t) => t.made('hinge').length > 0,
    target: (t) => withTool(t, 'hinge', 'Hinge', t.ref('door')),
  },
  {
    id: 'b-pin',
    title: 'Pin',
    text: (t) =>
      `${pick(t, 'pin', 'Pin')}: ${clickTap(t)} near one end of a plank to pin it to the wall behind. Then grab its other end and swing it round.`,
    done: (t) => t.made('pin').length > 0,
    target: (t) => withTool(t, 'pin', 'Pin', t.ref('plankA') ?? t.ref('door')),
  },
  {
    id: 'b-wire',
    title: 'Wire and power',
    text: (t) =>
      `${pick(t, 'wire', 'Wire')}: ${drag(t)} from the <b>battery</b> to the <b>light bulb</b>. Light! ` +
      `(${t.touch ? '<b>Use</b>' : t.key('activate', '<kbd>F</kbd>')} on the battery switches it off and on.)`,
    setup: (t) => {
      // (a clean floor for the wiring: Ctrl+Z brings back the ropes and planks)
      t.controls.clearScene('Tutorial');
      t.props.clear();
      t.refs.clear();
      const x = t.game.home().x;
      t.game.renderer.camX = x;
      // (spread out along the floor: the button, the C4 and the dynamite come next)
      t.keep('battery', t.put('battery', x - 6));
      t.keep('bulb', t.put('light', x - 4.8));
    },
    done: (t) => !!t.ref('bulb')?.powered,
    target: (t) => withTool(t, 'wire', 'Wire', t.ref('battery')),
  },
  {
    id: 'b-button',
    title: 'Pulses',
    text: (t) =>
      'A <b>button</b> sends a pulse down its wires: it switches on, fires or sets off whatever is at the other end. ' +
      `With the ${pick(t, 'wire', 'Wire')}, ${drag(t)} from the button to the <b>C4</b> on the crates, then point at the button and press ${t.touch ? '<b>Use</b>' : t.key('activate', '<kbd>F</kbd>')}.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.seen.blasts = 0;
      t.keep('button', t.put('button', x - 3));
      const pile = t.stack('crate', x + 5, 2);
      t.keep('c4', t.put('c4', x + 5, { dy: pile.length * 0.9 }));
    },
    done: (t) => t.seen.blasts > 0,
    target: (t) => {
      const b = t.ref('button');
      const c4 = t.ref('c4');
      if (b && c4 && t.joined('wire', b, c4)) return b;
      return withTool(t, 'wire', 'Wire', b);
    },
    allow: { tools: ['wire'], actions: [`tool${toolSlot('wire') + 1}`] },
  },
  {
    id: 'b-fuse',
    title: 'Fuse cord',
    text: (t) =>
      `<b>Fuse</b> (${t.touch ? 'pick the Rope, then Fuse under it' : `${t.key('tool2', 'the Rope’s key')} twice: the Rope’s other kind, or pick it under the Rope`}): ${drag(t)} a cord from one stick of dynamite to the next, and on to the third${t.touch ? ' (with <b>Chain</b> on, below, each cord starts where the last one ended)' : ' (hold Shift as you let go, and the next cord starts there)'}. ` +
      `Then ${clickTap(t)} a cord to light it: the fire runs along the cords and the sticks go off one after another.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.seen.blasts = 0;
      t.keep('dyn1', t.put('dynamite', x - 1));
      t.put('dynamite', x + 0.5);
      t.put('dynamite', x + 2);
    },
    done: (t) => t.seen.blasts > 0,
    target: (t) => withTool(t, 'fuse', 'Fuse', t.ref('dyn1')),
  },
  {
    id: 'b-shape',
    title: 'Draw your own',
    text: (t) =>
      `${pick(t, 'shape', 'Shape')}: ${drag(t)} out a box to make a solid block of your own. Wood, metal, glass, rubber… are on the bar that appears.`,
    setup: (t) => {
      t.n = t.all('shape').length;
      // (a clear view to draw in: the dynamite's smoke would hang about a few seconds yet)
      t.game.particles.clear();
    },
    done: (t) => t.all('shape').length > t.n,
    target: (t) => withTool(t, 'shape', 'Shape', null),
  },
  {
    id: 'rocket',
    title: 'Now: a rocket',
    text: () =>
      'All together now. Here are two <b>thrusters</b> (pointing up), a <b>beam</b> resting on them and a <b>switch</b>. ' +
      'You’ll join them up, wire them, give it a pilot and fly it.',
    setup: (t) => {
      // a clean floor to build on (Ctrl+Z brings back what was here)
      t.controls.clearScene('Tutorial');
      t.props.clear();
      t.refs.clear();
      t.controls.setTool('drag');
      const x = t.game.renderer.camX;
      t.keep('thrusterL', t.put('thruster', x - 0.6, { angle: Math.PI / 2 }));
      t.keep('thrusterR', t.put('thruster', x + 0.6, { angle: Math.PI / 2 }));
      t.keep('beam', t.put('short-beam', x, { dy: 0.5 }));
      t.keep('lever', t.put('switch', x + 2.4));
    },
    info: 'Let’s go',
  },
  {
    id: 'r-weld',
    title: 'Weld on the thrusters',
    text: (t) => `${pick(t, 'weld', 'Fixed Connector')}: ${drag(t)} from each thruster up to the beam. Both of them!`,
    done: (t) => {
      const r = rocket(t);
      return !!r.beam && !!r.left && !!r.right && t.joined('weld', r.left, r.beam) && t.joined('weld', r.right, r.beam);
    },
    target: (t) => {
      const r = rocket(t);
      const next = r.beam && r.left && !t.joined('weld', r.left, r.beam) ? r.left : r.right;
      return withTool(t, 'weld', 'Fixed Connector', next);
    },
    skipped: (t) => {
      const r = rocket(t);
      join(t, 'weld', r.left, r.beam);
      join(t, 'weld', r.right, r.beam);
    },
  },
  {
    id: 'r-wire',
    title: 'Wire up the switch',
    text: (t) =>
      `Put the <b>switch</b> on the beam and weld it there (${pick(t, 'weld', 'Fixed Connector')}), then ${pick(t, 'wire', 'Wire')} it to each thruster. ` +
      'A switch powers what it’s wired to by itself: no battery needed.',
    done: (t) => {
      const r = rocket(t);
      if (!r.beam || !r.left || !r.right || !r.lever) return false;
      const fixed = [r.beam, r.left, r.right].some((e) => t.joined('weld', r.lever!, e));
      return fixed && t.joined('wire', r.lever, r.left) && t.joined('wire', r.lever, r.right);
    },
    target: (t) => {
      const r = rocket(t);
      if (!r.lever || !r.beam) return null;
      if (t.joined('weld', r.lever, r.beam)) return withTool(t, 'wire', 'Wire', r.lever);
      return t.controls.tool === 'weld' ? r.lever : toolButton('Fixed Connector');
    },
    skipped: (t) => {
      const r = rocket(t);
      if (!r.lever || !r.beam) return;
      if (![r.beam, r.left, r.right].some((e) => e && t.joined('weld', r.lever!, e))) {
        // stood on top of the beam first
        const b = r.beam.center();
        const l = r.lever.center();
        r.lever.translate(b.x + 0.3 - l.x, b.y + 0.35 - l.y);
        r.lever.setVelocity(0, 0);
        join(t, 'weld', r.lever, r.beam);
      }
      join(t, 'wire', r.lever, r.left);
      join(t, 'wire', r.lever, r.right);
    },
  },
  {
    id: 'r-pilot',
    title: 'Every rocket needs a pilot',
    text: (t) => `Here’s a volunteer. ${pick(t, 'rope', 'Rope')}: ${drag(t)} from them to the beam to tie them on.`,
    setup: (t) => {
      t.keep('pilot', t.put('human', t.game.renderer.camX - 2.4));
    },
    done: (t) => {
      const pilot = t.ref('pilot');
      return !!pilot && rocketParts(t).some((e) => t.joined('rope', pilot, e));
    },
    target: (t) => withTool(t, 'rope', 'Rope', t.ref('pilot')),
    skipped: (t) => join(t, 'rope', t.ref('pilot'), rocket(t).beam),
  },
  {
    id: 'r-save',
    title: 'Save it',
    text: (t) =>
      `Keep a copy before it flies off: back to the ${pick(t, 'drag', 'Drag')} tool, ${drag(t)} a box round the whole rocket and its pilot from empty space, ` +
      `${t.touch ? 'long-press' : 'right-click'} it and choose <b>Save as contraption…</b> It goes in the toybox to spawn again any time.`,
    setup: (t) => {
      t.n = t.hooks.contraptions?.() ?? 0;
    },
    done: (t) => (t.hooks.contraptions?.() ?? 0) > t.n,
    target: (t) => (t.controls.tool !== 'drag' ? toolButton('Drag') : t.controls.selection.size ? null : rocket(t).beam),
  },
  {
    id: 'r-launch',
    title: 'Liftoff!',
    text: (t) => `Point at the <b>switch</b> and press ${t.touch ? '<b>Use</b>' : t.key('activate', '<kbd>F</kbd>')}. 3… 2… 1…`,
    setup: (t) => {
      t.controls.clearSelection();
      t.n = rocket(t).beam?.parts[0].y ?? 0;
    },
    done: (t) => {
      const b = rocket(t).beam;
      return !!b && b.parts[0].y > t.n + 3;
    },
    target: (t) => rocket(t).lever,
    follow: (t) => rocketView(t),
  },
  {
    id: 'b-end',
    title: 'You built a rocket!',
    text: (t) =>
      'It’s in the toybox under <b>Contraptions</b>. ' +
      `Built with time stopped? ${t.touch ? 'The <b>⟲</b> button' : `Shift+${t.key('time', '<kbd>Space</kbd>')}`} (<b>Back to build</b>) puts it all back as it was before time started. ` +
      'Ideas for next: a <b>car</b> (two Motor Wheels welded under a plank, wired to a switch), ' +
      'a <b>catapult</b> (a hinged plank and a spring), a <b>trap</b> (a Motion Sensor wired to C4). ' +
      `Right-click a motor to set its speed, a gun to change its numbers. ${t.touch ? 'The <b>?</b> button' : t.key('help', '<b>?</b>')} lists every control. ` +
      `(The switch on the rocket cuts its engines: ${useOn(t, 'it')}.)`,
    info: 'Play!',
    // (the view along with it, up to the ceiling and back down)
    follow: (t) => rocketView(t),
    alts: [
      {
        label: 'Clear the mess',
        action: (t) => {
          t.controls.clearScene('Clear all');
          t.stop();
        },
      },
      {
        label: 'More tutorials…',
        action: (t) => {
          t.stop();
          t.hooks.tutorials?.();
        },
      },
    ],
  },
];

// ---- helpers for the other tours ---------------------------------------------------------

/** Puts `item` in `h`'s front hand, as dropping it there does. Whether they hold it. */
export function handTo(h: Entity | null, item: Entity | null): boolean {
  if (!(h instanceof Human) || !(item instanceof Item) || h.destroyed || item.destroyed) return false;
  if (item.holder === h) return true;
  const hand = h.limbs.get('handF')?.part;
  const grip = item.gripWorld();
  if (!hand || !grip) return false;
  item.translate(hand.x - grip.x, hand.y - grip.y);
  return h.tryHold(item, { x: hand.x, y: hand.y });
}

/** Use: F, or the touch bar's button. */
const useKey = (t: Tutorial) => (t.touch ? '<b>Use</b>' : t.key('activate', '<kbd>F</kbd>'));
/** Working a thing: pointed at and F, or tapped and Use. */
const useOn = (t: Tutorial, what: string) => (t.touch ? `tap ${what}, then <b>Use</b>` : `point at ${what} and press ${useKey(t)}`);
/** ...to start a sentence. */
const UseOn = (t: Tutorial, what: string) => {
  const s = useOn(t, what);
  return s[0].toUpperCase() + s.slice(1);
};
/** What to point at to work a thing: on a touch screen, once it's selected, the Use button. */
const useAt = (t: Tutorial, e: Entity | null) => (e && t.touch && t.controls.selection.has(e) ? touchBtn('Use') : e);
/** A medicine's step: pushed against them it works by itself; Use, or its menu's Inject or Use, as well. */
const MEDICINE: Allow = { actions: ['activate'], menu: ['Inject', 'Inject themselves', 'Use', 'Use on themselves'] };
const menu = (t: Tutorial) => (t.touch ? 'long-press' : 'right-click');
const Menu = (t: Tutorial) => (t.touch ? 'Long-press' : 'Right-click');
/** " (Z)": a command's key, if it has one (on a keyboard). */
const keyNote = (t: Tutorial, id: ActionId) => {
  const k = t.touch ? '' : t.key(id);
  return k ? ` (${k})` : '';
};
/** A prop kept under a name, as what it is (null if it's gone or isn't one). */
function refAs<T extends Entity>(t: Tutorial, name: string, cls: abstract new (...a: never[]) => T): T | null {
  const e = t.ref(name);
  return e instanceof cls ? e : null;
}
/** A floor x `dx` along from a thing (or the view), kept inside the walls. */
const beside = (t: Tutorial, e: Entity | null, dx: number) =>
  Math.min(WORLD.right - 2, Math.max(WORLD.left + 2, (e && !e.destroyed ? e.center().x : t.game.renderer.camX) + dx));
/**
 * The first of these spots (m from the view's middle) with nothing on the floor
 * within `r` m either side, and no bomb or barrel left within `far` m (it may yet
 * go off), or the least crowded if none is clear.
 */
const openGround = (t: Tutorial, dxs: number[], r: number, far = 0): number => {
  const xs = dxs.map((dx) => beside(t, null, dx));
  // how far x is from anything on the floor there: any part of it (a body lying down reaches
  // a metre either side of its middle), and an explosive's whole blast
  const gap = (x: number) => {
    let g = Infinity;
    for (const e of t.game.entities) {
      if (e.destroyed) continue;
      if (e instanceof Explosive) g = Math.min(g, Math.abs(e.center().x - x) - Math.max(0, far - r));
      else for (const p of e.parts) if (!p.destroyed && p.y < WORLD.floor + 2) g = Math.min(g, Math.abs(p.x - x));
    }
    // (and burning oil on the floor: put down in it, a thing burns away)
    for (let d = 0; d <= r + 0.5 && g > d; d += 0.1) if (t.game.puddles.burningAt(x - d) || t.game.puddles.burningAt(x + d)) g = d;
    return g;
  };
  // (none clear: the least crowded)
  return xs.find((x) => gap(x) >= r) ?? xs.reduce((a, b) => (gap(b) > gap(a) ? b : a));
};
/** Where the Editing tour's plank goes: right of the view's middle, clear of the crates left about (it's 2 m long). */
const shelfAt = (t: Tutorial) => openGround(t, [3, 4.5, 6, 1.5, -3, -4.5], 1.4);
/** A row of crates to shoot at, at x (unless there are a couple about already). */
const targets = (t: Tutorial, x: number) => {
  if (t.all('crate').length >= 2) return;
  t.stack('crate', x, 3);
  t.put('explosive-barrel', x + 1.3);
};
/** The people about (alive). */
const people = (t: Tutorial): Human[] => t.all('human').filter((e): e is Human => e instanceof Human);
/** How fast someone bleeds, all their wounds together. */
const bleeding = (e: Entity | null): number => {
  const p = asPatient(e);
  let r = 0;
  if (p) for (const l of p.limbs.values()) if (!l.gone) for (const w of l.wounds) r += w.rate;
  return r;
};
const onFire = (e: Entity) => e.parts.some((p) => !p.destroyed && p.burning > 0);
const broken = (e: Entity | null) => {
  const p = asPatient(e);
  return !!p && [...p.limbs.values()].some((l) => !l.gone && l.broken);
};
/** A stab in the middle: bleeding, not deadly. */
const stab = (h: Human | null, amount = 15) => {
  const p = h?.limbs.get('midTorso')?.part;
  if (h && p) h.damage(p, amount, 'stab', { x: p.x, y: p.y + 0.08 }, { x: 0, y: -1 });
};
/** Where someone's worst wound is (null: none). */
const woundOf = (h: Human | null): V2 | null => {
  const p = asPatient(h);
  let best: { at: V2; r: number } | null = null;
  if (p)
    for (const l of p.limbs.values()) {
      if (l.gone) continue;
      for (const w of l.wounds) if (!best || w.rate > best.r) best = { at: l.part.pixelToWorld(w.ix, w.iy), r: w.rate };
    }
  return best?.at ?? null;
};
/**
 * A syringe put out by the patient, on clear floor (spawned on the kit or the last syringe,
 * it's thrown out of the world), its needle towards them.
 */
const syringeBy = (t: Tutorial, name: string, id: string) => {
  const h = patientOut(t);
  const hx = h ? h.center().x : t.game.renderer.camX;
  const x = openGround(t, [-1.2, 1.2, -1.8, 1.8, -2.4, 2.4].map((d) => beside(t, h, d) - t.game.renderer.camX), 0.35);
  return t.keep(name, t.put(id, x, { flip: x > hx }));
};
/** The people tour's patient, while they live. */
const pat = (t: Tutorial): Human | null => {
  const h = t.ref('patient');
  return h instanceof Human && h.alive ? h : null;
};
/** ...or a new one, if they're gone. */
const patientOut = (t: Tutorial): Human | null => {
  const h = pat(t) ?? t.keep('patient', t.put('human', t.game.renderer.camX));
  return h instanceof Human ? h : null;
};
/** The first of the step's water flasks (water0, water1, ...) with water still in it. */
const waterLeft = (t: Tutorial): Entity | null => {
  for (let i = 0; i < 4; i++) {
    const f = t.ref(`water${i}`);
    if (f instanceof Flask && f.amount > 0) return f;
  }
  return null;
};
/** Turned on, then off again (a view to look through and put away). */
const onThenOff = (t: Tutorial, on: boolean) => {
  if (on) t.memo.on = 1;
  return !!t.memo.on && !on;
};
/** A panel open, by its title. */
const panelOpen = (title: string) => [...document.querySelectorAll('.overlay:not(.hidden) .panel-title')].some((e) => e.textContent === title);
const helpOpen = () => !!q('.overlay:not(.hidden) .help-panel');
/** A button of the open Maps panel, by its label. */
const mapsBtn = (label: string) => [...document.querySelectorAll<HTMLElement>('.overlay:not(.hidden) .maps-panel .panel-btn')].find((b) => b.textContent === label) ?? null;
/** The tour's own car (or truck, or SUV), and the player's tank. */
const ride = (t: Tutorial): Car | null => {
  const c = refAs(t, 'ride', Car);
  return c && !(c instanceof Tank) && !c.body.destroyed ? c : null;
};
const rideOut = (t: Tutorial): Car | null => ride(t) ?? (t.keep('ride', t.put('car', t.game.renderer.camX - 4)) as Car | null);
const tank = (t: Tutorial): Tank | null => {
  const c = refAs(t, 'tank', Tank);
  return c && !c.body.destroyed ? c : null;
};
/** ...or one put out left of the view's middle, all of it in sight (not under the toybox). */
const tankOut = (t: Tutorial): Tank | null =>
  tank(t) ?? (t.keep('tank', t.put('tank', Math.max(t.inSight().left + 2.5, t.game.renderer.camX - 6))) as Tank | null);
/** A metre over a vehicle's front seat: where to let go of someone to get them in. */
const overSeat = (c: Car | null): V2 | null => {
  if (!c) return null;
  const [sx, sy] = c.cfg.seats[0].at;
  const p = c.body.pixelToWorld(sx, sy);
  return { x: p.x, y: p.y + 1.6 };
};
/** Where to open the car's menu: its bonnet (the cabin is whoever sits in it), till a menu's open. */
const carMenuAt = (t: Tutorial): V2 | null => {
  const c = ride(t);
  return c && !q('.ctx') ? bonnet(c) : null;
};
/** Sits someone in the front seat, as letting go of them over it does. */
const seatIn = (c: Car | null, h: Entity | null): boolean => {
  if (!c || !(h instanceof Human) || !h.alive || h.seat) return false;
  const [sx, sy] = c.cfg.seats[0].at;
  return c.takeIn(h, c.body.pixelToWorld(sx, sy));
};
const occupied = (c: Car) => c.cfg.seats.some((_, i) => !!c.occupant(i));
const chestOf = (e: Entity) => (e instanceof Creature ? e.limbs.get('chest')?.part : null) ?? e.parts[0];
/** The oil on the floor nearest x, or null. */
const oilNear = (t: Tutorial, x: number): number | null => {
  const pd = t.game.puddles;
  let best: number | null = null;
  for (let at = WORLD.left; at <= WORLD.right; at += 0.1) {
    if (pd.kindAt(at) !== LIQUID_IDS.oil || pd.amountAt(at) <= 0) continue;
    if (best === null || Math.abs(at - x) < Math.abs(best - x)) best = at;
  }
  return best;
};
/** About a flask's worth of oil spilt at x. */
const spillOil = (t: Tutorial, x: number) => {
  for (let i = 0; i < 270; i++) t.game.puddles.add(LIQUID_IDS.oil, x + ((i % 27) - 13) * 0.04);
};

/** Which side of an animal is away from its person (-1 left, 1 right): where to put what's to be carried to it. */
const awayFromOwner = (t: Tutorial, e: Entity | null): 1 | -1 => {
  const o = t.ref('owner');
  if (!e || !o) return -1;
  return o.center().x > e.center().x ? -1 : 1;
};
/** "Open X in the toybox, pick Y" (X open already, just "pick Y": clicking X again folds it away). */
const openShelf = (t: Tutorial, cat: Category, pick: string) => {
  const tap = t.touch ? 'tap' : 'click';
  if (q('.catalog:not(.collapsed)') && q(`.cat-btn.active[data-cat="${cat}"]`)) return `On the <b>${cat}</b> shelf, open on the left, ${tap} <b>${pick}</b>`;
  return t.touch ? `Open <b>${cat}</b> (on the strip at the left), tap <b>${pick}</b>` : `Open <b>${cat}</b> in the toybox on the left, click <b>${pick}</b>`;
};
/** "Open X in the toybox, pick Y, spawn it": done when one is out (kept as `name`). */
const spawnStep = (o: {
  id: string; title: string; cat: Category; pick: string; ids: string[]; name: string; more?: string;
  fallback(t: Tutorial): Entity | null;
}): TutorialStep => ({
  id: o.id,
  title: o.title,
  text: (t) =>
    `${openShelf(t, o.cat, o.pick)}, then ${t.touch ? 'tap the floor' : t.spawnHow()}.` +
    (o.more ? ` ${o.more}` : ''),
  // (the toys asked for, on their shelf, and either spawn key)
  allow: { categories: [o.cat], items: o.ids, actions: ['spawnLeft', 'spawnRight'] },
  done: (t) => {
    const e = t.game.entities.find((x) => !x.destroyed && o.ids.includes(x.def.id) && !t.props.has(x));
    if (!e) return false;
    t.keep(o.name, e);
    // (spawning more on every tap or key would get in the way of the next steps)
    t.controls.arm(null);
    return true;
  },
  target: (t) => {
    if (o.ids.includes(t.controls.armed?.id ?? '')) return t.floorAhead();
    const tile = [...document.querySelectorAll('.catalog:not(.collapsed) .item')].find((e) => e.querySelector('.item-name')?.textContent === o.pick);
    return tile ?? q(`.cat-btn[data-cat="${o.cat}"]`);
  },
  skipped: (t) => {
    if (!t.ref(o.name)) t.keep(o.name, o.fallback(t));
  },
});

/** The last step's buttons: tidy up, or on to another tour. */
const endAlts = (...more: { label: string; action(t: Tutorial): void }[]) => [
  ...more,
  {
    label: 'Clear the mess',
    action: (t: Tutorial) => {
      t.controls.clearScene('Clear all');
      t.stop();
    },
  },
  {
    label: 'More tutorials…',
    action: (t: Tutorial) => {
      t.stop();
      t.hooks.tutorials?.();
    },
  },
];

// ---- people and medicine ----------------------------------------------------------------

/** People and medicine: hurt someone, look inside, and every way to put them right (and back from the dead). */
export const PEOPLE: TutorialStep[] = [
  {
    id: 'p-hello',
    title: 'People & medicine',
    text: () =>
      'People here have bones, blood, a pulse and opinions about being thrown. You’ll hurt one a bit, look inside them, ' +
      'then put them right with everything in the toybox’s <b>Medical</b>. Nobody holds a grudge.',
    info: 'Start',
  },
  {
    id: 'p-break',
    title: 'Break a bone',
    text: (t) =>
      `Bones break when people hit things hard. ${t.touch ? 'Drag' : 'Grab'} them, lift them high and slam them down into the floor ` +
      '(or fling them down hard) until something snaps.',
    setup: (t) => {
      patientOut(t);
    },
    done: (t) => t.game.entities.some((e) => e instanceof Human && !e.destroyed && broken(e)),
    target: (t) => (t.controls.grab ? null : pat(t)),
    // (flung off: watched down, the view going with them)
    follow: (t) => {
      const h = pat(t);
      return h && !t.controls.grab && t.speed(h) > 4 ? h.center() : null;
    },
    skipped: (t) => {
      const l = patientOut(t)?.limbs.get('lowerArmF');
      if (l) l.broken = true;
    },
  },
  {
    id: 'p-xray',
    title: 'X-ray',
    text: (t) =>
      `${t.touch ? 'Tap <b>X-ray</b> in the tool bar' : `Press ${t.key('xray', 'the <b>X-ray</b> button up top')}`} to see their bones: the broken one shows. ` +
      'Have a look, then turn it off again.',
    done: (t) => onThenOff(t, t.controls.xray),
    target: () => toolbarBtn('X-ray'),
  },
  {
    id: 'p-detail',
    title: 'Every limb’s health',
    text: (t) =>
      `${t.touch ? 'Tap <b>Detail</b> in the tool bar' : `Press ${t.key('detail', 'the detail key')}`} to see how hurt each limb is, limb by limb. ` +
      'Turn it on, see the damage, and turn it off.',
    done: (t) => onThenOff(t, t.controls.detail),
    target: (t) => (t.touch ? toolbarBtn('Detail') : null),
  },
  {
    id: 'p-vitals',
    title: 'Vital signs',
    text: (t) =>
      `${t.touch ? 'Tap' : 'Click'} them to see their vitals: heart, blood, breathing, pain. To keep those on screen, ${menu(t)} them and choose <b>Vitals</b>.`,
    setup: (t) => {
      patientOut(t);
    },
    done: (t) => isLiving(t.controls.vitalsPinned),
    target: (t) => (q('.ctx') ? null : pat(t)),
    allow: { actions: ['vitals'] },
  },
  {
    id: 'p-stab',
    title: 'Ouch',
    text: () => 'Knives stick in. Throw the <b>knife</b> at them point first, or push it in by hand. (They’ll live. Probably.)',
    setup: (t) => {
      const h = patientOut(t);
      t.memo.b = bleeding(h);
      t.keep('knife', t.put('knife', beside(t, h, -2)));
    },
    done: (t) => {
      const k = t.ref('knife');
      return (k instanceof Blade && k.lodge?.target.entity instanceof Human) || bleeding(pat(t)) > t.memo.b + 0.2;
    },
    target: (t) => t.ref('knife'),
    skipped: (t) => stab(patientOut(t)),
  },
  {
    id: 'p-bandage',
    title: 'Stop the bleeding',
    text: (t) =>
      (t.memo.took
        ? `They took the bandage from you: ${useOn(t, 'it, in their hand,')} and they bandage themselves.`
        : 'Drag the <b>bandage</b> onto the wound (the arrow shows where): it wraps itself round, and that limb stops bleeding. ' +
          `(Or ${t.touch ? 'select it while it touches them and tap <b>Use</b>' : `press ${useKey(t)} on it while it touches them`}.)`),
    setup: (t) => {
      // (the knife out of the way: Ctrl+Z brings it back)
      const k = t.ref('knife');
      if (k instanceof Blade) {
        k.unstick();
        t.game.remove(k);
      }
      const h = patientOut(t);
      if (bleeding(h) < 0.15) stab(h);
      t.keep('bandage', t.put('bandage', beside(t, h, 1.4)));
    },
    // (wrapped round them: it's used up)
    done: (t) => t.refs.has('bandage') && !t.ref('bandage'),
    target: (t) => {
      const b = refAs(t, 'bandage', Item);
      // let go by their hand, they took it: Use has them bandage themselves
      if (b?.holder && !t.memo.took) {
        t.memo.took = 1;
        t.refresh();
      }
      if (b?.holder) return useAt(t, b);
      return t.controls.grab ? woundOf(pat(t)) : b;
    },
  },
  {
    id: 'p-sever',
    title: 'Losing a limb',
    text: (t) => `Swords cut. ${t.touch ? 'Drag' : 'Grab'} the <b>sword</b> and slash it fast through an arm or a leg. (Gory. There’s a cure coming.)`,
    setup: (t) => {
      t.keep('sword', t.put('sword', beside(t, patientOut(t), -1.8)));
    },
    done: (t) => t.game.entities.some((e) => e instanceof Human && !e.destroyed && [...e.limbs.values()].some((l) => l.severed)),
    target: (t) => t.ref('sword'),
    skipped: (t) => {
      const h = patientOut(t);
      const l = h?.limbs.get('lowerArmB');
      if (h && l && !l.severed) h.sever(l, 'cut');
    },
  },
  {
    id: 'p-heal',
    title: 'Healing syringe',
    text: (t) =>
      'The green <b>healing syringe</b> mends bones, closes wounds and tops up blood. Push the needle into them' +
      `${t.touch ? '' : `, or hold it against them and press ${useKey(t)}`}.`,
    setup: (t) => {
      syringeBy(t, 'syringe', 'syringe-healing');
    },
    // (in: it empties as the dose goes in)
    done: (t) => {
      const s = t.was('syringe');
      return !!s && (s.destroyed || (s instanceof Syringe && s.fill < 0.5));
    },
    target: (t) => t.ref('syringe'),
  },
  {
    id: 'p-burn',
    title: 'Too hot',
    text: (t) => `${Menu(t)} them and choose <b>Ignite</b>${keyNote(t, 'ignite')}. People on fire drop and roll about.`,
    setup: (t) => {
      patientOut(t);
    },
    done: (t) => people(t).some(onFire),
    target: (t) => (q('.ctx') ? null : pat(t)),
    skipped: (t) => {
      const p = patientOut(t)?.limbs.get('upperTorso')?.part;
      if (p) t.game.fire.ignite(p, 0.8);
    },
  },
  {
    id: 'p-douse',
    title: 'Put them out',
    // (a flask puts out what it splashes, about half of someone ablaze, and a small flame
    // left, a hand, say, soon lights the rest again: hence three, and the menu for the last)
    text: (t) =>
      `Water puts fire out where it lands. Fling the <b>water flasks</b> at them, one after another, at whatever’s still alight ` +
      `(or uncork one, ${useKey(t)}, and pour). A last flame that hangs on: ${menu(t)} them and choose <b>Extinguish</b>.`,
    setup: (t) => {
      const h = patientOut(t);
      if (!people(t).some(onFire)) {
        const p = h?.limbs.get('upperTorso')?.part;
        if (p) t.game.fire.ignite(p, 0.8);
      }
      for (let i = 0; i < 3; i++) t.keep(`water${i}`, t.put('flask-water', beside(t, h, -1.6 - i * 0.45)));
    },
    done: (t) => !people(t).some(onFire),
    target: (t) => waterLeft(t) ?? (q('.ctx') ? null : pat(t)),
    // (uncorked with F, or its menu, to pour)
    allow: { actions: ['activate'], menu: ['Uncork', 'Cork'] },
  },
  {
    id: 'p-kit',
    title: 'First aid',
    text: () => 'The <b>first aid kit</b> patches up wounds, bones, burns and blood over a few seconds, three times over. Drag it onto them.',
    setup: (t) => {
      const h = patientOut(t);
      const p = asPatient(h);
      if (p && !needsCare(p)) stab(h);
      t.keep('kit', t.put('first-aid-kit', beside(t, h, 1.5)));
    },
    // (once it's done: healing still going in would wear the next step's sedative off as fast as it went in)
    done: (t) => {
      const k = t.was('kit');
      return k instanceof FirstAidKit && k.uses < 3 && !k.busy;
    },
    target: (t) => t.ref('kit'),
    allow: MEDICINE,
  },
  {
    id: 'p-knockout',
    title: 'Sweet dreams',
    text: () => 'The <b>knockout syringe</b> puts anyone (or any animal) to sleep for half a minute. Inject them.',
    setup: (t) => {
      syringeBy(t, 'ko', 'syringe-knockout');
    },
    // (asleep: a trace of it, worn off by healing as it goes in, isn't)
    done: (t) => people(t).some((h) => h.drugs.knockout > 5),
    target: (t) => t.ref('ko'),
    allow: MEDICINE,
  },
  {
    id: 'p-adrenaline',
    title: 'Wake up!',
    text: () => '<b>Adrenaline</b> wakes them up, kills the pain and makes them quick on their feet for a while. Wake the sleeper.',
    setup: (t) => {
      syringeBy(t, 'adrenaline', 'syringe-adrenaline');
    },
    done: (t) => people(t).some((h) => h.drugs.adrenaline > 0),
    target: (t) => t.ref('adrenaline'),
    allow: MEDICINE,
  },
  {
    id: 'p-poison',
    title: 'Poison',
    text: () => '<b>Poison</b> drains the life out of them, slowly, turning them green. Inject it, if you dare, and watch.',
    setup: (t) => {
      syringeBy(t, 'poison', 'syringe-poison');
    },
    // (a few seconds of it seen working, before the next step skips to the end)
    done: (t) => {
      if (t.memo.in === undefined && t.game.entities.some((e) => e instanceof Human && !e.destroyed && e.drugs.poison > 0)) t.memo.in = t.game.time;
      return t.memo.in !== undefined && t.game.time - t.memo.in > 3;
    },
    target: (t) => t.ref('poison'),
    allow: MEDICINE,
  },
  {
    id: 'p-defib',
    title: 'Clear!',
    text: (t) =>
      'Poison is slow, so let’s skip to the sad part: they’re gone. A <b>defibrillator</b> restarts a heart that stopped less than a minute ago. ' +
      `Charge it (${useKey(t)}) and hold its front end against their chest: it shocks them as it’s ready.`,
    setup: (t) => {
      const h = (t.game.entities.find((e) => e instanceof Human && !e.destroyed && e.drugs.poison > 0) as Human | undefined) ?? patientOut(t);
      if (!h) return;
      // (whole again first, the poison done with: once started, the heart keeps going, whatever the
      // steps before did to their chest)
      h.heal();
      h.drugs.poison = 0;
      h.die();
      t.keep('dead', h);
      t.keep('defib', t.put('defibrillator', beside(t, h, 1.3)));
    },
    done: (t) => {
      const d = t.was('dead');
      return d instanceof Human && !d.destroyed && d.alive;
    },
    target: (t) => t.ref('defib'),
  },
  {
    id: 'p-life',
    title: 'Back from the dead',
    text: () => 'Too late for the defibrillator? The <b>life syringe</b> brings back anyone who still has a head on. Try it on this one.',
    setup: (t) => {
      const x = beside(t, null, 3);
      const b = t.keep('body', t.put('human', x, { angle: Math.PI / 2 }));
      if (b instanceof Human) b.die();
      t.keep('life', t.put('syringe-life', x - 1.6));
    },
    done: (t) => {
      const b = t.was('body');
      return b instanceof Human && !b.destroyed && b.alive;
    },
    target: (t) => t.ref('life'),
    allow: MEDICINE,
  },
  {
    id: 'p-end',
    title: 'Clinic closed',
    text: (t) =>
      `That’s all of Medical. ${Menu(t)} anyone for more (heal, kill, go limp…). <b>Androids</b>, in Characters, don’t bleed at all; ` +
      'animals do, and the same medicine works on them.',
    info: 'Done!',
    alts: endAlts(),
  },
];

// ---- weapons and explosives -------------------------------------------------------------

/** Weapons: guns lying about and in hand, editing them, melee, knives, every explosive, the crossbow, a nuke. */
export const WEAPONS: TutorialStep[] = [
  {
    id: 'w-hello',
    title: 'Weapons & explosives',
    text: () =>
      'Guns, blades and things that go boom, and how they go together. There are crates to shoot at; anything that breaks, ' +
      'the toybox has more of.',
    info: 'Lock and load',
  },
  {
    id: 'w-lying',
    title: 'No hands needed',
    text: (t) => `A gun fires by itself, lying on the floor: ${useOn(t, 'the <b>pistol</b>')}.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.memo.s = t.seen.shots;
      t.keep('pistol', t.put('pistol', x - 3));
      targets(t, x + 3);
    },
    done: (t) => t.seen.shots > t.memo.s,
    target: (t) => useAt(t, t.ref('pistol')),
  },
  {
    id: 'w-auto',
    title: 'Automatic fire',
    text: (t) => `The <b>submachine gun</b> is automatic: hold ${useKey(t)} down on it to spray.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.memo.s = t.seen.shots;
      t.keep('smg', t.put('smg', x - 1.5));
      targets(t, x + 3);
    },
    done: (t) => t.seen.shots >= t.memo.s + 6,
    target: (t) => useAt(t, t.ref('smg')),
  },
  {
    id: 'w-hold',
    title: 'Arm someone',
    text: () => 'Drag the <b>shotgun</b> onto the new person’s hand: they’ll hold it.',
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.keep('gunner', t.put('human', x - 6));
      t.keep('shotgun', t.put('shotgun', x - 4.4));
    },
    done: (t) => {
      const g = refAs(t, 'shotgun', Item);
      return !!g && g.holder instanceof Human;
    },
    target: (t) => t.ref('shotgun'),
    skipped: (t) => {
      handTo(t.ref('gunner'), t.ref('shotgun'));
    },
  },
  {
    id: 'w-edit',
    title: 'Tune it',
    text: (t) =>
      `${Menu(t)} the shotgun and choose <b>Edit gun…</b>: recoil, power, pellets, time between shots, how far through things it goes. ` +
      'Change anything you like, then close it.',
    setup: (t) => {
      t.memo.e = t.seen.edits;
    },
    done: (t) => t.seen.edits > t.memo.e && !q('.edit-panel'),
    target: (t) => (q('.ctx') || q('.edit-panel') ? null : t.ref('shotgun')),
  },
  {
    id: 'w-fire',
    title: 'Fire!',
    text: (t) => `Select the gunner (${t.touch ? 'tap' : 'click'} them), then ${useKey(t)}: people fire whatever they hold.`,
    setup: (t) => {
      t.memo.s = t.seen.shots;
      const g = refAs(t, 'shotgun', Item);
      if (!(g?.holder instanceof Human)) {
        const h = refAs(t, 'gunner', Human) ?? t.keep('gunner', t.put('human', t.game.renderer.camX - 6));
        handTo(h, g ?? t.keep('shotgun', t.put('shotgun', beside(t, h, 1.6))));
      }
      targets(t, t.game.renderer.camX + 3);
    },
    done: (t) => t.seen.shots > t.memo.s,
    target: (t) => useAt(t, refAs(t, 'shotgun', Item)?.holder ?? t.ref('gunner')),
  },
  {
    id: 'w-swing',
    title: 'Batter up',
    text: (t) =>
      `Melee weapons swing. Select the one with the <b>bat</b> and ${useKey(t)}: they swing at whoever is in front. ` +
      '(Swords, axes and knives cut; bats and hammers break bones.)',
    setup: (t) => {
      const x = t.game.renderer.camX;
      const h = t.keep('batter', t.put('human', x - 0.6));
      handTo(h, t.put('bat', x));
      t.keep('dummy', t.put('human', x + 0.35));
      t.memo.swings = 0;
      if (h) t.hook(h, 'activate', () => t.memo.swings++);
    },
    done: (t) => t.memo.swings > 0,
    target: (t) => useAt(t, t.ref('batter')),
  },
  {
    id: 'w-knife',
    title: 'Knives stick',
    text: () =>
      'Grab the <b>knife</b> by its handle and fling it at the board, point first (a quick flick), or push the point in by hand: it sticks. ' +
      '(Drag it to pull it out again.)',
    setup: (t) => {
      // (a clear lane for it: Ctrl+Z brings the rest back)
      t.clean();
      const x = t.game.renderer.camX;
      t.keep('knife', t.put('knife', x - 2.2));
      t.keep('board', t.put('plank', x + 2.4, { angle: Math.PI / 2, frozen: true, dy: 0.3 }));
    },
    done: (t) => !!refAs(t, 'knife', Blade)?.lodge,
    target: (t) => {
      const k = refAs(t, 'knife', Blade);
      if (!k || t.controls.grab) return null;
      const p = k.main;
      return p.pixelToWorld(Math.max(1, k.blade.blade[0] / 2), p.h / 2);
    },
  },
  {
    id: 'w-grenade',
    title: 'Grenade',
    text: (t) => `${UseOn(t, 'the <b>grenade</b>')} to pull the pin, then throw it at the crates. Three seconds!`,
    setup: (t) => {
      // (a clear floor for the explosives: Ctrl+Z brings the rest back)
      t.clean();
      const x = t.game.renderer.camX;
      t.memo.b = t.seen.blasts;
      t.keep('grenade', t.put('grenade', x - 2));
      targets(t, x + 3);
    },
    done: (t) => t.seen.blasts > t.memo.b,
    target: (t) => useAt(t, t.ref('grenade')),
  },
  {
    id: 'w-dynamite',
    title: 'Dynamite and C4',
    text: (t) =>
      `Dynamite has a fuse: ${useKey(t)} lights it, and so does fire. C4 goes off the moment it’s used, or when a wire or a button tells it to. ` +
      'Set one off.',
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.memo.b = t.seen.blasts;
      t.keep('dynamite', t.put('dynamite', x - 2));
      t.keep('c4', t.put('c4', x + 2));
    },
    done: (t) => t.seen.blasts > t.memo.b,
    target: (t) => useAt(t, t.ref('dynamite') ?? t.ref('c4')),
  },
  {
    id: 'w-cord',
    title: 'Fuse cord',
    text: (t) =>
      `<b>Fuse</b> (${t.touch ? 'pick the Rope on the right, then Fuse under it' : `${t.key('tool2', 'the Rope’s key')} twice: the Rope’s other kind, or pick it under the Rope`}): ${drag(t)} a cord from the dynamite to the C4, and on to the barrel. ` +
      `Then ${clickTap(t)} the cord to light it, and watch it burn along.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.memo.b = t.seen.blasts;
      t.keep('stick', t.put('dynamite', x - 2.4));
      t.put('c4', x - 0.6);
      t.put('explosive-barrel', x + 1.2);
    },
    done: (t) => t.made('fuse').length > 0 && t.seen.blasts > t.memo.b,
    target: (t) => (t.made('fuse').length ? null : withTool(t, 'fuse', 'Fuse', t.ref('stick'))),
  },
  {
    id: 'w-molotov',
    title: 'Molotov',
    text: (t) => `${UseOn(t, 'the <b>Molotov</b>')} to light its rag, then throw it: it smashes into a pool of burning oil.`,
    setup: (t) => {
      t.controls.setTool('drag');
      const x = t.game.renderer.camX;
      t.keep('molotov', t.put('molotov', x - 2));
      targets(t, x + 3);
    },
    done: (t) => t.refs.has('molotov') && !t.ref('molotov'),
    target: (t) => useAt(t, t.ref('molotov')),
  },
  {
    id: 'w-rpg',
    title: 'Rocket launcher',
    text: (t) => `Select the soldier and ${useKey(t)}. Rockets fly straight and hit hard. (An RPG on the floor fires by itself too.)`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      t.memo.b = t.seen.blasts;
      const h = t.keep('soldier', t.put('human', x - 5));
      handTo(h, t.put('rpg', x - 3.5));
      t.stack('crate', x + 5, 3);
      t.put('explosive-barrel', x + 6.3);
    },
    done: (t) => t.seen.blasts > t.memo.b,
    target: (t) => useAt(t, t.ref('soldier')),
  },
  {
    id: 'w-crossbow',
    title: 'Crossbow',
    text: (t) => `The <b>crossbow</b> shoots bolts that stick in what they hit: ${useOn(t, 'it')}. It takes a moment to cock again.`,
    setup: (t) => {
      const x = t.game.renderer.camX;
      const bow = t.keep('bow', t.put('crossbow', x - 3));
      t.memo.s = bow instanceof Crossbow ? bow.shots : 0;
      targets(t, x + 3);
    },
    done: (t) => (refAs(t, 'bow', Crossbow)?.shots ?? 0) > t.memo.s,
    target: (t) => useAt(t, t.ref('bow')),
  },
  {
    id: 'w-bolts',
    title: 'Five kinds of bolt',
    text: (t) => `${Menu(t)} the crossbow for its bolts: <b>poison</b>, <b>explosive</b>, <b>incendiary</b>, <b>tranquilizer</b>. Load one, and shoot it.`,
    setup: (t) => {
      const bow = refAs(t, 'bow', Crossbow) ?? (t.keep('bow', t.put('crossbow', t.game.renderer.camX - 3)) as Crossbow | null);
      t.memo.s = bow?.shots ?? 0;
      targets(t, t.game.renderer.camX + 3);
    },
    done: (t) => {
      const bow = refAs(t, 'bow', Crossbow);
      return !!bow && bow.bolt !== 'normal' && bow.shots > t.memo.s;
    },
    target: (t) => (q('.ctx') ? null : useAt(t, t.ref('bow'))),
    allow: { menu: ['Bolts'], actions: ['activate'] },
  },
  {
    id: 'w-nuke',
    title: 'The big one',
    text: (t) =>
      'A thermonuclear bomb, set to its smallest yield (0.1 kt: enough for a city block). ' +
      `Its menu sets anything up to 50 Mt, and the countdown. ${UseOn(t, 'it')} to start the countdown, then enjoy the view.`,
    setup: (t) => {
      // (nothing else in the way of the light show)
      t.clean();
      t.memo.n = t.seen.nukes;
      const n = t.keep('nuke', t.put('nuke', t.game.renderer.camX));
      if (n instanceof Nuke) {
        n.kt = NUKE_MIN_KT;
        n.countdown = 5;
      }
    },
    done: (t) => t.seen.nukes > t.memo.n,
    target: (t) => useAt(t, t.ref('nuke')),
  },
  {
    id: 'w-end',
    title: 'Armed and dangerous',
    text: (t) =>
      'Also in the toybox: the sniper rifle, a minigun that spins up, the laser rifle, landmines, bombs… ' +
      `Wire a button to a gun or a bomb (Building machines shows how) to fire it from afar. ${t.touch ? '' : `${t.key('help', 'The ? button')} lists every control.`}`,
    info: 'Done!',
    alts: endAlts(),
  },
];

// ---- vehicles ---------------------------------------------------------------------------

/** Vehicles: spawn one, get in, drive, stop, gears, the arrow keys, get out, crash; then a tank. */
export const VEHICLES: TutorialStep[] = [
  {
    id: 'v-hello',
    title: 'Vehicles',
    text: () => 'Cars, trucks and tanks: get in, drive about, crash them, and fire a cannon. Seat belts optional.',
    info: 'Let’s roll',
  },
  spawnStep({
    id: 'v-spawn',
    title: 'Get a car',
    cat: 'Vehicles',
    pick: 'Car',
    ids: ['car', 'truck', 'suv'],
    name: 'ride',
    more: '(The pickup and the SUV work the same.)',
    fallback: (t) => t.put('car', t.game.renderer.camX - 4),
  }),
  {
    id: 'v-board',
    title: 'Get in',
    text: () => 'Grab the person, <b>lift them up</b> over the car and let go: in they get. (Pushed against it, the car just rolls away. The SUV seats four.)',
    setup: (t) => {
      const c = rideOut(t);
      if (c && !occupied(c) && !t.ref('driver')) t.keep('driver', t.put('human', beside(t, c, -3.5)));
    },
    done: (t) => !!ride(t)?.occupant(0),
    target: (t) => (t.controls.grab ? overSeat(ride(t)) : t.ref('driver')),
    skipped: (t) => {
      const c = rideOut(t);
      if (c && !c.occupant(0)) seatIn(c, t.ref('driver') ?? t.put('human', beside(t, c, -3)));
    },
  },
  {
    id: 'v-drive',
    title: 'Drive',
    text: (t) =>
      `${t.touch ? 'Tap the front of the car, then <b>Use</b>' : `Point at the front of the car and press ${useKey(t)}`} to drive ` +
      `(its ${menu(t)} menu has <b>Drive</b> too). The view goes along with it.`,
    setup: (t) => {
      const c = rideOut(t);
      if (c && !c.occupant(0)) seatIn(c, t.put('human', beside(t, c, -3)));
      t.memo.x = c?.body.x ?? 0;
    },
    done: (t) => {
      const c = ride(t);
      return !!c && Math.abs(c.body.x - t.memo.x) > 4;
    },
    follow: (t) => chase(t, ride(t)),
    target: (t) => {
      const c = ride(t);
      return c && !c.driving ? (t.touch && t.controls.selection.has(c) ? touchBtn('Use') : bonnet(c)) : null;
    },
    // (going, for the brakes after)
    skipped: (t) => {
      const c = ride(t);
      if (c && !c.driving && c.occupant(0)) c.activate();
    },
  },
  {
    id: 'v-stop',
    title: 'Brakes',
    text: (t) => `Do it again to stop: ${t.touch ? 'tap it, then <b>Use</b>' : `point at the front and press ${useKey(t)}`} (or its menu’s <b>Stop</b>).`,
    done: (t) => {
      const c = ride(t);
      return !c || (!c.driving && t.speed(c) < 1.5);
    },
    follow: (t) => chase(t, ride(t)),
    target: (t) => {
      const c = ride(t);
      return c && c.driving ? (t.touch && t.controls.selection.has(c) ? touchBtn('Use') : bonnet(c)) : null;
    },
  },
  {
    id: 'v-gear',
    title: 'Gears',
    text: (t) =>
      `${Menu(t)} the front of the car (the cabin is the driver’s): <b>Speed</b> from Slow to Turbo, <b>Reverse</b>, <b>Seat belts</b>, <b>Get out</b>. ` +
      'Pick another speed, or reverse.',
    setup: (t) => {
      const c = rideOut(t);
      t.memo.g = c ? GEARS.findIndex((g) => g.id === c.gear) : 0;
      t.memo.d = c?.dir ?? 1;
    },
    done: (t) => {
      const c = ride(t);
      return !!c && (GEARS.findIndex((g) => g.id === c.gear) !== t.memo.g || c.dir !== t.memo.d);
    },
    target: (t) => carMenuAt(t),
  },
  {
    id: 'v-keys',
    title: 'At the wheel',
    text: (t) =>
      `Or drive it yourself: ${t.controls.selection.has(ride(t) as Entity) ? 'with the car selected' : `select the car (${t.touch ? 'tap' : 'click'} it)`}, ` +
      (t.touch
        ? 'hold <b>▶</b> or <b>◀</b>, at the sides of the screen. Let go and it brakes.'
        : `hold ${t.key('driveRight', '<kbd>→</kbd>')} or ${t.key('driveLeft', '<kbd>←</kbd>')}. Let go and it brakes.`),
    setup: (t) => {
      const c = rideOut(t);
      // (stopped first: the keys are what moves it)
      if (c?.driving) c.activate();
      t.memo.x = c?.body.x ?? 0;
    },
    done: (t) => {
      const c = ride(t);
      return !!c && !c.on && Math.abs(c.body.x - t.memo.x) > 3;
    },
    follow: (t) => chase(t, ride(t)),
    target: (t) => {
      const c = ride(t);
      if (!c) return null;
      return !t.controls.selection.has(c) ? c : t.touch ? touchBtn('▶') : null;
    },
  },
  {
    id: 'v-out',
    title: 'Everybody out',
    text: (t) => `${Menu(t)} the front of the car and choose <b>Get out</b>. (Its <b>Seat belts</b> keep them in when it crashes.)`,
    setup: (t) => {
      const c = rideOut(t);
      if (c?.driving) c.activate();
    },
    done: (t) => {
      const c = ride(t);
      return !c || !occupied(c);
    },
    target: (t) => carMenuAt(t),
  },
  {
    id: 'v-crash',
    title: 'Crash test',
    text: (t) =>
      `A dummy at the wheel, set to <b>Turbo</b>. ${t.touch ? 'Tap the front of the car, then <b>Use</b>' : `Point at the front and press ${useKey(t)}`}, ` +
      'and don’t stop for the wall: hit anything that fast and a car blows up.',
    setup: (t) => {
      // (a clear road: Ctrl+Z brings back what was here)
      t.clean();
      t.memo.b = t.seen.blasts;
      const c = carOut(t, true);
      if (!c) return;
      c.gear = 'turbo';
      crashCourse(t, c);
    },
    follow: (t) => chase(t, car(t)),
    done: (t) => t.seen.blasts > t.memo.b || !!car(t)?.wrecked,
    target: (t) => {
      const c = car(t);
      return c && !c.driving ? (t.touch && t.controls.selection.has(c) ? touchBtn('Use') : bonnet(c)) : null;
    },
  },
  {
    id: 'v-aim',
    title: 'Tanks',
    text: (t) =>
      'Four tanks in Vehicles: the Tank, the M1 Abrams, the ZTZ-99A and the Leopard 2A7. ' +
      (t.touch
        ? 'Tap this one and hold <b>▲</b> or <b>▼</b> to raise or lower its gun (its long-press menu has set angles too).'
        : `Select this one and hold ${t.key('aimUp', '<kbd>↑</kbd>')} or ${t.key('aimDown', '<kbd>↓</kbd>')} to raise or lower its gun (its menu has set angles too).`),
    setup: (t) => {
      t.clean();
      const k = tankOut(t);
      t.memo.e = k?.elevation ?? 0;
      const far = Math.min(t.game.renderer.camX + 9.3, t.inSight().right - 0.5);
      t.stack('crate', far - 1.3, 3);
      t.put('explosive-barrel', far);
    },
    done: (t) => {
      const k = tank(t);
      return !!k && Math.abs(k.elevation - t.memo.e) >= 4;
    },
    target: (t) => {
      const k = tank(t);
      if (q('.ctx') || !k) return null;
      return t.touch && t.controls.selection.has(k) ? touchBtn('▲') : k;
    },
  },
  {
    id: 'v-shoot',
    title: 'Fire the cannon',
    text: (t) => `${UseOn(t, 'the tank')}: on a tank that fires the cannon (driving is in its menu). It reloads in a few seconds.`,
    setup: (t) => {
      t.memo.s = tankOut(t)?.shots ?? 0;
    },
    done: (t) => (tank(t)?.shots ?? 0) > t.memo.s,
    target: (t) => useAt(t, tank(t)),
  },
  {
    id: 'v-roll',
    title: 'Roll out',
    text: (t) =>
      t.touch
        ? `Tanks drive like cars: ${menu(t)} it and choose <b>Drive</b> (and <b>Stop</b> after). Nothing much stops a tank.`
        : `Tanks drive like cars: with it selected, hold ${t.key('driveRight', '<kbd>→</kbd>')} (or its menu’s <b>Drive</b>). Nothing much stops a tank.`,
    setup: (t) => {
      t.memo.x = tank(t)?.body.x ?? 0;
    },
    done: (t) => {
      const k = tank(t);
      return !k || Math.abs(k.body.x - t.memo.x) > 3;
    },
    follow: (t) => chase(t, tank(t)),
    target: (t) => (q('.ctx') ? null : tank(t)),
  },
  {
    id: 'v-hatch',
    title: 'Crew',
    text: () => 'Grab the person, <b>lift them up</b> over the turret and let go: they climb into the hatch.',
    setup: (t) => {
      const k = tank(t);
      if (k?.driving) k.drive();
      if (k && !k.occupant(0)) t.keep('crew', t.put('human', beside(t, k, -3.5)));
    },
    done: (t) => {
      const k = tank(t);
      return !k || !!k.occupant(0);
    },
    target: (t) => (t.controls.grab ? overSeat(tank(t)) : t.ref('crew')),
  },
  {
    id: 'v-end',
    title: 'Road trip over',
    text: (t) =>
      'Wire a switch to a car to drive it from afar, or make your own from motor wheels and planks (Building machines shows how). ' +
      `${t.touch ? '' : `${t.key('help', 'The ? button')} lists every key.`}`,
    info: 'Done!',
    alts: endAlts(),
  },
];

// ---- the world --------------------------------------------------------------------------

/** The world: fire and how it spreads, liquids, time, the powers, maps and the map editor. */
export const WORLD_TOUR: TutorialStep[] = [
  {
    id: 'o-hello',
    title: 'The world',
    text: () => 'Fire, water, oil and acid, time itself, the powers, and the maps you play on (and make). It all works together.',
    info: 'Start',
  },
  {
    id: 'o-fire',
    title: 'Fire',
    text: (t) => `${Menu(t)} the crate on the left and choose <b>Ignite</b>${keyNote(t, 'ignite')}. (Pyrokinesis, later on, lights things too.)`,
    setup: (t) => {
      // side by side, a couple of centimeters apart: near enough for a fire's heat to
      // reach the next one (see REACH in systems/Fire), not touching (they'd shove)
      const x = t.game.renderer.camX;
      const mid = t.keep('crate1', t.put('crate', x));
      const w = (mid ? mid.parts[0].w : 28) * PX + 0.02;
      t.keep('crate0', t.put('crate', x - w));
      t.keep('crate2', t.put('crate', x + w));
    },
    done: (t) => [0, 1, 2].some((i) => {
      const c = t.ref(`crate${i}`);
      return !!c && onFire(c);
    }),
    target: (t) => (q('.ctx') ? null : t.ref('crate0')),
    skipped: (t) => {
      const c = t.ref('crate0');
      if (c) t.game.fire.ignite(c.parts[0], 0.8);
    },
  },
  {
    id: 'o-spread',
    title: 'It spreads',
    text: () => 'Fire spreads to whatever touches it. Wait for it to reach the crate on the right (or help it along). Left to burn, wood chars black.',
    done: (t) => {
      const c = t.was('crate2');
      return !c || c.destroyed || onFire(c);
    },
    target: (t) => t.ref('crate2'),
    skipped: (t) => {
      const c = t.ref('crate2');
      if (c) t.game.fire.ignite(c.parts[0], 0.8);
    },
  },
  {
    id: 'o-water',
    title: 'Water',
    text: (t) => `Water puts fire out. Fling a <b>water flask</b> at each fire to smash it, or uncork one (${useKey(t)}) and pour.`,
    setup: (t) => {
      // (a flask for each crate alight, one puts out about one crate, and one to spare for a miss)
      const n = Math.max(1, Math.min(3, t.all('crate').filter(onFire).length)) + 1;
      for (let i = 0; i < n; i++) t.keep(`water${i}`, t.put('flask-water', t.game.renderer.camX - 3.5 - i * 0.45));
    },
    done: (t) => !t.all('crate').some(onFire),
    target: (t) => waterLeft(t) ?? t.all('crate').find(onFire),
  },
  {
    id: 'o-oil',
    title: 'Oil',
    text: () =>
      'Oil soaks into things and makes them burn hot, even metal and people. Throw the <b>oil flask</b> down hard to smash it ' +
      '(or uncork it and pour).',
    setup: (t) => {
      // (right of the crates: the water went left, and burning oil doesn't light on a wet floor)
      t.n = openGround(t, [3.5, 4.5, 2.5, 5.5], 0.6);
      t.keep('oil', t.put('flask-oil', t.n));
    },
    done: (t) => {
      const f = t.was('oil');
      return !f || f.destroyed || (f instanceof Flask && f.amount < 0.7);
    },
    target: (t) => t.ref('oil'),
    skipped: (t) => spillOil(t, t.n),
    allow: { actions: ['activate'], menu: ['Uncork', 'Cork'] },
  },
  {
    id: 'o-light',
    title: 'Light the oil',
    text: () =>
      'Now get the burning crate into the oil: lift it over and drop it in (dragged through water, it goes out). ' +
      'Water on burning oil puts it out, a bit at a time.',
    setup: (t) => {
      let x = oilNear(t, t.n);
      if (x === null) {
        spillOil(t, t.n);
        x = t.n;
      }
      t.n = x;
      // on dry floor: in what's left of the water it would go out at once (and in
      // the oil, light it before they've done a thing)
      const pd = t.game.puddles;
      const dry = (at: number) => [...Array(15).keys()].every((i) => pd.amountAt(at - 0.7 + i * 0.1) <= 0);
      const xs = [2.4, -2.4, 3.5, -3.5, 5, -5].map((d) => Math.max(WORLD.left + 2, Math.min(WORLD.right - 2, x + d)));
      const c = t.keep('torch', t.put('crate', xs.find(dry) ?? xs[0]));
      if (c) t.game.fire.ignite(c.parts[0], 0.8);
    },
    done: (t) => t.game.puddles.burningCells > 0,
    target: (t) => t.ref('torch'),
    skipped: (t) => t.game.puddles.igniteNear(t.n, 1),
  },
  {
    id: 'o-acid',
    title: 'Acid',
    text: () => 'Acid eats into whatever it lands on: skin, wood, even metal. Throw the <b>acid flask</b> hard at the dummy. (Sorry, dummy.)',
    setup: (t) => {
      // (on clear floor: in among the crates left from the fire it's stuck, or one falls on it)
      const x = openGround(t, [-2.5, -3.5, -1.5, -4.5, -5.5], 0.7);
      t.keep('acid', t.put('flask-acid', x));
      t.keep('dummy', t.put('human', openGround(t, [x + 4.5 - t.game.renderer.camX, x + 5.5 - t.game.renderer.camX, x + 3.5 - t.game.renderer.camX], 0.6)));
    },
    done: (t) => {
      const f = t.was('acid');
      return !f || f.destroyed || (f instanceof Flask && f.amount < 0.7);
    },
    target: (t) => t.ref('acid'),
  },
  {
    id: 'o-bucket',
    title: 'Buckets',
    text: (t) =>
      `Buckets catch liquids. Uncork the water flask (${useKey(t)}), hold it over the bucket and tip it up` +
      `${t.touch ? ' (⟲ ⟳ turn what you hold)' : ` (${t.key('rotateLeft', '<kbd>A</kbd>')} and ${t.key('rotateRight', '<kbd>D</kbd>')} turn what you hold)`}. ` +
      'Pour in a good splash. A full bucket, tipped over, puts out a big fire.',
    setup: (t) => {
      // (on the floor, not on one of the crates: tipped, it holds nothing)
      const x = openGround(t, [1, -1, 2, -2, 3, -3, 4, -4], 0.8);
      t.keep('bucket', t.put('bucket', x));
      t.keep('water', t.put('flask-water', x - 1.5));
    },
    done: (t) => (refAs(t, 'bucket', Bucket)?.total ?? 0) >= 25,
    target: (t) => (t.controls.grab ? t.ref('bucket') : t.ref('water')),
  },
  {
    id: 'o-pause',
    title: 'Stop time',
    text: (t) => `${t.touch ? '<b>⏸</b> up top' : t.key('time', '<b>⏸</b>')} stops time: everything hangs where it is, and you can still move things about.`,
    done: (t) => t.game.paused,
    target: () => toolbarBtn('Toggle time'),
  },
  {
    id: 'o-step',
    title: 'One tick at a time',
    text: (t) =>
      `Stopped, the <b>step</b> button up top${t.touch || !t.key('step') ? '' : ` (or ${t.key('step')})`} moves time on one tick, a 60th of a second. ` +
      'Step three times.',
    setup: (t) => {
      if (!t.game.paused) t.controls.togglePause();
      t.memo.s = t.seen.steps;
    },
    done: (t) => t.seen.steps >= t.memo.s + 3,
    target: () => toolbarBtn('Step one tick'),
  },
  {
    id: 'o-slow',
    title: 'Slow motion',
    text: (t) =>
      `${t.touch ? 'The <b>clock</b>' : t.key('slowmo', 'The <b>clock</b>')} is slow motion. Let time run again (${t.touch ? '<b>▶</b>' : t.key('time', '<b>▶</b>')}), ` +
      'try slow motion, then back to full speed.',
    setup: (t) => {
      t.seen.slow = false;
    },
    done: (t) => t.seen.slow && t.game.timeScale === 1 && !t.game.paused,
    target: (t) => (t.game.paused ? toolbarBtn('Toggle time') : toolbarBtn('Slow motion')),
  },
  {
    id: 'o-push',
    title: 'Push and pull',
    text: (t) =>
      `${t.touch ? '<b>Tools ⇄</b> on the right' : t.key('toolPower', '<b>Tools ⇄</b>')} switches to the powers. <b>Push</b> shoves things away and <b>Pull</b> draws them in: ` +
      `hold ${t.touch ? 'a finger' : 'the mouse button'} down. Try both.`,
    setup: (t) => {
      t.seen.powers.clear();
      if (t.all('crate').length < 3) t.stack('crate', t.game.renderer.camX + 1, 3);
    },
    done: (t) => t.seen.powers.has('push') && t.seen.powers.has('pull'),
    target: (t) => {
      const c = t.controls;
      if (c.tab !== 'powers') return q('.tool-tab');
      const want = !t.seen.powers.has('push') ? 'Push' : !t.seen.powers.has('pull') ? 'Pull' : null;
      return want && c.power !== want.toLowerCase() ? toolButton(want) : null;
    },
  },
  {
    id: 'o-lift',
    title: 'Lift',
    text: () => '<b>Lift</b> raises things up to where you point, and holds them there as long as you hold on.',
    done: (t) => t.seen.powers.has('lift'),
    target: (t) => (t.controls.tab !== 'powers' ? q('.tool-tab') : t.controls.power !== 'lift' ? toolButton('Lift') : null),
  },
  {
    id: 'o-lightning',
    title: 'Lightning',
    text: (t) => `<b>Lightning</b>: hold ${t.touch ? 'a finger' : 'the mouse button'} down and <b>flick</b> it. Bolts shock what they hit, and set things alight.`,
    setup: (t) => {
      t.memo.b = t.seen.bolts;
    },
    done: (t) => t.seen.bolts > t.memo.b,
    target: (t) => (t.controls.tab !== 'powers' ? q('.tool-tab') : t.controls.power !== 'lightning' ? toolButton('Lightning') : null),
  },
  {
    id: 'o-pyro',
    title: 'Pyrokinesis',
    text: () => '<b>Pyrokinesis</b> sets alight what you point at; flick it to throw flame.',
    done: (t) => {
      if (!t.seen.powers.has('pyro')) return false;
      // back to dragging things about
      t.controls.setTool('drag');
      return true;
    },
    target: (t) => (t.controls.tab !== 'powers' ? q('.tool-tab') : t.controls.power !== 'pyro' ? toolButton('Pyrokinesis') : null),
  },
  {
    id: 'o-maps',
    title: 'Other maps',
    text: () =>
      'The <b>map</b> button up top switches maps: a hangar, hills, rooftops, an arena, a plate that goes on for ever, and maps of your own. ' +
      'Pick one. (Switching clears the scene.)',
    setup: (t) => {
      t.controls.setTool('drag');
    },
    done: (t) => t.game.map.id !== LAB.id,
    target: () => (panelOpen('Maps') ? q('.overlay:not(.hidden) .map-card:not(.active)') : toolbarBtn('Maps')),
  },
  {
    id: 'o-terrain',
    title: 'Make your own ground',
    // (the endless plate has no ground to draw on: from there, another map first)
    text: (t) =>
      (t.game.map.endless ? `The ${ENDLESS.name.toLowerCase()} can’t be edited: in Maps, pick another map first. Then ` : 'In Maps, ') +
      `<b>Edit terrain</b>: ${drag(t)} out some ground (${t.touch ? 'the Remove tool' : 'a right-click'} takes it away), then <b>Done</b>. ` +
      'A map you change is kept in your maps.',
    done: (t) => {
      const ed = t.controls.terrain;
      // (the Terrain tool's: the map has been changed since editing began)
      if ((ed as { changed?: boolean } | null)?.changed) t.memo.drew = 1;
      // (the text changes as they leave the plate)
      const plate = t.game.map.endless ? 1 : 0;
      if (plate !== (t.memo.plate ?? -1)) {
        t.memo.plate = plate;
        t.refresh();
      }
      return !!t.memo.drew && !ed;
    },
    target: (t) =>
      t.controls.terrain
        ? q('.map-banner .panel-btn')
        : !panelOpen('Maps')
          ? toolbarBtn('Maps')
          : t.game.map.endless
            ? [...document.querySelectorAll('.overlay:not(.hidden) .map-card:not(.active)')].find((c) => c.querySelector('.map-name')?.textContent !== ENDLESS.name) ?? null
            : mapsBtn('Edit terrain'),
  },
  {
    id: 'o-end',
    title: 'World tour over',
    text: () => 'In Maps, <b>New map…</b> makes one any size you like, and <b>Export…</b> puts a map in a file to send to a friend.',
    info: 'Done!',
    alts: endAlts({
      label: 'Back to the Lab',
      action: (t) => {
        t.controls.terrain?.stop();
        t.controls.switchMap(LAB);
        t.stop();
      },
    }),
  },
];

// ---- editing and saving -----------------------------------------------------------------

/** Editing: select, move, copy, delete, undo, freeze, ghosts, flip, rotate, snap, resize, shapes, settings, keys, saving. */
export const EDITING: TutorialStep[] = [
  {
    id: 'e-hello',
    title: 'Editing & saving',
    text: () => 'The tools for arranging things just so: selecting, copying, freezing, turning, resizing, drawing, and keeping what you made.',
    info: 'Start',
  },
  {
    id: 'e-select',
    title: 'Select',
    text: (t) =>
      t.touch
        ? 'Tap a crate to select it (it’s outlined).'
        : '<b>Click</b> a crate to select it, <b>Shift+click</b> to add the others; or drag a box round all three, starting from empty space.',
    setup: (t) => {
      const x = t.game.renderer.camX;
      for (let i = 0; i < 3; i++) t.keep(`crate${i}`, t.put('crate', x + (i - 1) * 2.5));
      t.controls.clearSelection();
    },
    done: (t) => {
      const n = [0, 1, 2].filter((i) => {
        const c = t.ref(`crate${i}`);
        return !!c && t.controls.selection.has(c);
      }).length;
      return n >= (t.touch ? 1 : 3);
    },
    target: (t) => [0, 1, 2].map((i) => t.ref(`crate${i}`)).find((c) => c && !t.controls.selection.has(c)) ?? null,
  },
  {
    id: 'e-move',
    title: 'Move them together',
    text: () => 'Drag one of them: what’s selected goes with it.',
    setup: (t) => {
      for (let i = 0; i < 3; i++) {
        const c = t.ref(`crate${i}`);
        if (!c) continue;
        t.memo[`x${i}`] = c.center().x;
        t.memo[`y${i}`] = c.center().y;
      }
    },
    done: (t) => {
      const moved = (i: number) => {
        const c = t.ref(`crate${i}`);
        return !!c && Math.hypot(c.center().x - t.memo[`x${i}`], c.center().y - t.memo[`y${i}`]) > 1;
      };
      const all = [0, 1, 2].filter((i) => t.memo[`x${i}`] !== undefined);
      // (every one selected, or just the one if none is)
      const sel = all.filter((i) => {
        const c = t.ref(`crate${i}`);
        return !!c && t.controls.selection.has(c);
      });
      return all.some(moved) && sel.every(moved);
    },
    target: (t) => [...t.controls.selection][0] ?? t.ref('crate1'),
  },
  {
    id: 'e-copy',
    title: 'Copy and paste',
    text: (t) =>
      t.touch
        ? `${Menu(t)} a crate and choose <b>Duplicate</b>: a copy, right there.`
        : `${t.key('copy', '<kbd>C</kbd>')} copies what’s selected (or, with nothing selected, under the cursor), ${t.key('paste', '<kbd>V</kbd>')} pastes it where you point. ` +
          `(<kbd>Ctrl</kbd>+<kbd>D</kbd>, or ${menu(t)} → <b>Duplicate</b>, copies it in place.)`,
    setup: (t) => {
      t.memo.p = t.seen.pastes;
    },
    done: (t) => t.seen.pastes > t.memo.p,
    target: (t) => (q('.ctx') ? null : t.ref('crate1') ?? t.ref('crate0')),
    // (the usual Ctrl shortcuts work as well as People Playground's keys)
    allow: { actions: ['Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyD'] },
  },
  {
    id: 'e-delete',
    title: 'Delete',
    text: (t) =>
      t.touch
        ? 'Select a crate and tap <b>Delete</b> (or long-press it: Delete).'
        : `${t.key('delete', '<kbd>Delete</kbd>')} deletes what’s selected (or under the cursor); so does ${menu(t)} → <b>Delete</b>. Get rid of a crate or two.`,
    setup: (t) => {
      t.memo.n = t.all('crate').length;
    },
    done: (t) => t.all('crate').length < t.memo.n,
    target: (t) => (t.touch && t.controls.selection.size ? touchBtn('Delete') : q('.ctx') ? null : t.all('crate')[0] ?? null),
  },
  {
    id: 'e-undo',
    title: 'Undo, redo',
    text: (t) =>
      t.touch
        ? '<b>↶</b> up top undoes (back comes the crate), <b>↷</b> redoes. Try both.'
        : '<kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes (back comes the crate), <kbd>Ctrl</kbd>+<kbd>Y</kbd> redoes it. Try both.',
    setup: (t) => {
      t.memo.u = t.seen.undos;
      t.memo.r = t.seen.redos;
    },
    done: (t) => t.seen.undos > t.memo.u && t.seen.redos > t.memo.r,
    target: (t) => (t.seen.undos <= t.memo.u ? toolbarBtn('Undo') : toolbarBtn('Redo')),
  },
  {
    id: 'e-freeze',
    title: 'Freeze',
    text: (t) =>
      t.touch
        ? 'Stop time (<b>⏸</b>), lift the plank up into the air, tap <b>Freeze</b>, and start time again: frozen things stay put, mid-air.'
        : `Lift the plank up into the air and, still holding it, press ${t.key('freeze', '<kbd>Z</kbd>')} (or ${menu(t)} it → <b>Freeze</b>): ` +
          'frozen things stay put, mid-air.',
    setup: (t) => {
      t.keep('shelf', t.put('plank', shelfAt(t)));
    },
    done: (t) => {
      const s = t.ref('shelf');
      return !!s && s.frozen && s.center().y > WORLD.floor + 0.8;
    },
    target: (t) => t.ref('shelf'),
    skipped: (t) => {
      const s = t.ref('shelf') ?? t.keep('shelf', t.put('plank', shelfAt(t)));
      if (!s) return;
      if (s.center().y < WORLD.floor + 0.8) s.translate(0, WORLD.floor + 1.6 - s.center().y);
      s.setFrozen(true);
    },
  },
  {
    id: 'e-nocollide',
    title: 'Ghosts',
    text: (t) =>
      `${t.touch ? 'Long-press the crate on the plank and choose' : `Select the crate on the plank (click it) and press ${t.key('noCollide', '<kbd>N</kbd>')} (or ${menu(t)} it →`} ` +
      `<b>Disable collision</b>${t.touch ? '' : ')'}: it passes through other things. Down it drops, through the plank.`,
    setup: (t) => {
      // (what's selected is what the keys work on: the crates from before aren't the ones meant)
      t.controls.clearSelection();
      let s = t.ref('shelf');
      // (any crate ghosted counts, not only the one put on the plank: noted which already were)
      for (const e of t.game.entities) if (e.noCollide) t.memo[`n${e.id}`] = 1;
      if (!s || !s.frozen) {
        s = s ?? t.keep('shelf', t.put('plank', shelfAt(t)));
        if (s) {
          if (s.center().y < WORLD.floor + 0.8) s.translate(0, WORLD.floor + 1.6 - s.center().y);
          s.setFrozen(true);
        }
      }
      if (s) t.keep('ghost', t.put('crate', s.center().x, { dy: s.center().y + 0.1 - WORLD.floor }));
    },
    done: (t) => t.game.entities.some((e) => !e.destroyed && e.noCollide && !t.memo[`n${e.id}`]),
    target: (t) => (q('.ctx') ? null : t.ref('ghost')),
  },
  {
    id: 'e-flip',
    title: 'Flip',
    text: (t) =>
      t.touch
        ? 'Select something and tap <b>Flip</b>: it faces the other way.'
        : `${t.key('flip', '<kbd>R</kbd>')} flips what’s selected (or under the cursor) to face the other way; so does ${menu(t)} → <b>Flip</b>.`,
    setup: (t) => {
      t.memo.f = t.seen.flips;
    },
    done: (t) => t.seen.flips > t.memo.f,
    target: (t) => (t.touch && t.controls.selection.size ? touchBtn('Flip') : q('.ctx') ? null : t.ref('ghost') ?? t.all('crate')[0] ?? null),
  },
  {
    id: 'e-rotate',
    title: 'Turn',
    text: (t) =>
      t.touch
        ? 'Select something and tap <b>⟲</b> or <b>⟳</b> (hold them while you drag to turn what you hold). Turn something well round.'
        : `${t.key('rotateLeft', '<kbd>A</kbd>')} and ${t.key('rotateRight', '<kbd>D</kbd>')} turn what’s selected (with <kbd>Shift</kbd>, a quarter at a time), ` +
          'and turn what you’re dragging while you hold them. Turn something well round.',
    setup: (t) => {
      for (const e of t.game.entities) if (!e.destroyed && !e.frozen) t.memo[`a${e.id}`] = e.parts[0].a;
      t.memo.turned = t.seen.turned;
    },
    // (turned well round: in all by the keys, since a crate on the floor tips back flat, or as it now lies)
    done: (t) =>
      t.seen.turned - t.memo.turned > 0.7 ||
      t.game.entities.some((e) => {
        const a0 = t.memo[`a${e.id}`];
        return !e.destroyed && a0 !== undefined && Math.abs(wrapAngle(e.parts[0].a - a0)) > 0.7;
      }),
    target: (t) => (t.touch && t.controls.selection.size ? touchBtn('⟳') : t.controls.selection.size ? null : t.all('crate')[0] ?? null),
  },
  {
    id: 'e-snap',
    title: 'Line it up',
    text: (t) =>
      t.touch
        ? 'To place things exactly: stop time (<b>⏸</b>), turn on <b>Snap</b> on the bar that appears, then drag something: ' +
          'it keeps to a grid, and turns in whole steps. Start time again once it’s placed.'
        : `To place things exactly: stop time (${t.key('time', '<b>⏸</b>')}), then drag something while holding ${t.key('snap', '<kbd>Alt</kbd>')}: ` +
          'it keeps to a grid, and turns in whole steps. Start time again once it’s placed.',
    done: (t) => {
      const c = t.controls;
      // (the build bar's Snap on a touch screen is snapping always, as holding the key is with a mouse)
      if (t.game.paused && c.grab && (c.isHeld('snap') || c.arrange.settings.snapMode === 'always')) t.memo.snap = 1;
      return !!t.memo.snap && !t.game.paused;
    },
    target: (t) => {
      if (t.memo.snap) return t.game.paused ? toolbarBtn('Toggle time') : null;
      if (!t.game.paused) return toolbarBtn('Toggle time');
      return t.touch && t.controls.arrange.settings.snapMode !== 'always' ? touchBtn('Snap') : t.all('crate')[0] ?? null;
    },
  },
  {
    id: 'e-resize',
    title: 'Any size',
    text: (t) => `Select a crate: handles appear on its corners and sides. Drag one to make it bigger or smaller${t.touch ? '' : ' (Shift keeps its shape)'}.`,
    setup: (t) => {
      if (!t.all('crate').some((e) => !e.frozen)) t.keep('crate1', t.put('crate', t.game.renderer.camX));
    },
    done: (t) => t.all('crate').some((e) => e.config?.w !== undefined),
    target: (t) => (t.controls.selection.size ? null : t.all('crate').find((e) => !e.frozen) ?? null),
  },
  {
    id: 'e-shape',
    title: 'Draw your own',
    text: (t) => `${pick(t, 'shape', 'Shape')}: ${drag(t)} out a box to make a solid thing of your own${t.touch ? '' : ' (Shift: round)'}. Wood, metal, glass, rubber… are on the bar that appears.`,
    setup: (t) => {
      t.n = t.all('shape').length;
    },
    done: (t) => t.all('shape').length > t.n,
    target: (t) => withTool(t, 'shape', 'Shape', null),
  },
  {
    id: 'e-settings',
    title: 'Settings',
    text: () => '<b>Settings</b> (the cog up top): where things spawn, physics quality (lower it on a slow computer), sound and more. Open it, have a look, close it.',
    setup: (t) => {
      t.controls.setTool('drag');
    },
    done: (t) => onThenOff(t, panelOpen('Settings')),
    target: () => (panelOpen('Settings') ? q('.overlay:not(.hidden) .panel-close') : toolbarBtn('Settings')),
  },
  {
    id: 'e-keys',
    title: 'Your keys',
    text: (t) =>
      `<b>Controls</b> (${t.touch ? 'the <b>?</b> button' : t.key('help', 'the <b>?</b> button')}) lists every control, and lets you change any key: ` +
      'click it, then press the new one. Open it, then close it.',
    done: (t) => onThenOff(t, helpOpen()),
    target: () => (helpOpen() ? q('.overlay:not(.hidden) .help-panel .panel-close') : toolbarBtn('Controls')),
  },
  {
    id: 'e-save',
    title: 'Save it',
    text: (t) =>
      (t.touch
        ? 'The <b>save</b> button up top keeps the scene in this browser; <b>load</b> brings it back. '
        : '<kbd>Ctrl</kbd>+<kbd>S</kbd> keeps the scene in this browser; <kbd>Ctrl</kbd>+<kbd>O</kbd> brings it back. ') +
      'Save, knock something over, then load. (It replaces your last quick save.)',
    setup: (t) => {
      t.memo.s = t.seen.saves;
      t.memo.l = t.seen.loads;
    },
    done: (t) => t.seen.saves > t.memo.s && t.seen.loads > t.memo.l,
    target: (t) => (t.seen.saves <= t.memo.s ? toolbarBtn('Quick save') : toolbarBtn('Quick load')),
  },
  {
    id: 'e-end',
    title: 'All yours',
    text: (t) =>
      `${Menu(t)} a selection → <b>Save as contraption…</b> keeps it in the toybox, to spawn again any time. ` +
      'Settings has <b>Export scene…</b> and <b>Import…</b>, to keep scenes in files and send them to friends.',
    info: 'Done!',
    alts: endAlts(),
  },
];

// ---- animals ----------------------------------------------------------------------------

/** Animals: the dog, the cat, the fox, drugs and medicine on animals, their menu, the cow's kick, bacon. */
export const ANIMALS: TutorialStep[] = [
  {
    id: 'a-hello',
    title: 'Animals',
    text: () => 'Dogs, cats, pigs, foxes and cows: each has a way about it. Meet them.',
    info: 'Start',
  },
  spawnStep({
    id: 'a-spawn',
    title: 'Good dog',
    cat: 'Characters',
    pick: 'Dog',
    ids: ['dog'],
    name: 'dog',
    fallback: (t) => t.put('dog', t.game.renderer.camX),
  }),
  {
    id: 'a-walk',
    title: 'Walkies',
    text: () => 'Dogs follow people about. Drag the person a good way off (5 m or so) and let go: once they’re up, the dog trots after them.',
    setup: (t) => {
      const d = t.ref('dog') ?? t.keep('dog', t.put('dog', t.game.renderer.camX));
      if (!t.ref('owner')) t.keep('owner', t.put('human', beside(t, d, -2.5)));
      t.memo.x = d ? chestOf(d).x : 0;
    },
    // (after them: not just off on a wander of its own)
    done: (t) => {
      const d = t.ref('dog');
      if (d instanceof Creature && /following/.test(d.status())) t.memo.f = 1;
      return !!d && !!t.memo.f && Math.abs(chestOf(d).x - t.memo.x) > 2;
    },
    target: (t) => (t.memo.f || t.controls.grab ? null : t.ref('owner')),
    follow: (t) => {
      const d = t.ref('dog');
      return t.memo.f && d ? chestOf(d) : null;
    },
  },
  {
    id: 'a-cat',
    title: 'Cats land on their feet',
    text: () => 'Fling the <b>cat</b> (gently!): it twists round in the air and lands on its feet.',
    setup: (t) => {
      t.keep('cat', t.put('cat', beside(t, null, 2)));
    },
    done: (t) => {
      const c = t.ref('cat');
      if (!c) return false;
      if (t.speed(c) > 5) t.memo.flung = 1;
      // (down again and on its feet: still, or off on its way at a walk)
      return (
        !!t.memo.flung && !t.controls.grab && t.speed(c) < 1.5 && chestOf(c).y < WORLD.floor + 1 && !(c instanceof Creature && c.state !== 'stand')
      );
    },
    target: (t) => (t.memo.flung ? null : t.ref('cat')),
    // (watched down: flung hard, it can land a way off)
    follow: (t) => {
      const c = t.ref('cat');
      return t.memo.flung && c && !t.controls.grab ? chestOf(c) : null;
    },
  },
  {
    id: 'a-fox',
    title: 'Shy fox',
    // (a fox minds only people on their feet: someone dangling from the hand, or lying
    // where they were dropped, doesn't count until they're up)
    text: () => 'Foxes keep away from people. Bring a person over and set them down by the <b>fox</b>: once they’re up on their feet, off it runs.',
    setup: (t) => {
      // somewhere with room to run either way (not where the flung cat came down), and
      // out of the way of the dog's person (it keeps 3.5 m from anyone standing)
      // a few metres from the dog's person, on the side with more room, the view going
      // back over the both of them (it may have gone off after the cat)
      const o = t.ref('owner') ?? t.keep('owner', t.put('human', beside(t, t.ref('dog'), -2.5)));
      const ox = o && !o.destroyed ? o.center().x : t.game.renderer.camX;
      const side = ox < (WORLD.left + WORLD.right) / 2 ? 1 : -1;
      const cam = t.game.renderer.camX;
      const f = t.keep('fox', t.put('fox', openGround(t, [6, 7, 5, 8, -6, -7].map((d) => ox + side * d - cam), 2)));
      t.memo.x = f ? chestOf(f).x : 0;
      t.memo.cx = (ox + t.memo.x) / 2;
    },
    // (there, or the person in hand: the view is the player's again)
    follow: (t) => {
      if (t.controls.grab || Math.abs(t.game.renderer.camX - t.memo.cx) < 0.2) t.memo.there = 1;
      return t.memo.there ? null : { x: t.memo.cx, y: WORLD.floor + 3.2 };
    },
    // (off, or bolting a moment: the cat in its way, it may not get far)
    done: (t) => {
      const f = t.ref('fox');
      if (f instanceof Creature && /running/.test(f.status())) t.memo.run ??= t.game.time;
      return !f || Math.abs(chestOf(f).x - t.memo.x) > 2.5 || (t.memo.run !== undefined && t.game.time - t.memo.run > 0.7);
    },
    target: (t) => t.ref('fox'),
  },
  {
    id: 'a-adrenaline',
    title: 'Zoomies',
    text: () => 'Medicine works on animals too. Drag the <b>adrenaline</b> and push its needle into the dog, then watch it go.',
    setup: (t) => {
      // (on the dog's far side from its person: carried past them, their hand would take it)
      const d = t.ref('dog');
      const side = awayFromOwner(t, d);
      t.keep('adrenaline', t.put('syringe-adrenaline', beside(t, d, 1.3 * side), { flip: side > 0 }));
    },
    done: (t) => t.game.entities.some((e) => e instanceof Creature && !e.destroyed && e.drugs.adrenaline > 0),
    target: (t) => t.ref('adrenaline'),
    allow: MEDICINE,
  },
  {
    id: 'a-heal',
    title: 'The vet',
    text: () => 'Animals bleed and break like people. The dog’s been in the wars: drag the <b>first aid kit</b> onto it, and hold it there.',
    setup: (t) => {
      let d = t.ref('dog');
      if (!(d instanceof Creature) || !d.alive) d = t.keep('dog', t.put('dog', t.game.renderer.camX));
      if (d instanceof Creature) {
        // (still, a moment: on adrenaline it's off about the place)
        d.stay(6);
        d.blood = Math.min(d.blood, 70);
        const p = chestOf(d);
        d.damage(p, 12, 'stab', { x: p.x, y: p.y }, { x: 0, y: -1 });
      }
      t.keep('kit', t.put('first-aid-kit', beside(t, d, 1.5 * awayFromOwner(t, d))));
    },
    done: (t) => {
      const k = t.was('kit');
      return k instanceof FirstAidKit && k.uses < 3;
    },
    target: (t) => t.ref('kit'),
    allow: MEDICINE,
  },
  {
    id: 'a-menu',
    title: 'Their menu',
    text: (t) => `${Menu(t)} an animal: <b>Jump</b>, <b>Limp</b>, <b>Heal</b>, <b>Vitals</b>… (at the end of its menu). Select one to see how it’s doing.`,
    setup: (t) => {
      t.memo.m = t.seen.menus;
    },
    done: (t) => t.seen.menus > t.memo.m,
    target: (t) => (q('.ctx') ? null : t.ref('dog') ?? t.ref('cat')),
    allow: { menu: ['*'] },
  },
  {
    id: 'a-cow',
    title: 'Don’t startle a cow',
    text: (t) => `Cows kick out behind when something startles them. ${UseOn(t, 'the <b>pistol</b>')} behind it… and mind the crate.`,
    setup: (t) => {
      t.clean();
      const cow = t.keep('cow', t.put('cow', t.game.renderer.camX + 1));
      if (!(cow instanceof Creature)) return;
      // (standing still, facing away from where the shot comes from)
      cow.stay(60);
      const hips = cow.limbs.get('hips')?.part ?? cow.parts[0];
      const f = cow.facing;
      t.put('crate', hips.x - f * 0.8);
      t.keep('pistol', t.put('pistol', hips.x - f * 3.2, { flip: f > 0 }));
    },
    done: (t) => {
      const c = t.ref('cow');
      return !(c instanceof Creature) || /kicking|running/.test(c.status());
    },
    target: (t) => useAt(t, t.ref('pistol')),
  },
  {
    id: 'a-bacon',
    title: 'Bacon',
    text: (t) => `A big enough blast turns a pig into… bacon. ${UseOn(t, 'the <b>C4</b>')}.`,
    setup: (t) => {
      const pig = t.keep('pig', t.put('pig', beside(t, null, -5)));
      if (pig instanceof Creature) {
        pig.stay(60);
        t.keep('c4', t.put('c4', chestOf(pig).x + 0.8));
      }
    },
    done: (t) => t.all('bacon').length > 0,
    target: (t) => useAt(t, t.ref('c4')),
  },
  {
    id: 'a-end',
    title: 'Animal magic',
    text: () => 'Cows and pigs amble about on their own, and anything knocked over gets back up. Everything people get, animals get too: fire, acid, bullets, medicine.',
    info: 'Done!',
    alts: endAlts(),
  },
];

/** Tours on their way: shown in the Tutorials panel, not yet to be started. */
export const SOON: { title: string; blurb: string }[] = [
  { title: 'Fighting & armies', blurb: 'Make people fight, take sides, and line up armies for a battle.' },
];

/** Every tour, in the order they're offered (the basics first: the main menu marks it "new here?"). */
export const TOURS: Tour[] = [
  {
    id: 'basics',
    title: 'The basics',
    blurb: 'Spawn, throw, arm and blow things up, bend time and undo: the two-minute version of everything.',
    minutes: 3,
    steps: BASICS,
  },
  {
    id: 'people',
    title: 'People & medicine',
    blurb: 'Bones, blood and x-rays; then knives, swords and fire, and every cure: bandages, syringes, first aid, the defibrillator.',
    minutes: 10,
    steps: PEOPLE,
  },
  {
    id: 'weapons',
    title: 'Weapons & explosives',
    blurb: 'Guns on the floor and in hand, editing them, bats and knives, grenades, dynamite, C4, fuse cords, Molotovs, the RPG, the crossbow and a nuke.',
    minutes: 10,
    steps: WEAPONS,
  },
  {
    id: 'vehicles',
    title: 'Vehicles',
    blurb: 'Spawn a car, get in, drive, brake, change gear, steer with the keys, crash it; then aim and fire a tank.',
    minutes: 9,
    steps: VEHICLES,
  },
  {
    id: 'world',
    title: 'The world',
    blurb: 'Fire and how it spreads, water, oil, acid and buckets, stopping and slowing time, the five powers, other maps and your own ground.',
    minutes: 10,
    steps: WORLD_TOUR,
  },
  {
    id: 'editing',
    title: 'Editing & saving',
    blurb: 'Select, move, copy, delete, undo, freeze, ghosts, flip, turn, snap, resize and draw; then settings, your keys and saving.',
    minutes: 10,
    steps: EDITING,
  },
  {
    id: 'animals',
    title: 'Animals',
    blurb: 'Dogs that follow, cats that land on their feet, a shy fox, medicine for animals, a cow’s kick and a pig’s bacon.',
    minutes: 8,
    steps: ANIMALS,
  },
  {
    id: 'building',
    title: 'Building machines',
    blurb: 'Ropes, springs, hinges, pins, welds, wires, pulses and fuse cords; then a rocket, saved to the toybox and flown.',
    minutes: 8,
    steps: BUILDING,
  },
];

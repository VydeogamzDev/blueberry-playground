import type { Game } from '../world/Game';
import { POWERS, TOOLS, slotVariants, toolSlot, type Controls, type PowerId, type ToolId, type UIBridge, type ValueEditor } from '../tools/Controls';
import { ANGLE_STEPS, GRID_SIZES } from '../tools/Arrange';
import { SPRING_STIFFNESS, stiffnessStep } from '../systems/Connections';
import { ACTIONS, keyName, type ActionId, type ActionSpec } from '../tools/Bindings';
import { CATEGORIES, type Category, type ContextAction, type ItemDef } from '../world/types';
import { ITEMS } from '../catalog/items';
import { saveToString } from '../world/SaveLoad';
import { capture } from '../world/Snapshot';
import { Contraptions, thumbnail } from '../world/Contraptions';
import type { Entity } from '../world/Entity';
import { SHAPE_MATERIALS } from '../entities/Shape';
import { materialArt } from '../art/props';
import { blueprintIcon } from '../art/items';
import { PixelArt } from '../art/PixelArt';
import { FIXED_DT, GRAVITY } from '../engine/constants';
import { clamp } from '../engine/math';
import { GRAPHICS_RANGE, PRESETS, PRESET_NAMES, fpsLimit, loadGraphics, presetOf, saveGraphics, type FpsCap, type Graphics } from '../engine/Graphics';
import { DetailView } from './DetailView';
import { EditOverlay } from './EditOverlay';
import { XRay } from './XRay';
import { VitalsPanel } from './VitalsPanel';
import { MapsPanel } from './MapsPanel';
import { ArmyPanel } from './ArmyPanel';
import { MainMenu } from './MainMenu';
import { Tutorial } from './Tutorial';
import { TutorialsPanel } from './TutorialsPanel';
import { StatsPanel } from './StatsPanel';
import { MultiplayerPanel, RemoteCursors } from './Multiplayer';
import { FriendsPanel } from './FriendsPanel';
import { Layout } from './Layout';
import { Session } from '../net/Session';
import { Friends } from '../net/Friends';
import { store } from '../engine/Store';
import { desktop } from '../engine/Desktop';
import { savesSettings } from './SavesSettings';
import { rapierBuild } from '../engine/Physics';
import { version } from '../../package.json';

const ICONS: Record<string, string> = {
  pause: '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>',
  step: '<svg viewBox="0 0 16 16"><path d="M3 3l7 5-7 5z"/><rect x="11" y="3" width="2" height="10"/></svg>',
  slow: '<svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 2v4l3 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  undo: '<svg viewBox="0 0 16 16"><path d="M5 3L2 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  redo: '<svg viewBox="0 0 16 16"><path d="M11 3l3 3-3 3M13.5 6H6a3.5 3.5 0 0 0 0 7h4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  reset: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2v3h3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  save: '<svg viewBox="0 0 16 16"><path d="M3 2h8l2 2v10H3zM5 2v4h5V2M5 10h6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  load: '<svg viewBox="0 0 16 16"><path d="M2 5h4l1 1h7v7H2zM8 12V8m-2 2l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  settings: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4l1.6 1.6M11 11l1.6 1.6M3.4 12.6L5 11M11 5l1.6-1.6" stroke="currentColor" stroke-width="1.5"/></svg>',
  help: '<svg viewBox="0 0 16 16"><path d="M5.5 6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V11" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7.2" y="12.4" width="1.6" height="1.6"/></svg>',
  tutorial: '<svg viewBox="0 0 16 16"><path d="M8 3 1 6.5 8 10l7-3.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 8.2v3.1c1 1 2.4 1.5 4 1.5s3-.5 4-1.5V8.2M14.3 6.6v4.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  xray: '<svg viewBox="0 0 16 16"><circle cx="3.2" cy="4.8" r="1.7"/><circle cx="4.8" cy="3.2" r="1.7"/><circle cx="11.2" cy="12.8" r="1.7"/><circle cx="12.8" cy="11.2" r="1.7"/><path d="M3.6 5.8l2.2-2.2 6.6 6.6-2.2 2.2z"/></svg>',
  detail: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="4" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="4" width="6.5" height="1"/><path d="M8 8.5v6M5 11.5h6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  catalog: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg>',
  net: '<svg viewBox="0 0 16 16"><circle cx="5" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 13c0-2.2 1.6-3.6 3.5-3.6S8.5 10.8 8.5 13M7.5 13c0-2.2 1.6-3.6 3.5-3.6s3.5 1.4 3.5 3.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  home: '<svg viewBox="0 0 16 16"><path d="M2 8l6-5.5L14 8M4 6.5V14h3v-4h2v4h3V6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  map: '<svg viewBox="0 0 16 16"><path d="M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5zM5.5 2v10.5M10.5 3.5V14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  battle: '<svg viewBox="0 0 16 16"><path d="M2.5 2.5l8 8M13.5 2.5l-8 8M9.5 11.5l3 3M6.5 11.5l-3 3M11 13l2-2M5 13l-2-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  drag: '<svg viewBox="0 0 16 16"><path d="M4 1.5v10.5l2.6-2.4 1.9 4.6 2-.9-1.9-4.4H12z"/></svg>',
  rewind: '<svg viewBox="0 0 16 16"><path d="M8 3L2 8l6 5zM14 3L8 8l6 5z"/></svg>',
  push: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="1.8"/><path d="M8 5V1M8 11v4M5 8H1M11 8h4M6.5 2.5L8 1l1.5 1.5M6.5 13.5L8 15l1.5-1.5M2.5 6.5L1 8l1.5 1.5M13.5 6.5L15 8l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  pull: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="1.8"/><path d="M8 1v4M8 15v-4M1 8h4M15 8h-4M6.5 3.5L8 5l1.5-1.5M6.5 12.5L8 11l1.5 1.5M3.5 6.5L5 8 3.5 9.5M12.5 6.5L11 8l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  lift: '<svg viewBox="0 0 16 16"><path d="M8 13V3M4.5 6.5L8 3l3.5 3.5M3 14.5h10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  lightning: '<svg viewBox="0 0 16 16"><path d="M9.5 1L3 9.5h4.2L6 15l7-8.5H8.6z"/></svg>',
  pyro: '<svg viewBox="0 0 16 16"><path d="M8 1c.6 2.6 4.5 4.2 4.5 8.2a4.5 4.5 0 0 1-9 0c0-2 1-3.3 2.2-4.3 0 1.8.8 2.9 1.9 3.3C6.9 6 8.4 4.3 8 1z"/></svg>',
};

const SPEEDS = [0.05, 0.1, 0.2, 0.5, 1];
/** Screens narrower than this (CSS px) get the compact layout. */
const NARROW = 700;
/** Or shorter than this: a phone on its side (the style sheet's max-height: 520px). */
const SHORT = 520;
/** A phone's screen, upright or on its side: the toybox starts folded, and the tools show only the one in use until tapped. */
const compact = () => window.innerWidth < NARROW || window.innerHeight < SHORT;

/** The tool bar's tools and powers: names and what they do (the connection tools' come from the catalog). */
const TOOL_INFO: Record<'drag' | PowerId, { name: string; desc: string }> = {
  drag: { name: 'Drag', desc: 'Drag and rotate objects (A / D while dragging)' },
  push: { name: 'Push', desc: 'Pushes things away from the cursor' },
  pull: { name: 'Pull', desc: 'Pulls things in to the cursor' },
  lift: { name: 'Lift', desc: 'Lifts things up to the cursor’s height' },
  lightning: { name: 'Lightning', desc: 'Flick the mouse to throw lightning that way' },
  pyro: { name: 'Pyrokinesis', desc: 'Sets things alight; flick the mouse to throw flame' },
};

/** Settings' gravities (m/s², downward negative). */
const GRAVITIES: [number, string][] = [
  [0, 'None (everything floats)'], [-1.62, 'Moon'], [-3.71, 'Mars'], [GRAVITY, 'Earth'], [-19.62, 'Double'], [-24.79, 'Jupiter'],
];

const GROUPS: ActionSpec['group'][] = ['General', 'Tools', 'Building', 'Interface', 'Camera', 'Vehicles'];

const TOUCH_HELP: [string, string][] = [
  ['Drag an object', 'Grab and drag it'],
  ['Tap empty space', 'Spawn the selected toybox item, or deselect'],
  ['Drag empty space', 'Pan camera'],
  ['Two fingers', 'Pinch to zoom, drag to pan'],
  ['Long press', 'Context menu (on empty space while spawning: stop spawning)'],
  ['Tool bar (right)', 'Drag, connection tools and powers'],
  ['Bottom bar', 'Use, freeze, rotate (hold while dragging), flip, delete the selected object'],
  ['Build bar (time paused, or a connection tool in hand)', 'Snap to the grid · Free: the next end exactly under the ring · Chain: connections carry on from where each ended · Alone: move just what you drag · ✓ ✕: place or drop what you’re placing · ⟲: back to build'],
  ['Long press a connection', 'Its menu: length, strength, hide, swing limit...'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** The scene carried over a restart after the physics engine broke (see UI.halted()), in the page's session storage. */
export const CARRY_ON = 'blueberry-carry-on';

/** What broke the physics engine, for the player to send in: the version, the physics build, the browser, the error and where. */
function haltDetails(e: unknown): string {
  const stack = e instanceof Error && e.stack ? e.stack.split('\n').slice(1).map((s) => s.trim()) : [];
  // (the engine's own calls have no names: how many, then the game's that led to them, without the site's address)
  const inside = stack.filter((s) => s.includes('wasm-function')).length;
  const calls = stack.filter((s) => !s.includes('wasm-function')).slice(0, 16).map((s) => s.replace(/(https?|app|file):\/\/[^/\s)]*\//g, ''));
  return [
    `Blueberry Playground ${version}${desktop ? ` desktop (Electron ${desktop.electron})` : ''}, physics: ${rapierBuild}`,
    navigator.userAgent,
    String(e),
    ...(inside ? [`(${inside} calls inside the physics engine)`] : []),
    ...calls,
  ].join('\n');
}

export class UI implements UIBridge {
  private game: Game;
  private controls: Controls;
  private root: HTMLElement;
  private catalog!: HTMLDivElement;
  private strip!: HTMLDivElement;
  private grid!: HTMLDivElement;
  private search!: HTMLInputElement;
  private catTitle!: HTMLDivElement;
  private category: Category = 'Characters';
  private itemEls = new Map<string, HTMLElement>();
  private ctx: HTMLDivElement | null = null;
  private help!: HTMLDivElement;
  private helpBox!: HTMLDivElement;
  private settings!: HTMLDivElement;
  private netPanel!: HTMLDivElement;
  private btnNet!: HTMLButtonElement;
  private cursors: RemoteCursors;
  /** Multiplayer: hosting a game, or in someone else's. */
  readonly session: Session;
  /** The friends list (who you are to them, who's online, their games). */
  readonly friends = new Friends();
  private friendsOverlay!: HTMLDivElement;
  private friendsPanel!: FriendsPanel;
  private pauseMenu!: HTMLDivElement;
  /** An object's edit panel, while one is open (see editValues()). */
  private editor: HTMLDivElement | null = null;
  /** Whether what the edit panel edits is still about (see ValueEditor.alive). */
  private editorAlive: (() => boolean) | null = null;
  /** Whether time was paused before the pause menu opened (it pauses it). */
  private pausedBefore = false;
  /** The panel keeping time stopped: the pause menu, or a panel opened from it (Controls, Settings...). */
  private pauseHolder: HTMLDivElement | null = null;
  private status!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private toastTimer = 0;
  private btnPause!: HTMLButtonElement;
  private btnStep!: HTMLButtonElement;
  private btnSlow!: HTMLButtonElement;
  private btnUndo!: HTMLButtonElement;
  private btnRedo!: HTMLButtonElement;
  /** ⟲ Back to build: shown after time is started on something built (see History.rewindDepth). */
  private btnRewind!: HTMLButtonElement;
  private btnHelp!: HTMLButtonElement;
  private btnXray!: HTMLButtonElement;
  private btnDetail!: HTMLButtonElement;
  private speedSel!: HTMLSelectElement;
  private catalogOpen = true;
  /** Tab (toybox) hid the catalog and the tool bar. */
  private toyboxHidden = false;
  private tools!: HTMLDivElement;
  private toolTab!: HTMLButtonElement;
  private toolLists = new Map<'tools' | 'powers', HTMLDivElement>();
  private toolBtns = new Map<string, HTMLButtonElement>();
  private touchBar!: HTMLDivElement;
  private btnFreeze!: HTMLButtonElement;
  /** The drive buttons at the screen's sides (a vehicle selected on a touch screen), and a tank's aim ones among them. */
  private drivePad!: HTMLDivElement;
  private aimBtns: HTMLButtonElement[] = [];
  private matBar!: HTMLDivElement;
  private matBtns = new Map<string, HTMLButtonElement>();
  /** Under the tool bar: the kinds of the slot in hand (Rope, Fuse cord), or the Spring's stiffnesses. */
  private varBar!: HTMLDivElement;
  private varBtns = new Map<string, HTMLButtonElement>();
  private springBtns: HTMLButtonElement[] = [];
  /** The touch bar for building: the modifier keys a finger hasn't got (see buildTouchBar()). */
  private buildBar!: HTMLDivElement;
  private buildBtns: { b: HTMLButtonElement; on?: () => boolean; show?: () => boolean }[] = [];
  /** Settings › Building, shown as the settings are now (they change by key too). */
  private showBuilding: () => void = () => {};
  private detailView: DetailView;
  private editOverlay: EditOverlay;
  private xray: XRay;
  /** The vital signs of the selected (or pinned) person or animal. */
  readonly vitals: VitalsPanel;
  /** The maps to play on, and editing them (the toolbar's map button). */
  readonly maps: MapsPanel;
  /** Sides lined up to fight each other (the toolbar's battle button, and the pause menu). */
  readonly army: ArmyPanel;
  /** The title screen: main.ts puts it up as the game starts; the pause menu's Main menu brings it back. */
  readonly mainMenu: MainMenu;
  readonly tutorial: Tutorial;
  /** Every guided tour, to pick one (the pause menu's Tutorials…, the toolbar's cap). */
  readonly tutorials: TutorialsPanel;
  /** What the player has done, counted (the pause menu's Statistics…). */
  readonly statsPanel: StatsPanel;
  /** The player's saved contraptions (the toybox's Contraptions). */
  readonly contraptions = new Contraptions();
  /** Where the pieces of the interface go, and the player's layouts of them (Edit layout: see Layout). */
  readonly layout: Layout;
  /** The command whose key the Controls panel is waiting for. */
  private binding: ActionId | null = null;
  /** The key awaited is added to the command's keys (its +), rather than replacing them. */
  private bindingAdd = false;
  /** Closes the open dialog (Save as contraption, Rename, Delete…), if there is one. */
  private dialogClose: (() => void) | null = null;
  /** What the Controls panel's search box holds (kept while the panel is drawn afresh). */
  private helpQuery = '';
  /** The graphics and physics settings (Settings > Graphics, Physics), kept in the browser. */
  readonly gfx: Graphics = loadGraphics();
  /** Applies the iterations that count now (a guest's are the host's) and shows them in Settings. */
  syncIterations: () => void = () => {};
  /** Shows the graphics settings in Settings (which preset they are, or Custom). */
  private showGraphics: () => void = () => {};
  /** The player's own gravity (Settings > Physics; not kept: every visit starts on Earth). */
  ownGravity = GRAVITY;
  /** The host's gravity last shown in Settings (null: our own). */
  private gravityShown: number | null = null;
  private showGravity: () => void = () => {};
  /** Shows the weather and light in Settings > World as they are (a map's, a load's, the host's). */
  private showWorld: () => void = () => {};
  /** The weather last shown there, and whether it was a guest's (set by the host). */
  private worldShown: unknown = null;
  private worldGuest = false;
  /** The host's iterations last applied (0: none, playing alone or hosting). */
  private itersShown = 0;
  showStats = true;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.root = root;
    controls.ui = this;
    this.session = new Session(game, controls);
    // (made first, for Settings' row of layouts; it finds the pieces once they're all built: see attach() below)
    this.layout = new Layout(root, {
      toast: (msg) => this.toast(msg),
      dialog: (title, text, value, okLabel, ok) => this.dialog(title, text, value, okLabel, ok),
      download: (name, text) => this.download(name, text),
      changed: () => this.updateInset(true),
      click: () => this.game.sound.ui('click'),
    });
    this.buildCatalog();
    this.buildToolbar();
    this.buildTools();
    this.buildHelp();
    this.buildSettings();
    this.applyGraphics();
    this.buildFriends();
    this.buildMultiplayer();
    // (before the pause menu, which shows a line of it)
    this.statsPanel = new StatsPanel(game, root, { close: () => this.hide(this.statsPanel.overlay) });
    this.buildPauseMenu();
    this.buildTouchBar();
    this.detailView = new DetailView(game, controls, root);
    this.editOverlay = new EditOverlay(game, controls, root);
    // (under the detail view's bars)
    this.xray = new XRay(game, controls, root);
    this.vitals = new VitalsPanel(game, controls, root);
    this.cursors = new RemoteCursors(game, this.session, root);
    this.maps = new MapsPanel(game, controls, root, {
      toast: (msg) => this.toast(msg),
      dialog: (title, text, value, okLabel, ok) => this.dialog(title, text, value, okLabel, ok),
      download: (name, text) => this.download(name, text),
    });
    this.army = new ArmyPanel(game, controls, root, { toast: (msg) => this.toast(msg), close: () => this.hide(this.army.overlay) });
    this.tutorials = new TutorialsPanel(game, root, {
      tours: () => this.tutorial.tours(),
      start: (id) => this.startTour(id),
      close: () => this.hide(this.tutorials.overlay),
    });
    this.mainMenu = new MainMenu(game, controls, root, {
      maps: () => {
        this.maps.render();
        this.toggle(this.maps.overlay);
      },
      mapsOpen: () => !this.maps.overlay.classList.contains('hidden'),
      settings: () => this.toggle(this.settings),
      help: () => this.toggle(this.help),
      closeOverlays: () => {
        this.closeContextMenu();
        return this.closeOverlays();
      },
    }, {
      multiplayer: () => this.toggle(this.netPanel),
      tutorial: {
        tours: () => this.tutorial.tours(),
        start: (id) => this.tutorial.start(id),
        fresh: () => !this.tutorial.had,
      },
      friends: () => this.toggle(this.friendsOverlay),
      // (the desktop app's window can close itself)
      quit: desktop ? () => window.close() : undefined,
    });
    // (no time played while the title screen is up)
    game.stats.inMenu = () => this.mainMenu.open;
    game.onHalt = (e) => this.halted(e);
    this.tutorial = new Tutorial(game, controls, root, {
      contraptions: () => this.contraptions.items().length,
      tutorials: () => this.showTutorials(),
    });
    this.contraptions.onChange = () => {
      // a renamed one is a new toybox item; a deleted one can't be spawned
      // (arm() takes the same item again as deselecting it: another one saved or deleted leaves this one be)
      const armed = controls.armed;
      const now = armed?.snapshot ? this.contraptions.items().find((d) => d.id === armed.id) ?? null : armed;
      if (now !== armed) controls.arm(now);
      if (this.category === 'Contraptions' || this.search.value) this.renderItems();
    };
    this.status = el('div', 'status');
    this.hintEl = el('div', 'hint');
    this.toastEl = el('div', 'toast');
    root.append(this.status, this.hintEl, this.toastEl);
    this.layout.attach();
    // a button clicked doesn't keep the focus: Space after clicking Clear must pause, not clear again
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest?.('button')) e.preventDefault();
    });
    // keep UI clicks from reaching the canvas handlers
    for (const ev of ['pointerdown', 'wheel', 'contextmenu'] as const) {
      root.addEventListener(ev, (e) => {
        if (e.target !== root) e.stopPropagation();
      });
    }
    controls.bindings.onChange = () => {
      this.renderHelp();
      this.refreshKeyHints();
    };
    this.refreshKeyHints();
    // Edit layout's key (Controls leaves it to the interface): opens it, or finishes it
    window.addEventListener('keydown', (e) => {
      if (e.repeat || !controls.bindings.actionsFor(e.code).includes('layout')) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || this.dialogClose) return;
      if (this.layout.editing) this.layout.done();
      else if (!this.isPanelOpen() && !this.mainMenu.open) this.editLayout();
      else return;
      e.preventDefault();
    });
    game.frameHandlers.push((dt, alpha) => this.frame(dt, alpha));
    // a phone starts with the catalog folded away and the touch layout on
    if (compact()) this.toggleCatalog();
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      controls.touchMode = true;
      this.setTouchMode(true);
    }
    // (an iPhone zooms the page at a pinch, whatever the viewport says: a pinch is the sandbox's own zoom)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // the camera centers on the part of the screen the catalog leaves free
    this.updateInset(false);
    window.addEventListener('resize', () => this.updateInset(false));
  }

  // ---- catalog (the toybox) --------------------------------------------------------

  private buildCatalog(): void {
    this.catalog = el('div', 'catalog');
    this.strip = el('div', 'cat-strip');
    const toggle = el('button', 'cat-btn cat-toggle', ICONS.catalog);
    toggle.title = 'Fold the toybox';
    toggle.onclick = () => this.toggleCatalog();
    this.strip.appendChild(toggle);
    for (const c of CATEGORIES) {
      // (the connection tools are on the tool bar; Contraptions is there even before any are saved)
      const items = ITEMS.filter((i) => i.category === c.id && !i.tool && !i.hidden);
      const mine = c.id === 'Contraptions';
      if (!items.length && !mine) continue;
      const b = el('button', 'cat-btn');
      b.title = c.label;
      b.dataset.cat = c.id;
      const icon = mine ? blueprintIcon().toCanvas(1) : items[0].preview();
      const img = document.createElement('canvas');
      img.width = icon.width;
      img.height = icon.height;
      img.getContext('2d')!.drawImage(icon, 0, 0);
      img.className = 'cat-icon';
      let sc = Math.min(3, 26 / Math.max(icon.width, icon.height));
      if (sc >= 2) sc = Math.floor(sc);
      img.style.width = icon.width * sc + 'px';
      img.style.height = icon.height * sc + 'px';
      b.appendChild(img);
      b.onclick = () => {
        if (this.category === c.id && this.catalogOpen && !this.search.value) this.toggleCatalog();
        else {
          this.search.value = '';
          this.setCategory(c.id);
          if (!this.catalogOpen) this.toggleCatalog();
        }
      };
      this.strip.appendChild(b);
    }
    const panel = el('div', 'cat-panel');
    this.search = el('input', 'search');
    this.search.placeholder = 'Search…';
    this.search.spellcheck = false;
    this.search.oninput = () => this.renderItems();
    this.search.onkeydown = (e) => {
      if (e.key === 'Escape') {
        this.search.value = '';
        this.search.blur();
        this.renderItems();
      }
      e.stopPropagation();
    };
    this.catTitle = el('div', 'cat-title');
    this.grid = el('div', 'items');
    panel.append(this.search, this.catTitle, this.grid);
    this.catalog.append(this.strip, panel);
    this.root.appendChild(this.catalog);
    this.setCategory(this.category);
  }

  private setCategory(c: Category): void {
    this.category = c;
    for (const b of this.strip.querySelectorAll<HTMLButtonElement>('.cat-btn[data-cat]')) b.classList.toggle('active', b.dataset.cat === c);
    this.renderItems();
  }

  private renderItems(): void {
    const q = this.search.value.trim().toLowerCase();
    const all = [...ITEMS.filter((i) => !i.tool && !i.hidden), ...this.contraptions.items()];
    // (by every word typed, in its name, its shelf as shown (Firearms) or as kept (Weapons), or its tags)
    const words = q.split(/\s+/).filter(Boolean);
    const shelf = (c: Category) => `${c} ${CATEGORIES.find((x) => x.id === c)?.label ?? ''}`;
    const list = q
      ? all.filter((i) => {
        const text = `${i.name} ${shelf(i.category)} ${(i.tags ?? []).join(' ')}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      : all.filter((i) => i.category === this.category);
    this.catTitle.textContent = q ? `Search: ${list.length} result${list.length === 1 ? '' : 's'}` : CATEGORIES.find((c) => c.id === this.category)!.label;
    this.grid.innerHTML = '';
    this.itemEls.clear();
    if (!q && this.category === 'Contraptions') {
      if (!list.length) {
        this.grid.appendChild(el('div', 'items-note', 'Build something, select it all, right-click it and choose <b>Save as contraption…</b>: it appears here to spawn again (Q / E, like anything else). Right-click one here to rename, export or delete it.'));
      }
      const imp = el('button', 'items-btn', 'Import a contraption file…');
      imp.onclick = () => this.importFile();
      this.grid.appendChild(imp);
    }
    for (const def of list) {
      const tile = el('div', 'item');
      tile.title = def.description;
      // (what it is, for a tutorial step that greys out the toys it isn't about)
      tile.dataset.id = def.id;
      tile.dataset.cat = def.category;
      const box = el('div', 'item-preview');
      if (def.thumb) {
        const img = el('img', 'item-thumb');
        img.src = def.thumb;
        img.alt = '';
        box.appendChild(img);
      } else {
        const src = def.preview();
        const cv = document.createElement('canvas');
        cv.width = src.width;
        cv.height = src.height;
        cv.getContext('2d')!.drawImage(src, 0, 0);
        // integer-scale previews to fit the tile (long thin items fill the width)
        let scale = Math.min(4, 62 / Math.max(src.width, src.height * 1.15));
        if (scale >= 2) scale = Math.floor(scale);
        cv.style.width = src.width * scale + 'px';
        cv.style.height = src.height * scale + 'px';
        box.appendChild(cv);
      }
      const name = el('div', 'item-name');
      name.textContent = def.name;
      tile.append(box, name);
      if (def.snapshot) {
        tile.oncontextmenu = (e) => {
          e.preventDefault();
          this.contraptionMenu(def, e.clientX, e.clientY);
        };
      }
      tile.onclick = () => {
        this.game.sound.unlock();
        this.game.sound.ui('select');
        this.controls.arm(def);
        // on a small screen the catalog covers the sandbox: fold it to place the item
        if (this.controls.armed && this.catalogOpen && (this.controls.touchMode || window.innerWidth < NARROW)) this.toggleCatalog();
      };
      this.grid.appendChild(tile);
      this.itemEls.set(def.id, tile);
    }
    this.onArmedChanged(this.controls.armed);
  }

  onArmedChanged(def: ItemDef | null): void {
    for (const [id, e] of this.itemEls) e.classList.toggle('armed', def?.id === id);
  }

  toggleCatalog(): void {
    this.catalogOpen = !this.catalogOpen;
    this.catalog.classList.toggle('collapsed', !this.catalogOpen);
    this.updateInset(true);
  }

  toggleToybox(): void {
    this.toyboxHidden = !this.toyboxHidden;
    this.catalog.classList.toggle('hidden', this.toyboxHidden);
    this.tools.classList.toggle('hidden', this.toyboxHidden);
    this.updateInset(true);
  }

  toggleInterface(): void {
    this.root.classList.toggle('ui-hidden');
    this.updateInset(true);
  }

  /** Tells the renderer how much of the screen the catalog covers (on the side the layout docks it: see Layout). */
  private updateInset(keepView: boolean): void {
    const hidden = this.toyboxHidden || this.root.classList.contains('ui-hidden');
    const { left, right } = this.layout.toyboxInset(hidden ? null : this.catalogOpen ? this.catalog : this.strip);
    this.game.renderer.setInsets(left, right, keepView);
  }

  // ---- toolbar -----------------------------------------------------------------

  private buildToolbar(): void {
    const bar = el('div', 'toolbar');
    const btn = (icon: string, title: string, fn: () => void) => {
      const b = el('button', 'tb-btn', ICONS[icon]);
      b.title = title;
      b.onclick = () => {
        this.game.sound.unlock();
        this.game.sound.ui('click');
        fn();
        // (left focused, Enter would press it again: Clear everything or Quick load a second time)
        b.blur();
      };
      bar.appendChild(b);
      return b;
    };
    this.btnPause = btn('pause', 'Toggle time', () => this.controls.togglePause());
    this.btnStep = btn('step', 'Step one tick', () => this.controls.step());
    this.btnRewind = btn('rewind', 'Back to build: the scene as it was before Play (Shift + Toggle time)', () => this.controls.rewind());
    this.btnRewind.classList.add('hidden');
    this.btnSlow = btn('slow', 'Slow motion', () => this.controls.toggleSlowMotion());
    this.speedSel = el('select', 'tb-select');
    this.speedSel.title = 'Simulation speed';
    for (const s of SPEEDS) {
      const o = el('option');
      o.value = String(s);
      o.textContent = `${s}×`;
      this.speedSel.appendChild(o);
    }
    this.speedSel.onchange = () => {
      this.controls.setTimeScale(parseFloat(this.speedSel.value));
      // (left focused, it would take the keys: Space opening it, the arrows changing the speed)
      this.speedSel.blur();
    };
    bar.appendChild(this.speedSel);
    bar.appendChild(el('div', 'tb-sep'));
    this.btnUndo = btn('undo', 'Undo (Ctrl+Z)', () => this.controls.undo());
    this.btnRedo = btn('redo', 'Redo (Ctrl+Y)', () => this.controls.redo());
    // (liquid on the floor, stains, fires and drops in the air go too: an empty scene)
    btn('clear', 'Clear everything (objects, liquids, stains, fire)', () => {
      this.controls.clearScene('Clear all');
      this.toast('Cleared everything');
    });
    btn('reset', 'Reset environment (objects, stains, effects)', () => {
      this.controls.clearScene('Reset');
      const home = this.game.home();
      this.game.renderer.camX = home.x;
      this.game.renderer.camY = home.y;
      this.toast('Environment reset');
    });
    bar.appendChild(el('div', 'tb-sep'));
    btn('save', 'Quick save (Ctrl+S)', () => this.save());
    btn('load', 'Quick load (Ctrl+O)', () => this.load());
    btn('map', 'Maps: switch, make and edit them', () => {
      this.maps.render();
      this.toggle(this.maps.overlay);
    });
    btn('battle', 'Battle: line up armies to fight each other', () => this.openArmy());
    bar.appendChild(el('div', 'tb-sep'));
    this.btnXray = btn('xray', 'X-ray', () => this.controls.command('xray'));
    // (a touch screen has no key for it)
    this.btnDetail = btn('detail', 'Detail view: every limb’s health, and how far blasts reach', () => this.controls.command('detail'));
    this.btnDetail.classList.add('touch-only');
    this.btnNet = btn('net', 'Multiplayer', () => this.toggle(this.netPanel));
    btn('settings', 'Settings', () => this.toggle(this.settings));
    btn('tutorial', 'Tutorials: guided tours of everything', () => this.showTutorials());
    this.btnHelp = btn('help', 'Controls', () => this.toggleHelp());
    // (a phone has no Esc: the way back to the title screen)
    btn('home', 'Main menu', () => this.mainMenu.show());
    this.root.appendChild(bar);
    // (what sits under it on a phone, where it wraps to rows, goes by where it ends)
    new ResizeObserver(() => this.root.style.setProperty('--tb-bottom', `${Math.round(bar.getBoundingClientRect().bottom)}px`)).observe(bar);
    this.refreshToolbar();
  }

  /** Tooltips that name keys follow the bindings. */
  private refreshKeyHints(): void {
    const b = this.controls.bindings;
    const with_ = (text: string, id: ActionId) => (b.label(id) ? `${text} (${b.label(id)})` : text);
    this.btnPause.title = with_('Toggle time', 'time');
    this.btnStep.title = with_('Step one tick', 'step');
    this.btnSlow.title = with_('Slow motion', 'slowmo');
    this.btnHelp.title = with_('Controls', 'help');
    this.btnXray.title = with_('X-ray: see the bones of people and animals', 'xray');
    this.toolTab.title = with_('Switch between tools and powers', 'toolPower');
    for (const [id, btn] of this.toolBtns) {
      const slot = (TOOLS as string[]).includes(id) ? TOOLS.indexOf(id as ToolId) : POWERS.indexOf(id as PowerId);
      const key = slot < 9 ? b.label(`tool${slot + 1}` as ActionId) : '';
      btn.querySelector('.tool-key')!.textContent = key;
      btn.title = `${btn.dataset.name}${key ? ` (${key})` : ''}: ${btn.dataset.desc}`;
    }
  }

  // ---- tool bar (tools and powers) --------------------------------------------------

  private buildTools(): void {
    this.tools = el('div', 'tools');
    this.toolTab = el('button', 'tool-tab');
    this.toolTab.onclick = () => {
      this.game.sound.ui('click');
      this.controls.toggleTab();
    };
    this.tools.appendChild(this.toolTab);
    const add = (tab: 'tools' | 'powers', ids: string[]) => {
      const list = el('div', 'tool-list');
      for (const id of ids) {
        const def = ITEMS.find((i) => i.tool === id);
        const info = def ? { name: def.name, desc: def.description } : TOOL_INFO[id as 'drag' | PowerId];
        const b = el('button', 'tool-btn', ICONS[id] ?? '');
        b.dataset.name = info.name;
        b.dataset.desc = info.desc;
        if (tab === 'tools') {
          b.dataset.tool = id;
          // (every kind its key picks, for finding it by any of their names)
          b.dataset.names = slotVariants(id as ToolId).map((v) => ITEMS.find((i) => i.tool === v)?.name ?? v).join('|');
        } else b.dataset.power = id;
        if (def) {
          const src = def.preview();
          const cv = document.createElement('canvas');
          cv.width = src.width;
          cv.height = src.height;
          cv.getContext('2d')!.drawImage(src, 0, 0);
          let sc = Math.min(3, 26 / Math.max(src.width, src.height));
          if (sc >= 2) sc = Math.floor(sc);
          cv.style.width = src.width * sc + 'px';
          cv.style.height = src.height * sc + 'px';
          b.appendChild(cv);
        }
        b.appendChild(el('span', 'tool-key'));
        b.onclick = () => {
          this.game.sound.unlock();
          this.game.sound.ui('select');
          // a small screen shows only the tool in use until it's tapped
          if (compact() && !this.tools.classList.contains('open')) {
            this.tools.classList.add('open');
            return;
          }
          this.tools.classList.remove('open');
          if (tab === 'tools') this.controls.setTool(id as ToolId);
          else this.controls.setPower(id as PowerId);
        };
        list.appendChild(b);
        this.toolBtns.set(id, b);
      }
      this.toolLists.set(tab, list);
      this.tools.appendChild(list);
    };
    add('tools', TOOLS);
    add('powers', POWERS);
    // the kinds of the slot in hand (the Rope's fuse cord: what its key again steps to), or the springs' stiffness
    this.varBar = el('div', 'tool-vars hidden');
    for (const id of TOOLS) {
      const kinds = slotVariants(id);
      if (kinds.length < 2) continue;
      for (const v of kinds) {
        const def = ITEMS.find((i) => i.tool === v);
        const b = el('button', 'tool-btn tool-var', def?.name ?? v);
        b.dataset.name = def?.name ?? v;
        b.dataset.tool = v;
        b.title = def?.description ?? '';
        b.onclick = () => {
          this.game.sound.ui('select');
          this.controls.setTool(v);
        };
        this.varBtns.set(v, b);
        this.varBar.appendChild(b);
      }
    }
    SPRING_STIFFNESS.forEach((st) => {
      const b = el('button', 'tool-btn tool-var', st.name);
      b.title = `New springs: ${st.name.toLowerCase()}`;
      b.onclick = () => {
        this.game.sound.ui('select');
        this.controls.springStiffness = st.k;
        this.onToolChanged();
      };
      this.springBtns.push(b);
      this.varBar.appendChild(b);
    });
    this.tools.appendChild(this.varBar);
    // the Shape tool's materials
    this.matBar = el('div', 'shape-mats');
    for (const m of SHAPE_MATERIALS) {
      const b = el('button', 'mat-btn');
      b.title = m.name;
      b.appendChild(materialArt(new PixelArt(10, 10).rect(0, 0, 10, 10, 0), m.id).toCanvas(0, 2));
      b.onclick = () => {
        this.game.sound.ui('select');
        this.controls.shapeMat = m.id;
        this.onToolChanged();
      };
      this.matBtns.set(m.id, b);
      this.matBar.appendChild(b);
    }
    this.tools.appendChild(this.matBar);
    this.root.appendChild(this.tools);
    this.onToolChanged();
  }

  onToolChanged(): void {
    const c = this.controls;
    this.toolTab.textContent = c.tab === 'tools' ? 'Tools ⇄' : 'Powers ⇄';
    for (const [tab, list] of this.toolLists) list.classList.toggle('hidden', tab !== c.tab);
    const tools = c.tab === 'tools';
    // (a slot's button is lit for any of its kinds: the Rope's for the fuse cord too)
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', (TOOLS as string[]).includes(id) ? tools && toolSlot(id as ToolId) === toolSlot(c.tool) : !tools && id === c.power);
    const kinds = tools ? slotVariants(c.tool) : [];
    for (const [id, b] of this.varBtns) {
      b.classList.toggle('hidden', kinds.length < 2 || !kinds.includes(id as ToolId));
      b.classList.toggle('active', id === c.tool);
    }
    const springs = tools && c.tool === 'spring';
    const stiff = stiffnessStep(c.springStiffness);
    this.springBtns.forEach((b, i) => {
      b.classList.toggle('hidden', !springs);
      b.classList.toggle('active', i === stiff);
    });
    this.varBar.classList.toggle('hidden', kinds.length < 2 && !springs);
    // (editing the map, the Shape tool draws ground: its material is picked on the map's banner)
    this.matBar.classList.toggle('hidden', !c.shaping || !!c.terrain);
    for (const [id, b] of this.matBtns) b.classList.toggle('active', id === c.shapeMat);
  }

  // ---- touch bar -----------------------------------------------------------------

  /** Buttons for the keyboard commands, shown on touch screens while something is selected. */
  private buildTouchBar(): void {
    const c = this.controls;
    this.touchBar = el('div', 'touchbar hidden');
    const btn = (label: string, title: string, down: (b: HTMLButtonElement) => void, up?: () => void, into = this.touchBar) => {
      const b = el('button', 'touch-btn', label);
      b.title = title;
      b.onpointerdown = (e) => {
        e.preventDefault();
        this.game.sound.unlock();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('down');
        down(b);
      };
      const release = () => {
        if (!b.classList.contains('down')) return;
        b.classList.remove('down');
        up?.();
      };
      b.onpointerup = release;
      b.onpointercancel = release;
      b.onlostpointercapture = release;
      into.appendChild(b);
      return b;
    };
    // held: automatic weapons keep firing, like holding F
    btn('Use', 'Activate (hold for automatic weapons)', () => c.activate(c.touchTargets(), true), () => c.releaseActivation());
    this.btnFreeze = btn('Freeze', 'Freeze / unfreeze', () => c.toggleFreeze(c.touchTargets()));
    btn('⟲', 'Rotate left (hold while dragging)', () => c.holdRotate(1, true), () => c.holdRotate(1, false));
    btn('⟳', 'Rotate right (hold while dragging)', () => c.holdRotate(-1, true), () => c.holdRotate(-1, false));
    btn('Flip', 'Flip', () => c.flip(c.touchTargets()));
    btn('Delete', 'Delete', () => c.deleteEntities(c.touchTargets())).classList.add('danger');
    btn('⋯', 'More actions', (b) => {
      const r = b.getBoundingClientRect();
      c.openMenuForSelection(r.left, r.top - 8);
    });
    this.root.appendChild(this.touchBar);
    // driving: the drive keys (A, D) with a vehicle selected, as buttons held at the screen's sides (a tank's aim, W and S, with them)
    this.drivePad = el('div', 'drivepad hidden');
    const pad = (label: string, title: string, id: 'driveLeft' | 'driveRight' | 'aimUp' | 'aimDown', cls: string) => {
      const b = btn(label, title, () => c.holdDrive(id, true), () => c.holdDrive(id, false), this.drivePad);
      b.classList.add('pad-btn', cls);
      return b;
    };
    pad('◀', 'Drive left (hold)', 'driveLeft', 'pad-l');
    pad('▶', 'Drive right (hold)', 'driveRight', 'pad-r');
    this.aimBtns = [pad('▲', 'Raise the gun (hold)', 'aimUp', 'pad-up'), pad('▼', 'Lower the gun (hold)', 'aimDown', 'pad-down')];
    this.root.appendChild(this.drivePad);
    // building: what Alt, Shift and Ctrl do with a mouse, as switches (see Controls.freeAnchor...)
    this.buildBar = el('div', 'touchbar buildbar hidden');
    const sw = (label: string, title: string, fn: () => void, on?: () => boolean, show?: () => boolean) => {
      const b = el('button', 'touch-btn', label);
      b.title = title;
      b.onpointerdown = (e) => {
        e.preventDefault();
        this.game.sound.unlock();
        this.game.sound.ui('click');
        fn();
      };
      this.buildBar.appendChild(b);
      this.buildBtns.push({ b, on, show });
    };
    const bs = c.arrange.settings;
    sw('Snap', 'Moved things snap to the grid and turn in steps', () => {
      bs.snapMode = bs.snapMode === 'always' ? 'alt' : 'always';
      c.arrange.saveSettings();
    }, () => bs.snapMode === 'always');
    sw('Free', 'The next connection end goes exactly under the ring (no snapping)', () => (c.freeAnchor = !c.freeAnchor), () => c.freeAnchor, () => !!c.toolKind && c.toolKind !== 'remove');
    sw('Chain', 'Each connection carries on from where the last one ended', () => (c.chainTouch = !c.chainTouch), () => c.chainTouch, () => !!c.toolKind && c.toolKind !== 'remove');
    sw('Alone', 'With time paused, dragging moves just what you drag, not everything joined to it', () => (c.aloneTouch = !c.aloneTouch), () => c.aloneTouch, () => this.game.paused);
    sw('✓', 'Place it here', () => c.placer.place(), undefined, () => c.placer.waiting);
    sw('✕', 'Don’t place it', () => c.placer.cancel(), undefined, () => c.placer.waiting);
    sw('Stop', 'Stop this connection', () => c.connect.cancel(), undefined, () => !!c.connect.pending);
    sw('⟲', 'Back to build: the scene as it was before Play', () => c.rewind(), undefined, () => c.history.atCheckpoint);
    this.root.appendChild(this.buildBar);
  }

  setTouchMode(on: boolean): void {
    document.body.classList.toggle('touch', on);
    // (a layout can't hide the toolbar from a touch screen: it's the way to the menus there)
    this.layout.apply();
  }

  refreshToolbar(): void {
    this.btnPause.innerHTML = this.game.paused ? ICONS.play : ICONS.pause;
    this.btnPause.classList.toggle('on', this.game.paused);
    this.btnSlow.classList.toggle('on', this.game.timeScale < 1);
    const v = String(this.game.timeScale);
    if (![...this.speedSel.options].some((o) => o.value === v)) {
      const o = el('option');
      o.value = v;
      o.textContent = `${v}×`;
      this.speedSel.appendChild(o);
    }
    this.speedSel.value = v;
  }

  // ---- overlays --------------------------------------------------------------------

  private overlays(): HTMLDivElement[] {
    return [this.help, this.settings, this.netPanel, this.friendsOverlay, this.pauseMenu, this.maps.overlay, this.army.overlay, this.tutorials.overlay, this.statsPanel.overlay];
  }

  /** The Tutorials panel (see TutorialsPanel), filled in afresh; or closed, if it's open. */
  showTutorials(): void {
    this.tutorials.render();
    this.toggle(this.tutorials.overlay);
  }

  /** Starts a tour from the Tutorials panel, the panel (and the main menu, if it's up) out of the way first. */
  private startTour(id: string): void {
    this.hide(this.tutorials.overlay);
    if (this.mainMenu.open) this.mainMenu.close();
    this.tutorial.start(id);
  }

  /** The Battle panel (see ArmyPanel), filled in afresh; or closed, if it's open. */
  openArmy(): void {
    this.army.render();
    this.toggle(this.army.overlay);
  }

  private hide(panel: HTMLDivElement): void {
    if (panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    if (panel === this.help) this.binding = null;
    // closing the pause menu (or what was opened from it) lets time run again (unless it was paused before)
    if (panel !== this.pauseHolder) return;
    this.pauseHolder = null;
    if (!this.pausedBefore && this.game.paused && !this.game.net?.guest) this.controls.togglePause();
  }

  private toggle(panel: HTMLDivElement): void {
    const show = panel.classList.contains('hidden');
    // a panel opened from the pause menu keeps time stopped until it's closed in turn
    const handOver = show && !!this.pauseHolder && !this.pauseHolder.classList.contains('hidden');
    if (handOver) this.pauseHolder = panel;
    for (const p of this.overlays()) if (p !== panel) this.hide(p);
    if (!show) {
      this.hide(panel);
      return;
    }
    // (in someone else's game, time is everyone's: the menu leaves it running)
    if (panel === this.pauseMenu && !this.game.net?.guest) {
      // (back from a panel it opened, time is still stopped by the menu: not "paused before")
      if (!handOver) this.pausedBefore = this.game.paused;
      this.pauseHolder = panel;
      if (!this.game.paused) this.controls.togglePause();
    }
    if (panel === this.help) this.renderHelp();
    if (panel === this.settings) {
      this.syncIterations();
      this.showBuilding();
      this.showWorld();
    }
    panel.classList.remove('hidden');
  }

  toggleHelp(): void {
    this.toggle(this.help);
  }

  togglePauseMenu(): void {
    this.toggle(this.pauseMenu);
  }

  /**
   * Edit layout (Settings, the pause menu, its key): every piece of the
   * interface framed to move, size or hide, over the sandbox with time stopped
   * until it's done (in someone else's game time runs on, as for the pause menu).
   */
  editLayout(): void {
    if (this.layout.editing) return;
    if (!this.layout.fits()) {
      this.toast('Arranging the interface needs a wider window (phones keep their own layout)');
      return;
    }
    // (from the pause menu, or a panel opened from it, time stays stopped: its hold is handed over, not let go for a moment)
    const paused = this.pauseHolder ? this.pausedBefore : this.game.paused;
    this.pauseHolder = null;
    this.closeContextMenu();
    this.dialogClose?.();
    this.closeOverlays();
    if (this.mainMenu.open) this.mainMenu.close();
    if (this.root.classList.contains('ui-hidden')) this.toggleInterface();
    if (!this.game.paused && !this.game.net?.guest) this.controls.togglePause();
    this.layout.edit(() => {
      if (!paused && this.game.paused && !this.game.net?.guest) this.controls.togglePause();
    });
  }

  closeOverlays(): boolean {
    // a dialog first (it's over everything): Esc with the focus off its box still closes it
    if (this.dialogClose) {
      this.dialogClose();
      return true;
    }
    // (Edit layout: Esc is Done)
    if (this.layout.editing) {
      this.layout.done();
      return true;
    }
    const open = this.overlays().filter((p) => !p.classList.contains('hidden'));
    for (const p of open) this.hide(p);
    const editing = !!this.editor;
    this.closeEditor();
    return open.length > 0 || editing;
  }

  /** An overlay panel that closes on a click beside it. */
  private overlay(cls = 'panel'): { overlay: HTMLDivElement; box: HTMLDivElement } {
    const overlay = el('div', 'overlay hidden');
    const box = el('div', cls);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
      if (e.target === overlay) this.hide(overlay);
    };
    this.root.appendChild(overlay);
    return { overlay, box };
  }

  private buildHelp(): void {
    const { overlay, box } = this.overlay('panel help-panel');
    this.help = overlay;
    this.helpBox = box;
    // a key pressed while a command waits for one becomes its key
    window.addEventListener('keydown', (e) => {
      if (!this.binding) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const id = this.binding;
      this.binding = null;
      const keys = this.controls.bindings.keys(id);
      if (e.code === 'Escape') this.renderHelp();
      else this.controls.bindings.set(id, this.bindingAdd ? [...keys.filter((c) => c !== e.code), e.code] : [e.code]);
    }, true);
  }

  /**
   * The Controls panel: a search box over the mouse, every command with its keys
   * (click one to change it), touch and tips, and Close and Reset below. Only the
   * list between them scrolls; drawn afresh (on a key changed), it keeps its
   * place, the search and the search box's focus.
   */
  private renderHelp(): void {
    const box = this.helpBox;
    const b = this.controls.bindings;
    const k = (id: ActionId) => b.label(id) || '(unbound)';
    const springKey = `tool${TOOLS.indexOf('spring') + 1}` as ActionId;
    const old = box.querySelector<HTMLElement>('.help-body');
    const scroll = old ? old.scrollTop : 0;
    const searching = document.activeElement?.classList.contains('help-search') ?? false;
    box.innerHTML = '';
    const head = el('div', 'help-head');
    head.appendChild(el('div', 'panel-title', 'Controls and key bindings'));
    head.appendChild(el('div', 'panel-note', 'People Playground’s controls. Click a key to change it, + to give a command another key, × to unbind it.'));
    const search = el('input', 'help-search');
    search.type = 'search';
    search.placeholder = 'Search commands and keys…';
    search.spellcheck = false;
    search.value = this.helpQuery;
    head.appendChild(search);
    const body = el('div', 'help-body');
    box.append(head, body);
    const table = (rows: [string, string][]) => {
      const t = el('div', 'keys');
      for (const [key, desc] of rows) {
        const r = t.appendChild(el('div', 'help-row'));
        r.appendChild(el('div', 'key')).textContent = key;
        r.appendChild(el('div', 'desc')).textContent = desc;
      }
      return t;
    };
    const section = (title: string, ...content: HTMLElement[]) => {
      const s = body.appendChild(el('div', 'help-sec'));
      s.appendChild(el('div', 'panel-sub', title));
      s.append(...content);
      return s;
    };
    section('Mouse', table([
      ['Left drag', 'Drag an object · on empty space, box-select · or use the tool or power'],
      ['Drag a yellow handle', 'Resize the selected crate, plank, beam, brick, block, pane or drawn shape (Shift: keep proportions)'],
      [`${b.keys('fast').length ? keyName(b.keys('fast')[0]).replace(/^(Left|Right) /, '') : 'Shift'} + click`, 'Add to / remove from the selection'],
      ['Right click', 'Context menu (on a rope, weld, spring, hinge or wire: its own, unless what’s under it is selected)'],
      ['Middle drag', 'Move the camera'],
      ['Mouse wheel', 'Zoom (over a rope or spring with time paused, or while laying one: its length; Shift: faster)'],
    ]));
    section('Building', table([
      ['Drag (time paused)', 'Moves it with everything joined to it; welds and hinges stay joined where it’s put'],
      ['Ctrl + drag (time paused)', 'Moves just it: its joints to the rest are made again where it ends up'],
      [`${k('snap')} while moving`, 'Snap to the grid and turn in steps (Settings › Building: size, steps, always)'],
      ['Double-click', 'Select the whole assembly (again: and what’s wired to it)'],
      ['Alt + click', 'The next of the things stacked under the cursor'],
      ['Alt + arrows (time paused)', 'Nudge the selection a pixel (Shift: 8)'],
      ['Round handle over the selection', 'Turn it (time paused)'],
      ['Connection tool: press, drag, let go', 'Connect two things; a ring and a label show where each end goes'],
      [`Connection tool: ${k('snap')}`, 'The end goes exactly at the cursor (no snapping)'],
      [`Connection tool: hold ${k('com')}`, 'The end goes at the centre of mass'],
      ['Connection tool: Shift as you let go', 'Carry on from where it ended (A → B → C); Esc or right-click stops'],
      ['Connection tool: click, then click', 'Rope, spring, wire and fuse cord: the first end, then the second'],
      ['Weld or pin: click', 'Fix it to what’s behind it, or the background'],
      ['Let go over nothing', 'Weld, hinge or pin: nothing made (hold Ctrl to fix it to the background)'],
      ['Drag a connection’s knot (time paused)', 'Move that end somewhere else'],
      [`${k('delete')} over a connection`, 'Delete it (with nothing selected)'],
      ['Remove tool', 'Click a connection to cut it · Shift+click a thing: all of its · drag a box across several'],
      [`Shift + ${k('time')}`, 'Back to build: the scene as it was before you pressed Play'],
    ]));
    // which keys more than one command uses (not counting a pair that shares them on purpose: A and D drive or turn)
    const uses = new Map<string, number>();
    for (const a of ACTIONS) for (const code of b.keys(a.id)) if (!(a.shares && b.keys(a.shares).includes(code))) uses.set(code, (uses.get(code) ?? 0) + 1);
    for (const group of GROUPS) {
      const t = el('div', 'keys');
      for (const a of ACTIONS.filter((x) => x.group === group)) {
        const row = t.appendChild(el('div', 'help-row'));
        const cell = el('div', 'key bind-cell');
        const keys = b.keys(a.id);
        const btn = el('button', 'bind' + (keys.length ? '' : ' none') + (keys.some((c) => (uses.get(c) ?? 0) > 1) ? ' clash' : ''));
        // (Left / Right shortened: the column is as wide as its widest key)
        btn.textContent = this.binding === a.id ? 'Press a key…' : keys.length ? keys.map((c) => keyName(c).replace(/^(Left|Right) /, (m) => m[0] + ' ')).join(' / ') : '—';
        if (this.binding === a.id) btn.classList.add('wait');
        btn.title = keys.some((c) => (uses.get(c) ?? 0) > 1) ? 'This key also does something else' : 'Click, then press a key (Esc: keep it as it is)';
        btn.onclick = () => {
          this.binding = this.binding === a.id && !this.bindingAdd ? null : a.id;
          this.bindingAdd = false;
          this.renderHelp();
        };
        cell.appendChild(btn);
        if (keys.length) {
          const add = el('button', 'bind-x', '+');
          add.title = 'Add another key';
          add.onclick = () => {
            this.binding = this.binding === a.id && this.bindingAdd ? null : a.id;
            this.bindingAdd = true;
            this.renderHelp();
          };
          cell.appendChild(add);
          const x = el('button', 'bind-x', '×');
          x.title = 'Unbind';
          x.onclick = () => b.set(a.id, []);
          cell.appendChild(x);
        }
        row.appendChild(cell);
        row.appendChild(el('div', 'desc')).textContent = a.label;
        // (what the search finds it by: its keys' names too)
        row.dataset.find = `${keys.map(keyName).join(' ')} ${a.label}`;
      }
      section(group, t);
    }
    section('Shortcuts', table([
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo any edit'],
      ['Ctrl+C / Ctrl+V', 'Copy / paste'],
      ['Ctrl+D', 'Duplicate'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+S / Ctrl+O', 'Quick save / quick load'],
    ]));
    // (listed first when the touch layout is on)
    section('Touch screens', table(TOUCH_HELP)).classList.add('help-touch');
    const tips = el('div', 'tips');
    for (const t of [
      `Pick something in the toybox on the left, then press ${k('spawnRight')} to spawn it at the cursor (${k('spawnLeft')}: facing left). Hold ${k('freeze')} while spawning to place it frozen, or ${k('activate')} to switch it on as it lands (a grenade’s pin pulled). ${k('freeze')} on its own freezes what’s under the cursor or selected; Ctrl+Z undoes.`,
      `Drop a weapon onto a person’s hand to make them hold it. Select the person (or the weapon) and press ${k('activate')} to use it.`,
      `Rope, fixed connector, spring, pin and wire are on the tool bar at the right (keys 1–8). Press a tool’s key again for its other kind: the Rope’s fuse cord. Drag with the Pin from one thing to another for a hinge. ${k('toolPower')} switches it to the powers.`,
      `The Shape tool (${k('tool8')}) draws solid things in wood, metal, concrete, brick, rubber or glass: drag out a box, or click the corners of any outline. Select several things that touch and choose Weld together to fuse them.`,
      `Build with time paused: press ${k('time')} to try it out, and Shift + ${k('time')} (or ⟲ on the tool bar) to go back to how it was built. Right-click anything for Set angle, Layer, Duplicate mirrored and, with several selected, Arrange.`,
      `Right-click a hinge’s object to limit how far it swings, a motor to set its speed, a gun to edit its recoil, power and fire rate. Select a creation and choose Save as contraption to keep it in the toybox, and export it to send to friends.`,
      `With the Spring tool (${k(springKey)}), press ${k(springKey)} again to step through spring stiffnesses, soft to very strong: over a spring it changes that one, elsewhere the springs you make next. Right-click a spring to pick one.`,
      `Pause time (${k('time')}) to move and turn things exactly where you want them; hold ${k('snap')} to snap. ${k('detail')} shows every limb’s health.`,
      `${k('xray')} x-rays people and animals: their bones, and the ones that break. Select one to see its vital signs (heart, blood, breathing, pain); right-click it and choose Vitals to keep them on screen.`,
    ]) tips.appendChild(el('div', 'tip help-row')).textContent = t;
    section('Tips', tips);
    const none = body.appendChild(el('div', 'help-none'));
    // the search: rows with every word typed (in their keys, what they do or their section's name)
    const filter = () => {
      const words = this.helpQuery.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const s of body.querySelectorAll<HTMLElement>('.help-sec')) {
        const title = s.querySelector('.panel-sub')?.textContent?.toLowerCase() ?? '';
        let any = false;
        for (const r of s.querySelectorAll<HTMLElement>('.help-row')) {
          const text = `${title} ${(r.dataset.find ?? r.textContent ?? '').toLowerCase()}`;
          r.hidden = !words.every((w) => text.includes(w));
          if (!r.hidden) any = true;
        }
        s.hidden = !any;
        if (any) shown++;
      }
      none.hidden = shown > 0;
      none.textContent = `Nothing matches “${this.helpQuery.trim()}”`;
    };
    search.oninput = () => {
      this.helpQuery = search.value;
      filter();
      body.scrollTop = 0;
    };
    search.onkeydown = (e) => {
      // Esc empties the search first, and closes the panel only once it's empty
      if (e.code !== 'Escape' || !search.value) return;
      e.preventDefault();
      e.stopPropagation();
      search.value = '';
      this.helpQuery = '';
      filter();
    };
    filter();
    const btns = el('div', 'set-io help-foot');
    const reset = el('button', 'panel-btn', 'Reset keys to defaults');
    reset.onclick = () => {
      this.binding = null;
      b.reset();
      this.toast('Keys reset to People Playground’s');
    };
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.hide(this.help);
    btns.append(close, reset);
    box.appendChild(btns);
    body.scrollTop = scroll;
    if (searching) search.focus();
  }

  /**
   * Settings, in sections (Sound, Graphics, Physics, Game) that scroll between
   * the title and the buttons below. Graphics' presets set every graphics and
   * physics setting at once; each can then be changed on its own (Custom).
   */
  private buildSettings(): void {
    const { overlay, box } = this.overlay('panel settings-panel');
    this.settings = overlay;
    const head = el('div', 'help-head');
    head.appendChild(el('div', 'panel-title', 'Settings'));
    const body = el('div', 'help-body');
    box.append(head, body);
    let sec: HTMLElement = body;
    const section = (title: string) => {
      sec = body.appendChild(el('div', 'set-sec'));
      sec.appendChild(el('div', 'panel-sub', title));
    };
    const row = (label: string, input: HTMLElement, hint?: string) => {
      // (a label round one control: a click on its name works it; round several buttons it would press the first)
      const r = el(input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? 'label' : 'div', 'set-row');
      r.appendChild(el('span', '', label));
      r.appendChild(input);
      if (hint) r.title = hint;
      sec.appendChild(r);
      return r;
    };
    const check = (val: boolean, fn: (v: boolean) => void) => {
      const i = el('input');
      i.type = 'checkbox';
      i.checked = val;
      i.onchange = () => fn(i.checked);
      return i;
    };
    // (the sound settings are kept in the browser: see Sound)
    const level = (cls: string, val: number, fn: (v: number) => void) => {
      const i = el('input', cls);
      i.type = 'range';
      i.min = '0';
      i.max = '1';
      i.step = '0.05';
      i.value = String(val);
      i.oninput = () => fn(parseFloat(i.value));
      return i;
    };
    /** A drop-down of values with their names. */
    const choice = <T extends string | number>(cls: string, options: [T, string][], value: T, fn: (v: T) => void) => {
      const sel = el('select', `tb-select ${cls}`);
      for (const [v, name] of options) {
        const o = el('option');
        o.value = String(v);
        o.textContent = name;
        sel.appendChild(o);
      }
      sel.value = String(value);
      sel.onchange = () => fn(options.find(([v]) => String(v) === sel.value)![0]);
      return sel;
    };

    section('Sound');
    const snd = this.game.sound;
    row('Master volume', level('set-volume', snd.volume, (v) => snd.setVolume(v)));
    row('Effects volume', level('set-effects', snd.effects, (v) => snd.setEffects(v)));
    row('Music volume', level('set-music', this.game.music.volume, (v) => this.game.music.setVolume(v)));
    row('Mute', check(snd.muted, (v) => snd.setMuted(v)));

    section('Graphics');
    const gfx = this.gfx;
    const R = GRAPHICS_RANGE;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    // the presets, and which one the settings are (or Custom)
    const presets = el('div', 'set-presets');
    const presetBtns = PRESET_NAMES.map(({ id, label }) => {
      const btn = el('button', 'set-preset', label);
      btn.dataset.preset = id;
      btn.onclick = () => {
        Object.assign(gfx, PRESETS[id]);
        this.graphicsChanged();
      };
      presets.appendChild(btn);
      return btn;
    });
    const custom = el('span', 'set-note set-custom', 'Custom');
    presets.appendChild(custom);
    row('Preset', presets, 'Sets every graphics and physics setting below at once; change any of them afterwards');
    const set = <K extends keyof Graphics>(k: K) => (v: Graphics[K]) => {
      gfx[k] = v;
      this.graphicsChanged();
    };
    const sel = {
      resolution: choice('set-resolution', R.resolution.map((v) => [v, pct(v)] as [number, string]), gfx.resolution, set('resolution')),
      lights: choice('set-lights', R.lights.map((v) => [v, v ? `${v} at once` : 'Off'] as [number, string]), gfx.lights, set('lights')),
      particles: choice('set-particles', R.particles.map((v) => [v, pct(v)] as [number, string]), gfx.particles, set('particles')),
      cases: choice('set-cases', R.cases.map((v) => [v, v ? `${v} at most` : 'None'] as [number, string]), gfx.cases, set('cases')),
      step: choice('set-step', [['auto', 'Short while it can (smoother)'], ['long', 'Always long (half the work)']], gfx.step, set('step')),
      fps: choice('set-fps', R.fps.map((v) => [v, v === 'display' ? 'As the screen refreshes (V-sync)' : v === 'unlimited' ? 'Unlimited' : `${v} a second`] as [FpsCap, string]), gfx.fps, set('fps')),
    };
    row('Resolution', sel.resolution, 'How much of the screen’s resolution is drawn: less is lighter on the graphics card');
    row('Frame rate cap', sel.fps, `The most frames drawn a second. Unlimited draws as many as the computer can (Show stats shows how many); ${desktop ? 'the desktop app shows them all (it restarts to start or stop going past the screen’s refresh)' : 'a browser shows only as many as the screen refreshes'}`);
    // (the desktop app sets Chromium's frame-rate limit as it starts: going past the refresh, or back under it, takes a restart)
    const restart = el('button', 'set-preset', 'Restart to apply');
    restart.onclick = () => desktop?.restart();
    const restartRow = row('The app restarts for this cap', restart);
    restartRow.hidden = true;
    row('Lights', sel.lights, 'Muzzle flashes, fire and lamps that light up what’s round them');
    row('Effects', sel.particles, 'How much smoke, sparks, flames and dust (blood and liquids are always all there)');
    row('Spent cases', sel.cases, 'Cases thrown out by guns that lie about');
    row('Background grid', check(true, (v) => (this.game.renderer.showGrid = v)));
    row('Blood', check(true, (v) => (this.game.particles.bloodEnabled = v)));

    section('Physics');
    // solver iterations: any number; more holds stacks, joints and contraptions stiffer, for more time a step
    const quality = el('span', 'set-iters');
    const slide = el('input', 'set-iters-slider');
    slide.type = 'range';
    slide.min = String(R.iterations.min);
    slide.max = String(R.iterations.max);
    const num = el('input', 'set-iters-num');
    num.type = 'number';
    num.min = String(R.iterations.min);
    num.max = String(R.iterations.max);
    const note = el('span', 'set-note');
    quality.append(slide, num, note);
    const iterate = (v: number) => {
      gfx.iterations = Math.round(clamp(v || PRESETS.high.iterations, R.iterations.min, R.iterations.max));
      this.graphicsChanged();
    };
    slide.oninput = () => iterate(parseInt(slide.value));
    num.onchange = () => iterate(parseInt(num.value));
    row('Iterations', quality, 'More hold stacks, joints and contraptions stiffer, for more time a step');
    row('Steps', sel.step, 'Short steps are smoother; a scene too heavy for them takes long ones anyway');
    this.syncIterations = () => {
      // a guest's game shows the host's world: the host's setting is the one that counts
      const host = this.session.guest?.hostIterations || 0;
      const n = host || gfx.iterations;
      this.game.physics.world.integrationParameters.numSolverIterations = n;
      slide.value = num.value = String(n);
      slide.disabled = num.disabled = !!host;
      const normal = PRESETS.high.iterations;
      note.textContent = host ? 'set by the host' : n === normal ? 'normal' : n > normal ? 'steadier, slower' : 'faster, wobblier';
    };
    // what the panel shows, after a preset or a change
    this.showGraphics = () => {
      for (const k of ['resolution', 'lights', 'particles', 'cases', 'step', 'fps'] as const) sel[k].value = String(gfx[k]);
      if (desktop) void desktop.frameCap(gfx.fps).then((r) => (restartRow.hidden = !r));
      const p = presetOf(gfx);
      for (const btn of presetBtns) btn.classList.toggle('on', btn.dataset.preset === p);
      custom.hidden = p !== null;
      this.syncIterations();
    };
    this.showGraphics();

    // the world: its light, weather and gravity (saved with a scene; in someone else's game, the host's)
    section('World');
    const ws = this.game.weather;
    /** The option nearest a value (a map's or a host's weather needn't be one of them). */
    const nearest = (options: [number, string][], v: number) => String(options.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a))[0]);
    const LIGHTS: [number, string][] = [[1, 'Day'], [0.55, 'Dusk'], [0.2, 'Night']];
    const FALLS: [number, string][] = [[0, 'Off'], [0.3, 'Light'], [0.6, 'Steady'], [1, 'Heavy']];
    const FOGS: [number, string][] = [[0, 'Off'], [0.5, 'Light'], [1, 'Thick']];
    const light = choice('set-light', LIGHTS, 1, (v) => ws.set({ light: v }));
    row('World light', light);
    const rain = choice('set-rain', FALLS, 0, (v) => ws.set({ rain: v }));
    row('Rain', rain, 'Wets what’s out in it and puts out small fires (oil burns on longer)');
    const snow = choice('set-snow', FALLS, 0, (v) => ws.set({ snow: v }));
    row('Snow', snow, 'Falls and settles on the ground, melting away once it stops');
    const fog = choice('set-fog', FOGS, 0, (v) => ws.set({ fog: v }));
    row('Fog', fog, 'Hides what’s far off behind a haze');
    const bolts = el('span', 'set-iters');
    const chance = el('input', 'set-lightning');
    chance.type = 'range';
    chance.min = '0';
    chance.max = '100';
    chance.step = '5';
    const chanceNote = el('span', 'set-note');
    bolts.append(chance, chanceNote);
    chance.oninput = () => {
      ws.set({ lightning: parseInt(chance.value) || 0 });
      chanceNote.textContent = `${chance.value}%`;
    };
    row('Lightning chance', bolts, 'Bolts out of the sky into the ground or the tallest thing about: at 100% every few seconds');
    const gravity = choice('set-gravity', GRAVITIES, GRAVITY, (v) => {
      this.ownGravity = v;
      if (!this.session.guest) this.game.setGravity(v);
    });
    row('Gravity', gravity);
    this.showGravity = () => {
      const host = this.session.guest?.hostGravity ?? null;
      const v = host ?? this.ownGravity;
      // (a host's gravity that isn't one of ours is shown as the nearest)
      gravity.value = String(GRAVITIES.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a))[0]);
      gravity.disabled = host !== null;
      gravity.title = host !== null ? 'Set by the host' : '';
    };
    this.showWorld = () => {
      const s = ws.state;
      const guest = !!this.session.guest;
      this.worldShown = s;
      this.worldGuest = guest;
      light.value = nearest(LIGHTS, s.light);
      rain.value = nearest(FALLS, s.rain);
      snow.value = nearest(FALLS, s.snow);
      fog.value = nearest(FOGS, s.fog);
      chance.value = String(s.lightning);
      chanceNote.textContent = `${Math.round(s.lightning)}%`;
      for (const i of [light, rain, snow, fog, chance]) {
        i.disabled = guest;
        i.title = guest ? 'Set by the host' : '';
      }
    };
    this.showWorld();

    section('Building');
    const bs = this.controls.arrange.settings;
    const keep = () => this.controls.arrange.saveSettings();
    const grid = choice('set-grid', GRID_SIZES.map((v): [number, string] => [v, v === GRID_SIZES[0] ? '1 pixel' : `${v} m`]), bs.grid, (v) => {
      bs.grid = v;
      keep();
    });
    row('Grid', grid, 'What moved things snap to with time paused (and the Shape tool’s corners)');
    const angle = choice('set-angle', ANGLE_STEPS.map((v): [number, string] => [v, `${v}°`]), bs.angle, (v) => {
      bs.angle = v;
      keep();
    });
    row('Angle steps', angle, 'What turning snaps to (A / D, the turning handle, two fingers)');
    const mode = choice('set-snap', [['alt', 'While Alt is held (People Playground)'], ['always', 'Always (Alt: not)']], bs.snapMode, (v) => {
      bs.snapMode = v === 'always' ? 'always' : 'alt';
      keep();
    });
    row('Snapping', mode, 'Without it, moved things line up with their neighbours’ edges and middles');
    const anchors = check(bs.anchors, (v) => {
      bs.anchors = v;
      keep();
    });
    row('Connection ends snap to points', anchors, 'Ends go to middles, corners, edges and the points made for joining (Alt: exactly at the cursor)');
    const tap = check(bs.tapSpawn, (v) => {
      bs.tapSpawn = v;
      keep();
    });
    row('Touch: a tap spawns at once', tap, 'Otherwise a tap shows where it will go, and ✓ or a second tap places it');
    this.showBuilding = () => {
      grid.value = String(bs.grid);
      angle.value = String(bs.angle);
      mode.value = bs.snapMode;
      anchors.checked = bs.anchors;
      tap.checked = bs.tapSpawn;
    };

    section('Game');
    const place = choice('set-placement', [['keys', 'Q / E at the cursor (People Playground)'], ['click', 'Click, seeing it first: Q / E turn it (original)']], this.controls.placement, (v) => this.controls.setPlacement(v === 'click' ? 'click' : 'keys'));
    row('Spawning', place);
    row('Show wires', check(true, (v) => (this.game.connections.showWires = v)));
    row('Show stats', check(true, (v) => (this.showStats = v)));
    row('Vitals of the selected person or animal', check(true, (v) => (this.vitals.forSelection = v)));
    row('Screen layout', this.layout.picker(() => this.editLayout()), 'Where the pieces of the interface go: switch between your layouts, or move, size and hide the pieces');

    section('Saves and sync');
    savesSettings(row, { toast: (msg) => this.toast(msg), download: (name, text) => this.download(name, text) });

    const foot = el('div', 'set-io help-foot');
    const bind = el('button', 'panel-btn', 'Key bindings…');
    // (toggle() closes Settings itself, handing over to the Controls panel whatever time-stop it holds)
    bind.onclick = () => this.toggle(this.help);
    const exp = el('button', 'panel-btn', 'Export scene…');
    exp.onclick = () => this.download('blueberry-scene.json', saveToString(this.game));
    const imp = el('button', 'panel-btn', 'Import scene or contraption…');
    imp.onclick = () => this.importFile();
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.hide(this.settings);
    foot.append(close, bind, exp, imp);
    box.appendChild(foot);
  }

  /** Puts the graphics settings into effect (and the iterations, unless a host's count), keeps them, and shows them. */
  private graphicsChanged(): void {
    this.applyGraphics();
    saveGraphics(this.gfx);
    this.showGraphics();
  }

  private applyGraphics(): void {
    const g = this.gfx;
    this.game.renderer.setResolution(g.resolution);
    this.game.renderer.maxLights = g.lights;
    this.game.particles.detail = g.particles;
    this.game.casings.cap = g.cases;
    this.game.longSteps = g.step === 'long';
    this.game.fpsCap = fpsLimit(g.fps);
    this.syncIterations();
  }

  private buildMultiplayer(): void {
    const { overlay, box } = this.overlay('panel net-panel');
    this.netPanel = overlay;
    new MultiplayerPanel(this.session, box, () => this.hide(overlay), { service: this.friends, open: () => this.toggle(this.friendsOverlay) });
  }

  private buildFriends(): void {
    const { overlay, box } = this.overlay('panel net-panel');
    this.friendsOverlay = overlay;
    this.friendsPanel = new FriendsPanel(this.friends, this.session, box, () => this.hide(overlay), this.root, {
      join: async (net, room) => {
        await this.session.join(net, room, this.friends.name);
        // on to their game (from the main menu too)
        this.mainMenu.close();
        this.closeOverlays();
      },
      toast: (msg) => this.toast(msg),
      inMenu: () => this.mainMenu.open,
    });
  }

  /** Esc: time stops while it's open, as in People Playground. */
  private buildPauseMenu(): void {
    const { overlay, box } = this.overlay('panel pause-panel');
    this.pauseMenu = overlay;
    box.appendChild(el('div', 'panel-title', 'Paused'));
    box.appendChild(this.statsPanel.strip());
    const list = el('div', 'menu-btns');
    const item = (label: string, fn: () => void) => {
      const b = el('button', 'panel-btn', label);
      b.onclick = () => {
        this.game.sound.ui('click');
        fn();
      };
      list.appendChild(b);
    };
    item('Resume', () => this.hide(this.pauseMenu));
    item('Controls', () => this.toggle(this.help));
    item('Settings', () => this.toggle(this.settings));
    item('Edit layout…', () => this.editLayout());
    item('Multiplayer', () => this.toggle(this.netPanel));
    item('Friends', () => this.toggle(this.friendsOverlay));
    item('Battle…', () => this.openArmy());
    item('Quick save', () => {
      this.hide(this.pauseMenu);
      this.save();
    });
    item('Quick load', () => {
      this.hide(this.pauseMenu);
      this.load();
    });
    item('Tutorials…', () => this.showTutorials());
    item('Statistics…', () => {
      this.statsPanel.render();
      this.toggle(this.statsPanel.overlay);
    });
    item('Main menu', () => this.mainMenu.show());
    box.appendChild(list);
  }

  save(): void {
    try {
      store.setItem('blueberry-quicksave', saveToString(this.game));
      this.toast('Scene saved');
    } catch (e) {
      this.toast('Save failed: ' + (e as Error).message);
    }
  }

  load(): void {
    let data: string | null = null;
    try {
      data = store.getItem('blueberry-quicksave');
    } catch {
      data = null;
    }
    if (!data) {
      this.toast('No quick save found');
      return;
    }
    try {
      this.controls.loadScene(data, 'Load');
      this.toast('Scene loaded');
    } catch (e) {
      this.toast('Load failed: ' + (e as Error).message);
    }
  }

  /** Opens a file: an exported scene replaces this one, an exported contraption joins the toybox. */
  private importFile(): void {
    const f = el('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as unknown;
        if (Contraptions.isFile(data)) {
          const c = this.contraptions.importFile(data);
          if (!c) {
            this.toast('Not added: the browser’s storage is full');
            return;
          }
          this.showContraptions();
          this.toast(`Added “${c.name}” to Contraptions`);
          return;
        }
        this.controls.loadScene(text, 'Import scene');
        this.toast('Scene imported');
      } catch (err) {
        this.toast('Import failed: ' + (err as Error).message);
      }
    };
    f.click();
  }

  /** Saves a file to the player's computer. */
  private download(name: string, text: string): void {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- contraptions ------------------------------------------------------------------

  saveContraption(list: Entity[]): void {
    const live = list.filter((e) => !e.destroyed);
    if (!live.length) return;
    // as they are now, not when the name has been typed
    const snap = capture(this.game, live);
    const thumb = thumbnail(live);
    const fallback = `Contraption ${this.contraptions.list.length + 1}`;
    this.dialog('Save as contraption', 'Its name in the toybox:', fallback, 'Save', (name) => {
      const c = this.contraptions.add(name.trim() || fallback, snap, thumb);
      if (!c) {
        this.toast('Not saved: the browser’s storage is full');
        return;
      }
      this.showContraptions();
      this.toast(`Saved “${c.name}” in Contraptions`);
    });
  }

  private showContraptions(): void {
    this.search.value = '';
    this.setCategory('Contraptions');
    if (!this.catalogOpen) this.toggleCatalog();
  }

  /** Right-clicking a contraption in the toybox. */
  private contraptionMenu(def: ItemDef, sx: number, sy: number): void {
    const c = this.contraptions.of(def);
    if (!c) return;
    this.openContextMenu(sx, sy, c.name, [
      { label: 'Rename…', action: () => this.dialog('Rename contraption', 'Its name in the toybox:', c.name, 'Rename', (name) => name.trim() && this.contraptions.rename(c.id, name.trim())) },
      { label: 'Export to a file…', action: () => this.download(`${c.name.replace(/[^\w\- ]+/g, '').trim() || 'contraption'}.contraption.json`, this.contraptions.exportText(c)) },
      { label: 'Delete', danger: true, action: () => this.dialog('Delete contraption', `Delete “${c.name}” for good?`, null, 'Delete', () => this.contraptions.remove(c.id)) },
    ]);
  }

  /** A small question over everything: with `value`, a line to type in; `ok` gets what was typed. */
  private dialog(title: string, text: string, value: string | null, okLabel: string, ok: (value: string) => void): void {
    this.dialogClose?.();
    const overlay = el('div', 'overlay');
    const box = el('div', 'panel dialog-panel');
    box.appendChild(el('div', 'panel-title')).textContent = title;
    box.appendChild(el('div', 'panel-note')).textContent = text;
    let input: HTMLInputElement | null = null;
    if (value !== null) {
      input = el('input', 'search dialog-input');
      input.value = value;
      input.maxLength = 60;
      box.appendChild(input);
    }
    const close = () => {
      overlay.remove();
      if (this.dialogClose === close) this.dialogClose = null;
    };
    this.dialogClose = close;
    const accept = () => {
      close();
      ok(input ? input.value : '');
    };
    const btns = el('div', 'set-io');
    const yes = el('button', 'panel-btn', okLabel);
    yes.onclick = accept;
    const no = el('button', 'panel-btn', 'Cancel');
    no.onclick = close;
    btns.append(yes, no);
    box.appendChild(btns);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    overlay.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        accept();
      } else if (e.key === 'Escape') close();
    };
    this.root.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    } else yes.focus();
  }

  /**
   * The physics engine broke and the frames have stopped (see Game.onHalt): says so,
   * with what broke (to copy and send in), and offers to carry on: the page starts
   * again and the scene is put back (see carryOn()), as it is now if it can still be
   * read, else as it was before the last edit (see History.lastSave()).
   */
  private halted(e: unknown): void {
    let scene: string | null = null;
    let when = 'as it was a moment ago';
    try {
      scene = saveToString(this.game);
    } catch {
      when = 'as it was before your last change';
      try {
        scene = this.controls.history.lastSave();
      } catch {
        scene = null;
      }
    }
    const details = haltDetails(e);
    // (in the desktop app, this goes in its log too)
    console.error(`The physics engine broke; the game has stopped.\n${details}`);
    this.dialogClose?.();
    const overlay = el('div', 'overlay');
    const box = el('div', 'panel dialog-panel halt-panel');
    box.appendChild(el('div', 'panel-title')).textContent = 'The game stopped';
    box.appendChild(el('div', 'panel-note')).textContent =
      'The physics engine ran into an error, so everything has stopped. ' +
      (scene ? `Carry on starts the game again with your scene ${when}. ` : 'Restart starts the game again. ') +
      'The details below say what went wrong: sending them in helps get it fixed.' +
      (desktop ? ` (They’re kept in log.txt too, in ${desktop.dataDir}.)` : '');
    const text = el('textarea', 'halt-details');
    text.readOnly = true;
    text.value = details;
    box.appendChild(text);
    const btns = el('div', 'set-io');
    const go = el('button', 'panel-btn', scene ? 'Carry on' : 'Restart');
    go.onclick = () => {
      try {
        if (scene) sessionStorage.setItem(CARRY_ON, scene);
      } catch {
        // (too big to carry over: it starts again without it)
      }
      location.reload();
    };
    const copy = el('button', 'panel-btn', 'Copy details');
    copy.onclick = () => {
      text.select();
      navigator.clipboard?.writeText(details).then(() => this.toast('Details copied'), () => document.execCommand('copy'));
    };
    btns.append(go, copy);
    if (scene) {
      const empty = el('button', 'panel-btn', 'Start empty');
      empty.onclick = () => location.reload();
      btns.appendChild(empty);
    }
    box.appendChild(btns);
    overlay.appendChild(box);
    overlay.onkeydown = (ev) => ev.stopPropagation();
    this.root.appendChild(overlay);
    go.focus();
  }

  /** As the game starts after the physics engine broke (see halted()): the scene it was playing, put back. */
  carryOn(): void {
    let text: string | null = null;
    try {
      text = sessionStorage.getItem(CARRY_ON);
      sessionStorage.removeItem(CARRY_ON);
    } catch {
      return;
    }
    if (!text) return;
    this.mainMenu.close();
    try {
      this.controls.loadScene(text, 'Carry on');
      this.toast('Carried on from where it stopped');
    } catch (e) {
      this.toast('Couldn’t carry on: ' + (e as Error).message);
    }
  }

  /**
   * An object's numbers in a panel (Edit gun…): a slider and a box to type in for
   * each, taking effect at once; Reset to defaults puts its kind's numbers back.
   */
  editValues(ed: ValueEditor): void {
    this.closeEditor();
    const overlay = el('div', 'overlay');
    const box = el('div', 'panel edit-panel');
    box.appendChild(el('div', 'panel-title')).textContent = ed.title;
    // (a log-scale slider runs from 0 to this, rather than over the values themselves)
    const STEPS = 1000;
    const shows: (() => void)[] = [];
    for (const f of ed.fields) {
      const row = el('div', 'edit-row');
      row.dataset.key = f.key;
      row.appendChild(el('span', 'edit-label')).textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
      const range = el('input', 'edit-range');
      range.type = 'range';
      const span = Math.log(f.max / f.min);
      range.min = f.log ? '0' : String(f.min);
      range.max = f.log ? String(STEPS) : String(f.max);
      range.step = f.log ? '1' : String(f.step);
      const num = el('input', 'edit-num');
      num.type = 'number';
      num.min = String(f.min);
      num.max = String(f.max);
      num.step = String(f.step);
      const digits = Math.max(0, Math.ceil(-Math.log10(f.step) - 1e-9));
      const snap = (v: number) => Math.min(f.max, Math.max(f.min, +(Math.round(v / f.step) * f.step).toFixed(digits)));
      const show = () => {
        const v = f.get();
        num.value = String(+v.toFixed(digits));
        range.value = String(f.log ? (Math.log(v / f.min) / span) * STEPS : v);
      };
      range.oninput = () => {
        const p = parseFloat(range.value);
        const v = snap(f.log ? f.min * Math.exp((p / STEPS) * span) : p);
        f.set(v);
        num.value = String(v);
      };
      num.onchange = () => {
        const v = parseFloat(num.value);
        if (Number.isFinite(v)) f.set(snap(v));
        show();
      };
      show();
      shows.push(show);
      row.append(range, num);
      box.appendChild(row);
    }
    // values often wanted (Set angle's Level, 90°...)
    if (ed.buttons?.length) {
      const quick = el('div', 'edit-quick');
      for (const [label, fn] of ed.buttons) {
        const qb = el('button', 'panel-btn', label);
        qb.onclick = () => {
          this.game.sound.ui('click');
          fn();
          for (const sh of shows) sh();
        };
        quick.appendChild(qb);
      }
      box.appendChild(quick);
    }
    const btns = el('div', 'set-io');
    const close = el('button', 'panel-btn', 'Close');
    close.onclick = () => this.closeEditor();
    const reset = el('button', 'panel-btn', 'Reset to defaults');
    reset.onclick = () => {
      this.game.sound.ui('click');
      ed.reset();
      for (const s of shows) s();
    };
    btns.append(close, reset);
    box.appendChild(btns);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeEditor();
    };
    overlay.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeEditor();
    };
    this.root.appendChild(overlay);
    this.editor = overlay;
    this.editorAlive = ed.alive ?? null;
    close.focus();
  }

  private closeEditor(): void {
    this.editor?.remove();
    this.editor = null;
    this.editorAlive = null;
  }

  // ---- context menu ---------------------------------------------------------------

  openContextMenu(sx: number, sy: number, title: string, actions: ContextAction[]): void {
    this.closeContextMenu();
    const m = el('div', 'ctx');
    m.appendChild(el('div', 'ctx-title')).textContent = title;
    for (const a of actions) {
      const it = el('div', 'ctx-item' + (a.danger ? ' danger' : '') + (a.disabled ? ' disabled' : ''));
      const label = el('span', 'ctx-label');
      label.textContent = (a.checked !== undefined ? (a.checked ? '☑ ' : '☐ ') : '') + a.label;
      it.appendChild(label);
      if (a.hint) it.appendChild(el('span', 'ctx-hint')).textContent = a.hint;
      const run = () => {
        if (a.disabled) return;
        this.closeContextMenu();
        this.game.sound.ui();
        a.action();
      };
      // (a finger works an item as it's lifted, unless it scrolled a long menu meanwhile)
      let touched = false;
      it.onpointerdown = (e) => {
        e.stopPropagation();
        touched = e.pointerType === 'touch';
        if (touched || (e.button !== 0 && e.button !== 2)) return;
        run();
      };
      it.onclick = () => {
        if (touched) run();
      };
      m.appendChild(it);
    }
    this.root.appendChild(m);
    // (one taller than the screen scrolls, from the top: see .ctx)
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(sx, window.innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(sy, window.innerHeight - r.height - 4)) + 'px';
    this.ctx = m;
  }

  closeContextMenu(): void {
    this.ctx?.remove();
    this.ctx = null;
  }

  isMenuOpen(): boolean {
    return this.ctx !== null;
  }

  isPanelOpen(): boolean {
    return this.dialogClose !== null || this.editor !== null || this.layout.editing || this.overlays().some((p) => !p.classList.contains('hidden'));
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  // ---- per-frame ----------------------------------------------------------------------

  private frame(dt: number, alpha: number): void {
    // (its sliders would go on editing a copy of the object no longer in the scene)
    if (this.editorAlive && !this.editorAlive()) this.closeEditor();
    const g = this.game;
    // joining, leaving, or the host changing it: the iterations that count change
    const iters = this.session.guest?.hostIterations || 0;
    if (iters !== this.itersShown) {
      this.itersShown = iters;
      this.syncIterations();
    }
    // (in someone else's game its gravity is theirs; back on our own, ours again)
    const hostGravity = this.session.guest?.hostGravity ?? null;
    if (hostGravity === null && g.gravity !== this.ownGravity) g.setGravity(this.ownGravity);
    if (hostGravity !== this.gravityShown) {
      this.gravityShown = hostGravity;
      this.showGravity();
    }
    if ((this.game.weather.state !== this.worldShown || !!this.session.guest !== this.worldGuest) && !this.settings.classList.contains('hidden')) this.showWorld();
    this.xray.frame(alpha);
    this.detailView.frame();
    this.editOverlay.frame();
    this.maps.frame();
    this.vitals.frame(dt);
    this.cursors.frame(dt);
    this.friendsPanel.frame();
    this.layout.frame();
    const net = this.session.role;
    if (this.btnNet.classList.contains('on') !== (net !== 'off')) this.btnNet.classList.toggle('on', net !== 'off');
    if (this.btnXray.classList.contains('on') !== this.controls.xray) this.btnXray.classList.toggle('on', this.controls.xray);
    if (this.btnDetail.classList.contains('on') !== this.controls.detail) this.btnDetail.classList.toggle('on', this.controls.detail);
    if (this.showStats) {
      let parts = 0;
      for (const e of g.entities) parts += e.parts.length;
      const heavy = [
        g.stepDt > FIXED_DT ? 'longer physics steps' : '',
        !g.paused && g.simRate < g.timeScale * 0.9 ? `running at ${Math.round((g.simRate / g.timeScale) * 100)}% speed` : '',
      ].filter(Boolean).join(', ');
      this.status.textContent =
        `${g.fps.toFixed(0)} fps · step ${g.stepMs.toFixed(2)} ms · ${g.entities.length} objects · ${parts} bodies · ${g.particles.count} particles` +
        (g.paused ? ' · PAUSED' : '') + (g.timeScale !== 1 ? ` · ${g.timeScale}×` : '') +
        (heavy ? ` · heavy scene: ${heavy}` : '') +
        (net !== 'off' ? ` · ${net === 'host' ? 'hosting' : 'joined'} ${this.session.code} (${this.session.players.length} playing)` : '');
    } else this.status.textContent = '';
    const hist = this.controls.history;
    this.btnUndo.disabled = !hist.canUndo;
    this.btnRedo.disabled = !hist.canRedo;
    const undoTitle = hist.undoLabel ? `Undo: ${hist.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    if (this.btnUndo.title !== undoTitle) this.btnUndo.title = undoTitle;
    const redoTitle = hist.redoLabel ? `Redo: ${hist.redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
    if (this.btnRedo.title !== redoTitle) this.btnRedo.title = redoTitle;
    const back = hist.atCheckpoint && !this.session.guest;
    if (this.btnRewind.classList.contains('hidden') === back) this.btnRewind.classList.toggle('hidden', !back);
    const ctl = this.controls;
    const building = ctl.touchMode && (g.paused || (!!ctl.toolKind && ctl.toolKind !== 'remove') || ctl.placer.waiting);
    this.buildBar.classList.toggle('hidden', !building);
    if (building) {
      for (const { b, on, show } of this.buildBtns) {
        const hide = show ? !show() : false;
        if (b.classList.contains('hidden') !== hide) b.classList.toggle('hidden', hide);
        const lit = on ? on() : false;
        if (b.classList.contains('down') !== lit) b.classList.toggle('down', lit);
      }
    }
    const targets = this.controls.touchMode ? this.controls.touchTargets() : [];
    this.touchBar.classList.toggle('hidden', !targets.length);
    const drive = this.controls.touchMode ? this.controls.drivable() : null;
    if (this.drivePad.classList.contains('hidden') !== !drive?.drive) {
      this.drivePad.classList.toggle('hidden', !drive?.drive);
      // (the tutorial's card goes up out of their way)
      document.body.classList.toggle('driving', !!drive?.drive);
    }
    for (const b of this.aimBtns) if (b.classList.contains('hidden') !== !drive?.aim) b.classList.toggle('hidden', !drive?.aim);
    if (targets.length) {
      const label = targets.every((e) => e.frozen) ? 'Unfreeze' : 'Freeze';
      if (this.btnFreeze.textContent !== label) this.btnFreeze.textContent = label;
    }
    const h = this.controls.hover;
    let hint = this.controls.hint;
    if (!hint && h) hint = h.entity.label + (h.entity.parts.length > 1 ? ` — ${h.name}` : '') + (h.frozen ? ' (frozen)' : '');
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
  }
}

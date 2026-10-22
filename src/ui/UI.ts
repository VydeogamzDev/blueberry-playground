import type { Game } from '../world/Game';
import type { Controls, UIBridge } from '../tools/Controls';
import { CATEGORIES, type Category, type ContextAction, type ItemDef } from '../world/types';
import { ITEMS } from '../catalog/items';
import { saveToString, loadFromString } from '../world/SaveLoad';

const ICONS: Record<string, string> = {
  pause: '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>',
  step: '<svg viewBox="0 0 16 16"><path d="M3 3l7 5-7 5z"/><rect x="11" y="3" width="2" height="10"/></svg>',
  slow: '<svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 2v4l3 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  reset: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2v3h3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  save: '<svg viewBox="0 0 16 16"><path d="M3 2h8l2 2v10H3zM5 2v4h5V2M5 10h6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  load: '<svg viewBox="0 0 16 16"><path d="M2 5h4l1 1h7v7H2zM8 12V8m-2 2l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  settings: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4l1.6 1.6M11 11l1.6 1.6M3.4 12.6L5 11M11 5l1.6-1.6" stroke="currentColor" stroke-width="1.5"/></svg>',
  help: '<svg viewBox="0 0 16 16"><path d="M5.5 6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V11" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7.2" y="12.4" width="1.6" height="1.6"/></svg>',
  catalog: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg>',
};

const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1];

const HELP: [string, string][] = [
  ['Left drag', 'Grab and drag an object (physical)'],
  ['Left click (empty)', 'Spawn the selected catalog item'],
  ['Left drag (empty)', 'Box-select objects'],
  ['Shift + click', 'Add / remove from selection'],
  ['Right click', 'Context menu (right click empty space while spawning to cancel)'],
  ['Middle drag / WASD', 'Pan camera'],
  ['Mouse wheel', 'Zoom'],
  ['Q / E', 'Rotate held object · rotate selection 15° (Shift: 90°) · rotate spawn'],
  ['F', 'Activate (hold for automatic weapons)'],
  ['Z', 'Freeze / unfreeze'],
  ['N', 'Toggle no-collide'],
  ['R', 'Flip object · flip spawn while placing'],
  ['Delete / X', 'Delete selection or hovered object'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste at cursor'],
  ['Ctrl+A', 'Select all'],
  ['Space', 'Pause / resume'],
  ['. (period)', 'Step one physics tick'],
  ['T', 'Toggle slow motion'],
  ['G', 'Toggle grid'],
  ['Tab', 'Toggle catalog'],
  ['Ctrl+S / Ctrl+O', 'Quick save / quick load'],
  ['Home', 'Recenter camera'],
  ['Esc', 'Cancel / deselect'],
  ['H / F1', 'This help'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
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
  private settings!: HTMLDivElement;
  private status!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private toastTimer = 0;
  private btnPause!: HTMLButtonElement;
  private btnSlow!: HTMLButtonElement;
  private speedSel!: HTMLSelectElement;
  private catalogOpen = true;
  showStats = true;

  constructor(game: Game, controls: Controls, root: HTMLElement) {
    this.game = game;
    this.controls = controls;
    this.root = root;
    controls.ui = this;
    this.buildCatalog();
    this.buildToolbar();
    this.buildHelp();
    this.buildSettings();
    this.status = el('div', 'status');
    this.hintEl = el('div', 'hint');
    this.toastEl = el('div', 'toast');
    root.append(this.status, this.hintEl, this.toastEl);
    // keep UI clicks from reaching the canvas handlers
    for (const ev of ['pointerdown', 'wheel', 'contextmenu'] as const) {
      root.addEventListener(ev, (e) => {
        if (e.target !== root) e.stopPropagation();
      });
    }
    game.frameHandlers.push(() => this.frame());
  }

  // ---- catalog -----------------------------------------------------------------

  private buildCatalog(): void {
    this.catalog = el('div', 'catalog');
    this.strip = el('div', 'cat-strip');
    const toggle = el('button', 'cat-btn cat-toggle', ICONS.catalog);
    toggle.title = 'Toggle catalog (Tab)';
    toggle.onclick = () => this.toggleCatalog();
    this.strip.appendChild(toggle);
    for (const c of CATEGORIES) {
      const items = ITEMS.filter((i) => i.category === c.id);
      if (!items.length) continue;
      const b = el('button', 'cat-btn');
      b.title = c.label;
      b.dataset.cat = c.id;
      const icon = items[0].preview();
      const img = document.createElement('canvas');
      img.width = icon.width;
      img.height = icon.height;
      img.getContext('2d')!.drawImage(icon, 0, 0);
      img.className = 'cat-icon';
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
    const list = q
      ? ITEMS.filter((i) => (i.name + ' ' + i.category + ' ' + (i.tags ?? []).join(' ')).toLowerCase().includes(q))
      : ITEMS.filter((i) => i.category === this.category);
    this.catTitle.textContent = q ? `Search: ${list.length} result${list.length === 1 ? '' : 's'}` : CATEGORIES.find((c) => c.id === this.category)!.label;
    this.grid.innerHTML = '';
    this.itemEls.clear();
    for (const def of list) {
      const tile = el('div', 'item');
      tile.title = def.description;
      const box = el('div', 'item-preview');
      const src = def.preview();
      const cv = document.createElement('canvas');
      cv.width = src.width;
      cv.height = src.height;
      cv.getContext('2d')!.drawImage(src, 0, 0);
      // integer-scale previews to fit the tile
      const scale = Math.max(1, Math.min(4, Math.floor(56 / Math.max(src.width, src.height * 0.9))));
      cv.style.width = src.width * scale + 'px';
      cv.style.height = src.height * scale + 'px';
      if (src.width * scale > 64) {
        cv.style.width = '64px';
        cv.style.height = (src.height * 64) / src.width + 'px';
      }
      box.appendChild(cv);
      const name = el('div', 'item-name');
      name.textContent = def.name;
      tile.append(box, name);
      tile.onclick = () => {
        this.game.sound.unlock();
        this.game.sound.ui();
        this.controls.arm(def);
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
  }

  // ---- toolbar -----------------------------------------------------------------

  private buildToolbar(): void {
    const bar = el('div', 'toolbar');
    const btn = (icon: string, title: string, fn: () => void) => {
      const b = el('button', 'tb-btn', ICONS[icon]);
      b.title = title;
      b.onclick = () => {
        this.game.sound.unlock();
        fn();
      };
      bar.appendChild(b);
      return b;
    };
    this.btnPause = btn('pause', 'Pause / resume (Space)', () => this.controls.togglePause());
    btn('step', 'Step one tick (.)', () => {
      this.game.paused = true;
      this.game.stepRequests++;
      this.refreshToolbar();
    });
    this.btnSlow = btn('slow', 'Slow motion (T)', () => {
      this.game.timeScale = this.game.timeScale < 1 ? 1 : 0.25;
      this.refreshToolbar();
    });
    this.speedSel = el('select', 'tb-select');
    this.speedSel.title = 'Simulation speed';
    for (const s of SPEEDS) {
      const o = el('option');
      o.value = String(s);
      o.textContent = `${s}×`;
      this.speedSel.appendChild(o);
    }
    this.speedSel.onchange = () => {
      this.game.timeScale = parseFloat(this.speedSel.value);
      this.refreshToolbar();
    };
    bar.appendChild(this.speedSel);
    bar.appendChild(el('div', 'tb-sep'));
    btn('clear', 'Clear all objects', () => {
      this.game.clearAll();
      this.controls.clearSelection();
      this.toast('Cleared all objects');
    });
    btn('reset', 'Reset environment (objects, stains, effects)', () => {
      this.game.resetEnvironment();
      this.controls.clearSelection();
      this.game.renderer.camX = 0;
      this.game.renderer.camY = 4;
      this.toast('Environment reset');
    });
    bar.appendChild(el('div', 'tb-sep'));
    btn('save', 'Quick save (Ctrl+S)', () => this.save());
    btn('load', 'Quick load (Ctrl+O)', () => this.load());
    bar.appendChild(el('div', 'tb-sep'));
    btn('settings', 'Settings', () => this.toggle(this.settings));
    btn('help', 'Controls (H)', () => this.toggleHelp());
    this.root.appendChild(bar);
    this.refreshToolbar();
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

  private toggle(panel: HTMLElement): void {
    const show = panel.classList.contains('hidden');
    this.help.classList.add('hidden');
    this.settings.classList.add('hidden');
    panel.classList.toggle('hidden', !show);
  }

  toggleHelp(): void {
    this.toggle(this.help);
  }

  private buildHelp(): void {
    this.help = el('div', 'overlay hidden');
    const box = el('div', 'panel');
    box.appendChild(el('div', 'panel-title', 'Controls'));
    const table = el('div', 'keys');
    for (const [k, d] of HELP) {
      table.appendChild(el('div', 'key', k));
      table.appendChild(el('div', 'desc', d));
    }
    box.appendChild(table);
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.help.classList.add('hidden');
    box.appendChild(close);
    this.help.appendChild(box);
    this.help.onclick = (e) => {
      if (e.target === this.help) this.help.classList.add('hidden');
    };
    this.root.appendChild(this.help);
  }

  private buildSettings(): void {
    this.settings = el('div', 'overlay hidden');
    const box = el('div', 'panel');
    box.appendChild(el('div', 'panel-title', 'Settings'));
    const row = (label: string, input: HTMLElement) => {
      const r = el('label', 'set-row');
      r.appendChild(el('span', '', label));
      r.appendChild(input);
      box.appendChild(r);
    };
    const check = (val: boolean, fn: (v: boolean) => void) => {
      const i = el('input');
      i.type = 'checkbox';
      i.checked = val;
      i.onchange = () => fn(i.checked);
      return i;
    };
    const vol = el('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(this.game.sound.volume);
    vol.oninput = () => this.game.sound.setVolume(parseFloat(vol.value));
    row('Volume', vol);
    row('Mute', check(false, (v) => this.game.sound.setMuted(v)));
    row('Background grid', check(true, (v) => (this.game.renderer.showGrid = v)));
    row('Blood', check(true, (v) => (this.game.particles.bloodEnabled = v)));
    row('Show wires', check(true, (v) => (this.game.connections.showWires = v)));
    row('Show stats', check(true, (v) => (this.showStats = v)));
    const solver = el('select', 'tb-select');
    for (const n of [4, 6, 8, 12]) {
      const o = el('option');
      o.value = String(n);
      o.textContent = `${n} iterations`;
      solver.appendChild(o);
    }
    solver.value = String(this.game.physics.world.integrationParameters.numSolverIterations);
    solver.onchange = () => (this.game.physics.world.integrationParameters.numSolverIterations = parseInt(solver.value));
    row('Physics quality', solver);
    const io = el('div', 'set-io');
    const exp = el('button', 'panel-btn', 'Export scene…');
    exp.onclick = () => {
      const blob = new Blob([saveToString(this.game)], { type: 'application/json' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'blueberry-scene.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const imp = el('button', 'panel-btn', 'Import scene…');
    imp.onclick = () => {
      const f = el('input');
      f.type = 'file';
      f.accept = '.json,application/json';
      f.onchange = async () => {
        const file = f.files?.[0];
        if (!file) return;
        try {
          loadFromString(this.game, await file.text());
          this.controls.clearSelection();
          this.toast('Scene imported');
        } catch (err) {
          this.toast('Import failed: ' + (err as Error).message);
        }
      };
      f.click();
    };
    io.append(exp, imp);
    box.appendChild(io);
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.settings.classList.add('hidden');
    box.appendChild(close);
    this.settings.appendChild(box);
    this.settings.onclick = (e) => {
      if (e.target === this.settings) this.settings.classList.add('hidden');
    };
    this.root.appendChild(this.settings);
  }

  save(): void {
    try {
      localStorage.setItem('blueberry-quicksave', saveToString(this.game));
      this.toast('Scene saved');
    } catch (e) {
      this.toast('Save failed: ' + (e as Error).message);
    }
  }

  load(): void {
    let data: string | null = null;
    try {
      data = localStorage.getItem('blueberry-quicksave');
    } catch {
      data = null;
    }
    if (!data) {
      this.toast('No quick save found');
      return;
    }
    try {
      loadFromString(this.game, data);
      this.controls.clearSelection();
      this.toast('Scene loaded');
    } catch (e) {
      this.toast('Load failed: ' + (e as Error).message);
    }
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
      it.onpointerdown = (e) => {
        e.stopPropagation();
        if (e.button !== 0 && e.button !== 2) return;
        if (a.disabled) return;
        this.closeContextMenu();
        this.game.sound.ui();
        a.action();
      };
      m.appendChild(it);
    }
    this.root.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(sx, window.innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(sy, window.innerHeight - r.height - 4) + 'px';
    this.ctx = m;
  }

  closeContextMenu(): void {
    this.ctx?.remove();
    this.ctx = null;
  }

  isMenuOpen(): boolean {
    return this.ctx !== null;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  // ---- per-frame ----------------------------------------------------------------------

  private frame(): void {
    const g = this.game;
    if (this.showStats) {
      let parts = 0;
      for (const e of g.entities) parts += e.parts.length;
      this.status.textContent =
        `${g.fps.toFixed(0)} fps · step ${g.stepMs.toFixed(2)} ms · ${g.entities.length} objects · ${parts} bodies · ${g.particles.count} particles` +
        (g.paused ? ' · PAUSED' : '') + (g.timeScale !== 1 ? ` · ${g.timeScale}×` : '');
    } else this.status.textContent = '';
    const h = this.controls.hover;
    let hint = this.controls.hint;
    if (!hint && h) hint = h.entity.label + (h.entity.parts.length > 1 ? ` — ${h.name}` : '') + (h.frozen ? ' (frozen)' : '');
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
  }
}

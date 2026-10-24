import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import { TerrainTool } from '../tools/TerrainTool';
import {
  BUILTIN_MAPS, CustomMaps, ENDLESS_REACH, MAP_LIMITS, TERRAIN_MATS, THEMES, isBuiltin, mapFromJson, mapToJson, newMapId, sameMap, validateMap,
  type MapSpec, type TerrainMat, type ThemeId,
} from '../world/Maps';

/** What the maps panel needs of the rest of the interface (see UI). */
export interface MapsUI {
  toast(msg: string): void;
  /** A small question over everything: with `value`, a line to type in (see UI.dialog()). */
  dialog(title: string, text: string, value: string | null, okLabel: string, ok: (value: string) => void): void;
  /** Saves a file to the player's computer. */
  download(name: string, text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A map's picture by theme: the sky or the hall behind, the floor, and its own ground. */
const PREVIEW: Record<ThemeId, { back: string; floor: string; ground: string; rock: string }> = {
  concrete: { back: '#26282b', floor: '#3e4044', ground: '#5d6064', rock: '#7a736b' },
  outdoors: { back: '#84b5d8', floor: '#6b4c34', ground: '#5f8c3a', rock: '#7a736b' },
  desert: { back: '#b9c9d2', floor: '#c8a46b', ground: '#d7b77f', rock: '#a57c51' },
  night: { back: '#121a30', floor: '#36383d', ground: '#4a4d54', rock: '#7a736b' },
  snow: { back: '#c9d6e2', floor: '#e8eef3', ground: '#f2f6f9', rock: '#7a736b' },
  // (no floor: drawn as the dark it falls away into)
  void: { back: '#15171b', floor: '#0f1012', ground: '#5d6064', rock: '#7a736b' },
};
const MAT_PREVIEW: Partial<Record<TerrainMat, string>> = { concrete: '#6a6c70', brick: '#94493a', windows: '#5b3831', metal: '#66707a' };

/** How big a map is, in words: "140 × 48 m" (the endless plate's length is how far it goes). */
export function mapSize(spec: MapSpec): string {
  return spec.endless ? `${ENDLESS_REACH / 1000} km each way × ${spec.height} m` : `${spec.width} × ${spec.height} m`;
}

/** A small picture of a map to scale: its room, floor and ground. */
export function mapPreview(spec: MapSpec, w = 156, h = 52): HTMLCanvasElement {
  const cv = el('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const col = PREVIEW[spec.theme] ?? PREVIEW.concrete;
  if (spec.endless) {
    // (no walls in sight: the hall and its floor run off both sides, arrows saying so)
    g.fillStyle = col.back;
    g.fillRect(0, 0, w, h);
    g.fillStyle = col.floor;
    g.fillRect(0, h - 12, w, 12);
    g.fillStyle = '#8a8d92';
    for (const s of [-1, 1]) {
      const x = s < 0 ? 6 : w - 6;
      g.beginPath();
      g.moveTo(x, h - 6);
      g.lineTo(x - s * 7, h - 10);
      g.lineTo(x - s * 7, h - 2);
      g.closePath();
      g.fill();
    }
    return cv;
  }
  const s = Math.min(w / spec.width, (h - 6) / spec.height);
  const ox = (w - spec.width * s) / 2;
  const floor = h - 4;
  const X = (x: number) => ox + (x + spec.width / 2) * s;
  const Y = (y: number) => floor - Math.max(0, y) * s;
  g.fillStyle = '#0f1012';
  g.fillRect(0, 0, w, h);
  g.fillStyle = col.back;
  g.fillRect(ox, floor - spec.height * s, spec.width * s, spec.height * s);
  g.fillStyle = col.floor;
  g.fillRect(0, floor, w, h - floor);
  for (const p of spec.terrain) {
    g.fillStyle = p.mat === 'rock' ? col.rock : (p.mat && MAT_PREVIEW[p.mat]) || col.ground;
    g.beginPath();
    p.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.closePath();
    g.fill();
  }
  // the sea, over what's under it
  if (spec.water) {
    g.fillStyle = 'rgba(46, 104, 150, 0.8)';
    g.fillRect(X(spec.water.x0), Y(spec.water.level), (spec.water.x1 - spec.water.x0) * s, floor - Y(spec.water.level));
  }
  // a map's own snow, falling
  if (spec.weather?.snow) {
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 40; i++) g.fillRect(ox + ((i * 37) % 97) / 97 * spec.width * s, floor - spec.height * s + ((i * 53) % 89) / 89 * (spec.height * s - 4), 1, 1);
  }
  return cv;
}

/**
 * The Maps panel (the toolbar's map button): the built-in maps and the
 * player's own, each with a picture of it, a click switching to one; and New
 * map…, Edit terrain (the Terrain tool, with a small banner on screen while
 * it's on), Save, Export, Import and Delete for the map in play.
 */
export class MapsPanel {
  readonly overlay: HTMLDivElement;
  /** The player's own maps, kept in the browser. */
  readonly custom = new CustomMaps();
  /** The Terrain tool that Edit terrain turns on. */
  readonly terrain: TerrainTool;
  private game: Game;
  private controls: Controls;
  private ui: MapsUI;
  private root: HTMLElement;
  private list: HTMLDivElement;
  private note: HTMLDivElement;
  private btnDelete: HTMLButtonElement;
  private btnEdit: HTMLButtonElement;
  private btnSave: HTMLButtonElement;
  private banner: HTMLDivElement;
  private bannerName: HTMLSpanElement;

  constructor(game: Game, controls: Controls, root: HTMLElement, ui: MapsUI) {
    this.game = game;
    this.controls = controls;
    this.root = root;
    this.ui = ui;
    this.terrain = new TerrainTool(game, controls);
    this.terrain.onStop = () => this.editDone();

    this.overlay = el('div', 'overlay hidden');
    const box = el('div', 'panel maps-panel');
    this.overlay.appendChild(box);
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.hide();
    };
    box.appendChild(el('div', 'panel-title', 'Maps'));
    box.appendChild(el('div', 'panel-note', 'Pick a map to play on. Switching clears the scene.'));
    this.list = el('div', 'map-list');
    box.appendChild(this.list);
    this.note = el('div', 'panel-note map-current');
    box.appendChild(this.note);
    const row = el('div', 'set-io map-btns');
    const btn = (label: string, title: string, fn: () => void) => {
      const b = el('button', 'panel-btn', label);
      b.title = title;
      b.onclick = () => {
        this.game.sound.ui('click');
        fn();
      };
      row.appendChild(b);
      return b;
    };
    btn('New map…', 'Make a map of your own: its size and look', () => this.newMap());
    this.btnEdit = btn('Edit terrain', 'Draw ground on this map, and take it away', () => this.edit());
    this.btnSave = btn('Save', 'Keep this map in your maps', () => this.save());
    btn('Export…', 'Save this map to a file', () => this.exportFile());
    btn('Import…', 'Open a map from a file', () => this.importFile());
    this.btnDelete = btn('Delete', 'Delete this map from your maps', () => this.remove());
    box.appendChild(row);
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.hide();
    box.appendChild(close);
    root.appendChild(this.overlay);

    // while the map is edited: what's being edited, what the ground is made of, and Done
    this.banner = el('div', 'map-banner hidden');
    this.bannerName = el('span', 'map-banner-name');
    const mat = el('select', 'tb-select');
    mat.title = 'What the ground drawn is made of';
    for (const m of TERRAIN_MATS) mat.appendChild(el('option', '', m.name)).value = m.id;
    mat.value = this.terrain.mat;
    mat.onchange = () => {
      this.terrain.mat = mat.value as TerrainMat;
      // (left focused, it would take the keys meant for the sandbox)
      mat.blur();
    };
    const done = el('button', 'panel-btn', 'Done');
    done.title = 'Stop editing the map (and keep it in your maps)';
    done.onclick = () => {
      this.game.sound.ui('click');
      this.controls.terrain?.stop();
    };
    this.banner.append(el('span', '', 'Editing map:'), this.bannerName, mat, done);
    root.appendChild(this.banner);
  }

  /** Fills in the list of maps (as the panel opens). */
  render(): void {
    const cur = this.game.map;
    this.list.textContent = '';
    const add = (spec: MapSpec, note: string) => {
      const b = el('button', 'map-card');
      b.classList.toggle('active', spec.id === cur.id);
      b.title = `Play on ${spec.name}`;
      b.appendChild(mapPreview(spec));
      b.appendChild(el('div', 'map-name', spec.name));
      b.appendChild(el('div', 'map-size', `${mapSize(spec)}${note}`));
      b.onclick = () => {
        this.game.sound.ui('select');
        this.choose(spec);
      };
      this.list.appendChild(b);
    };
    for (const m of BUILTIN_MAPS) add(m, '');
    for (const m of this.custom.list) add(m, ' · yours');
    // (the map in play, edited or loaded with a scene, before it's kept)
    if (!isBuiltin(cur) && !this.custom.get(cur.id)) add(cur, ' · not saved');
    this.note.textContent = `Playing on ${cur.name}, ${mapSize(cur)}.`;
    this.btnDelete.disabled = !this.custom.get(cur.id);
    // (the endless plate is a bare floor, kept as it is: no ground to draw on it, nothing to keep a copy of)
    this.btnEdit.disabled = this.btnSave.disabled = !!cur.endless;
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }

  /** Shows the banner while the map is being edited (every frame). */
  frame(): void {
    const on = this.controls.terrain !== null;
    if (this.banner.classList.contains('hidden') === on) this.banner.classList.toggle('hidden', !on);
    if (on && this.bannerName.textContent !== this.game.map.name) this.bannerName.textContent = this.game.map.name;
  }

  /** Switches to a map (asking first if that clears away a scene with things in it), then `then`. */
  private choose(spec: MapSpec, then?: () => void): void {
    const go = () => {
      this.controls.terrain?.stop();
      this.controls.switchMap(spec);
      this.hide();
      this.ui.toast(`Map: ${spec.name}`);
      then?.();
    };
    if (this.game.entities.length) this.ui.dialog('Switch map', `Switch to “${spec.name}”? Everything in the scene is cleared away.`, null, 'Switch', go);
    else go();
  }

  /** Edit terrain: the Terrain tool on the map in play. */
  private edit(): void {
    if (this.game.map.endless) return;
    this.hide();
    const copy = isBuiltin(this.game.map);
    this.terrain.start();
    this.ui.toast(`${copy ? 'Your changes make a copy of this map. ' : ''}${this.controls.touchMode ? 'Draw ground; the Remove tool takes it away' : 'Draw ground; right-click it to take it away'}`);
  }

  /** Done editing: a changed map is kept in the player's maps. */
  private editDone(): void {
    const map = this.game.map;
    // (every change undone back to a built-in map: nothing of the player's to keep)
    if (!this.terrain.changed || isBuiltin(map)) return;
    this.ui.toast(this.custom.save(map) ? `Kept “${map.name}” in your maps` : 'Not kept: the browser’s storage is full');
  }

  /** Save: keeps the map in play in the player's maps, under a name (a built-in one as a copy). */
  private save(): void {
    const cur = this.game.map;
    if (cur.endless) return;
    const copy = isBuiltin(cur);
    this.ui.dialog('Save map', 'Its name in your maps:', copy ? `${cur.name} copy` : cur.name, 'Save', (name) => {
      const spec: MapSpec = { ...cur, id: copy ? newMapId() : cur.id, name: name.trim().slice(0, 40) || cur.name };
      if (!this.custom.save(spec)) {
        this.ui.toast('Not saved: the browser’s storage is full');
        return;
      }
      // (the same map, under its own name and id now)
      this.game.map = spec;
      this.render();
      this.ui.toast(`Saved “${spec.name}” in your maps`);
    });
  }

  /** Export: the map in play to a file. */
  private exportFile(): void {
    const m = this.game.map;
    this.ui.download(`${m.name.replace(/[^\w\- ]+/g, '').trim() || 'map'}.map.json`, mapToJson(m));
  }

  /** Import: a map from a file joins the player's maps, and is switched to. */
  private importFile(): void {
    const f = el('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0];
      if (!file) return;
      let spec: MapSpec | null;
      try {
        spec = mapFromJson(await file.text());
      } catch {
        spec = null;
      }
      if (!spec) {
        this.ui.toast('That isn’t a map file');
        return;
      }
      if (!isBuiltin(spec)) {
        // (a different map of the same id already kept: this one gets its own)
        const mine = this.custom.get(spec.id);
        if (mine && !sameMap(mine, spec)) spec = { ...spec, id: newMapId() };
        if (!this.custom.save(spec)) this.ui.toast('Not kept: the browser’s storage is full');
      }
      this.render();
      this.choose(spec);
    };
    f.click();
  }

  /** Delete: the map in play out of the player's maps (it stays in play until another is chosen). */
  private remove(): void {
    const cur = this.game.map;
    if (!this.custom.get(cur.id)) return;
    this.ui.dialog('Delete map', `Delete “${cur.name}” from your maps for good?`, null, 'Delete', () => {
      this.ui.toast(this.custom.remove(cur.id) ? `Deleted “${cur.name}”` : 'Could not delete it: the browser’s storage is unavailable');
      this.render();
    });
  }

  /** New map…: asks its name, size and look, then switches to it with the Terrain tool on. */
  private newMap(): void {
    const overlay = el('div', 'overlay');
    const box = el('div', 'panel dialog-panel');
    box.appendChild(el('div', 'panel-title', 'New map'));
    const row = (label: string, input: HTMLElement) => {
      const r = el('label', 'set-row');
      r.append(el('span', '', label), input);
      box.appendChild(r);
    };
    const L = MAP_LIMITS;
    const name = el('input', 'search map-field');
    name.value = `Map ${this.custom.list.length + 1}`;
    name.maxLength = 40;
    const num = (value: number, min: number, max: number) => {
      const i = el('input', 'edit-num');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = '10';
      i.value = String(value);
      return i;
    };
    const width = num(200, L.minWidth, L.maxWidth);
    const height = num(60, L.minHeight, L.maxHeight);
    const theme = el('select', 'tb-select');
    for (const t of THEMES) theme.appendChild(el('option', '', t.name)).value = t.id;
    row('Name', name);
    row(`Width (${L.minWidth}–${L.maxWidth} m)`, width);
    row(`Height (${L.minHeight}–${L.maxHeight} m)`, height);
    row('Look', theme);
    const close = () => overlay.remove();
    const accept = () => {
      close();
      const spec = validateMap({ id: newMapId(), name: name.value, width: Number(width.value) || 200, height: Number(height.value) || 60, theme: theme.value, terrain: [] });
      if (!spec) return;
      if (!this.custom.save(spec)) this.ui.toast('Not kept: the browser’s storage is full');
      this.choose(spec, () => this.terrain.start());
    };
    const btns = el('div', 'set-io');
    const yes = el('button', 'panel-btn', 'Create');
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
    name.focus();
    name.select();
  }
}

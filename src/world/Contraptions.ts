import type { Snapshot } from './Snapshot';
import type { Entity } from './Entity';
import type { ItemDef } from './types';
import { PX } from '../engine/constants';
import { store } from '../engine/Store';
import { stats } from './Stats';

/** A saved creation: a group of things and how they're joined, to spawn again from the toybox. */
export interface Contraption {
  id: string;
  name: string;
  snap: Snapshot;
  /** A picture of it (PNG data URL). */
  thumb: string;
}

/** What an exported contraption file holds. */
interface ContraptionFile {
  type: 'blueberry-contraption';
  version: 1;
  name: string;
  snap: Snapshot;
  thumb: string;
}

const KEY = 'blueberry-contraptions';

/**
 * The snapshot standing still. A contraption saved on the move (a car driven along,
 * then saved) is spawned again at rest, its wheels not turning: it kept the speed it
 * had, and drove off at 17 m/s the moment it was put down.
 */
function atRest(snap: Snapshot): Snapshot {
  return { ...snap, entities: snap.entities.map((e) => ({ ...e, parts: e.parts.map((p) => ({ ...p, vx: 0, vy: 0, av: 0 })) })) };
}

/** The player's contraptions, kept in the browser's storage, as toybox items. */
export class Contraptions {
  list: Contraption[] = [];
  /** Called when one is added, renamed or removed. */
  onChange: (() => void) | null = null;
  private defs = new Map<string, ItemDef>();

  constructor() {
    this.load();
    // ones made in the other version (or imported) while this one plays: into the toybox at once
    store.onChange((keys, bySync) => {
      if (!bySync || !keys.includes(KEY)) return;
      this.load();
      this.defs.clear();
      this.onChange?.();
    });
  }

  private load(): void {
    try {
      const data = JSON.parse(store.getItem(KEY) ?? '[]') as Contraption[];
      this.list = Array.isArray(data) ? data.filter((c) => c && typeof c.name === 'string' && Array.isArray(c.snap?.entities)) : [];
    } catch {
      this.list = [];
    }
  }

  /** Saves it; returns false (and keeps nothing) when the browser's storage is full. */
  add(name: string, snap: Snapshot, thumb: string): Contraption | null {
    const c: Contraption = { id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name, snap: atRest(snap), thumb };
    this.list.push(c);
    if (!this.persist()) {
      this.list.pop();
      return null;
    }
    this.onChange?.();
    stats.add('saved');
    return c;
  }

  rename(id: string, name: string): void {
    const c = this.list.find((x) => x.id === id);
    if (!c) return;
    c.name = name;
    this.defs.delete(id);
    this.persist();
    this.onChange?.();
  }

  remove(id: string): void {
    this.list = this.list.filter((x) => x.id !== id);
    this.defs.delete(id);
    this.persist();
    this.onChange?.();
  }

  private persist(): boolean {
    try {
      store.setItem(KEY, JSON.stringify(this.list));
      return true;
    } catch {
      return false;
    }
  }

  /** Toybox items for them, newest last. */
  items(): ItemDef[] {
    return this.list.map((c) => this.defOf(c));
  }

  defOf(c: Contraption): ItemDef {
    let d = this.defs.get(c.id);
    if (!d) {
      const n = c.snap.entities.length;
      d = {
        id: 'contraption:' + c.id, name: c.name, category: 'Contraptions',
        description: `Your contraption: ${n} object${n === 1 ? '' : 's'}. Right-click it here to rename, export or delete it.`,
        tags: ['contraption', 'creation', 'saved'],
        preview: () => document.createElement('canvas'),
        // (at rest: those saved before they were kept so)
        snapshot: atRest(c.snap), thumb: c.thumb,
      };
      this.defs.set(c.id, d);
    }
    return d;
  }

  /** The contraption a toybox item is for. */
  of(def: ItemDef): Contraption | undefined {
    return this.list.find((c) => 'contraption:' + c.id === def.id);
  }

  /** It as a file's text, to send to someone. */
  exportText(c: Contraption): string {
    const f: ContraptionFile = { type: 'blueberry-contraption', version: 1, name: c.name, snap: c.snap, thumb: c.thumb };
    return JSON.stringify(f);
  }

  /** Is this parsed file an exported contraption? */
  static isFile(data: unknown): data is ContraptionFile {
    const f = data as ContraptionFile;
    return !!f && f.type === 'blueberry-contraption' && Array.isArray(f.snap?.entities);
  }

  importFile(f: ContraptionFile): Contraption | null {
    return this.add(String(f.name || 'Contraption'), { entities: f.snap.entities, connections: f.snap.connections ?? [] }, typeof f.thumb === 'string' ? f.thumb : '');
  }
}

/**
 * A picture of some things as they are now (their sprites, unpainted), no
 * bigger than `max` pixels across: the toybox shows it for a contraption.
 */
export function thumbnail(list: Entity[], max = 96): string {
  const parts = list.flatMap((e) => e.parts.filter((p) => !p.destroyed)).sort((a, b) => a.z - b.z);
  if (!parts.length) return '';
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    const r = (Math.hypot(p.w, p.h) / 2 + 1) * PX + Math.hypot(p.spriteOffset.x, p.spriteOffset.y) * PX;
    x0 = Math.min(x0, p.x - r);
    x1 = Math.max(x1, p.x + r);
    y0 = Math.min(y0, p.y - r);
    y1 = Math.max(y1, p.y + r);
  }
  // one sprite pixel to one picture pixel, unless that's too big
  const s = Math.min(1 / PX, max / Math.max(x1 - x0, y1 - y0));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil((x1 - x0) * s));
  cv.height = Math.max(1, Math.ceil((y1 - y0) * s));
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = s < 1 / PX;
  for (const p of parts) {
    const img = p.art.toCanvas(0);
    g.save();
    g.translate((p.x - x0) * s, (y1 - p.y) * s);
    g.rotate(-p.a);
    g.scale(p.flip, 1);
    const k = PX * s;
    g.drawImage(img, (p.spriteOffset.x - p.w / 2) * k, (-p.spriteOffset.y - p.h / 2) * k, p.w * k, p.h * k);
    g.restore();
  }
  return cv.toDataURL('image/png');
}

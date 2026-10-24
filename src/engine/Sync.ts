import { desktop } from './Desktop';
import { fromFile, mergeStates, sameState, store as gameStore, toFile, type Store, type SyncState } from './Store';

/**
 * Keeps the browser and desktop versions' saves in step, without a server or
 * accounts: both merge their store (see Store) with one file,
 * blueberry-sync.json, in a folder both can reach. The desktop app syncs
 * through Documents\Blueberry Playground unless told another; a browser links
 * to that folder (or any) with the File System Access API (Chrome and Edge)
 * and remembers it. A folder in OneDrive or Dropbox carries the saves to other
 * computers too. They merge as the game starts, when its window comes back to
 * the front, and a moment after each change. Browsers without that API
 * (Firefox, Safari) carry saves over with Export / Import everything instead,
 * a file of the same kind.
 */

/** The file in the folder. */
export const SYNC_FILE = 'blueberry-sync.json';
/** After a change, how long to wait for more before syncing (ms). */
const AFTER_CHANGE = 1500;
/** Coming back to the front syncs at most this often (ms). */
const FOCUS_GAP = 3000;
/** At start, the game waits this long for the folder at most (ms) (a cloud drive may be fetching the file), then goes on and takes the merge when it comes. */
const START_WAIT = 3000;
/** Saves the running game takes in as a merge changes them (the rest apply when it next starts: see SyncStatus.stale). */
const LIVE = new Set(['blueberry-contraptions', 'blueberry-maps', 'blueberry-quicksave']);

/** A folder to sync through. */
export interface Folder {
  /** As shown: the desktop knows its path; a browser only its name. */
  name: string;
  /** The sync file's text (null: there's none yet). */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export interface SyncStatus {
  /** A folder can be linked here: the desktop app, or a browser with the File System Access API. */
  canLink: boolean;
  /** The linked folder (see Folder.name), or null. */
  folder: string | null;
  /** A browser that must be let into the folder again (a click on Allow) before it can sync. */
  needsAllow: boolean;
  /** Linked until the page closes only: the browser couldn't keep the link. */
  forNow: boolean;
  /** When it last synced (ms since 1970), or 0. */
  last: number;
  /** What went wrong the last time, or ''. */
  error: string;
  busy: boolean;
  /** Saves changed by a sync or an import after the game had read them: some apply when it next starts. */
  stale: boolean;
}

type Permission = 'granted' | 'denied' | 'prompt';
/** A folder the player picked (the parts of the File System Access API that not every browser's types have). */
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Permission>;
}
type Picker = (o: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<DirHandle>;

const picker = (): Picker | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker);

/** The browser keeps the picked folder's handle in IndexedDB (localStorage can't hold one). */
const DB = 'blueberry-playground';
const KEPT = 'kept';
const FOLDER_KEY = 'sync-folder';

function kept<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((res, rej) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEPT);
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(KEPT, mode);
      const req = fn(tx.objectStore(KEPT));
      tx.oncomplete = () => {
        db.close();
        res(req.result as T);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        rej(tx.error ?? req.error);
      };
    };
  });
}

function handleFolder(dir: DirHandle): Folder {
  return {
    name: dir.name,
    async read() {
      try {
        return await (await (await dir.getFileHandle(SYNC_FILE)).getFile()).text();
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError') return null;
        throw e;
      }
    },
    async write(text) {
      // (the browser writes beside the file and swaps it in on close: never half a file)
      const w = await (await dir.getFileHandle(SYNC_FILE, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
  };
}

function desktopFolder(path: string): Folder {
  return { name: path, read: () => desktop!.sync.read(), write: (text) => desktop!.sync.write(text) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Sync {
  readonly status: SyncStatus;
  private listeners = new Set<() => void>();
  private folder: Folder | null = null;
  private dir: DirHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** Changed here since a sync last wrote it out. */
  private dirty = false;
  /** The game has read its saves: a merge's changes to them may not show until it restarts. */
  private live = false;
  private started = false;
  private lastFocus = -Infinity;
  /** Which copy wrote the file (for people reading it). */
  private readonly from = desktop ? 'desktop' : 'browser';

  constructor(private store: Store) {
    this.status = { canLink: !!desktop || !!picker(), folder: null, needsAllow: false, forNow: false, last: 0, error: '', busy: false, stale: false };
    store.onChange((_keys, bySync) => {
      if (!bySync) this.changed();
    });
  }

  /** Called whenever the status changes. Returns a call that stops it. */
  onStatus(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * As the game starts, before it reads its saves: finds the linked folder and
   * merges with it (for START_WAIT at most), then keeps in step.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    addEventListener('focus', () => this.focused());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.focused();
    });
    // (a browser can't finish a write as its page closes: its last changes sync the next time it's opened)
    if (desktop) addEventListener('beforeunload', () => this.lastSync());
    try {
      await this.find();
      if (this.folder) await Promise.race([this.sync(), new Promise((res) => setTimeout(res, START_WAIT))]);
    } catch (e) {
      this.fail(e);
    }
  }

  /** The game has read its saves (see SyncStatus.stale). */
  loaded(): void {
    this.live = true;
  }

  /** Syncs through this folder from now on (a picked one, or the tests' own). */
  async use(folder: Folder): Promise<void> {
    this.folder = folder;
    Object.assign(this.status, { folder: folder.name, needsAllow: false, error: '', last: 0 });
    await this.sync();
  }

  /** Asks for a folder to sync through (a click's: a browser asks only then). */
  async link(): Promise<void> {
    try {
      if (desktop) {
        const path = await desktop.sync.choose();
        if (path) await this.use(desktopFolder(path));
        return;
      }
      const pick = picker();
      if (!pick) return;
      let dir: DirHandle;
      try {
        dir = await pick({ id: 'blueberry-sync', mode: 'readwrite', startIn: 'documents' });
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
        throw e;
      }
      this.dir = dir;
      this.status.forNow = !(await kept('readwrite', (s) => s.put(dir, FOLDER_KEY)).then(() => true, () => false));
      await this.use(handleFolder(dir));
    } catch (e) {
      this.fail(e);
    }
  }

  /** Stops syncing (the folder and its file stay as they are). */
  async unlink(): Promise<void> {
    try {
      if (desktop) await desktop.sync.unlink();
      else await kept('readwrite', (s) => s.delete(FOLDER_KEY));
    } catch {
      // (not kept anyway)
    }
    this.folder = null;
    this.dir = null;
    Object.assign(this.status, { folder: null, needsAllow: false, forNow: false, last: 0, error: '' });
    this.notify();
  }

  /** Sync now (a click's): a browser that must be let into the folder again asks first. */
  async now(): Promise<void> {
    if (this.status.needsAllow && this.dir) {
      try {
        if ((await this.dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Not allowed into the folder');
      } catch (e) {
        this.fail(e);
        return;
      }
      this.status.needsAllow = false;
      this.folder = handleFolder(this.dir);
    }
    await this.sync();
  }

  /** Merges with the folder's file (one merge at a time: one asked for meanwhile runs after it). */
  sync(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.run();
      } while (this.again);
      this.running = null;
    })();
    return this.running;
  }

  /** Everything synced, as a file to keep or carry to another copy (Import everything takes it). */
  exportText(): string {
    return toFile(this.store.state(), this.from);
  }

  /** Takes in an exported (or sync) file, merging: the newer of each thing is kept. Returns how many saves changed. */
  async importText(text: string): Promise<number> {
    const theirs = fromFile(text);
    if (!theirs) throw new Error('that isn’t a Blueberry Playground saves file');
    const { changed, failed } = this.take(theirs);
    if (failed.length) throw new Error(`${failed.length} saves didn’t fit in this browser’s storage`);
    if (this.folder) await this.sync();
    return changed.length;
  }

  private async find(): Promise<void> {
    if (desktop) {
      const path = await desktop.sync.folder();
      if (path) this.folder = desktopFolder(path);
      this.status.folder = path;
      return;
    }
    if (!picker()) return;
    const dir = await kept<DirHandle | undefined>('readonly', (s) => s.get(FOLDER_KEY)).catch(() => undefined);
    if (!dir) return;
    this.dir = dir;
    this.status.folder = dir.name;
    // (Chrome lets a page back into a folder it was given only after a click, unless the player said "on every visit")
    if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') this.folder = handleFolder(dir);
    else this.status.needsAllow = true;
    this.notify();
  }

  private async run(): Promise<void> {
    const folder = this.folder;
    if (!folder) return;
    this.status.busy = true;
    this.notify();
    try {
      const text = await folder.read();
      const theirs = text === null ? null : fromFile(text);
      // (someone else's file of that name is left alone)
      if (text !== null && !theirs) throw new Error(`the ${SYNC_FILE} there isn’t a Blueberry Playground one`);
      this.dirty = false;
      const { merged, failed } = theirs ? this.take(theirs) : { merged: this.store.state(), failed: [] };
      if (!theirs || !sameState(merged, theirs)) await folder.write(toFile(merged, this.from));
      this.status.last = Date.now();
      this.status.error = failed.length ? `${failed.length} saves from the folder didn’t fit in this browser’s storage` : '';
    } catch (e) {
      this.dirty = true;
      this.fail(e);
    } finally {
      this.status.busy = false;
      this.notify();
    }
  }

  /** Merges another copy's saves into the store. */
  private take(theirs: SyncState): { merged: SyncState; changed: string[]; failed: string[] } {
    const merged = mergeStates(this.store.state(), theirs);
    const { changed, failed } = this.store.adopt(merged);
    if (this.live && changed.some((k) => !LIVE.has(k))) this.status.stale = true;
    return { merged, changed, failed };
  }

  /** The desktop window is closing: the last changes go into the folder now (synchronously: nothing waits for a promise then). */
  private lastSync(): void {
    if (!desktop || !this.folder || !this.dirty) return;
    try {
      const text = desktop.sync.readNow();
      const theirs = text === null ? null : fromFile(text);
      if (text !== null && !theirs) return;
      const merged = theirs ? mergeStates(this.store.state(), theirs) : this.store.state();
      if (!theirs || !sameState(merged, theirs)) desktop.sync.writeNow(toFile(merged, this.from));
    } catch {
      // (it syncs as the app next starts)
    }
  }

  private changed(): void {
    this.dirty = true;
    if (!this.folder) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), AFTER_CHANGE);
  }

  private focused(): void {
    if (!this.folder || performance.now() - this.lastFocus < FOCUS_GAP) return;
    this.lastFocus = performance.now();
    void this.sync();
  }

  private fail(e: unknown): void {
    this.status.error = message(e);
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** The game's sync (see Sync). */
export const sync = new Sync(gameStore);

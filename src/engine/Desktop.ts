import type { FpsCap } from './Graphics';

/**
 * What the desktop app gives the game (desktop/preload.cjs puts it on the page
 * as window.desktop; a browser has none). The game is the same in both: this is
 * how it tells which it's in, and reaches the files and settings a page can't.
 */
export interface DesktopBridge {
  /** The app's version (package.json's), and Electron's and Chromium's under it. */
  version: string;
  electron: string;
  chrome: string;
  /** The refresh rate of the screen the window is on (Hz), as the system reports it. */
  displayHz: number;
  /**
   * Started with Chromium's frame-rate limit and V-sync off, for a cap above the
   * screen's refresh (or none): animation frames come as fast as they can, and
   * are all shown. The switches take only at launch (see frameCap()).
   */
  uncapped: boolean;
  /** Started to check itself and quit (npm run desktop -- --smoke): the frame rate cap to check at (if one was given), and whether to time a crowd too. */
  smoke: { fps: FpsCap | null; bench: boolean } | null;
  /** Where the app keeps its files (the store's among them). */
  dataDir: string;
  store: DesktopStore;
  sync: DesktopSync;
  /** The frame rate cap was changed: true when the app must restart for it (see uncapped). */
  frameCap(cap: FpsCap): Promise<boolean>;
  /** Closes the app and opens it again (saves are written first). */
  restart(): void;
  /** Called when the window moves to a screen with another refresh rate. */
  onDisplayHz(fn: (hz: number) => void): void;
  /** The self-check's findings, printed by the app before it quits. */
  smokeDone(report: unknown): void;
}

/** The app's own store (see Store): a file in its data folder, written by the app a moment after each change. */
export interface DesktopStore {
  /** Everything kept, read from disk as the window opened (before the game started). */
  load(): Record<string, string>;
  /** Changes (null: removed), for the app to write to disk. */
  write(changes: Record<string, string | null>): void;
  /** The same, written to disk before it returns (the window is closing). */
  flush(changes: Record<string, string | null>): void;
  /** What the file on disk holds for a key, read back from it (the self-check's). */
  readBack(key: string): string | null;
}

/** The folder the desktop syncs saves through (see Sync): Documents\Blueberry Playground unless the player picks another. */
export interface DesktopSync {
  /** Its path, or null when unlinked. */
  folder(): Promise<string | null>;
  /** Asks for another folder (null: not changed). */
  choose(): Promise<string | null>;
  unlink(): Promise<void>;
  /** The sync file's text (null: there's none yet). */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** The same two at once, for the last sync as the window closes. */
  readNow(): string | null;
  writeNow(text: string): void;
  /** Opens the folder in Explorer. */
  reveal(): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** The desktop app's bridge, or null in a browser. */
export const desktop: DesktopBridge | null = (typeof window !== 'undefined' && window.desktop) || null;

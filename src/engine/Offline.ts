import { createOfflineManager, type OfflineManager, type OfflineStatus } from '../../offline/kit/offline-client.js';
import { desktop } from './Desktop';

/**
 * Playing offline, on the website (the Game Offline Reliability Kit, in offline/):
 * a service worker keeps every file of this build, checked against the build's
 * list of them (offline/tools/prepare-offline.mjs makes it, after `vite build`),
 * so the game opens and plays with no signal, from the home screen too. A new
 * version downloads in the background and is only swapped in when the player
 * says so (see onUpdate). Not in the desktop app, the standalone page or `npm run dev`.
 */
class Offline {
  private manager: OfflineManager | null = null;
  private listeners: (() => void)[] = [];
  /** How much is kept for offline (null until the worker has said). */
  status: OfflineStatus | null = null;
  /** What it's doing, in words for Settings ('' when there's nothing to say). */
  note = '';
  /** Whether it runs here at all. */
  readonly supported = import.meta.env.PROD && !desktop && location.protocol !== 'file:' && 'serviceWorker' in navigator;
  /** Called with the way to switch to a new version, once one has fully downloaded. */
  onUpdate: ((activate: () => Promise<boolean>) => void) | null = null;
  /** Called just before the page reloads into a new version: whatever must be kept, kept. */
  beforeReload: (() => void) | null = null;

  /** After the game has started (nothing here holds it up). */
  async start(): Promise<void> {
    if (!this.supported || this.manager) return;
    const info = (await (await fetch('/build-info.json')).json()) as { appId: string; buildId: string };
    const m = (this.manager = createOfflineManager({
      appId: info.appId,
      buildId: info.buildId,
      beforeReload: () => this.beforeReload?.(),
      onStatus: (e) => {
        if (e.type === 'offline-status') this.status = e as unknown as OfflineStatus;
        const say: Record<string, string> = {
          'weak-signal': 'No usable signal: playing from what’s saved',
          offline: 'No signal: playing from what’s saved',
          downloading: 'Downloading a new version…',
          installing: 'Downloading a new version in the background…',
          'update-ready': 'A new version is ready',
          current: 'Up to date',
          'save-failed': 'Couldn’t save before updating',
          'registration-unavailable': 'This browser won’t keep the game for offline play',
        };
        if (say[e.type]) this.note = say[e.type];
        if (e.type === 'sync-result') void this.refresh();
        this.changed();
      },
      onUpdateReady: ({ activate }) => this.onUpdate?.(activate),
    }));
    await m.start();
    // (a browser may clear a site's data when space runs short; this asks it not to: no promise on an iPhone)
    void m.protectStorage();
  }

  /** Asks the worker how much is kept. */
  async refresh(deep = false): Promise<void> {
    if (!this.manager) return;
    try {
      this.status = await this.manager.status(deep);
    } catch {
      /* not running yet */
    }
    this.changed();
  }

  /** Fetches everything not yet kept (Settings' Save for offline). */
  async saveAll(): Promise<void> {
    if (!this.manager) return;
    this.note = 'Saving every file…';
    this.changed();
    const r = await this.manager.warm().catch((e) => ({ ok: false, reason: String(e) }));
    this.note = r.ok ? 'Every file saved for offline play' : `Not finished: ${r.reason ?? 'try again with a good signal'}`;
    await this.refresh();
  }

  /** Looks for a new version now. */
  async checkForUpdate(): Promise<void> {
    if (!this.manager) return;
    this.note = 'Checking…';
    this.changed();
    const r = await this.manager.check({ manual: true });
    if (!r.ok && r.reason) this.note = /cooldown|Offline/i.test(r.reason) ? 'No usable signal: try again in a minute' : 'Couldn’t check: try again later';
    this.changed();
  }

  /** In words: how ready it is to play offline. */
  summary(): string {
    if (!this.supported) return 'Only the website plays offline (installed from the browser)';
    const s = this.status;
    if (!s?.coreTotal) return 'Not ready yet: open the game once with a good signal';
    if (s.ready) return 'Ready to play offline ✓';
    const have = s.coreHave + s.mediaHave;
    const all = s.coreTotal + s.mediaTotal;
    return `${s.coreHave === s.coreTotal ? 'Plays offline' : 'Not ready yet'}; ${have} of ${all} files saved${s.mediaHave < s.mediaTotal ? ' (sounds still downloading)' : ''}`;
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  private changed(): void {
    for (const f of this.listeners) f();
  }
}

export const offline = new Offline();

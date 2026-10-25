import { desktop } from '../engine/Desktop';
import { store } from '../engine/Store';
import { sync, SYNC_FILE } from '../engine/Sync';

type Row = (label: string, input: HTMLElement, hint?: string) => HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, fn: () => void): HTMLButtonElement {
  const b = el('button', 'set-preset', label);
  b.onclick = fn;
  return b;
}

/** "just now", "5 min ago"… */
function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

const size = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

/**
 * Settings > Saves and sync: where saves are kept, the folder they sync through
 * with the other version (see engine/Sync), and all of them to a file and back
 * (for a browser that can't link a folder, or a backup).
 */
export function savesSettings(row: Row, o: { toast(msg: string): void; download(name: string, text: string): void }): void {
  const s = sync.status;
  const kept = el('span', 'set-note');
  row('Saves kept', kept);

  const name = el('span', 'set-sync-name');
  const link = button('Link folder…', () => void sync.link());
  const allow = button('Allow', () => void sync.now());
  allow.title = 'The browser asks before it lets the game back into the folder';
  const now = button('Sync now', () => void sync.now());
  const unlink = button('Unlink', () => void sync.unlink());
  const folderBox = el('div', 'set-sync');
  folderBox.append(name, link, allow, now, unlink);
  if (desktop) folderBox.appendChild(button('Open', () => desktop!.sync.reveal()));
  const folderHint = desktop
    ? `The desktop version and the browser one (Chrome or Edge) keep each other’s saves up to date through ${SYNC_FILE} in this folder. Put it in OneDrive or Dropbox and it syncs between computers too.`
    : `Link the folder the desktop version syncs to (Blueberry Playground, in Documents) and the two keep each other’s saves up to date. Put it in OneDrive or Dropbox and it syncs between computers too.`;
  if (s.canLink) row('Sync folder', folderBox, folderHint);
  else row('Sync folder', el('span', 'set-note', 'This browser can’t link a folder (Chrome and Edge can): carry saves over with Export and Import'));

  const state = el('span', 'set-note');
  const restart = button(desktop ? 'Restart' : 'Reload', () => (desktop ? desktop.restart() : location.reload()));
  restart.title = 'Starts the game again with every save as synced (the scene in the sandbox isn’t kept: quick save it first)';
  const stateBox = el('div', 'set-sync');
  stateBox.append(state, restart);
  const stateRow = row('Synced', stateBox);

  const exp = button('Export everything…', () => {
    const day = new Date().toISOString().slice(0, 10);
    o.download(`blueberry-saves-${day}.json`, sync.exportText());
  });
  const imp = button('Import everything…', () => {
    const f = el('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        const n = await sync.importText(await file.text());
        o.toast(n ? `Imported: ${n} ${n === 1 ? 'save' : 'saves'} changed` : 'Nothing new in that file');
      } catch (e) {
        o.toast('Import failed: ' + (e as Error).message);
      }
    };
    f.click();
  });
  const io = el('div', 'set-sync');
  io.append(exp, imp);
  row('Everything', io, 'Every save and setting in one file (graphics aside: they stay with each computer). Import merges a file in, keeping the newer of each thing.');

  const show = () => {
    const where = store.kind === 'desktop' ? `in the app’s data folder (${desktop?.dataDir ?? ''})` : store.kind === 'browser' ? 'in this browser (cleared with its site data)' : 'nowhere: this browser won’t keep anything (a private window?), so it’s all gone when the page closes';
    kept.textContent = `${size(store.size())}, ${where}`;
    name.textContent = s.folder ?? 'None';
    name.title = s.folder ?? '';
    link.textContent = s.folder ? 'Change…' : 'Link folder…';
    allow.hidden = !s.needsAllow;
    now.hidden = !s.folder || s.needsAllow;
    unlink.hidden = !s.folder;
    now.disabled = s.busy;
    const parts: string[] = [];
    if (s.busy) parts.push('syncing…');
    else if (s.needsAllow) parts.push('waiting for Allow');
    else if (s.folder) parts.push(s.last ? ago(s.last) : 'not yet');
    else parts.push(s.canLink ? 'no folder linked' : 'by file only');
    if (s.forNow) parts.push('linked until the page closes (this browser can’t remember the folder)');
    if (s.error) parts.push(s.error);
    if (s.stale) parts.push('some saves changed: they apply when the game next starts');
    state.textContent = parts.join(' · ');
    state.classList.toggle('set-error', !!s.error);
    restart.hidden = !s.stale;
    stateRow.hidden = !s.canLink && !s.stale;
  };
  sync.onStatus(show);
  // (a browser that wasn't told to allow the folder "on every visit" asks again, and only on a click)
  if (s.needsAllow) setTimeout(() => o.toast('To sync saves with the desktop version: Settings › Saves and sync › Allow'), 2000);
  // (only while Settings is open, and once for a burst of changes: a volume slider makes one per step)
  let soon: ReturnType<typeof setTimeout> | null = null;
  store.onChange(() => {
    if (!kept.offsetParent || soon) return;
    soon = setTimeout(() => {
      soon = null;
      show();
    }, 500);
  });
  // (up to date as Settings opens; "5 min ago" moves on)
  new IntersectionObserver((seen) => {
    if (seen.some((e) => e.isIntersecting)) show();
  }).observe(kept);
  setInterval(() => {
    if (kept.offsetParent) show();
  }, 15000);
  show();
}

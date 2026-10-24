import type { Game } from '../world/Game';
import { STATS, type StatKey } from '../world/Stats';

/** What the Statistics panel needs of the rest of the interface (see UI). */
export interface StatsUI {
  /** Closes the panel (letting time run again, if it was opened from the pause menu). */
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A count as shown: time played in hours and minutes, the rest as whole numbers. */
export function formatStat(key: StatKey, v: number): string {
  if (key === 'time') {
    const s = Math.floor(v);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h} h ${m % 60} min` : m ? `${m} min` : `${s} s`;
  }
  return Math.floor(v).toLocaleString();
}

/** The counts the pause menu shows (the rest are in the panel). */
const STRIP: StatKey[] = ['kills', 'explosions', 'bullets', 'time'];
/** How often (s) what's shown is filled in again while it's up. */
const REFRESH = 0.5;

/**
 * The Statistics panel (the pause menu's Statistics…): every count (see Stats)
 * for this game and for all time, and a line of the main ones for the pause
 * menu itself. In someone else's game, "this game" is the host's counts.
 */
export class StatsPanel {
  readonly overlay: HTMLDivElement;
  private cells = new Map<StatKey, [HTMLElement, HTMLElement]>();
  private strips: HTMLElement[] = [];
  private note: HTMLElement;
  private t = 0;

  constructor(
    private game: Game,
    root: HTMLElement,
    private ui: StatsUI,
  ) {
    this.overlay = el('div', 'overlay hidden');
    const box = el('div', 'panel stats-panel');
    this.overlay.appendChild(box);
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.ui.close();
    };
    box.appendChild(el('div', 'panel-title', 'Statistics'));
    this.note = box.appendChild(el('div', 'panel-note'));
    const table = box.appendChild(el('table', 'stats-table'));
    const head = table.appendChild(el('tr'));
    head.append(el('th'), el('th', '', 'This game'), el('th', '', 'All time'));
    for (const s of STATS) {
      const tr = table.appendChild(el('tr'));
      tr.dataset.stat = s.key;
      tr.title = s.hint;
      tr.appendChild(el('td', 'stats-name', s.label));
      const now = tr.appendChild(el('td', 'stats-num'));
      const all = tr.appendChild(el('td', 'stats-num'));
      this.cells.set(s.key, [now, all]);
    }
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => {
      this.game.sound.ui('click');
      this.ui.close();
    };
    box.appendChild(close);
    root.appendChild(this.overlay);
    game.frameHandlers.push((dt) => this.frame(dt));
  }

  /** A line of this game's main counts for the pause menu, kept up to date while it shows. */
  strip(): HTMLElement {
    const s = el('div', 'stats-strip');
    this.strips.push(s);
    this.fill(s);
    return s;
  }

  /** Fills in the counts afresh (as the panel opens, and now and then while it's up). */
  render(): void {
    const st = this.game.stats;
    const game = st.game;
    for (const s of STATS) {
      const [now, all] = this.cells.get(s.key)!;
      now.textContent = formatStat(s.key, game[s.key]);
      all.textContent = formatStat(s.key, st.total[s.key]);
    }
    this.note.textContent = this.game.net?.guest
      ? 'This game is counted by the host; what happens in it counts towards your own totals too.'
      : 'What you have done in the sandbox: since the game was opened, and all time.';
    for (const s of this.strips) this.fill(s);
  }

  private fill(strip: HTMLElement): void {
    const t = this.game.stats.game;
    strip.textContent = STRIP.map((k) => `${STATS.find((s) => s.key === k)!.label}: ${formatStat(k, t[k])}`).join(' · ');
  }

  private frame(dt: number): void {
    this.t += dt;
    if (this.t < REFRESH) return;
    this.t = 0;
    if (!this.overlay.classList.contains('hidden')) this.render();
    else for (const s of this.strips) if (s.offsetParent) this.fill(s);
  }
}

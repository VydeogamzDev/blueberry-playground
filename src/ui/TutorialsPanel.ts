import type { Game } from '../world/Game';
import { SOON, type TourInfo } from './Tutorial';

/** What the Tutorials panel needs of the rest of the interface (see UI). */
export interface TutorialsUI {
  /** Every tour, and whether the player has been through it. */
  tours(): TourInfo[];
  /** Starts a tour (the panel, and the main menu if it's up, out of the way first). */
  start(id: string): void;
  /** Closes the panel (letting time run again, if it was opened from the pause menu). */
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The Tutorials panel (the pause menu's Tutorials…, the tool bar's cap): every
 * guided tour with what it covers and about how long it takes, a tick on the
 * ones the player has been through, and Start; the tours still to come are
 * shown greyed.
 */
export class TutorialsPanel {
  readonly overlay: HTMLDivElement;
  private list: HTMLDivElement;

  constructor(
    private game: Game,
    root: HTMLElement,
    private ui: TutorialsUI,
  ) {
    this.overlay = el('div', 'overlay hidden');
    const box = el('div', 'panel tutorials-panel');
    this.overlay.appendChild(box);
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.ui.close();
    };
    box.appendChild(el('div', 'panel-title', 'Tutorials'));
    box.appendChild(el('div', 'panel-note', 'Guided tours, each about one part of the game. Any step can be skipped, and a tour left any time with ×.'));
    this.list = el('div', 'tour-list');
    box.appendChild(this.list);
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => {
      this.game.sound.ui('click');
      this.ui.close();
    };
    box.appendChild(close);
    root.appendChild(this.overlay);
  }

  /** Fills in the list afresh (as the panel opens: a tour finished since shows its tick). */
  render(): void {
    this.list.textContent = '';
    for (const t of this.ui.tours()) {
      const row = this.row(t.title, t.blurb, `about ${t.minutes} min`, t.done);
      row.dataset.tour = t.id;
      const go = el('button', 'panel-btn tour-start', t.done ? 'Again' : 'Start');
      go.title = `Start “${t.title}”`;
      go.onclick = () => {
        this.game.sound.ui('confirm');
        this.ui.start(t.id);
      };
      row.appendChild(go);
    }
    for (const s of SOON) this.row(s.title, s.blurb, 'coming soon', false).classList.add('soon');
  }

  private row(title: string, blurb: string, time: string, done: boolean): HTMLDivElement {
    const row = el('div', 'tour-row');
    row.classList.toggle('done', done);
    const tick = row.appendChild(el('span', 'tour-tick', done ? '✓' : ''));
    tick.title = done ? 'Done' : '';
    const info = row.appendChild(el('div', 'tour-info'));
    const head = info.appendChild(el('div', 'tour-head'));
    head.append(el('span', 'tour-name', title), el('span', 'tour-time', time));
    info.appendChild(el('div', 'tour-blurb', blurb));
    this.list.appendChild(row);
    return row;
  }
}

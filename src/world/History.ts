import type { Game } from './Game';
import { capture, instantiate, type Snapshot } from './Snapshot';

/** How many edits can be undone. */
const LIMIT = 40;

interface Entry {
  label: string;
  snap: Snapshot;
}

/**
 * Undo/redo for the player's edits (spawning, deleting, connecting, freezing,
 * flipping, ...): before each one the whole scene is captured, and undoing puts
 * it back as it was at that moment. Stains, puddles and fire are not part of it.
 */
export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];

  constructor(private game: Game) {}

  /** Call just before an edit; `label` names it ("Delete", "Spawn Human"). */
  record(label: string): void {
    this.past.push({ label, snap: capture(this.game, this.game.entities) });
    if (this.past.length > LIMIT) this.past.shift();
    this.future.length = 0;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Puts the scene back as it was before the last edit; returns that edit's label. */
  undo(): string | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ label: e.label, snap: capture(this.game, this.game.entities) });
    this.restore(e.snap);
    return e.label;
  }

  /** Redoes the last undone edit; returns its label. */
  redo(): string | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ label: e.label, snap: capture(this.game, this.game.entities) });
    this.restore(e.snap);
    return e.label;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  private restore(snap: Snapshot): void {
    this.game.clearAll();
    instantiate(this.game, snap);
  }
}

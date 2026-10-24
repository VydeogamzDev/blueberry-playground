import { store } from '../engine/Store';
import { isLiving } from '../systems/Fighting';
import type { Entity } from './Entity';
import type { Game } from './Game';

/** What's counted. */
export type StatKey = 'kills' | 'revives' | 'people' | 'animals' | 'items' | 'explosions' | 'nukes' | 'bullets' | 'limbs' | 'built' | 'saved' | 'wires' | 'time';

/** Each count, in the order shown, with what it counts. */
export const STATS: { key: StatKey; label: string; hint: string }[] = [
  { key: 'kills', label: 'Kills', hint: 'People and animals who died' },
  { key: 'revives', label: 'Revives', hint: 'People and animals brought back from the dead' },
  { key: 'people', label: 'People spawned', hint: 'People put into the world from the toybox' },
  { key: 'animals', label: 'Animals spawned', hint: 'Animals put into the world from the toybox' },
  { key: 'items', label: 'Items spawned', hint: 'Everything else put into the world from the toybox' },
  { key: 'explosions', label: 'Explosions', hint: 'Bombs, grenades, rockets, barrels…' },
  { key: 'nukes', label: 'Nukes', hint: 'Nuclear blasts' },
  { key: 'bullets', label: 'Bullets fired', hint: 'Every bullet and pellet out of a gun' },
  { key: 'limbs', label: 'Limbs lost', hint: 'Limbs torn, cut or blown off people and animals' },
  { key: 'built', label: 'Contraptions built', hint: 'Saved contraptions put into the world' },
  { key: 'saved', label: 'Contraptions saved', hint: 'Things saved as contraptions in the toybox' },
  { key: 'wires', label: 'Wires connected', hint: 'Wires laid between things' },
  { key: 'time', label: 'Time played', hint: 'Time in the sandbox (not on the title screen)' },
];

export type Tally = Record<StatKey, number>;

const zero = (): Tally => Object.fromEntries(STATS.map((s) => [s.key, 0])) as Tally;

const KEY = 'blueberry-stats';
/** Where the lifetime totals are kept: the store (synced with the desktop app's), one line each way. */
const kept = { read: (): string | null => store.getItem(KEY), write: (text: string): void => store.setItem(KEY, text) };

/** How often (s of game time) people and animals are looked at for deaths, revivals and lost limbs. */
const POLL = 0.25;
/** How often (s) the totals are written while they change (and as the page is left). */
const SAVE_EVERY = 20;

/** A count as read from a save or a host: a number, not below 0 (else 0). */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function tallyOf(data: unknown): Tally {
  const t = zero();
  if (data && typeof data === 'object') for (const s of STATS) t[s.key] = count((data as Record<string, unknown>)[s.key]);
  return t;
}

/** A person or animal as last looked at: alive or not, and how many of its limbs were gone. */
interface Seen {
  alive: boolean;
  lost: number;
}

/**
 * What players do, counted (the pause menu and the Statistics panel show it):
 * this game's counts since the page was opened, and the player's lifetime
 * totals, kept between visits. Counted where things happen already (Game.spawn,
 * Explosions, Projectiles.fire, Connections.create, the contraptions), and
 * people's and animals' deaths, revivals and lost limbs by looking at them a
 * few times a second. In a multiplayer game the host counts: a guest's "this
 * game" is the host's, and what happens in it joins the guest's own totals.
 */
export class Stats {
  /** Everything this player has done, kept between visits. */
  total: Tally = zero();
  /** Above 0, what's made isn't counted: a scene loaded, an undo, a paste (see Snapshot). */
  quiet = 0;
  /** Off until the game starts: the starter scene isn't the player's doing. */
  counting = false;
  /** Whether the title screen is up (no time played then; see UI). */
  inMenu: () => boolean = () => false;
  private own: Tally = zero();
  /** The host's counts of their game, as they last sent them (null: not in someone else's game). */
  private host: Tally | null = null;
  private seen = new WeakMap<Entity, Seen>();
  private pollT = 0;
  private dirty = false;
  private saveT = 0;

  constructor() {
    this.load();
    if (typeof document === 'undefined') return;
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.dirty) this.save();
    });
    // (the other copy's totals, synced in: each count the larger of the two, so neither copy's goes back)
    store.onChange((keys, bySync) => {
      if (!bySync || !keys.includes(KEY)) return;
      const mine = this.total;
      this.load();
      for (const s of STATS) this.total[s.key] = Math.max(this.total[s.key], mine[s.key]);
      this.dirty = true;
    });
  }

  /** This game's counts: since the page was opened, or in someone else's game, theirs. */
  get game(): Tally {
    return this.host ?? this.own;
  }

  /** Counts something done (in this game and the player's totals). */
  add(key: StatKey, n = 1): void {
    if (!this.counting || this.quiet > 0 || !(n > 0)) return;
    this.own[key] += n;
    this.total[key] += n;
    this.dirty = true;
  }

  /** Something put into the world from the toybox (see Game.spawn): a person, an animal or an item. */
  spawned(e: Entity): void {
    if (!this.counting || this.quiet > 0) return;
    if (!isLiving(e)) {
      this.add('items');
      return;
    }
    this.add('species' in e ? 'animals' : 'people');
    // (killed before it's next looked at, it still counts)
    this.seen.set(e, { alive: e.alive, lost: 0 });
  }

  /** A step of the host's (or a lone player's) game: who has died, been brought back or lost a limb since the last look. */
  step(game: Game, dt: number): void {
    this.pollT += dt;
    if (this.pollT < POLL) return;
    this.pollT = 0;
    for (const e of game.entities) {
      if (e.destroyed || !isLiving(e)) continue;
      const limbs = (e as { limbs?: Map<string, { severed: boolean; gone: boolean }> }).limbs;
      let lost = 0;
      if (limbs) for (const l of limbs.values()) if (l.severed || l.gone) lost++;
      const was = this.seen.get(e);
      // (first seen: loaded or pasted, as it was)
      if (!was) {
        this.seen.set(e, { alive: e.alive, lost });
        continue;
      }
      if (was.alive && !e.alive) this.add('kills');
      else if (!was.alive && e.alive) this.add('revives');
      if (lost > was.lost) this.add('limbs', lost - was.lost);
      was.alive = e.alive;
      was.lost = lost;
    }
  }

  /** Each frame: time played, and the totals written now and then. */
  frame(dt: number): void {
    if (typeof document !== 'undefined' && !document.hidden && !this.inMenu()) this.add('time', dt);
    this.saveT += dt;
    if (this.dirty && this.saveT >= SAVE_EVERY) this.save();
  }

  /**
   * In someone else's game: the host's counts of it (null: back to our own).
   * What has happened since their last counts joins this player's totals (but
   * the time: each player counts their own).
   */
  fromHost(data: unknown): void {
    if (data === null) {
      this.host = null;
      return;
    }
    const next = tallyOf(data);
    if (this.host) {
      for (const s of STATS) {
        const d = next[s.key] - this.host[s.key];
        if (s.key !== 'time' && d > 0) {
          this.total[s.key] += d;
          this.dirty = true;
        }
      }
    }
    this.host = next;
  }

  /** Reads the totals kept (as the page opens, or after another copy's sync). */
  load(): void {
    let data: unknown = null;
    try {
      data = JSON.parse(kept.read() ?? 'null');
    } catch {
      data = null;
    }
    this.total = tallyOf(data);
  }

  /** Writes the totals (a browser that won't keep them: they're kept for this visit). */
  save(): void {
    this.dirty = false;
    this.saveT = 0;
    const t = { ...this.total, time: Math.round(this.total.time) };
    try {
      kept.write(JSON.stringify(t));
    } catch {
      /* not kept: fine for this visit */
    }
  }
}

/** The one tally of the page (Game holds it as game.stats; the toybox's contraptions count into it too). */
export const stats = new Stats();

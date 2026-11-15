import { store } from '../engine/Store';
import type { Game } from '../world/Game';
import type { PilotHud } from './Piloting';

/** What a challenge is checked against each step something's flown here. */
export interface FlightLog {
  hud: PilotHud;
  /** The highest it's been this flight (true height, m), the fastest (m/s). */
  top: number;
  fastest: number;
  /** A person aboard alive (in a seat of the craft). */
  crewed: boolean;
  /** How long (s) it's been in orbit (peri above the air) this flight. */
  orbitT: number;
  /** Down on the ground again (still, low) after flying, and how fast it touched down (m/s). */
  landed: boolean;
  touchdown: number;
}

export interface Challenge {
  id: string;
  title: string;
  blurb: string;
  /** Needs the World map (heights past the ceiling). */
  world?: boolean;
  met(f: FlightLog): boolean;
}

/** The challenges (0.4.0): flying goals, each ticked once met (kept in the browser). */
export const CHALLENGES: Challenge[] = [
  { id: 'hop', title: 'Hop', blurb: 'Fly anything you’ve built 20 m up.', met: (f) => f.top >= 20 },
  { id: 'soft', title: 'Soft landing', blurb: 'Come down from 50 m or more and touch down slower than 3 m/s.', met: (f) => f.landed && f.top >= 50 && f.touchdown < 3 },
  { id: 'km', title: 'A kilometre up', blurb: 'Fly to 1 km on the World map.', world: true, met: (f) => f.top >= 1000 },
  { id: 'sound', title: 'Sound barrier', blurb: 'Fly faster than sound (about 340 m/s down low, less where it’s cold).', met: (f) => (f.hud.speed > 0 && f.fastest > 300 && (f.hud.temp === undefined ? f.hud.speed > 343 : f.hud.speed > Math.sqrt(1.4 * 287 * (f.hud.temp + 273.15)))) },
  { id: 'space', title: 'Space', blurb: 'Fly to 10 km on the World map, where the air runs out.', world: true, met: (f) => f.top >= 10000 },
  { id: 'crewed', title: 'Crewed spaceflight', blurb: 'Take someone to 10 km, alive (a capsule seat and an oxygen tank, or a spacesuit).', world: true, met: (f) => f.top >= 10000 && f.crewed },
  { id: 'orbit', title: 'Orbit', blurb: 'Get into orbit (the bottom of your path above 8 km) and stay there 30 s.', world: true, met: (f) => f.orbitT >= 30 },
  { id: 'return', title: 'There and back', blurb: 'Go to space with someone aboard and land them back on the ground alive.', world: true, met: (f) => f.top >= 10000 && f.crewed && f.landed && f.touchdown < 8 },
];

const KEY = 'blueberry-challenges';

/** Which challenges are met, kept in the browser; watching what's flown here for more (see Piloting). */
export class Challenges {
  private done = new Set<string>();
  private log: FlightLog | null = null;
  private logOf: unknown = null;
  private wasUp = false;
  /** Told when one's met (UI: a toast). */
  onMet: ((c: Challenge) => void) | null = null;

  constructor(private game: Game) {
    try {
      const v = JSON.parse(store.getItem(KEY) ?? '[]');
      if (Array.isArray(v)) for (const id of v) if (typeof id === 'string') this.done.add(id);
    } catch {
      /* none kept */
    }
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  /** Each step something's flown here: its readout (null: nothing is), and whether it carries someone alive. */
  watch(craft: unknown, hud: PilotHud | null, crewed: boolean, dt: number): void {
    if (!hud || !craft) return;
    if (craft !== this.logOf) {
      this.logOf = craft;
      this.log = { hud, top: 0, fastest: 0, crewed: false, orbitT: 0, landed: false, touchdown: 0 };
      this.wasUp = false;
    }
    const f = this.log!;
    f.hud = hud;
    const h = hud.alt ?? hud.height;
    f.top = Math.max(f.top, h);
    f.fastest = Math.max(f.fastest, hud.speed);
    f.crewed = crewed;
    if (hud.peri !== undefined && hud.peri > 8000) f.orbitT += dt;
    else f.orbitT = 0;
    // (landed: up, then down near the ground, near still; how fast it was coming as it got there)
    if (hud.height > 5) {
      this.wasUp = true;
      f.landed = false;
    }
    if (this.wasUp && hud.height < 1.5) {
      if (!f.landed) f.touchdown = Math.max(0, -hud.climb);
      if (hud.speed < 0.5) f.landed = true;
      else if (hud.height > 0.5) f.touchdown = Math.max(0, -hud.climb);
    }
    for (const c of CHALLENGES) {
      if (this.done.has(c.id) || (c.world && !this.game.map.world)) continue;
      if (!c.met(f)) continue;
      this.done.add(c.id);
      try {
        store.setItem(KEY, JSON.stringify([...this.done]));
      } catch {
        /* not kept */
      }
      this.onMet?.(c);
    }
  }
}

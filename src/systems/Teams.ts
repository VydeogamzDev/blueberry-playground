import { RAPIER } from '../engine/Physics';
import { CLEAR, rgb, shade, type Color, type PixelArt } from '../art/PixelArt';
import { ramp, type Ramp } from '../art/palette';
import type { Entity } from '../world/Entity';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import type { ContextAction } from '../world/types';
import { isFighter, onFeet, stillUp, type Fighter } from './Fighting';

/**
 * Teams (armies): people and animals put on a side go on their own for the
 * nearest of anyone on another side, and leave their own side be. Each wears
 * its team's colour: a person's shirt, an android's armbands and chest panel,
 * an animal's coat over its back. A tank put on a side fights for it too (see
 * Tank), a stripe of the colour round its turret.
 */

export type TeamId = 'red' | 'blue' | 'green' | 'yellow';

/** The teams: name, the colour their kit is dyed (a palette ramp), and that colour for the interface. */
export const TEAMS: Record<TeamId, { name: string; ramp: Ramp; css: string }> = {
  red: { name: 'Red', ramp: ramp('#b23b30'), css: '#c8473a' },
  blue: { name: 'Blue', ramp: ramp('#3f63b8'), css: '#5079d6' },
  green: { name: 'Green', ramp: ramp('#4f8f3a'), css: '#5fa846' },
  yellow: { name: 'Yellow', ramp: ramp('#d4ab2e'), css: '#e2bb3c' },
};
export const TEAM_IDS = Object.keys(TEAMS) as TeamId[];

export function isTeamId(v: unknown): v is TeamId {
  return typeof v === 'string' && v in TEAMS;
}

/** Someone (a person or an animal) who can be put on a team. */
export interface TeamMember extends Fighter {
  team: TeamId | null;
  setTeam(team: TeamId | null): void;
}

export function isTeamMember(e: Entity | null | undefined): e is TeamMember {
  return isFighter(e) && typeof (e as Partial<TeamMember>).setTeam === 'function';
}

/** A machine that fights for the side it's put on (a tank: see Tank). */
export interface TeamMachine extends Entity {
  team: TeamId | null;
  setTeam(team: TeamId | null): void;
  /** Out of the fight for good (burnt out). */
  readonly wrecked: boolean;
  readonly fightsForTeam: true;
}

export function isTeamMachine(e: Entity | null | undefined): e is TeamMachine {
  return (e as Partial<TeamMachine> | null | undefined)?.fightsForTeam === true;
}

export function teamOf(e: Entity | null | undefined): TeamId | null {
  return (e as Partial<TeamMember> | null | undefined)?.team ?? null;
}

/** A zombie (see Human.rise()), or infected and about to be one. */
export function undead(e: Entity | null | undefined): boolean {
  const x = e as { zombie?: boolean; infection?: number } | null | undefined;
  return !!x?.zombie || (x?.infection ?? 0) > 0;
}

/** Someone a zombie goes for: alive, neither undead nor infected (see Human.prey). */
export function preyOf(e: Entity | null | undefined): boolean {
  return (e as { prey?: boolean } | null | undefined)?.prey === true;
}

/** The side someone fights on: their team's, or the zombies' (a side of their own, whatever team they were on). */
export function sideOf(e: Entity | null | undefined): TeamId | 'zombie' | null {
  return (e as { zombie?: boolean } | null | undefined)?.zombie ? 'zombie' : teamOf(e);
}

/** On the same side (and not the same one): they don't go for each other. */
export function allies(a: Entity, b: Entity): boolean {
  const t = sideOf(a);
  return t !== null && a !== b && sideOf(b) === t;
}

/**
 * On different sides: they go for each other on sight. Zombies go for anyone they
 * can bite (team or none), and anyone on a team goes for them.
 */
export function enemies(a: Entity, b: Entity): boolean {
  const t = sideOf(a);
  const u = sideOf(b);
  if (t === 'zombie' || u === 'zombie') return t !== u && (t === 'zombie' ? preyOf(b) : u !== null && t !== null && !undead(a));
  return t !== null && u !== null && t !== u;
}

// ---------------------------------------------------------------- their colours

const dyed = new Map<string, PixelArt>();
const lum = (c: Color): number => {
  const [r, g, b] = rgb(c);
  return 0.3 * r + 0.59 * g + 0.11 * b + 1;
};

/**
 * `base` with its pixels in rows y0..y1 (and columns x0..x1) dyed the team's
 * colour: each as much lighter or darker than the team's base shade as it was
 * than the band's average, so its lighting and outline stay. Kept by `key` (one
 * per sprite) and team. `contrast` below 1 evens it out (paint over camouflage).
 */
export function dye(key: string, base: PixelArt, team: TeamId, y0: number, y1: number, x0 = 0, x1 = base.w, contrast = 1): PixelArt {
  const k = `${key}:${team}`;
  const hit = dyed.get(k);
  if (hit) return hit;
  const a = base.clone();
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = a.get(x, y);
      if (c === CLEAR) continue;
      sum += lum(c);
      n++;
    }
  }
  const mean = n ? sum / n : 1;
  const c0 = TEAMS[team].ramp[2];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = a.get(x, y);
      if (c !== CLEAR) a.set(x, y, shade(c0, (lum(c) / mean) ** contrast));
    }
  }
  dyed.set(k, a);
  return a;
}

/** Puts a part in other clothes (a sprite of the same shape), keeping what's painted on it: wounds, blood, burns. */
export function dress(p: Part, art: PixelArt): void {
  if (p.destroyed || p.art === art) return;
  const paint = p.paintData();
  p.setArt(art);
  if (paint) p.restorePaint(paint);
}

// ---------------------------------------------------------------- who's where

/**
 * Who is on a team and where, the bombs lit and the things to hold lying
 * about: made afresh a few times a second (and when things come and go),
 * however many ask, so looking for an enemy never goes through everything in
 * the scene for every soldier every step.
 */
interface Roster {
  /** When it was made (game time), and how many entities there were then. */
  t: number;
  n: number;
  members: TeamMember[];
  /** Their middles then (x, y pairs). */
  at: number[];
  /** Machines on a side, still in the fight, and their middles. */
  machines: TeamMachine[];
  machinesAt: number[];
  /** How many on teams are going for each: spreads a side over the other's. */
  hunted: Map<Entity, number>;
  /** Lit bombs: where, and how far their blast reaches. */
  bombs: { e: Entity; x: number; y: number; r: number }[];
  /** Things to hold lying about (a weapon someone might pick up). */
  loose: Entity[];
}

const rosters = new WeakMap<Game, Roster>();
/** How often the roster is made afresh (s of game time). */
const REFRESH = 0.25;

function roster(game: Game): Roster {
  let r = rosters.get(game);
  if (!r) rosters.set(game, (r = { t: -Infinity, n: -1, members: [], at: [], machines: [], machinesAt: [], hunted: new Map(), bombs: [], loose: [] }));
  if (game.time >= r.t && game.time - r.t < REFRESH && game.entities.length === r.n) return r;
  r.t = game.time;
  r.n = game.entities.length;
  r.members.length = 0;
  r.at.length = 0;
  r.machines.length = 0;
  r.machinesAt.length = 0;
  r.bombs.length = 0;
  r.loose.length = 0;
  r.hunted.clear();
  for (const e of game.entities) {
    if (e.destroyed) continue;
    if (isTeamMember(e)) {
      // (on a side, or someone a zombie would go for)
      if (!e.alive || (!sideOf(e) && !preyOf(e))) continue;
      const c = e.center();
      r.members.push(e);
      r.at.push(c.x, c.y);
      if (e.foe) r.hunted.set(e.foe, (r.hunted.get(e.foe) ?? 0) + 1);
      continue;
    }
    if (isTeamMachine(e)) {
      if (!e.team || e.wrecked) continue;
      const c = e.center();
      r.machines.push(e);
      r.machinesAt.push(c.x, c.y);
      continue;
    }
    const x = e as Entity & { armed?: unknown; blast?: { radius: number }; hold?: unknown; holder?: unknown };
    if (x.armed === true && x.blast) {
      const c = e.center();
      r.bombs.push({ e, x: c.x, y: c.y, r: x.blast.radius });
    } else if (x.hold && !x.holder) r.loose.push(e);
  }
  return r;
}

/** Is there no ground (the map's: walls, hills) between two points? */
function inSight(game: Game, x: number, y: number, tx: number, ty: number): boolean {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return true;
  const ray = new RAPIER.Ray({ x, y }, { x: dx / d, y: dy / d });
  return !game.physics.world.castRay(ray, d, true, undefined, undefined, undefined, undefined, (c) => game.env.isEnvironment(c));
}

/**
 * The enemy (anyone on another side, alive and awake) `me` at (x, y) should go
 * for: the nearest, rather one on their feet than one down, one already going
 * for `me`, and one fewer of `me`'s side are after (and rather not `avoid`: one
 * there's no way to get at); within `sight` m and in sight (no wall or hill
 * between). Null: there's none.
 */
export function nearestEnemy(me: TeamMember, x: number, y: number, sight: number, avoid: Entity | null = null): TeamMember | null {
  const r = roster(me.game);
  let hidden: TeamMember | null = null;
  for (let tries = 0; tries < 2; tries++) {
    let best: TeamMember | null = null;
    let bd = Infinity;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < r.members.length; i++) {
      const e = r.members[i];
      // (a zombie goes for someone lying out cold as soon as anyone)
      if (e === me || e === hidden || e.destroyed || !enemies(me, e) || (!stillUp(e) && sideOf(me) !== 'zombie')) continue;
      const dx = r.at[2 * i] - x;
      const dy = r.at[2 * i + 1] - y;
      if (Math.abs(dx) > sight || Math.abs(dy) > 8) continue;
      const d = Math.abs(dx) + Math.abs(dy) * 2 + (onFeet(e) ? 0 : 5) + (r.hunted.get(e) ?? 0) * 1.2 - (e.foe === me ? 1.5 : 0) + (e === avoid ? 8 : 0);
      if (d < bd) {
        bd = d;
        best = e;
        bx = r.at[2 * i];
        by = r.at[2 * i + 1];
      }
    }
    if (!best || inSight(me.game, x, y + 0.3, bx, by + 0.3)) return best;
    hidden = best;
  }
  return null;
}

/**
 * The enemy a machine at (x, y) facing `dir` (1: right) should go for: someone
 * of another side up and about, or another side's machine, within `sight` m
 * (and 15 m up or down) and in sight; the nearest, one behind it counting for
 * as far again (it has to turn round for them). Null: there's none.
 */
export function nearestFoe(me: TeamMachine, x: number, y: number, sight: number, dir: number): Entity | null {
  const r = roster(me.game);
  const near: { e: Entity; d: number; x: number; y: number }[] = [];
  const consider = (e: Entity, ex: number, ey: number) => {
    const dx = ex - x;
    const dy = ey - y;
    if (Math.abs(dx) > sight || Math.abs(dy) > 15) return;
    near.push({ e, x: ex, y: ey, d: Math.abs(dx) * (dx * dir < 0 ? 2 : 1) + Math.abs(dy) });
  };
  for (let i = 0; i < r.members.length; i++) {
    const e = r.members[i];
    if (!e.destroyed && stillUp(e) && enemies(me, e)) consider(e, r.at[2 * i], r.at[2 * i + 1]);
  }
  for (let i = 0; i < r.machines.length; i++) {
    const e = r.machines[i];
    if (e !== me && !e.destroyed && !e.wrecked && enemies(me, e)) consider(e, r.machinesAt[2 * i], r.machinesAt[2 * i + 1]);
  }
  near.sort((a, b) => a.d - b.d);
  // (the first few in sight: past that, there's no telling it's worth the rays)
  for (let i = 0; i < Math.min(4, near.length); i++) if (inSight(me.game, x, y + 1, near[i].x, near[i].y + 0.3)) return near[i].e;
  return null;
}

/** Everyone on `side` (people and animals alive, machines still in the fight) as of the roster, with where they were. */
export function onSide(game: Game, side: TeamId): { e: Entity; x: number; y: number }[] {
  const r = roster(game);
  const out: { e: Entity; x: number; y: number }[] = [];
  r.members.forEach((e, i) => {
    if (!e.destroyed && sideOf(e) === side) out.push({ e, x: r.at[2 * i], y: r.at[2 * i + 1] });
  });
  r.machines.forEach((e, i) => {
    if (!e.destroyed && e.team === side) out.push({ e, x: r.machinesAt[2 * i], y: r.machinesAt[2 * i + 1] });
  });
  return out;
}

/** A lit bomb (not one `skip` is holding) whose blast would reach (x, y), a metre to spare: its x, or null. */
export function bombNear(game: Game, x: number, y: number, skip?: Entity): number | null {
  for (const b of roster(game).bombs) {
    if (b.e.destroyed || (b.e as { holder?: unknown }).holder === skip) continue;
    if (Math.hypot(b.x - x, b.y - y) < b.r + 1) return b.x;
  }
  return null;
}

/** The nearest thing to hold lying about within `r` m of (x, y) that `ok` takes (a weapon to pick up), or null. */
export function lyingNear<T extends Entity>(game: Game, x: number, y: number, r: number, ok: (e: Entity) => e is T): T | null {
  let best: T | null = null;
  let bd = r;
  for (const e of roster(game).loose) {
    const p = e.parts[0];
    if (e.destroyed || !p || p.destroyed || (e as { holder?: unknown }).holder || !ok(e)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/**
 * The Team: entries of the context menu of people, animals and tanks, for all
 * of them in the selection: none, or one of the teams (the one they're all on
 * ticked). `record` is called before a change (it goes on the undo history).
 */
export function teamActions(list: Entity[], record: () => void): ContextAction[] {
  const members = list.filter((e): e is TeamMember | TeamMachine => isTeamMember(e) || isTeamMachine(e));
  if (!members.length) return [];
  const t = members[0].team;
  const same = members.every((m) => m.team === t);
  const set = (team: TeamId | null) => {
    record();
    for (const m of members) if (!m.destroyed) m.setTeam(team);
  };
  return [
    { label: 'Team: none', checked: same && t === null, action: () => set(null) },
    ...TEAM_IDS.map((id) => ({ label: `Team: ${TEAMS[id].name}`, checked: same && t === id, action: () => set(id) })),
  ];
}

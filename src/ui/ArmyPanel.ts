import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Entity } from '../world/Entity';
import type { ItemDef } from '../world/types';
import { PX, WORLD } from '../engine/constants';
import { clamp } from '../engine/math';
import { ITEMS, getItem } from '../catalog/items';
import { TEAMS, TEAM_IDS, isTeamMachine, isTeamMember, type TeamId, type TeamMachine, type TeamMember } from '../systems/Teams';

/** What a side's soldiers are armed with (dogs: a pack of dogs instead of people; gun: one gun each, Side.gun). */
export type Loadout = 'fists' | 'melee' | 'pistols' | 'rifles' | 'mixed' | 'crossbows' | 'dogs' | 'gun';

/** A side in a battle: its colour, how many, what they're armed with, and the tanks it brings. */
export interface Side {
  team: TeamId;
  /** How many people (or dogs): none only for a side of tanks alone. */
  count: number;
  loadout: Loadout;
  /** Armed with one gun (the 'gun' loadout): which (an id: see battleGuns()). */
  gun?: string;
  /** How many tanks it brings, lined up behind it (none if left out), and which (an id: see TANK_IDS). */
  tanks?: number;
  tank?: string;
}

/** Who a battle lined up: each side's people (or dogs), and in `tanks`, each side's tanks. */
export type Lineup = TeamMember[][] & { tanks: TeamMachine[][] };

/** What the army panel needs of the rest of the interface (see UI). */
export interface ArmyUI {
  toast(msg: string): void;
  /** Closes the panel (and lets time run again, if it was opened from the pause menu). */
  close(): void;
}

const LOADOUTS: { id: Loadout; name: string }[] = [
  { id: 'fists', name: 'Fists' },
  { id: 'melee', name: 'Melee weapons' },
  { id: 'pistols', name: 'Pistols' },
  { id: 'rifles', name: 'Rifles' },
  { id: 'mixed', name: 'Mixed' },
  { id: 'crossbows', name: 'Crossbows' },
  { id: 'dogs', name: 'Dogs' },
];

/** The loadout select's value for one gun each: this, and the gun's id. */
const GUN = 'gun:';

/** Arms a side as the loadout select's `value` says: a loadout, or one gun each. */
function armWith(s: Side, value: string): void {
  if (value.startsWith(GUN)) {
    s.loadout = 'gun';
    s.gun = value.slice(GUN.length);
  } else s.loadout = value as Loadout;
}

/** The weapons a side's soldiers are given, each the next in turn (null: fists). Any the catalog hasn't got are left out. */
const KITS: Record<Exclude<Loadout, 'dogs' | 'gun'>, (string | null)[]> = {
  fists: [null],
  melee: ['bat', 'sword', 'axe', 'crowbar', 'hammer'],
  pistols: ['pistol', 'pistol', 'revolver'],
  rifles: ['rifle'],
  mixed: ['bat', 'pistol', 'sword', 'rifle', null, 'axe', 'shotgun', 'crossbow'],
  crossbows: ['crossbow'],
};

/** The tanks a side can bring, those the catalog has (the M113 too, once it's in). */
const TANK_IDS = ['tank', 'tank-abrams', 'tank-ztz99a', 'tank-leopard', 'm113'];

/**
 * Lining a battle up: how far apart soldiers stand in a rank (m: people, and dogs,
 * squeezed up nearer to fit in the world), how far apart the two front ranks start
 * (m), the gap between one side and the next lined up beyond it (m), the most
 * soldiers a side may have; the gap from a side's rear rank to its first tank and
 * between tanks (m), the most tanks a side may bring, and how far inside the
 * world's walls everyone stays (m).
 */
const LINE = { person: 0.9, dog: 1.4, least: 0.5, gap: 10, between: 2, most: 30, behind: 2, tankGap: 1.5, tanks: 4, edge: 1 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Can a side be armed that way here (crossbows only if the catalog has them)? */
function available(l: Loadout): boolean {
  return l !== 'crossbows' || !!getItem('crossbow');
}

/** What things made out of the scene turned out to be (see probe()), by what was asked of them. */
const probed = new WeakMap<ItemDef, Map<string, unknown>>();

/**
 * Makes one of `def` out of the scene (it never joins the game's entities, nor
 * sees a step), asks it `ask` and throws it away. The answer is kept (by `key`),
 * so each is only made the once.
 */
function probe<T>(game: Game, def: ItemDef, key: string, ask: (e: Entity) => T): T {
  let known = probed.get(def);
  if (!known) probed.set(def, (known = new Map()));
  if (known.has(key)) return known.get(key) as T;
  // (high over the world, touching nothing, for the moment it's there)
  const e = def.create!(game, 0, WORLD.ceiling + 20, {});
  const v = ask(e);
  e.destroy();
  known.set(key, v);
  return v;
}

/** Is it held and fired at the enemy from a way off (as a person fights with a gun: see Human.gunfight())? */
function shoots(e: Entity): boolean {
  const it = e as Entity & { hold?: unknown; fire?: unknown };
  return !!it.hold && ('gun' in it || 'projectileSpeed' in it) && typeof it.fire === 'function';
}

/**
 * Every gun a side can be armed with one of (the 'gun' loadout): whatever on the
 * toybox's Firearms shelf a soldier holds and fires at the enemy, launchers and
 * the crossbow among them; not the bolts, rockets and rounds they fire, nor the
 * fire extinguisher. In the toybox's order.
 */
export function battleGuns(game: Game): ItemDef[] {
  return ITEMS.filter((d) => d.category === 'Weapons' && !d.hidden && !d.tool && !!d.create && probe(game, d, 'shoots', shoots));
}

/** The tanks a side can bring: those of TANK_IDS the catalog has. */
export function battleTanks(): ItemDef[] {
  return TANK_IDS.map((id) => getItem(id)).filter((d): d is ItemDef => !!d);
}

/** The kind of tank a side brings (the Abrams if it doesn't say), if the catalog has it. */
function tankOf(s: Side): ItemDef | undefined {
  const id = s.tank ?? 'tank-abrams';
  return TANK_IDS.includes(id) ? getItem(id) : undefined;
}

/** How many tanks a side brings (none if the catalog hasn't its kind). */
function tanksOf(s: Side): number {
  return tankOf(s) ? clamp(Math.round(s.tanks ?? 0) || 0, 0, LINE.tanks) : 0;
}

/** How far a tank reaches behind its middle and ahead of it, gun and all, facing right (m). */
function tankReach(game: Game, def: ItemDef): { rear: number; front: number } {
  return probe(game, def, 'reach', (e) => {
    // (made at x = 0: each part's sprite as it's turned)
    let lo = 0;
    let hi = 0;
    for (const p of e.parts) {
      const r = ((Math.abs(Math.cos(p.a)) * p.w + Math.abs(Math.sin(p.a)) * p.h) * PX) / 2;
      lo = Math.min(lo, p.x - r);
      hi = Math.max(hi, p.x + r);
    }
    return { rear: -lo, front: hi };
  });
}

/**
 * Lines the sides up either side of `at` (on the ground under it): the first to the
 * left, the second to the right, a third beyond the first, and so on; each in a
 * rank facing the middle, armed, its tanks in a column behind it, and on its team,
 * so they go for each other at once (see Teams, and Tank.command()). Too many for
 * the world, they stand closer together, and then tanks are left out (from the
 * sides with the most); too near a wall, it's all moved over. Returns who was put
 * on each side.
 */
export function spawnBattle(game: Game, sides: Side[], at: { x: number; y: number }): Lineup {
  // each side: who (people or dogs), how many, how far apart they'd stand, and its tanks
  const plans = sides.map((s) => {
    const dogs = s.loadout === 'dogs';
    const def = getItem(dogs ? 'dog' : 'human');
    const tank = tankOf(s);
    const tanks = tanksOf(s);
    const reach = tank && tanks ? tankReach(game, tank) : { rear: 0, front: 0 };
    return { s, def, n: def ? clamp(Math.round(s.count) || 0, tanks ? 0 : 1, LINE.most) : 0, apart: dogs ? LINE.dog : LINE.person, tank, tanks, reach };
  });
  type Plan = (typeof plans)[number];
  /** How far apart a side stands with everyone `f` of their way apart (m). */
  const apart = (p: Plan, f: number) => Math.max(LINE.least, p.apart * f);
  /** How wide a side is from its front rank to its last tank (m). */
  const width = (p: Plan, f: number) => {
    const column = p.tanks ? p.tanks * (p.reach.rear + p.reach.front) + (p.tanks - 1) * LINE.tankGap + (p.n ? LINE.behind : 0) : 0;
    return p.n * apart(p, f) + column;
  };
  /** How wide the sides lined up to the left (the first, third…) and to the right are, all told (m). */
  const halves = (f: number): [number, number] => {
    const w: [number, number] = [0, 0];
    plans.forEach((p, i) => (w[i % 2] += width(p, f) + (i >= 2 ? LINE.between : 0)));
    return w;
  };
  const room = WORLD.right - WORLD.left - 2 * LINE.edge - LINE.gap;
  const across = (f: number) => halves(f)[0] + halves(f)[1];
  let f = 1;
  while (across(f) > room && f > LINE.least / LINE.dog) f -= 0.05;
  // (still too wide: a tank less, from the side with the most, the later one if they're even; a side of tanks alone keeps one)
  while (across(f) > room) {
    const p = plans.reduce<Plan | null>((b, q) => (q.tanks > (q.n ? 0 : 1) && (!b || q.tanks >= b.tanks) ? q : b), null);
    if (!p) break;
    p.tanks--;
  }
  // (near a wall, the middle moves over till both halves fit)
  const [wl, wr] = halves(f);
  const lo = WORLD.left + LINE.edge + wl + LINE.gap / 2;
  const hi = WORLD.right - LINE.edge - wr - LINE.gap / 2;
  const cx = lo <= hi ? clamp(at.x, lo, hi) : (lo + hi) / 2;
  const out: Lineup = Object.assign([] as TeamMember[][], { tanks: [] as TeamMachine[][] });
  // (where the next side lines up, to the left and to the right)
  const from = [cx - LINE.gap / 2, cx + LINE.gap / 2];
  plans.forEach((p, i) => {
    const members: TeamMember[] = [];
    const machines: TeamMachine[] = [];
    out.push(members);
    out.tanks.push(machines);
    const s = p.s;
    const dir = i % 2 === 0 ? -1 : 1;
    const k = dir < 0 ? 0 : 1;
    const step = apart(p, f);
    const l = s.loadout;
    const kit = l === 'dogs' ? [] : (l === 'gun' ? [s.gun ?? null] : KITS[l]).filter((id) => id === null || !!getItem(id));
    // (the right-hand side faces left, toward the middle)
    const flip = dir > 0;
    let x = from[k];
    for (let j = 0; j < p.n && p.def; j++) {
      const px = x + dir * step * (j + 0.5);
      const y = game.env.standAt(px, at.y + 3) + (p.def.halfHeight ?? 0.9) + 0.05;
      const e = game.spawn(p.def, px, y, { flip });
      if (!isTeamMember(e)) continue;
      e.setTeam(s.team);
      members.push(e);
      const id = kit.length ? kit[j % kit.length] : null;
      const w = id ? getItem(id) : undefined;
      if (!w) continue;
      const it = game.spawn(w, px, y + 0.3, { flip });
      const taker = e as Entity & { take?(item: Entity): boolean };
      if (it && !taker.take?.(it)) game.remove(it);
    }
    x += dir * step * p.n;
    // the tanks in a column behind them, each gun toward the middle, on the highest ground under it
    if (p.tank && p.tanks) {
      if (p.n) x += dir * LINE.behind;
      const { rear, front } = p.reach;
      for (let j = 0; j < p.tanks; j++) {
        const tx = x + dir * front;
        const end = tx + dir * rear;
        let top = -Infinity;
        for (let q = 0; q <= 4; q++) top = Math.max(top, game.env.standAt(x + ((end - x) * q) / 4, at.y + 3));
        const e = game.spawn(p.tank, tx, top + (p.tank.halfHeight ?? 1.2) + 0.05, { flip });
        if (isTeamMachine(e)) {
          e.setTeam(s.team);
          machines.push(e);
        }
        x = end + dir * LINE.tankGap;
      }
      x -= dir * LINE.tankGap;
    }
    from[k] = x + dir * LINE.between;
  });
  return out;
}

/**
 * The Battle panel (the toolbar's battle button, and the pause menu): two to four
 * sides, each a colour, how many and what they're armed with (a kit, or one gun
 * each), and how many tanks of which kind; Start battle lines them up either side
 * of the middle of the view, and they charge.
 */
export class ArmyPanel {
  readonly overlay: HTMLDivElement;
  private game: Game;
  private controls: Controls;
  private ui: ArmyUI;
  private rows: HTMLDivElement;
  private btnAdd: HTMLButtonElement;
  /** The sides as set up (kept from one battle to the next). */
  readonly sides: Side[] = [
    { team: 'red', count: 8, loadout: 'melee' },
    { team: 'blue', count: 8, loadout: 'melee' },
  ];
  /** Clear the scene before lining them up. */
  clearFirst = false;

  constructor(game: Game, controls: Controls, root: HTMLElement, ui: ArmyUI) {
    this.game = game;
    this.controls = controls;
    this.ui = ui;
    this.overlay = el('div', 'overlay hidden');
    const box = el('div', 'panel army-panel');
    this.overlay.appendChild(box);
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.ui.close();
    };
    box.appendChild(el('div', 'panel-title', 'Battle'));
    box.appendChild(el('div', 'panel-note', 'Sides line up either side of the view, their tanks behind them, and go for each other. Anyone can join a side from their right-click menu (Team).'));
    this.rows = el('div', 'army-sides');
    box.appendChild(this.rows);
    const opts = el('label', 'set-row');
    opts.appendChild(el('span', '', 'Clear the scene first'));
    const clear = el('input');
    clear.type = 'checkbox';
    clear.checked = this.clearFirst;
    clear.onchange = () => (this.clearFirst = clear.checked);
    opts.appendChild(clear);
    box.appendChild(opts);
    const io = el('div', 'set-io army-btns');
    this.btnAdd = el('button', 'panel-btn', 'Add side');
    this.btnAdd.title = 'Another side (up to four)';
    this.btnAdd.onclick = () => {
      this.game.sound.ui('click');
      this.addSide();
    };
    const go = el('button', 'panel-btn army-start', 'Start battle');
    go.title = 'Line the sides up and let them fight';
    go.onclick = () => {
      this.game.sound.ui('click');
      this.start();
    };
    io.append(this.btnAdd, go);
    box.appendChild(io);
    const close = el('button', 'panel-close', 'Close');
    close.onclick = () => this.ui.close();
    box.appendChild(close);
    root.appendChild(this.overlay);
  }

  /** Fills the panel in afresh (each time it's opened). */
  render(): void {
    this.rows.textContent = '';
    this.sides.forEach((s, i) => this.rows.appendChild(this.row(s, i)));
    this.btnAdd.disabled = this.sides.length >= TEAM_IDS.length;
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }

  /**
   * One side's lines: its colour, how many, armed with what (a kit, or one gun
   * each: the guns in a group of their own), and a button to take it away (with
   * more than two); under them, how many tanks it brings, and which.
   */
  private row(s: Side, i: number): HTMLDivElement {
    const r = el('div', 'set-row army-side');
    const swatch = el('span', 'army-swatch');
    swatch.style.background = TEAMS[s.team].css;
    const team = el('select', 'tb-select');
    team.title = 'The side’s colour';
    for (const id of TEAM_IDS) team.appendChild(el('option', '', TEAMS[id].name)).value = id;
    team.value = s.team;
    team.onchange = () => {
      s.team = team.value as TeamId;
      swatch.style.background = TEAMS[s.team].css;
      // (left focused, it would take the keys meant for the sandbox)
      team.blur();
    };
    const count = el('input', 'set-iters-num');
    count.type = 'number';
    count.max = String(LINE.most);
    count.title = `How many (1-${LINE.most}; with tanks, none will do)`;
    const kit = el('select', 'tb-select');
    kit.title = 'What they’re armed with: a kit, or one gun each';
    for (const l of LOADOUTS) if (available(l.id)) kit.appendChild(el('option', '', l.name)).value = l.id;
    const guns = battleGuns(this.game);
    if (guns.length) {
      const group = kit.appendChild(el('optgroup'));
      group.label = 'One weapon';
      for (const d of guns) group.appendChild(el('option', '', d.name)).value = GUN + d.id;
    }
    kit.value = s.loadout === 'gun' ? GUN + s.gun : available(s.loadout) ? s.loadout : 'melee';
    // (a gun the catalog hasn't got: melee weapons, as at first)
    if (!kit.value) kit.value = 'melee';
    armWith(s, kit.value);
    kit.onchange = () => {
      armWith(s, kit.value);
      kit.blur();
    };
    const left = el('span', 'army-side-name');
    left.append(swatch, team);
    r.append(left, count, kit);
    if (this.sides.length > 2) {
      r.classList.add('army-drop');
      const del = el('button', 'panel-btn', '×');
      del.title = 'Take this side away';
      del.onclick = () => {
        this.sides.splice(i, 1);
        this.render();
      };
      r.appendChild(del);
    }
    const models = battleTanks();
    const tanks = el('input', 'set-iters-num');
    const model = el('select', 'tb-select');
    /** The people's count kept to what the tanks allow (none only with tanks), and the kind of tank dimmed with none. */
    const fit = () => {
      const t = s.tanks ?? 0;
      count.min = t ? '0' : '1';
      if (!t && !s.count) s.count = 1;
      count.value = String(s.count);
      model.classList.toggle('army-off', !t);
    };
    count.onchange = () => {
      s.count = clamp(Math.round(parseFloat(count.value)) || 0, 0, LINE.most);
      fit();
    };
    if (models.length) {
      const name = el('span', 'army-tanks-name', 'Tanks');
      tanks.type = 'number';
      tanks.min = '0';
      tanks.max = String(LINE.tanks);
      tanks.value = String(s.tanks ?? 0);
      tanks.title = `How many tanks, lined up behind them (0-${LINE.tanks})`;
      tanks.onchange = () => {
        s.tanks = clamp(Math.round(parseFloat(tanks.value)) || 0, 0, LINE.tanks);
        tanks.value = String(s.tanks);
        fit();
      };
      model.title = 'Which tank';
      for (const d of models) model.appendChild(el('option', '', d.name)).value = d.id;
      model.value = s.tank ?? 'tank-abrams';
      if (!model.value) model.value = models[0].id;
      s.tank = model.value;
      model.onchange = () => {
        s.tank = model.value;
        model.blur();
      };
      r.append(name, tanks, model);
    }
    fit();
    return r;
  }

  /** Another side, in a colour none of the others is in, otherwise as the last. */
  private addSide(): void {
    const team = TEAM_IDS.find((id) => !this.sides.some((s) => s.team === id));
    if (!team) return;
    const last = this.sides[this.sides.length - 1];
    this.sides.push(last ? { ...last, team } : { team, count: 8, loadout: 'melee' });
    this.render();
  }

  /** Lines them up in the middle of the view (see spawnBattle()): undone in one go. */
  private start(): void {
    const c = this.controls;
    if (c.net) {
      this.ui.toast('Only the host can start a battle');
      return;
    }
    if (new Set(this.sides.map((s) => s.team)).size < this.sides.length) {
      this.ui.toast('Give each side a colour of its own');
      return;
    }
    if (this.clearFirst) c.clearScene('Battle');
    else c.history.record('Battle');
    const r = this.game.renderer;
    const made = spawnBattle(this.game, this.sides, { x: r.camX, y: r.camY });
    this.ui.close();
    const n = made.reduce((sum, m) => sum + m.length, 0);
    const t = made.tanks.reduce((sum, m) => sum + m.length, 0);
    // (too many for the world, some tanks were left out)
    const short = this.sides.reduce((sum, s) => sum + tanksOf(s), 0) - t;
    const tanks = (k: number) => `${k} tank${k === 1 ? '' : 's'}`;
    const who = [n ? String(n) : '', t ? tanks(t) : ''].filter((w) => w).join(' and ');
    const sides = made.filter((m, i) => m.length || made.tanks[i].length).length;
    this.ui.toast(`Battle: ${who} on ${sides} sides${short > 0 ? ` (no room for ${tanks(short)} more)` : ''}`);
  }
}

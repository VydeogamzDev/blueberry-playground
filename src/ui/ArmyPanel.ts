import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Entity } from '../world/Entity';
import { WORLD } from '../engine/constants';
import { clamp } from '../engine/math';
import { getItem } from '../catalog/items';
import { TEAMS, TEAM_IDS, isTeamMember, type TeamId, type TeamMember } from '../systems/Teams';

/** What a side's soldiers are armed with (dogs: a pack of dogs instead of people). */
export type Loadout = 'fists' | 'melee' | 'pistols' | 'rifles' | 'mixed' | 'crossbows' | 'dogs';

/** A side in a battle: its colour, how many, and what they're armed with. */
export interface Side {
  team: TeamId;
  count: number;
  loadout: Loadout;
}

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

/** The weapons a side's soldiers are given, each the next in turn (null: fists). Any the catalog hasn't got are left out. */
const KITS: Record<Exclude<Loadout, 'dogs'>, (string | null)[]> = {
  fists: [null],
  melee: ['bat', 'sword', 'axe', 'crowbar', 'hammer'],
  pistols: ['pistol', 'pistol', 'revolver'],
  rifles: ['rifle'],
  mixed: ['bat', 'pistol', 'sword', 'rifle', null, 'axe', 'shotgun', 'crossbow'],
  crossbows: ['crossbow'],
};

/**
 * Lining a battle up: how far apart soldiers stand in a rank (m: people, and dogs,
 * squeezed up nearer to fit in the world), how far apart the two front ranks start
 * (m), the gap between one side and the next lined up beyond it (m), and the most
 * soldiers a side may have.
 */
const LINE = { person: 0.9, dog: 1.4, least: 0.5, gap: 10, between: 2, most: 30 };

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

/**
 * Lines the sides up either side of `at` (on the ground under it): the first to the
 * left, the second to the right, a third beyond the first, and so on; each in a
 * rank facing the middle, armed, and on its team, so they go for each other at
 * once (see Teams). Returns who was put on each side.
 */
export function spawnBattle(game: Game, sides: Side[], at: { x: number; y: number }): TeamMember[][] {
  const out: TeamMember[][] = [];
  // (where the next side lines up, to the left and to the right)
  const from = [at.x - LINE.gap / 2, at.x + LINE.gap / 2];
  sides.forEach((s, i) => {
    const members: TeamMember[] = [];
    out.push(members);
    const dir = i % 2 === 0 ? -1 : 1;
    const k = dir < 0 ? 0 : 1;
    const l = s.loadout;
    const dogs = l === 'dogs';
    const def = getItem(dogs ? 'dog' : 'human');
    if (!def) return;
    const n = clamp(Math.round(s.count) || 1, 1, LINE.most);
    const start = from[k];
    const room = dir < 0 ? start - (WORLD.left + 1) : WORLD.right - 1 - start;
    const step = clamp(room / n, LINE.least, dogs ? LINE.dog : LINE.person);
    const kit = l === 'dogs' ? [] : KITS[l].filter((id) => id === null || !!getItem(id));
    // (the right-hand side faces left, toward the middle)
    const flip = dir > 0;
    for (let j = 0; j < n; j++) {
      const x = start + dir * step * (j + 0.5);
      const y = game.env.standAt(x, at.y + 3) + (def.halfHeight ?? 0.9) + 0.05;
      const e = game.spawn(def, x, y, { flip });
      if (!isTeamMember(e)) continue;
      e.setTeam(s.team);
      members.push(e);
      const id = kit.length ? kit[j % kit.length] : null;
      const w = id ? getItem(id) : undefined;
      if (!w) continue;
      const it = game.spawn(w, x, y + 0.3, { flip });
      const taker = e as Entity & { take?(item: Entity): boolean };
      if (it && !taker.take?.(it)) game.remove(it);
    }
    from[k] = start + dir * (step * n + LINE.between);
  });
  return out;
}

/**
 * The Battle panel (the toolbar's battle button, and the pause menu): two to four
 * sides, each a colour, how many and what they're armed with; Start battle lines
 * them up either side of the middle of the view, and they charge.
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
    box.appendChild(el('div', 'panel-note', 'Sides line up either side of the view and go for each other. Anyone can join a side from their right-click menu (Team).'));
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

  /** One side's line: its colour, how many, armed with what, and a button to take it away (with more than two). */
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
    count.min = '1';
    count.max = String(LINE.most);
    count.value = String(s.count);
    count.title = `How many (1-${LINE.most})`;
    count.onchange = () => {
      s.count = clamp(Math.round(parseFloat(count.value)) || 1, 1, LINE.most);
      count.value = String(s.count);
    };
    const kit = el('select', 'tb-select');
    kit.title = 'What they’re armed with';
    for (const l of LOADOUTS) if (available(l.id)) kit.appendChild(el('option', '', l.name)).value = l.id;
    kit.value = available(s.loadout) ? s.loadout : 'melee';
    kit.onchange = () => {
      s.loadout = kit.value as Loadout;
      kit.blur();
    };
    const left = el('span', 'army-side-name');
    left.append(swatch, team);
    const right = el('span', 'set-io');
    right.append(count, kit);
    if (this.sides.length > 2) {
      const del = el('button', 'panel-btn', '×');
      del.title = 'Take this side away';
      del.onclick = () => {
        this.sides.splice(i, 1);
        this.render();
      };
      right.appendChild(del);
    }
    r.append(left, right);
    return r;
  }

  /** Another side, in a colour none of the others is in. */
  private addSide(): void {
    const team = TEAM_IDS.find((id) => !this.sides.some((s) => s.team === id));
    if (!team) return;
    const last = this.sides[this.sides.length - 1];
    this.sides.push({ team, count: last?.count ?? 8, loadout: last?.loadout ?? 'melee' });
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
    this.ui.toast(`Battle: ${n} on ${made.filter((m) => m.length).length} sides`);
  }
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Tank } from '../../entities/Tank';
import { WORLD } from '../../engine/constants';
import { validateMap, type TerrainPiece } from '../../world/Maps';
import { saveToString } from '../../world/SaveLoad';
import { stillUp } from '../../systems/Fighting';
import { isTeamMachine, isTeamMember, teamOf, type TeamMachine, type TeamMember } from '../../systems/Teams';
import { battleGuns, battleTanks, spawnBattle, type ArmyPanel, type Side } from '../../ui/ArmyPanel';

/**
 * The Battle panel's specific guns and tanks: a side armed with one gun each
 * (any on the Firearms shelf a soldier can fire), tanks lined up behind a side or
 * making one up alone, the old kits as they were, and everyone inside the world.
 * Sides of several squads, each armed its own way, in order in their rank; and
 * the banner saying who won a battle started from the panel (and nothing for one
 * done away with).
 */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const held = (e: Entity) => (e as Human).heldItems()[0]?.def.id ?? 'nothing';
  const shots = (e: Entity | undefined) => (e as { shots?: number } | undefined)?.shots ?? 0;
  /** Its parts' furthest reach left and right (m: their middles, give or take half a sprite). */
  const span = (e: Entity): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of e.parts) {
      if (p.destroyed) continue;
      const r = (Math.max(p.w, p.h) / 32) * 0.5;
      lo = Math.min(lo, p.x - r);
      hi = Math.max(hi, p.x + r);
    }
    return [lo, hi];
  };
  /** Anything outside the world's walls, or with a part's middle inside the ground: what and where (null: none). */
  const misplaced = (): string | null => {
    for (const e of game.entities) {
      for (const p of e.parts) {
        if (p.destroyed) continue;
        if (p.x < WORLD.left + 0.2 || p.x > WORLD.right - 0.2) return `${e.def.id}'s ${p.name} at x ${p.x.toFixed(2)}, outside the world (${WORLD.left} to ${WORLD.right})`;
        const top = game.env.standAt(p.x, p.y);
        if (top > p.y + 0.01) return `${e.def.id}'s ${p.name} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is in the ground (its top there is ${top.toFixed(2)})`;
      }
    }
    return null;
  };
  /** The tanks of a side overlapping each other or anyone of either side (what overlaps what), or null. */
  const crowded = (all: Entity[]): string | null => {
    const tanks = all.filter((e) => (e as Partial<TeamMachine>).fightsForTeam);
    for (const t of tanks) {
      const [a0, a1] = span(t);
      for (const o of all) {
        if (o === t || (o as { holder?: unknown }).holder) continue;
        const [b0, b1] = span(o);
        // (a person standing in a tank's sprite's reach, by its middle)
        const mid = (b0 + b1) / 2;
        if (o.def.id !== t.def.id ? mid > a0 + 0.2 && mid < a1 - 0.2 : b0 < a1 - 0.3 && b1 > a0 + 0.3) return `${t.def.id} at ${a0.toFixed(1)} to ${a1.toFixed(1)} overlaps ${o.def.id} at ${b0.toFixed(1)} to ${b1.toFixed(1)}`;
      }
    }
    return null;
  };
  const box = (x0: number, y0: number, x1: number, y1: number): TerrainPiece => ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  /** The Battle panel, as the interface has it. */
  const panel = () => (window as unknown as { bp: { ui: { army: ArmyPanel } } }).bp.ui.army;
  /** Sets the panel's sides to these (a copy), opens it from the tool bar and presses Start battle; its own sides are put back after. */
  const startFromPanel = (sides: Side[]): void => {
    const p = panel();
    const was = JSON.parse(JSON.stringify(p.sides)) as Side[];
    const clear = p.clearFirst;
    try {
      p.sides.splice(0, p.sides.length, ...(JSON.parse(JSON.stringify(sides)) as Side[]));
      p.clearFirst = false;
      document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title^="Battle"]')?.click();
      p.overlay.querySelector<HTMLButtonElement>('.army-start')!.click();
    } finally {
      controls.ui.closeOverlays();
      p.sides.splice(0, p.sides.length, ...was);
      p.clearFirst = clear;
    }
  };
  /** The banner taken down and emptied, so whatever it says next is new. */
  const unshow = () => {
    panel().banner.classList.remove('show');
    panel().banner.textContent = '';
  };
  /** What the banner says, if it's up (null: it isn't). */
  const shown = (): string | null => (panel().banner.classList.contains('show') ? panel().banner.textContent ?? '' : null);
  /** Runs time on (in quarter seconds, up to `most` s) till the banner goes up; what it says, or null. */
  const awaitBanner = (most: number): string | null => {
    for (let t = 0; t < most && shown() === null; t += 0.25) kit.advance(0.25);
    return shown();
  };
  /** Everyone of a side in the scene: its people (and dogs), and its tanks. */
  const people = (team: string) => game.entities.filter((e): e is TeamMember => isTeamMember(e) && teamOf(e) === team);
  const machines = (team: string) => game.entities.filter((e): e is TeamMachine => isTeamMachine(e) && teamOf(e) === team);
  const die = (e: Entity) => (e as unknown as { die(): void }).die();
  /** What a soldier fights with, the melee kit as one and pistols and revolvers as one: 'dog' for a dog. */
  const arm = (e: Entity) => {
    const id = e.def.id === 'dog' ? 'dog' : held(e);
    return ['bat', 'sword', 'axe', 'crowbar', 'hammer'].includes(id) ? 'melee' : id === 'revolver' ? 'pistol' : id;
  };
  /** A side's soldiers from its front to its back (`dir` 1: a side on the left, facing right), by what they fight with. */
  const ranks = (side: Entity[], dir: number) => [...side].sort((a, b) => dir * (b.center().x - a.center().x)).map(arm);
  /** `n` of each, in turn. */
  const runs = (...list: [string, number][]) => list.flatMap(([id, n]) => Array<string>(n).fill(id));

  return [
    ['extra: battle: the One weapon list has the guns, launchers and crossbow soldiers fight with, and no ammunition or extinguisher', () => {
      kit.reset();
      const ids = battleGuns(game).map((d) => d.id);
      for (const want of ['pistol', 'rifle', 'sniper', 'rpg', 'crossbow']) if (!ids.includes(want)) return `no ${want} in the list (${ids.join(', ')})`;
      for (const not of ['fire-extinguisher', 'bolt-normal', 'rpg-rocket', 'launcher-round']) if (ids.includes(not)) return `${not} is in the list`;
      if (game.entities.length) return `looking the guns up left ${game.entities.length} things in the scene`;
      const models = battleTanks().map((d) => d.id);
      for (const want of ['tank', 'tank-abrams', 'tank-ztz99a', 'tank-leopard']) if (!models.includes(want)) return `no ${want} among the tanks (${models.join(', ')})`;
      return true;
    }],
    ['extra: battle: two sides each armed with one chosen gun: every soldier holds that gun', () => {
      kit.reset();
      const [red, blue] = spawnBattle(game, [{ team: 'red', count: 5, loadout: 'gun', gun: 'sniper' }, { team: 'blue', count: 4, loadout: 'gun', gun: 'rpg' }], { x: 0, y: 0 });
      if (red.length !== 5 || blue.length !== 4) return `lined up ${red.length} and ${blue.length} (wanted 5 and 4)`;
      if (red.some((e) => held(e) !== 'sniper')) return `red, each with a sniper rifle, hold: ${red.map(held).join(', ')}`;
      if (blue.some((e) => held(e) !== 'rpg')) return `blue, each with an RPG, hold: ${blue.map(held).join(', ')}`;
      // (and nothing else lying about: each gun went into a hand)
      const loose = game.entities.filter((e) => (e as { hold?: unknown; holder?: unknown }).hold && !(e as { holder?: unknown }).holder);
      if (loose.length) return `${loose.length} guns left lying about (${loose.map((e) => e.def.id).join(', ')})`;
      return true;
    }],
    ['extra: battle: every gun in the One weapon list is fired at the enemy by a soldier armed with it, and hits them', () => {
      const bad: string[] = [];
      for (const d of battleGuns(game)) {
        kit.reset();
        const [[a], [b]] = spawnBattle(game, [{ team: 'red', count: 1, loadout: 'gun', gun: d.id }, { team: 'blue', count: 1, loadout: 'fists' }], { x: 0, y: 0 });
        if (!a || !b) return `${d.id}: lined up ${a ? 1 : 0} and ${b ? 1 : 0}`;
        const gun = (a as Human).heldItems()[0];
        if (gun?.def.id !== d.id) {
          bad.push(`${d.id}: held ${gun?.def.id ?? 'nothing'}`);
          continue;
        }
        // (the enemy held where they stand, 11 m off; a bullet or anything else the gun does to them counts: the stun gun's jolt hardly hurts)
        b.setFrozen(true);
        let hits = 0;
        const hurt = b.damage.bind(b);
        const shot = b.onBullet.bind(b);
        b.damage = (...x) => {
          hits++;
          return hurt(...x);
        };
        b.onBullet = (...x) => {
          hits++;
          return shot(...x);
        };
        // (the flintlock's slow reload: a miss, and its second shot comes 10 s or so in)
        for (let t = 0; t < 14 && !(shots(gun) && hits); t += 0.25) kit.advance(0.25);
        if (!shots(gun)) bad.push(`${d.id}: never fired (${(a as Human).status()}, foe ${a.foe ? 'set' : 'none'})`);
        else if (!hits) bad.push(`${d.id}: fired ${shots(gun)} times and never hit them`);
      }
      return bad.length ? bad.join('; ') : true;
    }],
    ['extra: battle: a side of two Abrams against a side of soldiers: the tanks are on their side, face the enemy and fire within 10 s', () => {
      kit.reset();
      const made = spawnBattle(game, [{ team: 'red', count: 0, loadout: 'fists', tanks: 2, tank: 'tank-abrams' }, { team: 'blue', count: 6, loadout: 'rifles' }], { x: 0, y: 0 });
      const tanks = made.tanks[0] as Tank[];
      if (made[0].length || tanks.length !== 2 || made[1].length !== 6) return `lined up ${made[0].length} people and ${tanks.length} tanks against ${made[1].length} (wanted 0 and 2 against 6)`;
      if (tanks.some((t) => t.def.id !== 'tank-abrams' || teamOf(t) !== 'red')) return `the tanks: ${tanks.map((t) => `${t.def.id} on ${teamOf(t)}`).join(', ')}`;
      const foeX = Math.min(...made[1].map((e) => e.center().x));
      if (tanks.some((t) => t.body.flip !== 1 || span(t)[1] > foeX - 3)) return `the tanks don't face the enemy from their side (at ${tanks.map((t) => t.body.x.toFixed(1)).join(', ')} facing ${tanks.map((t) => t.body.flip).join(', ')}; the enemy from ${foeX.toFixed(1)})`;
      const all = [...made[0], ...made[1], ...tanks];
      const why = crowded(all) ?? misplaced();
      if (why) return why;
      let first = -1;
      for (let t = 0; t < 10 && first < 0; t += 0.5) {
        kit.advance(0.5);
        if (tanks.some((k) => k.shots)) first = t + 0.5;
      }
      if (first < 0) return `in 10 s no tank fired (foes: ${tanks.map((t) => (t.foe ? t.foe.def.id : 'none')).join(', ')}; laid at ${tanks.map((t) => t.elevation.toFixed(1)).join(', ')}°)`;
      return true;
    }],
    ['extra: battle: tanks alone (no people) on both sides line up in the world, facing each other, and fight', () => {
      kit.reset();
      const made = spawnBattle(game, [
        { team: 'green', count: 0, loadout: 'melee', tanks: 3, tank: 'tank-leopard' },
        { team: 'yellow', count: 0, loadout: 'melee', tanks: 2, tank: 'tank-ztz99a' },
      ], { x: 0, y: 0 });
      const [g, y] = made.tanks as Tank[][];
      if (made[0].length || made[1].length) return `with no people asked for, ${made[0].length} and ${made[1].length} lined up`;
      if (g.length !== 3 || y.length !== 2) return `lined up ${g.length} and ${y.length} tanks (wanted 3 and 2)`;
      if (g.some((t) => t.body.flip !== 1 || t.def.id !== 'tank-leopard') || y.some((t) => t.body.flip !== -1 || t.def.id !== 'tank-ztz99a')) return 'a tank faces away from the enemy, or is the wrong kind';
      if (Math.max(...g.map((t) => span(t)[1])) > Math.min(...y.map((t) => span(t)[0]))) return 'the two sides overlap';
      const why = crowded([...g, ...y]) ?? misplaced();
      if (why) return why;
      kit.advance(1);
      if (g.some((t) => !t.foe) || y.some((t) => !t.foe)) return `a second in, not every tank has a foe (${[...g, ...y].map((t) => (t.foe ? t.foe.def.id : 'none')).join(', ')})`;
      let fired = [0, 0];
      for (let t = 0; t < 10 && !(fired[0] && fired[1]); t += 0.5) {
        kit.advance(0.5);
        fired = [g, y].map((s) => s.reduce((n, k) => n + k.shots, 0));
      }
      if (!fired[0] || !fired[1]) return `in 11 s the sides fired ${fired[0]} and ${fired[1]} shells`;
      return true;
    }],
    ['extra: battle: tanks lined up behind their own soldiers (and behind each other) fire past them at the enemy, and kill none of them', () => {
      kit.reset();
      const made = spawnBattle(game, [
        { team: 'red', count: 6, loadout: 'rifles', tanks: 2, tank: 'tank-abrams' },
        { team: 'blue', count: 0, loadout: 'fists', tanks: 1, tank: 'tank' },
      ], { x: 0, y: 0 });
      const ours = made.tanks[0] as Tank[];
      const target = made.tanks[1][0] as Tank;
      // (the enemy tank's crew sit still: only ours fire)
      (target as unknown as { handsOff: number }).handsOff = 1e9;
      let fired = ours.map(() => 0);
      for (let t = 0; t < 12 && fired.some((n) => !n); t += 0.5) {
        kit.advance(0.5);
        fired = ours.map((k) => k.shots);
      }
      const dead = made[0].filter((h) => !(h as Human).alive).length;
      if (fired.some((n) => !n)) return `in 12 s the tanks fired ${fired.join(' and ')} shells (foes: ${ours.map((k) => (k.foe ? k.foe.def.id : 'none')).join(', ')})`;
      if (dead) return `${dead} of their own 6 soldiers were killed`;
      return true;
    }],
    ['extra: battle: soldiers against a side of tanks alone go for the tanks and shoot at them, rifles and RPGs', () => {
      for (const gun of ['rpg', 'rifle']) {
        kit.reset();
        const made = spawnBattle(game, [
          { team: 'red', count: 3, loadout: 'gun', gun },
          { team: 'blue', count: 0, loadout: 'fists', tanks: 1, tank: 'tank' },
        ], { x: 0, y: 0 });
        const tank = made.tanks[1][0] as Tank;
        (tank as unknown as { handsOff: number }).handsOff = 1e9;
        let fired = 0;
        for (let t = 0; t < 12 && !fired; t += 0.5) {
          kit.advance(0.5);
          fired = made[0].reduce((n, h) => n + shots((h as Human).heldItems()[0]), 0);
        }
        const foes = made[0].map((h) => (h.foe ? h.foe.def.id : 'none'));
        if (foes.some((f) => f !== tank.def.id)) return `${gun}s: the soldiers went for ${foes.join(', ')}`;
        if (!fired) return `${gun}s: in 12 s none of them fired at the tank`;
      }
      return true;
    }],
    ['extra: battle: the old loadouts line up as before: as many as asked, armed from their kit, each side on its half facing the middle', () => {
      const kits: Record<string, string[]> = {
        fists: ['nothing'], melee: ['bat', 'sword', 'axe', 'crowbar', 'hammer'], pistols: ['pistol', 'revolver'], rifles: ['rifle'],
        mixed: ['bat', 'pistol', 'sword', 'rifle', 'nothing', 'axe', 'shotgun', 'crossbow'], crossbows: ['crossbow'],
      };
      const pairs: Side['loadout'][][] = [['fists', 'melee'], ['pistols', 'rifles'], ['mixed', 'crossbows'], ['dogs', 'melee']];
      for (const [l, r] of pairs) {
        kit.reset();
        const [a, b] = spawnBattle(game, [{ team: 'red', count: 8, loadout: l }, { team: 'blue', count: 6, loadout: r }], { x: 3, y: 0 });
        if (a.length !== 8 || b.length !== 6) return `${l} against ${r}: lined up ${a.length} and ${b.length} (wanted 8 and 6)`;
        for (const [side, loadout] of [[a, l], [b, r]] as const) {
          if (loadout === 'dogs') {
            if (side.some((e) => e.def.id !== 'dog')) return 'the side of dogs is not dogs';
            continue;
          }
          const bad = side.map(held).filter((id) => !kits[loadout].includes(id));
          if (bad.length) return `armed with ${loadout}, they hold: ${side.map(held).join(', ')}`;
        }
        // (8 a metre apart or so, the first side's front rank 5 m left of the middle: from half a step beyond that)
        const xs = a.map((e) => e.center().x);
        if (a.some((e) => e.flipped) || Math.max(...xs) > -1.5 || Math.max(...xs) < -3 || Math.max(...xs) - Math.min(...xs) < 5) return `${l}: the first side stands from ${Math.min(...xs).toFixed(1)} to ${Math.max(...xs).toFixed(1)}, ${a.some((e) => e.flipped) ? 'some' : 'none'} facing left`;
        if (b.some((e) => !e.flipped || e.center().x < 7.5)) return `${r}: the second side is not on the right of the middle (x 3), facing left`;
        const why = misplaced();
        if (why) return why;
      }
      return true;
    }],
    ['extra: battle: nothing lines up outside the world or inside the ground: four full sides of people and tanks by a wall, and over a hill', () => {
      const big: Side[] = [
        { team: 'red', count: 30, loadout: 'fists', tanks: 4, tank: 'tank-abrams' },
        { team: 'blue', count: 30, loadout: 'dogs', tanks: 4, tank: 'tank-leopard' },
        { team: 'green', count: 30, loadout: 'fists', tanks: 4, tank: 'tank' },
        { team: 'yellow', count: 30, loadout: 'fists', tanks: 4, tank: 'tank-ztz99a' },
      ];
      kit.reset();
      // (the view right by the right-hand wall)
      const made = spawnBattle(game, big, { x: WORLD.right - 3, y: 2 });
      const people = made.reduce((n, m) => n + m.length, 0);
      const tanks = made.tanks.flat();
      if (people !== 120) return `by the wall, ${people} people and dogs lined up (wanted 120)`;
      if (tanks.length < 4) return `by the wall, only ${tanks.length} tanks lined up`;
      if (made.tanks.some((t) => !t.length)) return `a side lost all its tanks for room (${made.tanks.map((t) => t.length).join(', ')})`;
      const why = misplaced() ?? crowded([...made.flat(), ...tanks]);
      if (why) return `by the wall: ${why}`;
      // a block 1.5 m high under the middle of the field, and a smaller sides' battle over it
      kit.reset();
      game.setMap(validateMap({ id: 'custom:test', name: 'Test map', width: 140, height: 48, theme: 'concrete', terrain: [box(-14, 0, -4, 1.5), box(8, 0, 20, 2.5)] as TerrainPiece[] })!);
      const hill = spawnBattle(game, [{ team: 'red', count: 10, loadout: 'melee', tanks: 2, tank: 'tank-abrams' }, { team: 'blue', count: 10, loadout: 'pistols', tanks: 1, tank: 'tank' }], { x: 0, y: 1 });
      const why2 = misplaced() ?? crowded([...hill.flat(), ...hill.tanks.flat()]);
      if (why2) return `over the blocks: ${why2}`;
      kit.advance(0.5);
      const why3 = misplaced();
      if (why3) return `over the blocks, half a second on: ${why3}`;
      return true;
    }],
    ['extra: battle: the panel offers One weapon and tanks; picked there, Start lines up those guns and tanks', () => {
      kit.reset();
      const panel = (window as unknown as { bp: { ui: { army: ArmyPanel } } }).bp.ui.army;
      const was = panel.sides.map((s) => ({ ...s }));
      try {
        document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title^="Battle"]')?.click();
        const box = panel.overlay;
        if (box.classList.contains('hidden')) return 'the Battle button did not open the panel';
        const rows = () => [...box.querySelectorAll('.army-side')];
        while (rows().length > 2) box.querySelector<HTMLButtonElement>('.army-side .panel-btn')!.click();
        const pick = (row: Element, i: number, value: string) => {
          const inputs = row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input[type=number]');
          inputs[i].value = value;
          inputs[i].dispatchEvent(new Event('change'));
          return inputs[i].value === value;
        };
        const [r0, r1] = rows();
        const group = r0.querySelector('optgroup');
        if (!group || !group.querySelector('option[value="gun:sniper"]')) return 'no One weapon group with the sniper rifle in it';
        if (group.querySelector('option[value="gun:fire-extinguisher"]')) return 'the fire extinguisher is offered as a weapon';
        // red: 3 with shotguns and 2 Leopards; blue: tanks alone, one ZTZ-99A
        if (!pick(r0, 0, 'red') || !pick(r0, 1, '3') || !pick(r0, 2, 'gun:shotgun') || !pick(r0, 3, '2') || !pick(r0, 4, 'tank-leopard')) return 'could not set the first side';
        if (!pick(r1, 0, 'blue') || !pick(r1, 3, '1') || !pick(r1, 4, 'tank-ztz99a') || !pick(r1, 1, '0')) return 'could not set the second side to a tank alone';
        box.querySelector<HTMLButtonElement>('.army-start')!.click();
      } finally {
        controls.ui.closeOverlays();
        panel.sides.splice(0, panel.sides.length, ...was);
      }
      const on = (t: string) => game.entities.filter((e) => teamOf(e) === t);
      const red = on('red');
      const blue = on('blue');
      const people = red.filter((e) => e.def.id === 'human');
      if (people.length !== 3 || people.some((e) => held(e) !== 'shotgun')) return `red: ${people.length} people holding ${people.map(held).join(', ')} (wanted 3 with shotguns)`;
      if (red.filter((e) => e.def.id === 'tank-leopard').length !== 2) return `red's tanks: ${red.filter((e) => e.def.id !== 'human').map((e) => e.def.id).join(', ') || 'none'}`;
      if (blue.length !== 1 || blue[0].def.id !== 'tank-ztz99a') return `blue: ${blue.map((e) => e.def.id).join(', ') || 'nobody'} (wanted a ZTZ-99A alone)`;
      return true;
    }],
    ['extra: battle: a side of squads lines up as asked: each its count and arms, hand to hand in front, then guns, launchers and snipers at the back, its tanks behind them all', () => {
      kit.reset();
      const made = spawnBattle(game, [
        { team: 'red', count: 6, loadout: 'rifles', squads: [{ count: 2, loadout: 'gun', gun: 'rpg' }, { count: 1, loadout: 'gun', gun: 'sniper' }, { count: 3, loadout: 'melee' }], tanks: 2, tank: 'tank-abrams' },
        { team: 'blue', count: 4, loadout: 'pistols', squads: [{ count: 3, loadout: 'dogs' }] },
      ], { x: 0, y: 0 });
      const [red, blue] = made;
      const tanks = made.tanks[0];
      if (red.length !== 12 || blue.length !== 7 || tanks.length !== 2 || made.tanks[1].length) return `lined up ${red.length} and ${blue.length}, ${tanks.length} and ${made.tanks[1].length} tanks (wanted 12 and 7, 2 and 0)`;
      const r = ranks(red, 1).join(', ');
      const want = runs(['melee', 3], ['rifle', 6], ['rpg', 2], ['sniper', 1]).join(', ');
      if (r !== want) return `red, front to back: ${r} (wanted ${want})`;
      const b = ranks(blue, -1).join(', ');
      if (b !== runs(['dog', 3], ['pistol', 4]).join(', ')) return `blue, front to back: ${b} (wanted the dogs, then the pistols)`;
      if (red.some((e) => e.flipped) || blue.some((e) => !e.flipped)) return 'a side faces away from the other';
      // (nobody on top of anyone: each well apart from the next in the rank)
      for (const side of [red, blue]) {
        const xs = side.map((e) => e.center().x).sort((p, q) => p - q);
        for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 0.6) return `two of ${teamOf(side[0])} stand ${(xs[i] - xs[i - 1]).toFixed(2)} m apart, at ${xs[i].toFixed(2)}`;
      }
      const back = Math.min(...red.map((e) => e.center().x));
      if (tanks.some((t) => span(t)[1] > back - 0.5)) return `red's tanks reach to ${tanks.map((t) => span(t)[1].toFixed(1)).join(' and ')}, not behind its last soldier at ${back.toFixed(1)}`;
      return crowded([...red, ...blue, ...tanks]) ?? misplaced() ?? true;
    }],
    ['extra: battle: a side of one loadout lines up just as before squads: each soldier where they always stood, armed in the same turn', () => {
      const mixed = ['bat', 'pistol', 'sword', 'rifle', 'nothing', 'axe', 'shotgun', 'crossbow'];
      const lineup = (sides: Side[]) => {
        kit.reset();
        const [a, b] = spawnBattle(game, sides, { x: 3, y: 0 });
        return { a: a.map((e) => ({ x: e.center().x, id: held(e) })), b: b.map((e) => ({ x: e.center().x, id: e.def.id })) };
      };
      const old = lineup([{ team: 'red', count: 8, loadout: 'mixed' }, { team: 'blue', count: 5, loadout: 'dogs' }]);
      if (old.a.length !== 8 || old.b.length !== 5) return `lined up ${old.a.length} and ${old.b.length} (wanted 8 and 5)`;
      // (the first side from 5 m left of the middle, x 3, half a step on and each 0.9 m further; the dogs from 5 m right of it, 1.4 m apart)
      for (let j = 0; j < 8; j++) {
        const x = 3 - 5 - 0.9 * (j + 0.5);
        if (Math.abs(old.a[j].x - x) > 0.2 || old.a[j].id !== mixed[j]) return `red's ${j + 1}th stands at ${old.a[j].x.toFixed(2)} with ${old.a[j].id} (wanted ${x.toFixed(2)} with ${mixed[j]})`;
      }
      for (let j = 0; j < 5; j++) {
        const x = 3 + 5 + 1.4 * (j + 0.5);
        if (Math.abs(old.b[j].x - x) > 0.4 || old.b[j].id !== 'dog') return `blue's ${j + 1}th, ${old.b[j].id}, stands at ${old.b[j].x.toFixed(2)} (wanted a dog at ${x.toFixed(2)})`;
      }
      // the same sides with an empty list of squads: just the same
      const same = lineup([{ team: 'red', count: 8, loadout: 'mixed', squads: [] }, { team: 'blue', count: 5, loadout: 'dogs', squads: [] }]);
      const diff = [...old.a, ...old.b].findIndex((s, i) => {
        const t = [...same.a, ...same.b][i];
        return !t || Math.abs(t.x - s.x) > 0.01 || t.id !== s.id;
      });
      if (diff >= 0) return `with no squads listed, the ${diff + 1}th stood elsewhere or held something else`;
      return misplaced() ?? true;
    }],
    ['extra: battle: a side has 30 at most, its squads together (its first squad first); four full sides of squads by a wall still fit the world', () => {
      kit.reset();
      const [a] = spawnBattle(game, [
        { team: 'red', count: 25, loadout: 'rifles', squads: [{ count: 10, loadout: 'melee' }, { count: 10, loadout: 'dogs' }] },
        { team: 'blue', count: 2, loadout: 'fists' },
      ], { x: 0, y: 0 });
      const r = ranks(a, 1).join(', ');
      if (r !== runs(['melee', 5], ['rifle', 25]).join(', ')) return `asked for 25 rifles, 10 melee and 10 dogs, red lined up (front to back): ${r}`;
      const big: Side[] = (['red', 'blue', 'green', 'yellow'] as const).map((team) => ({
        team, count: 10, loadout: 'rifles', squads: [{ count: 10, loadout: 'dogs' }, { count: 10, loadout: 'gun', gun: 'rpg' }], tanks: 4, tank: 'tank-abrams',
      }));
      kit.reset();
      const made = spawnBattle(game, big, { x: WORLD.left + 3, y: 0 });
      const n = made.map((m) => m.length);
      if (n.some((k) => k !== 30)) return `by the wall the four sides lined up ${n.join(', ')} (wanted 30 each)`;
      for (const [i, side] of made.entries()) {
        const order = ranks(side, i % 2 ? -1 : 1).join(', ');
        if (order !== runs(['dog', 10], ['rifle', 10], ['rpg', 10]).join(', ')) return `side ${i + 1}, front to back: ${order}`;
      }
      return misplaced() ?? crowded([...made.flat(), ...made.tanks.flat()]) ?? true;
    }],
    ['extra: battle: the panel’s Add squad puts a line under a side, its × takes it away, and Start lines the squads up', () => {
      kit.reset();
      const p = panel();
      const was = JSON.parse(JSON.stringify(p.sides)) as Side[];
      try {
        p.sides.splice(0, p.sides.length, { team: 'red', count: 3, loadout: 'melee' }, { team: 'blue', count: 4, loadout: 'pistols' });
        document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title^="Battle"]')?.click();
        const box = p.overlay;
        if (box.classList.contains('hidden')) return 'the Battle button did not open the panel';
        const rows = () => [...box.querySelectorAll('.army-side')];
        const add = () => rows()[0].querySelector<HTMLButtonElement>('.army-add-squad')!;
        /** The first side's squad lines: each its count, what it's armed with and its ×. */
        const lines = () => [...rows()[0].querySelectorAll('.army-squad-name')].map((name) => {
          const count = name.nextElementSibling as HTMLInputElement;
          const arms = count.nextElementSibling as HTMLSelectElement;
          return { count, arms, del: arms.nextElementSibling as HTMLButtonElement };
        });
        const set = (e: HTMLInputElement | HTMLSelectElement, v: string) => {
          e.value = v;
          e.dispatchEvent(new Event('change'));
          return e.value;
        };
        if (!add()) return 'no Add squad button';
        if (lines().length) return 'a side of one loadout already shows squad lines';
        add().click();
        add().click();
        add().click();
        if (lines().length !== 3) return `three clicks of Add squad left ${lines().length} squad lines`;
        // (the third taken away again)
        lines()[2].del.click();
        if (lines().length !== 2 || p.sides[0].squads?.length !== 2) return `after its ×, ${lines().length} squad lines and ${p.sides[0].squads?.length ?? 0} squads`;
        const [a, b] = lines();
        if (set(a.count, '2') !== '2' || set(a.arms, 'gun:rpg') !== 'gun:rpg' || set(b.count, '1') !== '1' || set(b.arms, 'gun:sniper') !== 'gun:sniper') return 'could not set the squads';
        // (30 a side at most: the first line takes no more than leaves room for its squads, and Add squad greys out)
        const first = rows()[0].querySelector<HTMLInputElement>('input[type=number]')!;
        set(first, '40');
        if (first.value !== '27' || !add().disabled) return `asked for 40 beside squads of 2 and 1, the first line took ${first.value} (Add squad ${add().disabled ? 'greyed out' : 'still on'})`;
        set(first, '3');
        if (add().disabled) return 'Add squad stayed greyed out with room again';
        // (the tanks' line still there, under the squads)
        const tankLine = rows()[0].querySelector('.army-tanks-name');
        if (!tankLine || tankLine.compareDocumentPosition(b.del) & Node.DOCUMENT_POSITION_FOLLOWING) return 'the Tanks line is not under the squads';
        box.querySelector<HTMLButtonElement>('.army-start')!.click();
      } finally {
        controls.ui.closeOverlays();
        p.sides.splice(0, p.sides.length, ...was);
      }
      const red = people('red');
      const blue = people('blue');
      const got = red.map(arm).sort().join(', ');
      if (got !== runs(['melee', 3], ['rpg', 2], ['sniper', 1]).sort().join(', ')) return `red lined up with ${got} (wanted 3 melee, 2 RPGs and a sniper rifle)`;
      if (blue.length !== 4 || blue.some((e) => arm(e) !== 'pistol')) return `blue: ${blue.map(arm).join(', ')} (wanted 4 with pistols)`;
      return true;
    }],
    ['extra: battle: a battle from the panel ends with a banner naming the winner and what it has left of what it started with', () => {
      kit.reset();
      unshow();
      startFromPanel([{ team: 'red', count: 3, loadout: 'fists', tanks: 1, tank: 'tank' }, { team: 'blue', count: 2, loadout: 'fists' }]);
      const [red, blue, tank] = [people('red'), people('blue'), machines('red')[0]];
      if (red.length !== 3 || blue.length !== 2 || !tank) return `lined up ${red.length} and ${blue.length}, ${tank ? 'a tank' : 'no tank'}`;
      (tank as unknown as { handsOff: number }).handsOff = 1e9;
      kit.advance(1);
      if (shown() !== null) return `a second in, with both sides up, the banner says “${shown()}”`;
      // one of red's down for good, and all of blue's
      die(red[0]);
      blue.forEach(die);
      kit.advance(2);
      if (shown() !== null) return `2 s after blue went down (too soon to tell), the banner says “${shown()}”`;
      const said = awaitBanner(3);
      if (said === null) return '5 s after blue went down, no banner';
      if (!/^Red wins: 2 of 3 left standing, 1 of 1 tank, in 0:0[0-2]$/.test(said)) return `the banner says “${said}” (wanted red’s 2 of 3 and 1 tank, in a second or so)`;
      // a real fight: four riflemen against one, who's shot down
      kit.reset();
      unshow();
      startFromPanel([{ team: 'red', count: 4, loadout: 'rifles' }, { team: 'blue', count: 1, loadout: 'fists' }]);
      const [foe] = people('blue');
      if (!foe) return 'no one lined up on blue';
      // (since when blue's one has been down: -1, up)
      let down = -1;
      let t = 0;
      while (t < 40 && shown() === null) {
        kit.advance(0.25);
        t += 0.25;
        down = stillUp(foe) ? -1 : down < 0 ? t : down;
      }
      const said2 = shown();
      if (said2 === null) return `40 s on, no banner (blue's one ${stillUp(foe) ? 'still up' : 'down'})`;
      if (!/^Red wins: [1-4] of 4 left standing, in 0:\d\d$/.test(said2)) return `four riflemen against one, the banner says “${said2}”`;
      if (down < 0 || t - down < 2.5) return `the banner went up ${down < 0 ? 'with blue’s one still up' : `${(t - down).toFixed(2)} s after blue’s one went down`}`;
      return true;
    }],
    ['extra: battle: both sides down is a draw; a battle cleared, reset, loaded over, undone or replaced by another gets no banner', () => {
      kit.reset();
      const empty = saveToString(game);
      const two: Side[] = [{ team: 'red', count: 2, loadout: 'fists' }, { team: 'blue', count: 2, loadout: 'fists' }];
      unshow();
      startFromPanel(two);
      for (const e of [...people('red'), ...people('blue')]) game.remove(e);
      const draw = awaitBanner(5);
      if (draw === null || !/^Draw: nobody left standing, after 0:00$/.test(draw)) return `with everyone gone, the banner says ${draw === null ? 'nothing' : `“${draw}”`}`;
      /** A battle started, `then` done half a second in, and 5 s more: what the banner said ('' nothing). */
      const after = (then: () => void): string => {
        kit.reset();
        unshow();
        startFromPanel(two);
        kit.advance(0.5);
        then();
        kit.advance(5);
        return panel().banner.textContent ?? '';
      };
      const cases: [string, () => void][] = [
        ['cleared', () => controls.clearScene('Clear')],
        ['reset', () => kit.reset()],
        ['loaded over', () => controls.loadScene(empty, 'Load')],
        ['undone', () => controls.undo()],
      ];
      for (const [what, then] of cases) {
        const said = after(then);
        if (said) return `${what}, the banner said “${said}”`;
      }
      // another battle started over by the right-hand wall (its lot held still): the first one's lot gone says nothing, the second's end does
      const r = game.renderer;
      const cam = r.camX;
      try {
        const said = after(() => {
          const first = [...people('red'), ...people('blue')];
          r.camX = WORLD.right - 20;
          startFromPanel(two);
          for (const e of first) game.remove(e);
          for (const e of [...people('red'), ...people('blue')]) e.setFrozen(true);
        });
        if (said) return `the first battle done away with by a second, the banner said “${said}”`;
      } finally {
        r.camX = cam;
      }
      const blue = people('blue');
      if (people('red').length !== 2 || blue.length !== 2) return `the second battle has ${people('red').length} and ${blue.length} (wanted 2 and 2)`;
      blue.forEach(die);
      const won = awaitBanner(5);
      if (won === null || !won.startsWith('Red wins: 2 of 2 left standing')) return `the second battle won, the banner says ${won === null ? 'nothing' : `“${won}”`}`;
      return true;
    }],
  ];
}

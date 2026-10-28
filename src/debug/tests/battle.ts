import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Tank } from '../../entities/Tank';
import { WORLD } from '../../engine/constants';
import { validateMap, type TerrainPiece } from '../../world/Maps';
import { teamOf, type TeamMachine } from '../../systems/Teams';
import { battleGuns, battleTanks, spawnBattle, type ArmyPanel, type Side } from '../../ui/ArmyPanel';

/**
 * The Battle panel's specific guns and tanks: a side armed with one gun each
 * (any on the Firearms shelf a soldier can fire), tanks lined up behind a side or
 * making one up alone, the old kits as they were, and everyone inside the world.
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
  ];
}

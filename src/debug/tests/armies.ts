import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import type { Item } from '../../entities/Item';
import type { Firearm } from '../../entities/Firearm';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { validateMap, type MapSpec, type TerrainPiece } from '../../world/Maps';
import { onFeet, stillUp } from '../../systems/Fighting';
import { teamOf, type TeamMember } from '../../systems/Teams';
import { spawnBattle } from '../../ui/ArmyPanel';

/**
 * Smarter fighting and armies: weapons kept at their reach, guns held while a
 * friend is in the way, teams that find their own enemies (and the next), quick
 * to get up again, the Battle panel, and finding a way to the foe: no running off
 * roofs, leaping a gap that can be leapt, climbing up and jumping down to them.
 */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  const head = (h: Human) => h.limbs.get('head')!.part;
  /** Puts a fresh `id` straight into their hand (see Human.take()); what they hold then. */
  const give = (h: Human, id: string): Item | undefined => {
    const hand = h.limbs.get('handF')!.part;
    const it = kit.spawn(id, hand.x, hand.y + 0.4, { flip: h.flipped }) as Item;
    h.take(it);
    return h.heldItems()[0];
  };
  /** Opens `e`'s context menu and picks the item `label` (ticked or not); false if there's none. */
  const menu = (e: Entity, label: string): boolean => {
    const p = e.parts.find((q) => !q.destroyed)!;
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.textContent ?? '').replace(/^[☑☐] /, '').startsWith(label));
    if (!item) {
      controls.ui.closeContextMenu();
      return false;
    }
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };
  /** Counts the blows (and bites) that land on someone. */
  const counted = (e: Entity): (() => number) => {
    let n = 0;
    const d = e.damage.bind(e);
    e.damage = (...x) => {
      n++;
      return d(...x);
    };
    return () => n;
  };
  const jumping = (h: Human) => (h as unknown as { jumping: unknown }).jumping !== null;
  /** Who they're fighting (read through this, the checks don't narrow it for the rest of the test). */
  const foeOf = (e: Human | Creature): Entity | null => e.foe;
  const box = (x0: number, y0: number, x1: number, y1: number): TerrainPiece => ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  /** A test map: the lab's size, with this ground. */
  const custom = (terrain: TerrainPiece[]): MapSpec => validateMap({ id: 'custom:test', name: 'Test map', width: 140, height: 48, theme: 'concrete', terrain })!;
  /** Two flat roofs `h` m high with a gap `gap` m wide between them, at x = 0. */
  const roofs = (gap: number, h: number) => custom([box(-14, 0, -gap / 2, h), box(gap / 2, 0, 14, h)]);
  /** Someone standing on ground whose top is at `top`. */
  const standing = (x: number, top: number, opts = {}) => kit.spawn('human', x, top + 0.95, opts) as Human;
  const lowest = (h: Human) => Math.min(...h.parts.filter((p) => !p.destroyed).map((p) => p.y));
  const hp = (e: Entity) => e.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);

  return [
    ['extra: armies: two people with bats fight it out (blows land) to a winner well inside 30 s', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2, { flip: true });
      kit.advance(0.5);
      if (give(a, 'bat')?.def.id !== 'bat' || give(b, 'bat')?.def.id !== 'bat') return 'could not hand them both a bat';
      kit.advance(1);
      const onA = counted(a);
      const onB = counted(b);
      const hp0 = [hp(a), hp(b)];
      a.fight(b);
      let t = 0;
      for (; t < 30 && (a.foe || b.foe); t += 0.25) kit.advance(0.25);
      // (blows that land, and the bat's knocks that hurt as it swings through them)
      const hurt = [hp0[0] - hp(a), hp0[1] - hp(b)];
      const hits = `${onB()} blows landed on one, ${onA()} on the other; they lost ${hurt[1].toFixed(0)} and ${hurt[0].toFixed(0)} hp`;
      if (a.foe || b.foe) return `after 30 s still fighting: ${hits} (heads ${head(a).hp.toFixed(0)}, ${head(b).hp.toFixed(0)})`;
      if (onA() + onB() < 1 || Math.max(...hurt) < 15) return `it ended at ${t.toFixed(1)} s with ${hits}`;
      const out = [a, b].filter((h) => !h.upright || h.consciousness < 0.5).length;
      if (!out) return `it ended at ${t.toFixed(1)} s with both still standing (${hits})`;
      return true;
    }],
    ['extra: armies: fighting with bats, they keep about a bat’s reach apart and swing from there (not chest to chest)', () => {
      // (a few short fights: one is soon knocked down for good)
      const gaps: number[] = [];
      const swings: number[] = [];
      for (let round = 0; round < 3 && (gaps.length < 30 || swings.length < 4); round++) {
        kit.reset();
        const a = human(-2.5 - round * 0.3);
        const b = human(2.5, { flip: true });
        kit.advance(0.5);
        if (!give(a, 'bat') || !give(b, 'bat')) return 'could not hand them both a bat';
        kit.advance(1);
        a.fight(b);
        // (once they've come together)
        kit.advance(1.5);
        const swung = new Set<unknown>();
        for (let t = 0; t < 6 && a.foe && b.foe; t += 0.05) {
          kit.advance(0.05);
          if (a.state !== 'stand' || b.state !== 'stand') continue;
          const gap = Math.abs(torso(a).x - torso(b).x);
          gaps.push(gap);
          // (where each swing starts from)
          for (const h of [a, b]) {
            const blow = (h as unknown as { blow: { item: unknown } | null }).blow;
            if (blow?.item && !swung.has(blow)) {
              swung.add(blow);
              swings.push(gap);
            }
          }
        }
      }
      const mean = (l: number[]) => l.reduce((s, g) => s + g, 0) / l.length;
      if (gaps.length < 30) return `only ${gaps.length} moments with both on their feet and fighting`;
      const close = gaps.filter((g) => g < 0.7).length / gaps.length;
      if (mean(gaps) < 0.9 || mean(gaps) > 2) return `the gap between them averaged ${mean(gaps).toFixed(2)} m (a bat reaches about 1.1 m), over ${gaps.length} moments`;
      if (close > 0.25) return `chest to chest (under 0.7 m) ${(close * 100).toFixed(0)}% of the time (mean gap ${mean(gaps).toFixed(2)} m)`;
      if (swings.length < 3) return `only ${swings.length} swings in three short fights`;
      if (mean(swings) < 0.8 || mean(swings) > 1.5) return `swings started ${mean(swings).toFixed(2)} m apart on average (${swings.map((g) => g.toFixed(2)).join(', ')}): a bat reaches about 1.1 m`;
      return true;
    }],
    ['extra: armies: a gunman holds fire while one of their own side is in the line of fire, and fires once it’s clear', () => {
      kit.reset();
      const g = human(-4);
      const friend = human(-1.5);
      const foe = human(3, { flip: true });
      kit.advance(0.5);
      const gun = give(g, 'pistol') as Firearm | undefined;
      if (gun?.def.id !== 'pistol') return 'could not hand them a pistol';
      // (the friend and the foe held where they stand)
      torso(friend).setFrozen(true);
      torso(foe).setFrozen(true);
      g.setTeam('red');
      friend.setTeam('red');
      foe.setTeam('blue');
      kit.advance(3);
      if (g.foe !== foe) return `on a team, the gunman went for ${g.foe ? 'someone else' : 'nobody'}`;
      if (gun.shots) return `fired ${gun.shots} shots through their own side`;
      game.remove(friend);
      kit.advance(3);
      if (!gun.shots) return 'the line of fire clear, it never fired';
      return true;
    }],
    ['extra: armies: Team in the menu puts everyone picked on a side; sides fight on their own, a side never fights itself', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2, { flip: true });
      kit.advance(1);
      controls.selection.clear();
      controls.selection.add(a);
      controls.selection.add(b);
      if (!menu(a, 'Team: Red')) return 'no Team: Red in the menu for two people picked';
      controls.selection.clear();
      if (a.team !== 'red' || b.team !== 'red') return `Team: Red put them on ${a.team} and ${b.team}`;
      kit.advance(2);
      if (foeOf(a) || foeOf(b)) return 'two on the same side went for each other';
      if (a.fight(b)) return 'one was set on someone on their own side';
      if (!menu(b, 'Team: Blue')) return 'no Team: Blue in the menu';
      kit.advance(1.5);
      if (foeOf(a) !== b || foeOf(b) !== a) return `on different sides, they did not go for each other (${foeOf(a) ? 'A fights' : 'A idle'}, ${foeOf(b) ? 'B fights' : 'B idle'})`;
      // and a dog on a side goes for the other side too
      kit.reset();
      const p = human(-2);
      const dog = kit.spawn('dog', 2, 0.6, { flip: true }) as Creature;
      kit.advance(1);
      p.setTeam('green');
      dog.setTeam('yellow');
      kit.advance(1.5);
      if (dog.foe !== p) return 'a dog on a team did not go for the person on the other';
      return true;
    }],
    ['extra: armies: once the enemy they fight is knocked out, a soldier goes for the next', () => {
      kit.reset();
      const s = human(0);
      const first = human(1.8, { flip: true });
      const next = human(-6);
      kit.advance(1);
      torso(next).setFrozen(true);
      s.setTeam('red');
      first.setTeam('blue');
      next.setTeam('blue');
      kit.advance(1);
      if (foeOf(s) !== first) return `the soldier went for ${foeOf(s) === next ? 'the further enemy' : 'nobody'} first`;
      first.consciousness = 0;
      let t = 0;
      for (; t < 2 && foeOf(s) !== next; t += 0.1) kit.advance(0.1);
      if (foeOf(s) !== next) return `2 s after their enemy was out, the soldier is going for ${foeOf(s) ? 'someone else' : 'nobody'}`;
      return true;
    }],
    ['extra: armies: a soldier knocked over holding a bat is up again about as fast as one empty-handed', () => {
      /** Seconds from going over to standing again (Infinity: never; NaN: never went over). */
      const upAgain = (bat: boolean): number | string => {
        kit.reset();
        const h = human(0);
        kit.advance(0.5);
        h.setTeam('red');
        if (bat && give(h, 'bat')?.def.id !== 'bat') return 'could not hand them a bat';
        kit.advance(1.5);
        if (h.state !== 'stand') return `${bat ? 'with a bat' : 'empty-handed'}, not standing before the shove (${h.status()})`;
        for (const p of [torso(h), head(h)]) p.body.setLinvel({ x: 3.5, y: 0 }, true);
        let over = -1;
        for (let t = 0; t < 8; t += 0.05) {
          kit.advance(0.05);
          if (over < 0 && h.state !== 'stand') over = t;
          if (over >= 0 && h.state === 'stand') return t - over;
        }
        return over < 0 ? NaN : Infinity;
      };
      const empty = upAgain(false);
      const bat = upAgain(true);
      if (typeof empty === 'string') return empty;
      if (typeof bat === 'string') return bat;
      if (Number.isNaN(bat)) return true;
      if (!Number.isFinite(bat)) return `holding a bat, still down 8 s after the shove (empty-handed: up in ${empty.toFixed(2)} s)`;
      if (bat > 3) return `holding a bat, up again only after ${bat.toFixed(2)} s (empty-handed: ${Number.isFinite(empty) ? empty.toFixed(2) + ' s' : 'never'})`;
      if (Number.isFinite(empty) && bat > empty + 1) return `holding a bat, up in ${bat.toFixed(2)} s; empty-handed, ${empty.toFixed(2)} s`;
      return true;
    }],
    ['extra: armies: a side (and its colours) is kept by save and load, and by copy and paste', () => {
      kit.reset();
      const a = human(-2);
      const plain = human(4);
      const dog = kit.spawn('dog', 1.5, 0.6, { flip: true }) as Creature;
      kit.advance(0.5);
      a.setTeam('green');
      dog.setTeam('yellow');
      const shirt = torso(a).art;
      if (shirt === torso(plain).art) return 'on a team, they still wear their own shirt';
      const coat = dog.limbs.get('chest')!.part.art;
      loadFromString(game, saveToString(game));
      const a2 = game.entities.find((e) => e.def.id === 'human' && teamOf(e) === 'green') as Human | undefined;
      const dog2 = game.entities.find((e) => e.def.id === 'dog') as Creature | undefined;
      if (!a2) return `loaded, nobody is on green (sides: ${game.entities.map((e) => teamOf(e)).join(', ')})`;
      if (torso(a2).art !== shirt) return 'loaded, the soldier lost their side’s shirt';
      if (!dog2 || teamOf(dog2) !== 'yellow') return `loaded, the dog is on ${dog2 ? teamOf(dog2) : 'nothing (gone)'}`;
      if (dog2.limbs.get('chest')!.part.art !== coat) return 'loaded, the dog lost its side’s coat';
      kit.advance(0.5);
      controls.copy([a2]);
      kit.move(8, 1.5);
      kit.advance(0.02);
      controls.paste();
      const copy = game.entities.find((e) => e.def.id === 'human' && e !== a2 && teamOf(e) === 'green') as Human | undefined;
      if (!copy) return 'pasted, the copy is on no side';
      if (torso(copy).art !== shirt) return 'pasted, the copy wears the wrong shirt';
      kit.advance(1);
      if (copy.foe === a2 || a2.foe === copy) return 'the copy and the one copied went for each other';
      return true;
    }],
    ['extra: armies: the Battle panel lines up each side, as many as asked, on its side, armed as asked', () => {
      kit.reset();
      const btn = document.querySelector<HTMLButtonElement>('.toolbar .tb-btn[title^="Battle"]');
      if (!btn) return 'no Battle button on the toolbar';
      try {
        btn.click();
        const panel = document.querySelector<HTMLElement>('.army-panel');
        if (!panel || panel.closest('.overlay')?.classList.contains('hidden')) return 'the Battle button did not open the panel';
        const set = (row: Element, i: number, value: string) => {
          const inputs = row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input[type=number]');
          inputs[i].value = value;
          inputs[i].dispatchEvent(new Event('change'));
        };
        const rows = () => [...panel.querySelectorAll('.army-side')];
        // (a third side: added, then the panel drawn afresh)
        while (rows().length > 2) panel.querySelector<HTMLButtonElement>('.army-side .panel-btn')!.click();
        [...panel.querySelectorAll<HTMLButtonElement>('.army-btns .panel-btn')].find((b) => b.textContent === 'Add side')!.click();
        const want = [['red', '4', 'melee'], ['blue', '3', 'pistols'], ['green', '2', 'dogs']];
        if (rows().length !== 3) return `Add side left ${rows().length} sides`;
        rows().forEach((r, i) => want[i].forEach((v, k) => set(r, k, v)));
        panel.querySelector<HTMLButtonElement>('.army-start')!.click();
      } finally {
        controls.ui.closeOverlays();
      }
      const cx = game.renderer.camX;
      const on = (t: string) => game.entities.filter((e) => teamOf(e) === t) as TeamMember[];
      const [red, blue, green] = [on('red'), on('blue'), on('green')];
      if (red.length !== 4 || blue.length !== 3 || green.length !== 2) return `lined up ${red.length} red, ${blue.length} blue, ${green.length} green (wanted 4, 3, 2)`;
      if (green.some((e) => e.def.id !== 'dog')) return 'the side of dogs is not dogs';
      const kit1 = ['bat', 'sword', 'axe', 'crowbar', 'hammer'];
      const held = (e: Entity) => (e as Human).heldItems()[0]?.def.id ?? 'nothing';
      if (red.some((e) => !kit1.includes(held(e)))) return `red, armed with melee weapons, hold: ${red.map(held).join(', ')}`;
      if (blue.some((e) => !['pistol', 'revolver'].includes(held(e)))) return `blue, armed with pistols, hold: ${blue.map(held).join(', ')}`;
      const x = (e: Entity) => e.center().x;
      if (red.some((e) => x(e) > cx || e.flipped)) return 'red (the first side) is not on the left, facing right';
      if (blue.some((e) => x(e) < cx || !e.flipped)) return 'blue (the second side) is not on the right, facing left';
      if (green.some((e) => x(e) > Math.min(...red.map(x)))) return 'green (the third side) is not lined up beyond red';
      kit.advance(2);
      if (![...red, ...blue].some((e) => e.foe)) return 'lined up, nobody went for anyone';
      return true;
    }],
    ['extra: armies: a battle of three against three ends with one side beaten', () => {
      kit.reset();
      const [red, blue] = spawnBattle(game, [{ team: 'red', count: 3, loadout: 'melee' }, { team: 'blue', count: 3, loadout: 'melee' }], { x: 0, y: 0 });
      if (red.length !== 3 || blue.length !== 3) return `lined up ${red.length} against ${blue.length}`;
      const downT = new Map<Entity, number>();
      const out = (e: TeamMember) => e.destroyed || !stillUp(e) || (downT.get(e) ?? 0) > 4;
      const beaten = (side: TeamMember[]) => side.every(out);
      let t = 0;
      for (; t < 60 && !beaten(red) && !beaten(blue); t += 0.5) {
        kit.advance(0.5);
        for (const e of [...red, ...blue]) downT.set(e, !e.destroyed && onFeet(e) ? 0 : (downT.get(e) ?? 0) + 0.5);
      }
      const left = (side: TeamMember[]) => side.filter((e) => !out(e)).length;
      if (!beaten(red) && !beaten(blue)) return `after 60 s, ${left(red)} red and ${left(blue)} blue still in it`;
      return true;
    }],
    ['extra: armies: fighters on two roofs never fall off: a narrow gap they leap, a wide one they wait at (and a gunman shoots across)', () => {
      // a gap of 1.2 m: leapt
      kit.reset();
      game.setMap(roofs(1.2, 4));
      const a = standing(-3, 4);
      const b = standing(3, 4, { flip: true });
      kit.advance(1);
      a.fight(b, false);
      let low = Infinity;
      let leapt = false;
      let across = false;
      for (let t = 0; t < 8 && !across; t += 0.05) {
        kit.advance(0.05);
        low = Math.min(low, torso(a).y, torso(b).y);
        leapt ||= jumping(a);
        across = torso(a).x > 1 && torso(a).y > 4.5 && a.state === 'stand';
      }
      if (low < 3.6) return `a 1.2 m gap: someone fell off the roof (a torso got down to ${low.toFixed(2)} m; the roofs are 4 m up)`;
      if (!across) return `a 1.2 m gap: in 8 s they never got across (${leapt ? 'leapt' : 'never leapt'}; at x ${torso(a).x.toFixed(2)}, ${a.status()})`;
      if (!leapt) return 'a 1.2 m gap: got across without a leap';
      // a gap of 3 m: no leap, and nobody off the edge
      kit.reset();
      game.setMap(roofs(3, 4));
      const c = standing(-4, 4);
      const d = standing(4, 4, { flip: true });
      kit.advance(1);
      c.fight(d, false);
      low = Infinity;
      leapt = false;
      for (let t = 0; t < 6; t += 0.05) {
        kit.advance(0.05);
        low = Math.min(low, torso(c).y);
        leapt ||= jumping(c);
      }
      if (leapt) return 'a 3 m gap: they tried to leap it';
      if (low < 3.6) return `a 3 m gap: they went off the roof (torso down to ${low.toFixed(2)} m)`;
      if (torso(c).x > -1.4) return `a 3 m gap: they ended up at x ${torso(c).x.toFixed(2)} (the edge is at -1.5)`;
      // with a pistol, from the edge they shoot
      kit.reset();
      game.setMap(roofs(3, 4));
      const g = standing(-6, 4);
      const e = standing(6.5, 4, { flip: true });
      kit.advance(0.5);
      const gun = give(g, 'pistol') as Firearm | undefined;
      if (gun?.def.id !== 'pistol') return 'could not hand them a pistol';
      torso(e).setFrozen(true);
      kit.advance(0.5);
      g.fight(e, false);
      low = Infinity;
      for (let t = 0; t < 8; t += 0.1) {
        kit.advance(0.1);
        low = Math.min(low, torso(g).y);
      }
      if (low < 3.6) return `a gunman went off the roof (torso down to ${low.toFixed(2)} m)`;
      if (!gun.shots) return `the gunman, stopped at the edge ${(torso(e).x - torso(g).x).toFixed(1)} m from the foe, never fired`;
      return true;
    }],
    ['extra: armies: a fighter climbs a waist-high step to the foe on it, and jumps down a ledge too high to climb down to one below', () => {
      kit.reset();
      game.setMap(custom([box(1, 0, 9, 1)]));
      const a = human(-2);
      const b = standing(3, 1, { flip: true });
      kit.advance(1);
      a.fight(b, false);
      let up = false;
      for (let t = 0; t < 10 && !up; t += 0.1) {
        kit.advance(0.1);
        up = lowest(a) > 0.85 && torso(a).x > 1;
      }
      if (!up) return `in 10 s they never got up the 1 m step to the foe (at x ${torso(a).x.toFixed(2)}, feet ${lowest(a).toFixed(2)} m up, ${a.status()})`;
      // a ledge 1.8 m up: jumped down (not climbed: too high), and landed none the worse
      kit.reset();
      game.setMap(custom([box(-14, 0, 0, 1.8)]));
      const c = standing(-3, 1.8);
      const d = human(3, { flip: true });
      kit.advance(1);
      c.fight(d, false);
      let leapt = false;
      let down = false;
      for (let t = 0; t < 8 && !down; t += 0.05) {
        kit.advance(0.05);
        leapt ||= jumping(c);
        down = torso(c).x > 0.3 && lowest(c) < 0.3 && c.state === 'stand';
      }
      if (!down) return `in 8 s they never got down off the 1.8 m ledge (${leapt ? 'jumped' : 'never jumped'}; at x ${torso(c).x.toFixed(2)}, ${c.status()})`;
      if (!leapt) return 'got down the 1.8 m ledge without a jump';
      const broke = [...c.limbs.values()].filter((l) => l.broken).map((l) => l.spec.key);
      if (broke.length) return `jumping down 1.8 m broke: ${broke.join(', ')}`;
      return true;
    }],
  ];
}

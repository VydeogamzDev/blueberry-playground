import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { LimbKey } from '../../art/human';
import type { Blade } from '../../entities/Melee';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import { saveToString, loadFromString } from '../../world/SaveLoad';

export default function tests({ game, kit, human }: TestCtx): Test[] {
  const pieces = () => game.entities.filter((e) => e.def.id === 'gore' && !e.destroyed).length;
  const holes = (e: Entity) => e.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.holeCount), 0);
  const solid = (p: Part) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) n++;
    return n;
  };
  /** A blade's cut across a limb from its front (`side` -1) or back, `down` m below its middle, `px` deep. */
  const cut = (h: Human, key: LimbKey, down: number, px: number, side = -1) => {
    const p = h.limbs.get(key)!.part;
    const at = p.localToWorld(0, -down);
    const edge = p.localToWorld(side * 0.07, -down);
    h.slice(p, px * 12, edge, { x: (at.x - edge.x) / 0.07, y: (at.y - edge.y) / 0.07 }, px);
  };
  /** What a blade is stuck in: whose (by `names`) and which limb, and whether its point came out of the far side. */
  const stuck = (s: Blade, names: Map<Entity, string>) =>
    s.lodges.map((l) => `${names.get(l.target.entity) ?? l.target.entity.def.id}/${(l.target.entity as Human).limbOf?.(l.target)?.spec.key}${l.out ? ' (through)' : ''}`);

  return [
    ['extra: blades: a limb cut through comes apart where it was cut, not at its joint; the trunk only takes a gash', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const arm = h.limbs.get('upperArmF')!;
      const n0 = solid(arm.part);
      const g0 = pieces();
      // across the upper arm, near the elbow
      cut(h, 'upperArmF', 0.05, 6);
      if (!arm.attached || arm.severed) return 'the upper arm came off at the shoulder: it should have stayed on, cut below';
      if (h.limbs.get('lowerArmF')!.attached || h.limbs.get('handF')!.attached) return 'cut through above the elbow, the forearm and hand are still on';
      if (pieces() <= g0) return 'no piece of the upper arm came off with the forearm';
      if (solid(arm.part) > n0 - 3) return `the upper arm lost only ${n0 - solid(arm.part)} px`;
      // a sword's worth into the chest: a gash, nothing comes off
      const chest = h.limbs.get('upperTorso')!;
      const c0 = holes(h);
      cut(h, 'upperTorso', 0, 20);
      if (holes(h) <= c0) return 'the cut into the chest left no gash';
      if ([...h.limbs.values()].some((l) => l !== chest && l.spec.key !== 'lowerArmF' && l.spec.key !== 'handF' && !l.attached)) return 'cutting the chest took something off';
      return true;
    }],
    ['extra: blades: two slashes at the same spot hack through a shin that one only gashes', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const foot = h.limbs.get('footF')!;
      cut(h, 'lowerLegF', -0.05, 2);
      kit.advance(0.1);
      if (!h.limbs.get('lowerLegF')!.part.holeCount) return 'the first slash left no gash';
      if (!foot.attached) return 'one shallow slash (2 px into a 3.5 px shin) took the foot off';
      cut(h, 'lowerLegF', -0.05, 3);
      kit.advance(0.1);
      if (foot.attached) return 'a second slash into the gash did not take the leg off below it';
      return true;
    }],
    ['extra: blades: a sword swept into someone cuts into them, and through a limb', () => {
      kit.reset();
      const h = human(0.3);
      kit.advance(1);
      const g0 = pieces();
      const s = kit.spawn('sword', -0.3, 0.68, { angle: -Math.PI / 2 }) as Blade;
      kit.advance(0.01);
      s.setVelocity(11, 0, 0);
      kit.advance(0.4);
      if (!holes(h)) return 'the sword cut nothing';
      const off = [...h.limbs.values()].filter((l) => !l.attached).map((l) => l.spec.key);
      if (!off.length || pieces() <= g0) return `nothing cut through (cuts in ${[...h.limbs.values()].filter((l) => l.part.holeCount).map((l) => l.spec.key).join(', ')})`;
      return true;
    }],
    ['extra: blades: a hard thrust runs a sword through someone, out of their back and on into someone behind; Pull out frees both', () => {
      kit.reset();
      const a = human(0.2);
      const b = human(0.55);
      kit.advance(1);
      const names = new Map<Entity, string>([[a, 'front'], [b, 'behind']]);
      const t = a.limbs.get('midTorso')!.part;
      const s = kit.spawn('sword', t.x - 1, t.y, { angle: 0 }) as Blade;
      kit.advance(0.01);
      s.setVelocity(24, 0, 0);
      kit.advance(0.3);
      const in1 = stuck(s, names);
      if (!s.lodges.some((l) => l.target.entity === a && l.out)) return `not through the one in front: ${in1.join(', ') || 'stuck in nothing'}`;
      if (!s.lodges.some((l) => l.target.entity === b)) return `not into the one behind: ${in1.join(', ')}`;
      // save and load: still through both
      const n = s.lodges.length;
      loadFromString(game, saveToString(game));
      kit.advance(0.1);
      const s2 = game.entities.find((e) => e.def.id === 'sword') as Blade | undefined;
      if (!s2 || s2.lodges.length !== n) return `after a load it's in ${s2?.lodges.length ?? 0} things, not ${n}`;
      // (dragged by the hilt, it drags them along, skewered: its menu pulls it out of everything)
      s2.contextActions().find((c) => c.label === 'Pull out')?.action();
      if (s2.lodges.length) return `Pull out left it in ${s2.lodges.length} things`;
      return true;
    }],
    ['extra: blades: a thrown knife goes through an arm, not through a chest', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const t = h.limbs.get('upperTorso')!.part;
      const k = kit.spawn('knife', t.x - 1, t.y, { angle: 0 }) as Blade;
      kit.advance(0.01);
      k.setVelocity(14, 0, 0);
      kit.advance(0.4);
      const names = new Map<Entity, string>([[h, 'them']]);
      const chest = k.lodges.find((l) => l.target === t);
      if (!k.lodges.length) return 'it did not stick in';
      if (chest?.out) return `a knife came out of the back of a chest: ${stuck(k, names).join(', ')}`;
      return true;
    }],
  ];
}

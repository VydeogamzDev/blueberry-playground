import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import type { Firearm, GunSpec } from '../../entities/Firearm';
import type { Gore } from '../../entities/Gore';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { washBlood } from '../../entities/Medical';
import { fromBase64 } from '../../engine/base64';

export default function tests({ game, kit, human }: TestCtx): Test[] {
  /** What a gun fires (from one spawned out of the way a moment). */
  const specs = new Map<string, GunSpec>();
  const specOf = (id: string): GunSpec => {
    let s = specs.get(id);
    if (!s) {
      const g = kit.spawn(id, 40, 5) as Firearm;
      s = { ...(g as unknown as { gun: GunSpec }).gun };
      game.remove(g);
      specs.set(id, s);
    }
    return s;
  };
  /** A gun's round (its energy and damage), fired level from (x, y), going `dx` (1: right, -1: left). */
  const round = (id: string, x: number, y: number, dx = 1) => {
    const g = specOf(id);
    game.projectiles.fire(x, y, dx, 0, g.speed, { energy: g.energy, damage: g.damage, push: g.push ?? 0.004 });
  };
  /** Pixels shot out of someone, all their parts together. */
  const holes = (e: Entity) => e.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.holeCount), 0);
  /** The pixels of a part that are carved away. */
  const carved = (p: Part): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.art.filled(x, y) && !p.solidAt(x, y)) out.push([x, y]);
    return out;
  };
  /** A real gun, frozen, its muzzle `gap` m to one side of (x, y) and pointing at it. */
  const gunAt = (id: string, x: number, y: number, gap: number): Firearm => {
    const g = kit.spawn(id, x - gap, y) as Firearm;
    g.setFrozen(true);
    const spec = (g as unknown as { gun: { muzzle: [number, number] } }).gun;
    const m = g.main.pixelToWorld(spec.muzzle[0], spec.muzzle[1]);
    g.translate(x - gap - m.x, y - m.y);
    return g;
  };
  const off = (h: Human | Creature) => [...h.limbs.values()].filter((l) => l.severed || l.gone).map((l) => l.spec.key + (l.gone ? ' (gone)' : ''));
  /** The pieces torn off bodies lying about. */
  const pieces = () => game.entities.filter((e): e is Gore => e.def.id === 'gore' && !e.destroyed);
  const solid = (p: Part) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.solidAt(x, y)) n++;
    return n;
  };
  /** How far a part is from the nearest piece lying about (m). */
  const nearestPiece = (p: Part) => Math.min(Infinity, ...pieces().map((g) => Math.hypot(g.main.x - p.x, g.main.y - p.y)));

  return [
    ['extra: chunks: a rifle round takes a chunk out of someone where it comes out, and a nick where it went in; a pistol only wounds', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const chest = h.limbs.get('upperTorso')!.part;
      round('pistol', -2, chest.y);
      kit.advance(0.2);
      round('pistol', -2, chest.y);
      kit.advance(0.2);
      if (holes(h)) return `a pistol took ${holes(h)} pixels out of them`;
      kit.reset();
      const k = human(0);
      kit.advance(1);
      const torso = k.limbs.get('upperTorso')!.part;
      round('rifle', -2, torso.y);
      kit.advance(0.1);
      const gone = carved(torso);
      if (gone.length < 4) return `a rifle round through the chest took ${gone.length} pixels out`;
      // out of the outline (a bite out of the side, not a hole in the middle), on both sides
      const edge = gone.filter(([x, y]) => torso.art.isRim(x, y));
      if (!edge.length) return 'the chunk is not out of the outline';
      const xs = edge.map(([x]) => x);
      if (Math.max(...xs) - Math.min(...xs) < torso.w / 2) return `the chunk is on one side only (x ${Math.min(...xs)}..${Math.max(...xs)} of ${torso.w}): no nick where it went in`;
      // the torn edge shows raw flesh
      const d = fromBase64(torso.paintData() ?? '');
      let raw = 0;
      for (let j = 0; j + 7 <= d.length; j += 7) if (((d[j + 3] << 16) | (d[j + 4] << 8) | d[j + 5]) === 0x9c1a1a || ((d[j + 3] << 16) | (d[j + 4] << 8) | d[j + 5]) === 0x6e0c0c) raw++;
      if (!raw) return 'no raw flesh round the chunk';
      return true;
    }],
    ['extra: chunks: a shotgun tears a chunk out at point blank (its pellets together), and only peppers someone across the room', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const belly = h.limbs.get('midTorso')!.part;
      gunAt('shotgun', belly.x, belly.y, 1).fire();
      kit.advance(0.3);
      const near = holes(h);
      if (near < 3) return `at a metre a shotgun took ${near} pixels out`;
      kit.reset();
      const k = human(0);
      kit.advance(1);
      const b = k.limbs.get('midTorso')!.part;
      gunAt('shotgun', b.x, b.y, 10).fire();
      kit.advance(0.4);
      if (holes(k) > 2) return `from 10 m a shotgun still took ${holes(k)} pixels out (${near} at a metre)`;
      return true;
    }],
    ['extra: chunks: a sniper round through a shin takes the leg off below the knee, bone showing; rounds into one spot of a thigh: a battle rifle\'s take it off in a few, two of a rifle\'s only bite at it, a minigun\'s only wound', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const shin = h.limbs.get('lowerLegF')!;
      round('sniper', -2, shin.part.y);
      kit.advance(0.2);
      const lost = off(h);
      if (!lost.some((k) => /^(lowerLeg|foot)/.test(k))) return `a sniper round through the shin: ${lost.length ? `off ${lost}` : 'nothing came off'} (${shin.part.holeCount} pixels out)`;
      // bone where the bone runs, in the torn edge of one of the shins
      const bone = (['lowerLegF', 'lowerLegB'] as const).some((key) => {
        const p = h.limbs.get(key)!.part;
        const d = p.destroyed ? null : p.paintData();
        if (!d) return false;
        const b = fromBase64(d);
        for (let j = 0; j + 7 <= b.length; j += 7) if (((b[j + 3] << 16) | (b[j + 4] << 8) | b[j + 5]) === 0xe6dcc8) return true;
        return false;
      });
      if (!bone) return 'no bone in the shin\'s torn edge';
      // rounds into one spot of a thigh (the thighs side by side, they go into one or the
      // other): how many it takes to take one off (up to `max`), and the pixels they took
      const stream = (id: string, max: number): [number, number] => {
        kit.reset();
        const k = human(0);
        kit.advance(1);
        const thighOff = () => off(k).some((key) => /^(upperLeg|lowerLeg)/.test(key));
        let n = 0;
        for (; n < max && !thighOff(); n++) {
          const t = k.limbs.get('upperLegF')!.part;
          round(id, t.x - 1.5, t.y);
          kit.advance(1 / 15);
        }
        kit.advance(0.2);
        return [thighOff() ? n : Infinity, holes(k)];
      };
      const [battle] = stream('battle-rifle', 4);
      if (battle > 4) return 'four battle rifle rounds into a thigh and it is still on';
      const [rifle, bit] = stream('rifle', 2);
      if (rifle <= 2) return `a thigh came off after ${rifle} rifle rounds`;
      if (bit < 4) return `two rifle rounds into a thigh took ${bit} pixels out`;
      const [, minigun] = stream('minigun', 10);
      if (minigun) return `10 minigun rounds into the thighs took ${minigun} pixels out`;
      return true;
    }],
    ['extra: chunks: a foot shot to pieces goes, and the world goes on (the round passes where it was; its body isn\'t asked about once freed)', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const foot = h.limbs.get('footF')!.part;
      const y = foot.y;
      const gone = () => (['footF', 'footB'] as const).filter((k) => h.limbs.get(k)!.gone);
      for (let i = 0; i < 8 && !gone().length; i++) {
        round('sniper', -2, y);
        kit.advance(0.05);
      }
      kit.advance(0.1);
      if (!gone().length) return `eight sniper rounds through the feet left them on (${off(h)}; ${foot.destroyed ? 'gone' : foot.holeCount + ' pixels out'})`;
      // (the world still works: things made, stepped, shot)
      const c = kit.spawn('crate', 1, 1);
      round('rifle', -2, 0.3);
      kit.advance(0.5);
      if (c.destroyed || !(c.parts[0].y < 1)) return 'after the foot went, the world stopped';
      return true;
    }],
    ['extra: chunks: what is shot away stays gone: saved and loaded, healed, washed, never painted over; a leg shot off keeps its shorter collider', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const torso = h.limbs.get('upperTorso')!.part;
      round('rifle', -2, torso.y);
      const shin = h.limbs.get('lowerLegF')!.part;
      round('sniper', -2, shin.y);
      kit.advance(0.3);
      const n = torso.holeCount;
      const pix = carved(torso);
      if (!n) return 'no chunk to keep';
      const shinBox = () => {
        const he = h.limbs.get('lowerLegF')!.part.colliders[0].halfExtents();
        return he ? `${he.x.toFixed(3)},${he.y.toFixed(3)}` : '?';
      };
      const box0 = shinBox();
      // painting, healing, washing and a bandage don't put it back
      if (torso.paintPixel(pix[0][0], pix[0][1], 0xffffff)) return 'painted a pixel that was shot away';
      h.inject('healing', 1);
      kit.advance(0.5);
      washBlood(torso, 1);
      if (torso.holeCount !== n || carved(torso).length !== n) return `healed and washed: ${carved(torso).length} pixels out (were ${n})`;
      // saved and loaded: the same pixels out, the same collider
      const saved = saveToString(game);
      kit.reset();
      loadFromString(game, saved);
      const k = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      if (!k) return 'nobody loaded';
      const t = k.limbs.get('upperTorso')!.part;
      const back = carved(t);
      if (back.length !== n || back.some(([x, y], i) => x !== pix[i][0] || y !== pix[i][1])) return `loaded: ${back.length} pixels out of the chest (were ${n})`;
      const he = k.limbs.get('lowerLegF')!.part.colliders[0].halfExtents();
      const box1 = he ? `${he.x.toFixed(3)},${he.y.toFixed(3)}` : '?';
      if (box1 !== box0) return `loaded, the shin's collider is ${box1} (was ${box0})`;
      return true;
    }],
    ['extra: chunks: a shin shot through breaks there, not at a joint: below the middle the foot falls hanging from what came off; above it the stump stays on the knee', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      // (the shins side by side: the round goes into one or the other)
      const shins = (['lowerLegF', 'lowerLegB'] as const).map((key) => h.limbs.get(key)!);
      const n0 = solid(shins[0].part);
      round('battle-rifle', -2, shins[0].part.y - 2 / 32);
      kit.advance(0.05);
      const shin = shins.find((l) => l.part.holeCount);
      if (!shin) return 'shot low, neither shin was hit';
      const foot = h.limbs.get(shin.spec.key === 'lowerLegF' ? 'footF' : 'footB')!;
      if (shin.severed || shin.gone) return `shot low, the shin came off (${off(h)})`;
      if (!foot.severed) return `shot low through the shin, the foot is still on it (${shin.part.holeCount} pixels out)`;
      if (!pieces().length) return 'shot low, nothing came off the shin as a piece';
      kit.advance(1);
      const d = nearestPiece(foot.part);
      if (!(d < 0.15)) return `a second on, the foot is ${d.toFixed(2)} m from the piece it came off with`;
      // what's left of the shin stays the shin, on the knee: shorter
      if (solid(shin.part) > 0.85 * n0) return `the shin still has ${solid(shin.part)} of its ${n0} pixels`;
      kit.reset();
      const k = human(0);
      kit.advance(1);
      round('battle-rifle', -2, k.limbs.get('lowerLegF')!.part.y + 1 / 32);
      kit.advance(0.05);
      const s2 = (['lowerLegF', 'lowerLegB'] as const).map((key) => k.limbs.get(key)!).find((l) => l.part.holeCount);
      if (!s2) return 'shot high, neither shin was hit';
      const F = s2.spec.key === 'lowerLegF';
      const thigh = k.limbs.get(F ? 'upperLegF' : 'upperLegB')!;
      if (!s2.severed) return `shot high, the shin is still on (${s2.part.holeCount} pixels out)`;
      if (k.limbs.get(F ? 'footF' : 'footB')!.severed) return 'shot high through the shin, the foot came off it';
      kit.advance(1);
      const knee = thigh.part.localToWorld(s2.a1.x, s2.a1.y);
      const stump = Math.min(Infinity, ...pieces().map((g) => Math.hypot(g.main.x - knee.x, g.main.y - knee.y)));
      if (!(stump < 0.12)) return `a second on, the nearest piece is ${stump.toFixed(2)} m from the knee (no stump on it)`;
      return true;
    }],
    ['extra: chunks: blown apart, a limb breaks up into pieces of it that stay about (what hung from it hanging on), not into nothing; a blast only bites a hand', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const arm = h.limbs.get('upperArmF')!;
      const n = solid(arm.part);
      h.gib(arm, { x: 1, y: 0 });
      kit.advance(0.02);
      const made = pieces();
      if (made.length < 2) return `an upper arm blown apart came to ${made.length} pieces`;
      const m = made.reduce((s, g) => s + solid(g.main), 0);
      if (m < n * 0.75) return `its pieces have ${m} of its ${n} pixels`;
      kit.advance(0.6);
      const fore = h.limbs.get('lowerArmF')!;
      if (fore.gone || !fore.severed) return `the forearm is ${fore.gone ? 'gone' : 'still on'}`;
      const d = nearestPiece(fore.part);
      if (!(d < 0.4)) return `the forearm is ${d.toFixed(2)} m from the nearest piece (it doesn't hang from one)`;
      // a hand caught by a blast two and a half times its hit points: a bite, not the hand
      kit.reset();
      const k = human(0);
      kit.advance(1);
      const hand = k.limbs.get('handF')!;
      k.damage(hand.part, 2.5 * hand.spec.hp, 'explosion', { x: hand.part.x - 0.05, y: hand.part.y }, { x: 1, y: 0 });
      kit.advance(0.1);
      if (hand.gone || hand.part.destroyed) return 'a blast at 2.5 times its hit points blew the hand away';
      if (!hand.part.holeCount || hand.part.lost() > 0.5) return `the blast took ${(hand.part.lost() * 100).toFixed(0)}% of the hand`;
      return true;
    }],
    ['extra: chunks: pieces keep: saved and loaded, as they were and with the foot still hanging from one; shot, a piece goes to bits', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      round('battle-rifle', -2, h.limbs.get('lowerLegF')!.part.y - 2 / 32);
      kit.advance(0.5);
      const which = h.limbs.get('lowerLegF')!.part.holeCount ? 'footF' : 'footB';
      const g = pieces();
      if (!g.length) return 'nothing came off the shin';
      const was = g.map((x) => solid(x.main)).sort((a, b) => a - b).join(',');
      const saved = saveToString(game);
      kit.reset();
      loadFromString(game, saved);
      const back = pieces();
      const now = back.map((x) => solid(x.main)).sort((a, b) => a - b).join(',');
      if (now !== was) return `loaded, the pieces have ${now} pixels (were ${was})`;
      const k = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      if (!k) return 'nobody loaded';
      kit.advance(1);
      const d = nearestPiece(k.limbs.get(which)!.part);
      if (!(d < 0.15)) return `loaded, the foot is ${d.toFixed(2)} m from the piece it hung from`;
      // shot, it goes to bits
      const p = back[0];
      for (let i = 0; i < 6 && !p.destroyed; i++) {
        // (from above: what's beside it, the leg it came off, is out of the way)
        game.projectiles.fire(p.main.x, p.main.y + 1, 0, -1, 800, { energy: 1400, damage: 34, push: 0.004 });
        kit.advance(0.05);
      }
      kit.advance(0.1);
      if (!p.destroyed) return 'six rifle rounds into a piece and it is still whole';
      return true;
    }],
    ['extra: chunks: blood out of an exit wound splatters a wall behind, more the harder the round', () => {
      const splat = (id: string) => {
        kit.reset();
        const wall = kit.spawn('plank', 1, 1.2, { angle: Math.PI / 2 });
        wall.setFrozen(true);
        const h = human(0);
        kit.advance(1);
        round(id, -2, h.limbs.get('upperTorso')!.part.y);
        kit.advance(1.5);
        const d = wall.parts[0].paintData();
        if (!d) return 0;
        const b = fromBase64(d);
        let n = 0;
        for (let j = 0; j + 7 <= b.length; j += 7) if (b[j + 3] > b[j + 4] * 2) n++;
        return n;
      };
      const pistol = splat('pistol');
      const rifle = splat('rifle');
      const sniper = splat('sniper');
      if (rifle < 40) return `a rifle round left ${rifle} pixels of blood on the wall behind (a pistol's ${pistol})`;
      if (!(sniper > rifle && rifle > pistol)) return `blood on the wall: pistol ${pistol}, rifle ${rifle}, sniper ${sniper} pixels`;
      return true;
    }],
    ['extra: chunks: animals lose chunks too; an android\'s plating is shot away in sparks, and it does not bleed', () => {
      kit.reset();
      const dog = kit.spawn('dog', 0, 0.6) as Creature;
      kit.advance(1.2);
      const chest = dog.limbs.get('chest')!.part;
      round('rifle', -2, chest.y);
      kit.advance(0.2);
      if (holes(dog) < 3) return `a rifle round through a dog took ${holes(dog)} pixels out`;
      kit.reset();
      const a = kit.spawn('android', 0, 0.9) as Human;
      kit.advance(1);
      const torso = a.limbs.get('upperTorso')!.part;
      round('rifle', -2, torso.y);
      kit.advance(0.2);
      if (holes(a) < 3) return `a rifle round through an android took ${holes(a)} pixels out`;
      const wounds = [...a.limbs.values()].reduce((s, l) => s + l.wounds.length, 0);
      if (wounds) return `the android bleeds from ${wounds} wounds`;
      return true;
    }],
  ];
}

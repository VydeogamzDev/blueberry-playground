import type { Test, TestCtx } from './types';
import type { Creature } from '../../entities/Creature';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import { saveToString, loadFromString } from '../../world/SaveLoad';

export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  void controls, arm;
  const chest = (a: Creature) => a.limbs.get('chest')!.part;
  const count = (id: string) => game.entities.filter((e) => e.def.id === id && !e.destroyed).length;
  /**
   * Sends someone (or an animal) walking to x and times it: the seconds it took
   * to get within 0.4 m, or what went wrong.
   */
  const walkTime = (e: Human | Creature, at: () => number, x: number): number | string => {
    e.goTo(x);
    let t = 0;
    while (t < 14 && Math.abs(at() - x) > 0.4) {
      kit.advance(0.1);
      t += 0.1;
      if (e.state !== 'stand') return `fell over walking to ${x} (${e.status()})`;
    }
    return Math.abs(at() - x) > 0.4 ? `only got to ${at().toFixed(2)} of ${x} in 14 s` : t;
  };
  return [
    ['extra: creatures: a cow stands still, walks where it is sent, gets back up and dies from a headshot', () => {
      kit.reset();
      const cow = kit.spawn('cow', 0, 0.55) as Creature;
      const pig = kit.spawn('pig', 4, 0.5) as Creature;
      // clearly the bigger, heavier animal
      if (cow.totalMass() < pig.totalMass() * 2.5) return `cow ${cow.totalMass().toFixed(0)} kg, pig ${pig.totalMass().toFixed(0)} kg`;
      game.remove(pig);
      cow.stay(60);
      kit.advance(2);
      let still = 0;
      for (let t = 0; t < 6 && still < 6; t += 0.1) {
        kit.advance(0.1);
        still = kit.maxSpeed() < 0.05 ? still + 1 : 0;
      }
      if (cow.state !== 'stand') return `cow did not stand (${cow.status()})`;
      if (Math.abs(cow.parts[0].a) > 0.1) return `cow leans ${cow.parts[0].a.toFixed(2)} rad`;
      if (still < 6) return `cow still moving ${kit.maxSpeed().toFixed(3)} m/s after 8 s`;
      // walks to a point and back the other way (turning round)
      for (const dx of [4, -4]) {
        kit.reset();
        const a = kit.spawn('cow', 0, 0.55) as Creature;
        kit.advance(1.5);
        const t = walkTime(a, () => chest(a).x, dx);
        if (typeof t === 'string') return `cow: ${t}`;
        if (a.facing !== Math.sign(dx)) return `cow walked to ${dx} facing the other way`;
      }
      // knocked over onto its back, or its side: it gets back up
      for (const [angle, y] of [[Math.PI, 0.6], [Math.PI / 2, 0.85]]) {
        kit.reset();
        const a = kit.spawn('cow', 0, y, { angle }) as Creature;
        a.stay(60);
        let t = 0;
        while (t < 14 && !(a.state === 'stand' && Math.abs(a.parts[0].a) < 0.15 && t > 1)) {
          kit.advance(0.5);
          t += 0.5;
        }
        if (a.state !== 'stand') return `cow lying at ${angle.toFixed(2)} rad did not get up in 14 s (${a.status()})`;
      }
      // a shot through the head kills it, and it drops where it stood
      kit.reset();
      const c3 = kit.spawn('cow', 0, 0.55) as Creature;
      c3.stay(60);
      kit.advance(1.5);
      const head = c3.limbs.get('head')!.part;
      // (from in front of it, whichever way it's facing: from behind, the bullet stops in its rump)
      const front = Math.sign(head.x - chest(c3).x) || 1;
      const g = kit.spawn('pistol', head.x + front * 2.5, head.y - 0.02, { flip: front > 0 }) as Firearm;
      g.setFrozen(true);
      kit.advance(0.05);
      g.fire();
      kit.advance(2.5);
      if (c3.alive) return `headshot cow survived (${c3.status()})`;
      if (chest(c3).y > 0.6) return `dead cow still standing (chest at ${chest(c3).y.toFixed(2)} m)`;
      return true;
    }],
    ['extra: creatures: a pig blown up by C4 or a grenade turns into bacon; a lesser blast only hurts it', () => {
      for (const bomb of ['c4', 'grenade']) {
        kit.reset();
        const pig = kit.spawn('pig', 0, 0.5) as Creature;
        pig.stay(60);
        kit.advance(1.5);
        const c = chest(pig);
        // C4 on the floor at its snout; a grenade held just over its back
        const b = bomb === 'c4' ? kit.spawn('c4', c.x + 0.8, 0.12) : kit.spawn('grenade', c.x, c.y + 0.3);
        if (bomb === 'grenade') b.setFrozen(true);
        kit.advance(0.05);
        b.activate();
        kit.advance(bomb === 'c4' ? 1.5 : 4.5);
        if (count('pig')) return `${bomb} going off against a pig left the pig (${pig.status()})`;
        const strips = game.entities.filter((e) => e.def.id === 'bacon');
        if (strips.length < 4) return `${bomb} blew a pig into ${strips.length} strips of bacon`;
        // they come down round about, rather than vanish into the floor or fly off
        // (C4 right by it can throw a strip a long way: only flung off into the distance counts)
        const lost = strips.filter((s) => s.parts.some((p) => p.destroyed || p.y < -0.05 || Math.abs(p.x - c.x) > 35));
        if (lost.length) return `${lost.length} of ${strips.length} strips of bacon lost (at ${lost[0].parts[0].x.toFixed(1)}, ${lost[0].parts[0].y.toFixed(2)})`;
      }
      // the bacon keeps through a save and load
      const n = count('bacon');
      loadFromString(game, saveToString(game));
      kit.advance(0.2);
      if (count('bacon') !== n) return `${n} strips of bacon, ${count('bacon')} after loading`;
      // a grenade a couple of meters off only wounds a pig
      kit.reset();
      const pig = kit.spawn('pig', 0, 0.5) as Creature;
      pig.stay(60);
      kit.advance(1.5);
      const hp = pig.parts.reduce((s, p) => s + p.hp, 0);
      kit.spawn('grenade', chest(pig).x - 2.2, 0.12).activate();
      kit.advance(4);
      if (count('bacon')) return `a grenade 2.2 m off made ${count('bacon')} strips of bacon`;
      if (pig.destroyed || !count('pig')) return 'a grenade 2.2 m off did away with the pig';
      if (pig.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0) >= hp) return 'a grenade 2.2 m off did not hurt the pig';
      // and so does a bigger animal caught in a big blast: it's only pigs that turn to bacon
      kit.reset();
      const dog = kit.spawn('dog', 0, 0.6) as Creature;
      dog.stay(60);
      kit.advance(1.5);
      kit.spawn('c4', chest(dog).x + 0.6, 0.12).activate();
      kit.advance(1.5);
      if (count('bacon')) return `C4 blew a dog into ${count('bacon')} strips of bacon`;
      return true;
    }],
    ['extra: creatures: adrenaline has people and animals walking faster for a while, then wears off', () => {
      const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
      // a person: 5 m without, then with a dose
      kit.reset();
      let h = human(0);
      kit.advance(1);
      // (far enough that getting going doesn't swamp the difference)
      const plain = walkTime(h, () => torso(h).x, 8);
      if (typeof plain === 'string') return `without adrenaline: ${plain}`;
      kit.reset();
      h = human(0);
      kit.advance(1);
      h.inject('adrenaline', 1);
      if (!(h.rush > 1.5) || !/adrenaline ×1\.\d/.test(h.status())) return `a dose of adrenaline: rush ${h.rush.toFixed(2)} (${h.status()})`;
      const fast = walkTime(h, () => torso(h).x, 8);
      if (typeof fast === 'string') return `on adrenaline: ${fast}`;
      if (fast > plain * 0.8) return `8 m took ${fast.toFixed(1)} s on adrenaline, ${plain.toFixed(1)} s without`;
      // three quarters of a minute later it has worn off: back to walking pace
      h.stay(60);
      kit.advance(45);
      if (h.rush !== 1 || h.status().includes('adrenaline')) return `adrenaline still working after 45 s (rush ${h.rush.toFixed(2)}, ${h.status()})`;
      const x0 = torso(h).x;
      const after = walkTime(h, () => torso(h).x, x0 + 8);
      if (typeof after === 'string') return `after the adrenaline: ${after}`;
      if (after < plain * 0.85) return `8 m took ${after.toFixed(1)} s once the adrenaline wore off, ${plain.toFixed(1)} s before it`;
      // a dog: 6 m without, then with a dose
      const dogTime = (dose: number): number | string => {
        kit.reset();
        const d = kit.spawn('dog', 0, 0.6) as Creature;
        kit.advance(1.5);
        if (dose) d.inject('adrenaline', dose);
        const t = walkTime(d, () => chest(d).x, chest(d).x + 6);
        if (dose && typeof t === 'number' && (!(d.rush > 1.5) || !/adrenaline ×1\.\d/.test(d.status()))) return `a dose of adrenaline: rush ${d.rush.toFixed(2)} (${d.status()})`;
        // and it wears off
        if (dose && typeof t === 'number') {
          d.stay(60);
          kit.advance(45);
          if (d.rush !== 1) return `adrenaline still working in a dog after 45 s (rush ${d.rush.toFixed(2)})`;
        }
        return t;
      };
      const dPlain = dogTime(0);
      if (typeof dPlain === 'string') return `dog without adrenaline: ${dPlain}`;
      const dFast = dogTime(1);
      if (typeof dFast === 'string') return `dog on adrenaline: ${dFast}`;
      if (dFast > dPlain * 0.8) return `6 m took a dog ${dFast.toFixed(1)} s on adrenaline, ${dPlain.toFixed(1)} s without`;
      // a second dose: a little faster still, not absurdly so
      const e = kit.spawn('dog', -3, 0.6) as Creature;
      e.inject('adrenaline', 1);
      e.inject('adrenaline', 1);
      e.inject('adrenaline', 1);
      if (e.rush > 1.85 || e.rush < 1.75) return `three doses of adrenaline: rush ${e.rush.toFixed(2)}`;
      return true;
    }],
  ];
}

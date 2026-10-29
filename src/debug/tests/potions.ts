import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import type { SplashPotion } from '../../entities/SplashPotion';
import type { Syringe } from '../../entities/Syringe';
import type { Entity } from '../../world/Entity';
import type { LimbKey } from '../../art/human';
import { PX } from '../../engine/constants';
import { ITEMS } from '../../catalog/items';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { skeleton } from '../../ui/XRay';

/**
 * The Regen drug (limbs growing back, the body mending) and the splash potions:
 * one for every syringe's drug, thrown to smash and splash everyone round where
 * they break.
 */
export default function tests({ game, kit, human, arm }: TestCtx): Test[] {
  /** Steps the world until `done()`, or for `limit` s: how long it took (Infinity: it never was). */
  const until = (done: () => boolean, limit: number): number => {
    let t = 0;
    while (t < limit) {
      game.step();
      t += game.stepDt;
      if (done()) return t;
    }
    return Infinity;
  };
  /** The limbs someone is missing (blown off or cut off), by key. */
  const missing = (e: Human | Creature): string[] => [...e.limbs.values()].filter((l) => l.gone || !l.attached).map((l) => l.spec.key);
  /** (read through these, a check made earlier in a test doesn't narrow what it can be now) */
  const alive = (e: Human | Creature) => e.alive;
  const state = (e: Human | Creature) => e.state;
  /** Smashes a potion on the floor at x: dropped from 1.6 m, and thrown down hard. */
  const smash = (id: string, x: number): SplashPotion => {
    const p = kit.spawn(id, x, 1.6) as SplashPotion;
    p.setVelocity(0, -8, 2);
    return p;
  };
  const people = () => game.entities.filter((e): e is Human => e.def.id === 'human' && !e.destroyed);

  return [
    ['extra: potions: a person with an arm and a leg blown off, given Regen, grows both back (joined on, drawn, in the x-ray, saved) within 30 s and stands on them', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const s = arm(h, 'syringe-regen') as unknown as Syringe | undefined;
      if (!s) return 'they did not take the Regeneration syringe';
      const keys: LimbKey[] = ['upperArmB', 'lowerArmB', 'handB', 'upperLegF', 'lowerLegF', 'footF'];
      const at = new Map(keys.map((k) => [k, h.parts.indexOf(h.limbs.get(k)!.part)]));
      h.gib(h.limbs.get('upperArmB')!, { x: -1, y: 0.2 });
      kit.advance(0.05);
      h.gib(h.limbs.get('upperLegF')!, { x: 1, y: 0.2 });
      kit.advance(1);
      const lost = missing(h);
      if (lost.length !== 6) return `setup: missing ${lost.join(', ')}`;
      if (!alive(h)) return 'setup: they died of it';
      h.activate();
      kit.advance(1.5);
      if (s.fill > 0.05) return `the syringe did not go in (${Math.round(s.fill * 100)}% left)`;
      const t = until(() => missing(h).length === 0, 30);
      if (t === Infinity) return `30 s on Regen, still missing ${missing(h).join(', ')} (${h.status()})`;
      // standing on the new leg, for a good while
      if (until(() => state(h) === 'stand', 15) === Infinity) return `all grown back, they never got up (${h.status()})`;
      kit.advance(3);
      if (state(h) !== 'stand') return `up on the new leg, they fell again (${h.status()})`;
      for (const [k, i] of at) {
        const l = h.limbs.get(k)!;
        const p = l.part;
        if (p.destroyed || !l.joint || !l.joint.isValid()) return `the new ${k} is not joined on`;
        if (h.parts[i] !== p) return `the new ${k} is not in its place in the body (${h.parts.indexOf(p)}, was ${i})`;
        if (!p.colliders.length || p.group !== h.id) return `the new ${k} has no colliders, or collides with the body`;
        if (Math.abs(p.sprite.w) < (p.w + 2) * PX * 0.99 || p.sprite.h < (p.h + 2) * PX * 0.99) return `the new ${k} is still drawn small`;
        // (hanging at its joint: not dragged off it)
        const a = l.parent!.part.localToWorld(l.a1.x, l.a1.y);
        const b = p.localToWorld(l.a2.x, l.a2.y);
        if (Math.hypot(a.x - b.x, a.y - b.y) > 0.05) return `the new ${k} is ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(2)} m off its joint`;
      }
      // (the lowest it gets over a while: one moment it may be mid-step, or on a bit of the old leg)
      const foot = h.limbs.get('footF')!.part;
      let low = foot.y;
      for (let i = 0; i < 20; i++) {
        kit.advance(0.1);
        low = Math.min(low, foot.y);
      }
      if (low > 0.2) return `the new foot is never lower than ${low.toFixed(2)} m, standing`;
      const xray = skeleton(h).filter((b) => b.gone || b.severed).map((b) => b.key);
      if (xray.length) return `the x-ray still shows ${xray.join(', ')} missing`;
      // saved and loaded, they're whole and back up
      loadFromString(game, saveToString(game));
      const k = people()[0];
      if (!k) return 'nobody after a save and load';
      if (missing(k).length || k.parts.some((p) => p.destroyed)) return `after a load, missing ${missing(k).join(', ')}`;
      kit.advance(3);
      if (state(k) !== 'stand') return `after a load, they are not standing (${k.status()})`;
      return true;
    }],
    ['extra: potions: Regen raises nobody: a body stays dead, its lost leg and head stay gone', () => {
      kit.reset();
      const a = human(-1.5);
      const b = human(1.5);
      kit.advance(1);
      a.gib(a.limbs.get('upperLegF')!);
      kit.advance(0.05);
      a.die();
      b.gib(b.limbs.get('head')!);
      kit.advance(1);
      if (alive(a) || alive(b)) return 'setup: still alive';
      a.inject('regen', 1);
      b.inject('regen', 1);
      kit.advance(10);
      if (alive(a) || alive(b)) return `Regen brought someone back (${a.status()} / ${b.status()})`;
      if (!missing(a).includes('upperLegF')) return 'a dead body grew its leg back';
      if (!b.limbs.get('head')!.gone) return 'the head grew back';
      return true;
    }],
    ['extra: potions: an animal with a leg blown off, given Regen, grows it back and stands on it', () => {
      kit.reset();
      const d = kit.spawn('dog', 0, 0.5) as Creature;
      kit.advance(1);
      d.gib(d.limbs.get('upperBackF')!, { x: 1, y: 0.2 });
      kit.advance(1);
      if (missing(d).length < 2) return `setup: missing ${missing(d).join(', ')}`;
      d.inject('regen', 1);
      if (until(() => missing(d).length === 0, 20) === Infinity) return `20 s on Regen, still missing ${missing(d).join(', ')}`;
      if (until(() => state(d) === 'stand', 15) === Infinity) return `the leg back, it never got up (${d.status()})`;
      kit.advance(2);
      return state(d) === 'stand' || `up on its new leg, it fell again (${d.status()})`;
    }],
    ['extra: potions: a splash potion of healing smashed between two hurt people heals both, the nearer more', () => {
      kit.reset();
      const near = human(-0.6);
      const far = human(1.5, { flip: true });
      kit.advance(1);
      for (const h of [near, far]) {
        h.stay(30);
        h.blood = 50;
        const belly = h.limbs.get('midTorso')!.part;
        belly.hp = belly.maxHp * 0.3;
      }
      const pot = smash('potion-healing', 0);
      kit.advance(0.6);
      if (!pot.destroyed) return 'the potion did not break';
      const gain = (h: Human) => h.blood - 50;
      const belly = (h: Human) => h.limbs.get('midTorso')!.part.hp / h.limbs.get('midTorso')!.part.maxHp;
      if (gain(near) < 30 || belly(near) < 0.9) return `the nearer was barely healed (blood +${gain(near).toFixed(0)}, belly ${Math.round(belly(near) * 100)}%)`;
      if (gain(far) < 5) return `the further one was not healed (blood +${gain(far).toFixed(0)})`;
      if (gain(far) >= gain(near) - 5) return `the further one healed as much (+${gain(far).toFixed(0)} against +${gain(near).toFixed(0)})`;
      return true;
    }],
    ['extra: potions: a knockout potion knocks out those near it, not someone 4 m off, nor someone behind a wall', () => {
      kit.reset();
      const a = human(-0.8);
      const b = human(1.0, { flip: true });
      const c = human(4.2, { flip: true });
      const d = human(-6.9);
      // (as far the other way from that splash, with no wall: so it's the wall that keeps it off d)
      const e = human(-4.1, { flip: true });
      // (a wall: a steel beam stood on end, pinned)
      const wall = kit.spawn('beam', -6.2, 1.6, { angle: Math.PI / 2 }) as Entity;
      wall.setFrozen(true);
      kit.advance(1);
      for (const h of [a, b, c, d, e]) h.stay(30);
      smash('potion-knockout', 0);
      smash('potion-knockout', -5.5);
      kit.advance(3);
      const out = (h: Human) => h.consciousness < 0.3 && h.drugs.knockout > 0;
      if (!out(a) || !out(b)) return `those near are not out (${a.status()} / ${b.status()})`;
      if (out(c) || c.drugs.knockout > 0) return `someone 4 m off was knocked out (${c.status()})`;
      if (e.drugs.knockout <= 0) return `someone as far from it with no wall between was not splashed (${e.status()})`;
      if (d.drugs.knockout > 0) return `it splashed through a wall (${d.status()})`;
      return true;
    }],
    ['extra: potions: all 16 splash potions stand when set down and shatter thrown hard at the floor', () => {
      kit.reset();
      const ids = ITEMS.filter((d) => d.id.startsWith('potion-')).map((d) => d.id);
      if (ids.length !== 16) return `${ids.length} potions (${ids.join(', ')})`;
      const bad = ITEMS.filter((d) => d.id.startsWith('potion-') && (d.category !== 'Medical' || !/^Splash Potion of /.test(d.name) || !d.description));
      if (bad.length) return `not named or put as the rest: ${bad.map((d) => d.name).join(', ')}`;
      const set = ids.map((id, i) => kit.spawn(id, -6 + i * 0.8, 0.3));
      kit.advance(1.5);
      const broke = set.filter((p) => p.destroyed).map((p) => p.def.id);
      if (broke.length) return `set down, these broke: ${broke.join(', ')}`;
      // (between those set down: not clipping one on the way down, and slowed on it)
      const thrown = ids.map((id, i) => smash(id, -5.6 + i * 0.8));
      kit.advance(1);
      const whole = thrown.filter((p) => !p.destroyed).map((p) => p.def.id);
      if (whole.length) return `thrown hard at the floor, these stayed whole: ${whole.join(', ')}`;
      if (set.some((p) => p.destroyed)) return 'one set down was broken by the others breaking';
      return true;
    }],
    ['extra: potions: Use in someone’s hand throws it ahead of them, to smash where it lands', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const p = arm(h, 'potion-adrenaline') as unknown as SplashPotion | undefined;
      if (!p) return 'they did not take the potion';
      h.activate();
      if (p.holder) return 'still in their hand';
      const x0 = h.limbs.get('upperTorso')!.part.x;
      let x = p.main.x;
      const t = until(() => {
        if (!p.destroyed) x = p.main.x;
        return p.destroyed;
      }, 3);
      if (t === Infinity) return `thrown, it never broke (at ${p.main.x.toFixed(2)}, ${p.main.y.toFixed(2)})`;
      if (x - x0 < 1.5) return `it went ${(x - x0).toFixed(2)} m ahead of them`;
      return true;
    }],
    ['extra: potions: a splash potion saves and loads, and still splashes its drug', () => {
      kit.reset();
      kit.spawn('potion-regen', 0, 0.3);
      kit.advance(1);
      loadFromString(game, saveToString(game));
      const p = game.entities.find((e) => e.def.id === 'potion-regen') as SplashPotion | undefined;
      if (!p) return 'no potion after a load';
      if (p.drug !== 'regen') return `it loaded as ${p.drug}`;
      const h = human(1);
      kit.advance(1);
      p.activate();
      kit.advance(0.2);
      if (!p.destroyed) return 'Use did not smash it';
      return h.drugs.regen > 10 || `the person beside it got ${h.drugs.regen.toFixed(1)} s of Regen`;
    }],
  ];
}

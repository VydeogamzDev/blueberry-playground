import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import type { Syringe } from '../../entities/Syringe';
import type { HeartMonitor, LifeDetector } from '../../entities/Monitors';
import type { Chainsaw } from '../../entities/Chainsaw';
import type { Extinguisher } from '../../entities/Sprayers';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import type { DamageKind } from '../../world/types';
import type { PixelArt } from '../../art/PixelArt';
import { PINK_DRUGS } from '../../entities/Syringe';
import { SAW_BAR } from '../../art/gear';
import { fromBase64 } from '../../engine/base64';
import { wrapAngle } from '../../engine/math';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { readVitals } from '../../ui/VitalsPanel';
import { vitalsOf } from '../../net/Host';
import { allies, enemies } from '../../systems/Teams';

/**
 * More medicine, and what comes of it: the new syringes, a stun that isn't a drug,
 * zombies (infection, turning, biting, the cure, saving), the gorse and its blood,
 * poses and bones from the menu, the heart monitor and the life detector; and the
 * weapons agent's asks (fighting ranges, an animal's limb shredded by a chainsaw).
 */
export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
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
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  const gap = (a: Entity, b: Entity) => Math.abs(a.center().x - b.center().x);
  const bleeding = (e: Human | Creature): number => {
    let s = 0;
    for (const l of e.limbs.values()) for (const w of l.wounds) s += w.rate;
    return s;
  };
  /** Pixels painted on a body (wounds, blood, burns). */
  const painted = (e: Entity): number => e.parts.reduce((n, p) => {
    const d = p.destroyed ? null : p.paintData();
    return n + (d ? fromBase64(d).length / 7 : 0);
  }, 0);
  /** Counts the damage of one kind done to someone. */
  const counted = (e: Entity, kind: DamageKind): (() => number) => {
    let n = 0;
    const d = e.damage.bind(e);
    e.damage = (part, amount, k, ...rest) => {
      if (k === kind) n++;
      return d(part, amount, k, ...rest);
    };
    return () => n;
  };
  const stiff = (e: Human | Creature) => (e as unknown as { stiff: boolean }).stiff;
  const samePixels = (a: PixelArt, b: PixelArt) => a.w === b.w && a.h === b.h && a.px.every((c, i) => c === b.px[i]);
  /** (read through these, a check made earlier in a test doesn't narrow what it can be now) */
  const zombie = (e: Human | Creature) => e.zombie;
  const alive = (e: Human | Creature) => e.alive;
  const state = (e: Human | Creature) => e.state;
  /** Right-clicks a part and picks `label` from the menu that opens: whether it was there. */
  const menuAt = (p: Part, label: string): boolean => {
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.querySelector('.ctx-label')?.textContent ?? '').replace(/^[☑☐] /, '') === label);
    if (!item) {
      controls.ui.closeContextMenu();
      return false;
    }
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };
  /** Someone in the scene by a test's own pick (people loaded from a save are new objects). */
  const people = () => game.entities.filter((e) => e.def.id === 'human' && !e.destroyed) as Human[];

  return [
    // ------------------------------------------------------------ the weapons agent's asks
    ['extra: medical2: a stun knocks out a person, an android and a dog for its length, and is no drug', () => {
      kit.reset();
      const list: (Human | Creature)[] = [human(-3), kit.spawn('android', 0, 1) as Human, kit.spawn('dog', 3, 0.6) as Creature];
      kit.advance(1.5);
      for (const e of list) e.stun(3);
      kit.advance(1.5);
      for (const e of list) {
        if (e.consciousness > 0.3) return `${e.def.id} stunned, still conscious (${e.consciousness.toFixed(2)})`;
        const d = Object.entries(e.drugs).filter(([, v]) => v > 0);
        if (d.length) return `${e.def.id} stunned has drugs in them: ${d.map(([k]) => k).join(', ')}`;
        const fx = readVitals(e, game).effects;
        if (fx.length) return `${e.def.id} stunned shows effects: ${fx.join(', ')}`;
      }
      kit.advance(7);
      for (const e of list) if (e.consciousness < 0.4) return `${e.def.id} still out 5 s after a 3 s stun (${e.consciousness.toFixed(2)})`;
      return true;
    }],
    ['extra: medical2: NPCs keep their own gun\'s range: a double-barrel comes in close, a battle rifle shoots from far off', () => {
      for (const [id, lo, hi] of [['double-barrel', 0, 5], ['battle-rifle', 10.5, 13], ['flamethrower', 3, 5.5]] as const) {
        kit.reset();
        const a = human(-6);
        const b = human(6, { flip: true });
        kit.advance(1);
        b.setFrozen(true);
        const g = arm(a, id);
        if (g?.def.id !== id) return `could not hand them the ${id}`;
        a.fight(b);
        const t = until(() => g.shots > 0, 15);
        if (!Number.isFinite(t)) return `with a ${id}, 12 m off, no shot in 15 s (now ${gap(a, b).toFixed(1)} m off)`;
        const d = gap(a, b);
        if (d < lo || d > hi) return `with a ${id} they first fired ${d.toFixed(1)} m off (expected ${lo}-${hi} m)`;
      }
      return true;
    }],
    ['extra: medical2: a running chainsaw on a dog\'s paw cuts it off and tears it to bits (Creature.limbOf)', () => {
      kit.reset();
      const dog = kit.spawn('dog', 0, 0.6) as Creature;
      dog.stay(60);
      kit.advance(1.5);
      const paw = dog.limbs.get('lowerFrontF')!;
      if (dog.limbOf(paw.part) !== paw) return 'limbOf() does not find the paw';
      paw.part.setFrozen(true);
      const saw = kit.spawn('chainsaw', paw.part.x, paw.part.y + 1) as Chainsaw;
      const m = saw.main.pixelToWorld((SAW_BAR.x0 + SAW_BAR.x1) / 2, (SAW_BAR.y0 + SAW_BAR.y1) / 2);
      saw.translate(paw.part.x - m.x, paw.part.y - m.y);
      saw.setFrozen(true);
      saw.activate();
      const t = until(() => paw.gone, 6);
      if (!Number.isFinite(t)) return `held on the paw for 6 s it was not torn to bits (hp ${paw.part.hp.toFixed(0)}, ${paw.severed ? 'cut off' : 'still on'})`;
      return true;
    }],
    ['extra: medical2: someone holding a fire extinguisher goes and puts out a fire near them, and the fire on themselves', () => {
      kit.reset();
      const h = human(-3);
      kit.advance(1);
      const ex = arm(h, 'fire-extinguisher') as unknown as Extinguisher | undefined;
      if (ex?.def.id !== 'fire-extinguisher') return 'could not hand them the extinguisher';
      const crate = kit.spawn('crate', torso(h).x + 4, 0.45);
      kit.advance(0.5);
      const c = crate.parts[0];
      // (oil in it: it burns on until put out)
      c.oil = 0.6;
      game.fire.ignite(c, 1);
      let sprayed = false;
      const out = (n: () => number) => () => {
        sprayed ||= ex.spraying;
        return n() === 0;
      };
      const t = until(out(() => c.burning), 10);
      if (!Number.isFinite(t)) return `in 10 s they did not put out a crate burning 4 m off (${c.burning.toFixed(2)}; ${gap(h, crate).toFixed(1)} m off, ${h.status()})`;
      if (!sprayed) return 'the crate went out without them spraying it';
      kit.advance(1);
      if (ex.spraying) return 'still spraying 1 s after the fire was out';
      if (!h.heldItems().includes(ex as never)) return 'they dropped the extinguisher';
      // their own leg alight
      const burning = () => h.parts.filter((p) => !p.destroyed && p.burning > 0).length;
      game.fire.ignite(h.limbs.get('lowerLegF')!.part, 0.3);
      sprayed = false;
      const t2 = until(out(burning), 8);
      if (!Number.isFinite(t2)) return `in 8 s they did not put out their own burning leg (${burning()} parts alight, ${h.status()})`;
      if (!sprayed) return 'their leg went out without them spraying it';
      if (!alive(h)) return 'they died of it';
      return true;
    }],

    // ------------------------------------------------------------ the new syringes
    ['extra: medical2: a Death syringe (used on themselves) stops the heart; a defibrillator can still start it', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const s = arm(h, 'syringe-death') as unknown as Syringe | undefined;
      if (!s) return 'they did not take the syringe';
      h.activate();
      kit.advance(1.5);
      if (s.fill > 0.05) return `it did not go in (${Math.round(s.fill * 100)}% left)`;
      if (alive(h)) return `a Death syringe in them, they live (${h.status()})`;
      if (!h.restart()) return 'just dead from it, the defibrillator could not start their heart';
      return true;
    }],
    ['extra: medical2: Coagulation stops the bleeding within seconds; a Painkiller keeps the pain away', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2);
      kit.advance(1);
      for (const h of [a, b]) {
        h.stay(30);
        const belly = h.limbs.get('midTorso')!.part;
        h.damage(belly, 25, 'stab', { x: belly.x, y: belly.y + 0.08 }, { x: 0, y: -1 });
      }
      kit.advance(0.3);
      const b0 = bleeding(a);
      if (b0 < 0.2) return `setup: not bleeding (${b0.toFixed(2)})`;
      a.inject('coagulation', 1);
      kit.advance(4);
      if (bleeding(a) > b0 * 0.05) return `4 s on Coagulation still bleeding ${bleeding(a).toFixed(2)} (was ${b0.toFixed(2)})`;
      if (bleeding(b) < bleeding(a) * 5 + 0.05) return `without it, the other bled no more (${bleeding(b).toFixed(2)})`;
      // the painkiller: pain gone, and a fresh blow doesn't bring it back
      b.inject('painkiller', 1);
      if (b.pain > 0) return `on painkiller, still in pain (${b.pain.toFixed(2)})`;
      const shin = b.limbs.get('lowerLegF')!.part;
      b.damage(shin, 30, 'blunt', { x: shin.x, y: shin.y }, { x: 1, y: 0 });
      kit.advance(1);
      if (b.pain > 0) return `on painkiller, a blow hurt them (${b.pain.toFixed(2)})`;
      if (!readVitals(b, game).effects.some((f) => f.startsWith('Painkiller'))) return `the vitals don't show the painkiller (${readVitals(b, game).effects.join(', ')})`;
      return true;
    }],
    ['extra: medical2: on Ultra Strength a fighter\'s blows send people flying', () => {
      kit.reset();
      const a = human(-1);
      const b = human(1, { flip: true });
      kit.advance(1);
      a.inject('strength', 1);
      a.fight(b, false);
      b.stay(30);
      const t = until(() => Math.abs(torso(b).vx) > 4, 10);
      if (!Number.isFinite(t)) return `fighting for 10 s on Ultra Strength, nobody was flung (${b.status()})`;
      return true;
    }],
    ['extra: medical2: Freeze locks someone stiff, blue, where they stand (an android too), and they thaw', () => {
      kit.reset();
      const h = human(-1.5);
      const r = kit.spawn('android', 1.5, 1) as Human;
      kit.advance(1.5);
      for (const e of [h, r]) {
        e.inject('freeze', 1);
        if (!stiff(e)) return `${e.def.id}: Freeze did not stiffen them`;
      }
      const knee = (e: Human) => wrapAngle(e.limbs.get('lowerLegF')!.part.a - e.limbs.get('upperLegF')!.part.a);
      const elbow = (e: Human) => wrapAngle(e.limbs.get('lowerArmF')!.part.a - e.limbs.get('upperArmF')!.part.a);
      kit.advance(0.1);
      const k0 = [knee(h), knee(r)];
      const e0 = [elbow(h), elbow(r)];
      kit.advance(2);
      for (const [i, e] of [h, r].entries()) {
        if (Math.abs(knee(e) - k0[i]) > 0.08 || Math.abs(elbow(e) - e0[i]) > 0.08) return `${e.def.id} frozen, its joints moved (knee ${k0[i].toFixed(2)} -> ${knee(e).toFixed(2)}, elbow ${e0[i].toFixed(2)} -> ${elbow(e).toFixed(2)})`;
        const p = torso(e).sprite;
        if (!(p.b > p.r + 0.2)) return `${e.def.id} frozen, not blue (tint ${p.r.toFixed(2)}, ${p.g.toFixed(2)}, ${p.b.toFixed(2)})`;
        e.drugs.freeze = 0.2;
      }
      kit.advance(1);
      for (const e of [h, r]) {
        if (stiff(e)) return `${e.def.id}: the Freeze wore off, still stiff`;
        if (torso(e).sprite.b > 1.01) return `${e.def.id}: thawed, still blue`;
      }
      return true;
    }],
    ['extra: medical2: Bone Eating breaks one bone after another (never the skull); Acid melts the body until limbs fall off', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2);
      kit.advance(1);
      a.inject('bone', 1);
      kit.advance(5);
      const broken = [...a.limbs.values()].filter((l) => l.broken);
      if (broken.length < 4) return `5 s of Bone Eating broke only ${broken.length} bones`;
      if (a.limbs.get('head')!.broken) return 'Bone Eating broke the skull';
      const paint0 = painted(b);
      b.inject('acid', 1);
      kit.advance(4);
      if (painted(b) < paint0 + 8) return `4 s of acid in them left only ${painted(b) - paint0} scarred pixels`;
      const t = until(() => [...b.limbs.values()].some((l) => l.severed || l.gone), 14);
      if (!Number.isFinite(t)) return `18 s of acid, no limb fell off (${b.status()})`;
      return true;
    }],
    ['extra: medical2: a Pink syringe does what one of the others does; androids shrug off the rest', () => {
      kit.reset();
      const h = human(-1.5);
      kit.advance(1);
      h.blood = 70;
      const s = arm(h, 'syringe-pink') as unknown as Syringe | undefined;
      if (!s) return 'they did not take the syringe';
      h.activate();
      kit.advance(1.5);
      const as = s.pinkAs;
      if (!as || !PINK_DRUGS.includes(as)) return `it went in as ${as}`;
      const d = h.drugs as Record<string, number>;
      const did = as === 'death' ? !alive(h) : as === 'zombie' ? h.infection > 0 : as in d ? d[as] > 0 || as === 'bone' : as === 'cure' || h.blood > 75;
      if (!did) return `it went in as ${as}, and did nothing (${h.status()})`;
      // an android: none of it does anything but the Freeze
      const r = kit.spawn('android', 1.5, 1) as Human;
      kit.advance(1);
      for (const drug of ['death', 'zombie', 'poison', 'knockout', 'acid', 'bone'] as const) r.inject(drug, 1);
      kit.advance(1);
      if (!alive(r) || r.infection > 0 || Object.values(r.drugs).some((v) => v > 0)) return `drugs worked on an android: ${r.status()}`;
      return true;
    }],
    ['extra: medical2: animals take the drugs too: a dog freezes and its bones break; acid does nothing to a gorse and fire burns it worse', () => {
      kit.reset();
      const dog = kit.spawn('dog', -2, 0.6) as Creature;
      const g = kit.spawn('gorse', 2, 0.45) as Creature;
      dog.stay(60);
      g.stay(60);
      kit.advance(1.5);
      dog.inject('freeze', 1);
      if (!stiff(dog)) return 'Freeze did not stiffen the dog';
      dog.drugs.freeze = 0.1;
      kit.advance(0.5);
      if (stiff(dog)) return 'the dog did not thaw';
      dog.inject('bone', 1);
      kit.advance(3);
      if ([...dog.limbs.values()].filter((l) => l.broken).length < 2) return 'Bone Eating broke none of the dog\'s bones';
      g.inject('acid', 1);
      if (g.drugs.acid > 0) return 'acid went into a gorse';
      const gp = g.limbs.get('hips')!.part;
      const hp0 = gp.hp;
      g.damage(gp, 20, 'acid', { x: gp.x, y: gp.y }, { x: 0, y: -1 });
      if (gp.hp < hp0) return `acid hurt the gorse (${hp0.toFixed(0)} -> ${gp.hp.toFixed(0)})`;
      const dp = dog.limbs.get('hips')!.part;
      const d0 = dp.hp;
      const g0 = gp.hp;
      dog.damage(dp, 10, 'fire', { x: dp.x, y: dp.y }, { x: 0, y: 1 });
      g.damage(gp, 10, 'fire', { x: gp.x, y: gp.y }, { x: 0, y: 1 });
      if (g0 - gp.hp < (d0 - dp.hp) * 1.3) return `fire burnt the gorse ${(g0 - gp.hp).toFixed(1)} hp, the dog ${(d0 - dp.hp).toFixed(1)}`;
      return true;
    }],

    // ------------------------------------------------------------ zombies
    ['extra: medical2: a Zombie syringe infects someone, who turns ~10 s later (grey, slow) and goes for the nearest person, whose bite turns them too', () => {
      kit.reset();
      const a = human(-1.2);
      const b = human(1.2, { flip: true });
      kit.advance(1);
      b.inject('knockout', 1);
      const art0 = torso(a).art;
      a.inject('zombie', 1);
      if (!(a.infection > 0)) return 'the virus did not take';
      if (a.prey) return 'infected, they still count as someone a zombie goes for';
      kit.advance(5);
      if (zombie(a)) return 'turned within 5 s';
      if (!readVitals(a, game).effects.some((f) => f.startsWith('Infected'))) return `the vitals don't show the infection (${readVitals(a, game).effects.join(', ')})`;
      if (!Number.isFinite(until(() => zombie(a), 7))) return `not turned 12 s on (infection ${a.infection.toFixed(2)})`;
      kit.advance(0.1);
      if (!alive(a)) return 'turned, and dead';
      if (samePixels(torso(a).art, art0)) return 'turned, their skin is unchanged';
      if (Math.abs(a.rush - 0.5) > 0.05) return `a zombie gets about at ${a.rush.toFixed(2)} of their pace`;
      if (readVitals(a, game).bpm !== 0) return 'a zombie has a heartbeat';
      const t = until(() => b.infection > 0, 25);
      if (!Number.isFinite(t)) return `the zombie never bit the person out cold 2.4 m off (foe ${a.foe?.def.id ?? 'none'}, ${gap(a, b).toFixed(2)} m apart, ${a.status()})`;
      kit.advance(1);
      if (a.foe === b) return 'bitten, they are still the zombie\'s foe';
      if (!Number.isFinite(until(() => zombie(b), 11))) return `bitten, they did not turn (infection ${b.infection.toFixed(2)})`;
      return true;
    }],
    ['extra: medical2: the Zombie Cure: someone infected never turns; a zombie is themselves again; a corpse given the virus rises', () => {
      kit.reset();
      const c = human(-3);
      const d = human(0);
      const e = human(3);
      kit.advance(1);
      c.inject('zombie', 1);
      kit.advance(2);
      c.inject('cure', 1);
      if (c.infection !== 0) return `the Cure did not clear an infection (${c.infection.toFixed(2)})`;
      const art0 = torso(d).art;
      d.infection = 0.97;
      kit.advance(0.6);
      if (!zombie(d)) return 'setup: did not turn';
      d.inject('cure', 1);
      kit.advance(0.1);
      if (zombie(d) || d.infection > 0) return 'the Cure did not bring the zombie back';
      if (!samePixels(torso(d).art, art0)) return 'cured, still in a zombie\'s skin';
      if (!d.prey) return 'cured, a zombie would not go for them';
      e.die();
      kit.advance(0.5);
      e.inject('zombie', 1);
      if (!(e.infection > 0)) return 'the virus did not take in a corpse';
      e.infection = 0.97;
      kit.advance(0.6);
      if (!alive(e) || !zombie(e)) return `infected, the corpse did not rise (${e.status()})`;
      kit.advance(10);
      if (zombie(c) || zombie(d)) return 'cured, they turned anyway';
      return true;
    }],
    ['extra: medical2: a zombie only stops for its head: no blood, a beating that kills the living, a Death syringe don\'t; teams fight them', () => {
      kit.reset();
      const z = human(-2);
      const p = human(2);
      kit.advance(1);
      z.infection = 0.97;
      kit.advance(0.6);
      if (!zombie(z)) return 'setup: did not turn';
      z.blood = 5;
      z.inject('death', 1);
      kit.advance(1);
      if (!alive(z)) return `drained of blood and given Death, the zombie died (${z.status()})`;
      // the same beating for the zombie and the living
      for (const h of [z, p]) {
        for (const l of h.limbs.values()) if (l.joint && l.spec.key !== 'head' && l.spec.key !== 'upperTorso') l.part.hp = l.part.maxHp * 0.3;
      }
      kit.advance(0.5);
      if (alive(p)) return 'setup: the beating did not kill the living';
      if (!alive(z)) return 'the beating that kills the living killed the zombie';
      // its team's enemies, and not their own
      p.heal();
      p.setTeam('red');
      const z2 = human(-4);
      z2.infection = 0.97;
      kit.advance(0.6);
      if (!enemies(p, z) || !enemies(z, p) || !allies(z, z2)) return 'zombies are not enemies of a team, or not on a side of their own';
      const head = z.limbs.get('head')!.part;
      z.damage(head, 500, 'blunt', { x: head.x, y: head.y }, { x: 1, y: 0 });
      kit.advance(0.5);
      if (alive(z)) return `its head smashed, the zombie lives on (${z.status()})`;
      kit.advance(3);
      if (alive(z)) return 'its head smashed, the zombie rose again';
      return true;
    }],
    ['extra: medical2: saving and loading keeps zombies (and the infected, turning on schedule); guests hear of them', () => {
      kit.reset();
      const z = human(-3);
      const i = human(3, { flip: true });
      kit.advance(1);
      z.infection = 0.97;
      i.inject('zombie', 1);
      kit.advance(2);
      if (!zombie(z)) return 'setup: did not turn';
      const inf = i.infection;
      const art = torso(z).art;
      if (vitalsOf(z).zombie !== true) return 'a guest is not told someone is a zombie';
      loadFromString(game, saveToString(game));
      const list = people();
      const z1 = list.find((h) => h.zombie);
      const i1 = list.find((h) => !h.zombie);
      if (!z1 || !i1) return `loaded: ${list.length} people, ${list.filter((h) => h.zombie).length} zombies`;
      kit.advance(0.1);
      if (!alive(z1)) return 'loaded, the zombie is dead';
      if (!samePixels(torso(z1).art, art)) return 'loaded, the zombie is in its own skin';
      if (Math.abs(i1.infection - inf) > 0.05) return `loaded, the infection went from ${inf.toFixed(2)} to ${i1.infection.toFixed(2)}`;
      if (!Number.isFinite(until(() => zombie(i1), 10))) return `loaded, the infected never turned (${i1.infection.toFixed(2)})`;
      return true;
    }],
    ['extra: medical2: a zombie dog goes for a person and its bite infects them; a gorse can\'t catch it', () => {
      kit.reset();
      const dog = kit.spawn('dog', -1.4, 0.6) as Creature;
      const h = human(1, { flip: true });
      kit.advance(1.5);
      h.inject('knockout', 1);
      dog.inject('zombie', 1);
      if (!(dog.infection > 0)) return 'the dog did not catch it';
      dog.infection = 0.97;
      kit.advance(0.6);
      if (!zombie(dog)) return 'the dog did not turn';
      const t = until(() => h.infection > 0, 25);
      if (!Number.isFinite(t)) return `the zombie dog never bit the person (foe ${dog.foe?.def.id ?? 'none'}, ${gap(dog, h).toFixed(2)} m apart, ${dog.status()})`;
      dog.inject('cure', 1);
      if (zombie(dog)) return 'the Cure did not bring the dog back';
      const g = kit.spawn('gorse', 5, 0.45) as Creature;
      g.inject('zombie', 1);
      if (g.infection > 0) return 'a gorse caught the zombie virus';
      return true;
    }],

    // ------------------------------------------------------------ the gorse
    ['extra: medical2: a gorse goes for a person on its own, spits its blood at them from metres off, and it eats into their flesh', () => {
      kit.reset();
      const h = human(2.5, { flip: true });
      kit.advance(1);
      h.setFrozen(true);
      const acid = counted(h, 'acid');
      const paint0 = painted(h);
      const g = kit.spawn('gorse', -3, 0.45) as Creature;
      let first = -1;
      const t = until(() => {
        if (first < 0 && acid() > 0) first = gap(g, h);
        return acid() >= 4;
      }, 15);
      if (!Number.isFinite(t)) return `in 15 s it landed ${acid()} drops on them (${g.status()}, foe ${g.foe?.def.id ?? 'none'}, ${gap(g, h).toFixed(1)} m off)`;
      if (first < 1.6) return `its first spit landed from only ${first.toFixed(2)} m off`;
      const hurt = h.parts.reduce((n, p) => n + (p.destroyed ? 0 : p.maxHp - p.hp), 0);
      if (hurt < 3) return `its blood did them only ${hurt.toFixed(1)} hp of harm`;
      if (painted(h) <= paint0) return 'its blood left no burns on them';
      return true;
    }],
    ['extra: medical2: a gorse whose head is broken (Break bone in its menu) can no longer spit, and comes in to bite', () => {
      kit.reset();
      const h = human(2.5, { flip: true });
      kit.advance(1);
      h.setFrozen(true);
      const acid = counted(h, 'acid');
      const g = kit.spawn('gorse', -2, 0.45) as Creature;
      kit.advance(0.2);
      const head = g.limbs.get('head')!;
      const pick = g.contextActions(head.part).find((a) => a.label === 'Break bone');
      if (!pick) return `no Break bone for a gorse's head (${g.contextActions(head.part).map((a) => a.label).join(', ')})`;
      pick.action();
      if (!head.broken) return 'Break bone did not break its head';
      let nearest = Infinity;
      until(() => {
        nearest = Math.min(nearest, gap(g, h));
        return false;
      }, 8);
      if (acid() > 0) return `its head broken, it still spat (${acid()} drops landed)`;
      if (nearest > 1.6) return `its head broken, it never came in close (nearest ${nearest.toFixed(2)} m; ${g.status()})`;
      return true;
    }],

    // ------------------------------------------------------------ poses and bones
    ['extra: medical2: poses from the menu: Sit, Flat, Cower and Stumble; picked again they let go', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1.5);
      const y0 = torso(h).y;
      const pick = (label: string) => {
        const a = h.contextActions().find((x) => x.label === label);
        if (!a) throw new Error(`no ${label} in the menu (${h.contextActions().map((x) => x.label).join(', ')})`);
        a.action();
      };
      pick('Sit');
      kit.advance(3);
      const sit = torso(h);
      if (h.pose !== 'sit' || state(h) !== 'down') return `Sit: pose ${h.pose}, ${h.state}`;
      if (sit.y < 0.4 || sit.y > y0 - 0.25 || Math.abs(wrapAngle(sit.a)) > 0.6) return `Sit: the chest is ${sit.y.toFixed(2)} m up (standing ${y0.toFixed(2)}) at ${wrapAngle(sit.a).toFixed(2)} rad`;
      pick('Sit');
      if (h.pose !== null) return 'Sit picked again, still sitting';
      if (!Number.isFinite(until(() => state(h) === 'stand', 8))) return `let go of Sit, not up again 8 s later (${h.status()})`;
      kit.advance(1);
      pick('Flat pose');
      kit.advance(3);
      if (torso(h).y > 0.3 || h.limbs.get('lowerTorso')!.part.y > 0.3) return `Flat: the chest is ${torso(h).y.toFixed(2)} m up`;
      pick('Flat pose');
      if (!Number.isFinite(until(() => state(h) === 'stand', 8))) return `let go of Flat, not up again 8 s later (${h.status()})`;
      kit.advance(1);
      pick('Cower');
      const x0 = torso(h).x;
      h.goTo(x0 + 4);
      kit.advance(3);
      if (torso(h).y > y0 - 0.12) return `Cower: the chest is ${torso(h).y.toFixed(2)} m up (standing ${y0.toFixed(2)})`;
      if (Math.abs(torso(h).x - x0) > 0.4) return `cowering, they walked ${Math.abs(torso(h).x - x0).toFixed(2)} m`;
      pick('Cower');
      pick('Stumble');
      let lo = Infinity;
      let hi = -Infinity;
      until(() => {
        lo = Math.min(lo, torso(h).x);
        hi = Math.max(hi, torso(h).x);
        return false;
      }, 6);
      if (hi - lo < 0.15) return `stumbling for 6 s they lurched only ${(hi - lo).toFixed(2)} m`;
      if (!alive(h) || h.consciousness < 0.5) return `stumbling, they came to harm (${h.status()})`;
      // an animal lies flat too
      const dog = kit.spawn('dog', 3, 0.6) as Creature;
      kit.advance(1);
      dog.contextActions().find((x) => x.label === 'Flat pose')?.action();
      kit.advance(2);
      if (dog.pose !== 'flat' || state(dog) !== 'down') return `the dog's Flat pose: ${dog.pose}, ${dog.state}`;
      return true;
    }],
    ['extra: medical2: right-click a limb: Break bone breaks that one, Mend bone mends it', () => {
      kit.reset();
      const h = human(0);
      h.stay(30);
      kit.advance(1.5);
      kit.view(0, 1, 160);
      const shin = h.limbs.get('lowerLegF')!;
      if (!menuAt(shin.part, 'Break bone')) return 'no Break bone in the menu of a right-clicked shin';
      const broken = [...h.limbs.values()].filter((l) => l.broken).map((l) => l.spec.key);
      if (broken.join() !== 'lowerLegF') return `Break bone on the shin broke [${broken.join(', ')}]`;
      if (!readVitals(h, game).limbs.some((l) => l.key === 'lowerLegF' && l.status.includes('broken'))) return 'the vitals don\'t show the broken shin';
      kit.advance(0.5);
      if (!menuAt(shin.part, 'Mend bone')) return 'no Mend bone in the menu of the broken shin';
      if (shin.broken) return 'Mend bone did not mend it';
      const headMenu = h.contextActions(h.limbs.get('head')!.part).map((a) => a.label);
      if (headMenu.includes('Break bone')) return 'a person\'s skull can be broken from the menu';
      return true;
    }],

    // ------------------------------------------------------------ the monitors
    ['extra: medical2: a heart monitor clipped to someone beats with their heart, powering its wires each beat, and flatlines when it stops', () => {
      kit.reset();
      const h = human(0);
      h.stay(60);
      kit.advance(1);
      const m = kit.spawn('heart-monitor', 1.3, 0.3) as HeartMonitor;
      const light = kit.spawn('light', 2.6, 0.25);
      kit.advance(0.5);
      const clip = m.contextActions().find((a) => a.label === 'Clip leads to nearest');
      if (!clip || clip.disabled) return `no Clip leads in its menu with someone beside it (${m.contextActions().map((a) => a.label).join(', ')})`;
      clip.action();
      if (m.patient !== h) return 'its leads clipped on, it has no patient';
      const lp = light.parts[0];
      game.connections.create('wire', m.main, { x: m.main.x + 0.25, y: m.main.y }, lp, { x: lp.x, y: lp.y });
      let lit = 0;
      let was = false;
      const b0 = m.beats;
      until(() => {
        if (light.powered && !was) lit++;
        was = light.powered;
        return false;
      }, 4);
      if (m.beats - b0 < 3) return `in 4 s it picked up ${m.beats - b0} beats (reading ${m.bpm.toFixed(0)} bpm)`;
      if (m.bpm < 50 || m.bpm > 140) return `it reads ${m.bpm.toFixed(0)} bpm for someone standing about`;
      if (lit < 3) return `the light wired to it came on ${lit} times in 4 s`;
      if (h.drugs.knockout > 0 || h.consciousness < 0.5) return 'the leads hurt them';
      h.inject('death', 1);
      kit.advance(1);
      if (m.bpm !== 0) return `their heart stopped, it reads ${m.bpm.toFixed(0)} bpm`;
      const b1 = m.beats;
      kit.advance(2);
      if (m.beats !== b1) return 'it beat on after the heart stopped';
      if (!(m.alarmT > 2)) return `no flatline (${m.alarmT.toFixed(1)} s)`;
      if (!h.restart()) return 'setup: the defibrillator could not restart them';
      kit.advance(2);
      if (m.beats === b1) return 'the heart restarted, it shows no beat';
      loadFromString(game, saveToString(game));
      const m2 = game.entities.find((e) => e.def.id === 'heart-monitor') as HeartMonitor | undefined;
      if (!m2) return 'loading lost the monitor';
      kit.advance(0.5);
      if (!m2.patient) return 'loaded, its leads are off';
      m2.contextActions().find((a) => a.label === 'Unclip leads')?.action();
      kit.advance(0.5);
      if (m2.patient) return 'Unclip leads left it on them';
      return true;
    }],
    ['extra: medical2: a life detector powers its wires while someone alive is in its beam, not a body or a zombie', () => {
      kit.reset();
      const h = kit.spawn('human', 0, 0.4, { angle: Math.PI / 2 }) as Human;
      h.inject('knockout', 1);
      kit.advance(1.5);
      const y = torso(h).y;
      const d = kit.spawn('life-detector', -2, y) as LifeDetector;
      d.setFrozen(true);
      const light = kit.spawn('light', -3, 0.25);
      kit.advance(0.3);
      const lp = light.parts[0];
      game.connections.create('wire', d.main, { x: d.main.x, y: d.main.y }, lp, { x: lp.x, y: lp.y });
      kit.advance(0.3);
      if (!d.active) return `someone alive lying in its beam (${y.toFixed(2)} m up), it sees nothing`;
      if (!light.powered) return 'seeing someone alive, the light wired to it is off';
      h.die();
      kit.advance(0.5);
      if (d.active) return 'a body in its beam, it still sees life';
      if (light.powered) return 'nobody alive in its beam, the light is on';
      h.infection = 0.97;
      kit.advance(0.6);
      if (!zombie(h)) return 'setup: the body did not rise';
      h.setFrozen(true);
      kit.advance(0.5);
      if (d.active) return 'a zombie in its beam counts as alive';
      return true;
    }],
  ];
}

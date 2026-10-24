import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Creature } from '../../entities/Creature';
import type { Syringe } from '../../entities/Syringe';
import type { FirstAidKit, Bandage, Defibrillator } from '../../entities/Medical';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import { fromBase64 } from '../../engine/base64';
import { GAUZE_COLORS } from '../../art/medical';

export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  /** Pixels painted on a body (wounds, blood, bruises, bandages). */
  const painted = (e: Entity): number => e.parts.reduce((n, p) => {
    const d = p.destroyed ? null : p.paintData();
    return n + (d ? fromBase64(d).length / 7 : 0);
  }, 0);
  /** Pixels of bandage wrapped round a limb. */
  const gauzeOn = (p: Part): number => {
    const d = p.paintData();
    if (!d) return 0;
    const b = fromBase64(d);
    let n = 0;
    for (let j = 0; j + 7 <= b.length; j += 7) if (GAUZE_COLORS.has((b[j + 3] << 16) | (b[j + 4] << 8) | b[j + 5])) n++;
    return n;
  };
  /** How fast someone is bleeding, all wounds together. */
  const bleeding = (e: Human | Creature): number => {
    let s = 0;
    for (const l of e.limbs.values()) for (const w of l.wounds) s += w.rate;
    return s;
  };
  /** Someone lying on the floor, a forearm broken, stabbed in the belly and half bled out. */
  const casualty = (): Human => {
    const h = kit.spawn('human', 0, 0.4, { angle: Math.PI / 2 }) as Human;
    kit.advance(1.5);
    const fore = h.limbs.get('lowerArmF')!;
    fore.broken = true;
    fore.part.hp *= 0.4;
    const belly = h.limbs.get('midTorso')!.part;
    h.damage(belly, 25, 'stab', { x: belly.x, y: belly.y + 0.08 }, { x: 0, y: -1 });
    h.blood = 50;
    kit.advance(1.5);
    return h;
  };
  /**
   * Holds something over a limb by hand and lowers it slowly onto it (well under
   * stabbing speed), its bottom pressed `press` m into it, holding it there for
   * `hold` s. `half`: the limb's and the thing's half heights. Returns the
   * seconds until `done` came true (-1: it never did).
   */
  const lower = (e: Entity, target: Part, half: number, press: number, hold: number, done: () => boolean, keep = false): number => {
    const x0 = e.parts[0].x;
    const y0 = e.parts[0].y;
    const y1 = target.y + half - press;
    kit.down(x0, y0);
    let t = -1;
    const n = 60;
    for (let i = 1; i <= n + Math.round(hold * 60); i++) {
      kit.move(target.x, y0 + (y1 - y0) * Math.min(1, i / n));
      kit.advance(1 / 60);
      if (t < 0 && done()) t = i / 60;
    }
    if (!keep) kit.up(target.x, y1);
    return t;
  };
  /** A syringe pointing straight down over a limb, pushed slowly into it by hand. */
  const pushIn = (id: string, target: Part, half: number): { s: Syringe; t: number } => {
    const s = kit.spawn(id, target.x, target.y + half + 0.7, { angle: -Math.PI / 2 }) as Syringe;
    kit.advance(0.02);
    // (its needle's point is 0.31 m ahead of its middle)
    const t = lower(s, target, half + 0.31, 0.05, 1, () => !!s.lodge || s.fill < 1);
    return { s, t };
  };
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  // (a call, so a check made earlier in a test doesn't narrow what it can be now)
  const standing = (h: Human) => h.state === 'stand';
  /** Sends someone walking to x and times it (as in creatures.ts): seconds, or what went wrong. */
  const walkTime = (h: Human, x: number): number | string => {
    h.goTo(x);
    let t = 0;
    while (t < 14 && Math.abs(torso(h).x - x) > 0.4) {
      kit.advance(0.1);
      t += 0.1;
      if (h.state !== 'stand') return `fell over walking to ${x} (${h.status()})`;
    }
    return Math.abs(torso(h).x - x) > 0.4 ? `only got to ${torso(h).x.toFixed(2)} of ${x} in 14 s` : t;
  };

  return [
    ['extra: medical: a healing syringe pushed slowly into someone hurt goes in and heals them (bones, bleeding, blood, the blood on them) and they get up', () => {
      kit.reset();
      const h = casualty();
      const fore = h.limbs.get('lowerArmF')!;
      const paint0 = painted(h);
      if (bleeding(h) < 0.3) return `setup: not bleeding (${bleeding(h).toFixed(2)})`;
      if (paint0 < 4) return `setup: only ${paint0} pixels of wounds and blood painted on them`;
      if (h.state === 'stand') return `setup: not lying down (${h.status()})`;
      const { s, t } = pushIn('syringe-healing', h.limbs.get('midTorso')!.part, 0.11);
      if (t < 0) return `pushed slowly into them, the needle never went in (lodged ${!!s.lodge}, fill ${s.fill.toFixed(2)})`;
      if (t > 2) return `the needle took ${t.toFixed(2)} s to go in`;
      kit.advance(1.5);
      if (s.fill > 0) return `healing syringe still ${Math.round(s.fill * 100)}% full 2.5 s after going in`;
      if (fore.broken) return 'the broken forearm was not mended';
      if (bleeding(h) > 0) return `still bleeding (${bleeding(h).toFixed(2)})`;
      if (h.blood < 95) return `blood only back to ${h.blood.toFixed(0)}%`;
      const paint1 = painted(h);
      if (paint1 > paint0 * 0.5) return `the blood was not washed off: ${paint0} painted pixels before, ${paint1} after`;
      for (let i = 0; i < 16 && !standing(h); i++) kit.advance(0.5);
      if (!standing(h)) return `healed, but not back on their feet 8 s later (${h.status()})`;
      return true;
    }],
    ['extra: medical: Use (F) on a knockout syringe held against someone injects them, and they drop asleep', () => {
      kit.reset();
      const h = human(0);
      h.stay(30);
      kit.advance(1);
      // (at the shoulders: lower, by their hand, they'd take it out of the drag instead)
      const body = h.limbs.get('upperTorso')!.part;
      // held against their back, its needle pointing away: only its plunger end touches them
      const s = kit.spawn('syringe-knockout', body.x - 0.55, body.y, { flip: true }) as Syringe;
      kit.advance(0.02);
      const x0 = s.main.x;
      kit.down(x0, s.main.y);
      for (let i = 1; i <= 30; i++) {
        kit.move(x0 + (body.x - 0.38 - x0) * (i / 30), body.y);
        kit.advance(1 / 60);
      }
      kit.advance(0.3);
      if (s.fill < 1 || s.lodge) return `it went in before Use (fill ${s.fill.toFixed(2)})`;
      kit.press('KeyF');
      kit.advance(0.3);
      kit.up(body.x - 0.38, body.y);
      kit.advance(1.5);
      if (s.fill > 0.05) return `Use on it against them pushed in only ${Math.round((1 - s.fill) * 100)}%`;
      if (!(h.drugs.knockout > 0)) return `no sedative in them (${h.status()})`;
      kit.advance(1);
      if (h.consciousness > 0.2 || h.state !== 'down') return `the knockout did not put them down (${h.status()})`;
      return true;
    }],
    ['extra: medical: someone holding a syringe who uses it (F) injects themselves', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const s = arm(h, 'syringe-healing') as unknown as Syringe | undefined;
      if (!s || s.def.id !== 'syringe-healing') return 'they did not take the syringe';
      h.blood = 60;
      controls.selection = new Set([h]);
      kit.press('KeyF');
      kit.advance(1.5);
      if (s.fill > 0.05) return `Use on them holding it pushed in only ${Math.round((1 - s.fill) * 100)}%`;
      if (h.blood < 95) return `their blood only got back to ${h.blood.toFixed(0)}%`;
      if (!h.heldItems().includes(s as never)) return 'they dropped the syringe';
      return true;
    }],
    ['extra: medical: an adrenaline syringe (used on themselves) has someone walking faster', () => {
      kit.reset();
      let h = human(0);
      kit.advance(1);
      const plain = walkTime(h, 5);
      if (typeof plain === 'string') return `without adrenaline: ${plain}`;
      kit.reset();
      h = human(0);
      kit.advance(1);
      const s = arm(h, 'syringe-adrenaline') as unknown as Syringe | undefined;
      if (!s) return 'they did not take the syringe';
      h.activate();
      kit.advance(1.5);
      if (s.fill > 0.05) return `the adrenaline did not go in (${Math.round(s.fill * 100)}% left)`;
      if (!(h.rush > 1.5)) return `a syringe of adrenaline: rush only ${h.rush.toFixed(2)} (${h.status()})`;
      h.dropAll();
      // (the empty syringe at their feet would be kicked along, or trip them: not what's timed)
      game.remove(s as unknown as Entity);
      kit.advance(0.5);
      const fast = walkTime(h, torso(h).x + 5);
      if (typeof fast === 'string') return `on adrenaline: ${fast}`;
      if (fast > plain * 0.85) return `5 m took ${fast.toFixed(1)} s on adrenaline, ${plain.toFixed(1)} s without`;
      return true;
    }],
    ['extra: medical: someone on adrenaline running away runs faster, and stays on their feet', () => {
      // (asked to run faster than their legs can carry them, they used to go over)
      const flee = (dose: number): number | string => {
        kit.reset();
        const h = human(0);
        kit.advance(1);
        if (dose) h.inject('adrenaline', dose);
        kit.advance(0.5);
        const c = torso(h);
        h.onAlarm(c.x - 1, c.y, 8);
        kit.advance(1);
        const x0 = torso(h).x;
        for (let i = 0; i < 30; i++) {
          kit.advance(0.1);
          if (!standing(h)) return `fell running away${dose ? ' on adrenaline' : ''} (${h.status()})`;
        }
        return (torso(h).x - x0) / 3;
      };
      const plain = flee(0);
      if (typeof plain === 'string') return plain;
      if (plain < 1.2) return `setup: ran away at only ${plain.toFixed(2)} m/s`;
      const fast = flee(1);
      if (typeof fast === 'string') return fast;
      if (fast < plain * 1.1) return `ran away at ${fast.toFixed(2)} m/s on adrenaline, ${plain.toFixed(2)} m/s without`;
      return true;
    }],
    ['extra: medical: a life syringe brings the dead back, healed', () => {
      kit.reset();
      const h = casualty();
      h.die();
      kit.advance(1);
      if (h.alive) return 'setup: still alive';
      const { t } = pushIn('syringe-life', h.limbs.get('midTorso')!.part, 0.11);
      if (t < 0) return 'the life syringe never went in';
      kit.advance(1);
      if (!h.alive) return `the life syringe did not revive them (${h.status()})`;
      if (h.limbs.get('lowerArmF')!.broken || bleeding(h) > 0) return `revived but not healed (${h.status()}, bleeding ${bleeding(h).toFixed(2)})`;
      for (let i = 0; i < 16 && !standing(h); i++) kit.advance(0.5);
      if (!standing(h)) return `revived, but not back on their feet 8 s later (${h.status()})`;
      return true;
    }],
    ['extra: medical: a first aid kit dragged onto someone hurt patches them up over a few seconds, and has uses left', () => {
      kit.reset();
      const h = casualty();
      // (out cold: awake, they'd take the kit in hand as it came past it, as anyone takes what's dragged into their hand)
      h.inject('knockout', 1);
      kit.advance(0.5);
      const k = kit.spawn('first-aid-kit', torso(h).x, torso(h).y + 0.9) as FirstAidKit;
      kit.advance(0.02);
      // (half its 13 px height, and half the torso's)
      lower(k, h.limbs.get('midTorso')!.part, 0.11 + 0.2, 0.04, 0.3, () => k.uses < 3);
      if (k.uses !== 2) return `dragged onto them it was used ${3 - k.uses} times`;
      kit.advance(3.5);
      if (h.limbs.get('lowerArmF')!.broken) return 'the broken forearm was not mended';
      if (bleeding(h) > 0) return `still bleeding (${bleeding(h).toFixed(2)})`;
      if (h.blood < 90) return `blood only back to ${h.blood.toFixed(0)}%`;
      if (k.uses !== 2) return `${k.uses} uses left after seeing to one person`;
      return true;
    }],
    ['extra: medical: a bandage dragged onto a bleeding shin stops it bleeding and stays wrapped round it', () => {
      kit.reset();
      // lying out cold (so they don't get up and walk off with the leg)
      const h = kit.spawn('human', 0, 0.4, { angle: Math.PI / 2 }) as Human;
      h.inject('knockout', 1);
      kit.advance(1.5);
      const shin = h.limbs.get('lowerLegF')!;
      h.damage(shin.part, 20, 'stab', { x: shin.part.x, y: shin.part.y + 0.03 }, { x: 0, y: -1 });
      kit.advance(0.5);
      const rate = shin.wounds.reduce((s, w) => s + w.rate, 0);
      if (rate < 0.2) return `setup: the shin is not bleeding (${rate.toFixed(2)})`;
      // lowered onto it from above (the roll's bottom 4.5 px below its middle, and half the shin's 3.5 px)
      const b = kit.spawn('bandage', shin.part.x, shin.part.y + 0.8) as Bandage;
      kit.advance(0.02);
      lower(b, shin.part, 0.055 + 0.14, 0.04, 0.3, () => b.destroyed);
      if (!b.destroyed) return `the bandage was not wrapped on (${h.heldItems().includes(b as never) ? 'they took it in hand' : 'still lying about'})`;
      if (shin.wounds.length) return `the shin still has ${shin.wounds.length} wounds`;
      if (gauzeOn(shin.part) < 3) return `no bandage to be seen on the shin (${gauzeOn(shin.part)} pixels)`;
      kit.advance(2);
      if (shin.wounds.some((w) => w.rate > 0)) return 'the shin bleeds again';
      if (gauzeOn(shin.part) < 3) return 'the bandage came off';
      return true;
    }],
    ['extra: medical: a defibrillator, charged and held to someone just dead, brings them back', () => {
      kit.reset();
      const h = kit.spawn('human', 0, 0.4, { angle: Math.PI / 2 }) as Human;
      kit.advance(1.5);
      h.die();
      kit.advance(1);
      const chest = torso(h);
      const d = kit.spawn('defibrillator', chest.x, chest.y + 0.9) as Defibrillator;
      kit.advance(0.02);
      // pressed onto their chest (its bottom 4.5 px below its middle, and half the chest's 8 px), and switched on
      lower(d, chest, 0.125 + 0.14, 0.05, 0.3, () => false, true);
      const state = () => d.state;
      kit.press('KeyF');
      kit.advance(1);
      if (state() !== 'charging') return `Use did not charge it (${state()})`;
      if (h.alive) return 'it shocked them before it had charged';
      kit.advance(2);
      kit.up(chest.x, chest.y + 0.215);
      if (state() !== 'flat') return `charged and held to them, it did not go off (${state()})`;
      if (!h.alive) return `the shock did not bring them back (${h.status()})`;
      kit.advance(4);
      if (!h.alive) return `brought back, they died again (${h.status()})`;
      return true;
    }],
    ['extra: medical: animals mend too: a healing syringe in a hurt dog\'s back; poison turns them green until healed', () => {
      kit.reset();
      const dog = kit.spawn('dog', 0, 0.6) as Creature;
      dog.stay(60);
      kit.advance(1.5);
      const leg = dog.limbs.get('upperFrontF')!;
      leg.broken = true;
      const back = dog.limbs.get('chest')!.part;
      dog.damage(back, 20, 'stab', { x: back.x, y: back.y + 0.1 }, { x: 0, y: -1 });
      dog.blood = 55;
      // (let it settle, standing or fallen: stabbed, it bolts for a few seconds first)
      kit.advance(1.5);
      for (let i = 0; i < 20 && /running/.test(dog.status()); i++) kit.advance(0.25);
      if (bleeding(dog) < 0.2) return `setup: the dog is not bleeding (${dog.status()})`;
      const { s, t } = pushIn('syringe-healing', back, 0.14);
      if (t < 0) return `pushed slowly into the dog, the needle never went in (fill ${s.fill.toFixed(2)})`;
      kit.advance(1.5);
      if (leg.broken || bleeding(dog) > 0 || dog.blood < 95) return `the dog was not healed (${dog.status()}, leg ${leg.broken ? 'broken' : 'mended'}, bleeding ${bleeding(dog).toFixed(2)})`;
      // poisoned (a person, then the dog), the skin goes green; healing clears it
      for (const e of [human(3), dog] as (Human | Creature)[]) {
        kit.advance(0.5);
        e.inject('poison', 1);
        kit.advance(1);
        const p = e.parts[0];
        if (!(p.sprite.g > p.sprite.r + 0.05)) return `${e.def.id} poisoned, but not green (tint ${p.sprite.r.toFixed(2)}, ${p.sprite.g.toFixed(2)}, ${p.sprite.b.toFixed(2)})`;
        e.inject('healing', 1);
        kit.advance(0.2);
        if (p.sprite.r < 0.99 || e.drugs.poison > 0) return `${e.def.id} healed, but still poisoned or green (${e.status()}, red ${p.sprite.r.toFixed(2)})`;
      }
      return true;
    }],
  ];
}

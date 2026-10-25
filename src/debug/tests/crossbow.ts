import type { Test, TestCtx } from './types';
import type { Human } from '../../entities/Human';
import type { Part } from '../../world/Part';
import type { Entity } from '../../world/Entity';
import { Crossbow, Bolt, type BoltKind } from '../../entities/Crossbow';
import { crossbowArt, BOLT_ON_BOW, BOLT_W } from '../../art/crossbow';
import { saveToString, loadFromString } from '../../world/SaveLoad';

/** The crossbow and its bolts. */
export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  const hp = (h: Human) => h.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  const torso = (h: Human) => h.limbs.get('upperTorso')!.part;
  const bolts = () => game.entities.filter((e): e is Bolt => e instanceof Bolt && !e.destroyed);
  const bows = () => game.entities.filter((e): e is Crossbow => e instanceof Crossbow && !e.destroyed);
  /** The bolts stuck in something of `e`'s. */
  const stuckIn = (e: Entity) => bolts().filter((b) => b.state === 'stuck' && b.target?.entity === e);
  /** (read fresh: a shot is fired by calls the type checker can't see into) */
  const shots = (c: Crossbow) => c.shots;
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
  /** A crossbow frozen in mid-air `gap` m to the left of `part`, its groove level with the part's middle, loaded with `kind`. */
  const aimAt = (part: Part, gap: number, kind: BoltKind): Crossbow => {
    const c = kit.spawn('crossbow', part.x - gap, part.y) as Crossbow;
    const groove = c.main.pixelToWorld(BOLT_ON_BOW[0] + (BOLT_W - 1) / 2, BOLT_ON_BOW[1] + 1);
    c.translate(0, part.y - groove.y);
    c.setFrozen(true);
    c.load(kind);
    return c;
  };
  return [
    ['extra: crossbow: a held crossbow shoots a bolt that sticks in a person and hurts them; no second shot until it is cocked again', () => {
      kit.reset();
      const a = human(-2);
      const b = human(2, { flip: true });
      kit.advance(1);
      const c = arm(a, 'crossbow');
      if (!(c instanceof Crossbow)) return `could not hand them the crossbow (holding ${c?.def.id ?? 'nothing'})`;
      kit.advance(0.5);
      if (!c.loaded) return 'handed over unloaded';
      const loadedArt = crossbowArt(2, 'normal');
      if (c.main.art !== loadedArt) return 'loaded, it does not show the string drawn and a bolt in the groove';
      const hp0 = hp(b);
      a.activate();
      if (shots(c) !== 1 || bolts().length !== 1) return `Use in hand: ${c.shots} shots, ${bolts().length} bolts`;
      if (c.loaded) return 'still loaded after a shot';
      if (c.main.art === loadedArt) return 'shot, it still shows a bolt in the groove';
      a.activate();
      if (shots(c) !== 1 || bolts().length !== 1) return `shot again straight away (${c.shots} shots, ${bolts().length} bolts)`;
      const t = until(() => stuckIn(b).length > 0, 0.6);
      const bolt = bolts()[0];
      if (!Number.isFinite(t)) {
        return bolt
          ? `in 0.6 s the bolt did not stick in them: ${bolt.state} at (${bolt.main.x.toFixed(2)}, ${bolt.main.y.toFixed(2)}), ${Math.hypot(bolt.main.vx, bolt.main.vy).toFixed(1)} m/s; their middle at (${torso(b).x.toFixed(2)}, ${torso(b).y.toFixed(2)})`
          : 'the bolt is gone';
      }
      if (hp(b) > hp0 - 20) return `stuck in them, it took only ${(hp0 - hp(b)).toFixed(1)} hp off`;
      // part way through cocking: not loaded, and Use does nothing
      const left = c.reload;
      kit.advance(left / 2);
      if (c.loaded) return `loaded again ${(1 / c.gun.rate - left / 2).toFixed(2)} s into a ${(1 / c.gun.rate).toFixed(2)} s cocking`;
      a.activate();
      if (shots(c) !== 1) return 'Use half way through cocking shot it';
      const r = until(() => c.loaded, 1 / c.gun.rate);
      if (!Number.isFinite(r)) return `not loaded again ${(1 / c.gun.rate).toFixed(2)} s after the shot`;
      if (c.main.art !== loadedArt) return 'cocked again, it does not show the string drawn and a bolt in the groove';
      a.activate();
      if (shots(c) !== 2) return 'cocked again, Use did not shoot it';
      // still stuck in them a second later, moving with them
      kit.advance(1);
      const s = stuckIn(b)[0];
      if (!s) return 'the bolt came out of them';
      const q = s.target!;
      const d = Math.hypot(s.main.x - q.x, s.main.y - q.y);
      if (d > 0.45) return `the stuck bolt is ${d.toFixed(2)} m from the middle of the ${q.name} it is stuck in`;
      return true;
    }],
    ['extra: crossbow: bolts glance off or break on steel, and stick in wood', () => {
      kit.reset();
      const box = kit.spawn('metal-box', 3, 0.5);
      const crate = kit.spawn('crate', -3, 0.45);
      kit.advance(0.8);
      aimAt(box.parts[0], 3, 'normal').fire();
      kit.advance(0.4);
      if (bolts().some((b) => b.state === 'stuck')) return 'a bolt stuck in a steel box';
      aimAt(crate.parts[0], 3, 'normal').fire();
      if (!Number.isFinite(until(() => stuckIn(crate).length > 0, 0.4))) return 'a bolt shot square at a wooden crate did not stick in it';
      return true;
    }],
    ['extra: crossbow: a poisoned bolt poisons, a tranquilizer dart knocks out, hardly hurting', () => {
      for (const kind of ['poison', 'tranquilizer'] as BoltKind[]) {
        kit.reset();
        const h = human(2);
        kit.advance(1);
        const hp0 = hp(h);
        aimAt(torso(h), 3, kind).fire();
        if (!Number.isFinite(until(() => stuckIn(h).length > 0, 0.3))) return `a ${kind} bolt did not stick in them (${bolts()[0]?.state ?? 'gone'})`;
        if (kind === 'poison') {
          if (h.drugs.poison < 20) return `hit by a poisoned bolt: ${h.drugs.poison.toFixed(1)} s of poison in them`;
          continue;
        }
        if (h.drugs.knockout < 20) return `hit by a tranquilizer dart: ${h.drugs.knockout.toFixed(1)} s of sedative in them`;
        if (hp(h) < hp0 - 15) return `a tranquilizer dart took ${(hp0 - hp(h)).toFixed(1)} hp off`;
        kit.advance(1.5);
        if (!h.alive) return 'a tranquilizer dart killed them';
        if (h.consciousness > 0.3) return `1.5 s after a tranquilizer dart, consciousness ${h.consciousness.toFixed(2)}`;
      }
      return true;
    }],
    ['extra: crossbow: an explosive bolt goes off where it hits; an incendiary one sets what it sticks in alight', () => {
      kit.reset();
      const h = human(2);
      kit.advance(1);
      const hp0 = hp(h);
      const ex = game.explosions;
      const explode = ex.explode;
      const blasts: { x: number; y: number }[] = [];
      ex.explode = (x, y, o, delay) => {
        blasts.push({ x, y });
        return explode.call(ex, x, y, o, delay);
      };
      try {
        const t = torso(h);
        const at = { x: t.x, y: t.y };
        aimAt(t, 3.5, 'explosive').fire();
        kit.advance(0.3);
        if (!blasts.length) return `no blast (the bolt is ${bolts()[0]?.state ?? 'gone'})`;
        const d = Math.hypot(blasts[0].x - at.x, blasts[0].y - at.y);
        if (d > 0.6) return `it went off ${d.toFixed(2)} m from the middle of the person it was shot at`;
        if (bolts().length) return 'the explosive bolt is still there after going off';
        if (hp(h) > hp0 - 30) return `the blast took only ${(hp0 - hp(h)).toFixed(1)} hp off them`;
      } finally {
        // (the class's own again: a copy left on the instance looks like someone's hook)
        delete (ex as { explode?: unknown }).explode;
      }
      kit.reset();
      const crate = kit.spawn('crate', 2, 0.45);
      kit.advance(0.8);
      aimAt(crate.parts[0], 3, 'incendiary').fire();
      if (!Number.isFinite(until(() => stuckIn(crate).length > 0, 0.3))) return `an incendiary bolt did not stick in a crate (${bolts()[0]?.state ?? 'gone'})`;
      kit.advance(0.5);
      const p = crate.parts[0];
      if (p.destroyed) return 'the crate broke';
      if (p.burning < 0.2) return `0.5 s after an incendiary bolt stuck in it, the crate burns ${p.burning.toFixed(2)}`;
      return true;
    }],
    ['extra: crossbow: the kind of bolt picked in the menu, and a bolt stuck in someone, survive save, load and duplicate', () => {
      kit.reset();
      const h = human(2);
      kit.advance(1);
      const c = aimAt(torso(h), 3, 'normal');
      const pick = c.contextActions().find((a) => a.label === 'Bolts: Poison');
      if (!pick) return `no Bolts: Poison in its menu (${c.contextActions().map((a) => a.label).join(', ')})`;
      pick.action();
      if (c.bolt !== 'poison' || !c.contextActions().find((a) => a.label === 'Bolts: Poison')?.checked) return `picked Poison, it is loaded with ${c.bolt}`;
      c.fire();
      if (!Number.isFinite(until(() => stuckIn(h).length > 0, 0.3))) return 'the bolt did not stick in them';
      kit.advance(0.2);
      loadFromString(game, saveToString(game));
      const c2 = bows()[0];
      if (!c2) return 'loading lost the crossbow';
      if (c2.bolt !== 'poison') return `loaded, it is set to ${c2.bolt} bolts`;
      if (c2.loaded) return 'loaded mid-cocking, it has a bolt in at once';
      const h2 = game.entities.find((e) => e.def.id === 'human') as Human | undefined;
      if (!h2) return 'loading lost the person';
      const s = stuckIn(h2)[0];
      if (!s) return `loaded, the bolt is no longer stuck in them (${bolts().map((b) => b.state).join(', ')})`;
      if (s.kind !== 'poison') return `loaded, the stuck bolt is a ${s.kind} one`;
      kit.advance(1);
      const q = s.target;
      if (!q || Math.hypot(s.main.x - q.x, s.main.y - q.y) > 0.45) return 'a second after loading, the bolt has come away from them';
      if (!Number.isFinite(until(() => c2.loaded, 1.5))) return 'the loaded crossbow never finished cocking';
      controls.duplicate([c2]);
      kit.advance(0.2);
      const all = bows();
      if (all.length !== 2) return `duplicating made ${all.length} crossbows`;
      if (!all.every((x) => x.bolt === 'poison')) return `the copy is set to ${all.map((x) => x.bolt).join(' and ')} bolts`;
      return true;
    }],
    ['extra: crossbow: someone set on a foe with a crossbow shoots them', () => {
      kit.reset();
      const a = human(-3);
      const b = human(3, { flip: true });
      kit.advance(1);
      const c = arm(a, 'crossbow');
      if (!(c instanceof Crossbow)) return 'could not hand them the crossbow';
      torso(b).setFrozen(true);
      const hp0 = hp(b);
      a.fight(b, false);
      let t = 0;
      for (; t < 6 && !stuckIn(b).length; t += 0.25) kit.advance(0.25);
      if (shots(c) < 1) return `in 6 s of fighting they never shot (${a.status()})`;
      if (!stuckIn(b).length) return `${c.shots} shots in 6 s, none stuck in the foe (bolts: ${bolts().map((x) => `${x.state} at ${x.main.x.toFixed(1)},${x.main.y.toFixed(1)}`).join('; ')})`;
      if (hp(b) > hp0 - 20) return `a bolt stuck in the foe, but took only ${(hp0 - hp(b)).toFixed(1)} hp off`;
      return true;
    }],
    ['extra: crossbow: firework bolts (from its menu) burst on whoever they hit, singeing them; shot at nothing, one bursts high up a moment into its flight', () => {
      kit.reset();
      const h = human(2);
      kit.advance(1);
      const hp0 = hp(h);
      const c = aimAt(torso(h), 3.5, 'normal');
      const pick = c.contextActions().find((x) => x.label === 'Bolts: Firework');
      if (!pick) return `the crossbow's menu has no firework bolts (${c.contextActions().map((x) => x.label).join(', ')})`;
      pick.action();
      if (c.bolt !== 'firework') return `picked from the menu, it's loaded with ${c.bolt} bolts`;
      c.fire();
      const bolt = bolts()[0];
      if (!bolt || bolt.kind !== 'firework') return `shot, there's no firework bolt (${bolt?.kind ?? 'none'})`;
      const hit = until(() => bolt.destroyed, 0.5);
      if (!Number.isFinite(hit)) return `0.5 s after it was shot 3.5 m at someone, the firework bolt is still there (${bolt.state})`;
      kit.advance(0.2);
      if (hp(h) >= hp0 - 1) return `the burst took only ${(hp0 - hp(h)).toFixed(1)} hp off whoever it hit`;
      // up into the air, at nothing
      kit.reset();
      const up = kit.spawn('crossbow', 0, 2, { angle: 1.1 }) as Crossbow;
      up.setFrozen(true);
      up.load('firework');
      up.fire();
      const b2 = bolts()[0];
      let top = -Infinity;
      const t = until(() => {
        if (!b2.destroyed) top = Math.max(top, b2.main.y);
        return b2.destroyed;
      }, 2);
      if (!Number.isFinite(t)) return 'shot at nothing, the firework bolt never burst';
      if (t < 0.4 || t > 0.8) return `shot at nothing, it burst ${t.toFixed(2)} s into its flight`;
      if (top < 10) return `shot upward, it got only ${(top - 2).toFixed(1)} m up before bursting`;
      return true;
    }],
    ['extra: crossbow: past a couple of dozen spent bolts, the oldest are taken away', () => {
      kit.reset();
      const crate = kit.spawn('crate', 2, 0.45);
      kit.advance(0.8);
      const c = aimAt(crate.parts[0], 2.5, 'normal');
      // (weak bolts: 32 full-power ones would break the crate they're shot into)
      c.gun.damage = 5;
      for (let i = 0; i < 32; i++) {
        c.loaded = true;
        c.fire();
        kit.advance(0.05);
      }
      kit.advance(0.5);
      const n = bolts().length;
      if (n > 26) return `${n} bolts left in the scene after 32 shots`;
      if (n < 10) return `only ${n} bolts left after 32 shots`;
      return true;
    }],
  ];
}

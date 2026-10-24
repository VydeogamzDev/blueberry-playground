import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Flask } from '../../entities/Flask';
import { capture, instantiate } from '../../world/Snapshot';
import { Liquid } from '../../systems/Liquids';

/** Regression tests for bugs found in the simulation (one per fix). */
export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  /** Strands of flesh a body's torn-out limbs hang on by. */
  const strands = (h: Human) => (h as unknown as { tendons: { count: number } | null }).tendons?.count ?? 0;
  /** Who they're fighting (read through this, the checks don't narrow it for the rest of the test). */
  const foeOf = (h: Human): Entity | null => h.foe;

  return [
    ['extra: bugs: a copy of someone whose arm was cut off with a torn-out forearm hanging from it has one strand, not two', () => {
      kit.reset();
      const h = human(0);
      kit.advance(0.5);
      // the forearm wrenched out (hanging from the upper arm), then the upper arm cut off clean
      h.rupture(h.limbs.get('lowerArmF')!);
      h.sever(h.limbs.get('upperArmF')!, 'cut');
      if (strands(h) !== 1) return `before copying: ${strands(h)} strands (wanted 1)`;
      const h2 = instantiate(game, capture(game, [h]), { dx: 3 })[0] as Human | undefined;
      if (!h2) return 'could not copy them';
      const upper = h2.limbs.get('upperArmF')!;
      const fore = h2.limbs.get('lowerArmF')!;
      if (!upper.severed || !fore.severed) return `copied: upper arm severed ${upper.severed}, forearm ${fore.severed}`;
      // (the cut-off upper arm came back tied to the shoulder by flesh too)
      if (strands(h2) !== 1) return `copied: ${strands(h2)} strands (wanted 1: the forearm's)`;
      return true;
    }],
    ['extra: bugs: two people fighting, flipped together, fight on', () => {
      kit.reset();
      const a = human(-1);
      const b = human(1, { flip: true });
      kit.advance(0.5);
      if (!a.fight(b)) return 'could not set them fighting';
      kit.advance(0.2);
      if (foeOf(a) !== b || foeOf(b) !== a) return 'they were not fighting each other';
      const [a2, b2] = game.flipEntities([a, b]) as Human[];
      if (!a2 || !b2) return 'could not flip them';
      if (foeOf(a2) !== b2 || foeOf(b2) !== a2) {
        return `flipped: A is fighting ${foeOf(a2) === b2 ? 'B' : foeOf(a2) ? 'something else' : 'nobody'}, B ${foeOf(b2) === a2 ? 'A' : foeOf(b2) ? 'something else' : 'nobody'}`;
      }
      return true;
    }],
    ['extra: bugs: ground laid over a burning oil puddle takes it under: none left there, burning or seeping out', () => {
      kit.reset();
      const pu = game.puddles;
      pu.add(Liquid.Oil, 0, 30);
      kit.advance(1);
      if (pu.total < 10) return `the oil puddle is only ${pu.total.toFixed(1)} px²`;
      pu.igniteNear(0, 0.5);
      if (!pu.burningCells) return 'the oil did not light';
      // (the Terrain tool's way of changing the ground under a scene)
      game.reshapeMap({ ...game.map, id: 'custom:bugs', name: 'Bugs', terrain: [{ pts: [[-2, 0], [2, 0], [2, 1], [-2, 1]], mat: 'rock' }] });
      if (!game.env.solidAt(0, 0.5)) return 'the block of ground was not built';
      if (pu.total > 0.01 || pu.burningCells) return `under the new ground: ${pu.total.toFixed(1)} px² of oil, ${pu.burningCells} cells burning`;
      kit.advance(0.5);
      if (pu.total > 0.01) return `after 0.5 s, ${pu.total.toFixed(1)} px² of oil on the floor`;
      return true;
    }],
    ['extra: bugs: a fuse cord burning on from a blown-up end, copied, lies loose (not tied to the background)', () => {
      kit.reset();
      const [a, b] = [-2, 2].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.5);
      const pa = a.parts[0];
      const pb = b.parts[0];
      const cord = game.connections.create('fuse', pa, { x: pa.x, y: pa.y }, pb, { x: pb.x, y: pb.y });
      if (!cord) return 'could not lay the cord';
      // as when what's at its end blows up: lit there, and let go of it
      game.connections.lightFrom(a);
      if (cord.b || cord.joint || !cord.burn) return 'the cord was not let go of, burning, at the blown-up end';
      const copy = instantiate(game, capture(game, [b]), { dx: 6 })[0];
      const c2 = game.connections.list.find((k) => k.kind === 'fuse' && k.a.entity === copy);
      if (!copy || !c2) return 'the copy has no fuse cord';
      if (c2.joint) return 'the copied cord is tied to the background where its loose end lay';
      if (!c2.burn) return 'the copied cord is not burning';
      return true;
    }],
    ['extra: bugs: collision switched off and on again (N) for someone who has lost a limb: no crash, and it reads right', () => {
      kit.reset();
      const h = human(0);
      kit.advance(0.5);
      h.gib(h.limbs.get('lowerArmF')!);
      if (!h.parts.some((p) => p.destroyed)) return 'the forearm was not blown off';
      // (read through this, the checks don't narrow it for the rest of the test)
      const off = (): boolean => h.noCollide;
      try {
        // as N (or Disable collision in the menu) does it
        controls.setNoCollide([h], !off());
        if (!off()) return 'collision was not switched off';
        kit.advance(0.2);
        controls.setNoCollide([h], !off());
        if (off()) return 'collision was not switched back on';
        if (h.parts.some((p) => !p.destroyed && p.noCollideAll)) return 'a part still has collision off';
        kit.advance(0.2);
      } catch (err) {
        return `it threw: ${String(err)}`;
      }
      return true;
    }],
    ['extra: bugs: a flask hit twice in one step (a shotgun\'s pellets) breaks once: one splash of what it held', () => {
      kit.reset();
      const f = kit.spawn('flask-water', 0, 1.5) as Flask;
      f.setFrozen(true);
      kit.advance(0.3);
      // two hits inside the same step, when it's only taken away at the end of it
      let made = -1;
      const hit = () => {
        if (made >= 0 || f.destroyed) return;
        const n0 = game.particles.count;
        f.onBullet();
        f.onBullet();
        made = game.particles.count - n0;
      };
      game.preStepHandlers.push(hit);
      try {
        game.step();
      } finally {
        game.preStepHandlers.splice(game.preStepHandlers.indexOf(hit), 1);
      }
      if (made < 0) return 'it was never hit';
      if (!f.destroyed) return 'the flask is still there after the step';
      // (a full flask splashes 220 drops, and a few bits of glass)
      if (made > 330) return `${made} drops and bits from the two hits: it broke twice`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Explosive } from '../../entities/Explosive';
import type { Nuke } from '../../entities/Nuke';
import type { Part } from '../../world/Part';
import { FUSE_SPEED, type Connection } from '../../systems/Connections';
import { nukeRadius } from '../../systems/Explosions';
import { saveToString, loadFromString } from '../../world/SaveLoad';

export default function tests({ game, controls, kit, human, arm }: TestCtx): Test[] {
  void arm;
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
  /** A fuse cord from one part's middle to another's. */
  const lay = (p: Part, q: Part): Connection | null => game.connections.create('fuse', p, { x: p.x, y: p.y }, q, { x: q.x, y: q.y });
  return [
    ['extra: explosives: the round bomb goes off when its fuse has burnt down, not before', () => {
      kit.reset();
      const b = kit.spawn('bomb', 0, 0.4) as Explosive;
      kit.advance(0.5);
      const fuse = b.blast.fuse;
      const full = b.fuseLeft;
      b.activate();
      kit.advance(fuse / 2);
      if (b.destroyed) return `went off ${(fuse / 2).toFixed(1)} s into a ${fuse} s fuse`;
      const half = b.fuseLeft;
      if (!(half < full && half > 0)) return `the drawn fuse did not burn down: ${full} pixels at first, ${half} halfway`;
      const t = until(() => b.destroyed, fuse);
      if (!Number.isFinite(t)) return `still there ${(fuse * 1.5).toFixed(1)} s after lighting a ${fuse} s fuse`;
      if (Math.abs(fuse / 2 + t - fuse) > 0.1) return `went off ${(fuse / 2 + t).toFixed(2)} s after lighting a ${fuse} s fuse`;
      return true;
    }],
    ['extra: explosives: a fuse cord lit at one end burns down to a bomb and sets it off', () => {
      kit.reset();
      const crate = kit.spawn('crate', -4, 0.45);
      const bomb = kit.spawn('c4', 2, 0.2) as Explosive;
      kit.advance(0.5);
      const a = crate.parts[0];
      const b = bomb.parts[0];
      // laid with the Fuse tool, then lit by clicking its end with it
      controls.setTool('fuse');
      kit.down(a.x, a.y);
      kit.move(b.x, b.y);
      kit.up(b.x, b.y);
      const cord = game.connections.list.find((c) => c.kind === 'fuse');
      if (!cord) return 'the Fuse tool laid no cord';
      kit.down(a.x, a.y);
      kit.up(a.x, a.y);
      controls.setTool('drag');
      if (!cord.burn) return 'clicking the cord with the Fuse tool did not light it';
      if (cord.burn.lo > 0 || cord.burn.hi > 0.05) return `lit at ${cord.burn.lo.toFixed(2)}..${cord.burn.hi.toFixed(2)} of the way along, not at the crate's end`;
      const expect = cord.rest / FUSE_SPEED;
      const t = until(() => bomb.destroyed, expect + 2);
      if (!Number.isFinite(t)) return `the bomb never went off (a ${cord.rest.toFixed(2)} m cord, burnt ${(cord.burn?.hi ?? 1).toFixed(2)} of the way)`;
      if (Math.abs(t - expect) > 0.25) return `went off after ${t.toFixed(2)} s; a ${cord.rest.toFixed(2)} m cord should take ${expect.toFixed(2)} s`;
      return true;
    }],
    ['extra: explosives: bombs chained by fuse cords go off one after another', () => {
      kit.reset();
      // 7 m apart: out of each other's blasts (6 m), so only the cords can set them off
      const bombs = [-9, -2, 5].map((x) => kit.spawn('c4', x, 0.2) as Explosive);
      kit.advance(0.5);
      const cords: Connection[] = [];
      for (let i = 0; i < 2; i++) {
        const c = lay(bombs[i].parts[0], bombs[i + 1].parts[0]);
        if (!c) return 'could not lay a cord';
        cords.push(c);
      }
      bombs[0].activate();
      const when = [Infinity, Infinity, Infinity];
      let t = 0;
      while (t < 10 && bombs.some((b) => !b.destroyed)) {
        game.step();
        t += game.stepDt;
        bombs.forEach((b, i) => {
          if (b.destroyed && when[i] === Infinity) when[i] = t;
        });
      }
      const show = when.map((w) => (Number.isFinite(w) ? w.toFixed(2) : 'never')).join(', ');
      if (!(when[0] < when[1] && when[1] < when[2])) return `went off at ${show} s`;
      for (let i = 0; i < 2; i++) {
        const gap = when[i + 1] - when[i];
        const expect = cords[i].rest / FUSE_SPEED;
        if (Math.abs(gap - expect) > 0.3) return `went off at ${show} s: ${gap.toFixed(2)} s apart, where a ${cords[i].rest.toFixed(1)} m cord takes ${expect.toFixed(2)} s`;
      }
      return true;
    }],
    ['extra: explosives: fuse cords survive save and load, burning or not', () => {
      kit.reset();
      const [a, b, c] = [-3, 1, 5].map((x) => kit.spawn('crate', x, 0.45));
      kit.advance(0.5);
      const cold = lay(a.parts[0], b.parts[0]);
      const lit = lay(b.parts[0], c.parts[0]);
      if (!cold || !lit) return 'could not lay the cords';
      game.connections.light(lit, 0);
      kit.advance(0.5);
      const burnt = lit.burn?.hi ?? -1;
      if (!(burnt > 0.1 && burnt < 1)) return `the lit cord burnt ${burnt.toFixed(2)} of the way in 0.5 s`;
      const rest = cold.rest;
      loadFromString(game, saveToString(game));
      const fuses = game.connections.list.filter((k) => k.kind === 'fuse');
      if (fuses.length !== 2) return `${fuses.length} fuse cords after loading, not 2`;
      const unlit = fuses.find((k) => !k.burn);
      const burning = fuses.find((k) => k.burn);
      if (!unlit || !burning) return 'loading lost which cord was burning';
      if (Math.abs(unlit.rest - rest) > 1e-3) return `a ${unlit.rest.toFixed(3)} m cord after loading, was ${rest.toFixed(3)} m`;
      if (Math.abs(burning.burn!.hi - burnt) > 1e-3) return `burnt ${burning.burn!.hi.toFixed(3)} of the way after loading, was ${burnt.toFixed(3)}`;
      kit.advance(0.5);
      if (!(burning.burn && burning.burn.hi > burnt + 0.1)) return 'the loaded cord does not burn on';
      return true;
    }],
    ['extra: explosives: the thermonuclear bomb keeps its yield through save and load, and counts down', () => {
      kit.reset();
      const n0 = kit.spawn('nuke', 0, 0.4) as Nuke;
      kit.advance(0.3);
      const pick = (label: string) => {
        const act = n0.contextActions().find((x) => x.label === label);
        act?.action();
        return !!act;
      };
      if (!pick('Yield: 1 Mt') || !pick('Countdown: 5 s')) return `its menu lacks the yield or countdown (${n0.contextActions().map((x) => x.label).join(', ')})`;
      loadFromString(game, saveToString(game));
      const n = game.entities.find((e) => e.def.id === 'nuke') as Nuke | undefined;
      if (!n) return 'no bomb after loading';
      if (n.kt !== 1000 || n.countdown !== 5) return `loaded set to ${n.kt} kt and ${n.countdown} s, not 1 Mt and 5 s`;
      if (!n.contextActions().some((x) => x.label === 'Yield: 1 Mt' && x.checked)) return 'its menu does not tick the loaded yield';
      // (a small yield, for a quick check of the countdown)
      n.kt = 0.1;
      n.activate();
      kit.advance(4.8);
      if (n.destroyed) return 'went off before its countdown ran out';
      const t = until(() => n.destroyed, 1);
      game.explosions.clear();
      if (!Number.isFinite(t)) return 'did not go off when its countdown ran out';
      if (Math.abs(4.8 + t - 5) > 0.05) return `went off ${(4.8 + t).toFixed(2)} s into a 5 s countdown`;
      return true;
    }],
    ['extra: explosives: a small nuke wrecks what is near it and leaves what is far away untouched', () => {
      kit.reset();
      const near = human(4);
      const crate = kit.spawn('crate', -4, 0.45);
      const far = kit.spawn('crate', 40, 0.45);
      const farMan = human(-40);
      const n = kit.spawn('nuke', 0, 0.4) as Nuke;
      kit.advance(1);
      const fp = far.parts[0];
      const at = { x: fp.x, y: fp.y, hp: fp.hp };
      n.kt = 0.1;
      n.detonate();
      game.step();
      const white = game.explosions.whiteout;
      kit.advance(0.5);
      game.explosions.clear();
      const R = nukeRadius(0.1);
      if (white < 0.5) return `no blinding flash (the screen ${white.toFixed(2)} white)`;
      if (near.alive && !near.destroyed) return `the person 4 m away lived through a ${R.toFixed(0)} m blast (${near.status()})`;
      if (!crate.destroyed && crate.parts[0].charred < 0.5) return 'the crate 4 m away came through unharmed';
      const moved = Math.hypot(fp.x - at.x, fp.y - at.y);
      if (far.destroyed || moved > 0.02 || fp.charred > 0 || fp.burning > 0 || fp.hp < at.hp) {
        return `the crate 40 m away was touched by a ${R.toFixed(0)} m blast (moved ${moved.toFixed(3)} m, charred ${fp.charred.toFixed(2)}, hp ${fp.hp.toFixed(0)} of ${at.hp.toFixed(0)})`;
      }
      if (!farMan.alive || farMan.parts.some((p) => !p.destroyed && (p.charred > 0 || p.burning > 0))) return `the person 40 m away was hurt (${farMan.status()})`;
      return true;
    }],
    ['extra: explosives: a big nuke reaches much farther than a small one', () => {
      kit.reset();
      const far = kit.spawn('crate', 40, 0.45);
      const n = kit.spawn('nuke', 0, 0.4) as Nuke;
      kit.advance(1);
      const fp = far.parts[0];
      const x0 = fp.x;
      n.kt = 10000;
      n.detonate();
      kit.advance(1);
      game.explosions.clear();
      const R = nukeRadius(10000);
      if (R < nukeRadius(0.1) * 5) return `10 Mt reaches ${R.toFixed(0)} m, 0.1 kt ${nukeRadius(0.1).toFixed(0)} m`;
      if (!far.destroyed && Math.abs(fp.x - x0) < 0.5 && fp.charred === 0) return `the crate 40 m away was untouched by a ${R.toFixed(0)} m blast`;
      return true;
    }],
    ['extra: explosives: a 50 Mt blast over a busy scene keeps the steps short and nothing goes NaN', () => {
      kit.reset();
      for (let i = 0; i < 20; i++) kit.spawn(i % 2 ? 'metal-box' : 'crate', -60 + i * 6.3, 0.5 + (i % 3) * 1.2);
      for (const x of [-31.5, -19, 6, 25, 44]) human(x);
      const n = kit.spawn('nuke', 0, 0.4) as Nuke;
      kit.advance(1);
      n.kt = 50000;
      n.detonate();
      const t0 = performance.now();
      let last = t0;
      let worst = 0;
      game.advance(2, () => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
      });
      const total = performance.now() - t0;
      const left = game.explosions.nuclear;
      game.explosions.clear();
      const bad = game.entities.flatMap((e) => e.parts).find((p) => !p.destroyed && !(Number.isFinite(p.x) && Number.isFinite(p.y)));
      if (bad) return `a ${bad.entity.def.id} ended up at (${bad.x}, ${bad.y})`;
      if (worst > 250) return `a step took ${worst.toFixed(0)} ms (2 s took ${(total / 1000).toFixed(1)} s)`;
      if (total > 20000) return `2 s took ${(total / 1000).toFixed(1)} s`;
      if (left !== 1) return `${left} blasts still going after 2 s, not 1 (its cloud)`;
      return true;
    }],
  ];
}

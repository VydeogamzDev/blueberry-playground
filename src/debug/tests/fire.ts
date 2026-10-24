import type { Test, TestCtx } from './types';
import type { Creature } from '../../entities/Creature';
import type { Flask } from '../../entities/Flask';
import type { Bucket } from '../../entities/Bucket';
import type { Entity } from '../../world/Entity';
import type { Part } from '../../world/Part';
import { PX } from '../../engine/constants';
import { fromBase64 } from '../../engine/base64';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { Liquid } from '../../systems/Liquids';

export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const hp = (e: Entity) => e.parts.reduce((s, p) => s + (p.destroyed ? 0 : p.hp), 0);
  /** An uncorked flask held still upside down at (x, y), pouring. */
  const pour = (id: string, x: number, y: number): Flask => {
    const f = kit.spawn(id, x, y, { angle: Math.PI }) as Flask;
    f.setFrozen(true);
    f.activate();
    return f;
  };
  /** Advances up to `max` seconds until `done`; returns the time it took (Infinity if never). */
  const until = (max: number, done: () => boolean): number => {
    for (let t = 0; t < max; t += 0.25) {
      kit.advance(0.25);
      if (done()) return t + 0.25;
    }
    return Infinity;
  };
  /** Painted pixels of a part's sprite with solid pixels on all four sides (inside it, not on its outline) that are mostly red. */
  const bloodInside = (p: Part): number => {
    const data = p.paintData();
    if (!data) return 0;
    const b = fromBase64(data);
    let n = 0;
    for (let j = 0; j + 7 <= b.length; j += 7) {
      const i = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16);
      const x = (i % (p.w + 2)) - 1;
      const y = Math.floor(i / (p.w + 2)) - 1;
      const [r, g, bl] = [b[j + 3], b[j + 4], b[j + 5]];
      if (r < g + 30 || r < bl + 30) continue;
      if (p.solidAt(x, y) && p.solidAt(x - 1, y) && p.solidAt(x + 1, y) && p.solidAt(x, y - 1) && p.solidAt(x, y + 1)) n++;
    }
    return n;
  };

  return [
    ['extra: fire: a pig against a burning crate catches fire and is hurt by it', () => {
      kit.reset();
      const pig = kit.spawn('pig', 0, 0.6) as Creature;
      pig.contextActions().find((a) => a.label === 'Limp')?.action();
      kit.advance(1.5);
      // a crate held still just over it as it lies there (3 cm above its highest point)
      let top = -Infinity;
      let mid = 0;
      for (const p of pig.parts) {
        if (p.destroyed) continue;
        for (const c of p.colliders) {
          const q = c.projectPoint({ x: p.x, y: p.y + 5 }, true);
          if (q && q.point.y > top) {
            top = q.point.y;
            mid = q.point.x;
          }
        }
      }
      const crate = kit.spawn('crate', mid, top + 0.44 + 0.03).parts[0];
      crate.setFrozen(true);
      kit.advance(0.3);
      const hp0 = hp(pig);
      game.fire.ignite(crate, 1);
      const t = until(6, () => pig.parts.some((p) => p.burning > 0));
      if (!Number.isFinite(t)) return `pig just under a burning crate (burning ${crate.burning.toFixed(2)}, pig's top at ${top.toFixed(2)} m) did not catch fire in 6 s`;
      kit.advance(3);
      const lost = hp0 - hp(pig);
      if (lost < 1.5) return `pig caught fire after ${t.toFixed(2)} s but lost only ${lost.toFixed(1)} hp in the next 3 s`;
      const charred = Math.max(...pig.parts.map((p) => p.charred));
      if (charred <= 0) return 'burning pig not charred';
      return true;
    }],
    ['extra: fire: spreads from a burning plank to the one touching it', () => {
      kit.reset();
      const a = kit.spawn('plank', -1, 0.08).parts[0];
      const b = kit.spawn('plank', 1.02, 0.08).parts[0];
      kit.advance(0.3);
      game.fire.ignite(a, 1);
      const t = until(4, () => b.burning > 0);
      if (!Number.isFinite(t)) return `second plank (${(b.x - b.w * PX / 2 - (a.x + a.w * PX / 2)).toFixed(2)} m away) did not catch in 4 s; first burning ${a.burning.toFixed(2)}`;
      kit.advance(2);
      if (b.burning < 0.5) return `second plank caught after ${t.toFixed(2)} s but only burns at ${b.burning.toFixed(2)}`;
      return true;
    }],
    ['extra: fire: water puts a burning crate out, and it stays out while wet', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45).parts[0];
      kit.advance(0.3);
      game.fire.ignite(crate, 1);
      kit.advance(1);
      if (crate.burning < 0.5) return `crate barely burns (${crate.burning.toFixed(2)})`;
      pour('flask-water', 0, 2.2);
      kit.advance(3.5);
      if (crate.burning > 0 || game.fire.count) return `still burning after a flask of water (${crate.burning.toFixed(2)}, ${game.fire.count} fires)`;
      kit.advance(2);
      if (crate.burning > 0) return `flared up again (${crate.burning.toFixed(2)})`;
      return true;
    }],
    ['extra: fire: oil on the floor catches from a burning crate; oil-soaked wood burns faster', () => {
      kit.reset();
      pour('flask-oil', 0, 1.8);
      kit.advance(4);
      if (game.puddles.total < 20) return `oil puddle only ${game.puddles.total.toFixed(1)} px²`;
      const cells = (on: (x: number) => boolean) => {
        let n = 0;
        for (let x = -4; x < 4; x += PX) if (on(x)) n++;
        return n;
      };
      const slick = cells((x) => game.puddles.kindAt(x) === Liquid.Oil && game.puddles.amountAt(x) > 0.1);
      const crate = kit.spawn('crate', 0, 0.45).parts[0];
      kit.advance(0.5);
      game.fire.ignite(crate, 1);
      const t = until(2, () => game.puddles.burningCells > 0);
      if (!Number.isFinite(t)) return 'oil under a burning crate did not catch in 2 s';
      kit.advance(2);
      // out past the crate's ends (±0.44 m) along the puddle
      const lit = cells((x) => game.puddles.burningAt(x));
      if (lit < slick * 0.7) return `flames did not run along the oil: ${lit} of ${slick} cells burning`;
      // the same small flame on a dry crate and on one soaked in oil
      kit.reset();
      const dry = kit.spawn('crate', -2, 0.45).parts[0];
      const oily = kit.spawn('crate', 2, 0.45).parts[0];
      kit.advance(0.3);
      oily.oil = 1;
      game.fire.ignite(dry, 0.3);
      game.fire.ignite(oily, 0.3);
      kit.advance(0.5);
      const rise = [dry.burning, oily.burning];
      kit.advance(2.5);
      if (oily.burning <= 0 || dry.burning <= 0) return `went out: dry ${dry.burning.toFixed(2)}, oily ${oily.burning.toFixed(2)}`;
      if (rise[1] <= rise[0]) return `oil-soaked crate flared no faster (after 0.5 s: dry ${rise[0].toFixed(2)}, oily ${rise[1].toFixed(2)})`;
      if (oily.charred < dry.charred * 1.5) return `oil-soaked crate charred ${oily.charred.toFixed(3)} in 3 s, dry one ${dry.charred.toFixed(3)}`;
      return true;
    }],
    ['extra: blood: a shot to the torso bleeds onto the body, not just its outline', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const torso = h.limbs.get('upperTorso')!.part;
      // a bullet into its side, at the middle of its height
      const at = torso.colliders[0].projectPoint({ x: torso.x - 1, y: torso.y }, true);
      if (!at) return 'no torso edge';
      h.onBullet({ part: torso, point: { x: at.point.x, y: at.point.y }, normal: { x: -1, y: 0 }, dir: { x: 1, y: 0 }, energy: 300, damage: 18, exit: null });
      kit.advance(2.5);
      const n = bloodInside(torso);
      if (n < 4) return `only ${n} blood pixels inside the torso sprite (${torso.w}x${torso.h}); the rest are on its outline`;
      return true;
    }],
    ['extra: liquids: clearing the scene takes puddles, stains, drops and fire with it (and undo, loading bring them back)', () => {
      kit.reset();
      pour('flask-water', -2, 1.8);
      pour('flask-acid', 2, 1.8);
      const crate = kit.spawn('crate', 5, 0.45).parts[0];
      kit.advance(2);
      game.fire.ignite(crate, 1);
      game.stains.add(-4, 0.01, 0.5, 0, 0, 1);
      kit.advance(0.5);
      const scene = () => ({ puddle: game.puddles.total, stains: game.stains.capture().n, drops: game.particles.count, fire: game.fire.count, things: game.entities.length });
      const before = scene();
      if (before.puddle < 5 || !before.stains || !before.drops || !before.fire) return `no scene to clear: ${JSON.stringify(before)}`;
      const saved = saveToString(game);
      const btn = [...document.querySelectorAll<HTMLButtonElement>('button.tb-btn')].find((b) => b.title.startsWith('Clear'));
      if (!btn) return 'no clear button in the toolbar';
      btn.click();
      const empty = (s: ReturnType<typeof scene>) => !s.puddle && !s.stains && !s.drops && !s.fire && !s.things;
      if (!empty(scene())) return `clearing left ${JSON.stringify(scene())}`;
      kit.advance(0.5);
      if (!empty(scene())) return `half a second after clearing: ${JSON.stringify(scene())}`;
      controls.undo();
      const back = scene();
      if (Math.abs(back.puddle - before.puddle) > 2 || back.stains !== before.stains) return `undo gave ${JSON.stringify(back)}, was ${JSON.stringify(before)}`;
      controls.redo();
      if (!empty(scene())) return `redo left ${JSON.stringify(scene())}`;
      const none = saveToString(game);
      loadFromString(game, saved);
      if (game.puddles.total < 5) return `loading lost the puddles (${game.puddles.total.toFixed(1)} px²)`;
      loadFromString(game, none);
      if (!empty(scene())) return `loading an empty scene left ${JSON.stringify(scene())}`;
      return true;
    }],
    ['extra: bucket: fills from a flask poured into it, pours out tipped over', () => {
      kit.reset();
      const b = kit.spawn('bucket', 0, 0.46) as Bucket;
      kit.advance(0.5);
      pour('flask-water', 0, 1.7);
      kit.advance(4);
      const got = b.total;
      if (got < 150) return `bucket caught ${got} drops of a flask's ~270 (${game.puddles.total.toFixed(1)} px² on the floor)`;
      if (game.puddles.total > 20) return `most of it missed: ${game.puddles.total.toFixed(1)} px² on the floor, ${got} drops in the bucket`;
      // knocked over onto its side
      kit.reset();
      const c = kit.spawn('bucket', 0, 0.46) as Bucket;
      kit.advance(0.3);
      c.contents[1] = 300;
      kit.advance(0.5);
      if (c.total < 299) return `upright bucket spilled: ${c.total} of 300 drops left`;
      c.translate(0, 0.4);
      c.rotateAbout(c.main.x, c.main.y, 1.9);
      kit.advance(2.5);
      if (c.total > 60) return `tipped bucket still holds ${c.total} of 300 drops (up ${c.main.localDir(0, 1).y.toFixed(2)})`;
      if (game.puddles.total < 25) return `what poured out left only ${game.puddles.total.toFixed(1)} px² on the floor`;
      return true;
    }],
    ['extra: bucket: what it holds survives undo, saving and loading', () => {
      kit.reset();
      const b = kit.spawn('bucket', 0, 0.46) as Bucket;
      kit.advance(0.3);
      b.contents[1] = 250;
      b.contents[3] = 80;
      kit.advance(0.3);
      const held = (e: Bucket | undefined) => (e ? e.contents.map((v) => Math.round(v)).join('/') : 'no bucket');
      const want = held(b);
      const find = () => game.entities.find((e) => e.def.id === 'bucket') as Bucket | undefined;
      const saved = saveToString(game);
      game.resetEnvironment();
      loadFromString(game, saved);
      if (held(find()) !== want) return `loaded bucket holds ${held(find())}, saved ${want}`;
      controls.history.record('Clear all');
      game.resetEnvironment();
      controls.undo();
      if (held(find()) !== want) return `undone bucket holds ${held(find())}, was ${want}`;
      // (Rapier works out the new mass in the next step)
      kit.advance(0.1);
      const mass = find()!.main.mass;
      if (mass < 4) return `a bucket of liquid weighs only ${mass.toFixed(1)} kg`;
      return true;
    }],
  ];
}

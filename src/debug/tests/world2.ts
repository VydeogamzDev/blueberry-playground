import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Explosive } from '../../entities/Explosive';
import type { Human } from '../../entities/Human';
import { PX, WORLD } from '../../engine/constants';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { LAB, builtinMap } from '../../world/Maps';
import { STATS } from '../../world/Stats';

/** The maps added after People Playground's (see Maps.ts), each tried here. */
const NEW_MAPS = ['tiny', 'humongous', 'slanted', 'tower', 'blocks', 'void', 'snow', 'sea', 'abyss'];

export default function tests({ game, kit, human }: TestCtx): Test[] {
  /** The top of the ground at x (the floor where there's none; on the Void, far below). */
  const top = (x: number) => game.env.groundAt(x, WORLD.ceiling);
  const half = (e: Entity) => (e.parts[0].h * PX) / 2;
  const speed = (e: Entity) => Math.hypot(e.parts[0].vx, e.parts[0].vy);
  const weather = () => game.weather;
  /** Frames of the weather's drawing (the tests hold the frame loop: see kit.still). */
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) (game.weather as unknown as { frame(dt: number): void }).frame(1 / 60);
  };
  const shown = () => (game.weather as unknown as { shown: boolean }).shown;
  /** Draws the scene once (the weather's and the sea's shaders built and run); what went wrong building any, or null. */
  const drawn = (): string | null => {
    game.renderer.render(0);
    const bad = game.renderer.gl.info.programs?.filter((p) => (p as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable === false) ?? [];
    return bad.length ? `${bad.length} shaders failed to build: ${bad.map((p) => p.name).join(', ')}` : null;
  };

  return [
    ['extra: world2: rain puts out a small fire out in it, not one under cover', () => {
      kit.reset();
      const out = kit.spawn('crate', -4, 0.45);
      const under = kit.spawn('crate', 4, 0.45);
      // a plank held over the second one, well clear of its flames
      const roof = kit.spawn('plank', 4, 2.6);
      roof.setFrozen(true);
      kit.advance(0.3);
      game.fire.ignite(out.parts[0], 0.5);
      game.fire.ignite(under.parts[0], 0.5);
      kit.advance(2);
      if (out.parts[0].burning < 0.05 || under.parts[0].burning < 0.05) return 'the crates never caught';
      weather().set({ rain: 1 });
      kit.advance(4);
      if (out.parts[0].burning > 0.02) return `heavy rain left the crate out in it burning (${out.parts[0].burning.toFixed(2)})`;
      if (under.parts[0].burning < 0.05) return 'the crate under the plank went out too';
      return true;
    }],
    ['extra: world2: no weather costs nothing (nothing drawn); weather is drawn, as much as Effects says, and adds no bodies', () => {
      kit.reset();
      frames(2);
      if (weather().drawn !== 0 || shown()) return `with no weather ${weather().drawn} drops are drawn`;
      const bodies = game.physics.world.bodies.len();
      const detail = game.particles.detail;
      try {
        weather().set({ rain: 1, snow: 1, fog: 1 });
        game.particles.detail = 1;
        frames(3);
        const full = weather().drawn;
        if (full < 500) return `heavy rain and snow drew only ${full} drops and flakes`;
        const broken = drawn();
        if (broken) return broken;
        game.particles.detail = 0.3;
        frames(1);
        const less = weather().drawn;
        if (less >= full * 0.6) return `at Effects 30% ${less} drops were drawn, at 100% ${full}`;
        kit.advance(1);
        if (game.physics.world.bodies.len() !== bodies) return `the weather added ${game.physics.world.bodies.len() - bodies} bodies`;
      } finally {
        game.particles.detail = detail;
      }
      // turned off, nothing at all is drawn (settled snow taken away at once by reset)
      weather().reset();
      frames(1);
      if (weather().drawn !== 0 || shown()) return `turned off, ${weather().drawn} drops are still drawn`;
      return true;
    }],
    ['extra: world2: the weather and light are saved with a scene; a map with weather of its own brings it, and leaving takes it away', () => {
      kit.reset();
      weather().set({ rain: 0.6, fog: 0.5, lightning: 30, light: 0.55 });
      const want = JSON.stringify(weather().state);
      const saved = saveToString(game);
      weather().reset();
      loadFromString(game, saved);
      if (JSON.stringify(weather().state) !== want) return `loaded weather ${JSON.stringify(weather().state)}, saved ${want}`;
      if (game.renderer.ambient !== 0.55) return `the world's light came back as ${game.renderer.ambient}, not dusk`;
      // a save from before weather leaves it as it is
      const old = JSON.parse(saved) as Record<string, unknown>;
      delete old.weather;
      weather().set({ rain: 0.3 });
      loadFromString(game, JSON.stringify(old));
      if (weather().state.rain !== 0.3) return `a save without weather changed the rain to ${weather().state.rain}`;
      // the Snow map snows; back in the lab, it's as it was
      weather().reset();
      weather().set({ rain: 0.3 });
      game.setMap(builtinMap('snow')!);
      if (!(weather().state.snow > 0) || weather().state.rain !== 0.3) return `on the Snow map the weather is ${JSON.stringify(weather().state)}`;
      game.setMap(LAB);
      if (weather().state.snow !== 0 || weather().state.rain !== 0.3) return `back in the lab the weather is ${JSON.stringify(weather().state)}`;
      weather().reset();
      return true;
    }],
    ['extra: world2: lightning at 100% strikes within a few seconds (and not at all at 0%)', () => {
      kit.reset();
      const n0 = weather().strikes;
      kit.advance(6);
      if (weather().strikes !== n0) return 'lightning struck with the chance at 0%';
      weather().set({ lightning: 100 });
      for (let t = 0; t < 5 && weather().strikes === n0; t += 0.25) kit.advance(0.25);
      if (weather().strikes === n0) return 'no strike in 5 s at 100%';
      // and it goes on striking
      kit.advance(6);
      const n = weather().strikes - n0;
      weather().reset();
      if (n < 2) return `only ${n} strike in 11 s at 100%`;
      return true;
    }],
    ['extra: world2: each new map loads (bounds, ground) and a crate dropped on its ground rests there', () => {
      for (const id of NEW_MAPS) {
        kit.reset();
        const m = builtinMap(id);
        if (!m) return `there's no ${id} map`;
        game.setMap(m);
        if (game.map !== m) return `${id}: playing on ${game.map.id}`;
        if (WORLD.left !== -m.width / 2 || WORLD.right !== m.width / 2 || WORLD.ceiling !== m.height) return `${id}: the world spans ${WORLD.left}..${WORLD.right}, ceiling ${WORLD.ceiling}`;
        if (game.env.ground.length !== m.terrain.length) return `${id}: ${game.env.ground.length} of ${m.terrain.length} pieces of ground built`;
        // the flat ground nearest the middle, out of the sea, with room above it
        let at: number | null = null;
        for (let d = 0; d < m.width / 2 - 3 && at === null; d += 0.5) {
          for (const x of d ? [-d, d] : [0]) {
            const g = top(x);
            if (game.water.levelAt(x) !== null || g < WORLD.floor - 1 || g > WORLD.ceiling - 3) continue;
            if (Math.abs(top(x - 0.6) - g) < 0.02 && Math.abs(top(x + 0.6) - g) < 0.02) {
              at = x;
              break;
            }
          }
        }
        if (at === null) return `${id}: found no flat ground`;
        const c = kit.spawn('crate', at, top(at) + 1);
        kit.advance(2);
        const want = top(at) + half(c);
        if (c.destroyed || Math.abs(c.parts[0].y - want) > 0.08 || speed(c) > 0.1) {
          return `${id}: a crate dropped at x ${at} rests at y ${c.destroyed ? 'gone' : c.parts[0].y.toFixed(3)} (on top: ${want.toFixed(3)}), moving ${speed(c).toFixed(2)} m/s`;
        }
      }
      return true;
    }],
    ['extra: world2: the Void has no floor: what falls off its ledge is gone, what is on it stays', () => {
      kit.reset();
      game.setMap(builtinMap('void')!);
      if (!game.env.floorless) return 'the Void has a floor';
      const on = kit.spawn('crate', 0, 1);
      const off = kit.spawn('crate', 25, 1);
      const h = human(-25);
      kit.advance(5);
      if (!off.destroyed) return `a crate dropped beside the ledge is still there, at y ${off.parts[0].y.toFixed(1)}`;
      if (!h.destroyed) return 'a person who fell into the void is still there';
      if (on.destroyed || Math.abs(on.parts[0].y - half(on)) > 0.08) return `the crate on the ledge ${on.destroyed ? 'was removed' : `rests at y ${on.parts[0].y.toFixed(2)}`}`;
      return true;
    }],
    ['extra: world2: the Sea: wood floats up in it, metal sinks', () => {
      kit.reset();
      const m = builtinMap('sea')!;
      game.setMap(m);
      const w = m.water!;
      // deep water, the seabed well under the surface for 5 m
      const deep = (x: number) => [0, 1, 2, 3, 4, 5].every((d) => top(x + d) < w.level - 4);
      let x = NaN;
      for (let s = w.x0 + 4; s < w.x1 - 10 && Number.isNaN(x); s += 1) if (deep(s)) x = s;
      if (Number.isNaN(x)) return 'found no deep water';
      const crate = kit.spawn('crate', x + 1, w.level - 2.5);
      const box = kit.spawn('metal-box', x + 4, w.level + 1);
      // the sea drawn, over the camera on it
      game.renderer.camX = x;
      game.renderer.camY = w.level;
      (game.water as unknown as { frame(dt: number): void }).frame(1 / 60);
      const broken = drawn();
      if (broken) return broken;
      kit.advance(5);
      if (crate.parts[0].y < w.level - 0.6) return `a crate let go under the sea stayed down at y ${crate.parts[0].y.toFixed(2)} (surface ${w.level})`;
      if (box.parts[0].y > w.level - 1) return `a metal box dropped in the sea is at y ${box.parts[0].y.toFixed(2)} (surface ${w.level})`;
      return true;
    }],
    ['extra: world2: statistics count spawns, kills and explosions (not a scene loaded), and are kept in the store', () => {
      kit.reset();
      const st = game.stats;
      const counting = st.counting;
      st.counting = true;
      try {
        const was = { ...st.game };
        const h = kit.spawn('human', 0, 1) as Human;
        kit.spawn('dog', -3, 0.5);
        kit.spawn('crate', 3, 0.45);
        const g = kit.spawn('grenade', 8, 0.5) as Explosive;
        kit.advance(0.5);
        h.die();
        g.detonate();
        kit.advance(1);
        const d = (k: keyof typeof was) => st.game[k] - was[k];
        if (d('people') !== 1 || d('animals') !== 1 || d('items') !== 2) return `spawning a person, a dog, a crate and a grenade counted ${d('people')} people, ${d('animals')} animals, ${d('items')} items`;
        if (d('kills') < 1) return 'a death was not counted';
        if (d('explosions') < 1) return 'the grenade’s blast was not counted';
        // a scene loaded isn't spawned by anyone
        const n = st.game.people + st.game.items + st.game.animals;
        loadFromString(game, saveToString(game));
        kit.advance(0.5);
        if (st.game.people + st.game.items + st.game.animals !== n) return 'loading a scene counted what was in it as spawned';
        // the totals, kept and read back
        st.save();
        const kept = { ...st.total };
        for (const s of STATS) st.total[s.key] = 0;
        st.load();
        for (const s of STATS) {
          const tol = s.key === 'time' ? 1 : 0;
          if (Math.abs(st.total[s.key] - kept[s.key]) > tol) return `${s.label}: ${kept[s.key]} kept, ${st.total[s.key]} read back`;
        }
        if (st.total.people < st.game.people) return `all-time people ${st.total.people}, fewer than this game's ${st.game.people}`;
        return true;
      } finally {
        st.counting = counting;
      }
    }],
  ];
}

import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Human } from '../entities/Human';
import type { Firearm } from '../entities/Firearm';
import type { Explosive } from '../entities/Explosive';
import { makeTestKit } from './testkit';
import { FIXED_DT } from '../engine/constants';

type World = Game['physics']['world'];
/** Rapier's own breakdown of a step (its profiler is on while timing). */
const RAPIER_STAGES: [string, (w: World) => number][] = [
  ['rapier: broad', (w) => w.timingBroadPhase()],
  ['rapier: narrow', (w) => w.timingNarrowPhase()],
  ['rapier: islands', (w) => w.timingIslandConstruction()],
  ['rapier: solver setup', (w) => w.timingVelocityAssembly()],
  ['rapier: solver', (w) => w.timingVelocityResolution()],
  ['rapier: ccd', (w) => w.timingCcd()],
  ['rapier: user changes', (w) => w.timingUserChanges()],
];

export interface BenchResult {
  scene: string;
  bodies: number;
  /** Mean, 95th percentile and worst physics step, ms. */
  step: { mean: number; p95: number; max: number };
  /** Mean CPU time of a 60 Hz frame excluding the GPU draw, ms. */
  frame: number;
  /** Where the time went per step and per frame, ms. */
  stages: Record<string, number>;
  /** Fraction of a 60 Hz frame budget (16.7 ms) the simulation uses at full speed. */
  load: number;
  draws: number;
}

/**
 * Timing benchmark for crowded scenes, exposed as `bp.bench()` and run by
 * `npm run bench`. Builds each scene, lets it settle, then times a few
 * seconds of simulation (two physics steps per rendered frame, as at 60 fps).
 */
export function makeBench(game: Game, controls: Controls) {
  const kit = makeTestKit(game, controls);
  const row = (n: number, i: number) => -60 + (120 * (i + 0.5)) / n;

  const scenes: Record<string, (n: number) => (() => void) | void> = {
    /** People standing in a row, each balancing. */
    stand(n) {
      for (let i = 0; i < n; i++) kit.spawn('human', row(n, i), 0.9);
    },
    /** People wandering about among each other. */
    wander(n) {
      for (let i = 0; i < n; i++) (kit.spawn('human', row(n, i), 0.9) as Human).wander = true;
    },
    /** People dropped in heaps of ten. */
    pile(n) {
      const heaps = Math.ceil(n / 10);
      for (let i = 0; i < n; i++) {
        const h = i % heaps;
        kit.spawn('human', row(heaps, h) + ((i * 0.37) % 0.6) - 0.3, 1 + Math.floor(i / heaps) * 0.5, { angle: Math.PI / 2 });
      }
    },
    /** A crowd under fire: rifles spraying and grenades going off among them. */
    battle(n) {
      for (let i = 0; i < n; i++) kit.spawn('human', row(n, i) * 0.4, 0.9);
      const guns: Firearm[] = [];
      for (let i = 0; i < 4; i++) {
        const left = i % 2 === 0;
        const g = kit.spawn('rifle', (left ? -27 : 27), 1 + i * 0.3, { flip: !left }) as Firearm;
        g.setFrozen(true);
        guns.push(g);
      }
      let t = 0;
      return () => {
        t += FIXED_DT;
        if (Math.round(t / FIXED_DT) % 12 === 0) for (const g of guns) if (!g.destroyed) g.fire();
        if (Math.abs(t % 1.5) < FIXED_DT) (kit.spawn('grenade', (Math.random() - 0.5) * 40, 3) as Explosive).activate();
      };
    },
    /** Crates stacked in towers. */
    props(n) {
      const towers = Math.ceil(n / 10);
      for (let i = 0; i < n; i++) kit.spawn('crate', row(towers, i % towers), 0.45 + Math.floor(i / towers) * 0.9);
    },
  };

  return async function bench(only = '', sizes = [25, 50, 100], seconds = 4): Promise<BenchResult[]> {
    const out: BenchResult[] = [];
    const muted = game.sound.muted;
    game.sound.muted = true;
    const wasPaused = game.paused;
    game.paused = true;
    try {
      for (const [name, build] of Object.entries(scenes)) {
        if (only && !name.includes(only)) continue;
        for (const n of name === 'props' ? sizes.map((s) => s * 3) : sizes) {
          kit.reset();
          game.paused = true;
          const tick = build(n) ?? null;
          for (let i = 0; i < 1.5 / FIXED_DT; i++) {
            tick?.();
            game.step();
          }
          game.physics.world.profilerEnabled = true;
          const times: number[] = [];
          const prof: Record<string, number> = {};
          let frames = 0;
          let draws = 0;
          for (let i = 0; i < seconds / FIXED_DT; i++) {
            tick?.();
            game.prof = prof;
            const t0 = performance.now();
            game.step();
            times.push(performance.now() - t0);
            if (i % 2 === 1) {
              game.renderFrame(1 / 60, 1);
              frames++;
              draws += game.renderer.drawCalls();
            }
            game.prof = null;
            const w = game.physics.world;
            for (const [k, f] of RAPIER_STAGES) prof[k] = (prof[k] ?? 0) + f(w);
            // let the browser breathe so a long run doesn't trip the page's hang guard
            if (i % 120 === 119) await new Promise((r) => setTimeout(r, 0));
          }
          game.physics.world.profilerEnabled = false;
          times.sort((a, b) => a - b);
          const mean = times.reduce((s, t) => s + t, 0) / times.length;
          const stages: Record<string, number> = {};
          for (const [k, v] of Object.entries(prof)) stages[k] = +(v / (k.startsWith('frame') ? frames : times.length)).toFixed(3);
          const frame = (stages['frame: entities'] ?? 0) + (stages['frame: effects'] ?? 0);
          let bodies = 0;
          for (const e of game.entities) for (const p of e.parts) if (!p.destroyed) bodies++;
          out.push({
            scene: `${name} ${n}`, bodies,
            step: { mean: +mean.toFixed(3), p95: +times[Math.floor(times.length * 0.95)].toFixed(3), max: +times[times.length - 1].toFixed(3) },
            frame: +frame.toFixed(3), stages,
            load: +((mean * 2 + frame) / (1000 / 60)).toFixed(2),
            draws: Math.round(draws / Math.max(1, frames)),
          });
        }
      }
    } finally {
      kit.reset();
      game.paused = wasPaused;
      game.sound.muted = muted;
    }
    return out;
  };
}

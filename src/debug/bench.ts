import type { Game } from '../world/Game';
import type { Controls } from '../tools/Controls';
import type { Human } from '../entities/Human';
import type { Firearm } from '../entities/Firearm';
import type { Explosive } from '../entities/Explosive';
import type { Part } from '../world/Part';
import { makeTestKit } from './testkit';
import { COARSE_DT, FIXED_DT } from '../engine/constants';

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
  /**
   * The same at the longer step the game falls back on when `load` is too high
   * for real time (see Game.pickStep()); absent when it wouldn't.
   */
  coarseLoad?: number;
  draws: number;
}

/** The crowded scenes, each built with n people (or things); some return what to do every step. */
function makeScenes(kit: ReturnType<typeof makeTestKit>): Record<string, (n: number) => ((dt: number) => void) | void> {
  const row = (n: number, i: number) => -60 + (120 * (i + 0.5)) / n;
  return {
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
      return (dt) => {
        t += dt;
        // in short steps, so the same shots and grenades at either step length
        const k = Math.round(t / FIXED_DT);
        if (k % 12 === 0) for (const g of guns) if (!g.destroyed) g.fire();
        if (k % 180 === 0) (kit.spawn('grenade', (Math.random() - 0.5) * 40, 3) as Explosive).activate();
      };
    },
    /** Crates stacked in towers. */
    props(n) {
      const towers = Math.ceil(n / 10);
      for (let i = 0; i < n; i++) kit.spawn('crate', row(towers, i % towers), 0.45 + Math.floor(i / towers) * 0.9);
    },
    /** Contraptions: towers of crates, each welded together into one (a rigid unit, see ContactGroups). */
    contraption(n) {
      const towers = Math.ceil(n / 10);
      const below: (Part | undefined)[] = [];
      for (let i = 0; i < n; i++) {
        const t = i % towers;
        const y = 0.45 + Math.floor(i / towers) * 0.9;
        const p = kit.spawn('crate', row(towers, t), y).parts[0];
        const q = below[t];
        if (q) p.entity.game.connections.create('weld', q, { x: q.x, y: y - 0.45 }, p, { x: p.x, y: y - 0.45 });
        below[t] = p;
      }
    },
  };
}

/**
 * Timing benchmark for crowded scenes, exposed as `bp.bench()` and run by
 * `npm run bench`. Builds each scene, lets it settle, then times a few
 * seconds of simulation (two physics steps per rendered frame, as at 60 fps;
 * a scene too heavy for that is timed again at the longer step, one a frame).
 */
export function makeBench(game: Game, controls: Controls) {
  const kit = makeTestKit(game, controls);
  const scenes = makeScenes(kit);

  /** Builds a scene, lets it settle for 1.5 s, then times `seconds` of it at steps of `dt`. */
  async function time(build: (n: number) => ((dt: number) => void) | void, n: number, dt: number, seconds: number) {
    kit.reset();
    game.paused = true;
    game.stepDt = dt;
    const tick = build(n) ?? null;
    for (let i = 0; i < 1.5 / dt; i++) {
      tick?.(dt);
      game.step();
    }
    game.physics.world.profilerEnabled = true;
    const times: number[] = [];
    const prof: Record<string, number> = {};
    // a frame drawn every 60th of a second of game time
    const perFrame = Math.round(1 / 60 / dt);
    let frames = 0;
    let draws = 0;
    for (let i = 0; i < seconds / dt; i++) {
      tick?.(dt);
      game.prof = prof;
      const t0 = performance.now();
      game.step();
      times.push(performance.now() - t0);
      if (i % perFrame === perFrame - 1) {
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
    return { times, mean, stages, frame, frames, draws, load: (mean * perFrame + frame) / (1000 / 60) };
  }

  return async function bench(only = '', sizes = [25, 50, 100], seconds = 4): Promise<BenchResult[]> {
    const out: BenchResult[] = [];
    const muted = game.sound.muted;
    game.sound.muted = true;
    const wasPaused = game.paused;
    game.paused = true;
    try {
      for (const [name, build] of Object.entries(scenes)) {
        if (only && !name.includes(only)) continue;
        for (const n of name === 'props' || name === 'contraption' ? sizes.map((s) => s * 3) : sizes) {
          const r = await time(build, n, FIXED_DT, seconds);
          let bodies = 0;
          for (const e of game.entities) for (const p of e.parts) if (!p.destroyed) bodies++;
          const { times, mean } = r;
          // the game takes the longer step once it falls 10% behind real time
          const coarse = r.load > 0.9 ? await time(build, n, COARSE_DT, seconds) : null;
          out.push({
            scene: `${name} ${n}`, bodies,
            step: { mean: +mean.toFixed(3), p95: +times[Math.floor(times.length * 0.95)].toFixed(3), max: +times[times.length - 1].toFixed(3) },
            frame: +r.frame.toFixed(3), stages: r.stages,
            load: +r.load.toFixed(2),
            ...(coarse ? { coarseLoad: +coarse.load.toFixed(2) } : {}),
            draws: Math.round(r.draws / Math.max(1, r.frames)),
          });
        }
      }
    } finally {
      kit.reset();
      game.resetStep();
      game.paused = wasPaused;
      game.sound.muted = muted;
    }
    return out;
  };
}

export interface LiveResult {
  scene: string;
  /** Per window: share of real time simulated (%), frames a second, mean step (ms), whether on the long step. */
  windows: { speed: number; fps: number; step: number; long: boolean }[];
  /** Share of real time simulated after the first window (the switch to the long step happens in it). */
  speed: number;
}

/**
 * Runs crowded scenes in the game's own frame loop, in real time, and samples
 * how fast they go: `npm run bench -- --live` does it on the graphics card with
 * frames held to a 60 Hz display (or --hz=144), as a player would see them.
 */
export function makeLiveBench(game: Game, controls: Controls) {
  const kit = makeTestKit(game, controls);
  const scenes = makeScenes(kit);
  return async function live(only = 'pile battle', n = 100, windows = 7, seconds = 3): Promise<LiveResult[]> {
    const out: LiveResult[] = [];
    const muted = game.sound.muted;
    game.sound.muted = true;
    try {
      for (const name of only.split(' ')) {
        const build = scenes[name];
        if (!build) continue;
        kit.reset();
        game.resetStep();
        const tick = build(n) ?? null;
        const pre = (dt: number) => tick?.(dt);
        let frames = 0;
        let stepSum = 0;
        const count = () => {
          frames++;
          stepSum += game.stepMs;
        };
        game.preStepHandlers.push(pre);
        game.frameHandlers.push(count);
        const rows: LiveResult['windows'] = [];
        try {
          for (let w = 0; w < windows; w++) {
            frames = 0;
            stepSum = 0;
            const t0 = performance.now();
            const s0 = game.time;
            await new Promise((r) => setTimeout(r, seconds * 1000));
            const real = (performance.now() - t0) / 1000;
            rows.push({
              speed: Math.round(((game.time - s0) / real) * 100),
              fps: Math.round(frames / real),
              step: +(stepSum / Math.max(1, frames)).toFixed(1),
              long: game.stepDt !== FIXED_DT,
            });
          }
        } finally {
          game.preStepHandlers.splice(game.preStepHandlers.indexOf(pre), 1);
          game.frameHandlers.splice(game.frameHandlers.indexOf(count), 1);
        }
        const rest = rows.slice(1);
        out.push({ scene: `${name} ${n}`, windows: rows, speed: Math.round(rest.reduce((a, r) => a + r.speed, 0) / Math.max(1, rest.length)) });
      }
    } finally {
      kit.reset();
      game.resetStep();
      game.sound.muted = muted;
    }
    return out;
  };
}

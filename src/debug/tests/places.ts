import type { Test, TestCtx } from './types';
import type { FuelTank } from '../../entities/Rocketry';
import { WORLD_MAP } from '../../world/Maps';

/** Places, races and stunts (0.4.0: entities/Places, systems/Races). */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const r = game.renderer;
  const hold = (code: string, s: number) => {
    kit.key(code, true);
    kit.advance(s);
    kit.key(code, false);
  };
  const right = () => controls.bindings.keys('driveRight')[0];
  const left = () => controls.bindings.keys('driveLeft')[0];

  return [
    ['extra: places: a car driven through the start, the checkpoint and back through the start makes a timed lap', () => {
      kit.reset();
      game.races.reset();
      kit.spawn('race-gate', -4, 0.875);
      kit.spawn('race-gate', 6, 0.875, { config: { index: 1 } });
      const car = kit.spawn('car', -10, 0.8);
      kit.advance(0.5);
      controls.selection = new Set([car]);
      for (let i = 0; i < 40 && car.parts[0].x < 8; i++) hold(right(), 0.1);
      if (!(car.parts[0].x > 6)) return `driving right, the car got only to x ${car.parts[0].x.toFixed(1)}`;
      if (!game.races.lap) return 'through the start gate, no lap started';
      if (game.races.lap.next !== 2) return `past checkpoint 1 the lap waits for checkpoint ${game.races.lap.next}`;
      kit.advance(1.5);
      for (let i = 0; i < 80 && car.parts[0].x > -7; i++) hold(left(), 0.1);
      if (!(car.parts[0].x < -4)) return `driving back, the car got only to x ${car.parts[0].x.toFixed(1)}`;
      if (game.races.laps !== 1) return `back through the start, ${game.races.laps} laps`;
      if (!(game.races.best > 1 && game.races.best < 60)) return `the lap took ${game.races.best} s`;
      if (!game.races.status().includes('best')) return `the race line doesn’t show the best lap: ${game.races.status()}`;
      return true;
    }],
    ['extra: places: a car thrown up into the air and landing on its wheels scores stunt points; a fuel pump fills a tank stopped beside it', () => {
      kit.reset();
      game.races.reset();
      const car = kit.spawn('car', 0, 0.8);
      kit.advance(1);
      controls.selection = new Set([car]);
      kit.advance(0.3);
      car.setVelocity(2, 9);
      kit.advance(4);
      if (!(game.races.score >= 100)) return `about 1.8 s in the air and down on its wheels, the stunt points are ${game.races.score}`;
      // the pump
      kit.reset();
      const pump = kit.spawn('fuel-pump', 0, 0.7);
      const tank = kit.spawn('fuel-tank', 1.5, 0.6) as FuelTank;
      kit.advance(0.3);
      tank.take(tank.fuel);
      if (tank.fuel > 0.01) return 'the tank wouldn’t empty';
      kit.advance(2);
      if (!(tank.fuel > 10)) return `2 s beside the pump the tank has ${tank.fuel.toFixed(1)} kg`;
      void pump;
      return true;
    }],
    ['extra: places: switching to the World lays its runway, launch pad, fuel pump, ramps and race course on the ground by the start', () => {
      kit.reset();
      controls.switchMap(WORLD_MAP);
      r.camX = 0;
      r.camY = 2;
      kit.advance(0.5);
      const n = (id: string) => game.entities.filter((e) => e.def.id === id && !e.destroyed).length;
      for (const [id, want] of [['runway', 1], ['rocket-pad', 1], ['fuel-pump', 1], ['ramp', 2], ['race-gate', 4]] as const) {
        if (n(id) !== want) return `the World has ${n(id)} ${id} (wanted ${want})`;
      }
      const ramp = game.entities.find((e) => e.def.id === 'ramp')!;
      const g = game.env.groundAt(ramp.parts[0].x, ramp.parts[0].y);
      const foot = ramp.parts[0].y - (ramp.parts[0].h / 32) / 2;
      if (Math.abs(foot - g) > 0.2) return `the ramp’s foot is ${(foot - g).toFixed(2)} m off the ground`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { ControlFlap } from '../../entities/Rocketry';
import type { CameraPart, ScreenPart } from '../../entities/Cameras';
import type { PilotHud } from '../../systems/Piloting';
import { Challenges } from '../../systems/Challenges';
import { getItem } from '../../catalog/items';
import { store } from '../../engine/Store';
import { saveToString, loadFromString } from '../../world/SaveLoad';
import { WORLD_MAP } from '../../world/Maps';

/** The rest of 0.4.0's flight parts and helps: flaps, the trajectory line, symmetry, camera screens, challenges. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const C = game.connections;
  const r = game.renderer;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const deg = (a: number) => (a * 180) / Math.PI;

  return [
    ['extra: flight: a control flap set to a landing flap lowers on F and comes up again; trimmed, it rests at its trim; saved and loaded, it keeps both', () => {
      kit.reset();
      const f = kit.spawn('control-flap', 0, 2) as ControlFlap;
      const post = kit.spawn('metal-box', -0.5, 2);
      post.setFrozen(true);
      C.create('weld', f.mount, f.mount.localToWorld(0, 0), post.parts[0], f.mount.localToWorld(0, 0));
      kit.advance(0.6);
      const rel = () => deg(wrap(f.flap.bodyAngle - f.mount.bodyAngle));
      if (Math.abs(rel()) > 3) return `at rest the flap is at ${rel().toFixed(0)}°`;
      f.activate();
      kit.advance(0.8);
      if (!f.lowered || Math.abs(Math.abs(rel()) - 28) > 5) return `on F the flap is at ${rel().toFixed(0)}° (lowered ${f.lowered}; want 28° down)`;
      f.activate();
      kit.advance(0.8);
      if (f.lowered || Math.abs(rel()) > 4) return `F again: the flap is at ${rel().toFixed(0)}°`;
      f.trim = 8;
      kit.advance(0.8);
      if (Math.abs(Math.abs(rel()) - 8) > 4) return `trimmed 8°, the flap is at ${rel().toFixed(0)}°`;
      const s = saveToString(game);
      kit.reset();
      loadFromString(game, s);
      kit.advance(0.2);
      const g = game.entities.find((e) => e.def.id === 'control-flap') as ControlFlap | undefined;
      if (!g || g.trim !== 8 || g.mode !== 'flap') return `loaded: trim ${g?.trim}, mode ${g?.mode}`;
      return true;
    }],
    ['extra: flight: the trajectory line of something thrown on the World lands near where it comes down', () => kit.still(async () => {
      kit.reset();
      game.setMap(WORLD_MAP);
      r.camX = 0;
      r.camY = 60;
      kit.advance(0);
      // (a little rocket, its engine off: something to fly)
      const box = kit.spawn('fuel-tank', 0, 60);
      const thr = kit.spawn('thruster', 0, 59.45, { angle: Math.PI / 2 });
      kit.advance(0.05);
      C.create('weld', box.parts[0], { x: 0, y: 59.6 }, thr.parts[0], { x: 0, y: 59.6 });
      const p = box.parts[0];
      for (const q of [p, thr.parts[0]]) q.body.setLinvel({ x: 25, y: 20 }, true);
      game.piloting.drive([box], { x: 0, t: 0, r: 0 });
      kit.advance(0.02);
      const path = game.piloting.trajectory(30);
      if (path.length < 5) return `the trajectory has ${path.length} points`;
      const end = path[path.length - 1];
      let landed = p.x;
      game.advance(8, () => {
        r.camX = p.x;
        r.camY = p.y;
        if (p.y - game.env.groundAt(p.x, p.y) > 1) landed = p.x;
      });
      if (Math.abs(end.x - landed) > Math.max(6, Math.abs(landed) * 0.15)) return `the line ends at x ${end.x.toFixed(1)}, it came down at ${landed.toFixed(1)}`;
      return true;
    })],
    ['extra: flight: with symmetry on, what’s spawned on one side is spawned mirrored on the other', () => {
      kit.reset();
      kit.view(0, 2);
      game.renderFrame(1 / 60, 1);
      controls.symmetryX = 0;
      try {
        controls.arm(getItem('metal-box')!);
        kit.move(2, 3);
        kit.advance(0.05);
        kit.press(controls.bindings.keys('spawnRight')[0]);
        kit.advance(0.2);
      } finally {
        controls.symmetryX = null;
        controls.arm(null);
      }
      const boxes = game.entities.filter((e) => e.def.id === 'metal-box').map((e) => e.parts[0].x);
      if (boxes.length !== 2) return `${boxes.length} boxes were spawned`;
      boxes.sort((a, b) => a - b);
      if (Math.abs(boxes[0] + 2) > 0.3 || Math.abs(boxes[1] - 2) > 0.3) return `the boxes are at ${boxes.map((x) => x.toFixed(2)).join(', ')} (want −2 and 2)`;
      return true;
    }],
    ['extra: flight: a screen wired to a camera shows its view (drawn into the screen), and a camera in what’s flown shows in the corner', () => {
      kit.reset();
      kit.view(0, 1);
      const cam = kit.spawn('camera-part', -1, 0.3) as CameraPart;
      const scr = kit.spawn('screen-part', 1, 0.4) as ScreenPart;
      kit.advance(0.2);
      C.create('wire', cam.main, cam.main.localToWorld(0, 0), scr.main, scr.main.localToWorld(0, 0));
      kit.advance(0.1);
      if (scr.camera() !== cam) return 'the screen doesn’t see the camera it’s wired to';
      let drawn = 0;
      const views = r.views as unknown[];
      const push = views.push.bind(views);
      (views as { push: (...a: unknown[]) => number }).push = (...a: unknown[]) => {
        drawn += a.length;
        return push(...a);
      };
      try {
        for (let i = 0; i < 4; i++) game.renderFrame(1 / 60, 1);
      } finally {
        delete (views as { push?: unknown }).push;
      }
      if (drawn < 1) return 'rendering frames drew no camera view for the screen';
      // flown, with the camera built in: the corner box shows
      const box: Entity = kit.spawn('thruster', -1, 0.9);
      kit.advance(0.2);
      C.create('weld', cam.main, cam.main.localToWorld(0, 0.1), box.parts[0], cam.main.localToWorld(0, 0.1));
      controls.selection = new Set([box]);
      game.piloting.drive([box], { x: 0, t: 0, r: 0 });
      kit.advance(0.1);
      game.renderFrame(1 / 60, 1);
      const pip = document.querySelector('.pip-box');
      const shown = pip && !pip.classList.contains('hidden');
      controls.selection = new Set();
      if (!shown) return 'flying a build with a camera in it, the picture-in-picture box isn’t shown';
      return true;
    }],
    ['extra: flight: challenges are met by what’s flown (a hop, a soft landing), kept, and the World ones only on the World', () => {
      const KEY = 'blueberry-challenges';
      const was = store.getItem(KEY);
      store.removeItem(KEY);
      try {
        kit.reset();
        const ch = new Challenges(game);
        const met: string[] = [];
        ch.onMet = (c) => met.push(c.id);
        const craft = {};
        const hud = (height: number, speed: number, climb: number): PilotHud => ({ speed, height, climb, throttle: 0, engines: 0, running: 0 });
        // up to 60 m, then down, touching down at 2 m/s
        for (let h = 0; h <= 60; h += 2) ch.watch(craft, hud(h, 5, 5), false, 0.1);
        for (let h = 60; h >= 0; h -= 2) ch.watch(craft, hud(h, h < 2 ? 2 : 6, h < 2 ? -2 : -6), false, 0.1);
        ch.watch(craft, hud(0.3, 0.1, 0), false, 0.1);
        if (!ch.isDone('hop')) return 'flying 60 m up didn’t meet Hop';
        if (!ch.isDone('soft')) return `coming down at 2 m/s didn’t meet Soft landing (met: ${met.join(', ')})`;
        // (1 km is a World one: not here)
        for (let h = 0; h <= 1200; h += 50) ch.watch(craft, hud(h, 50, 50), false, 0.1);
        if (ch.isDone('km')) return 'a kilometre up met on a map that isn’t the World';
        if (!new Challenges(game).isDone('hop')) return 'Hop wasn’t kept';
      } finally {
        if (was === null) store.removeItem(KEY);
        else store.setItem(KEY, was);
      }
      return true;
    }],
  ];
}

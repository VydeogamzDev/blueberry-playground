import type { Test, TestCtx } from './types';
import { AutoQuality, RES_STEPS } from '../../engine/AutoQuality';
import { PRESETS, PRESET_NAMES, presetOf } from '../../engine/Graphics';

/** Low-end devices (0.5.0): the Low preset, auto quality, and the paused hover kept cheap. */
export default function tests({ game, kit }: TestCtx): Test[] {
  /** Feeds `s` seconds of frames at `fps`, the frame's own work `work` ms, aiming at 60. */
  const feed = (aq: AutoQuality, s: number, fps: number, work: number) => {
    for (let t = 0; t < s; t += 1 / fps) aq.update(1 / fps, fps, work, 60);
  };
  return [
    ['lowend: there is a Low preset between Potato and Medium, and it is told apart from the others', () => {
      const ids = PRESET_NAMES.map((p) => p.id);
      if (ids.indexOf('low') !== ids.indexOf('potato') + 1 || ids.indexOf('medium') !== ids.indexOf('low') + 1) return `presets in order: ${ids.join(', ')}`;
      if (presetOf({ ...PRESETS.low }) !== 'low') return `Low's settings read as ${presetOf({ ...PRESETS.low })}`;
      if (presetOf({ ...PRESETS.low, fps: 'display', auto: false }) !== 'low') return 'Low with another frame cap or auto quality off isn\'t Low';
      return true;
    }],
    ['lowend: auto quality drops the resolution a step at a time while drawing holds the frames up, effects when the work does, and gives them back once they keep up', () => {
      const aq = new AutoQuality();
      aq.allowed = aq.enabled = true;
      let changes = 0;
      aq.onChange = () => changes++;
      aq.canDrop = () => true;
      // 60 fps: nothing
      feed(aq, 10, 60, 4);
      if (aq.res || aq.fx) return `at 60 fps it took res ${aq.res}, fx ${aq.fx}`;
      // 30 fps, the frame's work 5 ms of its 33: the drawing
      feed(aq, 2, 30, 5);
      if (aq.res) return 'it dropped within 2 s';
      feed(aq, 1.5, 30, 5);
      if (aq.res !== 1 || aq.fx) return `after 3.5 s at 30 fps (drawing): res ${aq.res}, fx ${aq.fx}`;
      feed(aq, 6, 30, 5);
      if (aq.res !== RES_STEPS.length - 1) return `still slow 6 s on: res ${aq.res}`;
      feed(aq, 6, 30, 5);
      if (aq.fx !== 1) return `at the lowest resolution and still slow: fx ${aq.fx}`;
      const n = changes;
      feed(aq, 30, 30, 5);
      if (changes !== n) return 'with nothing left to drop it kept changing';
      // keeping up: effects back first, then the pixels, after a while each
      feed(aq, 10, 60, 4);
      if (aq.fx !== 1) return 'gave effects back after only 10 s of keeping up';
      feed(aq, 12, 60, 4);
      if ((aq.fx as number) !== 0 || aq.res !== RES_STEPS.length - 1) return `after 22 s keeping up: res ${aq.res}, fx ${aq.fx}`;
      // too soon: slow again at once, so it waits twice as long to try again
      feed(aq, 4, 30, 5);
      if ((aq.fx as number) !== 1) return 'slow again, it didn\'t take the effects back down';
      feed(aq, 30, 60, 4);
      if (aq.fx !== 1) return 'given back too soon once, it tried again as soon as before';
      feed(aq, 15, 60, 4);
      if ((aq.fx as number) !== 0) return 'it never tried again';
      // held up by its own work (25 ms of a 33 ms frame): effects first
      const b = new AutoQuality();
      b.allowed = b.enabled = true;
      b.canDrop = () => true;
      feed(b, 4, 30, 25);
      if (b.fx !== 1 || b.res) return `work-bound: res ${b.res}, fx ${b.fx}`;
      // off: back to as set
      b.enabled = false;
      b.update(1 / 60, 30, 25, 60);
      if ((b.fx as number) || b.res) return 'turned off, it kept what it had taken';
      return true;
    }],
    ['lowend: while paused, the part under the cursor is found where it was moved to by hand, and not where it was', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.45);
      const far = kit.spawn('crate', 20, 0.45);
      kit.advance(0.5);
      game.paused = true;
      try {
        if (game.pick(0, 0.45)?.entity !== crate) return 'the crate isn\'t picked where it stands';
        crate.translate(6, 0);
        if (game.pick(0, 0.45)) return 'something picked where the crate was';
        if (game.pick(6, 0.45)?.entity !== crate) return 'the crate isn\'t picked where it was moved to';
        if (game.pick(19.2, 0.45, 0.5)?.entity !== far) return 'the far crate isn\'t picked near its edge';
        if (!game.entitiesInRect(5, 0, 7, 1).includes(crate)) return 'a box round where it was moved to doesn\'t find it';
      } finally {
        game.paused = false;
      }
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { UI } from '../../ui/UI';
import type { Creature } from '../../entities/Creature';
import type { Firearm } from '../../entities/Firearm';
import { skeleton } from '../../ui/XRay';
import { PX } from '../../engine/constants';

export default function tests({ game, controls, kit, human }: TestCtx): Test[] {
  const r = game.renderer;
  const xrayKey = () => controls.bindings.keys('xray')[0] ?? 'KeyX';
  /** The x-ray canvas's pixels in a box `half` CSS px round a world point. */
  const pixels = (x: number, y: number, half: number): Uint8ClampedArray | null => {
    const cv = document.querySelector<HTMLCanvasElement>('canvas.xray-view');
    if (!cv) return null;
    const k = cv.width / window.innerWidth;
    const s = r.worldToScreen(x, y);
    const n = Math.max(1, Math.round(half * 2 * k));
    return cv.getContext('2d')!.getImageData(Math.round((s.x - half) * k), Math.round((s.y - half) * k), n, n).data;
  };
  /** How many pixels the x-ray has drawn round a world point (-1: no canvas). */
  const inked = (x: number, y: number, half = 4): number => {
    const d = pixels(x, y, half);
    if (!d) return -1;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  };
  /** Runs `fn` with the x-ray on, then puts it and the camera back as they were. */
  const withXray = (fn: () => string | true): string | true => {
    const cam = { x: r.camX, y: r.camY, zoom: r.zoom };
    controls.xray = true;
    try {
      return fn();
    } finally {
      controls.xray = false;
      r.camX = cam.x;
      r.camY = cam.y;
      r.zoom = r.targetZoom = cam.zoom;
      kit.advance(0);
    }
  };

  return [
    ['extra: overlays: the x-ray key turns the x-ray on and off', () => {
      kit.reset();
      controls.xray = false;
      kit.press(xrayKey());
      const on = controls.xray;
      kit.press(xrayKey());
      const off = !controls.xray;
      controls.command('xray');
      const again = controls.xray;
      controls.xray = false;
      if (!on) return `${xrayKey()} did not turn the x-ray on`;
      if (!off) return `${xrayKey()} again left the x-ray on`;
      if (!again) return 'the x-ray command (the tool bar button) did not turn it on';
      return true;
    }],
    ['extra: overlays: the x-ray draws over a person (and nowhere else), and clears when off', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const torso = h.limbs.get('upperTorso')!.part;
      return withXray(() => {
        kit.view(torso.x, torso.y, 64);
        const on = inked(torso.x, torso.y);
        const air = inked(torso.x + 3, torso.y + 1.5);
        controls.xray = false;
        kit.advance(0);
        const off = inked(torso.x, torso.y);
        if (on < 0) return 'no x-ray canvas';
        if (on < 20) return `only ${on} px drawn over the torso`;
        if (air > 0) return `${air} px drawn in the empty air beside the person`;
        if (off > 0) return `${off} px still drawn with the x-ray off`;
        return true;
      });
    }],
    ['extra: overlays: the x-ray shows a broken leg snapped with a red crack; every limb has bones', () => {
      kit.reset();
      const h = human(0);
      const dog = kit.spawn('dog', 2.5, 0.5) as Creature;
      kit.advance(1);
      const leg = h.limbs.get('lowerLegF')!;
      // a hard blunt knock, as a falling crate gives
      h.damage(leg.part, leg.part.maxHp * 0.6, 'blunt', { x: leg.part.x, y: leg.part.y }, { x: 1, y: 0 });
      if (!leg.broken) return `a blunt hit of 60% didn't break the leg (${h.status()})`;
      const sk = skeleton(h);
      const bl = sk.find((b) => b.key === 'lowerLegF');
      const ok = sk.find((b) => b.key === 'lowerLegB');
      if (!bl || !bl.broken || bl.bones.pieces !== 2) return `the x-ray's broken leg: ${bl ? `broken ${bl.broken}, in ${bl.bones.pieces} piece(s)` : 'missing'}`;
      if (!ok || ok.broken || ok.bones.pieces !== 1) return 'the other leg shows broken too';
      for (const s of [...sk, ...skeleton(dog)]) if (!s.bones.list.length) return `no bones in the ${s.key}`;
      return withXray(() => {
        const b = bl.bones.brk;
        const at = leg.part.localToWorld(b.x * PX, b.y * PX);
        kit.view(at.x, at.y, 160);
        const d = pixels(at.x, at.y, 6);
        if (!d) return 'no x-ray canvas';
        let red = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 180 && d[i + 1] < 120 && d[i + 2] < 110) red++;
        if (!red) return 'no red crack drawn at the break';
        return true;
      });
    }],
    ['extra: overlays: vitals of a selected person: blood falls after a shot, no heartbeat once dead', () => {
      kit.reset();
      const h = human(0);
      kit.advance(1);
      const vitals = (controls.ui as unknown as UI).vitals;
      const shown = (k: string) => document.querySelector(`.vitals [data-v="${k}"]`)?.textContent ?? '';
      try {
        controls.selection = new Set([h]);
        kit.advance(0.05);
        const panel = document.querySelector<HTMLElement>('.vitals');
        vitals.refresh();
        if (!panel || panel.classList.contains('hidden') || vitals.target !== h) return 'no vitals panel for the selected person';
        const blood0 = parseFloat(shown('blood'));
        const bpm0 = parseFloat(shown('bpm'));
        if (!(bpm0 > 30)) return `heart rate "${shown('bpm')}" for a living person`;
        // a shot through the chest
        const torso = h.limbs.get('upperTorso')!.part;
        const g = kit.spawn('pistol', -2.5, torso.y) as Firearm;
        g.setFrozen(true);
        kit.advance(0.05);
        g.fire();
        for (let i = 0; i < 6 && h.blood > 98; i++) kit.advance(0.5);
        if (h.blood > 98) return `the shot drew no blood (${h.status()})`;
        vitals.refresh();
        const blood1 = parseFloat(shown('blood'));
        if (!(blood1 < blood0)) return `blood shown ${blood0}% -> ${blood1}% (really ${h.blood.toFixed(1)}%)`;
        // pinned, the panel stays when the person is deselected
        controls.command('vitals');
        controls.clearSelection();
        kit.advance(0.05);
        if (vitals.target !== h) return 'the pinned vitals went away when deselected';
        h.die();
        kit.advance(0.1);
        const v = vitals.refresh();
        if (shown('bpm') !== '0' || v?.bpm !== 0) return `heart rate "${shown('bpm')}" once dead`;
        return true;
      } finally {
        controls.vitalsPinned = null;
      }
    }],
  ];
}

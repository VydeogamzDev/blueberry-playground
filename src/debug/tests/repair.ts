import type { Test, TestCtx } from './types';
import type { Car } from '../../entities/Car';
import type { Human } from '../../entities/Human';
import type { Entity } from '../../world/Entity';

/** Repair in the context menu: things hurt, burnt or shot through, and wrecks, made good. */
export default function tests({ game, controls, kit }: TestCtx): Test[] {
  /** Right-clicks `e` and picks `label` from its menu; false if there's no such entry. */
  const menu = (e: Entity, label: string): boolean => {
    const p = e.parts.find((q) => !q.destroyed)!;
    kit.down(p.x, p.y, 2);
    kit.up(p.x, p.y, 2);
    const item = [...document.querySelectorAll<HTMLElement>('.ctx-item')].find((d) => (d.textContent ?? '').replace(/^[☑☐] /, '').startsWith(label));
    if (!item) {
      controls.ui.closeContextMenu();
      return false;
    }
    item.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    return true;
  };

  return [
    ['extra: repair: a crate cut down, burnt and bloodied is made good from its menu, its full size again; one unhurt has no Repair', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.6);
      const whole = kit.spawn('crate', 2, 0.6);
      kit.advance(0.5);
      const p = crate.parts[0];
      const mass = p.mass;
      // its right half carved away, a fire on it, blood on it
      const px: number[] = [];
      for (let y = 0; y < p.h; y++) for (let x = Math.floor(p.w / 2); x < p.w; x++) px.push(x, y);
      p.carve(px);
      game.fire.ignite(p, 0.8);
      p.charred = 0.5;
      p.hp = p.maxHp / 3;
      p.paintAt(p.x - 0.1, p.y, 0x8a1010, 2);
      kit.advance(0.2);
      if (p.mass > mass * 0.7) return `cut in half, it still weighs ${p.mass.toFixed(1)} of ${mass.toFixed(1)} kg`;
      if (menu(whole, 'Repair')) return 'an unhurt crate offers Repair';
      if (!menu(crate, 'Repair')) return 'the hurt crate has no Repair in its menu';
      if (p.hp !== p.maxHp) return `repaired, its health is ${p.hp.toFixed(0)} of ${p.maxHp.toFixed(0)}`;
      if (p.holeCount) return `repaired, ${p.holeCount} pixels are still carved away`;
      if (p.burning > 0 || p.charred > 0) return `repaired, it's still burning (${p.burning.toFixed(2)}) or charred (${p.charred.toFixed(2)})`;
      if (p.paintData() !== null) return 'repaired, the blood is still on it';
      kit.advance(0.1);
      if (Math.abs(p.mass - mass) > mass * 0.02) return `repaired, it weighs ${p.mass.toFixed(1)} kg, not ${mass.toFixed(1)}`;
      controls.undo();
      if (!game.entities.some((e) => e.def.id === 'crate' && e.parts[0].holeCount > 0)) return 'undone, the repair stayed';
      return true;
    }],
    ['extra: repair: a car blown up is made whole, its wheels back on, and drives again', () => {
      kit.reset();
      const car = kit.spawn('car', 0, 0.9) as Car;
      kit.advance(0.5);
      car.explode();
      kit.advance(2);
      if (!car.wrecked) return 'blown up, it isn’t a wreck';
      // (any wheel the blast left on, torn off anyway)
      (car as unknown as { shed(i: number): void }).shed(0);
      kit.advance(0.5);
      const off = car.wheels[0];
      if (Math.hypot(off.x - car.body.x, off.y - car.body.y) < 0.3) return 'the shed wheel stayed where it was';
      if (!menu(car, 'Repair')) return 'the wreck has no Repair in its menu';
      kit.advance(0.2);
      if (car.wrecked) return 'repaired, it is still a wreck';
      if (car.body.hp !== car.body.maxHp) return `repaired, its body's health is ${car.body.hp.toFixed(0)} of ${car.body.maxHp.toFixed(0)}`;
      if (car.parts.some((p) => p.burning > 0)) return 'repaired, it still burns';
      const axles = (car as unknown as { axles: { isValid(): boolean }[] }).axles;
      if (!axles.every((j) => j.isValid())) return 'repaired, a wheel is still off its axle';
      const x0 = car.body.x;
      car.activate();
      kit.advance(2);
      if (Math.abs(car.body.x - x0) < 2) return `repaired and switched on, it only moved ${(car.body.x - x0).toFixed(2)} m`;
      return true;
    }],
    ['extra: repair: an android’s menu repairs it (as Heal does a person)', () => {
      kit.reset();
      const bot = kit.spawn('android', 0, 1) as Human;
      kit.advance(0.5);
      const head = bot.limbs.get('head')!.part;
      bot.damage(head, 30, 'blunt', { x: head.x, y: head.y }, { x: 1, y: 0 });
      if (!menu(bot, 'Repair')) return 'the android has no Repair in its menu';
      if (head.hp !== head.maxHp) return `repaired, its head's health is ${head.hp.toFixed(0)} of ${head.maxHp.toFixed(0)}`;
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import type { Human } from '../../entities/Human';
import type { Cockpit } from '../../entities/Flight';
import type { Airbag, FireSuppressor } from '../../entities/Safety';

/** Seat belts, airbags, g-LOC and the automatic extinguisher (0.4.0: entities/Safety, Cockpit.strain). */
export default function tests({ game, kit, human }: TestCtx): Test[] {
  const C = game.connections;
  const weld = (a: Entity, b: Entity, at: { x: number; y: number }) => C.create('weld', a.parts[0], at, b.parts[0], at);
  /** A metal box with a cockpit on it and someone sat in it (and an airbag on the box, if `bag`). */
  const crewed = (x: number, bag: boolean) => {
    const box = kit.spawn('metal-box', x, 0.4);
    const seat = kit.spawn('cockpit', x, 1.15) as Cockpit;
    const ab = bag ? (kit.spawn('airbag', x + 0.6, 0.5) as Airbag) : null;
    kit.advance(0.3);
    weld(box, seat, { x, y: 0.8 });
    if (ab) weld(box, ab, { x: x + 0.5, y: 0.5 });
    const h = human(x - 1.5) as Human;
    kit.advance(0.5);
    seat.takeIn(h, seat.main.pixelToWorld(9, 12));
    kit.advance(0.5);
    return { box, seat, ab, h };
  };
  /** How much of their chest and head is gone (shares of each, summed). */
  const hurt = (h: Human) => {
    let lost = 0;
    for (const k of ['upperTorso', 'head'] as const) {
      const l = h.limbs.get(k)!;
      lost += l.gone ? 1 : 1 - l.part.hp / l.part.maxHp;
    }
    return lost;
  };
  /** Everything in what `e` is part of (and who sits in it) thrown straight up at `vy`. */
  const throwUp = (e: Entity, vy: number) => {
    const all = new Set(C.assemblyOf([e]));
    for (const x of [...all]) for (const a of x.attachedEntities()) all.add(a);
    for (const x of all) x.setVelocity(0, vy);
  };

  return [
    ['extra: safety: a seat belt and an airbag cut what a crash does to the pilot', () => {
      kit.reset();
      const a = crewed(-4, false);
      const b = crewed(4, true);
      if (a.seat.pilot !== a.h || b.seat.pilot !== b.h) return 'they didn’t sit in the seats';
      if (Math.abs(a.seat.cushion() - 1) > 1e-6) return `no belt, no airbag, the seat cushions to ${a.seat.cushion()}`;
      b.seat.belted = true;
      if (Math.abs(b.seat.cushion() - 0.6) > 1e-6) return `belted, the seat cushions to ${b.seat.cushion().toFixed(2)}`;
      // up 20 m and down onto the ground (21 m/s)
      throwUp(a.box, 20);
      throwUp(b.box, 20);
      kit.advance(5);
      if (!b.ab!.spent) return 'the crash didn’t set the airbag off';
      const ha = hurt(a.h);
      const hb = hurt(b.h);
      if (!(ha > 0.3)) return `unprotected, the crash hardly hurt them (${ha.toFixed(2)})`;
      if (!(hb < ha * 0.5)) return `belted with an airbag they lost ${hb.toFixed(2)}, unprotected ${ha.toFixed(2)}`;
      if (!b.h.alive) return 'belted with an airbag, they died';
      // F packs it again
      b.ab!.activate();
      if (b.ab!.spent) return 'F didn’t pack the airbag again';
      return true;
    }],
    ['extra: safety: pulling hard g greys out and then blacks out the pilot; eased off, they come round', () => {
      kit.reset();
      const { seat, h } = crewed(0, false);
      const g0 = game.gravity;
      game.setGravity(0);
      try {
        // round a centrifuge: 5 m out at 9 g, the seat's up to the middle
        const cx = 0;
        const cy = 30;
        const R = 5;
        const w = Math.sqrt((9 * 9.81) / R);
        const all = new Set(C.assemblyOf([seat]));
        for (const x of [...all]) for (const a of x.attachedEntities()) all.add(a);
        for (const x of all) for (const p of x.parts) if (!p.destroyed) p.teleport(p.x + R, p.y + cy - 1, p.bodyAngle);
        let worst = 0;
        game.advance(4, () => {
          const p = seat.main;
          const dx = p.x - cx;
          const dy = p.y - cy;
          const r = Math.hypot(dx, dy) || 1;
          const ux = -dx / r;
          const uy = -dy / r;
          // (along the circle, and back onto it)
          p.body.setLinvel({ x: -uy * w * R + ux * (r - R) * 5, y: ux * w * R + uy * (r - R) * 5 }, true);
          p.body.setRotation(Math.atan2(-ux, uy), true);
          p.body.setAngvel(w, true);
          worst = Math.max(worst, seat.strain);
        });
        if (!(seat.gz > 6)) return `round the centrifuge the seat feels ${seat.gz.toFixed(1)} g`;
        if (!(worst >= 1)) return `4 s at 9 g the pilot’s strain got to only ${worst.toFixed(2)}`;
        if (!(h.consciousness < 0.2)) return `blacked out, they’re ${(h.consciousness * 100).toFixed(0)}% conscious`;
        const hud = game.piloting.hudOf([seat]);
        if (hud && !((hud.strain ?? 0) >= 1)) return `the readout says strain ${hud.strain}`;
        // let go: drifting free
        game.advance(6, () => {});
        if (!(seat.strain < 0.1)) return `6 s weightless the strain is still ${seat.strain.toFixed(2)}`;
        if (!(h.consciousness > 0.3) && h.alive) return `6 s after, they’re still only ${(h.consciousness * 100).toFixed(0)}% conscious`;
      } finally {
        game.setGravity(g0);
      }
      return true;
    }],
    ['extra: safety: an automatic extinguisher puts out its own build on fire, and nothing else', () => {
      kit.reset();
      const crate = kit.spawn('crate', 0, 0.4);
      const ext = kit.spawn('fire-suppressor', 0.7, 0.5) as FireSuppressor;
      const other = kit.spawn('crate', 3, 0.4);
      kit.advance(0.3);
      weld(crate, ext, { x: 0.55, y: 0.5 });
      kit.advance(0.3);
      game.fire.ignite(crate.parts[0], 0.8);
      game.fire.ignite(other.parts[0], 0.8);
      kit.advance(1.5);
      if (crate.parts[0].burning > 0) return `1.5 s on its build is still burning (${crate.parts[0].burning.toFixed(2)})`;
      if (!(other.destroyed || other.parts[0].burning > 0)) return 'it put out a crate it isn’t built into';
      if (!(ext.charge < 12)) return 'it used none of its charge';
      return true;
    }],
  ];
}

import type { Test, TestCtx } from './types';
import type { Entity } from '../../world/Entity';
import { ITEMS } from '../../catalog/items';
import { isLiving } from '../../systems/Fighting';

/**
 * Everything in the toybox against the worst harms (0.3.0's "no flaws" gate): none of it
 * lives through a nuke going off on it whole (it comes apart, burns away or goes off),
 * all that runs on power or makes it is fried by a nuke's EMP from well outside its
 * blast, and all that burns catches in a fire.
 */
export default function tests({ game, kit }: TestCtx): Test[] {
  /** Each of the toybox's things (not tools, saved contraptions, people or animals), made alone; what's wrong with each, if anything. */
  const each = (pick: (e: Entity) => boolean, fn: (e: Entity) => string | null): string[] => {
    const bad: string[] = [];
    for (const d of ITEMS) {
      if (!d.create || d.tool || d.snapshot) continue;
      kit.reset();
      // (standing clear of the floor: a launch pad is 5 m tall)
      const e = kit.spawn(d.id, 0, Math.max(1.5, (d.halfHeight ?? 0) + 0.2));
      if (!e || e.destroyed || isLiving(e) || !pick(e)) continue;
      kit.advance(0.3);
      if (e.destroyed) continue;
      const why = fn(e);
      if (why) bad.push(`${d.id} (${why})`);
    }
    return bad;
  };
  const left = (e: Entity) => e.parts.filter((p) => !p.destroyed).length;
  return [
    ['extra: damage matrix: nothing in the toybox (not alive) lives through a nuke going off on it', () => {
      const bad = each(() => true, (e) => {
        const c = e.center();
        game.explosions.nuke(c.x, c.y, 0.1);
        kit.advance(1.5);
        return e.destroyed || !left(e) ? null : `${left(e)} of ${e.parts.length} parts whole`;
      });
      return bad.length ? `${bad.length} lived through it: ${bad.join(', ')}` : true;
    }],
    ['extra: damage matrix: all that runs on power or makes it in the toybox is fried by a nuke’s EMP from 20 m off, well outside its blast', () => {
      const electric = (e: Entity) => e.usesPower || typeof (e as { isPowerSource?: unknown }).isPowerSource === 'function';
      const bad = each(electric, (e) => {
        const c = e.center();
        game.explosions.nuke(c.x - 20, c.y, 0.1);
        kit.advance(0.1);
        if (e.destroyed) return 'destroyed 20 m off';
        return e.fried && !e.works ? null : `fried ${e.fried}, works ${e.works}`;
      });
      return bad.length ? `${bad.length} weren’t fried: ${bad.join(', ')}` : true;
    }],
    ['extra: damage matrix: everything in the toybox (not alive) is hurt, holed or set off by rifle rounds', () => {
      // (what touches nothing, a race gate or a fuel pump set in the background, rounds go past by design)
      const bad = each((e) => !e.parts[0].noCollideAll, (e) => {
        const p = e.parts.reduce((a, q) => (q.w * q.h > a.w * a.h ? q : a));
        const sum = () => e.parts.reduce((s, q) => s + (q.destroyed ? 0 : q.hp - q.holeCount), 0);
        const before = sum();
        // (through its middle, its collider, and its most solid row: a thing drawn in a corner of its picture, an airbag packed small, is hit, not the air beside it)
        let row = Math.floor(p.h / 2);
        let most = -1;
        for (let iy = 0; iy < p.h; iy++) {
          let n = 0;
          for (let ix = 0; ix < p.w; ix++) if (p.solidAt(ix, iy)) n++;
          if (n > most) {
            most = n;
            row = iy;
          }
        }
        // (each read as it's fired: a thing still falling has moved since the last)
        const aim = (i: number) => [p.y, p.colliders[0]?.translation().y ?? p.y, p.pixelToWorld(p.w / 2, row + 0.5).y][i];
        for (let i = 0; i < 3 && !e.destroyed && !p.destroyed; i++) {
          game.projectiles.fire(p.x - 3, aim(i), 1, 0, 900, { energy: 1500, damage: 34, push: 0.004 });
          kit.advance(0.15);
        }
        if (e.destroyed || p.destroyed) return null;
        return sum() < before ? null : 'untouched';
      });
      return bad.length ? `${bad.length} weren’t: ${bad.join(', ')}` : true;
    }],
    ['extra: damage matrix: all in the toybox that burns catches in a fire', () => {
      const burns = (e: Entity) => e.parts.some((p) => p.mat.flammability > 0);
      const bad = each(burns, (e) => {
        const p = e.parts.filter((q) => q.mat.flammability > 0).reduce((a, q) => (q.mat.flammability > a.mat.flammability ? q : a));
        game.fire.ignite(p, 1);
        kit.advance(2);
        if (e.destroyed || p.destroyed) return null;
        // (a flare lit by it burns its own way: see Flare)
        if ((e as { lit?: boolean }).lit) return null;
        return p.burning > 0.05 || p.charred > 0.05 ? null : `burning ${p.burning.toFixed(2)}, charred ${p.charred.toFixed(2)}`;
      });
      return bad.length ? `${bad.length} didn’t catch: ${bad.join(', ')}` : true;
    }],
  ];
}

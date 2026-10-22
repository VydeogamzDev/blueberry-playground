import { RAPIER } from '../engine/Physics';
import { COLOR_BITS, COLOR_SHIFT, GROUP, GROUPS_DYNAMIC, groups } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';

const COLORS = 16 - COLOR_SHIFT;
/** A colored entity's parts: never touch their own color, touch everything else. */
const COLORED = Array.from({ length: COLORS }, (_, c) => {
  const bit = 1 << (COLOR_SHIFT + c);
  return groups(GROUP.DYNAMIC | bit, GROUP.STATIC | GROUP.DEBRIS | GROUP.PLAIN | (COLOR_BITS & ~bit));
});
/** Room (m) kept between two entities of one color: more than Rapier's contact prediction distance. */
const MARGIN = 0.15;
/** The contact-filter hook: Rapier calls it about every pair of nearby colliders either of which has it. */
const HOOK = RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS;
/**
 * A hook for sensor pairs, of which there are none: no calls, but the pair counts as hooked, and
 * Rapier never reuses the contacts of a hooked pair (see the class comment).
 */
const NO_CALLS = RAPIER.ActiveHooks.FILTER_INTERSECTION_PAIRS;

interface Box {
  id: number;
  parts: Part[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  color: number;
  near: Box[];
}

/**
 * Keeps an entity's own parts apart with collision groups rather than the
 * contact-filter hook wherever it can.
 *
 * Rapier asks the hook (see Physics) about every pair of nearby colliders where
 * either has it, and each call crosses from WebAssembly into JS: a heap of 100
 * people makes 12 000 calls a step. Most only keep one entity's parts apart
 * (Part.group), which collision groups can do inside Rapier given a bit per
 * entity. There are 11 bits to spare, so they're handed out as colors that no two
 * entities within reach of each other share; a colored entity's parts leave their
 * own color out and need the hook no more (unless a part has pairs of its own to
 * skip, Part.noCollide), nor do parts on their own. Entities in a crowd too dense
 * for a free color stay plain, with the hook, as before. The same contacts come out.
 *
 * Parts without the hook get a hook that is never called instead (NO_CALLS):
 * Rapier reuses the contacts of a pair that has barely moved (by up to 5 cm)
 * rather than working them out again, except for hooked pairs. That would make a
 * heap's contact work a fifth, but its people never quite stop squirming, and the
 * game was tuned without it.
 */
export class ContactGroups {
  /** Off: every part plain (for comparisons). */
  enabled = true;
  private colorOf = new Map<number, number>();
  private byGroup = new Map<number, Part[]>();

  constructor(private game: Game) {}

  /** Runs just before each physics step, after anything that moves or regroups parts. */
  update(): void {
    const byGroup = this.byGroup;
    byGroup.clear();
    for (const e of this.game.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        // parts in no-collide mode only touch the floor and walls
        if (p.destroyed || p.noCollideAll || p.onlyStatic) continue;
        if (!this.enabled) set(p, GROUPS_DYNAMIC, HOOK);
        else if (p.group === 0) set(p, GROUPS_DYNAMIC, hookFor(p));
        else {
          let list = byGroup.get(p.group);
          if (!list) byGroup.set(p.group, (list = []));
          list.push(p);
        }
      }
    }
    // the bounds of each entity with parts to keep apart, where Rapier has them now
    // and wherever they may go this step (CCD sweeps them there, groups and all)
    const dt = this.game.stepDt;
    const boxes: Box[] = [];
    for (const [id, parts] of byGroup) {
      if (parts.length < 2) {
        set(parts[0], GROUPS_DYNAMIC, hookFor(parts[0]));
        continue;
      }
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of parts) {
        const b = p.body;
        const t = b.translation();
        const v = b.linvel();
        const r = p.reach + MARGIN + (Math.hypot(v.x, v.y) + Math.abs(b.angvel()) * p.reach) * dt;
        x0 = Math.min(x0, t.x - r);
        x1 = Math.max(x1, t.x + r);
        y0 = Math.min(y0, t.y - r);
        y1 = Math.max(y1, t.y + r);
      }
      boxes.push({ id, parts, x0, x1, y0, y1, color: this.colorOf.get(id) ?? -1, near: [] });
    }
    for (const id of this.colorOf.keys()) if ((byGroup.get(id)?.length ?? 0) < 2) this.colorOf.delete(id);
    boxes.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length && boxes[j].x0 <= a.x1; j++) {
        const b = boxes[j];
        if (b.y0 <= a.y1 && a.y0 <= b.y1) {
          a.near.push(b);
          b.near.push(a);
        }
      }
    }
    // a color shared with a neighbour is given up (by the first of the two)
    for (const b of boxes) if (b.color >= 0 && b.near.some((o) => o.color === b.color)) b.color = -1;
    // and the uncolored take the first color none of their neighbours has, if any
    for (const b of boxes) {
      if (b.color >= 0) continue;
      let used = 0;
      for (const o of b.near) if (o.color >= 0) used |= 1 << o.color;
      for (let c = 0; c < COLORS; c++) {
        if (!(used & (1 << c))) {
          b.color = c;
          break;
        }
      }
    }
    for (const b of boxes) {
      if (b.color >= 0) this.colorOf.set(b.id, b.color);
      else this.colorOf.delete(b.id);
      for (const p of b.parts) {
        if (b.color < 0) set(p, GROUPS_DYNAMIC, HOOK);
        else set(p, COLORED[b.color], hookFor(p));
      }
    }
  }
}

/** The hook only for pairs of its own to skip (a held item and the hand, a lodged blade): only it knows them. */
function hookFor(p: Part): RAPIER.ActiveHooks {
  return p.noCollide !== null && p.noCollide.size > 0 ? HOOK : NO_CALLS;
}

function set(p: Part, cg: number, hook: RAPIER.ActiveHooks): void {
  if (p.contactGroups === cg && p.contactHook === hook && p.contactN === p.colliders.length) return;
  for (const c of p.colliders) {
    c.setCollisionGroups(cg);
    c.setActiveHooks(hook);
  }
  p.contactGroups = cg;
  p.contactHook = hook;
  p.contactN = p.colliders.length;
}

import { RAPIER } from '../engine/Physics';
import { COLOR_BITS, COLOR_SHIFT, GROUP, GROUPS_DYNAMIC, groups } from '../engine/constants';
import type { Game } from '../world/Game';
import type { Part } from '../world/Part';
import { RIGID_KINDS } from './Connections';
import { rigidUnitsOf } from '../tools/Arrange';

/** A part held by this many welds, hinges or pins gets this many more solver iterations (stiffer contraptions). */
const BUSY_JOINTS = 3;
const EXTRA_ITERATIONS = 2;

const COLORS = 16 - COLOR_SHIFT;
/** A colored entity's parts: never touch their own color, touch everything else. */
const COLORED = Array.from({ length: COLORS }, (_, c) => {
  const bit = 1 << (COLOR_SHIFT + c);
  return groups(GROUP.DYNAMIC | bit, GROUP.STATIC | GROUP.DEBRIS | GROUP.PLAIN | (COLOR_BITS & ~bit));
});
/** Room (m) kept between two entities of one color: more than Rapier's contact prediction distance. */
const MARGIN = 0.15;
/** The contact-filter hook: Rapier calls it about every pair of nearby colliders either of which has it. */
let HOOK: RAPIER.ActiveHooks;
/**
 * A hook for sensor pairs, of which there are none: no calls, but the pair counts as hooked, and
 * Rapier never reuses the contacts of a hooked pair (see the class comment).
 */
let NO_CALLS: RAPIER.ActiveHooks;

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
 * Keeps the parts of things welded together apart with collision groups rather
 * than the contact-filter hook wherever it can.
 *
 * An entity's own parts (Part.group) Rapier keeps apart itself, before it even
 * looks at them as a pair (see Part.setContactFilter()). Things welded together
 * (a rigid unit, see Arrange.rigidUnitsOf()) are several entities, and the hook
 * would be asked about every pair of their parts. Collision groups do that inside
 * Rapier given a bit per unit: there are 11 bits to spare, so they're handed out
 * as colors that no two units within reach of each other share. A colored unit's
 * parts leave their own color out, so none of them touch each other, welded to
 * each other directly or not, and their welds' pairs need no hook (a contraption
 * of fifty welded planks made 2 500 calls a step). Units in a crowd too dense for
 * a free color stay plain, with the hook. The same contacts come out.
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
  private byUnit = new Map<number, Part[]>();
  /** The rigid units, by part (from 1), as the connections were at `unitsAt` (their version). */
  private units = new Map<Part, number>();
  private unitsAt = -1;
  /** Parts given extra solver iterations (see BUSY_JOINTS). */
  private stiff = new Set<Part>();

  constructor(private game: Game) {
    // (Rapier is only loaded once the game starts)
    HOOK = RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS;
    NO_CALLS = RAPIER.ActiveHooks.FILTER_INTERSECTION_PAIRS;
  }

  /** The rigid unit a part is in (0: none), as the colors have it. */
  unitOf(p: Part): number {
    return this.units.get(p) ?? 0;
  }

  /** The connections changed: the rigid units again, and the extra iterations of parts held by several joints. */
  private refreshUnits(): void {
    const C = this.game.connections;
    if (this.unitsAt === C.version) return;
    this.unitsAt = C.version;
    this.units = rigidUnitsOf(this.game);
    const joints = new Map<Part, number>();
    for (const k of C.list) {
      if (!RIGID_KINDS.has(k.kind) || !k.joint) continue;
      for (const p of [k.a, k.b]) if (p) joints.set(p, (joints.get(p) ?? 0) + 1);
    }
    const want = new Set<Part>();
    for (const [p, n] of joints) if (n >= BUSY_JOINTS && !p.destroyed) want.add(p);
    for (const p of this.stiff) if (!want.has(p) && !p.destroyed) p.body.setAdditionalSolverIterations(0);
    for (const p of want) if (!this.stiff.has(p)) p.body.setAdditionalSolverIterations(EXTRA_ITERATIONS);
    this.stiff = want;
  }

  /** Runs just before each physics step, after anything that moves or regroups parts. */
  update(): void {
    const byUnit = this.byUnit;
    byUnit.clear();
    this.refreshUnits();
    const units = this.units;
    for (const e of this.game.entities) {
      if (e.destroyed) continue;
      for (const p of e.parts) {
        // parts in no-collide mode only touch the floor and walls
        if (p.destroyed || p.noCollideAll || p.onlyStatic) continue;
        // (a rigid unit's parts are kept apart as one thing's)
        const u = units.get(p);
        if (!this.enabled) set(p, GROUPS_DYNAMIC, HOOK);
        else if (u === undefined) set(p, GROUPS_DYNAMIC, hookFor(p));
        else {
          let list = byUnit.get(u);
          if (!list) byUnit.set(u, (list = []));
          list.push(p);
        }
      }
    }
    // the bounds of each unit, where Rapier has them now
    // and wherever they may go this step (CCD sweeps them there, groups and all)
    const dt = this.game.stepDt;
    const boxes: Box[] = [];
    for (const [id, parts] of byUnit) {
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
    for (const id of this.colorOf.keys()) if ((byUnit.get(id)?.length ?? 0) < 2) this.colorOf.delete(id);
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
      const unit = new Set(b.parts);
      for (const p of b.parts) {
        if (b.color < 0) set(p, GROUPS_DYNAMIC, HOOK);
        else set(p, COLORED[b.color], hookOutside(p, unit));
      }
    }
  }
}

/** The hook only for pairs of its own to skip (a held item and the hand, a lodged blade): only it knows them. */
function hookFor(p: Part): RAPIER.ActiveHooks {
  return p.noCollide !== null && p.noCollide.size > 0 ? HOOK : NO_CALLS;
}

/** A rigid unit's part: the hook only for pairs to skip with something outside its unit (inside, its color keeps them apart). */
function hookOutside(p: Part, unit: Set<Part>): RAPIER.ActiveHooks {
  if (p.noCollide === null || !p.noCollide.size) return NO_CALLS;
  for (const q of p.noCollide) if (!unit.has(q)) return HOOK;
  return NO_CALLS;
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

import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT, GRAVITY } from './constants';
import type { Part } from '../world/Part';

export { RAPIER };

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/**
 * Thin wrapper over the Rapier world: owns the event queue, contact filtering hooks
 * and the collider-handle -> Part lookup used by every gameplay system.
 */
export class Physics {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly partByCollider = new Map<number, Part>();
  /** Colliders made since the last step: scene queries only see them after it. */
  fresh: RAPIER.Collider[] = [];
  /** Number of steps simulated so far. */
  stepCount = 0;

  private hooks: RAPIER.PhysicsHooks;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY });
    const ip = this.world.integrationParameters;
    ip.dt = FIXED_DT;
    ip.numSolverIterations = 6;
    // two internal (TGS) iterations let heaps of ragdolls settle instead of buzzing
    ip.numInternalPgsIterations = 2;
    ip.maxCcdSubsteps = 2;
    this.events = new RAPIER.EventQueue(true);

    const map = this.partByCollider;
    const COMPUTE = RAPIER.SolverFlags.COMPUTE_IMPULSE;
    this.hooks = {
      filterContactPair(c1: number, c2: number): RAPIER.SolverFlags | null {
        const p1 = map.get(c1);
        const p2 = map.get(c2);
        if (!p1 || !p2) return COMPUTE;
        // parts sharing a non-zero group (e.g. the limbs of one ragdoll) never touch
        if (p1.group !== 0 && p1.group === p2.group) return null;
        if (p1.noCollide !== null && p1.noCollide.has(p2)) return null;
        if (p2.noCollide !== null && p2.noCollide.has(p1)) return null;
        return COMPUTE;
      },
      filterIntersectionPair(): boolean {
        return true;
      },
    };
  }

  step(): void {
    this.world.step(this.events, this.hooks);
    this.stepCount++;
    this.fresh = [];
  }

  /** Do two parts' colliders currently interpenetrate? */
  overlaps(a: Part, b: Part, depth = 0.004): boolean {
    let hit = false;
    for (const c1 of a.colliders) {
      for (const c2 of b.colliders) {
        this.world.contactPair(c1, c2, (m) => {
          for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < -depth) hit = true;
        });
        if (hit) return true;
      }
    }
    return false;
  }

  partOf(collider: RAPIER.Collider | number): Part | undefined {
    return this.partByCollider.get(typeof collider === 'number' ? collider : collider.handle);
  }
}

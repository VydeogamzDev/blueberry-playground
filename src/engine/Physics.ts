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
    // internal (TGS) iterations let heaps of ragdolls settle instead of buzzing:
    // three halve the step-to-step wobble of limbs squeezed in a pile compared
    // with two (to about 0.1 mm, under 1 mm in the worst 1%) for ~5% more time
    ip.numInternalPgsIterations = 3;
    // one CCD substep (Rapier's default): with two, a fast object anywhere in the
    // world splits the whole step, and over the short first substep an ordinary
    // contact elsewhere (an animal's paw touching down at 2.5 m/s) is corrected
    // as if it were deep: the paw was kicked up at 20 m/s, flipping the animal
    ip.maxCcdSubsteps = 1;
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

  private dt = FIXED_DT;

  /**
   * Contact force thresholds are set for FIXED_DT steps. Rapier reports a knock
   * as its impulse over the step, so over a longer step the same knock reports
   * less force: the thresholds scale with it (a needle would no longer stab in).
   */
  get forceScale(): number {
    return FIXED_DT / this.dt;
  }

  /** Sets the length of the next steps (s). */
  setDt(dt: number): void {
    if (dt === this.dt) return;
    const k = this.dt / dt;
    this.dt = dt;
    const ip = this.world.integrationParameters;
    ip.dt = dt;
    // contacts predicted as many steps ahead as at FIXED_DT (Rapier's default 2 cm
    // there): over a 60th of a second a paw landing at 4 m/s sinks 6 cm into the
    // ground, and pushed back out of it the animal bounces off its feet
    ip.normalizedPredictionDistance = 0.02 * (dt / FIXED_DT);
    this.world.colliders.forEach((c) => c.setContactForceEventThreshold(c.contactForceEventThreshold() * k));
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

import type R from '@dimforge/rapier2d-compat';
import { FIXED_DT, GRAVITY } from './constants';
import type { Part } from '../world/Part';
import type { Entity } from '../world/Entity';
import { initThreads } from './threads';

/**
 * Rapier, as loaded by initPhysics(): its SIMD build wherever the browser runs
 * WebAssembly SIMD (every current one: steps of crowded scenes take ~40% less
 * time), the plain build elsewhere (?nosimd forces it). Where the page may also
 * share memory between threads, the SIMD build that steps on a pool of worker
 * threads (see physicsThreads()). They all have the same API; the types come
 * from the plain one.
 */
export let RAPIER: typeof R = undefined as unknown as typeof R;
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace RAPIER {
  export type World = R.World;
  export type RigidBody = R.RigidBody;
  export type RigidBodyDesc = R.RigidBodyDesc;
  export type RigidBodyType = R.RigidBodyType;
  export type Collider = R.Collider;
  export type ColliderDesc = R.ColliderDesc;
  export type Cuboid = R.Cuboid;
  export type Ball = R.Ball;
  export type ConvexPolygon = R.ConvexPolygon;
  export type ImpulseJoint = R.ImpulseJoint;
  export type RevoluteImpulseJoint = R.RevoluteImpulseJoint;
  export type PrismaticImpulseJoint = R.PrismaticImpulseJoint;
  export type JointData = R.JointData;
  export type MotorModel = R.MotorModel;
  export type Ray = R.Ray;
  export type RayColliderHit = R.RayColliderHit;
  export type EventQueue = R.EventQueue;
  export type PhysicsHooks = R.PhysicsHooks;
  export type ActiveHooks = R.ActiveHooks;
  export type ActiveEvents = R.ActiveEvents;
  export type SolverFlags = R.SolverFlags;
  export type QueryFilterFlags = R.QueryFilterFlags;
}

/** Does this browser run WebAssembly SIMD? (Validates a function using one v128 instruction.) */
function simdSupported(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

/** Can this page share memory between threads? (Only a cross-origin isolated one: see vite.config.ts.) */
function sharedMemorySupported(): boolean {
  try {
    return globalThis.crossOriginIsolated === true && new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

/**
 * How many worker threads the physics engine steps on, besides this one, which works
 * on each step with them: 0 for none (Rapier's single-threaded build). ?threads=N
 * sets it. One for each core, as a rule (logical processors come two to a core), up to
 * 6: 100 people crushed at once step about 10% faster on 6 than on 4, and no faster on 8.
 */
function physicsThreads(): number {
  const asked = new URLSearchParams(location.search).get('threads');
  if (import.meta.env.MODE === 'standalone' || !sharedMemorySupported()) return 0;
  if (asked !== null) return Math.max(0, Math.min(16, Math.floor(Number(asked)) || 0));
  return Math.max(0, Math.min(6, Math.floor((navigator.hardwareConcurrency || 1) / 2)));
}

/** Which build of Rapier initPhysics() loaded. */
export let rapierBuild: 'threads' | 'simd' | 'plain' = 'plain';

export async function initPhysics(): Promise<void> {
  rapierBuild = new URLSearchParams(location.search).has('nosimd') || !simdSupported() ? 'plain' : 'simd';
  const threads = rapierBuild === 'simd' ? physicsThreads() : 0;
  if (threads > 0) {
    try {
      RAPIER = await initThreads(threads);
      rapierBuild = 'threads';
      return;
    } catch (e) {
      console.warn('physics on one thread:', e);
    }
  }
  RAPIER = rapierBuild === 'plain'
    ? (await import('@dimforge/rapier2d-compat')).default
    : ((await import('@dimforge/rapier2d-simd-compat')).default as unknown as typeof R);
  await RAPIER.init();
}

/**
 * Thin wrapper over the Rapier world: owns the event queue, contact filtering hooks
 * and the collider-handle -> Part lookup used by every gameplay system.
 *
 * Contacts are filtered by Rapier itself wherever it can be (our build of it: see
 * tools/rapier): each part's colliders carry its group (Part.setContactFilter()),
 * and pairs of one group are refused without a call into JS. Only the pairs of a
 * part with some of its own to refuse (Part.noCollide) still come to the hook
 * here: a heap of 100 people made ~6 000 calls a step, each crossing from
 * WebAssembly into JS.
 */
export class Physics {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly partByCollider = new Map<number, Part>();
  /**
   * The same by the collider's index (a handle's low 32 bits; handles are f64 bit patterns,
   * index | generation << 32), with its handle there: quicker than the map, keyed by f64s.
   */
  private partAt: (Part | undefined)[] = [];
  private handleAt: number[] = [];
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
    const COMPUTE = RAPIER.SolverFlags.COMPUTE_IMPULSE;
    this.hooks = {
      // (asked only about pairs Rapier's own filter can't settle: none of the game's)
      filterContactPair: (c1: number, c2: number): RAPIER.SolverFlags | null => {
        const p1 = this.partOf(c1);
        const p2 = this.partOf(c2);
        if (!p1 || !p2) return COMPUTE;
        // parts sharing a non-zero group (e.g. the limbs of one ragdoll) never touch
        // (Rapier keeps them apart itself before this could be asked: see Part.setContactFilter())
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
    // (null: a collider removed since the last step, which its contacts still name)
    if (collider === null) return undefined;
    const h = typeof collider === 'number' ? collider : collider.handle;
    HANDLE[0] = h;
    const i = INDEX[0];
    return this.handleAt[i] === h ? this.partAt[i] : undefined;
  }

  /**
   * Keeps two parts from touching, once more (or once less: `excluded` false). Rapier's
   * contact filter does, for parts with a noCollide (see Part.noCollideWith()).
   */
  excludePair(a: Part, b: Part, excluded: boolean): void {
    if (a.destroyed || b.destroyed) return;
    this.world.physicsPipeline.setBodyPairExcluded(a.body.handle, b.body.handle, excluded);
  }

  /** Forgets the pairs kept apart with a body that's going. */
  forgetBody(body: RAPIER.RigidBody): void {
    this.world.physicsPipeline.forgetBodyPairs(body.handle);
  }

  private syncing: Part[] = [];
  private syncHandles = new Float64Array(1024);

  /**
   * Part.sync() for every part of these: where each is and how it's moving, read out of
   * Rapier with one call for them all (four for each otherwise: thousands in a heap).
   */
  syncAll(entities: readonly Entity[]): void {
    const s = this.readStates(entities);
    const parts = this.syncing;
    for (let i = 0; i < parts.length; i++) parts[i].syncFrom(s, i * 6);
    parts.length = 0;
  }

  /**
   * Where every part of these is now, for what's asked of them before syncAll() (see
   * Part.bodyX): read as it is, with one call for them all, after a step that moved them.
   */
  readPoses(entities: readonly Entity[]): void {
    const s = this.readStates(entities);
    const parts = this.syncing;
    for (let i = 0; i < parts.length; i++) parts[i].poseFrom(s, i * 6);
    parts.length = 0;
  }

  /** The states (see RigidBodySet.states()) of the parts of these, which are left in this.syncing. */
  private readStates(entities: readonly Entity[]): Float32Array {
    const parts = this.syncing;
    parts.length = 0;
    for (const e of entities) for (const p of e.parts) if (!p.destroyed) parts.push(p);
    const n = parts.length;
    if (this.syncHandles.length < n) this.syncHandles = new Float64Array(n * 2);
    const hs = this.syncHandles;
    for (let i = 0; i < n; i++) hs[i] = parts[i].body.handle;
    return this.world.bodies.states(hs.subarray(0, n));
  }

  /** Makes a part's new collider known. */
  addCollider(c: RAPIER.Collider, part: Part): void {
    const h = c.handle;
    this.partByCollider.set(h, part);
    HANDLE[0] = h;
    const i = INDEX[0];
    // (filled up to it first: an array with holes is a slower kind)
    while (this.partAt.length < i) {
      this.partAt.push(undefined);
      this.handleAt.push(-1);
    }
    this.partAt[i] = part;
    this.handleAt[i] = h;
  }

  /** Forgets a part's collider (as the part goes). */
  removeCollider(c: RAPIER.Collider): void {
    const h = c.handle;
    this.partByCollider.delete(h);
    HANDLE[0] = h;
    const i = INDEX[0];
    if (this.handleAt[i] === h) {
      this.partAt[i] = undefined;
      this.handleAt[i] = -1;
    }
  }
}

/** A handle's bits, to read its index from. */
const HANDLE = new Float64Array(1);
const INDEX = new Uint32Array(HANDLE.buffer);

/** A body's or collider's place in Rapier's set: no two that are there at once share one. */
export function handleIndex(h: number): number {
  HANDLE[0] = h;
  return INDEX[0];
}

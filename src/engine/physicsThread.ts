/**
 * A worker running one of the physics engine's threads (see initThreads in threads.ts):
 * given Rapier's module and the memory it shares with the page, it instantiates Rapier
 * on that memory, says so, and runs its thread of the pool, never returning.
 */
import RAPIER from '@dimforge/rapier2d-simd-mt-compat';

const scope = self as unknown as { onmessage: ((e: MessageEvent<RAPIER.ThreadShare>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (e) => {
  RAPIER.initWorker(e.data);
  scope.postMessage('running');
  RAPIER.runThreadPoolWorker();
};

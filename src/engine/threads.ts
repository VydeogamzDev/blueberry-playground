import type R from '@dimforge/rapier2d-compat';

/**
 * Loads Rapier's threaded build and starts its pool: one worker per thread (physicsThread.ts),
 * running on the memory of this one. Every world made afterwards steps on the pool.
 * (The standalone page has none of this: see vite.config.ts.)
 */
export async function initThreads(threads: number): Promise<typeof R> {
  const mt = (await import('@dimforge/rapier2d-simd-mt-compat')).default;
  await mt.init();
  const share = mt.initThreadPool(threads);
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./physicsThread.ts', import.meta.url), { type: 'module', name: 'physics' });
    worker.onmessage = () => resolve();
    worker.onerror = (e) => reject(new Error(`a physics thread didn't start: ${e.message}`));
    setTimeout(() => reject(new Error("a physics thread didn't start in 15 s")), 15000);
    worker.postMessage(share);
  })));
  return mt as unknown as typeof R;
}

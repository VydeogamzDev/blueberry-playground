/**
 * Initializes RAPIER.
 * Has to be called and awaited before using any library methods.
 *
 * (This build's memory is shared, which needs a cross-origin isolated page.)
 */
export declare function init(): Promise<void>;
/** What a worker running a thread of the pool needs (see `initWorker`). */
export interface ThreadShare {
    module: WebAssembly.Module;
    memory: WebAssembly.Memory;
}
/**
 * Makes the pool of threads that every physics pipeline (so every world) made afterwards
 * steps on: the calling thread, which works on each step with the rest and waits for them by
 * spinning, and `threads` more, each waiting for a worker to run it: start `threads` module
 * workers, post each what this returns, have each call `initWorker` with it and then
 * `runThreadPoolWorker`, and let them start (they can't while the calling thread keeps busy)
 * before stepping.
 */
export declare function initThreadPool(threads: number): ThreadShare;
/** In a worker: instantiates RAPIER on the memory of the thread that made the pool. */
export declare function initWorker(share: ThreadShare): void;
/** In a worker, after `initWorker`: runs a thread of the pool, never returning. */
export declare function runThreadPoolWorker(): void;

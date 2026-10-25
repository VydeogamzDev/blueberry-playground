# The game's Rapier

The game runs [Rapier](https://rapier.rs) 0.36.0 (its JS packages' 0.21.0), built from the
release with a patch of ours. The three packages the game loads (see `initPhysics` in
`src/engine/Physics.ts`) live built in `vendor/rapier`, and `package.json` installs them from
there:

| package | for |
|---|---|
| `@dimforge/rapier2d-compat` | browsers without WebAssembly SIMD (`?nosimd`) |
| `@dimforge/rapier2d-simd-compat` | every other browser, stepping on the page's own thread (`?threads=0`) |
| `@dimforge/rapier2d-simd-mt-compat` | pages that may share memory between threads (cross-origin isolated: the dev server, the desktop app): steps on a pool of worker threads (`src/engine/physicsThread.ts`) |

To change them: edit the patch (or a checkout with it applied, then remake it, below), and
run `sh tools/rapier/build.sh` (or `build.sh threads`, say, for one of them). It takes a while
the first time: the threaded build rebuilds Rust's standard library.

## What the patch changes

- **Contact filtering without JS.** A collider's user data can carry contact-filter rules
  (`Collider.setContactFilter(group, asks)`) that the filter hook applies in Rust: colliders
  sharing a non-zero group never touch, and bodies kept apart with
  `PhysicsPipeline.setBodyPairExcluded` don't either. The game's pairs never call into JS.
  (`ColliderSet::set_user_data` sets user data without marking the collider modified, which
  would make the broad phase look at it again.)
- **A thing's own parts are never a pair.** That group is also the collider's exclusion group
  (`ColliderFlags::exclusion_group`), which the broad phase, the narrow phase and CCD respect:
  colliders sharing a non-zero one aren't paired at all, so there are no pairs of one ragdoll's
  limbs to filter, nor contacts to work out between them.
- **Contact force events in one call.** `EventQueue.drainContactForceEventsFlat(bodies)`
  returns them all as numbers, each with its contact point (taken when the event is, worked
  out where the step left the bodies).
- **Many rays in one call.** `World.castRaysAndGetNormal(rays, ...)` (the blood and debris
  particles), cast on the thread pool when there is one.
- **Who touches whom in one call.** `World.contactBodyPairs()` and `World.jointBodyPairs()`:
  every pair the narrow phase has, and every impulse joint, as its two bodies' handles and
  whether they touch and are fixed or asleep. The game's check for heaps at rest
  (`src/systems/Settle.ts`) asked that collider by collider, a few calls each way: in a heap
  of 100 people, a frame's worth of time every half second.
- **No scans of everything after each step.** Rapier's JS layer looked over every body,
  collider and joint after each step, and every collider after each rigid-body removal, for
  what soft bodies may have made or removed on their own: only when there are soft bodies now.
- **The threaded build** (`builds/rapier2d-simd-mt`, feature `threads`): Rapier's `parallel`
  feature on a rayon pool whose threads are Web Workers sharing the module's memory
  (`src/threads.rs`; in the package, `initThreadPool`, `initWorker`, `runThreadPoolWorker`).
  The calling thread waits for each step by spinning, since a browser's main thread can't
  block: rayon-core 1.13.0 is patched for that (`rayon-core.patch`: its latch for threads
  outside the pool spins, as do two locks they take). The JS hooks can't be called from the
  pool's threads, so this build applies only the colliders' own contact-filter rules. Steps
  come out the same as the single-threaded build's.
  - Its memory grows 16 MB at a time (`src/alloc.rs`). Growing a memory the threads share
    stops every one of them, and Rust's allocator grew it a few pages at a time, dozens of
    times a step in a crush: the narrow phase took twice as long.
  - The solver shares out more of a dense heap's contacts and joints: the colors too small to
    share out are colored again into a few that can be (instead of worker 0 solving a fifth
    of the contacts alone), a color is shared out from 4 SIMD chunks (not 8), and removed
    pairs give their colors back. The narrow phase finds a pair's edge by key, not by walking
    a collider's edges (the floor's run to hundreds).
- **Builds**: wasm-opt's `-O4` without inlining big functions into their only caller (that
  made the narrow phase slower), and each package loads its `.wasm` from the file beside it.

## Remaking the patches

In the checkout `build.sh` made (`~/.cache/bp-rapier/rapier`, or `$RAPIER_WORK`), after
changing it:

```sh
git add -A -f bindings/typescript/builds/*/Cargo.toml bindings/typescript/src bindings/typescript/src.ts bindings/typescript/rapier-compat/src2d-mt bindings/typescript/Cargo.toml src
git diff --cached > path/to/game/tools/rapier/rapier.patch
cp bindings/typescript/Cargo.lock path/to/game/tools/rapier/Cargo.lock
```

and for rayon-core, `git diff > path/to/game/tools/rapier/rayon-core.patch` in
`~/.cache/bp-rapier/rayon-core`. (`build.sh` checks both out afresh each time it runs: build from
the patches once remade.)

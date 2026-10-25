import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Rapier's packages (our builds of them: see tools/rapier) load their WebAssembly from the
 * .wasm beside them, which the build emits as an asset. The standalone page carries that file
 * itself instead, as window.BP_ASSETS['rapier2d(-simd).wasm'] (see tools/standalone.mjs).
 */
function standaloneRapierWasm(): Plugin {
  return {
    name: 'standalone-rapier-wasm',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const m = /rapier2d(-simd)?-compat[\\/]dist[\\/]rapier\.mjs$/.exec(id);
      if (!m) return null;
      const name = `rapier2d${m[1] ?? ''}.wasm`;
      this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(dirname(id), 'rapier_wasm2d_bg.wasm')) });
      const out = code.replace('new URL("./rapier_wasm2d_bg.wasm",import.meta.url)', () => `globalThis.BP_ASSETS[${JSON.stringify(name)}]`);
      if (out === code) this.error("Rapier's WebAssembly URL not found: has the Rapier package changed?");
      return { code: out, map: null };
    },
  };
}

/**
 * The standalone page, opened from disk, is never cross-origin isolated, so it can't step the
 * physics on threads: it goes without src/engine/threads.ts, and so without the threaded build's
 * worker and WebAssembly (2.6 MB), which the build would put in it even where they can't run.
 */
function standaloneNoThreads(): Plugin {
  return {
    name: 'standalone-no-threads',
    enforce: 'pre',
    load(id) {
      if (!/[\\/]src[\\/]engine[\\/]threads\.ts$/.test(id)) return null;
      return 'export async function initThreads() { throw new Error("no physics threads on the standalone page"); }';
    },
  };
}

/**
 * A cross-origin isolated page may share memory between threads, as the physics engine's
 * threads do (see initPhysics): served with these, and loading nothing from other origins
 * that doesn't allow it. (The desktop app serves them too: desktop/main.cjs.)
 */
const ISOLATED = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig(({ mode }) => {
  // `vite build --mode standalone`: the one script the standalone page runs (see tools/standalone.mjs)
  const standalone = mode === 'standalone';
  return {
    base: standalone ? './' : '/',
    plugins: standalone ? [standaloneRapierWasm(), standaloneNoThreads()] : [],
    // (the physics engine's threads: each a worker loading Rapier)
    worker: { format: 'es' },
    server: { port: 5173, strictPort: false, headers: ISOLATED },
    preview: { headers: ISOLATED },
    build: {
      target: 'es2022',
      outDir: standalone ? 'dist-standalone' : 'dist',
      // three.js alone is ~530 kB (and the standalone script is everything)
      chunkSizeWarningLimit: standalone ? 4000 : 600,
      // (the standalone page's stylesheet is written into it: its fonts go in with it, as data)
      assetsInlineLimit: standalone ? (file: string) => (/\.woff2?$/.test(file) ? true : undefined) : undefined,
      modulePreload: !standalone,
      rollupOptions: {
        output: standalone
          ? { codeSplitting: false }
          : {
              // the engine libraries change far less often than the game: separate files cache separately
              manualChunks(id: string) {
                if (id.includes('node_modules/three')) return 'three';
                // only one of the Rapier builds is loaded (see initPhysics)
                if (/rapier2d-simd-mt-compat[\\/]/.test(id)) return 'rapier-threads';
                if (/rapier2d-simd-compat[\\/]/.test(id)) return 'rapier-simd';
                if (/rapier2d-compat[\\/]/.test(id)) return 'rapier';
                return undefined;
              },
            },
      },
    },
  };
});

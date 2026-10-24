import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Rapier's compat packages (plain and SIMD) inline their 2.4 MB WebAssembly in the JavaScript as
 * base64. The build loads the .wasm file the package also ships instead: a
 * third smaller to download, and the browser compiles it while it streams in.
 * The standalone page carries that file itself, as window.BP_ASSETS['rapier2d(-simd).wasm']
 * (see tools/standalone.mjs). (The dev server keeps the inlined copy.)
 */
function rapierWasmFile(standalone: boolean): Plugin {
  return {
    name: 'rapier-wasm-file',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const m = /rapier2d(-simd)?-compat[\\/]dist[\\/]rapier\.mjs$/.exec(id);
      if (!m) return null;
      let wasm = 'new URL("./rapier_wasm2d_bg.wasm",import.meta.url)';
      if (standalone) {
        const name = `rapier2d${m[1] ?? ''}.wasm`;
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(dirname(id), 'rapier_wasm2d_bg.wasm')) });
        wasm = `globalThis.BP_ASSETS[${JSON.stringify(name)}]`;
      }
      const out = code.replace(/\{module_or_path:[\w$]+\.toByteArray\("[A-Za-z0-9+/=]+"\)(\.buffer)?\}/, () => `{module_or_path:${wasm}}`);
      if (out === code) this.error('inlined Rapier WebAssembly not found: has the Rapier package changed?');
      return { code: out, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode standalone`: the one script the standalone page runs (see tools/standalone.mjs)
  const standalone = mode === 'standalone';
  return {
    base: standalone ? './' : '/',
    plugins: [rapierWasmFile(standalone)],
    server: { port: 5173, strictPort: false },
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
                // only one of the two Rapier builds is loaded (see initPhysics)
                if (id.includes('node_modules/@dimforge/rapier2d-simd-compat')) return 'rapier-simd';
                if (id.includes('node_modules/@dimforge')) return 'rapier';
                return undefined;
              },
            },
      },
    },
  };
});

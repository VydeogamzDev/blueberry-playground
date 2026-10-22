import { defineConfig, type Plugin } from 'vite';

/**
 * Rapier's compat packages (plain and SIMD) inline their 2.4 MB WebAssembly in the JavaScript as
 * base64. The build loads the .wasm file the package also ships instead: a
 * third smaller to download, and the browser compiles it while it streams in.
 * (The dev server keeps the inlined copy.)
 */
function rapierWasmFile(): Plugin {
  return {
    name: 'rapier-wasm-file',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/rapier2d(-simd)?-compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
      const out = code.replace(
        /\{module_or_path:[\w$]+\.toByteArray\("[A-Za-z0-9+/=]+"\)(\.buffer)?\}/,
        '{module_or_path:new URL("./rapier_wasm2d_bg.wasm",import.meta.url)}',
      );
      if (out === code) this.error('inlined Rapier WebAssembly not found: has the Rapier package changed?');
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [rapierWasmFile()],
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    // three.js alone is ~530 kB
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // the engine libraries change far less often than the game: separate files cache separately
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          // only one of the two Rapier builds is loaded (see initPhysics)
          if (id.includes('node_modules/@dimforge/rapier2d-simd-compat')) return 'rapier-simd';
          if (id.includes('node_modules/@dimforge')) return 'rapier';
          return undefined;
        },
      },
    },
  },
});

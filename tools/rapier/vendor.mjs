// node vendor.mjs <built dist> <vendor dir> <package name>: puts one of build.sh's packages in
// vendor/rapier, as the game installs it: the bundle, made to load its WebAssembly from the
// .wasm beside it (not the copy inlined as base64), the types, the .wasm and a package.json.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [from, to, name] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
rmSync(to, { recursive: true, force: true });
mkdirSync(join(to, 'dist'), { recursive: true });

const bundle = readFileSync(join(from, 'rapier.mjs'), 'utf8');
const url = bundle.replace(/\{module_or_path:[\w$]+\.toByteArray\("[A-Za-z0-9+/=]+"\)(\.buffer)?\}/, () => '{module_or_path:new URL("./rapier_wasm2d_bg.wasm",import.meta.url)}');
if (url === bundle) throw new Error(`${from}/rapier.mjs: its inlined WebAssembly wasn't found`);
writeFileSync(join(to, 'dist', 'rapier.mjs'), url);
cpSync(join(from, 'rapier_wasm2d_bg.wasm'), join(to, 'dist', 'rapier_wasm2d_bg.wasm'));
// every declaration file, where it is
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.d.ts')) {
      const out = join(to, 'dist', relative(from, p));
      mkdirSync(dirname(out), { recursive: true });
      cpSync(p, out);
    }
  }
};
walk(from);
if (!existsSync(join(to, 'dist', 'rapier.d.ts'))) throw new Error(`${from}: no rapier.d.ts`);
writeFileSync(join(to, 'package.json'), JSON.stringify({
  name,
  version: '0.21.0',
  description: "Rapier's 2D physics engine, as Blueberry Playground builds it (see tools/rapier in the game)",
  license: 'Apache-2.0',
  type: 'module',
  module: 'dist/rapier.mjs',
  types: 'dist/rapier.d.ts',
  exports: { '.': { types: './dist/rapier.d.ts', import: './dist/rapier.mjs' } },
  sideEffects: false,
}, null, 2) + '\n');
cpSync(join(here, 'LICENSE'), join(to, 'LICENSE'));
console.log(`${name}: ${(statSync(join(to, 'dist', 'rapier_wasm2d_bg.wasm')).size / 1e6).toFixed(2)} MB of WebAssembly`);

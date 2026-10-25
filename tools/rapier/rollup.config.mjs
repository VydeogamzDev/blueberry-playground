// The TS API and wasm-bindgen glue of one of build.sh's packages ($BP_VARIANT: 2d, 2d-simd or
// 2d-simd-mt) bundled into one module, as Rapier's own compat build does (its .wasm inlined as
// base64: vendor.mjs then has it load the file beside it instead). Run from rapier-compat.
import commonjs from "@rollup/plugin-commonjs";
import {nodeResolve} from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import path from "node:path";
import {base64} from "rollup-plugin-base64";

const dir = `builds/${process.env.BP_VARIANT}`;

export default {
    input: `${dir}/gen2d/rapier.ts`,
    output: {file: `${dir}/pkg/dist/rapier.mjs`, format: "es", exports: "named"},
    plugins: [
        base64({include: "**/*.wasm"}),
        terser(),
        nodeResolve(),
        commonjs(),
        typescript({tsconfig: path.resolve(`${dir}/tsconfig.pkg.json`)}),
    ],
};

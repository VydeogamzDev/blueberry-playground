#!/bin/sh
# Builds the game's three Rapier packages (see README.md) into vendor/rapier:
#   sh tools/rapier/build.sh [plain] [simd] [threads]      (all three when none is named)
# Rapier is checked out at $RAPIER_WORK (default ~/.cache/bp-rapier: a short path, since the
# threaded build's nested directories pass Windows' path limit under a long one), at the
# release the game's patch is for, and patched. Cargo runs 2 jobs at a time.
# Needs git, curl, Node, Rust stable and nightly (with rust-src) for wasm32-unknown-unknown,
# wasm-bindgen 0.2.129 and Binaryen's wasm-opt ($WASM_BINDGEN and $WASM_OPT, or on the PATH).
set -e
here=$(cd "$(dirname "$0")" && pwd)
game=$(cd "$here/../.." && pwd)
work=${RAPIER_WORK:-$HOME/.cache/bp-rapier}
WB=${WASM_BINDGEN:-wasm-bindgen}
WO=${WASM_OPT:-wasm-opt}
variants=${*:-plain simd threads}
"$WB" --version | grep -q ' 0\.2\.129' || { echo "wasm-bindgen 0.2.129 needed (cargo install wasm-bindgen-cli --version 0.2.129)"; exit 1; }

# ---- Rapier at its 0.36.0 release (the JS packages' 0.21.0), patched
R="$work/rapier"
if [ ! -d "$R/.git" ]; then
  mkdir -p "$work"
  # (as the repository has them: the patch is made with LF line ends)
  git -c core.autocrlf=false clone --quiet --no-checkout https://github.com/dimforge/rapier.git "$R"
  git -C "$R" config core.autocrlf false
fi
git -C "$R" checkout --quiet --force js-v0.21.0
# (ignored files too: the patch adds some, under builds/; the packages' npm modules stay)
git -C "$R" clean --quiet -fdx -e node_modules
git -C "$R" apply --whitespace=nowarn "$here/rapier.patch"
# its own bindings' Cargo.lock isn't kept in its repository: ours pins what we built with
cp "$here/Cargo.lock" "$R/bindings/typescript/Cargo.lock"
# rayon-core 1.13.0, patched so the thread waiting on the pool spins (a browser's main thread
# can't block), where the bindings' Cargo.toml has it: in a repository, to remake the patch from
RC="$work/rayon-core"
if [ ! -d "$RC/.git" ]; then
  rm -rf "$RC" "$work/rayon-core-1.13.0"
  curl -sSfL https://static.crates.io/crates/rayon-core/rayon-core-1.13.0.crate | tar -xzf - -C "$work"
  mv "$work/rayon-core-1.13.0" "$RC"
  git -C "$RC" init --quiet
  git -C "$RC" config core.autocrlf false
  git -C "$RC" add -A
  git -C "$RC" -c user.name=build.sh -c user.email=build.sh@localhost commit --quiet -m "rayon-core 1.13.0"
fi
git -C "$RC" checkout --quiet --force .
git -C "$RC" apply --whitespace=nowarn "$here/rayon-core.patch"

T="$R/bindings/typescript"
C="$T/rapier-compat"
(cd "$C" && [ -d node_modules ] || npm install --no-audit --no-fund --silent)

# ---- one package: <variant> <crate> <package> <target dir> <toolchain> <rustflags> <wasm-opt flags> <init.ts dir>
pack() {
  variant=$1 crate=$2 name=$3 tdir=$4 chain=$5 flags=$6 optflags=$7 initdir=$8
  echo "== $name"
  cd "$T"
  if [ "$chain" = nightly ]; then
    RUSTFLAGS="$flags" CARGO_BUILD_JOBS=2 CARGO_TARGET_DIR="$tdir" \
      cargo +nightly build --quiet --release --target wasm32-unknown-unknown --manifest-path "builds/$crate/Cargo.toml" -Z build-std=panic_abort,std
  else
    RUSTFLAGS="$flags" CARGO_BUILD_JOBS=2 CARGO_TARGET_DIR="$tdir" \
      cargo build --quiet --release --target wasm32-unknown-unknown --manifest-path "builds/$crate/Cargo.toml"
  fi
  B="$C/builds/$variant"
  rm -rf "$B" && mkdir -p "$B/wasm-build" "$B/pkg/dist"
  "$WB" "$tdir/wasm32-unknown-unknown/release/rapier_wasm2d.wasm" --out-dir "$B/wasm-build" --typescript --target web
  # (-O4, but big functions with one caller stay apart: inlined, the narrow phase got slower)
  BINARYEN_CORES=2 "$WO" "$B/wasm-build/rapier_wasm2d_bg.wasm" -o "$B/pkg/dist/rapier_wasm2d_bg.wasm" \
    -O4 --one-caller-inline-max-function-size=1000 --dce --enable-bulk-memory --enable-nontrapping-float-to-int $optflags
  cp "$B/wasm-build/rapier_wasm2d.js" "$B/wasm-build/rapier_wasm2d.d.ts" "$B/wasm-build/rapier_wasm2d_bg.wasm.d.ts" "$B/pkg/dist/"
  # the TS API over it, as the official compat build makes it (2D only)
  mkdir -p "$B/gen2d" && cp -r "$T/src.ts/"* "$B/gen2d" && rm -f "$B/gen2d/raw.ts" "$B/gen2d/init.ts" && cp -r "$C/$initdir/"* "$B/gen2d"
  find "$B/gen2d" -type f -print0 | LC_ALL=C xargs -0 sed -i.bak '\:#if DIM3:,\:#endif:d'
  find "$B/gen2d" -type f -name '*.bak' | xargs rm -f
  cp "$C/tsconfig.common.json" "$C/tsconfig.json" "$B/" && cp "$C/tsconfig.pkg2d.json" "$B/tsconfig.pkg.json"
  sed -i.bak 's/import.meta.url/"<deleted>"/g' "$B/pkg/dist/rapier_wasm2d.js" && rm -f "$B/pkg/dist/"*.bak
  cp "$here/rollup.config.mjs" "$C/rollup.bp.config.mjs"
  (cd "$C" && BP_VARIANT=$variant npx rollup --silent --config rollup.bp.config.mjs)
  echo 'export * from "./rapier_wasm2d";' > "$B/pkg/dist/raw.d.ts"
  # into the game: the bundle (loading the .wasm beside it), the types, the .wasm
  node "$here/vendor.mjs" "$B/pkg/dist" "$game/vendor/rapier/${name#@dimforge/}" "$name"
}

L="-C link-arg"
for v in $variants; do
  case $v in
    plain) pack 2d rapier2d @dimforge/rapier2d-compat "$work/t-plain" stable "" "" src2d ;;
    simd) pack 2d-simd rapier2d-simd @dimforge/rapier2d-simd-compat "$work/t-simd" stable "-C target-feature=+simd128" "--enable-simd" src2d ;;
    threads) pack 2d-simd-mt rapier2d-simd-mt @dimforge/rapier2d-simd-mt-compat "$work/t-mt" nightly \
      "-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128 $L=--shared-memory $L=--max-memory=2147483648 $L=--import-memory $L=--export=__wasm_init_tls $L=--export=__tls_size $L=--export=__tls_align $L=--export=__tls_base" \
      "--enable-simd --enable-threads --enable-mutable-globals" src2d-mt ;;
    *) echo "unknown variant $v (plain, simd or threads)"; exit 1 ;;
  esac
done
echo done

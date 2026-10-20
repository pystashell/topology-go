#!/usr/bin/env bash
# Rebuild the Rapfi Gomoku engine shipped in public/engines/rapfi/.
#
# This script, together with public/engines/rapfi/SOURCE.md and COPYING, is
# the "corresponding source" recipe for the GPL-3 engine build: it fetches the
# exact upstream commits, verifies that the checkouts are unmodified, builds
# them with a pinned Emscripten SDK and copies only the final artifacts.
#
# Upstream sources are NOT modified. The build only wraps upstream's own
# CMakeLists.txt (Rapfi/CMakeLists.txt, EMSCRIPTEN branch) in a tiny parent
# project that
#   * points upstream's preload list at an empty file, so no weights are baked
#     into a .data bundle (the app downloads the weights it needs lazily), and
#   * appends link settings for an ES module that runs in browsers, workers
#     and Node, without JS eval, with the MEMFS API exported.
#
# Usage: scripts/build-rapfi.sh
# Environment (all optional):
#   RAPFI_BUILD_DIR   scratch directory (default: $TMPDIR/topology-go-rapfi-build)
#   RAPFI_SRC         existing checkout of dhbloo/rapfi at RAPFI_COMMIT
#   NETWORKS_SRC      existing checkout of dhbloo/rapfi-networks at NETWORKS_COMMIT
#   EMSDK             existing emsdk directory (otherwise emcc on PATH, or a
#                     fresh emsdk clone in the build directory)
#   RAPFI_ALLOW_EMSDK_MISMATCH=1  build with another emcc version (not reproducible)
set -euo pipefail

RAPFI_REPO="https://github.com/dhbloo/rapfi.git"
RAPFI_COMMIT="3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7"
NETWORKS_REPO="https://github.com/dhbloo/rapfi-networks.git"
NETWORKS_COMMIT="e32ad77a5364363b3e3a02b3f9e8610ade19ea98"
EMSDK_REPO="https://github.com/emscripten-core/emsdk.git"
EMSDK_VERSION="6.0.13"

# Weight files copied next to the engine (CC0, from rapfi-networks).
WEIGHTS=(
  "mix9svq/mix9svqfreestyle_bsmix.bin.lz4"
  "mix9svq/mix9svqrenju_bs15_black.bin.lz4"
  "mix9svq/mix9svqrenju_bs15_white.bin.lz4"
  "classical/model210901.bin"
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/engines/rapfi"
WORK="${RAPFI_BUILD_DIR:-${TMPDIR:-/tmp}/topology-go-rapfi-build}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
case "$WORK/" in
  "$ROOT"/*) echo "RAPFI_BUILD_DIR must be outside the repository" >&2; exit 1 ;;
esac

# Check out `commit` of `repo` into `dir` (or verify an existing checkout) and
# make sure the tree is pristine.
checkout() {
  local repo="$1" commit="$2" dir="$3"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$repo"
    git -C "$dir" fetch -q --depth 1 origin "$commit"
    git -C "$dir" checkout -q --detach FETCH_HEAD
  fi
  local head
  head="$(git -C "$dir" rev-parse HEAD)"
  if [ "$head" != "$commit" ]; then
    echo "$dir is at $head, expected $commit" >&2
    exit 1
  fi
  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    echo "$dir has local modifications; the published build must be unmodified" >&2
    exit 1
  fi
}

RAPFI_SRC="${RAPFI_SRC:-$WORK/rapfi}"
NETWORKS_SRC="${NETWORKS_SRC:-$WORK/rapfi-networks}"
checkout "$RAPFI_REPO" "$RAPFI_COMMIT" "$RAPFI_SRC"
checkout "$NETWORKS_REPO" "$NETWORKS_COMMIT" "$NETWORKS_SRC"

# Emscripten SDK.
if [ -n "${EMSDK:-}" ] && [ -f "$EMSDK/emsdk_env.sh" ]; then
  # shellcheck disable=SC1091
  source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
elif ! command -v emcc >/dev/null 2>&1; then
  if [ ! -d "$WORK/emsdk" ]; then
    git clone -q "$EMSDK_REPO" "$WORK/emsdk"
  fi
  "$WORK/emsdk/emsdk" install "$EMSDK_VERSION"
  "$WORK/emsdk/emsdk" activate "$EMSDK_VERSION"
  # shellcheck disable=SC1091
  source "$WORK/emsdk/emsdk_env.sh" >/dev/null 2>&1
fi
EMCC_VERSION="$(emcc --version | head -n 1)"
case "$EMCC_VERSION" in
  *" $EMSDK_VERSION "*) ;;
  *)
    if [ "${RAPFI_ALLOW_EMSDK_MISMATCH:-0}" != "1" ]; then
      echo "Expected Emscripten $EMSDK_VERSION, found: $EMCC_VERSION" >&2
      exit 1
    fi
    ;;
esac

# Parent project around upstream's CMakeLists.txt. Upstream resolves its
# preamble and preload list from CMAKE_SOURCE_DIR, which is this directory.
WRAPPER="$WORK/wrapper"
mkdir -p "$WRAPPER/emscripten" "$WORK/Networks"
cp "$RAPFI_SRC/Rapfi/emscripten/preamble.js" "$WRAPPER/emscripten/preamble.js"
: > "$WORK/Networks/wasm_preloads.txt"
cat > "$WRAPPER/CMakeLists.txt" <<'CMAKE'
cmake_minimum_required(VERSION 3.18.2 FATAL_ERROR)
project(rapfi_web)
add_subdirectory("${RAPFI_SOURCE_DIR}/Rapfi" rapfi)
get_target_property(RAPFI_LINK_FLAGS rapfi LINK_FLAGS)
# Later -s settings override upstream's earlier ones.
string(CONCAT RAPFI_WEB_FLAGS
  " -sEXPORT_ES6=1"
  " -sENVIRONMENT=web,worker,node"
  " -sDYNAMIC_EXECUTION=0"
  " -sFORCE_FILESYSTEM=1"
  " -sEXPORTED_RUNTIME_METHODS=['cwrap','FS']"
)
set_target_properties(rapfi PROPERTIES
  LINK_FLAGS "${RAPFI_LINK_FLAGS}${RAPFI_WEB_FLAGS}"
  SUFFIX ".mjs")
CMAKE

# Single-threaded (no SharedArrayBuffer, so no COOP/COEP) with WebAssembly
# SIMD128. Upstream has no scalar NNUE path (eval/mix10nnue.cpp asserts a SIMD
# instruction set), so there is no non-SIMD variant; browsers without wasm
# SIMD use the app's built-in tactics instead of Rapfi.
BUILD="$WORK/build-simd128"
emcmake cmake -S "$WRAPPER" -B "$BUILD" -G Ninja \
  -DRAPFI_SOURCE_DIR="$RAPFI_SRC" \
  -DCMAKE_BUILD_TYPE=Release \
  -DNO_MULTI_THREADING=ON \
  -DNO_COMMAND_MODULES=ON \
  -DUSE_WASM_SIMD=ON \
  -DUSE_WASM_SIMD_RELAXED=OFF >/dev/null
cmake --build "$BUILD" --parallel

mkdir -p "$OUT"
cp "$BUILD/rapfi/rapfi-single-simd128.mjs" "$BUILD/rapfi/rapfi-single-simd128.wasm" "$OUT/"
for weight in "${WEIGHTS[@]}"; do
  cp "$NETWORKS_SRC/$weight" "$OUT/"
done
cp "$RAPFI_SRC/Copying.txt" "$OUT/COPYING"
cp "$NETWORKS_SRC/LICENSE" "$OUT/NETWORKS_LICENSE.txt"
# Corresponding source served next to the binary: the exact upstream tree
# (engine and bundled libraries) and this build script.
git -C "$RAPFI_SRC" archive --format=tar.gz --prefix="rapfi-${RAPFI_COMMIT:0:7}/" \
  -o "$OUT/rapfi-source-${RAPFI_COMMIT:0:7}.tar.gz" "$RAPFI_COMMIT" \
  Rapfi Copying.txt AUTHORS Readme.md
cp "${BASH_SOURCE[0]}" "$OUT/build-rapfi.sh"

echo "Emscripten: $EMCC_VERSION"
echo "Rapfi:      $RAPFI_REPO @ $RAPFI_COMMIT"
echo "Networks:   $NETWORKS_REPO @ $NETWORKS_COMMIT"
(cd "$OUT" && for file in rapfi-single* rapfi-source-* $(printf '%s\n' "${WEIGHTS[@]}" | xargs -n1 basename); do
  printf '%10d  %s  %s\n' "$(wc -c < "$file")" "$(sha256sum "$file" | cut -c1-64)" "$file"
done)

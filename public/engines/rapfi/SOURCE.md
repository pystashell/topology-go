# Rapfi engine: source and build

The files in this directory run the Gomoku AI of Topology Go in the browser.

| File | What it is | License |
| --- | --- | --- |
| `rapfi-single-simd128.mjs`, `rapfi-single-simd128.wasm` | Rapfi 0.43.02, compiled to WebAssembly (single-threaded, SIMD128) | GPL-3.0-or-later (`COPYING`) |
| `rapfi-source-3c94c2a.tar.gz` | The complete upstream source of that build (engine and bundled libraries) | GPL-3.0-or-later and the bundled libraries' own licenses |
| `build-rapfi.sh` | The script that produced the binaries from that source | GPL-3.0-or-later (with the binaries) |
| `mix9svqfreestyle_bsmix.bin.lz4`, `mix9svqrenju_bs15_black.bin.lz4`, `mix9svqrenju_bs15_white.bin.lz4` | mix9svq NNUE networks (freestyle; Renju for Black and White) | CC0 1.0 (`NETWORKS_LICENSE.txt`) |
| `model210901.bin` | Classical evaluation model | CC0 1.0 (`NETWORKS_LICENSE.txt`) |

## Rapfi

Rapfi is a Gomoku/Renju engine by the Rapfi developers, licensed under the
GNU General Public License, version 3 or later. The full license text is in
`COPYING`.

- Upstream: <https://github.com/dhbloo/rapfi>
- Exact source of this build: commit
  [`3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`](https://github.com/dhbloo/rapfi/tree/3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7)
  ("chore: finish module hygiene after structural refactors", 2026-07-23),
  also served here as `rapfi-source-3c94c2a.tar.gz`.
- **No modifications.** The source is compiled exactly as published. The
  build wraps upstream's own `Rapfi/CMakeLists.txt` (its Emscripten branch)
  in a small parent CMake project that only (1) points upstream's
  `--preload-file` list at an empty file, so no weights are baked into the
  binary, and (2) appends these link settings:
  `-sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sDYNAMIC_EXECUTION=0
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=['cwrap','FS']`
  and names the output `.mjs`.
- CMake options: `-DCMAKE_BUILD_TYPE=Release -DNO_MULTI_THREADING=ON
  -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF`.
  Upstream's own Emscripten flags stay in force (`-O3 -flto -fexceptions
  --closure=1 -sMODULARIZE=1 -sEXPORT_NAME=Rapfi -sALLOW_MEMORY_GROWTH=1
  -sIMPORTED_MEMORY=1 -sSTACK_SIZE=2MB -sEXIT_RUNTIME=1`, upstream's
  `emscripten/preamble.js` as `--pre-js`).
- Toolchain: Emscripten SDK 6.0.13 (emcc 6.0.13, e13ee988ce3d), CMake 3.28,
  Ninja.
- There is no non-SIMD build: upstream's NNUE code requires a SIMD
  instruction set (`eval/mix10nnue.cpp` asserts it). Browsers without
  WebAssembly SIMD (for example Safari before 16.4) get the app's own
  tactical Gomoku AI instead.

To rebuild, run `build-rapfi.sh` from a checkout of Topology Go (it lives in
`scripts/` there and writes into `public/engines/rapfi/`). It fetches the
pinned commits, refuses modified checkouts, installs the pinned Emscripten SDK
if none is active, builds, and prints the size and SHA-256 of every artifact.

## Networks

The weights come from
[dhbloo/rapfi-networks](https://github.com/dhbloo/rapfi-networks) at commit
[`e32ad77a5364363b3e3a02b3f9e8610ade19ea98`](https://github.com/dhbloo/rapfi-networks/tree/e32ad77a5364363b3e3a02b3f9e8610ade19ea98),
released under CC0 1.0 Universal, copied unchanged. The app downloads only the
network of the rule being played, on first use, and keeps it in Cache Storage:
freestyle 10.0 MB, Renju 19.8 MB (Black and White networks).

## Artifacts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `rapfi-single-simd128.mjs` | 39,948 | `269543885f39f30dafd3183494ede855b37d4ea92c8a5bf0c05ae46a3805a2b3` |
| `rapfi-single-simd128.wasm` | 1,245,076 | `053a4dba9671ca6a3649e64203ae4c9ca6c4c283de03d04e950c092e83c850a2` |
| `rapfi-source-3c94c2a.tar.gz` | 790,740 | `b36227d32a92e0f07ac8e0be0c96928a6e7f10d5d069a555cc598631b7f83d86` |
| `mix9svqfreestyle_bsmix.bin.lz4` | 10,030,398 | `6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62` |
| `mix9svqrenju_bs15_black.bin.lz4` | 9,984,172 | `7ab8c974c30da07717ce6a504616a62ac8c981500503f0ced0fadefd3f46c5ec` |
| `mix9svqrenju_bs15_white.bin.lz4` | 9,844,944 | `a31f318518d3b5630489054d9eb013fd5353c553999640c2bcfd8d95e6fe4e4e` |
| `model210901.bin` | 30,109 | `34061bca4031a786a4b0ff52470fa9f316013c4c2239db0d70581a3c35d0a72a` |

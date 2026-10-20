# Third-party notices

## Web KaTrain model loader

Files under `src/ai/katago/vendor/` are adapted from
[Sir-Teo/web-katrain](https://github.com/Sir-Teo/web-katrain). The network
convolution wrapper was modified to use horizontal circular padding for the
cylindrical board.

MIT License

Copyright (c) 2026 Web KatRain Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## KataGo neural network

`public/models/katago-b10c128.bin.gz` is the KataGo network
`g170e-b10c128-s1141046784-d204142634.bin.gz`, sourced from the
[official KataGo repository](https://github.com/lightvector/KataGo). KataGo's
network license page identifies the older g170 networks as CC0 / effectively
public domain. The model remains credited here even though attribution is not
required.

Downloaded asset SHA-256:
`1A8E05A4EA3FCA20DAB79410CBB566C760767FCDD2FA0B701CFE259A84CC8B04`.

### KataGo kata1 b18 network

The files `public/models/katago-b18c384.part01.bin` through
`public/models/katago-b18c384.part04.bin` are byte-for-byte chunks of the
KataGo network
`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`, sourced from the
[official KataGo training network list](https://katagotraining.org/networks/).
The original gzip stream was split only to remain below Cloudflare's per-asset
limit and is reconstructed in the browser without modifying its contents.

Original asset SHA-256:
`9D7A6AFED8FF5B74894727E156F04F0CD36060A24824892008FBB6E0CBA51F1D`.

The following notice is required by the
[KataGo neural network license](https://katagotraining.org/network_license/):

The deployed site also distributes this notice beside the model as
`/KATAGO_NETWORK_LICENSE.txt` and links to it from the game interface.

Copyright 2026 David J Wu ("lightvector").

Permission is hereby granted, free of charge, to any person obtaining a copy
of the neural net files or training weight files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## TensorFlow.js

TensorFlow.js is distributed under the Apache License 2.0. Its packages retain
their own license files in the npm distribution.

## Rapfi Gomoku engine

The Gomoku AI runs [Rapfi](https://github.com/dhbloo/rapfi), a Gomoku/Renju
engine by the Rapfi developers, compiled to WebAssembly:
`public/engines/rapfi/rapfi-single-simd128.mjs` and
`public/engines/rapfi/rapfi-single-simd128.wasm`. Rapfi is free software
under the GNU General Public License, version 3 or later; the license text is
distributed beside the engine as `public/engines/rapfi/COPYING` (served at
`/engines/rapfi/COPYING`).

The binaries are built, without modifications to the source, from upstream
commit
[`3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`](https://github.com/dhbloo/rapfi/tree/3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7)
by `scripts/build-rapfi.sh` (Emscripten 6.0.13). The corresponding source is
served next to the binaries: `/engines/rapfi/rapfi-source-3c94c2a.tar.gz`
(the upstream tree, including its bundled libraries under their own
licenses), `/engines/rapfi/build-rapfi.sh` and `/engines/rapfi/SOURCE.md`
(exact build settings and artifact checksums). The app talks to the engine
only through its Piskvork text protocol (`src/ai/gomoku/rapfiBridge.js`).

## Rapfi networks

`public/engines/rapfi/mix9svqfreestyle_bsmix.bin.lz4`,
`mix9svqrenju_bs15_black.bin.lz4`, `mix9svqrenju_bs15_white.bin.lz4` and
`model210901.bin` are unchanged weight files from
[dhbloo/rapfi-networks](https://github.com/dhbloo/rapfi-networks) at commit
`e32ad77a5364363b3e3a02b3f9e8610ade19ea98`, released under CC0 1.0 Universal
(`public/engines/rapfi/NETWORKS_LICENSE.txt`). They are credited here even
though attribution is not required.

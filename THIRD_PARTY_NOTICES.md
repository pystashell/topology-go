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

## TensorFlow.js

TensorFlow.js is distributed under the Apache License 2.0. Its packages retain
their own license files in the npm distribution.

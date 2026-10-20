import assert from "node:assert/strict";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import { chooseOthelloMove } from "../src/ai/othello/othelloAi.js";
import { createRandom } from "../src/ai/othello/othelloGeometry.js";
import { positionOf } from "../src/ai/othello/othelloSelfPlay.js";

/**
 * Search speed report: nodes per second and depth reached by "hard" from
 * fixed midgame positions. The default suite runs a short smoke search; the
 * full report (1.5 s per position) runs with OTHELLO_AI_PERF=1.
 */

const FULL = process.env.OTHELLO_AI_PERF === "1";
const TIME_MS = FULL ? 1500 : 150;

function midgame(topology, size, plies) {
  const random = createRandom(size * 31 + plies);
  const engine = new OthelloEngine({ width: size, height: size, topology });
  while (engine.phase === "play") {
    const { black, white } = engine.discs;
    if (black + white - 4 >= plies) break;
    const legal = engine.legalMoves();
    const move = legal[Math.floor(random() * legal.length)];
    engine.play(move.row, move.col);
  }
  return engine;
}

const CASES = FULL
  ? ["cylinder", "torus", "mobius"].flatMap((topology) => [
      { topology, size: 8, plies: 20 },
      { topology, size: 8, plies: 36 },
      { topology, size: 20, plies: 80 },
      { topology, size: 20, plies: 200 },
    ])
  : [
      { topology: "cylinder", size: 8, plies: 20 },
      { topology: "torus", size: 20, plies: 80 },
    ];

test(`othello AI search speed (${TIME_MS} ms per position)`, async (t) => {
  for (const { topology, size, plies } of CASES) {
    const engine = midgame(topology, size, plies);
    const started = performance.now();
    const { move, info } = await chooseOthelloMove(positionOf(engine), {
      level: "hard",
      timeLimitMs: TIME_MS,
    });
    const seconds = (performance.now() - started) / 1000;
    const empties = size * size - engine.discs.black - engine.discs.white;
    const line =
      `${topology} ${size}x${size} (${empties} empties): depth ${info.depth}, ` +
      `${info.nodes} nodes, ${Math.round(info.nodes / seconds)} nodes/s, ${info.source}`;
    t.diagnostic(line);
    if (process.env.OTHELLO_AI_VERBOSE) console.log(line);
    assert.equal(engine.checkPlay(move.row, move.col).ok, true);
    assert.ok(info.depth >= (size <= 8 ? 3 : 1), line);
  }
});

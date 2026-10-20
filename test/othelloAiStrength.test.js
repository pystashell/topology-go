import assert from "node:assert/strict";
import test from "node:test";

import {
  aiPlayer,
  greedyPlayer,
  playMatch,
  randomPlayer,
  scoreInterval,
} from "../src/ai/othello/othelloSelfPlay.js";

/**
 * Strength checks. The default suite plays a few deterministic games with a
 * depth-limited "hard" (fixed depth, no clock) so it is quick and never
 * flaky. The full run uses the real time-limited levels over many seeded
 * games and checks the targets with their confidence intervals:
 *
 *   OTHELLO_AI_FULL=1 [OTHELLO_AI_GAMES=50] [OTHELLO_AI_HARD_MS=50] \
 *   [OTHELLO_AI_BOARDS=torus:8:8,cylinder:6:6] node --test test/othelloAiStrength.test.js
 */

const FULL = process.env.OTHELLO_AI_FULL === "1";
const GAMES = FULL ? Number(process.env.OTHELLO_AI_GAMES ?? 50) : 4;
const HARD_MS = Number(process.env.OTHELLO_AI_HARD_MS ?? 50);

const ALL_BOARDS = [
  "cylinder:8:8",
  "torus:8:8",
  "mobius:8:8",
  "cylinder:6:6",
  "cylinder:10:10",
  "cylinder:8:12",
];
const BOARDS = (process.env.OTHELLO_AI_BOARDS?.split(",") ?? ALL_BOARDS).map((spec) => {
  const [topology, width, height] = spec.split(":");
  return { topology, width: Number(width), height: Number(height), label: spec };
});

/** Hard: real time limit in the full run, fixed depth 4 (+ solve 10) otherwise. */
const hard = FULL
  ? () => aiPlayer({ level: "hard", timeLimitMs: HARD_MS })
  : () => aiPlayer({ level: "hard", timeLimitMs: 600000 }, { maxDepth: 4, exactEmpties: 10 });

function report(t, label, stats) {
  const { score, low, high } = scoreInterval(stats);
  const line =
    `${label}: ${stats.wins}-${stats.losses}-${stats.draws} ` +
    `score ${(100 * score).toFixed(1)}% (95% CI ${(100 * low).toFixed(1)}-${(100 * high).toFixed(1)}), ` +
    `mean margin ${(stats.discDiff / stats.games).toFixed(1)}`;
  t.diagnostic(line);
  if (process.env.OTHELLO_AI_VERBOSE) console.log(line);
  return score;
}

for (const board of BOARDS) {
  test(`othello AI hard beats a random player on ${board.label}`, (t) => {
    const stats = playMatch({
      ...board,
      candidate: hard,
      opponent: (random) => randomPlayer(random),
      games: GAMES,
      seed: 101,
    });
    const score = report(t, `hard vs random ${board.label}`, stats);
    assert.ok(score >= 0.95, `score ${score}`);
  });

  test(`othello AI hard beats a greedy player on ${board.label}`, (t) => {
    const stats = playMatch({
      ...board,
      candidate: hard,
      opponent: (random) => greedyPlayer(random),
      games: GAMES,
      seed: 202,
    });
    const score = report(t, `hard vs greedy ${board.label}`, stats);
    assert.ok(score >= (FULL ? 0.9 : 0.75), `score ${score}`);
  });
}

test("othello AI normal beats easy clearly", (t) => {
  const boards = FULL ? BOARDS.slice(0, 3) : [BOARDS[0]];
  for (const board of boards) {
    const stats = playMatch({
      ...board,
      candidate: () => aiPlayer({ level: "normal" }),
      opponent: (random) => aiPlayer({ level: "easy" }, { random }),
      games: FULL ? GAMES : 6,
      seed: 303,
    });
    const score = report(t, `normal vs easy ${board.label}`, stats);
    assert.ok(score >= 0.75, `${board.label}: score ${score}`);
  }
});

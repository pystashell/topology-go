import test from "node:test";
import assert from "node:assert/strict";

import { chooseMonteCarloMove } from "../src/ai/mcts.js";
import { BLACK, EMPTY, GoEngine, WHITE } from "../src/game/goEngine.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

function candidateAt(result, row, col) {
  return result.stats.candidates.find(
    ({ move }) => move.type === "play" && move.row === row && move.col === col,
  );
}

test("root PUCT revisits a strong neural prior and reports its influence", () => {
  const game = new GoEngine({ size: 5, komi: 0 });
  const rootPolicy = new Float32Array(26).fill(0.0001);
  rootPolicy[1 * 5 + 3] = 0.85;
  rootPolicy[3 * 5 + 1] = 0.1;

  const result = chooseMonteCarloMove(game, {
    difficulty: "hard",
    iterations: 80,
    timeLimitMs: Infinity,
    rolloutLimit: 1,
    candidateLimit: 6,
    rootPolicy,
    seed: 9,
  });
  const strongest = candidateAt(result, 1, 3);
  const runnerUp = candidateAt(result, 3, 1);

  assert.ok(strongest);
  assert.ok(runnerUp);
  assert.deepEqual(result.move, { type: "play", row: 1, col: 3 });
  assert.equal(result.stats.rootPolicyUsed, true);
  assert.ok(result.stats.selectedNeuralPrior > 0.85);
  assert.ok(
    strongest.visits > runnerUp.visits,
    "PUCT should revisit the substantially stronger prior more often",
  );
  assert.ok(strongest.rootPriorShare > 0.85);
  assert.ok(strongest.rootPuctBonus > runnerUp.rootPuctBonus);
  assert.ok(
    Math.abs(
      result.stats.candidates.reduce(
        (sum, candidate) => sum + candidate.rootPriorShare,
        0,
      ) - 1,
    ) < 1e-6,
    "reported shares should describe the expanded root candidates",
  );
});

test("an extreme neural prior cannot vote down a forced cylindrical rescue", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "W....",
      "BW...",
      "W....",
      ".....",
    ]),
  });
  const rootPolicy = new Float32Array(26).fill(1e-12);
  rootPolicy[3] = 1;

  const result = chooseMonteCarloMove(game, {
    difficulty: "hard",
    iterations: 36,
    timeLimitMs: Infinity,
    rolloutLimit: 10,
    rootPolicy,
    seed: 11,
  });

  assert.deepEqual(
    result.move,
    { type: "play", row: 2, col: 4 },
    "the only seam liberty must outrank the model's unrelated suggestion",
  );
  assert.ok(
    candidateAt(result, 0, 3).visits > candidateAt(result, 2, 4).visits,
    "the assertion should exercise the hard rescue safeguard, not a lucky visit vote",
  );
});

test("search without a root policy keeps neural PUCT completely disabled", () => {
  const result = chooseMonteCarloMove(new GoEngine({ size: 5, komi: 0 }), {
    difficulty: "hard",
    iterations: 20,
    timeLimitMs: Infinity,
    rolloutLimit: 2,
    seed: "no-policy",
  });

  assert.equal(result.stats.rootPolicyUsed, false);
  assert.equal(result.stats.selectedNeuralPrior, 0);
  assert.ok(
    result.stats.candidates.every(
      (candidate) =>
        candidate.neuralPrior === 0 &&
        candidate.rootPriorShare === 0 &&
        candidate.rootPuctBonus === 0,
    ),
  );
});

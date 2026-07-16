import test from "node:test";
import assert from "node:assert/strict";

import { chooseMonteCarloMove } from "../src/ai/mcts.js";
import {
  buildLegalPolicyMask,
  buildCylinderFeatures,
  KATAGO_SPATIAL_CHANNELS,
  policyPriorsFromLogits,
} from "../src/ai/katago/cylinderFeatures.js";
import { BLACK, EMPTY, GoEngine, WHITE } from "../src/game/goEngine.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

function featureAt(features, row, col, channel) {
  return features.spatial[
    (row * features.size + col) * KATAGO_SPATIAL_CHANNELS + channel
  ];
}

test("KataGo liberty features use the cylindrical seam", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "W...W",
      "B...B",
      "W...W",
      ".....",
    ]),
  });

  const features = buildCylinderFeatures(game);
  assert.equal(featureAt(features, 2, 0, 1), 1);
  assert.equal(featureAt(features, 2, 4, 1), 1);
  assert.equal(
    featureAt(features, 2, 0, 4),
    1,
    "the seam-connected string has two shared liberties",
  );
  assert.equal(featureAt(features, 2, 4, 4), 1);
});

test("KataGo policy logits include pass in one normalized distribution", () => {
  const game = new GoEngine({ size: 5, komi: 0 });
  const policy = new Float32Array(25);
  policy[7] = 3;
  const priors = policyPriorsFromLogits({
    policy,
    pass: new Float32Array([1]),
    gameOrState: game,
    policyChannels: 1,
  });

  const total = priors.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.equal(
    priors.indexOf(Math.max(...priors)),
    7,
    "the highest point logit remains the highest prior",
  );
  assert.ok(priors[25] > priors[0], "pass logit participates in softmax");
});

test("KataGo policy masks occupied and cylindrical-suicide logits before softmax", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "W....",
      ".W..W",
      "W....",
      ".....",
    ]),
  });
  const policy = new Float32Array(25);
  policy[1 * 5] = 900; // occupied
  policy[2 * 5] = 1_000; // suicide through the cylindrical seam
  policy[4] = 3; // legal
  const before = game.exportState();

  const priors = policyPriorsFromLogits({
    policy,
    pass: new Float32Array([1]),
    gameOrState: game,
    policyChannels: 1,
  });

  assert.equal(priors[1 * 5], 0);
  assert.equal(priors[2 * 5], 0);
  assert.equal(priors.indexOf(Math.max(...priors)), 4);
  assert.ok(Math.abs(priors.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
  assert.deepEqual(game.exportState(), before, "legality probes must be immutable");
});

test("KataGo policy mask honors restored positional-superko history", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".BW..",
      "BW.W.",
      ".BW..",
      ".....",
      ".....",
    ]),
  });
  assert.equal(game.play(1, 2).ok, true);
  const restored = GoEngine.fromState(game.exportState());
  const mask = buildLegalPolicyMask(restored);
  const policy = new Float32Array(25);
  policy[1 * 5 + 1] = 1_000; // forbidden recapture
  policy[4 * 5 + 4] = 3; // legal

  const priors = policyPriorsFromLogits({
    policy,
    pass: new Float32Array([1]),
    gameOrState: restored,
    policyChannels: 1,
  });

  assert.equal(mask[1 * 5 + 1], 0);
  assert.equal(mask[25], 1, "pass remains a legal policy action");
  assert.equal(priors[1 * 5 + 1], 0);
  assert.equal(priors.indexOf(Math.max(...priors)), 4 * 5 + 4);
  assert.ok(Math.abs(priors.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
});

test("neural root policy steers quiet play before candidate truncation", () => {
  const game = new GoEngine({ size: 5, komi: 0 });
  const rootPolicy = new Float32Array(26).fill(1e-6);
  rootPolicy[1 * 5 + 3] = 1;

  const result = chooseMonteCarloMove(game, {
    difficulty: "hard",
    iterations: 1,
    timeLimitMs: Infinity,
    rolloutLimit: 1,
    rootPolicy,
    seed: 9,
  });

  assert.deepEqual(result.move, { type: "play", row: 1, col: 3 });
  assert.ok(result.stats.candidates[0].neuralPrior > 0.9);
});

test("neural root policy cannot suppress a forced seam capture", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "B....",
      "WB...",
      "B....",
      ".....",
    ]),
  });
  const rootPolicy = new Float32Array(26).fill(1e-8);
  rootPolicy[0 * 5 + 3] = 1;

  const result = chooseMonteCarloMove(game, {
    difficulty: "hard",
    iterations: 24,
    timeLimitMs: Infinity,
    rolloutLimit: 6,
    rootPolicy,
    seed: 11,
  });

  assert.deepEqual(result.move, { type: "play", row: 2, col: 4 });
});

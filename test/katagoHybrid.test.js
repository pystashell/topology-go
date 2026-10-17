import test from "node:test";
import assert from "node:assert/strict";

import { chooseMonteCarloMove } from "../src/ai/mcts.js";
import {
  buildLegalPolicyMask,
  buildCylinderFeatures,
  KATAGO_SPATIAL_CHANNELS,
  policyPriorsFromLogits,
} from "../src/ai/katago/cylinderFeatures.js";
import {
  BLACK,
  EMPTY,
  GoEngine,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../src/game/goEngine.js";

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

test("KataGo legal mask uses the torus top-bottom capture seam", () => {
  const board = boardFromRows([
    ".BWB.",
    "..B..",
    ".....",
    "..W..",
    ".W.W.",
  ]);
  const torus = new GoEngine({
    size: 5,
    komi: 0,
    topology: TOPOLOGY_TORUS,
    currentPlayer: BLACK,
    initialBoard: board,
  });
  const cylinder = new GoEngine({
    size: 5,
    komi: 0,
    topology: TOPOLOGY_CYLINDER,
    currentPlayer: BLACK,
    initialBoard: board,
  });
  const moveIndex = 4 * 5 + 2;

  assert.equal(
    buildLegalPolicyMask(torus)[moveIndex],
    1,
    "capturing row 0 through the torus seam makes the surrounded move legal",
  );
  assert.equal(
    buildLegalPolicyMask(cylinder)[moveIndex],
    0,
    "the same bottom-edge move is suicide when rows do not wrap",
  );
  const played = torus.play(4, 2);
  assert.equal(played.ok, true);
  assert.deepEqual(played.captured, [{ row: 0, col: 2 }]);
});

test("KataGo legal mask uses the reversed Mobius seam", () => {
  const initialBoard = boardFromRows([
    "W....",
    ".W...",
    "W....",
    "....W",
    ".....",
  ]);
  const mobius = new GoEngine({
    size: 5,
    topology: TOPOLOGY_MOBIUS,
    currentPlayer: BLACK,
    initialBoard,
  });
  const cylinder = new GoEngine({
    size: 5,
    topology: TOPOLOGY_CYLINDER,
    currentPlayer: BLACK,
    initialBoard,
  });
  const moveIndex = 5;

  assert.equal(buildLegalPolicyMask(mobius)[moveIndex], 0);
  assert.equal(buildLegalPolicyMask(cylinder)[moveIndex], 1);
  assert.deepEqual(mobius.getBoard(), initialBoard);
  assert.deepEqual(cylinder.getBoard(), initialBoard);
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

function channelPoints(features, channel) {
  const points = [];
  for (let row = 0; row < features.height; row++) {
    for (let col = 0; col < features.width; col++) {
      const index = (row * features.width + col) * KATAGO_SPATIAL_CHANNELS + channel;
      if (features.spatial[index] === 1) points.push({ row, col });
    }
  }
  return points;
}

test("KataGo ko-ban plane marks simple-ko and positional-superko points only", () => {
  const ko = new GoEngine({
    width: 7,
    height: 5,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      "..BW...",
      ".BW.W..",
      "..BW...",
      "B......",
      ".B....B",
    ]),
  });
  assert.deepEqual(ko.play(1, 3).captured, [{ row: 1, col: 2 }]);
  assert.equal(ko.checkPlay(4, 0).reason, "suicide", "white's seam point is suicide");
  const koFeatures = buildCylinderFeatures(ko);
  assert.deepEqual(channelPoints(koFeatures, 6), [{ row: 1, col: 2 }]);
  assert.equal(buildLegalPolicyMask(ko)[1 * 7 + 2], 0);

  // A recorded earlier position bans a quiet move that is not a simple ko.
  const empty = new GoEngine({ width: 6, height: 4, topology: TOPOLOGY_MOBIUS });
  const earlier = new GoEngine({ width: 6, height: 4, topology: TOPOLOGY_MOBIUS });
  earlier.play(2, 5);
  const restored = GoEngine.fromState({
    ...empty.exportState({ includeReplay: false }),
    positionHistory: [...empty.positionHistory, ...earlier.positionHistory]
      .filter((hash, index, all) => all.indexOf(hash) === index),
  });
  assert.equal(restored.checkPlay(2, 5).reason, "superko");
  assert.deepEqual(channelPoints(buildCylinderFeatures(restored), 6), [{ row: 2, col: 5 }]);
  assert.deepEqual(channelPoints(buildCylinderFeatures(empty), 6), []);
});

test("KataGo opponent-pass input ignores a pass by the player to move", () => {
  const game = new GoEngine({ width: 7, height: 5, topology: TOPOLOGY_MOBIUS });
  game.play(0, 0);
  game.pass();
  assert.equal(buildCylinderFeatures(game).global[0], 1, "white passed; black to move");
  game.pass();
  game.resumePlay(BLACK);
  assert.deepEqual(game.lastMove, { type: "pass", color: BLACK });
  const features = buildCylinderFeatures(game);
  assert.equal(features.global[0], 0, "black's own pass is not an opponent pass");
  assert.deepEqual(channelPoints(features, 9), []);
});

test("KataGo komi input is bounded to the board area plus 20 like KataGo", () => {
  for (const [komi, player, expectedSelfKomi] of [
    [6.5, WHITE, 6.5],
    [1_000, WHITE, 5 * 3 + 20],
    [1_000, BLACK, -(5 * 3 + 20)],
    [-1e9, BLACK, 5 * 3 + 20],
  ]) {
    const game = new GoEngine({
      width: 5,
      height: 3,
      komi,
      currentPlayer: player,
      scoringRule: "chinese",
    });
    const features = buildCylinderFeatures(game);
    assert.equal(features.global[5], Math.fround(expectedSelfKomi / 20));
    assert.ok(Number.isFinite(features.global[18]));
    assert.ok(Math.abs(features.global[18]) <= 0.5);
  }
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

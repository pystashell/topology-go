import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCylinderFeatures,
  buildLegalPolicyMask,
  KATAGO_SPATIAL_CHANNELS,
  policyPriorsFromLogits,
} from "../src/ai/katago/cylinderFeatures.js";
import { chooseMonteCarloMove } from "../src/ai/mcts.js";
import {
  BLACK,
  EMPTY,
  GoEngine,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../src/game/goEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";
import {
  torusGridFrame,
  torusGridPointFromCartesian,
} from "../src/view/torusGeometry.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

test("rectangular state uses width and height without an ambiguous size alias", () => {
  const game = new GoEngine({ width: 8, height: 5, komi: 0 });
  assert.equal(game.width, 8);
  assert.equal(game.height, 5);
  assert.equal(game.size, undefined);

  const state = game.exportState();
  assert.equal(state.width, 8);
  assert.equal(state.height, 5);
  assert.equal(Object.hasOwn(state, "size"), false);
  assert.equal(state.board.length, 5);
  assert.equal(state.board[0].length, 8);

  const restored = GoEngine.deserialize(game.serialize());
  assert.deepEqual(restored.exportState(), state);
  assert.throws(
    () => GoEngine.fromState({ ...state, size: 8 }),
    /size is only valid/i,
  );

  const squareState = new GoEngine({ size: 5 }).exportState();
  assert.deepEqual(
    { size: squareState.size, width: squareState.width, height: squareState.height },
    { size: 5, width: 5, height: 5 },
  );
  const { width, height, ...legacyState } = squareState;
  assert.equal(GoEngine.fromState(legacyState).size, 5);

  const legacyReplayState = new GoEngine({ size: 5 }).exportState();
  delete legacyReplayState.replay.base.width;
  delete legacyReplayState.replay.base.height;
  const normalizedReplayState = GoEngine.fromState(legacyReplayState).exportState();
  assert.equal(normalizedReplayState.replay.base.width, 5);
  assert.equal(normalizedReplayState.replay.base.height, 5);
});

test("rectangular cylinder, torus and Mobius neighbours use the correct axis", () => {
  const width = 8;
  const height = 5;
  const cylinder = new GoEngine({ width, height, topology: TOPOLOGY_CYLINDER });
  assert.deepEqual(
    new Set(cylinder.neighbors(2, 0).map(({ row, col }) => `${row},${col}`)),
    new Set(["2,7", "2,1", "1,0", "3,0"]),
  );
  assert.equal(cylinder.neighbors(0, 7).length, 3);

  const torus = new GoEngine({ width, height, topology: TOPOLOGY_TORUS });
  assert.deepEqual(
    new Set(torus.neighbors(0, 0).map(({ row, col }) => `${row},${col}`)),
    new Set(["0,7", "0,1", "4,0", "1,0"]),
  );
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      assert.equal(torus.neighbors(row, col).length, 4);
    }
  }

  const mobius = new GoEngine({ width, height, topology: TOPOLOGY_MOBIUS });
  assert.ok(
    mobius.neighbors(1, 0).some(({ row, col }) => row === 3 && col === 7),
  );
  assert.ok(
    mobius.neighbors(3, 7).some(({ row, col }) => row === 1 && col === 0),
  );
  assert.equal(mobius.neighbors(0, 0).length, 3);
  assert.equal(mobius.neighbors(4, 7).length, 3);
});

test("capture and replay preserve rectangular dimensions across connected seams", () => {
  const game = new GoEngine({
    width: 5,
    height: 7,
    topology: TOPOLOGY_MOBIUS,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      "B....",
      "WB...",
      "B....",
      ".....",
      ".....",
      ".....",
      ".....",
    ]),
  });
  const result = game.play(5, 4);
  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [{ row: 1, col: 0 }]);

  const replay = buildReplayFrames(game.getReplayState());
  assert.equal(replay.frames[0].width, 5);
  assert.equal(replay.frames[0].height, 7);
  assert.equal(Object.hasOwn(replay.frames[0], "size"), false);
  assert.deepEqual(replay.frames.at(-1), game.getState());

  const restored = GoEngine.deserialize(game.serialize());
  assert.equal(restored.undo().ok, true);
  assert.equal(restored.get(1, 0), WHITE);
  assert.equal(restored.get(5, 4), EMPTY);
  assert.deepEqual(
    { width: restored.width, height: restored.height, size: restored.size },
    { width: 5, height: 7, size: undefined },
  );
});

test("rectangular territory and area scoring visit every row and column", () => {
  const board = Array.from({ length: 7 }, () => Array(5).fill(EMPTY));
  board[0][0] = WHITE;
  for (const [row, col] of [[2, 2], [4, 2], [3, 1], [3, 3]]) {
    board[row][col] = BLACK;
  }
  const game = new GoEngine({ width: 5, height: 7, komi: 0, initialBoard: board });
  const japanese = game.score("japanese");
  const chinese = game.score("chinese");
  assert.deepEqual(japanese.territory, { [BLACK]: 1, [WHITE]: 0 });
  assert.deepEqual(japanese.stones, { [BLACK]: 4, [WHITE]: 1 });
  assert.equal(japanese.black, 1);
  assert.equal(chinese.black, 5);
  assert.equal(chinese.white, 1);
});

test("KataGo features, legal masks, priors and MCTS flatten rectangles by width", () => {
  const game = new GoEngine({ width: 8, height: 5, komi: 0 });
  assert.equal(game.play(4, 7).ok, true);
  const features = buildCylinderFeatures(game);
  assert.equal(features.width, 8);
  assert.equal(features.height, 5);
  assert.equal(Object.hasOwn(features, "size"), false);
  assert.equal(features.spatial.length, 8 * 5 * KATAGO_SPATIAL_CHANNELS);

  const mask = buildLegalPolicyMask(game);
  assert.equal(mask.length, 8 * 5 + 1);
  assert.equal(mask[4 * 8 + 7], 0);
  assert.equal(mask.at(-1), 1);

  const priors = policyPriorsFromLogits({
    policy: new Float32Array(8 * 5),
    pass: new Float32Array([0]),
    gameOrState: game,
    policyChannels: 1,
  });
  assert.equal(priors.length, 8 * 5 + 1);
  assert.equal(priors[4 * 8 + 7], 0);

  const rootPolicy = new Float32Array(8 * 5 + 1).fill(1);
  const searched = chooseMonteCarloMove(game, {
    iterations: 2,
    timeLimitMs: Infinity,
    rolloutLimit: 1,
    candidateLimit: 4,
    rootPolicy,
    seed: "rectangular-search",
  });
  assert.ok(
    searched.move.type === "pass" ||
      (searched.move.row >= 0 &&
        searched.move.row < 5 &&
        searched.move.col >= 0 &&
        searched.move.col < 8),
  );
  assert.throws(
    () =>
      chooseMonteCarloMove(game, {
        iterations: 1,
        rootPolicy: new Float32Array(26).fill(1),
      }),
    /41 values/,
  );
});

test("30x20 rules, persistence and AI policy indexing use every intersection", () => {
  const width = 30;
  const height = 20;
  const game = new GoEngine({ width, height, topology: TOPOLOGY_TORUS, komi: 0 });
  assert.equal(game.play(height - 1, width - 1).ok, true);
  assert.equal(game.get(height - 1, width - 1), BLACK);
  assert.deepEqual(
    new Set(game.neighbors(0, 0).map(({ row, col }) => `${row},${col}`)),
    new Set(["0,29", "0,1", "19,0", "1,0"]),
  );

  const restored = GoEngine.deserialize(game.serialize());
  assert.equal(restored.width, width);
  assert.equal(restored.height, height);
  assert.equal(restored.board.length, height);
  assert.equal(restored.board[0].length, width);

  const features = buildCylinderFeatures(restored);
  assert.equal(features.spatial.length, width * height * KATAGO_SPATIAL_CHANNELS);
  const priors = policyPriorsFromLogits({
    policy: new Float32Array(width * height),
    pass: new Float32Array([0]),
    gameOrState: restored,
    policyChannels: 1,
  });
  assert.equal(priors.length, width * height + 1);
  assert.equal(priors[(height - 1) * width + width - 1], 0);
  assert.ok(Math.abs(priors.reduce((sum, value) => sum + value, 0) - 1) < 1e-5);

  const searched = chooseMonteCarloMove(restored, {
    iterations: 1,
    timeLimitMs: Infinity,
    rolloutLimit: 1,
    candidateLimit: 2,
    rootPolicy: priors,
    seed: "30x20-search",
  });
  assert.ok(
    searched.move.type === "pass" ||
      (searched.move.row >= 0 && searched.move.row < height &&
        searched.move.col >= 0 && searched.move.col < width),
  );
  assert.throws(() => new GoEngine({ width: 31, height: 20 }), /3 to 30/);
});

test("rectangular torus geometry roundtrips every row and column", () => {
  const width = 8;
  const height = 5;
  const majorRadius = 4;
  const minorRadius = 1.2;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const { position } = torusGridFrame({
        row,
        col,
        width,
        height,
        majorRadius,
        minorRadius,
      });
      assert.deepEqual(
        torusGridPointFromCartesian(position, width, height, majorRadius),
        { row, col },
      );
    }
  }
});

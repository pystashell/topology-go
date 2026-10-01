import assert from "node:assert/strict";
import test from "node:test";

import {
  BLACK,
  EMPTY,
  GoEngine,
  MOVE_ERRORS,
  WHITE,
} from "../src/game/goEngine.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

test("complete replay rejects a missing superko position", () => {
  const game = new GoEngine({
    size: 5,
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

  const valid = GoEngine.fromState(game.exportState());
  assert.deepEqual(valid.play(1, 1), {
    ok: false,
    reason: MOVE_ERRORS.SUPERKO,
  });
  assert.equal(valid.undo().ok, true);
  assert.deepEqual(
    GoEngine.fromState(valid.exportState()).getState(),
    valid.getState(),
  );

  const corrupted = game.exportState();
  assert.equal(corrupted.replay.complete, true);
  corrupted.positionHistory.shift();
  assert.throws(
    () => GoEngine.fromState(corrupted),
    /replay events do not reconstruct positionHistory/u,
  );
});

test("complete replay rejects a fabricated future superko position", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.play(0, 0).ok, true);
  const corrupted = game.exportState();
  const future = GoEngine.fromState(corrupted);
  assert.equal(future.play(1, 1).ok, true);
  corrupted.positionHistory.push(future.exportState().positionHistory.at(-1));

  assert.throws(
    () => GoEngine.fromState(corrupted),
    /replay events do not reconstruct positionHistory/u,
  );

  // A complete replay starts with exactly its original board. Corrupting both
  // stored histories must not make a fabricated earlier position authoritative.
  corrupted.replay.base.positionHistory.push(
    corrupted.positionHistory.at(-1),
  );
  assert.throws(
    () => GoEngine.fromState(corrupted),
    /complete replay base must contain only its starting position/u,
  );
});

test("partial replay checks its saved baseline while legacy saves remain readable", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.play(0, 0).ok, true);
  const legacy = game.exportState();
  delete legacy.replay;

  const partial = GoEngine.fromState(legacy);
  assert.equal(partial.getReplayState().complete, false);
  assert.equal(partial.play(1, 1).ok, true);
  const valid = partial.exportState();
  assert.deepEqual(GoEngine.fromState(valid).exportState(), valid);

  const corrupted = partial.exportState();
  corrupted.positionHistory.shift();
  assert.throws(
    () => GoEngine.fromState(corrupted),
    /replay events do not reconstruct positionHistory/u,
  );
});

test("legacy cylindrical saves still validate a present complete replay", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.play(0, 0).ok, true);
  assert.equal(game.play(1, 1).ok, true);
  const legacy = game.exportState();
  delete legacy.topology;
  delete legacy.replay.base.topology;
  const restored = GoEngine.fromState(legacy);
  assert.equal(restored.topology, "cylinder");
  assert.equal(restored.getReplayState().complete, true);
  assert.deepEqual(restored.getState().board, game.getState().board);

  legacy.positionHistory.shift();
  assert.throws(
    () => GoEngine.fromState(legacy),
    /replay events do not reconstruct positionHistory/u,
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  BLACK,
  EMPTY,
  GoEngine,
  PHASE_PLAY,
  PHASE_SCORING,
  REPLAY_VERSION,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_TORUS,
  UNDO_HISTORY_LIMIT,
  WHITE,
} from "../src/game/goEngine.js";
import {
  buildReplayFrames,
  buildReplayStateAtStep,
} from "../src/game/replay.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

function playSparseMoves(game, count, startIndex = 0) {
  const pointsPerAxis = Math.ceil(game.size / 2);
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const row = Math.floor(index / pointsPerAxis) * 2;
    const col = (index % pointsPerAxis) * 2;
    assert.equal(game.play(row, col).ok, true);
  }
}

test("cylinder and torus games expand into render-ready frames", () => {
  for (const topology of [TOPOLOGY_CYLINDER, TOPOLOGY_TORUS]) {
    const game = new GoEngine({ size: 5, topology });
    assert.equal(game.play(0, 0).ok, true);
    assert.equal(game.play(4, 4).ok, true);

    const replay = game.getReplayState();
    const expanded = buildReplayFrames(replay);

    assert.equal(replay.version, REPLAY_VERSION);
    assert.equal(replay.complete, true);
    assert.equal(replay.base.topology, topology);
    assert.equal(expanded.complete, true);
    assert.equal(expanded.frames.length, 3);
    assert.equal(expanded.steps.length, 2);
    assert.equal(expanded.frames[0].board[0][0], EMPTY);
    assert.deepEqual(expanded.frames[1].lastMove, {
      type: "play",
      color: BLACK,
      row: 0,
      col: 0,
      captured: [],
    });
    assert.deepEqual(expanded.frames[2], game.getState());
  }
});

test("replay reconstructs seam captures and exposes captured stones per step", () => {
  const game = new GoEngine({
    size: 5,
    topology: TOPOLOGY_CYLINDER,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "B....",
      "WB...",
      "B....",
      ".....",
    ]),
  });
  assert.equal(game.play(2, 4).ok, true);

  const { frames, steps } = buildReplayFrames(game.getReplayState());

  assert.equal(frames[0].board[2][0], WHITE);
  assert.equal(frames[1].board[2][0], EMPTY);
  assert.equal(frames[1].board[2][4], BLACK);
  assert.equal(frames[1].captures[BLACK], 1);
  assert.deepEqual(steps[0].captured, [{ row: 2, col: 0 }]);
});

test("passes and resume-play replay without counting resume as a move", () => {
  const game = new GoEngine({
    size: 5,
    initialBoard: boardFromRows([
      "B....",
      ".....",
      ".....",
      ".....",
      ".....",
    ]),
  });
  assert.equal(game.pass().ok, true);
  assert.equal(game.pass().phase, PHASE_SCORING);
  assert.equal(game.toggleDead(0, 0).ok, true);
  assert.equal(game.resumePlay(WHITE).ok, true);
  assert.equal(game.play(2, 2).ok, true);

  assert.deepEqual(game.getReplayState().events, [
    { type: "pass", color: BLACK },
    { type: "pass", color: WHITE },
    { type: "toggle_dead", row: 0, col: 0 },
    { type: "resume_play", nextPlayer: WHITE },
    { type: "play", color: WHITE, row: 2, col: 2 },
  ]);

  const { frames, steps } = buildReplayFrames(game.getReplayState());
  assert.equal(steps.length, 3);
  assert.equal(frames.length, 4);
  assert.equal(frames[2].phase, PHASE_PLAY);
  assert.equal(frames[2].currentPlayer, WHITE);
  assert.deepEqual(frames[2].deadStones, []);
  assert.equal(frames[3].board[2][2], WHITE);
  assert.deepEqual(frames[3], game.getState());
});

test("dead-stone decisions and the final result are preserved at the last move", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    initialBoard: boardFromRows([
      "BBBBB",
      "BBBBB",
      "BBWWB",
      "BBBBB",
      "BBBBB",
    ]),
  });
  game.pass();
  game.pass();
  game.toggleDead(2, 2);
  game.toggleDead(2, 2);
  game.toggleDead(2, 2);
  assert.equal(game.finishScoring("chinese").ok, true);

  const replay = game.getReplayState();
  assert.deepEqual(
    replay.events.map((event) => event.type),
    [
      "pass",
      "pass",
      "toggle_dead",
      "toggle_dead",
      "toggle_dead",
      "finish_scoring",
    ],
  );
  assert.equal(replay.events.at(-1).rule, "chinese");

  const expanded = buildReplayFrames(replay);
  assert.equal(expanded.steps.length, 2);
  assert.equal(expanded.frames.length, 3);
  assert.deepEqual(expanded.frames.at(-1), game.getState());

  const restored = GoEngine.fromState(game.exportState());
  assert.deepEqual(buildReplayFrames(restored.getReplayState()).frames.at(-1), game.getState());

  const undone = game.undo();
  assert.equal(undone.ok, true);
  assert.deepEqual(game.getReplayState().events, [
    { type: "pass", color: BLACK },
  ]);
});

test("undo removes the matching replay move and later resume marker", () => {
  const game = new GoEngine({ size: 5 });
  game.pass();
  game.pass();
  game.resumePlay(BLACK);

  const result = game.undo();

  assert.equal(result.ok, true);
  assert.deepEqual(result.move, { type: "pass", color: WHITE });
  assert.deepEqual(game.getReplayState().events, [
    { type: "pass", color: BLACK },
  ]);
  assert.equal(game.phase, PHASE_PLAY);
  assert.equal(game.consecutivePasses, 1);
  assert.deepEqual(
    buildReplayFrames(game.getReplayState()).frames.at(-1),
    game.getState(),
  );
});

test("complete replay outlives the bounded 32-move undo window", () => {
  const game = new GoEngine({ size: 19 });
  const totalMoves = UNDO_HISTORY_LIMIT + 8;
  playSparseMoves(game, totalMoves);

  assert.equal(game.exportState().undoHistory.length, UNDO_HISTORY_LIMIT);
  assert.equal(game.getReplayState().events.length, totalMoves);
  assert.equal(buildReplayFrames(game.getReplayState()).frames.length, totalMoves + 1);

  assert.equal(game.undo().ok, true);
  assert.equal(game.getReplayState().events.length, totalMoves - 1);
  assert.equal(game.getReplayState().complete, true);
});

test("compact replay persists through objects and JSON without shared data", () => {
  const game = new GoEngine({ size: 5, topology: TOPOLOGY_TORUS });
  game.play(0, 0);
  game.pass();

  const restored = GoEngine.fromState(game.exportState());
  const deserialized = GoEngine.deserialize(game.serialize());

  assert.deepEqual(restored.getReplayState(), game.getReplayState());
  assert.deepEqual(deserialized.getReplayState(), game.getReplayState());
  assert.deepEqual(
    buildReplayFrames(restored.getReplayState()).frames.at(-1),
    game.getState(),
  );

  const returned = restored.getReplayState();
  returned.events[0].row = 4;
  returned.base.board[0][0] = WHITE;
  assert.deepEqual(restored.getReplayState(), game.getReplayState());
});

test("temporary AI states can omit replay without changing normal persistence", () => {
  const game = new GoEngine({ size: 5 });
  game.play(0, 0);
  game.play(2, 2);

  const searchState = game.exportState({ includeReplay: false });
  assert.equal(Object.hasOwn(searchState, "replay"), false);
  assert.equal(Object.hasOwn(game.exportState(), "replay"), true);
  assert.deepEqual(GoEngine.fromState(searchState).getState(), game.getState());
});

test("AI replay states include superko history and match each rendered step", () => {
  const game = new GoEngine({ size: 5, topology: TOPOLOGY_TORUS });
  game.play(0, 0);
  game.play(2, 2);
  game.play(4, 4);

  const replay = game.getReplayState();
  const { frames } = buildReplayFrames(replay);
  for (let step = 0; step < frames.length; step += 1) {
    const state = buildReplayStateAtStep(replay, step);
    assert.equal(Object.hasOwn(state, "replay"), false);
    assert.ok(Array.isArray(state.positionHistory));
    assert.ok(state.positionHistory.length >= 1);
    assert.deepEqual(GoEngine.fromState(state).getState(), frames[step]);
  }
});

test("AI replay states include non-move events attached to a timeline frame", () => {
  const game = new GoEngine({
    size: 5,
    initialBoard: boardFromRows([
      "B....",
      ".....",
      ".....",
      ".....",
      ".....",
    ]),
  });
  game.pass();
  game.pass();
  game.toggleDead(0, 0);
  game.resumePlay(WHITE);
  game.play(2, 2);

  const replay = game.getReplayState();
  const state = buildReplayStateAtStep(replay, 2);
  assert.equal(state.phase, PHASE_PLAY);
  assert.equal(state.currentPlayer, WHITE);
  assert.deepEqual(state.deadStones, []);
  assert.deepEqual(
    GoEngine.fromState(state).getState(),
    buildReplayFrames(replay).frames[2],
  );
  assert.throws(() => buildReplayStateAtStep(replay, 4), RangeError);
  assert.throws(() => buildReplayStateAtStep(replay, -1), RangeError);
});

test("legacy saves start a partial replay at the restored current position", () => {
  const original = new GoEngine({ size: 5 });
  original.play(0, 0);
  const legacyState = original.exportState();
  delete legacyState.replay;

  const restored = GoEngine.fromState(legacyState);
  const initialReplay = restored.getReplayState();
  assert.equal(initialReplay.complete, false);
  assert.deepEqual(initialReplay.events, []);
  assert.deepEqual(GoEngine.fromState(initialReplay.base).getState(), restored.getState());

  restored.play(0, 2);
  let expanded = buildReplayFrames(restored.getReplayState());
  assert.equal(expanded.frames.length, 2);
  assert.equal(expanded.frames[0].board[0][0], BLACK);
  assert.deepEqual(expanded.frames.at(-1), restored.getState());

  // Undo the new move, then an older pre-replay move. The partial baseline
  // follows the latter because that earlier move was never recorded.
  restored.undo();
  restored.undo();
  const afterLegacyUndo = restored.getReplayState();
  assert.equal(afterLegacyUndo.complete, false);
  assert.deepEqual(afterLegacyUndo.events, []);
  expanded = buildReplayFrames(afterLegacyUndo);
  assert.deepEqual(expanded.frames[0], restored.getState());
});

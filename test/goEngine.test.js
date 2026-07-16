import test from "node:test";
import assert from "node:assert/strict";

import {
  BLACK,
  EMPTY,
  GoEngine,
  MOVE_ERRORS,
  PHASE_FINISHED,
  PHASE_SCORING,
  SCORING_CHINESE,
  SCORING_JAPANESE,
  WHITE,
} from "../src/game/goEngine.js";

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

test("9x9, 13x13 and 19x19 boards wrap columns but retain row boundaries", () => {
  for (const size of [9, 13, 19]) {
    const game = new GoEngine({ size });
    const middle = Math.floor(size / 2);

    assert.deepEqual(
      new Set(game.neighbors(middle, 0).map(({ row, col }) => `${row},${col}`)),
      new Set([
        `${middle},${size - 1}`,
        `${middle},1`,
        `${middle - 1},0`,
        `${middle + 1},0`,
      ]),
    );
    assert.equal(game.neighbors(0, 0).length, 3);
    assert.equal(game.neighbors(size - 1, size - 1).length, 3);
  }
});

test("a move captures an opponent through the cylindrical seam", () => {
  const game = new GoEngine({
    size: 5,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".....",
      "B....",
      "WB...",
      "B....",
      ".....",
    ]),
  });

  const result = game.play(2, 4);

  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [{ row: 2, col: 0 }]);
  assert.equal(game.get(2, 0), EMPTY);
  assert.equal(game.get(2, 4), BLACK);
  assert.equal(game.captures[BLACK], 1);
});

test("suicide checks liberties on both sides of the seam and is transactional", () => {
  const initialBoard = boardFromRows([
    ".....",
    "W....",
    ".W..W",
    "W....",
    ".....",
  ]);
  const game = new GoEngine({
    size: 5,
    currentPlayer: BLACK,
    initialBoard,
  });

  const result = game.play(2, 0);

  assert.deepEqual(result, { ok: false, reason: MOVE_ERRORS.SUICIDE });
  assert.deepEqual(game.getBoard(), initialBoard);
  assert.equal(game.currentPlayer, BLACK);
  assert.deepEqual(game.captures, { [BLACK]: 0, [WHITE]: 0 });
});

test("positional superko prevents recreating any earlier stone arrangement", () => {
  const initialBoard = boardFromRows([
    ".BW..",
    "BW.W.",
    ".BW..",
    ".....",
    ".....",
  ]);
  const game = new GoEngine({
    size: 5,
    currentPlayer: BLACK,
    initialBoard,
  });

  const capture = game.play(1, 2);
  assert.equal(capture.ok, true);
  assert.deepEqual(capture.captured, [{ row: 1, col: 1 }]);

  const recapture = game.play(1, 1);
  assert.deepEqual(recapture, { ok: false, reason: MOVE_ERRORS.SUPERKO });
  assert.equal(game.get(1, 1), EMPTY);
  assert.equal(game.get(1, 2), BLACK);
  assert.equal(game.currentPlayer, WHITE);
});

test("two passes enter scoring; a whole connected group is marked dead", () => {
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

  assert.equal(game.pass().phase, "play");
  assert.equal(game.pass().phase, PHASE_SCORING);

  const marked = game.toggleDead(2, 2);
  assert.equal(marked.ok, true);
  assert.equal(marked.dead, true);
  assert.deepEqual(
    new Set(marked.stones.map(({ row, col }) => `${row},${col}`)),
    new Set(["2,2", "2,3"]),
  );
  assert.equal(game.isMarkedDead(2, 2), true);
  assert.equal(game.isMarkedDead(2, 3), true);

  const japanese = game.score(SCORING_JAPANESE);
  assert.deepEqual(japanese.dead, { [BLACK]: 0, [WHITE]: 2 });
  assert.deepEqual(japanese.territory, { [BLACK]: 2, [WHITE]: 0 });
  assert.equal(japanese.black, 4); // two points plus two dead prisoners
  assert.equal(japanese.white, 0);

  const chinese = game.score(SCORING_CHINESE);
  assert.deepEqual(chinese.stones, { [BLACK]: 23, [WHITE]: 0 });
  assert.deepEqual(chinese.territory, { [BLACK]: 2, [WHITE]: 0 });
  assert.equal(chinese.black, 25);
  assert.equal(chinese.white, 0);

  const finished = game.finishScoring(SCORING_CHINESE);
  assert.equal(finished.ok, true);
  assert.equal(finished.phase, PHASE_FINISHED);
  assert.equal(finished.winner, BLACK);
});

test("Japanese territory and Chinese area scoring use the same cylindrical regions", () => {
  const game = new GoEngine({
    size: 5,
    komi: 0,
    initialBoard: boardFromRows([
      "BBBBB",
      "B.BBB",
      "BBWWB",
      "WWWWW",
      "W.WWW",
    ]),
  });

  const japanese = game.score(SCORING_JAPANESE);
  assert.deepEqual(japanese.territory, { [BLACK]: 1, [WHITE]: 1 });
  assert.equal(japanese.black, 1);
  assert.equal(japanese.white, 1);
  assert.equal(japanese.winner, "draw");

  const chinese = game.score(SCORING_CHINESE);
  assert.deepEqual(chinese.stones, { [BLACK]: 12, [WHITE]: 11 });
  assert.equal(chinese.black, 13);
  assert.equal(chinese.white, 12);
  assert.equal(chinese.winner, BLACK);
  assert.equal(chinese.margin, 1);
});

test("complete state round-trips through objects and JSON without sharing data", () => {
  const game = new GoEngine({
    size: 5,
    komi: 7.5,
    scoringRule: SCORING_CHINESE,
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

  const expected = game.exportState();
  const suppliedState = game.exportState();
  const restored = GoEngine.fromState(suppliedState);
  assert.deepEqual(restored.exportState(), expected);

  suppliedState.board[2][4] = WHITE;
  suppliedState.captures[BLACK] = 999;
  suppliedState.lastMove.captured[0].row = 0;
  suppliedState.positionHistory.length = 0;
  assert.deepEqual(restored.exportState(), expected);
  assert.deepEqual(game.exportState(), expected);

  const returnedState = restored.exportState();
  returnedState.board[2][4] = WHITE;
  returnedState.lastMove.captured.length = 0;
  assert.deepEqual(restored.exportState(), expected);

  const serialized = game.serialize();
  assert.equal(typeof serialized, "string");
  assert.deepEqual(GoEngine.deserialize(serialized).exportState(), expected);

  const missingCurrentPosition = game.exportState();
  missingCurrentPosition.positionHistory.pop();
  assert.throws(
    () => GoEngine.fromState(missingCurrentPosition),
    /positionHistory does not include the current board/,
  );
});

test("restoring a game preserves positional superko history", () => {
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
  const restored = GoEngine.fromState(game.exportState());
  const recapture = restored.play(1, 1);

  assert.deepEqual(recapture, { ok: false, reason: MOVE_ERRORS.SUPERKO });
  assert.equal(restored.get(1, 1), EMPTY);
  assert.equal(restored.get(1, 2), BLACK);
  assert.equal(restored.currentPlayer, WHITE);
});

test("scoring, dead stones and a finished result survive restoration", () => {
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

  const scoringState = game.exportState();
  const restoredScoring = GoEngine.fromState(scoringState);
  assert.equal(restoredScoring.phase, PHASE_SCORING);
  assert.equal(restoredScoring.isMarkedDead(2, 2), true);
  assert.equal(restoredScoring.isMarkedDead(2, 3), true);
  assert.deepEqual(
    restoredScoring.score(SCORING_CHINESE),
    game.score(SCORING_CHINESE),
  );

  scoringState.deadStones[0].row = 0;
  assert.equal(restoredScoring.isMarkedDead(2, 2), true);

  assert.equal(restoredScoring.finishScoring(SCORING_CHINESE).ok, true);
  const finishedState = restoredScoring.exportState();
  const restoredFinished = GoEngine.fromState(finishedState);
  assert.equal(restoredFinished.phase, PHASE_FINISHED);
  assert.deepEqual(restoredFinished.result, restoredScoring.result);
  assert.deepEqual(restoredFinished.exportState(), finishedState);

  finishedState.result.territory[BLACK] = 999;
  assert.notEqual(restoredFinished.result.territory[BLACK], 999);
});

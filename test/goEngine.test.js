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
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  UNDO_HISTORY_LIMIT,
  WHITE,
} from "../src/game/goEngine.js";

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
    assert.equal(
      game.play(row, col).ok,
      true,
      `sparse move ${index} should be legal`,
    );
  }
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

test("torus boards give every point four neighbours across both seams", () => {
  for (const size of [9, 13, 19]) {
    const game = new GoEngine({ size, topology: TOPOLOGY_TORUS });
    const expectedCorner = new Set([
      `0,${size - 1}`,
      "0,1",
      `${size - 1},0`,
      "1,0",
    ]);

    assert.deepEqual(
      new Set(game.neighbors(0, 0).map(({ row, col }) => `${row},${col}`)),
      expectedCorner,
    );
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        assert.equal(game.neighbors(row, col).length, 4);
      }
    }
  }
});

test("Mobius boards reverse rows at the column seam and retain one boundary", () => {
  for (const size of [4, 5, 9, 13, 19]) {
    const game = new GoEngine({ size, topology: TOPOLOGY_MOBIUS });
    for (let row = 0; row < size; row += 1) {
      assert.ok(
        game.neighbors(row, 0).some(
          (point) => point.row === size - 1 - row && point.col === size - 1,
        ),
      );
      assert.ok(
        game.neighbors(row, size - 1).some(
          (point) => point.row === size - 1 - row && point.col === 0,
        ),
      );
      for (let col = 0; col < size; col += 1) {
        const neighbours = game.neighbors(row, col);
        const keys = neighbours.map((point) => `${point.row},${point.col}`);
        assert.equal(new Set(keys).size, keys.length);
        assert.equal(neighbours.length, row === 0 || row === size - 1 ? 3 : 4);
        for (const neighbour of neighbours) {
          assert.ok(
            game.neighbors(neighbour.row, neighbour.col).some(
              (point) => point.row === row && point.col === col,
            ),
            `${row},${col} must be symmetric with ${neighbour.row},${neighbour.col}`,
          );
        }
      }
    }
  }
});

test("a Mobius move captures through the reversed seam", () => {
  const game = new GoEngine({
    size: 5,
    topology: TOPOLOGY_MOBIUS,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      "B....",
      "WB...",
      "B....",
      ".....",
      ".....",
    ]),
  });

  const result = game.play(3, 4);

  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [{ row: 1, col: 0 }]);
  assert.equal(game.get(1, 0), EMPTY);
  assert.equal(game.get(3, 4), BLACK);
});

test("Mobius suicide uses the reversed seam and remains transactional", () => {
  const initialBoard = boardFromRows([
    "W....",
    ".W...",
    "W....",
    "....W",
    ".....",
  ]);
  const game = new GoEngine({
    size: 5,
    topology: TOPOLOGY_MOBIUS,
    currentPlayer: BLACK,
    initialBoard,
  });

  assert.deepEqual(game.play(1, 0), {
    ok: false,
    reason: MOVE_ERRORS.SUICIDE,
  });
  assert.deepEqual(game.getBoard(), initialBoard);
  assert.equal(game.currentPlayer, BLACK);
});

test("Mobius groups and territory connect through the reversed seam", () => {
  const connected = new GoEngine({
    size: 5,
    topology: TOPOLOGY_MOBIUS,
    initialBoard: boardFromRows([
      ".....",
      "B....",
      ".....",
      "....B",
      ".....",
    ]),
  });
  assert.deepEqual(
    new Set(
      connected
        .getGroup(1, 0)
        .stones.map(({ row, col }) => `${row},${col}`),
    ),
    new Set(["1,0", "3,4"]),
  );

  const scoringGame = new GoEngine({
    size: 5,
    komi: 0,
    topology: TOPOLOGY_MOBIUS,
    initialBoard: boardFromRows([
      "BBBBB",
      ".BBBB",
      "BBBBB",
      "BBBB.",
      "BBBBB",
    ]),
  });
  for (const rule of [SCORING_CHINESE, SCORING_JAPANESE]) {
    const score = scoringGame.score(rule);
    assert.equal(score.territory[BLACK], 2);
    assert.equal(score.regions.length, 1);
    assert.deepEqual(
      new Set(score.regions[0].points.map(({ row, col }) => `${row},${col}`)),
      new Set(["1,0", "3,4"]),
    );
  }
});

test("a torus move captures an opponent through the top-bottom seam", () => {
  const game = new GoEngine({
    size: 5,
    topology: TOPOLOGY_TORUS,
    currentPlayer: BLACK,
    initialBoard: boardFromRows([
      ".BWB.",
      "..B..",
      ".....",
      "..W..",
      ".W.W.",
    ]),
  });

  const result = game.play(4, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [{ row: 0, col: 2 }]);
  assert.equal(game.get(0, 2), EMPTY);
  assert.equal(game.get(4, 2), BLACK);
});

test("torus suicide checks all four neighbours across the top-bottom seam", () => {
  const initialBoard = boardFromRows([
    ".W.W.",
    "..W..",
    ".....",
    ".....",
    "..W..",
  ]);
  const game = new GoEngine({
    size: 5,
    topology: TOPOLOGY_TORUS,
    currentPlayer: BLACK,
    initialBoard,
  });

  assert.deepEqual(game.play(0, 2), {
    ok: false,
    reason: MOVE_ERRORS.SUICIDE,
  });
  assert.deepEqual(game.getBoard(), initialBoard);
});

test("torus groups and territory regions connect through the top-bottom seam", () => {
  const connected = new GoEngine({
    size: 5,
    topology: TOPOLOGY_TORUS,
    initialBoard: boardFromRows([
      "..B..",
      ".....",
      ".....",
      ".....",
      "..B..",
    ]),
  });
  assert.deepEqual(
    new Set(
      connected
        .getGroup(0, 2)
        .stones.map(({ row, col }) => `${row},${col}`),
    ),
    new Set(["0,2", "4,2"]),
  );

  const scoring = new GoEngine({
    size: 5,
    komi: 0,
    topology: TOPOLOGY_TORUS,
    initialBoard: boardFromRows([
      "BB.BB",
      "BBBBB",
      "BBBBB",
      "BBBBB",
      "BB.BB",
    ]),
  }).score(SCORING_CHINESE);
  assert.equal(scoring.territory[BLACK], 2);
  assert.equal(scoring.regions.length, 1);
  assert.deepEqual(
    new Set(scoring.regions[0].points.map(({ row, col }) => `${row},${col}`)),
    new Set(["0,2", "4,2"]),
  );
});

test("topology round-trips while legacy states default to a cylinder", () => {
  const torus = new GoEngine({ size: 5, topology: TOPOLOGY_TORUS });
  const restored = GoEngine.fromState(torus.exportState());
  assert.equal(restored.topology, TOPOLOGY_TORUS);
  assert.deepEqual(restored.exportState(), torus.exportState());

  const mobius = new GoEngine({ size: 5, topology: TOPOLOGY_MOBIUS });
  const restoredMobius = GoEngine.fromState(mobius.exportState());
  assert.equal(restoredMobius.topology, TOPOLOGY_MOBIUS);
  assert.ok(
    restoredMobius.neighbors(1, 0).some(
      (point) => point.row === 3 && point.col === 4,
    ),
  );

  const legacyState = torus.exportState();
  delete legacyState.topology;
  const legacy = GoEngine.fromState(legacyState);
  assert.equal(legacy.topology, TOPOLOGY_CYLINDER);
  assert.equal(legacy.neighbors(0, 0).length, 3);
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

test("a new game and failed moves have nothing to undo", () => {
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

  assert.equal(game.canUndo(), false);
  assert.deepEqual(game.undo(), {
    ok: false,
    reason: MOVE_ERRORS.NOTHING_TO_UNDO,
  });
  assert.deepEqual(game.play(0, 0), {
    ok: false,
    reason: MOVE_ERRORS.OCCUPIED,
  });
  assert.equal(game.canUndo(), false);
});

test("undo restores a captured position and removes its superko entry", () => {
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
  const before = game.exportState();

  assert.equal(game.play(2, 4).ok, true);
  assert.equal(game.canUndo(), true);
  assert.equal(game.captures[BLACK], 1);

  const undone = game.undo();
  assert.deepEqual(undone, {
    ok: true,
    type: "undo",
    move: {
      type: "play",
      color: BLACK,
      row: 2,
      col: 4,
      captured: [{ row: 2, col: 0 }],
    },
    currentPlayer: BLACK,
    phase: "play",
  });
  assert.deepEqual(game.exportState(), before);
  assert.equal(game.canUndo(), false);

  // The position created by the undone move must no longer trip superko.
  assert.equal(game.play(2, 4).ok, true);
});

test("undoing the second pass discards scoring decisions and the result", () => {
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

  assert.equal(game.pass().ok, true);
  const afterFirstPass = game.exportState();
  assert.equal(game.pass().phase, PHASE_SCORING);
  assert.equal(game.toggleDead(2, 2).ok, true);
  assert.equal(game.finishScoring(SCORING_CHINESE).ok, true);
  assert.equal(game.phase, PHASE_FINISHED);
  assert.notEqual(game.result, null);
  assert.equal(game.deadStones.size, 2);

  const undone = game.undo();
  assert.deepEqual(undone.move, { type: "pass", color: WHITE });
  assert.deepEqual(game.exportState(), afterFirstPass);
  assert.equal(game.phase, "play");
  assert.equal(game.consecutivePasses, 1);
  assert.equal(game.currentPlayer, WHITE);
  assert.equal(game.result, null);
  assert.equal(game.deadStones.size, 0);
});

test("undo history round-trips through persistence and is defensively copied", () => {
  const game = new GoEngine({ size: 5 });
  const initial = game.exportState();
  assert.equal(game.play(0, 0).ok, true);
  const afterFirstMove = game.exportState();
  assert.equal(game.pass().ok, true);

  const suppliedState = game.exportState();
  const restored = GoEngine.fromState(suppliedState);
  assert.equal(restored.canUndo(), true);
  assert.deepEqual(restored.exportState(), game.exportState());

  suppliedState.undoHistory[0].before.board[0][0] = WHITE;
  suppliedState.undoHistory[0].move.row = 4;
  suppliedState.undoHistory[1].before.captures[BLACK] = 999;
  assert.deepEqual(restored.undo().move, { type: "pass", color: WHITE });
  assert.deepEqual(restored.exportState(), afterFirstMove);
  assert.deepEqual(restored.undo().move, {
    type: "play",
    color: BLACK,
    row: 0,
    col: 0,
    captured: [],
  });
  assert.deepEqual(restored.exportState(), initial);
  assert.equal(restored.canUndo(), false);

  const serialized = game.serialize();
  const fromJson = GoEngine.deserialize(serialized);
  assert.equal(fromJson.canUndo(), true);
  assert.deepEqual(fromJson.exportState(), game.exportState());
});

test("legacy persisted states without undo history remain compatible", () => {
  const original = new GoEngine({ size: 5 });
  assert.equal(original.play(0, 0).ok, true);
  const legacyState = original.exportState();
  delete legacyState.undoHistory;

  const restored = GoEngine.fromState(legacyState);
  assert.equal(restored.canUndo(), false);
  assert.deepEqual(restored.undo(), {
    ok: false,
    reason: MOVE_ERRORS.NOTHING_TO_UNDO,
  });

  const legacyBaseline = restored.exportState();
  assert.equal(restored.play(0, 1).ok, true);
  assert.equal(restored.canUndo(), true);
  assert.deepEqual(restored.undo().move, {
    type: "play",
    color: WHITE,
    row: 0,
    col: 1,
    captured: [],
  });
  assert.deepEqual(restored.exportState(), legacyBaseline);
});

test("only the most recent bounded undo window remains reversible", () => {
  const game = new GoEngine({ size: 25 });
  const discardedMoves = 7;

  playSparseMoves(game, discardedMoves);
  const boundary = game.exportState();
  playSparseMoves(game, UNDO_HISTORY_LIMIT, discardedMoves);

  const persisted = game.exportState();
  assert.equal(persisted.undoHistory.length, UNDO_HISTORY_LIMIT);
  const restored = GoEngine.fromState(persisted);
  assert.equal(restored.canUndo(), true);

  for (let index = 0; index < UNDO_HISTORY_LIMIT; index += 1) {
    assert.equal(restored.undo().ok, true);
  }
  assert.equal(restored.canUndo(), false);
  assert.deepEqual(restored.undo(), {
    ok: false,
    reason: MOVE_ERRORS.NOTHING_TO_UNDO,
  });

  const afterWindow = restored.exportState();
  assert.deepEqual(restored.getState(), GoEngine.fromState(boundary).getState());
  assert.deepEqual(afterWindow.positionHistory, boundary.positionHistory);
  assert.deepEqual(afterWindow.undoHistory, []);
});

test("25x25 undo persistence stays bounded and restores at the window limit", () => {
  const game = new GoEngine({ size: 25 });
  playSparseMoves(game, UNDO_HISTORY_LIMIT);
  const sizeAtWindow = game.serialize().length;

  playSparseMoves(game, 120 - UNDO_HISTORY_LIMIT, UNDO_HISTORY_LIMIT);
  const serialized = game.serialize();
  const persisted = JSON.parse(serialized);

  assert.equal(persisted.undoHistory.length, UNDO_HISTORY_LIMIT);
  assert.ok(
    serialized.length < sizeAtWindow + 150_000,
    `bounded history unexpectedly serialized to ${serialized.length} bytes`,
  );
  assert.ok(
    serialized.length < 400_000,
    `25x25 persistence unexpectedly serialized to ${serialized.length} bytes`,
  );

  const restored = GoEngine.fromState(serialized);
  assert.equal(restored.exportState().undoHistory.length, UNDO_HISTORY_LIMIT);
  assert.equal(restored.undo().ok, true);
  assert.equal(restored.exportState().undoHistory.length, UNDO_HISTORY_LIMIT - 1);
});

test("restoring rejects undo history beyond the persistence limit", () => {
  const game = new GoEngine({ size: 25 });
  playSparseMoves(game, UNDO_HISTORY_LIMIT);
  const oversized = game.exportState();
  oversized.undoHistory.push(
    JSON.parse(JSON.stringify(oversized.undoHistory.at(-1))),
  );

  assert.throws(
    () => GoEngine.fromState(oversized),
    new RegExp(`undoHistory must contain at most ${UNDO_HISTORY_LIMIT} entries`),
  );
});

test("restoring rejects internally inconsistent undo history", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.play(0, 0).ok, true);

  const wrongColor = game.exportState();
  wrongColor.undoHistory[0].move.color = WHITE;
  assert.throws(
    () => GoEngine.fromState(wrongColor),
    /move color must match the player to move/,
  );

  const wrongBoard = game.exportState();
  wrongBoard.undoHistory[0].before.board[0][0] = WHITE;
  assert.throws(
    () => GoEngine.fromState(wrongBoard),
    /move point must be empty before the move/,
  );
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

test("resignation finishes the game, survives persistence and cannot be undone", () => {
  const game = new GoEngine({ size: 9 });
  assert.equal(game.play(2, 2).ok, true);
  assert.equal(game.play(3, 3).ok, true);

  const resigned = game.resign(WHITE);
  assert.deepEqual(resigned, {
    ok: true,
    type: "resign",
    color: WHITE,
    winner: BLACK,
    loser: WHITE,
    margin: 0,
    reason: "resign",
    resignation: true,
    phase: PHASE_FINISHED,
  });
  assert.equal(game.phase, PHASE_FINISHED);
  assert.deepEqual(game.result, {
    winner: BLACK,
    loser: WHITE,
    margin: 0,
    reason: "resign",
    resignation: true,
  });
  assert.equal(game.play(4, 4).reason, MOVE_ERRORS.GAME_NOT_PLAYING);
  assert.equal(game.pass().reason, MOVE_ERRORS.GAME_NOT_PLAYING);

  const restored = GoEngine.fromState(JSON.parse(game.serialize()));
  assert.deepEqual(restored.getState(), game.getState());
  assert.deepEqual(restored.getReplayState(), game.getReplayState());
  assert.equal(restored.canUndo(), false);
  assert.equal(restored.undo().reason, MOVE_ERRORS.NOTHING_TO_UNDO);

  const corrupted = game.exportState();
  corrupted.result.winner = WHITE;
  assert.throws(
    () => GoEngine.fromState(corrupted),
    /valid resignation result/u,
  );
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

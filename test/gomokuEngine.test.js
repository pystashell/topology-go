import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { buildReplayFrames, buildReplayStateAtStep } from "../src/game/replay.js";

/** Rows of "X" (black), "O" (white) and "." to an engine board. */
function boardFrom(rows) {
  return rows.map((row) =>
    [...row].map((char) => (char === "X" ? "black" : char === "O" ? "white" : null)),
  );
}

function stones(width, height, { black = [], white = [] }) {
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [row, col] of black) board[row][col] = "black";
  for (const [row, col] of white) board[row][col] = "white";
  return board;
}

function playAll(game, moves) {
  for (const [row, col] of moves) {
    const result = game.play(row, col);
    assert.equal(result.ok, true, `play ${row},${col}: ${result.reason} ${result.forbidden ?? ""}`);
  }
  return game;
}

/** Black's moves interleaved with White's (Black first, strictly alternating). */
function interleave(black, white) {
  assert.ok(
    white.length === black.length || white.length === black.length - 1,
    `${black.length} black moves need ${black.length - 1} or ${black.length} white replies`,
  );
  const moves = [];
  for (let index = 0; index < Math.max(black.length, white.length); index += 1) {
    if (index < black.length) moves.push(black[index]);
    if (index < white.length) moves.push(white[index]);
  }
  return moves;
}

const points = (cells) => cells.map(({ row, col }) => [row, col]);
// Harmless white replies along the top edge (never five in a row).
const TOP_EDGE = [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 10]];

test("a new game is a 15x15 freestyle cylinder with Black to move", () => {
  const game = new GomokuEngine();
  assert.equal(game.gameType, "gomoku");
  assert.equal(Object.hasOwn(game, "gameType"), false);
  assert.deepEqual(Object.keys(game.getState()), [
    "gameType", "ruleSet", "width", "height", "size", "topology", "board",
    "currentPlayer", "phase", "lastMove", "result",
  ]);
  assert.deepEqual(
    { ...game.getState(), board: undefined },
    {
      gameType: "gomoku", ruleSet: "freestyle", width: 15, height: 15, size: 15,
      topology: "cylinder", board: undefined, currentPlayer: "black", phase: "play",
      lastMove: null, result: null,
    },
  );
  assert.equal(game.board.flat().every((stone) => stone === null), true);
  assert.deepEqual(game.getReplayState(), {
    version: 1, complete: true, base: game.getState(), events: [],
  });
  assert.equal(game.eventCount, 0);
  assert.equal(game.canUndo(), false);
  assert.equal(game.legalMoves().length, 225);

  const wide = new GomokuEngine({ width: 30, height: 11, topology: "mobius", ruleSet: "renju" });
  assert.equal(wide.size, undefined);
  assert.equal(Object.hasOwn(wide.getState(), "size"), false);
  assert.equal(new GomokuEngine({ size: 11 }).width, 11);

  for (const options of [{ size: 10 }, { width: 31 }, { height: 10 }, { width: 12.5 }, { size: 12, width: 13 }]) {
    assert.throws(() => new GomokuEngine(options), RangeError, JSON.stringify(options));
  }
  assert.throws(() => new GomokuEngine({ size: 10 }), /at least 11 lines per side/u);
  assert.throws(() => new GomokuEngine({ topology: "sphere" }), TypeError);
  assert.throws(() => new GomokuEngine({ ruleSet: "standard" }), TypeError);
  assert.throws(() => new GomokuEngine({ currentPlayer: "red" }), TypeError);
});

test("freestyle: five across the cylinder seam, with the line in order", () => {
  const game = new GomokuEngine();
  playAll(game, interleave([[7, 13], [7, 14], [7, 0], [7, 1]], TOP_EDGE.slice(0, 4)));
  const result = game.play(7, 2);
  assert.equal(result.ok, true);
  assert.equal(result.phase, "finished");
  assert.deepEqual(game.result, {
    winner: "black", loser: "white", reason: "five", margin: 0,
    line: [{ row: 7, col: 13 }, { row: 7, col: 14 }, { row: 7, col: 0 }, { row: 7, col: 1 }, { row: 7, col: 2 }],
    length: 5,
  });
  assert.deepEqual(result.result, game.result);
  assert.equal(game.phase, "finished");
  assert.equal(game.currentPlayer, "white");
  assert.deepEqual(game.lastMove, { type: "play", color: "black", row: 7, col: 2 });
  assert.equal(game.play(3, 3).reason, "game_not_playing");
  assert.equal(game.checkPlay(3, 3).reason, "game_not_playing");
  assert.equal(game.canUndo(), false);
  assert.deepEqual(game.undo(), { ok: false, reason: "nothing_to_undo" });
  assert.deepEqual(game.undoMoveColors(), []);
  assert.deepEqual(game.legalMoves(), []);
});

test("freestyle: five across the torus top and bottom", () => {
  const game = new GomokuEngine({ topology: "torus" });
  playAll(game, interleave(
    [[7, 0], [7, 2], [7, 6], [7, 8], [7, 10]],
    [[13, 4], [14, 4], [0, 4], [1, 4], [2, 4]],
  ));
  assert.equal(game.result.winner, "white");
  assert.deepEqual(points(game.result.line), [[13, 4], [14, 4], [0, 4], [1, 4], [2, 4]]);
});

test("freestyle: a Mobius row continues in the mirrored row", () => {
  const game = new GomokuEngine({ width: 13, height: 11, topology: "mobius" });
  playAll(game, interleave([[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]], TOP_EDGE.slice(0, 4)));
  assert.equal(game.result.winner, "black");
  assert.deepEqual(points(game.result.line), [[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]]);
  // On a cylinder the same stones are two separate rows.
  const cylinder = new GomokuEngine({ width: 13, height: 11 });
  playAll(cylinder, interleave([[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]], TOP_EDGE.slice(0, 4)));
  assert.equal(cylinder.result, null);
});

test("freestyle: a Mobius '/' diagonal continues as '\\' across the seam", () => {
  const game = new GomokuEngine({ width: 13, height: 11, topology: "mobius" });
  playAll(game, interleave([[2, 2], [4, 0], [5, 12], [4, 11], [3, 1]], TOP_EDGE.slice(1, 5)));
  assert.equal(game.result.winner, "black");
  assert.deepEqual(points(game.result.line), [[2, 2], [3, 1], [4, 0], [5, 12], [4, 11]]);
});

test("freestyle: an overline wins for both colours", () => {
  const black = new GomokuEngine();
  playAll(black, interleave([[7, 2], [7, 3], [7, 4], [7, 6], [7, 7], [7, 5]], TOP_EDGE.slice(0, 5)));
  assert.equal(black.result.winner, "black");
  assert.equal(black.result.length, 6);
  const white = new GomokuEngine();
  playAll(white, interleave(
    [[10, 0], [10, 2], [10, 4], [10, 6], [10, 8], [10, 10]],
    [[7, 2], [7, 3], [7, 4], [7, 6], [7, 7], [7, 5]],
  ));
  assert.equal(white.result.winner, "white");
  assert.equal(white.result.length, 6);
});

test("R14 freestyle: completing a closed line wins with its full length", () => {
  for (const color of ["black", "white"]) {
    const row = Array.from({ length: 10 }, (_, col) => [10, col]);
    const game = new GomokuEngine({
      width: 11, height: 11, topology: "torus",
      initialBoard: stones(11, 11, { [color]: row }),
      currentPlayer: color,
    });
    const result = game.play(10, 10);
    assert.equal(result.ok, true);
    assert.equal(game.result.winner, color);
    assert.equal(game.result.length, 11);
    assert.equal(game.result.line.length, 11);
    assert.equal(new Set(game.result.line.map(({ col }) => col)).size, 11);
    assert.ok(game.result.line.every(({ row }) => row === 10));
    // A position built from an initial board is not a complete record.
    assert.equal(game.getReplayState().complete, false);
    assert.throws(() => GomokuEngine.fromState(game.exportState()), /must be complete/u);
  }
});

const DRAW_PATTERN = [
  "XOXOXOXOXOX", "XOXOXOXOXOX", "OXOXOXOXOXO", "OXOXOXOXOXO", "XOXOXOXOXOX",
  "XOXOXOXOXOX", "OXOXOXOXOXO", "OXOXOXOXOXO", "XOXOXOXOXOX", "XOXOXOXOXOX",
  "OXOXOXOXOXO",
];

test("freestyle: filling the board without a five is a draw", () => {
  const black = [];
  const white = [];
  DRAW_PATTERN.forEach((row, rowIndex) => {
    [...row].forEach((char, col) => (char === "X" ? black : white).push([rowIndex, col]));
  });
  assert.deepEqual([black.length, white.length], [61, 60]);
  const game = new GomokuEngine({ size: 11 });
  const moves = interleave(black, white);
  playAll(game, moves.slice(0, -1));
  assert.equal(game.phase, "play");
  assert.equal(game.legalMoves().length, 1);
  const last = game.play(...moves.at(-1));
  assert.equal(last.phase, "finished");
  assert.deepEqual(game.result, { winner: "draw", reason: "board_full", margin: 0 });
  assert.equal(game.currentPlayer, "white");
  assert.equal(GomokuEngine.fromState(game.serialize()).serialize(), game.serialize());
});

test("Renju: Black with no legal point left draws", () => {
  // Two empties: White fills (0,0); Black's last point (5,5) is an overline.
  const board = boardFrom([
    ".OXOXOXOXOX", "XOXOXOXOXOX", "OXOXOXOXOXO", "OXOXOXOXOXO", "XOXOXOXOXOX",
    "XOXXX.XXXOX", "OXOXOXOXOXO", "OOOXOOOXOXO", "XOXOXOXOXOX", "XOXOXOXOXOX",
    "OXOXOXOXOXO",
  ]);
  const game = new GomokuEngine({ size: 11, ruleSet: "renju", initialBoard: board, currentPlayer: "white" });
  assert.equal(game.forbiddenAt(5, 5), "overline");
  const result = game.play(0, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(game.result, { winner: "draw", reason: "no_legal_moves", margin: 0 });
  assert.equal(game.currentPlayer, "black");
  // Freestyle lets Black win there instead.
  const free = new GomokuEngine({ size: 11, initialBoard: board, currentPlayer: "white" });
  free.play(0, 0);
  assert.equal(free.phase, "play");
  assert.equal(free.play(5, 5).result.winner, "black");
});

test("undo takes back one play and gives the turn back", () => {
  const game = new GomokuEngine({ ruleSet: "renju" });
  playAll(game, [[7, 7], [8, 8], [6, 6]]);
  assert.deepEqual(game.undoMoveColors(), ["black", "white", "black"]);
  const undone = game.undo();
  assert.deepEqual(undone, {
    ok: true, type: "undo", move: { type: "play", color: "black", row: 6, col: 6 },
    currentPlayer: "black", phase: "play",
  });
  assert.equal(game.board[6][6], null);
  assert.deepEqual(game.lastMove, { type: "play", color: "white", row: 8, col: 8 });
  assert.equal(game.serialize(), playAll(new GomokuEngine({ ruleSet: "renju" }), [[7, 7], [8, 8]]).serialize());
  game.undo();
  assert.equal(game.currentPlayer, "white");
  game.undo();
  assert.equal(game.currentPlayer, "black");
  assert.equal(game.lastMove, null);
  assert.equal(game.canUndo(), false);
  assert.equal(game.undo().reason, "nothing_to_undo");
  assert.equal(game.serialize(), new GomokuEngine({ ruleSet: "renju" }).serialize());

  const resigned = playAll(new GomokuEngine(), [[7, 7]]);
  assert.equal(resigned.canUndo(), true);
  resigned.resign("white");
  assert.equal(resigned.canUndo(), false);
  assert.deepEqual(resigned.undoMoveColors(), []);
});

test("resignation ends the game with Go's result shape", () => {
  const game = playAll(new GomokuEngine(), [[7, 7], [8, 8]]);
  const result = game.resign();
  assert.deepEqual(result, {
    ok: true, type: "resign", color: "black", winner: "white", loser: "black",
    margin: 0, reason: "resign", resignation: true, phase: "finished",
  });
  assert.deepEqual(game.result, {
    winner: "white", loser: "black", margin: 0, reason: "resign", resignation: true,
  });
  assert.deepEqual(game.getReplayState().events.at(-1), { type: "resign", color: "black" });
  assert.equal(game.resign().reason, "game_not_playing");
  assert.throws(() => new GomokuEngine().resign("red"), TypeError);
  assert.equal(GomokuEngine.fromState(game.serialize()).serialize(), game.serialize());
});

test("checkPlay reports play's failures without changing anything", () => {
  const game = playAll(new GomokuEngine({ ruleSet: "renju" }), interleave(
    [[7, 5], [7, 6], [5, 7], [6, 7]], TOP_EDGE.slice(0, 4),
  ));
  const before = game.serialize();
  assert.deepEqual(game.checkPlay(-1, 0), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.checkPlay(0, 15), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.checkPlay(1.5, 0), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.checkPlay(7, 5), { ok: false, reason: "occupied" });
  assert.deepEqual(game.checkPlay(7, 8), { ok: true });
  // R1 through play(): rejected with the forbidden reason, nothing changes.
  const expected = { ok: false, reason: "forbidden", forbidden: "double_three" };
  assert.deepEqual(game.checkPlay(7, 7), expected);
  assert.deepEqual(game.play(7, 7), expected);
  assert.equal(game.serialize(), before);
  assert.deepEqual(game.forbiddenPoints(), [{ row: 7, col: 7, reason: "double_three" }]);
  assert.equal(game.forbiddenAt(7, 7), "double_three");
  assert.equal(game.forbiddenAt(7, 8), null);
  assert.equal(game.forbiddenAt(99, 0), null);
  // Black may not play there; White may.
  assert.equal(game.legalMoves().length, 225 - 8 - 1);
  assert.equal(game.legalMoves().some(({ row, col }) => row === 7 && col === 7), false);
  game.play(12, 12);
  assert.equal(game.legalMoves().length, 225 - 9);
  assert.deepEqual(game.checkPlay(7, 7), { ok: true });
});

test("forbiddenPoints is cached per position and refreshed after undo", () => {
  const game = playAll(new GomokuEngine({ ruleSet: "renju" }), interleave(
    [[7, 5], [7, 6], [5, 7], [6, 7], [12, 12]], TOP_EDGE.slice(0, 4),
  ));
  // White to move; (7,7) is forbidden for Black.
  assert.deepEqual(game.forbiddenPoints(), [{ row: 7, col: 7, reason: "double_three" }]);
  game.play(7, 8);
  assert.deepEqual(game.forbiddenPoints(), []);
  const copy = game.forbiddenPoints();
  copy.push({ row: 0, col: 0, reason: "overline" });
  assert.deepEqual(game.forbiddenPoints(), []);
  game.undo();
  game.play(0, 12);
  // Same event count as before the undo, different position.
  assert.deepEqual(game.forbiddenPoints(), [{ row: 7, col: 7, reason: "double_three" }]);
  assert.deepEqual(new GomokuEngine().forbiddenPoints(), []);
});

test("R8/R9: an exact five wins even with an overline or double three", () => {
  // R8: the column is an exact five, the row an overline.
  const position = {
    black: [[7, 4], [7, 5], [7, 6], [7, 8], [7, 9], [3, 7], [4, 7], [5, 7], [6, 7]],
    white: [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [0, 12], [2, 0]],
  };
  const renju = new GomokuEngine({ ruleSet: "renju", initialBoard: stones(15, 15, position) });
  assert.equal(renju.checkPlay(7, 7).ok, true);
  renju.play(7, 7);
  assert.equal(renju.result.winner, "black");
  assert.equal(renju.result.length, 5);
  assert.deepEqual(points(renju.result.line), [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  // Freestyle reports the first winning axis, the six-stone row.
  const free = new GomokuEngine({ initialBoard: stones(15, 15, position) });
  free.play(7, 7);
  assert.equal(free.result.length, 6);
  assert.deepEqual(points(free.result.line), [[7, 4], [7, 5], [7, 6], [7, 7], [7, 8], [7, 9]]);
  // Overline alone stays forbidden.
  const overline = new GomokuEngine({
    ruleSet: "renju",
    initialBoard: stones(15, 15, { black: position.black.slice(0, 5), white: position.white }),
  });
  assert.deepEqual(overline.play(7, 7), { ok: false, reason: "forbidden", forbidden: "overline" });

  // R9: five plus a double three.
  const r9 = new GomokuEngine({
    ruleSet: "renju",
    initialBoard: stones(15, 15, {
      black: [[7, 3], [7, 4], [7, 5], [7, 6], [5, 7], [6, 7], [5, 5], [6, 6]],
      white: [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [0, 12], [2, 0]],
    }),
  });
  r9.play(7, 7);
  assert.equal(r9.result.winner, "black");
  assert.deepEqual(points(r9.result.line), [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
});

test("R10: a four-three is legal for Black", () => {
  const game = playAll(new GomokuEngine({ ruleSet: "renju" }), interleave(
    [[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]],
    [[7, 3], [0, 0], [0, 2], [0, 4], [0, 6]],
  ));
  const result = game.play(7, 7);
  assert.equal(result.ok, true);
  assert.equal(result.phase, "play");
  assert.equal(game.currentPlayer, "white");
});

test("R12: White is never restricted and wins with an overline", () => {
  const white = (spec) => new GomokuEngine({
    ruleSet: "renju",
    initialBoard: stones(15, 15, { white: spec.white, black: spec.black ?? [] }),
    currentPlayer: "white",
  });
  // Double three, double four.
  const doubleThree = white({ white: [[7, 5], [7, 6], [5, 7], [6, 7]] });
  assert.equal(doubleThree.play(7, 7).ok, true);
  assert.equal(doubleThree.phase, "play");
  const doubleFour = white({
    white: [[7, 4], [7, 5], [7, 6], [4, 7], [5, 7], [6, 7]], black: [[7, 3], [3, 7]],
  });
  assert.equal(doubleFour.play(7, 7).ok, true);
  assert.equal(doubleFour.phase, "play");
  // Overline wins.
  const overline = white({ white: [[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]] });
  overline.play(7, 5);
  assert.equal(overline.result.winner, "white");
  assert.equal(overline.result.length, 6);
  // R14 for White: a full closed line wins.
  const torus = new GomokuEngine({
    size: 11, topology: "torus", ruleSet: "renju", currentPlayer: "white",
    initialBoard: stones(11, 11, { white: Array.from({ length: 10 }, (_, col) => [10, col]) }),
  });
  torus.play(10, 10);
  assert.deepEqual([torus.result.winner, torus.result.length], ["white", 11]);
});

test("R14: Black may not complete a closed line under Renju", () => {
  const game = new GomokuEngine({
    size: 11, topology: "torus", ruleSet: "renju",
    initialBoard: stones(11, 11, { black: Array.from({ length: 10 }, (_, col) => [10, col]) }),
  });
  assert.deepEqual(game.play(10, 10), { ok: false, reason: "forbidden", forbidden: "overline" });
  assert.ok(game.forbiddenPoints().some(({ row, col }) => row === 10 && col === 10));
});

/** A Renju game with a five, for persistence tests. */
function finishedRenjuGame() {
  return playAll(new GomokuEngine({ width: 13, height: 11, topology: "mobius", ruleSet: "renju" }), interleave(
    [[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]],
    [[5, 5], [5, 6], [4, 6], [6, 6]],
  ));
}

test("fromState restores by replaying from the start", () => {
  const game = finishedRenjuGame();
  assert.equal(game.result.winner, "black");
  const state = game.exportState();
  assert.deepEqual(Object.keys(state).at(-1), "replay");
  assert.deepEqual(game.exportState({ includeReplay: false }), game.getState());
  for (const input of [state, game.serialize(), structuredClone(state)]) {
    assert.equal(GomokuEngine.fromState(input).serialize(), game.serialize());
  }
  assert.equal(GomokuEngine.deserialize(game.serialize()).serialize(), game.serialize());
  // A replay base is the canonical start and needs no replay of its own.
  const base = GomokuEngine.fromState(state.replay.base);
  assert.equal(base.serialize(), new GomokuEngine({ width: 13, height: 11, topology: "mobius", ruleSet: "renju" }).serialize());
  // Mid-game positions without their record cannot be trusted.
  assert.throws(() => GomokuEngine.fromState(game.getState()), /without a replay must be the starting position/u);
  // A restored game keeps playing and undoing.
  const running = playAll(new GomokuEngine({ ruleSet: "renju" }), [[7, 7], [8, 8], [6, 6]]);
  const restored = GomokuEngine.fromState(running.serialize());
  assert.equal(restored.undo().ok, true);
  assert.equal(restored.play(1, 1).ok, true);
});

test("fromState rejects tampered states", () => {
  const game = finishedRenjuGame();
  const state = game.exportState();
  const tamper = (label, edit, pattern = Error) => {
    const copy = structuredClone(state);
    edit(copy);
    assert.throws(() => GomokuEngine.fromState(copy), pattern, label);
  };
  tamper("board", (s) => { s.board[0][0] = "white"; }, /reconstruct the current board/u);
  tamper("board shape", (s) => { s.board.pop(); }, RangeError);
  tamper("board value", (s) => { s.board[0][0] = "red"; }, TypeError);
  tamper("turn", (s) => { s.currentPlayer = "black"; }, /currentPlayer/u);
  tamper("phase", (s) => { s.phase = "play"; }, /phase/u);
  tamper("scoring phase", (s) => { s.phase = "scoring"; }, /Unknown game phase/u);
  tamper("last move", (s) => { s.lastMove.col = 3; }, /lastMove/u);
  tamper("last move extra", (s) => { s.lastMove.captured = []; }, /lastMove/u);
  tamper("result winner", (s) => { s.result.winner = "white"; }, /result/u);
  tamper("result line", (s) => { s.result.line.reverse(); }, /result/u);
  tamper("result length", (s) => { s.result.length = 6; }, /result/u);
  tamper("result missing", (s) => { s.result = null; }, /result/u);
  tamper("gameType", (s) => { s.gameType = "go"; }, /gameType/u);
  tamper("no gameType", (s) => { delete s.gameType; }, /missing gameType/u);
  tamper("ruleSet", (s) => { s.ruleSet = "freestyle"; }, /replay.base/u);
  tamper("unknown ruleSet", (s) => { s.ruleSet = "standard"; }, TypeError);
  tamper("topology", (s) => { s.topology = "sphere"; }, TypeError);
  tamper("too small", (s) => { s.width = 10; }, RangeError);
  tamper("size", (s) => { s.size = 13; }, RangeError);
  tamper("replay version", (s) => { s.replay.version = 2; }, /version/u);
  tamper("partial replay", (s) => { s.replay.complete = false; }, /complete/u);
  tamper("base board", (s) => { s.replay.base.board[0][0] = "black"; }, /starting position/u);
  tamper("base turn", (s) => { s.replay.base.currentPlayer = "white"; }, /starting position/u);
  tamper("base extra", (s) => { s.replay.base.komi = 6.5; }, /starting position/u);
  tamper("nested replay", (s) => { s.replay.base.replay = structuredClone(s.replay); }, /nested replay/u);
  tamper("events missing", (s) => { delete s.replay.events; }, /missing events/u);
  tamper("event dropped", (s) => { s.replay.events.pop(); }, /reconstruct/u);
  tamper("event colour", (s) => { s.replay.events[0].color = "white"; }, /player to move/u);
  tamper("event bad colour", (s) => { s.replay.events[0].color = "red"; }, /invalid color/u);
  tamper("event occupied", (s) => { s.replay.events[2] = { ...s.replay.events[0] }; }, /illegal: occupied/u);
  tamper("event off board", (s) => { s.replay.events[0].row = 99; }, /illegal: out_of_bounds/u);
  tamper("event pass", (s) => { s.replay.events[1] = { type: "pass", color: "white" }; }, /Unknown replay event type/u);
  tamper("event after the end", (s) => {
    s.replay.events.push({ type: "play", color: "white", row: 9, col: 9 });
  }, /illegal: game_not_playing/u);
  tamper("resign after the end", (s) => {
    s.replay.events.push({ type: "resign", color: "white" });
  }, /illegal: game_not_playing/u);
  tamper("too many events", (s) => {
    s.replay.events = Array(13 * 11 + 2).fill({ type: "resign", color: "black" });
  }, RangeError);
  assert.throws(() => GomokuEngine.fromState("{"), /valid JSON/u);
  assert.throws(() => GomokuEngine.fromState([]), /plain object/u);
  assert.throws(() => GomokuEngine.fromState(null), /plain object/u);

  // A Renju record may not contain a forbidden move.
  const r1 = playAll(new GomokuEngine({ ruleSet: "renju" }), interleave(
    [[7, 5], [7, 6], [5, 7], [6, 7]], TOP_EDGE.slice(0, 4),
  ));
  const forged = r1.exportState();
  forged.replay.events.push({ type: "play", color: "black", row: 7, col: 7 });
  forged.board[7][7] = "black";
  forged.currentPlayer = "white";
  forged.lastMove = { type: "play", color: "black", row: 7, col: 7 };
  assert.throws(() => GomokuEngine.fromState(forged), /illegal: forbidden/u);
  // The same record is fine in freestyle.
  const freestyle = structuredClone(forged);
  freestyle.ruleSet = "freestyle";
  freestyle.replay.base.ruleSet = "freestyle";
  assert.equal(GomokuEngine.fromState(freestyle).board[7][7], "black");
});

test("replays rebuild every frame through replay.js", () => {
  const game = finishedRenjuGame();
  const replay = game.getReplayState();
  const { frames, steps, complete } = buildReplayFrames(replay);
  assert.equal(complete, true);
  assert.equal(frames.length, replay.events.length + 1);
  assert.deepEqual(frames[0], replay.base);
  assert.deepEqual(frames.at(-1), game.getState());
  assert.deepEqual(steps, replay.events.map((event) => ({ ...event })));
  assert.ok(steps.every((step) => !("captured" in step) && !("flipped" in step) && !("skipped" in step)));

  for (let step = 0; step <= replay.events.length; step += 1) {
    const expected = playAll(
      new GomokuEngine({ width: 13, height: 11, topology: "mobius", ruleSet: "renju" }),
      replay.events.slice(0, step).map(({ row, col }) => [row, col]),
    );
    assert.deepEqual(buildReplayStateAtStep(replay, step), expected.exportState({ includeReplay: false }));
    assert.deepEqual(frames[step], expected.getState());
  }
  assert.throws(() => buildReplayStateAtStep(replay, replay.events.length + 1), RangeError);

  // A resignation updates the last frame without adding a move.
  const resigned = playAll(new GomokuEngine(), [[7, 7], [8, 8]]);
  resigned.resign("white");
  const resignedFrames = buildReplayFrames(resigned.getReplayState());
  assert.equal(resignedFrames.frames.length, 3);
  assert.deepEqual(resignedFrames.frames.at(-1).result, resigned.result);

  // A room's timeout outcome overlays the final frame.
  const timed = buildReplayFrames({
    ...playAll(new GomokuEngine(), [[7, 7]]).getReplayState(),
    outcome: { reason: "timeout", winner: "black", loser: "white", finishedAt: 5 },
  });
  assert.equal(timed.frames.at(-1).result.reason, "timeout");

  // replay.js validates every event with the game's own rules.
  const forbidden = playAll(new GomokuEngine({ ruleSet: "renju" }), interleave(
    [[7, 5], [7, 6], [5, 7], [6, 7]], TOP_EDGE.slice(0, 4),
  )).getReplayState();
  forbidden.events.push({ type: "play", color: "black", row: 7, col: 7 });
  assert.throws(() => buildReplayFrames(forbidden), /illegal: forbidden/u);
  assert.throws(
    () => buildReplayFrames({ ...replay, events: [{ type: "pass", color: "black" }] }),
    /does not exist in gomoku/u,
  );
  assert.throws(
    () => buildReplayFrames({ ...replay, base: { ...replay.base, currentPlayer: "white" } }),
    /starting position/u,
  );
});

/** A dense 19x19 Renju position: black-heavy, no five, 44 forbidden points. */
const DENSE_19 = [
  "X..O....XX.XX..XX..", "XX..O.XO.X..O.X....", ".....X.XO.OOX.X...X",
  "X.XX.XX..OX.X...XX.", "....X..X.....XX.X..", ".XO..XX.X..OXXX.XX.",
  "....X.X...X...XX.XX", ".XX.....XXO..O.X.XO", "X.X..XXXX.X..XOX.X.",
  "X...X.X.....OX.....", ".XX.X.XX.XOX.X..O..", "XXX.XX.XX..O..XX.XO",
  "X.X..XXX...OXXOX.O.", "X...X.OX..X..X....X", ".XXX.X...O.X..XXX..",
  "X..X...X.X.XX.XXX.X", ".X..X....O.XXXXO..X", "..XX.....XXXX...X..",
  "XX.X.OOXXXX.X..X..X",
];

test("forbiddenPoints on a dense 19x19 board stays well under 50 ms", (t) => {
  const timings = [];
  let count = 0;
  for (let run = 0; run < 5; run += 1) {
    const game = new GomokuEngine({ size: 19, ruleSet: "renju", initialBoard: boardFrom(DENSE_19) });
    const started = performance.now();
    count = game.forbiddenPoints().length;
    timings.push(performance.now() - started);
  }
  t.diagnostic(
    `forbiddenPoints dense 19x19 (${count} points): first ${timings[0].toFixed(2)} ms, ` +
    `then ${timings.slice(1).map((ms) => ms.toFixed(2)).join(" / ")} ms`,
  );
  assert.equal(count, 44);
  // The budget is 50 ms; assert with a wide margin so loaded CI never flakes.
  assert.ok(timings[0] < 200, `first call took ${timings[0]} ms`);
  assert.ok(Math.min(...timings) < 50, `fastest call took ${Math.min(...timings)} ms`);
});

import assert from "node:assert/strict";
import test from "node:test";

import { GAME_MOVE_ERRORS } from "../src/game/gameTypes.js";
import { BLACK, GoEngine, MOVE_ERRORS, WHITE } from "../src/game/goEngine.js";
import {
  OTHELLO_RESULT_DISCS,
  OthelloEngine,
  othelloStartBoard,
} from "../src/game/othelloEngine.js";
import { buildReplayFrames, buildReplayStateAtStep } from "../src/game/replay.js";
import { DIRECTIONS_8, TOPOLOGY_KINDS, getTopology } from "../src/topology/index.js";

/** Rows of "B", "W" and "." to a board. */
function parseBoard(rows) {
  return rows.map((line) =>
    [...line].map((cell) => (cell === "B" ? BLACK : cell === "W" ? WHITE : null)),
  );
}

function drawBoard(board) {
  return board.map((row) =>
    row.map((value) => (value === BLACK ? "B" : value === WHITE ? "W" : ".")).join(""),
  );
}

/** A custom position (not restorable by fromState, which needs the start). */
function position(rows, { topology = "cylinder", currentPlayer = BLACK } = {}) {
  const initialBoard = parseBoard(rows);
  return new OthelloEngine({
    width: initialBoard[0].length,
    height: initialBoard.length,
    topology,
    initialBoard,
    currentPlayer,
  });
}

function playAll(game, moves) {
  moves.forEach(([row, col], index) => {
    const result = game.play(row, col);
    assert.equal(result.ok, true, `move ${index} (${row},${col}): ${result.reason}`);
  });
  return game;
}

/** Whether `color` could move in this position, ignoring whose turn it is. */
function canMove(game, color) {
  return OthelloEngine.fromPublicState({
    ...game.getState(),
    phase: "play",
    currentPlayer: color,
  }).legalMoves().length > 0;
}

/** Small deterministic PRNG (mulberry32). */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flips computed straight from topology.ray, the rule's definition. */
function referenceFlips(board, topology, row, col, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const flips = new Map();
  for (const [dRow, dCol] of DIRECTIONS_8) {
    const run = [];
    let outflanked = false;
    for (const cell of topology.ray(row, col, dRow, dCol).cells) {
      const value = board[cell.row][cell.col];
      if (value === opponent) {
        run.push(cell);
        continue;
      }
      outflanked = value === color && run.length > 0;
      break;
    }
    if (!outflanked) continue;
    for (const cell of run) {
      flips.set(`${cell.row},${cell.col}`, { row: cell.row, col: cell.col });
    }
  }
  return [...flips.values()];
}

const START_8X8 = [
  "........",
  "........",
  "........",
  "...WB...",
  "...BW...",
  "........",
  "........",
  "........",
];

// Seeded random games found by search; each is checked move by move below.
// Cylinder 6x6: White's 8th move leaves Black without a move.
const SKIP_GAME = [
  [2, 1], [1, 1], [0, 1], [2, 4], [3, 4], [0, 0], [2, 5], [0, 2], [4, 4], [1, 2],
];
// Mobius 6x6: Black wipes White out in seven moves.
const WIPEOUT_GAME = [[1, 2], [1, 1], [1, 0], [1, 3], [4, 4], [4, 5], [1, 4]];
// Cylinder 6x6: neither side can move with both colours and three gaps left.
const BLOCKED_GAME = [
  [1, 2], [3, 1], [4, 3], [1, 3], [0, 3], [5, 4], [2, 1], [1, 1], [4, 0], [4, 1],
  [5, 0], [2, 4], [0, 0], [0, 1], [0, 2], [5, 1], [1, 4], [0, 4], [5, 3], [0, 5],
  [2, 0], [1, 0], [5, 2], [4, 2], [2, 5], [5, 5], [4, 4], [3, 4], [1, 5],
];
// Cylinder 6x6: the board fills up 18-18.
const DRAW_GAME = [
  [3, 4], [4, 4], [1, 2], [3, 1], [4, 0], [2, 4], [3, 5], [5, 1], [3, 0], [2, 0],
  [2, 5], [2, 1], [1, 1], [4, 2], [5, 5], [5, 3], [5, 4], [0, 2], [1, 5], [4, 3],
  [0, 0], [1, 3], [0, 3], [1, 4], [0, 4], [4, 5], [4, 1], [5, 0], [0, 1], [1, 0],
  [5, 2], [0, 5],
];

test("O1: the 8x8 start has four legal moves for each side on every topology", () => {
  for (const topology of TOPOLOGY_KINDS) {
    const game = new OthelloEngine({ topology });
    assert.deepEqual(drawBoard(game.board), START_8X8, topology);
    assert.deepEqual(game.legalMoves(), [
      { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 4, col: 5 }, { row: 5, col: 4 },
    ], topology);
    const white = position(START_8X8, { topology, currentPlayer: WHITE });
    assert.deepEqual(white.legalMoves(), [
      { row: 2, col: 4 }, { row: 3, col: 5 }, { row: 4, col: 2 }, { row: 5, col: 3 },
    ], topology);
    assert.deepEqual(game.getState(), {
      gameType: "othello",
      size: 8,
      width: 8,
      height: 8,
      topology,
      board: parseBoard(START_8X8),
      currentPlayer: BLACK,
      phase: "play",
      discs: { black: 2, white: 2 },
      lastMove: null,
      result: null,
    });
    assert.deepEqual(game.getReplayState(), {
      version: 1, complete: true, base: game.getState(), events: [],
    });
  }
  const game = new OthelloEngine();
  assert.equal(game.gameType, "othello");
  assert.equal(Object.hasOwn(game, "gameType"), false);
  assert.equal(game.topology, "cylinder");
  assert.deepEqual([game.width, game.height, game.size], [8, 8, 8]);
});

test("O2: flips run across the cylinder seam, but not across a Mobius twist", () => {
  const rows = [
    "........",
    "W.....BW",
    "........",
    "........",
    "........",
    "........",
  ];
  for (const topology of ["cylinder", "torus"]) {
    const game = position(rows, { topology });
    const expected = [{ row: 1, col: 0 }, { row: 1, col: 7 }];
    assert.deepEqual(game.checkPlay(1, 1), { ok: true, flipped: expected });
    const result = game.play(1, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.flipped, expected);
    assert.deepEqual(game.lastMove.flipped, expected);
    assert.equal(drawBoard(game.board)[1], "BB....BB");
  }
  // On a Mobius strip (1, 0) leads left into the mirrored row 4, which is empty.
  assert.deepEqual(position(rows, { topology: "mobius" }).play(1, 1), {
    ok: false, reason: GAME_MOVE_ERRORS.NO_FLIPS,
  });
});

test("O3: a Mobius row continues across the seam into the mirrored row", () => {
  const rows = [
    "........",
    ".......W",
    "........",
    "........",
    "WB......",
    "........",
  ];
  const game = position(rows, { topology: "mobius" });
  const result = game.play(1, 6);
  assert.equal(result.ok, true);
  assert.deepEqual(result.flipped, [{ row: 1, col: 7 }, { row: 4, col: 0 }]);
  assert.deepEqual(drawBoard(game.board), [
    "........",
    "......BB",
    "........",
    "........",
    "BB......",
    "........",
  ]);
  // Without the twist, (1, 0) is empty and nothing is outflanked.
  for (const topology of ["cylinder", "torus"]) {
    assert.equal(position(rows, { topology }).checkPlay(1, 6).reason, "no_flips");
  }
});

test("O4: a Mobius diagonal crosses the seam and turns into the other diagonal", () => {
  const rows = [
    "........",
    ".B......",
    "W......W",
    "........",
    "........",
    "........",
  ];
  // Down-right from (2, 7) crosses the seam to (2, 0) travelling up-right.
  assert.deepEqual(getTopology("mobius", 8, 6).step(2, 7, 1, 1), {
    row: 2, col: 0, dRow: -1, dCol: 1,
  });
  const game = position(rows, { topology: "mobius" });
  const result = game.play(1, 6);
  assert.equal(result.ok, true);
  assert.deepEqual(result.flipped, [{ row: 2, col: 7 }, { row: 2, col: 0 }]);
  assert.deepEqual(game.discs, { black: 4, white: 0 });
  // A cylinder keeps going down to the empty (3, 0).
  assert.equal(position(rows, { topology: "cylinder" }).checkPlay(1, 6).reason, "no_flips");
});

test("O5: torus columns and diagonals wrap from top to bottom", () => {
  const rows = [
    "......",
    "......",
    "......",
    "......",
    "B.B...",
    ".WW...",
  ];
  const game = position(rows, { topology: "torus" });
  const result = game.play(0, 2);
  assert.equal(result.ok, true);
  // Up wraps to (5, 2); up-left wraps to (5, 1).
  assert.deepEqual(result.flipped, [{ row: 5, col: 2 }, { row: 5, col: 1 }]);
  for (const topology of ["cylinder", "mobius"]) {
    assert.equal(position(rows, { topology }).checkPlay(0, 2).reason, "no_flips");
  }

  // The corner's up-left neighbour is the opposite corner.
  const corner = position([
    "......",
    "......",
    "......",
    "......",
    "....B.",
    ".....W",
  ], { topology: "torus" });
  assert.deepEqual(corner.play(0, 0).flipped, [{ row: 5, col: 5 }]);
});

test("O6: a cyclic line of opponent discs with one gap flips nothing and terminates", () => {
  const game = position([
    "......",
    "......",
    ".WWWWW",
    "......",
    "...B..",
    "......",
  ], { topology: "torus" });
  const before = game.serialize();
  assert.deepEqual(game.play(2, 0), { ok: false, reason: GAME_MOVE_ERRORS.NO_FLIPS });
  assert.deepEqual(game.checkPlay(2, 0), { ok: false, reason: "no_flips" });
  assert.equal(game.serialize(), before);

  // Every line through the gap is a cycle of White discs on a full torus;
  // each walk stops before re-entering the start point.
  for (const topology of TOPOLOGY_KINDS) {
    for (const [width, height] of [[6, 6], [8, 6], [10, 8]]) {
      const board = Array.from({ length: height }, () => Array(width).fill(WHITE));
      board[2][0] = null;
      board[height - 1][width - 1] = BLACK;
      const full = new OthelloEngine({ width, height, topology, initialBoard: board });
      const reference = referenceFlips(full.board, getTopology(topology, width, height), 2, 0, BLACK);
      const check = full.checkPlay(2, 0);
      if (reference.length === 0) {
        assert.equal(check.reason, "no_flips", `${topology} ${width}x${height}`);
      } else {
        assert.deepEqual(check.flipped, reference, `${topology} ${width}x${height}`);
      }
    }
  }
  const torus = new OthelloEngine({
    width: 8,
    height: 6,
    topology: "torus",
    initialBoard: Array.from({ length: 6 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => (row === 2 && col === 0 ? null : WHITE))),
  });
  assert.equal(torus.play(2, 0).reason, "no_flips");
});

test("O7: discs reached along two lines flip once", () => {
  // Torus 8x6: the row and the down-right diagonal from (0, 0) share (0, 6).
  const torus = position([
    ".WWWWWWB",
    ".W.....B",
    "..W.....",
    "...W....",
    "....W...",
    ".....W..",
  ], { topology: "torus" });
  const result = torus.play(0, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.flipped, [
    { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 },
    { row: 0, col: 5 }, { row: 0, col: 6 },
    { row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }, { row: 4, col: 4 },
    { row: 5, col: 5 },
  ]);
  assert.deepEqual(torus.discs, { black: 14, white: 0 });

  // Mobius 6x8: the column and the diagonal (after the twist) share (1, 0).
  const mobius = position([
    ".B....",
    "WW....",
    "B.W...",
    "...W..",
    "....W.",
    ".....W",
    "......",
    "......",
  ], { topology: "mobius" });
  const twisted = mobius.play(0, 0);
  assert.deepEqual(twisted.flipped, [
    { row: 1, col: 0 },
    { row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }, { row: 4, col: 4 },
    { row: 5, col: 5 },
  ]);
  assert.deepEqual(mobius.discs, { black: 9, white: 0 });
});

test("O8: an automatic pass adds no event, replays and undoes", () => {
  const game = new OthelloEngine({ width: 6, height: 6 });
  const states = [game.exportState({ includeReplay: false })];
  const results = [];
  for (const [row, col] of SKIP_GAME) {
    const result = game.play(row, col);
    assert.equal(result.ok, true);
    results.push(result);
    states.push(game.exportState({ includeReplay: false }));
  }
  const colors = results.map((result) => result.color);
  assert.deepEqual(colors, [
    BLACK, WHITE, BLACK, WHITE, BLACK, WHITE, BLACK, WHITE, WHITE, BLACK,
  ]);
  assert.deepEqual(results.map((result) => result.skipped), [
    null, null, null, null, null, null, null, BLACK, null, null,
  ]);
  assert.equal(results[7].nextPlayer, WHITE);
  assert.equal(states[8].currentPlayer, WHITE);
  assert.equal(states[8].lastMove.skipped, BLACK);
  assert.equal(canMove(OthelloEngine.fromPublicState(states[8]), BLACK), false);
  assert.equal(game.getReplayState().events.length, SKIP_GAME.length);
  assert.ok(game.getReplayState().events.every((event) => event.type === "play"));
  assert.deepEqual(game.undoMoveColors(), colors);

  const replay = game.getReplayState();
  const { frames, steps } = buildReplayFrames(replay);
  assert.equal(frames.length, SKIP_GAME.length + 1);
  frames.forEach((frame, index) => assert.deepEqual(frame, states[index], `frame ${index}`));
  assert.deepEqual(steps[7], {
    type: "play", color: WHITE, row: 0, col: 2, flipped: results[7].flipped, skipped: BLACK,
  });
  assert.deepEqual(steps.map((step) => step.color), colors);
  assert.deepEqual(buildReplayStateAtStep(replay, 8), states[8]);
  assert.deepEqual(buildReplayStateAtStep(replay, 0), states[0]);

  // Restore at the pass, then undo across it.
  const restored = OthelloEngine.fromState(game.serialize());
  assert.equal(restored.serialize(), game.serialize());
  for (const undone of [9, 8, 7]) {
    const result = restored.undo();
    assert.equal(result.ok, true);
    const { color, row, col, flipped, skipped } = results[undone];
    assert.deepEqual(result.move, { type: "play", color, row, col, flipped, skipped });
    assert.equal(result.currentPlayer, colors[undone]);
    assert.deepEqual(restored.exportState({ includeReplay: false }), states[undone]);
    assert.deepEqual(restored.undoMoveColors(), colors.slice(0, undone));
  }
  assert.equal(restored.currentPlayer, WHITE);
  assert.equal(restored.lastMove.skipped, null);
  assert.equal(OthelloEngine.fromState(restored.exportState()).serialize(), restored.serialize());
});

test("O9: the game ends when neither side can move", () => {
  // Wipeout before the board is full.
  const wipeout = playAll(new OthelloEngine({ width: 6, height: 6, topology: "mobius" }), WIPEOUT_GAME);
  assert.equal(wipeout.phase, "finished");
  assert.deepEqual(wipeout.result, {
    winner: BLACK, loser: WHITE, reason: OTHELLO_RESULT_DISCS, black: 11, white: 0, margin: 11,
  });
  assert.equal(wipeout.currentPlayer, WHITE);
  assert.equal(wipeout.lastMove.skipped, null);
  assert.ok(wipeout.board.some((row) => row.includes(null)));
  assert.deepEqual(wipeout.legalMoves(), []);
  assert.deepEqual(wipeout.play(0, 0), { ok: false, reason: MOVE_ERRORS.GAME_NOT_PLAYING });
  assert.deepEqual(wipeout.checkPlay(0, 0), { ok: false, reason: "game_not_playing" });
  assert.equal(wipeout.canUndo(), false);
  assert.deepEqual(wipeout.undo(), { ok: false, reason: MOVE_ERRORS.NOTHING_TO_UNDO });
  assert.equal(wipeout.resign(BLACK).reason, "game_not_playing");
  assert.equal(OthelloEngine.fromState(wipeout.serialize()).serialize(), wipeout.serialize());

  // Both colours remain, three points stay empty and neither side can move.
  const blocked = new OthelloEngine({ width: 6, height: 6 });
  playAll(blocked, BLOCKED_GAME.slice(0, -1));
  assert.equal(blocked.phase, "play");
  const last = blocked.play(...BLOCKED_GAME.at(-1));
  assert.equal(last.phase, "finished");
  assert.deepEqual(last.result, {
    winner: WHITE, loser: BLACK, reason: "discs", black: 1, white: 32, margin: 31,
  });
  assert.equal(blocked.board.flat().filter((value) => value === null).length, 3);
  assert.equal(canMove(blocked, BLACK), false);
  assert.equal(canMove(blocked, WHITE), false);

  // A full board with equal discs is a draw without a loser.
  const draw = playAll(new OthelloEngine({ width: 6, height: 6 }), DRAW_GAME);
  assert.ok(draw.board.every((row) => row.every((value) => value !== null)));
  assert.deepEqual(draw.result, {
    winner: "draw", reason: "discs", black: 18, white: 18, margin: 0,
  });
  assert.equal(Object.hasOwn(draw.result, "loser"), false);
  assert.deepEqual(buildReplayFrames(draw.getReplayState()).frames.at(-1), draw.getState());

  // Filling the last point of a cylinder: the row is a cycle of White and
  // flips nothing; up-right wraps through (4, 0).
  const full = position([
    "BBBBBB",
    "BBBBBB",
    "BBBBBB",
    "WWWWWW",
    "WWWWWW",
    "WWWWW.",
  ]);
  const filled = full.play(5, 5);
  assert.deepEqual(filled.flipped, [
    { row: 4, col: 5 }, { row: 3, col: 5 },
    { row: 4, col: 4 }, { row: 3, col: 3 },
    { row: 4, col: 0 }, { row: 3, col: 1 },
  ]);
  assert.deepEqual(filled.result, {
    winner: BLACK, loser: WHITE, reason: "discs", black: 25, white: 11, margin: 14,
  });
});

test("O10: sides must be even from 6 to 30, and the start is centred on rectangles", () => {
  for (const options of [
    { size: 7 }, { size: 4 }, { size: 32 }, { width: 8, height: 7 }, { width: 5, height: 8 },
    { width: 31, height: 8 }, { width: 8.5, height: 8 }, { width: "8", height: 8 },
    { width: 0, height: 8 }, { size: 8, width: 10 },
  ]) {
    assert.throws(() => new OthelloEngine(options), RangeError, JSON.stringify(options));
  }
  assert.throws(() => new OthelloEngine({ topology: "sphere" }), TypeError);
  assert.throws(() => new OthelloEngine({ currentPlayer: "red" }), TypeError);
  assert.throws(
    () => new OthelloEngine({ initialBoard: parseBoard(START_8X8).slice(1) }),
    RangeError,
  );
  for (const [width, height] of [[6, 6], [30, 30], [6, 30]]) {
    assert.doesNotThrow(() => new OthelloEngine({ width, height }));
  }

  const tall = new OthelloEngine({ width: 8, height: 10, topology: "mobius" });
  assert.equal(tall.size, undefined);
  assert.equal(Object.hasOwn(tall.getState(), "size"), false);
  assert.deepEqual(drawBoard(tall.board), [
    "........",
    "........",
    "........",
    "........",
    "...WB...",
    "...BW...",
    "........",
    "........",
    "........",
    "........",
  ]);
  assert.deepEqual(tall.legalMoves(), [
    { row: 3, col: 3 }, { row: 4, col: 2 }, { row: 5, col: 5 }, { row: 6, col: 4 },
  ]);
  const wide = new OthelloEngine({ width: 10, height: 8 });
  assert.deepEqual(wide.board, othelloStartBoard(10, 8));
  assert.equal(wide.board[3][4], WHITE);
  assert.equal(wide.board[3][5], BLACK);
  assert.equal(wide.board[4][4], BLACK);
  assert.equal(wide.board[4][5], WHITE);
  assert.deepEqual(wide.discs, { black: 2, white: 2 });
});

test("illegal moves report play()'s reason and change nothing", () => {
  const game = playAll(new OthelloEngine(), [[2, 3]]);
  const before = game.serialize();
  for (const [row, col, reason] of [
    [3, 3, MOVE_ERRORS.OCCUPIED],
    [2, 3, "occupied"],
    [-1, 0, MOVE_ERRORS.OUT_OF_BOUNDS],
    [0, 8, "out_of_bounds"],
    [1.5, 2, "out_of_bounds"],
    ["2", 2, "out_of_bounds"],
    [0, 0, GAME_MOVE_ERRORS.NO_FLIPS],
    [2, 6, "no_flips"],
  ]) {
    assert.deepEqual(game.checkPlay(row, col), { ok: false, reason }, `${row},${col}`);
    assert.deepEqual(game.play(row, col), { ok: false, reason }, `${row},${col}`);
    assert.equal(game.serialize(), before);
  }
  assert.equal(game.get(3, 3), BLACK);
  assert.equal(game.get(9, 9), undefined);
  const board = game.getBoard();
  board[0][0] = WHITE;
  assert.equal(game.board[0][0], null);
});

test("a play reports its flips, skip and result, and records one event", () => {
  const game = new OthelloEngine();
  const result = game.play(2, 3);
  assert.deepEqual(result, {
    ok: true,
    type: "play",
    color: BLACK,
    row: 2,
    col: 3,
    flipped: [{ row: 3, col: 3 }],
    skipped: null,
    nextPlayer: WHITE,
    phase: "play",
    result: null,
  });
  assert.deepEqual(game.lastMove, {
    type: "play", color: BLACK, row: 2, col: 3, flipped: [{ row: 3, col: 3 }], skipped: null,
  });
  assert.deepEqual(game.getState().discs, { black: 4, white: 1 });
  assert.deepEqual(game.getReplayState().events, [{ type: "play", color: BLACK, row: 2, col: 3 }]);
  // Returned and exported values are copies.
  result.flipped[0].row = 99;
  game.getState().lastMove.flipped[0].row = 99;
  game.getReplayState().events.pop();
  assert.deepEqual(game.lastMove.flipped, [{ row: 3, col: 3 }]);
  assert.equal(game.getReplayState().events.length, 1);
});

test("resignation uses Go's result shape and ends undo", () => {
  const game = playAll(new OthelloEngine({ width: 6, height: 8, topology: "torus" }), [[2, 2]]);
  assert.throws(() => game.resign("red"), TypeError);
  const result = game.resign(BLACK);
  const go = new GoEngine({ size: 9 });
  go.resign(BLACK);
  assert.deepEqual(game.result, go.result);
  assert.deepEqual(result, { ok: true, type: "resign", color: BLACK, ...go.result, phase: "finished" });
  assert.deepEqual(game.lastMove.row, 2);
  assert.equal(game.canUndo(), false);
  assert.equal(game.undo().reason, "nothing_to_undo");
  assert.deepEqual(game.getReplayState().events.at(-1), { type: "resign", color: BLACK });
  assert.equal(game.resign(WHITE).reason, "game_not_playing");
  assert.equal(OthelloEngine.fromState(game.serialize()).serialize(), game.serialize());

  const { frames, steps } = buildReplayFrames(game.getReplayState());
  assert.equal(frames.length, 2);
  assert.equal(steps.length, 1);
  assert.deepEqual(frames.at(-1).result, go.result);

  // Resigning defaults to the player to move.
  assert.equal(new OthelloEngine().resign().loser, BLACK);
});

test("undo rebuilds the game without the last play", () => {
  const game = new OthelloEngine({ width: 8, height: 6, topology: "mobius" });
  assert.equal(game.canUndo(), false);
  assert.deepEqual(game.undo(), { ok: false, reason: "nothing_to_undo" });
  const start = game.serialize();
  const states = [start];
  const moves = [];
  for (let index = 0; index < 6; index += 1) {
    const { row, col } = game.legalMoves().at(-1);
    moves.push([row, col]);
    assert.equal(game.play(row, col).ok, true);
    states.push(game.serialize());
  }
  for (let index = states.length - 2; index >= 0; index -= 1) {
    assert.equal(game.undo().ok, true);
    assert.equal(game.serialize(), states[index]);
  }
  assert.equal(game.canUndo(), false);
  // Play continues normally after undoing.
  assert.equal(game.play(...moves[0]).ok, true);
  assert.equal(game.serialize(), states[1]);
});

test("replays round-trip through buildReplayFrames", () => {
  const game = new OthelloEngine({ width: 8, height: 6, topology: "torus" });
  const states = [game.getState()];
  const results = [];
  const random = createRandom(7);
  for (let move = 0; move < 20 && game.phase === "play"; move += 1) {
    const legal = game.legalMoves();
    const { row, col } = legal[Math.floor(random() * legal.length)];
    results.push(game.play(row, col));
    states.push(game.getState());
  }
  const replay = JSON.parse(JSON.stringify(game.getReplayState()));
  const { frames, steps, complete } = buildReplayFrames(replay);
  assert.equal(complete, true);
  assert.deepEqual(frames, states);
  assert.deepEqual(steps, results.map(({ type, color, row, col, flipped, skipped }) => ({
    type, color, row, col, flipped, skipped,
  })));
  for (const step of [0, 5, results.length]) {
    const snapshot = buildReplayStateAtStep(replay, step);
    assert.deepEqual(snapshot, { ...states[step] });
  }
  // A pass event does not exist in Othello.
  assert.throws(
    () => buildReplayFrames({ ...replay, events: [{ type: "pass", color: BLACK }] }),
    /pass does not exist in othello/u,
  );
});

test("fromState accepts JSON and the bare start, and rejects positions without a replay", () => {
  const game = new OthelloEngine({ width: 10, height: 6 });
  playAll(game, [[2, 3]]);
  playAll(game, [Object.values(game.legalMoves()[0])]);
  assert.equal(OthelloEngine.fromState(game.serialize()).serialize(), game.serialize());
  assert.equal(OthelloEngine.deserialize(game.serialize()).serialize(), game.serialize());
  const start = new OthelloEngine({ width: 10, height: 6 });
  assert.equal(OthelloEngine.fromState(start.getState()).serialize(), start.serialize());
  assert.throws(
    () => OthelloEngine.fromState(game.exportState({ includeReplay: false })),
    /has no replay/u,
  );
  // Unknown fields are ignored and never re-exported.
  const extra = OthelloEngine.fromState({ ...game.exportState(), note: "x" });
  assert.equal(extra.serialize(), game.serialize());
  // A custom position's partial replay is not restorable.
  const custom = position(START_8X8, { currentPlayer: WHITE });
  assert.equal(custom.getReplayState().complete, false);
  assert.throws(() => OthelloEngine.fromState(custom.exportState()), TypeError);
});

test("fromState rejects tampered states", () => {
  const game = new OthelloEngine({ width: 6, height: 6 });
  playAll(game, SKIP_GAME.slice(0, 8));
  const good = game.exportState();
  const tamper = (mutate) => {
    const state = structuredClone(good);
    mutate(state);
    return state;
  };
  const cases = {
    "not an object": () => [],
    "invalid JSON": () => "{",
    "go state": () => new GoEngine({ size: 9 }).exportState(),
    "missing gameType": () => tamper((state) => delete state.gameType),
    "odd width": () => tamper((state) => { state.width = 7; }),
    "too small": () => tamper((state) => { state.width = 4; state.height = 4; delete state.size; }),
    "unknown topology": () => tamper((state) => { state.topology = "sphere"; }),
    "board": () => tamper((state) => { state.board[5][5] = BLACK; }),
    "discs": () => tamper((state) => { state.discs.black += 1; }),
    "missing discs": () => tamper((state) => delete state.discs),
    "turn": () => tamper((state) => { state.currentPlayer = BLACK; }),
    "phase": () => tamper((state) => { state.phase = "finished"; }),
    "flip duplicated": () => tamper((state) => { state.lastMove.flipped.push(state.lastMove.flipped[0]); }),
    "flip removed": () => tamper((state) => { state.lastMove.flipped.pop(); }),
    "skip": () => tamper((state) => { state.lastMove.skipped = null; }),
    "result": () => tamper((state) => { state.result = { winner: BLACK }; }),
    "size": () => tamper((state) => { state.size = 8; }),
    "replay version": () => tamper((state) => { state.replay.version = 2; }),
    "partial replay": () => tamper((state) => { state.replay.complete = false; }),
    "replay base": () => tamper((state) => { state.replay.base.board[0][0] = BLACK; }),
    "replay base turn": () => tamper((state) => { state.replay.base.currentPlayer = WHITE; }),
    "events not array": () => tamper((state) => { state.replay.events = {}; }),
    "too many events": () => tamper((state) => {
      state.replay.events = Array(34).fill({ type: "resign", color: BLACK });
    }),
    "event color": () => tamper((state) => { state.replay.events[1].color = BLACK; }),
    "event point": () => tamper((state) => { state.replay.events[0].row = 9; }),
    "event illegal": () => tamper((state) => { state.replay.events[0] = { type: "play", color: BLACK, row: 0, col: 0 }; }),
    "pass event": () => tamper((state) => { state.replay.events.push({ type: "pass", color: WHITE }); }),
    "event removed": () => tamper((state) => { state.replay.events.pop(); }),
    "event after resignation": () => tamper((state) => {
      state.replay.events.splice(1, 0, { type: "resign", color: WHITE });
    }),
  };
  for (const [label, make] of Object.entries(cases)) {
    assert.throws(() => OthelloEngine.fromState(make()), /./u, label);
  }
  // Oversized histories fail before any event is replayed.
  assert.throws(() => OthelloEngine.fromState(cases["too many events"]()), /at most 33 entries/u);
  assert.equal(OthelloEngine.fromState(structuredClone(good)).serialize(), game.serialize());

  // The order of lastMove.flipped is part of the state.
  const multi = new OthelloEngine({ width: 6, height: 6 });
  while (!(multi.lastMove?.flipped.length > 1)) {
    const { row, col } = multi.legalMoves()[0];
    multi.play(row, col);
  }
  const reordered = multi.exportState();
  reordered.lastMove.flipped.reverse();
  assert.throws(() => OthelloEngine.fromState(reordered), /lastMove/u);
});

test("fromPublicState hydrates a render-only position", () => {
  const game = playAll(new OthelloEngine({ width: 6, height: 6 }), SKIP_GAME.slice(0, 8));
  const hydrated = OthelloEngine.fromPublicState(game.getState());
  assert.deepEqual(hydrated.getState(), game.getState());
  assert.equal(hydrated.getReplayState().complete, false);
  assert.deepEqual(hydrated.legalMoves(), game.legalMoves());
  // It plays on and undoes back to the snapshot, but no further.
  const [move] = game.legalMoves();
  assert.deepEqual(hydrated.play(move.row, move.col), game.play(move.row, move.col));
  assert.equal(hydrated.undo().ok, true);
  game.undo();
  assert.deepEqual(hydrated.getState(), game.getState());
  assert.equal(hydrated.canUndo(), false);

  const finished = OthelloEngine.fromPublicState(
    playAll(new OthelloEngine({ width: 6, height: 6, topology: "mobius" }), WIPEOUT_GAME).getState(),
  );
  assert.equal(finished.phase, "finished");
  assert.equal(finished.result.margin, 11);
  assert.deepEqual(finished.legalMoves(), []);
  assert.equal(OthelloEngine.fromPublicState(new OthelloEngine().getState()).getReplayState().complete, true);

  for (const bad of [
    null,
    { ...game.getState(), phase: "scoring" },
    { ...game.getState(), board: [] },
    { ...game.getState(), lastMove: { type: "pass", color: BLACK } },
    { ...game.getState(), lastMove: { ...game.lastMove, flipped: [{ row: 9, col: 0 }] } },
  ]) {
    assert.throws(() => OthelloEngine.fromPublicState(bad), /./u);
  }
});

/**
 * Play one seeded random game to the end, checking every invariant along the
 * way. legalMoves() is compared with checkPlay() and the topology.ray
 * reference over the whole board every `fullCheckEvery` moves. Returns the
 * number of automatic passes.
 */
function checkRandomGame(topology, width, height, seed, { fullCheckEvery = 1 } = {}) {
  const label = `${topology} ${width}x${height} seed ${seed}`;
  const random = createRandom(seed * 1_000 + width * 31 + height);
  const shape = getTopology(topology, width, height);
  const game = new OthelloEngine({ width, height, topology });
  const checkpoint = 4 + Math.floor(random() * 20);
  let moves = 0;
  let skips = 0;
  while (game.phase === "play") {
    const color = game.currentPlayer;
    const opponent = color === BLACK ? WHITE : BLACK;
    const legal = game.legalMoves();
    assert.ok(legal.length > 0, `${label}: the side to move must have a move`);
    if (moves % fullCheckEvery === 0) {
      const byCheck = [];
      const byReference = [];
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          if (game.checkPlay(row, col).ok) byCheck.push({ row, col });
          if (game.board[row][col] === null &&
            referenceFlips(game.board, shape, row, col, color).length > 0) {
            byReference.push({ row, col });
          }
        }
      }
      assert.deepEqual(legal, byCheck, label);
      assert.deepEqual(legal, byReference, label);
    }

    const { row, col } = legal[Math.floor(random() * legal.length)];
    const expected = referenceFlips(game.board, shape, row, col, color);
    assert.deepEqual(game.checkPlay(row, col).flipped, expected, label);
    const before = game.discs;
    const result = game.play(row, col);
    moves += 1;
    assert.deepEqual(result.flipped, expected, label);
    const after = game.discs;
    assert.equal(after[color], before[color] + expected.length + 1, label);
    assert.equal(after[opponent], before[opponent] - expected.length, label);
    assert.equal(after.black + after.white, 4 + moves, label);
    for (const disc of expected) assert.equal(game.board[disc.row][disc.col], color);

    if (result.skipped) {
      skips += 1;
      assert.equal(result.skipped, opponent, label);
      assert.equal(game.currentPlayer, color, label);
      assert.equal(canMove(game, opponent), false, label);
    } else if (game.phase === "play") {
      assert.equal(game.currentPlayer, opponent, label);
    }

    if (moves === checkpoint) {
      const saved = game.serialize();
      assert.equal(OthelloEngine.fromState(saved).serialize(), saved, label);
      assert.equal(game.undo().ok, true, label);
      assert.equal(game.currentPlayer, color, label);
      assert.equal(game.play(row, col).ok, true, label);
      assert.equal(game.serialize(), saved, label);
    }
  }

  const { black, white } = game.discs;
  assert.equal(game.result.black, black, label);
  assert.equal(game.result.white, white, label);
  assert.equal(game.result.margin, Math.abs(black - white), label);
  assert.equal(
    game.result.winner,
    black === white ? "draw" : black > white ? BLACK : WHITE,
    label,
  );
  assert.equal(canMove(game, BLACK), false, label);
  assert.equal(canMove(game, WHITE), false, label);
  assert.equal(game.getReplayState().events.length, moves, label);
  assert.equal(OthelloEngine.fromState(game.exportState()).serialize(), game.serialize(), label);
  assert.equal(OthelloEngine.fromState(game.serialize()).serialize(), game.serialize(), label);
  assert.deepEqual(buildReplayFrames(game.getReplayState()).frames.at(-1), game.getState(), label);
  return skips;
}

test("random games are self-consistent on every topology and shape", () => {
  let skips = 0;
  for (const topology of TOPOLOGY_KINDS) {
    for (const [width, height] of [[6, 6], [8, 8], [6, 10], [10, 6], [12, 8]]) {
      for (const seed of [1, 2]) skips += checkRandomGame(topology, width, height, seed);
    }
  }
  assert.ok(skips > 0, "some random game should include an automatic pass");
});

test("random games stay consistent on the largest boards", () => {
  for (const [topology, width, height] of [
    ["cylinder", 30, 30], ["torus", 30, 28], ["mobius", 28, 30], ["torus", 6, 30],
  ]) {
    checkRandomGame(topology, width, height, 3, { fullCheckEvery: 97 });
  }
});

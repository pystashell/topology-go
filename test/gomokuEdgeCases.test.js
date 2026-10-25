import assert from "node:assert/strict";
import test from "node:test";

import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";
import { createRenjuReference, toReferenceBoard } from "./fixtures/renjuReference.js";

/*
 * Gomoku at the end of the board and in its corners. The three end
 * positions come from real games of the soak test (11x11 cylinder): a five
 * on the very last empty point, a Renju game where Black is left with only
 * forbidden points, and a Renju board filled without a five.
 */

const BLACK = "black";
const WHITE = "white";

function position(rows, { topology = "cylinder", ruleSet = "freestyle", toMove = BLACK } = {}) {
  return new GomokuEngine({
    width: rows[0].length,
    height: rows.length,
    topology,
    ruleSet,
    currentPlayer: toMove,
    initialBoard: rows.map((line) => [...line].map((cell) => (cell === "B" ? BLACK : cell === "W" ? WHITE : null))),
  });
}

function emptyRows(width, height) {
  return Array.from({ length: height }, () => ".".repeat(width));
}

function place(rows, cells, char) {
  const grid = rows.map((line) => [...line]);
  for (const [row, col] of cells) grid[row][col] = char;
  return grid.map((line) => line.join(""));
}

test("a five on the very last empty point wins; it is not a draw", () => {
  const game = position([
    "WWBWBWBWBWB",
    "WBWBWWBWBWB",
    "WBWWBBBWBBW",
    "BWBBBWWBWWB",
    "WBWWBBBWBWB",
    "WBWBWWWWBWB",
    "BWBWBWBBWBW",
    "BWBWBWBWBWW",
    "WBWBWBWBB.B",
    "WBWBWBWBWWB",
    "BWWBBWBWBWB",
  ]);
  const result = game.play(8, 9);
  assert.equal(result.ok, true);
  assert.equal(game.phase, "finished");
  assert.equal(game.result.winner, BLACK);
  assert.equal(game.result.reason, "five");
  assert.ok(game.board.every((row) => row.every(Boolean)), "the board is full");
  // Everything about the finished game is closed.
  assert.equal(game.canUndo(), false);
  assert.deepEqual(game.legalMoves(), []);
  assert.equal(game.play(0, 0).ok, false);
});

test("Renju: Black left with only forbidden points draws, right after White's move", () => {
  const game = position([
    "WBWBWBWBWBB",
    "WBWBWWBWBWB",
    "BBBWBBBWBWW",
    "BWWBWW.WWBW",
    "BWBWBBB.BBW",
    "BWWBBWBWWWB",
    "WBBWBWBWB.B",
    "BWWBBWWWBWW",
    "WBWBWBB.BBB",
    "WBWWWWBWWWB",
    "BWWBBBWWBWB",
  ], { ruleSet: "renju", toMove: WHITE });
  assert.equal(game.play(6, 9).ok, true);
  assert.equal(game.phase, "finished");
  assert.deepEqual(game.result, { winner: "draw", reason: "no_legal_moves", margin: 0 });
  // Three empty points are left, and the reference forbids each for Black.
  const reference = createRenjuReference({ width: 11, height: 11, topology: "cylinder" });
  const rows = toReferenceBoard(game.board);
  const empties = [];
  game.board.forEach((line, row) => line.forEach((stone, col) => { if (!stone) empties.push([row, col]); }));
  assert.equal(empties.length, 3);
  for (const [row, col] of empties) assert.notEqual(reference.verdict(rows, row, col), null, `${row},${col}`);
});

test("Renju: a board filled without a five is a draw", () => {
  const game = position([
    "WWWBBWBWWBB",
    "WBBWWBBWBWW",
    "BWWBBWWWWBB",
    "WBBWWBBBWWW",
    "BWWBWBWWBWB",
    "WWBBWBBWBW.",
    "BBBWWWBBWBW",
    "BWWBBBWBWBW",
    "BBBWWBWBWBW",
    "WBWBBWBBBWB",
    "WBBWWWBWBWB",
  ], { ruleSet: "renju" });
  assert.equal(game.play(5, 10).ok, true);
  assert.deepEqual(game.result, { winner: "draw", reason: "board_full", margin: 0 });
});

test("Renju: Black's overline on the last point is refused; White's wins", () => {
  // Row 0: B B B . B B (11 wide, the rest white-free) - Black at (0,3) makes six.
  let rows = emptyRows(11, 11);
  rows = place(rows, [[0, 0], [0, 1], [0, 2], [0, 4], [0, 5]], "B");
  rows = place(rows, [[5, 5], [6, 6], [7, 7], [8, 8], [9, 1]], "W");
  const black = position(rows, { ruleSet: "renju" });
  assert.deepEqual(black.checkPlay(0, 3), { ok: false, reason: "forbidden", forbidden: "overline" });
  // In freestyle the same move wins with six.
  const freestyle = position(rows);
  assert.equal(freestyle.play(0, 3).ok, true);
  assert.equal(freestyle.result.winner, BLACK);
  assert.equal(freestyle.result.length, 6);
  // White's six wins under Renju.
  const swapped = rows.map((line) => line.replace(/B/gu, "x").replace(/W/gu, "B").replace(/x/gu, "W"));
  const white = position(swapped, { ruleSet: "renju", toMove: WHITE });
  assert.equal(white.play(0, 3).ok, true);
  assert.equal(white.result.winner, WHITE);
  assert.equal(white.result.length, 6);
});

test("corner fives: across the cylinder seam, the torus corner and the Mobius twist", () => {
  // Cylinder: a "\" diagonal from the top edge crosses the column seam.
  const cylinder = position(place(emptyRows(11, 11), [[0, 9], [1, 10], [2, 0], [3, 1]], "B"));
  assert.equal(cylinder.play(4, 2).ok, true);
  assert.equal(cylinder.result?.winner, BLACK);
  assert.deepEqual(cylinder.result.line, [
    { row: 0, col: 9 }, { row: 1, col: 10 }, { row: 2, col: 0 }, { row: 3, col: 1 }, { row: 4, col: 2 },
  ]);
  // On a cylinder the top edge stops a column: no five over it.
  const edge = position(place(emptyRows(11, 11), [[0, 3], [1, 3], [9, 3], [10, 3]], "B"));
  assert.equal(edge.play(2, 3).ok, true);
  assert.equal(edge.phase, "play");
  // The same column on a torus wraps from the bottom row to the top.
  const torus = position(place(emptyRows(11, 11), [[0, 3], [1, 3], [9, 3], [10, 3]], "B"), { topology: "torus" });
  assert.equal(torus.play(2, 3).ok, true);
  assert.equal(torus.result?.winner, BLACK);
  // Torus corner: the main diagonal runs (9,9) (10,10) (0,0) (1,1) (2,2).
  const corner = position(place(emptyRows(11, 11), [[9, 9], [10, 10], [1, 1], [2, 2]], "B"), { topology: "torus" });
  assert.equal(corner.play(0, 0).ok, true);
  assert.equal(corner.result?.winner, BLACK);
  // Mobius: the bottom row leaves at the right edge and comes back on the top row.
  const mobius = position(place(emptyRows(11, 11), [[10, 8], [10, 9], [10, 10], [0, 1]], "B"), { topology: "mobius" });
  assert.equal(mobius.play(0, 0).ok, true);
  assert.equal(mobius.result?.winner, BLACK);
  // On a cylinder the same stones are not a row.
  const notRow = position(place(emptyRows(11, 11), [[10, 8], [10, 9], [10, 10], [0, 1]], "B"));
  assert.equal(notRow.play(0, 0).ok, true);
  assert.equal(notRow.phase, "play");
});

test("an online Renju room refuses Black's forbidden point and keeps the turn", () => {
  let now = 1_000;
  const room = RoomEngine.create({
    code: "RNJ234", name: "Host", gameType: "gomoku", ruleSet: "renju", width: 15, height: 15, topology: "cylinder",
    mainTimeSeconds: 0, playerId: "host", tokenHash: "a".repeat(64), startImmediately: false, now,
  });
  room.join({ name: "Guest", role: "player", playerId: "guest", tokenHash: "b".repeat(64), now });
  const act = (playerId, action, payload = {}) => room.applyAction({ playerId, action, payload, now: (now += 1_000) });
  const invited = act("host", "request_game", { mode: "friend", gameType: "gomoku", ruleSet: "renju", width: 15, height: 15 }).room;
  act("guest", "respond_game", { accept: true, requestRevision: invited.match.request.requestRevision, gameType: "gomoku" });
  // Black builds two open twos crossing at (7,7): a double three there.
  const moves = [[7, 5], [0, 0], [7, 6], [0, 14], [5, 7], [14, 0], [6, 7], [14, 14]];
  moves.forEach(([row, col], index) => act(index % 2 === 0 ? "host" : "guest", "play", { row, col, gameType: "gomoku" }));
  assert.throws(
    () => act("host", "play", { row: 7, col: 7, gameType: "gomoku" }),
    (error) => error.code === "ILLEGAL_MOVE" && /三三/u.test(error.message),
  );
  // Still Black to move: a legal point is accepted.
  const after = act("host", "play", { row: 10, col: 10, gameType: "gomoku" }).room;
  assert.equal(after.game.board[7][7], null);
  assert.equal(after.game.currentPlayer, WHITE);
});

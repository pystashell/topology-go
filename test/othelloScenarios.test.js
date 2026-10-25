import assert from "node:assert/strict";
import test from "node:test";

import { GAME_MOVE_ERRORS } from "../src/game/gameTypes.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";
import { gameMoveMessage, skippedTurnText } from "../src/ui/gameUi.js";

/*
 * Readable Othello cases: what happens when a side cannot outflank anything,
 * and how flips run across each board's seams. Boards are rows of B, W and
 * "." (row 0 at the top). The skip, blocked and wipeout positions come from
 * real random games on a 6x6 cylinder.
 */

const BLACK = "black";
const WHITE = "white";

function position(rows, { topology = "cylinder", toMove = BLACK } = {}) {
  return new OthelloEngine({
    width: rows[0].length,
    height: rows.length,
    topology,
    initialBoard: rows.map((line) =>
      [...line].map((cell) => (cell === "B" ? BLACK : cell === "W" ? WHITE : null))),
    currentPlayer: toMove,
  });
}

function draw(game) {
  return game.board.map((row) => row.map((value) => (value === BLACK ? "B" : value === WHITE ? "W" : ".")).join(""));
}

/** Whether `color` has a legal move here, whoever is to move. */
function canMove(game, color) {
  return OthelloEngine.fromPublicState({ ...game.getState(), phase: "play", currentPlayer: color })
    .legalMoves().length > 0;
}

const flippedCells = (result) => result.flipped.map(({ row, col }) => `${row},${col}`).sort();

test("a side that cannot outflank anything is skipped and the other side moves again", () => {
  const game = position([
    "WWWWWW",
    "BWBWBW",
    "WWWBBB",
    "BBBBBB",
    "BBBB.B",
    "W.W...",
  ], { toMove: WHITE });
  const result = game.play(4, 4);
  assert.equal(result.ok, true);
  // Black still has discs, but none of its moves would outflank a white disc.
  assert.equal(game.discs.black > 0, true);
  assert.equal(canMove(game, BLACK), false);
  assert.equal(result.skipped, BLACK);
  assert.equal(game.currentPlayer, WHITE);
  assert.equal(game.phase, "play");
  assert.equal(game.lastMove.skipped, BLACK);
  // Black cannot play out of turn: play() always moves for the side to move.
  assert.equal(game.legalMoves().every(({ row, col }) => game.board[row][col] === null), true);
  // The page says so.
  assert.equal(skippedTurnText(BLACK), "黑方无子可下，白方继续");
  assert.match(gameMoveMessage(result, { gameType: "othello" }), /黑方无子可下，白方继续/u);
  // Undo gives the skipped turn back exactly as it was.
  assert.equal(game.undo().ok, true);
  assert.equal(game.currentPlayer, WHITE);
  assert.deepEqual(draw(game), ["WWWWWW", "BWBWBW", "WWWBBB", "BBBBBB", "BBBB.B", "W.W..."]);
});

test("a side can be skipped several times in a row", () => {
  const game = position([
    "WWWWWW",
    "BBBWWB",
    "BBBWB.",
    "BBBWBB",
    "BBBWBB",
    "BWWWB.",
  ], { toMove: WHITE });
  const result = game.play(5, 5);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, BLACK);
  assert.equal(game.currentPlayer, WHITE, "White moves again");
  assert.equal(canMove(game, BLACK), false);
});

test("the game ends when neither side can move, even with empty points left", () => {
  const game = position([
    "BBBBWB",
    "BBBBBW",
    "BBBWBB",
    "BWWW.B",
    "BBWWBB",
    ".WWWWW",
  ]);
  const result = game.play(3, 4);
  assert.equal(result.ok, true);
  assert.equal(game.phase, "finished");
  assert.equal(game.board[5][0], null, "one point is still empty");
  assert.equal(canMove(game, BLACK), false);
  assert.equal(canMove(game, WHITE), false);
  assert.deepEqual(game.result, {
    winner: BLACK, loser: WHITE, reason: "discs", black: 26, white: 9, margin: 17,
  });
  assert.equal(game.canUndo(), false);
});

test("taking a side's last disc ends the game", () => {
  const game = position([
    "....BB",
    "BWWBBB",
    "BWBWBB",
    ".WBBW.",
    "BBB..W",
    "BB....",
  ]);
  const result = game.play(0, 1);
  assert.equal(result.ok, true);
  assert.equal(game.discs.white, 0);
  assert.equal(game.phase, "finished");
  assert.deepEqual(game.result, {
    winner: BLACK, loser: WHITE, reason: "discs", black: 25, white: 0, margin: 25,
  });
});

test("a point that outflanks nothing is refused and changes nothing", () => {
  const game = position(["......", "......", "..WB..", "..BW..", "......", "......"]);
  assert.deepEqual(game.play(0, 0), { ok: false, reason: GAME_MOVE_ERRORS.NO_FLIPS });
  assert.deepEqual(game.play(2, 2), { ok: false, reason: "occupied" });
  assert.equal(game.currentPlayer, BLACK);
  assert.deepEqual(draw(game), ["......", "......", "..WB..", "..BW..", "......", "......"]);
});

test("left and right: a row wraps on the cylinder and torus, and turns over on the Mobius strip", () => {
  // Black plays at the left edge (1, 0); a white disc sits at the right edge.
  const rows = [
    "......",
    ".....W",
    "......",
    "......",
    "....BW",
    "....B.",
  ];
  // Cylinder and torus: going left from (1,0) reaches (1,5), White, then
  // (1,4), empty: nothing. Add Black at (1,4) and (1,5) flips.
  for (const topology of ["cylinder", "torus"]) {
    assert.equal(position(rows, { topology }).checkPlay(1, 0).ok, false, topology);
    const bracketed = position(["......", "....BW", "......", "......", "......", "......"], { topology });
    assert.deepEqual(flippedCells(bracketed.play(1, 0)), ["1,5"], topology);
  }
  // Mobius: leaving at the left edge comes back at the right edge on the
  // mirrored row (row 1 -> row 4), so (4,5) White then (4,4) Black flips.
  assert.deepEqual(flippedCells(position(rows, { topology: "mobius" }).play(1, 0)), ["4,5"]);
});

test("up and down: only the torus wraps; the cylinder and Mobius strip have edges", () => {
  const rows = [
    "......",
    "......",
    "......",
    "......",
    ".B....",
    ".W....",
  ];
  // Black plays (0,1). Going up wraps to (5,1) White, then (4,1) Black.
  assert.deepEqual(flippedCells(position(rows, { topology: "torus" }).play(0, 1)), ["5,1"]);
  for (const topology of ["cylinder", "mobius"]) {
    assert.deepEqual(position(rows, { topology }).play(0, 1), { ok: false, reason: GAME_MOVE_ERRORS.NO_FLIPS }, topology);
  }
});

test("diagonals across seams: the torus corner, and the Mobius twist that mirrors a diagonal", () => {
  // Torus: from (0,0) up-left wraps to (5,5) White, then (4,4) Black.
  const corner = ["......", "......", "......", "......", "....B.", ".....W"];
  assert.deepEqual(flippedCells(position(corner, { topology: "torus" }).play(0, 0)), ["5,5"]);
  assert.equal(position(corner, { topology: "cylinder" }).checkPlay(0, 0).ok, false);

  // Mobius: from (1,5) down-right crosses the seam onto the turned-over
  // strip, so on the board it continues up-right: (3,0) White, (2,1) Black.
  const twist = ["......", "......", ".B....", "W.....", "......", "......"];
  assert.deepEqual(flippedCells(position(twist, { topology: "mobius" }).play(1, 5)), ["3,0"]);
  // On a cylinder the same diagonal goes on down to (2,0), which is empty.
  assert.equal(position(twist, { topology: "cylinder" }).checkPlay(1, 5).ok, false);
});

test("a whole loop of opponent discs back to the new disc flips nothing", () => {
  // Torus row 2 and column 0 are all White apart from (2,0): every wrapped
  // line from (2,0) comes back to (2,0) without meeting Black.
  const loop = ["W.....", "W.....", ".WWWWW", "W.....", "W.....", "W....."];
  assert.equal(position(loop, { topology: "torus" }).checkPlay(2, 0).ok, false);
  // One black disc in the row brackets the discs on both sides of the seam.
  const bracketed = ["......", "......", ".WWBWW", "......", "......", "......"];
  for (const topology of ["cylinder", "torus"]) {
    assert.deepEqual(flippedCells(position(bracketed, { topology }).play(2, 0)), ["2,1", "2,2", "2,4", "2,5"], topology);
  }
});

test("discs reached through two seams in one move flip once", () => {
  // Torus: from (0,0) going left wraps to (0,5) then (0,4); going up wraps
  // to (5,0) then (4,0); going up-left reaches (5,5) then (4,4).
  const rows = ["....BW", "......", "......", "......", "B...B.", "W....W"];
  const result = position(rows, { topology: "torus" }).play(0, 0);
  assert.deepEqual(flippedCells(result), ["0,5", "5,0", "5,5"]);
  assert.equal(new Set(flippedCells(result)).size, result.flipped.length);
});

// The real game the skip position above comes from: Black is skipped after
// White's 28th move.
const SKIP_GAME = [
  [1, 2], [1, 1], [2, 1], [1, 3], [2, 4], [4, 2], [0, 1], [2, 0], [0, 3], [0, 2],
  [4, 3], [1, 4], [2, 5], [1, 5], [4, 1], [5, 0], [0, 5], [3, 5], [4, 0], [3, 0],
  [0, 0], [5, 2], [4, 5], [0, 4], [1, 0], [3, 1], [3, 4], [4, 4],
];

test("an online room skips the side without a move: turn, clock and undo", () => {
  let now = 1_000;
  const room = RoomEngine.create({
    code: "THX234", name: "Host", gameType: "othello", width: 6, height: 6, topology: "cylinder",
    mainTimeSeconds: 600, playerId: "host", tokenHash: "a".repeat(64), startImmediately: false, now,
  });
  room.join({ name: "Guest", role: "player", playerId: "guest", tokenHash: "b".repeat(64), now });
  const act = (playerId, action, payload = {}) => room.applyAction({ playerId, action, payload, now: (now += 1_000) });
  const invited = act("host", "request_game", { mode: "friend", gameType: "othello", width: 6, height: 6, mainTimeSeconds: 600 }).room;
  act("guest", "respond_game", { accept: true, requestRevision: invited.match.request.requestRevision, gameType: "othello" });

  let snapshot;
  for (const [index, [row, col]] of SKIP_GAME.entries()) {
    snapshot = act(index % 2 === 0 ? "host" : "guest", "play", { row, col, gameType: "othello" }).room;
  }
  assert.equal(snapshot.game.lastMove.skipped, BLACK);
  assert.equal(snapshot.game.currentPlayer, WHITE, "White moves again");
  assert.equal(snapshot.moveCount, 28);
  assert.equal(snapshot.timeControl.activeColor, WHITE, "White's clock keeps running");
  // Black cannot move out of turn.
  assert.throws(() => act("host", "play", { row: 5, col: 1, gameType: "othello" }), { code: "NOT_YOUR_TURN" });

  // Black asks to take back its own latest move: that is two plays back
  // (its move 27 and White's 28th), and the turn returns to Black.
  const undoRequest = act("host", "request_undo", { expectedMoveCount: 28 }).room.undoRequest;
  const accepted = act("guest", "respond_undo", {
    accept: true, targetMoveCount: undoRequest.targetMoveCount, requestRevision: undoRequest.requestRevision,
  });
  assert.equal(accepted.move.undoneCount, 2);
  assert.equal(accepted.room.moveCount, 26);
  assert.equal(accepted.room.game.currentPlayer, BLACK);
  assert.equal(accepted.room.game.lastMove.skipped, null);
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
});

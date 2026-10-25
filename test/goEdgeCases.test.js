import assert from "node:assert/strict";
import test from "node:test";

import { GoEngine } from "../src/game/goEngine.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";
import { neighbours4 } from "./helpers/coverGeometry.js";
import { GoReference } from "./helpers/goReference.js";

/*
 * Go at the edges of its rules: ko at corners and across every seam,
 * positional superko over long cycles (not just the simple ko), passes and
 * scoring that must not forget the history, the last empty points of a
 * board, undo and persistence of the history, and the same refusals through
 * an online room. Ko shapes are built from the reference geometry
 * (test/helpers/coverGeometry.js), not from the engine's neighbours.
 */

const BLACK = "black";
const WHITE = "white";

function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

/**
 * A ko on any topology: White's stone at `a` has its last liberty at `k`;
 * Black taking at k leaves Black's stone with its last liberty at a.
 */
function koPosition({ topology, width = 7, height = 7, k, a }) {
  const board = emptyBoard(width, height);
  const around = (cell) => neighbours4(topology, width, height, cell.row, cell.col);
  board[a.row][a.col] = WHITE;
  for (const cell of around(a)) {
    if (cell.row !== k.row || cell.col !== k.col) board[cell.row][cell.col] = BLACK;
  }
  for (const cell of around(k)) {
    if (cell.row !== a.row || cell.col !== a.col) board[cell.row][cell.col] = WHITE;
  }
  return new GoEngine({ width, height, topology, initialBoard: board, currentPlayer: BLACK });
}

/** A far empty point that captures nothing, for ko threats. */
function quietPoint(game, color, avoid = []) {
  for (let row = 0; row < game.height; row += 1) {
    for (let col = 0; col < game.width; col += 1) {
      if (avoid.some((cell) => cell.row === row && cell.col === col)) continue;
      if (game.board[row][col] !== null) continue;
      const neighbours = game.neighbors(row, col);
      if (neighbours.every((cell) => game.board[cell.row][cell.col] === null) && game.checkPlay(row, col).ok) {
        return { row, col };
      }
    }
  }
  throw new Error(`no quiet point for ${color}`);
}

const KOS = [
  { name: "cylinder: at the top edge, across the column seam", topology: "cylinder", k: { row: 0, col: 0 }, a: { row: 0, col: 6 } },
  { name: "cylinder: in the middle", topology: "cylinder", k: { row: 3, col: 3 }, a: { row: 3, col: 4 } },
  { name: "torus: across the top and bottom seam", topology: "torus", k: { row: 0, col: 3 }, a: { row: 6, col: 3 } },
  { name: "torus: at the corner where both seams meet", topology: "torus", k: { row: 0, col: 0 }, a: { row: 0, col: 6 } },
  { name: "Mobius: across the twisted seam (row 1 meets row 5)", topology: "mobius", k: { row: 1, col: 0 }, a: { row: 5, col: 6 } },
  { name: "Mobius: at the bottom corner of the twisted seam", topology: "mobius", k: { row: 6, col: 0 }, a: { row: 0, col: 6 } },
];

for (const { name, topology, k, a } of KOS) {
  test(`ko ${name}: no immediate retake, retake after a threat`, () => {
    const game = koPosition({ topology, k, a });
    // The shape really is a ko: one stone each way.
    const take = game.play(k.row, k.col);
    assert.equal(take.ok, true);
    assert.deepEqual(take.captured, [a]);
    assert.deepEqual(game.play(a.row, a.col), { ok: false, reason: "superko" });
    assert.deepEqual(game.checkPlay(a.row, a.col), { ok: false, reason: "superko" });
    // A threat elsewhere and its answer change the board: the retake is legal.
    const threat = quietPoint(game, WHITE, [k, a]);
    assert.equal(game.play(threat.row, threat.col).ok, true);
    const answer = quietPoint(game, BLACK, [k, a]);
    assert.equal(game.play(answer.row, answer.col).ok, true);
    const retake = game.play(a.row, a.col);
    assert.equal(retake.ok, true);
    assert.deepEqual(retake.captured, [k]);
    // Now Black may not retake at once.
    assert.deepEqual(game.play(k.row, k.col), { ok: false, reason: "superko" });
  });
}

test("positional superko refuses a long cycle that the simple ko rule would allow", () => {
  // Found by the soak test on a 3x3 cylinder: after these seven moves White's
  // play at (2,0) would recreate a position from four moves back, not the
  // position before Black's last move.
  const game = new GoEngine({ width: 3, height: 3, topology: "cylinder" });
  const moves = [3, 6, 8, 5, 4, 7, 8].map((index) => ({ row: Math.floor(index / 3), col: index % 3 }));
  const positions = [JSON.stringify(game.board)];
  for (const { row, col } of moves) {
    assert.equal(game.play(row, col).ok, true);
    positions.push(JSON.stringify(game.board));
  }
  assert.deepEqual(game.board, [[null, null, null], [BLACK, BLACK, WHITE], [null, null, BLACK]]);
  assert.equal(game.currentPlayer, WHITE);
  // What White's move would make, worked out by the reference.
  const reference = new GoReference({ width: 3, height: 3, topology: "cylinder" });
  for (const index of [3, 6, 8, 5, 4, 7, 8]) assert.equal(reference.play(index).ok, true);
  const attempt = reference.attempt(6);
  assert.equal(attempt.reason, "superko");
  const after = Array.from({ length: 3 }, (_, row) =>
    [...attempt.key.slice(row * 3, row * 3 + 3)].map((value) => (value === "B" ? BLACK : value === "W" ? WHITE : null)));
  const repeated = positions.indexOf(JSON.stringify(after));
  assert.ok(repeated >= 0 && repeated < positions.length - 2, "an older position, not a simple ko");
  assert.deepEqual(game.play(2, 0), { ok: false, reason: "superko" });
  // Nothing changed.
  assert.equal(JSON.stringify(game.board), positions.at(-1));
  assert.equal(game.currentPlayer, WHITE);
});

test("passes, scoring and resuming play keep the superko history", () => {
  const game = koPosition({ topology: "cylinder", k: { row: 3, col: 3 }, a: { row: 3, col: 4 } });
  assert.equal(game.play(3, 3).ok, true);
  const history = game.positionHistory.size;
  assert.equal(game.pass().ok, true);
  assert.equal(game.positionHistory.size, history, "a pass adds no position");
  assert.equal(game.pass().ok, true);
  assert.equal(game.phase, "scoring");
  assert.equal(game.resumePlay(WHITE).ok, true);
  // The retake would still recreate the position before Black's capture.
  assert.deepEqual(game.play(3, 4), { ok: false, reason: "superko" });
});

test("undo, persistence and restore keep superko exact", () => {
  const game = koPosition({ topology: "torus", k: { row: 0, col: 3 }, a: { row: 6, col: 3 } });
  assert.equal(game.play(0, 3).ok, true);
  // Restored from JSON: the retake is still refused.
  const restored = GoEngine.fromState(game.serialize());
  assert.deepEqual(restored.play(6, 3), { ok: false, reason: "superko" });
  // Undo the capture: the capture is legal again and the history shrinks.
  const size = game.positionHistory.size;
  assert.equal(game.undo().ok, true);
  assert.equal(game.positionHistory.size, size - 1);
  assert.equal(game.board[6][3], WHITE);
  assert.equal(game.play(0, 3).ok, true);
  // A search copy (the AI) refuses the retake too.
  assert.deepEqual(GoEngine.fromSearchState(game.exportSearchState()).checkPlay(6, 3), { ok: false, reason: "superko" });
});

test("the last empty points: a capture is legal, a suicide is not, and the game ends in passes", () => {
  // 3x3 cylinder, one empty point at (1,1). White fills everything but it.
  const full = [
    [WHITE, WHITE, WHITE],
    [WHITE, null, WHITE],
    [WHITE, WHITE, WHITE],
  ];
  // Black's last point captures all eight white stones (they have one liberty).
  const capture = new GoEngine({ width: 3, height: 3, topology: "cylinder", initialBoard: full, currentPlayer: BLACK });
  const result = capture.play(1, 1);
  assert.equal(result.ok, true);
  assert.equal(result.captured.length, 8);
  assert.equal(capture.captures.black, 8);
  // White to move on an almost empty board.
  assert.equal(capture.board.flat().filter(Boolean).length, 1);

  // White's own last point is suicide: White must pass.
  const suicide = new GoEngine({ width: 3, height: 3, topology: "cylinder", initialBoard: full, currentPlayer: WHITE });
  assert.deepEqual(suicide.play(1, 1), { ok: false, reason: "suicide" });
  assert.equal(suicide.pass().ok, true);
  // Black's capture still works after White's pass.
  assert.equal(suicide.play(1, 1).ok, true);

  // A board with no legal point for the side to move: both pass and count.
  const stuck = new GoEngine({ width: 3, height: 3, topology: "torus", initialBoard: full, currentPlayer: WHITE, komi: 0.5 });
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (!stuck.board[row][col]) assert.equal(stuck.checkPlay(row, col).ok, false);
    }
  }
  assert.equal(stuck.pass().ok, true);
  // Black passes too rather than capture. White's group has a single eye
  // that White cannot fill and Black can: the count marks it dead.
  assert.equal(stuck.pass().ok, true);
  assert.equal(stuck.phase, "scoring");
  assert.equal(stuck.deadStones.size, 8);
  const score = stuck.score("chinese");
  assert.deepEqual([score.black, score.white, score.neutral], [0, 0.5, 9]);
  // Japanese counting gives Black the eight prisoners.
  assert.equal(stuck.score("japanese").black, 8);
});

test("suicide at a corner and of several stones, but a capture first is never suicide", () => {
  // Cylinder 5x5: the top row is an edge.
  const board = emptyBoard(5, 5);
  board[0][1] = WHITE;
  board[1][0] = WHITE;
  board[0][4] = WHITE; // across the seam from (0,0)
  // Black at (0,0) has no liberty: suicide.
  const corner = new GoEngine({ width: 5, height: 5, topology: "cylinder", initialBoard: board });
  assert.deepEqual(corner.play(0, 0), { ok: false, reason: "suicide" });
  // Two black stones with one shared liberty: filling it is a group suicide.
  const pair = emptyBoard(5, 5);
  pair[2][1] = BLACK;
  pair[2][2] = null;
  for (const [row, col] of [[1, 1], [3, 1], [2, 0], [1, 2], [3, 2], [2, 3]]) pair[row][col] = WHITE;
  const group = new GoEngine({ width: 5, height: 5, topology: "cylinder", initialBoard: pair });
  assert.deepEqual(group.play(2, 2), { ok: false, reason: "suicide" });
  assert.equal(group.board[2][1], BLACK, "a refused move changes nothing");
  // Same shape, but the white wall has one liberty left at (2,2)'s side:
  // Black's move captures (2,3) first, so it is legal.
  pair[2][4] = BLACK;
  pair[1][3] = BLACK;
  pair[3][3] = BLACK;
  const captureFirst = new GoEngine({ width: 5, height: 5, topology: "cylinder", initialBoard: pair });
  const result = captureFirst.play(2, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [{ row: 2, col: 3 }]);
});

test("an online Go room refuses a ko retake and keeps the position", () => {
  let now = 1_000;
  const room = RoomEngine.create({
    code: "KQX234", name: "Host", gameType: "go", width: 9, height: 9, topology: "cylinder",
    mainTimeSeconds: 0, playerId: "host", tokenHash: "a".repeat(64), startImmediately: false, now,
  });
  room.join({ name: "Guest", role: "player", playerId: "guest", tokenHash: "b".repeat(64), now });
  const act = (playerId, action, payload = {}) => room.applyAction({ playerId, action, payload, now: (now += 1_000) });
  const invited = act("host", "request_game", { mode: "friend", width: 9, height: 9 }).room;
  act("guest", "respond_game", { accept: true, requestRevision: invited.match.request.requestRevision });
  // Build the ko shape around (4,4)/(4,5) with alternating moves.
  const sequence = [
    ["host", 3, 5], ["guest", 3, 4], ["host", 5, 5], ["guest", 5, 4],
    ["host", 4, 6], ["guest", 4, 3], ["host", 0, 0], ["guest", 4, 5],
  ];
  for (const [player, row, col] of sequence) act(player, "play", { row, col });
  // Black takes the ko at (4,4), capturing (4,5).
  const taken = act("host", "play", { row: 4, col: 4 }).room;
  assert.equal(taken.game.board[4][5], null);
  assert.throws(() => act("guest", "play", { row: 4, col: 5 }), { code: "ILLEGAL_MOVE" });
  // The refusal changed nothing: still White to play, the ko still taken.
  const threat = act("guest", "play", { row: 8, col: 8 }).room;
  assert.equal(threat.game.board[4][4], "black");
  assert.equal(threat.game.board[4][5], null);
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
  // A threat and an answer, then the retake is accepted.
  act("host", "play", { row: 0, col: 8 });
  const retaken = act("guest", "play", { row: 4, col: 5 }).room;
  assert.equal(retaken.game.board[4][4], null);
});

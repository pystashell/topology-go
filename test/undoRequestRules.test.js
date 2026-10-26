import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine } from "../src/multiplayer/roomEngine.js";

/*
 * The owner's undo rules (2026-10-26): a pending undo request never holds
 * up the game. The clock keeps running for whoever is to move; a move by
 * either side ends the request (the requester's own move withdraws it, the
 * opponent's declines it); the requester can also cancel it. Because the
 * clock already limits waiting, the number of requests is not limited.
 */

const T = 1_800_000_000_000;

function friendGame(clock = {}) {
  const room = RoomEngine.create({
    code: "UND234", name: "Black", size: 9, playerId: "black", tokenHash: "a".repeat(64), now: T, ...clock,
  });
  room.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now: T });
  return room;
}

const act = (room, playerId, action, payload = {}, now = T) =>
  room.applyAction({ playerId, action, payload, now });

test("the requester playing on withdraws their own undo request", () => {
  const room = friendGame();
  act(room, "black", "play", { row: 2, col: 2 }, T + 100);
  act(room, "white", "play", { row: 6, col: 6 }, T + 200);
  // Black, on move, asks to take back their move and White's reply.
  act(room, "black", "request_undo", { expectedMoveCount: 2 }, T + 300);
  assert.ok(room.state.undoRequest);
  const played = act(room, "black", "play", { row: 4, col: 4 }, T + 400);
  assert.equal(played.move.undoRequestAutoCancelled, true);
  assert.equal(played.move.undoRequestAutoDeclined, undefined);
  assert.equal(played.room.undoRequest, null);
  assert.equal(played.room.moveCount, 3, "the move counts; nothing was taken back");
  assert.equal(played.room.game.board[2][2], "black");
  assert.equal(played.room.game.board[6][6], "white");

  // A pass by the requester withdraws it too.
  act(room, "white", "play", { row: 0, col: 0 }, T + 500);
  act(room, "black", "request_undo", { expectedMoveCount: 4 }, T + 600);
  const passed = act(room, "black", "pass", {}, T + 700);
  assert.equal(passed.move.undoRequestAutoCancelled, true);
  assert.equal(passed.room.undoRequest, null);
});

test("an illegal move by the requester leaves the request waiting", () => {
  const room = friendGame();
  act(room, "black", "play", { row: 2, col: 2 }, T + 100);
  act(room, "white", "play", { row: 6, col: 6 }, T + 200);
  act(room, "black", "request_undo", { expectedMoveCount: 2 }, T + 300);
  assert.throws(() => act(room, "black", "play", { row: 2, col: 2 }, T + 400));
  assert.ok(room.state.undoRequest, "still pending");
  // It can still be cancelled explicitly.
  const request = room.state.undoRequest;
  const cancelled = act(room, "black", "cancel_undo", {
    targetMoveCount: request.targetMoveCount, requestRevision: request.requestRevision,
  }, T + 500);
  assert.equal(cancelled.move.type, "undo_cancelled");
  assert.equal(room.state.undoRequest, null);
});

test("the clock keeps running while an undo request waits, up to a timeout", () => {
  const room = friendGame({ mainTimeSeconds: 60, byoYomiPeriods: 0, byoYomiSeconds: 0 });
  act(room, "black", "play", { row: 2, col: 2 }, T + 1_000);
  // White is on move; Black asks for an undo and White never answers.
  act(room, "black", "request_undo", { expectedMoveCount: 1 }, T + 2_000);
  assert.equal(room.state.timeControl.activeColor, "white", "White's clock runs");
  room.advance(T + 1_000 + 61_000);
  assert.equal(room.state.timeControl.outcome?.winner, "black", "White ran out of time waiting");
  assert.equal(room.state.timeControl.outcome?.loser, "white");
});

test("undo requests are not limited in number", () => {
  const room = friendGame();
  act(room, "black", "play", { row: 2, col: 2 }, T + 100);
  for (let round = 0; round < 8; round += 1) {
    const requested = act(room, "black", "request_undo", { expectedMoveCount: 1 }, T + 200 + round * 10);
    const declined = act(room, "white", "respond_undo", {
      accept: false,
      targetMoveCount: requested.move.undoRequest.targetMoveCount,
      requestRevision: requested.move.undoRequest.requestRevision,
    }, T + 205 + round * 10);
    assert.equal(declined.move.type, "undo_declined", `round ${round}`);
  }
  // One request at a time.
  act(room, "black", "request_undo", { expectedMoveCount: 1 }, T + 400);
  assert.throws(() => act(room, "black", "request_undo", { expectedMoveCount: 1 }, T + 410),
    (error) => error.code === "UNDO_PENDING");
});

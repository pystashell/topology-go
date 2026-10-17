import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine, RoomEngineError } from "../src/multiplayer/roomEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";

function timedRoom() {
  const room = RoomEngine.create({
    code: "UND234", name: "Black", size: 9, mainTimeSeconds: 60,
    playerId: "black", tokenHash: "a".repeat(64), now: 1_000,
  });
  room.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now: 1_000 });
  return room;
}

function request(room, playerId, now) {
  return room.applyAction({
    playerId, action: "request_undo",
    payload: { expectedMoveCount: room.state.moveCount }, now,
  }).room.undoRequest;
}

function accept(room, playerId, undoRequest, now) {
  return room.applyAction({
    playerId, action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: undoRequest.targetMoveCount,
      requestRevision: undoRequest.requestRevision,
    },
    now,
  });
}

test("an undo requested on the requester's own turn also takes back the reply", () => {
  const room = timedRoom();
  room.applyAction({ playerId: "black", action: "play", payload: { row: 2, col: 2 }, now: 2_000 });
  room.applyAction({ playerId: "white", action: "play", payload: { row: 6, col: 6 }, now: 5_000 });
  const before = room.snapshot(5_000);
  assert.equal(before.game.currentPlayer, "black");

  const undoRequest = request(room, "black", 6_000);
  const accepted = accept(room, "white", undoRequest, 7_000);
  assert.equal(accepted.move.undoneCount, 2);
  assert.deepEqual(accepted.move.undoneMoves.map(({ color }) => color), ["white", "black"]);
  const after = accepted.room;
  assert.equal(after.moveCount, 0);
  assert.equal(after.game.board[2][2], null);
  assert.equal(after.game.board[6][6], null);
  assert.equal(after.game.currentPlayer, "black");
  assert.equal(after.replay.events.length, 0);
  assert.notEqual(after.positionToken, before.positionToken);
  // Black's clock ran from 5 s to the acceptance at 7 s, then restarts.
  assert.equal(after.timeControl.activeColor, "black");
  assert.equal(after.timeControl.players.black.mainTimeRemainingMs, 60_000 - 1_000 - 2_000);
  assert.equal(after.timeControl.players.white.mainTimeRemainingMs, 60_000 - 3_000);

  // The stored room restores to the same consistent position.
  const restored = RoomEngine.restore(room.serialize()).snapshot(7_000);
  assert.equal(restored.positionToken, after.positionToken);
  assert.equal(buildReplayFrames(restored.replay).steps.length, 0);
});

test("an undo requested on the opponent's turn takes back only the requester's move", () => {
  const room = timedRoom();
  room.applyAction({ playerId: "black", action: "play", payload: { row: 2, col: 2 }, now: 2_000 });
  room.applyAction({ playerId: "white", action: "play", payload: { row: 6, col: 6 }, now: 3_000 });
  const undoRequest = request(room, "white", 3_500);
  const accepted = accept(room, "black", undoRequest, 4_000);
  assert.equal(accepted.move.undoneCount, 1);
  assert.equal(accepted.room.moveCount, 1);
  assert.equal(accepted.room.game.board[2][2], "black");
  assert.equal(accepted.room.game.board[6][6], null);
  assert.equal(accepted.room.game.currentPlayer, "white");
  assert.equal(accepted.room.timeControl.activeColor, "white");
  assert.equal(accepted.room.replay.events.length, 1);
});

test("a pass reply counts as a move and the requester needs a move of its own", () => {
  const room = timedRoom();
  room.applyAction({ playerId: "black", action: "play", payload: { row: 4, col: 4 }, now: 2_000 });
  assert.throws(
    () => request(room, "white", 2_100),
    (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );
  room.applyAction({ playerId: "white", action: "pass", now: 3_000 });
  assert.equal(room.snapshot(3_000).game.consecutivePasses, 1);

  const accepted = accept(room, "white", request(room, "black", 3_500), 4_000).room;
  assert.equal(accepted.moveCount, 0);
  assert.equal(accepted.game.board[4][4], null);
  assert.equal(accepted.game.consecutivePasses, 0);
  assert.equal(accepted.game.lastMove, null);
  assert.equal(accepted.game.currentPlayer, "black");
  assert.equal(accepted.replay.events.length, 0);

  // After a pass by the requester, the pass is what gets taken back.
  room.applyAction({ playerId: "black", action: "pass", now: 5_000 });
  const passBack = accept(room, "white", request(room, "black", 5_100), 5_200);
  assert.equal(passBack.move.undoneCount, 1);
  assert.equal(passBack.room.moveCount, 0);
  assert.equal(passBack.room.game.currentPlayer, "black");
});

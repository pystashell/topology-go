import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_TTL_MS,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";

const BLACK_HASH = "a".repeat(64);
const WHITE_HASH = "b".repeat(64);
const VIEWER_HASH = "c".repeat(64);

function createRoom(now = 1_000) {
  return RoomEngine.create({
    code: "BAM234",
    name: "黑方",
    size: 9,
    komi: 6.5,
    scoringRule: "japanese",
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now,
  });
}

function joinWhite(room, now = 2_000) {
  return room.join({
    name: "白方",
    role: "player",
    playerId: "white-player",
    tokenHash: WHITE_HASH,
    now,
  });
}

function enterScoring(room, now = 3_000) {
  room.applyAction({ playerId: "black-player", action: "pass", now });
  return room.applyAction({
    playerId: "white-player",
    action: "pass",
    now: now + 1,
  });
}

test("waits for both player seats before play starts", () => {
  const room = createRoom();
  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "play",
        payload: { row: 0, col: 0 },
        now: 1_100,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "WAITING_FOR_OPPONENT",
  );
  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "pass",
        now: 1_101,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "WAITING_FOR_OPPONENT",
  );

  joinWhite(room, 1_200);
  const started = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_300,
  });
  assert.equal(started.room.moveCount, 1);
});

test("assigns black, white and spectator roles and validates the turn", () => {
  const room = createRoom();
  const white = joinWhite(room);
  assert.equal(white.identity.color, "white");

  const viewer = room.join({
    name: "观众",
    role: "spectator",
    playerId: "viewer",
    tokenHash: VIEWER_HASH,
    now: 2_100,
  });
  assert.equal(viewer.identity.color, null);

  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "play",
        payload: { row: 0, col: 0 },
        now: 3_000,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "NOT_YOUR_TURN",
  );
  assert.throws(
    () =>
      room.applyAction({
        playerId: "viewer",
        action: "pass",
        now: 3_001,
      }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  const blackMove = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 4_000,
  });
  assert.equal(blackMove.room.game.board[0][0], "black");
  assert.equal(blackMove.room.game.currentPlayer, "white");
  assert.equal(blackMove.room.moveCount, 1);

  const whiteMove = room.applyAction({
    playerId: "white-player",
    action: "play",
    payload: { row: 0, col: 1 },
    now: 5_000,
  });
  assert.equal(whiteMove.room.game.board[0][1], "white");
  assert.equal(whiteMove.room.game.currentPlayer, "black");
  assert.equal(whiteMove.room.game.moveCount, 2);
});

test("disconnect keeps a seat, while explicit leave releases it", () => {
  const room = createRoom();
  joinWhite(room);
  room.resumeConnection("white-player", "socket-white", 2_100);
  assert.equal(room.snapshot(2_101).players[1].online, true);

  room.disconnect({ connectionId: "socket-white", now: 2_200 });
  const disconnected = room.snapshot(2_201);
  assert.equal(disconnected.players[1].online, false);
  assert.equal(disconnected.players[1].color, "white");

  const third = room.join({
    name: "第三位玩家",
    role: "player",
    playerId: "third-player",
    tokenHash: "d".repeat(64),
    now: 2_300,
  });
  assert.equal(third.identity.role, "spectator");
  assert.equal(third.identity.color, null);

  room.leave({ playerId: "white-player", now: 2_400 });
  const replacement = room.join({
    name: "接替者",
    role: "player",
    playerId: "replacement",
    tokenHash: "e".repeat(64),
    now: 2_500,
  });
  assert.equal(replacement.identity.color, "white");
});

test("serializes the game, memberships and command receipts", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 8 },
    now: 3_000,
  });

  const receipt = room.recordCommand({
    playerId: "black-player",
    id: "move-1",
    sequence: 1,
    now: 3_001,
  });
  assert.equal(receipt.ok, true);
  assert.equal(room.inspectCommand("black-player", "move-1", 1).kind, "duplicate");

  const restored = RoomEngine.restore(room.serialize());
  assert.equal(restored.snapshot(3_002).game.board[4][8], "black");
  assert.equal(restored.snapshot(3_002).players.length, 2);
  assert.equal(restored.inspectCommand("black-player", "move-1", 1).kind, "duplicate");
  assert.equal(
    restored.inspectCommand("black-player", "old-but-different", 1).kind,
    "stale",
  );
});

test("supports pass, scoring controls, resume and a black-controlled new game", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({ playerId: "black-player", action: "pass", now: 3_000 });
  const scoring = room.applyAction({
    playerId: "white-player",
    action: "pass",
    now: 4_000,
  });
  assert.equal(scoring.room.game.phase, "scoring");

  const resumed = room.applyAction({
    playerId: "black-player",
    action: "resume_play",
    now: 5_000,
  });
  assert.equal(resumed.room.game.phase, "play");

  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "new_game",
        now: 5_100,
      }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  const fresh = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 13, komi: 7.5, scoringRule: "chinese" },
    now: 6_000,
  });
  assert.equal(fresh.room.game.board.flat().every((point) => point === null), true);
  assert.equal(fresh.room.game.currentPlayer, "black");
  assert.equal(fresh.room.game.size, 13);
  assert.equal(fresh.room.game.komi, 7.5);
  assert.equal(fresh.room.game.scoringRule, "chinese");
  assert.equal(fresh.room.moveCount, 0);
});

test("requires both colors to confirm before finishing scoring", () => {
  const room = createRoom();
  joinWhite(room);
  enterScoring(room);

  const blackConfirmation = room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 4_000,
  });
  assert.equal(blackConfirmation.move.type, "score_confirmation");
  assert.equal(blackConfirmation.room.game.phase, "scoring");
  assert.deepEqual(blackConfirmation.room.scoreConfirmations, ["black"]);

  const repeated = room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 4_100,
  });
  assert.equal(repeated.room.game.phase, "scoring");
  assert.deepEqual(repeated.room.scoreConfirmations, ["black"]);

  const finished = room.applyAction({
    playerId: "white-player",
    action: "finish_scoring",
    now: 5_000,
  });
  assert.equal(finished.move.type, "finish_scoring");
  assert.equal(finished.room.game.phase, "finished");
  assert.deepEqual(finished.room.scoreConfirmations, ["black", "white"]);
});

test("changing dead stones clears scoring confirmations", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 3_000,
  });
  room.applyAction({ playerId: "white-player", action: "pass", now: 3_100 });
  room.applyAction({ playerId: "black-player", action: "pass", now: 3_200 });
  room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 3_300,
  });

  const changed = room.applyAction({
    playerId: "white-player",
    action: "toggle_dead",
    payload: { row: 0, col: 0 },
    now: 3_400,
  });
  assert.equal(changed.room.game.phase, "scoring");
  assert.deepEqual(changed.room.scoreConfirmations, []);
});

test("persists score confirmations and restores old states without the field", () => {
  const room = createRoom();
  joinWhite(room);
  enterScoring(room);
  room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 4_000,
  });

  const restored = RoomEngine.restore(room.serialize());
  assert.deepEqual(restored.snapshot(4_001).scoreConfirmations, ["black"]);
  const finished = restored.applyAction({
    playerId: "white-player",
    action: "finish_scoring",
    now: 4_100,
  });
  assert.equal(finished.room.game.phase, "finished");

  const legacyState = room.serialize();
  delete legacyState.scoreConfirmations;
  const restoredLegacy = RoomEngine.restore(legacyState);
  assert.deepEqual(restoredLegacy.snapshot(4_200).scoreConfirmations, []);
});

test("resume, new game, continued play and leaving clear confirmations", () => {
  const room = createRoom();
  joinWhite(room);
  enterScoring(room);
  room.applyAction({
    playerId: "white-player",
    action: "finish_scoring",
    now: 4_000,
  });
  assert.deepEqual(room.snapshot(4_001).scoreConfirmations, ["white"]);

  const resumed = room.applyAction({
    playerId: "black-player",
    action: "resume_play",
    now: 4_100,
  });
  assert.deepEqual(resumed.room.scoreConfirmations, []);

  room.state.scoreConfirmations = ["black"];
  const continued = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 1, col: 1 },
    now: 4_200,
  });
  assert.deepEqual(continued.room.scoreConfirmations, []);

  room.state.scoreConfirmations = ["white"];
  room.leave({ playerId: "white-player", now: 4_300 });
  assert.deepEqual(room.snapshot(4_301).scoreConfirmations, []);

  room.state.scoreConfirmations = ["black"];
  const fresh = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    now: 4_400,
  });
  assert.deepEqual(fresh.room.scoreConfirmations, []);
});

test("expires exactly 24 hours after the last meaningful room touch", () => {
  const room = createRoom(10_000);
  const before = room.advance(10_000 + ROOM_TTL_MS - 1);
  assert.equal(before.expired, false);

  const expired = room.advance(10_000 + ROOM_TTL_MS);
  assert.equal(expired.expired, true);
  assert.equal(expired.room, null);
  assert.equal(room.nextDueAt(), null);
});

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

test("creates, serializes and restores a torus room", () => {
  const room = RoomEngine.create({
    code: "TRS234",
    name: "环面黑方",
    size: 9,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "torus",
    playerId: "torus-black",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });

  assert.equal(room.snapshot(1_001).game.topology, "torus");
  const serialized = room.serialize();
  assert.equal(serialized.game.topology, "torus");
  assert.equal(
    RoomEngine.restore(serialized).snapshot(1_002).game.topology,
    "torus",
  );
});

test("defaults legacy persisted games without topology to cylinder", () => {
  const legacyState = createRoom().serialize();
  delete legacyState.game.topology;

  const restored = RoomEngine.restore(legacyState);
  assert.equal(restored.snapshot(1_001).game.topology, "cylinder");
});

test("validates topology when creating a room", () => {
  assert.throws(
    () =>
      RoomEngine.create({
        code: "BAD234",
        name: "黑方",
        topology: "sphere",
        playerId: "black-player",
        tokenHash: BLACK_HASH,
        now: 1_000,
      }),
    (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
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

test("lets the host switch topology for a new game and rejects invalid topology", () => {
  const room = createRoom();
  joinWhite(room);

  const torus = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { topology: "torus" },
    now: 3_000,
  });
  assert.equal(torus.room.game.topology, "torus");

  const preserved = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 13 },
    now: 3_100,
  });
  assert.equal(preserved.room.game.topology, "torus");

  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "new_game",
        payload: { topology: "sphere" },
        now: 3_200,
      }),
    (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
  );
  assert.equal(room.snapshot(3_201).game.topology, "torus");
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

test("publishes an undo request and pauses play and pass until it is resolved", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 2, col: 3 },
    now: 3_000,
  });
  const revisionBeforeRequest = room.snapshot(3_001).revision;

  const requested = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });
  assert.equal(requested.revision, revisionBeforeRequest + 1);
  assert.equal(requested.move.type, "undo_requested");
  assert.deepEqual(requested.room.undoRequest, {
    requesterId: "black-player",
    requesterRole: "player",
    requesterColor: "black",
    targetMoveCount: 1,
    requestRevision: requested.revision,
    requestedAt: 3_100,
  });

  for (const action of ["play", "pass"]) {
    assert.throws(
      () =>
        room.applyAction({
          playerId: "white-player",
          action,
          payload: { row: 4, col: 4 },
          now: 3_200,
        }),
      (error) =>
        error instanceof RoomEngineError && error.code === "UNDO_PENDING",
    );
  }
  assert.equal(room.snapshot(3_201).revision, requested.revision);
  assert.equal(room.snapshot(3_201).game.board[2][3], "black");
});

test("a stale client cannot request undo for a newer authoritative position", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 2, col: 3 },
    now: 3_000,
  });
  const revisionBeforeRequests = room.snapshot(3_001).revision;

  for (const expectedMoveCount of [undefined, 0, 1.5]) {
    assert.throws(
      () =>
        room.applyAction({
          playerId: "white-player",
          action: "request_undo",
          payload:
            expectedMoveCount === undefined
              ? {}
              : { expectedMoveCount },
          now: 3_100,
        }),
      (error) =>
        error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
    );
  }
  const unchanged = room.snapshot(3_101);
  assert.equal(unchanged.revision, revisionBeforeRequests);
  assert.equal(unchanged.moveCount, 1);
  assert.equal(unchanged.undoRequest, null);

  const current = room.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_200,
  });
  assert.equal(current.room.undoRequest.targetMoveCount, 1);
});

test("the opponent can accept an undo and exactly the requested latest move is restored", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 2, col: 3 },
    now: 3_000,
  });
  const requested = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });

  const accepted = room.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 1,
      requestRevision: requested.room.undoRequest.requestRevision,
    },
    now: 3_200,
  });
  assert.equal(accepted.revision, requested.revision + 1);
  assert.equal(accepted.move.type, "undo_accepted");
  assert.equal(accepted.move.requesterId, "black-player");
  assert.equal(accepted.move.responderId, "white-player");
  assert.equal(accepted.room.undoRequest, null);
  assert.equal(accepted.room.moveCount, 0);
  assert.equal(accepted.room.game.moveCount, 0);
  assert.equal(accepted.room.game.board[2][3], null);
  assert.equal(accepted.room.game.currentPlayer, "black");

  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "respond_undo",
        payload: {
          accept: true,
          targetMoveCount: 1,
          requestRevision: requested.room.undoRequest.requestRevision,
        },
        now: 3_300,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "STALE_UNDO_REQUEST",
  );
});

test("the opponent may decline and the requester may cancel an undo", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 3_000,
  });
  const firstRequest = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });

  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "respond_undo",
        payload: {
          accept: false,
          targetMoveCount: 1,
          requestRevision: firstRequest.room.undoRequest.requestRevision,
        },
        now: 3_200,
      }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );
  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "cancel_undo",
        payload: {
          targetMoveCount: 1,
          requestRevision: firstRequest.room.undoRequest.requestRevision,
        },
        now: 3_201,
      }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  const declined = room.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: false,
      targetMoveCount: 1,
      requestRevision: firstRequest.room.undoRequest.requestRevision,
    },
    now: 3_300,
  });
  assert.equal(declined.move.type, "undo_declined");
  assert.equal(declined.room.moveCount, 1);
  assert.equal(declined.room.game.board[0][0], "black");
  assert.equal(declined.room.undoRequest, null);

  const secondRequest = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_400,
  });
  const cancelled = room.applyAction({
    playerId: "black-player",
    action: "cancel_undo",
    payload: {
      targetMoveCount: 1,
      requestRevision: secondRequest.room.undoRequest.requestRevision,
    },
    now: 3_500,
  });
  assert.equal(cancelled.move.type, "undo_cancelled");
  assert.equal(cancelled.room.undoRequest, null);
  assert.equal(cancelled.room.moveCount, 1);
});

test("a delayed response cannot resolve a newer request at the same move count", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 3_000,
  });
  const first = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });
  room.applyAction({
    playerId: "black-player",
    action: "cancel_undo",
    payload: {
      targetMoveCount: 1,
      requestRevision: first.room.undoRequest.requestRevision,
    },
    now: 3_200,
  });
  const second = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_300,
  });

  assert.equal(second.room.undoRequest.targetMoveCount, 1);
  assert.notEqual(
    second.room.undoRequest.requestRevision,
    first.room.undoRequest.requestRevision,
  );
  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "respond_undo",
        payload: {
          accept: true,
          targetMoveCount: 1,
          requestRevision: first.room.undoRequest.requestRevision,
        },
        now: 3_400,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "STALE_UNDO_REQUEST",
  );
  assert.deepEqual(room.snapshot(3_401).undoRequest, second.room.undoRequest);
  assert.equal(room.snapshot(3_401).game.board[0][0], "black");

  const accepted = room.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 1,
      requestRevision: second.room.undoRequest.requestRevision,
    },
    now: 3_500,
  });
  assert.equal(accepted.room.undoRequest, null);
  assert.equal(accepted.room.game.board[0][0], null);
});

test("undo requests reject spectators, empty games, scoring and stale targets", () => {
  const room = createRoom();
  joinWhite(room);
  room.join({
    name: "Viewer",
    role: "spectator",
    playerId: "viewer",
    tokenHash: VIEWER_HASH,
    now: 2_100,
  });

  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "request_undo",
        payload: { expectedMoveCount: 0 },
        now: 2_200,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );
  assert.throws(
    () =>
      room.applyAction({
        playerId: "viewer",
        action: "request_undo",
        payload: { expectedMoveCount: 0 },
        now: 2_201,
      }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 3_000,
  });
  const request = room.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });
  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "respond_undo",
        payload: {
          accept: true,
          targetMoveCount: 2,
          requestRevision: request.room.undoRequest.requestRevision,
        },
        now: 3_200,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "STALE_UNDO_REQUEST",
  );
  assert.equal(room.snapshot(3_201).undoRequest.targetMoveCount, 1);

  room.applyAction({
    playerId: "white-player",
    action: "cancel_undo",
    payload: {
      targetMoveCount: 1,
      requestRevision: request.room.undoRequest.requestRevision,
    },
    now: 3_300,
  });
  room.applyAction({ playerId: "white-player", action: "pass", now: 3_400 });
  room.applyAction({ playerId: "black-player", action: "pass", now: 3_500 });
  assert.equal(room.snapshot(3_501).game.phase, "scoring");
  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "request_undo",
        payload: { expectedMoveCount: 3 },
        now: 3_600,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );
});

test("undo requests persist, restore, remain receipt-compatible and default to null", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 6, col: 6 },
    now: 3_000,
  });
  const requested = room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });
  const receipt = room.recordCommand({
    playerId: "black-player",
    id: "undo-request-1",
    sequence: 1,
    now: 3_101,
  });
  assert.equal(receipt.revision, requested.revision);
  assert.equal(receipt.ok, true);

  const serialized = room.serialize();
  assert.deepEqual(serialized.undoRequest, requested.room.undoRequest);
  const legacyPendingState = structuredClone(serialized);
  delete legacyPendingState.undoRequest.requestRevision;
  const restoredLegacyPending = RoomEngine.restore(legacyPendingState);
  assert.equal(
    restoredLegacyPending.snapshot(3_150).undoRequest.requestRevision,
    legacyPendingState.revision,
  );
  const legacyAccepted = restoredLegacyPending.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 1,
      requestRevision: legacyPendingState.revision,
    },
    now: 3_151,
  });
  assert.equal(legacyAccepted.room.game.board[6][6], null);

  const restored = RoomEngine.restore(serialized);
  assert.deepEqual(restored.snapshot(3_200).undoRequest, requested.room.undoRequest);
  assert.equal(
    restored.inspectCommand("black-player", "undo-request-1", 1).kind,
    "duplicate",
  );
  const accepted = restored.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 1,
      requestRevision: requested.room.undoRequest.requestRevision,
    },
    now: 3_300,
  });
  assert.equal(accepted.room.game.board[6][6], null);

  const legacyState = createRoom().serialize();
  delete legacyState.undoRequest;
  assert.equal(RoomEngine.restore(legacyState).snapshot(3_400).undoRequest, null);
});

test("undoAvailable respects a legacy history boundary after new play", () => {
  const room = createRoom();
  joinWhite(room);
  assert.equal(room.snapshot(2_001).undoAvailable, false);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 3_000,
  });
  assert.equal(room.snapshot(3_001).undoAvailable, true);

  const legacyState = room.serialize();
  delete legacyState.game.undoHistory;
  const restored = RoomEngine.restore(legacyState);
  assert.equal(restored.snapshot(3_100).moveCount, 1);
  assert.equal(restored.snapshot(3_100).undoAvailable, false);

  const whiteMove = restored.applyAction({
    playerId: "white-player",
    action: "play",
    payload: { row: 4, col: 5 },
    now: 3_200,
  });
  assert.equal(whiteMove.room.moveCount, 2);
  assert.equal(whiteMove.room.undoAvailable, true);
  const requested = restored.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 2 },
    now: 3_300,
  });
  const accepted = restored.applyAction({
    playerId: "black-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 2,
      requestRevision: requested.room.undoRequest.requestRevision,
    },
    now: 3_400,
  });
  assert.equal(accepted.room.moveCount, 1);
  assert.equal(accepted.room.undoAvailable, false);
  assert.equal(accepted.room.game.board[4][4], "black");
  assert.equal(accepted.room.game.board[4][5], null);
});

test("new games and player departures clear pending undo requests", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 1, col: 1 },
    now: 3_000,
  });
  room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_100,
  });
  const fresh = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    now: 3_200,
  });
  assert.equal(fresh.room.undoRequest, null);
  assert.equal(fresh.room.moveCount, 0);

  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 1, col: 1 },
    now: 3_300,
  });
  room.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 3_400,
  });
  const left = room.leave({ playerId: "white-player", now: 3_500 });
  assert.equal(left.room.undoRequest, null);
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

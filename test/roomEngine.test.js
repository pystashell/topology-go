import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_TTL_MS,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { CHAT_HISTORY_MAX_BYTES } from "../src/multiplayer/chat.js";

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

test("publishes a complete defensive replay timeline in room snapshots", () => {
  const room = createRoom();
  joinWhite(room);

  const initialReplay = room.snapshot(2_001).replay;
  assert.equal(initialReplay.version, 1);
  assert.equal(initialReplay.complete, true);
  assert.equal(initialReplay.base.size, 9);
  assert.deepEqual(initialReplay.events, []);

  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 8 },
    now: 3_000,
  });
  room.applyAction({ playerId: "white-player", action: "pass", now: 3_100 });

  const replay = room.snapshot(3_101).replay;
  assert.deepEqual(
    replay.events.map((event) => event.type),
    ["play", "pass"],
  );
  assert.deepEqual(replay.events[0], {
    type: "play",
    color: "black",
    row: 4,
    col: 8,
  });
  assert.deepEqual(replay.events[1], { type: "pass", color: "white" });

  replay.base.board[0][0] = "white";
  replay.events[0].row = 0;
  replay.events.push({ type: "pass", color: "black" });

  const freshReplay = room.snapshot(3_102).replay;
  assert.equal(freshReplay.base.board[0][0], null);
  assert.equal(freshReplay.events[0].row, 4);
  assert.equal(freshReplay.events.length, 2);
});

test("accepted online undo removes the latest event from the replay timeline", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 2, col: 3 },
    now: 3_000,
  });
  room.applyAction({ playerId: "white-player", action: "pass", now: 3_100 });

  const requested = room.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 2 },
    now: 3_200,
  });
  const accepted = room.applyAction({
    playerId: "black-player",
    action: "respond_undo",
    payload: {
      accept: true,
      targetMoveCount: 2,
      requestRevision: requested.room.undoRequest.requestRevision,
    },
    now: 3_300,
  });

  assert.equal(accepted.room.moveCount, 1);
  assert.deepEqual(accepted.room.replay.events, [
    { type: "play", color: "black", row: 2, col: 3 },
  ]);
});

test("replay survives room serialization and legacy rooms and engines fall back safely", () => {
  const room = createRoom();
  joinWhite(room);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 6, col: 6 },
    now: 3_000,
  });

  const replayBeforeRestore = room.snapshot(3_001).replay;
  const serialized = room.serialize();
  const restored = RoomEngine.restore(serialized);
  assert.deepEqual(restored.snapshot(3_002).replay, replayBeforeRestore);

  const legacyState = structuredClone(serialized);
  delete legacyState.game.replay;
  const restoredLegacy = RoomEngine.restore(legacyState);
  const legacyReplay = restoredLegacy.snapshot(3_003).replay;
  assert.equal(legacyReplay.version, 1);
  assert.equal(legacyReplay.complete, false);
  assert.deepEqual(legacyReplay.events, []);
  assert.deepEqual(legacyReplay.base.board, legacyState.game.board);
  assert.equal(legacyReplay.base.currentPlayer, "white");

  // Transitional compatibility for an old engine or a lightweight test
  // double that predates getReplayState().
  const oldGameState = structuredClone(legacyState.game);
  const oldGame = {
    getState: () => structuredClone(oldGameState),
    exportState: () => structuredClone(oldGameState),
    canUndo: () => false,
  };
  const oldEngineRoom = new RoomEngine(structuredClone(restored.state), oldGame);
  const fallback = oldEngineRoom.snapshot(3_004).replay;
  assert.equal(fallback.version, 1);
  assert.equal(fallback.complete, false);
  assert.deepEqual(fallback.events, []);
  assert.deepEqual(fallback.base.board, oldEngineRoom.snapshot(3_005).game.board);
  assert.equal(fallback.base.currentPlayer, "white");
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
  assert.equal(blackConfirmation.room.replay.events.at(-1).type, "pass");

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
  assert.equal(finished.room.replay.events.at(-1).type, "finish_scoring");
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
  assert.deepEqual(changed.room.replay.events.at(-1), {
    type: "toggle_dead",
    row: 0,
    col: 0,
  });
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

test("players can chat without changing the game revision or censoring text", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  const before = room.snapshot(1_101);
  const text = "D4 这里？<script>alert('x')</script> 👨‍👩‍👧‍👦";
  const posted = room.postChat({
    playerId: "black-player",
    sequence: 1,
    payload: { kind: "text", text },
    now: 2_000,
  });

  assert.equal(posted.revision, before.revision);
  assert.equal(posted.message.text, text);
  assert.deepEqual(posted.message.points, [
    { row: 5, col: 3, label: "D4" },
  ]);
  assert.equal(posted.message.boardSize, 9);
  assert.equal(posted.message.boardTopology, "cylinder");
  assert.equal(posted.message.moveCount, 0);

  const after = room.snapshot(2_001);
  assert.equal(after.revision, before.revision);
  assert.equal(after.moveCount, 0);
  assert.deepEqual(after.game.board, before.game.board);
  assert.equal(after.chat.sequence, 1);
  assert.equal(after.chat.messages.length, 1);
  assert.ok(after.expiresAt > before.expiresAt);

  after.chat.messages[0].text = "被客户端篡改";
  assert.equal(room.snapshot(2_002).chat.messages[0].text, text);
  assert.equal(
    RoomEngine.restore(room.serialize()).snapshot(2_003).chat.messages[0].text,
    text,
  );
});

test("spectators cannot send chat and sticker ids are server validated", () => {
  const room = createRoom();
  joinWhite(room);
  room.join({
    name: "观众",
    role: "spectator",
    playerId: "viewer",
    tokenHash: VIEWER_HASH,
    now: 2_100,
  });

  assert.throws(
    () =>
      room.postChat({
        playerId: "viewer",
        sequence: 1,
        payload: { kind: "text", text: "我只能旁观" },
        now: 3_000,
    }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );
  for (let sequence = 2; sequence <= 5; sequence += 1) {
    assert.throws(
      () =>
        room.postChat({
          playerId: "viewer",
          sequence,
          payload: { kind: "text", text: "旁观请求也要受限速" },
          now: 3_000,
        }),
      (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
    );
  }
  assert.throws(
    () =>
      room.postChat({
        playerId: "viewer",
        sequence: 6,
        payload: { kind: "text", text: "不能无限触发拒绝写入" },
        now: 3_000,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "CHAT_RATE_LIMITED",
  );
  assert.throws(
    () =>
      room.postChat({
        playerId: "black-player",
        sequence: 1,
        payload: { kind: "sticker", stickerId: "https://evil.example/x.svg" },
        now: 3_001,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "UNKNOWN_STICKER",
  );
  assert.equal(room.snapshot(3_002).chat.messages.length, 0);
});

test("spectator abuse does not consume the players' shared chat budget", () => {
  const room = createRoom();
  joinWhite(room);

  for (let spectatorIndex = 1; spectatorIndex <= 3; spectatorIndex += 1) {
    const playerId = `viewer-${spectatorIndex}`;
    room.join({
      name: `Viewer ${spectatorIndex}`,
      role: "spectator",
      playerId,
      tokenHash: String(spectatorIndex).repeat(64),
      now: 2_100,
    });

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      assert.throws(
        () =>
          room.postChat({
            playerId,
            sequence,
            payload: { kind: "text", text: "spectator abuse" },
            now: 3_000,
          }),
        (error) =>
          error instanceof RoomEngineError && error.code === "FORBIDDEN",
      );
    }
  }

  for (const playerId of ["black-player", "white-player"]) {
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      room.postChat({
        playerId,
        sequence,
        payload: { kind: "sticker", stickerId: "good-move" },
        now: 3_000,
      });
    }
  }

  assert.equal(room.snapshot(3_001).chat.messages.length, 10);
});

test("invalid chat attempts consume the same persistent rate limit", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    assert.throws(
      () =>
        room.postChat({
          playerId: "black-player",
          sequence,
          payload: { kind: "sticker", stickerId: `unknown-${sequence}` },
          now: 2_000,
        }),
      (error) =>
        error instanceof RoomEngineError && error.code === "UNKNOWN_STICKER",
    );
  }
  assert.throws(
    () =>
      room.postChat({
        playerId: "black-player",
        sequence: 6,
        payload: { kind: "text", text: "无效消息不能绕过限速" },
        now: 2_000,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "CHAT_RATE_LIMITED",
  );
  assert.equal(room.snapshot(2_001).chat.messages.length, 0);

  const restored = RoomEngine.restore(room.serialize());
  assert.throws(
    () =>
      restored.postChat({
        playerId: "black-player",
        sequence: 6,
        payload: { kind: "text", text: "重载后仍然限速" },
        now: 2_100,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "CHAT_RATE_LIMITED",
  );
});

test("chat uses persistent burst limits and recovers tokens over time", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    room.postChat({
      playerId: "black-player",
      sequence,
      payload: { kind: "sticker", stickerId: "good-move" },
      now: 2_000,
    });
  }
  assert.throws(
    () =>
      room.postChat({
        playerId: "black-player",
        sequence: 6,
        payload: { kind: "text", text: "太快了" },
        now: 2_000,
      }),
    (error) =>
      error instanceof RoomEngineError &&
      error.code === "CHAT_RATE_LIMITED" &&
      error.retryable,
  );
  assert.equal(room.snapshot(2_001).chat.messages.length, 5);

  const restored = RoomEngine.restore(room.serialize());
  assert.throws(
    () =>
      restored.postChat({
        playerId: "black-player",
        sequence: 6,
        payload: { kind: "text", text: "重连也不能绕过限速" },
        now: 2_100,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "CHAT_RATE_LIMITED",
  );
  restored.postChat({
    playerId: "black-player",
    sequence: 6,
    payload: { kind: "text", text: "冷却后可以继续" },
    now: 3_200,
  });
  assert.equal(restored.snapshot(3_201).chat.messages.length, 6);
});

test("chat history stays bounded and legacy rooms restore with empty chat", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  for (let sequence = 1; sequence <= 101; sequence += 1) {
    room.postChat({
      playerId: "black-player",
      sequence,
      payload: { kind: "sticker", stickerId: "bamboo" },
      now: 2_000 + sequence * 1_200,
    });
  }
  const snapshot = room.snapshot(124_000);
  assert.equal(snapshot.chat.messages.length, 100);
  assert.equal(snapshot.chat.messages[0].sequence, 2);
  assert.equal(snapshot.chat.messages.at(-1).sequence, 101);

  const legacy = createRoom().serialize();
  delete legacy.chatSequence;
  delete legacy.chatMessages;
  delete legacy.chatBucket;
  for (const member of legacy.members) delete member.chatBucket;
  assert.deepEqual(RoomEngine.restore(legacy).snapshot(1_001).chat, {
    sequence: 0,
    messages: [],
  });
});

test("long text chat stays within 64 KiB across snapshots and restoration", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  const longText = "界".repeat(300);

  for (let sequence = 1; sequence <= 100; sequence += 1) {
    room.postChat({
      playerId: "black-player",
      sequence,
      payload: { kind: "text", text: longText },
      now: 2_000 + sequence * 1_200,
    });
  }

  const snapshot = room.snapshot(123_000);
  const snapshotBytes = new TextEncoder().encode(
    JSON.stringify(snapshot.chat.messages),
  ).byteLength;
  assert.ok(snapshotBytes <= CHAT_HISTORY_MAX_BYTES);
  assert.ok(snapshot.chat.messages.length < 100);
  assert.ok(snapshot.chat.messages[0].sequence > 1);
  assert.equal(snapshot.chat.messages.at(-1).sequence, 100);

  const restored = RoomEngine.restore(room.serialize());
  const restoredSnapshot = restored.snapshot(123_001);
  const restoredBytes = new TextEncoder().encode(
    JSON.stringify(restoredSnapshot.chat.messages),
  ).byteLength;
  assert.ok(restoredBytes <= CHAT_HISTORY_MAX_BYTES);
  assert.deepEqual(restoredSnapshot.chat, snapshot.chat);

  restored.postChat({
    playerId: "black-player",
    sequence: 101,
    payload: { kind: "text", text: longText },
    now: 123_200,
  });
  const continued = restored.snapshot(123_201);
  const continuedBytes = new TextEncoder().encode(
    JSON.stringify(continued.chat.messages),
  ).byteLength;
  assert.ok(continuedBytes <= CHAT_HISTORY_MAX_BYTES);
  assert.equal(continued.chat.sequence, 101);
  assert.equal(continued.chat.messages.at(-1).sequence, 101);
});

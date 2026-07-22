import assert from "node:assert/strict";
import test from "node:test";

import {
  MATCH_MODE_AI_AI,
  MATCH_MODE_FRIEND,
  MATCH_MODE_HUMAN_AI,
  MATCH_MODE_LOCAL,
  MATCH_STATUS_FINISHED,
  MATCH_STATUS_INVITED,
  MATCH_STATUS_PLAYING,
  MATCH_STATUS_SETUP,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { normalizeCommandMessage } from "../src/multiplayer/protocol.js";

const BLACK_HASH = "a".repeat(64);
const WHITE_HASH = "b".repeat(64);

function createSetupRoom(options = {}) {
  return RoomEngine.create({
    code: "ABC234",
    name: "Host",
    size: 9,
    playerId: "host",
    tokenHash: BLACK_HASH,
    startImmediately: false,
    now: 1_000,
    ...options,
  });
}

function joinWhite(room, now = 1_100) {
  return room.join({
    name: "Friend",
    role: "player",
    playerId: "friend",
    tokenHash: WHITE_HASH,
    now,
  });
}

function request(room, payload, now) {
  return room.applyAction({
    playerId: "host",
    action: "request_game",
    payload,
    now,
  });
}

test("setup-first friend rooms persist an invitation until the opponent accepts", () => {
  const room = createSetupRoom({
    mainTimeSeconds: 30,
    byoYomiPeriods: 1,
    byoYomiSeconds: 5,
  });
  assert.equal(room.snapshot(1_001).match.status, MATCH_STATUS_SETUP);
  assert.equal(room.snapshot(1_001).timeControl.running, false);
  assert.throws(
    () => room.applyAction({
      playerId: "host",
      action: "play",
      payload: { row: 0, col: 0 },
      now: 1_010,
    }),
    (error) => error instanceof RoomEngineError && error.code === "GAME_NOT_STARTED",
  );

  joinWhite(room);
  const invited = request(room, {
    mode: MATCH_MODE_FRIEND,
    width: 13,
    height: 9,
    topology: "torus",
  }, 1_200).room;
  assert.equal(invited.match.status, MATCH_STATUS_INVITED);
  assert.equal(invited.match.request.controllers.white.operatorId, "friend");
  assert.equal(invited.game.width, 9, "an invitation must not replace the board yet");
  assert.equal(invited.timeControl.running, false);

  const restored = RoomEngine.restore(room.serialize());
  const accepted = restored.applyAction({
    playerId: "friend",
    action: "respond_game",
    payload: {
      accept: true,
      requestRevision: invited.match.request.requestRevision,
    },
    now: 1_300,
  }).room;
  assert.equal(accepted.match.status, MATCH_STATUS_PLAYING);
  assert.equal(accepted.match.mode, MATCH_MODE_FRIEND);
  assert.equal(accepted.game.width, 13);
  assert.equal(accepted.game.height, 9);
  assert.equal(accepted.game.topology, "torus");
  assert.equal(accepted.timeControl.running, true);
});

test("a friend invitation stays unavailable until a human opponent occupies white", () => {
  const room = createSetupRoom();
  assert.throws(
    () => request(room, { mode: MATCH_MODE_FRIEND }, 1_100),
    (error) =>
      error instanceof RoomEngineError && error.code === "OPPONENT_REQUIRED",
  );
  assert.equal(room.snapshot(1_101).match.status, MATCH_STATUS_SETUP);

  joinWhite(room, 1_200);
  const invited = request(room, { mode: MATCH_MODE_FRIEND }, 1_300).room;
  assert.equal(invited.match.status, MATCH_STATUS_INVITED);
  assert.equal(invited.match.request.controllers.white.operatorId, "friend");
});

test("friend invitations can be declined or cancelled without replacing the game", () => {
  const room = createSetupRoom();
  joinWhite(room);
  const first = request(room, { mode: MATCH_MODE_FRIEND, size: 13 }, 1_200).room;
  const declined = room.applyAction({
    playerId: "friend",
    action: "respond_game",
    payload: {
      accept: false,
      requestRevision: first.match.request.requestRevision,
    },
    now: 1_300,
  }).room;
  assert.equal(declined.match.status, MATCH_STATUS_SETUP);
  assert.equal(declined.match.request, null);
  assert.equal(declined.game.width, 9);

  const second = request(room, { mode: MATCH_MODE_FRIEND, size: 19 }, 1_400).room;
  const cancelled = room.applyAction({
    playerId: "host",
    action: "cancel_game_request",
    payload: { requestRevision: second.match.request.requestRevision },
    now: 1_500,
  }).room;
  assert.equal(cancelled.match.status, MATCH_STATUS_SETUP);
  assert.equal(cancelled.match.request, null);
  assert.equal(cancelled.game.width, 9);
});

test("non-friend online modes start immediately with browser-owned controllers", () => {
  const local = createSetupRoom();
  const localStarted = request(local, { mode: MATCH_MODE_LOCAL }, 1_100).room;
  assert.deepEqual(localStarted.match.controllers, {
    black: { kind: "human", operatorId: "host" },
    white: { kind: "human", operatorId: "host" },
  });
  local.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_200,
  });
  assert.doesNotThrow(() => local.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 1 },
    now: 1_300,
  }));

  const humanAI = createSetupRoom();
  const humanAIStarted = request(humanAI, {
    mode: MATCH_MODE_HUMAN_AI,
    aiModelId: "b18",
  }, 1_100).room;
  assert.equal(humanAIStarted.match.controllers.white.kind, "ai");
  assert.equal(humanAIStarted.match.controllers.white.modelId, "b18");
  const afterHuman = humanAI.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_200,
  }).room;
  assert.doesNotThrow(() => humanAI.applyAction({
    playerId: "host",
    action: "ai_play",
    payload: {
      row: 0,
      col: 1,
      expectedMoveCount: afterHuman.moveCount,
      expectedPositionToken: afterHuman.positionToken,
    },
    now: 1_300,
  }));

  const aiAI = createSetupRoom();
  let aiSnapshot = request(aiAI, {
    mode: MATCH_MODE_AI_AI,
    aiModelId: "b10",
  }, 1_100).room;
  assert.equal(aiSnapshot.match.controllers.black.kind, "ai");
  assert.equal(aiSnapshot.match.controllers.white.kind, "ai");
  aiSnapshot = aiAI.applyAction({
    playerId: "host",
    action: "ai_play",
    payload: {
      row: 0,
      col: 0,
      expectedMoveCount: aiSnapshot.moveCount,
      expectedPositionToken: aiSnapshot.positionToken,
    },
    now: 1_200,
  }).room;
  assert.doesNotThrow(() => aiAI.applyAction({
    playerId: "host",
    action: "ai_play",
    payload: {
      row: 0,
      col: 1,
      expectedMoveCount: aiSnapshot.moveCount,
      expectedPositionToken: aiSnapshot.positionToken,
    },
    now: 1_300,
  }));
});

test("AI and local controllers occupy the opponent seat for later HTTP joins", () => {
  for (const mode of [
    MATCH_MODE_LOCAL,
    MATCH_MODE_HUMAN_AI,
    MATCH_MODE_AI_AI,
  ]) {
    const room = createSetupRoom();
    request(room, { mode }, 1_100);
    const lateJoin = room.join({
      name: "Late visitor",
      role: "player",
      playerId: `late-${mode}`,
      tokenHash: WHITE_HASH,
      now: 1_200,
    });
    assert.equal(lateJoin.identity.role, "spectator", mode);
    assert.equal(lateJoin.identity.color, null, mode);
    assert.throws(
      () => room.applyAction({
        playerId: `late-${mode}`,
        action: "claim_seat",
        now: 1_300,
      }),
      (error) => error instanceof RoomEngineError && error.code === "SEAT_UNAVAILABLE",
      mode,
    );
  }
});

test("a seated remote opponent cannot be silently replaced by AI or local control", () => {
  for (const mode of [
    MATCH_MODE_LOCAL,
    MATCH_MODE_HUMAN_AI,
    MATCH_MODE_AI_AI,
  ]) {
    const room = createSetupRoom();
    joinWhite(room);
    assert.throws(
      () => request(room, { mode }, 1_200),
      (error) =>
        error instanceof RoomEngineError &&
        error.code === "OPPONENT_SEAT_OCCUPIED",
      mode,
    );
    assert.equal(room.snapshot(1_201).match.status, MATCH_STATUS_SETUP, mode);
    assert.equal(room.snapshot(1_201).players.find(({ color }) => color === "white")?.id, "friend");
  }

  const released = createSetupRoom();
  joinWhite(released);
  released.applyAction({
    playerId: "friend",
    action: "release_seat",
    now: 1_200,
  });
  assert.equal(
    request(released, { mode: MATCH_MODE_HUMAN_AI }, 1_300).room.match.controllers.white.kind,
    "ai",
  );
});

test("same-browser local mode directly undoes one move and preserves clock and replay state", () => {
  const room = createSetupRoom({
    mainTimeSeconds: 30,
    byoYomiPeriods: 1,
    byoYomiSeconds: 5,
  });
  request(room, { mode: MATCH_MODE_LOCAL }, 1_100);
  room.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_200,
  });
  const beforeUndo = room.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 1 },
    now: 1_300,
  }).room;

  assert.throws(
    () => room.applyAction({
      playerId: "host",
      action: "direct_undo_local_round",
      payload: {
        expectedMoveCount: beforeUndo.moveCount,
        expectedPositionToken: `${beforeUndo.positionToken}-stale`,
      },
      now: 1_350,
    }),
    (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
  );
  assert.equal(room.snapshot(1_351).moveCount, 2);

  const undone = room.applyAction({
    playerId: "host",
    action: "direct_undo_local_round",
    payload: {
      expectedMoveCount: beforeUndo.moveCount,
      expectedPositionToken: beforeUndo.positionToken,
    },
    now: 1_400,
  });

  assert.equal(undone.move.type, "local_move_undone");
  assert.equal(undone.move.move.color, "white");
  assert.equal(undone.room.moveCount, 1);
  assert.equal(undone.room.game.moveCount, 1);
  assert.equal(undone.room.game.board[0][0], "black");
  assert.equal(undone.room.game.board[0][1], null);
  assert.equal(undone.room.game.currentPlayer, "white");
  assert.equal(undone.room.replay.events.length, 1);
  assert.equal(undone.room.undoRequest, null);
  assert.equal(undone.room.timeControl.running, true);
  assert.equal(undone.room.timeControl.activeColor, "white");

  const restored = RoomEngine.restore(room.serialize()).snapshot(1_500);
  assert.equal(restored.moveCount, 1);
  assert.equal(restored.game.board[0][1], null);
  assert.equal(restored.replay.events.length, 1);
  assert.equal(restored.undoAvailable, true);
});

test("direct local undo rejects friend and human-AI controller layouts", () => {
  const friendRoom = createSetupRoom();
  joinWhite(friendRoom);
  const invitation = request(
    friendRoom,
    { mode: MATCH_MODE_FRIEND },
    1_200,
  ).room.match.request;
  let friendSnapshot = friendRoom.applyAction({
    playerId: "friend",
    action: "respond_game",
    payload: { accept: true, requestRevision: invitation.requestRevision },
    now: 1_300,
  }).room;
  friendSnapshot = friendRoom.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_400,
  }).room;
  assert.throws(
    () => friendRoom.applyAction({
      playerId: "host",
      action: "direct_undo_local_round",
      payload: {
        expectedMoveCount: friendSnapshot.moveCount,
        expectedPositionToken: friendSnapshot.positionToken,
      },
      now: 1_500,
    }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  const humanAI = createSetupRoom();
  let humanAISnapshot = request(
    humanAI,
    { mode: MATCH_MODE_HUMAN_AI },
    1_100,
  ).room;
  humanAISnapshot = humanAI.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_200,
  }).room;
  assert.throws(
    () => humanAI.applyAction({
      playerId: "host",
      action: "direct_undo_local_round",
      payload: {
        expectedMoveCount: humanAISnapshot.moveCount,
        expectedPositionToken: humanAISnapshot.positionToken,
      },
      now: 1_300,
    }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );
});

test("direct local undo is unavailable before start and during scoring", () => {
  const setupRoom = createSetupRoom();
  const setup = setupRoom.snapshot(1_001);
  assert.throws(
    () => setupRoom.applyAction({
      playerId: "host",
      action: "direct_undo_local_round",
      payload: {
        expectedMoveCount: setup.moveCount,
        expectedPositionToken: setup.positionToken,
      },
      now: 1_010,
    }),
    (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );

  const scoringRoom = createSetupRoom();
  request(scoringRoom, { mode: MATCH_MODE_LOCAL }, 1_100);
  scoringRoom.applyAction({
    playerId: "host",
    action: "pass",
    now: 1_200,
  });
  const scoring = scoringRoom.applyAction({
    playerId: "host",
    action: "pass",
    now: 1_300,
  }).room;
  assert.equal(scoring.game.phase, "scoring");
  assert.throws(
    () => scoringRoom.applyAction({
      playerId: "host",
      action: "direct_undo_local_round",
      payload: {
        expectedMoveCount: scoring.moveCount,
        expectedPositionToken: scoring.positionToken,
      },
      now: 1_400,
    }),
    (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );
  assert.equal(scoringRoom.snapshot(1_401).moveCount, 2);
});

test("starting the next round preserves a full bounded archive for replay and lobby summaries", () => {
  const room = createSetupRoom();
  request(room, { mode: MATCH_MODE_LOCAL }, 1_100);
  room.applyAction({
    playerId: "host",
    action: "play",
    payload: { row: 2, col: 3 },
    now: 1_200,
  });
  const finished = room.applyAction({
    playerId: "host",
    action: "resign",
    payload: { color: "white" },
    now: 1_300,
  }).room;
  assert.equal(finished.match.status, MATCH_STATUS_FINISHED);

  const next = request(room, {
    mode: MATCH_MODE_HUMAN_AI,
    width: 13,
    height: 9,
  }, 1_400).room;
  assert.equal(next.match.status, MATCH_STATUS_PLAYING);
  assert.equal(next.roundArchive.length, 1);
  assert.equal(next.roundArchive[0].mode, MATCH_MODE_LOCAL);
  assert.equal(next.roundArchive[0].result.reason, "resign");
  assert.equal(next.roundArchive[0].settings.width, 9);
  assert.equal(next.roundArchive[0].replay.complete, true);
  assert.equal(next.roundArchive[0].replay.events[0].row, 2);
  assert.equal(next.roundArchive[0].replay.events[0].col, 3);
});

test("v1 rooms migrate to persistent match controllers and protocol accepts negotiation commands", () => {
  const room = RoomEngine.create({
    code: "ABC234",
    name: "Host",
    size: 9,
    playerId: "host",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room);
  const legacy = room.serialize();
  legacy.schemaVersion = 1;
  delete legacy.match;
  delete legacy.roundArchive;
  delete legacy.allowLegacyNewGame;

  const migrated = RoomEngine.restore(legacy).snapshot(1_200);
  assert.equal(migrated.match.status, MATCH_STATUS_PLAYING);
  assert.equal(migrated.match.mode, MATCH_MODE_FRIEND);
  assert.equal(migrated.match.controllers.black.operatorId, "host");
  assert.equal(migrated.match.controllers.white.operatorId, "friend");
  assert.deepEqual(migrated.roundArchive, []);

  for (const action of ["request_game", "respond_game", "cancel_game_request"]) {
    assert.equal(normalizeCommandMessage({
      v: 2,
      type: "command",
      id: action,
      action,
      payload: {},
    })?.action, action);
  }
});

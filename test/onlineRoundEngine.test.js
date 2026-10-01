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
import { buildReplayFrames } from "../src/game/replay.js";

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
    aiModelIds: { black: "b18", white: "b10" },
  }, 1_100).room;
  assert.equal(aiSnapshot.match.controllers.black.kind, "ai");
  assert.equal(aiSnapshot.match.controllers.white.kind, "ai");
  assert.equal(aiSnapshot.match.controllers.black.modelId, "b18");
  assert.equal(aiSnapshot.match.controllers.white.modelId, "b10");
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

test("online AI self-play directly undoes exactly one move at odd and even counts", () => {
  for (const handCount of [1, 2, 3]) {
    const room = createSetupRoom({ mainTimeSeconds: 30 });
    request(room, { mode: MATCH_MODE_AI_AI }, 1_100);
    let current = room.snapshot(1_100);
    for (let hand = 0; hand < handCount; hand += 1) {
      current = room.applyAction({
        playerId: "host",
        action: "ai_play",
        payload: {
          row: 0,
          col: hand,
          expectedMoveCount: current.moveCount,
          expectedPositionToken: current.positionToken,
        },
        now: 1_200 + hand * 100,
      }).room;
    }
    assert.throws(() => room.applyAction({
      playerId: "host",
      action: "direct_undo_ai_round",
      payload: {
        expectedMoveCount: current.moveCount,
        expectedPositionToken: current.positionToken,
      },
      now: 1_600,
    }), (error) => error instanceof RoomEngineError && error.code === "AI_NOT_ATTACHED");

    current = room.applyAction({
      playerId: "host",
      action: "set_ai_autoplay_paused",
      payload: {
        paused: true,
        expectedMoveCount: current.moveCount,
        expectedPositionToken: current.positionToken,
      },
      now: 1_650,
    }).room;

    const undone = room.applyAction({
      playerId: "host",
      action: "direct_undo_ai_move",
      payload: {
        expectedMoveCount: current.moveCount,
        expectedPositionToken: current.positionToken,
      },
      now: 1_700,
    });
    assert.equal(undone.move.type, "ai_move_undone");
    assert.equal(undone.room.moveCount, handCount - 1);
    assert.equal(undone.room.game.board[0][handCount - 1], null);
    assert.equal(undone.room.replay.events.length, handCount - 1);
    assert.equal(undone.room.timeControl.activeColor, null);
    assert.equal(undone.room.match.aiAutoplayPaused, true);
    const restored = RoomEngine.restore(room.serialize()).snapshot(1_800);
    assert.equal(restored.moveCount, handCount - 1);
    assert.deepEqual(restored.replay, undone.room.replay);
  }
});

test("online AI self-play pause is authoritative, timed, and survives recovery", () => {
  const room = createSetupRoom({ mainTimeSeconds: 30 });
  request(room, { mode: MATCH_MODE_AI_AI }, 1_100);
  const initial = room.snapshot(1_100);
  const first = room.applyAction({
    playerId: "host", action: "ai_play",
    payload: { row: 0, col: 0, expectedMoveCount: 0,
      expectedPositionToken: initial.positionToken }, now: 1_200,
  }).room;
  const second = room.applyAction({
    playerId: "host", action: "ai_play",
    payload: { row: 0, col: 1, expectedMoveCount: 1,
      expectedPositionToken: first.positionToken }, now: 1_300,
  }).room;
  assert.throws(() => room.applyAction({
    playerId: "host", action: "direct_undo_ai_move",
    payload: { expectedMoveCount: 2, expectedPositionToken: second.positionToken },
    now: 1_350,
  }), (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE");

  const paused = room.applyAction({
    playerId: "host", action: "set_ai_autoplay_paused",
    payload: { paused: true, expectedMoveCount: 2,
      expectedPositionToken: second.positionToken }, now: 1_400,
  }).room;
  assert.equal(paused.match.aiAutoplayPaused, true);
  assert.notEqual(paused.positionToken, second.positionToken);
  assert.equal(paused.timeControl.running, false);
  assert.equal(paused.timeControl.activeColor, null);
  assert.throws(() => room.applyAction({
    playerId: "host", action: "ai_play",
    payload: { row: 1, col: 1, expectedMoveCount: 2,
      expectedPositionToken: second.positionToken }, now: 1_500,
  }), (error) => error instanceof RoomEngineError && error.code === "AI_PAUSED");
  assert.throws(() => room.applyAction({
    playerId: "host", action: "set_ai_autoplay_paused",
    payload: { paused: true, expectedMoveCount: 2,
      expectedPositionToken: second.positionToken }, now: 1_550,
  }), (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE");

  room.advance(10_000);
  const stillPaused = RoomEngine.restore(room.serialize()).snapshot(10_001);
  assert.equal(stillPaused.match.aiAutoplayPaused, true);
  assert.equal(stillPaused.timeControl.running, false);
  assert.deepEqual(stillPaused.timeControl.players, paused.timeControl.players);
  const undone = room.applyAction({
    playerId: "host", action: "direct_undo_ai_move",
    payload: { expectedMoveCount: 2,
      expectedPositionToken: stillPaused.positionToken }, now: 10_100,
  }).room;
  assert.equal(undone.moveCount, 1);
  assert.equal(undone.game.currentPlayer, "white");
  assert.equal(undone.match.aiAutoplayPaused, true);
  assert.equal(undone.timeControl.running, false);
  assert.deepEqual(undone.timeControl.players, paused.timeControl.players);

  const resumed = room.applyAction({
    playerId: "host", action: "set_ai_autoplay_paused",
    payload: { paused: false, expectedMoveCount: 1,
      expectedPositionToken: undone.positionToken }, now: 10_200,
  }).room;
  assert.equal(resumed.match.aiAutoplayPaused, false);
  assert.equal(resumed.timeControl.activeColor, "white");
  assert.equal(resumed.timeControl.running, true);
  const whiteBefore = resumed.timeControl.players.white.mainTimeRemainingMs;
  const later = room.snapshot(11_200);
  assert.equal(later.timeControl.players.white.mainTimeRemainingMs, whiteBefore - 1_000);
  assert.equal(RoomEngine.restore(room.serialize()).snapshot(11_200).match.aiAutoplayPaused, false);

  const legacy = room.serialize();
  delete legacy.match.aiAutoplayPaused;
  assert.equal(RoomEngine.restore(legacy).snapshot(11_200).match.aiAutoplayPaused, false);
  legacy.match.aiAutoplayPaused = "true";
  assert.throws(() => RoomEngine.restore(legacy), {
    code: "BAD_ROOM_STATE",
  });
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

test("scoring, resignation, and timeout archives replay the public terminal frame", () => {
  const cases = [
    {
      name: "score",
      finish(room) {
        room.applyAction({ playerId: "host", action: "pass", now: 1_200 });
        room.applyAction({ playerId: "host", action: "pass", now: 1_300 });
        room.applyAction({
          playerId: "host", action: "finish_scoring",
          payload: { color: "black", expectedScoringToken: room.scoringToken() },
          now: 1_400,
        });
        return room.applyAction({
          playerId: "host", action: "finish_scoring",
          payload: { color: "white", expectedScoringToken: room.scoringToken() },
          now: 1_500,
        }).room;
      },
    },
    {
      name: "resign",
      finish(room) {
        room.applyAction({
          playerId: "host", action: "play", payload: { row: 0, col: 0 }, now: 1_200,
        });
        return room.applyAction({
          playerId: "host", action: "resign", payload: { color: "white" }, now: 1_300,
        }).room;
      },
    },
    {
      name: "timeout",
      finish(room) {
        return room.advance(4_100).room;
      },
    },
  ];

  for (const scenario of cases) {
    const room = createSetupRoom({ mainTimeSeconds: 3 });
    request(room, { mode: MATCH_MODE_LOCAL }, 1_100);
    const finished = scenario.finish(room);
    assert.equal(finished.match.status, MATCH_STATUS_FINISHED, scenario.name);
    const archive = request(room, { mode: MATCH_MODE_LOCAL }, 4_300).room.roundArchive.at(-1);
    assert.equal(archive.moveCount, finished.moveCount, scenario.name);
    assert.equal(
      buildReplayFrames(archive.replay).steps.length,
      archive.moveCount,
      scenario.name,
    );
    assert.deepEqual(
      buildReplayFrames(archive.replay).frames.at(-1),
      buildReplayFrames(finished.replay).frames.at(-1),
      scenario.name,
    );
    assert.deepEqual(
      RoomEngine.restore(room.serialize()).snapshot(4_301).roundArchive.at(-1).replay,
      archive.replay,
      scenario.name,
    );
  }
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

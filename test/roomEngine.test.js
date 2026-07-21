import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SPECTATORS,
  ROOM_TTL_MS,
  SPECTATOR_COMMAND_MEMBER_BURST,
  SPECTATOR_COMMAND_MEMBER_REFILL_MS,
  SPECTATOR_COMMAND_ROOM_BURST,
  SPECTATOR_COMMAND_ROOM_REFILL_MS,
  SPECTATOR_RECONNECT_GRACE_MS,
  SPECTATOR_RESERVATION_TTL_MS,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { CHAT_HISTORY_MAX_BYTES } from "../src/multiplayer/chat.js";
import { GoEngine } from "../src/game/goEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";

const BLACK_HASH = "a".repeat(64);
const WHITE_HASH = "b".repeat(64);
const VIEWER_HASH = "c".repeat(64);

function spectatorHash(index) {
  return index.toString(16).padStart(64, "0");
}

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

function attachAI(room, now = 2_000, modelId = "b10") {
  return room.applyAction({
    playerId: "black-player",
    action: "attach_ai",
    payload: { modelId },
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

test("host attaches a rollback-compatible AI white seat and human joins become spectators", () => {
  const room = createRoom();
  const attached = attachAI(room, 1_200, "b18").room;
  assert.match(attached.positionToken, /^pos-v1-[a-f0-9]{16}-[a-z0-9]+$/u);
  assert.deepEqual(attached.players.map((player) => ({
    role: player.role,
    color: player.color,
    automated: player.automated ?? false,
    modelId: player.modelId ?? null,
    controllerId: player.controllerId ?? null,
  })), [
    {
      role: "player",
      color: "black",
      automated: false,
      modelId: null,
      controllerId: null,
    },
    {
      role: "ai",
      color: "white",
      automated: true,
      modelId: "b18",
      controllerId: "black-player",
    },
  ]);

  const persistedAI = room.serialize().members.find(
    (member) => member.automated === true,
  );
  assert.equal(persistedAI.role, "player");
  assert.equal(persistedAI.color, "white");
  assert.match(persistedAI.tokenHash, /^[a-f0-9]{64}$/u);
  assert.equal(persistedAI.modelId, "b18");
  assert.equal(persistedAI.controllerId, "black-player");

  const lateHuman = room.join({
    name: "Late human",
    role: "player",
    playerId: "late-human",
    tokenHash: WHITE_HASH,
    now: 1_300,
  });
  assert.equal(lateHuman.identity.role, "spectator");
  assert.equal(lateHuman.identity.color, null);
  assert.notEqual(lateHuman.room.revision, attached.revision);
  assert.equal(lateHuman.room.positionToken, attached.positionToken);

  const restored = RoomEngine.restore(room.serialize()).snapshot(1_400);
  assert.equal(restored.players.find((player) => player.role === "ai")?.modelId, "b18");

  const fresh = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 13 },
    now: 1_500,
  }).room;
  assert.equal(fresh.players.find((player) => player.role === "ai")?.modelId, "b18");
  assert.equal(fresh.game.width, 13);

  const detached = room.applyAction({
    playerId: "black-player",
    action: "detach_ai",
    now: 1_600,
  }).room;
  assert.equal(detached.players.some((player) => player.role === "ai"), false);
});

test("only the black host can attach AI and a human white seat cannot be replaced", () => {
  const room = createRoom();
  room.join({
    name: "Viewer",
    role: "spectator",
    playerId: "viewer",
    tokenHash: VIEWER_HASH,
    now: 1_100,
  });
  assert.throws(
    () => room.applyAction({
      playerId: "viewer",
      action: "attach_ai",
      payload: { modelId: "b10" },
      now: 1_200,
    }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "attach_ai",
      payload: { modelId: "unknown" },
      now: 1_201,
    }),
    (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
  );

  joinWhite(room, 1_300);
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "attach_ai",
      payload: { modelId: "b10" },
      now: 1_400,
    }),
    (error) =>
      error instanceof RoomEngineError && error.code === "AI_SEAT_UNAVAILABLE",
  );
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

test("host proxies only fresh legal moves for the automated white turn", () => {
  const room = createRoom();
  const initial = attachAI(room, 1_100).room;

  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "ai_pass",
      payload: {
        expectedMoveCount: initial.moveCount,
        expectedPositionToken: initial.positionToken,
      },
      now: 1_200,
    }),
    (error) => error instanceof RoomEngineError && error.code === "NOT_AI_TURN",
  );

  const black = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 0, col: 0 },
    now: 1_300,
  }).room;
  const white = room.applyAction({
    playerId: "black-player",
    action: "ai_play",
    payload: {
      row: 0,
      col: 1,
      expectedMoveCount: black.moveCount,
      expectedPositionToken: black.positionToken,
    },
    now: 1_400,
  }).room;
  assert.equal(white.game.board[0][1], "white");
  assert.equal(white.moveCount, 2);
  assert.equal(white.game.currentPlayer, "black");
  assert.notEqual(white.positionToken, black.positionToken);

  const beforeStale = room.serialize();
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "ai_play",
      payload: {
        row: 0,
        col: 2,
        expectedMoveCount: black.moveCount,
        expectedPositionToken: black.positionToken,
      },
      now: 1_500,
    }),
    (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
  );
  assert.deepEqual(room.serialize(), beforeStale);

  const automatedId = room.serialize().members.find(
    (member) => member.automated === true,
  ).playerId;
  assert.throws(
    () => room.applyAction({
      playerId: automatedId,
      action: "pass",
      now: 1_600,
    }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );
});

test("updating the online AI model invalidates an in-flight response", () => {
  const room = createRoom();
  attachAI(room, 1_100, "b10");
  const thinking = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 1_200,
  }).room;

  const updated = room.applyAction({
    playerId: "black-player",
    action: "attach_ai",
    payload: { modelId: "b18" },
    now: 1_300,
  });
  assert.equal(updated.move.type, "ai_updated");
  assert.equal(updated.move.previousModelId, "b10");
  assert.equal(updated.room.players.filter((player) => player.role === "ai").length, 1);
  assert.equal(
    updated.room.players.find((player) => player.role === "ai")?.modelId,
    "b18",
  );
  assert.notEqual(updated.room.positionToken, thinking.positionToken);

  const beforeStale = room.serialize();
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "ai_play",
      payload: {
        row: 4,
        col: 5,
        expectedMoveCount: thinking.moveCount,
        expectedPositionToken: thinking.positionToken,
      },
      now: 1_400,
    }),
    (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
  );
  assert.deepEqual(room.serialize(), beforeStale);

  const accepted = room.applyAction({
    playerId: "black-player",
    action: "ai_play",
    payload: {
      row: 4,
      col: 5,
      expectedMoveCount: updated.room.moveCount,
      expectedPositionToken: updated.room.positionToken,
    },
    now: 1_500,
  }).room;
  assert.equal(accepted.game.board[4][5], "white");
});

test("starting an equivalent new game invalidates the previous AI response", () => {
  const room = createRoom();
  attachAI(room, 1_100, "b10");
  const oldThinking = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 3, col: 3 },
    now: 1_200,
  }).room;

  room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 9, komi: 50, scoringRule: "chinese" },
    now: 1_300,
  });
  const newThinking = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 3, col: 3 },
    now: 1_400,
  }).room;
  assert.equal(newThinking.moveCount, oldThinking.moveCount);
  assert.notEqual(newThinking.positionToken, oldThinking.positionToken);

  const beforeStale = room.serialize();
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "ai_play",
      payload: {
        row: 3,
        col: 4,
        expectedMoveCount: oldThinking.moveCount,
        expectedPositionToken: oldThinking.positionToken,
      },
      now: 1_500,
    }),
    (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
  );
  assert.deepEqual(room.serialize(), beforeStale);
});

test("AI pass uses the same stale-position guard and enters scoring", () => {
  const room = createRoom();
  attachAI(room, 1_100);
  const blackPass = room.applyAction({
    playerId: "black-player",
    action: "pass",
    now: 1_200,
  }).room;

  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "ai_pass",
      payload: {
        expectedMoveCount: blackPass.moveCount + 1,
        expectedPositionToken: blackPass.positionToken,
      },
      now: 1_300,
    }),
    (error) => error instanceof RoomEngineError && error.code === "STALE_GAME_STATE",
  );

  const scoring = room.applyAction({
    playerId: "black-player",
    action: "ai_pass",
    payload: {
      expectedMoveCount: blackPass.moveCount,
      expectedPositionToken: blackPass.positionToken,
    },
    now: 1_400,
  }).room;
  assert.equal(scoring.game.phase, "scoring");
  assert.equal(scoring.moveCount, 2);

  const finished = room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 1_500,
  }).room;
  assert.equal(finished.game.phase, "finished");
  assert.deepEqual(finished.scoreConfirmations.sort(), ["black", "white"]);
});

test("direct AI undo returns to the human's previous decision point", () => {
  const room = createRoom();
  attachAI(room, 1_100);
  const afterBlack = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 1_200,
  }).room;
  const afterAI = room.applyAction({
    playerId: "black-player",
    action: "ai_play",
    payload: {
      row: 4,
      col: 5,
      expectedMoveCount: afterBlack.moveCount,
      expectedPositionToken: afterBlack.positionToken,
    },
    now: 1_300,
  }).room;

  const fullRound = room.applyAction({
    playerId: "black-player",
    action: "direct_undo_ai_round",
    payload: {
      expectedMoveCount: afterAI.moveCount,
      expectedPositionToken: afterAI.positionToken,
    },
    now: 1_400,
  });
  assert.equal(fullRound.move.undoneCount, 2);
  assert.deepEqual(fullRound.move.undoneMoves.map((move) => move.color), [
    "white",
    "black",
  ]);
  assert.equal(fullRound.room.moveCount, 0);
  assert.equal(fullRound.room.game.currentPlayer, "black");
  assert.equal(fullRound.room.game.board[4][4], null);
  assert.equal(fullRound.room.game.board[4][5], null);

  const humanOnly = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 2, col: 2 },
    now: 1_500,
  }).room;
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "request_undo",
      payload: { expectedMoveCount: humanOnly.moveCount },
      now: 1_550,
    }),
    (error) => error instanceof RoomEngineError && error.code === "AI_UNDO_IS_DIRECT",
  );
  const oneMove = room.applyAction({
    playerId: "black-player",
    action: "direct_undo_ai_round",
    payload: {
      expectedMoveCount: humanOnly.moveCount,
      expectedPositionToken: humanOnly.positionToken,
    },
    now: 1_600,
  });
  assert.equal(oneMove.move.undoneCount, 1);
  assert.equal(oneMove.move.undoneMoves[0].color, "black");
  assert.equal(oneMove.room.game.currentPlayer, "black");
  assert.equal(oneMove.room.moveCount, 0);
});

test("direct AI undo cannot reopen scoring or a finished result", () => {
  const room = createRoom();
  attachAI(room, 1_100);
  const blackPass = room.applyAction({
    playerId: "black-player",
    action: "pass",
    now: 1_200,
  }).room;
  const scoring = room.applyAction({
    playerId: "black-player",
    action: "ai_pass",
    payload: {
      expectedMoveCount: blackPass.moveCount,
      expectedPositionToken: blackPass.positionToken,
    },
    now: 1_300,
  }).room;
  assert.equal(scoring.game.phase, "scoring");
  assert.equal(scoring.undoAvailable, false);
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "direct_undo_ai_round",
      payload: {
        expectedMoveCount: scoring.moveCount,
        expectedPositionToken: scoring.positionToken,
      },
      now: 1_400,
    }),
    (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );

  const finished = room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 1_500,
  }).room;
  assert.equal(finished.game.phase, "finished");
  assert.equal(finished.undoAvailable, false);
  const beforeFinishedUndo = room.serialize();
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "direct_undo_ai_round",
      payload: {
        expectedMoveCount: finished.moveCount,
        expectedPositionToken: finished.positionToken,
      },
      now: 1_600,
    }),
    (error) => error instanceof RoomEngineError && error.code === "UNDO_UNAVAILABLE",
  );
  assert.deepEqual(room.serialize(), beforeFinishedUndo);
});

test("either player may resign immediately while spectators remain read-only", () => {
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
    () => room.applyAction({ playerId: "viewer", action: "resign", now: 2_200 }),
    (error) => error instanceof RoomEngineError && error.code === "FORBIDDEN",
  );

  const result = room.applyAction({
    playerId: "white-player",
    action: "resign",
    now: 2_300,
  });
  assert.equal(result.move.type, "resign");
  assert.equal(result.move.color, "white");
  assert.equal(result.room.game.phase, "finished");
  assert.deepEqual(result.room.game.result, {
    winner: "black",
    loser: "white",
    margin: 0,
    reason: "resign",
    resignation: true,
  });
  assert.equal(result.room.undoAvailable, false);
  const replayFinal = buildReplayFrames(result.room.replay).frames.at(-1);
  for (const field of [
    "board",
    "currentPlayer",
    "phase",
    "consecutivePasses",
    "captures",
    "deadStones",
    "lastMove",
    "result",
  ]) {
    assert.deepEqual(replayFinal[field], result.room.game[field]);
  }

  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "play",
      payload: { row: 0, col: 0 },
      now: 2_400,
    }),
    (error) => error instanceof RoomEngineError && error.code === "GAME_FINISHED",
  );

  room.join({
    name: "Late viewer",
    role: "spectator",
    playerId: "late-viewer",
    tokenHash: "d".repeat(64),
    now: 2_450,
  });

  const restored = RoomEngine.restore(room.serialize()).snapshot(2_500);
  assert.deepEqual(restored.game.result, result.room.game.result);
  assert.deepEqual(restored.replay.outcome, {
    winner: "black",
    loser: "white",
    margin: 0,
    reason: "resign",
    resignation: true,
  });

  // The stored GoEngine remains readable by rc.2: resignation metadata is an
  // optional room field and the compatible engine position is already terminal.
  const serialized = room.serialize();
  assert.equal(
    serialized.resignationOutcome.roomRevision,
    serialized.revision,
  );
  const legacyCompatibleGame = GoEngine.fromState(serialized.game);
  assert.equal(legacyCompatibleGame.phase, "finished");
  assert.notEqual(legacyCompatibleGame.result?.reason, "resign");
  assert.equal(
    serialized.game.replay.events.some((event) => event.type === "resign"),
    false,
  );

  const rollbackNewGame = structuredClone(serialized);
  rollbackNewGame.game = new GoEngine({ size: 9 }).exportState();
  const migrated = RoomEngine.restore(rollbackNewGame).snapshot(2_600);
  assert.equal(migrated.game.phase, "play");
  assert.equal(migrated.game.result, null);
  assert.equal(migrated.replay.outcome, undefined);

  const rollbackScoringGame = new GoEngine({ size: 13 });
  rollbackScoringGame.pass();
  rollbackScoringGame.pass();
  const rollbackScoring = structuredClone(serialized);
  rollbackScoring.game = rollbackScoringGame.exportState();
  rollbackScoring.moveCount = 2;
  rollbackScoring.revision += 3;
  const migratedScoring = RoomEngine.restore(rollbackScoring).snapshot(2_601);
  assert.equal(migratedScoring.game.phase, "scoring");
  assert.equal(migratedScoring.game.width, 13);
  assert.equal(migratedScoring.game.result, null);
  assert.equal(migratedScoring.replay.outcome, undefined);

  rollbackScoringGame.finishScoring();
  const rollbackFinished = structuredClone(serialized);
  rollbackFinished.game = rollbackScoringGame.exportState();
  rollbackFinished.moveCount = 2;
  rollbackFinished.revision += 4;
  const migratedFinished = RoomEngine.restore(rollbackFinished).snapshot(2_602);
  assert.equal(migratedFinished.game.phase, "finished");
  assert.equal(migratedFinished.game.width, 13);
  assert.notEqual(migratedFinished.game.result?.reason, "resign");
  assert.equal(migratedFinished.replay.outcome, undefined);

  // rc.2 preserves unknown room fields. If it starts an equivalent empty game,
  // two real passes plus scoring can recreate the exact synthetic GoEngine
  // terminal used for resignation compatibility. Its room revision still
  // advances, so the stale resignation result must not be overlaid.
  const rollbackSameTerminalGame = new GoEngine({
    size: 9,
    komi: serialized.game.komi,
    scoringRule: serialized.game.scoringRule,
    topology: serialized.game.topology,
  });
  rollbackSameTerminalGame.pass();
  rollbackSameTerminalGame.pass();
  const naturalFinish = rollbackSameTerminalGame.finishScoring();
  assert.equal(naturalFinish.winner, "white");
  assert.deepEqual(rollbackSameTerminalGame.exportState(), serialized.game);
  const rollbackSameTerminal = structuredClone(serialized);
  rollbackSameTerminal.game = rollbackSameTerminalGame.exportState();
  rollbackSameTerminal.moveCount = 2;
  rollbackSameTerminal.scoreConfirmations = ["black", "white"];
  rollbackSameTerminal.revision += 5;
  const migratedSameTerminal = RoomEngine.restore(rollbackSameTerminal).snapshot(2_603);
  assert.equal(migratedSameTerminal.game.phase, "finished");
  assert.equal(migratedSameTerminal.game.result.reason, undefined);
  assert.equal(migratedSameTerminal.game.result.winner, "white");
  assert.equal(migratedSameTerminal.replay.outcome, undefined);
  assert.equal(migratedSameTerminal.replay.events.length, 3);

  const newGame = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 9 },
    now: 2_700,
  }).room;
  assert.equal(newGame.game.phase, "play");
  assert.equal(newGame.game.result, null);
  assert.equal(newGame.replay.outcome, undefined);
});

test("resignation is rejected after play has entered scoring or finished", () => {
  const room = createRoom();
  joinWhite(room);
  enterScoring(room, 2_100);
  assert.throws(
    () => room.applyAction({
      playerId: "black-player",
      action: "resign",
      now: 2_200,
    }),
    (error) => error instanceof RoomEngineError && error.code === "ILLEGAL_MOVE",
  );

  room.applyAction({
    playerId: "black-player",
    action: "finish_scoring",
    now: 2_300,
  });
  room.applyAction({
    playerId: "white-player",
    action: "finish_scoring",
    now: 2_400,
  });
  assert.equal(room.snapshot(2_401).game.phase, "finished");
  assert.throws(
    () => room.applyAction({
      playerId: "white-player",
      action: "resign",
      now: 2_500,
    }),
    (error) => error instanceof RoomEngineError && error.code === "ILLEGAL_MOVE",
  );
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

test("creates, serializes and restores a Mobius room", () => {
  const room = RoomEngine.create({
    code: "MAB234",
    name: "莫比乌斯黑方",
    size: 9,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "mobius",
    playerId: "mobius-black",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });

  const snapshot = room.snapshot(1_001);
  assert.equal(snapshot.game.topology, "mobius");
  assert.ok(
    room.game.neighbors(1, 0).some(
      (point) => point.row === 7 && point.col === 8,
    ),
  );
  const serialized = room.serialize();
  assert.equal(serialized.game.topology, "mobius");
  const restored = RoomEngine.restore(serialized);
  assert.equal(restored.snapshot(1_002).game.topology, "mobius");
  assert.ok(
    restored.game.neighbors(1, 0).some(
      (point) => point.row === 7 && point.col === 8,
    ),
  );
});

test("authoritative Mobius rooms capture across the reversed seam", () => {
  const room = RoomEngine.create({
    code: "MBS234",
    name: "莫比乌斯黑方",
    size: 5,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "mobius",
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 1_100);

  const moves = [
    ["black-player", 0, 0],
    ["white-player", 1, 0],
    ["black-player", 2, 0],
    ["white-player", 4, 2],
    ["black-player", 1, 1],
    ["white-player", 4, 3],
    ["black-player", 3, 4],
  ];
  let result;
  for (let index = 0; index < moves.length; index += 1) {
    const [playerId, row, col] = moves[index];
    result = room.applyAction({
      playerId,
      action: "play",
      payload: { row, col },
      now: 2_000 + index,
    });
  }

  assert.deepEqual(result.move.captured, [{ row: 1, col: 0 }]);
  assert.equal(result.room.game.board[1][0], null);
  assert.equal(result.room.game.board[3][4], "black");
  assert.equal(result.room.game.captures.black, 1);
  assert.deepEqual(result.room.game.lastMove.captured, [
    { row: 1, col: 0 },
  ]);
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

test("rectangular rooms create, persist, play and start another rectangular game", () => {
  const room = RoomEngine.create({
    code: "REC234",
    name: "黑方",
    width: 13,
    height: 9,
    topology: "torus",
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 1_100);
  const played = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 8, col: 12 },
    now: 1_200,
  });
  assert.equal(played.room.game.width, 13);
  assert.equal(played.room.game.height, 9);
  assert.equal("size" in played.room.game, false);
  assert.equal(played.room.game.board.length, 9);
  assert.equal(played.room.game.board[0].length, 13);

  const restored = RoomEngine.restore(room.serialize());
  assert.equal(restored.snapshot(1_300).game.board[8][12], "black");
  const fresh = restored.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { width: 9, height: 13, topology: "mobius" },
    now: 1_400,
  });
  assert.equal(fresh.room.game.width, 9);
  assert.equal(fresh.room.game.height, 13);
  assert.equal(fresh.room.game.topology, "mobius");
});

test("online rooms accept and persist 30x20 games without square aliases", () => {
  const room = RoomEngine.create({
    code: "MAX23A",
    name: "黑方",
    width: 30,
    height: 20,
    topology: "torus",
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 1_100);
  const played = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 19, col: 29 },
    now: 1_200,
  });
  assert.equal(played.room.game.width, 30);
  assert.equal(played.room.game.height, 20);
  assert.equal("size" in played.room.game, false);
  assert.equal(played.room.game.board[19][29], "black");

  const restored = RoomEngine.restore(room.serialize());
  assert.equal(restored.snapshot(1_300).game.board[19][29], "black");
  const fresh = restored.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { width: 20, height: 30, topology: "mobius" },
    now: 1_400,
  });
  assert.equal(fresh.room.game.width, 20);
  assert.equal(fresh.room.game.height, 30);
  assert.equal(fresh.room.game.board.length, 30);
  assert.equal(fresh.room.game.board[0].length, 20);

  assert.throws(
    () =>
      restored.applyAction({
        playerId: "black-player",
        action: "new_game",
        payload: { width: 31, height: 20 },
        now: 1_500,
      }),
    (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
  );
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

  const mobius = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { topology: "mobius" },
    now: 3_050,
  });
  assert.equal(mobius.room.game.topology, "mobius");

  const preserved = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 13 },
    now: 3_100,
  });
  assert.equal(preserved.room.game.topology, "mobius");

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
  assert.equal(room.snapshot(3_201).game.topology, "mobius");
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

test("rectangular room chat survives snapshots and persistence with both dimensions", () => {
  const room = RoomEngine.create({
    code: "CHT234",
    name: "黑方",
    width: 13,
    height: 9,
    topology: "torus",
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 1_100);

  const posted = room.postChat({
    playerId: "black-player",
    sequence: 1,
    payload: { kind: "text", text: "看 M9 和 A1" },
    now: 2_000,
  });

  assert.equal(posted.message.boardWidth, 13);
  assert.equal(posted.message.boardHeight, 9);
  assert.equal("boardSize" in posted.message, false);
  assert.deepEqual(posted.message.points, [
    { row: 0, col: 11, label: "M9" },
    { row: 8, col: 0, label: "A1" },
  ]);

  const snapshot = room.snapshot(2_001);
  assert.equal(snapshot.chat.messages.length, 1);
  assert.equal(snapshot.chat.messages[0].boardWidth, 13);
  assert.equal(snapshot.chat.messages[0].boardHeight, 9);

  const restored = RoomEngine.restore(room.serialize()).snapshot(2_002);
  assert.deepEqual(restored.chat.messages, snapshot.chat.messages);
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

test("legacy and default rooms remain untimed", () => {
  const room = createRoom(1_000);
  assert.equal(room.snapshot(1_001).timeControl, null);

  const legacy = room.serialize();
  delete legacy.timeControl;
  const restored = RoomEngine.restore(legacy);
  assert.equal(restored.snapshot(1_002).timeControl, null);
  assert.equal(restored.nextDueAt(), restored.state.expiresAt);
});

test("an authoritative clock waits for both seats, deducts the mover, and survives restoration", () => {
  const room = RoomEngine.create({
    code: "CLK234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 10,
    byoYomiPeriods: 3,
    byoYomiSeconds: 5,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  assert.equal(room.snapshot(1_500).timeControl.running, false);

  joinWhite(room, 2_000);
  const started = room.snapshot(2_000).timeControl;
  assert.equal(started.activeColor, "black");
  assert.equal(started.serverNow, 2_000);
  assert.equal(started.turnDeadlineAt, 27_000);
  assert.equal(room.nextDueAt(), 27_000);

  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 8_000,
  });
  const switched = room.snapshot(8_000).timeControl;
  assert.equal(switched.players.black.mainTimeRemainingMs, 4_000);
  assert.equal(switched.activeColor, "white");
  assert.equal(switched.players.white.mainTimeRemainingMs, 10_000);

  const restored = RoomEngine.restore(room.serialize());
  const projected = restored.snapshot(11_000).timeControl;
  assert.equal(projected.activeColor, "white");
  assert.equal(projected.players.white.mainTimeRemainingMs, 7_000);
  assert.equal(restored.nextDueAt(), 33_000);
});

test("AI seats start the room clock and direct undo safely retargets it to the human", () => {
  const room = RoomEngine.create({
    code: "KAT234",
    name: "Black",
    size: 9,
    mainTimeSeconds: 20,
    byoYomiPeriods: 1,
    byoYomiSeconds: 5,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  const attached = attachAI(room, 2_000).room;
  assert.equal(attached.timeControl.running, true);
  assert.equal(attached.timeControl.activeColor, "black");

  const black = room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 3, col: 3 },
    now: 3_000,
  }).room;
  assert.equal(black.timeControl.activeColor, "white");
  const white = room.applyAction({
    playerId: "black-player",
    action: "ai_play",
    payload: {
      row: 3,
      col: 4,
      expectedMoveCount: black.moveCount,
      expectedPositionToken: black.positionToken,
    },
    now: 4_000,
  }).room;
  assert.equal(white.timeControl.activeColor, "black");

  const undone = room.applyAction({
    playerId: "black-player",
    action: "direct_undo_ai_round",
    payload: {
      expectedMoveCount: white.moveCount,
      expectedPositionToken: white.positionToken,
    },
    now: 5_000,
  }).room;
  assert.equal(undone.moveCount, 0);
  assert.equal(undone.game.currentPlayer, "black");
  assert.equal(undone.timeControl.running, true);
  assert.equal(undone.timeControl.activeColor, "black");
  assert.equal(undone.timeControl.turnDeadlineAt, 28_000);
  const detached = room.applyAction({
    playerId: "black-player",
    action: "detach_ai",
    now: 6_000,
  }).room;
  assert.equal(detached.timeControl.running, false);
  assert.equal(detached.timeControl.activeColor, null);
  assert.equal(detached.players.some((player) => player.role === "ai"), false);
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
});

test("resignation clears a pending undo and permanently stops the room clock", () => {
  const room = RoomEngine.create({
    code: "RSG234",
    name: "Black",
    size: 9,
    mainTimeSeconds: 20,
    byoYomiPeriods: 1,
    byoYomiSeconds: 5,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 3_000,
  });
  room.applyAction({
    playerId: "white-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 4_000,
  });

  const resigned = room.applyAction({
    playerId: "white-player",
    action: "resign",
    now: 5_000,
  }).room;
  assert.equal(resigned.undoRequest, null);
  assert.equal(resigned.game.result.reason, "resign");
  assert.equal(resigned.timeControl.running, false);
  assert.equal(resigned.timeControl.activeColor, null);
  assert.equal(resigned.timeControl.turnDeadlineAt, null);
  assert.equal(room.timeControlDueAt(), null);

  const muchLater = room.snapshot(50_000);
  assert.deepEqual(muchLater.timeControl.players, resigned.timeControl.players);
});

test("server time wins races at the exact deadline and rejects all later moves", () => {
  const room = RoomEngine.create({
    code: "FLG234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 0,
    byoYomiPeriods: 2,
    byoYomiSeconds: 5,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  assert.equal(room.timeControlDueAt(), 12_000);
  assert.equal(room.advance(11_999).changed, false);

  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "play",
        payload: { row: 0, col: 0 },
        now: 12_000,
      }),
    (error) => error instanceof RoomEngineError && error.code === "GAME_TIMED_OUT",
  );
  assert.equal(room.game.get(0, 0), null);
  const snapshot = room.snapshot(12_001);
  assert.equal(snapshot.game.phase, "finished");
  assert.deepEqual(snapshot.game.result, {
    winner: "white",
    loser: "black",
    margin: 0,
    reason: "timeout",
    finishedAt: 12_000,
  });
  assert.equal(snapshot.timeControl.running, false);
  assert.equal(snapshot.timeControl.outcome.winner, "white");
  assert.equal(room.timeControlDueAt(), null);
  assert.ok(room.nextDueAt() > 12_000);

  assert.throws(
    () =>
      room.applyAction({
        playerId: "white-player",
        action: "pass",
        now: 12_100,
      }),
    (error) => error instanceof RoomEngineError && error.code === "GAME_TIMED_OUT",
  );
});

test("advance materializes an alarm timeout and keeps the room TTL scheduled", () => {
  const room = RoomEngine.create({
    code: "ALM234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 3,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  const revision = room.snapshot(2_000).revision;
  const advanced = room.advance(5_000);
  assert.equal(advanced.changed, true);
  assert.equal(advanced.expired, false);
  assert.equal(advanced.timedOut, true);
  assert.equal(advanced.revision, revision + 1);
  assert.equal(advanced.room.timeControl.outcome.winner, "white");
  assert.equal(advanced.nextDueAt, room.state.expiresAt);
  assert.equal(advanced.nextDueAt, 5_000 + ROOM_TTL_MS);
  const restored = RoomEngine.restore(room.serialize()).snapshot(5_001);
  assert.equal(restored.game.phase, "finished");
  assert.equal(restored.timeControl.outcome.finishedAt, 5_000);
});

test("invalid clock settings are transactional and corrupted clock persistence is rejected", () => {
  const room = RoomEngine.create({
    code: "BAD234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 10,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  const before = room.serialize();
  assert.throws(
    () =>
      room.applyAction({
        playerId: "black-player",
        action: "new_game",
        payload: { size: 13, byoYomiPeriods: 2, byoYomiSeconds: 0 },
        now: 3_000,
      }),
    (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
  );
  assert.deepEqual(room.serialize(), before);

  const corrupted = structuredClone(before);
  corrupted.timeControl.players.black.mainTimeRemainingMs = -1;
  assert.throws(
    () => RoomEngine.restore(corrupted),
    (error) => error instanceof RoomEngineError && error.code === "BAD_ROOM_STATE",
  );
});

test("clocks pause outside play and a new game can replace or disable its settings", () => {
  const room = RoomEngine.create({
    code: "PAU234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 20,
    byoYomiPeriods: 1,
    byoYomiSeconds: 5,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  room.applyAction({ playerId: "black-player", action: "pass", now: 3_000 });
  room.applyAction({ playerId: "white-player", action: "pass", now: 4_000 });
  const scoring = room.snapshot(4_000).timeControl;
  assert.equal(room.game.phase, "scoring");
  assert.equal(scoring.running, false);
  assert.equal(scoring.players.black.mainTimeRemainingMs, 19_000);
  assert.equal(scoring.players.white.mainTimeRemainingMs, 19_000);
  assert.equal(room.timeControlDueAt(), null);
  assert.equal(room.snapshot(40_000).timeControl.players.white.mainTimeRemainingMs, 19_000);

  room.applyAction({ playerId: "black-player", action: "resume_play", now: 40_000 });
  assert.equal(room.snapshot(41_000).timeControl.running, true);

  const fresh = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: {
      mainTimeSeconds: 0,
      byoYomiPeriods: 3,
      byoYomiSeconds: 10,
    },
    now: 42_000,
  });
  assert.equal(fresh.room.timeControl.mainTimeSeconds, 0);
  assert.equal(fresh.room.timeControl.byoYomiPeriods, 3);
  assert.equal(fresh.room.timeControl.activeColor, "black");
  assert.equal(fresh.room.timeControl.turnDeadlineAt, 72_000);

  const untimed = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: {
      mainTimeSeconds: 0,
      byoYomiPeriods: 0,
      byoYomiSeconds: 0,
    },
    now: 43_000,
  });
  assert.equal(untimed.room.timeControl, null);
});

test("pending undo pauses the current clock without refunding elapsed time", () => {
  const room = RoomEngine.create({
    code: "UND234",
    name: "黑方",
    size: 9,
    mainTimeSeconds: 30,
    playerId: "black-player",
    tokenHash: BLACK_HASH,
    now: 1_000,
  });
  joinWhite(room, 2_000);
  room.applyAction({
    playerId: "black-player",
    action: "play",
    payload: { row: 4, col: 4 },
    now: 3_000,
  });
  room.applyAction({
    playerId: "black-player",
    action: "request_undo",
    payload: { expectedMoveCount: 1 },
    now: 8_000,
  });
  const paused = room.snapshot(20_000);
  assert.equal(paused.timeControl.running, false);
  assert.equal(paused.timeControl.players.white.mainTimeRemainingMs, 25_000);

  room.applyAction({
    playerId: "white-player",
    action: "respond_undo",
    payload: {
      accept: false,
      targetMoveCount: 1,
      requestRevision: paused.undoRequest.requestRevision,
    },
    now: 20_000,
  });
  const resumed = room.snapshot(21_000).timeControl;
  assert.equal(resumed.activeColor, "white");
  assert.equal(resumed.players.white.mainTimeRemainingMs, 24_000);
});

test("abandoned spectator reservations expire and cannot permanently fill a room", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  const reservedAt = 2_000;

  for (let index = 0; index < MAX_SPECTATORS; index += 1) {
    room.join({
      name: `Viewer ${index}`,
      role: "spectator",
      playerId: `reserved-viewer-${index}`,
      tokenHash: spectatorHash(index),
      now: reservedAt,
    });
  }
  assert.equal(room.spectatorCount(), MAX_SPECTATORS);
  assert.equal(room.nextDueAt(), reservedAt + SPECTATOR_RESERVATION_TTL_MS);
  assert.throws(
    () =>
      room.join({
        name: "Too early",
        role: "spectator",
        playerId: "early-viewer",
        tokenHash: "d".repeat(64),
        now: reservedAt + SPECTATOR_RESERVATION_TTL_MS - 1,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "SPECTATOR_FULL",
  );

  const replacement = room.join({
    name: "Replacement",
    role: "spectator",
    playerId: "replacement-viewer",
    tokenHash: "e".repeat(64),
    now: reservedAt + SPECTATOR_RESERVATION_TTL_MS,
  });
  assert.equal(replacement.identity.role, "spectator");
  assert.equal(room.spectatorCount(), 1);
  assert.deepEqual(
    room.snapshot(reservedAt + SPECTATOR_RESERVATION_TTL_MS).players.map(
      (player) => player.color,
    ),
    ["black", "white"],
  );
});

test("connected spectators are protected and get a bounded reconnect grace", () => {
  const room = createRoom(1_000);
  joinWhite(room, 1_100);
  room.join({
    name: "Connected viewer",
    role: "spectator",
    playerId: "connected-viewer",
    tokenHash: VIEWER_HASH,
    now: 2_000,
  });
  room.resumeConnection("connected-viewer", "viewer-socket", 2_500);

  const hibernated = RoomEngine.restore(room.serialize());
  const wakeAt = 2_500 + SPECTATOR_RECONNECT_GRACE_MS + 1;
  hibernated.resumeConnection("connected-viewer", "restored-viewer-socket", wakeAt);
  assert.equal(hibernated.advance(wakeAt).evictedSpectators, undefined);
  assert.equal(hibernated.spectatorCount(), 1);

  const wellPastReservation = 2_000 + SPECTATOR_RESERVATION_TTL_MS * 3;
  assert.equal(room.advance(wellPastReservation).evictedSpectators, undefined);
  assert.equal(room.spectatorCount(), 1);

  room.disconnect({ connectionId: "viewer-socket", now: wellPastReservation });
  assert.equal(
    room.nextDueAt(),
    wellPastReservation + SPECTATOR_RECONNECT_GRACE_MS,
  );
  assert.equal(
    room.advance(
      wellPastReservation + SPECTATOR_RECONNECT_GRACE_MS - 1,
    ).changed,
    false,
  );
  const evicted = room.advance(
    wellPastReservation + SPECTATOR_RECONNECT_GRACE_MS,
  );
  assert.equal(evicted.evictedSpectators, 1);
  assert.equal(room.spectatorCount(), 0);
  assert.equal(room.snapshot(wellPastReservation + SPECTATOR_RECONNECT_GRACE_MS).players.length, 2);
});

test("spectator command budgets are persistent, bounded and do not affect players", () => {
  const room = createRoom(1_000);
  room.join({
    name: "Viewer",
    role: "spectator",
    playerId: "rate-viewer",
    tokenHash: VIEWER_HASH,
    now: 2_000,
  });

  for (let index = 0; index < SPECTATOR_COMMAND_MEMBER_BURST; index += 1) {
    room.enforceSpectatorCommandRateLimit({
      playerId: "rate-viewer",
      action: "sync",
      now: 2_100,
    });
  }
  assert.throws(
    () =>
      room.enforceSpectatorCommandRateLimit({
        playerId: "rate-viewer",
        action: "sync",
        now: 2_100,
      }),
    (error) =>
      error instanceof RoomEngineError &&
      error.code === "SPECTATOR_RATE_LIMITED" &&
      error.retryable,
  );

  const restored = RoomEngine.restore(room.serialize());
  assert.throws(
    () =>
      restored.enforceSpectatorCommandRateLimit({
        playerId: "rate-viewer",
        action: "sync",
        now: 2_100,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "SPECTATOR_RATE_LIMITED",
  );
  restored.enforceSpectatorCommandRateLimit({
    playerId: "rate-viewer",
    action: "sync",
    now: 2_100 + SPECTATOR_COMMAND_MEMBER_REFILL_MS,
  });

  for (let index = 0; index < 50; index += 1) {
    restored.enforceSpectatorCommandRateLimit({
      playerId: "black-player",
      action: "sync",
      now: 2_100,
    });
  }
  for (let index = 0; index < 50; index += 1) {
    restored.enforceSpectatorCommandRateLimit({
      playerId: "rate-viewer",
      action: "leave",
      now: 2_100,
    });
  }
});

test("all spectators share a room command budget in addition to member budgets", () => {
  const room = createRoom(1_000);
  const viewerCount = Math.ceil(SPECTATOR_COMMAND_ROOM_BURST / 2);
  for (let index = 0; index < viewerCount; index += 1) {
    room.join({
      name: `Rate viewer ${index}`,
      role: "spectator",
      playerId: `rate-viewer-${index}`,
      tokenHash: spectatorHash(index),
      now: 2_000,
    });
  }

  for (let index = 0; index < SPECTATOR_COMMAND_ROOM_BURST; index += 1) {
    room.enforceSpectatorCommandRateLimit({
      playerId: `rate-viewer-${Math.floor(index / 2)}`,
      action: "sync",
      now: 2_100,
    });
  }
  assert.throws(
    () =>
      room.enforceSpectatorCommandRateLimit({
        playerId: "rate-viewer-0",
        action: "sync",
        now: 2_100,
      }),
    (error) =>
      error instanceof RoomEngineError && error.code === "SPECTATOR_RATE_LIMITED",
  );
  room.enforceSpectatorCommandRateLimit({
    playerId: "rate-viewer-0",
    action: "sync",
    now: 2_100 + SPECTATOR_COMMAND_ROOM_REFILL_MS,
  });
});

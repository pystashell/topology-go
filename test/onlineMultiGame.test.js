import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  MATCH_MODE_LOCAL,
  MATCH_STATUS_FINISHED,
  MATCH_STATUS_INVITED,
  MATCH_STATUS_PLAYING,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { installFakeGames } from "./fixtures/fakeGames.js";

// Gomoku and Othello rooms are driven by the test-only fake engines in
// fixtures/fakeGames.js, which follow the engine protocol with tiny rules.
after(installFakeGames());

const BLACK_HASH = "a".repeat(64);
const WHITE_HASH = "b".repeat(64);

function createRoom(options = {}) {
  return RoomEngine.create({
    code: "MLT234",
    name: "Host",
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

function act(room, playerId, action, payload = {}, now = room.state.updatedAt + 100) {
  return room.applyAction({ playerId, action, payload, now });
}

function play(room, playerId, row, col, now) {
  return act(room, playerId, "play", { row, col }, now);
}

/** Host invites the joined friend and the friend accepts. */
function startFriendRound(room, payload = {}, now = 2_000) {
  const invited = act(room, "host", "request_game", { mode: "friend", ...payload }, now - 10);
  assert.equal(invited.room.match.status, MATCH_STATUS_INVITED);
  return act(room, "friend", "respond_game", {
    accept: true,
    requestRevision: invited.room.match.request.requestRevision,
  }, now).room;
}

function friendRoom(gameType, settings = {}) {
  const room = createRoom({ gameType, ...settings });
  joinWhite(room);
  startFriendRound(room);
  return room;
}

function rejects(fn, status, code, message) {
  assert.throws(fn, (error) =>
    error instanceof RoomEngineError &&
    error.status === status &&
    error.code === code &&
    (message === undefined || error.message === message));
}

test("a Gomoku room is created, stored as schema 3 and restored through its rules", () => {
  const room = createRoom({
    gameType: "gomoku",
    ruleSet: "renju",
    width: 13,
    height: 11,
    topology: "torus",
    komi: 7.5,
    scoringRule: "chinese",
  });
  const snapshot = room.snapshot(1_000);
  assert.equal(snapshot.game.gameType, "gomoku");
  assert.equal(snapshot.game.ruleSet, "renju");
  assert.equal(snapshot.game.width, 13);
  assert.equal(snapshot.game.height, 11);
  assert.equal(snapshot.game.topology, "torus");
  assert.equal("komi" in snapshot.game, false);

  const stored = room.serialize();
  assert.equal(stored.schemaVersion, 3);
  assert.equal(stored.game.gameType, "gomoku");
  const restored = RoomEngine.restore(structuredClone(stored));
  assert.deepEqual(restored.serialize(), stored);
  assert.equal(restored.snapshot(1_000).positionToken, snapshot.positionToken);
  assert.equal(restored.game.constructor, room.game.constructor);

  const othello = createRoom({ gameType: "othello" });
  assert.equal(othello.game.width, 8);
  assert.equal(othello.game.height, 8);
  assert.equal(othello.game.topology, "cylinder");
  assert.equal(othello.snapshot(1_000).game.discs.black, 2);
});

test("room creation validates boards and rules with the chosen game's limits", () => {
  rejects(() => createRoom({ gameType: "gomoku", size: 9 }), 400, "BAD_REQUEST",
    "五子棋棋盘宽高必须是 11 到 30 之间的整数。");
  rejects(() => createRoom({ gameType: "othello", width: 8, height: 7 }), 400, "BAD_REQUEST",
    "黑白棋棋盘宽高必须是 6 到 30 之间的偶数。");
  rejects(() => createRoom({ gameType: "gomoku", ruleSet: "swap2" }), 400, "BAD_REQUEST",
    "对局规则设置无效。");
  rejects(() => createRoom({ gameType: "othello", topology: "sphere" }), 400, "BAD_REQUEST",
    "棋盘形状无效。");
  rejects(() => createRoom({ gameType: "chess" }), 400, "BAD_REQUEST", "棋类无效。");
  // Go keeps its own limits and messages.
  rejects(() => createRoom({ size: 2 }), 400, "BAD_REQUEST");
  assert.equal(createRoom({ gameType: "go", size: 9 }).serialize().schemaVersion, 2);
});

test("Go rooms keep schema 2 until another game is invited, played or archived", () => {
  const room = createRoom({ size: 9 });
  joinWhite(room);
  const goOnly = room.serialize();
  assert.equal(goOnly.schemaVersion, 2);
  assert.equal(JSON.stringify(goOnly).includes("gameType"), false);

  const invited = act(room, "host", "request_game", { mode: "friend", gameType: "gomoku" }, 1_200);
  assert.deepEqual(invited.room.match.request.settings, {
    gameType: "gomoku",
    ruleSet: "freestyle",
    width: 15,
    height: 15,
    size: 15,
    topology: "cylinder",
    mainTimeSeconds: 0,
    byoYomiPeriods: 0,
    byoYomiSeconds: 0,
  });
  assert.equal(room.serialize().schemaVersion, 3);
  assert.equal(room.requiresMultiGameClient(), true);
  act(room, "host", "cancel_game_request", {
    requestRevision: invited.room.match.request.requestRevision,
  }, 1_300);
  assert.equal(room.serialize().schemaVersion, 2);
  assert.equal(room.requiresMultiGameClient(), false);

  startFriendRound(room, { gameType: "gomoku", size: 11 }, 1_500);
  assert.equal(room.currentGameType(), "gomoku");
  assert.equal(room.serialize().schemaVersion, 3);
  act(room, "friend", "resign", {}, 1_600);
  startFriendRound(room, { gameType: "go", size: 9 }, 1_800);
  assert.equal(room.currentGameType(), "go");
  const archived = room.serialize();
  assert.equal(archived.roundArchive[0].settings.gameType, "gomoku");
  assert.equal(archived.schemaVersion, 3, "an archived Gomoku round keeps schema 3");
  assert.deepEqual(RoomEngine.restore(archived).serialize(), archived);
});

test("schema 2 holding another game is corrupt and schema 3 accepts every known game", () => {
  const goRoom = createRoom({ size: 9 });
  joinWhite(goRoom);
  const go = goRoom.serialize();
  const gomoku = createRoom({ gameType: "gomoku" }).serialize();

  const corrupt = [
    { ...structuredClone(gomoku), schemaVersion: 2 },
    (() => {
      const value = structuredClone(go);
      value.match.status = MATCH_STATUS_INVITED;
      value.match.request = {
        requestRevision: 2,
        requestedBy: "host",
        mode: "friend",
        controllers: value.match.controllers,
        settings: { gameType: "othello", width: 8, height: 8 },
        requestedAt: 1_000,
        previousStatus: "setup",
      };
      return value;
    })(),
    (() => {
      const value = structuredClone(go);
      value.roundArchive = [{ roundId: 1, settings: { gameType: "gomoku" }, replay: null }];
      return value;
    })(),
    { ...structuredClone(gomoku), game: { ...gomoku.game, gameType: "chess" } },
  ];
  for (const value of corrupt) {
    rejects(() => RoomEngine.restore(value), 500, "BAD_ROOM_STATE");
  }

  // A Go room stored as 3 (for example by a later release) still restores and
  // is written back as 2.
  const restored = RoomEngine.restore({ ...structuredClone(go), schemaVersion: 3 });
  assert.equal(restored.serialize().schemaVersion, 2);
  for (const schemaVersion of [4, 999]) {
    rejects(() => RoomEngine.restore({ ...structuredClone(go), schemaVersion }), 500, "BAD_ROOM_STATE");
  }
});

test("next-round settings keep the game unless asked and switch to the new game's defaults", () => {
  const room = createRoom({
    size: 9,
    komi: 7.5,
    scoringRule: "chinese",
    topology: "torus",
    mainTimeSeconds: 60,
  });
  joinWhite(room);
  let settings = act(room, "host", "request_game", { mode: "friend", gameType: "gomoku" }, 1_200)
    .room.match.request.settings;
  assert.deepEqual(settings, {
    gameType: "gomoku",
    ruleSet: "freestyle",
    width: 15,
    height: 15,
    size: 15,
    topology: "cylinder",
    mainTimeSeconds: 60,
    byoYomiPeriods: 0,
    byoYomiSeconds: 0,
  });

  const gomoku = friendRoom("gomoku", { ruleSet: "renju", width: 13, height: 11, topology: "mobius" });
  act(gomoku, "friend", "resign", {}, 2_100);
  settings = act(gomoku, "host", "request_game", { mode: "friend" }, 2_200).room.match.request.settings;
  assert.deepEqual(
    [settings.gameType, settings.ruleSet, settings.width, settings.height, settings.topology],
    ["gomoku", "renju", 13, 11, "mobius"],
  );
  settings = act(gomoku, "host", "request_game", { mode: "friend", gameType: "go" }, 2_300)
    .room.match.request.settings;
  assert.deepEqual(settings, {
    width: 19,
    height: 19,
    size: 19,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "cylinder",
    mainTimeSeconds: 0,
    byoYomiPeriods: 0,
    byoYomiSeconds: 0,
  });
  settings = act(gomoku, "host", "request_game", { mode: "friend", gameType: "othello", komi: 5 }, 2_400)
    .room.match.request.settings;
  assert.deepEqual(
    [settings.gameType, settings.width, settings.height, settings.topology, "komi" in settings],
    ["othello", 8, 8, "cylinder", false],
  );
  rejects(
    () => act(gomoku, "host", "request_game", { mode: "friend", gameType: "othello", size: 9 }, 2_500),
    400,
    "BAD_REQUEST",
    "黑白棋棋盘宽高必须是 6 到 30 之间的偶数。",
  );
  rejects(
    () => act(gomoku, "host", "request_game", { mode: "friend", gameType: "shogi" }, 2_500),
    400,
    "BAD_REQUEST",
  );
});

test("games without AI offer only friend and same-browser rounds", () => {
  const room = createRoom({ size: 9 });
  for (const mode of ["human-ai", "ai-ai"]) {
    for (const gameType of ["gomoku", "othello"]) {
      rejects(
        () => act(room, "host", "request_game", { mode, gameType }, 1_200),
        400,
        "UNSUPPORTED_FOR_GAME",
        "这个棋类暂不支持这种对局方式。",
      );
    }
  }
  const started = act(room, "host", "request_game", { mode: MATCH_MODE_LOCAL, gameType: "othello" }, 1_300);
  assert.equal(started.room.match.status, MATCH_STATUS_PLAYING);
  assert.equal(started.room.game.gameType, "othello");
  assert.equal(started.room.match.controllers.white.operatorId, "host");

  // A Gomoku room can still go back to an AI game of Go.
  act(room, "host", "resign", { color: "black" }, 1_400);
  const goAI = act(room, "host", "request_game", { mode: "human-ai", gameType: "go" }, 1_500);
  assert.equal(goAI.room.match.mode, "human-ai");
  assert.equal("gameType" in goAI.room.game, false);
});

test("each game accepts only its own room actions", () => {
  const room = friendRoom("gomoku", { size: 11 });
  play(room, "host", 5, 5, 2_100);
  const before = room.serialize();
  for (const action of [
    "pass", "ai_play", "ai_pass", "toggle_dead", "finish_scoring", "resume_play",
    "attach_ai", "detach_ai", "set_ai_autoplay_paused", "direct_undo_ai_round",
    "direct_undo_ai_move",
  ]) {
    rejects(
      () => act(room, "friend", action, { row: 5, col: 6 }, 2_200),
      409,
      "UNSUPPORTED_FOR_GAME",
      "这个棋类不支持这个操作。",
    );
  }
  rejects(() => act(room, "friend", "castle", {}, 2_200), 400, "BAD_REQUEST");
  assert.deepEqual(room.serialize(), before);
  // Chat keeps Go-style coordinates on every board.
  const chat = room.postChat({
    playerId: "friend", payload: { kind: "text", text: "看 F6" }, sequence: 1, now: 2_300,
  });
  assert.deepEqual(chat.message.points.map(({ row, col }) => [row, col]), [[5, 5]]);
});

test("a Gomoku five ends the round at once and stops the clock", () => {
  const room = createRoom({ gameType: "gomoku", size: 11, mainTimeSeconds: 60 });
  joinWhite(room);
  startFriendRound(room, {}, 2_000);
  let now = 2_000;
  for (let col = 0; col < 4; col += 1) {
    play(room, "host", 5, col, (now += 100));
    play(room, "friend", 6, col, (now += 100));
  }
  const won = play(room, "host", 5, 4, (now += 100));
  assert.equal(won.move.ok, true);
  const snapshot = won.room;
  assert.equal(snapshot.game.phase, "finished");
  assert.equal(snapshot.game.result.reason, "five");
  assert.equal(snapshot.game.result.winner, "black");
  assert.equal(snapshot.match.status, MATCH_STATUS_FINISHED);
  assert.equal(snapshot.match.finishedAt, now);
  assert.equal(snapshot.timeControl.activeColor, null);
  assert.equal(snapshot.timeControl.running, false);
  assert.equal(snapshot.moveCount, 9);
  assert.equal(snapshot.replay.events.length, 9);
  assert.equal(snapshot.undoAvailable, false);
  rejects(() => play(room, "friend", 7, 0, now + 100), 409, "ILLEGAL_MOVE");
  rejects(
    () => act(room, "friend", "request_undo", { expectedMoveCount: 9 }, now + 100),
    409,
    "UNDO_UNAVAILABLE",
  );
  const restored = RoomEngine.restore(room.serialize());
  assert.deepEqual(restored.snapshot(now + 200).game.result, snapshot.game.result);

  const renju = friendRoom("gomoku", { ruleSet: "renju", size: 11 });
  rejects(() => play(renju, "host", 0, 0, 2_100), 409, "ILLEGAL_MOVE", "黑方禁手：三三。");
});

test("an Othello auto-pass keeps the clock on the colour that moves again", () => {
  const room = createRoom({ gameType: "othello", mainTimeSeconds: 60 });
  joinWhite(room);
  startFriendRound(room, {}, 2_000);
  const remaining = (snapshot) => [
    snapshot.timeControl.players.black.mainTimeRemainingMs,
    snapshot.timeControl.players.white.mainTimeRemainingMs,
  ];

  // Row 0 leaves White without a legal move, so Black moves again.
  let snapshot = play(room, "host", 0, 0, 3_000).room;
  assert.equal(snapshot.game.currentPlayer, "black");
  assert.equal(snapshot.game.lastMove.skipped, "white");
  assert.equal(snapshot.moveCount, 1);
  assert.equal(snapshot.replay.events.length, 1);
  assert.equal(snapshot.timeControl.activeColor, "black");
  assert.deepEqual(remaining(snapshot), [59_000, 60_000]);
  rejects(() => play(room, "friend", 2, 2, 3_100), 409, "NOT_YOUR_TURN");

  snapshot = play(room, "host", 2, 2, 4_500).room;
  assert.equal(snapshot.game.currentPlayer, "white");
  assert.equal(snapshot.timeControl.activeColor, "white");
  assert.deepEqual(remaining(snapshot), [57_500, 60_000]);

  snapshot = play(room, "friend", 5, 5, 5_000).room;
  assert.equal(snapshot.timeControl.activeColor, "black");
  assert.deepEqual(remaining(snapshot), [57_500, 59_500]);
  assert.equal(snapshot.moveCount, 3);

  const restored = RoomEngine.restore(room.serialize());
  assert.equal(restored.snapshot(5_000).timeControl.activeColor, "black");
  rejects(() => play(room, "host", 7, 0, 5_100), 409, "ILLEGAL_MOVE", "必须夹住至少一枚对方棋子。");
});

test("an Othello undo takes back the requester's latest move and every move since", () => {
  const room = friendRoom("othello", { mainTimeSeconds: 60 });
  play(room, "host", 2, 2, 2_100);
  play(room, "friend", 5, 5, 2_200);
  play(room, "host", 0, 0, 2_300); // White has no move: Black again.
  play(room, "host", 2, 3, 2_400);
  assert.equal(room.undoCountFor("white"), 3);
  assert.equal(room.undoCountFor("black"), 1);

  const requested = act(room, "friend", "request_undo", { expectedMoveCount: 4 }, 2_500);
  const { targetMoveCount, requestRevision } = requested.room.undoRequest;
  const accepted = act(room, "host", "respond_undo", {
    accept: true, targetMoveCount, requestRevision,
  }, 2_600);
  assert.equal(accepted.move.undoneCount, 3);
  const snapshot = accepted.room;
  assert.equal(snapshot.moveCount, 1);
  assert.equal(snapshot.replay.events.length, 1);
  assert.equal(snapshot.game.currentPlayer, "white");
  assert.equal(snapshot.game.board[2][2], "black");
  for (const [row, col] of [[5, 5], [0, 0], [2, 3]]) {
    assert.equal(snapshot.game.board[row][col], null);
  }
  assert.equal(snapshot.timeControl.activeColor, "white");
});

test("other games resign and forfeit through their engine, without a Go overlay", () => {
  const room = friendRoom("gomoku", { size: 11 });
  play(room, "host", 5, 5, 2_100);
  const resigned = act(room, "friend", "resign", {}, 2_200);
  assert.equal(resigned.move.type, "resign");
  assert.equal(resigned.room.game.result.reason, "resign");
  assert.equal(resigned.room.game.result.winner, "black");
  assert.deepEqual(resigned.room.replay.events.at(-1), { type: "resign", color: "white" });
  assert.equal(resigned.room.match.status, MATCH_STATUS_FINISHED);
  const stored = room.serialize();
  assert.equal(stored.resignationOutcome, null);
  assert.deepEqual(RoomEngine.restore(stored).serialize(), stored);

  // A stray Go resignation overlay is never applied to another game.
  const tampered = structuredClone(stored);
  tampered.resignationOutcome = {
    winner: "white", loser: "black", reason: "resign", resignation: true,
    currentPlayer: "black", consecutivePasses: 0, finishedAt: 2_200,
    replayEventCount: 1, lastMove: null,
  };
  assert.equal(RoomEngine.restore(tampered).state.resignationOutcome, null);

  const left = friendRoom("othello");
  play(left, "host", 2, 2, 2_100);
  const forfeit = left.leave({ playerId: "friend", now: 2_200 });
  assert.equal(forfeit.move.type, "resign");
  assert.equal(forfeit.move.color, "white");
  assert.equal(forfeit.room.game.result.reason, "resign");
  assert.equal(forfeit.room.match.status, MATCH_STATUS_FINISHED);
});

test("other games bind actions to their own position token and a fixed scoring token", () => {
  const room = friendRoom("othello");
  const before = room.snapshot(2_050);
  assert.match(before.positionToken, /^pos-v1-[0-9a-f]{16}-[0-9a-z]+$/u);
  room.assertFreshPosition({
    expectedMoveCount: 0,
    expectedPositionToken: before.positionToken,
  });
  const after = play(room, "host", 2, 2, 2_100).room;
  assert.notEqual(after.positionToken, before.positionToken);
  assert.equal(after.scoringToken, before.scoringToken);
  rejects(() => room.assertFreshPosition({
    expectedMoveCount: 1,
    expectedPositionToken: before.positionToken,
  }), 409, "STALE_GAME_STATE");
  assert.equal(room.deadStoneTogglesThisScoring(), 0);
});

test("a same-browser Othello round undoes one move at a time", () => {
  const room = createRoom({ gameType: "othello" });
  act(room, "host", "request_game", { mode: MATCH_MODE_LOCAL }, 1_200);
  play(room, "host", 0, 0, 1_300);
  play(room, "host", 2, 2, 1_400);
  const snapshot = room.snapshot(1_400);
  const undone = act(room, "host", "direct_undo_local_round", {
    expectedMoveCount: snapshot.moveCount,
    expectedPositionToken: snapshot.positionToken,
  }, 1_500);
  assert.equal(undone.move.type, "local_move_undone");
  assert.equal(undone.room.moveCount, 1);
  assert.equal(undone.room.game.currentPlayer, "black");
  assert.equal(undone.room.game.board[2][2], null);
});

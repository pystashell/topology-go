import assert from "node:assert/strict";
import test from "node:test";

import {
  filterLobbyRooms,
  lobbySummaryFromRoom,
  pruneLobbyRooms,
} from "../src/multiplayer/lobby.js";
import {
  decodeLobbyBoardPreview,
  encodeLobbyBoardPreview,
} from "../src/multiplayer/lobbyPreview.js";

function room(overrides = {}) {
  return {
    code: "BAM234",
    revision: 4,
    moveCount: 12,
    game: {
      width: 13,
      height: 9,
      topology: "mobius",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "play",
    },
    match: {
      status: "playing",
      mode: "human-ai",
      roundNumber: 2,
      startedAt: 1_500,
      finishedAt: null,
    },
    players: [
      { name: "黑方", color: "black", role: "player", online: true },
      { name: "KataGo", color: "white", role: "ai", automated: true, online: true },
    ],
    spectators: [{ online: true }, { online: false }],
    updatedAt: 2_000,
    expiresAt: 90_000_000,
    ...overrides,
  };
}

test("lobby summaries expose only public room metadata", () => {
  const summary = lobbySummaryFromRoom(room(), 2_100);
  const emptyBoard = Array.from({ length: 9 }, () => Array(13).fill(null));
  assert.deepEqual(summary, {
    code: "BAM234",
    revision: 4,
    status: "playing",
    mode: "human-ai",
    roundNumber: 2,
    width: 13,
    height: 9,
    topology: "mobius",
    scoringRule: "chinese",
    komi: 7.5,
    timed: false,
    moveCount: 12,
    boardPreview: encodeLobbyBoardPreview(emptyBoard, 13, 9),
    lastMove: null,
    players: [
      { name: "黑方", color: "black", controller: "human", online: true },
      { name: "KataGo", color: "white", controller: "ai", online: true },
    ],
    spectatorCount: 1,
    joinable: false,
    watchable: true,
    createdAt: 2_000,
    updatedAt: 2_000,
    startedAt: 1_500,
    finishedAt: null,
    expiresAt: 90_000_000,
  });
  assert.equal("chat" in summary, false);
  assert.equal("positionToken" in summary, false);
  assert.equal("replay" in summary, false);
  assert.deepEqual(decodeLobbyBoardPreview(summary.boardPreview, 13, 9), emptyBoard);
});

test("lobby summaries encode current stones and only public last-move fields", () => {
  const board = Array.from({ length: 3 }, () => Array(5).fill(null));
  board[0][0] = "black";
  board[1][4] = "white";
  const summary = lobbySummaryFromRoom(room({
    game: {
      width: 5,
      height: 3,
      topology: "cylinder",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "play",
      board,
      lastMove: {
        type: "play",
        color: "white",
        row: 1,
        col: 4,
        captured: [{ row: 1, col: 3 }],
        privateAnalysis: "never-index-this",
      },
    },
  }));
  assert.deepEqual(decodeLobbyBoardPreview(summary.boardPreview, 5, 3), board);
  assert.deepEqual(summary.lastMove, {
    type: "play",
    color: "white",
    row: 1,
    col: 4,
  });
  assert.equal(JSON.stringify(summary).includes("privateAnalysis"), false);
  assert.equal(JSON.stringify(summary).includes("captured"), false);
});

test("waiting friend rooms are joinable and filters compose", () => {
  const waiting = lobbySummaryFromRoom(room({
    code: "WAIT23",
    moveCount: 0,
    match: { status: "invited", mode: "friend", roundNumber: 0 },
    players: [{ name: "房主", color: "black", role: "player", online: true }],
    game: {
      width: 19,
      height: 19,
      topology: "torus",
      scoringRule: "japanese",
      komi: 6.5,
      phase: "play",
    },
    updatedAt: 3_000,
  }));
  const playing = lobbySummaryFromRoom(room());
  assert.equal(waiting.joinable, true);
  assert.deepEqual(
    filterLobbyRooms([playing, waiting], { status: "invited", topology: "torus", size: "19" })
      .map(({ code }) => code),
    ["WAIT23"],
  );
  assert.deepEqual(
    filterLobbyRooms([playing, waiting], { size: "custom" }).map(({ code }) => code),
    ["BAM234"],
  );
});

test("pending invitations preview the empty requested board instead of the previous game", () => {
  const previousBoard = Array.from({ length: 9 }, () => Array(13).fill(null));
  previousBoard[4][6] = "black";
  const invited = lobbySummaryFromRoom(room({
    moveCount: 47,
    game: {
      width: 13,
      height: 9,
      topology: "mobius",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "finished",
      board: previousBoard,
      lastMove: { type: "play", color: "black", row: 4, col: 6 },
    },
    players: [
      { id: "host", name: "Host", color: "black", role: "player", online: true },
      { id: "friend", name: "Friend", color: "white", role: "player", online: true },
    ],
    match: {
      status: "invited",
      mode: "friend",
      roundId: 8,
      request: {
        mode: "friend",
        controllers: {
          black: { kind: "human", operatorId: "host" },
          white: { kind: "human", operatorId: "friend" },
        },
        settings: {
          width: 17,
          height: 11,
          topology: "torus",
          scoringRule: "japanese",
          komi: 6.5,
          mainTimeSeconds: 300,
          byoYomiPeriods: 3,
          byoYomiSeconds: 30,
        },
      },
    },
  }));

  assert.equal(invited.width, 17);
  assert.equal(invited.height, 11);
  assert.equal(invited.topology, "torus");
  assert.equal(invited.scoringRule, "japanese");
  assert.equal(invited.komi, 6.5);
  assert.equal(invited.timed, true);
  assert.equal(invited.moveCount, 0);
  assert.equal(invited.lastMove, null);
  assert.deepEqual(
    decodeLobbyBoardPreview(invited.boardPreview, 17, 11),
    Array.from({ length: 11 }, () => Array(17).fill(null)),
  );
});

test("v2 match controllers derive human, AI, and local seats", () => {
  const basePlayers = [
    { id: "host", name: "Host", color: "black", role: "player", online: true },
  ];
  const humanAI = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "human-ai",
      roundId: 3,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "ai", operatorId: "host", modelId: "b18" },
      },
    },
  }));
  assert.equal(humanAI.roundNumber, 3);
  assert.deepEqual(humanAI.players, [
    { name: "Host", color: "black", controller: "human", online: true },
    { name: "KataGo b18 AI", color: "white", controller: "ai", online: true },
  ]);

  const aiAI = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "ai-ai",
      roundId: 1,
      controllers: {
        black: { kind: "ai", operatorId: "host", modelId: "b10" },
        white: { kind: "ai", operatorId: "host", modelId: "b18" },
      },
    },
  }));
  assert.deepEqual(aiAI.players, [
    { name: "KataGo b10 AI", color: "black", controller: "ai", online: true },
    { name: "KataGo b18 AI", color: "white", controller: "ai", online: true },
  ]);

  const local = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "local",
      roundId: 1,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: "host" },
      },
    },
  }));
  assert.deepEqual(local.players, [
    { name: "Host", color: "black", controller: "local", online: true },
    { name: "Host", color: "white", controller: "local", online: true },
  ]);
});

test("only friend rooms with a genuinely open white seat are joinable", () => {
  const players = [
    { id: "host", name: "Host", color: "black", role: "player", online: true },
    { id: "friend", name: "Friend", color: "white", role: "player", online: true },
  ];
  const waiting = lobbySummaryFromRoom(room({
    players,
    match: {
      status: "setup",
      mode: "friend",
      roundId: 0,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: null },
      },
    },
  }));
  assert.equal(waiting.joinable, false, "a reserved player member occupies the seat too");

  const invited = lobbySummaryFromRoom(room({
    players,
    match: {
      status: "invited",
      mode: "human-ai",
      roundId: 4,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "ai", operatorId: "host", modelId: "b10" },
      },
      request: {
        mode: "friend",
        controllers: {
          black: { kind: "human", operatorId: "host" },
          white: { kind: "human", operatorId: "friend" },
        },
      },
    },
  }));
  assert.equal(invited.mode, "friend");
  assert.equal(invited.joinable, false);
  assert.deepEqual(invited.players.map(({ name, controller }) => ({ name, controller })), [
    { name: "Host", controller: "human" },
    { name: "Friend", controller: "human" },
  ]);

  const playingWithoutWhite = lobbySummaryFromRoom(room({
    players: players.slice(0, 1),
    match: {
      status: "playing",
      mode: "friend",
      roundId: 1,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: null },
      },
    },
  }));
  assert.equal(playingWithoutWhite.joinable, true);
  assert.deepEqual(
    filterLobbyRooms([waiting, invited, playingWithoutWhite], { status: "joinable" })
      .map(({ code }) => code),
    ["BAM234"],
  );

  const hostless = lobbySummaryFromRoom(room({
    code: "NOHOST",
    players: [],
    match: {
      status: "setup",
      mode: "friend",
      roundId: 0,
      controllers: {
        black: { kind: "human", operatorId: null },
        white: { kind: "human", operatorId: null },
      },
    },
  }));
  assert.equal(hostless.joinable, false, "the lobby must not advertise a hostless room");
});

test("lobby pruning drops stale rooms and keeps the newest order", () => {
  const current = lobbySummaryFromRoom(room({ code: "CURR23", updatedAt: 10_000, expiresAt: 20_000 }));
  const older = lobbySummaryFromRoom(room({ code: "OLDER2", updatedAt: 8_000, expiresAt: 20_000 }));
  const expired = lobbySummaryFromRoom(room({ code: "OLD234", updatedAt: 1_000, expiresAt: 9_000 }));
  assert.deepEqual(
    pruneLobbyRooms([older, expired, current], 9_500).map(({ code }) => code),
    ["CURR23", "OLDER2"],
  );
});

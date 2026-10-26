import assert from "node:assert/strict";
import test from "node:test";

import {
  LOBBY_LISTED_SIZES,
  filterLobbyRooms,
  lobbyRoomMatchesQuery,
  lobbyStats,
  myLobbyRooms,
  pickQuickJoinRoom,
  sortLobbyRooms,
} from "../src/multiplayer/lobby.js";
import { CONNECTION_STATUS, RoomClient } from "../src/multiplayer/roomClient.js";

/*
 * The lobby's search, sort, counts, quick join and "My rooms", and the room
 * client's listing and forgetting of this browser's stored rooms.
 */

function summary(code, overrides = {}) {
  return {
    code,
    status: "setup",
    mode: "friend",
    width: 19,
    height: 19,
    topology: "cylinder",
    joinable: false,
    spectatorCount: 0,
    moveCount: 0,
    players: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const ROOMS = [
  summary("AAA234", { status: "playing", createdAt: 100, updatedAt: 900, spectatorCount: 5, moveCount: 80,
    players: [{ name: "Alice", color: "black", controller: "human", online: true }, { name: "Bob", color: "white", controller: "human", online: false }] }),
  summary("BBB234", { status: "setup", joinable: true, createdAt: 300, updatedAt: 500, gameType: "gomoku", width: 15, height: 15,
    players: [{ name: "Carol", color: "black", controller: "human", online: true }] }),
  summary("CCC234", { status: "finished", createdAt: 200, updatedAt: 950, spectatorCount: 1, moveCount: 200 }),
  summary("DDD234", { status: "invited", joinable: false, createdAt: 400, updatedAt: 400, topology: "torus",
    players: [{ name: "Dora", color: "black", controller: "human", online: true }, { name: "KataGo b10 AI", color: "white", controller: "ai", online: true }] }),
  summary("EEE234", { status: "playing", joinable: true, createdAt: 50, updatedAt: 990, gameType: "othello", width: 8, height: 8,
    players: [{ name: "Eve", color: "black", controller: "human", online: true }] }),
  summary("FFF234", { status: "setup", joinable: true, createdAt: 500, updatedAt: 100, width: 12, height: 12,
    players: [{ name: "Frank", color: "black", controller: "human", online: true }] }),
];

const codes = (rooms) => rooms.map((room) => room.code);

test("the lobby sorts by what is waiting, newest, most watched or most moves", () => {
  // Recommended: invitations, then setup, then playing, then finished;
  // recent activity first within each.
  assert.deepEqual(codes(sortLobbyRooms(ROOMS)), ["DDD234", "BBB234", "FFF234", "EEE234", "AAA234", "CCC234"]);
  assert.deepEqual(codes(sortLobbyRooms(ROOMS, "newest")), ["FFF234", "DDD234", "BBB234", "CCC234", "AAA234", "EEE234"]);
  assert.deepEqual(codes(sortLobbyRooms(ROOMS, "watchers")).slice(0, 2), ["AAA234", "CCC234"]);
  assert.deepEqual(codes(sortLobbyRooms(ROOMS, "moves")).slice(0, 2), ["CCC234", "AAA234"]);
  // An unknown order falls back to the recommended one.
  assert.deepEqual(codes(sortLobbyRooms(ROOMS, "random")), codes(sortLobbyRooms(ROOMS)));
  // Sorting never changes the input.
  assert.equal(ROOMS[0].code, "AAA234");
});

test("search finds a room by code or by a player's name, ignoring case and spaces", () => {
  assert.equal(lobbyRoomMatchesQuery(ROOMS[0], ""), true);
  assert.equal(lobbyRoomMatchesQuery(ROOMS[0], "  "), true);
  assert.equal(lobbyRoomMatchesQuery(ROOMS[0], "aaa2"), true);
  assert.equal(lobbyRoomMatchesQuery(ROOMS[0], " BOB "), true);
  assert.equal(lobbyRoomMatchesQuery(ROOMS[0], "carol"), false);
  assert.deepEqual(codes(filterLobbyRooms(ROOMS, { query: "katago" })), ["DDD234"]);
  assert.deepEqual(codes(filterLobbyRooms(ROOMS, { query: "234", status: "playing", order: "newest" })), ["AAA234", "EEE234"]);
});

test("the custom size filter leaves out every size the filter names (regression)", () => {
  // Before: only 9, 13 and 19 were excluded, so 8x8, 11x11 and 15x15 rooms
  // also showed under "custom" although they have their own options.
  const sized = [6, 7, 8, 9, 10, 11, 12, 13, 15, 19].map((size) => summary(`S${String(size).padStart(2, "0")}234`, { width: size, height: size }));
  sized.push(summary("REC234", { width: 9, height: 13 }));
  assert.deepEqual(LOBBY_LISTED_SIZES, [6, 7, 8, 9, 10, 11, 13, 15, 19]);
  assert.deepEqual(codes(filterLobbyRooms(sized, { size: "custom" })).sort(), ["REC234", "S12234"]);
  assert.deepEqual(codes(filterLobbyRooms(sized, { size: "15" })), ["S15234"]);
});

test("the counts give rooms by status, open seats, spectators and players online", () => {
  assert.deepEqual(lobbyStats(ROOMS), {
    total: 6, joinable: 3, waiting: 3, playing: 2, finished: 1, spectators: 6, playersOnline: 5,
  });
  assert.deepEqual(lobbyStats([]), {
    total: 0, joinable: 0, waiting: 0, playing: 0, finished: 0, spectators: 0, playersOnline: 0,
  });
});

test("quick join takes an open seat that matches the filters, preferring a room not yet started", () => {
  // Setup rooms first (BBB, FFF), the most recently active first; EEE plays already.
  assert.equal(pickQuickJoinRoom(ROOMS)?.code, "BBB234");
  // The game filter narrows it; the status filter is ignored.
  assert.equal(pickQuickJoinRoom(ROOMS, { game: "othello", status: "finished" })?.code, "EEE234");
  assert.equal(pickQuickJoinRoom(ROOMS, { game: "go" })?.code, "FFF234");
  // Rooms this browser already sits in are skipped.
  assert.equal(pickQuickJoinRoom(ROOMS, {}, { exclude: ["BBB234"] })?.code, "FFF234");
  // Nothing open: null (the page then offers to create a room).
  assert.equal(pickQuickJoinRoom(ROOMS, { topology: "mobius" }), null);
  assert.equal(pickQuickJoinRoom([]), null);
});

test("My rooms lists each stored room once, a seat before a watch, with its summary if listed", () => {
  const entries = myLobbyRooms([
    { code: "AAA234", role: "spectator", playerName: "Me" },
    { code: "AAA234", role: "player", color: "white", playerName: "Me" },
    { code: "ZZZ234", role: "player", color: "black", playerName: "Me" },
    { code: "CCC234", role: "spectator" },
    { code: "AAA234", role: "spectator" },
    null,
    { role: "player" },
  ], ROOMS);
  assert.deepEqual(entries.map(({ code, role, color }) => [code, role, color]), [
    ["CCC234", "spectator", null],
    ["AAA234", "player", "white"],
    ["ZZZ234", "player", "black"],
  ]);
  assert.equal(entries[0].summary.code, "CCC234");
  assert.equal(entries[2].summary, null, "an unlisted or expired room has no summary");
});

// --- Room client: this browser's stored rooms -------------------------------

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

class QuietSocket {
  constructor() { this.readyState = 0; }
  addEventListener() {}
  send() {}
  close() { this.readyState = 3; }
}

function joiningClient(storage) {
  return new RoomClient({
    storage,
    attemptStorage: memoryStorage(),
    WebSocketImpl: QuietSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const code = body.roomCode ?? _url.split("/").at(-1);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          roomCode: code,
          session: {
            code, playerId: body.playerId, token: body.token, playerName: body.name,
            role: body.role ?? "player", color: body.role === "spectator" ? null : "white",
          },
          room: { code, revision: 0 },
        }),
      };
    },
  });
}

test("the room client lists every stored room and forgets one it is not connected to", async () => {
  const storage = memoryStorage();
  const client = joiningClient(storage);
  await client.joinRoom("AB23CD", { name: "Mia" });
  client.disconnect();
  await client.joinRoom("EF34GH", { name: "Mia", role: "spectator" });
  const sessions = client.listAllStoredSessions();
  assert.deepEqual(sessions.map(({ code, role }) => [code, role]), [["AB23CD", "player"], ["EF34GH", "spectator"]]);
  assert.equal(sessions[0].playerName, "Mia");
  // A fresh page (another RoomClient on the same storage) sees the same rooms.
  assert.equal(joiningClient(storage).listAllStoredSessions().length, 2);

  // The room this client is connected to cannot be forgotten from the lobby.
  assert.notEqual(client.connectionStatus, CONNECTION_STATUS.CLOSED);
  assert.equal(client.forgetStoredSessions("EF34GH"), false);
  assert.equal(client.hasStoredSession("EF34GH"), true);
  // Another room can; it is gone for every page of this browser.
  assert.equal(client.forgetStoredSessions("ab23cd"), true);
  assert.equal(client.hasStoredSession("AB23CD"), false);
  assert.deepEqual(joiningClient(storage).listAllStoredSessions().map(({ code }) => code), ["EF34GH"]);
  // Once disconnected, the last room can be forgotten too.
  client.disconnect({ preserveSession: true, status: CONNECTION_STATUS.CLOSED });
  assert.equal(client.forgetStoredSessions("EF34GH"), true);
  assert.deepEqual(client.listAllStoredSessions(), []);
  assert.equal(client.forgetStoredSessions("not a code"), false);
});

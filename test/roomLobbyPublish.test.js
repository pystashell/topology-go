import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine, hashRoomToken } from "../src/multiplayer/roomEngine.js";
import { BadukLobby } from "../worker/BadukLobby.js";
import { BadukRoom, LOBBY_EXPIRY_REFRESH_MS } from "../worker/BadukRoom.js";

async function setup() {
  const lobbyWrites = [];
  const lobby = new BadukLobby({
    blockConcurrencyWhile: (initialize) => initialize(),
    storage: {
      async get() { return null; },
      async put(_key, value) { lobbyWrites.push(structuredClone(value)); },
    },
    abort() { throw new Error("Lobby reset"); },
  });
  await lobby.ready;
  const now = Date.now();
  const engine = RoomEngine.create({
    code: "PUB234", name: "Host", size: 9, playerId: "host",
    tokenHash: await hashRoomToken("host-secret"), startImmediately: false, now,
  });
  engine.join({
    name: "Friend", role: "player", playerId: "friend",
    tokenHash: await hashRoomToken("friend-secret"), now,
  });
  engine.connections.set("host-socket", "host");
  engine.connections.set("friend-socket", "friend");
  const pending = [];
  const upserts = [];
  let failNext = false;
  let roomWrites = 0;
  const room = Object.create(BadukRoom.prototype);
  room.engine = engine;
  room.operationQueue = Promise.resolve();
  room.ctx = {
    storage: {
      async put() { roomWrites += 1; },
      async getAlarm() { return null; },
      async setAlarm() {},
      async deleteAlarm() {},
    },
    waitUntil(promise) { pending.push(promise); },
    getWebSockets() { return []; },
  };
  room.env = {
    BADUK_ROOM_INDEX: {
      getByName() {
        return {
          async fetch(request) {
            upserts.push(await request.clone().json());
            if (failNext) {
              failNext = false;
              throw new Error("lobby unavailable");
            }
            return lobby.fetch(request);
          },
        };
      },
    },
  };
  return {
    engine, lobby, room, upserts, lobbyWrites,
    get roomWrites() { return roomWrites; },
    failNextPublish() { failNext = true; },
    settle: () => Promise.all(pending.splice(0)),
  };
}

function socketFor(playerId) {
  const attachment = { connectionId: `${playerId}-socket`, identity: { playerId, role: "player" } };
  return {
    attachment,
    socket: {
      readyState: 1,
      messages: [],
      deserializeAttachment: () => attachment,
      send(raw) { this.messages.push(JSON.parse(raw)); },
    },
  };
}

test("player syncs do not republish an unchanged lobby entry", async () => {
  const harness = await setup();
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 1, "the first persist of an instance publishes");

  const { socket, attachment } = socketFor("friend");
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    await harness.room.handleCommand(socket, attachment, {
      id: `sync-${sequence}`, sequence, action: "sync", payload: {},
    });
    await harness.room.persist();
  }
  await harness.settle();
  assert.ok(harness.upserts.length <= 1, `${harness.upserts.length} publishes`);
  assert.ok(harness.roomWrites >= 100, "the room itself still persists");
  assert.equal(harness.lobbyWrites.length, 1);

  // A visible change still reaches the lobby with the newer revision.
  harness.engine.disconnect({ connectionId: "friend-socket" });
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 2);
  const entry = harness.lobby.rooms.get("PUB234");
  assert.equal(entry.players.find(({ color }) => color === "white").online, false);
  assert.equal(entry.directoryRevision, harness.engine.state.directoryRevision);

  const request = harness.engine.applyAction({
    playerId: "host", action: "request_game", payload: { mode: "friend" },
  });
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 3);
  assert.equal(harness.lobby.rooms.get("PUB234").status, "invited");
  assert.ok(request.move.request.requestRevision > 0);
});

test("a failed publish or a materially later expiry republishes the same entry", async (t) => {
  t.mock.method(console, "error", () => {});
  const harness = await setup();
  harness.failNextPublish();
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 1);
  assert.equal(harness.lobby.rooms.has("PUB234"), false);

  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 2, "a failure leaves the next persist free to retry");
  assert.equal(harness.lobby.rooms.has("PUB234"), true);

  harness.engine.state.expiresAt += LOBBY_EXPIRY_REFRESH_MS - 1_000;
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 2, "a small TTL slide stays local");

  harness.engine.state.expiresAt += 1_000;
  await harness.room.persist();
  await harness.settle();
  assert.equal(harness.upserts.length, 3);
  assert.equal(harness.lobby.rooms.get("PUB234").expiresAt, harness.engine.state.expiresAt);
});

test("the published projection yields the same lobby entry as a full snapshot", async () => {
  const { lobbySummaryFromRoom } = await import("../src/multiplayer/lobby.js");
  const harness = await setup();
  const { engine } = harness;
  const now = engine.state.updatedAt + 10;
  const compare = () => assert.deepEqual(
    lobbySummaryFromRoom(engine.directorySnapshot(now), now),
    lobbySummaryFromRoom(engine.snapshot(now), now),
  );
  compare();
  const invited = engine.applyAction({
    playerId: "host", action: "request_game", payload: { mode: "friend", size: 13 }, now,
  });
  compare();
  engine.applyAction({
    playerId: "friend", action: "respond_game",
    payload: { accept: true, requestRevision: invited.move.request.requestRevision }, now,
  });
  engine.applyAction({ playerId: "host", action: "play", payload: { row: 3, col: 3 }, now });
  compare();
  engine.applyAction({ playerId: "friend", action: "resign", payload: {}, now });
  compare();
  assert.equal(JSON.stringify(engine.directorySnapshot(now)).includes("\"replay\""), false);
});

test("an accepted lobby upsert prunes and writes the directory once", async () => {
  const { lobbySummaryFromRoom, MAX_LOBBY_ROOMS } = await import("../src/multiplayer/lobby.js");
  const writes = [];
  const lobby = Object.create(BadukLobby.prototype);
  lobby.ready = Promise.resolve();
  lobby.watermarks = new Map();
  lobby.ctx = { storage: { async put(_key, value) { writes.push(value); } } };
  const harness = await setup();
  const base = harness.engine.directorySnapshot();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = (index) => `Q${Array.from({ length: 5 }, (_, digit) =>
    alphabet[Math.floor(index / alphabet.length ** digit) % alphabet.length]).join("")}`;
  const entry = (index, overrides = {}) => lobbySummaryFromRoom({
    ...base, code: code(index), incarnationId: `room-${index}`, ...overrides,
  });
  lobby.rooms = new Map();
  for (let index = 0; index < MAX_LOBBY_ROOMS; index += 1) {
    const value = entry(index, index === 0 ? { expiresAt: Date.now() - 1 } : {});
    lobby.rooms.set(value.code, value);
  }
  const upsert = (room) => lobby.fetch(new Request("https://index/internal/upsert", {
    method: "POST", body: JSON.stringify(room),
  }));

  // One expired entry is pruned and the new room added in a single write.
  assert.equal((await upsert({ ...base, code: "NEW234", incarnationId: "new-1" })).status, 200);
  assert.equal(writes.length, 1);
  assert.equal(lobby.rooms.size, MAX_LOBBY_ROOMS);
  assert.equal(lobby.rooms.has(code(0)), false);

  // At the visible cap a newer room displaces the oldest into a watermark,
  // still with one write.
  const newest = { ...base, code: "NEW345", incarnationId: "new-2", updatedAt: Date.now() + 5_000 };
  assert.equal((await upsert(newest)).status, 200);
  assert.equal(writes.length, 2);
  assert.equal(lobby.rooms.size, MAX_LOBBY_ROOMS);
  assert.equal(lobby.rooms.has("NEW345"), true);
  assert.equal(writes[1].rooms.length, MAX_LOBBY_ROOMS);
  assert.equal(writes[1].watermarks.length, 1);
});

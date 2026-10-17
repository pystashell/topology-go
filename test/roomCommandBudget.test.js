import assert from "node:assert/strict";
import test from "node:test";

import {
  DEAD_STONE_TOGGLES_PER_POINT,
  PLAYER_COMMAND_BURST,
  PLAYER_COMMAND_REFILL_MS,
  PLAYER_RESERVATION_TTL_MS,
  SPECTATOR_RECONNECT_GRACE_MS,
  RoomEngine,
  RoomEngineError,
  hashRoomToken,
} from "../src/multiplayer/roomEngine.js";
import { BadukRoom, CONNECTION_WRITE_INTERVAL_MS } from "../worker/BadukRoom.js";

const isRateLimited = (error) =>
  error instanceof RoomEngineError && error.code === "COMMAND_RATE_LIMITED" &&
  error.status === 429 && error.retryable === true;

function twoPlayerRoom(now = 1_000) {
  const room = RoomEngine.create({
    code: "BUD234", name: "Host", size: 9, playerId: "host",
    tokenHash: "a".repeat(64), now,
  });
  room.join({ name: "Friend", role: "player", playerId: "friend", tokenHash: "b".repeat(64), now });
  room.join({ name: "Viewer", role: "spectator", playerId: "viewer", tokenHash: "c".repeat(64), now });
  return room;
}

test("players share a generous per-member command budget", () => {
  const room = twoPlayerRoom();
  const spend = (action, now, playerId = "friend") =>
    room.enforcePlayerCommandRateLimit({ playerId, action, now });
  for (let index = 0; index < PLAYER_COMMAND_BURST; index += 1) spend("sync", 2_000);
  assert.throws(() => spend("toggle_dead", 2_000), isRateLimited);
  assert.throws(() => spend("request_undo", 2_000), isRateLimited);
  // Chat has its own buckets, leaving is always possible, and members are
  // budgeted independently.
  spend("chat", 2_000);
  spend("leave", 2_000);
  spend("sync", 2_000, "host");
  spend("sync", 2_000, "viewer");
  spend("sync", 2_000 + PLAYER_COMMAND_REFILL_MS);

  // Paced play at the sustained rate (here 8/s for 10 minutes, faster than
  // the 200 ms minimum AI think time) is never limited.
  const paced = twoPlayerRoom();
  for (let index = 0; index < 4_800; index += 1) {
    paced.enforcePlayerCommandRateLimit({
      playerId: "host", action: "ai_play", now: 2_000 + index * PLAYER_COMMAND_REFILL_MS,
    });
  }
});

function durableRoom(stored, sockets = []) {
  let ready;
  const storage = {
    value: structuredClone(stored), writes: 0, alarm: null,
    async get() { return structuredClone(this.value); },
    async put(_key, value) { this.writes += 1; this.value = structuredClone(value); },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
  };
  const ctx = {
    storage,
    id: { toString: () => "budget-room" },
    getWebSockets: () => sockets.filter((socket) => socket.readyState < 2),
    acceptWebSocket(socket) { sockets.push(socket); },
    blockConcurrencyWhile(callback) { ready = callback(); },
  };
  const room = new BadukRoom(ctx, {});
  return { room, storage, ready: () => ready, sockets };
}

function playerSocket(playerId, role = "player") {
  const attachment = { connectionId: `${playerId}-socket`, identity: { playerId, role } };
  return {
    attachment,
    socket: {
      readyState: 1,
      messages: [],
      deserializeAttachment: () => attachment,
      serializeAttachment() {},
      send(raw) { this.messages.push(JSON.parse(raw)); },
    },
  };
}

test("rate-limited and read-only player commands do not write the room", async () => {
  const now = Date.now();
  const engine = twoPlayerRoom(now);
  const { room, storage, ready } = durableRoom(engine.serialize());
  await ready();
  room.engine.connections.set("friend-socket", "friend");
  const { socket, attachment } = playerSocket("friend");

  for (let sequence = 1; sequence <= 100; sequence += 1) {
    await room.handleCommand(socket, attachment, {
      id: `sync-${sequence}`, sequence, action: "sync", payload: {},
    });
  }
  assert.equal(storage.writes, 0, "a player's sync reads without writing");
  const replies = socket.messages.filter(({ type }) => type !== "state");
  assert.ok(replies.filter(({ type }) => type === "ack").length >= PLAYER_COMMAND_BURST);
  const limited = replies.filter(({ code }) => code === "COMMAND_RATE_LIMITED");
  assert.ok(limited.length > 0 && limited.every(({ retryable }) => retryable === true));

  // Rejected commands keep their durable error receipt only within budget.
  const flood = durableRoom(engine.serialize());
  await flood.ready();
  for (let sequence = 1; sequence <= 60; sequence += 1) {
    await flood.room.handleCommand(socket, attachment, {
      id: `ai-${sequence}`, sequence, action: "attach_ai", payload: { modelId: "b10" },
    });
  }
  const codes = socket.messages.slice(-60).map(({ code }) => code);
  assert.ok(codes.slice(0, PLAYER_COMMAND_BURST).every((code) => code === "FORBIDDEN"));
  assert.ok(codes.slice(PLAYER_COMMAND_BURST + 1).every((code) => code === "COMMAND_RATE_LIMITED"));
  const writesAtLimit = flood.storage.writes;
  assert.ok(writesAtLimit <= PLAYER_COMMAND_BURST + 1);
  assert.equal(flood.storage.value.receipts.length, writesAtLimit);
});

test("dead-stone marks are capped per scoring session", () => {
  const room = RoomEngine.create({
    code: "BUD234", name: "Host", size: 5, playerId: "host", tokenHash: "a".repeat(64), now: 1_000,
  });
  room.join({ name: "Friend", role: "player", playerId: "friend", tokenHash: "b".repeat(64), now: 1_000 });
  const act = (playerId, action, payload = {}) =>
    room.applyAction({ playerId, action, payload, now: 2_000 });
  act("host", "play", { row: 0, col: 0 });
  act("friend", "pass");
  act("host", "pass");
  const limit = DEAD_STONE_TOGGLES_PER_POINT * 5 * 5;
  for (let index = 0; index < limit; index += 1) {
    act(index % 2 ? "host" : "friend", "toggle_dead", { row: 0, col: 0 });
  }
  const eventsAtLimit = room.game.replay.events.length;
  assert.throws(
    () => act("friend", "toggle_dead", { row: 0, col: 0 }),
    (error) => error instanceof RoomEngineError && error.code === "SCORING_TOGGLE_LIMIT" &&
      typeof error.message === "string",
  );
  assert.equal(room.game.replay.events.length, eventsAtLimit);
  // Resuming play and passing again opens a fresh scoring session.
  act("host", "resume_play");
  act(room.game.currentPlayer === "black" ? "host" : "friend", "pass");
  act(room.game.currentPlayer === "black" ? "host" : "friend", "pass");
  assert.equal(room.game.phase, "scoring");
  act("friend", "toggle_dead", { row: 0, col: 0 });
});

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.attachment = null;
    this.messages = [];
  }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment; }
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
}

function withFakeWebSockets(t) {
  const originalPair = globalThis.WebSocketPair;
  const OriginalResponse = globalThis.Response;
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  };
  // Node's Response refuses 101; keep the upgrade status visible to tests.
  globalThis.Response = class extends OriginalResponse {
    constructor(body, init = {}) {
      super(body, init.status === 101 ? { ...init, status: 200 } : init);
      if (init.status === 101) Object.defineProperty(this, "status", { value: 101 });
    }
  };
  t.after(() => {
    globalThis.WebSocketPair = originalPair;
    globalThis.Response = OriginalResponse;
  });
}

async function openSocket(room, token) {
  const encoded = Buffer.from(token).toString("base64url");
  const response = await room.fetch(new Request("https://room.test/api/rooms/BUD234/socket", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `bamboo-baduk-v2, token.${encoded}` },
  }));
  assert.equal(response.status, 101);
}

test("socket churn writes only reservations, stale connections and spectator grace", async (t) => {
  withFakeWebSockets(t);
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const tokens = { host: "host-secret", friend: "friend-secret", viewer: "viewer-secret" };
  const engine = RoomEngine.create({
    code: "BUD234", name: "Host", size: 9, playerId: "host",
    tokenHash: await hashRoomToken(tokens.host),
  });
  engine.join({ name: "Friend", role: "player", playerId: "friend", tokenHash: await hashRoomToken(tokens.friend) });
  engine.join({ name: "Viewer", role: "spectator", playerId: "viewer", tokenHash: await hashRoomToken(tokens.viewer) });
  const { room, storage, ready, sockets } = durableRoom(engine.serialize());
  await ready();
  const latest = (playerId) => sockets.filter((socket) =>
    socket.attachment?.identity?.playerId === playerId).at(-1);
  const close = (playerId) => room.webSocketClose(latest(playerId), 1000, "bye");

  // First connections are always recorded: reservations must not expire.
  for (const playerId of ["host", "friend", "viewer"]) await openSocket(room, tokens[playerId]);
  assert.equal(storage.writes, 3);
  assert.equal(storage.value.members.find(({ playerId }) => playerId === "friend").lastConnectedAt
    !== null, true);

  // Quick player reconnects only change presence.
  t.mock.timers.tick(5_000);
  await close("friend");
  await openSocket(room, tokens.friend);
  await openSocket(room, tokens.host); // replaces the host's own session
  assert.equal(storage.writes, 3);

  // A spectator going offline always records the start of its grace.
  await close("viewer");
  assert.equal(storage.writes, 4);
  await openSocket(room, tokens.viewer);
  assert.equal(storage.writes, 4);
  await close("viewer");
  assert.equal(storage.writes, 5);
  const offlineAt = Date.now();

  t.mock.timers.tick(CONNECTION_WRITE_INTERVAL_MS);
  await openSocket(room, tokens.friend);
  assert.equal(storage.writes, 6, "a stale stored connection is refreshed");

  // A restarted object restores the reservation and the full grace.
  const restarted = durableRoom(storage.value, []);
  await restarted.ready();
  t.mock.timers.tick(SPECTATOR_RECONNECT_GRACE_MS - CONNECTION_WRITE_INTERVAL_MS - 1_000);
  assert.ok(restarted.room.engine.advance(Date.now()).changed === false);
  assert.ok(restarted.room.engine.member("viewer"));
  assert.ok(restarted.room.engine.member("friend"));
  t.mock.timers.tick(PLAYER_RESERVATION_TTL_MS);
  assert.ok(Date.now() > offlineAt + SPECTATOR_RECONNECT_GRACE_MS);
  assert.equal(restarted.room.engine.advance(Date.now()).evictedSpectators, 1);
  assert.ok(restarted.room.engine.member("friend"), "a connected player is never a reservation");
});

test("host presence that opens or closes the lobby seat is written and published", async (t) => {
  withFakeWebSockets(t);
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const { BadukLobby } = await import("../worker/BadukLobby.js");
  const lobby = new BadukLobby({
    blockConcurrencyWhile: (initialize) => initialize(),
    storage: { async get() { return null; }, async put() {} },
    abort() { throw new Error("Lobby reset"); },
  });
  await lobby.ready;
  const tokens = { host: "host-secret", friend: "friend-secret" };
  const engine = RoomEngine.create({
    code: "BUD234", name: "Host", size: 9, playerId: "host",
    tokenHash: await hashRoomToken(tokens.host), startImmediately: false,
  });
  const sockets = [];
  let ready;
  const pending = [];
  const storage = {
    value: engine.serialize(), writes: 0, alarm: null,
    async get() { return structuredClone(this.value); },
    async put(_key, value) { this.writes += 1; this.value = structuredClone(value); },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
  };
  const room = new BadukRoom({
    storage,
    id: { toString: () => "joinable-room" },
    getWebSockets: () => sockets.filter((socket) => socket.readyState < 2),
    acceptWebSocket(socket) { sockets.push(socket); },
    blockConcurrencyWhile(callback) { ready = callback(); },
    waitUntil(promise) { pending.push(promise); },
  }, { BADUK_ROOM_INDEX: { getByName: () => lobby } });
  await ready;
  const settle = () => Promise.all(pending.splice(0));
  const joinable = async () => { await settle(); return lobby.rooms.get("BUD234").joinable; };
  const close = (playerId) => room.webSocketClose(sockets.filter((socket) =>
    socket.attachment?.identity?.playerId === playerId).at(-1), 1000, "bye");

  assert.equal(await joinable(), false, "a created room whose host never connected");
  await openSocket(room, tokens.host);
  assert.equal(await joinable(), true);
  const writes = storage.writes;

  t.mock.timers.tick(1_000);
  await close("host");
  assert.equal(storage.writes, writes + 1, "the host leaving the page closes the seat");
  assert.equal(await joinable(), false);
  await openSocket(room, tokens.host);
  assert.equal(storage.writes, writes + 2, "a quick return reopens it despite the write interval");
  assert.equal(await joinable(), true);

  // Once the white seat is taken, presence no longer changes the listing.
  room.engine.join({
    name: "Friend", role: "player", playerId: "friend", tokenHash: await hashRoomToken(tokens.friend),
  });
  await room.persist();
  assert.equal(await joinable(), false);
  await openSocket(room, tokens.friend);
  const settled = storage.writes;
  await close("friend");
  await close("host");
  assert.equal(storage.writes, settled);
});

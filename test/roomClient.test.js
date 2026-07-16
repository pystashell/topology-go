import test from "node:test";
import assert from "node:assert/strict";

import {
  CONNECTION_STATUS,
  RoomClient,
  buildCommandEnvelope,
  buildShareUrl,
  buildSocketUrl,
  createTokenStore,
  decodeTokenProtocol,
  encodeTokenProtocol,
  normalizePlayerName,
  normalizeRoomCode,
  parseShareUrl,
} from "../src/multiplayer/roomClient.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

class MockWebSocket {
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.protocol = "";
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.protocol = this.protocols[0];
    this.emit("open");
  }

  message(value) {
    this.emit("message", {
      data: typeof value === "string" ? value : JSON.stringify(value),
    });
  }

  send(value) {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(value);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    },
  };
}

test("room codes, player names, and share links normalize predictably", () => {
  assert.equal(normalizeRoomCode(" ab12cd "), "AB12CD");
  assert.equal(normalizeRoomCode("bad-code"), "");
  assert.equal(normalizePlayerName("  竹筒   棋友  "), "竹筒 棋友");

  const shareUrl = buildShareUrl(
    "ab12cd",
    "https://baduk.example/play?theme=bamboo#old",
  );
  assert.equal(
    shareUrl,
    "https://baduk.example/play?theme=bamboo&room=AB12CD",
  );
  assert.deepEqual(parseShareUrl(shareUrl), {
    roomCode: "AB12CD",
    name: "",
    role: "",
  });
  assert.equal(
    parseShareUrl("https://baduk.example/room/xy99zz").roomCode,
    "XY99ZZ",
  );
  assert.equal(
    parseShareUrl("#room=QW12ER", "https://baduk.example/play").roomCode,
    "QW12ER",
  );
});

test("token subprotocol is WebSocket-safe and reversible", () => {
  const token = "session/token+含中文==";
  const protocol = encodeTokenProtocol(token);
  assert.match(protocol, /^token\.[A-Za-z0-9_-]+$/u);
  assert.equal(decodeTokenProtocol(protocol), token);
  assert.equal(
    buildSocketUrl("AB12CD", "https://baduk.example/play"),
    "wss://baduk.example/api/rooms/AB12CD/socket",
  );
});

test("the injectable token store persists and removes a room session", () => {
  const storage = createMemoryStorage();
  const store = createTokenStore(storage, { prefix: "test." });
  const session = { code: "AB12CD", token: "secret", nextSequence: 7 };

  assert.equal(store.set("ab12cd", session), true);
  assert.deepEqual(store.get("AB12CD"), session);
  assert.equal(store.remove("AB12CD"), true);
  assert.equal(store.get("AB12CD"), null);
});

test("command envelopes use a stable id and increasing sequence", () => {
  assert.deepEqual(buildCommandEnvelope("move-7", 7, "play", { row: 2, col: 3 }), {
    v: 1,
    type: "command",
    id: "move-7",
    sequence: 7,
    action: "play",
    payload: { row: 2, col: 3 },
  });
});

test("RoomClient creates a room, emits state, and resolves commands on ACK", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const requests = [];
  const states = [];
  const statuses = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    locationHref: "https://baduk.example/play",
    storage,
    WebSocketImpl: MockWebSocket,
    commandAckTimeoutMs: 0,
    idFactory: () => "move-1",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(
        {
          roomCode: "AB12CD",
          session: {
            code: "AB12CD",
            token: "token/with+symbols",
            playerId: "player-1",
            playerName: "青竹",
            role: "player",
            color: "black",
          },
          room: { code: "AB12CD", revision: 0 },
        },
        201,
      );
    },
  });
  client.on("state", (event) => states.push(event));
  client.on("status", (event) => statuses.push(event.status));

  const result = await client.createRoom({ name: " 青竹 ", size: 13 });
  assert.equal(requests[0].url, "https://baduk.example/api/rooms");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    v: 1,
    name: "青竹",
    size: 13,
  });
  assert.equal(result.roomCode, "AB12CD");
  assert.equal(result.shareUrl, "https://baduk.example/play?room=AB12CD");
  assert.equal(client.code, "AB12CD");
  assert.equal(client.status, CONNECTION_STATUS.CONNECTING);
  assert.equal(states[0].room.revision, 0);

  const socket = MockWebSocket.instances[0];
  assert.equal(socket.url, "wss://baduk.example/api/rooms/AB12CD/socket");
  assert.deepEqual(socket.protocols, [
    "bamboo-baduk-v1",
    encodeTokenProtocol("token/with+symbols"),
  ]);
  socket.open();
  assert.equal(client.status, CONNECTION_STATUS.CONNECTED);

  socket.message({
    v: 1,
    type: "state",
    room: { code: "AB12CD", revision: 1 },
    serverTime: 1234,
  });
  assert.equal(states.at(-1).room.revision, 1);
  assert.equal(states.at(-1).serverTime, 1234);

  const commandPromise = client.command("play", { row: 4, col: 5 });
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    v: 1,
    type: "command",
    id: "move-1",
    sequence: 1,
    action: "play",
    payload: { row: 4, col: 5 },
  });
  socket.message({ type: "ack", id: "move-1", sequence: 1, ok: true });
  assert.equal((await commandPromise).ok, true);
  assert.ok(statuses.includes(CONNECTION_STATUS.CONNECTED));
  assert.equal(createTokenStore(storage).get("AB12CD").nextSequence, 2);
  client.disconnect();
});

test("RoomClient reconnects with capped exponential delay and resends pending commands", async () => {
  MockWebSocket.instances = [];
  const scheduled = [];
  const statuses = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    commandAckTimeoutMs: 0,
    idFactory: () => "pass-1",
    reconnect: {
      initialDelayMs: 100,
      maxDelayMs: 150,
      factor: 2,
      jitter: 0,
    },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      timer.cancelled = true;
    },
    fetchImpl: async () =>
      jsonResponse({
        session: { code: "ZX90CV", token: "secret", playerName: "白竹" },
        room: { code: "ZX90CV", revision: 0 },
      }),
  });
  client.on("connection", (event) => statuses.push(event));
  await client.joinRoom({ code: "ZX90CV", name: "白竹" });
  const firstSocket = MockWebSocket.instances[0];
  firstSocket.open();

  const pending = client.command("pass");
  assert.equal(firstSocket.sent.length, 1);
  firstSocket.close(1006, "network lost");
  assert.equal(scheduled[0].delay, 100);
  assert.equal(statuses.at(-1).status, CONNECTION_STATUS.RECONNECTING);
  assert.equal(statuses.at(-1).retryInMs, 100);

  scheduled[0].callback();
  const secondSocket = MockWebSocket.instances[1];
  secondSocket.open();
  assert.equal(secondSocket.sent.length, 1);
  assert.deepEqual(JSON.parse(secondSocket.sent[0]), JSON.parse(firstSocket.sent[0]));
  secondSocket.message({ type: "ack", id: "pass-1", sequence: 1, ok: true });
  await pending;
  client.disconnect();
});

test("a replaced session stops instead of reconnecting forever", async () => {
  MockWebSocket.instances = [];
  const scheduled = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    reconnect: { jitter: 0 },
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.at(-1);
    },
    clearTimeoutImpl() {},
    fetchImpl: async () =>
      jsonResponse({
        session: { code: "ZX90CV", token: "secret", playerName: "白竹" },
        room: { code: "ZX90CV", revision: 0 },
      }),
  });

  await client.joinRoom({ code: "ZX90CV", name: "白竹" });
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.close(4408, "Session replaced");

  assert.equal(client.connectionStatus, CONNECTION_STATUS.CLOSED);
  assert.equal(client.lastCloseCode, 4408);
  assert.equal(client.session.token, "secret");
  assert.equal(scheduled.length, 0);
  client.disconnect();
});

test("failed leave keeps the reconnect token and successful leave removes it", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage,
    WebSocketImpl: MockWebSocket,
    commandAckTimeoutMs: 0,
    idFactory: (() => {
      let id = 0;
      return () => `leave-${++id}`;
    })(),
    fetchImpl: async () =>
      jsonResponse({
        session: { code: "ZX90CV", token: "secret", playerName: "白竹" },
        room: { code: "ZX90CV", revision: 0 },
      }),
  });

  await client.joinRoom({ code: "ZX90CV", name: "白竹" });
  const socket = MockWebSocket.instances[0];
  socket.open();
  const failedLeave = client.leave({ timeoutMs: 0 });
  socket.message({
    type: "error",
    id: "leave-1",
    code: "TEMPORARY",
    message: "暂时无法退出。",
  });
  await assert.rejects(failedLeave, /暂时无法退出/u);
  assert.equal(client.session.token, "secret");
  assert.equal(createTokenStore(storage).get("ZX90CV").token, "secret");

  const successfulLeave = client.leave({ timeoutMs: 0 });
  socket.message({ type: "ack", id: "leave-2", sequence: 2, ok: true });
  await successfulLeave;
  assert.equal(client.session, null);
  assert.equal(createTokenStore(storage).get("ZX90CV"), null);
});

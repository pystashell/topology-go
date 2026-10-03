import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_HISTORY_MAX_BYTES } from "../src/multiplayer/chat.js";
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
  parseAppRoute,
  parseShareUrl,
} from "../src/multiplayer/roomClient.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function entryResponse(body, code = body.roomCode) {
  return jsonResponse({ roomCode: code, session: {
    code, playerId: body.playerId, token: body.token, playerName: body.name,
    role: body.role ?? "player", color: body.role === "spectator" ? null : "black",
  }, room: { code, revision: 0 } }, 201);
}

for (const action of ["create", "player", "spectator"]) {
  test(`cancelled ${action} ignores late success and can recover the exact identity in a new tab`, async () => {
    MockWebSocket.instances = [];
    const storage = createMemoryStorage();
    const delayed = deferred();
    const requests = [];
    const options = { storage, WebSocketImpl: MockWebSocket, roomCodeFactory: () => "AB23CD",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        requests.push(body);
        return requests.length === 1 ? delayed.promise : entryResponse(body, "AB23CD");
      } };
    const client = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
    const controller = new AbortController();
    const request = action === "create"
      ? client.createRoom({ name: "Alice", signal: controller.signal })
      : client.joinRoom("AB23CD", { name: "Alice", role: action, signal: controller.signal });
    const rejected = assert.rejects(request, { name: "AbortError" });
    controller.abort();
    client.disconnect({ preserveSession: false });
    const events = [];
    for (const type of ["state", "error", "connection"]) client.on(type, () => events.push(type));
    delayed.resolve(entryResponse(requests[0], "AB23CD"));
    await rejected;
    assert.deepEqual(events, []);
    assert.equal(client.session, null);
    assert.equal(client.roomCode, "");
    assert.equal(MockWebSocket.instances.length, 0);
    assert.equal(identityRecord(storage, "session", "AB23CD"), null);
    assert.equal("signal" in requests[0], false, "the cancellation control is never sent to the server");
    const retry = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
    const pending = action === "create" ? retry.listPendingCreates() : retry.listPendingJoins("AB23CD");
    assert.equal(pending.length, 1);
    const result = action === "create"
      ? await retry.retryPendingCreate("AB23CD", pending[0].playerId)
      : await retry.joinRoom("AB23CD", { name: "Alice", role: action, pendingPlayerId: pending[0].playerId });
    assert.equal(result.session.playerId, requests[0].playerId);
    assert.equal(result.session.token, requests[0].token);
    assert.equal(requests[1].playerId, requests[0].playerId);
    assert.equal(requests[1].token, requests[0].token);
    retry.disconnect();
  });

  for (const outcome of ["success", "network failure"]) {
    test(`cancelled ${action} late ${outcome} cannot replace a newer session`, async () => {
      MockWebSocket.instances = [];
      const delayed = deferred();
      const requests = [];
      const client = new RoomClient({ storage: createMemoryStorage(), attemptStorage: createMemoryStorage(),
        WebSocketImpl: MockWebSocket, roomCodeFactory: () => "AB23CD",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(init.body);
          requests.push(body);
          return requests.length === 1 ? delayed.promise : entryResponse(body, "EF34GH");
        } });
      const controller = new AbortController();
      const oldRequest = action === "create"
        ? client.createRoom({ name: "Old", signal: controller.signal })
        : client.joinRoom("AB23CD", { name: "Old", role: action, signal: controller.signal });
      const rejected = assert.rejects(oldRequest);
      controller.abort();
      client.disconnect({ preserveSession: false });
      const newer = await client.joinRoom("EF34GH", { name: "New", role: "spectator" });
      const events = [];
      for (const type of ["state", "error", "connection"]) client.on(type, () => events.push(type));
      if (outcome === "success") delayed.resolve(entryResponse(requests[0], "AB23CD"));
      else delayed.reject(new Error("response lost after commit"));
      await rejected;
      assert.equal(client.session.playerId, newer.session.playerId);
      assert.equal(client.roomCode, "EF34GH");
      assert.equal(client.status, CONNECTION_STATUS.CONNECTING);
      assert.equal(MockWebSocket.instances.length, 1);
      assert.deepEqual(events, []);
      assert.equal(action === "create" ? client.listPendingCreates().length : client.listPendingJoins("AB23CD").length, 1);
      client.disconnect();
    });
  }
}

test("repeated typed ROOM_NOT_FOUND responses remove only their pending join and tab pointer", async () => {
  const storage = createMemoryStorage();
  const attemptStorage = createMemoryStorage();
  const options = { storage, attemptStorage, fetchImpl: async () =>
    jsonResponse({ code: "ROOM_NOT_FOUND", message: "missing" }, 404) };
  const client = new RoomClient(options);
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(client.joinRoom("ZZZZZZ", { name: "Alice" }), { code: "ROOM_NOT_FOUND" });
    assert.deepEqual(client.listPendingJoins("ZZZZZZ"), []);
    assert.equal(client.activeJoinStore.get("ZZZZZZ"), null);
  }
  const reloaded = new RoomClient(options);
  assert.deepEqual(reloaded.listPendingJoins("ZZZZZZ"), []);
  assert.equal(reloaded.activeJoinStore.get("ZZZZZZ"), null);
});

test("a definite 404 preserves other identities, rooms, and a newer active join", async () => {
  const storage = createMemoryStorage();
  const attemptStorage = createMemoryStorage();
  const delayed = deferred();
  let count = 0;
  const options = { storage, attemptStorage, fetchImpl: async () => {
    if (++count === 3) return delayed.promise;
    throw new Error("lost response");
  } };
  const client = new RoomClient(options);
  await assert.rejects(client.joinRoom("AB23CD", { name: "Other identity" }));
  await assert.rejects(client.joinRoom("EF34GH", { name: "Other room" }));
  const first = client.listPendingJoins("AB23CD")[0];
  const failing = assert.rejects(client.joinRoom("AB23CD", { name: "Missing" }), { code: "ROOM_NOT_FOUND" });
  await assert.rejects(client.joinRoom("AB23CD", { name: "Newer" }));
  const newestPointer = client.activeJoinStore.get("AB23CD");
  delayed.resolve(jsonResponse({ code: "ROOM_NOT_FOUND" }, 404));
  await failing;
  const reloaded = new RoomClient(options);
  assert.deepEqual(reloaded.listPendingJoins("AB23CD").map(p => p.playerId).sort(),
    [first.playerId, newestPointer.playerId].sort());
  assert.deepEqual(reloaded.activeJoinStore.get("AB23CD"), newestPointer);
  assert.equal(reloaded.listPendingJoins("EF34GH").length, 1);
});

test("a late response clears its tab pointer even after another tab recovered the join", async () => {
  const storage = createMemoryStorage();
  const delayed = deferred();
  let original;
  const first = new RoomClient({ storage, attemptStorage: createMemoryStorage(), WebSocketImpl: MockWebSocket,
    fetchImpl: (_url, init) => { original = JSON.parse(init.body); return delayed.promise; } });
  const firstJoin = first.joinRoom("AB23CD", { name: "Alice" });
  const second = new RoomClient({ storage, attemptStorage: createMemoryStorage(), WebSocketImpl: MockWebSocket,
    fetchImpl: (_url, init) => entryResponse(JSON.parse(init.body), "AB23CD") });
  await second.joinRoom("AB23CD", { name: "Alice", pendingPlayerId: original.playerId });
  assert.deepEqual(first.listPendingJoins("AB23CD"), []);
  assert.equal(first.activeJoinStore.get("AB23CD").playerId, original.playerId);
  delayed.resolve(entryResponse(original, "AB23CD"));
  await firstJoin;
  assert.equal(first.activeJoinStore.get("AB23CD"), null);
  first.disconnect();
  second.disconnect();
});

for (const replaceRecord of [false, true]) {
  test(`404 cleanup checks the exact token for ${replaceRecord ? "identity and pointer" : "pointer"}`, async () => {
    const storage = createMemoryStorage();
    const client = new RoomClient({ storage, attemptStorage: createMemoryStorage(), fetchImpl: () => delayed.promise });
    const delayed = deferred();
    const rejected = assert.rejects(client.joinRoom("AB23CD", { name: "Alice" }), { code: "ROOM_NOT_FOUND" });
    const pending = identityRecord(storage, "pending-join", "AB23CD");
    const replacement = { ...pending, token: "f".repeat(64) };
    if (replaceRecord) client.pendingJoinIdentityStore.set("AB23CD", replacement);
    client.activeJoinStore.set("AB23CD", { playerId: pending.playerId, token: replacement.token });
    delayed.resolve(jsonResponse({ code: "ROOM_NOT_FOUND" }, 404));
    await rejected;
    assert.equal(client.activeJoinStore.get("AB23CD").token, replacement.token);
    assert.equal(client.listPendingJoins("AB23CD").length, replaceRecord ? 1 : 0);
  });
}

for (const response of [
  () => jsonResponse({ message: "proxy 404" }, 404),
  () => jsonResponse({ code: "ROOM_NOT_FOUND" }, 500),
  () => { throw new Error("lost response after commit"); },
]) {
  test("uncertain join failure retains a discoverable identity across tabs", async () => {
    const storage = createMemoryStorage();
    const client = new RoomClient({ storage, fetchImpl: response });
    await assert.rejects(client.joinRoom("AB23CD", { name: "Alice" }));
    const nextTab = new RoomClient({ storage, attemptStorage: createMemoryStorage() });
    assert.equal(nextTab.listPendingJoins("AB23CD").length, 1);
    assert.equal(nextTab.listPendingJoins("AB23CD")[0].playerId, client.listPendingJoins("AB23CD")[0].playerId);
  });
}

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
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    values,
  };
}

function identityRecord(storage, kind, code, playerId = "") {
  const prefix = `bamboo-baduk.${kind}-v3.${code}.`;
  const entry = [...storage.values.entries()].find(([key]) =>
    key.startsWith(prefix) && (!playerId || key === `${prefix}${playerId}`));
  return entry ? JSON.parse(entry[1]) : null;
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
      data:
        typeof value === "string"
          ? value
          : JSON.stringify({ v: 2, ...value }),
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
    "https://baduk.example/online/AB12CD",
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
    parseShareUrl("https://baduk.example/online/xy99zz").roomCode,
    "XY99ZZ",
  );
  assert.equal(
    parseShareUrl("#room=QW12ER", "https://baduk.example/play").roomCode,
    "QW12ER",
  );
});

test("app routes keep the hidden lobby separate from single and online play", () => {
  assert.deepEqual(parseAppRoute("https://baduk.example/"), {
    mode: "root",
    roomCode: "",
    role: "",
  });
  assert.deepEqual(parseAppRoute("https://baduk.example/single/"), {
    mode: "single",
    roomCode: "",
    role: "",
  });
  assert.deepEqual(
    parseAppRoute("https://baduk.example/online/ab12cd?role=spectator"),
    { mode: "online", roomCode: "AB12CD", role: "spectator" },
  );
  assert.deepEqual(
    parseAppRoute("https://baduk.example/online/ab12cd?role=player"),
    { mode: "online", roomCode: "AB12CD", role: "player" },
  );
  assert.deepEqual(
    parseAppRoute("https://baduk.example/online/ab12cd"),
    { mode: "online", roomCode: "AB12CD", role: "spectator" },
  );
  assert.deepEqual(parseAppRoute("https://baduk.example/lobby"), {
    mode: "lobby",
    roomCode: "",
    role: "",
  });
  assert.deepEqual(parseAppRoute("https://baduk.example/not-a-public-route"), {
    mode: "single",
    roomCode: "",
    role: "",
  });
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

test("join retries after a lost response reuse the identity even if name and role change", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) throw new Error("response lost after commit");
    return jsonResponse({
      roomCode: "ZX92CV",
      session: {
        code: "ZX92CV",
        token: body.token,
        playerId: body.playerId,
        playerName: "白竹",
        role: "player",
      },
      room: { code: "ZX92CV", revision: 1 },
    }, 201);
  };
  const options = {
    baseUrl: "https://baduk.example/",
    storage,
    WebSocketImpl: MockWebSocket,
    fetchImpl,
  };

  const firstClient = new RoomClient(options);
  await assert.rejects(firstClient.joinRoom("ZX92CV", { name: "白竹" }), {
    code: "NETWORK_ERROR",
    retryable: true,
  });
  const pending = identityRecord(storage, "pending-join", "ZX92CV");
  assert.match(pending.playerId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.match(pending.token, /^[0-9a-f]{64}$/u);
  assert.equal(requests[0].playerId, pending.playerId);
  assert.equal(requests[0].token, pending.token);

  const retryClient = new RoomClient(options);
  const joined = await retryClient.joinRoom("ZX92CV", {
    name: "新白竹", role: "spectator", pendingPlayerId: pending.playerId,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].playerId, requests[0].playerId);
  assert.equal(requests[1].token, requests[0].token);
  assert.equal(requests[1].name, "新白竹");
  assert.equal(requests[1].role, "spectator");
  assert.equal(joined.session.token, pending.token);
  assert.equal(joined.session.playerName, "白竹");
  assert.equal(joined.session.role, "player");
  assert.equal(identityRecord(storage, "pending-join", "ZX92CV"), null);
  assert.equal(identityRecord(storage, "session", "ZX92CV").playerId, pending.playerId);
  retryClient.disconnect();
});

test("join never reaches the server when retry credentials cannot be persisted", async () => {
  let requestCount = 0;
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: {
      getItem() { return null; },
      setItem() { throw new Error("storage disabled"); },
      removeItem() {},
    },
    WebSocketImpl: MockWebSocket,
    fetchImpl: async () => { requestCount += 1; return jsonResponse({}); },
  });
  await assert.rejects(client.joinRoom("ZX92CV", { name: "白竹" }), {
    code: "JOIN_CREDENTIAL_STORAGE_UNAVAILABLE",
  });
  assert.equal(requestCount, 0);
});

test("join keeps retry credentials when the accepted session cannot be stored", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const originalSetItem = storage.setItem;
  let blockSession = true;
  storage.setItem = (key, value) => {
    if (blockSession && key.startsWith("bamboo-baduk.session-v3.")) {
      throw new Error("quota exceeded");
    }
    originalSetItem(key, value);
  };
  const requests = [];
  const clientOptions = {
    baseUrl: "https://baduk.example/",
    storage,
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return jsonResponse({
        roomCode: "ZX92CV",
        session: {
          code: "ZX92CV", token: body.token, playerId: body.playerId,
          playerName: "白竹", role: "player",
        },
        room: { code: "ZX92CV", revision: 1 },
      }, 201);
    },
  };
  const firstClient = new RoomClient(clientOptions);
  await assert.rejects(firstClient.joinRoom("ZX92CV", { name: "白竹" }), {
    code: "SESSION_STORAGE_UNAVAILABLE",
  });
  assert.equal(MockWebSocket.instances.length, 0);
  assert.equal(firstClient.session, null);
  assert.equal(identityRecord(storage, "pending-join", "ZX92CV").playerId, requests[0].playerId);
  assert.equal(identityRecord(storage, "session", "ZX92CV"), null);

  blockSession = false;
  const retryClient = new RoomClient(clientOptions);
  const joined = await retryClient.joinRoom("ZX92CV", {
    name: "改名后重试", role: "spectator", pendingPlayerId: requests[0].playerId,
  });
  assert.equal(requests[1].playerId, requests[0].playerId);
  assert.equal(requests[1].token, requests[0].token);
  assert.equal(joined.session.role, "player");
  assert.equal(identityRecord(storage, "pending-join", "ZX92CV"), null);
  assert.equal(identityRecord(storage, "session", "ZX92CV").playerId, requests[0].playerId);
  retryClient.disconnect();
});

test("a parallel rejected join cannot erase another request's retry credential", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const firstTab = createMemoryStorage();
  const secondTab = createMemoryStorage();
  const requests = [];
  let rejectFirst;
  const clientOptions = {
    baseUrl: "https://baduk.example/",
    storage,
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) {
        return new Promise((_resolve, reject) => { rejectFirst = reject; });
      }
      if (requests.length === 2) {
        return jsonResponse({ error: "旁观席满", code: "SPECTATOR_FULL" }, 409);
      }
      return jsonResponse({
        roomCode: "ZX92CV",
        session: {
          code: "ZX92CV", token: body.token, playerId: body.playerId,
          playerName: "白竹", role: "player",
        },
        room: { code: "ZX92CV", revision: 1 },
      }, 201);
    },
  };
  const firstClient = new RoomClient({ ...clientOptions, attemptStorage: firstTab });
  const firstJoin = firstClient.joinRoom("ZX92CV", { name: "白竹", role: "player" });
  const secondClient = new RoomClient({ ...clientOptions, attemptStorage: secondTab });
  await assert.rejects(
    secondClient.joinRoom("ZX92CV", { name: "观众", role: "spectator" }),
    { code: "SPECTATOR_FULL", status: 409 },
  );
  assert.equal(identityRecord(storage, "pending-join", "ZX92CV", requests[0].playerId).playerId,
    requests[0].playerId);
  assert.notEqual(requests[1].playerId, requests[0].playerId);
  rejectFirst(new Error("response lost after white seat committed"));
  await assert.rejects(firstJoin, { code: "NETWORK_ERROR" });

  const retryClient = new RoomClient({ ...clientOptions, attemptStorage: firstTab });
  const joined = await retryClient.joinRoom("ZX92CV", {
    name: "白竹", role: "player", pendingPlayerId: requests[0].playerId,
  });
  assert.equal(requests[2].playerId, requests[0].playerId);
  assert.equal(requests[2].token, requests[0].token);
  assert.equal(joined.session.role, "player");
  retryClient.disconnect();
});

test("room clients can detect a resumable room without exposing its token", () => {
  const storage = createMemoryStorage();
  const tokenStore = createTokenStore(storage, { prefix: "test." });
  tokenStore.set("AB23CD", {
    code: "AB23CD", playerId: "9aa8a688-0414-4213-8059-d7734c5515ff",
    token: "secret", nextSequence: 1,
  });
  const client = new RoomClient({
    tokenStore, storage,
    fetchImpl: async () => jsonResponse({}),
    WebSocketImpl: MockWebSocket,
  });

  assert.equal(client.hasStoredSession("ab23cd"), true);
  assert.equal(client.hasStoredSession("bad-code"), false);
  assert.equal(client.hasStoredSession("ZZ99ZZ"), false);
});

test("command envelopes use a stable id and increasing sequence", () => {
  assert.deepEqual(buildCommandEnvelope("move-7", 7, "play", { row: 2, col: 3 }), {
    v: 2,
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
      const body = JSON.parse(init.body);
      return jsonResponse(
        {
          roomCode: body.roomCode,
          session: {
            code: body.roomCode,
            token: body.token,
            playerId: body.playerId,
            playerName: "青竹",
            role: "player",
            color: "black",
          },
          room: { code: body.roomCode, revision: 0, moveCount: 0, positionToken: "pos-initial" },
        },
        201,
      );
    },
  });
  client.on("state", (event) => states.push(event));
  client.on("status", (event) => statuses.push(event.status));

  const result = await client.createRoom({ name: " 青竹 ", size: 13 });
  const requestBody = JSON.parse(requests[0].init.body);
  assert.equal(requests[0].url, "https://baduk.example/api/rooms");
  assert.equal(requestBody.v, 2);
  assert.equal(requestBody.name, "青竹");
  assert.equal(requestBody.size, 13);
  assert.match(requestBody.roomCode, /^[A-HJ-NP-Z2-9]{6}$/u);
  assert.match(requestBody.token, /^[0-9a-f]{64}$/u);
  assert.equal(result.roomCode, requestBody.roomCode);
  assert.equal(result.shareUrl, `https://baduk.example/online/${requestBody.roomCode}`);
  assert.equal(client.code, requestBody.roomCode);
  assert.equal(client.status, CONNECTION_STATUS.CONNECTING);
  assert.equal(states[0].room.revision, 0);

  const socket = MockWebSocket.instances[0];
  assert.equal(socket.url, `wss://baduk.example/api/rooms/${requestBody.roomCode}/socket`);
  assert.deepEqual(socket.protocols, [
    "bamboo-baduk-v2",
    encodeTokenProtocol(requestBody.token),
  ]);
  socket.open();
  assert.equal(client.status, CONNECTION_STATUS.CONNECTED);

  socket.message({
    v: 2,
    type: "state",
    room: { code: requestBody.roomCode, revision: 1, moveCount: 0, positionToken: "pos-after-sync" },
    serverTime: 1234,
  });
  assert.equal(states.at(-1).room.revision, 1);
  assert.equal(states.at(-1).serverTime, 1234);

  const commandPromise = client.command("play", { row: 4, col: 5 });
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    v: 2,
    type: "command",
    id: "move-1",
    sequence: 1,
    action: "play",
    payload: { row: 4, col: 5, expectedMoveCount: 0, expectedPositionToken: "pos-after-sync" },
  });
  socket.message({ type: "ack", id: "move-1", sequence: 1, ok: true });
  assert.equal((await commandPromise).ok, true);
  assert.ok(statuses.includes(CONNECTION_STATUS.CONNECTED));
  assert.equal(identityRecord(storage, "session", requestBody.roomCode).nextSequence, 2);
  client.disconnect();
});

test("create does not reserve a host room when session storage is unavailable", async () => {
  let requests = 0;
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: {
      getItem() { return null; },
      setItem() { throw new Error("storage disabled"); },
      removeItem() {},
    },
    WebSocketImpl: MockWebSocket,
    fetchImpl: async () => { requests += 1; return jsonResponse({}); },
  });
  await assert.rejects(client.createRoom({ name: "青竹" }), {
    code: "CREATE_CREDENTIAL_STORAGE_UNAVAILABLE",
  });
  assert.equal(requests, 0);
});

test("a lost create response replays the same host identity and original settings", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const attemptStorage = createMemoryStorage();
  const requests = [];
  const options = {
    baseUrl: "https://baduk.example/",
    storage,
    attemptStorage,
    roomCodeFactory: () => "AB23CD",
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) throw new Error("create committed, response lost");
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token, playerId: body.playerId,
          playerName: body.name, role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 1 },
      }, 201);
    },
  };
  const firstClient = new RoomClient(options);
  await assert.rejects(firstClient.createRoom({
    name: "原房主", width: 13, height: 13, topology: "torus",
  }), { code: "NETWORK_ERROR", retryable: true });
  assert.equal(identityRecord(storage, "pending-create", "AB23CD").roomCode, "AB23CD");
  assert.equal(firstClient.hasStoredSession("AB23CD"), false);

  const retryClient = new RoomClient(options);
  const result = await retryClient.createRoom({
    name: "另一个名字", width: 19, height: 19, topology: "plane",
  });
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(result.resumedPending, true);
  assert.equal(result.session.playerName, "原房主");
  assert.equal(identityRecord(storage, "pending-create", "AB23CD"), null);
  assert.equal(identityRecord(storage, "session", "AB23CD").token, requests[0].token);
  retryClient.disconnect();
});

test("a fresh tab can find and retry one of several pending creates", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const requests = [];
  const base = {
    baseUrl: "https://baduk.example/",
    storage,
    WebSocketImpl: MockWebSocket,
  };
  for (const [code, name] of [["AB23CD", "房主甲"], ["EF34GH", "房主乙"]]) {
    const client = new RoomClient({
      ...base,
      attemptStorage: createMemoryStorage(),
      roomCodeFactory: () => code,
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        throw new Error("response lost");
      },
    });
    await assert.rejects(client.createRoom({ name, size: 13 }), { code: "NETWORK_ERROR" });
  }
  const restored = new RoomClient({
    ...base,
    attemptStorage: createMemoryStorage(),
    roomCodeFactory: () => "JK56LM",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token, playerId: body.playerId,
          playerName: body.name, role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 1 },
      }, 201);
    },
  });
  assert.deepEqual(restored.listPendingCreates().map(({ roomCode }) => roomCode),
    ["AB23CD", "EF34GH"]);
  const result = await restored.retryPendingCreate("AB23CD");
  assert.equal(result.roomCode, "AB23CD");
  assert.deepEqual(requests[2], requests[0]);
  assert.deepEqual(restored.listPendingCreates().map(({ roomCode }) => roomCode),
    ["EF34GH"]);
  restored.disconnect();
});

test("a second tab never overwrites a pending host credential when its random code collides", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const firstTab = createMemoryStorage();
  const secondTab = createMemoryStorage();
  const firstClient = new RoomClient({
    baseUrl: "https://baduk.example/", storage, attemptStorage: firstTab,
    roomCodeFactory: () => "AB23CD", WebSocketImpl: MockWebSocket,
    fetchImpl: async () => { throw new Error("response lost after commit"); },
  });
  await assert.rejects(firstClient.createRoom({ name: "原房主", size: 13 }), {
    code: "NETWORK_ERROR",
  });
  const originalPending = identityRecord(storage, "pending-create", "AB23CD");
  const codes = ["AB23CD", "EF34GH"];
  const requests = [];
  const secondClient = new RoomClient({
    baseUrl: "https://baduk.example/", storage, attemptStorage: secondTab,
    roomCodeFactory: () => codes.shift(), WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (body.roomCode === "AB23CD") {
        return jsonResponse({ code: "ROOM_CODE_TAKEN", error: "taken" }, 409);
      }
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token, playerId: body.playerId,
          playerName: body.name, role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 0 },
      }, 201);
    },
  });
  const second = await secondClient.createRoom({ name: "新房主", size: 5 });
  assert.equal(second.roomCode, "EF34GH");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].roomCode, "EF34GH");
  assert.deepEqual(identityRecord(storage, "pending-create", "AB23CD"), originalPending);
  assert.equal(firstClient.pendingCreateCode, "AB23CD");
  secondClient.disconnect();
});

test("a true room-code collision rotates the code without changing the pending settings", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const attemptStorage = createMemoryStorage();
  const requests = [];
  const base = {
    baseUrl: "https://baduk.example/", storage, attemptStorage,
    WebSocketImpl: MockWebSocket,
  };
  const firstClient = new RoomClient({
    ...base,
    roomCodeFactory: () => "AB23CD",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      throw new Error("response lost");
    },
  });
  await assert.rejects(firstClient.createRoom({
    name: "原房主", size: 13, topology: "torus",
  }), { code: "NETWORK_ERROR" });
  const retryClient = new RoomClient({
    ...base,
    roomCodeFactory: () => "EF34GH",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (body.roomCode === "AB23CD") {
        return jsonResponse({ code: "ROOM_CODE_TAKEN", error: "taken" }, 409);
      }
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token, playerId: body.playerId,
          playerName: body.name, role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 0 },
      }, 201);
    },
  });
  const result = await retryClient.createRoom({ name: "改名", size: 19, topology: "plane" });
  assert.equal(result.roomCode, "EF34GH");
  assert.equal(result.resumedPending, true);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[2].name, "原房主");
  assert.equal(requests[2].size, 13);
  assert.equal(requests[2].topology, "torus");
  assert.equal(identityRecord(storage, "pending-create", "AB23CD"), null);
  assert.equal(identityRecord(storage, "pending-create", "EF34GH"), null);
  retryClient.disconnect();
});

test("an invalid create can be explicitly abandoned before using new settings", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const attemptStorage = createMemoryStorage();
  const requests = [];
  const codes = ["AB23CD", "EF34GH"];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/", storage, attemptStorage,
    roomCodeFactory: () => codes.shift(),
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse({ code: "BAD_REQUEST", error: "invalid size" }, 400);
      }
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token, playerId: body.playerId,
          playerName: body.name, role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 0 },
      }, 201);
    },
  });
  await assert.rejects(client.createRoom({ name: "房主", size: 1 }), {
    code: "BAD_REQUEST", status: 400,
  });
  assert.equal(client.listPendingCreates().length, 1);
  const originalRemoveItem = storage.removeItem;
  storage.removeItem = () => { throw new Error("storage removal failed"); };
  assert.equal(client.abandonPendingCreate("AB23CD"), false);
  assert.equal(client.listPendingCreates().length, 1);
  storage.removeItem = originalRemoveItem;
  assert.equal(client.abandonPendingCreate("AB23CD"), true);
  assert.equal(client.listPendingCreates().length, 0);
  const result = await client.createRoom({ name: "房主", size: 5 });
  assert.equal(result.roomCode, "EF34GH");
  assert.equal(requests[1].size, 5);
  client.disconnect();
});

test("retryPendingCreate can use an in-memory tab pointer when sessionStorage is blocked", async () => {
  const storage = createMemoryStorage();
  const client = new RoomClient({ storage, attemptStorage: createMemoryStorage() });
  await assert.rejects(client.retryPendingCreate("AB23CD"), {
    code: "MISSING_PENDING_CREATE",
  });
  storage.setItem("bamboo-baduk.pending-create.AB23CD", JSON.stringify({
    roomCode: "AB23CD",
    token: "a".repeat(64), playerId: "9aa8a688-0414-4213-8059-d7734c5515ff",
    request: {
      v: 2, name: "房主", roomCode: "AB23CD", token: "a".repeat(64),
      playerId: "9aa8a688-0414-4213-8059-d7734c5515ff",
    },
  }));
  const blocked = new RoomClient({
    storage,
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      return jsonResponse({ roomCode: request.roomCode, session: {
        code: request.roomCode, playerId: request.playerId, token: request.token,
        playerName: request.name, role: "player", color: "black",
      }, room: { code: request.roomCode, revision: 0 } }, 201);
    },
    attemptStorage: {
      getItem() { return null; },
      setItem() { throw new Error("storage disabled"); },
      removeItem() {},
    },
  });
  assert.equal((await blocked.retryPendingCreate("AB23CD")).roomCode, "AB23CD");
  blocked.disconnect();
});

test("a host session stored under the fallback key survives refresh", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const originalSetItem = storage.setItem;
  let blockSession = false;
  storage.setItem = (key, value) => {
    if (blockSession && key.startsWith("bamboo-baduk.session-v3.")) {
      throw new Error("session key unavailable after preflight");
    }
    originalSetItem(key, value);
  };
  const options = {
    baseUrl: "https://baduk.example/",
    storage,
    attemptStorage: storage,
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      blockSession = true;
      return jsonResponse({
        roomCode: body.roomCode,
        session: {
          code: body.roomCode, token: body.token,
          playerId: body.playerId,
          playerName: "青竹", role: "player", color: "black",
        },
        room: { code: body.roomCode, revision: 1 },
      }, 201);
    },
  };
  const firstClient = new RoomClient(options);
  const created = await firstClient.createRoom({ name: "青竹" });
  const code = created.roomCode;
  assert.equal(created.recoverable, true);
  assert.equal(identityRecord(storage, "session", code), null);
  assert.equal(identityRecord(storage, "pending-create", code).token,
    created.session.token);
  firstClient.disconnect();

  const resumedClient = new RoomClient(options);
  assert.equal(resumedClient.hasStoredSession(code), true);
  assert.equal(resumedClient.resumeRoom(code), false);
  assert.equal(resumedClient.resumeRoom(code, created.session.playerId), true);
  assert.equal(resumedClient.identity.color, "black");
  resumedClient.disconnect();
  blockSession = false;
  const persistedClient = new RoomClient(options);
  assert.equal(persistedClient.resumeRoom(code, created.session.playerId), true);
  assert.equal(identityRecord(storage, "session", code).token, created.session.token);
  const socket = MockWebSocket.instances.at(-1);
  socket.open();
  socket.message({ type: "welcome", room: { code, revision: 1 } });
  assert.equal(identityRecord(storage, "pending-create", code), null);
  persistedClient.disconnect();
});

test("RoomClient rejects stale server envelopes before they reach the UI", async () => {
  MockWebSocket.instances = [];
  const states = [];
  const errors = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        session: {
          code: body.roomCode,
          token: body.token,
          playerId: body.playerId,
          playerName: "黑方",
        },
        room: { code: body.roomCode, revision: 0 },
      });
    },
  });
  client.on("state", (event) => states.push(event));
  client.on("error", (error) => errors.push(error));

  await client.createRoom({ name: "黑方" });
  const originalToken = client.session.token;
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.message({
    v: 1,
    type: "state",
    room: { code: "AB12CD", revision: 99, game: { topology: "mobius" } },
  });

  assert.equal(states.length, 1);
  assert.equal(client.room.revision, 0);
  assert.equal(errors.at(-1).code, "PROTOCOL_UPGRADE_REQUIRED");
  assert.equal(client.connectionStatus, CONNECTION_STATUS.DISCONNECTED);
  assert.equal(client.session.token, originalToken);
});

test("RoomClient sends chat independently and merges incremental chat events", async () => {
  MockWebSocket.instances = [];
  const chats = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    commandAckTimeoutMs: 0,
    idFactory: () => "chat-1",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        session: {
          code: body.roomCode,
          token: body.token,
          playerId: body.playerId,
          playerName: "黑方",
          role: "player",
          color: "black",
        },
        room: {
          code: body.roomCode,
          revision: 1,
          chat: { sequence: 0, messages: [] },
        },
      });
    },
  });
  client.on("chat", (event) => chats.push(event));
  await client.createRoom({ name: "黑方" });
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.message({ type: "welcome", room: client.room });

  const pending = client.sendChat({
    kind: "text",
    text: "D4 <script>只是文字</script> 😄",
  });
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    v: 2,
    type: "command",
    id: "chat-1",
    sequence: 1,
    action: "chat",
    payload: {
      kind: "text",
      text: "D4 <script>只是文字</script> 😄",
    },
  });
  socket.message({
    type: "ack",
    id: "chat-1",
    sequence: 1,
    ok: true,
    revision: 1,
  });
  await pending;

  const message = {
    id: "black:1",
    sequence: 1,
    senderId: "black",
    senderName: "黑方",
    senderRole: "player",
    senderColor: "black",
    kind: "text",
    text: "D4 <script>只是文字</script> 😄",
    points: [{ row: 5, col: 3, label: "D4" }],
    boardSize: 9,
    boardTopology: "cylinder",
    moveCount: 0,
    sentAt: 2_000,
  };
  socket.message({ type: "chat", message, chatSequence: 1, serverTime: 2_000 });
  socket.message({ type: "chat", message, chatSequence: 1, serverTime: 2_001 });
  assert.equal(chats.length, 1);
  assert.equal(client.room.chat.messages.length, 1);
  assert.equal(client.room.chat.messages[0].text, message.text);

  socket.message({
    type: "state",
    room: { code: "AB12CD", revision: 2 },
  });
  assert.equal(client.room.chat.messages.length, 1);

  for (let sequence = 2; sequence <= 80; sequence += 1) {
    socket.message({
      type: "chat",
      chatSequence: sequence,
      message: {
        ...message,
        id: `black:${sequence}`,
        sequence,
        text: "界".repeat(300),
        points: [],
        sentAt: 2_000 + sequence,
      },
    });
  }
  const chatBytes = new TextEncoder().encode(
    JSON.stringify(client.room.chat.messages),
  ).byteLength;
  assert.ok(chatBytes <= CHAT_HISTORY_MAX_BYTES);
  assert.ok(client.room.chat.messages.length < 80);
  assert.equal(client.room.chat.messages.at(-1).sequence, 80);

  const oversizedSnapshotMessages = Array.from({ length: 80 }, (_, index) => ({
    ...message,
    id: `white:${index + 81}`,
    sequence: index + 81,
    senderId: "white",
    senderName: "White",
    senderColor: "white",
    text: "界".repeat(300),
    points: [],
    sentAt: 3_000 + index,
  }));
  socket.message({
    type: "state",
    room: {
      code: "AB12CD",
      revision: 3,
      chat: { sequence: 160, messages: oversizedSnapshotMessages },
    },
  });
  const snapshotChatBytes = new TextEncoder().encode(
    JSON.stringify(client.room.chat.messages),
  ).byteLength;
  assert.ok(snapshotChatBytes <= CHAT_HISTORY_MAX_BYTES);
  assert.ok(client.room.chat.messages.length < oversizedSnapshotMessages.length);
  assert.equal(client.room.chat.messages.at(-1).sequence, 160);
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
    snapshotTimeoutMs: 0,
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
    fetchImpl: async (_url, init) =>
      jsonResponse({
        session: { code: "ZX92CV", token: JSON.parse(init.body).token,
          playerId: JSON.parse(init.body).playerId, playerName: "白竹" },
        room: { code: "ZX92CV", revision: 0, moveCount: 0, positionToken: "pos-first-round" },
      }),
  });
  client.on("connection", (event) => statuses.push(event));
  await client.joinRoom({ code: "ZX92CV", name: "白竹" });
  const firstSocket = MockWebSocket.instances[0];
  firstSocket.open();
  firstSocket.message({ type: "welcome", room: client.room });

  const pending = client.command("pass");
  assert.equal(firstSocket.sent.length, 1);
  assert.equal(JSON.parse(firstSocket.sent[0]).payload.expectedPositionToken, "pos-first-round");
  firstSocket.close(1006, "network lost");
  assert.equal(scheduled[0].delay, 100);
  assert.equal(statuses.at(-1).status, CONNECTION_STATUS.RECONNECTING);
  assert.equal(statuses.at(-1).retryInMs, 100);

  scheduled[0].callback();
  const secondSocket = MockWebSocket.instances[1];
  secondSocket.open();
  assert.equal(secondSocket.sent.length, 0);
  secondSocket.message({ type: "welcome", room: {
    code: "ZX92CV", revision: 3, moveCount: 0, positionToken: "pos-next-round",
  } });
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
    snapshotTimeoutMs: 0,
    reconnect: { jitter: 0 },
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.at(-1);
    },
    clearTimeoutImpl() {},
    fetchImpl: async (_url, init) =>
      jsonResponse({
        session: { code: "ZX92CV", token: JSON.parse(init.body).token,
          playerId: JSON.parse(init.body).playerId, playerName: "白竹" },
        room: { code: "ZX92CV", revision: 0 },
      }),
  });

  await client.joinRoom({ code: "ZX92CV", name: "白竹" });
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.close(4408, "Session replaced");

  assert.equal(client.connectionStatus, CONNECTION_STATUS.CLOSED);
  assert.equal(client.lastCloseCode, 4408);
  assert.match(client.session.token, /^[0-9a-f]{64}$/u);
  assert.equal(scheduled.length, 0);
  client.disconnect();
});

test("a socket that never sends its welcome snapshot times out and reconnects", async () => {
  MockWebSocket.instances = [];
  const scheduled = [];
  const errors = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    snapshotTimeoutMs: 25,
    reconnect: { initialDelayMs: 100, jitter: 0 },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { timer.cancelled = true; },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        roomCode: "ZX92CV",
        session: {
          code: "ZX92CV", token: body.token, playerId: body.playerId,
          playerName: "白竹", role: "player",
        },
        room: { code: "ZX92CV", revision: 0 },
      });
    },
  });
  client.on("error", (error) => errors.push(error));
  await client.joinRoom("ZX92CV", { name: "白竹" });
  const firstSocket = MockWebSocket.instances[0];
  firstSocket.open();
  assert.equal(scheduled[0].delay, 25);
  scheduled[0].callback();
  assert.equal(errors.at(-1).code, "SYNC_TIMEOUT");
  assert.equal(firstSocket.readyState, 3);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
  assert.equal(scheduled[1].delay, 100);
  scheduled[1].callback();
  const secondSocket = MockWebSocket.instances[1];
  secondSocket.open();
  secondSocket.message({ type: "welcome", room: { code: "ZX92CV", revision: 1 } });
  assert.equal(scheduled[2].cancelled, true);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  client.disconnect();
});

test("silent socket handshakes count against the reconnect attempt limit", async () => {
  MockWebSocket.instances = [];
  const scheduled = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket,
    snapshotTimeoutMs: 25,
    reconnect: { initialDelayMs: 100, jitter: 0, maxAttempts: 2 },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { timer.cancelled = true; },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({
        roomCode: "ZX92CV",
        session: { code: "ZX92CV", token: body.token, playerId: body.playerId },
        room: { code: "ZX92CV", revision: 0 },
      });
    },
  });
  await client.joinRoom("ZX92CV", { name: "白竹" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    MockWebSocket.instances[attempt].open();
    const watchdog = scheduled.at(-1);
    assert.equal(watchdog.delay, 25);
    watchdog.callback();
    if (attempt < 2) {
      assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
      const reconnect = scheduled.at(-1);
      assert.equal(reconnect.delay, 100 * 2 ** attempt);
      reconnect.callback();
    }
  }
  assert.equal(client.connectionStatus, CONNECTION_STATUS.DISCONNECTED);
  assert.equal(MockWebSocket.instances.length, 3);
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
    fetchImpl: async (_url, init) =>
      jsonResponse({
        session: { code: "ZX92CV", token: JSON.parse(init.body).token,
          playerId: JSON.parse(init.body).playerId, playerName: "白竹" },
        room: { code: "ZX92CV", revision: 0 },
      }),
  });

  await client.joinRoom({ code: "ZX92CV", name: "白竹" });
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
  assert.match(client.session.token, /^[0-9a-f]{64}$/u);
  assert.equal(identityRecord(storage, "session", "ZX92CV").token, client.session.token);

  const successfulLeave = client.leave({ timeoutMs: 0 });
  socket.message({ type: "ack", id: "leave-2", sequence: 2, ok: true });
  await successfulLeave;
  assert.equal(client.session, null);
  assert.equal(identityRecord(storage, "session", "ZX92CV"), null);
});

test("two tabs keep distinct room identities and a new tab must choose one", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    return jsonResponse({ roomCode: "AB23CD", session: {
      code: "AB23CD", playerId: body.playerId, token: body.token,
      playerName: body.name, role: body.role,
      color: body.role === "spectator" ? null : "white",
    }, room: { code: "AB23CD", revision: 1 } }, 201);
  };
  const options = { storage, fetchImpl, WebSocketImpl: MockWebSocket };
  const hostTab = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
  const watchTab = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
  const host = await hostTab.joinRoom("AB23CD", { name: "Alice", role: "player" });
  const watcher = await watchTab.joinRoom("AB23CD", { name: "Bob", role: "spectator" });
  assert.notEqual(host.session.playerId, watcher.session.playerId);
  const freshTab = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
  assert.equal(freshTab.listStoredSessions("AB23CD").length, 2);
  assert.equal(freshTab.resumeRoom("AB23CD"), false);
  hostTab.abandonRoom();
  assert.deepEqual(freshTab.listStoredSessions("AB23CD").map(({ playerId }) => playerId),
    [watcher.session.playerId]);
  assert.equal(freshTab.resumeRoom("AB23CD", watcher.session.playerId), true);
  freshTab.disconnect();
  watchTab.disconnect();
});

test("ordinary join after an uncertain join makes a new identity; explicit retry reuses the old one", async () => {
  const storage = createMemoryStorage();
  const requests = [];
  const client = new RoomClient({ storage, WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length < 3) throw new Error("response lost");
      return jsonResponse({ roomCode: "AB23CD", session: {
        code: "AB23CD", playerId: body.playerId, token: body.token,
        playerName: "Alice", role: "player",
      } }, 201);
    },
  });
  await assert.rejects(client.joinRoom("AB23CD", { name: "Alice" }), { code: "NETWORK_ERROR" });
  await assert.rejects(client.joinRoom("AB23CD", { name: "Bob", role: "spectator" }),
    { code: "NETWORK_ERROR" });
  assert.notEqual(requests[0].playerId, requests[1].playerId);
  assert.equal(client.listPendingJoins("AB23CD").length, 2);
  await client.joinRoom("AB23CD", {
    name: "Alice", pendingPlayerId: requests[0].playerId,
  });
  assert.equal(requests[2].playerId, requests[0].playerId);
  assert.equal(client.listPendingJoins("AB23CD").length, 1);
  client.disconnect();
});

test("a mismatched join response keeps the original pending credential", async () => {
  const storage = createMemoryStorage();
  const client = new RoomClient({ storage, WebSocketImpl: MockWebSocket,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({ roomCode: "AB23CD", session: {
        code: "AB23CD", playerId: body.playerId, token: "wrong-token",
      } }, 201);
    },
  });
  await assert.rejects(client.joinRoom("AB23CD", { name: "Alice" }),
    { code: "INVALID_SESSION_RESPONSE" });
  assert.equal(client.session, null);
  assert.equal(client.listPendingJoins("AB23CD").length, 1);
});

test("a failed sequence write never sends a command or advances its local sequence", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const client = new RoomClient({ storage, WebSocketImpl: MockWebSocket,
    roomCodeFactory: () => "AB23CD", commandAckTimeoutMs: 0,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({ roomCode: body.roomCode, session: {
        code: body.roomCode, playerId: body.playerId, token: body.token,
        playerName: body.name, role: "player", color: "black",
      }, room: { code: body.roomCode, revision: 0 } }, 201);
    },
  });
  await client.createRoom({ name: "Alice" });
  const socket = MockWebSocket.instances.at(-1);
  socket.open();
  socket.message({ type: "welcome", room: { code: "AB23CD", revision: 0 } });
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("bamboo-baduk.session-v3.")) throw Error("quota full");
    originalSet(key, value);
  };
  await assert.rejects(client.sendCommand("chat", { text: "hello" }),
    { code: "COMMAND_SEQUENCE_STORAGE_UNAVAILABLE" });
  assert.equal(socket.sent.length, 0);
  assert.equal(client.session.nextSequence, 1);
  storage.setItem = originalSet;
  client.disconnect();
});

test("a delayed create response cannot roll back a sequence used by the first tab", async () => {
  MockWebSocket.instances = [];
  const storage = createMemoryStorage();
  const replies = [];
  const fetchImpl = async (_url, init) => new Promise((resolve) => {
    replies.push({ body: JSON.parse(init.body), resolve });
  });
  const options = { storage, fetchImpl, WebSocketImpl: MockWebSocket,
    roomCodeFactory: () => "AB23CD", commandAckTimeoutMs: 0 };
  const first = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
  const firstCreate = first.createRoom({ name: "Alice" });
  const pending = first.listPendingCreates()[0];
  const second = new RoomClient({ ...options, attemptStorage: createMemoryStorage() });
  const delayedCreate = second.retryPendingCreate("AB23CD", pending.playerId);
  assert.equal(replies.length, 2);
  const respond = ({ body, resolve }) => resolve(jsonResponse({ roomCode: body.roomCode,
    session: { code: body.roomCode, playerId: body.playerId, token: body.token,
      playerName: body.name, role: "player", color: "black" },
    room: { code: body.roomCode, revision: 0 } }, 201));
  respond(replies[0]);
  await firstCreate;
  const socket = MockWebSocket.instances.at(-1);
  socket.open();
  socket.message({ type: "welcome", room: { code: "AB23CD", revision: 0 } });
  const sent = first.sendCommand("sync");
  socket.message({ type: "ack", id: JSON.parse(socket.sent[0]).id, sequence: 1, ok: true });
  await sent;
  assert.equal(identityRecord(storage, "session", "AB23CD").nextSequence, 2);
  respond(replies[1]);
  await delayedCreate;
  assert.equal(second.session.nextSequence, 2);
  assert.equal(identityRecord(storage, "session", "AB23CD").nextSequence, 2);
  first.disconnect();
  second.disconnect();
});

test("legacy migration cannot overwrite newer session or confirmed retry state", () => {
  const storage = createMemoryStorage();
  const code = "AB23CD";
  const playerId = "9aa8a688-0414-4213-8059-d7734c5515ff";
  const token = "a".repeat(64);
  const oldSession = { code, playerId, token, playerName: "Alice", nextSequence: 1 };
  createTokenStore(storage).set(code, oldSession);
  storage.setItem(`bamboo-baduk.session-v3.${code}.${playerId}`,
    JSON.stringify({ ...oldSession, nextSequence: 5 }));
  const oldPending = { roomCode: code, playerId, token,
    request: { v: 2, roomCode: code, playerId, token, name: "Alice" } };
  createTokenStore(storage, { prefix: "bamboo-baduk.pending-create." }).set(code, oldPending);
  storage.setItem(`bamboo-baduk.pending-create-v3.${code}.${playerId}`,
    JSON.stringify({ ...oldPending, confirmedSession: { ...oldSession, nextSequence: 7 } }));
  const originalRemove = storage.removeItem;
  storage.removeItem = (key) => {
    if (key === `bamboo-baduk.session.${code}` ||
        key === `bamboo-baduk.pending-create.${code}`) throw Error("blocked");
    originalRemove(key);
  };
  const client = new RoomClient({ storage, attemptStorage: createMemoryStorage() });
  for (let index = 0; index < 2; index += 1) {
    client.listStoredSessions(code);
    client.listPendingCreates();
    assert.equal(identityRecord(storage, "session", code).nextSequence, 5);
    assert.equal(identityRecord(storage, "pending-create", code).confirmedSession.nextSequence, 7);
  }
});

test("forgetting a room removes its exact fallback and reports a failed local deletion", async () => {
  const storage = createMemoryStorage();
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith("bamboo-baduk.session-v3.")) throw Error("quota full");
    originalSet(key, value);
  };
  const client = new RoomClient({ storage, attemptStorage: createMemoryStorage(),
    WebSocketImpl: MockWebSocket, roomCodeFactory: () => "AB23CD",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse({ roomCode: body.roomCode, session: {
        code: body.roomCode, playerId: body.playerId, token: body.token,
        playerName: body.name, role: "player", color: "black",
      } }, 201);
    },
  });
  await client.createRoom({ name: "Alice" });
  assert.equal(identityRecord(storage, "pending-create", "AB23CD") !== null, true);
  assert.equal(client.abandonRoom(), true);
  assert.equal(identityRecord(storage, "pending-create", "AB23CD"), null);
  const second = new RoomClient({ storage, WebSocketImpl: MockWebSocket,
    roomCodeFactory: () => "AB23CD",
    fetchImpl: client.fetchImpl,
  });
  storage.setItem = originalSet;
  await second.createRoom({ name: "Alice" });
  const originalRemove = storage.removeItem;
  storage.removeItem = (key) => {
    if (key.startsWith("bamboo-baduk.session-v3.")) throw Error("blocked");
    originalRemove(key);
  };
  assert.equal(second.abandonRoom(), false);
  assert.equal(second.lastCredentialCleanupFailed, true);
  assert.ok(identityRecord(storage, "session", "AB23CD"));
});

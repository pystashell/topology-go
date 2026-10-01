import assert from "node:assert/strict";
import test from "node:test";
import { BadukRoom } from "../worker/BadukRoom.js";
import worker from "../worker/index.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";

function savedRoom() {
  const now = Date.now();
  const engine = RoomEngine.create({ code: "BAM234", name: "Black", size: 5,
    playerId: "black", tokenHash: "a".repeat(64), now });
  engine.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now });
  return engine.serialize();
}

function savedHostRoom() {
  return RoomEngine.create({ code: "BAM234", name: "Black", size: 5,
    playerId: "black", tokenHash: "a".repeat(64), now: Date.now() }).serialize();
}

async function durable(stored) {
  let ready;
  const storage = {
    value: structuredClone(stored), writes: 0, deletes: 0, alarm: null,
    async get() { return structuredClone(this.value); },
    async put(key, value) { this.writes++; this.value = structuredClone(value); },
    async deleteAll() { this.deletes++; this.value = null; },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
  };
  const ctx = { storage, id: { toString: () => "test-room" }, getWebSockets: () => [],
    blockConcurrencyWhile(fn) { ready = fn(); } };
  const room = new BadukRoom(ctx, {});
  await ready;
  return { room, storage };
}

const attachment = { connectionId: "black-socket", identity: { playerId: "black", role: "player", color: "black" } };
const command = { id: "move-1", sequence: 1, action: "play", payload: { row: 0, col: 0 } };
function freshCommand(room) {
  return { ...command, payload: { ...command.payload,
    expectedMoveCount: room.engine.state.moveCount,
    expectedPositionToken: room.engine.snapshot().positionToken } };
}
function socket() {
  return { readyState: 1, messages: [], deserializeAttachment: () => attachment,
    send(text) { this.messages.push(JSON.parse(text)); } };
}

for (const failure of ["schema", "board", "restore exception"]) {
  test(`restore ${failure} retains the exact stored snapshot and blocks reinitialization`, async (t) => {
    t.mock.method(console, "error", () => {});
    const original = savedRoom();
    if (failure === "schema") original.schemaVersion = 999;
    if (failure === "board") original.game.board = [];
    if (failure === "restore exception") t.mock.method(RoomEngine, "restore", () => { throw new TypeError("injected restore bug"); });
    const { room, storage } = await durable(original);
    for (const path of ["/internal/health", "/internal/init", "/internal/join"]) {
      const response = await room.fetch(new Request("https://room.test" + path, { method: "POST", body: "{}" }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "ROOM_RESTORE_FAILED");
    }
    assert.deepEqual(storage.value, original);
    assert.equal(storage.deletes, 0);
    assert.equal(storage.writes, 0);
  });
}

for (const failure of ["serialize", "put rejects before commit", "put rejects after commit"]) {
  test(`${failure} cannot replay an unconfirmed in-memory success receipt`, async (t) => {
    t.mock.method(console, "error", () => {});
    const original = savedRoom();
    const { room, storage } = await durable(original);
    const move = freshCommand(room);
    if (failure === "serialize") t.mock.method(room.engine, "serialize", () => { throw new TypeError("not serializable"); });
    else t.mock.method(storage, "put", async (key, value) => {
      storage.writes++;
      if (failure.endsWith("after commit")) storage.value = structuredClone(value);
      throw new Error("write outcome unknown");
    });
    const client = socket();
    await room.handleCommand(client, attachment, move);
    await room.handleCommand(client, attachment, move);
    assert.equal(client.messages.some(message => message.type === "ack"), false);
    assert.ok(client.messages.every(message => message.code === "ROOM_COMMIT_FAILED"));
    assert.equal(room.engine, null);
    assert.equal(storage.writes, failure === "serialize" ? 0 : 1);
    assert.equal(storage.deletes, 0);
    const recovered = await durable(storage.value);
    const committed = failure.endsWith("after commit");
    assert.equal(recovered.room.engine.game.board[0][0], committed ? "black" : null);
    assert.equal(recovered.room.engine.inspectCommand("black", command.id, 1).kind, committed ? "duplicate" : "new");
    if (!committed) assert.deepEqual(storage.value, original);
  });
}

test("an alarm failure after commit does not send an error or overwrite the success receipt", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedRoom());
  const move = freshCommand(room);
  t.mock.method(room, "scheduleAlarm", async () => { throw new Error("alarm unavailable"); });
  const client = socket();
  await room.handleCommand(client, attachment, move);
  await room.handleCommand(client, attachment, move);
  assert.deepEqual(client.messages.map(message => message.type), ["ack", "ack"]);
  assert.equal(storage.writes, 1);
  assert.equal(storage.value.game.board[0][0], "black");
  assert.equal(storage.value.receipts[0].ok, true);
});

test("stale scoring rejection sends the current proposal and persists an error receipt", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedRoom());
  room.engine.applyAction({ playerId: "black", action: "pass" });
  room.engine.applyAction({ playerId: "white", action: "pass" });
  const client = socket();
  await room.handleCommand(client, attachment, { id: "confirm-1", sequence: 1, action: "finish_scoring", payload: { expectedScoringToken: "old" } });
  assert.deepEqual(client.messages.map(message => message.type), ["error", "state"]);
  assert.equal(client.messages[0].code, "STALE_SCORING");
  assert.equal(client.messages[1].room.scoringToken, room.engine.scoringToken());
  assert.equal(storage.value.receipts[0].ok, false);
});

test("stale human turn actions are rejected before mutation and receive current state", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const action of ["play", "pass", "resign", "toggle_dead", "resume_play", "request_undo"]) {
    const { room, storage } = await durable(savedRoom());
    const before = room.engine.snapshot();
    const client = socket();
    await room.handleCommand(client, attachment, {
      id: `stale-${action}`, sequence: 1, action,
      payload: { row: 0, col: 0, expectedMoveCount: before.moveCount,
        expectedPositionToken: "pos-from-an-old-round" },
    });
    assert.deepEqual(client.messages.map(message => message.type), ["error", "state"]);
    assert.equal(client.messages[0].code, "STALE_GAME_STATE");
    assert.equal(client.messages[1].room.positionToken, before.positionToken);
    assert.deepEqual(room.engine.game.board, before.game.board);
    assert.equal(storage.value.receipts[0].ok, false);
  }
});

test("old player commands without position preconditions ask for a client refresh", async () => {
  const { room } = await durable(savedRoom());
  const before = room.engine.snapshot();
  const client = socket();
  await room.handleCommand(client, attachment, command);
  assert.equal(client.messages[0].type, "error");
  assert.equal(client.messages[0].code, "PROTOCOL_UPGRADE_REQUIRED");
  assert.deepEqual(room.engine.game.board, before.game.board);
});

test("an already committed move keeps its ACK after the position changes", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room } = await durable(savedRoom());
  const move = freshCommand(room);
  const client = socket();
  await room.handleCommand(client, attachment, move);
  assert.equal(client.messages.at(-1).type, "ack");
  room.engine.applyAction({ playerId: "white", action: "pass" });
  assert.notEqual(room.engine.snapshot().positionToken, move.payload.expectedPositionToken);
  await room.handleCommand(client, attachment, move);
  assert.deepEqual(client.messages.filter(message => message.id === move.id).map(message => message.type), ["ack", "ack"]);
});

function joinRequest(body) {
  return new Request("https://room.test/api/rooms/BAM234/join", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 2, name: "White", role: "player", ...body }),
  });
}

function createRequest(body) {
  return new Request("https://room.test/api/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 2, name: "Black", size: 5, ...body }),
  });
}

function publicRoom(room) {
  return { BADUK_ROOMS: { getByName() { return { fetch: request => room.fetch(request) }; } } };
}

test("create recovers the same host after a committed write rejects", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(null);
  let rejectOnce = true;
  t.mock.method(storage, "put", async (_key, value) => {
    storage.writes += 1;
    storage.value = structuredClone(value);
    if (rejectOnce) { rejectOnce = false; throw new Error("response lost after commit"); }
  });
  const credentials = {
    roomCode: "BAM234", playerId: "123e4567-e89b-42d3-a456-426614174000",
    token: "c".repeat(64),
  };
  const env = publicRoom(room);
  const first = await worker.fetch(createRequest(credentials), env);
  assert.equal(first.status, 201);
  const firstSession = (await first.json()).session;
  assert.equal(firstSession.color, "black");
  assert.equal(firstSession.token, credentials.token);
  const retry = await worker.fetch(createRequest({
    ...credentials, name: "Changed", size: 9,
  }), env);
  assert.equal(retry.status, 201);
  const retriedSession = (await retry.json()).session;
  assert.equal(retriedSession.playerId, credentials.playerId);
  assert.equal(retriedSession.playerName, "Black");
  assert.equal(storage.value.members.filter(member => member.color === "black").length, 1);
  assert.equal(storage.writes, 1);
});

test("an uncommitted first-room write releases the object for an exact retry", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(null);
  let rejectOnce = true;
  t.mock.method(storage, "put", async (_key, value) => {
    storage.writes += 1;
    if (rejectOnce) { rejectOnce = false; throw new Error("write did not commit"); }
    storage.value = structuredClone(value);
  });
  const credentials = {
    roomCode: "BAM234", playerId: "123e4567-e89b-42d3-a456-426614174001",
    token: "c".repeat(64),
  };
  const env = publicRoom(room);
  const first = await worker.fetch(createRequest(credentials), env);
  assert.equal(first.status, 503);
  assert.equal(storage.value, null);
  assert.equal(room.unavailableError, null);
  const retry = await worker.fetch(createRequest(credentials), env);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).session.playerId, credentials.playerId);
  assert.equal(storage.value.members.length, 1);
});

test("create response failure after commit reopens the stored host", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room } = await durable(null);
  const originalSnapshot = RoomEngine.prototype.snapshot;
  let rejectOnce = true;
  t.mock.method(RoomEngine.prototype, "snapshot", function (...args) {
    if (rejectOnce) { rejectOnce = false; throw new Error("snapshot failed after commit"); }
    return originalSnapshot.apply(this, args);
  });
  const credentials = {
    roomCode: "BAM234", playerId: "123e4567-e89b-42d3-a456-426614174002",
    token: "c".repeat(64),
  };
  const response = await worker.fetch(createRequest(credentials), publicRoom(room));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).session.color, "black");
  assert.equal(room.engine.member(credentials.playerId).color, "black");
  assert.equal(room.unavailableError, null);
});

test("create distinguishes a real room-code collision from its own retry", async () => {
  const { room } = await durable(savedHostRoom());
  const credentials = {
    roomCode: "BAM234", playerId: "123e4567-e89b-42d3-a456-426614174003",
    token: "c".repeat(64),
  };
  const response = await worker.fetch(createRequest(credentials), publicRoom(room));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ROOM_CODE_TAKEN");
});

function internalJoin(body) {
  return new Request("https://room.test/internal/join", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("unexpected join failure discards the speculative seat before recovering for another join", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedHostRoom());
  t.mock.method(room.engine, "snapshotFor", () => {
    throw new Error("snapshot failed after membership changed");
  });
  const first = await room.fetch(internalJoin({
    name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64),
  }));
  assert.equal(first.status, 503);
  assert.equal((await first.json()).code, "ROOM_COMMIT_FAILED");
  assert.equal(room.engine, null);
  assert.equal(storage.value.members.some(member => member.color === "white"), false);
  const second = await room.fetch(internalJoin({
    name: "Other", role: "player", playerId: "other", tokenHash: "c".repeat(64),
  }));
  assert.equal(second.status, 201);
  assert.equal(storage.writes, 1);
  assert.equal(room.engine.member("white"), undefined);
  assert.equal(room.engine.member("other").color, "white");
});

test("a healthy room resolves identical creates in memory and rejects other identities without storage reads", async (t) => {
  const { room, storage } = await durable(savedHostRoom());
  let reads = 0;
  const originalGet = storage.get.bind(storage);
  t.mock.method(storage, "get", async (...args) => {
    reads += 1;
    return originalGet(...args);
  });
  const env = publicRoom(room);
  const credentials = {
    roomCode: "BAM234", playerId: "black", token: "a".repeat(64),
  };
  // savedHostRoom stores a token hash, so an HTTP credential that hashes to it
  // cannot be constructed. Exercise the authoritative internal route instead.
  const same = await room.fetch(new Request("https://room.test/internal/init", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "BAM234", playerId: "black", tokenHash: "a".repeat(64), name: "Changed" }),
  }));
  assert.equal(same.status, 201);
  assert.equal((await same.json()).identity.playerName, "Black");
  for (let index = 0; index < 20; index += 1) {
    const conflict = await worker.fetch(createRequest({
      ...credentials, playerId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
    }), env);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "ROOM_CODE_TAKEN");
  }
  assert.equal(reads, 0);
});

test("the next request restores a committed command after an uncertain write", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedRoom());
  const move = freshCommand(room);
  t.mock.method(storage, "put", async (_key, value) => {
    storage.writes += 1;
    storage.value = structuredClone(value);
    throw new Error("commit succeeded but acknowledgement failed");
  });
  const client = socket();
  await room.handleCommand(client, attachment, move);
  assert.equal(room.engine, null);
  assert.equal(storage.value.game.board[0][0], "black");
  const health = await room.fetch(new Request("https://room.test/internal/health"));
  assert.equal(health.status, 200);
  assert.equal(room.unavailableError, null);
  assert.equal(room.engine.inspectCommand("black", move.id, move.sequence).kind, "duplicate");
});

test("idempotent joins do not rewrite or rebroadcast an unchanged room", async (t) => {
  const { room, storage } = await durable(savedHostRoom());
  let broadcasts = 0;
  t.mock.method(room, "broadcastState", () => { broadcasts += 1; });
  t.mock.method(room, "broadcastPresence", () => { broadcasts += 1; });
  const body = {
    name: "Observer", role: "spectator", playerId: "observer", tokenHash: "c".repeat(64),
  };
  const first = await room.fetch(internalJoin(body));
  assert.equal(first.status, 201);
  const revision = room.engine.state.revision;
  for (let retry = 0; retry < 20; retry += 1) {
    const response = await room.fetch(internalJoin(body));
    assert.equal(response.status, 201);
  }
  assert.equal(room.engine.state.revision, revision);
  assert.equal(storage.writes, 1);
  assert.equal(broadcasts, 2);
  assert.equal(storage.value.members.filter(member => member.playerId === "observer").length, 1);
});

test("join recovers the same white identity when put committed before rejecting", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedHostRoom());
  let rejectOnce = true;
  t.mock.method(storage, "put", async (key, value) => {
    storage.writes++;
    storage.value = structuredClone(value);
    if (rejectOnce) { rejectOnce = false; throw new Error("response lost after commit"); }
  });
  const credentials = { playerId: "123e4567-e89b-42d3-a456-426614174000", token: "c".repeat(64) };
  const env = publicRoom(room);
  const first = await worker.fetch(joinRequest(credentials), env);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.session.color, "white");
  assert.equal(firstBody.session.token, credentials.token);
  assert.equal(firstBody.session.playerId, credentials.playerId);
  assert.equal(room.unavailableError, null);
  const retry = await worker.fetch(joinRequest({
    ...credentials, name: "New White", role: "spectator",
  }), env);
  assert.equal(retry.status, 201);
  const retrySession = (await retry.json()).session;
  assert.equal(retrySession.playerId, credentials.playerId);
  assert.equal(retrySession.playerName, "White");
  assert.equal(retrySession.role, "player");
  assert.equal(storage.value.members.filter(member => member.color === "white").length, 1);
  const wrongToken = await worker.fetch(joinRequest({ ...credentials, token: "d".repeat(64) }), env);
  assert.equal(wrongToken.status, 409);
  assert.equal(storage.value.members.filter(member => member.color === "white").length, 1);
});

test("join can retry the same credential after both commit and recovery read fail", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedHostRoom());
  const originalGet = storage.get.bind(storage);
  let failReadOnce = true;
  t.mock.method(storage, "get", async (key) => {
    if (failReadOnce) {
      failReadOnce = false;
      throw new Error("recovery read unavailable");
    }
    return originalGet(key);
  });
  let failWriteOnce = true;
  t.mock.method(storage, "put", async (_key, value) => {
    storage.writes++;
    storage.value = structuredClone(value);
    if (failWriteOnce) {
      failWriteOnce = false;
      throw new Error("write committed before response failure");
    }
  });
  const credentials = { playerId: "123e4567-e89b-42d3-a456-426614174002", token: "c".repeat(64) };
  const env = publicRoom(room);
  const first = await worker.fetch(joinRequest(credentials), env);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).retryable, true);
  assert.equal(storage.value.members.filter(member => member.color === "white").length, 1);

  const retried = await worker.fetch(joinRequest({
    ...credentials, name: "Renamed", role: "spectator",
  }), env);
  assert.equal(retried.status, 201);
  const recovered = (await retried.json()).session;
  assert.equal(recovered.playerId, credentials.playerId);
  assert.equal(recovered.token, credentials.token);
  assert.equal(recovered.playerName, "White");
  assert.equal(recovered.role, "player");
  assert.equal(storage.value.members.filter(member => member.color === "white").length, 1);
});

test("join with a rejected uncommitted put leaves the seat open for its retry", async (t) => {
  t.mock.method(console, "error", () => {});
  const { room, storage } = await durable(savedHostRoom());
  let rejectOnce = true;
  t.mock.method(storage, "put", async (key, value) => {
    storage.writes++;
    if (rejectOnce) { rejectOnce = false; throw new Error("write did not commit"); }
    storage.value = structuredClone(value);
  });
  const credentials = { playerId: "123e4567-e89b-42d3-a456-426614174001", token: "c".repeat(64) };
  const env = publicRoom(room);
  const first = await worker.fetch(joinRequest(credentials), env);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).retryable, true);
  assert.equal(storage.value.members.some(member => member.color === "white"), false);
  assert.equal(room.unavailableError, null);
  const retry = await worker.fetch(joinRequest(credentials), env);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).session.color, "white");
  assert.equal(storage.value.members.filter(member => member.color === "white").length, 1);
});

test("join requires both well-formed retry credentials before touching a room", async () => {
  const env = { BADUK_ROOMS: { getByName() { throw new Error("room should not be called"); } } };
  const legacy = await worker.fetch(joinRequest({}), env);
  assert.equal(legacy.status, 426);
  assert.equal((await legacy.json()).code, "PROTOCOL_UPGRADE_REQUIRED");
  for (const body of [
    { token: "c".repeat(64) },
    { playerId: "123e4567-e89b-42d3-a456-426614174000" },
    { playerId: "123e4567-e89b-42d3-a456-426614174000", token: "short" },
    { playerId: "not-a-uuid", token: "c".repeat(64) },
    { playerId: ["123e4567-e89b-42d3-a456-426614174000"], token: "c".repeat(64) },
    { playerId: "123e4567-e89b-42d3-a456-426614174000", token: ["c".repeat(64)] },
  ]) {
    const response = await worker.fetch(joinRequest(body), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "BAD_REQUEST");
  }
});

test("create requires a complete client-generated identity before touching a room", async () => {
  const env = { BADUK_ROOMS: { getByName() { throw new Error("room should not be called"); } } };
  const legacy = await worker.fetch(createRequest({}), env);
  assert.equal(legacy.status, 426);
  assert.equal((await legacy.json()).code, "PROTOCOL_UPGRADE_REQUIRED");
  const valid = {
    roomCode: "BAM234", playerId: "123e4567-e89b-42d3-a456-426614174000",
    token: "c".repeat(64),
  };
  for (const body of [
    { roomCode: valid.roomCode },
    { roomCode: valid.roomCode, playerId: valid.playerId },
    { ...valid, roomCode: "BAD111" },
    { ...valid, roomCode: [valid.roomCode] },
    { ...valid, playerId: "not-a-uuid" },
    { ...valid, token: "short" },
  ]) {
    const response = await worker.fetch(createRequest(body), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "BAD_REQUEST");
  }
});

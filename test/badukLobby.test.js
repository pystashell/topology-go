import assert from "node:assert/strict";
import test from "node:test";

import { BadukLobby } from "../worker/BadukLobby.js";
import { lobbySummaryFromRoom } from "../src/multiplayer/lobby.js";

const CREATED_AT = Date.now() - 1_000;

function roomCodeAt(index) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = index;
  let code = "B";
  for (let digit = 0; digit < 5; digit += 1) {
    code += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return code;
}

function roomSnapshot(overrides = {}) {
  return {
    code: "ABC123",
    revision: 3,
    directoryRevision: overrides.directoryRevision ?? overrides.revision ?? 3,
    incarnationId: "room-instance-1",
    createdAt: CREATED_AT,
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    players: [{ id: "host", name: "Host", color: "black", online: true }],
    spectators: [],
    game: {
      width: 13,
      height: 9,
      topology: "mobius",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "play",
    },
    match: {
      status: "setup",
      mode: "friend",
      roundId: 0,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: null },
      },
    },
    ...overrides,
  };
}

function directory() {
  const writes = [];
  const instance = Object.create(BadukLobby.prototype);
  instance.ready = Promise.resolve();
  instance.rooms = new Map();
  instance.watermarks = new Map();
  instance.ctx = {
    storage: {
      async put(key, value) {
        writes.push({ key, value });
      },
    },
  };
  return { instance, writes };
}

test("the directory derives an index entry from a room snapshot", async () => {
  const { instance, writes } = directory();
  const response = await instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roomSnapshot()),
  }));

  assert.equal(response.status, 200);
  assert.equal(instance.rooms.get("ABC123").width, 13);
  assert.equal(instance.rooms.get("ABC123").revision, 3);
  assert.equal(instance.rooms.get("ABC123").height, 9);
  assert.equal(instance.rooms.get("ABC123").topology, "mobius");
  assert.equal(instance.rooms.get("ABC123").roundNumber, 0);
  assert.deepEqual(instance.rooms.get("ABC123").players, [
    { name: "Host", color: "black", controller: "human", online: true },
  ]);
  assert.equal(instance.rooms.get("ABC123").joinable, true);
  assert.equal(writes.length, 1);
});

test("the directory derives AI seats from v2 controllers, not legacy members", async () => {
  const { instance } = directory();
  const response = await instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roomSnapshot({
      match: {
        status: "playing",
        mode: "ai-ai",
        roundId: 6,
        controllers: {
          black: { kind: "ai", operatorId: "host", modelId: "b10" },
          white: { kind: "ai", operatorId: "host", modelId: "b18" },
        },
      },
    })),
  }));

  assert.equal(response.status, 200);
  const indexed = instance.rooms.get("ABC123");
  assert.equal(indexed.roundNumber, 6);
  assert.equal(indexed.joinable, false);
  assert.deepEqual(indexed.players.map(({ color, controller, name }) => ({ color, controller, name })), [
    { color: "black", controller: "ai", name: "KataGo b10 AI" },
    { color: "white", controller: "ai", name: "KataGo b18 AI" },
  ]);
});

test("invalid snapshots are rejected without changing the directory", async () => {
  const { instance, writes } = directory();
  const response = await instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "ABC123" }),
  }));

  assert.equal(response.status, 400);
  assert.equal(instance.rooms.size, 0);
  assert.equal(writes.length, 0);
});

test("stale or duplicate room revisions cannot regress an indexed room", async () => {
  const { instance, writes } = directory();
  const upsert = (snapshot) => instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  }));

  const newest = await upsert(roomSnapshot({
    revision: 5,
    moveCount: 9,
    game: {
      width: 19,
      height: 19,
      topology: "torus",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "play",
    },
  }));
  assert.equal(newest.status, 200);

  const stale = await upsert(roomSnapshot({
    revision: 4,
    moveCount: 2,
    game: {
      width: 9,
      height: 9,
      topology: "cylinder",
      scoringRule: "japanese",
      komi: 6.5,
      phase: "play",
    },
  }));
  assert.deepEqual(await stale.json(), { ok: true, ignored: "stale" });

  const duplicate = await upsert(roomSnapshot({
    revision: 5,
    moveCount: 1,
    game: {
      width: 13,
      height: 13,
      topology: "mobius",
      scoringRule: "japanese",
      komi: 6.5,
      phase: "play",
    },
  }));
  assert.deepEqual(await duplicate.json(), { ok: true, ignored: "stale" });

  const indexed = instance.rooms.get("ABC123");
  assert.equal(indexed.revision, 5);
  assert.equal(indexed.width, 19);
  assert.equal(indexed.moveCount, 9);
  assert.equal(writes.length, 1, "ignored upserts must not rewrite durable storage");
});

test("directory versions order same-game presence and protect a reused room code", async () => {
  const { instance } = directory();
  const post = (path, body) => instance.fetch(new Request(`https://index${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const old = roomSnapshot({ revision: 9, directoryRevision: 12 });
  assert.equal((await post("/internal/upsert", old)).status, 200);
  assert.equal((await post("/internal/upsert", roomSnapshot({
    revision: 9,
    directoryRevision: 13,
    players: [{ id: "host", name: "Host", color: "black", online: false }],
  }))).status, 200);
  assert.equal(instance.rooms.get(old.code).players[0].online, false);
  assert.deepEqual(await (await post("/internal/upsert", old)).json(),
    { ok: true, ignored: "stale" });

  const newer = roomSnapshot({
    revision: 1,
    directoryRevision: 2,
    incarnationId: "room-instance-2",
    createdAt: CREATED_AT + 10_000,
  });
  assert.equal((await post("/internal/upsert", newer)).status, 200);
  assert.equal(instance.rooms.get(old.code).incarnationId, newer.incarnationId);
  assert.deepEqual(await (await post("/internal/upsert", roomSnapshot({
    revision: 10,
    directoryRevision: 14,
  }))).json(), { ok: true, ignored: "stale" });
  assert.deepEqual(await (await post("/internal/remove", {
    code: old.code,
    incarnationId: old.incarnationId,
  })).json(), { ok: true, ignored: "stale" });
  assert.equal(instance.rooms.get(old.code).incarnationId, newer.incarnationId);
  assert.equal((await post("/internal/remove", { code: old.code })).status, 400);
  assert.equal((await post("/internal/remove", {
    code: newer.code,
    incarnationId: newer.incarnationId,
  })).status, 200);
  assert.equal(instance.rooms.has(old.code), false);
});

test("capacity eviction retains a high-water mark across restart", async (t) => {
  const { instance, writes } = directory();
  const post = (lobby, path, body) => lobby.fetch(new Request(`https://index${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const current = roomSnapshot({ directoryRevision: 2 });
  await post(instance, "/internal/upsert", current);
  for (let index = 0; index < 500; index += 1) {
    const code = roomCodeAt(index);
    instance.rooms.set(code, lobbySummaryFromRoom(roomSnapshot({
      code,
      incarnationId: `room-${index}`,
      updatedAt: Date.now() + 1_000,
    })));
  }
  await instance.prune();
  assert.equal(instance.rooms.has(current.code), false);
  assert.equal(instance.watermarks.get(current.code).directoryRevision, 2);
  await post(instance, "/internal/remove", {
    code: roomCodeAt(0),
    incarnationId: "room-0",
  });
  const stale = roomSnapshot({
    directoryRevision: 1,
    players: [{ id: "host", name: "Host", color: "black", online: false }],
  });
  assert.deepEqual(await (await post(instance, "/internal/upsert", stale)).json(),
    { ok: true, ignored: "stale" });
  assert.equal(instance.rooms.has(current.code), false);

  let stored = structuredClone(writes.at(-1).value);
  const restarted = new BadukLobby({
    blockConcurrencyWhile: (initialize) => initialize(),
    storage: {
      async get() { return stored; },
      async put(_key, value) { stored = structuredClone(value); },
    },
    abort() { throw new Error("Lobby reset"); },
  });
  await restarted.ready;
  assert.equal(restarted.watermarks.get(current.code).directoryRevision, 2);
  assert.deepEqual(await (await post(restarted, "/internal/upsert", stale)).json(),
    { ok: true, ignored: "stale" });
  assert.equal((await post(restarted, "/internal/upsert", roomSnapshot({
    directoryRevision: 3,
  }))).status, 200);
  assert.equal(restarted.rooms.get(current.code).directoryRevision, 3);

  const replacement = roomSnapshot({
    revision: 1,
    directoryRevision: 1,
    incarnationId: "replacement",
    createdAt: CREATED_AT + 10_000,
  });
  await post(restarted, "/internal/upsert", replacement);
  assert.equal(restarted.rooms.get(current.code).incarnationId, "replacement");
  assert.deepEqual(await (await post(restarted, "/internal/upsert", roomSnapshot({
    revision: 100,
    directoryRevision: 100,
  }))).json(), { ok: true, ignored: "stale" });
  assert.deepEqual(await (await post(restarted, "/internal/remove", {
    code: current.code,
    incarnationId: current.incarnationId,
  })).json(), { ok: true, ignored: "stale" });
  assert.equal(restarted.rooms.get(current.code).incarnationId, "replacement");
  await restarted.prune(replacement.expiresAt + 1);
  assert.equal(restarted.watermarks.has(current.code), false);
  t.mock.method(Date, "now", () => replacement.expiresAt + 1);
  assert.deepEqual(await (await post(restarted, "/internal/upsert", replacement)).json(),
    { ok: true, ignored: "expired" });
});

test("tracked-code bound leaves room under the SQLite value limit", async () => {
  const { instance, writes } = directory();
  const incarnationId = "三".repeat(128);
  const latest = Number.MAX_SAFE_INTEGER;
  const name = "棋".repeat(20);
  const expiresAt = latest;
  const createdAt = latest - 1;
  const post = (snapshot) => instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    body: JSON.stringify(snapshot),
  }));
  for (let index = 0; index < 500; index += 1) {
    const code = roomCodeAt(index);
    instance.rooms.set(code, lobbySummaryFromRoom(roomSnapshot({
      code,
      incarnationId,
      revision: latest,
      directoryRevision: latest,
      createdAt,
      updatedAt: latest,
      expiresAt,
      players: [
        { id: "host", name, color: "black", online: true },
        { id: "friend", name, color: "white", online: true },
      ],
      game: {
        width: 30,
        height: 30,
        topology: "mobius",
        scoringRule: "japanese",
        komi: 7.5,
        phase: "play",
      },
      match: {
        status: "playing",
        mode: "friend",
        roundId: latest,
        controllers: {
          black: { kind: "human", operatorId: "host" },
          white: { kind: "human", operatorId: "friend" },
        },
      },
    })));
  }
  for (let index = 500; index < 2_000; index += 1) {
    const code = roomCodeAt(index);
    instance.watermarks.set(code, {
      code,
      incarnationId,
      createdAt,
      directoryRevision: index === 500 ? 1 : latest,
      expiresAt,
    });
  }
  const value = {
    rooms: [...instance.rooms.values()],
    watermarks: [...instance.watermarks.values()],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(value), "utf8") < 1_800_000,
    "the bounded value needs headroom below Cloudflare's 2 MB key/value limit");

  assert.equal((await post(roomSnapshot({ code: roomCodeAt(2_000) }))).status, 503);
  assert.equal(writes.length, 0);
  assert.equal((await post(roomSnapshot({ code: "X".repeat(10_000) }))).status, 400);
  assert.equal((await post(roomSnapshot({
    code: roomCodeAt(500),
    incarnationId,
    createdAt,
    expiresAt,
    directoryRevision: 2,
  }))).status, 200, "a known code remains updatable at capacity");
  assert.ok(Buffer.byteLength(JSON.stringify(writes.at(-1).value), "utf8") < 1_800_000);
});

test("a failed directory write resets memory before retrying its revision", async () => {
  for (const failurePoint of ["before", "after"]) {
    let stored = null;
    let failNext = false;
    const spawn = () => new BadukLobby({
      blockConcurrencyWhile: (initialize) => initialize(),
      abort: () => { throw new Error("Durable Object reset"); },
      storage: {
        async get() { return stored; },
        async put(_key, value) {
          if (failNext && failurePoint === "before") {
            failNext = false;
            throw new Error("write rejected before commit");
          }
          stored = structuredClone(value);
          if (failNext) {
            failNext = false;
            throw new Error("response lost after commit");
          }
        },
      },
    });
    const upsert = (lobby, snapshot) => lobby.fetch(new Request("https://index/internal/upsert", {
      method: "POST",
      body: JSON.stringify(snapshot),
    }));

    let lobby = spawn();
    assert.equal((await upsert(lobby, roomSnapshot({ revision: 1 }))).status, 200);
    failNext = true;
    await assert.rejects(upsert(lobby, roomSnapshot({ revision: 2 })),
      /Durable Object reset/u);

    lobby = spawn();
    await lobby.ready;
    assert.equal(lobby.rooms.get("ABC123").revision,
      failurePoint === "before" ? 1 : 2);
    const retry = await upsert(lobby, roomSnapshot({ revision: 2 }));
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), failurePoint === "before"
      ? { ok: true }
      : { ok: true, ignored: "stale" });
    await upsert(lobby, roomSnapshot({ code: "BCA234", revision: 1 }));
    assert.deepEqual(stored.rooms.map(({ code, revision }) => ({ code, revision }))
      .sort((left, right) => left.code.localeCompare(right.code)), [
      { code: "ABC123", revision: 2 },
      { code: "BCA234", revision: 1 },
    ]);
  }
});

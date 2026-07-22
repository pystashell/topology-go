import assert from "node:assert/strict";
import test from "node:test";

import { BadukLobby } from "../worker/BadukLobby.js";

function roomSnapshot(overrides = {}) {
  return {
    code: "ABC123",
    revision: 3,
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

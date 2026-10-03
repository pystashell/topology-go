import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine, hashRoomToken } from "../src/multiplayer/roomEngine.js";
import { BadukRoom } from "../worker/BadukRoom.js";
import { BadukLobby } from "../worker/BadukLobby.js";

function post(lobby, path, body) {
  return lobby.fetch(new Request(`https://index.internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

function lobbyStorage() {
  let stored = null;
  return {
    spawn() {
      return new BadukLobby({
        blockConcurrencyWhile: (initialize) => initialize(),
        storage: {
          async get() { return structuredClone(stored); },
          async put(_key, value) { stored = structuredClone(value); },
        },
        abort() { throw new Error("Lobby reset"); },
      });
    },
    replace(value) { stored = structuredClone(value); },
    read() { return structuredClone(stored); },
  };
}

function publishingRoom(engine, lobby) {
  const pending = [];
  let stored = null;
  const room = Object.create(BadukRoom.prototype);
  room.engine = engine;
  room.ctx = {
    storage: {
      async put(_key, value) { stored = structuredClone(value); },
    },
    waitUntil(promise) { pending.push(promise); },
    getWebSockets() { return []; },
  };
  room.env = {
    BADUK_ROOM_INDEX: {
      getByName() { return { fetch: (request) => lobby.fetch(request) }; },
    },
  };
  return {
    room,
    async persist() {
      await room.persist();
      await Promise.all(pending.splice(0));
      return structuredClone(stored);
    },
    setLobby(next) {
      room.env.BADUK_ROOM_INDEX.getByName = () => ({
        fetch: (request) => next.fetch(request),
      });
    },
  };
}

test("an operator departure advertises the reusable black seat in the lobby", async () => {
  const now = Date.now() - 1_000;
  const code = "BAK234";
  const lobby = lobbyStorage().spawn();
  await lobby.ready;
  const engine = RoomEngine.create({
    code,
    name: "Host",
    playerId: "host",
    tokenHash: await hashRoomToken("host-secret"),
    startImmediately: false,
    now,
  });
  const publisher = publishingRoom(engine, lobby);
  engine.applyAction({
    playerId: "host", action: "request_game", payload: { mode: "local" }, now: now + 100,
  });
  await publisher.persist();
  assert.equal(lobby.rooms.get(code).joinable, false);

  engine.leave({ playerId: "host", now: now + 200 });
  await publisher.persist();
  const entry = lobby.rooms.get(code);
  assert.equal(entry.status, "setup");
  assert.equal(entry.mode, "friend");
  assert.equal(entry.joinable, true);
  const replacement = RoomEngine.restore(engine.serialize());
  assert.equal(replacement.join({
    name: "Next host",
    role: "player",
    playerId: "next-host",
    tokenHash: await hashRoomToken("next-secret"),
    now: now + 300,
  }).identity.color, "black");
});

test("persisted directory versions follow presence, expiry and room incarnations", async () => {
  const now = Date.now() - 10_000;
  const code = "ABC234";
  const storage = lobbyStorage();
  let lobby = storage.spawn();
  await lobby.ready;
  const engine = RoomEngine.create({
    code,
    name: "Host",
    playerId: "host",
    tokenHash: await hashRoomToken("host-secret"),
    startImmediately: false,
    now,
  });
  const publisher = publishingRoom(engine, lobby);
  let storedRoom = await publisher.persist();
  const first = engine.snapshot(now);
  const firstEntry = lobby.rooms.get(code);
  assert.equal(firstEntry.players[0].online, false);
  assert.equal(firstEntry.directoryRevision, first.directoryRevision);
  assert.equal(firstEntry.incarnationId, first.incarnationId);
  const initialGameRevision = engine.state.revision;
  const initialExpiry = firstEntry.expiresAt;

  engine.resumeConnection("host", "host-socket", now + 1_000);
  storedRoom = await publisher.persist();
  assert.equal(engine.state.revision, initialGameRevision);
  assert.equal(lobby.rooms.get(code).players[0].online, true);
  assert.ok(lobby.rooms.get(code).directoryRevision > firstEntry.directoryRevision);
  const connectedSnapshot = engine.snapshot(now + 1_000);

  engine.disconnect({ connectionId: "host-socket", now: now + 2_000 });
  await publisher.persist();
  assert.equal(engine.state.revision, initialGameRevision);
  assert.equal(lobby.rooms.get(code).players[0].online, false);
  assert.deepEqual(await (await post(lobby, "/internal/upsert", connectedSnapshot)).json(),
    { ok: true, ignored: "stale" });

  engine.join({
    name: "Viewer",
    role: "spectator",
    playerId: "viewer",
    tokenHash: await hashRoomToken("viewer-secret"),
    now: now + 3_000,
  });
  await publisher.persist();
  const spectatorGameRevision = engine.state.revision;
  assert.equal(lobby.rooms.get(code).spectatorCount, 0);
  engine.resumeConnection("viewer", "viewer-socket", now + 4_000);
  await publisher.persist();
  assert.equal(engine.state.revision, spectatorGameRevision);
  assert.equal(lobby.rooms.get(code).spectatorCount, 1);
  engine.disconnect({ connectionId: "viewer-socket", now: now + 5_000 });
  await publisher.persist();
  assert.equal(engine.state.revision, spectatorGameRevision);
  assert.equal(lobby.rooms.get(code).spectatorCount, 0);

  await engine.authenticateToken("host-secret", now + 6_000);
  storedRoom = await publisher.persist();
  assert.equal(engine.state.revision, spectatorGameRevision);
  assert.ok(lobby.rooms.get(code).expiresAt > initialExpiry);
  await lobby.prune(initialExpiry + 1);
  assert.equal(lobby.rooms.has(code), true, "a renewed room survives its old TTL");
  assert.equal(RoomEngine.restore(storedRoom).state.directoryRevision,
    engine.state.directoryRevision);

  // Old persisted summaries survive an upgrade and accept a current publish.
  const legacyEntries = storage.read().rooms;
  delete legacyEntries[0].directoryRevision;
  delete legacyEntries[0].incarnationId;
  storage.replace(legacyEntries);
  lobby = storage.spawn();
  await lobby.ready;
  assert.equal(lobby.rooms.get(code).revision, spectatorGameRevision);
  assert.deepEqual(await (await post(lobby, "/internal/remove", {
    code,
    incarnationId: "unrelated-room",
  })).json(), { ok: true, ignored: "stale" });
  assert.equal(lobby.rooms.has(code), true);
  publisher.setLobby(lobby);
  await publisher.persist();
  assert.equal(lobby.rooms.get(code).incarnationId, engine.state.incarnationId);

  const oldSnapshot = engine.snapshot(now + 7_000);
  const next = RoomEngine.create({
    code,
    name: "Next host",
    playerId: "next-host",
    tokenHash: await hashRoomToken("next-secret"),
    startImmediately: false,
    now: now + 60_000,
  });
  const nextPublisher = publishingRoom(next, lobby);
  await nextPublisher.persist();
  assert.equal(lobby.rooms.get(code).incarnationId, next.state.incarnationId);
  assert.ok(lobby.rooms.get(code).directoryRevision < oldSnapshot.directoryRevision);
  assert.deepEqual(await (await post(lobby, "/internal/upsert", oldSnapshot)).json(),
    { ok: true, ignored: "stale" });
  assert.deepEqual(await (await post(lobby, "/internal/remove", {
    code,
    incarnationId: oldSnapshot.incarnationId,
  })).json(), { ok: true, ignored: "stale" });
  assert.equal(lobby.rooms.get(code).incarnationId, next.state.incarnationId);

  const restartedLobby = storage.spawn();
  await restartedLobby.ready;
  assert.equal(restartedLobby.rooms.get(code).incarnationId, next.state.incarnationId);
  assert.equal((await post(restartedLobby, "/internal/remove", {
    code,
    incarnationId: next.state.incarnationId,
  })).status, 200);
  assert.equal(restartedLobby.rooms.has(code), false);
});

test("uncertain writes publish only a confirmed recovered room", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const failurePoint of ["before", "after"]) {
    for (const recovery of ["recoverCommittedRoom", "lookupCommittedJoin"]) {
      const code = failurePoint === "before" ? "BCA234" : "CAB234";
      const tokenHash = await hashRoomToken("host-secret");
      const engine = RoomEngine.create({
        code,
        name: "Host",
        playerId: "host",
        tokenHash,
        startImmediately: false,
        now: Date.now(),
      });
      const lobby = lobbyStorage().spawn();
      await lobby.ready;
      const pending = [];
      let stored = null;
      const room = Object.create(BadukRoom.prototype);
      room.engine = engine;
      room.ctx = {
        storage: {
          async get() { return structuredClone(stored); },
          async put(_key, value) {
            if (failurePoint === "after") stored = structuredClone(value);
            throw new Error("injected uncertain write");
          },
          async getAlarm() { return null; },
          async setAlarm() {},
        },
        waitUntil(promise) { pending.push(promise); },
        getWebSockets() { return []; },
      };
      room.env = {
        BADUK_ROOM_INDEX: {
          getByName() { return { fetch: (request) => lobby.fetch(request) }; },
        },
      };

      await assert.rejects(room.persist(), (error) => error.code === "ROOM_COMMIT_FAILED");
      assert.equal(lobby.rooms.has(code), false);
      assert.equal(pending.length, 0);
      if (recovery === "recoverCommittedRoom") {
        await room.recoverCommittedRoom();
      } else {
        const response = await room.lookupCommittedJoin(new Request(
          "https://room.internal/internal/join-status", {
            method: "POST",
            body: JSON.stringify({ playerId: "host", tokenHash }),
          },
        ));
        assert.equal(response.status, failurePoint === "after" ? 200 : 404);
      }
      await Promise.all(pending);
      if (failurePoint === "after") {
        assert.equal(room.engine.state.directoryRevision, stored.directoryRevision);
        assert.equal(lobby.rooms.get(code).directoryRevision, stored.directoryRevision);
        assert.equal(lobby.rooms.get(code).incarnationId, stored.incarnationId);
      } else {
        assert.equal(room.engine, null);
        assert.equal(lobby.rooms.has(code), false);
      }
    }
  }
});

test("old room snapshots seed a stable directory identity on restore", async () => {
  const original = RoomEngine.create({
    code: "CDA234",
    name: "Host",
    playerId: "host",
    tokenHash: await hashRoomToken("host-secret"),
    startImmediately: false,
    now: Date.now(),
  }).serialize();
  delete original.directoryRevision;
  delete original.incarnationId;
  const restored = RoomEngine.restore(original);
  assert.equal(restored.state.directoryRevision, original.revision);
  assert.equal(restored.state.incarnationId,
    `legacy:${original.code}:${original.createdAt}`);
  restored.bumpDirectoryRevision();
  assert.deepEqual(RoomEngine.restore(restored.serialize()).state.incarnationId,
    restored.state.incarnationId);
});

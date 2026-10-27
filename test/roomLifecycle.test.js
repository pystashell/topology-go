import assert from "node:assert/strict";
import test from "node:test";

import { BADUK_WS_PROTOCOL } from "../src/multiplayer/protocol.js";
import {
  HOST_GONE_CLOSE_MS,
  MATCH_MODE_FRIEND,
  PLAYERS_GONE_CLOSE_MS,
  ROUND_ABANDONED_CLOSE_MS,
  RoomEngine,
  hashRoomToken,
} from "../src/multiplayer/roomEngine.js";
import { BadukRoom } from "../worker/BadukRoom.js";
import { listRecords, onlineRoundRecord, saveRecord } from "../worker/records.js";
import { FakeD1 } from "./helpers/d1.js";

/*
 * Rooms close by themselves once their players are gone (owner's decision,
 * docs/design/accounts-and-game-records.md section 5): a host waiting alone
 * after 2 minutes away, two players between games after 5, a game being
 * played after both have been away 30 minutes (it is saved as interrupted).
 * Spectators never keep a room open.
 */

const T0 = 1_800_000_000_000;

async function hostRoom({ hostUser = "user-host" } = {}) {
  const engine = RoomEngine.create({
    code: "QNE234", name: "Host", size: 9, playerId: "host",
    tokenHash: await hashRoomToken("host-secret"), userId: hostUser, startImmediately: false, now: T0,
  });
  await engine.connectByToken({ token: "host-secret", connectionId: "host-socket", now: T0 });
  return engine;
}

async function seat(engine, playerId, { role = "player", userId = `user-${playerId}`, at = T0 + 1_000 } = {}) {
  engine.join({ name: playerId, role, playerId, tokenHash: await hashRoomToken(`${playerId}-secret`), userId, now: at });
  await engine.connectByToken({ token: `${playerId}-secret`, connectionId: `${playerId}-socket`, now: at });
}

/** Host and guest playing a friend game with two moves on the board. */
async function gameUnderWay() {
  const engine = await hostRoom();
  await seat(engine, "guest");
  const invited = engine.applyAction({ playerId: "host", action: "request_game", payload: { mode: MATCH_MODE_FRIEND }, now: T0 + 2_000 }).room;
  engine.applyAction({
    playerId: "guest", action: "respond_game", payload: { requestRevision: invited.match.request.requestRevision, accept: true }, now: T0 + 3_000,
  });
  engine.applyAction({ playerId: "host", action: "play", payload: { row: 4, col: 4 }, now: T0 + 4_000 });
  engine.applyAction({ playerId: "guest", action: "play", payload: { row: 2, col: 2 }, now: T0 + 5_000 });
  return engine;
}

const leave = (engine, playerId, at, connectionId = `${playerId}-socket`) =>
  engine.disconnect({ connectionId, now: at });

test("a host waiting alone: the room closes 2 minutes after the host left, whoever watches", async () => {
  const engine = await hostRoom();
  await seat(engine, "viewer", { role: "spectator" });
  assert.equal(engine.playersGone(), null, "the host is here");
  assert.equal(engine.nextDueAt(), engine.state.expiresAt);

  const left = T0 + 10_000;
  const gone = leave(engine, "host", left);
  assert.deepEqual([gone.playerOffline, gone.presenceChanged], [true, true], "the room object stores it");
  assert.equal(engine.playersGoneSince, left);
  assert.deepEqual(engine.playersGone(), { at: left + HOST_GONE_CLOSE_MS, reason: "players-gone" });
  assert.equal(engine.nextDueAt(), left + HOST_GONE_CLOSE_MS, "the room object sets an alarm for it");

  // The spectator stays and keeps acting: that neither keeps the room open
  // nor prolongs its 24 hours.
  const expiresAt = engine.state.expiresAt;
  await engine.authenticate({ playerId: "viewer", token: "viewer-secret", now: left + 60_000 });
  assert.equal(engine.state.expiresAt, expiresAt);
  assert.equal(engine.advance(left + HOST_GONE_CLOSE_MS - 1).expired, false);
  const closed = engine.advance(left + HOST_GONE_CLOSE_MS);
  assert.deepEqual([closed.expired, closed.reason, closed.changed], [true, "players-gone", true]);
  assert.equal(engine.state.closedReason, "players-gone");
  assert.deepEqual([engine.advance(left + HOST_GONE_CLOSE_MS + 1).reason, engine.nextDueAt()], ["players-gone", null]);
  assert.equal(engine.interruptedRoundRecord(), null, "nothing was being played");
  assert.throws(() => engine.prepare(left + HOST_GONE_CLOSE_MS + 2), { code: "ROOM_NOT_FOUND" });

  // Coming back in time (a page reload) keeps it.
  const reload = await hostRoom();
  leave(reload, "host", left);
  await reload.connectByToken({ token: "host-secret", connectionId: "host-socket-2", now: left + 3_000 });
  assert.equal(reload.playersGone(), null);
  assert.equal(reload.advance(left + HOST_GONE_CLOSE_MS * 3).expired, false);
});

test("between games: 5 minutes after the last player left; either one back keeps it", async () => {
  const engine = await hostRoom();
  await seat(engine, "guest");
  leave(engine, "guest", T0 + 20_000);
  assert.equal(engine.playersGone(), null, "the host is still here");
  leave(engine, "host", T0 + 50_000);
  assert.deepEqual(engine.playersGone(), { at: T0 + 50_000 + PLAYERS_GONE_CLOSE_MS, reason: "players-gone" });
  await engine.connectByToken({ token: "guest-secret", connectionId: "guest-socket-2", now: T0 + 60_000 });
  assert.equal(engine.playersGone(), null);
  leave(engine, "guest", T0 + 70_000, "guest-socket-2");
  assert.equal(engine.advance(T0 + 70_000 + PLAYERS_GONE_CLOSE_MS - 1).expired, false);
  assert.equal(engine.advance(T0 + 70_000 + PLAYERS_GONE_CLOSE_MS).reason, "players-gone");
});

test("a game being played: both away 30 minutes, then it is saved as interrupted", async () => {
  const engine = await gameUnderWay();
  leave(engine, "host", T0 + 10_000);
  assert.equal(engine.playersGone(), null, "one player here keeps the game (the other may claim it)");
  leave(engine, "guest", T0 + 20_000);
  const due = T0 + 20_000 + ROUND_ABANDONED_CLOSE_MS;
  assert.deepEqual(engine.playersGone(), { at: due, reason: "interrupted" });
  assert.equal(engine.advance(due - 1).expired, false);
  assert.equal(engine.advance(due).reason, "interrupted");

  const round = engine.interruptedRoundRecord();
  assert.deepEqual(round.result, { winner: null, reason: "interrupted", finishedAt: due });
  assert.equal(round.finishedAt, due);
  assert.equal(round.moveCount, 2);
  assert.deepEqual([round.players.black.userId, round.players.white.userId], ["user-host", "user-guest"]);
  const { row, owners } = onlineRoundRecord(round, "QNE234");
  assert.equal(row.winner, null);
  assert.equal(JSON.parse(row.result).reason, "interrupted");
  assert.deepEqual(owners, [{ userId: "user-host", color: "black" }, { userId: "user-guest", color: "white" }]);

  // A game started but without a move is not a game in progress.
  const unplayed = await hostRoom();
  await seat(unplayed, "guest");
  const invited = unplayed.applyAction({ playerId: "host", action: "request_game", payload: { mode: MATCH_MODE_FRIEND }, now: T0 + 2_000 }).room;
  unplayed.applyAction({ playerId: "guest", action: "respond_game", payload: { requestRevision: invited.match.request.requestRevision, accept: true }, now: T0 + 3_000 });
  leave(unplayed, "host", T0 + 4_000);
  leave(unplayed, "guest", T0 + 5_000);
  assert.deepEqual(unplayed.playersGone(), { at: T0 + 5_000 + PLAYERS_GONE_CLOSE_MS, reason: "players-gone" });
});

test("when the room emptied survives a restart; a restart never closes a room early", async () => {
  const engine = await hostRoom();
  assert.equal(engine.playersGoneSince, null, "the host connected");
  leave(engine, "host", T0 + 30_000);
  // The room object stores it next to the state, which stays as before.
  assert.equal("playersGoneSince" in engine.serialize(), false);
  const restored = RoomEngine.restore({ ...engine.serialize(), playersGoneSince: engine.playersGoneSince });
  assert.equal("playersGoneSince" in restored.serialize(), false);
  assert.deepEqual(restored.playersGone(), { at: T0 + 30_000 + HOST_GONE_CLOSE_MS, reason: "players-gone" });
  assert.equal(restored.advance(T0 + 30_000 + HOST_GONE_CLOSE_MS).reason, "players-gone");

  // A deploy drops every connection while the players were here and long
  // idle: the restarted room counts from its restart, and their pages
  // reconnecting a moment later stop it.
  const busy = await gameUnderWay();
  const restart = T0 + 60 * 60_000;
  const woken = RoomEngine.restore(busy.serialize());
  const first = woken.advance(restart);
  assert.deepEqual([first.expired, first.changed, first.presenceChanged], [false, false, true], "stored at once");
  assert.equal(woken.playersGoneSince, restart);
  assert.equal(woken.playersGone().at, restart + ROUND_ABANDONED_CLOSE_MS);
  const back = await woken.connectByToken({ token: "guest-secret", connectionId: "guest-socket-2", now: restart + 2_000 });
  assert.equal(back.presenceChanged, true);
  assert.equal(woken.playersGoneSince, null);
  assert.equal(woken.playersGone(), null);

  // Rooms stored before this release have no such field: the same.
  const olderRoom = RoomEngine.restore(busy.serialize());
  olderRoom.advance(restart);
  assert.equal(olderRoom.playersGone().at, restart + ROUND_ABANDONED_CLOSE_MS);
  // Pages never see it.
  assert.doesNotMatch(JSON.stringify(olderRoom.snapshot(restart)), /playersGoneSince/u);
});

class FakeSocket {
  constructor(attachment = null) {
    this.readyState = 1;
    this.attachment = attachment;
    this.messages = [];
    this.closed = null;
  }
  accept() {}
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment; }
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
}

function withFakeWebSockets(t) {
  const originalPair = globalThis.WebSocketPair;
  const OriginalResponse = globalThis.Response;
  const pairs = [];
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
      pairs.push(this);
    }
  };
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
  return pairs;
}

function addUser(db, id) {
  db.database.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, ?, ?, 0, 0, 0)`).run(id, id, `${id}@example.test`);
}

test("the room object saves an interrupted game, tells spectators why and goes", async (t) => {
  const pairs = withFakeWebSockets(t);
  const engine = await gameUnderWay();
  await seat(engine, "viewer", { role: "spectator" });
  // Both players left over half an hour ago; the spectator is still watching.
  leave(engine, "host", T0 + 10_000);
  leave(engine, "guest", T0 + 20_000);
  t.mock.timers.enable({ apis: ["Date"], now: T0 + 20_000 + ROUND_ABANDONED_CLOSE_MS + 5_000 });
  const db = new FakeD1();
  addUser(db, "user-host");
  addUser(db, "user-guest");
  const viewer = new FakeSocket({ connectionId: "viewer-socket", identity: { playerId: "viewer", role: "spectator" } });
  const pending = [];
  let ready;
  const storage = {
    // As the room object stored it when the guest, the last player, left.
    value: { ...engine.serialize(), playersGoneSince: engine.playersGoneSince }, alarm: T0, deleted: false,
    async get() { return this.value === null ? undefined : structuredClone(this.value); },
    async put(_key, value) { this.value = structuredClone(value); },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
    async deleteAll() { this.value = null; this.deleted = true; },
  };
  const room = new BadukRoom({
    storage,
    id: { toString: () => "closing-room" },
    getWebSockets: () => [viewer].filter((socket) => socket.readyState < 2),
    acceptWebSocket() {},
    blockConcurrencyWhile(callback) { ready = callback(); },
    waitUntil(promise) { pending.push(promise); },
  }, { DB: db });
  await ready;
  await Promise.all(pending);

  assert.equal(storage.deleted, true, "the room is gone");
  assert.equal(storage.alarm, null);
  assert.equal(viewer.closed.code, 4404);
  assert.deepEqual([viewer.messages.at(-1).code, viewer.messages.at(-1).message],
    ["ROOM_EXPIRED", "双方离开超过 30 分钟，这盘棋按中断保存，房间已经关闭。"]);
  for (const userId of ["user-host", "user-guest"]) {
    const { records } = await listRecords(db, userId, { roomCode: "QNE234", limit: 1 });
    assert.equal(records.length, 1, userId);
    assert.deepEqual([records[0].winner, records[0].moveCount, records[0].roomCode], [null, 2, "QNE234"]);
  }

  // A page coming back to it learns it is closed, for good.
  const response = await room.fetch(new Request("https://room.test/api/rooms/QNE234/socket", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${BADUK_WS_PROTOCOL}, token.${Buffer.from("host-secret").toString("base64url")}` },
  }));
  assert.equal(response.status, 101);
  const server = pairs.at(-1)[1];
  assert.equal(server.messages[0].code, "ROOM_EXPIRED");
  assert.equal(server.closed.code, 4404);
  // Other requests still read as not found.
  assert.equal((await room.fetch(new Request("https://room.test/api/rooms/QNE234/socket"))).status, 404);
});

test("a player's games in one room, newest first, for the link of a closed room", async () => {
  const db = new FakeD1();
  addUser(db, "user-mia");
  const row = (room, finishedAt) => ({
    client_key: `room:${room}:1:${finishedAt}`, source: "online", mode: "friend", game_type: "go", width: 9, height: 9,
    topology: "torus", black_name: "Mia", white_name: "Lee", black_kind: "human", white_kind: "human",
    winner: "black", result: "{}", move_count: 3, started_at: 1, finished_at: finishedAt, room_code: room, data: "{}",
  });
  await saveRecord(db, row("QNE234", 1_000), [{ userId: "user-mia", color: "black" }]);
  await saveRecord(db, row("QNE234", 3_000), [{ userId: "user-mia", color: "black" }]);
  await saveRecord(db, row("ZZZ234", 5_000), [{ userId: "user-mia", color: "black" }]);
  const { records } = await listRecords(db, "user-mia", { roomCode: "QNE234", limit: 1 });
  assert.deepEqual(records.map((record) => [record.roomCode, record.finishedAt]), [["QNE234", 3_000]]);
  assert.equal((await listRecords(db, "user-mia", { roomCode: "ABC234" })).records.length, 0);
});

test("a deploy never closes a room early; a room nobody comes back to still closes", async (t) => {
  // Host and guest were here between games, idle for an hour, when a deploy
  // dropped every connection. Nothing records them leaving.
  const engine = await hostRoom();
  await seat(engine, "guest");
  const storage = {
    value: engine.serialize(), writes: 0, alarm: null, deleted: false,
    async get() { return this.value === null ? undefined : structuredClone(this.value); },
    async put(_key, value) { this.writes += 1; this.value = structuredClone(value); },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
    async deleteAll() { this.value = null; this.deleted = true; },
  };
  const wake = async () => {
    let ready;
    const room = new BadukRoom({
      storage,
      id: { toString: () => "deployed-room" },
      getWebSockets: () => [],
      acceptWebSocket() {},
      blockConcurrencyWhile(callback) { ready = callback(); },
      waitUntil() {},
    }, {});
    await ready;
    return room;
  };
  const restart = T0 + 60 * 60_000;
  t.mock.timers.enable({ apis: ["Date"], now: restart });
  const first = await wake();
  assert.ok(first.engine, "not closed");
  assert.equal(first.engine.playersGoneSince, restart, "counted from the restart");
  assert.equal(storage.writes, 0, "pages usually reconnect at once: nothing written yet");
  assert.equal(storage.alarm, restart + PLAYERS_GONE_CLOSE_MS);

  // Nobody came back and the object slept; its alarm wakes a new one, which
  // counts from its own start but stores that, once.
  t.mock.timers.tick(PLAYERS_GONE_CLOSE_MS);
  const second = await wake();
  await second.alarm();
  assert.equal(storage.writes, 1);
  assert.equal(storage.value.playersGoneSince, restart + PLAYERS_GONE_CLOSE_MS);
  assert.equal(storage.deleted, false);

  // The next object to wake on time closes it.
  t.mock.timers.tick(PLAYERS_GONE_CLOSE_MS);
  await wake();
  assert.equal(storage.deleted, true);
});

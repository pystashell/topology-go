import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine } from "../src/multiplayer/roomEngine.js";
import { BadukRoom } from "../worker/BadukRoom.js";
import {
  RECORD_PAGE_SIZE,
  compactResult,
  isRecordId,
  listRecords,
  localRecordUpload,
  newRecordId,
  onlineRoundRecord,
  readRecord,
  recordRow,
  removeRecord,
  saveRecord,
} from "../worker/records.js";
import { FakeD1 } from "./helpers/d1.js";

/*
 * Game records in D1 (worker/records.js): the row a finished game becomes,
 * who owns it, listing, reading and removing, and the room saving a
 * finished online round for its players.
 */

const UUID = "0b9f2c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21";

function addUser(db, id) {
  db.database.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAnonymous)
     VALUES (?, 'Guest', ?, 0, '2026-10-26', '2026-10-26', 1)`,
  ).run(id, `${id}@guest.invalid`);
}

function replay(moves = 1) {
  return {
    version: 1,
    complete: true,
    base: { width: 5, height: 5, topology: "cylinder", board: Array.from({ length: 5 }, () => Array(5).fill(null)) },
    events: Array.from({ length: moves }, (_, index) => ({ type: "play", color: index % 2 ? "white" : "black", row: 0, col: index % 5 })),
  };
}

function localUpload(overrides = {}) {
  return {
    v: 1,
    clientKey: `local:${UUID}`,
    mode: "human-ai",
    ownerColor: "black",
    gameType: "go",
    width: 5,
    height: 5,
    topology: "cylinder",
    players: { black: { name: "Mia", kind: "human" }, white: { name: "KataGo b10 AI", kind: "ai" } },
    result: { winner: "black", reason: "resign" },
    moveCount: 3,
    startedAt: 1_000,
    finishedAt: 2_000,
    settings: { size: 5 },
    replay: replay(3),
    ...overrides,
  };
}

test("record ids are random, 16 characters, and checked before any query", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRecordId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.equal(isRecordId(id), true, id);
  assert.equal(isRecordId("short"), false);
  assert.equal(isRecordId("ABCDEFGHJKMNPQRS"), false, "upper case is not an id");
  assert.equal(isRecordId("abcdefghijklmnop"), false, "l is not in the alphabet");
  assert.equal(isRecordId(null), false);
});

test("a result keeps its plain values; maps and long text stay in the replay", () => {
  assert.deepEqual(compactResult({
    winner: "black", reason: "score", black: 40.5, white: 32, margin: 8.5, komi: 6.5,
    territory: { black: 20 }, neutralPoints: [[0, 1]], regions: [], resigned: false, note: "x".repeat(41),
  }), { winner: "black", reason: "score", black: 40.5, white: 32, margin: 8.5, komi: 6.5, resigned: false });
  assert.equal(compactResult(null), null);
  assert.equal(compactResult("B+R"), null);
});

test("a record row is checked: game, board, players, size and replay", () => {
  const good = localRecordUpload(localUpload(), 5_000);
  assert.equal(good.row.source, "local");
  assert.equal(good.row.winner, "black");
  assert.equal(good.ownerColor, "black");
  assert.deepEqual(JSON.parse(good.row.result), { winner: "black", reason: "resign" });
  assert.equal(JSON.parse(good.row.data).replay.events.length, 3);

  const rejects = (overrides, code = "BAD_RECORD") => assert.throws(
    () => localRecordUpload(localUpload(overrides), 5_000),
    (error) => error.code === code,
    JSON.stringify(Object.keys(overrides)),
  );
  rejects({ v: 2 });
  rejects({ clientKey: "room:AB23CD:x:1" });
  rejects({ clientKey: "local:not-a-uuid" });
  rejects({ mode: "friend" });
  rejects({ gameType: "chess" });
  rejects({ width: 2 });
  rejects({ height: 31 });
  rejects({ width: 5.5 });
  rejects({ topology: "sphere" });
  rejects({ players: { black: { name: "A", kind: "human" }, white: { name: "B", kind: "robot" } } });
  rejects({ moveCount: -1 });
  rejects({ replay: { events: [] } });
  rejects({ replay: null });
  rejects({ replay: { ...replay(), events: Array.from({ length: 6_000 }, () => ({ type: "pass", color: "black", note: "x".repeat(40) })) } }, "RECORD_TOO_LARGE");
  assert.throws(() => localRecordUpload(null), (error) => error.code === "BAD_RECORD");

  // Names are trimmed and bounded; an empty one gets a default.
  const named = localRecordUpload(localUpload({
    players: { black: { name: "  ", kind: "human" }, white: { name: `AI ${"x".repeat(60)}`, kind: "ai" } },
  }), 5_000).row;
  assert.equal(named.black_name, "黑方");
  assert.equal([...named.white_name].length, 40);
  // A game cannot finish in the future, nor start after it finished.
  const clocked = localRecordUpload(localUpload({ startedAt: 9_000, finishedAt: 8_000 }), 5_000).row;
  assert.equal(clocked.finished_at, 5_000);
  assert.equal(clocked.started_at, 5_000);
  // Only a game against the AI has the owner's colour.
  assert.equal(localRecordUpload(localUpload({ mode: "local" }), 5_000).ownerColor, null);
  // An unknown winner is stored as no winner.
  assert.equal(recordRow({ ...localUpload({ result: { winner: "nobody" } }), source: "local" }).winner, null);
});

test("saving is idempotent, owners are added once and unknown users are skipped", async () => {
  const db = new FakeD1();
  addUser(db, "user-a");
  const { row } = localRecordUpload(localUpload(), 5_000);
  const id = await saveRecord(db, row, [{ userId: "user-a", color: "black" }, { userId: "gone", color: "white" }]);
  assert.equal(isRecordId(id), true);
  assert.equal(await saveRecord(db, row, [{ userId: "user-a", color: "black" }]), id, "the same game saves once");
  assert.equal(db.rows("game_record").length, 1);
  assert.deepEqual(db.rows("game_record_owner").map(({ user_id, color }) => [user_id, color]), [["user-a", "black"]]);
});

test("My games lists a user's own records, newest first, a page at a time, by game", async () => {
  const db = new FakeD1();
  addUser(db, "me");
  addUser(db, "other");
  const games = ["go", "gomoku", "othello"];
  for (let index = 0; index < 40; index += 1) {
    const { row } = localRecordUpload(localUpload({
      clientKey: `local:${UUID.slice(0, -4)}${String(index).padStart(4, "0")}`,
      gameType: games[index % 3],
      // Two games finish at the same moment: the cursor still pages cleanly.
      finishedAt: 10_000 + Math.floor(index / 2) * 1_000,
    }), 100_000);
    await saveRecord(db, row, [{ userId: index === 39 ? "other" : "me", color: "black" }]);
  }
  const first = await listRecords(db, "me");
  assert.equal(first.records.length, RECORD_PAGE_SIZE);
  assert.ok(first.next);
  const second = await listRecords(db, "me", { before: first.next });
  assert.equal(second.records.length, 39 - RECORD_PAGE_SIZE);
  assert.equal(second.next, null);
  const all = [...first.records, ...second.records];
  assert.equal(new Set(all.map((record) => record.id)).size, 39, "no record twice, none missing");
  assert.deepEqual(all.map((record) => record.finishedAt), [...all.map((record) => record.finishedAt)].sort((a, b) => b - a));
  assert.equal(all[0].players.black.name, "Mia");
  assert.equal(all[0].color, "black");
  assert.equal("replay" in all[0], false, "the list carries no replays");

  const gomoku = await listRecords(db, "me", { gameType: "gomoku" });
  assert.equal(gomoku.records.length, 13);
  assert.ok(gomoku.records.every((record) => record.gameType === "gomoku"));
  // Odd inputs fall back to safe values.
  assert.equal((await listRecords(db, "me", { limit: 5 })).records.length, 5);
  assert.equal((await listRecords(db, "me", { limit: 1_000 })).records.length, RECORD_PAGE_SIZE);
  assert.equal((await listRecords(db, "me", { gameType: "chess", before: "garbage" })).records.length, RECORD_PAGE_SIZE);
  assert.deepEqual(await listRecords(db, "nobody"), { records: [], next: null });
});

test("only an owner opens a record; removing it leaves the other player's copy", async () => {
  const db = new FakeD1();
  for (const id of ["black-user", "white-user", "stranger"]) addUser(db, id);
  const { row } = localRecordUpload(localUpload(), 5_000);
  const id = await saveRecord(db, row, [{ userId: "black-user", color: "black" }, { userId: "white-user", color: "white" }]);

  const opened = await readRecord(db, id, "white-user");
  assert.equal(opened.status, "ok");
  assert.equal(opened.record.color, "white");
  assert.equal(opened.record.replay.events.length, 3);
  assert.deepEqual(opened.record.settings, { size: 5 });
  assert.equal((await readRecord(db, id, "stranger")).status, "forbidden");
  assert.equal((await readRecord(db, id, null)).status, "forbidden");
  assert.equal((await readRecord(db, newRecordId(), "black-user")).status, "missing");
  assert.equal((await readRecord(db, "../etc", "black-user")).status, "missing");

  assert.equal(await removeRecord(db, id, "stranger"), false);
  assert.equal(await removeRecord(db, id, "black-user"), true);
  assert.equal((await readRecord(db, id, "black-user")).status, "forbidden");
  assert.equal((await readRecord(db, id, "white-user")).status, "ok", "the other player keeps it");
  assert.equal(await removeRecord(db, id, "white-user"), true);
  assert.equal(db.rows("game_record").length, 0, "nobody keeps it: the record goes");
  assert.equal(await removeRecord(db, "bad", "white-user"), false);
});

function round(players, overrides = {}) {
  return {
    roundId: 2,
    incarnationId: "inc-1",
    startedAt: 1_000,
    finishedAt: 9_000,
    result: { winner: "white", reason: "resign" },
    settings: { width: 9, height: 9, size: 9, topology: "torus", komi: 6.5 },
    mode: "friend",
    moveCount: 12,
    replay: replay(12),
    gameType: "go",
    players,
    ...overrides,
  };
}

test("an online round is owned by the users on its seats", () => {
  const human = (name, operatorId, userId) => ({ kind: "human", name, operatorId, userId });
  const ai = (operatorId, userId) => ({ kind: "ai", name: "KataGo b10 AI", operatorId, userId });

  const friends = onlineRoundRecord(round({ black: human("A", "p1", "u1"), white: human("B", "p2", "u2") }), "AB23CD");
  assert.deepEqual(friends.owners, [{ userId: "u1", color: "black" }, { userId: "u2", color: "white" }]);
  assert.equal(friends.row.client_key, "room:AB23CD:inc-1:2");
  assert.equal(friends.row.room_code, "AB23CD");
  assert.equal(friends.row.topology, "torus");
  assert.equal(friends.row.source, "online");

  // A player from before accounts: only the other one gets it.
  assert.deepEqual(onlineRoundRecord(round({ black: human("A", "p1", null), white: human("B", "p2", "u2") }), "AB23CD").owners,
    [{ userId: "u2", color: "white" }]);
  // Against the AI: the human's colour; the AI's operator is the same person.
  assert.deepEqual(onlineRoundRecord(round({ black: human("A", "p1", "u1"), white: ai("p1", "u1") }, { mode: "human-ai" }), "AB23CD").owners,
    [{ userId: "u1", color: "black" }]);
  // One person on both seats, or running both AIs: owned without a colour.
  assert.deepEqual(onlineRoundRecord(round({ black: human("A", "p1", "u1"), white: human("A", "p1", "u1") }, { mode: "local" }), "AB23CD").owners,
    [{ userId: "u1", color: null }]);
  assert.deepEqual(onlineRoundRecord(round({ black: ai("p1", "u1"), white: ai("p1", "u1") }, { mode: "ai-ai" }), "AB23CD").owners,
    [{ userId: "u1", color: null }]);
  // Board size falls back to the replay's base when settings lack it.
  assert.equal(onlineRoundRecord(round({ black: human("A", "p1", "u1"), white: human("B", "p2", "u2") }, { settings: {} }), "AB23CD").row.width, 5);
});

function roomWithDatabase(engine, db) {
  const pending = [];
  let ready;
  const storage = {
    value: engine.serialize(),
    async get() { return structuredClone(this.value); },
    async put(_key, value) { this.value = structuredClone(value); },
    async getAlarm() { return null; },
    async setAlarm() {},
    async deleteAlarm() {},
  };
  const room = new BadukRoom({
    storage,
    id: { toString: () => "records-room" },
    getWebSockets: () => [],
    blockConcurrencyWhile(callback) { ready = callback(); },
    waitUntil(promise) { pending.push(promise); },
  }, { DB: db });
  return { room, ready: () => ready, settle: () => Promise.all(pending.splice(0)) };
}

test("a room saves a finished round to both players' records, once", async (t) => {
  t.mock.method(console, "error", () => {});
  const db = new FakeD1();
  addUser(db, "host-user");
  addUser(db, "friend-user");
  const now = Date.now();
  const engine = RoomEngine.create({
    code: "REC234", name: "Host", size: 9, playerId: "host", tokenHash: "a".repeat(64), userId: "host-user", now,
  });
  engine.join({ name: "Friend", role: "player", playerId: "friend", tokenHash: "b".repeat(64), userId: "friend-user", now });
  // userId never reaches what pages see.
  assert.doesNotMatch(JSON.stringify(engine.snapshotFor("host", now)), /host-user|friend-user/u);
  const { room, ready, settle } = roomWithDatabase(engine, db);
  await ready();

  room.engine.applyAction({ playerId: "host", action: "play", payload: { row: 2, col: 2 }, now: now + 10 });
  await room.persist();
  await settle();
  assert.equal(db.rows("game_record").length, 0, "nothing is saved mid-game");

  room.engine.applyAction({ playerId: "friend", action: "resign", payload: { color: "white" }, now: now + 20 });
  // The database is down at first: the room keeps going and tries again.
  db.failing = true;
  await room.persist();
  await settle();
  db.failing = false;
  assert.equal(db.rows("game_record").length, 0);
  await room.persist();
  await settle();
  await room.persist();
  await settle();
  const records = db.rows("game_record");
  assert.equal(records.length, 1, "saved once");
  assert.equal(records[0].winner, "black");
  assert.equal(records[0].black_name, "Host");
  assert.equal(records[0].white_name, "Friend");
  assert.equal(records[0].move_count, 1);
  assert.equal(records[0].room_code, "REC234");
  assert.deepEqual(db.rows("game_record_owner").map(({ user_id, color }) => `${user_id}:${color}`).sort(),
    ["friend-user:white", "host-user:black"]);
  const opened = await readRecord(db, records[0].id, "friend-user");
  assert.equal(opened.record.replay.events.filter((event) => event.type === "play").length, 1);

  // A room without a database (or players without accounts) just goes on.
  const plain = roomWithDatabase(RoomEngine.restore(room.engine.serialize()), undefined);
  await plain.ready();
  await plain.room.persist();
  await plain.settle();
});

test("a rejoining browser updates who it is; a spectator's user is kept too", () => {
  const now = Date.now();
  const engine = RoomEngine.create({ code: "REJ234", name: "Host", size: 9, playerId: "host", tokenHash: "a".repeat(64), now });
  assert.equal(engine.member("host").userId, undefined, "created before accounts");
  const again = engine.join({ name: "Host", role: "player", playerId: "host", tokenHash: "a".repeat(64), userId: "u-host", now });
  assert.equal(again.changed, true);
  assert.equal(engine.member("host").userId, "u-host");
  assert.equal(engine.join({ name: "Host", role: "player", playerId: "host", tokenHash: "a".repeat(64), userId: "u-host", now }).changed, false);
  assert.equal(engine.join({ name: "Host", role: "player", playerId: "host", tokenHash: "a".repeat(64), now }).changed, false,
    "no user given: nothing to change");
  engine.join({ name: "Viewer", role: "spectator", playerId: "viewer", tokenHash: "c".repeat(64), userId: "u-view", now });
  assert.equal(engine.member("viewer").userId, "u-view");
  // A malformed id is ignored.
  engine.join({ name: "Odd", role: "spectator", playerId: "odd", tokenHash: "d".repeat(64), userId: "bad id!", now });
  assert.equal(engine.member("odd").userId, undefined);
  // It survives a restart.
  assert.equal(RoomEngine.restore(engine.serialize()).member("host").userId, "u-host");
});

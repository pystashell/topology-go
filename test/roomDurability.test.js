import assert from "node:assert/strict";
import test from "node:test";
import { BadukRoom } from "../worker/BadukRoom.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";

function savedRoom() {
  const now = Date.now();
  const engine = RoomEngine.create({ code: "BAM234", name: "Black", size: 5,
    playerId: "black", tokenHash: "a".repeat(64), now });
  engine.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now });
  return engine.serialize();
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
    if (failure === "serialize") t.mock.method(room.engine, "serialize", () => { throw new TypeError("not serializable"); });
    else t.mock.method(storage, "put", async (key, value) => {
      storage.writes++;
      if (failure.endsWith("after commit")) storage.value = structuredClone(value);
      throw new Error("write outcome unknown");
    });
    const client = socket();
    await room.handleCommand(client, attachment, command);
    await room.handleCommand(client, attachment, command);
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
  t.mock.method(room, "scheduleAlarm", async () => { throw new Error("alarm unavailable"); });
  const client = socket();
  await room.handleCommand(client, attachment, command);
  await room.handleCommand(client, attachment, command);
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

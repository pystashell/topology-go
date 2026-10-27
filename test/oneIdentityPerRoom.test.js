import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { BADUK_PROTOCOL_VERSION } from "../src/multiplayer/protocol.js";
import { RoomEngine, RoomEngineError, hashRoomToken } from "../src/multiplayer/roomEngine.js";
import { BadukRoom, SESSION_USER_HEADER } from "../worker/BadukRoom.js";
import worker from "../worker/index.js";
import { FakeD1 } from "./helpers/d1.js";

/*
 * One identity per person in a room. Spectator chat is hidden from the
 * players, so someone who plays in a room must never also be in it as a
 * spectator, through the page or straight through the API. The room knows
 * a person by the account (or guest) behind each request: whoever is
 * already in the room and comes in again, from any browser, gets their own
 * identity back.
 */

const NOW = 1_800_000_000_000;
const conflict = (error) => error instanceof RoomEngineError && error.code === "CONFLICT" && error.status === 409;

async function room({ hostUser = "user-host" } = {}) {
  const engine = RoomEngine.create({
    code: "QNE234", name: "Host", size: 9, playerId: "host",
    tokenHash: await hashRoomToken("host-secret"), userId: hostUser, now: NOW,
  });
  return engine;
}

const join = async (engine, { playerId, role, userId, formerUserIds, token = `${playerId}-secret` }) => engine.join({
  name: playerId, role, playerId, tokenHash: await hashRoomToken(token), userId, formerUserIds, now: NOW + 10,
});

test("a player coming in again as a spectator, or as a new player, gets their seat back", async () => {
  const engine = await room();
  const watch = await join(engine, { playerId: "host-watch", role: "spectator", userId: "user-host" });
  assert.equal(watch.rejoined, true);
  assert.deepEqual([watch.identity.playerId, watch.identity.role, watch.identity.color], ["host", "player", "black"]);
  const seat = await join(engine, { playerId: "host-white", role: "player", userId: "user-host" });
  assert.deepEqual([seat.identity.playerId, seat.identity.color], ["host", "black"]);
  assert.equal(engine.state.members.length, 1, "no second identity");
  // Each of those browsers can now open the seat; the first one still can.
  for (const token of ["host-secret", "host-watch-secret", "host-white-secret"]) {
    assert.equal((await engine.authenticateToken(token, NOW + 20)).playerId, "host", token);
  }
  // The same identity coming back is not a second one.
  const again = await join(engine, { playerId: "host", role: "player", userId: "user-host", token: "host-secret" });
  assert.equal(again.identity.color, "black");
  // Other people come in as usual; people without an account cannot be told apart.
  await join(engine, { playerId: "viewer", role: "spectator", userId: "user-viewer" });
  await join(engine, { playerId: "anon", role: "spectator", userId: undefined });
  assert.equal(engine.state.members.length, 3);
  // The account never reaches what pages see, nor do the tokens.
  const seen = JSON.stringify(engine.snapshotFor("host", NOW + 30));
  assert.doesNotMatch(seen, /user-host|deviceTokenHashes/u);
});

test("a spectator coming in again stays the same spectator, and takes a seat from inside", async () => {
  const engine = await room();
  await join(engine, { playerId: "viewer", role: "spectator", userId: "user-viewer" });
  const asPlayer = await join(engine, { playerId: "viewer-seat", role: "player", userId: "user-viewer" });
  assert.deepEqual([asPlayer.rejoined, asPlayer.identity.playerId, asPlayer.identity.role], [true, "viewer", "spectator"]);
  const again = await join(engine, { playerId: "viewer-2", role: "spectator", userId: "user-viewer" });
  assert.equal(again.identity.playerId, "viewer");
  assert.equal(engine.state.members.length, 2);
  const claimed = engine.applyAction({ playerId: "viewer", action: "claim_seat", now: NOW + 20 });
  assert.equal(claimed.identity.color, "white", "the same identity becomes the player");
  assert.equal(engine.state.members.length, 2);
});

test("entering again is idempotent, keeps the newest browsers and survives a restart", async () => {
  const engine = await room();
  const first = await join(engine, { playerId: "phone", role: "spectator", userId: "user-host" });
  assert.equal(first.changed, true, "a new browser is stored");
  const retry = await join(engine, { playerId: "phone", role: "spectator", userId: "user-host" });
  assert.equal(retry.changed, false, "the same request again changes nothing");
  for (const device of ["tablet", "laptop", "office", "library"]) {
    await join(engine, { playerId: device, role: "player", userId: "user-host" });
  }
  assert.equal(engine.member("host").deviceTokenHashes.length, 4, "at most four more browsers");
  await assert.rejects(engine.authenticateToken("phone-secret", NOW + 20), /重新加入/u, "the oldest one dropped");
  assert.equal((await engine.authenticateToken("library-secret", NOW + 20)).playerId, "host");
  assert.equal((await engine.authenticateToken("host-secret", NOW + 20)).playerId, "host", "the first browser stays");
  // Stored and restored with the room.
  const restored = RoomEngine.restore(engine.serialize());
  assert.equal((await restored.authenticateToken("office-secret", NOW + 30)).playerId, "host");
  const broken = engine.serialize();
  broken.members[0].deviceTokenHashes = ["not-a-hash"];
  assert.throws(() => RoomEngine.restore(broken), /凭据无效/u);
});

test("someone else's token is still refused, whoever sends it", async () => {
  const engine = await room();
  await join(engine, { playerId: "viewer", role: "spectator", userId: "user-viewer" });
  await assert.rejects(join(engine, { playerId: "thief", role: "player", userId: "user-thief", token: "viewer-secret" }), conflict);
  await assert.rejects(join(engine, { playerId: "host-2", role: "player", userId: "user-host", token: "viewer-secret" }), conflict);
  assert.equal(engine.state.members.length, 2);
});

test("a seat taken as a guest belongs to the account that guest became", async () => {
  // The host played as guest-1, then registered in that browser: the
  // server now knows them as account-1 and remembers guest-1 as before.
  const engine = await room({ hostUser: "guest-1" });
  await join(engine, { playerId: "viewer", role: "spectator", userId: "user-viewer" });
  const back = await join(engine, { playerId: "laptop", role: "spectator", userId: "account-1", formerUserIds: ["guest-1"] });
  assert.deepEqual([back.rejoined, back.identity.playerId, back.identity.color], [true, "host", "black"]);
  assert.equal(engine.member("host").userId, "account-1", "games now go to the account");
  assert.equal(engine.state.members.length, 2);
  // On a connection the same way.
  const other = await room({ hostUser: "guest-2" });
  assert.deepEqual(other.checkSessionUser("host", "account-2", NOW + 30, ["guest-2"]), { changed: true, refused: false, removed: [] });
  assert.equal(other.member("host").userId, "account-2");
  // Someone else's former guests mean nothing.
  const third = await room({ hostUser: "guest-3" });
  assert.deepEqual(third.checkSessionUser("host", "account-9", NOW + 30, ["guest-8"]), { changed: false, refused: false, removed: [] });
  assert.equal(third.member("host").userId, "guest-3");
  const watcher = await join(third, { playerId: "watcher", role: "spectator", userId: "account-9", formerUserIds: ["guest-8"] });
  assert.equal(watcher.identity.playerId, "watcher", "a new spectator");
  // Two identities of one person from before the merge: entering again
  // returns the seat, and the spectator one goes on its next connection.
  const merged = await room({ hostUser: "guest-5" });
  await join(merged, { playerId: "watch-5", role: "spectator", userId: "account-5" });
  const seatBack = await join(merged, { playerId: "tablet-5", role: "spectator", userId: "account-5", formerUserIds: ["guest-5"] });
  assert.deepEqual([seatBack.identity.playerId, seatBack.identity.color], ["host", "black"]);
  assert.equal(merged.checkSessionUser("watch-5", "account-5", NOW + 30, ["guest-5"]).refused, true);
  // A spectator identity of the same person, known by the former guest, goes.
  const fourth = await room({ hostUser: null });
  await join(fourth, { playerId: "host-watch", role: "spectator", userId: "guest-4" });
  const seat = fourth.checkSessionUser("host", "account-4", NOW + 30, ["guest-4"]);
  assert.deepEqual(seat.removed, ["host-watch"]);
});

test("a player's browser on an old spectator identity: the room drops that identity", async () => {
  // Identities from before accounts have no user; the browser's session
  // arrives with each connection.
  const engine = await room({ hostUser: null });
  await join(engine, { playerId: "host-watch", role: "spectator", userId: undefined });
  // The player connects first: the account is bound to the seat.
  assert.deepEqual(engine.checkSessionUser("host", "user-host", NOW + 30), { changed: true, refused: false, removed: [] });
  assert.equal(engine.member("host").userId, "user-host");
  // The same browser's spectator identity is refused and removed.
  assert.deepEqual(engine.checkSessionUser("host-watch", "user-host", NOW + 40), { changed: true, refused: true, removed: [] });
  assert.equal(engine.member("host-watch"), undefined);
});

test("the other way round: a spectator identity bound first goes when the player connects", async () => {
  const engine = await room({ hostUser: null });
  await join(engine, { playerId: "host-watch", role: "spectator", userId: undefined });
  assert.equal(engine.checkSessionUser("host-watch", "user-host", NOW + 30).refused, false);
  assert.equal(engine.member("host-watch").userId, "user-host");
  const seat = engine.checkSessionUser("host", "user-host", NOW + 40);
  assert.deepEqual(seat, { changed: true, refused: false, removed: ["host-watch"] });
  assert.equal(engine.member("host").userId, "user-host");
  // Nothing to do on the next connection; no account, nothing to check.
  assert.deepEqual(engine.checkSessionUser("host", "user-host", NOW + 50), { changed: false, refused: false, removed: [] });
  assert.deepEqual(engine.checkSessionUser("host", null, NOW + 50), { changed: false, refused: false, removed: [] });
  assert.deepEqual(engine.checkSessionUser("nobody", "user-host", NOW + 50), { changed: false, refused: false, removed: [] });
  // The account never reaches what pages see.
  assert.doesNotMatch(JSON.stringify(engine.snapshotFor("host", NOW + 60)), /user-host/u);
});

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.attachment = null;
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

function durableRoom(stored) {
  let ready;
  const sockets = [];
  const storage = {
    value: structuredClone(stored),
    async get() { return structuredClone(this.value); },
    async put(_key, value) { this.value = structuredClone(value); },
    async getAlarm() { return null; },
    async setAlarm() {},
    async deleteAlarm() {},
  };
  const roomObject = new BadukRoom({
    storage,
    id: { toString: () => "one-room" },
    getWebSockets: () => sockets.filter((socket) => socket.readyState < 2),
    acceptWebSocket(socket) { sockets.push(socket); },
    blockConcurrencyWhile(callback) { ready = callback(); },
    waitUntil() {},
  }, {});
  return { room: roomObject, storage, sockets, ready: () => ready };
}

function connect(roomObject, token, userId) {
  const encoded = Buffer.from(token).toString("base64url");
  return roomObject.fetch(new Request("https://room.test/api/rooms/QNE234/socket", {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `bamboo-baduk-v2, token.${encoded}`,
      ...(userId ? { [SESSION_USER_HEADER]: userId } : {}),
    },
  }));
}

test("the room closes a spectator connection from a player's browser for good", async (t) => {
  const pairs = withFakeWebSockets(t);
  const engine = await room({ hostUser: null });
  await join(engine, { playerId: "host-watch", role: "spectator", userId: undefined });
  await join(engine, { playerId: "viewer", role: "spectator", userId: undefined });
  const { room: roomObject, storage, sockets, ready } = durableRoom(engine.serialize());
  await ready();

  assert.equal((await connect(roomObject, "host-secret", "user-host")).status, 101);
  assert.equal((await connect(roomObject, "viewer-secret", "user-viewer")).status, 101);
  const refused = await connect(roomObject, "host-watch-secret", "user-host");
  assert.equal(refused.status, 101, "accepted only to explain and close");
  const server = pairs.at(-1)[1];
  assert.equal(server.messages[0].code, "ALREADY_PLAYING_HERE");
  assert.equal(server.closed.code, 4401, "4401: the page drops this identity and does not reconnect");
  assert.equal(sockets.includes(server), false, "never joined the room's sockets");
  assert.equal(roomObject.engine.member("host-watch"), undefined);
  assert.equal(storage.value.members.some(({ playerId }) => playerId === "host-watch"), false, "the removal is stored");
  assert.equal(storage.value.members.find(({ playerId }) => playerId === "host").userId, "user-host");
  // Other people are untouched.
  assert.ok(roomObject.engine.member("viewer"));
});

test("a player connecting closes a spectator identity their browser already had open", async (t) => {
  withFakeWebSockets(t);
  const engine = await room({ hostUser: null });
  await join(engine, { playerId: "host-watch", role: "spectator", userId: undefined });
  const { room: roomObject, sockets, ready } = durableRoom(engine.serialize());
  await ready();
  await connect(roomObject, "host-watch-secret", "user-host");
  const watching = sockets.find((socket) => socket.attachment?.identity?.playerId === "host-watch");
  assert.ok(watching);
  await connect(roomObject, "host-secret", "user-host");
  assert.equal(watching.closed?.code, 4401);
  assert.ok(watching.messages.some(({ code }) => code === "ALREADY_PLAYING_HERE"));
  assert.equal(roomObject.engine.member("host-watch"), undefined);
});

test("the worker tells the room whose browser connects; a client cannot claim an account", async () => {
  const forwarded = [];
  const env = {
    DB: new FakeD1(),
    BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
    BADUK_ROOMS: {
      getByName() {
        return {
          async fetch(request) {
            if (new URL(request.url).pathname.endsWith("/socket")) {
              forwarded.push(request.headers.get(SESSION_USER_HEADER));
              return new Response(null, { status: 204 });
            }
            const body = await request.json();
            return Response.json({
              room: { code: "AB23CD" },
              identity: { code: "AB23CD", playerId: body.playerId, playerName: body.name, role: "player", color: "black" },
            }, { status: 201 });
          },
        };
      },
    },
  };
  const origin = "https://baduk.test";
  const created = await worker.fetch(new Request(`${origin}/api/rooms`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      v: BADUK_PROTOCOL_VERSION, name: "Mia", size: 9, roomCode: "AB23CD",
      playerId: randomUUID(), token: randomBytes(32).toString("hex"), multiGame: true,
    }),
  }), env);
  const cookie = created.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const userId = env.DB.rows("user")[0].id;
  const socket = (headers) => worker.fetch(new Request(`${origin}/api/rooms/AB23CD/socket`, {
    headers: { Origin: origin, Upgrade: "websocket", ...headers },
  }), env);
  await socket({ Cookie: cookie, [SESSION_USER_HEADER]: "someone-else" });
  await socket({ [SESSION_USER_HEADER]: userId });
  await socket({});
  assert.deepEqual(forwarded, [userId, null, null]);
});

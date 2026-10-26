import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { BADUK_PROTOCOL_VERSION } from "../src/multiplayer/protocol.js";
import { authConfigured, userOrNewGuest } from "../worker/auth.js";
import worker from "../worker/index.js";
import { FakeD1 } from "./helpers/d1.js";

/*
 * Guests (Better Auth on D1) and the game record routes of worker/index.js:
 * who becomes a guest and when, what the room learns, and who may list,
 * open, upload and remove records.
 */

const ORIGIN = "https://baduk.test";
const SECRET = "test-secret-0123456789abcdef0123456789abcdef";

function rooms() {
  const calls = [];
  return {
    calls,
    getByName(code) {
      return {
        async fetch(request) {
          const body = await request.json();
          calls.push({ path: new URL(request.url).pathname, body });
          return Response.json({
            room: { code },
            identity: {
              code, playerId: body.playerId, playerName: body.name,
              role: body.role ?? "player", color: body.role === "spectator" ? null : "black",
            },
          }, { status: 201 });
        },
      };
    },
  };
}

function environment(overrides = {}) {
  return { DB: new FakeD1(), BETTER_AUTH_SECRET: SECRET, BADUK_ROOMS: rooms(), ...overrides };
}

/** A browser: keeps the cookies the site sets and sends them back. */
function browser(env) {
  const jar = new Map();
  return {
    jar,
    async call(path, { method = "GET", body, origin = ORIGIN } = {}) {
      const headers = new Headers({ Origin: origin });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (jar.size) headers.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      const response = await worker.fetch(new Request(ORIGIN + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
      const set = response.headers.getSetCookie();
      for (const cookie of set) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, json, setCookie: set };
    },
  };
}

function createBody() {
  return {
    v: BADUK_PROTOCOL_VERSION,
    name: "Mia",
    size: 9,
    roomCode: "AB23CD",
    playerId: randomUUID(),
    token: randomBytes(32).toString("hex"),
    multiGame: true,
  };
}

function joinBody(role = "player") {
  return { v: BADUK_PROTOCOL_VERSION, name: "Lee", role, playerId: randomUUID(), token: randomBytes(32).toString("hex"), multiGame: true };
}

function upload(overrides = {}) {
  return {
    v: 1,
    clientKey: `local:${randomUUID()}`,
    mode: "human-ai",
    ownerColor: "white",
    gameType: "gomoku",
    width: 15,
    height: 15,
    topology: "torus",
    players: { black: { name: "Rapfi AI", kind: "ai" }, white: { name: "Mia", kind: "human" } },
    result: { winner: "white", reason: "five" },
    moveCount: 2,
    startedAt: Date.now() - 60_000,
    finishedAt: Date.now(),
    settings: { gameType: "gomoku", width: 15, height: 15 },
    replay: { version: 1, base: { width: 15, height: 15 }, events: [{ type: "play", color: "black", row: 7, col: 7 }, { type: "play", color: "white", row: 7, col: 8 }] },
    ...overrides,
  };
}

test("identity needs both a database and a real secret", () => {
  assert.equal(authConfigured({}), false);
  assert.equal(authConfigured({ DB: new FakeD1() }), false);
  assert.equal(authConfigured({ DB: new FakeD1(), BETTER_AUTH_SECRET: "short" }), false);
  assert.equal(authConfigured({ DB: new FakeD1(), BETTER_AUTH_SECRET: SECRET }), true);
});

test("a player creating a room becomes a guest once, and the room learns who it is", async () => {
  const env = environment();
  const mia = browser(env);
  assert.equal((await mia.call("/api/auth/get-session")).json, null, "nobody yet");
  const created = await mia.call("/api/rooms", { method: "POST", body: createBody() });
  assert.equal(created.status, 201);
  // Over HTTPS the cookie also carries the __Secure- prefix and Secure flag.
  assert.ok(created.setCookie.some((cookie) => /^__Secure-topology-go\.session_token=/u.test(cookie) &&
    /HttpOnly/iu.test(cookie) && /Secure/u.test(cookie) && /SameSite=Lax/iu.test(cookie)),
    "a session cookie scripts cannot read");
  const session = (await mia.call("/api/auth/get-session")).json;
  assert.equal(session.user.isAnonymous, true);
  assert.equal(session.user.name, "Guest");
  assert.equal(env.BADUK_ROOMS.calls[0].path, "/internal/init");
  assert.equal(env.BADUK_ROOMS.calls[0].body.userId, session.user.id);

  // The same browser stays the same guest.
  const again = await mia.call("/api/rooms", { method: "POST", body: { ...createBody(), roomCode: "EF34GH" } });
  assert.equal(again.status, 201);
  assert.equal(again.setCookie.length, 0);
  assert.equal(env.BADUK_ROOMS.calls[1].body.userId, session.user.id);
  assert.equal(env.DB.rows("user").length, 1);
  // A request the worker refuses creates nobody.
  const other = browser(env);
  assert.equal((await other.call("/api/rooms", { method: "POST", body: { ...createBody(), token: "short" } })).status, 400);
  assert.equal(env.DB.rows("user").length, 1);
});

test("joining as a player makes a guest; watching only passes on an existing one", async () => {
  const env = environment();
  const viewer = browser(env);
  const watched = await viewer.call("/api/rooms/AB23CD/join", { method: "POST", body: joinBody("spectator") });
  assert.equal(watched.status, 201);
  assert.equal(watched.setCookie.length, 0, "watching does not create a guest");
  assert.equal("userId" in env.BADUK_ROOMS.calls[0].body, false);
  assert.equal(env.DB.rows("user").length, 0);

  const joined = await viewer.call("/api/rooms/AB23CD/join", { method: "POST", body: joinBody("player") });
  assert.equal(joined.status, 201);
  const userId = env.BADUK_ROOMS.calls[1].body.userId;
  assert.ok(userId);
  await viewer.call("/api/rooms/EF34GH/join", { method: "POST", body: joinBody("spectator") });
  assert.equal(env.BADUK_ROOMS.calls[2].body.userId, userId, "a known guest is passed on when watching");
});

test("rooms keep working when identity is unavailable", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const env of [
    environment({ BETTER_AUTH_SECRET: undefined }),
    environment({ DB: undefined }),
    (() => { const env = environment(); env.DB.failing = true; return env; })(),
  ]) {
    const created = await browser(env).call("/api/rooms", { method: "POST", body: createBody() });
    assert.equal(created.status, 201);
    assert.equal(created.setCookie.length, 0);
    assert.equal("userId" in env.BADUK_ROOMS.calls[0].body, false);
  }
  assert.deepEqual((await browser(environment({ BETTER_AUTH_SECRET: undefined })).call("/api/auth/get-session")).json,
    { error: "账号服务暂时不可用。", code: "AUTH_UNAVAILABLE" });
});

test("a finished game uploads once, lists, opens for its owner only and can be removed", async () => {
  const env = environment();
  const mia = browser(env);
  assert.deepEqual((await mia.call("/api/records")).json, { records: [], next: null }, "no session: an empty list");

  const body = upload();
  const saved = await mia.call("/api/records", { method: "POST", body });
  assert.equal(saved.status, 201);
  assert.ok(saved.setCookie.length > 0, "uploading made this browser a guest");
  assert.equal((await mia.call("/api/records", { method: "POST", body })).json.id, saved.json.id, "a retry saves nothing new");

  const list = (await mia.call("/api/records")).json;
  assert.equal(list.records.length, 1);
  assert.deepEqual(list.records[0].players.white, { name: "Mia", kind: "human" });
  assert.equal(list.records[0].color, "white");
  assert.equal((await mia.call("/api/records?game=go")).json.records.length, 0);
  assert.equal((await mia.call("/api/records?game=gomoku")).json.records.length, 1);

  const opened = await mia.call(`/api/records/${saved.json.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.json.record.replay.events.length, 2);

  const stranger = browser(env);
  await stranger.call("/api/records", { method: "POST", body: upload() });
  assert.deepEqual((await stranger.call(`/api/records/${saved.json.id}`)).json,
    { error: "这盘棋只有对局双方能看。", code: "RECORD_FORBIDDEN" });
  assert.equal((await browser(env).call(`/api/records/${saved.json.id}`)).status, 403);
  assert.equal((await stranger.call(`/api/records/${saved.json.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await browser(env).call(`/api/records/${saved.json.id}`, { method: "DELETE" })).status, 404);

  assert.equal((await mia.call(`/api/records/${saved.json.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await mia.call(`/api/records/${saved.json.id}`)).status, 404, "nobody keeps it any more");
  assert.equal((await mia.call("/api/records")).json.records.length, 0);
});

test("record routes check method, origin, id, body and budget", async () => {
  const env = environment();
  const mia = browser(env);
  assert.equal((await mia.call("/api/records", { method: "PUT" })).status, 405);
  assert.equal((await mia.call("/api/records/abcdefghijkmnpqr", { method: "POST" })).status, 405);
  assert.equal((await mia.call("/api/records", { origin: "https://evil.test" })).status, 403);
  assert.equal((await mia.call("/api/records/abcdefghijkmnpqr", { origin: "https://evil.test" })).status, 403);
  assert.deepEqual((await mia.call("/api/records/not-an-id")).json, { error: "没有找到这盘棋谱。", code: "RECORD_NOT_FOUND" });
  assert.equal((await mia.call("/api/records/abcdefghijkmnpqr")).status, 404);

  const bad = await mia.call("/api/records", { method: "POST", body: upload({ mode: "friend" }) });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "BAD_RECORD");
  assert.equal(env.DB.rows("user").length, 0, "a refused upload creates nobody");
  const huge = await mia.call("/api/records", { method: "POST", body: upload({ replay: { base: {}, events: [], padding: "x".repeat(300 * 1024) } }) });
  assert.equal(huge.status, 413);
  assert.equal(huge.json.code, "RECORD_TOO_LARGE");

  const noDatabase = browser(environment({ DB: undefined }));
  assert.equal((await noDatabase.call("/api/records")).json.code, "RECORDS_UNAVAILABLE");
  assert.equal((await noDatabase.call("/api/records/abcdefghijkmnpqr")).json.code, "RECORDS_UNAVAILABLE");

  const limited = browser(environment({ RECORD_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal((await limited.call("/api/records")).status, 429);
  const authLimited = browser(environment({ AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal((await authLimited.call("/api/auth/get-session")).status, 429);
});

test("a database failure while saving reads as a retryable outage", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = environment();
  const mia = browser(env);
  await mia.call("/api/records", { method: "POST", body: upload() });
  env.DB.failing = true;
  const failed = await mia.call("/api/records", { method: "POST", body: upload() });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.code, "RECORDS_UNAVAILABLE");
  assert.equal(failed.json.retryable, true);
  // The signed session cookie still says who this is; the list itself fails.
  assert.equal((await mia.call("/api/records")).json.code, "RECORDS_UNAVAILABLE");
  env.DB.failing = false;
  assert.equal((await mia.call("/api/records")).json.records.length, 1);
  // The guest helper itself never throws.
  env.DB.failing = true;
  assert.deepEqual(await userOrNewGuest(env, new Request(ORIGIN)), { user: null, setCookie: [] });
});

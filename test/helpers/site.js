/**
 * The Worker as a browser sees it, for route tests: an environment on a
 * FakeD1 database with stand-in rooms, and browsers that keep the cookies
 * the site sets.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { BADUK_PROTOCOL_VERSION } from "../../src/multiplayer/protocol.js";
import worker from "../../worker/index.js";
import { FakeD1 } from "./d1.js";

export const ORIGIN = "https://baduk.test";
export const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
export const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";

/** Rooms that answer every join and creation and remember what they were sent. */
export function rooms() {
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

export function environment(overrides = {}) {
  return { DB: new FakeD1(), BETTER_AUTH_SECRET: SECRET, BADUK_ROOMS: rooms(), ...overrides };
}

/** A browser: keeps the cookies the site sets (and drops the ones it clears) and sends them back. */
export function browser(env) {
  const jar = new Map();
  return {
    jar,
    async call(path, { method = "GET", body, origin = ORIGIN, headers: extra = {} } = {}) {
      const headers = new Headers({ Origin: origin, ...extra });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (jar.size) headers.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      const response = await worker.fetch(new Request(ORIGIN + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
      const set = response.headers.getSetCookie();
      for (const cookie of set) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const value = pair.slice(index + 1);
        if (value === "" || /Max-Age=0/iu.test(cookie)) jar.delete(pair.slice(0, index));
        else jar.set(pair.slice(0, index), value);
      }
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, json, setCookie: set, headers: response.headers };
    },
  };
}

export function createBody(overrides = {}) {
  return {
    v: BADUK_PROTOCOL_VERSION,
    name: "Mia",
    size: 9,
    roomCode: "AB23CD",
    playerId: randomUUID(),
    token: randomBytes(32).toString("hex"),
    multiGame: true,
    ...overrides,
  };
}

export function joinBody(role = "player") {
  return { v: BADUK_PROTOCOL_VERSION, name: "Lee", role, playerId: randomUUID(), token: randomBytes(32).toString("hex"), multiGame: true };
}

/** A finished game played on one page, as the page uploads it. */
export function upload(overrides = {}) {
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

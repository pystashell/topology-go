import { BadukRoom, SESSION_USER_HEADER } from "./BadukRoom.js";
import { BadukLobby } from "./BadukLobby.js";
import {
  BADUK_PROTOCOL_VERSION,
  isRecord,
  isRoomCode,
  isRoomRole,
  stripUnsafeNameCharacters,
} from "../src/multiplayer/protocol.js";
import { hashRoomToken } from "../src/multiplayer/roomEngine.js";
import { authFor, sessionUser, userOrNewGuest, withCookies } from "./auth.js";
import {
  MAX_RECORD_DATA_BYTES,
  RecordError,
  isRecordId,
  listRecords,
  localRecordUpload,
  readRecord,
  removeRecord,
  saveRecord,
} from "./records.js";

export { BadukLobby, BadukRoom };

const MAX_BODY_BYTES = 4 * 1024;
// An uploaded game: its replay plus a little metadata.
const MAX_RECORD_BODY_BYTES = MAX_RECORD_DATA_BYTES + 8 * 1024;
const JOIN_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const JOIN_PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

/**
 * Per-client budget from a Workers Rate Limiting binding (see wrangler.jsonc).
 * Each route has its own binding keyed by the client IP. The bindings are
 * optional infrastructure: when one is absent (unit tests, plain local tools)
 * or briefly unavailable, the request proceeds rather than failing the room.
 */
async function withinRateLimit(limiter, request) {
  if (typeof limiter?.limit !== "function") return true;
  const key = request.headers.get("CF-Connecting-IP") || "unknown-client";
  try {
    const { success } = await limiter.limit({ key });
    return success !== false;
  } catch (error) {
    console.error("Rate limiter unavailable", error);
    return true;
  }
}

function rateLimitedResponse() {
  return jsonResponse({
    error: "请求过于频繁，请稍后再试。",
    code: "RATE_LIMITED",
    retryable: true,
  }, 429, { "Retry-After": String(RATE_LIMIT_RETRY_AFTER_SECONDS) });
}

function hasAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}

function normalizeName(value) {
  if (typeof value !== "string") return null;
  const name = stripUnsafeNameCharacters(value).replace(/\s+/g, " ").trim();
  return name && [...name].length <= 20 ? name : null;
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw jsonResponse({ error: "请求内容过长。" }, 413);
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          // Do not drain or decode a body after it exceeds the byte budget.
          void reader.cancel().catch(() => {});
          throw jsonResponse({ error: "请求内容过长。" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw jsonResponse({ error: "请求不是有效的 JSON。" }, 400);
  }
}

async function callRoom(stub, request) {
  const response = await stub.fetch(request);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            typeof payload?.error === "string"
              ? payload.error
              : "房间服务暂时不可用。",
          ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
          ...(typeof payload?.retryable === "boolean"
            ? { retryable: payload.retryable }
            : {}),
        },
        response.status,
      ),
    };
  }
  return { ok: true, payload };
}

function sessionBody(identity, token, room) {
  const session = { ...identity, token };
  return {
    roomCode: identity.code,
    token,
    playerId: identity.playerId,
    playerName: identity.playerName,
    name: identity.playerName,
    role: identity.role,
    color: identity.color,
    session,
    room,
  };
}

/**
 * Room creation and joins learn who the caller is after the request checks
 * out: a player becomes a guest if the browser is not one yet (the room then
 * saves finished games for them); a spectator is only looked up. The
 * cookies a new guest needs ride on the response.
 */
function identityStep(env, request) {
  const step = {
    setCookie: [],
    async user({ create }) {
      if (!create) return (await sessionUser(env, request))?.id ?? null;
      const { user, setCookie } = await userOrNewGuest(env, request);
      step.setCookie = setCookie;
      return user?.id ?? null;
    },
  };
  return step;
}

async function createRoom(request, env, caller = identityStep(env, request)) {
  const body = await readJsonBody(request);
  if (!isRecord(body)) return jsonResponse({ error: "无法识别建房请求。" }, 400);
  if (body.v !== BADUK_PROTOCOL_VERSION) {
    return jsonResponse({ error: "客户端协议版本不兼容，请刷新页面。" }, 400);
  }
  const name = normalizeName(body.name);
  if (!name) return jsonResponse({ error: "请填写 1 到 20 个字的名字。" }, 400);
  const hasCredentials = ["roomCode", "playerId", "token"]
    .map((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (hasCredentials.every((present) => !present)) {
    return jsonResponse({
      error: "客户端版本过旧，请刷新页面后重新建房。",
      code: "PROTOCOL_UPGRADE_REQUIRED",
    }, 426);
  }
  if (hasCredentials.some((present) => !present) ||
      !isRoomCode(body.roomCode) ||
      typeof body.playerId !== "string" ||
      typeof body.token !== "string" ||
      !JOIN_PLAYER_ID_PATTERN.test(body.playerId) ||
      !JOIN_TOKEN_PATTERN.test(body.token)) {
    return jsonResponse({ error: "建房凭据无效。", code: "BAD_REQUEST" }, 400);
  }

  const { roomCode, playerId, token } = body;
  const tokenHash = await hashRoomToken(token);
  const userId = await caller.user({ create: true });
  const stub = env.BADUK_ROOMS.getByName(roomCode);
  let result;
  try {
    result = await callRoom(stub, new Request(new URL("/internal/init", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: roomCode,
        name,
        size: body.size,
        width: body.width,
        height: body.height,
        mainTimeSeconds: body.mainTimeSeconds,
        byoYomiPeriods: body.byoYomiPeriods,
        byoYomiSeconds: body.byoYomiSeconds,
        komi: body.komi,
        scoringRule: body.scoringRule,
        topology: body.topology,
        // Absent for Go-only clients, whose rooms stay Go.
        gameType: body.gameType,
        ruleSet: body.ruleSet,
        multiGame: body.multiGame === true,
        // Unlisted rooms are joined by code or link only.
        listed: body.listed !== false,
        playerId,
        tokenHash,
        ...(userId ? { userId } : {}),
        // Online rooms open in reusable setup state until an invitation starts a round.
        startImmediately: false,
      }),
    }));
  } catch (error) {
    console.error("Room creation response failed", error);
    result = {
      ok: false,
      response: jsonResponse({
        error: "建房结果暂时无法确认，请使用原凭据重试。",
        code: "CREATE_COMMIT_UNCERTAIN",
        retryable: true,
      }, 503),
    };
  }
  if (!result.ok && result.response.status === 409) {
    return jsonResponse({ error: "房间码已被使用，请重试建房。", code: "ROOM_CODE_TAKEN" }, 409);
  }
  if (!result.ok && result.response.status >= 500) {
    try {
      const checked = await callRoom(stub, new Request(new URL("/internal/join-status", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, tokenHash }),
      }));
      if (checked.ok && checked.payload?.identity?.playerId === playerId &&
          checked.payload.identity.code === roomCode &&
          checked.payload.identity.role === "player" &&
          checked.payload.identity.color === "black") {
        return jsonResponse(sessionBody(checked.payload.identity, token, checked.payload.room), 201);
      }
    } catch (error) {
      console.error("Unable to reconcile uncertain room creation", error);
    }
  }
  if (!result.ok) {
    return result.response;
  }
  const identity = result.payload.identity ?? {
    code: roomCode, playerId, playerName: name, name, role: "player", color: "black",
  };
  return jsonResponse(sessionBody(identity, token, result.payload.room), 201);
}

async function joinRoom(request, env, roomCode, caller = identityStep(env, request)) {
  const body = await readJsonBody(request);
  if (!isRecord(body)) return jsonResponse({ error: "无法识别加入请求。" }, 400);
  if (body.v !== BADUK_PROTOCOL_VERSION) {
    return jsonResponse({ error: "客户端协议版本不兼容，请刷新页面。" }, 400);
  }
  const name = normalizeName(body.name);
  const role = body.role ?? "player";
  if (!name || !isRoomRole(role)) {
    return jsonResponse({ error: "名字或房间身份不正确。" }, 400);
  }

  // The client keeps these values until it receives the session. A join
  // without retryable credentials could reserve a seat and lose its response,
  // leaving the caller with no way to recover that identity.
  const hasToken = Object.prototype.hasOwnProperty.call(body, "token");
  const hasPlayerId = Object.prototype.hasOwnProperty.call(body, "playerId");
  if (!hasToken && !hasPlayerId) {
    return jsonResponse({
      error: "客户端版本过旧，请刷新页面后重新加入。",
      code: "PROTOCOL_UPGRADE_REQUIRED",
    }, 426);
  }
  if (!hasToken || !hasPlayerId ||
      typeof body.token !== "string" ||
      typeof body.playerId !== "string" ||
      !JOIN_TOKEN_PATTERN.test(body.token) ||
      !JOIN_PLAYER_ID_PATTERN.test(body.playerId)) {
    return jsonResponse({ error: "加入凭据无效。", code: "BAD_REQUEST" }, 400);
  }
  const token = body.token;
  const playerId = body.playerId;
  const tokenHash = await hashRoomToken(token);
  const userId = await caller.user({ create: role === "player" });
  const stub = env.BADUK_ROOMS.getByName(roomCode);
  let result;
  try {
    result = await callRoom(stub, new Request(new URL("/internal/join", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Pages that can draw games other than Go say so; the room turns
      // older pages away from a round of another game.
      body: JSON.stringify({
        name, role, playerId, tokenHash, multiGame: body.multiGame === true,
        ...(userId ? { userId } : {}),
      }),
    }));
  } catch (error) {
    console.error("Room join response failed", error);
    result = {
      ok: false,
      response: jsonResponse({
        error: "加入结果暂时无法确认，请使用原凭据重试。",
        code: "JOIN_COMMIT_UNCERTAIN",
        retryable: true,
      }, 503),
    };
  }
  if (!result.ok && result.response.status >= 500) {
    try {
      const checked = await callRoom(stub, new Request(new URL("/internal/join-status", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, tokenHash }),
      }));
      if (checked.ok && checked.payload?.identity?.playerId === playerId) {
        return jsonResponse(sessionBody(checked.payload.identity, token, checked.payload.room), 201);
      }
    } catch (error) {
      console.error("Unable to reconcile uncertain room join", error);
    }
  }
  if (!result.ok) return result.response;
  return jsonResponse(
    sessionBody(result.payload.identity, token, result.payload.room),
    201,
  );
}

function recordsUnavailable() {
  return jsonResponse({
    error: "棋谱服务暂时不可用，请稍后再试。",
    code: "RECORDS_UNAVAILABLE",
    retryable: true,
  }, 503);
}

function recordErrorResponse(error) {
  if (error instanceof RecordError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }
  console.error("Game record request failed", error);
  return recordsUnavailable();
}

/** "My games": the caller's records, newest first; empty without a session. */
async function listMyRecords(request, env) {
  const url = new URL(request.url);
  const user = await sessionUser(env, request);
  if (!user) return jsonResponse({ records: [], next: null });
  try {
    return jsonResponse(await listRecords(env.DB, user.id, {
      gameType: url.searchParams.get("game"),
      before: url.searchParams.get("before"),
    }));
  } catch (error) {
    return recordErrorResponse(error);
  }
}

/** A game played on one page, uploaded once when it finished. */
async function uploadRecord(request, env) {
  if (!env.DB) return recordsUnavailable();
  let upload;
  try {
    upload = localRecordUpload(await readJsonBody(request, MAX_RECORD_BODY_BYTES));
  } catch (error) {
    if (error instanceof Response) {
      if (error.status !== 413) return error;
      return jsonResponse({ error: "棋谱过长，无法保存。", code: "RECORD_TOO_LARGE" }, 413);
    }
    return recordErrorResponse(error);
  }
  const { user, setCookie } = await userOrNewGuest(env, request);
  if (!user) return recordsUnavailable();
  try {
    const id = await saveRecord(env.DB, upload.row, [{ userId: user.id, color: upload.ownerColor }]);
    return withCookies(jsonResponse({ id }, 201), setCookie);
  } catch (error) {
    return withCookies(recordErrorResponse(error), setCookie);
  }
}

async function recordById(request, env, id) {
  const user = await sessionUser(env, request);
  try {
    if (request.method === "DELETE") {
      if (!user) return jsonResponse({ error: "没有找到这盘棋谱。", code: "RECORD_NOT_FOUND" }, 404);
      const removed = await removeRecord(env.DB, id, user.id);
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "没有找到这盘棋谱。", code: "RECORD_NOT_FOUND" }, 404);
    }
    const found = await readRecord(env.DB, id, user?.id ?? null);
    if (found.status === "missing") {
      return jsonResponse({ error: "没有找到这盘棋谱。", code: "RECORD_NOT_FOUND" }, 404);
    }
    if (found.status === "forbidden") {
      return jsonResponse({ error: "这盘棋只有对局双方能看。", code: "RECORD_FORBIDDEN" }, 403);
    }
    return jsonResponse({ record: found.record });
  } catch (error) {
    return recordErrorResponse(error);
  }
}

async function listLobbyRooms(env) {
  const stub = env.BADUK_ROOM_INDEX.getByName("global");
  const result = await callRoom(
    stub,
    new Request("https://lobby.internal/internal/rooms", { method: "GET" }),
  );
  if (!result.ok) return result.response;
  return jsonResponse({ rooms: result.payload.rooms ?? [] });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/rooms/health") {
        if (request.method !== "GET") {
          return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        return jsonResponse({ ok: true, service: "bamboo-baduk" });
      }

      if (url.pathname === "/api/lobby") {
        if (request.method !== "GET") {
          return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.LOBBY_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        return await listLobbyRooms(env);
      }

      if (url.pathname === "/api/rooms") {
        if (request.method !== "POST") {
          return new Response(null, { status: 405, headers: { Allow: "POST" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.ROOM_CREATE_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        const identity = identityStep(env, request);
        return withCookies(await createRoom(request, env, identity), identity.setCookie);
      }

      const socketMatch = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/(?:socket|ws)$/.exec(url.pathname);
      if (socketMatch) {
        if (request.method !== "GET") {
          return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.ROOM_SOCKET_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        // The room learns whose browser this is (to keep one identity per
        // person); a client cannot claim an account by sending the header.
        const headers = new Headers(request.headers);
        headers.delete(SESSION_USER_HEADER);
        const user = await sessionUser(env, request);
        if (user?.id) headers.set(SESSION_USER_HEADER, user.id);
        return await env.BADUK_ROOMS.getByName(socketMatch[1]).fetch(new Request(request, { headers }));
      }

      const joinMatch = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})(?:\/join)?$/.exec(url.pathname);
      if (joinMatch) {
        if (!isRoomCode(joinMatch[1])) return jsonResponse({ error: "房间码不正确。" }, 400);
        if (request.method !== "POST") {
          return new Response(null, { status: 405, headers: { Allow: "POST" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.ROOM_JOIN_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        const identity = identityStep(env, request);
        return withCookies(await joinRoom(request, env, joinMatch[1], identity), identity.setCookie);
      }

      if (url.pathname.startsWith("/api/rooms/")) {
        return jsonResponse({ error: "房间地址不正确。" }, 404);
      }

      // Sign-in and sessions (Better Auth). Phase 1 has guests only.
      if (url.pathname.startsWith("/api/auth/")) {
        if (!(await withinRateLimit(env.AUTH_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        const auth = authFor(env, request);
        if (!auth) {
          return jsonResponse({ error: "账号服务暂时不可用。", code: "AUTH_UNAVAILABLE" }, 503);
        }
        return await auth.handler(request);
      }

      if (url.pathname === "/api/records") {
        if (request.method !== "GET" && request.method !== "POST") {
          return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.RECORD_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        if (!env.DB) return recordsUnavailable();
        return request.method === "POST"
          ? await uploadRecord(request, env)
          : await listMyRecords(request, env);
      }

      const recordMatch = /^\/api\/records\/([^/]+)$/u.exec(url.pathname);
      if (recordMatch) {
        if (request.method !== "GET" && request.method !== "DELETE") {
          return new Response(null, { status: 405, headers: { Allow: "GET, DELETE" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        if (!(await withinRateLimit(env.RECORD_RATE_LIMITER, request))) {
          return rateLimitedResponse();
        }
        if (!isRecordId(recordMatch[1])) {
          return jsonResponse({ error: "没有找到这盘棋谱。", code: "RECORD_NOT_FOUND" }, 404);
        }
        if (!env.DB) return recordsUnavailable();
        return await recordById(request, env, recordMatch[1]);
      }

      if (env.ASSETS) return await env.ASSETS.fetch(request);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("Bamboo baduk worker request failed", error);
      return jsonResponse({ error: "房间服务暂时开小差了。" }, 500);
    }
  },
};

export default worker;

import { BadukRoom } from "./BadukRoom.js";
import {
  BADUK_PROTOCOL_VERSION,
  isRecord,
  isRoomCode,
  isRoomRole,
} from "../src/multiplayer/protocol.js";
import { hashRoomToken } from "../src/multiplayer/roomEngine.js";

export { BadukRoom };

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_BODY_BYTES = 4 * 1024;
const MAX_ROOM_CODE_ATTEMPTS = 12;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function hasAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}

function normalizeName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && [...name].length <= 20 ? name : null;
}

function createRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw jsonResponse({ error: "请求内容过长。" }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw jsonResponse({ error: "请求内容过长。" }, 413);
  }
  try {
    return JSON.parse(text);
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

async function createRoom(request, env) {
  const body = await readJsonBody(request);
  if (!isRecord(body)) return jsonResponse({ error: "无法识别建房请求。" }, 400);
  if (body.v !== undefined && body.v !== BADUK_PROTOCOL_VERSION) {
    return jsonResponse({ error: "客户端协议版本不兼容，请刷新页面。" }, 400);
  }
  const name = normalizeName(body.name);
  if (!name) return jsonResponse({ error: "请填写 1 到 20 个字的名字。" }, 400);

  const token = createToken();
  const playerId = crypto.randomUUID();
  const tokenHash = await hashRoomToken(token);

  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = createRoomCode();
    const stub = env.BADUK_ROOMS.getByName(roomCode);
    const result = await callRoom(
      stub,
      new Request(new URL("/internal/init", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: roomCode,
          name,
          size: body.size,
          komi: body.komi,
          scoringRule: body.scoringRule,
          playerId,
          tokenHash,
        }),
      }),
    );
    if (!result.ok) {
      if (result.response.status === 409) continue;
      return result.response;
    }
    const identity = {
      code: roomCode,
      playerId,
      playerName: name,
      name,
      role: "player",
      color: "black",
    };
    return jsonResponse(sessionBody(identity, token, result.payload.room), 201);
  }
  return jsonResponse({ error: "暂时无法分配房间码，请重试。" }, 503);
}

async function joinRoom(request, env, roomCode) {
  const body = await readJsonBody(request);
  if (!isRecord(body)) return jsonResponse({ error: "无法识别加入请求。" }, 400);
  if (body.v !== undefined && body.v !== BADUK_PROTOCOL_VERSION) {
    return jsonResponse({ error: "客户端协议版本不兼容，请刷新页面。" }, 400);
  }
  const name = normalizeName(body.name);
  const role = body.role ?? "player";
  if (!name || !isRoomRole(role)) {
    return jsonResponse({ error: "名字或房间身份不正确。" }, 400);
  }

  const token = createToken();
  const playerId = crypto.randomUUID();
  const tokenHash = await hashRoomToken(token);
  const stub = env.BADUK_ROOMS.getByName(roomCode);
  const result = await callRoom(
    stub,
    new Request(new URL("/internal/join", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, playerId, tokenHash }),
    }),
  );
  if (!result.ok) return result.response;
  return jsonResponse(
    sessionBody(result.payload.identity, token, result.payload.room),
    201,
  );
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

      if (url.pathname === "/api/rooms") {
        if (request.method !== "POST") {
          return new Response(null, { status: 405, headers: { Allow: "POST" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        return createRoom(request, env);
      }

      const socketMatch = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/(?:socket|ws)$/.exec(url.pathname);
      if (socketMatch) {
        if (request.method !== "GET") {
          return new Response(null, { status: 405, headers: { Allow: "GET" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        return env.BADUK_ROOMS.getByName(socketMatch[1]).fetch(request);
      }

      const joinMatch = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})(?:\/join)?$/.exec(url.pathname);
      if (joinMatch) {
        if (!isRoomCode(joinMatch[1])) return jsonResponse({ error: "房间码不正确。" }, 400);
        if (request.method !== "POST") {
          return new Response(null, { status: 405, headers: { Allow: "POST" } });
        }
        if (!hasAllowedOrigin(request)) return jsonResponse({ error: "请求来源不允许。" }, 403);
        return joinRoom(request, env, joinMatch[1]);
      }

      if (url.pathname.startsWith("/api/rooms/")) {
        return jsonResponse({ error: "房间地址不正确。" }, 404);
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("Bamboo baduk worker request failed", error);
      return jsonResponse({ error: "房间服务暂时开小差了。" }, 500);
    }
  },
};

export default worker;

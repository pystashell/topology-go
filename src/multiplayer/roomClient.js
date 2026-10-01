import { trimStoredChatHistories } from "./chat.js";
import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
  isRoomCode,
} from "./protocol.js";

const DEFAULT_ROOM_PATH = "/api/rooms";
const DEFAULT_PROTOCOL = BADUK_WS_PROTOCOL;
const DEFAULT_STORAGE_PREFIX = "bamboo-baduk.session.";
const PENDING_JOIN_STORAGE_PREFIX = "bamboo-baduk.pending-join.";
const PENDING_CREATE_STORAGE_PREFIX = "bamboo-baduk.pending-create.";
const ACTIVE_CREATE_STORAGE_PREFIX = "bamboo-baduk.active-create.";
const SESSION_V3_PREFIX = "bamboo-baduk.session-v3.";
const PENDING_JOIN_V3_PREFIX = "bamboo-baduk.pending-join-v3.";
const PENDING_CREATE_V3_PREFIX = "bamboo-baduk.pending-create-v3.";
const ACTIVE_SESSION_PREFIX = "bamboo-baduk.active-session-v3.";
const ACTIVE_JOIN_PREFIX = "bamboo-baduk.active-join-v3.";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CREATE_CODE_ATTEMPTS = 12;
// These actions must remain bound to the exact round and position the player saw.
const POSITION_BOUND_ACTIONS = new Set([
  "play", "pass", "resign", "toggle_dead", "resume_play", "request_undo",
  "set_ai_autoplay_paused",
]);

export const CONNECTION_STATUS = Object.freeze({
  IDLE: "idle",
  CREATING: "creating",
  JOINING: "joining",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  DISCONNECTED: "disconnected",
  CLOSED: "closed",
});

export class RoomClientError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RoomClientError";
    this.code = options.code ?? "ROOM_CLIENT_ERROR";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

/** Normalize a human-entered room code without silently accepting punctuation. */
export function normalizeRoomCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(normalized) ? normalized : "";
}

/** Keep player names readable and within the server/UI limit. */
export function normalizePlayerName(value, maxLength = 20) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, maxLength);
}

function safeUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

/**
 * Parse canonical `/online/ABC123` links as well as the legacy query, hash,
 * `/room/ABC123`, and `/join/ABC123` forms. A plain room code is accepted too.
 */
export function parseShareUrl(value, baseUrl = "http://localhost/") {
  const plainCode = normalizeRoomCode(value);
  if (plainCode) {
    return { roomCode: plainCode, name: "", role: "" };
  }

  const url = safeUrl(String(value ?? ""), baseUrl);
  if (!url) return { roomCode: "", name: "", role: "" };

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const pathMatch = url.pathname.match(/\/(?:online|rooms?|join)\/([^/]+)\/?$/iu);
  const roomCode = normalizeRoomCode(
    url.searchParams.get("room") ??
      url.searchParams.get("code") ??
      hashParams.get("room") ??
      hashParams.get("code") ??
      pathMatch?.[1] ??
      "",
  );

  return {
    roomCode,
    name: normalizePlayerName(
      url.searchParams.get("name") ?? hashParams.get("name") ?? "",
    ),
    role: String(
      url.searchParams.get("role") ?? hashParams.get("role") ?? "",
    ).toLowerCase(),
  };
}

/**
 * Resolve the four top-level app routes without performing any navigation.
 * Unknown routes deliberately fall back to the standalone app so a typo can
 * never make the hidden lobby a dependency of ordinary play.
 */
export function parseAppRoute(value, baseUrl = "http://localhost/") {
  const url = safeUrl(String(value ?? ""), baseUrl);
  if (!url) return { mode: "single", roomCode: "", role: "" };

  const pathname = url.pathname.replace(/\/+$/u, "") || "/";
  if (pathname === "/") return { mode: "root", roomCode: "", role: "" };
  if (pathname.toLowerCase() === "/lobby") {
    return { mode: "lobby", roomCode: "", role: "" };
  }
  if (pathname.toLowerCase() === "/single") {
    return { mode: "single", roomCode: "", role: "" };
  }

  const onlineMatch = pathname.match(/^\/online\/([^/]+)$/iu);
  const roomCode = normalizeRoomCode(onlineMatch?.[1] ?? "");
  if (roomCode) {
    const role = String(url.searchParams.get("role") ?? "").toLowerCase();
    return {
      mode: "online",
      roomCode,
      // A bare room link is a safe public watching link. Only a link emitted
      // by the lobby's Join action may claim an open player seat.
      role: role === "player" ? "player" : "spectator",
    };
  }

  return { mode: "single", roomCode: "", role: "" };
}

export function buildShareUrl(roomCode, baseUrl = "http://localhost/") {
  const code = normalizeRoomCode(roomCode);
  if (!code) {
    throw new RoomClientError("房间号格式不正确。", {
      code: "INVALID_ROOM_CODE",
    });
  }

  const url = safeUrl(baseUrl, "http://localhost/");
  if (!url) {
    throw new RoomClientError("无法生成分享链接。", {
      code: "INVALID_BASE_URL",
    });
  }
  url.pathname = `/online/${encodeURIComponent(code)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value) {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Encode arbitrary token text as a valid RFC 6455 subprotocol token. */
export function encodeTokenProtocol(token) {
  const value = String(token ?? "");
  if (!value) {
    throw new RoomClientError("缺少房间凭证。", { code: "MISSING_TOKEN" });
  }
  const encoded = bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
  return `token.${encoded}`;
}

export function decodeTokenProtocol(protocol) {
  const encoded = String(protocol ?? "").replace(/^token\./u, "");
  if (!encoded) return "";
  const base64 = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    return new TextDecoder().decode(base64ToBytes(padded));
  } catch {
    return "";
  }
}

export function roomTokenStorageKey(roomCode, prefix = DEFAULT_STORAGE_PREFIX) {
  const code = normalizeRoomCode(roomCode);
  return code ? `${prefix}${code}` : "";
}

/** A tiny injectable adapter around localStorage, useful in browser and tests. */
export function createTokenStore(storage, options = {}) {
  const prefix = options.prefix ?? DEFAULT_STORAGE_PREFIX;

  return Object.freeze({
    get(roomCode) {
      const key = roomTokenStorageKey(roomCode, prefix);
      if (!key || !storage?.getItem) return null;
      try {
        const saved = storage.getItem(key);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        return typeof parsed === "string" ? { code: roomCode, token: parsed } : parsed;
      } catch {
        return null;
      }
    },

    set(roomCode, session) {
      const key = roomTokenStorageKey(roomCode, prefix);
      if (!key || !storage?.setItem || !session) return false;
      try {
        const value =
          typeof session === "string"
            ? { code: normalizeRoomCode(roomCode), token: session }
            : session;
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },

    remove(roomCode) {
      const key = roomTokenStorageKey(roomCode, prefix);
      if (!key || !storage?.removeItem) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },

    entries() {
      const entries = [];
      try {
        if (typeof storage?.key !== "function") return entries;
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key?.startsWith(prefix)) continue;
          const code = key.slice(prefix.length);
          entries.push({ code, value: this.get(code) });
        }
      } catch {
        // A blocked storage API is treated as unavailable, like get/set.
      }
      return entries;
    },
  });
}

/** Credentials are stored under the room and identity, never under the room alone. */
function createIdentityStore(storage, prefix) {
  const keyFor = (code, playerId) =>
    isRoomCode(code) && typeof playerId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(playerId)
      ? `${prefix}${code}.${playerId}` : "";
  const get = (code, playerId) => {
    const key = keyFor(code, playerId);
    if (!key || !storage?.getItem) return null;
    try {
      const value = storage.getItem(key);
      const record = value ? JSON.parse(value) : null;
      return record?.playerId === playerId &&
        (record.code === code || record.roomCode === code) ? record : null;
    } catch {
      return null;
    }
  };
  return Object.freeze({
    get,
    set(code, record) {
      const key = keyFor(code, record?.playerId);
      if (!key || !storage?.setItem) return false;
      try {
        storage.setItem(key, JSON.stringify(record));
        return JSON.stringify(get(code, record.playerId)) === JSON.stringify(record);
      } catch {
        return false;
      }
    },
    remove(code, playerId, token) {
      const key = keyFor(code, playerId);
      if (!key || !storage?.removeItem) return false;
      const record = get(code, playerId);
      if (!record || (token && record.token !== token)) return false;
      try {
        storage.removeItem(key);
        return get(code, playerId) === null;
      } catch {
        return false;
      }
    },
    entries(code = "") {
      const found = [];
      try {
        if (typeof storage?.key !== "function") return found;
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key?.startsWith(prefix)) continue;
          const suffix = key.slice(prefix.length);
          const dot = suffix.indexOf(".");
          const roomCode = suffix.slice(0, dot);
          const playerId = suffix.slice(dot + 1);
          if (dot < 0 || (code && roomCode !== code)) continue;
          const value = get(roomCode, playerId);
          if (value) found.push({ code: roomCode, playerId, value });
        }
      } catch {
        return found;
      }
      return found;
    },
  });
}

function ephemeralTabStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
}

function browserStorage(name) {
  try { return globalThis[name]; } catch { return null; }
}

function usableTabStorage(candidate) {
  const probe = "bamboo-baduk.tab-storage-probe";
  try {
    if (!candidate?.setItem || !candidate?.getItem || !candidate?.removeItem) return false;
    candidate.setItem(probe, "ok");
    const usable = candidate.getItem(probe) === "ok";
    candidate.removeItem(probe);
    return usable;
  } catch {
    return false;
  }
}

export function buildSocketUrl(
  roomCode,
  baseUrl = "http://localhost/",
  socketPath = (code) => `${DEFAULT_ROOM_PATH}/${encodeURIComponent(code)}/socket`,
) {
  const code = normalizeRoomCode(roomCode);
  if (!code) {
    throw new RoomClientError("房间号格式不正确。", {
      code: "INVALID_ROOM_CODE",
    });
  }
  const base = safeUrl(baseUrl, "http://localhost/");
  if (!base) {
    throw new RoomClientError("联机服务地址不正确。", {
      code: "INVALID_BASE_URL",
    });
  }
  const url = new URL(socketPath(code), base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function buildCommandEnvelope(id, sequence, action, payload = {}) {
  const normalizedAction = String(action ?? "").trim();
  if (!normalizedAction) {
    throw new RoomClientError("联机命令缺少动作。", {
      code: "INVALID_ACTION",
    });
  }
  return {
    v: BADUK_PROTOCOL_VERSION,
    type: "command",
    id: String(id),
    sequence,
    action: normalizedAction,
    payload: payload ?? {},
  };
}

function responseSession(response, codeHint, nameHint) {
  const source = response?.session ?? response ?? {};
  const code = normalizeRoomCode(
    source.code ?? response?.roomCode ?? response?.room?.code ?? codeHint,
  );
  const token = String(source.token ?? response?.token ?? "");
  if (!code || !token) {
    throw new RoomClientError("服务器没有返回有效的房间凭证。", {
      code: "INVALID_SESSION_RESPONSE",
      details: response,
    });
  }

  return {
    ...source,
    code,
    token,
    playerName: normalizePlayerName(
      source.playerName ?? source.name ?? response?.playerName ?? nameHint,
    ),
    nextSequence: Math.max(1, Number(source.nextSequence) || 1),
  };
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function newJoinCredential(name, role) {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new RoomClientError("当前环境无法安全生成房间凭证。", {
      code: "CRYPTO_UNAVAILABLE",
    });
  }
  const idBytes = crypto.getRandomValues(new Uint8Array(16));
  idBytes[6] = (idBytes[6] & 0x0f) | 0x40;
  idBytes[8] = (idBytes[8] & 0x3f) | 0x80;
  const idHex = Array.from(idBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    name,
    role,
    playerId: `${idHex.slice(0, 8)}-${idHex.slice(8, 12)}-${idHex.slice(12, 16)}-${idHex.slice(16, 20)}-${idHex.slice(20)}`,
    token: Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

function isPendingJoin(value) {
  return typeof value?.playerId === "string" &&
    typeof value?.token === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.playerId) &&
    /^[0-9a-f]{64}$/u.test(value.token);
}

function randomRoomCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

function newCreateCredential(request, roomCodeFactory) {
  const credentials = newJoinCredential(request.name, "player");
  const roomCode = roomCodeFactory();
  if (!isRoomCode(roomCode)) {
    throw new RoomClientError("无法生成有效的房间号。", { code: "INVALID_ROOM_CODE" });
  }
  return {
    roomCode,
    playerId: credentials.playerId,
    token: credentials.token,
    createdAt: Date.now(),
    request: {
      ...request,
      roomCode,
      playerId: credentials.playerId,
      token: credentials.token,
    },
  };
}

function isPendingCreate(value) {
  return isRoomCode(value?.roomCode) && isPendingJoin(value) &&
    value.request?.roomCode === value.roomCode &&
    value.request?.playerId === value.playerId &&
    value.request?.token === value.token &&
    typeof value.request?.name === "string" && value.request.name.length > 0;
}

function mergeLegacyPending(legacy, current) {
  if (!current) return legacy;
  if (current.token !== legacy.token) return null;
  const older = legacy.confirmedSession;
  const newer = current.confirmedSession;
  const confirmedSession = older?.token === legacy.token && newer?.token === legacy.token
    ? { ...older, ...newer, nextSequence: Math.max(
      Number(older.nextSequence) || 1, Number(newer.nextSequence) || 1,
    ) }
    : newer?.token === legacy.token ? newer : older?.token === legacy.token ? older : undefined;
  return { ...legacy, ...current, confirmedSession };
}

function publicIdentity(session) {
  if (!session) return null;
  const { token: _token, nextSequence: _nextSequence, ...identity } = session;
  return identity;
}

function attachSocketListener(socket, type, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, handler);
  } else {
    socket[`on${type}`] = handler;
  }
}

export class RoomClient {
  constructor(options = {}) {
    const location = options.location ?? globalThis.location;
    this.baseUrl = options.baseUrl ?? location?.origin ?? "http://localhost/";
    this.locationHref =
      options.locationHref ?? location?.href ?? `${this.baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    const persistentStorage = options.storage ?? browserStorage("localStorage");
    const candidateTabStorage = options.attemptStorage ?? browserStorage("sessionStorage");
    const tabStorage = usableTabStorage(candidateTabStorage)
      ? candidateTabStorage : ephemeralTabStorage();
    this.sessionStore = createIdentityStore(persistentStorage, SESSION_V3_PREFIX);
    this.pendingJoinIdentityStore = createIdentityStore(persistentStorage, PENDING_JOIN_V3_PREFIX);
    this.pendingCreateIdentityStore = createIdentityStore(persistentStorage, PENDING_CREATE_V3_PREFIX);
    this.activeSessionStore = createTokenStore(tabStorage, { prefix: ACTIVE_SESSION_PREFIX });
    this.activeJoinStore = createTokenStore(tabStorage, { prefix: ACTIVE_JOIN_PREFIX });
    // The room-only stores are read solely to migrate credentials saved by older builds.
    this.tokenStore =
      options.tokenStore ?? createTokenStore(persistentStorage);
    this.pendingJoinStore = options.pendingJoinStore ?? createTokenStore(
      persistentStorage,
      { prefix: PENDING_JOIN_STORAGE_PREFIX },
    );
    this.pendingCreateStore = options.pendingCreateStore ?? createTokenStore(
      persistentStorage,
      { prefix: PENDING_CREATE_STORAGE_PREFIX },
    );
    this.activeCreateStore = options.activeCreateStore ?? createTokenStore(
      tabStorage,
      { prefix: ACTIVE_CREATE_STORAGE_PREFIX },
    );
    this.createRoomPath = options.createRoomPath ?? DEFAULT_ROOM_PATH;
    this.joinRoomPath =
      options.joinRoomPath ??
      ((code) => `${DEFAULT_ROOM_PATH}/${encodeURIComponent(code)}`);
    this.socketPath =
      options.socketPath ??
      ((code) => `${DEFAULT_ROOM_PATH}/${encodeURIComponent(code)}/socket`);
    this.protocolName = options.protocolName ?? DEFAULT_PROTOCOL;
    this.roomCodeFactory = options.roomCodeFactory ?? randomRoomCode;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? globalThis.clearTimeout.bind(globalThis);
    this.random = options.random ?? Math.random;

    this.reconnectOptions = {
      initialDelayMs: options.reconnect?.initialDelayMs ?? 500,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 10_000,
      factor: options.reconnect?.factor ?? 2,
      jitter: options.reconnect?.jitter ?? 0.2,
      maxAttempts: options.reconnect?.maxAttempts ?? 10,
    };
    this.commandAckTimeoutMs = options.commandAckTimeoutMs ?? 12_000;
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 10_000;
    this.sendAuthMessage = options.sendAuthMessage ?? false;

    this.roomCode = "";
    this.session = null;
    this.identity = null;
    this.room = null;
    this.presence = null;
    this.connectionStatus = CONNECTION_STATUS.IDLE;
    this.lastCloseCode = null;
    this.lastCredentialCleanupFailed = false;
    this.lastCloseReason = "";

    this._listeners = new Map();
    this._socket = null;
    this._socketGeneration = 0;
    this._manualClose = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._snapshotTimer = null;
    this._pendingCommands = new Map();
    this._nextSequence = 1;
    this._awaitingSnapshot = false;
  }

  get isConnected() {
    return this.connectionStatus === CONNECTION_STATUS.CONNECTED;
  }

  get code() {
    return this.roomCode;
  }

  get status() {
    return this.connectionStatus;
  }

  get pendingCreateCode() {
    return this._pendingCreate()?.roomCode ?? "";
  }

  _migrateLegacy(code) {
    const session = this.tokenStore.get(code);
    if (session?.code === code && session?.playerId && session?.token) {
      const existing = this.sessionStore.get(code, session.playerId);
      if (!existing || existing.token === session.token) {
        const merged = { ...session, ...existing, nextSequence: Math.max(
          Number(session.nextSequence) || 1, Number(existing?.nextSequence) || 1,
        ) };
        if (this.sessionStore.set(code, merged)) this.tokenStore.remove(code);
      }
    }
    const join = this.pendingJoinStore.get(code);
    if (isPendingJoin(join)) {
      const existing = this.pendingJoinIdentityStore.get(code, join.playerId);
      const merged = mergeLegacyPending({ ...join, code }, existing);
      if (merged && this.pendingJoinIdentityStore.set(code, merged)) this.pendingJoinStore.remove(code);
    }
    const create = this.pendingCreateStore.get(code);
    if (isPendingCreate(create)) {
      const existing = this.pendingCreateIdentityStore.get(code, create.playerId);
      const merged = mergeLegacyPending(create, existing);
      if (merged && this.pendingCreateIdentityStore.set(code, merged)) {
        const active = this.activeCreateStore.get("CURRENT");
        if (active?.roomCode === code && !active.playerId) {
          this.activeCreateStore.set("CURRENT", {
            roomCode: code, playerId: create.playerId, token: create.token,
          });
        }
        this.pendingCreateStore.remove(code);
      }
    }
  }

  _activeSession(code) {
    const pointer = this.activeSessionStore.get(code);
    const saved = pointer?.playerId && this.sessionStore.get(code, pointer.playerId);
    return saved?.token === pointer?.token ? saved : null;
  }

  listStoredSessions(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return [];
    this._migrateLegacy(code);
    const byId = new Map();
    for (const { value } of this.sessionStore.entries(code)) {
      if (value?.token && value?.playerId) byId.set(value.playerId, value);
    }
    for (const store of [this.pendingJoinIdentityStore, this.pendingCreateIdentityStore]) {
      for (const { value } of store.entries(code)) {
        const saved = value?.confirmedSession;
        if (saved?.code === code && saved?.token === value.token &&
            saved?.playerId === value.playerId) byId.set(saved.playerId, saved);
      }
    }
    return [...byId.values()].map(({ playerId, playerName, role, color }) => ({
      code, playerId, playerName, role, color,
    }));
  }

  listPendingJoins(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return [];
    this._migrateLegacy(code);
    return this.pendingJoinIdentityStore.entries(code)
      .filter(({ value }) => isPendingJoin(value) && !value.confirmedSession)
      .map(({ value }) => ({ playerId: value.playerId, name: value.name, role: value.role }));
  }

  hasStoredSession(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return false;
    return this.listStoredSessions(code).length > 0;
  }

  hasPendingCreate(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return false;
    this._migrateLegacy(code);
    return this.pendingCreateIdentityStore.entries(code)
      .some(({ value }) => isPendingCreate(value));
  }

  listPendingCreates() {
    for (const { code } of this.pendingCreateStore.entries?.() ?? []) this._migrateLegacy(code);
    return this.pendingCreateIdentityStore.entries()
      .map(({ value }) => value)
      .filter(isPendingCreate)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((pending) => ({
        roomCode: pending.roomCode,
        playerId: pending.playerId,
        name: pending.request.name,
        width: pending.request.width ?? pending.request.size ?? 19,
        height: pending.request.height ?? pending.request.size ?? 19,
        confirmed: Boolean(pending.confirmedSession),
      }));
  }

  abandonPendingCreate(roomCode, playerId = "") {
    const code = normalizeRoomCode(roomCode);
    const pending = playerId
      ? this.pendingCreateIdentityStore.get(code, playerId)
      : this._pendingCreate()?.roomCode === code ? this._pendingCreate() : null;
    return isPendingCreate(pending) && this._clearPendingCreate(pending);
  }

  on(type, listener) {
    if (typeof listener !== "function") return () => {};
    const listeners = this._listeners.get(type) ?? new Set();
    listeners.add(listener);
    this._listeners.set(type, listeners);
    return () => this.off(type, listener);
  }

  once(type, listener) {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off(type, listener) {
    const listeners = this._listeners.get(type);
    if (!listeners) return;
    listeners.delete(listener);
    if (!listeners.size) this._listeners.delete(type);
  }

  _emit(type, payload) {
    for (const listener of this._listeners.get(type) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  _setStatus(status, details = {}) {
    this.connectionStatus = status;
    const event = { status, roomCode: this.roomCode, ...details };
    this._emit("connection", event);
    this._emit("status", event);
  }

  _emitError(error) {
    const normalized =
      error instanceof RoomClientError
        ? error
        : new RoomClientError(error?.message ?? "联机时发生未知错误。", {
            cause: error,
          });
    this._emit("error", normalized);
    return normalized;
  }

  _resolveUrl(path) {
    return new URL(path, this.baseUrl).toString();
  }

  async _post(path, body) {
    if (!this.fetchImpl) {
      throw new RoomClientError("当前环境不支持网络请求。", {
        code: "FETCH_UNAVAILABLE",
      });
    }

    let response;
    try {
      response = await this.fetchImpl(this._resolveUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new RoomClientError("无法连接联机服务。", {
        code: "NETWORK_ERROR",
        retryable: true,
        cause,
      });
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Preserve the HTTP status even when a proxy returns an empty/non-JSON body.
    }

    if (!response.ok) {
      throw new RoomClientError(
        data?.message ?? data?.error ?? `联机服务返回 ${response.status}。`,
        {
        code: data?.code ?? "HTTP_ERROR",
        status: response.status,
        retryable: response.status >= 500,
        details: data,
        },
      );
    }
    return data ?? {};
  }

  _pendingCreate() {
    const pointer = this.activeCreateStore.get("CURRENT");
    const code = pointer?.roomCode;
    if (isRoomCode(code)) this._migrateLegacy(code);
    const updated = this.activeCreateStore.get("CURRENT");
    const pending = isRoomCode(updated?.roomCode) && updated?.playerId
      ? this.pendingCreateIdentityStore.get(updated.roomCode, updated.playerId) : null;
    return isPendingCreate(pending) && pending.token === updated.token ? pending : null;
  }

  _savePendingCreate(pending) {
    const saved = this.pendingCreateIdentityStore.set(pending.roomCode, pending);
    const pointer = { roomCode: pending.roomCode, playerId: pending.playerId, token: pending.token };
    const marked = saved && this.activeCreateStore.set("CURRENT", pointer) &&
      this.activeCreateStore.get("CURRENT")?.playerId === pending.playerId;
    if (!marked) {
      throw new RoomClientError("无法保存建房凭据，请检查浏览器存储设置后重试。", {
        code: "CREATE_CREDENTIAL_STORAGE_UNAVAILABLE",
      });
    }
    return pending;
  }

  _clearPendingCreate(pending) {
    const { roomCode: code, playerId, token } = pending;
    if (!this.pendingCreateIdentityStore.remove(code, playerId, token)) return false;
    if (this.activeCreateStore.get("CURRENT")?.playerId === playerId) {
      this.activeCreateStore.remove("CURRENT");
    }
    return true;
  }

  async retryPendingCreate(roomCode, playerId = "") {
    const code = normalizeRoomCode(roomCode);
    const candidates = this.listPendingCreates().filter((item) => item.roomCode === code);
    const selected = playerId || (candidates.length === 1 ? candidates[0].playerId : "");
    const pending = selected ? this.pendingCreateIdentityStore.get(code, selected) : null;
    if (!isPendingCreate(pending)) {
      throw new RoomClientError("没有可重试的建房请求。", { code: "MISSING_PENDING_CREATE" });
    }
    const saved = this.activeCreateStore.set("CURRENT", {
      roomCode: code, playerId: pending.playerId, token: pending.token,
    }) && this.activeCreateStore.get("CURRENT")?.playerId === pending.playerId;
    if (!saved) {
      throw new RoomClientError("无法保存建房凭据，请检查浏览器存储设置后重试。", {
        code: "CREATE_CREDENTIAL_STORAGE_UNAVAILABLE",
      });
    }
    return this.createRoom({ name: pending.request.name });
  }

  async createRoom(options = {}) {
    const config = typeof options === "string" ? { name: options } : options;
    const { options: gameOptions = {}, ...requestConfig } = config;
    const name = normalizePlayerName(config.name);
    if (!name) {
      throw new RoomClientError("请输入你的名字。", { code: "INVALID_NAME" });
    }

    this._setStatus(CONNECTION_STATUS.CREATING);
    try {
      const currentRequest = {
        v: BADUK_PROTOCOL_VERSION,
        ...gameOptions,
        ...requestConfig,
        name,
      };
      let pending = this._pendingCreate();
      const resumedPending = Boolean(pending);
      const requested = pending
        ? Object.fromEntries(Object.entries(pending.request).filter(
            ([key]) => !["roomCode", "playerId", "token"].includes(key),
          ))
        : currentRequest;
      for (let attempt = 0; attempt < MAX_CREATE_CODE_ATTEMPTS; attempt += 1) {
        if (!pending) {
          const candidate = newCreateCredential(requested, this.roomCodeFactory);
          pending = this._savePendingCreate(candidate);
        }
        let response;
        try {
          response = await this._post(this.createRoomPath, pending.request);
        } catch (error) {
          if (error instanceof RoomClientError && error.code === "ROOM_CODE_TAKEN") {
            if (!this._clearPendingCreate(pending)) {
              throw new RoomClientError("无法移除已冲突的建房凭据，请检查浏览器存储设置。", {
                code: "CREATE_CREDENTIAL_STORAGE_UNAVAILABLE",
              });
            }
            pending = null;
            continue;
          }
          throw error;
        }
        const session = responseSession(response, pending.roomCode, pending.request.name);
        if (session.code !== pending.roomCode ||
            session.playerId !== pending.playerId || session.token !== pending.token) {
          throw new RoomClientError("服务器返回的建房身份与请求不一致。", {
            code: "INVALID_SESSION_RESPONSE",
          });
        }
        const sessionStored = this._adoptSession(session, response.room);
        if (sessionStored) {
          this._clearPendingCreate(pending);
        } else {
          // The pre-request record remains sufficient to replay this exact
          // create even if a later session-key write fails.
          this.pendingCreateIdentityStore.set(pending.roomCode, {
            ...pending, confirmedSession: session,
          });
        }
        const recoverable = sessionStored ||
          isPendingCreate(this.pendingCreateIdentityStore.get(pending.roomCode, pending.playerId));
        this.connect();
        return {
          ...response,
          roomCode: session.code,
          session: { ...session },
          resumedPending,
          recoverable,
          shareUrl: this.getShareUrl(),
        };
      }
      throw new RoomClientError("暂时无法分配房间码，请重试。", {
        code: "ROOM_CODE_ALLOCATION_FAILED",
        retryable: true,
      });
    } catch (error) {
      this._setStatus(CONNECTION_STATUS.DISCONNECTED);
      throw this._emitError(error);
    }
  }

  async joinRoom(roomCode, options = {}) {
    let requestedCode = roomCode;
    let config = options;
    if (roomCode && typeof roomCode === "object") {
      config = roomCode;
      requestedCode = roomCode.roomCode ?? roomCode.code;
    }

    const code = normalizeRoomCode(requestedCode);
    const name = normalizePlayerName(config.name);
    if (!isRoomCode(code)) {
      throw new RoomClientError("房间号格式不正确。", {
        code: "INVALID_ROOM_CODE",
      });
    }
    if (!name) {
      throw new RoomClientError("请输入你的名字。", { code: "INVALID_NAME" });
    }

    this._setStatus(CONNECTION_STATUS.JOINING, { roomCode: code });
    try {
      const role = config.role === "spectator" ? "spectator" : "player";
      this._migrateLegacy(code);
      let pending = config.pendingPlayerId
        ? this.pendingJoinIdentityStore.get(code, config.pendingPlayerId) : null;
      if (config.pendingPlayerId && !isPendingJoin(pending)) {
        throw new RoomClientError("没有可恢复的加入请求。", { code: "MISSING_PENDING_JOIN" });
      }
      if (!isPendingJoin(pending)) {
        pending = newJoinCredential(name, role);
        // Never reserve a seat unless its recovery credentials survive a
        // refresh. A failed localStorage write makes an uncertain HTTP result
        // impossible to recover after this page closes.
        const saved = this.pendingJoinIdentityStore.set(code, { ...pending, code });
        const marked = saved && this.activeJoinStore.set(code, {
          playerId: pending.playerId, token: pending.token,
        }) && this.activeJoinStore.get(code)?.playerId === pending.playerId;
        if (!marked) {
          this.pendingJoinIdentityStore.remove(code, pending.playerId, pending.token);
          throw new RoomClientError("无法保存加入凭据，请检查浏览器存储设置后重试。", {
            code: "JOIN_CREDENTIAL_STORAGE_UNAVAILABLE",
          });
        }
      } else if (config.pendingPlayerId) {
        const marked = this.activeJoinStore.set(code, {
          playerId: pending.playerId, token: pending.token,
        }) && this.activeJoinStore.get(code)?.playerId === pending.playerId;
        if (!marked) {
          throw new RoomClientError("无法保存加入凭据，请检查浏览器存储设置后重试。", {
            code: "JOIN_CREDENTIAL_STORAGE_UNAVAILABLE",
          });
        }
      }
      // The credential, rather than the entered name or role, identifies an
      // uncertain join. A retry may change those fields; an already committed
      // join still recovers its original identity from the room.
      const response = await this._post(this.joinRoomPath(code), {
        v: BADUK_PROTOCOL_VERSION,
        name,
        role,
        playerId: pending.playerId,
        token: pending.token,
      });
      const session = responseSession(response, code, name);
      if (session.code !== code || session.playerId !== pending.playerId ||
          session.token !== pending.token) {
        throw new RoomClientError("服务器返回的加入身份与请求不一致。", {
          code: "INVALID_SESSION_RESPONSE",
        });
      }
      if (!this._adoptSession(session, response.room)) {
        // The seat may already be committed. Keep the persisted join credential
        // so the same identity can be retried after session storage recovers.
        this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.DISCONNECTED });
        throw new RoomClientError("无法保存房间会话，请检查浏览器存储设置后重试。", {
          code: "SESSION_STORAGE_UNAVAILABLE",
        });
      }
      this.pendingJoinIdentityStore.remove(code, pending.playerId, pending.token);
      if (this.activeJoinStore.get(code)?.playerId === pending.playerId) {
        this.activeJoinStore.remove(code);
      }
      this.connect();
      return {
        ...response,
        roomCode: session.code,
        session: { ...session },
        shareUrl: this.getShareUrl(),
      };
    } catch (error) {
      this._setStatus(CONNECTION_STATUS.DISCONNECTED, { roomCode: code });
      throw this._emitError(error);
    }
  }

  resumeRoom(roomCode, playerId = "") {
    const code = normalizeRoomCode(roomCode);
    if (!code) return false;
    this._migrateLegacy(code);
    const selectedId = playerId || this.activeSessionStore.get(code)?.playerId;
    const selected = this.listStoredSessions(code).find((entry) => entry.playerId === selectedId);
    if (!selected) return false;
    const saved = this.sessionStore.get(code, selectedId) ??
      this.pendingJoinIdentityStore.get(code, selectedId)?.confirmedSession ??
      this.pendingCreateIdentityStore.get(code, selectedId)?.confirmedSession;
    if (!saved?.token) return false;
    if (!playerId && this.activeSessionStore.get(code)?.token !== saved.token) return false;
    const session = responseSession({ session: saved }, code, saved.playerName);
    const sessionStored = this._adoptSession(session);
    if (sessionStored) {
      const pendingJoin = this.pendingJoinIdentityStore.get(code, selectedId);
      const pendingCreate = this.pendingCreateIdentityStore.get(code, selectedId);
      if (pendingJoin?.confirmedSession) this.pendingJoinIdentityStore.remove(code, selectedId, session.token);
      if (pendingCreate?.confirmedSession) this._clearPendingCreate(pendingCreate);
    }
    this.connect();
    return true;
  }

  _sequenceFloor(session) {
    const code = session.code;
    const playerId = session.playerId;
    const values = [Number(session.nextSequence) || 1];
    const stored = this.sessionStore.get(code, playerId);
    if (stored?.token === session.token) values.push(Number(stored.nextSequence) || 1);
    for (const store of [this.pendingJoinIdentityStore, this.pendingCreateIdentityStore]) {
      const fallback = store.get(code, playerId)?.confirmedSession;
      if (fallback?.token === session.token) values.push(Number(fallback.nextSequence) || 1);
    }
    return Math.max(1, ...values);
  }

  _adoptSession(session, room = null) {
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.IDLE });
    this.lastCredentialCleanupFailed = false;
    this.session = { ...session, nextSequence: this._sequenceFloor(session) };
    this.identity = publicIdentity(this.session);
    this.roomCode = session.code;
    this.room = room ?? null;
    this._nextSequence = this.session.nextSequence;
    this._manualClose = false;
    const stored = this.sessionStore.set(this.roomCode, this.session) &&
      this.sessionStore.get(this.roomCode, this.session.playerId);
    const marked = stored?.token === session.token &&
      this.activeSessionStore.set(this.roomCode, {
        playerId: session.playerId, token: session.token,
      }) && this.activeSessionStore.get(this.roomCode)?.playerId === session.playerId;
    if (room) {
      this._emit("state", {
        room,
        self: this.identity,
        serverTime: null,
        initial: true,
        raw: { type: "state", room },
      });
    }
    return Boolean(marked);
  }

  connect() {
    if (!this.session?.token || !this.roomCode) {
      throw new RoomClientError("没有可恢复的房间会话。", {
        code: "MISSING_SESSION",
      });
    }
    if (!this.WebSocketImpl) {
      throw new RoomClientError("当前环境不支持 WebSocket。", {
        code: "WEBSOCKET_UNAVAILABLE",
      });
    }
    if (this.isConnected || this.connectionStatus === CONNECTION_STATUS.CONNECTING) {
      return this._socket;
    }

    this._manualClose = false;
    this._clearReconnectTimer();
    return this._openSocket(false);
  }

  _openSocket(isReconnect) {
    const generation = ++this._socketGeneration;
    this._clearSnapshotTimer();
    this._awaitingSnapshot = true;
    this._setStatus(
      isReconnect ? CONNECTION_STATUS.RECONNECTING : CONNECTION_STATUS.CONNECTING,
      { attempt: this._reconnectAttempt },
    );

    let socket;
    try {
      const socketUrl = buildSocketUrl(this.roomCode, this.baseUrl, this.socketPath);
      socket = new this.WebSocketImpl(socketUrl, [
        this.protocolName,
        encodeTokenProtocol(this.session.token),
      ]);
    } catch (cause) {
      this._emitError(
        new RoomClientError("无法建立房间连接。", {
          code: "SOCKET_OPEN_ERROR",
          retryable: true,
          cause,
        }),
      );
      this._scheduleReconnect();
      return null;
    }

    this._socket = socket;
    attachSocketListener(socket, "open", () => {
      if (generation !== this._socketGeneration) return;
      this.lastCloseCode = null;
      this.lastCloseReason = "";
      this._setStatus(CONNECTION_STATUS.CONNECTED, {
        protocol: socket.protocol || this.protocolName,
      });
      if (this.sendAuthMessage) {
        socket.send(
          JSON.stringify({
            v: BADUK_PROTOCOL_VERSION,
            type: "join",
            session: this.session,
          }),
        );
      }
      if (this.snapshotTimeoutMs > 0) {
        this._snapshotTimer = this.setTimeoutImpl(() => {
          this._snapshotTimer = null;
          if (generation !== this._socketGeneration || !this._awaitingSnapshot ||
              socket.readyState !== 1) return;
          this._emitError(new RoomClientError("房间同步超时，正在重新连接。", {
            code: "SYNC_TIMEOUT",
            retryable: true,
          }));
          socket.close(4000, "Room sync timeout");
        }, this.snapshotTimeoutMs);
      }
      // The welcome snapshot arrives after the socket opens. Pending commands
      // retain their original position expectation until that snapshot arrives.
    });

    attachSocketListener(socket, "message", (event) => {
      if (generation !== this._socketGeneration) return;
      this._handleMessage(event.data);
    });

    attachSocketListener(socket, "error", (event) => {
      if (generation !== this._socketGeneration) return;
      this._emitError(
        new RoomClientError("房间连接发生错误。", {
          code: "SOCKET_ERROR",
          retryable: true,
          details: event,
        }),
      );
    });

    attachSocketListener(socket, "close", (event) => {
      if (generation !== this._socketGeneration) return;
      this._clearSnapshotTimer();
      this._socket = null;
      this.lastCloseCode = event.code;
      this.lastCloseReason = event.reason ?? "";
      if (this._manualClose || !this.session) {
        this._setStatus(CONNECTION_STATUS.CLOSED, {
          code: event.code,
          reason: event.reason,
        });
        return;
      }
      if ([4401, 4404, 4408].includes(event.code)) {
        this._manualClose = true;
        this._clearReconnectTimer();
        this._rejectPendingCommands(
          new RoomClientError("房间会话已经停止。", {
            code: event.code === 4408 ? "SESSION_REPLACED" : "SESSION_ENDED",
          }),
        );
        if (event.code === 4401 || event.code === 4404) {
          this._removeCurrentSession();
          this.session = null;
          this.identity = null;
          this.roomCode = "";
          this.room = null;
          this.presence = null;
          this._nextSequence = 1;
          this._setStatus(CONNECTION_STATUS.DISCONNECTED, {
            code: event.code,
            reason: event.reason,
            terminal: true,
          });
        } else {
          this._setStatus(CONNECTION_STATUS.CLOSED, {
            code: event.code,
            reason: event.reason,
            terminal: true,
          });
        }
        return;
      }
      this._scheduleReconnect({ code: event.code, reason: event.reason });
    });
    return socket;
  }

  _scheduleReconnect(closeDetails = {}) {
    if (this._manualClose || !this.session || this._reconnectTimer) return;
    const attempt = this._reconnectAttempt + 1;
    if (attempt > this.reconnectOptions.maxAttempts) {
      this._setStatus(CONNECTION_STATUS.DISCONNECTED, {
        ...closeDetails,
        attempt: this._reconnectAttempt,
      });
      return;
    }

    this._reconnectAttempt = attempt;
    const rawDelay = Math.min(
      this.reconnectOptions.maxDelayMs,
      this.reconnectOptions.initialDelayMs *
        this.reconnectOptions.factor ** (attempt - 1),
    );
    const jitterScale =
      1 + (this.random() * 2 - 1) * this.reconnectOptions.jitter;
    const retryInMs = Math.max(0, Math.round(rawDelay * jitterScale));
    this._setStatus(CONNECTION_STATUS.RECONNECTING, {
      ...closeDetails,
      attempt,
      retryInMs,
    });
    this._reconnectTimer = this.setTimeoutImpl(() => {
      this._reconnectTimer = null;
      if (!this._manualClose && this.session) this._openSocket(true);
    }, retryInMs);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer !== null) {
      this.clearTimeoutImpl(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _clearSnapshotTimer() {
    if (this._snapshotTimer !== null) {
      this.clearTimeoutImpl(this._snapshotTimer);
      this._snapshotTimer = null;
    }
  }

  _handleMessage(rawData) {
    let message;
    try {
      message =
        typeof rawData === "string" ? JSON.parse(rawData) : JSON.parse(String(rawData));
    } catch (cause) {
      this._emitError(
        new RoomClientError("收到无法识别的房间消息。", {
          code: "INVALID_MESSAGE",
          cause,
          details: rawData,
        }),
      );
      return;
    }

    if (message?.v !== BADUK_PROTOCOL_VERSION) {
      this._emitError(
        new RoomClientError("客户端与房间服务版本不兼容，请刷新页面。", {
          code: "PROTOCOL_UPGRADE_REQUIRED",
          details: message,
        }),
      );
      this.disconnect({
        preserveSession: true,
        status: CONNECTION_STATUS.DISCONNECTED,
      });
      return;
    }

    this._emit("message", message);
    switch (message.type) {
      case "welcome": {
        if (message.identity && this.session) {
          const merged = { ...this.session, ...message.identity, token: this.session.token };
          this.session = { ...merged, nextSequence: this._sequenceFloor(merged) };
          this._nextSequence = Math.max(this._nextSequence, this.session.nextSequence);
          this.identity = { ...message.identity };
          this.sessionStore.set(this.roomCode, this.session);
        }
        if (message.room || message.snapshot) this._handleStateMessage(message);
        break;
      }
      case "state":
      case "snapshot":
        this._handleStateMessage(message);
        break;
      case "presence": {
        const presence =
          message.presence ??
          message.payload ?? {
            players: message.players ?? [],
            spectators: message.spectators ?? [],
            serverTime: message.serverTime ?? null,
          };
        this.presence = presence;
        this._emit("presence", { presence, roomCode: this.roomCode, raw: message });
        break;
      }
      case "chat":
        this._handleChatMessage(message);
        break;
      case "ack":
        this._handleAck(message);
        break;
      case "error":
        this._handleServerError(message);
        break;
      default:
        break;
    }
  }

  _handleStateMessage(message) {
    const snapshot = message.snapshot?.room ?? message.snapshot;
    const incoming = message.room ?? message.state ?? snapshot ?? message.payload ?? null;
    if (!incoming) return;
    let room = incoming;
    if (incoming.chat === undefined && this.room?.chat) {
      room = { ...incoming, chat: this.room.chat };
    } else if (incoming.chat && typeof incoming.chat === "object") {
      room = {
        ...incoming,
        chat: {
          ...incoming.chat,
          messages: trimStoredChatHistories(incoming.chat.messages),
        },
      };
    }
    this.room = room;
    if (this._awaitingSnapshot && this._socketIsOpen()) {
      this._awaitingSnapshot = false;
      this._reconnectAttempt = 0;
      this._clearSnapshotTimer();
      const pendingCreate = this.pendingCreateIdentityStore.get(
        this.roomCode, this.session?.playerId,
      );
      if (isPendingCreate(pendingCreate) &&
          pendingCreate.token === this.session?.token &&
          this.sessionStore.get(this.roomCode, this.session.playerId)?.token === this.session.token) {
        this._clearPendingCreate(pendingCreate);
      }
      this._flushPendingCommands();
    }
    this._emit("state", {
      room,
      self: this.identity,
      serverTime: message.serverTime ?? message.snapshot?.serverTime ?? null,
      initial: false,
      raw: message,
    });
  }

  _handleChatMessage(event) {
    const message = event.message ?? event.payload ?? null;
    if (!message || typeof message !== "object" || typeof message.id !== "string") {
      return;
    }
    const previous = this.room?.chat ?? { sequence: 0, messages: [] };
    const byId = new Map(
      (Array.isArray(previous.messages) ? previous.messages : [])
        .filter((item) => item && typeof item.id === "string")
        .map((item) => [item.id, item]),
    );
    const existing = byId.get(message.id);
    if (
      existing &&
      Number(existing.sequence) >= Number(message.sequence)
    ) {
      return;
    }
    byId.set(message.id, message);
    const messages = trimStoredChatHistories(
      [...byId.values()]
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)),
    );
    const chat = {
      sequence: Math.max(
        Number(previous.sequence) || 0,
        Number(event.chatSequence) || 0,
        Number(message.sequence) || 0,
      ),
      messages,
    };
    if (this.room) this.room = { ...this.room, chat };
    this._emit("chat", {
      message,
      chat,
      roomCode: this.roomCode,
      serverTime: event.serverTime ?? null,
      raw: event,
    });
  }

  _handleAck(message) {
    const pending = this._pendingCommands.get(String(message.id));
    if (pending) {
      this._clearCommandTimer(pending);
      this._pendingCommands.delete(String(message.id));
      pending.resolve(message);
    }
    this._emit("ack", message);
  }

  _handleServerError(message) {
    const error = new RoomClientError(message.message ?? "房间拒绝了这个操作。", {
      code: message.code ?? "SERVER_ERROR",
      retryable: message.retryable ?? false,
      details: message,
    });
    if (message.id != null) {
      const pending = this._pendingCommands.get(String(message.id));
      if (pending) {
        this._clearCommandTimer(pending);
        this._pendingCommands.delete(String(message.id));
        pending.reject(error);
      }
    }
    this._emitError(error);
  }

  sendCommand(action, payload = {}, options = {}) {
    if (!this.session) {
      return Promise.reject(
        new RoomClientError("尚未加入房间。", { code: "MISSING_SESSION" }),
      );
    }
    if (POSITION_BOUND_ACTIONS.has(action)) {
      if (
        !Number.isSafeInteger(this.room?.moveCount) ||
        typeof this.room?.positionToken !== "string"
      ) {
        return Promise.reject(new RoomClientError(
          "尚未取得可确认的棋局局面，请等待房间同步。",
          { code: "STALE_GAME_STATE", retryable: true },
        ));
      }
      payload = {
        expectedMoveCount: this.room.moveCount,
        expectedPositionToken: this.room.positionToken,
        ...payload,
      };
    }
    const id = String(options.id ?? this.idFactory());
    if (this._pendingCommands.has(id)) {
      return Promise.reject(
        new RoomClientError("联机命令编号重复。", { code: "DUPLICATE_COMMAND_ID" }),
      );
    }

    const stored = this.sessionStore.get(this.roomCode, this.session.playerId);
    const pendingCreate = this.pendingCreateIdentityStore.get(this.roomCode, this.session.playerId);
    const pendingJoin = this.pendingJoinIdentityStore.get(this.roomCode, this.session.playerId);
    const fallback = pendingCreate?.confirmedSession?.token === this.session.token
      ? pendingCreate : pendingJoin?.confirmedSession?.token === this.session.token
        ? pendingJoin : null;
    const sequence = Math.max(
      this._nextSequence,
      stored?.token === this.session.token ? Number(stored.nextSequence) || 1 : 1,
      fallback ? Number(fallback.confirmedSession.nextSequence) || 1 : 1,
    );
    const nextSession = { ...this.session, nextSequence: sequence + 1 };
    const persisted = stored?.token === this.session.token
      ? this.sessionStore.set(this.roomCode, nextSession)
      : fallback
        ? (fallback.roomCode
          ? this.pendingCreateIdentityStore.set(this.roomCode, {
            ...fallback, confirmedSession: nextSession,
          })
          : this.pendingJoinIdentityStore.set(this.roomCode, {
            ...fallback, confirmedSession: nextSession,
          }))
        : false;
    if (!persisted) {
      return Promise.reject(new RoomClientError(
        "无法保存联机命令序号，请检查浏览器存储设置后重试。",
        { code: "COMMAND_SEQUENCE_STORAGE_UNAVAILABLE", retryable: true },
      ));
    }
    this._nextSequence = sequence + 1;
    this.session = nextSession;
    const envelope = buildCommandEnvelope(id, sequence, action, payload);

    const promise = new Promise((resolve, reject) => {
      const pending = { envelope, resolve, reject, timeoutId: null };
      const timeoutMs = options.timeoutMs ?? this.commandAckTimeoutMs;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        pending.timeoutId = this.setTimeoutImpl(() => {
          this._pendingCommands.delete(id);
          reject(
            new RoomClientError("等待服务器确认超时。", {
              code: "ACK_TIMEOUT",
              retryable: true,
              details: envelope,
            }),
          );
        }, timeoutMs);
      }
      this._pendingCommands.set(id, pending);
    });

    this._sendPending(this._pendingCommands.get(id));
    if (!this._socket && !this._manualClose) this.connect();
    return promise;
  }

  command(action, payload = {}, options = {}) {
    return this.sendCommand(action, payload, options);
  }

  sendChat(payload, options = {}) {
    return this.sendCommand("chat", payload, options);
  }

  _socketIsOpen() {
    return this._socket?.readyState === 1;
  }

  _sendPending(pending) {
    if (!pending || !this._socketIsOpen() || this._awaitingSnapshot) return false;
    try {
      this._socket.send(JSON.stringify(pending.envelope));
      return true;
    } catch (cause) {
      this._emitError(
        new RoomClientError("发送房间命令失败。", {
          code: "COMMAND_SEND_ERROR",
          retryable: true,
          cause,
        }),
      );
      return false;
    }
  }

  _flushPendingCommands() {
    for (const pending of this._pendingCommands.values()) this._sendPending(pending);
  }

  _clearCommandTimer(pending) {
    if (pending.timeoutId !== null) {
      this.clearTimeoutImpl(pending.timeoutId);
      pending.timeoutId = null;
    }
  }

  _rejectPendingCommands(error) {
    for (const pending of this._pendingCommands.values()) {
      this._clearCommandTimer(pending);
      pending.reject(error);
    }
    this._pendingCommands.clear();
  }

  async leave(options = {}) {
    if (!this.session) return null;
    const acknowledgement = await this.sendCommand("leave", {}, {
      timeoutMs: options.timeoutMs ?? 12_000,
    });
    this._removeCurrentSession();
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
    return acknowledgement;
  }

  abandonRoom() {
    this._removeCurrentSession();
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
    return !this.lastCredentialCleanupFailed;
  }

  detachRoom() {
    this._clearCurrentTabPointer();
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
  }

  _clearCurrentTabPointer() {
    const pointer = this.activeSessionStore.get(this.roomCode);
    if (pointer?.playerId === this.session?.playerId &&
        pointer.token === this.session?.token) this.activeSessionStore.remove(this.roomCode);
  }

  _removeCurrentSession() {
    if (!this.session || !this.roomCode) return true;
    const { playerId, token } = this.session;
    const code = this.roomCode;
    let failed = false;
    if (this.sessionStore.get(code, playerId)?.token === token) {
      if (!this.sessionStore.remove(code, playerId, token)) failed = true;
    }
    const pendingJoin = this.pendingJoinIdentityStore.get(code, playerId);
    if (pendingJoin?.token === token) {
      if (!this.pendingJoinIdentityStore.remove(code, playerId, token)) failed = true;
    }
    const pendingCreate = this.pendingCreateIdentityStore.get(code, playerId);
    if (pendingCreate?.token === token) {
      if (!this._clearPendingCreate(pendingCreate)) failed = true;
    }
    const legacy = this.tokenStore.get(code);
    if (legacy?.playerId === playerId && legacy.token === token) {
      if (!this.tokenStore.remove(code)) failed = true;
    }
    this.lastCredentialCleanupFailed = failed;
    if (failed) this._emitError(new RoomClientError(
      "无法删除当前房间身份的本地凭据；请检查浏览器存储设置。",
      { code: "CREDENTIAL_CLEANUP_FAILED" },
    ));
    this._clearCurrentTabPointer();
    return !failed;
  }

  disconnect(options = {}) {
    const preserveSession = options.preserveSession ?? true;
    this._manualClose = true;
    this._awaitingSnapshot = false;
    this._clearReconnectTimer();
    this._clearSnapshotTimer();
    ++this._socketGeneration;
    const socket = this._socket;
    this._socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, "client disconnect");
    this._rejectPendingCommands(
      new RoomClientError("房间连接已关闭。", { code: "CLIENT_DISCONNECT" }),
    );
    if (!preserveSession) {
      this.session = null;
      this.identity = null;
      this.roomCode = "";
      this.room = null;
      this.presence = null;
      this._nextSequence = 1;
    }
    this._setStatus(options.status ?? CONNECTION_STATUS.CLOSED);
  }

  getShareUrl(baseUrl = this.locationHref) {
    return buildShareUrl(this.roomCode, baseUrl);
  }

  destroy() {
    this.disconnect({ preserveSession: true });
    this._listeners.clear();
  }
}

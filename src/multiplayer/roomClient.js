import { trimStoredChatHistory } from "./chat.js";
import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
} from "./protocol.js";

const DEFAULT_ROOM_PATH = "/api/rooms";
const DEFAULT_PROTOCOL = BADUK_WS_PROTOCOL;
const DEFAULT_STORAGE_PREFIX = "bamboo-baduk.session.";

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
  });
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
    this.tokenStore =
      options.tokenStore ?? createTokenStore(options.storage ?? globalThis.localStorage);
    this.createRoomPath = options.createRoomPath ?? DEFAULT_ROOM_PATH;
    this.joinRoomPath =
      options.joinRoomPath ??
      ((code) => `${DEFAULT_ROOM_PATH}/${encodeURIComponent(code)}`);
    this.socketPath =
      options.socketPath ??
      ((code) => `${DEFAULT_ROOM_PATH}/${encodeURIComponent(code)}/socket`);
    this.protocolName = options.protocolName ?? DEFAULT_PROTOCOL;
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
    this.sendAuthMessage = options.sendAuthMessage ?? false;

    this.roomCode = "";
    this.session = null;
    this.identity = null;
    this.room = null;
    this.presence = null;
    this.connectionStatus = CONNECTION_STATUS.IDLE;
    this.lastCloseCode = null;
    this.lastCloseReason = "";

    this._listeners = new Map();
    this._socket = null;
    this._socketGeneration = 0;
    this._manualClose = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._pendingCommands = new Map();
    this._nextSequence = 1;
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

  hasStoredSession(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!code) return false;
    return Boolean(this.tokenStore.get(code)?.token);
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

  async createRoom(options = {}) {
    const config = typeof options === "string" ? { name: options } : options;
    const { options: gameOptions = {}, ...requestConfig } = config;
    const name = normalizePlayerName(config.name);
    if (!name) {
      throw new RoomClientError("请输入你的名字。", { code: "INVALID_NAME" });
    }

    this._setStatus(CONNECTION_STATUS.CREATING);
    try {
      const response = await this._post(this.createRoomPath, {
        v: BADUK_PROTOCOL_VERSION,
        ...gameOptions,
        ...requestConfig,
        name,
      });
      const session = responseSession(response, response.roomCode, name);
      this._adoptSession(session, response.room);
      this.connect();
      return {
        ...response,
        roomCode: session.code,
        session: { ...session },
        shareUrl: this.getShareUrl(),
      };
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
    if (!code) {
      throw new RoomClientError("房间号格式不正确。", {
        code: "INVALID_ROOM_CODE",
      });
    }
    if (!name) {
      throw new RoomClientError("请输入你的名字。", { code: "INVALID_NAME" });
    }

    this._setStatus(CONNECTION_STATUS.JOINING, { roomCode: code });
    try {
      const response = await this._post(this.joinRoomPath(code), {
        v: BADUK_PROTOCOL_VERSION,
        name,
        role: config.role === "spectator" ? "spectator" : "player",
      });
      const session = responseSession(response, code, name);
      this._adoptSession(session, response.room);
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

  resumeRoom(roomCode) {
    const code = normalizeRoomCode(roomCode);
    const saved = this.tokenStore.get(code);
    if (!saved?.token) return false;
    const session = responseSession({ session: saved }, code, saved.playerName);
    this._adoptSession(session);
    this.connect();
    return true;
  }

  _adoptSession(session, room = null) {
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.IDLE });
    this.session = { ...session };
    this.identity = publicIdentity(session);
    this.roomCode = session.code;
    this.room = room ?? null;
    this._nextSequence = Math.max(1, Number(session.nextSequence) || 1);
    this._manualClose = false;
    this.tokenStore.set(this.roomCode, this.session);
    if (room) {
      this._emit("state", {
        room,
        self: this.identity,
        serverTime: null,
        initial: true,
        raw: { type: "state", room },
      });
    }
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
      this._reconnectAttempt = 0;
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
      this._flushPendingCommands();
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
          const code = this.roomCode;
          if (code) this.tokenStore.remove(code);
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
          this.session = { ...this.session, ...message.identity, token: this.session.token };
          this.identity = { ...message.identity };
          this.tokenStore.set(this.roomCode, this.session);
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
          messages: trimStoredChatHistory(incoming.chat.messages),
        },
      };
    }
    this.room = room;
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
    const messages = trimStoredChatHistory(
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
    const id = String(options.id ?? this.idFactory());
    if (this._pendingCommands.has(id)) {
      return Promise.reject(
        new RoomClientError("联机命令编号重复。", { code: "DUPLICATE_COMMAND_ID" }),
      );
    }

    const sequence = this._nextSequence++;
    this.session = { ...this.session, nextSequence: this._nextSequence };
    this.tokenStore.set(this.roomCode, this.session);
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
    if (!pending || !this._socketIsOpen()) return false;
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
    const code = this.roomCode;
    if (!this.session) return null;
    const acknowledgement = await this.sendCommand("leave", {}, {
      timeoutMs: options.timeoutMs ?? 12_000,
    });
    if (code) this.tokenStore.remove(code);
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
    return acknowledgement;
  }

  abandonRoom() {
    const code = this.roomCode;
    if (code) this.tokenStore.remove(code);
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
  }

  detachRoom() {
    this.disconnect({ preserveSession: false, status: CONNECTION_STATUS.CLOSED });
  }

  disconnect(options = {}) {
    const preserveSession = options.preserveSession ?? true;
    this._manualClose = true;
    this._clearReconnectTimer();
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

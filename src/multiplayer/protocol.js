export const BADUK_PROTOCOL_VERSION = 1;
export const BADUK_WS_PROTOCOL = "bamboo-baduk";
export const LEGACY_BADUK_WS_PROTOCOL = "bamboo-baduk-v1";

export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const ROOM_ACTIONS = Object.freeze([
  "play",
  "pass",
  "toggle_dead",
  "finish_scoring",
  "resume_play",
  "request_undo",
  "respond_undo",
  "cancel_undo",
  "new_game",
  "leave",
  "sync",
]);

const ROOM_ACTION_SET = new Set(ROOM_ACTIONS);

export function isRoomCode(value) {
  return typeof value === "string" && ROOM_CODE_PATTERN.test(value);
}
export function sanitizeRoomCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, 6);
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRoomRole(value) {
  return value === "player" || value === "spectator";
}

export function isRoomColor(value) {
  return value === "black" || value === "white";
}

/**
 * Normalize the compact client command envelope used by the browser.  A
 * command id is mandatory so a reconnecting client can safely resend it.  A
 * monotonically increasing sequence is supported as an extra stale-message
 * guard, but is deliberately optional for simple clients.
 */
export function normalizeCommandMessage(value) {
  if (
    !isRecord(value) ||
    (value.v !== undefined && value.v !== BADUK_PROTOCOL_VERSION) ||
    value.type !== "command" ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 128
  ) {
    return null;
  }

  let action = value.action;
  let payload = isRecord(value.payload) ? value.payload : {};

  // Compatibility with the earlier nested command proposal.
  if (typeof action !== "string" && isRecord(value.command)) {
    action = value.command.op;
    payload = { ...value.command };
    delete payload.op;
  }

  if (typeof action !== "string" || !ROOM_ACTION_SET.has(action)) return null;

  const sequence = value.sequence;
  if (
    sequence !== undefined &&
    (!Number.isSafeInteger(sequence) || sequence <= 0)
  ) {
    return null;
  }

  return {
    id: value.id,
    sequence: sequence ?? null,
    action,
    payload,
  };
}

export function makeStateMessage(room, serverTime = Date.now()) {
  return {
    v: BADUK_PROTOCOL_VERSION,
    type: "state",
    room,
    serverTime,
  };
}

export function makePresenceMessage(room, serverTime = Date.now()) {
  return {
    v: BADUK_PROTOCOL_VERSION,
    type: "presence",
    players: room.players,
    spectators: room.spectators,
    serverTime,
  };
}

export function makeAckMessage(command, revision) {
  return {
    v: BADUK_PROTOCOL_VERSION,
    type: "ack",
    id: command.id,
    ...(command.sequence === null ? {} : { sequence: command.sequence }),
    ok: true,
    revision,
  };
}

export function makeErrorMessage({ id, code, message, retryable = false }) {
  return {
    v: BADUK_PROTOCOL_VERSION,
    type: "error",
    ...(id ? { id } : {}),
    code,
    message,
    retryable,
  };
}

export function isSession(value) {
  return (
    isRecord(value) &&
    isRoomCode(value.code) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    value.token.length <= 256 &&
    typeof value.playerId === "string" &&
    value.playerId.length > 0
  );
}

function decodeBase64Url(value) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Read the application protocol and reconnect token from a WebSocket
 * Sec-WebSocket-Protocol header.  Both the current raw-token pair
 * (`bamboo-baduk, <token>`) and `token.<base64url>` are accepted.
 */
export function parseWebSocketProtocols(headerValue) {
  const offered = String(headerValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const protocol = offered.includes(BADUK_WS_PROTOCOL)
    ? BADUK_WS_PROTOCOL
    : offered.includes(LEGACY_BADUK_WS_PROTOCOL)
      ? LEGACY_BADUK_WS_PROTOCOL
      : null;

  if (!protocol) return { protocol: null, token: null };

  const tokenPart = offered.find(
    (value) =>
      value !== BADUK_WS_PROTOCOL && value !== LEGACY_BADUK_WS_PROTOCOL,
  );
  if (!tokenPart) return { protocol, token: null };

  const token = tokenPart.startsWith("token.")
    ? decodeBase64Url(tokenPart.slice("token.".length))
    : tokenPart;

  return {
    protocol,
    token:
      typeof token === "string" && token.length > 0 && token.length <= 256
        ? token
        : null,
  };
}

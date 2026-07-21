import {
  BLACK,
  GoEngine,
  PHASE_FINISHED,
  PHASE_PLAY,
  PHASE_SCORING,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../game/goEngine.js";
import {
  advanceTimeControl,
  completeTimeControlTurn,
  createTimeControl,
  nextTimeControlDueAt,
  normalizeTimeControlConfig,
  pauseTimeControl,
  restoreTimeControl,
  snapshotTimeControl,
  startTimeControl,
  timeControlConfig,
} from "../game/timeControl.js";
import {
  ChatValidationError,
  normalizeChatPayload,
  trimStoredChatHistory,
} from "./chat.js";
import { isRoomCode, isRoomRole } from "./protocol.js";

export const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_SPECTATORS = 32;
export const SPECTATOR_RESERVATION_TTL_MS = 60 * 1_000;
export const SPECTATOR_RECONNECT_GRACE_MS = 5 * 60 * 1_000;
export const SPECTATOR_COMMAND_MEMBER_BURST = 3;
export const SPECTATOR_COMMAND_MEMBER_REFILL_MS = 3 * 1_000;
export const SPECTATOR_COMMAND_ROOM_BURST = 8;
export const SPECTATOR_COMMAND_ROOM_REFILL_MS = 1 * 1_000;
export const MAX_COMMAND_RECEIPTS = 256;
export const CHAT_MEMBER_BURST = 5;
export const CHAT_MEMBER_REFILL_MS = 1_200;
export const CHAT_ROOM_BURST = 12;
export const CHAT_ROOM_REFILL_MS = 300;

const SERIALIZED_SCHEMA_VERSION = 1;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_SCORING_RULES = new Set(["japanese", "chinese"]);
const VALID_TOPOLOGIES = new Set([
  TOPOLOGY_CYLINDER,
  TOPOLOGY_TORUS,
  TOPOLOGY_MOBIUS,
]);
const VALID_AI_MODELS = new Set(["b10", "b18"]);
const AUTOMATED_WHITE_ID_PREFIX = "__ai_white__";
// This is a deliberately unreachable credential hash, not a usable token.
// Persisting the AI as an ordinary white player keeps older releases able to
// read the room while the current release never authenticates this member.
const AUTOMATED_TOKEN_HASH = "f".repeat(64);
const FINGERPRINT_PATTERN = /^(?:pos|terminal)-v1-[a-f0-9]{16}-[a-z0-9]+$/;

const GAME_ERROR_MESSAGES = Object.freeze({
  game_not_playing: "当前阶段不能落子或停一手。",
  out_of_bounds: "这个位置不在棋盘上。",
  occupied: "这个位置已经有棋子了。",
  suicide: "这一步会造成自杀，不能落子。",
  superko: "这一步违反全局同形规则。",
  game_not_scoring: "当前还没有进入点目阶段。",
  empty_point: "空点不能标记为死子。",
});

function timeControlError(error, persisted = false) {
  if (error instanceof RoomEngineError) return error;
  return new RoomEngineError(
    persisted ? "持久化计时状态无效。" : "计时设置无效。",
    persisted ? 500 : 400,
    persisted ? "BAD_ROOM_STATE" : "BAD_REQUEST",
  );
}

function roomTimeControlConfig(value) {
  try {
    return normalizeTimeControlConfig(value);
  } catch (error) {
    throw timeControlError(error);
  }
}

function freshRoomTimeControl(value, now) {
  try {
    return createTimeControl(value, { now });
  } catch (error) {
    throw timeControlError(error);
  }
}

function persistedRoomTimeControl(value) {
  try {
    return restoreTimeControl(value);
  } catch (error) {
    throw timeControlError(error, true);
  }
}

export class RoomEngineError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST", retryable = false) {
    super(message);
    this.name = "RoomEngineError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readNow(value) {
  const now = value ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new RoomEngineError("时间戳无效。", 400, "BAD_REQUEST");
  }
  return now;
}

function normalizeName(value) {
  if (typeof value !== "string") {
    throw new RoomEngineError("请填写名字。", 400, "BAD_REQUEST");
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new RoomEngineError("请填写名字。", 400, "BAD_REQUEST");
  if ([...name].length > 20) {
    throw new RoomEngineError("名字最多 20 个字。", 400, "BAD_REQUEST");
  }
  return name;
}

function normalizePlayerId(value) {
  if (typeof value !== "string" || !value || value.length > 128) {
    throw new RoomEngineError("玩家身份无效。", 400, "BAD_REQUEST");
  }
  return value;
}

function normalizeTokenHash(value) {
  if (
    typeof value !== "string" ||
    !TOKEN_HASH_PATTERN.test(value.toLowerCase())
  ) {
    throw new RoomEngineError("身份凭据无效。", 400, "BAD_REQUEST");
  }
  return value.toLowerCase();
}

function normalizeDimension(value, label = "棋盘大小") {
  const dimension = value ?? 19;
  if (!Number.isInteger(dimension) || dimension < 3 || dimension > 25) {
    throw new RoomEngineError(
      `${label}必须是 3 到 25 之间的整数。`,
      400,
      "BAD_REQUEST",
    );
  }
  return dimension;
}

function normalizeKomi(value) {
  const komi = value ?? 6.5;
  if (!Number.isFinite(komi) || komi < 0 || komi > 50) {
    throw new RoomEngineError("贴目设置无效。", 400, "BAD_REQUEST");
  }
  return komi;
}

function normalizeScoringRule(value) {
  const scoringRule = value ?? "japanese";
  if (!VALID_SCORING_RULES.has(scoringRule)) {
    throw new RoomEngineError("点目规则无效。", 400, "BAD_REQUEST");
  }
  return scoringRule;
}

function normalizeTopology(value) {
  const topology = value ?? TOPOLOGY_CYLINDER;
  if (!VALID_TOPOLOGIES.has(topology)) {
    throw new RoomEngineError("棋盘形状无效。", 400, "BAD_REQUEST");
  }
  return topology;
}

function normalizeAIModelId(value, persisted = false) {
  const modelId = value ?? "b10";
  if (typeof modelId !== "string" || !VALID_AI_MODELS.has(modelId)) {
    throw new RoomEngineError(
      persisted ? "持久化 AI 席位无效。" : "AI 模型无效。",
      persisted ? 500 : 400,
      persisted ? "BAD_ROOM_STATE" : "BAD_REQUEST",
    );
  }
  return modelId;
}

function normalizeRole(value) {
  if (!isRoomRole(value)) {
    throw new RoomEngineError("房间身份无效。", 400, "BAD_REQUEST");
  }
  return value;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function hashRoomToken(token) {
  if (typeof token !== "string" || !token || token.length > 256) {
    throw new RoomEngineError(
      "房间身份已经失效，请重新加入。",
      401,
      "UNAUTHORIZED",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function serializeGame(game) {
  if (typeof game.exportState === "function") {
    return clone(game.exportState());
  }
  if (typeof game.serialize === "function") {
    const serialized = game.serialize();
    return typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
  }

  // Compatibility with the original engine while exportState lands.  Its
  // mutable rule fields are public, including the positional-superko set.
  return {
    ...clone(game.getState()),
    positionHistory: [...game.positionHistory],
  };
}

function snapshotReplay(game) {
  if (typeof game.getReplayState === "function") {
    return clone(game.getReplayState());
  }

  // Older engines and lightweight test doubles do not expose replay history.
  // Their current position is still a valid one-frame review, but it must be
  // marked incomplete so clients never present it as the full game record.
  return {
    version: 1,
    complete: false,
    base: serializeGame(game),
    events: [],
  };
}

function fingerprint(prefix, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return [
    prefix,
    "v1",
    hash.toString(16).padStart(16, "0"),
    bytes.length.toString(36),
  ].join("-");
}

function positionToken(game, roomState) {
  const state = game.getState();
  const automated = roomState.members.find(
    (member) => member.role === "player" && member.automated === true,
  );
  return fingerprint("pos", {
    positionEpoch: roomState.positionEpoch,
    width: state.width ?? state.size,
    height: state.height ?? state.size,
    komi: state.komi,
    scoringRule: state.scoringRule,
    topology: state.topology ?? TOPOLOGY_CYLINDER,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    consecutivePasses: state.consecutivePasses,
    board: state.board,
    captures: state.captures,
    deadStones: state.deadStones,
    lastMove: state.lastMove,
    positionHistory: [...(game.positionHistory ?? [])].sort(),
    automatedSeat: automated
      ? {
          playerId: automated.playerId,
          controllerId: automated.controllerId,
          modelId: automated.modelId,
        }
      : null,
  });
}

function compatibleTerminalFingerprint(game) {
  return fingerprint("terminal", serializeGame(game));
}

function publicResignationResult(outcome) {
  if (!outcome) return null;
  return {
    winner: outcome.winner,
    loser: outcome.loser,
    margin: 0,
    reason: "resign",
    resignation: true,
  };
}

function validStoredLastMove(lastMove) {
  if (lastMove === null) return true;
  if (!lastMove || typeof lastMove !== "object" || Array.isArray(lastMove)) {
    return false;
  }
  if (!VALID_COLORS.has(lastMove.color)) return false;
  if (lastMove.type === "pass") return true;
  return lastMove.type === "play" &&
    Number.isInteger(lastMove.row) &&
    Number.isInteger(lastMove.col) &&
    Array.isArray(lastMove.captured) &&
    lastMove.captured.every((point) =>
      point &&
      typeof point === "object" &&
      Number.isInteger(point.row) &&
      Number.isInteger(point.col));
}

function validResignationOutcome(outcome) {
  return outcome === null || (
    outcome &&
    typeof outcome === "object" &&
    !Array.isArray(outcome) &&
    outcome.reason === "resign" &&
    outcome.resignation === true &&
    VALID_COLORS.has(outcome.winner) &&
    VALID_COLORS.has(outcome.loser) &&
    outcome.winner !== outcome.loser &&
    VALID_COLORS.has(outcome.currentPlayer) &&
    Number.isInteger(outcome.consecutivePasses) &&
    outcome.consecutivePasses >= 0 &&
    outcome.consecutivePasses <= 1 &&
    Number.isFinite(outcome.finishedAt) &&
    Number.isSafeInteger(outcome.replayEventCount) &&
    outcome.replayEventCount >= 0 &&
    validStoredLastMove(outcome.lastMove) &&
    (
      outcome.roomRevision === undefined ||
      (Number.isSafeInteger(outcome.roomRevision) && outcome.roomRevision >= 1)
    ) &&
    (
      outcome.terminalFingerprint === undefined ||
      (
        typeof outcome.terminalFingerprint === "string" &&
        FINGERPRINT_PATTERN.test(outcome.terminalFingerprint) &&
        outcome.terminalFingerprint.startsWith("terminal-v1-")
      )
    )
  );
}

function assertResignationPersistence(state, game) {
  const outcome = state.resignationOutcome;
  if (!outcome) return;

  // rc.2 ignores the optional resignation field. It can therefore replace the
  // game with a new play, scoring, or finished position while preserving stale
  // metadata. Only the exact synthetic terminal written by the resign action
  // may activate that metadata; every other combination is a rollback-created
  // stale value and must be discarded rather than overlaid on the new game.
  const compatibleTerminal =
    typeof outcome.terminalFingerprint === "string" &&
    outcome.roomRevision === state.revision &&
    game.phase === PHASE_FINISHED &&
    game.result?.reason !== "resign" &&
    !state.timeControl?.outcome &&
    compatibleTerminalFingerprint(game) === outcome.terminalFingerprint;
  if (!compatibleTerminal) state.resignationOutcome = null;
}

function restoreGame(value) {
  const snapshot = typeof value === "string" ? JSON.parse(value) : clone(value);
  if (!snapshot || typeof snapshot !== "object") {
    throw new RoomEngineError(
      "持久化棋局无法读取。",
      500,
      "BAD_ROOM_STATE",
    );
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, "topology")) {
    snapshot.topology = TOPOLOGY_CYLINDER;
  }

  if (typeof GoEngine.fromState === "function") {
    return GoEngine.fromState(snapshot);
  }

  const game = new GoEngine({
    ...(Number.isInteger(snapshot.size) ? { size: snapshot.size } : {}),
    width: snapshot.width ?? snapshot.size,
    height: snapshot.height ?? snapshot.size,
    komi: snapshot.komi,
    scoringRule: snapshot.scoringRule,
    initialBoard: snapshot.board,
    currentPlayer: snapshot.currentPlayer,
  });
  game.phase = snapshot.phase;
  game.consecutivePasses = snapshot.consecutivePasses;
  game.captures = clone(snapshot.captures);
  game.deadStones = new Set(
    (snapshot.deadStones ?? []).map((point) =>
      typeof point === "string" ? point : `${point.row},${point.col}`,
    ),
  );
  game.lastMove = clone(snapshot.lastMove);
  game.result = clone(snapshot.result);
  if (Array.isArray(snapshot.positionHistory)) {
    game.positionHistory = new Set(snapshot.positionHistory);
  }
  return game;
}

function validateCoordinate(value, label) {
  if (!Number.isInteger(value)) {
    throw new RoomEngineError(`${label}坐标无效。`, 400, "BAD_REQUEST");
  }
  return value;
}

function freshChatBucket(capacity, now) {
  return { tokens: capacity, updatedAt: now };
}

function restoredChatBucket(value, capacity, fallbackTime) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isFinite(value.tokens) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return freshChatBucket(capacity, fallbackTime);
  }
  return {
    tokens: Math.max(0, Math.min(capacity, value.tokens)),
    updatedAt: value.updatedAt,
  };
}

function spendChatToken(bucket, capacity, refillMs, now) {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + elapsed / refillMs);
  if (tokens < 1) {
    return {
      ok: false,
      retryAfterMs: Math.max(1, Math.ceil((1 - tokens) * refillMs)),
    };
  }
  return {
    ok: true,
    bucket: { tokens: tokens - 1, updatedAt: now },
  };
}

function validateSerializedState(state) {
  if (
    !state ||
    state.schemaVersion !== SERIALIZED_SCHEMA_VERSION ||
    !isRoomCode(state.code) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    (state.moveCount !== undefined &&
      (!Number.isSafeInteger(state.moveCount) || state.moveCount < 0)) ||
    (state.positionEpoch !== undefined &&
      (!Number.isSafeInteger(state.positionEpoch) || state.positionEpoch < 1)) ||
    !Array.isArray(state.members) ||
    !Array.isArray(state.receipts) ||
    !state.game
  ) {
    throw new RoomEngineError(
      "房间持久化状态无效。",
      500,
      "BAD_ROOM_STATE",
    );
  }

  const colors = new Set();
  let automatedPlayers = 0;
  let spectators = 0;
  for (const member of state.members) {
    normalizePlayerId(member.playerId);
    normalizeName(member.name);
    normalizeTokenHash(member.tokenHash);
    if (member.role === "player") {
      if (!VALID_COLORS.has(member.color) || colors.has(member.color)) {
        throw new RoomEngineError(
          "房间座位状态无效。",
          500,
          "BAD_ROOM_STATE",
        );
      }
      colors.add(member.color);
      if (member.automated === true) {
        automatedPlayers += 1;
        if (
          member.color !== WHITE ||
          member.tokenHash !== AUTOMATED_TOKEN_HASH ||
          typeof member.controllerId !== "string" ||
          !member.controllerId ||
          member.controllerId.length > 128
        ) {
          throw new RoomEngineError(
            "持久化 AI 席位无效。",
            500,
            "BAD_ROOM_STATE",
          );
        }
        normalizeAIModelId(member.modelId, true);
      }
    } else if (member.role === "spectator" && member.color === null) {
      spectators += 1;
    } else {
      throw new RoomEngineError(
        "房间成员状态无效。",
        500,
        "BAD_ROOM_STATE",
      );
    }
  }
  if (automatedPlayers > 1) {
    throw new RoomEngineError(
      "持久化 AI 席位无效。",
      500,
      "BAD_ROOM_STATE",
    );
  }
  if (spectators > MAX_SPECTATORS) {
    throw new RoomEngineError(
      "旁观者数量无效。",
      500,
      "BAD_ROOM_STATE",
    );
  }
  if (state.scoreConfirmations !== undefined) {
    if (
      !Array.isArray(state.scoreConfirmations) ||
      state.scoreConfirmations.some((color) => !VALID_COLORS.has(color)) ||
      new Set(state.scoreConfirmations).size !== state.scoreConfirmations.length
    ) {
      throw new RoomEngineError(
        "Persisted score confirmations are invalid.",
        500,
        "BAD_ROOM_STATE",
      );
    }
  }
  if (state.undoRequest !== undefined && state.undoRequest !== null) {
    const request = state.undoRequest;
    const requester = state.members.find(
      (member) => member.playerId === request.requesterId,
    );
    if (
      !request ||
      typeof request !== "object" ||
      request.requesterRole !== "player" ||
      !VALID_COLORS.has(request.requesterColor) ||
      !Number.isSafeInteger(request.targetMoveCount) ||
      request.targetMoveCount < 1 ||
      request.targetMoveCount !== state.moveCount ||
      (request.requestRevision !== undefined &&
        (!Number.isSafeInteger(request.requestRevision) ||
          request.requestRevision < 1 ||
          request.requestRevision > state.revision)) ||
      !Number.isFinite(request.requestedAt) ||
      !requester ||
      requester.role !== "player" ||
      requester.color !== request.requesterColor
    ) {
      throw new RoomEngineError(
        "持久化的悔棋申请状态无效。",
        500,
        "BAD_ROOM_STATE",
      );
    }
  }
  if (
    state.resignationOutcome !== undefined &&
    !validResignationOutcome(state.resignationOutcome)
  ) {
    throw new RoomEngineError(
      "持久化认输状态无效。",
      500,
      "BAD_ROOM_STATE",
    );
  }
}

export class RoomEngine {
  constructor(state, game) {
    this.state = state;
    this.game = game;
    this.connections = new Map();
  }

  static create({
    code,
    name,
    size,
    width,
    height,
    mainTimeSeconds,
    byoYomiPeriods,
    byoYomiSeconds,
    komi = 6.5,
    scoringRule = "japanese",
    topology = TOPOLOGY_CYLINDER,
    playerId,
    tokenHash,
    now: nowInput,
  }) {
    const now = readNow(nowInput);
    if (!isRoomCode(code)) {
      throw new RoomEngineError("房间码必须是 6 位。", 400, "BAD_REQUEST");
    }
    const normalizedName = normalizeName(name);
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedTokenHash = normalizeTokenHash(tokenHash);
    const normalizedWidth = normalizeDimension(width ?? size ?? height ?? 19, "棋盘宽度");
    const normalizedHeight = normalizeDimension(height ?? size ?? width ?? 19, "棋盘高度");
    const timeControl = freshRoomTimeControl(
      roomTimeControlConfig({
        mainTimeSeconds,
        byoYomiPeriods,
        byoYomiSeconds,
      }),
      now,
    );
    const game = new GoEngine({
      ...(normalizedWidth === normalizedHeight ? { size: normalizedWidth } : {}),
      width: normalizedWidth,
      height: normalizedHeight,
      komi: normalizeKomi(komi),
      scoringRule: normalizeScoringRule(scoringRule),
      topology: normalizeTopology(topology),
    });
    const state = {
      schemaVersion: SERIALIZED_SCHEMA_VERSION,
      code,
      revision: 1,
      moveCount: 0,
      positionEpoch: 1,
      scoreConfirmations: [],
      undoRequest: null,
      resignationOutcome: null,
      timeControl,
      chatSequence: 0,
      chatMessages: [],
      chatBucket: freshChatBucket(CHAT_ROOM_BURST, now),
      spectatorCommandBucket: freshChatBucket(
        SPECTATOR_COMMAND_ROOM_BURST,
        now,
      ),
      game: serializeGame(game),
      members: [
        {
          playerId: normalizedPlayerId,
          name: normalizedName,
          tokenHash: normalizedTokenHash,
          role: "player",
          color: BLACK,
          joinedAt: now,
          lastSeenAt: now,
          lastSequence: 0,
          chatBucket: freshChatBucket(CHAT_MEMBER_BURST, now),
        },
      ],
      receipts: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
      expiredAt: null,
    };
    return new RoomEngine(state, game);
  }

  static restore(serialized) {
    let state;
    try {
      state = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
    } catch {
      throw new RoomEngineError(
        "房间持久化状态无法读取。",
        500,
        "BAD_ROOM_STATE",
      );
    }
    validateSerializedState(state);
    state.moveCount ??= 0;
    state.positionEpoch ??= 1;
    state.scoreConfirmations ??= [];
    state.undoRequest ??= null;
    state.resignationOutcome ??= null;
    state.timeControl = persistedRoomTimeControl(state.timeControl);
    state.chatMessages = trimStoredChatHistory(state.chatMessages);
    const latestChatSequence = state.chatMessages.reduce(
      (latest, message) => Math.max(latest, message.sequence),
      0,
    );
    state.chatSequence = Number.isSafeInteger(state.chatSequence)
      ? Math.max(state.chatSequence, latestChatSequence)
      : latestChatSequence;
    state.chatBucket = restoredChatBucket(
      state.chatBucket,
      CHAT_ROOM_BURST,
      state.updatedAt,
    );
    state.spectatorCommandBucket = restoredChatBucket(
      state.spectatorCommandBucket,
      SPECTATOR_COMMAND_ROOM_BURST,
      state.updatedAt,
    );
    if (
      state.undoRequest &&
      !Object.prototype.hasOwnProperty.call(state.undoRequest, "requestRevision")
    ) {
      // A pending request persisted by the first undo-capable release did not
      // have its own identity token.  The current room revision is stable for
      // the lifetime of that legacy request and cannot collide with the next
      // request, whose token is assigned from the following commit revision.
      state.undoRequest.requestRevision = state.revision;
    }
    state.receipts = state.receipts.slice(-MAX_COMMAND_RECEIPTS);
    for (const member of state.members) {
      member.lastSequence ??= 0;
      member.chatBucket = restoredChatBucket(
        member.chatBucket,
        CHAT_MEMBER_BURST,
        state.updatedAt,
      );
      if (member.role === "spectator") {
        // Legacy spectators predate the reservation marker. Treat them as a
        // previously connected observer so an upgrade keeps the longer,
        // reconnect-friendly grace period instead of ejecting them at once.
        if (!Object.prototype.hasOwnProperty.call(member, "lastConnectedAt")) {
          member.lastConnectedAt = member.lastSeenAt ?? member.joinedAt;
        }
        if (
          member.lastConnectedAt !== null &&
          !Number.isFinite(member.lastConnectedAt)
        ) {
          member.lastConnectedAt = member.lastSeenAt ?? member.joinedAt;
        }
        member.spectatorCommandBucket = restoredChatBucket(
          member.spectatorCommandBucket,
          SPECTATOR_COMMAND_MEMBER_BURST,
          member.lastSeenAt ?? state.updatedAt,
        );
      }
    }
    const automatedPlayer = state.members.find(
      (member) => member.role === "player" && member.automated === true,
    );
    const blackController = state.members.find(
      (member) =>
        member.role === "player" &&
        member.automated !== true &&
        member.color === BLACK,
    );
    if (automatedPlayer && blackController) {
      // An older release can release and refill the black seat while retaining
      // the unknown automation metadata on white. The current black host owns
      // the browser-side controller after the room is upgraded again.
      automatedPlayer.controllerId = blackController.playerId;
    }
    const room = new RoomEngine(state, restoreGame(state.game));
    assertResignationPersistence(state, room.game);
    room.assertTimeControlConsistency();
    return room;
  }

  serialize() {
    return clone({ ...this.state, game: serializeGame(this.game) });
  }

  snapshot(nowInput) {
    const now = readNow(nowInput);
    this.assertAvailable(now);
    const players = this.state.members
      .filter((member) => member.role === "player")
      .sort((left, right) =>
        left.color === right.color ? 0 : left.color === BLACK ? -1 : 1,
      )
      .map((member) => ({
        id: member.playerId,
        name: member.name,
        role: member.automated === true ? "ai" : member.role,
        color: member.color,
        online: member.automated === true
          ? this.isOnline(member.controllerId)
          : this.isOnline(member.playerId),
        lastSeenAt: member.lastSeenAt,
        ...(member.automated === true
          ? {
              automated: true,
              modelId: member.modelId,
              controllerId: member.controllerId,
            }
          : {}),
      }));
    const spectators = this.state.members
      .filter((member) => member.role === "spectator")
      .sort(
        (left, right) =>
          left.joinedAt - right.joinedAt ||
          left.playerId.localeCompare(right.playerId),
      )
      .map((member) => ({
        id: member.playerId,
        name: member.name,
        role: member.role,
        color: null,
        online: this.isOnline(member.playerId),
        lastSeenAt: member.lastSeenAt,
      }));
    const timeControl = snapshotTimeControl(this.state.timeControl, now);
    const game = clone(this.game.getState());
    const resignationResult = publicResignationResult(
      this.state.resignationOutcome,
    );
    if (timeControl?.outcome) {
      game.phase = PHASE_FINISHED;
      game.result = {
        winner: timeControl.outcome.winner,
        loser: timeControl.outcome.loser,
        margin: 0,
        reason: "timeout",
        finishedAt: timeControl.outcome.finishedAt,
      };
    } else if (resignationResult) {
      game.phase = PHASE_FINISHED;
      game.result = resignationResult;
      game.currentPlayer = this.state.resignationOutcome.currentPlayer;
      game.consecutivePasses = this.state.resignationOutcome.consecutivePasses;
      game.lastMove = clone(this.state.resignationOutcome.lastMove);
    }
    game.moveCount = this.state.moveCount;
    const replay = snapshotReplay(this.game);
    if (timeControl?.outcome) {
      replay.outcome = clone(timeControl.outcome);
    } else if (resignationResult) {
      replay.events = replay.events.slice(
        0,
        this.state.resignationOutcome.replayEventCount,
      );
      replay.outcome = resignationResult;
    }
    return {
      code: this.state.code,
      revision: this.state.revision,
      version: this.state.revision,
      positionToken: positionToken(this.game, this.state),
      moveCount: this.state.moveCount,
      replay,
      undoAvailable:
        !timeControl?.outcome &&
        !resignationResult &&
        this.game.phase === PHASE_PLAY &&
        typeof this.game.canUndo === "function" &&
        this.game.canUndo(),
      scoreConfirmations: clone(this.state.scoreConfirmations),
      undoRequest: clone(this.state.undoRequest),
      timeControl,
      chat: {
        sequence: this.state.chatSequence,
        messages: clone(this.state.chatMessages),
      },
      game,
      players,
      spectators,
      updatedAt: this.state.updatedAt,
      expiresAt: this.state.expiresAt,
    };
  }

  identityFor(member) {
    return {
      code: this.state.code,
      playerId: member.playerId,
      playerName: member.name,
      name: member.name,
      role: member.role,
      color: member.color,
    };
  }

  join({ name, role, playerId, tokenHash, now: nowInput }) {
    const now = readNow(nowInput);
    this.prepare(now);
    const normalizedName = normalizeName(name);
    const normalizedRole = normalizeRole(role);
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedTokenHash = normalizeTokenHash(tokenHash);

    const existing = this.member(normalizedPlayerId);
    if (existing) {
      if (!constantTimeEqual(existing.tokenHash, normalizedTokenHash)) {
        throw new RoomEngineError(
          "这个玩家身份已经被使用。",
          409,
          "CONFLICT",
        );
      }
      return {
        changed: false,
        revision: this.state.revision,
        identity: this.identityFor(existing),
        room: this.snapshot(now),
      };
    }

    if (
      this.state.members.some((member) =>
        constantTimeEqual(member.tokenHash, normalizedTokenHash),
      )
    ) {
      throw new RoomEngineError(
        "这个身份凭据已经被使用。",
        409,
        "CONFLICT",
      );
    }

    let effectiveRole = normalizedRole;
    let color = null;
    if (effectiveRole === "player") {
      color = this.nextOpenColor();
      if (!color) {
        effectiveRole = "spectator";
      }
    }
    if (effectiveRole === "spectator" && this.spectatorCount() >= MAX_SPECTATORS) {
      // HTTP join reserves an identity before its WebSocket is established.
      // Reclaim abandoned reservations (and observers past their reconnect
      // grace) on demand so 32 never-connected requests cannot lock a room.
      this.evictExpiredSpectators(now);
    }
    if (effectiveRole === "spectator" && this.spectatorCount() >= MAX_SPECTATORS) {
      throw new RoomEngineError(
        "旁观席已经满了。",
        409,
        "SPECTATOR_FULL",
      );
    }

    const member = {
      playerId: normalizedPlayerId,
      name: normalizedName,
      tokenHash: normalizedTokenHash,
      role: effectiveRole,
      color,
      joinedAt: now,
      lastSeenAt: now,
      ...(effectiveRole === "spectator"
        ? {
            lastConnectedAt: null,
            spectatorCommandBucket: freshChatBucket(
              SPECTATOR_COMMAND_MEMBER_BURST,
              now,
            ),
          }
        : {}),
      lastSequence: 0,
      chatBucket: freshChatBucket(CHAT_MEMBER_BURST, now),
    };
    this.state.members.push(member);
    if (effectiveRole === "player" && color === BLACK) {
      const automatedPlayer = this.automatedPlayer();
      if (automatedPlayer) automatedPlayer.controllerId = member.playerId;
    }
    this.syncTimeControlRunning(now);
    this.commit(now);
    return {
      changed: true,
      revision: this.state.revision,
      identity: this.identityFor(member),
      room: this.snapshot(now),
    };
  }

  async authenticate({ playerId, token, now: nowInput }) {
    const now = readNow(nowInput);
    this.prepare(now);
    const member = this.requireMember(normalizePlayerId(playerId));
    const suppliedHash = await hashRoomToken(token);
    if (!constantTimeEqual(member.tokenHash, suppliedHash)) {
      throw new RoomEngineError(
        "房间身份已经失效，请重新加入。",
        401,
        "UNAUTHORIZED",
      );
    }
    this.touchMember(member, now);
    return this.identityFor(member);
  }

  async authenticateToken(token, nowInput) {
    const now = readNow(nowInput);
    this.prepare(now);
    const suppliedHash = await hashRoomToken(token);
    const member = this.state.members.find((candidate) =>
      constantTimeEqual(candidate.tokenHash, suppliedHash),
    );
    if (!member) {
      throw new RoomEngineError(
        "房间身份已经失效，请重新加入。",
        401,
        "UNAUTHORIZED",
      );
    }
    this.touchMember(member, now);
    return this.identityFor(member);
  }

  async connectByToken({ token, connectionId, now: nowInput }) {
    const now = readNow(nowInput);
    const identity = await this.authenticateToken(token, now);
    const normalizedConnectionId = normalizePlayerId(
      connectionId ?? crypto.randomUUID(),
    );
    this.connections.set(normalizedConnectionId, identity.playerId);
    const member = this.requireMember(identity.playerId);
    if (member.role === "spectator") member.lastConnectedAt = now;
    return {
      identity,
      connectionId: normalizedConnectionId,
      revision: this.state.revision,
      room: this.snapshot(now),
    };
  }

  resumeConnection(playerId, connectionId, nowInput) {
    const now = readNow(nowInput);
    // Durable Object hibernation restores sockets before rebuilding this
    // in-memory connection map. Do not run spectator eviction until those
    // known-live sockets have been reattached; the constructor advances the
    // room immediately after the restore loop.
    this.assertAvailable(now);
    const member = this.requireMember(normalizePlayerId(playerId));
    const normalizedConnectionId = normalizePlayerId(connectionId);
    this.connections.set(normalizedConnectionId, member.playerId);
    if (member.role === "spectator") {
      member.lastConnectedAt = now;
      member.lastSeenAt = now;
    }
    return this.identityFor(member);
  }

  disconnect({ connectionId, now: nowInput }) {
    const now = readNow(nowInput);
    const playerId = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    const member = playerId ? this.member(playerId) : null;
    if (
      member?.role === "spectator" &&
      !this.isOnline(member.playerId)
    ) {
      // Start the reconnect grace from the actual disconnect, rather than the
      // last command the observer happened to send while watching.
      member.lastSeenAt = now;
    }
    return {
      changed: false,
      revision: this.state.revision,
      room: this.snapshot(now),
    };
  }

  isConnectionActive(playerId, connectionId) {
    return this.connections.get(connectionId) === playerId;
  }

  leave({ playerId, now: nowInput }) {
    const now = readNow(nowInput);
    this.prepare(now);
    const member = this.requireMember(normalizePlayerId(playerId));
    if (member.role === "player") {
      this.state.scoreConfirmations = this.state.scoreConfirmations.filter(
        (color) => color !== member.color,
      );
      this.state.undoRequest = null;
    }
    this.state.members = this.state.members.filter(
      (candidate) => candidate.playerId !== member.playerId,
    );
    for (const [connectionId, connectedPlayerId] of this.connections) {
      if (connectedPlayerId === member.playerId) {
        this.connections.delete(connectionId);
      }
    }
    this.state.receipts = this.state.receipts.filter(
      (receipt) => receipt.playerId !== member.playerId,
    );
    this.syncTimeControlRunning(now);
    this.commit(now);
    return {
      changed: true,
      revision: this.state.revision,
      identity: this.identityFor(member),
      room: this.snapshot(now),
    };
  }

  postChat({
    playerId,
    payload = {},
    sequence,
    now: nowInput,
  }) {
    const now = readNow(nowInput);
    this.prepare(now);
    const member = this.requireMember(normalizePlayerId(playerId));
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new RoomEngineError(
        "聊天消息缺少有效序号。",
        400,
        "BAD_REQUEST",
      );
    }

    const memberSpend = spendChatToken(
      restoredChatBucket(
        member.chatBucket,
        CHAT_MEMBER_BURST,
        member.lastSeenAt,
      ),
      CHAT_MEMBER_BURST,
      CHAT_MEMBER_REFILL_MS,
      now,
    );
    if (!memberSpend.ok) {
      throw new RoomEngineError(
        "消息发送得太快了，请稍等一下。",
        429,
        "CHAT_RATE_LIMITED",
        true,
      );
    }
    // Every chat attempt consumes the same request budget, including invalid
    // payloads. This prevents malformed text and unknown stickers from
    // bypassing the storage-backed rate limit.
    member.chatBucket = memberSpend.bucket;
    this.requirePlayer(member);

    // Spectator abuse is charged only to that spectator's own bucket. The
    // shared room budget belongs to authorized players, so rejected spectator
    // traffic cannot silence the two people who are actually playing.
    const roomSpend = spendChatToken(
      restoredChatBucket(
        this.state.chatBucket,
        CHAT_ROOM_BURST,
        this.state.updatedAt,
      ),
      CHAT_ROOM_BURST,
      CHAT_ROOM_REFILL_MS,
      now,
    );
    if (!roomSpend.ok) {
      throw new RoomEngineError(
        "消息发送得太快了，请稍等一下。",
        429,
        "CHAT_RATE_LIMITED",
        true,
      );
    }
    this.state.chatBucket = roomSpend.bucket;

    let normalized;
    try {
      normalized = normalizeChatPayload(payload, {
        width: this.game.width,
        height: this.game.height,
        ...(this.game.size === undefined ? {} : { size: this.game.size }),
        topology: this.game.topology,
      });
    } catch (error) {
      if (error instanceof ChatValidationError) {
        throw new RoomEngineError(error.message, 400, error.code);
      }
      throw error;
    }

    const chatSequence = this.state.chatSequence + 1;
    const message = {
      id: `${member.playerId}:${sequence}`,
      sequence: chatSequence,
      senderId: member.playerId,
      senderName: member.name,
      senderRole: member.role,
      senderColor: member.color,
      kind: normalized.kind,
      ...(normalized.kind === "text"
        ? { text: normalized.text }
        : { stickerId: normalized.stickerId }),
      points: clone(normalized.points),
      boardWidth: normalized.boardWidth,
      boardHeight: normalized.boardHeight,
      ...(normalized.boardSize === undefined
        ? {}
        : { boardSize: normalized.boardSize }),
      boardTopology: normalized.boardTopology,
      moveCount: this.state.moveCount,
      sentAt: now,
    };

    this.state.chatSequence = chatSequence;
    this.state.chatMessages = trimStoredChatHistory([
      ...this.state.chatMessages,
      message,
    ]);
    this.touchMember(member, now);

    return {
      changed: true,
      revision: this.state.revision,
      chatSequence,
      message: clone(message),
    };
  }

  applyAction({ playerId, action, payload = {}, now: nowInput }) {
    const now = readNow(nowInput);
    this.prepare(now);
    const member = this.requireMember(normalizePlayerId(playerId));

    if (action === "sync") {
      return {
        changed: false,
        revision: this.state.revision,
        room: this.snapshot(now),
      };
    }
    if (action === "leave") return this.leave({ playerId, now });

    this.requirePlayer(member);
    const managesSeatsOrStartsGame =
      action === "attach_ai" || action === "detach_ai" || action === "new_game";
    if (this.state.resignationOutcome && !managesSeatsOrStartsGame) {
      throw new RoomEngineError(
        "本局已经因认输结束。",
        409,
        "GAME_FINISHED",
      );
    }
    if (this.state.timeControl?.outcome && !managesSeatsOrStartsGame) {
      const { loser, winner } = this.state.timeControl.outcome;
      throw new RoomEngineError(
        `${loser === BLACK ? "黑方" : "白方"}已经超时，${winner === BLACK ? "黑方" : "白方"}获胜。`,
        409,
        "GAME_TIMED_OUT",
      );
    }
    this.syncTimeControlRunning(now);
    let move;

    if (action === "attach_ai") {
      this.requireHost(member);
      const modelId = normalizeAIModelId(payload.modelId);
      const existingAutomated = this.automatedPlayer();
      if (!existingAutomated && this.nextOpenColor() !== WHITE) {
        throw new RoomEngineError(
          "白方座位已经有人，不能再接入 AI。",
          409,
          "AI_SEAT_UNAVAILABLE",
        );
      }
      if (existingAutomated) {
        const previousModelId = existingAutomated.modelId;
        existingAutomated.name = `KataGo ${modelId} AI`;
        existingAutomated.controllerId = member.playerId;
        existingAutomated.modelId = modelId;
        existingAutomated.lastSeenAt = now;
        move = {
          ok: true,
          type: "ai_updated",
          color: WHITE,
          modelId,
          previousModelId,
          controllerId: member.playerId,
        };
      } else {
        const automatedId = `${AUTOMATED_WHITE_ID_PREFIX}:${this.state.code}`;
        if (this.member(automatedId)) {
          throw new RoomEngineError(
            "AI 席位标识发生冲突。",
            409,
            "AI_SEAT_UNAVAILABLE",
          );
        }
        const automated = {
          playerId: automatedId,
          name: `KataGo ${modelId} AI`,
          tokenHash: AUTOMATED_TOKEN_HASH,
          role: "player",
          color: WHITE,
          automated: true,
          controllerId: member.playerId,
          modelId,
          joinedAt: now,
          lastSeenAt: now,
          lastSequence: 0,
          chatBucket: freshChatBucket(CHAT_MEMBER_BURST, now),
        };
        this.state.members.push(automated);
        move = {
          ok: true,
          type: "ai_attached",
          color: WHITE,
          modelId,
          controllerId: member.playerId,
        };
      }
    } else if (action === "detach_ai") {
      const automated = this.requireAutomatedPlayer(member);
      this.state.members = this.state.members.filter(
        (candidate) => candidate.playerId !== automated.playerId,
      );
      this.state.receipts = this.state.receipts.filter(
        (receipt) => receipt.playerId !== automated.playerId,
      );
      this.state.scoreConfirmations = this.state.scoreConfirmations.filter(
        (color) => color !== automated.color,
      );
      this.state.undoRequest = null;
      move = {
        ok: true,
        type: "ai_detached",
        color: automated.color,
        modelId: automated.modelId,
      };
    } else if (action === "play") {
      this.assertNoUndoRequest();
      this.requireBothPlayers();
      this.assertTurn(member);
      const row = validateCoordinate(payload.row, "行");
      const col = validateCoordinate(payload.col, "列");
      move = this.game.play(row, col);
    } else if (action === "pass") {
      this.assertNoUndoRequest();
      this.requireBothPlayers();
      this.assertTurn(member);
      move = this.game.pass();
    } else if (action === "ai_play") {
      this.assertNoUndoRequest();
      const automated = this.requireAutomatedPlayer(member);
      this.requireBothPlayers();
      this.assertFreshPosition(payload);
      this.assertAutomatedTurn(automated);
      const row = validateCoordinate(payload.row, "行");
      const col = validateCoordinate(payload.col, "列");
      move = this.game.play(row, col);
    } else if (action === "ai_pass") {
      this.assertNoUndoRequest();
      const automated = this.requireAutomatedPlayer(member);
      this.requireBothPlayers();
      this.assertFreshPosition(payload);
      this.assertAutomatedTurn(automated);
      move = this.game.pass();
    } else if (action === "direct_undo_ai_round") {
      this.assertNoUndoRequest();
      this.requireAutomatedPlayer(member);
      this.assertFreshPosition(payload);
      if (this.game.phase !== PHASE_PLAY) {
        throw new RoomEngineError(
          "只有对弈阶段可以撤回人机回合。",
          409,
          "UNDO_UNAVAILABLE",
        );
      }
      if (!this.game.canUndo()) {
        throw new RoomEngineError(
          "当前没有可以撤回的人机棋步。",
          409,
          "UNDO_UNAVAILABLE",
        );
      }

      const previousGame = serializeGame(this.game);
      const previousTimeControl = clone(this.state.timeControl);
      const previousMoveCount = this.state.moveCount;
      if (
        this.state.timeControl &&
        !this.state.timeControl.outcome &&
        this.state.timeControl.activeColor !== null
      ) {
        this.state.timeControl = pauseTimeControl(this.state.timeControl, now);
      }

      const undoneMoves = [];
      let humanDecisionUndone = false;
      while (this.game.canUndo()) {
        const undone = this.game.undo();
        if (!undone.ok) break;
        undoneMoves.push(undone.move);
        this.state.moveCount = Math.max(0, this.state.moveCount - 1);
        if (undone.move.color === member.color) {
          humanDecisionUndone = true;
          break;
        }
      }
      if (!humanDecisionUndone) {
        this.game = restoreGame(previousGame);
        this.state.timeControl = previousTimeControl;
        this.state.moveCount = previousMoveCount;
        throw new RoomEngineError(
          "没有找到可以撤回的人类决策。",
          409,
          "UNDO_UNAVAILABLE",
        );
      }
      move = {
        ok: true,
        type: "ai_round_undone",
        color: member.color,
        undoneCount: undoneMoves.length,
        undoneMoves: clone(undoneMoves),
        currentPlayer: this.game.currentPlayer,
        phase: this.game.phase,
      };
    } else if (action === "resign") {
      this.requireBothPlayers();
      if (this.game.phase !== PHASE_PLAY) {
        throw new RoomEngineError(
          "只有对弈阶段可以认输。",
          409,
          "ILLEGAL_MOVE",
        );
      }
      const replayEventCount = snapshotReplay(this.game).events.length;
      const lastMove = clone(this.game.lastMove);
      const currentPlayer = this.game.currentPlayer;
      const consecutivePasses = this.game.consecutivePasses;
      const loser = member.color;
      const winner = loser === BLACK ? WHITE : BLACK;
      while (this.game.phase === PHASE_PLAY) {
        const pass = this.game.pass();
        if (!pass.ok) break;
      }
      const compatibleFinish = this.game.finishScoring();
      if (!compatibleFinish.ok) {
        throw new RoomEngineError(
          "当前无法记录认输结果。",
          409,
          "ILLEGAL_MOVE",
        );
      }
      const terminalFingerprint = compatibleTerminalFingerprint(this.game);
      this.state.resignationOutcome = {
        winner,
        loser,
        reason: "resign",
        resignation: true,
        currentPlayer,
        consecutivePasses,
        finishedAt: now,
        replayEventCount,
        lastMove,
        terminalFingerprint,
        roomRevision: this.state.revision + 1,
      };
      move = {
        ok: true,
        type: "resign",
        color: loser,
        ...publicResignationResult(this.state.resignationOutcome),
        phase: PHASE_FINISHED,
      };
    } else if (action === "toggle_dead") {
      const row = validateCoordinate(payload.row, "行");
      const col = validateCoordinate(payload.col, "列");
      move = this.game.toggleDead(row, col);
    } else if (action === "finish_scoring") {
      if (this.game.phase !== PHASE_SCORING) {
        move = this.game.finishScoring();
      } else {
        if (!this.state.scoreConfirmations.includes(member.color)) {
          this.state.scoreConfirmations.push(member.color);
        }
        const automated = this.automatedPlayer();
        if (
          automated &&
          automated.controllerId === member.playerId &&
          !this.state.scoreConfirmations.includes(automated.color)
        ) {
          // There is no remote AI process to click a confirmation button. The
          // human controller's single confirmation represents both local
          // seats, matching local human-vs-AI scoring and avoiding deadlock.
          this.state.scoreConfirmations.push(automated.color);
        }
        const bothPlayersConfirmed = [BLACK, WHITE].every((color) =>
          this.state.scoreConfirmations.includes(color),
        );
        if (bothPlayersConfirmed) {
          move = {
            ...this.game.finishScoring(),
            type: "finish_scoring",
            color: member.color,
            scoreConfirmations: clone(this.state.scoreConfirmations),
          };
        } else {
          move = {
            ok: true,
            type: "score_confirmation",
            phase: this.game.phase,
            color: member.color,
            scoreConfirmations: clone(this.state.scoreConfirmations),
          };
        }
      }
    } else if (action === "resume_play") {
      move = this.game.resumePlay(this.game.currentPlayer);
    } else if (action === "request_undo") {
      this.requireBothPlayers();
      if (this.automatedPlayer()) {
        throw new RoomEngineError(
          "AI 对局请直接撤回上一轮，不需要发送申请。",
          409,
          "AI_UNDO_IS_DIRECT",
        );
      }
      if (
        !Number.isSafeInteger(payload.expectedMoveCount) ||
        payload.expectedMoveCount !== this.state.moveCount
      ) {
        throw new RoomEngineError(
          "棋局已发生变化，请同步后重新申请悔棋。",
          409,
          "STALE_GAME_STATE",
        );
      }
      if (this.game.phase !== PHASE_PLAY) {
        throw new RoomEngineError(
          "只有对弈阶段才能申请悔棋。",
          409,
          "UNDO_UNAVAILABLE",
        );
      }
      if (this.state.undoRequest) {
        throw new RoomEngineError(
          "当前已有一份悔棋申请等待处理。",
          409,
          "UNDO_PENDING",
        );
      }
      if (
        this.state.moveCount < 1 ||
        typeof this.game.canUndo !== "function" ||
        !this.game.canUndo()
      ) {
        throw new RoomEngineError(
          "当前没有可以撤回的棋步。",
          409,
          "UNDO_UNAVAILABLE",
        );
      }
      this.state.undoRequest = {
        requesterId: member.playerId,
        requesterRole: member.role,
        requesterColor: member.color,
        targetMoveCount: this.state.moveCount,
        requestRevision: this.state.revision + 1,
        requestedAt: now,
      };
      move = {
        ok: true,
        type: "undo_requested",
        undoRequest: clone(this.state.undoRequest),
      };
    } else if (action === "respond_undo") {
      const request = this.requireCurrentUndoRequest(
        payload.targetMoveCount,
        payload.requestRevision,
      );
      if (member.playerId === request.requesterId) {
        throw new RoomEngineError(
          "只有另一位棋手可以回应这份悔棋申请。",
          403,
          "FORBIDDEN",
        );
      }
      if (typeof payload.accept !== "boolean") {
        throw new RoomEngineError(
          "请选择同意或拒绝这份悔棋申请。",
          400,
          "BAD_REQUEST",
        );
      }
      if (payload.accept) {
        if (
          this.state.moveCount !== request.targetMoveCount ||
          typeof this.game.canUndo !== "function" ||
          !this.game.canUndo()
        ) {
          throw new RoomEngineError(
            "这份悔棋申请已经过期。",
            409,
            "STALE_UNDO_REQUEST",
          );
        }
        const undoResult = this.game.undo();
        if (!undoResult?.ok) {
          throw new RoomEngineError(
            "当前无法撤回最后一手。",
            409,
            "UNDO_UNAVAILABLE",
          );
        }
        this.state.moveCount -= 1;
        this.state.undoRequest = null;
        move = {
          ...clone(undoResult),
          ok: true,
          type: "undo_accepted",
          requesterId: request.requesterId,
          requesterColor: request.requesterColor,
          responderId: member.playerId,
          targetMoveCount: request.targetMoveCount,
          requestRevision: request.requestRevision,
        };
      } else {
        this.state.undoRequest = null;
        move = {
          ok: true,
          type: "undo_declined",
          requesterId: request.requesterId,
          requesterColor: request.requesterColor,
          responderId: member.playerId,
          targetMoveCount: request.targetMoveCount,
          requestRevision: request.requestRevision,
        };
      }
    } else if (action === "cancel_undo") {
      const request = this.requireCurrentUndoRequest(
        payload.targetMoveCount,
        payload.requestRevision,
      );
      if (member.playerId !== request.requesterId) {
        throw new RoomEngineError(
          "只有申请者可以取消这份悔棋申请。",
          403,
          "FORBIDDEN",
        );
      }
      this.state.undoRequest = null;
      move = {
        ok: true,
        type: "undo_cancelled",
        requesterId: request.requesterId,
        requesterColor: request.requesterColor,
        targetMoveCount: request.targetMoveCount,
        requestRevision: request.requestRevision,
      };
    } else if (action === "new_game") {
      if (member.color !== BLACK) {
        throw new RoomEngineError(
          "只有黑方可以开始新的一局。",
          403,
          "FORBIDDEN",
        );
      }
      const requestedWidth = normalizeDimension(
        payload.width ?? payload.size ?? this.game.width,
        "棋盘宽度",
      );
      const requestedHeight = normalizeDimension(
        payload.height ?? payload.size ?? this.game.height,
        "棋盘高度",
      );
      const previousTimeControl = timeControlConfig(this.state.timeControl);
      const requestedTimeControl = roomTimeControlConfig({
        mainTimeSeconds:
          payload.mainTimeSeconds ?? previousTimeControl?.mainTimeSeconds ?? 0,
        byoYomiPeriods:
          payload.byoYomiPeriods ?? previousTimeControl?.byoYomiPeriods ?? 0,
        byoYomiSeconds:
          payload.byoYomiSeconds ?? previousTimeControl?.byoYomiSeconds ?? 0,
      });
      const newGame = new GoEngine({
        ...(requestedWidth === requestedHeight ? { size: requestedWidth } : {}),
        width: requestedWidth,
        height: requestedHeight,
        komi: normalizeKomi(payload.komi ?? this.game.komi),
        scoringRule: normalizeScoringRule(
          payload.scoringRule ?? this.game.scoringRule,
        ),
        topology: normalizeTopology(
          payload.topology ?? this.game.topology ?? TOPOLOGY_CYLINDER,
        ),
      });
      this.game = newGame;
      this.state.resignationOutcome = null;
      this.state.timeControl = freshRoomTimeControl(requestedTimeControl, now);
      this.state.moveCount = 0;
      this.state.undoRequest = null;
      move = { ok: true, type: "new_game", phase: PHASE_PLAY };
    } else {
      throw new RoomEngineError("无法识别这条命令。", 400, "BAD_REQUEST");
    }

    if (!move?.ok) {
      const reason = move?.reason ?? "illegal_move";
      throw new RoomEngineError(
        GAME_ERROR_MESSAGES[reason] ?? "这一步不合法。",
        409,
        "ILLEGAL_MOVE",
      );
    }

    const invalidatesAIPosition =
      action === "play" ||
      action === "pass" ||
      action === "ai_play" ||
      action === "ai_pass" ||
      action === "attach_ai" ||
      action === "detach_ai" ||
      action === "direct_undo_ai_round" ||
      action === "resign" ||
      action === "toggle_dead" ||
      action === "finish_scoring" ||
      action === "resume_play" ||
      action === "new_game" ||
      (action === "respond_undo" && move.type === "undo_accepted");

    this.updateTimeControlAfterAction(action, now);

    if (
      action === "play" ||
      action === "pass" ||
      action === "ai_play" ||
      action === "ai_pass" ||
      action === "direct_undo_ai_round" ||
      action === "resign" ||
      action === "toggle_dead" ||
      action === "resume_play" ||
      action === "new_game"
    ) {
      this.state.scoreConfirmations = [];
    }

    if (
      action === "direct_undo_ai_round" ||
      action === "resign" ||
      action === "resume_play" ||
      action === "new_game"
    ) {
      this.state.undoRequest = null;
    }

    if (
      action === "play" ||
      action === "pass" ||
      action === "ai_play" ||
      action === "ai_pass"
    ) {
      this.state.moveCount += 1;
    }

    if (invalidatesAIPosition) this.bumpPositionEpoch();
    member.lastSeenAt = now;
    this.commit(now);
    return {
      changed: true,
      revision: this.state.revision,
      move: clone(move),
      room: this.snapshot(now),
    };
  }

  inspectCommand(playerId, id, sequence = null) {
    const member = this.requireMember(normalizePlayerId(playerId));
    if (typeof id !== "string" || !id || id.length > 128) {
      throw new RoomEngineError("命令编号无效。", 400, "BAD_REQUEST");
    }
    if (
      sequence !== null &&
      (!Number.isSafeInteger(sequence) || sequence <= 0)
    ) {
      throw new RoomEngineError("命令序号无效。", 400, "BAD_REQUEST");
    }
    const receipt = this.state.receipts.find(
      (candidate) => candidate.playerId === member.playerId && candidate.id === id,
    );
    if (receipt) return { kind: "duplicate", receipt: clone(receipt) };
    if (sequence !== null && sequence <= member.lastSequence) {
      return { kind: "stale", previousSequence: member.lastSequence };
    }
    return { kind: "new", previousSequence: member.lastSequence };
  }

  enforceSpectatorCommandRateLimit({ playerId, action, now: nowInput }) {
    const now = readNow(nowInput);
    const member = this.requireMember(normalizePlayerId(playerId));
    if (member.role !== "spectator" || action === "leave") return;

    const memberSpend = spendChatToken(
      restoredChatBucket(
        member.spectatorCommandBucket,
        SPECTATOR_COMMAND_MEMBER_BURST,
        member.lastSeenAt ?? now,
      ),
      SPECTATOR_COMMAND_MEMBER_BURST,
      SPECTATOR_COMMAND_MEMBER_REFILL_MS,
      now,
    );
    const roomSpend = spendChatToken(
      restoredChatBucket(
        this.state.spectatorCommandBucket,
        SPECTATOR_COMMAND_ROOM_BURST,
        this.state.updatedAt,
      ),
      SPECTATOR_COMMAND_ROOM_BURST,
      SPECTATOR_COMMAND_ROOM_REFILL_MS,
      now,
    );
    if (!memberSpend.ok || !roomSpend.ok) {
      throw new RoomEngineError(
        "观战同步请求过于频繁，请稍后再试。",
        429,
        "SPECTATOR_RATE_LIMITED",
        true,
      );
    }

    // Commit both buckets together only after both checks pass. Rejected
    // requests therefore need no storage write and cannot consume a partial
    // room/member budget.
    member.spectatorCommandBucket = memberSpend.bucket;
    this.state.spectatorCommandBucket = roomSpend.bucket;
  }

  recordCommand({ playerId, id, sequence = null, now: nowInput, error }) {
    const now = readNow(nowInput);
    const decision = this.inspectCommand(playerId, id, sequence);
    if (decision.kind === "duplicate") return decision.receipt;
    if (decision.kind === "stale") {
      throw new RoomEngineError("这条命令已经过期。", 409, "STALE_COMMAND");
    }
    const member = this.requireMember(playerId);
    if (sequence !== null) member.lastSequence = sequence;
    const receipt = {
      playerId: member.playerId,
      id,
      sequence,
      revision: this.state.revision,
      createdAt: now,
      ok: error === undefined,
      ...(error ? { error: clone(error) } : {}),
    };
    this.state.receipts.push(receipt);
    this.state.receipts = this.state.receipts.slice(-MAX_COMMAND_RECEIPTS);
    return clone(receipt);
  }

  advance(nowInput) {
    const now = readNow(nowInput);
    if (this.state.expiredAt !== null) {
      return {
        changed: false,
        expired: true,
        revision: this.state.revision,
        room: null,
        nextDueAt: null,
      };
    }
    if (now >= this.state.expiresAt) {
      this.state.expiredAt = now;
      this.state.updatedAt = now;
      this.incrementRevision();
      return {
        changed: true,
        expired: true,
        revision: this.state.revision,
        room: null,
        nextDueAt: null,
      };
    }
    const evictedSpectators = this.evictExpiredSpectators(now);
    const advancedClock = advanceTimeControl(this.state.timeControl, now);
    if (
      advancedClock?.outcome &&
      !this.state.timeControl?.outcome
    ) {
      this.state.timeControl = advancedClock;
      this.state.undoRequest = null;
      this.state.scoreConfirmations = [];
      this.commit(now);
      return {
        changed: true,
        expired: false,
        timedOut: true,
        revision: this.state.revision,
        room: this.snapshot(now),
        nextDueAt: this.nextDueAt(),
      };
    }
    if (evictedSpectators > 0) {
      // Membership maintenance gets a revision so clients can order the new
      // presence snapshot, but it is not user activity and must not prolong
      // the room's 24-hour TTL.
      this.incrementRevision();
      this.state.updatedAt = now;
      return {
        changed: true,
        expired: false,
        evictedSpectators,
        revision: this.state.revision,
        room: this.snapshot(now),
        nextDueAt: this.nextDueAt(),
      };
    }
    return {
      changed: false,
      expired: false,
      revision: this.state.revision,
      room: this.snapshot(now),
      nextDueAt: this.nextDueAt(),
    };
  }

  timeControlDueAt() {
    return nextTimeControlDueAt(this.state.timeControl);
  }

  nextDueAt() {
    if (this.state.expiredAt !== null) return null;
    const clockDueAt = this.timeControlDueAt();
    const spectatorDueAt = this.nextSpectatorCleanupDueAt();
    return Math.min(
      this.state.expiresAt,
      clockDueAt ?? Number.POSITIVE_INFINITY,
      spectatorDueAt ?? Number.POSITIVE_INFINITY,
    );
  }

  member(playerId) {
    return this.state.members.find(
      (candidate) => candidate.playerId === playerId,
    );
  }

  automatedPlayer() {
    return this.state.members.find(
      (member) => member.role === "player" && member.automated === true,
    ) ?? null;
  }

  hostPlayer() {
    return this.state.members.find(
      (member) =>
        member.role === "player" &&
        member.automated !== true &&
        member.color === BLACK,
    ) ?? null;
  }

  requireMember(playerId) {
    const member = this.member(playerId);
    if (!member) {
      throw new RoomEngineError(
        "房间身份已经失效，请重新加入。",
        401,
        "UNAUTHORIZED",
      );
    }
    return member;
  }

  requirePlayer(member) {
    if (
      member.role !== "player" ||
      member.automated === true ||
      !VALID_COLORS.has(member.color)
    ) {
      throw new RoomEngineError(
        "旁观者不能操作棋局。",
        403,
        "FORBIDDEN",
      );
    }
  }

  requireHost(member) {
    this.requirePlayer(member);
    if (member.color !== BLACK || this.hostPlayer()?.playerId !== member.playerId) {
      throw new RoomEngineError(
        "只有黑方房主可以管理 AI 对手。",
        403,
        "FORBIDDEN",
      );
    }
  }

  requireAutomatedPlayer(member) {
    this.requireHost(member);
    const automated = this.automatedPlayer();
    if (!automated || automated.controllerId !== member.playerId) {
      throw new RoomEngineError(
        "当前房间没有由你控制的 AI 对手。",
        409,
        "AI_NOT_ATTACHED",
      );
    }
    return automated;
  }

  assertFreshPosition(payload) {
    if (
      !Number.isSafeInteger(payload.expectedMoveCount) ||
      payload.expectedMoveCount !== this.state.moveCount ||
      typeof payload.expectedPositionToken !== "string" ||
      payload.expectedPositionToken !== positionToken(this.game, this.state)
    ) {
      throw new RoomEngineError(
        "AI 思考期间棋局已经变化，请按最新局面重新计算。",
        409,
        "STALE_GAME_STATE",
      );
    }
  }

  assertAutomatedTurn(automated) {
    if (
      this.game.phase !== PHASE_PLAY ||
      this.game.currentPlayer !== automated.color
    ) {
      throw new RoomEngineError(
        "当前不是 AI 的回合。",
        409,
        "NOT_AI_TURN",
      );
    }
  }

  requireBothPlayers() {
    const colors = new Set(
      this.state.members
        .filter((member) => member.role === "player")
        .map((member) => member.color),
    );
    if (!colors.has(BLACK) || !colors.has(WHITE)) {
      throw new RoomEngineError(
        "请等待黑白双方都加入房间后再开始对局。",
        409,
        "WAITING_FOR_OPPONENT",
      );
    }
  }

  hasBothPlayers() {
    const colors = new Set(
      this.state.members
        .filter((member) => member.role === "player")
        .map((member) => member.color),
    );
    return colors.has(BLACK) && colors.has(WHITE);
  }

  shouldTimeControlRun() {
    return Boolean(
      this.state.timeControl &&
      !this.state.timeControl.outcome &&
      this.game.phase === PHASE_PLAY &&
      this.hasBothPlayers() &&
      !this.state.undoRequest,
    );
  }

  syncTimeControlRunning(now) {
    const clock = this.state.timeControl;
    if (!clock || clock.outcome) return;
    if (!this.shouldTimeControlRun()) {
      if (clock.activeColor !== null) {
        this.state.timeControl = pauseTimeControl(clock, now);
      }
      return;
    }
    if (clock.activeColor === null) {
      this.state.timeControl = startTimeControl(clock, this.game.currentPlayer, now);
      return;
    }
    if (clock.activeColor !== this.game.currentPlayer) {
      throw new RoomEngineError(
        "计时方与当前行棋方不一致。",
        500,
        "BAD_ROOM_STATE",
      );
    }
  }

  updateTimeControlAfterAction(action, now) {
    if (!this.state.timeControl) return;
    if (
      action === "play" ||
      action === "pass" ||
      action === "ai_play" ||
      action === "ai_pass"
    ) {
      const nextColor = this.shouldTimeControlRun()
        ? this.game.currentPlayer
        : null;
      this.state.timeControl = completeTimeControlTurn(
        this.state.timeControl,
        now,
        nextColor,
      );
      return;
    }
    this.syncTimeControlRunning(now);
  }

  assertTimeControlConsistency() {
    const clock = this.state.timeControl;
    if (!clock) return;
    const shouldRun = this.shouldTimeControlRun();
    const invalidOutcome = clock.outcome && this.game.phase !== PHASE_PLAY;
    const invalidActive =
      (clock.activeColor !== null &&
        (!shouldRun || clock.activeColor !== this.game.currentPlayer)) ||
      (clock.activeColor === null && shouldRun);
    if (invalidOutcome || invalidActive) {
      throw new RoomEngineError(
        "持久化计时状态与棋局不一致。",
        500,
        "BAD_ROOM_STATE",
      );
    }
  }

  assertTurn(member) {
    if (this.game.phase === PHASE_PLAY && this.game.currentPlayer !== member.color) {
      throw new RoomEngineError(
        "还没有轮到你落子。",
        409,
        "NOT_YOUR_TURN",
      );
    }
  }

  assertNoUndoRequest() {
    if (this.state.undoRequest) {
      throw new RoomEngineError(
        "请先处理当前的悔棋申请，再继续下棋。",
        409,
        "UNDO_PENDING",
      );
    }
  }

  requireCurrentUndoRequest(targetMoveCount, requestRevision) {
    const request = this.state.undoRequest;
    if (!request) {
      throw new RoomEngineError(
        "这份悔棋申请已经过期。",
        409,
        "STALE_UNDO_REQUEST",
      );
    }
    if (
      !Number.isSafeInteger(targetMoveCount) ||
      targetMoveCount !== request.targetMoveCount ||
      !Number.isSafeInteger(requestRevision) ||
      requestRevision !== request.requestRevision ||
      this.state.moveCount !== request.targetMoveCount
    ) {
      throw new RoomEngineError(
        "这份悔棋申请已经过期。",
        409,
        "STALE_UNDO_REQUEST",
      );
    }
    return clone(request);
  }

  nextOpenColor() {
    const occupied = new Set(
      this.state.members
        .filter((member) => member.role === "player")
        .map((member) => member.color),
    );
    if (!occupied.has(BLACK)) return BLACK;
    if (!occupied.has(WHITE)) return WHITE;
    return null;
  }

  spectatorCount() {
    return this.state.members.filter((member) => member.role === "spectator")
      .length;
  }

  spectatorExpiryAt(member) {
    if (member.role !== "spectator" || this.isOnline(member.playerId)) return null;
    if (Number.isFinite(member.lastConnectedAt)) {
      return (member.lastSeenAt ?? member.lastConnectedAt) +
        SPECTATOR_RECONNECT_GRACE_MS;
    }
    return member.joinedAt + SPECTATOR_RESERVATION_TTL_MS;
  }

  nextSpectatorCleanupDueAt() {
    let dueAt = null;
    for (const member of this.state.members) {
      const candidate = this.spectatorExpiryAt(member);
      if (candidate !== null && (dueAt === null || candidate < dueAt)) {
        dueAt = candidate;
      }
    }
    return dueAt;
  }

  evictExpiredSpectators(now) {
    const evictedIds = new Set(
      this.state.members
        .filter((member) => {
          const expiresAt = this.spectatorExpiryAt(member);
          return expiresAt !== null && now >= expiresAt;
        })
        .map((member) => member.playerId),
    );
    if (evictedIds.size === 0) return 0;

    this.state.members = this.state.members.filter(
      (member) => !evictedIds.has(member.playerId),
    );
    this.state.receipts = this.state.receipts.filter(
      (receipt) => !evictedIds.has(receipt.playerId),
    );
    for (const [connectionId, playerId] of this.connections) {
      if (evictedIds.has(playerId)) this.connections.delete(connectionId);
    }
    return evictedIds.size;
  }

  isOnline(playerId) {
    for (const connectedPlayerId of this.connections.values()) {
      if (connectedPlayerId === playerId) return true;
    }
    return false;
  }

  touchMember(member, now) {
    member.lastSeenAt = now;
    this.state.updatedAt = now;
    this.state.expiresAt = now + ROOM_TTL_MS;
  }

  bumpPositionEpoch() {
    if (this.state.positionEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new RoomEngineError(
        "棋局版本已经超出安全范围。",
        500,
        "BAD_ROOM_STATE",
      );
    }
    this.state.positionEpoch += 1;
  }

  incrementRevision() {
    const nextRevision = this.state.revision + 1;
    if (this.state.resignationOutcome) {
      this.state.resignationOutcome.roomRevision = nextRevision;
    }
    this.state.revision = nextRevision;
  }

  commit(now) {
    this.incrementRevision();
    this.state.updatedAt = now;
    this.state.expiresAt = now + ROOM_TTL_MS;
  }

  prepare(now) {
    if (this.advance(now).expired) {
      throw new RoomEngineError(
        "没有找到这个房间，可能已经过期了。",
        404,
        "ROOM_NOT_FOUND",
      );
    }
  }

  assertAvailable(now) {
    if (this.state.expiredAt !== null || now >= this.state.expiresAt) {
      throw new RoomEngineError(
        "没有找到这个房间，可能已经过期了。",
        404,
        "ROOM_NOT_FOUND",
      );
    }
  }
}

export function createRoomEngine(input) {
  return RoomEngine.create(input);
}

export function restoreRoomEngine(serialized) {
  return RoomEngine.restore(serialized);
}

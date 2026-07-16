import {
  BLACK,
  GoEngine,
  PHASE_PLAY,
  PHASE_SCORING,
  WHITE,
} from "../game/goEngine.js";
import { isRoomCode, isRoomRole } from "./protocol.js";

export const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_SPECTATORS = 32;
export const MAX_COMMAND_RECEIPTS = 256;

const SERIALIZED_SCHEMA_VERSION = 1;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_SCORING_RULES = new Set(["japanese", "chinese"]);

const GAME_ERROR_MESSAGES = Object.freeze({
  game_not_playing: "当前阶段不能落子或停一手。",
  out_of_bounds: "这个位置不在棋盘上。",
  occupied: "这个位置已经有棋子了。",
  suicide: "这一步会造成自杀，不能落子。",
  superko: "这一步违反全局同形规则。",
  game_not_scoring: "当前还没有进入点目阶段。",
  empty_point: "空点不能标记为死子。",
});

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

function normalizeSize(value) {
  const size = value ?? 19;
  if (!Number.isInteger(size) || size < 3 || size > 25) {
    throw new RoomEngineError(
      "棋盘大小必须是 3 到 25 之间的整数。",
      400,
      "BAD_REQUEST",
    );
  }
  return size;
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

function restoreGame(value) {
  const snapshot = typeof value === "string" ? JSON.parse(value) : clone(value);
  if (!snapshot || typeof snapshot !== "object") {
    throw new RoomEngineError(
      "持久化棋局无法读取。",
      500,
      "BAD_ROOM_STATE",
    );
  }

  if (typeof GoEngine.fromState === "function") {
    return GoEngine.fromState(snapshot);
  }

  const game = new GoEngine({
    size: snapshot.size,
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

function validateSerializedState(state) {
  if (
    !state ||
    state.schemaVersion !== SERIALIZED_SCHEMA_VERSION ||
    !isRoomCode(state.code) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    (state.moveCount !== undefined &&
      (!Number.isSafeInteger(state.moveCount) || state.moveCount < 0)) ||
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
    size = 19,
    komi = 6.5,
    scoringRule = "japanese",
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
    const game = new GoEngine({
      size: normalizeSize(size),
      komi: normalizeKomi(komi),
      scoringRule: normalizeScoringRule(scoringRule),
    });
    const state = {
      schemaVersion: SERIALIZED_SCHEMA_VERSION,
      code,
      revision: 1,
      moveCount: 0,
      scoreConfirmations: [],
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
    state.scoreConfirmations ??= [];
    state.receipts = state.receipts.slice(-MAX_COMMAND_RECEIPTS);
    for (const member of state.members) member.lastSequence ??= 0;
    return new RoomEngine(state, restoreGame(state.game));
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
        role: member.role,
        color: member.color,
        online: this.isOnline(member.playerId),
        lastSeenAt: member.lastSeenAt,
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
    const game = clone(this.game.getState());
    game.moveCount = this.state.moveCount;
    return {
      code: this.state.code,
      revision: this.state.revision,
      version: this.state.revision,
      moveCount: this.state.moveCount,
      scoreConfirmations: clone(this.state.scoreConfirmations),
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
      lastSequence: 0,
    };
    this.state.members.push(member);
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
    return {
      identity,
      connectionId: normalizedConnectionId,
      revision: this.state.revision,
      room: this.snapshot(now),
    };
  }

  resumeConnection(playerId, connectionId, nowInput) {
    const now = readNow(nowInput);
    this.prepare(now);
    const member = this.requireMember(normalizePlayerId(playerId));
    const normalizedConnectionId = normalizePlayerId(connectionId);
    this.connections.set(normalizedConnectionId, member.playerId);
    return this.identityFor(member);
  }

  disconnect({ connectionId, now: nowInput }) {
    const now = readNow(nowInput);
    this.connections.delete(connectionId);
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
    this.commit(now);
    return {
      changed: true,
      revision: this.state.revision,
      identity: this.identityFor(member),
      room: this.snapshot(now),
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
    let move;

    if (action === "play") {
      this.requireBothPlayers();
      this.assertTurn(member);
      const row = validateCoordinate(payload.row, "行");
      const col = validateCoordinate(payload.col, "列");
      move = this.game.play(row, col);
    } else if (action === "pass") {
      this.requireBothPlayers();
      this.assertTurn(member);
      move = this.game.pass();
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
    } else if (action === "new_game") {
      if (member.color !== BLACK) {
        throw new RoomEngineError(
          "只有黑方可以开始新的一局。",
          403,
          "FORBIDDEN",
        );
      }
      this.game = new GoEngine({
        size: normalizeSize(payload.size ?? this.game.size),
        komi: normalizeKomi(payload.komi ?? this.game.komi),
        scoringRule: normalizeScoringRule(
          payload.scoringRule ?? this.game.scoringRule,
        ),
      });
      this.state.moveCount = 0;
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

    if (
      action === "play" ||
      action === "pass" ||
      action === "toggle_dead" ||
      action === "resume_play" ||
      action === "new_game"
    ) {
      this.state.scoreConfirmations = [];
    }

    if (action === "play" || action === "pass") {
      this.state.moveCount += 1;
    }

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
      this.state.revision += 1;
      return {
        changed: true,
        expired: true,
        revision: this.state.revision,
        room: null,
        nextDueAt: null,
      };
    }
    return {
      changed: false,
      expired: false,
      revision: this.state.revision,
      room: this.snapshot(now),
      nextDueAt: this.state.expiresAt,
    };
  }

  nextDueAt() {
    return this.state.expiredAt === null ? this.state.expiresAt : null;
  }

  member(playerId) {
    return this.state.members.find(
      (candidate) => candidate.playerId === playerId,
    );
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
    if (member.role !== "player" || !VALID_COLORS.has(member.color)) {
      throw new RoomEngineError(
        "旁观者不能操作棋局。",
        403,
        "FORBIDDEN",
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

  assertTurn(member) {
    if (this.game.phase === PHASE_PLAY && this.game.currentPlayer !== member.color) {
      throw new RoomEngineError(
        "还没有轮到你落子。",
        409,
        "NOT_YOUR_TURN",
      );
    }
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

  commit(now) {
    this.state.revision += 1;
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

import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
  isRecord,
  makeAckMessage,
  makeChatMessage,
  makeErrorMessage,
  makePresenceMessage,
  makeStateMessage,
  normalizeCommandMessage,
  parseWebSocketProtocols,
} from "../src/multiplayer/protocol.js";
import {
  MATCH_STATUS_PLAYING,
  RoomEngine,
  RoomEngineError,
  memberHasToken,
} from "../src/multiplayer/roomEngine.js";
import { CHAT_CHANNEL_SPECTATORS } from "../src/multiplayer/chat.js";
import { GAME_GO } from "../src/game/gameTypes.js";
import { lobbySummaryFromRoom } from "../src/multiplayer/lobby.js";
import { STORAGE_KEY, loadRoomSnapshot, saveRoomSnapshot } from "./roomStorage.js";
import { onlineRoundRecord, saveRecord } from "./records.js";

/**
 * The account behind a WebSocket request, set by the Worker from the
 * caller's session (and removed from anything a client sends), and the
 * guests that account was before (comma-separated): a seat taken as a
 * guest is still theirs.
 */
export const SESSION_USER_HEADER = "X-Topology-Session-User";
export const SESSION_FORMER_USERS_HEADER = "X-Topology-Session-Former-Users";

// The lobby mirrors the room's expiry. Refresh an otherwise unchanged entry
// once the room's TTL has slid this far past the last published one.
export const LOBBY_EXPIRY_REFRESH_MS = 30 * 60 * 1_000;
// Reconnecting sockets only refresh presence and TTL, so record a member's
// connection at most once per interval (a reservation's first connection
// is always recorded).
export const CONNECTION_WRITE_INTERVAL_MS = 60 * 1_000;
const MAX_SOCKET_CONNECTIONS = 64;
// Pages ping every 10 s (answered without waking the room); a background
// tab throttled to one timer a minute pings about once a minute. A member
// socket silent for longer than this lost its network. The room checks only
// while a game is being played (where presence decides abandonment and the
// opponent's view), once a minute: every check is a billed request and an
// alarm write, which the free plan counts per day.
const SILENT_SOCKET_MS = 90_000;
const SOCKET_SWEEP_MS = 60_000;
const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
const POSITION_BOUND_ACTIONS = new Set([
  "play",
  "pass",
  "resign",
  "toggle_dead",
  "resume_play",
  "request_undo",
]);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function defaultAttachment() {
  return {
    connectionId: crypto.randomUUID(),
    identity: null,
    connectedAt: Date.now(),
    offlineSince: {},
  };
}

// Players whose disconnect times a socket attachment remembers.
const MAX_OFFLINE_ENTRIES = 8;

function offlineEntries(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([playerId, at]) => playerId.length <= 128 && Number.isFinite(at))
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_OFFLINE_ENTRIES));
}

export class BadukRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.engine = null;
    this.unavailableError = null;
    this.retiring = false;
    this.operationQueue = Promise.resolve();
    // Last lobby publication from this instance: { key, expiresAt }. Null
    // until one succeeds, and reset when the latest one fails.
    this.indexPublication = null;
    // playerId -> when this instance last persisted that member's connection.
    this.connectionWrites = new Map();
    // Chunks the stored snapshot uses (see roomStorage.js); 0 when inline.
    this.storedChunks = 0;
    // Finished rounds this instance saved (or is saving) as game records.
    this.savedRecords = new Set();

    if (typeof ctx.setWebSocketAutoResponse === "function") {
      ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    }

    ctx.blockConcurrencyWhile(async () => {
      const raw = await ctx.storage.get(STORAGE_KEY);
      if (!raw) return;
      const { snapshot: stored, chunks } = await loadRoomSnapshot(ctx.storage, raw);
      this.storedChunks = chunks;
      try {
        this.engine = RoomEngine.restore(stored);
      } catch (error) {
        this.markUnavailable("ROOM_RESTORE_FAILED", error, stored);
        return;
      }

      const now = Date.now();
      for (const socket of ctx.getWebSockets()) {
        const attachment = this.readAttachment(socket);
        if (!attachment.identity) {
          this.closeSocket(socket, 4401, "Missing session");
          continue;
        }
        try {
          this.engine.resumeConnection(
            attachment.identity.playerId,
            attachment.connectionId,
            now,
          );
        } catch {
          this.closeSocket(socket, 4401, "Session expired");
        }
      }
      // Hibernation keeps attachments but not this object: restore when
      // absent players went offline, so their abandonment grace continues.
      for (const socket of ctx.getWebSockets()) {
        this.engine.restoreOfflineSince(this.readAttachment(socket).offlineSince);
      }

      const advanced = this.engine.advance(now, { includeRoom: false });
      if (advanced.expired) {
        await this.retireRoom();
        return;
      }
      if (advanced.changed) {
        await this.persist();
        this.broadcastState();
      } else {
        this.queueIndexPublish();
      }
      await this.scheduleAlarm();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    // A failed join write can have committed even when its promise rejected.
    // This lookup reads the stored snapshot before deciding whether the caller
    // can recover the same reserved identity; it is allowed while stopped.
    if (request.method === "POST" && url.pathname === "/internal/join-status") {
      return this.enqueue(() => this.lookupCommittedJoin(request));
    }
    if (this.unavailableError?.code === "ROOM_COMMIT_FAILED") {
      await this.enqueue(() => this.recoverCommittedRoom());
    }
    if (this.unavailableError) return this.errorResponse(this.unavailableError);
    if (request.method === "GET" && url.pathname === "/internal/health") {
      return jsonResponse({ ok: true, service: "bamboo-baduk-room" });
    }
    if (request.method === "POST" && url.pathname === "/internal/init") {
      return this.enqueue(() => this.initialize(request));
    }
    if (request.method === "POST" && url.pathname === "/internal/join") {
      return this.enqueue(() => this.reserveMember(request));
    }
    if (
      request.method === "GET" &&
      /^\/api\/rooms\/[A-HJ-NP-Z2-9]{6}\/(?:socket|ws)$/.test(
        url.pathname,
      )
    ) {
      return this.enqueue(() => this.openSocket(request));
    }
    return jsonResponse({ error: "Not found" }, 404);
  }

  async webSocketMessage(socket, rawMessage) {
    if (this.unavailableError) {
      this.sendNormalizedError(socket, this.unavailableError);
      this.closeSocket(socket, 1011, "Room requires recovery");
      return;
    }
    if (typeof rawMessage !== "string") {
      this.sendError(socket, {
        code: "UNSUPPORTED_MESSAGE",
        message: "只接受 JSON 文本消息。",
      });
      return;
    }
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      this.sendError(socket, {
        code: "MESSAGE_TOO_LARGE",
        message: "消息超过 8 KiB 限制。",
      });
      this.closeSocket(socket, 4409, "Message too large");
      return;
    }

    let value;
    try {
      value = JSON.parse(rawMessage);
    } catch {
      this.sendError(socket, {
        code: "INVALID_JSON",
        message: "消息不是有效的 JSON。",
      });
      return;
    }

    await this.enqueue(async () => {
      const attachment = this.readAttachment(socket);
      if (!attachment.identity || !this.engine) {
        this.sendError(socket, {
          code: "UNAUTHORIZED",
          message: "房间身份已经失效，请重新加入。",
        });
        this.closeSocket(socket, 4401, "Unauthorized");
        return;
      }
      if (
        !this.engine.isConnectionActive(
          attachment.identity.playerId,
          attachment.connectionId,
        )
      ) {
        this.sendError(socket, {
          code: "SESSION_REPLACED",
          message: "这个身份已经在另一个窗口重新连接。",
        });
        this.closeSocket(socket, 4408, "Session replaced");
        return;
      }

      // The subprotocol already authenticates the socket.  Accepting this
      // harmless message keeps clients built against the earlier join-message
      // proposal compatible.
      if (
        isRecord(value) &&
        value.v === BADUK_PROTOCOL_VERSION &&
        value.type === "join"
      ) {
        this.sendWelcome(socket, attachment.identity);
        return;
      }

      const command = normalizeCommandMessage(value);
      if (!command) {
        this.sendError(socket, {
          code: "INVALID_COMMAND",
          message: "无法识别这条命令。",
        });
        return;
      }
      await this.handleCommand(socket, attachment, command);
    });
  }

  async webSocketClose(socket, code, reason) {
    await this.enqueue(() => this.disconnectSocket(socket));
    try {
      socket.close(code, reason);
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  async webSocketError(socket, error) {
    console.error("Bamboo baduk WebSocket error", error);
    await this.enqueue(() => this.disconnectSocket(socket));
  }

  async alarm() {
    await this.enqueue(async () => {
      if (!this.engine) return;
      await this.sweepSilentSockets(Date.now());
      const result = this.engine.advance(Date.now(), { includeRoom: false });
      if (result.expired) {
        await this.retireRoom();
        return;
      }
      if (result.changed) {
        await this.persist();
        this.broadcastState();
      }
      await this.scheduleAlarm();
    });
  }

  async initialize(request) {
    if (this.unavailableError) return this.errorResponse(this.unavailableError);
    if (this.retiring) {
      return jsonResponse({ error: "房间已经存在。", code: "CONFLICT" }, 409);
    }
    let createdEngine = false;
    try {
      const body = await request.json();
      if (this.engine) {
        const member = this.engine.member(body.playerId);
        if (member?.color === "black" && member.tokenHash === body.tokenHash) {
          return jsonResponse({
            room: this.engine.snapshotFor(member.playerId),
            identity: this.engine.identityFor(member),
          }, 201);
        }
        return jsonResponse({ error: "房间已经存在。", code: "CONFLICT" }, 409);
      }
      this.engine = RoomEngine.create(body);
      createdEngine = true;
      await this.persist();
      await this.scheduleAlarmAfterCommit();
      const member = this.engine.member(body.playerId);
      return jsonResponse({
        room: this.engine.snapshotFor(member.playerId),
        identity: this.engine.identityFor(member),
      }, 201);
    } catch (error) {
      if (createdEngine && !this.unavailableError) {
        // Even response construction can fail after the first snapshot was
        // committed. Reopen from storage through join-status before serving.
        this.markUnavailable("ROOM_COMMIT_FAILED", error);
      }
      return this.errorResponse(error);
    }
  }

  async recoverCommittedRoom() {
    if (this.unavailableError?.code !== "ROOM_COMMIT_FAILED") return;
    let stored;
    try {
      const raw = await this.ctx.storage.get(STORAGE_KEY);
      if (!raw) {
        this.engine = null;
        this.unavailableError = null;
        return;
      }
      const loaded = await loadRoomSnapshot(this.ctx.storage, raw);
      stored = loaded.snapshot;
      this.storedChunks = loaded.chunks;
      this.engine = RoomEngine.restore(stored);
      this.unavailableError = null;
      this.queueIndexPublish();
      await this.scheduleAlarmAfterCommit();
    } catch (error) {
      if (stored) this.markUnavailable("ROOM_RESTORE_FAILED", error, stored);
      else console.error("Unable to read room after uncertain commit", error);
    }
  }

  async reserveMember(request) {
    if (this.unavailableError) return this.errorResponse(this.unavailableError);
    if (!this.engine || this.retiring) {
      return jsonResponse(
        { error: "没有找到这个房间。", code: "ROOM_NOT_FOUND" },
        404,
      );
    }
    let enteredJoin = false;
    let result;
    let changed;
    try {
      const body = await request.json();
      if (body?.multiGame !== true && this.engine.requiresMultiGameClient()) {
        // A page without multi-game support would draw this round as Go.
        return jsonResponse({
          error: "客户端版本过旧，请刷新页面后重新加入。",
          code: "PROTOCOL_UPGRADE_REQUIRED",
        }, 426);
      }
      const revisionBefore = this.engine.state.revision;
      enteredJoin = true;
      result = this.engine.join(body);
      // prepare() can advance a clock or expire a reservation even when the
      // credential is an idempotent retry. Persist those real revisions only.
      changed = result.changed || this.engine.state.revision !== revisionBefore;
    } catch (error) {
      // join() may mutate before building its response. An unexpected failure
      // must not let a later request persist that speculative membership.
      if (enteredJoin && (!(error instanceof RoomEngineError) || error.status >= 500)) {
        this.markUnavailable("ROOM_COMMIT_FAILED", error);
        return this.errorResponse(this.unavailableError);
      }
      return this.errorResponse(error);
    }
    if (changed) {
      try {
        await this.persist();
      } catch (error) {
        return this.errorResponse(error);
      }
      await this.scheduleAlarmAfterCommit();
      try {
        this.broadcastState();
        this.broadcastPresence();
      } catch (error) {
        console.error("Unable to notify committed room join", error);
      }
    }
    return jsonResponse({
      room: result.room,
      identity: result.identity,
      // The caller already had an identity here (another browser of theirs).
      ...(result.rejoined ? { rejoined: true } : {}),
    }, 201);
  }

  async lookupCommittedJoin(request) {
    if (this.unavailableError && this.unavailableError.code !== "ROOM_COMMIT_FAILED") {
      return this.errorResponse(this.unavailableError);
    }
    try {
      const body = await request.json();
      const { playerId, tokenHash } = isRecord(body) ? body : {};
      if (
        typeof playerId !== "string" ||
        typeof tokenHash !== "string" ||
        !/^[0-9a-f]{64}$/u.test(tokenHash)
      ) {
        return jsonResponse({ error: "加入凭据无效。", code: "BAD_REQUEST" }, 400);
      }
      const raw = await this.ctx.storage.get(STORAGE_KEY);
      if (!raw) {
        if (this.unavailableError?.code === "ROOM_COMMIT_FAILED") {
          // A failed first-room write was confirmed not to have committed.
          // Reopen the empty object so the same create credential can retry.
          this.engine = null;
          this.unavailableError = null;
        }
        return jsonResponse({ error: "加入结果尚未确认。", code: "JOIN_NOT_COMMITTED" }, 404);
      }
      const { snapshot: stored, chunks } = await loadRoomSnapshot(this.ctx.storage, raw);
      let recovered;
      try {
        recovered = RoomEngine.restore(stored);
      } catch (error) {
        this.markUnavailable("ROOM_RESTORE_FAILED", error, stored);
        return this.errorResponse(this.unavailableError);
      }
      // A confirmed read is the source of truth after an uncertain write.
      // Discard the speculative engine and reopen from that exact snapshot.
      if (this.unavailableError?.code === "ROOM_COMMIT_FAILED") {
        this.engine = recovered;
        this.storedChunks = chunks;
        this.unavailableError = null;
        this.queueIndexPublish();
        await this.scheduleAlarmAfterCommit();
      }
      const member = recovered.member(playerId);
      if (!member || !memberHasToken(member, tokenHash)) {
        return jsonResponse({ error: "加入结果尚未确认。", code: "JOIN_NOT_COMMITTED" }, 404);
      }
      return jsonResponse({
        identity: recovered.identityFor(member),
        room: recovered.snapshotFor(member.playerId),
      });
    } catch (error) {
      console.error("Unable to verify uncertain room join", error);
      return jsonResponse({
        error: "加入结果暂时无法确认，请使用原凭据重试。",
        code: "JOIN_COMMIT_UNCERTAIN",
        retryable: true,
      }, 503);
    }
  }

  async openSocket(request) {
    if (this.unavailableError) return this.errorResponse(this.unavailableError);
    if (!this.engine || this.retiring) {
      return jsonResponse(
        { error: "没有找到这个房间。", code: "ROOM_NOT_FOUND" },
        404,
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "需要 WebSocket upgrade。" }, 426);
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKET_CONNECTIONS) {
      return jsonResponse({ error: "房间连接已满。" }, 429);
    }

    const { protocol, token } = parseWebSocketProtocols(
      request.headers.get("Sec-WebSocket-Protocol"),
    );
    if (protocol && protocol !== BADUK_WS_PROTOCOL) {
      return jsonResponse(
        {
          error: "客户端版本过旧，请刷新页面后重新连接。",
          code: "PROTOCOL_UPGRADE_REQUIRED",
        },
        426,
      );
    }
    if (!protocol || !token) {
      return jsonResponse(
        {
          error: "缺少 bamboo-baduk 协议或重连凭据。",
          code: "UNAUTHORIZED",
        },
        401,
      );
    }

    try {
      const connectionId = crypto.randomUUID();
      const visibleBefore = this.lobbyVisibleKey();
      const connected = await this.engine.connectByToken({
        token,
        connectionId,
      });

      for (const existing of this.ctx.getWebSockets()) {
        const previous = this.readAttachment(existing);
        if (previous.identity?.playerId !== connected.identity.playerId) continue;
        this.engine.disconnect({ connectionId: previous.connectionId });
        this.sendError(existing, {
          code: "SESSION_REPLACED",
          message: "这个身份已经在另一个窗口重新连接。",
        });
        this.closeSocket(existing, 4408, "Session replaced");
      }

      // One identity per person: a player's browser never also watches.
      const seat = this.engine.checkSessionUser(
        connected.identity.playerId,
        request.headers.get(SESSION_USER_HEADER),
        undefined,
        (request.headers.get(SESSION_FORMER_USERS_HEADER) ?? "").split(",").filter(Boolean),
      );
      for (const removed of seat.removed) {
        this.closeDuplicateIdentity(removed, "ALREADY_PLAYING_HERE");
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      if (seat.refused) {
        // Accept, explain and close with 4401 so the page drops this
        // identity and stops reconnecting with it.
        this.engine.disconnect({ connectionId });
        await this.persist();
        server.accept();
        this.sendError(server, {
          code: "ALREADY_PLAYING_HERE",
          message: "你是这盘棋的对局者，不能再以旁观者身份进入；请直接返回你的席位。",
        });
        this.closeSocket(server, 4401, "Already playing here");
        this.broadcastState();
        this.broadcastPresence();
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: { "Sec-WebSocket-Protocol": protocol },
        });
      }
      const attachment = {
        connectionId,
        identity: connected.identity,
        connectedAt: Date.now(),
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, ["bamboo-baduk-room"]);

      const connectedAt = Date.now();
      const playerId = connected.identity.playerId;
      const lastWrite = this.connectionWrites?.get(playerId);
      if (seat.changed || connected.firstConnection !== false || lastWrite === undefined ||
          connectedAt - lastWrite >= CONNECTION_WRITE_INTERVAL_MS ||
          this.lobbyVisibleKey() !== visibleBefore) {
        await this.persist();
        this.connectionWrites?.set(playerId, connectedAt);
      }
      await this.scheduleAlarmAfterCommit();
      this.sendWelcome(server, connected.identity, connected.room);
      this.sendState(server, connected.room);
      this.broadcastState(server);
      this.broadcastPresence();

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": protocol },
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async handleCommand(socket, attachment, command) {
    if (this.unavailableError) {
      this.sendNormalizedError(socket, this.unavailableError, command.id);
      return;
    }
    const playerId = attachment.identity.playerId;
    let decision;
    try {
      decision = this.engine.inspectCommand(
        playerId,
        command.id,
        command.sequence,
      );
    } catch (error) {
      this.sendNormalizedError(socket, error, command.id);
      return;
    }

    if (decision.kind === "duplicate") {
      this.sendReceipt(socket, decision.receipt);
      return;
    }
    try {
      // The reconnect handshake and duplicate receipt path stay free. Every
      // new or stale spectator command that can trigger a snapshot or storage
      // write shares bounded member + room budgets.
      this.engine.enforceSpectatorCommandRateLimit({
        playerId,
        action: command.action,
      });
      // Seated players get a generous per-member budget for everything but
      // chat (separately limited). A rejection here writes nothing.
      this.engine.enforcePlayerCommandRateLimit({
        playerId,
        action: command.action,
      });
    } catch (error) {
      this.sendNormalizedError(socket, error, command.id);
      return;
    }
    if (decision.kind === "stale") {
      // Spectators are charged before this branch so repeated stale commands
      // cannot bypass the normal sync budget. Persist that token spend before
      // replying; otherwise a Durable Object hibernation could restore the
      // previous full bucket and make the limit effectively memory-only.
      if (attachment.identity.role === "spectator") {
        try {
          await this.persist();
        } catch (error) {
          this.sendNormalizedError(socket, error, command.id);
          return;
        }
      }
      this.sendError(socket, {
        id: command.id,
        code: "STALE_COMMAND",
        message: "这条命令已经过期，已同步最新棋局。",
        retryable: true,
      });
      this.sendState(socket);
      return;
    }

    let result;
    const revisionBefore = this.engine.state?.revision;
    try {
      if (
        POSITION_BOUND_ACTIONS.has(command.action) &&
        this.engine.member(playerId)?.role === "player"
      ) {
        if (!Object.prototype.hasOwnProperty.call(command.payload, "expectedMoveCount") ||
            !Object.prototype.hasOwnProperty.call(command.payload, "expectedPositionToken")) {
          throw new RoomEngineError(
            "客户端版本过旧，请刷新页面后重试。",
            426,
            "PROTOCOL_UPGRADE_REQUIRED",
          );
        }
        this.engine.assertFreshPosition(command.payload);
        this.assertMultiGameClient(command, this.engine.currentGameType());
      }
      if (
        command.action === "ai_play" &&
        this.engine.member(playerId)?.role === "player"
      ) {
        // A host page runs the AI seat and names the game it computed the
        // move for; a Go-only page must not submit KataGo moves into a
        // Gomoku or Othello round. Go rooms need no name.
        this.assertMultiGameClient(command, this.engine.currentGameType());
      }
      if (
        command.action === "respond_game" &&
        command.payload.accept === true &&
        this.engine.member(playerId)?.role === "player"
      ) {
        this.assertMultiGameClient(command, this.engine.requestedGameType());
      }
      result = command.action === "chat"
        ? this.engine.postChat({
            playerId,
            payload: command.payload,
            sequence: command.sequence,
          })
        : this.engine.applyAction({
            playerId,
            action: command.action,
            payload: command.payload,
          });

    } catch (error) {
      // Only business rejections have durable error receipts. An unexpected
      // exception may have interrupted a mutation; stop using that engine.
      if (!(error instanceof RoomEngineError) || error.status >= 500) {
        this.markUnavailable("ROOM_COMMIT_FAILED", error);
        this.sendNormalizedError(socket, this.unavailableError, command.id);
        return;
      }
      const normalized = this.normalizeError(error);
      try {
        const shouldPersistRejection =
          command.action !== "leave" &&
          normalized.code !== "CHAT_RATE_LIMITED" &&
          normalized.code !== "SPECTATOR_RATE_LIMITED" &&
          this.engine.member(playerId);
        if (shouldPersistRejection) {
          this.engine.recordCommand({
            playerId,
            id: command.id,
            sequence: command.sequence,
            error: normalized,
          });
          await this.persist();
        }
      } catch (receiptError) {
        this.sendNormalizedError(socket, receiptError, command.id);
        return;
      }
      this.sendError(socket, { id: command.id, ...normalized });
      if (normalized.code === "GAME_TIMED_OUT") {
        this.broadcastState();
        await this.scheduleAlarmAfterCommit();
      }
      if (normalized.code === "STALE_SCORING" || normalized.code === "STALE_GAME_STATE") {
        this.sendState(socket);
      }
      return;
    }

    // A player's sync only reads. Its receipt can stay in memory unless the
    // room itself advanced (a clock or reservation expiry) while preparing.
    // Spectator syncs still persist the shared rate-limit spend.
    const readOnly = command.action === "sync" &&
      this.engine.member(playerId)?.role === "player" &&
      this.engine.state?.revision === revisionBefore;
    try {
      if (command.action !== "leave") {
        this.engine.recordCommand({
          playerId,
          id: command.id,
          sequence: command.sequence,
        });
      }
      if (!readOnly) await this.persist();
    } catch (error) {
      if (!this.unavailableError) this.markUnavailable("ROOM_COMMIT_FAILED", error);
      this.sendNormalizedError(socket, this.unavailableError, command.id);
      return;
    }

    // State and receipt are committed together. Neither a notification failure
    // nor alarm scheduling may rewrite that success as a business rejection.
    this.safeSend(socket, makeAckMessage(command, result.revision));
    try {
      if (command.action === "claim_seat" || command.action === "release_seat") {
        const currentMember = this.engine.member(playerId);
        if (currentMember) {
          attachment.identity = this.engine.identityFor(currentMember);
          socket.serializeAttachment(attachment);
        }
      }
      if (command.action === "chat") this.broadcastChat(result.message);
      else if (command.action === "sync") this.sendState(socket, result.room);
      else this.broadcastState();
      if (command.action === "leave") {
        socket.serializeAttachment({ ...attachment, identity: null });
        this.broadcastPresence(socket);
        this.closeSocket(socket, 1000, "Membership left");
      }
      if (command.action === "remove_member" && result.removedPlayerId) {
        this.closeRemovedMember(result.removedPlayerId);
      }
    } catch (error) {
      console.error("Unable to notify committed room command", error);
    }
    await this.scheduleAlarmAfterCommit();
  }

  /** Close the sockets of an identity removed because its person plays here. */
  closeDuplicateIdentity(playerId, code) {
    for (const socket of this.ctx.getWebSockets?.() ?? []) {
      const attachment = this.readAttachment(socket);
      if (attachment.identity?.playerId !== playerId) continue;
      this.sendError(socket, {
        code,
        message: "你是这盘棋的对局者，不能再以旁观者身份进入；请直接返回你的席位。",
      });
      socket.serializeAttachment({ ...attachment, identity: null });
      this.closeSocket(socket, 4401, "Already playing here");
    }
  }

  /** Tell a member the host removed that their seat is gone and close it. */
  closeRemovedMember(playerId) {
    for (const socket of this.ctx.getWebSockets?.() ?? []) {
      const attachment = this.readAttachment(socket);
      if (attachment.identity?.playerId !== playerId) continue;
      this.sendError(socket, {
        code: "REMOVED_FROM_ROOM",
        message: "你已被房主移出房间。",
      });
      socket.serializeAttachment({ ...attachment, identity: null });
      // 4401 ends the session on every client version: no reconnect.
      this.closeSocket(socket, 4401, "Removed by host");
    }
  }

  /**
   * Older pages echo only the position token, so in a round of another game
   * they would act on a board they draw as Go. Multi-game pages name the game
   * they see (gameType) on every position-bound command and when accepting an
   * invitation; Go needs no name.
   */
  assertMultiGameClient(command, gameType) {
    if (!gameType || gameType === GAME_GO || command.payload.gameType === gameType) return;
    throw new RoomEngineError(
      "客户端版本过旧，请刷新页面后重试。",
      426,
      "PROTOCOL_UPGRADE_REQUIRED",
    );
  }

  async disconnectSocket(socket) {
    if (!this.engine) return;
    const attachment = this.readAttachment(socket);
    if (!attachment.identity) return;
    try {
      const visibleBefore = this.lobbyVisibleKey();
      const disconnected = this.engine.disconnect({
        connectionId: attachment.connectionId,
      });
      if (disconnected?.playerOffline) {
        this.rememberPlayerOffline(disconnected.playerId, Date.now(), socket);
      }
      // Only a spectator's reconnect grace starts here and must survive a
      // restart, and the lobby must learn what it shows (a seat opening or
      // closing, a player going offline, fewer spectators); other presence is
      // not worth a rewrite.
      if (disconnected?.spectatorOffline !== false ||
          this.lobbyVisibleKey() !== visibleBefore) {
        await this.persist();
      }
      await this.scheduleAlarm();
      this.broadcastState(socket);
      this.broadcastPresence(socket);
    } catch (error) {
      if (!(error instanceof RoomEngineError && error.code === "ROOM_NOT_FOUND")) {
        console.error("Unable to disconnect room socket", error);
      }
    }
  }

  /**
   * Keep a seated player's disconnect time on every other open socket. The
   * attachments outlive hibernation without a storage write.
   */
  rememberPlayerOffline(playerId, at, closingSocket) {
    for (const socket of this.ctx.getWebSockets?.() ?? []) {
      if (socket === closingSocket) continue;
      const attachment = this.readAttachment(socket);
      if (!attachment.identity) continue;
      attachment.offlineSince = offlineEntries({ ...attachment.offlineSince, [playerId]: at });
      try {
        socket.serializeAttachment(attachment);
      } catch (error) {
        console.error("Unable to remember an offline player on a socket", error);
      }
    }
  }

  async persist() {
    if (!this.engine) return;
    try {
      // Presence and TTL can change without a game revision. Give every
      // persisted directory projection its own strictly ordered version.
      this.engine.bumpDirectoryRevision();
      const snapshot = this.engine.serialize();
      this.storedChunks = await saveRoomSnapshot(this.ctx.storage, snapshot, this.storedChunks);
    } catch (error) {
      // Includes serialization/validation failures before a write and writes
      // whose outcome is unknown. Never reuse their in-memory success receipts.
      // Default Cloudflare output gates remain enabled. A fresh object restores
      // the authoritative snapshot; no speculative error receipt is written.
      this.markUnavailable("ROOM_COMMIT_FAILED", error);
      throw this.unavailableError;
    }
    this.queueIndexPublish();
    this.queueRecordSave();
  }

  /**
   * Save a finished round to its players' game records in D1, once per
   * round. Optional like the lobby: without a database, or when saving
   * fails, the round stays in the room as before. Saving is idempotent (by
   * room incarnation and round), so a restarted instance may try again.
   */
  queueRecordSave() {
    if (!this.engine || !this.env?.DB) return;
    let key;
    let record;
    try {
      const round = this.engine.finishedRoundRecord(Date.now());
      if (!round) return;
      key = `${round.incarnationId}:${round.roundId}`;
      if (this.savedRecords.has(key)) return;
      this.savedRecords.add(key);
      record = onlineRoundRecord(round, this.engine.state.code);
    } catch (error) {
      console.error("Unable to build a game record", error);
      return;
    }
    // Nobody to give it to (players from before accounts existed).
    if (record.owners.length === 0) return;
    const saving = saveRecord(this.env.DB, record.row, record.owners).catch((error) => {
      console.error("Unable to save a game record", error);
      this.savedRecords.delete(key);
    });
    this.ctx.waitUntil?.(saving);
  }

  lobbyJoinable() {
    // Presence decides whether the lobby advertises a seat, and a publish
    // needs a stored directory revision, so socket events that flip it write.
    if (!this.engine || !this.env?.BADUK_ROOM_INDEX) return null;
    try {
      return lobbySummaryFromRoom(this.engine.directorySnapshot()).joinable;
    } catch {
      return null;
    }
  }

  /**
   * What the lobby shows of this room (expiry aside), or null without a
   * lobby. Socket events that change it (a seat, a player going on- or
   * offline, the spectator count) write, because a publish needs a stored
   * directory revision.
   */
  lobbyVisibleKey(room = null) {
    if (!this.engine || !this.env?.BADUK_ROOM_INDEX) return null;
    try {
      const snapshot = room ?? this.engine.directorySnapshot();
      const {
        revision: _revision,
        directoryRevision: _directoryRevision,
        updatedAt: _updatedAt,
        expiresAt: _expiresAt,
        ...visible
      } = lobbySummaryFromRoom(snapshot);
      // An unlisted room publishes listed: false, which the lobby treats as
      // a versioned removal.
      return JSON.stringify({ ...visible, listed: snapshot.listed !== false });
    } catch {
      return null;
    }
  }

  queueIndexPublish() {
    if (!this.engine || !this.env?.BADUK_ROOM_INDEX) return;
    let room;
    let summary;
    try {
      room = this.engine.directorySnapshot();
      summary = lobbySummaryFromRoom(room);
    } catch (error) {
      console.error("Unable to project room for optional index", error);
      return;
    }
    // Every persist bumps the directory revision, but most (syncs, receipts,
    // presence-free writes) leave the public entry unchanged. The single
    // global lobby rewrites its whole index per upsert, so only publish a
    // visible change, a materially later expiry, or a retry after a failure.
    // A skipped publish just leaves an older directory revision in the lobby.
    const { expiresAt } = summary;
    const key = this.lobbyVisibleKey(room);
    const previous = this.indexPublication;
    if (previous?.key === key &&
        expiresAt - previous.expiresAt < LOBBY_EXPIRY_REFRESH_MS) {
      return;
    }
    const publication = { key, expiresAt };
    this.indexPublication = publication;
    const publishing = this.publishRoomIndexSnapshot(room).then((published) => {
      if (!published && this.indexPublication === publication) {
        this.indexPublication = null;
      }
    });
    if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(publishing);
    else void publishing;
  }

  async publishRoomIndexSnapshot(room) {
    // A room is the source of truth. The optional index receives a one-way
    // public snapshot and derives its own disposable directory entry. Nothing
    // in this object ever reads from the index.
    if (!room || !this.env?.BADUK_ROOM_INDEX) return false;
    try {
      const index = this.env.BADUK_ROOM_INDEX.getByName("global");
      const response = await index.fetch(
        new Request("https://room-index.internal/internal/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(room),
        }),
      );
      if (!response.ok) {
        console.error("Unable to publish room to optional index", response.status);
      }
      return response.ok;
    } catch (error) {
      console.error("Unable to publish room to optional index", error);
      return false;
    }
  }

  async removeRoomIndexEntry(code, incarnationId) {
    if (!this.env?.BADUK_ROOM_INDEX || !code || !incarnationId) return;
    try {
      const index = this.env.BADUK_ROOM_INDEX.getByName("global");
      await index.fetch(
        new Request("https://room-index.internal/internal/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, incarnationId }),
        }),
      );
    } catch (error) {
      console.error("Unable to remove room from optional index", error);
    }
  }

  /**
   * Close the sockets of pages that stopped pinging for SILENT_SOCKET_MS: the
   * network under them died without a close, so the member is offline even
   * though the socket looks open. Pages that never pinged (older builds) are
   * left to the transport.
   */
  async sweepSilentSockets(now) {
    if (typeof this.ctx.getWebSocketAutoResponseTimestamp !== "function") return;
    for (const socket of this.ctx.getWebSockets?.() ?? []) {
      if (!this.readAttachment(socket).identity) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(socket);
      if (!lastPing || now - lastPing.getTime() < SILENT_SOCKET_MS) continue;
      this.closeSocket(socket, 4000, "Heartbeat lost");
      await this.disconnectSocket(socket);
    }
  }

  /** Whether heartbeats need checking: a game is being played and a member is connected. */
  needsHeartbeatChecks() {
    return this.engine?.state?.match?.status === MATCH_STATUS_PLAYING &&
      (this.ctx.getWebSockets?.() ?? []).some((socket) => this.readAttachment(socket).identity);
  }

  async scheduleAlarm() {
    let dueAt = this.engine?.nextDueAt();
    if (this.needsHeartbeatChecks()) {
      const sweepAt = Date.now() + SOCKET_SWEEP_MS;
      dueAt = dueAt === null || dueAt === undefined ? sweepAt : Math.min(dueAt, sweepAt);
    }
    if (dueAt === null || dueAt === undefined) {
      if ((await this.ctx.storage.getAlarm()) !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }
    const next = Math.max(Date.now() + 1, dueAt);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || Math.abs(current - next) > 5) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async scheduleAlarmAfterCommit() {
    try {
      await this.scheduleAlarm();
    } catch (error) {
      console.error("Unable to schedule alarm for committed room", error);
    }
  }

  markUnavailable(code, error, stored = null) {
    console.error("Room stopped; persisted snapshot retained", {
      roomId: this.ctx.id?.toString() ?? null,
      schemaVersion: stored?.schemaVersion ?? this.engine?.state?.schemaVersion,
      code,
      errorType: error?.name ?? typeof error,
      message: error?.message ?? String(error),
    });
    this.engine = null;
    this.unavailableError = new RoomEngineError(
      "房间暂时无法恢复或保存，请稍后重新连接。",
      503,
      code,
      true,
    );
    for (const socket of this.ctx.getWebSockets?.() ?? []) {
      this.sendNormalizedError(socket, this.unavailableError);
      this.closeSocket(socket, 1011, "Room requires recovery");
    }
  }

  async retireRoom() {
    if (this.retiring) return;
    this.retiring = true;
    const roomCode = this.engine?.state?.code ?? null;
    const incarnationId = this.engine?.state?.incarnationId ?? null;
    this.engine = null;
    for (const socket of this.ctx.getWebSockets()) {
      this.sendError(socket, {
        code: "ROOM_EXPIRED",
        message: "房间 24 小时没有活动，已经关闭。",
      });
      this.closeSocket(socket, 4404, "Room expired");
    }
    try {
      if ((await this.ctx.storage.getAlarm()) !== null) {
        await this.ctx.storage.deleteAlarm();
      }
      await this.ctx.storage.deleteAll();
      this.storedChunks = 0;
      const removal = this.removeRoomIndexEntry(roomCode, incarnationId);
      if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(removal);
      else void removal;
    } finally {
      this.retiring = false;
    }
  }

  roomForSocket(socket, fallback = null, snapshotsByRole = null) {
    const attachment = this.readAttachment(socket);
    if (!this.engine || !attachment.identity?.playerId) return fallback;
    try {
      if (typeof this.engine.snapshotFor === "function") {
        const role = snapshotsByRole && typeof this.engine.member === "function"
          ? this.engine.member(attachment.identity.playerId)?.role
          : undefined;
        if (!role) return this.engine.snapshotFor(attachment.identity.playerId);
        // snapshotFor() varies only by the viewer's role (chat channels), so
        // a broadcast builds at most one player and one spectator snapshot.
        if (!snapshotsByRole.has(role)) {
          snapshotsByRole.set(role, this.engine.snapshotFor(attachment.identity.playerId));
        }
        return snapshotsByRole.get(role);
      }
      if (typeof this.engine.snapshot === "function") return this.engine.snapshot();
    } catch {
      return fallback;
    }
    return fallback;
  }

  sendWelcome(socket, identity, room = null) {
    const safeRoom = this.roomForSocket(socket, room);
    this.safeSend(socket, {
      v: BADUK_PROTOCOL_VERSION,
      type: "welcome",
      identity,
      self: identity,
      room: safeRoom,
      serverTime: Date.now(),
    });
  }

  sendState(socket, room = null, snapshotsByRole = null) {
    const attachment = this.readAttachment(socket);
    const safeRoom = this.roomForSocket(socket, room, snapshotsByRole);
    if (!safeRoom) return;
    this.safeSend(socket, {
      ...makeStateMessage(safeRoom),
      self: attachment.identity,
      identity: attachment.identity,
    });
  }

  broadcastState(excluded) {
    if (!this.engine) return;
    const snapshotsByRole = new Map();
    for (const socket of this.joinedSockets(excluded)) {
      this.sendState(socket, null, snapshotsByRole);
    }
  }

  broadcastPresence(excluded) {
    if (!this.engine) return;
    let room;
    try {
      room = this.engine.snapshot();
    } catch {
      return;
    }
    const message = makePresenceMessage(room);
    for (const socket of this.joinedSockets(excluded)) this.safeSend(socket, message);
  }

  broadcastChat(message) {
    const event = makeChatMessage(message);
    for (const socket of this.joinedSockets()) {
      const role = this.readAttachment(socket).identity?.role ?? null;
      if (message?.channel === CHAT_CHANNEL_SPECTATORS && role !== "spectator") {
        continue;
      }
      this.safeSend(socket, event);
    }
  }

  joinedSockets(excluded) {
    return this.ctx.getWebSockets().filter((socket) => {
      if (socket === excluded || socket.readyState !== 1) return false;
      return this.readAttachment(socket).identity !== null;
    });
  }

  sendReceipt(socket, receipt) {
    if (receipt.ok) {
      this.safeSend(
        socket,
        makeAckMessage(
          { id: receipt.id, sequence: receipt.sequence },
          receipt.revision,
        ),
      );
      return;
    }
    this.sendError(socket, {
      id: receipt.id,
      code: receipt.error?.code ?? "COMMAND_REJECTED",
      message: receipt.error?.message ?? "命令已经被拒绝。",
      retryable: receipt.error?.retryable ?? false,
    });
  }

  sendError(socket, error) {
    this.safeSend(socket, makeErrorMessage(error));
  }

  sendNormalizedError(socket, error, id) {
    this.sendError(socket, { id, ...this.normalizeError(error) });
  }

  safeSend(socket, value) {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(value));
    } catch (error) {
      console.error("Unable to send room message", error);
    }
  }

  closeSocket(socket, code, reason) {
    if (socket.readyState >= 2) return;
    try {
      socket.close(code, reason.slice(0, 120));
    } catch (error) {
      console.error("Unable to close room socket", error);
    }
  }

  readAttachment(socket) {
    let value;
    try {
      value = socket.deserializeAttachment();
    } catch {
      return defaultAttachment();
    }
    if (!isRecord(value)) return defaultAttachment();
    const identity = isRecord(value.identity) &&
      typeof value.identity.playerId === "string"
      ? value.identity
      : null;
    return {
      connectionId:
        typeof value.connectionId === "string"
          ? value.connectionId
          : crypto.randomUUID(),
      identity,
      connectedAt:
        typeof value.connectedAt === "number" ? value.connectedAt : Date.now(),
      offlineSince: offlineEntries(value.offlineSince),
    };
  }

  normalizeError(error) {
    if (error instanceof RoomEngineError) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      };
    }
    console.error("Unexpected room error", error);
    return {
      code: "INTERNAL_ERROR",
      message: "房间服务暂时开小差了。",
      retryable: true,
    };
  }

  errorResponse(error) {
    const normalized = this.normalizeError(error);
    const status = error instanceof RoomEngineError ? error.status : 500;
    return jsonResponse({ error: normalized.message, ...normalized }, status);
  }

  enqueue(task) {
    const run = this.operationQueue.then(task, task);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

}

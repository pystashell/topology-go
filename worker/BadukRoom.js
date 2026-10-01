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
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { CHAT_CHANNEL_SPECTATORS } from "../src/multiplayer/chat.js";

const STORAGE_KEY = "room";
const MAX_SOCKET_CONNECTIONS = 64;
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
    },
  });
}

function defaultAttachment() {
  return {
    connectionId: crypto.randomUUID(),
    identity: null,
    connectedAt: Date.now(),
  };
}

export class BadukRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.engine = null;
    this.unavailableError = null;
    this.retiring = false;
    this.operationQueue = Promise.resolve();

    if (typeof ctx.setWebSocketAutoResponse === "function") {
      ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    }

    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(STORAGE_KEY);
      if (!stored) return;
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

      const advanced = this.engine.advance(now);
      if (advanced.expired) {
        await this.retireRoom();
        return;
      }
      if (advanced.changed) {
        await this.persist();
        this.broadcastState();
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
      const result = this.engine.advance(Date.now());
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
      stored = await this.ctx.storage.get(STORAGE_KEY);
      if (!stored) {
        this.engine = null;
        this.unavailableError = null;
        return;
      }
      this.engine = RoomEngine.restore(stored);
      this.unavailableError = null;
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
    return jsonResponse({ room: result.room, identity: result.identity }, 201);
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
      const stored = await this.ctx.storage.get(STORAGE_KEY);
      if (!stored) {
        if (this.unavailableError?.code === "ROOM_COMMIT_FAILED") {
          // A failed first-room write was confirmed not to have committed.
          // Reopen the empty object so the same create credential can retry.
          this.engine = null;
          this.unavailableError = null;
        }
        return jsonResponse({ error: "加入结果尚未确认。", code: "JOIN_NOT_COMMITTED" }, 404);
      }
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
        this.unavailableError = null;
        await this.scheduleAlarmAfterCommit();
      }
      const member = recovered.member(playerId);
      if (!member || member.tokenHash !== tokenHash) {
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

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const attachment = {
        connectionId,
        identity: connected.identity,
        connectedAt: Date.now(),
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, ["bamboo-baduk-room"]);

      await this.persist();
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

    try {
      if (command.action !== "leave") {
        this.engine.recordCommand({
          playerId,
          id: command.id,
          sequence: command.sequence,
        });
      }
      await this.persist();
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
    } catch (error) {
      console.error("Unable to notify committed room command", error);
    }
    await this.scheduleAlarmAfterCommit();
  }

  async disconnectSocket(socket) {
    if (!this.engine) return;
    const attachment = this.readAttachment(socket);
    if (!attachment.identity) return;
    try {
      this.engine.disconnect({ connectionId: attachment.connectionId });
      await this.persist();
      await this.scheduleAlarm();
      this.broadcastState(socket);
      this.broadcastPresence(socket);
    } catch (error) {
      if (!(error instanceof RoomEngineError && error.code === "ROOM_NOT_FOUND")) {
        console.error("Unable to disconnect room socket", error);
      }
    }
  }

  async persist() {
    if (!this.engine) return;
    try {
      const snapshot = this.engine.serialize();
      await this.ctx.storage.put(STORAGE_KEY, snapshot);
    } catch (error) {
      // Includes serialization/validation failures before a write and writes
      // whose outcome is unknown. Never reuse their in-memory success receipts.
      // Default Cloudflare output gates remain enabled. A fresh object restores
      // the authoritative snapshot; no speculative error receipt is written.
      this.markUnavailable("ROOM_COMMIT_FAILED", error);
      throw this.unavailableError;
    }
    const publishing = this.publishRoomIndexSnapshot();
    if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(publishing);
    else void publishing;
  }

  async publishRoomIndexSnapshot() {
    // A room is the source of truth. The optional index receives a one-way
    // public snapshot and derives its own disposable directory entry. Nothing
    // in this object ever reads from the index.
    if (!this.engine || !this.env?.BADUK_ROOM_INDEX) return;
    try {
      const index = this.env.BADUK_ROOM_INDEX.getByName("global");
      const response = await index.fetch(
        new Request("https://room-index.internal/internal/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.engine.snapshot()),
        }),
      );
      if (!response.ok) {
        console.error("Unable to publish room to optional index", response.status);
      }
    } catch (error) {
      console.error("Unable to publish room to optional index", error);
    }
  }

  async removeRoomIndexEntry(code) {
    if (!this.env?.BADUK_ROOM_INDEX || !code) return;
    try {
      const index = this.env.BADUK_ROOM_INDEX.getByName("global");
      await index.fetch(
        new Request("https://room-index.internal/internal/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
      );
    } catch (error) {
      console.error("Unable to remove room from optional index", error);
    }
  }

  async scheduleAlarm() {
    const dueAt = this.engine?.nextDueAt();
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
      const removal = this.removeRoomIndexEntry(roomCode);
      if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(removal);
      else void removal;
    } finally {
      this.retiring = false;
    }
  }

  roomForSocket(socket, fallback = null) {
    const attachment = this.readAttachment(socket);
    if (!this.engine || !attachment.identity?.playerId) return fallback;
    try {
      if (typeof this.engine.snapshotFor === "function") {
        return this.engine.snapshotFor(attachment.identity.playerId);
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

  sendState(socket, room = null) {
    const attachment = this.readAttachment(socket);
    const safeRoom = this.roomForSocket(socket, room);
    if (!safeRoom) return;
    this.safeSend(socket, {
      ...makeStateMessage(safeRoom),
      self: attachment.identity,
      identity: attachment.identity,
    });
  }

  broadcastState(excluded) {
    if (!this.engine) return;
    for (const socket of this.joinedSockets(excluded)) this.sendState(socket);
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

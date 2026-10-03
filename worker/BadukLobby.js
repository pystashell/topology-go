import {
  MAX_LOBBY_ROOMS,
  isLobbySummary,
  lobbySummaryFromRoom,
  pruneLobbyRooms,
  sortLobbyRooms,
} from "../src/multiplayer/lobby.js";

const STORAGE_KEY = "rooms";
// Keep ordering evidence for every accepted live code, including entries
// displaced from the 500 visible rooms. Keep the single persisted value well
// below SQLite Durable Object's 2 MB key/value limit, and reject new codes at
// the bound instead of forgetting a live high-water mark.
const MAX_TRACKED_CODES = MAX_LOBBY_ROOMS * 4;

function directoryVersion(summary) {
  // Stored entries from before the directory-version migration remain usable
  // until their room next publishes a current snapshot.
  return summary.directoryRevision ?? summary.revision;
}

function staleAgainst(incoming, known) {
  if (!known) return false;
  if (known.incarnationId === incoming.incarnationId) {
    return directoryVersion(known) >= directoryVersion(incoming);
  }
  // An old stored summary has no incarnation ID. Its first current publish
  // replaces it even if its historical createdAt was only an updatedAt fallback.
  if (!known.incarnationId) return false;
  return known.createdAt >= incoming.createdAt;
}

function watermarkFrom(summary) {
  return {
    code: summary.code,
    incarnationId: summary.incarnationId,
    createdAt: summary.createdAt,
    directoryRevision: directoryVersion(summary),
    expiresAt: summary.expiresAt,
  };
}

function validWatermark(value) {
  return Boolean(value && typeof value.code === "string" && value.code.length === 6 &&
    typeof value.incarnationId === "string" && value.incarnationId.length > 0 &&
    value.incarnationId.length <= 128 &&
    Number.isFinite(value.createdAt) && Number.isFinite(value.expiresAt) &&
    Number.isSafeInteger(value.directoryRevision) && value.directoryRevision >= 1);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export class BadukLobby {
  constructor(ctx) {
    this.ctx = ctx;
    this.rooms = new Map();
    this.watermarks = new Map();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(STORAGE_KEY);
      const rooms = pruneLobbyRooms(Array.isArray(stored)
        ? stored
        : Array.isArray(stored?.rooms) ? stored.rooms : []);
      this.rooms = new Map(rooms.map((room) => [room.code, room]));
      const currentTime = Date.now();
      const watermarks = Array.isArray(stored?.watermarks) ? stored.watermarks : [];
      this.watermarks = new Map(watermarks
        .filter((entry) => validWatermark(entry) && entry.expiresAt > currentTime)
        .map((entry) => [entry.code, entry]));
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/internal/rooms") {
      await this.prune();
      return jsonResponse({ rooms: sortLobbyRooms(this.rooms.values()) });
    }
    if (request.method === "POST" && url.pathname === "/internal/upsert") {
      const room = await request.json().catch(() => null);
      if (!Number.isSafeInteger(room?.directoryRevision) ||
          room.directoryRevision < 1 ||
          typeof room?.code !== "string" || room.code.length !== 6 ||
          typeof room?.incarnationId !== "string" ||
          room.incarnationId.length === 0 || room.incarnationId.length > 128 ||
          !Number.isFinite(room?.createdAt)) {
        return jsonResponse({ error: "Invalid room directory identity." }, 400);
      }
      let summary = null;
      try {
        summary = lobbySummaryFromRoom(room);
      } catch {
        // Invalid room snapshots never enter the derived directory.
      }
      if (!isLobbySummary(summary)) {
        return jsonResponse({ error: "Invalid public room snapshot." }, 400);
      }
      if (summary.expiresAt <= Date.now()) {
        return jsonResponse({ ok: true, ignored: "expired" });
      }
      await this.prune();
      const current = this.rooms.get(summary.code);
      const watermark = this.watermarks.get(summary.code);
      if (staleAgainst(summary, current) || staleAgainst(summary, watermark)) {
        return jsonResponse({ ok: true, ignored: "stale" });
      }
      if (!current && !watermark &&
          this.rooms.size + this.watermarks.size >= MAX_TRACKED_CODES) {
        return jsonResponse({ error: "Room directory is at capacity." }, 503);
      }
      this.watermarks.delete(summary.code);
      this.rooms.set(summary.code, summary);
      await this.prune();
      await this.persist();
      return jsonResponse({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/internal/remove") {
      const body = await request.json().catch(() => null);
      if (typeof body?.code !== "string" || body.code.length !== 6 ||
          typeof body?.incarnationId !== "string" ||
          body.incarnationId.length === 0 || body.incarnationId.length > 128) {
        return jsonResponse({ error: "Invalid room directory identity." }, 400);
      }
      const current = this.rooms.get(body.code);
      if (!current || current.incarnationId !== body.incarnationId) {
        return jsonResponse({ ok: true, ignored: "stale" });
      }
      this.remember(current);
      this.rooms.delete(body.code);
      await this.prune();
      await this.persist();
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: "Not found" }, 404);
  }

  async prune(now = Date.now()) {
    const rooms = pruneLobbyRooms([...this.rooms.values()], now);
    const kept = new Set(rooms.map((room) => room.code));
    let changed = rooms.length !== this.rooms.size;
    for (const room of this.rooms.values()) {
      if (!kept.has(room.code) && room.expiresAt > now) {
        this.remember(room);
        changed = true;
      }
    }
    this.rooms = new Map(rooms.map((room) => [room.code, room]));
    for (const [code, watermark] of this.watermarks) {
      if (watermark.expiresAt <= now) {
        this.watermarks.delete(code);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  remember(summary) {
    if (!summary.incarnationId || !Number.isFinite(summary.expiresAt)) return;
    const candidate = watermarkFrom(summary);
    const current = this.watermarks.get(summary.code);
    if (!staleAgainst(candidate, current)) {
      this.watermarks.set(summary.code, candidate);
    }
  }

  async persist() {
    try {
      await this.ctx.storage.put(STORAGE_KEY, {
        rooms: sortLobbyRooms(this.rooms.values()),
        watermarks: [...this.watermarks.values()],
      });
    } catch (error) {
      // A rejected write may have committed. Reset the instance so the next
      // request reloads the authoritative index before comparing revisions.
      this.ctx.abort("Lobby storage outcome unknown");
      throw error;
    }
  }
}

export default BadukLobby;

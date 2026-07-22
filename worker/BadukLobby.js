import {
  MAX_LOBBY_ROOMS,
  isLobbySummary,
  lobbySummaryFromRoom,
  pruneLobbyRooms,
  sortLobbyRooms,
} from "../src/multiplayer/lobby.js";

const STORAGE_KEY = "rooms";

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
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(STORAGE_KEY);
      const rooms = pruneLobbyRooms(Array.isArray(stored) ? stored : []);
      this.rooms = new Map(rooms.map((room) => [room.code, room]));
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
      let summary = null;
      try {
        summary = lobbySummaryFromRoom(room);
      } catch {
        // Invalid room snapshots never enter the derived directory.
      }
      if (!isLobbySummary(summary)) {
        return jsonResponse({ error: "Invalid public room snapshot." }, 400);
      }
      const current = this.rooms.get(summary.code);
      if (current && current.revision >= summary.revision) {
        return jsonResponse({ ok: true, ignored: "stale" });
      }
      this.rooms.set(summary.code, summary);
      await this.prune();
      await this.persist();
      return jsonResponse({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/internal/remove") {
      const body = await request.json().catch(() => null);
      if (typeof body?.code !== "string") {
        return jsonResponse({ error: "Invalid room code." }, 400);
      }
      this.rooms.delete(body.code);
      await this.persist();
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: "Not found" }, 404);
  }

  async prune(now = Date.now()) {
    const rooms = pruneLobbyRooms([...this.rooms.values()], now);
    if (rooms.length === this.rooms.size && rooms.length <= MAX_LOBBY_ROOMS) return;
    this.rooms = new Map(rooms.map((room) => [room.code, room]));
    await this.persist();
  }

  async persist() {
    await this.ctx.storage.put(STORAGE_KEY, sortLobbyRooms(this.rooms.values()));
  }
}

export default BadukLobby;

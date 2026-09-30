// Test-only entrypoint. Never imported by worker/index.js or deployed.
import { BadukRoom } from "../../worker/BadukRoom.js";
import { RoomEngine } from "../../src/multiplayer/roomEngine.js";

export class RuntimeRoom extends BadukRoom {
  markUnavailable(code, error, stored) {
    this.runtimeFailure = error?.message;
    super.markUnavailable(code, error, stored);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/seed") {
      this.engine = RoomEngine.create({ code: "BAM234", name: "Black", size: 5,
        playerId: "black", tokenHash: "a".repeat(64) });
      this.engine.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64) });
      await this.persist();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/stored") return Response.json(await this.ctx.storage.get("room"));
    if (url.pathname === "/unsupported-schema") {
      const stored = await this.ctx.storage.get("room");
      stored.schemaVersion = 999;
      await this.ctx.storage.put("room", stored);
      return Response.json(stored);
    }
    if (url.pathname === "/reset") this.ctx.abort("Test requests a fresh authoritative restore");
    if (url.pathname === "/command") {
      const fault = url.searchParams.get("fault");
      if (fault === "serialize") this.engine.serialize = () => { throw new TypeError("injected serialization failure"); };
      if (fault === "oversize") {
        const serialize = this.engine.serialize.bind(this.engine);
        // Exceed workerd 1.20260930.2's 8 MiB row limit; older runtimes used 2 MiB.
        this.engine.serialize = () => ({ ...serialize(), padding: "x".repeat(9 * 1024 * 1024) });
      }
      if (fault === "alarm") this.scheduleAlarm = async () => { throw new Error("injected post-commit alarm failure"); };
      this.rollbackWrite = fault === "rollback";
      const messages = [];
      const attachment = { identity: { playerId: "black", role: "player", color: "black" } };
      const socket = { readyState: 1, send: value => messages.push(JSON.parse(value)), deserializeAttachment: () => attachment };
      await this.handleCommand(socket, attachment, { id: "move-1", sequence: 1, action: "play", payload: { row: 0, col: 0 } });
      return Response.json({ messages, unavailable: this.unavailableError?.code ?? null, failure: this.runtimeFailure });
    }
    return super.fetch(request);
  }

  async persist() {
    if (!this.rollbackWrite) return super.persist();
    try {
      await this.ctx.storage.transaction(async () => {
        await super.persist();
        throw new Error("injected transaction abort after put");
      });
    } catch (error) {
      this.markUnavailable("ROOM_COMMIT_FAILED", error);
      throw this.unavailableError;
    }
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return env.ROOMS.getByName(url.searchParams.get("room") ?? "test").fetch(request);
  },
};

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel } from "miniflare";

test("SQLite Durable Object validation, rollback, post-commit failure and restart", async (t) => {
  const root = new URL("../", import.meta.url);
  const entry = "scripts/fixtures/room-runtime-worker.mjs";
  // Miniflare 5 requires an explicit module graph instead of discovering imports.
  const paths = [
    entry,
    "worker/BadukRoom.js",
    "src/multiplayer/roomEngine.js",
    "src/multiplayer/protocol.js",
    "src/multiplayer/chat.js",
    "src/game/goEngine.js",
    "src/game/boardDimensions.js",
    "src/game/mobiusTopology.js",
    "src/game/timeControl.js",
  ];
  const modules = Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path, { type: "esm", contents: await readFile(new URL(path, root), "utf8") },
  ])));
  const mf = new Miniflare({
    workers: [{ config: {
      name: "room-runtime-test",
      compatibilityDate: "2026-07-01",
      manifest: { mainModule: entry, modulesRoot: fileURLToPath(root), modules },
      env: { ROOMS: { type: "durable-object", worker: "room-runtime-test", exportName: "RuntimeRoom" } },
      exports: { RuntimeRoom: { type: "durable-object", storage: "sqlite" } },
    } }],
    log: new Log(LogLevel.NONE),
  });
  t.after(() => mf.dispose());
  const request = (room, path) => mf.dispatchFetch(`http://local${path}${path.includes("?") ? "&" : "?"}room=${room}`);
  await t.test("unsupported schema remains stored after a real object restart", async () => {
    await request("schema", "/seed");
    const original = await (await request("schema", "/unsupported-schema")).json();
    try { await request("schema", "/reset"); } catch {}
    const response = await request("schema", "/internal/health");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "ROOM_RESTORE_FAILED");
    assert.deepEqual(await (await request("schema", "/stored")).json(), original);
  });
  for (const fault of ["serialize", "oversize", "rollback", "alarm"]) {
    await t.test(fault, async () => {
      assert.equal((await request(fault, "/seed")).status, 200);
      const first = await (await request(fault, `/command?fault=${fault}`)).json();
      const retry = await (await request(fault, "/command")).json();
      const committed = fault === "alarm";
      if (fault === "oversize") assert.match(first.failure, /SQLITE_TOOBIG/);
      for (const result of [first, retry]) {
        assert.equal(result.messages.some(message => message.type === "ack"), committed);
        assert.equal(result.unavailable, committed ? null : "ROOM_COMMIT_FAILED");
      }
      const stored = await (await request(fault, "/stored")).json();
      assert.equal(stored.game.board[0][0], committed ? "black" : null);
      assert.equal(stored.receipts.length, committed ? 1 : 0);
      // abort() destroys only this local object's instance, preserving storage.
      try { await request(fault, "/reset"); } catch {}
      const afterRestart = await (await request(fault, "/command")).json();
      assert.equal(afterRestart.messages[0].type, "ack");
      const recovered = await (await request(fault, "/stored")).json();
      assert.equal(recovered.game.board[0][0], "black");
      assert.equal(recovered.moveCount, 1);
      assert.equal(recovered.receipts.length, 1);
    });
  }
});

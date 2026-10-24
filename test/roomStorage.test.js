import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine } from "../src/multiplayer/roomEngine.js";
import {
  CHUNKED_ROOM_FORMAT,
  INLINE_ROOM_BYTES,
  ROOM_CHUNK_CHARS,
  STORAGE_KEY,
  chunkKey,
  loadRoomSnapshot,
  saveRoomSnapshot,
  splitRoomJson,
} from "../worker/roomStorage.js";

const encoder = new TextEncoder();

/** Durable Object storage: put/get/delete by key or in batches. */
function memoryStorage() {
  const values = new Map();
  const calls = [];
  return {
    values,
    calls,
    async get(key) {
      if (Array.isArray(key)) {
        return new Map(key.filter((name) => values.has(name)).map((name) => [name, structuredClone(values.get(name))]));
      }
      return structuredClone(values.get(key));
    },
    async put(key, value) {
      calls.push(typeof key === "string" ? ["put", key] : ["put", Object.keys(key)]);
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, entry] of Object.entries(key)) values.set(name, structuredClone(entry));
    },
    async delete(keys) {
      calls.push(["delete", keys]);
      for (const name of [].concat(keys)) values.delete(name);
    },
  };
}

test("a room under the inline limit is one plain value, written exactly as before", async () => {
  const storage = memoryStorage();
  const room = RoomEngine.create({ code: "STR234", name: "Host", size: 9, playerId: "host", tokenHash: "a".repeat(64) });
  const snapshot = room.serialize();
  assert.equal(await saveRoomSnapshot(storage, snapshot), 0);
  assert.deepEqual(storage.calls, [["put", STORAGE_KEY]]);
  assert.deepEqual(storage.values.get(STORAGE_KEY), snapshot);
  const loaded = await loadRoomSnapshot(storage, await storage.get(STORAGE_KEY));
  assert.deepEqual(loaded, { snapshot, chunks: 0 });
});

test("chunks never split a surrogate pair", () => {
  const json = `${"a".repeat(9)}😀${"b".repeat(9)}😀`;
  for (const size of [2, 3, 5, 10, 11]) {
    const parts = splitRoomJson(json, size);
    assert.equal(parts.join(""), json);
    for (const part of parts) {
      assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u, `size ${size}`);
    }
  }
});

test("a 30x30 room with a very long game is chunked, restored, and shrinks back", async () => {
  const room = RoomEngine.create({
    code: "LNG234", name: "Host", size: 30, playerId: "host",
    tokenHash: "a".repeat(64), startImmediately: false, now: 1_000,
  });
  room.applyAction({ playerId: "host", action: "request_game", payload: { mode: "local", size: 30 }, now: 1_001 });
  let seed = 7;
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x1_0000_0000;
  // Every Go position keeps a board-sized superko entry: about 0.9 KiB per move here.
  for (let played = 0; played < 2_100; played += 1) {
    const empty = [];
    room.game.board.forEach((row, r) => row.forEach((point, c) => {
      if (!point) empty.push([r, c]);
    }));
    let placed = false;
    for (let index = 0; index < empty.length && !placed; index += 1) {
      const pick = index + Math.floor(random() * (empty.length - index));
      [empty[index], empty[pick]] = [empty[pick], empty[index]];
      placed = room.game.play(...empty[index]).ok;
    }
    // Rarely no point is legal for the mover: a single pass keeps play going.
    if (!placed) assert.equal(room.game.pass().ok, true);
    room.state.moveCount += 1;
  }
  const snapshot = room.serialize();
  const bytes = encoder.encode(JSON.stringify(snapshot)).byteLength;
  assert.ok(bytes > 2 * 1024 * 1024, `snapshot is ${bytes} bytes`);

  const storage = memoryStorage();
  const chunks = await saveRoomSnapshot(storage, snapshot);
  assert.ok(chunks >= 2);
  const manifest = storage.values.get(STORAGE_KEY);
  assert.deepEqual(manifest, { storageFormat: CHUNKED_ROOM_FORMAT, chunks, bytes });
  // Manifest and chunks go in one atomic put.
  assert.deepEqual(storage.calls, [["put", [STORAGE_KEY, ...Array.from({ length: chunks }, (_, i) => chunkKey(i))]]]);
  for (let index = 0; index < chunks; index += 1) {
    assert.ok(storage.values.get(chunkKey(index)).length <= ROOM_CHUNK_CHARS);
  }

  const loaded = await loadRoomSnapshot(storage, await storage.get(STORAGE_KEY));
  assert.equal(loaded.chunks, chunks);
  const restored = RoomEngine.restore(loaded.snapshot);
  assert.equal(restored.state.moveCount, room.state.moveCount);
  assert.deepEqual(restored.game.getState().board, room.game.getState().board);
  assert.deepEqual(restored.serialize(), snapshot);

  // A missing chunk keeps the manifest, which restore refuses (storage kept).
  const broken = memoryStorage();
  for (const [key, value] of storage.values) broken.values.set(key, value);
  broken.values.delete(chunkKey(1));
  const partial = await loadRoomSnapshot(broken, await broken.get(STORAGE_KEY));
  assert.deepEqual(partial.snapshot, manifest);
  assert.throws(() => RoomEngine.restore(partial.snapshot), { code: "BAD_ROOM_STATE" });

  // A smaller room afterwards is inline again and the old chunks are deleted.
  storage.calls.length = 0;
  const small = RoomEngine.create({ code: "LNG234", name: "Host", size: 9, playerId: "host", tokenHash: "a".repeat(64) });
  assert.ok(encoder.encode(JSON.stringify(small.serialize())).byteLength < INLINE_ROOM_BYTES);
  assert.equal(await saveRoomSnapshot(storage, small.serialize(), chunks), 0);
  assert.deepEqual([...storage.values.keys()], [STORAGE_KEY]);
});

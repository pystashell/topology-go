/**
 * Room snapshot storage. A Durable Object storage value holds at most 2 MiB,
 * and a very long game on a 30x30 board (thousands of moves, each keeping a
 * board-sized superko entry) can outgrow that. Rooms up to INLINE_ROOM_BYTES
 * stay one plain value under "room", exactly as before; larger rooms store a
 * small manifest there and their JSON in "room:chunk:N" values, written in
 * one atomic put.
 *
 * A release without this module reads a manifest as an unknown room state:
 * the room stops (ROOM_RESTORE_FAILED) and its storage is kept.
 */

export const STORAGE_KEY = "room";
export const ROOM_CHUNK_PREFIX = "room:chunk:";
export const CHUNKED_ROOM_FORMAT = "chunked-json-v1";
// Measured as UTF-8 JSON, which never undercounts the stored value by much;
// the margin covers V8's own encoding of the same object.
export const INLINE_ROOM_BYTES = 1536 * 1024;
// At most 1 MiB per chunk even when stored as UTF-16.
export const ROOM_CHUNK_CHARS = 512 * 1024;
// One put writes at most 128 keys: the manifest and 127 chunks.
const MAX_ROOM_CHUNKS = 127;

const encoder = new TextEncoder();

export function chunkKey(index) {
  return `${ROOM_CHUNK_PREFIX}${index}`;
}

export function isChunkedRoom(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.storageFormat === CHUNKED_ROOM_FORMAT &&
    Number.isSafeInteger(value.chunks) &&
    value.chunks > 0 &&
    value.chunks <= MAX_ROOM_CHUNKS,
  );
}

function chunkKeys(from, to) {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => chunkKey(from + offset));
}

/** Cut JSON text into chunks without splitting a surrogate pair. */
export function splitRoomJson(json, size = ROOM_CHUNK_CHARS) {
  const parts = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(json.length, start + size);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(json.slice(start, end));
    start = end;
  }
  return parts;
}

/**
 * The stored room as RoomEngine.restore() accepts it: the inline snapshot,
 * or a chunked room's JSON text. A chunked room missing a part is returned
 * as its manifest, which restore rejects, so the storage is kept as it is.
 *
 * @returns {Promise<{snapshot: unknown, chunks: number}>}
 */
export async function loadRoomSnapshot(storage, stored) {
  if (!isChunkedRoom(stored)) return { snapshot: stored, chunks: 0 };
  const keys = chunkKeys(0, stored.chunks);
  const values = await storage.get(keys);
  const parts = keys.map((key) => values?.get?.(key));
  if (parts.some((part) => typeof part !== "string")) {
    return { snapshot: stored, chunks: stored.chunks };
  }
  return { snapshot: parts.join(""), chunks: stored.chunks };
}

/**
 * Store a room snapshot and return how many chunks it now uses (0 inline).
 * Chunks a previous, larger snapshot left behind are deleted afterwards;
 * the manifest's count alone decides what a read uses.
 */
export async function saveRoomSnapshot(storage, snapshot, previousChunks = 0) {
  const json = JSON.stringify(snapshot);
  // Most rooms are far below the limit; only encode when it could matter.
  const bytes = json.length * 3 <= INLINE_ROOM_BYTES ? 0 : encoder.encode(json).byteLength;
  if (bytes <= INLINE_ROOM_BYTES) {
    const stale = chunkKeys(0, previousChunks);
    if (stale.length === 0) {
      await storage.put(STORAGE_KEY, snapshot);
    } else {
      await Promise.all([storage.put(STORAGE_KEY, snapshot), storage.delete(stale)]);
    }
    return 0;
  }
  const parts = splitRoomJson(json);
  if (parts.length > MAX_ROOM_CHUNKS) {
    throw new RangeError(`Room snapshot needs ${parts.length} chunks`);
  }
  const entries = {
    [STORAGE_KEY]: { storageFormat: CHUNKED_ROOM_FORMAT, chunks: parts.length, bytes },
  };
  parts.forEach((part, index) => {
    entries[chunkKey(index)] = part;
  });
  const stale = chunkKeys(parts.length, previousChunks);
  await Promise.all([
    storage.put(entries),
    ...(stale.length ? [storage.delete(stale)] : []),
  ]);
  return parts.length;
}

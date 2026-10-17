import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ROUND_ARCHIVE,
  MAX_ROUND_ARCHIVE_BYTES,
  MAX_SPECTATORS,
  RoomEngine,
} from "../src/multiplayer/roomEngine.js";
import { CHAT_TEXT_MAX_CODE_POINTS } from "../src/multiplayer/chat.js";

const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(JSON.stringify(value)).byteLength;
const SIZE = 30;
const MOVES = 900;
const NAME = "棋".repeat(20);

function playRound(room, seed) {
  let state = seed;
  const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x1_0000_0000;
  for (let played = 0; played < MOVES;) {
    // Long random games: the engine checks legality, the room counts moves.
    if (room.game.play(Math.floor(random() * SIZE), Math.floor(random() * SIZE)).ok) {
      played += 1;
      room.state.moveCount += 1;
    }
  }
}

function startLocalRound(room, now) {
  room.applyAction({
    playerId: "host", action: "request_game", payload: { mode: "local", size: SIZE }, now,
  });
}

test("a fully loaded 30x30 room stays well under the 2 MiB storage value", () => {
  let now = 1_000_000;
  let room = RoomEngine.create({
    code: "BAG234", name: NAME, size: SIZE, playerId: "host",
    tokenHash: "a".repeat(64), startImmediately: false, now,
  });
  startLocalRound(room, now += 1);
  playRound(room, 1);
  room.applyAction({ playerId: "host", action: "resign", payload: { color: "black" }, now: now += 1 });
  startLocalRound(room, now += 1);
  const [longRound] = room.state.roundArchive;
  assert.ok(bytes(longRound) > 40_000, "a 900-move round archives a full replay");

  // A room saved by an older release could hold 24 such rounds (> 1 MiB).
  room.state.roundArchive = Array.from({ length: MAX_ROUND_ARCHIVE }, (_, index) => ({
    ...structuredClone(longRound), roundId: index + 1,
  }));
  room.state.match.roundId = MAX_ROUND_ARCHIVE + 1;
  assert.ok(bytes(room.state.roundArchive) > 2 * MAX_ROUND_ARCHIVE_BYTES);
  room = RoomEngine.restore(room.serialize());
  const restoredIds = room.state.roundArchive.map(({ roundId }) => roundId);
  assert.ok(bytes(room.state.roundArchive) <= MAX_ROUND_ARCHIVE_BYTES);
  assert.equal(restoredIds.at(-1), MAX_ROUND_ARCHIVE, "the newest rounds are kept");
  assert.deepEqual(restoredIds, restoredIds.map((_, index) => restoredIds[0] + index));

  // Finishing another long round drops the oldest to stay within budget.
  playRound(room, 2);
  room.applyAction({ playerId: "host", action: "resign", payload: { color: "white" }, now: now += 1 });
  startLocalRound(room, now += 1);
  assert.ok(bytes(room.state.roundArchive) <= MAX_ROUND_ARCHIVE_BYTES);
  assert.equal(room.state.roundArchive.at(-1).roundId, MAX_ROUND_ARCHIVE + 1);

  // Worst case beside it: a long live game, full chat, receipts and seats.
  playRound(room, 3);
  for (let index = 0; index < MAX_SPECTATORS; index += 1) {
    const playerId = `viewer-${index}`;
    room.join({
      name: `${NAME.slice(0, 18)}${String(index).padStart(2, "0")}`, role: "spectator",
      playerId, tokenHash: (index + 1).toString(16).padStart(64, "0"), now,
    });
    room.connections.set(`${playerId}-socket`, playerId);
  }
  for (let index = 1; index <= 200; index += 1) {
    const text = "长".repeat(CHAT_TEXT_MAX_CODE_POINTS);
    room.postChat({ playerId: "host", payload: { text }, sequence: index, now: now += 10_000 });
    room.postChat({ playerId: "viewer-0", payload: { text }, sequence: index, now: now += 10_000 });
  }
  for (let index = 0; index < 300; index += 1) {
    room.recordCommand({
      playerId: "host", id: `${"x".repeat(120)}${index}`.slice(-128), sequence: 10_000 + index,
      error: { code: "ILLEGAL_MOVE", message: "这一步不合法。", retryable: false }, now,
    });
  }
  const stored = bytes(room.serialize());
  assert.ok(stored < 1.75 * 1024 * 1024, `stored ${stored} bytes`);
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));

  // State messages carry round summaries, not the archived replays.
  const snapshot = room.snapshot(now);
  assert.equal(snapshot.roundArchive, undefined);
  assert.equal(snapshot.rounds.length, room.state.roundArchive.length);
  assert.ok(bytes(snapshot) < 256 * 1024, `snapshot ${bytes(snapshot)} bytes`);
});

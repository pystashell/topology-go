import assert from "node:assert/strict";
import test from "node:test";

import { RoomEngine, fnv1a64Hex } from "../src/multiplayer/roomEngine.js";
import { BadukRoom } from "../worker/BadukRoom.js";

// The original BigInt implementation, kept here as the reference oracle.
function bigIntFnv1a64Hex(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("32-bit FNV-1a 64 matches the BigInt reference byte for byte", () => {
  const encoder = new TextEncoder();
  for (const [text, expected] of [
    ["", "cbf29ce484222325"],
    ["a", "af63dc4c8601ec8c"],
    ["foobar", "85944171f73967e8"],
  ]) {
    assert.equal(fnv1a64Hex(encoder.encode(text)), expected);
  }

  const random = seededRandom(0x5eed);
  for (let sample = 0; sample < 400; sample += 1) {
    const length = sample < 40 ? sample : Math.floor(random() * 4_096);
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      // Bias towards the extremes so limb carries are exercised.
      const roll = random();
      bytes[index] = roll < 0.2 ? 0xff : roll < 0.3 ? 0 : Math.floor(random() * 256);
    }
    assert.equal(fnv1a64Hex(bytes), bigIntFnv1a64Hex(bytes), `sample ${sample}`);
  }

  const room = RoomEngine.create({
    code: "FNV234", name: "黑方 ☯", size: 9, playerId: "black",
    tokenHash: "a".repeat(64), now: 1_000,
  });
  const json = encoder.encode(JSON.stringify(room.serialize()));
  assert.equal(fnv1a64Hex(json), bigIntFnv1a64Hex(json));
});

test("a state broadcast builds one snapshot per viewer role, not per socket", (t) => {
  const engine = RoomEngine.create({
    code: "FNV234", name: "Black", size: 9, playerId: "black",
    tokenHash: "a".repeat(64), now: Date.now(),
  });
  engine.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64) });
  const viewers = ["v1", "v2", "v3"];
  viewers.forEach((playerId, index) => engine.join({
    name: `Viewer ${index}`, role: "spectator", playerId,
    tokenHash: String(index + 1).repeat(64),
  }));
  engine.postChat({ playerId: "v1", payload: { text: "spectator only" }, sequence: 1 });

  const sockets = ["black", "white", ...viewers].map((playerId) => ({
    readyState: 1,
    messages: [],
    deserializeAttachment: () => ({ connectionId: `${playerId}-socket`, identity: { playerId } }),
    send(raw) { this.messages.push(JSON.parse(raw)); },
  }));
  const room = Object.create(BadukRoom.prototype);
  room.engine = engine;
  room.ctx = { getWebSockets: () => sockets };
  const snapshot = t.mock.method(engine, "snapshot");

  room.broadcastState();

  assert.equal(snapshot.mock.callCount(), 2);
  for (const socket of sockets) assert.equal(socket.messages[0].type, "state");
  const chatCount = (socket) => socket.messages[0].room.chat.messages.length;
  assert.deepEqual(sockets.map(chatCount), [0, 0, 1, 1, 1]);
  assert.equal(sockets[0].messages[0].self.playerId, "black");
  assert.equal(sockets[4].messages[0].self.playerId, "v3");
});

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChatPayload } from "../src/multiplayer/chat.js";
import { lobbySummaryFromRoom } from "../src/multiplayer/lobby.js";
import { RoomEngine, RoomEngineError } from "../src/multiplayer/roomEngine.js";
import worker from "../worker/index.js";

const HIDDEN = [
  "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩",
  "​", "‌", "‍", "‎", "‏", " ", " ", "﻿",
  "\u0000", "\u0007", "\u001b", "\u007f", "\u0085", "\u009f",
];

function createRoom(name, now = 1_000) {
  return RoomEngine.create({
    code: "HDN234", name, size: 9, playerId: "host", tokenHash: "a".repeat(64), now,
  });
}

test("public names drop bidi, zero-width and control characters", () => {
  const room = createRoom(`A${HIDDEN.join("")}dmin‮gnp.exe`);
  assert.equal(room.member("host").name, "Admingnp.exe");
  const joined = room.join({
    name: "⁧Guest⁩ ​ One", role: "spectator", playerId: "guest",
    tokenHash: "b".repeat(64), now: 1_100,
  });
  assert.equal(joined.identity.name, "Guest One");
  assert.deepEqual(
    lobbySummaryFromRoom(room.snapshot(1_100)).players.map(({ name }) => name),
    ["Admingnp.exe"],
  );
  for (const name of ["​‮", HIDDEN.join("")]) {
    assert.throws(
      () => createRoom(name),
      (error) => error instanceof RoomEngineError && error.code === "BAD_REQUEST",
    );
  }
  // Twenty visible characters still fit even when padded with hidden ones.
  assert.equal(createRoom(`${"棋".repeat(20)}​‮`).member("host").name, "棋".repeat(20));
});

test("stored names are cleaned on restore instead of breaking the room", () => {
  const stored = createRoom("Host").serialize();
  stored.members[0].name = "Ho‮st";
  stored.members.push({ ...structuredClone(stored.members[0]), playerId: "ghost",
    name: "​", role: "spectator", color: null, tokenHash: "c".repeat(64) });
  stored.chatMessages = [{
    id: "host:1", sequence: 1, senderId: "host", senderName: "Ho\u202est",
    senderRole: "player", senderColor: "black", channel: "players", kind: "text",
    text: "hi", points: [], boardWidth: 9, boardHeight: 9, boardSize: 9,
    boardTopology: "cylinder", moveCount: 0, sentAt: 1_000,
  }];
  stored.chatSequence = 1;
  const restored = RoomEngine.restore(stored);
  assert.equal(restored.member("host").name, "Host");
  assert.equal(restored.snapshot(1_100).chat.messages[0].senderName, "Host");
  assert.equal(restored.member("ghost").name, "​", "a name with nothing visible is kept as stored");
});

test("the HTTP API rejects names that are only hidden characters", async () => {
  for (const path of ["/api/rooms", "/api/rooms/HDN234/join"]) {
    const response = await worker.fetch(new Request(`https://baduk.test${path}`, {
      method: "POST",
      body: JSON.stringify({ v: 2, name: "‮​\u0007", role: "player" }),
    }), {});
    assert.equal(response.status, 400);
  }
});

test("chat drops bidi and zero-width tricks but keeps lines and emoji", () => {
  const board = { size: 19, topology: "cylinder" };
  const { text } = normalizeChatPayload({
    kind: "text",
    text: "‮evil‬ D4​\r\nnext\tline 👨‍👩‍👧⁦x⁩﻿\u0007",
  }, board);
  assert.equal(text, "evil D4\nnext\tline 👨‍👩‍👧x");
  // Line separators cannot sidestep the four-line limit.
  assert.equal(
    normalizeChatPayload({ kind: "text", text: "1 2 3 4 5" }, board).text,
    "12345",
  );
  assert.throws(() => normalizeChatPayload({ kind: "text", text: "‮​" }, board));
});

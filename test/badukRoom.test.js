import assert from "node:assert/strict";
import test from "node:test";

import { BadukRoom } from "../worker/BadukRoom.js";
import {
  CHAT_CHANNEL_PLAYERS,
  CHAT_CHANNEL_SPECTATORS,
} from "../src/multiplayer/chat.js";

function socketFor(identity) {
  const messages = [];
  return {
    readyState: 1,
    messages,
    deserializeAttachment() {
      return {
        connectionId: "viewer-socket",
        identity,
        connectedAt: 1_000,
      };
    },
    send(raw) {
      messages.push(JSON.parse(raw));
    },
  };
}

test("stale spectator commands persist their rate-limit token before replying", async () => {
  const writes = [];
  const rateLimitCalls = [];
  const identity = {
    playerId: "viewer",
    playerName: "Viewer",
    role: "spectator",
    color: null,
  };
  const socket = socketFor(identity);
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    storage: {
      async put(key, value) {
        writes.push({ key, value });
      },
    },
  };
  durableObject.engine = {
    bumpDirectoryRevision() {},
    inspectCommand() {
      return { kind: "stale", previousSequence: 7 };
    },
    enforceSpectatorCommandRateLimit(request) {
      rateLimitCalls.push(request);
    },
    serialize() {
      return { persistedRateLimit: true };
    },
    snapshot() {
      return {
        code: "ABC123",
        revision: 9,
        players: [],
        spectators: [],
        game: {},
      };
    },
  };

  await durableObject.handleCommand(socket, { identity }, {
    id: "stale-1",
    sequence: 7,
    action: "sync",
    payload: {},
  });

  assert.deepEqual(rateLimitCalls, [
    { playerId: "viewer", action: "sync" },
  ]);
  assert.deepEqual(writes, [
    { key: "room", value: { persistedRateLimit: true } },
  ]);
  assert.equal(socket.messages[0].type, "error");
  assert.equal(socket.messages[0].code, "STALE_COMMAND");
  assert.equal(socket.messages[1].type, "state");
});

test("stale player commands do not add an unnecessary persistence write", async () => {
  let writes = 0;
  const identity = {
    playerId: "black-player",
    playerName: "Black",
    role: "player",
    color: "black",
  };
  const socket = socketFor(identity);
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    storage: {
      async put() {
        writes += 1;
      },
    },
  };
  durableObject.engine = {
    inspectCommand() {
      return { kind: "stale", previousSequence: 3 };
    },
    enforceSpectatorCommandRateLimit() {},
    snapshot() {
      return {
        code: "ABC123",
        revision: 4,
        players: [],
        spectators: [],
        game: {},
      };
    },
  };

  await durableObject.handleCommand(socket, { identity }, {
    id: "stale-player",
    sequence: 3,
    action: "sync",
    payload: {},
  });

  assert.equal(writes, 0);
  assert.equal(socket.messages[0].code, "STALE_COMMAND");
  assert.equal(socket.messages[1].type, "state");
});

test("room persistence never depends on the optional one-way room index", async (t) => {
  t.mock.method(console, "error", () => {});
  const writes = [];
  const background = [];
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    storage: {
      async put(key, value) {
        writes.push({ key, value });
      },
    },
    waitUntil(promise) {
      background.push(promise);
    },
  };
  durableObject.env = {
    BADUK_ROOM_INDEX: {
      getByName() {
        return {
          async fetch() {
            throw new Error("index unavailable");
          },
        };
      },
    },
  };
  durableObject.engine = {
    bumpDirectoryRevision() {},
    serialize() {
      return { durable: true };
    },
    snapshot() {
      return {
        code: "ABC123",
        revision: 1,
        players: [],
        spectators: [],
        game: { width: 9, height: 9, topology: "cylinder" },
      };
    },
  };

  await durableObject.persist();
  assert.deepEqual(writes, [{ key: "room", value: { durable: true } }]);
  assert.equal(background.length, 1);
  await assert.doesNotReject(background[0]);
});

test("chat broadcasts keep spectator messages out of player sockets", () => {
  const playerSocket = socketFor({
    playerId: "black-player",
    playerName: "Black",
    role: "player",
    color: "black",
  });
  const spectatorSocket = socketFor({
    playerId: "viewer",
    playerName: "Viewer",
    role: "spectator",
    color: null,
  });
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    getWebSockets() {
      return [playerSocket, spectatorSocket];
    },
  };

  const playerMessage = {
    id: "chat-player",
    sequence: 1,
    channel: CHAT_CHANNEL_PLAYERS,
    senderRole: "player",
    senderColor: "black",
  };
  const spectatorMessage = {
    id: "chat-spectator",
    sequence: 2,
    channel: CHAT_CHANNEL_SPECTATORS,
    senderRole: "spectator",
    senderColor: null,
  };

  durableObject.broadcastChat(playerMessage);
  durableObject.broadcastChat(spectatorMessage);

  assert.deepEqual(
    playerSocket.messages.map((message) => message.message.id),
    ["chat-player"],
  );
  assert.deepEqual(
    spectatorSocket.messages.map((message) => message.message.id),
    ["chat-player", "chat-spectator"],
  );
});

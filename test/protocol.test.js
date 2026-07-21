import assert from "node:assert/strict";
import test from "node:test";

import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
  LEGACY_BADUK_WS_PROTOCOL,
  normalizeCommandMessage,
  parseWebSocketProtocols,
  ROOM_ACTIONS,
  UNVERSIONED_BADUK_WS_PROTOCOL,
} from "../src/multiplayer/protocol.js";

test("protocol v2 is explicit while stale socket names remain detectable", () => {
  assert.equal(BADUK_PROTOCOL_VERSION, 2);
  assert.equal(BADUK_WS_PROTOCOL, "bamboo-baduk-v2");
  assert.equal(
    normalizeCommandMessage({
      v: 1,
      type: "command",
      id: "stale-v1",
      sequence: 1,
      action: "pass",
    }),
    null,
  );
  assert.equal(
    normalizeCommandMessage({
      type: "command",
      id: "missing-version",
      sequence: 1,
      action: "pass",
    }),
    null,
  );
  assert.deepEqual(
    parseWebSocketProtocols(`${BADUK_WS_PROTOCOL}, reconnect-token`),
    { protocol: BADUK_WS_PROTOCOL, token: "reconnect-token" },
  );
  assert.deepEqual(
    parseWebSocketProtocols(`${LEGACY_BADUK_WS_PROTOCOL}, old-token`),
    { protocol: LEGACY_BADUK_WS_PROTOCOL, token: "old-token" },
  );
  assert.deepEqual(
    parseWebSocketProtocols(`${UNVERSIONED_BADUK_WS_PROTOCOL}, old-token`),
    { protocol: UNVERSIONED_BADUK_WS_PROTOCOL, token: "old-token" },
  );
});

test("undo room actions pass through the WebSocket command whitelist", () => {
  for (const action of ["request_undo", "respond_undo", "cancel_undo"]) {
    assert.ok(ROOM_ACTIONS.includes(action));
    assert.deepEqual(
      normalizeCommandMessage({
        v: 2,
        type: "command",
        id: `undo-${action}`,
        sequence: 1,
        action,
        payload: action === "respond_undo"
          ? { accept: true, targetMoveCount: 2 }
          : {},
      }),
      {
        id: `undo-${action}`,
        sequence: 1,
        action,
        payload: action === "respond_undo"
          ? { accept: true, targetMoveCount: 2 }
          : {},
      },
    );
  }
});

test("resignation is a reconnect-safe room command", () => {
  assert.ok(ROOM_ACTIONS.includes("resign"));
  assert.deepEqual(
    normalizeCommandMessage({
      v: 2,
      type: "command",
      id: "resign-1",
      sequence: 3,
      action: "resign",
      payload: {},
    }),
    {
      id: "resign-1",
      sequence: 3,
      action: "resign",
      payload: {},
    },
  );
});

test("online AI seat commands pass through the reconnect-safe whitelist", () => {
  const commands = [
    ["attach_ai", { modelId: "b10" }],
    ["detach_ai", {}],
    ["ai_play", {
      row: 3,
      col: 4,
      expectedMoveCount: 1,
      expectedPositionToken: "pos-v1-0123456789abcdef-1",
    }],
    ["ai_pass", {
      expectedMoveCount: 1,
      expectedPositionToken: "pos-v1-0123456789abcdef-1",
    }],
    ["direct_undo_ai_round", {
      expectedMoveCount: 2,
      expectedPositionToken: "pos-v1-fedcba9876543210-2",
    }],
  ];

  for (const [action, payload] of commands) {
    assert.ok(ROOM_ACTIONS.includes(action));
    assert.deepEqual(
      normalizeCommandMessage({
        v: 2,
        type: "command",
        id: `online-ai-${action}`,
        sequence: 4,
        action,
        payload,
      }),
      {
        id: `online-ai-${action}`,
        sequence: 4,
        action,
        payload,
      },
    );
  }
});

test("chat is whitelisted and requires a reconnect-safe command sequence", () => {
  assert.ok(ROOM_ACTIONS.includes("chat"));
  assert.deepEqual(
    normalizeCommandMessage({
      v: 2,
      type: "command",
      id: "chat-1",
      sequence: 7,
      action: "chat",
      payload: { kind: "text", text: "D4 这里怎么样？" },
    }),
    {
      id: "chat-1",
      sequence: 7,
      action: "chat",
      payload: { kind: "text", text: "D4 这里怎么样？" },
    },
  );
  assert.equal(
    normalizeCommandMessage({
      v: 2,
      type: "command",
      id: "chat-without-sequence",
      action: "chat",
      payload: { kind: "text", text: "不能重复入库" },
    }),
    null,
  );
});

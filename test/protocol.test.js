import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCommandMessage,
  ROOM_ACTIONS,
} from "../src/multiplayer/protocol.js";

test("undo room actions pass through the WebSocket command whitelist", () => {
  for (const action of ["request_undo", "respond_undo", "cancel_undo"]) {
    assert.ok(ROOM_ACTIONS.includes(action));
    assert.deepEqual(
      normalizeCommandMessage({
        v: 1,
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeLobbyBoardPreview,
  describeLobbyBoardPreview,
  encodeLobbyBoardPreview,
  isLobbyBoardPreview,
  publicLobbyLastMove,
  renderLobbyBoardPreview,
} from "../src/multiplayer/lobbyPreview.js";

function board(width = 5, height = 3) {
  const value = Array.from({ length: height }, () => Array(width).fill(null));
  value[0][0] = "black";
  value[1][2] = "white";
  return value;
}

function summary(overrides = {}) {
  const value = board();
  return {
    width: 5,
    height: 3,
    topology: "mobius",
    boardPreview: encodeLobbyBoardPreview(value, 5, 3),
    lastMove: { type: "play", color: "white", row: 1, col: 2 },
    ...overrides,
  };
}

test("two-bit previews round-trip rectangular boards", () => {
  const value = board();
  const preview = encodeLobbyBoardPreview(value, 5, 3);
  assert.equal(preview.encoding, "2bit-base64-v1");
  assert.equal(atob(preview.data).length, 4, "15 points occupy four bytes");
  assert.deepEqual(decodeLobbyBoardPreview(preview, 5, 3), value);
  assert.equal(isLobbyBoardPreview(preview, 5, 3), true);
});

test("preview codecs reject malformed boards, envelopes, reserved values, and padding", () => {
  assert.throws(
    () => encodeLobbyBoardPreview([["black"]], 5, 3),
    /exactly 3 rows/u,
  );
  const invalidStone = board();
  invalidStone[0][1] = "red";
  assert.throws(() => encodeLobbyBoardPreview(invalidStone, 5, 3), /invalid stone/u);

  const valid = encodeLobbyBoardPreview(board(), 5, 3);
  assert.throws(
    () => decodeLobbyBoardPreview({ ...valid, secret: "no" }, 5, 3),
    /unexpected fields/u,
  );
  assert.throws(
    () => decodeLobbyBoardPreview({ encoding: "2bit-base64-v1", data: "wAAAAA==" }, 5, 3),
    /reserved stone/u,
  );
  assert.throws(
    () => decodeLobbyBoardPreview({ encoding: "2bit-base64-v1", data: "AAAB" }, 3, 3),
    /padding bits/u,
  );
  assert.equal(isLobbyBoardPreview({ encoding: "2bit-base64-v1", data: "!!!!" }, 5, 3), false);
});

test("public last moves strip captures and reject off-board coordinates", () => {
  assert.deepEqual(publicLobbyLastMove({
    type: "play",
    color: "black",
    row: 2,
    col: 4,
    captured: [{ row: 2, col: 3 }],
    token: "private",
  }, 5, 3), {
    type: "play",
    color: "black",
    row: 2,
    col: 4,
  });
  assert.deepEqual(publicLobbyLastMove({ type: "pass", color: "white", clock: 123 }, 5, 3), {
    type: "pass",
    color: "white",
  });
  assert.throws(
    () => publicLobbyLastMove({ type: "play", color: "black", row: 3, col: 0 }, 5, 3),
    /outside the board/u,
  );
});

test("descriptions summarize only the public board position", () => {
  assert.equal(
    describeLobbyBoardPreview(summary()),
    "5 × 3 莫比乌斯棋盘，黑棋 1 子，白棋 1 子。 最后一手：白棋 C2。",
  );
  assert.equal(
    describeLobbyBoardPreview(summary(), { locale: "en-US" }),
    "5 by 3 Mobius strip board. 1 black stone and 1 white stone. Last move: white at C2.",
  );
});

test("canvas renderer draws stones, topology seams, last-move marker, and aria text", () => {
  const calls = [];
  const context = {
    save() { calls.push("save"); },
    restore() { calls.push("restore"); },
    clearRect() { calls.push("clearRect"); },
    fillRect() { calls.push("fillRect"); },
    beginPath() { calls.push("beginPath"); },
    moveTo() { calls.push("moveTo"); },
    lineTo() { calls.push("lineTo"); },
    closePath() { calls.push("closePath"); },
    stroke() { calls.push("stroke"); },
    fill() { calls.push("fill"); },
    arc() { calls.push("arc"); },
    setLineDash(value) { calls.push(`dash:${value.length}`); },
  };
  const attributes = new Map();
  const canvas = {
    width: 240,
    height: 120,
    getContext(type) {
      assert.equal(type, "2d");
      return context;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const description = renderLobbyBoardPreview(canvas, summary());
  assert.equal(calls.filter((call) => call === "arc").length, 3);
  assert.ok(calls.includes("dash:2"));
  assert.equal(attributes.get("role"), "img");
  assert.equal(attributes.get("aria-label"), description);
});

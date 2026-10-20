import assert from "node:assert/strict";
import test from "node:test";

import { attachGomokuAiWorker } from "../src/ai/gomoku/gomokuAiWorker.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";

// The worker protocol over a fake worker scope, with the real AI and the
// real Rapfi WebAssembly engine behind it.

function fakeScope() {
  const listeners = [];
  const messages = [];
  const waiters = [];
  const scope = {
    postMessage(message) {
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.match(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
  };
  return {
    scope,
    messages,
    send(data) {
      for (const listener of listeners) listener({ data });
    },
    next(match) {
      const found = messages.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ match, resolve }));
    },
  };
}

function midgame() {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  for (const [row, col] of [[7, 7], [8, 8], [6, 8], [9, 7]]) board[row][col] = "black";
  for (const [row, col] of [[7, 8], [8, 7], [6, 6], [9, 9]]) board[row][col] = "white";
  return {
    gameType: "gomoku",
    ruleSet: "freestyle",
    width: 15,
    height: 15,
    topology: "torus",
    board,
    currentPlayer: "black",
    lastMove: { row: 9, col: 9, color: "white" },
    moveCount: 8,
  };
}

test("worker: init, choose-move with progress, cancel, unknown messages", async () => {
  const worker = fakeScope();
  attachGomokuAiWorker(worker.scope);

  worker.send({ type: "init", requestId: 1 });
  const ready = await worker.next((m) => m.requestId === 1);
  assert.equal(ready.type, "ready");
  assert.equal(ready.info.engine, "rapfi");
  assert.equal(ready.info.license, "GPL-3.0-or-later");
  assert.deepEqual(ready.info.levels, ["easy", "normal", "hard"]);
  assert.equal(ready.info.rapfi, true);

  const position = midgame();
  worker.send({ type: "choose-move", requestId: 2, position, settings: { level: "normal", timeLimitMs: 500 } });
  const answer = await worker.next((m) => m.requestId === 2 && (m.type === "move" || m.type === "error"));
  assert.equal(answer.type, "move", JSON.stringify(answer));
  assert.equal(answer.info.engine, "rapfi");
  assert.ok(typeof answer.info.ms === "number");
  const game = new GomokuEngine({ ...position, initialBoard: position.board });
  assert.equal(game.checkPlay(answer.move.row, answer.move.col).ok, true);
  assert.ok(worker.messages.some((m) => m.requestId === 2 && m.type === "progress"));

  worker.send({ type: "choose-move", requestId: 3, position, settings: { level: "hard", timeLimitMs: 20_000 } });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const cancelAt = performance.now();
  worker.send({ type: "cancel", requestId: 3 });
  const cancelled = await worker.next((m) => m.requestId === 3 && m.type === "error");
  assert.equal(cancelled.code, "CANCELLED");
  assert.ok(performance.now() - cancelAt < 50, "cancel is answered immediately");
  // The aborted search must not answer later.
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(worker.messages.filter((m) => m.requestId === 3 && m.type !== "progress").length, 1);

  worker.send({ type: "choose-move", requestId: 4, position: { ...position, board: [] }, settings: {} });
  const bad = await worker.next((m) => m.requestId === 4 && m.type === "error");
  assert.equal(bad.code, "BAD_POSITION");

  worker.send({ type: "nonsense", requestId: 5 });
  const unknown = await worker.next((m) => m.requestId === 5);
  assert.equal(unknown.code, "BAD_REQUEST");

  // The engine still answers after the cancellation.
  worker.send({ type: "choose-move", requestId: 6, position, settings: { level: "easy", timeLimitMs: 200 } });
  const again = await worker.next((m) => m.requestId === 6 && m.type !== "progress");
  assert.equal(again.type, "move");
});

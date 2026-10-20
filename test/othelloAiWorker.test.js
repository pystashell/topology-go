import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import { createOthelloAiWorkerHandler } from "../src/ai/othello/othelloAiWorkerHandler.js";
import { createRandom } from "../src/ai/othello/othelloGeometry.js";

function positionAfter(plies, { topology = "cylinder", width = 8, height = 8, seed = 1 } = {}) {
  const random = createRandom(seed);
  const engine = new OthelloEngine({ width, height, topology });
  for (let ply = 0; ply < plies; ply += 1) {
    const legal = engine.legalMoves();
    const move = legal[Math.floor(random() * legal.length)];
    engine.play(move.row, move.col);
  }
  return {
    engine,
    position: {
      gameType: "othello",
      width,
      height,
      topology,
      board: engine.getBoard(),
      currentPlayer: engine.currentPlayer,
      lastMove: null,
      moveCount: plies,
    },
  };
}

/** A handler whose posted messages can be awaited. */
function harness(options) {
  const messages = [];
  const waiters = [];
  const handle = createOthelloAiWorkerHandler((message) => {
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  }, options);
  const next = (match) =>
    new Promise((resolve) => {
      const found = messages.find(match);
      if (found) resolve(found);
      else waiters.push({ match, resolve });
    });
  return { handle, messages, next };
}

test("othello AI worker answers init with its engine info", async () => {
  const { handle, next } = harness();
  handle({ type: "init", requestId: "i1" });
  const ready = await next((message) => message.requestId === "i1");
  assert.equal(ready.type, "ready");
  assert.equal(ready.info.engine, "topo-othello");
  assert.deepEqual(ready.info.levels, ["easy", "normal", "hard"]);
  assert.equal(typeof ready.info.version, "string");
  assert.equal(typeof ready.info.license, "string");
  // Idempotent.
  handle({ type: "init", requestId: "i2" });
  assert.equal((await next((message) => message.requestId === "i2")).type, "ready");
});

test("othello AI worker returns a legal move with info and progress", async () => {
  const { handle, next, messages } = harness();
  const { engine, position } = positionAfter(10, { topology: "mobius" });
  handle({
    type: "choose-move",
    requestId: 7,
    position,
    settings: { level: "hard", timeLimitMs: 200 },
  });
  const reply = await next((message) => message.requestId === 7 && message.type !== "progress");
  assert.equal(reply.type, "move");
  assert.equal(engine.checkPlay(reply.move.row, reply.move.col).ok, true);
  assert.deepEqual(Object.keys(reply.move).sort(), ["col", "row"]);
  assert.equal(reply.info.engine, "topo-othello");
  assert.ok(reply.info.ms <= 240);
  assert.ok(reply.info.depth >= 1);
  const progress = messages.filter((message) => message.type === "progress");
  assert.ok(progress.length >= 1);
  assert.ok(progress.every((message) => message.requestId === 7 && message.info.depth >= 1));
});

test("othello AI worker cancels a running search promptly and only once", async () => {
  const { handle, next, messages } = harness();
  const { position } = positionAfter(100, { topology: "torus", width: 20, height: 20 });
  handle({ type: "choose-move", requestId: "c1", position, settings: { level: "hard" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = performance.now();
  handle({ type: "cancel", requestId: "c1" });
  const reply = await next((message) => message.requestId === "c1" && message.type === "error");
  assert.equal(reply.code, "CANCELLED");
  assert.ok(performance.now() - started < 50);
  // The aborted search ends without posting a move later.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const finals = messages.filter(
    (message) => message.requestId === "c1" && message.type !== "progress",
  );
  assert.deepEqual(finals.map((message) => message.type), ["error"]);
  // Cancelling an unknown or finished request is ignored.
  handle({ type: "cancel", requestId: "c1" });
  handle({ type: "cancel", requestId: "nope" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(messages.filter((message) => message.code === "CANCELLED").length, 1);
});

test("othello AI worker reports errors with codes", async () => {
  const { handle, next } = harness();
  const { position } = positionAfter(4);
  handle({ type: "choose-move", requestId: "bad", position: { ...position, width: 9 } });
  assert.equal((await next((message) => message.requestId === "bad")).code, "INVALID_POSITION");
  handle({ type: "choose-move", requestId: "lvl", position, settings: { level: "god" } });
  assert.equal((await next((message) => message.requestId === "lvl")).code, "INVALID_SETTINGS");
  handle({ type: "bogus", requestId: "x" });
  assert.equal((await next((message) => message.requestId === "x")).code, "UNKNOWN_MESSAGE");
  // A crashing search is reported, not thrown.
  const crashing = harness({
    choose: async () => {
      throw new Error("boom");
    },
  });
  crashing.handle({ type: "choose-move", requestId: "boom", position });
  const reply = await crashing.next((message) => message.requestId === "boom");
  assert.deepEqual([reply.type, reply.code, reply.message], ["error", "INTERNAL", "boom"]);
});

test("othello AI worker module wires the handler to the worker global", () => {
  const source = readFileSync(
    new URL("../src/ai/othello/othelloAiWorker.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /createOthelloAiWorkerHandler\(\(message\) => self\.postMessage\(message\)\)/);
  assert.match(source, /self\.addEventListener\("message"/);
  // No WebAssembly, network or dynamic code in the Othello AI.
  for (const file of [
    "othelloAi.js",
    "othelloAiWorker.js",
    "othelloAiWorkerHandler.js",
    "othelloBoard.js",
    "othelloEval.js",
    "othelloGeometry.js",
    "othelloSearch.js",
    "othelloWeights.js",
  ]) {
    const text = readFileSync(new URL(`../src/ai/othello/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /WebAssembly|fetch\(|importScripts|new Function|eval\(/, file);
  }
});

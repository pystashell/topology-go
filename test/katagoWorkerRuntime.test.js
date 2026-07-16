import test from "node:test";
import assert from "node:assert/strict";

import { attachKataGoWorkerRuntime } from "../src/ai/katagoWorkerRuntime.js";

class FakeWorkerScope {
  constructor() {
    this.listeners = [];
    this.messages = [];
  }

  addEventListener(type, listener) {
    assert.equal(type, "message");
    this.listeners.push(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  async dispatch(data) {
    await Promise.all(this.listeners.map((listener) => listener({ data })));
  }
}

function neuralResult(overrides = {}) {
  return {
    priors: new Float32Array([0.1, 0.9]),
    modelName: "test-b10",
    backend: "cpu",
    compressedBytes: 1234,
    inferenceMs: 12.5,
    ...overrides,
  };
}

test("KataGo runtime returns the move, enforced options, and hybrid stats", async () => {
  const scope = new FakeWorkerScope();
  const state = { turn: 7 };
  const neural = neuralResult();
  let receivedState;
  let receivedOptions;

  attachKataGoWorkerRuntime(scope, {
    async neuralPolicy({ state: policyState, postStatus }) {
      assert.equal(policyState, state);
      postStatus("neural_inference", { backend: neural.backend });
      return neural;
    },
    async chooseMove(searchState, options) {
      receivedState = searchState;
      receivedOptions = options;
      return {
        move: { type: "play", row: 2, col: 3 },
        stats: { visits: 81, engine: "must-be-overridden" },
      };
    },
  });

  await scope.dispatch({
    type: "think",
    id: 42,
    state,
    options: {
      timeLimitMs: 900,
      difficulty: "easy",
      candidateLimit: 1,
      rootPolicy: "stale",
    },
  });

  assert.equal(receivedState, state);
  assert.equal(receivedOptions.timeLimitMs, 900);
  assert.equal(receivedOptions.difficulty, "hard");
  assert.equal(receivedOptions.candidateLimit, 24);
  assert.equal(receivedOptions.rootPolicy, neural.priors);
  assert.equal(receivedOptions.signal.aborted, false);
  assert.deepEqual(scope.messages.at(-1), {
    type: "result",
    id: 42,
    move: { type: "play", row: 2, col: 3 },
    stats: {
      visits: 81,
      engine: "katago-hybrid",
      modelName: "test-b10",
      backend: "cpu",
      modelBytes: 1234,
      inferenceMs: 12.5,
    },
  });
});

test("neural failure emits an error and never starts tactical search", async () => {
  const scope = new FakeWorkerScope();
  let searchCalls = 0;

  attachKataGoWorkerRuntime(scope, {
    async neuralPolicy() {
      throw new Error("model unavailable");
    },
    async chooseMove() {
      searchCalls += 1;
      return { move: { type: "pass" }, stats: {} };
    },
  });

  await scope.dispatch({ type: "think", id: 5, state: { turn: 1 } });

  assert.equal(searchCalls, 0);
  assert.deepEqual(scope.messages, [
    { type: "error", id: 5, message: "model unavailable" },
  ]);
});

test("cancel aborts an active job and emits the cancellation protocol error", async () => {
  const scope = new FakeWorkerScope();
  let searchCalls = 0;

  attachKataGoWorkerRuntime(scope, {
    neuralPolicy({ signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    },
    async chooseMove() {
      searchCalls += 1;
      return { move: { type: "pass" }, stats: {} };
    },
  });

  const thinking = scope.dispatch({ type: "think", id: 9, state: {} });
  await scope.dispatch({ type: "cancel", id: 9 });
  await thinking;

  assert.equal(searchCalls, 0);
  assert.deepEqual(scope.messages, [
    {
      type: "error",
      id: 9,
      message: "AI search was cancelled",
      code: "AI_SEARCH_CANCELLED",
    },
  ]);
});

test("one attached runtime handles successive turns without stale job state", async () => {
  const scope = new FakeWorkerScope();
  let searchCalls = 0;

  attachKataGoWorkerRuntime(scope, {
    async neuralPolicy({ state }) {
      return neuralResult({ priors: new Float32Array([state.turn, 1]) });
    },
    async chooseMove(state, options) {
      searchCalls += 1;
      assert.equal(options.rootPolicy[0], state.turn);
      return {
        move: { type: "play", row: state.turn, col: 0 },
        stats: { turn: state.turn },
      };
    },
  });

  await scope.dispatch({ type: "think", id: 1, state: { turn: 1 } });
  await scope.dispatch({ type: "think", id: 1, state: { turn: 2 } });

  assert.equal(searchCalls, 2);
  assert.deepEqual(
    scope.messages
      .filter((message) => message.type === "result")
      .map(({ move, stats }) => ({ move, turn: stats.turn })),
    [
      { move: { type: "play", row: 1, col: 0 }, turn: 1 },
      { move: { type: "play", row: 2, col: 0 }, turn: 2 },
    ],
  );
});

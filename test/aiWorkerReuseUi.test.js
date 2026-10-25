import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { appSource } from "./helpers/appSource.js";

const main = appSource();
const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `expected main.js to contain ${from}`);
  return main.slice(start, end);
};

function harness() {
  const timers = [];
  const terminated = [];
  const worker = (name) => ({ name, terminate() { terminated.push(name); } });
  const context = {
    AI_WORKER_IDLE_RELEASE_MS: 600_000,
    aiRequestId: 0,
    aiWorker: worker("first"),
    aiWorkerModelId: "b10",
    aiWorkerBusy: false,
    aiWorkerIdleTimer: null,
    aiThinking: false,
    aiWorkerContext: null,
    AI_CONTEXT_HINT: "hint",
    GAME_AI_ERRORS: { CANCELLED: "AI_SEARCH_CANCELLED" },
    aiGameActive: false,
    gameAICancels: [],
    // Recorded as plain JSON: objects made inside the vm context are not
    // deep-equal to this realm's literals.
    cancelGameAITurn: (options) => context.gameAICancels.push(JSON.stringify(options)),
    isAIMode: () => context.aiGameActive,
    isOnlineAIController: () => false,
    elements: { boardStage: { removeAttribute() {} } },
    window: {
      setTimeout(callback, delay) {
        const timer = { callback, delay, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { if (timer) timer.cleared = true; },
    },
  };
  const api = vm.runInNewContext(
    `${slice("function clearAIWorkerIdleRelease()", "function closeAIDialog()")}
    ({ cancelAIThinking })`,
    context,
  );
  return { ...api, context, timers, terminated, worker };
}

test("an idle AI worker survives the end of a game for the next one", () => {
  const ai = harness();
  ai.cancelAIThinking();
  assert.deepEqual(ai.terminated, []);
  assert.equal(ai.context.aiWorker.name, "first");
  assert.equal(ai.context.aiWorkerModelId, "b10");
  assert.equal(ai.context.aiRequestId, 1, "replies to the cancelled request are ignored");
  // Gomoku and Othello engines are cancelled too, and keep their worker.
  assert.deepEqual(ai.context.gameAICancels, ['{"terminate":false}']);
});

test("busy, failed or explicitly released workers are terminated", () => {
  const busy = harness();
  busy.context.aiWorkerBusy = true;
  busy.cancelAIThinking();
  assert.deepEqual(busy.terminated, ["first"]);
  assert.equal(busy.context.aiWorker, null);
  assert.equal(busy.context.aiWorkerModelId, null);

  const released = harness();
  released.cancelAIThinking({ terminate: true });
  assert.deepEqual(released.terminated, ["first"]);
  assert.deepEqual(released.context.gameAICancels, ['{"terminate":true}']);
});

test("a kept worker is released after a long idle stretch outside AI games", () => {
  const ai = harness();
  ai.context.aiGameActive = true;
  ai.cancelAIThinking();
  const idle = ai.timers.at(-1);
  assert.equal(idle.delay, 600_000);
  idle.callback();
  assert.deepEqual(ai.terminated, [], "an AI game still in progress keeps its model");
  ai.context.aiGameActive = false;
  ai.timers.at(-1).callback();
  assert.deepEqual(ai.terminated, ["first"]);
});

test("model switches, errors and replay still release the worker", () => {
  assert.match(
    slice("function maybeStartAITurn()", "async function startAIGame("),
    /aiWorkerModelId !== modelId\) \{\s*cancelAIThinking\(\{ terminate: true \}\);/u,
  );
  assert.match(
    slice("function recoverFromAIError(", "function handleAIWorkerMessage("),
    /cancelAIThinking\(\{ terminate: true \}\);/u,
  );
  const handler = slice("function handleAIWorkerMessage(", "function ensureAIWorker()");
  assert.match(handler, /if \(message\.type === "result"\) scheduleAIWorkerIdleRelease\(\);\s*else terminateAIWorker\(\);/u);
  assert.match(slice("function enterReplay(", "function setReplayAnalysisModel("), /cancelAIThinking\(\{ terminate: true \}\);/u);
  assert.match(slice("function ensureAIWorker()", "function maybeStartAITurn()"), /if \(aiWorker\) return aiWorker;/u);
});

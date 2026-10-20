/// <reference lib="webworker" />

import { GOMOKU_AI_INFO, GomokuAiError, chooseGomokuMove, prepareGomokuAi } from "./gomokuAi.js";

/**
 * Module worker for the Gomoku AI (game-AI worker protocol):
 *   {type: "init", requestId[, ruleSet, level]}
 *     -> {type: "ready", requestId, info: {engine, version, license, levels, rapfi}}
 *     (ruleSet/level, when given, start the network download early)
 *   {type: "choose-move", requestId, position, settings}
 *     -> {type: "move", requestId, move: {row, col}, info}
 *      | {type: "error", requestId, code, message}
 *     with {type: "progress", requestId, info} while thinking
 *   {type: "cancel", requestId}
 *     -> the pending choose-move answers {type: "error", requestId, code: "CANCELLED"}
 *
 * Rapfi (GPL-3.0-or-later, https://github.com/dhbloo/rapfi) runs in this
 * worker as WebAssembly; the worker's own CSP grants 'wasm-unsafe-eval'.
 */

/**
 * Wire the protocol to a worker-like scope ({postMessage, addEventListener}).
 * Exported for tests; the worker attaches itself to its global scope.
 *
 * @param {{postMessage: (message: object) => void, addEventListener: Function}} scope
 * @param {{choose?: typeof chooseGomokuMove, prepare?: typeof prepareGomokuAi}} [overrides]
 */
export function attachGomokuAiWorker(scope, { choose = chooseGomokuMove, prepare = prepareGomokuAi } = {}) {
  /** requestId -> AbortController of an unanswered choose-move */
  const pending = new Map();
  const post = (message) => scope.postMessage(message);

  async function init(message) {
    try {
      const info = await prepare({ ruleSet: message.ruleSet, level: message.level });
      post({ type: "ready", requestId: message.requestId, info });
    } catch (error) {
      post({ type: "ready", requestId: message.requestId, info: { ...GOMOKU_AI_INFO, rapfi: false, reason: String(error?.message ?? error) } });
    }
  }

  async function chooseMove(message) {
    const { requestId, position, settings } = message;
    if (pending.has(requestId)) {
      post({ type: "error", requestId, code: "BAD_REQUEST", message: "Duplicate requestId" });
      return;
    }
    const controller = new AbortController();
    pending.set(requestId, controller);
    try {
      const { move, info } = await choose(position, settings ?? {}, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (pending.get(requestId) === controller) post({ type: "progress", requestId, info: progress });
        },
      });
      if (pending.get(requestId) === controller) post({ type: "move", requestId, move, info });
    } catch (error) {
      if (pending.get(requestId) === controller) {
        const code = error instanceof GomokuAiError ? error.code : "ENGINE_ERROR";
        post({ type: "error", requestId, code, message: String(error?.message ?? error) });
      }
    } finally {
      if (pending.get(requestId) === controller) pending.delete(requestId);
    }
  }

  function cancel(message) {
    const controller = pending.get(message.requestId);
    if (!controller) return;
    // Answer at once; the search notices the abort at its next slice and its
    // late result is dropped.
    pending.delete(message.requestId);
    controller.abort();
    post({ type: "error", requestId: message.requestId, code: "CANCELLED", message: "Cancelled" });
  }

  scope.addEventListener("message", (event) => {
    const message = event.data;
    switch (message?.type) {
      case "init":
        init(message);
        break;
      case "choose-move":
        chooseMove(message);
        break;
      case "cancel":
        cancel(message);
        break;
      default:
        post({ type: "error", requestId: message?.requestId ?? null, code: "BAD_REQUEST", message: `Unknown message type: ${message?.type}` });
    }
  });
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  attachGomokuAiWorker(globalThis);
}

import { OTHELLO_AI_ENGINE, OTHELLO_AI_INFO, chooseOthelloMove } from "./othelloAi.js";

/**
 * The game-AI worker protocol for Othello, independent of the Worker global
 * so it can be tested in Node. othelloAiWorker.js wires it to `self`.
 *
 * In:  { type: "init", requestId }
 *      { type: "choose-move", requestId, position, settings }
 *      { type: "cancel", requestId }
 * Out: { type: "ready", requestId, info }
 *      { type: "progress", requestId, info } (after each finished iteration)
 *      { type: "move", requestId, move: { row, col }, info }
 *      { type: "error", requestId, code, message }
 *
 * A cancel answers the pending request with CANCELLED at once and stops its
 * search (which yields to the event loop every few milliseconds). Requests
 * are independent; several may run at once.
 *
 * @param {(message: object) => void} post
 * @param {{choose?: typeof chooseOthelloMove}} [options]
 * @returns {(data: unknown) => void}
 */
export function createOthelloAiWorkerHandler(post, { choose = chooseOthelloMove } = {}) {
  /** requestId -> AbortController of a running choose-move. */
  const pending = new Map();

  function fail(requestId, code, message) {
    post({ type: "error", requestId, code, message });
  }

  async function chooseMove(requestId, position, settings) {
    if (pending.has(requestId)) {
      fail(requestId, "DUPLICATE_REQUEST", `Request ${requestId} is already running`);
      return;
    }
    const controller = new AbortController();
    pending.set(requestId, controller);
    try {
      const { move, info } = await choose(position, settings ?? {}, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (pending.get(requestId) === controller) {
            post({ type: "progress", requestId, info: progress });
          }
        },
      });
      if (pending.get(requestId) !== controller) return;
      pending.delete(requestId);
      post({ type: "move", requestId, move: { row: move.row, col: move.col }, info });
    } catch (error) {
      if (pending.get(requestId) !== controller) return;
      pending.delete(requestId);
      fail(
        requestId,
        typeof error?.code === "string" ? error.code : "INTERNAL",
        error?.message ?? String(error),
      );
    }
  }

  return function handleMessage(data) {
    if (data === null || typeof data !== "object") return;
    const { type, requestId } = data;
    switch (type) {
      case "init":
        post({ type: "ready", requestId, info: { ...OTHELLO_AI_INFO } });
        return;
      case "choose-move":
        chooseMove(requestId, data.position, data.settings);
        return;
      case "cancel": {
        const controller = pending.get(requestId);
        if (!controller) return;
        pending.delete(requestId);
        controller.abort();
        fail(requestId, "CANCELLED", `${OTHELLO_AI_ENGINE} search was cancelled`);
        return;
      }
      default:
        fail(requestId, "UNKNOWN_MESSAGE", `Unknown message type: ${type}`);
    }
  };
}

/**
 * The worker side of the game-AI protocol, shared by workers that answer it
 * with a promise-returning engine:
 *
 *   {type: "init", requestId}                 -> {type: "ready", requestId, info}
 *   {type: "choose-move", requestId, position, settings}
 *                                              -> {type: "move", requestId, move, info}
 *                                               | {type: "error", requestId, code, message}
 *   {type: "cancel", requestId}               -> the pending choose-move answers
 *                                                {type: "error", requestId, code: "CANCELLED"}
 *
 * @param {{addEventListener: Function, postMessage: Function}} scope The
 *   worker global (or a test double).
 * @param {{init: () => Promise<object>,
 *   choose: (position: object, settings: object, options: {signal: AbortSignal}) =>
 *     Promise<{move: {row: number, col: number}, info?: object}>}} engine
 */
export function attachGameAiWorker(scope, engine) {
  const pending = new Map();
  let ready = null;

  function post(message) {
    scope.postMessage(message);
  }

  function errorMessage(requestId, error, fallbackCode = "ENGINE_ERROR") {
    return {
      type: "error",
      requestId,
      code: typeof error?.code === "string" && error.code ? error.code : fallbackCode,
      message: String(error?.message ?? error ?? fallbackCode),
    };
  }

  async function handleInit(requestId) {
    try {
      ready ??= Promise.resolve().then(() => engine.init());
      const info = await ready;
      post({ type: "ready", requestId, info });
    } catch (error) {
      // A failed start may be retried by a later init.
      ready = null;
      post(errorMessage(requestId, error, "INIT_FAILED"));
    }
  }

  async function handleChoose(message) {
    const { requestId } = message;
    const controller = new AbortController();
    pending.set(requestId, controller);
    try {
      ready ??= Promise.resolve().then(() => engine.init());
      await ready;
      if (controller.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
      const answer = await engine.choose(message.position, message.settings ?? {}, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
      post({
        type: "move",
        requestId,
        move: { row: answer.move.row, col: answer.move.col },
        info: answer.info ?? {},
      });
    } catch (error) {
      post(controller.signal.aborted
        ? { type: "error", requestId, code: "CANCELLED", message: "The AI search was cancelled." }
        : errorMessage(requestId, error));
    } finally {
      pending.delete(requestId);
    }
  }

  scope.addEventListener("message", (event) => {
    const message = event?.data ?? {};
    if (message.type === "init") {
      void handleInit(message.requestId);
    } else if (message.type === "choose-move") {
      void handleChoose(message);
    } else if (message.type === "cancel") {
      pending.get(message.requestId)?.abort();
    }
  });
}

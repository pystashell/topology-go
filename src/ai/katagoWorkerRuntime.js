function abortError() {
  const error = new Error("AI search was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortError();
}

function defaultIsCancellationError(error) {
  return error?.name === "AbortError";
}

/**
 * Attach the lightweight KataGo worker message protocol to a worker-like scope.
 * Model inference and tree search are injected so this module stays free of
 * TensorFlow and can be exercised directly in Node.
 */
export function attachKataGoWorkerRuntime(
  scope,
  {
    neuralPolicy,
    chooseMove,
    isCancellationError = defaultIsCancellationError,
  },
) {
  if (typeof neuralPolicy !== "function" || typeof chooseMove !== "function") {
    throw new TypeError("KataGo worker runtime requires neuralPolicy and chooseMove");
  }

  const jobs = new Map();

  const postStatus = (id, stage, detail = {}) => {
    scope.postMessage({ type: "status", id, stage, ...detail });
  };

  scope.addEventListener("message", async (event) => {
    const message = event.data ?? {};
    if (message.type === "cancel") {
      jobs.get(message.id)?.abort();
      return;
    }
    if (message.type !== "think") return;

    jobs.get(message.id)?.abort();
    const controller = new AbortController();
    jobs.set(message.id, controller);

    try {
      const neural = await neuralPolicy({
        scope,
        id: message.id,
        state: message.state,
        signal: controller.signal,
        postStatus: (stage, detail) => postStatus(message.id, stage, detail),
      });
      throwIfAborted(controller.signal);

      postStatus(message.id, "searching", { backend: neural.backend });
      const result = await chooseMove(message.state, {
        ...(message.options ?? {}),
        difficulty: "hard",
        candidateLimit: 24,
        rootPolicy: neural.priors,
        signal: controller.signal,
      });
      throwIfAborted(controller.signal);
      if (jobs.get(message.id) !== controller) return;

      scope.postMessage({
        type: "result",
        id: message.id,
        move: result.move,
        stats: {
          ...result.stats,
          engine: "katago-hybrid",
          modelName: neural.modelName,
          backend: neural.backend,
          modelBytes: neural.compressedBytes,
          inferenceMs: neural.inferenceMs,
        },
      });
    } catch (error) {
      if (jobs.get(message.id) !== controller) return;
      const cancelled = isCancellationError(error);
      scope.postMessage({
        type: "error",
        id: message.id,
        message: cancelled
          ? "AI search was cancelled"
          : String(error?.message ?? error),
        ...(cancelled ? { code: "AI_SEARCH_CANCELLED" } : {}),
      });
    } finally {
      if (jobs.get(message.id) === controller) jobs.delete(message.id);
    }
  });

  return {
    cancelAll() {
      for (const controller of jobs.values()) controller.abort();
    },
  };
}

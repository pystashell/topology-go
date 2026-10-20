import { GAME_GOMOKU } from "../game/gameTypes.js";
import { gameAiEntry, gameAiSettings } from "./gameAiRegistry.js";

/**
 * Promise API over a game-AI module worker (Gomoku, Othello).
 *
 *   const ai = createGameAi("gomoku");
 *   await ai.init();                                  // {engine, version, license, levels}
 *   const { move, info } = await ai.choose(position, { level: "normal", timeLimitMs: 1500 });
 *   ai.cancel();                                      // the pending choose rejects with AI_SEARCH_CANCELLED
 *   ai.dispose();                                     // terminate the worker
 *
 * Protocol (one worker per game type, ES module worker):
 *   -> {type: "init", requestId}            <- {type: "ready", requestId, info}
 *   -> {type: "choose-move", requestId, position, settings}
 *                                           <- {type: "move", requestId, move: {row, col}, info}
 *                                            | {type: "error", requestId, code, message}
 *                                            | {type: "progress", requestId, info} (optional)
 *   -> {type: "cancel", requestId}          <- the pending choose-move answers error CANCELLED
 *
 * The worker is kept between moves and between games (a dedicated engine
 * may load WebAssembly and weights once) and released after a long idle
 * stretch. A worker that fails to start falls back once to the registry's
 * fallback worker; a stuck or crashed worker is terminated and the next
 * request starts a fresh one.
 */

/** Error codes the client rejects with (the page shows copy for each). */
export const GAME_AI_ERRORS = Object.freeze({
  CANCELLED: "AI_SEARCH_CANCELLED",
  TIMEOUT: "AI_TIMEOUT",
  WORKER_FAILED: "AI_WORKER_FAILED",
  UNSUPPORTED: "AI_UNSUPPORTED",
  ENGINE: "AI_ENGINE_ERROR",
  ILLEGAL_MOVE: "AI_ILLEGAL_MOVE",
  NO_LEGAL_MOVE: "AI_NO_LEGAL_MOVE",
  BAD_POSITION: "AI_BAD_POSITION",
});

// Worker protocol codes -> client codes.
const WORKER_CODES = Object.freeze({
  CANCELLED: GAME_AI_ERRORS.CANCELLED,
  TIMEOUT: GAME_AI_ERRORS.TIMEOUT,
  ILLEGAL_MOVE: GAME_AI_ERRORS.ILLEGAL_MOVE,
  NO_LEGAL_MOVE: GAME_AI_ERRORS.NO_LEGAL_MOVE,
  BAD_POSITION: GAME_AI_ERRORS.BAD_POSITION,
  INIT_FAILED: GAME_AI_ERRORS.WORKER_FAILED,
});

export class GameAiClientError extends Error {
  /**
   * @param {string} code One of GAME_AI_ERRORS.
   * @param {string} message
   * @param {{workerCode?: string|null, cause?: unknown}} [options]
   */
  constructor(code, message, { workerCode = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GameAiClientError";
    this.code = code;
    this.workerCode = workerCode;
  }
}

/** Map a worker's {code, message} error reply to a client error. */
export function mapWorkerError(reply = {}) {
  const workerCode = typeof reply.code === "string" ? reply.code : null;
  const code = WORKER_CODES[workerCode] ?? GAME_AI_ERRORS.ENGINE;
  const message = typeof reply.message === "string" && reply.message
    ? reply.message
    : code;
  return new GameAiClientError(code, message, { workerCode });
}

/**
 * The protocol position of an engine (GomokuEngine, OthelloEngine, or a
 * render-only engine hydrated from a room snapshot).
 *
 * @param {object} engine
 * @param {{moveCount?: number}} [options]
 */
export function gameAiPosition(engine, { moveCount = 0 } = {}) {
  const state = engine.getState();
  const lastMove = state.lastMove?.type === "play"
    ? { row: state.lastMove.row, col: state.lastMove.col, color: state.lastMove.color }
    : null;
  return {
    gameType: state.gameType,
    ...(state.gameType === GAME_GOMOKU ? { ruleSet: state.ruleSet } : {}),
    width: state.width,
    height: state.height,
    topology: state.topology,
    board: state.board.map((row) => row.slice()),
    currentPlayer: state.currentPlayer,
    lastMove,
    moveCount: Number.isSafeInteger(moveCount) && moveCount >= 0 ? moveCount : 0,
  };
}

function validMove(move, position) {
  return Boolean(
    move &&
    Number.isInteger(move.row) &&
    Number.isInteger(move.col) &&
    move.row >= 0 &&
    move.col >= 0 &&
    (!position || (move.row < position.height && move.col < position.width)),
  );
}

/**
 * @param {string} gameType "gomoku" or "othello".
 * @param {object} [options]
 * @param {object} [options.entry] Registry entry (tests pass fakes).
 * @param {number} [options.initTimeoutMs=30000] Time to start an engine
 *   (WebAssembly and weights included).
 * @param {number} [options.timeoutSlackMs=3000] Allowance beyond a move's
 *   time limit (+20%) before the worker counts as stuck.
 * @param {number} [options.cancelGraceMs=1000] Time a cancelled worker has
 *   to acknowledge before it is replaced.
 * @param {number} [options.idleReleaseMs=600000] Idle time before the
 *   worker is released (0 keeps it).
 * @param {(info: object) => void} [options.onProgress]
 * @param {{setTimeout: Function, clearTimeout: Function}} [options.timers]
 */
export function createGameAi(gameType, options = {}) {
  const entry = options.entry ?? gameAiEntry(gameType);
  if (typeof entry.createWorker !== "function") {
    throw new TypeError(`${gameType} has no game-AI worker`);
  }
  const initTimeoutMs = options.initTimeoutMs ?? 30_000;
  const timeoutSlackMs = options.timeoutSlackMs ?? 3_000;
  const cancelGraceMs = options.cancelGraceMs ?? 1_000;
  const idleReleaseMs = options.idleReleaseMs ?? 10 * 60_000;
  const timers = options.timers ?? globalThis;
  const setTimer = (callback, delay) => timers.setTimeout(callback, delay);
  const clearTimer = (timer) => {
    if (timer !== null && timer !== undefined) timers.clearTimeout(timer);
  };

  let requestSequence = 0;
  /** @type {null|{worker: Worker, fallback: boolean, ready: Promise<object>|null, info: object|null}} */
  let slot = null;
  let useFallback = false;
  let pending = null;
  let draining = null;
  let initWaiter = null;
  let idleTimer = null;
  let disposed = false;

  function clearIdle() {
    clearTimer(idleTimer);
    idleTimer = null;
  }

  function scheduleIdle() {
    clearIdle();
    if (!idleReleaseMs || !slot) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (!pending && !draining) releaseWorker();
    }, idleReleaseMs);
  }

  function releaseWorker() {
    const current = slot;
    slot = null;
    clearIdle();
    if (current) {
      try {
        current.worker.terminate();
      } catch {
        // Already gone.
      }
    }
    if (draining) {
      clearTimer(draining.timer);
      const { resolve } = draining;
      draining = null;
      resolve();
    }
  }

  function settlePending(error, value) {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimer(current.timer);
    if (error) current.reject(error);
    else current.resolve(value);
    scheduleIdle();
  }

  function failInit(error) {
    const waiter = initWaiter;
    initWaiter = null;
    if (!waiter) return;
    clearTimer(waiter.timer);
    waiter.reject(error);
  }

  /** The worker died or broke the protocol: fail everything and drop it. */
  function workerFailed(worker, error) {
    if (!slot || slot.worker !== worker) return;
    releaseWorker();
    failInit(error);
    settlePending(error);
  }

  function handleMessage(worker, event) {
    if (!slot || slot.worker !== worker) return;
    const message = event?.data ?? {};
    if (draining && message.requestId === draining.requestId &&
        (message.type === "move" || message.type === "error")) {
      clearTimer(draining.timer);
      const { resolve } = draining;
      draining = null;
      resolve();
      return;
    }
    if (initWaiter && message.requestId === initWaiter.requestId) {
      const waiter = initWaiter;
      initWaiter = null;
      clearTimer(waiter.timer);
      if (message.type === "ready") waiter.resolve(message.info ?? {});
      else waiter.reject(mapWorkerError(message));
      return;
    }
    if (!pending || message.requestId !== pending.requestId) return;
    if (message.type === "progress") {
      options.onProgress?.(message.info ?? {});
      return;
    }
    if (message.type === "move") {
      if (!validMove(message.move, pending.position)) {
        settlePending(new GameAiClientError(
          GAME_AI_ERRORS.ILLEGAL_MOVE,
          "The AI answered without a valid point.",
        ));
        return;
      }
      settlePending(null, {
        move: { row: message.move.row, col: message.move.col },
        info: message.info ?? {},
      });
      return;
    }
    if (message.type === "error") settlePending(mapWorkerError(message));
  }

  function spawn(fallback) {
    if (typeof Worker !== "function" && !options.entry) {
      throw new GameAiClientError(
        GAME_AI_ERRORS.UNSUPPORTED,
        "This browser cannot run background AI workers.",
      );
    }
    const factory = fallback ? entry.createFallbackWorker : entry.createWorker;
    let worker;
    try {
      worker = factory();
    } catch (error) {
      throw new GameAiClientError(
        GAME_AI_ERRORS.WORKER_FAILED,
        String(error?.message ?? error),
        { cause: error },
      );
    }
    worker.addEventListener("message", (event) => handleMessage(worker, event));
    worker.addEventListener("error", (event) => {
      event?.preventDefault?.();
      workerFailed(worker, new GameAiClientError(
        GAME_AI_ERRORS.WORKER_FAILED,
        String(event?.message || "The AI worker stopped unexpectedly."),
      ));
    });
    worker.addEventListener("messageerror", () => {
      workerFailed(worker, new GameAiClientError(
        GAME_AI_ERRORS.WORKER_FAILED,
        "The AI worker sent an unreadable message.",
      ));
    });
    return { worker, fallback, ready: null, info: null };
  }

  function startSlot(fallback) {
    const current = spawn(fallback);
    slot = current;
    current.ready = new Promise((resolve, reject) => {
      const requestId = ++requestSequence;
      initWaiter = {
        requestId,
        resolve,
        reject,
        timer: setTimer(() => {
          if (initWaiter?.requestId !== requestId) return;
          workerFailed(current.worker, new GameAiClientError(
            GAME_AI_ERRORS.TIMEOUT,
            "The AI engine did not start in time.",
          ));
        }, initTimeoutMs),
      };
      current.worker.postMessage({ type: "init", requestId });
    }).then((info) => {
      current.info = info;
      return info;
    });
    return current.ready;
  }

  async function ensureReady() {
    if (disposed) {
      throw new GameAiClientError(GAME_AI_ERRORS.CANCELLED, "The AI was released.");
    }
    if (slot?.ready) return slot.ready;
    try {
      return await startSlot(useFallback);
    } catch (error) {
      // A dedicated engine that cannot start (missing WebAssembly support,
      // a blocked download) hands over to the built-in fallback once.
      const canFallBack = !useFallback &&
        typeof entry.createFallbackWorker === "function" &&
        error?.code !== GAME_AI_ERRORS.CANCELLED;
      releaseWorker();
      if (!canFallBack) throw error;
      useFallback = true;
      return startSlot(true);
    }
  }

  function waitForDrain() {
    return draining ? draining.promise : Promise.resolve();
  }

  /** Cancel the pending choose; it rejects with AI_SEARCH_CANCELLED at once. */
  function cancel() {
    if (!pending) return false;
    const current = pending;
    const worker = slot?.worker ?? null;
    settlePending(new GameAiClientError(GAME_AI_ERRORS.CANCELLED, "The AI search was cancelled."));
    if (!worker || !current.posted) return true;
    try {
      worker.postMessage({ type: "cancel", requestId: current.requestId });
    } catch {
      releaseWorker();
      return true;
    }
    let resolveDrain;
    const promise = new Promise((resolve) => {
      resolveDrain = resolve;
    });
    draining = {
      requestId: current.requestId,
      promise,
      resolve: resolveDrain,
      // A worker that cannot stop promptly (a long synchronous search) is
      // replaced rather than waited for.
      timer: setTimer(() => {
        if (draining?.requestId === current.requestId) releaseWorker();
      }, cancelGraceMs),
    };
    return true;
  }

  return {
    gameType,
    /** Whether a choose is in progress. */
    get busy() {
      return Boolean(pending);
    },
    /** Whether the built-in fallback answers instead of the dedicated engine. */
    get usingFallback() {
      return useFallback || Boolean(slot?.fallback);
    },
    /** Start (or reuse) the worker; resolves with the engine's ready info. */
    async init() {
      const info = await ensureReady();
      scheduleIdle();
      return info;
    },
    /**
     * Ask for a move. Settings default from the level ({level: "normal"}).
     *
     * @returns {Promise<{move: {row: number, col: number}, info: object}>}
     */
    async choose(position, settings = {}) {
      if (pending) cancel();
      const resolvedSettings = {
        ...gameAiSettings(settings.level),
        ...(Number.isFinite(settings.timeLimitMs) && settings.timeLimitMs > 0
          ? { timeLimitMs: settings.timeLimitMs }
          : {}),
      };
      let resolveResult;
      let rejectResult;
      const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const request = {
        requestId: ++requestSequence,
        position,
        posted: false,
        resolve: resolveResult,
        reject: rejectResult,
        timer: null,
      };
      pending = request;
      clearIdle();
      try {
        await waitForDrain();
        if (pending !== request) return result;
        await ensureReady();
        if (pending !== request) return result;
        const current = slot;
        request.timer = setTimer(() => {
          if (pending !== request) return;
          // The engine overran its budget (+20%) by far: treat it as stuck.
          const error = new GameAiClientError(
            GAME_AI_ERRORS.TIMEOUT,
            "The AI took too long to answer.",
          );
          settlePending(error);
          if (slot === current) releaseWorker();
        }, resolvedSettings.timeLimitMs * 1.2 + timeoutSlackMs);
        request.posted = true;
        current.worker.postMessage({
          type: "choose-move",
          requestId: request.requestId,
          position,
          settings: resolvedSettings,
        });
      } catch (error) {
        if (pending === request) settlePending(error);
      }
      return result;
    },
    cancel,
    /** Cancel anything pending and terminate the worker. */
    dispose() {
      cancel();
      releaseWorker();
      failInit(new GameAiClientError(GAME_AI_ERRORS.CANCELLED, "The AI was released."));
    },
    /** Like dispose(), and refuse further use. */
    destroy() {
      this.dispose();
      disposed = true;
    },
  };
}

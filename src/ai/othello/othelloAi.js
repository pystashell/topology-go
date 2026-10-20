import { GAME_OTHELLO } from "../../game/gameTypes.js";
import { OthelloEngine } from "../../game/othelloEngine.js";
import { EXACT_UNIT } from "./othelloEval.js";
import { getOthelloGeometry } from "./othelloGeometry.js";
import {
  OthelloSearcher,
  TranspositionTable,
  defaultClock,
  runSearchSync,
} from "./othelloSearch.js";

/**
 * Topology Othello AI: a free alpha-beta engine for Othello on cylinder,
 * torus and Mobius boards (any even width/height 6..30), running in the
 * browser (see othelloAiWorker.js) or in Node.
 *
 * chooseOthelloMove(position, settings, { signal }) follows the game AI
 * worker contract: `position` is { gameType: "othello", width, height,
 * topology, board, currentPlayer, ... } and `settings` is { level,
 * timeLimitMs }. It resolves to { move: { row, col }, info } with a move that
 * OthelloEngine.checkPlay accepts, or rejects with an OthelloAiError whose
 * code is CANCELLED, INVALID_POSITION, NO_LEGAL_MOVE or INVALID_SETTINGS.
 */

export const OTHELLO_AI_ENGINE = "topo-othello";
export const OTHELLO_AI_VERSION = "1.0.0";
export const OTHELLO_AI_LICENSE = "Topology Go project code (no third-party code)";
export const OTHELLO_AI_LEVELS = Object.freeze(["easy", "normal", "hard"]);
export const OTHELLO_AI_INFO = Object.freeze({
  engine: OTHELLO_AI_ENGINE,
  version: OTHELLO_AI_VERSION,
  license: OTHELLO_AI_LICENSE,
  levels: OTHELLO_AI_LEVELS,
});

/** Contract defaults for settings.timeLimitMs. */
export const OTHELLO_DEFAULT_TIME_LIMITS = Object.freeze({
  easy: 300,
  normal: 1500,
  hard: 4000,
});

const MIN_TIME_LIMIT_MS = 5;
const MAX_TIME_LIMIT_MS = 120000;
/** Share of the time limit the search may use; the rest covers overheads. */
const TIME_SHARE = 0.9;

/**
 * Measured win/draw/loss solve time with 14 empties, in seconds, on 8x8
 * boards; each further empty roughly doubles it. Tori keep more moves open.
 */
const SOLVE_SECONDS_AT_14 = Object.freeze({ cylinder: 0.15, mobius: 0.25, torus: 0.4 });

/**
 * The most empties a solve can likely finish with in `seconds` (with a
 * threefold margin for the spread between positions).
 */
export function solvableEmpties(cellCount, topology, seconds) {
  const base = (SOLVE_SECONDS_AT_14[topology] ?? 0.4) * Math.sqrt(Math.max(1, cellCount / 64));
  return 14 + Math.floor(Math.log2(Math.max(1e-6, seconds / 3 / base)));
}

/**
 * Strength settings per level.
 * - maxDepth: deepest heuristic iteration (the time limit may stop earlier).
 * - solveCap: never solve exactly with more empties than this; below it the
 *   limit follows from the time budget (solvableEmpties).
 * - temperature: easy picks among root moves with probability
 *   exp((score - best) / temperature) from full-window scores.
 */
export const OTHELLO_LEVEL_SETTINGS = Object.freeze({
  easy: Object.freeze({ maxDepth: 2, solveCap: 0, temperature: 120 }),
  normal: Object.freeze({ maxDepth: 4, solveCap: 10, temperature: 0 }),
  hard: Object.freeze({ maxDepth: 64, solveCap: 24, temperature: 0 }),
});

/** Exact-solve threshold for a level, board and time limit. */
export function exactEmptiesFor(resolved, cellCount, topology) {
  if (resolved.solveCap === 0) return 0;
  // The solve gets the time the heuristic phase leaves (about 70%).
  const seconds = (resolved.timeLimitMs / 1000) * TIME_SHARE * 0.7;
  return Math.max(8, Math.min(resolved.solveCap, solvableEmpties(cellCount, topology, seconds)));
}

export class OthelloAiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OthelloAiError";
    this.code = code;
  }
}

function cancelledError() {
  return new OthelloAiError("CANCELLED", "Othello AI search was cancelled");
}

/** Shared transposition tables, one per board shape (most recent kept). */
const tables = new Map();
const TABLE_LIMIT = 2;

function tableFor(geometry) {
  const key = `${geometry.kind}:${geometry.width}x${geometry.height}`;
  let table = tables.get(key);
  if (!table) {
    table = new TranspositionTable(geometry.cellCount <= 100 ? 19 : 18);
    tables.set(key, table);
    if (tables.size > TABLE_LIMIT) tables.delete(tables.keys().next().value);
  }
  return table;
}

/** Forget cached tables (tests). */
export function resetOthelloAiCaches() {
  tables.clear();
}

let channel = null;
const channelQueue = [];

/** Resolve on a fresh macrotask without timer clamping. */
export function yieldToEventLoop() {
  if (typeof globalThis.setImmediate === "function") {
    return new Promise((resolve) => globalThis.setImmediate(resolve));
  }
  if (typeof globalThis.MessageChannel === "function") {
    if (channel === null) {
      channel = new globalThis.MessageChannel();
      channel.port1.onmessage = () => channelQueue.shift()?.();
    }
    return new Promise((resolve) => {
      channelQueue.push(resolve);
      channel.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Validate a contract position and build the rules engine for it.
 * @returns {{engine: OthelloEngine, side: number, values: Int8Array}}
 */
export function preparePosition(position) {
  if (position === null || typeof position !== "object") {
    throw new OthelloAiError("INVALID_POSITION", "position must be an object");
  }
  if (position.gameType !== undefined && position.gameType !== GAME_OTHELLO) {
    throw new OthelloAiError("INVALID_POSITION", `Not an Othello position: ${position.gameType}`);
  }
  let engine;
  try {
    engine = new OthelloEngine({
      width: position.width,
      height: position.height,
      topology: position.topology,
      initialBoard: position.board,
      currentPlayer: position.currentPlayer,
    });
  } catch (error) {
    throw new OthelloAiError("INVALID_POSITION", error.message);
  }
  const { width, height } = engine;
  const values = new Int8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = engine.board[row][col];
      values[row * width + col] = value === "black" ? 1 : value === "white" ? 2 : 0;
    }
  }
  return { engine, side: engine.currentPlayer === "black" ? 1 : 2, values };
}

/** Resolve level and time limit from contract settings. */
export function resolveSettings(settings = {}) {
  const level = settings?.level ?? "normal";
  if (!OTHELLO_AI_LEVELS.includes(level)) {
    throw new OthelloAiError("INVALID_SETTINGS", `Unknown level: ${level}`);
  }
  const requested = settings?.timeLimitMs ?? OTHELLO_DEFAULT_TIME_LIMITS[level];
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    throw new OthelloAiError("INVALID_SETTINGS", "timeLimitMs must be a positive number");
  }
  const timeLimitMs = Math.min(MAX_TIME_LIMIT_MS, Math.max(MIN_TIME_LIMIT_MS, requested));
  return { level, timeLimitMs, ...OTHELLO_LEVEL_SETTINGS[level] };
}

/** Pick a root move for a randomized level (softmax over scores). */
function sampleRootMove(rootMoves, temperature, random) {
  const scored = rootMoves.filter((move) => move.completed);
  if (scored.length === 0) return rootMoves[0].cell;
  const best = Math.max(...scored.map((move) => move.score));
  const weights = scored.map((move) => Math.exp((move.score - best) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = random() * total;
  for (let index = 0; index < scored.length; index += 1) {
    pick -= weights[index];
    if (pick <= 0) return scored[index].cell;
  }
  return scored[scored.length - 1].cell;
}

function describeScore(score, exact) {
  if (exact || Math.abs(score) >= EXACT_UNIT) {
    return { score: Math.round(score / EXACT_UNIT), scoreKind: "discs" };
  }
  return { score: Math.round(score) / EXACT_UNIT, scoreKind: "heuristic" };
}

function createSearch(position, settings, { clock = defaultClock, weights } = {}) {
  const startedAt = clock();
  const prepared = preparePosition(position);
  const resolved = resolveSettings(settings);
  const { engine, side, values } = prepared;
  if (engine.legalMoves().length === 0) {
    throw new OthelloAiError("NO_LEGAL_MOVE", `${engine.currentPlayer} has no legal move`);
  }
  const geometry = getOthelloGeometry(engine.topology, engine.width, engine.height);
  const searcher = new OthelloSearcher(geometry, { tt: tableFor(geometry), clock, weights });
  searcher.setPosition(values, side);
  const deadline = startedAt + resolved.timeLimitMs * TIME_SHARE;
  return { startedAt, engine, geometry, searcher, resolved, deadline };
}

/**
 * The result to use when the search itself failed unexpectedly: the first
 * legal move, so a game never stalls on an AI bug (info.source "fallback").
 */
function fallbackResult(search, error) {
  const { engine, geometry } = search;
  const move = engine.legalMoves()[0];
  return {
    cell: move.row * geometry.width + move.col,
    score: 0,
    depth: 0,
    exact: false,
    outcome: null,
    source: "fallback",
    error: error?.message ?? String(error),
  };
}

function finishSearch(search, result, { clock = defaultClock, random = Math.random } = {}) {
  const { engine, geometry, resolved, startedAt } = search;
  let cell = result.cell;
  if (resolved.temperature > 0 && result.rootMoves?.length > 1) {
    cell = sampleRootMove(result.rootMoves, resolved.temperature, random);
  }
  let move = { row: Math.floor(cell / geometry.width), col: cell % geometry.width };
  let source = result.source;
  if (!engine.checkPlay(move.row, move.col).ok) {
    // Never expected; keep the contract that the move is legal.
    move = engine.legalMoves()[0];
    source = "fallback";
  }
  const chosen = result.rootMoves?.find((rootMove) => rootMove.cell === cell);
  const scoreValue = chosen?.completed ? chosen.score : result.score;
  return {
    move,
    info: {
      engine: OTHELLO_AI_ENGINE,
      level: resolved.level,
      ms: Math.round(clock() - startedAt),
      depth: result.depth,
      nodes: search.searcher.nodes,
      ...describeScore(scoreValue, result.exact),
      exact: result.exact,
      outcome: result.outcome,
      source,
      ...(result.error ? { error: result.error } : {}),
    },
  };
}

/**
 * Choose a move (async; yields to the event loop every few milliseconds so
 * an AbortSignal or worker cancel message is seen promptly).
 *
 * @param {object} position contract position
 * @param {{level?: 'easy'|'normal'|'hard', timeLimitMs?: number}} [settings]
 * @param {{signal?: AbortSignal, onProgress?: (info: object) => void,
 *   random?: () => number, clock?: () => number}} [options]
 * @returns {Promise<{move: {row: number, col: number}, info: object}>}
 */
export async function chooseOthelloMove(position, settings = {}, options = {}) {
  const { signal, onProgress, random, clock = defaultClock } = options;
  if (signal?.aborted) throw cancelledError();
  const search = createSearch(position, settings, options);
  const { searcher, resolved, deadline, startedAt, geometry } = search;
  const generator = searcher.run({
    maxDepth: resolved.maxDepth,
    exactEmpties: exactEmptiesFor(resolved, geometry.cellCount, geometry.kind),
    multiPv: resolved.temperature > 0,
    deadline,
    onIteration: onProgress
      ? (iteration) =>
          onProgress({
            engine: OTHELLO_AI_ENGINE,
            depth: iteration.depth,
            nodes: iteration.nodes,
            ms: Math.round(clock() - startedAt),
            ...describeScore(iteration.score, iteration.exact),
            exact: iteration.exact,
            outcome: iteration.outcome,
          })
      : undefined,
  });
  let result;
  try {
    for (;;) {
      const step = generator.next();
      if (step.done) {
        result = step.value;
        break;
      }
      await yieldToEventLoop();
      if (signal?.aborted) break;
    }
  } catch (error) {
    result = fallbackResult(search, error);
  }
  if (signal?.aborted) {
    generator.return();
    throw cancelledError();
  }
  return finishSearch(search, result, { clock, random });
}

/**
 * Synchronous variant for tests and tools (no cancellation; same result
 * shape). Not for the browser main thread.
 */
export function chooseOthelloMoveSync(position, settings = {}, options = {}) {
  const { clock = defaultClock, random } = options;
  const search = createSearch(position, settings, options);
  const { searcher, resolved, deadline, geometry } = search;
  const result = runSearchSync(
    searcher.run({
      maxDepth: options.maxDepth ?? resolved.maxDepth,
      exactEmpties:
        options.exactEmpties ?? exactEmptiesFor(resolved, geometry.cellCount, geometry.kind),
      multiPv: resolved.temperature > 0,
      deadline,
    }),
  );
  return finishSearch(search, result, { clock, random });
}

export default chooseOthelloMove;

import { GomokuEngine } from "../../game/gomokuEngine.js";
import { buildFlatView } from "./flatView.js";
import {
  RAPFI_LICENSE,
  RAPFI_MAX_BOARD_SIZE,
  RAPFI_MIN_BOARD_SIZE,
  RAPFI_VERSION,
  RapfiCancelledError,
  RapfiEngine,
  rapfiNetworkSupports,
} from "./rapfiBridge.js";
import {
  BLACK,
  EMPTY,
  TacticalBoard,
  colorValue,
  findVcf,
  opponentOf,
  rankMoves,
} from "./tactics.js";

/**
 * Gomoku AI for topology boards: Rapfi on a flat view of the board, wrapped
 * in exact topology-aware tactics.
 *
 *   1. Play an immediate win (Black under Renju: exactly five).
 *   2. Otherwise block the opponent's immediate win.
 *   3. normal/hard: play our own VCF if a budgeted search finds one.
 *   4. Ask Rapfi on the flat view (flatView.js), blocking cells that do not
 *      exist there and, for Black under Renju, our forbidden points. Every
 *      answer is checked with GomokuEngine.checkPlay on the real topology; an
 *      illegal one is blocked and Rapfi asked again (at most twice more).
 *   5. Without a usable Rapfi answer, play the best legal heuristic move.
 *   6. normal/hard: if the opponent would then have a VCF (across seams that
 *      Rapfi cannot see), switch to a cell of that VCF that refutes it.
 *
 * Levels: easy = classical evaluation, depth <= 6 with Rapfi's skill
 * handicap, no VCF; normal = NNUE network, depth <= 12; hard = NNUE, full
 * depth. The network downloads in the background on first use and Rapfi's
 * classical evaluation plays until it is ready (Renju's network covers only
 * 15-line flat boards, freestyle's 13-22).
 */

export const GOMOKU_AI_LEVELS = Object.freeze(["easy", "normal", "hard"]);
export const GOMOKU_AI_DEFAULT_TIME_MS = Object.freeze({ easy: 300, normal: 1500, hard: 4000 });
export const GOMOKU_AI_INFO = Object.freeze({
  engine: "rapfi",
  version: RAPFI_VERSION,
  license: RAPFI_LICENSE,
  levels: GOMOKU_AI_LEVELS,
});

const LEVEL_SETTINGS = Object.freeze({
  easy: Object.freeze({ network: false, maxDepth: 6, strength: 20, vcf: false, defence: false }),
  normal: Object.freeze({ network: true, maxDepth: 12, strength: 100, vcf: true, defence: true }),
  hard: Object.freeze({ network: true, maxDepth: 99, strength: 100, vcf: true, defence: true }),
});
const MIN_TIME_MS = 50;
const MAX_TIME_MS = 120_000;
// Each synchronous VCF run is capped so a cancel is never kept waiting long.
const VCF_SLICE_MS = 250;
const RAPFI_ATTEMPTS = 3;

export class GomokuAiError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "GomokuAiError";
    this.code = code;
  }
}

function cancelled() {
  return new GomokuAiError("CANCELLED", "The Gomoku AI request was cancelled");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelled();
}

let defaultEngine = null;
let defaultInstance = null;

/**
 * The shared Rapfi engine for this realm (one per worker), loaded on first
 * use. Resolves to null when Rapfi cannot run here (no wasm SIMD, missing
 * files); the AI then plays from its own tactics and the next request tries
 * again. An instance that crashed (a WebAssembly trap) is replaced.
 *
 * @returns {Promise<RapfiEngine|null>}
 */
export function getDefaultRapfiEngine() {
  if (defaultInstance?.broken) {
    defaultInstance = null;
    defaultEngine = null;
  }
  defaultEngine ??= RapfiEngine.load().then(
    (engine) => {
      defaultInstance = engine;
      return engine;
    },
    (error) => {
      defaultEngine = null;
      getDefaultRapfiEngine.lastError = error;
      return null;
    },
  );
  return defaultEngine;
}

/** Load the engine (and optionally a rule's network) ahead of the first move. */
export async function prepareGomokuAi({ engine, ruleSet, level } = {}) {
  const rapfi = engine ?? (await getDefaultRapfiEngine());
  if (rapfi && ruleSet && LEVEL_SETTINGS[level ?? "normal"]?.network) {
    rapfi.loadNetwork(ruleSet).catch(() => {});
  }
  return {
    ...GOMOKU_AI_INFO,
    rapfi: Boolean(rapfi),
    ...(rapfi ? {} : { fallback: "tactics", reason: getDefaultRapfiEngine.lastError?.message ?? "Rapfi unavailable" }),
  };
}

function normalizeLevel(level) {
  return GOMOKU_AI_LEVELS.includes(level) ? level : "normal";
}

function normalizeTime(timeLimitMs, level) {
  const value = Number(timeLimitMs);
  if (!Number.isFinite(value) || value <= 0) return GOMOKU_AI_DEFAULT_TIME_MS[level];
  return Math.min(MAX_TIME_MS, Math.max(MIN_TIME_MS, value));
}

function createGame(position) {
  if (position === null || typeof position !== "object") {
    throw new GomokuAiError("BAD_POSITION", "position must be an object");
  }
  if (position.gameType !== undefined && position.gameType !== "gomoku") {
    throw new GomokuAiError("BAD_POSITION", `Not a Gomoku position: ${position.gameType}`);
  }
  try {
    return new GomokuEngine({
      width: position.width,
      height: position.height,
      topology: position.topology,
      ruleSet: position.ruleSet ?? "freestyle",
      initialBoard: position.board,
      currentPlayer: position.currentPlayer,
    });
  } catch (error) {
    throw new GomokuAiError("BAD_POSITION", error.message, { cause: error });
  }
}

/** Order flat-view stones so the ones nearest the last move come last. */
function viewStones(view, board, lastMove) {
  const lastFlat = lastMove >= 0 ? view.toFlat[lastMove] : -1;
  const stones = [];
  for (let flat = 0; flat < view.toBoard.length; flat += 1) {
    const index = view.toBoard[flat];
    if (index < 0 || board.cells[index] === EMPTY) continue;
    const x = flat % view.size;
    const y = Math.floor(flat / view.size);
    const distance = lastFlat < 0
      ? 0
      : Math.max(Math.abs(x - (lastFlat % view.size)), Math.abs(y - Math.floor(lastFlat / view.size)));
    stones.push({ x, y, color: board.cells[index] === BLACK ? "black" : "white", distance, index });
  }
  stones.sort((a, b) => b.distance - a.distance || (a.index === lastMove) - (b.index === lastMove));
  return stones.map(({ x, y, color }) => ({ x, y, color }));
}

/**
 * Choose a move for the side to move.
 *
 * @param {object} position Worker-protocol position: {gameType?, ruleSet?,
 *   width, height, topology, board, currentPlayer, lastMove?, moveCount?}.
 * @param {{level?: 'easy'|'normal'|'hard', timeLimitMs?: number}} [settings]
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {RapfiEngine|null} [options.engine] Defaults to the shared engine;
 *   null plays from tactics alone.
 * @param {boolean} [options.waitForNetwork=false] Wait for the NNUE network
 *   download instead of playing classical meanwhile.
 * @param {(info: object) => void} [options.onProgress]
 * @returns {Promise<{move: {row: number, col: number}, info: object}>}
 */
export async function chooseGomokuMove(position, settings = {}, options = {}) {
  const { signal, waitForNetwork = false, onProgress } = options;
  const started = performance.now();
  // Time spent waiting for a network download (waitForNetwork) does not
  // count against the thinking time.
  const clock = { waited: 0 };
  throwIfAborted(signal);
  const game = createGame(position);
  const level = normalizeLevel(settings?.level);
  const levelSettings = LEVEL_SETTINGS[level];
  const timeLimit = normalizeTime(settings?.timeLimitMs, level);
  const ruleSet = game.ruleSet;
  const board = new TacticalBoard({
    topology: game.topology,
    width: game.width,
    height: game.height,
    ruleSet,
    board: game.board,
  });
  const me = colorValue(game.currentPlayer);
  const opponent = opponentOf(me);
  const legal = (index) => {
    const row = Math.floor(index / game.width);
    return game.checkPlay(row, index - row * game.width).ok;
  };
  const finish = (index, source, extra = {}) => {
    const row = Math.floor(index / game.width);
    return {
      move: { row, col: index - row * game.width },
      info: {
        engine: "rapfi",
        ms: Math.round(performance.now() - started),
        source,
        level,
        ...(clock.waited > 0 ? { waitMs: Math.round(clock.waited) } : {}),
        ...extra,
      },
    };
  };

  if (game.legalMoves().length === 0) {
    throw new GomokuAiError("NO_LEGAL_MOVE", "The side to move has no legal point");
  }

  // 1. Our immediate win.
  const wins = board.winningPoints(me).filter(legal);
  if (wins.length > 0) return finish(wins[0], "win");

  // 2. The opponent's immediate wins: block (the most useful point if several).
  const threats = board.winningPoints(opponent);
  if (threats.length > 0) {
    const blocks = threats
      .filter(legal)
      .map((index) => ({ index, score: board.scoreMove(index, me) }))
      .sort((a, b) => b.score - a.score);
    if (blocks.length > 0) return finish(blocks[0].index, "block", { threats: threats.length });
  }

  // 3. Our own VCF.
  if (levelSettings.vcf && threats.length === 0) {
    const vcfBudget = Math.min(VCF_SLICE_MS, timeLimit * 0.15);
    const vcf = findVcf(board, me, { deadline: performance.now() + vcfBudget, maxNodes: 20_000 });
    if (vcf.line && legal(vcf.line[0])) {
      return finish(vcf.line[0], "vcf", { vcfLength: (vcf.line.length + 1) / 2 });
    }
  }
  throwIfAborted(signal);

  // 4. Rapfi on the flat view.
  let choice = null;
  let engine = options.engine;
  if (engine === undefined) engine = await getDefaultRapfiEngine();
  throwIfAborted(signal);
  const emptyBoard = board.cells.every((cell) => cell === EMPTY);
  if (engine && !emptyBoard) {
    choice = await askRapfi({
      engine, game, board, position, level: levelSettings, ruleSet, legal,
      deadline: () => started + clock.waited + timeLimit * (levelSettings.defence ? 0.8 : 0.9),
      clock, signal, waitForNetwork, onProgress,
    });
  }

  // 5. Heuristic fallback (also the opening move on an empty board).
  if (!choice) {
    const best = rankMoves(board, me).find(({ index }) => legal(index));
    const anyLegal = game.legalMoves()[0];
    choice = {
      index: best ? best.index : anyLegal.row * game.width + anyLegal.col,
      source: emptyBoard ? "opening" : engine ? "heuristic" : "tactics",
    };
  }

  // 6. Refute an opponent VCF that our move would allow.
  if (levelSettings.defence) {
    throwIfAborted(signal);
    choice = defendAgainstVcf({
      board, me, opponent, choice, legal,
      checkDeadline: performance.now() + Math.min(VCF_SLICE_MS, timeLimit * 0.1),
      hardDeadline: started + clock.waited + timeLimit * 1.1,
    });
  }
  const { index, source, ...extra } = choice;
  return finish(index, source, extra);
}

async function askRapfi({
  engine, game, board, position, level, ruleSet, legal, deadline: deadlineOf, clock, signal, waitForNetwork,
  onProgress,
}) {
  const lastMove = position.lastMove && Number.isInteger(position.lastMove.row) &&
    Number.isInteger(position.lastMove.col) && game.get(position.lastMove.row, position.lastMove.col)
    ? position.lastMove.row * game.width + position.lastMove.col
    : -1;
  const view = buildFlatView({
    topology: game.topology,
    width: game.width,
    height: game.height,
    cells: board.cells,
    lastMove,
    maxSize: RAPFI_MAX_BOARD_SIZE,
    // Rapfi plays boards of 5 lines or more; a smaller view sits in a
    // corner of one, the rest blocked.
    size: RAPFI_MIN_BOARD_SIZE,
  });
  const wantNetwork = level.network && rapfiNetworkSupports(ruleSet, view.size);
  if (wantNetwork && !engine.networkReady(ruleSet)) {
    const loading = engine.loadNetwork(ruleSet, {
      onProgress: (info) => onProgress?.({ phase: "network", ...info }),
    });
    loading.catch(() => {});
    if (waitForNetwork) {
      const waitStarted = performance.now();
      await Promise.race([
        loading.catch(() => {}),
        new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true })),
      ]);
      clock.waited += performance.now() - waitStarted;
      throwIfAborted(signal);
    }
  }

  const stones = viewStones(view, board, lastMove);
  const blocks = [];
  for (let flat = 0; flat < view.toBoard.length; flat += 1) {
    if (view.toBoard[flat] < 0) blocks.push({ x: flat % view.size, y: Math.floor(flat / view.size) });
  }
  if (game.ruleSet === "renju" && game.currentPlayer === "black") {
    for (const { row, col } of game.forbiddenPoints()) {
      const flat = view.toFlat[row * game.width + col];
      if (flat >= 0) blocks.push({ x: flat % view.size, y: Math.floor(flat / view.size) });
    }
  }

  const deadline = deadlineOf();
  for (let attempt = 0; attempt < RAPFI_ATTEMPTS; attempt += 1) {
    const now = performance.now();
    const attemptDeadline = attempt === 0 ? deadline : Math.max(now + 30, Math.min(deadline, now + 200));
    let result;
    try {
      result = await engine.think({
        size: view.size,
        ruleSet,
        network: wantNetwork,
        stones,
        toMove: game.currentPlayer,
        blocks,
        deadline: attemptDeadline,
        maxDepth: level.maxDepth,
        strength: level.strength,
        signal,
        onProgress: (info) => onProgress?.({ phase: "search", ...info }),
      });
    } catch (error) {
      if (error instanceof RapfiCancelledError) throw cancelled();
      return null;
    }
    if (!result) return null;
    const { x, y } = result.move;
    const onEngineBoard = x >= 0 && x < view.size && y >= 0 && y < view.size;
    const index = onEngineBoard ? view.toBoard[y * view.size + x] : -1;
    if (index >= 0 && legal(index)) {
      return {
        index,
        source: "rapfi",
        evaluator: result.evaluator,
        depth: result.depth,
        nodes: result.nodes,
        score: result.mate === null ? result.score : Math.sign(result.mate) * (30000 - Math.abs(result.mate)),
        view: { size: view.size, rowOffset: view.rowOffset, columnOffset: view.columnOffset },
      };
    }
    // Illegal on the real board (or a cell the view does not have): block it
    // and ask again.
    if (onEngineBoard) blocks.push({ x, y });
  }
  return null;
}

function defendAgainstVcf({ board, me, opponent, choice, legal, checkDeadline, hardDeadline }) {
  const threatAfter = (index, deadline) => {
    board.place(index, me);
    try {
      return findVcf(board, opponent, { deadline, maxNodes: 20_000 });
    } finally {
      board.remove(index);
    }
  };
  const threat = threatAfter(choice.index, checkDeadline);
  if (!threat.line) return choice;
  // Candidate refutations: every cell of the opponent's winning line.
  const candidates = [...new Set(threat.line)]
    .filter((index) => index !== choice.index && legal(index))
    .map((index) => ({ index, score: board.scoreMove(index, me) }))
    .sort((a, b) => b.score - a.score);
  for (const { index } of candidates) {
    const now = performance.now();
    if (now >= hardDeadline) break;
    const result = threatAfter(index, Math.min(hardDeadline, now + VCF_SLICE_MS));
    if (!result.line && !result.exhausted) {
      return { index, source: "vcf-defence", replaced: choice.source };
    }
  }
  return { ...choice, opponentVcf: true };
}

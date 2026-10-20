import { GAME_GOMOKU, GAME_OTHELLO, GOMOKU_RENJU } from "../../game/gameTypes.js";
import { GomokuEngine } from "../../game/gomokuEngine.js";
import { lineWindows, winningRun } from "../../game/lineRuns.js";
import { OthelloEngine } from "../../game/othelloEngine.js";
import { AXES, getTopology } from "../../topology/index.js";

/**
 * A small, dependency-free AI for Gomoku and Othello on every topology. It
 * answers the shared game-AI worker protocol (see gameAiClient.js) until the
 * dedicated engines (Rapfi for Gomoku, the Othello engine) are wired in, and
 * stays available as a last resort if they cannot start.
 *
 * Gomoku: win now > block the opponent's win > the point with the most line
 * potential, scored over every five-cell window through it on the real
 * topology (wrapping and Möbius seams included); Black never plays a Renju
 * forbidden point. Othello: mobility-first greedy play, with a short
 * look-ahead at "hard". Every move is checked with the game's own engine.
 */

export const FALLBACK_AI_ENGINE = "topology-fallback";
export const FALLBACK_AI_VERSION = "1";
export const GAME_AI_LEVELS = Object.freeze(["easy", "normal", "hard"]);
export const DEFAULT_TIME_LIMITS_MS = Object.freeze({ easy: 300, normal: 1500, hard: 4000 });

/** An error with a protocol code ("CANCELLED", "BAD_POSITION", "NO_LEGAL_MOVE"). */
export class GameAiError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "GameAiError";
    this.code = code;
  }
}

const COLORS = new Set(["black", "white"]);

function opposite(color) {
  return color === "black" ? "white" : "black";
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new GameAiError("CANCELLED", "The AI search was cancelled.");
}

/** Let a worker read its message queue (a cancel) during a long search. */
function yieldToEvents() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeLevel(level) {
  return GAME_AI_LEVELS.includes(level) ? level : "normal";
}

function timeLimitFor(settings) {
  const level = normalizeLevel(settings?.level);
  const requested = Number(settings?.timeLimitMs);
  return Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_TIME_LIMITS_MS[level];
}

/**
 * Validate a protocol position and copy its board.
 *
 * @returns {{gameType: string, width: number, height: number, topology: string,
 *   ruleSet?: string, board: Array<Array<string|null>>, currentPlayer: string}}
 */
function readPosition(position) {
  if (!position || typeof position !== "object") {
    throw new GameAiError("BAD_POSITION", "A position object is required.");
  }
  const { gameType, width, height, topology, currentPlayer } = position;
  if (gameType !== GAME_GOMOKU && gameType !== GAME_OTHELLO) {
    throw new GameAiError("BAD_POSITION", `Unsupported game: ${gameType}`);
  }
  if (!COLORS.has(currentPlayer)) {
    throw new GameAiError("BAD_POSITION", "The side to move is invalid.");
  }
  if (
    !Array.isArray(position.board) ||
    position.board.length !== height ||
    position.board.some((row) => !Array.isArray(row) || row.length !== width)
  ) {
    throw new GameAiError("BAD_POSITION", "The board does not match its size.");
  }
  const board = position.board.map((row) =>
    row.map((value) => (value === "black" || value === "white" ? value : null)),
  );
  return {
    gameType,
    width,
    height,
    topology: topology ?? "cylinder",
    ruleSet: position.ruleSet,
    board,
    currentPlayer,
  };
}

/* ------------------------------------------------------------------ */
/* Gomoku                                                              */
/* ------------------------------------------------------------------ */

const WINDOW = 5;
const RADIUS = WINDOW - 1;
const SPAN = 2 * RADIUS + 1;
// Value of a clean five-cell window holding n of one colour (plus the
// candidate point): building toward five for the mover, and stopping the
// opponent's windows.
const ATTACK_WEIGHTS = Object.freeze([1, 12, 120, 1_600, 120_000]);
const DEFENSE_WEIGHTS = Object.freeze([0, 10, 100, 1_300, 60_000]);

function gomokuWins(ruleSet, color) {
  return ruleSet === GOMOKU_RENJU && color === "black"
    ? (length) => length === 5
    : (length) => length >= 5;
}

/**
 * Line potential of an empty cell for `color`: every clean five-cell window
 * through it on each axis, using the topology's own lines.
 */
function windowScores(table, cells, cell, color) {
  let attack = 0;
  let defense = 0;
  for (let axis = 0; axis < AXES.length; axis += 1) {
    const base = (cell * AXES.length + axis) * SPAN;
    for (let start = 0; start + WINDOW <= SPAN; start += 1) {
      if (start > RADIUS || start + WINDOW - 1 < RADIUS) continue;
      let own = 0;
      let other = 0;
      let complete = true;
      for (let offset = start; offset < start + WINDOW; offset += 1) {
        const index = table[base + offset];
        if (index < 0) {
          complete = false;
          break;
        }
        const value = cells[index];
        if (value === color) own += 1;
        else if (value !== null) other += 1;
      }
      if (!complete) continue;
      if (other === 0) attack += ATTACK_WEIGHTS[Math.min(own, 4)];
      if (own === 0) defense += DEFENSE_WEIGHTS[Math.min(other, 4)];
    }
  }
  return { attack, defense };
}

/** Empty cells within two steps (on the topology) of any stone. */
function gomokuCandidates(topology, cells) {
  const candidates = new Set();
  let stones = 0;
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] === null) continue;
    stones += 1;
    const { row, col } = topology.point(cell);
    for (const first of topology.neighbors8(row, col)) {
      const firstIndex = topology.index(first.row, first.col);
      if (cells[firstIndex] === null) candidates.add(firstIndex);
      for (const second of topology.neighbors8(first.row, first.col)) {
        const secondIndex = topology.index(second.row, second.col);
        if (cells[secondIndex] === null) candidates.add(secondIndex);
      }
    }
  }
  return { candidates: [...candidates], stones };
}

function pickWeighted(entries, random, count) {
  const pool = entries.slice(0, count);
  const total = pool.reduce((sum, entry) => sum + Math.max(1, entry.score), 0);
  let target = random() * total;
  for (const entry of pool) {
    target -= Math.max(1, entry.score);
    if (target <= 0) return entry;
  }
  return pool[0];
}

async function chooseGomoku(position, settings, { signal, random }) {
  const started = now();
  const level = normalizeLevel(settings?.level);
  const deadline = started + timeLimitFor(settings) * 0.8;
  const engine = new GomokuEngine({
    width: position.width,
    height: position.height,
    topology: position.topology,
    ruleSet: position.ruleSet,
    initialBoard: position.board,
    currentPlayer: position.currentPlayer,
  });
  const ruleSet = engine.ruleSet;
  const topology = getTopology(engine.topology, engine.width, engine.height);
  const me = position.currentPlayer;
  const them = opposite(me);
  const cells = position.board.flat();
  const forbidden = new Set(
    ruleSet === GOMOKU_RENJU && me === "black"
      ? engine.forbiddenPoints().map(({ row, col }) => topology.index(row, col))
      : [],
  );
  const legal = (cell) => cells[cell] === null && !forbidden.has(cell);
  const info = (cell, extra = {}) => ({
    move: topology.point(cell),
    info: {
      engine: FALLBACK_AI_ENGINE,
      source: "fallback",
      ms: Math.round(now() - started),
      depth: level === "hard" ? 2 : 1,
      ...extra,
    },
  });

  let { candidates, stones } = gomokuCandidates(topology, cells);
  if (stones === 0) {
    const centre = topology.index(Math.floor(engine.height / 2), Math.floor(engine.width / 2));
    if (legal(centre)) return info(centre, { nodes: 1, score: 0 });
  }
  candidates = candidates.filter(legal);
  if (candidates.length === 0) {
    candidates = engine.legalMoves().map(({ row, col }) => topology.index(row, col));
  }
  if (candidates.length === 0) {
    throw new GameAiError("NO_LEGAL_MOVE", "There is no legal point to play.");
  }

  const board = position.board;
  const makesFive = (cell, color) => {
    const { row, col } = topology.point(cell);
    board[row][col] = color;
    const run = winningRun(topology, board, row, col, color, gomokuWins(ruleSet, color));
    board[row][col] = null;
    return Boolean(run);
  };

  // 1. Win at once.
  const win = candidates.find((cell) => makesFive(cell, me));
  if (win !== undefined) return info(win, { nodes: candidates.length, score: 1 });
  throwIfAborted(signal);

  // 2. Block a five the opponent would make next move (on any empty point,
  //    not only near stones: a long wrapped line can end far away).
  const threats = [];
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] === null && makesFive(cell, them)) threats.push(cell);
  }
  const blocks = threats.filter(legal);
  if (blocks.length > 0) {
    return info(blocks[0], { nodes: candidates.length + cells.length, score: -1 });
  }
  throwIfAborted(signal);

  // 3. The most line potential for us, weighed against the opponent's.
  const table = lineWindows(topology, RADIUS);
  const defenseWeight = level === "easy" ? 0.35 : 0.9;
  const scored = candidates.map((cell) => {
    const { attack, defense } = windowScores(table, cells, cell, me);
    return { cell, score: attack + defense * defenseWeight };
  });
  scored.sort((left, right) => right.score - left.score || left.cell - right.cell);

  if (level === "easy") {
    return info(pickWeighted(scored, random, 6).cell, { nodes: scored.length });
  }
  if (level === "normal") {
    const best = scored[0].score;
    const ties = scored.filter((entry) => entry.score === best);
    const choice = ties[Math.floor(random() * ties.length)] ?? scored[0];
    return info(choice.cell, { nodes: scored.length, score: choice.score });
  }

  // Hard: look one reply ahead over the strongest candidates and avoid
  // moves that hand the opponent a stronger answer.
  let nodes = scored.length;
  let best = scored[0];
  let bestValue = -Infinity;
  const shortlist = scored.slice(0, 10);
  for (let index = 0; index < shortlist.length; index += 1) {
    const entry = shortlist[index];
    if (index > 0 && now() > deadline) break;
    throwIfAborted(signal);
    cells[entry.cell] = me;
    const { candidates: replies } = gomokuCandidates(topology, cells);
    let reply = 0;
    for (const cell of replies) {
      const { attack, defense } = windowScores(table, cells, cell, them);
      reply = Math.max(reply, attack + defense * 0.9);
    }
    nodes += replies.length;
    cells[entry.cell] = null;
    const value = entry.score - reply * 0.6;
    if (value > bestValue) {
      bestValue = value;
      best = entry;
    }
    if (index % 3 === 2) {
      await yieldToEvents();
      throwIfAborted(signal);
    }
  }
  return info(best.cell, { nodes, score: Math.round(bestValue) });
}

/* ------------------------------------------------------------------ */
/* Othello                                                             */
/* ------------------------------------------------------------------ */

function othelloEngine(position, board = position.board, currentPlayer = position.currentPlayer) {
  return new OthelloEngine({
    width: position.width,
    height: position.height,
    topology: position.topology,
    initialBoard: board,
    currentPlayer,
  });
}

/**
 * Score one Othello move for the side to move: keep the opponent's mobility
 * low, prefer points few lines can cross (board edges on the cylinder and
 * Möbius strip), and count discs near the end.
 */
function othelloMoveScore(position, topology, move, { emptyCount }) {
  const engine = othelloEngine(position);
  const me = engine.currentPlayer;
  const them = opposite(me);
  const result = engine.play(move.row, move.col);
  if (!result.ok) return null;
  const flipped = result.flipped.length;
  const opponentMoves = engine.phase === "play" && engine.currentPlayer === them
    ? engine.legalMoves().length
    : 0;
  const neighbours = topology.neighbors8(move.row, move.col).length;
  const { black, white } = engine.discs;
  const discDiff = me === "black" ? black - white : white - black;
  let score = -12 * opponentMoves + flipped + (8 - neighbours) * 7;
  if (result.skipped === them) score += 45;
  if (emptyCount <= 12) score += discDiff * 4;
  if (engine.phase === "finished") {
    score += discDiff > 0 ? 10_000 : discDiff < 0 ? -10_000 : 0;
  }
  return { score, engine, flipped };
}

async function chooseOthello(position, settings, { signal, random }) {
  const started = now();
  const level = normalizeLevel(settings?.level);
  const deadline = started + timeLimitFor(settings) * 0.8;
  const root = othelloEngine(position);
  const topology = getTopology(root.topology, root.width, root.height);
  const moves = root.legalMoves();
  if (moves.length === 0) {
    throw new GameAiError("NO_LEGAL_MOVE", "The side to move has no legal move.");
  }
  const emptyCount = position.board.flat().filter((value) => value === null).length;
  const info = (move, extra = {}) => ({
    move: { row: move.row, col: move.col },
    info: {
      engine: FALLBACK_AI_ENGINE,
      source: "fallback",
      ms: Math.round(now() - started),
      depth: level === "hard" ? 2 : 1,
      ...extra,
    },
  });

  const scored = [];
  for (const move of moves) {
    const evaluation = othelloMoveScore(position, topology, move, { emptyCount });
    if (evaluation) scored.push({ move, ...evaluation });
  }
  throwIfAborted(signal);
  if (scored.length === 0) {
    throw new GameAiError("NO_LEGAL_MOVE", "The side to move has no legal move.");
  }

  if (level === "easy") {
    // Mostly greedy for discs, with noise: easy to read and to beat.
    const ranked = scored
      .map((entry) => ({ ...entry, score: entry.flipped * 10 + random() * 30 }))
      .sort((left, right) => right.score - left.score);
    return info(ranked[0].move, { nodes: scored.length });
  }
  scored.sort((left, right) => right.score - left.score);
  if (level === "normal") {
    const best = scored[0].score;
    const ties = scored.filter((entry) => entry.score === best);
    const choice = ties[Math.floor(random() * ties.length)] ?? scored[0];
    return info(choice.move, { nodes: scored.length, score: choice.score });
  }

  // Hard: assume the opponent answers with its own best-scoring reply.
  let nodes = scored.length;
  let best = scored[0];
  let bestValue = -Infinity;
  const shortlist = scored.slice(0, 8);
  for (let index = 0; index < shortlist.length; index += 1) {
    const entry = shortlist[index];
    if (index > 0 && now() > deadline) break;
    throwIfAborted(signal);
    const after = entry.engine;
    let reply = 0;
    if (after.phase === "play" && after.currentPlayer !== position.currentPlayer) {
      const replyPosition = {
        ...position,
        board: after.getBoard(),
        currentPlayer: after.currentPlayer,
      };
      const replyEmpty = replyPosition.board.flat().filter((value) => value === null).length;
      reply = -Infinity;
      for (const answer of after.legalMoves()) {
        const evaluation = othelloMoveScore(replyPosition, topology, answer, {
          emptyCount: replyEmpty,
        });
        nodes += 1;
        if (evaluation) reply = Math.max(reply, evaluation.score);
      }
      if (!Number.isFinite(reply)) reply = 0;
    }
    const value = entry.score - reply * 0.7;
    if (value > bestValue) {
      bestValue = value;
      best = entry;
    }
    if (index % 2 === 1) {
      await yieldToEvents();
      throwIfAborted(signal);
    }
  }
  return info(best.move, { nodes, score: Math.round(bestValue) });
}

/* ------------------------------------------------------------------ */

/**
 * Choose a move for the side to move. The answer is always legal under our
 * rules on the real topology (checked with GomokuEngine / OthelloEngine).
 *
 * @param {object} position Protocol position (gameAiClient.js).
 * @param {{level?: string, timeLimitMs?: number}} [settings]
 * @param {{signal?: AbortSignal, random?: () => number}} [options]
 * @returns {Promise<{move: {row: number, col: number}, info: object}>}
 */
export async function chooseFallbackMove(position, settings = {}, options = {}) {
  const signal = options.signal;
  const random = typeof options.random === "function" ? options.random : Math.random;
  throwIfAborted(signal);
  const parsed = readPosition(position);
  const choose = parsed.gameType === GAME_GOMOKU ? chooseGomoku : chooseOthello;
  const answer = await choose(parsed, settings, { signal, random });
  throwIfAborted(signal);
  const check = parsed.gameType === GAME_GOMOKU
    ? new GomokuEngine({
        width: parsed.width,
        height: parsed.height,
        topology: parsed.topology,
        ruleSet: parsed.ruleSet,
        initialBoard: parsed.board,
        currentPlayer: parsed.currentPlayer,
      }).checkPlay(answer.move.row, answer.move.col)
    : othelloEngine(parsed).checkPlay(answer.move.row, answer.move.col);
  if (!check.ok) {
    throw new GameAiError("ILLEGAL_MOVE", `The fallback AI chose an illegal move (${check.reason}).`);
  }
  return answer;
}

/** The ready message's info for the fallback engine. */
export function fallbackEngineInfo() {
  return {
    engine: FALLBACK_AI_ENGINE,
    version: FALLBACK_AI_VERSION,
    license: "first-party",
    levels: [...GAME_AI_LEVELS],
  };
}

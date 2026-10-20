import { OthelloBoard } from "./othelloBoard.js";
import {
  DEFAULT_WEIGHTS,
  EXACT_UNIT,
  FEATURE_COUNT,
  buildWeightTable,
  evaluate,
} from "./othelloEval.js";

/**
 * Alpha-beta search for the Othello AI.
 *
 * - Iterative deepening negamax with principal variation search, a shared
 *   transposition table (Zobrist keys, depth-preferred replacement with
 *   ageing), history-heuristic and evaluation/mobility move ordering.
 * - Passes follow the rules: a side without a move passes when the opponent
 *   can move (same depth); when neither can, the game is over and scores its
 *   exact disc margin. A search whose depth covers every empty cell is
 *   therefore exact; the last few empties use a lean solver without the
 *   table.
 * - Endgame: once the empties are few enough, iterative deepening jumps to
 *   an exact solve; if that cannot finish in time the deepest completed
 *   heuristic result is kept.
 * - Time: the search stops at a hard deadline (checked every few hundred
 *   nodes). The upper plies are generators that yield every SLICE_MS, so the
 *   async driver can return to the event loop (worker `cancel` messages,
 *   AbortSignal) while the lower plies run as plain recursion.
 */

export const INF = 0x3fffffff;
const EXACT_DEPTH = 127;
const TT_LOWER = 1;
const TT_UPPER = 2;
const TT_EXACT = 3;
/** Exact solves with at most this many empties skip the table. */
const SMALL_SOLVE_EMPTIES = 5;
/** Fastest-first ordering in exact solves above this many empties. */
const FASTEST_FIRST_EMPTIES = 5;
/** Interior nodes at least this deep order their moves by static evaluation. */
const EVAL_ORDER_DEPTH = 4;
/** Share of the time the heuristic search keeps before an endgame solve. */
const HEURISTIC_SHARE_BEFORE_SOLVE = 0.3;
/** Generator plies yield to the event loop after this many milliseconds. */
export const SLICE_MS = 12;

/** Transposition table on typed arrays; keys are two 32-bit halves. */
export class TranspositionTable {
  constructor(bits = 19) {
    const size = 1 << bits;
    this.mask = size - 1;
    this.lo = new Int32Array(size);
    this.hi = new Int32Array(size);
    this.score = new Int32Array(size);
    this.move = new Int16Array(size);
    this.depth = new Int8Array(size);
    this.flag = new Uint8Array(size);
    this.age = new Uint8Array(size);
    this.generation = 0;
  }

  clear() {
    this.flag.fill(0);
  }

  newSearch() {
    this.generation = (this.generation + 1) & 0xff;
  }

  probe(keyLo, keyHi) {
    const index = keyLo & this.mask;
    return this.flag[index] !== 0 && this.lo[index] === keyLo && this.hi[index] === keyHi
      ? index
      : -1;
  }

  store(keyLo, keyHi, score, depth, flag, move) {
    const index = keyLo & this.mask;
    if (
      this.flag[index] !== 0 &&
      this.age[index] === this.generation &&
      this.depth[index] > depth &&
      !(this.lo[index] === keyLo && this.hi[index] === keyHi)
    ) {
      return;
    }
    this.lo[index] = keyLo;
    this.hi[index] = keyHi;
    this.score[index] = score;
    this.move[index] = move;
    this.depth[index] = depth;
    this.flag[index] = flag;
    this.age[index] = this.generation;
  }
}

/** Default clock: performance.now when present. */
export const defaultClock =
  typeof globalThis.performance?.now === "function"
    ? () => globalThis.performance.now()
    : () => Date.now();

/**
 * One search over one position. Create a fresh searcher per request (they
 * hold the board being searched); share the transposition table between
 * searchers of the same board shape.
 */
export class OthelloSearcher {
  /**
   * @param {ReturnType<import("./othelloGeometry.js").getOthelloGeometry>} geometry
   * @param {{tt?: TranspositionTable, weights?: object, clock?: () => number}} [options]
   */
  constructor(geometry, { tt, weights = DEFAULT_WEIGHTS, clock = defaultClock } = {}) {
    this.geometry = geometry;
    this.board = new OthelloBoard(geometry);
    this.cellCount = geometry.cellCount;
    this.tt = tt ?? new TranspositionTable(geometry.cellCount <= 100 ? 19 : 18);
    this.weightTable = buildWeightTable(geometry, weights);
    this.clock = clock;
    this.history = new Int32Array(3 * geometry.cellCount);
    this.moveLists = [];
    this.keyLists = [];
    this.scratch = new Int32Array(4);
    this.features = new Float64Array(FEATURE_COUNT);
    this.smallEmpties = new Int16Array(64);
    this.smallCount = 0;
    this.nodes = 0;
    this.stopped = false;
    this.deadline = Infinity;
    this.sliceStart = 0;
    // Node interval between clock checks; big boards have slower nodes.
    this.checkMask = geometry.cellCount > 256 ? 63 : geometry.cellCount > 100 ? 255 : 1023;
    // Generator plies: heuristic nodes at least this deep, exact nodes with
    // at least this many empties. Lower plies are synchronous.
    this.genDepth = geometry.cellCount > 400 ? 2 : geometry.cellCount > 100 ? 3 : 4;
    this.genEmpties = geometry.cellCount > 400 ? 9 : geometry.cellCount > 100 ? 10 : 12;
    this.evalOrderDepth = EVAL_ORDER_DEPTH;
    this.mobilityOrderDepth = Infinity;
    this.fastestFirstEmpties = FASTEST_FIRST_EMPTIES;
    this.smallSolveEmpties = SMALL_SOLVE_EMPTIES;
  }

  /** Set the position: values[cell] in {0,1,2}, side 1 (black) or 2 (white). */
  setPosition(values, side) {
    this.board.load(values);
    this.rootSide = side;
  }

  #ensurePly(ply) {
    while (this.moveLists.length <= ply) {
      this.moveLists.push(new Int16Array(this.cellCount));
      this.keyLists.push(new Float64Array(this.cellCount));
    }
  }

  #tick() {
    this.nodes += 1;
    if ((this.nodes & this.checkMask) === 0 && this.clock() >= this.deadline) {
      this.stopped = true;
    }
    return this.stopped;
  }

  /** Static evaluation for `side` (exact on finished positions). */
  evaluate(side) {
    return evaluate(this.board, side, this.weightTable, this.scratch, this.features);
  }

  /**
   * Exact solve in disc units without the table (few empties), fail-soft.
   * Uses lean moves over a private copy of the empty cells.
   */
  solveSmall(alpha, beta, side) {
    const board = this.board;
    const count = board.emptyCount;
    for (let slot = 0; slot < count; slot += 1) this.smallEmpties[slot] = board.emptyList[slot];
    this.smallCount = count;
    return this.#solveLean(alpha, beta, side, count);
  }

  #solveLean(alpha, beta, side, left) {
    if (this.#tick()) return 0;
    const board = this.board;
    const cells = board.cells;
    const counts = board.counts;
    const opponent = 3 - side;
    const empties = this.smallEmpties;
    const total = this.smallCount;
    if (left <= 1) {
      const diff = counts[side] - counts[opponent];
      if (left === 0) return diff;
      let cell = empties[0];
      for (let slot = 1; cells[cell] !== 0; slot += 1) cell = empties[slot];
      let flips = board.countFlips(cell, side);
      if (flips > 0) return diff + 2 * flips + 1;
      flips = board.countFlips(cell, opponent);
      if (flips > 0) return diff - 2 * flips - 1;
      return diff;
    }
    let best = -INF;
    for (let slot = 0; slot < total; slot += 1) {
      const cell = empties[slot];
      if (cells[cell] !== 0 || board.makeMoveLean(cell, side) === 0) continue;
      const score = -this.#solveLean(-beta, -alpha, opponent, left - 1);
      board.unmakeMoveLean(side);
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) return best;
        }
      }
    }
    if (best !== -INF) return best;
    for (let slot = 0; slot < total; slot += 1) {
      const cell = empties[slot];
      if (cells[cell] === 0 && board.isLegalLean(cell, opponent)) {
        return -this.#solveLean(-beta, -alpha, opponent, left);
      }
    }
    return counts[side] - counts[opponent];
  }

  #solveSmallScaled(alpha, beta, side) {
    return (
      EXACT_UNIT *
      this.solveSmall(Math.floor(alpha / EXACT_UNIT), Math.ceil(beta / EXACT_UNIT), side)
    );
  }

  #ttKey(side) {
    const board = this.board;
    const geometry = this.geometry;
    return side === 2
      ? [board.hashLo ^ geometry.sideLo, board.hashHi ^ geometry.sideHi]
      : [board.hashLo, board.hashHi];
  }

  /** Fill keys[] with ordering scores for moves[0..count). */
  #scoreMoves(moves, keys, count, side, depth, exact, ttMove) {
    const board = this.board;
    const opponent = 3 - side;
    const history = this.history;
    const offset = side * this.cellCount;
    const fastestFirst = exact && board.emptyCount > this.fastestFirstEmpties;
    const byEval = !exact && depth >= this.evalOrderDepth;
    const byMobility = !exact && !byEval && depth >= this.mobilityOrderDepth;
    for (let index = 0; index < count; index += 1) {
      const move = moves[index];
      if (move === ttMove) {
        keys[index] = 1e15;
        continue;
      }
      let key = Math.min(history[offset + move], 65535);
      if (fastestFirst) {
        board.makeMoveLean(move, side);
        key -= board.countMovesLean(opponent) * 65536;
        board.unmakeMoveLean(side);
      } else if (byMobility) {
        board.makeMove(move, side);
        key -= board.countMoves(opponent) * 65536;
        board.unmakeMove(side);
      } else if (byEval) {
        board.makeMove(move, side);
        key -= evaluate(board, opponent, this.weightTable, this.scratch, this.features) * 65536;
        board.unmakeMove(side);
      }
      keys[index] = key;
    }
  }

  /**
   * Synchronous fail-soft negamax with PVS. Returns 0 (to be ignored) once
   * the search has been stopped.
   */
  negamax(depth, alpha, beta, side, ply) {
    if (this.#tick()) return 0;
    const board = this.board;
    const empties = board.emptyCount;
    const exact = depth >= empties;
    if (exact && empties <= this.smallSolveEmpties) {
      return this.#solveSmallScaled(alpha, beta, side);
    }
    if (depth <= 0) return this.evaluate(side);

    const tt = this.tt;
    const geometry = this.geometry;
    const keyLo = side === 2 ? board.hashLo ^ geometry.sideLo : board.hashLo;
    const keyHi = side === 2 ? board.hashHi ^ geometry.sideHi : board.hashHi;
    const ttDepth = exact ? EXACT_DEPTH : depth;
    let ttMove = -1;
    const entry = tt.probe(keyLo, keyHi);
    if (entry >= 0) {
      ttMove = tt.move[entry];
      if (tt.depth[entry] >= ttDepth) {
        const score = tt.score[entry];
        const flag = tt.flag[entry];
        if (flag === TT_EXACT) return score;
        if (flag === TT_LOWER ? score >= beta : score <= alpha) return score;
      }
    }

    this.#ensurePly(ply);
    const moves = this.moveLists[ply];
    const keys = this.keyLists[ply];
    const count = board.generateMoves(side, moves);
    const opponent = 3 - side;
    if (count === 0) {
      if (!board.hasMove(opponent)) {
        return (board.counts[side] - board.counts[opponent]) * EXACT_UNIT;
      }
      return -this.negamax(depth, -beta, -alpha, opponent, ply + 1);
    }
    if (count > 1) this.#scoreMoves(moves, keys, count, side, depth, exact, ttMove);

    const alphaStart = alpha;
    let best = -INF;
    let bestMove = -1;
    for (let index = 0; index < count; index += 1) {
      pickBest(moves, keys, index, count);
      const move = moves[index];
      board.makeMove(move, side);
      let score;
      if (index === 0) {
        score = -this.negamax(depth - 1, -beta, -alpha, opponent, ply + 1);
      } else {
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, opponent, ply + 1);
        if (score > alpha && score < beta && !this.stopped) {
          score = -this.negamax(depth - 1, -beta, -alpha, opponent, ply + 1);
        }
      }
      board.unmakeMove(side);
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.history[side * this.cellCount + move] += depth * depth;
            break;
          }
        }
      }
    }
    tt.store(
      keyLo,
      keyHi,
      best,
      ttDepth,
      best <= alphaStart ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT,
      bestMove,
    );
    return best;
  }

  #useGenerator(depth, empties) {
    return depth >= empties ? empties >= this.genEmpties : depth >= this.genDepth;
  }

  /** A child search: a generator on upper plies, plain recursion below. */
  *child(depth, alpha, beta, side, ply) {
    if (this.#useGenerator(depth, this.board.emptyCount)) {
      return yield* this.negamaxGenerator(depth, alpha, beta, side, ply);
    }
    return this.negamax(depth, alpha, beta, side, ply);
  }

  /** negamax() as a generator that yields when its time slice is used up. */
  *negamaxGenerator(depth, alpha, beta, side, ply) {
    if (this.#tick()) return 0;
    const board = this.board;
    const empties = board.emptyCount;
    const exact = depth >= empties;
    const tt = this.tt;
    const geometry = this.geometry;
    const keyLo = side === 2 ? board.hashLo ^ geometry.sideLo : board.hashLo;
    const keyHi = side === 2 ? board.hashHi ^ geometry.sideHi : board.hashHi;
    const ttDepth = exact ? EXACT_DEPTH : depth;
    let ttMove = -1;
    const entry = tt.probe(keyLo, keyHi);
    if (entry >= 0) {
      ttMove = tt.move[entry];
      if (tt.depth[entry] >= ttDepth) {
        const score = tt.score[entry];
        const flag = tt.flag[entry];
        if (flag === TT_EXACT) return score;
        if (flag === TT_LOWER ? score >= beta : score <= alpha) return score;
      }
    }

    this.#ensurePly(ply);
    const moves = this.moveLists[ply];
    const keys = this.keyLists[ply];
    const count = board.generateMoves(side, moves);
    const opponent = 3 - side;
    if (count === 0) {
      if (!board.hasMove(opponent)) {
        return (board.counts[side] - board.counts[opponent]) * EXACT_UNIT;
      }
      return -(yield* this.child(depth, -beta, -alpha, opponent, ply + 1));
    }
    if (count > 1) this.#scoreMoves(moves, keys, count, side, depth, exact, ttMove);

    const alphaStart = alpha;
    let best = -INF;
    let bestMove = -1;
    for (let index = 0; index < count; index += 1) {
      if (this.clock() - this.sliceStart >= SLICE_MS) {
        yield;
        this.sliceStart = this.clock();
      }
      if (this.stopped) return 0;
      pickBest(moves, keys, index, count);
      const move = moves[index];
      board.makeMove(move, side);
      let score;
      if (index === 0) {
        score = -(yield* this.child(depth - 1, -beta, -alpha, opponent, ply + 1));
      } else {
        score = -(yield* this.child(depth - 1, -alpha - 1, -alpha, opponent, ply + 1));
        if (score > alpha && score < beta && !this.stopped) {
          score = -(yield* this.child(depth - 1, -beta, -alpha, opponent, ply + 1));
        }
      }
      board.unmakeMove(side);
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.history[side * this.cellCount + move] += depth * depth;
            break;
          }
        }
      }
    }
    tt.store(
      keyLo,
      keyHi,
      best,
      ttDepth,
      best <= alphaStart ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT,
      bestMove,
    );
    return best;
  }

  /**
   * One root iteration over rootMoves (in order) with window (alpha, beta).
   * With multiPv every move gets a full-window search (exact scores, for
   * randomized levels); otherwise PVS, stopping at the first move that
   * reaches beta. Each completed move records its score; moves left when the
   * search stops keep completed=false.
   */
  *searchRoot(depth, rootMoves, multiPv = false, alpha = -INF, beta = INF) {
    const board = this.board;
    const side = this.rootSide;
    const opponent = 3 - side;
    let best = -INF;
    let bestCell = -1;
    let completed = 0;
    for (const rootMove of rootMoves) rootMove.completed = false;
    for (let index = 0; index < rootMoves.length; index += 1) {
      if (this.clock() - this.sliceStart >= SLICE_MS) {
        yield;
        this.sliceStart = this.clock();
      }
      if (this.stopped) break;
      const rootMove = rootMoves[index];
      board.makeMove(rootMove.cell, side);
      let score;
      if (multiPv) {
        score = -(yield* this.child(depth - 1, -INF, INF, opponent, 1));
      } else if (index === 0) {
        score = -(yield* this.child(depth - 1, -beta, -alpha, opponent, 1));
      } else {
        score = -(yield* this.child(depth - 1, -alpha - 1, -alpha, opponent, 1));
        if (score > alpha && score < beta && !this.stopped) {
          score = -(yield* this.child(depth - 1, -beta, -alpha, opponent, 1));
        }
      }
      board.unmakeMove(side);
      if (this.stopped) break;
      rootMove.score = score;
      rootMove.completed = true;
      completed += 1;
      if (score > best) {
        best = score;
        bestCell = rootMove.cell;
        if (score > alpha) alpha = score;
      }
      if (!multiPv && best >= beta) break;
    }
    return { bestCell, best, completed };
  }

  /** Put `cell` first, then order by the latest scores. */
  #sortRootMoves(rootMoves, cell) {
    rootMoves.sort((left, right) =>
      left.cell === cell ? -1 : right.cell === cell ? 1 : right.score - left.score,
    );
  }

  /**
   * Iterative deepening from the position set with setPosition(), then (at
   * or below exactEmpties) a win/draw/loss solve and an exact solve.
   *
   * @param {object} options
   * @param {number} options.maxDepth Deepest heuristic iteration.
   * @param {number} options.exactEmpties Solve at or below this many empties
   *   (after a short heuristic pass for move ordering).
   * @param {boolean} [options.multiPv] Full-window scores for every root move.
   * @param {number} [options.deadline] Clock value at which to stop.
   * @param {(info: object) => void} [options.onIteration]
   * @returns {Generator<undefined, object>} yields when a time slice ends;
   *   returns { cell, score, depth, exact, outcome, source, rootMoves, nodes }.
   */
  *run({ maxDepth, exactEmpties, multiPv = false, deadline = Infinity, onIteration }) {
    const board = this.board;
    const side = this.rootSide;
    this.nodes = 0;
    this.stopped = false;
    this.deadline = deadline;
    this.sliceStart = this.clock();
    this.tt.newSearch();
    for (let index = 0; index < this.history.length; index += 1) {
      this.history[index] >>= 2;
    }

    this.#ensurePly(0);
    const moves = this.moveLists[0];
    const count = board.generateMoves(side, moves);
    if (count === 0) throw new Error("The side to move has no legal move");
    // Initial order: static evaluation after each move.
    const rootMoves = [];
    for (let index = 0; index < count; index += 1) {
      const cell = moves[index];
      board.makeMove(cell, side);
      const score = -this.evaluate(3 - side);
      board.unmakeMove(side);
      rootMoves.push({ cell, score, completed: false });
    }
    rootMoves.sort((left, right) => right.score - left.score);

    const empties = board.emptyCount;
    const snapshot = () => rootMoves.map((move) => ({ ...move }));
    let result = {
      cell: rootMoves[0].cell,
      score: rootMoves[0].score,
      depth: 0,
      exact: false,
      outcome: null,
      rootMoves: snapshot(),
    };
    const finish = (source) => ({ ...result, source, nodes: this.nodes });
    if (count === 1 && !multiPv) return finish("only-move");

    const solve = !multiPv && empties <= exactEmpties;
    if (solve && Number.isFinite(deadline)) {
      // Leave most of the time to the solve, but keep a heuristic result
      // from a fair share of it in case the solve cannot finish.
      const start = this.clock();
      this.deadline = start + (deadline - start) * HEURISTIC_SHARE_BEFORE_SOLVE;
    }
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const isExact = depth >= empties;
      const iteration = yield* this.searchRoot(depth, rootMoves, multiPv);
      if (this.stopped) {
        // A partial PVS iteration searched the previous best first; a move
        // that then completed with a higher score is better at this depth.
        if (!multiPv && rootMoves[0].completed && iteration.bestCell !== result.cell) {
          result = { ...result, cell: iteration.bestCell, score: iteration.best };
        }
        break;
      }
      result = {
        cell: iteration.bestCell,
        score: iteration.best,
        depth: isExact ? empties : depth,
        exact: isExact,
        outcome: isExact ? outcomeOf(iteration.best) : null,
        rootMoves: snapshot(),
      };
      onIteration?.({ ...result, nodes: this.nodes });
      this.#sortRootMoves(rootMoves, iteration.bestCell);
      if (isExact) return finish("endgame");
    }
    if (!solve || this.clock() >= deadline) return finish("search");
    this.stopped = false;
    this.deadline = deadline;
    this.#sortRootMoves(rootMoves, result.cell);

    // Win/draw/loss: the window (-1, +1) disc proves the outcome cheaply and
    // stops at the first winning move.
    const wld = yield* this.searchRoot(empties, rootMoves, false, -EXACT_UNIT, EXACT_UNIT);
    if (this.stopped) return finish("search");
    const outcome = outcomeOf(wld.best);
    result = {
      ...result,
      // Every move loses: keep the heuristic choice until the exact solve.
      cell: outcome === "loss" ? result.cell : wld.bestCell,
      score: outcome === "draw" ? 0 : wld.best,
      depth: empties,
      exact: outcome === "draw",
      outcome,
    };
    onIteration?.({ ...result, nodes: this.nodes });
    if (outcome === "draw") return finish("endgame");

    // Exact margin, searching only on the proven side of zero.
    this.#sortRootMoves(rootMoves, result.cell);
    const exact =
      outcome === "win"
        ? yield* this.searchRoot(empties, rootMoves, false, EXACT_UNIT - 1, INF)
        : yield* this.searchRoot(empties, rootMoves, false, -INF, 1 - EXACT_UNIT);
    if (this.stopped) return finish("endgame");
    result = {
      ...result,
      cell: exact.bestCell,
      score: exact.best,
      exact: true,
      rootMoves: snapshot(),
    };
    onIteration?.({ ...result, nodes: this.nodes });
    return finish("endgame");
  }
}

/** Game outcome for the side to move from an exact-scale score bound. */
function outcomeOf(score) {
  return score >= EXACT_UNIT ? "win" : score <= -EXACT_UNIT ? "loss" : "draw";
}

/** Move the highest-keyed of moves[from..count) to `from`. */
function pickBest(moves, keys, from, count) {
  let bestIndex = from;
  let bestKey = keys[from];
  for (let index = from + 1; index < count; index += 1) {
    if (keys[index] > bestKey) {
      bestKey = keys[index];
      bestIndex = index;
    }
  }
  if (bestIndex !== from) {
    const move = moves[bestIndex];
    moves[bestIndex] = moves[from];
    moves[from] = move;
    keys[bestIndex] = keys[from];
    keys[from] = bestKey;
  }
}

/** Drive a search generator to completion without yielding (tests, tools). */
export function runSearchSync(generator) {
  for (;;) {
    const step = generator.next();
    if (step.done) return step.value;
  }
}

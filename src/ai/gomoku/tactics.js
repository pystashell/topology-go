import { lineWindows } from "../../game/lineRuns.js";
import { RenjuAnalyzer } from "../../game/renju.js";
import { AXES, getTopology } from "../../topology/index.js";

/**
 * Exact, topology-aware Gomoku tactics for the AI: immediate wins, the
 * opponent's immediate wins, a budgeted VCF (victory by continuous fours)
 * search and a cheap heuristic move. Lines come from the shared topology
 * module (lineWindows), so every pattern crosses cylinder, torus and Mobius
 * seams exactly as the game engine's do; nothing here assumes a flat board.
 *
 * Win conditions follow GomokuEngine: five or more wins, except Black under
 * Renju, who wins only with exactly five. Black's Renju forbidden points come
 * from RenjuAnalyzer (src/game/renju.js) on the hypothetical board.
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
const WALL = 3;

const RADIUS = 5;
const SPAN = 2 * RADIUS + 1;
const CENTER = RADIUS;
const AXIS_COUNT = AXES.length;
const REACH = 4;

// Heuristic weights by the number of own stones already in a five-cell
// segment through the candidate point.
const SEGMENT_WEIGHTS = [1, 8, 40, 300, 8000];
const DEFENCE_FACTOR = 0.9;

export class VcfBudgetExceeded extends Error {
  constructor() {
    super("VCF search budget exhausted");
    this.name = "VcfBudgetExceeded";
  }
}

export function colorValue(color) {
  if (color === "black") return BLACK;
  if (color === "white") return WHITE;
  return EMPTY;
}

export function opponentOf(color) {
  return color === BLACK ? WHITE : BLACK;
}

/**
 * A mutable cell array for tactical reading. place/remove keep a version
 * counter so Renju analysis is rebuilt only when the position changed.
 */
export class TacticalBoard {
  #analyzer = null;
  #analyzerVersion = -1;
  #version = 0;
  #line = new Int8Array(SPAN);

  /**
   * @param {object} options
   * @param {'cylinder'|'torus'|'mobius'} options.topology
   * @param {number} options.width
   * @param {number} options.height
   * @param {'freestyle'|'renju'} [options.ruleSet]
   * @param {Array<Array<'black'|'white'|null>>} options.board
   */
  constructor({ topology, width, height, ruleSet = "freestyle", board }) {
    this.topology = getTopology(topology, width, height);
    this.width = width;
    this.height = height;
    this.renju = ruleSet === "renju";
    this.cells = new Int8Array(width * height);
    board.forEach((row, rowIndex) => {
      row.forEach((stone, col) => {
        this.cells[rowIndex * width + col] = colorValue(stone);
      });
    });
    this.windows = lineWindows(this.topology, RADIUS);
  }

  get pointCount() {
    return this.cells.length;
  }

  place(index, color) {
    this.cells[index] = color;
    this.#version += 1;
  }

  remove(index) {
    this.cells[index] = EMPTY;
    this.#version += 1;
  }

  /** Whether a run of this length wins for the colour. */
  winsWith(color, length) {
    return this.renju && color === BLACK ? length === 5 : length >= 5;
  }

  #readLine(index, axis) {
    const line = this.#line;
    const base = (index * AXIS_COUNT + axis) * SPAN;
    for (let offset = 0; offset < SPAN; offset += 1) {
      const cell = this.windows[base + offset];
      line[offset] = cell < 0 ? WALL : this.cells[cell];
    }
    return line;
  }

  /** Length of the run of `color` through the window centre (counting it). */
  #runThroughCentre(line, color, include = -1) {
    let low = CENTER;
    while (low > 0 && (line[low - 1] === color || low - 1 === include)) low -= 1;
    let high = CENTER;
    while (high < SPAN - 1 && (line[high + 1] === color || high + 1 === include)) high += 1;
    return { low, high };
  }

  /** Whether `color` playing at the empty cell wins at once. */
  winsAt(index, color) {
    if (this.cells[index] !== EMPTY) return false;
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const line = this.#readLine(index, axis);
      line[CENTER] = color;
      const { low, high } = this.#runThroughCentre(line, color);
      if (this.winsWith(color, high - low + 1)) return true;
    }
    return false;
  }

  /** Empty cells within four steps (along an axis) of a stone of `color`. */
  #cellsNear(color, reach = REACH) {
    const seen = new Uint8Array(this.cells.length);
    const result = [];
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      if (this.cells[cell] !== color) continue;
      for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
        const base = (cell * AXIS_COUNT + axis) * SPAN + CENTER;
        for (let offset = -reach; offset <= reach; offset += 1) {
          const other = this.windows[base + offset];
          if (other >= 0 && this.cells[other] === EMPTY && seen[other] === 0) {
            seen[other] = 1;
            result.push(other);
          }
        }
      }
    }
    return result;
  }

  /** Every empty cell where `color` would win immediately, ascending. */
  winningPoints(color) {
    return this.#cellsNear(color)
      .filter((index) => this.winsAt(index, color))
      .sort((a, b) => a - b);
  }

  /**
   * With a stone of `color` standing at `index`, the empty cells on the
   * lines through it that would now complete a win for `color`.
   */
  fivePointsThrough(index, color) {
    const points = [];
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const line = this.#readLine(index, axis);
      const base = (index * AXIS_COUNT + axis) * SPAN;
      for (let offset = CENTER - REACH; offset <= CENTER + REACH; offset += 1) {
        if (offset === CENTER || line[offset] !== EMPTY) continue;
        const { low, high } = this.#runThroughCentre(line, color, offset);
        if (offset < low || offset > high) continue;
        if (!this.winsWith(color, high - low + 1)) continue;
        const cell = this.windows[base + offset];
        if (!points.includes(cell)) points.push(cell);
      }
    }
    return points;
  }

  #board2d() {
    const rows = [];
    for (let row = 0; row < this.height; row += 1) {
      const stones = [];
      for (let col = 0; col < this.width; col += 1) {
        const value = this.cells[row * this.width + col];
        stones.push(value === BLACK ? "black" : value === WHITE ? "white" : null);
      }
      rows.push(stones);
    }
    return rows;
  }

  /** Renju reason Black may not play the empty cell now, or null. */
  forbiddenFor(index) {
    if (!this.renju || this.cells[index] !== EMPTY) return null;
    if (this.#analyzerVersion !== this.#version) {
      this.#analyzer = new RenjuAnalyzer(this.topology, this.#board2d());
      this.#analyzerVersion = this.#version;
    }
    const row = Math.floor(index / this.width);
    return this.#analyzer.reasonAt(row, index - row * this.width);
  }

  /** Whether `color` may play the cell (empty, not Renju-forbidden for Black). */
  isLegal(index, color) {
    if (this.cells[index] !== EMPTY) return false;
    return !(this.renju && color === BLACK && this.forbiddenFor(index) !== null);
  }

  /**
   * Moves that make a four for `color`: playing them leaves at least one
   * empty winning point. Each entry lists those points.
   *
   * @returns {Array<{index: number, fives: number[]}>}
   */
  fourMoves(color) {
    // A four needs three more stones of the colour on one line within four
    // steps, so cells with fewer than three such stones on all lines
    // together cannot qualify (a cheap, exact pre-filter).
    const counts = new Uint8Array(this.cells.length);
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      if (this.cells[cell] !== color) continue;
      for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
        const base = (cell * AXIS_COUNT + axis) * SPAN + CENTER;
        for (let offset = -REACH; offset <= REACH; offset += 1) {
          const other = this.windows[base + offset];
          if (other >= 0 && this.cells[other] === EMPTY && counts[other] < 255) counts[other] += 1;
        }
      }
    }
    const moves = [];
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      if (counts[cell] < 3) continue;
      this.cells[cell] = color;
      const fives = this.fivePointsThrough(cell, color);
      this.cells[cell] = EMPTY;
      if (fives.length > 0) moves.push({ index: cell, fives });
    }
    return moves;
  }

  /**
   * Static value of playing the empty cell for `color`: five-cell segments
   * through it, counting own potential and what it takes from the opponent.
   */
  scoreMove(index, color) {
    const opponent = opponentOf(color);
    let attack = 0;
    let defence = 0;
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const line = this.#readLine(index, axis);
      for (let start = CENTER - REACH; start <= CENTER; start += 1) {
        let own = 0;
        let other = 0;
        let blocked = false;
        for (let offset = start; offset < start + 5; offset += 1) {
          const value = offset === CENTER ? EMPTY : line[offset];
          if (value === WALL) {
            blocked = true;
            break;
          }
          if (value === color) own += 1;
          else if (value === opponent) other += 1;
        }
        if (blocked) continue;
        if (other === 0) attack += SEGMENT_WEIGHTS[own];
        if (own === 0) defence += SEGMENT_WEIGHTS[other];
      }
    }
    return attack + DEFENCE_FACTOR * defence;
  }
}

/**
 * Search for a VCF: a sequence of fours by `attacker`, each forcing the
 * single reply, ending in a five the defender cannot stop. Respects the
 * defender's own fours (the attacker must block them with a four or fail),
 * Renju forbidden points for a Black attacker, and wins outright when a
 * Black defender's only block is forbidden. The board is restored.
 *
 * @param {TacticalBoard} board
 * @param {number} attacker BLACK or WHITE.
 * @param {object} [options]
 * @param {number} [options.maxNodes=3000]
 * @param {number} [options.maxDepth=12] Attacker fours per line.
 * @param {number} [options.deadline=Infinity] performance.now() limit.
 * @returns {{line: number[]|null, nodes: number, exhausted: boolean}}
 *   `line` alternates attacker and defender cells, starting with the move to
 *   play and ending with the attacker's winning four (or five).
 */
export function findVcf(board, attacker, { maxNodes = 3000, maxDepth = 12, deadline = Infinity } = {}) {
  const defender = opponentOf(attacker);
  let nodes = 0;

  function search(depth, defenderThreats) {
    nodes += 1;
    if (nodes > maxNodes || ((nodes & 31) === 0 && performance.now() > deadline)) {
      throw new VcfBudgetExceeded();
    }
    const threats = defenderThreats.filter((cell) => board.winsAt(cell, defender));
    if (threats.length >= 2 || depth >= maxDepth) return null;

    let moves = board.fourMoves(attacker);
    if (threats.length === 1) moves = moves.filter((move) => move.index === threats[0]);
    // Legality is judged on this node's position, before any trial move.
    moves = moves.filter((move) => board.isLegal(move.index, attacker));
    // Double fours (or open fours) first: they win on the spot.
    moves.sort((a, b) => b.fives.length - a.fives.length);
    for (const move of moves) {
      board.place(move.index, attacker);
      try {
        if (move.fives.length >= 2) return [move.index];
        const reply = move.fives[0];
        // A Black defender whose only block is forbidden has lost.
        if (!board.isLegal(reply, defender)) return [move.index];
        board.place(reply, defender);
        try {
          const nextThreats = [...threats.filter((cell) => cell !== move.index),
            ...board.fivePointsThrough(reply, defender)];
          const rest = search(depth + 1, nextThreats);
          if (rest) return [move.index, reply, ...rest];
        } finally {
          board.remove(reply);
        }
      } finally {
        board.remove(move.index);
      }
    }
    return null;
  }

  // An immediate five is the trivial VCF.
  const fives = board.winningPoints(attacker);
  if (fives.length > 0) return { line: [fives[0]], nodes: 1, exhausted: false };
  try {
    const line = search(0, board.winningPoints(defender));
    return { line, nodes, exhausted: false };
  } catch (error) {
    if (error instanceof VcfBudgetExceeded) return { line: null, nodes, exhausted: true };
    throw error;
  }
}

/**
 * The empty cells worth considering: within two king steps of a stone (all
 * cells near the centre on an empty board).
 */
export function nearbyCells(board, distance = 2) {
  const { topology, cells } = board;
  const marked = new Uint8Array(cells.length);
  let frontier = [];
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== EMPTY) frontier.push(cell);
  }
  if (frontier.length === 0) {
    const centre = topology.index(Math.floor(board.height / 2), Math.floor(board.width / 2));
    return [centre];
  }
  for (let step = 0; step < distance; step += 1) {
    const next = [];
    for (const cell of frontier) {
      const row = Math.floor(cell / board.width);
      for (const point of topology.neighbors8(row, cell - row * board.width)) {
        const index = point.row * board.width + point.col;
        if (marked[index] === 0) {
          marked[index] = 1;
          next.push(index);
        }
      }
    }
    frontier = next;
  }
  const result = [];
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (marked[cell] === 1 && cells[cell] === EMPTY) result.push(cell);
  }
  return result;
}

/**
 * Nearby empty cells ordered by scoreMove for `color` (best first).
 *
 * @returns {Array<{index: number, score: number}>}
 */
export function rankMoves(board, color, distance = 2) {
  return nearbyCells(board, distance)
    .map((index) => ({ index, score: board.scoreMove(index, color) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

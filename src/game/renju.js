import { AXES } from "../topology/index.js";
import { FORBIDDEN_REASONS } from "./gameTypes.js";
import { lineWindows } from "./lineRuns.js";

/**
 * Renju forbidden points for Black (RIF rules, without an opening rule), on
 * any board topology.
 *
 * Each query hypothetically places a black stone at P and reads an 11-cell
 * window (P±5) on each of the four axes, built from the topology module so
 * windows cross seams exactly as stones do. Boards are at least 11 lines a
 * side, so a window never overlaps itself and covers every cell a pattern
 * through P can depend on. A window that reaches its own edge from P already
 * holds a run of six, so a closed line (whose cells beyond P+5 wrap to P-5)
 * needs no special case: a full cycle of black is an overline.
 *
 *   five       the run through P is exactly 5            -> legal, beats all
 *   overline   the run through P is 6 or longer          -> "overline"
 *   four       an empty E within P±4 that turns the run through P and E
 *              into exactly 5; fours are counted by their distinct stone
 *              sets (run minus E), so _XXXX_ is one four while X_XXX_X,
 *              XX_XX_XX and XXX_X_XXX are two on one line
 *              2+ fours over all axes                    -> "double_four"
 *   three      (axes without a four) an empty E within P±3 that makes a
 *              straight four through P and E -- a run of exactly 4 with both
 *              ends empty, each completing exactly 5 -- where E is itself
 *              not forbidden once P is on the board (RIF 9.3, recursively)
 *              2+ threes over all axes                   -> "double_three"
 *
 * The three test is lazy: it only recurses when at least two axes have a
 * straight-four point, stops as soon as the verdict is known, and memoizes
 * every (hypothetical board, point) pair for the lifetime of one analyzer.
 * Recursion terminates because each level adds a black stone.
 */

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const WALL = 3;

const RADIUS = 5;
const SPAN = 2 * RADIUS + 1;
const CENTER = RADIUS;
const AXIS_COUNT = AXES.length;

function cellValue(stone) {
  if (stone === "black") return BLACK;
  if (stone === "white") return WHITE;
  if (stone === null) return EMPTY;
  throw new TypeError(`Invalid board value: ${stone}`);
}

/** Bounds of the black run through the window centre. */
function runBounds(line) {
  let low = CENTER;
  while (low > 0 && line[low - 1] === BLACK) low -= 1;
  let high = CENTER;
  while (high < SPAN - 1 && line[high + 1] === BLACK) high += 1;
  return [low, high];
}

function runLength(line) {
  const [low, high] = runBounds(line);
  return high - low + 1;
}

/**
 * Number of distinct fours the centre stone takes part in on one window.
 * Expects line[CENTER] === BLACK and no five or overline through it.
 */
function countFours(line) {
  let first = -1;
  let count = 0;
  for (let offset = CENTER - 4; offset <= CENTER + 4; offset += 1) {
    if (line[offset] !== EMPTY) continue;
    line[offset] = BLACK;
    const [low, high] = runBounds(line);
    line[offset] = EMPTY;
    if (high - low + 1 !== 5 || offset < low || offset > high) continue;
    // The four is the run's stones without the completing point.
    let key = 0;
    for (let index = low; index <= high; index += 1) {
      if (index !== offset) key |= 1 << index;
    }
    if (key === first) continue;
    if (first === -1) first = key;
    count += 1;
    // A window holds at most two distinct fours through its centre.
    if (count === 2) break;
  }
  return count;
}

/**
 * Window offsets E (within P±3) where a black stone would make a straight
 * four through the centre and E. Expects no four on this window.
 */
function straightFourOffsets(line) {
  const offsets = [];
  for (let offset = CENTER - 3; offset <= CENTER + 3; offset += 1) {
    if (line[offset] !== EMPTY) continue;
    line[offset] = BLACK;
    const [low, high] = runBounds(line);
    line[offset] = EMPTY;
    if (
      high - low + 1 === 4 &&
      offset >= low &&
      offset <= high &&
      line[low - 1] === EMPTY &&
      line[high + 1] === EMPTY &&
      // Filling either end must make exactly five, not an overline.
      line[low - 2] !== BLACK &&
      line[high + 2] !== BLACK
    ) {
      offsets.push(offset);
    }
  }
  return offsets;
}

/**
 * A reusable Renju analysis of one board position. Queries share a memo, so
 * scanning many points of the same position (forbiddenPoints) reuses every
 * nested verdict.
 */
export class RenjuAnalyzer {
  #width;
  #pointCount;
  #cells;
  #windows;
  #memo = new Map();
  #placed = [];
  #line = new Int8Array(SPAN);

  /**
   * @param {import("../topology/index.js").Topology} topology
   * @param {Array<Array<'black'|'white'|null>>} board
   */
  constructor(topology, board) {
    this.#width = topology.width;
    this.#pointCount = topology.pointCount;
    if (!Array.isArray(board) || board.length !== topology.height) {
      throw new RangeError(`Board must contain ${topology.height} rows`);
    }
    const cells = new Int8Array(topology.pointCount);
    board.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== topology.width) {
        throw new RangeError(`Board row ${rowIndex} must contain ${topology.width} points`);
      }
      row.forEach((stone, col) => {
        cells[rowIndex * topology.width + col] = cellValue(stone);
      });
    });
    this.#cells = cells;
    this.#windows = lineWindows(topology, RADIUS);
  }

  /**
   * Why Black may not play at a point, or null when the move is legal (or
   * the point is occupied, which is not a Renju question).
   *
   * @returns {null|'overline'|'double_four'|'double_three'}
   */
  reasonAt(row, col) {
    const index = row * this.#width + col;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      col < 0 ||
      col >= this.#width ||
      index < 0 ||
      index >= this.#pointCount
    ) {
      throw new RangeError("Point is not on the board");
    }
    if (this.#cells[index] !== EMPTY) return null;
    return this.#verdict(index);
  }

  /**
   * Every empty point forbidden for Black, row-major. Only empties within
   * four steps of a black stone along an axis can be forbidden.
   *
   * @returns {Array<{row: number, col: number, reason: string}>}
   */
  forbiddenPoints() {
    const cells = this.#cells;
    const windows = this.#windows;
    const candidates = new Uint8Array(this.#pointCount);
    for (let cell = 0; cell < this.#pointCount; cell += 1) {
      if (cells[cell] !== BLACK) continue;
      for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
        const base = (cell * AXIS_COUNT + axis) * SPAN;
        for (let offset = CENTER - 4; offset <= CENTER + 4; offset += 1) {
          const other = windows[base + offset];
          if (other >= 0 && cells[other] === EMPTY) candidates[other] = 1;
        }
      }
    }
    const points = [];
    for (let cell = 0; cell < this.#pointCount; cell += 1) {
      if (candidates[cell] === 0) continue;
      const reason = this.#verdict(cell);
      if (reason !== null) {
        const row = Math.floor(cell / this.#width);
        points.push({ row, col: cell - row * this.#width, reason });
      }
    }
    return points;
  }

  /** Whether Black has at least one empty, non-forbidden point. */
  hasLegalPoint() {
    for (let cell = 0; cell < this.#pointCount; cell += 1) {
      if (this.#cells[cell] === EMPTY && this.#verdict(cell) === null) return true;
    }
    return false;
  }

  #memoKey(cell) {
    if (this.#placed.length === 0) return cell;
    return `${[...this.#placed].sort((a, b) => a - b).join(",")}|${cell}`;
  }

  #readWindow(cell, axis) {
    const line = this.#line;
    const base = (cell * AXIS_COUNT + axis) * SPAN;
    for (let offset = 0; offset < SPAN; offset += 1) {
      const index = this.#windows[base + offset];
      line[offset] = index < 0 ? WALL : this.#cells[index];
    }
    return line;
  }

  /** Verdict for a black stone at an empty cell of the current board. */
  #verdict(cell) {
    const key = this.#memoKey(cell);
    const known = this.#memo.get(key);
    if (known !== undefined) return known;
    this.#cells[cell] = BLACK;
    this.#placed.push(cell);
    let verdict;
    try {
      verdict = this.#classify(cell);
    } finally {
      this.#placed.pop();
      this.#cells[cell] = EMPTY;
    }
    this.#memo.set(key, verdict);
    return verdict;
  }

  /** Classify the black stone now standing at `cell`. */
  #classify(cell) {
    // Five beats everything; then overline; then fours; then threes.
    let overline = false;
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const length = runLength(this.#readWindow(cell, axis));
      if (length === 5) return null;
      if (length > 5) overline = true;
    }
    if (overline) return FORBIDDEN_REASONS.OVERLINE;

    let fours = 0;
    /** @type {Array<number[]>} straight-four cells per axis without a four */
    const threeCandidates = [];
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const line = this.#readWindow(cell, axis);
      const axisFours = countFours(line);
      if (axisFours > 0) {
        fours += axisFours;
        if (fours >= 2) return FORBIDDEN_REASONS.DOUBLE_FOUR;
        continue;
      }
      const offsets = straightFourOffsets(line);
      if (offsets.length > 0) {
        const base = (cell * AXIS_COUNT + axis) * SPAN;
        threeCandidates.push(offsets.map((offset) => this.#windows[base + offset]));
      }
    }
    if (threeCandidates.length < 2) return null;

    // A three is real when one of its straight-four points is not itself
    // forbidden with this stone on the board.
    let threes = 0;
    for (let index = 0; index < threeCandidates.length; index += 1) {
      if (threes + (threeCandidates.length - index) < 2) break;
      if (threeCandidates[index].some((point) => this.#verdict(point) === null)) {
        threes += 1;
        if (threes >= 2) return FORBIDDEN_REASONS.DOUBLE_THREE;
      }
    }
    return null;
  }
}

/**
 * Why Black may not play at (row, col), or null when it is legal.
 *
 * @param {import("../topology/index.js").Topology} topology
 * @param {Array<Array<'black'|'white'|null>>} board
 * @returns {null|'overline'|'double_four'|'double_three'}
 */
export function forbiddenReason(topology, board, row, col) {
  return new RenjuAnalyzer(topology, board).reasonAt(row, col);
}

/**
 * Every empty point forbidden for Black, row-major, with its reason.
 *
 * @returns {Array<{row: number, col: number, reason: string}>}
 */
export function forbiddenPoints(topology, board) {
  return new RenjuAnalyzer(topology, board).forbiddenPoints();
}

import { AXES } from "../topology/index.js";
import { FORBIDDEN_REASONS } from "./gameTypes.js";
import { lineWindows } from "./lineRuns.js";

/**
 * Renju forbidden points for Black (RIF rules, without an opening rule), on
 * any board topology.
 *
 * Each query hypothetically places a black stone at P and reads an 11-cell
 * window (P±5) on each of the four axes, built from the topology module so
 * windows cross seams exactly as stones do. A line through P is either open
 * (it ends at board edges, or is a closed loop of 11 or more cells, which a
 * window covers without overlapping itself) or a short loop: a closed line
 * of at most 10 cells (a row of a narrow cylinder, a column of a short torus,
 * a diagonal of a small torus), whose cells a window would meet twice. Open
 * lines are read from the window; short loops are read as a ring of their
 * cells, with the same definitions taken around the ring (a whole ring of
 * black is a run as long as the ring, so a ring of exactly five is a five).
 * So the rules hold on every board size.
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
// Closed lines of at most this many cells close inside a window.
const SHORT_LOOP = 2 * RADIUS;

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

const shortLoopCache = new WeakMap();

/**
 * Short loops of a topology: entry (cell * AXIS_COUNT + axis) * SHORT_LOOP
 * starts the cells of the closed line through `cell` along that axis, in the
 * axis' direction from `cell` itself, when the line closes within
 * SHORT_LOOP cells; lengths[cell * AXIS_COUNT + axis] is its length, or 0
 * for an open line. A line closes when walking it returns to the start
 * travelling the original way; any other repeated cell (a Mobius diagonal
 * folding back) ends it like an edge, as in lineRuns.js.
 */
function shortLoops(topology) {
  const cached = shortLoopCache.get(topology);
  if (cached) return cached;
  const { width, pointCount } = topology;
  const lengths = new Uint8Array(pointCount * AXIS_COUNT);
  const cells = new Int32Array(pointCount * AXIS_COUNT * SHORT_LOOP).fill(-1);
  for (let cell = 0; cell < pointCount; cell += 1) {
    const row = Math.floor(cell / width);
    const col = cell - row * width;
    AXES.forEach(([dRow, dCol], axis) => {
      const key = cell * AXIS_COUNT + axis;
      const loop = [cell];
      let at = { row, col, dRow, dCol };
      for (let step = 1; step <= SHORT_LOOP; step += 1) {
        const next = topology.step(at.row, at.col, at.dRow, at.dCol);
        if (next === null) return;
        const index = next.row * width + next.col;
        if (index === cell) {
          if (next.dRow === dRow && next.dCol === dCol) {
            lengths[key] = loop.length;
            loop.forEach((value, offset) => { cells[key * SHORT_LOOP + offset] = value; });
          }
          return;
        }
        if (loop.includes(index)) return;
        loop.push(index);
        at = next;
      }
    });
  }
  const table = { lengths, cells };
  shortLoopCache.set(topology, table);
  return table;
}

/**
 * The black run through ring position `at`: its first position and length,
 * the whole ring when every cell is black.
 */
function ringRun(ring, at) {
  const length = ring.length;
  let behind = 0;
  while (behind < length - 1 && ring[(at - behind - 1 + length) % length] === BLACK) behind += 1;
  if (behind === length - 1) return { start: 0, length, full: true };
  let ahead = 0;
  while (ring[(at + ahead + 1) % length] === BLACK) ahead += 1;
  return { start: (at - behind + length) % length, length: behind + ahead + 1, full: false };
}

function ringRunHolds(run, position, length) {
  return run.full || (position - run.start + length) % length < run.length;
}

/** countFours on a ring whose position 0 holds the stone. */
function countRingFours(ring) {
  const length = ring.length;
  let first = -1;
  let count = 0;
  for (let position = 1; position < length; position += 1) {
    if (ring[position] !== EMPTY) continue;
    ring[position] = BLACK;
    const run = ringRun(ring, 0);
    ring[position] = EMPTY;
    if (run.length !== 5 || !ringRunHolds(run, position, length)) continue;
    let key = 0;
    for (let offset = 0; offset < run.length; offset += 1) {
      const index = (run.start + offset) % length;
      if (index !== position) key |= 1 << index;
    }
    if (key === first) continue;
    if (first === -1) first = key;
    count += 1;
    if (count === 2) break;
  }
  return count;
}

/** straightFourOffsets on a ring whose position 0 holds the stone. */
function ringStraightFourPositions(ring) {
  const length = ring.length;
  const positions = [];
  for (let position = 1; position < length; position += 1) {
    if (ring[position] !== EMPTY) continue;
    ring[position] = BLACK;
    const run = ringRun(ring, 0);
    if (!run.full && run.length === 4 && ringRunHolds(run, position, length)) {
      const before = (run.start - 1 + length) % length;
      const after = (run.start + 4) % length;
      // Both ends open and distinct, each completing exactly five.
      if (before !== after && ring[before] === EMPTY && ring[after] === EMPTY) {
        ring[before] = BLACK;
        const throughBefore = ringRun(ring, 0).length;
        ring[before] = EMPTY;
        ring[after] = BLACK;
        const throughAfter = ringRun(ring, 0).length;
        ring[after] = EMPTY;
        if (throughBefore === 5 && throughAfter === 5) positions.push(position);
      }
    }
    ring[position] = EMPTY;
  }
  return positions;
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
  #loops;

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
    this.#loops = shortLoops(topology);
  }

  /** The short loop through a cell along an axis as a ring of values, or null. */
  #readRing(cell, axis) {
    const key = cell * AXIS_COUNT + axis;
    const length = this.#loops.lengths[key];
    if (length === 0) return null;
    const ring = new Int8Array(length);
    for (let offset = 0; offset < length; offset += 1) {
      ring[offset] = this.#cells[this.#loops.cells[key * SHORT_LOOP + offset]];
    }
    return ring;
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
    const rings = [];
    let overline = false;
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      rings[axis] = this.#readRing(cell, axis);
      const length = rings[axis]
        ? ringRun(rings[axis], 0).length
        : runLength(this.#readWindow(cell, axis));
      if (length === 5) return null;
      if (length > 5) overline = true;
    }
    if (overline) return FORBIDDEN_REASONS.OVERLINE;

    let fours = 0;
    /** @type {Array<number[]>} straight-four cells per axis without a four */
    const threeCandidates = [];
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      const ring = rings[axis];
      const line = ring ? null : this.#readWindow(cell, axis);
      const axisFours = ring ? countRingFours(ring) : countFours(line);
      if (axisFours > 0) {
        fours += axisFours;
        if (fours >= 2) return FORBIDDEN_REASONS.DOUBLE_FOUR;
        continue;
      }
      if (ring) {
        const positions = ringStraightFourPositions(ring);
        if (positions.length > 0) {
          const base = (cell * AXIS_COUNT + axis) * SHORT_LOOP;
          threeCandidates.push(positions.map((position) => this.#loops.cells[base + position]));
        }
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

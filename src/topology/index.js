import {
  mobiusCopyIndex,
  mobiusPointFromCover,
  mobiusRowForCopy,
  positiveModulo,
} from "./cover.js";

/**
 * Single source of adjacency and straight lines for every board topology.
 *
 * Boards are rectangular grids of `height` rows by `width` columns.
 * - cylinder: columns wrap (col -1 is col width-1); rows keep their edges.
 * - torus: columns and rows both wrap.
 * - mobius: columns wrap with a half twist; leaving the column range mirrors
 *   the row (row -> height-1-row) and reverses vertical motion, so a "/"
 *   diagonal continues as "\". Rows keep their edges and vertical steps never
 *   cross the seam.
 *
 * The module has no dependencies outside src/topology so engines, views and
 * AI can all use it. Topology objects are memoized and frozen; treat the typed
 * arrays in `neighborIndices4` as read-only.
 */

export { positiveModulo } from "./cover.js";

export const TOPOLOGY_KINDS = Object.freeze(["cylinder", "torus", "mobius"]);

/**
 * The four line axes as [dRow, dCol]: horizontal, vertical, "\" diagonal
 * (down-right) and "/" diagonal (down-left).
 */
export const AXES = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([1, 0]),
  Object.freeze([1, 1]),
  Object.freeze([1, -1]),
]);

/**
 * The eight king-move directions as [dRow, dCol] in neighbors8 order:
 * left, right, up, down, up-left, up-right, down-left, down-right.
 */
export const DIRECTIONS_8 = Object.freeze([
  Object.freeze([0, -1]),
  Object.freeze([0, 1]),
  Object.freeze([-1, 0]),
  Object.freeze([1, 0]),
  Object.freeze([-1, -1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([1, 1]),
]);

/**
 * @typedef {'cylinder'|'torus'|'mobius'} TopologyKind
 * @typedef {{row: number, col: number}} Point
 * @typedef {{row: number, col: number, dRow: number, dCol: number}} DirectedPoint
 *   A cell together with the direction of travel on arrival. On a Mobius
 *   strip dRow flips sign whenever a step crosses the seam.
 * @typedef {{cells: DirectedPoint[], end: 'boundary'|'start'|'limit'}} Ray
 * @typedef {{
 *   cells: DirectedPoint[],
 *   origin: number,
 *   cyclic: boolean,
 *   length: number,
 * }} Line
 *
 * @typedef {object} Topology
 * @property {TopologyKind} kind
 * @property {number} width Column count.
 * @property {number} height Row count.
 * @property {boolean} wrapsRows True on a torus (rows are periodic).
 * @property {boolean} mirrorsAtSeam True on a Mobius strip.
 * @property {number} coverPeriod Cover columns before the board repeats
 *   exactly: 2 * width on a Mobius strip, otherwise width.
 * @property {number} pointCount width * height.
 * @property {(row: number, col: number) => boolean} isOnBoard
 * @property {(row: number, col: number) => number} index Row-major index, or
 *   -1 off the board.
 * @property {(index: number) => Point} point Inverse of index().
 * @property {(row: number, col: number, dRow: number, dCol: number) => DirectedPoint|null} step
 * @property {(row: number, col: number) => Point[]} neighbors4
 * @property {(row: number, col: number) => Point[]} neighbors8
 * @property {{start: Int32Array, list: Int32Array}} neighborIndices4
 *   Compressed neighbors4 table: the neighbours of index i are
 *   list[start[i]] .. list[start[i + 1] - 1], in neighbors4 order.
 * @property {(row: number, col: number, dRow: number, dCol: number, options?: {maxSteps?: number}) => Ray} ray
 * @property {(row: number, col: number, dRow: number, dCol: number, options?: {radius?: number}) => Line} line
 * @property {(row: number, coverColumn: number) => {row: number, col: number, copyIndex: number}} fromCover
 */

// Left, right, up, down: the persisted Go neighbour order.
const ORTHOGONAL = DIRECTIONS_8.slice(0, 4);
const CACHE_LIMIT = 32;
const cache = new Map();

function requireDimension(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

/**
 * Return the shared, frozen topology for a board shape. Results are memoized
 * (the 32 most recently created shapes), so callers may look one up per call.
 *
 * @param {TopologyKind} kind
 * @param {number} width
 * @param {number} [height=width]
 * @returns {Topology}
 */
export function getTopology(kind, width, height = width) {
  if (!TOPOLOGY_KINDS.includes(kind)) {
    throw new TypeError(`Unknown board topology: ${kind}`);
  }
  requireDimension(width, "width");
  requireDimension(height, "height");
  const key = `${kind}:${width}x${height}`;
  let topology = cache.get(key);
  if (topology) return topology;
  topology = createTopology(kind, width, height);
  cache.set(key, topology);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return topology;
}

function directionIndex(dRow, dCol) {
  return DIRECTIONS_8.findIndex(
    ([row, col]) => row === dRow && col === dCol,
  );
}

function createTopology(kind, width, height) {
  const wrapsRows = kind === "torus";
  const mirrorsAtSeam = kind === "mobius";
  const pointCount = width * height;

  function isOnBoard(row, col) {
    return (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      row < height &&
      col >= 0 &&
      col < width
    );
  }

  function index(row, col) {
    return isOnBoard(row, col) ? row * width + col : -1;
  }

  function point(pointIndex) {
    if (
      !Number.isInteger(pointIndex) ||
      pointIndex < 0 ||
      pointIndex >= pointCount
    ) {
      throw new RangeError(`Point index ${pointIndex} is not on the board`);
    }
    return { row: Math.floor(pointIndex / width), col: pointIndex % width };
  }

  /**
   * Move from a board cell by (dRow, dCol). Returns null when the start is
   * off the board, a delta is not an integer, or the move leaves a boundary
   * row. Unit steps are the intended use; larger deltas wrap consistently.
   */
  function step(row, col, dRow, dCol) {
    if (
      !isOnBoard(row, col) ||
      !Number.isInteger(dRow) ||
      !Number.isInteger(dCol)
    ) {
      return null;
    }
    const nextRow = row + dRow;
    const coverColumn = col + dCol;
    // `+ 0` and `0 -` never produce -0, so results compare equal with
    // Object.is (and deepStrictEqual) whatever sign of zero callers pass.
    if (wrapsRows) {
      return {
        row: positiveModulo(nextRow, height),
        col: positiveModulo(coverColumn, width),
        dRow: dRow + 0,
        dCol: dCol + 0,
      };
    }
    if (nextRow < 0 || nextRow >= height) return null;
    const crossesTwist =
      mirrorsAtSeam &&
      (coverColumn < 0 || coverColumn >= width) &&
      positiveModulo(mobiusCopyIndex(coverColumn, width), 2) === 1;
    if (!crossesTwist) {
      return {
        row: nextRow,
        col: positiveModulo(coverColumn, width),
        dRow: dRow + 0,
        dCol: dCol + 0,
      };
    }
    return {
      row: height - 1 - nextRow,
      col: positiveModulo(coverColumn, width),
      dRow: 0 - dRow,
      dCol: dCol + 0,
    };
  }

  function collectNeighbors(row, col, directions) {
    const points = [];
    const seen = new Set([row * width + col]);
    for (const [dRow, dCol] of directions) {
      const next = step(row, col, dRow, dCol);
      if (next === null) continue;
      const nextIndex = next.row * width + next.col;
      if (seen.has(nextIndex)) continue;
      seen.add(nextIndex);
      points.push({ row: next.row, col: next.col });
    }
    return points;
  }

  // Precompute the orthogonal table once; Go group searches query it in hot
  // loops and neighbors4 only has to copy points out of it.
  const start = new Int32Array(pointCount + 1);
  const indexList = [];
  for (let cell = 0; cell < pointCount; cell += 1) {
    start[cell] = indexList.length;
    const row = Math.floor(cell / width);
    for (const neighbour of collectNeighbors(row, cell - row * width, ORTHOGONAL)) {
      indexList.push(neighbour.row * width + neighbour.col);
    }
  }
  start[pointCount] = indexList.length;
  const list = Int32Array.from(indexList);
  const neighborIndices4 = Object.freeze({ start, list });

  /**
   * Orthogonal neighbours as fresh objects, in the order left, right, up,
   * down. A neighbour reachable twice keeps its first position and the cell
   * itself is never included. Off-board input returns [].
   */
  function neighbors4(row, col) {
    if (!isOnBoard(row, col)) return [];
    const cell = row * width + col;
    const points = [];
    for (let offset = start[cell]; offset < start[cell + 1]; offset += 1) {
      const neighbour = list[offset];
      const neighbourRow = Math.floor(neighbour / width);
      points.push({ row: neighbourRow, col: neighbour - neighbourRow * width });
    }
    return points;
  }

  /**
   * neighbors4 followed by the diagonal neighbours up-left, up-right,
   * down-left and down-right, without duplicates or the cell itself.
   */
  function neighbors8(row, col) {
    if (!isOnBoard(row, col)) return [];
    return collectNeighbors(row, col, DIRECTIONS_8);
  }

  /**
   * Walk from a cell (excluded) in one direction. The walk ends at a
   * boundary, just before it would re-enter the start cell from any
   * direction (narrow Mobius strips can fold a diagonal back onto it), or
   * after maxSteps cells. With the default maxSteps every walk ends at a
   * boundary or the start. On a narrow Mobius strip a diagonal may visit
   * another cell twice before it returns; such cells appear twice.
   *
   * @returns {Ray}
   */
  function ray(row, col, dRow, dCol, { maxSteps = 2 * pointCount } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) {
      throw new RangeError("maxSteps must be a non-negative integer");
    }
    const cells = [];
    let current = { row, col, dRow, dCol };
    while (cells.length < maxSteps) {
      const next = step(current.row, current.col, current.dRow, current.dCol);
      if (next === null) return { cells, end: "boundary" };
      if (next.row === row && next.col === col) return { cells, end: "start" };
      cells.push(next);
      current = next;
    }
    return { cells, end: "limit" };
  }

  // Lazily filled per-direction caches of full-line facts for line().
  const lineLengths = DIRECTIONS_8.map(() => null);
  const lineCyclic = DIRECTIONS_8.map(() => null);

  /**
   * Grow a line outwards from the origin one cell per side per round
   * (forward first), so a bounded radius always yields exactly the cells
   * within that distance of the full line. Each side stops at a boundary or
   * at a cell the line already holds, so every cell appears once.
   */
  function growLine(row, col, dRow, dCol, radius) {
    const claimed = new Set([row * width + col]);
    const forward = [];
    const backward = [];
    let ahead = { row, col, dRow, dCol };
    let behind = { row, col, dRow: 0 - dRow, dCol: 0 - dCol };
    let forwardOpen = true;
    let backwardOpen = true;
    for (
      let distance = 1;
      distance <= radius && (forwardOpen || backwardOpen);
      distance += 1
    ) {
      if (forwardOpen) {
        const next = step(ahead.row, ahead.col, ahead.dRow, ahead.dCol);
        if (next === null || claimed.has(next.row * width + next.col)) {
          forwardOpen = false;
        } else {
          claimed.add(next.row * width + next.col);
          forward.push(next);
          ahead = next;
        }
      }
      if (backwardOpen) {
        const next = step(behind.row, behind.col, behind.dRow, behind.dCol);
        if (next === null || claimed.has(next.row * width + next.col)) {
          backwardOpen = false;
        } else {
          claimed.add(next.row * width + next.col);
          backward.push(next);
          behind = next;
        }
      }
    }
    const cells = [
      // Backward cells are reported in the forward direction of travel.
      ...backward.reverse().map((cell) => ({
        row: cell.row,
        col: cell.col,
        dRow: 0 - cell.dRow,
        dCol: 0 - cell.dCol,
      })),
      { row, col, dRow: dRow + 0, dCol: dCol + 0 },
      ...forward,
    ];
    return { cells, origin: backward.length };
  }

  /**
   * Whether the line is a closed loop: walking forward returns to the origin
   * travelling in the original direction. A Mobius diagonal that folds back
   * onto its start arrives mirrored and is therefore not cyclic.
   */
  function closesLoop(row, col, dRow, dCol) {
    let current = { row, col, dRow, dCol };
    for (let count = 0; count < 2 * pointCount; count += 1) {
      current = step(current.row, current.col, current.dRow, current.dCol);
      if (current === null) return false;
      if (current.row === row && current.col === col) {
        return current.dRow === dRow && current.dCol === dCol;
      }
    }
    return false;
  }

  function fullLineFacts(row, col, dRow, dCol) {
    const direction = directionIndex(dRow, dCol);
    const cell = row * width + col;
    if (direction >= 0 && lineLengths[direction]?.[cell] > 0) {
      return {
        cyclic: lineCyclic[direction][cell] === 1,
        length: lineLengths[direction][cell],
      };
    }
    const { cells } = growLine(row, col, dRow, dCol, Infinity);
    const facts = {
      cyclic: closesLoop(row, col, dRow, dCol),
      length: cells.length,
    };
    if (direction >= 0) {
      lineLengths[direction] ??= new Int32Array(pointCount);
      lineCyclic[direction] ??= new Uint8Array(pointCount);
      lineLengths[direction][cell] = facts.length;
      lineCyclic[direction][cell] = facts.cyclic ? 1 : 0;
    }
    return facts;
  }

  /**
   * The straight line through a cell along (dRow, dCol), as distinct cells
   * ordered in that direction of travel. `origin` is the index of the start
   * cell in `cells`; at most `radius` cells are taken on each side.
   * `cyclic` is true when the full line is a closed loop and `length` is the
   * number of cells on the full line (its period when cyclic), whatever the
   * radius. Line lengths: cylinder rows W-cycle, columns and diagonals
   * bounded; torus rows W-cycle, columns H-cycle, diagonals lcm(W,H)-cycle;
   * Mobius rows 2W-cycle (the middle row of an odd height: W-cycle), columns
   * bounded and diagonals bounded, mirrored at the seam.
   *
   * @returns {Line}
   */
  function line(row, col, dRow, dCol, { radius = Infinity } = {}) {
    if (!isOnBoard(row, col)) {
      throw new RangeError("A line must start on the board");
    }
    if (
      !Number.isInteger(dRow) ||
      !Number.isInteger(dCol) ||
      (dRow === 0 && dCol === 0)
    ) {
      throw new RangeError("A line needs a non-zero integer direction");
    }
    if (!(radius === Infinity || (Number.isSafeInteger(radius) && radius >= 0))) {
      throw new RangeError("radius must be a non-negative integer or Infinity");
    }
    const { cells, origin } = growLine(row, col, dRow, dCol, radius);
    return { cells, origin, ...fullLineFacts(row, col, dRow, dCol) };
  }

  /**
   * Map a point in the column cover (any integer column, rows on the board)
   * to its base-board cell and cover copy index. Only Mobius copies mirror
   * rows.
   */
  function fromCover(row, coverColumn) {
    if (mirrorsAtSeam) {
      return mobiusPointFromCover(row, coverColumn, width, height);
    }
    const copyIndex = mobiusCopyIndex(coverColumn, width);
    return {
      // Validates the row exactly as the Mobius mapping does.
      row: mobiusRowForCopy(row, 0, height),
      col: positiveModulo(coverColumn, width),
      copyIndex,
    };
  }

  return Object.freeze({
    kind,
    width,
    height,
    wrapsRows,
    mirrorsAtSeam,
    coverPeriod: mirrorsAtSeam ? 2 * width : width,
    pointCount,
    isOnBoard,
    index,
    point,
    step,
    neighbors4,
    neighbors8,
    neighborIndices4,
    ray,
    line,
    fromCover,
  });
}

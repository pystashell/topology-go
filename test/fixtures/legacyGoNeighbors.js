// Verbatim copy of the pre-topology-module Go adjacency (GoEngine.neighbors
// and src/game/mobiusTopology.js at commit 0ee5d90). The differential test
// compares the shared topology module against it point by point, including
// order. Never edit this file to make a differential test pass.
//
// Only the class wrapper differs: `this.#validPoint` is a plain helper and
// the method is bound to a {width, height, topology} board description.

const TOPOLOGY_TORUS = "torus";
const TOPOLOGY_MOBIUS = "mobius";

function pointKey(row, col) {
  return `${row},${col}`;
}

// ---- src/game/mobiusTopology.js (verbatim) ----
export function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function mobiusCopyIndex(coverColumn, width) {
  if (!Number.isInteger(coverColumn) || !Number.isInteger(width) || width < 1) {
    throw new TypeError("coverColumn and width must be integers with width > 0");
  }
  return Math.floor(coverColumn / width);
}

export function mobiusRowForCopy(row, copyIndex, height) {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(copyIndex) ||
    !Number.isInteger(height) ||
    height < 1 ||
    row < 0 ||
    row >= height
  ) {
    throw new TypeError("row, copyIndex and height do not describe a valid point");
  }
  return positiveModulo(copyIndex, 2) === 1 ? height - 1 - row : row;
}

/** Map one point in the infinite rectangular cover back to the base board. */
export function mobiusPointFromCover(row, coverColumn, width, height = width) {
  const copyIndex = mobiusCopyIndex(coverColumn, width);
  return {
    row: mobiusRowForCopy(row, copyIndex, height),
    col: positiveModulo(coverColumn, width),
    copyIndex,
  };
}

/** Place a canonical board point in a chosen copy of the infinite cover. */
export function mobiusPointInCopy(
  row,
  col,
  copyIndex,
  width,
  height = width,
) {
  if (!Number.isInteger(col) || col < 0 || col >= width) {
    throw new TypeError("col must be inside the base board");
  }
  return {
    row: mobiusRowForCopy(row, copyIndex, height),
    coverColumn: col + copyIndex * width,
    copyIndex,
  };
}

// ---- GoEngine.#validPoint and GoEngine.neighbors (verbatim bodies) ----
function validPoint(board, row, col) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < board.height &&
    col >= 0 &&
    col < board.width
  );
}

class LegacyBoard {
  constructor({ width, height, topology }) {
    this.width = width;
    this.height = height;
    this.topology = topology;
  }

  #validPoint(row, col) {
    return validPoint(this, row, col);
  }

  /**
   * Orthogonal neighbours. Cylinders and tori join columns without changing
   * rows. A Mobius strip joins the column seam after reversing the row. Rows
   * wrap only on a torus; cylinders and Mobius strips retain one boundary.
   *
   * @returns {Point[]}
   */
  neighbors(row, col) {
    if (!this.#validPoint(row, col)) return [];

    const candidates = this.topology === TOPOLOGY_MOBIUS
      ? [col - 1, col + 1].map((coverColumn) => {
          const point = mobiusPointFromCover(
            row,
            coverColumn,
            this.width,
            this.height,
          );
          return { row: point.row, col: point.col };
        })
      : [
          { row, col: (col - 1 + this.width) % this.width },
          { row, col: (col + 1) % this.width },
        ];
    if (this.topology === TOPOLOGY_TORUS) {
      candidates.push(
        { row: (row - 1 + this.height) % this.height, col },
        { row: (row + 1) % this.height, col },
      );
    } else {
      if (row > 0) candidates.push({ row: row - 1, col });
      if (row < this.height - 1) candidates.push({ row: row + 1, col });
    }

    // The minimum board size is three, but keeping this deduplication makes the
    // topology explicit and prevents future small-board variants double-counting.
    const seen = new Set();
    return candidates.filter((point) => {
      const key = pointKey(point.row, point.col);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

/** Legacy orthogonal neighbours for one board description and point. */
export function legacyGoNeighbors({ width, height, topology }, row, col) {
  return new LegacyBoard({ width, height, topology }).neighbors(row, col);
}

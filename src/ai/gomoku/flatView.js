import { getTopology, positiveModulo } from "../../topology/index.js";

/**
 * Flat square views of topology boards for engines that only know a plain
 * N x N board (Rapfi: 5..22, square).
 *
 * A view is a rectangle of the board's unrolled cover: `height` consecutive
 * cover rows by `width` consecutive cover columns, starting at (rowOffset,
 * columnOffset), mapped back to board cells with the topology module
 * (topology.fromCover; torus rows also wrap). Columns wrap on every topology,
 * so the left and right edges of the rectangle are always "cuts" where real
 * lines are severed; on a Mobius strip the part of the rectangle beyond the
 * twist shows its rows mirrored, exactly as the cover does. Rows are cut only
 * on a torus or when the board is taller than the view.
 *
 * Choosing the view (the approximation the engine sees):
 *   - The view is min(W, maxSize) x min(H, maxSize). When it spans a whole
 *     wrapping dimension the only choice is where to cut it; otherwise it is a
 *     window and its position also decides what the engine sees.
 *   - Every candidate offset is scored: +1 per stone inside, +20 for the last
 *     move, minus a penalty for every stone within four cells of a cut edge
 *     (4, 3, 2, 1 by distance; five times heavier for the last move). So cuts
 *     fall in the emptiest columns/rows and windows centre on the action.
 *   - The rectangle sits in the top-left of an N x N engine board with
 *     N = max(width, height) (or a caller-chosen larger N); engine cells
 *     outside it do not exist and must be blocked (YXBLOCK). The engine still
 *     believes those cells are empty space, and it cannot see lines that run
 *     through a cut; exact topology-aware tactics cover that gap.
 */

const LAST_MOVE_BONUS = 20;
const CUT_PENALTY = 0.6;
const LAST_MOVE_CUT_FACTOR = 5;
const CUT_REACH = 4;

function cutPenalty(distance) {
  return Math.max(0, CUT_REACH - distance);
}

/**
 * @typedef {object} FlatView
 * @property {number} size Engine board size N.
 * @property {number} width View columns (<= N).
 * @property {number} height View rows (<= N).
 * @property {number} rowOffset Cover row of the view's top row.
 * @property {number} columnOffset Cover column of the view's left column.
 * @property {Int32Array} toBoard Engine cell (y * N + x) -> board index
 *   (row * W + col), or -1 where the engine cell does not exist.
 * @property {Int32Array} toFlat Board index -> engine cell, or -1 when the
 *   board cell is outside the view.
 */

/**
 * Choose and build the flat view of a position.
 *
 * @param {object} options
 * @param {'cylinder'|'torus'|'mobius'} options.topology
 * @param {number} options.width
 * @param {number} options.height
 * @param {ArrayLike<number>} options.cells Board cells (0 = empty), row-major.
 * @param {number} [options.lastMove=-1] Board index of the last move.
 * @param {number} [options.maxSize=22] Largest engine board side.
 * @param {number} [options.size] Engine board side to use (>= the view).
 * @returns {FlatView}
 */
export function buildFlatView({
  topology: kind,
  width,
  height,
  cells,
  lastMove = -1,
  maxSize = 22,
  size,
}) {
  const topology = getTopology(kind, width, height);
  const viewWidth = Math.min(width, maxSize);
  const viewHeight = Math.min(height, maxSize);
  const engineSize = Math.max(size ?? 0, viewWidth, viewHeight);
  if (engineSize > maxSize) throw new RangeError("Engine board is larger than maxSize");

  // A Mobius view one board width further along is the same view mirrored
  // top to bottom, which only matters when the view does not hold every row.
  const columnOffsets = viewHeight < height ? topology.coverPeriod : width;
  // Inverse column maps per offset: board column -> view column, or -1.
  const viewColumn = new Int32Array(columnOffsets * width).fill(-1);
  for (let offset = 0; offset < columnOffsets; offset += 1) {
    for (let j = 0; j < viewWidth; j += 1) {
      viewColumn[offset * width + topology.fromCover(0, offset + j).col] = j;
    }
  }
  const rowOffsets = topology.wrapsRows ? height : height - viewHeight + 1;
  const rowsCutAbove = (offset) => topology.wrapsRows || offset > 0;
  const rowsCutBelow = (offset) => topology.wrapsRows || offset + viewHeight < height;

  const stones = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== 0) stones.push(index);
  }

  // View row of a board cell for given offsets, or -1 outside the view.
  function viewRow(index, rowOffset, columnOffset, j) {
    const row = Math.floor(index / width);
    // fromCover mirrors rows in odd Mobius copies; mirroring is its own
    // inverse, so it also maps the board row to its cover row.
    const coverRow = topology.fromCover(row, columnOffset + j).row;
    const i = topology.wrapsRows
      ? positiveModulo(coverRow - rowOffset, height)
      : coverRow - rowOffset;
    return i >= 0 && i < viewHeight ? i : -1;
  }

  let best = null;
  for (let rowOffset = 0; rowOffset < rowOffsets; rowOffset += 1) {
    const cutAbove = rowsCutAbove(rowOffset);
    const cutBelow = rowsCutBelow(rowOffset);
    for (let columnOffset = 0; columnOffset < columnOffsets; columnOffset += 1) {
      let score = 0;
      for (const index of stones) {
        const j = viewColumn[columnOffset * width + (index % width)];
        if (j < 0) continue;
        const i = viewRow(index, rowOffset, columnOffset, j);
        if (i < 0) continue;
        let penalty = cutPenalty(j) + cutPenalty(viewWidth - 1 - j);
        if (cutAbove) penalty += cutPenalty(i);
        if (cutBelow) penalty += cutPenalty(viewHeight - 1 - i);
        if (index === lastMove) {
          score += 1 + LAST_MOVE_BONUS - CUT_PENALTY * LAST_MOVE_CUT_FACTOR * penalty;
        } else {
          score += 1 - CUT_PENALTY * penalty;
        }
      }
      // Strictly better only, so ties keep the natural (0, 0) orientation.
      if (best === null || score > best.score + 1e-9) {
        best = { score, rowOffset, columnOffset };
      }
    }
  }

  const toBoard = new Int32Array(engineSize * engineSize).fill(-1);
  const toFlat = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < viewHeight; i += 1) {
    for (let j = 0; j < viewWidth; j += 1) {
      const coverRow = best.rowOffset + i;
      const row = topology.wrapsRows ? positiveModulo(coverRow, height) : coverRow;
      const cell = topology.fromCover(row, best.columnOffset + j);
      const index = topology.index(cell.row, cell.col);
      toBoard[i * engineSize + j] = index;
      toFlat[index] = i * engineSize + j;
    }
  }
  return {
    size: engineSize,
    width: viewWidth,
    height: viewHeight,
    rowOffset: best.rowOffset,
    columnOffset: best.columnOffset,
    toBoard,
    toFlat,
  };
}

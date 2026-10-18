/**
 * Mapping between a board and its infinite rectangular cover.
 *
 * Views draw boards as repeated copies along the column axis. On a Mobius
 * strip every odd copy is mirrored top-to-bottom, so the cover column alone
 * decides which copy (and therefore which row orientation) a point uses.
 * This module is dependency-free so views, engines and AI can all share it.
 */

/** Remainder with the sign of the divisor, e.g. positiveModulo(-1, 5) === 4. */
export function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/** Index of the cover copy containing a cover column (negative to the left). */
export function mobiusCopyIndex(coverColumn, width) {
  if (!Number.isInteger(coverColumn) || !Number.isInteger(width) || width < 1) {
    throw new TypeError("coverColumn and width must be integers with width > 0");
  }
  return Math.floor(coverColumn / width);
}

/** Row a base-board row occupies in a cover copy: odd copies are mirrored. */
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

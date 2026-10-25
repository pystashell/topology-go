import { DIRECTIONS_8, getTopology } from "../topology/index.js";

/**
 * How far each disc an Othello move flipped lies from the new disc, counted
 * in steps along the ray (through seams) that outflanked it. The page turns
 * the discs over in that order: rings of equal distance turn together, in
 * every direction at once.
 *
 * Only the position after the move is needed: the flipped discs are put back
 * to the opponent and the new point emptied, and the rays are then walked
 * exactly as the engine walks them. A disc outflanked along several rays (a
 * torus can reach the same disc twice) keeps its shortest distance. Discs no
 * ray reaches (an inconsistent render-only state) get distance 1.
 *
 * @param {{width: number, height: number, topology: string,
 *   board: Array<Array<string|null>>, move: {row: number, col: number, color: string},
 *   flipped: Array<{row: number, col: number}>}} position
 * @returns {Array<{row: number, col: number, distance: number}>} In the
 *   order of `flipped`.
 */
export function othelloFlipDistances({ width, height, topology, board, move, flipped }) {
  if (!Array.isArray(flipped) || flipped.length === 0) return [];
  const key = (row, col) => row * width + col;
  const flips = new Set(flipped.map(({ row, col }) => key(row, col)));
  const distances = new Map();
  if (move && Array.isArray(board)) {
    const opponent = move.color === "black" ? "white" : "black";
    const before = (row, col) => {
      if (row === move.row && col === move.col) return null;
      return flips.has(key(row, col)) ? opponent : board[row]?.[col] ?? null;
    };
    const grid = getTopology(topology, width, height);
    const maxSteps = 2 * grid.pointCount;
    for (const [dRow, dCol] of DIRECTIONS_8) {
      const run = [];
      let cursor = { row: move.row, col: move.col, dRow, dCol };
      let outflanked = false;
      while (run.length < maxSteps) {
        const next = grid.step(cursor.row, cursor.col, cursor.dRow, cursor.dCol);
        if (next === null || (next.row === move.row && next.col === move.col)) break;
        const value = before(next.row, next.col);
        if (value !== opponent) {
          outflanked = value === move.color && run.length > 0;
          break;
        }
        run.push(key(next.row, next.col));
        cursor = next;
      }
      if (!outflanked) continue;
      run.forEach((cell, index) => {
        if (!flips.has(cell)) return;
        const distance = index + 1;
        if (!distances.has(cell) || distances.get(cell) > distance) distances.set(cell, distance);
      });
    }
  }
  return flipped.map(({ row, col }) => ({
    row,
    col,
    distance: distances.get(key(row, col)) ?? 1,
  }));
}

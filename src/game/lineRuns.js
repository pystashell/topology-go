import { AXES } from "../topology/index.js";

/**
 * Straight-line runs of stones on any board topology, for games that win by
 * making a row (Gomoku, Renju). Every step goes through the shared topology
 * module, so rows wrap across a cylinder or torus seam, columns wrap on a
 * torus, and a Mobius seam mirrors the row (a "/" diagonal continues as "\").
 *
 * A run never counts a cell twice. On a closed line whose every cell holds
 * the colour, the run is the whole cycle.
 */

/**
 * @typedef {{row: number, col: number}} Point
 * @typedef {{
 *   cells: Point[],
 *   length: number,
 *   cyclic: boolean,
 *   axis: readonly [number, number],
 * }} Run
 *   `cells` are ordered in the axis' direction of travel (backward end
 *   first); `cyclic` is true when the run is a complete closed line.
 */

function walk(topology, board, row, col, dRow, dCol, color, seen, start) {
  const cells = [];
  let current = { row, col, dRow, dCol };
  for (;;) {
    const next = topology.step(current.row, current.col, current.dRow, current.dCol);
    if (next === null) return { cells, closed: false };
    const index = next.row * topology.width + next.col;
    if (seen.has(index)) {
      // Back at the start travelling the original way: the line is a loop
      // and every cell on it matched. (A Mobius diagonal can fold back onto
      // a cell mirrored; that ends the run without closing it.)
      return {
        cells,
        closed: index === start && next.dRow === dRow && next.dCol === dCol,
      };
    }
    if (board[next.row][next.col] !== color) return { cells, closed: false };
    seen.add(index);
    cells.push({ row: next.row, col: next.col });
    current = next;
  }
}

/**
 * The maximal run of `color` through (row, col) along one axis. The start
 * cell is always included, whatever it holds, so callers can ask about a
 * stone they are about to place.
 *
 * @param {import("../topology/index.js").Topology} topology
 * @param {Array<Array<string|null>>} board Rows of colours (null = empty).
 * @param {number} row
 * @param {number} col
 * @param {readonly [number, number]} axis [dRow, dCol], usually from AXES.
 * @param {string} [color] Defaults to the stone at (row, col).
 * @returns {Run}
 */
export function runThrough(topology, board, row, col, axis, color) {
  if (!topology.isOnBoard(row, col)) {
    throw new RangeError("A run must start on the board");
  }
  if (color === undefined) color = board[row][col];
  const [dRow, dCol] = axis;
  const start = row * topology.width + col;
  const seen = new Set([start]);
  const forward = walk(topology, board, row, col, dRow + 0, dCol + 0, color, seen, start);
  const backward = forward.closed
    ? { cells: [] }
    : walk(topology, board, row, col, 0 - dRow, 0 - dCol, color, seen, start);
  const cells = [...backward.cells.reverse(), { row, col }, ...forward.cells];
  return { cells, length: cells.length, cyclic: forward.closed, axis };
}

/**
 * The runs of `color` through (row, col) on all four axes, in AXES order.
 *
 * @returns {Run[]}
 */
export function runsThrough(topology, board, row, col, color) {
  return AXES.map((axis) => runThrough(topology, board, row, col, axis, color));
}

/**
 * The first run through (row, col), in AXES order, whose length satisfies
 * `wins`, or null.
 *
 * @param {(length: number) => boolean} wins
 * @returns {Run|null}
 */
export function winningRun(topology, board, row, col, color, wins) {
  for (const axis of AXES) {
    const run = runThrough(topology, board, row, col, axis, color);
    if (wins(run.length)) return run;
  }
  return null;
}

const windowCache = new WeakMap();

/**
 * Line windows for every cell and axis, as a flat table of cell indices:
 * entry ((cell * 4 + axis) * span + offset), span = 2 * radius + 1, is the
 * cell `offset - radius` steps along AXES[axis] from `cell`, or -1 where the
 * line has ended (a boundary) or would revisit a cell. The cells match
 * topology.line(row, col, dRow, dCol, {radius}) exactly, centred at offset
 * `radius`; they are built with topology.step so that a table costs only
 * O(cells * radius) even on long torus diagonals. Tables are cached per
 * topology and radius; treat them as read-only.
 *
 * @param {import("../topology/index.js").Topology} topology
 * @param {number} radius
 * @returns {Int32Array}
 */
export function lineWindows(topology, radius) {
  if (!Number.isSafeInteger(radius) || radius < 0) {
    throw new RangeError("radius must be a non-negative integer");
  }
  let byRadius = windowCache.get(topology);
  if (!byRadius) {
    byRadius = new Map();
    windowCache.set(topology, byRadius);
  }
  const cached = byRadius.get(radius);
  if (cached) return cached;

  const { width, pointCount } = topology;
  const span = 2 * radius + 1;
  const table = new Int32Array(pointCount * AXES.length * span).fill(-1);
  for (let cell = 0; cell < pointCount; cell += 1) {
    const row = Math.floor(cell / width);
    const col = cell - row * width;
    AXES.forEach(([dRow, dCol], axis) => {
      const base = (cell * AXES.length + axis) * span + radius;
      table[base] = cell;
      // Grow both sides one cell per round, forward first, stopping a side
      // at a boundary or at a cell the window already holds (as line() does).
      const claimed = [cell];
      let ahead = { row, col, dRow, dCol };
      let behind = { row, col, dRow: 0 - dRow, dCol: 0 - dCol };
      let aheadOpen = true;
      let behindOpen = true;
      for (let distance = 1; distance <= radius && (aheadOpen || behindOpen); distance += 1) {
        if (aheadOpen) {
          const next = topology.step(ahead.row, ahead.col, ahead.dRow, ahead.dCol);
          const index = next === null ? -1 : next.row * width + next.col;
          if (index < 0 || claimed.includes(index)) {
            aheadOpen = false;
          } else {
            claimed.push(index);
            table[base + distance] = index;
            ahead = next;
          }
        }
        if (behindOpen) {
          const next = topology.step(behind.row, behind.col, behind.dRow, behind.dCol);
          const index = next === null ? -1 : next.row * width + next.col;
          if (index < 0 || claimed.includes(index)) {
            behindOpen = false;
          } else {
            claimed.push(index);
            table[base - distance] = index;
            behind = next;
          }
        }
      }
    });
  }
  byRadius.set(radius, table);
  return table;
}

/**
 * An independent, deliberately naive Renju referee used to cross-check
 * src/game/renju.js. It shares no code with the engine: boards are rows of
 * characters ("X" black, "O" white, "." empty), lines are 11-character
 * strings centred on the point ("#" off the board), and every pattern is
 * found by scanning fixed-length segments of those strings. Threes are
 * evaluated eagerly on every axis (no laziness), with the RIF 9.3 recursion
 * on the straight-four points.
 *
 * Lines are read on the board's cover (test/helpers/coverGeometry.js): a
 * cylinder (the default) wraps columns, a torus also wraps rows, and a
 * Mobius strip turns every other copy over. A line that closes on itself
 * within ten cells (small boards) is read as a ring string instead, and the
 * same patterns are found around the ring by scanning the ring written out
 * three times. With `recursive: false` every straight-four point makes a
 * three, which tests use to show that a sample exercises the recursion.
 */

import { coverCell, mod } from "../helpers/coverGeometry.js";

/**
 * The black run through ring position `at` (ring[at] is "X"): its length and
 * the ring positions it covers. A ring that is all "X" is one run as long as
 * the ring.
 */
function ringRun(ring, at) {
  const length = ring.length;
  if (![...ring].some((char) => char !== "X")) {
    return { length, positions: new Set([...ring].map((_, index) => index)) };
  }
  const tripled = ring.repeat(3);
  let left = length + at;
  let right = length + at;
  while (tripled[left - 1] === "X") left -= 1;
  while (tripled[right + 1] === "X") right += 1;
  const positions = new Set();
  for (let index = left; index <= right; index += 1) positions.add(index % length);
  return { length: right - left + 1, positions, left: left % length, right: right % length };
}

function setChar(text, index, char) {
  return text.slice(0, index) + char + text.slice(index + 1);
}

/** Fours through ring position 0, keyed by their stones. */
function ringFourKeys(ring) {
  const keys = new Set();
  for (let index = 1; index < ring.length; index += 1) {
    if (ring[index] !== ".") continue;
    const run = ringRun(setChar(ring, index, "X"), 0);
    if (run.length !== 5 || !run.positions.has(index)) continue;
    keys.add([...run.positions].filter((position) => position !== index).sort((a, b) => a - b).join(","));
  }
  return keys;
}

/** Whether "X" at ring position `index` makes a straight four through position 0. */
function ringStraightFour(ring, index) {
  if (ring[index] !== ".") return false;
  const filled = setChar(ring, index, "X");
  const run = ringRun(filled, 0);
  if (run.length !== 4 || run.length === ring.length || !run.positions.has(index)) return false;
  const before = mod(run.left - 1, ring.length);
  const after = mod(run.right + 1, ring.length);
  if (before === after || filled[before] !== "." || filled[after] !== ".") return false;
  return ringRun(setChar(filled, before, "X"), 0).length === 5 &&
    ringRun(setChar(filled, after, "X"), 0).length === 5;
}

const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
const CENTRE = 5;

function count(segment, char) {
  return [...segment].filter((value) => value === char).length;
}

/** An exact five through the centre: XXXXX with no X on either side. */
function hasExactFive(line) {
  for (let start = CENTRE - 4; start <= CENTRE; start += 1) {
    if (
      line.slice(start, start + 5) === "XXXXX" &&
      line[start - 1] !== "X" &&
      line[start + 5] !== "X"
    ) {
      return true;
    }
  }
  return false;
}

/** Six or more in a row through the centre. */
function hasOverline(line) {
  for (let start = CENTRE - 5; start <= CENTRE; start += 1) {
    if (line.slice(start, start + 6) === "XXXXXX") return true;
  }
  return false;
}

/**
 * The fours through the centre, as the set of their stones' positions: a
 * five-cell segment holding the centre, four X and one ".", that would
 * become an exact five.
 */
function fourKeys(line) {
  const keys = new Set();
  for (let start = CENTRE - 4; start <= CENTRE; start += 1) {
    const segment = line.slice(start, start + 5);
    if (
      count(segment, "X") === 4 &&
      count(segment, ".") === 1 &&
      line[start - 1] !== "X" &&
      line[start + 5] !== "X"
    ) {
      const stones = [];
      for (let index = start; index < start + 5; index += 1) {
        if (line[index] === "X") stones.push(index);
      }
      keys.add(stones.join(","));
    }
  }
  return keys;
}

/** Whether the line holds a straight four ".XXXX." covering the centre and `added`. */
function hasStraightFour(line, added) {
  for (let start = CENTRE - 4; start <= CENTRE - 1; start += 1) {
    const first = start + 1;
    const last = start + 4;
    if (
      line.slice(start, start + 6) === ".XXXX." &&
      first <= CENTRE && CENTRE <= last &&
      first <= added && added <= last &&
      line[start - 1] !== "X" &&
      line[start + 6] !== "X"
    ) {
      return true;
    }
  }
  return false;
}

export function createRenjuReference({ width, height, topology = "cylinder", recursive = true }) {
  const memo = new Map();

  // Cover coordinates: the queried point (row, col) sits in copy 0, so the
  // cell `step` steps along an axis is coverCell(row + step*dRow, col + step*dCol).
  function stepCell(row, col, [dRow, dCol], step) {
    return coverCell(topology, width, height, row + step * dRow, col + step * dCol);
  }

  /**
   * The line through (row, col): a ring (its cells from the point onward)
   * when walking it comes back to the point travelling the same way within
   * ten steps, else an 11-character window whose sides grow one cell per
   * round, forward first, and end at an edge or at a cell already taken.
   */
  function lineAt(board, row, col, axis) {
    const same = (cell) => cell && cell.row === row && cell.col === col;
    const ringCells = [{ row, col }];
    for (let step = 1; step <= 10; step += 1) {
      const cell = stepCell(row, col, axis, step);
      if (!cell) break;
      if (same(cell)) {
        // Back on a turned-over Mobius copy, a slanted line travels the
        // other way: that is a fold, not a loop.
        const turned = topology === "mobius" && mod(Math.floor((col + step * axis[1]) / width), 2) === 1;
        if (!turned || axis[0] === 0) {
          return { ring: ringCells.map((value) => board[value.row][value.col]).join(""), cells: ringCells };
        }
        break;
      }
      if (ringCells.some((value) => value.row === cell.row && value.col === cell.col)) break;
      ringCells.push(cell);
    }
    const chars = Array(11).fill("#");
    const cells = Array(11).fill(null);
    chars[CENTRE] = board[row][col];
    cells[CENTRE] = { row, col };
    const taken = new Set([`${row},${col}`]);
    const open = { 1: true, [-1]: true };
    for (let distance = 1; distance <= CENTRE; distance += 1) {
      for (const sign of [1, -1]) {
        if (!open[sign]) continue;
        const cell = stepCell(row, col, axis, sign * distance);
        if (!cell || taken.has(`${cell.row},${cell.col}`)) {
          open[sign] = false;
          continue;
        }
        taken.add(`${cell.row},${cell.col}`);
        chars[CENTRE + sign * distance] = board[cell.row][cell.col];
        cells[CENTRE + sign * distance] = cell;
      }
    }
    return { line: chars.join(""), cells };
  }

  function withStone(board, row, col) {
    return board.map((cells, index) =>
      index === row ? cells.slice(0, col) + "X" + cells.slice(col + 1) : cells,
    );
  }

  /**
   * @param {string[]} board Rows of "X", "O" and ".".
   * @returns {null|'overline'|'double_four'|'double_three'}
   */
  function verdict(board, row, col) {
    if (board[row][col] !== ".") return null;
    const key = `${board.join("/")}@${row},${col}`;
    if (memo.has(key)) return memo.get(key);
    const after = withStone(board, row, col);
    const lines = AXES.map((axis) => lineAt(after, row, col, axis));
    const runLength = (entry) => entry.ring !== undefined
      ? ringRun(entry.ring, 0).length
      : null;

    let answer = null;
    if (lines.some((entry) => (entry.ring !== undefined ? runLength(entry) === 5 : hasExactFive(entry.line)))) {
      answer = null;
    } else if (lines.some((entry) => (entry.ring !== undefined ? runLength(entry) > 5 : hasOverline(entry.line)))) {
      answer = "overline";
    } else {
      const fours = lines.map((entry) => (entry.ring !== undefined ? ringFourKeys(entry.ring) : fourKeys(entry.line)).size);
      if (fours.reduce((sum, value) => sum + value, 0) >= 2) {
        answer = "double_four";
      } else {
        let threes = 0;
        lines.forEach((entry, axisIndex) => {
          if (fours[axisIndex] > 0) return;
          let real = false;
          const size = entry.ring !== undefined ? entry.ring.length : entry.line.length;
          for (let index = 0; index < size && !real; index += 1) {
            const makes = entry.ring !== undefined
              ? ringStraightFour(entry.ring, index)
              : entry.line[index] === "." && hasStraightFour(setChar(entry.line, index, "X"), index);
            if (!makes) continue;
            const point = entry.cells[index];
            if (!recursive || verdict(after, point.row, point.col) === null) real = true;
          }
          if (real) threes += 1;
        });
        answer = threes >= 2 ? "double_three" : null;
      }
    }
    memo.set(key, answer);
    return answer;
  }

  return { verdict, clear: () => memo.clear() };
}

/** Engine board (rows of "black"/"white"/null) to reference rows. */
export function toReferenceBoard(board) {
  return board.map((row) =>
    row.map((stone) => (stone === "black" ? "X" : stone === "white" ? "O" : ".")).join(""),
  );
}

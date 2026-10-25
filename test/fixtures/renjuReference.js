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
 * Mobius strip turns every other copy over. With `recursive: false` every
 * straight-four point makes a three, which tests use to show that a sample
 * exercises the recursion.
 */

import { coverCell } from "../helpers/coverGeometry.js";

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

  // (row, col) are cover coordinates: the queried point sits in copy 0.
  function at(board, row, col) {
    const cell = coverCell(topology, width, height, row, col);
    return cell ? board[cell.row][cell.col] : "#";
  }

  function cellAt(row, col) {
    return coverCell(topology, width, height, row, col);
  }

  function lineAt(board, row, col, [dRow, dCol]) {
    let line = "";
    for (let offset = -CENTRE; offset <= CENTRE; offset += 1) {
      line += at(board, row + offset * dRow, col + offset * dCol);
    }
    return line;
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

    let answer = null;
    if (lines.some(hasExactFive)) {
      answer = null;
    } else if (lines.some(hasOverline)) {
      answer = "overline";
    } else {
      const fours = lines.map((line) => fourKeys(line).size);
      if (fours.reduce((sum, value) => sum + value, 0) >= 2) {
        answer = "double_four";
      } else {
        let threes = 0;
        AXES.forEach((axis, axisIndex) => {
          if (fours[axisIndex] > 0) return;
          const line = lines[axisIndex];
          let real = false;
          for (let index = 0; index < line.length && !real; index += 1) {
            if (line[index] !== ".") continue;
            const filled = line.slice(0, index) + "X" + line.slice(index + 1);
            if (!hasStraightFour(filled, index)) continue;
            const offset = index - CENTRE;
            const point = cellAt(row + offset * axis[0], col + offset * axis[1]);
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

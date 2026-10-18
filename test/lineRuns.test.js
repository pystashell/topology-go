import assert from "node:assert/strict";
import test from "node:test";

import { lineWindows, runThrough, runsThrough, winningRun } from "../src/game/lineRuns.js";
import { AXES, getTopology } from "../src/topology/index.js";

function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function place(board, color, points) {
  for (const [row, col] of points) board[row][col] = color;
  return board;
}

const cells = (run) => run.cells.map(({ row, col }) => [row, col]);

test("line windows match topology.line(radius 5) on every shape", () => {
  const shapes = [
    ["cylinder", 11, 11], ["cylinder", 15, 12], ["torus", 11, 11], ["torus", 12, 17],
    ["mobius", 11, 11], ["mobius", 11, 14], ["mobius", 13, 12],
    // Narrow strips fold diagonals back onto themselves; windows still agree.
    ["mobius", 4, 13], ["torus", 3, 5], ["cylinder", 2, 9],
  ];
  for (const [kind, width, height] of shapes) {
    const topology = getTopology(kind, width, height);
    const table = lineWindows(topology, 5);
    assert.equal(table, lineWindows(topology, 5), "tables are cached");
    assert.equal(table.length, width * height * 4 * 11);
    for (let cell = 0; cell < topology.pointCount; cell += 1) {
      const { row, col } = topology.point(cell);
      AXES.forEach(([dRow, dCol], axis) => {
        const line = topology.line(row, col, dRow, dCol, { radius: 5 });
        const expected = Array.from({ length: 11 }, (_, offset) => {
          const point = line.cells[line.origin + offset - 5];
          return point ? topology.index(point.row, point.col) : -1;
        });
        const base = (cell * 4 + axis) * 11;
        assert.deepEqual(
          [...table.slice(base, base + 11)],
          expected,
          `${kind} ${width}x${height} (${row},${col}) axis ${axis}`,
        );
      });
    }
  }
  assert.throws(() => lineWindows(getTopology("torus", 11, 11), -1), RangeError);
});

test("runs are ordered along the axis and cross the cylinder seam", () => {
  const topology = getTopology("cylinder", 15, 15);
  const board = place(emptyBoard(15, 15), "black", [[7, 13], [7, 14], [7, 0], [7, 1], [7, 2]]);
  const run = runThrough(topology, board, 7, 0, AXES[0]);
  assert.deepEqual(cells(run), [[7, 13], [7, 14], [7, 0], [7, 1], [7, 2]]);
  assert.equal(run.length, 5);
  assert.equal(run.cyclic, false);
  // Rows end at the top and bottom of a cylinder.
  place(board, "white", [[0, 3], [1, 3], [2, 3]]);
  assert.deepEqual(cells(runThrough(topology, board, 0, 3, AXES[1])), [[0, 3], [1, 3], [2, 3]]);
  // The start cell counts whatever it holds, so a stone can be tried first.
  assert.equal(runThrough(topology, board, 7, 3, AXES[0], "black").length, 6);
  assert.equal(runThrough(topology, board, 7, 3, AXES[0], "white").length, 1);
  assert.throws(() => runThrough(topology, board, 15, 0, AXES[0]), RangeError);
});

test("torus columns wrap top to bottom", () => {
  const topology = getTopology("torus", 11, 13);
  const board = place(emptyBoard(11, 13), "white", [[11, 4], [12, 4], [0, 4], [1, 4], [2, 4]]);
  assert.deepEqual(
    cells(runThrough(topology, board, 0, 4, AXES[1])),
    [[11, 4], [12, 4], [0, 4], [1, 4], [2, 4]],
  );
  // Diagonals wrap both ways.
  const diagonal = place(emptyBoard(11, 13), "black", [[11, 9], [12, 10], [0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(
    cells(runThrough(topology, diagonal, 0, 0, AXES[2])),
    [[11, 9], [12, 10], [0, 0], [1, 1], [2, 2]],
  );
});

test("a Mobius row continues in the mirrored row and '/' continues as '\\'", () => {
  const topology = getTopology("mobius", 13, 11);
  // Row 2 leaves the seam at col 12 and comes back as row 8 (= 11 - 1 - 2).
  const row = place(emptyBoard(13, 11), "black", [[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]]);
  assert.deepEqual(
    cells(runThrough(topology, row, 8, 0, AXES[0])),
    [[2, 11], [2, 12], [8, 0], [8, 1], [8, 2]],
  );
  // "/" (down-left) from (3, 1): (4, 0), then across the seam to row
  // 11 - 1 - 5 = 5 at col 12, travelling up-left: (5, 12), (4, 11).
  const slash = place(emptyBoard(13, 11), "white", [[2, 2], [3, 1], [4, 0], [5, 12], [4, 11]]);
  assert.deepEqual(
    cells(runThrough(topology, slash, 3, 1, AXES[3])),
    [[2, 2], [3, 1], [4, 0], [5, 12], [4, 11]],
  );
  // Read from the far side, the same cells lie on the "\\" axis.
  assert.equal(runThrough(topology, slash, 4, 11, AXES[3]).length, 1);
  assert.deepEqual(
    cells(runThrough(topology, slash, 4, 11, AXES[2])),
    [[4, 11], [5, 12], [4, 0], [3, 1], [2, 2]],
  );
});

test("closed lines count every cell once and a full cycle is one run", () => {
  const torus = getTopology("torus", 11, 11);
  const full = emptyBoard(11, 11);
  for (let col = 0; col < 11; col += 1) full[10][col] = "black";
  const run = runThrough(torus, full, 10, 4, AXES[0]);
  assert.equal(run.length, 11);
  assert.equal(run.cyclic, true);
  assert.deepEqual(cells(run), Array.from({ length: 11 }, (_, index) => [10, (4 + index) % 11]));

  // A Mobius row is a 2W cycle through two mirrored rows...
  const mobius = getTopology("mobius", 11, 12);
  const twoRows = emptyBoard(11, 12);
  for (let col = 0; col < 11; col += 1) {
    twoRows[0][col] = "white";
    twoRows[11][col] = "white";
  }
  const long = runThrough(mobius, twoRows, 0, 0, AXES[0]);
  assert.equal(long.length, 22);
  assert.equal(long.cyclic, true);
  assert.equal(new Set(long.cells.map(({ row, col }) => `${row},${col}`)).size, 22);
  // ...and the middle row of an odd height is its own W cycle.
  const odd = getTopology("mobius", 11, 13);
  const middle = emptyBoard(11, 13);
  for (let col = 0; col < 11; col += 1) middle[6][col] = "black";
  assert.deepEqual([runThrough(odd, middle, 6, 3, AXES[0]).length, runThrough(odd, middle, 6, 3, AXES[0]).cyclic], [11, true]);

  // A narrow Mobius diagonal folds back onto its own cells: the run stops
  // instead of counting a cell twice, and it is not a cycle.
  const narrow = getTopology("mobius", 4, 13);
  const filled = Array.from({ length: 13 }, () => Array(4).fill("black"));
  for (let cell = 0; cell < narrow.pointCount; cell += 1) {
    const { row, col } = narrow.point(cell);
    for (const folded of runsThrough(narrow, filled, row, col)) {
      const keys = folded.cells.map((point) => `${point.row},${point.col}`);
      assert.equal(new Set(keys).size, keys.length);
      assert.equal(folded.length, keys.length);
    }
  }
});

test("winningRun returns the first qualifying axis", () => {
  const topology = getTopology("cylinder", 15, 15);
  const board = place(emptyBoard(15, 15), "black", [
    [7, 3], [7, 4], [7, 5], [7, 6], [7, 7],
    [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [8, 7],
  ]);
  assert.deepEqual(winningRun(topology, board, 7, 7, "black", (n) => n >= 5).axis, [0, 1]);
  const exact = winningRun(topology, board, 7, 7, "black", (n) => n === 5);
  assert.deepEqual(cells(exact), [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
  assert.equal(winningRun(topology, board, 7, 7, "black", (n) => n === 7).length, 7);
  assert.equal(winningRun(topology, board, 7, 7, "black", (n) => n > 7), null);
});

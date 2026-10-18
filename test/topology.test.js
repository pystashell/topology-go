import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  AXES,
  DIRECTIONS_8,
  TOPOLOGY_KINDS,
  getTopology,
} from "../src/topology/index.js";
import { mobiusPointFromCover } from "../src/topology/cover.js";

const KINDS = ["cylinder", "torus", "mobius"];
// Squares, rectangles both ways, odd and even heights, and narrow strips.
const SHAPES = [
  [3, 3], [4, 4], [5, 5], [9, 9], [8, 5], [5, 8], [4, 13], [7, 6], [6, 7],
  [19, 19], [30, 11], [11, 30],
];

function key({ row, col }) {
  return `${row},${col}`;
}

function gcd(left, right) {
  return right === 0 ? left : gcd(right, left % right);
}

function forEachCell(topology, callback) {
  for (let row = 0; row < topology.height; row += 1) {
    for (let col = 0; col < topology.width; col += 1) callback(row, col);
  }
}

test("topologies are memoized, frozen and validated", () => {
  assert.deepEqual(TOPOLOGY_KINDS, KINDS);
  const torus = getTopology("torus", 9, 7);
  assert.equal(getTopology("torus", 9, 7), torus);
  assert.equal(getTopology("torus", 9), getTopology("torus", 9, 9));
  assert.notEqual(getTopology("torus", 7, 9), torus);
  assert.ok(Object.isFrozen(torus));
  assert.ok(Object.isFrozen(torus.neighborIndices4));
  assert.deepEqual(
    {
      kind: torus.kind,
      width: torus.width,
      height: torus.height,
      wrapsRows: torus.wrapsRows,
      mirrorsAtSeam: torus.mirrorsAtSeam,
      coverPeriod: torus.coverPeriod,
      pointCount: torus.pointCount,
    },
    {
      kind: "torus",
      width: 9,
      height: 7,
      wrapsRows: true,
      mirrorsAtSeam: false,
      coverPeriod: 9,
      pointCount: 63,
    },
  );
  const mobius = getTopology("mobius", 9, 7);
  assert.equal(mobius.mirrorsAtSeam, true);
  assert.equal(mobius.wrapsRows, false);
  assert.equal(mobius.coverPeriod, 18);
  assert.equal(getTopology("cylinder", 9, 7).coverPeriod, 9);

  assert.throws(() => getTopology("sphere", 9, 9), /Unknown board topology/u);
  for (const bad of [0, -1, 2.5, "9", Number.NaN]) {
    assert.throws(() => getTopology("torus", bad, 9), RangeError);
    assert.throws(() => getTopology("torus", 9, bad), RangeError);
  }
});

test("the memo keeps the 32 most recent shapes", () => {
  const first = getTopology("cylinder", 101, 3);
  for (let width = 102; width < 102 + 32; width += 1) getTopology("cylinder", width, 3);
  assert.notEqual(getTopology("cylinder", 101, 3), first);
  assert.deepEqual(getTopology("cylinder", 101, 3).neighbors4(1, 0), first.neighbors4(1, 0));
});

test("axes and directions are frozen [dRow, dCol] pairs", () => {
  assert.deepEqual(AXES, [[0, 1], [1, 0], [1, 1], [1, -1]]);
  assert.deepEqual(DIRECTIONS_8, [
    [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1],
  ]);
  assert.ok(Object.isFrozen(AXES) && AXES.every(Object.isFrozen));
  assert.ok(Object.isFrozen(DIRECTIONS_8) && DIRECTIONS_8.every(Object.isFrozen));
});

test("index, point and isOnBoard agree", () => {
  const topology = getTopology("mobius", 8, 5);
  forEachCell(topology, (row, col) => {
    const index = topology.index(row, col);
    assert.equal(index, row * 8 + col);
    assert.deepEqual(topology.point(index), { row, col });
    assert.equal(topology.isOnBoard(row, col), true);
  });
  for (const [row, col] of [[-1, 0], [5, 0], [0, -1], [0, 8], [0.5, 0], ["1", 0], [null, 0]]) {
    assert.equal(topology.isOnBoard(row, col), false);
    assert.equal(topology.index(row, col), -1);
  }
  for (const bad of [-1, 40, 1.5, "1"]) {
    assert.throws(() => topology.point(bad), RangeError);
  }
});

test("step follows each topology's seams", () => {
  const cylinder = getTopology("cylinder", 5, 4);
  assert.deepEqual(cylinder.step(1, 0, 0, -1), { row: 1, col: 4, dRow: 0, dCol: -1 });
  assert.deepEqual(cylinder.step(1, 4, 1, 1), { row: 2, col: 0, dRow: 1, dCol: 1 });
  assert.equal(cylinder.step(0, 2, -1, 0), null);
  assert.equal(cylinder.step(3, 4, 1, 1), null);

  const torus = getTopology("torus", 5, 4);
  assert.deepEqual(torus.step(0, 0, -1, -1), { row: 3, col: 4, dRow: -1, dCol: -1 });
  assert.deepEqual(torus.step(3, 2, 1, 0), { row: 0, col: 2, dRow: 1, dCol: 0 });

  const mobius = getTopology("mobius", 5, 4);
  // Crossing the seam mirrors the row; a "\" diagonal continues as "/".
  assert.deepEqual(mobius.step(1, 4, 0, 1), { row: 2, col: 0, dRow: 0, dCol: 1 });
  assert.deepEqual(mobius.step(1, 0, 0, -1), { row: 2, col: 4, dRow: 0, dCol: -1 });
  assert.deepEqual(mobius.step(1, 4, 1, 1), { row: 1, col: 0, dRow: -1, dCol: 1 });
  assert.deepEqual(mobius.step(2, 0, -1, -1), { row: 2, col: 4, dRow: 1, dCol: -1 });
  // Vertical steps never cross the seam and stop at the boundary rows.
  assert.equal(mobius.step(0, 4, -1, 0), null);
  assert.equal(mobius.step(3, 0, 1, -1), null);
  // Off-board starts and non-integer deltas have no step.
  assert.equal(mobius.step(4, 0, -1, 0), null);
  assert.equal(mobius.step(1, 1, 0.5, 0), null);
});

test("step is invertible on every topology, shape, cell and direction", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [...SHAPES, [2, 2], [1, 3], [3, 1]]) {
      const topology = getTopology(kind, width, height);
      forEachCell(topology, (row, col) => {
        for (const [dRow, dCol] of DIRECTIONS_8) {
          const next = topology.step(row, col, dRow, dCol);
          if (next === null) continue;
          assert.ok(topology.isOnBoard(next.row, next.col));
          assert.equal(Math.abs(next.dRow), Math.abs(dRow));
          assert.equal(next.dCol, dCol);
          assert.deepEqual(
            topology.step(next.row, next.col, -next.dRow, -next.dCol),
            { row, col, dRow: -dRow + 0, dCol: -dCol + 0 },
            `${kind} ${width}x${height} (${row},${col}) by (${dRow},${dCol})`,
          );
        }
      });
    }
  }
});

test("neighbours are symmetric, distinct, exclude the cell and match the index table", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [...SHAPES, [2, 2], [1, 1], [1, 4], [4, 1], [2, 5]]) {
      const topology = getTopology(kind, width, height);
      const { start, list } = topology.neighborIndices4;
      assert.equal(start.length, topology.pointCount + 1);
      forEachCell(topology, (row, col) => {
        const four = topology.neighbors4(row, col);
        const eight = topology.neighbors8(row, col);
        const label = `${kind} ${width}x${height} (${row},${col})`;
        for (const points of [four, eight]) {
          assert.equal(new Set(points.map(key)).size, points.length, label);
          assert.ok(!points.some((point) => point.row === row && point.col === col), label);
          assert.ok(points.every((point) => topology.isOnBoard(point.row, point.col)), label);
        }
        assert.deepEqual(eight.slice(0, four.length), four, label);
        for (const point of four) {
          assert.ok(topology.neighbors4(point.row, point.col).some(
            (back) => back.row === row && back.col === col,
          ), `${label} -> ${key(point)}`);
        }
        for (const point of eight) {
          assert.ok(topology.neighbors8(point.row, point.col).some(
            (back) => back.row === row && back.col === col,
          ), `${label} -> ${key(point)} (8)`);
        }
        const index = topology.index(row, col);
        assert.deepEqual(
          [...list.subarray(start[index], start[index + 1])],
          four.map((point) => topology.index(point.row, point.col)),
          label,
        );
      });
    }
  }
});

test("neighbours have the expected counts and fresh objects", () => {
  const counts = (kind, width, height) => {
    const topology = getTopology(kind, width, height);
    const result = new Map();
    forEachCell(topology, (row, col) => {
      const count = `${topology.neighbors4(row, col).length}/${topology.neighbors8(row, col).length}`;
      result.set(count, (result.get(count) ?? 0) + 1);
    });
    return Object.fromEntries([...result].sort());
  };
  // Edge rows lose their outward neighbours; interiors keep all eight.
  assert.deepEqual(counts("cylinder", 6, 5), { "3/5": 12, "4/8": 18 });
  assert.deepEqual(counts("mobius", 6, 5), { "3/5": 12, "4/8": 18 });
  assert.deepEqual(counts("torus", 6, 5), { "4/8": 30 });

  const topology = getTopology("torus", 5, 5);
  const first = topology.neighbors4(2, 2);
  first[0].row = 99;
  assert.notEqual(topology.neighbors4(2, 2)[0].row, 99);
  assert.deepEqual(topology.neighbors4(5, 0), []);
  assert.deepEqual(topology.neighbors8(-1, 0), []);
});

test("neighbors8 removes duplicate cells on tiny wrapped boards", () => {
  assert.deepEqual(getTopology("torus", 2, 2).neighbors4(0, 0), [
    { row: 0, col: 1 }, { row: 1, col: 0 },
  ]);
  assert.deepEqual(getTopology("torus", 2, 2).neighbors8(0, 0), [
    { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 },
  ]);
  assert.deepEqual(getTopology("cylinder", 1, 3).neighbors8(1, 0), [
    { row: 0, col: 0 }, { row: 2, col: 0 },
  ]);
  // On a 2-wide Mobius strip the twisted left and plain right neighbours
  // differ, but down-left (mirrored) and down-right meet at one cell.
  assert.deepEqual(getTopology("mobius", 2, 3).neighbors8(0, 0), [
    { row: 2, col: 1 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 },
  ]);
  assert.deepEqual(getTopology("mobius", 2, 3).step(0, 0, 1, -1), {
    row: 1, col: 1, dRow: -1, dCol: -1,
  });
});

test("line lengths and cycles match the topology table", () => {
  const expected = {
    cylinder: (width, height) => [
      { cyclic: true, length: width },
      { cyclic: false, length: height },
      { cyclic: false, length: height },
      { cyclic: false, length: height },
    ],
    torus: (width, height) => [
      { cyclic: true, length: width },
      { cyclic: true, length: height },
      { cyclic: true, length: (width * height) / gcd(width, height) },
      { cyclic: true, length: (width * height) / gcd(width, height) },
    ],
    // A Mobius diagonal can only fold back onto itself when an odd multiple
    // of the width fits inside the height, so the table holds for every
    // strip at least as wide as it is tall (narrow strips are tested below).
    mobius: (width, height, row) => [
      { cyclic: true, length: 2 * row + 1 === height ? width : 2 * width },
      { cyclic: false, length: height },
      { cyclic: false, length: height },
      { cyclic: false, length: height },
    ],
  };
  for (const kind of KINDS) {
    for (const [width, height] of SHAPES) {
      if (kind === "mobius" && width < height) continue;
      const topology = getTopology(kind, width, height);
      forEachCell(topology, (row, col) => {
        AXES.forEach(([dRow, dCol], axis) => {
          const label = `${kind} ${width}x${height} (${row},${col}) axis ${axis}`;
          const want = expected[kind](width, height, row)[axis];
          for (const sign of [1, -1]) {
            const line = topology.line(row, col, sign * dRow + 0, sign * dCol);
            assert.deepEqual({ cyclic: line.cyclic, length: line.length }, want, label);
            assert.equal(line.cells.length, want.length, label);
            assert.equal(new Set(line.cells.map(key)).size, want.length, label);
            const ray = topology.ray(row, col, sign * dRow + 0, sign * dCol);
            if (want.cyclic) {
              assert.deepEqual(
                { end: ray.end, count: ray.cells.length },
                { end: "start", count: want.length - 1 },
                label,
              );
            } else {
              assert.equal(ray.end, "boundary", label);
            }
          }
        });
      });
    }
  }
});

test("a Mobius row visits both mirrored rows before closing", () => {
  const line = getTopology("mobius", 5, 4).line(1, 2, 0, 1);
  assert.equal(line.cyclic, true);
  assert.equal(line.length, 10);
  assert.deepEqual(new Set(line.cells.map(({ row }) => row)), new Set([1, 2]));
  const middle = getTopology("mobius", 5, 5).line(2, 2, 0, 1);
  assert.deepEqual({ cyclic: middle.cyclic, length: middle.length }, { cyclic: true, length: 5 });
});

test("a ray excludes its start and stops at boundaries", () => {
  const cylinder = getTopology("cylinder", 6, 4);
  assert.deepEqual(cylinder.ray(1, 1, 1, 1), {
    cells: [
      { row: 2, col: 2, dRow: 1, dCol: 1 },
      { row: 3, col: 3, dRow: 1, dCol: 1 },
    ],
    end: "boundary",
  });
  assert.deepEqual(cylinder.ray(0, 0, -1, 0), { cells: [], end: "boundary" });
  const row = cylinder.ray(2, 4, 0, 1);
  assert.equal(row.end, "start");
  assert.deepEqual(row.cells.map(({ col }) => col), [5, 0, 1, 2, 3]);
  assert.deepEqual(cylinder.ray(2, 4, 0, 1, { maxSteps: 2 }), {
    cells: row.cells.slice(0, 2),
    end: "limit",
  });
  assert.deepEqual(cylinder.ray(4, 0, 0, 1), { cells: [], end: "boundary" });
  assert.throws(() => cylinder.ray(0, 0, 0, 1, { maxSteps: -1 }), RangeError);
});

test("a narrow Mobius diagonal returns to its start and stops before it", () => {
  const topology = getTopology("mobius", 4, 13);
  // (4,0) -> (5,1) -> (6,2) -> (7,3) -> across the seam onto (4,0) going up.
  assert.deepEqual(topology.step(7, 3, 1, 1), { row: 4, col: 0, dRow: -1, dCol: 1 });
  assert.deepEqual(topology.ray(4, 0, 1, 1), {
    cells: [
      { row: 5, col: 1, dRow: 1, dCol: 1 },
      { row: 6, col: 2, dRow: 1, dCol: 1 },
      { row: 7, col: 3, dRow: 1, dCol: 1 },
    ],
    end: "start",
  });
  // Folding back mirrored is not a closed loop, and the line holds each cell once.
  const line = topology.line(4, 0, 1, 1);
  assert.equal(line.cyclic, false);
  assert.equal(line.cells[line.origin].row, 4);
  assert.equal(new Set(line.cells.map(key)).size, line.cells.length);
  assert.equal(line.length, line.cells.length);
  // From the top edge the folded diagonal crosses (8,0) twice, mirrored the
  // second time, before it returns to its start.
  const folded = topology.ray(0, 0, 1, 1);
  assert.equal(folded.end, "start");
  assert.deepEqual(
    folded.cells.map(({ row, col }) => `${row},${col}`),
    ["1,1", "2,2", "3,3", "8,0", "7,1", "6,2", "5,3", "8,0", "9,1", "10,2", "11,3"],
  );
  assert.deepEqual(
    [folded.cells[3].dRow, folded.cells[7].dRow],
    [-1, 1],
  );
  // The same diagonal from a wide strip simply reaches the boundary.
  assert.equal(getTopology("mobius", 13, 13).ray(4, 0, 1, 1).end, "boundary");
});

test("default ray limits always end at a boundary or the start", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [[4, 13], [3, 12], [6, 30], [5, 5], [2, 7]]) {
      const topology = getTopology(kind, width, height);
      forEachCell(topology, (row, col) => {
        for (const [dRow, dCol] of DIRECTIONS_8) {
          const { cells, end } = topology.ray(row, col, dRow, dCol);
          assert.notEqual(end, "limit");
          assert.ok(!cells.some((cell) => cell.row === row && cell.col === col));
        }
      });
    }
  }
});

test("a bounded radius returns the centred window of the full line", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [[11, 11], [5, 3], [4, 13], [3, 12], [12, 30], [8, 6]]) {
      const topology = getTopology(kind, width, height);
      forEachCell(topology, (row, col) => {
        for (const [dRow, dCol] of DIRECTIONS_8) {
          const full = topology.line(row, col, dRow, dCol);
          assert.equal(full.length, full.cells.length);
          assert.deepEqual(full.cells[full.origin], { row, col, dRow, dCol });
          for (const radius of [0, 1, 2, 5]) {
            const window = topology.line(row, col, dRow, dCol, { radius });
            const from = Math.max(0, full.origin - radius);
            assert.deepEqual(
              window.cells,
              full.cells.slice(from, full.origin + radius + 1),
              `${kind} ${width}x${height} (${row},${col}) (${dRow},${dCol}) r=${radius}`,
            );
            assert.equal(window.origin, full.origin - from);
            assert.equal(window.cyclic, full.cyclic);
            assert.equal(window.length, full.length);
          }
        }
      });
    }
  }
});

test("line cells carry the direction of travel, including across the twist", () => {
  const line = getTopology("mobius", 5, 5).line(1, 3, 1, 1, { radius: 2 });
  assert.equal(line.origin, 1);
  assert.equal(line.cyclic, false);
  assert.deepEqual(line.cells, [
    { row: 0, col: 2, dRow: 1, dCol: 1 },
    { row: 1, col: 3, dRow: 1, dCol: 1 },
    { row: 2, col: 4, dRow: 1, dCol: 1 },
    // "\" continues as "/" after crossing the seam into the mirrored row.
    { row: 1, col: 0, dRow: -1, dCol: 1 },
  ]);
});

test("a cyclic window shorter than its radius lists every cell once", () => {
  const line = getTopology("torus", 5, 7).line(3, 1, 0, 1, { radius: 5 });
  assert.equal(line.cyclic, true);
  assert.equal(line.length, 5);
  assert.deepEqual(line.cells.map(({ col }) => col), [4, 0, 1, 2, 3]);
  assert.equal(line.origin, 2);
  assert.throws(() => getTopology("torus", 5, 7).line(7, 0, 0, 1), RangeError);
  assert.throws(() => getTopology("torus", 5, 7).line(0, 0, 0, 0), RangeError);
  assert.throws(() => getTopology("torus", 5, 7).line(0, 0, 0, 1, { radius: -1 }), RangeError);
});

test("fromCover maps cover columns to cells and copies", () => {
  for (const kind of KINDS) {
    const topology = getTopology(kind, 5, 4);
    for (let row = 0; row < 4; row += 1) {
      for (let coverColumn = -15; coverColumn <= 15; coverColumn += 1) {
        const point = topology.fromCover(row, coverColumn);
        if (kind === "mobius") {
          assert.deepEqual(point, mobiusPointFromCover(row, coverColumn, 5, 4));
        } else {
          assert.deepEqual(point, {
            row,
            col: ((coverColumn % 5) + 5) % 5,
            copyIndex: Math.floor(coverColumn / 5),
          });
        }
      }
    }
    assert.throws(() => topology.fromCover(4, 0), TypeError);
    assert.throws(() => topology.fromCover(0, 0.5), TypeError);
  }
});

test("the topology module stays dependency-free", () => {
  const directory = new URL("../src/topology/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(new URL(file, directory), "utf8");
    const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    for (const specifier of specifiers) {
      assert.match(specifier, /^\.\/[\w-]+\.js$/u, `${file} imports ${specifier}`);
    }
  }
});

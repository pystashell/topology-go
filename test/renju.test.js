import assert from "node:assert/strict";
import test from "node:test";

import { RenjuAnalyzer, forbiddenPoints, forbiddenReason } from "../src/game/renju.js";
import { getTopology } from "../src/topology/index.js";
import { createRenjuReference, toReferenceBoard } from "./fixtures/renjuReference.js";

/** A board with the given stones; points are [row, col]. */
function position({ width = 15, height = 15, topology = "cylinder", black = [], white = [] }) {
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [row, col] of black) {
    assert.equal(board[row][col], null, `duplicate stone at ${row},${col}`);
    board[row][col] = "black";
  }
  for (const [row, col] of white) {
    assert.equal(board[row][col], null, `duplicate stone at ${row},${col}`);
    board[row][col] = "white";
  }
  return { topology: getTopology(topology, width, height), board };
}

function verdict(spec) {
  const { topology, board } = position(spec);
  return forbiddenReason(topology, board, ...spec.at);
}

/** The plan's cases on a 15x15 cylinder around the centre (7,7). */
const CASES = {
  R1: { black: [[7, 5], [7, 6], [5, 7], [6, 7]], at: [7, 7], expected: "double_three" },
  R2: {
    black: [[7, 5], [7, 6], [5, 7], [6, 7]], white: [[7, 8]], at: [7, 7], expected: null,
  },
  R3: { black: [[7, 4], [7, 6], [5, 7], [6, 7]], at: [7, 7], expected: "double_three" },
  R4: {
    black: [[7, 4], [7, 5], [7, 6], [4, 7], [5, 7], [6, 7]],
    white: [[7, 3], [3, 7]],
    at: [7, 7],
    expected: "double_four",
  },
  // B_BPB_B: two fours on one line.
  R5: { black: [[7, 3], [7, 5], [7, 7], [7, 9]], at: [7, 6], expected: "double_four" },
  // BB_PB_BB
  R6: { black: [[7, 3], [7, 4], [7, 7], [7, 9], [7, 10]], at: [7, 6], expected: "double_four" },
  R7: { black: [[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]], at: [7, 5], expected: "overline" },
};

/**
 * R11: P = (7,7) makes a horizontal three (7,5),(7,6) and a diagonal three
 * (5,5),(6,6). The horizontal three's only straight-four points are (7,4)
 * and (7,8); the decorations make each of them a double-three for Black once
 * P is down, so the horizontal three is not a three and P is legal.
 */
const R11_BASE = { black: [[7, 5], [7, 6], [5, 5], [6, 6]], at: [7, 7] };
const R11_DECORATIONS = [
  // (7,4): vertical three with (5,4),(6,4) and "/" three with (8,3),(9,2).
  [5, 4], [6, 4], [8, 3], [9, 2],
  // (7,8): vertical three with (5,8),(6,8) and "/" three with (6,9),(5,10).
  [5, 8], [6, 8], [6, 9], [5, 10],
];
const R11 = { ...R11_BASE, black: [...R11_BASE.black, ...R11_DECORATIONS], expected: null };

test("R1-R7: double three, split three, double four, same-line fours, overline", () => {
  for (const [name, spec] of Object.entries(CASES)) {
    assert.equal(verdict(spec), spec.expected, name);
  }
});

test("the brute-force reference agrees on the hand-built cylinder cases", () => {
  const reference = createRenjuReference({ width: 15, height: 15 });
  for (const [name, spec] of [...Object.entries(CASES), ["R11", R11], ["R11 base", { ...R11_BASE, expected: "double_three" }]]) {
    const { board } = position(spec);
    assert.equal(reference.verdict(toReferenceBoard(board), ...spec.at), spec.expected, name);
  }
});

test("R11: a three whose straight-four points are all forbidden is not a three", () => {
  assert.equal(verdict({ ...R11_BASE }), "double_three");
  assert.equal(verdict(R11), null);
  // Each straight-four point of the horizontal three is itself a double
  // three (with a four) once P stands, while the diagonal three stays real.
  const { topology, board } = position(R11);
  board[7][7] = "black";
  assert.equal(forbiddenReason(topology, board, 7, 4), "double_three");
  assert.equal(forbiddenReason(topology, board, 7, 8), "double_three");
  assert.equal(forbiddenReason(topology, board, 4, 4), null);
  // Removing one decoration revives that straight-four point.
  const revived = { ...R11, black: R11.black.filter(([row, col]) => !(row === 9 && col === 2)) };
  assert.equal(verdict(revived), "double_three");
});

test("a three whose straight-four points are overlines elsewhere is not a three", () => {
  const base = { black: [[7, 5], [7, 6], [5, 7], [6, 7]], at: [7, 7] };
  assert.equal(verdict(base), "double_three");
  // (7,4) and (7,8) would each make six in a column.
  const columns = [4, 8].flatMap((col) => [[4, col], [5, col], [6, col], [8, col], [9, col]]);
  assert.equal(verdict({ ...base, black: [...base.black, ...columns] }), null);
});

test("edge cases: fours bounded by overlines, four-three-three, walls", () => {
  // _XXXP_X: (7,2) completes an exact five, (7,7) only an overline, so the
  // line holds one four; with a second four in the column it is a double four.
  const oneFour = { black: [[7, 3], [7, 4], [7, 5], [7, 8]], at: [7, 6] };
  assert.equal(verdict(oneFour), null);
  assert.equal(
    verdict({ ...oneFour, black: [...oneFour.black, [4, 6], [5, 6], [6, 6]], white: [[3, 6]] }),
    "double_four",
  );
  // XX_XPX: the only completion makes seven, so this is no four at all and
  // a real four elsewhere stays a single four.
  assert.equal(
    verdict({
      black: [[7, 2], [7, 3], [7, 5], [7, 7], [4, 6], [5, 6], [6, 6]],
      white: [[3, 6]],
      at: [7, 6],
    }),
    null,
  );
  // Four-three is legal; four-three-three is a double three.
  const fourThree = {
    black: [[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]], white: [[7, 3]], at: [7, 7],
  };
  assert.equal(verdict(fourThree), null);
  assert.equal(
    verdict({ ...fourThree, black: [...fourThree.black, [5, 5], [6, 6]] }),
    "double_three",
  );
  // A three against the top edge cannot become a straight four.
  assert.equal(verdict({ black: [[0, 5], [0, 6], [1, 7], [2, 7]], at: [0, 7] }), null);
  assert.equal(verdict({ black: [[1, 5], [1, 6], [2, 7], [3, 7]], at: [1, 7] }), "double_three");
  // Occupied points are not a Renju question.
  const { topology, board } = position(CASES.R1);
  assert.equal(forbiddenReason(topology, board, 7, 5), null);
  assert.throws(() => forbiddenReason(topology, board, 15, 0), RangeError);
  assert.throws(() => forbiddenReason(topology, board, 0, -1), RangeError);
});

/** Board symmetries that move a position across seams. */
function symmetries(width, height) {
  const mobius = getTopology("mobius", width, height);
  const fromCover = (shift) => ([row, col]) => {
    const point = mobius.fromCover(row, col + shift);
    return [point.row, point.col];
  };
  return [
    ["cylinder", "cylinder shift", ([row, col]) => [row, (col + 10) % width]],
    ["cylinder", "cylinder flip", ([row, col]) => [height - 1 - row, (col + 9) % width]],
    ["torus", "torus shift", ([row, col]) => [(row + 10) % height, (col + 11) % width]],
    ["mobius", "mobius shift through the seam", fromCover(10)],
    ["mobius", "mobius shift by one copy", fromCover(width + 4)],
  ];
}

test("R13: verdicts survive shifts across every seam (rows mirrored on a Mobius strip)", () => {
  for (const [name, spec] of [...Object.entries(CASES), ["R11", R11], ["R11 base", { ...R11_BASE, expected: "double_three" }]]) {
    for (const [topology, label, map] of symmetries(15, 15)) {
      const moved = {
        topology,
        black: spec.black.map(map),
        white: (spec.white ?? []).map(map),
        at: map(spec.at),
      };
      assert.equal(verdict(moved), spec.expected, `${name} ${label}`);
    }
  }
  // The Mobius shift really does mirror rows: R1's stones land on both sides.
  const moved = CASES.R1.black.map(symmetries(15, 15)[3][2]);
  assert.ok(moved.some(([row]) => row !== 5 && row !== 6 && row !== 7));
});

test("R14: a closed line filled with black is an overline", () => {
  const row10 = Array.from({ length: 10 }, (_, col) => [10, col]);
  for (const topology of ["torus", "cylinder"]) {
    assert.equal(
      verdict({ width: 11, height: 11, topology, black: row10, at: [10, 10] }),
      "overline",
      topology,
    );
  }
  // An exact five on an 11-cycle is still a five.
  assert.equal(
    verdict({ width: 11, height: 11, topology: "torus", black: row10.slice(0, 4), at: [10, 4] }),
    null,
  );
  // Ten of eleven, with a gap left, is already an overline.
  assert.equal(
    verdict({ width: 11, height: 11, topology: "torus", black: row10.slice(0, 9), at: [10, 9] }),
    "overline",
  );
  // A Mobius middle row (odd height) is an 11-cycle...
  assert.equal(
    verdict({
      width: 11, height: 11, topology: "mobius",
      black: Array.from({ length: 10 }, (_, col) => [5, col]), at: [5, 10],
    }),
    "overline",
  );
  // ...and two mirrored rows form a 22-cycle.
  const twoRows = [];
  for (let col = 0; col < 11; col += 1) twoRows.push([0, col], [11, col]);
  assert.equal(
    verdict({
      width: 11, height: 12, topology: "mobius",
      black: twoRows.filter(([row, col]) => !(row === 11 && col === 3)), at: [11, 3],
    }),
    "overline",
  );
  // A torus column (H-cycle) and a torus diagonal (lcm(W, H)-cycle) too.
  assert.equal(
    verdict({
      width: 11, height: 11, topology: "torus",
      black: Array.from({ length: 10 }, (_, row) => [row, 2]), at: [10, 2],
    }),
    "overline",
  );
  assert.equal(
    verdict({
      width: 11, height: 11, topology: "torus",
      black: Array.from({ length: 10 }, (_, step) => [step, step]), at: [10, 10],
    }),
    "overline",
  );
});

/** Small, fast, seeded PRNG (mulberry32). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const REF_WIDTH = 30;
const REF_HEIGHT = 19;
const REF_FIRST_COLUMN = 8;
const REF_LAST_COLUMN = 21;

/** A random black-heavy block of stones in columns 8-21 of a 30-wide cylinder. */
function randomPosition(seed) {
  const next = random(seed);
  const blackShare = 0.15 + next() * 0.2;
  const whiteShare = 0.05 + next() * 0.12;
  const board = Array.from({ length: REF_HEIGHT }, () => Array(REF_WIDTH).fill(null));
  for (let row = 0; row < REF_HEIGHT; row += 1) {
    for (let col = REF_FIRST_COLUMN; col <= REF_LAST_COLUMN; col += 1) {
      const roll = next();
      board[row][col] = roll < blackShare ? "black" : roll < blackShare + whiteShare ? "white" : null;
    }
  }
  return { board, next };
}

test("renju.js agrees with a brute-force reference on 2,000 seeded positions", () => {
  const topology = getTopology("cylinder", REF_WIDTH, REF_HEIGHT);
  const reference = createRenjuReference({ width: REF_WIDTH, height: REF_HEIGHT });
  const naive = createRenjuReference({ width: REF_WIDTH, height: REF_HEIGHT, recursive: false });
  const tally = { legal: 0, overline: 0, double_four: 0, double_three: 0 };
  let recursionDecides = 0;
  let checks = 0;
  for (let seed = 1; seed <= 2000; seed += 1) {
    const { board, next } = randomPosition(seed);
    const analyzer = new RenjuAnalyzer(topology, board);
    const rows = toReferenceBoard(board);
    reference.clear();
    naive.clear();
    // Probe up to six empty points in the middle of the block (columns
    // 11-18), whose windows and straight-four points stay off the seam.
    const empties = [];
    for (let row = 0; row < REF_HEIGHT; row += 1) {
      for (let col = 11; col <= 18; col += 1) {
        if (board[row][col] === null) empties.push([row, col]);
      }
    }
    for (let probe = 0; probe < 6 && empties.length > 0; probe += 1) {
      const [row, col] = empties.splice(Math.floor(next() * empties.length), 1)[0];
      const expected = reference.verdict(rows, row, col);
      assert.equal(analyzer.reasonAt(row, col), expected, `seed ${seed} at ${row},${col}`);
      tally[expected ?? "legal"] += 1;
      if (naive.verdict(rows, row, col) !== expected) recursionDecides += 1;
      checks += 1;
    }
  }
  assert.ok(checks >= 10_000, `${checks} checks`);
  // The sample must exercise every verdict and the RIF 9.3 recursion.
  assert.ok(tally.overline >= 100, JSON.stringify(tally));
  assert.ok(tally.double_four >= 100, JSON.stringify(tally));
  assert.ok(tally.double_three >= 100, JSON.stringify(tally));
  assert.ok(recursionDecides >= 50, `recursion decided ${recursionDecides} verdicts`);
});

test("forbiddenPoints lists exactly the reference's forbidden empties", () => {
  const topology = getTopology("cylinder", REF_WIDTH, REF_HEIGHT);
  const reference = createRenjuReference({ width: REF_WIDTH, height: REF_HEIGHT });
  let total = 0;
  for (let seed = 5001; seed <= 5060; seed += 1) {
    const { board } = randomPosition(seed);
    const rows = toReferenceBoard(board);
    reference.clear();
    const expected = [];
    for (let row = 0; row < REF_HEIGHT; row += 1) {
      for (let col = 0; col < REF_WIDTH; col += 1) {
        const reason = board[row][col] === null ? reference.verdict(rows, row, col) : null;
        if (reason !== null) expected.push({ row, col, reason });
      }
    }
    assert.deepEqual(forbiddenPoints(topology, board), expected, `seed ${seed}`);
    total += expected.length;
  }
  assert.ok(total > 200, `${total} forbidden points`);
});

test("the analyzer rejects malformed boards", () => {
  const topology = getTopology("cylinder", 11, 11);
  assert.throws(() => new RenjuAnalyzer(topology, []), RangeError);
  assert.throws(() => new RenjuAnalyzer(topology, Array(11).fill([])), RangeError);
  const bad = Array.from({ length: 11 }, () => Array(11).fill(null));
  bad[3][3] = "red";
  assert.throws(() => new RenjuAnalyzer(topology, bad), TypeError);
  const empty = Array.from({ length: 11 }, () => Array(11).fill(null));
  const analyzer = new RenjuAnalyzer(topology, empty);
  assert.equal(analyzer.hasLegalPoint(), true);
  assert.deepEqual(analyzer.forbiddenPoints(), []);
});

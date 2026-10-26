import assert from "node:assert/strict";
import test from "node:test";

import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { RenjuAnalyzer, forbiddenReason } from "../src/game/renju.js";
import { getTopology } from "../src/topology/index.js";
import { createRenjuReference, toReferenceBoard } from "./fixtures/renjuReference.js";

/*
 * Renju on boards from 5 lines up. A line shorter than 11 cells that closes
 * on itself (a row of a narrow cylinder, a column of a short torus, a small
 * torus diagonal, a Mobius row) cannot be read as a straight 11-cell window,
 * so renju.js reads it as a ring; the same definitions hold around the ring.
 * These cases spell the ring out, and seeded positions on every small board
 * shape compare every empty point with the independent reference.
 */

function board(width, height, black = [], white = []) {
  const rows = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [row, col] of black) rows[row][col] = "black";
  for (const [row, col] of white) rows[row][col] = "white";
  return rows;
}

test("a row of a 7-wide cylinder is a ring: a five across the seam, a six around it", () => {
  const topology = getTopology("cylinder", 7, 7);
  // Black on columns 5, 6, 0, 1 of row 3: column 2 completes 5-6-0-1-2.
  const five = board(7, 7, [[3, 5], [3, 6], [3, 0], [3, 1]], [[3, 3]]);
  assert.equal(forbiddenReason(topology, five, 3, 2), null);
  const game = new GomokuEngine({ width: 7, height: 7, ruleSet: "renju", initialBoard: five });
  assert.equal(game.play(3, 2).ok, true);
  assert.equal(game.result?.winner, "black", "the engine sees the same five");
  assert.equal(game.result.length, 5);
  // Add column 4: the run 4-5-6-0-1-2 is six, an overline for Black.
  const six = board(7, 7, [[3, 4], [3, 5], [3, 6], [3, 0], [3, 1]], [[3, 3]]);
  assert.equal(forbiddenReason(topology, six, 3, 2), "overline");
  // A straight window reader that cut the ring would have seen "4 + 1".
});

test("a full ring of exactly five is a five; a full ring of six is an overline", () => {
  const ring5 = board(5, 5, [[2, 0], [2, 1], [2, 3], [2, 4]]);
  assert.equal(forbiddenReason(getTopology("cylinder", 5, 5), ring5, 2, 2), null);
  const game = new GomokuEngine({ width: 5, height: 5, ruleSet: "renju", initialBoard: ring5 });
  assert.equal(game.play(2, 2).ok, true);
  assert.equal(game.result?.winner, "black");
  const ring6 = board(6, 6, [[2, 0], [2, 1], [2, 3], [2, 4], [2, 5]]);
  assert.equal(forbiddenReason(getTopology("cylinder", 6, 6), ring6, 2, 2), "overline");
  // White is never restricted: the same six wins for White.
  const white = new GomokuEngine({
    width: 6, height: 6, ruleSet: "renju", currentPlayer: "white",
    initialBoard: board(6, 6, [], [[2, 0], [2, 1], [2, 3], [2, 4], [2, 5]]),
  });
  assert.equal(white.play(2, 2).ok, true);
  assert.equal(white.result?.winner, "white");
});

test("fours are counted around a ring, also across the seam", () => {
  // 10-wide cylinder, row 4: X . X P X . X O O O with P at column 3. Filling
  // column 1 makes 0-4 and filling column 5 makes 2-6: two fours on one line.
  const topology = getTopology("cylinder", 10, 10);
  const doubleFour = board(10, 10, [[4, 0], [4, 2], [4, 4], [4, 6]], [[4, 7], [4, 8], [4, 9]]);
  assert.equal(forbiddenReason(topology, doubleFour, 4, 3), "double_four");
  // The same pattern turned six columns along runs across the seam.
  const shift = (col) => (col + 6) % 10;
  const across = board(10, 10, [[4, 0], [4, 2], [4, 4], [4, 6]].map(([row, col]) => [row, shift(col)]),
    [[4, 7], [4, 8], [4, 9]].map(([row, col]) => [row, shift(col)]));
  assert.equal(forbiddenReason(topology, across, 4, shift(3)), "double_four");
  // One four only (the white stone closes the other side): legal.
  const oneFour = board(10, 10, [[4, 0], [4, 2], [4, 4]], [[4, 5], [4, 7], [4, 8], [4, 9]]);
  assert.equal(forbiddenReason(topology, oneFour, 4, 3), null);
});

test("small-board verdicts match the independent reference on every empty point", () => {
  const shapes = [
    ["cylinder", 5, 5], ["cylinder", 6, 6], ["cylinder", 7, 7], ["cylinder", 8, 9], ["cylinder", 10, 6],
    ["torus", 5, 5], ["torus", 6, 7], ["torus", 7, 7], ["torus", 9, 9], ["torus", 10, 10],
    ["mobius", 5, 5], ["mobius", 5, 7], ["mobius", 7, 6], ["mobius", 9, 9], ["mobius", 10, 7],
  ];
  const tally = { legal: 0, overline: 0, double_four: 0, double_three: 0 };
  let checks = 0;
  for (const [kind, width, height] of shapes) {
    const topology = getTopology(kind, width, height);
    const reference = createRenjuReference({ width, height, topology: kind });
    let seed = width * 1_000 + height * 10 + kind.length;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let sample = 0; sample < 60; sample += 1) {
      const blackShare = 0.2 + random() * 0.3;
      const whiteShare = 0.05 + random() * 0.15;
      const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => {
        const roll = random();
        return roll < blackShare ? "black" : roll < blackShare + whiteShare ? "white" : null;
      }));
      const analyzer = new RenjuAnalyzer(topology, rows);
      const text = toReferenceBoard(rows);
      reference.clear();
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          if (rows[row][col] !== null) continue;
          const expected = reference.verdict(text, row, col);
          assert.equal(analyzer.reasonAt(row, col), expected, `${kind} ${width}x${height} sample ${sample} at ${row},${col}`);
          tally[expected ?? "legal"] += 1;
          checks += 1;
        }
      }
      // forbiddenPoints lists exactly those points.
      const listed = analyzer.forbiddenPoints().map(({ row, col, reason }) => `${row},${col}:${reason}`).sort();
      const expectedList = [];
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          if (rows[row][col] !== null) continue;
          const reason = reference.verdict(text, row, col);
          if (reason) expectedList.push(`${row},${col}:${reason}`);
        }
      }
      assert.deepEqual(listed, expectedList.sort(), `${kind} ${width}x${height} sample ${sample}: forbiddenPoints`);
    }
  }
  assert.ok(checks > 10_000, `${checks} checks`);
  for (const [verdict, count] of Object.entries(tally)) assert.ok(count >= 50, `${verdict}: ${JSON.stringify(tally)}`);
});

import assert from "node:assert/strict";
import test from "node:test";

import { getTopology } from "../src/topology/index.js";
import { DIRECTIONS, KINDS, compareGame, newOthelloStats, referenceRay } from "./helpers/othelloSoak.js";

/*
 * Othello against the independent reference in test/helpers/othelloSoak.js:
 * rays on the cover against src/topology, and seeded games move by move
 * against the engine and the AI board. The full volume (every board size)
 * runs in test/soak.othello.test.js under npm run test:soak.
 */

const HEAVY = process.env.OTHELLO_REFERENCE_HEAVY === "1";
// OTHELLO_REFERENCE_HEAVY=1 plays about 1,000 games on more and larger shapes.
const SHAPES = HEAVY
  ? [[6, 6], [8, 8], [6, 8], [8, 6], [10, 6], [6, 10], [12, 8], [10, 10], [14, 6]]
  : [[6, 6], [8, 8], [6, 8], [8, 6], [10, 6], [6, 10]];
const SEEDS = HEAVY ? 40 : 6;

test("rays on the cover match src/topology for every cell, direction and shape", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [...SHAPES, [12, 8], [10, 10], [16, 16], [6, 30], [30, 6], [30, 30]]) {
      const topology = getTopology(kind, width, height);
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          for (const [dRow, dCol] of DIRECTIONS) {
            const expected = referenceRay(kind, width, height, row, col, dRow, dCol);
            const actual = topology.ray(row, col, dRow, dCol);
            assert.deepEqual(
              actual.cells.map((cell) => [cell.row, cell.col]),
              expected.cells.map((cell) => [cell.row, cell.col]),
              `${kind} ${width}x${height} (${row},${col}) direction ${dRow},${dCol}`,
            );
            assert.equal(actual.end === "start" ? "start" : "edge", expected.end);
            // A ray never visits a point twice.
            const keys = expected.cells.map((cell) => cell.row * width + cell.col);
            assert.equal(new Set(keys).size, keys.length);
          }
        }
      }
    }
  }
});

test("engine and AI board match the independent reference move by move", () => {
  const coverage = newOthelloStats();
  for (const kind of KINDS) {
    for (const [width, height] of SHAPES) {
      for (let seed = 1; seed <= SEEDS; seed += 1) compareGame(kind, width, height, seed, { coverage });
    }
  }
  // The games must actually reach the cases in question.
  for (const [name, count] of Object.entries(coverage)) {
    assert.ok(count > 0, `no game reached: ${name} (${JSON.stringify(coverage)})`);
  }
  test.diagnostic?.(JSON.stringify(coverage));
  if (process.env.OTHELLO_REFERENCE_VERBOSE) console.log(coverage);
});

import assert from "node:assert/strict";
import test from "node:test";

import { GoEngine } from "../src/game/goEngine.js";
import * as gameCover from "../src/game/mobiusTopology.js";
import * as cover from "../src/topology/cover.js";
import { getTopology } from "../src/topology/index.js";
import * as legacy from "./fixtures/legacyGoNeighbors.js";

const KINDS = ["cylinder", "torus", "mobius"];
const DIMENSIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 30];
const COVER_EXPORTS = [
  "positiveModulo",
  "mobiusCopyIndex",
  "mobiusRowForCopy",
  "mobiusPointFromCover",
  "mobiusPointInCopy",
];

/** Run both functions and require identical results or identical errors. */
function assertSameOutcome(actual, expected, label) {
  let expectedOutcome;
  let actualOutcome;
  try {
    expectedOutcome = { value: expected() };
  } catch (error) {
    expectedOutcome = { error: `${error.constructor.name}: ${error.message}` };
  }
  try {
    actualOutcome = { value: actual() };
  } catch (error) {
    actualOutcome = { error: `${error.constructor.name}: ${error.message}` };
  }
  assert.deepEqual(actualOutcome, expectedOutcome, label);
}

test("GoEngine.neighbors matches the legacy order on every board shape", () => {
  let compared = 0;
  for (const topology of KINDS) {
    for (const width of DIMENSIONS) {
      for (const height of DIMENSIONS) {
        const game = new GoEngine({ width, height, topology });
        const shared = getTopology(topology, width, height);
        const board = { width, height, topology };
        for (let row = 0; row < height; row += 1) {
          for (let col = 0; col < width; col += 1) {
            const expected = legacy.legacyGoNeighbors(board, row, col);
            // Ordered, strict comparison: capture order depends on it.
            assert.deepStrictEqual(game.neighbors(row, col), expected,
              `${topology} ${width}x${height} (${row},${col})`);
            assert.deepStrictEqual(shared.neighbors4(row, col), expected);
            compared += 1;
          }
        }
        for (const [row, col] of [
          [-1, 0], [height, 0], [0, -1], [0, width], [0.5, 0], [0, 1.5],
          ["1", 0], [null, 0], [undefined, 0], [Number.NaN, 0],
        ]) {
          assert.deepStrictEqual(game.neighbors(row, col), []);
          assert.deepStrictEqual(legacy.legacyGoNeighbors(board, row, col), []);
        }
      }
    }
  }
  assert.equal(compared, 3 * 124 * 124);
});

test("the cover helpers keep their legacy results and errors", () => {
  for (const name of COVER_EXPORTS) {
    assert.equal(typeof cover[name], "function", name);
    // The old import path re-exports the very same functions.
    assert.equal(gameCover[name], cover[name], name);
  }
  assert.deepEqual(Object.keys(gameCover).sort(), [...COVER_EXPORTS].sort());

  for (const width of DIMENSIONS) {
    for (const height of [3, 4, 5, 8, 13, 30]) {
      for (let coverColumn = -3 * width; coverColumn <= 3 * width; coverColumn += 1) {
        assert.equal(
          cover.positiveModulo(coverColumn, width),
          legacy.positiveModulo(coverColumn, width),
        );
        assert.equal(
          cover.mobiusCopyIndex(coverColumn, width),
          legacy.mobiusCopyIndex(coverColumn, width),
        );
        for (const row of [0, 1, Math.floor(height / 2), height - 1]) {
          assert.deepStrictEqual(
            cover.mobiusPointFromCover(row, coverColumn, width, height),
            legacy.mobiusPointFromCover(row, coverColumn, width, height),
          );
          assert.deepStrictEqual(
            getTopology("mobius", width, height).fromCover(row, coverColumn),
            legacy.mobiusPointFromCover(row, coverColumn, width, height),
          );
        }
      }
      for (let row = 0; row < height; row += 1) {
        for (let copyIndex = -3; copyIndex <= 3; copyIndex += 1) {
          assert.equal(
            cover.mobiusRowForCopy(row, copyIndex, height),
            legacy.mobiusRowForCopy(row, copyIndex, height),
          );
          for (const col of [0, width - 1]) {
            assert.deepStrictEqual(
              cover.mobiusPointInCopy(row, col, copyIndex, width, height),
              legacy.mobiusPointInCopy(row, col, copyIndex, width, height),
            );
          }
        }
      }
    }
  }
  // Square defaults (height = width) are part of the public signature.
  assert.deepStrictEqual(
    cover.mobiusPointFromCover(1, -1, 5),
    legacy.mobiusPointFromCover(1, -1, 5),
  );
  assert.deepStrictEqual(
    cover.mobiusPointInCopy(1, 2, -1, 5),
    legacy.mobiusPointInCopy(1, 2, -1, 5),
  );
});

test("the cover helpers reject invalid input exactly as before", () => {
  const cases = [
    ["mobiusCopyIndex", [0.5, 5]],
    ["mobiusCopyIndex", [1, 0]],
    ["mobiusCopyIndex", [1, "5"]],
    ["mobiusRowForCopy", [5, 0, 5]],
    ["mobiusRowForCopy", [-1, 0, 5]],
    ["mobiusRowForCopy", [1, 0.5, 5]],
    ["mobiusRowForCopy", [1, 0, 0]],
    ["mobiusPointFromCover", [5, 0, 5, 5]],
    ["mobiusPointFromCover", [0, 1.5, 5, 5]],
    ["mobiusPointInCopy", [0, 5, 0, 5, 5]],
    ["mobiusPointInCopy", [0, -1, 0, 5, 5]],
    ["mobiusPointInCopy", [9, 0, 0, 5, 5]],
    ["positiveModulo", [-7, 3]],
    ["positiveModulo", [7, 0]],
  ];
  for (const [name, args] of cases) {
    assertSameOutcome(
      () => cover[name](...args),
      () => legacy[name](...args),
      `${name}(${args.join(", ")})`,
    );
  }
});

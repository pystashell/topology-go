import test from "node:test";
import assert from "node:assert/strict";

import { chooseMonteCarloMove, estimateDeadStones } from "../src/ai/mcts.js";
import {
  BLACK,
  EMPTY,
  GoEngine,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../src/game/goEngine.js";

const SEEDS = Object.freeze([3, 11, 17, 106]);

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

function gameFromRows(rows, options = {}) {
  return new GoEngine({
    width: rows[0].length,
    height: rows.length,
    komi: 0,
    ...options,
    initialBoard: boardFromRows(rows),
  });
}

function sortedPoints(points) {
  return [...points].sort((a, b) => a.row - b.row || a.col - b.col);
}

// Black owns rows 0-1 behind its wall; White owns row 4. One White stone is
// left inside Black's area with no eye and no way to win a liberty race.
const DEAD_STONE_IN_TERRITORY = Object.freeze([
  "..W..",
  ".....",
  "BBBBB",
  "WWWWW",
  ".....",
]);

test("eyeless stones inside walled-off territory are estimated dead on every seam", () => {
  for (const [topology, rows, dead] of [
    [TOPOLOGY_CYLINDER, DEAD_STONE_IN_TERRITORY, [{ row: 0, col: 2 }]],
    // The territory wraps through the cylinder's column seam.
    [
      TOPOLOGY_CYLINDER,
      [".......", "......W", "BBBBBBB", "WWWWWWW", "......."],
      [{ row: 1, col: 6 }],
    ],
    // Rows 3 and 5 enclose row 4 only because the torus rows wrap.
    [
      TOPOLOGY_TORUS,
      ["WWWWWW", "......", "WWWWWW", "BBBBBB", "..W...", "BBBBBB"],
      [{ row: 4, col: 2 }],
    ],
    // The middle row continues through the reversed Mobius seam, and the
    // two halves of Black's wall join across it.
    [
      TOPOLOGY_MOBIUS,
      ["........", "BBB...BB", "W..B.B..", "BBB...BB", "........"],
      [{ row: 2, col: 0 }],
    ],
  ]) {
    const game = gameFromRows(rows, { topology });
    const before = game.exportState();
    assert.deepEqual(sortedPoints(estimateDeadStones(game)), dead, topology);
    assert.equal(estimateDeadStones(game.exportSearchState()).length, dead.length);
    assert.deepEqual(game.exportState(), before, "estimating never mutates");
  }

  // On a torus the same stone touches White's row-4 area through the row
  // seam, so it is not walled off at all.
  const torus = gameFromRows(DEAD_STONE_IN_TERRITORY, { topology: TOPOLOGY_TORUS });
  assert.deepEqual(estimateDeadStones(torus), []);
});

test("living groups, contested walls, liberty races and seki are never estimated dead", () => {
  const positions = {
    // White lives with two one-point eyes inside Black's band. Without the
    // eye test it would look like an enclosed minority losing the race.
    "two eyes": [
      "W.W.W.......",
      "WWWWW.......",
      "............",
      "BBBBBBBBBBBB",
      "WWWWWWWWWWWW",
      "............",
      "............",
    ],
    // Black's eyeless wall still has open space to make eyes; it is not
    // a few stones left in White's territory.
    "contested wall": [
      ".W.W.W...",
      ".WWWWW...",
      "BBBBBBBBB",
      "WWWWWWWWW",
      ".........",
    ],
    // Every liberty of Black's wall is shared with the White stones, so the
    // outcome depends on who fills first.
    "liberty race": [
      "........",
      "........",
      "W.W.W.W.",
      "BBBBBBBB",
      "WWWWWWWW",
      "........",
    ],
    // The inner columns 4 and 6 share three liberties in column 5; both
    // outer groups have two eyes.
    seki: [
      "B.BBW.BWW.WB",
      "BBBBW.BWWWWB",
      "B.BBW.BWW.WB",
    ],
    opening: [
      ".........",
      "..B...W..",
      ".........",
      "......B..",
      "..W......",
      ".........",
      ".........",
    ],
  };
  for (const [name, rows] of Object.entries(positions)) {
    for (const topology of [TOPOLOGY_CYLINDER, TOPOLOGY_TORUS, TOPOLOGY_MOBIUS]) {
      if (topology !== TOPOLOGY_CYLINDER && name !== "opening") continue;
      const game = gameFromRows(rows, { topology });
      assert.deepEqual(estimateDeadStones(game), [], `${name} on a ${topology}`);
    }
  }
});

test("AI passes when the only unsettled stone left is dead in its territory", () => {
  for (const scoringRule of ["japanese", "chinese"]) {
    for (const seed of SEEDS) {
      const game = gameFromRows(DEAD_STONE_IN_TERRITORY, {
        komi: 0.5,
        scoringRule,
        currentPlayer: WHITE,
      });
      assert.equal(game.pass().ok, true);
      const result = chooseMonteCarloMove(game, {
        difficulty: "hard",
        seed,
        iterations: 120,
        timeLimitMs: Infinity,
        rolloutLimit: 10,
      });
      assert.deepEqual(
        result.move,
        { type: "pass" },
        `${scoringRule} seed ${seed} should not play inside its own territory`,
      );
      const [best] = [...result.stats.candidates].sort(
        (left, right) => right.winRate - left.winRate,
      );
      assert.deepEqual(best.move, { type: "pass" });
      assert.ok(best.winRate > 0.8);
    }
  }
});

test("mid-game search values count komi the same way final scoring does", () => {
  const options = { seed: 1, iterations: 30, timeLimitMs: Infinity, rolloutLimit: 8 };
  const values = (komi, currentPlayer) =>
    chooseMonteCarloMove(
      new GoEngine({ width: 9, height: 7, komi, currentPlayer }),
      options,
    ).stats.winRate;

  // Values are from the player to move's perspective.
  assert.ok(values(20, BLACK) < values(0, BLACK) - 0.2);
  assert.ok(values(20, WHITE) > values(0, WHITE) + 0.2);
  assert.ok(values(-20, BLACK) > values(0, BLACK) + 0.2);
});

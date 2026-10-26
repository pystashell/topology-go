import assert from "node:assert/strict";
import test from "node:test";

import { newGoStats, playRandomGoGame } from "./goSoak.js";
import { newGomokuStats, playRandomGomokuGame } from "./gomokuSoak.js";
import { compareGame, newOthelloStats } from "./othelloSoak.js";
import { SOAK_FULL, range, runPlan, squares } from "./soakPlan.js";

/**
 * The soak suites, one per game and topology (test/soak.*.test.js), so
 * node --test runs them side by side. Each plays its plan of random games
 * against the independent references and then asserts that the games
 * reached the edge cases they are there for.
 */

function report(name, stats) {
  test.diagnostic?.(`${name}: ${JSON.stringify(stats)}`);
  if (process.env.SOAK_VERBOSE) console.log(name, stats);
}

function expectReached(stats, names, label) {
  for (const name of names) {
    assert.ok(stats[name] > 0, `${label}: no game reached ${name} (${JSON.stringify(stats)})`);
  }
}

export function goSoakSuite(topology) {
  const seedBase = { cylinder: 1, torus: 100_000, mobius: 200_000 }[topology];
  const small = [[3, 3, 100], [4, 4, 100], [5, 5, 100]].map(([w, h, n]) => [w, h, n, { fullProbe: true }]);
  const plan = SOAK_FULL
    ? [
        ...small,
        [3, 4, 100, { fullProbe: true }],
        [4, 3, 100, { fullProbe: true }],
        [6, 6, 100, { fullProbe: true }],
        ...squares(range(3, 30)).map(([w, h]) => [w, h, 10, { deep: true }]),
        ...[[5, 9], [9, 5], [7, 19], [19, 7], [13, 30], [30, 13], [3, 30], [30, 3]].map(([w, h]) => [w, h, 10]),
      ]
    : [...small, [9, 9, 2, { deep: true }], [13, 13, 2], [19, 19, 2, { deep: true }], [7, 13, 2]];

  test(`Go on a ${topology}: random games agree with the reference move by move (${SOAK_FULL ? "full" : "quick"} plan)`, () => {
    const stats = newGoStats();
    runPlan(plan, ({ width, height, game, fullProbe, deep }) => {
      playRandomGoGame({
        topology, width, height, seed: seedBase + width * 1_000 + height * 10 + game,
        fullProbe, deep: deep && game < 2, stats,
      });
    });
    report(`go ${topology}`, stats);
    expectReached(stats, [
      "suicide", "simpleKo", "longCycleSuperko", "captures", "seamCaptures", "passes", "undos",
      "scored", "deadGroups", "draws",
    ], `go ${topology}`);
  });
}

export function gomokuSoakSuite(topology) {
  const seedBase = { cylinder: 7, torus: 300_000, mobius: 600_000 }[topology];
  // 5 x 5 and 7 x 7 rows and torus columns are short rings for Renju.
  const small = [[5, 5, 100], [7, 7, 100], [11, 11, 100], [7, 7, 30, { fill: true }], [11, 11, 30, { fill: true }]];
  const plan = SOAK_FULL
    ? [
        ...small,
        [12, 12, 20, { fill: true }],
        ...squares(range(5, 30)).map(([w, h]) => [w, h, 10]),
        [5, 9, 10], [9, 5, 10], [6, 10, 10], [10, 6, 10],
        ...[[11, 30], [30, 11], [11, 19], [19, 11], [13, 17]].map(([w, h]) => [w, h, 10]),
      ]
    : [...small, [15, 15, 2], [19, 19, 2], [11, 17, 2]];

  for (const ruleSet of ["freestyle", "renju"]) {
    test(`Gomoku (${ruleSet}) on a ${topology}: random games agree with the references (${SOAK_FULL ? "full" : "quick"} plan)`, () => {
      const stats = newGomokuStats();
      runPlan(plan, ({ width, height, game, fill }) => {
        playRandomGomokuGame({
          topology, width, height, ruleSet, fill,
          seed: seedBase + width * 1_000 + height * 10 + game + (fill ? 50_000 : 0) + (ruleSet === "renju" ? 7 : 0),
          stats,
        });
      });
      report(`gomoku ${ruleSet} ${topology}`, stats);
      expectReached(stats, ["blackWins", "whiteWins", "seamWins", "undos", "fullBoardDraws", "lastPointWins"], `gomoku ${ruleSet} ${topology}`);
      if (ruleSet === "renju") {
        expectReached(stats, ["overline", "double_four", "double_three", "forbiddenRefused"], `renju ${topology}`);
      } else {
        expectReached(stats, ["overlineWins"], `freestyle ${topology}`);
      }
    });
  }
}

export function othelloSoakSuite(topology) {
  const seedBase = { cylinder: 11, torus: 400_000, mobius: 800_000 }[topology];
  const small = [[4, 4, 100, { probeEvery: 1 }], [6, 6, 100, { probeEvery: 1 }]];
  const plan = SOAK_FULL
    ? [
        ...small,
        [6, 8, 30, { probeEvery: 2 }],
        [8, 6, 30, { probeEvery: 2 }],
        [4, 8, 30, { probeEvery: 2 }],
        [8, 4, 30, { probeEvery: 2 }],
        ...squares(range(4, 30, 2)).map(([w, h]) => [w, h, 10, {
          probeEvery: w <= 10 ? 3 : 40,
          slowChoices: w <= 12,
        }]),
        ...[[6, 30], [30, 6], [8, 12], [12, 8], [10, 16]].map(([w, h]) => [w, h, 10, { probeEvery: 40, slowChoices: false }]),
      ]
    : [...small, [8, 8, 4, { probeEvery: 3 }], [6, 10, 4, { probeEvery: 3 }]];

  test(`Othello on a ${topology}: random games agree with the reference move by move (${SOAK_FULL ? "full" : "quick"} plan)`, () => {
    const coverage = newOthelloStats();
    runPlan(plan, ({ width, height, game, probeEvery = 3, slowChoices = true }) => {
      compareGame(topology, width, height, seedBase + width * 1_000 + height * 10 + game, { coverage, probeEvery, slowChoices });
    });
    report(`othello ${topology}`, coverage);
    expectReached(coverage, [
      "skips", "blockedWithEmpties", "wipeouts", "fullBoards", "draws", "seamFlips",
      ...(topology === "torus" ? ["wrapFlips"] : []),
      ...(topology === "mobius" ? ["turnedFlips"] : []),
      ...(topology === "torus" ? ["loopsOfOpponents"] : []),
    ], `othello ${topology}`);
  });
}

import test from "node:test";
import assert from "node:assert/strict";

import { analyseMoves, createSeededRandom } from "../src/ai/mcts.js";
import { BLACK, GoEngine, TOPOLOGY_TORUS, WHITE } from "../src/game/goEngine.js";

// The string-keyed analysis that search used before the typed-array version.
// Every feature, the score and the random tie-break order must match it.
function referenceAnalysis(game, random) {
  const key = (point) => `${point.row},${point.col}`;
  const byStone = new Map();
  for (let row = 0; row < game.height; row++) {
    for (let col = 0; col < game.width; col++) {
      if (game.get(row, col) === null || byStone.has(`${row},${col}`)) continue;
      const group = game.getGroup(row, col);
      for (const stone of group.stones) byStone.set(key(stone), group);
    }
  }
  const player = game.currentPlayer;
  const entries = [];
  for (let row = 0; row < game.height; row++) {
    for (let col = 0; col < game.width; col++) {
      if (game.get(row, col) !== null) continue;
      const friendly = new Set();
      const enemy = new Set();
      const resulting = new Set();
      const neighbours = game.neighbors(row, col);
      for (const neighbour of neighbours) {
        const value = game.get(neighbour.row, neighbour.col);
        if (value === null) resulting.add(key(neighbour));
        else (value === player ? friendly : enemy).add(byStone.get(key(neighbour)));
      }
      let captured = 0;
      let rescued = 0;
      let rescuedGroups = 0;
      let atari = 0;
      for (const group of friendly) {
        for (const liberty of group.liberties) {
          if (liberty.row !== row || liberty.col !== col) resulting.add(key(liberty));
        }
        if (group.liberties.length === 1) {
          rescuedGroups++;
          rescued += group.stones.length;
        }
      }
      for (const group of enemy) {
        if (group.liberties.length === 1) {
          captured += group.stones.length;
          for (const stone of group.stones) resulting.add(key(stone));
        } else if (group.liberties.length === 2) {
          atari += group.stones.length;
        }
      }
      const ownEye = neighbours.length >= 3 &&
        neighbours.every((point) => game.get(point.row, point.col) === player);
      const selfAtari = captured === 0 && resulting.size <= 1;
      const openingLine = Math.min(3, Math.max(1, Math.floor(game.height / 3)));
      let score = 0;
      let tacticalPriority = 0;
      if (captured > 0) {
        score += 50_000 + captured * 1_200;
        tacticalPriority = 5;
      }
      if (rescued > 0) {
        score += 32_000 + rescued * 900 + rescuedGroups * 2_000;
        tacticalPriority = Math.max(tacticalPriority, 4);
      }
      if (atari > 0) {
        score += 2_000 + atari * 180;
        tacticalPriority = Math.max(tacticalPriority, 3);
      }
      score += Math.max(0, friendly.size - 1) * 700;
      score += resulting.size * 24;
      score += friendly.size * 20 + enemy.size * 12;
      if (game.topology !== TOPOLOGY_TORUS) {
        score -= Math.abs(Math.min(row, game.height - 1 - row) - openingLine) * 2;
      }
      if (rescuedGroups >= 2 && resulting.size >= 2) {
        score += 8_000;
        tacticalPriority = Math.max(tacticalPriority, 4);
      }
      if (selfAtari) score -= 35_000 + friendly.size * 1_000;
      if (ownEye && captured === 0) score -= 60_000;
      score += random() * 0.01;
      entries.push({
        move: { type: "play", row, col },
        score,
        tacticalScore: score,
        tacticalPriority,
        capturedStones: captured,
        rescuedStones: rescued,
        resultingLiberties: resulting.size,
        snapbackLoss: 0,
        selfAtari,
        ownEye,
      });
    }
  }
  return entries;
}

test("typed-array move analysis matches the string-keyed reference on every topology", () => {
  const random = createSeededRandom("move-analysis");
  const seen = { capture: 0, rescue: 0, atari: 0, selfAtari: 0, ownEye: 0 };
  // Interleave shapes so cached adjacency and scratch buffers never leak
  // between topologies or dimensions.
  const games = [];
  for (const topology of ["cylinder", "torus", "mobius"]) {
    for (const [width, height] of [[3, 3], [4, 3], [3, 5], [5, 5], [7, 4], [9, 9], [6, 11]]) {
      games.push(new GoEngine({ width, height, topology }));
    }
  }
  for (let ply = 0; ply < 50; ply++) {
    for (const game of games) {
      const seed = `${game.topology}${game.width}x${game.height}:${ply}`;
      const actual = analyseMoves(game, createSeededRandom(seed));
      assert.deepEqual(actual, referenceAnalysis(game, createSeededRandom(seed)), seed);
      assert.deepEqual(
        analyseMoves(game.exportSearchState(), createSeededRandom(seed)),
        actual,
      );
      for (const entry of actual) {
        if (entry.capturedStones) seen.capture++;
        if (entry.rescuedStones) seen.rescue++;
        if (entry.tacticalPriority === 3) seen.atari++;
        if (entry.selfAtari) seen.selfAtari++;
        if (entry.ownEye) seen.ownEye++;
      }

      const legal = actual.filter((entry) => game.checkPlay(entry.move.row, entry.move.col).ok);
      if (legal.length === 0 || random() < 0.04) game.pass();
      else {
        const { row, col } = legal[Math.floor(random() * legal.length)].move;
        game.play(row, col);
      }
      if (game.phase !== "play") game.resumePlay(random() < 0.5 ? BLACK : WHITE);
    }
  }
  for (const [feature, count] of Object.entries(seen)) {
    assert.ok(count >= 20, `${feature}: ${count}`);
  }
});

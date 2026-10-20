import assert from "node:assert/strict";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import { EXACT_UNIT, EVAL_LIMIT } from "../src/ai/othello/othelloEval.js";
import { createRandom, getOthelloGeometry } from "../src/ai/othello/othelloGeometry.js";
import {
  INF,
  OthelloSearcher,
  TranspositionTable,
  runSearchSync,
} from "../src/ai/othello/othelloSearch.js";
import { TOPOLOGY_KINDS } from "../src/topology/index.js";

/** Exact final margin for the side to move, by plain minimax on OthelloEngine. */
function bruteForce(engine) {
  if (engine.phase !== "play") {
    const { black, white } = engine.discs;
    return engine.currentPlayer === "black" ? black - white : white - black;
  }
  let best = -Infinity;
  for (const move of engine.legalMoves()) {
    const child = OthelloEngine.fromPublicState(engine.getState());
    child.play(move.row, move.col);
    // play() passes automatically, so the child may have the same mover.
    const value = bruteForce(child);
    best = Math.max(best, child.currentPlayer === engine.currentPlayer ? value : -value);
  }
  return best;
}

/** A random position with `empties` empty cells and the side to move able to play. */
function randomPosition(kind, width, height, empties, seed) {
  const random = createRandom(seed);
  const engine = new OthelloEngine({ width, height, topology: kind });
  while (engine.phase === "play") {
    const { black, white } = engine.discs;
    if (width * height - black - white <= empties) break;
    const legal = engine.legalMoves();
    const move = legal[Math.floor(random() * legal.length)];
    engine.play(move.row, move.col);
  }
  return engine.phase === "play" ? engine : null;
}

function valuesOf(engine) {
  const values = new Int8Array(engine.width * engine.height);
  engine.board.forEach((row, rowIndex) =>
    row.forEach((value, col) => {
      values[rowIndex * engine.width + col] =
        value === "black" ? 1 : value === "white" ? 2 : 0;
    }),
  );
  return values;
}

function searcherFor(engine, tuning = {}) {
  const geometry = getOthelloGeometry(engine.topology, engine.width, engine.height);
  const searcher = new OthelloSearcher(geometry, { tt: new TranspositionTable(16) });
  Object.assign(searcher, tuning);
  searcher.setPosition(valuesOf(engine), engine.currentPlayer === "black" ? 1 : 2);
  return searcher;
}

test("othello AI endgame solver equals brute-force minimax on small positions", () => {
  let checked = 0;
  const shapes = [
    [6, 6],
    [6, 8],
    [8, 6],
  ];
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of shapes) {
      for (let seed = 1; seed <= 7; seed += 1) {
        const empties = 4 + (seed % 4);
        const engine = randomPosition(kind, width, height, empties, seed * 977 + width);
        if (!engine) continue;
        const expected = bruteForce(engine);
        const side = engine.currentPlayer === "black" ? 1 : 2;
        // Small solver only, table-driven search only, and the full driver.
        for (const tuning of [{}, { smallSolveEmpties: 0 }, { smallSolveEmpties: 20 }]) {
          const searcher = searcherFor(engine, tuning);
          assert.equal(
            searcher.negamax(64, -INF, INF, side, 0) + 0,
            expected * EXACT_UNIT + 0,
            `${kind} ${width}x${height} seed ${seed} ${JSON.stringify(tuning)}`,
          );
          // Null windows around the true value bound it correctly.
          const low = searcherFor(engine, tuning).negamax(
            64,
            expected * EXACT_UNIT - 1,
            expected * EXACT_UNIT,
            side,
            0,
          );
          assert.ok(low >= expected * EXACT_UNIT);
          const high = searcherFor(engine, tuning).negamax(
            64,
            expected * EXACT_UNIT,
            expected * EXACT_UNIT + 1,
            side,
            0,
          );
          assert.ok(high <= expected * EXACT_UNIT);
        }
        const searcher = searcherFor(engine);
        const result = runSearchSync(searcher.run({ maxDepth: 64, exactEmpties: 64 }));
        if (result.source !== "only-move") {
          assert.equal(result.exact, true);
          assert.equal(result.score + 0, expected * EXACT_UNIT + 0);
          assert.equal(
            result.outcome,
            expected > 0 ? "win" : expected < 0 ? "loss" : "draw",
          );
          // The chosen move achieves the value.
          const geometry = searcher.geometry;
          const child = OthelloEngine.fromPublicState(engine.getState());
          child.play(Math.floor(result.cell / geometry.width), result.cell % geometry.width);
          const value = bruteForce(child);
          assert.equal(
            (child.currentPlayer === engine.currentPlayer ? value : -value) + 0,
            expected + 0,
          );
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 50, `checked ${checked} positions`);
});

test("othello AI win/draw/loss solve agrees with the exact value", () => {
  for (const kind of TOPOLOGY_KINDS) {
    for (let seed = 1; seed <= 6; seed += 1) {
      const engine = randomPosition(kind, 8, 8, 10, seed * 31 + kind.length);
      if (!engine) continue;
      const side = engine.currentPlayer === "black" ? 1 : 2;
      const exact = searcherFor(engine).negamax(64, -INF, INF, side, 0);
      const wld = searcherFor(engine).negamax(64, -EXACT_UNIT, EXACT_UNIT, side, 0);
      if (exact > 0) assert.ok(wld >= EXACT_UNIT);
      else if (exact < 0) assert.ok(wld <= -EXACT_UNIT);
      else assert.equal(wld + 0, 0);
      // The driver's staged solve (heuristic, WLD, exact) ends exact.
      const result = runSearchSync(searcherFor(engine).run({ maxDepth: 64, exactEmpties: 14 }));
      if (result.source !== "only-move") {
        assert.equal(result.exact, true);
        assert.equal(result.score + 0, exact + 0);
      }
    }
  }
});

test("othello AI heuristic scores stay inside the evaluation bound", () => {
  for (const kind of TOPOLOGY_KINDS) {
    for (let seed = 1; seed <= 5; seed += 1) {
      const engine = randomPosition(kind, 10, 10, 60, seed * 13);
      const searcher = searcherFor(engine);
      for (const side of [1, 2]) {
        const score = searcher.evaluate(side);
        assert.ok(Math.abs(score) < EVAL_LIMIT + 1, `${kind} ${score}`);
      }
      const result = runSearchSync(searcher.run({ maxDepth: 3, exactEmpties: 0 }));
      assert.ok(Math.abs(result.score) < EXACT_UNIT);
      assert.equal(result.depth, 3);
      assert.ok(result.rootMoves.some((move) => move.cell === result.cell));
    }
  }
});

test("othello AI evaluation is antisymmetric between the two sides", () => {
  for (const kind of TOPOLOGY_KINDS) {
    const engine = randomPosition(kind, 8, 8, 30, 5 + kind.length);
    const searcher = searcherFor(engine);
    // Equal except for the parity term (which favours whoever moves last),
    // so the two views sum to a small number.
    const black = searcher.evaluate(1);
    const white = searcher.evaluate(2);
    assert.ok(Math.abs(black + white) < EVAL_LIMIT, `${kind}: ${black} vs ${white}`);
  }
});

test("othello AI search stops at the deadline and keeps a legal move", () => {
  const engine = randomPosition("torus", 20, 20, 300, 4);
  const geometry = getOthelloGeometry("torus", 20, 20);
  let now = 0;
  // Every clock read advances the fake time by 1 ms.
  const searcher = new OthelloSearcher(geometry, { clock: () => (now += 1) });
  searcher.setPosition(valuesOf(engine), engine.currentPlayer === "black" ? 1 : 2);
  const generator = searcher.run({ maxDepth: 64, exactEmpties: 0, deadline: 2000 });
  let steps = 0;
  let result;
  for (;;) {
    const step = generator.next();
    steps += 1;
    if (step.done) {
      result = step.value;
      break;
    }
  }
  assert.ok(searcher.stopped);
  assert.ok(steps > 1, "the generator yielded at least once");
  assert.ok(result.depth >= 1 && result.depth < 64);
  const row = Math.floor(result.cell / 20);
  assert.equal(engine.checkPlay(row, result.cell % 20).ok, true);
});

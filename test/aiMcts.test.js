import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseMonteCarloMove,
  chooseMonteCarloMoveAsync,
  createSeededRandom,
  listLegalMoves,
} from "../src/ai/mcts.js";
import { BLACK, GoEngine, WHITE } from "../src/game/goEngine.js";

function fullBoard(size, color = BLACK) {
  return Array.from({ length: size }, () => Array(size).fill(color));
}

test("seeded random numbers and fixed-budget AI moves are reproducible", () => {
  const firstRandom = createSeededRandom("bamboo");
  const secondRandom = createSeededRandom("bamboo");
  assert.deepEqual(
    Array.from({ length: 6 }, firstRandom),
    Array.from({ length: 6 }, secondRandom),
  );

  const game = new GoEngine({ size: 5 });
  const options = {
    seed: "same-game",
    iterations: 12,
    timeLimitMs: Infinity,
    rolloutLimit: 12,
  };
  const first = chooseMonteCarloMove(game, options);
  const second = chooseMonteCarloMove(game, options);
  assert.deepEqual(first.move, second.move);
  assert.equal(first.stats.iterations, 12);
  assert.equal(second.stats.iterations, 12);
});

test("AI returns an exact legal move and never mutates the input game", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.play(2, 0).ok, true);
  assert.equal(game.play(1, 0).ok, true);
  const before = game.exportState();

  const result = chooseMonteCarloMove(game, {
    difficulty: "medium",
    seed: 42,
    iterations: 18,
    timeLimitMs: Infinity,
    rolloutLimit: 10,
  });

  assert.deepEqual(game.exportState(), before);
  const verification = GoEngine.fromState(before);
  const played =
    result.move.type === "pass"
      ? verification.pass()
      : verification.play(result.move.row, result.move.col);
  assert.equal(played.ok, true);
  assert.equal(result.stats.difficulty, "medium");
  assert.equal(result.stats.rootPlayer, before.currentPlayer);
});

test("legal move enumeration uses cylindrical Go rules and is defensive", () => {
  const game = new GoEngine({
    size: 5,
    currentPlayer: BLACK,
    initialBoard: [
      [null, null, null, null, null],
      [BLACK, null, null, null, null],
      [WHITE, BLACK, null, null, null],
      [BLACK, null, null, null, null],
      [null, null, null, null, null],
    ],
  });
  const before = game.exportState();
  const moves = listLegalMoves(game);

  assert.ok(
    moves.some((move) => move.type === "play" && move.row === 2 && move.col === 4),
    "seam capture must be a legal candidate",
  );
  assert.ok(moves.some((move) => move.type === "pass"));
  moves[0].row = 999;
  assert.deepEqual(game.exportState(), before);
});

test("pass is selected when every intersection is occupied", () => {
  const game = new GoEngine({
    size: 3,
    komi: 0,
    currentPlayer: WHITE,
    initialBoard: fullBoard(3),
  });
  const before = game.exportState();
  const result = chooseMonteCarloMove(game, {
    seed: 1,
    iterations: 4,
    timeLimitMs: Infinity,
    rolloutLimit: 4,
  });

  assert.deepEqual(result.move, { type: "pass" });
  assert.deepEqual(result.stats.candidates[0].move, { type: "pass" });
  assert.deepEqual(result.stats.candidates[0].variation[0], { type: "pass" });
  assert.ok(result.stats.candidates[0].variation.length <= 8);
  const line = GoEngine.fromState(before);
  result.stats.candidates[0].variation.forEach((move, index, variation) => {
    const played = move.type === "pass"
      ? line.pass()
      : line.play(move.row, move.col);
    assert.equal(played.ok, true);
    if (line.phase !== "play") assert.equal(index, variation.length - 1);
  });
  assert.deepEqual(game.exportState(), before);
});

test("candidate PVs stay legal and bounded on rectangular boards for every topology", () => {
  for (const topology of ["cylinder", "torus", "mobius"]) {
    const game = new GoEngine({ width: 5, height: 3, topology });
    const before = game.exportState({ includeReplay: false });
    const result = chooseMonteCarloMove(game, {
      seed: `pv-${topology}`,
      iterations: 72,
      timeLimitMs: Infinity,
      rolloutLimit: 4,
      candidateLimit: 24,
    });

    assert.ok(result.stats.candidates.length <= 25);
    assert.equal(result.stats.wireCandidateLimit, 25);
    assert.equal(result.stats.variationCandidateLimit, 5);
    assert.equal(result.stats.variationLimit, 8);
    const candidatesWithVariation = result.stats.candidates.filter(
      (candidate) => Object.hasOwn(candidate, "variation"),
    );
    assert.ok(candidatesWithVariation.length >= 1);
    assert.ok(candidatesWithVariation.length <= 5);
    assert.ok(
      candidatesWithVariation.some((candidate) =>
        JSON.stringify(candidate.move) === JSON.stringify(result.move)
      ),
      "the selected tactical recommendation must retain a PV",
    );
    assert.ok(
      result.stats.candidates.reduce(
        (total, candidate) => total + (candidate.variation?.length ?? 0),
        0,
      ) <= 40,
    );

    for (const candidate of candidatesWithVariation) {
      assert.deepEqual(candidate.variation[0], candidate.move);
      assert.ok(candidate.variation.length <= 8);
      const line = GoEngine.fromState(before);
      for (const move of candidate.variation) {
        const played = move.type === "pass"
          ? line.pass()
          : line.play(move.row, move.col);
        assert.equal(
          played.ok,
          true,
          `${topology} PV contains an illegal ${JSON.stringify(move)}`,
        );
      }
    }
    assert.deepEqual(game.exportState({ includeReplay: false }), before);
  }
});

test("sync search supports cooperative cancellation", () => {
  const game = new GoEngine({ size: 5 });
  let checks = 0;
  assert.throws(
    () =>
      chooseMonteCarloMove(game, {
        iterations: 100,
        timeLimitMs: Infinity,
        rolloutLimit: 20,
        shouldCancel: () => ++checks > 10,
      }),
    (error) => error.name === "AbortError" && error.code === "AI_SEARCH_CANCELLED",
  );
});

test("async search observes AbortSignal while it is running", async () => {
  const game = new GoEngine({ size: 5 });
  const controller = new AbortController();
  const pending = chooseMonteCarloMoveAsync(game, {
    seed: 9,
    iterations: 10_000,
    timeLimitMs: Infinity,
    rolloutLimit: 20,
    yieldEveryIterations: 1,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 0);

  await assert.rejects(
    pending,
    (error) => error.name === "AbortError" && error.code === "AI_SEARCH_CANCELLED",
  );
});

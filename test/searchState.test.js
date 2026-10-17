import assert from "node:assert/strict";
import test from "node:test";
import { GoEngine } from "../src/game/goEngine.js";
import { buildLegalPolicyMask } from "../src/ai/katago/cylinderFeatures.js";
import { createSeededRandom, listLegalMoves } from "../src/ai/mcts.js";

test("search state preserves superko while omitting undo and replay history", () => {
  const initialBoard = [".BW..", "BW.W.", ".BW..", ".....", "....."]
    .map(row => [...row].map(point => point === "B" ? "black" : point === "W" ? "white" : null));
  const game = new GoEngine({ size: 5, initialBoard });
  assert.equal(game.play(1, 2).ok, true);
  const original = game.exportState();
  const state = game.exportSearchState();
  assert.equal("undoHistory" in state, false);
  assert.equal("replay" in state, false);
  const search = GoEngine.fromSearchState(state);
  assert.deepEqual([...search.positionHistory], [...game.positionHistory]);
  assert.deepEqual(search.play(1, 1), { ok: false, reason: "superko" });
  assert.equal(buildLegalPolicyMask(state)[1 * 5 + 1], 0);
  assert.equal(search.play(4, 4).ok, true);
  assert.equal(search.undoHistory.length, 0);
  assert.equal(search.getReplayState().events.length, 0);
  assert.deepEqual(game.exportState(), original);
  assert.equal(search.positionHistory.size, game.positionHistory.size + 1);
});

test("search branches keep the same rules and final score without accumulating UI events", () => {
  for (const topology of ["cylinder", "torus", "mobius"]) {
    const game = new GoEngine({ width: 9, height: 5, topology });
    for (let col = 0; col < 6; col++) assert.equal(game.play(2, col).ok, true);
    const search = GoEngine.fromSearchState(game.exportState());
    for (const next of [game, search]) {
      next.pass(); next.pass(); next.toggleDead(2, 0); next.finishScoring();
    }
    assert.deepEqual(search.getState(), game.getState());
    assert.deepEqual(search.undoHistory, []);
    assert.deepEqual(search.getReplayState().events, []);
  }
});

test("single-position legality probes match cloned play() on random games", () => {
  const random = createSeededRandom("legal-mask-differential");
  const reasons = new Map();
  let positions = 0;
  for (const topology of ["cylinder", "torus", "mobius"]) {
    for (const [width, height] of [[3, 3], [4, 3], [3, 5], [5, 5], [6, 4], [4, 7]]) {
      const game = new GoEngine({ width, height, topology });
      for (let ply = 0; ply < 50; ply++) {
        const state = game.exportSearchState();
        const before = JSON.stringify(game.exportState());
        positions += 1;
        // Reference: the previous implementation rebuilt and validated the
        // whole game for every probe, then let play() and pass() decide.
        const expectedMask = new Uint8Array(width * height + 1);
        const expectedMoves = [];
        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const actual = GoEngine.fromSearchState(state).play(row, col);
            const probe = game.checkPlay(row, col);
            assert.equal(probe.ok, actual.ok, `${topology} ${width}x${height} ${row},${col}`);
            if (actual.ok) {
              expectedMask[row * width + col] = 1;
              expectedMoves.push({ type: "play", row, col });
            } else {
              assert.equal(probe.reason, actual.reason);
              reasons.set(actual.reason, (reasons.get(actual.reason) ?? 0) + 1);
            }
          }
        }
        if (GoEngine.fromSearchState(state).pass().ok) {
          expectedMask[width * height] = 1;
          expectedMoves.push({ type: "pass" });
        }
        assert.deepEqual(buildLegalPolicyMask(state), expectedMask);
        assert.deepEqual(buildLegalPolicyMask(game), expectedMask);
        assert.deepEqual(listLegalMoves(state), expectedMoves);
        assert.equal(JSON.stringify(game.exportState()), before, "probing never mutates");

        if (game.phase !== "play") {
          game.resumePlay(random() < 0.5 ? "black" : "white");
          continue;
        }
        const legal = expectedMoves.filter((move) => move.type === "play");
        if (legal.length === 0 || random() < 0.06) game.pass();
        else {
          const move = legal[Math.floor(random() * legal.length)];
          assert.equal(game.play(move.row, move.col).ok, true);
        }
      }
    }
  }
  // Random play on small boards repeatedly reaches every rejection reason.
  assert.ok(positions >= 900);
  for (const reason of ["occupied", "suicide", "superko", "game_not_playing"]) {
    assert.ok((reasons.get(reason) ?? 0) >= 10, `${reason}: ${reasons.get(reason)}`);
  }
});

test("cloneForSearch equals a validated search-state round trip and stays independent", () => {
  const random = createSeededRandom("clone-for-search");
  for (const topology of ["cylinder", "torus", "mobius"]) {
    const game = new GoEngine({ width: 7, height: 5, topology, komi: 3.5 });
    for (let ply = 0; ply < 80; ply++) {
      const clone = game.cloneForSearch();
      assert.deepEqual(
        clone.exportState(),
        GoEngine.fromSearchState(game.exportSearchState()).exportState(),
      );
      if (game.phase === "play") {
        const before = game.exportState();
        clone.pass();
        clone.pass();
        clone.toggleDead(...(game.lastMove?.type === "play"
          ? [game.lastMove.row, game.lastMove.col] : [0, 0]));
        clone.finishScoring();
        assert.deepEqual(game.exportState(), before);
        assert.deepEqual(clone.undoHistory, []);
        assert.deepEqual(clone.getReplayState().events, []);
        const row = Math.floor(random() * 5);
        const col = Math.floor(random() * 7);
        if (random() < 0.05) game.pass();
        else game.play(row, col);
      } else if (game.phase === "scoring") {
        if (random() < 0.5) game.resumePlay("black");
        else game.finishScoring();
      } else {
        break;
      }
    }
  }
});

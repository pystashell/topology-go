import assert from "node:assert/strict";
import test from "node:test";
import { GoEngine } from "../src/game/goEngine.js";
import { buildLegalPolicyMask } from "../src/ai/katago/cylinderFeatures.js";

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

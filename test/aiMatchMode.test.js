import assert from "node:assert/strict";
import test from "node:test";

import { GoEngine, PHASE_PLAY, PHASE_SCORING } from "../src/game/goEngine.js";

import {
  AI_MATCH_HUMAN,
  AI_MATCH_SELF_PLAY,
  isAIControlledColor,
  normalizeAIMatchMode,
  shouldPauseAIMatchAtScoring,
  shouldRunAI,
} from "../src/ai/matchMode.js";

test("human versus AI controls exactly the opposite color", () => {
  assert.equal(normalizeAIMatchMode("unknown"), AI_MATCH_HUMAN);
  assert.equal(isAIControlledColor({
    active: true,
    mode: AI_MATCH_HUMAN,
    humanColor: "black",
    color: "black",
  }), false);
  assert.equal(isAIControlledColor({
    active: true,
    mode: AI_MATCH_HUMAN,
    humanColor: "black",
    color: "white",
  }), true);
});

test("AI self-play controls both colors and respects pause, replay and phase", () => {
  for (const color of ["black", "white"]) {
    assert.equal(isAIControlledColor({
      active: true,
      mode: AI_MATCH_SELF_PLAY,
      humanColor: "black",
      color,
    }), true);
    assert.equal(shouldRunAI({
      active: true,
      mode: AI_MATCH_SELF_PLAY,
      humanColor: "black",
      color,
      phase: "play",
    }), true);
  }
  assert.equal(shouldRunAI({
    active: true,
    mode: AI_MATCH_SELF_PLAY,
    humanColor: "black",
    color: "black",
    phase: "play",
    paused: true,
  }), false);
  assert.equal(shouldRunAI({
    active: true,
    mode: AI_MATCH_SELF_PLAY,
    humanColor: "black",
    color: "black",
    phase: "play",
    replaying: true,
  }), false);
  assert.equal(shouldRunAI({
    active: true,
    mode: AI_MATCH_SELF_PLAY,
    humanColor: "black",
    color: "black",
    phase: "finished",
  }), false);
});

test("AI self-play pauses for dead-stone adjudication after double pass", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.pass().ok, true);
  const secondPass = game.pass();
  assert.equal(secondPass.phase, PHASE_SCORING);
  assert.equal(game.result, null);
  assert.equal(
    shouldPauseAIMatchAtScoring({
      active: true,
      mode: AI_MATCH_SELF_PLAY,
      phase: game.phase,
    }),
    true,
  );
  assert.equal(
    shouldPauseAIMatchAtScoring({
      active: true,
      mode: AI_MATCH_HUMAN,
      phase: "scoring",
    }),
    false,
  );
  assert.equal(
    shouldPauseAIMatchAtScoring({
      active: true,
      mode: AI_MATCH_SELF_PLAY,
      phase: "finished",
    }),
    false,
  );
  assert.equal(game.undo().ok, true);
  assert.equal(game.phase, PHASE_PLAY);
  assert.equal(game.result, null);
});

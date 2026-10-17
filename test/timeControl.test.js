import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceTimeControl,
  completeTimeControlTurn,
  createTimeControl,
  nextTimeControlDueAt,
  normalizeTimeControlConfig,
  pauseTimeControl,
  restoreTimeControl,
  snapshotTimeControl,
  startTimeControl,
} from "../src/game/timeControl.js";

test("untimed configuration remains null and invalid byo-yomi pairs are rejected", () => {
  assert.equal(normalizeTimeControlConfig(), null);
  assert.equal(
    createTimeControl({
      mainTimeSeconds: 0,
      byoYomiPeriods: 0,
      byoYomiSeconds: 0,
    }),
    null,
  );
  assert.throws(
    () => normalizeTimeControlConfig({ byoYomiPeriods: 3, byoYomiSeconds: 0 }),
    /both be zero or both be positive/,
  );
  assert.throws(
    () => normalizeTimeControlConfig({ mainTimeSeconds: 1.5 }),
    /integer/,
  );
});

test("main time is deducted from the mover before the clock switches", () => {
  let clock = createTimeControl(
    { mainTimeSeconds: 10, byoYomiPeriods: 3, byoYomiSeconds: 5 },
    { now: 1_000 },
  );
  clock = startTimeControl(clock, "black", 1_000);
  assert.equal(nextTimeControlDueAt(clock), 26_000);

  const live = snapshotTimeControl(clock, 9_000);
  assert.equal(live.serverNow, 9_000);
  assert.equal(live.activeColor, "black");
  assert.equal(live.players.black.mainTimeRemainingMs, 2_000);
  assert.equal(live.players.white.mainTimeRemainingMs, 10_000);
  assert.equal(live.turnDeadlineAt, 26_000);

  clock = completeTimeControlTurn(clock, 9_000, "white");
  assert.equal(clock.players.black.mainTimeRemainingMs, 2_000);
  assert.equal(clock.activeColor, "white");
  assert.equal(clock.activeSince, 9_000);
});

test("Japanese byo-yomi consumes complete periods and resets a surviving period after a move", () => {
  let clock = createTimeControl(
    { mainTimeSeconds: 0, byoYomiPeriods: 3, byoYomiSeconds: 5 },
    { now: 0, activeColor: "black" },
  );
  assert.equal(nextTimeControlDueAt(clock), 15_000);

  const duringSecondPeriod = snapshotTimeControl(clock, 7_000);
  assert.equal(duringSecondPeriod.players.black.byoYomiPeriodsRemaining, 2);
  assert.equal(duringSecondPeriod.players.black.byoYomiTimeRemainingMs, 3_000);

  clock = completeTimeControlTurn(clock, 7_000, "white");
  assert.equal(clock.players.black.byoYomiPeriodsRemaining, 2);
  assert.equal(clock.players.black.byoYomiTimeRemainingMs, 5_000);
  assert.equal(clock.activeColor, "white");
});

test("the final Japanese period expires exactly at the authoritative deadline", () => {
  const clock = createTimeControl(
    { mainTimeSeconds: 2, byoYomiPeriods: 2, byoYomiSeconds: 3 },
    { now: 10_000, activeColor: "black" },
  );
  assert.equal(nextTimeControlDueAt(clock), 18_000);
  assert.equal(advanceTimeControl(clock, 17_999).outcome, null);

  const expired = advanceTimeControl(clock, 18_000);
  assert.deepEqual(expired.outcome, {
    reason: "timeout",
    winner: "white",
    loser: "black",
    finishedAt: 18_000,
  });
  assert.equal(expired.activeColor, null);
  assert.equal(expired.players.black.byoYomiPeriodsRemaining, 0);
  assert.deepEqual(restoreTimeControl(JSON.parse(JSON.stringify(expired))), expired);
});

test("a paused clock preserves partial byo-yomi and does not gain or lose time", () => {
  let clock = createTimeControl(
    { mainTimeSeconds: 0, byoYomiPeriods: 2, byoYomiSeconds: 10 },
    { now: 1_000, activeColor: "black" },
  );
  clock = pauseTimeControl(clock, 5_000);
  assert.equal(clock.activeColor, null);
  assert.equal(clock.players.black.byoYomiTimeRemainingMs, 6_000);
  assert.equal(snapshotTimeControl(clock, 50_000).players.black.byoYomiTimeRemainingMs, 6_000);

  clock = startTimeControl(clock, "black", 50_000);
  assert.equal(nextTimeControlDueAt(clock), 66_000);
});

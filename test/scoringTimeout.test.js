import assert from "node:assert/strict";
import test from "node:test";

import {
  MATCH_MODE_FRIEND,
  MATCH_STATUS_FINISHED,
  MATCH_STATUS_PLAYING,
  RoomEngine,
  SCORING_CONFIRM_TIMEOUT_MS,
  SCORING_MAX_DURATION_MS,
} from "../src/multiplayer/roomEngine.js";

const act = (room, playerId, action, payload, now) => room.applyAction({ playerId, action, payload, now });

/** A 9x9 friend round with a stone each, then both pass at `countAt`. */
function countingRoom(countAt = 10_000) {
  const room = RoomEngine.create({
    code: "SCR234", name: "Host", size: 9, playerId: "host",
    tokenHash: "a".repeat(64), startImmediately: false, now: 1_000,
  });
  room.join({ name: "Guest", role: "player", playerId: "guest", tokenHash: "b".repeat(64), now: 1_100 });
  // Both have connected (as connectByToken records), so no seat is a reservation.
  for (const id of ["host", "guest"]) room.member(id).lastConnectedAt = 1_100;
  const invited = act(room, "host", "request_game", { mode: MATCH_MODE_FRIEND }, 1_200).room;
  act(room, "guest", "respond_game", { requestRevision: invited.match.request.requestRevision, accept: true }, 1_300);
  for (const [index, [playerId, action, row, col]] of [
    ["host", "play", 0, 0], ["guest", "play", 8, 8], ["host", "pass"], ["guest", "pass"],
  ].entries()) {
    const snapshot = room.snapshot(countAt);
    act(room, playerId, action, {
      ...(action === "play" ? { row, col } : {}),
      expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
    }, index < 3 ? 2_000 + index : countAt);
  }
  assert.equal(room.game.phase, "scoring");
  return room;
}

test("a count nobody confirms ends with the current marks after two minutes", () => {
  const room = countingRoom(10_000);
  assert.equal(room.snapshot(10_000).scoringDeadlineInMs, SCORING_CONFIRM_TIMEOUT_MS);
  assert.deepEqual(room.serialize().scoringDeadline, {
    scoringRevision: room.state.scoringRevision,
    startedAt: 10_000,
    at: 10_000 + SCORING_CONFIRM_TIMEOUT_MS,
  });
  assert.equal(room.nextDueAt(), 10_000 + SCORING_CONFIRM_TIMEOUT_MS);
  assert.equal(room.snapshot(70_000).scoringDeadlineInMs, SCORING_CONFIRM_TIMEOUT_MS - 60_000);

  assert.equal(room.advance(10_000 + SCORING_CONFIRM_TIMEOUT_MS - 1).changed, false);
  const advanced = room.advance(10_000 + SCORING_CONFIRM_TIMEOUT_MS);
  assert.equal(advanced.scoringAutoConfirmed, true);
  assert.equal(advanced.room.game.phase, "finished");
  assert.equal(advanced.room.match.status, MATCH_STATUS_FINISHED);
  assert.equal(advanced.room.scoringDeadlineInMs, null);
  assert.equal(Object.hasOwn(room.serialize(), "scoringDeadline"), false);
  // The finish is in the replay, so every page replays the same result.
  assert.equal(advanced.room.replay.events.at(-1).type, "finish_scoring");
  const restored = RoomEngine.restore(room.serialize());
  assert.deepEqual(restored.snapshot(400_000).game.result, advanced.room.game.result);
});

test("every change to the marks restarts the two minutes", () => {
  const room = countingRoom(10_000);
  act(room, "host", "toggle_dead", { row: 8, col: 8 }, 70_000);
  assert.equal(room.state.scoringDeadline.at, 70_000 + SCORING_CONFIRM_TIMEOUT_MS);
  assert.equal(room.advance(10_000 + SCORING_CONFIRM_TIMEOUT_MS).changed, false);
  assert.equal(room.game.phase, "scoring");
  // A one-sided confirmation keeps the deadline; the count still ends on it.
  act(room, "host", "finish_scoring", { color: "black", expectedScoringToken: room.scoringToken() }, 80_000);
  assert.deepEqual(room.state.scoreConfirmations, ["black"]);
  assert.equal(room.state.scoringDeadline.at, 70_000 + SCORING_CONFIRM_TIMEOUT_MS);
  const advanced = room.advance(70_000 + SCORING_CONFIRM_TIMEOUT_MS);
  assert.equal(advanced.scoringAutoConfirmed, true);
  // White's stone was marked dead, so Black wins the count.
  assert.equal(advanced.room.game.result.winner, "black");
});

test("re-marking cannot stretch a count past ten minutes", () => {
  const room = countingRoom(10_000);
  let now = 10_000;
  for (let toggle = 0; now + 100_000 < 10_000 + SCORING_MAX_DURATION_MS; toggle += 1) {
    now += 100_000;
    act(room, toggle % 2 ? "guest" : "host", "toggle_dead", { row: 8, col: 8 }, now);
    assert.ok(room.state.scoringDeadline.at <= 10_000 + SCORING_MAX_DURATION_MS);
    assert.equal(room.state.scoringDeadline.startedAt, 10_000);
  }
  assert.equal(room.state.scoringDeadline.at, 10_000 + SCORING_MAX_DURATION_MS);
  assert.equal(room.advance(10_000 + SCORING_MAX_DURATION_MS - 1).changed, false);
  assert.equal(room.advance(10_000 + SCORING_MAX_DURATION_MS).scoringAutoConfirmed, true);
});

test("resuming play drops the deadline and a new count starts a new one", () => {
  const room = countingRoom(10_000);
  act(room, "host", "resume_play", {}, 20_000);
  assert.equal(room.game.phase, "play");
  assert.equal(Object.hasOwn(room.serialize(), "scoringDeadline"), false);
  assert.equal(room.snapshot(20_000).scoringDeadlineInMs, null);
  // Both pass again: a fresh count with its own start.
  for (let pass = 0; pass < 2; pass += 1) {
    const snapshot = room.snapshot(30_000);
    const playerId = room.game.currentPlayer === "black" ? "host" : "guest";
    act(room, playerId, "pass", {
      expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
    }, 30_000);
  }
  assert.equal(room.game.phase, "scoring");
  assert.equal(room.state.scoringDeadline.startedAt, 30_000);
  assert.equal(room.state.match.status, MATCH_STATUS_PLAYING);
});

test("a count saved without a deadline gets one when the room wakes", () => {
  const room = countingRoom(10_000);
  const saved = room.serialize();
  delete saved.scoringDeadline;
  const restored = RoomEngine.restore(saved);
  const woke = restored.advance(50_000);
  assert.equal(woke.changed, true);
  assert.equal(restored.state.scoringDeadline.at, 50_000 + SCORING_CONFIRM_TIMEOUT_MS);
  assert.equal(restored.advance(50_000 + SCORING_CONFIRM_TIMEOUT_MS).scoringAutoConfirmed, true);
  assert.throws(() => RoomEngine.restore({ ...room.serialize(), scoringDeadline: { at: "soon" } }), {
    code: "BAD_ROOM_STATE",
  });
});

test("rooms outside a count store no deadline", () => {
  const room = RoomEngine.create({
    code: "SCR235", name: "Host", size: 9, playerId: "host", tokenHash: "a".repeat(64), now: 1_000,
  });
  assert.equal(Object.hasOwn(room.serialize(), "scoringDeadline"), false);
  assert.equal(room.snapshot(1_000).scoringDeadlineInMs, null);
});

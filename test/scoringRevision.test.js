import assert from "node:assert/strict";
import test from "node:test";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";

function scoringRoom() {
  const room = RoomEngine.create({
    code: "BAM234", name: "Black", size: 5,
    playerId: "black", tokenHash: "a".repeat(64), now: 1000,
  });
  room.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now: 1100 });
  room.applyAction({ playerId: "black", action: "play", payload: { row: 0, col: 0 }, now: 1200 });
  room.applyAction({ playerId: "white", action: "pass", now: 1300 });
  room.applyAction({ playerId: "black", action: "pass", now: 1400 });
  return room;
}

function confirm(room, playerId, token = room.scoringToken()) {
  return room.applyAction({ playerId, action: "finish_scoring", payload: { expectedScoringToken: token }, now: 2000 });
}

test("an in-flight confirmation cannot approve a different dead-stone proposal", () => {
  const room = scoringRoom();
  const oldToken = room.snapshot(1500).scoringToken;
  room.applyAction({ playerId: "black", action: "toggle_dead", payload: { row: 0, col: 0 }, now: 1600 });
  const newToken = room.scoringToken();
  assert.notEqual(newToken, oldToken);
  confirm(room, "black", newToken);
  assert.equal(room.scoringToken(), newToken);
  assert.throws(() => confirm(room, "white", oldToken), { code: "STALE_SCORING" });
  assert.equal(room.game.phase, "scoring");
  assert.deepEqual(room.state.scoreConfirmations, ["black"]);
  confirm(room, "white", newToken);
  assert.equal(room.game.phase, "finished");
});

test("confirmations survive reconnect and repeats without changing the proposal", () => {
  let room = scoringRoom();
  const token = room.scoringToken();
  confirm(room, "black", token);
  room = RoomEngine.restore(room.serialize());
  confirm(room, "black", token);
  assert.equal(room.scoringToken(), token);
  assert.deepEqual(room.state.scoreConfirmations, ["black"]);
  confirm(room, "white", token);
  assert.equal(room.game.phase, "finished");
});

test("missing, resumed and cross-round scoring proposals are rejected", () => {
  const room = scoringRoom();
  const oldToken = room.scoringToken();
  assert.throws(() => room.applyAction({ playerId: "white", action: "finish_scoring", now: 1500 }), { code: "STALE_SCORING" });
  room.applyAction({ playerId: "black", action: "resume_play", now: 1600 });
  room.applyAction({ playerId: "white", action: "pass", now: 1700 });
  room.applyAction({ playerId: "black", action: "pass", now: 1800 });
  assert.throws(() => confirm(room, "white", oldToken), { code: "STALE_SCORING" });
  const previousRound = room.scoringToken();
  confirm(room, "black");
  confirm(room, "white");
  room.applyAction({ playerId: "black", action: "new_game", now: 2100 });
  room.applyAction({ playerId: "black", action: "pass", now: 2200 });
  room.applyAction({ playerId: "white", action: "pass", now: 2300 });
  assert.throws(() => confirm(room, "white", previousRound), { code: "STALE_SCORING" });
});

test("legacy rooms retain the game but discard unversioned confirmations", () => {
  const room = scoringRoom();
  confirm(room, "black");
  const legacy = room.serialize();
  delete legacy.scoringRevision;
  const restored = RoomEngine.restore(legacy);
  assert.deepEqual(restored.game.getState(), room.game.getState());
  assert.deepEqual(restored.state.scoreConfirmations, []);
  assert.equal(typeof restored.scoringToken(), "string");
});

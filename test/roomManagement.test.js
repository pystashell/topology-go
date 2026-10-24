import assert from "node:assert/strict";
import test from "node:test";

import { BadukLobby } from "../worker/BadukLobby.js";
import {
  ABANDONMENT_GRACE_MS,
  MATCH_MODE_FRIEND,
  MATCH_MODE_HUMAN_AI,
  MATCH_STATUS_FINISHED,
  MATCH_STATUS_INVITED,
  MATCH_STATUS_PLAYING,
  MATCH_STATUS_SETUP,
  RoomEngine,
} from "../src/multiplayer/roomEngine.js";
import { ROOM_ACTIONS } from "../src/multiplayer/protocol.js";

const HOST_HASH = "a".repeat(64);
const GUEST_HASH = "b".repeat(64);
const VIEWER_HASH = "c".repeat(64);

function setupRoom(options = {}) {
  return RoomEngine.create({
    code: "MGT234", name: "Host", size: 9, playerId: "host",
    tokenHash: HOST_HASH, startImmediately: false, now: 1_000, ...options,
  });
}

function act(room, playerId, action, payload = {}, now = 2_000) {
  return room.applyAction({ playerId, action, payload, now });
}

function joinGuest(room, now = 1_100) {
  room.join({ name: "Guest", role: "player", playerId: "guest", tokenHash: GUEST_HASH, now });
  // As connectByToken records it: a connected seat is no longer a reservation.
  room.connections.set("guest-socket", "guest");
  room.member("guest").lastConnectedAt = now;
}

function joinViewer(room, now = 1_200) {
  room.join({ name: "Viewer", role: "spectator", playerId: "viewer", tokenHash: VIEWER_HASH, now });
}

/** A friend round with one move played by each side. */
function friendRoundInProgress(gameType) {
  const room = setupRoom(gameType ? { gameType, size: gameType === "othello" ? 8 : 15 } : {});
  room.connections.set("host-socket", "host");
  joinGuest(room);
  const invited = act(room, "host", "request_game", { mode: MATCH_MODE_FRIEND }, 1_300).room;
  act(room, "guest", "respond_game", {
    requestRevision: invited.match.request.requestRevision, accept: true, gameType,
  }, 1_400);
  const firstMoves = gameType === "othello" ? [[2, 3], [2, 2]] : [[0, 0], [8, 8]];
  for (const [index, [row, col]] of firstMoves.entries()) {
    const playerId = index === 0 ? "host" : "guest";
    const snapshot = room.snapshot(1_500 + index);
    act(room, playerId, "play", {
      row, col, gameType,
      expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
    }, 1_500 + index);
  }
  return room;
}

test("the new room actions are part of the protocol", () => {
  for (const action of ["set_listed", "remove_member", "claim_abandonment"]) {
    assert.ok(ROOM_ACTIONS.includes(action), action);
  }
});

test("an unlisted room stores listed: false; listed rooms store nothing new", () => {
  const listed = setupRoom();
  assert.equal(Object.hasOwn(listed.serialize(), "listed"), false);
  assert.equal(listed.snapshot(1_000).listed, true);
  assert.equal(listed.directorySnapshot(1_000).listed, true);

  const unlisted = setupRoom({ listed: false });
  assert.equal(unlisted.serialize().listed, false);
  assert.equal(unlisted.snapshot(1_000).listed, false);
  assert.equal(RoomEngine.restore(unlisted.serialize()).directorySnapshot(1_000).listed, false);

  assert.throws(() => setupRoom({ listed: "no" }), { code: "BAD_REQUEST" });
  assert.throws(() => RoomEngine.restore({ ...listed.serialize(), listed: true }), { code: "BAD_ROOM_STATE" });
});

test("only the host switches the room between listed and unlisted", () => {
  const room = setupRoom();
  joinGuest(room);
  assert.throws(() => act(room, "guest", "set_listed", { listed: false }), { code: "FORBIDDEN" });
  assert.throws(() => act(room, "host", "set_listed", { listed: "no" }), { code: "BAD_REQUEST" });
  let result = act(room, "host", "set_listed", { listed: false });
  assert.deepEqual(result.move, { ok: true, type: "listing_changed", listed: false });
  assert.equal(result.room.listed, false);
  result = act(room, "host", "set_listed", { listed: true }, 2_100);
  assert.equal(result.room.listed, true);
  assert.equal(Object.hasOwn(room.serialize(), "listed"), false);
});

function lobby() {
  const instance = Object.create(BadukLobby.prototype);
  instance.ready = Promise.resolve();
  instance.rooms = new Map();
  instance.watermarks = new Map();
  instance.ctx = { storage: { async put() {} } };
  return instance;
}

async function upsert(instance, room) {
  const response = await instance.fetch(new Request("https://index/internal/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(room),
  }));
  return response.json();
}

test("the lobby drops a room that becomes unlisted and keeps a late listed snapshot out", async () => {
  const now = Date.now();
  const room = setupRoom({ now });
  const instance = lobby();
  const listedSnapshot = room.directorySnapshot(now);
  assert.deepEqual(await upsert(instance, listedSnapshot), { ok: true });
  assert.ok(instance.rooms.has(room.state.code));

  act(room, "host", "set_listed", { listed: false }, now + 1);
  room.bumpDirectoryRevision();
  assert.deepEqual(await upsert(instance, room.directorySnapshot(now + 1)), { ok: true, removed: "unlisted" });
  assert.equal(instance.rooms.has(room.state.code), false);
  // The earlier listed snapshot arrives late: the watermark rejects it.
  assert.deepEqual(await upsert(instance, listedSnapshot), { ok: true, ignored: "stale" });
  assert.equal(instance.rooms.has(room.state.code), false);

  // A room created unlisted never enters the lobby.
  const hidden = setupRoom({ code: "HDN234", listed: false, now });
  assert.deepEqual(await upsert(instance, hidden.directorySnapshot(now)), { ok: true, ignored: "unlisted" });
  assert.equal(instance.rooms.has("HDN234"), false);

  // Listing it again publishes it.
  act(room, "host", "set_listed", { listed: true }, now + 2);
  room.bumpDirectoryRevision();
  assert.deepEqual(await upsert(instance, room.directorySnapshot(now + 2)), { ok: true });
  assert.ok(instance.rooms.has(room.state.code));
});

test("the host removes spectators any time and the White player only between games", () => {
  const room = friendRoundInProgress();
  joinViewer(room);
  assert.throws(() => act(room, "guest", "remove_member", { playerId: "viewer" }), { code: "FORBIDDEN" });
  assert.throws(() => act(room, "host", "remove_member", { playerId: "host" }), { code: "BAD_REQUEST" });
  assert.throws(() => act(room, "host", "remove_member", { playerId: "nobody" }), { code: "MEMBER_NOT_FOUND" });
  const removed = act(room, "host", "remove_member", { playerId: "viewer" });
  assert.equal(removed.removedPlayerId, "viewer");
  assert.deepEqual(removed.move, { ok: true, type: "member_removed", playerId: "viewer", role: "spectator" });
  assert.equal(room.member("viewer"), undefined);

  // Mid-game the opponent cannot be removed: that would decide the game.
  assert.throws(() => act(room, "host", "remove_member", { playerId: "guest" }), { code: "GAME_IN_PROGRESS" });
  act(room, "guest", "resign", { color: "white" }, 2_100);
  const afterGame = act(room, "host", "remove_member", { playerId: "guest" }, 2_200);
  assert.equal(afterGame.room.players.length, 1);
  assert.equal(afterGame.room.match.status, MATCH_STATUS_FINISHED);
  assert.equal(afterGame.room.match.controllers.white.operatorId, null);
});

test("removing the invited White player cancels the invitation", () => {
  const room = setupRoom();
  joinGuest(room);
  act(room, "host", "request_game", { mode: MATCH_MODE_FRIEND }, 1_300);
  assert.equal(room.state.match.status, MATCH_STATUS_INVITED);
  act(room, "host", "remove_member", { playerId: "guest" }, 1_400);
  assert.equal(room.state.match.status, MATCH_STATUS_SETUP);
  assert.equal(room.state.match.request, null);
});

for (const gameType of [undefined, "gomoku", "othello"]) {
  test(`a player claims a ${gameType ?? "go"} game whose opponent stayed offline`, () => {
    const room = friendRoundInProgress(gameType);
    assert.throws(() => act(room, "host", "claim_abandonment", {}, 2_000), { code: "OPPONENT_CONNECTED" });
    room.disconnect({ connectionId: "guest-socket", now: 3_000 });
    assert.equal(room.offlineSinceFor(room.member("guest"), 3_001), 3_000);
    assert.throws(
      () => act(room, "host", "claim_abandonment", {}, 3_000 + ABANDONMENT_GRACE_MS - 1),
      { code: "ABANDONMENT_TOO_EARLY" },
    );
    // A spectator cannot claim, and neither can the absent side.
    joinViewer(room, 3_100);
    assert.throws(() => act(room, "viewer", "claim_abandonment", {}, 3_200), { code: "FORBIDDEN" });
    const claimed = act(room, "host", "claim_abandonment", {}, 3_000 + ABANDONMENT_GRACE_MS);
    assert.equal(claimed.move.type, "abandonment_claimed");
    assert.equal(claimed.move.color, "white");
    assert.equal(claimed.room.game.result.winner, "black");
    assert.equal(claimed.room.match.status, MATCH_STATUS_FINISHED);
    assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
    assert.throws(() => act(room, "host", "claim_abandonment", {}, 3_000 + ABANDONMENT_GRACE_MS + 1), {
      code: "GAME_NOT_STARTED",
    });
  });
}

test("after a restart an offline opponent counts as offline from the restart", () => {
  const room = friendRoundInProgress();
  room.disconnect({ connectionId: "guest-socket", now: 3_000 });
  const restarted = RoomEngine.restore(room.serialize());
  restarted.connections.set("host-socket", "host");
  const wokeAt = 3_000 + ABANDONMENT_GRACE_MS;
  // The first claim after the restart is too early: the grace restarts.
  assert.throws(() => act(restarted, "host", "claim_abandonment", {}, wokeAt), {
    code: "ABANDONMENT_TOO_EARLY",
  });
  assert.equal(act(restarted, "host", "claim_abandonment", {}, wokeAt + ABANDONMENT_GRACE_MS)
    .room.game.result.winner, "black");
});

test("a Go count the opponent walked away from can be claimed", () => {
  const room = friendRoundInProgress();
  for (const playerId of ["host", "guest"]) {
    const snapshot = room.snapshot(1_600);
    act(room, playerId, "pass", {
      expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
    }, 1_600);
  }
  assert.equal(room.game.phase, "scoring");
  room.disconnect({ connectionId: "guest-socket", now: 2_000 });
  const claimed = act(room, "host", "claim_abandonment", {}, 2_000 + ABANDONMENT_GRACE_MS);
  assert.equal(claimed.room.game.result.winner, "black");
  assert.equal(claimed.room.game.result.reason, "resign");
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
});

test("the guest plays White against the host's AI after accepting an invitation", () => {
  const room = setupRoom();
  room.connections.set("host-socket", "host");
  assert.throws(
    () => act(room, "host", "request_game", { mode: MATCH_MODE_HUMAN_AI, aiOpponent: "guest" }, 1_200),
    { code: "OPPONENT_REQUIRED" },
  );
  assert.throws(
    () => act(room, "host", "request_game", { mode: MATCH_MODE_FRIEND, aiOpponent: "guest" }, 1_200),
    { code: "BAD_REQUEST" },
  );
  joinGuest(room, 1_250);
  const invited = act(room, "host", "request_game", {
    mode: MATCH_MODE_HUMAN_AI, aiOpponent: "guest", aiModelIds: { black: "b18", white: "b10" },
  }, 1_300).room;
  assert.equal(invited.match.status, MATCH_STATUS_INVITED);
  assert.deepEqual(invited.match.request.controllers, {
    black: { kind: "ai", operatorId: "host", modelId: "b18" },
    white: { kind: "human", operatorId: "guest" },
  });
  // A stored guest-AI invitation restores.
  assert.doesNotThrow(() => RoomEngine.restore(room.serialize()));
  assert.throws(() => act(room, "host", "respond_game", {
    requestRevision: invited.match.request.requestRevision, accept: true,
  }, 1_350), { code: "FORBIDDEN" });

  let snapshot = act(room, "guest", "respond_game", {
    requestRevision: invited.match.request.requestRevision, accept: true,
  }, 1_400).room;
  assert.equal(snapshot.match.status, MATCH_STATUS_PLAYING);
  assert.equal(snapshot.match.mode, MATCH_MODE_HUMAN_AI);
  // Black is the AI the host's browser runs; the host cannot play it by hand.
  assert.throws(() => act(room, "host", "play", {
    row: 0, col: 0, expectedMoveCount: 0, expectedPositionToken: snapshot.positionToken,
  }, 1_450), { code: "FORBIDDEN" });
  snapshot = act(room, "host", "ai_play", {
    row: 0, col: 0, expectedMoveCount: 0, expectedPositionToken: snapshot.positionToken,
  }, 1_500).room;
  snapshot = act(room, "guest", "play", {
    row: 4, col: 4, expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
  }, 1_600).room;
  snapshot = act(room, "host", "ai_play", {
    row: 0, col: 1, expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
  }, 1_700).room;
  // The guest undoes its own move and the AI reply.
  const undone = act(room, "guest", "direct_undo_ai_round", {
    expectedMoveCount: snapshot.moveCount, expectedPositionToken: snapshot.positionToken,
  }, 1_800);
  assert.equal(undone.move.undoneCount, 2);
  assert.equal(undone.room.moveCount, 1);

  // Seats are locked mid-game, and the guest leaving forfeits White.
  assert.throws(() => act(room, "guest", "release_seat", {}, 1_900), { code: "GAME_IN_PROGRESS" });
  joinViewer(room, 1_950);
  assert.equal(room.member("viewer").role, "spectator");
  const left = room.leave({ playerId: "guest", now: 2_000 });
  assert.equal(left.room.game.result.winner, "black");
  assert.equal(left.room.match.status, MATCH_STATUS_FINISHED);
});

test("the host leaving a guest-AI game forfeits the AI side", () => {
  const room = setupRoom();
  joinGuest(room, 1_250);
  const invited = act(room, "host", "request_game", { mode: MATCH_MODE_HUMAN_AI, aiOpponent: "guest" }, 1_300).room;
  let snapshot = act(room, "guest", "respond_game", {
    requestRevision: invited.match.request.requestRevision, accept: true,
  }, 1_400).room;
  snapshot = act(room, "host", "ai_play", {
    row: 0, col: 0, expectedMoveCount: 0, expectedPositionToken: snapshot.positionToken,
  }, 1_500).room;
  const left = room.leave({ playerId: "host", now: 1_600 });
  const finished = left.room.rounds.at(-1);
  assert.equal(finished.result.winner, "white");
  assert.equal(finished.mode, MATCH_MODE_HUMAN_AI);
});

test("a guest-AI invitation ends when the guest gives up the seat", () => {
  const room = setupRoom();
  joinGuest(room, 1_250);
  act(room, "host", "request_game", { mode: MATCH_MODE_HUMAN_AI, aiOpponent: "guest" }, 1_300);
  act(room, "guest", "release_seat", {}, 1_400);
  assert.equal(room.state.match.status, MATCH_STATUS_SETUP);
  assert.equal(room.state.match.request, null);
});

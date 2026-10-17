import assert from "node:assert/strict";
import test from "node:test";

import {
  MATCH_MODE_HUMAN_AI,
  MATCH_MODE_LOCAL,
  MATCH_STATUS_FINISHED,
  MATCH_STATUS_PLAYING,
  RoomEngine,
  RoomEngineError,
} from "../src/multiplayer/roomEngine.js";
import { BadukRoom } from "../worker/BadukRoom.js";

const HOST_HASH = "a".repeat(64);
const FRIEND_HASH = "b".repeat(64);
const VIEWER_HASH = "c".repeat(64);

function friendGame({ moves = 1, base = 0 } = {}) {
  const room = RoomEngine.create({
    code: "SEA234", name: "Host", size: 9, playerId: "host", tokenHash: HOST_HASH,
    mainTimeSeconds: 60, startImmediately: false, now: base + 1_000,
  });
  for (const [name, role, playerId, tokenHash] of [
    ["Friend", "player", "friend", FRIEND_HASH],
    ["Viewer", "spectator", "viewer", VIEWER_HASH],
  ]) room.join({ name, role, playerId, tokenHash, now: base + 1_000 });
  for (const id of ["host", "friend", "viewer"]) room.connections.set(`${id}-socket`, id);
  const invited = room.applyAction({
    playerId: "host", action: "request_game", payload: { mode: "friend" }, now: base + 1_100,
  });
  room.applyAction({
    playerId: "friend", action: "respond_game",
    payload: { accept: true, requestRevision: invited.move.request.requestRevision },
    now: base + 1_200,
  });
  const points = [[0, 0], [8, 8], [0, 8]];
  for (let index = 0; index < moves; index += 1) {
    const [row, col] = points[index];
    room.applyAction({
      playerId: index % 2 === 0 ? "host" : "friend", action: "play",
      payload: { row, col }, now: base + 2_000 + index * 1_000,
    });
  }
  return room;
}

function rejectsInProgress(callback) {
  assert.throws(callback, (error) =>
    error instanceof RoomEngineError && error.code === "GAME_IN_PROGRESS" && error.status === 409);
}

function clockOf(room, now) {
  const { activeColor, running, turnDeadlineAt, players } = room.snapshot(now).timeControl;
  return { activeColor, running, turnDeadlineAt, players };
}

test("seats cannot be released, claimed or reassigned while a friend game is under way", () => {
  const room = friendGame();
  const clock = clockOf(room, 5_000);
  assert.equal(clock.activeColor, "white");
  assert.equal(clock.running, true);

  rejectsInProgress(() => room.applyAction({ playerId: "friend", action: "release_seat", now: 5_000 }));
  rejectsInProgress(() => room.applyAction({
    playerId: "host", action: "attach_ai", payload: { modelId: "b10" }, now: 5_000,
  }));
  const late = room.join({
    name: "Late", role: "player", playerId: "late", tokenHash: "d".repeat(64), now: 5_000,
  });
  assert.equal(late.identity.role, "spectator");
  assert.deepEqual(clockOf(room, 5_000), clock, "rejected seat changes never pause the clock");
  assert.equal(room.snapshot(5_000).match.controllers.white.operatorId, "friend");

  // The white clock keeps running and eventually flags the seated player.
  const timedOut = room.advance(1_200 + 60_000 + 2_000 + 1);
  assert.equal(timedOut.timedOut, true);
  assert.equal(room.snapshot(70_000).timeControl.outcome.loser, "white");
  // After the game ends the seat is free to change again.
  assert.equal(room.applyAction({ playerId: "friend", action: "release_seat", now: 70_001 })
    .identity.role, "spectator");
});

test("a seat vacated mid-game stays locked against claims, joins and AI", () => {
  // The remaining way to vacate a seat mid-game is a legacy immediately
  // playing room whose host detaches its own AI, leaving a friend round.
  const room = RoomEngine.create({
    code: "SEA234", name: "Host", size: 9, playerId: "host", tokenHash: HOST_HASH,
    mainTimeSeconds: 60, startImmediately: true, now: 1_000,
  });
  room.join({ name: "Viewer", role: "spectator", playerId: "viewer", tokenHash: VIEWER_HASH, now: 1_000 });
  room.connections.set("host-socket", "host");
  room.connections.set("viewer-socket", "viewer");
  const attached = room.applyAction({
    playerId: "host", action: "attach_ai", payload: { modelId: "b10" }, now: 1_050,
  }).room;
  assert.equal(attached.match.mode, MATCH_MODE_HUMAN_AI);
  room.applyAction({ playerId: "host", action: "play", payload: { row: 0, col: 0 }, now: 1_200 });
  const detached = room.applyAction({ playerId: "host", action: "detach_ai", now: 1_300 }).room;
  assert.equal(detached.match.mode, "friend");
  assert.equal(detached.match.status, MATCH_STATUS_PLAYING);
  assert.equal(detached.match.controllers.white.operatorId, null);

  rejectsInProgress(() => room.applyAction({ playerId: "viewer", action: "claim_seat", now: 1_400 }));
  rejectsInProgress(() => room.applyAction({
    playerId: "host", action: "attach_ai", payload: { modelId: "b10" }, now: 1_400,
  }));
  const joined = room.join({
    name: "Stranger", role: "player", playerId: "stranger", tokenHash: "d".repeat(64), now: 1_400,
  });
  assert.equal(joined.identity.role, "spectator");
  assert.equal(room.snapshot(1_400).match.controllers.white.operatorId, null);

  // The host can still end the round by leaving, after which seats reopen.
  assert.equal(room.applyAction({ playerId: "host", action: "leave", now: 1_500 }).move.loser, "black");
  assert.equal(room.snapshot(1_500).match.status, MATCH_STATUS_FINISHED);
  assert.equal(room.join({
    name: "Next host", role: "player", playerId: "next-host", tokenHash: "e".repeat(64), now: 1_600,
  }).identity.color, "black");
});

test("detaching an AI is refused while a friend game is under way", () => {
  const room = friendGame();
  // Simulate an AI seat persisted by an older release inside a friend round.
  room.state.members = room.state.members.filter(({ playerId }) => playerId !== "friend");
  room.state.members.push({
    playerId: "__ai_white__:SEA234", name: "KataGo b10 AI", tokenHash: "f".repeat(64),
    role: "player", color: "white", automated: true, controllerId: "host", modelId: "b10",
    joinedAt: 1_000, lastSeenAt: 1_000, lastSequence: 0,
  });
  rejectsInProgress(() => room.applyAction({ playerId: "host", action: "detach_ai", now: 5_000 }));
});

function resignedFields(room, now) {
  const snapshot = room.snapshot(now);
  return {
    result: snapshot.game.result,
    phase: snapshot.game.phase,
    status: snapshot.match.status,
    replay: snapshot.replay,
    resignation: room.state.resignationOutcome,
    clock: snapshot.timeControl.running,
  };
}

test("leaving a friend game mid-round resigns exactly like the resign action", () => {
  for (const leaver of ["friend", "host"]) {
    const resigned = friendGame({ moves: 2 });
    resigned.applyAction({ playerId: leaver, action: "resign", payload: {}, now: 9_000 });
    const left = friendGame({ moves: 2 });
    const result = left.applyAction({ playerId: leaver, action: "leave", now: 9_000 });
    assert.equal(result.move.type, "resign");

    const expected = resignedFields(resigned, 9_000);
    assert.deepEqual(resignedFields(left, 9_000), expected, leaver);
    assert.equal(expected.result.loser, leaver === "host" ? "black" : "white");
    assert.equal(expected.status, MATCH_STATUS_FINISHED);
    assert.equal(expected.clock, false);
    assert.equal(left.member(leaver), undefined, "the member is removed after resigning");
    // The finished round survives a restore and is archived like a resignation.
    const restored = RoomEngine.restore(left.serialize());
    assert.equal(restored.snapshot(9_100).game.result.reason, "resign");
  }

  const archived = friendGame({ moves: 2 });
  archived.applyAction({ playerId: "friend", action: "leave", now: 9_000 });
  archived.applyAction({
    playerId: "host", action: "request_game", payload: { mode: MATCH_MODE_LOCAL }, now: 9_100,
  });
  const [round] = archived.state.roundArchive;
  assert.equal(round.result.reason, "resign");
  assert.equal(round.result.loser, "white");
  assert.equal(round.replay.outcome.reason, "resign");
  assert.equal(round.replay.events.length, 2);
});

test("leaving during scoring resigns and the stored room still restores", () => {
  const room = friendGame({ moves: 1 });
  room.applyAction({ playerId: "friend", action: "pass", now: 4_000 });
  room.applyAction({ playerId: "host", action: "pass", now: 4_100 });
  room.applyAction({ playerId: "friend", action: "toggle_dead", payload: { row: 0, col: 0 }, now: 4_200 });
  assert.equal(room.game.phase, "scoring");

  room.applyAction({ playerId: "friend", action: "leave", now: 4_300 });
  const restored = RoomEngine.restore(room.serialize());
  const snapshot = restored.snapshot(4_400);
  assert.equal(snapshot.game.result.reason, "resign");
  assert.equal(snapshot.game.result.winner, "black");
  assert.equal(snapshot.match.status, MATCH_STATUS_FINISHED);
  assert.equal(snapshot.replay.outcome.reason, "resign");
  assert.equal(snapshot.replay.events.at(-1).type, "resume_play");
});

test("leaving before the first move or as a spectator does not resign", () => {
  const early = friendGame({ moves: 0 });
  const left = early.applyAction({ playerId: "friend", action: "leave", now: 1_500 });
  assert.equal(left.move, undefined);
  assert.equal(early.state.resignationOutcome, null);
  assert.equal(early.snapshot(1_500).match.status, MATCH_STATUS_PLAYING);
  assert.equal(early.join({
    name: "Next", role: "player", playerId: "next", tokenHash: "d".repeat(64), now: 1_600,
  }).identity.color, "white");

  const watched = friendGame();
  watched.applyAction({ playerId: "viewer", action: "leave", now: 5_000 });
  assert.equal(watched.state.resignationOutcome, null);
  assert.equal(watched.snapshot(5_000).timeControl.running, true);
});

test("the leave command commits the forfeit and closes the socket", async () => {
  const engine = friendGame({ moves: 2, base: Date.now() - 10_000 });
  const writes = [];
  const room = Object.create(BadukRoom.prototype);
  room.engine = engine;
  room.ctx = {
    storage: {
      async put(_key, value) { writes.push(value); },
      async getAlarm() { return null; },
      async setAlarm() {},
      async deleteAlarm() {},
    },
    getWebSockets: () => [],
  };
  room.env = {};
  const attachment = { connectionId: "friend-socket", identity: { playerId: "friend", role: "player", color: "white" } };
  let closed = null;
  const socket = {
    readyState: 1, messages: [],
    deserializeAttachment: () => attachment,
    serializeAttachment() {},
    send(raw) { this.messages.push(JSON.parse(raw)); },
    close(code) { closed = code; },
  };
  await room.handleCommand(socket, attachment, { id: "bye", sequence: 9, action: "leave", payload: {} });
  assert.equal(socket.messages[0].type, "ack", JSON.stringify(socket.messages[0]));
  assert.equal(closed, 1000);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].resignationOutcome.loser, "white");
  assert.equal(writes[0].members.some(({ playerId }) => playerId === "friend"), false);
});

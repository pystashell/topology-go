import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCH_CONTROLLER_AI,
  MATCH_CONTROLLER_HUMAN,
  MATCH_TRANSPORT_LOCAL,
  MATCH_TRANSPORT_ONLINE,
  automatedSeat,
  controllerOperatorsFromRoom,
  controllersFromRoom,
  createMatchSession,
  isHumanOnlineMatch,
  isSameBrowserHumanOnlineMatch,
  routeMatchAction,
  shouldProtectOnlineAITurn,
} from "../src/game/matchSession.js";

const AI_WHITE = {
  id: "ai-white",
  name: "KataGo b10",
  role: "ai",
  color: "white",
  automated: true,
  modelId: "b10",
  controllerId: "black-player",
};

test("room seats project into independent transport and controller axes", () => {
  const room = { players: [{ id: "black-player", role: "player", color: "black" }, AI_WHITE] };
  assert.equal(automatedSeat(room, "white"), AI_WHITE);
  assert.deepEqual(controllersFromRoom(room), {
    black: MATCH_CONTROLLER_HUMAN,
    white: MATCH_CONTROLLER_AI,
  });
});

test("persistent match controllers override legacy seat inference", () => {
  const room = {
    players: [{ id: "host", role: "player", color: "black" }],
    match: {
      controllers: {
        black: { kind: "ai", operatorId: "host", modelId: "b10" },
        white: { kind: "ai", operatorId: "host", modelId: "b18" },
      },
    },
  };
  assert.deepEqual(controllersFromRoom(room), { black: "ai", white: "ai" });
  assert.deepEqual(controllerOperatorsFromRoom(room), { black: "host", white: "host" });
});

test("one online browser can control both human colors", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    controllerOperatorByColor: { black: "host", white: "host" },
    identity: { id: "host", role: "player", color: "black" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
  });
  assert.deepEqual(session.controlledColors, ["black", "white"]);
  assert.equal(session.capabilities.play, true);
  assert.equal(session.capabilities.pass, true);

  const otherMember = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    controllerOperatorByColor: { black: "host", white: "host" },
    identity: { id: "friend", role: "player", color: "white" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
  });
  assert.deepEqual(otherMember.controlledColors, []);
  assert.equal(otherMember.capabilities.undo, false);
  assert.equal(isSameBrowserHumanOnlineMatch(otherMember), false);
});

test("local and online sessions expose the same action capability vocabulary", () => {
  const local = createMatchSession({
    transport: MATCH_TRANSPORT_LOCAL,
    controllerByColor: { black: "human", white: "human" },
    phase: "play",
    currentPlayer: "black",
    undoAvailable: true,
  });
  const online = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "black",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
  });
  assert.deepEqual(Object.keys(local.capabilities), Object.keys(online.capabilities));
  assert.equal(local.capabilities.play, true);
  assert.equal(online.capabilities.play, true);
});

test("an unstarted lobby exposes no game actions even with a preview engine", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_LOCAL,
    controllerByColor: { black: "human", white: "human" },
    phase: "play",
    currentPlayer: "black",
    hasGame: false,
    started: false,
    undoAvailable: true,
  });

  assert.equal(session.hasGame, false);
  assert.equal(session.started, false);
  for (const capability of Object.values(session.capabilities)) {
    assert.equal(capability, false);
  }
  assert.deepEqual(
    routeMatchAction(session, "play", { row: 0, col: 0 }),
    { allowed: false, reason: "MATCH_ACTION_UNAVAILABLE" },
  );
  assert.deepEqual(
    routeMatchAction(session, "play", { row: 0, col: 0 }, { actor: "ai" }),
    { allowed: false, reason: "AI_ACTION_UNAVAILABLE" },
  );
});

test("an allocated online board remains actionless until the invitation is accepted", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "black",
    hasGame: true,
    started: false,
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
  });

  assert.equal(session.hasGame, true);
  assert.equal(session.started, false);
  for (const capability of Object.values(session.capabilities)) {
    assert.equal(capability, false);
  }
});

test("AI-controlled turns disable human play without changing transport", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "ai" },
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
  });
  assert.equal(session.transport, MATCH_TRANSPORT_ONLINE);
  assert.equal(session.capabilities.play, false);
  assert.equal(session.capabilities.resign, true);
});

test("finished local games and online hosts can start identical or configured next games", () => {
  const local = createMatchSession({
    transport: MATCH_TRANSPORT_LOCAL,
    controllerByColor: { black: MATCH_CONTROLLER_HUMAN, white: MATCH_CONTROLLER_AI },
    phase: "finished",
    currentPlayer: "black",
  });
  assert.equal(local.capabilities.new_game, true);
  assert.deepEqual(routeMatchAction(local, "new_game"), {
    allowed: true,
    target: MATCH_TRANSPORT_LOCAL,
    operation: "new_game",
    payload: {},
  });

  const onlineBase = {
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: MATCH_CONTROLLER_HUMAN, white: MATCH_CONTROLLER_AI },
    phase: "finished",
    currentPlayer: "black",
    connected: true,
    roomReady: true,
    bothSeats: true,
  };
  const host = createMatchSession({
    ...onlineBase,
    identity: { role: "player", color: "black" },
  });
  const white = createMatchSession({
    ...onlineBase,
    identity: { role: "player", color: "white" },
  });
  const spectator = createMatchSession({
    ...onlineBase,
    identity: { role: "spectator", color: null },
  });
  assert.equal(host.capabilities.new_game, true);
  assert.equal(white.capabilities.new_game, false);
  assert.equal(spectator.capabilities.new_game, false);
});

test("online AI undo routes directly while human online undo negotiates", () => {
  const base = {
    transport: MATCH_TRANSPORT_ONLINE,
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "black",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
  };
  const ai = createMatchSession({
    ...base,
    controllerByColor: { black: "human", white: "ai" },
  });
  const human = createMatchSession({
    ...base,
    controllerByColor: { black: "human", white: "human" },
  });
  const sameBrowserHumans = createMatchSession({
    ...base,
    controllerByColor: { black: "human", white: "human" },
    controllerOperatorByColor: { black: "host", white: "host" },
    identity: { id: "host", role: "player", color: "black" },
  });
  assert.equal(routeMatchAction(ai, "undo").command, "direct_undo_ai_round");
  assert.equal(routeMatchAction(human, "undo").command, "request_undo");
  assert.equal(
    routeMatchAction(sameBrowserHumans, "undo").command,
    "direct_undo_local_round",
  );
  assert.equal(isHumanOnlineMatch(ai), false);
  assert.equal(isHumanOnlineMatch(human), true);
  assert.equal(isSameBrowserHumanOnlineMatch(human), false);
  assert.equal(isSameBrowserHumanOnlineMatch(sameBrowserHumans), true);
});

test("AI actor uses the same play and pass actions with transport-specific adapters", () => {
  const base = {
    controllerByColor: { black: "human", white: "ai" },
    phase: "play",
    currentPlayer: "white",
  };
  const local = createMatchSession({ transport: MATCH_TRANSPORT_LOCAL, ...base });
  const online = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    identity: { role: "player", color: "black" },
    connected: true,
    roomReady: true,
    bothSeats: true,
    ...base,
  });
  assert.deepEqual(
    routeMatchAction(local, "play", { row: 2, col: 3 }, { actor: "ai" }),
    {
      allowed: true,
      target: MATCH_TRANSPORT_LOCAL,
      operation: "play",
      payload: { row: 2, col: 3 },
      actor: "ai",
    },
  );
  assert.equal(
    routeMatchAction(online, "play", {}, { actor: "ai" }).command,
    "ai_play",
  );
  assert.equal(
    routeMatchAction(online, "pass", {}, { actor: "ai" }).command,
    "ai_pass",
  );
  assert.equal(
    routeMatchAction(online, "undo", {}, { actor: "ai" }).allowed,
    false,
  );
});

test("spectators remain read-only while all sidebar features can remain visible", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "ai" },
    identity: { role: "spectator", color: null },
    phase: "play",
    currentPlayer: "black",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
  });
  for (const action of ["play", "pass", "undo", "resign", "new_game"]) {
    assert.equal(session.capabilities[action], false);
  }
});

test("an online black host may attach an empty seat or reconfigure an automated seat", () => {
  const base = {
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { role: "player", color: "black" },
    phase: "play",
    connected: true,
    roomReady: true,
    bothSeats: false,
  };
  const allowed = createMatchSession({
    ...base,
    whiteSeat: null,
    room: { players: [] },
  });
  const occupied = createMatchSession({
    ...base,
    whiteSeat: AI_WHITE,
    room: { players: [AI_WHITE] },
  });
  const humanWhite = { id: "white-player", role: "player", color: "white" };
  const humanOccupied = createMatchSession({
    ...base,
    whiteSeat: humanWhite,
    room: { players: [humanWhite] },
  });
  assert.equal(allowed.capabilities.attach_ai, true);
  assert.equal(occupied.capabilities.attach_ai, true);
  assert.equal(occupied.capabilities.detach_ai, true);
  assert.equal(humanOccupied.capabilities.attach_ai, false);
  assert.equal(humanOccupied.capabilities.detach_ai, false);
});

test("a pending negotiated undo keeps the opponent's play and pass available", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { role: "player", color: "white" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
    undoRequest: { requesterColor: "black" },
  });
  assert.equal(session.capabilities.play, true);
  assert.equal(session.capabilities.pass, true);
  assert.equal(session.capabilities.undo, false);
  assert.equal(session.capabilities.resign, true);
});

test("the requester must cancel their own pending undo before continuing", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { playerId: "white-player", role: "player", color: "white" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
    undoAvailable: true,
    undoRequest: { requesterId: "white-player", requesterColor: "white" },
  });
  assert.equal(session.capabilities.play, false);
  assert.equal(session.capabilities.pass, false);
  assert.equal(session.capabilities.undo, false);
  assert.equal(session.capabilities.resign, true);
});

test("a connected room stays read-only until this connection receives a fresh state", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "human" },
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "black",
    connected: true,
    roomReady: false,
    bothSeats: true,
    undoAvailable: true,
  });
  assert.equal(session.onlineReady, false);
  for (const action of ["play", "pass", "undo", "resign", "new_game"]) {
    assert.equal(session.capabilities[action], false);
  }
});

test("the browser controlling an online AI must not enter replay or analysis on its turn", () => {
  const session = createMatchSession({
    transport: MATCH_TRANSPORT_ONLINE,
    controllerByColor: { black: "human", white: "ai" },
    identity: { role: "player", color: "black" },
    phase: "play",
    currentPlayer: "white",
    connected: true,
    roomReady: true,
    bothSeats: true,
  });
  assert.equal(shouldProtectOnlineAITurn(session, true), true);
  assert.equal(shouldProtectOnlineAITurn(session, false), false);
  assert.equal(
    shouldProtectOnlineAITurn({ ...session, currentPlayer: "black" }, true),
    false,
  );
});

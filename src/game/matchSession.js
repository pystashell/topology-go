export const MATCH_TRANSPORT_LOCAL = "local";
export const MATCH_TRANSPORT_ONLINE = "online";

export const MATCH_CONTROLLER_HUMAN = "human";
export const MATCH_CONTROLLER_AI = "ai";

export const MATCH_ACTION_PLAY = "play";
export const MATCH_ACTION_PASS = "pass";
export const MATCH_ACTION_UNDO = "undo";
export const MATCH_ACTION_RESIGN = "resign";
export const MATCH_ACTION_NEW_GAME = "new_game";
export const MATCH_ACTION_TOGGLE_DEAD = "toggle_dead";
export const MATCH_ACTION_FINISH_SCORING = "finish_scoring";
export const MATCH_ACTION_RESUME_PLAY = "resume_play";

const COLORS = Object.freeze(["black", "white"]);
const ACTIONS = new Set([
  MATCH_ACTION_PLAY,
  MATCH_ACTION_PASS,
  MATCH_ACTION_UNDO,
  MATCH_ACTION_RESIGN,
  MATCH_ACTION_NEW_GAME,
  MATCH_ACTION_TOGGLE_DEAD,
  MATCH_ACTION_FINISH_SCORING,
  MATCH_ACTION_RESUME_PLAY,
]);

function controller(value) {
  return value === MATCH_CONTROLLER_AI
    ? MATCH_CONTROLLER_AI
    : MATCH_CONTROLLER_HUMAN;
}

export function isAutomatedSeat(seat) {
  return Boolean(
    seat &&
      (seat.automated === true || seat.role === "ai" || seat.controller === "ai"),
  );
}

export function automatedSeat(room, color = null) {
  const seats = Array.isArray(room?.players) ? room.players : [];
  return seats.find(
    (seat) => isAutomatedSeat(seat) && (color === null || seat.color === color),
  ) ?? null;
}

export function controllersFromRoom(room) {
  const controllers = { black: MATCH_CONTROLLER_HUMAN, white: MATCH_CONTROLLER_HUMAN };
  for (const color of COLORS) {
    if (automatedSeat(room, color)) controllers[color] = MATCH_CONTROLLER_AI;
  }
  return controllers;
}

export function createMatchSession(input = {}) {
  const transport = input.transport === MATCH_TRANSPORT_ONLINE
    ? MATCH_TRANSPORT_ONLINE
    : MATCH_TRANSPORT_LOCAL;
  const controllerByColor = {
    black: controller(input.controllerByColor?.black),
    white: controller(input.controllerByColor?.white),
  };
  const identity = input.identity && typeof input.identity === "object"
    ? { ...input.identity }
    : {};
  const phase = ["play", "scoring", "finished"].includes(input.phase)
    ? input.phase
    : "play";
  const currentPlayer = COLORS.includes(input.currentPlayer)
    ? input.currentPlayer
    : "black";
  const player = identity.role === "player" && COLORS.includes(identity.color);
  const onlineReady = transport === MATCH_TRANSPORT_ONLINE && Boolean(
    input.connected && input.roomReady && !input.busy && !input.commandPending,
  );
  const interactive = !input.replaying && !input.timedOut;
  const bothSeats = input.bothSeats !== false;
  const ownController = player ? controllerByColor[identity.color] : null;
  const opponentColor = identity.color === "black" ? "white" : "black";
  const opponentController = player ? controllerByColor[opponentColor] : null;
  const localHumanTurn = controllerByColor[currentPlayer] === MATCH_CONTROLLER_HUMAN;
  const onlineHumanTurn = player && identity.color === currentPlayer &&
    controllerByColor[currentPlayer] === MATCH_CONTROLLER_HUMAN;
  const actionReady = transport === MATCH_TRANSPORT_ONLINE ? onlineReady : true;
  const canActAsHuman = transport === MATCH_TRANSPORT_ONLINE
    ? onlineHumanTurn
    : localHumanTurn;
  const undoPending = Boolean(input.undoRequest);
  const undoAvailable = Boolean(input.undoAvailable) && !input.undoRequest;
  const localAiSelfPlay = transport === MATCH_TRANSPORT_LOCAL &&
    controllerByColor.black === MATCH_CONTROLLER_AI &&
    controllerByColor.white === MATCH_CONTROLLER_AI;

  const capabilities = {
    play: interactive && phase === "play" && bothSeats && actionReady && !undoPending &&
      canActAsHuman,
    pass: interactive && phase === "play" && bothSeats && actionReady && !undoPending &&
      canActAsHuman,
    undo: interactive && phase === "play" && bothSeats && actionReady && undoAvailable &&
      (transport === MATCH_TRANSPORT_LOCAL || player),
    resign: interactive && phase === "play" && bothSeats && actionReady &&
      (transport === MATCH_TRANSPORT_ONLINE ? player : !localAiSelfPlay),
    new_game: !input.replaying && !input.undoRequest && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && identity.color === "black")),
    toggle_dead: interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || player),
    finish_scoring: interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || player),
    resume_play: interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || player),
    attach_ai: transport === MATCH_TRANSPORT_ONLINE && onlineReady && player &&
      identity.color === "black" && phase === "play" &&
      (!input.whiteSeat || Boolean(automatedSeat(input.room, "white"))),
    detach_ai: transport === MATCH_TRANSPORT_ONLINE && onlineReady && player &&
      identity.color === "black" && Boolean(automatedSeat(input.room, "white")),
  };

  return {
    transport,
    controllerByColor,
    identity,
    phase,
    currentPlayer,
    player,
    onlineReady,
    bothSeats,
    ownController,
    opponentController,
    capabilities,
  };
}

export function shouldProtectOnlineAITurn(session, controlsAI = false) {
  return Boolean(
    controlsAI &&
      session?.transport === MATCH_TRANSPORT_ONLINE &&
      session.phase === "play" &&
      session.controllerByColor?.[session.currentPlayer] === MATCH_CONTROLLER_AI,
  );
}

export function isHumanOnlineMatch(session) {
  return Boolean(
    session?.transport === MATCH_TRANSPORT_ONLINE &&
      session.controllerByColor?.black === MATCH_CONTROLLER_HUMAN &&
      session.controllerByColor?.white === MATCH_CONTROLLER_HUMAN,
  );
}

export function routeMatchAction(session, action, payload = {}, options = {}) {
  if (!session || !ACTIONS.has(action)) {
    return { allowed: false, reason: "UNKNOWN_MATCH_ACTION" };
  }
  const actor = options.actor === MATCH_CONTROLLER_AI
    ? MATCH_CONTROLLER_AI
    : MATCH_CONTROLLER_HUMAN;
  if (actor === MATCH_CONTROLLER_AI) {
    if (
      ![MATCH_ACTION_PLAY, MATCH_ACTION_PASS].includes(action) ||
      session.phase !== "play" ||
      session.controllerByColor?.[session.currentPlayer] !== MATCH_CONTROLLER_AI
    ) {
      return { allowed: false, reason: "AI_ACTION_UNAVAILABLE" };
    }
    return session.transport === MATCH_TRANSPORT_ONLINE
      ? {
          allowed: true,
          target: MATCH_TRANSPORT_ONLINE,
          command: action === MATCH_ACTION_PASS ? "ai_pass" : "ai_play",
          payload,
          actor,
        }
      : {
          allowed: true,
          target: MATCH_TRANSPORT_LOCAL,
          operation: action,
          payload,
          actor,
        };
  }
  if (!session.capabilities?.[action]) {
    return { allowed: false, reason: "MATCH_ACTION_UNAVAILABLE" };
  }
  if (session.transport === MATCH_TRANSPORT_LOCAL) {
    return { allowed: true, target: MATCH_TRANSPORT_LOCAL, operation: action, payload };
  }

  if (action === MATCH_ACTION_UNDO) {
    return session.opponentController === MATCH_CONTROLLER_AI
      ? {
          allowed: true,
          target: MATCH_TRANSPORT_ONLINE,
          command: "direct_undo_ai_round",
          payload,
        }
      : {
          allowed: true,
          target: MATCH_TRANSPORT_ONLINE,
          command: "request_undo",
          payload,
        };
  }
  return {
    allowed: true,
    target: MATCH_TRANSPORT_ONLINE,
    command: action,
    payload,
  };
}

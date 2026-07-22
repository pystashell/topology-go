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
    const declared = room?.match?.controllers?.[color];
    if (declared?.kind === MATCH_CONTROLLER_AI) {
      controllers[color] = MATCH_CONTROLLER_AI;
    } else if (declared?.kind === MATCH_CONTROLLER_HUMAN) {
      controllers[color] = MATCH_CONTROLLER_HUMAN;
    } else if (automatedSeat(room, color)) {
      controllers[color] = MATCH_CONTROLLER_AI;
    }
  }
  return controllers;
}

export function controllerOperatorsFromRoom(room) {
  const operators = { black: null, white: null };
  for (const color of COLORS) {
    const declared = room?.match?.controllers?.[color];
    if (typeof declared?.operatorId === "string" && declared.operatorId) {
      operators[color] = declared.operatorId;
      continue;
    }
    const seat = Array.isArray(room?.players)
      ? room.players.find((candidate) => candidate?.color === color)
      : null;
    operators[color] = seat?.controllerId ?? seat?.id ?? null;
  }
  return operators;
}

export function createMatchSession(input = {}) {
  const transport = input.transport === MATCH_TRANSPORT_ONLINE
    ? MATCH_TRANSPORT_ONLINE
    : MATCH_TRANSPORT_LOCAL;
  const controllerByColor = {
    black: controller(input.controllerByColor?.black),
    white: controller(input.controllerByColor?.white),
  };
  const controllerOperatorByColor = {
    black: typeof input.controllerOperatorByColor?.black === "string"
      ? input.controllerOperatorByColor.black
      : null,
    white: typeof input.controllerOperatorByColor?.white === "string"
      ? input.controllerOperatorByColor.white
      : null,
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
  const hasGame = input.hasGame !== false;
  const started = hasGame && input.started !== false;
  const player = identity.role === "player" && COLORS.includes(identity.color);
  const identityId = identity.playerId ?? identity.id ?? null;
  const controlledColors = transport === MATCH_TRANSPORT_ONLINE
    ? COLORS.filter((color) =>
        controllerOperatorByColor[color]
          ? controllerOperatorByColor[color] === identityId
          : player && identity.color === color
      )
    : [...COLORS];
  const onlineReady = transport === MATCH_TRANSPORT_ONLINE && Boolean(
    input.connected && input.roomReady && !input.busy && !input.commandPending,
  );
  const interactive = !input.replaying && !input.timedOut;
  const bothSeats = input.bothSeats !== false;
  const primaryControlledColor = controlledColors.includes(identity.color)
    ? identity.color
    : controlledColors[0] ?? null;
  const ownController = primaryControlledColor
    ? controllerByColor[primaryControlledColor]
    : null;
  const opponentColor = primaryControlledColor === "black" ? "white" : "black";
  const opponentController = primaryControlledColor
    ? controllerByColor[opponentColor]
    : null;
  const localHumanTurn = controllerByColor[currentPlayer] === MATCH_CONTROLLER_HUMAN;
  const onlineHumanTurn = player && controlledColors.includes(currentPlayer) &&
    controllerByColor[currentPlayer] === MATCH_CONTROLLER_HUMAN;
  const actionReady = transport === MATCH_TRANSPORT_ONLINE ? onlineReady : true;
  const canActAsHuman = transport === MATCH_TRANSPORT_ONLINE
    ? onlineHumanTurn
    : localHumanTurn;
  const ownUndoPending = Boolean(
    input.undoRequest &&
    (
      input.undoRequest.requesterId === identityId ||
      (!input.undoRequest.requesterId && input.undoRequest.requesterColor === identity.color)
    ),
  );
  const undoAvailable = Boolean(input.undoAvailable) && !input.undoRequest;
  const localAiSelfPlay = transport === MATCH_TRANSPORT_LOCAL &&
    controllerByColor.black === MATCH_CONTROLLER_AI &&
    controllerByColor.white === MATCH_CONTROLLER_AI;

  const capabilities = {
    // A negotiated undo is intentionally non-blocking. The player whose turn
    // it is may continue normally; the authoritative room then treats that
    // legal move (or pass) as an implicit decline of the pending request.
    play: started && interactive && phase === "play" && bothSeats && actionReady && !ownUndoPending &&
      canActAsHuman,
    pass: started && interactive && phase === "play" && bothSeats && actionReady && !ownUndoPending &&
      canActAsHuman,
    undo: started && interactive && phase === "play" && bothSeats && actionReady && undoAvailable &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && controlledColors.length > 0)),
    resign: started && interactive && phase === "play" && bothSeats && actionReady &&
      (transport === MATCH_TRANSPORT_ONLINE
        ? player && controlledColors.length > 0
        : !localAiSelfPlay),
    new_game: started && !input.replaying && !input.undoRequest && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && identity.color === "black")),
    toggle_dead: started && interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && controlledColors.length > 0)),
    finish_scoring: started && interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && controlledColors.length > 0)),
    resume_play: started && interactive && phase === "scoring" && actionReady &&
      (transport === MATCH_TRANSPORT_LOCAL || (player && controlledColors.length > 0)),
    attach_ai: started && transport === MATCH_TRANSPORT_ONLINE && onlineReady && player &&
      identity.color === "black" && phase === "play" &&
      (!input.whiteSeat || Boolean(automatedSeat(input.room, "white"))),
    detach_ai: started && transport === MATCH_TRANSPORT_ONLINE && onlineReady && player &&
      identity.color === "black" && Boolean(automatedSeat(input.room, "white")),
  };

  return {
    transport,
    controllerByColor,
    controllerOperatorByColor,
    controlledColors,
    identity,
    hasGame,
    started,
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
      session?.started !== false &&
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

export function isSameBrowserHumanOnlineMatch(session) {
  const blackOperator = session?.controllerOperatorByColor?.black;
  const whiteOperator = session?.controllerOperatorByColor?.white;
  return Boolean(
    isHumanOnlineMatch(session) &&
      typeof blackOperator === "string" &&
      blackOperator.length > 0 &&
      blackOperator === whiteOperator &&
      session.controlledColors?.includes("black") &&
      session.controlledColors?.includes("white"),
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
      session.started === false ||
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
    if (isSameBrowserHumanOnlineMatch(session)) {
      return {
        allowed: true,
        target: MATCH_TRANSPORT_ONLINE,
        command: "direct_undo_local_round",
        payload,
      };
    }
    return {
      allowed: true,
      target: MATCH_TRANSPORT_ONLINE,
      command: session.opponentController === MATCH_CONTROLLER_AI
        ? "direct_undo_ai_round"
        : "request_undo",
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

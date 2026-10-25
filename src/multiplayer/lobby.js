import {
  GAME_GO,
  GAME_GOMOKU,
  GOMOKU_RULE_SETS,
  isGameType,
} from "../game/gameTypes.js";
import { aiSeatName } from "../ai/modelCatalog.js";
import {
  encodeLobbyBoardPreview,
  isLobbyBoardPreview,
  isLobbyLastMove,
  publicLobbyLastMove,
} from "./lobbyPreview.js";

export const LOBBY_STATUS_SETUP = "setup";
export const LOBBY_STATUS_INVITED = "invited";
export const LOBBY_STATUS_PLAYING = "playing";
export const LOBBY_STATUS_FINISHED = "finished";

export const LOBBY_MATCH_MODES = Object.freeze([
  "friend",
  "human-ai",
  "ai-ai",
  "local",
]);

export const MAX_LOBBY_ROOMS = 500;

const VALID_STATUSES = new Set([
  LOBBY_STATUS_SETUP,
  LOBBY_STATUS_INVITED,
  LOBBY_STATUS_PLAYING,
  LOBBY_STATUS_FINISHED,
]);
const VALID_MODES = new Set(LOBBY_MATCH_MODES);
const VALID_TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);

/** The game of a lobby summary or room settings; absent means Go. */
export function lobbyRoomGameType(value) {
  return isGameType(value?.gameType) ? value.gameType : GAME_GO;
}

/**
 * Game fields of a summary. Go summaries keep their original shape (no
 * gameType, with komi and scoring rule); other games name their game and
 * rule set instead.
 */
function lobbyGameFields(publicGame) {
  const gameType = lobbyRoomGameType(publicGame);
  if (gameType === GAME_GO) {
    return {
      scoringRule: publicGame?.scoringRule === "japanese" ? "japanese" : "chinese",
      komi: Number.isFinite(publicGame?.komi) ? publicGame.komi : 7.5,
    };
  }
  return {
    gameType,
    ...(gameType === GAME_GOMOKU && GOMOKU_RULE_SETS.includes(publicGame?.ruleSet)
      ? { ruleSet: publicGame.ruleSet }
      : {}),
  };
}

function finiteTimestamp(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function publicPlayer(player) {
  return {
    name: String(player?.name ?? "").slice(0, 20),
    color: player?.color === "white" ? "white" : "black",
    controller: player?.controller === "ai" || player?.automated === true || player?.role === "ai"
      ? "ai"
      : player?.controller === "local"
        ? "local"
        : "human",
    online: player?.online !== false,
  };
}

function humanRoomPlayer(room, operatorId) {
  const players = room?.players ?? [];
  return typeof operatorId === "string" && operatorId
    ? players.find((player) =>
        player?.id === operatorId &&
        player?.automated !== true &&
        player?.role !== "ai"
      ) ?? null
    : null;
}

function controllerPlayer(room, color, value, mode) {
  if (!value || (value.kind !== "human" && value.kind !== "ai")) return null;
  const operator = humanRoomPlayer(room, value.operatorId);
  if (value.kind === "ai") {
    const modelId = typeof value.modelId === "string" && value.modelId
      ? value.modelId.slice(0, 16)
      : "b10";
    return {
      // "KataGo b10 AI", "Rapfi AI", "拓扑黑白棋 AI" (translated by the page).
      name: aiSeatName(modelId),
      color,
      controller: "ai",
      online: operator?.online === true,
    };
  }
  if (!operator) return null;
  return {
    name: String(operator.name ?? "").slice(0, 20),
    color,
    controller: mode === "local" ? "local" : "human",
    online: operator.online !== false,
  };
}

function matchControllers(match, status) {
  if (
    status === LOBBY_STATUS_INVITED &&
    match?.request?.controllers &&
    typeof match.request.controllers === "object"
  ) {
    return match.request.controllers;
  }
  return match?.controllers && typeof match.controllers === "object"
    ? match.controllers
    : null;
}

function playersFromControllers(room, controllers, mode) {
  if (!controllers) return null;
  return ["black", "white"]
    .map((color) => controllerPlayer(room, color, controllers[color], mode))
    .filter(Boolean);
}

function hasWhiteSeatOccupant(room, controllers) {
  const white = controllers?.white;
  return Boolean(
    (room?.players ?? []).some((player) => player?.color === "white") ||
    white?.kind === "ai" ||
    (typeof white?.operatorId === "string" && white.operatorId.length > 0),
  );
}

function hasBlackHumanHost(room, controllers) {
  const blackController = controllers?.black;
  if (blackController && blackController.kind !== "human") return false;
  const operator = humanRoomPlayer(room, blackController?.operatorId);
  if (operator) return operator.color === "black";
  return (room?.players ?? []).some((player) =>
    player?.color === "black" &&
    player?.automated !== true &&
    player?.role !== "ai"
  );
}

function blackHostOnline(room, controllers) {
  const operator = humanRoomPlayer(room, controllers?.black?.operatorId);
  const host = operator ?? (room?.players ?? []).find((player) =>
    player?.color === "black" &&
    player?.automated !== true &&
    player?.role !== "ai"
  );
  return host?.online === true;
}

function anyoneOnline(room) {
  return [...(room?.players ?? []), ...(room?.spectators ?? [])].some((member) =>
    member?.online === true &&
    member?.automated !== true &&
    member?.role !== "ai"
  );
}

function hasBlackSeatOccupant(room, controllers) {
  const black = controllers?.black;
  return Boolean(
    (room?.players ?? []).some((player) => player?.color === "black") ||
    black?.kind === "ai" ||
    (typeof black?.operatorId === "string" && black.operatorId.length > 0),
  );
}

function fallbackStatus(room) {
  if (room?.game?.phase === "finished" || room?.timeControl?.outcome) {
    return LOBBY_STATUS_FINISHED;
  }
  const colors = new Set((room?.players ?? []).map((player) => player?.color));
  return colors.has("black") && colors.has("white")
    ? LOBBY_STATUS_PLAYING
    : LOBBY_STATUS_SETUP;
}

function fallbackMode(room) {
  const players = room?.players ?? [];
  const automated = players.filter((player) =>
    player?.automated === true || player?.role === "ai" || player?.controller === "ai"
  );
  if (automated.length >= 2) return "ai-ai";
  if (automated.length === 1) return "human-ai";
  return "friend";
}

export function lobbySummaryFromRoom(room, now = Date.now()) {
  if (
    !room ||
    typeof room !== "object" ||
    typeof room.code !== "string" ||
    !room.game ||
    typeof room.game !== "object" ||
    !Array.isArray(room.players)
  ) {
    throw new TypeError("A public room snapshot is required.");
  }
  const match = room.match && typeof room.match === "object" ? room.match : {};
  const status = VALID_STATUSES.has(match.status)
    ? match.status
    : fallbackStatus(room);
  const requestedMode = status === LOBBY_STATUS_INVITED
    ? match.request?.mode
    : null;
  const mode = VALID_MODES.has(requestedMode)
    ? requestedMode
    : VALID_MODES.has(match.mode)
      ? match.mode
      : fallbackMode(room);
  const controllers = matchControllers(match, status);
  const requestedSettings = status === LOBBY_STATUS_INVITED &&
      match.request?.settings &&
      typeof match.request.settings === "object"
    ? match.request.settings
    : null;
  const publicGame = requestedSettings ?? room.game;
  const width = Number.isInteger(publicGame?.width)
    ? publicGame.width
    : Number.isInteger(publicGame?.size)
      ? publicGame.size
      : 19;
  const height = Number.isInteger(publicGame?.height)
    ? publicGame.height
    : Number.isInteger(publicGame?.size)
      ? publicGame.size
      : 19;
  const players = playersFromControllers(room, controllers, mode) ??
    (room.players ?? []).slice(0, 2).map(publicPlayer);
  const whiteSeatOccupied = hasWhiteSeatOccupant(room, controllers);
  const blackHostPresent = hasBlackHumanHost(room, controllers);
  const updatedAt = finiteTimestamp(room.updatedAt, now);
  const emptyBoard = () => Array.from({ length: height }, () => Array(width).fill(null));
  const board = requestedSettings || room.game.board === undefined
    ? emptyBoard()
    : room.game.board;
  const boardPreview = encodeLobbyBoardPreview(board, width, height);
  const lastMove = requestedSettings
    ? null
    : publicLobbyLastMove(room.game.lastMove, width, height);
  const timed = requestedSettings
    ? [
        requestedSettings.mainTimeSeconds,
        requestedSettings.byoYomiPeriods,
        requestedSettings.byoYomiSeconds,
      ].some((value) => Number.isFinite(value) && value > 0)
    : Boolean(room.timeControl);

  return {
    code: room.code,
    revision: Number.isSafeInteger(room.revision) && room.revision >= 1
      ? room.revision
      : 1,
    ...(Number.isSafeInteger(room.directoryRevision) && room.directoryRevision >= 1
      ? { directoryRevision: room.directoryRevision }
      : {}),
    ...(typeof room.incarnationId === "string" && room.incarnationId.length > 0
      ? { incarnationId: room.incarnationId }
      : {}),
    status,
    mode,
    roundNumber: Number.isSafeInteger(match.roundId)
      ? match.roundId
      : Number.isSafeInteger(match.roundNumber)
      ? match.roundNumber
        : Number.isSafeInteger(room.roundNumber)
          ? room.roundNumber
          : status === LOBBY_STATUS_SETUP ? 0 : 1,
    width,
    height,
    topology: ["cylinder", "torus", "mobius"].includes(publicGame?.topology)
      ? publicGame.topology
      : "cylinder",
    ...lobbyGameFields(publicGame),
    timed,
    moveCount: requestedSettings
      ? 0
      : Number.isSafeInteger(room.moveCount) ? room.moveCount : 0,
    boardPreview,
    lastMove,
    players,
    spectatorCount: (room.spectators ?? []).filter((spectator) => spectator?.online !== false).length,
    // The room arbitrates concurrent claims atomically. A released white seat
    // can be filled during an older round; a hostless setup can take a new black
    // player after its previous operator explicitly leaves. Only advertise a
    // seat someone is actually there to play with: an offline host (such as a
    // create that never connected) or an empty room is not joinable.
    joinable: mode === "friend" && (
      (blackHostPresent && blackHostOnline(room, controllers) && !whiteSeatOccupied) ||
      (status === LOBBY_STATUS_SETUP && !hasBlackSeatOccupant(room, controllers) &&
        anyoneOnline(room))
    ),
    watchable: true,
    createdAt: finiteTimestamp(room.createdAt, updatedAt),
    updatedAt,
    startedAt: finiteTimestamp(match.startedAt, null),
    finishedAt: finiteTimestamp(match.finishedAt, null),
    // The room owns its lifecycle. The lobby only mirrors the room-provided
    // expiry and must not invent a second retention window of its own.
    expiresAt: finiteTimestamp(room.expiresAt, updatedAt),
  };
}

export function isLobbySummary(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    (value.directoryRevision === undefined ||
      (Number.isSafeInteger(value.directoryRevision) && value.directoryRevision >= 1)) &&
    (value.incarnationId === undefined ||
      (typeof value.incarnationId === "string" &&
        value.incarnationId.length > 0 && value.incarnationId.length <= 128)) &&
    VALID_STATUSES.has(value.status) &&
    VALID_MODES.has(value.mode) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    VALID_TOPOLOGIES.has(value.topology) &&
    // Summaries without a game predate other games and are Go.
    (value.gameType === undefined || isGameType(value.gameType)) &&
    (value.ruleSet === undefined ||
      (value.gameType === GAME_GOMOKU && GOMOKU_RULE_SETS.includes(value.ruleSet))) &&
    isLobbyBoardPreview(value.boardPreview, value.width, value.height) &&
    isLobbyLastMove(value.lastMove, value.width, value.height) &&
    Number.isFinite(value.updatedAt),
  );
}

/** Orders the lobby offers: rooms waiting for players first (the default). */
export const LOBBY_SORT_ORDERS = Object.freeze(["recommended", "newest", "watchers", "moves"]);

/** Square sizes the size filter names; "custom" is every other shape. */
export const LOBBY_LISTED_SIZES = Object.freeze([8, 9, 11, 13, 15, 19]);

/**
 * Sort summaries. "recommended" puts open invitations and rooms in setup
 * first, then games in progress, then finished ones (newest activity first
 * within each); "newest" sorts by creation; "watchers" and "moves" by
 * spectators and moves played. Ties fall back to recent activity, then code.
 */
export function sortLobbyRooms(rooms, order = "recommended") {
  const priority = {
    [LOBBY_STATUS_INVITED]: 0,
    [LOBBY_STATUS_SETUP]: 1,
    [LOBBY_STATUS_PLAYING]: 2,
    [LOBBY_STATUS_FINISHED]: 3,
  };
  const primary = {
    newest: (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
    watchers: (left, right) => (right.spectatorCount ?? 0) - (left.spectatorCount ?? 0),
    moves: (left, right) => (right.moveCount ?? 0) - (left.moveCount ?? 0),
  }[order] ?? ((left, right) => (priority[left.status] ?? 9) - (priority[right.status] ?? 9));
  return [...rooms].sort((left, right) =>
    primary(left, right) ||
    right.updatedAt - left.updatedAt ||
    left.code.localeCompare(right.code)
  );
}

export function pruneLobbyRooms(rooms, now = Date.now()) {
  return sortLobbyRooms(
    rooms.filter((room) =>
      isLobbySummary(room) &&
      room.expiresAt > now
    ),
  ).slice(0, MAX_LOBBY_ROOMS);
}

/** Whether a summary matches a search for a room code or a player's name. */
export function lobbyRoomMatchesQuery(room, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  if (!needle) return true;
  if (room.code.toLocaleLowerCase().includes(needle)) return true;
  return (room.players ?? []).some((player) =>
    String(player?.name ?? "").toLocaleLowerCase().includes(needle));
}

/**
 * Filter (status, game, topology, size, mode and a search query) and sort
 * (filters.order) lobby summaries.
 */
export function filterLobbyRooms(rooms, filters = {}) {
  return sortLobbyRooms(rooms.filter((room) => {
    if (!lobbyRoomMatchesQuery(room, filters.query)) return false;
    if (filters.status === "joinable" && room.joinable !== true) return false;
    if (
      filters.status &&
      !["all", "joinable"].includes(filters.status) &&
      room.status !== filters.status
    ) return false;
    if (filters.game && filters.game !== "all" && lobbyRoomGameType(room) !== filters.game) return false;
    if (filters.topology && filters.topology !== "all" && room.topology !== filters.topology) return false;
    if (filters.mode && filters.mode !== "all" && room.mode !== filters.mode) return false;
    if (filters.size && filters.size !== "all") {
      if (filters.size === "custom") {
        if (LOBBY_LISTED_SIZES.includes(room.width) && room.width === room.height) return false;
      } else {
        const size = Number(filters.size);
        if (room.width !== size || room.height !== size) return false;
      }
    }
    return true;
  }), filters.order);
}

/**
 * Counts for the lobby's summary line and status buttons: rooms by status,
 * joinable seats, spectators watching, and players online in the rooms.
 */
export function lobbyStats(rooms) {
  const stats = {
    total: 0, joinable: 0, waiting: 0, playing: 0, finished: 0, spectators: 0, playersOnline: 0,
  };
  for (const room of rooms) {
    stats.total += 1;
    if (room.joinable === true) stats.joinable += 1;
    if (room.status === LOBBY_STATUS_PLAYING) stats.playing += 1;
    else if (room.status === LOBBY_STATUS_FINISHED) stats.finished += 1;
    else stats.waiting += 1;
    stats.spectators += Number.isSafeInteger(room.spectatorCount) ? room.spectatorCount : 0;
    stats.playersOnline += (room.players ?? []).filter((player) =>
      player?.online === true && player?.controller !== "ai").length;
  }
  return stats;
}

/**
 * The room "Quick join" takes: a joinable room that passes the other
 * filters (status aside), preferring a room still in setup or invitation
 * over one whose game is already running, then the most recent activity.
 * Rooms this browser already holds a seat in are skipped.
 *
 * @returns {object|null}
 */
export function pickQuickJoinRoom(rooms, filters = {}, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  const candidates = filterLobbyRooms(
    rooms.filter((room) => room.joinable === true && !skip.has(room.code)),
    { ...filters, status: "all", order: "recommended" },
  );
  return candidates[0] ?? null;
}

/**
 * This browser's rooms for the "My rooms" list: each stored seat or
 * spectator session with the room's public summary when the lobby lists it
 * (null for an unlisted, finished-and-expired or not yet indexed room).
 * One entry per room; a seat is preferred over a spectator session.
 */
export function myLobbyRooms(sessions, rooms) {
  const summaries = new Map(rooms.map((room) => [room.code, room]));
  const byCode = new Map();
  for (const session of sessions) {
    if (!session || typeof session.code !== "string") continue;
    const known = byCode.get(session.code);
    if (known && known.role === "player") continue;
    byCode.set(session.code, {
      code: session.code,
      role: session.role === "player" ? "player" : "spectator",
      color: session.color === "black" || session.color === "white" ? session.color : null,
      playerName: typeof session.playerName === "string" ? session.playerName : "",
      summary: summaries.get(session.code) ?? null,
    });
  }
  return [...byCode.values()].sort((left, right) =>
    (right.summary?.updatedAt ?? 0) - (left.summary?.updatedAt ?? 0) ||
    left.code.localeCompare(right.code));
}

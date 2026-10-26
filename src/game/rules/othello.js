import {
  BOARD_LIMITS,
  GAME_OTHELLO,
  GameSettingsError,
  MATCH_MODES,
  SGF_GAME_CODES,
  isValidBoardDimension,
  readonlySet,
} from "../gameTypes.js";
import { OthelloEngine } from "../othelloEngine.js";
import { othelloFlipDistances } from "../othelloFlipOrder.js";
import { TOPOLOGY_KINDS } from "../../topology/index.js";
import { NON_GO_ROOM_ACTIONS } from "./shared.js";

/**
 * Othello adapter for the GameRules interface. Boards are rectangular with
 * even sides from 4 to 30 on every topology; passes are automatic, so the
 * game has no pass action, and there is no scoring phase.
 */

const LIMITS = BOARD_LIMITS[GAME_OTHELLO];

const DEFAULTS = Object.freeze({
  width: LIMITS.defaultWidth,
  height: LIMITS.defaultHeight,
  topology: "cylinder",
});

function normalizeDimension(value, field) {
  if (!isValidBoardDimension(GAME_OTHELLO, value)) {
    throw new GameSettingsError(
      `Othello board ${field} must be an even integer from ${LIMITS.min} to ${LIMITS.max}`,
      field,
    );
  }
  return value;
}

/**
 * Normalize requested Othello settings, falling back to the previous game's
 * settings and then to the defaults. Board sides are taken from `previous`
 * only when it is an Othello game or Othello settings (another game's sides
 * rarely suit Othello); its topology is kept whatever the game.
 *
 * @param {object} [raw]
 * @param {object|null} [previous] An engine or settings object.
 * @returns {{gameType: 'othello', width: number, height: number,
 *   size?: number, topology: string}}
 */
function normalizeSettings(raw = {}, previous = null) {
  const requested = raw ?? {};
  if (requested.gameType !== undefined && requested.gameType !== GAME_OTHELLO) {
    throw new GameSettingsError(
      `Othello rules cannot normalize ${requested.gameType} settings`,
      "gameType",
    );
  }
  const prior = previous?.gameType === GAME_OTHELLO ? previous : null;
  const width = normalizeDimension(
    requested.width ?? requested.size ?? prior?.width ?? prior?.size ?? DEFAULTS.width,
    "width",
  );
  const height = normalizeDimension(
    requested.height ?? requested.size ?? prior?.height ?? prior?.size ?? DEFAULTS.height,
    "height",
  );
  const topology = requested.topology ?? previous?.topology ?? DEFAULTS.topology;
  if (!TOPOLOGY_KINDS.includes(topology)) {
    throw new GameSettingsError(`Unknown board topology: ${topology}`, "topology");
  }
  return {
    gameType: GAME_OTHELLO,
    width,
    height,
    ...(width === height ? { size: width } : {}),
    topology,
  };
}

/**
 * A new game at the canonical start position.
 *
 * @param {object} [settings] Raw or normalized settings.
 * @returns {OthelloEngine}
 */
function create(settings = {}) {
  const { width, height, topology } = normalizeSettings(settings);
  return new OthelloEngine({ width, height, topology });
}

/**
 * Restore a fully validated game from exportState() output or its JSON by
 * replaying it from the canonical start.
 *
 * @returns {OthelloEngine}
 */
function fromState(state) {
  return OthelloEngine.fromState(state);
}

/**
 * Render-only engine from a public getState() snapshot (an online room
 * message); nothing is replay-validated.
 *
 * @returns {OthelloEngine}
 */
function hydratePublic(state) {
  return OthelloEngine.fromPublicState(state);
}

/**
 * Round settings describing a game and its clock.
 *
 * @param {OthelloEngine} engine
 * @param {{mainTimeSeconds?: number, byoYomiPeriods?: number,
 *   byoYomiSeconds?: number}|null} [clock]
 */
function settingsFromGame(engine, clock = null) {
  return {
    gameType: GAME_OTHELLO,
    width: engine.width,
    height: engine.height,
    ...(engine.width === engine.height ? { size: engine.width } : {}),
    topology: engine.topology,
    mainTimeSeconds: clock?.mainTimeSeconds ?? 0,
    byoYomiPeriods: clock?.byoYomiPeriods ?? 0,
    byoYomiSeconds: clock?.byoYomiSeconds ?? 0,
  };
}

/**
 * Engine-derived input for the room's position token. The room adds its own
 * fields (epoch, round, controllers, seats) before hashing. eventCount
 * distinguishes positions that repeat the board, such as a resignation.
 *
 * @param {OthelloEngine} engine
 * @param {object} [_roomState]
 */
function positionFingerprint(engine, _roomState) {
  const state = engine.getState();
  return {
    gameType: GAME_OTHELLO,
    width: state.width,
    height: state.height,
    topology: state.topology,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    board: state.board,
    lastMove: state.lastMove,
    eventCount: engine.replay.events.length,
  };
}

/**
 * Board markers: `legal` lists the points the side to move may play (empty
 * when hints are off or the game is over) and `flipped` the discs the last
 * move turned over, each with its distance from the new disc (the page turns
 * them over ring by ring) and `flipOrigin` the new disc.
 *
 * @param {OthelloEngine} engine
 * @param {{hints?: boolean}} [options]
 * @returns {{legal: Array<{row: number, col: number}>,
 *   flipped: Array<{row: number, col: number, distance: number}>,
 *   flipOrigin: {row: number, col: number}|null}}
 */
function viewMarkers(engine, { hints = true } = {}) {
  const move = engine.lastMove?.type === "play" ? engine.lastMove : null;
  return {
    legal: hints ? engine.legalMoves() : [],
    flipped: move
      ? othelloFlipDistances({
          width: engine.width,
          height: engine.height,
          topology: engine.topology,
          board: engine.board,
          move,
          flipped: move.flipped,
        })
      : [],
    flipOrigin: move ? { row: move.row, col: move.col } : null,
  };
}

/** @type {import("./index.js").GameRules} */
export const othelloRules = Object.freeze({
  id: GAME_OTHELLO,
  sgfCode: SGF_GAME_CODES[GAME_OTHELLO],
  defaults: DEFAULTS,
  limits: LIMITS,
  capabilities: Object.freeze({
    pass: false,
    scoring: false,
    undo: true,
    resign: true,
    ai: true,
    analysis: false,
    sgf: true,
  }),
  roomActions: readonlySet(NON_GO_ROOM_ACTIONS),
  // AI rounds run the game's own engine in the host browser (see
  // src/ai/gameAiRegistry.js); the room only validates and syncs its moves.
  matchModes: Object.freeze([
    MATCH_MODES.FRIEND,
    MATCH_MODES.HUMAN_AI,
    MATCH_MODES.AI_AI,
    MATCH_MODES.LOCAL,
  ]),
  normalizeSettings,
  create,
  fromState,
  hydratePublic,
  settingsFromGame,
  positionFingerprint,
  viewMarkers,
});

export default othelloRules;

import { TOPOLOGY_KINDS } from "../../topology/index.js";
import {
  BOARD_LIMITS,
  GAME_GOMOKU,
  GOMOKU_FREESTYLE,
  GOMOKU_RENJU,
  GOMOKU_RULE_SETS,
  GameSettingsError,
  MATCH_MODES,
  SGF_GAME_CODES,
  readonlySet,
} from "../gameTypes.js";
import { BLACK, PHASE_PLAY } from "../goEngine.js";
import { GomokuEngine } from "../gomokuEngine.js";
import { NON_GO_ROOM_ACTIONS } from "./shared.js";

/**
 * Gomoku (freestyle and Renju) for the GameRules interface. Settings carry
 * their gameType so a settings object, like a state, names its game.
 */

const LIMITS = BOARD_LIMITS[GAME_GOMOKU];

const DEFAULTS = Object.freeze({
  width: LIMITS.defaultWidth,
  height: LIMITS.defaultHeight,
  topology: "cylinder",
  ruleSet: GOMOKU_FREESTYLE,
});

function normalizeDimension(value, field) {
  if (Number.isInteger(value) && value < LIMITS.min) {
    throw new GameSettingsError(
      `Gomoku boards need at least ${LIMITS.min} lines per side (board ${field} ${value} is too small)`,
      field,
    );
  }
  if (!Number.isInteger(value) || value > LIMITS.max) {
    throw new GameSettingsError(
      `Gomoku board ${field} must be an integer from ${LIMITS.min} to ${LIMITS.max}`,
      field,
    );
  }
  return value;
}

/**
 * Validate requested Gomoku settings, falling back to the previous Gomoku
 * game's settings and then to the defaults. A previous game of another type
 * (anything without gameType "gomoku") is ignored, so switching games starts
 * from Gomoku's own defaults.
 *
 * @param {object} [raw]
 * @param {object|null} [previous] An engine, state or settings object.
 * @returns {{gameType: 'gomoku', ruleSet: string, width: number,
 *   height: number, size?: number, topology: string}}
 */
function normalizeSettings(raw = {}, previous = null) {
  const request = raw ?? {};
  if (request.gameType !== undefined && request.gameType !== GAME_GOMOKU) {
    throw new GameSettingsError(
      `Gomoku settings cannot describe a ${request.gameType} game`,
      "gameType",
    );
  }
  const prior = previous?.gameType === GAME_GOMOKU ? previous : null;
  const width = normalizeDimension(
    request.width ?? request.size ?? prior?.width ?? prior?.size ?? DEFAULTS.width,
    "width",
  );
  const height = normalizeDimension(
    request.height ?? request.size ?? prior?.height ?? prior?.size ?? DEFAULTS.height,
    "height",
  );
  const topology = request.topology ?? prior?.topology ?? DEFAULTS.topology;
  if (!TOPOLOGY_KINDS.includes(topology)) {
    throw new GameSettingsError(`Unknown board topology: ${topology}`, "topology");
  }
  const ruleSet = request.ruleSet ?? prior?.ruleSet ?? DEFAULTS.ruleSet;
  if (!GOMOKU_RULE_SETS.includes(ruleSet)) {
    throw new GameSettingsError(
      `Unknown Gomoku rule set: ${ruleSet} (expected ${GOMOKU_RULE_SETS.join(" or ")})`,
      "ruleSet",
    );
  }
  return {
    gameType: GAME_GOMOKU,
    ruleSet,
    width,
    height,
    ...(width === height ? { size: width } : {}),
    topology,
  };
}

/**
 * A fresh game from normalized settings.
 *
 * @returns {GomokuEngine}
 */
function create(settings = {}) {
  if (settings.gameType !== undefined && settings.gameType !== GAME_GOMOKU) {
    throw new TypeError(`Gomoku rules cannot create a ${settings.gameType} game`);
  }
  return new GomokuEngine({
    width: settings.width ?? settings.size ?? DEFAULTS.width,
    height: settings.height ?? settings.size ?? DEFAULTS.height,
    topology: settings.topology ?? DEFAULTS.topology,
    ruleSet: settings.ruleSet ?? DEFAULTS.ruleSet,
  });
}

/**
 * A fully validated game from exportState() output or its JSON.
 *
 * @returns {GomokuEngine}
 */
function fromState(state) {
  return GomokuEngine.fromState(state);
}

function copyJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

/**
 * Render-only engine from a public getState() snapshot (an online room
 * message). The board's shape is checked but its history is not: the server
 * owns the authoritative record, and the client only draws and probes this
 * position. Its replay record is marked partial.
 *
 * @returns {GomokuEngine}
 */
function hydratePublic(state) {
  if (state?.gameType !== undefined && state.gameType !== GAME_GOMOKU) {
    throw new TypeError(`Gomoku rules cannot hydrate a ${state.gameType} state`);
  }
  const engine = new GomokuEngine({
    width: state.width ?? state.size,
    height: state.height ?? state.size,
    topology: state.topology ?? DEFAULTS.topology,
    ruleSet: state.ruleSet ?? DEFAULTS.ruleSet,
    initialBoard: state.board,
    currentPlayer: state.currentPlayer ?? BLACK,
  });
  engine.phase = state.phase ?? PHASE_PLAY;
  engine.lastMove = copyJson(state.lastMove);
  engine.result = copyJson(state.result);
  return engine;
}

/**
 * Round settings describing a game and its clock, in the room engine's
 * round-settings shape plus gameType and ruleSet.
 *
 * @param {GomokuEngine} engine
 * @param {{mainTimeSeconds?: number, byoYomiPeriods?: number,
 *   byoYomiSeconds?: number}|null} [clock]
 */
function settingsFromGame(engine, clock = null) {
  return {
    gameType: GAME_GOMOKU,
    ruleSet: engine.ruleSet,
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
 * The engine-derived part of a room's position token (plan §3). The room
 * adds positionEpoch, roundId, roundStatus, controllers and automatedSeat.
 * Plain JSON with a fixed key order, so equal positions fingerprint equally.
 */
function positionFingerprint(engine) {
  const state = engine.getState();
  return {
    gameType: GAME_GOMOKU,
    ruleSet: state.ruleSet,
    width: state.width,
    height: state.height,
    topology: state.topology,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    board: state.board,
    lastMove: state.lastMove,
    eventCount: engine.eventCount,
  };
}

/**
 * Board markers: the winning run once a five ends the game, and Renju's
 * forbidden points while Black is to move. Both are always arrays.
 *
 * @returns {{winLine: Array<{row: number, col: number}>,
 *   forbidden: Array<{row: number, col: number, reason: string}>}}
 */
function viewMarkers(engine) {
  const winLine =
    engine.result?.reason === "five" && Array.isArray(engine.result.line)
      ? engine.result.line.map(({ row, col }) => ({ row, col }))
      : [];
  const forbidden =
    engine.ruleSet === GOMOKU_RENJU &&
    engine.phase === PHASE_PLAY &&
    engine.currentPlayer === BLACK
      ? engine.forbiddenPoints()
      : [];
  return { winLine, forbidden };
}

/** @type {import("./index.js").GameRules} */
export const gomokuRules = Object.freeze({
  id: GAME_GOMOKU,
  sgfCode: SGF_GAME_CODES[GAME_GOMOKU],
  defaults: DEFAULTS,
  limits: LIMITS,
  capabilities: Object.freeze({
    pass: false,
    scoring: false,
    undo: true,
    resign: true,
    ai: false,
    analysis: false,
    sgf: false,
  }),
  roomActions: readonlySet(NON_GO_ROOM_ACTIONS),
  matchModes: Object.freeze([MATCH_MODES.FRIEND, MATCH_MODES.LOCAL]),
  normalizeSettings,
  create,
  fromState,
  hydratePublic,
  settingsFromGame,
  positionFingerprint,
  viewMarkers,
});

export default gomokuRules;

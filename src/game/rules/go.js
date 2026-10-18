import { ROOM_ACTIONS } from "../../multiplayer/protocol.js";
import {
  BOARD_LIMITS,
  GAME_GO,
  GameSettingsError,
  MATCH_MODES,
  SGF_GAME_CODES,
  isValidBoardDimension,
  readonlySet,
} from "../gameTypes.js";
import {
  GoEngine,
  SCORING_CHINESE,
  SCORING_JAPANESE,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
} from "../goEngine.js";

/**
 * Go adapter for the GameRules interface. It wraps GoEngine without changing
 * any Go behaviour: settings, construction and hydration reproduce what the
 * room engine and main.js already do, and Go keeps its legacy position token.
 */

const VALID_SCORING_RULES = new Set([SCORING_JAPANESE, SCORING_CHINESE]);
const VALID_TOPOLOGIES = new Set([
  TOPOLOGY_CYLINDER,
  TOPOLOGY_TORUS,
  TOPOLOGY_MOBIUS,
]);

const DEFAULTS = Object.freeze({
  width: BOARD_LIMITS[GAME_GO].defaultWidth,
  height: BOARD_LIMITS[GAME_GO].defaultHeight,
  komi: 6.5,
  scoringRule: SCORING_JAPANESE,
  topology: TOPOLOGY_CYLINDER,
});

function normalizeDimension(value, field) {
  if (!isValidBoardDimension(GAME_GO, value)) {
    const { min, max } = BOARD_LIMITS[GAME_GO];
    throw new GameSettingsError(
      `Go board ${field} must be an integer from ${min} to ${max}`,
      field,
    );
  }
  return value;
}

/**
 * Normalize requested Go settings, falling back to the previous game's
 * settings and then to the defaults. Mirrors the room engine's round-setting
 * rules (dimensions 3..30, komi 0..50, japanese/chinese, three topologies);
 * the square-only `size` alias is accepted and emitted for square boards.
 *
 * @param {object} [raw]
 * @param {object} [previous]
 * @returns {{width: number, height: number, size?: number, komi: number,
 *   scoringRule: string, topology: string}}
 */
function normalizeSettings(raw = {}, previous = null) {
  const width = normalizeDimension(
    raw.width ?? raw.size ?? previous?.width ?? previous?.size ?? DEFAULTS.width,
    "width",
  );
  const height = normalizeDimension(
    raw.height ?? raw.size ?? previous?.height ?? previous?.size ?? DEFAULTS.height,
    "height",
  );
  const komi = raw.komi ?? previous?.komi ?? DEFAULTS.komi;
  if (!Number.isFinite(komi) || komi < 0 || komi > 50) {
    throw new GameSettingsError("Komi must be a number from 0 to 50", "komi");
  }
  const scoringRule = raw.scoringRule ?? previous?.scoringRule ?? DEFAULTS.scoringRule;
  if (!VALID_SCORING_RULES.has(scoringRule)) {
    throw new GameSettingsError(`Unknown scoring rule: ${scoringRule}`, "scoringRule");
  }
  const topology = raw.topology ?? previous?.topology ?? DEFAULTS.topology;
  if (!VALID_TOPOLOGIES.has(topology)) {
    throw new GameSettingsError(`Unknown board topology: ${topology}`, "topology");
  }
  return {
    width,
    height,
    ...(width === height ? { size: width } : {}),
    komi,
    scoringRule,
    topology,
  };
}

/**
 * A fresh game from normalized settings, constructed exactly as the room
 * engine does for a new round.
 *
 * @returns {GoEngine}
 */
function create(settings) {
  return new GoEngine({
    ...(settings.width === settings.height ? { size: settings.width } : {}),
    width: settings.width,
    height: settings.height,
    komi: settings.komi,
    scoringRule: settings.scoringRule,
    topology: settings.topology,
  });
}

/**
 * Restore a fully validated game from exportState() output or its JSON.
 * Go states predate gameType, so only an absent or "go" gameType is accepted.
 *
 * @returns {GoEngine}
 */
function fromState(state) {
  const gameType =
    state !== null && typeof state === "object" ? state.gameType : undefined;
  if (gameType !== undefined && gameType !== GAME_GO) {
    throw new TypeError(`Go rules cannot restore a ${gameType} state`);
  }
  return GoEngine.fromState(state);
}

function boardSide(state, field) {
  const value = state?.[field] ?? state?.size;
  return Number.isInteger(value) ? value : DEFAULTS[field];
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Render-only engine from a public getState() snapshot (an online room
 * message). Nothing is replay-validated: the server owns the authoritative
 * history, and the client only draws and probes this position.
 *
 * @returns {GoEngine}
 */
function hydratePublic(state) {
  const hydrated = new GoEngine({
    ...(Number.isInteger(state.size) ? { size: state.size } : {}),
    width: boardSide(state, "width"),
    height: boardSide(state, "height"),
    topology: state.topology ?? TOPOLOGY_CYLINDER,
    komi: state.komi,
    scoringRule: state.scoringRule,
    initialBoard: state.board,
    currentPlayer: state.currentPlayer,
  });
  hydrated.phase = state.phase;
  hydrated.consecutivePasses = state.consecutivePasses;
  hydrated.captures = { ...state.captures };
  hydrated.deadStones = new Set(
    (state.deadStones ?? []).map(({ row, col }) => `${row},${col}`),
  );
  hydrated.lastMove = cloneJson(state.lastMove);
  hydrated.result = cloneJson(state.result);
  return hydrated;
}

/**
 * Round settings describing a game and its clock, in the room engine's
 * round-settings shape.
 *
 * @param {GoEngine} engine
 * @param {{mainTimeSeconds?: number, byoYomiPeriods?: number,
 *   byoYomiSeconds?: number}|null} [clock] Time-control configuration.
 */
function settingsFromGame(engine, clock = null) {
  return {
    width: engine.width,
    height: engine.height,
    ...(engine.width === engine.height ? { size: engine.width } : {}),
    komi: engine.komi,
    scoringRule: engine.scoringRule,
    topology: engine.topology ?? TOPOLOGY_CYLINDER,
    mainTimeSeconds: clock?.mainTimeSeconds ?? 0,
    byoYomiPeriods: clock?.byoYomiPeriods ?? 0,
    byoYomiSeconds: clock?.byoYomiSeconds ?? 0,
  };
}

/**
 * @typedef {object} GameCapabilities
 * @property {boolean} pass
 * @property {boolean} scoring Dead-stone marking and counting.
 * @property {boolean} undo
 * @property {boolean} resign
 * @property {boolean} ai
 * @property {boolean} analysis
 * @property {boolean} sgf
 */

/** @type {import("./index.js").GameRules} */
export const goRules = Object.freeze({
  id: GAME_GO,
  sgfCode: SGF_GAME_CODES[GAME_GO],
  defaults: DEFAULTS,
  limits: BOARD_LIMITS[GAME_GO],
  capabilities: Object.freeze({
    pass: true,
    scoring: true,
    undo: true,
    resign: true,
    ai: true,
    analysis: true,
    sgf: true,
  }),
  roomActions: readonlySet(ROOM_ACTIONS),
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
  /** Go keeps the room engine's legacy position token, byte for byte. */
  positionFingerprint: () => null,
  /** Go draws its own markers (territory, dead stones) and needs none here. */
  viewMarkers: () => ({}),
});

export default goRules;

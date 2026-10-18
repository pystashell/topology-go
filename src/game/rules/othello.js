import {
  BOARD_LIMITS,
  GAME_OTHELLO,
  MATCH_MODES,
  SGF_GAME_CODES,
  readonlySet,
} from "../gameTypes.js";
import { OthelloEngine } from "../othelloEngine.js";
import { NON_GO_ROOM_ACTIONS } from "./shared.js";

/**
 * Othello rules. The engine-facing methods are live; the settings, room and
 * view hooks that still throw follow with the rest of the adapter.
 */

function notImplemented(method) {
  return () => {
    throw new Error(`Othello rules are not implemented yet (${method})`);
  };
}

/** @type {import("./index.js").GameRules} */
export const othelloRules = Object.freeze({
  id: GAME_OTHELLO,
  sgfCode: SGF_GAME_CODES[GAME_OTHELLO],
  defaults: Object.freeze({
    width: BOARD_LIMITS[GAME_OTHELLO].defaultWidth,
    height: BOARD_LIMITS[GAME_OTHELLO].defaultHeight,
    topology: "cylinder",
  }),
  limits: BOARD_LIMITS[GAME_OTHELLO],
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
  normalizeSettings: notImplemented("normalizeSettings"),
  create: ({ width, height, topology } = {}) =>
    new OthelloEngine({ width, height, topology }),
  fromState: (state) => OthelloEngine.fromState(state),
  hydratePublic: (state) => OthelloEngine.fromPublicState(state),
  settingsFromGame: notImplemented("settingsFromGame"),
  positionFingerprint: notImplemented("positionFingerprint"),
  viewMarkers: notImplemented("viewMarkers"),
});

export default othelloRules;

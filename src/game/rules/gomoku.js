import {
  BOARD_LIMITS,
  GAME_GOMOKU,
  GOMOKU_FREESTYLE,
  MATCH_MODES,
  SGF_GAME_CODES,
  readonlySet,
} from "../gameTypes.js";
import { NON_GO_ROOM_ACTIONS } from "./shared.js";

/**
 * Gomoku (freestyle and Renju) rules. PLACEHOLDER: the static description follows the
 * multi-game plan; the engine-facing methods throw until the Gomoku engine
 * lands.
 */

function notImplemented(method) {
  return () => {
    throw new Error(`Gomoku rules are not implemented yet (${method})`);
  };
}

/** @type {import("./index.js").GameRules} */
export const gomokuRules = Object.freeze({
  id: GAME_GOMOKU,
  sgfCode: SGF_GAME_CODES[GAME_GOMOKU],
  defaults: Object.freeze({
    width: BOARD_LIMITS[GAME_GOMOKU].defaultWidth,
    height: BOARD_LIMITS[GAME_GOMOKU].defaultHeight,
    topology: "cylinder",
    ruleSet: GOMOKU_FREESTYLE,
  }),
  limits: BOARD_LIMITS[GAME_GOMOKU],
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
  create: notImplemented("create"),
  fromState: notImplemented("fromState"),
  hydratePublic: notImplemented("hydratePublic"),
  settingsFromGame: notImplemented("settingsFromGame"),
  positionFingerprint: notImplemented("positionFingerprint"),
  viewMarkers: notImplemented("viewMarkers"),
});

export default gomokuRules;

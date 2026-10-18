import {
  BOARD_LIMITS,
  GAME_OTHELLO,
  MATCH_MODES,
  SGF_GAME_CODES,
  readonlySet,
} from "../gameTypes.js";
import { NON_GO_ROOM_ACTIONS } from "./shared.js";

/**
 * Othello rules. PLACEHOLDER: the static description follows the
 * multi-game plan; the engine-facing methods throw until the Othello engine
 * lands.
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
  create: notImplemented("create"),
  fromState: notImplemented("fromState"),
  hydratePublic: notImplemented("hydratePublic"),
  settingsFromGame: notImplemented("settingsFromGame"),
  positionFingerprint: notImplemented("positionFingerprint"),
  viewMarkers: notImplemented("viewMarkers"),
});

export default othelloRules;

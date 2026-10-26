import {
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  PUBLIC_MIN_BOARD_DIMENSION,
} from "./boardDimensions.js";

/**
 * Game identities, rule sets, board limits and move errors shared by every
 * game on the topology boards. Persisted states without a gameType are Go.
 */

/**
 * Gomoku and Othello are offered next to Go. Turning this off hides the game
 * pickers and keeps every new game Go (rooms still accept any game).
 */
export const ENABLE_MULTI_GAME = true;

export const GAME_GO = "go";
export const GAME_GOMOKU = "gomoku";
export const GAME_OTHELLO = "othello";
export const GAME_TYPES = Object.freeze([GAME_GO, GAME_GOMOKU, GAME_OTHELLO]);
export const DEFAULT_GAME_TYPE = GAME_GO;

export const GOMOKU_FREESTYLE = "freestyle";
export const GOMOKU_RENJU = "renju";
export const GOMOKU_RULE_SETS = Object.freeze([GOMOKU_FREESTYLE, GOMOKU_RENJU]);

/** SGF GM[] property values (FF[4]): Go 1, Othello 2, Gomoku/Renju 4. */
export const SGF_GAME_CODES = Object.freeze({
  [GAME_GO]: 1,
  [GAME_OTHELLO]: 2,
  [GAME_GOMOKU]: 4,
});

/** Room match modes; the values match roomEngine's MATCH_MODE_* constants. */
export const MATCH_MODES = Object.freeze({
  FRIEND: "friend",
  HUMAN_AI: "human-ai",
  AI_AI: "ai-ai",
  LOCAL: "local",
});

/**
 * @typedef {object} BoardLimits
 * @property {number} min Smallest side accepted by engines and wire formats.
 * @property {number} publicMin Smallest side offered by the new-game UI.
 * @property {number} max Largest side.
 * @property {'even'|null} parity Required parity of both sides, if any.
 * @property {number} defaultWidth
 * @property {number} defaultHeight
 */

/** @type {Readonly<Record<string, Readonly<BoardLimits>>>} */
export const BOARD_LIMITS = Object.freeze({
  [GAME_GO]: Object.freeze({
    min: MIN_BOARD_DIMENSION,
    publicMin: PUBLIC_MIN_BOARD_DIMENSION,
    max: MAX_BOARD_DIMENSION,
    parity: null,
    defaultWidth: 19,
    defaultHeight: 19,
  }),
  // Five in a row needs at least five lines each way. Renju reads short
  // closed lines as rings (renju.js), so every size from 5 works.
  [GAME_GOMOKU]: Object.freeze({
    min: 5,
    publicMin: 5,
    max: MAX_BOARD_DIMENSION,
    parity: null,
    defaultWidth: 15,
    defaultHeight: 15,
  }),
  // The four starting discs sit on the centre, so both sides must be even;
  // 4 x 4 is the smallest board that holds them.
  [GAME_OTHELLO]: Object.freeze({
    min: 4,
    publicMin: 4,
    max: MAX_BOARD_DIMENSION,
    parity: "even",
    defaultWidth: 8,
    defaultHeight: 8,
  }),
});

/**
 * Move-error codes introduced by the new games. Go's own codes (and the
 * shared game_not_playing, out_of_bounds, occupied, nothing_to_undo) remain
 * in goEngine.js MOVE_ERRORS.
 */
export const GAME_MOVE_ERRORS = Object.freeze({
  /** Renju: the point is forbidden for Black; see FORBIDDEN_REASONS. */
  FORBIDDEN: "forbidden",
  /** Othello: the move would not outflank any disc. */
  NO_FLIPS: "no_flips",
  /** The action (e.g. pass or scoring) does not exist in this game. */
  UNSUPPORTED_ACTION: "unsupported_action",
});

/** The `forbidden` field carried by a FORBIDDEN move error. */
export const FORBIDDEN_REASONS = Object.freeze({
  OVERLINE: "overline",
  DOUBLE_FOUR: "double_four",
  DOUBLE_THREE: "double_three",
});

/** Settings rejected by a game's rules; `field` names the offending setting. */
export class GameSettingsError extends RangeError {
  /**
   * @param {string} message
   * @param {string} field
   */
  constructor(message, field) {
    super(message);
    this.name = "GameSettingsError";
    this.field = field;
  }
}

/**
 * A frozen Set whose add/delete/clear throw, for per-game action tables that
 * every caller shares.
 *
 * @template T
 * @param {Iterable<T>} values
 * @returns {ReadonlySet<T>}
 */
export function readonlySet(values) {
  const set = new Set(values);
  const reject = () => {
    throw new TypeError("This set is read-only");
  };
  set.add = reject;
  set.delete = reject;
  set.clear = reject;
  return Object.freeze(set);
}

/** @returns {boolean} Whether the value names a known game. */
export function isGameType(value) {
  return GAME_TYPES.includes(value);
}

/**
 * Whether one board side is allowed for a game.
 *
 * @param {string} gameType
 * @param {number} value
 * @param {{publicOnly?: boolean}} [options] Apply the new-game UI minimum.
 */
export function isValidBoardDimension(gameType, value, { publicOnly = false } = {}) {
  const limits = BOARD_LIMITS[gameType];
  if (!limits) throw new TypeError(`Unknown game type: ${gameType}`);
  return (
    Number.isInteger(value) &&
    value >= (publicOnly ? limits.publicMin : limits.min) &&
    value <= limits.max &&
    (limits.parity !== "even" || value % 2 === 0)
  );
}

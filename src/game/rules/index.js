import { GAME_GO, GAME_GOMOKU, GAME_OTHELLO } from "../gameTypes.js";
import { goRules } from "./go.js";
import { gomokuRules } from "./gomoku.js";
import { othelloRules } from "./othello.js";

/**
 * Registry of per-game rules. Engines, rooms, replays and the UI look up a
 * game's behaviour here instead of assuming Go.
 *
 * @typedef {object} GameRules
 * @property {string} id Game type ("go", "gomoku", "othello").
 * @property {number} sgfCode SGF GM[] value.
 * @property {Readonly<object>} defaults Default new-game settings.
 * @property {Readonly<import("../gameTypes.js").BoardLimits>} limits
 * @property {(raw?: object, previous?: object|null) => object} normalizeSettings
 *   Validate requested settings, falling back to `previous` then defaults;
 *   throws GameSettingsError naming the offending field.
 * @property {(settings: object) => object} create A fresh engine.
 * @property {(state: object|string) => object} fromState A fully validated
 *   engine from exportState() output or its JSON.
 * @property {(publicState: object) => object} hydratePublic A render-only
 *   engine from a public getState() snapshot.
 * @property {(engine: object, clock?: object|null) => object} settingsFromGame
 *   Round settings describing an engine and its clock configuration.
 * @property {Readonly<import("./go.js").GameCapabilities>} capabilities
 * @property {ReadonlySet<string>} roomActions Room actions the game accepts.
 * @property {ReadonlyArray<string>} matchModes Room match modes offered.
 * @property {(engine: object, roomState: object) => object|null} positionFingerprint
 *   Extra position-token input; null keeps the legacy (Go) token.
 * @property {(engine: object, options?: {hints?: boolean}) => object} viewMarkers
 *   Board markers for views (win line, forbidden points, legal moves, flips).
 */

const REGISTRY = new Map([
  [GAME_GO, goRules],
  [GAME_GOMOKU, gomokuRules],
  [GAME_OTHELLO, othelloRules],
]);

/**
 * The rules for a game type.
 *
 * @param {string} gameType
 * @returns {GameRules}
 */
export function rulesFor(gameType) {
  const rules = REGISTRY.get(gameType);
  if (!rules) throw new TypeError(`Unknown game type: ${gameType}`);
  return rules;
}

/**
 * The game type of an engine, state, replay base or settings object. Anything
 * without a gameType predates multiple games and is Go.
 *
 * @param {{gameType?: string}|null|undefined} value
 * @returns {string}
 */
export function gameTypeOf(value) {
  return value?.gameType ?? GAME_GO;
}

/**
 * TEST-ONLY. Replace the rules of a known game type, for tests that drive
 * rooms, replays or the UI with a small fake engine. Returns a function that
 * restores the previous rules. Production code must never call it.
 *
 * @param {string} gameType One of GAME_TYPES.
 * @param {GameRules} rules
 * @returns {() => void}
 */
export function registerRulesForTest(gameType, rules) {
  if (!REGISTRY.has(gameType)) throw new TypeError(`Unknown game type: ${gameType}`);
  const previous = REGISTRY.get(gameType);
  REGISTRY.set(gameType, rules);
  return () => {
    REGISTRY.set(gameType, previous);
  };
}

export { goRules, gomokuRules, othelloRules };

import {
  AI_MODEL_IDS,
  DEFAULT_AI_MODEL_ID,
  RAPFI_MODEL_ID,
  TOPO_OTHELLO_MODEL_ID,
  getGameAIEngine,
} from "./modelCatalog.js";
import { GAME_GO, GAME_GOMOKU, GAME_OTHELLO } from "../game/gameTypes.js";
import { translateText } from "../i18n.js";

/**
 * Which AI plays each game, and how the page starts it.
 *
 * Go keeps its own KataGo worker (src/ai/katagoWorker.js, driven directly by
 * main.js); its entry only describes the models. Gomoku and Othello run a
 * module worker that speaks the game-AI protocol (see gameAiClient.js).
 *
 * Swapping in the dedicated engines is one line per game: point the
 * Gomoku entry's createWorker URL at "./gomoku/gomokuAiWorker.js"
 * (src/ai/gomoku/gomokuAiWorker.js, Rapfi) and the Othello entry's at
 * "./othello/othelloAiWorker.js" (src/ai/othello/othelloAiWorker.js). Both
 * keep the fallback worker below as their last resort if they cannot start.
 */

export const GAME_AI_LEVELS = Object.freeze(["easy", "normal", "hard"]);
export const DEFAULT_GAME_AI_LEVEL = "normal";
/** Think time per level (the protocol's defaults; workers keep within ±20%). */
export const GAME_AI_TIME_LIMITS_MS = Object.freeze({ easy: 300, normal: 1_500, hard: 4_000 });
/** Chinese source copy for the levels; the page's dictionary renders English. */
export const GAME_AI_LEVEL_LABELS = Object.freeze({
  easy: "简单",
  normal: "普通",
  hard: "困难",
});

/** The simple built-in AI that answers the protocol for Gomoku and Othello. */
export function createFallbackAiWorker() {
  return new Worker(new URL("./fallback/fallbackAiWorker.js", import.meta.url), { type: "module" });
}

function engineEntry(gameType, modelId, createWorker) {
  const engine = getGameAIEngine(modelId);
  return Object.freeze({
    gameType,
    kataGo: false,
    modelIds: Object.freeze([modelId]),
    defaultModelId: modelId,
    levels: GAME_AI_LEVELS,
    defaultLevel: DEFAULT_GAME_AI_LEVEL,
    timeLimitsMs: GAME_AI_TIME_LIMITS_MS,
    /** Chinese source name (the dictionary key). */
    sourceName: engine.name,
    /** The engine's name in the given (default: current) locale. */
    displayName: (locale) => translateText(engine.name, {}, locale),
    createWorker,
    createFallbackWorker: createFallbackAiWorker,
  });
}

const REGISTRY = Object.freeze({
  [GAME_GO]: Object.freeze({
    gameType: GAME_GO,
    kataGo: true,
    modelIds: AI_MODEL_IDS,
    defaultModelId: DEFAULT_AI_MODEL_ID,
    levels: Object.freeze([]),
    defaultLevel: null,
    timeLimitsMs: null,
    sourceName: "KataGo",
    displayName: () => "KataGo",
    // Go's KataGo worker is created and reused by main.js itself.
    createWorker: null,
    createFallbackWorker: null,
  }),
  [GAME_GOMOKU]: engineEntry(
    GAME_GOMOKU,
    RAPFI_MODEL_ID,
    // Rapfi (WebAssembly) behind seam-aware tactics; see src/ai/gomoku/.
    () => new Worker(new URL("./gomoku/gomokuAiWorker.js", import.meta.url), { type: "module" }),
  ),
  [GAME_OTHELLO]: engineEntry(
    GAME_OTHELLO,
    TOPO_OTHELLO_MODEL_ID,
    // Our own wrap-around Othello engine; see src/ai/othello/.
    () => new Worker(new URL("./othello/othelloAiWorker.js", import.meta.url), { type: "module" }),
  ),
});

/**
 * The AI entry of a game type.
 *
 * @param {string} gameType
 * @returns {Readonly<{gameType: string, kataGo: boolean, modelIds: ReadonlyArray<string>,
 *   defaultModelId: string, levels: ReadonlyArray<string>, defaultLevel: string|null,
 *   timeLimitsMs: Readonly<Record<string, number>>|null, sourceName: string,
 *   displayName: (locale?: string) => string, createWorker: (() => Worker)|null,
 *   createFallbackWorker: (() => Worker)|null}>}
 */
export function gameAiEntry(gameType) {
  const entry = REGISTRY[gameType];
  if (!entry) throw new TypeError(`No AI is registered for game type: ${gameType}`);
  return entry;
}

/** Whether a game's AI runs through the game-AI protocol (not KataGo). */
export function usesGameAiProtocol(gameType) {
  return Boolean(REGISTRY[gameType] && !REGISTRY[gameType].kataGo);
}

/** A known level, or the default. */
export function normalizeGameAiLevel(level) {
  return GAME_AI_LEVELS.includes(level) ? level : DEFAULT_GAME_AI_LEVEL;
}

/** Protocol settings for a level: {level, timeLimitMs}. */
export function gameAiSettings(level) {
  const normalized = normalizeGameAiLevel(level);
  return { level: normalized, timeLimitMs: GAME_AI_TIME_LIMITS_MS[normalized] };
}

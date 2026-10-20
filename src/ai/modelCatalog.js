export const DEFAULT_AI_MODEL_ID = "b10";

const B10_BYTES = 11_138_361;
const B18_BYTES = 97_898_094;

const MODEL_CATALOG = Object.freeze({
  b10: Object.freeze({
    id: "b10",
    name: "KataGo b10",
    optionLabel: "b10 快速（特殊棋盘段位未测）",
    badgeLabel: "KataGo b10 · 快速（段位未测）",
    shortLabel: "b10",
    compressedBytes: B10_BYTES,
    downloadLabel: "约 11 MB",
    heavy: false,
    requiresWebGPU: false,
    parts: Object.freeze(["/models/katago-b10c128.bin.gz"]),
    resourceNote:
      "轻量模型，首次使用下载约 11 MB；支持 WebGPU、WebGL 和 CPU。",
    strengthNote: "官方普通围棋网络达到职业级以上；特殊棋盘棋力未标定。",
  }),
  b18: Object.freeze({
    id: "b18",
    name: "KataGo b18",
    optionLabel: "b18 增强（高耗资源 · 段位未测）",
    badgeLabel: "KataGo b18 · 增强（段位未测）",
    shortLabel: "b18",
    compressedBytes: B18_BYTES,
    downloadLabel: "约 93.4 MB",
    heavy: true,
    requiresWebGPU: true,
    parts: Object.freeze([
      "/models/katago-b18c384.part01.bin",
      "/models/katago-b18c384.part02.bin",
      "/models/katago-b18c384.part03.bin",
      "/models/katago-b18c384.part04.bin",
    ]),
    resourceNote:
      "高耗资源：首次下载约 93.4 MB，会占用大量显存和内存，并增加耗电与发热；仅建议桌面端 WebGPU。",
    strengthNote: "比 b10 网络更强；特殊棋盘未经训练，实际段位仍未标定。",
  }),
});

export const AI_MODEL_IDS = Object.freeze(Object.keys(MODEL_CATALOG));

export function normalizeAIModelId(modelId) {
  return typeof modelId === "string" && MODEL_CATALOG[modelId]
    ? modelId
    : DEFAULT_AI_MODEL_ID;
}

export function getAIModel(modelId = DEFAULT_AI_MODEL_ID) {
  return MODEL_CATALOG[normalizeAIModelId(modelId)];
}

export function formatModelDownloadProgress(loadedBytes, modelId) {
  const model = getAIModel(modelId);
  const loaded = Math.max(0, Math.min(Number(loadedBytes) || 0, model.compressedBytes));
  const loadedMiB = loaded / (1024 * 1024);
  const totalMiB = model.compressedBytes / (1024 * 1024);
  return `${loadedMiB.toFixed(1)} / ${totalMiB.toFixed(1)} MB`;
}

/*
 * Per-game AI catalog. Go keeps the KataGo models above exactly as they are;
 * every other game offers one engine whose id the room stores on its AI
 * controllers. A model id belongs to exactly one game, so a room refuses a
 * KataGo id for a Gomoku round (and the reverse). Rooms, the lobby and the
 * page share this table; it imports nothing that needs a browser.
 */

export const RAPFI_MODEL_ID = "rapfi";
export const TOPO_OTHELLO_MODEL_ID = "topo-othello";

const GAME_AI_ENGINES = Object.freeze({
  [RAPFI_MODEL_ID]: Object.freeze({
    id: RAPFI_MODEL_ID,
    gameType: "gomoku",
    // Rapfi is a proper name and reads the same in Chinese and English.
    name: "Rapfi",
    seatName: "Rapfi AI",
  }),
  [TOPO_OTHELLO_MODEL_ID]: Object.freeze({
    id: TOPO_OTHELLO_MODEL_ID,
    gameType: "othello",
    // Chinese source copy; the page's dictionary renders "Topology Othello AI".
    name: "拓扑黑白棋 AI",
    seatName: "拓扑黑白棋 AI",
  }),
});

const GAME_AI_MODEL_IDS = Object.freeze({
  go: AI_MODEL_IDS,
  gomoku: Object.freeze([RAPFI_MODEL_ID]),
  othello: Object.freeze([TOPO_OTHELLO_MODEL_ID]),
});

/** Every AI model id any game accepts (KataGo first). */
export const ALL_AI_MODEL_IDS = Object.freeze(
  Object.values(GAME_AI_MODEL_IDS).flat(),
);

/**
 * The model ids a game's AI seats may use; [] for an unknown game.
 *
 * @param {string} [gameType="go"]
 * @returns {ReadonlyArray<string>}
 */
export function aiModelIdsForGame(gameType = "go") {
  return GAME_AI_MODEL_IDS[gameType] ?? Object.freeze([]);
}

/** The model a game's AI seat uses when none is named. */
export function defaultAIModelIdForGame(gameType = "go") {
  return aiModelIdsForGame(gameType)[0] ?? DEFAULT_AI_MODEL_ID;
}

/** Whether `modelId` names one of this game's AI models. */
export function isAIModelIdForGame(modelId, gameType = "go") {
  return typeof modelId === "string" && aiModelIdsForGame(gameType).includes(modelId);
}

/** A model id of this game, or the game's default for anything else. */
export function normalizeGameAIModelId(modelId, gameType = "go") {
  return isAIModelIdForGame(modelId, gameType) ? modelId : defaultAIModelIdForGame(gameType);
}

/** The game a model id belongs to, or null for an unknown id. */
export function aiModelGameType(modelId) {
  for (const [gameType, ids] of Object.entries(GAME_AI_MODEL_IDS)) {
    if (typeof modelId === "string" && ids.includes(modelId)) return gameType;
  }
  return null;
}

/**
 * The engine behind a non-Go model id ({id, gameType, name, seatName}), or
 * null for KataGo and unknown ids (use getAIModel for KataGo).
 */
export function getGameAIEngine(modelId) {
  return typeof modelId === "string" ? GAME_AI_ENGINES[modelId] ?? null : null;
}

/**
 * The name an AI seat goes by in rooms and the lobby. KataGo seats keep
 * their historical "KataGo b10 AI" names (including for an unrecognized id,
 * which older rooms never stored); other engines use their own names.
 */
export function aiSeatName(modelId) {
  return getGameAIEngine(modelId)?.seatName ?? `KataGo ${modelId} AI`;
}

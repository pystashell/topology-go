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

/**
 * SGF record files: exporting the current or replayed game and importing a
 * record into the replay player (Go, Gomoku and Othello).
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js).
 */

import {
  GAME_GO,
} from "../game/gameTypes.js";
import {
  BLACK,
  WHITE,
} from "../game/goEngine.js";
import {
  gameTypeOf,
} from "../game/rules/index.js";
import {
  SgfError,
  exportSgf,
  importSgf,
} from "../game/sgf.js";
import {
  localizedErrorMessage,
  translateText,
} from "../i18n.js";
import {
  sgfOtherGameNote,
} from "../ui/gameUi.js";
import {
  aiControlsColor,
  boardHeight,
  boardWidth,
  cloneSerializable,
  currentAIName,
  currentTimeoutOutcome,
  elements,
  enterReplay,
  exitReplay,
  game,
  gameRulesOf,
  hasOnlineSession,
  isAIMode,
  isNextGameSetup,
  isReplaying,
  maybeStartAITurn,
  onlineRoom,
  pendingTopology,
  replayEventCount,
  replaySession,
  replaySource,
  roomSeat,
  setMessage,
  topologyName,
} from "../main.js";

function replayMetadataForExport() {
  if (replaySession?.metadata) return cloneSerializable(replaySession.metadata);
  // Player names are written into the file (PB/PW), so they use the language
  // the record was exported in rather than the Chinese source copy.
  if (hasOnlineSession()) {
    return {
      blackPlayer: roomSeat(BLACK)?.name ?? translateText("黑方"),
      whitePlayer: roomSeat(WHITE)?.name ?? translateText("白方"),
      result: onlineRoom?.game?.result ?? onlineRoom?.timeControl?.outcome ?? null,
      scoreConfirmations: onlineRoom?.scoreConfirmations ?? [],
    };
  }
  if (isAIMode()) {
    const playerName = (color) => translateText(
      aiControlsColor(color) ? currentAIName(color) : "人类玩家",
    );
    return {
      blackPlayer: playerName(BLACK),
      whitePlayer: playerName(WHITE),
      result: game?.result ?? currentTimeoutOutcome() ?? null,
    };
  }
  return {
    blackPlayer: translateText("黑方"),
    whitePlayer: translateText("白方"),
    result: game?.result ?? currentTimeoutOutcome() ?? null,
  };
}

function safeRecordFilenamePart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "game";
}

function sgfImportWarningSummary(warnings) {
  const labels = {
    IGNORED_GAMES: "只导入了棋谱集合中的第一局",
    IGNORED_VARIATIONS: "只导入了主分支",
    IGNORED_MIDGAME_SETUP: "忽略了中盘摆子",
    IGNORED_MIDGAME_PLAYER: "忽略了中盘改行棋方",
    NON_ALTERNATING_MOVE: "棋谱中存在非交替行棋",
    SIMPLIFIED_TERRITORY_SCORING: "已按简化领地计分解释，双活中的眼仍计地",
    UNKNOWN_RULE: "未知规则已按简化领地计分解释",
    NON_FF4: "已按 FF[4] 兼容方式解析",
    CHARSET_ASSUMED_UTF8: "文本已按 UTF-8 读取",
    LEGACY_TT_PASS: "已兼容旧式 tt 停着",
    INVALID_KOMI: "贴目无效，已按 0 目复盘",
    MISSING_SIZE: "缺少尺寸，已按 19 × 19 解释",
    MISSING_GM: "缺少棋类标记，已按围棋解释",
    DEFAULT_SIZE_ASSUMED: "缺少尺寸，已按该棋默认尺寸解释",
    UNKNOWN_GOMOKU_RULE: "未知五子棋规则已按自由规则解释",
    OTHELLO_PASSES_SKIPPED: "棋谱中的停着已跳过，黑白棋会自动跳过无子可下的一方",
    NORMALIZED_PROPERTY_ID: "属性名已规范化",
    PARTIAL_BASE_MISSING: "旧版部分棋谱缺少提子与劫争历史，仅能近似复盘",
  };
  const relevant = (Array.isArray(warnings) ? warnings : [])
    .filter((item) => item?.code !== "TOPOLOGY_ASSUMED");
  if (relevant.length === 0) return "";
  const details = [...new Set(relevant
    .sort((a, b) => Number(b.code === "PARTIAL_BASE_MISSING") -
      Number(a.code === "PARTIAL_BASE_MISSING"))
    .map((item) => labels[item?.code]).filter(Boolean))];
  const visible = details.slice(0, 2);
  const hiddenCount = Math.max(0, relevant.length - visible.length);
  const detailText = visible.length > 0 ? visible.join("；") : "存在格式兼容处理";
  return ` 兼容提示：${detailText}${hiddenCount ? `（另有 ${hiddenCount} 项）` : ""}。`;
}

function exportCurrentSgf() {
  const source = replaySource();
  if (!source) {
    setMessage("当前棋局没有可导出的棋谱。", true);
    return;
  }
  if (!gameRulesOf(source.base).capabilities.sgf) {
    setMessage("这个棋类暂不支持 AI 对手、AI 分析或 SGF 棋谱。", true);
    return;
  }
  try {
    const metadata = replayMetadataForExport();
    const { sgf, warnings } = exportSgf({
      replay: source,
      metadata,
      scoreConfirmations: metadata.scoreConfirmations,
      extensionEvents: replaySession?.extensionEvents ?? [],
    });
    const base = source.base ?? game;
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").slice(0, 13);
    const gameType = gameTypeOf(base);
    const filename = [
      "topology-go",
      ...(gameType === GAME_GO ? [] : [safeRecordFilenamePart(gameType)]),
      safeRecordFilenamePart(base.topology ?? "cylinder"),
      `${boardWidth(base)}x${boardHeight(base)}`,
      stamp,
    ].join("-") + ".sgf";
    const url = URL.createObjectURL(new Blob([sgf], { type: "application/x-go-sgf;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    const topologyNote = warnings.some((item) => item.code === "NONSTANDARD_TOPOLOGY")
      ? "普通 SGF 阅读器可读取棋步；异形接缝保存在 X* 扩展属性中。"
      : "";
    const scoringNote = warnings.some((item) => item.code === "SIMPLIFIED_TERRITORY_SCORING")
      ? "本局采用简化领地计分，双活中的眼仍计地。"
      : "";
    setMessage(`已导出 ${filename}。${topologyNote}${scoringNote}`);
  } catch (error) {
    console.error("Unable to export SGF", error);
    setMessage(`导出 SGF 失败：${localizedErrorMessage(error, "棋谱格式无法生成")}`, true);
  }
}

async function importSgfFile(file) {
  if (!file) return;
  if (isNextGameSetup()) {
    elements.importSgfFile.value = "";
    setMessage("请先开始下一局，或留在当前终局后再导入棋谱。", true);
    return;
  }
  try {
    if (file.size > 2 * 1024 * 1024) {
      throw new SgfError("棋谱文件不能超过 2 MiB。", "SGF_TOO_LARGE");
    }
    const parsed = importSgf(await file.text(), { defaultTopology: pendingTopology });
    if (isReplaying()) exitReplay({ announce: false });
    enterReplay(parsed.replay, {
      imported: true,
      sourceName: file.name,
      warnings: parsed.warnings,
      metadata: parsed.metadata,
      extensionEvents: parsed.extensionEvents,
      extensions: parsed.extensions,
    });
    if (!isReplaying()) return;
    replaySession.metadata = parsed.metadata;
    replaySession.extensionEvents = parsed.extensionEvents;
    const assumed = parsed.warnings.some((item) => item.code === "TOPOLOGY_ASSUMED");
    const warningSummary = sgfImportWarningSummary(parsed.warnings);
    const analysis = gameRulesOf(parsed.replay.base).capabilities.analysis;
    setMessage(
      assumed
        ? `已导入 ${file.name}：原谱未写异形拓扑，按当前选择的${topologyName(parsed.metadata.topology)}复盘。${warningSummary}`
        : analysis
          ? `已导入 ${file.name}，共 ${replayEventCount(parsed.replay)} 手；可播放、切换视图或做 AI 分析。${warningSummary}`
          : `已导入 ${file.name}，共 ${replayEventCount(parsed.replay)} 手；可播放或切换视图。${warningSummary}`,
    );
  } catch (error) {
    if (error instanceof SgfError && error.code === "UNSUPPORTED_GAME") {
      // GM[2] Othello and GM[4] Gomoku records: say what the file is.
      setMessage(sgfOtherGameNote(error), true);
      maybeStartAITurn();
      return;
    }
    console.error("Unable to import SGF", error);
    const reason = error instanceof SgfError
      ? localizedErrorMessage(error, "文件不是可识别的 SGF 棋谱")
      : "文件不是可识别的 SGF 棋谱";
    setMessage(`导入 SGF 失败：${reason}`, true);
    maybeStartAITurn();
  } finally {
    elements.importSgfFile.value = "";
  }
}

export {
  exportCurrentSgf,
  importSgfFile,
};

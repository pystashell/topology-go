import {
  BOARD_LIMITS,
  FORBIDDEN_REASONS,
  GAME_GO,
  GAME_GOMOKU,
  GAME_MOVE_ERRORS,
  GAME_OTHELLO,
  GOMOKU_FREESTYLE,
  GOMOKU_RULE_SETS,
  isGameType,
} from "../game/gameTypes.js";
import { rulesFor } from "../game/rules/index.js";

/**
 * Game-dependent copy and control decisions for the page. Everything here is
 * pure: it reads settings, states and results and returns Chinese source copy
 * (the i18n layer renders it in the viewer's language) or plain flags. Go's
 * strings are exactly the ones the page has always shown.
 */

export const GAME_LABELS = Object.freeze({
  [GAME_GO]: "围棋",
  [GAME_GOMOKU]: "五子棋",
  [GAME_OTHELLO]: "黑白棋",
});

export const RULE_SET_LABELS = Object.freeze({
  freestyle: "自由规则",
  renju: "禁手规则（连珠）",
});

/** Square sizes offered as one-click shortcuts in the settings panel. */
export const GAME_SIZE_SHORTCUTS = Object.freeze({
  [GAME_GO]: Object.freeze([9, 13, 19]),
  [GAME_GOMOKU]: Object.freeze([15, 19]),
  [GAME_OTHELLO]: Object.freeze([6, 8, 10]),
});

const TOPOLOGY_LABELS = Object.freeze({
  cylinder: "竹筒",
  torus: "甜甜圈",
  mobius: "莫比乌斯",
});

/** Copy for every move error an engine (or a room) reports. */
export const MOVE_ERROR_COPY = Object.freeze({
  game_not_playing: "现在不能落子。",
  out_of_bounds: "这个位置不在棋盘上。",
  occupied: "这里已经有棋子了。",
  suicide: "禁入点：落子后这一块棋没有气。",
  superko: "全局同形禁着：不能重复之前出现过的局面。",
  game_not_scoring: "现在还没有进入点目阶段。",
  empty_point: "点目时请点击棋子来标记死活。",
  nothing_to_undo: "现在没有可以撤回的棋步。",
  [GAME_MOVE_ERRORS.FORBIDDEN]: "黑方禁手，不能落在这里。",
  [GAME_MOVE_ERRORS.NO_FLIPS]: "必须夹住至少一枚对方棋子。",
  [GAME_MOVE_ERRORS.UNSUPPORTED_ACTION]: "这个棋类不支持这个操作。",
});

/** Renju: why Black may not play a point. */
export const FORBIDDEN_COPY = Object.freeze({
  [FORBIDDEN_REASONS.OVERLINE]: "黑方禁手：长连。",
  [FORBIDDEN_REASONS.DOUBLE_FOUR]: "黑方禁手：四四。",
  [FORBIDDEN_REASONS.DOUBLE_THREE]: "黑方禁手：三三。",
});

/** A known game type; anything else (including absence) is Go. */
export function normalizeGameType(value) {
  return isGameType(value) ? value : GAME_GO;
}

/** A known Gomoku rule set; anything else is freestyle. */
export function normalizeRuleSet(value) {
  return GOMOKU_RULE_SETS.includes(value) ? value : GOMOKU_FREESTYLE;
}

export function gameName(gameType) {
  return GAME_LABELS[normalizeGameType(gameType)];
}

export function ruleSetName(ruleSet) {
  return RULE_SET_LABELS[normalizeRuleSet(ruleSet)];
}

export function colorName(color) {
  return color === "black" ? "黑方" : "白方";
}

function oppositeColorName(color) {
  return color === "black" ? "白方" : "黑方";
}

export function topologyLabel(topology) {
  return TOPOLOGY_LABELS[topology] ?? TOPOLOGY_LABELS.cylinder;
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1);
}

/**
 * Clamp one board side into what the game's new-game UI offers: the public
 * minimum and maximum, and an even number for Othello.
 */
export function clampBoardDimension(gameType, value, fallback = null) {
  const limits = BOARD_LIMITS[normalizeGameType(gameType)];
  const numeric = Number(value);
  const backup = fallback === null || fallback === undefined ? NaN : Number(fallback);
  const start = Number.isFinite(numeric)
    ? numeric
    : Number.isFinite(backup) ? backup : limits.defaultWidth;
  let side = Math.max(limits.publicMin, Math.min(limits.max, Math.round(start)));
  if (limits.parity === "even" && side % 2 !== 0) {
    side = side + 1 <= limits.max ? side + 1 : side - 1;
  }
  return side;
}

/** Whether a typed board side is offered as-is by the game's new-game UI. */
export function isOfferedBoardDimension(gameType, value) {
  const limits = BOARD_LIMITS[normalizeGameType(gameType)];
  return (
    Number.isInteger(value) &&
    value >= limits.publicMin &&
    value <= limits.max &&
    (limits.parity !== "even" || value % 2 === 0)
  );
}

/** The small caption under the width or height field. */
export function dimensionRangeText(gameType, axis = "width") {
  const limits = BOARD_LIMITS[normalizeGameType(gameType)];
  // Short enough to sit beside the number field ("偶数列 · 6–30").
  const label = limits.parity === "even"
    ? axis === "height" ? "偶数行" : "偶数列"
    : axis === "height" ? "纵向行数" : "横向列数";
  return `${label} · ${limits.publicMin}–${limits.max}`;
}

/** Why a typed size was adjusted, for games with their own limits. */
export function boardLimitNote(gameType) {
  const type = normalizeGameType(gameType);
  if (type === GAME_GOMOKU) return "五子棋棋盘每边至少 11 路。";
  if (type === GAME_OTHELLO) return "黑白棋棋盘宽高须为 6–30 的偶数。";
  return "";
}

function clockLabel(settings) {
  const mainTimeSeconds = Math.max(0, Number(settings?.mainTimeSeconds) || 0);
  const periods = Math.max(0, Math.round(Number(settings?.byoYomiPeriods) || 0));
  const periodSeconds = Math.max(0, Math.round(Number(settings?.byoYomiSeconds) || 0));
  const byoYomi = periods > 0 && periodSeconds > 0;
  if (mainTimeSeconds <= 0 && !byoYomi) return "不计时";
  const minutes = Math.round(mainTimeSeconds / 60);
  return byoYomi
    ? `${minutes} 分钟 + ${periods}×${periodSeconds} 秒`
    : `${minutes} 分钟`;
}

/**
 * One line describing a game's settings, as shown by the invite dialog, the
 * create-room dialog and a received invitation. Go keeps its original line
 * (rule, komi, clock); with `showGame` every line starts with the game name.
 */
export function gameSettingsSummary(settings, { showGame = true } = {}) {
  const gameType = normalizeGameType(settings?.gameType);
  const width = clampBoardDimension(gameType, settings?.width ?? settings?.size);
  const height = clampBoardDimension(gameType, settings?.height ?? settings?.size);
  const board = `${width} × ${height} · ${topologyLabel(settings?.topology)}`;
  let line;
  if (gameType === GAME_GO) {
    const rule = settings?.scoringRule === "japanese" ? "简化领地计分" : "中国规则";
    const komi = Number(settings?.komi);
    const komiLabel = Number.isFinite(komi) ? ` · 贴目 ${formatScore(komi)}` : "";
    line = `${board} · ${rule}${komiLabel} · ${clockLabel(settings)}`;
  } else if (gameType === GAME_GOMOKU) {
    line = `${board} · ${ruleSetName(settings?.ruleSet)} · ${clockLabel(settings)}`;
  } else {
    line = `${board} · ${clockLabel(settings)}`;
  }
  return showGame ? `${gameName(gameType)} · ${line}` : line;
}

/**
 * A finished game's result. Go margins are points; Gomoku names the winning
 * row (five, or the overline length); Othello wins are counted in discs.
 */
export function formatGameResult(result) {
  if (!result) return "";
  if (result.reason === "timeout") {
    return `${colorName(result.winner)}胜 · ${colorName(result.loser)}超时`;
  }
  if (result.reason === "resign") {
    return `${colorName(result.winner)}胜 · ${colorName(result.loser)}认输`;
  }
  if (result.reason === "five") {
    return Number(result.length) > 5
      ? `${colorName(result.winner)}以 ${result.length} 子长连获胜`
      : `${colorName(result.winner)}连成五子获胜`;
  }
  if (result.reason === "board_full") return "棋盘已满，和棋";
  if (result.reason === "no_legal_moves") return "黑方已无可下之处，和棋";
  if (result.reason === "discs") {
    return result.winner === "draw"
      ? `双方各 ${result.black} 子，和棋`
      : `${colorName(result.winner)}胜 ${result.margin} 子`;
  }
  if (result.winner === "draw") return "双方和棋";
  return `${colorName(result.winner)}胜 ${formatScore(result.margin)} 目`;
}

/** Disc counts of a board (Othello states also carry them as `discs`). */
export function countDiscs(board) {
  let black = 0;
  let white = 0;
  for (const row of Array.isArray(board) ? board : []) {
    for (const value of Array.isArray(row) ? row : []) {
      if (value === "black") black += 1;
      else if (value === "white") white += 1;
    }
  }
  return { black, white };
}

/**
 * Which controls a game shows, and the two counters under the turn card:
 * Go's captures, Othello's disc counts, none for Gomoku.
 *
 * @param {string} gameType
 * @param {object|null} [state] A getState() snapshot or replay frame.
 */
export function gameControls(gameType, state = null) {
  const type = normalizeGameType(gameType ?? state?.gameType);
  const { capabilities } = rulesFor(type);
  const counts = type === GAME_GO ? "captures" : type === GAME_OTHELLO ? "discs" : null;
  let countValues = null;
  if (counts === "captures") {
    countValues = {
      black: Number(state?.captures?.black) || 0,
      white: Number(state?.captures?.white) || 0,
    };
  } else if (counts === "discs") {
    countValues = state?.discs
      ? { black: Number(state.discs.black) || 0, white: Number(state.discs.white) || 0 }
      : countDiscs(state?.board);
  }
  return {
    gameType: type,
    pass: capabilities.pass,
    scoring: capabilities.scoring,
    undo: capabilities.undo,
    resign: capabilities.resign,
    ai: capabilities.ai,
    analysis: capabilities.analysis,
    sgf: capabilities.sgf,
    komi: type === GAME_GO,
    scoringRule: type === GAME_GO,
    ruleSet: type === GAME_GOMOKU,
    counts,
    countLabels: counts === "captures"
      ? { black: "黑方提子", white: "白方提子" }
      : counts === "discs"
        ? { black: "黑方子数", white: "白方子数" }
        : null,
    countValues,
    sizeShortcuts: GAME_SIZE_SHORTCUTS[type],
    limits: BOARD_LIMITS[type],
  };
}

/**
 * Turn-card copy for a live Gomoku or Othello position: the phase, whose
 * turn it is (or the result) and, after an automatic Othello pass, which
 * side had no move.
 *
 * @returns {{phase: string, turn: string, note: string}}
 */
export function gameStatusText(state) {
  if (!state) return { phase: "", turn: "", note: "" };
  if (state.phase === "finished") {
    return { phase: "对局结束", turn: formatGameResult(state.result), note: "" };
  }
  const note = normalizeGameType(state.gameType) === GAME_OTHELLO && state.lastMove?.skipped
    ? skippedTurnText(state.lastMove.skipped)
    : "";
  return { phase: "对局中", turn: `${colorName(state.currentPlayer)}落子`, note };
}

/** "{color}无子可下，{other}继续": the side that was skipped automatically. */
export function skippedTurnText(skippedColor) {
  return `${colorName(skippedColor)}无子可下，${oppositeColorName(skippedColor)}继续`;
}

/**
 * The announcement after a Gomoku or Othello move (local or from the room).
 *
 * @param {{color: string, flipped?: Array, skipped?: string|null}} move
 * @param {{gameType: string, result?: object|null}} context
 */
export function gameMoveMessage(move, { gameType, result = null } = {}) {
  const type = normalizeGameType(gameType);
  const color = colorName(move?.color);
  if (type === GAME_OTHELLO) {
    const flipped = Array.isArray(move?.flipped) ? move.flipped.length : 0;
    const base = `${color}落子，翻转 ${flipped} 子。`;
    if (result) return `${base} 对局结束：${formatGameResult(result)}。`;
    if (move?.skipped) return `${base} ${skippedTurnText(move.skipped)}。`;
    return base;
  }
  if (result) return `${formatGameResult(result)}。`;
  return `${color}落子。`;
}

/** The replay message for one recorded Gomoku or Othello move. */
export function gameReplayStepMessage(step, move, { gameType } = {}) {
  const type = normalizeGameType(gameType);
  const color = colorName(move?.color);
  if (type === GAME_OTHELLO) {
    const flipped = Array.isArray(move?.flipped) ? move.flipped.length : 0;
    const skipped = move?.skipped ? ` ${skippedTurnText(move.skipped)}。` : "";
    return `第 ${step} 手：${color}落子，翻转 ${flipped} 子。${skipped}`;
  }
  return `第 ${step} 手：${color}落子。`;
}

/** Independent sentences shown as one message ("A。 B。"). */
export function joinSentences(...sentences) {
  return sentences.map((text) => String(text ?? "").trim()).filter(Boolean).join(" ");
}

/** The message for a rejected move. */
export function moveErrorMessage(failure, fallback = "这一手不能下。") {
  const reason = failure?.reason;
  if (reason === GAME_MOVE_ERRORS.FORBIDDEN) {
    return FORBIDDEN_COPY[failure.forbidden] ?? MOVE_ERROR_COPY[reason];
  }
  return MOVE_ERROR_COPY[reason] ?? fallback;
}

/** "15 × 15 竹筒棋盘已准备好，黑方先行。", named by game when it is not Go. */
export function newBoardMessage(settings, { showGame = true } = {}) {
  const gameType = normalizeGameType(settings?.gameType);
  const line = `${settings?.width} × ${settings?.height} ${topologyLabel(settings?.topology)}棋盘已准备好，黑方先行。`;
  return showGame && gameType !== GAME_GO ? `${gameName(gameType)} · ${line}` : line;
}

/** Title of the rules note for a game on a topology. */
export function rulesSummaryTitle(gameType, topology, { showGame = true } = {}) {
  const title = `${topologyLabel(topology)}棋盘规则说明`;
  return showGame ? `${gameName(gameType)} · ${title}` : title;
}

/**
 * Friendly copy for an SGF record of a game we do not play: Go (GM[1]),
 * Othello (GM[2]) and Gomoku (GM[4]) records can all be imported.
 */
export function sgfOtherGameNote(error) {
  const gm = /GM\[(\d+)\]/u.exec(String(error?.message ?? ""))?.[1] ?? "";
  return `这份 SGF 不是围棋、五子棋或黑白棋棋谱（GM[${gm || "?"}]），无法导入。`;
}

/** Lobby card labels: the game badge and, for Gomoku, its rule set. */
export function lobbyGameLabels(summary) {
  const gameType = normalizeGameType(summary?.gameType);
  return {
    gameType,
    badge: gameName(gameType),
    rule: gameType === GAME_GOMOKU ? ruleSetName(summary?.ruleSet) : "",
  };
}

import {
  formatGoColumn,
  GO_COLUMN_LABELS,
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  parseGoColumn,
} from "../game/boardDimensions.js";

export const COORDINATE_LETTERS = GO_COLUMN_LABELS;

export const CHAT_TEXT_MAX_CODE_POINTS = 300;
export const CHAT_TEXT_MAX_BYTES = 1_500;
export const CHAT_TEXT_MAX_LINES = 4;
export const CHAT_POINT_LIMIT = 4;
export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_HISTORY_MAX_BYTES = 64 * 1024;

export const CHAT_STICKERS = Object.freeze([
  Object.freeze({ id: "good-move", emoji: "👏", label: "好棋！" }),
  Object.freeze({ id: "thinking", emoji: "🤔", label: "让我想想" }),
  Object.freeze({ id: "surprised", emoji: "😲", label: "居然下这里" }),
  Object.freeze({ id: "laugh", emoji: "😂", label: "笑死" }),
  Object.freeze({ id: "respect", emoji: "🤝", label: "承让" }),
  Object.freeze({ id: "tea", emoji: "🍵", label: "喝口茶" }),
  Object.freeze({ id: "bamboo", emoji: "🎋", label: "竹筒之力" }),
  Object.freeze({ id: "donut", emoji: "🍩", label: "甜甜圈时间" }),
]);

const CHAT_STICKER_IDS = new Set(CHAT_STICKERS.map(({ id }) => id));
const VALID_TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const textEncoder = new TextEncoder();

export class ChatValidationError extends Error {
  constructor(message, code = "INVALID_CHAT") {
    super(message);
    this.name = "ChatValidationError";
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoardSize(value) {
  return Number.isInteger(value) &&
    value >= MIN_BOARD_DIMENSION &&
    value <= MAX_BOARD_DIMENSION;
}

function boardDimensions(value, widthOverride) {
  if (isRecord(value)) {
    const width = value.width ?? value.size;
    const height = value.height ?? value.size;
    return isBoardSize(width) && isBoardSize(height) ? { width, height } : null;
  }
  const height = value;
  const width = widthOverride ?? value;
  return isBoardSize(width) && isBoardSize(height) ? { width, height } : null;
}

function normalizedTopology(value) {
  return VALID_TOPOLOGIES.has(value) ? value : "cylinder";
}

export function formatBoardCoordinate(row, col, heightOrBoard, widthOverride) {
  const dimensions = boardDimensions(heightOrBoard, widthOverride);
  if (
    !dimensions ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= dimensions.height ||
    col < 0 ||
    col >= dimensions.width
  ) {
    return "";
  }
  const letter = formatGoColumn(col);
  return letter ? `${letter}${dimensions.height - row}` : "";
}

export function parseBoardCoordinate(value, heightOrBoard, widthOverride) {
  const dimensions = boardDimensions(heightOrBoard, widthOverride);
  if (!dimensions || typeof value !== "string") return null;
  const match = value.trim().toUpperCase().match(/^([A-HJ-Z]{1,2})\s*(\d{1,2})$/u);
  if (!match) return null;
  const col = parseGoColumn(match[1]);
  const number = Number(match[2]);
  if (
    col < 0 || col >= dimensions.width ||
    number < 1 || number > dimensions.height
  ) return null;
  const row = dimensions.height - number;
  return {
    row,
    col,
    label: formatBoardCoordinate(row, col, dimensions),
  };
}

export function extractBoardCoordinates(text, board, limit = CHAT_POINT_LIMIT) {
  const dimensions = boardDimensions(board);
  if (typeof text !== "string" || !dimensions || limit < 1) return [];
  const points = [];
  const seen = new Set();
  // Chinese prose commonly attaches a coordinate directly to surrounding
  // characters ("看D4这里"). Only block ASCII word/number prefixes so
  // ordinary Latin tokens such as "BAD4" are not mistaken for board points.
  const pattern = /(^|[^A-Z0-9])([A-HJ-Z]{1,2}\s*\d{1,2})(?![A-Z0-9])/giu;
  for (const match of text.matchAll(pattern)) {
    const point = parseBoardCoordinate(match[2], dimensions);
    if (!point) continue;
    const key = `${point.row},${point.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
    if (points.length >= limit) break;
  }
  return points;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    throw new ChatValidationError("聊天内容格式不正确。");
  }
  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw new ChatValidationError("请输入聊天内容。", "EMPTY_CHAT");
  if ([...text].length > CHAT_TEXT_MAX_CODE_POINTS) {
    throw new ChatValidationError(
      `聊天内容最多 ${CHAT_TEXT_MAX_CODE_POINTS} 个字符。`,
      "CHAT_TOO_LONG",
    );
  }
  if (textEncoder.encode(text).byteLength > CHAT_TEXT_MAX_BYTES) {
    throw new ChatValidationError(
      "这条消息包含的字符过大，请缩短后再发送。",
      "CHAT_TOO_LARGE",
    );
  }
  if (text.split("\n").length > CHAT_TEXT_MAX_LINES) {
    throw new ChatValidationError(
      `聊天内容最多 ${CHAT_TEXT_MAX_LINES} 行。`,
      "CHAT_TOO_MANY_LINES",
    );
  }
  return text;
}

export function normalizeChatPayload(payload, board) {
  const dimensions = boardDimensions(board);
  if (!isRecord(payload) || !dimensions) {
    throw new ChatValidationError("聊天消息格式不正确。");
  }
  const topology = normalizedTopology(board.topology);
  const kind = payload.kind === "sticker" ? "sticker" : "text";

  if (kind === "sticker") {
    if (typeof payload.stickerId !== "string" || !CHAT_STICKER_IDS.has(payload.stickerId)) {
      throw new ChatValidationError("这个表情包不存在。", "UNKNOWN_STICKER");
    }
    return {
      kind,
      stickerId: payload.stickerId,
      points: [],
      boardWidth: dimensions.width,
      boardHeight: dimensions.height,
      ...(dimensions.width === dimensions.height ? { boardSize: dimensions.width } : {}),
      boardTopology: topology,
    };
  }

  const text = normalizeText(payload.text);
  return {
    kind,
    text,
    points: extractBoardCoordinates(text, dimensions),
    boardWidth: dimensions.width,
    boardHeight: dimensions.height,
    ...(dimensions.width === dimensions.height ? { boardSize: dimensions.width } : {}),
    boardTopology: topology,
  };
}

export function chatSticker(stickerId) {
  return CHAT_STICKERS.find(({ id }) => id === stickerId) ?? null;
}

export function isStoredChatMessage(value) {
  const dimensions = boardDimensions({
    width: value?.boardWidth ?? value?.boardSize,
    height: value?.boardHeight ?? value?.boardSize,
  });
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 300 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.senderId !== "string" ||
    !value.senderId ||
    typeof value.senderName !== "string" ||
    !value.senderName ||
    value.senderName.length > 80 ||
    value.senderRole !== "player" ||
    !["black", "white"].includes(value.senderColor) ||
    !Number.isFinite(value.sentAt) ||
    !dimensions ||
    !VALID_TOPOLOGIES.has(value.boardTopology) ||
    !Number.isSafeInteger(value.moveCount) ||
    value.moveCount < 0 ||
    !Array.isArray(value.points) ||
    value.points.length > CHAT_POINT_LIMIT
  ) {
    return false;
  }
  if (
    value.points.some(
      (point) =>
        !isRecord(point) ||
        formatBoardCoordinate(point.row, point.col, dimensions) !== point.label,
    )
  ) {
    return false;
  }
  if (value.kind === "text") {
    try {
      return normalizeText(value.text) === value.text;
    } catch {
      return false;
    }
  }
  return value.kind === "sticker" && CHAT_STICKER_IDS.has(value.stickerId);
}

export function trimStoredChatHistory(messages) {
  const history = Array.isArray(messages)
    ? messages
        .filter(isStoredChatMessage)
        .slice(-CHAT_HISTORY_LIMIT)
        .map((message) => JSON.parse(JSON.stringify(message)))
    : [];
  while (
    history.length > 0 &&
    textEncoder.encode(JSON.stringify(history)).byteLength > CHAT_HISTORY_MAX_BYTES
  ) {
    history.shift();
  }
  return history;
}

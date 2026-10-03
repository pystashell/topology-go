import {
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  formatGoColumn,
} from "../game/boardDimensions.js";

export const LOBBY_BOARD_PREVIEW_ENCODING = "2bit-base64-v1";

const VALID_TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const CELL_TO_BITS = new Map([
  [null, 0],
  ["black", 1],
  ["white", 2],
]);
const BITS_TO_CELL = [null, "black", "white"];

function requireDimension(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_BOARD_DIMENSION ||
    value > MAX_BOARD_DIMENSION
  ) {
    throw new TypeError(
      `${label} must be an integer from ${MIN_BOARD_DIMENSION} to ${MAX_BOARD_DIMENSION}.`,
    );
  }
  return value;
}

function requireDimensions(width, height) {
  return {
    width: requireDimension(width, "width"),
    height: requireDimension(height, "height"),
  };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireBoard(board, width, height) {
  if (!Array.isArray(board) || board.length !== height) {
    throw new TypeError(`board must contain exactly ${height} rows.`);
  }
  for (let row = 0; row < height; row += 1) {
    if (!Array.isArray(board[row]) || board[row].length !== width) {
      throw new TypeError(`board[${row}] must contain exactly ${width} points.`);
    }
    for (let col = 0; col < width; col += 1) {
      if (!CELL_TO_BITS.has(board[row][col])) {
        throw new TypeError(`board[${row}][${col}] has an invalid stone value.`);
      }
    }
  }
  return board;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new TypeError("Lobby board preview data must be canonical base64.");
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError("Lobby board preview data must be canonical base64.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value) {
    throw new TypeError("Lobby board preview data must be canonical base64.");
  }
  return bytes;
}

function requirePreviewEnvelope(preview) {
  if (!isPlainObject(preview)) {
    throw new TypeError("Lobby board preview must be an object.");
  }
  const keys = Object.keys(preview).sort();
  if (keys.length !== 2 || keys[0] !== "data" || keys[1] !== "encoding") {
    throw new TypeError("Lobby board preview contains unexpected fields.");
  }
  if (preview.encoding !== LOBBY_BOARD_PREVIEW_ENCODING) {
    throw new TypeError("Unsupported lobby board preview encoding.");
  }
  return preview;
}

/** Pack a rectangular board into two bits per point, in row-major order. */
export function encodeLobbyBoardPreview(board, width, height) {
  const dimensions = requireDimensions(width, height);
  requireBoard(board, dimensions.width, dimensions.height);
  const pointCount = dimensions.width * dimensions.height;
  const bytes = new Uint8Array(Math.ceil(pointCount / 4));
  for (let index = 0; index < pointCount; index += 1) {
    const row = Math.floor(index / dimensions.width);
    const col = index % dimensions.width;
    const shift = 6 - (index % 4) * 2;
    bytes[Math.floor(index / 4)] |= CELL_TO_BITS.get(board[row][col]) << shift;
  }
  return {
    encoding: LOBBY_BOARD_PREVIEW_ENCODING,
    data: bytesToBase64(bytes),
  };
}

/** Decode and strictly validate a compact lobby board preview. */
export function decodeLobbyBoardPreview(preview, width, height) {
  const dimensions = requireDimensions(width, height);
  requirePreviewEnvelope(preview);
  const pointCount = dimensions.width * dimensions.height;
  const expectedLength = Math.ceil(pointCount / 4);
  const expectedBase64Length = Math.ceil(expectedLength / 3) * 4;
  if (typeof preview.data !== "string" || preview.data.length !== expectedBase64Length) {
    throw new TypeError(
      `Lobby board preview must use exactly ${expectedBase64Length} base64 characters for this board.`,
    );
  }
  const bytes = base64ToBytes(preview.data);
  if (bytes.length !== expectedLength) {
    throw new TypeError(
      `Lobby board preview must contain exactly ${expectedLength} bytes for this board.`,
    );
  }
  const board = Array.from(
    { length: dimensions.height },
    () => Array(dimensions.width).fill(null),
  );
  for (let index = 0; index < pointCount; index += 1) {
    const shift = 6 - (index % 4) * 2;
    const bits = (bytes[Math.floor(index / 4)] >> shift) & 0b11;
    if (bits === 0b11) {
      throw new TypeError("Lobby board preview contains a reserved stone value.");
    }
    board[Math.floor(index / dimensions.width)][index % dimensions.width] = BITS_TO_CELL[bits];
  }
  const unusedPoints = expectedLength * 4 - pointCount;
  if (unusedPoints > 0) {
    const unusedMask = (1 << (unusedPoints * 2)) - 1;
    if ((bytes[bytes.length - 1] & unusedMask) !== 0) {
      throw new TypeError("Lobby board preview has non-zero padding bits.");
    }
  }
  return board;
}

export function isLobbyBoardPreview(preview, width, height) {
  try {
    decodeLobbyBoardPreview(preview, width, height);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep only the public, renderable portion of a last move. Captures, analysis,
 * replay history and other room state intentionally never enter the directory.
 */
export function publicLobbyLastMove(lastMove, width, height) {
  const dimensions = requireDimensions(width, height);
  if (lastMove === undefined || lastMove === null) return null;
  if (!isPlainObject(lastMove)) throw new TypeError("lastMove must be an object or null.");
  if (lastMove.color !== "black" && lastMove.color !== "white") {
    throw new TypeError("lastMove has an invalid color.");
  }
  if (lastMove.type === "pass") {
    return { type: "pass", color: lastMove.color };
  }
  if (lastMove.type !== "play") throw new TypeError("lastMove has an invalid type.");
  if (
    !Number.isSafeInteger(lastMove.row) ||
    !Number.isSafeInteger(lastMove.col) ||
    lastMove.row < 0 ||
    lastMove.row >= dimensions.height ||
    lastMove.col < 0 ||
    lastMove.col >= dimensions.width
  ) {
    throw new TypeError("lastMove is outside the board.");
  }
  return {
    type: "play",
    color: lastMove.color,
    row: lastMove.row,
    col: lastMove.col,
  };
}

export function isLobbyLastMove(lastMove, width, height) {
  try {
    const normalized = publicLobbyLastMove(lastMove, width, height);
    if (normalized === null) return lastMove === null;
    const expectedKeys = normalized.type === "play"
      ? ["col", "color", "row", "type"]
      : ["color", "type"];
    const actualKeys = Object.keys(lastMove).sort();
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index]) &&
      Object.entries(normalized).every(([key, value]) => lastMove[key] === value);
  } catch {
    return false;
  }
}

function requirePreviewSummary(summary) {
  if (!isPlainObject(summary)) throw new TypeError("Lobby room summary is required.");
  const { width, height } = requireDimensions(summary.width, summary.height);
  if (!VALID_TOPOLOGIES.has(summary.topology)) {
    throw new TypeError("Lobby room summary has an invalid topology.");
  }
  const board = decodeLobbyBoardPreview(summary.boardPreview, width, height);
  const lastMove = publicLobbyLastMove(summary.lastMove, width, height);
  return { width, height, board, lastMove, topology: summary.topology };
}

function topologyLabel(topology, english) {
  if (english) {
    return topology === "torus" ? "torus" : topology === "mobius" ? "Mobius strip" : "cylinder";
  }
  return topology === "torus" ? "甜甜圈" : topology === "mobius" ? "莫比乌斯" : "竹筒";
}

/** Build an aria-label/alt-text description without exposing room-private data. */
export function describeLobbyBoardPreview(summary, options = {}) {
  const { width, height, board, lastMove, topology } = requirePreviewSummary(summary);
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const point of row) {
      if (point === "black") black += 1;
      if (point === "white") white += 1;
    }
  }
  const english = String(options.locale ?? "").toLowerCase().startsWith("en");
  let moveText = "";
  if (lastMove?.type === "play") {
    const coordinate = `${formatGoColumn(lastMove.col)}${height - lastMove.row}`;
    moveText = english
      ? ` Last move: ${lastMove.color} at ${coordinate}.`
      : ` 最后一手：${lastMove.color === "black" ? "黑" : "白"}棋 ${coordinate}。`;
  } else if (lastMove?.type === "pass") {
    moveText = english
      ? ` Last move: ${lastMove.color} passed.`
      : ` 最后一手：${lastMove.color === "black" ? "黑" : "白"}方停一手。`;
  }
  return english
    ? `${width} by ${height} ${topologyLabel(topology, true)} board. ${black} black stone${black === 1 ? "" : "s"} and ${white} white stone${white === 1 ? "" : "s"}.${moveText}`
    : `${width} × ${height} ${topologyLabel(topology, false)}棋盘，黑棋 ${black} 子，白棋 ${white} 子。${moveText}`;
}

function drawSeamMarker(context, x, y, direction, size) {
  context.beginPath();
  context.moveTo(x, y + direction * size);
  context.lineTo(x - size * 0.7, y - direction * size * 0.35);
  context.lineTo(x + size * 0.7, y - direction * size * 0.35);
  context.closePath();
  context.fill();
}

/** Render a lightweight, square-cell board thumbnail into a Canvas element. */
export function renderLobbyBoardPreview(canvas, summary, options = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("A Canvas element is required.");
  }
  const context = canvas.getContext("2d");
  if (!context) throw new TypeError("A 2D canvas context is required.");
  const { width, height, board, lastMove, topology } = requirePreviewSummary(summary);
  const pixelWidth = Number(options.width ?? canvas.width);
  const pixelHeight = Number(options.height ?? canvas.height);
  if (!Number.isFinite(pixelWidth) || pixelWidth <= 0 || !Number.isFinite(pixelHeight) || pixelHeight <= 0) {
    throw new TypeError("Canvas dimensions must be positive finite numbers.");
  }

  context.save();
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.fillStyle = options.background ?? "#cda55d";
  context.fillRect(0, 0, pixelWidth, pixelHeight);

  const margin = Math.max(7, Math.min(pixelWidth, pixelHeight) * 0.09);
  const step = Math.min(
    (pixelWidth - margin * 2) / (width - 1),
    (pixelHeight - margin * 2) / (height - 1),
  );
  const gridWidth = step * (width - 1);
  const gridHeight = step * (height - 1);
  const originX = (pixelWidth - gridWidth) / 2;
  const originY = (pixelHeight - gridHeight) / 2;
  context.strokeStyle = options.gridColor ?? "rgba(45, 31, 15, 0.72)";
  context.lineWidth = Math.max(0.7, Math.min(1.4, step * 0.1));
  context.beginPath();
  for (let col = 0; col < width; col += 1) {
    const x = originX + col * step;
    context.moveTo(x, originY);
    context.lineTo(x, originY + gridHeight);
  }
  for (let row = 0; row < height; row += 1) {
    const y = originY + row * step;
    context.moveTo(originX, y);
    context.lineTo(originX + gridWidth, y);
  }
  context.stroke();

  context.save();
  context.strokeStyle = options.seamColor ?? "rgba(104, 53, 15, 0.95)";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Math.max(1.5, Math.min(3, step * 0.24));
  if (typeof context.setLineDash === "function") context.setLineDash([Math.max(2, step * 0.34), Math.max(2, step * 0.24)]);
  context.beginPath();
  context.moveTo(originX, originY);
  context.lineTo(originX, originY + gridHeight);
  context.moveTo(originX + gridWidth, originY);
  context.lineTo(originX + gridWidth, originY + gridHeight);
  if (topology === "torus") {
    context.moveTo(originX, originY);
    context.lineTo(originX + gridWidth, originY);
    context.moveTo(originX, originY + gridHeight);
    context.lineTo(originX + gridWidth, originY + gridHeight);
  }
  context.stroke();
  if (typeof context.setLineDash === "function") context.setLineDash([]);
  if (topology === "mobius") {
    const markerSize = Math.max(2.2, Math.min(5, step * 0.42));
    drawSeamMarker(context, originX, originY + markerSize * 1.5, 1, markerSize);
    drawSeamMarker(context, originX + gridWidth, originY + gridHeight - markerSize * 1.5, -1, markerSize);
  }
  context.restore();

  const stoneRadius = Math.max(1.4, step * 0.39);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const stone = board[row][col];
      if (stone === null) continue;
      const x = originX + col * step;
      const y = originY + row * step;
      context.beginPath();
      context.arc(x, y, stoneRadius, 0, Math.PI * 2);
      context.fillStyle = stone === "black" ? "#151718" : "#f4f3ec";
      context.fill();
      context.strokeStyle = stone === "black" ? "#050606" : "#77746b";
      context.lineWidth = Math.max(0.55, step * 0.06);
      context.stroke();
    }
  }
  if (lastMove?.type === "play") {
    const x = originX + lastMove.col * step;
    const y = originY + lastMove.row * step;
    context.beginPath();
    context.arc(x, y, Math.max(0.8, stoneRadius * 0.38), 0, Math.PI * 2);
    context.strokeStyle = lastMove.color === "black" ? "#f7d57a" : "#8b2e24";
    context.lineWidth = Math.max(1, step * 0.1);
    context.stroke();
  }
  context.restore();

  const description = describeLobbyBoardPreview(summary, options);
  if (typeof canvas.setAttribute === "function") {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", description);
  }
  return description;
}

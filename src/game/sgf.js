/**
 * Small, dependency-free SGF FF[4] reader/writer.
 *
 * Standard readers can consume every exported move. Project-only semantics
 * use ignorable private properties:
 *
 *   XTOP[cylinder|torus|mobius]  connected-board topology
 *   XRESUME[B|W]                 resume play and choose the next player
 *   XDEAD[aa]                    toggle the dead group at a point
 *   XFINISH[chinese|japanese]    finish scoring with the selected rule
 *   XCONFIRM[B|W]                online score confirmation (not a GoEngine event)
 *   XCOMPLETE[0|1]               whether the replay starts at the true beginning
 *
 * Unknown X* properties are preserved as metadata by importSgf().
 */

const BLACK = "black";
const WHITE = "white";
const EMPTY = null;
const REPLAY_VERSION = 1;

const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const VALID_SCORING_RULES = new Set(["chinese", "japanese"]);
const SGF_COORDINATE_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const SGF_EXTENSION_PROPERTIES = Object.freeze({
  topology: "XTOP",
  resumePlay: "XRESUME",
  toggleDead: "XDEAD",
  finishScoring: "XFINISH",
  scoreConfirmation: "XCONFIRM",
  replayComplete: "XCOMPLETE",
});

export const SGF_DEFAULT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxNodes: 10_000,
  maxTreeDepth: 64,
  maxPropertiesPerNode: 256,
  maxPropertyValues: 20_000,
  maxValueLength: 256 * 1024,
  maxPropertyIdentifierLength: 32,
  // GoEngine's supported range. Callers that only inspect SGF metadata may
  // explicitly raise this up to the 52 coordinates supported by this module.
  maxBoardDimension: 25,
});

export class SgfError extends Error {
  constructor(message, code = "INVALID_SGF", details = {}) {
    super(message);
    this.name = "SgfError";
    this.code = code;
    Object.assign(this, details);
  }
}

function warning(code, message, details = {}) {
  return { code, message, ...details };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeLimits(overrides) {
  const merged = { ...SGF_DEFAULT_LIMITS };
  if (overrides === undefined) return merged;
  if (!isPlainObject(overrides)) {
    throw new TypeError("SGF limits must be a plain object");
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(merged, key)) continue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`SGF limit ${key} must be a positive safe integer`);
    }
    merged[key] = value;
  }
  return merged;
}

/** Escape one SGF property value without changing its visible text. */
export function escapeSgfValue(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\\/gu, "\\\\")
    .replace(/\]/gu, "\\]");
}

function property(identifier, values) {
  const list = Array.isArray(values) ? values : [values];
  return `${identifier}${list.map((value) => `[${escapeSgfValue(value)}]`).join("")}`;
}

function colorToSgf(color, label = "color") {
  if (color === BLACK || color === "B") return "B";
  if (color === WHITE || color === "W") return "W";
  throw new SgfError(`${label} must be black or white`, "INVALID_COLOR");
}

function colorFromSgf(value, label = "color") {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "B" || normalized === "BLACK") return BLACK;
  if (normalized === "W" || normalized === "WHITE") return WHITE;
  throw new SgfError(`${label} must be B or W`, "INVALID_COLOR");
}

function oppositeColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function normalizeRule(value, warnings, context = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "japanese";
  if (
    normalized.includes("chinese") ||
    normalized.includes("aga") ||
    normalized.includes("new zealand") ||
    normalized.includes("tromp")
  ) {
    return "chinese";
  }
  if (
    normalized.includes("japanese") ||
    normalized.includes("korean") ||
    normalized === "japan"
  ) {
    return "japanese";
  }
  warnings.push(
    warning(
      "UNKNOWN_RULE",
      `Unknown SGF rules '${value}'; Japanese scoring was selected for replay.`,
      context,
    ),
  );
  return "japanese";
}

function ruleToSgf(value) {
  return String(value ?? "").toLowerCase() === "chinese" ? "Chinese" : "Japanese";
}

function formatNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new SgfError(`${label} must be a finite number`, "INVALID_NUMBER");
  }
  return Object.is(number, -0) ? "0" : String(number);
}

function dimensionFrom(value, label, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 3 || number > maximum) {
    throw new SgfError(
      `${label} must be an integer from 3 to ${maximum}`,
      "INVALID_BOARD_SIZE",
    );
  }
  return number;
}

function inferDimensions(base, limits) {
  const board = Array.isArray(base?.board) ? base.board : null;
  const sizeObject = isPlainObject(base?.size) ? base.size : null;
  const width =
    base?.width ??
    sizeObject?.width ??
    (board?.[0] && Array.isArray(board[0]) ? board[0].length : undefined) ??
    (!sizeObject ? base?.size : undefined);
  const height =
    base?.height ??
    sizeObject?.height ??
    board?.length ??
    (!sizeObject ? base?.size : undefined);
  return {
    width: dimensionFrom(width, "board width", limits.maxBoardDimension),
    height: dimensionFrom(height, "board height", limits.maxBoardDimension),
  };
}

export function encodeSgfPoint(row, col, width, height = width) {
  if (
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(col) ||
    row < 0 ||
    col < 0 ||
    row >= height ||
    col >= width ||
    width > SGF_COORDINATE_ALPHABET.length ||
    height > SGF_COORDINATE_ALPHABET.length
  ) {
    throw new SgfError("Point is outside the SGF board", "POINT_OUT_OF_BOUNDS");
  }
  return `${SGF_COORDINATE_ALPHABET[col]}${SGF_COORDINATE_ALPHABET[row]}`;
}

export function decodeSgfPoint(value, width, height = width) {
  const text = String(value ?? "");
  if (text.length !== 2) {
    throw new SgfError(`Invalid SGF point '${text}'`, "INVALID_POINT");
  }
  const col = SGF_COORDINATE_ALPHABET.indexOf(text[0]);
  const row = SGF_COORDINATE_ALPHABET.indexOf(text[1]);
  if (row < 0 || col < 0 || row >= height || col >= width) {
    throw new SgfError(`SGF point '${text}' is outside the board`, "POINT_OUT_OF_BOUNDS");
  }
  return { row, col };
}

function boardHash(board) {
  return board
    .map((row) =>
      row.map((point) => (point === BLACK ? "B" : point === WHITE ? "W" : ".")).join(""),
    )
    .join("/");
}

function validateBoard(base, width, height) {
  const board = base?.board;
  if (!Array.isArray(board) || board.length !== height) {
    throw new SgfError("Replay base board has the wrong height", "INVALID_BOARD");
  }
  return board.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new SgfError(
        `Replay base board row ${rowIndex} has the wrong width`,
        "INVALID_BOARD",
      );
    }
    return row.map((point) => {
      if (point !== EMPTY && point !== BLACK && point !== WHITE) {
        throw new SgfError("Replay base contains an invalid stone", "INVALID_BOARD");
      }
      return point;
    });
  });
}

function normalizeExportInput(input) {
  if (!isPlainObject(input)) {
    throw new TypeError("SGF export input must be a replay or record object");
  }
  const replay = isPlainObject(input.replay) ? input.replay : input;
  if (!isPlainObject(replay.base) || !Array.isArray(replay.events)) {
    throw new SgfError("SGF export requires replay.base and replay.events", "INVALID_REPLAY");
  }
  return { record: input, replay };
}

function metadataValue(record, options, ...keys) {
  for (const source of [options, options.metadata, record.metadata, record]) {
    if (!isPlainObject(source)) continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
}

function normalizedTopology(value) {
  const topology = String(value ?? "cylinder").toLowerCase();
  if (!VALID_TOPOLOGIES.has(topology)) {
    throw new SgfError(`Unknown board topology '${value}'`, "INVALID_TOPOLOGY");
  }
  return topology;
}

function resultToSgf(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!isPlainObject(value)) return "";
  if (value.draw === true || value.winner === "draw") return "0";
  const winner = value.winner === BLACK ? "B" : value.winner === WHITE ? "W" : "";
  if (!winner) return "";
  if (value.resignation === true || value.reason === "resign") return `${winner}+R`;
  if (value.reason === "timeout" || value.timeout === true) return `${winner}+T`;
  const margin = value.margin ?? value.difference ?? value.score;
  return Number.isFinite(Number(margin)) ? `${winner}+${Math.abs(Number(margin))}` : winner;
}

/**
 * Export a compact GoEngine replay (or `{ replay, metadata }`) as SGF.
 * Returns `{ sgf, warnings }`; warnings describe intentionally non-standard
 * extensions or skipped unsupported metadata, never silently lost moves.
 */
export function exportSgf(input, options = {}) {
  if (!isPlainObject(options)) throw new TypeError("SGF export options must be an object");
  const limits = mergeLimits(options.limits);
  const { record, replay } = normalizeExportInput(input);
  const base = replay.base;
  const { width, height } = inferDimensions(base, limits);
  const board = validateBoard(base, width, height);
  const warnings = [];
  const topology = normalizedTopology(options.topology ?? base.topology);
  const scoringRule = String(options.scoringRule ?? base.scoringRule ?? "japanese").toLowerCase();
  if (!VALID_SCORING_RULES.has(scoringRule)) {
    throw new SgfError(`Unknown scoring rule '${scoringRule}'`, "INVALID_RULE");
  }

  const root = [
    property("FF", "4"),
    property("GM", "1"),
    property("CA", "UTF-8"),
    property("AP", "3D Baduk:1"),
    property("SZ", width === height ? width : `${width}:${height}`),
    property("KM", formatNumber(base.komi ?? 0, "komi")),
    property("RU", metadataValue(record, options, "rules", "rule") ?? ruleToSgf(scoringRule)),
    property(SGF_EXTENSION_PROPERTIES.topology, topology),
  ];

  warnings.push(
    warning(
      "NONSTANDARD_TOPOLOGY",
      `Topology '${topology}' is stored in the ignorable ${SGF_EXTENSION_PROPERTIES.topology} extension.`,
    ),
  );
  if (width !== height) {
    warnings.push(
      warning("RECTANGULAR_BOARD", "The rectangular board uses the standard SZ[width:height] form."),
    );
  }
  if (replay.complete === false) {
    root.push(property(SGF_EXTENSION_PROPERTIES.replayComplete, "0"));
  }

  const blackName = metadataValue(record, options, "blackPlayer", "blackName", "PB");
  const whiteName = metadataValue(record, options, "whitePlayer", "whiteName", "PW");
  const result = resultToSgf(metadataValue(record, options, "result", "RE"));
  if (blackName !== undefined) root.push(property("PB", blackName));
  if (whiteName !== undefined) root.push(property("PW", whiteName));
  if (result) root.push(property("RE", result));

  const blackSetup = [];
  const whiteSetup = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (board[row][col] === BLACK) blackSetup.push(encodeSgfPoint(row, col, width, height));
      if (board[row][col] === WHITE) whiteSetup.push(encodeSgfPoint(row, col, width, height));
    }
  }
  if (blackSetup.length) root.push(property("AB", blackSetup));
  if (whiteSetup.length) root.push(property("AW", whiteSetup));
  if (base.currentPlayer && base.currentPlayer !== BLACK) {
    root.push(property("PL", colorToSgf(base.currentPlayer, "base.currentPlayer")));
  }

  const rootConfirmations = metadataValue(record, options, "scoreConfirmations");
  if (Array.isArray(rootConfirmations) && rootConfirmations.length) {
    root.push(
      property(
        SGF_EXTENSION_PROPERTIES.scoreConfirmation,
        rootConfirmations.map((color) => colorToSgf(color, "score confirmation")),
      ),
    );
  }

  const nodes = [`;${root.join("")}`];
  for (let index = 0; index < replay.events.length; index += 1) {
    const event = replay.events[index];
    if (!isPlainObject(event)) {
      throw new SgfError(`Replay event ${index} must be an object`, "INVALID_REPLAY_EVENT");
    }
    if (event.type === "play") {
      const color = colorToSgf(event.color, `event ${index} color`);
      nodes.push(`;${property(color, encodeSgfPoint(event.row, event.col, width, height))}`);
    } else if (event.type === "pass") {
      nodes.push(`;${property(colorToSgf(event.color, `event ${index} color`), "")}`);
    } else if (event.type === "resume_play") {
      nodes.push(
        `;${property(
          SGF_EXTENSION_PROPERTIES.resumePlay,
          colorToSgf(event.nextPlayer, `event ${index} nextPlayer`),
        )}`,
      );
    } else if (event.type === "toggle_dead") {
      nodes.push(
        `;${property(
          SGF_EXTENSION_PROPERTIES.toggleDead,
          encodeSgfPoint(event.row, event.col, width, height),
        )}`,
      );
    } else if (event.type === "finish_scoring") {
      const rule = String(event.rule ?? scoringRule).toLowerCase();
      if (!VALID_SCORING_RULES.has(rule)) {
        throw new SgfError(`Event ${index} has an invalid scoring rule`, "INVALID_RULE");
      }
      nodes.push(`;${property(SGF_EXTENSION_PROPERTIES.finishScoring, rule)}`);
    } else if (event.type === "resign") {
      // Standard SGF stores resignation in the root RE property rather than as
      // a move node. `resultToSgf` has already encoded it as B+R or W+R.
    } else if (["confirm_score", "score_confirmation"].includes(event.type)) {
      nodes.push(
        `;${property(
          SGF_EXTENSION_PROPERTIES.scoreConfirmation,
          colorToSgf(event.color, `event ${index} color`),
        )}`,
      );
    } else {
      warnings.push(
        warning(
          "SKIPPED_EVENT",
          `Replay event ${index} has unsupported type '${event.type}' and was skipped.`,
          { eventIndex: index },
        ),
      );
    }
  }

  const extensionEvents = metadataValue(record, options, "extensionEvents");
  if (Array.isArray(extensionEvents)) {
    for (const [index, event] of extensionEvents.entries()) {
      if (
        isPlainObject(event) &&
        ["confirm_score", "score_confirmation"].includes(event.type)
      ) {
        nodes.push(
          `;${property(
            SGF_EXTENSION_PROPERTIES.scoreConfirmation,
            colorToSgf(event.color, `extension event ${index} color`),
          )}`,
        );
      } else {
        warnings.push(
          warning("SKIPPED_EXTENSION_EVENT", `Unsupported extension event ${index} was skipped.`, {
            eventIndex: index,
          }),
        );
      }
    }
  }

  const sgf = `(${nodes.join("\n")})`;
  if (new TextEncoder().encode(sgf).byteLength > limits.maxBytes) {
    throw new SgfError("Exported SGF exceeds the configured byte limit", "SGF_TOO_LARGE");
  }
  return { sgf, warnings };
}

class SgfParser {
  constructor(text, limits, warnings) {
    this.text = text;
    this.limits = limits;
    this.warnings = warnings;
    this.offset = 0;
    this.nodeCount = 0;
    this.valueCount = 0;
  }

  fail(message, code = "INVALID_SGF") {
    throw new SgfError(message, code, { offset: this.offset });
  }

  skipWhitespace() {
    while (/\s/u.test(this.text[this.offset] ?? "")) this.offset += 1;
  }

  expect(character) {
    if (this.text[this.offset] !== character) {
      this.fail(`Expected '${character}' at offset ${this.offset}`);
    }
    this.offset += 1;
  }

  parseCollection() {
    const trees = [];
    this.skipWhitespace();
    while (this.text[this.offset] === "(") {
      trees.push(this.parseTree(1));
      this.skipWhitespace();
    }
    if (!trees.length) this.fail("SGF collection must contain a game tree");
    if (this.offset !== this.text.length) {
      this.fail(`Unexpected input at offset ${this.offset}`);
    }
    return trees;
  }

  parseTree(depth) {
    if (depth > this.limits.maxTreeDepth) {
      this.fail("SGF variation nesting exceeds the configured limit", "SGF_TOO_DEEP");
    }
    this.expect("(");
    this.skipWhitespace();
    const nodes = [];
    while (this.text[this.offset] === ";") {
      nodes.push(this.parseNode());
      this.skipWhitespace();
    }
    if (!nodes.length) this.fail("Every SGF game tree must contain at least one node");
    const children = [];
    while (this.text[this.offset] === "(") {
      children.push(this.parseTree(depth + 1));
      this.skipWhitespace();
    }
    this.expect(")");
    return { nodes, children };
  }

  parseNode() {
    this.expect(";");
    this.nodeCount += 1;
    if (this.nodeCount > this.limits.maxNodes) {
      this.fail("SGF contains too many nodes", "SGF_TOO_MANY_NODES");
    }
    const properties = [];
    this.skipWhitespace();
    while (/[A-Za-z]/u.test(this.text[this.offset] ?? "")) {
      const start = this.offset;
      while (/[A-Za-z]/u.test(this.text[this.offset] ?? "")) this.offset += 1;
      const rawIdentifier = this.text.slice(start, this.offset);
      if (rawIdentifier.length > this.limits.maxPropertyIdentifierLength) {
        this.fail("SGF property identifier is too long", "SGF_PROPERTY_TOO_LONG");
      }
      const identifier = rawIdentifier.toUpperCase();
      if (rawIdentifier !== identifier) {
        this.warnings.push(
          warning("NORMALIZED_PROPERTY_ID", `Property '${rawIdentifier}' was normalized to '${identifier}'.`),
        );
      }
      this.skipWhitespace();
      if (this.text[this.offset] !== "[") {
        this.fail(`Property ${identifier} has no value`);
      }
      const values = [];
      while (this.text[this.offset] === "[") {
        values.push(this.parseValue());
        this.valueCount += 1;
        if (this.valueCount > this.limits.maxPropertyValues) {
          this.fail("SGF contains too many property values", "SGF_TOO_MANY_VALUES");
        }
        this.skipWhitespace();
      }
      properties.push({ identifier, values });
      if (properties.length > this.limits.maxPropertiesPerNode) {
        this.fail("SGF node contains too many properties", "SGF_TOO_MANY_PROPERTIES");
      }
    }
    return { properties };
  }

  parseValue() {
    this.expect("[");
    let value = "";
    while (this.offset < this.text.length) {
      const character = this.text[this.offset++];
      if (character === "]") return value.replace(/\r\n?/gu, "\n");
      if (character === "\\") {
        if (this.offset >= this.text.length) {
          this.fail("SGF value ends with an incomplete escape");
        }
        const escaped = this.text[this.offset++];
        if (escaped === "\r") {
          if (this.text[this.offset] === "\n") this.offset += 1;
          continue;
        }
        if (escaped === "\n") continue;
        value += escaped;
      } else {
        value += character;
      }
      if (value.length > this.limits.maxValueLength) {
        this.fail("SGF property value is too long", "SGF_VALUE_TOO_LONG");
      }
    }
    this.fail("Unterminated SGF property value");
  }
}

function flattenMainLine(tree, output = []) {
  output.push(...tree.nodes);
  if (tree.children[0]) flattenMainLine(tree.children[0], output);
  return output;
}

function countVariations(tree) {
  let count = Math.max(0, tree.children.length - 1);
  for (const child of tree.children) count += countVariations(child);
  return count;
}

function propertyValues(node, identifier) {
  return node.properties
    .filter((entry) => entry.identifier === identifier)
    .flatMap((entry) => entry.values);
}

function firstProperty(node, identifier) {
  return propertyValues(node, identifier)[0];
}

function parseSize(value, limits) {
  const text = String(value ?? "19").trim();
  const match = /^(\d+)(?::(\d+))?$/u.exec(text);
  if (!match) throw new SgfError(`Invalid SZ value '${text}'`, "INVALID_BOARD_SIZE");
  return {
    width: dimensionFrom(match[1], "board width", limits.maxBoardDimension),
    height: dimensionFrom(match[2] ?? match[1], "board height", limits.maxBoardDimension),
  };
}

function decodeSetupValue(value, width, height) {
  const parts = String(value).split(":");
  if (parts.length === 1) return [decodeSgfPoint(parts[0], width, height)];
  if (parts.length !== 2) {
    throw new SgfError(`Invalid compressed point '${value}'`, "INVALID_POINT");
  }
  const start = decodeSgfPoint(parts[0], width, height);
  const end = decodeSgfPoint(parts[1], width, height);
  const points = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
      points.push({ row, col });
    }
  }
  return points;
}

function setSetupStones(board, values, color, width, height) {
  for (const value of values) {
    for (const { row, col } of decodeSetupValue(value, width, height)) {
      if (board[row][col] !== EMPTY && board[row][col] !== color) {
        throw new SgfError(`Setup stones overlap at '${value}'`, "OVERLAPPING_SETUP");
      }
      board[row][col] = color;
    }
  }
}

function decodeMove(value, width, height, warnings, context) {
  if (value === "") return null;
  try {
    return decodeSgfPoint(value, width, height);
  } catch (error) {
    if (
      error instanceof SgfError &&
      error.code === "POINT_OUT_OF_BOUNDS" &&
      value.toLowerCase() === "tt" &&
      width <= 19 &&
      height <= 19
    ) {
      warnings.push(
        warning("LEGACY_TT_PASS", "Legacy tt pass was normalized to an empty SGF move.", context),
      );
      return null;
    }
    throw error;
  }
}

function parseKomi(value, warnings) {
  if (value === undefined || value === "") return 0;
  const komi = Number(value);
  if (!Number.isFinite(komi)) {
    warnings.push(warning("INVALID_KOMI", `Invalid KM value '${value}' was replaced with 0.`));
    return 0;
  }
  return komi;
}

function rootMetadata(root, warnings) {
  return {
    format: firstProperty(root, "FF") ?? "",
    game: firstProperty(root, "GM") ?? "",
    charset: firstProperty(root, "CA") ?? "",
    application: firstProperty(root, "AP") ?? "",
    komi: parseKomi(firstProperty(root, "KM"), warnings),
    rules: firstProperty(root, "RU") ?? "",
    blackPlayer: firstProperty(root, "PB") ?? "",
    whitePlayer: firstProperty(root, "PW") ?? "",
    result: firstProperty(root, "RE") ?? "",
  };
}

function makeReplayBase({ width, height, board, komi, scoringRule, topology, currentPlayer }) {
  return {
    ...(width === height ? { size: width } : {}),
    width,
    height,
    komi,
    scoringRule,
    topology,
    board,
    currentPlayer,
    phase: "play",
    consecutivePasses: 0,
    captures: { [BLACK]: 0, [WHITE]: 0 },
    deadStones: [],
    lastMove: null,
    result: null,
    positionHistory: [boardHash(board)],
    undoHistory: [],
  };
}

/**
 * Parse an SGF collection and import the first game tree's main branch.
 * Returns replay-ready data plus metadata, dimensions, extension events and
 * structured warnings. Other variations/games are safely parsed, then ignored.
 */
export function importSgf(input, options = {}) {
  if (typeof input !== "string") throw new TypeError("SGF input must be a string");
  if (!isPlainObject(options)) throw new TypeError("SGF import options must be an object");
  const limits = mergeLimits(options.limits);
  if (new TextEncoder().encode(input).byteLength > limits.maxBytes) {
    throw new SgfError("SGF input exceeds the configured byte limit", "SGF_TOO_LARGE");
  }
  if (input.includes("\0")) {
    throw new SgfError("SGF input contains a NUL character", "INVALID_SGF");
  }

  const warnings = [];
  const parser = new SgfParser(input, limits, warnings);
  const collection = parser.parseCollection();
  if (collection.length > 1) {
    warnings.push(
      warning("IGNORED_GAMES", `Only the first of ${collection.length} SGF game trees was imported.`),
    );
  }
  const ignoredVariations = countVariations(collection[0]);
  if (ignoredVariations > 0) {
    warnings.push(
      warning(
        "IGNORED_VARIATIONS",
        `${ignoredVariations} non-main SGF variation branch(es) were ignored.`,
      ),
    );
  }

  const nodes = flattenMainLine(collection[0]);
  const root = nodes[0];
  const gm = firstProperty(root, "GM");
  if (gm !== undefined && gm !== "1") {
    throw new SgfError(`Unsupported SGF game type GM[${gm}]`, "UNSUPPORTED_GAME");
  }
  if (gm === undefined) warnings.push(warning("MISSING_GM", "GM was absent; Go (GM[1]) was assumed."));
  const ff = firstProperty(root, "FF");
  if (ff !== undefined && ff !== "4") {
    warnings.push(warning("NON_FF4", `SGF FF[${ff}] was parsed using FF[4] compatibility rules.`));
  }
  const charset = firstProperty(root, "CA");
  if (charset && charset.toUpperCase() !== "UTF-8") {
    warnings.push(
      warning(
        "CHARSET_ASSUMED_UTF8",
        `SGF declares CA[${charset}], but the supplied JavaScript string was treated as UTF-8 text.`,
      ),
    );
  }

  const sizeValue = firstProperty(root, "SZ");
  if (sizeValue === undefined) warnings.push(warning("MISSING_SIZE", "SZ was absent; 19x19 was assumed."));
  const { width, height } = parseSize(sizeValue ?? "19", limits);
  const metadata = rootMetadata(root, warnings);
  const scoringRule = normalizeRule(metadata.rules, warnings);

  const topologyValue = firstProperty(root, SGF_EXTENSION_PROPERTIES.topology);
  const fallbackTopology = normalizedTopology(options.defaultTopology ?? "cylinder");
  let topology = fallbackTopology;
  if (topologyValue !== undefined) {
    topology = normalizedTopology(topologyValue);
  } else {
    warnings.push(
      warning(
        "TOPOLOGY_ASSUMED",
        `SGF has no ${SGF_EXTENSION_PROPERTIES.topology}; '${fallbackTopology}' was selected for replay.`,
      ),
    );
  }

  const board = Array.from({ length: height }, () => Array(width).fill(EMPTY));
  setSetupStones(board, propertyValues(root, "AB"), BLACK, width, height);
  setSetupStones(board, propertyValues(root, "AW"), WHITE, width, height);

  let firstMoveColor = null;
  for (const node of nodes) {
    for (const { identifier } of node.properties) {
      if (identifier === "B" || identifier === "W") {
        firstMoveColor = identifier === "B" ? BLACK : WHITE;
        break;
      }
    }
    if (firstMoveColor) break;
  }
  const currentPlayer = firstProperty(root, "PL")
    ? colorFromSgf(firstProperty(root, "PL"), "PL")
    : firstMoveColor ?? BLACK;

  const replayEvents = [];
  const extensionEvents = [];
  const unknownExtensions = [];
  let expectedPlayer = currentPlayer;

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (nodeIndex > 0 && ["AB", "AW", "AE"].some((id) => propertyValues(node, id).length)) {
      warnings.push(
        warning(
          "IGNORED_MIDGAME_SETUP",
          "Mid-game setup properties cannot be represented by GoEngine replay events and were ignored.",
          { nodeIndex },
        ),
      );
    }
    for (const entry of node.properties) {
      const { identifier, values } = entry;
      if (identifier === "B" || identifier === "W") {
        if (values.length !== 1) {
          throw new SgfError(`${identifier} must have exactly one value`, "INVALID_MOVE", { nodeIndex });
        }
        const color = identifier === "B" ? BLACK : WHITE;
        if (color !== expectedPlayer) {
          warnings.push(
            warning(
              "NON_ALTERNATING_MOVE",
              `Node ${nodeIndex} plays ${identifier} when ${colorToSgf(expectedPlayer)} was expected.`,
              { nodeIndex },
            ),
          );
        }
        const point = decodeMove(values[0], width, height, warnings, { nodeIndex });
        replayEvents.push(
          point ? { type: "play", color, ...point } : { type: "pass", color },
        );
        expectedPlayer = oppositeColor(color);
      } else if (identifier === SGF_EXTENSION_PROPERTIES.resumePlay) {
        for (const value of values) {
          const nextPlayer = colorFromSgf(value, SGF_EXTENSION_PROPERTIES.resumePlay);
          replayEvents.push({ type: "resume_play", nextPlayer });
          expectedPlayer = nextPlayer;
        }
      } else if (identifier === SGF_EXTENSION_PROPERTIES.toggleDead) {
        for (const value of values) {
          replayEvents.push({
            type: "toggle_dead",
            ...decodeSgfPoint(value, width, height),
          });
        }
      } else if (identifier === SGF_EXTENSION_PROPERTIES.finishScoring) {
        for (const value of values) {
          const rule = String(value).toLowerCase();
          if (!VALID_SCORING_RULES.has(rule)) {
            throw new SgfError(`Invalid ${identifier} rule '${value}'`, "INVALID_RULE", {
              nodeIndex,
            });
          }
          replayEvents.push({ type: "finish_scoring", rule });
        }
      } else if (identifier === SGF_EXTENSION_PROPERTIES.scoreConfirmation) {
        for (const value of values) {
          extensionEvents.push({
            type: "confirm_score",
            color: colorFromSgf(value, SGF_EXTENSION_PROPERTIES.scoreConfirmation),
            nodeIndex,
          });
        }
      } else if (
        identifier.startsWith("X") &&
        !Object.values(SGF_EXTENSION_PROPERTIES).includes(identifier)
      ) {
        unknownExtensions.push({ identifier, values: [...values], nodeIndex });
      } else if (identifier === "PL" && nodeIndex > 0) {
        warnings.push(
          warning(
            "IGNORED_MIDGAME_PLAYER",
            "A mid-game PL property was retained only as metadata; GoEngine replay cannot change turns arbitrarily.",
            { nodeIndex },
          ),
        );
      }
    }
  }

  const completeValue = firstProperty(root, SGF_EXTENSION_PROPERTIES.replayComplete);
  const replay = {
    version: REPLAY_VERSION,
    complete: completeValue === undefined ? true : !["0", "false", "no"].includes(completeValue.toLowerCase()),
    base: makeReplayBase({
      width,
      height,
      board,
      komi: metadata.komi,
      scoringRule,
      topology,
      currentPlayer,
    }),
    events: replayEvents,
  };

  return {
    replay,
    width,
    height,
    metadata: { ...metadata, scoringRule, topology },
    extensionEvents,
    extensions: { unknown: unknownExtensions },
    warnings,
  };
}

export default Object.freeze({ exportSgf, importSgf });

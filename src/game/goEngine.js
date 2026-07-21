import { mobiusPointFromCover } from "./mobiusTopology.js";

/**
 * Pure Go rules for periodically connected boards.
 *
 * Cylinders retain their normal top/bottom boundaries while columns are
 * periodic. Tori make both rows and columns periodic. Mobius strips retain one
 * boundary and reverse rows across the column seam. Stones are intersections.
 */

export const EMPTY = null;
export const BLACK = "black";
export const WHITE = "white";

export const PHASE_PLAY = "play";
export const PHASE_SCORING = "scoring";
export const PHASE_FINISHED = "finished";

export const SCORING_JAPANESE = "japanese";
export const SCORING_CHINESE = "chinese";

export const TOPOLOGY_CYLINDER = "cylinder";
export const TOPOLOGY_TORUS = "torus";
export const TOPOLOGY_MOBIUS = "mobius";

// Undo snapshots contain a complete board so that captures, scoring transitions
// and persistence restore exactly. Keeping only the latest 32 moves bounds the
// Durable Object value size even on a dense 25x25 board.
export const UNDO_HISTORY_LIMIT = 32;
export const REPLAY_VERSION = 1;

export const MOVE_ERRORS = Object.freeze({
  GAME_NOT_PLAYING: "game_not_playing",
  OUT_OF_BOUNDS: "out_of_bounds",
  OCCUPIED: "occupied",
  SUICIDE: "suicide",
  SUPERKO: "superko",
  GAME_NOT_SCORING: "game_not_scoring",
  EMPTY_POINT: "empty_point",
  NOTHING_TO_UNDO: "nothing_to_undo",
});

const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_PHASES = new Set([PHASE_PLAY, PHASE_SCORING, PHASE_FINISHED]);
const VALID_TOPOLOGIES = new Set([
  TOPOLOGY_CYLINDER,
  TOPOLOGY_TORUS,
  TOPOLOGY_MOBIUS,
]);

export function oppositeColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function pointKey(row, col) {
  return `${row},${col}`;
}

function parsePointKey(key) {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function makeEmptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(EMPTY));
}

function copyBoard(board) {
  return board.map((row) => [...row]);
}

function normalizeScoringRule(rule) {
  if (rule === SCORING_JAPANESE || rule === "territory") {
    return SCORING_JAPANESE;
  }
  if (rule === SCORING_CHINESE || rule === "area") {
    return SCORING_CHINESE;
  }
  throw new TypeError(`Unknown scoring rule: ${rule}`);
}

function normalizeTopology(topology) {
  if (!VALID_TOPOLOGIES.has(topology)) {
    throw new TypeError(`Unknown board topology: ${topology}`);
  }
  return topology;
}

function requirePlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function requireOwnProperty(object, key, label = "State") {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw new TypeError(`${label} is missing ${key}`);
  }
}

function cloneSerializable(value, label = "Value", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} contains a non-serializable value`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain circular references`);
  }

  ancestors.add(value);
  let clone;
  if (Array.isArray(value)) {
    clone = value.map((item, index) =>
      cloneSerializable(item, `${label}[${index}]`, ancestors),
    );
  } else {
    requirePlainObject(value, label);
    clone = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneSerializable(item, `${label}.${key}`, ancestors),
      ]),
    );
  }
  ancestors.delete(value);
  return clone;
}

function sameSerializableValue(left, right) {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameSerializableValue(item, right[index]))
    );
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameSerializableValue(left[key], right[key]),
    )
  );
}

function copyStatePoint(point, width, height, label) {
  requirePlainObject(point, label);
  if (
    !Number.isInteger(point.row) ||
    !Number.isInteger(point.col) ||
    point.row < 0 ||
    point.row >= height ||
    point.col < 0 ||
    point.col >= width
  ) {
    throw new RangeError(`${label} must be a point on the board`);
  }
  return { row: point.row, col: point.col };
}

function copyLastMove(lastMove, width, height) {
  if (lastMove === null) return null;
  requirePlainObject(lastMove, "lastMove");
  if (!VALID_COLORS.has(lastMove.color)) {
    throw new TypeError(`Unknown last-move color: ${lastMove.color}`);
  }
  if (lastMove.type === "pass") {
    return { type: "pass", color: lastMove.color };
  }
  if (lastMove.type !== "play") {
    throw new TypeError(`Unknown last-move type: ${lastMove.type}`);
  }

  const point = copyStatePoint(lastMove, width, height, "lastMove");
  if (!Array.isArray(lastMove.captured)) {
    throw new TypeError("lastMove.captured must be an array");
  }
  const seen = new Set();
  const captured = lastMove.captured.map((stone, index) => {
    const copy = copyStatePoint(
      stone,
      width,
      height,
      `lastMove.captured[${index}]`,
    );
    const key = pointKey(copy.row, copy.col);
    if (seen.has(key)) {
      throw new TypeError(`lastMove.captured contains duplicate point ${key}`);
    }
    seen.add(key);
    return copy;
  });
  return {
    type: "play",
    color: lastMove.color,
    row: point.row,
    col: point.col,
    captured,
  };
}

function copyReplayEvent(event, width, height, index) {
  const label = `replay.events[${index}]`;
  requirePlainObject(event, label);
  requireOwnProperty(event, "type", label);

  if (event.type === "play") {
    requireOwnProperty(event, "color", label);
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`Unknown replay move color: ${event.color}`);
    }
    const point = copyStatePoint(event, width, height, label);
    return {
      type: "play",
      color: event.color,
      row: point.row,
      col: point.col,
    };
  }

  if (event.type === "pass") {
    requireOwnProperty(event, "color", label);
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`Unknown replay move color: ${event.color}`);
    }
    return { type: "pass", color: event.color };
  }

  if (event.type === "resign") {
    requireOwnProperty(event, "color", label);
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`Unknown replay resignation color: ${event.color}`);
    }
    return { type: "resign", color: event.color };
  }

  if (event.type === "resume_play") {
    requireOwnProperty(event, "nextPlayer", label);
    if (!VALID_COLORS.has(event.nextPlayer)) {
      throw new TypeError(
        `Unknown replay next-player color: ${event.nextPlayer}`,
      );
    }
    return { type: "resume_play", nextPlayer: event.nextPlayer };
  }

  if (event.type === "toggle_dead") {
    const point = copyStatePoint(event, width, height, label);
    return { type: "toggle_dead", row: point.row, col: point.col };
  }

  if (event.type === "finish_scoring") {
    requireOwnProperty(event, "rule", label);
    return { type: "finish_scoring", rule: normalizeScoringRule(event.rule) };
  }

  throw new TypeError(`Unknown replay event type: ${event.type}`);
}

function isPositionHashForDimensions(hash, width, height) {
  if (typeof hash !== "string") return false;
  const rows = hash.split("/");
  return (
    rows.length === height &&
    rows.every((row) => row.length === width && /^[BW.]+$/.test(row))
  );
}

/**
 * @typedef {{row: number, col: number}} Point
 */

export class GoEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.size] Legacy square board dimension.
   * @param {number} [options.width] Board column count.
   * @param {number} [options.height] Board row count.
   * @param {number} [options.komi=6.5]
   * @param {'japanese'|'chinese'} [options.scoringRule='japanese']
   * @param {'cylinder'|'torus'|'mobius'} [options.topology='cylinder']
   * @param {Array<Array<'black'|'white'|null>>} [options.initialBoard]
   * @param {'black'|'white'} [options.currentPlayer='black']
   */
  constructor({
    size,
    width,
    height,
    komi = 6.5,
    scoringRule = SCORING_JAPANESE,
    topology = TOPOLOGY_CYLINDER,
    initialBoard = null,
    currentPlayer = BLACK,
  } = {}) {
    const fallbackDimension = size ?? width ?? height ?? 19;
    const resolvedWidth = width ?? fallbackDimension;
    const resolvedHeight = height ?? fallbackDimension;
    if (
      !Number.isInteger(resolvedWidth) ||
      !Number.isInteger(resolvedHeight) ||
      resolvedWidth < 3 ||
      resolvedHeight < 3 ||
      resolvedWidth > 25 ||
      resolvedHeight > 25
    ) {
      throw new RangeError(
        "Board width and height must be integers from 3 to 25",
      );
    }
    if (
      size !== undefined &&
      (resolvedWidth !== size || resolvedHeight !== size)
    ) {
      throw new RangeError("Legacy size must match both width and height");
    }
    if (!Number.isFinite(komi)) {
      throw new TypeError("Komi must be a finite number");
    }
    if (!VALID_COLORS.has(currentPlayer)) {
      throw new TypeError(`Unknown player color: ${currentPlayer}`);
    }

    this.width = resolvedWidth;
    this.height = resolvedHeight;
    // `size` remains an exact square-only compatibility alias. Rectangular
    // callers must use width/height so a single number is never ambiguous.
    this.size = resolvedWidth === resolvedHeight ? resolvedWidth : undefined;
    this.komi = komi;
    this.scoringRule = normalizeScoringRule(scoringRule);
    this.topology = normalizeTopology(topology);
    this.board = initialBoard
      ? this.#validateAndCopyBoard(initialBoard)
      : makeEmptyBoard(this.width, this.height);
    this.currentPlayer = currentPlayer;
    this.phase = PHASE_PLAY;
    this.consecutivePasses = 0;
    this.captures = { [BLACK]: 0, [WHITE]: 0 };
    this.deadStones = new Set();
    this.lastMove = null;
    this.result = null;
    this.undoHistory = [];

    // Positional superko compares stone arrangements only (not the player to
    // move). Passing is explicitly allowed and does not add a duplicate entry.
    this.positionHistory = new Set([this.#positionHash(this.board)]);
    this.replay = {
      version: REPLAY_VERSION,
      complete: true,
      base: this.#replayBaseSnapshot(),
      events: [],
    };
  }

  /**
   * Rebuild an engine from an exported state object or the JSON returned by
   * serialize(). All nested data is validated and copied before it is used.
   */
  static fromState(state) {
    let snapshot = state;
    if (typeof snapshot === "string") {
      try {
        snapshot = JSON.parse(snapshot);
      } catch (error) {
        throw new TypeError("Serialized game state must be valid JSON", {
          cause: error,
        });
      }
    }
    requirePlainObject(snapshot, "State");

    const requiredFields = [
      "komi",
      "scoringRule",
      "board",
      "currentPlayer",
      "phase",
      "consecutivePasses",
      "captures",
      "deadStones",
      "lastMove",
      "result",
      "positionHistory",
    ];
    for (const field of requiredFields) requireOwnProperty(snapshot, field);
    const hasWidth = Object.prototype.hasOwnProperty.call(snapshot, "width");
    const hasHeight = Object.prototype.hasOwnProperty.call(snapshot, "height");
    const hasLegacySize = Object.prototype.hasOwnProperty.call(snapshot, "size");
    if (hasWidth !== hasHeight || (!hasWidth && !hasLegacySize)) {
      throw new TypeError(
        "State must contain both width and height, or a legacy size",
      );
    }
    if (
      hasWidth &&
      hasLegacySize &&
      (snapshot.width !== snapshot.height || snapshot.size !== snapshot.width)
    ) {
      throw new RangeError(
        "State size is only valid when it matches square width and height",
      );
    }

    // Check the bounded snapshot list before validating or copying any of its
    // nested boards. This makes oversized persisted input fail fast.
    if (Object.prototype.hasOwnProperty.call(snapshot, "undoHistory")) {
      if (!Array.isArray(snapshot.undoHistory)) {
        throw new TypeError("undoHistory must be an array");
      }
      if (snapshot.undoHistory.length > UNDO_HISTORY_LIMIT) {
        throw new RangeError(
          `undoHistory must contain at most ${UNDO_HISTORY_LIMIT} entries`,
        );
      }
    }

    const game = new GoEngine({
      ...(hasWidth
        ? { width: snapshot.width, height: snapshot.height }
        : { size: snapshot.size }),
      komi: snapshot.komi,
      scoringRule: snapshot.scoringRule,
      // States exported before multiple topologies existed were cylindrical.
      topology: snapshot.topology ?? TOPOLOGY_CYLINDER,
      initialBoard: snapshot.board,
      currentPlayer: snapshot.currentPlayer,
    });

    if (!VALID_PHASES.has(snapshot.phase)) {
      throw new TypeError(`Unknown game phase: ${snapshot.phase}`);
    }
    if (
      !Number.isInteger(snapshot.consecutivePasses) ||
      snapshot.consecutivePasses < 0 ||
      snapshot.consecutivePasses > 2
    ) {
      throw new RangeError("consecutivePasses must be an integer from 0 to 2");
    }
    const isResignation = snapshot.phase === PHASE_FINISHED &&
      snapshot.result !== null &&
      typeof snapshot.result === "object" &&
      !Array.isArray(snapshot.result) &&
      snapshot.result.reason === "resign";
    if (
      (snapshot.phase === PHASE_PLAY && snapshot.consecutivePasses === 2) ||
      (isResignation && snapshot.consecutivePasses === 2) ||
      (snapshot.phase !== PHASE_PLAY && !isResignation && snapshot.consecutivePasses !== 2)
    ) {
      throw new RangeError("consecutivePasses is inconsistent with the phase");
    }

    requirePlainObject(snapshot.captures, "captures");
    const captures = {};
    for (const color of [BLACK, WHITE]) {
      requireOwnProperty(snapshot.captures, color, "captures");
      const count = snapshot.captures[color];
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(`captures.${color} must be a non-negative integer`);
      }
      captures[color] = count;
    }

    if (!Array.isArray(snapshot.deadStones)) {
      throw new TypeError("deadStones must be an array");
    }
    const deadStones = new Set();
    snapshot.deadStones.forEach((point, index) => {
      const copy = copyStatePoint(
        point,
        game.width,
        game.height,
        `deadStones[${index}]`,
      );
      const key = pointKey(copy.row, copy.col);
      if (deadStones.has(key)) {
        throw new TypeError(`deadStones contains duplicate point ${key}`);
      }
      if (game.board[copy.row][copy.col] === EMPTY) {
        throw new TypeError(`deadStones contains empty point ${key}`);
      }
      deadStones.add(key);
    });
    if (snapshot.phase === PHASE_PLAY && deadStones.size > 0) {
      throw new TypeError("deadStones must be empty while play is active");
    }

    const lastMove = copyLastMove(
      snapshot.lastMove,
      game.width,
      game.height,
    );

    if (
      !Array.isArray(snapshot.positionHistory) ||
      snapshot.positionHistory.length === 0
    ) {
      throw new TypeError("positionHistory must be a non-empty array");
    }
    const positionHistory = new Set();
    snapshot.positionHistory.forEach((hash, index) => {
      if (!isPositionHashForDimensions(hash, game.width, game.height)) {
        throw new TypeError(`positionHistory[${index}] is not a valid board hash`);
      }
      if (positionHistory.has(hash)) {
        throw new TypeError(`positionHistory contains duplicate hash at ${index}`);
      }
      positionHistory.add(hash);
    });
    const currentHash = game.#positionHash(game.board);
    if (!positionHistory.has(currentHash)) {
      throw new TypeError("positionHistory does not include the current board");
    }

    game.phase = snapshot.phase;
    game.consecutivePasses = snapshot.consecutivePasses;
    game.captures = captures;
    game.deadStones = deadStones;
    game.lastMove = lastMove;
    game.positionHistory = positionHistory;

    if (snapshot.phase === PHASE_FINISHED) {
      requirePlainObject(snapshot.result, "result");
      const result = cloneSerializable(snapshot.result, "result");
      if (result.reason === "resign") {
        if (
          !VALID_COLORS.has(result.winner) ||
          !VALID_COLORS.has(result.loser) ||
          result.winner === result.loser ||
          result.winner !== oppositeColor(result.loser) ||
          result.margin !== 0 ||
          (result.resignation !== undefined && result.resignation !== true)
        ) {
          throw new TypeError("result is not a valid resignation result");
        }
        game.result = {
          winner: result.winner,
          loser: result.loser,
          margin: 0,
          reason: "resign",
          resignation: true,
        };
      } else {
        const expectedResult = game.score(result.rule);
        if (!sameSerializableValue(result, expectedResult)) {
          throw new TypeError("result is inconsistent with the restored position");
        }
        game.result = result;
      }
    } else {
      if (snapshot.result !== null) {
        throw new TypeError("result must be null until scoring is finished");
      }
      game.result = null;
    }

    game.undoHistory = game.#copyUndoHistory(
      Object.prototype.hasOwnProperty.call(snapshot, "undoHistory")
        ? snapshot.undoHistory
        : [],
    );

    if (
      Object.prototype.hasOwnProperty.call(snapshot, "replay") &&
      Object.prototype.hasOwnProperty.call(snapshot, "topology")
    ) {
      game.replay = game.#copyAndValidateReplay(snapshot.replay);
    } else {
      // A state saved before replay support cannot reconstruct moves that have
      // already happened. It remains useful as a replay baseline for every
      // subsequent move, and explicitly advertises that the record is partial.
      game.replay = {
        version: REPLAY_VERSION,
        complete: false,
        base: game.#replayBaseSnapshot(),
        events: [],
      };
    }

    return game;
  }

  /** Alias matching serialize(). */
  static deserialize(serialized) {
    return GoEngine.fromState(serialized);
  }

  #validateAndCopyBoard(board) {
    if (!Array.isArray(board) || board.length !== this.height) {
      throw new RangeError(`Initial board must contain ${this.height} rows`);
    }

    return board.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== this.width) {
        throw new RangeError(
          `Initial board row ${rowIndex} must contain ${this.width} points`,
        );
      }
      return row.map((value) => {
        if (value !== EMPTY && !VALID_COLORS.has(value)) {
          throw new TypeError(`Invalid board value: ${value}`);
        }
        return value;
      });
    });
  }

  #positionHash(board) {
    return board
      .map((row) =>
        row.map((value) => (value === BLACK ? "B" : value === WHITE ? "W" : ".")).join(""),
      )
      .join("/");
  }

  #replayBaseSnapshot() {
    return {
      ...this.getState(),
      positionHistory: [...this.positionHistory],
      undoHistory: [],
    };
  }

  #copyAndValidateReplay(replay) {
    requirePlainObject(replay, "replay");
    for (const field of ["version", "complete", "base", "events"]) {
      requireOwnProperty(replay, field, "replay");
    }
    if (replay.version !== REPLAY_VERSION) {
      throw new TypeError(`Unsupported replay version: ${replay.version}`);
    }
    if (typeof replay.complete !== "boolean") {
      throw new TypeError("replay.complete must be a boolean");
    }
    requirePlainObject(replay.base, "replay.base");
    if (Object.prototype.hasOwnProperty.call(replay.base, "replay")) {
      throw new TypeError("replay.base must not contain a nested replay");
    }
    if (!Array.isArray(replay.events)) {
      throw new TypeError("replay.events must be an array");
    }

    const base = cloneSerializable(replay.base, "replay.base");
    const replayGame = GoEngine.fromState(base);
    // Persist replay baselines in the same canonical dimension format as new
    // top-level states, even when a restored square replay used legacy `size`
    // alone. This keeps every newly serialized state self-describing.
    base.width = replayGame.width;
    base.height = replayGame.height;
    if (replayGame.size === undefined) delete base.size;
    else base.size = replayGame.size;
    if (
      replayGame.width !== this.width ||
      replayGame.height !== this.height ||
      replayGame.komi !== this.komi ||
      replayGame.scoringRule !== this.scoringRule ||
      replayGame.topology !== this.topology
    ) {
      throw new TypeError("replay.base game settings do not match the state");
    }

    const events = replay.events.map((event, index) =>
      copyReplayEvent(event, this.width, this.height, index),
    );
    events.forEach((event, index) => {
      let result;
      if (event.type === "play") {
        if (replayGame.currentPlayer !== event.color) {
          throw new TypeError(
            `replay.events[${index}] color does not match the player to move`,
          );
        }
        result = replayGame.play(event.row, event.col);
      } else if (event.type === "pass") {
        if (replayGame.currentPlayer !== event.color) {
          throw new TypeError(
            `replay.events[${index}] color does not match the player to move`,
          );
        }
        result = replayGame.pass();
      } else if (event.type === "resume_play") {
        result = replayGame.resumePlay(event.nextPlayer);
      } else if (event.type === "toggle_dead") {
        result = replayGame.toggleDead(event.row, event.col);
      } else if (event.type === "finish_scoring") {
        result = replayGame.finishScoring(event.rule);
      } else {
        result = replayGame.resign(event.color);
      }
      if (!result.ok) {
        throw new TypeError(
          `replay.events[${index}] is illegal: ${result.reason}`,
        );
      }
    });

    const reconstructed = replayGame.getState();
    const current = this.getState();
    for (const field of [
      "board",
      "currentPlayer",
      "phase",
      "consecutivePasses",
      "captures",
      "deadStones",
      "lastMove",
      "result",
    ]) {
      if (!sameSerializableValue(reconstructed[field], current[field])) {
        throw new TypeError(
          `replay events do not reconstruct the current ${field}`,
        );
      }
    }

    return {
      version: REPLAY_VERSION,
      complete: replay.complete,
      base,
      events,
    };
  }

  #recordReplayMove(move) {
    if (move.type === "play") {
      this.replay.events.push({
        type: "play",
        color: move.color,
        row: move.row,
        col: move.col,
      });
    } else {
      this.replay.events.push({ type: "pass", color: move.color });
    }
  }

  #removeReplayMove(move) {
    for (let index = this.replay.events.length - 1; index >= 0; index -= 1) {
      const event = this.replay.events[index];
      if (!["play", "pass"].includes(event.type)) continue;
      const matches =
        event.type === move.type &&
        event.color === move.color &&
        (event.type !== "play" ||
          (event.row === move.row && event.col === move.col));
      if (!matches) {
        throw new TypeError("Replay history is inconsistent with undo history");
      }
      // Any resume marker after this move describes a scoring transition that
      // has also been rolled back by restoring the move's undo snapshot.
      this.replay.events.splice(index);
      return;
    }

    // An old save can still contain undo snapshots from before replay existed.
    // If one of those moves is undone, begin a new partial record at the newly
    // restored position instead of pretending the missing history is complete.
    this.replay = {
      version: REPLAY_VERSION,
      complete: false,
      base: this.#replayBaseSnapshot(),
      events: [],
    };
  }

  #undoSnapshot() {
    return {
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      consecutivePasses: this.consecutivePasses,
      captures: { ...this.captures },
      deadStones: [...this.deadStones].map(parsePointKey),
      lastMove: copyLastMove(this.lastMove, this.width, this.height),
      result:
        this.result === null
          ? null
          : cloneSerializable(this.result, "result"),
    };
  }

  #restoreUndoSnapshot(snapshot) {
    this.board = copyBoard(snapshot.board);
    this.currentPlayer = snapshot.currentPlayer;
    this.phase = snapshot.phase;
    this.consecutivePasses = snapshot.consecutivePasses;
    this.captures = { ...snapshot.captures };
    this.deadStones = new Set(
      snapshot.deadStones.map(({ row, col }) => pointKey(row, col)),
    );
    this.lastMove = copyLastMove(
      snapshot.lastMove,
      this.width,
      this.height,
    );
    this.result =
      snapshot.result === null
        ? null
        : cloneSerializable(snapshot.result, "result");
  }

  #boardAfterUndoEntry(entry) {
    const board = copyBoard(entry.before.board);
    if (entry.move.type === "play") {
      board[entry.move.row][entry.move.col] = entry.move.color;
      for (const stone of entry.move.captured) {
        board[stone.row][stone.col] = EMPTY;
      }
    }
    return board;
  }

  #copyUndoHistory(history) {
    if (!Array.isArray(history)) {
      throw new TypeError("undoHistory must be an array");
    }
    if (history.length > UNDO_HISTORY_LIMIT) {
      throw new RangeError(
        `undoHistory must contain at most ${UNDO_HISTORY_LIMIT} entries`,
      );
    }

    const copied = [];
    const movePositionHashes = new Set();
    let previousMove = null;
    let previousBoardAfterMove = null;
    let previousCapturesAfterMove = null;

    history.forEach((entry, index) => {
      requirePlainObject(entry, `undoHistory[${index}]`);
      requireOwnProperty(entry, "move", `undoHistory[${index}]`);
      requireOwnProperty(entry, "before", `undoHistory[${index}]`);

      const move = copyLastMove(entry.move, this.width, this.height);
      if (move === null) {
        throw new TypeError(`undoHistory[${index}].move must not be null`);
      }

      const before = requirePlainObject(
        entry.before,
        `undoHistory[${index}].before`,
      );
      for (const field of [
        "board",
        "currentPlayer",
        "phase",
        "consecutivePasses",
        "captures",
        "deadStones",
        "lastMove",
        "result",
      ]) {
        requireOwnProperty(before, field, `undoHistory[${index}].before`);
      }

      const board = this.#validateAndCopyBoard(before.board);
      if (!VALID_COLORS.has(before.currentPlayer)) {
        throw new TypeError(
          `Unknown undo-history player color: ${before.currentPlayer}`,
        );
      }
      if (before.phase !== PHASE_PLAY) {
        throw new TypeError(
          `undoHistory[${index}].before.phase must be play`,
        );
      }
      if (
        !Number.isInteger(before.consecutivePasses) ||
        before.consecutivePasses < 0 ||
        before.consecutivePasses > 1
      ) {
        throw new RangeError(
          `undoHistory[${index}].before.consecutivePasses must be 0 or 1`,
        );
      }

      requirePlainObject(
        before.captures,
        `undoHistory[${index}].before.captures`,
      );
      const captures = {};
      for (const color of [BLACK, WHITE]) {
        requireOwnProperty(
          before.captures,
          color,
          `undoHistory[${index}].before.captures`,
        );
        const count = before.captures[color];
        if (!Number.isInteger(count) || count < 0) {
          throw new RangeError(
            `undoHistory[${index}].before.captures.${color} must be a non-negative integer`,
          );
        }
        captures[color] = count;
      }

      if (!Array.isArray(before.deadStones)) {
        throw new TypeError(
          `undoHistory[${index}].before.deadStones must be an array`,
        );
      }
      if (before.deadStones.length > 0) {
        throw new TypeError(
          `undoHistory[${index}].before.deadStones must be empty while play is active`,
        );
      }
      if (before.result !== null) {
        throw new TypeError(
          `undoHistory[${index}].before.result must be null while play is active`,
        );
      }

      const lastMove = copyLastMove(
        before.lastMove,
        this.width,
        this.height,
      );
      if (move.color !== before.currentPlayer) {
        throw new TypeError(
          `undoHistory[${index}].move color must match the player to move`,
        );
      }
      if (move.type === "play") {
        if (board[move.row][move.col] !== EMPTY) {
          throw new TypeError(
            `undoHistory[${index}].move point must be empty before the move`,
          );
        }
        const opponent = oppositeColor(move.color);
        for (const stone of move.captured) {
          if (board[stone.row][stone.col] !== opponent) {
            throw new TypeError(
              `undoHistory[${index}].move captured point does not contain an opponent stone`,
            );
          }
        }
      }

      if (
        previousMove !== null &&
        !sameSerializableValue(lastMove, previousMove)
      ) {
        throw new TypeError(
          `undoHistory[${index}].before.lastMove is inconsistent with the preceding move`,
        );
      }
      if (
        previousBoardAfterMove !== null &&
        !sameSerializableValue(board, previousBoardAfterMove)
      ) {
        throw new TypeError(
          `undoHistory[${index}].before.board is inconsistent with the preceding move`,
        );
      }
      if (
        previousCapturesAfterMove !== null &&
        !sameSerializableValue(captures, previousCapturesAfterMove)
      ) {
        throw new TypeError(
          `undoHistory[${index}].before.captures is inconsistent with the preceding move`,
        );
      }

      const copy = {
        move,
        before: {
          board,
          currentPlayer: before.currentPlayer,
          phase: before.phase,
          consecutivePasses: before.consecutivePasses,
          captures,
          deadStones: [],
          lastMove,
          result: null,
        },
      };
      const boardAfterMove = this.#boardAfterUndoEntry(copy);
      const capturesAfterMove = { ...captures };
      if (move.type === "play") {
        capturesAfterMove[move.color] += move.captured.length;
        const hash = this.#positionHash(boardAfterMove);
        if (!this.positionHistory.has(hash)) {
          throw new TypeError(
            `undoHistory[${index}] move position is absent from positionHistory`,
          );
        }
        if (movePositionHashes.has(hash)) {
          throw new TypeError(
            `undoHistory[${index}] recreates an earlier move position`,
          );
        }
        movePositionHashes.add(hash);
      }

      copied.push(copy);
      previousMove = move;
      previousBoardAfterMove = boardAfterMove;
      previousCapturesAfterMove = capturesAfterMove;
    });

    if (copied.length > 0) {
      const latest = copied[copied.length - 1];
      if (!sameSerializableValue(this.lastMove, latest.move)) {
        throw new TypeError("lastMove is inconsistent with undoHistory");
      }
      if (
        !sameSerializableValue(this.board, this.#boardAfterUndoEntry(latest))
      ) {
        throw new TypeError("board is inconsistent with undoHistory");
      }
      const expectedCaptures = { ...latest.before.captures };
      if (latest.move.type === "play") {
        expectedCaptures[latest.move.color] += latest.move.captured.length;
      }
      if (!sameSerializableValue(this.captures, expectedCaptures)) {
        throw new TypeError("captures are inconsistent with undoHistory");
      }
    }

    return copied;
  }

  #recordUndo(move, before) {
    this.undoHistory.push({
      move: copyLastMove(move, this.width, this.height),
      before,
    });
    if (this.undoHistory.length > UNDO_HISTORY_LIMIT) {
      this.undoHistory.splice(
        0,
        this.undoHistory.length - UNDO_HISTORY_LIMIT,
      );
    }
  }

  #validPoint(row, col) {
    return (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      row < this.height &&
      col >= 0 &&
      col < this.width
    );
  }

  /** @returns {'black'|'white'|null|undefined} */
  get(row, col) {
    return this.#validPoint(row, col) ? this.board[row][col] : undefined;
  }

  /** Return a defensive copy suitable for rendering or serialization. */
  getBoard() {
    return copyBoard(this.board);
  }

  /**
   * Orthogonal neighbours. Cylinders and tori join columns without changing
   * rows. A Mobius strip joins the column seam after reversing the row. Rows
   * wrap only on a torus; cylinders and Mobius strips retain one boundary.
   *
   * @returns {Point[]}
   */
  neighbors(row, col) {
    if (!this.#validPoint(row, col)) return [];

    const candidates = this.topology === TOPOLOGY_MOBIUS
      ? [col - 1, col + 1].map((coverColumn) => {
          const point = mobiusPointFromCover(
            row,
            coverColumn,
            this.width,
            this.height,
          );
          return { row: point.row, col: point.col };
        })
      : [
          { row, col: (col - 1 + this.width) % this.width },
          { row, col: (col + 1) % this.width },
        ];
    if (this.topology === TOPOLOGY_TORUS) {
      candidates.push(
        { row: (row - 1 + this.height) % this.height, col },
        { row: (row + 1) % this.height, col },
      );
    } else {
      if (row > 0) candidates.push({ row: row - 1, col });
      if (row < this.height - 1) candidates.push({ row: row + 1, col });
    }

    // The minimum board size is three, but keeping this deduplication makes the
    // topology explicit and prevents future small-board variants double-counting.
    const seen = new Set();
    return candidates.filter((point) => {
      const key = pointKey(point.row, point.col);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  #collectGroup(row, col, board = this.board) {
    const color = board[row][col];
    if (color === EMPTY) {
      return { color: EMPTY, stones: [], liberties: [] };
    }

    const pending = [{ row, col }];
    const visited = new Set([pointKey(row, col)]);
    const stones = [];
    const libertyKeys = new Set();

    while (pending.length > 0) {
      const point = pending.pop();
      stones.push(point);

      for (const neighbour of this.neighbors(point.row, point.col)) {
        const value = board[neighbour.row][neighbour.col];
        const key = pointKey(neighbour.row, neighbour.col);
        if (value === EMPTY) {
          libertyKeys.add(key);
        } else if (value === color && !visited.has(key)) {
          visited.add(key);
          pending.push(neighbour);
        }
      }
    }

    return {
      color,
      stones,
      liberties: [...libertyKeys].map(parsePointKey),
    };
  }

  /** Return the connected group and its distinct liberties at a point. */
  getGroup(row, col) {
    if (!this.#validPoint(row, col) || this.board[row][col] === EMPTY) {
      return { color: EMPTY, stones: [], liberties: [] };
    }
    return this.#collectGroup(row, col);
  }

  #failure(reason, extra = {}) {
    return { ok: false, reason, ...extra };
  }

  /**
   * Play one stone. Illegal moves leave every part of the game state unchanged.
   */
  play(row, col) {
    if (this.phase !== PHASE_PLAY) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    }
    if (!this.#validPoint(row, col)) {
      return this.#failure(MOVE_ERRORS.OUT_OF_BOUNDS);
    }
    if (this.board[row][col] !== EMPTY) {
      return this.#failure(MOVE_ERRORS.OCCUPIED);
    }

    const undoSnapshot = this.#undoSnapshot();
    const color = this.currentPlayer;
    const opponent = oppositeColor(color);
    const before = copyBoard(this.board);
    this.board[row][col] = color;

    /** @type {Point[]} */
    const captured = [];
    const checkedOpponentStones = new Set();

    for (const neighbour of this.neighbors(row, col)) {
      if (this.board[neighbour.row][neighbour.col] !== opponent) continue;
      const neighbourKey = pointKey(neighbour.row, neighbour.col);
      if (checkedOpponentStones.has(neighbourKey)) continue;

      const group = this.#collectGroup(neighbour.row, neighbour.col);
      for (const stone of group.stones) {
        checkedOpponentStones.add(pointKey(stone.row, stone.col));
      }
      if (group.liberties.length === 0) captured.push(...group.stones);
    }

    for (const stone of captured) {
      this.board[stone.row][stone.col] = EMPTY;
    }

    if (this.#collectGroup(row, col).liberties.length === 0) {
      this.board = before;
      return this.#failure(MOVE_ERRORS.SUICIDE);
    }

    const positionHash = this.#positionHash(this.board);
    if (this.positionHistory.has(positionHash)) {
      this.board = before;
      return this.#failure(MOVE_ERRORS.SUPERKO);
    }

    this.positionHistory.add(positionHash);
    this.captures[color] += captured.length;
    this.consecutivePasses = 0;
    this.currentPlayer = opponent;
    this.lastMove = {
      type: "play",
      color,
      row,
      col,
      captured: captured.map((stone) => ({ ...stone })),
    };
    this.#recordUndo(this.lastMove, undoSnapshot);
    this.#recordReplayMove(this.lastMove);

    return {
      ok: true,
      type: "play",
      color,
      row,
      col,
      captured: captured.map((stone) => ({ ...stone })),
      nextPlayer: this.currentPlayer,
      phase: this.phase,
    };
  }

  /** Alias convenient for UI/controller code. */
  playMove(row, col) {
    return this.play(row, col);
  }

  /** Pass. Two consecutive passes enter dead-stone marking and scoring. */
  pass() {
    if (this.phase !== PHASE_PLAY) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    }

    const undoSnapshot = this.#undoSnapshot();
    const color = this.currentPlayer;
    this.consecutivePasses += 1;
    this.currentPlayer = oppositeColor(color);
    if (this.consecutivePasses >= 2) this.phase = PHASE_SCORING;
    this.lastMove = { type: "pass", color };
    this.#recordUndo(this.lastMove, undoSnapshot);
    this.#recordReplayMove(this.lastMove);

    return {
      ok: true,
      type: "pass",
      color,
      nextPlayer: this.currentPlayer,
      consecutivePasses: this.consecutivePasses,
      phase: this.phase,
    };
  }

  passMove() {
    return this.pass();
  }

  /** End an active game immediately because one color resigns. */
  resign(color = this.currentPlayer) {
    if (this.phase !== PHASE_PLAY) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    }
    if (!VALID_COLORS.has(color)) {
      throw new TypeError(`Unknown player color: ${color}`);
    }

    const winner = oppositeColor(color);
    this.phase = PHASE_FINISHED;
    this.result = {
      winner,
      loser: color,
      margin: 0,
      reason: "resign",
      resignation: true,
    };
    this.replay.events.push({ type: "resign", color });
    return {
      ok: true,
      type: "resign",
      color,
      ...this.result,
      phase: this.phase,
    };
  }

  /** Whether at least one successful play or pass can be taken back. */
  canUndo() {
    return !(
      this.phase === PHASE_FINISHED && this.result?.reason === "resign"
    ) && this.undoHistory.length > 0;
  }

  /**
   * Undo the latest successful play or pass and restore the complete state from
   * immediately before it. Scoring decisions made after the final pass are
   * discarded together with that pass.
   */
  undo() {
    if (!this.canUndo()) {
      return this.#failure(MOVE_ERRORS.NOTHING_TO_UNDO);
    }

    const entry = this.undoHistory.pop();
    if (entry.move.type === "play") {
      const movePosition = this.#positionHash(this.#boardAfterUndoEntry(entry));
      this.positionHistory.delete(movePosition);
    }
    this.#restoreUndoSnapshot(entry.before);
    this.#removeReplayMove(entry.move);

    return {
      ok: true,
      type: "undo",
      move: copyLastMove(entry.move, this.width, this.height),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
    };
  }

  /**
   * Toggle a whole connected group as dead/alive during scoring.
   */
  toggleDead(row, col) {
    if (this.phase !== PHASE_SCORING) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_SCORING);
    }
    if (!this.#validPoint(row, col)) {
      return this.#failure(MOVE_ERRORS.OUT_OF_BOUNDS);
    }
    if (this.board[row][col] === EMPTY) {
      return this.#failure(MOVE_ERRORS.EMPTY_POINT);
    }

    const group = this.#collectGroup(row, col);
    const shouldMarkDead = !group.stones.every((stone) =>
      this.deadStones.has(pointKey(stone.row, stone.col)),
    );

    for (const stone of group.stones) {
      const key = pointKey(stone.row, stone.col);
      if (shouldMarkDead) this.deadStones.add(key);
      else this.deadStones.delete(key);
    }

    this.replay.events.push({ type: "toggle_dead", row, col });

    return {
      ok: true,
      dead: shouldMarkDead,
      color: group.color,
      stones: group.stones,
      score: this.score(),
    };
  }

  toggleDeadGroup(row, col) {
    return this.toggleDead(row, col);
  }

  isMarkedDead(row, col) {
    return this.deadStones.has(pointKey(row, col));
  }

  #scoringPosition() {
    const board = copyBoard(this.board);
    const dead = { [BLACK]: 0, [WHITE]: 0 };

    for (const key of this.deadStones) {
      const { row, col } = parsePointKey(key);
      const color = board[row][col];
      if (color !== EMPTY) {
        dead[color] += 1;
        board[row][col] = EMPTY;
      }
    }

    return { board, dead };
  }

  #territoryOn(board) {
    const visited = new Set();
    const territory = { [BLACK]: 0, [WHITE]: 0 };
    const neutralPoints = [];
    const regions = [];

    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        const startKey = pointKey(row, col);
        if (board[row][col] !== EMPTY || visited.has(startKey)) continue;

        const pending = [{ row, col }];
        const points = [];
        const borderingColors = new Set();
        visited.add(startKey);

        while (pending.length > 0) {
          const point = pending.pop();
          points.push(point);
          for (const neighbour of this.neighbors(point.row, point.col)) {
            const value = board[neighbour.row][neighbour.col];
            const key = pointKey(neighbour.row, neighbour.col);
            if (value === EMPTY && !visited.has(key)) {
              visited.add(key);
              pending.push(neighbour);
            } else if (value !== EMPTY) {
              borderingColors.add(value);
            }
          }
        }

        const owner =
          borderingColors.size === 1 ? [...borderingColors][0] : EMPTY;
        if (owner !== EMPTY) territory[owner] += points.length;
        else neutralPoints.push(...points);
        regions.push({ owner, points });
      }
    }

    return { territory, neutralPoints, regions };
  }

  /**
   * Calculate a score without mutating the game.
   *
   * Japanese: surrounded territory + prisoners + marked-dead prisoners.
   * Chinese: living stones + surrounded territory. White receives komi in
   * either rule set.
   */
  score(rule = this.scoringRule) {
    const normalizedRule = normalizeScoringRule(rule);
    const { board, dead } = this.#scoringPosition();
    const { territory, neutralPoints, regions } = this.#territoryOn(board);
    const stones = { [BLACK]: 0, [WHITE]: 0 };

    for (const row of board) {
      for (const point of row) {
        if (point !== EMPTY) stones[point] += 1;
      }
    }

    let black;
    let white;
    if (normalizedRule === SCORING_JAPANESE) {
      black = territory[BLACK] + this.captures[BLACK] + dead[WHITE];
      white =
        territory[WHITE] + this.captures[WHITE] + dead[BLACK] + this.komi;
    } else {
      black = stones[BLACK] + territory[BLACK];
      white = stones[WHITE] + territory[WHITE] + this.komi;
    }

    const winner = black === white ? "draw" : black > white ? BLACK : WHITE;
    return {
      rule: normalizedRule,
      black,
      white,
      winner,
      margin: Math.abs(black - white),
      komi: this.komi,
      territory,
      stones,
      captures: { ...this.captures },
      dead,
      neutral: neutralPoints.length,
      neutralPoints,
      regions,
    };
  }

  calculateScore(rule = this.scoringRule) {
    return this.score(rule);
  }

  /** Freeze the current scoring decision as the final result. */
  finishScoring(rule = this.scoringRule) {
    if (this.phase !== PHASE_SCORING) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_SCORING);
    }
    this.result = this.score(rule);
    this.phase = PHASE_FINISHED;
    this.replay.events.push({
      type: "finish_scoring",
      rule: this.result.rule,
    });
    return { ok: true, ...this.result, phase: this.phase };
  }

  /** Resume play if players disagree about dead stones. */
  resumePlay(nextPlayer = this.currentPlayer) {
    if (this.phase !== PHASE_SCORING) {
      return this.#failure(MOVE_ERRORS.GAME_NOT_SCORING);
    }
    if (!VALID_COLORS.has(nextPlayer)) {
      throw new TypeError(`Unknown player color: ${nextPlayer}`);
    }
    this.phase = PHASE_PLAY;
    this.currentPlayer = nextPlayer;
    this.consecutivePasses = 0;
    this.deadStones.clear();
    this.result = null;
    this.replay.events.push({ type: "resume_play", nextPlayer });
    return { ok: true, phase: this.phase, nextPlayer: this.currentPlayer };
  }

  /** Small serializable state snapshot for UI stores and multiplayer messages. */
  getState() {
    return {
      ...(this.size === undefined ? {} : { size: this.size }),
      width: this.width,
      height: this.height,
      komi: this.komi,
      scoringRule: this.scoringRule,
      topology: this.topology,
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      consecutivePasses: this.consecutivePasses,
      captures: { ...this.captures },
      deadStones: [...this.deadStones].map(parsePointKey),
      lastMove: copyLastMove(this.lastMove, this.width, this.height),
      result:
        this.result === null
          ? null
          : cloneSerializable(this.result, "result"),
    };
  }

  /**
   * Complete persistence snapshot. Unlike getState(), this includes the full
   * positional history required to keep positional superko authoritative after
   * a server restart or room migration. AI search may omit the replay timeline
   * because its short-lived clones only need the authoritative current state.
   * @param {{includeReplay?: boolean}} [options]
   */
  exportState({ includeReplay = true } = {}) {
    const state = {
      ...this.getState(),
      positionHistory: [...this.positionHistory],
      undoHistory: cloneSerializable(this.undoHistory, "undoHistory"),
    };
    if (includeReplay) state.replay = this.getReplayState();
    return state;
  }

  /** Complete, compact move record independent of the bounded undo window. */
  getReplayState() {
    return cloneSerializable(this.replay, "replay");
  }

  /** Return the complete persistence snapshot as JSON. */
  serialize() {
    return JSON.stringify(this.exportState());
  }
}

export default GoEngine;

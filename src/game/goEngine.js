/**
 * Pure Go rules for periodically connected boards.
 *
 * Cylinders retain their normal top/bottom boundaries while columns are
 * periodic. Tori make both rows and columns periodic. Stones are placed on
 * intersections.
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

// Undo snapshots contain a complete board so that captures, scoring transitions
// and persistence restore exactly. Keeping only the latest 32 moves bounds the
// Durable Object value size even on a dense 25x25 board.
export const UNDO_HISTORY_LIMIT = 32;

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
const VALID_TOPOLOGIES = new Set([TOPOLOGY_CYLINDER, TOPOLOGY_TORUS]);

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

function makeEmptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(EMPTY));
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

function copyStatePoint(point, size, label) {
  requirePlainObject(point, label);
  if (
    !Number.isInteger(point.row) ||
    !Number.isInteger(point.col) ||
    point.row < 0 ||
    point.row >= size ||
    point.col < 0 ||
    point.col >= size
  ) {
    throw new RangeError(`${label} must be a point on the board`);
  }
  return { row: point.row, col: point.col };
}

function copyLastMove(lastMove, size) {
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

  const point = copyStatePoint(lastMove, size, "lastMove");
  if (!Array.isArray(lastMove.captured)) {
    throw new TypeError("lastMove.captured must be an array");
  }
  const seen = new Set();
  const captured = lastMove.captured.map((stone, index) => {
    const copy = copyStatePoint(stone, size, `lastMove.captured[${index}]`);
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

function isPositionHashForSize(hash, size) {
  if (typeof hash !== "string") return false;
  const rows = hash.split("/");
  return (
    rows.length === size &&
    rows.every((row) => row.length === size && /^[BW.]+$/.test(row))
  );
}

/**
 * @typedef {{row: number, col: number}} Point
 */

export class GoEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.size=19] Board width and height (9, 13 and 19 are
   *   the intended presets, but any integer >= 3 is supported).
   * @param {number} [options.komi=6.5]
   * @param {'japanese'|'chinese'} [options.scoringRule='japanese']
   * @param {'cylinder'|'torus'} [options.topology='cylinder']
   * @param {Array<Array<'black'|'white'|null>>} [options.initialBoard]
   * @param {'black'|'white'} [options.currentPlayer='black']
   */
  constructor({
    size = 19,
    komi = 6.5,
    scoringRule = SCORING_JAPANESE,
    topology = TOPOLOGY_CYLINDER,
    initialBoard = null,
    currentPlayer = BLACK,
  } = {}) {
    if (!Number.isInteger(size) || size < 3) {
      throw new RangeError("Board size must be an integer of at least 3");
    }
    if (!Number.isFinite(komi)) {
      throw new TypeError("Komi must be a finite number");
    }
    if (!VALID_COLORS.has(currentPlayer)) {
      throw new TypeError(`Unknown player color: ${currentPlayer}`);
    }

    this.size = size;
    this.komi = komi;
    this.scoringRule = normalizeScoringRule(scoringRule);
    this.topology = normalizeTopology(topology);
    this.board = initialBoard
      ? this.#validateAndCopyBoard(initialBoard)
      : makeEmptyBoard(size);
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
      "size",
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
      size: snapshot.size,
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
    if (
      (snapshot.phase === PHASE_PLAY && snapshot.consecutivePasses === 2) ||
      (snapshot.phase !== PHASE_PLAY && snapshot.consecutivePasses !== 2)
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
      const copy = copyStatePoint(point, game.size, `deadStones[${index}]`);
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

    const lastMove = copyLastMove(snapshot.lastMove, game.size);

    if (
      !Array.isArray(snapshot.positionHistory) ||
      snapshot.positionHistory.length === 0
    ) {
      throw new TypeError("positionHistory must be a non-empty array");
    }
    const positionHistory = new Set();
    snapshot.positionHistory.forEach((hash, index) => {
      if (!isPositionHashForSize(hash, game.size)) {
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
      const expectedResult = game.score(result.rule);
      if (!sameSerializableValue(result, expectedResult)) {
        throw new TypeError("result is inconsistent with the restored position");
      }
      game.result = result;
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

    return game;
  }

  /** Alias matching serialize(). */
  static deserialize(serialized) {
    return GoEngine.fromState(serialized);
  }

  #validateAndCopyBoard(board) {
    if (!Array.isArray(board) || board.length !== this.size) {
      throw new RangeError(`Initial board must contain ${this.size} rows`);
    }

    return board.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== this.size) {
        throw new RangeError(
          `Initial board row ${rowIndex} must contain ${this.size} points`,
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

  #undoSnapshot() {
    return {
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      consecutivePasses: this.consecutivePasses,
      captures: { ...this.captures },
      deadStones: [...this.deadStones].map(parsePointKey),
      lastMove: copyLastMove(this.lastMove, this.size),
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
    this.lastMove = copyLastMove(snapshot.lastMove, this.size);
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

      const move = copyLastMove(entry.move, this.size);
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

      const lastMove = copyLastMove(before.lastMove, this.size);
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
      move: copyLastMove(move, this.size),
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
      row < this.size &&
      col >= 0 &&
      col < this.size
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
   * Orthogonal neighbours. Columns always wrap. Rows wrap on a torus and stop
   * at the top and bottom on a cylinder.
   *
   * @returns {Point[]}
   */
  neighbors(row, col) {
    if (!this.#validPoint(row, col)) return [];

    const candidates = [
      { row, col: (col - 1 + this.size) % this.size },
      { row, col: (col + 1) % this.size },
    ];
    if (this.topology === TOPOLOGY_TORUS) {
      candidates.push(
        { row: (row - 1 + this.size) % this.size, col },
        { row: (row + 1) % this.size, col },
      );
    } else {
      if (row > 0) candidates.push({ row: row - 1, col });
      if (row < this.size - 1) candidates.push({ row: row + 1, col });
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

  /** Whether at least one successful play or pass can be taken back. */
  canUndo() {
    return this.undoHistory.length > 0;
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

    return {
      ok: true,
      type: "undo",
      move: copyLastMove(entry.move, this.size),
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

    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
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
    return { ok: true, phase: this.phase, nextPlayer: this.currentPlayer };
  }

  /** Small serializable state snapshot for UI stores and multiplayer messages. */
  getState() {
    return {
      size: this.size,
      komi: this.komi,
      scoringRule: this.scoringRule,
      topology: this.topology,
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      consecutivePasses: this.consecutivePasses,
      captures: { ...this.captures },
      deadStones: [...this.deadStones].map(parsePointKey),
      lastMove: copyLastMove(this.lastMove, this.size),
      result:
        this.result === null
          ? null
          : cloneSerializable(this.result, "result"),
    };
  }

  /**
   * Complete persistence snapshot. Unlike getState(), this includes the full
   * positional history required to keep positional superko authoritative after
   * a server restart or room migration.
   */
  exportState() {
    return {
      ...this.getState(),
      positionHistory: [...this.positionHistory],
      undoHistory: cloneSerializable(this.undoHistory, "undoHistory"),
    };
  }

  /** Return the complete persistence snapshot as JSON. */
  serialize() {
    return JSON.stringify(this.exportState());
  }
}

export default GoEngine;

import { TOPOLOGY_KINDS, getTopology } from "../topology/index.js";
import {
  BOARD_LIMITS,
  FORBIDDEN_REASONS,
  GAME_GOMOKU,
  GAME_MOVE_ERRORS,
  GOMOKU_FREESTYLE,
  GOMOKU_RENJU,
  GOMOKU_RULE_SETS,
  isValidBoardDimension,
} from "./gameTypes.js";
import {
  BLACK,
  EMPTY,
  MOVE_ERRORS,
  PHASE_FINISHED,
  PHASE_PLAY,
  REPLAY_VERSION,
  WHITE,
  oppositeColor,
} from "./goEngine.js";
import { winningRun } from "./lineRuns.js";
import { RenjuAnalyzer } from "./renju.js";

/**
 * Gomoku on topology boards: freestyle (five or more wins for both colours)
 * and Renju (Black must make exactly five and may not play a double-three,
 * double-four or overline; White wins with five or more). Rows are found
 * with the shared topology module, so they cross every seam the board has.
 *
 * Engine protocol (shared with GoEngine): play, checkPlay, resign, canUndo,
 * undo, undoMoveColors, legalMoves, getState, exportState, getReplayState,
 * serialize and the fully validating static fromState.
 *
 * State: {gameType: "gomoku", ruleSet, width, height, size? (square only),
 * topology, board, currentPlayer, phase ("play"|"finished"), lastMove
 * ({type: "play", color, row, col}|null), result, replay?}. The replay is
 * always complete: {version: 1, complete: true, base: <the same fields with
 * an empty board, Black to move>, events: [{type: "play", color, row, col} |
 * {type: "resign", color}]}. There is no pass.
 *
 * Results: five {winner, loser, reason: "five", margin: 0, line, length}
 * where `line` lists the winning run's cells in order; draw {winner: "draw",
 * reason: "board_full"|"no_legal_moves", margin: 0} when the side to move
 * has no legal point; resignation as in Go.
 */

export const GOMOKU_RESULT_FIVE = "five";
export const GOMOKU_DRAW_BOARD_FULL = "board_full";
export const GOMOKU_DRAW_NO_LEGAL_MOVES = "no_legal_moves";

const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_PHASES = new Set([PHASE_PLAY, PHASE_FINISHED]);
const STATE_FIELDS = [
  "gameType",
  "ruleSet",
  "width",
  "height",
  "topology",
  "board",
  "currentPlayer",
  "phase",
  "lastMove",
  "result",
];
// Fields a replay must rebuild exactly; everything else is fixed by settings.
const POSITION_FIELDS = ["board", "currentPlayer", "phase", "lastMove", "result"];

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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireOwnProperty(object, key, label) {
  if (!hasOwn(object, key)) throw new TypeError(`${label} is missing ${key}`);
}

/** Deep copy of JSON-shaped data; rejects anything JSON cannot carry. */
function cloneJson(value, label, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} contains a non-serializable value`);
  }
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain circular references`);
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? value.map((item, index) => cloneJson(item, `${label}[${index}]`, ancestors))
    : Object.fromEntries(
        Object.entries(requirePlainObject(value, label)).map(([key, item]) => [
          key,
          cloneJson(item, `${label}.${key}`, ancestors),
        ]),
      );
  ancestors.delete(value);
  return copy;
}

function sameJson(left, right) {
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
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
  );
}

function copyBoard(board) {
  return board.map((row) => [...row]);
}

function copyMove(move) {
  return move === null
    ? null
    : { type: "play", color: move.color, row: move.row, col: move.col };
}

function copyEvent(event) {
  return event.type === "play"
    ? copyMove(event)
    : { type: "resign", color: event.color };
}

function boardDimensionError(field) {
  const { min, max } = BOARD_LIMITS[GAME_GOMOKU];
  return new RangeError(
    `Gomoku boards need at least ${min} lines per side; board ${field} must be an integer from ${min} to ${max}`,
  );
}

export class GomokuEngine {
  #topology;
  #events = [];
  #base;
  #complete;
  #forbiddenCache = null;

  /**
   * @param {object} [options]
   * @param {number} [options.width=15] Column count (11 to 30).
   * @param {number} [options.height=15] Row count (11 to 30).
   * @param {number} [options.size] Square-board alias for width and height.
   * @param {'cylinder'|'torus'|'mobius'} [options.topology='cylinder']
   * @param {'freestyle'|'renju'} [options.ruleSet='freestyle']
   * @param {Array<Array<'black'|'white'|null>>} [options.initialBoard] A
   *   starting position (tests, render-only hydration). Anything but the
   *   empty board with Black to move makes the replay record partial, and
   *   fromState only restores complete records.
   * @param {'black'|'white'} [options.currentPlayer='black']
   */
  constructor({
    size,
    width,
    height,
    topology = "cylinder",
    ruleSet = GOMOKU_FREESTYLE,
    initialBoard = null,
    currentPlayer = BLACK,
  } = {}) {
    const fallback = size ?? width ?? height ?? BOARD_LIMITS[GAME_GOMOKU].defaultWidth;
    const resolvedWidth = width ?? fallback;
    const resolvedHeight = height ?? fallback;
    if (!isValidBoardDimension(GAME_GOMOKU, resolvedWidth)) throw boardDimensionError("width");
    if (!isValidBoardDimension(GAME_GOMOKU, resolvedHeight)) throw boardDimensionError("height");
    if (size !== undefined && (resolvedWidth !== size || resolvedHeight !== size)) {
      throw new RangeError("Legacy size must match both width and height");
    }
    if (!TOPOLOGY_KINDS.includes(topology)) {
      throw new TypeError(`Unknown board topology: ${topology}`);
    }
    if (!GOMOKU_RULE_SETS.includes(ruleSet)) {
      throw new TypeError(`Unknown Gomoku rule set: ${ruleSet}`);
    }
    if (!VALID_COLORS.has(currentPlayer)) {
      throw new TypeError(`Unknown player color: ${currentPlayer}`);
    }

    this.width = resolvedWidth;
    this.height = resolvedHeight;
    // Square-only alias, as in GoEngine.
    this.size = resolvedWidth === resolvedHeight ? resolvedWidth : undefined;
    this.topology = topology;
    this.ruleSet = ruleSet;
    this.#topology = getTopology(topology, resolvedWidth, resolvedHeight);
    this.board = initialBoard
      ? this.#validateAndCopyBoard(initialBoard, "Initial board")
      : Array.from({ length: resolvedHeight }, () => Array(resolvedWidth).fill(EMPTY));
    this.currentPlayer = currentPlayer;
    this.phase = PHASE_PLAY;
    this.lastMove = null;
    this.result = null;

    this.#base = this.getState();
    this.#complete =
      currentPlayer === BLACK && this.board.every((row) => row.every((stone) => stone === EMPTY));
  }

  /** Game identity for the rules registry (also written into every state). */
  get gameType() {
    return GAME_GOMOKU;
  }

  /** Number of replay events (plays and a resignation) so far. */
  get eventCount() {
    return this.#events.length;
  }

  /**
   * Restore a game from exportState() output or its JSON. The replay is
   * re-applied from the canonical start with full legality checks and must
   * rebuild the board, turn, phase, last move and result exactly. A state
   * without a replay is accepted only when it is the canonical start itself
   * (as a replay base is).
   *
   * @param {object|string} state
   * @returns {GomokuEngine}
   */
  static fromState(state) {
    let snapshot = state;
    if (typeof snapshot === "string") {
      try {
        snapshot = JSON.parse(snapshot);
      } catch (error) {
        throw new TypeError("Serialized game state must be valid JSON", { cause: error });
      }
    }
    requirePlainObject(snapshot, "State");
    for (const field of STATE_FIELDS) requireOwnProperty(snapshot, field, "State");
    if (snapshot.gameType !== GAME_GOMOKU) {
      throw new TypeError(`A Gomoku state must have gameType "gomoku", not ${snapshot.gameType}`);
    }
    if (
      hasOwn(snapshot, "size") &&
      (snapshot.size !== snapshot.width || snapshot.size !== snapshot.height)
    ) {
      throw new RangeError("State size is only valid when it matches square width and height");
    }

    const game = new GomokuEngine({
      width: snapshot.width,
      height: snapshot.height,
      topology: snapshot.topology,
      ruleSet: snapshot.ruleSet,
    });
    // Validate the claimed position's shape before comparing it.
    game.#validateAndCopyBoard(snapshot.board, "board");
    if (!VALID_COLORS.has(snapshot.currentPlayer)) {
      throw new TypeError(`Unknown player color: ${snapshot.currentPlayer}`);
    }
    if (!VALID_PHASES.has(snapshot.phase)) {
      throw new TypeError(`Unknown game phase: ${snapshot.phase}`);
    }
    if (snapshot.lastMove !== null) requirePlainObject(snapshot.lastMove, "lastMove");
    if (snapshot.result !== null) requirePlainObject(snapshot.result, "result");

    if (hasOwn(snapshot, "replay")) {
      game.#replayFrom(snapshot.replay);
    }
    const reconstructed = game.getState();
    for (const field of POSITION_FIELDS) {
      if (!sameJson(reconstructed[field], snapshot[field])) {
        throw new TypeError(
          hasOwn(snapshot, "replay")
            ? `replay events do not reconstruct the current ${field}`
            : `A state without a replay must be the starting position (${field} differs)`,
        );
      }
    }
    return game;
  }

  /** Alias matching serialize(). */
  static deserialize(serialized) {
    return GomokuEngine.fromState(serialized);
  }

  #validateAndCopyBoard(board, label) {
    if (!Array.isArray(board) || board.length !== this.height) {
      throw new RangeError(`${label} must contain ${this.height} rows`);
    }
    return board.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== this.width) {
        throw new RangeError(`${label} row ${rowIndex} must contain ${this.width} points`);
      }
      return row.map((value) => {
        if (value !== EMPTY && !VALID_COLORS.has(value)) {
          throw new TypeError(`Invalid board value: ${value}`);
        }
        return value;
      });
    });
  }

  /** Re-apply a replay record onto this fresh engine, validating every event. */
  #replayFrom(replay) {
    requirePlainObject(replay, "replay");
    for (const field of ["version", "complete", "base", "events"]) {
      requireOwnProperty(replay, field, "replay");
    }
    if (replay.version !== REPLAY_VERSION) {
      throw new TypeError(`Unsupported replay version: ${replay.version}`);
    }
    if (replay.complete !== true) {
      throw new TypeError("A Gomoku replay must be complete");
    }
    requirePlainObject(replay.base, "replay.base");
    if (hasOwn(replay.base, "replay")) {
      throw new TypeError("replay.base must not contain a nested replay");
    }
    if (!sameJson(cloneJson(replay.base, "replay.base"), this.#base)) {
      throw new TypeError("replay.base must be the starting position of the state's settings");
    }
    if (!Array.isArray(replay.events)) {
      throw new TypeError("replay.events must be an array");
    }
    if (replay.events.length > this.width * this.height + 1) {
      throw new RangeError("replay.events is longer than any game on this board");
    }
    replay.events.forEach((event, index) => {
      const label = `replay.events[${index}]`;
      requirePlainObject(event, label);
      requireOwnProperty(event, "type", label);
      requireOwnProperty(event, "color", label);
      if (!VALID_COLORS.has(event.color)) {
        throw new TypeError(`${label} has an invalid color`);
      }
      let result;
      if (event.type === "play") {
        if (event.color !== this.currentPlayer) {
          throw new TypeError(`${label} color does not match the player to move`);
        }
        result = this.play(event.row, event.col);
      } else if (event.type === "resign") {
        result = this.resign(event.color);
      } else {
        throw new TypeError(`Unknown replay event type at ${label}: ${event.type}`);
      }
      if (!result.ok) {
        throw new TypeError(`${label} is illegal: ${result.reason}`);
      }
    });
  }

  #validPoint(row, col) {
    return this.#topology.isOnBoard(row, col);
  }

  #failure(reason, extra = {}) {
    return { ok: false, reason, ...extra };
  }

  #renjuBlack(color) {
    return this.ruleSet === GOMOKU_RENJU && color === BLACK;
  }

  /** @returns {'black'|'white'|null|undefined} */
  get(row, col) {
    return this.#validPoint(row, col) ? this.board[row][col] : undefined;
  }

  /** A defensive copy of the board. */
  getBoard() {
    return copyBoard(this.board);
  }

  /**
   * Why Black may not play at a point under Renju, or null (freestyle,
   * occupied or legal). Answers for Black whoever is to move.
   *
   * @returns {null|'overline'|'double_four'|'double_three'}
   */
  forbiddenAt(row, col) {
    if (this.ruleSet !== GOMOKU_RENJU || !this.#validPoint(row, col)) return null;
    return new RenjuAnalyzer(this.#topology, this.board).reasonAt(row, col);
  }

  /**
   * Every empty point forbidden for Black under Renju, row-major, each
   * {row, col, reason}; [] in freestyle. Cached until the next play, undo or
   * resignation, so views may ask every frame.
   *
   * @returns {Array<{row: number, col: number, reason: string}>}
   */
  forbiddenPoints() {
    if (this.ruleSet !== GOMOKU_RENJU) return [];
    if (this.#forbiddenCache?.eventCount !== this.#events.length) {
      this.#forbiddenCache = {
        eventCount: this.#events.length,
        points: new RenjuAnalyzer(this.#topology, this.board).forbiddenPoints(),
      };
    }
    return this.#forbiddenCache.points.map((point) => ({ ...point }));
  }

  /**
   * Report whether play(row, col) would succeed, with the exact failure
   * play() would return, without changing anything.
   *
   * @returns {{ok: true} | {ok: false, reason: string, forbidden?: string}}
   */
  checkPlay(row, col) {
    if (this.phase !== PHASE_PLAY) return this.#failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    if (!this.#validPoint(row, col)) return this.#failure(MOVE_ERRORS.OUT_OF_BOUNDS);
    if (this.board[row][col] !== EMPTY) return this.#failure(MOVE_ERRORS.OCCUPIED);
    if (this.#renjuBlack(this.currentPlayer)) {
      const forbidden = new RenjuAnalyzer(this.#topology, this.board).reasonAt(row, col);
      if (forbidden !== null) {
        return this.#failure(GAME_MOVE_ERRORS.FORBIDDEN, { forbidden });
      }
    }
    return { ok: true };
  }

  /** Whether a run of this length wins for the colour under the rule set. */
  #wins(color) {
    return this.#renjuBlack(color) ? (length) => length === 5 : (length) => length >= 5;
  }

  /** The draw reason when the player to move has no legal point, else null. */
  #drawReason() {
    if (this.board.every((row) => row.every((stone) => stone !== EMPTY))) {
      return GOMOKU_DRAW_BOARD_FULL;
    }
    if (
      this.#renjuBlack(this.currentPlayer) &&
      !new RenjuAnalyzer(this.#topology, this.board).hasLegalPoint()
    ) {
      return GOMOKU_DRAW_NO_LEGAL_MOVES;
    }
    return null;
  }

  /**
   * Place a stone for the player to move. Illegal moves (including Renju
   * forbidden points, reason "forbidden" with a `forbidden` code) change
   * nothing.
   */
  play(row, col) {
    const check = this.checkPlay(row, col);
    if (!check.ok) return check;

    const color = this.currentPlayer;
    this.board[row][col] = color;
    this.lastMove = { type: "play", color, row, col };
    this.#events.push(copyMove(this.lastMove));
    this.currentPlayer = oppositeColor(color);

    const run = winningRun(this.#topology, this.board, row, col, color, this.#wins(color));
    if (run) {
      this.phase = PHASE_FINISHED;
      this.result = {
        winner: color,
        loser: oppositeColor(color),
        reason: GOMOKU_RESULT_FIVE,
        margin: 0,
        line: run.cells,
        length: run.length,
      };
    } else {
      const draw = this.#drawReason();
      if (draw !== null) {
        this.phase = PHASE_FINISHED;
        this.result = { winner: "draw", reason: draw, margin: 0 };
      }
    }

    return {
      ok: true,
      type: "play",
      color,
      row,
      col,
      nextPlayer: this.currentPlayer,
      phase: this.phase,
      result: this.result === null ? null : cloneJson(this.result, "result"),
    };
  }

  /** Alias convenient for UI/controller code. */
  playMove(row, col) {
    return this.play(row, col);
  }

  /** End an active game immediately because one colour resigns. */
  resign(color = this.currentPlayer) {
    if (this.phase !== PHASE_PLAY) return this.#failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    if (!VALID_COLORS.has(color)) throw new TypeError(`Unknown player color: ${color}`);
    this.phase = PHASE_FINISHED;
    this.result = {
      winner: oppositeColor(color),
      loser: color,
      margin: 0,
      reason: "resign",
      resignation: true,
    };
    this.#events.push({ type: "resign", color });
    return { ok: true, type: "resign", color, ...this.result, phase: this.phase };
  }

  /** Whether a play can be taken back (only while the game is running). */
  canUndo() {
    return this.phase === PHASE_PLAY && this.#events.length > 0;
  }

  /**
   * Colours of the plays that undo can take back, oldest first; [] once the
   * game has finished.
   * @returns {Array<'black'|'white'>}
   */
  undoMoveColors() {
    if (this.phase !== PHASE_PLAY) return [];
    return this.#events.map((event) => event.color);
  }

  /**
   * Take back the latest play. The position is rebuilt from the remaining
   * record without re-checking it, and the undone move's colour is to move.
   */
  undo() {
    if (!this.canUndo()) return this.#failure(MOVE_ERRORS.NOTHING_TO_UNDO);
    const move = this.#events.pop();
    const board = copyBoard(this.#base.board);
    for (const event of this.#events) board[event.row][event.col] = event.color;
    this.board = board;
    this.currentPlayer = move.color;
    this.lastMove = copyMove(this.#events.at(-1) ?? this.#base.lastMove);
    this.#forbiddenCache = null;
    return {
      ok: true,
      type: "undo",
      move: copyMove(move),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
    };
  }

  /**
   * Every point the player to move may play, row-major; [] once finished.
   * @returns {Array<{row: number, col: number}>}
   */
  legalMoves() {
    if (this.phase !== PHASE_PLAY) return [];
    const forbidden = new Set(
      this.#renjuBlack(this.currentPlayer)
        ? this.forbiddenPoints().map(({ row, col }) => row * this.width + col)
        : [],
    );
    const moves = [];
    this.board.forEach((stones, row) => {
      stones.forEach((stone, col) => {
        if (stone === EMPTY && !forbidden.has(row * this.width + col)) moves.push({ row, col });
      });
    });
    return moves;
  }

  /** Small serializable snapshot for UI stores and multiplayer messages. */
  getState() {
    return {
      gameType: GAME_GOMOKU,
      ruleSet: this.ruleSet,
      width: this.width,
      height: this.height,
      ...(this.size === undefined ? {} : { size: this.size }),
      topology: this.topology,
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      lastMove: copyMove(this.lastMove),
      result: this.result === null ? null : cloneJson(this.result, "result"),
    };
  }

  /**
   * Complete persistence snapshot: getState() plus the replay record.
   * @param {{includeReplay?: boolean}} [options]
   */
  exportState({ includeReplay = true } = {}) {
    const state = this.getState();
    if (includeReplay) state.replay = this.getReplayState();
    return state;
  }

  /** The complete move record from the starting position. */
  getReplayState() {
    return {
      version: REPLAY_VERSION,
      complete: this.#complete,
      base: cloneJson(this.#base, "replay.base"),
      events: this.#events.map(copyEvent),
    };
  }

  /** The complete persistence snapshot as JSON. */
  serialize() {
    return JSON.stringify(this.exportState());
  }
}

export { BLACK, WHITE, EMPTY, FORBIDDEN_REASONS };
export default GomokuEngine;

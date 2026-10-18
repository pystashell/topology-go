import { DIRECTIONS_8, TOPOLOGY_KINDS, getTopology } from "../topology/index.js";
import {
  BOARD_LIMITS,
  GAME_MOVE_ERRORS,
  GAME_OTHELLO,
  isValidBoardDimension,
} from "./gameTypes.js";
import {
  BLACK,
  EMPTY,
  MOVE_ERRORS,
  PHASE_FINISHED,
  PHASE_PLAY,
  REPLAY_VERSION,
  TOPOLOGY_CYLINDER,
  WHITE,
  oppositeColor,
} from "./goEngine.js";

/**
 * Othello (Reversi) on cylinder, torus and Mobius boards.
 *
 * Both sides are even (6..30) so the four starting discs sit on the centre:
 * (h/2-1, w/2-1) and (h/2, w/2) White, the other two Black, Black to move.
 * A move must outflank at least one disc. From the placed point, each of the
 * eight directions follows topology.ray() on the board as it was before the
 * move: the consecutive opponent discs are flipped only when the ray then
 * reaches another of the mover's discs. A ray ends at a boundary, at an empty
 * point, or just before it would return to the start point, so the placed
 * disc never outflanks and a cyclic line of opponent discs flips nothing.
 * Discs reached from several directions flip once.
 *
 * Passing is automatic and leaves no replay event (one event per action): if
 * the opponent then has no legal move but the mover does, the mover moves
 * again and lastMove.skipped names the opponent; if neither can move the game
 * ends and the discs are counted.
 *
 * States carry their complete replay from the canonical start position, and
 * fromState() trusts nothing else: it replays the events and requires every
 * public field to match.
 */

const VALID_COLORS = new Set([BLACK, WHITE]);
const VALID_PHASES = new Set([PHASE_PLAY, PHASE_FINISHED]);
const LIMITS = BOARD_LIMITS[GAME_OTHELLO];

/** result.reason when the game ends because neither side can move. */
export const OTHELLO_RESULT_DISCS = "discs";

/**
 * @typedef {{row: number, col: number}} Point
 * @typedef {{type: 'play', color: 'black'|'white', row: number, col: number,
 *   flipped: Point[], skipped: 'black'|'white'|null}} OthelloLastMove
 */

function failure(reason) {
  return { ok: false, reason };
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

function requireOwnProperty(object, key, label) {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw new TypeError(`${label} is missing ${key}`);
  }
}

/** Deep equality of JSON values; object key order is ignored. */
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
    return (
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJson(left[key], right[key]),
    )
  );
}

function cloneJson(value) {
  return value === null || value === undefined
    ? null
    : JSON.parse(JSON.stringify(value));
}

function copyBoard(board) {
  return board.map((row) => [...row]);
}

function copyPoints(points) {
  return points.map(({ row, col }) => ({ row, col }));
}

function copyLastMove(lastMove) {
  if (lastMove === null) return null;
  return {
    type: "play",
    color: lastMove.color,
    row: lastMove.row,
    col: lastMove.col,
    flipped: copyPoints(lastMove.flipped),
    skipped: lastMove.skipped,
  };
}

function copyResult(result) {
  return cloneJson(result);
}

/** The canonical start: White on the main diagonal of the centre square. */
export function othelloStartBoard(width, height) {
  const board = Array.from({ length: height }, () => Array(width).fill(EMPTY));
  const top = height / 2 - 1;
  const left = width / 2 - 1;
  board[top][left] = WHITE;
  board[top][left + 1] = BLACK;
  board[top + 1][left] = BLACK;
  board[top + 1][left + 1] = WHITE;
  return board;
}

/** getState() of a new game with the given board settings. */
function canonicalStartState({ width, height, size, topology }) {
  return {
    gameType: GAME_OTHELLO,
    ...(size === undefined ? {} : { size }),
    width,
    height,
    topology,
    board: othelloStartBoard(width, height),
    currentPlayer: BLACK,
    phase: PHASE_PLAY,
    discs: { black: 2, white: 2 },
    lastMove: null,
    result: null,
  };
}

function requirePoint(value, width, height, label) {
  if (
    !Number.isInteger(value.row) ||
    !Number.isInteger(value.col) ||
    value.row < 0 ||
    value.row >= height ||
    value.col < 0 ||
    value.col >= width
  ) {
    throw new RangeError(`${label} must be a point on the board`);
  }
  // `+ 0` turns a JSON -0 into 0 so copies compare and serialize canonically.
  return { row: value.row + 0, col: value.col + 0 };
}

function copyReplayEvent(event, width, height, index) {
  const label = `replay.events[${index}]`;
  requirePlainObject(event, label);
  if (!VALID_COLORS.has(event.color)) {
    throw new TypeError(`${label} has an invalid color`);
  }
  if (event.type === "play") {
    const { row, col } = requirePoint(event, width, height, label);
    return { type: "play", color: event.color, row, col };
  }
  if (event.type === "resign") {
    return { type: "resign", color: event.color };
  }
  throw new TypeError(`${label} type ${event.type} does not exist in Othello`);
}

/** Validate a render-only last move from a public snapshot. */
function copyPublicLastMove(lastMove, width, height) {
  if (lastMove === null || lastMove === undefined) return null;
  requirePlainObject(lastMove, "lastMove");
  if (lastMove.type !== "play" || !VALID_COLORS.has(lastMove.color)) {
    throw new TypeError("lastMove must be an Othello play");
  }
  if (!Array.isArray(lastMove.flipped)) {
    throw new TypeError("lastMove.flipped must be an array");
  }
  const skipped = lastMove.skipped ?? null;
  if (skipped !== null && !VALID_COLORS.has(skipped)) {
    throw new TypeError("lastMove.skipped must be a color or null");
  }
  return {
    type: "play",
    color: lastMove.color,
    ...requirePoint(lastMove, width, height, "lastMove"),
    flipped: lastMove.flipped.map((point, index) =>
      requirePoint(
        requirePlainObject(point, `lastMove.flipped[${index}]`),
        width,
        height,
        `lastMove.flipped[${index}]`,
      ),
    ),
    skipped,
  };
}

export class OthelloEngine {
  #topologyCache = null;

  /**
   * @param {object} [options]
   * @param {number} [options.size] Square board side.
   * @param {number} [options.width=8] Column count (even, 6..30).
   * @param {number} [options.height=8] Row count (even, 6..30).
   * @param {'cylinder'|'torus'|'mobius'} [options.topology='cylinder']
   * @param {Array<Array<'black'|'white'|null>>} [options.initialBoard] A
   *   position other than the canonical start, for rendering and analysis.
   *   Such a game's replay is partial and fromState() will not restore it.
   * @param {'black'|'white'} [options.currentPlayer='black']
   */
  constructor({
    size,
    width,
    height,
    topology = TOPOLOGY_CYLINDER,
    initialBoard = null,
    currentPlayer = BLACK,
  } = {}) {
    const resolvedWidth = width ?? size ?? height ?? LIMITS.defaultWidth;
    const resolvedHeight = height ?? size ?? width ?? LIMITS.defaultHeight;
    if (
      !isValidBoardDimension(GAME_OTHELLO, resolvedWidth) ||
      !isValidBoardDimension(GAME_OTHELLO, resolvedHeight)
    ) {
      throw new RangeError(
        `Othello board width and height must be even integers from ${LIMITS.min} to ${LIMITS.max}`,
      );
    }
    if (
      size !== undefined &&
      (resolvedWidth !== size || resolvedHeight !== size)
    ) {
      throw new RangeError("Board size must match both width and height");
    }
    if (!TOPOLOGY_KINDS.includes(topology)) {
      throw new TypeError(`Unknown board topology: ${topology}`);
    }
    if (!VALID_COLORS.has(currentPlayer)) {
      throw new TypeError(`Unknown player color: ${currentPlayer}`);
    }

    this.width = resolvedWidth;
    this.height = resolvedHeight;
    this.size = resolvedWidth === resolvedHeight ? resolvedWidth : undefined;
    this.topology = topology;
    this.board = initialBoard
      ? this.#validateAndCopyBoard(initialBoard)
      : othelloStartBoard(this.width, this.height);
    this.currentPlayer = currentPlayer;
    this.phase = PHASE_PLAY;
    /** @type {OthelloLastMove|null} */
    this.lastMove = null;
    this.result = null;
    this.#resetReplay();
  }

  /** Game identity for the rules registry (a getter, never reassigned). */
  get gameType() {
    return GAME_OTHELLO;
  }

  /** Disc counts on the current board. */
  get discs() {
    let black = 0;
    let white = 0;
    for (const row of this.board) {
      for (const value of row) {
        if (value === BLACK) black += 1;
        else if (value === WHITE) white += 1;
      }
    }
    return { black, white };
  }

  /**
   * Restore a game from exportState() output or its JSON. The replay must
   * start from the canonical position; its events are re-applied and every
   * public field of the state must match the result. A state without a
   * replay is accepted only when it is the canonical start itself (a replay
   * base).
   *
   * @param {object|string} state
   * @returns {OthelloEngine}
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
    if (snapshot.gameType !== GAME_OTHELLO) {
      throw new TypeError(`Not an Othello state: ${snapshot.gameType}`);
    }
    for (const field of ["width", "height", "topology"]) {
      requireOwnProperty(snapshot, field, "State");
    }

    const game = new OthelloEngine({
      width: snapshot.width,
      height: snapshot.height,
      topology: snapshot.topology,
    });

    const hasReplay = Object.prototype.hasOwnProperty.call(snapshot, "replay");
    const events = hasReplay ? game.#copyCanonicalReplay(snapshot.replay) : [];
    events.forEach((event, index) => {
      if (game.phase !== PHASE_PLAY) {
        throw new TypeError(`replay.events[${index}] follows the end of the game`);
      }
      let result;
      if (event.type === "play") {
        if (event.color !== game.currentPlayer) {
          throw new TypeError(
            `replay.events[${index}] color does not match the player to move`,
          );
        }
        result = game.play(event.row, event.col);
      } else {
        result = game.resign(event.color);
      }
      if (!result.ok) {
        throw new TypeError(`replay.events[${index}] is illegal: ${result.reason}`);
      }
    });

    const reconstructed = game.getState();
    for (const [field, value] of Object.entries(reconstructed)) {
      if (field === "size") continue;
      requireOwnProperty(snapshot, field, "State");
      if (!sameJson(snapshot[field], value)) {
        throw new TypeError(
          hasReplay
            ? `replay events do not reconstruct the current ${field}`
            : `State ${field} differs from the starting position and has no replay`,
        );
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(snapshot, "size") &&
      snapshot.size !== reconstructed.size
    ) {
      throw new RangeError(
        "State size is only valid when it matches square width and height",
      );
    }
    return game;
  }

  /** Alias matching serialize(). */
  static deserialize(serialized) {
    return OthelloEngine.fromState(serialized);
  }

  /**
   * A render-only game from a public getState() snapshot (an online room
   * message). The position is checked for shape but not replayed; the
   * server owns the authoritative history. Later moves still follow the
   * rules, and undo can return to the snapshot but not before it.
   *
   * @param {object} state
   * @returns {OthelloEngine}
   */
  static fromPublicState(state) {
    requirePlainObject(state, "Public state");
    const game = new OthelloEngine({
      width: state.width ?? state.size,
      height: state.height ?? state.size,
      topology: state.topology ?? TOPOLOGY_CYLINDER,
      initialBoard: state.board,
      currentPlayer: state.currentPlayer ?? BLACK,
    });
    const phase = state.phase ?? PHASE_PLAY;
    if (!VALID_PHASES.has(phase)) {
      throw new TypeError(`Unknown game phase: ${phase}`);
    }
    game.phase = phase;
    game.lastMove = copyPublicLastMove(state.lastMove, game.width, game.height);
    if (state.result !== null && state.result !== undefined) {
      requirePlainObject(state.result, "result");
    }
    game.result = cloneJson(state.result);
    game.#resetReplay();
    return game;
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

  /** Start a new record at the current position. */
  #resetReplay() {
    const base = this.getState();
    this.replay = {
      version: REPLAY_VERSION,
      complete: sameJson(base, canonicalStartState(this)),
      base,
      events: [],
    };
  }

  /** Validate a persisted replay envelope and return copies of its events. */
  #copyCanonicalReplay(replay) {
    requirePlainObject(replay, "replay");
    for (const field of ["version", "complete", "base", "events"]) {
      requireOwnProperty(replay, field, "replay");
    }
    if (replay.version !== REPLAY_VERSION) {
      throw new TypeError(`Unsupported replay version: ${replay.version}`);
    }
    if (replay.complete !== true) {
      throw new TypeError("Othello replays must be complete");
    }
    requirePlainObject(replay.base, "replay.base");
    if (!sameJson(replay.base, this.replay.base)) {
      throw new TypeError("replay.base must be the canonical starting position");
    }
    if (!Array.isArray(replay.events)) {
      throw new TypeError("replay.events must be an array");
    }
    // Every play fills a point the start left empty; one resignation may follow.
    const maxEvents = this.width * this.height - 4 + 1;
    if (replay.events.length > maxEvents) {
      throw new RangeError(`replay.events must contain at most ${maxEvents} entries`);
    }
    return replay.events.map((event, index) =>
      copyReplayEvent(event, this.width, this.height, index),
    );
  }

  /**
   * The topology for the current board shape, re-resolved if the public
   * dimension fields are ever reassigned.
   */
  #topology() {
    const cached = this.#topologyCache;
    if (
      cached !== null &&
      cached.kind === this.topology &&
      cached.width === this.width &&
      cached.height === this.height
    ) {
      return cached;
    }
    this.#topologyCache = getTopology(this.topology, this.width, this.height);
    return this.#topologyCache;
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

  /**
   * Discs that `color` would flip by playing the empty point (row, col),
   * deduplicated in DIRECTIONS_8 order, nearest first. The walk visits the
   * same cells, in the same order, as topology.ray() and stops at the first
   * point that is not an opponent disc. With `firstOnly`, stop after the
   * first direction that flips anything.
   *
   * @returns {Point[]}
   */
  #flips(row, col, color, firstOnly = false) {
    const topology = this.#topology();
    const opponent = oppositeColor(color);
    // topology.ray's default bound; every walk ends well before it.
    const maxSteps = 2 * topology.pointCount;
    const flipped = [];
    const seen = new Set();
    for (const [dRow, dCol] of DIRECTIONS_8) {
      const run = [];
      let cursor = { row, col, dRow, dCol };
      let outflanked = false;
      while (run.length < maxSteps) {
        const next = topology.step(cursor.row, cursor.col, cursor.dRow, cursor.dCol);
        if (next === null || (next.row === row && next.col === col)) break;
        const value = this.board[next.row][next.col];
        if (value !== opponent) {
          outflanked = value === color && run.length > 0;
          break;
        }
        run.push(next);
        cursor = next;
      }
      if (!outflanked) continue;
      for (const disc of run) {
        const key = disc.row * this.width + disc.col;
        if (seen.has(key)) continue;
        seen.add(key);
        flipped.push({ row: disc.row, col: disc.col });
      }
      if (firstOnly) return flipped;
    }
    return flipped;
  }

  #hasLegalMove(color) {
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        if (
          this.board[row][col] === EMPTY &&
          this.#flips(row, col, color, true).length > 0
        ) {
          return true;
        }
      }
    }
    return false;
  }

  #checkPlacement(row, col) {
    if (this.phase !== PHASE_PLAY) return failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    if (!this.#validPoint(row, col)) return failure(MOVE_ERRORS.OUT_OF_BOUNDS);
    if (this.board[row][col] !== EMPTY) return failure(MOVE_ERRORS.OCCUPIED);
    const flipped = this.#flips(row, col, this.currentPlayer);
    if (flipped.length === 0) return failure(GAME_MOVE_ERRORS.NO_FLIPS);
    return { ok: true, flipped };
  }

  #discResult() {
    const { black, white } = this.discs;
    if (black === white) {
      return { winner: "draw", reason: OTHELLO_RESULT_DISCS, black, white, margin: 0 };
    }
    const winner = black > white ? BLACK : WHITE;
    return {
      winner,
      loser: oppositeColor(winner),
      reason: OTHELLO_RESULT_DISCS,
      black,
      white,
      margin: Math.abs(black - white),
    };
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
   * Whether play(row, col) would succeed, with play()'s exact failure
   * reason, without changing anything. On success, the discs it would flip.
   *
   * @returns {{ok: true, flipped: Point[]} | {ok: false, reason: string}}
   */
  checkPlay(row, col) {
    const check = this.#checkPlacement(row, col);
    return check.ok ? { ok: true, flipped: copyPoints(check.flipped) } : check;
  }

  /** Every legal point for the player to move, row-major; [] once finished. */
  legalMoves() {
    if (this.phase !== PHASE_PLAY) return [];
    const moves = [];
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        if (
          this.board[row][col] === EMPTY &&
          this.#flips(row, col, this.currentPlayer, true).length > 0
        ) {
          moves.push({ row, col });
        }
      }
    }
    return moves;
  }

  /**
   * Place a disc for the player to move. Illegal moves change nothing. After
   * the flips, the opponent moves next if it can; otherwise the mover moves
   * again (skipped = opponent) if it can; otherwise the game ends on discs.
   */
  play(row, col) {
    const check = this.#checkPlacement(row, col);
    if (!check.ok) return check;

    const color = this.currentPlayer;
    const opponent = oppositeColor(color);
    const { flipped } = check;
    this.board[row][col] = color;
    for (const disc of flipped) this.board[disc.row][disc.col] = color;

    let skipped = null;
    if (this.#hasLegalMove(opponent)) {
      this.currentPlayer = opponent;
    } else if (this.#hasLegalMove(color)) {
      skipped = opponent;
    } else {
      this.currentPlayer = opponent;
      this.phase = PHASE_FINISHED;
      this.result = this.#discResult();
    }
    this.lastMove = { type: "play", color, row, col, flipped, skipped };
    this.replay.events.push({ type: "play", color, row, col });

    return {
      ok: true,
      type: "play",
      color,
      row,
      col,
      flipped: copyPoints(flipped),
      skipped,
      nextPlayer: this.currentPlayer,
      phase: this.phase,
      result: copyResult(this.result),
    };
  }

  /** Alias convenient for UI/controller code. */
  playMove(row, col) {
    return this.play(row, col);
  }

  /** End an active game immediately because one color resigns. */
  resign(color = this.currentPlayer) {
    if (this.phase !== PHASE_PLAY) return failure(MOVE_ERRORS.GAME_NOT_PLAYING);
    if (!VALID_COLORS.has(color)) {
      throw new TypeError(`Unknown player color: ${color}`);
    }
    this.phase = PHASE_FINISHED;
    this.result = {
      winner: oppositeColor(color),
      loser: color,
      margin: 0,
      reason: "resign",
      resignation: true,
    };
    this.replay.events.push({ type: "resign", color });
    return { ok: true, type: "resign", color, ...this.result, phase: this.phase };
  }

  /** Whether a play can be taken back: only while the game is in progress. */
  canUndo() {
    return this.phase === PHASE_PLAY && this.replay.events.length > 0;
  }

  /**
   * Colours of the recorded plays, oldest first. After an automatic pass the
   * same colour appears twice in a row, so rooms count back to a player's
   * latest move from here rather than assuming alternation.
   *
   * @returns {Array<'black'|'white'>}
   */
  undoMoveColors() {
    return this.replay.events
      .filter((event) => event.type === "play")
      .map((event) => event.color);
  }

  /**
   * Take back the latest play by rebuilding the game from the replay base
   * without it. The turn returns to the undone move's colour.
   */
  undo() {
    if (!this.canUndo()) return failure(MOVE_ERRORS.NOTHING_TO_UNDO);
    const move = copyLastMove(this.lastMove);
    const events = this.replay.events.slice(0, -1);
    const { base } = this.replay;

    const rebuilt = new OthelloEngine({
      width: this.width,
      height: this.height,
      topology: this.topology,
      initialBoard: base.board,
      currentPlayer: base.currentPlayer,
    });
    rebuilt.phase = base.phase;
    rebuilt.lastMove = copyLastMove(base.lastMove);
    rebuilt.result = copyResult(base.result);
    for (const event of events) {
      if (!rebuilt.play(event.row, event.col).ok) {
        throw new Error("Othello replay history is inconsistent");
      }
    }

    this.board = rebuilt.board;
    this.currentPlayer = rebuilt.currentPlayer;
    this.phase = rebuilt.phase;
    this.lastMove = rebuilt.lastMove;
    this.result = rebuilt.result;
    this.replay.events = events;

    return {
      ok: true,
      type: "undo",
      move,
      currentPlayer: this.currentPlayer,
      phase: this.phase,
    };
  }

  /** Small serializable snapshot for UI stores and multiplayer messages. */
  getState() {
    return {
      gameType: GAME_OTHELLO,
      ...(this.size === undefined ? {} : { size: this.size }),
      width: this.width,
      height: this.height,
      topology: this.topology,
      board: this.getBoard(),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      discs: this.discs,
      lastMove: copyLastMove(this.lastMove),
      result: copyResult(this.result),
    };
  }

  /**
   * Complete persistence snapshot: the public state plus the replay that
   * fromState() re-applies. The position alone (includeReplay: false) is
   * only restorable for the starting position.
   *
   * @param {{includeReplay?: boolean}} [options]
   */
  exportState({ includeReplay = true } = {}) {
    const state = this.getState();
    if (includeReplay) state.replay = this.getReplayState();
    return state;
  }

  /** The complete move record: canonical base plus play/resign events. */
  getReplayState() {
    return cloneJson(this.replay);
  }

  /** The complete persistence snapshot as JSON. */
  serialize() {
    return JSON.stringify(this.exportState());
  }
}

export default OthelloEngine;

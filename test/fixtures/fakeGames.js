// TEST-ONLY fake Gomoku and Othello rules for room, worker and client tests.
//
// They follow the multi-game engine protocol (getState/exportState/replay,
// play/resign/undo/undoMoveColors, fromState validation) with deliberately
// tiny rules so room behaviour can be tested before, and independently of,
// the real engines:
//
// - fake Gomoku: five in a row along a row (no wrapping) wins at once; a
//   full board is a draw; under Renju, Black may never play the corner (0, 0)
//   ("forbidden" / double_three).
// - fake Othello: the usual four centre discs; any empty point is legal
//   except the bottom-left corner ("no_flips"); nothing is ever flipped. A
//   move on row 0 leaves the opponent without a legal move, so the mover
//   moves again (lastMove.skipped) without an extra replay event; a full
//   board ends the game on disc count.
import {
  BOARD_LIMITS,
  GAME_GOMOKU,
  GAME_OTHELLO,
  GOMOKU_FREESTYLE,
  GOMOKU_RULE_SETS,
  GameSettingsError,
  MATCH_MODES,
  SGF_GAME_CODES,
  isValidBoardDimension,
  readonlySet,
} from "../../src/game/gameTypes.js";
import { registerRulesForTest } from "../../src/game/rules/index.js";
import { NON_GO_ROOM_ACTIONS } from "../../src/game/rules/shared.js";

const TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const COLORS = new Set(["black", "white"]);

function opposite(color) {
  return color === "black" ? "white" : "black";
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function failure(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

export class FakeGame {
  #replay;

  constructor({ gameType, width, height, topology = "cylinder", ruleSet } = {}) {
    if (gameType !== GAME_GOMOKU && gameType !== GAME_OTHELLO) {
      throw new TypeError(`Fake games cover Gomoku and Othello, not ${gameType}`);
    }
    for (const value of [width, height]) {
      if (!isValidBoardDimension(gameType, value)) {
        throw new RangeError(`Invalid ${gameType} board side ${value}`);
      }
    }
    if (!TOPOLOGIES.has(topology)) throw new TypeError(`Unknown topology ${topology}`);
    this.gameType = gameType;
    if (gameType === GAME_GOMOKU) this.ruleSet = ruleSet ?? GOMOKU_FREESTYLE;
    this.width = width;
    this.height = height;
    this.size = width === height ? width : undefined;
    this.topology = topology;
    this.board = Array.from({ length: height }, () => Array(width).fill(null));
    if (gameType === GAME_OTHELLO) {
      const top = height / 2 - 1;
      const left = width / 2 - 1;
      this.board[top][left] = "white";
      this.board[top][left + 1] = "black";
      this.board[top + 1][left] = "black";
      this.board[top + 1][left + 1] = "white";
    }
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.result = null;
    this.#replay = {
      version: 1,
      complete: true,
      base: this.getState(),
      events: [],
    };
  }

  settings() {
    return {
      width: this.width,
      height: this.height,
      topology: this.topology,
      ...(this.ruleSet === undefined ? {} : { ruleSet: this.ruleSet }),
    };
  }

  discs() {
    const discs = { black: 0, white: 0 };
    for (const row of this.board) {
      for (const point of row) if (point) discs[point] += 1;
    }
    return discs;
  }

  #full() {
    return this.board.every((row) => row.every((point) => point !== null));
  }

  checkPlay(row, col, color = this.currentPlayer) {
    if (this.phase !== "play") return failure("game_not_playing");
    if (
      !Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row >= this.height || col < 0 || col >= this.width
    ) {
      return failure("out_of_bounds");
    }
    if (this.board[row][col] !== null) return failure("occupied");
    if (this.gameType === GAME_GOMOKU && this.ruleSet === "renju" &&
        color === "black" && row === 0 && col === 0) {
      return failure("forbidden", { forbidden: "double_three" });
    }
    if (this.gameType === GAME_OTHELLO && row === this.height - 1 && col === 0) {
      return failure("no_flips");
    }
    return { ok: true };
  }

  legalMoves(color = this.currentPlayer) {
    const moves = [];
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        if (this.checkPlay(row, col, color).ok) moves.push({ row, col });
      }
    }
    return moves;
  }

  play(row, col) {
    const check = this.checkPlay(row, col);
    if (!check.ok) return check;
    const color = this.currentPlayer;
    this.board[row][col] = color;
    this.#replay.events.push({ type: "play", color, row, col });
    return this.gameType === GAME_GOMOKU
      ? this.#afterGomokuPlay(color, row, col)
      : this.#afterOthelloPlay(color, row, col);
  }

  #afterGomokuPlay(color, row, col) {
    this.lastMove = { type: "play", color, row, col };
    let start = col;
    while (start > 0 && this.board[row][start - 1] === color) start -= 1;
    let end = col;
    while (end < this.width - 1 && this.board[row][end + 1] === color) end += 1;
    const length = end - start + 1;
    if (length >= 5) {
      this.phase = "finished";
      this.result = {
        winner: color,
        loser: opposite(color),
        reason: "five",
        margin: 0,
        line: Array.from({ length }, (_, index) => ({ row, col: start + index })),
        length,
      };
    } else if (this.#full()) {
      this.phase = "finished";
      this.result = { winner: "draw", reason: "board_full", margin: 0 };
    } else {
      this.currentPlayer = opposite(color);
    }
    return {
      ok: true, type: "play", color, row, col,
      phase: this.phase, currentPlayer: this.currentPlayer,
      ...(this.result ? { result: clone(this.result) } : {}),
    };
  }

  #afterOthelloPlay(color, row, col) {
    let skipped = null;
    if (this.#full()) {
      const discs = this.discs();
      this.phase = "finished";
      const winner = discs.black === discs.white
        ? "draw"
        : discs.black > discs.white ? "black" : "white";
      this.result = {
        winner,
        ...(winner === "draw" ? {} : { loser: opposite(winner) }),
        reason: "discs",
        black: discs.black,
        white: discs.white,
        margin: Math.abs(discs.black - discs.white),
      };
    } else if (row === 0) {
      // The opponent has no legal move: the mover continues.
      skipped = opposite(color);
    } else {
      this.currentPlayer = opposite(color);
    }
    this.lastMove = { type: "play", color, row, col, flipped: [], skipped };
    return {
      ok: true, type: "play", color, row, col, flipped: [], skipped,
      phase: this.phase, currentPlayer: this.currentPlayer,
    };
  }

  resign(color = this.currentPlayer) {
    if (this.phase !== "play") return failure("game_not_playing");
    if (!COLORS.has(color)) throw new TypeError(`Unknown player color: ${color}`);
    this.phase = "finished";
    this.result = {
      winner: opposite(color),
      loser: color,
      margin: 0,
      reason: "resign",
      resignation: true,
    };
    this.#replay.events.push({ type: "resign", color });
    return { ok: true, type: "resign", color, ...clone(this.result), phase: this.phase };
  }

  canUndo() {
    return this.phase === "play" && this.#replay.events.some((event) => event.type === "play");
  }

  undoMoveColors() {
    return this.#replay.events
      .filter((event) => event.type === "play")
      .map((event) => event.color);
  }

  undo() {
    if (!this.canUndo()) return failure("nothing_to_undo");
    const events = this.#replay.events.slice(0, -1);
    const undone = this.#replay.events.at(-1);
    const rebuilt = FakeGame.#replayed(this.gameType, this.settings(), events);
    Object.assign(this, {
      board: rebuilt.board,
      currentPlayer: rebuilt.currentPlayer,
      phase: rebuilt.phase,
      lastMove: rebuilt.lastMove,
      result: rebuilt.result,
    });
    this.#replay = rebuilt.getReplayState();
    return {
      ok: true,
      type: "undo",
      move: { type: "play", color: undone.color, row: undone.row, col: undone.col },
      currentPlayer: this.currentPlayer,
      phase: this.phase,
    };
  }

  getState() {
    return {
      gameType: this.gameType,
      ...(this.ruleSet === undefined ? {} : { ruleSet: this.ruleSet }),
      width: this.width,
      height: this.height,
      ...(this.size === undefined ? {} : { size: this.size }),
      topology: this.topology,
      board: clone(this.board),
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      lastMove: clone(this.lastMove),
      result: clone(this.result),
      ...(this.gameType === GAME_OTHELLO ? { discs: this.discs() } : {}),
    };
  }

  getReplayState() {
    return clone(this.#replay);
  }

  exportState() {
    return { ...this.getState(), replay: this.getReplayState() };
  }

  serialize() {
    return JSON.stringify(this.exportState());
  }

  static #replayed(gameType, settings, events) {
    const game = new FakeGame({ gameType, ...settings });
    for (const [index, event] of events.entries()) {
      if (
        !event ||
        !COLORS.has(event.color) ||
        (event.type === "play" && event.color !== game.currentPlayer)
      ) {
        throw new TypeError(`replay.events[${index}] does not match the player to move`);
      }
      const result = event.type === "play"
        ? game.play(event.row, event.col)
        : event.type === "resign"
          ? game.resign(event.color)
          : failure("unknown_event");
      if (!result.ok) throw new TypeError(`replay.events[${index}] is illegal: ${result.reason}`);
    }
    return game;
  }

  static fromState(input, gameType) {
    const state = typeof input === "string" ? JSON.parse(input) : clone(input);
    if (!state || typeof state !== "object" || state.gameType !== gameType) {
      throw new TypeError(`Not a ${gameType} state`);
    }
    const base = state.replay?.base;
    if (state.replay?.version !== 1 || !base || !Array.isArray(state.replay.events)) {
      throw new TypeError("A fake game state needs its replay");
    }
    const settings = {
      width: base.width,
      height: base.height,
      topology: base.topology,
      ...(base.ruleSet === undefined ? {} : { ruleSet: base.ruleSet }),
    };
    const canonical = new FakeGame({ gameType, ...settings });
    if (JSON.stringify(canonical.getState()) !== JSON.stringify(base)) {
      throw new TypeError("The replay base is not a fresh game");
    }
    const game = FakeGame.#replayed(gameType, settings, state.replay.events);
    for (const key of ["board", "currentPlayer", "phase", "lastMove", "result"]) {
      if (JSON.stringify(game[key]) !== JSON.stringify(state[key] ?? null)) {
        throw new TypeError(`Stored ${key} does not match the replay`);
      }
    }
    return game;
  }
}

/** Fake GameRules for Gomoku or Othello, in the registry's shape. */
export function fakeRules(gameType) {
  const limits = BOARD_LIMITS[gameType];
  const defaults = Object.freeze({
    width: limits.defaultWidth,
    height: limits.defaultHeight,
    topology: "cylinder",
    ...(gameType === GAME_GOMOKU ? { ruleSet: GOMOKU_FREESTYLE } : {}),
  });
  const side = (value, field) => {
    if (!isValidBoardDimension(gameType, value)) {
      throw new GameSettingsError(`Bad ${gameType} ${field}`, field);
    }
    return value;
  };
  return Object.freeze({
    id: gameType,
    sgfCode: SGF_GAME_CODES[gameType],
    defaults,
    limits,
    capabilities: Object.freeze({
      pass: false,
      scoring: false,
      undo: true,
      resign: true,
      ai: true,
      analysis: false,
      sgf: false,
    }),
    roomActions: readonlySet(NON_GO_ROOM_ACTIONS),
    matchModes: Object.freeze([
      MATCH_MODES.FRIEND,
      MATCH_MODES.HUMAN_AI,
      MATCH_MODES.AI_AI,
      MATCH_MODES.LOCAL,
    ]),
    normalizeSettings(raw = {}, previous = null) {
      const width = side(
        raw.width ?? raw.size ?? previous?.width ?? previous?.size ?? defaults.width,
        "width",
      );
      const height = side(
        raw.height ?? raw.size ?? previous?.height ?? previous?.size ?? defaults.height,
        "height",
      );
      const topology = raw.topology ?? previous?.topology ?? defaults.topology;
      if (!TOPOLOGIES.has(topology)) {
        throw new GameSettingsError(`Unknown topology ${topology}`, "topology");
      }
      const settings = {
        width,
        height,
        ...(width === height ? { size: width } : {}),
        topology,
      };
      if (gameType === GAME_GOMOKU) {
        const ruleSet = raw.ruleSet ?? previous?.ruleSet ?? defaults.ruleSet;
        if (!GOMOKU_RULE_SETS.includes(ruleSet)) {
          throw new GameSettingsError(`Unknown rule set ${ruleSet}`, "ruleSet");
        }
        settings.ruleSet = ruleSet;
      }
      return settings;
    },
    create(settings) {
      return new FakeGame({
        gameType,
        width: settings.width,
        height: settings.height,
        topology: settings.topology,
        ruleSet: settings.ruleSet,
      });
    },
    fromState(state) {
      return FakeGame.fromState(state, gameType);
    },
    hydratePublic(state) {
      const game = new FakeGame({
        gameType,
        width: state.width,
        height: state.height,
        topology: state.topology,
        ruleSet: state.ruleSet,
      });
      Object.assign(game, {
        board: clone(state.board),
        currentPlayer: state.currentPlayer,
        phase: state.phase,
        lastMove: clone(state.lastMove),
        result: clone(state.result),
      });
      return game;
    },
    settingsFromGame(engine, clock = null) {
      return {
        gameType,
        ...(engine.ruleSet === undefined ? {} : { ruleSet: engine.ruleSet }),
        width: engine.width,
        height: engine.height,
        ...(engine.width === engine.height ? { size: engine.width } : {}),
        topology: engine.topology,
        mainTimeSeconds: clock?.mainTimeSeconds ?? 0,
        byoYomiPeriods: clock?.byoYomiPeriods ?? 0,
        byoYomiSeconds: clock?.byoYomiSeconds ?? 0,
      };
    },
    positionFingerprint(engine) {
      return { fake: gameType, legal: engine.legalMoves().length };
    },
    viewMarkers: () => ({}),
  });
}

/**
 * Register the fake Gomoku and Othello rules; returns the restore function.
 * Call it from a test file's top level and restore in an `after` hook.
 */
export function installFakeGames() {
  const restores = [GAME_GOMOKU, GAME_OTHELLO].map((gameType) =>
    registerRulesForTest(gameType, fakeRules(gameType))
  );
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

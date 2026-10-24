import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOARD_LIMITS,
  ENABLE_MULTI_GAME,
  FORBIDDEN_REASONS,
  GAME_GO,
  GAME_GOMOKU,
  GAME_MOVE_ERRORS,
  GAME_OTHELLO,
  GAME_TYPES,
  GOMOKU_RULE_SETS,
  GameSettingsError,
  MATCH_MODES,
  SGF_GAME_CODES,
  isGameType,
  isValidBoardDimension,
  readonlySet,
} from "../src/game/gameTypes.js";
import {
  BLACK,
  GoEngine,
  MOVE_ERRORS,
  TOPOLOGY_CYLINDER,
  UNDO_HISTORY_LIMIT,
  WHITE,
} from "../src/game/goEngine.js";
import { buildReplayFrames, buildReplayStateAtStep } from "../src/game/replay.js";
import { gameTypeOf, rulesFor } from "../src/game/rules/index.js";
import { goRules } from "../src/game/rules/go.js";
import { timeControlConfig } from "../src/game/timeControl.js";
import { ROOM_ACTIONS } from "../src/multiplayer/protocol.js";
import {
  MATCH_MODE_AI_AI,
  MATCH_MODE_FRIEND,
  MATCH_MODE_HUMAN_AI,
  MATCH_MODE_LOCAL,
  RoomEngine,
} from "../src/multiplayer/roomEngine.js";
import { appSource } from "./helpers/appSource.js";

const PUBLIC_FIELDS = [
  "size", "width", "height", "komi", "scoringRule", "topology", "board",
  "currentPlayer", "phase", "consecutivePasses", "captures", "lastMove", "result",
];

function playMoves(game, moves) {
  for (const [row, col] of moves) assert.equal(game.play(row, col).ok, true);
  return game;
}

/** A small finished-by-scoring game with a capture and a dead group. */
function scoredGame() {
  const game = playMoves(new GoEngine({ width: 7, height: 5, topology: "mobius" }), [
    [1, 0], [1, 6], [2, 1], [2, 0], [3, 0], [0, 0], [0, 1],
  ]);
  game.pass();
  game.pass();
  game.toggleDead(1, 0);
  game.finishScoring("chinese");
  return game;
}

test("game types, rule sets, limits and errors are fixed constants", () => {
  assert.equal(ENABLE_MULTI_GAME, true);
  assert.deepEqual(GAME_TYPES, ["go", "gomoku", "othello"]);
  assert.deepEqual([GAME_GO, GAME_GOMOKU, GAME_OTHELLO], GAME_TYPES);
  assert.deepEqual(GOMOKU_RULE_SETS, ["freestyle", "renju"]);
  assert.deepEqual(SGF_GAME_CODES, { go: 1, othello: 2, gomoku: 4 });
  assert.deepEqual(GAME_MOVE_ERRORS, {
    FORBIDDEN: "forbidden",
    NO_FLIPS: "no_flips",
    UNSUPPORTED_ACTION: "unsupported_action",
  });
  assert.deepEqual(Object.values(FORBIDDEN_REASONS), ["overline", "double_four", "double_three"]);
  // New codes never collide with Go's own move errors.
  for (const code of Object.values(GAME_MOVE_ERRORS)) {
    assert.ok(!Object.values(MOVE_ERRORS).includes(code));
  }
  assert.deepEqual(MATCH_MODES, {
    FRIEND: MATCH_MODE_FRIEND,
    HUMAN_AI: MATCH_MODE_HUMAN_AI,
    AI_AI: MATCH_MODE_AI_AI,
    LOCAL: MATCH_MODE_LOCAL,
  });
  assert.ok(isGameType("othello") && !isGameType("chess") && !isGameType(undefined));
  for (const value of [Object.isFrozen(GAME_TYPES), Object.isFrozen(BOARD_LIMITS),
    Object.isFrozen(BOARD_LIMITS.go), Object.isFrozen(GAME_MOVE_ERRORS)]) {
    assert.equal(value, true);
  }
});

test("board limits follow each game's rules", () => {
  assert.deepEqual(
    { ...BOARD_LIMITS.go },
    { min: 3, publicMin: 5, max: 30, parity: null, defaultWidth: 19, defaultHeight: 19 },
  );
  assert.deepEqual(
    { ...BOARD_LIMITS.gomoku },
    { min: 11, publicMin: 11, max: 30, parity: null, defaultWidth: 15, defaultHeight: 15 },
  );
  assert.deepEqual(
    { ...BOARD_LIMITS.othello },
    { min: 6, publicMin: 6, max: 30, parity: "even", defaultWidth: 8, defaultHeight: 8 },
  );
  assert.equal(isValidBoardDimension("go", 3), true);
  assert.equal(isValidBoardDimension("go", 3, { publicOnly: true }), false);
  assert.equal(isValidBoardDimension("go", 31), false);
  assert.equal(isValidBoardDimension("gomoku", 10), false);
  assert.equal(isValidBoardDimension("gomoku", 11), true);
  assert.equal(isValidBoardDimension("othello", 7), false);
  assert.equal(isValidBoardDimension("othello", 30), true);
  assert.equal(isValidBoardDimension("othello", 4), false);
  assert.equal(isValidBoardDimension("othello", 8.5), false);
  assert.throws(() => isValidBoardDimension("chess", 8), TypeError);
});

test("read-only sets reject changes", () => {
  const set = readonlySet(["a", "b"]);
  assert.equal(set.has("a"), true);
  assert.equal(set.size, 2);
  assert.throws(() => set.add("c"), TypeError);
  assert.throws(() => set.delete("a"), TypeError);
  assert.throws(() => set.clear(), TypeError);
  assert.deepEqual([...set], ["a", "b"]);
});

test("the registry resolves every game and treats untyped values as Go", () => {
  for (const gameType of GAME_TYPES) {
    const rules = rulesFor(gameType);
    assert.equal(rules.id, gameType);
    assert.equal(rules.sgfCode, SGF_GAME_CODES[gameType]);
    assert.equal(rules.limits, BOARD_LIMITS[gameType]);
    assert.ok(Object.isFrozen(rules));
    for (const method of [
      "normalizeSettings", "create", "fromState", "hydratePublic",
      "settingsFromGame", "positionFingerprint", "viewMarkers",
    ]) {
      assert.equal(typeof rules[method], "function", `${gameType}.${method}`);
    }
    assert.deepEqual(
      Object.keys(rules.capabilities).sort(),
      ["ai", "analysis", "pass", "resign", "scoring", "sgf", "undo"],
    );
    for (const action of rules.roomActions) assert.ok(ROOM_ACTIONS.includes(action));
    for (const mode of rules.matchModes) assert.ok(Object.values(MATCH_MODES).includes(mode));
  }
  assert.equal(rulesFor("go"), goRules);
  assert.throws(() => rulesFor("chess"), /Unknown game type: chess/u);
  assert.throws(() => rulesFor(undefined), TypeError);

  assert.equal(gameTypeOf(undefined), "go");
  assert.equal(gameTypeOf(null), "go");
  assert.equal(gameTypeOf({}), "go");
  assert.equal(gameTypeOf({ gameType: "othello" }), "othello");
  assert.equal(gameTypeOf(new GoEngine({ size: 9 })), "go");
  assert.equal(gameTypeOf(new GoEngine({ size: 9 }).getState()), "go");
});

test("Go keeps every action, mode and capability", () => {
  assert.deepEqual([...goRules.roomActions], [...ROOM_ACTIONS]);
  assert.throws(() => goRules.roomActions.add("x"), TypeError);
  assert.deepEqual(goRules.matchModes, ["friend", "human-ai", "ai-ai", "local"]);
  assert.ok(Object.values(goRules.capabilities).every((value) => value === true));
  assert.deepEqual(goRules.defaults, {
    width: 19, height: 19, komi: 6.5, scoringRule: "japanese", topology: "cylinder",
  });
  const game = new GoEngine({ size: 9 });
  assert.equal(goRules.positionFingerprint(game, {}), null);
  assert.deepEqual(goRules.viewMarkers(game, { hints: true }), {});
});

test("Gomoku and Othello declare their capabilities, actions and defaults", () => {
  for (const gameType of [GAME_GOMOKU, GAME_OTHELLO]) {
    const rules = rulesFor(gameType);
    assert.deepEqual(rules.matchModes, ["friend", "human-ai", "ai-ai", "local"]);
    assert.deepEqual(
      { ...rules.capabilities },
      { pass: false, scoring: false, undo: true, resign: true, ai: true, analysis: false, sgf: true },
    );
    // An AI never passes in these games; KataGo analysis stays Go's.
    for (const action of ["pass", "ai_pass", "toggle_dead", "finish_scoring", "resume_play"]) {
      assert.equal(rules.roomActions.has(action), false, `${gameType} ${action}`);
    }
    for (const action of ["play", "resign", "request_undo", "new_game", "chat", "sync", "leave",
      "attach_ai", "detach_ai", "ai_play", "set_ai_autoplay_paused",
      "direct_undo_ai_round", "direct_undo_ai_move"]) {
      assert.equal(rules.roomActions.has(action), true, `${gameType} ${action}`);
    }
  }
  assert.deepEqual(rulesFor("gomoku").defaults, {
    width: 15, height: 15, topology: "cylinder", ruleSet: "freestyle",
  });
  assert.deepEqual(rulesFor("othello").defaults, { width: 8, height: 8, topology: "cylinder" });
});

test("GoEngine reports its game type without serializing it", () => {
  const game = scoredGame();
  assert.equal(game.gameType, "go");
  assert.equal(Object.hasOwn(game, "gameType"), false);
  assert.equal(Object.hasOwn(game.getState(), "gameType"), false);
  assert.equal(Object.hasOwn(game.exportState(), "gameType"), false);
  assert.doesNotMatch(game.serialize(), /gameType/u);
  assert.doesNotMatch(JSON.stringify(game.exportSearchState()), /gameType/u);
  assert.equal(GoEngine.fromState(game.serialize()).gameType, "go");
  assert.equal(game.cloneForSearch().gameType, "go");
});

test("undoMoveColors lists the undo history's move colours, oldest first", () => {
  const game = new GoEngine({ size: 9 });
  assert.deepEqual(game.undoMoveColors(), []);
  game.play(2, 2);
  game.pass();
  game.play(3, 3);
  assert.deepEqual(game.undoMoveColors(), [BLACK, WHITE, BLACK]);
  game.undo();
  assert.deepEqual(game.undoMoveColors(), [BLACK, WHITE]);
  const colors = game.undoMoveColors();
  colors.push(WHITE);
  assert.deepEqual(game.undoMoveColors(), [BLACK, WHITE]);

  for (let index = 0; index < UNDO_HISTORY_LIMIT + 6; index += 1) {
    assert.equal(game.pass().ok || game.resumePlay(game.currentPlayer).ok, true);
  }
  assert.deepEqual(
    game.undoMoveColors(),
    game.undoHistory.map((entry) => entry.move.color),
  );
  assert.ok(game.undoMoveColors().length <= UNDO_HISTORY_LIMIT);
});

test("Go create matches the room engine's new-round construction", () => {
  for (const settings of [
    { width: 9, height: 9, komi: 6.5, scoringRule: "japanese", topology: "cylinder" },
    { width: 8, height: 5, komi: 0.5, scoringRule: "chinese", topology: "mobius" },
    { width: 13, height: 19, komi: 7, scoringRule: "chinese", topology: "torus" },
  ]) {
    const created = goRules.create(settings);
    const room = RoomEngine.create({
      code: "RUL234", name: "Black", playerId: "black", tokenHash: "a".repeat(64),
      now: 1_000, ...settings,
    });
    assert.ok(created instanceof GoEngine);
    assert.equal(created.serialize(), room.game.serialize());
  }
  assert.throws(() => goRules.create({ width: 2, height: 9 }), RangeError);
});

test("Go normalizeSettings mirrors the room's round-setting rules", () => {
  assert.deepEqual(goRules.normalizeSettings(), {
    width: 19, height: 19, size: 19, komi: 6.5, scoringRule: "japanese", topology: "cylinder",
  });
  assert.deepEqual(goRules.normalizeSettings({ size: 9, komi: 0 }), {
    width: 9, height: 9, size: 9, komi: 0, scoringRule: "japanese", topology: "cylinder",
  });
  const previous = new GoEngine({ width: 8, height: 5, komi: 7, scoringRule: "chinese", topology: "torus" });
  assert.deepEqual(goRules.normalizeSettings({}, previous), {
    width: 8, height: 5, komi: 7, scoringRule: "chinese", topology: "torus",
  });
  assert.deepEqual(goRules.normalizeSettings({ height: 8, topology: "mobius" }, previous), {
    width: 8, height: 8, size: 8, komi: 7, scoringRule: "chinese", topology: "mobius",
  });
  for (const [raw, field] of [
    [{ width: 2 }, "width"], [{ height: 31 }, "height"], [{ size: 9.5 }, "width"],
    [{ komi: -1 }, "komi"], [{ komi: 51 }, "komi"], [{ komi: Number.NaN }, "komi"],
    [{ scoringRule: "area" }, "scoringRule"], [{ topology: "sphere" }, "topology"],
  ]) {
    assert.throws(
      () => goRules.normalizeSettings(raw),
      (error) => error instanceof GameSettingsError && error instanceof RangeError &&
        error.field === field,
      JSON.stringify(raw),
    );
  }

  // The room accepts and stores exactly the same game settings.
  const room = RoomEngine.create({
    code: "RUL234", name: "Black", playerId: "black", tokenHash: "a".repeat(64),
    now: 1_000, width: 8, height: 5, komi: 7, scoringRule: "chinese", topology: "torus",
    startImmediately: false,
  });
  room.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now: 1_001 });
  const payload = { height: 8, topology: "mobius", komi: 3.5 };
  room.applyAction({ playerId: "black", action: "request_game", payload: { ...payload, mode: "friend" }, now: 1_002 });
  const { mainTimeSeconds, byoYomiPeriods, byoYomiSeconds, ...roomSettings } =
    room.state.match.request.settings;
  assert.deepEqual(roomSettings, goRules.normalizeSettings(payload, room.game));
});

test("Go settingsFromGame matches archived round settings", () => {
  for (const clock of [
    {},
    { mainTimeSeconds: 600, byoYomiPeriods: 3, byoYomiSeconds: 30 },
  ]) {
    const room = RoomEngine.create({
      code: "RUL234", name: "Black", playerId: "black", tokenHash: "a".repeat(64),
      now: 1_000, width: 9, height: 7, topology: "mobius", ...clock,
    });
    room.join({ name: "White", role: "player", playerId: "white", tokenHash: "b".repeat(64), now: 1_001 });
    room.archiveCurrentRound(2_000);
    assert.deepEqual(
      goRules.settingsFromGame(room.game, timeControlConfig(room.state.timeControl)),
      room.state.roundArchive.at(-1).settings,
    );
  }
  assert.deepEqual(goRules.settingsFromGame(new GoEngine({ size: 9 })), {
    width: 9, height: 9, size: 9, komi: 6.5, scoringRule: "japanese", topology: "cylinder",
    mainTimeSeconds: 0, byoYomiPeriods: 0, byoYomiSeconds: 0,
  });
});

test("Go fromState is GoEngine.fromState and refuses other games' states", () => {
  const game = scoredGame();
  assert.equal(goRules.fromState(game.exportState()).serialize(), game.serialize());
  assert.equal(goRules.fromState(game.serialize()).serialize(), game.serialize());
  assert.equal(goRules.fromState({ ...game.exportState(), gameType: "go" }).serialize(), game.serialize());
  assert.throws(() => goRules.fromState({ ...game.exportState(), gameType: "othello" }), TypeError);
  assert.throws(() => goRules.fromState({ ...game.exportState(), board: [] }), RangeError);
});

/**
 * The hydratePublicGame that main.js used before multiple games, verbatim.
 * main.js now delegates to the rules registry (asserted below), so this copy
 * pins Go's hydration to its historical behaviour.
 */
function legacyHydratePublicGame() {
  const cloneSerializable = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const boardWidth = (state, fallback = 19) => {
    const value = state?.width ?? state?.size;
    return Number.isInteger(value) ? value : fallback;
  };
  const boardHeight = (state, fallback = 19) => {
    const value = state?.height ?? state?.size;
    return Number.isInteger(value) ? value : fallback;
  };
  return function hydratePublicGame(state) {
    const hydrated = new GoEngine({
      ...(Number.isInteger(state.size) ? { size: state.size } : {}),
      width: boardWidth(state),
      height: boardHeight(state),
      topology: state.topology ?? TOPOLOGY_CYLINDER,
      komi: state.komi,
      scoringRule: state.scoringRule,
      initialBoard: state.board,
      currentPlayer: state.currentPlayer,
    });
    hydrated.phase = state.phase;
    hydrated.consecutivePasses = state.consecutivePasses;
    hydrated.captures = { ...state.captures };
    hydrated.deadStones = new Set(
      (state.deadStones ?? []).map(({ row, col }) => `${row},${col}`),
    );
    hydrated.lastMove = cloneSerializable(state.lastMove);
    hydrated.result = cloneSerializable(state.result);
    return hydrated;
  };
}

test("main.js hydrates public room states through the rules registry", () => {
  const main = appSource();
  const start = main.indexOf("function hydratePublicGame(");
  const end = main.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start);
  assert.match(
    main.slice(start, end),
    /return rulesFor\(gameTypeOf\(state\)\)\.hydratePublic\(state\);/u,
  );
  assert.doesNotMatch(main, /new GoEngine\(/u, "every engine is built by its game's rules");
  assert.doesNotMatch(main, /GoEngine\.fromState\(/u);
});

function hydratedFields(engine) {
  return JSON.stringify({
    ...Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, engine[field]])),
    deadStones: [...engine.deadStones],
  });
}

test("Go hydratePublic reproduces main.js hydratePublicGame", () => {
  const legacy = legacyHydratePublicGame();
  const scoring = playMoves(new GoEngine({ width: 9, height: 6, topology: "torus" }), [
    [0, 0], [5, 5], [0, 1],
  ]);
  scoring.pass();
  scoring.pass();
  scoring.toggleDead(5, 5);
  const resigned = playMoves(new GoEngine({ size: 9 }), [[4, 4]]);
  resigned.resign(WHITE);
  const states = [
    new GoEngine({ size: 9 }).getState(),
    playMoves(new GoEngine({ width: 7, height: 5, topology: "mobius" }), [[1, 0], [1, 6], [2, 1]]).getState(),
    scoring.getState(),
    scoredGame().getState(),
    resigned.getState(),
  ];
  // Legacy public states may omit topology or carry only a square size.
  const { width, height, topology, ...legacySquare } = new GoEngine({ size: 9 }).getState();
  states.push(legacySquare);

  for (const state of states) {
    const hydrated = goRules.hydratePublic(structuredClone(state));
    assert.ok(hydrated instanceof GoEngine);
    assert.equal(hydratedFields(hydrated), hydratedFields(legacy(structuredClone(state))));
    if (state.width !== undefined) assert.deepEqual(hydrated.getState(), state);
  }
  // The hydrated engine copies its inputs.
  const state = scoring.getState();
  const hydrated = goRules.hydratePublic(state);
  state.captures.black = 99;
  state.lastMove.row = 99;
  assert.notEqual(hydrated.captures.black, 99);
  assert.notEqual(hydrated.lastMove.row, 99);
});

test("replays dispatch on the base's game type", () => {
  const game = scoredGame();
  const replay = game.getReplayState();
  assert.deepEqual(buildReplayFrames(replay).frames.at(-1), game.getState());
  const afterThree = playMoves(new GoEngine({ width: 7, height: 5, topology: "mobius" }), [
    [1, 0], [1, 6], [2, 1],
  ]);
  assert.equal(
    JSON.stringify(buildReplayStateAtStep(replay, 3)),
    JSON.stringify(afterThree.exportState({ includeReplay: false })),
  );
  // Othello's and Gomoku's rules refuse this Go base; see their rules tests.
  assert.throws(
    () => buildReplayFrames({ ...replay, base: { ...replay.base, gameType: "othello" } }),
    RangeError,
  );
  assert.throws(
    () => buildReplayFrames({ ...replay, base: { ...replay.base, gameType: "gomoku" } }),
    /missing ruleSet/u,
  );
  assert.throws(
    () => buildReplayFrames({ ...replay, base: { ...replay.base, gameType: "chess" } }),
    /Unknown game type: chess/u,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_LIMITS, GameSettingsError } from "../src/game/gameTypes.js";
import { GoEngine } from "../src/game/goEngine.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";
import { gameTypeOf, rulesFor } from "../src/game/rules/index.js";
import { gomokuRules } from "../src/game/rules/gomoku.js";

function playAll(game, moves) {
  for (const [row, col] of moves) assert.equal(game.play(row, col).ok, true, `${row},${col}`);
  return game;
}

/** Renju R1 with Black to move: (7,7) is a double three. */
function renjuR1() {
  return playAll(gomokuRules.create({ ruleSet: "renju" }), [
    [7, 5], [0, 0], [7, 6], [0, 2], [5, 7], [0, 4], [6, 7], [0, 6],
  ]);
}

test("the registry serves the Gomoku rules", () => {
  assert.equal(rulesFor("gomoku"), gomokuRules);
  assert.equal(gomokuRules.id, "gomoku");
  assert.equal(gomokuRules.sgfCode, 4);
  assert.equal(gomokuRules.limits, BOARD_LIMITS.gomoku);
  assert.deepEqual(gomokuRules.defaults, {
    width: 15, height: 15, topology: "cylinder", ruleSet: "freestyle",
  });
  assert.ok(Object.isFrozen(gomokuRules.defaults));
  assert.equal(gameTypeOf(gomokuRules.create()), "gomoku");
  assert.equal(gameTypeOf(gomokuRules.create().getState()), "gomoku");
});

test("normalizeSettings validates sizes and rule sets with clear errors", () => {
  assert.deepEqual(gomokuRules.normalizeSettings(), {
    gameType: "gomoku", ruleSet: "freestyle", width: 15, height: 15, size: 15, topology: "cylinder",
  });
  assert.deepEqual(gomokuRules.normalizeSettings({ size: 19, ruleSet: "renju", topology: "torus" }), {
    gameType: "gomoku", ruleSet: "renju", width: 19, height: 19, size: 19, topology: "torus",
  });
  assert.deepEqual(gomokuRules.normalizeSettings({ width: 30, height: 11, gameType: "gomoku" }), {
    gameType: "gomoku", ruleSet: "freestyle", width: 30, height: 11, topology: "cylinder",
  });

  // A previous Gomoku game (engine, state or settings) supplies defaults...
  const previous = new GomokuEngine({ width: 13, height: 17, topology: "mobius", ruleSet: "renju" });
  for (const prior of [previous, previous.getState(), gomokuRules.settingsFromGame(previous)]) {
    assert.deepEqual(gomokuRules.normalizeSettings({}, prior), {
      gameType: "gomoku", ruleSet: "renju", width: 13, height: 17, topology: "mobius",
    });
  }
  assert.deepEqual(gomokuRules.normalizeSettings({ height: 13, ruleSet: "freestyle" }, previous), {
    gameType: "gomoku", ruleSet: "freestyle", width: 13, height: 13, size: 13, topology: "mobius",
  });
  // ...but a game of another type does not: a 9x9 Go board is too small.
  for (const other of [new GoEngine({ size: 9, topology: "torus" }), { size: 9 }, { gameType: "othello", width: 8 }]) {
    assert.deepEqual(gomokuRules.normalizeSettings({}, other), gomokuRules.normalizeSettings());
  }

  for (const [raw, field, message] of [
    [{ size: 10 }, "width", /Gomoku boards need at least 11 lines per side/u],
    [{ height: 9 }, "height", /Gomoku boards need at least 11 lines per side/u],
    [{ width: 31 }, "width", /Gomoku board width must be an integer from 11 to 30/u],
    [{ height: 12.5 }, "height", /must be an integer from 11 to 30/u],
    [{ width: "15" }, "width", /must be an integer/u],
    [{ topology: "sphere" }, "topology", /Unknown board topology: sphere/u],
    [{ ruleSet: "standard" }, "ruleSet", /Unknown Gomoku rule set: standard \(expected freestyle or renju\)/u],
    [{ gameType: "go" }, "gameType", /cannot describe a go game/u],
  ]) {
    assert.throws(
      () => gomokuRules.normalizeSettings(raw),
      (error) => error instanceof GameSettingsError && error instanceof RangeError &&
        error.field === field && message.test(error.message),
      JSON.stringify(raw),
    );
  }
});

test("create builds a fresh engine from settings", () => {
  const settings = gomokuRules.normalizeSettings({ width: 11, height: 14, topology: "torus", ruleSet: "renju" });
  const game = gomokuRules.create(settings);
  assert.ok(game instanceof GomokuEngine);
  assert.deepEqual(
    game.getState(),
    new GomokuEngine({ width: 11, height: 14, topology: "torus", ruleSet: "renju" }).getState(),
  );
  assert.deepEqual(gomokuRules.create().getState(), new GomokuEngine().getState());
  assert.throws(() => gomokuRules.create({ width: 9, height: 9 }), RangeError);
  assert.throws(() => gomokuRules.create({ gameType: "go" }), TypeError);
});

test("fromState validates and refuses other games' states", () => {
  const game = renjuR1();
  assert.equal(gomokuRules.fromState(game.exportState()).serialize(), game.serialize());
  assert.equal(gomokuRules.fromState(game.serialize()).serialize(), game.serialize());
  assert.throws(() => gomokuRules.fromState(new GoEngine({ size: 15 }).exportState()), TypeError);
  assert.throws(() => gomokuRules.fromState({ ...game.exportState(), board: [] }), RangeError);
});

test("hydratePublic draws a public snapshot without its history", () => {
  const game = renjuR1();
  const state = game.getState();
  const hydrated = gomokuRules.hydratePublic(state);
  assert.ok(hydrated instanceof GomokuEngine);
  assert.deepEqual(hydrated.getState(), state);
  assert.equal(hydrated.getReplayState().complete, false);
  assert.deepEqual(hydrated.checkPlay(7, 7), { ok: false, reason: "forbidden", forbidden: "double_three" });
  assert.deepEqual(gomokuRules.viewMarkers(hydrated), gomokuRules.viewMarkers(game));
  // It copies its input.
  state.board[3][3] = "black";
  assert.equal(hydrated.board[3][3], null);

  const won = playAll(gomokuRules.create(), [
    [7, 13], [0, 0], [7, 14], [0, 2], [7, 0], [0, 4], [7, 1], [0, 6], [7, 2],
  ]);
  const wonState = won.getState();
  const finished = gomokuRules.hydratePublic(wonState);
  assert.deepEqual(finished.getState(), wonState);
  wonState.result.line[0].row = 99;
  assert.equal(finished.result.line[0].row, 7);
  assert.equal(finished.play(3, 3).reason, "game_not_playing");

  const rectangular = gomokuRules.create({ width: 12, height: 20, topology: "mobius" });
  assert.deepEqual(gomokuRules.hydratePublic(rectangular.getState()).getState(), rectangular.getState());
  assert.throws(() => gomokuRules.hydratePublic({ ...state, gameType: "othello" }), TypeError);
  assert.throws(() => gomokuRules.hydratePublic({ ...state, board: [[]] }), RangeError);
});

test("settingsFromGame describes the game and its clock", () => {
  const game = gomokuRules.create({ width: 13, height: 17, topology: "torus", ruleSet: "renju" });
  assert.deepEqual(gomokuRules.settingsFromGame(game), {
    gameType: "gomoku", ruleSet: "renju", width: 13, height: 17, topology: "torus",
    mainTimeSeconds: 0, byoYomiPeriods: 0, byoYomiSeconds: 0,
  });
  assert.deepEqual(
    gomokuRules.settingsFromGame(gomokuRules.create(), {
      mainTimeSeconds: 600, byoYomiPeriods: 3, byoYomiSeconds: 30,
    }),
    {
      gameType: "gomoku", ruleSet: "freestyle", width: 15, height: 15, size: 15, topology: "cylinder",
      mainTimeSeconds: 600, byoYomiPeriods: 3, byoYomiSeconds: 30,
    },
  );
  // Settings round-trip through normalizeSettings and create.
  const { mainTimeSeconds, byoYomiPeriods, byoYomiSeconds, ...settings } =
    gomokuRules.settingsFromGame(game);
  assert.deepEqual(gomokuRules.normalizeSettings(settings), settings);
  assert.deepEqual(gomokuRules.create(settings).getState(), game.getState());
});

test("positionFingerprint is the engine part of a room position token", () => {
  const game = renjuR1();
  const fingerprint = gomokuRules.positionFingerprint(game, { positionEpoch: 3 });
  assert.deepEqual(Object.keys(fingerprint), [
    "gameType", "ruleSet", "width", "height", "topology", "currentPlayer", "phase",
    "board", "lastMove", "eventCount",
  ]);
  assert.deepEqual(fingerprint, {
    gameType: "gomoku", ruleSet: "renju", width: 15, height: 15, topology: "cylinder",
    currentPlayer: "black", phase: "play", board: game.getBoard(),
    lastMove: { type: "play", color: "white", row: 0, col: 6 }, eventCount: 8,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(fingerprint)), fingerprint);
  // A restored game fingerprints identically; any change shows.
  const restored = gomokuRules.fromState(game.serialize());
  assert.equal(
    JSON.stringify(gomokuRules.positionFingerprint(restored, {})),
    JSON.stringify(fingerprint),
  );
  restored.play(10, 10);
  assert.notDeepEqual(gomokuRules.positionFingerprint(restored, {}), fingerprint);
  restored.undo();
  assert.deepEqual(gomokuRules.positionFingerprint(restored, {}), fingerprint);
  restored.resign("black");
  assert.notDeepEqual(gomokuRules.positionFingerprint(restored, {}), fingerprint);
  // The fingerprint is a copy.
  fingerprint.board[0][0] = "black";
  assert.equal(game.board[0][0], "white");
});

test("viewMarkers show the win line and Black's forbidden points", () => {
  assert.deepEqual(gomokuRules.viewMarkers(gomokuRules.create(), { hints: true }), {
    winLine: [], forbidden: [],
  });
  const game = renjuR1();
  assert.deepEqual(gomokuRules.viewMarkers(game), {
    winLine: [], forbidden: [{ row: 7, col: 7, reason: "double_three" }],
  });
  // Only while Black is to move.
  game.play(12, 12);
  assert.deepEqual(gomokuRules.viewMarkers(game).forbidden, []);
  // Freestyle has no forbidden points.
  const freestyle = playAll(gomokuRules.create(), [
    [7, 5], [0, 0], [7, 6], [0, 2], [5, 7], [0, 4], [6, 7], [0, 6],
  ]);
  assert.deepEqual(gomokuRules.viewMarkers(freestyle).forbidden, []);
  // A five ends the game and marks its line.
  freestyle.play(7, 7);
  freestyle.play(1, 1);
  freestyle.play(7, 8);
  freestyle.play(1, 3);
  freestyle.play(7, 9);
  assert.equal(freestyle.result.reason, "five");
  const markers = gomokuRules.viewMarkers(freestyle);
  assert.deepEqual(markers, {
    winLine: [{ row: 7, col: 5 }, { row: 7, col: 6 }, { row: 7, col: 7 }, { row: 7, col: 8 }, { row: 7, col: 9 }],
    forbidden: [],
  });
  markers.winLine[0].row = 0;
  assert.equal(freestyle.result.line[0].row, 7);
  // A resignation has no line.
  const resigned = gomokuRules.create();
  resigned.resign();
  assert.deepEqual(gomokuRules.viewMarkers(resigned), { winLine: [], forbidden: [] });
});

test("replay.js rebuilds Gomoku games through the registry", () => {
  const game = renjuR1();
  game.play(7, 8);
  const { frames, steps } = buildReplayFrames(game.getReplayState());
  assert.equal(frames.length, 10);
  assert.deepEqual(frames.at(-1), game.getState());
  assert.deepEqual(steps.at(-1), { type: "play", color: "black", row: 7, col: 8 });
});

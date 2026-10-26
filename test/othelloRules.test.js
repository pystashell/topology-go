import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_LIMITS, GameSettingsError } from "../src/game/gameTypes.js";
import { BLACK, GoEngine, WHITE } from "../src/game/goEngine.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";
import { gameTypeOf, rulesFor } from "../src/game/rules/index.js";
import { othelloRules } from "../src/game/rules/othello.js";
import { NON_GO_ROOM_ACTIONS } from "../src/game/rules/shared.js";

function playAll(game, moves) {
  for (const [row, col] of moves) assert.equal(game.play(row, col).ok, true, `${row},${col}`);
  return game;
}

// Cylinder 6x6: White's 8th move leaves Black without a move.
const SKIP_GAME = [[2, 1], [1, 1], [0, 1], [2, 4], [3, 4], [0, 0], [2, 5], [0, 2]];
// Mobius 6x6: Black wipes White out in seven moves.
const WIPEOUT_GAME = [[1, 2], [1, 1], [1, 0], [1, 3], [4, 4], [4, 5], [1, 4]];

test("Othello rules describe the game", () => {
  assert.equal(rulesFor("othello"), othelloRules);
  assert.equal(othelloRules.id, "othello");
  assert.equal(othelloRules.sgfCode, 2);
  assert.equal(othelloRules.limits, BOARD_LIMITS.othello);
  assert.deepEqual(othelloRules.defaults, { width: 8, height: 8, topology: "cylinder" });
  assert.deepEqual({ ...othelloRules.capabilities }, {
    pass: false, scoring: false, undo: true, resign: true, ai: true, analysis: false, sgf: true,
  });
  assert.deepEqual([...othelloRules.roomActions], NON_GO_ROOM_ACTIONS);
  assert.deepEqual(othelloRules.matchModes, ["friend", "human-ai", "ai-ai", "local"]);
  assert.ok(Object.isFrozen(othelloRules) && Object.isFrozen(othelloRules.defaults));
  const game = othelloRules.create();
  assert.equal(gameTypeOf(game), "othello");
  assert.equal(gameTypeOf(game.getState()), "othello");
  assert.equal(rulesFor(gameTypeOf(game.getReplayState().base)), othelloRules);
});

test("normalizeSettings takes even sides from 4 to 30 and Othello's previous board", () => {
  assert.deepEqual(othelloRules.normalizeSettings(), {
    gameType: "othello", width: 8, height: 8, size: 8, topology: "cylinder",
  });
  assert.deepEqual(othelloRules.normalizeSettings(null), othelloRules.normalizeSettings({}));
  assert.deepEqual(othelloRules.normalizeSettings({ size: 10 }), {
    gameType: "othello", width: 10, height: 10, size: 10, topology: "cylinder",
  });
  assert.deepEqual(othelloRules.normalizeSettings({ width: 6, height: 30, topology: "torus" }), {
    gameType: "othello", width: 6, height: 30, topology: "torus",
  });

  const previous = new OthelloEngine({ width: 10, height: 6, topology: "mobius" });
  assert.deepEqual(othelloRules.normalizeSettings({}, previous), {
    gameType: "othello", width: 10, height: 6, topology: "mobius",
  });
  assert.deepEqual(othelloRules.normalizeSettings({ height: 10 }, previous), {
    gameType: "othello", width: 10, height: 10, size: 10, topology: "mobius",
  });
  assert.deepEqual(
    othelloRules.normalizeSettings({ topology: "torus" }, othelloRules.settingsFromGame(previous)),
    { gameType: "othello", width: 10, height: 6, topology: "torus" },
  );
  // Another game's board sides are not carried over; its topology is.
  for (const go of [
    new GoEngine({ size: 19, topology: "torus" }),
    { width: 9, height: 9, size: 9, komi: 6.5, scoringRule: "japanese", topology: "torus" },
    { gameType: "gomoku", width: 15, height: 15, topology: "torus" },
  ]) {
    assert.deepEqual(othelloRules.normalizeSettings({}, go), {
      gameType: "othello", width: 8, height: 8, size: 8, topology: "torus",
    });
  }

  for (const [raw, field] of [
    [{ width: 7 }, "width"], [{ height: 2 }, "height"], [{ size: 31 }, "width"],
    [{ size: 32 }, "width"], [{ width: 8.5 }, "width"], [{ height: "8" }, "height"],
    [{ width: 6, height: 5 }, "height"], [{ topology: "sphere" }, "topology"],
    [{ gameType: "go" }, "gameType"],
  ]) {
    assert.throws(
      () => othelloRules.normalizeSettings(raw),
      (error) => error instanceof GameSettingsError && error instanceof RangeError &&
        error.field === field,
      JSON.stringify(raw),
    );
  }
  assert.throws(
    () => othelloRules.normalizeSettings({ width: 9 }),
    { message: "Othello board width must be an even integer from 4 to 30" },
  );
});

test("create starts a canonical game from raw or normalized settings", () => {
  const settings = othelloRules.normalizeSettings({ width: 10, height: 6, topology: "mobius" });
  const created = othelloRules.create(settings);
  assert.ok(created instanceof OthelloEngine);
  assert.deepEqual(
    created.getState(),
    new OthelloEngine({ width: 10, height: 6, topology: "mobius" }).getState(),
  );
  assert.equal(othelloRules.create().serialize(), new OthelloEngine().serialize());
  assert.equal(othelloRules.create({ size: 6 }).width, 6);
  assert.equal(othelloRules.fromState(created.serialize()).serialize(), created.serialize());
  assert.throws(() => othelloRules.create({ size: 7 }), GameSettingsError);
});

test("fromState restores validated games and refuses other games' states", () => {
  const game = playAll(othelloRules.create({ width: 6, height: 6 }), SKIP_GAME);
  assert.equal(othelloRules.fromState(game.exportState()).serialize(), game.serialize());
  assert.equal(othelloRules.fromState(game.serialize()).serialize(), game.serialize());
  assert.throws(() => othelloRules.fromState(new GoEngine({ size: 8 }).exportState()), TypeError);
  assert.throws(
    () => othelloRules.fromState({ ...game.exportState(), gameType: "gomoku" }),
    TypeError,
  );
  // A Go replay relabelled as Othello is refused, whatever its board.
  const go = new GoEngine({ size: 8 });
  go.play(0, 0);
  const replay = go.getReplayState();
  assert.throws(() => buildReplayFrames({ ...replay, base: { ...replay.base, gameType: "othello" } }));
});

test("hydratePublic rebuilds public snapshots for rendering", () => {
  const resigned = othelloRules.create({ width: 8, height: 6, topology: "torus" });
  resigned.play(...Object.values(resigned.legalMoves()[0]));
  resigned.resign(WHITE);
  const states = [
    othelloRules.create().getState(),
    playAll(othelloRules.create({ width: 6, height: 6 }), SKIP_GAME).getState(),
    playAll(othelloRules.create({ width: 6, height: 6, topology: "mobius" }), WIPEOUT_GAME).getState(),
    resigned.getState(),
  ];
  for (const state of states) {
    const input = structuredClone(state);
    const hydrated = othelloRules.hydratePublic(input);
    assert.ok(hydrated instanceof OthelloEngine);
    assert.deepEqual(hydrated.getState(), state);
    // The hydrated engine owns copies of its input.
    input.board[0][0] = "black";
    if (input.lastMove) input.lastMove.flipped.length = 0;
    if (input.result) input.result.winner = "nobody";
    assert.deepEqual(hydrated.getState(), state);
  }
  const skipped = othelloRules.hydratePublic(states[1]);
  assert.equal(skipped.currentPlayer, WHITE);
  assert.equal(skipped.lastMove.skipped, BLACK);
  assert.ok(skipped.legalMoves().length > 0);
  assert.throws(() => othelloRules.hydratePublic({ ...states[0], width: 7 }), RangeError);
});

test("settingsFromGame describes the board and clock", () => {
  assert.deepEqual(othelloRules.settingsFromGame(othelloRules.create()), {
    gameType: "othello", width: 8, height: 8, size: 8, topology: "cylinder",
    mainTimeSeconds: 0, byoYomiPeriods: 0, byoYomiSeconds: 0,
  });
  const game = othelloRules.create({ width: 12, height: 6, topology: "torus" });
  const clock = { mainTimeSeconds: 300, byoYomiPeriods: 3, byoYomiSeconds: 20 };
  assert.deepEqual(othelloRules.settingsFromGame(game, clock), {
    gameType: "othello", width: 12, height: 6, topology: "torus", ...clock,
  });
  // Settings round-trip through normalizeSettings and create.
  const { mainTimeSeconds, byoYomiPeriods, byoYomiSeconds, ...settings } =
    othelloRules.settingsFromGame(game, clock);
  assert.deepEqual(othelloRules.normalizeSettings(settings), settings);
  assert.equal(othelloRules.create(settings).serialize(), game.serialize());
});

test("positionFingerprint covers the position and every recorded action", () => {
  const game = othelloRules.create({ width: 6, height: 6 });
  const start = othelloRules.positionFingerprint(game, {});
  assert.deepEqual(Object.keys(start), [
    "gameType", "width", "height", "topology", "currentPlayer", "phase", "board",
    "lastMove", "eventCount",
  ]);
  assert.deepEqual(start, {
    gameType: "othello",
    width: 6,
    height: 6,
    topology: "cylinder",
    currentPlayer: BLACK,
    phase: "play",
    board: game.getBoard(),
    lastMove: null,
    eventCount: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(start)), start);

  playAll(game, SKIP_GAME);
  const skipped = othelloRules.positionFingerprint(game, {});
  assert.equal(skipped.eventCount, SKIP_GAME.length);
  assert.equal(skipped.currentPlayer, WHITE);
  assert.equal(skipped.lastMove.skipped, BLACK);
  // Restoring or undoing and replaying reproduces the same input.
  assert.deepEqual(othelloRules.positionFingerprint(othelloRules.fromState(game.serialize()), {}), skipped);
  game.undo();
  game.play(...SKIP_GAME.at(-1));
  assert.deepEqual(othelloRules.positionFingerprint(game, {}), skipped);
  // A resignation leaves the board but not the fingerprint unchanged.
  game.resign(BLACK);
  const resigned = othelloRules.positionFingerprint(game, {});
  assert.deepEqual(resigned.board, skipped.board);
  assert.notDeepEqual(resigned, skipped);
  assert.equal(resigned.eventCount, SKIP_GAME.length + 1);
  // The fingerprint is a copy.
  resigned.board[0][0] = "changed";
  assert.notEqual(game.board[0][0], "changed");
});

test("viewMarkers shows legal hints for the side to move and the last flips", () => {
  const game = othelloRules.create();
  assert.deepEqual(othelloRules.viewMarkers(game, { hints: true }), {
    legal: game.legalMoves(),
    flipped: [],
    flipOrigin: null,
  });
  assert.equal(othelloRules.viewMarkers(game).legal.length, 4);
  game.play(2, 3);
  assert.deepEqual(othelloRules.viewMarkers(game, { hints: false }), {
    legal: [],
    flipped: [{ row: 3, col: 3, distance: 1 }],
    flipOrigin: { row: 2, col: 3 },
  });
  assert.deepEqual(othelloRules.viewMarkers(game).legal, game.legalMoves());
  const markers = othelloRules.viewMarkers(game);
  markers.flipped[0].row = 9;
  assert.equal(game.lastMove.flipped[0].row, 3);

  const finished = playAll(othelloRules.create({ width: 6, height: 6, topology: "mobius" }), WIPEOUT_GAME);
  const final = othelloRules.viewMarkers(finished);
  assert.deepEqual(final.legal, []);
  assert.deepEqual(final.flipped.map(({ row, col }) => ({ row, col })), finished.lastMove.flipped);
  assert.ok(final.flipped.every(({ distance }) => Number.isInteger(distance) && distance >= 1));
  assert.deepEqual(final.flipOrigin, { row: finished.lastMove.row, col: finished.lastMove.col });
});

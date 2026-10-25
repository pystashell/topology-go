import assert from "node:assert/strict";
import test from "node:test";

import { GoEngine, UNDO_HISTORY_LIMIT } from "../src/game/goEngine.js";

/*
 * Persisted Go states are untrusted input (a Durable Object value, an
 * imported file): GoEngine.fromState must refuse every corrupted field with
 * a TypeError or RangeError naming the problem, never crash and never accept
 * a position its own record cannot reproduce. Each case below corrupts one
 * thing in a real game's exported state.
 */

/** A real 5x5 game: captures, then two passes, a dead group and a finish. */
function scoredGame() {
  const game = new GoEngine({ width: 5, height: 5, topology: "cylinder", komi: 0.5 });
  // Black captures the white stone at (0,0); its third neighbour is (0,4)
  // across the seam.
  for (const [row, col] of [[0, 1], [0, 0], [1, 0], [2, 2], [0, 4]]) assert.equal(game.play(row, col).ok, true);
  assert.equal(game.captures.black, 1);
  return game;
}

function playingState() {
  return scoredGame().exportState();
}

function scoringState() {
  const game = scoredGame();
  game.pass();
  game.pass();
  game.toggleDead(2, 2);
  return game.exportState();
}

function finishedState() {
  const game = scoredGame();
  game.pass();
  game.pass();
  game.toggleDead(2, 2);
  game.finishScoring("chinese");
  return game.exportState();
}

function resignedState() {
  const game = scoredGame();
  game.resign("white");
  return game.exportState();
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function refuses(state, label) {
  let error;
  try {
    GoEngine.fromState(state);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${label}: accepted`);
  assert.ok(error instanceof TypeError || error instanceof RangeError, `${label}: ${error?.name}: ${error?.message}`);
  assert.doesNotMatch(error.message, /Cannot read|undefined is not|is not a function/u, `${label}: crashed: ${error.message}`);
}

const PLAYING_CASES = {
  "not JSON": () => "{not json",
  "an array": () => [],
  "null": () => null,
  "a class instance": () => new (class State {})(),
  "width without height": (s) => { delete s.height; delete s.size; },
  "no size at all": (s) => { delete s.width; delete s.height; delete s.size; },
  "size not matching": (s) => { s.size = 7; },
  "a rectangle with a size": (s) => { s.width = 6; },
  "a board too large": (s) => { s.width = 31; s.height = 31; delete s.size; },
  "undo history not an array": (s) => { s.undoHistory = {}; },
  "undo history too long": (s) => { s.undoHistory = Array(UNDO_HISTORY_LIMIT + 1).fill(s.undoHistory[0]); },
  "komi not finite": (s) => { s.komi = "6.5"; },
  "unknown scoring rule": (s) => { s.scoringRule = "korean"; },
  "unknown topology": (s) => { s.topology = "sphere"; },
  "a missing board row": (s) => { s.board.pop(); },
  "a short board row": (s) => { s.board[0].pop(); },
  "a board that is not rows": (s) => { s.board = "....."; },
  "an unknown stone": (s) => { s.board[4][4] = "red"; },
  "unknown player to move": (s) => { s.currentPlayer = "red"; },
  "unknown phase": (s) => { s.phase = "paused"; },
  "negative passes": (s) => { s.consecutivePasses = -1; },
  "fractional passes": (s) => { s.consecutivePasses = 1.5; },
  "two passes while playing": (s) => { s.consecutivePasses = 2; },
  "captures not an object": (s) => { s.captures = [1, 0]; },
  "captures missing a colour": (s) => { delete s.captures.white; },
  "negative captures": (s) => { s.captures.black = -1; },
  "dead stones not a list": (s) => { s.deadStones = {}; },
  "dead stones while playing": (s) => { s.deadStones = [{ row: 2, col: 2 }]; },
  "a dead stone off the board": (s) => { s.deadStones = [{ row: 9, col: 9 }]; },
  "a dead stone that is not a point": (s) => { s.deadStones = ["2,2"]; },
  "last move colour": (s) => { s.lastMove.color = "red"; },
  "last move type": (s) => { s.lastMove.type = "jump"; },
  "last move off the board": (s) => { s.lastMove.row = 5; },
  "captured not a list": (s) => { s.lastMove.captured = null; },
  "a captured point twice": (s) => { s.lastMove.captured = [{ row: 0, col: 0 }, { row: 0, col: 0 }]; },
  "a captured point off the board": (s) => { s.lastMove.captured = [{ row: -1, col: 0 }]; },
  "no position history": (s) => { s.positionHistory = []; },
  "position history not a list": (s) => { s.positionHistory = "...."; },
  "a malformed position hash": (s) => { s.positionHistory.push("xyz"); },
  "a duplicate position hash": (s) => { s.positionHistory.push(s.positionHistory[0]); },
  "history without the current board": (s) => { s.positionHistory = [s.positionHistory[0]]; },
  "a result before the end": (s) => { s.result = { winner: "black" }; },
  "an undo entry that is not an object": (s) => { s.undoHistory[0] = 7; },
  "an undo entry with a bad move": (s) => { s.undoHistory[0].move.color = "red"; },
  "an undo entry with a bad board": (s) => { s.undoHistory[0].before.board = []; },
  "undo history that does not chain": (s) => { s.undoHistory.reverse(); },
  "a replay that is not an object": (s) => { s.replay = []; },
  "an unknown replay version": (s) => { s.replay.version = 99; },
  "replay events not a list": (s) => { s.replay.events = {}; },
  "an unknown replay event": (s) => { s.replay.events.push({ type: "teleport" }); },
  "a replay move of an unknown colour": (s) => { s.replay.events[0].color = "red"; },
  "a replay pass of an unknown colour": (s) => { s.replay.events.push({ type: "pass", color: "red" }); },
  "a replay resignation of an unknown colour": (s) => { s.replay.events.push({ type: "resign", color: "red" }); },
  "a replay resume with an unknown player": (s) => { s.replay.events.push({ type: "resume_play", nextPlayer: "red" }); },
  "a replay finish with an unknown rule": (s) => { s.replay.events.push({ type: "finish_scoring", rule: "korean" }); },
  "a replay dead-stone toggle off the board": (s) => { s.replay.events.push({ type: "toggle_dead", row: 9, col: 0 }); },
  "a replay that is not the game": (s) => { s.replay.events[0].col = 4; },
  "a replay with a different base": (s) => { s.replay.base.komi = 99; },
  "a replay base with a bad board": (s) => { s.replay.base.board = [[]]; },
  "a replay that stops early": (s) => { s.replay.events.pop(); },
  "complete flag not a boolean": (s) => { s.replay.complete = "yes"; },
};

const SCORING_CASES = {
  "fewer than two passes while scoring": (s) => { s.consecutivePasses = 1; },
  "a dead stone on an empty point": (s) => { s.deadStones.push({ row: 4, col: 4 }); },
  "the same dead stone twice": (s) => { s.deadStones.push(s.deadStones[0]); },
};

const FINISHED_CASES = {
  "a finished game without a result": (s) => { s.result = null; },
  "a result that does not match the board": (s) => { s.result.black += 1; },
  "a result with a function": (s) => { s.result.extra = () => 1; },
  "a result with a non-finite number": (s) => { s.result.margin = Number.POSITIVE_INFINITY; },
  "a result with a circular reference": (s) => { s.result.self = s.result; },
  "a result that is a list": (s) => { s.result = []; },
};

const RESIGNED_CASES = {
  "a resignation without a loser": (s) => { delete s.result.loser; },
  "a resignation won by both": (s) => { s.result.loser = s.result.winner; },
  "a resignation with a margin": (s) => { s.result.margin = 3; },
  "a resignation flag that is not true": (s) => { s.result.resignation = "yes"; },
  "a resignation with two passes": (s) => { s.consecutivePasses = 2; },
};

for (const [cases, make, phase] of [
  [PLAYING_CASES, playingState, "play"],
  [SCORING_CASES, scoringState, "scoring"],
  [FINISHED_CASES, finishedState, "finished"],
  [RESIGNED_CASES, resignedState, "resigned"],
]) {
  test(`fromState refuses corrupted ${phase} states (${Object.keys(cases).length} cases)`, () => {
    const valid = make();
    // The untouched state restores exactly.
    assert.deepEqual(GoEngine.fromState(clone(valid)).exportState(), valid);
    assert.deepEqual(GoEngine.fromState(JSON.stringify(valid)).exportState(), valid);
    for (const [label, corrupt] of Object.entries(cases)) {
      const state = phase === "finished" && /function|circular|non-finite/u.test(label) ? make() : clone(valid);
      const replaced = corrupt(state);
      refuses(replaced === undefined ? state : replaced, label);
    }
  });
}

test("a state without replay or undo history restores as a partial record", () => {
  const state = playingState();
  delete state.replay;
  delete state.undoHistory;
  const game = GoEngine.fromState(state);
  assert.equal(game.getReplayState().complete, false);
  assert.equal(game.canUndo(), false);
  assert.deepEqual(game.board, state.board);
  // Legacy square states with only a size still load.
  const legacy = { ...playingState() };
  delete legacy.width;
  delete legacy.height;
  delete legacy.replay;
  delete legacy.topology;
  assert.equal(GoEngine.fromState(legacy).topology, "cylinder");
});

test("the constructor refuses bad settings", () => {
  for (const [label, options] of [
    ["width too small", { width: 2, height: 5 }],
    ["height too large", { width: 5, height: 31 }],
    ["fractional size", { size: 9.5 }],
    ["size and width disagree", { size: 9, width: 7 }],
    ["komi not finite", { size: 9, komi: Number.NaN }],
    ["unknown player", { size: 9, currentPlayer: "red" }],
    ["unknown rule", { size: 9, scoringRule: "korean" }],
    ["unknown topology", { size: 9, topology: "klein" }],
    ["initial board of the wrong size", { size: 5, initialBoard: [[null]] }],
  ]) {
    assert.throws(() => new GoEngine(options), (error) => error instanceof TypeError || error instanceof RangeError, label);
  }
  // Rule aliases are accepted.
  assert.equal(new GoEngine({ size: 9, scoringRule: "area" }).scoringRule, "chinese");
  assert.equal(new GoEngine({ size: 9, scoringRule: "territory" }).scoringRule, "japanese");
});

test("moves outside the game's phase or the board are refused without changes", () => {
  const game = scoredGame();
  assert.deepEqual(game.play(-1, 0), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.play(0, 5), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.checkPlay(5, 0), { ok: false, reason: "out_of_bounds" });
  assert.deepEqual(game.play(0, 1), { ok: false, reason: "occupied" });
  assert.equal(game.toggleDead(0, 1).ok, false, "not scoring yet");
  assert.equal(game.finishScoring().ok, false);
  assert.equal(game.resumePlay().ok, false);
  game.pass();
  game.pass();
  assert.deepEqual(game.play(4, 4), { ok: false, reason: "game_not_playing" });
  assert.deepEqual(game.checkPlay(4, 4), { ok: false, reason: "game_not_playing" });
  assert.deepEqual(game.pass(), { ok: false, reason: "game_not_playing" });
  assert.equal(game.toggleDead(4, 4).ok, false, "an empty point");
  assert.equal(game.toggleDead(9, 9).ok, false, "off the board");
  assert.throws(() => game.resumePlay("red"), TypeError);
  assert.equal(game.finishScoring().ok, true);
  assert.equal(game.resign().ok, false);
  assert.throws(() => new GoEngine({ size: 5 }).resign("red"), TypeError);
});

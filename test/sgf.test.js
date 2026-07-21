import test from "node:test";
import assert from "node:assert/strict";

import { GoEngine, PHASE_FINISHED, WHITE } from "../src/game/goEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";
import {
  SgfError,
  escapeSgfValue,
  exportSgf,
  importSgf,
} from "../src/game/sgf.js";

function emptyBoard(width, height = width) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function replayBase({ width, height = width, topology = "cylinder", komi = 7.5 }) {
  const board = emptyBoard(width, height);
  return {
    size: width,
    width,
    height,
    topology,
    komi,
    scoringRule: "chinese",
    board,
    currentPlayer: "black",
    phase: "play",
    consecutivePasses: 0,
    captures: { black: 0, white: 0 },
    deadStones: [],
    lastMove: null,
    result: null,
    positionHistory: [board.map((row) => row.map(() => ".").join("")).join("/")],
    undoHistory: [],
  };
}

test("standard FF4 metadata and square replay round-trip into GoEngine frames", () => {
  const game = new GoEngine({ size: 9, komi: 6.5, scoringRule: "japanese" });
  assert.equal(game.play(2, 3).ok, true);
  assert.equal(game.play(6, 5).ok, true);
  assert.equal(game.pass().ok, true);

  const exported = exportSgf(
    { replay: game.getReplayState(), metadata: { blackPlayer: "Alice", whitePlayer: "Bob" } },
    { result: "W+R" },
  );
  assert.match(exported.sgf, /^\(;FF\[4\]GM\[1\]CA\[UTF-8\]/u);
  assert.match(exported.sgf, /SZ\[9\]/u);
  assert.match(exported.sgf, /PB\[Alice\]PW\[Bob\]RE\[W\+R\]/u);

  const imported = importSgf(exported.sgf);
  assert.equal(imported.width, 9);
  assert.equal(imported.height, 9);
  assert.equal(imported.metadata.blackPlayer, "Alice");
  assert.equal(imported.metadata.whitePlayer, "Bob");
  assert.equal(imported.metadata.result, "W+R");
  assert.deepEqual(imported.replay.events, game.getReplayState().events);
  assert.deepEqual(
    buildReplayFrames(imported.replay).frames.at(-1),
    game.getState(),
  );
});

test("timeout outcomes use the standard SGF time-forfeit result", () => {
  const replay = {
    version: 1,
    complete: true,
    base: replayBase({ width: 9 }),
    events: [{ type: "play", color: "black", row: 2, col: 2 }],
  };
  const { sgf } = exportSgf({
    replay,
    metadata: {
      result: { reason: "timeout", winner: "white", loser: "black" },
    },
  });
  assert.match(sgf, /RE\[W\+T\]/u);
  assert.equal(importSgf(sgf).metadata.result, "W+T");
});

test("resignation exports as the standard SGF result without a private move", () => {
  const game = new GoEngine({ size: 9 });
  assert.equal(game.play(2, 2).ok, true);
  assert.equal(game.resign(WHITE).ok, true);

  const exported = exportSgf({
    replay: game.getReplayState(),
    metadata: { result: game.result },
  });
  assert.match(exported.sgf, /RE\[B\+R\]/u);
  assert.doesNotMatch(exported.sgf, /X[A-Z]+\[resign\]/u);
  assert.equal(
    exported.warnings.some((warning) => warning.code === "SKIPPED_EVENT"),
    false,
  );
  assert.equal(importSgf(exported.sgf).metadata.result, "B+R");
});

test("rectangular SZ uses width:height and preserves authoritative dimensions", () => {
  const replay = {
    version: 1,
    complete: true,
    base: replayBase({ width: 7, height: 5 }),
    events: [
      { type: "play", color: "black", row: 4, col: 6 },
      { type: "play", color: "white", row: 0, col: 0 },
    ],
  };

  const { sgf } = exportSgf(replay);
  assert.match(sgf, /SZ\[7:5\]/u);
  assert.match(sgf, /B\[ge\]/u);

  const imported = importSgf(sgf);
  assert.equal(imported.width, 7);
  assert.equal(imported.height, 5);
  assert.equal(imported.replay.base.width, 7);
  assert.equal(imported.replay.base.height, 5);
  assert.equal(Object.hasOwn(imported.replay.base, "size"), false);
  assert.deepEqual(imported.replay.events, replay.events);
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).board[4][6], "black");
});

test("all connected topologies use ignorable XTOP while retaining standard moves", () => {
  for (const topology of ["cylinder", "torus", "mobius"]) {
    const replay = {
      version: 1,
      complete: true,
      base: replayBase({ width: 5, topology }),
      events: [
        { type: "play", color: "black", row: 0, col: 4 },
        { type: "play", color: "white", row: 4, col: 0 },
      ],
    };
    const exported = exportSgf(replay);
    assert.match(exported.sgf, new RegExp(`XTOP\\[${topology}\\]`, "u"));
    assert.match(exported.sgf, /;B\[ea\]\s*;W\[ae\]/u);
    const imported = importSgf(exported.sgf);
    assert.equal(imported.replay.base.topology, topology);
    assert.deepEqual(imported.replay.events, replay.events);
  }
});

test("empty B/W values are passes and legacy tt is accepted with a warning", () => {
  const imported = importSgf("(;FF[4]GM[1]CA[UTF-8]SZ[9]XTOP[cylinder];B[];W[tt])");
  assert.deepEqual(imported.replay.events, [
    { type: "pass", color: "black" },
    { type: "pass", color: "white" },
  ]);
  assert.equal(imported.warnings.some(({ code }) => code === "LEGACY_TT_PASS"), true);

  const exported = exportSgf(imported.replay);
  assert.match(exported.sgf, /;B\[\]\s*;W\[\]/u);
});

test("resume, dead marking, scoring and confirmations survive private extensions", () => {
  const game = new GoEngine({ size: 5, komi: 0, scoringRule: "chinese" });
  assert.equal(game.play(0, 0).ok, true);
  assert.equal(game.pass().ok, true);
  assert.equal(game.pass().ok, true);
  assert.equal(game.toggleDead(0, 0).ok, true);
  assert.equal(game.resumePlay(WHITE).ok, true);
  assert.equal(game.pass().ok, true);
  assert.equal(game.pass().ok, true);
  assert.equal(game.toggleDead(0, 0).ok, true);
  assert.equal(game.finishScoring("chinese").ok, true);
  assert.equal(game.phase, PHASE_FINISHED);

  const exported = exportSgf(
    { replay: game.getReplayState(), extensionEvents: [{ type: "confirm_score", color: "black" }] },
  );
  assert.match(exported.sgf, /XDEAD\[aa\]/u);
  assert.match(exported.sgf, /XRESUME\[W\]/u);
  assert.match(exported.sgf, /XFINISH\[chinese\]/u);
  assert.match(exported.sgf, /XCONFIRM\[B\]/u);
  assert.match(exported.sgf, /;B\[aa\]/u);

  const imported = importSgf(exported.sgf);
  assert.deepEqual(imported.replay.events, game.getReplayState().events);
  assert.deepEqual(imported.extensionEvents, [
    { type: "confirm_score", color: "black", nodeIndex: 10 },
  ]);
  assert.deepEqual(buildReplayFrames(imported.replay).frames.at(-1), game.getState());
});

test("SGF escaping and line continuations are decoded without an HTML/code path", () => {
  const blackPlayer = "A]lice\\棋手\n第二行";
  const whitePlayer = "Bob\\]";
  assert.equal(escapeSgfValue("x]y\\z"), "x\\]y\\\\z");
  const replay = {
    version: 1,
    complete: true,
    base: replayBase({ width: 5 }),
    events: [{ type: "pass", color: "black" }],
  };
  const { sgf } = exportSgf({ replay, metadata: { blackPlayer, whitePlayer } });
  const imported = importSgf(sgf);
  assert.equal(imported.metadata.blackPlayer, blackPlayer);
  assert.equal(imported.metadata.whitePlayer, whitePlayer);

  const continued = importSgf("(;FF[4]GM[1]SZ[5]PB[first\\\nsecond];B[])");
  assert.equal(continued.metadata.blackPlayer, "firstsecond");
});

test("only the first game's main branch is imported and warnings are structured", () => {
  const sgf = "(;FF[4]GM[1]SZ[5];B[aa](;W[bb])(;W[cc]))(;FF[4]GM[1]SZ[9];B[dd])";
  const imported = importSgf(sgf, { defaultTopology: "mobius" });
  assert.deepEqual(imported.replay.events, [
    { type: "play", color: "black", row: 0, col: 0 },
    { type: "play", color: "white", row: 1, col: 1 },
  ]);
  assert.equal(imported.replay.base.topology, "mobius");
  assert.deepEqual(
    imported.warnings.map(({ code }) => code),
    ["IGNORED_GAMES", "IGNORED_VARIATIONS", "TOPOLOGY_ASSUMED"],
  );
});

test("setup stones and PL become a replay-compatible base position", () => {
  const imported = importSgf(
    "(;FF[4]GM[1]SZ[5]KM[0]RU[Chinese]XTOP[torus]AB[aa][bb:cc]AW[ee]PL[W];W[dd])",
  );
  assert.equal(imported.replay.base.board[0][0], "black");
  assert.equal(imported.replay.base.board[1][1], "black");
  assert.equal(imported.replay.base.board[2][2], "black");
  assert.equal(imported.replay.base.board[4][4], "white");
  assert.equal(imported.replay.base.currentPlayer, "white");
  assert.equal(imported.replay.base.scoringRule, "chinese");
  assert.deepEqual(imported.replay.events, [
    { type: "play", color: "white", row: 3, col: 3 },
  ]);
});

test("malformed, oversized, too-deep and out-of-board SGF is rejected", () => {
  assert.throws(() => importSgf("not sgf"), SgfError);
  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[9])"), { code: "UNSUPPORTED_GAME" });
  assert.throws(() => importSgf("(;FF[4]GM[1]SZ[5];B[zz])"), {
    code: "POINT_OUT_OF_BOUNDS",
  });
  assert.throws(() => importSgf("(;FF[4]GM[1]SZ[0])"), {
    code: "INVALID_BOARD_SIZE",
  });
  assert.throws(
    () => importSgf("(;FF[4]GM[1]SZ[5]C[0123456789])", { limits: { maxBytes: 10 } }),
    { code: "SGF_TOO_LARGE" },
  );
  const nested = `${"(;C[x]".repeat(6)}${")".repeat(6)}`;
  assert.throws(() => importSgf(nested, { limits: { maxTreeDepth: 5 } }), {
    code: "SGF_TOO_DEEP",
  });
  assert.throws(() => importSgf("(;FF[4]GM[1]SZ[5]PB[unterminated)"), SgfError);
});

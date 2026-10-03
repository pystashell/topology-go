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
  assert.match(exported.sgf, /RU\[Simplified territory scoring \(seki eyes counted\)\]/u);
  assert.equal(exported.warnings.some(({ code }) => code === "SIMPLIFIED_TERRITORY_SCORING"), true);
  assert.match(exported.sgf, /PB\[Alice\]PW\[Bob\]RE\[W\+R\]/u);

  const imported = importSgf(exported.sgf);
  assert.equal(imported.width, 9);
  assert.equal(imported.height, 9);
  assert.equal(imported.metadata.blackPlayer, "Alice");
  assert.equal(imported.metadata.whitePlayer, "Bob");
  assert.equal(imported.metadata.result, "W+R");
  assert.deepEqual(imported.replay.events, game.getReplayState().events);
  assert.equal(imported.replay.base.scoringRule, "japanese");
  assert.equal(imported.warnings.some(({ code }) => code === "UNKNOWN_RULE"), false);
  assert.deepEqual(
    buildReplayFrames(imported.replay).frames.at(-1),
    game.getState(),
  );
});

test("game-info on a non-root move node supplies the replay's rules and metadata", () => {
  const sgf = "(;FF[4]GM[1]CA[UTF-8]SZ[5]XTOP[cylinder];B[aa]KM[7.5]RU[Chinese]PB[Alice]PW[Bob]RE[W+R])";
  const imported = importSgf(sgf);
  assert.equal(imported.replay.base.komi, 7.5);
  assert.equal(imported.replay.base.scoringRule, "chinese");
  assert.equal(imported.metadata.blackPlayer, "Alice");
  assert.equal(imported.metadata.whitePlayer, "Bob");
  assert.equal(imported.metadata.result, "W+R");
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).board[0][0], "black");
  const exported = exportSgf(imported);
  assert.match(exported.sgf, /KM\[7\.5\]RU\[Chinese\]/u);
  assert.match(exported.sgf, /PB\[Alice\]PW\[Bob\]RE\[W\+R\]/u);

  assert.throws(() => importSgf(
    "(;FF[4]GM[1]SZ[5]KM[7.5];B[aa]RE[W+R])",
  ), { code: "INVALID_GAME_INFO" });
  assert.throws(() => importSgf(sgf.replace("KM[7.5]", "KM[7.5][100]")), {
    code: "INVALID_GAME_INFO",
  });
});

test("partial SGF binds its baseline to non-root game-info without ambiguous rules", () => {
  const game = new GoEngine({ size: 5, komi: 6.5, scoringRule: "japanese" });
  const legacy = game.exportState();
  delete legacy.replay;
  const sgf = exportSgf(GoEngine.fromState(legacy).getReplayState()).sgf;
  const komi = /KM\[[^\]]*\]/u.exec(sgf)?.[0];
  const rules = /RU\[[^\]]*\]/u.exec(sgf)?.[0];
  assert.ok(komi && rules);
  const moved = `${sgf.replace(komi, "").replace(rules, "").replace(/\)$/u, "")};${komi}${rules})`;
  assert.equal(importSgf(moved).replay.base.komi, 6.5);
  assert.throws(() => importSgf(moved.replace(komi, `${komi}[100]`)), {
    code: "INVALID_PARTIAL_BASE",
  });
  assert.throws(() => importSgf(moved.replace(rules, `${rules}${rules}`)), {
    code: "INVALID_PARTIAL_BASE",
  });
  assert.throws(() => importSgf(moved.replace(komi, "KM[7.5]")), {
    code: "INVALID_PARTIAL_BASE",
  });
});

test("partial SGF preserves captures and superko history from a legacy saved game", () => {
  const game = new GoEngine({ size: 5, komi: 0, scoringRule: "japanese" });
  for (const [row, col] of [
    [0, 0], [1, 1], [1, 0], [4, 4], [0, 1],
    [4, 3], [2, 1], [3, 4], [1, 2],
  ]) {
    assert.equal(game.play(row, col).ok, true);
  }
  const legacy = game.exportState();
  delete legacy.replay;
  const partial = GoEngine.fromState(legacy).getReplayState();
  assert.equal(partial.complete, false);
  assert.equal(partial.base.captures.black, 1);
  const { sgf } = exportSgf(partial);
  assert.match(sgf, /XBADUKBASE\[1\]/u);
  const imported = importSgf(sgf);
  assert.deepEqual(imported.replay.base.captures, partial.base.captures);
  assert.deepEqual(imported.replay.base.positionHistory, partial.base.positionHistory);
  assert.deepEqual(
    GoEngine.fromState(imported.replay.base).score("japanese"),
    GoEngine.fromState(partial.base).score("japanese"),
  );
  assert.deepEqual(buildReplayFrames(imported.replay).frames.at(-1).captures,
    game.getState().captures);
});

test("partial SGF retains a scoring baseline needed by later scoring events", () => {
  const game = new GoEngine({ size: 5, komi: 0, scoringRule: "japanese" });
  assert.equal(game.pass().ok, true);
  assert.equal(game.pass().ok, true);
  const legacy = game.exportState();
  delete legacy.replay;
  const partialGame = GoEngine.fromState(legacy);
  assert.equal(partialGame.finishScoring().ok, true);
  const { sgf } = exportSgf(partialGame.getReplayState());
  const imported = importSgf(sgf);
  assert.equal(imported.replay.base.phase, "scoring");
  assert.equal(imported.replay.base.consecutivePasses, 2);
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).phase, PHASE_FINISHED);
});

test("partial SGF records its original player to move before later resume events", () => {
  const game = new GoEngine({ size: 5 });
  assert.equal(game.pass().ok, true);
  assert.equal(game.pass().ok, true);
  const legacy = game.exportState();
  delete legacy.replay;
  const partialGame = GoEngine.fromState(legacy);
  const originalPlayer = partialGame.getReplayState().base.currentPlayer;
  assert.equal(originalPlayer, "black");
  assert.equal(partialGame.resumePlay("white").ok, true);
  assert.equal(partialGame.play(0, 0).ok, true);
  const { sgf } = exportSgf(partialGame.getReplayState());
  assert.match(sgf, /PL\[B\]/u);
  const imported = importSgf(sgf);
  assert.equal(imported.replay.base.currentPlayer, originalPlayer);
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).board[0][0], "white");
});

test("legacy partial SGF warns about missing baseline and rejects scoring-only events", () => {
  const imported = importSgf("(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0]AB[aa];W[bb])");
  assert.equal(imported.warnings.some(({ code }) => code === "PARTIAL_BASE_MISSING"), true);
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).board[1][1], "white");
  assert.throws(() => importSgf(
    "(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0];XFINISH[japanese])",
  ), { code: "PARTIAL_BASE_REQUIRED" });
  const legalLegacy = importSgf(
    "(;FF[4]GM[1]SZ[5]RU[Chinese]XTOP[cylinder]XCOMPLETE[0];B[];W[];XRESUME[B];B[aa])",
  );
  assert.equal(legalLegacy.warnings.some(({ code }) => code === "PARTIAL_BASE_MISSING"), true);
  assert.equal(buildReplayFrames(legalLegacy.replay).frames.at(-1).board[0][0], "black");
});

test("partial baseline extensions reject malformed or conflicting state", () => {
  for (const sgf of [
    "(;FF[4]GM[1]SZ[5]XTOP[cylinder]XBADUKBASE[1][{}])",
    "(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0]XBADUKBASE[2][{}])",
    "(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0]XBADUKBASE[1][not-json])",
    "(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0]XBADUKBASE[1][{}]XBADUKBASE[1][{}])",
    `(;FF[4]GM[1]SZ[5]XTOP[cylinder]XCOMPLETE[0]XBADUKBASE[1][${JSON.stringify({
      "captures,consecutivePasses,deadStones,lastMove,phase,positionHistory,result,undoHistory": "ignored",
    })}])`,
    "(;FF[4]GM[1]SZ[5]RU[Chinese]XTOP[cylinder]XCOMPLETE[0];XBADUKBASE[1][{}];B[aa])",
  ]) {
    assert.throws(() => importSgf(sgf), { code: "INVALID_PARTIAL_BASE" });
  }
  const game = new GoEngine({ size: 5 });
  const legacy = game.exportState();
  delete legacy.replay;
  const partial = GoEngine.fromState(legacy).getReplayState();
  assert.throws(() => exportSgf(partial, { topology: "torus" }), {
    code: "INVALID_PARTIAL_BASE",
  });
  const { sgf } = exportSgf(partial, { limits: { maxValueLength: 64 } });
  assert.match(sgf, /XBADUKBASE\[1\]\[[^\]]{1,64}\]\[/u);
  assert.deepEqual(importSgf(sgf, { limits: { maxValueLength: 64 } }).replay.base.positionHistory,
    partial.base.positionHistory);
  assert.throws(() => importSgf(sgf.replace(/XCOMPLETE\[0\]/u, "XCOMPLETE[0][1]")), {
    code: "INVALID_PARTIAL_BASE",
  });
  assert.throws(() => importSgf(sgf.replace(/XTOP\[cylinder\]/u, "XTOP[torus]")), {
    code: "INVALID_PARTIAL_BASE",
  });
  assert.throws(() => importSgf(sgf.replace(/XTOP\[cylinder\]/u, "XTOP[cylinder][torus]")), {
    code: "INVALID_PARTIAL_BASE",
  });
  const occupied = new GoEngine({ size: 5, scoringRule: "chinese" });
  assert.equal(occupied.play(0, 0).ok, true);
  assert.equal(occupied.play(1, 1).ok, true);
  const oldState = occupied.exportState();
  delete oldState.replay;
  const occupiedSgf = exportSgf(GoEngine.fromState(oldState).getReplayState()).sgf;
  assert.throws(() => importSgf(occupiedSgf.replace("AB[aa]AW[bb]", "")), {
    code: "INVALID_PARTIAL_BASE",
  });
});

test("explicit SGF rules metadata is retained with a simplified-scoring warning", () => {
  const game = new GoEngine({ size: 5, scoringRule: "japanese" });
  const exported = exportSgf({
    replay: game.getReplayState(),
    metadata: { rules: "Japanese" },
  });
  assert.match(exported.sgf, /RU\[Japanese\]/u);
  assert.equal(exported.warnings.some(({ code }) => code === "SIMPLIFIED_TERRITORY_SCORING"), true);
  const imported = importSgf(exported.sgf);
  assert.equal(imported.replay.base.scoringRule, "japanese");
  assert.equal(imported.warnings.some(({ code }) => code === "SIMPLIFIED_TERRITORY_SCORING"), true);
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

test("30x20 SGF round-trips upper-case FF4 point coordinates", () => {
  const replay = {
    version: 1,
    complete: true,
    base: replayBase({ width: 30, height: 20, topology: "torus" }),
    events: [
      { type: "play", color: "black", row: 19, col: 29 },
      { type: "play", color: "white", row: 0, col: 28 },
    ],
  };

  const exported = exportSgf(replay);
  assert.match(exported.sgf, /SZ\[30:20\]/u);
  assert.match(exported.sgf, /;B\[Dt\]\s*;W\[Ca\]/u);
  const imported = importSgf(exported.sgf);
  assert.equal(imported.width, 30);
  assert.equal(imported.height, 20);
  assert.deepEqual(imported.replay.events, replay.events);
  assert.equal(buildReplayFrames(imported.replay).frames.at(-1).board[0][28], "white");

  assert.throws(() => importSgf("(;FF[4]GM[1]SZ[31:20])"), {
    code: "INVALID_BOARD_SIZE",
  });
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

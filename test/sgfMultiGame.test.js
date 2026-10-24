import assert from "node:assert/strict";
import test from "node:test";

import { rulesFor } from "../src/game/rules/index.js";
import { buildReplayFrames } from "../src/game/replay.js";
import { encodeSgfPoint, exportSgf, importSgf, SgfError } from "../src/game/sgf.js";

const point = (row, col, size = 15) => encodeSgfPoint(row, col, size, size);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function playRandomOthello({ width, height, topology, seed }) {
  const game = rulesFor("othello").create({ gameType: "othello", width, height, topology });
  const random = seededRandom(seed);
  while (game.phase === "play") {
    const moves = game.legalMoves();
    const move = moves[Math.floor(random() * moves.length)];
    assert.equal(game.play(move.row, move.col).ok, true);
  }
  return game;
}

test("Othello records round-trip with GM[2], XTOP, the start discs and a disc-count result", () => {
  for (const [topology, width, height, seed] of [
    ["torus", 8, 8, 1],
    ["mobius", 6, 6, 7],
    ["cylinder", 8, 10, 3],
  ]) {
    const game = playRandomOthello({ width, height, topology, seed });
    const replay = game.getReplayState();
    const { sgf, warnings } = exportSgf({
      replay,
      metadata: { blackPlayer: "Ada", whitePlayer: "Bo", result: game.result },
    });
    assert.match(sgf, /^\(;FF\[4\]GM\[2\]CA\[UTF-8\]AP\[Topology Go:1\]/u);
    assert.match(sgf, new RegExp(`XTOP\\[${topology}\\]`, "u"));
    assert.match(sgf, /AB\[[a-z]{2}\]\[[a-z]{2}\]AW\[[a-z]{2}\]\[[a-z]{2}\]/u);
    assert.doesNotMatch(sgf, /KM\[|RU\[/u);
    const expectedResult = game.result.winner === "draw"
      ? "0"
      : `${game.result.winner === "black" ? "B" : "W"}+${Math.abs(game.result.margin)}`;
    assert.match(sgf, new RegExp(`RE\\[${expectedResult.replace("+", "\\+")}\\]`, "u"));
    assert.ok(warnings.some((item) => item.code === "NONSTANDARD_TOPOLOGY"));

    const imported = importSgf(sgf);
    assert.deepEqual(imported.replay, replay, `${topology} ${width}x${height}`);
    assert.equal(imported.metadata.gameType, "othello");
    assert.equal(imported.metadata.topology, topology);
    assert.equal(imported.metadata.blackPlayer, "Ada");
    assert.deepEqual(imported.warnings, []);
    // The imported record replays to the same final position.
    const { frames } = buildReplayFrames(imported.replay);
    assert.deepEqual(frames.at(-1).board, game.getState().board);
  }
});

test("Othello records from other programs: implicit start, skipped passes, wrong setups refused", () => {
  const game = playRandomOthello({ width: 6, height: 6, topology: "cylinder", seed: 11 });
  const moves = game.getReplayState().events.map((event) =>
    `;${event.color === "black" ? "B" : "W"}[${point(event.row, event.col, 6)}]`);
  // No AB/AW: the standard four discs are assumed. A recorded pass is skipped.
  const plain = `(;FF[4]GM[2]SZ[6]XTOP[cylinder]${moves.slice(0, 3).join("")};W[]${moves.slice(3).join("")})`;
  const imported = importSgf(plain);
  assert.deepEqual(imported.replay, game.getReplayState());
  assert.ok(imported.warnings.some((item) => item.code === "OTHELLO_PASSES_SKIPPED"));

  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[8]AB[aa])"), { code: "UNSUPPORTED_SETUP" });
  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[8]PL[W])"), { code: "UNSUPPORTED_SETUP" });
  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[7])"), { code: "INVALID_BOARD_SIZE" });
  // a1 has no flips at the start.
  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[8];B[aa])"), { code: "ILLEGAL_MOVE" });
  // White cannot open.
  assert.throws(() => importSgf("(;FF[4]GM[2]SZ[8];W[dc])"), { code: "ILLEGAL_MOVE" });
  const missingSize = importSgf("(;FF[4]GM[2])");
  assert.equal(missingSize.width, 8);
  assert.ok(missingSize.warnings.some((item) => item.code === "DEFAULT_SIZE_ASSUMED"));
});

test("Gomoku records round-trip with GM[4], RU and a five as B+ or W+", () => {
  const game = rulesFor("gomoku").create({
    gameType: "gomoku", width: 15, height: 15, topology: "mobius", ruleSet: "renju",
  });
  // Black makes five across the Möbius seam: row 7 columns 12..16 wraps to row 7 (mirrored).
  for (const [row, col] of [[7, 12], [0, 0], [7, 13], [0, 2], [7, 14], [0, 4], [7, 0], [0, 6], [7, 1]]) {
    assert.equal(game.play(row, col).ok, true, `${row},${col}`);
  }
  assert.equal(game.phase, "finished");
  const { sgf } = exportSgf({ replay: game.getReplayState(), metadata: { result: game.result } });
  assert.match(sgf, /^\(;FF\[4\]GM\[4\]CA\[UTF-8\]AP\[Topology Go:1\]SZ\[15\]RU\[Renju\]XTOP\[mobius\]RE\[B\+\]\n/u);
  assert.doesNotMatch(sgf, /AB\[|AW\[|KM\[/u);
  const imported = importSgf(sgf);
  assert.deepEqual(imported.replay, game.getReplayState());
  assert.equal(imported.metadata.ruleSet, "renju");
  assert.equal(imported.metadata.result, "B+");
  // Moves after the five are refused.
  assert.throws(() => importSgf(sgf.replace(/\)$/u, `\n;W[${point(3, 3)}])`)), { code: "ILLEGAL_MOVE" });
});

test("Gomoku imports enforce Renju, refuse setups and passes, and keep resignations", () => {
  // Black's double three at h8 (row 7, col 7) under Renju.
  const doubleThree = [
    `;B[${point(7, 5)}]`, `;W[${point(0, 0)}]`, `;B[${point(7, 6)}]`, `;W[${point(0, 2)}]`,
    `;B[${point(5, 7)}]`, `;W[${point(0, 4)}]`, `;B[${point(6, 7)}]`, `;W[${point(0, 6)}]`,
    `;B[${point(7, 7)}]`,
  ].join("");
  assert.throws(
    () => importSgf(`(;FF[4]GM[4]SZ[15]RU[Renju]${doubleThree})`),
    (error) => error instanceof SgfError && error.code === "ILLEGAL_MOVE" && /forbidden/u.test(error.reason),
  );
  // The same moves are fine in freestyle; RU absent means freestyle.
  const freestyle = importSgf(`(;FF[4]GM[4]SZ[15]XTOP[torus]${doubleThree})`);
  assert.equal(freestyle.metadata.ruleSet, "freestyle");
  assert.equal(freestyle.replay.base.topology, "torus");
  assert.equal(freestyle.replay.events.length, 9);

  const standard = importSgf(`(;FF[4]GM[4]SZ[15]RU[Standard];B[${point(7, 7)}])`);
  assert.equal(standard.metadata.ruleSet, "freestyle");
  assert.ok(standard.warnings.some((item) => item.code === "UNKNOWN_GOMOKU_RULE"));

  assert.throws(() => importSgf(`(;FF[4]GM[4]SZ[15]AB[${point(7, 7)}])`), { code: "UNSUPPORTED_SETUP" });
  assert.throws(() => importSgf(`(;FF[4]GM[4]SZ[15];B[${point(7, 7)}];W[])`), { code: "INVALID_MOVE" });
  assert.throws(() => importSgf("(;FF[4]GM[4]SZ[9])"), { code: "INVALID_BOARD_SIZE" });
  assert.throws(() => importSgf("(;FF[4]GM[4]SZ[15]XCOMPLETE[0])"), { code: "INVALID_PARTIAL_BASE" });

  // A resignation in RE becomes the record's final event, and exports back to RE.
  const resigned = importSgf(`(;FF[4]GM[4]SZ[15]RE[W+R];B[${point(7, 7)}];W[${point(7, 8)}])`);
  assert.deepEqual(resigned.replay.events.at(-1), { type: "resign", color: "black" });
  const again = exportSgf({ replay: resigned.replay, metadata: resigned.metadata });
  assert.match(again.sgf, /RE\[W\+R\]/u);
  assert.doesNotMatch(again.sgf, /resign/u);
});

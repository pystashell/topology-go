import assert from "node:assert/strict";
import test from "node:test";

import { translateText } from "../src/i18n.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";
import { GoEngine } from "../src/game/goEngine.js";
import {
  GAME_SIZE_SHORTCUTS,
  boardLimitNote,
  clampBoardDimension,
  countDiscs,
  dimensionRangeText,
  formatGameResult,
  gameControls,
  gameMoveMessage,
  gameName,
  gameReplayStepMessage,
  gameSettingsSummary,
  gameStatusText,
  isOfferedBoardDimension,
  joinSentences,
  lobbyGameLabels,
  moveErrorMessage,
  newBoardMessage,
  normalizeGameType,
  normalizeRuleSet,
  ruleSetName,
  rulesSummaryTitle,
  sgfOtherGameNote,
  skippedTurnText,
} from "../src/ui/gameUi.js";

const CJK = /[㐀-鿿！-｠　-〿]/u;
const COLORS = ["black", "white"];
const TOPOLOGIES = ["cylinder", "torus", "mobius"];

function english(text) {
  return translateText(text, {}, "en");
}

function assertEnglish(text) {
  const rendered = english(text);
  assert.doesNotMatch(rendered, CJK, `${text} -> ${rendered}`);
  return rendered;
}

function play(engine, moves) {
  for (const [row, col] of moves) {
    const result = engine.play(row, col);
    assert.ok(result.ok, `move ${row},${col}: ${result.reason}`);
  }
  return engine;
}

test("game types and rule sets normalise to known values", () => {
  assert.equal(normalizeGameType(undefined), "go");
  assert.equal(normalizeGameType("chess"), "go");
  assert.equal(normalizeGameType("othello"), "othello");
  assert.equal(normalizeRuleSet("renju"), "renju");
  assert.equal(normalizeRuleSet("caro"), "freestyle");
  assert.deepEqual(["go", "gomoku", "othello"].map(gameName), ["围棋", "五子棋", "黑白棋"]);
  assert.deepEqual(["freestyle", "renju"].map(ruleSetName), ["自由规则", "禁手规则（连珠）"]);
  assert.deepEqual(
    ["围棋", "五子棋", "黑白棋", "自由规则", "禁手规则（连珠）"].map(english),
    ["Go", "Gomoku", "Othello", "Freestyle", "Renju"],
  );
});

test("board sides clamp to each game's limits and parity", () => {
  assert.equal(clampBoardDimension("go", 3), 5);
  assert.equal(clampBoardDimension("go", 31), 30);
  assert.equal(clampBoardDimension("go", "x", 13), 13);
  assert.equal(clampBoardDimension("go", 9.4), 9);
  assert.equal(clampBoardDimension("gomoku", 9), 11);
  assert.equal(clampBoardDimension("gomoku", 19), 19);
  assert.equal(clampBoardDimension("othello", 7), 8);
  assert.equal(clampBoardDimension("othello", 9), 10);
  assert.equal(clampBoardDimension("othello", 29), 30);
  assert.equal(clampBoardDimension("othello", 4), 6);
  assert.equal(clampBoardDimension("othello", 31), 30);
  assert.equal(clampBoardDimension("othello", undefined), 8);
  assert.ok(isOfferedBoardDimension("go", 5));
  assert.ok(!isOfferedBoardDimension("go", 4));
  assert.ok(!isOfferedBoardDimension("gomoku", 10));
  assert.ok(!isOfferedBoardDimension("othello", 9));
  assert.ok(isOfferedBoardDimension("othello", 30));
  // Every shortcut is a board the game accepts.
  for (const [gameType, sizes] of Object.entries(GAME_SIZE_SHORTCUTS)) {
    for (const size of sizes) assert.ok(isOfferedBoardDimension(gameType, size), `${gameType} ${size}`);
  }
  assert.deepEqual(GAME_SIZE_SHORTCUTS, { go: [9, 13, 19], gomoku: [15, 19], othello: [6, 8, 10] });
});

test("size captions and limit notes name each game's range", () => {
  assert.equal(dimensionRangeText("go", "width"), "横向列数 · 5–30");
  assert.equal(dimensionRangeText("go", "height"), "纵向行数 · 5–30");
  assert.equal(dimensionRangeText("gomoku", "height"), "纵向行数 · 11–30");
  assert.equal(dimensionRangeText("othello", "width"), "偶数列 · 6–30");
  assert.equal(english(dimensionRangeText("othello", "width")), "Even columns · 6–30");
  assert.equal(english(dimensionRangeText("othello", "height")), "Even rows · 6–30");
  assert.equal(english(dimensionRangeText("gomoku", "height")), "Rows · 11–30");
  assert.equal(boardLimitNote("go"), "");
  assert.equal(english(boardLimitNote("gomoku")), "Gomoku boards need at least 11 lines per side.");
  assert.equal(english(boardLimitNote("othello")), "Othello boards need even sides from 6 to 30.");
});

test("settings summaries keep Go's line and name other games and rules", () => {
  const go = { width: 9, height: 9, topology: "cylinder", scoringRule: "chinese", komi: 6.5 };
  assert.equal(
    gameSettingsSummary(go, { showGame: false }),
    "9 × 9 · 竹筒 · 中国规则 · 贴目 6.5 · 不计时",
  );
  assert.equal(gameSettingsSummary(go), "围棋 · 9 × 9 · 竹筒 · 中国规则 · 贴目 6.5 · 不计时");
  assert.equal(
    english(gameSettingsSummary(go)),
    "Go · 9 × 9 · Cylinder · Chinese rules · Komi 6.5 · No clock",
  );
  assert.equal(
    gameSettingsSummary({
      gameType: "gomoku", ruleSet: "renju", width: 15, height: 15, topology: "mobius",
      mainTimeSeconds: 600,
    }),
    "五子棋 · 15 × 15 · 莫比乌斯 · 禁手规则（连珠） · 10 分钟",
  );
  assert.equal(
    gameSettingsSummary({ gameType: "othello", width: 7, height: 8, topology: "torus", komi: 7.5 }),
    "黑白棋 · 8 × 8 · 甜甜圈 · 不计时",
    "Othello sides clamp to even and komi is ignored",
  );
  for (const topology of TOPOLOGIES) {
    for (const clock of [{}, { mainTimeSeconds: 300 }, { mainTimeSeconds: 300, byoYomiPeriods: 3, byoYomiSeconds: 20 }]) {
      for (const settings of [
        { ...go, topology, ...clock },
        { gameType: "gomoku", ruleSet: "freestyle", width: 19, height: 11, topology, ...clock },
        { gameType: "gomoku", ruleSet: "renju", width: 15, height: 15, topology, ...clock },
        { gameType: "othello", width: 6, height: 10, topology, ...clock },
      ]) {
        assertEnglish(gameSettingsSummary(settings));
        assertEnglish(gameSettingsSummary(settings, { showGame: false }));
      }
    }
  }
});

test("results read naturally for every game and end", () => {
  assert.equal(formatGameResult(null), "");
  assert.equal(formatGameResult({ winner: "white", loser: "black", reason: "resign" }), "白方胜 · 黑方认输");
  assert.equal(formatGameResult({ winner: "black", loser: "white", reason: "timeout" }), "黑方胜 · 白方超时");
  assert.equal(formatGameResult({ winner: "draw", margin: 0 }), "双方和棋");
  assert.equal(formatGameResult({ winner: "white", margin: 6.5 }), "白方胜 6.5 目");

  // A freestyle five across the cylinder seam.
  const five = play(new GomokuEngine({ width: 15, height: 15 }), [
    [7, 13], [0, 0], [7, 14], [0, 2], [7, 0], [0, 4], [7, 1], [0, 6], [7, 2],
  ]);
  assert.equal(five.result.reason, "five");
  assert.equal(formatGameResult(five.result), "黑方连成五子获胜");
  assert.equal(english(formatGameResult(five.result)), "Black wins with five in a row");
  assert.equal(formatGameResult({ ...five.result, winner: "white", length: 6 }), "白方以 6 子长连获胜");
  assert.equal(english("白方以 6 子长连获胜。"), "White wins with an overline of 6.");
  assert.equal(english(formatGameResult({ winner: "draw", reason: "board_full", margin: 0 })), "Board full: draw");
  assert.equal(
    english(formatGameResult({ winner: "draw", reason: "no_legal_moves", margin: 0 })),
    "Black has no legal point left: draw",
  );
  assert.equal(
    formatGameResult({ winner: "black", loser: "white", reason: "discs", black: 40, white: 24, margin: 16 }),
    "黑方胜 16 子",
  );
  assert.equal(english("白方胜 1 子"), "White wins by 1 disc");
  assert.equal(
    english(formatGameResult({ winner: "draw", reason: "discs", black: 32, white: 32, margin: 0 })),
    "Draw: 32 discs each",
  );
  for (const color of COLORS) {
    const other = color === "black" ? "white" : "black";
    for (const result of [
      { winner: color, loser: other, reason: "resign" },
      { winner: color, loser: other, reason: "timeout" },
      { winner: color, loser: other, reason: "five", length: 5 },
      { winner: color, loser: other, reason: "five", length: 11 },
      { winner: color, loser: other, reason: "discs", black: 33, white: 31, margin: 2 },
      { winner: color, loser: other, margin: 3.5 },
    ]) {
      assertEnglish(formatGameResult(result));
      assertEnglish(`${formatGameResult(result)}。`);
      assertEnglish(`复盘结束：${formatGameResult(result)}。`);
    }
  }
});

test("controls follow each game's capabilities and counters", () => {
  const go = gameControls("go", new GoEngine({ size: 9 }).getState());
  assert.equal(go.pass, true);
  assert.equal(go.scoring, true);
  assert.equal(go.ai && go.analysis && go.sgf && go.komi && go.scoringRule, true);
  assert.equal(go.counts, "captures");
  assert.deepEqual(go.countValues, { black: 0, white: 0 });
  assert.deepEqual(go.countLabels, { black: "黑方提子", white: "白方提子" });

  const gomoku = gameControls("gomoku", new GomokuEngine().getState());
  assert.equal(gomoku.pass || gomoku.scoring || gomoku.ai || gomoku.analysis || gomoku.sgf, false);
  assert.equal(gomoku.undo && gomoku.resign && gomoku.ruleSet, true);
  assert.equal(gomoku.komi, false);
  assert.equal(gomoku.counts, null);
  assert.equal(gomoku.countLabels, null);

  const othello = gameControls("othello", new OthelloEngine({ width: 8, height: 6 }).getState());
  assert.equal(othello.pass || othello.scoring || othello.ai || othello.sgf || othello.ruleSet, false);
  assert.equal(othello.counts, "discs");
  assert.deepEqual(othello.countValues, { black: 2, white: 2 });
  assert.deepEqual(othello.countLabels, { black: "黑方子数", white: "白方子数" });
  assert.deepEqual(english("黑方子数"), "Black discs");
  // A state without `discs` (a hydrated board) is counted from the board.
  assert.deepEqual(gameControls("othello", { board: [["black", "white", "white"]] }).countValues, {
    black: 1,
    white: 2,
  });
  assert.deepEqual(countDiscs(null), { black: 0, white: 0 });
  assert.equal(gameControls(undefined, { gameType: "othello" }).counts, "discs");
});

test("status text names the turn, the result and an automatic Othello pass", () => {
  const start = new OthelloEngine().getState();
  assert.deepEqual(gameStatusText(start), { phase: "对局中", turn: "黑方落子", note: "" });
  const skipped = {
    ...start,
    currentPlayer: "black",
    lastMove: { type: "play", color: "black", row: 0, col: 0, flipped: [], skipped: "white" },
  };
  assert.equal(gameStatusText(skipped).note, "白方无子可下，黑方继续");
  assert.equal(english(gameStatusText(skipped).note), "White has no legal move; Black continues");
  assert.equal(skippedTurnText("black"), "黑方无子可下，白方继续");
  const finished = { ...start, phase: "finished", result: { winner: "white", loser: "black", reason: "discs", black: 30, white: 34, margin: 4 } };
  assert.deepEqual(gameStatusText(finished), { phase: "对局结束", turn: "白方胜 4 子", note: "" });
  assert.deepEqual(gameStatusText(null), { phase: "", turn: "", note: "" });
  for (const text of ["对局中", "对局结束", "黑方落子", "白方落子"]) assertEnglish(text);
});

test("move messages describe flips, automatic passes and endings", () => {
  const othello = new OthelloEngine();
  const move = othello.play(2, 3);
  assert.equal(gameMoveMessage(move, { gameType: "othello" }), "黑方落子，翻转 1 子。");
  assert.equal(english("黑方落子，翻转 1 子。"), "Black plays and flips 1 disc.");
  const skip = gameMoveMessage({ ...move, skipped: "white" }, { gameType: "othello" });
  assert.equal(skip, "黑方落子，翻转 1 子。 白方无子可下，黑方继续。");
  assert.equal(english(skip), "Black plays and flips 1 disc. White has no legal move; Black continues.");
  const end = gameMoveMessage(
    { ...move, flipped: [{}, {}] },
    { gameType: "othello", result: { winner: "black", loser: "white", reason: "discs", black: 36, white: 28, margin: 8 } },
  );
  assert.equal(end, "黑方落子，翻转 2 子。 对局结束：黑方胜 8 子。");
  assert.equal(english(end), "Black plays and flips 2 discs. Game over: Black wins by 8 discs.");
  assert.equal(gameMoveMessage({ color: "white" }, { gameType: "gomoku" }), "白方落子。");
  assert.equal(
    gameMoveMessage({ color: "black" }, { gameType: "gomoku", result: { winner: "black", reason: "five", length: 5 } }),
    "黑方连成五子获胜。",
  );
  for (const color of COLORS) {
    for (const gameType of ["gomoku", "othello"]) {
      for (const result of [null, { winner: color, reason: "five", length: 7 }, { winner: "draw", reason: "board_full" }]) {
        for (const skipped of [null, color === "black" ? "white" : "black"]) {
          assertEnglish(gameMoveMessage({ color, flipped: [{}, {}, {}], skipped }, { gameType, result }));
          const step = gameReplayStepMessage(12, { color, flipped: [{}], skipped }, { gameType });
          assertEnglish(step);
          assertEnglish(joinSentences(step, "可随时切换平面或立体视图。"));
        }
      }
    }
  }
  assert.equal(
    gameReplayStepMessage(5, { color: "white", flipped: [{}, {}], skipped: "black" }, { gameType: "othello" }),
    "第 5 手：白方落子，翻转 2 子。 黑方无子可下，白方继续。",
  );
  assert.equal(joinSentences("A。", "", null, " B。"), "A。 B。");
});

test("rejected moves explain Renju forbidden points and Othello's outflank rule", () => {
  // R1: a double three at the centre of a 15 × 15 board.
  const renju = new GomokuEngine({ ruleSet: "renju" });
  play(renju, [[7, 5], [0, 0], [7, 6], [0, 2], [5, 7], [0, 4], [6, 7], [0, 6]]);
  const forbidden = renju.play(7, 7);
  assert.equal(forbidden.reason, "forbidden");
  assert.equal(moveErrorMessage(forbidden), "黑方禁手：三三。");
  assert.equal(english(moveErrorMessage(forbidden)), "Forbidden for Black: double three.");
  assert.equal(english(moveErrorMessage({ reason: "forbidden", forbidden: "double_four" })), "Forbidden for Black: double four.");
  assert.equal(english(moveErrorMessage({ reason: "forbidden", forbidden: "overline" })), "Forbidden for Black: overline.");
  assert.equal(moveErrorMessage({ reason: "forbidden" }), "黑方禁手，不能落在这里。");
  const othello = new OthelloEngine();
  const noFlips = othello.play(0, 0);
  assert.equal(noFlips.reason, "no_flips");
  assert.equal(english(moveErrorMessage(noFlips)), "A move must outflank at least one disc.");
  assert.equal(moveErrorMessage({ reason: "suicide" }), "禁入点：落子后这一块棋没有气。");
  assert.equal(moveErrorMessage({ reason: "mystery" }), "这一手不能下。");
  assert.equal(moveErrorMessage({ reason: "mystery" }, "当前不能认输。"), "当前不能认输。");
  for (const reason of [
    "game_not_playing", "out_of_bounds", "occupied", "suicide", "superko", "game_not_scoring",
    "empty_point", "nothing_to_undo", "forbidden", "no_flips", "unsupported_action",
  ]) {
    assertEnglish(moveErrorMessage({ reason }));
  }
});

test("board, rules and lobby labels name the game", () => {
  assert.equal(
    newBoardMessage({ width: 19, height: 19, topology: "cylinder" }),
    "19 × 19 竹筒棋盘已准备好，黑方先行。",
  );
  const othello = newBoardMessage({ gameType: "othello", width: 8, height: 8, topology: "torus" });
  assert.equal(othello, "黑白棋 · 8 × 8 甜甜圈棋盘已准备好，黑方先行。");
  assert.equal(english(othello), "Othello · 8 × 8 Torus board is ready. Black plays first.");
  assert.equal(
    newBoardMessage({ gameType: "othello", width: 8, height: 8, topology: "torus" }, { showGame: false }),
    "8 × 8 甜甜圈棋盘已准备好，黑方先行。",
  );
  assert.equal(rulesSummaryTitle("go", "mobius", { showGame: false }), "莫比乌斯棋盘规则说明");
  for (const gameType of ["go", "gomoku", "othello"]) {
    for (const topology of TOPOLOGIES) {
      assertEnglish(rulesSummaryTitle(gameType, topology));
      assertEnglish(newBoardMessage({ gameType, width: 12, height: 14, topology }));
    }
  }
  assert.equal(english(rulesSummaryTitle("gomoku", "cylinder")), "Gomoku · Cylinder board rules");
  assert.deepEqual(lobbyGameLabels({}), { gameType: "go", badge: "围棋", rule: "" });
  assert.deepEqual(lobbyGameLabels({ gameType: "gomoku", ruleSet: "renju" }), {
    gameType: "gomoku",
    badge: "五子棋",
    rule: "禁手规则（连珠）",
  });
  assert.deepEqual(lobbyGameLabels({ gameType: "othello" }), { gameType: "othello", badge: "黑白棋", rule: "" });
});

test("SGF records of other games get a friendly note", () => {
  const note = (gm) => sgfOtherGameNote({ message: `Unsupported SGF game type GM[${gm}]` });
  assert.equal(note(2), "这是黑白棋棋谱（GM[2]）；目前只能导入围棋 SGF。");
  assert.equal(english(note(2)), "This is an Othello record (GM[2]); only Go SGF files can be imported for now.");
  assert.equal(english(note(4)), "This is a Gomoku record (GM[4]); only Go SGF files can be imported for now.");
  assert.equal(
    english(note(7)),
    "This SGF file is not a Go record (GM[7]); only Go SGF files can be imported for now.",
  );
  assertEnglish(sgfOtherGameNote({}));
});

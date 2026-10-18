import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { translateText } from "../src/i18n.js";
import { ENABLE_MULTI_GAME, isGameType } from "../src/game/gameTypes.js";
import { gameTypeOf } from "../src/game/rules/index.js";
import { gameSettingsSummary } from "../src/ui/gameUi.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `expected main.js to contain ${from}`);
  return main.slice(start, end);
};

function summaryHarness() {
  const source = [
    slice("function availableGameType(", "function gameRulesOf("),
    slice("function boardSettingsSummary(", "function onlineBoardSummaryText()"),
    slice("function onlineInvitationSummary(", "function updateRoomUI()"),
    "({ boardSettingsSummary, onlineInvitationSummary })",
  ].join("\n");
  return vm.runInNewContext(source, {
    ENABLE_MULTI_GAME,
    GAME_GO: "go",
    isGameType,
    gameTypeOf,
    gameSettingsSummary,
  });
}

// With several games every summary starts with the game's name.
const GO_PREFIX = ENABLE_MULTI_GAME ? "围棋 · " : "";
const GO_PREFIX_EN = ENABLE_MULTI_GAME ? "Go · " : "";

test("a received invitation names the clock and komi the host chose", () => {
  const { onlineInvitationSummary } = summaryHarness();
  const summary = onlineInvitationSummary({
    settings: {
      width: 9,
      height: 9,
      topology: "cylinder",
      scoringRule: "chinese",
      komi: 6.5,
      mainTimeSeconds: 300,
      byoYomiPeriods: 3,
      byoYomiSeconds: 20,
    },
  });
  assert.equal(summary, `${GO_PREFIX}9 × 9 · 竹筒 · 中国规则 · 贴目 6.5 · 5 分钟 + 3×20 秒`);
  assert.equal(
    translateText(summary, {}, "en"),
    `${GO_PREFIX_EN}9 × 9 · Cylinder · Chinese rules · Komi 6.5 · 5 min + 3×20 sec`,
  );
  assert.equal(onlineInvitationSummary(null), "等待被邀请方回应。");
});

test("settings summaries cover untimed and absolute clocks in both languages", () => {
  const { boardSettingsSummary } = summaryHarness();
  const untimed = boardSettingsSummary({
    width: 13, height: 7, topology: "mobius", scoringRule: "japanese", komi: 0,
  });
  assert.equal(untimed, `${GO_PREFIX}13 × 7 · 莫比乌斯 · 简化领地计分 · 贴目 0 · 不计时`);
  assert.equal(
    translateText(untimed, {}, "en"),
    `${GO_PREFIX_EN}13 × 7 · Möbius · Simplified territory scoring · Komi 0 · No clock`,
  );
  const absolute = boardSettingsSummary({
    width: 19, height: 19, topology: "torus", komi: 7.5, mainTimeSeconds: 600,
  });
  assert.equal(absolute, `${GO_PREFIX}19 × 19 · 甜甜圈 · 中国规则 · 贴目 7.5 · 10 分钟`);
  assert.equal(
    translateText(absolute, {}, "en"),
    `${GO_PREFIX_EN}19 × 19 · Torus · Chinese rules · Komi 7.5 · 10 min`,
  );
});

test("invitations to Gomoku and Othello name the game and its rules", { skip: !ENABLE_MULTI_GAME }, () => {
  const { boardSettingsSummary, onlineInvitationSummary } = summaryHarness();
  const renju = onlineInvitationSummary({
    settings: {
      gameType: "gomoku", ruleSet: "renju", width: 15, height: 15, topology: "torus",
      mainTimeSeconds: 300, byoYomiPeriods: 3, byoYomiSeconds: 20,
    },
  });
  assert.equal(renju, "五子棋 · 15 × 15 · 甜甜圈 · 禁手规则（连珠） · 5 分钟 + 3×20 秒");
  assert.equal(
    translateText(renju, {}, "en"),
    "Gomoku · 15 × 15 · Torus · Renju · 5 min + 3×20 sec",
  );
  const othello = boardSettingsSummary({
    gameType: "othello", width: 8, height: 10, topology: "mobius", komi: 7.5,
  });
  assert.equal(othello, "黑白棋 · 8 × 10 · 莫比乌斯 · 不计时");
  assert.equal(translateText(othello, {}, "en"), "Othello · 8 × 10 · Möbius · No clock");
});

test("inviting a friend creates the room in place with the configured settings", () => {
  const handler = slice("elements.inviteFriend.addEventListener(", "elements.inviteLocal.addEventListener(");
  assert.match(handler, /showOnlineDialog\("", \{ intent: "create" \}\)/u);
  assert.doesNotMatch(handler, /navigateAppPath/u, "a navigation reloads the page and drops the settings");

  const dialog = slice("function showOnlineDialog(", "function closeOnlineDialog()");
  assert.match(dialog, /onlineBoardSummarySection\.hidden = !\["all", "create"\]\.includes\(intent\)/u);
  const create = slice("async function createOnlineRoom(", "async function joinOnlineRoom(");
  assert.match(create, /roomClient\.createRoom\(\{ name, \.\.\.getNewGameOptions\(\), signal \}\)/u);
});

test("settings carried into the lobby are restored before its create flow", () => {
  assert.match(
    slice('elements.joinInvitation.addEventListener("click"', "elements.cancelInvite.addEventListener("),
    /rememberLobbyBoardSettings\(\);\s*navigateAppPath\("\/lobby"\)/u,
  );
  assert.match(main, /if \(initialRoute\.mode === "lobby"\) restoreLobbyBoardSettings\(\);\s*showAppScreen\(initialRoute\.mode\);/u);
  const restore = slice("function restoreLobbyBoardSettings()", "function savedPlayerName()");
  assert.match(restore, /window\.sessionStorage\.getItem\(LOBBY_BOARD_SETTINGS_KEY\)/u);
  assert.match(restore, /normalizeBoardDimension\(saved\.width\)/u);
  assert.match(restore, /reflectGameOptions\(options\);\s*resetLobbyPreview\(\);/u);
});

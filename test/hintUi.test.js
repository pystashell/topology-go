import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { aiMoveWaitMs } from "../src/ai/aiPacing.js";
import { gameAiPosition } from "../src/ai/gameAiClient.js";
import { GAME_AI_ERRORS } from "../src/ai/gameAiClient.js";
import { GoEngine } from "../src/game/goEngine.js";
import { gameTypeOf, rulesFor } from "../src/game/rules/index.js";
import { appSource } from "./helpers/appSource.js";

/*
 * The page's hint button and AI pacing, run from main.js in a sandbox with
 * real engines and a fake AI: when the hint is offered, what it shows, when
 * it lapses (a move, an undo, a new game), stale and failed answers, Go's
 * KataGo path, and how long an AI move waits before it is played.
 */

const main = appSource();
const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `expected main.js to contain ${from}`);
  return main.slice(start, end);
};

const HINT_SOURCE = slice("function playsAgainstAI()", "async function startAIGame(");
const MOVE_MARK_SOURCE = slice("function isOneMoveOn(", "/**\n * Othello legal-move hints");

const COLUMNS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

function harness({ gameType = "othello", online = false, ownColor = "black", opponent = "ai" } = {}) {
  const timers = [];
  const messages = [];
  const posted = [];
  let pendingChoice = null;
  const button = { hidden: true, disabled: true, textContent: "" };
  const context = {
    console,
    JSON,
    Math,
    Promise,
    Boolean,
    Error,
    game: rulesFor(gameType).create(gameType === "go" ? { width: 9, height: 9 } : {}),
    moveCount: 0,
    aiHumanColor: "black",
    aiThinking: false,
    aiMode: !online,
    selfPlay: false,
    online,
    replaying: false,
    nextGame: false,
    timeout: null,
    undoRequest: null,
    onlineStateSynchronized: true,
    onlineCommandPending: false,
    moveHint: null,
    hintPending: null,
    hintRequestSequence: 0,
    HINT_AI_LEVEL: "hard",
    HINT_THINK_MS: 2_000,
    AI_CONTEXT_HINT: "hint",
    PHASE_PLAY: "play",
    MATCH_CONTROLLER_AI: "ai",
    MATCH_CONTROLLER_HUMAN: "human",
    GAME_AI_ERRORS,
    KATAGO_AI: { timeMs: 900, maxIterations: 300, rolloutLimit: 200 },
    flipWaveEndsAt: 0,
    aiRequestId: 0,
    aiWorkerContext: null,
    aiWorkerModelId: null,
    aiWorkerBusy: false,
    aiWorker: null,
    elements: { hintButton: button },
    performance: { now: () => context.clock },
    clock: 0,
    window: {
      setTimeout(callback, delay) {
        timers.push({ callback, at: context.clock + delay });
        return timers.length;
      },
    },
    gameRulesOf: (value = context.game) => rulesFor(gameTypeOf(value)),
    gameTypeOf,
    oppositeColor: (color) => (color === "black" ? "white" : "black"),
    hasOnlineSession: () => context.online,
    isAIMode: () => context.aiMode,
    isAIvsAI: () => context.selfPlay,
    isOnlinePlayer: () => context.online,
    currentIdentity: () => ({ color: ownColor, playerId: "me" }),
    onlineController: (color) => (color === ownColor
      ? { kind: "human", operatorId: "me" }
      : { kind: opponent === "ai" ? "ai" : "human", operatorId: "host" }),
    isOnlineTurn: () => context.game.currentPlayer === ownColor,
    isReplaying: () => context.replaying,
    isNextGameSetup: () => context.nextGame,
    currentTimeoutOutcome: () => context.timeout,
    currentUndoRequest: () => context.undoRequest,
    usesGameAiProtocol: (type) => type !== "go",
    gameAiPosition,
    gameAIFor: () => ({
      choose(position, settings) {
        context.lastChoice = { position, settings };
        return new Promise((resolve, reject) => { pendingChoice = { resolve, reject }; });
      },
    }),
    setMessage: (text, error = false) => messages.push({ text, error }),
    updateUI: () => { context.updates = (context.updates ?? 0) + 1; },
    renderCurrentAnalysisPosition: () => {},
    localizedErrorMessage: (error, fallback) => fallback,
    formatReviewMove: (move, height) => `${COLUMNS[move.col]}${height - move.row}`,
    boardHeight: () => context.game.height,
    boardPointCount: () => context.game.width * context.game.height,
    aiMoveWaitMs,
    // KataGo (Go hints).
    onlineAISeat: () => ({ modelId: "b10" }),
    normalizeAIModelId: (id) => id ?? "b10",
    localAIModelId: () => "b10",
    aiColor: () => "white",
    browserSupportsAIModel: () => true,
    getAIModel: (id) => ({ name: `KataGo ${id}` }),
    Worker: function Worker() {},
    terminateAIWorker: () => { context.terminated = (context.terminated ?? 0) + 1; },
    ensureAIWorker: () => ({ postMessage: (message) => posted.push(message) }),
    clearAIWorkerIdleRelease: () => {},
    buildReplayStateAtStep: () => ({}),
  };
  vm.createContext(context);
  vm.runInContext(`${HINT_SOURCE}\n${MOVE_MARK_SOURCE}`, context);
  const run = (code) => vm.runInContext(code, context);
  return {
    context,
    button,
    messages,
    posted,
    run,
    sync: (playing = true) => run(`syncHintButton(${playing})`),
    answer: (move) => pendingChoice.resolve({ move, info: {} }),
    fail: (error) => pendingChoice.reject(error),
    tick(ms) {
      context.clock += ms;
      for (const timer of timers.splice(0)) {
        if (timer.at <= context.clock) timer.callback();
        else timers.push(timer);
      }
    },
    timers,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
// Objects made inside the sandbox belong to another realm: compare as JSON.
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

test("the hint is offered only to a human playing against AI, on their own turn", () => {
  const local = harness();
  local.sync();
  assert.deepEqual([local.button.hidden, local.button.disabled, local.button.textContent], [false, false, "提示"]);
  // The AI's turn: shown but off.
  local.context.game.play(2, 3);
  local.sync();
  assert.deepEqual([local.button.hidden, local.button.disabled], [false, true]);
  // The AI is thinking, a replay or the next-game setup: off or hidden.
  local.context.game.play(2, 2);
  local.context.aiThinking = true;
  local.sync();
  assert.equal(local.button.disabled, true);
  local.context.aiThinking = false;
  local.context.replaying = true;
  local.sync();
  assert.equal(local.button.hidden, true);
  local.context.replaying = false;
  local.sync(false);
  assert.equal(local.button.hidden, true, "not while the game is not being played");

  // A local two-player game and AI self-play have no hint.
  const twoPlayer = harness();
  twoPlayer.context.aiMode = false;
  twoPlayer.sync();
  assert.equal(twoPlayer.button.hidden, true);
  const selfPlay = harness();
  selfPlay.context.selfPlay = true;
  selfPlay.sync();
  assert.equal(selfPlay.button.hidden, true);

  // Online: only against an AI seat, and only on this player's turn.
  const versusAI = harness({ online: true });
  versusAI.sync();
  assert.deepEqual([versusAI.button.hidden, versusAI.button.disabled], [false, false]);
  versusAI.context.onlineCommandPending = true;
  versusAI.sync();
  assert.equal(versusAI.button.disabled, true, "not while a command is on its way");
  const versusHuman = harness({ online: true, opponent: "human" });
  versusHuman.sync();
  assert.equal(versusHuman.button.hidden, true, "no hints between two humans");
});

test("an Othello hint asks the engine at its strongest level and marks the point until the position changes", async () => {
  const page = harness();
  const request = page.run("requestMoveHint()");
  page.sync();
  assert.deepEqual([page.button.textContent, page.button.disabled], ["提示中…", true]);
  assert.equal(page.messages.at(-1).text, "正在为你计算提示…");
  same(page.context.lastChoice.settings, { level: "hard", timeLimitMs: 2_000 });
  assert.equal(page.context.lastChoice.position.currentPlayer, "black");
  page.answer({ row: 2, col: 3 });
  await request;
  assert.equal(page.messages.at(-1).text, "提示：AI 建议下在 D6（棋盘上已标出）。");
  const state = page.context.game.getState();
  same(page.run("hintMoveFor")(state), { type: "play", row: 2, col: 3 });
  page.sync();
  assert.deepEqual([page.button.textContent, page.button.disabled], ["提示", false]);
  // Asking again for the same position repeats the hint without a new search.
  page.context.lastChoice = null;
  await page.run("requestMoveHint()");
  assert.equal(page.context.lastChoice, null);
  assert.equal(page.messages.at(-1).text, "提示：AI 建议下在 D6（棋盘上已标出）。");

  // The human plays (here, the hinted point): the hint lapses.
  page.context.game.play(2, 3);
  page.context.moveCount = 1;
  assert.equal(page.run("hintMoveFor")(page.context.game.getState()), null);
  page.sync();
  assert.equal(page.context.moveHint, null);
});

test("undo, a new game or a hint answered too late leave no hint behind", async () => {
  const page = harness();
  await (async () => {
    const request = page.run("requestMoveHint()");
    page.answer({ row: 2, col: 3 });
    await request;
  })();
  assert.ok(page.context.moveHint);
  // Undo back over the human's move changes the position key.
  page.context.game.play(2, 3);
  page.context.moveCount = 1;
  page.context.game.undo();
  page.context.moveCount = 0;
  // Same position as when asked: the hint applies again (same key).
  same(page.run("hintMoveFor")(page.context.game.getState()), { type: "play", row: 2, col: 3 });
  // A new game (another engine, same start): the key matches only by
  // position, which is the same start; a different board size does not.
  page.context.game = rulesFor("othello").create({ width: 6, height: 6 });
  assert.equal(page.run("hintMoveFor")(page.context.game.getState()), null);

  // A stale answer: the position changed while the AI was thinking.
  const stale = harness();
  const request = stale.run("requestMoveHint()");
  stale.context.game.play(2, 3);
  stale.context.moveCount = 1;
  stale.answer({ row: 3, col: 2 });
  await request;
  assert.equal(stale.context.moveHint, null);
  assert.equal(stale.context.hintPending, null);
  assert.ok(!stale.messages.some(({ text }) => text.startsWith("提示：")));
});

test("illegal, failed and cancelled hint answers", async () => {
  const illegal = harness();
  const first = illegal.run("requestMoveHint()");
  illegal.answer({ row: 0, col: 0 });
  await first;
  assert.equal(illegal.context.moveHint, null);
  assert.deepEqual(illegal.messages.at(-1), { text: "暂时无法计算提示，请稍后再试。", error: true });

  const failed = harness();
  const second = failed.run("requestMoveHint()");
  failed.fail(new Error("worker crashed"));
  await second;
  assert.equal(failed.context.hintPending, null);
  assert.deepEqual(failed.messages.at(-1), { text: "暂时无法计算提示，请稍后再试。", error: true });

  const cancelled = harness();
  const third = cancelled.run("requestMoveHint()");
  cancelled.fail({ code: GAME_AI_ERRORS.CANCELLED });
  await third;
  assert.equal(cancelled.context.hintPending, null);
  assert.equal(cancelled.messages.at(-1).text, "正在为你计算提示…", "a cancelled hint says nothing more");

  // Not the human's turn: nothing is asked.
  const notNow = harness();
  notNow.context.game.play(2, 3);
  await notNow.run("requestMoveHint()");
  assert.equal(notNow.context.lastChoice, undefined);
});

test("a Go hint asks KataGo through the page's worker and accepts a pass", async () => {
  const page = harness({ gameType: "go" });
  const request = page.run("requestMoveHint()");
  assert.equal(page.posted.length, 1);
  const [message] = page.posted;
  assert.equal(message.type, "think");
  assert.equal(message.modelId, "b10");
  assert.equal(message.id, page.context.aiRequestId);
  assert.equal(page.context.aiWorkerContext.kind, "hint");
  assert.equal(page.context.aiWorkerBusy, true);
  assert.ok(message.state && message.options.timeLimitMs > 0);
  page.context.aiWorkerContext.resolve({ type: "play", row: 4, col: 4 });
  await request;
  assert.equal(page.messages.at(-1).text, "提示：AI 建议下在 E5（棋盘上已标出）。");

  // KataGo may suggest passing: Go allows it, so it is named, not drawn.
  const pass = harness({ gameType: "go" });
  const second = pass.run("requestMoveHint()");
  pass.context.aiWorkerContext.resolve({ type: "pass" });
  await second;
  assert.equal(pass.messages.at(-1).text, "提示：AI 建议这一手停一手。");
  assert.equal(pass.run("hintMoveFor")(pass.context.game.getState()), null);

  // Another model loaded in the worker is replaced only when none is.
  const swap = harness({ gameType: "go" });
  swap.context.aiWorker = {};
  swap.context.aiWorkerModelId = "b18";
  swap.run("requestMoveHint()");
  assert.equal(swap.posted[0].modelId, "b18", "the loaded model answers the hint");
  assert.equal(swap.context.terminated, undefined);
  await flush();
});

test("AI moves wait for a full second and for the flip wave, and not when cancelled", () => {
  const page = harness();
  const played = [];
  page.context.clock = 10_000;
  // The AI answered after 200 ms: it waits 800 ms more.
  page.context.clock = 10_200;
  page.run("afterAIPause")(10_000, () => true, () => played.push("first"));
  assert.deepEqual(played, []);
  page.tick(799);
  assert.deepEqual(played, []);
  page.tick(1);
  assert.deepEqual(played, ["first"]);

  // A slow answer plays at once.
  page.context.clock = 20_000;
  page.run("afterAIPause")(18_000, () => true, () => played.push("slow"));
  assert.deepEqual(played, ["first", "slow"]);

  // The human's flip wave ends at 31 s: the AI waits for it plus a beat.
  page.context.clock = 30_000;
  page.context.flipWaveEndsAt = 31_000;
  page.run("afterAIPause")(29_500, () => true, () => played.push("after wave"));
  page.tick(1_100);
  assert.deepEqual(played.at(-1), "slow");
  page.tick(100);
  assert.deepEqual(played.at(-1), "after wave");

  // Cancelled during the pause (an undo, a new game): never played.
  page.context.clock = 40_000;
  page.context.flipWaveEndsAt = 0;
  let wanted = true;
  page.run("afterAIPause")(40_000, () => wanted, () => played.push("cancelled"));
  wanted = false;
  page.tick(2_000);
  assert.ok(!played.includes("cancelled"));
});

test("a flip wave runs only one move on, in the same context", () => {
  const page = harness();
  const step = page.run("isOneMoveOn");
  assert.equal(step({ context: "live", count: 4 }, { context: "live", count: 5 }), true);
  assert.equal(step({ context: "live", count: 5 }, { context: "live", count: 5 }), false, "a redraw");
  assert.equal(step({ context: "live", count: 6 }, { context: "live", count: 5 }), false, "an undo");
  assert.equal(step({ context: "live", count: 3 }, { context: "live", count: 5 }), false, "a jump");
  assert.equal(step({ context: "replay", count: 4 }, { context: "live", count: 5 }), false, "leaving a replay");
  assert.equal(step(null, { context: "live", count: 1 }), false);
  assert.equal(step({ context: "replay", count: 0 }, { context: "replay", count: 1 }), true, "replay forward");
});

test("Go positions keep their hint keys apart by move count and last move", () => {
  const page = harness({ gameType: "go" });
  const key = page.run("hintPositionKey()");
  page.context.game.play(4, 4);
  page.context.moveCount = 1;
  const after = page.run("hintPositionKey()");
  assert.notEqual(after, key);
  page.context.game.undo();
  page.context.moveCount = 0;
  assert.equal(page.run("hintPositionKey()"), key);
  assert.ok(page.context.game instanceof GoEngine || page.context.game.gameType === "go");
});

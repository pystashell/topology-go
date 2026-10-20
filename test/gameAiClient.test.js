import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { attachGameAiWorker } from "../src/ai/fallback/gameAiWorkerHost.js";
import { chooseFallbackMove, fallbackEngineInfo } from "../src/ai/fallback/fallbackAi.js";
import {
  GAME_AI_ERRORS,
  createGameAi,
  gameAiPosition,
  mapWorkerError,
} from "../src/ai/gameAiClient.js";
import {
  GAME_AI_LEVELS,
  gameAiEntry,
  gameAiSettings,
  normalizeGameAiLevel,
  usesGameAiProtocol,
} from "../src/ai/gameAiRegistry.js";
import {
  ALL_AI_MODEL_IDS,
  aiModelGameType,
  aiModelIdsForGame,
  aiSeatName,
  defaultAIModelIdForGame,
  isAIModelIdForGame,
  normalizeGameAIModelId,
} from "../src/ai/modelCatalog.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";

/**
 * A module worker stand-in: the worker side (attachGameAiWorker) runs in
 * this process and messages cross asynchronously in both directions.
 */
class InProcessWorker {
  static created = [];

  constructor(engine) {
    this.listeners = { message: [], error: [], messageerror: [] };
    this.received = [];
    this.terminated = false;
    const scope = {
      listeners: [],
      addEventListener: (type, listener) => {
        if (type === "message") scope.listeners.push(listener);
      },
      postMessage: (data) => {
        setTimeout(() => {
          if (this.terminated) return;
          for (const listener of this.listeners.message) listener({ data: structuredClone(data) });
        }, 0);
      },
    };
    this.scope = scope;
    attachGameAiWorker(scope, engine);
    InProcessWorker.created.push(this);
  }

  addEventListener(type, listener) {
    this.listeners[type].push(listener);
  }

  postMessage(data) {
    this.received.push(data);
    setTimeout(() => {
      if (this.terminated) return;
      for (const listener of this.scope.listeners) listener({ data: structuredClone(data) });
    }, 0);
  }

  crash(message = "boom") {
    for (const listener of this.listeners.error) listener({ message, preventDefault() {} });
  }

  terminate() {
    this.terminated = true;
  }
}

const fallbackEngine = {
  init: async () => fallbackEngineInfo(),
  choose: (position, settings, { signal }) => chooseFallbackMove(position, settings, { signal }),
};

function fakeEntry(engine = fallbackEngine, { fallback = fallbackEngine } = {}) {
  return {
    createWorker: () => new InProcessWorker(engine),
    createFallbackWorker: fallback ? () => new InProcessWorker(fallback) : null,
  };
}

const neverEngine = {
  init: async () => ({ engine: "never" }),
  // Ignores its abort signal and never answers.
  choose: () => new Promise(() => {}),
};

test("the registry names each game's AI and keeps Go on KataGo", () => {
  const go = gameAiEntry("go");
  assert.equal(go.kataGo, true);
  assert.deepEqual(go.modelIds, ["b10", "b18"]);
  assert.equal(go.createWorker, null);
  assert.equal(usesGameAiProtocol("go"), false);

  const gomoku = gameAiEntry("gomoku");
  assert.deepEqual(gomoku.modelIds, ["rapfi"]);
  assert.equal(gomoku.defaultModelId, "rapfi");
  assert.equal(gomoku.displayName("en"), "Rapfi");
  assert.equal(gomoku.displayName("zh-CN"), "Rapfi");
  assert.deepEqual(gomoku.levels, ["easy", "normal", "hard"]);
  assert.equal(usesGameAiProtocol("gomoku"), true);

  const othello = gameAiEntry("othello");
  assert.deepEqual(othello.modelIds, ["topo-othello"]);
  assert.equal(othello.displayName("en"), "Topology Othello AI");
  assert.equal(othello.displayName("zh-CN"), "拓扑黑白棋 AI");
  assert.equal(typeof othello.createWorker, "function");
  assert.equal(typeof othello.createFallbackWorker, "function");

  assert.deepEqual(GAME_AI_LEVELS, ["easy", "normal", "hard"]);
  assert.deepEqual(gameAiSettings("easy"), { level: "easy", timeLimitMs: 300 });
  assert.deepEqual(gameAiSettings("hard"), { level: "hard", timeLimitMs: 4_000 });
  assert.equal(normalizeGameAiLevel("insane"), "normal");
  assert.throws(() => gameAiEntry("chess"), TypeError);
});

test("each game's worker is a one-line choice in the registry", () => {
  const source = readFileSync(new URL("../src/ai/gameAiRegistry.js", import.meta.url), "utf8");
  const workerLines = source.split("\n").filter((line) => /new Worker\(new URL\(/u.test(line));
  // The shared fallback factory plus one line each for Gomoku and Othello.
  assert.equal(workerLines.length, 3);
  for (const line of workerLines) {
    assert.match(line, /new Worker\(new URL\("\.\/[a-z/]+AiWorker\.js", import\.meta\.url\), \{ type: "module" \}\)/u);
  }
  assert.match(source, /"\.\/gomoku\/gomokuAiWorker\.js"/u);
  assert.match(source, /"\.\/othello\/othelloAiWorker\.js"/u);
});

test("model ids belong to exactly one game", () => {
  assert.deepEqual(ALL_AI_MODEL_IDS, ["b10", "b18", "rapfi", "topo-othello"]);
  assert.deepEqual(aiModelIdsForGame("gomoku"), ["rapfi"]);
  assert.deepEqual(aiModelIdsForGame("chess"), []);
  assert.equal(defaultAIModelIdForGame("go"), "b10");
  assert.equal(defaultAIModelIdForGame("othello"), "topo-othello");
  assert.equal(isAIModelIdForGame("rapfi", "gomoku"), true);
  assert.equal(isAIModelIdForGame("rapfi", "go"), false);
  assert.equal(isAIModelIdForGame("b10", "othello"), false);
  assert.equal(normalizeGameAIModelId("b18", "gomoku"), "rapfi");
  assert.equal(normalizeGameAIModelId("b18", "go"), "b18");
  assert.equal(aiModelGameType("topo-othello"), "othello");
  assert.equal(aiModelGameType("nope"), null);
  assert.equal(aiSeatName("b10"), "KataGo b10 AI");
  assert.equal(aiSeatName("rapfi"), "Rapfi AI");
  assert.equal(aiSeatName("topo-othello"), "拓扑黑白棋 AI");
});

test("positions are built from the engine state", () => {
  const game = new GomokuEngine({ width: 13, height: 11, topology: "mobius", ruleSet: "renju" });
  game.play(5, 6);
  const position = gameAiPosition(game, { moveCount: 1 });
  assert.deepEqual(Object.keys(position), [
    "gameType", "ruleSet", "width", "height", "topology", "board", "currentPlayer", "lastMove", "moveCount",
  ]);
  assert.equal(position.ruleSet, "renju");
  assert.equal(position.board.length, 11);
  assert.equal(position.board[0].length, 13);
  assert.deepEqual(position.lastMove, { row: 5, col: 6, color: "black" });
  assert.equal(position.currentPlayer, "white");
  position.board[0][0] = "white";
  assert.equal(game.board[0][0], null, "the position owns its board");

  const othello = gameAiPosition(new OthelloEngine({ width: 8, height: 6, topology: "torus" }));
  assert.equal("ruleSet" in othello, false);
  assert.equal(othello.lastMove, null);
  assert.equal(othello.moveCount, 0);
});

test("init, choose and worker reuse across games", async () => {
  InProcessWorker.created = [];
  const ai = createGameAi("gomoku", { entry: fakeEntry(), idleReleaseMs: 0 });
  const info = await ai.init();
  assert.equal(info.engine, "topology-fallback");
  const first = new GomokuEngine({ width: 11, height: 11 });
  const answer = await ai.choose(gameAiPosition(first), { level: "easy" });
  assert.equal(first.checkPlay(answer.move.row, answer.move.col).ok, true);
  assert.equal(answer.info.source, "fallback");
  // A new game reuses the started worker.
  const second = new GomokuEngine({ width: 15, height: 15, topology: "torus" });
  second.play(7, 7);
  const reply = await ai.choose(gameAiPosition(second, { moveCount: 1 }), { level: "normal" });
  assert.equal(second.checkPlay(reply.move.row, reply.move.col).ok, true);
  assert.equal(InProcessWorker.created.length, 1);
  const sent = InProcessWorker.created[0].received;
  assert.deepEqual(sent.map((message) => message.type), ["init", "choose-move", "choose-move"]);
  assert.deepEqual(sent[1].settings, { level: "easy", timeLimitMs: 300 });
  ai.dispose();
  assert.equal(InProcessWorker.created[0].terminated, true);
});

test("cancel rejects the pending move at once and the worker is reused", async () => {
  InProcessWorker.created = [];
  let release;
  const slowEngine = {
    init: async () => ({ engine: "slow" }),
    choose: (position, settings, { signal }) => new Promise((resolve, reject) => {
      release = () => resolve({ move: { row: 0, col: 0 }, info: {} });
      signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { code: "CANCELLED" })));
    }),
  };
  const ai = createGameAi("othello", { entry: fakeEntry(slowEngine), idleReleaseMs: 0 });
  const position = gameAiPosition(new OthelloEngine());
  const pending = ai.choose(position, { level: "hard" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ai.busy, true);
  assert.equal(ai.cancel(), true);
  await assert.rejects(pending, (error) => error.code === GAME_AI_ERRORS.CANCELLED);
  assert.equal(ai.busy, false);
  const worker = InProcessWorker.created[0];
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(worker.received.at(-1), { type: "cancel", requestId: worker.received[1].requestId });
  // The next request waits for the cancelled one to drain, then reuses the worker.
  const next = ai.choose(position, { level: "easy" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  assert.deepEqual((await next).move, { row: 0, col: 0 });
  assert.equal(InProcessWorker.created.length, 1);
  assert.equal(worker.terminated, false);
  ai.dispose();
});

test("a worker that cannot stop or answer is replaced", async () => {
  InProcessWorker.created = [];
  const ai = createGameAi("gomoku", {
    entry: fakeEntry(neverEngine),
    cancelGraceMs: 20,
    timeoutSlackMs: 0,
    idleReleaseMs: 0,
  });
  const position = gameAiPosition(new GomokuEngine({ width: 11, height: 11 }));
  const cancelled = ai.choose(position, { level: "easy" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  ai.cancel();
  await assert.rejects(cancelled, (error) => error.code === GAME_AI_ERRORS.CANCELLED);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(InProcessWorker.created[0].terminated, true, "a stuck cancel is terminated");

  const timedOut = ai.choose(position, { level: "easy", timeLimitMs: 30 });
  await assert.rejects(timedOut, (error) => error.code === GAME_AI_ERRORS.TIMEOUT);
  assert.equal(InProcessWorker.created.length, 2);
  assert.equal(InProcessWorker.created[1].terminated, true, "a stuck search is terminated");
  ai.dispose();
});

test("worker errors map to client codes; a crash fails the move", async () => {
  assert.equal(mapWorkerError({ code: "CANCELLED" }).code, GAME_AI_ERRORS.CANCELLED);
  assert.equal(mapWorkerError({ code: "NO_LEGAL_MOVE", message: "none" }).code, GAME_AI_ERRORS.NO_LEGAL_MOVE);
  const unknown = mapWorkerError({ code: "WASM_OOM", message: "out of memory" });
  assert.equal(unknown.code, GAME_AI_ERRORS.ENGINE);
  assert.equal(unknown.workerCode, "WASM_OOM");
  assert.equal(unknown.message, "out of memory");

  InProcessWorker.created = [];
  const failing = {
    init: async () => ({ engine: "failing" }),
    choose: async () => {
      throw Object.assign(new Error("no move"), { code: "NO_LEGAL_MOVE" });
    },
  };
  const ai = createGameAi("othello", { entry: fakeEntry(failing), idleReleaseMs: 0 });
  const position = gameAiPosition(new OthelloEngine());
  await assert.rejects(ai.choose(position), (error) => error.code === GAME_AI_ERRORS.NO_LEGAL_MOVE);

  const crashing = createGameAi("othello", { entry: fakeEntry(neverEngine), idleReleaseMs: 0 });
  const crashed = crashing.choose(position);
  await new Promise((resolve) => setTimeout(resolve, 10));
  InProcessWorker.created.at(-1).crash("worker script failed");
  await assert.rejects(crashed, (error) =>
    error.code === GAME_AI_ERRORS.WORKER_FAILED && error.message === "worker script failed");
  ai.dispose();
  crashing.dispose();
});

test("an engine that cannot start hands over to the fallback worker", async () => {
  InProcessWorker.created = [];
  const broken = {
    init: async () => {
      throw Object.assign(new Error("WebAssembly is unavailable"), { code: "WASM_UNAVAILABLE" });
    },
    choose: async () => ({ move: { row: 0, col: 0 }, info: {} }),
  };
  const ai = createGameAi("gomoku", { entry: fakeEntry(broken), idleReleaseMs: 0 });
  const info = await ai.init();
  assert.equal(info.engine, "topology-fallback");
  assert.equal(ai.usingFallback, true);
  assert.equal(InProcessWorker.created.length, 2);
  assert.equal(InProcessWorker.created[0].terminated, true);
  const game = new GomokuEngine({ width: 11, height: 11 });
  const { move } = await ai.choose(gameAiPosition(game));
  assert.equal(game.checkPlay(move.row, move.col).ok, true);
  ai.dispose();

  const noFallback = createGameAi("gomoku", {
    entry: fakeEntry(broken, { fallback: null }),
    idleReleaseMs: 0,
  });
  await assert.rejects(noFallback.init(), (error) => error.code === GAME_AI_ERRORS.ENGINE);
});

test("an idle worker is released after the idle stretch", async () => {
  InProcessWorker.created = [];
  const ai = createGameAi("othello", { entry: fakeEntry(), idleReleaseMs: 20 });
  await ai.choose(gameAiPosition(new OthelloEngine()), { level: "easy" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(InProcessWorker.created[0].terminated, true);
  await ai.choose(gameAiPosition(new OthelloEngine()), { level: "easy" });
  assert.equal(InProcessWorker.created.length, 2, "the next move starts a fresh worker");
  ai.dispose();
});

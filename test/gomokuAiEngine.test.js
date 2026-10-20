import assert from "node:assert/strict";
import test from "node:test";

import { TacticalBoard, BLACK, findVcf } from "../src/ai/gomoku/tactics.js";
import { chooseGomokuMove, getDefaultRapfiEngine } from "../src/ai/gomoku/gomokuAi.js";
import { RAPFI_VERSION, RapfiEngine, rapfiNetworkSupports } from "../src/ai/gomoku/rapfiBridge.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { getTopology } from "../src/topology/index.js";

// Real Rapfi WebAssembly searches in Node. GOMOKU_AI_HEAVY=1 widens the
// random sweep and plays the self-play games at a normal time budget.
const HEAVY = process.env.GOMOKU_AI_HEAVY === "1";

const enginePromise = getDefaultRapfiEngine();

async function engine() {
  const rapfi = await enginePromise;
  assert.ok(rapfi instanceof RapfiEngine, `Rapfi did not load: ${getDefaultRapfiEngine.lastError?.message}`);
  return rapfi;
}

function stones(width, height, { black = [], white = [] }) {
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [row, col] of black) board[row][col] = "black";
  for (const [row, col] of white) board[row][col] = "white";
  return board;
}

function position({ width = 15, height = 15, topology = "cylinder", ruleSet = "freestyle", black = [], white = [], toMove, lastMove = null }) {
  return {
    gameType: "gomoku",
    ruleSet,
    width,
    height,
    topology,
    board: stones(width, height, { black, white }),
    currentPlayer: toMove,
    lastMove,
    moveCount: black.length + white.length,
  };
}

function gameOf(pos) {
  return new GomokuEngine({
    width: pos.width,
    height: pos.height,
    topology: pos.topology,
    ruleSet: pos.ruleSet,
    initialBoard: pos.board,
    currentPlayer: pos.currentPlayer,
  });
}

function assertLegal(pos, move, label = "") {
  const check = gameOf(pos).checkPlay(move.row, move.col);
  assert.equal(check.ok, true, `${label} illegal AI move ${move.row},${move.col}: ${check.reason} ${check.forbidden ?? ""}`);
}

/** Mulberry32: small seeded PRNG so failures reproduce. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random legal, unfinished position: stones mostly near earlier stones. */
function randomPosition(random, { topology, width, height, ruleSet }) {
  const topo = getTopology(topology, width, height);
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  let currentPlayer = "black";
  let lastMove = null;
  const placed = [];
  const target = Math.floor(random() * Math.min(70, width * height * 0.35));
  for (let attempt = 0; placed.length < target && attempt < target * 6; attempt += 1) {
    let row;
    let col;
    if (placed.length > 0 && random() < 0.85) {
      let point = placed[Math.floor(random() * placed.length)];
      for (let step = 1 + Math.floor(random() * 2); step > 0; step -= 1) {
        const around = topo.neighbors8(point.row, point.col);
        point = around[Math.floor(random() * around.length)];
      }
      ({ row, col } = point);
    } else {
      row = Math.floor(random() * height);
      col = Math.floor(random() * width);
    }
    const game = new GomokuEngine({ width, height, topology, ruleSet, initialBoard: board, currentPlayer });
    const result = game.play(row, col);
    if (!result.ok || game.phase !== "play") continue;
    board[row][col] = currentPlayer;
    placed.push({ row, col });
    lastMove = { row, col, color: currentPlayer };
    currentPlayer = currentPlayer === "black" ? "white" : "black";
  }
  return { gameType: "gomoku", ruleSet, width, height, topology, board, currentPlayer, lastMove, moveCount: placed.length };
}

test("Rapfi boots in Node and answers on 15x15 with its network", async () => {
  const rapfi = await engine();
  assert.match(rapfi.command("ABOUT").join("\n"), new RegExp(`version="${RAPFI_VERSION.replace(".", "\\.")}.*WASM_SIMD SINGLE_THREAD`));
  const pos = position({
    black: [[7, 7], [7, 8]],
    white: [[8, 8]],
    toMove: "white",
    lastMove: { row: 7, col: 8, color: "black" },
  });
  // The first search downloads and unpacks the network; time the second.
  await chooseGomokuMove(pos, { level: "normal", timeLimitMs: 300 }, { engine: rapfi, waitForNetwork: true });
  const { move, info } = await chooseGomokuMove(pos, { level: "normal", timeLimitMs: 600 }, { engine: rapfi });
  assertLegal(pos, move);
  assert.equal(info.source, "rapfi");
  assert.equal(info.evaluator, "mix9svq");
  assert.ok(info.depth >= 4, `depth ${info.depth}`);
  assert.ok(info.ms <= 600 * 1.2, `${info.ms} ms`);
});

test("network coverage: freestyle 13-22, Renju 15 only", () => {
  assert.equal(rapfiNetworkSupports("freestyle", 12), false);
  assert.equal(rapfiNetworkSupports("freestyle", 13), true);
  assert.equal(rapfiNetworkSupports("freestyle", 22), true);
  assert.equal(rapfiNetworkSupports("renju", 15), true);
  assert.equal(rapfiNetworkSupports("renju", 19), false);
});

test("with Rapfi in the loop: fives across the cylinder seam, torus seam and Mobius twist", async () => {
  const rapfi = await engine();
  const cases = [
    position({ black: [[7, 12], [7, 13], [7, 14], [7, 0]], white: [[3, 3], [4, 4], [10, 10], [11, 5]], toMove: "black" }),
    position({ topology: "torus", black: [[13, 4], [14, 4], [0, 4], [1, 4]], white: [[7, 7], [7, 8], [8, 8], [9, 2]], toMove: "black" }),
    position({ topology: "mobius", black: [[3, 12], [3, 13], [3, 14], [11, 0]], white: [[7, 7], [6, 6], [8, 9], [2, 2]], toMove: "black" }),
    position({ topology: "mobius", ruleSet: "renju", width: 19, height: 11, black: [[2, 16], [2, 17], [2, 18], [8, 0]], white: [[5, 5], [6, 6], [4, 9], [1, 1]], toMove: "black" }),
  ];
  for (const pos of cases) {
    const { move, info } = await chooseGomokuMove(pos, { level: "hard", timeLimitMs: 500 }, { engine: rapfi });
    const game = gameOf(pos);
    const result = game.play(move.row, move.col);
    assert.equal(result.ok, true);
    assert.equal(game.result?.winner, "black", `${pos.topology}: ${JSON.stringify(move)} ${info.source}`);
  }
});

test("with Rapfi in the loop: blocks a four across the seam and an open three across it", async () => {
  const rapfi = await engine();
  const four = position({
    black: [[7, 13], [7, 14], [7, 0], [7, 1], [9, 9]],
    white: [[7, 12], [3, 3], [4, 4], [10, 10]],
    toMove: "white",
  });
  const blocked = await chooseGomokuMove(four, { level: "normal", timeLimitMs: 400 }, { engine: rapfi });
  assert.deepEqual(blocked.move, { row: 7, col: 2 });

  // Open three 7,14 / 7,0 / 7,1 across the cylinder seam: Rapfi sees it
  // because the cut goes through empty columns, and must stop it.
  const three = position({
    black: [[7, 14], [7, 0], [7, 1]],
    white: [[9, 7], [3, 7]],
    toMove: "white",
    lastMove: { row: 7, col: 1, color: "black" },
  });
  const answer = await chooseGomokuMove(three, { level: "normal", timeLimitMs: 800 }, { engine: rapfi, waitForNetwork: true });
  assertLegal(three, answer.move);
  const game = gameOf(three);
  game.play(answer.move.row, answer.move.col);
  const after = new TacticalBoard({ ...three, board: game.board });
  assert.equal(findVcf(after, BLACK, { maxNodes: 50_000 }).line, null, JSON.stringify(answer));
  assert.equal(answer.move.row, 7, JSON.stringify(answer));
  assert.ok([12, 13, 2, 3].includes(answer.move.col), JSON.stringify(answer));
});

test("Renju: Rapfi never plays Black's forbidden point (double-three bait)", async () => {
  const rapfi = await engine();
  const pos = position({
    ruleSet: "renju",
    black: [[7, 5], [7, 6], [5, 7], [6, 7]],
    white: [[3, 3], [3, 11], [11, 3], [11, 12]],
    toMove: "black",
    lastMove: { row: 11, col: 12, color: "white" },
  });
  assert.equal(gameOf(pos).forbiddenAt(7, 7), "double_three");
  for (const level of ["easy", "normal"]) {
    const { move, info } = await chooseGomokuMove(pos, { level, timeLimitMs: 300 }, { engine: rapfi, waitForNetwork: true });
    assert.notDeepEqual(move, { row: 7, col: 7 }, `${level}: ${JSON.stringify(info)}`);
    assertLegal(pos, move, level);
  }
});

test(`never returns an illegal or forbidden move over ${HEAVY ? 1000 : 200} random positions`, async () => {
  const rapfi = await engine();
  const shapes = [
    ["cylinder", 15, 15], ["torus", 15, 15], ["mobius", 15, 15],
    ["cylinder", 11, 11], ["torus", 11, 11], ["mobius", 11, 11],
    ["cylinder", 19, 11], ["mobius", 19, 11], ["torus", 11, 19],
    ["torus", 25, 25], ["mobius", 25, 25], ["cylinder", 30, 30],
    ["torus", 30, 30], ["mobius", 30, 12], ["cylinder", 22, 22],
  ];
  const random = rng(20261020);
  const count = HEAVY ? 1000 : 200;
  const sources = {};
  for (let index = 0; index < count; index += 1) {
    const [topology, width, height] = shapes[index % shapes.length];
    const ruleSet = index % 3 === 0 ? "freestyle" : "renju";
    const pos = randomPosition(random, { topology, width, height, ruleSet });
    const level = index % 10 === 0 ? "normal" : "easy";
    const { move, info } = await chooseGomokuMove(pos, { level, timeLimitMs: 50 }, { engine: rapfi });
    assertLegal(pos, move, `#${index} ${topology} ${width}x${height} ${ruleSet} ${pos.currentPlayer}`);
    sources[info.source] = (sources[info.source] ?? 0) + 1;
    if (info.source === "heuristic") assert.fail(`#${index}: Rapfi gave no usable move`);
  }
  // Random play leaves many immediate wins and blocks; the rest is Rapfi's.
  assert.ok((sources.rapfi ?? 0) > count / 4, JSON.stringify(sources));
});

for (const [topology, width, height, ruleSet] of [
  ["cylinder", 15, 15, "freestyle"],
  ["torus", 15, 15, "freestyle"],
  ["mobius", 15, 15, "renju"],
  ["cylinder", 19, 11, "freestyle"],
]) {
  test(`AI-vs-AI game to a result: ${topology} ${width}x${height} ${ruleSet}`, async () => {
    const rapfi = await engine();
    const game = new GomokuEngine({ width, height, topology, ruleSet });
    const started = performance.now();
    while (game.phase === "play") {
      const state = game.getState();
      const { move } = await chooseGomokuMove(
        { ...state, moveCount: game.eventCount },
        { level: "normal", timeLimitMs: HEAVY ? 1500 : 60 },
        { engine: rapfi, waitForNetwork: true },
      );
      const result = game.play(move.row, move.col);
      assert.equal(result.ok, true, `move ${game.eventCount}: ${result.reason} ${result.forbidden ?? ""}`);
    }
    assert.ok(game.result.winner === "draw" || game.result.reason === "five", JSON.stringify(game.result));
    assert.ok(performance.now() - started < (HEAVY ? 600_000 : 30_000));
  });
}

test("cancel stops a long search promptly and the engine stays usable", async () => {
  const rapfi = await engine();
  const pos = position({
    black: [[7, 7], [8, 8], [6, 8], [9, 7]],
    white: [[7, 8], [8, 7], [6, 6], [9, 9]],
    toMove: "black",
    lastMove: { row: 9, col: 9, color: "white" },
  });
  const controller = new AbortController();
  const started = performance.now();
  const pending = chooseGomokuMove(pos, { level: "hard", timeLimitMs: 20_000 }, { engine: rapfi, signal: controller.signal, waitForNetwork: true });
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(pending, { code: "CANCELLED" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 300 + 700, `cancel took ${Math.round(elapsed - 300)} ms`);

  const { move } = await chooseGomokuMove(pos, { level: "easy", timeLimitMs: 100 }, { engine: rapfi });
  assertLegal(pos, move);
});

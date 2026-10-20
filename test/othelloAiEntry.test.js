import assert from "node:assert/strict";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import {
  OTHELLO_AI_INFO,
  OTHELLO_DEFAULT_TIME_LIMITS,
  chooseOthelloMove,
  exactEmptiesFor,
  resolveSettings,
} from "../src/ai/othello/othelloAi.js";
import { createRandom } from "../src/ai/othello/othelloGeometry.js";
import { TOPOLOGY_KINDS } from "../src/topology/index.js";

const now = () => performance.now();

function positionOf(engine) {
  return {
    gameType: "othello",
    width: engine.width,
    height: engine.height,
    topology: engine.topology,
    board: engine.getBoard(),
    currentPlayer: engine.currentPlayer,
    lastMove: null,
    moveCount: 0,
  };
}

/** Play `plies` random moves; null if the game ended first. */
function randomGame(topology, width, height, plies, seed) {
  const random = createRandom(seed);
  const engine = new OthelloEngine({ width, height, topology });
  for (let ply = 0; ply < plies && engine.phase === "play"; ply += 1) {
    const legal = engine.legalMoves();
    const move = legal[Math.floor(random() * legal.length)];
    engine.play(move.row, move.col);
  }
  return engine.phase === "play" ? engine : null;
}

function rejectsWith(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

test("othello AI never returns an illegal move (300+ random positions)", async () => {
  const shapes = [
    [6, 6],
    [8, 8],
    [10, 10],
    [8, 12],
    [12, 6],
    [6, 30],
    [20, 20],
    [30, 28],
  ];
  const levels = ["easy", "normal", "hard"];
  let checked = 0;
  for (const topology of TOPOLOGY_KINDS) {
    for (const [width, height] of shapes) {
      const random = createRandom(width * 1009 + height * 17 + topology.length);
      const perShape = width * height <= 144 ? 18 : 7;
      for (let index = 0; index < perShape; index += 1) {
        const cells = width * height;
        const plies = Math.floor(random() * Math.min(cells - 4, 160));
        const engine = randomGame(topology, width, height, plies, Math.floor(random() * 1e9));
        if (!engine) continue;
        const level = levels[checked % 3];
        const { move, info } = await chooseOthelloMove(
          positionOf(engine),
          { level, timeLimitMs: 10 + (checked % 4) * 5 },
          { random },
        );
        const check = engine.checkPlay(move.row, move.col);
        assert.equal(check.ok, true, `${topology} ${width}x${height} ply ${plies}: ${check.reason}`);
        assert.equal(info.engine, "topo-othello");
        assert.equal(info.level, level);
        assert.ok(Number.isFinite(info.ms) && info.ms >= 0);
        assert.ok(Number.isInteger(info.nodes));
        assert.ok(["discs", "heuristic"].includes(info.scoreKind));
        assert.notEqual(info.source, "fallback", info.error);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 300, `checked ${checked} positions`);
});

test("othello AI rejects invalid positions, settings and positions without a move", async () => {
  const engine = new OthelloEngine({ width: 8, height: 8, topology: "torus" });
  const position = positionOf(engine);
  await rejectsWith(chooseOthelloMove(null), "INVALID_POSITION");
  await rejectsWith(chooseOthelloMove({ ...position, gameType: "gomoku" }), "INVALID_POSITION");
  await rejectsWith(chooseOthelloMove({ ...position, width: 7 }), "INVALID_POSITION");
  await rejectsWith(chooseOthelloMove({ ...position, topology: "sphere" }), "INVALID_POSITION");
  await rejectsWith(
    chooseOthelloMove({ ...position, board: position.board.slice(1) }),
    "INVALID_POSITION",
  );
  await rejectsWith(
    chooseOthelloMove({ ...position, currentPlayer: "red" }),
    "INVALID_POSITION",
  );
  await rejectsWith(chooseOthelloMove(position, { level: "insane" }), "INVALID_SETTINGS");
  await rejectsWith(chooseOthelloMove(position, { timeLimitMs: -1 }), "INVALID_SETTINGS");
  // A board with only black discs: White has nothing to flip.
  const board = position.board.map((row) => row.map((value) => (value ? "black" : null)));
  await rejectsWith(
    chooseOthelloMove({ ...position, board, currentPlayer: "white" }),
    "NO_LEGAL_MOVE",
  );
});

test("othello AI settings default to the contract time limits", () => {
  for (const level of ["easy", "normal", "hard"]) {
    assert.equal(resolveSettings({ level }).timeLimitMs, OTHELLO_DEFAULT_TIME_LIMITS[level]);
  }
  assert.deepEqual(OTHELLO_DEFAULT_TIME_LIMITS, { easy: 300, normal: 1500, hard: 4000 });
  assert.equal(resolveSettings({}).level, "normal");
  assert.deepEqual([...OTHELLO_AI_INFO.levels], ["easy", "normal", "hard"]);
  // Hard solves more of the endgame with more time; easy never solves early.
  const hard = (timeLimitMs) =>
    exactEmptiesFor(resolveSettings({ level: "hard", timeLimitMs }), 64, "cylinder");
  assert.ok(hard(4000) > hard(300));
  assert.equal(exactEmptiesFor(resolveSettings({ level: "easy" }), 64, "cylinder"), 0);
});

test("othello AI answers a forced move at once and solves small endgames exactly", async () => {
  // Find positions with exactly one legal move, and with few empties.
  let forced = null;
  let endgame = null;
  for (let seed = 1; seed < 400 && (!forced || !endgame); seed += 1) {
    const random = createRandom(seed);
    const engine = new OthelloEngine({ width: 6, height: 6, topology: TOPOLOGY_KINDS[seed % 3] });
    while (engine.phase === "play") {
      const legal = engine.legalMoves();
      const { black, white } = engine.discs;
      if (!forced && legal.length === 1) forced = OthelloEngine.fromPublicState(engine.getState());
      if (!endgame && 36 - black - white === 8 && legal.length > 1) {
        endgame = OthelloEngine.fromPublicState(engine.getState());
      }
      const move = legal[Math.floor(random() * legal.length)];
      engine.play(move.row, move.col);
    }
  }
  const started = now();
  const only = await chooseOthelloMove(positionOf(forced), { level: "hard", timeLimitMs: 4000 });
  assert.ok(now() - started < 500);
  assert.deepEqual(only.move, forced.legalMoves()[0]);
  assert.equal(only.info.source, "only-move");

  const solved = await chooseOthelloMove(positionOf(endgame), { level: "hard", timeLimitMs: 4000 });
  assert.equal(solved.info.exact, true);
  assert.equal(solved.info.scoreKind, "discs");
  assert.equal(solved.info.source, "endgame");
  assert.ok(["win", "draw", "loss"].includes(solved.info.outcome));
  assert.equal(endgame.checkPlay(solved.move.row, solved.move.col).ok, true);
});

test("othello AI cancels promptly through an AbortSignal", async () => {
  const engine = randomGame("torus", 20, 20, 120, 9);
  const position = positionOf(engine);

  const aborted = new AbortController();
  aborted.abort();
  await rejectsWith(chooseOthelloMove(position, { level: "hard" }, { signal: aborted.signal }), "CANCELLED");

  for (const [topology, size] of [
    ["torus", 20],
    ["cylinder", 8],
  ]) {
    const controller = new AbortController();
    const game = randomGame(topology, size, size, size === 8 ? 16 : 120, 3);
    const search = chooseOthelloMove(positionOf(game), { level: "hard", timeLimitMs: 4000 }, {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const abortedAt = now();
    controller.abort();
    await rejectsWith(search, "CANCELLED");
    const latency = now() - abortedAt;
    assert.ok(latency < 100, `${topology}: cancel took ${latency.toFixed(1)} ms`);
  }
});

test("othello AI respects the time limit within 20%", async () => {
  const cases = [
    { topology: "cylinder", size: 8, plies: 16, level: "hard", timeLimitMs: 800, busy: true },
    { topology: "mobius", size: 8, plies: 20, level: "hard", timeLimitMs: 500, busy: true },
    { topology: "torus", size: 20, plies: 100, level: "hard", timeLimitMs: 600, busy: true },
    { topology: "torus", size: 30, plies: 200, level: "normal", timeLimitMs: 500, busy: false },
    { topology: "cylinder", size: 30, plies: 300, level: "easy", timeLimitMs: 300, busy: false },
  ];
  for (const { topology, size, plies, level, timeLimitMs, busy } of cases) {
    const engine = randomGame(topology, size, size, plies, size + plies);
    const progress = [];
    const started = now();
    const { move, info } = await chooseOthelloMove(
      positionOf(engine),
      { level, timeLimitMs },
      { onProgress: (update) => progress.push(update) },
    );
    const elapsed = now() - started;
    const label = `${level} ${topology} ${size}x${size}: ${elapsed.toFixed(0)} ms of ${timeLimitMs}`;
    assert.ok(elapsed <= timeLimitMs * 1.2, label);
    // A search that cannot finish uses its time.
    if (busy) assert.ok(elapsed >= timeLimitMs * 0.8, label);
    assert.equal(engine.checkPlay(move.row, move.col).ok, true);
    assert.ok(info.depth >= 1, label);
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index].depth >= progress[index - 1].depth);
    }
  }
});

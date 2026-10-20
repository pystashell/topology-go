import assert from "node:assert/strict";
import test from "node:test";

import { buildFlatView } from "../src/ai/gomoku/flatView.js";
import { chooseGomokuMove } from "../src/ai/gomoku/gomokuAi.js";
import { boardRecord } from "../src/ai/gomoku/rapfiBridge.js";
import { BLACK, TacticalBoard, WHITE, findVcf } from "../src/ai/gomoku/tactics.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { getTopology } from "../src/topology/index.js";

// Exact topology-aware tactics and the flat-view adapter, without WASM
// (engine: null plays from tactics alone).

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

/** Play the AI's move on the real topology and return the result. */
function playOn(pos, move) {
  const game = new GomokuEngine({
    width: pos.width,
    height: pos.height,
    topology: pos.topology,
    ruleSet: pos.ruleSet,
    initialBoard: pos.board,
    currentPlayer: pos.currentPlayer,
  });
  const result = game.play(move.row, move.col);
  assert.equal(result.ok, true, `AI move ${move.row},${move.col} is illegal: ${result.reason}`);
  return { game, result };
}

const settings = { level: "normal", timeLimitMs: 400 };

test("takes an immediate five across the cylinder seam", async () => {
  const pos = position({
    black: [[7, 12], [7, 13], [7, 14], [7, 0]],
    white: [[3, 3], [4, 4], [10, 10], [11, 5]],
    toMove: "black",
  });
  const { move, info } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(info.source, "win");
  assert.ok([1, 11].includes(move.col) && move.row === 7, JSON.stringify(move));
  assert.equal(playOn(pos, move).result.result.winner, "black");
});

test("takes an immediate five across the torus top/bottom seam", async () => {
  const pos = position({
    topology: "torus",
    black: [[13, 4], [14, 4], [0, 4], [1, 4]],
    white: [[7, 7], [7, 8], [8, 8], [9, 2]],
    toMove: "black",
  });
  const { move } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.deepEqual([move.col, [2, 12].includes(move.row)], [4, true]);
  assert.equal(playOn(pos, move).result.result.winner, "black");
});

test("takes an immediate five through the Mobius twist (mirrored row)", async () => {
  // (3,14) -> step right crosses the twist to (11,0): row 3 continues as row 11.
  const topology = getTopology("mobius", 15, 15);
  assert.deepEqual(topology.step(3, 14, 0, 1), { row: 11, col: 0, dRow: 0, dCol: 1 });
  const pos = position({
    topology: "mobius",
    black: [[3, 12], [3, 13], [3, 14], [11, 0]],
    white: [[7, 7], [6, 6], [8, 9], [2, 2]],
    toMove: "black",
  });
  const { move, info } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(info.source, "win");
  assert.ok(
    (move.row === 11 && move.col === 1) || (move.row === 3 && move.col === 11),
    JSON.stringify(move),
  );
  assert.equal(playOn(pos, move).result.result.winner, "black");
});

test("a Mobius '/' diagonal continues as '\\' across the twist", async () => {
  // (5,13) -> (4,14) -> crossing: row 15-1-3 = 11, direction flips to down.
  const pos = position({
    topology: "mobius",
    black: [[5, 13], [4, 14], [11, 0], [12, 1]],
    white: [[7, 7], [6, 6], [8, 9], [2, 2]],
    toMove: "black",
  });
  const { move } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.ok(
    (move.row === 6 && move.col === 12) || (move.row === 13 && move.col === 2),
    JSON.stringify(move),
  );
  assert.equal(playOn(pos, move).result.result.winner, "black");
});

test("blocks the opponent's four across the cylinder seam", async () => {
  const pos = position({
    black: [[7, 13], [7, 14], [7, 0], [7, 1], [9, 9]],
    white: [[7, 12], [3, 3], [4, 4], [10, 10]],
    toMove: "white",
  });
  const { move, info } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(info.source, "block");
  assert.deepEqual(move, { row: 7, col: 2 });
});

test("answers an open four across the torus seam at one of its ends", async () => {
  const pos = position({
    topology: "torus",
    black: [[13, 6], [14, 6], [0, 6], [1, 6], [9, 9]],
    white: [[3, 3], [4, 4], [10, 10], [5, 11]],
    toMove: "white",
  });
  const { move } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(move.col, 6);
  assert.ok([2, 12].includes(move.row), JSON.stringify(move));
});

test("Renju Black wins only with exactly five; an overline point is not a win", async () => {
  // Row 7: X X X X _ X -> playing the gap makes six (overline, forbidden).
  const pos = position({
    ruleSet: "renju",
    black: [[7, 2], [7, 3], [7, 4], [7, 5], [7, 7]],
    white: [[7, 1], [3, 3], [4, 4], [10, 10], [11, 11]],
    toMove: "black",
  });
  const board = new TacticalBoard({ ...pos, board: pos.board });
  assert.deepEqual(board.winningPoints(BLACK), []);
  const { move } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.notDeepEqual(move, { row: 7, col: 6 });
  playOn(pos, move);
});

test("Renju: never plays Black's forbidden double-three, even when it looks best", async () => {
  const pos = position({
    ruleSet: "renju",
    black: [[7, 5], [7, 6], [5, 7], [6, 7]],
    white: [[3, 3], [3, 11], [11, 3], [11, 12]],
    toMove: "black",
  });
  const game = new GomokuEngine({ ...pos, initialBoard: pos.board });
  assert.equal(game.forbiddenAt(7, 7), "double_three");
  const { move } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.notDeepEqual(move, { row: 7, col: 7 });
  playOn(pos, move);
});

/** Execute a VCF line on the real engine; the attacker must end up winning. */
function assertVcfWins(pos, attacker, line) {
  const game = new GomokuEngine({ ...pos, initialBoard: pos.board });
  for (const index of line) {
    const row = Math.floor(index / pos.width);
    const result = game.play(row, index % pos.width);
    assert.equal(result.ok, true, `VCF move ${row},${index % pos.width}: ${result.reason} ${result.forbidden ?? ""}`);
    if (game.phase !== "play") break;
  }
  if (game.phase === "play") {
    // The last attacker move left at least one winning point the defender
    // cannot cover: block one (if possible) and win at another.
    const board = new TacticalBoard({ ...pos, board: game.board });
    const color = attacker === "black" ? BLACK : WHITE;
    const defenderPoints = game.currentPlayer === attacker ? [] : board.winningPoints(color);
    if (game.currentPlayer !== attacker) {
      const legalBlock = defenderPoints.find((index) =>
        game.checkPlay(Math.floor(index / pos.width), index % pos.width).ok);
      if (legalBlock === undefined) return; // forbidden block for a Renju Black defender
      game.play(Math.floor(legalBlock / pos.width), legalBlock % pos.width);
    }
    const finish = new TacticalBoard({ ...pos, board: game.board }).winningPoints(color)[0];
    assert.notEqual(finish, undefined, "attacker has no winning point at the end of the VCF");
    game.play(Math.floor(finish / pos.width), finish % pos.width);
  }
  assert.equal(game.result?.winner, attacker);
}

test("finds a VCF whose fours cross the cylinder seam and the four is real", () => {
  // Row 7 across the seam: _ X X X . with White on the far end; column 13 has
  // three stones below a gap. 7,13 makes a four forcing 7,2; then a column
  // four with an open end wins.
  const pos = position({
    black: [[7, 14], [7, 0], [7, 1], [9, 13], [10, 13], [11, 13], [3, 5]],
    white: [[7, 12], [12, 13], [2, 2], [4, 4], [5, 9], [11, 7]],
    toMove: "black",
  });
  const board = new TacticalBoard({ ...pos, board: pos.board });
  const { line } = findVcf(board, BLACK, { maxNodes: 50_000 });
  assert.ok(line, "a VCF exists");
  assertVcfWins(pos, "black", line);
  // The board is restored after the search.
  assert.deepEqual(
    [...board.cells],
    [...new TacticalBoard({ ...pos, board: pos.board }).cells],
  );
});

test("finds a torus VCF and plays it", async () => {
  const pos = position({
    topology: "torus",
    // Column 3 runs over the top/bottom seam (14 -> 0); 2,3 also completes a
    // broken row-2 four.
    black: [[14, 3], [0, 3], [1, 3], [2, 5], [2, 6], [2, 7], [5, 9]],
    white: [[13, 3], [2, 8], [6, 6], [9, 9], [10, 2], [4, 12]],
    toMove: "black",
  });
  const board = new TacticalBoard({ ...pos, board: pos.board });
  const { line } = findVcf(board, BLACK, { maxNodes: 50_000 });
  assert.ok(line);
  assertVcfWins(pos, "black", line);
  const { move, info } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(info.source, "vcf");
  assert.equal(move.row * pos.width + move.col, line[0]);
});

test("a White VCF wins when Black's only block is a Renju forbidden point", () => {
  // White's diagonal four 3,3..6,6 can only be stopped at 7,7 (2,2 is Black),
  // and 7,7 is a double-three for Black.
  const pos = position({
    ruleSet: "renju",
    black: [[7, 5], [7, 6], [5, 7], [6, 7], [2, 2], [8, 8]],
    white: [[4, 4], [5, 5], [6, 6], [12, 2], [2, 12], [12, 12]],
    toMove: "white",
  });
  const board = new TacticalBoard({ ...pos, board: pos.board });
  const { line } = findVcf(board, WHITE, { maxNodes: 50_000 });
  assert.deepEqual(line, [3 * 15 + 3]);
  const game = new GomokuEngine({ ...pos, initialBoard: pos.board });
  game.play(3, 3);
  assert.equal(game.forbiddenAt(7, 7), "double_three");
  assertVcfWins(pos, "white", line);
});

/** A stand-in for RapfiEngine that answers fixed flat-view moves in turn. */
function scriptedEngine(answers) {
  const requests = [];
  return {
    requests,
    networkReady: () => true,
    loadNetwork: async () => {},
    async think(request) {
      requests.push({ ...request, blocks: [...(request.blocks ?? [])] });
      const move = answers[Math.min(requests.length - 1, answers.length - 1)];
      return { move: typeof move === "function" ? move(request) : move, depth: 1, nodes: 1, score: 0, mate: null, evaluator: "scripted" };
    },
  };
}

// Black threatens a VCF across the cylinder seam (7,13 makes a double four).
const vcfThreat = position({
  black: [[7, 14], [7, 0], [7, 1], [9, 13], [10, 13], [11, 13], [3, 5]],
  white: [[7, 12], [12, 13], [2, 2], [4, 4], [5, 9], [11, 7], [1, 9]],
  toMove: "white",
});

test("refutes an opponent VCF across the seam that the engine's move allows", async () => {
  // The engine suggests a far-away move; the defence must replace it.
  const engine = scriptedEngine([(request) => ({ x: 0, y: request.size - 1 })]);
  const { move, info } = await chooseGomokuMove(vcfThreat, { level: "hard", timeLimitMs: 1500 }, { engine });
  assert.equal(info.source, "vcf-defence");
  assert.equal(info.replaced, "rapfi");
  const { game } = playOn(vcfThreat, move);
  const after = new TacticalBoard({ ...vcfThreat, board: game.board });
  assert.equal(findVcf(after, BLACK, { maxNodes: 100_000 }).line, null, JSON.stringify(move));
});

test("an illegal engine answer is blocked and asked again; then falls back", async () => {
  // Black to move under Renju: 7,7 is forbidden (double-three), 7,5 occupied.
  const pos = position({
    ruleSet: "renju",
    black: [[7, 5], [7, 6], [5, 7], [6, 7]],
    white: [[3, 3], [3, 11], [11, 3], [11, 12]],
    toMove: "black",
  });
  // The AI builds the same deterministic view from the same position.
  const view = buildFlatView({
    topology: pos.topology,
    width: pos.width,
    height: pos.height,
    cells: new TacticalBoard({ ...pos, board: pos.board }).cells,
  });
  const flat = (row, col) => {
    const cell = view.toFlat[row * pos.width + col];
    return { x: cell % view.size, y: Math.floor(cell / view.size) };
  };
  const blocked = (request, { x, y }) => request.blocks.some((b) => b.x === x && b.y === y);
  const engine = scriptedEngine([flat(7, 7), flat(7, 5), flat(0, 0)]);
  const { move, info } = await chooseGomokuMove(pos, { level: "easy", timeLimitMs: 300 }, { engine });
  assert.equal(info.source, "rapfi");
  assert.deepEqual(move, { row: 0, col: 0 });
  assert.equal(engine.requests.length, 3);
  // Black's Renju forbidden point is blocked from the first request on, and
  // every rejected answer is blocked in the next one.
  assert.ok(blocked(engine.requests[0], flat(7, 7)));
  assert.ok(!blocked(engine.requests[1], flat(7, 5)));
  assert.ok(blocked(engine.requests[2], flat(7, 5)));
  playOn(pos, move);

  const stubborn = scriptedEngine([{ x: 99, y: 99 }]);
  const fallback = await chooseGomokuMove(pos, { level: "easy", timeLimitMs: 300 }, { engine: stubborn });
  assert.equal(fallback.info.source, "heuristic");
  assert.equal(stubborn.requests.length, 3);
  playOn(pos, fallback.move);
});

test("flat view: a cylinder cut falls in the emptiest columns", () => {
  const width = 15;
  const height = 15;
  const black = [];
  for (let col = 0; col <= 8; col += 1) black.push([7, col], [8, (col + 1) % width]);
  const pos = position({ black, toMove: "white" });
  const board = new TacticalBoard({ ...pos, board: pos.board });
  const view = buildFlatView({ topology: "cylinder", width, height, cells: board.cells });
  assert.equal(view.size, 15);
  for (const [row, col] of black) {
    const flat = view.toFlat[row * width + col];
    const x = flat % view.size;
    assert.ok(x >= 2 && x <= 12, `stone ${row},${col} sits at view column ${x}`);
  }
});

test("flat view: neighbours in the view are neighbours on every topology", () => {
  const cases = [
    ["cylinder", 15, 15], ["torus", 15, 15], ["mobius", 15, 15],
    ["cylinder", 19, 11], ["mobius", 19, 11], ["torus", 11, 19],
    ["cylinder", 25, 25], ["torus", 30, 30], ["mobius", 30, 30], ["mobius", 30, 12],
  ];
  for (const [kind, width, height] of cases) {
    const topology = getTopology(kind, width, height);
    const cells = new Int8Array(width * height);
    // Stones on and around the column seam, so the chosen cut is non-trivial.
    for (const index of [0, width - 1, 2 * width + 1, 5 * width + width - 2, 7 * width + 3]) cells[index] = 1;
    const view = buildFlatView({ topology: kind, width, height, cells, lastMove: 0 });
    assert.equal(view.size, Math.max(Math.min(width, 22), Math.min(height, 22)));
    const seen = new Set();
    for (let flat = 0; flat < view.toBoard.length; flat += 1) {
      const index = view.toBoard[flat];
      const x = flat % view.size;
      const y = Math.floor(flat / view.size);
      if (x >= view.width || y >= view.height) {
        assert.equal(index, -1);
        continue;
      }
      assert.ok(index >= 0 && !seen.has(index), `${kind} ${width}x${height}: cell used twice`);
      seen.add(index);
      assert.equal(view.toFlat[index], flat);
      const point = topology.point(index);
      // Horizontal view steps are exactly topology steps to the right.
      if (x + 1 < view.width) {
        const next = topology.point(view.toBoard[flat + 1]);
        const step = topology.step(point.row, point.col, 0, 1);
        assert.deepEqual([step.row, step.col], [next.row, next.col]);
      }
      // Every view neighbour (including diagonals) is a board neighbour.
      for (const [dy, dx] of [[1, 0], [1, 1], [1, -1]]) {
        if (y + dy >= view.height || x + dx < 0 || x + dx >= view.width) continue;
        const other = topology.point(view.toBoard[(y + dy) * view.size + x + dx]);
        assert.ok(
          topology.neighbors8(point.row, point.col).some((cell) => cell.row === other.row && cell.col === other.col),
          `${kind} ${width}x${height}: view neighbours ${point.row},${point.col} / ${other.row},${other.col}`,
        );
      }
    }
    assert.equal(seen.size, Math.min(width, 22) * Math.min(height, 22));
    // The last move is in the view, away from its cuts.
    const last = view.toFlat[0];
    assert.ok(last >= 0);
  }
});

test("flat view: a window on a large torus centres on the action", () => {
  const width = 30;
  const height = 30;
  const cells = new Int8Array(width * height);
  const stonesAt = [[0, 0], [29, 29], [1, 1], [28, 0], [0, 28]];
  for (const [row, col] of stonesAt) cells[row * width + col] = 1;
  const view = buildFlatView({ topology: "torus", width, height, cells, lastMove: 1 * width + 1 });
  assert.equal(view.size, 22);
  for (const [row, col] of stonesAt) {
    const flat = view.toFlat[row * width + col];
    assert.ok(flat >= 0, `stone ${row},${col} is in the window`);
    const x = flat % 22;
    const y = Math.floor(flat / 22);
    assert.ok(x >= 4 && x <= 17 && y >= 4 && y <= 17, `stone ${row},${col} at ${x},${y}`);
  }
});

test("Rapfi BOARD record starts with Black, alternates, never passes twice", () => {
  const check = (stonesList, toMove) => {
    const record = boardRecord(stonesList, toMove);
    assert.equal(record[0]?.color ?? "black", "black");
    for (let index = 1; index < record.length; index += 1) {
      assert.notEqual(record[index].color, record[index - 1].color);
      assert.ok(!(record[index].pass && record[index - 1].pass));
    }
    const next = record.length % 2 === 0 ? "black" : "white";
    assert.equal(next, toMove);
    assert.equal(record.filter((entry) => !entry.pass).length, stonesList.length);
  };
  const b = (x) => ({ x, y: 0, color: "black" });
  const w = (x) => ({ x, y: 1, color: "white" });
  check([], "black");
  check([], "white");
  check([b(1)], "white");
  check([b(1)], "black");
  check([w(1), w(2), w(3)], "black");
  check([w(1), w(2), w(3)], "white");
  check([b(1), b(2), b(3), w(4)], "white");
  check([b(1), w(2), b(3), w(4)], "black");
});

test("tactics alone always answer with a legal move", async () => {
  const pos = position({ width: 11, height: 11, ruleSet: "renju", toMove: "black" });
  const { move, info } = await chooseGomokuMove(pos, settings, { engine: null });
  assert.equal(info.source, "opening");
  assert.deepEqual(move, { row: 5, col: 5 });
  // Without Rapfi a non-empty position is answered from tactics.
  const later = position({ ruleSet: "renju", black: [[7, 7]], white: [[8, 8]], toMove: "black" });
  const reply = await chooseGomokuMove(later, settings, { engine: null });
  assert.equal(reply.info.source, "tactics");
  playOn(later, reply.move);
});

test("rejects malformed positions and honours an aborted signal", async () => {
  await assert.rejects(
    chooseGomokuMove({ gameType: "othello" }, settings, { engine: null }),
    { code: "BAD_POSITION" },
  );
  await assert.rejects(
    chooseGomokuMove(position({ toMove: "black", width: 9, height: 9 }), settings, { engine: null }),
    { code: "BAD_POSITION" },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    chooseGomokuMove(position({ toMove: "black" }), settings, { engine: null, signal: controller.signal }),
    { code: "CANCELLED" },
  );
});

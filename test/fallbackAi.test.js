import assert from "node:assert/strict";
import test from "node:test";

import { chooseFallbackMove, fallbackEngineInfo } from "../src/ai/fallback/fallbackAi.js";
import { gameAiPosition } from "../src/ai/gameAiClient.js";
import { GomokuEngine } from "../src/game/gomokuEngine.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";

const TOPOLOGIES = ["cylinder", "torus", "mobius"];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function gomoku({ width = 15, height = 15, topology = "cylinder", ruleSet = "freestyle", stones = [], toMove = "black" }) {
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [row, col, color] of stones) board[row][col] = color;
  return {
    gameType: "gomoku", ruleSet, width, height, topology, board,
    currentPlayer: toMove, lastMove: null, moveCount: stones.length,
  };
}

test("the fallback engine describes itself and its levels", () => {
  assert.deepEqual(fallbackEngineInfo(), {
    engine: "topology-fallback", version: "1", license: "first-party",
    levels: ["easy", "normal", "hard"],
  });
});

test("Gomoku: the fallback completes a five across the cylinder seam", async () => {
  // Black holds 13, 14, 0, 1 on row 7 of a 15-wide cylinder: 12 or 2 wins.
  const position = gomoku({
    stones: [[7, 13, "black"], [7, 14, "black"], [7, 0, "black"], [7, 1, "black"],
      [3, 3, "white"], [3, 4, "white"], [3, 5, "white"], [9, 9, "white"]],
  });
  for (const level of ["easy", "normal", "hard"]) {
    const { move, info } = await chooseFallbackMove(position, { level });
    assert.equal(move.row, 7);
    assert.ok([12, 2].includes(move.col), `${level}: ${move.col}`);
    assert.equal(info.engine, "topology-fallback");
    assert.equal(info.source, "fallback");
    assert.ok(Number.isFinite(info.ms));
  }
});

test("Gomoku: the fallback blocks the opponent's five across a torus edge", async () => {
  // White threatens rows 12, 13, 14, 0 of column 4 on a 15x15 torus.
  const position = gomoku({
    topology: "torus",
    stones: [[12, 4, "white"], [13, 4, "white"], [14, 4, "white"], [0, 4, "white"],
      [7, 7, "black"], [7, 8, "black"], [8, 7, "black"]],
  });
  for (const level of ["easy", "normal", "hard"]) {
    const { move } = await chooseFallbackMove(position, { level });
    assert.equal(move.col, 4, level);
    assert.ok([11, 1].includes(move.row), `${level}: ${move.row}`);
  }
});

test("Gomoku: the fallback blocks across a Möbius seam into the mirrored row", async () => {
  // On a Möbius strip, row 3 continues as row height-1-3 = 11 past the seam.
  const position = gomoku({
    topology: "mobius",
    stones: [[3, 12, "white"], [3, 13, "white"], [3, 14, "white"], [11, 0, "white"],
      [7, 7, "black"], [6, 6, "black"], [8, 9, "black"]],
  });
  const engine = new GomokuEngine({
    width: 15, height: 15, topology: "mobius", initialBoard: position.board, currentPlayer: "white",
  });
  const winning = engine.legalMoves().filter(({ row, col }) => {
    const copy = new GomokuEngine({
      width: 15, height: 15, topology: "mobius", initialBoard: position.board, currentPlayer: "white",
    });
    copy.play(row, col);
    return copy.result?.reason === "five";
  });
  assert.ok(winning.length > 0, "the fixture threatens a five");
  const { move } = await chooseFallbackMove(position, { level: "normal" });
  assert.ok(
    winning.some(({ row, col }) => row === move.row && col === move.col),
    `blocked at ${JSON.stringify(move)}`,
  );
});

test("Gomoku Renju: Black never chooses a forbidden point", async () => {
  // (7,7) is a double three for Black (plan R1) and the most attractive point.
  const position = gomoku({
    ruleSet: "renju",
    stones: [[7, 5, "black"], [7, 6, "black"], [5, 7, "black"], [6, 7, "black"],
      [0, 0, "white"], [0, 14, "white"], [14, 0, "white"], [14, 14, "white"]],
  });
  const engine = new GomokuEngine({
    width: 15, height: 15, ruleSet: "renju", initialBoard: position.board, currentPlayer: "black",
  });
  assert.equal(engine.forbiddenAt(7, 7), "double_three");
  for (const level of ["easy", "normal", "hard"]) {
    const random = seeded(7);
    for (let trial = 0; trial < 5; trial += 1) {
      const { move } = await chooseFallbackMove(position, { level }, { random });
      assert.equal(engine.checkPlay(move.row, move.col).ok, true, `${level} ${JSON.stringify(move)}`);
    }
  }
});

test("Gomoku: self-play ends with a result on every topology and rule set", async () => {
  for (const topology of TOPOLOGIES) {
    for (const ruleSet of ["freestyle", "renju"]) {
      const game = new GomokuEngine({ width: 11, height: 11, topology, ruleSet });
      const random = seeded(topology.length * 31 + ruleSet.length);
      let moves = 0;
      while (game.phase === "play" && moves < 121) {
        const level = moves % 2 === 0 ? "normal" : "hard";
        const { move } = await chooseFallbackMove(
          gameAiPosition(game, { moveCount: moves }),
          { level, timeLimitMs: 200 },
          { random },
        );
        assert.equal(game.play(move.row, move.col).ok, true);
        moves += 1;
      }
      assert.equal(game.phase, "finished", `${topology} ${ruleSet}`);
      assert.ok(game.result, `${topology} ${ruleSet}`);
    }
  }
});

test("Othello: the fallback plays only legal moves and finishes games on every topology", async () => {
  for (const topology of TOPOLOGIES) {
    const game = new OthelloEngine({ width: 8, height: 6, topology });
    const random = seeded(topology.length);
    let moves = 0;
    while (game.phase === "play" && moves < 200) {
      const level = ["easy", "normal", "hard"][moves % 3];
      const position = gameAiPosition(game, { moveCount: moves });
      const { move, info } = await chooseFallbackMove(position, { level, timeLimitMs: 300 }, { random });
      assert.equal(info.engine, "topology-fallback");
      const played = game.play(move.row, move.col);
      assert.equal(played.ok, true, `${topology} move ${moves}`);
      assert.ok(played.flipped.length >= 1);
      moves += 1;
    }
    assert.equal(game.phase, "finished", topology);
    assert.equal(game.result.reason, "discs");
  }
});

test("Othello: the fallback prefers a move that leaves the opponent without a reply", async () => {
  // White to move on a 6x6 cylinder; (0,3) wipes out every black disc in reach
  // so that Black must pass, which a mobility-first engine prefers.
  const board = Array.from({ length: 6 }, () => Array(6).fill(null));
  board[0][0] = "white";
  board[0][1] = "black";
  board[0][2] = "black";
  board[5][5] = "white";
  const position = {
    gameType: "othello", width: 6, height: 6, topology: "cylinder", board,
    currentPlayer: "white", lastMove: null, moveCount: 0,
  };
  const { move } = await chooseFallbackMove(position, { level: "normal" });
  assert.deepEqual(move, { row: 0, col: 3 });
});

test("the fallback rejects malformed positions and honours cancellation", async () => {
  await assert.rejects(
    chooseFallbackMove({ gameType: "chess" }),
    (error) => error.code === "BAD_POSITION",
  );
  await assert.rejects(
    chooseFallbackMove({ ...gomoku({}), board: [[null]] }),
    (error) => error.code === "BAD_POSITION",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    chooseFallbackMove(gomoku({}), {}, { signal: controller.signal }),
    (error) => error.code === "CANCELLED",
  );
  const full = new OthelloEngine({ width: 6, height: 6 });
  const position = gameAiPosition(full);
  position.currentPlayer = "black";
  position.board = position.board.map((row) => row.map(() => "black"));
  await assert.rejects(chooseFallbackMove(position), (error) => error.code === "NO_LEGAL_MOVE");
});

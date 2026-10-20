import assert from "node:assert/strict";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import { OthelloBoard } from "../src/ai/othello/othelloBoard.js";
import { createRandom, getOthelloGeometry } from "../src/ai/othello/othelloGeometry.js";
import { DIRECTIONS_8, TOPOLOGY_KINDS, getTopology } from "../src/topology/index.js";

const SHAPES = [
  [6, 6],
  [8, 8],
  [10, 10],
  [14, 14],
  [20, 20],
  [30, 30],
  [6, 10],
  [8, 12],
  [12, 6],
  [6, 30],
  [30, 6],
  [10, 28],
];

function sideOf(color) {
  return color === "black" ? 1 : 2;
}

function sortedCells(points, width) {
  return points.map(({ row, col }) => row * width + col).sort((a, b) => a - b);
}

function boardMoves(board, side) {
  const moves = new Int16Array(board.cellCount);
  const count = board.generateMoves(side, moves);
  return Array.from(moves.subarray(0, count)).sort((a, b) => a - b);
}

function snapshot(board) {
  const empties = Array.from(board.emptyList.subarray(0, board.emptyCount));
  return {
    cells: Array.from(board.cells),
    counts: Array.from(board.counts),
    empties,
    emptyPos: empties.map((cell) => board.emptyPos[cell]),
    occupied: Array.from(board.occupiedNeighbors),
    classes: Array.from(board.classCounts),
    lineEmpty: Array.from(board.lineEmpty),
    fullLines: board.fullLines,
    hash: [board.hashLo, board.hashHi],
    flipTop: board.flipTop,
    moveTop: board.moveTop,
  };
}

test("othello AI rays follow topology.ray for every cell and direction", () => {
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of [
      [6, 6],
      [8, 12],
      [12, 6],
      [10, 10],
    ]) {
      const topology = getTopology(kind, width, height);
      const geometry = getOthelloGeometry(kind, width, height);
      for (let cell = 0; cell < geometry.cellCount; cell += 1) {
        const row = Math.floor(cell / width);
        DIRECTIONS_8.forEach(([dRow, dCol], direction) => {
          const expected = topology
            .ray(row, cell % width, dRow, dCol)
            .cells.map((point) => point.row * width + point.col);
          const start = geometry.rayStart[cell * 8 + direction];
          const end = geometry.rayStart[cell * 8 + direction + 1];
          assert.deepEqual(
            Array.from(geometry.rayCells.subarray(start, end)),
            expected,
            `${kind} ${width}x${height} cell ${cell} direction ${direction}`,
          );
        });
      }
    }
  }
});

test("othello AI moves, flips and passes match OthelloEngine on every topology and size", () => {
  let positions = 0;
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of SHAPES) {
      const geometry = getOthelloGeometry(kind, width, height);
      const random = createRandom(width * 131 + height * 7 + kind.length);
      const games = width * height <= 100 ? 3 : 1;
      // Big boards: a long opening stretch is enough to exercise wrapping.
      const maxPlies = width * height <= 144 ? Infinity : 90;
      for (let game = 0; game < games; game += 1) {
        const engine = new OthelloEngine({ width, height, topology: kind });
        const board = new OthelloBoard(geometry);
        board.loadRows(engine.board);
        let plies = 0;
        while (engine.phase === "play" && plies < maxPlies) {
          const side = sideOf(engine.currentPlayer);
          const legal = engine.legalMoves();
          assert.deepEqual(
            boardMoves(board, side),
            sortedCells(legal, width),
            `${kind} ${width}x${height} ply ${plies}`,
          );
          assert.equal(board.countMoves(side), legal.length);
          assert.equal(board.hasMove(side), true);
          // Every few plies compare the flips of every legal move.
          const checkAll = plies % 7 === 0;
          for (const move of checkAll ? legal : []) {
            const cell = move.row * width + move.col;
            const before = snapshot(board);
            const expected = sortedCells(engine.checkPlay(move.row, move.col).flipped, width);
            assert.equal(board.countFlips(cell, side), expected.length);
            assert.equal(board.makeMove(cell, side), expected.length);
            assert.deepEqual(board.lastFlips().sort((a, b) => a - b), expected);
            board.unmakeMove(side);
            assert.deepEqual(snapshot(board), before);
          }
          const move = legal[Math.floor(random() * legal.length)];
          const cell = move.row * width + move.col;
          const result = engine.play(move.row, move.col);
          const flipped = board.makeMove(cell, side);
          assert.equal(flipped, result.flipped.length);
          assert.deepEqual(
            board.lastFlips().sort((a, b) => a - b),
            sortedCells(result.flipped, width),
          );
          // Rows of the internal board equal the engine's.
          for (let row = 0; row < height; row += 1) {
            for (let col = 0; col < width; col += 1) {
              const value = engine.board[row][col];
              assert.equal(
                board.cells[row * width + col],
                value === "black" ? 1 : value === "white" ? 2 : 0,
              );
            }
          }
          // Automatic passes: the opponent moves next iff it can.
          const opponent = 3 - side;
          if (board.hasMove(opponent)) {
            assert.equal(engine.currentPlayer, opponent === 1 ? "black" : "white");
            assert.equal(result.skipped, null);
          } else if (board.hasMove(side)) {
            assert.equal(engine.currentPlayer, side === 1 ? "black" : "white");
            assert.equal(result.skipped, opponent === 1 ? "black" : "white");
          } else {
            assert.equal(engine.phase, "finished");
          }
          assert.deepEqual([board.counts[1], board.counts[2]], [
            engine.discs.black,
            engine.discs.white,
          ]);
          positions += 1;
          plies += 1;
        }
      }
    }
  }
  assert.ok(positions > 3000, `checked ${positions} positions`);
});

test("othello AI make/unmake restores cells, counts, lists, lines and hash", () => {
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of [
      [6, 6],
      [8, 8],
      [8, 12],
      [20, 20],
    ]) {
      const geometry = getOthelloGeometry(kind, width, height);
      const random = createRandom(97 * width + height + kind.length);
      for (let trial = 0; trial < 3; trial += 1) {
        const engine = new OthelloEngine({ width, height, topology: kind });
        const board = new OthelloBoard(geometry);
        board.loadRows(engine.board);
        const stack = [];
        let side = 1;
        const moves = new Int16Array(board.cellCount);
        // Go deep, recording every state, then unwind.
        for (let ply = 0; ply < 40; ply += 1) {
          let count = board.generateMoves(side, moves);
          if (count === 0) {
            side = 3 - side;
            count = board.generateMoves(side, moves);
            if (count === 0) break;
          }
          stack.push({ state: snapshot(board), side });
          board.makeMove(moves[Math.floor(random() * count)], side);
          const [lo, hi] = board.computeHash();
          assert.deepEqual([board.hashLo, board.hashHi], [lo, hi]);
          side = 3 - side;
        }
        while (stack.length > 0) {
          const { state, side: mover } = stack.pop();
          board.unmakeMove(mover);
          assert.deepEqual(snapshot(board), state);
        }
      }
    }
  }
});

test("othello AI lean moves and flip counts agree with full moves", () => {
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of [
      [6, 6],
      [8, 8],
      [6, 12],
    ]) {
      const geometry = getOthelloGeometry(kind, width, height);
      const random = createRandom(3 * width + height + kind.length);
      const board = new OthelloBoard(geometry);
      const engine = new OthelloEngine({ width, height, topology: kind });
      board.loadRows(engine.board);
      while (engine.phase === "play") {
        const side = sideOf(engine.currentPlayer);
        const before = snapshot(board);
        for (let cell = 0; cell < board.cellCount; cell += 1) {
          if (board.cells[cell] !== 0) continue;
          const expected = board.countFlips(cell, side);
          assert.equal(board.isLegalLean(cell, side), expected > 0);
          assert.equal(board.isLegal(cell, side), expected > 0);
          if (expected === 0) continue;
          assert.equal(board.makeMoveLean(cell, side), expected);
          board.unmakeMoveLean(side);
          assert.deepEqual(snapshot(board), before);
        }
        const legal = engine.legalMoves();
        const move = legal[Math.floor(random() * legal.length)];
        engine.play(move.row, move.col);
        board.makeMove(move.row * width + move.col, side);
      }
    }
  }
});

test("othello AI stable discs never flip later", () => {
  let stableSeen = 0;
  for (const kind of TOPOLOGY_KINDS) {
    for (const [width, height] of [
      [6, 6],
      [8, 8],
      [6, 10],
    ]) {
      const geometry = getOthelloGeometry(kind, width, height);
      for (let game = 0; game < 12; game += 1) {
        const random = createRandom(1000 * game + width * 7 + kind.length);
        const engine = new OthelloEngine({ width, height, topology: kind });
        const board = new OthelloBoard(geometry);
        board.loadRows(engine.board);
        const stableAt = new Map();
        const counts = new Int32Array(3);
        while (engine.phase === "play") {
          board.loadRows(engine.board);
          board.stableDiscs(counts);
          for (let cell = 0; cell < board.cellCount; cell += 1) {
            if (board.stableMark[cell] === board.stableStamp && board.fullLines > 0) {
              if (!stableAt.has(cell)) stableAt.set(cell, board.cells[cell]);
            }
          }
          for (const [cell, color] of stableAt) {
            assert.equal(board.cells[cell], color, `${kind} ${width}x${height} cell ${cell}`);
          }
          const legal = engine.legalMoves();
          const move = legal[Math.floor(random() * legal.length)];
          engine.play(move.row, move.col);
        }
        stableSeen += stableAt.size;
      }
    }
  }
  assert.ok(stableSeen > 100, `saw ${stableSeen} stable discs`);
});

import assert from "node:assert/strict";
import test from "node:test";

import { OthelloEngine } from "../src/game/othelloEngine.js";
import { OthelloBoard } from "../src/ai/othello/othelloBoard.js";
import { getOthelloGeometry } from "../src/ai/othello/othelloGeometry.js";
import { getTopology } from "../src/topology/index.js";

/*
 * An independent Othello reference, written from the boards' definitions and
 * not from src/topology, so a mistake there cannot hide in both sides.
 *
 * Every board is a window onto an unrolled "cover" plane:
 *   - cylinder: the cover repeats left and right; rows end at the top and
 *     bottom edges;
 *   - torus: the cover repeats in both directions;
 *   - Mobius strip: the cover repeats left and right, and every second copy
 *     is the strip turned over (rows mirrored top to bottom); rows end at the
 *     edges.
 * A ray from a point is then a plain straight line on the cover, read back
 * on the board cell by cell. It ends at an edge, or just before it would
 * come back to the start point. Discs reached from several directions flip
 * once; a move must flip something; a side without a move is skipped; the
 * game ends when neither side can move.
 */

const BLACK = "black";
const WHITE = "white";
const KINDS = ["cylinder", "torus", "mobius"];
const DIRECTIONS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const mod = (value, size) => ((value % size) + size) % size;
const other = (color) => (color === BLACK ? WHITE : BLACK);

/** The board cell under cover point (R, C), or null past an edge. */
function coverCell(kind, width, height, R, C) {
  if (kind === "torus") return { row: mod(R, height), col: mod(C, width) };
  if (R < 0 || R >= height) return null;
  const col = mod(C, width);
  if (kind === "cylinder") return { row: R, col };
  const turnedOver = mod(Math.floor(C / width), 2) === 1;
  return { row: turnedOver ? height - 1 - R : R, col };
}

/**
 * The cells of a ray, with how it got there: whether it crossed the left or
 * right seam, wrapped top to bottom (torus), or ran on a turned-over copy
 * (Mobius).
 */
function referenceRay(kind, width, height, row, col, dRow, dCol) {
  const cells = [];
  for (let step = 1; ; step += 1) {
    const R = row + step * dRow;
    const C = col + step * dCol;
    const cell = coverCell(kind, width, height, R, C);
    if (!cell) return { cells, end: "edge" };
    if (cell.row === row && cell.col === col) return { cells, end: "start" };
    cells.push({
      ...cell,
      seam: C < 0 || C >= width,
      wrap: R < 0 || R >= height,
      turned: kind === "mobius" && mod(Math.floor(C / width), 2) === 1,
    });
    if (step > 4 * width * height) throw new Error("a ray never ended");
  }
}

/** Discs `color` flips at an empty point, and how the flipped runs travelled. */
function referenceMove(position, row, col, color) {
  const { kind, width, height, board } = position;
  const flips = new Map();
  const how = { seam: false, wrap: false, turned: false, loopOfOpponents: false };
  for (const [dRow, dCol] of DIRECTIONS) {
    const ray = referenceRay(kind, width, height, row, col, dRow, dCol);
    const run = [];
    let bracketed = false;
    for (const cell of ray.cells) {
      const value = board[cell.row][cell.col];
      if (value === other(color)) {
        run.push(cell);
        continue;
      }
      bracketed = value === color && run.length > 0;
      break;
    }
    // A whole loop of opponent discs back to the start flips nothing.
    if (!bracketed && run.length === ray.cells.length && ray.end === "start" && run.length > 0) {
      how.loopOfOpponents = true;
    }
    if (!bracketed) continue;
    for (const cell of run) {
      flips.set(cell.row * width + cell.col, cell);
      how.seam ||= cell.seam;
      how.wrap ||= cell.wrap;
      how.turned ||= cell.turned;
    }
  }
  return { flips: [...flips.keys()].sort((a, b) => a - b), how };
}

function referenceLegal(position, color) {
  const legal = [];
  for (let row = 0; row < position.height; row += 1) {
    for (let col = 0; col < position.width; col += 1) {
      if (position.board[row][col] === null && referenceMove(position, row, col, color).flips.length) {
        legal.push(row * position.width + col);
      }
    }
  }
  return legal;
}

function startPosition(kind, width, height) {
  const board = Array.from({ length: height }, () => Array(width).fill(null));
  const top = height / 2 - 1;
  const left = width / 2 - 1;
  board[top][left] = WHITE;
  board[top][left + 1] = BLACK;
  board[top + 1][left] = BLACK;
  board[top + 1][left + 1] = WHITE;
  return { kind, width, height, board, toMove: BLACK, over: false };
}

/** Play a legal move; return what happened next. */
function referencePlay(position, cell) {
  const { width } = position;
  const row = Math.floor(cell / width);
  const col = cell % width;
  const color = position.toMove;
  const { flips, how } = referenceMove(position, row, col, color);
  assert.ok(flips.length > 0, "reference: illegal move");
  position.board[row][col] = color;
  for (const flipped of flips) position.board[Math.floor(flipped / width)][flipped % width] = color;
  let skipped = null;
  if (referenceLegal(position, other(color)).length) {
    position.toMove = other(color);
  } else if (referenceLegal(position, color).length) {
    skipped = other(color);
  } else {
    position.over = true;
  }
  return { flips, how, skipped };
}

function discCount(board) {
  let black = 0;
  let white = 0;
  for (const row of board) for (const value of row) {
    if (value === BLACK) black += 1;
    if (value === WHITE) white += 1;
  }
  return { black, white };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a move: random, most flips, fewest flips, or the move that leaves
 * the opponent the fewest replies (which drives games into skips and early
 * endings).
 */
function chooseMove(position, legal, random) {
  const style = random();
  if (style < 0.4) return legal[Math.floor(random() * legal.length)];
  const scored = legal.map((cell) => {
    const row = Math.floor(cell / position.width);
    const col = cell % position.width;
    const { flips } = referenceMove(position, row, col, position.toMove);
    let score;
    if (style < 0.55) score = flips.length;
    else if (style < 0.7) score = -flips.length;
    else {
      const trial = { ...position, board: position.board.map((line) => [...line]) };
      trial.board[row][col] = position.toMove;
      for (const flipped of flips) {
        trial.board[Math.floor(flipped / position.width)][flipped % position.width] = position.toMove;
      }
      score = -referenceLegal(trial, other(position.toMove)).length;
    }
    return { cell, score: score + random() * 0.5 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].cell;
}

const coverage = {
  games: 0,
  moves: 0,
  skips: 0,
  skipsInARow: 0,
  blockedWithEmpties: 0,
  wipeouts: 0,
  fullBoards: 0,
  draws: 0,
  seamFlips: 0,
  wrapFlips: 0,
  turnedFlips: 0,
  loopsOfOpponents: 0,
};

/** One game: engine, AI board and reference must agree at every ply. */
function compareGame(kind, width, height, seed) {
  const label = `${kind} ${width}x${height} seed ${seed}`;
  const random = seededRandom(seed * 7_919 + width * 131 + height * 17 + kind.length);
  const reference = startPosition(kind, width, height);
  const engine = new OthelloEngine({ width, height, topology: kind });
  const ai = new OthelloBoard(getOthelloGeometry(kind, width, height));
  ai.loadRows(engine.getBoard());
  const side = (color) => (color === BLACK ? 1 : 2);
  let skipRun = 0;
  coverage.games += 1;

  while (!reference.over) {
    const color = reference.toMove;
    assert.equal(engine.phase, "play", label);
    assert.equal(engine.currentPlayer, color, `${label}: player to move`);
    const legal = referenceLegal(reference, color);
    const engineLegal = engine.legalMoves().map(({ row, col }) => row * width + col);
    assert.deepEqual(engineLegal, legal, `${label}: legal moves of ${color}`);
    const out = new Int16Array(ai.cellCount);
    const aiLegal = Array.from(out.subarray(0, ai.generateMoves(side(color), out))).sort((a, b) => a - b);
    assert.deepEqual(aiLegal, legal, `${label}: AI legal moves of ${color}`);
    assert.equal(ai.countMoves(side(color)), legal.length, `${label}: AI move count`);
    assert.equal(ai.countMovesLean(side(color)), legal.length, `${label}: AI lean move count`);
    assert.equal(ai.hasMove(side(color)), legal.length > 0, label);
    // Every empty point (every third ply, the slow part): legal or not,
    // with the same flips everywhere.
    for (let cell = 0; coverage.moves % 3 === 0 && cell < width * height; cell += 1) {
      const row = Math.floor(cell / width);
      const col = cell % width;
      if (reference.board[row][col] !== null) continue;
      const expected = referenceMove(reference, row, col, color);
      if (expected.how.loopOfOpponents) coverage.loopsOfOpponents += 1;
      const check = engine.checkPlay(row, col);
      if (expected.flips.length) {
        assert.equal(check.ok, true, `${label}: ${row},${col} should be legal`);
        assert.deepEqual(
          check.flipped.map((point) => point.row * width + point.col).sort((a, b) => a - b),
          expected.flips,
          `${label}: flips at ${row},${col}`,
        );
      } else {
        assert.equal(check.ok, false, `${label}: ${row},${col} should be illegal`);
      }
      assert.equal(ai.isLegal(cell, side(color)), expected.flips.length > 0, `${label}: AI isLegal ${cell}`);
      assert.equal(ai.isLegalLean(cell, side(color)), expected.flips.length > 0, `${label}: AI isLegalLean ${cell}`);
      assert.equal(ai.countFlips(cell, side(color)), expected.flips.length, `${label}: AI countFlips ${cell}`);
    }

    const cell = chooseMove(reference, legal, random);
    const row = Math.floor(cell / width);
    const col = cell % width;
    const expected = referencePlay(reference, cell);
    const result = engine.play(row, col);
    assert.equal(result.ok, true, label);
    assert.deepEqual(
      result.flipped.map((point) => point.row * width + point.col).sort((a, b) => a - b),
      expected.flips,
      `${label}: played flips`,
    );
    assert.equal(result.skipped, expected.skipped, `${label}: skipped side`);
    // The lean path (exact endgame solving) flips the same discs and undoes cleanly.
    const before = Array.from(ai.cells);
    ai.makeMoveLean(cell, side(color));
    const leanAfter = Array.from(ai.cells);
    ai.unmakeMoveLean(side(color));
    assert.deepEqual(Array.from(ai.cells), before, `${label}: AI lean undo`);
    assert.equal(ai.makeMove(cell, side(color)), expected.flips.length, `${label}: AI makeMove`);
    assert.deepEqual(Array.from(ai.cells), leanAfter, `${label}: AI lean move`);
    assert.deepEqual([...ai.lastFlips()].sort((a, b) => a - b), expected.flips, `${label}: AI flips`);
    // The AI board equals a fresh load of the engine board.
    const leanBoard = new OthelloBoard(getOthelloGeometry(kind, width, height));
    leanBoard.loadRows(engine.getBoard());
    assert.deepEqual(Array.from(ai.cells), Array.from(leanBoard.cells), `${label}: AI board`);

    coverage.moves += 1;
    if (expected.how.seam) coverage.seamFlips += 1;
    if (expected.how.wrap) coverage.wrapFlips += 1;
    if (expected.how.turned) coverage.turnedFlips += 1;
    if (expected.skipped) {
      coverage.skips += 1;
      skipRun += 1;
      if (skipRun >= 2) coverage.skipsInARow += 1;
    } else {
      skipRun = 0;
    }
    assert.deepEqual(engine.getBoard(), reference.board, `${label}: board`);
  }

  // The end: neither side can move; the result counts the discs.
  assert.equal(engine.phase, "finished", `${label}: the game should be over`);
  assert.deepEqual(referenceLegal(reference, BLACK), [], label);
  assert.deepEqual(referenceLegal(reference, WHITE), [], label);
  const { black, white } = discCount(reference.board);
  assert.deepEqual(
    { winner: engine.result.winner, black: engine.result.black, white: engine.result.white, margin: engine.result.margin },
    { winner: black === white ? "draw" : black > white ? BLACK : WHITE, black, white, margin: Math.abs(black - white) },
    `${label}: result`,
  );
  if (black + white < width * height) coverage.blockedWithEmpties += 1;
  else coverage.fullBoards += 1;
  if (black === 0 || white === 0) coverage.wipeouts += 1;
  if (black === white) coverage.draws += 1;
  // The record replays to the same game.
  assert.equal(OthelloEngine.fromState(engine.serialize()).serialize(), engine.serialize(), label);
}

const HEAVY = process.env.OTHELLO_REFERENCE_HEAVY === "1";
// OTHELLO_REFERENCE_HEAVY=1 plays about 1,000 games on more and larger shapes.
const SHAPES = HEAVY
  ? [[6, 6], [8, 8], [6, 8], [8, 6], [10, 6], [6, 10], [12, 8], [10, 10], [14, 6]]
  : [[6, 6], [8, 8], [6, 8], [8, 6], [10, 6], [6, 10]];
const SEEDS = HEAVY ? 40 : 6;

test("rays on the cover match src/topology for every cell, direction and shape", () => {
  for (const kind of KINDS) {
    for (const [width, height] of [...SHAPES, [12, 8], [10, 10], [16, 16], [6, 30], [30, 6], [30, 30]]) {
      const topology = getTopology(kind, width, height);
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          for (const [dRow, dCol] of DIRECTIONS) {
            const expected = referenceRay(kind, width, height, row, col, dRow, dCol);
            const actual = topology.ray(row, col, dRow, dCol);
            assert.deepEqual(
              actual.cells.map((cell) => [cell.row, cell.col]),
              expected.cells.map((cell) => [cell.row, cell.col]),
              `${kind} ${width}x${height} (${row},${col}) direction ${dRow},${dCol}`,
            );
            assert.equal(actual.end === "start" ? "start" : "edge", expected.end);
            // A ray never visits a point twice.
            const keys = expected.cells.map((cell) => cell.row * width + cell.col);
            assert.equal(new Set(keys).size, keys.length);
          }
        }
      }
    }
  }
});

test("engine and AI board match the independent reference move by move", () => {
  for (const kind of KINDS) {
    for (const [width, height] of SHAPES) {
      for (let seed = 1; seed <= SEEDS; seed += 1) compareGame(kind, width, height, seed);
    }
  }
  // The games must actually reach the cases in question.
  for (const [name, count] of Object.entries(coverage)) {
    assert.ok(count > 0, `no game reached: ${name} (${JSON.stringify(coverage)})`);
  }
  test.diagnostic?.(JSON.stringify(coverage));
  if (process.env.OTHELLO_REFERENCE_VERBOSE) console.log(coverage);
});

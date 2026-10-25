import assert from "node:assert/strict";

import { GomokuEngine } from "../../src/game/gomokuEngine.js";
import { createRenjuReference, toReferenceBoard } from "../fixtures/renjuReference.js";
import { AXES_4, coverCell, seededRandom, shuffled } from "./coverGeometry.js";

/**
 * Random full Gomoku games checked move by move against references that
 * share no code with the engine: the longest run through each new stone on
 * every axis (walked on the board's cover, so rows wrap and Mobius rows turn
 * over), the winner and the winning run, a full board's draw, and under
 * Renju every probed point's forbidden verdict (renjuReference.js). Moves
 * favour points near existing stones so rows, threes and fours form often;
 * `fill` games instead avoid making five while they can, so boards fill up
 * and the last points (a draw, or a five on the very last point) are tested.
 */

export function newGomokuStats() {
  return {
    games: 0, plies: 0, blackWins: 0, whiteWins: 0, draws: 0, overlineWins: 0,
    seamWins: 0, probes: 0, forbiddenProbes: 0, overline: 0, double_four: 0, double_three: 0,
    forbiddenRefused: 0, fiveOverForbidden: 0, undos: 0, longestRun: 0,
    fullBoardDraws: 0, lastPointWins: 0,
  };
}

/** Runs through (row, col) for `color` on each axis, walked on the cover. */
function referenceRuns(board, topology, width, height, row, col, color) {
  return AXES_4.map(([dRow, dCol]) => {
    const seen = new Set([row * width + col]);
    const cells = [{ row, col }];
    for (const sign of [1, -1]) {
      for (let step = 1; ; step += 1) {
        const cell = coverCell(topology, width, height, row + sign * step * dRow, col + sign * step * dCol);
        if (!cell || board[cell.row][cell.col] !== color) break;
        const key = cell.row * width + cell.col;
        if (seen.has(key)) break;
        seen.add(key);
        cells.push(cell);
      }
    }
    return cells;
  });
}

function crossesSeam(cells, width, height) {
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  return Math.max(...cols) - Math.min(...cols) >= cells.length ||
    Math.max(...rows) - Math.min(...rows) >= cells.length ||
    (cols.includes(0) && cols.includes(width - 1)) ||
    (rows.includes(0) && rows.includes(height - 1));
}

/** The longest run `color` at (row, col) would make. */
function longestRunAt(engine, row, col, color) {
  const { width, height, topology } = engine;
  engine.board[row][col] = color;
  const lengths = referenceRuns(engine.board, topology, width, height, row, col, color).map((cells) => cells.length);
  engine.board[row][col] = null;
  return Math.max(...lengths);
}

function pickMove(engine, random, fill) {
  const { width, height, topology } = engine;
  if (fill) {
    // Fill the board: make the shortest row, and among those points block
    // the opponent's longest one, so both sides keep a safe point longer.
    const opponent = engine.currentPlayer === "black" ? "white" : "black";
    let best = [];
    let bestScore = Infinity;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (engine.board[row][col] !== null || !engine.checkPlay(row, col).ok) continue;
        const score = longestRunAt(engine, row, col, engine.currentPlayer) * 100 -
          longestRunAt(engine, row, col, opponent);
        if (score < bestScore) {
          bestScore = score;
          best = [];
        }
        if (score === bestScore) best.push({ row, col });
      }
    }
    return best.length > 0 ? best[Math.floor(random() * best.length)] : null;
  }
  const stones = [];
  const empties = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (engine.board[row][col] === null) empties.push({ row, col });
      else stones.push({ row, col });
    }
  }
  // Mostly near a stone (within two steps on the cover), sometimes anywhere.
  if (stones.length > 0 && random() < 0.8) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const from = stones[Math.floor(random() * stones.length)];
      const cell = coverCell(
        topology, width, height,
        from.row + Math.floor(random() * 5) - 2,
        from.col + Math.floor(random() * 5) - 2,
      );
      if (cell && engine.board[cell.row][cell.col] === null && engine.checkPlay(cell.row, cell.col).ok) return cell;
    }
  }
  for (const cell of shuffled(empties, random)) {
    if (engine.checkPlay(cell.row, cell.col).ok) return cell;
  }
  return null;
}

/**
 * @param {{topology: string, width: number, height: number, ruleSet: string,
 *   seed: number, probes?: number, undoRate?: number, stats: object}} options
 */
export function playRandomGomokuGame({ topology, width, height, ruleSet, seed, probes = 3, undoRate = 0.02, fill = false, stats }) {
  const label = `${ruleSet} ${topology} ${width}x${height} seed ${seed}`;
  const random = seededRandom(seed);
  const engine = new GomokuEngine({ width, height, topology, ruleSet });
  const reference = ruleSet === "renju"
    ? createRenjuReference({ width, height, topology })
    : null;
  let plies = 0;
  while (engine.phase === "play") {
    const color = engine.currentPlayer;
    if (reference && color === "black") {
      // Probe empty points near black stones against the reference.
      const rows = toReferenceBoard(engine.board);
      reference.clear();
      const candidates = [];
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          if (engine.board[row][col] !== null) continue;
          for (const [dRow, dCol] of [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]]) {
            const cell = coverCell(topology, width, height, row + dRow, col + dCol);
            if (cell && engine.board[cell.row][cell.col] === "black") {
              candidates.push({ row, col });
              break;
            }
          }
        }
      }
      for (const { row, col } of shuffled(candidates, random).slice(0, probes)) {
        const expected = reference.verdict(rows, row, col);
        const actual = engine.checkPlay(row, col);
        stats.probes += 1;
        if (expected === null) {
          assert.equal(actual.ok, true, `${label} ply ${plies}: ${row},${col} should be legal`);
        } else {
          stats.forbiddenProbes += 1;
          stats[expected] += 1;
          assert.equal(actual.ok, false, `${label} ply ${plies}: ${row},${col} should be ${expected}`);
          assert.equal(actual.reason, "forbidden");
          assert.equal(actual.forbidden, expected, `${label} ply ${plies}: reason at ${row},${col}`);
          const refused = engine.play(row, col);
          assert.equal(refused.ok, false);
          stats.forbiddenRefused += 1;
        }
      }
    }

    if (plies > 0 && random() < undoRate && engine.canUndo()) {
      const before = engine.lastMove;
      assert.equal(engine.undo().ok, true);
      assert.equal(engine.board[before.row][before.col], null, `${label}: undo clears the stone`);
      assert.equal(engine.currentPlayer, before.color, `${label}: undo gives the turn back`);
      stats.undos += 1;
      plies -= 1;
      continue;
    }

    const move = pickMove(engine, random, fill);
    if (move === null) {
      // No legal point: only Renju's Black can be stuck, and the engine must
      // already have called the game a draw.
      assert.fail(`${label}: no legal move while the game is running`);
    }
    if (reference && color === "black") {
      const verdict = reference.verdict(toReferenceBoard(engine.board), move.row, move.col);
      assert.equal(verdict, null, `${label}: the engine allowed a move the reference forbids`);
    }
    const result = engine.play(move.row, move.col);
    assert.equal(result.ok, true, `${label}: play`);
    plies += 1;
    stats.plies += 1;

    const runs = referenceRuns(engine.board, topology, width, height, move.row, move.col, color);
    const lengths = runs.map((cells) => cells.length);
    stats.longestRun = Math.max(stats.longestRun, ...lengths);
    const renjuBlack = ruleSet === "renju" && color === "black";
    const winning = renjuBlack
      ? lengths.findIndex((length) => length === 5)
      : lengths.findIndex((length) => length >= 5);
    if (winning >= 0) {
      assert.equal(engine.phase, "finished", `${label}: a five ends the game`);
      assert.equal(engine.result.winner, color, `${label}: winner`);
      assert.equal(engine.result.reason, "five");
      // The engine's line is a real run of the mover through the new stone.
      const line = engine.result.line;
      assert.ok(renjuBlack ? line.length === 5 : line.length >= 5, `${label}: line length ${line.length}`);
      assert.ok(lengths.includes(line.length), `${label}: line matches a reference run`);
      assert.ok(line.some((cell) => cell.row === move.row && cell.col === move.col));
      assert.ok(line.every((cell) => engine.board[cell.row][cell.col] === color));
      stats[color === "black" ? "blackWins" : "whiteWins"] += 1;
      if (line.length > 5) stats.overlineWins += 1;
      if (renjuBlack && lengths.some((length) => length > 5)) stats.fiveOverForbidden += 1;
      if (crossesSeam(line, width, height)) stats.seamWins += 1;
      if (engine.board.every((row) => row.every((stone) => stone !== null))) stats.lastPointWins += 1;
    } else {
      assert.equal(engine.result?.winner === color, false, `${label}: no five, no win`);
      const full = engine.board.every((row) => row.every((stone) => stone !== null));
      if (full) {
        assert.equal(engine.phase, "finished", `${label}: a full board ends the game`);
        assert.deepEqual(engine.result, { winner: "draw", reason: "board_full", margin: 0 });
        assert.equal(engine.canUndo(), false, `${label}: a finished game cannot be undone`);
        assert.deepEqual(engine.legalMoves(), []);
        stats.draws += 1;
        stats.fullBoardDraws += 1;
      } else if (engine.phase === "finished") {
        // Only Renju's Black left without a legal point draws early.
        assert.equal(engine.result.reason, "no_legal_moves", `${label}: early end`);
        stats.draws += 1;
      }
    }
  }
  stats.games += 1;
  // A finished game round-trips through its record.
  const restored = GomokuEngine.fromState(engine.exportState());
  assert.deepEqual(restored.getState(), engine.getState(), `${label}: restore`);
  return engine;
}

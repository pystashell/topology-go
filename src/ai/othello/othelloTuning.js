import { OthelloBoard } from "./othelloBoard.js";
import {
  EXACT_UNIT,
  FEATURE_COUNT,
  PHASE_KNOTS,
  fillFeatures,
  knotWeights,
  phaseOf,
} from "./othelloEval.js";
import { createRandom, getOthelloGeometry } from "./othelloGeometry.js";
import { INF, OthelloSearcher, TranspositionTable, runSearchSync } from "./othelloSearch.js";

/**
 * Offline tuning of the evaluation weights (not used by the worker).
 *
 * collectSamples() plays seeded self-play games with a shallow randomized
 * search, solves each game exactly once few empties remain, and labels
 * every earlier position with that perfect-play result (from the side to
 * move). fitWeights() then fits one weight row per phase knot by ridge
 * least squares, predicting 1000 * final disc margin / cell count.
 */

const PARAMETERS = PHASE_KNOTS.length * FEATURE_COUNT;

/**
 * @param {object} options
 * @param {'cylinder'|'torus'|'mobius'} options.kind
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.games
 * @param {number} [options.seed]
 * @param {object} [options.weights] weights for the self-play search
 * @param {number} [options.depth] self-play search depth
 * @param {number} [options.temperature] softmax temperature at the root
 * @param {number} [options.solveEmpties] label positions by solving here
 * @returns {{features: number[][], phase: number[], y: number[]}} samples
 */
export function collectSamples({
  kind,
  width,
  height,
  games,
  seed = 1,
  weights,
  depth = 2,
  temperature = 80,
  solveEmpties = 12,
}) {
  const geometry = getOthelloGeometry(kind, width, height);
  const tt = new TranspositionTable(18);
  const searcher = new OthelloSearcher(geometry, { tt, weights });
  const board = new OthelloBoard(geometry);
  const features = new Float64Array(FEATURE_COUNT);
  const scratch = new Int32Array(4);
  const moves = new Int16Array(geometry.cellCount);
  const random = createRandom(seed);
  const samples = { features: [], phase: [], y: [] };
  for (let game = 0; game < games; game += 1) {
    board.clear();
    const start = new Int8Array(geometry.cellCount);
    const top = height / 2 - 1;
    const left = width / 2 - 1;
    start[top * width + left] = 2;
    start[top * width + left + 1] = 1;
    start[(top + 1) * width + left] = 1;
    start[(top + 1) * width + left + 1] = 2;
    board.load(start);
    let side = 1;
    const pending = [];
    let label = null;
    for (;;) {
      let count = board.generateMoves(side, moves);
      if (count === 0) {
        side = 3 - side;
        count = board.generateMoves(side, moves);
        if (count === 0) {
          label = { side, value: board.counts[side] - board.counts[3 - side] };
          break;
        }
      }
      if (board.emptyCount <= solveEmpties) {
        searcher.setPosition(board.cells, side);
        const value = searcher.negamax(64, -INF, INF, side, 0) / EXACT_UNIT;
        label = { side, value };
        break;
      }
      if (!fillFeatures(board, side, features, scratch)) {
        pending.push({
          features: Array.from(features),
          phase: phaseOf(board.counts[1] + board.counts[2], geometry.cellCount),
          side,
        });
      }
      // Shallow randomized search for the move.
      let cell;
      if (random() < 0.04 || board.counts[1] + board.counts[2] < 6) {
        cell = moves[Math.floor(random() * count)];
      } else {
        searcher.setPosition(board.cells, side);
        const result = runSearchSync(
          searcher.run({ maxDepth: depth, exactEmpties: 0, multiPv: true }),
        );
        const scored = result.rootMoves.filter((move) => move.completed);
        const best = Math.max(...scored.map((move) => move.score));
        const weightsOf = scored.map((move) => Math.exp((move.score - best) / temperature));
        let pick = random() * weightsOf.reduce((sum, value) => sum + value, 0);
        cell = scored[scored.length - 1].cell;
        for (let index = 0; index < scored.length; index += 1) {
          pick -= weightsOf[index];
          if (pick <= 0) {
            cell = scored[index].cell;
            break;
          }
        }
      }
      board.makeMove(cell, side);
      side = 3 - side;
    }
    for (const sample of pending) {
      const value = sample.side === label.side ? label.value : -label.value;
      samples.features.push(sample.features);
      samples.phase.push(sample.phase);
      samples.y.push((1000 * value) / geometry.cellCount);
    }
  }
  return samples;
}

/** The design row of a sample: features spread over the phase knots. */
function designRow(features, phase, knots, row) {
  knotWeights(phase, knots);
  row.fill(0);
  for (let knot = 0; knot < PHASE_KNOTS.length; knot += 1) {
    if (knots[knot] === 0) continue;
    for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
      row[knot * FEATURE_COUNT + feature] = knots[knot] * features[feature];
    }
  }
  return row;
}

/**
 * Ridge least squares: minimize |Xw - y|^2 + ridge |w|^2.
 * @returns {number[][]} one FEATURES-ordered row per phase knot
 */
export function fitWeights({ features, phase, y }, ridge = 1) {
  const n = PARAMETERS;
  const a = Array.from({ length: n }, () => new Float64Array(n + 1));
  const knots = new Float64Array(PHASE_KNOTS.length);
  const row = new Float64Array(n);
  for (let sample = 0; sample < y.length; sample += 1) {
    designRow(features[sample], phase[sample], knots, row);
    for (let i = 0; i < n; i += 1) {
      const value = row[i];
      if (value === 0) continue;
      const ai = a[i];
      for (let j = 0; j < n; j += 1) ai[j] += value * row[j];
      ai[n] += value * y[sample];
    }
  }
  for (let i = 0; i < n; i += 1) a[i][i] += ridge;
  // Gaussian elimination with partial pivoting.
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = column + 1; row < n; row += 1) {
      const factor = a[row][column] / a[column][column];
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  const w = new Float64Array(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * w[k];
    w[row] = sum / a[row][row];
  }
  return PHASE_KNOTS.map((_, knot) =>
    Array.from(w.subarray(knot * FEATURE_COUNT, (knot + 1) * FEATURE_COUNT), (value) =>
      Math.round(value),
    ),
  );
}

/** Mean squared error of knot rows on samples (for reporting). */
export function meanSquaredError({ features, phase, y }, rows) {
  const knots = new Float64Array(PHASE_KNOTS.length);
  const row = new Float64Array(PARAMETERS);
  let total = 0;
  for (let sample = 0; sample < y.length; sample += 1) {
    designRow(features[sample], phase[sample], knots, row);
    let prediction = 0;
    for (let knot = 0; knot < rows.length; knot += 1) {
      for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
        prediction += row[knot * FEATURE_COUNT + feature] * rows[knot][feature];
      }
    }
    total += (prediction - y[sample]) ** 2;
  }
  return total / y.length;
}

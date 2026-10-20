import { ROW_CLASSES } from "./othelloGeometry.js";
import { FITTED_WEIGHTS } from "./othelloWeights.js";

/**
 * Static evaluation for Othello on wrap-around boards.
 *
 * Scores are integers from the side to move's point of view. A finished
 * game scores its exact disc margin times EXACT_UNIT; every heuristic score
 * stays strictly inside ±EVAL_LIMIT, so any proven win outranks any
 * heuristic advantage and any proven loss ranks below every heuristic.
 *
 * The features suit boards without corners: cylinders and Mobius strips
 * only have their top/bottom boundary rows (discs there can only be flipped
 * along the row), and the torus has no special cells at all.
 *  - mobility: legal moves, as a normalized difference;
 *  - potential mobility: empties next to opponent discs;
 *  - frontier: (empty, disc) adjacencies, fewer is better;
 *  - discs: normalized disc difference;
 *  - row0..row2: discs on the boundary rows and the two rows inside them,
 *    per board width (cylinder and Mobius; always 0 on the torus);
 *  - stable: stable discs per board width (only possible once a line is
 *    full);
 *  - parity: +1 when the side to move expects the last move (odd number of
 *    empties and it can move now, or even and it must pass);
 *  - scarcity: 1/(1 + opponent moves) - 1/(1 + own moves), large when a
 *    side is close to having to pass (which flips the parity).
 * The raw score is a weighted sum with weights per topology, interpolated
 * between game-phase knots (share of the board filled); the weights were
 * fitted by least squares to self-play results (see othelloWeights.js).
 */

export const EXACT_UNIT = 1000;
export const EVAL_LIMIT = 990;

/** Feature order of a weight vector. */
export const FEATURES = Object.freeze([
  "mobility",
  "potential",
  "frontier",
  "discs",
  "row0",
  "row1",
  "row2",
  "stable",
  "parity",
  "scarcity",
]);
export const FEATURE_COUNT = FEATURES.length;

/** Phase knots (share of the board filled) the weight rows refer to. */
export const PHASE_KNOTS = Object.freeze([0, 0.2, 0.4, 0.6, 0.8, 1]);

/** Weights per topology: one FEATURES-ordered row per phase knot. */
export const DEFAULT_WEIGHTS = FITTED_WEIGHTS;

/** Raw scores are squashed as EVAL_LIMIT * raw / (|raw| + SQUASH). */
const SQUASH = 400;
/** Stable-disc detection is skipped on big boards (too slow per leaf). */
const STABLE_MAX_CELLS = 144;

/** Phase of a position with `discs` discs: share of the board filled. */
export function phaseOf(discs, cellCount) {
  return Math.min(1, Math.max(0, (discs - 4) / Math.max(1, cellCount - 4)));
}

/**
 * Interpolation weights of each phase knot at `phase` (hat functions).
 * @param {number} phase
 * @param {Float64Array} [out]
 */
export function knotWeights(phase, out = new Float64Array(PHASE_KNOTS.length)) {
  out.fill(0);
  const last = PHASE_KNOTS.length - 1;
  if (phase >= PHASE_KNOTS[last]) {
    out[last] = 1;
    return out;
  }
  for (let knot = 0; knot < last; knot += 1) {
    const low = PHASE_KNOTS[knot];
    const high = PHASE_KNOTS[knot + 1];
    if (phase >= low && phase < high) {
      const t = (phase - low) / (high - low);
      out[knot] = 1 - t;
      out[knot + 1] = t;
      break;
    }
  }
  return out;
}

/**
 * Per-disc-count interpolated weights for a board shape.
 * @param {object} geometry
 * @param {object} [weights] { cylinder, torus, mobius } knot rows
 * @returns {Float64Array} (cellCount + 1) * FEATURE_COUNT entries.
 */
export function buildWeightTable(geometry, weights = DEFAULT_WEIGHTS) {
  const { cellCount } = geometry;
  const rows = weights[geometry.kind] ?? weights;
  const table = new Float64Array((cellCount + 1) * FEATURE_COUNT);
  const knots = new Float64Array(PHASE_KNOTS.length);
  for (let discs = 0; discs <= cellCount; discs += 1) {
    knotWeights(phaseOf(discs, cellCount), knots);
    for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
      let value = 0;
      for (let knot = 0; knot < PHASE_KNOTS.length; knot += 1) {
        value += knots[knot] * rows[knot][feature];
      }
      table[discs * FEATURE_COUNT + feature] = value;
    }
  }
  return table;
}

/**
 * Write the features of `board` for `side` (1 black, 2 white) into
 * `features` (FEATURE_COUNT entries). Returns true when neither side can
 * move (the game is over; features are then not filled).
 *
 * @param {import("./othelloBoard.js").OthelloBoard} board
 * @param {number} side
 * @param {Float64Array} features
 * @param {Int32Array} scratch at least 3 entries
 */
export function fillFeatures(board, side, features, scratch) {
  const geometry = board.geometry;
  const { rayStart, rayCells, neighborStart, neighbors } = geometry;
  const cells = board.cells;
  const occupied = board.occupiedNeighbors;
  const emptyList = board.emptyList;
  let mobilityBlack = 0;
  let mobilityWhite = 0;
  let potentialBlack = 0;
  let potentialWhite = 0;
  let frontierBlack = 0;
  let frontierWhite = 0;
  for (let slot = 0; slot < board.emptyCount; slot += 1) {
    const cell = emptyList[slot];
    if (occupied[cell] === 0) continue;
    let nearBlack = 0;
    let nearWhite = 0;
    for (let index = neighborStart[cell]; index < neighborStart[cell + 1]; index += 1) {
      const value = cells[neighbors[index]];
      if (value === 1) nearBlack += 1;
      else if (value === 2) nearWhite += 1;
    }
    frontierBlack += nearBlack;
    frontierWhite += nearWhite;
    const base = cell * 8;
    if (nearWhite > 0) {
      potentialBlack += 1;
      for (let direction = 0; direction < 8; direction += 1) {
        let index = rayStart[base + direction];
        const end = rayStart[base + direction + 1];
        if (end - index < 2 || cells[rayCells[index]] !== 2) continue;
        index += 1;
        while (index < end && cells[rayCells[index]] === 2) index += 1;
        if (index < end && cells[rayCells[index]] === 1) {
          mobilityBlack += 1;
          break;
        }
      }
    }
    if (nearBlack > 0) {
      potentialWhite += 1;
      for (let direction = 0; direction < 8; direction += 1) {
        let index = rayStart[base + direction];
        const end = rayStart[base + direction + 1];
        if (end - index < 2 || cells[rayCells[index]] !== 1) continue;
        index += 1;
        while (index < end && cells[rayCells[index]] === 1) index += 1;
        if (index < end && cells[rayCells[index]] === 2) {
          mobilityWhite += 1;
          break;
        }
      }
    }
  }
  if (mobilityBlack === 0 && mobilityWhite === 0) return true;

  const sign = side === 1 ? 1 : -1;
  const discsBlack = board.counts[1];
  const discsWhite = board.counts[2];
  const width = geometry.width;
  features[0] = (sign * (mobilityBlack - mobilityWhite)) / (mobilityBlack + mobilityWhite + 2);
  features[1] =
    (sign * (potentialBlack - potentialWhite)) / (potentialBlack + potentialWhite + 2);
  features[2] = (sign * (frontierWhite - frontierBlack)) / (frontierBlack + frontierWhite + 2);
  features[3] = (sign * (discsBlack - discsWhite)) / (discsBlack + discsWhite);
  if (geometry.hasBoundary) {
    const classCounts = board.classCounts;
    for (let rowClass = 0; rowClass < 3; rowClass += 1) {
      features[4 + rowClass] =
        (sign *
          (classCounts[ROW_CLASSES + rowClass] - classCounts[2 * ROW_CLASSES + rowClass])) /
        width;
    }
  } else {
    features[4] = 0;
    features[5] = 0;
    features[6] = 0;
  }
  if (board.fullLines > 0 && board.cellCount <= STABLE_MAX_CELLS) {
    board.stableDiscs(scratch);
    features[7] = (sign * (scratch[1] - scratch[2])) / width;
  } else {
    features[7] = 0;
  }
  const toMoveCanPlay = side === 1 ? mobilityBlack > 0 : mobilityWhite > 0;
  features[8] = ((board.emptyCount & 1) === 1) === toMoveCanPlay ? 1 : -1;
  features[9] = sign * (1 / (1 + mobilityWhite) - 1 / (1 + mobilityBlack));
  return false;
}

/**
 * Evaluate `board` for `side` (1 black, 2 white).
 *
 * @param {import("./othelloBoard.js").OthelloBoard} board
 * @param {number} side
 * @param {Float64Array} weightTable from buildWeightTable
 * @param {Int32Array} scratch at least 3 entries
 * @param {Float64Array} features FEATURE_COUNT entries of scratch space
 */
export function evaluate(board, side, weightTable, scratch, features) {
  if (fillFeatures(board, side, features, scratch)) {
    const opponent = 3 - side;
    return (board.counts[side] - board.counts[opponent]) * EXACT_UNIT;
  }
  const base = (board.counts[1] + board.counts[2]) * FEATURE_COUNT;
  let raw = 0;
  for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
    raw += weightTable[base + feature] * features[feature];
  }
  return Math.trunc((EVAL_LIMIT * raw) / (Math.abs(raw) + SQUASH));
}

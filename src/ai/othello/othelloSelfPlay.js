import { OthelloEngine } from "../../game/othelloEngine.js";
import { chooseOthelloMoveSync } from "./othelloAi.js";
import { createRandom } from "./othelloGeometry.js";

/**
 * Self-play tools for the Othello AI: reference opponents (uniform random,
 * greedy max-flips), seeded games refereed by OthelloEngine, and match
 * statistics. Used by the strength tests and for tuning; not needed by the
 * worker.
 */

export { createRandom };

/** The worker-contract position for an engine's current state. */
export function positionOf(engine, moveCount = 0) {
  return {
    gameType: "othello",
    width: engine.width,
    height: engine.height,
    topology: engine.topology,
    board: engine.getBoard(),
    currentPlayer: engine.currentPlayer,
    lastMove: null,
    moveCount,
  };
}

/** Uniformly random legal move. */
export function randomPlayer(random) {
  return (engine) => {
    const moves = engine.legalMoves();
    return moves[Math.floor(random() * moves.length)];
  };
}

/** The move flipping the most discs; ties broken at random. */
export function greedyPlayer(random) {
  return (engine) => {
    let best = [];
    let bestFlips = -1;
    for (const move of engine.legalMoves()) {
      const flips = engine.checkPlay(move.row, move.col).flipped.length;
      if (flips > bestFlips) {
        best = [move];
        bestFlips = flips;
      } else if (flips === bestFlips) {
        best.push(move);
      }
    }
    return best[Math.floor(random() * best.length)];
  };
}

/** The AI at a level (synchronous search; options as chooseOthelloMoveSync). */
export function aiPlayer(settings, options = {}) {
  return (engine, plies) => chooseOthelloMoveSync(positionOf(engine, plies), settings, options).move;
}

/**
 * Play one game. The first `openingPlies` moves are uniformly random (both
 * sides) to vary the games.
 *
 * @returns {{winner: 'black'|'white'|'draw', black: number, white: number, plies: number}}
 */
export function playGame({
  width = 8,
  height = 8,
  topology = "cylinder",
  black,
  white,
  openingPlies = 0,
  random = createRandom(1),
}) {
  const engine = new OthelloEngine({ width, height, topology });
  const opening = randomPlayer(random);
  let plies = 0;
  while (engine.phase === "play") {
    const player = engine.currentPlayer === "black" ? black : white;
    const move = plies < openingPlies ? opening(engine) : player(engine, plies);
    const result = engine.play(move.row, move.col);
    if (!result.ok) {
      throw new Error(
        `Illegal move (${move.row},${move.col}) for ${engine.currentPlayer}: ${result.reason}`,
      );
    }
    plies += 1;
  }
  const { winner, black: blackDiscs, white: whiteDiscs } = engine.result;
  return { winner, black: blackDiscs, white: whiteDiscs, plies };
}

/**
 * Play `games` games between two player factories, alternating colours
 * (candidate is Black in even games). Factories receive a seeded random.
 *
 * @returns {{wins: number, losses: number, draws: number, games: number,
 *   discDiff: number}} from the candidate's point of view.
 */
export function playMatch({
  candidate,
  opponent,
  games,
  seed = 1,
  openingPlies = 2,
  width = 8,
  height = 8,
  topology = "cylinder",
}) {
  const stats = { wins: 0, losses: 0, draws: 0, games: 0, discDiff: 0 };
  for (let game = 0; game < games; game += 1) {
    const random = createRandom(seed * 7919 + game * 104729);
    const candidateColor = game % 2 === 0 ? "black" : "white";
    const first = candidate(random);
    const second = opponent(random);
    const result = playGame({
      width,
      height,
      topology,
      black: candidateColor === "black" ? first : second,
      white: candidateColor === "black" ? second : first,
      openingPlies,
      random,
    });
    stats.games += 1;
    const own = candidateColor === "black" ? result.black : result.white;
    const other = candidateColor === "black" ? result.white : result.black;
    stats.discDiff += own - other;
    if (result.winner === "draw") stats.draws += 1;
    else if (result.winner === candidateColor) stats.wins += 1;
    else stats.losses += 1;
  }
  return stats;
}

/** Score (wins + draws/2) / games with a 95% Wilson interval. */
export function scoreInterval({ wins, draws, games }) {
  const score = (wins + draws / 2) / games;
  const z = 1.96;
  const denominator = 1 + (z * z) / games;
  const centre = (score + (z * z) / (2 * games)) / denominator;
  const half =
    (z * Math.sqrt((score * (1 - score)) / games + (z * z) / (4 * games * games))) /
    denominator;
  return { score, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

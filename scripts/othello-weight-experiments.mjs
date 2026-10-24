// Paired-seed experiments with the Othello evaluation weights: the AI plays
// Black (the side that needs a pass on a symmetric torus) against a random or
// greedy player at a fixed depth, once per weight variant, on the same seeds.
//
//   node scripts/othello-weight-experiments.mjs [games=200] [depth=3] [random|greedy] [variants]
//   SEED=31337 TOPOLOGY=torus node scripts/othello-weight-experiments.mjs 600 3 random baseline,parity0
//
// 2026-10-24, 8x8 torus, depth 3, 600 games each: baseline 80.2%; parity 0,
// parity x2, discs -240 and their combinations scored 76-78.5%.
import { resetOthelloAiCaches } from "../src/ai/othello/othelloAi.js";
import { FEATURES } from "../src/ai/othello/othelloEval.js";
import { createRandom } from "../src/ai/othello/othelloGeometry.js";
import { aiPlayer, greedyPlayer, playGame, randomPlayer } from "../src/ai/othello/othelloSelfPlay.js";
import { FITTED_WEIGHTS } from "../src/ai/othello/othelloWeights.js";

const GAMES = Number(process.argv[2] ?? 200);
const DEPTH = Number(process.argv[3] ?? 3);
const OPPONENT = process.argv[4] ?? "random";
const ONLY = process.argv[5]?.split(",");
const TOPOLOGY = process.env.TOPOLOGY ?? "torus";
const SEED = Number(process.env.SEED ?? 9_001);

/** The fitted weights with some features of this topology replaced or scaled. */
function weightsWith(changes) {
  const rows = FITTED_WEIGHTS[TOPOLOGY].map((row) => [...row]);
  for (const [feature, value] of Object.entries(changes)) {
    const index = FEATURES.indexOf(feature);
    if (index < 0) throw new Error(`unknown feature ${feature}`);
    for (const row of rows) row[index] = typeof value === "function" ? value(row[index]) : value;
  }
  return { ...FITTED_WEIGHTS, [TOPOLOGY]: rows };
}

function score(weights) {
  resetOthelloAiCaches();
  let points = 0;
  let margin = 0;
  for (let game = 0; game < GAMES; game += 1) {
    const random = createRandom(SEED + game * 7_919);
    const black = aiPlayer({ level: "hard", timeLimitMs: 600_000 }, { maxDepth: DEPTH, exactEmpties: 12, weights });
    const white = OPPONENT === "greedy" ? greedyPlayer(random) : randomPlayer(random);
    const result = playGame({ width: 8, height: 8, topology: TOPOLOGY, black, white, openingPlies: 2, random });
    points += result.winner === "black" ? 1 : result.winner === "draw" ? 0.5 : 0;
    margin += result.black - result.white;
  }
  return { score: points / GAMES, margin: margin / GAMES };
}

const VARIANTS = {
  baseline: {},
  discs0: { discs: 0 },
  discsMinus240: { discs: -240 },
  scarcity0: { scarcity: 0 },
  parity0: { parity: 0 },
  parityDouble: { parity: (value) => value * 2 },
  mobility60: { mobility: 60 },
  frontierMinus60: { frontier: -60 },
};

for (const [name, changes] of Object.entries(VARIANTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const started = Date.now();
  const result = score(weightsWith(changes));
  console.log(JSON.stringify({ name, topology: TOPOLOGY, opponent: OPPONENT, games: GAMES, depth: DEPTH, ...result,
    seconds: (Date.now() - started) / 1000 }));
}

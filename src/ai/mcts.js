import {
  BLACK,
  GoEngine,
  PHASE_PLAY,
  WHITE,
} from "../game/goEngine.js";

export const MCTS_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    iterations: 60,
    timeLimitMs: 200,
    rolloutDepth: 8,
  }),
  medium: Object.freeze({
    iterations: 240,
    timeLimitMs: 700,
    rolloutDepth: 12,
  }),
  hard: Object.freeze({
    iterations: 800,
    timeLimitMs: 1_800,
    rolloutDepth: 16,
  }),
});

const PASS_MOVE = Object.freeze({ type: "pass" });
const DEFAULT_EXPLORATION = Math.SQRT2;
const TACTICAL_CAPTURE = 5;
const TACTICAL_RESCUE = 4;
const TACTICAL_ATARI = 3;
const NEURAL_POLICY_BASE = 12_000;
const NEURAL_POLICY_LOG_SCALE = 1_800;
// The standard-Go policy is useful strategic guidance, but it is not trained
// on our cylindrical topology. Keep its root exploration term deliberately
// smaller than ordinary UCB so search evidence and exact tactical reading stay
// authoritative.
const ROOT_PUCT_COEFFICIENT = 0.75;

const SEARCH_SHAPE = Object.freeze({
  easy: Object.freeze({ candidateLimit: 10, rolloutCandidates: 6, epsilon: 0.3 }),
  medium: Object.freeze({ candidateLimit: 14, rolloutCandidates: 8, epsilon: 0.2 }),
  hard: Object.freeze({ candidateLimit: 18, rolloutCandidates: 10, epsilon: 0.12 }),
});

export class SearchCancelledError extends Error {
  constructor(message = "AI search was cancelled") {
    super(message);
    this.name = "AbortError";
    this.code = "AI_SEARCH_CANCELLED";
  }
}

/**
 * Small deterministic PRNG for repeatable tests and reproducible AI games.
 * The returned function has the same contract as Math.random().
 */
export function createSeededRandom(seed = 0) {
  const text = String(seed);
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  state >>>= 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function copyMove(move) {
  return move.type === "pass"
    ? { type: "pass" }
    : { type: "play", row: move.row, col: move.col };
}

function normalizeState(gameOrState) {
  if (gameOrState instanceof GoEngine) return gameOrState.exportState();
  if (gameOrState && typeof gameOrState.exportState === "function") {
    return GoEngine.fromState(gameOrState.exportState()).exportState();
  }
  return GoEngine.fromState(gameOrState).exportState();
}

function normalizeDifficulty(value = "easy") {
  const key = value === "normal" ? "medium" : value;
  if (!Object.hasOwn(MCTS_DIFFICULTIES, key)) {
    throw new RangeError(`Unknown AI difficulty: ${value}`);
  }
  return key;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeRootPolicy(value, size) {
  if (value == null) return null;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError("rootPolicy must be an array of probabilities");
  }
  const expectedLength = size * size + 1;
  if (value.length !== expectedLength) {
    throw new RangeError(`rootPolicy must contain ${expectedLength} values`);
  }
  const policy = new Float32Array(expectedLength);
  let total = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    const probability = Number(value[index]);
    if (!Number.isFinite(probability) || probability < 0) {
      throw new RangeError("rootPolicy values must be finite and non-negative");
    }
    policy[index] = probability;
    total += probability;
  }
  if (!(total > 0)) throw new RangeError("rootPolicy must have positive mass");
  // Callers normally supply a softmax distribution, but accepting arbitrary
  // positive weights is convenient for tests and future policy providers.
  // Normalizing here makes PUCT scale-invariant and keeps reported priors
  // meaningful probabilities.
  for (let index = 0; index < expectedLength; index += 1) {
    policy[index] /= total;
  }
  return policy;
}

function normalizeOptions(options, size) {
  const difficulty = normalizeDifficulty(options.difficulty);
  const preset = MCTS_DIFFICULTIES[difficulty];
  const iterations = positiveInteger(
    options.iterations ?? options.maxIterations ?? preset.iterations,
    "iterations",
  );
  const timeLimitMs = options.timeLimitMs ?? preset.timeLimitMs;
  if (
    timeLimitMs !== Infinity &&
    (!Number.isFinite(timeLimitMs) || timeLimitMs < 0)
  ) {
    throw new RangeError("timeLimitMs must be a non-negative number or Infinity");
  }
  // Tactical evaluation is much more informative than playing a nearly random
  // game to the end. Short rollouts also keep one iteration bounded on 19x19,
  // so cancellation and the UI time budget remain responsive.
  const rolloutLimit = positiveInteger(
    options.rolloutLimit ?? preset.rolloutDepth,
    "rolloutLimit",
  );
  const exploration = options.exploration ?? DEFAULT_EXPLORATION;
  if (!Number.isFinite(exploration) || exploration < 0) {
    throw new RangeError("exploration must be a non-negative finite number");
  }
  const yieldEveryIterations = positiveInteger(
    options.yieldEveryIterations ?? 8,
    "yieldEveryIterations",
  );
  const clock = options.clock ?? (() => performance.now());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const random = options.random ?? createSeededRandom(options.seed ?? Date.now());
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }

  const shape = SEARCH_SHAPE[difficulty];
  const candidateLimit = positiveInteger(
    options.candidateLimit ?? shape.candidateLimit,
    "candidateLimit",
  );
  const rolloutCandidates = positiveInteger(
    options.rolloutCandidates ?? shape.rolloutCandidates,
    "rolloutCandidates",
  );
  const rolloutEpsilon = options.rolloutEpsilon ?? shape.epsilon;
  if (
    !Number.isFinite(rolloutEpsilon) ||
    rolloutEpsilon < 0 ||
    rolloutEpsilon > 1
  ) {
    throw new RangeError("rolloutEpsilon must be a number in [0, 1]");
  }

  return {
    difficulty,
    iterations,
    timeLimitMs,
    rolloutLimit,
    exploration,
    candidateLimit,
    rolloutCandidates,
    rolloutEpsilon,
    yieldEveryIterations,
    clock,
    random,
    signal: options.signal,
    shouldCancel: options.shouldCancel,
    onProgress: options.onProgress,
    rootPolicy: normalizeRootPolicy(options.rootPolicy, size),
  };
}

function randomUnit(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random() must return a number in [0, 1)");
  }
  return value;
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(randomUnit(random) * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function emptyPointMoves(state) {
  const moves = [];
  for (let row = 0; row < state.size; row += 1) {
    for (let col = 0; col < state.size; col += 1) {
      if (state.board[row][col] === null) {
        moves.push({ type: "play", row, col });
      }
    }
  }
  return moves;
}

function pointKey(row, col) {
  return `${row},${col}`;
}

function includesPoint(points, row, col) {
  return points.some((point) => point.row === row && point.col === col);
}

/**
 * Build each string once and map all of its stones back to the shared record.
 * GoEngine owns the topology, so groups crossing columns 0/size-1 are handled
 * identically here and in the rules.
 */
function groupMap(game) {
  const byStone = new Map();
  const groups = [];
  for (let row = 0; row < game.size; row += 1) {
    for (let col = 0; col < game.size; col += 1) {
      if (game.get(row, col) === null || byStone.has(pointKey(row, col))) {
        continue;
      }
      const group = game.getGroup(row, col);
      groups.push(group);
      for (const stone of group.stones) {
        byStone.set(pointKey(stone.row, stone.col), group);
      }
    }
  }
  return { byStone, groups };
}

function rawMoveAnalysis(game, groups, row, col, random) {
  const player = game.currentPlayer;
  const opponent = player === BLACK ? WHITE : BLACK;
  const friendly = new Set();
  const enemy = new Set();
  const emptyLiberties = new Set();

  for (const neighbour of game.neighbors(row, col)) {
    const value = game.get(neighbour.row, neighbour.col);
    if (value === null) {
      emptyLiberties.add(pointKey(neighbour.row, neighbour.col));
      continue;
    }
    const group = groups.byStone.get(pointKey(neighbour.row, neighbour.col));
    if (value === player) friendly.add(group);
    else if (value === opponent) enemy.add(group);
  }

  let capturedStones = 0;
  let rescuedStones = 0;
  let rescuedGroups = 0;
  let atariStones = 0;
  const resultingLiberties = new Set(emptyLiberties);

  for (const group of friendly) {
    for (const liberty of group.liberties) {
      if (liberty.row !== row || liberty.col !== col) {
        resultingLiberties.add(pointKey(liberty.row, liberty.col));
      }
    }
    if (
      group.liberties.length === 1 &&
      includesPoint(group.liberties, row, col)
    ) {
      rescuedGroups += 1;
      rescuedStones += group.stones.length;
    }
  }

  for (const group of enemy) {
    if (
      group.liberties.length === 1 &&
      includesPoint(group.liberties, row, col)
    ) {
      capturedStones += group.stones.length;
      for (const stone of group.stones) {
        resultingLiberties.add(pointKey(stone.row, stone.col));
      }
    } else if (
      group.liberties.length === 2 &&
      includesPoint(group.liberties, row, col)
    ) {
      atariStones += group.stones.length;
    }
  }

  const neighbours = game.neighbors(row, col);
  const ownEye =
    neighbours.length >= 3 &&
    neighbours.every((point) => game.get(point.row, point.col) === player);
  const fragileResult = resultingLiberties.size <= 1;
  const selfAtari = capturedStones === 0 && fragileResult;
  const connections = Math.max(0, friendly.size - 1);
  const edgeDistance = Math.min(row, game.size - 1 - row);
  const openingLine = Math.min(3, Math.max(1, Math.floor(game.size / 3)));

  let score = 0;
  let tacticalPriority = 0;
  if (capturedStones > 0) {
    score += 50_000 + capturedStones * 1_200;
    tacticalPriority = TACTICAL_CAPTURE;
  }
  if (rescuedStones > 0) {
    score += 32_000 + rescuedStones * 900 + rescuedGroups * 2_000;
    tacticalPriority = Math.max(tacticalPriority, TACTICAL_RESCUE);
  }
  if (atariStones > 0) {
    score += 2_000 + atariStones * 180;
    tacticalPriority = Math.max(tacticalPriority, TACTICAL_ATARI);
  }
  score += connections * 700;
  score += resultingLiberties.size * 24;
  score += friendly.size * 20 + enemy.size * 12;
  score -= Math.abs(edgeDistance - openingLine) * 2;

  // Connecting multiple endangered strings through their shared liberty is a
  // forcing rescue, including the visually easy-to-miss cylinder seam case.
  if (rescuedGroups >= 2 && resultingLiberties.size >= 2) {
    score += 8_000;
    tacticalPriority = Math.max(tacticalPriority, TACTICAL_RESCUE);
  }
  if (selfAtari) score -= 35_000 + friendly.size * 1_000;
  if (ownEye && capturedStones === 0) score -= 60_000;

  // Randomness only breaks equivalent positional ties. Seeded searches remain
  // exactly reproducible, while different games do not all open at one point.
  score += randomUnit(random) * 0.01;

  return {
    move: { type: "play", row, col },
    score,
    tacticalScore: score,
    tacticalPriority,
    capturedStones,
    rescuedStones,
    resultingLiberties: resultingLiberties.size,
    snapbackLoss: 0,
    selfAtari,
    ownEye,
  };
}

function refineFragileTactic(game, analysis) {
  if (analysis.capturedStones + analysis.rescuedStones === 0) {
    return analysis;
  }

  const trial = GoEngine.fromState(game.exportState());
  const played = trial.play(analysis.move.row, analysis.move.col);
  if (!played.ok) return analysis;

  const group = trial.getGroup(analysis.move.row, analysis.move.col);
  analysis.resultingLiberties = group.liberties.length;
  if (group.liberties.length !== 1) return analysis;

  // Read the immediate reply exactly. A capture that leaves the newly joined
  // string on one liberty can be a snapback: attractive material now, followed
  // by a larger forced loss one move later. Superko and suicide remain
  // authoritative because the reply is tested by a cloned GoEngine.
  const [reply] = group.liberties;
  const response = trial.play(reply.row, reply.col);
  const capturesPlayedStone =
    response.ok &&
    response.captured.some(
      (stone) =>
        stone.row === analysis.move.row && stone.col === analysis.move.col,
    );
  if (!capturesPlayedStone) return analysis;

  analysis.snapbackLoss = response.captured.length;
  const netLoss = response.captured.length - analysis.capturedStones;
  if (netLoss > 0) {
    const penalty =
      70_000 + netLoss * 5_000 + analysis.rescuedStones * 2_000;
    analysis.score -= penalty;
    analysis.tacticalScore -= penalty;
  }
  return analysis;
}

function applyRootPolicy(entries, rootPolicy, size) {
  if (!rootPolicy || entries.length === 0) return;
  let maximum = 0;
  for (const probability of rootPolicy) maximum = Math.max(maximum, probability);
  maximum = Math.max(maximum, 1e-8);

  for (const entry of entries) {
    const index =
      entry.move.type === "pass"
        ? size * size
        : entry.move.row * size + entry.move.col;
    const probability = Math.max(1e-8, rootPolicy[index]);
    const rawBonus =
      NEURAL_POLICY_BASE +
      NEURAL_POLICY_LOG_SCALE * Math.log(probability / maximum);
    const bonus = Math.max(-NEURAL_POLICY_BASE, Math.min(NEURAL_POLICY_BASE, rawBonus));
    // Captures, rescues and ataris remain hard tactical priorities. A standard
    // Go model may misunderstand a cylinder-specific fight, so it can promote
    // a forcing move but cannot demote it below a quiet strategic suggestion.
    entry.score +=
      entry.tacticalPriority > 0 ? Math.max(0, bonus) : bonus;
    entry.neuralPrior = probability;
  }
}

function rankedMoveEntries(
  gameOrState,
  settings,
  limit,
  includePass = true,
  refineTactics = true,
  rootPolicy = null,
) {
  const game =
    gameOrState instanceof GoEngine
      ? gameOrState
      : GoEngine.fromState(gameOrState);
  if (game.phase !== PHASE_PLAY) return [];
  const groups = groupMap(game);
  const entries = [];
  let emptyCount = 0;

  for (let row = 0; row < game.size; row += 1) {
    for (let col = 0; col < game.size; col += 1) {
      if (game.get(row, col) !== null) continue;
      emptyCount += 1;
      entries.push(rawMoveAnalysis(game, groups, row, col, settings.random));
    }
    cancellationCheck(settings);
  }

  applyRootPolicy(entries, rootPolicy, game.size);
  entries.sort((left, right) => right.score - left.score);
  if (refineTactics) {
    // Exact one-ply reading clones the superko history, so reserve it for the
    // shortlist that can actually enter this node. Rollouts use the cheap raw
    // policy and leave exact legality to game.play().
    const refinementLimit = Math.min(
      entries.length,
      Math.max(6, Math.min(limit, settings.candidateLimit) + 4),
    );
    for (let index = 0; index < refinementLimit; index += 1) {
      entries[index] = refineFragileTactic(game, entries[index]);
    }
    entries.sort((left, right) => right.score - left.score);
  }
  const selected = entries.slice(0, limit);

  // Reserve a little breadth for non-local strategy without allowing bad eyes
  // or self-atari into a small tactical candidate set.
  if (entries.length > limit && selected.length >= 4) {
    const diversitySlots = Math.min(2, Math.floor(limit / 5));
    const safeRemainder = entries
      .slice(limit)
      .filter((entry) => !entry.selfAtari && !entry.ownEye);
    for (let slot = 0; slot < diversitySlots && safeRemainder.length > 0; slot += 1) {
      const index = Math.floor(randomUnit(settings.random) * safeRemainder.length);
      selected[selected.length - 1 - slot] = safeRemainder.splice(index, 1)[0];
    }
    selected.sort((left, right) => right.score - left.score);
  }

  if (includePass) {
    const filledRatio = 1 - emptyCount / (game.size * game.size);
    const passEntry = {
      move: PASS_MOVE,
      score:
        game.consecutivePasses === 1
          ? -1_500 + filledRatio * 5_000
          : -3_000 + filledRatio * 3_000,
      tacticalPriority: 0,
      capturedStones: 0,
      rescuedStones: 0,
      resultingLiberties: Infinity,
      snapbackLoss: 0,
      selfAtari: false,
      ownEye: false,
    };
    applyRootPolicy([passEntry], rootPolicy, game.size);
    selected.push(passEntry);
    // Passing must compete on merit with ordinary plays. Keeping it at the end
    // would make progressive widening hide pass until every placement had been
    // expanded, causing the AI to fill its own eyes in settled positions.
    selected.sort((left, right) => right.score - left.score);
  }
  return selected;
}

function candidateMoves(state, settings, rootPolicy = null) {
  return rankedMoveEntries(
    state,
    settings,
    settings.candidateLimit,
    true,
    true,
    rootPolicy,
  );
}

function applyMove(game, move) {
  return move.type === "pass" ? game.pass() : game.play(move.row, move.col);
}

function cancellationCheck(settings) {
  if (settings.signal?.aborted || settings.shouldCancel?.()) {
    throw new SearchCancelledError();
  }
}

/** Return all exact GoEngine-legal moves without modifying the supplied game. */
export function listLegalMoves(gameOrState, { includePass = true } = {}) {
  const state = normalizeState(gameOrState);
  if (state.phase !== PHASE_PLAY) return [];
  const moves = [];

  for (const move of emptyPointMoves(state)) {
    const trial = GoEngine.fromState(state);
    if (applyMove(trial, move).ok) moves.push(copyMove(move));
  }
  if (includePass) {
    const trial = GoEngine.fromState(state);
    if (trial.pass().ok) moves.push({ type: "pass" });
  }
  return moves;
}

function createNode(state, move = null, analysis = null) {
  return {
    state,
    move,
    // Neural bonuses help decide which candidates enter the root, while this
    // heuristic remains purely tactical. The model gets its own explicit PUCT
    // term below instead of being counted twice through this field.
    heuristic: analysis?.tacticalScore ?? analysis?.score ?? 0,
    tacticalPriority: analysis?.tacticalPriority ?? 0,
    capturedStones: analysis?.capturedStones ?? 0,
    rescuedStones: analysis?.rescuedStones ?? 0,
    resultingLiberties: analysis?.resultingLiberties ?? Infinity,
    snapbackLoss: analysis?.snapbackLoss ?? 0,
    neuralPrior: analysis?.neuralPrior ?? 0,
    visits: 0,
    value: 0,
    children: [],
    untriedMoves: null,
  };
}

function rootPriorMass(node) {
  let total = 0;
  for (const child of node.children) total += child.neuralPrior;
  return total;
}

function rootPuctBonus(node, child, priorMass) {
  if (!(priorMass > 0) || !(child.neuralPrior > 0)) return 0;
  const priorShare = child.neuralPrior / priorMass;
  return (
    ROOT_PUCT_COEFFICIENT *
    priorShare *
    Math.sqrt(node.visits + 1) /
    (child.visits + 1)
  );
}

function expand(node, settings) {
  node.untriedMoves ??= candidateMoves(
    node.state,
    settings,
    node.move === null ? settings.rootPolicy : null,
  );
  if (node.untriedMoves.length === 0) return null;

  // Progressive widening is essential on 19x19. With 80 simulations the old
  // search opened 80 different children and learned nothing about any of them.
  // This curve opens roughly sqrt(N) candidates and repeatedly revisits them.
  const allowedChildren = Math.min(
    settings.candidateLimit + 1,
    1 + Math.floor(Math.sqrt(node.visits + 1)),
  );
  if (node.children.length >= allowedChildren) return null;

  const game = GoEngine.fromState(node.state);
  while (node.untriedMoves.length > 0) {
    cancellationCheck(settings);
    const analysis = node.untriedMoves.shift();
    const result = applyMove(game, analysis.move);
    if (!result.ok) continue;

    const child = createNode(
      game.exportState(),
      copyMove(analysis.move),
      analysis,
    );
    node.children.push(child);
    return child;
  }
  return null;
}

function selectChild(
  node,
  rootPlayer,
  exploration,
  random,
  useRootPolicy = false,
) {
  const actorIsRoot = node.state.currentPlayer === rootPlayer;
  const logVisits = Math.log(Math.max(1, node.visits));
  const priorMass = useRootPolicy && node.move === null ? rootPriorMass(node) : 0;
  let bestScore = -Infinity;
  let best = [];

  for (const child of node.children) {
    const mean = child.visits === 0 ? 0.5 : child.value / child.visits;
    const exploitation = actorIsRoot ? mean : 1 - mean;
    const bonus =
      child.visits === 0
        ? Infinity
        : exploration * Math.sqrt(logVisits / child.visits);
    // A small, decaying tactical prior breaks early UCB ties in favour of sane
    // local moves without overwhelming evidence accumulated by simulations.
    const prior =
      (Math.max(-1, Math.min(1, child.heuristic / 50_000)) *
        Math.sqrt(node.visits + 1)) /
      (12 * (child.visits + 1));
    const neuralExploration = rootPuctBonus(node, child, priorMass);
    const score = exploitation + bonus + prior + neuralExploration;
    if (score > bestScore) {
      bestScore = score;
      best = [child];
    } else if (score === bestScore) {
      best.push(child);
    }
  }
  return best[Math.floor(randomUnit(random) * best.length)];
}

function rolloutPassProbability(game, emptyCount) {
  const filledRatio = 1 - emptyCount / (game.size * game.size);
  if (game.consecutivePasses === 1) return 0.08 + filledRatio * 0.55;
  return 0.002 + filledRatio * 0.08;
}

function playWeightedMove(game, settings) {
  const emptyCount = emptyPointMoves(game).length;
  if (
    randomUnit(settings.random) < rolloutPassProbability(game, emptyCount)
  ) {
    game.pass();
    return;
  }

  const entries = rankedMoveEntries(
    game,
    settings,
    settings.rolloutCandidates,
    false,
    false,
  );
  if (randomUnit(settings.random) < settings.rolloutEpsilon) {
    shuffle(entries, settings.random);
  } else {
    // Mostly prefer the best tactical handful, but keep a stochastic rollout
    // distribution so MCTS compares lines instead of repeating one playout.
    const head = entries.splice(0, Math.min(3, entries.length));
    if (head.length > 1) {
      const weights = head.map((_, index) => 3 - index);
      let roll = randomUnit(settings.random) * weights.reduce((a, b) => a + b, 0);
      let chosen = 0;
      for (let index = 0; index < weights.length; index += 1) {
        roll -= weights[index];
        if (roll <= 0) {
          chosen = index;
          break;
        }
      }
      const [first] = head.splice(chosen, 1);
      entries.unshift(first, ...head);
    } else {
      entries.unshift(...head);
    }
  }

  // Illegal play() calls are transactional. Try the ranked alternatives until
  // exact suicide and positional-superko checks accept one.
  for (const entry of entries) {
    cancellationCheck(settings);
    if (game.play(entry.move.row, entry.move.col).ok) return;
  }
  game.pass();
}

function groupSafety(group) {
  const stones = group.stones.length;
  const liberties = group.liberties.length;
  if (liberties === 1) return -4 - stones * 0.8;
  if (liberties === 2) return -1.2 - stones * 0.15;
  return Math.min(4, liberties) * 0.35 + Math.min(8, stones) * 0.12;
}

function reliableTerritory(game) {
  const visited = new Set();
  const territory = { [BLACK]: 0, [WHITE]: 0 };

  for (let row = 0; row < game.size; row += 1) {
    for (let col = 0; col < game.size; col += 1) {
      const startKey = pointKey(row, col);
      if (game.get(row, col) !== null || visited.has(startKey)) continue;
      const pending = [{ row, col }];
      const points = [];
      const borders = new Set();
      let boundaryEdges = 0;
      visited.add(startKey);

      while (pending.length > 0) {
        const point = pending.pop();
        points.push(point);
        for (const neighbour of game.neighbors(point.row, point.col)) {
          const value = game.get(neighbour.row, neighbour.col);
          const key = pointKey(neighbour.row, neighbour.col);
          if (value === null && !visited.has(key)) {
            visited.add(key);
            pending.push(neighbour);
          } else if (value !== null) {
            borders.add(value);
            boundaryEdges += 1;
          }
        }
      }

      // A huge open region touching one colour is influence, not settled land.
      // Count only compact, well-enclosed regions as reliable territory.
      const compact = points.length <= Math.max(4, game.size);
      const enclosed = boundaryEdges >= Math.max(3, points.length);
      if (borders.size === 1 && compact && enclosed) {
        territory[[...borders][0]] += points.length;
      }
    }
  }
  return territory;
}

function evaluate(game, rootPlayer) {
  let difference;
  if (game.phase !== PHASE_PLAY) {
    const score = game.score();
    difference =
      rootPlayer === BLACK
        ? score.black - score.white
        : score.white - score.black;
  } else {
    const { groups } = groupMap(game);
    const safety = { [BLACK]: 0, [WHITE]: 0 };
    const stones = { [BLACK]: 0, [WHITE]: 0 };
    for (const group of groups) {
      safety[group.color] += groupSafety(group);
      stones[group.color] += group.stones.length;
    }
    const territory = reliableTerritory(game);
    const opponent = rootPlayer === BLACK ? WHITE : BLACK;
    difference =
      (game.captures[rootPlayer] - game.captures[opponent]) * 2.5 +
      (safety[rootPlayer] - safety[opponent]) +
      (territory[rootPlayer] - territory[opponent]) * 0.9 +
      (stones[rootPlayer] - stones[opponent]) * 0.12;
  }
  // Smooth bounded values preserve useful information from unfinished lines.
  const scale = Math.max(4, game.size * 0.75);
  return 0.5 + 0.5 * Math.tanh(difference / scale);
}

function rollout(state, rootPlayer, settings) {
  const game = GoEngine.fromState(state);
  for (let ply = 0; ply < settings.rolloutLimit; ply += 1) {
    cancellationCheck(settings);
    if (game.phase !== PHASE_PLAY) break;
    playWeightedMove(game, settings);
  }
  return evaluate(game, rootPlayer);
}

function runIteration(root, rootPlayer, settings) {
  let node = root;
  const path = [root];

  while (node.state.phase === PHASE_PLAY) {
    cancellationCheck(settings);
    const child = expand(node, settings);
    if (child) {
      node = child;
      path.push(node);
      break;
    }
    if (node.children.length === 0) break;
    node = selectChild(
      node,
      rootPlayer,
      settings.exploration,
      settings.random,
      settings.rootPolicy !== null,
    );
    path.push(node);
  }

  const reward = rollout(node.state, rootPlayer, settings);
  for (const visited of path) {
    visited.visits += 1;
    visited.value += reward;
  }
}

function fallbackMove(state, settings) {
  const game = GoEngine.fromState(state);
  const ranked = rankedMoveEntries(
    game,
    settings,
    Math.max(settings.candidateLimit, emptyPointMoves(state).length),
    true,
    true,
    settings.rootPolicy,
  );
  for (const entry of ranked) {
    cancellationCheck(settings);
    if (applyMove(game, entry.move).ok) return copyMove(entry.move);
  }
  return { type: "pass" };
}

function chooseMostVisited(root, fallback) {
  if (root.children.length === 0) return { move: fallback, child: null };
  let pool = root.children;
  const avoidsImmediateNetLoss = pool.filter(
    (child) => child.snapbackLoss <= child.capturedStones,
  );
  if (avoidsImmediateNetLoss.length > 0) pool = avoidsImmediateNetLoss;
  const forcingValue = Math.max(
    0,
    ...pool.map(
      (child) =>
        child.resultingLiberties >= 2
          ? child.capturedStones * 1.1 + child.rescuedStones
          : 0,
    ),
  );
  // Urgent captures and rescues should not be voted down by noisy short
  // rollouts, but compare their actual scale. A one-stone capture must not
  // force the AI to abandon a much larger friendly string in atari.
  if (forcingValue > 0) {
    pool = pool.filter(
      (child) =>
        child.resultingLiberties >= 2 &&
        child.capturedStones * 1.1 + child.rescuedStones === forcingValue,
    );
  }
  const children = [...pool].sort((left, right) => {
    if (forcingValue > 0 && right.heuristic !== left.heuristic) {
      return right.heuristic - left.heuristic;
    }
    if (right.visits !== left.visits) return right.visits - left.visits;
    const leftMean = left.visits === 0 ? 0 : left.value / left.visits;
    const rightMean = right.visits === 0 ? 0 : right.value / right.visits;
    return rightMean - leftMean;
  });
  return { move: copyMove(children[0].move), child: children[0] };
}

function createSearch(gameOrState, options) {
  const state = normalizeState(gameOrState);
  if (state.phase !== PHASE_PLAY) {
    throw new RangeError("The AI can only choose a move while play is active");
  }
  const settings = normalizeOptions(options, state.size);
  cancellationCheck(settings);
  const fallback = fallbackMove(state, settings);
  return {
    state,
    root: createNode(state),
    rootPlayer: state.currentPlayer,
    settings,
    fallback,
    startedAt: settings.clock(),
    completed: 0,
  };
}

function canContinue(search) {
  if (search.completed >= search.settings.iterations) return false;
  // Always perform one iteration, even with a zero-millisecond budget, so a
  // tiny UI budget still returns a searched rather than arbitrary move.
  return (
    search.completed === 0 ||
    search.settings.timeLimitMs === Infinity ||
    search.settings.clock() - search.startedAt < search.settings.timeLimitMs
  );
}

function stepSearch(search) {
  cancellationCheck(search.settings);
  runIteration(search.root, search.rootPlayer, search.settings);
  search.completed += 1;
}

function finishSearch(search) {
  cancellationCheck(search.settings);
  const selected = chooseMostVisited(search.root, search.fallback);
  const elapsedMs = Math.max(0, search.settings.clock() - search.startedAt);
  const priorMass = search.settings.rootPolicy
    ? rootPriorMass(search.root)
    : 0;
  const candidates = [...search.root.children]
    .sort((left, right) => right.visits - left.visits)
    .map((child) => ({
      move: copyMove(child.move),
      visits: child.visits,
      winRate: child.visits === 0 ? 0.5 : child.value / child.visits,
      resultingLiberties: child.resultingLiberties,
      snapbackLoss: child.snapbackLoss,
      neuralPrior: child.neuralPrior,
      rootPriorShare:
        priorMass > 0 ? child.neuralPrior / priorMass : 0,
      rootPuctBonus: rootPuctBonus(search.root, child, priorMass),
    }));

  return {
    move: selected.move,
    stats: {
      difficulty: search.settings.difficulty,
      iterations: search.completed,
      elapsedMs,
      rootPlayer: search.rootPlayer,
      visits: selected.child?.visits ?? 0,
      winRate:
        selected.child && selected.child.visits > 0
          ? selected.child.value / selected.child.visits
          : 0.5,
      rootPolicyUsed: search.settings.rootPolicy !== null,
      selectedNeuralPrior: selected.child?.neuralPrior ?? 0,
      candidates,
    },
  };
}

/**
 * Synchronous MCTS search. Use shouldCancel for cooperative cancellation.
 * Browser UI code should normally call the async version through mctsWorker.
 */
export function chooseMonteCarloMove(gameOrState, options = {}) {
  const search = createSearch(gameOrState, options);
  while (canContinue(search)) stepSearch(search);
  return finishSearch(search);
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Async MCTS search that yields so AbortSignal and Worker cancel messages work. */
export async function chooseMonteCarloMoveAsync(gameOrState, options = {}) {
  const search = createSearch(gameOrState, options);
  while (canContinue(search)) {
    stepSearch(search);
    if (search.completed % search.settings.yieldEveryIterations === 0) {
      search.settings.onProgress?.({
        iterations: search.completed,
        elapsedMs: search.settings.clock() - search.startedAt,
      });
      await yieldToEventLoop();
    }
  }
  return finishSearch(search);
}

export default chooseMonteCarloMove;

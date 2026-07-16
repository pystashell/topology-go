import {
  BLACK,
  GoEngine,
  SCORING_CHINESE,
  WHITE,
} from "../../game/goEngine.js";

export const KATAGO_SPATIAL_CHANNELS = 22;
export const KATAGO_GLOBAL_CHANNELS = 19;

function featureIndex(size, row, col, channel) {
  return (row * size + col) * KATAGO_SPATIAL_CHANNELS + channel;
}

function pointKey(row, col) {
  return `${row},${col}`;
}

/**
 * Build KataGo v7 inputs from the authoritative cylindrical GoEngine state.
 *
 * The copied model uses NHWC tensors. Group liberties come from GoEngine, so
 * strings crossing columns 0/size-1 have the same liberty features here as in
 * actual play. We intentionally leave ladder and long move-history planes
 * empty because the compact game snapshot does not store enough information
 * to reconstruct them without weakening superko authority.
 */
export function buildCylinderFeatures(gameOrState) {
  const game =
    gameOrState instanceof GoEngine
      ? GoEngine.fromState(gameOrState.exportState())
      : GoEngine.fromState(gameOrState);
  const { size } = game;
  const spatial = new Float32Array(
    size * size * KATAGO_SPATIAL_CHANNELS,
  );
  const global = new Float32Array(KATAGO_GLOBAL_CHANNELS);
  const player = game.currentPlayer;
  const opponent = player === BLACK ? WHITE : BLACK;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      spatial[featureIndex(size, row, col, 0)] = 1;
    }
  }

  const liberties = new Uint8Array(size * size);
  const visited = new Set();
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (game.get(row, col) === null || visited.has(pointKey(row, col))) {
        continue;
      }
      const group = game.getGroup(row, col);
      const count = Math.min(4, group.liberties.length);
      for (const stone of group.stones) {
        visited.add(pointKey(stone.row, stone.col));
        liberties[stone.row * size + stone.col] = count;
      }
    }
  }

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const color = game.get(row, col);
      if (color === null) continue;
      spatial[featureIndex(size, row, col, color === player ? 1 : 2)] = 1;
      const count = liberties[row * size + col];
      if (count >= 1 && count <= 3) {
        spatial[featureIndex(size, row, col, count + 2)] = 1;
      }
    }
  }

  // A positional-superko point cannot be represented by KataGo's single-ko
  // plane, so exact legality remains the responsibility of GoEngine. The most
  // recent ordinary move is still useful as the first history plane.
  if (game.lastMove?.type === "play" && game.lastMove.color === opponent) {
    spatial[
      featureIndex(size, game.lastMove.row, game.lastMove.col, 9)
    ] = 1;
  } else if (game.lastMove?.type === "pass") {
    global[0] = 1;
  }

  const selfKomi = player === WHITE ? game.komi : -game.komi;
  global[5] = selfKomi / 20;
  // KataGo v7 rule features: positional superko is represented by the two
  // ko-rule inputs below. Exact repetition checks are still done by GoEngine.
  global[6] = 1;
  global[7] = 0.5;

  if (game.scoringRule !== SCORING_CHINESE) {
    global[9] = 1; // territory scoring
  } else {
    const drawableKomisAreEven = (size * size) % 2 === 0;
    const komiFloor = drawableKomisAreEven
      ? Math.floor(selfKomi / 2) * 2
      : Math.floor((selfKomi - 1) / 2) * 2 + 1;
    const delta = Math.max(0, Math.min(2, selfKomi - komiFloor));
    global[18] =
      delta < 0.5 ? delta : delta < 1.5 ? 1 - delta : delta - 2;
  }
  global[14] = game.consecutivePasses === 1 ? 1 : 0;

  return { size, spatial, global };
}

/**
 * Return one exact GoEngine legality flag per point plus pass.
 *
 * KataGo was trained for a different topology, and its policy head does not
 * know this game's positional-superko history. Clone the complete state for
 * every probe so the same cylindrical capture, suicide and repetition rules
 * used by actual play remain authoritative without mutating the live game.
 */
export function buildLegalPolicyMask(gameOrState) {
  const game =
    gameOrState instanceof GoEngine
      ? GoEngine.fromState(gameOrState.exportState())
      : GoEngine.fromState(gameOrState);
  const state = game.exportState();
  const pointCount = game.size * game.size;
  const mask = new Uint8Array(pointCount + 1);

  for (let row = 0; row < game.size; row += 1) {
    for (let col = 0; col < game.size; col += 1) {
      if (game.get(row, col) !== null) continue;
      const trial = GoEngine.fromState(state);
      if (trial.play(row, col).ok) mask[row * game.size + col] = 1;
    }
  }

  const passTrial = GoEngine.fromState(state);
  if (passTrial.pass().ok) mask[pointCount] = 1;
  return mask;
}

/**
 * Convert KataGo policy logits into an exactly legal root distribution.
 *
 * Masking happens before finding the softmax maximum and denominator. This is
 * important: even an enormous logit on an occupied, suicidal or superko point
 * must not flatten the legal priors or change their ordering.
 */
export function policyPriorsFromLogits({
  policy,
  pass,
  gameOrState,
  policyChannels,
}) {
  const game =
    gameOrState instanceof GoEngine
      ? GoEngine.fromState(gameOrState.exportState())
      : GoEngine.fromState(gameOrState);
  const { size } = game;
  const pointCount = size * size;
  if (!Number.isInteger(policyChannels) || policyChannels < 1) {
    throw new RangeError("policyChannels must be a positive integer");
  }
  if (policy.length < pointCount * policyChannels) {
    throw new RangeError("policy tensor is smaller than the board");
  }
  if (pass.length < policyChannels) {
    throw new RangeError("pass tensor has no policy channel");
  }

  const mask = buildLegalPolicyMask(game);
  const logits = new Float64Array(pointCount + 1);
  let maximum = -Infinity;
  for (let index = 0; index < pointCount; index += 1) {
    if (!mask[index]) continue;
    const value = Number(policy[index * policyChannels]);
    if (!Number.isFinite(value)) {
      throw new Error("KataGo returned a non-finite legal policy logit");
    }
    logits[index] = value;
    maximum = Math.max(maximum, value);
  }
  if (mask[pointCount]) {
    const passValue = Number(pass[0]);
    if (!Number.isFinite(passValue)) {
      throw new Error("KataGo returned a non-finite pass logit");
    }
    logits[pointCount] = passValue;
    maximum = Math.max(maximum, passValue);
  }
  if (!Number.isFinite(maximum)) {
    throw new Error("The current game state has no legal policy action");
  }

  let total = 0;
  for (let index = 0; index < logits.length; index += 1) {
    if (!mask[index]) continue;
    const probability = Math.exp(logits[index] - maximum);
    logits[index] = probability;
    total += probability;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error("KataGo returned an invalid policy distribution");
  }
  const priors = new Float32Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    if (mask[index]) priors[index] = logits[index] / total;
  }
  return priors;
}

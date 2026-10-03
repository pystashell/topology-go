// The production Worker expands at most candidateLimit + pass = 25 root
// children. Keep that existing candidate-stat surface intact, but attach tree
// continuations to only the first five records.
export const SEARCH_CANDIDATE_LIMIT = 25;
export const SEARCH_VARIATION_CANDIDATE_LIMIT = 5;
export const SEARCH_VARIATION_LIMIT = 8;

const CANDIDATE_NUMBER_FIELDS = Object.freeze([
  "visits",
  "winRate",
  "resultingLiberties",
  "snapbackLoss",
  "neuralPrior",
  "rootPriorShare",
  "rootPuctBonus",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSearchMove(move) {
  if (move?.type === "pass") return { type: "pass" };
  if (
    move?.type === "play" &&
    Number.isSafeInteger(move.row) &&
    move.row >= 0 &&
    Number.isSafeInteger(move.col) &&
    move.col >= 0
  ) {
    return { type: "play", row: move.row, col: move.col };
  }
  return null;
}

export function searchMoveKey(move) {
  const normalized = normalizeSearchMove(move);
  if (!normalized) return null;
  return normalized.type === "pass"
    ? "pass"
    : `play:${normalized.row}:${normalized.col}`;
}

/**
 * Return a structured-clone-safe, bounded PV. The candidate itself is always
 * the first ply, even when an older or malformed producer omitted it.
 */
export function normalizeSearchVariation(
  candidateMove,
  variation,
  limit = SEARCH_VARIATION_LIMIT,
) {
  const first = normalizeSearchMove(candidateMove);
  if (!first) return [];
  const safeLimit = Math.max(
    1,
    Math.min(
      SEARCH_VARIATION_LIMIT,
      Number.isSafeInteger(limit) ? limit : SEARCH_VARIATION_LIMIT,
    ),
  );
  const normalized = [];
  if (Array.isArray(variation)) {
    for (const move of variation) {
      const safeMove = normalizeSearchMove(move);
      if (!safeMove) continue;
      normalized.push(safeMove);
      if (normalized.length >= safeLimit) break;
    }
  }
  if (searchMoveKey(normalized[0]) !== searchMoveKey(first)) {
    normalized.unshift(first);
  } else {
    normalized[0] = first;
  }
  return normalized.slice(0, safeLimit);
}

/** Strip unknown candidate payload fields and enforce the worker wire bounds. */
export function boundSearchCandidates(
  candidates,
  {
    candidateLimit = SEARCH_CANDIDATE_LIMIT,
    variationCandidateLimit = SEARCH_VARIATION_CANDIDATE_LIMIT,
    variationLimit = SEARCH_VARIATION_LIMIT,
  } = {},
) {
  if (!Array.isArray(candidates)) return [];
  const safeCandidateLimit = Math.max(
    1,
    Math.min(
      SEARCH_CANDIDATE_LIMIT,
      Number.isSafeInteger(candidateLimit)
        ? candidateLimit
        : SEARCH_CANDIDATE_LIMIT,
    ),
  );
  const safeVariationCandidateLimit = Math.max(
    0,
    Math.min(
      SEARCH_VARIATION_CANDIDATE_LIMIT,
      Number.isSafeInteger(variationCandidateLimit)
        ? variationCandidateLimit
        : SEARCH_VARIATION_CANDIDATE_LIMIT,
    ),
  );
  const hasExplicitVariations = candidates.some(
    (candidate) => isRecord(candidate) && Array.isArray(candidate.variation),
  );
  let variationCount = 0;
  const result = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const move = normalizeSearchMove(candidate.move);
    if (!move) continue;
    const safe = { move };
    const shouldCarryVariation =
      variationCount < safeVariationCandidateLimit &&
      (Array.isArray(candidate.variation) ||
        (!hasExplicitVariations && result.length < safeVariationCandidateLimit));
    if (shouldCarryVariation) {
      safe.variation = normalizeSearchVariation(
        move,
        candidate.variation,
        variationLimit,
      );
      variationCount += 1;
    }
    for (const field of CANDIDATE_NUMBER_FIELDS) {
      if (typeof candidate[field] === "number" && !Number.isNaN(candidate[field])) {
        safe[field] = candidate[field];
      }
    }
    result.push(safe);
    if (result.length >= safeCandidateLimit) break;
  }
  return result;
}

/** Preserve ordinary top-level stats while bounding the transferable tree data. */
export function boundSearchStats(stats) {
  if (!isRecord(stats)) return {};
  if (!Object.hasOwn(stats, "candidates")) return { ...stats };
  return {
    ...stats,
    candidates: boundSearchCandidates(stats.candidates),
  };
}

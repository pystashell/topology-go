import {
  boundSearchCandidates,
  normalizeSearchMove,
  normalizeSearchVariation,
  SEARCH_CANDIDATE_LIMIT,
  SEARCH_VARIATION_CANDIDATE_LIMIT,
  SEARCH_VARIATION_LIMIT,
  searchMoveKey,
} from "./searchStats.js";
import {
  formatGoColumn,
  MAX_BOARD_DIMENSION,
} from "../game/boardDimensions.js";

export const REVIEW_CANDIDATE_LIMIT = SEARCH_VARIATION_CANDIDATE_LIMIT;
export const REVIEW_VARIATION_LIMIT = SEARCH_VARIATION_LIMIT;

function moveKey(move) {
  return searchMoveKey(move);
}

function clampUnit(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function safeVisits(value) {
  const visits = Number(value);
  return Number.isFinite(visits) ? Math.max(0, visits) : 0;
}

function boundedLimit(value, fallback = REVIEW_CANDIDATE_LIMIT) {
  return Math.max(
    1,
    Math.min(
      REVIEW_CANDIDATE_LIMIT,
      Number.isSafeInteger(value) ? value : fallback,
    ),
  );
}

function candidateKey(value) {
  if (typeof value === "string") return value;
  return moveKey(value?.move ?? value);
}

export function sameReviewMove(left, right) {
  const leftKey = moveKey(left);
  return leftKey !== null && leftKey === moveKey(right);
}

/** Compare the recorded continuation with one bounded AI search. */
export function compareReviewMove(actualMove, recommendation, candidates = []) {
  if (!actualMove) return { kind: "none", rank: null, candidateCount: 0 };
  if (sameReviewMove(actualMove, recommendation)) {
    return { kind: "match", rank: 1, candidateCount: candidates.length };
  }
  const index = candidates.findIndex((candidate) =>
    sameReviewMove(actualMove, candidate?.move)
  );
  return {
    kind: index >= 0 ? "candidate" : "outside",
    rank: index >= 0 ? index + 1 : null,
    candidateCount: candidates.length,
  };
}

export function topReviewCandidates(stats, limit = 3, recommendation = null) {
  const candidates = Array.isArray(stats?.candidates) ? stats.candidates : [];
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 3;
  const valid = candidates.filter((candidate) => moveKey(candidate?.move) !== null);
  if (moveKey(recommendation) === null) return valid.slice(0, safeLimit);

  const recommended = valid.find((candidate) =>
    sameReviewMove(candidate.move, recommendation)
  ) ?? {
    move: recommendation,
    visits: Number(stats?.visits) || 0,
    winRate: Number(stats?.winRate) || 0.5,
  };
  return [
    recommended,
    ...valid.filter((candidate) => !sameReviewMove(candidate.move, recommendation)),
  ].slice(0, safeLimit);
}

export function candidateVisitShare(candidate, candidates = []) {
  const total = candidates.reduce(
    (sum, item) => sum + safeVisits(item?.visits),
    0,
  );
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, safeVisits(candidate?.visits) / total));
}

/** Return a bounded PV, repairing legacy candidates that have no first ply. */
export function reviewVariation(candidate, limit = REVIEW_VARIATION_LIMIT) {
  return normalizeSearchVariation(
    candidate?.move,
    candidate?.variation,
    Math.max(
      1,
      Math.min(
        REVIEW_VARIATION_LIMIT,
        Number.isSafeInteger(limit) ? limit : REVIEW_VARIATION_LIMIT,
      ),
    ),
  );
}

export function formatReviewMove(move, height = 19) {
  const normalized = normalizeSearchMove(move);
  if (!normalized) return "—";
  if (normalized.type === "pass") return "停一手";
  if (
    !Number.isSafeInteger(height) ||
    height < 1 ||
    normalized.row >= height ||
    normalized.col >= MAX_BOARD_DIMENSION
  ) {
    return "—";
  }
  const column = formatGoColumn(normalized.col);
  return column ? `${column}${height - normalized.row}` : "—";
}

export function formatReviewVariation(
  candidate,
  {
    height = 19,
    limit = REVIEW_VARIATION_LIMIT,
    separator = " → ",
  } = {},
) {
  return reviewVariation(candidate, limit)
    .map((move) => formatReviewMove(move, height))
    .join(separator);
}

/**
 * Produce stable, display-ready candidate records without trusting Worker
 * payload shape. The recommendation is promoted to rank 1, matching the move
 * the engine will actually play even when a tactical safeguard beat visit rank.
 */
export function normalizeReviewCandidates(
  stats,
  { limit = REVIEW_CANDIDATE_LIMIT, recommendation = null } = {},
) {
  const safeLimit = boundedLimit(limit);
  const candidates = boundSearchCandidates(stats?.candidates, {
    candidateLimit: SEARCH_CANDIDATE_LIMIT,
    variationLimit: REVIEW_VARIATION_LIMIT,
  });
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = moveKey(candidate.move);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  const recommendationKey = moveKey(recommendation);
  let ordered = unique;
  if (recommendationKey !== null) {
    const existing = unique.find((candidate) =>
      sameReviewMove(candidate.move, recommendation)
    );
    const recommended = existing ?? boundSearchCandidates([
      {
        move: recommendation,
        visits: safeVisits(stats?.visits),
        winRate: clampUnit(stats?.winRate),
      },
    ], { candidateLimit: 1 })[0];
    if (recommended) {
      ordered = [
        recommended,
        ...unique.filter((candidate) => candidate !== existing),
      ];
    }
  }

  const visible = ordered.slice(0, safeLimit);
  const candidateVisits = unique.reduce(
    (sum, candidate) => sum + safeVisits(candidate.visits),
    0,
  );
  const rootVisits = safeVisits(stats?.rootVisits ?? stats?.iterations);
  const totalVisits = rootVisits > 0 ? rootVisits : candidateVisits;
  return visible.map((candidate, index) => {
    const visits = safeVisits(candidate.visits);
    const winRate = clampUnit(candidate.winRate);
    const visitShare = totalVisits > 0
      ? Math.max(0, Math.min(1, visits / totalVisits))
      : 0;
    return {
      ...candidate,
      key: moveKey(candidate.move),
      rank: index + 1,
      visits,
      winRate,
      winRatePercent: Math.round(winRate * 100),
      visitShare,
      visitSharePercent: Math.round(visitShare * 100),
      variation: reviewVariation(candidate),
    };
  });
}

export function reviewCandidateSummary(
  candidate,
  candidates = [],
  { height = 19, rank = null } = {},
) {
  const move = normalizeSearchMove(candidate?.move);
  if (!move) return null;
  const variation = reviewVariation(candidate);
  const resolvedRank = Number.isSafeInteger(rank) && rank > 0
    ? rank
    : candidates.findIndex((item) => sameReviewMove(item?.move, move)) + 1;
  const winRate = clampUnit(candidate?.winRate);
  const suppliedShare = Number(candidate?.visitShare);
  const visitShare = Number.isFinite(suppliedShare)
    ? Math.max(0, Math.min(1, suppliedShare))
    : candidateVisitShare(candidate, candidates);
  const variationLabels = variation.map((item) => formatReviewMove(item, height));
  return {
    key: moveKey(move),
    rank: resolvedRank > 0 ? resolvedRank : null,
    move,
    moveLabel: formatReviewMove(move, height),
    visits: safeVisits(candidate?.visits),
    winRate,
    winRatePercent: Math.round(winRate * 100),
    visitShare,
    visitSharePercent: Math.round(visitShare * 100),
    variation,
    variationLabels,
    variationText: variationLabels.join(" → "),
  };
}

function candidateKeys(candidates) {
  return new Set(
    candidates
      .map((candidate) => candidateKey(candidate))
      .filter((key) => key !== null),
  );
}

/**
 * Hover temporarily overrides a pinned line; leaving restores the pin. This
 * reducer contains no DOM state, so the main thread can use it for mouse,
 * keyboard and touch candidate interactions alike.
 */
export function createReviewCandidateState(candidates = [], initial = {}) {
  const valid = candidateKeys(candidates);
  const hoveredKey = valid.has(initial?.hoveredKey) ? initial.hoveredKey : null;
  const pinnedKey = valid.has(initial?.pinnedKey) ? initial.pinnedKey : null;
  return {
    hoveredKey,
    pinnedKey,
    activeKey: hoveredKey ?? pinnedKey,
  };
}

export function reduceReviewCandidateState(state, action, candidates = []) {
  const current = createReviewCandidateState(candidates, state);
  const requestedKey = candidateKey(
    action?.candidate ?? action?.move ?? action?.key ?? null,
  );
  const valid = candidateKeys(candidates);
  let next = current;
  if (action?.type === "hover") {
    next = { ...current, hoveredKey: valid.has(requestedKey) ? requestedKey : null };
  } else if (action?.type === "leave") {
    next = { ...current, hoveredKey: null };
  } else if (action?.type === "toggle-pin" && valid.has(requestedKey)) {
    next = {
      ...current,
      pinnedKey: current.pinnedKey === requestedKey ? null : requestedKey,
    };
  } else if (action?.type === "clear") {
    next = { hoveredKey: null, pinnedKey: null };
  }
  return createReviewCandidateState(candidates, next);
}

export function activeReviewCandidate(state, candidates = []) {
  const normalized = createReviewCandidateState(candidates, state);
  if (!normalized.activeKey) return null;
  return candidates.find(
    (candidate) => candidateKey(candidate) === normalized.activeKey,
  ) ?? null;
}

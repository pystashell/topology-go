function moveKey(move) {
  if (move?.type === "pass") return "pass";
  if (
    move?.type === "play" &&
    Number.isInteger(move.row) &&
    Number.isInteger(move.col)
  ) {
    return `play:${move.row}:${move.col}`;
  }
  return null;
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
    (sum, item) => sum + Math.max(0, Number(item?.visits) || 0),
    0,
  );
  if (total <= 0) return 0;
  return Math.max(0, Number(candidate?.visits) || 0) / total;
}

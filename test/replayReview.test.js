import test from "node:test";
import assert from "node:assert/strict";

import {
  activeReviewCandidate,
  candidateVisitShare,
  compareReviewMove,
  createReviewCandidateState,
  formatReviewMove,
  formatReviewVariation,
  normalizeReviewCandidates,
  reduceReviewCandidateState,
  reviewCandidateSummary,
  sameReviewMove,
  topReviewCandidates,
} from "../src/ai/replayReview.js";

const candidates = [
  { move: { type: "play", row: 3, col: 3 }, visits: 60 },
  { move: { type: "play", row: 2, col: 2 }, visits: 30 },
  { move: { type: "pass" }, visits: 10 },
];

test("review move comparison handles play and pass moves", () => {
  assert.equal(
    sameReviewMove(
      { type: "play", row: 3, col: 3 },
      { type: "play", row: 3, col: 3 },
    ),
    true,
  );
  assert.equal(sameReviewMove({ type: "pass" }, { type: "pass" }), true);
  assert.equal(sameReviewMove(null, null), false);
});

test("review comparison distinguishes recommendation, candidate, and outside", () => {
  const recommendation = candidates[0].move;
  assert.deepEqual(
    compareReviewMove(recommendation, recommendation, candidates),
    { kind: "match", rank: 1, candidateCount: 3 },
  );
  assert.deepEqual(
    compareReviewMove(candidates[1].move, recommendation, candidates),
    { kind: "candidate", rank: 2, candidateCount: 3 },
  );
  assert.deepEqual(
    compareReviewMove(
      { type: "play", row: 4, col: 4 },
      recommendation,
      candidates,
    ),
    { kind: "outside", rank: null, candidateCount: 3 },
  );
  assert.equal(compareReviewMove(null, recommendation, candidates).kind, "none");
});

test("candidate helpers keep the leading moves and calculate visit share", () => {
  assert.deepEqual(topReviewCandidates({ candidates }, 2), candidates.slice(0, 2));
  assert.deepEqual(
    topReviewCandidates({ candidates }, 2, candidates[1].move),
    [candidates[1], candidates[0]],
  );
  assert.deepEqual(
    topReviewCandidates(
      { candidates, visits: 4, winRate: 0.61 },
      1,
      { type: "play", row: 4, col: 4 },
    ),
    [{ move: { type: "play", row: 4, col: 4 }, visits: 4, winRate: 0.61 }],
  );
  assert.equal(candidateVisitShare(candidates[0], candidates), 0.6);
  assert.equal(candidateVisitShare({ visits: 0 }, []), 0);
});

test("display candidates expose bounded ranks, metrics, and rectangular PV labels", () => {
  const longVariation = [
    { type: "play", row: 0, col: 0 },
    ...Array.from({ length: 10 }, (_, index) => ({
      type: "play",
      row: index % 11,
      col: (index + 1) % 9,
    })),
    { type: "pass" },
  ];
  const raw = Array.from({ length: 7 }, (_, index) => ({
    move: { type: "play", row: 10 - index, col: 8 - index },
    visits: 70 - index * 10,
    winRate: index === 0 ? 4 : 0.4 + index / 20,
    variation: longVariation,
  }));
  const normalized = normalizeReviewCandidates(
    { candidates: raw },
    { recommendation: raw[1].move },
  );

  assert.equal(normalized.length, 5);
  assert.deepEqual(normalized[0].move, raw[1].move);
  assert.deepEqual(normalized.map((candidate) => candidate.rank), [1, 2, 3, 4, 5]);
  const visibleShare = normalized.reduce((sum, item) => sum + item.visitShare, 0);
  assert.ok(visibleShare > 0 && visibleShare < 1);
  assert.ok(normalized.every((candidate) => candidate.variation.length <= 8));
  assert.ok(normalized.every((candidate) => sameReviewMove(candidate.variation[0], candidate.move)));
  assert.equal(normalized.find((candidate) => sameReviewMove(candidate.move, raw[0].move)).winRate, 1);

  const summary = reviewCandidateSummary(normalized[0], normalized, { height: 11 });
  assert.equal(summary.moveLabel, "H2");
  assert.equal(summary.variationLabels[0], "H2");
  assert.equal(summary.rank, 1);
  assert.match(summary.variationText, / → /u);
  assert.equal(formatReviewMove({ type: "play", row: 10, col: 8 }, 11), "J1");
  assert.equal(formatReviewMove({ type: "pass" }, 11), "停一手");
  assert.equal(
    formatReviewVariation(
      { move: { type: "pass" }, variation: [{ type: "pass" }] },
      { height: 11 },
    ),
    "停一手",
  );
});

test("AI review labels cover extended columns on 30x20 boards", () => {
  assert.equal(formatReviewMove({ type: "play", row: 19, col: 25 }, 20), "AA1");
  assert.equal(formatReviewMove({ type: "play", row: 0, col: 29 }, 20), "AE20");
  assert.equal(formatReviewMove({ type: "play", row: 0, col: 30 }, 20), "—");
});

test("candidate interaction state restores a pin after hover and drops stale lines", () => {
  const normalized = normalizeReviewCandidates({ candidates });
  assert.deepEqual(normalized[0].variation, [normalized[0].move]);
  let state = createReviewCandidateState(normalized);
  assert.deepEqual(state, { hoveredKey: null, pinnedKey: null, activeKey: null });

  state = reduceReviewCandidateState(
    state,
    { type: "toggle-pin", candidate: normalized[1] },
    normalized,
  );
  assert.equal(activeReviewCandidate(state, normalized), normalized[1]);

  state = reduceReviewCandidateState(
    state,
    { type: "hover", candidate: normalized[0] },
    normalized,
  );
  assert.equal(activeReviewCandidate(state, normalized), normalized[0]);

  state = reduceReviewCandidateState(state, { type: "leave" }, normalized);
  assert.equal(activeReviewCandidate(state, normalized), normalized[1]);

  const replaced = normalizeReviewCandidates({ candidates: [candidates[2]] });
  state = createReviewCandidateState(replaced, state);
  assert.deepEqual(state, { hoveredKey: null, pinnedKey: null, activeKey: null });
});

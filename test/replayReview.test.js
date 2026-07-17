import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateVisitShare,
  compareReviewMove,
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

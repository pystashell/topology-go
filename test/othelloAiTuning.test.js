import assert from "node:assert/strict";
import test from "node:test";

import {
  FEATURE_COUNT,
  PHASE_KNOTS,
  knotWeights,
} from "../src/ai/othello/othelloEval.js";
import { createRandom } from "../src/ai/othello/othelloGeometry.js";
import {
  collectSamples,
  fitWeights,
  meanSquaredError,
} from "../src/ai/othello/othelloTuning.js";
import { FITTED_WEIGHTS } from "../src/ai/othello/othelloWeights.js";

test("othello AI weight fit recovers known weights from synthetic samples", () => {
  const random = createRandom(42);
  const truth = PHASE_KNOTS.map((_, knot) =>
    Array.from({ length: FEATURE_COUNT }, (_, feature) => (knot + 1) * 10 - feature * 7),
  );
  const samples = { features: [], phase: [], y: [] };
  const knots = new Float64Array(PHASE_KNOTS.length);
  for (let index = 0; index < 4000; index += 1) {
    const features = Array.from({ length: FEATURE_COUNT }, () => random() * 2 - 1);
    const phase = random();
    knotWeights(phase, knots);
    let y = 0;
    knots.forEach((weight, knot) => {
      features.forEach((value, feature) => {
        y += weight * value * truth[knot][feature];
      });
    });
    samples.features.push(features);
    samples.phase.push(phase);
    samples.y.push(y);
  }
  const fitted = fitWeights(samples, 1e-6);
  fitted.forEach((row, knot) =>
    row.forEach((value, feature) => assert.ok(Math.abs(value - truth[knot][feature]) <= 1)),
  );
  assert.ok(meanSquaredError(samples, fitted) < 1);
});

test("othello AI self-play samples are labelled from the side to move", () => {
  const samples = collectSamples({ kind: "torus", width: 6, height: 6, games: 2, seed: 3 });
  assert.ok(samples.y.length > 10);
  assert.equal(samples.features.length, samples.y.length);
  for (let index = 0; index < samples.y.length; index += 1) {
    assert.equal(samples.features[index].length, FEATURE_COUNT);
    assert.ok(samples.phase[index] >= 0 && samples.phase[index] <= 1);
    assert.ok(Math.abs(samples.y[index]) <= 1000);
  }
});

test("othello AI weights cover every topology and phase knot", () => {
  for (const kind of ["cylinder", "torus", "mobius"]) {
    assert.equal(FITTED_WEIGHTS[kind].length, PHASE_KNOTS.length);
    for (const row of FITTED_WEIGHTS[kind]) {
      assert.equal(row.length, FEATURE_COUNT);
      assert.ok(row.every(Number.isFinite));
    }
  }
  // The torus has no boundary rows, so their weights are unused there.
  for (const row of FITTED_WEIGHTS.torus) assert.deepEqual(row.slice(4, 7), [0, 0, 0]);
});

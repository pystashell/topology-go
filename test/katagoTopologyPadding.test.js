import assert from "node:assert/strict";
import test from "node:test";

import * as tf from "@tensorflow/tfjs";

import { padSpatialForTopology } from "../src/ai/katago/vendor/modelV8.ts";

test("KataGo Mobius convolution padding reverses rows at both column halos", async () => {
  const input = tf.tensor4d(
    [
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ],
    [1, 3, 3, 1],
  );
  const padded = padSpatialForTopology(input, 1, 1, "mobius");
  assert.deepEqual(padded.shape, [1, 5, 5, 1]);
  assert.deepEqual(Array.from(await padded.data()), [
    0, 0, 0, 0, 0,
    9, 1, 2, 3, 7,
    6, 4, 5, 6, 4,
    3, 7, 8, 9, 1,
    0, 0, 0, 0, 0,
  ]);
  input.dispose();
  padded.dispose();
});

test("KataGo cylinder padding keeps ordinary row orientation", async () => {
  const input = tf.tensor4d(
    [
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ],
    [1, 3, 3, 1],
  );
  const padded = padSpatialForTopology(input, 1, 1, "cylinder");
  assert.deepEqual(Array.from(await padded.data()), [
    0, 0, 0, 0, 0,
    3, 1, 2, 3, 1,
    6, 4, 5, 6, 4,
    9, 7, 8, 9, 7,
    0, 0, 0, 0, 0,
  ]);
  input.dispose();
  padded.dispose();
});

test("KataGo topology padding preserves rectangular tensor axes", async () => {
  const input = tf.tensor4d(
    [
      1, 2, 3, 4,
      5, 6, 7, 8,
    ],
    [1, 2, 4, 1],
  );
  const cylinder = padSpatialForTopology(input, 1, 1, "cylinder");
  const torus = padSpatialForTopology(input, 1, 1, "torus");
  const mobius = padSpatialForTopology(input, 1, 1, "mobius");

  assert.deepEqual(cylinder.shape, [1, 4, 6, 1]);
  assert.deepEqual(torus.shape, [1, 4, 6, 1]);
  assert.deepEqual(mobius.shape, [1, 4, 6, 1]);
  assert.deepEqual(Array.from(await mobius.data()), [
    0, 0, 0, 0, 0, 0,
    8, 1, 2, 3, 4, 5,
    4, 5, 6, 7, 8, 1,
    0, 0, 0, 0, 0, 0,
  ]);

  input.dispose();
  cylinder.dispose();
  torus.dispose();
  mobius.dispose();
});

test("KataGo topology padding preserves a 30x20 board without cropping", () => {
  const input = tf.zeros([1, 20, 30, 22]);
  const cylinder = padSpatialForTopology(input, 1, 1, "cylinder");
  const torus = padSpatialForTopology(input, 1, 1, "torus");
  const mobius = padSpatialForTopology(input, 1, 1, "mobius");

  assert.deepEqual(cylinder.shape, [1, 22, 32, 22]);
  assert.deepEqual(torus.shape, [1, 22, 32, 22]);
  assert.deepEqual(mobius.shape, [1, 22, 32, 22]);

  input.dispose();
  cylinder.dispose();
  torus.dispose();
  mobius.dispose();
});

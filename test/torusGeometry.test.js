import assert from "node:assert/strict";
import test from "node:test";

import {
  TAU,
  TORUS_STONE_LIFT,
  TORUS_STONE_RADIUS,
  torusAnglesFromPoint,
  torusFrame,
  torusGridFrame,
  torusGridPointFromCartesian,
  torusInnerRingStoneGap,
  torusRadii,
} from "../src/view/torusGeometry.js";

const EPSILON = 1e-10;

function close(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
}

function circularDistance(left, right) {
  const direct = Math.abs(left - right) % TAU;
  return Math.min(direct, TAU - direct);
}

test("torusFrame matches the outer, top and inner cardinal points", () => {
  const majorRadius = 5;
  const minorRadius = 2;

  const outer = torusFrame(0, 0, majorRadius, minorRadius);
  assert.deepEqual(outer.position, { x: 7, y: 0, z: 0 });
  assert.deepEqual(outer.normal, { x: 1, y: 0, z: 0 });

  const top = torusFrame(0, Math.PI / 2, majorRadius, minorRadius);
  close(top.position.x, 5);
  close(top.position.y, 0);
  close(top.position.z, 2);
  close(top.normal.x, 0);
  close(top.normal.y, 0);
  close(top.normal.z, 1);

  const inner = torusFrame(0, Math.PI, majorRadius, minorRadius);
  close(inner.position.x, 3);
  close(inner.position.y, 0);
  close(inner.position.z, 0);
  close(inner.normal.x, -1);
});

test("normal offsets preserve angles and move exactly along the unit normal", () => {
  const base = torusFrame(1.1, 4.2, 6, 2);
  const raised = torusFrame(1.1, 4.2, 6, 2, 0.25);
  const normalLength = Math.hypot(
    base.normal.x,
    base.normal.y,
    base.normal.z,
  );
  close(normalLength, 1);
  close(raised.position.x - base.position.x, base.normal.x * 0.25);
  close(raised.position.y - base.position.y, base.normal.y * 0.25);
  close(raised.position.z - base.position.z, base.normal.z * 0.25);

  const inverted = torusAnglesFromPoint(raised.position, 6);
  close(circularDistance(inverted.u, 1.1), 0);
  close(circularDistance(inverted.v, 4.2), 0);
});

for (const size of [9, 13, 19, 25]) {
  test(`all ${size}x${size} torus grid points survive Cartesian roundtrip`, () => {
    const minorRadius = size / TAU;
    const majorRadius = minorRadius * 2.1;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const frame = torusGridFrame({
          row,
          col,
          size,
          majorRadius,
          minorRadius,
          offset: 0.125,
        });
        assert.deepEqual(
          torusGridPointFromCartesian(frame.position, size, majorRadius),
          { row, col },
        );
      }
    }
  });
}

function legacyTorusRadii(width, height) {
  const minorRadius = height / TAU;
  return {
    minorRadius,
    majorRadius: Math.max((width * 2.1) / TAU, minorRadius * 1.15),
  };
}

test("square torus boards keep their established proportions", () => {
  for (let size = 5; size <= 30; size += 1) {
    assert.deepEqual(
      torusRadii({ width: size, height: size }),
      legacyTorusRadii(size, size),
    );
  }
});

test("inner-equator stones never touch on any supported board shape", () => {
  for (let width = 5; width <= 30; width += 1) {
    for (let height = 5; height <= 30; height += 1) {
      const radii = torusRadii({ width, height });
      const gap = torusInnerRingStoneGap({ width, ...radii });
      assert.ok(
        gap >= TORUS_STONE_RADIUS * 0.15,
        `${width}x${height}: inner-ring gap ${gap.toFixed(3)}`,
      );
      // Neighbouring stone centres on the inner ring are at least one stone
      // diameter apart.
      const innerSpacing =
        2 *
        (radii.majorRadius - radii.minorRadius - TORUS_STONE_LIFT) *
        Math.sin(Math.PI / width);
      assert.ok(innerSpacing >= TORUS_STONE_RADIUS * 2, `${width}x${height}`);
    }
  }
});

test("the old radii fused inner-ring stones on tall boards", () => {
  for (const [width, height] of [[13, 19], [7, 15]]) {
    assert.ok(
      torusInnerRingStoneGap({ width, ...legacyTorusRadii(width, height) }) < 0,
    );
    assert.ok(
      torusInnerRingStoneGap({ width, ...torusRadii({ width, height }) }) > 0,
    );
  }
});

for (const [width, height] of [[13, 19], [7, 15], [25, 9], [5, 30], [30, 5]]) {
  test(`all ${width}x${height} torus grid points survive Cartesian roundtrip`, () => {
    const { majorRadius, minorRadius } = torusRadii({ width, height });
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        for (const offset of [0, TORUS_STONE_LIFT]) {
          const frame = torusGridFrame({
            row,
            col,
            width,
            height,
            majorRadius,
            minorRadius,
            offset,
          });
          assert.deepEqual(
            torusGridPointFromCartesian(
              frame.position,
              width,
              height,
              majorRadius,
            ),
            { row, col },
          );
        }
      }
    }
  });
}

test("Mobius boards keep their own radii while tori widen narrow boards", async () => {
  const { MobiusBoard } = await import("../src/view/MobiusBoard.js");
  const { TorusBoard } = await import("../src/view/TorusBoard.js");
  for (const [width, height] of [[19, 19], [13, 19], [7, 15], [25, 9]]) {
    assert.deepEqual(
      MobiusBoard.prototype.boardRadii.call(null, width, height),
      legacyTorusRadii(width, height),
    );
    assert.deepEqual(
      TorusBoard.prototype.boardRadii.call(null, width, height),
      torusRadii({ width, height }),
    );
  }
});

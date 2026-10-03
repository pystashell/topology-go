import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBIUS_TAU,
  minimumMobiusNeighborDistance,
  mobiusBoardLayout,
  mobiusDifferentialFrame,
  mobiusGridFrame,
  mobiusGridPointFromUv,
  mobiusPoint,
} from "../src/view/mobiusGeometry.js";

function assertVectorClose(actual, expected, tolerance = 1e-9) {
  assert.ok(actual.distanceTo(expected) <= tolerance, `${actual.toArray()} != ${expected.toArray()}`);
}

test("Mobius surface joins one turn after reversing its width coordinate", () => {
  const majorRadius = 6;
  for (let index = 0; index <= 100; index += 1) {
    const v = -3.5 + (index / 100) * 7;
    assertVectorClose(
      mobiusPoint(MOBIUS_TAU, v, majorRadius),
      mobiusPoint(0, -v, majorRadius),
    );
    const endNormal = mobiusDifferentialFrame(
      MOBIUS_TAU,
      v,
      majorRadius,
    ).normal;
    const startNormal = mobiusDifferentialFrame(0, -v, majorRadius).normal;
    assert.ok(endNormal.dot(startNormal) < -0.999999);
  }
});

test("all supported Mobius grid frames are finite with unit local frames", () => {
  for (const size of [5, 6, 9, 10, 13, 19, 25]) {
    const majorRadius = size / 3;
    const halfWidth = majorRadius * 0.62;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const frame = mobiusGridFrame({
          row,
          col,
          height: size,
          width: size,
          majorRadius,
          halfWidth,
        });
        for (const vector of [
          frame.position,
          frame.normal,
          frame.tangentU,
          frame.tangentV,
        ]) {
          assert.ok(vector.toArray().every(Number.isFinite));
        }
        assert.ok(Math.abs(frame.normal.length() - 1) < 1e-9);
        assert.ok(Math.abs(frame.tangentU.length() - 1) < 1e-9);
        assert.ok(Math.abs(frame.tangentV.length() - 1) < 1e-9);
      }
    }
  }
});

test("the virtual column seam lands on the mirrored canonical row", () => {
  for (const size of [5, 6, 9, 10, 13, 19]) {
    const majorRadius = size / 3;
    const halfWidth = majorRadius * 0.62;
    for (let row = 0; row < size; row += 1) {
      const frame = mobiusGridFrame({
        row,
        col: 0,
        height: size,
        width: size,
        majorRadius,
        halfWidth,
      });
      const mirrored = mobiusGridFrame({
        row: size - 1 - row,
        col: 0,
        height: size,
        width: size,
        majorRadius,
        halfWidth,
      });
      assertVectorClose(
        mobiusPoint(MOBIUS_TAU, frame.v, majorRadius),
        mirrored.position,
      );
    }
  }
});

test("Mobius layout adapts safely to rectangular board proportions", () => {
  for (const [width, height] of [
    [9, 9],
    [13, 13],
    [19, 19],
    [30, 20],
    [20, 30],
    [30, 5],
    [5, 30],
  ]) {
    const majorRadius = Math.max((width * 2.1) / MOBIUS_TAU, height / MOBIUS_TAU * 1.15);
    const layout = mobiusBoardLayout({ width, height, majorRadius });
    assert.ok(layout.gridHalfWidth > 0);
    assert.ok(layout.gridHalfWidth <= majorRadius * 0.82 + 1e-12);
    assert.ok(layout.surfaceHalfWidth > layout.gridHalfWidth);
    assert.ok(layout.surfaceHalfWidth < majorRadius);

    const spacing = minimumMobiusNeighborDistance({
      width,
      height,
      majorRadius,
      halfWidth: layout.gridHalfWidth,
    });
    assert.ok(Number.isFinite(spacing) && spacing > 0);
  }

  const wide = mobiusBoardLayout({ width: 30, height: 5, majorRadius: 10 });
  assert.equal(wide.widthLimited, false);
  assert.ok(Math.abs(wide.idealGridHalfWidth - wide.gridHalfWidth) < 1e-12);
  const tall = mobiusBoardLayout({ width: 5, height: 30, majorRadius: 10 });
  assert.equal(tall.widthLimited, true);
});

test("Mobius UV picking mirrors rows only across the twisted seam", () => {
  assert.deepEqual(
    mobiusGridPointFromUv({ u: 0, v: 1, width: 9, height: 9 }),
    { row: 0, col: 0 },
  );
  assert.deepEqual(
    mobiusGridPointFromUv({ u: 1, v: 1, width: 9, height: 9 }),
    { row: 8, col: 0 },
  );
  assert.deepEqual(
    mobiusGridPointFromUv({ u: 1, v: 0, width: 9, height: 9 }),
    { row: 0, col: 0 },
  );
  assert.deepEqual(
    mobiusGridPointFromUv({ u: 0.5, v: 0.5, width: 20, height: 30 }),
    { row: 15, col: 10 },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { ArcBoard } from "../src/view/ArcBoard.js";
import {
  analysisVariationMarkerSpec,
  analysisVariationStepNumber,
  createAnalysisVariationMarker,
  placeAnalysisVariationMarker,
} from "../src/view/analysisVariationMarkers.js";
import { CylinderBoard } from "../src/view/CylinderBoard.js";
import { MobiusBoard } from "../src/view/MobiusBoard.js";
import { TorusBoard } from "../src/view/TorusBoard.js";

const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);

function fakeCanvasFactory(labels = []) {
  return () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      fillText(label) { labels.push(label); },
    }),
  });
}

function markerHarness(Board, overrides = {}) {
  return Object.assign(Object.create(Board.prototype), {
    width: 9,
    height: 9,
    markersGroup: new THREE.Group(),
    frame: () => ({
      position: new THREE.Vector3(2, 3, 4),
      normal: new THREE.Vector3(0, 0, 1),
      tangentV: new THREE.Vector3(0, 1, 0),
    }),
    mobiusStoneRadius: 0.32,
    mobiusStoneThickness: 0.1,
    ...overrides,
  });
}

test("analysis variation marker specs preserve explicit move numbers and contrast", () => {
  assert.equal(analysisVariationStepNumber({ number: 6 }, 1), 6);
  assert.equal(analysisVariationStepNumber({}, 3), 4);
  assert.equal(analysisVariationStepNumber(null, Number.NaN), 1);

  const black = analysisVariationMarkerSpec({ color: "black", number: 1 }, 7);
  const white = analysisVariationMarkerSpec({ color: "white" }, 1);
  assert.deepEqual(
    { color: black.color, number: black.number, label: black.label },
    { color: "black", number: 1, label: "1" },
  );
  assert.deepEqual(
    { color: white.color, number: white.number, label: white.label },
    { color: "white", number: 2, label: "2" },
  );
  assert.notEqual(black.background, black.foreground);
  assert.notEqual(white.background, white.foreground);
  assert.notEqual(black.background, white.background);
});

test("numbered marker owns and disposes its canvas texture", () => {
  const labels = [];
  const marker = createAnalysisVariationMarker(
    { color: "white", number: 12 },
    0,
    { radius: 0.21, canvasFactory: fakeCanvasFactory(labels) },
  );

  assert.equal(marker.name, "analysis-variation-step");
  assert.equal(marker.userData.stepNumber, 12);
  assert.equal(marker.userData.stoneColor, "white");
  assert.equal(marker.material.side, THREE.FrontSide);
  assert.equal(marker.material.depthWrite, false);
  assert.equal(marker.material.toneMapped, false);
  assert.deepEqual(labels, ["12"]);

  let textureDisposals = 0;
  marker.material.map.addEventListener("dispose", () => { textureDisposals += 1; });
  marker.material.dispose();
  marker.geometry.dispose();
  assert.equal(textureDisposals, 1);
  assert.throws(
    () => createAnalysisVariationMarker(null, 0, {
      radius: 0,
      canvasFactory: fakeCanvasFactory(),
    }),
    /radius must be positive/i,
  );
});

test("paired marker placement keeps both Mobius labels front-facing and upright", () => {
  const position = new THREE.Vector3(2, -1, 0.5);
  const normal = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);

  for (const side of [-1, 1]) {
    const marker = new THREE.Object3D();
    placeAnalysisVariationMarker(marker, {
      position,
      normal,
      up,
      surfaceOffset: 0.25,
      side,
    });
    const markerForward = LOCAL_FORWARD.clone().applyQuaternion(marker.quaternion);
    const markerUp = LOCAL_UP.clone().applyQuaternion(marker.quaternion);
    assert.ok(markerForward.dot(normal) * side > 0.999999);
    assert.ok(markerUp.dot(up) > 0.999999);
    assert.ok(Math.abs(marker.position.z - (position.z + 0.25 * side)) < 1e-12);
    assert.equal(marker.userData.markerSide, side);
  }
});

test("all curved renderers wire analysis variations to numbered markers", () => {
  const previousDocument = globalThis.document;
  const labels = [];
  globalThis.document = { createElement: () => fakeCanvasFactory(labels)() };
  try {
    const arc = markerHarness(ArcBoard);
    const cylinder = markerHarness(CylinderBoard);
    const torus = markerHarness(TorusBoard);
    const mobius = markerHarness(MobiusBoard);

    arc.addVariationMarker(1, 2, { color: "black", number: 7 }, 0);
    cylinder.addVariationMarker(1, 2, { color: "white" }, 2);
    torus.addVariationMarker(1, 2, { color: "black", number: 4 }, 3);
    mobius.addVariationMarker(1, 2, { color: "white", number: 8 }, 7);

    assert.equal(arc.markersGroup.children.length, 1);
    assert.equal(cylinder.markersGroup.children.length, 1);
    assert.equal(torus.markersGroup.children.length, 1);
    assert.equal(mobius.markersGroup.children.length, 2);
    assert.deepEqual(labels, ["7", "3", "4", "8", "8"]);

    for (const [board, expected] of [
      [arc, [7]],
      [cylinder, [3]],
      [torus, [4]],
      [mobius, [8, 8]],
    ]) {
      assert.deepEqual(
        board.markersGroup.children.map((marker) => marker.userData.stepNumber),
        expected,
      );
      assert.ok(
        board.markersGroup.children.every(
          (marker) => marker.material.side === THREE.FrontSide,
        ),
      );
    }

    const mobiusSides = mobius.markersGroup.children
      .map((marker) => marker.userData.markerSide)
      .sort((left, right) => left - right);
    assert.deepEqual(mobiusSides, [-1, 1]);
    for (const marker of mobius.markersGroup.children) {
      const forward = LOCAL_FORWARD.clone().applyQuaternion(marker.quaternion);
      assert.ok(forward.z * marker.userData.markerSide > 0.999999);
    }

    const before = cylinder.markersGroup.children.length;
    cylinder.addVariationMarker(-1, 2, { color: "black" }, 0);
    mobius.addVariationMarker(9, 2, { color: "black" }, 0);
    assert.equal(cylinder.markersGroup.children.length, before);
    assert.equal(mobius.markersGroup.children.length, 2);

    for (const board of [arc, cylinder, torus, mobius]) {
      for (const marker of board.markersGroup.children) {
        marker.material.dispose();
        marker.geometry.dispose();
      }
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

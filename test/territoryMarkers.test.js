import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as THREE from "three";

import { ArcBoard } from "../src/view/ArcBoard.js";
import { CylinderBoard } from "../src/view/CylinderBoard.js";
import { FlatBoard } from "../src/view/FlatBoard.js";
import { MobiusBoard } from "../src/view/MobiusBoard.js";
import { TorusBoard } from "../src/view/TorusBoard.js";
import {
  createTerritoryMarkerLayer,
  disposeTerritoryMarkerLayer,
  territoryPointsForPosition,
  territoryPointsSignature,
  updateTerritoryMarkerLayer,
} from "../src/view/territoryMarkers.js";

test("main sends scored regions to all five board renderers", () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /territoryRegions:\s*territoryRegionsForState\(state\)/);
  assert.match(source, /\["resign",\s*"timeout"\]\.includes\(state\.result\?\.reason\)/);
  for (const viewName of ["cylinderView", "torusView", "mobiusView", "flatView", "arcView"]) {
    assert.match(source, new RegExp(`${viewName}\\?\\.setPosition\\(viewState\\)`));
  }

  for (const Board of [FlatBoard, ArcBoard, CylinderBoard, TorusBoard]) {
    assert.match(Board.prototype.setPosition.toString(), /territoryRegions/);
  }
  assert.equal(MobiusBoard.prototype.setPosition, TorusBoard.prototype.setPosition);
});

test("curved boards pick only their wooden surface, never territory overlays", () => {
  for (const Board of [ArcBoard, CylinderBoard, TorusBoard, MobiusBoard]) {
    assert.match(
      Board.prototype.raycastPoint.toString(),
      /intersectObject\(this\.surface, false\)/,
    );
  }
});

test("territory points are visible only for scoring positions and point-scored results", () => {
  const board = [
    ["black", null, null, null],
    [null, "white", null, null],
    [null, null, null, null],
  ];
  const territoryRegions = [
    {
      owner: "black",
      points: [
        { row: 0, col: 0 }, // A living stone must never be painted over.
        { row: 1, col: 1 }, // A marked-dead stone is scoring territory.
        { row: 2, col: 2 },
        { row: 2, col: 2 },
        { row: -1, col: 0 },
      ],
    },
    {
      owner: "white",
      points: [
        [2, 2], // Conflicting ownership remains blank/undecided.
        [2, 3],
      ],
    },
    { owner: "black", points: [[2, 2]] },
    { owner: null, points: [{ row: 0, col: 1 }] },
  ];
  const options = {
    territoryRegions,
    width: 4,
    height: 3,
    board,
    deadStones: [{ row: 1, col: 1 }],
  };

  assert.deepEqual(
    territoryPointsForPosition({ ...options, phase: "play" }),
    [],
  );
  assert.deepEqual(
    territoryPointsForPosition({ ...options, phase: "scoring" }),
    [
      { row: 1, col: 1, owner: "black" },
      { row: 2, col: 3, owner: "white" },
    ],
  );
  assert.deepEqual(
    territoryPointsForPosition({ ...options, phase: "finished" }),
    [
      { row: 1, col: 1, owner: "black" },
      { row: 2, col: 3, owner: "white" },
    ],
  );
});

test("territory signatures are deterministic across rectangular board regions", () => {
  const points = territoryPointsForPosition({
    territoryRegions: [
      { owner: "white", points: [[3, 5], [0, 1]] },
      { owner: "black", points: [[2, 4], [2, 4]] },
    ],
    phase: "scoring",
    width: 6,
    height: 4,
    board: Array.from({ length: 4 }, () => Array(6).fill(null)),
  });
  assert.deepEqual(points, [
    { row: 0, col: 1, owner: "white" },
    { row: 2, col: 4, owner: "black" },
    { row: 3, col: 5, owner: "white" },
  ]);
  assert.equal(territoryPointsSignature(points), "0,1:w|2,4:b|3,5:w");
});

test("3D territory layers are instanced, inert, repositionable and disposable", () => {
  const points = [
    { row: 0, col: 0, owner: "black" },
    { row: 1, col: 2, owner: "white" },
  ];
  let xOffset = 0;
  const frameAt = (row, col) => ({
    position: new THREE.Vector3(col + xOffset, row, 0),
    normal: new THREE.Vector3(0, 0, 1),
  });
  const layer = createTerritoryMarkerLayer(points, {
    frameAt,
    radius: 0.2,
    surfaceOffset: 0.05,
    paired: true,
  });

  assert.equal(layer.name, "territory-markers");
  assert.equal(layer.children.length, 4);
  for (const mesh of layer.children) {
    assert.equal(mesh.isInstancedMesh, true);
    assert.equal(mesh.count, 2);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.toneMapped, false);
    assert.ok(mesh.renderOrder < 0);
    assert.equal(mesh.raycast(), undefined);
  }

  const blackMark = layer.getObjectByName("black-territory-mark");
  const before = new THREE.Matrix4();
  const after = new THREE.Matrix4();
  blackMark.getMatrixAt(1, before);
  xOffset = 4;
  updateTerritoryMarkerLayer(layer, { frameAt });
  blackMark.getMatrixAt(1, after);
  assert.equal(after.elements[12] - before.elements[12], 4);

  const parent = new THREE.Group();
  parent.add(layer);
  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const child of layer.children) {
    child.geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
    child.material.addEventListener("dispose", () => { materialDisposals += 1; });
  }
  disposeTerritoryMarkerLayer(layer);
  assert.equal(parent.children.length, 0);
  assert.equal(layer.children.length, 0);
  assert.equal(geometryDisposals, 4);
  assert.equal(materialDisposals, 4);
});

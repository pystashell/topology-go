import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { mobiusPointInCopy } from "../src/topology/cover.js";
import { getTopology } from "../src/topology/index.js";
import {
  boardUsesDiscs,
  boardUsesFelt,
  normalizeBoardStyle,
  starIndices,
  starPointsFor,
} from "../src/view/boardStyle.js";
import {
  EMPTY_GAME_MARKERS,
  GameMarkerOverlay,
  createGameMarkerLayer,
  disposeGameMarkerLayer,
  gameMarkersSignature,
  hasGameMarkers,
  lineSegmentsOnScreen,
  normalizeGameMarkers,
  updateGameMarkerLayer,
} from "../src/view/gameMarkers.js";
import { FLIP_TURN_MS, FLIP_WAVE_DELAY_MS, FlipWave, flipWaveDurationMs } from "../src/view/flipWave.js";

function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

/** Cells of a straight run that follows the topology across seams. */
function run(kind, width, height, row, col, dRow, dCol, length) {
  const topology = getTopology(kind, width, height);
  const cells = [{ row, col }];
  let current = { row, col, dRow, dCol };
  while (cells.length < length) {
    current = topology.step(current.row, current.col, current.dRow, current.dCol);
    cells.push({ row: current.row, col: current.col });
  }
  return cells;
}

/**
 * Images of a point in a flat window of `width` columns (cell = 1, offset 0)
 * that also shows `margin` cells past either edge, like FlatBoard.
 */
function cylinderImages(width, margin = 1.5) {
  return (row, col) =>
    [col - width, col, col + width]
      .filter((x) => x >= -margin && x <= width - 1 + margin)
      .map((x) => ({ x, y: row }));
}

function mobiusImages(width, height, margin = 1.5) {
  return (row, col) => {
    const images = [];
    for (let copy = -2; copy <= 2; copy += 1) {
      const image = mobiusPointInCopy(row, col, copy, width, height);
      if (image.coverColumn >= -margin && image.coverColumn <= width - 1 + margin) {
        images.push({ x: image.coverColumn, y: image.row });
      }
    }
    return images;
  };
}

const segmentKey = ({ from, to }) => `${from.x},${from.y}->${to.x},${to.y}`;

test("game marker sets are validated, de-duplicated and keyed to occupancy", () => {
  const board = emptyBoard(5, 4);
  board[1][1] = "black";
  board[1][2] = "black";
  board[1][3] = "black";
  board[2][0] = "white";

  const markers = normalizeGameMarkers({
    // Line order is preserved; duplicates, empty points and junk are dropped.
    winLine: [{ row: 1, col: 3 }, [1, 2], { row: 1, col: 1 }, [1, 2], { row: 0, col: 0 }],
    forbidden: [[3, 4], { row: 0, col: 1 }, { row: 1, col: 1 }, [9, 9], [0, 1]],
    legal: [{ row: 2, col: 4 }, { row: 0, col: 4 }, { row: -1, col: 0 }, { row: 1.5, col: 0 }],
    flipped: [{ row: 2, col: 0 }, { row: 3, col: 3 }, "junk", null],
  }, { width: 5, height: 4, board });

  assert.deepEqual(markers, {
    winLine: [{ row: 1, col: 3 }, { row: 1, col: 2 }, { row: 1, col: 1 }],
    forbidden: [{ row: 0, col: 1 }, { row: 3, col: 4 }],
    legal: [{ row: 0, col: 4 }, { row: 2, col: 4 }],
    flipped: [{ row: 2, col: 0 }],
    animateFlips: false,
  });
  assert.equal(
    gameMarkersSignature(markers),
    "winLine:1,3;1,2;1,1|forbidden:0,1;3,4|legal:0,4;2,4|flipped:2,0",
  );

  // Absent, empty or fully invalid input is the shared empty set (Go).
  for (const input of [undefined, null, {}, { winLine: [[7, 7]] }, "x"]) {
    const normalized = normalizeGameMarkers(input, { width: 5, height: 4, board });
    assert.equal(normalized, EMPTY_GAME_MARKERS);
    assert.equal(hasGameMarkers(normalized), false);
    assert.equal(gameMarkersSignature(normalized), "");
  }
  // Without a board only the bounds are checked.
  assert.deepEqual(
    normalizeGameMarkers({ legal: [[0, 0]] }, { width: 1, height: 1 }).legal,
    [{ row: 0, col: 0 }],
  );
});

test("board styles default to Go and pick the per-game look and star points", () => {
  for (const input of [undefined, null, {}, { gameType: "chess" }]) {
    assert.deepEqual(normalizeBoardStyle(input), { gameType: "go" });
  }
  assert.deepEqual(normalizeBoardStyle({ gameType: "othello" }), { gameType: "othello" });
  assert.equal(boardUsesFelt({ gameType: "othello" }), true);
  assert.equal(boardUsesDiscs({ gameType: "othello" }), true);
  assert.equal(boardUsesFelt({ gameType: "gomoku" }), false);
  assert.equal(boardUsesFelt(normalizeBoardStyle()), false);

  // Go keeps the previous rows x columns hoshi product, in the same order.
  for (const [width, height] of [[19, 19], [13, 9], [15, 15], [6, 30]]) {
    const legacy = starIndices(height).flatMap((row) =>
      starIndices(width).map((col) => ({ row, col })));
    assert.deepEqual(starPointsFor({ width, height }), legacy);
    assert.deepEqual(starPointsFor({ width, height, gameType: "go" }), legacy);
  }
  assert.deepEqual(starIndices(19), [3, 9, 15]);
  assert.deepEqual(starIndices(15), [3, 7, 11]);

  assert.deepEqual(starPointsFor({ width: 15, height: 15, gameType: "gomoku" }), [
    { row: 3, col: 3 },
    { row: 3, col: 11 },
    { row: 7, col: 7 },
    { row: 11, col: 3 },
    { row: 11, col: 11 },
  ]);
  assert.deepEqual(
    starPointsFor({ width: 19, height: 15, gameType: "gomoku" }),
    starPointsFor({ width: 19, height: 15 }),
  );
  assert.deepEqual(starPointsFor({ width: 8, height: 8, gameType: "othello" }), []);
});

test("line segments join only on-screen neighbours, splitting at a cylinder seam", () => {
  const width = 15;
  const line = run("cylinder", width, 15, 7, 12, 0, 1, 5);
  assert.deepEqual(line.map(({ col }) => col), [12, 13, 14, 0, 1]);

  const segments = lineSegmentsOnScreen(line, cylinderImages(width), { step: 1 });
  assert.deepEqual(segments.map(segmentKey), [
    "12,7->13,7",
    "13,7->14,7",
    // The seam pair is drawn twice: entering at the left edge and leaving
    // at the right one; clipping keeps the on-board halves.
    "-1,7->0,7",
    "14,7->15,7",
    "0,7->1,7",
  ]);
  assert.deepEqual(segments.map(({ index }) => index), [0, 1, 2, 2, 3]);

  // Pixel units and a horizontal scroll give the same pairs.
  const cell = 24;
  const pixelSegments = lineSegmentsOnScreen(
    line,
    (row, col) => cylinderImages(width)(row, col).map(({ x, y }) => ({
      x: 100 + (x + 0.37) * cell,
      y: 50 + y * cell,
    })),
    { step: cell },
  );
  assert.equal(pixelSegments.length, 5);

  // A pair that is not adjacent anywhere on screen is skipped, not bridged.
  const gapped = lineSegmentsOnScreen(
    [{ row: 7, col: 2 }, { row: 7, col: 3 }, { row: 7, col: 6 }],
    cylinderImages(width),
  );
  assert.deepEqual(gapped.map(segmentKey), ["2,7->3,7"]);

  assert.deepEqual(lineSegmentsOnScreen([{ row: 0, col: 0 }], cylinderImages(width)), []);
  assert.deepEqual(lineSegmentsOnScreen(null, cylinderImages(width)), []);
});

test("line segments follow torus wraps and close a full cycle", () => {
  const width = 11;
  const height = 11;
  const torusImages = (row, col) => {
    const images = [];
    for (const x of [col - width, col, col + width]) {
      for (const y of [row - height, row, row + height]) {
        if (x >= -1.5 && x <= width + 0.5 && y >= -1.5 && y <= height + 0.5) {
          images.push({ x, y });
        }
      }
    }
    return images;
  };
  const diagonal = run("torus", width, height, 9, 9, 1, 1, 5);
  assert.deepEqual(diagonal, [
    { row: 9, col: 9 },
    { row: 10, col: 10 },
    { row: 0, col: 0 },
    { row: 1, col: 1 },
    { row: 2, col: 2 },
  ]);
  const segments = lineSegmentsOnScreen(diagonal, torusImages);
  assert.ok(segments.every(({ from, to }) =>
    Math.abs(to.x - from.x) === 1 && Math.abs(to.y - from.y) === 1));
  // The pair crossing both seams at the corner shows up in every corner of
  // the window; the two off-diagonal ones only touch a corner and clip away.
  assert.deepEqual(
    segments.filter(({ index }) => index === 1).map(segmentKey).sort(),
    ["-1,-1->0,0", "-1,10->0,11", "10,-1->11,0", "10,10->11,11"],
  );
  assert.equal(segments.filter(({ index }) => index !== 1).length, 3);

  // A whole row is a cycle: its last and first cells meet across the seam.
  const row = Array.from({ length: width }, (_, col) => ({ row: 4, col }));
  const cycle = lineSegmentsOnScreen(row, cylinderImages(width));
  assert.equal(cycle.filter(({ index }) => index < width - 1).length, width - 1);
  assert.deepEqual(
    cycle.filter(({ index }) => index === width - 1).map(segmentKey).sort(),
    ["-1,4->0,4", "10,4->11,4"],
  );
});

test("line segments pair mirrored images across the Mobius flip", () => {
  const width = 15;
  const height = 15;
  // A "\" diagonal continues as "/" after crossing the seam.
  const line = run("mobius", width, height, 3, 12, 1, 1, 5);
  assert.deepEqual(line, [
    { row: 3, col: 12 },
    { row: 4, col: 13 },
    { row: 5, col: 14 },
    { row: 8, col: 0 },
    { row: 7, col: 1 },
  ]);
  const segments = lineSegmentsOnScreen(line, mobiusImages(width, height));
  assert.deepEqual(segments.map(segmentKey), [
    "12,3->13,4",
    "13,4->14,5",
    // Out of the flipped copy on the left, and into it on the right.
    "-1,9->0,8",
    "14,5->15,6",
    "0,8->1,7",
  ]);
});

test("flipped markers keep each disc's distance and the wave's origin", () => {
  const board = emptyBoard(6, 6);
  board[1][1] = "black";
  board[1][2] = "black";
  const markers = normalizeGameMarkers({
    flipped: [{ row: 1, col: 2, distance: 2 }, { row: 1, col: 1, distance: 1 }, { row: 1, col: 1 }],
    flipOrigin: { row: 1, col: 0 },
    animateFlips: true,
  }, { width: 6, height: 6, board });
  assert.deepEqual(markers.flipped, [{ row: 1, col: 1, distance: 1 }, { row: 1, col: 2, distance: 2 }]);
  assert.deepEqual(markers.flipOrigin, { row: 1, col: 0 });
  assert.equal(markers.animateFlips, true);
  // Distances never change the signature: a redraw is not a new wave.
  assert.equal(
    gameMarkersSignature(markers),
    gameMarkersSignature(normalizeGameMarkers({ flipped: [[1, 1], [1, 2]] }, { width: 6, height: 6, board })),
  );
  // A bad distance is dropped; animateFlips is only ever true when asked.
  const plain = normalizeGameMarkers({ flipped: [{ row: 1, col: 1, distance: 0 }], animateFlips: "yes" });
  assert.deepEqual(plain.flipped, [{ row: 1, col: 1 }]);
  assert.equal(plain.animateFlips, false);
  assert.equal(plain.flipOrigin, undefined);
});

function planarFrameAt(row, col) {
  return {
    position: new THREE.Vector3(col, -row, 0),
    normal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
  };
}

test("3D game marker layers are instanced, inert, paired and disposable", () => {
  assert.equal(createGameMarkerLayer(EMPTY_GAME_MARKERS, { frameAt: planarFrameAt }), null);
  const markers = {
    winLine: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    forbidden: [{ row: 2, col: 2 }],
    legal: [{ row: 3, col: 3 }, { row: 3, col: 4 }, { row: 4, col: 4 }],
    flipped: [{ row: 1, col: 1 }],
  };
  const layer = createGameMarkerLayer(markers, {
    frameAt: planarFrameAt,
    stoneRadius: 0.4,
    surfaceOffset: 0.05,
    raisedOffset: 0.12,
    paired: true,
  });
  assert.equal(layer.name, "game-markers");
  assert.deepEqual(
    layer.children.map((mesh) => [mesh.name, mesh.count]),
    [
      ["win-halo", 4],
      ["win-ring", 4],
      ["flip-ring", 2],
      ["legal-dot", 6],
      ["forbidden-cross", 2],
    ],
  );
  for (const mesh of layer.children) {
    assert.equal(mesh.isInstancedMesh, true);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.raycast(), undefined);
  }

  // Paired instances sit on both sides; crosses clear the star points.
  const cross = layer.getObjectByName("forbidden-cross");
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const zs = [0, 1].map((index) => {
    cross.getMatrixAt(index, matrix);
    return position.setFromMatrixPosition(matrix).z;
  });
  assert.deepEqual(zs.map((z) => Math.round(z * 1000) / 1000), [-0.12, 0.12]);

  // A flip ring is hidden until its disc starts to turn, then grows in.
  const ring = layer.getObjectByName("flip-ring");
  const scaleAt = () => {
    ring.getMatrixAt(1, matrix);
    return new THREE.Vector3().setFromMatrixScale(matrix).x;
  };
  const full = scaleAt();
  const wave = new FlipWave();
  wave.sync([{ row: 1, col: 1, distance: 1 }], { animate: true, now: 0 });
  updateGameMarkerLayer(layer, { frameAt: planarFrameAt, flipWave: wave, now: 0 });
  assert.ok(scaleAt() < full * 0.01, "not turning yet");
  updateGameMarkerLayer(layer, { frameAt: planarFrameAt, flipWave: wave, now: FLIP_WAVE_DELAY_MS + FLIP_TURN_MS / 2 });
  assert.ok(scaleAt() > full * 0.3 && scaleAt() < full);
  updateGameMarkerLayer(layer, { frameAt: planarFrameAt, flipWave: wave, now: 10_000 });
  assert.ok(Math.abs(scaleAt() - full) < 1e-9, "done: full size");

  const parent = new THREE.Group();
  parent.add(layer);
  let disposals = 0;
  for (const mesh of layer.children) {
    mesh.geometry.addEventListener("dispose", () => { disposals += 1; });
  }
  disposeGameMarkerLayer(layer);
  assert.equal(parent.children.length, 0);
  assert.equal(disposals, 5);
});

test("the marker overlay only touches the scene when markers change", () => {
  const parent = new THREE.Group();
  const overlay = new GameMarkerOverlay({
    parent,
    frameAt: planarFrameAt,
    reducedMotion: false,
  });
  assert.equal(overlay.sync(EMPTY_GAME_MARKERS), false);
  assert.equal(parent.children.length, 0);

  const flips = {
    ...EMPTY_GAME_MARKERS,
    legal: [{ row: 0, col: 2 }],
    flipped: [{ row: 1, col: 1, distance: 1 }],
    flipOrigin: { row: 1, col: 0 },
    animateFlips: true,
  };
  assert.equal(overlay.sync(flips, { currentPlayer: "white", now: 1000 }), true);
  assert.equal(parent.children.length, 1);
  assert.ok(overlay.group.getObjectByName("flip-ring"));
  assert.equal(overlay.animating, true, "a move just played starts the wave");
  // Same markers again (a redraw, no longer asking for animation): nothing
  // is rebuilt and the wave keeps running.
  const group = overlay.group;
  assert.equal(overlay.sync({ ...flips, animateFlips: false }, { currentPlayer: "white", now: 1300 }), false);
  assert.equal(overlay.group, group);
  assert.equal(overlay.animating, true);
  // The legal-dot colour follows the side to move.
  assert.equal(overlay.sync(flips, { currentPlayer: "black", now: 1350 }), true);

  assert.equal(overlay.animate(1400), true);
  const duration = flipWaveDurationMs(flips.flipped);
  assert.equal(overlay.animate(1000 + duration + 1), false);
  assert.equal(overlay.animate(5000), false);
  assert.equal(overlay.animating, false);

  // New flips without animation (an undo, a jump) show at once.
  const jumped = { ...flips, flipped: [{ row: 2, col: 2, distance: 1 }], flipOrigin: { row: 2, col: 1 }, animateFlips: false };
  overlay.sync(jumped, { now: 6000 });
  assert.equal(overlay.animating, false);

  // Reduced motion never animates.
  const calm = new GameMarkerOverlay({ parent, frameAt: planarFrameAt, reducedMotion: true });
  calm.sync(flips, { now: 0 });
  assert.equal(calm.animating, false);
  assert.equal(calm.animate(1), false);
  calm.dispose();

  // Forbidden hover cross.
  overlay.sync({ ...EMPTY_GAME_MARKERS, forbidden: [{ row: 2, col: 3 }] });
  assert.equal(overlay.isForbidden({ row: 2, col: 3 }), true);
  assert.equal(overlay.isForbidden({ row: 2, col: 2 }), false);
  assert.equal(overlay.isForbidden(null), false);
  assert.equal(overlay.showForbiddenHover({ row: 2, col: 3 }), true);
  assert.equal(overlay.hoverMarker.visible, true);
  assert.equal(overlay.hoverMarker.children[0].position.x, 3);
  assert.equal(overlay.showForbiddenHover({ row: 2, col: 2 }), true);
  assert.equal(overlay.hoverMarker.visible, false);
  assert.equal(overlay.hideForbiddenHover(), false);

  overlay.sync(EMPTY_GAME_MARKERS);
  assert.equal(overlay.group, null);
  overlay.dispose();
  assert.equal(parent.children.length, 0);
});

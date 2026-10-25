import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { getTopology } from "../src/topology/index.js";
import { ArcBoard } from "../src/view/ArcBoard.js";
import { CylinderBoard } from "../src/view/CylinderBoard.js";
import { FlatBoard } from "../src/view/FlatBoard.js";
import { FlipWave } from "../src/view/flipWave.js";
import {
  EMPTY_GAME_MARKERS,
  normalizeGameMarkers,
} from "../src/view/gameMarkers.js";
import { MobiusBoard } from "../src/view/MobiusBoard.js";
import { TorusBoard } from "../src/view/TorusBoard.js";

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

test("every renderer accepts game markers and a board style", () => {
  for (const Board of [FlatBoard, ArcBoard, CylinderBoard, TorusBoard]) {
    const source = Board.prototype.setPosition.toString();
    assert.match(source, /gameMarkers = null/);
    assert.match(source, /boardStyle = null/);
  }
  assert.equal(MobiusBoard.prototype.setPosition, TorusBoard.prototype.setPosition);
  assert.equal(MobiusBoard.prototype.refreshHover, TorusBoard.prototype.refreshHover);
  for (const Board of [ArcBoard, CylinderBoard, TorusBoard]) {
    assert.match(Board.prototype.refreshHover.toString(), /isForbidden\(point\)/);
    // The flip wave turns the stones and grows the rings while it runs.
    assert.match(Board.prototype.renderFrame.toString(), /poseFlipWave\((now|waveNow)\)/);
    assert.match(Board.prototype.renderFrame.toString(), /gameMarkerOverlay\?\.animate\((now|waveNow)\)/);
    assert.match(Board.prototype.setPosition.toString(), /collectFlippingStones\(\)/);
  }
  assert.match(ArcBoard.prototype.updateContentLayout.toString(), /gameMarkerOverlay\?\.reposition\(\)/);
  assert.match(FlatBoard.prototype.drawHover.toString(), /isForbiddenPoint\(point\)/);
  // Mobius mirrors markers onto both sides of the band.
  assert.equal(
    MobiusBoard.prototype.gameMarkerOptions.call({
      mobiusStoneRadius: 0.3,
      mobiusStoneThickness: 0.1,
    }).paired,
    true,
  );
});

test("3D hover previews a cross on forbidden points and a stone elsewhere", () => {
  let renders = 0;
  const boardGroup = new THREE.Group();
  const board = Object.assign(Object.create(CylinderBoard.prototype), {
    width: 15,
    height: 15,
    radius: 15 / (Math.PI * 2),
    gridHeight: 14,
    board: emptyBoard(15, 15),
    phase: "play",
    currentPlayer: "black",
    movePreviewEnabled: true,
    hoveredPoint: null,
    boardGroup,
    hoverStone: new THREE.Mesh(),
    hoverBlackMaterial: new THREE.MeshBasicMaterial(),
    hoverWhiteMaterial: new THREE.MeshBasicMaterial(),
    requestRender() { renders += 1; },
  });
  board.createGameMarkerOverlay();
  board.gameMarkerOverlay.sync(
    normalizeGameMarkers({ forbidden: [[7, 7]] }, { width: 15, height: 15, board: board.board }),
  );

  board.setHoveredPoint({ row: 7, col: 7 });
  assert.equal(board.hoverStone.visible, false);
  assert.equal(board.gameMarkerOverlay.hoverMarker.visible, true);

  board.setHoveredPoint({ row: 7, col: 8 });
  assert.equal(board.hoverStone.visible, true);
  assert.equal(board.gameMarkerOverlay.hoverMarker.visible, false);

  // Without markers (Go) nothing but the ghost stone is involved.
  board.gameMarkerOverlay.sync(EMPTY_GAME_MARKERS);
  board.setHoveredPoint({ row: 7, col: 7 });
  assert.equal(board.hoverStone.visible, true);
  assert.ok(renders > 0);
  board.gameMarkerOverlay.dispose();
});

class RecordingContext {
  constructor() {
    this.calls = [];
    this.globalAlpha = 1;
  }

  moveTo(x, y) { this.calls.push(["moveTo", x, y]); }
  lineTo(x, y) { this.calls.push(["lineTo", x, y]); }
  arc(x, y, radius) { this.calls.push(["arc", x, y, radius]); }
  save() {}
  restore() {}
  beginPath() {}
  rect() {}
  clip() {}
  stroke() { this.calls.push(["stroke"]); }
  fill() { this.calls.push(["fill"]); }
}

function flatHarness({ topology, width = 15, height = 15, markers, board }) {
  const flat = Object.assign(Object.create(FlatBoard.prototype), {
    width,
    height,
    topology,
    wrapRows: topology === "torus",
    isMobius: topology === "mobius",
    cell: 10,
    frameX: 0,
    frameY: 0,
    boardPixelsWidth: width * 10,
    boardPixelsHeight: height * 10,
    offsetColumns: 0,
    offsetRows: 0,
    currentPlayer: "black",
    phase: "play",
    flipWave: new FlipWave(),
  });
  flat.gameMarkers = normalizeGameMarkers(markers, { width, height, board });
  return flat;
}

test("the flat view strokes a seam-crossing win line pair by pair", () => {
  const width = 15;
  const height = 15;
  const line = run("mobius", width, height, 3, 12, 1, 1, 5);
  const board = emptyBoard(width, height);
  for (const { row, col } of line) board[row][col] = "black";
  const flat = flatHarness({ topology: "mobius", markers: { winLine: line }, board });
  const context = new RecordingContext();
  flat.drawStoneMarkers(context);

  const strokes = [];
  for (let index = 0; index < context.calls.length - 1; index += 1) {
    const [kind, x, y] = context.calls[index];
    const next = context.calls[index + 1];
    if (kind === "moveTo" && next[0] === "lineTo") {
      strokes.push(`${(x - 5) / 10},${(y - 5) / 10}->${(next[1] - 5) / 10},${(next[2] - 5) / 10}`);
    }
  }
  assert.deepEqual(strokes.sort(), [
    "-1,9->0,8",
    "0,8->1,7",
    "12,3->13,4",
    "13,4->14,5",
    "14,5->15,6",
  ]);
  // One glow ring per visible image of each winning stone.
  assert.ok(context.calls.filter(([kind]) => kind === "arc").length >= 5);

  // Go positions draw nothing extra.
  const go = flatHarness({ topology: "cylinder", markers: null, board });
  const quiet = new RecordingContext();
  go.drawStoneMarkers(quiet);
  go.drawPointMarkers(quiet);
  assert.deepEqual(quiet.calls, []);
});

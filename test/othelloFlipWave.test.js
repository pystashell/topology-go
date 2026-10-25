import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { aiMoveWaitMs, AI_AFTER_ANIMATION_MS, AI_MIN_MOVE_DELAY_MS } from "../src/ai/aiPacing.js";
import { OthelloEngine } from "../src/game/othelloEngine.js";
import { othelloFlipDistances } from "../src/game/othelloFlipOrder.js";
import { othelloRules } from "../src/game/rules/othello.js";
import { DIRECTIONS_8, getTopology } from "../src/topology/index.js";
import {
  FLIP_TURN_MS,
  FLIP_WAVE_DELAY_MS,
  FLIP_WAVE_SPREAD_MAX_MS,
  FLIP_WAVE_STEP_MS,
  FlipWave,
  flipTurnLook,
  flipTurnProgress,
  flipWaveDurationMs,
  flipWaveStepMs,
  poseFlippingStones,
} from "../src/view/flipWave.js";

/*
 * The Othello flip wave: after a disc lands, the discs it outflanked turn
 * over ring by ring, nearest first, along all eight directions at once.
 * Discs the same distance from the new disc turn at the same moment.
 */

const BLACK = "black";
const WHITE = "white";

function position(rows, { topology = "cylinder", toMove = BLACK } = {}) {
  return new OthelloEngine({
    width: rows[0].length,
    height: rows.length,
    topology,
    initialBoard: rows.map((line) =>
      [...line].map((cell) => (cell === "B" ? BLACK : cell === "W" ? WHITE : null))),
    currentPlayer: toMove,
  });
}

/** Distances of the last move, keyed "row,col". */
function distancesAfter(game) {
  const move = game.lastMove;
  const flips = othelloFlipDistances({
    width: game.width,
    height: game.height,
    topology: game.topology,
    board: game.board,
    move,
    flipped: move.flipped,
  });
  return Object.fromEntries(flips.map(({ row, col, distance }) => [`${row},${col}`, distance]));
}

test("rings spread out along all eight directions, nearest first", () => {
  // Black plays the centre (3,3) of a star of white discs: two along each of
  // the eight directions, each run closed by a black disc.
  const rows = [
    "B..B..B",
    ".W.W.W.",
    "..WWW..",
    "BWW.WWB",
    "..WWW..",
    ".W.W.W.",
    "B..B..B",
  ];
  const game = position([...rows.map((row) => `${row}.`), "........"], { topology: "cylinder" });
  const result = game.play(3, 3);
  assert.equal(result.ok, true);
  assert.equal(result.flipped.length, 16);
  const distances = distancesAfter(game);
  const ring = (distance) => Object.entries(distances)
    .filter(([, value]) => value === distance).map(([key]) => key).sort();
  assert.deepEqual(ring(1), ["2,2", "2,3", "2,4", "3,2", "3,4", "4,2", "4,3", "4,4"]);
  assert.deepEqual(ring(2), ["1,1", "1,3", "1,5", "3,1", "3,5", "5,1", "5,3", "5,5"]);
});

test("distances follow the ray across a seam and the Mobius twist", () => {
  // Cylinder: Black at (1,0) outflanks (1,5) and (1,4) going left across the seam.
  const wrapped = position(["......", "...BWW", "......", "......", "......", "......"]);
  wrapped.play(1, 0);
  assert.deepEqual(distancesAfter(wrapped), { "1,5": 1, "1,4": 2 });
  // Mobius: leaving at the left edge comes back on the mirrored row (row 4).
  const twisted = position(["......", "......", "......", "......", "...BWW", "......"], { topology: "mobius" });
  twisted.play(1, 0);
  assert.deepEqual(distancesAfter(twisted), { "4,5": 1, "4,4": 2 });
  // Torus corner: up-left from (0,0) wraps to (5,5), then (4,4).
  const corner = position(["......", "......", "......", "...B..", "....W.", ".....W"], { topology: "torus" });
  corner.play(0, 0);
  assert.deepEqual(distancesAfter(corner), { "5,5": 1, "4,4": 2 });
});

test("a disc outflanked along two rays keeps the shorter distance", () => {
  // Torus row 0: Black at (0,0); going right meets six white discs and then
  // the black disc at (0,7); going left wraps straight onto (0,7) and flips
  // nothing. Distances count along the ray that flipped.
  const game = position([
    ".WWWWWWB",
    "........",
    "........",
    "........",
    "........",
    "........",
  ], { topology: "torus" });
  game.play(0, 0);
  const distances = distancesAfter(game);
  assert.deepEqual(distances, { "0,1": 1, "0,2": 2, "0,3": 3, "0,4": 4, "0,5": 5, "0,6": 6 });

  // Both directions outflank on the wrapped row: each disc keeps the
  // distance of its own (shorter) ray.
  const ring = position([
    "BWWW.WWW",
    "........",
    "........",
    "........",
    "........",
    "........",
  ], { topology: "torus" });
  ring.play(0, 4);
  // Right: (0,5)(0,6)(0,7) then (0,0) Black -> 1,2,3. Left: (0,3)(0,2)(0,1)
  // then (0,0) Black -> 1,2,3. Each disc keeps its own shortest ray.
  assert.deepEqual(distancesAfter(ring), {
    "0,1": 3, "0,2": 2, "0,3": 1, "0,5": 1, "0,6": 2, "0,7": 3,
  });
});

test("distances match a brute-force walk on random games on every topology", () => {
  let seed = 17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let checkedMoves = 0;
  for (const topology of ["cylinder", "torus", "mobius"]) {
    for (const [width, height] of [[6, 6], [8, 6], [6, 8]]) {
      for (let round = 0; round < 6; round += 1) {
        const game = new OthelloEngine({ width, height, topology });
        while (game.phase === "play") {
          const legal = game.legalMoves();
          const { row, col } = legal[Math.floor(random() * legal.length)];
          const before = game.board.map((line) => line.slice());
          const color = game.currentPlayer;
          const result = game.play(row, col);
          // Reference: walk each ray on the board before the move.
          const grid = getTopology(topology, width, height);
          const expected = new Map();
          for (const [dRow, dCol] of DIRECTIONS_8) {
            const run = [];
            let cursor = { row, col, dRow, dCol };
            for (;;) {
              const next = grid.step(cursor.row, cursor.col, cursor.dRow, cursor.dCol);
              if (!next || (next.row === row && next.col === col)) break;
              const value = before[next.row][next.col];
              if (value === color && run.length > 0) {
                run.forEach((key, index) => {
                  expected.set(key, Math.min(expected.get(key) ?? Infinity, index + 1));
                });
              }
              if (value !== (color === BLACK ? WHITE : BLACK)) break;
              run.push(`${next.row},${next.col}`);
              cursor = next;
            }
          }
          const actual = distancesAfter(game);
          assert.deepEqual(actual, Object.fromEntries(expected), `${topology} ${width}x${height}`);
          assert.equal(Object.keys(actual).length, result.flipped.length);
          checkedMoves += 1;
        }
      }
    }
  }
  assert.ok(checkedMoves > 1000);
});

test("Othello view markers carry the distances and the new disc", () => {
  const game = othelloRules.create({ width: 8, height: 8, topology: "cylinder" });
  game.play(2, 3);
  const markers = othelloRules.viewMarkers(game, { hints: false });
  assert.deepEqual(markers.flipped, [{ row: 3, col: 3, distance: 1 }]);
  assert.deepEqual(markers.flipOrigin, { row: 2, col: 3 });
  // A render-only engine from a room snapshot gives the same markers.
  const hydrated = othelloRules.hydratePublic(game.getState());
  assert.deepEqual(othelloRules.viewMarkers(hydrated, { hints: false }), markers);
});

test("inconsistent render-only flips still get a distance", () => {
  const flips = othelloFlipDistances({
    width: 6,
    height: 6,
    topology: "cylinder",
    board: Array.from({ length: 6 }, () => Array(6).fill(null)),
    move: { row: 0, col: 0, color: BLACK },
    flipped: [{ row: 4, col: 4 }],
  });
  assert.deepEqual(flips, [{ row: 4, col: 4, distance: 1 }]);
  assert.deepEqual(othelloFlipDistances({ width: 6, height: 6, topology: "torus", flipped: [] }), []);
});

test("the wave times rings one step apart; each disc turns in FLIP_TURN_MS", () => {
  assert.equal(flipWaveDurationMs([]), 0);
  assert.equal(flipWaveDurationMs([{ row: 0, col: 0, distance: 1 }]), FLIP_WAVE_DELAY_MS + FLIP_TURN_MS);
  assert.equal(
    flipWaveDurationMs([{ distance: 1 }, { distance: 3 }]),
    FLIP_WAVE_DELAY_MS + 2 * FLIP_WAVE_STEP_MS + FLIP_TURN_MS,
  );
  // Long rays on big boards squeeze the rings so a move never drags on.
  assert.equal(flipWaveStepMs(2), FLIP_WAVE_STEP_MS);
  assert.ok(flipWaveStepMs(29) < FLIP_WAVE_STEP_MS);
  assert.ok(flipWaveDurationMs([{ distance: 29 }]) <= FLIP_WAVE_DELAY_MS + FLIP_WAVE_SPREAD_MAX_MS + FLIP_TURN_MS);
  // Slow enough to follow: an 8x8 ray of six discs takes well over a second.
  assert.ok(flipWaveDurationMs([{ distance: 6 }]) > 1_500);

  assert.ok(flipTurnProgress(1, 0) < 0, "the new disc lands first");
  assert.equal(flipTurnProgress(1, FLIP_WAVE_DELAY_MS), 0);
  assert.equal(flipTurnProgress(2, FLIP_WAVE_DELAY_MS + FLIP_WAVE_STEP_MS), 0);
  assert.equal(flipTurnProgress(1, FLIP_WAVE_DELAY_MS + FLIP_TURN_MS), 1);
  assert.equal(flipTurnProgress(1, 1e9), 1);
});

test("a turning disc narrows to its edge, rises, and shows the new colour on the way down", () => {
  assert.deepEqual(flipTurnLook(-1), { angle: 0, lift: 0, squash: 1, showNewColor: false, ring: 0 });
  const start = flipTurnLook(0.1);
  const middle = flipTurnLook(0.5);
  const end = flipTurnLook(0.999);
  assert.equal(start.showNewColor, false);
  assert.equal(middle.showNewColor, true);
  assert.ok(Math.abs(middle.angle - Math.PI / 2) < 1e-9);
  assert.ok(middle.squash < 1e-9 && middle.lift > 0.999);
  assert.ok(end.angle > 3.1 && end.squash > 0.99 && end.lift < 0.01);
  for (let p = 0; p <= 1; p += 0.05) {
    const look = flipTurnLook(p);
    assert.ok(look.angle >= 0 && look.angle <= Math.PI);
    assert.ok(look.squash >= 0 && look.squash <= 1);
    assert.ok(look.ring >= 0 && look.ring <= 1);
  }
});

test("discs at the same distance always look the same; farther rings wait", () => {
  const wave = new FlipWave();
  const flips = [
    { row: 0, col: 1, distance: 1 },
    { row: 1, col: 0, distance: 1 },
    { row: 0, col: 2, distance: 2 },
    { row: 2, col: 2, distance: 2 },
    { row: 0, col: 3, distance: 3 },
  ];
  assert.equal(wave.sync(flips, { origin: { row: 0, col: 0 }, animate: true, now: 1000 }), true);
  for (let t = 1000; t <= 1000 + wave.duration; t += 37) {
    assert.deepEqual(wave.look(0, 1, t), wave.look(1, 0, t), `ring 1 at ${t}`);
    assert.deepEqual(wave.look(0, 2, t), wave.look(2, 2, t), `ring 2 at ${t}`);
    const near = wave.look(0, 1, t);
    const far = wave.look(0, 3, t);
    // A farther ring is never ahead of a nearer one.
    const angle = (look, done) => (look ? look.angle : done ? Math.PI : 0);
    const nearDone = t - 1000 >= FLIP_WAVE_DELAY_MS + FLIP_TURN_MS;
    assert.ok(angle(far, false) <= angle(near, nearDone) + 1e-9, `order at ${t}`);
  }
  // Before its turn a disc shows the old colour, unrotated.
  const waiting = wave.look(0, 3, 1000 + FLIP_WAVE_DELAY_MS + FLIP_TURN_MS);
  assert.equal(waiting.showNewColor, false);
  assert.equal(waiting.angle, 0);
  assert.equal(wave.look(5, 5, 1100), null, "a disc outside the wave is untouched");
  assert.equal(wave.running(1000 + wave.duration - 1), true);
  assert.equal(wave.running(1000 + wave.duration), false);
  assert.equal(wave.look(0, 1, 1100), null, "an ended wave leaves every disc alone");
});

test("only a move just played starts a wave; redraws keep it, jumps and reduced motion skip it", () => {
  const wave = new FlipWave();
  const flips = [{ row: 1, col: 1, distance: 1 }];
  assert.equal(wave.sync(flips, { origin: { row: 1, col: 0 }, animate: false, now: 0 }), false);
  assert.equal(wave.running(1), false, "an undo or a jump shows the result at once");
  assert.equal(wave.sync([], { now: 5 }), false);
  assert.equal(wave.sync(flips, { origin: { row: 1, col: 0 }, animate: true, now: 10 }), true);
  // The page redraws the same position many times while the wave runs.
  assert.equal(wave.sync(flips, { origin: { row: 1, col: 0 }, animate: false, now: 50 }), false);
  assert.equal(wave.running(60), true);
  // The same flipped disc from another move (origin) is a new wave.
  assert.equal(wave.sync(flips, { origin: { row: 1, col: 2 }, animate: true, now: 70 }), true);
  wave.reset();
  assert.equal(wave.running(71), false);
  assert.equal(wave.sync(flips, { origin: { row: 1, col: 2 }, animate: true, now: 80 }), true, "reset forgets the flips");

  const calm = new FlipWave({ reducedMotion: true });
  assert.equal(calm.sync(flips, { animate: true, now: 0 }), false);
  assert.equal(calm.look(1, 1, 100), null);
});

test("3D stones turn about the board, lift, and swap colour when edge-on", () => {
  const black = new THREE.MeshBasicMaterial();
  const white = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), black);
  const positionStone = (stone) => {
    stone.position.set(0, 0, 0);
    stone.scale.set(0.4, 0.1, 0.4);
    stone.quaternion.identity();
  };
  const wave = new FlipWave();
  wave.sync([{ row: 0, col: 1, distance: 1 }], { animate: true, now: 0 });
  const entries = [{ mesh, row: 0, col: 1, color: BLACK }];
  const options = { positionStone, materials: { black, white } };

  poseFlippingStones(entries, wave, { ...options, now: 0 });
  assert.equal(mesh.material, white, "still the old colour while waiting");
  assert.equal(mesh.position.y, 0);

  poseFlippingStones(entries, wave, { ...options, now: FLIP_WAVE_DELAY_MS + FLIP_TURN_MS * 0.5 });
  assert.equal(mesh.material, black, "the new colour from edge-on");
  assert.ok(mesh.position.y > 0.3, "lifted along the normal");
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
  assert.ok(Math.abs(up.y) < 1e-6, "edge-on at half way");

  poseFlippingStones(entries, wave, { ...options, now: FLIP_WAVE_DELAY_MS + FLIP_TURN_MS * 0.25 });
  assert.equal(mesh.material, white);

  poseFlippingStones(entries, wave, { ...options, now: 10_000 });
  assert.equal(mesh.material, black);
  assert.equal(mesh.position.y, 0);
  assert.ok(mesh.quaternion.equals(new THREE.Quaternion()), "back to its plain pose");
});

test("AI moves wait at least a second, and for the flip wave to finish", () => {
  assert.equal(AI_MIN_MOVE_DELAY_MS, 1_000);
  // An instant answer waits out the second.
  assert.equal(aiMoveWaitMs({ startedAt: 1000, now: 1010 }), 990);
  // A slow answer plays at once.
  assert.equal(aiMoveWaitMs({ startedAt: 1000, now: 4000 }), 0);
  // A long flip wave of the human's move holds the AI back until it ends.
  assert.equal(
    aiMoveWaitMs({ startedAt: 1000, now: 1200, animationEndsAt: 3000 }),
    3000 + AI_AFTER_ANIMATION_MS - 1200,
  );
  // A wave that already ended adds nothing.
  assert.equal(aiMoveWaitMs({ startedAt: 1000, now: 2500, animationEndsAt: 1500 }), 0);
  // Nonsense times never block a move.
  assert.equal(aiMoveWaitMs({ startedAt: Number.NaN, now: 10 }), 0);
  assert.equal(aiMoveWaitMs({ startedAt: 0, now: Number.NaN }), 0);
});

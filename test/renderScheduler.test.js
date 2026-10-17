import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { ArcBoard } from "../src/view/ArcBoard.js";
import { CylinderBoard } from "../src/view/CylinderBoard.js";
import { TorusBoard } from "../src/view/TorusBoard.js";
import { createPlayerViewLighting } from "../src/view/playerViewLighting.js";
import { createRenderScheduler } from "../src/view/renderScheduler.js";

function frameQueue() {
  const callbacks = new Map();
  let nextId = 1;
  let now = 0;
  return {
    requestFrame(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    get size() {
      return callbacks.size;
    },
    /** Run one animation frame; returns how many callbacks ran. */
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      now += 16;
      for (const callback of pending) callback(now);
      return pending.length;
    },
  };
}

/** OrbitControls stand-in: emits "change" while damping or auto-rotating. */
class FakeControls extends THREE.EventDispatcher {
  constructor() {
    super();
    this.autoRotate = false;
    this.dampingFrames = 0;
    this.target = new THREE.Vector3();
  }

  update() {
    if (!this.autoRotate && this.dampingFrames === 0) return false;
    this.dampingFrames = Math.max(0, this.dampingFrames - 1);
    this.dispatchEvent({ type: "change" });
    return true;
  }
}

function viewHarness(BoardClass, overrides = {}) {
  const frames = frameQueue();
  let renders = 0;
  const board = Object.assign(Object.create(BoardClass.prototype), {
    active: true,
    destroyed: false,
    controls: new FakeControls(),
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    renderer: { render: () => { renders += 1; } },
    majorRadius: 4,
    minorRadius: 2,
    ...overrides,
  });
  board.playerViewLighting = createPlayerViewLighting(board.scene);
  board.renderScheduler = createRenderScheduler(
    (now) => board.renderFrame(now),
    frames,
  );
  board.controls.addEventListener("change", () => board.requestRender());
  return { board, frames, renders: () => renders };
}

function runFrames(frames, limit = 200) {
  let count = 0;
  while (frames.size > 0 && count < limit) {
    frames.flush();
    count += 1;
  }
  return count;
}

test("render requests coalesce into one frame and can chain", () => {
  const frames = frameQueue();
  const seen = [];
  let again = 2;
  const scheduler = createRenderScheduler((now) => {
    seen.push(now);
    if (again > 0) {
      again -= 1;
      scheduler.request();
    }
  }, frames);
  scheduler.request();
  scheduler.request();
  scheduler.request();
  assert.equal(frames.size, 1);
  assert.equal(runFrames(frames), 3);
  assert.deepEqual(seen, [16, 32, 48]);
  assert.equal(scheduler.pending, false);

  scheduler.request();
  scheduler.cancel();
  assert.equal(frames.size, 0);
  assert.equal(scheduler.pending, false);
});

for (const BoardClass of [CylinderBoard, TorusBoard]) {
  test(`${BoardClass.name} renders on demand and settles after damping`, () => {
    const { board, frames, renders } = viewHarness(BoardClass);
    board.requestRender();
    board.requestRender();
    assert.equal(runFrames(frames), 1);
    assert.equal(renders(), 1);
    // Idle: nothing is scheduled any more.
    assert.equal(frames.size, 0);

    // A drag leaves damping velocity: frames continue until it settles.
    board.controls.dampingFrames = 5;
    board.controls.dispatchEvent({ type: "change" });
    assert.equal(runFrames(frames), 6);
    assert.equal(frames.size, 0);

    // Auto-rotation keeps animating until it is switched off.
    board.setAutoRotate(true);
    assert.equal(runFrames(frames, 30), 30);
    assert.equal(frames.size, 1);
    board.setAutoRotate(false);
    assert.ok(runFrames(frames) <= 1);
    assert.equal(frames.size, 0);

    // Inactive views never schedule frames.
    board.active = false;
    board.requestRender();
    assert.equal(frames.size, 0);
  });
}

test("ArcBoard only animates continuously while auto-sliding", () => {
  let layoutUpdates = 0;
  const { board, frames, renders } = viewHarness(ArcBoard, {
    width: 19,
    offsetColumns: 0,
    autoSlide: false,
    pointerState: null,
    snapFrame: null,
    lastAnimationTime: null,
    updateContentLayout() {
      layoutUpdates += 1;
      this.requestRender();
    },
    cancelSnap() {},
    snapToColumn() {},
  });
  board.requestRender();
  assert.equal(runFrames(frames), 1);
  assert.equal(frames.size, 0);
  assert.equal(renders(), 1);

  board.setAutoRotate(true);
  assert.equal(runFrames(frames, 20), 20);
  assert.ok(board.offsetColumns > 0);
  assert.ok(layoutUpdates >= 18);

  // A drag pauses the slide; releasing resumes it.
  board.pointerState = { id: 1 };
  runFrames(frames);
  assert.equal(frames.size, 0);
  board.pointerState = null;
  board.requestRender();
  assert.equal(runFrames(frames, 5), 5);

  board.setAutoRotate(false);
  assert.ok(runFrames(frames) <= 1);
  assert.equal(frames.size, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import { CylinderBoard } from "../src/view/CylinderBoard.js";
import { FlatBoard } from "../src/view/FlatBoard.js";
import { TorusBoard } from "../src/view/TorusBoard.js";
import {
  applyBoardTouchAction,
  boardTouchAction,
  invalidatePendingTapOnAdditionalPointer,
  needsFreeBoardDrag,
  registerBoardTouchTargets,
  setBoardSwipeScrollsPage,
  pointerGestureRoles,
  preventBoardContextMenu,
} from "../src/view/pointerGestures.js";

const FIRST_TOUCH = {
  pointerId: 1,
  pointerType: "touch",
  isPrimary: true,
  button: 0,
  clientX: 40,
  clientY: 50,
};
const SECOND_TOUCH = {
  pointerId: 2,
  pointerType: "touch",
  isPrimary: false,
  button: 0,
  clientX: 90,
  clientY: 95,
};

test("desktop left click places while only right drag browses", () => {
  assert.deepEqual(
    pointerGestureRoles({ pointerType: "mouse", button: 0, isPrimary: true }),
    { canPlace: true, canDrag: false },
  );
  assert.deepEqual(
    pointerGestureRoles({ pointerType: "mouse", button: 2, isPrimary: true }),
    { canPlace: false, canDrag: true },
  );
  assert.equal(
    pointerGestureRoles({ pointerType: "mouse", button: 1, isPrimary: true }),
    null,
  );
});

test("touch and pen keep tap-to-place plus drag-to-browse", () => {
  for (const pointerType of ["touch", "pen"]) {
    assert.deepEqual(
      pointerGestureRoles({ pointerType, button: 0, isPrimary: true }),
      { canPlace: true, canDrag: true },
    );
  }
  assert.equal(
    pointerGestureRoles({ pointerType: "touch", button: 0, isPrimary: false }),
    null,
  );
});

test("a second touch or pen invalidates the original tap without mutating it", () => {
  const pending = { id: 1, canPlace: true, cancelClick: false, x: 40, y: 50 };
  for (const pointerType of ["touch", "pen"]) {
    const guarded = invalidatePendingTapOnAdditionalPointer(pending, {
      pointerId: 2,
      pointerType,
    });
    assert.notEqual(guarded, pending);
    assert.equal(guarded.canPlace, false);
    assert.equal(guarded.cancelClick, true);
    assert.equal(guarded.x, 40);
  }
  assert.equal(pending.canPlace, true);
  assert.equal(pending.cancelClick, false);
  assert.equal(
    invalidatePendingTapOnAdditionalPointer(pending, FIRST_TOUCH),
    pending,
  );
  assert.equal(
    invalidatePendingTapOnAdditionalPointer(pending, {
      ...SECOND_TOUCH,
      pointerType: "mouse",
    }),
    pending,
  );
});

function flatHarness() {
  let placements = 0;
  const board = Object.assign(Object.create(FlatBoard.prototype), {
    active: true,
    pointerState: null,
    offsetColumns: 0,
    offsetRows: 0,
    wrapRows: false,
    cell: 20,
    canvas: {
      setPointerCapture() {},
      hasPointerCapture() { return false; },
    },
    container: { classList: { add() {}, remove() {} } },
    cancelSnap() {},
    setHoveredPoint() {},
    hitPoint() { return { row: 0, col: 0 }; },
    snapToGrid() {},
    horizontalPeriod() { return 19; },
    onPoint() { placements += 1; },
  });
  return {
    down: (event) => board.pointerDown(event),
    up: (event) => board.pointerUp(event),
    placements: () => placements,
  };
}

function threeDimensionalHarness(BoardClass) {
  let placements = 0;
  const board = Object.assign(Object.create(BoardClass.prototype), {
    active: true,
    pointerStart: null,
    renderer: {
      domElement: {
        setPointerCapture() {},
        hasPointerCapture() { return false; },
      },
    },
    setHoveredPoint() {},
    raycastPoint() { return { row: 0, col: 0 }; },
    onPoint() { placements += 1; },
  });
  return {
    down: (event) => board.handlePointerDown(event),
    up: (event) => board.handlePointerUp(event),
    placements: () => placements,
  };
}

test("releasing either pointer after a two-pointer gesture never places", () => {
  const harnessFactories = [
    flatHarness,
    () => threeDimensionalHarness(CylinderBoard),
    () => threeDimensionalHarness(TorusBoard),
  ];
  for (const createHarness of harnessFactories) {
    for (const pointerType of ["touch", "pen"]) {
      const firstPointer = { ...FIRST_TOUCH, pointerType };
      const secondPointer = { ...SECOND_TOUCH, pointerType };
      for (const releaseOrder of [
        [secondPointer, firstPointer],
        [firstPointer, secondPointer],
      ]) {
        const harness = createHarness();
        harness.down(firstPointer);
        harness.down(secondPointer);
        for (const event of releaseOrder) harness.up(event);
        assert.equal(harness.placements(), 0);
      }
    }
  }
});

test("board context menus are suppressed without another side effect", () => {
  let prevented = 0;
  preventBoardContextMenu({ preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
});

test("boards that move up and down keep vertical drags; sideways-only views let the page scroll", () => {
  const policy = (view, topology, swipeScrollsPage) =>
    boardTouchAction({ view, topology, swipeScrollsPage });
  // Up/down drags move these boards: the torus pan and every 3D view (the
  // cylinder tilts, the torus and Mobius band turn freely).
  for (const [view, topology] of [
    ["flat", "torus"], ["3d", "cylinder"], ["3d", "torus"], ["3d", "mobius"],
  ]) {
    assert.equal(needsFreeBoardDrag({ view, topology }), true, `${view} ${topology}`);
    assert.equal(policy(view, topology), "none", `${view} ${topology}`);
    // The player can hand vertical swipes to the page instead.
    assert.equal(policy(view, topology, true), "pan-y", `${view} ${topology}`);
  }
  // The arc and the flat cylinder and Mobius strip only drag sideways.
  for (const [view, topology] of [["arc", "cylinder"], ["flat", "cylinder"], ["flat", "mobius"]]) {
    assert.equal(needsFreeBoardDrag({ view, topology }), false, `${view} ${topology}`);
    assert.equal(policy(view, topology), "pan-y");
    assert.equal(policy(view, topology, true), "pan-y");
  }
  // pan-y never includes pinch-zoom, so pinches still reach the view.
  for (const view of ["flat", "arc", "3d"]) {
    for (const topology of ["cylinder", "torus", "mobius"]) {
      for (const scrolls of [false, true]) {
        assert.doesNotMatch(policy(view, topology, scrolls), /pinch|auto|manipulation/);
      }
    }
  }
});

test("the swipe choice re-applies every registered view's touch policy", () => {
  const element = () => ({ style: {} });
  const torus = [element(), element()];
  const arc = [element(), element()];
  registerBoardTouchTargets(torus, { view: "3d", topology: "torus" });
  registerBoardTouchTargets(arc, { view: "arc", topology: "cylinder" });
  assert.deepEqual(torus.map((node) => node.style.touchAction), ["none", "none"]);
  setBoardSwipeScrollsPage(true);
  assert.deepEqual(torus.map((node) => node.style.touchAction), ["pan-y", "pan-y"]);
  assert.deepEqual(arc.map((node) => node.style.touchAction), ["pan-y", "pan-y"]);
  // A rebuilt view in the same container replaces the old entry.
  const rebuilt = [torus[0], element()];
  registerBoardTouchTargets(rebuilt, { view: "flat", topology: "torus" });
  assert.equal(rebuilt[1].style.touchAction, "pan-y");
  setBoardSwipeScrollsPage(false);
  assert.equal(rebuilt[1].style.touchAction, "none");
  assert.equal(torus[1].style.touchAction, "pan-y", "the replaced view is no longer updated");
});

test("touch policy overrides the inline style OrbitControls leaves", () => {
  const container = { style: { touchAction: "" } };
  const canvas = { style: { touchAction: "none" } };
  applyBoardTouchAction([container, canvas, null], "pan-y");
  assert.equal(container.style.touchAction, "pan-y");
  assert.equal(canvas.style.touchAction, "pan-y");
});

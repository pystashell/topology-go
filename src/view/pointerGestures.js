/**
 * Keep placing stones and browsing the board on distinct desktop mouse inputs.
 * Touch and pen retain the existing tap/drag dual gesture.
 */
export function pointerGestureRoles(event) {
  if (event?.isPrimary === false) return null;
  if (event?.pointerType !== "mouse") {
    return { canPlace: true, canDrag: true };
  }
  if (event.button === 0) return { canPlace: true, canDrag: false };
  if (event.button === 2) return { canPlace: false, canDrag: true };
  return null;
}

/**
 * A second direct pointer turns the gesture into a multi-pointer interaction.
 * Keep the original pointer available to the view/OrbitControls, but make its
 * pending tap permanently ineligible to place a stone.
 */
export function invalidatePendingTapOnAdditionalPointer(pending, event) {
  if (
    !pending ||
    !["touch", "pen"].includes(event?.pointerType) ||
    event.pointerId === pending.id
  ) {
    return pending;
  }
  return {
    ...pending,
    canPlace: false,
    cancelClick: true,
  };
}

export function preventBoardContextMenu(event) {
  event.preventDefault();
}

/**
 * Views whose one-finger drag goes in every direction: panning the flat
 * torus, and every 3D view (the torus and Mobius band turn freely, the
 * cylinder spins and tilts). The arc and the flat cylinder and Mobius strip
 * only drag sideways.
 */
export function needsFreeBoardDrag({ view, topology }) {
  if (view === "flat") return topology === "torus";
  return view === "3d";
}

/**
 * Browser touch gestures each board view leaves to the page.
 *
 * Free-drag views keep every gesture, so up/down drags always move the
 * board; the page scrolls from outside the board stage, which never fills a
 * phone screen. Views that only drag sideways let swipes that start
 * vertically scroll the page (pan-y); a pinch still reaches the view, and a
 * drag that starts horizontally keeps control. A player may let vertical
 * swipes scroll the page on free-drag views too (swipeScrollsPage); a drag
 * must then start sideways to turn the board.
 */
export function boardTouchAction({ view, topology, swipeScrollsPage = false }) {
  return needsFreeBoardDrag({ view, topology }) && !swipeScrollsPage ? "none" : "pan-y";
}

// Each view's touch elements by container, so a new choice reaches views
// that already exist. A rebuilt view replaces its entry.
const touchTargets = new Map();
let swipeScrollsPage = false;

/** Apply and remember a view's touch policy (elements[0] is its container). */
export function registerBoardTouchTargets(elements, { view, topology }) {
  touchTargets.set(elements[0], { elements, view, topology });
  applyBoardTouchAction(elements, boardTouchAction({ view, topology, swipeScrollsPage }));
}

/** Let vertical swipes on free-drag boards scroll the page (true) or move the board. */
export function setBoardSwipeScrollsPage(enabled) {
  swipeScrollsPage = Boolean(enabled);
  for (const { elements, view, topology } of touchTargets.values()) {
    applyBoardTouchAction(elements, boardTouchAction({ view, topology, swipeScrollsPage }));
  }
}

/**
 * Apply a touch-action to a view's container and canvas. OrbitControls
 * writes an inline `touch-action: none` on its canvas, so this must run
 * after the controls are created.
 */
export function applyBoardTouchAction(elements, touchAction) {
  for (const element of elements) {
    if (element?.style) element.style.touchAction = touchAction;
  }
}

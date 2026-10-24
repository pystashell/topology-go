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
 * torus and rotating the 3D torus and Mobius band.
 */
export function needsFreeBoardDrag({ view, topology }) {
  if (view === "flat") return topology === "torus";
  if (view === "arc") return false;
  return topology !== "cylinder";
}

/**
 * Browser touch gestures each board view leaves to the page.
 *
 * Every view lets a one-finger swipe that starts vertically scroll the page
 * (pan-y); a pinch still reaches the view, and a drag that starts
 * horizontally keeps control even if it then turns vertical, so free-drag
 * views still turn in every direction. Fixing the page (pageScrollLocked)
 * gives free-drag views every gesture instead; the page then scrolls from
 * outside the board stage, which never fills a phone screen.
 */
export function boardTouchAction({ view, topology, pageScrollLocked = false }) {
  return pageScrollLocked && needsFreeBoardDrag({ view, topology }) ? "none" : "pan-y";
}

// Each view's touch elements by container, so a new page-scroll choice
// reaches views that already exist. A rebuilt view replaces its entry.
const touchTargets = new Map();
let pageScrollLocked = false;

/** Apply and remember a view's touch policy (elements[0] is its container). */
export function registerBoardTouchTargets(elements, { view, topology }) {
  touchTargets.set(elements[0], { elements, view, topology });
  applyBoardTouchAction(elements, boardTouchAction({ view, topology, pageScrollLocked }));
}

/** Fix the page under free-drag views (true) or let vertical swipes scroll it. */
export function setBoardPageScrollLocked(locked) {
  pageScrollLocked = Boolean(locked);
  for (const { elements, view, topology } of touchTargets.values()) {
    applyBoardTouchAction(elements, boardTouchAction({ view, topology, pageScrollLocked }));
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

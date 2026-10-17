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
 * Browser touch gestures each board view leaves to the page.
 *
 * Views whose only one-finger drag is horizontal (the flat cylinder and
 * Mobius pans, the arc slide, spinning the 3D cylinder about its axis) let
 * vertical swipes scroll the page; a pinch still reaches the view, and a drag
 * that starts horizontally keeps control even if it then turns vertical.
 * Views that need free 2D dragging (panning the flat torus, rotating the 3D
 * torus and Mobius band) keep every gesture; there the page scrolls from
 * outside the board stage, which never fills a phone screen.
 */
export function boardTouchAction({ view, topology }) {
  if (view === "flat") return topology === "torus" ? "none" : "pan-y";
  if (view === "arc") return "pan-y";
  return topology === "cylinder" ? "pan-y" : "none";
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

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

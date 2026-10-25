/**
 * How long an AI move waits before it is shown. However fast the engine
 * answers, a move appears at least AI_MIN_MOVE_DELAY_MS after the AI's turn
 * began, and never before the previous move's Othello flip wave has finished
 * (plus a short beat), so each move can be followed.
 */

export const AI_MIN_MOVE_DELAY_MS = 1_000;
export const AI_AFTER_ANIMATION_MS = 150;

/**
 * @param {{startedAt: number, now: number, animationEndsAt?: number,
 *   minimumMs?: number}} timing Times on one clock (performance.now()).
 * @returns {number} Milliseconds still to wait (0 to play now).
 */
export function aiMoveWaitMs({
  startedAt,
  now,
  animationEndsAt = 0,
  minimumMs = AI_MIN_MOVE_DELAY_MS,
}) {
  if (!Number.isFinite(now)) return 0;
  const minimum = Number.isFinite(startedAt) ? startedAt + minimumMs - now : 0;
  const animation = Number.isFinite(animationEndsAt) && animationEndsAt > 0
    ? animationEndsAt + AI_AFTER_ANIMATION_MS - now
    : 0;
  return Math.max(0, Math.ceil(Math.max(minimum, animation)));
}

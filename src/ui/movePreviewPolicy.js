/**
 * Decide whether this browser may show a playable ghost stone.
 *
 * The shared game state's currentPlayer is not enough in AI or online games:
 * it also describes the opponent's turn. Keeping this policy independent of
 * the renderers makes all three board views follow the same local authority.
 */
export function shouldEnableMovePreview({
  phase,
  mode,
  currentPlayer,
  localColor = null,
  aiThinking = false,
  connected = false,
  roomReady = false,
  bothPlayers = false,
  onlineBusy = false,
  commandPending = false,
}) {
  if (phase !== "play") return false;
  if (mode === "local") return true;
  if (mode === "ai") {
    return !aiThinking && Boolean(localColor) && currentPlayer === localColor;
  }
  if (mode === "online") {
    return (
      connected &&
      roomReady &&
      bothPlayers &&
      !onlineBusy &&
      !commandPending &&
      Boolean(localColor) &&
      currentPlayer === localColor
    );
  }
  return false;
}

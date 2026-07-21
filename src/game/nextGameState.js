import { AI_MATCH_SELF_PLAY } from "../ai/matchMode.js";

function gameDimension(game, key, fallback = 19) {
  const value = game?.[key] ?? game?.size;
  return Number.isInteger(value) ? value : fallback;
}

/**
 * Capture the authoritative options of the game that just ended. Both the
 * immediate and configurable next-game paths use this exact same snapshot.
 */
export function previousGameOptions(game, timeControl = null) {
  const width = gameDimension(game, "width");
  const height = gameDimension(game, "height");
  return {
    width,
    height,
    ...(width === height ? { size: width } : {}),
    topology: game?.topology,
    scoringRule: game?.scoringRule,
    komi: game?.komi,
    mainTimeSeconds: Number(timeControl?.mainTimeSeconds) || 0,
    byoYomiPeriods: Number(timeControl?.byoYomiPeriods) || 0,
    byoYomiSeconds: Number(timeControl?.byoYomiSeconds) || 0,
  };
}

/**
 * Starting another local game must not silently change who controls either
 * color or which model is used. AI self-play is the sole special case: a new
 * game resumes autoplay even if the completed game had been paused.
 */
export function prepareLocalNextGameAIState(state) {
  return {
    ...state,
    autoplayPaused: state?.active && state?.matchMode === AI_MATCH_SELF_PLAY
      ? false
      : Boolean(state?.autoplayPaused),
  };
}

/**
 * Derive the only transition that is allowed to dismiss an online next-game
 * preview. Revisions can change for presence/chat/clock snapshots, so a fresh
 * server position token plus an empty live board is required.
 */
export function onlineNextGameTransition({
  previousRoom,
  nextRoom,
  setupActive = false,
} = {}) {
  const positionChanged = Boolean(
    previousRoom &&
    typeof previousRoom.positionToken === "string" &&
    typeof nextRoom?.positionToken === "string" &&
    nextRoom.positionToken !== previousRoom.positionToken,
  );
  const previousRoundFinished = Boolean(
    previousRoom?.game?.phase === "finished" || previousRoom?.timeControl?.outcome,
  );
  const nextRoundStarted = Boolean(
    previousRoundFinished &&
    positionChanged &&
    nextRoom?.game?.phase === "play" &&
    !nextRoom?.timeControl?.outcome &&
    nextRoom?.moveCount === 0,
  );
  return {
    positionChanged,
    nextRoundStarted,
    exitSetup: Boolean(setupActive && nextRoundStarted),
  };
}

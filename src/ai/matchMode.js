export const AI_MATCH_HUMAN = "human-ai";
export const AI_MATCH_SELF_PLAY = "ai-ai";

export function normalizeAIMatchMode(value) {
  return value === AI_MATCH_SELF_PLAY ? AI_MATCH_SELF_PLAY : AI_MATCH_HUMAN;
}

export function isAIControlledColor({ active, mode, humanColor, color }) {
  if (!active || (color !== "black" && color !== "white")) return false;
  if (normalizeAIMatchMode(mode) === AI_MATCH_SELF_PLAY) return true;
  return color !== humanColor;
}

export function shouldRunAI({
  active,
  mode,
  humanColor,
  color,
  phase,
  paused = false,
  replaying = false,
}) {
  return (
    phase === "play" &&
    !paused &&
    !replaying &&
    isAIControlledColor({ active, mode, humanColor, color })
  );
}

export function shouldPauseAIMatchAtScoring({ active, mode, phase }) {
  return (
    Boolean(active) &&
    normalizeAIMatchMode(mode) === AI_MATCH_SELF_PLAY &&
    phase === "scoring"
  );
}

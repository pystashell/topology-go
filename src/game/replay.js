import {
  BLACK,
  PHASE_FINISHED,
  REPLAY_VERSION,
  WHITE,
} from "./goEngine.js";
import { gameTypeOf, rulesFor } from "./rules/index.js";

const VALID_COLORS = new Set([BLACK, WHITE]);
// Events that only exist in games with dead-stone scoring (Go).
const SCORING_EVENTS = new Set(["resume_play", "toggle_dead", "finish_scoring"]);

function requireReplayObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function applyReplayEvent(game, event, index) {
  requireReplayObject(event, `replay.events[${index}]`);
  const { capabilities, id } = rulesFor(gameTypeOf(game));
  if (
    (event.type === "pass" && !capabilities.pass) ||
    (SCORING_EVENTS.has(event.type) && !capabilities.scoring)
  ) {
    throw new TypeError(
      `replay.events[${index}] type ${event.type} does not exist in ${id}`,
    );
  }
  let result;

  if (event.type === "play") {
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`replay.events[${index}] has an invalid color`);
    }
    if (game.currentPlayer !== event.color) {
      throw new TypeError(
        `replay.events[${index}] color does not match the player to move`,
      );
    }
    result = game.play(event.row, event.col);
  } else if (event.type === "pass") {
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`replay.events[${index}] has an invalid color`);
    }
    if (game.currentPlayer !== event.color) {
      throw new TypeError(
        `replay.events[${index}] color does not match the player to move`,
      );
    }
    result = game.pass();
  } else if (event.type === "resume_play") {
    if (!VALID_COLORS.has(event.nextPlayer)) {
      throw new TypeError(`replay.events[${index}] has an invalid nextPlayer`);
    }
    result = game.resumePlay(event.nextPlayer);
  } else if (event.type === "toggle_dead") {
    result = game.toggleDead(event.row, event.col);
  } else if (event.type === "finish_scoring") {
    result = game.finishScoring(event.rule);
  } else if (event.type === "resign") {
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`replay.events[${index}] has an invalid color`);
    }
    result = game.resign(event.color);
  } else {
    throw new TypeError(
      `Unknown replay event type at replay.events[${index}]: ${event.type}`,
    );
  }

  if (!result.ok) {
    throw new TypeError(
      `replay.events[${index}] is illegal: ${result.reason}`,
    );
  }
  return result;
}

function createReplayGame(replay) {
  requireReplayObject(replay, "replay");
  if (replay.version !== REPLAY_VERSION) {
    throw new TypeError(`Unsupported replay version: ${replay.version}`);
  }
  if (typeof replay.complete !== "boolean") {
    throw new TypeError("replay.complete must be a boolean");
  }
  requireReplayObject(replay.base, "replay.base");
  if (Object.prototype.hasOwnProperty.call(replay.base, "replay")) {
    throw new TypeError("replay.base must not contain a nested replay");
  }
  if (!Array.isArray(replay.events)) {
    throw new TypeError("replay.events must be an array");
  }
  // Every game shares the replay envelope; the base names its game (absent
  // for Go, whose states predate multiple games).
  return rulesFor(gameTypeOf(replay.base)).fromState(replay.base);
}

/**
 * The render step for one successful play. Go adds its captured stones;
 * games that flip discs add the flipped discs and any skipped (auto-passed)
 * colour reported by the engine.
 */
function playStep(result) {
  const step = {
    type: "play",
    color: result.color,
    row: result.row,
    col: result.col,
  };
  if (Array.isArray(result.captured)) {
    step.captured = result.captured.map(({ row, col }) => ({ row, col }));
  }
  if (Array.isArray(result.flipped)) {
    step.flipped = result.flipped.map(({ row, col }) => ({ row, col }));
  }
  if (Object.prototype.hasOwnProperty.call(result, "skipped")) {
    step.skipped = result.skipped ?? null;
  }
  return step;
}

function replayOutcomeResult(replay) {
  const outcome = replay?.outcome;
  if (outcome === undefined || outcome === null) return null;
  requireReplayObject(outcome, "replay.outcome");
  if (outcome.reason === "timeout") {
    if (
      !VALID_COLORS.has(outcome.winner) ||
      !VALID_COLORS.has(outcome.loser) ||
      outcome.winner === outcome.loser ||
      !Number.isFinite(outcome.finishedAt)
    ) {
      throw new TypeError("replay.outcome must be a valid timeout result");
    }
    return {
      winner: outcome.winner,
      loser: outcome.loser,
      margin: 0,
      reason: "timeout",
      finishedAt: outcome.finishedAt,
    };
  }
  if (outcome.reason === "resign") {
    if (
      !VALID_COLORS.has(outcome.winner) ||
      !VALID_COLORS.has(outcome.loser) ||
      outcome.winner === outcome.loser ||
      (outcome.margin !== undefined && outcome.margin !== 0) ||
      (outcome.resignation !== undefined && outcome.resignation !== true)
    ) {
      throw new TypeError("replay.outcome must be a valid resignation result");
    }
    return {
      winner: outcome.winner,
      loser: outcome.loser,
      margin: 0,
      reason: "resign",
      resignation: true,
    };
  }
  throw new TypeError("replay.outcome must be a supported terminal result");
}

function finishReplayFrameByOutcome(frame, result) {
  if (!result) return frame;
  return {
    ...frame,
    phase: PHASE_FINISHED,
    result: structuredClone(result),
  };
}

/**
 * Expand a compact replay into render-ready positions.
 *
 * frames[0] is the starting position and every successful play/pass adds one
 * frame. Scoring and resume-play events update the current frame without
 * incrementing the move number, preserving the exact final result while the
 * transport remains expressed in ordinary Go hands. The replay base's
 * gameType (absent for Go) selects the rules that rebuild every frame.
 * `steps[index]` describes the move from frames[index] to frames[index + 1].
 */
export function buildReplayFrames(replay) {
  const game = createReplayGame(replay);
  const frames = [game.getState()];
  const steps = [];
  const outcomeResult = replayOutcomeResult(replay);

  replay.events.forEach((event, eventIndex) => {
    const result = applyReplayEvent(game, event, eventIndex);
    if (!["play", "pass"].includes(event.type)) {
      frames[frames.length - 1] = game.getState();
      return;
    }

    frames.push(game.getState());
    if (event.type === "play") {
      steps.push(playStep(result));
    } else {
      steps.push({ type: "pass", color: result.color });
    }
  });

  if (outcomeResult) {
    frames[frames.length - 1] = finishReplayFrameByOutcome(
      frames[frames.length - 1],
      outcomeResult,
    );
  }

  return { frames, steps, complete: replay.complete };
}

/**
 * Rebuild the authoritative engine snapshot shown at one replay move number.
 * Unlike a render frame, this includes positional superko history and can be
 * sent directly to an AI worker. Non-move scoring/resume events that belong to
 * the requested frame are applied before the snapshot is returned.
 */
export function buildReplayStateAtStep(replay, requestedStep) {
  if (!Number.isSafeInteger(requestedStep) || requestedStep < 0) {
    throw new RangeError("Replay step must be a non-negative safe integer");
  }

  const game = createReplayGame(replay);
  let moveCount = 0;

  for (let eventIndex = 0; eventIndex < replay.events.length; eventIndex += 1) {
    const event = replay.events[eventIndex];
    const isMove = ["play", "pass"].includes(event?.type);
    if (isMove && moveCount >= requestedStep) break;
    applyReplayEvent(game, event, eventIndex);
    if (isMove) moveCount += 1;
  }

  if (moveCount < requestedStep) {
    throw new RangeError(
      `Replay step ${requestedStep} exceeds the recorded move count ${moveCount}`,
    );
  }
  return game.exportState({ includeReplay: false });
}

/** Preserve the full move history when reviewing a live online position. */
export function buildLiveReviewState(game, { online = false, replay, moveCount } = {}) {
  if (online) {
    const state = buildReplayStateAtStep(replay, moveCount);
    const visible = game.getState();
    const publicFields = [
      "width", "height", "topology", "komi", "scoringRule", "currentPlayer",
      "phase", "consecutivePasses", "captures", "board",
    ];
    if (publicFields.some((field) =>
      JSON.stringify(state[field]) !== JSON.stringify(visible[field]))) {
      throw new TypeError("Replay does not match the current public position");
    }
    return state;
  }
  return game.exportSearchState();
}

export default buildReplayFrames;

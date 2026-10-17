export const TIME_CONTROL_VERSION = 1;

export const MAX_MAIN_TIME_SECONDS = 7 * 24 * 60 * 60;
export const MAX_BYO_YOMI_PERIODS = 100;
export const MAX_BYO_YOMI_SECONDS = 60 * 60;

const BLACK = "black";
const WHITE = "white";
const COLORS = Object.freeze([BLACK, WHITE]);

function oppositeColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function requireColor(value, label = "color") {
  if (!COLORS.includes(value)) {
    throw new TypeError(`${label} must be black or white`);
  }
  return value;
}

function requireNow(value) {
  const now = value ?? Date.now();
  if (!Number.isFinite(now)) throw new TypeError("now must be finite");
  return now;
}

function boundedInteger(value, fallback, maximum, label) {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > maximum
  ) {
    throw new RangeError(`${label} must be an integer from 0 to ${maximum}`);
  }
  return normalized;
}

function boundedNumber(value, maximum, label) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be a finite number from 0 to ${maximum}`);
  }
  return value;
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}

/**
 * Validate the public seconds/periods configuration.
 *
 * `null` means an untimed game. A zeroed configuration is deliberately the
 * same as null so old clients can keep omitting all clock fields.
 */
export function normalizeTimeControlConfig(value = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("time control configuration must be an object");
  }

  const mainTimeSeconds = boundedInteger(
    value.mainTimeSeconds,
    0,
    MAX_MAIN_TIME_SECONDS,
    "mainTimeSeconds",
  );
  const byoYomiPeriods = boundedInteger(
    value.byoYomiPeriods,
    0,
    MAX_BYO_YOMI_PERIODS,
    "byoYomiPeriods",
  );
  const byoYomiSeconds = boundedInteger(
    value.byoYomiSeconds,
    0,
    MAX_BYO_YOMI_SECONDS,
    "byoYomiSeconds",
  );

  if ((byoYomiPeriods === 0) !== (byoYomiSeconds === 0)) {
    throw new RangeError(
      "byoYomiPeriods and byoYomiSeconds must either both be zero or both be positive",
    );
  }
  if (mainTimeSeconds === 0 && byoYomiPeriods === 0) return null;
  return { mainTimeSeconds, byoYomiPeriods, byoYomiSeconds };
}

function initialPlayer(config) {
  return {
    mainTimeRemainingMs: config.mainTimeSeconds * 1_000,
    byoYomiPeriodsRemaining: config.byoYomiPeriods,
    byoYomiTimeRemainingMs: config.byoYomiSeconds * 1_000,
  };
}

/** Create a serializable, initially paused Japanese clock. */
export function createTimeControl(config = {}, options = {}) {
  const normalized = normalizeTimeControlConfig(config);
  if (!normalized) return null;
  const now = requireNow(options.now);
  const activeColor = options.activeColor ?? null;
  if (activeColor !== null) requireColor(activeColor, "activeColor");
  return {
    version: TIME_CONTROL_VERSION,
    ...normalized,
    players: {
      [BLACK]: initialPlayer(normalized),
      [WHITE]: initialPlayer(normalized),
    },
    activeColor,
    activeSince: activeColor === null ? null : now,
    outcome: null,
  };
}

function validatePlayerClock(value, config, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const mainMaximum = config.mainTimeSeconds * 1_000;
  const periodMaximum = config.byoYomiSeconds * 1_000;
  const mainTimeRemainingMs = boundedNumber(
    value.mainTimeRemainingMs,
    mainMaximum,
    `${label}.mainTimeRemainingMs`,
  );
  const byoYomiPeriodsRemaining = boundedInteger(
    value.byoYomiPeriodsRemaining,
    -1,
    config.byoYomiPeriods,
    `${label}.byoYomiPeriodsRemaining`,
  );
  const byoYomiTimeRemainingMs = boundedNumber(
    value.byoYomiTimeRemainingMs,
    periodMaximum,
    `${label}.byoYomiTimeRemainingMs`,
  );
  if (
    (config.byoYomiPeriods === 0 &&
      (byoYomiPeriodsRemaining !== 0 || byoYomiTimeRemainingMs !== 0)) ||
    (byoYomiPeriodsRemaining === 0 && byoYomiTimeRemainingMs !== 0) ||
    (byoYomiPeriodsRemaining > 0 && byoYomiTimeRemainingMs < 1)
  ) {
    throw new RangeError(`${label} has inconsistent byo-yomi values`);
  }
  return {
    mainTimeRemainingMs,
    byoYomiPeriodsRemaining,
    byoYomiTimeRemainingMs,
  };
}

/** Validate and defensively copy a persisted clock. */
export function restoreTimeControl(value) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== TIME_CONTROL_VERSION
  ) {
    throw new TypeError("persisted time control is invalid");
  }
  const config = normalizeTimeControlConfig(value);
  if (!config) throw new TypeError("persisted time control cannot be disabled");
  const players = {
    [BLACK]: validatePlayerClock(value.players?.[BLACK], config, "players.black"),
    [WHITE]: validatePlayerClock(value.players?.[WHITE], config, "players.white"),
  };
  const activeColor = value.activeColor ?? null;
  if (activeColor !== null) requireColor(activeColor, "activeColor");
  const activeSince = value.activeSince ?? null;
  if (
    (activeColor === null && activeSince !== null) ||
    (activeColor !== null && !Number.isFinite(activeSince))
  ) {
    throw new TypeError("persisted active clock anchor is invalid");
  }

  let outcome = null;
  if (value.outcome !== null && value.outcome !== undefined) {
    if (
      typeof value.outcome !== "object" ||
      Array.isArray(value.outcome) ||
      value.outcome.reason !== "timeout"
    ) {
      throw new TypeError("persisted clock outcome is invalid");
    }
    const loser = requireColor(value.outcome.loser, "outcome.loser");
    const winner = requireColor(value.outcome.winner, "outcome.winner");
    if (winner !== oppositeColor(loser) || !Number.isFinite(value.outcome.finishedAt)) {
      throw new TypeError("persisted clock outcome is inconsistent");
    }
    if (activeColor !== null || activeSince !== null) {
      throw new TypeError("a finished clock cannot remain active");
    }
    outcome = {
      reason: "timeout",
      winner,
      loser,
      finishedAt: value.outcome.finishedAt,
    };
  }

  return {
    version: TIME_CONTROL_VERSION,
    ...config,
    players,
    activeColor,
    activeSince,
    outcome,
  };
}

export function timeControlConfig(clock) {
  if (!clock) return null;
  return {
    mainTimeSeconds: clock.mainTimeSeconds,
    byoYomiPeriods: clock.byoYomiPeriods,
    byoYomiSeconds: clock.byoYomiSeconds,
  };
}

function finishByTimeout(clock, loser, finishedAt) {
  const player = clock.players[loser];
  player.mainTimeRemainingMs = 0;
  player.byoYomiPeriodsRemaining = 0;
  player.byoYomiTimeRemainingMs = 0;
  clock.activeColor = null;
  clock.activeSince = null;
  clock.outcome = {
    reason: "timeout",
    winner: oppositeColor(loser),
    loser,
    finishedAt,
  };
  return clock;
}

function consumeActiveTime(value, nowInput) {
  const clock = clone(value);
  const now = requireNow(nowInput);
  if (!clock || clock.outcome || clock.activeColor === null) return clock;
  const color = clock.activeColor;
  const player = clock.players[color];
  let elapsed = Math.max(0, now - clock.activeSince);
  clock.activeSince = now;

  if (clock.byoYomiPeriods === 0) {
    if (elapsed >= player.mainTimeRemainingMs) {
      return finishByTimeout(clock, color, now - elapsed + player.mainTimeRemainingMs);
    }
    player.mainTimeRemainingMs -= elapsed;
    return clock;
  }

  if (player.mainTimeRemainingMs > 0) {
    if (elapsed < player.mainTimeRemainingMs) {
      player.mainTimeRemainingMs -= elapsed;
      return clock;
    }
    elapsed -= player.mainTimeRemainingMs;
    player.mainTimeRemainingMs = 0;
    if (elapsed === 0) return clock;
  }

  const periodLengthMs = clock.byoYomiSeconds * 1_000;
  while (elapsed >= player.byoYomiTimeRemainingMs) {
    const consumedAt = now - elapsed + player.byoYomiTimeRemainingMs;
    elapsed -= player.byoYomiTimeRemainingMs;
    player.byoYomiPeriodsRemaining -= 1;
    if (player.byoYomiPeriodsRemaining <= 0) {
      return finishByTimeout(clock, color, consumedAt);
    }
    player.byoYomiTimeRemainingMs = periodLengthMs;
  }
  player.byoYomiTimeRemainingMs -= elapsed;
  return clock;
}

/** Absolute timestamp at which the active player loses on time. */
export function nextTimeControlDueAt(value) {
  if (!value || value.outcome || value.activeColor === null) return null;
  const player = value.players[value.activeColor];
  const periodsAfterCurrent = Math.max(
    0,
    player.byoYomiPeriodsRemaining - (player.byoYomiPeriodsRemaining > 0 ? 1 : 0),
  );
  const remainingMs =
    player.mainTimeRemainingMs +
    player.byoYomiTimeRemainingMs +
    periodsAfterCurrent * value.byoYomiSeconds * 1_000;
  return value.activeSince + remainingMs;
}

/** Only materialize a running clock when its final deadline has been reached. */
export function advanceTimeControl(value, nowInput) {
  if (!value) return null;
  const now = requireNow(nowInput);
  const deadline = nextTimeControlDueAt(value);
  if (deadline === null || now < deadline) return clone(value);
  return consumeActiveTime(value, deadline);
}

export function startTimeControl(value, color, nowInput) {
  if (!value) return null;
  const clock = restoreTimeControl(value);
  if (clock.outcome) return clock;
  const now = requireNow(nowInput);
  const nextColor = requireColor(color);
  if (clock.activeColor !== null) {
    if (clock.activeColor === nextColor) return clock;
    throw new RangeError("a different player's clock is already running");
  }
  clock.activeColor = nextColor;
  clock.activeSince = now;
  return clock;
}

export function pauseTimeControl(value, nowInput) {
  if (!value) return null;
  const clock = consumeActiveTime(restoreTimeControl(value), nowInput);
  if (!clock.outcome) {
    clock.activeColor = null;
    clock.activeSince = null;
  }
  return clock;
}

/** Deduct the mover's elapsed time, reset a surviving Japanese period, then switch. */
export function completeTimeControlTurn(value, nowInput, nextColor = null) {
  if (!value) return null;
  const clock = consumeActiveTime(restoreTimeControl(value), nowInput);
  if (clock.outcome) return clock;
  const previousColor = clock.activeColor;
  if (previousColor !== null) {
    const player = clock.players[previousColor];
    if (player.mainTimeRemainingMs === 0 && player.byoYomiPeriodsRemaining > 0) {
      player.byoYomiTimeRemainingMs = clock.byoYomiSeconds * 1_000;
    }
  }
  clock.activeColor = null;
  clock.activeSince = null;
  return nextColor === null
    ? clock
    : startTimeControl(clock, requireColor(nextColor, "nextColor"), nowInput);
}

/**
 * Public projection anchored at serverNow. Clients can subtract their locally
 * estimated elapsed time from the active player's projected values without a
 * server message on every animation frame.
 */
export function snapshotTimeControl(value, nowInput) {
  if (!value) return null;
  const serverNow = requireNow(nowInput);
  const projected = consumeActiveTime(restoreTimeControl(value), serverNow);
  return {
    enabled: true,
    version: TIME_CONTROL_VERSION,
    ...timeControlConfig(projected),
    players: clone(projected.players),
    activeColor: projected.activeColor,
    activeSince: projected.activeColor === null ? null : serverNow,
    running: projected.activeColor !== null && projected.outcome === null,
    serverNow,
    turnDeadlineAt: nextTimeControlDueAt(projected),
    outcome: clone(projected.outcome),
  };
}

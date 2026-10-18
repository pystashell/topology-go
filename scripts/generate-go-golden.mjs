#!/usr/bin/env node
/**
 * Generate the Go golden-master fixture (test/fixtures/go-golden-v1.json).
 *
 * The fixture freezes observable Go behaviour that depends on neighbour order
 * (capture order, DFS group order, territory regions, superko history) so a
 * refactor of adjacency or replay code can be proven byte-for-byte neutral.
 * It was generated from the engine BEFORE the topology module existed; do not
 * regenerate it to make a failing golden test pass. Regenerate only when a
 * deliberate, reviewed Go behaviour change requires a new fixture version.
 *
 * Usage:
 *   node scripts/generate-go-golden.mjs           # write the fixture
 *   node scripts/generate-go-golden.mjs --check   # compare without writing
 *
 * Every board (an array of rows of null/"black"/"white") is stored as an
 * array of strings using "." / "B" / "W" to keep the fixture small. The
 * golden test decodes boards before comparing, so comparisons stay exact.
 * Replay frames are stored as their steps, final frame and a SHA-256 of the
 * exact JSON of every frame (byte-identical check without ~30 KB per game).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BLACK,
  GoEngine,
  PHASE_PLAY,
  PHASE_SCORING,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../src/game/goEngine.js";
import { buildReplayFrames } from "../src/game/replay.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";

export const GOLDEN_FIXTURE_URL = new URL(
  "../test/fixtures/go-golden-v1.json",
  import.meta.url,
);

const TOPOLOGIES = [TOPOLOGY_CYLINDER, TOPOLOGY_TORUS, TOPOLOGY_MOBIUS];
// Two squares and one rectangle with width > height. Every game ends in a
// different way so scoring, resumption, resignation and undo are all covered.
const SIZES = [
  { width: 5, height: 5, moves: 40, variant: "scored" },
  { width: 9, height: 9, moves: 64, variant: "resumed_then_resigned" },
  { width: 8, height: 5, moves: 48, variant: "in_play_with_undo" },
];
const BASE_SEED = 20261018;
const MAX_SEED_ATTEMPTS = 200;

/** Small deterministic PRNG (mulberry32). */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function isSeamPoint(game, { row, col }) {
  if (col === 0 || col === game.width - 1) return true;
  return (
    game.topology === TOPOLOGY_TORUS &&
    (row === 0 || row === game.height - 1)
  );
}

function legalPoints(game) {
  const points = [];
  for (let row = 0; row < game.height; row += 1) {
    for (let col = 0; col < game.width; col += 1) {
      if (game.checkPlay(row, col).ok) points.push({ row, col });
    }
  }
  return points;
}

/** True when a capture used at least one edge that wraps across a seam. */
function capturedAcrossSeam(game, move) {
  if (move.captured.length === 0) return false;
  const involved = new Set([
    `${move.row},${move.col}`,
    ...move.captured.map(({ row, col }) => `${row},${col}`),
  ]);
  return move.captured.some((stone) =>
    game.neighbors(stone.row, stone.col).some(
      (neighbour) =>
        involved.has(`${neighbour.row},${neighbour.col}`) &&
        (Math.abs(neighbour.col - stone.col) > 1 ||
          Math.abs(neighbour.row - stone.row) > 1),
    ),
  );
}

function playRandomMoves(game, random, count, stats) {
  for (let index = 0; index < count && game.phase === PHASE_PLAY; index += 1) {
    const legal = legalPoints(game);
    const previousWasPass = game.lastMove?.type === "pass";
    if (legal.length === 0) {
      if (previousWasPass) return;
      game.pass();
      continue;
    }
    if (!previousWasPass && random() < 0.03) {
      game.pass();
      continue;
    }
    const seam = legal.filter((point) => isSeamPoint(game, point));
    const point = seam.length > 0 && random() < 0.6
      ? pick(random, seam)
      : pick(random, legal);
    const result = game.play(point.row, point.col);
    if (!result.ok) throw new Error(`generator chose an illegal move: ${result.reason}`);
    stats.captures += result.captured.length > 0 ? 1 : 0;
    if (capturedAcrossSeam(game, result)) stats.seamCaptures += 1;
  }
}

function passTwice(game) {
  if (game.lastMove?.type === "pass") {
    // A pass immediately followed by a pass from the other colour.
    game.pass();
    if (game.phase !== PHASE_SCORING) game.pass();
  } else {
    game.pass();
    game.pass();
  }
  if (game.phase !== PHASE_SCORING) throw new Error("expected the scoring phase");
}

function toggleRandomGroup(game, random) {
  const stones = [];
  for (let row = 0; row < game.height; row += 1) {
    for (let col = 0; col < game.width; col += 1) {
      if (game.board[row][col] !== null) stones.push({ row, col });
    }
  }
  if (stones.length === 0) return;
  const stone = pick(random, stones);
  const result = game.toggleDead(stone.row, stone.col);
  if (!result.ok) throw new Error(`toggleDead failed: ${result.reason}`);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Keep replay steps (which carry the order-sensitive captured lists) and the
 * final frame verbatim; every frame is covered by a digest of its exact JSON.
 */
function summarizeFrames({ frames, steps, complete }) {
  return {
    complete,
    steps,
    frameCount: frames.length,
    framesSha256: sha256(JSON.stringify(frames)),
    finalFrame: frames.at(-1),
  };
}

function playGame({ topology, width, height, moves, variant, seed, index }) {
  const random = createRandom(seed);
  const settings = {
    width,
    height,
    topology,
    komi: [6.5, 0.5, 7][index % 3],
    scoringRule: index % 2 === 0 ? "japanese" : "chinese",
  };
  const game = new GoEngine(settings);
  const stats = { captures: 0, seamCaptures: 0 };

  if (variant === "scored") {
    playRandomMoves(game, random, moves, stats);
    if (game.phase === PHASE_PLAY) passTwice(game);
    toggleRandomGroup(game, random);
    toggleRandomGroup(game, random);
    const finished = game.finishScoring(
      index % 2 === 0 ? "chinese" : "japanese",
    );
    if (!finished.ok) throw new Error(`finishScoring failed: ${finished.reason}`);
  } else if (variant === "resumed_then_resigned") {
    playRandomMoves(game, random, Math.floor(moves / 2), stats);
    if (game.phase === PHASE_PLAY) passTwice(game);
    toggleRandomGroup(game, random);
    const resumed = game.resumePlay(random() < 0.5 ? BLACK : WHITE);
    if (!resumed.ok) throw new Error(`resumePlay failed: ${resumed.reason}`);
    playRandomMoves(game, random, moves - Math.floor(moves / 2), stats);
    if (game.phase !== PHASE_PLAY) game.resumePlay(game.currentPlayer);
    game.resign(game.currentPlayer);
  } else {
    playRandomMoves(game, random, moves, stats);
    if (game.phase !== PHASE_PLAY) game.resumePlay(game.currentPlayer);
  }

  const exportState = game.exportState();
  const replay = game.getReplayState();
  const record = {
    id: `${topology}-${width}x${height}-${variant}`,
    seed,
    settings,
    variant,
    stats,
    exportState,
    frames: summarizeFrames(buildReplayFrames(replay)),
    score: game.score(),
    suggestedDeadStones: game.suggestDeadStones(),
  };
  if (variant === "in_play_with_undo") {
    for (let count = 0; count < 3 && game.canUndo(); count += 1) game.undo();
    const afterUndo = game.exportState();
    record.afterUndo = {
      sha256: sha256(JSON.stringify(afterUndo)),
      lastMove: afterUndo.lastMove,
      eventCount: afterUndo.replay.events.length,
      undoDepth: afterUndo.undoHistory.length,
    };
  }
  return record;
}

function generateGames() {
  const games = [];
  TOPOLOGIES.forEach((topology, topologyIndex) => {
    SIZES.forEach((size, sizeIndex) => {
      const index = topologyIndex * SIZES.length + sizeIndex;
      // Search deterministic seeds until the game captures across a seam, so
      // the fixture is guaranteed to exercise wrapped adjacency.
      for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt += 1) {
        const seed = BASE_SEED + index * 1000 + attempt;
        const record = playGame({ topology, ...size, seed, index });
        if (record.stats.seamCaptures > 0) {
          games.push(record);
          return;
        }
      }
      throw new Error(`no seed produced a seam capture for ${topology} ${size.width}x${size.height}`);
    });
  });
  return games;
}

/**
 * Drive one online room through the public action API with fixed clocks and a
 * fixed incarnation id so RoomEngine.serialize() and positionToken are
 * reproducible. The recorded actions are replayed verbatim by the test.
 */
function runGoldenRoom({ settings, incarnationId, actions }) {
  const room = RoomEngine.create(settings);
  room.state.incarnationId = incarnationId;
  room.join({
    name: "White",
    role: "player",
    playerId: "white-player",
    tokenHash: "b".repeat(64),
    now: settings.now + 1,
  });
  const positionTokens = [room.snapshot(settings.now + 2).positionToken];
  for (const action of actions) {
    room.applyAction(structuredClone(action));
    positionTokens.push(room.snapshot(action.now).positionToken);
  }
  return {
    serialized: room.serialize(),
    positionTokens,
  };
}

function generateRoom() {
  const settings = {
    code: "GLD234",
    name: "Black",
    width: 7,
    height: 5,
    topology: TOPOLOGY_MOBIUS,
    komi: 6.5,
    scoringRule: "japanese",
    playerId: "black-player",
    tokenHash: "a".repeat(64),
    now: 1_000,
  };
  const random = createRandom(BASE_SEED);
  const shadow = new GoEngine({
    width: settings.width,
    height: settings.height,
    topology: settings.topology,
  });
  const stats = { captures: 0, seamCaptures: 0 };
  const actions = [];
  let now = 10_000;
  for (let index = 0; index < 36; index += 1) {
    const legal = legalPoints(shadow);
    if (legal.length === 0) break;
    const seam = legal.filter((point) => isSeamPoint(shadow, point));
    const point = seam.length > 0 && random() < 0.6
      ? pick(random, seam)
      : pick(random, legal);
    const playerId = shadow.currentPlayer === BLACK ? "black-player" : "white-player";
    const result = shadow.play(point.row, point.col);
    if (result.captured.length > 0) stats.captures += 1;
    if (capturedAcrossSeam(shadow, result)) stats.seamCaptures += 1;
    now += 1_000;
    actions.push({ playerId, action: "play", payload: point, now });
  }
  now += 1_000;
  actions.push({
    playerId: shadow.currentPlayer === BLACK ? "black-player" : "white-player",
    action: "pass",
    payload: {},
    now,
  });
  const input = { settings, incarnationId: "golden-incarnation", actions };
  return { ...input, stats, ...runGoldenRoom(input) };
}

function isBoardMatrix(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.every((cell) => cell === null || cell === BLACK || cell === WHITE),
    )
  );
}

function encodeBoards(key, value) {
  if (key === "board" && isBoardMatrix(value)) {
    return value.map((row) =>
      row.map((cell) => (cell === BLACK ? "B" : cell === WHITE ? "W" : ".")).join(""),
    );
  }
  return value;
}

export function buildGoldenFixture() {
  const games = generateGames();
  const room = generateRoom();
  return {
    version: 1,
    description:
      "Go golden master generated before the topology refactor; boards are encoded as rows of '.', 'B', 'W'.",
    boardEncoding: "rows",
    games,
    room,
  };
}

/** Stable, line-per-record JSON so diffs point at the game that changed. */
export function formatGoldenFixture(fixture) {
  const line = (value) => JSON.stringify(value, encodeBoards);
  const { games, room, ...header } = fixture;
  const headerLines = Object.entries(header).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${line(value)},`,
  );
  return [
    "{",
    ...headerLines,
    '  "games": [',
    games.map((game) => `    ${line(game)}`).join(",\n"),
    "  ],",
    `  "room": ${line(room)}`,
    "}",
    "",
  ].join("\n");
}

function main() {
  const text = formatGoldenFixture(buildGoldenFixture());
  const path = fileURLToPath(GOLDEN_FIXTURE_URL);
  if (process.argv.includes("--check")) {
    const existing = readFileSync(path, "utf8");
    if (existing !== text) {
      console.error(`${path} differs from freshly generated output`);
      process.exitCode = 1;
      return;
    }
    console.log(`${path} matches (${text.length} bytes)`);
    return;
  }
  writeFileSync(path, text);
  console.log(`wrote ${path} (${text.length} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

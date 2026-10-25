import assert from "node:assert/strict";

import { GoEngine, UNDO_HISTORY_LIMIT } from "../../src/game/goEngine.js";
import { buildReplayStateAtStep } from "../../src/game/replay.js";
import { seededRandom, shuffled } from "./coverGeometry.js";
import { ENGINE_COLOR, GoReference } from "./goReference.js";

/**
 * Random full Go games checked move by move against GoReference: the board,
 * captures, turn and phase after every play, pass and undo; the legality
 * (and reason) of probed points; the dead stones suggested at two passes and
 * both scores; the finished result, persistence and replay. Moves are random
 * legal points that do not fill the mover's own single-point eye, so games
 * end in two passes; some games stop early with two passes (groups in atari
 * then test the dead-stone suggestion) and some use an integer komi (so a
 * count can be a draw).
 */

export function newGoStats() {
  return {
    games: 0, plies: 0, passes: 0, undos: 0, captures: 0, scored: 0,
    probes: 0, occupied: 0, suicide: 0, simpleKo: 0, longCycleSuperko: 0,
    deadGroups: 0, draws: 0, seamCaptures: 0,
  };
}

function engineCells(engine) {
  let text = "";
  for (const row of engine.board) for (const value of row) text += value === null ? "." : value === "black" ? "B" : "W";
  return text;
}

function compare(engine, ref, label) {
  assert.equal(engineCells(engine), ref.cells.join(""), `${label}: board`);
  assert.equal(engine.currentPlayer, ENGINE_COLOR[ref.toMove], `${label}: turn`);
  assert.equal(engine.captures.black, ref.captures.B, `${label}: black captures`);
  assert.equal(engine.captures.white, ref.captures.W, `${label}: white captures`);
}

function sample(values, count, random) {
  if (values.length <= count) return values;
  const picked = new Set();
  while (picked.size < count) picked.add(values[Math.floor(random() * values.length)]);
  return [...picked];
}

/**
 * @param {{topology: string, width: number, height: number, seed: number,
 *   fullProbe?: boolean, probes?: number, undoRate?: number, stats: object,
 *   deep?: boolean}} options
 */
export function playRandomGoGame({
  topology, width, height, seed, fullProbe = false, probes = 4, undoRate = 0.03, stats, deep = false,
  earlyStopRate = 0.3,
}) {
  const label = `${topology} ${width}x${height} seed ${seed}`;
  const random = seededRandom(seed);
  const komi = [7.5, 6.5, 0, 6, 1][Math.floor(random() * 5)];
  const engine = new GoEngine({ width, height, topology, komi });
  const ref = new GoReference({ width, height, topology, komi });
  const limit = width * height * 4;
  // Some games end early: both sides pass from this ply on.
  const stopAt = random() < earlyStopRate
    ? Math.floor(width * height * (0.2 + random()))
    : Infinity;
  let plies = 0;
  // Undos the engine can still take back (its window is UNDO_HISTORY_LIMIT).
  let undoWindow = 0;
  while (engine.phase === "play" && plies < limit) {
    const empties = [];
    for (let index = 0; index < ref.cells.length; index += 1) if (ref.cells[index] === ".") empties.push(index);
    for (const index of fullProbe ? empties : sample(empties, probes, random)) {
      const expected = ref.attempt(index);
      const actual = engine.checkPlay(Math.floor(index / width), index % width);
      assert.equal(actual.ok, expected.ok, `${label} ply ${plies}: legality at ${index}`);
      if (!expected.ok) assert.equal(actual.reason, expected.reason, `${label} ply ${plies}: reason at ${index}`);
      stats.probes += 1;
    }

    if (undoWindow > 0 && random() < undoRate) {
      const count = Math.min(undoWindow, 1 + Math.floor(random() * 3));
      for (let step = 0; step < count; step += 1) {
        assert.equal(engine.undo().ok, true, `${label}: undo`);
        assert.equal(ref.undo(), true);
        undoWindow -= 1;
        stats.undos += 1;
        compare(engine, ref, `${label} after undo`);
      }
      continue;
    }

    let chosen = null;
    for (const index of plies >= stopAt ? [] : shuffled(empties, random)) {
      if (ref.isOwnEye(index)) continue;
      const attempt = ref.attempt(index);
      if (attempt.ok) {
        chosen = index;
        break;
      }
      stats[attempt.reason] = (stats[attempt.reason] ?? 0) + 1;
      if (attempt.reason === "superko") {
        // A simple ko recreates the position before the opponent's last move.
        const previous = ref.line.at(-1);
        if (previous && ref.key(previous.cells) === attempt.key) stats.simpleKo += 1;
        else stats.longCycleSuperko += 1;
        // The engine refuses it too, with the same reason.
        const refused = engine.play(Math.floor(index / width), index % width);
        assert.deepEqual(refused, { ok: false, reason: "superko" }, `${label}: superko refused`);
      }
    }
    if (chosen === null) {
      assert.equal(engine.pass().ok, true);
      ref.pass();
      stats.passes += 1;
    } else {
      const row = Math.floor(chosen / width);
      const col = chosen % width;
      const result = engine.play(row, col);
      assert.equal(result.ok, true, `${label}: play ${row},${col}`);
      const expected = ref.play(chosen);
      assert.deepEqual(
        result.captured.map((stone) => stone.row * width + stone.col).sort((a, b) => a - b),
        expected.captured.slice().sort((a, b) => a - b),
        `${label}: captured stones`,
      );
      stats.captures += result.captured.length;
      if (result.captured.some((stone) => Math.abs(stone.col - col) > 1 || Math.abs(stone.row - row) > 1)) {
        stats.seamCaptures += 1;
      }
    }
    undoWindow = Math.min(UNDO_HISTORY_LIMIT, undoWindow + 1);
    plies += 1;
    stats.plies += 1;
    compare(engine, ref, `${label} ply ${plies}`);
    if (engine.phase === "play") assert.equal(engine.consecutivePasses, ref.passes, `${label}: passes`);
  }
  stats.games += 1;
  if (engine.phase !== "scoring") return { engine, ref };

  // Two passes: the suggested dead stones and both scores.
  stats.scored += 1;
  const dead = ref.suggestedDead();
  const engineDead = new Set([...engine.deadStones].map((key) => {
    const [row, col] = key.split(",").map(Number);
    return row * width + col;
  }));
  assert.deepEqual([...engineDead].sort((a, b) => a - b), [...dead].sort((a, b) => a - b), `${label}: dead stones`);
  if (dead.size > 0) stats.deadGroups += 1;
  for (const rule of ["japanese", "chinese"]) {
    const actual = engine.score(rule);
    const expected = ref.score(dead, rule);
    for (const field of ["black", "white", "winner", "margin", "neutral"]) {
      assert.equal(actual[field], expected[field], `${label}: ${rule} ${field}`);
    }
  }
  // Toggle one more group dead (or alive) and score again.
  const stones = [];
  for (let index = 0; index < ref.cells.length; index += 1) if (ref.cells[index] !== ".") stones.push(index);
  if (stones.length > 0) {
    const pick = stones[Math.floor(random() * stones.length)];
    assert.equal(engine.toggleDead(Math.floor(pick / width), pick % width).ok, true);
    const group = ref.group(ref.cells, pick).stones;
    const marked = dead.has(pick);
    for (const stone of group) {
      if (marked) dead.delete(stone);
      else dead.add(stone);
    }
    const actual = engine.score("chinese");
    const expected = ref.score(dead, "chinese");
    assert.equal(actual.black, expected.black, `${label}: rescored black`);
    assert.equal(actual.white, expected.white, `${label}: rescored white`);
  }
  const finished = engine.finishScoring("chinese");
  assert.equal(finished.ok, true);
  assert.equal(engine.phase, "finished");
  if (engine.result.winner === "draw") stats.draws += 1;
  if (deep) {
    // Persistence and replay rebuild the same finished game.
    const restored = GoEngine.fromState(engine.serialize());
    assert.deepEqual(restored.getState(), engine.getState(), `${label}: restore`);
    const replay = engine.getReplayState();
    const moves = replay.events.filter((event) => event.type === "play" || event.type === "pass").length;
    const rebuilt = buildReplayStateAtStep(replay, moves);
    assert.deepEqual(rebuilt.board, engine.board, `${label}: replay board`);
  }
  return { engine, ref };
}

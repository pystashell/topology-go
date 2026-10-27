import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_LIMITS, GAME_GO, GAME_GOMOKU, GAME_OTHELLO } from "../src/game/gameTypes.js";
import { GAME_SIZE_SHORTCUTS, defaultBoardSide } from "../src/ui/gameUi.js";
import { appSource } from "./helpers/appSource.js";

/*
 * New players start on the smallest quick board of each game (owner's
 * decision, 2026-10-26): the joined edges show most on small boards.
 */

test("the default board is the smallest quick size of each game", () => {
  assert.equal(defaultBoardSide(GAME_GO), 9);
  assert.equal(defaultBoardSide(GAME_GOMOKU), 7);
  assert.equal(defaultBoardSide(GAME_OTHELLO), 6);
  for (const [gameType, sizes] of Object.entries(GAME_SIZE_SHORTCUTS)) {
    assert.equal(defaultBoardSide(gameType), Math.min(...sizes), gameType);
    assert.ok(defaultBoardSide(gameType) >= BOARD_LIMITS[gameType].publicMin, gameType);
  }
  // Engines and rooms keep their defaults for requests without a size.
  assert.equal(BOARD_LIMITS[GAME_GO].defaultWidth, 19);
});

test("the page starts on the default board, never a hard-coded size (regression)", () => {
  // rc.10 shipped 19 x 19 Go anyway: startup called setPendingDimensions(19, 19).
  const source = appSource();
  assert.doesNotMatch(source, /setPendingDimensions\(\s*\d+\s*,\s*\d+\s*\)/u,
    "a literal size at startup overrides the default");
  assert.match(source, /let pendingWidth = defaultBoardSide\(GAME_GO\);/u);
  assert.match(source, /setPendingDimensions\(defaultBoardSide\(GAME_GO\), defaultBoardSide\(GAME_GO\)\);/u);
});

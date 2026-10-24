import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replace(/\r\n/gu, "\n");

function functionSource(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(mainSource);
  assert.ok(match, `expected ${name} to be defined`);
  const remainder = mainSource.slice(match.index + match[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
  return mainSource.slice(match.index, next ? match.index + match[0].length + next.index : undefined);
}

test("board sizes per game are saved in localStorage with the chosen game", () => {
  const remember = functionSource("rememberGameTypeChoice");
  assert.match(remember, /window\.localStorage\.setItem\(/u);
  assert.match(remember, /sizesByGame: Object\.fromEntries\(pendingDimensionsByGame\)/u);
  assert.match(functionSource("savedGameTypeChoice"), /sizesByGame: parsed\?\.sizesByGame/u);
  const restore = functionSource("restoreSizesByGame");
  assert.match(restore, /clampBoardDimension\(savedGame, size\?\.width\)/u);
  assert.match(restore, /availableGameType\(savedGame\) !== savedGame/u);
});

test("every size the player picks is remembered, and startup reopens it", () => {
  const buttons = mainSource.slice(mainSource.indexOf("const size = Number(button.dataset.boardSize);"));
  assert.match(buttons.slice(0, 300),/setPendingDimensions\(size, size\);\s*rememberGameTypeChoice\(\);/u);
  for (const name of ["commitPendingDimensionInputs", "scheduleLobbyDimensionPreview"]) {
    assert.match(functionSource(name), /setPendingDimensions\([\s\S]*?\);[\s\S]*rememberGameTypeChoice\(\);/u, name);
  }
  const startup = mainSource.slice(mainSource.indexOf("const savedGameChoice = savedGameTypeChoice();"));
  assert.match(
    startup.slice(0, 700),
    /restoreSizesByGame\(savedGameChoice\.sizesByGame\);[\s\S]*pendingDimensionsByGame\.get\(pendingGameType\)/u,
  );
});

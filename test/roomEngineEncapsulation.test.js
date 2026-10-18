import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The room engine drives every game through the rules registry and the
// engine protocol. Go engine internals may only be read inside the named
// Go-only helpers, which run solely for Go rounds.

const SOURCE = readFileSync(
  new URL("../src/multiplayer/roomEngine.js", import.meta.url),
  "utf8",
);

const GO_ONLY_FUNCTIONS = [
  "goPositionToken",
  "goScoringToken",
  "goDeadStoneTogglesThisScoring",
  "recordGoResignation",
];

const GO_INTERNALS =
  /\b(?:this\.)?game\.(?:undoHistory|positionHistory|deadStones|captures|replay)\b/gu;

/** [start, end) of a function or method body found by its declaration. */
function functionRange(name) {
  const declaration = new RegExp(
    `(?:^|\\n)[ \\t]*(?:function[ \\t]+)?${name}[ \\t]*\\([^)]*\\)[ \\t]*\\{`,
    "u",
  ).exec(SOURCE);
  assert.ok(declaration, `${name} must be declared in roomEngine.js`);
  const open = declaration.index + declaration[0].length - 1;
  let depth = 0;
  for (let index = open; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === "{") depth += 1;
    if (SOURCE[index] === "}" && (depth -= 1) === 0) {
      return [declaration.index, index + 1];
    }
  }
  assert.fail(`${name} has no closing brace`);
}

function lineOf(index) {
  return SOURCE.slice(0, index).split("\n").length;
}

test("Go engine internals are only read inside the Go-only room helpers", () => {
  const ranges = GO_ONLY_FUNCTIONS.map(functionRange);
  const outside = [...SOURCE.matchAll(GO_INTERNALS)]
    .filter((match) => !ranges.some(([start, end]) => match.index >= start && match.index < end))
    .map((match) => `line ${lineOf(match.index)}: ${match[0]}`);
  assert.deepEqual(outside, []);
  // The helpers really are the ones reading those internals.
  const inside = new Set([...SOURCE.matchAll(GO_INTERNALS)].map((match) => match[0]));
  assert.deepEqual(
    [...inside].sort(),
    ["game.captures", "game.deadStones", "game.positionHistory", "game.replay"],
  );
});

test("rooms build and restore every game through the rules registry", () => {
  assert.doesNotMatch(SOURCE, /\bGoEngine\b/u, "no direct GoEngine construction or restore");
  assert.match(SOURCE, /rulesFor\(gameType\)\.fromState\(snapshot\)/u);
  assert.match(SOURCE, /rulesFor\(GAME_GO\)\.create\(settings\)/u);
  // The Go adapter's restore validates the whole replay; the hand-built
  // fallback that wrote engine fields directly is gone.
  assert.doesNotMatch(SOURCE, /\bgame\.\w+\s*=\s*(?:clone\()?snapshot\./u);
  assert.doesNotMatch(SOURCE, /this\.game\.\w+\s*=[^=]/u, "rooms never write engine fields");
  assert.match(SOURCE, /this\.game\.undoMoveColors\(\)/u);
});

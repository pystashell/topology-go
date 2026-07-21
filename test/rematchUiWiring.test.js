import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("same-room rematch keeps one settings surface and restores live view controls", () => {
  assert.match(mainSource, /function enterOnlineRematchSetup\(\)/);
  assert.match(
    mainSource,
    /if \(rematchStarted \|\| nextRoundStarted\) setViewMode\(activeViewMode\)/,
  );
  assert.match(mainSource, /elements\.startRoomRematch\?\.addEventListener/);
  assert.match(htmlSource, /id="room-rematch-setup"/);
  assert.match(htmlSource, /id="start-room-rematch"/);
  assert.doesNotMatch(htmlSource, /id="lobby-overlay"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, main, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("online white seat exposes claim and release controls without duplicating the room UI", () => {
  assert.match(html, /id="opponent-seat-action"/);
  assert.match(main, /identity\.role === "spectator" && onlineWhiteSeatIsOpen\(\)/);
  assert.match(main, /sendOnlineCommand\("claim_seat"\)/);
  assert.match(main, /sendOnlineCommand\("release_seat"\)/);
  assert.match(styles, /\.room-seat-action\s*\{/);
});

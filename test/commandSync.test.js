import test from "node:test";
import assert from "node:assert/strict";

import { roomRevisionHasCaughtUp } from "../src/multiplayer/commandSync.js";

test("a command stays pending until the matching room revision arrives", () => {
  assert.equal(roomRevisionHasCaughtUp(undefined, 12), false);
  assert.equal(roomRevisionHasCaughtUp(11, 12), false);
  assert.equal(roomRevisionHasCaughtUp(12, 12), true);
  assert.equal(roomRevisionHasCaughtUp(13, 12), true);
});

test("an acknowledgement without a revision does not wait forever", () => {
  assert.equal(roomRevisionHasCaughtUp(4, undefined), true);
  assert.equal(roomRevisionHasCaughtUp(4, Number.NaN), true);
});

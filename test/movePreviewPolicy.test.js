import test from "node:test";
import assert from "node:assert/strict";

import { shouldEnableMovePreview } from "../src/ui/movePreviewPolicy.js";

const base = Object.freeze({
  phase: "play",
  currentPlayer: "black",
});
test("local alternating play previews whichever color is next", () => {
  assert.equal(
    shouldEnableMovePreview({ ...base, mode: "local" }),
    true,
  );
  assert.equal(
    shouldEnableMovePreview({
      ...base,
      mode: "local",
      currentPlayer: "white",
    }),
    true,
  );
  assert.equal(
    shouldEnableMovePreview({ ...base, mode: "local", phase: "scoring" }),
    false,
  );
});

test("AI play previews only the human turn", () => {
  assert.equal(
    shouldEnableMovePreview({ ...base, mode: "ai", localColor: "black" }),
    true,
  );
  assert.equal(
    shouldEnableMovePreview({ ...base, mode: "ai", localColor: "white" }),
    false,
  );
  assert.equal(
    shouldEnableMovePreview({
      ...base,
      mode: "ai",
      localColor: "black",
      aiThinking: true,
    }),
    false,
  );
});

test("online play requires the connected current seat and a ready room", () => {
  const online = {
    ...base,
    mode: "online",
    localColor: "black",
    connected: true,
    roomReady: true,
    bothPlayers: true,
  };
  assert.equal(shouldEnableMovePreview(online), true);

  for (const blocked of [
    { localColor: "white" },
    { localColor: null },
    { connected: false },
    { roomReady: false },
    { bothPlayers: false },
    { onlineBusy: true },
    { commandPending: true },
  ]) {
    assert.equal(
      shouldEnableMovePreview({ ...online, ...blocked }),
      false,
      `blocked online state: ${JSON.stringify(blocked)}`,
    );
  }
});

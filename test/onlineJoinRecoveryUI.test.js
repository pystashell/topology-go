import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const renderSource = main.slice(
  main.indexOf("function renderStoredIdentityPanels()"),
  main.indexOf("function savedPlayerName()"),
);
const joinSource = main.slice(
  main.indexOf("async function joinOnlineRoom("),
  main.indexOf("function resumeStoredOnlineRoom()"),
);

function select() {
  return {
    value: "",
    options: [],
    replaceChildren(...options) {
      this.options = options;
      this.value = options[0]?.value ?? "";
    },
  };
}

function joinHarness({ prior = [], fail }) {
  const pending = [...prior];
  const elements = {
    roomCodeInput: { value: "AB23CD", focus() {} },
    playerName: { focus() {} },
    onlineRoomCodeField: { hidden: false },
    storedSessionSelect: select(),
    pendingJoinSelect: select(),
    storedSessionPanel: { hidden: true },
    pendingJoinPanel: { hidden: true },
  };
  let errorMessage = "";
  const roomClient = {
    listStoredSessions: () => [],
    listPendingJoins: (code) => code === "AB23CD" ? [...pending] : [],
    async joinRoom() { await fail({ pending, elements }); },
  };
  const noop = () => {};
  const context = {
    AbortController, onlineBusy: false, onlineEntryController: null,
    BLACK: "black", WHITE: "white", elements, roomClient,
    document: { createElement: () => ({ value: "", textContent: "" }) },
    sanitizeRoomCode: (value) => String(value).toUpperCase().replace(/[^A-HJ-NP-Z2-9]/gu, "").slice(0, 6),
    normalizedPlayerName: () => "Alice",
    rememberOfflineGame: noop, cancelAIThinking: noop,
    cancelReplayAIReview: noop, rememberPlayerName: noop,
    restoreOfflineGame: noop, updateUI: noop, maybeStartAITurn: noop,
    setOnlineBusy: noop,
    showOnlineError: (message = "") => { errorMessage = message; },
  };
  const join = vm.runInNewContext(`${renderSource}\n${joinSource}\njoinOnlineRoom`, context);
  return { join, elements, get errorMessage() { return errorMessage; } };
}

test("a failed first join immediately shows the saved recovery identity for its submitted room", async () => {
  const harness = joinHarness({
    async fail({ pending, elements }) {
      pending.push({ playerId: "new-join", name: "Alice", role: "player" });
      elements.roomCodeInput.value = "EF34GH";
      throw new Error("连接中断");
    },
  });
  await harness.join();
  assert.equal(harness.elements.roomCodeInput.value, "AB23CD");
  assert.equal(harness.elements.pendingJoinPanel.hidden, false);
  assert.equal(harness.elements.pendingJoinSelect.options[0].value, "new-join");
  assert.match(harness.errorMessage, /已保留本次加入凭据/u);
});

test("an old pending join is not described as the failed attempt's identity", async () => {
  const harness = joinHarness({
    prior: [{ playerId: "old-join", name: "Earlier", role: "spectator" }],
    async fail() { throw new Error("无法保存加入凭据"); },
  });
  await harness.join();
  assert.equal(harness.elements.pendingJoinPanel.hidden, false);
  assert.equal(harness.elements.pendingJoinSelect.options[0].value, "old-join");
  assert.doesNotMatch(harness.errorMessage, /已保留本次加入凭据/u);
});

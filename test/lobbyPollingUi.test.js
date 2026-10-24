import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { translateText } from "../src/i18n.js";
import { appSource } from "./helpers/appSource.js";

const main = appSource();
const constant = (name) => {
  const match = new RegExp(`const ${name} = ([\\d_]+);`, "u").exec(main);
  assert.ok(match, `expected ${name}`);
  return match[0];
};
const source = [
  constant("LOBBY_POLL_INTERVAL_MS"),
  constant("LOBBY_RATE_LIMIT_BACKOFF_MS"),
  main.slice(main.indexOf("function lobbyCountText("), main.indexOf("function loadLobbyOnce()")),
  "({ refreshLobby, resumeLobbyPolling, cancelLobbyRequest, syncLobbyStatus })",
].join("\n");

function harness({ rooms = [], fetchImpl } = {}) {
  const timers = [];
  let now = 1_000_000;
  const status = {
    textContent: "",
    classList: { error: false, remove() { this.error = false; }, add() { this.error = true; }, toggle(_, on) { this.error = on; } },
  };
  const context = {
    AbortController,
    Date: { now: () => now },
    Math,
    Number,
    Boolean,
    document: { visibilityState: "visible" },
    window: {
      setTimeout(callback, delay) {
        const timer = { delay, cleared: false, fired: false };
        timer.callback = () => { timer.fired = true; callback(); };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { if (timer) timer.cleared = true; },
    },
    elements: { lobbyStatus: status, lobbyRefresh: { disabled: false } },
    appRouteMode: "lobby",
    lobbyLoading: false,
    lobbyLoadError: null,
    lobbyLastRefreshAt: 0,
    lobbyPollTimer: null,
    lobbyRefreshController: null,
    lobbyRooms: [],
    shown: null,
    loadLobbyModules: async () => ({ fetchLobbyRooms: fetchImpl ?? (async () => rooms) }),
    localizedErrorMessage: (error, fallback) => error?.message || fallback,
    translateText: (text) => text,
  };
  // The real renderer filters the cards; here a fixed filter keeps one room.
  context.renderLobbyRooms = async () => {
    if (!context.lobbyLoading) api.syncLobbyStatus(context.shown ?? context.lobbyRooms.length);
  };
  const api = vm.runInNewContext(source, context);
  return {
    ...api,
    context,
    status,
    timers,
    pending: () => timers.filter((timer) => !timer.cleared && !timer.fired),
    advance(ms) { now += ms; },
  };
}

test("the lobby status counts the rooms left visible by the filters", async () => {
  const lobby = harness({ rooms: [{ code: "A" }, { code: "B" }, { code: "C" }] });
  await lobby.refreshLobby({ announce: true });
  assert.equal(lobby.status.textContent, "共 3 个公开房间");
  lobby.context.shown = 0;
  lobby.syncLobbyStatus(0);
  assert.equal(lobby.status.textContent, "显示 0 / 共 3 个公开房间");
  assert.equal(translateText(lobby.status.textContent, {}, "en"), "Showing 0 of 3 public rooms");
});

test("the lobby refreshes itself only while visible and backs off on rate limits", async () => {
  let reads = 0;
  let limited = false;
  const lobby = harness({
    fetchImpl: async () => {
      reads += 1;
      if (limited) {
        throw Object.assign(new Error("请求过于频繁，请稍后再试。"), {
          code: "RATE_LIMITED", status: 429, retryAfterSeconds: 90,
        });
      }
      return [{ code: "A" }];
    },
  });
  await lobby.refreshLobby({ announce: true });
  assert.equal(reads, 1);
  assert.equal(lobby.pending().length, 1);
  assert.equal(lobby.pending()[0].delay, 20_000);

  // A hidden tab stops polling; showing it again refreshes a stale list now.
  lobby.context.document.visibilityState = "hidden";
  lobby.resumeLobbyPolling();
  assert.equal(lobby.pending().length, 0);
  lobby.advance(25_000);
  lobby.context.document.visibilityState = "visible";
  lobby.resumeLobbyPolling();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 2);

  limited = true;
  const [next] = lobby.pending();
  next.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 3);
  assert.equal(lobby.pending().at(-1).delay, 90_000, "Retry-After stretches the next poll");
  assert.equal(lobby.status.textContent, "请求过于频繁，请稍后再试。");

  lobby.cancelLobbyRequest();
  assert.equal(lobby.pending().length, 0, "leaving the lobby stops polling");
});

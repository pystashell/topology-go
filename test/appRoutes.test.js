import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appSource } from "./helpers/appSource.js";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = appSource();

test("single and online lobby remain separate, with an explicit navigation entry", () => {
  assert.doesNotMatch(htmlSource, /id="header-lobby-link"/u);
  assert.doesNotMatch(htmlSource, /id="return-lobby"/u);
  assert.match(htmlSource, /class="brand" href="\/single"/u);
  assert.match(htmlSource, /id="lobby-screen"[^>]*\bhidden\b/u);
  assert.match(htmlSource, /id="join-invitation"[^>]*>[\s\S]*?进入在线大厅/u);
  assert.match(htmlSource, /href="\/single">返回单人模式/u);
});

test("lobby networking loads on entry and its modules stay lazy", () => {
  // The lobby screen (src/app/lobbyScreen.js) imports them on demand.
  assert.match(mainSource, /import\("\.\.\/multiplayer\/lobby\.js"\)/u);
  assert.match(mainSource, /import\("\.\.\/multiplayer\/lobbyClient\.js"\)/u);
  assert.doesNotMatch(
    mainSource,
    /^import .*from "\.\.?\/multiplayer\/lobby(?:Client)?\.js";/mu,
  );
  assert.match(
    mainSource,
    /function showAppScreen[\s\S]*?if \(lobbyVisible\) \{[\s\S]*?loadLobbyOnce\(\);[\s\S]*?return;/u,
  );
  assert.doesNotMatch(mainSource, /setInterval\(\(\) => void refreshLobby/u);
});

test("the lobby polls only while it and the tab are visible, within the read budget", () => {
  const interval = Number(/const LOBBY_POLL_INTERVAL_MS = ([\d_]+);/u.exec(mainSource)?.[1].replace(/_/gu, ""));
  assert.ok(interval >= 15_000, "polling must stay far below ~120 lobby GETs a minute");
  assert.match(
    mainSource,
    /function lobbyPollingActive\(\) \{\s*return appRouteMode === "lobby" && document\.visibilityState !== "hidden";/u,
  );
  assert.match(mainSource, /function scheduleLobbyPoll[\s\S]*?if \(!lobbyPollingActive\(\)\) return;[\s\S]*?window\.setTimeout/u);
  assert.match(mainSource, /document\.addEventListener\("visibilitychange", resumeLobbyPolling\)/u);
  assert.match(mainSource, /function cancelLobbyRequest\(\) \{\s*clearLobbyPoll\(\);/u);
  assert.match(mainSource, /error\?\.code === "RATE_LIMITED"[\s\S]*?LOBBY_RATE_LIMIT_BACKOFF_MS/u);
});

test("root, standalone, and direct-room startup have separate route branches", () => {
  assert.match(mainSource, /initialRoute\.mode === "root"[\s\S]*?replaceAppPath\("\/single"\)/u);
  assert.match(mainSource, /initialRoute\.mode === "online"[\s\S]*?roomClient\.resumeRoom/u);
  assert.match(mainSource, /initialRoute\.mode === "single"[\s\S]*?searchParams\.has\("connect"\)[\s\S]*?replaceAppPath\("\/lobby"\)/u);
});

test("lobby entry actions never detour through the standalone route", () => {
  assert.doesNotMatch(mainSource, /navigateAppPath\("\/single\?connect=(?:create|join)"\)/u);
  assert.match(mainSource, /lobbyCreateRoom[\s\S]*?showOnlineDialog\("", \{ intent: "create" \}\)/u);
  assert.match(mainSource, /lobbyJoinRoom[\s\S]*?showOnlineDialog\("", \{ intent: "join" \}\)/u);
  assert.match(mainSource, /requestedRole === "player"[\s\S]*?"player"/u);
});

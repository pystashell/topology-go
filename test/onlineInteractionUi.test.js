import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the online undo response is placed immediately below the turn card", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const turnCard = html.indexOf('<section class="turn-card"');
  const undoPanel = html.indexOf('id="undo-request-panel"');
  const message = html.indexOf('id="message"');
  const playControls = html.indexOf('id="play-controls"');

  assert.ok(turnCard >= 0);
  assert.ok(undoPanel > turnCard);
  assert.ok(message > undoPanel);
  assert.ok(playControls > undoPanel);
  assert.equal(html.match(/id="undo-request-panel"/gu)?.length, 1);
});

test("friend invitations require a human white seat in both UI and room engine", async () => {
  const [main, engine] = await Promise.all([
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("src/multiplayer/roomEngine.js", root), "utf8"),
  ]);

  assert.match(
    main,
    /selectedOnlineMode !== ONLINE_MODE_FRIEND \|\| invitedHumanWhite/u,
  );
  assert.match(main, /白方席位目前为空。请先让朋友进入房间并成为白方/u);
  assert.match(engine, /"OPPONENT_REQUIRED"/u);
});

test("lobby refresh reuses cards and lazily paints visible board previews", async () => {
  const [html, main] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/main.js", root), "utf8"),
  ]);
  const renderStart = main.indexOf("async function renderLobbyRooms()");
  const refreshStart = main.indexOf("async function refreshLobby", renderStart);
  const renderSource = main.slice(renderStart, refreshStart);

  assert.match(main, /new window\.IntersectionObserver/u);
  assert.match(main, /const lobbyRoomCards = new Map\(\)/u);
  assert.match(renderSource, /lobbyRoomCards\.get\(room\.code\)/u);
  assert.doesNotMatch(renderSource, /lobbyRoomList\.replaceChildren/u);
  assert.doesNotMatch(html, /id="lobby-room-list"[^>]+aria-live/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const slice = (from, to) => main.slice(main.indexOf(from), main.indexOf(to));
const source = [
  slice("function cancelOnlineDialog()", "function roomSeat("),
  slice("async function createOnlineRoom(", "function resumeStoredOnlineRoom()"),
  slice('elements.cancelOnline.addEventListener(', 'elements.onlineModifySettings.addEventListener('),
  "({ createOnlineRoom, joinOnlineRoom })",
].join("\n");

function harness(mode = "lobby") {
  const pending = [];
  const handlers = {};
  const history = [];
  const noop = () => {};
  const elements = {
    cancelOnline: { addEventListener: (type, callback) => { handlers[type] = callback; } },
    onlineDialog: { open: true, addEventListener: (type, callback) => { handlers[type] = callback; } },
    playerName: { value: "Alice", focus: noop },
    roomCodeInput: { value: "AB23CD", focus: noop },
  };
  const request = (options) => new Promise((resolve, reject) => pending.push({ options, resolve, reject }));
  const roomClient = {
    session: null, roomCode: "", identity: null,
    listPendingCreates: () => [{ playerId: "pending-create", roomCode: "AB23CD", name: "Alice" }],
    listPendingJoins: () => [],
    createRoom: request, joinRoom: request,
    retryPendingCreate: (_code, _playerId, options) => request(options),
    disconnect() { this.session = null; this.roomCode = ""; },
    detachRoom() { history.push("detach"); this.disconnect(); },
  };
  const context = {
    AbortController, elements, roomClient,
    onlineBusy: false, onlineEntryController: null, appRouteMode: mode,
    onlineRoom: null, onlineStateSynchronized: false,
    BLACK: "black", WHITE: "white",
    matchLifecycle: "lobby", MATCH_LIFECYCLE_LOBBY: "lobby", MATCH_LIFECYCLE_WAITING: "waiting",
    ONLINE_MATCH_SETUP: "setup", ONLINE_MATCH_INVITED: "invited", onlineMatchStatus: () => "setup",
    sanitizeRoomCode: value => value, normalizedPlayerName: () => "Alice", getNewGameOptions: () => ({}),
    rememberOfflineGame: noop, cancelAIThinking: noop, cancelReplayAIReview: noop,
    rememberPlayerName: noop, resetChatSessionState: noop, maybeStartAITurn: noop,
    renderPendingCreatePanel: noop, renderStoredIdentityPanels: noop, setSidebarTab: noop,
    updateUI: noop, setMessage: message => history.push(message),
    restoreOfflineGame: () => history.push("restore"),
    showOnlineError: (message = "") => history.push(message),
    setOnlineBusy: busy => { context.onlineBusy = busy; },
    hasOnlineSession: () => Boolean(roomClient.session && roomClient.roomCode),
    closeOnlineDialog: () => { elements.onlineDialog.open = false; },
    navigateAppPath: path => { context.appRouteMode = path.slice(1); history.push(path); },
    updateRoomUrl: code => { context.appRouteMode = "online"; history.push(`/online/${code}`); },
  };
  const api = vm.runInNewContext(source, context);
  return { context, pending, history, roomClient, elements,
    start: action => action === "create" ? api.createOnlineRoom()
      : action === "retry-create" ? api.createOnlineRoom({ pendingPlayerId: "pending-create" })
        : api.joinOnlineRoom(action),
    cancel: () => handlers.click(),
    escape: () => {
      let prevented = false;
      handlers.cancel({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
  };
}

function success(request, code = "AB23CD") {
  request.resolve({ roomCode: code, session: { playerName: "Alice", color: "black" } });
}

for (const action of ["create", "retry-create", "player", "spectator"]) {
  for (const outcome of ["success", "failure"]) {
    test(`cancelled ${action} ignores late ${outcome} while a newer operation is busy`, async () => {
      const h = harness();
      const old = h.start(action);
      assert.equal(h.context.onlineBusy, true);
      h.cancel();
      assert.equal(h.elements.onlineDialog.open, false);
      assert.equal(h.context.onlineBusy, false);
      assert.equal(h.pending[0].options.signal.aborted, true);
      h.elements.onlineDialog.open = true;
      const newer = h.start("spectator");
      const history = [...h.history];
      if (outcome === "success") success(h.pending[0]);
      else h.pending[0].reject(new Error("late failure"));
      await old;
      assert.deepEqual(h.history, history, "old completion cannot restore, navigate, or show errors");
      assert.equal(h.context.onlineBusy, true, "old finally cannot unlock a newer request");
      assert.equal(h.elements.onlineDialog.open, true);
      assert.equal(h.context.appRouteMode, "lobby");
      success(h.pending[1], "EF34GH");
      await newer;
      assert.equal(h.context.onlineBusy, false);
      assert.ok(h.history.includes("/online/EF34GH"));
    });
  }
}

test("Escape and the button both close an identity chooser and return to the lobby", () => {
  for (const action of ["cancel", "escape"]) {
    const h = harness("online");
    h[action]();
    assert.equal(h.context.appRouteMode, "lobby");
    assert.equal(h.elements.onlineDialog.open, false);
    assert.equal(h.roomClient.session, null);
    assert.deepEqual(h.history, ["/lobby"]);
  }
});

test("Escape during an entry detaches an already adopted session before returning", async () => {
  const h = harness("online");
  const request = h.start("player");
  h.roomClient.session = { playerId: "already-adopted" };
  h.roomClient.roomCode = "AB23CD";
  h.context.onlineRoom = { code: "AB23CD" };
  h.context.onlineStateSynchronized = true;
  h.escape();
  assert.equal(h.roomClient.session, null);
  assert.equal(h.context.onlineRoom, null);
  assert.equal(h.context.onlineStateSynchronized, false);
  assert.equal(h.context.appRouteMode, "lobby");
  assert.deepEqual(h.history.slice(-3), ["detach", "restore", "/lobby"]);
  success(h.pending[0]);
  await request;
  assert.equal(h.context.appRouteMode, "lobby");
});

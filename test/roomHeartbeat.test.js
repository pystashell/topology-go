import assert from "node:assert/strict";
import test from "node:test";

import { BadukRoom } from "../worker/BadukRoom.js";
import { CONNECTION_STATUS, RoomClient } from "../src/multiplayer/roomClient.js";

/*
 * Connection liveness: a page pings its room every ten seconds; a socket
 * that stays silent past the timeout, or a browser that reports going
 * offline, is replaced at once instead of waiting minutes for TCP to give
 * up. The room closes member sockets that stopped pinging, so the other
 * players see the member offline.
 */

class FakeSocket {
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  receive(data) {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify({ v: 2, ...data }) });
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 2;
  }

  finishClose(code = 1006) {
    this.readyState = 3;
    this.emit("close", { code, reason: "" });
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

async function connectedClient() {
  FakeSocket.instances = [];
  let clock = 0;
  const timers = [];
  const network = new EventTarget();
  const errors = [];
  const client = new RoomClient({
    baseUrl: "https://baduk.example/",
    storage: memoryStorage(),
    attemptStorage: memoryStorage(),
    WebSocketImpl: FakeSocket,
    snapshotTimeoutMs: 0,
    networkTarget: network,
    visibilityTarget: new EventTarget(),
    reconnect: { initialDelayMs: 100, jitter: 0, maxAttempts: 5 },
    now: () => clock,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, at: clock + delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { timer.cancelled = true; },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          roomCode: "ZX92CV",
          session: { code: "ZX92CV", token: body.token, playerId: body.playerId, playerName: body.name, role: "player", color: "white" },
          room: { code: "ZX92CV", revision: 0 },
        }),
      };
    },
  });
  client.on("error", (error) => errors.push(error.code));
  await client.joinRoom("ZX92CV", { name: "白竹" });
  FakeSocket.instances[0].open();
  /** Advance the fake clock, running due timers in order. */
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      // An overdue timer runs late, at the current time.
      clock = Math.max(clock, next.at);
      next.cancelled = true;
      next.callback();
    }
    clock = until;
  };
  /** Move the clock without running timers (a throttled tab). */
  const jump = (ms) => { clock += ms; };
  return { client, network, errors, advance, jump, socket: FakeSocket.instances[0] };
}

test("a connected page pings every ten seconds and ignores the pong", async () => {
  const { client, errors, advance, socket } = await connectedClient();
  advance(9_999);
  assert.deepEqual(socket.sent, []);
  advance(1);
  assert.deepEqual(socket.sent, ["ping"]);
  socket.receive("pong");
  advance(10_000);
  assert.deepEqual(socket.sent, ["ping", "ping"]);
  socket.receive("pong");
  assert.deepEqual(errors, [], "a pong is not an unreadable message");
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  client.destroy();
});

test("a ping left unanswered for ten seconds replaces the socket at once", async () => {
  const { client, advance, socket } = await connectedClient();
  // A ping goes out at 10 s and nothing comes back (the network died
  // without a close): at 20 s the socket is given up.
  advance(19_999);
  assert.deepEqual(socket.sent, ["ping"]);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  advance(1);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
  assert.deepEqual(socket.closed, { code: 4000, reason: "Heartbeat lost" });
  assert.equal(client.lastCloseCode, 4000);
  // The dead socket's late close event changes nothing.
  socket.finishClose(1006);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
  // The reconnect opens a fresh socket.
  advance(100);
  assert.equal(FakeSocket.instances.length, 2);
  FakeSocket.instances[1].open();
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  client.destroy();
});

test("a background tab whose timers run a minute late is not taken for dead", async () => {
  const { client, jump, advance, socket } = await connectedClient();
  for (let minute = 1; minute <= 10; minute += 1) {
    // The throttled timer fires a minute late, sends its ping...
    jump(60_000);
    advance(0);
    // ...and the pong comes straight back.
    socket.receive("pong");
  }
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  assert.equal(socket.closed, null);
  assert.equal(socket.sent.length, 10);
  client.destroy();
});

test("any message counts as alive, so a busy room never times out", async () => {
  const { client, advance, socket } = await connectedClient();
  for (let second = 0; second < 60; second += 5) {
    advance(5_000);
    socket.receive({ type: "welcome", room: { code: "ZX92CV", revision: 1 } });
  }
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  assert.equal(socket.closed, null);
  client.destroy();
});

test("the browser going offline drops the socket; coming back reconnects at once", async () => {
  const { client, network, advance, socket } = await connectedClient();
  network.dispatchEvent(new Event("offline"));
  assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
  assert.deepEqual(socket.closed, { code: 4000, reason: "Browser offline" });
  // Attempts while offline fail; the backoff keeps going.
  advance(100);
  FakeSocket.instances[1].finishClose(1006);
  assert.equal(client.connectionStatus, CONNECTION_STATUS.RECONNECTING);
  // Online again: a new socket right away, without waiting for the backoff.
  const before = FakeSocket.instances.length;
  network.dispatchEvent(new Event("online"));
  assert.equal(FakeSocket.instances.length, before + 1);
  FakeSocket.instances.at(-1).open();
  assert.equal(client.connectionStatus, CONNECTION_STATUS.CONNECTED);
  client.destroy();
});

test("leaving a room stops the heartbeat; destroy stops listening for offline", async () => {
  const { client, network, advance, socket } = await connectedClient();
  client.disconnect();
  advance(60_000);
  assert.deepEqual(socket.sent, []);
  client.destroy();
  const count = FakeSocket.instances.length;
  network.dispatchEvent(new Event("offline"));
  network.dispatchEvent(new Event("online"));
  assert.equal(FakeSocket.instances.length, count);
});

// --- The room's side ---------------------------------------------------------

function roomWith(sockets, { now }) {
  const closed = [];
  const disconnected = [];
  let alarm = null;
  const room = Object.create(BadukRoom.prototype);
  room.ctx = {
    getWebSockets: () => sockets,
    getWebSocketAutoResponseTimestamp: (socket) => socket.lastPing,
    storage: {
      getAlarm: async () => alarm,
      setAlarm: async (at) => { alarm = at; },
      deleteAlarm: async () => { alarm = null; },
    },
  };
  room.engine = { nextDueAt: () => null };
  room.closeSocket = (socket, code, reason) => closed.push([socket.name, code, reason]);
  room.disconnectSocket = async (socket) => disconnected.push(socket.name);
  room.readAttachment = (socket) => socket.attachment;
  return { room, closed, disconnected, alarm: () => alarm, now };
}

test("the room closes member sockets that stopped pinging, and only those", async () => {
  const now = 1_000_000;
  const sockets = [
    { name: "silent", attachment: { identity: { playerId: "a" } }, lastPing: new Date(now - 91_000) },
    { name: "fresh", attachment: { identity: { playerId: "b" } }, lastPing: new Date(now - 5_000) },
    // A throttled background tab pings about once a minute: still online.
    { name: "throttled", attachment: { identity: { playerId: "d" } }, lastPing: new Date(now - 70_000) },
    { name: "never pinged (an older page)", attachment: { identity: { playerId: "c" } }, lastPing: null },
    { name: "no identity", attachment: { identity: null }, lastPing: new Date(now - 300_000) },
  ];
  const { room, closed, disconnected } = roomWith(sockets, { now });
  await room.sweepSilentSockets(now);
  assert.deepEqual(closed, [["silent", 4000, "Heartbeat lost"]]);
  assert.deepEqual(disconnected, ["silent"]);
  // A runtime without the timestamp API sweeps nothing.
  const old = roomWith(sockets, { now });
  delete old.room.ctx.getWebSocketAutoResponseTimestamp;
  await old.room.sweepSilentSockets(now);
  assert.deepEqual(old.closed, []);
});

test("the room checks heartbeats once a minute, only while a game is played and members are connected", async () => {
  const members = [{ name: "m", attachment: { identity: { playerId: "a" } }, lastPing: null }];
  const busy = roomWith(members, { now: Date.now() });
  busy.room.engine.state = { match: { status: "playing" } };
  const before = Date.now();
  await busy.room.scheduleAlarm();
  assert.ok(busy.alarm() >= before + 59_000 && busy.alarm() <= Date.now() + 60_000);
  // Waiting for an opponent or after the game: no periodic wake-ups.
  for (const status of ["setup", "invited", "finished"]) {
    const idle = roomWith(members, { now: Date.now() });
    idle.room.engine.state = { match: { status } };
    await idle.room.scheduleAlarm();
    assert.equal(idle.alarm(), null, status);
  }
  // An earlier room deadline (a clock, a count) still comes first.
  busy.room.engine = { nextDueAt: () => before + 5_000, state: { match: { status: "playing" } } };
  await busy.room.scheduleAlarm();
  assert.equal(busy.alarm(), before + 5_000);
  // Nobody connected and nothing due: no alarm.
  const empty = roomWith([{ name: "x", attachment: { identity: null } }], { now: Date.now() });
  await empty.room.ctx.storage.setAlarm(123);
  await empty.room.scheduleAlarm();
  assert.equal(empty.alarm(), null);
});

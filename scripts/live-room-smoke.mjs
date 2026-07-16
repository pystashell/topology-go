import { RoomClient } from "../src/multiplayer/roomClient.js";

const target = new URL(
  process.argv[2] ?? "http://127.0.0.1:8787/",
).toString();

function waitFor(client, type, predicate, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const unsubscribe = client.on(type, (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

function makeClient() {
  return new RoomClient({
    baseUrl: target,
    locationHref: target,
    storage: null,
    reconnect: { maxAttempts: 2 },
  });
}

async function leaveQuietly(client) {
  if (!client.session) return;
  try {
    await client.leave({ timeoutMs: 5_000 });
  } catch {
    client.abandonRoom();
  }
}

const black = makeClient();
const white = makeClient();

try {
  const blackConnected = waitFor(
    black,
    "connection",
    ({ status }) => status === "connected",
    "black WebSocket connection",
  );
  const created = await black.createRoom({
    name: "Smoke Black",
    gameOptions: { size: 9, komi: 6.5, scoringRule: "japanese" },
  });
  await blackConnected;

  const whiteConnected = waitFor(
    white,
    "connection",
    ({ status }) => status === "connected",
    "white WebSocket connection",
  );
  const joined = await white.joinRoom(created.roomCode, {
    name: "Smoke White",
  });
  await whiteConnected;

  if (created.color !== "black" || joined.color !== "white") {
    throw new Error("Room seats were not assigned black then white");
  }

  const whiteSawBlackMove = waitFor(
    white,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[0] === "black",
    "black move on white client",
  );
  await black.command("play", { row: 0, col: 0 });
  await whiteSawBlackMove;

  const blackSawWhiteMove = waitFor(
    black,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[1] === "white",
    "white move on black client",
  );
  await white.command("play", { row: 0, col: 1 });
  const finalState = await blackSawWhiteMove;

  console.log(
    JSON.stringify({
      ok: true,
      target,
      roomCode: created.roomCode,
      black: created.color,
      white: joined.color,
      moveCount: finalState.room.game.moveCount,
      synchronized: true,
    }),
  );
} finally {
  await leaveQuietly(white);
  await leaveQuietly(black);
}

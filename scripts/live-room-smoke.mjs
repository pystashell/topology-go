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

function isRestoredAfterWhiteUndo({ room }) {
  return (
    room?.game?.topology === "torus" &&
    room?.moveCount === 1 &&
    room?.game?.moveCount === 1 &&
    room?.game?.board?.[0]?.[0] === "black" &&
    room?.game?.board?.[0]?.[1] === null &&
    room?.game?.currentPlayer === "white" &&
    room?.undoRequest === null
  );
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
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
    size: 9,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "torus",
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

  requireCondition(
    created.color === "black" && joined.color === "white",
    "Room seats were not assigned black then white",
  );
  requireCondition(
    created.room?.game?.topology === "torus" &&
      joined.room?.game?.topology === "torus",
    "Torus topology was not preserved across room creation and join",
  );

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
  const beforeUndo = await blackSawWhiteMove;

  requireCondition(
    beforeUndo.room.moveCount === 2 &&
      beforeUndo.room.game.moveCount === 2 &&
      beforeUndo.room.game.board[0][0] === "black" &&
      beforeUndo.room.game.board[0][1] === "white",
    "Both moves were not reflected in the authoritative room state",
  );

  const blackSawUndoRequest = waitFor(
    black,
    "state",
    ({ room }) =>
      room?.undoRequest?.requesterColor === "white" &&
      room.undoRequest.targetMoveCount === 2 &&
      Number.isSafeInteger(room.undoRequest.requestRevision) &&
      room.undoAvailable === true &&
      room.moveCount === 2,
    "white undo request on black client",
  );
  await white.command("request_undo", { expectedMoveCount: 2 });
  const requested = await blackSawUndoRequest;
  const targetMoveCount = requested.room.undoRequest.targetMoveCount;
  const requestRevision = requested.room.undoRequest.requestRevision;

  const blackRestored = waitFor(
    black,
    "state",
    isRestoredAfterWhiteUndo,
    "restored position on black client",
  );
  const whiteRestored = waitFor(
    white,
    "state",
    isRestoredAfterWhiteUndo,
    "restored position on white client",
  );
  await black.command("respond_undo", {
    accept: true,
    targetMoveCount,
    requestRevision,
  });
  const [blackFinal, whiteFinal] = await Promise.all([
    blackRestored,
    whiteRestored,
  ]);

  requireCondition(
    JSON.stringify(blackFinal.room.game.board) ===
      JSON.stringify(whiteFinal.room.game.board),
    "Black and white clients disagree about the board after undo",
  );
  requireCondition(
    blackFinal.room.revision === whiteFinal.room.revision,
    "Black and white clients disagree about the room revision after undo",
  );

  console.log(
    JSON.stringify({
      ok: true,
      target,
      roomCode: created.roomCode,
      black: created.color,
      white: joined.color,
      topology: blackFinal.room.game.topology,
      moveCountBeforeUndo: beforeUndo.room.moveCount,
      moveCount: blackFinal.room.moveCount,
      undoRequestRevision: requestRevision,
      restoredCurrentPlayer: blackFinal.room.game.currentPlayer,
      restoredBlackStone: blackFinal.room.game.board[0][0],
      restoredWhitePoint: blackFinal.room.game.board[0][1],
      undoAccepted: true,
      synchronized: true,
    }),
  );
} finally {
  await leaveQuietly(white);
  await leaveQuietly(black);
}

import { RoomClient } from "../src/multiplayer/roomClient.js";
import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
} from "../src/multiplayer/protocol.js";

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
    room?.game?.topology === "mobius" &&
    room?.moveCount === 1 &&
    room?.game?.moveCount === 1 &&
    room?.game?.board?.[0]?.[0] === "black" &&
    room?.game?.board?.[0]?.[1] === null &&
    room?.game?.currentPlayer === "white" &&
    room?.undoRequest === null
  );
}

function isFinishedByBlackResignation({ room }) {
  return (
    room?.game?.phase === "finished" &&
    room?.game?.result?.reason === "resign" &&
    room?.game?.result?.loser === "black" &&
    room?.game?.result?.winner === "white" &&
    room?.timeControl?.running === false &&
    room?.timeControl?.activeColor === null &&
    room?.undoRequest === null &&
    room?.undoAvailable === false
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
const spectator = makeClient();
const aiHost = makeClient();
const aiSpectator = makeClient();

try {
  const legacyResponse = await fetch(new URL("/api/rooms", target), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, name: "Stale Protocol Probe" }),
  });
  const legacyPayload = await legacyResponse.json();
  requireCondition(
    legacyResponse.status === 400 && /刷新页面/u.test(legacyPayload.error ?? ""),
    "Legacy HTTP clients were not rejected with a refresh instruction",
  );

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
    topology: "mobius",
    mainTimeSeconds: 60,
    byoYomiPeriods: 2,
    byoYomiSeconds: 10,
  });
  await blackConnected;
  requireCondition(
    created.room?.timeControl?.activeColor === null,
    "Authoritative clock started before both player seats were occupied",
  );

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

  const spectatorConnected = waitFor(
    spectator,
    "connection",
    ({ status }) => status === "connected",
    "spectator WebSocket connection",
  );
  const watched = await spectator.joinRoom(created.roomCode, {
    name: "Smoke Spectator",
    role: "spectator",
  });
  await spectatorConnected;

  requireCondition(
    black._socket?.protocol === BADUK_WS_PROTOCOL &&
      white._socket?.protocol === BADUK_WS_PROTOCOL,
    "Clients did not negotiate the v2 WebSocket subprotocol",
  );

  requireCondition(
    created.color === "black" && joined.color === "white",
    "Room seats were not assigned black then white",
  );
  requireCondition(
    watched.session?.role === "spectator" && watched.session?.color === null,
    "Explicit spectator join occupied a player seat",
  );
  requireCondition(
    joined.room?.timeControl?.activeColor === "black" &&
      joined.room?.timeControl?.running === true &&
      joined.room?.timeControl?.byoYomiPeriods === 2,
    "Authoritative Japanese clock did not start when the second player joined",
  );

  let spectatorWriteRejected = false;
  try {
    await spectator.command("play", { row: 8, col: 8 });
  } catch (error) {
    spectatorWriteRejected = ["FORBIDDEN", "NOT_A_PLAYER", "SPECTATOR_READ_ONLY"].includes(error?.code);
  }
  requireCondition(
    spectatorWriteRejected,
    "Spectator was able to issue a game-changing command",
  );
  let spectatorResignRejected = false;
  try {
    await spectator.command("resign");
  } catch (error) {
    spectatorResignRejected = ["FORBIDDEN", "NOT_A_PLAYER", "SPECTATOR_READ_ONLY"].includes(error?.code);
  }
  requireCondition(
    spectatorResignRejected,
    "Spectator was able to resign on behalf of a player",
  );
  requireCondition(
    created.room?.game?.topology === "mobius" &&
      joined.room?.game?.topology === "mobius",
    "Mobius topology was not preserved across room creation and join",
  );

  const uncensoredText = "讨论 D4：<script>alert('still text')</script> 👨‍👩‍👧‍👦";
  const blackSawOwnChat = waitFor(
    black,
    "chat",
    ({ message }) => message?.text === uncensoredText,
    "black text chat on sender client",
  );
  const whiteSawBlackChat = waitFor(
    white,
    "chat",
    ({ message }) => message?.text === uncensoredText,
    "black text chat on white client",
  );
  await black.sendChat({ kind: "text", text: uncensoredText });
  const [blackTextChat, whiteTextChat] = await Promise.all([
    blackSawOwnChat,
    whiteSawBlackChat,
  ]);
  requireCondition(
    blackTextChat.message.id === whiteTextChat.message.id &&
      blackTextChat.message.points?.length === 1 &&
      blackTextChat.message.points[0].row === 5 &&
      blackTextChat.message.points[0].col === 3 &&
      blackTextChat.message.points[0].label === "D4",
    "Text chat or its authoritative D4 coordinate was not synchronized",
  );

  const blackSawSticker = waitFor(
    black,
    "chat",
    ({ message }) => message?.kind === "sticker" && message?.stickerId === "donut",
    "white sticker chat on black client",
  );
  const whiteSawOwnSticker = waitFor(
    white,
    "chat",
    ({ message }) => message?.kind === "sticker" && message?.stickerId === "donut",
    "white sticker chat on sender client",
  );
  await white.sendChat({ kind: "sticker", stickerId: "donut" });
  const [blackStickerChat, whiteStickerChat] = await Promise.all([
    blackSawSticker,
    whiteSawOwnSticker,
  ]);
  requireCondition(
    blackStickerChat.message.id === whiteStickerChat.message.id,
    "Sticker chat was not synchronized to both clients",
  );

  const whiteSawBlackMove = waitFor(
    white,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[0] === "black",
    "black move on white client",
  );
  const spectatorSawBlackMove = waitFor(
    spectator,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[0] === "black",
    "black move on spectator client",
  );
  await black.command("play", { row: 0, col: 0 });
  await Promise.all([whiteSawBlackMove, spectatorSawBlackMove]);

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
  requireCondition(
    JSON.stringify(black.room.chat?.messages) ===
      JSON.stringify(white.room.chat?.messages) &&
      black.room.chat?.messages?.length === 2,
    "Black and white clients disagree about the chat history",
  );

  const blackSawResignation = waitFor(
    black,
    "state",
    isFinishedByBlackResignation,
    "black resignation on sender client",
  );
  const whiteSawResignation = waitFor(
    white,
    "state",
    isFinishedByBlackResignation,
    "black resignation on white client",
  );
  const spectatorSawResignation = waitFor(
    spectator,
    "state",
    isFinishedByBlackResignation,
    "black resignation on spectator client",
  );
  await black.command("resign");
  const resignedStates = await Promise.all([
    blackSawResignation,
    whiteSawResignation,
    spectatorSawResignation,
  ]);
  requireCondition(
    resignedStates.every(({ room }) =>
      room.replay?.outcome?.reason === "resign" &&
      room.replay.outcome.loser === "black" &&
      room.replay.outcome.winner === "white"),
    "Resignation was not persisted in every client's replay",
  );

  const aiHostConnected = waitFor(
    aiHost,
    "connection",
    ({ status }) => status === "connected",
    "online AI host WebSocket connection",
  );
  const aiCreated = await aiHost.createRoom({
    name: "Smoke AI Host",
    width: 9,
    height: 7,
    komi: 6.5,
    scoringRule: "chinese",
    topology: "torus",
    mainTimeSeconds: 60,
    byoYomiPeriods: 2,
    byoYomiSeconds: 10,
  });
  await aiHostConnected;
  requireCondition(
    aiCreated.room?.game?.width === 9 && aiCreated.room?.game?.height === 7,
    "Rectangular online room dimensions were not preserved",
  );

  const aiAttachedState = waitFor(
    aiHost,
    "state",
    ({ room }) =>
      room?.players?.some((player) =>
        player?.color === "white" && player?.automated === true) &&
      room?.timeControl?.running === true &&
      room?.timeControl?.activeColor === "black",
    "AI white seat on host client",
  );
  await aiHost.command("attach_ai", { modelId: "b10" });
  const aiAttached = await aiAttachedState;
  requireCondition(
    aiAttached.room.players.find((player) => player.color === "white")?.role === "ai",
    "Attached AI was not exposed as the white controller",
  );

  const aiSpectatorConnected = waitFor(
    aiSpectator,
    "connection",
    ({ status }) => status === "connected",
    "online AI spectator WebSocket connection",
  );
  const aiWatched = await aiSpectator.joinRoom(aiCreated.roomCode, {
    name: "Smoke AI Spectator",
    role: "spectator",
  });
  await aiSpectatorConnected;
  requireCondition(
    aiWatched.session?.role === "spectator" &&
      aiWatched.room?.players?.some((player) => player?.automated === true),
    "Spectator could not observe the online AI seat",
  );

  const hostSawHumanMove = waitFor(
    aiHost,
    "state",
    ({ room }) =>
      room?.moveCount === 1 &&
      room?.game?.board?.[3]?.[3] === "black" &&
      room?.game?.currentPlayer === "white",
    "human move before online AI response",
  );
  await aiHost.command("play", { row: 3, col: 3 });
  const afterHuman = await hostSawHumanMove;
  const aiMoveExpectation = {
    expectedMoveCount: afterHuman.room.moveCount,
    expectedPositionToken: afterHuman.room.positionToken,
  };

  const hostSawAI = waitFor(
    aiHost,
    "state",
    ({ room }) =>
      room?.moveCount === 2 &&
      room?.game?.board?.[3]?.[4] === "white" &&
      room?.game?.currentPlayer === "black",
    "online AI response on host client",
  );
  const spectatorSawAI = waitFor(
    aiSpectator,
    "state",
    ({ room }) =>
      room?.moveCount === 2 && room?.game?.board?.[3]?.[4] === "white",
    "online AI response on spectator client",
  );
  await aiHost.command("ai_play", {
    row: 3,
    col: 4,
    ...aiMoveExpectation,
  });
  const [afterAI] = await Promise.all([hostSawAI, spectatorSawAI]);

  const hostSawDirectUndo = waitFor(
    aiHost,
    "state",
    ({ room }) =>
      room?.moveCount === 0 &&
      room?.game?.board?.[3]?.[3] === null &&
      room?.game?.board?.[3]?.[4] === null &&
      room?.game?.currentPlayer === "black",
    "direct online AI round undo",
  );
  const spectatorSawDirectUndo = waitFor(
    aiSpectator,
    "state",
    ({ room }) =>
      room?.moveCount === 0 &&
      room?.game?.board?.[3]?.[3] === null &&
      room?.game?.board?.[3]?.[4] === null,
    "direct online AI round undo on spectator client",
  );
  await aiHost.command("direct_undo_ai_round", {
    expectedMoveCount: afterAI.room.moveCount,
    expectedPositionToken: afterAI.room.positionToken,
  });
  await Promise.all([hostSawDirectUndo, spectatorSawDirectUndo]);

  console.log(
    JSON.stringify({
      ok: true,
      target,
      roomCode: created.roomCode,
      black: created.color,
      white: joined.color,
      topology: blackFinal.room.game.topology,
      protocolVersion: BADUK_PROTOCOL_VERSION,
      webSocketProtocol: black._socket?.protocol,
      legacyClientRejected: true,
      moveCountBeforeUndo: beforeUndo.room.moveCount,
      moveCount: blackFinal.room.moveCount,
      undoRequestRevision: requestRevision,
      restoredCurrentPlayer: blackFinal.room.game.currentPlayer,
      restoredBlackStone: blackFinal.room.game.board[0][0],
      restoredWhitePoint: blackFinal.room.game.board[0][1],
      undoAccepted: true,
      chatMessages: black.room.chat.messages.length,
      textPreserved: black.room.chat.messages[0].text === uncensoredText,
      coordinate: black.room.chat.messages[0].points[0].label,
      sticker: black.room.chat.messages[1].stickerId,
      synchronized: true,
      clockStartedAfterBothSeats: true,
      spectatorReadOnly: spectatorWriteRejected,
      spectatorCannotResign: spectatorResignRejected,
      spectatorSynchronized: spectator.room?.game?.board?.[0]?.[0] === "black",
      resignationSynchronized: true,
      resignedColor: "black",
      resignationWinner: "white",
      clockStoppedAfterResignation: true,
      onlineAISeat: true,
      onlineAIModel: "b10",
      onlineAIHostBrowserController: true,
      onlineAISpectatorSynchronized: true,
      onlineAIDirectUndo: true,
      rectangularOnlineBoard: "9x7",
    }),
  );
} finally {
  await leaveQuietly(aiSpectator);
  await leaveQuietly(aiHost);
  await leaveQuietly(spectator);
  await leaveQuietly(white);
  await leaveQuietly(black);
}

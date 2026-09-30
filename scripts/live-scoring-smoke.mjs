import assert from "node:assert/strict";
import { RoomClient } from "../src/multiplayer/roomClient.js";

const target = process.argv[2] ?? "http://127.0.0.1:8787/";
const clients = Array.from({ length: 2 }, () => new RoomClient({ baseUrl: target, locationHref: target, storage: null }));
const [black, white] = clients;
function waitFor(client, predicate, label) {
  if (predicate(client.room)) return Promise.resolve(client.room);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out: ${label}`)); }, 10000);
    const unsubscribe = client.on("state", ({ room }) => {
      if (predicate(room)) { clearTimeout(timeout); unsubscribe(); resolve(room); }
    });
  });
}
async function settled(action, client, payload = {}) {
  const { revision } = await client.command(action, payload);
  await Promise.all(clients.map(c => waitFor(c, room => room?.revision >= revision, action)));
}
try {
  const created = await black.createRoom({ name: "Scoring Black", size: 5 });
  await white.joinRoom(created.roomCode, { name: "Scoring White" });
  await settled("request_game", black, { mode: "friend" });
  await settled("respond_game", white, { accept: true, requestRevision: white.room.match.request.requestRevision });
  await settled("play", black, { row: 0, col: 0 });
  await settled("pass", white);
  await settled("pass", black);
  const delayedToken = white.room.scoringToken;
  await settled("toggle_dead", black, { row: 0, col: 0 });
  const currentToken = black.room.scoringToken;
  assert.notEqual(currentToken, delayedToken);
  await settled("finish_scoring", black, { expectedScoringToken: currentToken });
  await assert.rejects(white.command("finish_scoring", { expectedScoringToken: delayedToken }), { code: "STALE_SCORING" });
  assert.equal(black.room.game.phase, "scoring");
  await settled("finish_scoring", white, { expectedScoringToken: currentToken });
  assert.equal(black.room.game.phase, "finished");
  assert.equal(white.room.game.phase, "finished");
  console.log(JSON.stringify({ ok: true, target, delayedConfirmationRejected: true, bothClientsFinishedSameProposal: true }));
} finally {
  for (const client of clients.reverse()) {
    try { await client.leave({ timeoutMs: 3000 }); } catch { client.abandonRoom(); }
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import { fetchLobbyRooms, LobbyClientError } from "../src/multiplayer/lobbyClient.js";
import { encodeLobbyBoardPreview } from "../src/multiplayer/lobbyPreview.js";

const emptyBoard = Array.from({ length: 9 }, () => Array(9).fill(null));

const validRoom = {
  code: "BAM234",
  revision: 3,
  status: "setup",
  mode: "friend",
  width: 9,
  height: 9,
  topology: "cylinder",
  boardPreview: encodeLobbyBoardPreview(emptyBoard, 9, 9),
  lastMove: null,
  updatedAt: 2,
  expiresAt: 99,
};

test("lobby client validates and orders public room summaries", async () => {
  const seen = [];
  const rooms = await fetchLobbyRooms({
    endpoint: "/api/lobby",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify({
        rooms: [
          { ...validRoom, code: "OLD234", updatedAt: 1 },
          { invalid: true },
          validRoom,
        ],
      }));
    },
  });
  assert.deepEqual(rooms.map(({ code }) => code), ["BAM234", "OLD234"]);
  assert.equal(seen[0].url, "/api/lobby");
  assert.equal(seen[0].options.cache, "no-store");
});

test("lobby client exposes a stable error when the directory is unavailable", async () => {
  await assert.rejects(
    fetchLobbyRooms({ fetchImpl: async () => { throw new Error("offline"); } }),
    (error) => error instanceof LobbyClientError && error.code === "LOBBY_UNREACHABLE",
  );
});

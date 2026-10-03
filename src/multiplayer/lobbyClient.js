import { isLobbySummary, sortLobbyRooms } from "./lobby.js";

export class LobbyClientError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "LobbyClientError";
    this.code = options.code ?? "LOBBY_ERROR";
  }
}

export async function fetchLobbyRooms({
  fetchImpl = globalThis.fetch,
  endpoint = "/api/lobby",
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new LobbyClientError("当前环境无法连接在线大厅。", { code: "FETCH_UNAVAILABLE" });
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (cause) {
    throw new LobbyClientError("暂时无法连接在线大厅。", {
      code: "LOBBY_UNREACHABLE",
      cause,
    });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new LobbyClientError(
      typeof payload?.error === "string" ? payload.error : "在线大厅暂时不可用。",
      { code: "LOBBY_REJECTED" },
    );
  }
  const rooms = Array.isArray(payload?.rooms)
    ? payload.rooms.filter(isLobbySummary)
    : [];
  return sortLobbyRooms(rooms);
}

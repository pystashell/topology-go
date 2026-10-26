/**
 * The online lobby screen (/lobby): this browser's own rooms, the public
 * room list with its search, filters, sort and counts, live board previews
 * of visible cards, quick join, and polling.
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js) and keeps the lobby's own
 * state here.
 */

import {
  ENABLE_MULTI_GAME,
} from "../game/gameTypes.js";
import {
  BLACK,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
  WHITE,
} from "../game/goEngine.js";
import {
  getLocale,
  localizedErrorMessage,
  translateText,
} from "../i18n.js";
import {
  lobbyGameLabels,
} from "../ui/gameUi.js";
import {
  LOBBY_POLL_INTERVAL_MS,
  LOBBY_RATE_LIMIT_BACKOFF_MS,
  appRouteMode,
  appendLobbyMetadata,
  elements,
  game,
  roomClient,
} from "../main.js";

let lobbyRefreshController = null;
let lobbyRooms = [];
const lobbyRoomCards = new Map();
const lobbyVisiblePreviews = new Set();
let lobbyPreviewObserver = null;
let lobbyPreviewRenderer = null;
let lobbyStatusFilter = "all";
let lobbyLoading = false;
let lobbyLoadError = null;
let lobbyLastRefreshAt = 0;
let lobbyPollTimer = null;
let lobbyModulesPromise = null;
let lobbySearch = "";
let lobbySort = "recommended";
// "My rooms" entry whose Remove button asks for confirmation (a room code).
let lobbyForgetArmed = null;

function loadLobbyModules() {
  if (!lobbyModulesPromise) {
    lobbyModulesPromise = Promise.all([
      import("../multiplayer/lobby.js"),
      import("../multiplayer/lobbyClient.js"),
      import("../multiplayer/lobbyPreview.js"),
    ]).then(([lobby, client, preview]) => ({ ...lobby, ...client, ...preview }));
  }
  return lobbyModulesPromise;
}

function lobbyTopologyLabel(topology) {
  return topology === TOPOLOGY_TORUS
    ? "甜甜圈"
    : topology === TOPOLOGY_MOBIUS
      ? "莫比乌斯"
      : "竹筒";
}

function lobbyStatusLabel(status) {
  return {
    setup: "等待设置",
    invited: "等待接受",
    playing: "正在进行",
    finished: "已经结束",
  }[status] ?? "房间";
}

function lobbyModeLabel(mode) {
  return {
    friend: "好友对战",
    "human-ai": "人机对战",
    "ai-ai": "AI 自对弈",
    local: "同机双人",
  }[mode] ?? "在线对局";
}

/** The player name with an online/offline dot and an AI tag. */
function fillLobbyPlayer(node, player, fallback) {
  node.replaceChildren();
  const dot = document.createElement("i");
  dot.className = `lobby-presence ${player ? player.online ? "online" : "offline" : "empty"}`;
  dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.textContent = player?.name || fallback;
  node.append(dot, name);
  if (player?.controller === "ai") {
    const tag = document.createElement("small");
    tag.className = "lobby-player-tag";
    tag.textContent = "AI";
    node.append(tag);
  }
  node.title = player
    ? translateText(player.controller === "ai" ? "AI 席位" : player.online ? "在线" : "离线")
    : "";
}

function lobbyUpdatedLabel(updatedAt) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1_000));
  if (elapsedSeconds < 60) return "刚刚更新";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`;
  return `${Math.floor(elapsedSeconds / 3_600)} 小时前`;
}

function drawLobbyRoomPreview(canvas) {
  const room = canvas?.__lobbyRoomSummary;
  if (!canvas || !room || typeof lobbyPreviewRenderer !== "function") return;
  const fallback = canvas.__lobbyPreviewFallback;
  try {
    // The CSS presentation remains 18:11. A modest backing buffer keeps the
    // thumbnail sharp while avoiding hundreds of full-size canvases in a busy
    // lobby. Off-screen canvases stay at 1x1 until they become visible.
    if (canvas.width !== 240) canvas.width = 240;
    if (canvas.height !== 147) canvas.height = 147;
    const description = lobbyPreviewRenderer(canvas, room, {
      width: canvas.width,
      height: canvas.height,
      locale: getLocale(),
    });
    canvas.title = description;
    canvas.hidden = false;
    if (fallback) fallback.hidden = true;
  } catch {
    canvas.hidden = true;
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = `${room.width} × ${room.height} 棋盘预览暂不可用`;
    }
  }
}

function ensureLobbyPreviewObserver() {
  if (lobbyPreviewObserver || typeof window.IntersectionObserver !== "function") return;
  lobbyPreviewObserver = new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        lobbyVisiblePreviews.add(entry.target);
        drawLobbyRoomPreview(entry.target);
      } else {
        lobbyVisiblePreviews.delete(entry.target);
      }
    }
  }, { rootMargin: "180px 0px" });
}

function createLobbyRoomCard() {
  const card = document.createElement("article");
  card.className = "lobby-room-card";

  const header = document.createElement("div");
  header.className = "lobby-room-card-header";
  const title = document.createElement("strong");
  const status = document.createElement("span");
  status.className = "lobby-room-status-badge";
  const badges = document.createElement("span");
  badges.className = "lobby-room-card-badges";
  const gameBadge = document.createElement("span");
  gameBadge.className = "lobby-room-game-badge";
  badges.append(gameBadge, status);
  header.append(title, badges);

  const metadata = document.createElement("div");
  metadata.className = "lobby-room-meta";

  const players = document.createElement("div");
  players.className = "lobby-room-players";
  const blackName = document.createElement("span");
  const versus = document.createElement("span");
  versus.className = "versus";
  versus.textContent = "VS";
  const whiteName = document.createElement("span");
  players.append(blackName, versus, whiteName);

  const preview = document.createElement("figure");
  preview.className = "lobby-room-preview";
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const fallback = document.createElement("span");
  fallback.className = "lobby-room-preview-fallback";
  fallback.hidden = true;
  canvas.__lobbyPreviewFallback = fallback;
  preview.append(canvas, fallback);

  const details = document.createElement("div");
  details.className = "lobby-room-card-details";
  details.append(metadata, players);
  const body = document.createElement("div");
  body.className = "lobby-room-card-body";
  body.append(preview, details);

  const footer = document.createElement("div");
  footer.className = "lobby-room-card-footer";
  const activity = document.createElement("small");
  const actions = document.createElement("div");
  actions.className = "room-card-actions";
  const note = document.createElement("small");
  note.className = "lobby-room-note";
  note.hidden = true;
  details.append(note);

  footer.append(activity, actions);
  card.append(header, body, footer);
  card.__lobbyElements = {
    title,
    status,
    gameBadge,
    metadata,
    blackName,
    whiteName,
    canvas,
    activity,
    actions,
    note,
  };
  return card;
}

function updateLobbyRoomCard(card, room) {
  const view = card.__lobbyElements;
  card.dataset.roomCode = room.code;
  view.title.textContent = `房间 ${room.code}`;
  view.status.className = `lobby-room-status-badge ${room.status}`;
  view.status.textContent = lobbyStatusLabel(room.status);
  // Which game the room plays (absent in Go rooms' summaries).
  const gameLabels = lobbyGameLabels(room);
  view.gameBadge.className = `lobby-room-game-badge ${gameLabels.gameType}`;
  view.gameBadge.textContent = gameLabels.badge;
  view.gameBadge.hidden = !ENABLE_MULTI_GAME;
  card.dataset.gameType = gameLabels.gameType;

  view.metadata.replaceChildren();
  appendLobbyMetadata(view.metadata, `${room.width} × ${room.height}`);
  if (gameLabels.rule) appendLobbyMetadata(view.metadata, gameLabels.rule);
  appendLobbyMetadata(view.metadata, lobbyTopologyLabel(room.topology));
  appendLobbyMetadata(view.metadata, lobbyModeLabel(room.mode));
  if (room.timed) appendLobbyMetadata(view.metadata, "计时");
  if (room.roundNumber > 0) appendLobbyMetadata(view.metadata, `第 ${room.roundNumber} 局`);
  appendLobbyMetadata(view.metadata, room.moveCount > 0 ? `${room.moveCount} 手` : "空盘");

  const black = room.players?.find((player) => player.color === BLACK) ?? null;
  const white = room.players?.find((player) => player.color === WHITE) ?? null;
  fillLobbyPlayer(view.blackName, black, "等待黑方");
  fillLobbyPlayer(view.whiteName, white, "等待白方");
  view.activity.textContent = `${room.spectatorCount || 0} 人观战 · ${lobbyUpdatedLabel(room.updatedAt)}`;
  // A waiting room whose host has gone offline cannot start a game yet.
  const hostAway = black && black.controller !== "ai" && !black.online &&
    room.status !== "playing" && room.status !== "finished";
  view.note.hidden = !hostAway;
  view.note.textContent = hostAway ? "房主暂时离线，回来后才能开局" : "";

  view.actions.replaceChildren();
  const resumable = roomClient.hasStoredSession(room.code);
  if (resumable || room.joinable) {
    const join = document.createElement("button");
    join.type = "button";
    join.className = resumable ? "primary-button" : "secondary-button";
    join.dataset.lobbyRoom = room.code;
    join.dataset.lobbyRole = resumable ? "resume" : "player";
    join.textContent = resumable ? "返回房间" : "加入对局";
    view.actions.append(join);
  }
  if (room.watchable) {
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = "secondary-button";
    watch.dataset.lobbyRoom = room.code;
    watch.dataset.lobbyRole = "spectator";
    watch.textContent = "观战";
    view.actions.append(watch);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary-button lobby-copy-link";
  copy.dataset.lobbyCopy = room.code;
  copy.textContent = "复制链接";
  copy.title = translateText("复制这个房间的分享链接（打开后默认观战）");
  view.actions.append(copy);

  view.canvas.__lobbyRoomSummary = room;
  if (lobbyVisiblePreviews.has(view.canvas)) drawLobbyRoomPreview(view.canvas);
  else if (lobbyPreviewObserver) lobbyPreviewObserver.observe(view.canvas);
  else {
    lobbyVisiblePreviews.add(view.canvas);
    drawLobbyRoomPreview(view.canvas);
  }
}

/** The filters the controls describe (status, game, shape, size, mode, search, order). */
function lobbyFilters() {
  return {
    status: lobbyStatusFilter,
    game: ENABLE_MULTI_GAME ? elements.lobbyGameFilter.value : "all",
    topology: elements.lobbyTopologyFilter.value,
    size: elements.lobbySizeFilter.value,
    mode: elements.lobbyModeFilter.value,
    query: lobbySearch,
    order: lobbySort,
  };
}

/** "My rooms": every room this browser holds a seat or a watch in. */
function renderMyLobbyRooms(myLobbyRooms) {
  const entries = myLobbyRooms(roomClient.listAllStoredSessions(), lobbyRooms);
  elements.lobbyMyRooms.hidden = entries.length === 0;
  const items = entries.map((entry) => {
    const item = document.createElement("article");
    item.className = "lobby-my-room";
    item.dataset.roomCode = entry.code;
    const title = document.createElement("strong");
    title.textContent = `房间 ${entry.code}`;
    const role = document.createElement("span");
    role.className = "lobby-my-room-role";
    role.textContent = entry.role === "spectator"
      ? "你在观战"
      : entry.color === WHITE ? "你执白" : entry.color === BLACK ? "你执黑" : "你的席位";
    const status = document.createElement("small");
    status.className = "lobby-my-room-status";
    // One element per part, so each is translated on its own.
    const parts = entry.summary
      ? [
          lobbyGameLabels(entry.summary).badge,
          `${entry.summary.width} × ${entry.summary.height}`,
          lobbyStatusLabel(entry.summary.status),
        ]
      : ["不在大厅（已结束、不公开、没人在或已过期）"];
    status.append(...parts.map((part) => {
      const span = document.createElement("span");
      span.textContent = part;
      return span;
    }));
    const actions = document.createElement("div");
    actions.className = "room-card-actions";
    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "primary-button";
    resume.dataset.lobbyRoom = entry.code;
    resume.dataset.lobbyRole = "resume";
    resume.textContent = "返回房间";
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "secondary-button lobby-forget";
    forget.dataset.lobbyForget = entry.code;
    const armed = lobbyForgetArmed === entry.code;
    forget.classList.toggle("danger-button", armed);
    forget.textContent = armed ? "确认移除" : "移除";
    forget.title = translateText("只删除这台设备上的记录；房间和其他人的席位不受影响，之后不能再用这个身份返回");
    actions.append(resume, forget);
    item.append(title, role, status, actions);
    return item;
  });
  elements.lobbyMyRoomList.replaceChildren(...items);
}

/** Counts on the status buttons and the summary line. */
function renderLobbyCounts(lobbyStats) {
  const stats = lobbyStats(lobbyRooms);
  const counts = { all: stats.total, joinable: stats.joinable, playing: stats.playing };
  for (const node of elements.lobbyCounts) {
    const value = counts[node.dataset.lobbyCount];
    node.textContent = Number.isFinite(value) && value > 0 ? ` ${value}` : "";
  }
  elements.lobbyStats.textContent = stats.total === 0
    ? ""
    : `可加入 ${stats.joinable} · 正在进行 ${stats.playing} · 等待开局 ${stats.waiting} · ${stats.spectators} 人观战 · ${stats.playersOnline} 位棋手在线`;
}

async function renderLobbyRooms() {
  if (appRouteMode !== "lobby") return;
  const {
    filterLobbyRooms, lobbyStats, myLobbyRooms, renderLobbyBoardPreview,
  } = await loadLobbyModules();
  lobbyPreviewRenderer = renderLobbyBoardPreview;
  ensureLobbyPreviewObserver();
  renderMyLobbyRooms(myLobbyRooms);
  renderLobbyCounts(lobbyStats);
  const filtered = filterLobbyRooms(lobbyRooms, lobbyFilters());
  const visibleCodes = new Set(filtered.map((room) => room.code));
  for (const [code, card] of lobbyRoomCards) {
    if (visibleCodes.has(code)) continue;
    const canvas = card.__lobbyElements?.canvas;
    if (canvas) {
      lobbyPreviewObserver?.unobserve(canvas);
      lobbyVisiblePreviews.delete(canvas);
    }
    card.remove();
    lobbyRoomCards.delete(code);
  }

  let cursor = elements.lobbyRoomList.firstElementChild;
  for (const room of filtered) {
    let card = lobbyRoomCards.get(room.code);
    if (!card) {
      card = createLobbyRoomCard();
      lobbyRoomCards.set(room.code, card);
    }
    updateLobbyRoomCard(card, room);
    if (card !== cursor) elements.lobbyRoomList.insertBefore(card, cursor);
    cursor = card.nextElementSibling;
  }
  elements.lobbyEmpty.hidden = filtered.length > 0;
  if (!lobbyLoading) syncLobbyStatus(filtered.length);
}

function lobbyCountText(shown, total) {
  return shown === total
    ? `共 ${total} 个公开房间`
    : `显示 ${shown} / 共 ${total} 个公开房间`;
}

/** The status line counts the rooms the filters leave visible. */
function syncLobbyStatus(shown) {
  // The error is kept as an object so a language switch re-renders it.
  const text = lobbyLoadError
    ? localizedErrorMessage(lobbyLoadError, "暂时无法读取在线大厅。")
    : lobbyCountText(shown, lobbyRooms.length);
  // An unchanged count must not re-announce in this live region every poll;
  // compare with the rendered (possibly translated) text.
  if (elements.lobbyStatus.textContent !== translateText(text)) {
    elements.lobbyStatus.textContent = text;
  }
  elements.lobbyStatus.classList.toggle("error", Boolean(lobbyLoadError));
}

function clearLobbyPoll() {
  if (lobbyPollTimer !== null) window.clearTimeout(lobbyPollTimer);
  lobbyPollTimer = null;
}

function lobbyPollingActive() {
  return appRouteMode === "lobby" && document.visibilityState !== "hidden";
}

function scheduleLobbyPoll(delayMs = LOBBY_POLL_INTERVAL_MS) {
  clearLobbyPoll();
  if (!lobbyPollingActive()) return;
  lobbyPollTimer = window.setTimeout(() => {
    lobbyPollTimer = null;
    void refreshLobby();
  }, delayMs);
}

async function refreshLobby({ announce = false } = {}) {
  if (appRouteMode !== "lobby" || lobbyLoading) return;
  clearLobbyPoll();
  lobbyLoading = true;
  lobbyRefreshController?.abort();
  const request = new AbortController();
  lobbyRefreshController = request;
  elements.lobbyRefresh.disabled = true;
  if (announce || lobbyLastRefreshAt === 0) {
    elements.lobbyStatus.classList.remove("error");
    elements.lobbyStatus.textContent = "正在读取公开房间…";
  }
  let nextPollMs = LOBBY_POLL_INTERVAL_MS;
  try {
    const { fetchLobbyRooms } = await loadLobbyModules();
    lobbyRooms = await fetchLobbyRooms({ signal: request.signal });
    lobbyLoadError = null;
  } catch (error) {
    if (error?.cause?.name === "AbortError" || request.signal.aborted) return;
    lobbyLoadError = error ?? new Error("");
    if (error?.code === "RATE_LIMITED" || error?.status === 429) {
      nextPollMs = Math.max(
        LOBBY_RATE_LIMIT_BACKOFF_MS,
        (Number(error?.retryAfterSeconds) || 0) * 1_000,
      );
    }
  } finally {
    if (lobbyRefreshController === request) lobbyLoading = false;
    elements.lobbyRefresh.disabled = false;
  }
  lobbyLastRefreshAt = Date.now();
  await renderLobbyRooms();
  scheduleLobbyPoll(nextPollMs);
}

function cancelLobbyRequest() {
  clearLobbyPoll();
  lobbyRefreshController?.abort();
  lobbyRefreshController = null;
  lobbyLoading = false;
}

function resumeLobbyPolling() {
  if (appRouteMode !== "lobby") return;
  if (document.visibilityState === "hidden") {
    clearLobbyPoll();
    return;
  }
  const elapsed = Date.now() - lobbyLastRefreshAt;
  if (elapsed >= LOBBY_POLL_INTERVAL_MS) void refreshLobby();
  else scheduleLobbyPoll(LOBBY_POLL_INTERVAL_MS - elapsed);
}

/**
 * The room "Quick join" should take under the current filters (rooms this
 * browser already sits in are skipped), or null.
 */
async function chooseQuickJoinRoom() {
  const { pickQuickJoinRoom } = await loadLobbyModules();
  const own = roomClient.listAllStoredSessions().map(({ code }) => code);
  return pickQuickJoinRoom(lobbyRooms, lobbyFilters(), { exclude: own })?.code ?? null;
}

/** Say in the lobby status line why quick join found nothing. */
function announceLobby(text) {
  elements.lobbyStatus.classList.remove("error");
  elements.lobbyStatus.textContent = text;
}

/** Remove (after a second click) this browser's record of a room. */
async function forgetLobbyRoom(code) {
  if (lobbyForgetArmed !== code) {
    lobbyForgetArmed = code;
    await renderLobbyRooms();
    return;
  }
  lobbyForgetArmed = null;
  const inRoom = roomClient.roomCode === code && roomClient.session;
  const forgotten = !inRoom && roomClient.forgetStoredSessions(code);
  await renderLobbyRooms();
  // After the list redraw, which rewrites the status line.
  announceLobby(inRoom
    ? `你还连着房间 ${code}；先退出房间再移除。`
    : forgotten
      ? `已从这台设备移除房间 ${code} 的记录。`
      : `无法移除房间 ${code} 的记录，请检查浏览器存储设置。`);
}

/** Copy a room's share link (it opens as a spectator, like the room's own link). */
async function copyLobbyRoomLink(code, button) {
  const link = new URL(`/online/${encodeURIComponent(code)}`, window.location.origin).href;
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    copied = false;
  }
  announceLobby(copied ? `已复制房间 ${code} 的链接。` : `房间链接：${link}`);
  if (button && copied) {
    button.textContent = "已复制";
    window.setTimeout(() => { button.textContent = "复制链接"; }, 1_600);
  }
}

/** The lobby's status buttons and filters re-render the room list. */
function wireLobbyFilters() {
  for (const button of elements.lobbyStatusButtons) {
    button.addEventListener("click", () => {
      lobbyStatusFilter = button.dataset.lobbyStatus || "all";
      for (const candidate of elements.lobbyStatusButtons) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      }
      void renderLobbyRooms();
    });
  }
  for (const filter of [
    elements.lobbyGameFilter,
    elements.lobbyTopologyFilter,
    elements.lobbySizeFilter,
    elements.lobbyModeFilter,
  ]) {
    filter.addEventListener("change", () => void renderLobbyRooms());
  }
  elements.lobbySort.addEventListener("change", () => {
    lobbySort = elements.lobbySort.value;
    void renderLobbyRooms();
  });
  elements.lobbySearch.addEventListener("input", () => {
    lobbySearch = elements.lobbySearch.value;
    void renderLobbyRooms();
  });
  elements.lobbyMyRoomList.addEventListener("click", (event) => {
    const forget = event.target.closest("[data-lobby-forget]");
    if (forget) void forgetLobbyRoom(forget.dataset.lobbyForget);
  });
  elements.lobbyRoomList.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-lobby-copy]");
    if (copy) void copyLobbyRoomLink(copy.dataset.lobbyCopy, copy);
  });
}

function loadLobbyOnce() {
  void refreshLobby({ announce: true });
}

export {
  announceLobby,
  cancelLobbyRequest,
  chooseQuickJoinRoom,
  loadLobbyOnce,
  refreshLobby,
  renderLobbyRooms,
  resumeLobbyPolling,
  wireLobbyFilters,
};

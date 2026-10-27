/**
 * My games: finished games saved for this browser's guest (later, its
 * account). A game played on this page uploads once when it finishes, and
 * waits in this browser while the site cannot be reached; online games are
 * saved by their room. /records lists them and /game/<id> opens one in the
 * replay player. Only a game's players can open it
 * (docs/design/accounts-and-game-records.md).
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js).
 */

import { BLACK, PHASE_FINISHED, WHITE } from "../game/goEngine.js";
import { gameTypeOf } from "../game/rules/index.js";
import {
  getLocale,
  localizedErrorMessage,
  translateText,
} from "../i18n.js";
import {
  colorName,
  formatGameResult,
  gameName,
} from "../ui/gameUi.js";
import {
  aiControlsColor,
  boardHeight,
  boardWidth,
  currentAIName,
  currentTimeoutOutcome,
  elements,
  enterReplay,
  exitReplay,
  game,
  hasOnlineSession,
  isAIMode,
  isReplaying,
  replayEventCount,
  replaySource,
  savedPlayerName,
  setMessage,
  topologyName,
} from "../main.js";
import { accountSeen } from "./account.js";

const PENDING_STORAGE_KEY = "topology-go-pending-records-v1";
// Games waiting in this browser for the site; the oldest go first.
const MAX_PENDING_RECORDS = 10;
const LOCAL_KEY_PATTERN = /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Each game played on this page: its record key and whether it was sent.
const localGames = new WeakMap();

let recordsGameFilter = "all";
let recordsList = [];
let recordsNext = null;
let recordsLoading = false;
let recordsLoadedOnce = false;
let armedRemoval = null;

function newLocalKey() {
  return `local:${crypto.randomUUID()}`;
}

function localGameEntry(state = game) {
  if (!state || typeof state !== "object") return null;
  let entry = localGames.get(state);
  if (!entry) {
    entry = { key: newLocalKey(), sent: false };
    localGames.set(state, entry);
  }
  return entry;
}

/** The record key of a game played on this page (kept with an offline snapshot). */
function localRecordKey(state = game) {
  const entry = localGameEntry(state);
  return entry ? { key: entry.key, sent: entry.sent } : null;
}

/** Give a game restored from an offline snapshot the key it was played under. */
function adoptLocalRecordKey(state, saved) {
  if (!state || typeof saved?.key !== "string" || !LOCAL_KEY_PATTERN.test(saved.key)) return;
  localGames.set(state, { key: saved.key, sent: saved.sent === true });
}

function readPending() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => LOCAL_KEY_PATTERN.test(entry?.clientKey ?? "")) : [];
  } catch {
    return [];
  }
}

function writePending(entries) {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_STORAGE_KEY);
    else window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_PENDING_RECORDS)));
  } catch {
    // Storage full or blocked: the game is not kept for a later try.
  }
}

function playerFor(color, mode) {
  if (mode !== "local" && aiControlsColor(color)) {
    return { name: currentAIName(color), kind: "ai" };
  }
  const saved = mode === "human-ai" ? savedPlayerName() : "";
  return { name: saved || colorName(color), kind: "human" };
}

/** The upload for a finished game on this page, or null when there is none. */
function finishedLocalUpload() {
  if (!game || hasOnlineSession() || isReplaying()) return null;
  const timeout = currentTimeoutOutcome();
  if (game.phase !== PHASE_FINISHED && !timeout) return null;
  const replay = replaySource();
  const moveCount = replayEventCount(replay);
  if (!replay || moveCount === 0) return null;
  const aiBlack = isAIMode() && aiControlsColor(BLACK);
  const aiWhite = isAIMode() && aiControlsColor(WHITE);
  const mode = aiBlack && aiWhite ? "ai-ai" : aiBlack || aiWhite ? "human-ai" : "local";
  const state = typeof game.getState === "function" ? game.getState() : game;
  const gameType = gameTypeOf(game);
  return {
    v: 1,
    clientKey: localGameEntry().key,
    mode,
    ownerColor: mode === "human-ai" ? (aiBlack ? WHITE : BLACK) : null,
    gameType,
    width: boardWidth(game),
    height: boardHeight(game),
    topology: game.topology ?? "cylinder",
    players: { black: playerFor(BLACK, mode), white: playerFor(WHITE, mode) },
    result: timeout ?? game.result ?? null,
    moveCount,
    startedAt: null,
    finishedAt: Date.now(),
    settings: {
      gameType,
      width: boardWidth(game),
      height: boardHeight(game),
      topology: game.topology ?? "cylinder",
      ...(state.komi === undefined ? {} : { komi: state.komi }),
      ...(state.scoringRule === undefined ? {} : { scoringRule: state.scoringRule }),
      ...(state.ruleSet === undefined ? {} : { ruleSet: state.ruleSet }),
    },
    replay,
  };
}

async function postRecord(body) {
  const response = await fetch("/api/records", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return { ok: true };
  const payload = await response.json().catch(() => null);
  // A refused record (malformed, too large) will not succeed later either.
  return { ok: false, retry: response.status === 429 || response.status >= 500, code: payload?.code ?? null };
}

/**
 * Save the game on this page once it finished: called after every update,
 * so it is cheap until a game ends. Games against the AI, on one device
 * and AI against AI are all saved.
 */
function maybeSaveFinishedLocalGame() {
  const entry = game ? localGames.get(game) ?? null : null;
  if (entry?.sent) return;
  const body = finishedLocalUpload();
  if (!body) return;
  localGameEntry().sent = true;
  void sendRecord(body);
}

async function sendRecord(body) {
  let outcome;
  try {
    outcome = await postRecord(body);
  } catch {
    outcome = { ok: false, retry: true };
  }
  if (outcome.ok) {
    if (recordsLoadedOnce) recordsLoadedOnce = false;
    return true;
  }
  if (outcome.retry) {
    writePending([...readPending().filter((entry) => entry.clientKey !== body.clientKey), body]);
  } else {
    console.warn("A finished game was not saved", outcome.code);
  }
  return false;
}

/** Send games that waited in this browser (on page load and opening the list). */
async function flushPendingRecords() {
  const pending = readPending();
  if (pending.length === 0) return;
  writePending([]);
  for (const body of pending) {
    // A failure puts the game back; the rest wait for the next try.
    if (!(await sendRecord(body))) {
      const left = pending.slice(pending.indexOf(body) + 1);
      writePending([...readPending(), ...left]);
      return;
    }
  }
}

// --- The list (/records) -----------------------------------------------------

function recordsStatus(text, error = false) {
  elements.recordsStatus.textContent = text;
  elements.recordsStatus.classList.toggle("error", error);
}

function formatRecordDate(timestamp) {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
  }
}

function recordResultText(record) {
  return formatGameResult(record.result) || (record.winner === "draw" ? "双方和棋" : "对局中断");
}

function recordModeText(record) {
  if (record.source === "online") return "联机对局";
  return {
    "human-ai": "人机对战",
    local: "同机双人",
    "ai-ai": "AI 自对弈",
  }[record.mode] ?? "本机对局";
}

function playerLine(record, color) {
  const player = record.players?.[color] ?? {};
  const line = document.createElement("span");
  line.className = `record-player record-player-${color}`;
  const side = document.createElement("span");
  side.className = "record-side";
  side.textContent = colorName(color);
  line.append(side);
  // Two people on one device are just "Black" and "White".
  if (player.name && player.name !== colorName(color)) {
    const name = document.createElement("strong");
    // AI names are the page's own copy; people's names are what they typed.
    name.textContent = player.kind === "ai" ? translateText(player.name) : player.name;
    line.append(name);
  }
  if (record.color === color) {
    const you = document.createElement("span");
    you.className = "record-you";
    you.textContent = "你";
    line.append(you);
  }
  return line;
}

function recordItem(record) {
  const item = document.createElement("li");
  item.className = "record-item";
  item.dataset.recordId = record.id;

  const title = document.createElement("div");
  title.className = "record-title";
  for (const part of [gameName(record.gameType), `${record.width} × ${record.height}`, topologyName(record.topology)]) {
    const span = document.createElement("span");
    span.textContent = part;
    title.append(span);
  }
  const badge = document.createElement("span");
  badge.className = "record-badge";
  badge.textContent = recordModeText(record);
  title.append(badge);

  const players = document.createElement("div");
  players.className = "record-players";
  players.append(playerLine(record, BLACK), playerLine(record, WHITE));

  const result = document.createElement("p");
  result.className = "record-result";
  result.textContent = recordResultText(record);

  const meta = document.createElement("small");
  meta.className = "record-meta";
  const moves = document.createElement("span");
  moves.textContent = `${record.moveCount} 手`;
  const date = document.createElement("span");
  date.textContent = formatRecordDate(record.finishedAt);
  meta.append(moves, date);

  const actions = document.createElement("div");
  actions.className = "record-actions";
  const open = document.createElement("a");
  open.className = "primary-button";
  open.href = `/game/${encodeURIComponent(record.id)}`;
  open.textContent = "回放";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary-button";
  remove.dataset.recordRemove = record.id;
  const armed = armedRemoval === record.id;
  remove.textContent = armed ? "确认移除" : "移除";
  remove.title = translateText("只从你的棋谱里移除；对方的那份不受影响");
  actions.append(open, remove);

  item.append(title, players, result, meta, actions);
  return item;
}

function renderRecords() {
  elements.recordsList.replaceChildren(...recordsList.map(recordItem));
  elements.recordsMore.hidden = !recordsNext;
  for (const button of elements.recordsGameButtons) {
    const active = button.dataset.recordsGame === recordsGameFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (recordsLoading) return;
  if (recordsList.length === 0) {
    recordsStatus(recordsGameFilter === "all"
      ? "还没有棋谱。下完一盘棋，它会自动出现在这里。"
      : "这个棋类还没有棋谱。");
  } else {
    recordsStatus("");
  }
}

async function loadRecords({ more = false } = {}) {
  if (recordsLoading) return;
  recordsLoading = true;
  recordsStatus("正在读取棋谱…");
  try {
    if (!more) await flushPendingRecords();
    const params = new URLSearchParams();
    if (recordsGameFilter !== "all") params.set("game", recordsGameFilter);
    if (more && recordsNext) params.set("before", recordsNext);
    const query = params.toString();
    const response = await fetch(`/api/records${query ? `?${query}` : ""}`, { credentials: "same-origin" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(payload?.error ?? ""), { code: payload?.code });
    recordsList = more ? [...recordsList, ...(payload.records ?? [])] : payload.records ?? [];
    recordsNext = payload.next ?? null;
    // Whose list it is: the guest note shows only for guests.
    if (!more) accountSeen(payload.account ?? null);
    recordsLoadedOnce = true;
    recordsLoading = false;
    renderRecords();
  } catch (error) {
    recordsLoading = false;
    renderRecords();
    recordsStatus(localizedErrorMessage(error, "暂时无法读取棋谱，请稍后再试。"), true);
  }
}

/** Someone signed in or out: read the list again the next time it shows. */
function forgetLoadedRecords() {
  recordsLoadedOnce = false;
  recordsList = [];
  recordsNext = null;
  armedRemoval = null;
}

/** Show the list; read it the first time and after a game was saved. */
function showRecordsScreen() {
  if (!recordsLoadedOnce) void loadRecords();
  else renderRecords();
}

async function removeRecord(id) {
  if (armedRemoval !== id) {
    armedRemoval = id;
    renderRecords();
    return;
  }
  armedRemoval = null;
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok && response.status !== 404) {
      throw Object.assign(new Error(payload?.error ?? ""), { code: payload?.code });
    }
    recordsList = recordsList.filter((record) => record.id !== id);
    renderRecords();
    recordsStatus("已从你的棋谱中移除。");
  } catch (error) {
    renderRecords();
    recordsStatus(localizedErrorMessage(error, "暂时无法移除，请稍后再试。"), true);
  }
}

function wireRecordsScreen() {
  for (const button of elements.recordsGameButtons) {
    button.addEventListener("click", () => {
      recordsGameFilter = button.dataset.recordsGame || "all";
      armedRemoval = null;
      recordsNext = null;
      void loadRecords();
    });
  }
  elements.recordsRefresh.addEventListener("click", () => {
    armedRemoval = null;
    void loadRecords();
  });
  elements.recordsMore.addEventListener("click", () => void loadRecords({ more: true }));
  elements.recordsList.addEventListener("click", (event) => {
    const remove = event.target.closest?.("[data-record-remove]");
    if (remove) void removeRecord(remove.dataset.recordRemove);
  });
}

// --- One game (/game/<id>) -----------------------------------------------------

/** Open a saved game in the replay player (the page is on the game screen). */
async function openRecord(id) {
  setMessage("正在打开棋谱…");
  let record;
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(localizedErrorMessage({ code: payload?.code, message: payload?.error }, "暂时无法打开棋谱，请稍后再试。"), true);
      return false;
    }
    record = payload.record;
  } catch {
    setMessage("暂时无法打开棋谱，请稍后再试。", true);
    return false;
  }
  if (isReplaying()) exitReplay({ announce: false });
  const name = (color) => {
    const player = record.players?.[color] ?? {};
    return player.kind === "ai" ? translateText(player.name ?? "AI") : player.name || translateText(colorName(color));
  };
  enterReplay(record.replay, {
    imported: true,
    sourceName: translateText("我的棋谱"),
    metadata: { blackPlayer: name(BLACK), whitePlayer: name(WHITE), result: record.result ?? null },
  });
  if (!isReplaying()) return false;
  setMessage(`${name(BLACK)} 对 ${name(WHITE)} · ${recordResultText(record)} · ${record.moveCount} 手`);
  return true;
}

export {
  adoptLocalRecordKey,
  flushPendingRecords,
  forgetLoadedRecords,
  localRecordKey,
  maybeSaveFinishedLocalGame,
  openRecord,
  showRecordsScreen,
  wireRecordsScreen,
};

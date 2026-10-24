/**
 * Room chat: the message history per channel (players / spectators), the
 * composer with emoji, stickers and picked board points, and coordinate
 * references that focus the board.
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js) and keeps the chat's own
 * state here.
 */

import {
  BLACK,
} from "../game/goEngine.js";
import {
  getLocale,
  localizedErrorMessage,
  translateText,
} from "../i18n.js";
import {
  CHAT_CHANNEL_PLAYERS,
  CHAT_CHANNEL_SPECTATORS,
  CHAT_STICKERS,
  chatMessageChannel,
  chatSticker,
  formatBoardCoordinate,
} from "../multiplayer/chat.js";
import {
  CHAT_EMOJIS,
  activeBoardView,
  boardHeight,
  boardWidth,
  colorName,
  currentIdentity,
  elements,
  hasOnlineSession,
  isOnlinePlayer,
  liveDisplayedGame,
  onlineRoom,
  roomClient,
  syncReferenceFocusRotationState,
  topologySurfaceName,
  updateUI,
} from "../main.js";

let chatSending = false;
let chatPointPicking = false;
let chatReferencePoint = null;
let chatReferenceFocusViews = false;
let chatReferenceTimer = null;
let lastRenderedChatKey = "";
let chatStatusMessage = "";
let chatStatusError = false;
let chatChannelView = CHAT_CHANNEL_PLAYERS;
let chatChannelIdentityId = null;

function syncChatChannelIdentity() {
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id ?? "";
  const role = identity.role ?? "";
  if (chatChannelIdentityId !== identityId) {
    chatChannelIdentityId = identityId;
    chatChannelView = role === "spectator"
      ? CHAT_CHANNEL_SPECTATORS
      : CHAT_CHANNEL_PLAYERS;
    lastRenderedChatKey = "";
  }
  if (role !== "spectator" && chatChannelView !== CHAT_CHANNEL_PLAYERS) {
    chatChannelView = CHAT_CHANNEL_PLAYERS;
    lastRenderedChatKey = "";
  }
}

function isViewingSpectatorChat() {
  return chatChannelView === CHAT_CHANNEL_SPECTATORS;
}

function canSendCurrentChatChannel() {
  if (!roomClient.isConnected || chatSending) return false;
  const identity = currentIdentity();
  if (identity.role === "player") return chatChannelView === CHAT_CHANNEL_PLAYERS;
  return identity.role === "spectator" && chatChannelView === CHAT_CHANNEL_SPECTATORS;
}

function currentChatMessages() {
  syncChatChannelIdentity();
  return Array.isArray(onlineRoom?.chat?.messages)
    ? onlineRoom.chat.messages.filter(
        (message) => chatMessageChannel(message) === chatChannelView,
      )
    : [];
}

function messageMatchesCurrentBoard(message) {
  const displayedGame = liveDisplayedGame();
  return (
    Number(message?.boardWidth ?? message?.boardSize) === boardWidth(displayedGame) &&
    Number(message?.boardHeight ?? message?.boardSize) === boardHeight(displayedGame) &&
    message?.boardTopology === displayedGame?.topology
  );
}

function setChatStatus(message = "", error = false) {
  chatStatusMessage = message;
  chatStatusError = error;
  if (!elements.chatStatus) return;
  elements.chatStatus.textContent = message;
  elements.chatStatus.classList.toggle("error", error);
}

function defaultChatStatus() {
  if (!roomClient.isConnected) return "连接恢复后可以继续发送；当前草稿会保留。";
  if (currentIdentity().role === "spectator" && chatChannelView === CHAT_CHANNEL_PLAYERS) {
    return "只读：旁观者可以阅读对局聊天，但不能在这里发言。";
  }
  if (currentIdentity().role === "spectator") {
    return "旁观聊天只对旁观者可见，不会显示给黑白双方。";
  }
  if (!isOnlinePlayer()) return "旁观者可以阅读聊天，只有黑白双方可以发言。";
  if (chatPointPicking) return "请在棋盘上点击要引用的位置；这次点击不会落子。";
  return "文字不做内容审查；仅有技术性长度与频率限制。";
}

function focusChatPoint(
  message,
  point,
  { announce = true, moveCamera = true } = {},
) {
  const displayedGame = liveDisplayedGame();
  if (!messageMatchesCurrentBoard(message)) {
    const messageWidth = message.boardWidth ?? message.boardSize;
    const messageHeight = message.boardHeight ?? message.boardSize;
    setChatStatus(
      `📍 ${point.label} 来自上一块 ${messageWidth} × ${messageHeight} ${topologySurfaceName(message.boardTopology)}棋盘，当前不强行定位。`,
      true,
    );
    return;
  }
  if (
    !Number.isInteger(point.row) ||
    !Number.isInteger(point.col) ||
    point.row < 0 ||
    point.row >= boardHeight(displayedGame) ||
    point.col < 0 ||
    point.col >= boardWidth(displayedGame)
  ) {
    setChatStatus("这条位置引用已经失效。", true);
    return;
  }

  if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
  chatReferencePoint = { row: point.row, col: point.col };
  chatReferenceFocusViews = moveCamera;
  updateUI();
  if (moveCamera) {
    syncReferenceFocusRotationState();
    window.requestAnimationFrame(() => {
      activeBoardView()?.focusPoint?.(chatReferencePoint);
    });
  }
  if (announce) setChatStatus(`已在棋盘标出 📍 ${point.label}。`);
  chatReferenceTimer = window.setTimeout(() => {
    chatReferenceTimer = null;
    chatReferencePoint = null;
    chatReferenceFocusViews = false;
    updateUI();
  }, 8_000);
}

function renderChatMessage(message) {
  const own = message.senderId === currentIdentity().playerId;
  const article = document.createElement("article");
  article.className = `chat-message${own ? " own" : ""}`;
  article.dataset.chatId = message.id;

  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  const name = document.createElement("span");
  name.className = message.senderRole === "spectator"
    ? "spectator-name"
    : message.senderColor === BLACK ? "black-name" : "white-name";
  name.dataset.i18nIgnore = "";
  name.textContent = message.senderRole === "spectator"
    ? `${message.senderName} · ${translateText("旁观者")}`
    : `${message.senderName} · ${translateText(colorName(message.senderColor))}`;
  const time = document.createElement("time");
  time.dateTime = new Date(message.sentAt).toISOString();
  time.textContent = new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.sentAt));
  meta.append(name, time);

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  if (message.kind === "sticker") {
    bubble.classList.add("chat-sticker-bubble");
    const sticker = chatSticker(message.stickerId);
    const emoji = document.createElement("span");
    emoji.className = "sticker-emoji";
    emoji.textContent = sticker?.emoji ?? "❔";
    const label = document.createElement("span");
    label.className = "sticker-label";
    label.textContent = translateText(sticker?.label ?? "表情包");
    bubble.append(emoji, label);
  } else {
    // Deliberately use textContent: messages are uncensored text, never HTML.
    bubble.dataset.i18nIgnore = "";
    bubble.textContent = String(message.text ?? "");
  }
  article.append(meta, bubble);

  if (Array.isArray(message.points) && message.points.length > 0) {
    const pointList = document.createElement("div");
    pointList.className = "chat-point-list";
    const matchesBoard = messageMatchesCurrentBoard(message);
    for (const point of message.points) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-point-link";
      button.textContent = translateText(matchesBoard
        ? `📍 ${point.label} · 查看棋盘`
        : `📍 ${point.label} · 上一块棋盘`);
      button.disabled = !matchesBoard;
      button.addEventListener("click", () => focusChatPoint(message, point));
      pointList.append(button);
    }
    article.append(pointList);
  }
  return article;
}

function renderChatHistory() {
  const messages = currentChatMessages();
  const displayedGame = liveDisplayedGame();
  const key = [
    onlineRoom?.code ?? "",
    chatChannelView,
    boardWidth(displayedGame, ""),
    boardHeight(displayedGame, ""),
    displayedGame?.topology ?? "",
    ...messages.map((message) => `${message.id}:${message.sequence}`),
  ].join("|");
  if (key === lastRenderedChatKey) return;
  const hadRenderedHistory = lastRenderedChatKey !== "";
  const previousScrollTop = elements.chatMessages.scrollTop;
  const wasNearBottom =
    elements.chatMessages.scrollHeight -
      elements.chatMessages.scrollTop -
      elements.chatMessages.clientHeight <
    36;
  lastRenderedChatKey = key;

  elements.chatMessages.replaceChildren();
  if (messages.length === 0) {
    elements.chatMessages.append(elements.chatEmpty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const message of messages) fragment.append(renderChatMessage(message));
  elements.chatMessages.append(fragment);
  elements.chatMessages.scrollTop = !hadRenderedHistory || wasNearBottom
    ? elements.chatMessages.scrollHeight
    : previousScrollTop;
}

function syncChatUI() {
  const active = hasOnlineSession();
  syncChatChannelIdentity();
  const identity = currentIdentity();
  const spectator = active && identity.role === "spectator";
  elements.chatPanel.hidden = false;
  elements.chatForm.hidden = !active;
  elements.chatChannelTabs.hidden = !spectator;
  elements.chatChannelTitle.textContent = isViewingSpectatorChat()
    ? "旁观聊天"
    : "对局聊天";
  for (const button of elements.chatChannelButtons) {
    const activeChannel = button.dataset.chatChannel === chatChannelView;
    button.setAttribute("aria-pressed", String(activeChannel));
    button.classList.toggle("active", activeChannel);
  }
  elements.chatEmpty.textContent = active
    ? isViewingSpectatorChat()
      ? "还没有旁观者消息。"
      : "还没有对局聊天。"
    : "聊天需要进入联机房间；本地棋局的分析、棋谱、设置和复盘仍然完整可用。";
  if (!active) {
    chatPointPicking = false;
    elements.boardStage.classList.remove("chat-coordinate-picking");
    elements.chatConnection.textContent = "需要联机";
    elements.chatConnection.classList.remove("connected");
    renderChatHistory();
    return;
  }

  const connected = roomClient.isConnected;
  const canSend = canSendCurrentChatChannel();
  if (!canSend) {
    chatPointPicking = false;
    elements.boardStage.classList.remove("chat-coordinate-picking");
    closeChatPickers();
  }
  elements.chatConnection.textContent = connected ? "实时连接" : "正在重连";
  elements.chatConnection.classList.toggle("connected", connected);
  elements.chatInput.disabled = !canSend;
  elements.chatSend.disabled = !canSend || !elements.chatInput.value.trim();
  elements.chatEmoji.disabled = !canSend;
  elements.chatSticker.disabled = !canSend;
  elements.chatPoint.disabled = !canSend;
  elements.chatPoint.setAttribute("aria-pressed", String(chatPointPicking));
  if (!chatStatusMessage) {
    elements.chatStatus.textContent = defaultChatStatus();
    elements.chatStatus.classList.remove("error");
  } else {
    elements.chatStatus.textContent = chatStatusMessage;
    elements.chatStatus.classList.toggle("error", chatStatusError);
  }
  renderChatHistory();
}

function closeChatPickers() {
  elements.chatPicker.hidden = true;
  elements.stickerPicker.hidden = true;
  elements.chatEmoji.setAttribute("aria-expanded", "false");
  elements.chatSticker.setAttribute("aria-expanded", "false");
}

function toggleChatPicker(kind) {
  const emoji = kind === "emoji";
  const target = emoji ? elements.chatPicker : elements.stickerPicker;
  const willOpen = target.hidden;
  closeChatPickers();
  target.hidden = !willOpen;
  (emoji ? elements.chatEmoji : elements.chatSticker)
    .setAttribute("aria-expanded", String(willOpen));
}

function insertChatText(text) {
  const input = elements.chatInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const cursor = start + text.length;
  input.setSelectionRange(cursor, cursor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function setChatPointPicking(enabled) {
  chatPointPicking = Boolean(enabled) && canSendCurrentChatChannel();
  closeChatPickers();
  elements.boardStage.classList.toggle(
    "chat-coordinate-picking",
    chatPointPicking,
  );
  elements.chatPoint.setAttribute("aria-pressed", String(chatPointPicking));
  setChatStatus(chatPointPicking
    ? "请在棋盘上点击要引用的位置；这次点击不会落子。"
    : "");
  syncChatUI();
}

function insertPickedChatPoint(row, col) {
  const label = formatBoardCoordinate(row, col, boardHeight(), boardWidth());
  if (!label) {
    setChatStatus("没有识别到这个棋点。", true);
    return;
  }
  const prefix = elements.chatInput.value && !/\s$/u.test(elements.chatInput.value)
    ? " "
    : "";
  insertChatText(`${prefix}${label} `);
  setChatPointPicking(false);
  setChatStatus(`已引用 📍 ${label}；发送后当前频道可以点击定位。`);
}

async function sendChatPayload(payload, { clearText = false } = {}) {
  if (!canSendCurrentChatChannel()) return;
  chatSending = true;
  setChatStatus("正在发送…");
  syncChatUI();
  try {
    await roomClient.sendChat(payload);
    if (clearText) elements.chatInput.value = "";
    closeChatPickers();
    setChatStatus("");
  } catch (error) {
    setChatStatus(localizedErrorMessage(error, "消息发送失败，请稍后重试。"), true);
  } finally {
    chatSending = false;
    syncChatUI();
  }
}

function buildChatPickers() {
  elements.chatPicker.replaceChildren();
  elements.stickerPicker.replaceChildren();
  for (const emoji of CHAT_EMOJIS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.setAttribute("aria-label", translateText(`插入 ${emoji}`));
    button.addEventListener("click", () => insertChatText(emoji));
    elements.chatPicker.append(button);
  }
  for (const sticker of CHAT_STICKERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", translateText("发送表情包：{label}", {
      label: translateText(sticker.label),
    }));
    const emoji = document.createElement("span");
    emoji.textContent = sticker.emoji;
    const label = document.createElement("span");
    label.textContent = translateText(sticker.label);
    button.append(emoji, label);
    button.addEventListener("click", () => {
      void sendChatPayload({ kind: "sticker", stickerId: sticker.id });
    });
    elements.stickerPicker.append(button);
  }
}

/** Drop a chat coordinate reference and its pending focus. */
function clearChatReference() {
  if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
  chatReferenceTimer = null;
  chatReferencePoint = null;
  chatReferenceFocusViews = false;
}

/** Render the chat history afresh next time (language or channel changed). */
function forgetRenderedChat() {
  lastRenderedChatKey = "";
}

/** Spectators switch between the players' and the spectators' channel. */
function wireChatChannels() {
  for (const button of elements.chatChannelButtons) {
    button.addEventListener("click", () => {
      if (currentIdentity().role !== "spectator") return;
      const channel = button.dataset.chatChannel;
      if (![CHAT_CHANNEL_PLAYERS, CHAT_CHANNEL_SPECTATORS].includes(channel)) return;
      if (chatChannelView === channel) return;
      chatChannelView = channel;
      lastRenderedChatKey = "";
      setChatStatus("");
      setChatPointPicking(false);
      syncChatUI();
    });
  }
}

function resetChatSessionState({ clearDraft = true } = {}) {
  chatSending = false;
  chatPointPicking = false;
  chatReferencePoint = null;
  chatReferenceFocusViews = false;
  chatChannelIdentityId = null;
  chatChannelView = CHAT_CHANNEL_PLAYERS;
  lastRenderedChatKey = "";
  setChatStatus("");
  if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
  chatReferenceTimer = null;
  elements.boardStage.classList.remove("chat-coordinate-picking");
  closeChatPickers();
  if (clearDraft) elements.chatInput.value = "";
}

export {
  buildChatPickers,
  chatChannelView,
  chatPointPicking,
  chatReferenceFocusViews,
  chatReferencePoint,
  chatStatusError,
  clearChatReference,
  closeChatPickers,
  focusChatPoint,
  forgetRenderedChat,
  insertPickedChatPoint,
  messageMatchesCurrentBoard,
  resetChatSessionState,
  sendChatPayload,
  setChatPointPicking,
  setChatStatus,
  syncChatUI,
  toggleChatPicker,
  wireChatChannels,
};

import "./styles.css";
import {
  BLACK,
  WHITE,
  GoEngine,
  MOVE_ERRORS,
  PHASE_FINISHED,
  PHASE_PLAY,
  PHASE_SCORING,
  SCORING_CHINESE,
} from "./game/goEngine.js";
import { CylinderBoard } from "./view/CylinderBoard.js";
import { FlatBoard } from "./view/FlatBoard.js";
import { ArcBoard } from "./view/ArcBoard.js";
import { RoomClient, CONNECTION_STATUS } from "./multiplayer/roomClient.js";
import { sanitizeRoomCode } from "./multiplayer/protocol.js";
import { roomRevisionHasCaughtUp } from "./multiplayer/commandSync.js";
import { shouldEnableMovePreview } from "./ui/movePreviewPolicy.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  boardStage: $(".board-stage"),
  scene: $("#scene"),
  flatScene: $("#flat-scene"),
  arcScene: $("#arc-scene"),
  phaseLabel: $("#phase-label"),
  turnStone: $("#turn-stone"),
  turnText: $("#turn-text"),
  moveNumber: $("#move-number"),
  message: $("#message"),
  blackCaptures: $("#black-captures"),
  whiteCaptures: $("#white-captures"),
  playControls: $("#play-controls"),
  passButton: $("#pass-button"),
  newGameButton: $("#new-game-button"),
  scoringPanel: $("#scoring-panel"),
  blackScore: $("#black-score"),
  whiteScore: $("#white-score"),
  scoreBreakdown: $("#score-breakdown"),
  confirmScore: $("#confirm-score"),
  resumeGame: $("#resume-game"),
  boardTopology: $("#board-topology"),
  customSize: $("#custom-size"),
  scoringRule: $("#scoring-rule"),
  komi: $("#komi"),
  sizeButtons: [...document.querySelectorAll("[data-board-size]")],
  resetView: $("#reset-view"),
  toggleRotation: $("#toggle-rotation"),
  resetViewIcon: $("#reset-view-icon"),
  resetViewLabel: $("#reset-view-label"),
  gesturePrimary: $("#gesture-primary"),
  gestureSecondary: $("#gesture-secondary"),
  viewButtons: [...document.querySelectorAll("[data-view-mode]")],
  coordinateHint: $("#coordinate-hint"),
  newGameDialog: $("#new-game-dialog"),
  roomPanel: $("#room-panel"),
  roomStatusDot: $("#room-status-dot"),
  roomMode: $("#room-mode"),
  roomTitle: $("#room-title"),
  offlineOpponentActions: $("#offline-opponent-actions"),
  openAiDialog: $("#open-ai-dialog"),
  openOnlineDialog: $("#open-online-dialog"),
  roomConnected: $("#room-connected"),
  roomCode: $("#room-code"),
  localRole: $("#local-role"),
  copyRoomLink: $("#copy-room-link"),
  leaveRoom: $("#leave-room"),
  blackSeat: $("#black-seat"),
  whiteSeat: $("#white-seat"),
  roomHint: $("#room-hint"),
  aiConnected: $("#ai-connected"),
  aiOpponentName: $(".ai-opponent-name"),
  aiLevelBadge: $("#ai-level-badge"),
  aiBlackSeat: $("#ai-black-seat"),
  aiWhiteSeat: $("#ai-white-seat"),
  aiHint: $("#ai-hint"),
  changeAiSettings: $("#change-ai-settings"),
  leaveAi: $("#leave-ai"),
  aiDialog: $("#ai-dialog"),
  aiForm: $("#ai-form"),
  aiHumanColor: $("#ai-human-color"),
  cancelAi: $("#cancel-ai"),
  startAi: $("#start-ai"),
  onlineDialog: $("#online-dialog"),
  onlineForm: $("#online-form"),
  playerName: $("#player-name"),
  roomCodeInput: $("#room-code-input"),
  createRoom: $("#create-room"),
  joinRoom: $("#join-room"),
  onlineError: $("#online-error"),
  cancelOnline: $("#cancel-online"),
};

const ERROR_MESSAGES = {
  [MOVE_ERRORS.GAME_NOT_PLAYING]: "现在不能落子。",
  [MOVE_ERRORS.OUT_OF_BOUNDS]: "这个位置不在棋盘上。",
  [MOVE_ERRORS.OCCUPIED]: "这里已经有棋子了。",
  [MOVE_ERRORS.SUICIDE]: "禁入点：落子后这一块棋没有气。",
  [MOVE_ERRORS.SUPERKO]: "全局同形禁着：不能重复之前出现过的局面。",
  [MOVE_ERRORS.GAME_NOT_SCORING]: "现在还没有进入点目阶段。",
  [MOVE_ERRORS.EMPTY_POINT]: "点目时请点击棋子来标记死活。",
};

const COORDINATE_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
let game;
let cylinderView;
let flatView;
let arcView;
let activeViewMode = "arc";
const autoRotateByView = { arc: false, "3d": false };
let moveCount = 0;
let pendingSize = 19;
let lastPlayedPoint = null;
let onlineRoom = null;
let onlineBusy = false;
let onlineCommandPending = false;
let onlineCommandRevision = null;
let lastAnnouncedRoomRevision = null;
let offlineGameState = null;
let aiActive = false;
let aiHumanColor = BLACK;
let aiThinking = false;
let aiWorker = null;
let aiRequestId = 0;

const PLAYER_NAME_KEY = "bamboo-baduk-player-name";
const roomClient = new RoomClient();

const KATAGO_AI = Object.freeze({
  label: "KataGo b10",
  timeMs: 1_400,
  maxIterations: 800,
  rolloutLimit: 16,
});

function colorName(color) {
  return color === BLACK ? "黑方" : "白方";
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatResult(result) {
  if (result.winner === "draw") return "双方和棋";
  return `${colorName(result.winner)}胜 ${formatScore(result.margin)} 目`;
}

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasOnlineSession() {
  return Boolean(roomClient.session && roomClient.roomCode);
}

function isAIMode() {
  return aiActive && !hasOnlineSession();
}

function currentAIName() {
  return "KataGo 竹筒混合 AI";
}

function aiColor() {
  return aiHumanColor === BLACK ? WHITE : BLACK;
}

function isAITurn() {
  return isAIMode() && game?.phase === PHASE_PLAY && game.currentPlayer === aiColor();
}

function cancelAIThinking() {
  aiRequestId += 1;
  aiWorker?.terminate();
  aiWorker = null;
  aiThinking = false;
  elements.boardStage?.removeAttribute("aria-busy");
}

function closeAIDialog() {
  if (typeof elements.aiDialog.close === "function") elements.aiDialog.close();
  else elements.aiDialog.removeAttribute("open");
}

function showAIDialog() {
  if (hasOnlineSession()) {
    setMessage("请先退出联机房间，再开始 AI 对局。", true);
    return;
  }
  elements.aiHumanColor.value = aiHumanColor;
  elements.startAi.textContent = isAIMode() ? "按新设置重开" : "开始对局";
  if (typeof elements.aiDialog.showModal === "function") {
    if (!elements.aiDialog.open) elements.aiDialog.showModal();
  } else {
    elements.aiDialog.setAttribute("open", "");
  }
}

function applyAIMove(move, stats = {}) {
  if (!isAITurn()) return;

  let result = null;
  if (move?.type === "play") result = game.play(move.row, move.col);
  if (move?.type === "pass") result = game.pass();
  if (!result?.ok) {
    recoverFromAIError("KataGo 返回了无效落点。");
    return;
  }

  moveCount += 1;
  if (move.type === "play") {
    lastPlayedPoint = { row: move.row, col: move.col };
    const captureMessage = result.captured?.length
      ? `，提掉 ${result.captured.length} 子`
      : "";
    const neuralDetail =
      stats.engine === "katago-hybrid" && Number.isFinite(stats.inferenceMs)
        ? `（神经判断 ${Math.round(stats.inferenceMs)} ms${Number.isFinite(stats.iterations) ? ` + 搜索 ${stats.iterations} 次` : ""}）`
        : Number.isFinite(stats.iterations)
          ? `（搜索 ${stats.iterations} 次）`
          : "";
    setMessage(`${currentAIName()} 落子${captureMessage}${neuralDetail}。`);
  } else {
    lastPlayedPoint = null;
    if (result.phase === PHASE_SCORING) {
      setMessage("AI 也停一手，已进入点目。请标记死子后确认结果。");
    } else {
      setMessage(`${currentAIName()} 停一手，轮到你落子。`);
    }
  }
  updateUI();
}

function recoverFromAIError(message) {
  if (!isAITurn()) return;
  cancelAIThinking();
  aiActive = false;
  setMessage(
    `${message} 已退出 AI 对战并保留当前棋局；现在可以本地轮流落子，或开始一盘新的 KataGo 对局。`,
    true,
  );
  updateUI();
}

function handleAIWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.id !== aiRequestId) return;
  if (message.type === "status") {
    if (message.stage === "loading_model") {
      setMessage("正在首次载入 KataGo b10 神经网络 · 约 11 MB…");
    } else if (message.stage === "neural_inference") {
      setMessage(`KataGo 正在观察整盘棋 · ${message.backend ?? "浏览器"} 推理…`);
    } else if (message.stage === "searching") {
      setMessage("神经判断完成，正在按竹筒规则验证与搜索…");
    }
    return;
  }

  const keepWorker = message.type === "result";
  if (!keepWorker) {
    aiWorker?.terminate();
    aiWorker = null;
  }
  aiThinking = false;
  elements.boardStage.removeAttribute("aria-busy");
  if (message.type === "result") {
    applyAIMove(message.move, message.stats);
  } else if (message.code !== "AI_SEARCH_CANCELLED") {
    recoverFromAIError(message.message || "AI 思考时发生错误。");
  }
}

function handleAIWorkerError(event) {
  if (!aiThinking) return;
  aiWorker?.terminate();
  aiWorker = null;
  aiThinking = false;
  elements.boardStage.removeAttribute("aria-busy");
  recoverFromAIError(event.message || "AI 思考线程没有正常启动。");
}

function ensureAIWorker() {
  if (aiWorker) return aiWorker;
  const worker = new Worker(new URL("./ai/katagoWorker.js", import.meta.url), {
    type: "module",
  });
  aiWorker = worker;
  worker.addEventListener("message", handleAIWorkerMessage);
  worker.addEventListener("error", handleAIWorkerError);
  return worker;
}

function maybeStartAITurn() {
  if (!isAITurn() || aiThinking) return;

  aiThinking = true;
  elements.boardStage.setAttribute("aria-busy", "true");
  setMessage(`${currentAIName()} 正在思考…`);
  updateUI();
  const requestId = ++aiRequestId;

  window.setTimeout(() => {
    if (requestId !== aiRequestId || !isAITurn()) return;
    if (typeof Worker !== "function") {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      recoverFromAIError("当前浏览器不支持后台 AI 计算。");
      return;
    }

    let worker;
    try {
      worker = ensureAIWorker();
    } catch (error) {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      recoverFromAIError(error.message || "AI 思考线程没有正常启动。");
      return;
    }
    const level = KATAGO_AI;
    worker.postMessage({
      type: "think",
      id: requestId,
      state: game.exportState(),
      options: {
        difficulty: "hard",
        timeLimitMs: level.timeMs,
        maxIterations: level.maxIterations,
        rolloutLimit: Math.min(level.rolloutLimit, game.size * game.size * 2),
      },
    });
  }, 120);
}

async function startAIGame(event) {
  event?.preventDefault();
  if (hasOnlineSession()) {
    closeAIDialog();
    setMessage("请先退出联机房间，再开始 AI 对局。", true);
    return;
  }
  cancelAIThinking();
  aiHumanColor = elements.aiHumanColor.value === WHITE ? WHITE : BLACK;
  aiActive = true;
  closeAIDialog();
  await startNewGame();
  setMessage(
    aiHumanColor === BLACK
      ? `AI 对局已开始：你执黑，${currentAIName()} 执白。`
      : `AI 对局已开始：${currentAIName()} 执黑，正在思考第一手。`,
  );
  updateUI();
  maybeStartAITurn();
}

function leaveAIGame() {
  if (!isAIMode()) return;
  cancelAIThinking();
  aiActive = false;
  setMessage("已退出 AI 对战；当前棋局保留为普通单机棋局。可继续由双方轮流落子。");
  updateUI();
}

function currentRoomMember() {
  const playerId = roomClient.identity?.playerId ?? roomClient.session?.playerId;
  if (!playerId || !onlineRoom) return null;
  return [...(onlineRoom.players ?? []), ...(onlineRoom.spectators ?? [])].find(
    (member) => member.id === playerId,
  ) ?? null;
}

function currentIdentity() {
  return {
    ...(roomClient.identity ?? {}),
    ...(currentRoomMember() ?? {}),
  };
}

function isOnlinePlayer() {
  const identity = currentIdentity();
  return identity.role === "player" && [BLACK, WHITE].includes(identity.color);
}

function isOnlineHost() {
  return isOnlinePlayer() && currentIdentity().color === BLACK;
}

function isOnlineTurn() {
  return isOnlinePlayer() && currentIdentity().color === game.currentPlayer;
}

function canShowMovePreview() {
  if (hasOnlineSession()) {
    return shouldEnableMovePreview({
      phase: game?.phase,
      mode: "online",
      currentPlayer: game?.currentPlayer,
      localColor: isOnlinePlayer() ? currentIdentity().color : null,
      connected: roomClient.isConnected,
      roomReady:
        onlineRoom?.code === roomClient.roomCode && Boolean(onlineRoom?.game),
      bothPlayers: Boolean(roomSeat(BLACK) && roomSeat(WHITE)),
      onlineBusy,
      commandPending: onlineCommandPending,
    });
  }
  if (isAIMode()) {
    return shouldEnableMovePreview({
      phase: game?.phase,
      mode: "ai",
      currentPlayer: game?.currentPlayer,
      localColor: aiHumanColor,
      aiThinking,
    });
  }
  return shouldEnableMovePreview({
    phase: game?.phase,
    mode: "local",
    currentPlayer: game?.currentPlayer,
  });
}

function syncMovePreviewAvailability() {
  const enabled = canShowMovePreview();
  cylinderView?.setMovePreviewEnabled(enabled);
  flatView?.setMovePreviewEnabled(enabled);
  arcView?.setMovePreviewEnabled(enabled);
}

function hydratePublicGame(state) {
  const hydrated = new GoEngine({
    size: state.size,
    komi: state.komi,
    scoringRule: state.scoringRule,
    initialBoard: state.board,
    currentPlayer: state.currentPlayer,
  });
  hydrated.phase = state.phase;
  hydrated.consecutivePasses = state.consecutivePasses;
  hydrated.captures = { ...state.captures };
  hydrated.deadStones = new Set(
    (state.deadStones ?? []).map(({ row, col }) => `${row},${col}`),
  );
  hydrated.lastMove = cloneSerializable(state.lastMove);
  hydrated.result = cloneSerializable(state.result);
  return hydrated;
}

function updateRoomUrl(code = "") {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

function setOnlineBusy(busy, action = "") {
  onlineBusy = busy;
  elements.createRoom.disabled = busy;
  elements.joinRoom.disabled = busy;
  elements.createRoom.textContent = busy && action === "create" ? "正在创建…" : "创建房间";
  elements.joinRoom.textContent = busy && action === "join" ? "正在加入…" : "加入房间";
  updateRoomUI();
}

function showOnlineError(message = "") {
  elements.onlineError.textContent = message;
  elements.onlineError.hidden = !message;
}

function savedPlayerName() {
  try {
    return window.localStorage.getItem(PLAYER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberPlayerName(name) {
  try {
    window.localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // The room still works when storage is unavailable; only name recall is lost.
  }
}

function showOnlineDialog(roomCode = "") {
  elements.playerName.value = elements.playerName.value || savedPlayerName();
  if (roomCode) elements.roomCodeInput.value = sanitizeRoomCode(roomCode);
  showOnlineError();
  if (typeof elements.onlineDialog.showModal === "function") {
    if (!elements.onlineDialog.open) elements.onlineDialog.showModal();
  } else {
    elements.onlineDialog.setAttribute("open", "");
  }
  window.setTimeout(() => {
    const target = elements.playerName.value
      ? elements.roomCodeInput
      : elements.playerName;
    target.focus();
  }, 0);
}

function closeOnlineDialog() {
  if (typeof elements.onlineDialog.close === "function") elements.onlineDialog.close();
  else elements.onlineDialog.removeAttribute("open");
}

function roomSeat(color) {
  return onlineRoom?.players?.find((player) => player.color === color) ?? null;
}

function updateRoomUI() {
  const active = hasOnlineSession();
  const aiMode = isAIMode();
  const connected = roomClient.connectionStatus === CONNECTION_STATUS.CONNECTED;
  const onlineReady = active && onlineRoom?.code === roomClient.roomCode && Boolean(onlineRoom.game);
  const identity = currentIdentity();
  const scoreConfirmations = onlineRoom?.scoreConfirmations ?? [];
  const ownScoreConfirmed = scoreConfirmations.includes(identity.color);
  const hasBothPlayers = Boolean(roomSeat(BLACK) && roomSeat(WHITE));
  const connecting = [
    CONNECTION_STATUS.CREATING,
    CONNECTION_STATUS.JOINING,
    CONNECTION_STATUS.CONNECTING,
    CONNECTION_STATUS.RECONNECTING,
  ].includes(roomClient.connectionStatus);

  elements.roomStatusDot.classList.toggle("offline", !active && !aiMode);
  elements.roomStatusDot.classList.toggle(
    "connecting",
    (active && connecting) || (aiMode && aiThinking),
  );
  elements.roomStatusDot.classList.toggle(
    "connected",
    (active && connected) || (aiMode && !aiThinking),
  );
  elements.roomMode.textContent = active
    ? "在线房间"
    : aiMode
      ? "AI 对战"
      : "单机模式";
  elements.roomTitle.textContent = active
    ? "和朋友共享同一盘棋"
    : aiMode
      ? `你执${colorName(aiHumanColor).replace("方", "")} · AI 执${colorName(aiColor()).replace("方", "")}`
      : "选择电脑或朋友作为对手";
  elements.offlineOpponentActions.hidden = active || aiMode;
  elements.roomConnected.hidden = !active;
  elements.aiConnected.hidden = !aiMode;

  if (aiMode) {
    elements.aiOpponentName.textContent = currentAIName();
    elements.aiLevelBadge.textContent = KATAGO_AI.label;
    elements.aiBlackSeat.textContent = aiHumanColor === BLACK ? "你 · 黑方" : "AI · 黑方";
    elements.aiWhiteSeat.textContent = aiHumanColor === WHITE ? "你 · 白方" : "AI · 白方";
    if (aiThinking) {
      elements.aiHint.textContent = `${currentAIName()} 正在思考。你仍可旋转或切换视图。`;
    } else if (game.phase === PHASE_SCORING) {
      elements.aiHint.textContent = "点目中：请标记死子并确认结果，或恢复对局。";
    } else if (game.phase === PHASE_FINISHED) {
      elements.aiHint.textContent = "本局已经结束，可以建立新棋盘再来一局。";
    } else if (game.currentPlayer === aiHumanColor) {
      elements.aiHint.textContent = "轮到你落子。";
    } else {
      elements.aiHint.textContent = "轮到 AI，正在准备思考…";
    }
  }

  if (active) {
    const black = roomSeat(BLACK);
    const white = roomSeat(WHITE);
    const roleText = identity.color === BLACK
      ? "黑方"
      : identity.color === WHITE
        ? "白方"
        : "旁观";
    elements.roomCode.textContent = roomClient.roomCode;
    elements.localRole.textContent = roleText;
    elements.localRole.dataset.role = identity.color ?? "spectator";
    elements.blackSeat.textContent = black
      ? `${black.name}${black.online ? " · 在线" : " · 暂时离线"}`
      : "等待黑方";
    elements.whiteSeat.textContent = white
      ? `${white.name}${white.online ? " · 在线" : " · 暂时离线"}`
      : "等待白方加入";
    elements.blackSeat.parentElement.classList.toggle("connected-seat", Boolean(black?.online));
    elements.blackSeat.parentElement.classList.toggle("disconnected-seat", Boolean(black && !black.online));
    elements.whiteSeat.parentElement.classList.toggle("connected-seat", Boolean(white?.online));
    elements.whiteSeat.parentElement.classList.toggle("disconnected-seat", Boolean(white && !white.online));

    if (!connected) {
      if (roomClient.lastCloseCode === 4408) {
        elements.roomHint.textContent = "这个席位已在另一个窗口打开，本页已停止重连。";
      } else if (roomClient.connectionStatus === CONNECTION_STATUS.DISCONNECTED) {
        elements.roomHint.textContent = "多次重连仍未成功；可以稍后刷新，或忘记这个房间。";
      } else {
        elements.roomHint.textContent = connecting
          ? "正在连接房间，稍等一下…"
          : "连接已断开，正在等待恢复…";
      }
    } else if (!onlineReady) {
      elements.roomHint.textContent = "连接成功，正在同步最新棋局…";
    } else if (!isOnlinePlayer()) {
      elements.roomHint.textContent = "你正在旁观，可以旋转和切换棋盘视图。";
    } else if (!black || !white) {
      elements.roomHint.textContent = "把邀请链接发给朋友，白方加入后即可对弈。";
    } else if (game.phase === PHASE_SCORING) {
      if (ownScoreConfirmed) {
        elements.roomHint.textContent = "你已确认当前点目，正在等待对方确认。";
      } else if (scoreConfirmations.length > 0) {
        elements.roomHint.textContent = `${colorName(scoreConfirmations[0])}已确认；请核对后确认，或继续修改死子。`;
      } else {
        elements.roomHint.textContent = "点目中：双方可以标记死子，结果需双方确认。";
      }
    } else if (game.phase === PHASE_FINISHED) {
      elements.roomHint.textContent = isOnlineHost()
        ? "本局已结束；黑方可以建立新棋盘。"
        : "本局已结束，等待黑方建立新棋盘。";
    } else {
      elements.roomHint.textContent = isOnlineTurn()
        ? "轮到你了。"
        : `等待${colorName(game.currentPlayer)}落子。`;
    }
  }

  const onlineControlsAvailable = onlineReady && connected && !onlineBusy && !onlineCommandPending;
  const canAbandonRoom = roomClient.connectionStatus === CONNECTION_STATUS.DISCONNECTED;
  const canDetachReplaced = roomClient.lastCloseCode === 4408;
  elements.copyRoomLink.disabled = !onlineControlsAvailable;
  elements.leaveRoom.disabled = active && (
    onlineBusy || (!connected && !canAbandonRoom && !canDetachReplaced)
  );
  elements.leaveRoom.textContent = canDetachReplaced
    ? "关闭本页联机"
    : canAbandonRoom
      ? "忘记房间"
      : "退出";
  elements.passButton.disabled = active
    ? !(
        onlineControlsAvailable && hasBothPlayers && isOnlineTurn() && game.phase === PHASE_PLAY
      )
    : aiMode && (
        aiThinking || game.phase !== PHASE_PLAY || game.currentPlayer !== aiHumanColor
      );
  elements.newGameButton.disabled = active && !(onlineControlsAvailable && isOnlineHost());
  elements.confirmScore.disabled = active && !(
    onlineControlsAvailable && isOnlinePlayer() && !ownScoreConfirmed
  );
  elements.resumeGame.disabled = active && !(onlineControlsAvailable && isOnlinePlayer());
  elements.confirmScore.textContent = active && ownScoreConfirmed
    ? "已确认，等待对方"
    : active && scoreConfirmations.length > 0
      ? "确认同意结果"
      : "确认结果";

  const canChangeOnlineSettings = active
    ? onlineControlsAvailable && isOnlineHost()
    : !aiThinking;
  elements.customSize.disabled = !canChangeOnlineSettings;
  elements.scoringRule.disabled = !canChangeOnlineSettings;
  elements.komi.disabled = !canChangeOnlineSettings;
  for (const button of elements.sizeButtons) button.disabled = !canChangeOnlineSettings;
  syncMovePreviewAvailability();
}

function rememberOfflineGame() {
  if (hasOnlineSession() || !game) return;
  offlineGameState = {
    game: game.exportState(),
    moveCount,
    lastPlayedPoint: cloneSerializable(lastPlayedPoint),
    ai: {
      active: isAIMode(),
      humanColor: aiHumanColor,
    },
  };
}

function restoreOfflineGame() {
  if (!offlineGameState) return;
  cancelAIThinking();
  const previousSize = game?.size;
  game = GoEngine.fromState(offlineGameState.game);
  moveCount = offlineGameState.moveCount;
  lastPlayedPoint = offlineGameState.lastPlayedPoint;
  aiActive = Boolean(offlineGameState.ai?.active);
  aiHumanColor = offlineGameState.ai?.humanColor === WHITE ? WHITE : BLACK;
  if (previousSize !== game.size) {
    cylinderView?.rebuild(game.size);
    flatView?.rebuild(game.size);
    arcView?.rebuild(game.size);
  }
  setPendingSize(game.size);
  elements.scoringRule.value = game.scoringRule;
  elements.komi.value = String(game.komi);
  offlineGameState = null;
}

function announceRoomState(room, previousRoom) {
  if (room.revision === lastAnnouncedRoomRevision) return;
  lastAnnouncedRoomRevision = room.revision;
  const lastMove = room.game.lastMove;
  const previousPhase = previousRoom?.game?.phase;
  const deadStonesChanged = Boolean(previousRoom) &&
    JSON.stringify(previousRoom.game.deadStones) !== JSON.stringify(room.game.deadStones);
  const confirmationsChanged = Boolean(previousRoom) &&
    JSON.stringify(previousRoom.scoreConfirmations ?? []) !==
      JSON.stringify(room.scoreConfirmations ?? []);
  const gameChanged = !previousRoom || [
    previousRoom.moveCount !== room.moveCount,
    previousRoom.game.size !== room.game.size,
    previousRoom.game.komi !== room.game.komi,
    previousRoom.game.scoringRule !== room.game.scoringRule,
    previousRoom.game.phase !== room.game.phase,
    previousRoom.game.consecutivePasses !== room.game.consecutivePasses,
    JSON.stringify(previousRoom.game.lastMove) !== JSON.stringify(room.game.lastMove),
    deadStonesChanged,
    JSON.stringify(previousRoom.game.result) !== JSON.stringify(room.game.result),
    confirmationsChanged,
  ].some(Boolean);
  if (!gameChanged) return;
  if (!previousRoom) {
    setMessage(`已进入房间 ${room.code}。`);
  } else if (previousPhase === PHASE_SCORING && room.game.phase === PHASE_FINISHED) {
    setMessage(`点目完成：${formatResult(room.game.result)}。`);
  } else if (previousPhase === PHASE_SCORING && room.game.phase === PHASE_PLAY) {
    setMessage("已恢复对局，可以继续处理有争议的死活。");
  } else if (previousPhase === PHASE_SCORING && room.game.phase === PHASE_SCORING) {
    if (deadStonesChanged) {
      setMessage(confirmationsChanged
        ? "死子标记已同步，之前的确认已重置。"
        : "死子标记与点目结果已同步。");
    } else if (confirmationsChanged) {
      const newlyConfirmed = (room.scoreConfirmations ?? []).find(
        (color) => !(previousRoom.scoreConfirmations ?? []).includes(color),
      );
      setMessage(newlyConfirmed
        ? `${colorName(newlyConfirmed)}已确认当前点目，等待另一方。`
        : "点目确认已重置，请双方重新确认。");
    }
  } else if (lastMove?.type === "play") {
    const captured = lastMove.captured?.length
      ? `，提掉 ${lastMove.captured.length} 子`
      : "";
    setMessage(`${colorName(lastMove.color)}落子${captured}。`);
  } else if (lastMove?.type === "pass") {
    if (room.game.phase === PHASE_SCORING) {
      setMessage("双方连续停一手，已进入点目。请标记双方死子。");
    } else {
      setMessage(`${colorName(lastMove.color)}停一手。`);
    }
  } else if (room.moveCount === 0) {
    setMessage(`${room.game.size} 路在线棋盘已准备好，黑方先行。`);
  }
}

function applyOnlineRoom(room) {
  if (!room?.game) return;
  if (
    onlineRoom?.code === room.code &&
    Number.isFinite(onlineRoom.revision) &&
    Number.isFinite(room.revision) &&
    room.revision < onlineRoom.revision
  ) {
    return;
  }

  const previousRoom = onlineRoom;
  const previousSize = game?.size;
  onlineRoom = room;
  if (
    onlineCommandPending &&
    Number.isFinite(onlineCommandRevision) &&
    roomRevisionHasCaughtUp(room.revision, onlineCommandRevision)
  ) {
    onlineCommandPending = false;
    onlineCommandRevision = null;
  }
  game = hydratePublicGame(room.game);
  moveCount = Number.isSafeInteger(room.moveCount) ? room.moveCount : 0;
  lastPlayedPoint = game.lastMove?.type === "play"
    ? { row: game.lastMove.row, col: game.lastMove.col }
    : null;

  if (previousSize !== game.size) {
    cylinderView?.rebuild(game.size);
    flatView?.rebuild(game.size);
    arcView?.rebuild(game.size);
  }
  setPendingSize(game.size);
  elements.scoringRule.value = game.scoringRule;
  elements.komi.value = String(game.komi);
  announceRoomState(room, previousRoom);
  updateUI();
}

async function sendOnlineCommand(action, payload = {}) {
  if (!hasOnlineSession()) {
    setMessage("请先创建或加入一个联机房间。", true);
    return false;
  }
  if (!roomClient.isConnected) {
    setMessage("房间正在重连，请连接恢复后再操作。", true);
    return false;
  }
  if (onlineRoom?.code !== roomClient.roomCode || !onlineRoom?.game) {
    setMessage("正在同步房间棋局，请稍等一下。", true);
    return false;
  }
  if (onlineCommandPending) return false;
  onlineCommandPending = true;
  onlineCommandRevision = null;
  updateRoomUI();
  try {
    const acknowledgement = await roomClient.command(action, payload);
    const acknowledgedRevision = Number(acknowledgement?.revision);
    if (!roomRevisionHasCaughtUp(onlineRoom?.revision, acknowledgedRevision)) {
      onlineCommandRevision = acknowledgedRevision;
    } else {
      onlineCommandPending = false;
      onlineCommandRevision = null;
    }
    updateRoomUI();
    return true;
  } catch (error) {
    onlineCommandPending = false;
    onlineCommandRevision = null;
    setMessage(error.message || "房间拒绝了这个操作。", true);
    updateRoomUI();
    return false;
  }
}

function setPendingSize(size) {
  pendingSize = Math.max(5, Math.min(25, Math.round(size)));
  elements.customSize.value = String(pendingSize);
  for (const button of elements.sizeButtons) {
    const active = Number(button.dataset.boardSize) === pendingSize;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function getNewGameOptions() {
  const size = Math.max(5, Math.min(25, Math.round(Number(elements.customSize.value) || 19)));
  setPendingSize(size);
  return {
    size,
    scoringRule: elements.scoringRule.value,
    komi: Number(elements.komi.value) || 0,
  };
}

async function startNewGame() {
  const options = getNewGameOptions();
  if (hasOnlineSession()) {
    if (!isOnlineHost()) {
      setMessage("联机房间中只有黑方可以建立新棋盘。", true);
      return;
    }
    setMessage("正在为房间建立新棋盘…");
    await sendOnlineCommand("new_game", options);
    return;
  }
  cancelAIThinking();
  game = new GoEngine(options);
  moveCount = 0;
  lastPlayedPoint = null;
  elements.coordinateHint.textContent = "";
  cylinderView?.rebuild(options.size);
  flatView?.rebuild(options.size);
  arcView?.rebuild(options.size);
  setMessage(`${options.size} 路筒面棋盘已准备好，黑方先行。`);
  updateUI();
  maybeStartAITurn();
}

function hasProgress() {
  return moveCount > 0 || game.board.some((row) => row.some(Boolean));
}

function requestNewGame() {
  if (hasOnlineSession() && !isOnlineHost()) {
    setMessage("联机房间中只有黑方可以建立新棋盘。", true);
    return;
  }
  if (!hasProgress()) {
    void startNewGame();
    return;
  }
  if (typeof elements.newGameDialog.showModal === "function") {
    elements.newGameDialog.showModal();
  } else if (window.confirm("建立新棋盘并清除当前对局？")) {
    void startNewGame();
  }
}

function scoreBreakdown(score) {
  if (score.rule === SCORING_CHINESE) {
    return `黑：活子 ${score.stones.black} ＋ 地 ${score.territory.black}；白：活子 ${score.stones.white} ＋ 地 ${score.territory.white} ＋ 贴目 ${formatScore(score.komi)}；公气 ${score.neutral}`;
  }
  return `黑：地 ${score.territory.black} ＋ 提子 ${score.captures.black} ＋ 死子 ${score.dead.white}；白：地 ${score.territory.white} ＋ 提子 ${score.captures.white} ＋ 死子 ${score.dead.black} ＋ 贴目 ${formatScore(score.komi)}；公气 ${score.neutral}`;
}

function updateScoreUI(score) {
  elements.blackScore.textContent = formatScore(score.black);
  elements.whiteScore.textContent = formatScore(score.white);
  elements.scoreBreakdown.textContent = scoreBreakdown(score);
}

function updateUI() {
  const state = game.getState();
  const renderLastMove = lastPlayedPoint
    ? { type: "play", ...lastPlayedPoint }
    : state.lastMove;
  const viewState = { ...state, lastMove: renderLastMove };
  cylinderView?.setPosition(viewState);
  flatView?.setPosition(viewState);
  arcView?.setPosition(viewState);

  elements.blackCaptures.textContent = String(state.captures.black);
  elements.whiteCaptures.textContent = String(state.captures.white);
  elements.boardTopology.textContent = `${state.size} 路 · ${state.size * state.size} 点 · 筒面`;
  elements.moveNumber.textContent = `第 ${moveCount + 1} 手`;
  elements.turnStone.classList.toggle("black", state.currentPlayer === BLACK);
  elements.turnStone.classList.toggle("white", state.currentPlayer === WHITE);

  const playing = state.phase === PHASE_PLAY;
  elements.passButton.hidden = !playing;
  elements.playControls.hidden = false;
  elements.playControls.classList.toggle("single", !playing);
  elements.scoringPanel.hidden = playing;
  elements.confirmScore.hidden = state.phase === PHASE_FINISHED;
  elements.resumeGame.hidden = state.phase === PHASE_FINISHED;
  updateRoomUI();

  if (state.phase === PHASE_PLAY) {
    elements.phaseLabel.textContent = state.consecutivePasses
      ? "一方已停着"
      : isAIMode()
        ? "AI 对战"
        : "对局中";
    elements.turnStone.hidden = false;
    elements.turnText.textContent = isAIMode()
      ? aiThinking
        ? "AI 正在思考"
        : state.currentPlayer === aiHumanColor
          ? "轮到你落子"
          : "AI 准备落子"
      : `${colorName(state.currentPlayer)}落子`;
    return;
  }

  const score = state.result || game.score();
  updateScoreUI(score);
  elements.turnStone.hidden = true;

  if (state.phase === PHASE_SCORING) {
    elements.phaseLabel.textContent = "点目阶段";
    elements.turnText.textContent = "确认死子与领地";
    elements.moveNumber.textContent = "双方已停着";
  } else {
    elements.phaseLabel.textContent = "对局结束";
    elements.turnText.textContent = formatResult(score);
    elements.moveNumber.textContent = `${state.size} 路筒面`;
  }
}

function handleBoardPoint({ row, col }) {
  if (hasOnlineSession()) {
    if (!roomClient.isConnected) {
      setMessage("房间正在重连，请稍等一下。", true);
      return;
    }
    if (!isOnlinePlayer()) {
      setMessage("旁观者不能操作棋局。", true);
      return;
    }
    if (onlineCommandPending) return;
    if (game.phase === PHASE_PLAY) {
      if (!roomSeat(BLACK) || !roomSeat(WHITE)) {
        setMessage("请等待朋友加入白方座位后再开始对局。", true);
        return;
      }
      if (!isOnlineTurn()) {
        setMessage("还没有轮到你落子。", true);
        return;
      }
      void sendOnlineCommand("play", { row, col });
      return;
    }
    if (game.phase === PHASE_SCORING) {
      void sendOnlineCommand("toggle_dead", { row, col });
    }
    return;
  }

  if (
    isAIMode() &&
    game.phase === PHASE_PLAY &&
    (aiThinking || game.currentPlayer !== aiHumanColor)
  ) {
    setMessage(`现在轮到 ${currentAIName()} 思考；你仍然可以旋转和切换棋盘视图。`, true);
    return;
  }

  if (game.phase === PHASE_PLAY) {
    const result = game.play(row, col);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.reason] || "这一手不能下。", true);
      return;
    }
    moveCount += 1;
    lastPlayedPoint = { row, col };
    const captureMessage = result.captured.length
      ? `，提掉 ${result.captured.length} 子`
      : "";
    setMessage(`${colorName(result.color)}落子${captureMessage}。`);
    updateUI();
    maybeStartAITurn();
    return;
  }

  if (game.phase === PHASE_SCORING) {
    const result = game.toggleDead(row, col);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.reason] || "这里不能标记。", true);
      return;
    }
    setMessage(
      `${colorName(result.color)}这块棋已${result.dead ? "标为死子" : "恢复为活棋"}。`,
    );
    updateUI();
  }
}

function handleHover(point) {
  if (!point) {
    elements.coordinateHint.textContent = "";
    return;
  }
  const letter = COORDINATE_LETTERS[point.col] || String(point.col + 1);
  const coordinate = `${letter}${game.size - point.row}`;
  const seamNote = point.col === 0 || point.col === game.size - 1 ? " · A列与末列相邻" : "";
  elements.coordinateHint.textContent = `${coordinate}${seamNote}`;
}

elements.passButton.addEventListener("click", () => {
  if (hasOnlineSession()) {
    if (!isOnlineTurn()) {
      setMessage("还没有轮到你停一手。", true);
      return;
    }
    void sendOnlineCommand("pass");
    return;
  }
  if (isAIMode() && (aiThinking || game.currentPlayer !== aiHumanColor)) {
    setMessage(`现在轮到 ${currentAIName()}，不能替它停一手。`, true);
    return;
  }
  const result = game.pass();
  if (!result.ok) return;
  moveCount += 1;
  if (result.phase === PHASE_SCORING) {
    setMessage("双方连续停一手，已进入点目。请先标记双方死子。");
  } else {
    setMessage(`${colorName(result.color)}停一手，轮到${colorName(result.nextPlayer)}。`);
  }
  updateUI();
  maybeStartAITurn();
});

elements.confirmScore.addEventListener("click", () => {
  if (hasOnlineSession()) {
    void sendOnlineCommand("finish_scoring");
    return;
  }
  const result = game.finishScoring();
  if (!result.ok) return;
  setMessage(`点目完成：${formatResult(result)}。`);
  updateUI();
});

elements.resumeGame.addEventListener("click", () => {
  if (hasOnlineSession()) {
    void sendOnlineCommand("resume_play");
    return;
  }
  const result = game.resumePlay();
  if (!result.ok) return;
  setMessage("已恢复对局，可以继续处理有争议的死活。",
  );
  updateUI();
  maybeStartAITurn();
});

elements.newGameButton.addEventListener("click", requestNewGame);

for (const button of elements.sizeButtons) {
  button.addEventListener("click", () => {
    setPendingSize(Number(button.dataset.boardSize));
    requestNewGame();
  });
}

elements.customSize.addEventListener("change", () => {
  const raw = Number(elements.customSize.value);
  setPendingSize(Number.isFinite(raw) ? raw : 19);
  setMessage(`已选择 ${pendingSize} 路；点击“新棋盘”后生效。`);
});

elements.customSize.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.customSize.blur();
    requestNewGame();
  }
});

elements.newGameDialog.addEventListener("close", () => {
  if (elements.newGameDialog.returnValue === "confirm") void startNewGame();
  else setPendingSize(game.size);
});

function setViewMode(mode) {
  activeViewMode = ["flat", "arc", "3d"].includes(mode) ? mode : "arc";
  const flatActive = activeViewMode === "flat";
  const arcActive = activeViewMode === "arc";
  const cylinderActive = activeViewMode === "3d";
  elements.boardStage.dataset.viewMode = activeViewMode;
  elements.flatScene.hidden = !flatActive;
  elements.arcScene.hidden = !arcActive;
  elements.scene.hidden = !cylinderActive;
  flatView?.setActive(flatActive);
  arcView?.setActive(arcActive);
  cylinderView?.setActive(cylinderActive);

  for (const button of elements.viewButtons) {
    const active = button.dataset.viewMode === activeViewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const viewCopy = {
    flat: {
      resetIcon: "↤",
      resetLabel: "重置展开",
      primaryGesture: "横向拖动",
      secondaryGesture: "改变展开起点",
    },
    arc: {
      resetIcon: "↤",
      resetLabel: "重置弧面",
      primaryGesture: "横向拖动",
      secondaryGesture: "弧面循环 · 滚轮缩放",
    },
    "3d": {
      resetIcon: "◎",
      resetLabel: "回正视角",
      primaryGesture: "拖动旋转",
      secondaryGesture: "滚轮缩放",
    },
  }[activeViewMode];

  elements.toggleRotation.hidden = flatActive;
  elements.toggleRotation.setAttribute(
    "aria-pressed",
    String(autoRotateByView[activeViewMode] ?? false),
  );
  elements.resetViewIcon.textContent = viewCopy.resetIcon;
  elements.resetViewLabel.textContent = viewCopy.resetLabel;
  elements.resetView.setAttribute("aria-label", viewCopy.resetLabel);
  elements.gesturePrimary.textContent = viewCopy.primaryGesture;
  elements.gestureSecondary.textContent = viewCopy.secondaryGesture;
  elements.coordinateHint.textContent = "";
}

for (const button of elements.viewButtons) {
  button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
}

elements.resetView.addEventListener("click", () => {
  if (activeViewMode === "flat") flatView.resetView();
  else if (activeViewMode === "arc") arcView.resetView();
  else cylinderView.resetView();
});
elements.toggleRotation.addEventListener("click", () => {
  if (activeViewMode === "flat") return;
  const active = !autoRotateByView[activeViewMode];
  autoRotateByView[activeViewMode] = active;
  elements.toggleRotation.setAttribute("aria-pressed", String(active));
  if (activeViewMode === "arc") arcView.setAutoRotate(active);
  else cylinderView.setAutoRotate(active);
});

function normalizedPlayerName() {
  return elements.playerName.value.replace(/\s+/g, " ").trim().slice(0, 20);
}

async function createOnlineRoom() {
  const name = normalizedPlayerName();
  if (!name) {
    showOnlineError("请先填写你的名字。");
    elements.playerName.focus();
    return;
  }
  rememberOfflineGame();
  cancelAIThinking();
  aiActive = false;
  rememberPlayerName(name);
  showOnlineError();
  setOnlineBusy(true, "create");
  try {
    const result = await roomClient.createRoom({ name, ...getNewGameOptions() });
    updateRoomUrl(result.roomCode);
    closeOnlineDialog();
    setMessage(`房间 ${result.roomCode} 已创建，把邀请链接发给朋友吧。`);
  } catch (error) {
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
    showOnlineError(error.message || "创建房间失败，请稍后重试。");
  } finally {
    setOnlineBusy(false);
  }
}

async function joinOnlineRoom() {
  const name = normalizedPlayerName();
  const code = sanitizeRoomCode(elements.roomCodeInput.value);
  if (!name) {
    showOnlineError("请先填写你的名字。");
    elements.playerName.focus();
    return;
  }
  if (code.length !== 6) {
    showOnlineError("请输入六位房间号。");
    elements.roomCodeInput.focus();
    return;
  }
  rememberOfflineGame();
  cancelAIThinking();
  aiActive = false;
  rememberPlayerName(name);
  showOnlineError();
  setOnlineBusy(true, "join");
  try {
    const result = await roomClient.joinRoom({ code, name, role: "player" });
    updateRoomUrl(result.roomCode);
    closeOnlineDialog();
    const identity = result.session ?? roomClient.identity;
    const role = identity?.color === BLACK
      ? "黑方"
      : identity?.color === WHITE
        ? "白方"
        : "旁观者";
    setMessage(`已加入房间 ${result.roomCode}，你是${role}。`);
  } catch (error) {
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
    showOnlineError(error.message || "加入房间失败，请检查房间号。");
  } finally {
    setOnlineBusy(false);
  }
}

async function copyInvitationLink() {
  const link = roomClient.getShareUrl();
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(link);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = link;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      setMessage(`邀请链接：${link}`, true);
      return;
    }
  }
  setMessage("邀请链接已复制，可以发给朋友了。");
}

function returnToOffline(message) {
  onlineRoom = null;
  onlineCommandPending = false;
  onlineCommandRevision = null;
  lastAnnouncedRoomRevision = null;
  updateRoomUrl();
  restoreOfflineGame();
  setMessage(message);
  updateUI();
  maybeStartAITurn();
}

async function leaveOnlineRoom() {
  if (!hasOnlineSession() || onlineBusy) return;
  if (!roomClient.isConnected) {
    if (roomClient.lastCloseCode === 4408) {
      roomClient.detachRoom();
      returnToOffline("本页已退出联机；另一个窗口中的对局不受影响。");
      return;
    }
    if (roomClient.connectionStatus !== CONNECTION_STATUS.DISCONNECTED) {
      setMessage("房间正在重连；连接恢复后才能安全释放座位。", true);
      return;
    }
    const abandon = window.confirm(
      "当前无法通知服务器释放座位。忘记房间只会清除本机凭据，原座位可能继续保留。确定继续吗？",
    );
    if (!abandon) return;
    roomClient.abandonRoom();
    returnToOffline("已停止重连并忘记这个房间。");
    return;
  }
  const confirmed = window.confirm("退出房间会释放你的座位，确定退出吗？");
  if (!confirmed) return;
  setOnlineBusy(true);
  try {
    await roomClient.leave();
    setOnlineBusy(false);
    returnToOffline("已退出联机房间，回到之前的单机棋盘。");
  } catch (error) {
    setOnlineBusy(false);
    setMessage(
      error.message || "没有收到服务器的退出确认，座位仍然保留，请重试。",
      true,
    );
    updateRoomUI();
  }
}

elements.openAiDialog.addEventListener("click", showAIDialog);
elements.changeAiSettings.addEventListener("click", showAIDialog);
elements.cancelAi.addEventListener("click", closeAIDialog);
elements.leaveAi.addEventListener("click", leaveAIGame);
elements.aiForm.addEventListener("submit", (event) => void startAIGame(event));
elements.openOnlineDialog.addEventListener("click", () => showOnlineDialog());
elements.cancelOnline.addEventListener("click", closeOnlineDialog);
elements.onlineForm.addEventListener("submit", (event) => event.preventDefault());
elements.createRoom.addEventListener("click", () => void createOnlineRoom());
elements.joinRoom.addEventListener("click", () => void joinOnlineRoom());
elements.copyRoomLink.addEventListener("click", () => void copyInvitationLink());
elements.leaveRoom.addEventListener("click", () => void leaveOnlineRoom());
elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = sanitizeRoomCode(elements.roomCodeInput.value);
  showOnlineError();
});
elements.onlineForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || onlineBusy) return;
  event.preventDefault();
  if (sanitizeRoomCode(elements.roomCodeInput.value).length === 6) {
    void joinOnlineRoom();
  } else {
    void createOnlineRoom();
  }
});

roomClient.on("connection", (event) => {
  if (event.terminal && [4401, 4404].includes(event.code) && !hasOnlineSession()) {
    returnToOffline(event.code === 4404
      ? "房间已因长时间无活动而关闭。"
      : "房间身份已经失效，请重新加入。");
    return;
  }
  updateRoomUI();
});
roomClient.on("state", ({ room }) => applyOnlineRoom(room));
roomClient.on("presence", ({ presence }) => {
  if (!onlineRoom) return;
  onlineRoom = {
    ...onlineRoom,
    players: presence.players ?? onlineRoom.players,
    spectators: presence.spectators ?? onlineRoom.spectators,
  };
  updateRoomUI();
});
roomClient.on("error", (error) => {
  if (elements.onlineDialog.open) showOnlineError(error.message);
  if (!["SOCKET_ERROR", "COMMAND_SEND_ERROR"].includes(error.code)) {
    setMessage(error.message, true);
  }
  updateRoomUI();
});

setPendingSize(19);
game = new GoEngine({ size: 19, komi: 7.5, scoringRule: SCORING_CHINESE });
cylinderView = new CylinderBoard(elements.scene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
flatView = new FlatBoard(elements.flatScene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
arcView = new ArcBoard(elements.arcScene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
setViewMode("arc");
updateUI();
rememberOfflineGame();

const sharedRoomCode = sanitizeRoomCode(
  new URL(window.location.href).searchParams.get("room"),
);
if (sharedRoomCode.length === 6) {
  elements.roomCodeInput.value = sharedRoomCode;
  if (roomClient.resumeRoom(sharedRoomCode)) {
    updateRoomUrl(sharedRoomCode);
    setMessage(`正在恢复房间 ${sharedRoomCode}…`);
    updateRoomUI();
  } else {
    showOnlineDialog(sharedRoomCode);
  }
}

window.addEventListener(
  "beforeunload",
  () => {
    cancelAIThinking();
    cylinderView.destroy();
    flatView.destroy();
    arcView.destroy();
    roomClient.destroy();
  },
  { once: true },
);

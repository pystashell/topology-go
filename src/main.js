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
  TOPOLOGY_CYLINDER,
  TOPOLOGY_TORUS,
} from "./game/goEngine.js";
import {
  buildReplayFrames,
  buildReplayStateAtStep,
} from "./game/replay.js";
import {
  candidateVisitShare,
  compareReviewMove,
  topReviewCandidates,
} from "./ai/replayReview.js";
import { CylinderBoard } from "./view/CylinderBoard.js";
import { FlatBoard } from "./view/FlatBoard.js";
import { ArcBoard } from "./view/ArcBoard.js";
import { TorusBoard } from "./view/TorusBoard.js";
import { RoomClient, CONNECTION_STATUS } from "./multiplayer/roomClient.js";
import { sanitizeRoomCode } from "./multiplayer/protocol.js";
import { roomRevisionHasCaughtUp } from "./multiplayer/commandSync.js";
import { shouldEnableMovePreview } from "./ui/movePreviewPolicy.js";
import { createGameSounds } from "./audio/gameSounds.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  boardStage: $(".board-stage"),
  scene: $("#scene"),
  torusScene: $("#torus-scene"),
  flatScene: $("#flat-scene"),
  arcScene: $("#arc-scene"),
  toggleSound: $("#toggle-sound"),
  soundIcon: $("#sound-icon"),
  soundLabel: $("#sound-label"),
  phaseLabel: $("#phase-label"),
  turnStone: $("#turn-stone"),
  turnText: $("#turn-text"),
  moveNumber: $("#move-number"),
  message: $("#message"),
  blackCaptures: $("#black-captures"),
  whiteCaptures: $("#white-captures"),
  playControls: $("#play-controls"),
  passButton: $("#pass-button"),
  undoButton: $("#undo-button"),
  newGameButton: $("#new-game-button"),
  replayButton: $("#replay-button"),
  replayPanel: $("#replay-panel"),
  replayProgress: $("#replay-progress"),
  replaySlider: $("#replay-slider"),
  replayFirst: $("#replay-first"),
  replayPrev: $("#replay-prev"),
  replayPlay: $("#replay-play"),
  replayNext: $("#replay-next"),
  replayLast: $("#replay-last"),
  replaySpeed: $("#replay-speed"),
  replayExit: $("#replay-exit"),
  aiReviewStatus: $("#ai-review-status"),
  aiReviewCurrent: $("#ai-review-current"),
  aiReviewAll: $("#ai-review-all"),
  aiReviewCancel: $("#ai-review-cancel"),
  aiReviewResult: $("#ai-review-result"),
  aiReviewMove: $("#ai-review-move"),
  aiReviewComparison: $("#ai-review-comparison"),
  aiReviewCandidates: $("#ai-review-candidates"),
  undoRequestPanel: $("#undo-request-panel"),
  undoRequestText: $("#undo-request-text"),
  undoResponseActions: $("#undo-response-actions"),
  approveUndo: $("#approve-undo"),
  declineUndo: $("#decline-undo"),
  cancelUndoRequest: $("#cancel-undo-request"),
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
  topologyButtons: [...document.querySelectorAll("[data-board-topology]")],
  resetView: $("#reset-view"),
  toggleRotation: $("#toggle-rotation"),
  resetViewIcon: $("#reset-view-icon"),
  resetViewLabel: $("#reset-view-label"),
  gesturePrimary: $("#gesture-primary"),
  gestureSecondary: $("#gesture-secondary"),
  viewButtons: [...document.querySelectorAll("[data-view-mode]")],
  arcViewButton: $("#arc-view-button"),
  threeDViewLabel: $("#three-d-view-label"),
  rulesSummary: $("#rules-summary"),
  cylinderRules: $("#cylinder-rules"),
  torusRules: $("#torus-rules"),
  coordinateHint: $("#coordinate-hint"),
  newGameDialog: $("#new-game-dialog"),
  newGameSummary: $("#new-game-summary"),
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
  [MOVE_ERRORS.NOTHING_TO_UNDO]: "现在没有可以撤回的棋步。",
};

const COORDINATE_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
let game;
let cylinderView;
let torusView;
let flatView;
let arcView;
let activeViewMode = "arc";
const autoRotateByView = { arc: false, "3d": false };
let moveCount = 0;
let pendingSize = 19;
let pendingTopology = TOPOLOGY_CYLINDER;
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
let replaySession = null;
let replayTimer = null;
let reviewWorker = null;
let reviewRequestId = 0;
let reviewActive = null;

const PLAYER_NAME_KEY = "bamboo-baduk-player-name";
const SOUND_ENABLED_KEY = "3d-baduk-sound-enabled";
const roomClient = new RoomClient();

function savedSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

let soundEnabled = savedSoundEnabled();
const gameSounds = createGameSounds({ enabled: soundEnabled });

const KATAGO_AI = Object.freeze({
  label: "KataGo b10",
  timeMs: 1_400,
  maxIterations: 800,
  rolloutLimit: 16,
});

const REPLAY_INTERVAL_MS = 900;
const AI_REVIEW_CURRENT = Object.freeze({
  timeMs: 1_200,
  maxIterations: 700,
  rolloutLimit: 14,
});
const AI_REVIEW_BATCH = Object.freeze({
  timeMs: 280,
  maxIterations: 180,
  rolloutLimit: 7,
});

function colorName(color) {
  return color === BLACK ? "黑方" : "白方";
}

function isTorusTopology(topology = game?.topology) {
  return topology === TOPOLOGY_TORUS;
}

function topologyName(topology = game?.topology) {
  return isTorusTopology(topology) ? "甜甜圈" : "竹筒";
}

function topologySurfaceName(topology = game?.topology) {
  return isTorusTopology(topology) ? "甜甜圈" : "竹筒";
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

function syncSoundControl() {
  elements.toggleSound.setAttribute("aria-pressed", String(soundEnabled));
  elements.toggleSound.setAttribute("aria-label", soundEnabled ? "关闭音效" : "开启音效");
  elements.soundIcon.textContent = soundEnabled ? "♪" : "×";
  elements.soundLabel.textContent = soundEnabled ? "音效开" : "音效关";
}

function rememberSoundEnabled() {
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled));
  } catch {
    // Sound remains usable for this tab when storage is unavailable.
  }
}

function playMoveSounds(capturedCount = 0) {
  void gameSounds.playStone();
  if (capturedCount > 0) {
    window.setTimeout(() => void gameSounds.playCapture(capturedCount), 58);
  }
}

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isReplaying() {
  return replaySession !== null;
}

function replaySource() {
  if (hasOnlineSession() && onlineRoom?.replay) {
    return cloneSerializable(onlineRoom.replay);
  }
  if (typeof game?.getReplayState === "function") {
    return game.getReplayState();
  }
  return null;
}

function replayEventCount(source = replaySource()) {
  return Array.isArray(source?.events)
    ? source.events.filter((event) => ["play", "pass"].includes(event?.type)).length
    : 0;
}

function formatReviewMove(move, size = game?.size ?? 19) {
  if (move?.type === "pass") return "停一手";
  if (move?.type !== "play") return "—";
  const letter = COORDINATE_LETTERS[move.col] || String(move.col + 1);
  return `${letter}${size - move.row}`;
}

function reviewStageText(active = reviewActive) {
  if (!active) return "";
  const prefix = active.mode === "batch" && replaySession?.analysisBatch
    ? `整局分析 ${replaySession.analysisBatch.completed} / ${replaySession.analysisBatch.total} · 第 ${active.step} 手 · `
    : `第 ${active.step} 手 · `;
  if (active.stage === "loading_model") {
    return `${prefix}首次载入 KataGo b10 模型（约 11 MB）…`;
  }
  if (active.stage === "neural_inference") {
    return `${prefix}神经网络正在观察局面…`;
  }
  if (active.stage === "searching") {
    return `${prefix}正在按${topologyName(replaySession?.frames?.[active.step]?.topology)}规则短搜索…`;
  }
  return `${prefix}正在准备分析…`;
}

function terminateReviewWorker() {
  reviewWorker?.terminate();
  reviewWorker = null;
}

function cancelReplayAIReview({ terminate = false, announce = false } = {}) {
  const wasRunning = Boolean(reviewActive || replaySession?.analysisBatch);
  if (reviewActive && reviewWorker) {
    reviewWorker.postMessage({ type: "cancel", id: reviewActive.id });
  }
  reviewRequestId += 1;
  reviewActive = null;
  if (replaySession) {
    replaySession.analysisBatch = null;
    if (announce && wasRunning) replaySession.analysisMessage = "AI 分析已停止，已完成的结果仍然保留。";
  }
  if (terminate) terminateReviewWorker();
}

function handleReviewWorkerMessage(event) {
  const message = event.data ?? {};
  if (!reviewActive || message.id !== reviewActive.id) return;

  if (message.type === "status") {
    reviewActive.stage = message.stage;
    reviewActive.backend = message.backend ?? reviewActive.backend;
    syncAIReviewUI();
    return;
  }

  const completed = reviewActive;
  reviewActive = null;
  if (!replaySession) return;

  if (message.type === "result") {
    replaySession.analysisByStep.set(completed.step, {
      move: cloneSerializable(message.move),
      stats: cloneSerializable(message.stats ?? {}),
      mode: completed.mode,
    });
    replaySession.analysisMessage = "";

    if (completed.mode === "batch" && replaySession.analysisBatch) {
      const completedVisibleStep = replaySession.index === completed.step;
      replaySession.analysisBatch.completed += 1;
      startNextBatchReview();
      if (completedVisibleStep && replaySession) updateUI();
    } else if (replaySession.index === completed.step) {
      updateUI();
    } else {
      syncAIReviewUI();
    }
    return;
  }

  if (message.code === "AI_SEARCH_CANCELLED") {
    syncAIReviewUI();
    return;
  }

  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `AI 复盘暂时失败：${message.message || "分析线程返回错误"}`;
  replaySession.analysisError = true;
  syncAIReviewUI();
}

function handleReviewWorkerError(event) {
  if (!reviewActive) return;
  reviewActive = null;
  terminateReviewWorker();
  if (!replaySession) return;
  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `AI 复盘线程没有正常启动：${event.message || "未知错误"}`;
  replaySession.analysisError = true;
  syncAIReviewUI();
}

function ensureReviewWorker() {
  if (reviewWorker) return reviewWorker;
  const worker = new Worker(new URL("./ai/katagoWorker.js", import.meta.url), {
    type: "module",
  });
  reviewWorker = worker;
  worker.addEventListener("message", handleReviewWorkerMessage);
  worker.addEventListener("error", handleReviewWorkerError);
  return worker;
}

function startReviewAtStep(step, mode) {
  if (!replaySession) return false;
  const frame = replaySession.frames[step];
  if (frame?.phase !== PHASE_PLAY) return false;
  if (typeof Worker !== "function") {
    replaySession.analysisBatch = null;
    replaySession.analysisMessage = "当前浏览器不支持后台 AI 复盘。";
    replaySession.analysisError = true;
    syncAIReviewUI();
    return false;
  }

  let state;
  let worker;
  try {
    state = buildReplayStateAtStep(replaySession.source, step);
    worker = ensureReviewWorker();
  } catch (error) {
    replaySession.analysisBatch = null;
    replaySession.analysisMessage = `无法重建第 ${step} 手：${error.message}`;
    replaySession.analysisError = true;
    syncAIReviewUI();
    return false;
  }

  const settings = mode === "batch" ? AI_REVIEW_BATCH : AI_REVIEW_CURRENT;
  const id = ++reviewRequestId;
  reviewActive = { id, step, mode, stage: "preparing" };
  replaySession.analysisError = false;
  worker.postMessage({
    type: "think",
    id,
    state,
    options: {
      difficulty: "hard",
      timeLimitMs: settings.timeMs,
      maxIterations: settings.maxIterations,
      rolloutLimit: Math.min(settings.rolloutLimit, frame.size * frame.size * 2),
    },
  });
  syncAIReviewUI();
  return true;
}

function startNextBatchReview() {
  const batch = replaySession?.analysisBatch;
  if (!batch) return;
  while (batch.cursor < batch.steps.length) {
    const step = batch.steps[batch.cursor];
    batch.cursor += 1;
    if (replaySession.analysisByStep.has(step)) {
      batch.completed += 1;
      continue;
    }
    if (startReviewAtStep(step, "batch")) return;
    return;
  }

  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `整局快速分析完成：共分析 ${batch.total} 个实战局面。`;
  replaySession.analysisError = false;
  updateUI();
}

function analyzeCurrentReplayStep() {
  if (!replaySession) return;
  stopReplayPlayback();
  cancelReplayAIReview();
  replaySession.analysisMessage = "";
  replaySession.analysisError = false;
  startReviewAtStep(replaySession.index, "current");
}

function analyzeWholeReplay() {
  if (!replaySession) return;
  stopReplayPlayback();
  cancelReplayAIReview();
  const steps = replaySession.steps
    .map((_, index) => index)
    .filter((index) => replaySession.frames[index]?.phase === PHASE_PLAY);
  if (steps.length === 0) {
    replaySession.analysisMessage = "这份棋谱里没有可以分析的行棋局面。";
    replaySession.analysisError = true;
    syncAIReviewUI();
    return;
  }
  replaySession.analysisBatch = {
    steps,
    cursor: 0,
    completed: 0,
    total: steps.length,
  };
  replaySession.analysisMessage = "";
  replaySession.analysisError = false;
  startNextBatchReview();
}

function clearReplayTimer() {
  if (replayTimer !== null) {
    window.clearTimeout(replayTimer);
    replayTimer = null;
  }
}

function setReplayPlaying(playing) {
  if (!replaySession) return;
  replaySession.playing = Boolean(playing);
  elements.replayPlay.textContent = replaySession.playing ? "Ⅱ" : "▶";
  elements.replayPlay.setAttribute(
    "aria-label",
    replaySession.playing ? "暂停复盘" : "播放复盘",
  );
  elements.replayPlay.setAttribute("title", replaySession.playing ? "暂停" : "播放");
  elements.replayPlay.setAttribute("aria-pressed", String(replaySession.playing));
}

function stopReplayPlayback() {
  clearReplayTimer();
  setReplayPlaying(false);
}

function replayPlaybackDelay() {
  const speed = Number(elements.replaySpeed.value);
  return REPLAY_INTERVAL_MS / ([0.5, 1, 2].includes(speed) ? speed : 1);
}

function scheduleReplayTick() {
  clearReplayTimer();
  if (!replaySession?.playing) return;
  if (replaySession.index >= replaySession.frames.length - 1) {
    setReplayPlaying(false);
    return;
  }
  replayTimer = window.setTimeout(() => {
    replayTimer = null;
    if (!replaySession?.playing) return;
    setReplayStep(replaySession.index + 1, { playSound: true, keepPlaying: true });
    scheduleReplayTick();
  }, replayPlaybackDelay());
}

function setReplayStep(index, { playSound = false, keepPlaying = false } = {}) {
  if (!replaySession) return;
  const previousIndex = replaySession.index;
  const lastIndex = replaySession.frames.length - 1;
  const numericIndex = Number(index);
  const requestedIndex = Number.isFinite(numericIndex) ? Math.round(numericIndex) : 0;
  replaySession.index = Math.max(0, Math.min(lastIndex, requestedIndex));
  if (
    playSound && replaySession.index === previousIndex + 1 &&
    replaySession.frames[replaySession.index]?.lastMove?.type === "play"
  ) {
    const move = replaySession.frames[replaySession.index].lastMove;
    playMoveSounds(move.captured?.length ?? 0);
  }
  if (!keepPlaying) stopReplayPlayback();
  if (replaySession.index >= lastIndex) setReplayPlaying(false);
  updateUI();
}

function startReplayPlayback() {
  if (!replaySession) return;
  if (replaySession.index >= replaySession.frames.length - 1) {
    replaySession.index = 0;
    updateUI();
  }
  setReplayPlaying(true);
  scheduleReplayTick();
}

function enterReplay() {
  if (isReplaying()) return;
  const source = replaySource();
  if (!source || replayEventCount(source) === 0) {
    setMessage("至少下一手棋后，才能开始复盘。", true);
    return;
  }

  try {
    if (aiThinking) cancelAIThinking();
    const replay = buildReplayFrames(cloneSerializable(source));
    if (!Array.isArray(replay.frames) || replay.frames.length < 2) {
      throw new TypeError("棋谱中没有可播放的棋步");
    }
    replaySession = {
      source: cloneSerializable(source),
      frames: replay.frames,
      steps: replay.steps,
      complete: replay.complete !== false,
      index: 0,
      playing: false,
      analysisByStep: new Map(),
      analysisBatch: null,
      analysisMessage: "",
      analysisError: false,
    };
    elements.coordinateHint.textContent = "";
    updateUI();
    elements.replayPlay.focus({ preventScroll: true });
  } catch (error) {
    console.error("Unable to start replay", error);
    setMessage("这份棋谱暂时无法复盘，请继续当前对局或建立新棋盘。", true);
    maybeStartAITurn();
  }
}

function exitReplay({ announce = true } = {}) {
  if (!isReplaying()) return;
  clearReplayTimer();
  cancelReplayAIReview({ terminate: true });
  replaySession = null;
  if (announce) setMessage("已退出复盘，回到当前棋局。");
  updateUI();
  elements.replayButton.focus({ preventScroll: true });
  if (announce) maybeStartAITurn();
}

function hasOnlineSession() {
  return Boolean(roomClient.session && roomClient.roomCode);
}

function isAIMode() {
  return aiActive && !hasOnlineSession();
}

function currentAIName() {
  return `KataGo ${topologyName()}混合 AI`;
}

function aiColor() {
  return aiHumanColor === BLACK ? WHITE : BLACK;
}

function isAITurn() {
  return isAIMode() && game?.phase === PHASE_PLAY && game.currentPlayer === aiColor();
}

function syncLastPlayedPoint() {
  lastPlayedPoint = game?.lastMove?.type === "play"
    ? { row: game.lastMove.row, col: game.lastMove.col }
    : null;
}

function canUndoAIChoice() {
  if (!isAIMode() || !game?.canUndo()) return false;
  const firstHumanMoveNumber = aiHumanColor === WHITE ? 2 : 1;
  return moveCount >= firstHumanMoveNumber;
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
    playMoveSounds(result.captured?.length ?? 0);
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
      setMessage(`神经判断完成，正在按${topologyName()}规则验证与搜索…`);
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
      // Search clones the state many times and never needs the historical
      // replay timeline. Keep the AI payload and its inner loops bounded as a
      // real game grows longer.
      state: game.exportState({ includeReplay: false }),
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

function currentUndoRequest() {
  return onlineRoom?.undoRequest ?? null;
}

function isOwnUndoRequest(request = currentUndoRequest()) {
  if (!request) return false;
  const identity = currentIdentity();
  return request.requesterId === (identity.playerId ?? identity.id);
}

function canShowMovePreview() {
  if (isReplaying()) return false;
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
      commandPending: onlineCommandPending || Boolean(currentUndoRequest()),
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
  torusView?.setMovePreviewEnabled(enabled);
  flatView?.setMovePreviewEnabled(enabled);
  arcView?.setMovePreviewEnabled(enabled);
}

function hydratePublicGame(state) {
  const hydrated = new GoEngine({
    size: state.size,
    topology: state.topology ?? TOPOLOGY_CYLINDER,
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
  const reviewing = isReplaying();
  const connected = roomClient.connectionStatus === CONNECTION_STATUS.CONNECTED;
  const onlineReady = active && onlineRoom?.code === roomClient.roomCode && Boolean(onlineRoom.game);
  const identity = currentIdentity();
  const scoreConfirmations = onlineRoom?.scoreConfirmations ?? [];
  const ownScoreConfirmed = scoreConfirmations.includes(identity.color);
  const hasBothPlayers = Boolean(roomSeat(BLACK) && roomSeat(WHITE));
  const undoRequest = currentUndoRequest();
  const ownUndoRequest = isOwnUndoRequest(undoRequest);
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
  elements.offlineOpponentActions.hidden = active || aiMode || reviewing;
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
    } else if (undoRequest) {
      elements.roomHint.textContent = ownUndoRequest
        ? "悔棋申请已发送，等待对方回应。"
        : `${colorName(undoRequest.requesterColor)}申请撤回上一手，请选择同意或拒绝。`;
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
  elements.copyRoomLink.disabled = reviewing || !onlineControlsAvailable;
  elements.leaveRoom.disabled = reviewing || (active && (
    onlineBusy || (!connected && !canAbandonRoom && !canDetachReplaced)
  ));
  elements.leaveRoom.textContent = canDetachReplaced
    ? "关闭本页联机"
    : canAbandonRoom
      ? "忘记房间"
      : "退出";
  elements.passButton.disabled = reviewing || (active
    ? !(
        onlineControlsAvailable && !undoRequest && hasBothPlayers && isOnlineTurn() &&
        game.phase === PHASE_PLAY
      )
    : aiMode && (
        aiThinking || game.phase !== PHASE_PLAY || game.currentPlayer !== aiHumanColor
      ));
  elements.newGameButton.disabled = reviewing || (active && !(
    onlineControlsAvailable && !undoRequest && isOnlineHost()
  ));
  elements.undoButton.textContent = active ? "申请悔棋" : "悔棋";
  elements.undoButton.disabled = reviewing || (active
    ? !(
        onlineControlsAvailable && !undoRequest && hasBothPlayers && isOnlinePlayer() &&
        game.phase === PHASE_PLAY && onlineRoom?.undoAvailable === true
      )
    : aiMode
      ? !canUndoAIChoice()
      : !game?.canUndo());
  elements.undoRequestPanel.hidden = reviewing || !(
    active && onlineReady && undoRequest && isOnlinePlayer()
  );
  if (undoRequest) {
    elements.undoRequestText.textContent = ownUndoRequest
      ? "已申请撤回上一手，正在等待对方回应"
      : `${colorName(undoRequest.requesterColor)}申请撤回上一手`;
  }
  elements.undoResponseActions.hidden = !undoRequest || ownUndoRequest;
  elements.cancelUndoRequest.hidden = !undoRequest || !ownUndoRequest;
  elements.approveUndo.disabled = reviewing || !onlineControlsAvailable || ownUndoRequest;
  elements.declineUndo.disabled = reviewing || !onlineControlsAvailable || ownUndoRequest;
  elements.cancelUndoRequest.disabled = reviewing || !onlineControlsAvailable || !ownUndoRequest;
  elements.confirmScore.disabled = reviewing || (active && !(
    onlineControlsAvailable && isOnlinePlayer() && !ownScoreConfirmed
  ));
  elements.resumeGame.disabled = reviewing || (active && !(
    onlineControlsAvailable && isOnlinePlayer()
  ));
  elements.confirmScore.textContent = active && ownScoreConfirmed
    ? "已确认，等待对方"
    : active && scoreConfirmations.length > 0
      ? "确认同意结果"
      : "确认结果";

  const canChangeOnlineSettings = !reviewing && (active
    ? onlineControlsAvailable && !undoRequest && isOnlineHost()
    : !aiThinking);
  elements.customSize.disabled = !canChangeOnlineSettings;
  elements.scoringRule.disabled = !canChangeOnlineSettings;
  elements.komi.disabled = !canChangeOnlineSettings;
  for (const button of elements.sizeButtons) button.disabled = !canChangeOnlineSettings;
  for (const button of elements.topologyButtons) {
    button.disabled = !canChangeOnlineSettings;
  }
  elements.changeAiSettings.disabled = reviewing;
  elements.leaveAi.disabled = reviewing;
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

function syncTopologyPresentation() {
  const torus = isTorusTopology();
  elements.boardStage.dataset.topology = game.topology;
  elements.boardStage.setAttribute(
    "aria-label",
    torus ? "上下左右相连的甜甜圈围棋棋盘区域" : "左右相连的竹筒围棋棋盘区域",
  );
  elements.flatScene.setAttribute(
    "aria-label",
    torus
      ? "可向任意方向循环滑动的甜甜圈平面展开棋盘"
      : "可横向滑动的竹筒表面平面展开棋盘",
  );
  elements.arcViewButton.hidden = torus;
  elements.threeDViewLabel.textContent = torus ? "立体甜甜圈" : "立体竹筒";
  elements.rulesSummary.textContent = torus
    ? "甜甜圈棋盘规则说明"
    : "竹筒表面规则说明";
  elements.cylinderRules.hidden = torus;
  elements.torusRules.hidden = !torus;
  setViewMode(torus && activeViewMode === "arc" ? "flat" : activeViewMode);
}

function rebuildViews(size, topology) {
  cylinderView?.rebuild(size);
  torusView?.rebuild(size);
  flatView?.rebuild(size, topology);
  arcView?.rebuild(size);
  syncTopologyPresentation();
}

function restoreOfflineGame() {
  if (!offlineGameState) return;
  exitReplay({ announce: false });
  cancelAIThinking();
  const previousSize = game?.size;
  const previousTopology = game?.topology;
  game = GoEngine.fromState(offlineGameState.game);
  moveCount = offlineGameState.moveCount;
  lastPlayedPoint = offlineGameState.lastPlayedPoint;
  aiActive = Boolean(offlineGameState.ai?.active);
  aiHumanColor = offlineGameState.ai?.humanColor === WHITE ? WHITE : BLACK;
  if (previousSize !== game.size || previousTopology !== game.topology) {
    rebuildViews(game.size, game.topology);
  }
  setPendingSize(game.size);
  setPendingTopology(game.topology);
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
  const previousUndoRequest = previousRoom?.undoRequest ?? null;
  const undoRequest = room.undoRequest ?? null;
  const undoRequestChanged = Boolean(previousRoom) &&
    JSON.stringify(previousUndoRequest) !== JSON.stringify(undoRequest);
  const gameChanged = !previousRoom || [
    previousRoom.moveCount !== room.moveCount,
    previousRoom.game.size !== room.game.size,
    previousRoom.game.topology !== room.game.topology,
    previousRoom.game.komi !== room.game.komi,
    previousRoom.game.scoringRule !== room.game.scoringRule,
    previousRoom.game.phase !== room.game.phase,
    previousRoom.game.consecutivePasses !== room.game.consecutivePasses,
    JSON.stringify(previousRoom.game.lastMove) !== JSON.stringify(room.game.lastMove),
    deadStonesChanged,
    JSON.stringify(previousRoom.game.result) !== JSON.stringify(room.game.result),
    confirmationsChanged,
    undoRequestChanged,
  ].some(Boolean);
  if (!gameChanged) return;
  if (previousRoom && room.moveCount > previousRoom.moveCount && lastMove?.type === "play") {
    playMoveSounds(lastMove.captured?.length ?? 0);
  }
  if (!previousRoom) {
    setMessage(`已进入房间 ${room.code}。`);
  } else if (!previousUndoRequest && undoRequest) {
    setMessage(isOwnUndoRequest(undoRequest)
      ? "悔棋申请已发送，等待对方回应。"
      : `${colorName(undoRequest.requesterColor)}申请撤回上一手。`);
  } else if (previousUndoRequest && !undoRequest) {
    setMessage(room.moveCount < previousRoom.moveCount
      ? "悔棋已同意，上一手已撤回。"
      : "悔棋申请已结束，棋局继续。");
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
    setMessage(
      `${room.game.size} 路${topologySurfaceName(room.game.topology)}在线棋盘已准备好，黑方先行。`,
    );
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

  const replayFrame = replaySession?.frames?.[replaySession.index];
  if (
    replayFrame &&
    (replayFrame.size !== room.game.size || replayFrame.topology !== room.game.topology)
  ) {
    exitReplay({ announce: false });
    setMessage("房间已建立不同形状的新棋盘，复盘已结束并切回实时局面。");
  }

  const previousRoom = onlineRoom;
  const previousSize = game?.size;
  const previousTopology = game?.topology;
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

  if (previousSize !== game.size || previousTopology !== game.topology) {
    rebuildViews(game.size, game.topology);
  }
  setPendingSize(game.size);
  setPendingTopology(game.topology);
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

function setPendingTopology(topology) {
  pendingTopology = topology === TOPOLOGY_TORUS
    ? TOPOLOGY_TORUS
    : TOPOLOGY_CYLINDER;
  for (const button of elements.topologyButtons) {
    const active = button.dataset.boardTopology === pendingTopology;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function getNewGameOptions() {
  const size = Math.max(5, Math.min(25, Math.round(Number(elements.customSize.value) || 19)));
  setPendingSize(size);
  return {
    size,
    topology: pendingTopology,
    scoringRule: elements.scoringRule.value,
    komi: Number(elements.komi.value) || 0,
  };
}

async function startNewGame() {
  exitReplay({ announce: false });
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
  rebuildViews(options.size, options.topology);
  setMessage(
    `${options.size} 路${topologySurfaceName(options.topology)}棋盘已准备好，黑方先行。`,
  );
  updateUI();
  maybeStartAITurn();
}

function hasProgress() {
  return moveCount > 0 || game.board.some((row) => row.some(Boolean));
}

function requestNewGame() {
  if (isReplaying()) {
    setMessage("请先退出复盘，再建立新棋盘。", true);
    return;
  }
  if (hasOnlineSession() && !isOnlineHost()) {
    setMessage("联机房间中只有黑方可以建立新棋盘。", true);
    return;
  }
  if (!hasProgress()) {
    void startNewGame();
    return;
  }
  elements.newGameSummary.textContent = pendingTopology === TOPOLOGY_TORUS
    ? `将建立：甜甜圈（上下左右首尾相接） · ${pendingSize} 路。当前对局进度将被清除。`
    : `将建立：竹筒（左右首尾相接） · ${pendingSize} 路。当前对局进度将被清除。`;
  if (typeof elements.newGameDialog.showModal === "function") {
    elements.newGameDialog.showModal();
  } else {
    if (window.confirm("建立新棋盘并清除当前对局？")) {
      void startNewGame();
    } else {
      setPendingSize(game.size);
      setPendingTopology(game.topology);
    }
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

function renderBoardPosition(
  state,
  lastMove = state.lastMove,
  analysisMove = null,
) {
  const viewState = { ...state, lastMove, analysisMove };
  cylinderView?.setPosition(viewState);
  torusView?.setPosition(viewState);
  flatView?.setPosition(viewState);
  arcView?.setPosition(viewState);
}

function syncReplayEntryAvailability() {
  const reviewing = isReplaying();
  elements.replayButton.hidden = reviewing;
  elements.replayPanel.hidden = !reviewing;
  elements.replayButton.disabled = !reviewing && replayEventCount() === 0;
}

function syncAIReviewUI() {
  if (!replaySession) return;
  const frame = replaySession.frames[replaySession.index];
  const analysis = replaySession.analysisByStep.get(replaySession.index);
  const running = Boolean(reviewActive);
  const canAnalyzeCurrent = frame?.phase === PHASE_PLAY;

  elements.aiReviewCurrent.hidden = running;
  elements.aiReviewAll.hidden = running;
  elements.aiReviewCancel.hidden = !running;
  elements.aiReviewCurrent.disabled = !canAnalyzeCurrent;
  elements.aiReviewAll.disabled = replaySession.steps.length === 0;
  elements.aiReviewCurrent.textContent = analysis
    ? "重新深入分析"
    : "分析当前局面";
  elements.aiReviewAll.textContent = replaySession.analysisByStep.size > 0
    ? "补齐整局分析"
    : "快速分析整局";

  let status = "停在任意一手，查看 AI 在当时更偏好的下法。";
  if (running) {
    status = reviewStageText();
  } else if (replaySession.analysisMessage) {
    status = replaySession.analysisMessage;
  } else if (analysis) {
    const detail = [
      analysis.stats?.backend?.toUpperCase?.(),
      Number.isFinite(analysis.stats?.iterations)
        ? `搜索 ${analysis.stats.iterations} 次`
        : null,
    ].filter(Boolean).join(" · ");
    status = `第 ${replaySession.index} 手已有 AI 参考${detail ? ` · ${detail}` : ""}。`;
  } else if (!canAnalyzeCurrent) {
    status = "当前时间点已经进入点目或终局，AI 不再推荐落子。";
  }
  elements.aiReviewStatus.textContent = status;
  elements.aiReviewStatus.classList.toggle(
    "error",
    !running && replaySession.analysisError,
  );

  elements.aiReviewResult.hidden = !analysis;
  elements.aiReviewCandidates.replaceChildren();
  if (!analysis) return;

  const actualMove = replaySession.steps[replaySession.index] ?? null;
  const candidates = Array.isArray(analysis.stats?.candidates)
    ? analysis.stats.candidates
    : [];
  const comparison = compareReviewMove(actualMove, analysis.move, candidates);
  elements.aiReviewMove.textContent = formatReviewMove(analysis.move, frame.size);

  let comparisonText;
  if (comparison.kind === "match") {
    comparisonText = `实战 ${formatReviewMove(actualMove, frame.size)} 与 AI 首选一致。`;
  } else if (comparison.kind === "candidate") {
    comparisonText = `实战 ${formatReviewMove(actualMove, frame.size)} 是本次搜索候选第 ${comparison.rank}。`;
  } else if (comparison.kind === "outside") {
    comparisonText = `实战 ${formatReviewMove(actualMove, frame.size)} 未进入本次 ${comparison.candidateCount} 个已搜索候选；这不等于它一定是坏棋。`;
  } else {
    comparisonText = "这是棋谱当前末尾，没有实战下一手可比较。";
  }
  if (Number.isFinite(analysis.stats?.winRate)) {
    comparisonText += ` 首选搜索估值 ${Math.round(analysis.stats.winRate * 100)}%（当前行棋方视角）。`;
  }
  elements.aiReviewComparison.textContent = comparisonText;

  topReviewCandidates(analysis.stats, 3, analysis.move).forEach((candidate, index) => {
    const share = candidateVisitShare(candidate, candidates);
    const percent = Math.round(share * 100);
    const item = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "ai-review-rank";
    rank.textContent = String(index + 1);
    const label = document.createElement("span");
    label.textContent = `${formatReviewMove(candidate.move, frame.size)} · ${percent}%`;
    const meter = document.createElement("span");
    meter.className = "ai-review-meter";
    meter.setAttribute("aria-label", `搜索访问占比 ${percent}%`);
    const fill = document.createElement("span");
    fill.style.width = `${percent}%`;
    meter.appendChild(fill);
    item.append(rank, label, meter);
    elements.aiReviewCandidates.appendChild(item);
  });
}

function updateReplayUI() {
  const frame = replaySession.frames[replaySession.index];
  const lastIndex = replaySession.frames.length - 1;
  const move = replaySession.index > 0 ? frame.lastMove : null;
  const atRecordedEnd = replaySession.index === lastIndex;
  const finishedAtEnd = atRecordedEnd && frame.phase === PHASE_FINISHED;
  const scoringAtEnd = atRecordedEnd && frame.phase === PHASE_SCORING;

  const analysis = replaySession.analysisByStep.get(replaySession.index);
  renderBoardPosition(frame, move, analysis?.move ?? null);
  elements.blackCaptures.textContent = String(frame.captures.black);
  elements.whiteCaptures.textContent = String(frame.captures.white);
  elements.boardTopology.textContent =
    `${frame.size} 路 · ${frame.size * frame.size} 点 · ${topologySurfaceName(frame.topology)}`;
  elements.moveNumber.textContent = `复盘 · 第 ${replaySession.index} / ${lastIndex} 手`;
  elements.phaseLabel.textContent = finishedAtEnd
    ? "复盘终局"
    : scoringAtEnd
      ? "复盘至点目"
      : replaySession.complete
        ? "整局复盘"
        : "续录复盘";
  elements.turnStone.hidden = replaySession.index === 0 || finishedAtEnd || scoringAtEnd;
  elements.turnStone.classList.toggle("black", move?.color === BLACK);
  elements.turnStone.classList.toggle("white", move?.color === WHITE);
  elements.turnText.textContent = finishedAtEnd
    ? formatResult(frame.result)
    : scoringAtEnd
      ? "点目尚未确认"
      : replaySession.index === 0
        ? "开局局面"
        : move?.type === "pass"
          ? `${colorName(move.color)}停一手`
          : `${colorName(move?.color)}第 ${replaySession.index} 手`;

  elements.playControls.hidden = true;
  elements.scoringPanel.hidden = true;
  elements.replayButton.hidden = true;
  elements.replayPanel.hidden = false;
  elements.replayProgress.textContent = `第 ${replaySession.index} / ${lastIndex} 手`;
  elements.replaySlider.max = String(lastIndex);
  elements.replaySlider.value = String(replaySession.index);
  elements.replayFirst.disabled = replaySession.index === 0;
  elements.replayPrev.disabled = replaySession.index === 0;
  elements.replayNext.disabled = replaySession.index === lastIndex;
  elements.replayLast.disabled = replaySession.index === lastIndex;
  elements.replayPlay.disabled = lastIndex === 0;
  setReplayPlaying(replaySession.playing && replaySession.index < lastIndex);
  elements.message.setAttribute("aria-live", replaySession.playing ? "off" : "polite");
  syncAIReviewUI();

  updateRoomUI();
  const availableViewCopy = frame.topology === TOPOLOGY_TORUS
    ? "平面或立体视图"
    : "平面、弧面或立体视图";
  const replayNote = replaySession.complete
    ? `可随时切换${availableViewCopy}。`
    : "旧棋局只记录了升级后的棋步；仍可切换任意可用视图。";
  if (finishedAtEnd) {
    setMessage(`复盘结束：${formatResult(frame.result)}。最终死子标记与点目结果已还原。`);
  } else if (scoringAtEnd) {
    setMessage(`棋谱已播放到点目阶段，最终结果尚未确认。${replayNote}`);
  } else if (replaySession.index === 0) {
    setMessage(`这是复盘起点。${replayNote}`);
  } else if (move?.type === "pass") {
    setMessage(`第 ${replaySession.index} 手：${colorName(move.color)}停一手。${replayNote}`);
  } else {
    const captured = move?.captured?.length
      ? `，提掉 ${move.captured.length} 子`
      : "";
    setMessage(`第 ${replaySession.index} 手：${colorName(move?.color)}落子${captured}。${replayNote}`);
  }
}

function updateUI() {
  if (isReplaying()) {
    updateReplayUI();
    return;
  }

  elements.message.setAttribute("aria-live", "polite");
  const state = game.getState();
  const renderLastMove = lastPlayedPoint
    ? { type: "play", ...lastPlayedPoint }
    : state.lastMove;
  renderBoardPosition(state, renderLastMove);

  elements.blackCaptures.textContent = String(state.captures.black);
  elements.whiteCaptures.textContent = String(state.captures.white);
  elements.boardTopology.textContent =
    `${state.size} 路 · ${state.size * state.size} 点 · ${topologySurfaceName(state.topology)}`;
  elements.moveNumber.textContent = `第 ${moveCount + 1} 手`;
  elements.turnStone.classList.toggle("black", state.currentPlayer === BLACK);
  elements.turnStone.classList.toggle("white", state.currentPlayer === WHITE);

  const playing = state.phase === PHASE_PLAY;
  elements.passButton.hidden = !playing;
  elements.playControls.hidden = false;
  elements.playControls.classList.toggle("scoring-actions", !playing);
  elements.scoringPanel.hidden = playing;
  elements.confirmScore.hidden = state.phase === PHASE_FINISHED;
  elements.resumeGame.hidden = state.phase === PHASE_FINISHED;
  syncReplayEntryAvailability();
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
    elements.moveNumber.textContent = `${state.size} 路${topologySurfaceName(state.topology)}`;
  }
}

function handleBoardPoint({ row, col }) {
  if (isReplaying()) {
    setMessage("复盘不会修改棋局；请退出复盘后再落子。", true);
    return;
  }
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
    if (currentUndoRequest()) {
      setMessage("请先处理当前的悔棋申请，再继续下棋。", true);
      return;
    }
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
    playMoveSounds(result.captured?.length ?? 0);
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

function undoOfflineGame() {
  if (isAIMode()) {
    if (!canUndoAIChoice()) {
      setMessage("你还没有可以撤回的棋步。", true);
      return;
    }

    if (aiThinking) cancelAIThinking();
    let undoneCount = 0;
    let humanMoveUndone = false;
    while (game.canUndo()) {
      const result = game.undo();
      if (!result.ok) break;
      moveCount = Math.max(0, moveCount - 1);
      undoneCount += 1;
      if (result.move.color === aiHumanColor) {
        humanMoveUndone = true;
        break;
      }
    }

    if (!humanMoveUndone) {
      setMessage("没有找到可以撤回的玩家棋步。", true);
      updateUI();
      return;
    }
    syncLastPlayedPoint();
    setMessage(undoneCount > 1
      ? "已撤回你和 AI 的上一轮落子，轮到你重新选择。"
      : "已撤回你刚才的一手，轮到你重新选择。");
    updateUI();
    return;
  }

  const result = game.undo();
  if (!result.ok) {
    setMessage(ERROR_MESSAGES[result.reason] || "现在不能悔棋。", true);
    return;
  }
  moveCount = Math.max(0, moveCount - 1);
  syncLastPlayedPoint();
  setMessage(`已撤回${colorName(result.move.color)}的上一手。`);
  updateUI();
}

function handleHover(point) {
  if (!point) {
    elements.coordinateHint.textContent = "";
    return;
  }
  const letter = COORDINATE_LETTERS[point.col] || String(point.col + 1);
  const coordinate = `${letter}${game.size - point.row}`;
  const seamNotes = [];
  if (point.col === 0 || point.col === game.size - 1) {
    seamNotes.push("A列与末列相邻");
  }
  if (
    isTorusTopology() &&
    (point.row === 0 || point.row === game.size - 1)
  ) {
    seamNotes.push("最上行与最下行相邻");
  }
  elements.coordinateHint.textContent =
    `${coordinate}${seamNotes.length ? ` · ${seamNotes.join(" · ")}` : ""}`;
}

elements.replayButton.addEventListener("click", enterReplay);
elements.replayExit.addEventListener("click", () => exitReplay());
elements.replayFirst.addEventListener("click", () => setReplayStep(0));
elements.replayPrev.addEventListener("click", () => {
  if (replaySession) setReplayStep(replaySession.index - 1);
});
elements.replayNext.addEventListener("click", () => {
  if (replaySession) setReplayStep(replaySession.index + 1, { playSound: true });
});
elements.replayLast.addEventListener("click", () => {
  if (replaySession) setReplayStep(replaySession.frames.length - 1);
});
elements.replayPlay.addEventListener("click", () => {
  if (!replaySession) return;
  if (replaySession.playing) stopReplayPlayback();
  else startReplayPlayback();
  updateUI();
});
elements.replaySlider.addEventListener("input", () => {
  setReplayStep(Number(elements.replaySlider.value));
});
elements.replaySpeed.addEventListener("change", () => {
  if (replaySession?.playing) scheduleReplayTick();
});
elements.aiReviewCurrent.addEventListener("click", analyzeCurrentReplayStep);
elements.aiReviewAll.addEventListener("click", analyzeWholeReplay);
elements.aiReviewCancel.addEventListener("click", () => {
  cancelReplayAIReview({ announce: true });
  syncAIReviewUI();
});

elements.passButton.addEventListener("click", () => {
  if (isReplaying()) return;
  if (hasOnlineSession()) {
    if (currentUndoRequest()) {
      setMessage("请先处理当前的悔棋申请，再继续下棋。", true);
      return;
    }
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

elements.undoButton.addEventListener("click", () => {
  if (isReplaying()) return;
  if (hasOnlineSession()) {
    if (currentUndoRequest()) {
      setMessage("当前已有一份悔棋申请。", true);
      return;
    }
    setMessage("正在发送悔棋申请…");
    void sendOnlineCommand("request_undo", { expectedMoveCount: moveCount });
    return;
  }
  undoOfflineGame();
});

elements.approveUndo.addEventListener("click", () => {
  const request = currentUndoRequest();
  if (!request || isOwnUndoRequest(request)) return;
  void sendOnlineCommand("respond_undo", {
    accept: true,
    targetMoveCount: request.targetMoveCount,
    requestRevision: request.requestRevision,
  });
});

elements.declineUndo.addEventListener("click", () => {
  const request = currentUndoRequest();
  if (!request || isOwnUndoRequest(request)) return;
  void sendOnlineCommand("respond_undo", {
    accept: false,
    targetMoveCount: request.targetMoveCount,
    requestRevision: request.requestRevision,
  });
});

elements.cancelUndoRequest.addEventListener("click", () => {
  const request = currentUndoRequest();
  if (!request || !isOwnUndoRequest(request)) return;
  void sendOnlineCommand("cancel_undo", {
    targetMoveCount: request.targetMoveCount,
    requestRevision: request.requestRevision,
  });
});

elements.confirmScore.addEventListener("click", () => {
  if (isReplaying()) return;
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
  if (isReplaying()) return;
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

for (const button of elements.topologyButtons) {
  button.addEventListener("click", () => {
    const nextTopology = button.dataset.boardTopology === TOPOLOGY_TORUS
      ? TOPOLOGY_TORUS
      : TOPOLOGY_CYLINDER;
    if (nextTopology === game.topology) {
      setPendingTopology(game.topology);
      return;
    }
    setPendingTopology(nextTopology);
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
  else {
    setPendingSize(game.size);
    setPendingTopology(game.topology);
  }
});

function setViewMode(mode) {
  const torus = isTorusTopology();
  const availableModes = torus ? ["flat", "3d"] : ["flat", "arc", "3d"];
  activeViewMode = availableModes.includes(mode)
    ? mode
    : torus
      ? "flat"
      : "arc";
  const flatActive = activeViewMode === "flat";
  const arcActive = !torus && activeViewMode === "arc";
  const cylinderActive = !torus && activeViewMode === "3d";
  const torusActive = torus && activeViewMode === "3d";
  elements.boardStage.dataset.viewMode = activeViewMode;
  elements.flatScene.hidden = !flatActive;
  elements.arcScene.hidden = !arcActive;
  elements.scene.hidden = !cylinderActive;
  elements.torusScene.hidden = !torusActive;
  flatView?.setActive(flatActive);
  arcView?.setActive(arcActive);
  cylinderView?.setActive(cylinderActive);
  torusView?.setActive(torusActive);
  if (arcActive) arcView?.setAutoRotate(autoRotateByView.arc);
  if (cylinderActive) {
    cylinderView?.setAutoRotate(autoRotateByView["3d"]);
  }
  if (torusActive) torusView?.setAutoRotate(autoRotateByView["3d"]);

  for (const button of elements.viewButtons) {
    const active = button.dataset.viewMode === activeViewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const viewCopy = activeViewMode === "flat"
    ? torus
      ? {
          resetIcon: "↤",
          resetLabel: "重置展开",
          primaryGesture: "任意方向拖动",
          secondaryGesture: "上下左右循环 · 支持斜向",
        }
      : {
          resetIcon: "↤",
          resetLabel: "重置展开",
          primaryGesture: "横向拖动",
          secondaryGesture: "改变展开起点",
        }
    : activeViewMode === "arc"
      ? {
          resetIcon: "↤",
          resetLabel: "重置弧面",
          primaryGesture: "横向拖动",
          secondaryGesture: "弧面循环 · 滚轮缩放",
        }
      : {
          resetIcon: "◎",
          resetLabel: torus ? "回正甜甜圈" : "回正视角",
          primaryGesture: "拖动旋转",
          secondaryGesture: torus
            ? "观察内圈与背面 · 滚轮缩放"
            : "滚轮缩放",
        };

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
  else if (isTorusTopology()) torusView.resetView();
  else cylinderView.resetView();
});
elements.toggleRotation.addEventListener("click", () => {
  if (activeViewMode === "flat") return;
  const active = !autoRotateByView[activeViewMode];
  autoRotateByView[activeViewMode] = active;
  elements.toggleRotation.setAttribute("aria-pressed", String(active));
  if (activeViewMode === "arc") arcView.setAutoRotate(active);
  else if (isTorusTopology()) torusView.setAutoRotate(active);
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
elements.toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  gameSounds.setEnabled(soundEnabled);
  rememberSoundEnabled();
  syncSoundControl();
  if (soundEnabled) void gameSounds.unlock();
});
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
setPendingTopology(TOPOLOGY_CYLINDER);
game = new GoEngine({
  size: 19,
  topology: TOPOLOGY_CYLINDER,
  komi: 7.5,
  scoringRule: SCORING_CHINESE,
});
cylinderView = new CylinderBoard(elements.scene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
torusView = new TorusBoard(elements.torusScene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
flatView = new FlatBoard(elements.flatScene, {
  size: game.size,
  topology: game.topology,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
arcView = new ArcBoard(elements.arcScene, {
  size: game.size,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
syncTopologyPresentation();
syncSoundControl();
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

const unlockGameSounds = () => void gameSounds.unlock();
window.addEventListener("pointerdown", unlockGameSounds, { capture: true, once: true });
window.addEventListener("keydown", unlockGameSounds, { capture: true, once: true });

window.addEventListener(
  "beforeunload",
  () => {
    cancelAIThinking();
    cylinderView.destroy();
    torusView.destroy();
    flatView.destroy();
    arcView.destroy();
    roomClient.destroy();
    void gameSounds.destroy();
  },
  { once: true },
);

import "./styles.css";
import {
  BLACK,
  WHITE,
  GoEngine,
  MOVE_ERRORS,
  oppositeColor,
  PHASE_FINISHED,
  PHASE_PLAY,
  PHASE_SCORING,
  SCORING_CHINESE,
  TOPOLOGY_CYLINDER,
  TOPOLOGY_MOBIUS,
  TOPOLOGY_TORUS,
} from "./game/goEngine.js";
import {
  buildReplayFrames,
  buildReplayStateAtStep,
} from "./game/replay.js";
import { exportSgf, importSgf, SgfError } from "./game/sgf.js";
import {
  MAX_BOARD_DIMENSION,
  PUBLIC_MIN_BOARD_DIMENSION,
} from "./game/boardDimensions.js";
import {
  activeReviewCandidate,
  candidateVisitShare,
  compareReviewMove,
  createReviewCandidateState,
  formatReviewVariation,
  normalizeReviewCandidates,
  reduceReviewCandidateState,
  reviewCandidateSummary,
} from "./ai/replayReview.js";
import {
  advanceTimeControl,
  completeTimeControlTurn,
  createTimeControl,
  pauseTimeControl,
  snapshotTimeControl,
  startTimeControl,
} from "./game/timeControl.js";
import {
  DEFAULT_AI_MODEL_ID,
  formatModelDownloadProgress,
  getAIModel,
  normalizeAIModelId,
} from "./ai/modelCatalog.js";
import {
  AI_MATCH_SELF_PLAY,
  isAIControlledColor,
  normalizeAIMatchMode,
  shouldPauseAIMatchAtScoring,
  shouldRunAI,
} from "./ai/matchMode.js";
import { CylinderBoard } from "./view/CylinderBoard.js";
import { FlatBoard } from "./view/FlatBoard.js";
import { ArcBoard } from "./view/ArcBoard.js";
import { TorusBoard } from "./view/TorusBoard.js";
import { MobiusBoard } from "./view/MobiusBoard.js";
import {
  RoomClient,
  CONNECTION_STATUS,
  buildShareUrl,
  parseAppRoute,
  parseShareUrl,
} from "./multiplayer/roomClient.js";
import {
  CHAT_STICKERS,
  chatSticker,
  COORDINATE_LETTERS,
  formatBoardCoordinate,
} from "./multiplayer/chat.js";
import { sanitizeRoomCode } from "./multiplayer/protocol.js";
import { roomRevisionHasCaughtUp } from "./multiplayer/commandSync.js";
import { createGameSounds } from "./audio/gameSounds.js";
import {
  MATCH_ACTION_FINISH_SCORING,
  MATCH_ACTION_NEW_GAME,
  MATCH_ACTION_PASS,
  MATCH_ACTION_PLAY,
  MATCH_ACTION_RESIGN,
  MATCH_ACTION_RESUME_PLAY,
  MATCH_ACTION_TOGGLE_DEAD,
  MATCH_ACTION_UNDO,
  MATCH_CONTROLLER_AI,
  MATCH_CONTROLLER_HUMAN,
  MATCH_TRANSPORT_LOCAL,
  MATCH_TRANSPORT_ONLINE,
  automatedSeat,
  controllerOperatorsFromRoom,
  controllersFromRoom,
  createMatchSession,
  isHumanOnlineMatch,
  isSameBrowserHumanOnlineMatch,
  routeMatchAction,
  shouldProtectOnlineAITurn,
} from "./game/matchSession.js";
import {
  onlineNextGameTransition,
  prepareLocalNextGameAIState,
  previousGameOptions,
} from "./game/nextGameState.js";
import {
  applyDocumentTranslations,
  getLocale,
  initializeI18n,
  setLocale,
  subscribeLocale,
  translateText,
} from "./i18n.js";

initializeI18n();

const $ = (selector) => document.querySelector(selector);
const elements = {
  lobbyScreen: $("#lobby-screen"),
  gameScreen: $("#game-screen"),
  headerTopologySwitch: $(".topology-switch"),
  lobbyCreateRoom: $("#lobby-create-room"),
  lobbyJoinRoom: $("#lobby-join-room"),
  lobbyRefresh: $("#lobby-refresh"),
  lobbyStatusButtons: [...document.querySelectorAll("[data-lobby-status]")],
  lobbyTopologyFilter: $("#lobby-topology-filter"),
  lobbySizeFilter: $("#lobby-size-filter"),
  lobbyModeFilter: $("#lobby-mode-filter"),
  lobbyStatus: $("#lobby-status"),
  lobbyRoomList: $("#lobby-room-list"),
  lobbyEmpty: $("#lobby-empty"),
  boardStage: $(".board-stage"),
  viewSwitch: $(".view-switch"),
  scene: $("#scene"),
  torusScene: $("#torus-scene"),
  mobiusScene: $("#mobius-scene"),
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
  scoreStrip: $(".score-strip"),
  playControls: $("#play-controls"),
  passButton: $("#pass-button"),
  undoButton: $("#undo-button"),
  resignButton: $("#resign-button"),
  newGameButton: $("#new-game-button"),
  postGameActions: $("#post-game-actions"),
  directRematch: $("#direct-rematch"),
  adjustNextGame: $("#adjust-next-game"),
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
  exportSgf: $("#export-sgf"),
  importSgf: $("#import-sgf"),
  importSgfFile: $("#import-sgf-file"),
  aiReviewStatus: $("#ai-review-status"),
  aiReviewCurrent: $("#ai-review-current"),
  aiReviewAll: $("#ai-review-all"),
  aiReviewCancel: $("#ai-review-cancel"),
  aiReviewResult: $("#ai-review-result"),
  aiReviewMove: $("#ai-review-move"),
  aiReviewComparison: $("#ai-review-comparison"),
  aiReviewCandidates: $("#ai-review-candidates"),
  aiReviewModel: $("#ai-review-model"),
  aiReviewModelNote: $("#ai-review-model-note"),
  aiReviewEyebrow: $("#ai-review-eyebrow"),
  aiReviewTitle: $("#ai-review-title"),
  aiVariationPreview: $("#ai-variation-preview"),
  aiVariationTitle: $("#ai-variation-title"),
  aiVariationLine: $("#ai-variation-line"),
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
  customWidth: $("#custom-width"),
  customHeight: $("#custom-height"),
  scoringRule: $("#scoring-rule"),
  komi: $("#komi"),
  nextGameSetup: $("#next-game-setup"),
  nextGameContext: $("#next-game-context"),
  nextGameHint: $("#next-game-hint"),
  confirmNextGame: $("#confirm-next-game"),
  onlineMatchOptions: $("#online-match-options"),
  onlineMatchMode: $("#online-match-mode"),
  onlineMatchAiModelField: $("#online-match-ai-model-field"),
  onlineMatchAiModel: $("#online-match-ai-model"),
  timeControlPreset: $("#time-control-preset"),
  customTimeFields: $("#custom-time-fields"),
  mainTimeMinutes: $("#main-time-minutes"),
  byoYomiPeriods: $("#byo-yomi-periods"),
  byoYomiSeconds: $("#byo-yomi-seconds"),
  sizeButtons: [...document.querySelectorAll("[data-board-size]")],
  topologyButtons: [...document.querySelectorAll("[data-board-topology]")],
  resetView: $("#reset-view"),
  toggleRotation: $("#toggle-rotation"),
  resetViewIcon: $("#reset-view-icon"),
  resetViewLabel: $("#reset-view-label"),
  gesturePrimary: $("#gesture-primary"),
  gestureSecondary: $("#gesture-secondary"),
  gesturePlace: $("#gesture-place"),
  viewButtons: [...document.querySelectorAll("[data-view-mode]")],
  arcViewButton: $("#arc-view-button"),
  threeDViewLabel: $("#three-d-view-label"),
  rulesSummary: $("#rules-summary"),
  cylinderRules: $("#cylinder-rules"),
  torusRules: $("#torus-rules"),
  mobiusRules: $("#mobius-rules"),
  coordinateHint: $("#coordinate-hint"),
  newGameDialog: $("#new-game-dialog"),
  newGameSummary: $("#new-game-summary"),
  resignDialog: $("#resign-dialog"),
  resignSummary: $("#resign-summary"),
  confirmResign: $("#confirm-resign"),
  roomPanel: $("#room-panel"),
  clockPanel: $("#clock-panel"),
  blackClockCard: $("#black-clock-card"),
  whiteClockCard: $("#white-clock-card"),
  blackClockName: $("#black-clock-name"),
  whiteClockName: $("#white-clock-name"),
  blackClockStatus: $("#black-clock-status"),
  whiteClockStatus: $("#white-clock-status"),
  blackClockTime: $("#black-clock-time"),
  whiteClockTime: $("#white-clock-time"),
  blackClockPeriods: $("#black-clock-periods"),
  whiteClockPeriods: $("#white-clock-periods"),
  sidebarTabs: [...document.querySelectorAll("[data-sidebar-tab]")],
  sidebarPanels: [...document.querySelectorAll("[data-sidebar-panel]")],
  roomStatusDot: $("#room-status-dot"),
  roomMode: $("#room-mode"),
  roomTitle: $("#room-title"),
  offlineOpponentActions: $("#offline-opponent-actions"),
  openInviteButtons: [...document.querySelectorAll("[data-open-invite]")],
  joinInvitation: $("#join-invitation"),
  roomConnected: $("#room-connected"),
  roomCode: $("#room-code"),
  localRole: $("#local-role"),
  copyRoomLink: $("#copy-room-link"),
  leaveRoom: $("#leave-room"),
  blackSeat: $("#black-seat"),
  whiteSeat: $("#white-seat"),
  opponentSeatAction: $("#opponent-seat-action"),
  roomHint: $("#room-hint"),
  gameInvitationPanel: $("#game-invitation-panel"),
  gameInvitationTitle: $("#game-invitation-title"),
  gameInvitationSummary: $("#game-invitation-summary"),
  acceptGameInvitation: $("#accept-game-invitation"),
  declineGameInvitation: $("#decline-game-invitation"),
  cancelGameInvitation: $("#cancel-game-invitation"),
  attachRoomAi: $("#attach-room-ai"),
  detachRoomAi: $("#detach-room-ai"),
  chatPanel: $("#chat-panel"),
  chatConnection: $("#chat-connection"),
  chatMessages: $("#chat-messages"),
  chatEmpty: $("#chat-empty"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  chatPicker: $("#chat-picker"),
  stickerPicker: $("#sticker-picker"),
  chatEmoji: $("#chat-emoji"),
  chatSticker: $("#chat-sticker"),
  chatPoint: $("#chat-point"),
  chatSend: $("#chat-send"),
  chatStatus: $("#chat-status"),
  aiConnected: $("#ai-connected"),
  aiOpponentName: $(".ai-opponent-name"),
  aiLevelBadge: $("#ai-level-badge"),
  aiBlackSeat: $("#ai-black-seat"),
  aiWhiteSeat: $("#ai-white-seat"),
  aiHint: $("#ai-hint"),
  changeAiSettings: $("#change-ai-settings"),
  toggleAiAutoplay: $("#toggle-ai-autoplay"),
  leaveAi: $("#leave-ai"),
  aiDialog: $("#ai-dialog"),
  aiForm: $("#ai-form"),
  aiDialogEyebrow: $("#ai-dialog-eyebrow"),
  aiDialogTitle: $("#ai-dialog-title"),
  aiDialogIntro: $("#ai-dialog-intro"),
  aiModel: $("#ai-model"),
  aiModelWarning: $("#ai-model-warning"),
  aiModelWarningTitle: $("#ai-model-warning-title"),
  aiModelWarningResource: $("#ai-model-warning-resource"),
  aiModelWarningStrength: $("#ai-model-warning-strength"),
  aiMatchMode: $("#ai-match-mode"),
  aiHumanColorField: $("#ai-human-color-field"),
  aiHumanColor: $("#ai-human-color"),
  cancelAi: $("#cancel-ai"),
  startAi: $("#start-ai"),
  inviteDialog: $("#invite-dialog"),
  inviteSettingsSummary: $("#invite-settings-summary"),
  inviteAi: $("#invite-ai"),
  inviteFriend: $("#invite-friend"),
  inviteLocal: $("#invite-local"),
  inviteSelfPlay: $("#invite-self-play"),
  inviteModifySettings: $("#invite-modify-settings"),
  cancelInvite: $("#cancel-invite"),
  onlineDialog: $("#online-dialog"),
  onlineForm: $("#online-form"),
  onlineDialogEyebrow: $("#online-dialog-eyebrow"),
  onlineDialogTitle: $("#online-dialog-title"),
  onlineDialogIntro: $("#online-dialog-intro"),
  onlineBoardSummarySection: $("#online-board-summary-section"),
  onlineJoinDivider: $("#online-join-divider"),
  onlineRoomCodeField: $("#online-room-code-field"),
  playerName: $("#player-name"),
  roomCodeInput: $("#room-code-input"),
  createRoom: $("#create-room"),
  joinRoom: $("#join-room"),
  watchRoom: $("#watch-room"),
  appVersion: $("#app-version"),
  onlineError: $("#online-error"),
  cancelOnline: $("#cancel-online"),
  onlineBoardSummary: $("#online-board-summary"),
  onlineModifySettings: $("#online-modify-settings"),
  languageButtons: [...document.querySelectorAll("[data-language]")],
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

let game;
let cylinderView;
let torusView;
let mobiusView;
let flatView;
let arcView;
let activeViewMode = "arc";
const MATCH_LIFECYCLE_LOBBY = "lobby";
const MATCH_LIFECYCLE_WAITING = "waiting";
const MATCH_LIFECYCLE_PLAYING = "playing";
const MATCH_LIFECYCLE_FINISHED = "finished";
const ONLINE_MATCH_SETUP = "setup";
const ONLINE_MATCH_INVITED = "invited";
const ONLINE_MATCH_PLAYING = "playing";
const ONLINE_MATCH_FINISHED = "finished";
const ONLINE_MODE_FRIEND = "friend";
const ONLINE_MODE_HUMAN_AI = "human-ai";
const ONLINE_MODE_AI_AI = "ai-ai";
const ONLINE_MODE_LOCAL = "local";
let matchLifecycle = MATCH_LIFECYCLE_LOBBY;
let lobbyPreviewFrame = null;
let lobbyRefreshTimer = null;
let lobbyRefreshController = null;
let lobbyRooms = [];
const lobbyRoomCards = new Map();
const lobbyVisiblePreviews = new Set();
let lobbyPreviewObserver = null;
let lobbyPreviewRenderer = null;
let lobbyStatusFilter = "all";
let lobbyLoading = false;
let lobbyModulesPromise = null;
let appRouteMode = "single";
const autoRotateByView = { arc: false, "3d": false };
let moveCount = 0;
let pendingWidth = 19;
let pendingHeight = 19;
let pendingTopology = TOPOLOGY_CYLINDER;
let lastPlayedPoint = null;
let onlineRoom = null;
let onlineStateSynchronized = false;
let onlineBusy = false;
let onlineCommandPending = false;
let onlineCommandRevision = null;
let lastAnnouncedRoomRevision = null;
let rematchSetupTransport = null;
let rematchPreviewGame = null;
let chatSending = false;
let chatPointPicking = false;
let chatReferencePoint = null;
let chatReferenceFocusViews = false;
let chatReferenceTimer = null;
let lastRenderedChatKey = "";
let chatStatusMessage = "";
let chatStatusError = false;
let offlineGameState = null;
let aiActive = false;
let aiMatchMode = "human-ai";
let aiAutoplayPaused = false;
let aiHumanColor = BLACK;
let preferredAIModelId = DEFAULT_AI_MODEL_ID;
let aiGameModelId = DEFAULT_AI_MODEL_ID;
let aiThinking = false;
let aiWorker = null;
let aiWorkerModelId = null;
let aiRequestId = 0;
let aiWorkerContext = null;
let aiFailedPositionToken = null;
let replaySession = null;
let replayTimer = null;
let reviewWorker = null;
let reviewRequestId = 0;
let reviewActive = null;
let activeSidebarTab = "game";
let liveAnalysis = {
  modelId: preferredAIModelId,
  positionKey: null,
  result: null,
  message: "",
  error: false,
  manualCandidate: null,
};
let reviewCandidateState = createReviewCandidateState();
let reviewCandidateContextKey = "";
let localTimeControl = null;
let onlineClockReceivedAt = Date.now();
let clockTimer = null;

const CHAT_EMOJIS = Object.freeze([
  "😀", "😄", "😂", "😊", "🤔", "😮",
  "😭", "😎", "👍", "👏", "🙏", "🔥",
  "🎉", "🎋", "🍩", "🍵", "⚫", "⚪",
]);
const PLAYER_NAME_KEY = "bamboo-baduk-player-name";
const SOUND_ENABLED_KEY = "3d-baduk-sound-enabled";
const AI_MODEL_KEY = "3d-baduk-ai-model";
const roomClient = new RoomClient();

function savedSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function savedAIModelId() {
  try {
    return normalizeAIModelId(window.localStorage.getItem(AI_MODEL_KEY));
  } catch {
    return DEFAULT_AI_MODEL_ID;
  }
}

function rememberPreferredAIModel() {
  try {
    window.localStorage.setItem(AI_MODEL_KEY, preferredAIModelId);
  } catch {
    // Model choice remains usable for this tab when storage is unavailable.
  }
}

function browserSupportsAIModel(modelId) {
  const model = getAIModel(modelId);
  return !model.requiresWebGPU || Boolean(window.navigator?.gpu);
}

function syncAIDialogModelPresentation() {
  const model = getAIModel(elements.aiModel.value);
  const supported = browserSupportsAIModel(model.id);
  elements.aiModelWarningTitle.textContent = model.heavy
    ? `${model.name} · ${translateText("增强模型 / 高耗资源")}`
    : `${model.name} · ${translateText("快速模型 / 轻量")}`;
  elements.aiModelWarningResource.textContent = supported
    ? translateText(model.resourceNote)
    : `${translateText(model.resourceNote)} ${translateText("当前浏览器没有检测到 WebGPU，无法使用 b18，请选择 b10。")}`;
  elements.aiModelWarningStrength.textContent = translateText(model.strengthNote);
  elements.aiModelWarning.classList.toggle("heavy", model.heavy);
  elements.aiModelWarning.classList.toggle("error", !supported);
  elements.startAi.disabled = !supported;
}

let soundEnabled = savedSoundEnabled();
preferredAIModelId = savedAIModelId();
aiGameModelId = preferredAIModelId;
liveAnalysis.modelId = preferredAIModelId;
const gameSounds = createGameSounds({ enabled: soundEnabled });

const KATAGO_AI = Object.freeze({
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

const TIME_CONTROL_PRESETS = Object.freeze({
  none: null,
  blitz: Object.freeze({ mainTimeSeconds: 5 * 60, byoYomiPeriods: 3, byoYomiSeconds: 20 }),
  standard: Object.freeze({ mainTimeSeconds: 20 * 60, byoYomiPeriods: 5, byoYomiSeconds: 30 }),
  long: Object.freeze({ mainTimeSeconds: 45 * 60, byoYomiPeriods: 5, byoYomiSeconds: 60 }),
});

function sidebarPanel(name) {
  return elements.sidebarPanels.find((panel) => panel.dataset.sidebarPanel === name) ?? null;
}

function initializeSidebarPanels() {
  const moveInto = (name, selectors) => {
    const panel = sidebarPanel(name);
    if (!panel) return;
    selectors.forEach((selector) => {
      const node = document.querySelector(selector);
      if (node && node !== panel && !panel.contains(node)) panel.appendChild(node);
      if (node?.hasAttribute("data-sidebar-staged")) {
        node.removeAttribute("data-sidebar-staged");
        node.hidden = false;
      }
    });
  };
  // The existing controls keep their stable ids; only their visual grouping
  // changes, so saved games and protocol code are unaffected by the sidebar.
  moveInto("analysis", ["#ai-review-panel"]);
  moveInto("chat", ["#chat-panel"]);
  moveInto("game", [
    ".turn-card",
    "#message",
    ".score-strip",
    "#play-controls",
    "#post-game-actions",
    "#undo-request-panel",
    "#scoring-panel",
  ]);
  moveInto("record", ["#replay-button", ".record-actions", "#replay-panel"]);
  moveInto("settings", [".settings", ".rules-note", ".legal-links"]);
}

function setSidebarTab(name, { focus = false } = {}) {
  const requested = elements.sidebarTabs.some((button) => button.dataset.sidebarTab === name)
    ? name
    : "game";
  activeSidebarTab = requested;
  for (const panel of elements.sidebarPanels) {
    panel.hidden = panel.dataset.sidebarPanel !== requested;
  }
  for (const button of elements.sidebarTabs) {
    const active = button.dataset.sidebarTab === requested;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus({ preventScroll: true });
  }
  if (requested === "analysis") {
    syncAIReviewUI();
  }
  renderCurrentAnalysisPosition();
}

function activateSidebarTab(name, { focus = true } = {}) {
  if (
    name === "settings" &&
    matchLifecycle === MATCH_LIFECYCLE_FINISHED &&
    !isNextGameSetup() &&
    (!hasOnlineSession() || isOnlineHost())
  ) {
    enterNextGameSetup();
    return;
  }
  setSidebarTab(name, { focus });
}

function syncTimeControlFields() {
  elements.customTimeFields.hidden = elements.timeControlPreset.value !== "custom";
}

function selectedTimeControlConfig() {
  const preset = elements.timeControlPreset.value;
  if (preset !== "custom") return TIME_CONTROL_PRESETS[preset] ?? null;
  return {
    mainTimeSeconds: Math.max(0, Math.min(180, Math.round(Number(elements.mainTimeMinutes.value) || 0))) * 60,
    byoYomiPeriods: Math.max(1, Math.min(20, Math.round(Number(elements.byoYomiPeriods.value) || 1))),
    byoYomiSeconds: Math.max(5, Math.min(300, Math.round(Number(elements.byoYomiSeconds.value) || 30))),
  };
}

function reflectTimeControlConfig(clock) {
  if (!clock) {
    elements.timeControlPreset.value = "none";
    syncTimeControlFields();
    return;
  }
  const config = {
    mainTimeSeconds: Number(clock.mainTimeSeconds) || 0,
    byoYomiPeriods: Number(clock.byoYomiPeriods) || 0,
    byoYomiSeconds: Number(clock.byoYomiSeconds) || 0,
  };
  const preset = Object.entries(TIME_CONTROL_PRESETS).find(([, value]) =>
    value &&
    value.mainTimeSeconds === config.mainTimeSeconds &&
    value.byoYomiPeriods === config.byoYomiPeriods &&
    value.byoYomiSeconds === config.byoYomiSeconds
  )?.[0];
  elements.timeControlPreset.value = preset ?? "custom";
  elements.mainTimeMinutes.value = String(Math.round(config.mainTimeSeconds / 60));
  elements.byoYomiPeriods.value = String(Math.max(1, config.byoYomiPeriods));
  elements.byoYomiSeconds.value = String(Math.max(5, config.byoYomiSeconds || 30));
  syncTimeControlFields();
}

function colorName(color) {
  return color === BLACK ? "黑方" : "白方";
}

function liveDisplayedGame() {
  return isNextGameSetup() && rematchPreviewGame ? rematchPreviewGame : game;
}

function displayedTopology() {
  return replaySession?.frames?.[replaySession.index]?.topology ??
    liveDisplayedGame()?.topology;
}

function isTorusTopology(topology = displayedTopology()) {
  return topology === TOPOLOGY_TORUS;
}

function isMobiusTopology(topology = displayedTopology()) {
  return topology === TOPOLOGY_MOBIUS;
}

function isCylinderTopology(topology = displayedTopology()) {
  return !isTorusTopology(topology) && !isMobiusTopology(topology);
}

function topologyName(topology = displayedTopology()) {
  if (isTorusTopology(topology)) return "甜甜圈";
  if (isMobiusTopology(topology)) return "莫比乌斯";
  return "竹筒";
}

function topologySurfaceName(topology = displayedTopology()) {
  return topologyName(topology);
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatResult(result) {
  if (result?.reason === "timeout") {
    return `${colorName(result.winner)}胜 · ${colorName(result.loser)}超时`;
  }
  if (result?.reason === "resign") {
    return `${colorName(result.winner)}胜 · ${colorName(result.loser)}认输`;
  }
  if (result.winner === "draw") return "双方和棋";
  return `${colorName(result.winner)}胜 ${formatScore(result.margin)} 目`;
}

function projectedOnlineTimeControl(now = Date.now()) {
  const snapshot = onlineRoom?.timeControl;
  if (!snapshot) return null;
  if (snapshot.outcome || snapshot.activeColor === null) return cloneSerializable(snapshot);
  return snapshotTimeControl(
    {
      ...cloneSerializable(snapshot),
      activeSince: onlineClockReceivedAt,
    },
    now,
  );
}

function currentTimeControlSnapshot(now = Date.now()) {
  if (hasOnlineSession()) return projectedOnlineTimeControl(now);
  return localTimeControl ? snapshotTimeControl(localTimeControl, now) : null;
}

function currentTimeoutOutcome() {
  return hasOnlineSession()
    ? onlineRoom?.timeControl?.outcome ?? null
    : localTimeControl?.outcome ?? null;
}

function createLocalTimeControl(config, now = Date.now()) {
  localTimeControl = createTimeControl(config, { now });
  if (localTimeControl) localTimeControl = startTimeControl(localTimeControl, BLACK, now);
}

function completeLocalTimedTurn(now = Date.now()) {
  if (!localTimeControl || localTimeControl.outcome) return;
  localTimeControl = completeTimeControlTurn(
    localTimeControl,
    now,
    game.phase === PHASE_PLAY ? game.currentPlayer : null,
  );
}

function retargetLocalTimeControl({ pause = false } = {}) {
  if (!localTimeControl || localTimeControl.outcome) return;
  const now = Date.now();
  localTimeControl = pauseTimeControl(localTimeControl, now);
  if (!pause && game.phase === PHASE_PLAY) {
    localTimeControl = startTimeControl(localTimeControl, game.currentPlayer, now);
  }
}

function formatClockDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clockDisplayName(color) {
  if (hasOnlineSession()) {
    const declared = onlineController(color);
    const operator = onlineRoom?.players?.find((player) => player.id === declared?.operatorId);
    if (declared?.kind === MATCH_CONTROLLER_AI) {
      return `KataGo ${declared.modelId ?? DEFAULT_AI_MODEL_ID}`;
    }
    return operator?.name ?? roomSeat(color)?.name ?? translateText(colorName(color));
  }
  if (isAIMode()) {
    if (isAIvsAI()) return `${getAIModel(aiGameModelId).shortLabel} AI`;
    return color === aiHumanColor ? translateText("你") : getAIModel(aiGameModelId).shortLabel;
  }
  return translateText(colorName(color));
}

function syncClockUI(now = Date.now()) {
  const clock = currentTimeControlSnapshot(now);
  const timeout = clock?.outcome ?? currentTimeoutOutcome();
  const phase = timeout ? PHASE_FINISHED : game?.phase;
  const names = { [BLACK]: clockDisplayName(BLACK), [WHITE]: clockDisplayName(WHITE) };
  elements.blackClockName.textContent = names[BLACK];
  elements.whiteClockName.textContent = names[WHITE];

  for (const color of [BLACK, WHITE]) {
    const card = color === BLACK ? elements.blackClockCard : elements.whiteClockCard;
    const time = color === BLACK ? elements.blackClockTime : elements.whiteClockTime;
    const periods = color === BLACK ? elements.blackClockPeriods : elements.whiteClockPeriods;
    const status = color === BLACK ? elements.blackClockStatus : elements.whiteClockStatus;
    const active = Boolean(clock?.running && clock.activeColor === color && !timeout);
    const player = clock?.players?.[color];
    const inByoYomi = Boolean(player && player.mainTimeRemainingMs <= 0 && clock.byoYomiPeriods > 0);
    const remaining = inByoYomi
      ? player.byoYomiTimeRemainingMs
      : player?.mainTimeRemainingMs ?? 0;
    card.classList.toggle("active", active);
    card.classList.toggle("urgent", active && remaining <= 10_000);
    card.classList.toggle("timed-out", timeout?.loser === color);
    if (!clock) {
      time.textContent = "不计时";
      periods.textContent = "自由用时";
    } else if (timeout?.loser === color) {
      time.textContent = "超时";
      periods.textContent = "本局负";
    } else {
      time.textContent = formatClockDuration(remaining);
      periods.textContent = inByoYomi
        ? `读秒 · 剩 ${player.byoYomiPeriodsRemaining} 次`
        : clock.byoYomiPeriods > 0
          ? `其后 ${clock.byoYomiPeriods} × ${clock.byoYomiSeconds} 秒`
          : "绝对用时";
    }
    status.textContent = timeout
      ? timeout.winner === color ? "超时获胜" : "时间耗尽"
      : phase !== PHASE_PLAY
        ? phase === PHASE_SCORING ? "点目暂停" : "对局结束"
        : active
          ? "正在计时"
          : clock?.running
            ? "等待对方"
            : "计时暂停";
  }
}

function tickClock() {
  const now = Date.now();
  if (!hasOnlineSession() && localTimeControl && !localTimeControl.outcome) {
    const advanced = advanceTimeControl(localTimeControl, now);
    if (advanced?.outcome) {
      localTimeControl = advanced;
      cancelAIThinking();
      setMessage(`${formatResult(advanced.outcome)}。`, true);
      updateUI();
      return;
    }
  }
  syncClockUI(now);
}

function ensureLocalTimedMoveAllowed() {
  if (hasOnlineSession() || !localTimeControl) return true;
  const advanced = advanceTimeControl(localTimeControl, Date.now());
  if (!advanced?.outcome) return true;
  localTimeControl = advanced;
  cancelAIThinking();
  setMessage(`${formatResult(advanced.outcome)}。`, true);
  updateUI();
  return false;
}

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function syncLanguageControls() {
  const locale = getLocale();
  for (const button of elements.languageButtons) {
    const active = button.dataset.language === locale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (elements.viewSwitch) {
    elements.viewSwitch.dataset.torusWidthLabel = translateText("◉ 立体甜甜圈");
    elements.viewSwitch.dataset.mobiusWidthLabel = translateText("◉ 立体莫比乌斯");
  }
  elements.boardStage.dataset.chatPickHint = translateText(
    "📍 点击一个棋点引用到聊天（不会落子）",
  );
  elements.boardStage.dataset.analysisPickHint = translateText(
    "◇ 点击棋点，只在本页建立分析分支",
  );
}

function refreshLanguageDependentUI() {
  syncLanguageControls();
  lastRenderedChatKey = "";
  syncAIDialogModelPresentation();
  syncAIMatchModePresentation();
  syncSoundControl();
  buildChatPickers();
  cylinderView?.refreshLanguage?.();
  torusView?.refreshLanguage?.();
  mobiusView?.refreshLanguage?.();
  flatView?.refreshLanguage?.();
  arcView?.refreshLanguage?.();
  if (game) {
    syncTopologyPresentation();
    setViewMode(activeViewMode);
    updateUI();
  }
  if (appRouteMode === "lobby") void renderLobbyRooms();
  applyDocumentTranslations(document);
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

async function loadVersionLabel() {
  if (!elements.appVersion) return;
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    elements.appVersion.textContent = String(release.tag ?? release.version ?? "开发版");
    elements.appVersion.title = release.channel === "prerelease"
      ? "当前为预发布版本"
      : "当前发布版本";
  } catch {
    elements.appVersion.textContent = "开发版";
  }
}

function boardWidth(state = game, fallback = 19) {
  const value = state?.width ?? state?.size;
  return Number.isInteger(value) ? value : fallback;
}

function boardHeight(state = game, fallback = 19) {
  const value = state?.height ?? state?.size;
  return Number.isInteger(value) ? value : fallback;
}

function boardPointCount(state = game) {
  return boardWidth(state) * boardHeight(state);
}

function boardDimensionLabel(state = game) {
  return `${boardWidth(state)} × ${boardHeight(state)}`;
}

function sameBoardDimensions(left, right) {
  return boardWidth(left) === boardWidth(right) && boardHeight(left) === boardHeight(right);
}

function isReplaying() {
  return replaySession !== null;
}

function replaySource() {
  if (replaySession?.source) return cloneSerializable(replaySession.source);
  if (!hasStartedMatch()) return null;
  if (hasOnlineSession() && onlineRoom?.replay) {
    return cloneSerializable(onlineRoom.replay);
  }
  if (typeof game?.getReplayState === "function") {
    const replay = game.getReplayState();
    if (localTimeControl?.outcome) replay.outcome = cloneSerializable(localTimeControl.outcome);
    return replay;
  }
  return null;
}

function replayEventCount(source = replaySource()) {
  return Array.isArray(source?.events)
    ? source.events.filter((event) => ["play", "pass"].includes(event?.type)).length
    : 0;
}

function replayMetadataForExport() {
  if (replaySession?.metadata) return cloneSerializable(replaySession.metadata);
  if (hasOnlineSession()) {
    return {
      blackPlayer: roomSeat(BLACK)?.name ?? "黑方",
      whitePlayer: roomSeat(WHITE)?.name ?? "白方",
      result: onlineRoom?.game?.result ?? onlineRoom?.timeControl?.outcome ?? null,
      scoreConfirmations: onlineRoom?.scoreConfirmations ?? [],
    };
  }
  if (isAIMode()) {
    const aiName = `${currentAIName()} ${getAIModel(aiGameModelId).shortLabel}`;
    return {
      blackPlayer: isAIvsAI() || aiHumanColor === WHITE ? aiName : "人类玩家",
      whitePlayer: isAIvsAI() || aiHumanColor === BLACK ? aiName : "人类玩家",
      result: game?.result ?? currentTimeoutOutcome() ?? null,
    };
  }
  return {
    blackPlayer: "黑方",
    whitePlayer: "白方",
    result: game?.result ?? currentTimeoutOutcome() ?? null,
  };
}

function safeRecordFilenamePart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "game";
}

function sgfImportWarningSummary(warnings) {
  const labels = {
    IGNORED_GAMES: "只导入了棋谱集合中的第一局",
    IGNORED_VARIATIONS: "只导入了主分支",
    IGNORED_MIDGAME_SETUP: "忽略了中盘摆子",
    IGNORED_MIDGAME_PLAYER: "忽略了中盘改行棋方",
    NON_ALTERNATING_MOVE: "棋谱中存在非交替行棋",
    UNKNOWN_RULE: "未知规则已按日本规则解释",
    NON_FF4: "已按 FF[4] 兼容方式解析",
    CHARSET_ASSUMED_UTF8: "文本已按 UTF-8 读取",
    LEGACY_TT_PASS: "已兼容旧式 tt 停着",
    MISSING_SIZE: "缺少尺寸，已按 19 × 19 解释",
    MISSING_GM: "缺少棋类标记，已按围棋解释",
    NORMALIZED_PROPERTY_ID: "属性名已规范化",
  };
  const relevant = (Array.isArray(warnings) ? warnings : [])
    .filter((item) => item?.code !== "TOPOLOGY_ASSUMED");
  if (relevant.length === 0) return "";
  const details = [...new Set(relevant.map((item) => labels[item?.code]).filter(Boolean))];
  const visible = details.slice(0, 2);
  const hiddenCount = Math.max(0, relevant.length - visible.length);
  const detailText = visible.length > 0 ? visible.join("；") : "存在格式兼容处理";
  return ` 兼容提示：${detailText}${hiddenCount ? `（另有 ${hiddenCount} 项）` : ""}。`;
}

function exportCurrentSgf() {
  const source = replaySource();
  if (!source) {
    setMessage("当前棋局没有可导出的棋谱。", true);
    return;
  }
  try {
    const metadata = replayMetadataForExport();
    const { sgf, warnings } = exportSgf({
      replay: source,
      metadata,
      scoreConfirmations: metadata.scoreConfirmations,
      extensionEvents: replaySession?.extensionEvents ?? [],
    });
    const base = source.base ?? game;
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").slice(0, 13);
    const filename = [
      "3d-baduk",
      safeRecordFilenamePart(base.topology ?? "cylinder"),
      `${boardWidth(base)}x${boardHeight(base)}`,
      stamp,
    ].join("-") + ".sgf";
    const url = URL.createObjectURL(new Blob([sgf], { type: "application/x-go-sgf;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(
      warnings.length > 0
        ? `已导出 ${filename}。普通 SGF 阅读器可读取棋步；异形接缝保存在 X* 扩展属性中。`
        : `已导出 ${filename}。`,
    );
  } catch (error) {
    console.error("Unable to export SGF", error);
    setMessage(`导出 SGF 失败：${error.message || "棋谱格式无法生成"}`, true);
  }
}

async function importSgfFile(file) {
  if (!file) return;
  if (isNextGameSetup()) {
    elements.importSgfFile.value = "";
    setMessage("请先开始下一局，或留在当前终局后再导入棋谱。", true);
    return;
  }
  try {
    if (file.size > 2 * 1024 * 1024) {
      throw new SgfError("棋谱文件不能超过 2 MiB。", "SGF_TOO_LARGE");
    }
    const parsed = importSgf(await file.text(), { defaultTopology: pendingTopology });
    if (isReplaying()) exitReplay({ announce: false });
    enterReplay(parsed.replay, {
      imported: true,
      sourceName: file.name,
      warnings: parsed.warnings,
      metadata: parsed.metadata,
      extensionEvents: parsed.extensionEvents,
      extensions: parsed.extensions,
    });
    if (!isReplaying()) return;
    replaySession.metadata = parsed.metadata;
    replaySession.extensionEvents = parsed.extensionEvents;
    const assumed = parsed.warnings.some((item) => item.code === "TOPOLOGY_ASSUMED");
    const warningSummary = sgfImportWarningSummary(parsed.warnings);
    setMessage(
      assumed
        ? `已导入 ${file.name}：原谱未写异形拓扑，按当前选择的${topologyName(parsed.metadata.topology)}复盘。${warningSummary}`
        : `已导入 ${file.name}，共 ${replayEventCount(parsed.replay)} 手；可播放、切换视图或做 AI 分析。${warningSummary}`,
    );
  } catch (error) {
    console.error("Unable to import SGF", error);
    const reason = error instanceof SgfError ? error.message : "文件不是可识别的 SGF 棋谱";
    setMessage(`导入 SGF 失败：${reason}`, true);
    maybeStartAITurn();
  } finally {
    elements.importSgfFile.value = "";
  }
}

function formatReviewMove(move, height = boardHeight()) {
  if (move?.type === "pass") return "停一手";
  if (move?.type !== "play") return "—";
  const letter = COORDINATE_LETTERS[move.col] || String(move.col + 1);
  return `${letter}${height - move.row}`;
}

function currentChatMessages() {
  return Array.isArray(onlineRoom?.chat?.messages)
    ? onlineRoom.chat.messages
    : [];
}

function activeBoardView() {
  if (activeViewMode === "flat") return flatView;
  if (activeViewMode === "arc") return arcView;
  if (isTorusTopology()) return torusView;
  if (isMobiusTopology()) return mobiusView;
  return cylinderView;
}

function syncReferenceFocusRotationState() {
  if (activeViewMode === "flat") return;
  autoRotateByView[activeViewMode] = false;
  elements.toggleRotation.setAttribute("aria-pressed", "false");
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
  name.className = message.senderColor === BLACK ? "black-name" : "white-name";
  name.dataset.i18nIgnore = "";
  name.textContent = `${message.senderName} · ${translateText(colorName(message.senderColor))}`;
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
  elements.chatPanel.hidden = false;
  elements.chatForm.hidden = !active;
  elements.chatEmpty.textContent = active
    ? "还没有消息，先和对手打个招呼吧。"
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
  const canSend = connected && isOnlinePlayer() && !chatSending;
  if (!connected || !isOnlinePlayer()) {
    chatPointPicking = false;
    elements.boardStage.classList.remove("chat-coordinate-picking");
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
  chatPointPicking = Boolean(enabled) && roomClient.isConnected && isOnlinePlayer();
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
  setChatStatus(`已引用 📍 ${label}；发送后双方都能点击定位。`);
}

async function sendChatPayload(payload, { clearText = false } = {}) {
  if (!roomClient.isConnected || !isOnlinePlayer() || chatSending) return;
  chatSending = true;
  setChatStatus("正在发送…");
  syncChatUI();
  try {
    await roomClient.sendChat(payload);
    if (clearText) elements.chatInput.value = "";
    closeChatPickers();
    setChatStatus("");
  } catch (error) {
    setChatStatus(error.message || "消息发送失败，请稍后重试。", true);
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

function applyOnlineChat({ message, chat }) {
  if (!onlineRoom || !message) return;
  onlineRoom = { ...onlineRoom, chat };
  lastRenderedChatKey = "";
  syncChatUI();
  if (
    message.senderId !== currentIdentity().playerId &&
    Array.isArray(message.points) &&
    message.points.length > 0 &&
    messageMatchesCurrentBoard(message)
  ) {
    focusChatPoint(message, message.points[0], {
      announce: false,
      moveCamera: false,
    });
    setChatStatus(
      `${message.senderName} 提到了 📍 ${message.points[0].label}，已标记；点击坐标可转到该处。`,
    );
  }
}

function resetChatSessionState({ clearDraft = true } = {}) {
  chatSending = false;
  chatPointPicking = false;
  chatReferencePoint = null;
  chatReferenceFocusViews = false;
  lastRenderedChatKey = "";
  setChatStatus("");
  if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
  chatReferenceTimer = null;
  elements.boardStage.classList.remove("chat-coordinate-picking");
  closeChatPickers();
  if (clearDraft) elements.chatInput.value = "";
}

function livePositionKey(state = game?.getState?.()) {
  if (!state) return "";
  return JSON.stringify([
    boardWidth(state),
    boardHeight(state),
    state.topology,
    state.currentPlayer,
    state.phase,
    moveCount,
    state.board,
  ]);
}

function isLiveOnlineFairPlayLocked() {
  const session = currentMatchSession();
  return Boolean(
    isHumanOnlineMatch(session) && session.player &&
      onlineRoom?.game?.phase !== PHASE_FINISHED && !onlineRoom?.timeControl?.outcome,
  );
}

function canAnalyzeLivePosition() {
  if (!hasStartedMatch() || !game || game.phase !== PHASE_PLAY || currentTimeoutOutcome()) return false;
  if (onlineAITurnNeedsController()) return false;
  // Live AI help is deliberately unavailable to either online player. A room
  // spectator gets an entirely local analysis copy that never enters the room
  // command protocol or changes the authoritative game.
  return !isLiveOnlineFairPlayLocked();
}

function currentAnalysisRecord() {
  if (replaySession) return replaySession.analysisByStep.get(replaySession.index) ?? null;
  if (isLiveOnlineFairPlayLocked()) return null;
  return liveAnalysis.positionKey === livePositionKey() ? liveAnalysis.result : null;
}

function currentReviewModel() {
  return getAIModel(
    replaySession?.analysisModelId ?? liveAnalysis.modelId ?? preferredAIModelId,
  );
}

function reviewStageText(active = reviewActive) {
  if (!active) return "";
  const model = getAIModel(active.modelId);
  const prefix = active.context === "live"
    ? `${hasOnlineSession() ? "观战局面" : "当前局面"} · `
    : active.mode === "batch" && replaySession?.analysisBatch
      ? `整局分析 ${replaySession.analysisBatch.completed} / ${replaySession.analysisBatch.total} · 第 ${active.step} 手 · `
      : `第 ${active.step} 手 · `;
  if (active.stage === "loading_model") {
    const progress = Number.isFinite(active.loadedBytes) && active.loadedBytes > 0
      ? ` · ${formatModelDownloadProgress(active.loadedBytes, model.id)}`
      : "";
    return `${prefix}载入 KataGo ${model.shortLabel} 模型（${model.downloadLabel}）${progress}…`;
  }
  if (active.stage === "neural_inference") {
    return `${prefix}神经网络正在观察局面…`;
  }
  if (active.stage === "searching") {
    const topology = active.context === "live"
      ? game?.topology
      : replaySession?.frames?.[active.step]?.topology;
    return `${prefix}正在按${topologyName(topology)}规则短搜索…`;
  }
  return `${prefix}正在准备分析…`;
}

function terminateReviewWorker() {
  reviewWorker?.terminate();
  reviewWorker = null;
}

function cancelReplayAIReview({ terminate = false, announce = false } = {}) {
  const cancelledContext = reviewActive?.context ?? (replaySession?.analysisBatch ? "replay" : null);
  const wasRunning = Boolean(reviewActive || replaySession?.analysisBatch);
  // A cooperative cancel cannot interrupt a model fetch, decompression, or a
  // WebGPU dispatch. Terminate an actively working thread so stopping b18 also
  // stops its network, memory, and GPU work immediately. Keep an idle worker
  // alive so its already-loaded model can still be reused for the next step.
  const shouldTerminate = terminate || Boolean(reviewActive);
  if (reviewActive && reviewWorker) {
    reviewWorker.postMessage({ type: "cancel", id: reviewActive.id });
  }
  reviewRequestId += 1;
  reviewActive = null;
  if (replaySession) {
    replaySession.analysisBatch = null;
    if (announce && wasRunning && cancelledContext !== "live") {
      replaySession.analysisMessage = "AI 分析已停止，已完成的结果仍然保留。";
    }
  }
  if (announce && wasRunning && cancelledContext === "live") {
    liveAnalysis.message = "AI 分析已停止，当前已有结果仍然保留。";
    liveAnalysis.error = false;
  }
  if (shouldTerminate) terminateReviewWorker();
}

function handleReviewWorkerMessage(event) {
  const message = event.data ?? {};
  if (!reviewActive || message.id !== reviewActive.id) return;

  if (message.type === "status") {
    reviewActive.stage = message.stage;
    reviewActive.backend = message.backend ?? reviewActive.backend;
    reviewActive.loadedBytes = message.loadedBytes ?? reviewActive.loadedBytes;
    syncAIReviewUI();
    return;
  }

  const completed = reviewActive;
  reviewActive = null;

  if (message.type === "result") {
    if (completed.context === "live") {
      if (!replaySession && completed.positionKey === livePositionKey()) {
        liveAnalysis.positionKey = completed.positionKey;
        liveAnalysis.result = {
          move: cloneSerializable(message.move),
          stats: cloneSerializable(message.stats ?? {}),
          mode: "current",
        };
        liveAnalysis.message = "";
        liveAnalysis.error = false;
        liveAnalysis.manualCandidate = null;
        reviewCandidateState = createReviewCandidateState();
        reviewCandidateContextKey = "";
        updateUI();
      } else {
        liveAnalysis.message = "棋局已经变化，刚才的分析结果已自动丢弃。";
        liveAnalysis.error = false;
        syncAIReviewUI();
      }
      return;
    }
    if (!replaySession) return;
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

  if (completed.context === "live") {
    liveAnalysis.message = `AI 局势分析暂时失败：${message.message || "分析线程返回错误"}`;
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
  if (!replaySession) return;
  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `AI 复盘暂时失败：${message.message || "分析线程返回错误"}`;
  replaySession.analysisError = true;
  syncAIReviewUI();
}

function handleReviewWorkerError(event) {
  if (!reviewActive) return;
  const failed = reviewActive;
  reviewActive = null;
  terminateReviewWorker();
  if (failed.context === "live") {
    liveAnalysis.message = `AI 局势分析线程没有正常启动：${event.message || "未知错误"}`;
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
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

function replayStepIsTerminal(step) {
  if (!replaySession) return true;
  const frame = replaySession.frames[step];
  if (!frame || frame.phase !== PHASE_PLAY) return true;
  const atEnd = step === replaySession.frames.length - 1;
  return atEnd && Boolean(String(replaySession.metadata?.result ?? "").trim());
}

function startReviewAtStep(step, mode) {
  if (!replaySession) return false;
  if (isLiveOnlineFairPlayLocked()) {
    replaySession.analysisBatch = null;
    replaySession.analysisMessage = "在线对局尚未结束；为保证公平，比赛双方暂不能使用 AI 复盘。";
    replaySession.analysisError = true;
    syncAIReviewUI();
    return false;
  }
  const frame = replaySession.frames[step];
  if (replayStepIsTerminal(step)) return false;
  if (typeof Worker !== "function") {
    replaySession.analysisBatch = null;
    replaySession.analysisMessage = "当前浏览器不支持后台 AI 复盘。";
    replaySession.analysisError = true;
    syncAIReviewUI();
    return false;
  }
  const model = currentReviewModel();
  if (!browserSupportsAIModel(model.id)) {
    replaySession.analysisBatch = null;
    replaySession.analysisMessage =
      "KataGo b18 需要桌面端 WebGPU；当前浏览器不支持，请改选 b10。";
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
  reviewActive = {
    id,
    context: "replay",
    step,
    mode,
    modelId: model.id,
    stage: "preparing",
  };
  replaySession.analysisError = false;
  worker.postMessage({
    type: "think",
    id,
    modelId: model.id,
    state,
    options: {
      difficulty: "hard",
      timeLimitMs: settings.timeMs,
      maxIterations: settings.maxIterations,
      rolloutLimit: Math.min(settings.rolloutLimit, boardPointCount(frame) * 2),
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

function analyzeCurrentLivePosition() {
  if (replaySession) return;
  if (!canAnalyzeLivePosition()) {
    liveAnalysis.message = onlineAITurnNeedsController()
      ? "在线 AI 正在代表白方行棋；请等它落子后再分析，避免房主页面抢占推理资源。"
      : hasOnlineSession() && isOnlinePlayer()
        ? "为保证对局公平，在线黑白双方不能在实战中开启 AI；旁观者与复盘可以使用。"
        : "当前局面已经进入点目或终局，AI 不再推荐落子。";
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
  if (typeof Worker !== "function") {
    liveAnalysis.message = "当前浏览器不支持后台 AI 局势分析。";
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
  const model = currentReviewModel();
  if (!browserSupportsAIModel(model.id)) {
    liveAnalysis.message = "KataGo b18 需要桌面端 WebGPU；当前浏览器不支持，请改选 b10。";
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }

  cancelReplayAIReview();
  let state;
  let worker;
  try {
    state = game.exportState({ includeReplay: false });
    worker = ensureReviewWorker();
  } catch (error) {
    liveAnalysis.message = `无法复制当前局面：${error.message}`;
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }

  const positionKey = livePositionKey();
  const id = ++reviewRequestId;
  reviewActive = {
    id,
    context: "live",
    mode: "current",
    modelId: model.id,
    positionKey,
    stage: "preparing",
  };
  liveAnalysis.positionKey = positionKey;
  liveAnalysis.result = null;
  liveAnalysis.message = "";
  liveAnalysis.error = false;
  liveAnalysis.manualCandidate = null;
  worker.postMessage({
    type: "think",
    id,
    modelId: model.id,
    state,
    options: {
      difficulty: "hard",
      timeLimitMs: AI_REVIEW_CURRENT.timeMs,
      maxIterations: AI_REVIEW_CURRENT.maxIterations,
      rolloutLimit: Math.min(AI_REVIEW_CURRENT.rolloutLimit, boardPointCount(state) * 2),
    },
  });
  syncAIReviewUI();
}

function analyzeCurrentPosition() {
  setSidebarTab("analysis");
  if (replaySession) analyzeCurrentReplayStep();
  else analyzeCurrentLivePosition();
}

function analyzeWholeReplay() {
  if (!replaySession) return;
  if (isLiveOnlineFairPlayLocked()) {
    replaySession.analysisMessage = "在线对局尚未结束；为保证公平，比赛双方暂不能使用 AI 复盘。";
    replaySession.analysisError = true;
    syncAIReviewUI();
    return;
  }
  const model = currentReviewModel();
  if (
    model.heavy &&
    !window.confirm(translateText(
      "使用 b18 分析整局会反复占用大量显存和内存，耗电、发热和等待时间都会明显增加。确定继续吗？",
    ))
  ) {
    return;
  }
  stopReplayPlayback();
  cancelReplayAIReview();
  const steps = replaySession.steps
    .map((_, index) => index)
    .filter((index) => !replayStepIsTerminal(index));
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

function enterReplay(sourceOverride = null, options = {}) {
  if (isReplaying()) return;
  if (isNextGameSetup()) {
    setMessage("下一局设置期间不能进入复盘；请先确认开局。", true);
    return;
  }
  const source = sourceOverride?.events ? sourceOverride : replaySource();
  if (!source || replayEventCount(source) === 0) {
    setMessage("至少下一手棋后，才能开始复盘。", true);
    return;
  }
  if (onlineAITurnNeedsController()) {
    setMessage(
      "在线 AI 正在房主浏览器中行棋；请等它落子后再进入复盘，避免对局和计时被意外中断。",
      true,
    );
    return;
  }

  try {
    if (aiThinking || aiWorker) cancelAIThinking();
    cancelReplayAIReview({ terminate: true });
    const replay = buildReplayFrames(cloneSerializable(source));
    if (!Array.isArray(replay.frames) || replay.frames.length < 2) {
      throw new TypeError("棋谱中没有可播放的棋步");
    }
    const analysisModelId = isAIMode() ? aiGameModelId : preferredAIModelId;
    const analysisByStep = new Map();
    replaySession = {
      source: cloneSerializable(source),
      frames: replay.frames,
      steps: replay.steps,
      complete: replay.complete !== false,
      index: 0,
      playing: false,
      analysisModelId,
      analysisByStep,
      analysisByModel: new Map([[analysisModelId, analysisByStep]]),
      analysisBatch: null,
      analysisMessage: "",
      analysisError: false,
      imported: Boolean(options.imported),
      sourceName: String(options.sourceName ?? ""),
      warnings: Array.isArray(options.warnings) ? [...options.warnings] : [],
      metadata: options.metadata ? cloneSerializable(options.metadata) : null,
      extensionEvents: Array.isArray(options.extensionEvents)
        ? cloneSerializable(options.extensionEvents)
        : [],
      extensions: options.extensions ? cloneSerializable(options.extensions) : null,
    };
    const firstFrame = replay.frames[0];
    if (!sameBoardDimensions(firstFrame, game) || firstFrame.topology !== game.topology) {
      rebuildViews(boardWidth(firstFrame), boardHeight(firstFrame), firstFrame.topology);
    }
    elements.coordinateHint.textContent = "";
    updateUI();
    setSidebarTab("record");
    elements.replayPlay.focus({ preventScroll: true });
  } catch (error) {
    console.error("Unable to start replay", error);
    setMessage("这份棋谱暂时无法复盘，请继续当前对局或建立新棋盘。", true);
    maybeStartAITurn();
  }
}

function setReplayAnalysisModel(modelId) {
  const normalized = normalizeAIModelId(modelId);
  if (!replaySession) {
    if (normalized === liveAnalysis.modelId) {
      syncAIReviewUI();
      return;
    }
    cancelReplayAIReview({ terminate: true });
    liveAnalysis = {
      modelId: normalized,
      positionKey: null,
      result: null,
      message: browserSupportsAIModel(normalized)
        ? `已切换到 ${getAIModel(normalized).name}；请重新分析当前局面。`
        : "当前浏览器没有检测到 WebGPU，b18 无法运行，请改选 b10。",
      error: !browserSupportsAIModel(normalized),
      manualCandidate: null,
    };
    preferredAIModelId = normalized;
    rememberPreferredAIModel();
    reviewCandidateState = createReviewCandidateState();
    reviewCandidateContextKey = "";
    updateUI();
    return;
  }
  if (normalized === replaySession.analysisModelId) {
    syncAIReviewUI();
    return;
  }
  cancelReplayAIReview({ terminate: true });
  replaySession.analysisModelId = normalized;
  if (!replaySession.analysisByModel.has(normalized)) {
    replaySession.analysisByModel.set(normalized, new Map());
  }
  replaySession.analysisByStep = replaySession.analysisByModel.get(normalized);
  preferredAIModelId = normalized;
  rememberPreferredAIModel();
  const model = getAIModel(normalized);
  replaySession.analysisMessage = browserSupportsAIModel(normalized)
    ? `已切换到 ${model.name}；不同模型的分析结果会分别保留。`
    : "当前浏览器没有检测到 WebGPU，b18 无法运行，请改选 b10。";
  replaySession.analysisError = !browserSupportsAIModel(normalized);
  updateUI();
}

function exitReplay({ announce = true } = {}) {
  if (!isReplaying()) return;
  clearReplayTimer();
  cancelReplayAIReview({ terminate: true });
  replaySession = null;
  rebuildViews(boardWidth(), boardHeight(), game.topology);
  if (["record", "analysis"].includes(activeSidebarTab)) setSidebarTab("game");
  if (announce) setMessage("已退出复盘，回到当前棋局。");
  updateUI();
  elements.replayButton.focus({ preventScroll: true });
  if (announce) maybeStartAITurn();
}

function hasOnlineSession() {
  return Boolean(roomClient.session && roomClient.roomCode);
}

function onlineMatchStatus(room = onlineRoom) {
  const status = room?.match?.status;
  if ([
    ONLINE_MATCH_SETUP,
    ONLINE_MATCH_INVITED,
    ONLINE_MATCH_PLAYING,
    ONLINE_MATCH_FINISHED,
  ].includes(status)) return status;
  if (room?.game?.phase === PHASE_FINISHED || room?.timeControl?.outcome) {
    return ONLINE_MATCH_FINISHED;
  }
  return room?.players?.some((player) => player.color === BLACK) &&
    room?.players?.some((player) => player.color === WHITE)
    ? ONLINE_MATCH_PLAYING
    : ONLINE_MATCH_SETUP;
}

function onlineController(color, room = onlineRoom) {
  const value = room?.match?.controllers?.[color];
  if (
    value &&
    [MATCH_CONTROLLER_HUMAN, MATCH_CONTROLLER_AI].includes(value.kind)
  ) return value;
  const legacySeat = room?.players?.find((player) => player.color === color);
  if (!legacySeat) return null;
  return {
    kind: automatedSeat(room, color) ? MATCH_CONTROLLER_AI : MATCH_CONTROLLER_HUMAN,
    operatorId: legacySeat.controllerId ?? legacySeat.id ?? null,
    ...(legacySeat.modelId ? { modelId: legacySeat.modelId } : {}),
  };
}

function onlineControllersReady(room = onlineRoom) {
  return [BLACK, WHITE].every((color) => Boolean(onlineController(color, room)?.operatorId));
}

function isLocalLobby() {
  return !hasOnlineSession() && matchLifecycle === MATCH_LIFECYCLE_LOBBY;
}

function isNextGameSetup() {
  return Boolean(rematchSetupTransport && rematchPreviewGame);
}

function isOnlineNextGameSetup() {
  return Boolean(
    hasOnlineSession() && rematchSetupTransport === MATCH_TRANSPORT_ONLINE && rematchPreviewGame,
  );
}

function isLocalNextGameSetup() {
  return Boolean(
    !hasOnlineSession() && rematchSetupTransport === MATCH_TRANSPORT_LOCAL && rematchPreviewGame,
  );
}

function isBoardSetupMode() {
  return isLocalLobby() || isNextGameSetup();
}

function hasMatchGame() {
  return matchLifecycle !== MATCH_LIFECYCLE_LOBBY;
}

function hasStartedMatch() {
  return [MATCH_LIFECYCLE_PLAYING, MATCH_LIFECYCLE_FINISHED].includes(matchLifecycle);
}

function syncLifecycleFromCurrentGame() {
  if (isNextGameSetup()) return;
  if (matchLifecycle === MATCH_LIFECYCLE_LOBBY && !hasOnlineSession()) return;
  if (hasOnlineSession() && onlineRoom?.match) {
    const status = onlineMatchStatus();
    matchLifecycle = status === ONLINE_MATCH_PLAYING
      ? MATCH_LIFECYCLE_PLAYING
      : status === ONLINE_MATCH_FINISHED
        ? MATCH_LIFECYCLE_FINISHED
        : MATCH_LIFECYCLE_WAITING;
    return;
  }
  if (game?.phase === PHASE_FINISHED || currentTimeoutOutcome()) {
    matchLifecycle = MATCH_LIFECYCLE_FINISHED;
    return;
  }
  if (hasOnlineSession() && !onlineControllersReady()) {
    matchLifecycle = MATCH_LIFECYCLE_WAITING;
    return;
  }
  matchLifecycle = MATCH_LIFECYCLE_PLAYING;
}

function isAIMode() {
  return aiActive && !hasOnlineSession();
}

function currentControllersByColor() {
  if (hasOnlineSession()) return controllersFromRoom(onlineRoom);
  if (!aiActive) {
    return { [BLACK]: MATCH_CONTROLLER_HUMAN, [WHITE]: MATCH_CONTROLLER_HUMAN };
  }
  if (normalizeAIMatchMode(aiMatchMode) === AI_MATCH_SELF_PLAY) {
    return { [BLACK]: MATCH_CONTROLLER_AI, [WHITE]: MATCH_CONTROLLER_AI };
  }
  return {
    [BLACK]: aiHumanColor === BLACK ? MATCH_CONTROLLER_HUMAN : MATCH_CONTROLLER_AI,
    [WHITE]: aiHumanColor === WHITE ? MATCH_CONTROLLER_HUMAN : MATCH_CONTROLLER_AI,
  };
}

function onlineAISeat(color = null) {
  const colors = color ? [color] : [BLACK, WHITE];
  for (const candidate of colors) {
    const controller = onlineController(candidate);
    if (controller?.kind !== MATCH_CONTROLLER_AI) continue;
    const operator = onlineRoom?.players?.find(
      (player) => player.id === controller.operatorId,
    );
    return {
      id: `controller:${candidate}`,
      name: `KataGo ${controller.modelId ?? DEFAULT_AI_MODEL_ID} AI`,
      role: "ai",
      color: candidate,
      automated: true,
      modelId: controller.modelId ?? DEFAULT_AI_MODEL_ID,
      controllerId: controller.operatorId,
      online: operator?.online !== false,
    };
  }
  return null;
}

function isOnlineAIMatch() {
  return hasOnlineSession() && Boolean(onlineAISeat());
}

function isOnlineAIController() {
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id;
  return Boolean(identityId && [BLACK, WHITE].some((color) => {
    const controller = onlineController(color);
    return controller?.kind === MATCH_CONTROLLER_AI &&
      controller.operatorId === identityId;
  }));
}

function currentMatchSession() {
  const online = hasOnlineSession();
  const identity = online ? currentIdentity() : {};
  const controllers = currentControllersByColor();
  const controllerOperators = online
    ? controllerOperatorsFromRoom(onlineRoom)
    : { [BLACK]: null, [WHITE]: null };
  const onlineReady = online && onlineStateSynchronized &&
    onlineRoom?.code === roomClient.roomCode && Boolean(onlineRoom?.game);
  const localUndoAvailable = isAIMode() ? canUndoAIChoice() : Boolean(game?.canUndo?.());
  return createMatchSession({
    transport: online ? MATCH_TRANSPORT_ONLINE : MATCH_TRANSPORT_LOCAL,
    controllerByColor: controllers,
    controllerOperatorByColor: controllerOperators,
    identity,
    room: onlineRoom,
    hasGame: hasMatchGame(),
    started: hasStartedMatch(),
    phase: game?.phase,
    currentPlayer: game?.currentPlayer,
    connected: roomClient.isConnected,
    roomReady: onlineReady,
    busy: onlineBusy,
    commandPending: onlineCommandPending,
    bothSeats: online ? onlineControllersReady() : true,
    whiteSeat: online ? roomSeat(WHITE) : null,
    undoAvailable: online ? onlineRoom?.undoAvailable === true : localUndoAvailable,
    undoRequest: online ? currentUndoRequest() : null,
    replaying: isReplaying(),
    timedOut: Boolean(currentTimeoutOutcome()),
  });
}

function onlineAITurnNeedsController() {
  return shouldProtectOnlineAITurn(currentMatchSession(), isOnlineAIController());
}

function onlineAIPositionExpectation() {
  return {
    expectedMoveCount: moveCount,
    ...(onlineRoom?.positionToken
      ? { expectedPositionToken: onlineRoom.positionToken }
      : { expectedRevision: onlineRoom?.revision }),
  };
}

function isAIvsAI() {
  return isAIMode() && normalizeAIMatchMode(aiMatchMode) === AI_MATCH_SELF_PLAY;
}

function currentAIName() {
  return `KataGo ${topologyName()}混合 AI`;
}

function aiColor() {
  return aiHumanColor === BLACK ? WHITE : BLACK;
}

function aiControlsColor(color) {
  return isAIControlledColor({
    active: isAIMode(),
    mode: aiMatchMode,
    humanColor: aiHumanColor,
    color,
  });
}

function isAITurn() {
  return shouldRunAI({
    active: isAIMode(),
    mode: aiMatchMode,
    humanColor: aiHumanColor,
    color: game?.currentPlayer,
    phase: game?.phase,
    paused: aiAutoplayPaused,
    replaying: isReplaying(),
  });
}

function isOnlineAITurn() {
  const seat = onlineAISeat(game?.currentPlayer);
  return Boolean(
    seat &&
      isOnlineAIController() &&
      roomClient.isConnected &&
      onlineStateSynchronized &&
      onlineRoom?.code === roomClient.roomCode &&
      onlineRoom?.game &&
      game?.phase === PHASE_PLAY &&
      !currentTimeoutOutcome() &&
      !currentUndoRequest() &&
      !onlineCommandPending &&
      !isReplaying(),
  );
}

function shouldRunCurrentAI() {
  return isAITurn() || isOnlineAITurn();
}

function syncLastPlayedPoint() {
  lastPlayedPoint = game?.lastMove?.type === "play"
    ? { row: game.lastMove.row, col: game.lastMove.col }
    : null;
}

function canUndoAIChoice() {
  if (!isAIMode() || !game?.canUndo()) return false;
  if (isAIvsAI()) return aiAutoplayPaused && !aiThinking;
  const firstHumanMoveNumber = aiHumanColor === WHITE ? 2 : 1;
  return moveCount >= firstHumanMoveNumber;
}

function syncAIMatchModePresentation() {
  const mode = normalizeAIMatchMode(elements.aiMatchMode.value);
  const onlineSeatMode = hasOnlineSession();
  elements.aiMatchMode.closest(".dialog-field").hidden = onlineSeatMode;
  elements.aiHumanColorField.hidden = onlineSeatMode || mode === AI_MATCH_SELF_PLAY;
  elements.aiDialogEyebrow.textContent = onlineSeatMode ? "在线 AI 座位" : "本机 AI 对手";
  elements.aiDialogTitle.textContent = onlineSeatMode
    ? onlineAISeat(WHITE) ? "调整房间里的 KataGo" : "让 KataGo 接替白方"
    : "让人类或 KataGo 下一盘";
  elements.aiDialogIntro.textContent = onlineSeatMode
    ? "AI 仍在房主浏览器中运行，服务器只验证落子并同步给观众。接入后请保持房主页面在线。"
    : "模型会在浏览器后台观察全盘，再按当前棋盘的接缝规则搜索落点。无需账号或第三方 API，服务器不承担推理。";
  elements.startAi.textContent = onlineSeatMode
    ? onlineAISeat(WHITE) ? "更新在线 AI" : "接入白方座位"
    : isAIMode() ? "按新设置重开" : "开始对局";
}

function cancelAIThinking() {
  aiRequestId += 1;
  aiWorker?.terminate();
  aiWorker = null;
  aiWorkerModelId = null;
  aiThinking = false;
  aiWorkerContext = null;
  elements.boardStage?.removeAttribute("aria-busy");
}

function closeAIDialog() {
  if (typeof elements.aiDialog.close === "function") elements.aiDialog.close();
  else elements.aiDialog.removeAttribute("open");
}

function showAIDialog() {
  if (hasOnlineSession()) {
    const white = roomSeat(WHITE);
    if (!isOnlineHost()) {
      setMessage("只有在线房间的黑方房主可以把空缺白方接入 AI。", true);
      return;
    }
    if (white && !onlineAISeat(WHITE)) {
      setMessage("白方已经由真人加入，不能再接入 AI。", true);
      return;
    }
  }
  elements.aiMatchMode.value = aiMatchMode;
  elements.aiHumanColor.value = aiHumanColor;
  elements.aiModel.value = hasOnlineSession()
    ? normalizeAIModelId(onlineAISeat(WHITE)?.modelId ?? preferredAIModelId)
    : isAIMode() ? aiGameModelId : preferredAIModelId;
  syncAIDialogModelPresentation();
  syncAIMatchModePresentation();
  if (typeof elements.aiDialog.showModal === "function") {
    if (!elements.aiDialog.open) elements.aiDialog.showModal();
  } else {
    elements.aiDialog.setAttribute("open", "");
  }
}

function applyAIMove(move, stats = {}) {
  if (!isAITurn()) return;
  if (!["play", "pass"].includes(move?.type)) {
    recoverFromAIError("KataGo 返回了无效落点。");
    return;
  }
  void dispatchMatchAction(
    move.type === "pass" ? MATCH_ACTION_PASS : MATCH_ACTION_PLAY,
    move,
    { actor: MATCH_CONTROLLER_AI, stats },
  );
}

async function applyOnlineAIMove(move, stats = {}, context = aiWorkerContext) {
  if (
    !context ||
    context.kind !== MATCH_TRANSPORT_ONLINE ||
    !isOnlineAITurn() ||
    context.roomCode !== roomClient.roomCode ||
    context.positionToken !== onlineRoom?.positionToken ||
    context.moveCount !== moveCount ||
    context.color !== game.currentPlayer
  ) {
    maybeStartAITurn();
    return;
  }
  const expectation = {
    expectedMoveCount: context.moveCount,
    expectedPositionToken: context.positionToken,
  };
  const payload = move?.type === "play"
    ? { row: move.row, col: move.col, ...expectation }
    : expectation;
  if (!["play", "pass"].includes(move?.type)) {
    recoverFromAIError("KataGo 返回了无法提交的在线棋步。");
    return;
  }
  aiWorkerContext = null;
  const sent = await dispatchMatchAction(
    move.type === "pass" ? MATCH_ACTION_PASS : MATCH_ACTION_PLAY,
    payload,
    { actor: MATCH_CONTROLLER_AI, stats },
  );
  if (!sent) {
    setMessage("在线 AI 的棋步没有提交成功，将按最新局面重新判断。", true);
    maybeStartAITurn();
  }
}

function recoverFromAIError(message) {
  const onlineContext = aiWorkerContext?.kind === MATCH_TRANSPORT_ONLINE;
  if (!isAITurn() && !onlineContext) return;
  const failedToken = onlineContext ? aiWorkerContext?.positionToken : null;
  cancelAIThinking();
  if (onlineContext) {
    aiFailedPositionToken = failedToken;
    setMessage(
      `${message} 在线 AI 座位仍然保留；请保持房主页面在线，或打开 AI 设置重试/更换模型。`,
      true,
    );
    updateUI();
    return;
  }
  aiActive = false;
  setMessage(
    `${message} 已退出 AI 对局并保留当前棋局；现在可以本地轮流落子，或重新开始 KataGo 对局。`,
    true,
  );
  updateUI();
}

function handleAIWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.id !== aiRequestId) return;
  if (message.type === "status") {
    const model = getAIModel(aiWorkerContext?.modelId ?? aiGameModelId);
    if (message.stage === "loading_model") {
      const progress = Number.isFinite(message.loadedBytes) && message.loadedBytes > 0
        ? ` · ${formatModelDownloadProgress(message.loadedBytes, model.id)}`
        : "";
      setMessage(
        `正在载入 KataGo ${model.shortLabel} 神经网络 · ${model.downloadLabel}${progress}…`,
      );
    } else if (message.stage === "neural_inference") {
      setMessage(`KataGo 正在观察整盘棋 · ${message.backend ?? "浏览器"} 推理…`);
    } else if (message.stage === "searching") {
      setMessage(`神经判断完成，正在按${topologyName()}规则验证与搜索…`);
    }
    return;
  }

  const context = aiWorkerContext;
  const keepWorker = message.type === "result";
  if (!keepWorker) {
    aiWorker?.terminate();
    aiWorker = null;
  }
  aiThinking = false;
  elements.boardStage.removeAttribute("aria-busy");
  if (message.type === "result") {
    if (context?.kind === MATCH_TRANSPORT_ONLINE) {
      void applyOnlineAIMove(message.move, message.stats, context);
    } else {
      applyAIMove(message.move, message.stats);
    }
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
  if (!shouldRunCurrentAI() || aiThinking) return;

  const onlineTurn = isOnlineAITurn();
  const onlineSeat = onlineTurn ? onlineAISeat(game.currentPlayer) : null;
  if (onlineTurn && aiFailedPositionToken === onlineRoom?.positionToken) return;
  const modelId = onlineTurn
    ? normalizeAIModelId(onlineSeat?.modelId)
    : aiGameModelId;
  if (!browserSupportsAIModel(modelId)) {
    aiWorkerContext = {
      kind: onlineTurn ? MATCH_TRANSPORT_ONLINE : MATCH_TRANSPORT_LOCAL,
      positionToken: onlineRoom?.positionToken ?? null,
    };
    recoverFromAIError(`${getAIModel(modelId).name} 需要 WebGPU，当前浏览器无法运行。`);
    return;
  }
  if (aiWorker && aiWorkerModelId && aiWorkerModelId !== modelId) {
    cancelAIThinking();
  }

  aiThinking = true;
  elements.boardStage.setAttribute("aria-busy", "true");
  setMessage(`${currentAIName()} 正在${onlineTurn ? "房主浏览器中" : ""}思考…`);
  updateUI();
  const requestId = ++aiRequestId;
  aiWorkerContext = onlineTurn
    ? {
        kind: MATCH_TRANSPORT_ONLINE,
        roomCode: roomClient.roomCode,
        positionToken: onlineRoom.positionToken,
        moveCount,
        color: game.currentPlayer,
        modelId,
      }
    : { kind: MATCH_TRANSPORT_LOCAL, modelId };

  window.setTimeout(() => {
    if (requestId !== aiRequestId || !shouldRunCurrentAI()) return;
    if (typeof Worker !== "function") {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      recoverFromAIError("当前浏览器不支持后台 AI 计算。");
      return;
    }

    let worker;
    let state;
    try {
      worker = ensureAIWorker();
      // Rebuild online state from the authoritative replay so superko history
      // is preserved. If a partial snapshot ever arrives, fail this AI turn
      // cleanly instead of throwing from the delayed callback.
      state = onlineTurn && onlineRoom?.replay
        ? buildReplayStateAtStep(onlineRoom.replay, moveCount)
        : game.exportState({ includeReplay: false });
    } catch (error) {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      recoverFromAIError(error.message || "AI 无法读取当前棋局。");
      return;
    }
    const level = KATAGO_AI;
    aiWorkerModelId = modelId;
    worker.postMessage({
      type: "think",
      id: requestId,
      modelId,
      // Search clones the state many times and never needs the historical
      // replay timeline. Keep the AI payload and its inner loops bounded as a
      // real game grows longer.
      state,
      options: {
        difficulty: "hard",
        timeLimitMs: level.timeMs,
        maxIterations: level.maxIterations,
        rolloutLimit: Math.min(level.rolloutLimit, boardPointCount() * 2),
      },
    });
  }, 120);
}

async function startAIGame(event) {
  event?.preventDefault();
  if (matchLifecycle === MATCH_LIFECYCLE_FINISHED || isNextGameSetup()) {
    closeAIDialog();
    setMessage("本局已经结束；请使用“直接进行下一局”或“调整下一局设置”。", true);
    updateUI();
    return;
  }
  const requestedModelId = normalizeAIModelId(elements.aiModel.value);
  if (!browserSupportsAIModel(requestedModelId)) {
    syncAIDialogModelPresentation();
    setMessage("当前浏览器没有检测到 WebGPU，无法使用 b18；请选择 b10。", true);
    return;
  }
  cancelAIThinking();
  preferredAIModelId = requestedModelId;
  aiGameModelId = requestedModelId;
  rememberPreferredAIModel();
  if (hasOnlineSession()) {
    const hadOnlineAI = Boolean(onlineAISeat(WHITE));
    if (!isOnlineHost() || (roomSeat(WHITE) && !onlineAISeat(WHITE))) {
      closeAIDialog();
      setMessage("当前白方座位不能接入 AI。", true);
      return;
    }
    cancelAIThinking();
    aiFailedPositionToken = null;
    closeAIDialog();
    setMessage(`正在把 KataGo ${getAIModel(requestedModelId).shortLabel} 接入在线白方座位…`);
    const sent = await sendOnlineCommand("attach_ai", { modelId: requestedModelId });
    // Updating/retrying an existing seat stops its old worker first. If the
    // command is rejected, resume the still-authoritative seat instead of
    // leaving the room frozen until another snapshot happens to arrive.
    if (!sent && hadOnlineAI) maybeStartAITurn();
    return;
  }
  aiMatchMode = normalizeAIMatchMode(elements.aiMatchMode.value);
  aiHumanColor = elements.aiHumanColor.value === WHITE ? WHITE : BLACK;
  aiAutoplayPaused = false;
  aiActive = true;
  matchLifecycle = MATCH_LIFECYCLE_PLAYING;
  closeAIDialog();
  await startNewGame();
  setMessage(
    isAIvsAI()
      ? `AI 自对弈已开始：黑白双方都由 ${currentAIName()} 控制。`
      : aiHumanColor === BLACK
        ? `AI 对局已开始：你执黑，${currentAIName()} 执白。`
        : `AI 对局已开始：${currentAIName()} 执黑，正在思考第一手。`,
  );
  updateUI();
  maybeStartAITurn();
}

async function detachOnlineAI() {
  if (!isOnlineHost() || !onlineAISeat(WHITE)) return;
  if (!window.confirm(translateText("移除在线 AI 后白方座位会重新开放，当前棋局会保留。确定继续吗？"))) return;
  cancelAIThinking();
  setMessage("正在移除在线 AI…");
  const sent = await sendOnlineCommand("detach_ai");
  // A failed removal leaves the server-side AI seat intact.
  if (!sent) maybeStartAITurn();
}

function leaveAIGame() {
  if (!isAIMode()) return;
  returnToLocalLobby("已退出 AI 对战，回到我的房间；可以重新邀请对局。");
}

async function startLocalTwoPlayerGame() {
  closeInviteDialog();
  cancelAIThinking();
  cancelReplayAIReview({ terminate: true });
  aiActive = false;
  aiAutoplayPaused = false;
  matchLifecycle = MATCH_LIFECYCLE_PLAYING;
  await startNewGame();
  setMessage("本地双人对局已开始：黑白双方在这台设备上轮流落子。");
  updateUI();
}

function toggleAIAutoplay() {
  if (!isAIvsAI() || game.phase !== PHASE_PLAY) return;
  aiAutoplayPaused = !aiAutoplayPaused;
  if (aiAutoplayPaused) {
    if (aiThinking) cancelAIThinking();
    retargetLocalTimeControl({ pause: true });
    setMessage("AI 自对弈已暂停；可以复盘、切换视图或悔一步。", false);
  } else {
    retargetLocalTimeControl();
    setMessage("AI 自对弈继续。", false);
  }
  updateUI();
  if (!aiAutoplayPaused) maybeStartAITurn();
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
  if (!isOnlinePlayer()) return false;
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id;
  const controller = onlineController(game.currentPlayer);
  return Boolean(
    controller?.kind === MATCH_CONTROLLER_HUMAN &&
    controller.operatorId === identityId,
  );
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
  return currentMatchSession().capabilities.play;
}

function syncMovePreviewAvailability() {
  const enabled = canShowMovePreview();
  cylinderView?.setMovePreviewEnabled(enabled);
  torusView?.setMovePreviewEnabled(enabled);
  mobiusView?.setMovePreviewEnabled(enabled);
  flatView?.setMovePreviewEnabled(enabled);
  arcView?.setMovePreviewEnabled(enabled);
}

function hydratePublicGame(state) {
  const hydrated = new GoEngine({
    ...(Number.isInteger(state.size) ? { size: state.size } : {}),
    width: boardWidth(state),
    height: boardHeight(state),
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

function onlineRoomPath(code, role = "") {
  const url = new URL(buildShareUrl(code, window.location.href));
  if (["player", "spectator"].includes(role)) url.searchParams.set("role", role);
  return `${url.pathname}${url.search}`;
}

function replaceAppPath(path) {
  window.history.replaceState(null, "", new URL(path, window.location.origin));
}

function navigateAppPath(path) {
  window.location.assign(new URL(path, window.location.origin));
}

function loadLobbyModules() {
  if (!lobbyModulesPromise) {
    lobbyModulesPromise = Promise.all([
      import("./multiplayer/lobby.js"),
      import("./multiplayer/lobbyClient.js"),
      import("./multiplayer/lobbyPreview.js"),
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

function lobbyUpdatedLabel(updatedAt) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1_000));
  if (elapsedSeconds < 60) return "刚刚更新";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`;
  return `${Math.floor(elapsedSeconds / 3_600)} 小时前`;
}

function appendLobbyMetadata(container, text) {
  const item = document.createElement("span");
  item.textContent = text;
  container.append(item);
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
  header.append(title, status);

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

  footer.append(activity, actions);
  card.append(header, body, footer);
  card.__lobbyElements = {
    title,
    status,
    metadata,
    blackName,
    whiteName,
    canvas,
    activity,
    actions,
  };
  return card;
}

function updateLobbyRoomCard(card, room) {
  const view = card.__lobbyElements;
  card.dataset.roomCode = room.code;
  view.title.textContent = `房间 ${room.code}`;
  view.status.className = `lobby-room-status-badge ${room.status}`;
  view.status.textContent = lobbyStatusLabel(room.status);

  view.metadata.replaceChildren();
  appendLobbyMetadata(view.metadata, `${room.width} × ${room.height}`);
  appendLobbyMetadata(view.metadata, lobbyTopologyLabel(room.topology));
  appendLobbyMetadata(view.metadata, lobbyModeLabel(room.mode));
  if (room.timed) appendLobbyMetadata(view.metadata, "计时");
  if (room.roundNumber > 0) appendLobbyMetadata(view.metadata, `第 ${room.roundNumber} 局`);
  appendLobbyMetadata(view.metadata, room.moveCount > 0 ? `${room.moveCount} 手` : "空盘");

  view.blackName.textContent = room.players?.find((player) => player.color === BLACK)?.name || "等待黑方";
  view.whiteName.textContent = room.players?.find((player) => player.color === WHITE)?.name || "等待白方";
  view.activity.textContent = `${room.spectatorCount || 0} 人观战 · ${lobbyUpdatedLabel(room.updatedAt)}`;

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
  if (!resumable && room.watchable) {
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = "secondary-button";
    watch.dataset.lobbyRoom = room.code;
    watch.dataset.lobbyRole = "spectator";
    watch.textContent = "观战";
    view.actions.append(watch);
  }

  view.canvas.__lobbyRoomSummary = room;
  if (lobbyVisiblePreviews.has(view.canvas)) drawLobbyRoomPreview(view.canvas);
  else if (lobbyPreviewObserver) lobbyPreviewObserver.observe(view.canvas);
  else {
    lobbyVisiblePreviews.add(view.canvas);
    drawLobbyRoomPreview(view.canvas);
  }
}

async function renderLobbyRooms() {
  if (appRouteMode !== "lobby") return;
  const { filterLobbyRooms, renderLobbyBoardPreview } = await loadLobbyModules();
  lobbyPreviewRenderer = renderLobbyBoardPreview;
  ensureLobbyPreviewObserver();
  const filtered = filterLobbyRooms(lobbyRooms, {
    status: lobbyStatusFilter,
    topology: elements.lobbyTopologyFilter.value,
    size: elements.lobbySizeFilter.value,
    mode: elements.lobbyModeFilter.value,
  });
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
}

async function refreshLobby({ announce = false } = {}) {
  if (appRouteMode !== "lobby" || lobbyLoading) return;
  lobbyLoading = true;
  lobbyRefreshController?.abort();
  lobbyRefreshController = new AbortController();
  elements.lobbyRefresh.disabled = true;
  elements.lobbyStatus.classList.remove("error");
  if (announce || !lobbyRooms.length) elements.lobbyStatus.textContent = "正在读取公开房间…";
  try {
    const { fetchLobbyRooms } = await loadLobbyModules();
    lobbyRooms = await fetchLobbyRooms({ signal: lobbyRefreshController.signal });
    await renderLobbyRooms();
    elements.lobbyStatus.textContent = `共 ${lobbyRooms.length} 个公开房间 · 自动刷新`;
  } catch (error) {
    if (error?.cause?.name === "AbortError") return;
    elements.lobbyStatus.textContent = error?.message || "暂时无法读取在线大厅。";
    elements.lobbyStatus.classList.add("error");
    await renderLobbyRooms();
  } finally {
    lobbyLoading = false;
    elements.lobbyRefresh.disabled = false;
  }
}

function stopLobbyRefresh() {
  if (lobbyRefreshTimer !== null) {
    window.clearInterval(lobbyRefreshTimer);
    lobbyRefreshTimer = null;
  }
  lobbyRefreshController?.abort();
  lobbyRefreshController = null;
  lobbyLoading = false;
}

function startLobbyRefresh() {
  if (lobbyRefreshTimer !== null) return;
  void refreshLobby({ announce: true });
  lobbyRefreshTimer = window.setInterval(() => void refreshLobby(), 8_000);
}

function showAppScreen(mode) {
  appRouteMode = mode === "lobby" ? "lobby" : mode === "online" ? "online" : "single";
  const lobbyVisible = appRouteMode === "lobby";
  elements.lobbyScreen.hidden = !lobbyVisible;
  elements.gameScreen.hidden = lobbyVisible;
  elements.headerTopologySwitch.hidden = lobbyVisible;
  if (lobbyVisible) {
    startLobbyRefresh();
    return;
  }
  stopLobbyRefresh();
  window.requestAnimationFrame(() => {
    cylinderView?.resize?.();
    torusView?.resize?.();
    mobiusView?.resize?.();
    flatView?.resize?.();
    arcView?.resize?.();
  });
}

function updateRoomUrl(code = "") {
  if (code) {
    replaceAppPath(onlineRoomPath(code));
    showAppScreen("online");
    return;
  }
  replaceAppPath("/single");
  showAppScreen("single");
}

function setOnlineBusy(busy, action = "") {
  onlineBusy = busy;
  elements.createRoom.disabled = busy;
  elements.joinRoom.disabled = busy;
  elements.watchRoom.disabled = busy;
  elements.createRoom.textContent = busy && action === "create" ? "正在创建…" : "创建房间";
  elements.joinRoom.textContent = busy && action === "join" ? "正在加入…" : "加入房间";
  elements.watchRoom.textContent = busy && action === "watch" ? "正在进入观战…" : "进入观战";
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

function onlineBoardSummaryText() {
  const width = normalizeBoardDimension(elements.customWidth.value);
  const height = normalizeBoardDimension(elements.customHeight.value);
  const rule = elements.scoringRule.value === "japanese" ? "日本规则" : "中国规则";
  const clock = selectedTimeControlConfig();
  const clockLabel = clock
    ? `${Math.round(clock.mainTimeSeconds / 60)} 分钟 + ${clock.byoYomiPeriods}×${clock.byoYomiSeconds} 秒`
    : "不计时";
  return `${width} × ${height} · ${topologySurfaceName(pendingTopology)} · ${rule} · ${clockLabel}`;
}

function syncLobbySettingsSummary() {
  const summary = onlineBoardSummaryText();
  if (elements.inviteSettingsSummary) elements.inviteSettingsSummary.textContent = summary;
  if (elements.onlineBoardSummary) elements.onlineBoardSummary.textContent = summary;
}

function closeInviteDialog() {
  if (!elements.inviteDialog) return;
  if (typeof elements.inviteDialog.close === "function") elements.inviteDialog.close();
  else elements.inviteDialog.removeAttribute("open");
}

function showInviteDialog() {
  if (hasOnlineSession()) {
    setMessage("请先退出当前联机房间，再邀请一场新对局。", true);
    return;
  }
  if (!isLocalLobby()) {
    setMessage("请先结束当前对局并返回房间，再邀请下一局。", true);
    return;
  }
  if (isReplaying()) exitReplay({ announce: false });
  syncLobbySettingsSummary();
  if (typeof elements.inviteDialog?.showModal === "function") {
    if (!elements.inviteDialog.open) elements.inviteDialog.showModal();
  } else {
    elements.inviteDialog?.setAttribute("open", "");
  }
}

function showOnlineDialog(roomCode = "", { intent = "all" } = {}) {
  const creating = intent === "create";
  const entering = ["join", "player", "spectator"].includes(intent);
  const spectatorOnly = intent === "spectator";
  const playerOnly = intent === "player";

  elements.playerName.value = elements.playerName.value || savedPlayerName();
  if (roomCode) elements.roomCodeInput.value = sanitizeRoomCode(roomCode);
  syncLobbySettingsSummary();
  showOnlineError();
  elements.onlineDialogEyebrow.textContent = creating
    ? "创建在线房间"
    : spectatorOnly
      ? "进入观战"
      : playerOnly
        ? "申请对手席位"
        : "在线对局";
  elements.onlineDialogTitle.textContent = creating
    ? "创建一个 3D 棋局"
    : spectatorOnly
      ? `观战房间 ${sanitizeRoomCode(roomCode)}`
      : playerOnly
        ? `加入房间 ${sanitizeRoomCode(roomCode)}`
        : "进入 3D 棋局";
  elements.onlineDialogIntro.textContent = creating
    ? "先创建房间；进入后可以在棋盘设置中配置棋局并邀请对手。"
    : spectatorOnly
      ? "普通分享链接默认只进入观战，不会占用黑白座位。"
      : playerOnly
        ? "大厅确认该房间有空位；服务器仍会在进入时再次核验座位。"
        : "输入房间号后，可以申请对手席位，也可以只进入观战。";
  elements.onlineBoardSummarySection.hidden = intent !== "all";
  elements.createRoom.hidden = entering;
  elements.onlineJoinDivider.hidden = intent !== "all";
  elements.onlineRoomCodeField.hidden = creating;
  elements.joinRoom.hidden = creating || spectatorOnly;
  elements.watchRoom.hidden = creating || playerOnly;
  elements.cancelOnline.textContent = appRouteMode === "online" ? "返回大厅" : "取消";
  if (typeof elements.onlineDialog.showModal === "function") {
    if (!elements.onlineDialog.open) elements.onlineDialog.showModal();
  } else {
    elements.onlineDialog.setAttribute("open", "");
  }
  window.setTimeout(() => {
    const target = !elements.playerName.value
      ? elements.playerName
      : creating
        ? elements.createRoom
        : roomCode
          ? spectatorOnly
            ? elements.watchRoom
            : elements.joinRoom
          : elements.roomCodeInput;
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

function onlineModeLabel(mode = onlineRoom?.match?.mode) {
  return {
    [ONLINE_MODE_FRIEND]: "好友对局",
    [ONLINE_MODE_HUMAN_AI]: "在线人机",
    [ONLINE_MODE_AI_AI]: "在线 AI 对弈",
    [ONLINE_MODE_LOCAL]: "在线同机双人",
  }[mode] ?? "在线房间";
}

function onlineControllerSeat(color) {
  const controller = onlineController(color);
  if (!controller) return { text: `等待${colorName(color)}`, online: false };
  const operator = onlineRoom?.players?.find((player) => player.id === controller.operatorId);
  if (controller.kind === MATCH_CONTROLLER_AI) {
    return {
      text: `KataGo ${controller.modelId ?? DEFAULT_AI_MODEL_ID} · AI`,
      online: operator?.online !== false,
    };
  }
  const sameDevice = onlineController(oppositeColor(color))?.operatorId === controller.operatorId;
  return {
    text: operator
      ? `${operator.name}${sameDevice ? " · 同机" : ""}${operator.online ? " · 在线" : " · 暂时离线"}`
      : `等待${colorName(color)}`,
    online: Boolean(operator?.online),
  };
}

function onlineWhiteSeatIsOpen() {
  if (!onlineRoom || roomSeat(WHITE)) return false;
  const controller = onlineController(WHITE);
  return !controller || (
    controller.kind === MATCH_CONTROLLER_HUMAN && !controller.operatorId
  );
}

function onlineInvitationSummary(request = onlineRoom?.match?.request) {
  if (!request?.settings) return "等待被邀请方回应。";
  const settings = request.settings;
  return `${settings.width} × ${settings.height} · ${topologySurfaceName(settings.topology)} · ${
    settings.scoringRule === "japanese" ? "日本规则" : "中国规则"
  }`;
}

function updateRoomUI() {
  const active = hasOnlineSession();
  const aiMode = isAIMode();
  const lobby = isLocalLobby();
  const rematchSetup = isNextGameSetup();
  const roomMatchStatus = active ? onlineMatchStatus() : null;
  const waiting = active && [ONLINE_MATCH_SETUP, ONLINE_MATCH_INVITED].includes(roomMatchStatus);
  const match = currentMatchSession();
  const onlineAi = active ? onlineAISeat() : null;
  const reviewing = isReplaying();
  const timedOut = Boolean(currentTimeoutOutcome());
  const connected = roomClient.connectionStatus === CONNECTION_STATUS.CONNECTED;
  const onlineReady = active && onlineStateSynchronized &&
    onlineRoom?.code === roomClient.roomCode && Boolean(onlineRoom.game);
  const identity = currentIdentity();
  const spectatorCount = (onlineRoom?.spectators ?? []).filter(
    (spectator) => spectator.online !== false,
  ).length;
  const scoreConfirmations = onlineRoom?.scoreConfirmations ?? [];
  const ownScoreConfirmed = scoreConfirmations.includes(identity.color);
  const hasBothPlayers = active ? onlineControllersReady() : true;
  const undoRequest = currentUndoRequest();
  const ownUndoRequest = isOwnUndoRequest(undoRequest);
  const connecting = [
    CONNECTION_STATUS.CREATING,
    CONNECTION_STATUS.JOINING,
    CONNECTION_STATUS.CONNECTING,
    CONNECTION_STATUS.RECONNECTING,
  ].includes(roomClient.connectionStatus);
  const onlineControlsAvailable = onlineReady && connected && !onlineBusy && !onlineCommandPending;

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
    ? onlineAi ? "在线人机房间" : "在线房间"
    : aiMode
      ? isAIvsAI() ? "AI 自对弈" : "AI 对战"
      : lobby ? "我的房间" : "本地双人";
  elements.roomTitle.textContent = active
    ? onlineAi ? "和 KataGo 对弈，朋友可以观战" : "和朋友共享同一盘棋"
    : aiMode
      ? isAIvsAI()
        ? "KataGo 同时控制黑白双方"
        : `你执${colorName(aiHumanColor).replace("方", "")} · AI 执${colorName(aiColor()).replace("方", "")}`
      : lobby ? "还没有发起对局" : "双方在同一台设备轮流落子";
  if (active) {
    elements.roomMode.textContent = onlineModeLabel();
    elements.roomTitle.textContent = roomMatchStatus === ONLINE_MATCH_SETUP
      ? "设置并发起一盘新棋"
      : roomMatchStatus === ONLINE_MATCH_INVITED
        ? "对局邀请等待回应"
        : onlineAi
          ? "KataGo 在浏览器运行，朋友可以观战"
          : "房间对局已同步给所有成员";
  }
  elements.offlineOpponentActions.hidden = !lobby || reviewing;
  elements.roomConnected.hidden = !active;
  elements.aiConnected.hidden = !aiMode;
  if (elements.scoreStrip) {
    elements.scoreStrip.hidden = (lobby || waiting || rematchSetup) && !reviewing;
  }
  elements.clockPanel.hidden = reviewing || rematchSetup || [
    MATCH_LIFECYCLE_LOBBY,
    MATCH_LIFECYCLE_WAITING,
  ].includes(matchLifecycle);

  if (aiMode) {
    elements.aiOpponentName.textContent = isAIvsAI() ? "KataGo AI 自对弈" : currentAIName();
    elements.aiLevelBadge.textContent = getAIModel(aiGameModelId).badgeLabel;
    elements.aiBlackSeat.textContent = isAIvsAI()
      ? `AI · 黑方 · ${getAIModel(aiGameModelId).shortLabel}`
      : aiHumanColor === BLACK ? "你 · 黑方" : "AI · 黑方";
    elements.aiWhiteSeat.textContent = isAIvsAI()
      ? `AI · 白方 · ${getAIModel(aiGameModelId).shortLabel}`
      : aiHumanColor === WHITE ? "你 · 白方" : "AI · 白方";
    elements.toggleAiAutoplay.hidden = !isAIvsAI();
    elements.toggleAiAutoplay.textContent = aiAutoplayPaused ? "继续对弈" : "暂停对弈";
    elements.toggleAiAutoplay.disabled = reviewing || game.phase !== PHASE_PLAY;
    if (game.phase === PHASE_SCORING) {
      elements.aiHint.textContent = isAIvsAI()
        ? "AI 自对弈已停在点目阶段：系统已预标明确死棋，请核对死活与领地。"
        : "点目中：系统已预标明确死棋，请核对死活与领地。";
    } else if (isAIvsAI() && aiAutoplayPaused) {
      elements.aiHint.textContent = "AI 自对弈已暂停；可以悔一步、复盘或切换视图。";
    } else if (aiThinking) {
      elements.aiHint.textContent = `${currentAIName()} 正在思考。你仍可旋转或切换视图。`;
    } else if (game.phase === PHASE_FINISHED) {
      elements.aiHint.textContent = "本局已经结束；可以直接进行下一局，或先调整下一局设置。";
    } else if (isAIvsAI()) {
      elements.aiHint.textContent = `${colorName(game.currentPlayer)} AI 正在准备下一手。`;
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
      ? onlineAISeat(WHITE)
        ? `${white.name} · AI · ${white.online ? "房主页面在线" : "等待房主页面"}`
        : `${white.name}${white.online ? " · 在线" : " · 暂时离线"}`
      : "等待白方加入";
    elements.blackSeat.parentElement.classList.toggle("connected-seat", Boolean(black?.online));
    elements.blackSeat.parentElement.classList.toggle("disconnected-seat", Boolean(black && !black.online));
    elements.whiteSeat.parentElement.classList.toggle("connected-seat", Boolean(white?.online));
    elements.whiteSeat.parentElement.classList.toggle("disconnected-seat", Boolean(white && !white.online));

    const blackControllerSeat = onlineControllerSeat(BLACK);
    const whiteControllerSeat = onlineControllerSeat(WHITE);
    elements.blackSeat.textContent = blackControllerSeat.text;
    elements.whiteSeat.textContent = whiteControllerSeat.text;
    elements.blackSeat.parentElement.classList.toggle("connected-seat", blackControllerSeat.online);
    elements.blackSeat.parentElement.classList.toggle("disconnected-seat", !blackControllerSeat.online);
    elements.whiteSeat.parentElement.classList.toggle("connected-seat", whiteControllerSeat.online);
    elements.whiteSeat.parentElement.classList.toggle("disconnected-seat", !whiteControllerSeat.online);

    const canClaimWhiteSeat = Boolean(
      connected && onlineReady && identity.role === "spectator" && onlineWhiteSeatIsOpen(),
    );
    const canReleaseWhiteSeat = Boolean(
      connected && onlineReady && identity.role === "player" && identity.color === WHITE &&
      [ONLINE_MATCH_SETUP, ONLINE_MATCH_FINISHED].includes(roomMatchStatus),
    );
    elements.opponentSeatAction.hidden = !canClaimWhiteSeat && !canReleaseWhiteSeat;
    elements.opponentSeatAction.dataset.action = canReleaseWhiteSeat ? "release_seat" : "claim_seat";
    elements.opponentSeatAction.textContent = canReleaseWhiteSeat
      ? "释放席位，继续旁观"
      : "成为白方";
    elements.opponentSeatAction.disabled = !onlineControlsAvailable;

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
      elements.roomHint.textContent = "你正在旁观；可切换到“分析”，在本页研究候选与分支。";
    } else if (rematchSetup) {
      elements.roomHint.textContent = isOnlineHost()
        ? "正在当前房间设置下一局；确认后会同步给所有玩家和观众。"
        : "黑方房主正在设置下一局；聊天和房间成员都会保留。";
    } else if (!hasBothPlayers) {
      elements.roomHint.textContent = isOnlineHost()
        ? "把邀请链接发给朋友，或让 KataGo 接替空缺的白方座位。"
        : "等待白方加入后即可对弈。";
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
        elements.roomHint.textContent = "点目中：系统已预标明确死棋并显示领地；双方核对后确认。";
      }
    } else if (game.phase === PHASE_FINISHED) {
      elements.roomHint.textContent = isOnlineHost()
        ? "本局已结束；可以直接进行下一局，或先调整下一局设置；成员和聊天记录都会保留。"
        : "本局已结束；等待黑方房主直接开始或调整下一局设置。";
    } else {
      elements.roomHint.textContent = isOnlineTurn()
        ? "轮到你了。"
        : onlineAISeat(game.currentPlayer)
          ? "KataGo 正在房主浏览器中思考；服务器会验证并同步棋步。"
          : `等待${colorName(game.currentPlayer)}落子。`;
    }
    if (connected && onlineReady && roomMatchStatus === ONLINE_MATCH_SETUP) {
      elements.roomHint.textContent = isOnlineHost()
        ? "房间已经建立。请在棋盘设置中确认配置并发起对局。"
        : "房主正在准备下一盘棋；你可以继续聊天或等待邀请。";
    } else if (connected && onlineReady && roomMatchStatus === ONLINE_MATCH_INVITED) {
      const request = onlineRoom?.match?.request;
      const identityId = identity.playerId ?? identity.id;
      elements.roomHint.textContent = request?.requestedBy === identityId
        ? "邀请已发出，等待对方接受或拒绝。"
        : request?.controllers?.white?.operatorId === identityId
          ? "房主发来了对局邀请，请接受或拒绝。"
          : "这盘棋正在等待受邀玩家回应。";
    }
    if (connected && onlineReady && canClaimWhiteSeat) {
      elements.roomHint.textContent = "白方席位目前空缺；点击“成为白方”即可加入对局，其他观众仍可继续旁观。";
    } else if (connected && onlineReady && canReleaseWhiteSeat) {
      elements.roomHint.textContent = "你当前占用白方席位；如果不参加下一局，可以释放席位并继续旁观。";
    }
    if (spectatorCount > 0) {
      elements.roomHint.textContent += ` · ${spectatorCount} 人观战`;
    }
  }

  const gameRequest = active ? onlineRoom?.match?.request ?? null : null;
  const identityId = identity.playerId ?? identity.id;
  const ownsGameRequest = Boolean(gameRequest?.requestedBy === identityId);
  const mayAnswerGameRequest = Boolean(
    gameRequest?.controllers?.[WHITE]?.kind === MATCH_CONTROLLER_HUMAN &&
    gameRequest.controllers[WHITE].operatorId === identityId &&
    gameRequest.requestedBy !== identityId,
  );
  elements.gameInvitationPanel.hidden = !(
    active && roomMatchStatus === ONLINE_MATCH_INVITED && gameRequest
  );
  if (gameRequest) {
    elements.gameInvitationTitle.textContent = ownsGameRequest
      ? "邀请已发出"
      : mayAnswerGameRequest
        ? "房主邀请你开始对局"
        : "等待受邀玩家回应";
    elements.gameInvitationSummary.textContent = onlineInvitationSummary(gameRequest);
  }
  elements.acceptGameInvitation.hidden = !mayAnswerGameRequest;
  elements.declineGameInvitation.hidden = !mayAnswerGameRequest;
  elements.cancelGameInvitation.hidden = !ownsGameRequest;
  elements.acceptGameInvitation.disabled = !onlineControlsAvailable || !mayAnswerGameRequest;
  elements.declineGameInvitation.disabled = !onlineControlsAvailable || !mayAnswerGameRequest;
  elements.cancelGameInvitation.disabled = !onlineControlsAvailable || !ownsGameRequest;
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
      : "退出房间";
  elements.passButton.disabled = !match.capabilities.pass;
  elements.newGameButton.disabled = true;
  const finished = matchLifecycle === MATCH_LIFECYCLE_FINISHED;
  const canPrepareNextGame = finished && (!active || isOnlineHost());
  elements.directRematch.hidden = reviewing || rematchSetup || !canPrepareNextGame;
  elements.directRematch.disabled = !match.capabilities.new_game;
  elements.adjustNextGame.hidden = reviewing || rematchSetup || !canPrepareNextGame;
  elements.adjustNextGame.disabled = !match.capabilities.new_game;
  elements.postGameActions.hidden = elements.directRematch.hidden && elements.adjustNextGame.hidden;
  elements.postGameActions.classList.toggle(
    "single",
    elements.directRematch.hidden || elements.adjustNextGame.hidden,
  );
  const sameBrowserOnlineUndo = active && isSameBrowserHumanOnlineMatch(match);
  elements.undoButton.textContent = active
    ? sameBrowserOnlineUndo
      ? "悔棋"
      : match.opponentController === MATCH_CONTROLLER_AI ? "直接悔棋" : "申请悔棋"
    : aiMode
      ? "直接悔棋"
      : "悔棋";
  elements.undoButton.title = active
    ? sameBrowserOnlineUndo
      ? "直接撤回上一手"
      : match.opponentController === MATCH_CONTROLLER_AI
        ? "直接撤回你和 AI 的上一轮落子，不需要 AI 同意"
        : "需要对方同意后才会撤回上一手"
    : aiMode
      ? "直接回到你上一次选择之前，不需要 AI 同意"
      : "直接撤回上一手";
  elements.undoButton.disabled = !match.capabilities.undo;
  const resignVisible = match.capabilities.resign;
  elements.resignButton.hidden = !resignVisible;
  elements.resignButton.disabled = !resignVisible;
  elements.playControls.classList.toggle("with-resign", resignVisible);
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
  elements.confirmScore.disabled = !match.capabilities.finish_scoring || (active && ownScoreConfirmed);
  elements.resumeGame.disabled = !match.capabilities.resume_play;
  elements.confirmScore.textContent = active && ownScoreConfirmed
    ? "已确认，等待对方"
    : active && scoreConfirmations.length > 0
      ? "确认同意结果"
      : "确认结果";

  const canChangeNextGameSettings = (
    lobby || (rematchSetup && (!active || isOnlineHost()))
  ) && (!active || [ONLINE_MATCH_SETUP, ONLINE_MATCH_FINISHED].includes(roomMatchStatus)) &&
    !undoRequest && !aiThinking;
  elements.customWidth.disabled = !canChangeNextGameSettings;
  elements.customHeight.disabled = !canChangeNextGameSettings;
  elements.scoringRule.disabled = !canChangeNextGameSettings;
  elements.komi.disabled = !canChangeNextGameSettings;
  elements.timeControlPreset.disabled = !canChangeNextGameSettings;
  elements.mainTimeMinutes.disabled = !canChangeNextGameSettings;
  elements.byoYomiPeriods.disabled = !canChangeNextGameSettings;
  elements.byoYomiSeconds.disabled = !canChangeNextGameSettings;
  for (const button of elements.sizeButtons) button.disabled = !canChangeNextGameSettings;
  for (const button of elements.topologyButtons) {
    button.disabled = !canChangeNextGameSettings;
  }
  elements.onlineMatchOptions.hidden = !(active && rematchSetup);
  elements.onlineMatchMode.disabled = !canChangeNextGameSettings;
  const occupiedWhiteMember = active ? roomSeat(WHITE) : null;
  const invitedHumanWhite = Boolean(
    occupiedWhiteMember &&
    occupiedWhiteMember.automated !== true &&
    occupiedWhiteMember.role !== "ai",
  );
  for (const option of elements.onlineMatchMode.options) {
    option.disabled = Boolean(
      occupiedWhiteMember && option.value !== ONLINE_MODE_FRIEND,
    );
  }
  if (
    occupiedWhiteMember &&
    elements.onlineMatchMode.value !== ONLINE_MODE_FRIEND
  ) {
    elements.onlineMatchMode.value = ONLINE_MODE_FRIEND;
  }
  const selectedOnlineMode = elements.onlineMatchMode.value;
  const onlineModeUsesAI = [ONLINE_MODE_HUMAN_AI, ONLINE_MODE_AI_AI].includes(
    selectedOnlineMode,
  );
  elements.onlineMatchAiModelField.hidden = !onlineModeUsesAI;
  elements.onlineMatchAiModel.disabled = !canChangeNextGameSettings || !onlineModeUsesAI;
  if (elements.nextGameSetup) {
    elements.nextGameSetup.hidden = !rematchSetup;
    elements.nextGameContext.textContent = active ? "当前在线房间" : "沿用上一局";
    elements.nextGameHint.textContent = active
      ? "已沿用上一局设置；可以直接开始，也可以先调整棋盘。房间成员和聊天记录都会保留。"
      : "已沿用上一局设置；可以直接开始，也可以先调整棋盘。";
    if (active && occupiedWhiteMember && isOnlineHost()) {
      elements.nextGameHint.textContent +=
        " 白方席位已经有人使用；如需改为 AI 或同机对局，请先让白方释放席位。";
    }
    elements.confirmNextGame.hidden = active && !isOnlineHost();
    const canRequestOnlineGame = active && isOnlineHost() && rematchSetup &&
      [ONLINE_MATCH_SETUP, ONLINE_MATCH_FINISHED].includes(roomMatchStatus) &&
      onlineControlsAvailable &&
      (selectedOnlineMode !== ONLINE_MODE_FRIEND || invitedHumanWhite);
    elements.confirmNextGame.disabled = active
      ? !canRequestOnlineGame
      : !(rematchSetup && match.capabilities.new_game);
    if (active) {
      elements.confirmNextGame.textContent = selectedOnlineMode === ONLINE_MODE_FRIEND
        ? "使用当前设置发起对局邀请"
        : "使用当前设置开始在线对局";
      elements.confirmNextGame.title = selectedOnlineMode === ONLINE_MODE_FRIEND && !invitedHumanWhite
        ? "白方席位为空；请先让对手进入房间并成为白方"
        : "";
      if (isOnlineHost() && selectedOnlineMode === ONLINE_MODE_FRIEND && !invitedHumanWhite) {
        elements.nextGameHint.textContent =
          "白方席位目前为空。请先让朋友进入房间并成为白方，然后才能发送对局邀请。";
      }
    }
  }
  elements.changeAiSettings.disabled = reviewing || finished || rematchSetup;
  elements.leaveAi.disabled = reviewing;
  const canAttachWaitingAI = Boolean(
    !onlineRoom?.match && waiting && active && onlineReady && connected && isOnlineHost() &&
    game?.phase === PHASE_PLAY && !roomSeat(WHITE),
  );
  const legacyRoomAiActions = !onlineRoom?.match;
  const canAttachRoomAI = legacyRoomAiActions &&
    (match.capabilities.attach_ai || canAttachWaitingAI);
  const roomAiActions = elements.attachRoomAi?.closest(".room-ai-actions");
  if (roomAiActions) {
    roomAiActions.hidden = !legacyRoomAiActions || !active || (!onlineAi && !canAttachRoomAI);
  }
  elements.attachRoomAi.textContent = onlineAi ? "调整 / 重试在线 AI" : "让 AI 接替白方";
  elements.attachRoomAi.hidden = !canAttachRoomAI;
  elements.attachRoomAi.disabled = reviewing || !canAttachRoomAI;
  elements.detachRoomAi.hidden = !legacyRoomAiActions || !match.capabilities.detach_ai;
  elements.exportSgf.disabled = !hasStartedMatch() && !reviewing;
  elements.importSgf.disabled = false;
  syncChatUI();
  syncMovePreviewAvailability();
  syncClockUI();
}

function rememberOfflineGame() {
  if (hasOnlineSession() || !game) return;
  const pausedClock = localTimeControl && !localTimeControl.outcome
    ? pauseTimeControl(localTimeControl, Date.now())
    : cloneSerializable(localTimeControl);
  offlineGameState = {
    lifecycle: matchLifecycle,
    game: game.exportState(),
    timeControl: cloneSerializable(pausedClock),
    moveCount,
    lastPlayedPoint: cloneSerializable(lastPlayedPoint),
    ai: {
      active: isAIMode(),
      matchMode: aiMatchMode,
      autoplayPaused: aiAutoplayPaused,
      humanColor: aiHumanColor,
      modelId: aiGameModelId,
    },
  };
}

function syncTopologyPresentation(topology = displayedTopology()) {
  const torus = isTorusTopology(topology);
  const mobius = isMobiusTopology(topology);
  const cylinder = isCylinderTopology(topology);
  for (const button of elements.topologyButtons) {
    const active = button.dataset.boardTopology === topology;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.boardStage.dataset.topology = topology;
  elements.boardStage.setAttribute(
    "aria-label",
    torus
      ? "上下左右相连的甜甜圈围棋棋盘区域"
      : mobius
        ? "左右反向相连、上下保留边界的莫比乌斯围棋棋盘区域"
        : "左右相连的竹筒围棋棋盘区域",
  );
  elements.flatScene.setAttribute(
    "aria-label",
    torus
      ? "可向任意方向循环滑动的甜甜圈平面展开棋盘"
      : mobius
        ? "可横向滑动、跨一圈后上下翻转的莫比乌斯平面展开棋盘"
        : "可横向滑动的竹筒表面平面展开棋盘",
  );
  elements.arcViewButton.hidden = !cylinder;
  elements.threeDViewLabel.textContent = torus
    ? "立体甜甜圈"
    : mobius
      ? "立体莫比乌斯"
      : "立体竹筒";
  elements.rulesSummary.textContent = `${topologyName(topology)}棋盘规则说明`;
  elements.cylinderRules.hidden = !cylinder;
  elements.torusRules.hidden = !torus;
  elements.mobiusRules.hidden = !mobius;
  setViewMode(!cylinder && activeViewMode === "arc" ? "flat" : activeViewMode);
}

function rebuildViews(width, height, topology) {
  cylinderView?.rebuild(width, height);
  torusView?.rebuild(width, height);
  mobiusView?.rebuild(width, height);
  flatView?.rebuild(width, height, topology);
  arcView?.rebuild(width, height);
  syncTopologyPresentation(topology);
}

function restoreOfflineGame() {
  if (!offlineGameState) return;
  exitReplay({ announce: false });
  cancelAIThinking();
  const previousDimensions = { width: boardWidth(), height: boardHeight() };
  const previousTopology = game?.topology;
  game = GoEngine.fromState(offlineGameState.game);
  matchLifecycle = [
    MATCH_LIFECYCLE_LOBBY,
    MATCH_LIFECYCLE_WAITING,
    MATCH_LIFECYCLE_PLAYING,
    MATCH_LIFECYCLE_FINISHED,
  ].includes(offlineGameState.lifecycle)
    ? offlineGameState.lifecycle
    : MATCH_LIFECYCLE_LOBBY;
  localTimeControl = cloneSerializable(offlineGameState.timeControl);
  moveCount = offlineGameState.moveCount;
  lastPlayedPoint = offlineGameState.lastPlayedPoint;
  aiActive = Boolean(offlineGameState.ai?.active);
  aiMatchMode = normalizeAIMatchMode(offlineGameState.ai?.matchMode);
  aiAutoplayPaused = Boolean(offlineGameState.ai?.autoplayPaused) && aiMatchMode === AI_MATCH_SELF_PLAY;
  aiHumanColor = offlineGameState.ai?.humanColor === WHITE ? WHITE : BLACK;
  aiGameModelId = normalizeAIModelId(offlineGameState.ai?.modelId);
  if (aiActive) {
    preferredAIModelId = aiGameModelId;
    rememberPreferredAIModel();
  }
  if (
    matchLifecycle !== MATCH_LIFECYCLE_LOBBY &&
    localTimeControl && !localTimeControl.outcome && game.phase === PHASE_PLAY &&
    !(aiActive && aiMatchMode === AI_MATCH_SELF_PLAY && aiAutoplayPaused)
  ) {
    localTimeControl = startTimeControl(localTimeControl, game.currentPlayer, Date.now());
  }
  if (!sameBoardDimensions(previousDimensions, game) || previousTopology !== game.topology) {
    rebuildViews(boardWidth(), boardHeight(), game.topology);
  }
  setPendingDimensions(boardWidth(), boardHeight());
  setPendingTopology(game.topology);
  elements.scoringRule.value = game.scoringRule;
  elements.komi.value = String(game.komi);
  reflectTimeControlConfig(localTimeControl);
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
    !sameBoardDimensions(previousRoom.game, room.game),
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
  } else if (
    room.game.phase === PHASE_FINISHED &&
    room.game.result?.reason === "resign" &&
    previousRoom?.game?.result?.reason !== "resign"
  ) {
    setMessage(`${formatResult(room.game.result)}。`);
  } else if (
    room.game.phase === PHASE_FINISHED &&
    room.game.result?.reason === "timeout" &&
    previousRoom?.game?.result?.reason !== "timeout"
  ) {
    setMessage(`${formatResult(room.game.result)}。`, true);
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
      setMessage("双方连续停一手，已进入点目。系统已预标明确死棋并显示黑白领地，请核对。");
    } else {
      setMessage(`${colorName(lastMove.color)}停一手。`);
    }
  } else if (room.moveCount === 0) {
    setMessage(
      `${boardDimensionLabel(room.game)} ${topologySurfaceName(room.game.topology)}在线棋盘已准备好，黑方先行。`,
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
    (!sameBoardDimensions(replayFrame, room.game) || replayFrame.topology !== room.game.topology)
  ) {
    exitReplay({ announce: false });
    setMessage("房间已建立不同形状的新棋盘，复盘已结束并切回实时局面。");
  }

  const previousRoom = onlineRoom;
  const previousRequestRevision = previousRoom?.match?.request?.requestRevision ?? null;
  const previouslyDisplayedGame = liveDisplayedGame();
  const previousDimensions = {
    width: boardWidth(previouslyDisplayedGame),
    height: boardHeight(previouslyDisplayedGame),
  };
  const previousTopology = previouslyDisplayedGame?.topology;
  onlineRoom = room;
  if (!isOnlineNextGameSetup()) {
    elements.onlineMatchMode.value = room.match?.mode ?? ONLINE_MODE_FRIEND;
    const modelId = [BLACK, WHITE]
      .map((color) => room.match?.controllers?.[color]?.modelId)
      .find(Boolean);
    elements.onlineMatchAiModel.value = normalizeAIModelId(modelId ?? aiGameModelId);
  }
  const {
    nextRoundStarted,
    exitSetup: rematchStarted,
  } = onlineNextGameTransition({
    previousRoom,
    nextRoom: room,
    setupActive: isOnlineNextGameSetup(),
  });
  if (rematchStarted) {
    rematchSetupTransport = null;
    rematchPreviewGame = null;
  }
  if (rematchStarted || nextRoundStarted) {
    if (isReplaying()) exitReplay({ announce: false });
    setSidebarTab(
      [ONLINE_MATCH_SETUP, ONLINE_MATCH_INVITED].includes(onlineMatchStatus())
        ? "settings"
        : "game",
    );
  }
  onlineStateSynchronized = Boolean(
    roomClient.isConnected && room.code === roomClient.roomCode,
  );
  if (
    aiWorkerContext?.kind === MATCH_TRANSPORT_ONLINE &&
    (
      aiWorkerContext.roomCode !== room.code ||
      aiWorkerContext.positionToken !== room.positionToken ||
      aiWorkerContext.color !== room.game.currentPlayer
    )
  ) {
    cancelAIThinking();
  }
  if (aiFailedPositionToken && aiFailedPositionToken !== room.positionToken) {
    aiFailedPositionToken = null;
  }
  const roomAI = onlineAISeat();
  if (roomAI) aiGameModelId = normalizeAIModelId(roomAI.modelId);
  onlineClockReceivedAt = Date.now();
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
  const roomMatchStatus = onlineMatchStatus(room);
  matchLifecycle = roomMatchStatus === ONLINE_MATCH_FINISHED
    ? MATCH_LIFECYCLE_FINISHED
    : roomMatchStatus === ONLINE_MATCH_PLAYING
      ? MATCH_LIFECYCLE_PLAYING
      : MATCH_LIFECYCLE_WAITING;

  const requestRevision = room.match?.request?.requestRevision ?? null;
  const shouldEnterOnlineSetup = [ONLINE_MATCH_SETUP, ONLINE_MATCH_INVITED].includes(
    roomMatchStatus,
  ) && (
    !isOnlineNextGameSetup() ||
    (requestRevision !== null && previousRequestRevision !== requestRevision)
  );
  if (shouldEnterOnlineSetup) {
    const options = room.match?.request?.settings ?? previousGameOptions(game, room.timeControl);
    reflectGameOptions(options);
    rematchSetupTransport = MATCH_TRANSPORT_ONLINE;
    rematchPreviewGame = new GoEngine(options);
    elements.onlineMatchMode.value = room.match?.request?.mode ?? room.match?.mode ?? ONLINE_MODE_FRIEND;
    const requestedAI = [BLACK, WHITE]
      .map((color) => room.match?.request?.controllers?.[color]?.modelId)
      .find(Boolean);
    elements.onlineMatchAiModel.value = normalizeAIModelId(requestedAI ?? aiGameModelId);
    rebuildViews(options.width, options.height, options.topology);
    setViewMode(activeViewMode);
    setSidebarTab("settings");
  }
  lastPlayedPoint = game.lastMove?.type === "play"
    ? { row: game.lastMove.row, col: game.lastMove.col }
    : null;
  // A player can click Replay in the short interval between submitting the
  // human move and receiving its authoritative state. If that state hands the
  // turn to the browser-controlled AI, return to live play immediately so the
  // shared room clock never runs while its only AI controller is suspended.
  const replayInterruptedForOnlineAI = isReplaying() && onlineAITurnNeedsController();
  if (replayInterruptedForOnlineAI) exitReplay({ announce: false });
  if (isLiveOnlineFairPlayLocked() && reviewActive) {
    const wasReplayReview = reviewActive.context === "replay";
    cancelReplayAIReview({ terminate: true });
    if (wasReplayReview && replaySession) {
      replaySession.analysisMessage = "房间已恢复对局；为保证公平，AI 分析已停止并暂时隐藏。";
      replaySession.analysisError = false;
    } else {
      liveAnalysis.message = "房间已开始或恢复对局；玩家端 AI 分析已锁定。";
      liveAnalysis.error = false;
    }
  }
  if (reviewActive?.context === "live" && reviewActive.positionKey !== livePositionKey()) {
    cancelReplayAIReview({ terminate: true });
    liveAnalysis.message = "棋局已经更新；上一局面的分析已停止，可重新分析最新局面。";
    liveAnalysis.error = false;
  }
  if (liveAnalysis.positionKey && liveAnalysis.positionKey !== livePositionKey()) {
    liveAnalysis.manualCandidate = null;
  }

  if (!isOnlineNextGameSetup() && (
    !sameBoardDimensions(previousDimensions, game) || previousTopology !== game.topology
  )) {
    if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
    chatReferenceTimer = null;
    chatReferencePoint = null;
    chatReferenceFocusViews = false;
    rebuildViews(boardWidth(), boardHeight(), game.topology);
  }
  if (!isOnlineNextGameSetup()) {
    setPendingDimensions(boardWidth(), boardHeight());
    setPendingTopology(game.topology);
    elements.scoringRule.value = game.scoringRule;
    elements.komi.value = String(game.komi);
    reflectTimeControlConfig(room.timeControl);
  }
  if (rematchStarted || nextRoundStarted) setViewMode(activeViewMode);
  if (!previousRoom && !isOnlineNextGameSetup()) setSidebarTab("game");
  announceRoomState(room, previousRoom);
  if (replayInterruptedForOnlineAI) {
    setMessage("轮到在线 AI 行棋，已自动退出复盘以保持房间对局和计时继续。");
  }
  updateUI();
  maybeStartAITurn();
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
  if (!onlineStateSynchronized) {
    setMessage("连接已经恢复，正在核对最新棋局，请稍等一下。", true);
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

function matchActionUnavailableMessage(action, session = currentMatchSession()) {
  if (!session.started) {
    return "棋局尚未开始；请先在房间里邀请一场对局。";
  }
  if (session.transport === MATCH_TRANSPORT_ONLINE) {
    if (!session.onlineReady) return "房间正在连接或同步，请稍等一下。";
    if (!session.player) return "旁观者不能操作棋局。";
    if (!session.bothSeats) return "请等待白方真人加入，或由房主接入 AI。";
    if ([MATCH_ACTION_PLAY, MATCH_ACTION_PASS].includes(action)) {
      return session.controllerByColor[session.currentPlayer] === MATCH_CONTROLLER_AI
        ? "现在轮到在线 AI 思考；棋步会由房主浏览器提交并由服务器验证。"
        : "还没有轮到你。";
    }
  }
  if (
    session.transport === MATCH_TRANSPORT_LOCAL &&
    [MATCH_ACTION_PLAY, MATCH_ACTION_PASS].includes(action) &&
    session.controllerByColor[session.currentPlayer] === MATCH_CONTROLLER_AI
  ) {
    return isAIvsAI()
      ? "AI 自对弈期间不能手动行棋；可以暂停、复盘或切换棋盘视图。"
      : `现在轮到 ${currentAIName()} 思考；你仍然可以旋转和切换棋盘视图。`;
  }
  if (isReplaying()) return "请先退出复盘，再操作棋局。";
  return "当前状态不能执行这个操作。";
}

async function dispatchMatchAction(action, payload = {}, options = {}) {
  const actor = options.actor === MATCH_CONTROLLER_AI
    ? MATCH_CONTROLLER_AI
    : MATCH_CONTROLLER_HUMAN;
  const session = currentMatchSession();
  const routePayload = action === MATCH_ACTION_UNDO
    ? { expectedMoveCount: moveCount, ...(
        session.transport === MATCH_TRANSPORT_ONLINE
          ? onlineAIPositionExpectation()
          : {}
      ) }
    : payload;
  const route = routeMatchAction(session, action, routePayload, { actor });
  if (!route.allowed) {
    setMessage(matchActionUnavailableMessage(action, session), true);
    return false;
  }
  if (route.target === MATCH_TRANSPORT_ONLINE) {
    if (actor === MATCH_CONTROLLER_AI) {
      const detail = Number.isFinite(options.stats?.inferenceMs)
        ? `（推理 ${Math.round(options.stats.inferenceMs)} ms）`
        : "";
      setMessage(`KataGo 已完成判断${detail}，正在由服务器验证并同步…`);
    }
    if (action === MATCH_ACTION_UNDO) {
      setMessage(
        route.command === "direct_undo_ai_round"
          ? "正在直接撤回你和 AI 的上一轮落子…"
          : route.command === "direct_undo_local_round"
            ? "正在直接撤回上一手…"
            : "正在发送悔棋申请…",
      );
    }
    if (action === MATCH_ACTION_RESIGN) setMessage("正在提交认输…");
    return sendOnlineCommand(route.command, route.payload);
  }

  if (action === MATCH_ACTION_PLAY) {
    if (!ensureLocalTimedMoveAllowed()) return false;
    const result = game.play(payload.row, payload.col);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.reason] || "这一手不能下。", true);
      return false;
    }
    moveCount += 1;
    completeLocalTimedTurn();
    lastPlayedPoint = { row: payload.row, col: payload.col };
    playMoveSounds(result.captured?.length ?? 0);
    const captureMessage = result.captured.length
      ? `，提掉 ${result.captured.length} 子`
      : "";
    if (actor === MATCH_CONTROLLER_AI) {
      const neuralDetail = Number.isFinite(options.stats?.inferenceMs)
        ? `（神经判断 ${Math.round(options.stats.inferenceMs)} ms）`
        : "";
      setMessage(`${colorName(result.color)} ${currentAIName()} 落子${captureMessage}${neuralDetail}。`);
    } else {
      setMessage(`${colorName(result.color)}落子${captureMessage}。`);
    }
    updateUI();
    if (actor === MATCH_CONTROLLER_AI && isAIvsAI() && game.phase === PHASE_PLAY && !aiAutoplayPaused) {
      window.setTimeout(() => maybeStartAITurn(), 420);
    } else {
      maybeStartAITurn();
    }
    return true;
  }

  if (action === MATCH_ACTION_PASS) {
    if (!ensureLocalTimedMoveAllowed()) return false;
    const result = game.pass();
    if (!result.ok) return false;
    moveCount += 1;
    completeLocalTimedTurn();
    lastPlayedPoint = null;
    if (result.phase === PHASE_SCORING && actor === MATCH_CONTROLLER_AI) {
      if (shouldPauseAIMatchAtScoring({
        active: isAIMode(),
        mode: aiMatchMode,
        phase: result.phase,
      })) {
        aiAutoplayPaused = true;
        setMessage("双方 AI 连续停着，自对弈已暂停在点目阶段。系统已预标明确死棋，请核对领地。");
      } else {
        setMessage("AI 也停一手，已进入点目。系统已预标明确死棋，请核对领地。");
      }
    } else if (result.phase === PHASE_SCORING) {
      setMessage("双方连续停一手，已进入点目。系统已预标明确死棋并显示黑白领地，请核对。");
    } else if (actor === MATCH_CONTROLLER_AI) {
      setMessage(isAIvsAI()
        ? `${colorName(result.color)} AI 停一手，另一方继续判断。`
        : `${currentAIName()} 停一手，轮到你落子。`);
    } else {
      setMessage(`${colorName(result.color)}停一手，轮到${colorName(result.nextPlayer)}。`);
    }
    updateUI();
    if (actor === MATCH_CONTROLLER_AI && isAIvsAI() && game.phase === PHASE_PLAY && !aiAutoplayPaused) {
      window.setTimeout(() => maybeStartAITurn(), 420);
    } else {
      maybeStartAITurn();
    }
    return true;
  }

  if (action === MATCH_ACTION_UNDO) {
    undoOfflineGame();
    return true;
  }

  if (action === MATCH_ACTION_RESIGN) {
    const loser = payload.color ?? resigningColor();
    if (!loser || !ensureLocalTimedMoveAllowed()) return false;
    if (aiThinking) cancelAIThinking();
    const result = game.resign(loser);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.reason] || "当前不能认输。", true);
      return false;
    }
    retargetLocalTimeControl({ pause: true });
    setMessage(`${formatResult(result)}。`);
    updateUI();
    return true;
  }

  if (action === MATCH_ACTION_NEW_GAME) {
    cancelAIThinking();
    game = new GoEngine(payload);
    liveAnalysis = {
      modelId: liveAnalysis.modelId,
      positionKey: null,
      result: null,
      message: "",
      error: false,
      manualCandidate: null,
    };
    reviewCandidateState = createReviewCandidateState();
    reviewCandidateContextKey = "";
    createLocalTimeControl(payload);
    moveCount = 0;
    lastPlayedPoint = null;
    elements.coordinateHint.textContent = "";
    rebuildViews(payload.width, payload.height, payload.topology);
    setMessage(
      `${payload.width} × ${payload.height} ${topologySurfaceName(payload.topology)}棋盘已准备好，黑方先行。`,
    );
    updateUI();
    maybeStartAITurn();
    return true;
  }

  if (action === MATCH_ACTION_TOGGLE_DEAD) {
    const result = game.toggleDead(payload.row, payload.col);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.reason] || "这里不能标记。", true);
      return false;
    }
    setMessage(
      `${colorName(result.color)}这块棋已${result.dead ? "标为死子" : "恢复为活棋"}。`,
    );
    updateUI();
    return true;
  }

  if (action === MATCH_ACTION_FINISH_SCORING) {
    const result = game.finishScoring();
    if (!result.ok) return false;
    retargetLocalTimeControl({ pause: true });
    setMessage(`点目完成：${formatResult(result)}。`);
    updateUI();
    return true;
  }

  if (action === MATCH_ACTION_RESUME_PLAY) {
    const result = game.resumePlay();
    if (!result.ok) return false;
    retargetLocalTimeControl();
    setMessage("已恢复对局，可以继续处理有争议的死活。");
    updateUI();
    maybeStartAITurn();
    return true;
  }
  return false;
}

function normalizeBoardDimension(value, fallback = 19) {
  const numeric = Number(value);
  return Math.max(
    PUBLIC_MIN_BOARD_DIMENSION,
    Math.min(MAX_BOARD_DIMENSION, Math.round(Number.isFinite(numeric) ? numeric : fallback)),
  );
}

function setPendingDimensions(width, height = width) {
  pendingWidth = normalizeBoardDimension(width);
  pendingHeight = normalizeBoardDimension(height);
  elements.customWidth.value = String(pendingWidth);
  elements.customHeight.value = String(pendingHeight);
  for (const button of elements.sizeButtons) {
    const shortcut = Number(button.dataset.boardSize);
    const active = shortcut === pendingWidth && shortcut === pendingHeight;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setPendingTopology(topology) {
  pendingTopology = [
    TOPOLOGY_CYLINDER,
    TOPOLOGY_TORUS,
    TOPOLOGY_MOBIUS,
  ].includes(topology)
    ? topology
    : TOPOLOGY_CYLINDER;
  for (const button of elements.topologyButtons) {
    const active = button.dataset.boardTopology === pendingTopology;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function getNewGameOptions() {
  const width = normalizeBoardDimension(elements.customWidth.value);
  const height = normalizeBoardDimension(elements.customHeight.value);
  const timeControl = selectedTimeControlConfig();
  setPendingDimensions(width, height);
  return {
    width,
    height,
    ...(width === height ? { size: width } : {}),
    topology: pendingTopology,
    scoringRule: elements.scoringRule.value,
    komi: Number(elements.komi.value) || 0,
    mainTimeSeconds: timeControl?.mainTimeSeconds ?? 0,
    byoYomiPeriods: timeControl?.byoYomiPeriods ?? 0,
    byoYomiSeconds: timeControl?.byoYomiSeconds ?? 0,
  };
}

function selectedOnlineMatchMode() {
  const mode = elements.onlineMatchMode.value;
  return [
    ONLINE_MODE_FRIEND,
    ONLINE_MODE_HUMAN_AI,
    ONLINE_MODE_AI_AI,
    ONLINE_MODE_LOCAL,
  ].includes(mode) ? mode : ONLINE_MODE_FRIEND;
}

function onlineGameRequestPayload(options) {
  return {
    ...options,
    mode: selectedOnlineMatchMode(),
    aiModelId: normalizeAIModelId(elements.onlineMatchAiModel.value),
  };
}

async function requestOnlineGame(options) {
  if (!hasOnlineSession() || !isOnlineHost()) return false;
  const status = onlineMatchStatus();
  if (![ONLINE_MATCH_SETUP, ONLINE_MATCH_FINISHED].includes(status)) {
    setMessage(
      status === ONLINE_MATCH_INVITED
        ? "当前邀请仍在等待回应；请先取消邀请再修改。"
        : "当前对局尚未结束，不能发起新棋。",
      true,
    );
    return false;
  }
  const mode = selectedOnlineMatchMode();
  const modelId = normalizeAIModelId(elements.onlineMatchAiModel.value);
  if (
    [ONLINE_MODE_HUMAN_AI, ONLINE_MODE_AI_AI].includes(mode) &&
    getAIModel(modelId).heavy &&
    !window.confirm(translateText(
      "b18 首次需要下载约 93.4 MB，并会占用数百 MB 内存与显存、增加耗电和发热。仅建议桌面端 WebGPU。确定使用吗？",
    ))
  ) return false;
  setMessage(mode === ONLINE_MODE_FRIEND ? "正在发送对局邀请…" : "正在开始在线对局…");
  const sent = await sendOnlineCommand("request_game", onlineGameRequestPayload(options));
  if (sent && mode === ONLINE_MODE_FRIEND) {
    setMessage("对局邀请已发出，等待对方接受。所有设置会保留在当前房间。", false);
  }
  return sent;
}

function getPreviousGameOptions() {
  const timeControl = hasOnlineSession() ? onlineRoom?.timeControl : localTimeControl;
  return previousGameOptions(game, timeControl);
}

function currentLocalNextGameAIState() {
  return {
    active: aiActive,
    matchMode: aiMatchMode,
    humanColor: aiHumanColor,
    modelId: aiGameModelId,
    autoplayPaused: aiAutoplayPaused,
  };
}

function applyLocalNextGameAIState(state) {
  if (!state) return;
  aiActive = state.active;
  aiMatchMode = state.matchMode;
  aiHumanColor = state.humanColor;
  aiGameModelId = state.modelId;
  aiAutoplayPaused = state.autoplayPaused;
}

function reflectGameOptions(options) {
  setPendingDimensions(options.width, options.height);
  setPendingTopology(options.topology);
  elements.scoringRule.value = options.scoringRule;
  elements.komi.value = String(options.komi);
  const timeControl = options.mainTimeSeconds || options.byoYomiPeriods || options.byoYomiSeconds
    ? {
        mainTimeSeconds: options.mainTimeSeconds,
        byoYomiPeriods: options.byoYomiPeriods,
        byoYomiSeconds: options.byoYomiSeconds,
      }
    : null;
  reflectTimeControlConfig(timeControl);
  return options;
}

function reflectPreviousGameOptions() {
  return reflectGameOptions(getPreviousGameOptions());
}

function resetLobbyPreview({ message = "" } = {}) {
  const options = getNewGameOptions();
  const nextGamePreview = isNextGameSetup();
  const previousGame = nextGamePreview ? rematchPreviewGame : game;
  const previousDimensions = previousGame
    ? { width: boardWidth(previousGame), height: boardHeight(previousGame) }
    : null;
  const previousTopology = previousGame?.topology;
  const preview = new GoEngine(options);
  if (nextGamePreview) {
    rematchPreviewGame = preview;
  } else {
    game = preview;
    matchLifecycle = MATCH_LIFECYCLE_LOBBY;
    localTimeControl = null;
    moveCount = 0;
    lastPlayedPoint = null;
  }
  liveAnalysis = {
    modelId: liveAnalysis.modelId,
    positionKey: null,
    result: null,
    message: "",
    error: false,
    manualCandidate: null,
  };
  reviewCandidateState = createReviewCandidateState();
  reviewCandidateContextKey = "";
  elements.coordinateHint.textContent = "";
  if (
    !previousDimensions ||
    !sameBoardDimensions(previousDimensions, preview) ||
    previousTopology !== preview.topology
  ) {
    rebuildViews(options.width, options.height, options.topology);
  } else {
    renderBoardPosition(preview.getState(), null);
  }
  setViewMode(activeViewMode);
  syncLobbySettingsSummary();
  if (message) setMessage(message);
  updateUI();
}

function returnToLocalLobby(message = "已回到我的房间，可以重新邀请一场对局。") {
  cancelAIThinking();
  cancelReplayAIReview({ terminate: true });
  aiActive = false;
  aiAutoplayPaused = false;
  rematchSetupTransport = null;
  rematchPreviewGame = null;
  matchLifecycle = MATCH_LIFECYCLE_LOBBY;
  if (isReplaying()) exitReplay({ announce: false });
  setSidebarTab("settings");
  resetLobbyPreview({ message });
}

async function startNewGame(optionsOverride = null) {
  exitReplay({ announce: false });
  cancelReplayAIReview({ terminate: true });
  const options = optionsOverride ?? getNewGameOptions();
  if (hasOnlineSession()) return requestOnlineGame(options);
  const rematchSetup = isOnlineNextGameSetup();
  if (!rematchSetup) setSidebarTab("game");
  if (hasOnlineSession()) setMessage("正在为房间建立新棋盘…");
  const started = await dispatchMatchAction(MATCH_ACTION_NEW_GAME, options);
  if (started && rematchSetup && !isOnlineNextGameSetup()) {
    setSidebarTab("game");
    updateUI();
  }
  return started;
}

async function startImmediateRematch() {
  if (matchLifecycle !== MATCH_LIFECYCLE_FINISHED || isReplaying()) return;
  const match = currentMatchSession();
  if (!match.capabilities.new_game) {
    setMessage(matchActionUnavailableMessage(MATCH_ACTION_NEW_GAME, match), true);
    updateUI();
    return;
  }
  const previousAIState = hasOnlineSession() ? null : currentLocalNextGameAIState();
  if (previousAIState) {
    applyLocalNextGameAIState(prepareLocalNextGameAIState(previousAIState));
  }
  const started = await startNewGame(getPreviousGameOptions());
  if (!started && previousAIState) {
    applyLocalNextGameAIState(previousAIState);
    updateUI();
  }
}

function enterNextGameSetup() {
  if (matchLifecycle !== MATCH_LIFECYCLE_FINISHED) return;
  if (hasOnlineSession() && !isOnlineHost()) {
    setSidebarTab("chat", { focus: true });
    setMessage("等待黑方房主设置并发起下一局；你可以继续聊天，或退出房间。", true);
    updateUI();
    return;
  }
  if (isReplaying()) exitReplay({ announce: false });
  const match = currentMatchSession();
  if (!match.capabilities.new_game) {
    setMessage(matchActionUnavailableMessage(MATCH_ACTION_NEW_GAME, match), true);
    updateUI();
    return;
  }
  cancelAIThinking();
  cancelReplayAIReview({ terminate: true });
  if (chatReferenceTimer !== null) window.clearTimeout(chatReferenceTimer);
  chatReferenceTimer = null;
  chatReferencePoint = null;
  chatReferenceFocusViews = false;
  setChatPointPicking(false);
  const options = reflectPreviousGameOptions();
  rematchSetupTransport = hasOnlineSession()
    ? MATCH_TRANSPORT_ONLINE
    : MATCH_TRANSPORT_LOCAL;
  rematchPreviewGame = new GoEngine(options);
  if (hasOnlineSession()) {
    elements.onlineMatchMode.value = onlineRoom?.match?.mode ?? ONLINE_MODE_FRIEND;
    const modelId = [BLACK, WHITE]
      .map((color) => onlineRoom?.match?.controllers?.[color]?.modelId)
      .find(Boolean);
    elements.onlineMatchAiModel.value = normalizeAIModelId(modelId ?? aiGameModelId);
  }
  setSidebarTab("settings", { focus: true });
  resetLobbyPreview({
    message: hasOnlineSession()
      ? "仍在当前在线房间。已沿用上一局设置；可以直接确认，也可以先调整棋盘。"
      : "已沿用上一局的对手和棋盘设置；可以直接确认，也可以先调整棋盘。",
  });
}

async function startConfiguredNextGame() {
  if (!isNextGameSetup()) return;
  if (hasOnlineSession() && !isOnlineHost()) return;
  if (hasOnlineSession()) {
    await startNewGame(getNewGameOptions());
    return;
  }
  const match = currentMatchSession();
  if (!match.capabilities.new_game) {
    setMessage(matchActionUnavailableMessage(MATCH_ACTION_NEW_GAME, match), true);
    updateUI();
    return;
  }
  const options = getNewGameOptions();
  const localSetup = isLocalNextGameSetup();
  const previousAIState = localSetup ? currentLocalNextGameAIState() : null;
  if (localSetup) {
    rematchSetupTransport = null;
    rematchPreviewGame = null;
    applyLocalNextGameAIState(prepareLocalNextGameAIState(previousAIState));
  }
  const started = await startNewGame(options);
  if (!started && localSetup) {
    applyLocalNextGameAIState(previousAIState);
    rematchSetupTransport = MATCH_TRANSPORT_LOCAL;
    rematchPreviewGame = new GoEngine(options);
    setSidebarTab("settings");
    updateUI();
  }
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
  const dimensions = `${pendingWidth} × ${pendingHeight}`;
  elements.newGameSummary.textContent = pendingTopology === TOPOLOGY_TORUS
    ? `将建立：甜甜圈（上下左右首尾相接） · ${dimensions}。当前对局进度将被清除。`
    : pendingTopology === TOPOLOGY_MOBIUS
      ? `将建立：莫比乌斯（左右反向相接，上下保留一圈边界） · ${dimensions}。当前对局进度将被清除。`
      : `将建立：竹筒（左右首尾相接） · ${dimensions}。当前对局进度将被清除。`;
  if (typeof elements.newGameDialog.showModal === "function") {
    elements.newGameDialog.showModal();
  } else {
    if (window.confirm(translateText("建立新棋盘并清除当前对局？"))) {
      void startNewGame();
    } else {
      setPendingDimensions(boardWidth(), boardHeight());
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

function territoryRegionsForState(state) {
  if (state?.phase === PHASE_SCORING) {
    try {
      return hydratePublicGame(state).score(state.scoringRule).regions;
    } catch {
      return [];
    }
  }
  if (
    state?.phase === PHASE_FINISHED &&
    !["resign", "timeout"].includes(state.result?.reason) &&
    Array.isArray(state.result?.regions)
  ) {
    return state.result.regions;
  }
  return [];
}

function renderBoardPosition(
  state,
  lastMove = state.lastMove,
  analysisMove = null,
  referencePoint = chatReferencePoint,
  analysisCandidates = [],
  analysisVariation = [],
) {
  const viewState = {
    ...state,
    lastMove,
    analysisMove,
    referencePoint,
    analysisCandidates,
    analysisVariation,
    territoryRegions: territoryRegionsForState(state),
  };
  cylinderView?.setPosition(viewState);
  torusView?.setPosition(viewState);
  mobiusView?.setPosition(viewState);
  flatView?.setPosition(viewState);
  arcView?.setPosition(viewState);
}

function analysisContextKey(record = currentAnalysisRecord()) {
  if (!record) return "";
  return replaySession
    ? `replay:${replaySession.analysisModelId}:${replaySession.index}`
    : `live:${liveAnalysis.modelId}:${liveAnalysis.positionKey}`;
}

function analysisCandidatesFor(record = currentAnalysisRecord()) {
  if (!record) return [];
  let candidates = normalizeReviewCandidates(record.stats, {
    limit: 5,
    recommendation: record.move,
  });
  const manual = !replaySession ? liveAnalysis.manualCandidate : null;
  if (manual?.move) {
    const manualKey = `play:${manual.move.row}:${manual.move.col}`;
    const existing = candidates.find((candidate) => candidate.key === manualKey);
    const selected = {
      ...(existing ?? manual),
      key: manualKey,
      rank: 0,
      manual: true,
      move: cloneSerializable(manual.move),
      variation: existing?.variation?.length
        ? cloneSerializable(existing.variation)
        : [cloneSerializable(manual.move)],
    };
    candidates = [
      selected,
      ...candidates.filter((candidate) => candidate.key !== manualKey),
    ].slice(0, 5);
  }
  return candidates;
}

function currentAnalysisBaseState() {
  if (replaySession) {
    try {
      return buildReplayStateAtStep(replaySession.source, replaySession.index);
    } catch {
      return null;
    }
  }
  try {
    if (hasOnlineSession() && onlineRoom?.replay) {
      return buildReplayStateAtStep(onlineRoom.replay, moveCount);
    }
    return game?.exportState?.({ includeReplay: false }) ?? null;
  } catch {
    return null;
  }
}

function buildAnalysisVariationPreview(baseState, candidate) {
  if (!baseState || !candidate) return null;
  try {
    const preview = GoEngine.fromState(baseState);
    const variation = [];
    const moves = Array.isArray(candidate.variation)
      ? candidate.variation.slice(0, 8)
      : [candidate.move];
    for (const move of moves) {
      if (preview.phase !== PHASE_PLAY) break;
      const color = preview.currentPlayer;
      const result = move?.type === "pass"
        ? preview.pass()
        : move?.type === "play"
          ? preview.play(move.row, move.col)
          : null;
      if (!result?.ok) break;
      variation.push({ move: cloneSerializable(move), color, number: variation.length + 1 });
    }
    return variation.length > 0
      ? { state: preview.getState(), variation }
      : null;
  } catch {
    return null;
  }
}

function renderCurrentAnalysisPosition() {
  if (!game || !cylinderView) return;
  if (isNextGameSetup() && rematchPreviewGame) {
    renderBoardPosition(rematchPreviewGame.getState(), null);
    return;
  }
  const record = isLiveOnlineFairPlayLocked() ? null : currentAnalysisRecord();
  const showAnalysis = activeSidebarTab === "analysis" && Boolean(record);
  const candidates = showAnalysis ? analysisCandidatesFor(record) : [];
  const contextKey = analysisContextKey(record);
  if (contextKey !== reviewCandidateContextKey) {
    reviewCandidateContextKey = contextKey;
    reviewCandidateState = createReviewCandidateState(candidates);
  } else {
    reviewCandidateState = createReviewCandidateState(candidates, reviewCandidateState);
  }
  const activeCandidate = showAnalysis
    ? activeReviewCandidate(reviewCandidateState, candidates)
    : null;
  const decoratedCandidates = candidates.map((candidate) => ({
    ...candidate,
    active: activeCandidate?.key === candidate.key,
  }));

  if (replaySession) {
    const frame = replaySession.frames[replaySession.index];
    const lastMove = replaySession.index > 0 ? frame.lastMove : null;
    const preview = activeCandidate
      ? buildAnalysisVariationPreview(currentAnalysisBaseState(), activeCandidate)
      : null;
    renderBoardPosition(
      preview?.state ?? frame,
      preview?.state?.lastMove ?? lastMove,
      null,
      chatReferencePoint,
      decoratedCandidates,
      preview?.variation ?? [],
    );
    return;
  }

  const state = game.getState();
  const normalLastMove = lastPlayedPoint
    ? { type: "play", ...lastPlayedPoint }
    : state.lastMove;
  const preview = activeCandidate
    ? buildAnalysisVariationPreview(currentAnalysisBaseState(), activeCandidate)
    : null;
  renderBoardPosition(
    preview?.state ?? state,
    preview?.state?.lastMove ?? normalLastMove,
    null,
    chatReferencePoint,
    decoratedCandidates,
    preview?.variation ?? [],
  );
}

function applyReviewCandidateAction(action, candidates) {
  reviewCandidateState = reduceReviewCandidateState(
    reviewCandidateState,
    action,
    candidates,
  );
  const active = activeReviewCandidate(reviewCandidateState, candidates);
  elements.aiReviewCandidates
    .querySelectorAll("[data-candidate-key]")
    .forEach((button) => {
      const selected = button.dataset.candidateKey === active?.key;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  elements.aiVariationPreview.hidden = !active;
  if (active) {
    const rankLabel = active.manual ? "自选点" : `候选 ${active.rank}`;
    elements.aiVariationTitle.textContent = `${rankLabel} · ${formatReviewMove(active.move)}`;
    elements.aiVariationLine.textContent = formatReviewVariation(active, {
      height: replaySession
        ? boardHeight(replaySession.frames[replaySession.index])
        : boardHeight(),
    }) || "当前搜索没有返回更长的变化。";
  }
  renderCurrentAnalysisPosition();
}

function syncReplayEntryAvailability() {
  const reviewing = isReplaying();
  const nextGameSetup = isNextGameSetup();
  const matchStarted = hasStartedMatch();
  const protectingOnlineAI = onlineAITurnNeedsController();
  elements.replayButton.hidden = reviewing || nextGameSetup || !matchStarted;
  elements.replayPanel.hidden = !reviewing;
  elements.replayButton.disabled = !reviewing && (
    nextGameSetup || !matchStarted || replayEventCount() === 0 || protectingOnlineAI
  );
  elements.replayButton.title = protectingOnlineAI
    ? "请等在线 AI 落子后再进入复盘"
    : "逐手回看，可随时切换棋盘视图";
}

function syncAIReviewUI() {
  const frame = replaySession?.frames?.[replaySession.index] ?? game?.getState?.();
  if (!frame) return;
  const analysis = isLiveOnlineFairPlayLocked() ? null : currentAnalysisRecord();
  const running = Boolean(reviewActive);
  const protectingOnlineAI = onlineAITurnNeedsController();
  const canAnalyzeCurrent = replaySession
    ? !replayStepIsTerminal(replaySession.index) && !isLiveOnlineFairPlayLocked()
    : canAnalyzeLivePosition();
  const model = currentReviewModel();

  if ((!hasStartedMatch() || isNextGameSetup()) && !replaySession) {
    elements.aiReviewEyebrow.textContent = "房间准备";
    elements.aiReviewTitle.textContent = "AI 局势分析";
    elements.aiReviewModel.value = model.id;
    elements.aiReviewModel.disabled = true;
    elements.aiReviewModelNote.textContent = `${translateText(model.resourceNote)} ${translateText(model.strengthNote)}`;
    elements.aiReviewModelNote.classList.toggle("heavy", model.heavy);
    elements.aiReviewCurrent.hidden = false;
    elements.aiReviewCurrent.disabled = true;
    elements.aiReviewAll.hidden = true;
    elements.aiReviewCancel.hidden = true;
    elements.aiReviewStatus.textContent = isNextGameSetup()
      ? "确认下一局设置并开局后，才可以进行局势分析。"
      : "对局开始后，才可以分析当前局面或复盘棋谱。";
    elements.aiReviewStatus.classList.remove("error");
    elements.aiReviewResult.hidden = true;
    elements.aiReviewCandidates.replaceChildren();
    elements.aiVariationPreview.hidden = true;
    elements.boardStage.classList.remove("analysis-point-picking");
    renderCurrentAnalysisPosition();
    return;
  }

  elements.aiReviewEyebrow.textContent = replaySession
    ? "Replay intelligence"
    : hasOnlineSession()
      ? isLiveOnlineFairPlayLocked()
        ? "Fair play protection"
        : isOnlinePlayer() ? "Player intelligence" : "Spectator intelligence"
      : "Position intelligence";
  elements.aiReviewTitle.textContent = replaySession
    ? "AI 复盘"
    : hasOnlineSession()
      ? isLiveOnlineFairPlayLocked()
        ? "实战 AI 已锁定"
        : isOnlinePlayer() ? "人机局势分析" : "观战局势分析"
      : "AI 局势分析";
  elements.aiReviewModel.value = model.id;
  elements.aiReviewModel.disabled = running || isLiveOnlineFairPlayLocked() || protectingOnlineAI;
  elements.aiReviewModelNote.textContent = `${translateText(model.resourceNote)} ${translateText(model.strengthNote)}`;
  elements.aiReviewModelNote.classList.toggle("heavy", model.heavy);

  elements.aiReviewCurrent.hidden = running;
  elements.aiReviewAll.hidden = running || !replaySession;
  elements.aiReviewCancel.hidden = !running;
  elements.aiReviewCurrent.disabled = !canAnalyzeCurrent;
  elements.aiReviewAll.disabled = !replaySession || replaySession.steps.length === 0 ||
    isLiveOnlineFairPlayLocked();
  elements.aiReviewCurrent.textContent = analysis ? "重新深入分析" : "分析当前局面";
  elements.aiReviewAll.textContent = replaySession?.analysisByStep.size > 0
    ? "补齐整局分析"
    : "快速分析整局";

  let status = replaySession && isLiveOnlineFairPlayLocked()
    ? "在线对局尚未结束；为保证公平，比赛双方暂不能使用 AI 复盘。"
    : replaySession
    ? "停在任意一手，查看最多五个候选；悬停预演，点击固定变化。"
    : protectingOnlineAI
      ? "在线 AI 正在房主浏览器中行棋；落子后即可分析，避免抢占对局推理资源。"
    : isLiveOnlineFairPlayLocked()
      ? "为保证公平，在线黑白双方的实战页面禁用 AI；复盘时可以使用。"
      : hasOnlineSession()
        ? "分析只在你的浏览器中运行。可悬停候选，或直接在棋盘上自选一点。"
        : "分析当前局面，查看最多五个候选与后续变化。";
  if (running) {
    status = reviewStageText();
  } else if (replaySession?.analysisMessage || (!replaySession && liveAnalysis.message)) {
    status = replaySession?.analysisMessage ?? liveAnalysis.message;
  } else if (analysis) {
    const detail = [
      getAIModel(analysis.stats?.modelId ?? model.id).shortLabel,
      analysis.stats?.backend?.toUpperCase?.(),
      Number.isFinite(analysis.stats?.iterations)
        ? `搜索 ${analysis.stats.iterations} 次`
        : null,
    ].filter(Boolean).join(" · ");
    status = replaySession
      ? `第 ${replaySession.index} 手已有 AI 参考${detail ? ` · ${detail}` : ""}。`
      : `${hasOnlineSession() ? "观战" : "当前"}局面已有本地 AI 参考${detail ? ` · ${detail}` : ""}。`;
  } else if (!canAnalyzeCurrent) {
    status = protectingOnlineAI
      ? "在线 AI 正在行棋；请等它落子后再分析。"
      : isLiveOnlineFairPlayLocked()
      ? "为保证公平，在线黑白双方不能在实战中使用 AI 局势分析。"
      : "当前时间点已经进入点目或终局，AI 不再推荐落子。";
  }
  elements.aiReviewStatus.textContent = status;
  elements.aiReviewStatus.classList.toggle(
    "error",
    !running && (replaySession?.analysisError ?? liveAnalysis.error),
  );

  elements.aiReviewResult.hidden = !analysis;
  elements.aiReviewCandidates.replaceChildren();
  elements.aiVariationPreview.hidden = true;
  elements.boardStage.classList.toggle(
    "analysis-point-picking",
    Boolean(
      !replaySession && hasOnlineSession() && !isOnlinePlayer() &&
      activeSidebarTab === "analysis" && analysis,
    ),
  );
  if (!analysis) {
    renderCurrentAnalysisPosition();
    return;
  }

  const actualMove = replaySession?.steps?.[replaySession.index] ?? null;
  const rawCandidates = Array.isArray(analysis.stats?.candidates)
    ? analysis.stats.candidates
    : [];
  const candidates = analysisCandidatesFor(analysis);
  const comparison = compareReviewMove(actualMove, analysis.move, candidates);
  elements.aiReviewMove.textContent = formatReviewMove(analysis.move, boardHeight(frame));

  let comparisonText;
  if (!replaySession) {
    comparisonText = hasOnlineSession()
      ? "以下候选与变化只存在于当前观众页面，不会发送给比赛双方。"
      : "候选按本次短搜索排序；数值仅供判断方向，不等同于完整服务器分析。";
  } else if (comparison.kind === "match") {
    comparisonText = `实战 ${formatReviewMove(actualMove, boardHeight(frame))} 与 AI 首选一致。`;
  } else if (comparison.kind === "candidate") {
    comparisonText = `实战 ${formatReviewMove(actualMove, boardHeight(frame))} 是本次搜索候选第 ${comparison.rank}。`;
  } else if (comparison.kind === "outside") {
    comparisonText = `实战 ${formatReviewMove(actualMove, boardHeight(frame))} 未进入本次 ${comparison.candidateCount} 个已搜索候选；这不等于它一定是坏棋。`;
  } else {
    comparisonText = "这是棋谱当前末尾，没有实战下一手可比较。";
  }
  if (Number.isFinite(analysis.stats?.winRate)) {
    comparisonText += ` 首选搜索估值 ${Math.round(analysis.stats.winRate * 100)}%（当前行棋方视角）。`;
  }
  elements.aiReviewComparison.textContent = comparisonText;

  candidates.forEach((candidate, index) => {
    const summary = reviewCandidateSummary(candidate, candidates, {
      height: boardHeight(frame),
      rank: candidate.manual ? null : candidate.rank ?? index + 1,
    });
    if (!summary) return;
    const share = Number.isFinite(candidate.visitShare)
      ? candidate.visitShare
      : candidateVisitShare(candidate, rawCandidates);
    const percent = Math.round(share * 100);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-review-candidate-button";
    button.dataset.candidateKey = candidate.key;
    button.setAttribute("aria-pressed", "false");
    const rank = document.createElement("span");
    rank.className = "ai-review-rank";
    rank.textContent = candidate.manual ? "选" : String(candidate.rank ?? index + 1);
    const label = document.createElement("span");
    label.className = "ai-review-candidate-label";
    label.textContent = `${summary.moveLabel} · 胜率 ${summary.winRatePercent}% · 访问 ${percent}%`;
    const meter = document.createElement("span");
    meter.className = "ai-review-meter";
    meter.setAttribute("aria-label", `搜索访问占比 ${percent}%`);
    const fill = document.createElement("span");
    fill.style.width = `${percent}%`;
    meter.appendChild(fill);
    button.append(rank, label, meter);
    button.addEventListener("mouseenter", () => {
      applyReviewCandidateAction({ type: "hover", candidate }, candidates);
    });
    button.addEventListener("mouseleave", () => {
      applyReviewCandidateAction({ type: "leave" }, candidates);
    });
    button.addEventListener("focus", () => {
      applyReviewCandidateAction({ type: "hover", candidate }, candidates);
    });
    button.addEventListener("blur", () => {
      applyReviewCandidateAction({ type: "leave" }, candidates);
    });
    button.addEventListener("click", () => {
      applyReviewCandidateAction({ type: "toggle-pin", candidate }, candidates);
    });
    item.append(button);
    elements.aiReviewCandidates.appendChild(item);
  });
  applyReviewCandidateAction({ type: "leave" }, candidates);
}

function updateReplayUI() {
  const frame = replaySession.frames[replaySession.index];
  const lastIndex = replaySession.frames.length - 1;
  const move = replaySession.index > 0 ? frame.lastMove : null;
  const atRecordedEnd = replaySession.index === lastIndex;
  const finishedAtEnd = atRecordedEnd && frame.phase === PHASE_FINISHED;
  const scoringAtEnd = atRecordedEnd && frame.phase === PHASE_SCORING;
  const recordedResultAtEnd = atRecordedEnd && !finishedAtEnd
    ? String(replaySession.metadata?.result ?? "").trim().slice(0, 120)
    : "";
  const terminalAtEnd = finishedAtEnd || Boolean(recordedResultAtEnd);

  renderBoardPosition(frame, move);
  elements.blackCaptures.textContent = String(frame.captures.black);
  elements.whiteCaptures.textContent = String(frame.captures.white);
  elements.boardTopology.textContent =
    `${boardDimensionLabel(frame)} · ${boardPointCount(frame)} 点 · ${topologySurfaceName(frame.topology)}`;
  elements.moveNumber.textContent = `复盘 · 第 ${replaySession.index} / ${lastIndex} 手`;
  elements.phaseLabel.textContent = terminalAtEnd
    ? "复盘终局"
    : scoringAtEnd
      ? "复盘至点目"
      : replaySession.complete
        ? "整局复盘"
        : "续录复盘";
  elements.turnStone.hidden = replaySession.index === 0 || terminalAtEnd || scoringAtEnd;
  elements.turnStone.classList.toggle("black", move?.color === BLACK);
  elements.turnStone.classList.toggle("white", move?.color === WHITE);
  elements.turnText.textContent = finishedAtEnd
    ? formatResult(frame.result)
    : recordedResultAtEnd
      ? `棋谱结果 ${recordedResultAtEnd}`
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
  const availableViewCopy = frame.topology === TOPOLOGY_CYLINDER
    ? "平面、弧面或立体视图"
    : "平面或立体视图";
  const replayNote = replaySession.imported
    ? `来自 ${replaySession.sourceName || "导入的 SGF"}；可随时切换${availableViewCopy}。`
    : replaySession.complete
      ? `可随时切换${availableViewCopy}。`
      : "旧棋局只记录了升级后的棋步；仍可切换任意可用视图。";
  if (finishedAtEnd) {
    setMessage(frame.result?.reason === "resign"
      ? `复盘结束：${formatResult(frame.result)}。认输结果已还原。`
      : `复盘结束：${formatResult(frame.result)}。最终死子标记与点目结果已还原。`);
  } else if (recordedResultAtEnd) {
    setMessage(`复盘结束：SGF 记录结果 ${recordedResultAtEnd}。普通 SGF 不包含本项目的异形死子判定过程。${replayNote}`);
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

  syncLifecycleFromCurrentGame();
  elements.message.setAttribute("aria-live", "polite");
  const rematchSetup = isNextGameSetup();
  const renderedGame = rematchSetup ? rematchPreviewGame ?? game : game;
  const state = renderedGame.getState();
  const timeoutOutcome = rematchSetup ? null : currentTimeoutOutcome() ?? (
    state.result?.reason === "timeout" ? state.result : null
  );
  const resignOutcome = state.result?.reason === "resign" ? state.result : null;
  const renderLastMove = rematchSetup
    ? null
    : lastPlayedPoint
      ? { type: "play", ...lastPlayedPoint }
      : state.lastMove;
  renderBoardPosition(state, renderLastMove);

  if (rematchSetup) {
    elements.blackCaptures.textContent = "0";
    elements.whiteCaptures.textContent = "0";
    elements.boardTopology.textContent =
      `${boardDimensionLabel(state)} · ${boardPointCount(state)} 点 · ${topologySurfaceName(state.topology)}`;
    elements.phaseLabel.textContent = hasOnlineSession()
      ? "当前房间 · 下一局设置"
      : "下一局设置";
    elements.turnStone.hidden = true;
    elements.turnText.textContent = "预览下一局棋盘";
    elements.moveNumber.textContent = "确认设置后同步开局";
    elements.playControls.hidden = true;
    elements.scoringPanel.hidden = true;
    elements.replayPanel.hidden = true;
    elements.gesturePlace.textContent = "下一局预览 · 可拖动查看";
    syncLobbySettingsSummary();
    syncReplayEntryAvailability();
    updateRoomUI();
    syncAIReviewUI();
    return;
  }

  if (isLocalLobby()) {
    elements.blackCaptures.textContent = "0";
    elements.whiteCaptures.textContent = "0";
    elements.boardTopology.textContent =
      `${boardDimensionLabel(state)} · ${boardPointCount(state)} 点 · ${topologySurfaceName(state.topology)}`;
    elements.phaseLabel.textContent = "我的房间";
    elements.turnStone.hidden = true;
    elements.turnText.textContent = "邀请对局后开始";
    elements.moveNumber.textContent = "棋局尚未开始";
    elements.playControls.hidden = true;
    elements.scoringPanel.hidden = true;
    elements.replayPanel.hidden = true;
    elements.gesturePlace.textContent = "棋盘预览 · 可拖动查看";
    syncLobbySettingsSummary();
    syncReplayEntryAvailability();
    updateRoomUI();
    syncAIReviewUI();
    return;
  }

  if (matchLifecycle === MATCH_LIFECYCLE_WAITING) {
    elements.blackCaptures.textContent = "0";
    elements.whiteCaptures.textContent = "0";
    elements.boardTopology.textContent =
      `${boardDimensionLabel(state)} · ${boardPointCount(state)} 点 · ${topologySurfaceName(state.topology)}`;
    elements.phaseLabel.textContent = "邀请已发出";
    elements.turnStone.hidden = true;
    elements.turnText.textContent = "等待对手加入";
    elements.moveNumber.textContent = "棋局尚未开始";
    elements.playControls.hidden = true;
    elements.scoringPanel.hidden = true;
    elements.replayPanel.hidden = true;
    elements.gesturePlace.textContent = "棋盘预览 · 等待对手";
    syncReplayEntryAvailability();
    updateRoomUI();
    syncAIReviewUI();
    return;
  }

  elements.blackCaptures.textContent = String(state.captures.black);
  elements.whiteCaptures.textContent = String(state.captures.white);
  elements.boardTopology.textContent =
    `${boardDimensionLabel(state)} · ${boardPointCount(state)} 点 · ${topologySurfaceName(state.topology)}`;
  elements.moveNumber.textContent = `第 ${moveCount + 1} 手`;
  elements.turnStone.classList.toggle("black", state.currentPlayer === BLACK);
  elements.turnStone.classList.toggle("white", state.currentPlayer === WHITE);

  const playing = state.phase === PHASE_PLAY && !timeoutOutcome;
  const terminal = Boolean(timeoutOutcome || resignOutcome || state.phase === PHASE_FINISHED);
  elements.passButton.hidden = !playing;
  elements.newGameButton.hidden = true;
  elements.playControls.hidden = terminal;
  elements.playControls.classList.toggle("scoring-actions", !playing);
  elements.scoringPanel.hidden = playing || Boolean(timeoutOutcome) || Boolean(resignOutcome);
  elements.confirmScore.hidden = state.phase === PHASE_FINISHED;
  elements.resumeGame.hidden = state.phase === PHASE_FINISHED;
  syncReplayEntryAvailability();
  updateRoomUI();
  syncClockUI();
  syncAIReviewUI();

  if (timeoutOutcome) {
    elements.phaseLabel.textContent = "超时终局";
    elements.turnStone.hidden = true;
    elements.turnText.textContent = formatResult(timeoutOutcome);
    elements.moveNumber.textContent = `${moveCount} 手 · 计时结束`;
    return;
  }

  if (resignOutcome) {
    elements.phaseLabel.textContent = "认输终局";
    elements.turnStone.hidden = true;
    elements.turnText.textContent = formatResult(resignOutcome);
    elements.moveNumber.textContent = `${moveCount} 手 · 对局结束`;
    return;
  }

  if (state.phase === PHASE_PLAY) {
    const currentController = currentControllersByColor()[state.currentPlayer];
    elements.phaseLabel.textContent = state.consecutivePasses
      ? "一方已停着"
      : isAIMode()
        ? isAIvsAI() ? "AI 自对弈" : "AI 对战"
        : isOnlineAIMatch()
          ? "在线 AI 对战"
        : "对局中";
    elements.turnStone.hidden = false;
    elements.turnText.textContent = isAIMode()
      ? isAIvsAI()
        ? aiAutoplayPaused
          ? `已暂停 · ${colorName(state.currentPlayer)}待行`
          : `${colorName(state.currentPlayer)} AI ${aiThinking ? "正在思考" : "准备落子"}`
        : aiThinking
          ? "AI 正在思考"
          : state.currentPlayer === aiHumanColor
            ? "轮到你落子"
            : "AI 准备落子"
      : currentController === MATCH_CONTROLLER_AI
        ? `KataGo ${aiThinking ? "正在思考" : "准备落子"}`
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
    elements.moveNumber.textContent = `${boardDimensionLabel(state)} ${topologySurfaceName(state.topology)}`;
  }
}

function handleBoardPoint({ row, col }) {
  if (isBoardSetupMode()) {
    setMessage(isNextGameSetup()
      ? "这是下一局的棋盘预览；请先确认设置并开始下一局。"
      : "棋局尚未开始；请先邀请 AI、好友或本地对手。", true);
    return;
  }
  if (chatPointPicking && hasOnlineSession()) {
    insertPickedChatPoint(row, col);
    return;
  }
  if (isReplaying()) {
    setMessage("复盘不会修改棋局；请退出复盘后再落子。", true);
    return;
  }
  if (hasOnlineSession() && !isOnlinePlayer()) {
    if (activeSidebarTab === "analysis") {
      const analysis = currentAnalysisRecord();
      if (!analysis) {
        liveAnalysis.message = "请先点击“分析当前局面”，再在棋盘上选择想研究的点。";
        liveAnalysis.error = false;
        syncAIReviewUI();
        return;
      }
      try {
        const preview = GoEngine.fromState(currentAnalysisBaseState());
        const result = preview.play(row, col);
        if (!result.ok) {
          liveAnalysis.message = ERROR_MESSAGES[result.reason] || "这个点不能作为分析分支的第一手。";
          liveAnalysis.error = true;
          syncAIReviewUI();
          return;
        }
        liveAnalysis.manualCandidate = {
          move: { type: "play", row, col },
          visits: 0,
          winRate: analysis.stats?.winRate ?? 0.5,
          visitShare: 0,
          variation: [{ type: "play", row, col }],
        };
        const candidates = analysisCandidatesFor(analysis);
        const manual = candidates.find((candidate) => candidate.manual);
        reviewCandidateContextKey = analysisContextKey(analysis);
        reviewCandidateState = reduceReviewCandidateState(
          createReviewCandidateState(candidates),
          { type: "toggle-pin", candidate: manual },
          candidates,
        );
        liveAnalysis.message = `已在本页选择 ${formatReviewMove(manual.move)}；该分支不会发送到房间。`;
        liveAnalysis.error = false;
        syncAIReviewUI();
      } catch (error) {
        liveAnalysis.message = `无法建立本地分析分支：${error.message}`;
        liveAnalysis.error = true;
        syncAIReviewUI();
      }
      return;
    }
    setMessage("旁观者不能操作棋局。", true);
    return;
  }

  if (game.phase === PHASE_PLAY) {
    void dispatchMatchAction(MATCH_ACTION_PLAY, { row, col });
    return;
  }

  if (game.phase === PHASE_SCORING) {
    void dispatchMatchAction(MATCH_ACTION_TOGGLE_DEAD, { row, col });
  }
}

function undoOfflineGame() {
  if (isAIMode()) {
    if (!canUndoAIChoice()) {
      setMessage(
        isAIvsAI() ? "请先暂停 AI 自对弈，再撤回上一手。" : "你还没有可以撤回的棋步。",
        true,
      );
      return;
    }

    if (aiThinking) cancelAIThinking();
    if (isAIvsAI()) {
      const result = game.undo();
      if (!result.ok) {
        setMessage("现在没有可以撤回的棋步。", true);
        return;
      }
      moveCount = Math.max(0, moveCount - 1);
      syncLastPlayedPoint();
      retargetLocalTimeControl({ pause: true });
      setMessage(`已撤回${colorName(result.move.color)} AI 的上一手；自对弈保持暂停。`);
      updateUI();
      return;
    }
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
    retargetLocalTimeControl();
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
  retargetLocalTimeControl();
  setMessage(`已撤回${colorName(result.move.color)}的上一手。`);
  updateUI();
}

function resigningColor() {
  if (hasOnlineSession()) return isOnlinePlayer() ? currentIdentity().color : null;
  if (isAIMode()) return isAIvsAI() ? null : aiHumanColor;
  return game?.currentPlayer ?? null;
}

function showResignDialog() {
  const loser = resigningColor();
  if (
    !loser ||
    game?.phase !== PHASE_PLAY ||
    isReplaying() ||
    currentTimeoutOutcome()
  ) {
    setMessage("当前不能认输。", true);
    return;
  }
  elements.resignSummary.textContent = hasOnlineSession()
    ? `你将以${colorName(loser)}认输，对方立即获胜；不需要对方确认，此操作不能撤销。`
    : isAIMode()
      ? `你将以${colorName(loser)}向 ${currentAIName()} 认输；AI 立即获胜，此操作不能撤销。`
      : `${colorName(loser)}将认输，${colorName(oppositeColor(loser))}立即获胜；此操作不能撤销。`;
  if (typeof elements.resignDialog.showModal === "function") {
    elements.resignDialog.showModal();
  } else {
    elements.resignDialog.setAttribute("open", "");
  }
}

function confirmResignation() {
  const loser = resigningColor();
  if (
    !loser ||
    game?.phase !== PHASE_PLAY ||
    isReplaying() ||
    currentTimeoutOutcome()
  ) {
    setMessage("本局已经结束，不能再认输。", true);
    return;
  }
  void dispatchMatchAction(MATCH_ACTION_RESIGN, { color: loser });
}

function syncBoardCandidateHover(point) {
  if (activeSidebarTab !== "analysis" || isLiveOnlineFairPlayLocked()) {
    if (reviewCandidateState.hoveredKey) {
      applyReviewCandidateAction({ type: "leave" }, []);
    }
    return;
  }

  const analysis = currentAnalysisRecord();
  const candidates = analysis ? analysisCandidatesFor(analysis) : [];
  const candidate = point
    ? candidates.find((item) =>
        item.move?.type === "play" &&
        item.move.row === point.row &&
        item.move.col === point.col
      )
    : null;

  if (candidate) {
    if (reviewCandidateState.hoveredKey !== candidate.key) {
      applyReviewCandidateAction({ type: "hover", candidate }, candidates);
    }
  } else if (reviewCandidateState.hoveredKey) {
    applyReviewCandidateAction({ type: "leave" }, candidates);
  }
}

function handleHover(point) {
  syncBoardCandidateHover(point);
  if (!point) {
    elements.coordinateHint.textContent = "";
    return;
  }
  const displayedGame = liveDisplayedGame();
  const letter = COORDINATE_LETTERS[point.col] || String(point.col + 1);
  const coordinate = `${letter}${boardHeight(displayedGame) - point.row}`;
  const seamNotes = [];
  if (point.col === 0 || point.col === boardWidth(displayedGame) - 1) {
    seamNotes.push(
      isMobiusTopology()
        ? "A列与末列倒序相邻"
        : "A列与末列相邻",
    );
  }
  if (
    isTorusTopology() &&
    (point.row === 0 || point.row === boardHeight(displayedGame) - 1)
  ) {
    seamNotes.push("最上行与最下行相邻");
  }
  if (
    isMobiusTopology() &&
    (point.row === 0 || point.row === boardHeight(displayedGame) - 1)
  ) {
    seamNotes.push("莫比乌斯唯一边界");
  }
  elements.coordinateHint.textContent =
    `${coordinate}${seamNotes.length ? ` · ${seamNotes.join(" · ")}` : ""}${
      chatPointPicking ? " · 点击引用到聊天（不会落子）" : ""
    }`;
}

for (const button of elements.sidebarTabs) {
  button.addEventListener("click", () => {
    activateSidebarTab(button.dataset.sidebarTab, { focus: true });
  });
  button.addEventListener("keydown", (event) => {
    const currentIndex = elements.sidebarTabs.indexOf(button);
    let nextIndex = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % elements.sidebarTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + elements.sidebarTabs.length) % elements.sidebarTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.sidebarTabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = elements.sidebarTabs[nextIndex];
    activateSidebarTab(nextTab.dataset.sidebarTab, { focus: true });
  });
}
elements.timeControlPreset.addEventListener("change", () => {
  syncTimeControlFields();
  syncLobbySettingsSummary();
});

elements.replayButton.addEventListener("click", () => enterReplay());
elements.replayExit.addEventListener("click", () => exitReplay());
elements.exportSgf.addEventListener("click", exportCurrentSgf);
elements.importSgf.addEventListener("click", () => elements.importSgfFile.click());
elements.importSgfFile.addEventListener("change", () => {
  void importSgfFile(elements.importSgfFile.files?.[0]);
});
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
elements.aiReviewCurrent.addEventListener("click", analyzeCurrentPosition);
elements.aiReviewAll.addEventListener("click", analyzeWholeReplay);
elements.aiReviewCancel.addEventListener("click", () => {
  cancelReplayAIReview({ announce: true });
  syncAIReviewUI();
});

elements.passButton.addEventListener("click", () => {
  void dispatchMatchAction(MATCH_ACTION_PASS);
});

elements.undoButton.addEventListener("click", () => {
  void dispatchMatchAction(MATCH_ACTION_UNDO);
});

elements.resignButton.addEventListener("click", showResignDialog);
elements.confirmResign.addEventListener("click", confirmResignation);

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
  void dispatchMatchAction(MATCH_ACTION_FINISH_SCORING);
});

elements.resumeGame.addEventListener("click", () => {
  void dispatchMatchAction(MATCH_ACTION_RESUME_PLAY);
});

elements.directRematch.addEventListener("click", () => {
  void startImmediateRematch();
});
elements.adjustNextGame.addEventListener("click", enterNextGameSetup);

elements.confirmNextGame.addEventListener("click", () => {
  void startConfiguredNextGame();
});
elements.onlineMatchMode.addEventListener("change", updateUI);
elements.onlineMatchAiModel.addEventListener("change", updateUI);
elements.acceptGameInvitation.addEventListener("click", () => {
  const requestRevision = onlineRoom?.match?.request?.requestRevision;
  if (!Number.isSafeInteger(requestRevision)) return;
  void sendOnlineCommand("respond_game", { requestRevision, accept: true });
});
elements.declineGameInvitation.addEventListener("click", () => {
  const requestRevision = onlineRoom?.match?.request?.requestRevision;
  if (!Number.isSafeInteger(requestRevision)) return;
  void sendOnlineCommand("respond_game", { requestRevision, accept: false });
});
elements.cancelGameInvitation.addEventListener("click", () => {
  const requestRevision = onlineRoom?.match?.request?.requestRevision;
  if (!Number.isSafeInteger(requestRevision)) return;
  void sendOnlineCommand("cancel_game_request", { requestRevision });
});

for (const button of elements.sizeButtons) {
  button.addEventListener("click", () => {
    const size = Number(button.dataset.boardSize);
    if (!isBoardSetupMode()) return;
    setPendingDimensions(size, size);
    resetLobbyPreview();
  });
}

for (const button of elements.topologyButtons) {
  button.addEventListener("click", () => {
    if (!isBoardSetupMode()) return;
    const requestedTopology = button.dataset.boardTopology;
    const nextTopology = [
      TOPOLOGY_CYLINDER,
      TOPOLOGY_TORUS,
      TOPOLOGY_MOBIUS,
    ].includes(requestedTopology)
      ? requestedTopology
      : TOPOLOGY_CYLINDER;
    const previewMode = nextTopology === TOPOLOGY_CYLINDER ? "arc" : "3d";
    setPendingTopology(nextTopology);
    activeViewMode = previewMode;
    resetLobbyPreview();
  });
}

function commitPendingDimensionInputs() {
  if (!isBoardSetupMode()) return;
  if (lobbyPreviewFrame !== null) {
    window.cancelAnimationFrame(lobbyPreviewFrame);
    lobbyPreviewFrame = null;
  }
  const width = Number(elements.customWidth.value);
  const height = Number(elements.customHeight.value);
  const validWidth = Number.isInteger(width) &&
    width >= PUBLIC_MIN_BOARD_DIMENSION && width <= MAX_BOARD_DIMENSION;
  const validHeight = Number.isInteger(height) &&
    height >= PUBLIC_MIN_BOARD_DIMENSION && height <= MAX_BOARD_DIMENSION;
  elements.customWidth.setAttribute("aria-invalid", String(!validWidth));
  elements.customHeight.setAttribute("aria-invalid", String(!validHeight));
  setPendingDimensions(
    validWidth ? width : pendingWidth,
    validHeight ? height : pendingHeight,
  );
  elements.customWidth.setAttribute("aria-invalid", "false");
  elements.customHeight.setAttribute("aria-invalid", "false");
  resetLobbyPreview();
  setMessage(isNextGameSetup()
    ? `下一局预览已更新为 ${pendingWidth} × ${pendingHeight}；确认后会使用这套设置。`
    : `房间预览已更新为 ${pendingWidth} × ${pendingHeight}；邀请对局时会使用这套设置。`);
}

function scheduleLobbyDimensionPreview() {
  if (!isBoardSetupMode()) return;
  const width = Number(elements.customWidth.value);
  const height = Number(elements.customHeight.value);
  const validWidth = Number.isInteger(width) &&
    width >= PUBLIC_MIN_BOARD_DIMENSION && width <= MAX_BOARD_DIMENSION;
  const validHeight = Number.isInteger(height) &&
    height >= PUBLIC_MIN_BOARD_DIMENSION && height <= MAX_BOARD_DIMENSION;
  elements.customWidth.setAttribute("aria-invalid", String(!validWidth));
  elements.customHeight.setAttribute("aria-invalid", String(!validHeight));
  if (!validWidth || !validHeight) return;
  if (lobbyPreviewFrame !== null) window.cancelAnimationFrame(lobbyPreviewFrame);
  lobbyPreviewFrame = null;
  setPendingDimensions(width, height);
  resetLobbyPreview();
}

for (const input of [elements.customWidth, elements.customHeight]) {
  input.addEventListener("input", scheduleLobbyDimensionPreview);
  input.addEventListener("change", commitPendingDimensionInputs);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitPendingDimensionInputs();
    input.blur();
  });
}

for (const input of [
  elements.scoringRule,
  elements.komi,
  elements.mainTimeMinutes,
  elements.byoYomiPeriods,
  elements.byoYomiSeconds,
]) {
  input.addEventListener("change", () => {
    syncLobbySettingsSummary();
    if (isBoardSetupMode() && [elements.scoringRule, elements.komi].includes(input)) {
      resetLobbyPreview();
    }
  });
}

elements.newGameDialog.addEventListener("close", () => {
  if (elements.newGameDialog.returnValue === "confirm") void startNewGame();
  else {
    setPendingDimensions(boardWidth(), boardHeight());
    setPendingTopology(game.topology);
  }
});

function setViewMode(mode) {
  const torus = isTorusTopology();
  const mobius = isMobiusTopology();
  const cylinder = isCylinderTopology();
  const availableModes = cylinder
    ? ["flat", "arc", "3d"]
    : ["flat", "3d"];
  activeViewMode = availableModes.includes(mode)
    ? mode
    : !cylinder
      ? "flat"
      : "arc";
  const flatActive = activeViewMode === "flat";
  const arcActive = cylinder && activeViewMode === "arc";
  const cylinderActive = cylinder && activeViewMode === "3d";
  const torusActive = torus && activeViewMode === "3d";
  const mobiusActive = mobius && activeViewMode === "3d";
  const finePointer = window.matchMedia?.("(pointer: fine)")?.matches ?? false;
  elements.boardStage.dataset.viewMode = activeViewMode;
  elements.flatScene.hidden = !flatActive;
  elements.arcScene.hidden = !arcActive;
  elements.scene.hidden = !cylinderActive;
  elements.torusScene.hidden = !torusActive;
  elements.mobiusScene.hidden = !mobiusActive;
  flatView?.setActive(flatActive);
  arcView?.setActive(arcActive);
  cylinderView?.setActive(cylinderActive);
  torusView?.setActive(torusActive);
  mobiusView?.setActive(mobiusActive);
  if (arcActive) arcView?.setAutoRotate(autoRotateByView.arc);
  if (cylinderActive) {
    cylinderView?.setAutoRotate(autoRotateByView["3d"]);
  }
  if (torusActive) torusView?.setAutoRotate(autoRotateByView["3d"]);
  if (mobiusActive) mobiusView?.setAutoRotate(autoRotateByView["3d"]);

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
          primaryGesture: finePointer ? "右键任意方向拖动" : "单指任意方向拖动",
          secondaryGesture: "上下左右循环 · 支持斜向",
        }
      : mobius
        ? {
            resetIcon: "↤",
            resetLabel: "重置展开",
            primaryGesture: finePointer ? "右键横向拖动" : "单指横向拖动",
            secondaryGesture: "跨一圈上下翻转 · 两圈复位",
          }
      : {
          resetIcon: "↤",
          resetLabel: "重置展开",
          primaryGesture: finePointer ? "右键横向拖动" : "单指横向拖动",
          secondaryGesture: "改变展开起点",
        }
    : activeViewMode === "arc"
      ? {
          resetIcon: "↤",
          resetLabel: "重置弧面",
          primaryGesture: finePointer ? "右键横向拖动" : "单指横向拖动",
          secondaryGesture: "弧面循环 · 滚轮缩放",
        }
      : {
          resetIcon: "◎",
          resetLabel: torus
            ? "回正甜甜圈"
            : mobius
              ? "回正莫比乌斯"
              : "回正视角",
          primaryGesture: finePointer ? "右键拖动旋转" : "单指拖动旋转",
          secondaryGesture: torus
            ? "观察内圈与背面 · 滚轮缩放"
            : mobius
              ? "观察单面扭转与唯一边界 · 滚轮缩放"
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
  elements.gesturePlace.textContent = isBoardSetupMode()
    ? "棋盘预览 · 可拖动查看"
    : finePointer ? "左键点击落子" : "轻点落子";
  elements.coordinateHint.textContent = "";
  if (chatReferencePoint && chatReferenceFocusViews) {
    syncReferenceFocusRotationState();
    window.requestAnimationFrame(() => {
      activeBoardView()?.focusPoint?.(chatReferencePoint);
    });
  }
}

for (const button of elements.viewButtons) {
  button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
}

elements.resetView.addEventListener("click", () => {
  activeBoardView()?.resetView();
});
elements.toggleRotation.addEventListener("click", () => {
  if (activeViewMode === "flat") return;
  const active = !autoRotateByView[activeViewMode];
  autoRotateByView[activeViewMode] = active;
  elements.toggleRotation.setAttribute("aria-pressed", String(active));
  activeBoardView()?.setAutoRotate?.(active);
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
  cancelReplayAIReview({ terminate: true });
  aiActive = false;
  rememberPlayerName(name);
  showOnlineError();
  setOnlineBusy(true, "create");
  try {
    const result = await roomClient.createRoom({ name, ...getNewGameOptions() });
    if (matchLifecycle === MATCH_LIFECYCLE_LOBBY) {
      matchLifecycle = MATCH_LIFECYCLE_WAITING;
    }
    resetChatSessionState();
    updateRoomUrl(result.roomCode);
    closeOnlineDialog();
    setSidebarTab("settings");
    setMessage(`房间 ${result.roomCode} 已创建，把邀请链接发给朋友吧。`);
    // The HTTP result installs the session after the first room snapshot may
    // already have rendered. Refresh once more with the authoritative role so
    // host-only and turn-only controls cannot retain their offline state.
    updateUI();
  } catch (error) {
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
    showOnlineError(error.message || "创建房间失败，请稍后重试。");
  } finally {
    setOnlineBusy(false);
  }
}

async function joinOnlineRoom(role = "player") {
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
  cancelReplayAIReview({ terminate: true });
  aiActive = false;
  rememberPlayerName(name);
  showOnlineError();
  setOnlineBusy(true, role === "spectator" ? "watch" : "join");
  try {
    const result = await roomClient.joinRoom({ code, name, role });
    if (matchLifecycle === MATCH_LIFECYCLE_LOBBY) {
      matchLifecycle = MATCH_LIFECYCLE_WAITING;
    }
    resetChatSessionState();
    updateRoomUrl(result.roomCode);
    closeOnlineDialog();
    const identity = result.session ?? roomClient.identity;
    const roleText = identity?.color === BLACK
      ? "黑方"
      : identity?.color === WHITE
        ? "白方"
        : "旁观者";
    setMessage(`已加入房间 ${result.roomCode}，你是${roleText}。`);
    setSidebarTab(
      [ONLINE_MATCH_SETUP, ONLINE_MATCH_INVITED].includes(onlineMatchStatus())
        ? "settings"
        : "game",
    );
    // Joining can emit the first state before RoomClient exposes the new
    // identity. Re-render after the session is installed so spectators are
    // immediately read-only and player controls reflect the assigned seat.
    updateUI();
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
  if (aiWorkerContext?.kind === MATCH_TRANSPORT_ONLINE || isOnlineAIMatch()) {
    cancelAIThinking();
  }
  onlineRoom = null;
  rematchSetupTransport = null;
  rematchPreviewGame = null;
  onlineStateSynchronized = false;
  onlineCommandPending = false;
  onlineCommandRevision = null;
  lastAnnouncedRoomRevision = null;
  resetChatSessionState();
  updateRoomUrl();
  restoreOfflineGame();
  if (isLocalLobby()) setSidebarTab("settings");
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
    const abandon = window.confirm(translateText(
      "当前无法通知服务器释放座位。忘记房间只会清除本机凭据，原座位可能继续保留。确定继续吗？",
    ));
    if (!abandon) return;
    roomClient.abandonRoom();
    returnToOffline("已停止重连并忘记这个房间。");
    return;
  }
  const confirmed = window.confirm(translateText("退出房间会释放你的座位，确定退出吗？"));
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

for (const button of elements.openInviteButtons) {
  button.addEventListener("click", showInviteDialog);
}
elements.joinInvitation.addEventListener("click", () => navigateAppPath("/lobby"));
elements.cancelInvite.addEventListener("click", closeInviteDialog);
elements.inviteModifySettings.addEventListener("click", () => {
  closeInviteDialog();
  setSidebarTab("settings", { focus: true });
  setMessage("先调整棋盘、规则与计时；邀请对局时会使用同一套设置。");
});
elements.inviteAi.addEventListener("click", () => {
  closeInviteDialog();
  aiMatchMode = "human-ai";
  elements.aiMatchMode.value = aiMatchMode;
  showAIDialog();
});
elements.inviteSelfPlay.addEventListener("click", () => {
  closeInviteDialog();
  aiMatchMode = AI_MATCH_SELF_PLAY;
  elements.aiMatchMode.value = aiMatchMode;
  showAIDialog();
});
elements.inviteFriend.addEventListener("click", () => {
  closeInviteDialog();
  navigateAppPath("/lobby");
});
elements.inviteLocal.addEventListener("click", () => void startLocalTwoPlayerGame());
for (const button of elements.languageButtons) {
  button.addEventListener("click", () => setLocale(button.dataset.language));
}
const unsubscribeLocale = subscribeLocale(refreshLanguageDependentUI);
elements.changeAiSettings.addEventListener("click", showAIDialog);
elements.cancelAi.addEventListener("click", closeAIDialog);
elements.leaveAi.addEventListener("click", leaveAIGame);
elements.toggleAiAutoplay.addEventListener("click", toggleAIAutoplay);
elements.aiForm.addEventListener("submit", (event) => void startAIGame(event));
elements.aiModel.addEventListener("change", syncAIDialogModelPresentation);
elements.aiMatchMode.addEventListener("change", syncAIMatchModePresentation);
elements.aiReviewModel.addEventListener("change", () => {
  const requested = normalizeAIModelId(elements.aiReviewModel.value);
  const currentModelId = currentReviewModel().id;
  if (
    getAIModel(requested).heavy &&
    requested !== currentModelId &&
    !window.confirm(translateText(
      "b18 首次需要下载约 93.4 MB，并会占用数百 MB 内存与显存、增加耗电和发热。仅建议桌面端 WebGPU。确定切换吗？",
    ))
  ) {
    elements.aiReviewModel.value = currentModelId;
    return;
  }
  setReplayAnalysisModel(requested);
});
elements.cancelOnline.addEventListener("click", () => {
  if (appRouteMode === "online" && !hasOnlineSession()) {
    navigateAppPath("/lobby");
    return;
  }
  closeOnlineDialog();
});
elements.onlineModifySettings.addEventListener("click", () => {
  closeOnlineDialog();
  setSidebarTab("settings", { focus: true });
  setMessage("先在“棋盘设置”中调整棋盘；创建房间时会使用这里的同一套设置。");
});
elements.onlineForm.addEventListener("submit", (event) => event.preventDefault());
elements.createRoom.addEventListener("click", () => void createOnlineRoom());
elements.joinRoom.addEventListener("click", () => void joinOnlineRoom());
elements.watchRoom.addEventListener("click", () => void joinOnlineRoom("spectator"));
elements.lobbyCreateRoom.addEventListener("click", () => {
  showOnlineDialog("", { intent: "create" });
});
elements.lobbyJoinRoom.addEventListener("click", () => {
  showOnlineDialog("", { intent: "join" });
});
elements.lobbyRefresh.addEventListener("click", () => void refreshLobby({ announce: true }));
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
  elements.lobbyTopologyFilter,
  elements.lobbySizeFilter,
  elements.lobbyModeFilter,
]) {
  filter.addEventListener("change", () => void renderLobbyRooms());
}
elements.lobbyRoomList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-lobby-room]");
  if (!target) return;
  const code = sanitizeRoomCode(target.dataset.lobbyRoom);
  if (!code) return;
  const requestedRole = target.dataset.lobbyRole;
  const role = requestedRole === "spectator"
    ? "spectator"
    : requestedRole === "player"
      ? "player"
      : "";
  navigateAppPath(onlineRoomPath(code, role));
});
elements.copyRoomLink.addEventListener("click", () => void copyInvitationLink());
elements.leaveRoom.addEventListener("click", () => void leaveOnlineRoom());
elements.attachRoomAi.addEventListener("click", showAIDialog);
elements.detachRoomAi.addEventListener("click", () => void detachOnlineAI());
elements.opponentSeatAction.addEventListener("click", async () => {
  const action = elements.opponentSeatAction.dataset.action;
  if (action === "release_seat") {
    if (!window.confirm(translateText("释放白方席位后，你会继续留在房间旁观，其他观众可以接替白方。确定继续吗？"))) {
      return;
    }
    if (await sendOnlineCommand("release_seat")) {
      setMessage("已释放白方席位；你将继续留在房间旁观。", false);
    }
    return;
  }
  if (action === "claim_seat" && await sendOnlineCommand("claim_seat")) {
    setMessage("已成为白方；现在可以回应邀请或等待房主发起对局。", false);
  }
});
elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.chatInput.value;
  if (!text.trim()) return;
  void sendChatPayload({ kind: "text", text }, { clearText: true });
});
elements.chatInput.addEventListener("input", () => {
  if (chatStatusError) setChatStatus("");
  syncChatUI();
});
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = elements.chatInput.value;
    if (text.trim()) {
      void sendChatPayload({ kind: "text", text }, { clearText: true });
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setChatPointPicking(false);
    closeChatPickers();
  }
});
elements.chatEmoji.addEventListener("click", () => toggleChatPicker("emoji"));
elements.chatSticker.addEventListener("click", () => toggleChatPicker("sticker"));
elements.chatPoint.addEventListener("click", () => {
  setChatPointPicking(!chatPointPicking);
});
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
  // A retained `onlineRoom` is only a visual fallback during reconnect. Do not
  // unlock actions until a welcome/state message for this socket arrives.
  onlineStateSynchronized = false;
  if (event.terminal && [4401, 4404].includes(event.code) && !hasOnlineSession()) {
    returnToOffline(event.code === 4404
      ? "房间已因长时间无活动而关闭。"
      : "房间身份已经失效，请重新加入。");
    return;
  }
  if (!roomClient.isConnected && aiWorkerContext?.kind === MATCH_TRANSPORT_ONLINE) {
    cancelAIThinking();
  }
  updateRoomUI();
  if (roomClient.isConnected) maybeStartAITurn();
});
roomClient.on("state", ({ room }) => applyOnlineRoom(room));
roomClient.on("chat", applyOnlineChat);
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

initializeSidebarPanels();
syncTimeControlFields();
void loadVersionLabel();
setPendingDimensions(19, 19);
setPendingTopology(TOPOLOGY_CYLINDER);
elements.aiModel.value = preferredAIModelId;
elements.aiMatchMode.value = aiMatchMode;
syncAIDialogModelPresentation();
syncAIMatchModePresentation();
game = new GoEngine({
  size: 19,
  width: 19,
  height: 19,
  topology: TOPOLOGY_CYLINDER,
  komi: 7.5,
  scoringRule: SCORING_CHINESE,
});
cylinderView = new CylinderBoard(elements.scene, {
  width: boardWidth(),
  height: boardHeight(),
  size: 19,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
torusView = new TorusBoard(elements.torusScene, {
  width: boardWidth(),
  height: boardHeight(),
  size: 19,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
mobiusView = new MobiusBoard(elements.mobiusScene, {
  width: boardWidth(),
  height: boardHeight(),
  size: 19,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
flatView = new FlatBoard(elements.flatScene, {
  width: boardWidth(),
  height: boardHeight(),
  size: 19,
  topology: game.topology,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
arcView = new ArcBoard(elements.arcScene, {
  width: boardWidth(),
  height: boardHeight(),
  size: 19,
  onPoint: handleBoardPoint,
  onHover: handleHover,
});
setSidebarTab("settings");
buildChatPickers();
syncLanguageControls();
syncTopologyPresentation();
syncSoundControl();
setViewMode("arc");
updateUI();
applyDocumentTranslations(document);
rememberOfflineGame();
clockTimer = window.setInterval(tickClock, 250);

const initialUrl = new URL(window.location.href);
let initialRoute = parseAppRoute(initialUrl);
const legacyShare = parseShareUrl(initialUrl);
if (
  initialRoute.mode !== "lobby" &&
  initialRoute.mode !== "online" &&
  legacyShare.roomCode.length === 6
) {
  initialRoute = {
    mode: "online",
    roomCode: legacyShare.roomCode,
    role: legacyShare.role === "player" ? "player" : "spectator",
  };
}

if (initialRoute.mode === "single" && initialUrl.searchParams.has("connect")) {
  replaceAppPath("/lobby");
  initialRoute = { mode: "lobby", roomCode: "", role: "" };
}

if (initialRoute.mode === "root") {
  replaceAppPath("/single");
  initialRoute = { mode: "single", roomCode: "", role: "" };
} else if (initialRoute.mode === "single" && initialUrl.pathname !== "/single") {
  replaceAppPath("/single");
}

showAppScreen(initialRoute.mode);
if (initialRoute.mode === "online" && initialRoute.roomCode.length === 6) {
  const sharedRoomCode = initialRoute.roomCode;
  replaceAppPath(onlineRoomPath(sharedRoomCode, initialRoute.role));
  elements.roomCodeInput.value = sharedRoomCode;
  if (roomClient.resumeRoom(sharedRoomCode)) {
    updateRoomUrl(sharedRoomCode);
    setMessage(`正在恢复房间 ${sharedRoomCode}…`);
    updateRoomUI();
  } else {
    showOnlineDialog(sharedRoomCode, { intent: initialRoute.role });
    if (initialRoute.role === "spectator") {
      setMessage("这是观战入口；填写名字后请选择“进入观战”。");
    } else {
      setMessage("这是大厅的玩家入口；填写名字后申请空余的对手席位。");
    }
  }
}

const unlockGameSounds = () => void gameSounds.unlock();
window.addEventListener("pointerdown", unlockGameSounds, { capture: true, once: true });
window.addEventListener("keydown", unlockGameSounds, { capture: true, once: true });

window.addEventListener(
  "beforeunload",
  () => {
    cancelAIThinking();
    cancelReplayAIReview({ terminate: true });
    stopLobbyRefresh();
    if (clockTimer !== null) window.clearInterval(clockTimer);
    cylinderView.destroy();
    torusView.destroy();
    mobiusView.destroy();
    flatView.destroy();
    arcView.destroy();
    roomClient.destroy();
    unsubscribeLocale();
    void gameSounds.destroy();
  },
  { once: true },
);

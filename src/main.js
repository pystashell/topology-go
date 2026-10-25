import "./styles.css";
import {
  BLACK,
  WHITE,
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
  buildLiveReviewState,
} from "./game/replay.js";
import { exportSgf, importSgf, SgfError } from "./game/sgf.js";
import {
  BOARD_LIMITS,
  ENABLE_MULTI_GAME,
  GAME_GO,
  GAME_GOMOKU,
  GAME_OTHELLO,
  GOMOKU_FREESTYLE,
  isGameType,
} from "./game/gameTypes.js";
import { gameTypeOf, rulesFor } from "./game/rules/index.js";
import {
  boardLimitNote,
  clampBoardDimension,
  dimensionRangeText,
  formatGameResult,
  gameControls,
  gameMoveMessage,
  gameName,
  gameReplayStepMessage,
  gameSettingsSummary,
  gameStatusText,
  isOfferedBoardDimension,
  joinSentences,
  lobbyGameLabels,
  moveErrorMessage,
  newBoardMessage,
  normalizeRuleSet,
  rulesSummaryTitle,
  sgfOtherGameNote,
} from "./ui/gameUi.js";
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
  aiSeatName,
  defaultAIModelIdForGame,
  formatModelDownloadProgress,
  getAIModel,
  isAIModelIdForGame,
  normalizeAIModelId,
  normalizeGameAIModelId,
} from "./ai/modelCatalog.js";
import {
  GAME_AI_LEVEL_LABELS,
  gameAiEntry,
  gameAiSettings,
  normalizeGameAiLevel,
  usesGameAiProtocol,
} from "./ai/gameAiRegistry.js";
import {
  GAME_AI_ERRORS,
  createGameAi,
  gameAiPosition,
} from "./ai/gameAiClient.js";
import { aiMoveWaitMs } from "./ai/aiPacing.js";
import {
  AI_MATCH_SELF_PLAY,
  isAIControlledColor,
  normalizeAIMatchMode,
  shouldPauseAIMatchAtScoring,
  shouldRunAI,
} from "./ai/matchMode.js";
import { CylinderBoard } from "./view/CylinderBoard.js";
import { needsFreeBoardDrag, setBoardSwipeScrollsPage } from "./view/pointerGestures.js";
import { FlatBoard } from "./view/FlatBoard.js";
import { ArcBoard } from "./view/ArcBoard.js";
import { TorusBoard } from "./view/TorusBoard.js";
import { MobiusBoard } from "./view/MobiusBoard.js";
import { flipWaveDurationMs } from "./view/flipWave.js";
import { prefersReducedMotion } from "./view/gameMarkers.js";
import {
  RoomClient,
  CONNECTION_STATUS,
  buildShareUrl,
  parseAppRoute,
  parseShareUrl,
} from "./multiplayer/roomClient.js";
import {
  CHAT_CHANNEL_PLAYERS,
  CHAT_CHANNEL_SPECTATORS,
  CHAT_STICKERS,
  chatMessageChannel,
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
  localizedErrorMessage,
  setLocale,
  subscribeLocale,
  translateText,
} from "./i18n.js";
import {
  cancelLobbyRequest,
  loadLobbyOnce,
  refreshLobby,
  renderLobbyRooms,
  resumeLobbyPolling,
  wireLobbyFilters,
} from "./app/lobbyScreen.js";
import {
  syncAbandonmentPanel,
  syncRoomManagement,
  syncScoringCountdown,
  wireRoomManagement,
} from "./app/roomManagement.js";
import {
  exportCurrentSgf,
  importSgfFile,
} from "./app/recordFiles.js";
import {
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
} from "./app/chatPanel.js";

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
  lobbyGameFilter: $("#lobby-game-filter"),
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
  blackCountLabel: $("#black-count-label"),
  whiteCountLabel: $("#white-count-label"),
  scoreStrip: $(".score-strip"),
  playControls: $("#play-controls"),
  passButton: $("#pass-button"),
  undoButton: $("#undo-button"),
  hintButton: $("#hint-button"),
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
  recordActions: $(".record-actions"),
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
  customWidthRange: $("#custom-width-range"),
  customHeightRange: $("#custom-height-range"),
  boardLimitNote: $("#board-limit-note"),
  gameTypeField: $("#game-type-field"),
  gameTypeButtons: [...document.querySelectorAll("[data-game-type]")],
  dialogGamePickers: [...document.querySelectorAll(".dialog-game-picker")],
  gomokuRuleSelects: [...document.querySelectorAll("[data-gomoku-rule]")],
  gameOnlyElements: [...document.querySelectorAll("[data-game-only]")],
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
  onlineMatchAiModelNote: $("#online-match-ai-model-note"),
  onlineMatchBlackAiModelField: $("#online-match-black-ai-model-field"),
  onlineMatchBlackAiModel: $("#online-match-black-ai-model"),
  onlineMatchAiLevelField: $("#online-match-ai-level-field"),
  onlineMatchAiLevel: $("#online-match-ai-level"),
  onlineMatchBlackAiLevelField: $("#online-match-black-ai-level-field"),
  onlineMatchBlackAiLevel: $("#online-match-black-ai-level"),
  onlineMatchBlackAiModelNote: $("#online-match-black-ai-model-note"),
  roomUnlisted: $("#room-unlisted"),
  roomUnlistedBadge: $("#room-unlisted-badge"),
  abandonmentPanel: $("#abandonment-panel"),
  abandonmentTitle: $("#abandonment-title"),
  abandonmentNote: $("#abandonment-note"),
  claimAbandonment: $("#claim-abandonment"),
  roomManagePanel: $("#room-manage-panel"),
  roomListed: $("#room-listed"),
  roomMemberList: $("#room-member-list"),
  scoringCountdown: $("#scoring-countdown"),
  onlineMatchBlackAiLevelNote: $("#online-match-black-ai-level-note"),
  timeControlPreset: $("#time-control-preset"),
  customTimeFields: $("#custom-time-fields"),
  mainTimeMinutes: $("#main-time-minutes"),
  byoYomiPeriods: $("#byo-yomi-periods"),
  byoYomiSeconds: $("#byo-yomi-seconds"),
  sizeButtons: [...document.querySelectorAll("[data-board-size]")],
  topologyButtons: [...document.querySelectorAll("[data-board-topology]")],
  resetView: $("#reset-view"),
  toggleRotation: $("#toggle-rotation"),
  togglePageScroll: $("#toggle-page-scroll"),
  resetViewIcon: $("#reset-view-icon"),
  resetViewLabel: $("#reset-view-label"),
  gesturePrimary: $("#gesture-primary"),
  gestureSecondary: $("#gesture-secondary"),
  gesturePlace: $("#gesture-place"),
  // The board stage itself also carries data-view-mode for CSS. Only the
  // switch buttons are view controls; matching the stage would mark it
  // pressed and re-run setViewMode on every board tap.
  viewButtons: [...document.querySelectorAll(".view-switch [data-view-mode]")],
  arcViewButton: $("#arc-view-button"),
  threeDViewLabel: $("#three-d-view-label"),
  rulesSummary: $("#rules-summary"),
  cylinderRules: $("#cylinder-rules"),
  torusRules: $("#torus-rules"),
  mobiusRules: $("#mobius-rules"),
  goRules: $("#go-rules"),
  gomokuRules: $("#gomoku-rules"),
  othelloRules: $("#othello-rules"),
  rulesTopologyItems: [...document.querySelectorAll("[data-rules-topology]")],
  rulesSetItems: [...document.querySelectorAll("[data-rules-set]")],
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
  analysisTab: $("#sidebar-tab-analysis"),
  sidebarPanels: [...document.querySelectorAll("[data-sidebar-panel]")],
  roomStatusDot: $("#room-status-dot"),
  roomMode: $("#room-mode"),
  roomTitle: $("#room-title"),
  offlineOpponentActions: $("#offline-opponent-actions"),
  openInviteButtons: [...document.querySelectorAll("[data-open-invite]")],
  joinInvitation: $("#join-invitation"),
  roomConnected: $("#room-connected"),
  friendRoomCodeRow: $("#friend-room-code-row"),
  roomCode: $("#room-code"),
  localRole: $("#local-role"),
  copyRoomLink: $("#copy-room-link"),
  toggleOnlineAiAutoplay: $("#toggle-online-ai-autoplay"),
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
  friendSeatList: $("#friend-seat-list"),
  chatPanel: $("#chat-panel"),
  chatChannelTitle: $("#chat-channel-title"),
  chatChannelTabs: $("#chat-channel-tabs"),
  chatChannelButtons: [...document.querySelectorAll("[data-chat-channel]")],
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
  aiBlackModelField: $("#ai-black-model-field"),
  aiBlackModel: $("#ai-black-model"),
  aiLevelField: $("#ai-level-field"),
  aiLevel: $("#ai-level"),
  aiBlackLevelField: $("#ai-black-level-field"),
  aiBlackLevel: $("#ai-black-level"),
  aiLevelNote: $("#ai-level-note"),
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
  storedSessionPanel: $("#stored-session-panel"),
  storedSessionSelect: $("#stored-session-select"),
  resumeStoredSession: $("#resume-stored-session"),
  pendingJoinPanel: $("#pending-join-panel"),
  pendingJoinSelect: $("#pending-join-select"),
  retryPendingJoin: $("#retry-pending-join"),
  createRoom: $("#create-room"),
  pendingCreatePanel: $("#pending-create-panel"),
  pendingCreateSelect: $("#pending-create-select"),
  retryPendingCreate: $("#retry-pending-create"),
  abandonPendingCreate: $("#abandon-pending-create"),
  joinRoom: $("#join-room"),
  watchRoom: $("#watch-room"),
  appVersion: $("#app-version"),
  onlineError: $("#online-error"),
  cancelOnline: $("#cancel-online"),
  onlineBoardSummary: $("#online-board-summary"),
  onlineModifySettings: $("#online-modify-settings"),
  languageButtons: [...document.querySelectorAll("[data-language]")],
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
// Not a room mode: a human-AI round in which the guest plays White against
// the AI the host's browser runs as Black (request_game aiOpponent: guest).
const ONLINE_MODE_GUEST_AI = "guest-ai";
let matchLifecycle = MATCH_LIFECYCLE_LOBBY;
let lobbyPreviewFrame = null;
let appRouteMode = "single";
const autoRotateByView = { arc: false, "3d": false };
let moveCount = 0;
let pendingWidth = 19;
let pendingHeight = 19;
let pendingTopology = TOPOLOGY_CYLINDER;
// The game the settings panel prepares (Go unless multiple games are on), its
// Gomoku rule set, and the last board size chosen for each game this tab.
let pendingGameType = GAME_GO;
let pendingRuleSet = GOMOKU_FREESTYLE;
const pendingDimensionsByGame = new Map();
const gameMarkerCache = new Map();
let lastPlayedPoint = null;
// The last position drawn on the board ({context, count}). An Othello flip
// wave runs only when the next one is a single move further on in the same
// context: a move just played or one step forward in a replay, never an
// undo, a jump through history or a redraw.
let renderedMoveMark = null;
// When the running flip wave ends (performance.now() time); AI moves wait for it.
let flipWaveEndsAt = 0;
let onlineRoom = null;
let onlineStateSynchronized = false;
let onlineBusy = false;
let onlineEntryController = null;
let onlineCommandPending = false;
let onlineCommandRevision = null;
let onlineAIPauseIntent = null;
let onlineAIPauseSending = false;
let lastAnnouncedRoomRevision = null;
let rematchSetupTransport = null;
let rematchPreviewGame = null;
let offlineGameState = null;
let aiActive = false;
let aiMatchMode = "human-ai";
let aiAutoplayPaused = false;
let aiHumanColor = BLACK;
let preferredAIModelId = DEFAULT_AI_MODEL_ID;
let aiGameModelId = DEFAULT_AI_MODEL_ID;
let aiGameModelIds = {
  [BLACK]: DEFAULT_AI_MODEL_ID,
  [WHITE]: DEFAULT_AI_MODEL_ID,
};
// Gomoku and Othello AI difficulty per colour (local games; the online host
// reads its own level selects). Their engines live in gameAiClients.
let aiGameLevels = {
  [BLACK]: "normal",
  [WHITE]: "normal",
};
const gameAiClients = new Map();
let aiThinking = false;
// A move suggested to the human in a game against AI ({key, move}), shown
// while the position it was asked for (key) is still on the board.
let moveHint = null;
// The hint being worked out ({key, requestId}); null when none.
let hintPending = null;
let hintRequestSequence = 0;
const HINT_AI_LEVEL = "hard";
const HINT_THINK_MS = 2_000;
// aiWorkerContext.kind of a KataGo request that answers a hint.
const AI_CONTEXT_HINT = "hint";
let aiWorker = null;
let aiWorkerModelId = null;
let aiWorkerBusy = false;
let aiWorkerIdleTimer = null;
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
const GAME_AI_LEVEL_KEY = "3d-baduk-game-ai-level-v1";
// The lobby refreshes itself while it is on screen. 3 reads a minute stays
// far below the server's per-IP lobby budget (~120 GETs a minute).
const LOBBY_POLL_INTERVAL_MS = 20_000;
const LOBBY_RATE_LIMIT_BACKOFF_MS = 60_000;
const LOBBY_BOARD_SETTINGS_KEY = "3d-baduk-lobby-board-settings-v1";
// The game (and Gomoku rule set) last chosen for a new board.
const GAME_TYPE_KEY = "3d-baduk-game-type-v1";
// Touch screens: whether vertical swipes on free-drag boards scroll the page
// (off by default: up/down drags move the board).
const BOARD_SWIPE_SCROLLS_KEY = "topology-go-board-swipe-scrolls-page-v1";
const roomClient = new RoomClient();

function savedBoardSwipeScrollsPage() {
  try {
    return window.localStorage.getItem(BOARD_SWIPE_SCROLLS_KEY) === "true";
  } catch {
    return false;
  }
}

let boardSwipeScrollsPage = savedBoardSwipeScrollsPage();
setBoardSwipeScrollsPage(boardSwipeScrollsPage);

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

function savedGameAILevel() {
  try {
    return normalizeGameAiLevel(window.localStorage.getItem(GAME_AI_LEVEL_KEY));
  } catch {
    return normalizeGameAiLevel(null);
  }
}

function rememberGameAILevel(level) {
  try {
    window.localStorage.setItem(GAME_AI_LEVEL_KEY, normalizeGameAiLevel(level));
  } catch {
    // The level remains usable for this tab when storage is unavailable.
  }
}

/**
 * The game an AI dialog or online AI setup is about: the live room game, or
 * the board being prepared in the settings.
 */
function aiSetupGameType() {
  return hasOnlineSession() && !isNextGameSetup() ? gameTypeOf(game) : pendingGameType;
}

/** "KataGo" for Go, else the engine's (Chinese source) name, e.g. "Rapfi". */
function aiEngineName(gameType = gameTypeOf(game)) {
  return usesGameAiProtocol(gameType) ? gameAiEntry(gameType).sourceName : "KataGo";
}

function aiLevelLabel(level) {
  return GAME_AI_LEVEL_LABELS[normalizeGameAiLevel(level)];
}

const ONLINE_GO_MODEL_LABELS = Object.freeze({
  b10: "b10 · 快速",
  b18: "b18 · 增强（高耗资源）",
});

/**
 * Offer a game's AI in a model picker: KataGo's b10/b18 for Go, the game's
 * own engine otherwise. Labels are Chinese source copy (the page translates).
 */
function syncAIModelSelectOptions(select, gameType, { online = false } = {}) {
  if (!select) return;
  const key = usesGameAiProtocol(gameType) ? gameType : GAME_GO;
  if (select.dataset.aiGame === key) return;
  const previous = select.value;
  const choices = key === GAME_GO
    ? ["b10", "b18"].map((id) => ({
        value: id,
        text: online ? ONLINE_GO_MODEL_LABELS[id] : getAIModel(id).optionLabel,
      }))
    : [{ value: defaultAIModelIdForGame(key), text: gameAiEntry(key).sourceName }];
  select.replaceChildren(...choices.map(({ value, text }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
  }));
  select.dataset.aiGame = key;
  select.value = choices.some(({ value }) => value === previous) ? previous : choices[0].value;
}

/** The Gomoku/Othello AI client of a game, created on first use and reused. */
function gameAIFor(gameType) {
  let client = gameAiClients.get(gameType);
  if (!client) {
    client = createGameAi(gameType);
    gameAiClients.set(gameType, client);
  }
  return client;
}

/**
 * Stop a Gomoku or Othello AI turn in progress. The worker is kept for the
 * next move or game unless terminate asks to release it.
 */
function cancelGameAITurn({ terminate = false } = {}) {
  for (const client of gameAiClients.values()) {
    if (terminate) client.dispose();
    else client.cancel();
  }
}

/** A local Gomoku/Othello AI's level for a colour. */
function localAILevel(color = game?.currentPlayer) {
  return normalizeGameAiLevel(aiGameLevels[color]);
}

/** The online host's level for an AI colour (host-local, never sent). */
function onlineAILevel(color = game?.currentPlayer) {
  const select = color === BLACK && onlineRoom?.match?.mode === ONLINE_MODE_AI_AI
    ? elements.onlineMatchBlackAiLevel
    : elements.onlineMatchAiLevel;
  return normalizeGameAiLevel(select?.value);
}

function browserSupportsAIModel(modelId) {
  const model = getAIModel(modelId);
  return !model.requiresWebGPU || Boolean(window.navigator?.gpu);
}

function syncAIDialogModelPresentation() {
  const mode = normalizeAIMatchMode(elements.aiMatchMode.value);
  const gameType = aiSetupGameType();
  if (usesGameAiProtocol(gameType)) {
    // Gomoku and Othello engines run in a light worker without downloads.
    elements.aiModelWarningTitle.textContent = mode === AI_MATCH_SELF_PLAY
      ? aiEngineName(gameType)
      : `${aiEngineName(gameType)} · ${aiLevelLabel(elements.aiLevel.value)}`;
    elements.aiModelWarningResource.textContent =
      "AI 在浏览器后台运行，无需下载大型模型；每一手都按当前棋盘的接缝规则检查。";
    elements.aiModelWarningStrength.textContent =
      "简单会留出机会，普通会抓住明显的胜负手，困难会多看对方的一手应对。";
    elements.aiModelWarning.classList.remove("heavy", "error");
    elements.startAi.disabled = false;
    return;
  }
  const selectedModels = mode === AI_MATCH_SELF_PLAY
    ? [getAIModel(elements.aiBlackModel.value), getAIModel(elements.aiModel.value)]
    : [getAIModel(elements.aiModel.value)];
  const model = selectedModels.find((candidate) => candidate.heavy) ?? selectedModels[0];
  const supported = selectedModels.every((candidate) => browserSupportsAIModel(candidate.id));
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
aiGameModelIds = {
  [BLACK]: preferredAIModelId,
  [WHITE]: preferredAIModelId,
};
liveAnalysis.modelId = preferredAIModelId;
const gameSounds = createGameSounds({ enabled: soundEnabled });

// An idle AI worker keeps its decoded model so the next game starts without
// fetching and decompressing it again; free it after a long idle stretch.
const AI_WORKER_IDLE_RELEASE_MS = 10 * 60_000;

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

/** The board the views currently show: the replay frame, else the live game. */
function displayedBoardState() {
  return replaySession?.frames?.[replaySession.index] ?? liveDisplayedGame();
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
  return formatGameResult(result);
}

/** A game type the page may use: anything but Go needs multiple games on. */
function availableGameType(value) {
  return ENABLE_MULTI_GAME && isGameType(value) ? value : GAME_GO;
}

/** The rules of a game, engine, state or settings object (absent: Go). */
function gameRulesOf(value = game) {
  return rulesFor(availableGameType(gameTypeOf(value)));
}

/** Controls and counters for the game the board currently shows. */
function displayedGameControls(state = displayedBoardState()) {
  const view = typeof state?.getState === "function" ? state.getState() : state;
  return gameControls(availableGameType(gameTypeOf(view)), view);
}

/**
 * A fresh engine for new-game options, built by the options' game. Go keeps
 * exactly the Go engine the page always built; other games validate their
 * board settings first.
 */
function createGameFromOptions(options) {
  const rules = gameRulesOf(options);
  return rules.id === GAME_GO
    ? rules.create(options)
    : rules.create(rules.normalizeSettings(options));
}

function savedGameTypeChoice() {
  try {
    const raw = window.localStorage.getItem(GAME_TYPE_KEY);
    if (!raw) return null;
    const parsed = raw.startsWith("{") ? JSON.parse(raw) : { gameType: raw };
    return {
      gameType: availableGameType(parsed?.gameType),
      ruleSet: normalizeRuleSet(parsed?.ruleSet),
      sizesByGame: parsed?.sizesByGame ?? null,
    };
  } catch {
    return null;
  }
}

/** Remember the chosen game and the board size last used for each game. */
function rememberGameTypeChoice() {
  if (!ENABLE_MULTI_GAME) return;
  try {
    window.localStorage.setItem(
      GAME_TYPE_KEY,
      JSON.stringify({
        gameType: pendingGameType,
        ruleSet: pendingRuleSet,
        sizesByGame: Object.fromEntries(pendingDimensionsByGame),
      }),
    );
  } catch {
    // The choice still applies to this tab when storage is unavailable.
  }
}

/** Load saved board sizes per game, clamped to what each game offers. */
function restoreSizesByGame(sizesByGame) {
  if (!sizesByGame || typeof sizesByGame !== "object") return;
  for (const [savedGame, size] of Object.entries(sizesByGame)) {
    if (availableGameType(savedGame) !== savedGame) continue;
    pendingDimensionsByGame.set(savedGame, {
      width: clampBoardDimension(savedGame, size?.width),
      height: clampBoardDimension(savedGame, size?.height),
    });
  }
}

/**
 * Board markers for a position: Gomoku's winning row and Renju points
 * forbidden for Black, Othello's legal moves (when `hints`) and last flips.
 * Go draws its own markers. Results are cached by position, so a render loop
 * never rebuilds the Renju analysis for an unchanged board.
 */
function gameMarkersForState(state, { hints = false } = {}) {
  const gameType = availableGameType(gameTypeOf(state));
  if (gameType === GAME_GO || !Array.isArray(state?.board)) return null;
  const key = JSON.stringify([
    gameType, state.ruleSet ?? "", state.width, state.height, state.topology,
    state.currentPlayer, state.phase, hints, state.lastMove, state.result?.reason ?? "",
    state.board.map((row) => row.map((value) => value?.[0] ?? "-").join("")).join("/"),
  ]);
  if (gameMarkerCache.has(key)) return gameMarkerCache.get(key);
  let markers = null;
  try {
    const rules = rulesFor(gameType);
    markers = rules.viewMarkers(rules.hydratePublic(state), { hints });
  } catch (error) {
    console.error("Unable to compute board markers", error);
  }
  if (gameMarkerCache.size >= 8) gameMarkerCache.delete(gameMarkerCache.keys().next().value);
  gameMarkerCache.set(key, markers);
  return markers;
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
      const modelId = declared.modelId ?? defaultAIModelIdForGame(gameTypeOf(onlineRoom?.game));
      return isAIModelIdForGame(modelId, GAME_GO)
        ? `KataGo ${modelId}`
        : translateText(aiSeatName(modelId));
    }
    return operator?.name ?? roomSeat(color)?.name ?? translateText(colorName(color));
  }
  if (isAIMode() && usesGameAiProtocol(gameTypeOf(game))) {
    if (!isAIvsAI() && color === aiHumanColor) return translateText("你");
    return `${translateText(aiEngineName())} · ${translateText(aiLevelLabel(localAILevel(color)))}`;
  }
  if (isAIMode()) {
    if (isAIvsAI()) return `${getAIModel(localAIModelId(color)).shortLabel} AI`;
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
  if (hasOnlineSession()) {
    syncAbandonmentPanel(now);
    syncScoringCountdown(now);
  }
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
  forgetRenderedChat();
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
  if (elements.onlineDialog.open) renderStoredIdentityPanels();
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

function formatReviewMove(move, height = boardHeight()) {
  if (move?.type === "pass") return "停一手";
  if (move?.type !== "play") return "—";
  const letter = COORDINATE_LETTERS[move.col] || String(move.col + 1);
  return `${letter}${height - move.row}`;
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

function applyOnlineChat({ message, chat }) {
  if (!onlineRoom || !message) return;
  onlineRoom = { ...onlineRoom, chat };
  forgetRenderedChat();
  syncChatUI();
  if (chatMessageChannel(message) !== chatChannelView) return;
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
    hasOnlineSession() ? onlineRoom?.code : null,
    hasOnlineSession() ? onlineRoom?.positionToken : null,
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
  if (!gameRulesOf(game).capabilities.analysis) return false;
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
  const stagePrefix = active.context === "live"
    ? `${hasOnlineSession() ? "观战局面" : "当前局面"} · `
    : active.mode === "batch" && replaySession?.analysisBatch
      ? `整局分析 ${replaySession.analysisBatch.completed} / ${replaySession.analysisBatch.total} · 第 ${active.step} 手 · `
      : `第 ${active.step} 手 · `;
  if (active.stage === "loading_model") {
    const progress = Number.isFinite(active.loadedBytes) && active.loadedBytes > 0
      ? ` · ${formatModelDownloadProgress(active.loadedBytes, model.id)}`
      : "";
    return `${stagePrefix}载入 KataGo ${model.shortLabel} 模型（${model.downloadLabel}）${progress}…`;
  }
  if (active.stage === "neural_inference") {
    return `${stagePrefix}神经网络正在观察局面…`;
  }
  if (active.stage === "searching") {
    const topology = active.context === "live"
      ? game?.topology
      : replaySession?.frames?.[active.step]?.topology;
    return `${stagePrefix}正在按${topologyName(topology)}规则短搜索…`;
  }
  return `${stagePrefix}正在准备分析…`;
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
    liveAnalysis.message = `AI 局势分析暂时失败：${localizedErrorMessage(message, "分析线程返回错误")}`;
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
  if (!replaySession) return;
  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `AI 复盘暂时失败：${localizedErrorMessage(message, "分析线程返回错误")}`;
  replaySession.analysisError = true;
  syncAIReviewUI();
}

function handleReviewWorkerError(event) {
  if (!reviewActive) return;
  const failed = reviewActive;
  reviewActive = null;
  terminateReviewWorker();
  if (failed.context === "live") {
    liveAnalysis.message = `AI 局势分析线程没有正常启动：${localizedErrorMessage(event, "未知错误")}`;
    liveAnalysis.error = true;
    syncAIReviewUI();
    return;
  }
  if (!replaySession) return;
  replaySession.analysisBatch = null;
  replaySession.analysisMessage = `AI 复盘线程没有正常启动：${localizedErrorMessage(event, "未知错误")}`;
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
  if (!gameRulesOf(replaySession.source?.base).capabilities.analysis) return false;
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
    replaySession.analysisMessage = `无法重建第 ${step} 手：${localizedErrorMessage(error, "未知错误")}`;
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
    state = buildLiveReviewState(game, {
      online: hasOnlineSession(),
      replay: onlineRoom?.replay,
      moveCount,
    });
    worker = ensureReviewWorker();
  } catch (error) {
    liveAnalysis.message = `无法复制当前局面：${localizedErrorMessage(error, "未知错误")}`;
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
  if (!displayedGameControls().analysis) return;
  setSidebarTab("analysis");
  if (replaySession) analyzeCurrentReplayStep();
  else analyzeCurrentLivePosition();
}

function analyzeWholeReplay() {
  if (!replaySession) return;
  if (!gameRulesOf(replaySession.source?.base).capabilities.analysis) return;
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
    // Replay analysis loads its own copy of the model; do not hold two.
    cancelAIThinking({ terminate: true });
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
    const modelId = controller.modelId ?? defaultAIModelIdForGame(gameTypeOf(onlineRoom?.game));
    return {
      id: `controller:${candidate}`,
      // "KataGo b10 AI", "Rapfi AI" or "拓扑黑白棋 AI".
      name: aiSeatName(modelId),
      role: "ai",
      color: candidate,
      automated: true,
      modelId,
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

function isOnlineAISelfPlay() {
  if (!hasOnlineSession() || onlineRoom?.match?.mode !== ONLINE_MODE_AI_AI) return false;
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id;
  return Boolean(identityId && [BLACK, WHITE].every((color) => {
    const controller = onlineController(color);
    return controller?.kind === MATCH_CONTROLLER_AI &&
      controller.operatorId === identityId;
  }));
}

function pauseIntentMatchesRoom() {
  return Boolean(onlineAIPauseIntent &&
    onlineAIPauseIntent.code === onlineRoom?.code &&
    onlineAIPauseIntent.roundId === onlineRoom?.match?.roundId);
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
    // Pass, scoring and AI exist only in games whose rules offer them.
    gameCapabilities: gameRulesOf(game).capabilities,
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
    undoAvailable: online
      ? onlineRoom?.undoAvailable === true &&
        (!isOnlineAISelfPlay() ||
          (onlineRoom.match.aiAutoplayPaused === true &&
            !pauseIntentMatchesRoom() && !aiThinking))
      : localUndoAvailable,
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

function localAIModelId(color = game?.currentPlayer) {
  if (isAIvsAI()) {
    return normalizeAIModelId(aiGameModelIds[color] ?? aiGameModelId);
  }
  return normalizeAIModelId(aiGameModelId);
}

function currentAIName(color = game?.currentPlayer) {
  if (usesGameAiProtocol(gameTypeOf(game))) {
    const level = hasOnlineSession() ? onlineAILevel(color) : localAILevel(color);
    return `${aiEngineName()} · ${aiLevelLabel(level)}`;
  }
  return `KataGo ${getAIModel(localAIModelId(color)).shortLabel} ${topologyName()}混合 AI`;
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
      !onlineRoom?.match?.aiAutoplayPaused &&
      !(pauseIntentMatchesRoom() && onlineAIPauseIntent.paused) &&
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
  if (gameTypeOf(game) !== GAME_GO) {
    // Othello can skip a turn, so look for a recorded move of the human.
    return game.undoMoveColors().includes(aiHumanColor);
  }
  const firstHumanMoveNumber = aiHumanColor === WHITE ? 2 : 1;
  return moveCount >= firstHumanMoveNumber;
}

function syncAIMatchModePresentation() {
  const mode = normalizeAIMatchMode(elements.aiMatchMode.value);
  const onlineSeatMode = hasOnlineSession();
  const gameType = aiSetupGameType();
  const gameEngine = usesGameAiProtocol(gameType);
  syncAIModelSelectOptions(elements.aiModel, gameType);
  syncAIModelSelectOptions(elements.aiBlackModel, gameType);
  elements.aiMatchMode.closest(".dialog-field").hidden = onlineSeatMode;
  // A Gomoku or Othello engine plays both colours; only Go picks per colour.
  elements.aiBlackModelField.hidden = onlineSeatMode || mode !== AI_MATCH_SELF_PLAY || gameEngine;
  elements.aiModel.closest(".dialog-field").querySelector("span").textContent =
    mode === AI_MATCH_SELF_PLAY && !gameEngine ? "白方 AI 模型" : "AI 模型";
  // Gomoku and Othello pick a difficulty; KataGo's strength is its model.
  elements.aiLevelField.hidden = !gameEngine;
  elements.aiBlackLevelField.hidden = !gameEngine || onlineSeatMode || mode !== AI_MATCH_SELF_PLAY;
  elements.aiLevelField.querySelector("span").textContent =
    mode === AI_MATCH_SELF_PLAY && !onlineSeatMode ? "白方 AI 难度" : "AI 难度";
  elements.aiLevelNote.hidden = gameEngine;
  elements.aiHumanColorField.hidden = onlineSeatMode || mode === AI_MATCH_SELF_PLAY;
  if (gameEngine) {
    elements.aiDialogEyebrow.textContent = onlineSeatMode ? "在线 AI 座位" : "本机 AI 对手";
    elements.aiDialogTitle.textContent = onlineSeatMode
      ? onlineAISeat(WHITE) ? "调整房间里的 AI" : "让 AI 接替白方"
      : "和 AI 下一盘";
    elements.aiDialogIntro.textContent = onlineSeatMode
      ? "AI 仍在房主浏览器中运行，服务器只验证落子并同步给观众。接入后请保持房主页面在线。"
      : "AI 在浏览器后台按当前棋盘的接缝规则选择落点。无需账号或第三方 API，服务器不承担推理。";
    elements.startAi.textContent = onlineSeatMode
      ? onlineAISeat(WHITE) ? "更新在线 AI" : "接入白方座位"
      : isAIMode() ? "按新设置重开" : "开始对局";
    syncAIDialogModelPresentation();
    return;
  }
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

function clearAIWorkerIdleRelease() {
  if (aiWorkerIdleTimer !== null) window.clearTimeout(aiWorkerIdleTimer);
  aiWorkerIdleTimer = null;
}

function terminateAIWorker() {
  clearAIWorkerIdleRelease();
  aiWorker?.terminate();
  aiWorker = null;
  aiWorkerModelId = null;
  aiWorkerBusy = false;
}

function scheduleAIWorkerIdleRelease() {
  clearAIWorkerIdleRelease();
  if (!aiWorker) return;
  aiWorkerIdleTimer = window.setTimeout(() => {
    aiWorkerIdleTimer = null;
    // Keep the model while an AI game (local or online seat) still uses it.
    if (aiWorkerBusy || isAIMode() || isOnlineAIController()) {
      scheduleAIWorkerIdleRelease();
      return;
    }
    terminateAIWorker();
  }, AI_WORKER_IDLE_RELEASE_MS);
}

/**
 * Stop any AI turn in progress. A cooperative cancel cannot interrupt a model
 * download or a WebGPU dispatch, so a worker that is busy is terminated; an
 * idle worker is reused by the next game with the same model (replies to
 * older request ids are ignored). Pass terminate to always release it.
 */
function cancelAIThinking({ terminate = false } = {}) {
  if (aiWorkerContext?.kind === AI_CONTEXT_HINT) {
    aiWorkerContext.reject({ code: GAME_AI_ERRORS.CANCELLED });
  }
  aiRequestId += 1;
  cancelGameAITurn({ terminate });
  if (terminate || aiWorkerBusy) terminateAIWorker();
  else scheduleAIWorkerIdleRelease();
  aiThinking = false;
  aiWorkerContext = null;
  elements.boardStage?.removeAttribute("aria-busy");
}

function closeAIDialog() {
  if (typeof elements.aiDialog.close === "function") elements.aiDialog.close();
  else elements.aiDialog.removeAttribute("open");
}

function showAIDialog() {
  if (!gameRulesOf({ gameType: aiSetupGameType() }).capabilities.ai) {
    setMessage("这个棋类暂不支持 AI。", true);
    return;
  }
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
  const dialogGameType = aiSetupGameType();
  syncAIModelSelectOptions(elements.aiModel, dialogGameType);
  syncAIModelSelectOptions(elements.aiBlackModel, dialogGameType);
  if (usesGameAiProtocol(dialogGameType)) {
    elements.aiBlackModel.value = defaultAIModelIdForGame(dialogGameType);
    elements.aiModel.value = defaultAIModelIdForGame(dialogGameType);
    const remembered = savedGameAILevel();
    elements.aiBlackLevel.value = isAIMode() ? localAILevel(BLACK) : remembered;
    elements.aiLevel.value = hasOnlineSession()
      ? onlineAILevel(WHITE)
      : isAIMode() ? localAILevel(aiMatchMode === AI_MATCH_SELF_PLAY ? WHITE : aiColor()) : remembered;
  } else {
    elements.aiBlackModel.value = isAIMode() ? localAIModelId(BLACK) : preferredAIModelId;
    elements.aiModel.value = hasOnlineSession()
      ? normalizeAIModelId(onlineAISeat(WHITE)?.modelId ?? preferredAIModelId)
      : isAIMode() ? localAIModelId(WHITE) : preferredAIModelId;
  }
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
    // Gomoku and Othello rooms accept AI moves only from pages naming the game.
    ...(context.gameType && context.gameType !== GAME_GO ? { gameType: context.gameType } : {}),
  };
  const payload = move?.type === "play"
    ? { row: move.row, col: move.col, ...expectation }
    : expectation;
  if (!["play", "pass"].includes(move?.type)) {
    recoverFromAIError(context.gameType && context.gameType !== GAME_GO
      ? "AI 返回了无法提交的在线棋步。"
      : "KataGo 返回了无法提交的在线棋步。");
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
  cancelAIThinking({ terminate: true });
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
    gameTypeOf(game) === GAME_GO
      ? `${message} 已退出 AI 对局并保留当前棋局；现在可以本地轮流落子，或重新开始 KataGo 对局。`
      : `${message} 已退出 AI 对局并保留当前棋局；现在可以本地轮流落子，或重新开始 AI 对局。`,
    true,
  );
  updateUI();
}

function handleAIWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.id !== aiRequestId) return;
  if (message.type === "status") {
    const model = getAIModel(aiWorkerContext?.modelId ?? localAIModelId());
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
  aiWorkerBusy = false;
  if (message.type === "result") scheduleAIWorkerIdleRelease();
  else terminateAIWorker();
  if (context?.kind === AI_CONTEXT_HINT) {
    aiWorkerContext = null;
    if (message.type === "result") context.resolve(message.move);
    else context.reject(message);
    return;
  }
  if (message.type === "result") {
    // The AI stays "thinking" through the pause, so no other turn starts.
    const requestId = aiRequestId;
    afterAIPause(context?.startedAt, () => requestId === aiRequestId, () => {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      if (context?.kind === MATCH_TRANSPORT_ONLINE) {
        void applyOnlineAIMove(message.move, message.stats, context);
      } else {
        applyAIMove(message.move, message.stats);
      }
    });
    return;
  }
  aiThinking = false;
  elements.boardStage.removeAttribute("aria-busy");
  if (message.code !== "AI_SEARCH_CANCELLED") {
    recoverFromAIError(localizedErrorMessage(message, "AI 思考时发生错误。"));
  }
}

function handleAIWorkerError(event) {
  const context = aiWorkerContext;
  if (context?.kind === AI_CONTEXT_HINT) {
    aiWorkerContext = null;
    terminateAIWorker();
    context.reject(event);
    return;
  }
  if (!aiThinking) {
    // A kept idle worker that broke must not be reused by the next game.
    terminateAIWorker();
    return;
  }
  terminateAIWorker();
  aiThinking = false;
  elements.boardStage.removeAttribute("aria-busy");
  recoverFromAIError(localizedErrorMessage(event, "AI 思考线程没有正常启动。"));
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

/**
 * A Gomoku or Othello AI turn (local, or the online seat this host runs):
 * the game's engine answers through gameAiClient; the move is then played
 * like KataGo's (locally, or as ai_play for the room to validate).
 */
function startGameAITurn() {
  const onlineTurn = isOnlineAITurn();
  if (onlineTurn && aiFailedPositionToken === onlineRoom?.positionToken) return;
  const gameType = gameTypeOf(game);
  const color = game.currentPlayer;
  const onlineSeat = onlineTurn ? onlineAISeat(color) : null;
  const modelId = normalizeGameAIModelId(onlineSeat?.modelId, gameType);
  const level = onlineTurn ? onlineAILevel(color) : localAILevel(color);
  aiThinking = true;
  elements.boardStage.setAttribute("aria-busy", "true");
  setMessage(`${currentAIName()} 正在${onlineTurn ? "房主浏览器中" : ""}思考…`);
  updateUI();
  const requestId = ++aiRequestId;
  const context = onlineTurn
    ? {
        kind: MATCH_TRANSPORT_ONLINE,
        roomCode: roomClient.roomCode,
        positionToken: onlineRoom.positionToken,
        moveCount,
        color,
        modelId,
        gameType,
      }
    : { kind: MATCH_TRANSPORT_LOCAL, modelId, gameType, moveCount, color };
  aiWorkerContext = context;
  let position;
  try {
    position = gameAiPosition(game, { moveCount });
  } catch (error) {
    aiThinking = false;
    elements.boardStage.removeAttribute("aria-busy");
    recoverFromAIError(localizedErrorMessage(error, "AI 无法读取当前棋局。"));
    return;
  }
  const startedAt = performance.now();
  window.setTimeout(async () => {
    if (requestId !== aiRequestId || !shouldRunCurrentAI()) return;
    let answer;
    try {
      answer = await gameAIFor(gameType).choose(position, gameAiSettings(level));
    } catch (error) {
      if (requestId !== aiRequestId) return;
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      if (error?.code === GAME_AI_ERRORS.CANCELLED) {
        aiWorkerContext = null;
        updateUI();
        return;
      }
      recoverFromAIError(localizedErrorMessage(error, "AI 思考时发生错误。"));
      return;
    }
    if (requestId !== aiRequestId) return;
    const move = { type: "play", row: answer.move.row, col: answer.move.col };
    // The AI stays "thinking" through the pause, so no other turn starts.
    afterAIPause(startedAt, () => requestId === aiRequestId, () => {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      if (!game.checkPlay(move.row, move.col).ok) {
        recoverFromAIError("AI 返回了不合规则的落点。");
        return;
      }
      if (context.kind === MATCH_TRANSPORT_ONLINE) {
        void applyOnlineAIMove(move, answer.info, context);
      } else {
        aiWorkerContext = null;
        applyAIMove(move, answer.info);
      }
    });
  }, 120);
}

function maybeStartAITurn() {
  if (!shouldRunCurrentAI() || aiThinking) return;
  if (usesGameAiProtocol(gameTypeOf(game))) {
    startGameAITurn();
    return;
  }

  const onlineTurn = isOnlineAITurn();
  const onlineSeat = onlineTurn ? onlineAISeat(game.currentPlayer) : null;
  if (onlineTurn && aiFailedPositionToken === onlineRoom?.positionToken) return;
  const modelId = onlineTurn
    ? normalizeAIModelId(onlineSeat?.modelId)
    : localAIModelId(game.currentPlayer);
  if (!browserSupportsAIModel(modelId)) {
    aiWorkerContext = {
      kind: onlineTurn ? MATCH_TRANSPORT_ONLINE : MATCH_TRANSPORT_LOCAL,
      positionToken: onlineRoom?.positionToken ?? null,
    };
    recoverFromAIError(`${getAIModel(modelId).name} 需要 WebGPU，当前浏览器无法运行。`);
    return;
  }
  // A worker holds one model; switching models needs a fresh worker.
  if (aiWorker && aiWorkerModelId && aiWorkerModelId !== modelId) {
    cancelAIThinking({ terminate: true });
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
        startedAt: performance.now(),
      }
    : { kind: MATCH_TRANSPORT_LOCAL, modelId, startedAt: performance.now() };

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
        : game.exportSearchState();
    } catch (error) {
      aiThinking = false;
      elements.boardStage.removeAttribute("aria-busy");
      recoverFromAIError(localizedErrorMessage(error, "AI 无法读取当前棋局。"));
      return;
    }
    const level = KATAGO_AI;
    aiWorkerModelId = modelId;
    aiWorkerBusy = true;
    clearAIWorkerIdleRelease();
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

/**
 * Whether this page plays against an AI: a local human-vs-AI game, or an
 * online room where this viewer holds a seat and the other seat is an AI.
 * Only then does the play bar offer a hint.
 */
function playsAgainstAI() {
  if (!game || !gameRulesOf(game).capabilities.ai) return false;
  if (!hasOnlineSession()) return isAIMode() && !isAIvsAI();
  if (!isOnlinePlayer()) return false;
  const ownColor = currentIdentity().color;
  return onlineController(oppositeColor(ownColor))?.kind === MATCH_CONTROLLER_AI &&
    onlineController(ownColor)?.kind === MATCH_CONTROLLER_HUMAN;
}

/**
 * The play bar's hint button: shown through a game against AI, usable on the
 * human's turn, and busy while a hint is worked out.
 */
function syncHintButton(playing) {
  syncMoveHint();
  const offered = playing && playsAgainstAI() && !isReplaying() && !isNextGameSetup();
  elements.hintButton.hidden = !offered;
  elements.hintButton.disabled = !offered || Boolean(hintPending) || !canAskForHint();
  elements.hintButton.textContent = hintPending ? "提示中…" : "提示";
}

/** Whether the human may ask for a hint now (their turn, live play). */
function canAskForHint() {
  if (!playsAgainstAI() || game.phase !== PHASE_PLAY) return false;
  if (isReplaying() || isNextGameSetup() || currentTimeoutOutcome()) return false;
  if (hasOnlineSession()) {
    return isOnlineTurn() && onlineStateSynchronized && !currentUndoRequest() && !onlineCommandPending;
  }
  return game.currentPlayer === aiHumanColor && !aiThinking;
}

/** The position a hint answers: it lapses when any move, undo or game changes it. */
function hintPositionKey() {
  if (!game) return "";
  const state = game.getState();
  return JSON.stringify([
    gameTypeOf(state), state.width, state.height, state.topology, moveCount,
    state.currentPlayer, state.phase, state.lastMove,
  ]);
}

/** The hinted point to draw on the live board, while it still applies. */
function hintMoveFor(state) {
  if (!moveHint || moveHint.move?.type !== "play") return null;
  if (state !== undefined && gameTypeOf(state) !== gameTypeOf(game)) return null;
  return moveHint.key === hintPositionKey() && canAskForHint() ? moveHint.move : null;
}

/** Forget a hint that no longer applies (and one still being worked out). */
function syncMoveHint() {
  const key = hintPositionKey();
  if (moveHint && moveHint.key !== key) moveHint = null;
  if (hintPending && hintPending.key !== key) hintPending = null;
}

/**
 * Ask the AI for the move it would play for the human. Gomoku and Othello
 * use the game's own engine at its strongest level with a short think; Go
 * asks KataGo through the page's worker. The hint is drawn on the board and
 * named in the message until the position changes.
 */
async function requestMoveHint() {
  syncMoveHint();
  if (!canAskForHint() || hintPending) return;
  const key = hintPositionKey();
  if (moveHint?.key === key) {
    announceMoveHint(moveHint.move);
    renderCurrentAnalysisPosition();
    return;
  }
  const requestId = ++hintRequestSequence;
  hintPending = { key, requestId };
  setMessage("正在为你计算提示…");
  updateUI();
  let move = null;
  try {
    move = usesGameAiProtocol(gameTypeOf(game)) ? await gameAIHintMove() : await kataGoHintMove();
  } catch (error) {
    if (hintPending?.requestId !== requestId) return;
    hintPending = null;
    if (error?.code !== GAME_AI_ERRORS.CANCELLED) {
      setMessage(localizedErrorMessage(error, "暂时无法计算提示，请稍后再试。"), true);
    }
    updateUI();
    return;
  }
  if (hintPending?.requestId !== requestId) return;
  hintPending = null;
  if (hintPositionKey() !== key || !canAskForHint()) {
    updateUI();
    return;
  }
  const valid = move?.type === "pass"
    ? gameRulesOf(game).capabilities.pass
    : move?.type === "play" && game.checkPlay(move.row, move.col).ok;
  if (!valid) {
    setMessage("暂时无法计算提示，请稍后再试。", true);
    updateUI();
    return;
  }
  moveHint = {
    key,
    move: move.type === "pass" ? { type: "pass" } : { type: "play", row: move.row, col: move.col },
  };
  announceMoveHint(moveHint.move);
  updateUI();
}

function announceMoveHint(move) {
  setMessage(move.type === "pass"
    ? "提示：AI 建议这一手停一手。"
    : `提示：AI 建议下在 ${formatReviewMove(move, boardHeight())}（棋盘上已标出）。`);
}

/** A Gomoku/Othello hint: the game's engine plays the human's side. */
async function gameAIHintMove() {
  const answer = await gameAIFor(gameTypeOf(game)).choose(
    gameAiPosition(game, { moveCount }),
    { level: HINT_AI_LEVEL, timeLimitMs: HINT_THINK_MS },
  );
  return { type: "play", row: answer.move.row, col: answer.move.col };
}

/** A Go hint from KataGo, through the worker the AI opponent already uses. */
function kataGoHintMove() {
  return new Promise((resolve, reject) => {
    const online = hasOnlineSession();
    const opponentSeat = online ? onlineAISeat(oppositeColor(game.currentPlayer)) : null;
    const modelId = aiWorkerModelId ??
      (online ? normalizeAIModelId(opponentSeat?.modelId) : localAIModelId(aiColor()));
    if (!browserSupportsAIModel(modelId)) {
      reject(new Error(`${getAIModel(modelId).name} 需要 WebGPU，当前浏览器无法运行。`));
      return;
    }
    if (typeof Worker !== "function") {
      reject(new Error("当前浏览器不支持后台 AI 计算。"));
      return;
    }
    if (aiWorker && aiWorkerModelId && aiWorkerModelId !== modelId) terminateAIWorker();
    let worker;
    let state;
    try {
      worker = ensureAIWorker();
      state = online && onlineRoom?.replay
        ? buildReplayStateAtStep(onlineRoom.replay, moveCount)
        : game.exportSearchState();
    } catch (error) {
      reject(error);
      return;
    }
    const id = ++aiRequestId;
    aiWorkerContext = { kind: AI_CONTEXT_HINT, modelId, resolve, reject };
    aiWorkerModelId = modelId;
    aiWorkerBusy = true;
    clearAIWorkerIdleRelease();
    const level = KATAGO_AI;
    worker.postMessage({
      type: "think",
      id,
      modelId,
      state,
      options: {
        difficulty: "hard",
        timeLimitMs: level.timeMs,
        maxIterations: level.maxIterations,
        rolloutLimit: Math.min(level.rolloutLimit, boardPointCount() * 2),
      },
    });
  });
}

/**
 * Play an AI move only once it has been on screen long enough to follow:
 * at least a second after the AI's turn began and after the previous
 * move's flip wave. `stillWanted` is checked again after the wait.
 */
function afterAIPause(startedAt, stillWanted, play) {
  const wait = aiMoveWaitMs({ startedAt, now: performance.now(), animationEndsAt: flipWaveEndsAt });
  if (wait <= 0) {
    play();
    return;
  }
  window.setTimeout(() => {
    if (stillWanted()) play();
  }, wait);
}

async function startAIGame(event) {
  event?.preventDefault();
  if (matchLifecycle === MATCH_LIFECYCLE_FINISHED || isNextGameSetup()) {
    closeAIDialog();
    setMessage("本局已经结束；请使用“直接进行下一局”或“调整下一局设置”。", true);
    updateUI();
    return;
  }
  const dialogGameType = aiSetupGameType();
  if (!gameRulesOf({ gameType: dialogGameType }).capabilities.ai) {
    closeAIDialog();
    setMessage("这个棋类暂不支持 AI。", true);
    updateUI();
    return;
  }
  const gameEngine = usesGameAiProtocol(dialogGameType);
  const requestedMatchMode = normalizeAIMatchMode(elements.aiMatchMode.value);
  let requestedModelId;
  if (gameEngine) {
    // Gomoku and Othello: the game's own engine at the chosen difficulty.
    requestedModelId = defaultAIModelIdForGame(dialogGameType);
    const whiteLevel = normalizeGameAiLevel(elements.aiLevel.value);
    const blackLevel = normalizeGameAiLevel(elements.aiBlackLevel.value);
    rememberGameAILevel(whiteLevel);
    cancelAIThinking();
    if (hasOnlineSession()) {
      elements.onlineMatchAiLevel.value = whiteLevel;
    } else {
      aiGameLevels = requestedMatchMode === AI_MATCH_SELF_PLAY
        ? { [BLACK]: blackLevel, [WHITE]: whiteLevel }
        : { [BLACK]: whiteLevel, [WHITE]: whiteLevel };
    }
  } else {
    requestedModelId = normalizeAIModelId(elements.aiModel.value);
    const requestedBlackModelId = normalizeAIModelId(elements.aiBlackModel.value);
    const requestedModelIds = requestedMatchMode === AI_MATCH_SELF_PLAY
      ? [requestedBlackModelId, requestedModelId]
      : [requestedModelId];
    if (requestedModelIds.some((modelId) => !browserSupportsAIModel(modelId))) {
      syncAIDialogModelPresentation();
      setMessage("当前浏览器没有检测到 WebGPU，无法使用 b18；请选择 b10。", true);
      return;
    }
    cancelAIThinking();
    preferredAIModelId = requestedModelId;
    aiGameModelId = requestedModelId;
    aiGameModelIds = {
      [BLACK]: requestedBlackModelId,
      [WHITE]: requestedModelId,
    };
    rememberPreferredAIModel();
  }
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
    setMessage(gameEngine
      ? `正在把 ${aiEngineName(dialogGameType)} 接入在线白方座位…`
      : `正在把 KataGo ${getAIModel(requestedModelId).shortLabel} 接入在线白方座位…`);
    const sent = await sendOnlineCommand("attach_ai", { modelId: requestedModelId });
    // Updating/retrying an existing seat stops its old worker first. If the
    // command is rejected, resume the still-authoritative seat instead of
    // leaving the room frozen until another snapshot happens to arrive.
    if (!sent && hadOnlineAI) maybeStartAITurn();
    return;
  }
  aiMatchMode = requestedMatchMode;
  aiHumanColor = elements.aiHumanColor.value === WHITE ? WHITE : BLACK;
  aiAutoplayPaused = false;
  aiActive = true;
  matchLifecycle = MATCH_LIFECYCLE_PLAYING;
  closeAIDialog();
  await startNewGame();
  setMessage(
    isAIvsAI()
      ? gameEngine
        ? `AI 自对弈已开始：黑白双方都由 ${aiEngineName()} 控制。`
        : `AI 自对弈已开始：黑方 ${getAIModel(localAIModelId(BLACK)).shortLabel}，白方 ${getAIModel(localAIModelId(WHITE)).shortLabel}。`
      : aiHumanColor === BLACK
        ? `AI 对局已开始：你执黑，${currentAIName(aiColor())} 执白。`
        : `AI 对局已开始：${currentAIName(aiColor())} 执黑，正在思考第一手。`,
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
  if (isOnlineAISelfPlay()) {
    if (game.phase !== PHASE_PLAY || pauseIntentMatchesRoom()) return;
    const paused = !Boolean(onlineRoom.match.aiAutoplayPaused);
    onlineAIPauseIntent = {
      code: onlineRoom.code,
      roundId: onlineRoom.match.roundId,
      paused,
    };
    if (paused) cancelAIThinking();
    setMessage(paused ? "正在暂停在线 AI 自对弈…" : "正在继续在线 AI 自对弈…");
    updateUI();
    void flushOnlineAIPauseIntent();
    return;
  }
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

/**
 * A render-only engine for a public room snapshot, built by the snapshot's
 * game (absent gameType: Go, hydrated exactly as before multiple games).
 */
function hydratePublicGame(state) {
  return rulesFor(gameTypeOf(state)).hydratePublic(state);
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

function appendLobbyMetadata(container, text) {
  const item = document.createElement("span");
  item.textContent = text;
  container.append(item);
}

function showAppScreen(mode) {
  appRouteMode = mode === "lobby" ? "lobby" : mode === "online" ? "online" : "single";
  const lobbyVisible = appRouteMode === "lobby";
  elements.lobbyScreen.hidden = !lobbyVisible;
  elements.gameScreen.hidden = lobbyVisible;
  elements.headerTopologySwitch.hidden = lobbyVisible;
  if (lobbyVisible) {
    loadLobbyOnce();
    return;
  }
  cancelLobbyRequest();
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
  elements.resumeStoredSession.disabled = busy;
  elements.retryPendingJoin.disabled = busy;
  elements.retryPendingCreate.disabled = busy;
  elements.abandonPendingCreate.disabled = busy;
  elements.joinRoom.disabled = busy;
  elements.watchRoom.disabled = busy;
  elements.createRoom.textContent = busy && action === "create"
    ? "正在创建…"
    : roomClient.pendingCreateCode ? "重试上次建房" : "创建房间";
  elements.joinRoom.textContent = busy && action === "join" ? "正在加入…" : "加入房间";
  elements.watchRoom.textContent = busy && action === "watch" ? "正在进入观战…" : "进入观战";
  updateRoomUI();
}

function showOnlineError(message = "") {
  elements.onlineError.textContent = message;
  elements.onlineError.hidden = !message;
}

function renderPendingCreatePanel() {
  const pending = roomClient.listPendingCreates();
  const selectedId = elements.pendingCreateSelect.value;
  elements.pendingCreateSelect.replaceChildren(...pending.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.playerId;
    option.dataset.i18nIgnore = "";
    option.textContent = `${entry.roomCode} · ${entry.name} · ${entry.width} × ${entry.height}`;
    return option;
  }));
  if (pending.some((entry) => entry.playerId === selectedId)) {
    elements.pendingCreateSelect.value = selectedId;
  }
  elements.pendingCreatePanel.hidden = elements.createRoom.hidden || pending.length === 0;
  if (!onlineBusy) {
    elements.createRoom.textContent = roomClient.pendingCreateCode
      ? "重试上次建房" : "创建房间";
  }
}

function renderStoredIdentityPanels() {
  const code = sanitizeRoomCode(elements.roomCodeInput.value);
  const sessions = code.length === 6 ? roomClient.listStoredSessions(code) : [];
  const joins = code.length === 6 ? roomClient.listPendingJoins(code) : [];
  const selectedSession = elements.storedSessionSelect.value;
  const selectedJoin = elements.pendingJoinSelect.value;
  // Options mix a player's own name with a role label: translate only the
  // role and keep the name out of the DOM translator.
  elements.storedSessionSelect.replaceChildren(...sessions.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.playerId;
    option.dataset.i18nIgnore = "";
    option.textContent = `${entry.playerName || translateText("未命名")} · ${translateText(
      entry.color === BLACK ? "黑方" : entry.color === WHITE ? "白方" : "观众",
    )}`;
    return option;
  }));
  if (sessions.some((entry) => entry.playerId === selectedSession)) {
    elements.storedSessionSelect.value = selectedSession;
  }
  elements.pendingJoinSelect.replaceChildren(...joins.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.playerId;
    option.dataset.i18nIgnore = "";
    option.textContent = `${entry.name || translateText("未命名")} · ${translateText(
      entry.role === "spectator" ? "观战" : "玩家",
    )}`;
    return option;
  }));
  if (joins.some((entry) => entry.playerId === selectedJoin)) {
    elements.pendingJoinSelect.value = selectedJoin;
  }
  const entering = !elements.onlineRoomCodeField.hidden;
  elements.storedSessionPanel.hidden = !entering || sessions.length === 0;
  elements.pendingJoinPanel.hidden = !entering || joins.length === 0;
}

function rememberLobbyBoardSettings() {
  try {
    window.sessionStorage.setItem(
      LOBBY_BOARD_SETTINGS_KEY,
      JSON.stringify({
        ...getNewGameOptions(),
        // Board sizes last used for each game in this tab.
        sizesByGame: Object.fromEntries(pendingDimensionsByGame),
      }),
    );
  } catch {
    // Without tab storage the lobby simply starts from the default board.
  }
}

/** Apply board settings carried from /single into the lobby's create flow. */
function restoreLobbyBoardSettings() {
  let saved = null;
  try {
    saved = JSON.parse(window.sessionStorage.getItem(LOBBY_BOARD_SETTINGS_KEY) ?? "null");
  } catch {
    return;
  }
  if (!saved || typeof saved !== "object") return;
  const komi = Number(saved.komi);
  const clockNumber = (value, max) => {
    const numeric = Math.round(Number(value) || 0);
    return Math.max(0, Math.min(max, numeric));
  };
  // Settings saved before multiple games have no gameType: they are Go.
  const gameType = availableGameType(saved.gameType ?? GAME_GO);
  restoreSizesByGame(saved.sizesByGame);
  const options = {
    gameType,
    ...(gameType === GAME_GOMOKU ? { ruleSet: normalizeRuleSet(saved.ruleSet) } : {}),
    width: clampBoardDimension(gameType, normalizeBoardDimension(saved.width)),
    height: clampBoardDimension(gameType, normalizeBoardDimension(saved.height)),
    topology: [TOPOLOGY_CYLINDER, TOPOLOGY_TORUS, TOPOLOGY_MOBIUS].includes(saved.topology)
      ? saved.topology
      : TOPOLOGY_CYLINDER,
    scoringRule: saved.scoringRule === "japanese" ? "japanese" : SCORING_CHINESE,
    komi: Number.isFinite(komi) && komi >= 0 && komi <= 20 ? komi : 7.5,
    mainTimeSeconds: clockNumber(saved.mainTimeSeconds, 180 * 60),
    byoYomiPeriods: clockNumber(saved.byoYomiPeriods, 20),
    byoYomiSeconds: clockNumber(saved.byoYomiSeconds, 300),
  };
  reflectGameOptions(options);
  resetLobbyPreview();
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

/**
 * One line describing a game's settings. The invite dialog, the create-room
 * dialog and a received invitation all use it, so a guest sees the same
 * clock and komi the host chose.
 */
function boardSettingsSummary(settings) {
  return gameSettingsSummary(
    { ...settings, gameType: availableGameType(gameTypeOf(settings)) },
    { showGame: ENABLE_MULTI_GAME },
  );
}

function onlineBoardSummaryText() {
  const clock = selectedTimeControlConfig();
  return boardSettingsSummary({
    gameType: pendingGameType,
    ruleSet: pendingRuleSet,
    width: elements.customWidth.value,
    height: elements.customHeight.value,
    topology: pendingTopology,
    scoringRule: elements.scoringRule.value,
    komi: Number(elements.komi.value) || 0,
    mainTimeSeconds: clock?.mainTimeSeconds ?? 0,
    byoYomiPeriods: clock?.byoYomiPeriods ?? 0,
    byoYomiSeconds: clock?.byoYomiSeconds ?? 0,
  });
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
  // Creating a room uses the board settings configured on this page, so show
  // them. The lobby has no settings panel to jump back to.
  elements.onlineBoardSummarySection.hidden = !["all", "create"].includes(intent);
  elements.onlineModifySettings.hidden = appRouteMode === "lobby";
  elements.createRoom.hidden = entering;
  elements.onlineJoinDivider.hidden = intent !== "all";
  elements.onlineRoomCodeField.hidden = creating;
  elements.joinRoom.hidden = creating || spectatorOnly;
  elements.watchRoom.hidden = creating || playerOnly;
  renderPendingCreatePanel();
  renderStoredIdentityPanels();
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

function cancelOnlineDialog() {
  if (onlineEntryController) {
    onlineEntryController.abort();
    onlineEntryController = null;
    // Do not send leave or discard credentials: cancellation cannot undo a
    // request the server may already have committed.
    if (hasOnlineSession()) roomClient.detachRoom();
    else roomClient.disconnect({ preserveSession: false });
    onlineRoom = null;
    onlineStateSynchronized = false;
    setOnlineBusy(false);
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
  }
  closeOnlineDialog();
  if (appRouteMode === "online" && !hasOnlineSession()) navigateAppPath("/lobby");
}

function roomSeat(color) {
  return onlineRoom?.players?.find((player) => player.color === color) ?? null;
}

/** The online-mode option of a round or invitation (guest-AI included). */
function onlineModeOption(match) {
  const black = match?.controllers?.[BLACK];
  const white = match?.controllers?.[WHITE];
  if (match?.mode === ONLINE_MODE_HUMAN_AI &&
      black?.kind === MATCH_CONTROLLER_AI &&
      white?.kind === MATCH_CONTROLLER_HUMAN &&
      white.operatorId && white.operatorId !== black.operatorId) {
    return ONLINE_MODE_GUEST_AI;
  }
  return match?.mode ?? ONLINE_MODE_FRIEND;
}

function onlineModeLabel(mode = onlineModeOption(onlineRoom?.match)) {
  return {
    [ONLINE_MODE_FRIEND]: "好友对局",
    [ONLINE_MODE_HUMAN_AI]: "在线人机",
    [ONLINE_MODE_GUEST_AI]: "访客对 AI",
    [ONLINE_MODE_AI_AI]: "在线 AI 对弈",
    [ONLINE_MODE_LOCAL]: "在线同机双人",
  }[mode] ?? "在线房间";
}

function onlineControllerSeat(color) {
  const controller = onlineController(color);
  if (!controller) return { text: `等待${colorName(color)}`, online: false };
  const operator = onlineRoom?.players?.find((player) => player.id === controller.operatorId);
  if (controller.kind === MATCH_CONTROLLER_AI) {
    const modelId = controller.modelId ?? defaultAIModelIdForGame(gameTypeOf(onlineRoom?.game));
    return {
      text: isAIModelIdForGame(modelId, GAME_GO)
        ? `KataGo ${modelId} · AI`
        : aiSeatName(modelId),
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
  const summary = boardSettingsSummary(request.settings);
  if (onlineModeOption(request) !== ONLINE_MODE_GUEST_AI) return summary;
  const modelId = request.controllers[BLACK].modelId ??
    defaultAIModelIdForGame(gameTypeOf(request.settings));
  return `访客执白，AI 执黑（${aiSeatName(modelId)}）· ${summary}`;
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
  const nextScoreColor = active ? nextScoreConfirmationColor() : null;
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
  const kataGoGame = !usesGameAiProtocol(gameTypeOf(game));
  elements.roomTitle.textContent = active
    ? onlineAi
      ? kataGoGame ? "和 KataGo 对弈，朋友可以观战" : `和 ${aiEngineName()} 对弈，朋友可以观战`
      : "和朋友共享同一盘棋"
    : aiMode
      ? isAIvsAI()
        ? kataGoGame ? "KataGo 同时控制黑白双方" : `${aiEngineName()} 同时控制黑白双方`
        : `你执${colorName(aiHumanColor).replace("方", "")} · AI 执${colorName(aiColor()).replace("方", "")}`
      : lobby ? "还没有发起对局" : "双方在同一台设备轮流落子";
  if (active) {
    elements.roomMode.textContent = onlineModeLabel();
    elements.roomTitle.textContent = roomMatchStatus === ONLINE_MATCH_SETUP
      ? "设置并发起一盘新棋"
      : roomMatchStatus === ONLINE_MATCH_INVITED
        ? "对局邀请等待回应"
        : onlineAi
          ? kataGoGame
            ? "KataGo 在浏览器运行，朋友可以观战"
            : `${aiEngineName()} 在浏览器运行，朋友可以观战`
          : "房间对局已同步给所有成员";
  }
  elements.offlineOpponentActions.hidden = !lobby || reviewing;
  elements.roomConnected.hidden = !active;
  elements.aiConnected.hidden = !aiMode;
  const onlineSelfPlay = isOnlineAISelfPlay();
  elements.toggleOnlineAiAutoplay.hidden = !onlineSelfPlay;
  elements.toggleOnlineAiAutoplay.textContent = pauseIntentMatchesRoom()
    ? onlineAIPauseIntent.paused ? "正在暂停…" : "正在继续…"
    : onlineRoom?.match?.aiAutoplayPaused ? "继续对弈" : "暂停对弈";
  elements.toggleOnlineAiAutoplay.disabled = !onlineSelfPlay ||
    !onlineReady || !connected || onlineBusy || reviewing ||
    game?.phase !== PHASE_PLAY || pauseIntentMatchesRoom();
  const shownControls = displayedGameControls();
  if (elements.scoreStrip) {
    // Gomoku has nothing to count; Go counts captures and Othello discs.
    elements.scoreStrip.hidden = ((lobby || waiting || rematchSetup) && !reviewing) ||
      !shownControls.counts;
  }
  elements.clockPanel.hidden = reviewing || rematchSetup || [
    MATCH_LIFECYCLE_LOBBY,
    MATCH_LIFECYCLE_WAITING,
  ].includes(matchLifecycle);

  if (aiMode && !kataGoGame) {
    // Gomoku and Othello: the game's engine and its difficulty per colour.
    elements.aiOpponentName.textContent = isAIvsAI()
      ? `${aiEngineName()} · 自对弈`
      : currentAIName(aiColor());
    elements.aiLevelBadge.textContent = isAIvsAI()
      ? `${aiLevelLabel(localAILevel(BLACK))} / ${aiLevelLabel(localAILevel(WHITE))}`
      : aiLevelLabel(localAILevel(aiColor()));
    elements.aiBlackSeat.textContent = isAIvsAI()
      ? `AI · 黑方 · ${aiLevelLabel(localAILevel(BLACK))}`
      : aiHumanColor === BLACK ? "你 · 黑方" : "AI · 黑方";
    elements.aiWhiteSeat.textContent = isAIvsAI()
      ? `AI · 白方 · ${aiLevelLabel(localAILevel(WHITE))}`
      : aiHumanColor === WHITE ? "你 · 白方" : "AI · 白方";
  } else if (aiMode) {
    elements.aiOpponentName.textContent = isAIvsAI() ? "KataGo AI 自对弈" : currentAIName();
    elements.aiLevelBadge.textContent = isAIvsAI()
      ? `${getAIModel(localAIModelId(BLACK)).badgeLabel} / ${getAIModel(localAIModelId(WHITE)).badgeLabel}`
      : getAIModel(aiGameModelId).badgeLabel;
    elements.aiBlackSeat.textContent = isAIvsAI()
      ? `AI · 黑方 · ${getAIModel(localAIModelId(BLACK)).shortLabel}`
      : aiHumanColor === BLACK ? "你 · 黑方" : "AI · 黑方";
    elements.aiWhiteSeat.textContent = isAIvsAI()
      ? `AI · 白方 · ${getAIModel(localAIModelId(WHITE)).shortLabel}`
      : aiHumanColor === WHITE ? "你 · 白方" : "AI · 白方";
  }
  if (aiMode) {
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
        elements.roomHint.textContent =
          "多次重连仍未成功；网络恢复或回到本页时会自动重试，也可以忘记这个房间。";
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
        ? kataGoGame
          ? "把邀请链接发给朋友，或让 KataGo 接替空缺的白方座位。"
          : "把邀请链接发给朋友，或让 AI 接替空缺的白方座位。"
        : "等待白方加入后即可对弈。";
    } else if (undoRequest) {
      elements.roomHint.textContent = ownUndoRequest
        ? "悔棋申请已发送，等待对方回应。"
        : `${colorName(undoRequest.requesterColor)}申请撤回自己的上一手，请选择同意或拒绝。`;
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
          ? kataGoGame
            ? "KataGo 正在房主浏览器中思考；服务器会验证并同步棋步。"
            : `${aiEngineName()} 正在房主浏览器中思考；服务器会验证并同步棋步。`
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
  syncRoomManagement(onlineControlsAvailable);
  syncAbandonmentPanel();
  syncScoringCountdown();

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
    const guestAIRequest = onlineModeOption(gameRequest) === ONLINE_MODE_GUEST_AI;
    elements.gameInvitationTitle.textContent = ownsGameRequest
      ? "邀请已发出"
      : mayAnswerGameRequest
        ? guestAIRequest ? "房主邀请你执白对战 AI" : "房主邀请你开始对局"
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
  const onlineAiSelfPlay = active &&
    match.controllerByColor.black === MATCH_CONTROLLER_AI &&
    match.controllerByColor.white === MATCH_CONTROLLER_AI;
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
      : onlineAiSelfPlay
        ? onlineRoom?.match?.aiAutoplayPaused
          ? "直接撤回上一手，保持暂停"
          : "请先暂停 AI 自对弈，再撤回上一手"
        : match.opponentController === MATCH_CONTROLLER_AI
        ? "直接撤回你和 AI 的上一轮落子，不需要 AI 同意"
        : "需要对方同意后才会撤回你的上一手"
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
      ? "已申请撤回你的上一手，正在等待对方回应"
      : `${colorName(undoRequest.requesterColor)}申请撤回自己的上一手`;
  }
  elements.undoResponseActions.hidden = !undoRequest || ownUndoRequest;
  elements.cancelUndoRequest.hidden = !undoRequest || !ownUndoRequest;
  elements.approveUndo.disabled = reviewing || !onlineControlsAvailable || ownUndoRequest;
  elements.declineUndo.disabled = reviewing || !onlineControlsAvailable || ownUndoRequest;
  elements.cancelUndoRequest.disabled = reviewing || !onlineControlsAvailable || !ownUndoRequest;
  elements.confirmScore.disabled = !match.capabilities.finish_scoring || (active && !nextScoreColor);
  elements.resumeGame.disabled = !match.capabilities.resume_play;
  elements.confirmScore.textContent = active
    ? nextScoreColor
      ? `确认${colorName(nextScoreColor)}结果`
      : "已确认，等待对方"
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
  for (const button of elements.gameTypeButtons) button.disabled = !canChangeNextGameSettings;
  for (const select of elements.gomokuRuleSelects) select.disabled = !canChangeNextGameSettings;
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
  // Games without an AI offer only friend and same-browser rounds.
  const pendingMatchModes = gameRulesOf({ gameType: pendingGameType }).matchModes;
  for (const option of elements.onlineMatchMode.options) {
    const guestAI = option.value === ONLINE_MODE_GUEST_AI;
    const offered = pendingMatchModes.includes(guestAI ? ONLINE_MODE_HUMAN_AI : option.value);
    // Friend and guest-AI rounds need the guest in the White seat; the
    // others need that seat free.
    option.disabled = !offered || (guestAI
      ? !invitedHumanWhite
      : Boolean(occupiedWhiteMember && option.value !== ONLINE_MODE_FRIEND));
    option.hidden = !offered;
  }
  if (elements.onlineMatchMode.selectedOptions[0]?.disabled) {
    elements.onlineMatchMode.value = ONLINE_MODE_FRIEND;
  }
  const selectedOnlineMode = elements.onlineMatchMode.value;
  const onlineModeUsesAI = [ONLINE_MODE_HUMAN_AI, ONLINE_MODE_AI_AI].includes(
    selectedOnlineMode,
  );
  const onlineModeUsesBlackAI = [ONLINE_MODE_AI_AI, ONLINE_MODE_GUEST_AI].includes(selectedOnlineMode);
  const guestAINote = "访客执白；AI 执黑，在你的浏览器中运行";
  elements.onlineMatchBlackAiModelNote.textContent = selectedOnlineMode === ONLINE_MODE_GUEST_AI
    ? guestAINote
    : "AI 对 AI 时黑白双方可分别选择模型";
  elements.onlineMatchBlackAiLevelNote.textContent = selectedOnlineMode === ONLINE_MODE_GUEST_AI
    ? guestAINote
    : "AI 对 AI 时黑白双方可分别选择难度";
  // Go picks a KataGo model; Gomoku and Othello show their engine and a
  // difficulty that only the host's browser uses.
  const onlineGameEngine = usesGameAiProtocol(pendingGameType);
  syncAIModelSelectOptions(elements.onlineMatchAiModel, pendingGameType, { online: true });
  syncAIModelSelectOptions(elements.onlineMatchBlackAiModel, pendingGameType, { online: true });
  // One engine plays both colours of a Gomoku or Othello AI-vs-AI round.
  elements.onlineMatchBlackAiModelField.hidden = !onlineModeUsesBlackAI || onlineGameEngine;
  elements.onlineMatchAiModelField.hidden = !onlineModeUsesAI;
  elements.onlineMatchAiModelNote.textContent = onlineGameEngine
    ? "AI 在房主浏览器中运行，服务器只验证并同步棋步"
    : "b18 更强，但下载和显存占用明显更高";
  elements.onlineMatchBlackAiModel.disabled = !canChangeNextGameSettings || !onlineModeUsesBlackAI;
  elements.onlineMatchAiModel.disabled = !canChangeNextGameSettings || !onlineModeUsesAI;
  elements.onlineMatchBlackAiLevelField.hidden = !onlineGameEngine || !onlineModeUsesBlackAI;
  elements.onlineMatchAiLevelField.hidden = !onlineGameEngine || !onlineModeUsesAI;
  elements.onlineMatchBlackAiLevel.disabled = !canChangeNextGameSettings || !onlineModeUsesBlackAI;
  elements.onlineMatchAiLevel.disabled = !canChangeNextGameSettings || !onlineModeUsesAI;
  const showFriendInvitationDetails = active &&
    [ONLINE_MODE_FRIEND, ONLINE_MODE_GUEST_AI].includes(selectedOnlineMode);
  elements.friendRoomCodeRow.hidden = !showFriendInvitationDetails;
  elements.copyRoomLink.hidden = !showFriendInvitationDetails;
  elements.friendSeatList.hidden = !showFriendInvitationDetails;
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
  // SGF records, AI analysis and review are Go's for now.
  if (elements.recordActions) elements.recordActions.hidden = !shownControls.sgf;
  if (elements.analysisTab) {
    elements.analysisTab.hidden = !shownControls.analysis;
    if (!shownControls.analysis && activeSidebarTab === "analysis") setSidebarTab("game");
  }
  syncChatUI();
  syncMovePreviewAvailability();
  syncClockUI();
  syncPlayDock();
}

/**
 * On phones the board fills the first screen, which pushed the move status
 * and Pass/Undo below the fold. While this viewer is playing, styles.css
 * docks them to the bottom of the viewport (only at phone widths).
 */
function syncPlayDock() {
  // updateUI marks the controls live while moves are being played (Gomoku
  // and Othello have no Pass button, so its visibility cannot tell).
  const docked = !isReplaying() && !isNextGameSetup() &&
    !elements.playControls.hidden && elements.playControls.dataset.live === "true" &&
    !(hasOnlineSession() && !isOnlinePlayer());
  elements.gameScreen.classList.toggle("play-docked", docked);
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
      modelIds: { ...aiGameModelIds },
      levels: { ...aiGameLevels },
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
  elements.cylinderRules.hidden = !cylinder;
  elements.torusRules.hidden = !torus;
  elements.mobiusRules.hidden = !mobius;
  syncRulesNotes(topology);
  setViewMode(!cylinder && activeViewMode === "arc" ? "flat" : activeViewMode);
}

/**
 * The rules note under the settings: the board's topology, then the rules of
 * the game shown (Go's own bullets, or Gomoku's or Othello's).
 */
function syncRulesNotes(topology = displayedTopology()) {
  const shown = displayedBoardState();
  const gameType = availableGameType(gameTypeOf(shown));
  const ruleSet = gameType === GAME_GOMOKU
    ? normalizeRuleSet(shown?.ruleSet ?? pendingRuleSet)
    : null;
  elements.rulesSummary.textContent = rulesSummaryTitle(gameType, topology, {
    showGame: ENABLE_MULTI_GAME,
  });
  elements.goRules.hidden = gameType !== GAME_GO;
  elements.gomokuRules.hidden = gameType !== GAME_GOMOKU;
  elements.othelloRules.hidden = gameType !== GAME_OTHELLO;
  for (const item of elements.rulesTopologyItems) {
    item.hidden = !item.dataset.rulesTopology.split(/\s+/u).includes(topology ?? TOPOLOGY_CYLINDER);
  }
  for (const item of elements.rulesSetItems) item.hidden = item.dataset.rulesSet !== ruleSet;
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
  game = rulesFor(gameTypeOf(offlineGameState.game)).fromState(offlineGameState.game);
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
  aiGameModelIds = {
    [BLACK]: normalizeAIModelId(offlineGameState.ai?.modelIds?.[BLACK] ?? offlineGameState.ai?.modelId),
    [WHITE]: normalizeAIModelId(offlineGameState.ai?.modelIds?.[WHITE] ?? offlineGameState.ai?.modelId),
  };
  aiGameLevels = {
    [BLACK]: normalizeGameAiLevel(offlineGameState.ai?.levels?.[BLACK]),
    [WHITE]: normalizeGameAiLevel(offlineGameState.ai?.levels?.[WHITE]),
  };
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
  reflectLiveGameSettings(game);
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
      : `${colorName(undoRequest.requesterColor)}申请撤回自己的上一手。`);
  } else if (previousUndoRequest && !undoRequest) {
    setMessage(room.moveCount < previousRoom.moveCount
      ? "悔棋已同意，已撤回申请方的上一手。"
      : "悔棋申请已结束，棋局继续。");
  } else if (previousPhase === PHASE_SCORING && room.game.phase === PHASE_FINISHED) {
    // Without both confirmations the room ended the count on its timer.
    setMessage((room.scoreConfirmations ?? []).length < 2
      ? `点目时间到，已按当前死子标记自动确认：${formatResult(room.game.result)}。`
      : `点目完成：${formatResult(room.game.result)}。`);
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
  } else if (lastMove?.type === "play" && gameTypeOf(room.game) !== GAME_GO) {
    // Gomoku and Othello: the move may end the game (five, full board, disc
    // count) or skip the opponent automatically.
    setMessage(gameMoveMessage(lastMove, {
      gameType: gameTypeOf(room.game),
      result: room.game.phase === PHASE_FINISHED ? room.game.result : null,
    }));
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
    const ready = `${boardDimensionLabel(room.game)} ${topologySurfaceName(room.game.topology)}在线棋盘已准备好，黑方先行。`;
    setMessage(ENABLE_MULTI_GAME && gameTypeOf(room.game) !== GAME_GO
      ? `${gameName(gameTypeOf(room.game))} · ${ready}`
      : ready);
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
  if (onlineAIPauseIntent && !pauseIntentMatchesRoom()) {
    onlineAIPauseIntent = null;
  }
  if (!isOnlineNextGameSetup()) {
    elements.onlineMatchMode.value = onlineModeOption(room.match);
    reflectOnlineAIModelControls(room.match?.controllers);
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
  if (roomAI && isAIModelIdForGame(roomAI.modelId, GAME_GO)) {
    aiGameModelId = normalizeAIModelId(roomAI.modelId);
  }
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
    rematchPreviewGame = createGameFromOptions(options);
    elements.onlineMatchMode.value = onlineModeOption(room.match?.request ?? room.match);
    reflectOnlineAIModelControls(room.match?.request?.controllers ?? room.match?.controllers);
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
    clearChatReference();
    rebuildViews(boardWidth(), boardHeight(), game.topology);
  }
  if (!isOnlineNextGameSetup()) {
    reflectLiveGameSettings(game);
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
  void flushOnlineAIPauseIntent();
}

async function sendOnlineCommand(action, payload = {}, { onError } = {}) {
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
    onError?.(error);
    setMessage(localizedErrorMessage(error, "房间拒绝了这个操作。"), true);
    updateRoomUI();
    return false;
  } finally {
    if (action !== "set_ai_autoplay_paused" && onlineAIPauseIntent) {
      void flushOnlineAIPauseIntent();
    }
  }
}

async function flushOnlineAIPauseIntent() {
  if (!onlineAIPauseIntent || onlineAIPauseSending) return;
  if (!pauseIntentMatchesRoom() || !isOnlineAISelfPlay()) {
    onlineAIPauseIntent = null;
    updateUI();
    return;
  }
  if (onlineRoom.match.aiAutoplayPaused === onlineAIPauseIntent.paused) {
    const resumed = !onlineAIPauseIntent.paused;
    onlineAIPauseIntent = null;
    setMessage(resumed
      ? "在线 AI 自对弈已继续。"
      : "在线 AI 自对弈已暂停；可以悔一步、复盘或切换视图。");
    updateUI();
    if (resumed) maybeStartAITurn();
    return;
  }
  if (!roomClient.isConnected || !onlineStateSynchronized ||
      onlineBusy || onlineCommandPending) return;

  onlineAIPauseSending = true;
  let failure = null;
  const sent = await sendOnlineCommand(
    "set_ai_autoplay_paused",
    { paused: onlineAIPauseIntent.paused },
    { onError: (error) => { failure = error; } },
  );
  onlineAIPauseSending = false;
  if (!onlineAIPauseIntent || !pauseIntentMatchesRoom()) return;
  if (onlineRoom.match.aiAutoplayPaused === onlineAIPauseIntent.paused) {
    const resumed = !onlineAIPauseIntent.paused;
    onlineAIPauseIntent = null;
    setMessage(resumed
      ? "在线 AI 自对弈已继续。"
      : "在线 AI 自对弈已暂停；可以悔一步、复盘或切换视图。");
    updateUI();
    if (resumed) maybeStartAITurn();
    return;
  }
  if (!sent && ["STALE_GAME_STATE", "ACK_TIMEOUT"].includes(failure?.code)) {
    setMessage("棋局已更新，正在核对在线 AI 暂停状态…");
    void roomClient.command("sync").catch(() => {
      // A reconnect will supply a fresh room snapshot and retry the intent.
    });
  } else if (!sent && failure) {
    onlineAIPauseIntent = null;
    updateUI();
    maybeStartAITurn();
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
    if (actor === MATCH_CONTROLLER_AI && usesGameAiProtocol(gameTypeOf(game))) {
      setMessage(`${aiEngineName()} 已选好落点，正在由服务器验证并同步…`);
    } else if (actor === MATCH_CONTROLLER_AI) {
      const inferenceDetail = Number.isFinite(options.stats?.inferenceMs)
        ? `（推理 ${Math.round(options.stats.inferenceMs)} ms）`
        : "";
      setMessage(`KataGo 已完成判断${inferenceDetail}，正在由服务器验证并同步…`);
    }
    if (action === MATCH_ACTION_UNDO) {
      setMessage(
        route.command === "direct_undo_ai_round"
          ? "正在直接撤回你和 AI 的上一轮落子…"
          : route.command === "direct_undo_local_round" ||
              route.command === "direct_undo_ai_move"
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
      setMessage(moveErrorMessage(result), true);
      return false;
    }
    moveCount += 1;
    completeLocalTimedTurn();
    lastPlayedPoint = { row: payload.row, col: payload.col };
    playMoveSounds(result.captured?.length ?? 0);
    if (gameTypeOf(game) !== GAME_GO) {
      // Gomoku and Othello: a five, a draw or an Othello count can end the
      // game on this move, and Othello may skip the opponent automatically.
      setMessage(gameMoveMessage(result, { gameType: gameTypeOf(game), result: result.result }));
      updateUI();
      maybeStartAITurn();
      return true;
    }
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
      setMessage(moveErrorMessage(result, "当前不能认输。"), true);
      return false;
    }
    retargetLocalTimeControl({ pause: true });
    setMessage(`${formatResult(result)}。`);
    updateUI();
    return true;
  }

  if (action === MATCH_ACTION_NEW_GAME) {
    cancelAIThinking();
    game = createGameFromOptions(payload);
    if (aiActive && !gameRulesOf(game).capabilities.ai) {
      // A game without an AI, prepared after an AI game, is played by two
      // people on this device.
      aiActive = false;
      aiAutoplayPaused = false;
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
    createLocalTimeControl(payload);
    moveCount = 0;
    lastPlayedPoint = null;
    elements.coordinateHint.textContent = "";
    rebuildViews(payload.width, payload.height, payload.topology);
    setMessage(newBoardMessage(payload, { showGame: ENABLE_MULTI_GAME }));
    updateUI();
    maybeStartAITurn();
    return true;
  }

  if (action === MATCH_ACTION_TOGGLE_DEAD) {
    const result = game.toggleDead(payload.row, payload.col);
    if (!result.ok) {
      setMessage(moveErrorMessage(result, "这里不能标记。"), true);
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
  pendingWidth = clampBoardDimension(pendingGameType, width, pendingWidth);
  pendingHeight = clampBoardDimension(pendingGameType, height, pendingHeight);
  pendingDimensionsByGame.set(pendingGameType, { width: pendingWidth, height: pendingHeight });
  elements.customWidth.value = String(pendingWidth);
  elements.customHeight.value = String(pendingHeight);
  for (const button of elements.sizeButtons) {
    const shortcut = Number(button.dataset.boardSize);
    const active = shortcut === pendingWidth && shortcut === pendingHeight;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

/**
 * Choose the game the settings prepare. Only the game (and Gomoku's rule
 * set) changes here; callers then set the board size for that game.
 */
function setPendingGameType(gameType, { ruleSet } = {}) {
  pendingGameType = availableGameType(gameType);
  if (ruleSet !== undefined && ruleSet !== null) pendingRuleSet = normalizeRuleSet(ruleSet);
  syncGameTypeControls();
}

/** Reflect the pending game in every game picker and game-only control. */
function syncGameTypeControls() {
  const gameType = pendingGameType;
  const limits = BOARD_LIMITS[gameType];
  for (const button of elements.gameTypeButtons) {
    const active = button.dataset.gameType === gameType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const select of elements.gomokuRuleSelects) select.value = pendingRuleSet;
  for (const element of elements.gameOnlyElements) {
    element.hidden = !element.dataset.gameOnly.split(/\s+/u).includes(gameType);
  }
  if (elements.gameTypeField) elements.gameTypeField.hidden = !ENABLE_MULTI_GAME;
  const lobbyGameFilter = elements.lobbyGameFilter?.closest("label");
  if (lobbyGameFilter) lobbyGameFilter.hidden = !ENABLE_MULTI_GAME;
  for (const picker of elements.dialogGamePickers) picker.hidden = !ENABLE_MULTI_GAME;
  for (const button of elements.sizeButtons) {
    const games = (button.dataset.sizeGames ?? GAME_GO).split(/\s+/u);
    button.hidden = !games.includes(gameType);
  }
  for (const input of [elements.customWidth, elements.customHeight]) {
    input.min = String(limits.publicMin);
    input.max = String(limits.max);
    input.step = limits.parity === "even" ? "2" : "1";
  }
  elements.customWidthRange.textContent = dimensionRangeText(gameType, "width");
  elements.customHeightRange.textContent = dimensionRangeText(gameType, "height");
}

/** Mirror a live game's settings into the (read-only) settings panel. */
function reflectLiveGameSettings(liveGame) {
  setPendingGameType(gameTypeOf(liveGame), { ruleSet: liveGame?.ruleSet });
  setPendingDimensions(boardWidth(liveGame), boardHeight(liveGame));
  setPendingTopology(liveGame?.topology);
  if (gameTypeOf(liveGame) === GAME_GO) {
    elements.scoringRule.value = liveGame.scoringRule;
    elements.komi.value = String(liveGame.komi);
  }
}

/**
 * The settings picker chose another game: keep the topology and clock, and
 * restore the board size last used for that game (else its default).
 */
function selectGameType(gameType) {
  const next = availableGameType(gameType);
  if (!isBoardSetupMode()) {
    syncGameTypeControls();
    return;
  }
  if (next === pendingGameType) return;
  setPendingGameType(next);
  const remembered = pendingDimensionsByGame.get(next);
  const limits = BOARD_LIMITS[next];
  setPendingDimensions(
    remembered?.width ?? limits.defaultWidth,
    remembered?.height ?? limits.defaultHeight,
  );
  elements.boardLimitNote.hidden = true;
  rememberGameTypeChoice();
  resetLobbyPreview();
}

function selectGomokuRuleSet(ruleSet) {
  if (!isBoardSetupMode()) {
    syncGameTypeControls();
    return;
  }
  pendingRuleSet = normalizeRuleSet(ruleSet);
  syncGameTypeControls();
  rememberGameTypeChoice();
  // The preview is rebuilt under the new rules (Renju marks forbidden points).
  resetLobbyPreview();
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

/**
 * The settings of the next game. With multiple games every option set names
 * its game (also "go", so switching a room back to Go is explicit); Go keeps
 * its komi and scoring rule, Gomoku adds its rule set.
 */
function getNewGameOptions() {
  const gameType = pendingGameType;
  const width = clampBoardDimension(gameType, elements.customWidth.value, pendingWidth);
  const height = clampBoardDimension(gameType, elements.customHeight.value, pendingHeight);
  const timeControl = selectedTimeControlConfig();
  setPendingDimensions(width, height);
  return {
    ...(ENABLE_MULTI_GAME ? { gameType } : {}),
    ...(gameType === GAME_GOMOKU ? { ruleSet: pendingRuleSet } : {}),
    width,
    height,
    ...(width === height ? { size: width } : {}),
    topology: pendingTopology,
    ...(gameType === GAME_GO
      ? {
          scoringRule: elements.scoringRule.value,
          komi: Number(elements.komi.value) || 0,
        }
      : {}),
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
    ONLINE_MODE_GUEST_AI,
    ONLINE_MODE_AI_AI,
    ONLINE_MODE_LOCAL,
  ].includes(mode) ? mode : ONLINE_MODE_FRIEND;
}

function selectedOnlineAIModelIds() {
  if (usesGameAiProtocol(pendingGameType)) {
    // Gomoku and Othello seat their game's own engine.
    const modelId = defaultAIModelIdForGame(pendingGameType);
    return { [BLACK]: modelId, [WHITE]: modelId };
  }
  return {
    [BLACK]: normalizeAIModelId(elements.onlineMatchBlackAiModel.value),
    [WHITE]: normalizeAIModelId(elements.onlineMatchAiModel.value),
  };
}

function reflectOnlineAIModelControls(controllers = null) {
  const gameType = pendingGameType;
  syncAIModelSelectOptions(elements.onlineMatchAiModel, gameType, { online: true });
  syncAIModelSelectOptions(elements.onlineMatchBlackAiModel, gameType, { online: true });
  if (usesGameAiProtocol(gameType)) {
    elements.onlineMatchBlackAiModel.value = defaultAIModelIdForGame(gameType);
    elements.onlineMatchAiModel.value = defaultAIModelIdForGame(gameType);
    return;
  }
  // Controllers of another game (a Gomoku round before a Go one) say
  // nothing about KataGo; keep the current choice then.
  const goModel = (modelId) => isAIModelIdForGame(modelId, GAME_GO) ? modelId : undefined;
  const blackModel = normalizeAIModelId(
    goModel(controllers?.[BLACK]?.modelId) ?? elements.onlineMatchBlackAiModel.value ?? preferredAIModelId,
  );
  const whiteModel = normalizeAIModelId(
    goModel(controllers?.[WHITE]?.modelId) ?? elements.onlineMatchAiModel.value ?? preferredAIModelId,
  );
  elements.onlineMatchBlackAiModel.value = blackModel;
  elements.onlineMatchAiModel.value = whiteModel;
}

function onlineGameRequestPayload(options) {
  const aiModelIds = selectedOnlineAIModelIds();
  const mode = selectedOnlineMatchMode();
  return {
    ...options,
    mode: mode === ONLINE_MODE_GUEST_AI ? ONLINE_MODE_HUMAN_AI : mode,
    ...(mode === ONLINE_MODE_GUEST_AI ? { aiOpponent: "guest" } : {}),
    aiModelId: aiModelIds[WHITE],
    aiModelIds,
  };
}

function nextScoreConfirmationColor() {
  if (!hasOnlineSession()) return null;
  const confirmed = new Set(onlineRoom?.scoreConfirmations ?? []);
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id;
  for (const color of [BLACK, WHITE]) {
    if (confirmed.has(color)) continue;
    if (onlineController(color)?.operatorId === identityId) return color;
  }
  return null;
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
  const aiModelIds = selectedOnlineAIModelIds();
  const selectedModelIds = mode === ONLINE_MODE_AI_AI
    ? [aiModelIds[BLACK], aiModelIds[WHITE]]
    : mode === ONLINE_MODE_GUEST_AI ? [aiModelIds[BLACK]] : [aiModelIds[WHITE]];
  const invites = [ONLINE_MODE_FRIEND, ONLINE_MODE_GUEST_AI].includes(mode);
  if (
    [ONLINE_MODE_HUMAN_AI, ONLINE_MODE_GUEST_AI, ONLINE_MODE_AI_AI].includes(mode) &&
    !usesGameAiProtocol(pendingGameType) &&
    selectedModelIds.some((modelId) => getAIModel(modelId).heavy) &&
    !window.confirm(translateText(
      "b18 首次需要下载约 93.4 MB，并会占用数百 MB 内存与显存、增加耗电和发热。仅建议桌面端 WebGPU。确定使用吗？",
    ))
  ) return false;
  setMessage(invites ? "正在发送对局邀请…" : "正在开始在线对局…");
  const sent = await sendOnlineCommand("request_game", onlineGameRequestPayload(options));
  if (sent && invites) {
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
    modelIds: { ...aiGameModelIds },
    levels: { ...aiGameLevels },
    autoplayPaused: aiAutoplayPaused,
  };
}

function applyLocalNextGameAIState(state) {
  if (!state) return;
  aiActive = state.active;
  aiMatchMode = state.matchMode;
  aiHumanColor = state.humanColor;
  aiGameModelId = state.modelId;
  aiGameModelIds = {
    [BLACK]: normalizeAIModelId(state.modelIds?.[BLACK] ?? state.modelId),
    [WHITE]: normalizeAIModelId(state.modelIds?.[WHITE] ?? state.modelId),
  };
  if (state.levels) {
    aiGameLevels = {
      [BLACK]: normalizeGameAiLevel(state.levels[BLACK]),
      [WHITE]: normalizeGameAiLevel(state.levels[WHITE]),
    };
  }
  aiAutoplayPaused = state.autoplayPaused;
}

function reflectGameOptions(options) {
  setPendingGameType(gameTypeOf(options), { ruleSet: options.ruleSet });
  setPendingDimensions(options.width, options.height);
  setPendingTopology(options.topology);
  if (gameTypeOf(options) === GAME_GO) {
    if (options.scoringRule !== undefined) elements.scoringRule.value = options.scoringRule;
    if (options.komi !== undefined) elements.komi.value = String(options.komi);
  }
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
  const preview = createGameFromOptions(options);
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
  clearChatReference();
  setChatPointPicking(false);
  const options = reflectPreviousGameOptions();
  rematchSetupTransport = hasOnlineSession()
    ? MATCH_TRANSPORT_ONLINE
    : MATCH_TRANSPORT_LOCAL;
  rematchPreviewGame = createGameFromOptions(options);
  if (hasOnlineSession()) {
    elements.onlineMatchMode.value = onlineModeOption(onlineRoom?.match);
    reflectOnlineAIModelControls(onlineRoom?.match?.controllers);
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
    rematchPreviewGame = createGameFromOptions(options);
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
  { moveMark = null } = {},
) {
  const gameType = availableGameType(gameTypeOf(state));
  // Gomoku rows and Renju forbidden points, Othello legal moves and flips.
  let gameMarkers = gameMarkersForState(state, { hints: showsLegalMoveHints(state) });
  // Previews and analysis redraws pass no mark and leave the last one alone.
  const animateFlips = isOneMoveOn(renderedMoveMark, moveMark);
  if (moveMark) renderedMoveMark = moveMark;
  if (gameMarkers?.flipped?.length > 0) {
    gameMarkers = { ...gameMarkers, animateFlips };
    if (animateFlips && !prefersReducedMotion()) {
      flipWaveEndsAt = performance.now() + flipWaveDurationMs(gameMarkers.flipped);
    }
  }
  const viewState = {
    ...state,
    lastMove,
    analysisMove,
    referencePoint,
    analysisCandidates,
    analysisVariation,
    territoryRegions: territoryRegionsForState(state),
    gameMarkers,
    boardStyle: { gameType },
  };
  activeBoardView()?.setPosition(viewState);
}

/** Whether `next` is exactly one move after `previous` in the same context. */
function isOneMoveOn(previous, next) {
  return Boolean(
    previous && next &&
      previous.context === next.context &&
      next.count === previous.count + 1,
  );
}

/**
 * Othello legal-move hints appear only on the live board, and only while
 * this page may play the side to move.
 */
function showsLegalMoveHints(state) {
  return Boolean(
    gameTypeOf(state) === GAME_OTHELLO &&
      state?.phase === PHASE_PLAY &&
      !isReplaying() &&
      !isBoardSetupMode() &&
      canShowMovePreview(),
  );
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
    if (!gameRulesOf(baseState).capabilities.analysis) return null;
    const preview = rulesFor(GAME_GO).fromState(baseState);
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
  if (!game || !activeBoardView()) return;
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
    preview ? null : hintMoveFor(state),
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
    // Replays may be rectangular boards of a different size than the live
    // game, so every coordinate uses the displayed frame's height.
    const height = boardHeight(displayedBoardState());
    const rankLabel = active.manual ? "自选点" : `候选 ${active.rank}`;
    elements.aiVariationTitle.textContent =
      `${rankLabel} · ${formatReviewMove(active.move, height)}`;
    elements.aiVariationLine.textContent = formatReviewVariation(active, { height }) ||
      "当前搜索没有返回更长的变化。";
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

  if (!displayedGameControls(frame).analysis) {
    // Gomoku and Othello have no AI yet; their analysis tab is hidden.
    elements.aiReviewStatus.textContent = "这个棋类暂不支持 AI 分析。";
    elements.aiReviewStatus.classList.remove("error");
    elements.aiReviewCurrent.disabled = true;
    elements.aiReviewAll.hidden = true;
    elements.aiReviewCancel.hidden = true;
    elements.aiReviewResult.hidden = true;
    elements.aiReviewCandidates.replaceChildren();
    elements.aiVariationPreview.hidden = true;
    elements.boardStage.classList.remove("analysis-point-picking");
    renderCurrentAnalysisPosition();
    return;
  }

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

/**
 * The two counters under the turn card: Go captures, Othello disc counts;
 * Gomoku has none (the strip is hidden). Previews of Go show no captures.
 */
function syncGameCountersUI(state, { preview = false } = {}) {
  const controls = displayedGameControls(state);
  if (controls.countLabels) {
    elements.blackCountLabel.textContent = controls.countLabels.black;
    elements.whiteCountLabel.textContent = controls.countLabels.white;
  }
  const values = preview && controls.counts === "captures"
    ? { black: 0, white: 0 }
    : controls.countValues ?? { black: 0, white: 0 };
  elements.blackCaptures.textContent = String(values.black);
  elements.whiteCaptures.textContent = String(values.white);
  return controls;
}

/** "19 × 19 · 361 点 · 竹筒", named by game when several games exist. */
function boardSummaryLabel(state) {
  const label = `${boardDimensionLabel(state)} · ${boardPointCount(state)} 点 · ${topologySurfaceName(state.topology)}`;
  return ENABLE_MULTI_GAME ? `${gameName(gameTypeOf(state))} · ${label}` : label;
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

  renderBoardPosition(frame, move, null, chatReferencePoint, [], [], {
    moveMark: { context: "replay", count: replaySession.index },
  });
  const controls = syncGameCountersUI(frame);
  elements.boardTopology.textContent = boardSummaryLabel(frame);
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
      : controls.scoring
        ? `复盘结束：${formatResult(frame.result)}。最终死子标记与点目结果已还原。`
        : `复盘结束：${formatResult(frame.result)}。`);
  } else if (recordedResultAtEnd) {
    setMessage(`复盘结束：SGF 记录结果 ${recordedResultAtEnd}。普通 SGF 不包含本项目的异形死子判定过程。${replayNote}`);
  } else if (scoringAtEnd) {
    setMessage(`棋谱已播放到点目阶段，最终结果尚未确认。${replayNote}`);
  } else if (replaySession.index === 0) {
    setMessage(`这是复盘起点。${replayNote}`);
  } else if (move?.type === "pass") {
    setMessage(`第 ${replaySession.index} 手：${colorName(move.color)}停一手。${replayNote}`);
  } else if (controls.gameType !== GAME_GO) {
    setMessage(joinSentences(
      gameReplayStepMessage(replaySession.index, move, { gameType: controls.gameType }),
      replayNote,
    ));
  } else {
    const captured = move?.captured?.length
      ? `，提掉 ${move.captured.length} 子`
      : "";
    setMessage(`第 ${replaySession.index} 手：${colorName(move?.color)}落子${captured}。${replayNote}`);
  }
}

function updateUI() {
  syncRulesNotes();
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
  renderBoardPosition(state, renderLastMove, rematchSetup ? null : hintMoveFor(state), chatReferencePoint, [], [], {
    moveMark: rematchSetup ? null : { context: "live", count: moveCount },
  });

  if (rematchSetup) {
    syncGameCountersUI(state, { preview: true });
    elements.boardTopology.textContent = boardSummaryLabel(state);
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
    syncGameCountersUI(state, { preview: true });
    elements.boardTopology.textContent = boardSummaryLabel(state);
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
    syncGameCountersUI(state, { preview: true });
    elements.boardTopology.textContent = boardSummaryLabel(state);
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

  const controls = syncGameCountersUI(state);
  elements.boardTopology.textContent = boardSummaryLabel(state);
  elements.moveNumber.textContent = `第 ${moveCount + 1} 手`;
  elements.turnStone.classList.toggle("black", state.currentPlayer === BLACK);
  elements.turnStone.classList.toggle("white", state.currentPlayer === WHITE);

  const playing = state.phase === PHASE_PLAY && !timeoutOutcome;
  const terminal = Boolean(timeoutOutcome || resignOutcome || state.phase === PHASE_FINISHED);
  elements.passButton.hidden = !playing || !controls.pass;
  syncHintButton(playing);
  elements.newGameButton.hidden = true;
  elements.playControls.hidden = terminal;
  elements.playControls.dataset.live = String(playing);
  elements.playControls.classList.toggle("scoring-actions", !playing);
  elements.scoringPanel.hidden = playing || Boolean(timeoutOutcome) || Boolean(resignOutcome) ||
    !controls.scoring;
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
    // An Othello side without a move is skipped automatically: say so.
    const skippedNote = controls.gameType === GAME_GO ? "" : gameStatusText(state).note;
    elements.phaseLabel.textContent = skippedNote || (state.consecutivePasses
      ? "一方已停着"
      : isAIMode()
        ? isAIvsAI() ? "AI 自对弈" : "AI 对战"
        : isOnlineAIMatch()
          ? "在线 AI 对战"
        : "对局中");
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
        ? isOnlineAISelfPlay() && onlineRoom?.match?.aiAutoplayPaused
          ? `已暂停 · ${colorName(state.currentPlayer)}待行`
          : `${aiEngineName()} ${aiThinking ? "正在思考" : "准备落子"}`
        : `${colorName(state.currentPlayer)}落子`;
    return;
  }

  if (!controls.scoring) {
    // Gomoku and Othello end on the board: no scoring phase to confirm.
    const status = gameStatusText(state);
    elements.turnStone.hidden = true;
    elements.phaseLabel.textContent = status.phase;
    elements.turnText.textContent = status.turn;
    elements.moveNumber.textContent = `${moveCount} 手 · 对局结束`;
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
    const replayFrame = replaySession?.frames?.[replaySession.index];
    if (
      replayFrame &&
      (!sameBoardDimensions(replayFrame, game) || replayFrame.topology !== game.topology)
    ) {
      // Chat coordinates always name a point on the room's own board.
      setChatStatus("当前复盘的棋盘与房间棋盘不同，不能从这里引用棋点。", true);
      return;
    }
    insertPickedChatPoint(row, col);
    return;
  }
  if (isReplaying()) {
    setMessage("复盘不会修改棋局；请退出复盘后再落子。", true);
    return;
  }
  if (hasOnlineSession() && !isOnlinePlayer()) {
    if (activeSidebarTab === "analysis" && gameRulesOf().capabilities.analysis) {
      const analysis = currentAnalysisRecord();
      if (!analysis) {
        liveAnalysis.message = "请先点击“分析当前局面”，再在棋盘上选择想研究的点。";
        liveAnalysis.error = false;
        syncAIReviewUI();
        return;
      }
      try {
        const preview = rulesFor(GAME_GO).fromState(currentAnalysisBaseState());
        const result = preview.play(row, col);
        if (!result.ok) {
          liveAnalysis.message = moveErrorMessage(result, "这个点不能作为分析分支的第一手。");
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
        liveAnalysis.message = `已在本页选择 ${formatReviewMove(
          manual.move,
          boardHeight(displayedBoardState()),
        )}；该分支不会发送到房间。`;
        liveAnalysis.error = false;
        syncAIReviewUI();
      } catch (error) {
        liveAnalysis.message = `无法建立本地分析分支：${localizedErrorMessage(error, "未知错误")}`;
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
    setMessage(moveErrorMessage(result, "现在不能悔棋。"), true);
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
      ? `你将以${colorName(loser)}向 ${currentAIName(oppositeColor(loser))} 认输；AI 立即获胜，此操作不能撤销。`
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
  // During replay the views show the replay frame, whose dimensions can
  // differ from the live game's.
  const displayedGame = displayedBoardState();
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
    // The analysis tab is hidden in games without AI analysis.
    const tabs = elements.sidebarTabs.filter((tab) => !tab.hidden);
    const currentIndex = tabs.indexOf(button);
    let nextIndex = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
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

elements.hintButton.addEventListener("click", () => {
  void requestMoveHint();
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
  const color = nextScoreConfirmationColor();
  void dispatchMatchAction(
    MATCH_ACTION_FINISH_SCORING,
    {
      ...(color ? { color } : {}),
      ...(onlineRoom ? { expectedScoringToken: onlineRoom.scoringToken } : {}),
    },
  );
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
elements.onlineMatchBlackAiModel.addEventListener("change", updateUI);
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

for (const button of elements.gameTypeButtons) {
  button.addEventListener("click", () => selectGameType(button.dataset.gameType));
}
for (const select of elements.gomokuRuleSelects) {
  select.addEventListener("change", () => selectGomokuRuleSet(select.value));
}

for (const button of elements.sizeButtons) {
  button.addEventListener("click", () => {
    const size = Number(button.dataset.boardSize);
    if (!isBoardSetupMode()) return;
    setPendingDimensions(size, size);
    rememberGameTypeChoice();
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
  const validWidth = isOfferedBoardDimension(pendingGameType, width);
  const validHeight = isOfferedBoardDimension(pendingGameType, height);
  elements.customWidth.setAttribute("aria-invalid", String(!validWidth));
  elements.customHeight.setAttribute("aria-invalid", String(!validHeight));
  // Gomoku needs 11 lines, Othello even sides: adjust a nearly valid size to
  // the closest board the game allows and say why.
  const adjustable = (value) => Number.isFinite(value) && value > 0;
  setPendingDimensions(
    validWidth || adjustable(width) ? width : pendingWidth,
    validHeight || adjustable(height) ? height : pendingHeight,
  );
  const note = validWidth && validHeight ? "" : boardLimitNote(pendingGameType);
  elements.boardLimitNote.textContent = note;
  elements.boardLimitNote.hidden = !note;
  elements.customWidth.setAttribute("aria-invalid", "false");
  elements.customHeight.setAttribute("aria-invalid", "false");
  rememberGameTypeChoice();
  resetLobbyPreview();
  setMessage(isNextGameSetup()
    ? `下一局预览已更新为 ${pendingWidth} × ${pendingHeight}；确认后会使用这套设置。`
    : `房间预览已更新为 ${pendingWidth} × ${pendingHeight}；邀请对局时会使用这套设置。`);
}

function scheduleLobbyDimensionPreview() {
  if (!isBoardSetupMode()) return;
  const width = Number(elements.customWidth.value);
  const height = Number(elements.customHeight.value);
  const validWidth = isOfferedBoardDimension(pendingGameType, width);
  const validHeight = isOfferedBoardDimension(pendingGameType, height);
  elements.customWidth.setAttribute("aria-invalid", String(!validWidth));
  elements.customHeight.setAttribute("aria-invalid", String(!validHeight));
  if (!validWidth || !validHeight) return;
  elements.boardLimitNote.hidden = true;
  if (lobbyPreviewFrame !== null) window.cancelAnimationFrame(lobbyPreviewFrame);
  lobbyPreviewFrame = null;
  setPendingDimensions(width, height);
  rememberGameTypeChoice();
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
  const displayed = displayedBoardState();
  const viewOptions = {
    width: boardWidth(displayed), height: boardHeight(displayed),
    onPoint: handleBoardPoint, onHover: handleHover,
  };
  if (flatActive) flatView ??= new FlatBoard(elements.flatScene, { ...viewOptions, topology: displayedTopology() });
  if (arcActive) arcView ??= new ArcBoard(elements.arcScene, viewOptions);
  if (cylinderActive) cylinderView ??= new CylinderBoard(elements.scene, viewOptions);
  if (torusActive) torusView ??= new TorusBoard(elements.torusScene, viewOptions);
  if (mobiusActive) mobiusView ??= new MobiusBoard(elements.mobiusScene, viewOptions);
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
  syncMovePreviewAvailability();
  renderCurrentAnalysisPosition();

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
          secondaryGesture: finePointer ? "弧面循环 · 滚轮缩放" : "弧面循环 · 双指缩放",
        }
      : {
          resetIcon: "◎",
          resetLabel: torus
            ? "回正甜甜圈"
            : mobius
              ? "回正莫比乌斯"
              : "回正视角",
          primaryGesture: finePointer ? "右键拖动旋转" : "单指拖动旋转",
          // Touch screens have no wheel: name the pinch gesture instead.
          secondaryGesture: torus
            ? finePointer ? "观察内圈与背面 · 滚轮缩放" : "观察内圈与背面 · 双指缩放"
            : mobius
              ? finePointer
                ? "观察单面扭转与唯一边界 · 滚轮缩放"
                : "观察单面扭转与唯一边界 · 双指缩放"
              : finePointer ? "滚轮缩放" : "双指缩放",
        };
  // On touch screens a free-drag board takes up/down drags; the toolbar can
  // hand swipes that start vertically to the page instead.
  const freeDrag = needsFreeBoardDrag({
    view: flatActive ? "flat" : arcActive ? "arc" : "3d",
    topology: torus ? "torus" : mobius ? "mobius" : "cylinder",
  });
  elements.togglePageScroll.hidden = finePointer || !freeDrag;
  elements.togglePageScroll.setAttribute("aria-pressed", String(boardSwipeScrollsPage));
  if (!finePointer && freeDrag && boardSwipeScrollsPage) {
    viewCopy.primaryGesture = "横向起手可任意拖动 · 竖滑滚动页面";
  }

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

elements.togglePageScroll.addEventListener("click", () => {
  boardSwipeScrollsPage = !boardSwipeScrollsPage;
  try {
    window.localStorage.setItem(BOARD_SWIPE_SCROLLS_KEY, String(boardSwipeScrollsPage));
  } catch {
    // The choice still applies to this page.
  }
  setBoardSwipeScrollsPage(boardSwipeScrollsPage);
  setViewMode(activeViewMode);
  setMessage(boardSwipeScrollsPage
    ? "竖向滑动会滚动页面；横向起手的拖动仍可转向任意方向。"
    : "棋盘接管所有方向的拖动；可从棋盘外滚动页面。");
});

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

async function createOnlineRoom({ pendingPlayerId = "" } = {}) {
  if (onlineBusy) return;
  const pendingRequest = pendingPlayerId
    ? roomClient.listPendingCreates().find((entry) => entry.playerId === pendingPlayerId)
    : null;
  const name = pendingPlayerId ? pendingRequest?.name ?? "" : normalizedPlayerName();
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
  const request = new AbortController();
  onlineEntryController = request;
  const { signal } = request;
  setOnlineBusy(true, "create");
  try {
    const result = pendingPlayerId
      ? await roomClient.retryPendingCreate(pendingRequest.roomCode, pendingPlayerId, { signal })
      : await roomClient.createRoom({
        name,
        ...getNewGameOptions(),
        // Unlisted rooms are joined by code or invitation link only.
        listed: !elements.roomUnlisted.checked,
        signal,
      });
    if (signal.aborted) return;
    if (matchLifecycle === MATCH_LIFECYCLE_LOBBY) {
      matchLifecycle = MATCH_LIFECYCLE_WAITING;
    }
    resetChatSessionState();
    updateRoomUrl(result.roomCode);
    elements.playerName.value = result.session.playerName;
    rememberPlayerName(result.session.playerName);
    closeOnlineDialog();
    setSidebarTab("settings");
    setMessage(result.recoverable === false
      ? `房间 ${result.roomCode} 已创建，但浏览器未保存房主凭据；请勿刷新，并检查浏览器存储设置。`
      : result.resumedPending
        ? `房间 ${result.roomCode} 已恢复上次建房请求，房主为 ${result.session.playerName}；请核对棋盘设置。`
        : `房间 ${result.roomCode} 已创建，把邀请链接发给朋友吧。`,
      result.recoverable === false);
    // The HTTP result installs the session after the first room snapshot may
    // already have rendered. Refresh once more with the authoritative role so
    // host-only and turn-only controls cannot retain their offline state.
    updateUI();
  } catch (error) {
    if (signal.aborted) return;
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
    const pending = roomClient.pendingCreateCode;
    showOnlineError(pending
      ? `${localizedErrorMessage(error, "创建房间失败，请稍后重试。")} 已保留房间 ${pending} 的建房凭据；可点击“核对并恢复”重试原请求。若要修改设置，请先放弃所选恢复凭据。`
      : localizedErrorMessage(error, "创建房间失败，请稍后重试。"));
  } finally {
    if (onlineEntryController === request) {
      onlineEntryController = null;
      setOnlineBusy(false);
      renderPendingCreatePanel();
    }
  }
}

async function joinOnlineRoom(role = "player", pendingPlayerId = "") {
  if (onlineBusy) return;
  const pendingJoin = pendingPlayerId
    ? roomClient.listPendingJoins(sanitizeRoomCode(elements.roomCodeInput.value))
      .find((entry) => entry.playerId === pendingPlayerId)
    : null;
  const name = pendingJoin?.name || normalizedPlayerName();
  const code = sanitizeRoomCode(elements.roomCodeInput.value);
  const pendingBefore = new Set(roomClient.listPendingJoins(code).map((entry) => entry.playerId));
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
  const request = new AbortController();
  onlineEntryController = request;
  const { signal } = request;
  setOnlineBusy(true, role === "spectator" ? "watch" : "join");
  try {
    const result = await roomClient.joinRoom({
      code, name, role: pendingJoin?.role ?? role, pendingPlayerId, signal,
    });
    if (signal.aborted) return;
    if (matchLifecycle === MATCH_LIFECYCLE_LOBBY) {
      matchLifecycle = MATCH_LIFECYCLE_WAITING;
    }
    resetChatSessionState();
    updateRoomUrl(result.roomCode);
    closeOnlineDialog();
    const identity = result.session ?? roomClient.identity;
    if (identity?.playerName) {
      elements.playerName.value = identity.playerName;
      rememberPlayerName(identity.playerName);
    }
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
    if (signal.aborted) return;
    restoreOfflineGame();
    updateUI();
    maybeStartAITurn();
    const pending = roomClient.listPendingJoins(code);
    const currentPending = pendingPlayerId
      ? pending.some((entry) => entry.playerId === pendingPlayerId)
      : pending.some((entry) => !pendingBefore.has(entry.playerId));
    if (pending.length) elements.roomCodeInput.value = code;
    showOnlineError(currentPending
      ? `${localizedErrorMessage(error, "加入房间失败。")} 已保留本次加入凭据；请使用下方“核对并恢复”重试原身份。`
      : pending.length
        ? `${localizedErrorMessage(error, "加入房间失败。")} 此房间仍有其他可恢复的加入请求，请核对身份后再恢复。`
        : localizedErrorMessage(error, "加入房间失败，请检查房间号。"));
  } finally {
    if (onlineEntryController === request) {
      onlineEntryController = null;
      setOnlineBusy(false);
      renderStoredIdentityPanels();
    }
  }
}

function resumeStoredOnlineRoom() {
  const code = sanitizeRoomCode(elements.roomCodeInput.value);
  const playerId = elements.storedSessionSelect.value;
  if (!code || !playerId) {
    showOnlineError("请先选择要恢复的房间身份。");
    return;
  }
  rememberOfflineGame();
  cancelAIThinking();
  cancelReplayAIReview({ terminate: true });
  aiActive = false;
  try {
    if (!roomClient.resumeRoom(code, playerId)) {
      throw new Error("所选身份的恢复凭据已失效。可使用下方按钮以新身份进入。");
    }
    resetChatSessionState();
    updateRoomUrl(code);
    if (roomClient.identity?.playerName) {
      elements.playerName.value = roomClient.identity.playerName;
      rememberPlayerName(roomClient.identity.playerName);
    }
    closeOnlineDialog();
    setMessage(`正在以 ${roomClient.identity?.playerName || "所选身份"} 的身份恢复房间 ${code}…`);
    updateUI();
  } catch (error) {
    restoreOfflineGame();
    updateUI();
    showOnlineError(localizedErrorMessage(error, "恢复房间身份失败。"));
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
  onlineAIPauseIntent = null;
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
    const forgotten = roomClient.abandonRoom();
    returnToOffline(forgotten
      ? "已停止重连并忘记这个房间。"
      : "已停止重连，但本地房间凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。");
    return;
  }
  // The room scores a seated player's departure from a friend game that is
  // under way as a resignation; say so before the player confirms.
  const leavingForfeitsGame = isOnlinePlayer() &&
    onlineRoom?.match?.mode === ONLINE_MODE_FRIEND &&
    onlineMatchStatus() === ONLINE_MATCH_PLAYING &&
    onlineRoom.moveCount > 0 &&
    onlineRoom.game?.phase !== PHASE_FINISHED;
  const confirmed = window.confirm(leavingForfeitsGame
    ? translateText("对局正在进行，退出房间会判你认输并释放座位。确定退出吗？")
    : translateText("退出房间会释放你的座位，确定退出吗？"));
  if (!confirmed) return;
  setOnlineBusy(true);
  try {
    await roomClient.leave();
    setOnlineBusy(false);
    returnToOffline(roomClient.lastCredentialCleanupFailed
      ? "已退出联机房间，但本地凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。"
      : "已退出联机房间，回到之前的单机棋盘。");
  } catch (error) {
    setOnlineBusy(false);
    setMessage(
      localizedErrorMessage(error, "没有收到服务器的退出确认，座位仍然保留，请重试。"),
      true,
    );
    updateRoomUI();
  }
}

for (const button of elements.openInviteButtons) {
  button.addEventListener("click", showInviteDialog);
}
elements.joinInvitation.addEventListener("click", () => {
  rememberLobbyBoardSettings();
  navigateAppPath("/lobby");
});
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
  // Create the room from this page: the configured board, rules, komi and
  // clock live here in memory and a navigation would reset them.
  showOnlineDialog("", { intent: "create" });
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
elements.toggleOnlineAiAutoplay.addEventListener("click", toggleAIAutoplay);
elements.aiForm.addEventListener("submit", (event) => void startAIGame(event));
elements.aiModel.addEventListener("change", syncAIDialogModelPresentation);
elements.aiBlackModel.addEventListener("change", syncAIDialogModelPresentation);
elements.aiLevel.addEventListener("change", syncAIDialogModelPresentation);
elements.aiBlackLevel.addEventListener("change", syncAIDialogModelPresentation);
for (const select of [elements.onlineMatchAiLevel, elements.onlineMatchBlackAiLevel]) {
  select.addEventListener("change", () => {
    rememberGameAILevel(select.value);
    updateUI();
  });
}
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
elements.cancelOnline.addEventListener("click", cancelOnlineDialog);
elements.onlineDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelOnlineDialog();
});
elements.onlineModifySettings.addEventListener("click", () => {
  cancelOnlineDialog();
  setSidebarTab("settings", { focus: true });
  setMessage("先在“棋盘设置”中调整棋盘；创建房间时会使用这里的同一套设置。");
});
elements.onlineForm.addEventListener("submit", (event) => event.preventDefault());
elements.createRoom.addEventListener("click", () => void createOnlineRoom());
elements.resumeStoredSession.addEventListener("click", resumeStoredOnlineRoom);
elements.retryPendingJoin.addEventListener("click", () => {
  const code = sanitizeRoomCode(elements.roomCodeInput.value);
  const pending = roomClient.listPendingJoins(code)
    .find((entry) => entry.playerId === elements.pendingJoinSelect.value);
  if (!pending) {
    showOnlineError("所选加入请求已失效，请重新选择。");
    return;
  }
  void joinOnlineRoom(pending.role, pending.playerId);
});
elements.retryPendingCreate.addEventListener("click", () => {
  void createOnlineRoom({ pendingPlayerId: elements.pendingCreateSelect.value });
});
elements.abandonPendingCreate.addEventListener("click", () => {
  const selected = roomClient.listPendingCreates()
    .find((entry) => entry.playerId === elements.pendingCreateSelect.value);
  if (!selected) return;
  if (!roomClient.abandonPendingCreate(selected.roomCode, selected.playerId)) {
    showOnlineError("无法删除所选恢复凭据；请检查浏览器存储设置后重试。");
    return;
  }
  renderPendingCreatePanel();
  showOnlineError(`已放弃房间 ${selected.roomCode} 的恢复凭据；若房间已创建，将无法用原房主身份恢复。现在可按当前设置创建新房间。`);
});
elements.joinRoom.addEventListener("click", () => void joinOnlineRoom());
elements.watchRoom.addEventListener("click", () => void joinOnlineRoom("spectator"));
elements.lobbyCreateRoom.addEventListener("click", () => {
  showOnlineDialog("", { intent: "create" });
});
elements.lobbyJoinRoom.addEventListener("click", () => {
  showOnlineDialog("", { intent: "join" });
});
elements.lobbyRefresh.addEventListener("click", () => void refreshLobby({ announce: true }));
document.addEventListener("visibilitychange", resumeLobbyPolling);
wireLobbyFilters();
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
wireRoomManagement();
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
wireChatChannels();
elements.toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  gameSounds.setEnabled(soundEnabled);
  rememberSoundEnabled();
  syncSoundControl();
  if (soundEnabled) void gameSounds.unlock();
});
elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = sanitizeRoomCode(elements.roomCodeInput.value);
  renderStoredIdentityPanels();
  showOnlineError();
});
elements.onlineForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || onlineBusy) return;
  if (event.target.closest?.("button, select")) return;
  event.preventDefault();
  if (elements.onlineRoomCodeField.hidden) {
    void createOnlineRoom();
  } else if (sanitizeRoomCode(elements.roomCodeInput.value).length === 6 &&
      !elements.joinRoom.hidden) {
    void joinOnlineRoom();
  } else if (sanitizeRoomCode(elements.roomCodeInput.value).length === 6 &&
      !elements.watchRoom.hidden) {
    void joinOnlineRoom("spectator");
  } else if (!elements.createRoom.hidden) {
    void createOnlineRoom();
  } else {
    showOnlineError("请输入六位房间号。");
    elements.roomCodeInput.focus();
  }
});

roomClient.on("connection", (event) => {
  // A retained `onlineRoom` is only a visual fallback during reconnect. Do not
  // unlock actions until a welcome/state message for this socket arrives.
  onlineStateSynchronized = false;
  if (event.terminal && [4401, 4404].includes(event.code) && !hasOnlineSession()) {
    const reason = event.code === 4404
      ? "房间已因长时间无活动而关闭。"
      : "房间身份已经失效，请重新加入。";
    returnToOffline(roomClient.lastCredentialCleanupFailed
      ? `${reason}本地凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。`
      : reason);
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
  // Server errors arrive in Chinese; show them by code in other languages.
  const message = localizedErrorMessage(error);
  if (elements.onlineDialog.open) showOnlineError(message);
  if (!["SOCKET_ERROR", "COMMAND_SEND_ERROR"].includes(error.code)) {
    setMessage(message, true);
  }
  updateRoomUI();
});

initializeSidebarPanels();
syncTimeControlFields();
void loadVersionLabel();
setPendingDimensions(19, 19);
setPendingTopology(TOPOLOGY_CYLINDER);
elements.aiModel.value = preferredAIModelId;
elements.aiBlackModel.value = preferredAIModelId;
elements.aiMatchMode.value = aiMatchMode;
elements.onlineMatchBlackAiModel.value = preferredAIModelId;
elements.onlineMatchAiModel.value = preferredAIModelId;
{
  const level = savedGameAILevel();
  aiGameLevels = { [BLACK]: level, [WHITE]: level };
  for (const select of [
    elements.aiLevel,
    elements.aiBlackLevel,
    elements.onlineMatchAiLevel,
    elements.onlineMatchBlackAiLevel,
  ]) {
    select.value = level;
  }
}
syncAIDialogModelPresentation();
syncAIMatchModePresentation();
const savedGameChoice = savedGameTypeChoice();
if (savedGameChoice) {
  // Each game reopens on the board size this browser last used for it.
  restoreSizesByGame(savedGameChoice.sizesByGame);
  setPendingGameType(savedGameChoice.gameType, { ruleSet: savedGameChoice.ruleSet });
  const limits = BOARD_LIMITS[pendingGameType];
  const remembered = pendingDimensionsByGame.get(pendingGameType);
  setPendingDimensions(
    remembered?.width ?? limits.defaultWidth,
    remembered?.height ?? limits.defaultHeight,
  );
} else {
  syncGameTypeControls();
}
// The opening board: 19 × 19 Go on a cylinder (komi 7.5, Chinese rules), or
// the default board of the game this browser chose last.
game = createGameFromOptions(getNewGameOptions());
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

if (initialRoute.mode === "lobby") restoreLobbyBoardSettings();
showAppScreen(initialRoute.mode);
if (initialRoute.mode === "online" && initialRoute.roomCode.length === 6) {
  const sharedRoomCode = initialRoute.roomCode;
  replaceAppPath(onlineRoomPath(sharedRoomCode, initialRoute.role));
  elements.roomCodeInput.value = sharedRoomCode;
  if (roomClient.resumeRoom(sharedRoomCode)) {
    updateRoomUrl(sharedRoomCode);
    setMessage(`正在恢复房间 ${sharedRoomCode}…`);
    updateRoomUI();
  } else if (roomClient.pendingCreateCode === sharedRoomCode) {
    // Resume through the dialog's create flow so the request carries an abort
    // signal: cancelling must stop this page adopting a late result.
    const candidates = roomClient.listPendingCreates()
      .filter((entry) => entry.roomCode === sharedRoomCode);
    showOnlineDialog("", { intent: "create" });
    setMessage(`正在恢复房间 ${sharedRoomCode}…`);
    if (candidates.length === 1) {
      void createOnlineRoom({ pendingPlayerId: candidates[0].playerId });
    }
  } else {
    showOnlineDialog(sharedRoomCode, { intent: initialRoute.role });
    if (roomClient.hasStoredSession(sharedRoomCode)) {
      setMessage("此浏览器保存了该房间的身份；请选择要恢复的身份，或以新身份进入。");
    } else if (initialRoute.role === "spectator") {
      setMessage("这是观战入口；填写名字后请选择“进入观战”。");
    } else {
      setMessage("这是大厅的玩家入口；填写名字后申请空余的对手席位。");
    }
  }
}
if (initialRoute.mode !== "online" && roomClient.listPendingCreates().length > 0) {
  setMessage("有待确认的建房请求；打开创建房间对话框可核对并恢复。");
}

const unlockGameSounds = () => void gameSounds.unlock();
window.addEventListener("pointerdown", unlockGameSounds, { capture: true, once: true });
window.addEventListener("keydown", unlockGameSounds, { capture: true, once: true });

window.addEventListener(
  "beforeunload",
  () => {
    cancelAIThinking({ terminate: true });
    cancelReplayAIReview({ terminate: true });
    cancelLobbyRequest();
    if (clockTimer !== null) window.clearInterval(clockTimer);
    cylinderView?.destroy();
    torusView?.destroy();
    mobiusView?.destroy();
    flatView?.destroy();
    arcView?.destroy();
    roomClient.destroy();
    unsubscribeLocale();
    void gameSounds.destroy();
  },
  { once: true },
);

// Page state and helpers the src/app modules read (live bindings).
export {
  CHAT_EMOJIS,
  LOBBY_POLL_INTERVAL_MS,
  LOBBY_RATE_LIMIT_BACKOFF_MS,
  ONLINE_MATCH_PLAYING,
  activeBoardView,
  aiControlsColor,
  appRouteMode,
  appendLobbyMetadata,
  boardHeight,
  boardWidth,
  cloneSerializable,
  colorName,
  currentAIName,
  currentIdentity,
  currentTimeoutOutcome,
  elements,
  enterReplay,
  exitReplay,
  game,
  gameRulesOf,
  hasOnlineSession,
  isAIMode,
  isNextGameSetup,
  isOnlineHost,
  isOnlinePlayer,
  isReplaying,
  liveDisplayedGame,
  maybeStartAITurn,
  onlineBusy,
  onlineClockReceivedAt,
  onlineCommandPending,
  onlineController,
  onlineMatchStatus,
  onlineRoom,
  onlineStateSynchronized,
  pendingTopology,
  replayEventCount,
  replaySession,
  replaySource,
  roomClient,
  roomSeat,
  sendOnlineCommand,
  setMessage,
  syncReferenceFocusRotationState,
  topologyName,
  topologySurfaceName,
  updateUI,
};

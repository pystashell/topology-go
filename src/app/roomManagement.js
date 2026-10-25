/**
 * Room tools in the room panel: the host lists the room in the lobby or
 * not and removes members, and a player claims a game whose opponent has
 * been offline for two minutes.
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js).
 */

import {
  BLACK,
  PHASE_FINISHED,
  PHASE_SCORING,
  WHITE,
  oppositeColor,
} from "../game/goEngine.js";
import {
  applyDocumentTranslations,
  translateText,
} from "../i18n.js";
import {
  ONLINE_MATCH_PLAYING,
  colorName,
  currentIdentity,
  currentTimeoutOutcome,
  elements,
  game,
  hasOnlineSession,
  isOnlineHost,
  isReplaying,
  onlineBusy,
  onlineClockReceivedAt,
  onlineCommandPending,
  onlineController,
  onlineMatchStatus,
  onlineRoom,
  onlineStateSynchronized,
  roomClient,
  sendOnlineCommand,
  setMessage,
} from "../main.js";

// The room's ABANDONMENT_GRACE_MS: how long the other side of a round must
// be offline before a player may claim the game.
const ONLINE_ABANDONMENT_GRACE_MS = 2 * 60 * 1_000;

// Opponent operator id -> when this page first saw them offline.
const opponentOfflineSince = new Map();

// The member list last drawn, so a re-render never replaces a button mid-click.
let roomMemberListKey = "";

/**
 * The absent side of a round this page plays one colour of: the other
 * colour's operator is offline (or gone). Null otherwise.
 */
function abandonmentClaim(now = Date.now()) {
  if (!hasOnlineSession() || !roomClient.isConnected || !onlineStateSynchronized ||
      onlineMatchStatus() !== ONLINE_MATCH_PLAYING || game?.phase === PHASE_FINISHED ||
      currentTimeoutOutcome() || isReplaying()) {
    return null;
  }
  const identity = currentIdentity();
  const identityId = identity.playerId ?? identity.id;
  const mine = [BLACK, WHITE].filter((color) => onlineController(color)?.operatorId === identityId);
  if (!identityId || mine.length !== 1) return null;
  const color = oppositeColor(mine[0]);
  const operatorId = onlineController(color)?.operatorId ?? null;
  const operator = onlineRoom?.players?.find((player) => player.id === operatorId);
  if (operator?.online) {
    opponentOfflineSince.delete(operatorId);
    return null;
  }
  // Someone who left can be claimed at once; an offline player after the grace.
  if (operator && !opponentOfflineSince.has(operatorId)) opponentOfflineSince.set(operatorId, now);
  return { color, since: operator ? opponentOfflineSince.get(operatorId) : 0 };
}

function formatCountdown(ms) {
  const seconds = Math.ceil(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function syncAbandonmentPanel(now = Date.now()) {
  const claim = abandonmentClaim(now);
  elements.abandonmentPanel.hidden = !claim;
  if (!claim) return;
  const remaining = Math.max(0, ONLINE_ABANDONMENT_GRACE_MS - (now - claim.since));
  const title = `${colorName(claim.color)}已离线`;
  if (elements.abandonmentTitle.textContent !== title) elements.abandonmentTitle.textContent = title;
  const note = remaining > 0
    ? `离线满 2 分钟后可以判对方弃局，还需 ${formatCountdown(remaining)}；对方回来后照常继续。`
    : "对方离线已满 2 分钟；可以判对方弃局，本局按对方认输结束。";
  if (elements.abandonmentNote.textContent !== note) elements.abandonmentNote.textContent = note;
  elements.claimAbandonment.disabled = remaining > 0 || onlineCommandPending || onlineBusy;
}

/** Host tools: list the room in the lobby or not, and remove members. */
function syncRoomManagement(controlsAvailable) {
  const active = hasOnlineSession() && Boolean(onlineRoom);
  const listed = onlineRoom?.listed !== false;
  elements.roomUnlistedBadge.hidden = !active || listed;
  elements.roomManagePanel.hidden = !active || !isOnlineHost();
  if (elements.roomManagePanel.hidden) return;
  elements.roomListed.checked = listed;
  elements.roomListed.disabled = !controlsAvailable;
  // Mid-game the White player stays: removing them would decide the game.
  const seatsLocked = onlineMatchStatus() === ONLINE_MATCH_PLAYING &&
    (onlineRoom.moveCount ?? 0) > 0 && game?.phase !== PHASE_FINISHED && !currentTimeoutOutcome();
  const members = [
    ...(onlineRoom.players ?? []).filter((player) =>
      player.color === WHITE && player.role === "player" && player.automated !== true),
    ...(onlineRoom.spectators ?? []),
  ].map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role === "player" ? "白方" : "观战",
    online: Boolean(member.online),
    locked: member.role === "player" && seatsLocked,
  }));
  const key = JSON.stringify({ members, controlsAvailable });
  elements.roomMemberList.hidden = members.length === 0;
  if (key === roomMemberListKey) return;
  roomMemberListKey = key;
  elements.roomMemberList.replaceChildren(...members.map((member) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.dataset.i18nIgnore = "";
    name.textContent = member.name;
    const detail = document.createElement("small");
    detail.textContent = `${member.role} · ${member.online ? "在线" : "离线"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.dataset.removeMember = member.id;
    remove.textContent = "移出";
    remove.disabled = !controlsAvailable || member.locked;
    if (member.locked) remove.title = "本局结束后才能移出对手";
    item.append(name, detail, remove);
    return item;
  }));
  applyDocumentTranslations(elements.roomMemberList);
}

/**
 * The room ends a Go count nobody confirms (see SCORING_CONFIRM_TIMEOUT_MS
 * in roomEngine.js); show how long the current marks have left. The room
 * sends the time left, counted here from when that snapshot arrived.
 */
function syncScoringCountdown(now = Date.now()) {
  const left = onlineRoom?.scoringDeadlineInMs;
  const shown = hasOnlineSession() && game?.phase === PHASE_SCORING &&
    Number.isFinite(left) && !isReplaying();
  elements.scoringCountdown.hidden = !shown;
  if (!shown) return;
  const remaining = Math.max(0, left - (now - onlineClockReceivedAt));
  const text = remaining > 0
    ? `${formatCountdown(remaining)} 后按当前死子标记自动确认；修改标记会重新计时，点目最长 10 分钟。`
    : "点目时间已到，正在按当前死子标记自动确认…";
  if (elements.scoringCountdown.textContent !== text) elements.scoringCountdown.textContent = text;
}

/** The host's listing switch and member list, and the abandonment claim. */
function wireRoomManagement() {
  elements.roomListed.addEventListener("change", async () => {
    const listed = elements.roomListed.checked;
    if (await sendOnlineCommand("set_listed", { listed })) {
      setMessage(listed
        ? "房间已在大厅公开。"
        : "房间已不在大厅公开；只有拿到房间号或邀请链接的人能进入。", false);
    } else {
      elements.roomListed.checked = !listed;
    }
  });
  elements.roomMemberList.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-remove-member]");
    if (!button || button.disabled) return;
    if (!window.confirm(translateText("确定把这位成员移出房间吗？对方需要重新加入才能回来。"))) return;
    if (await sendOnlineCommand("remove_member", { playerId: button.dataset.removeMember })) {
      setMessage("已把这位成员移出房间。", false);
    }
  });
  elements.claimAbandonment.addEventListener("click", async () => {
    if (!window.confirm(translateText("判对方弃局后，本局按对方认输结束。确定吗？"))) return;
    const claim = abandonmentClaim();
    const sent = await sendOnlineCommand("claim_abandonment", {}, {
      onError: (error) => {
        // The room restarted and counts the grace from then: count again here.
        if (error?.code === "ABANDONMENT_TOO_EARLY" && claim) {
          const operatorId = onlineController(claim.color)?.operatorId;
          if (operatorId) opponentOfflineSince.set(operatorId, Date.now());
        }
      },
    });
    if (sent) setMessage("已判对方弃局，本局结束。", false);
  });
}

export {
  syncAbandonmentPanel,
  syncRoomManagement,
  syncScoringCountdown,
  wireRoomManagement,
};

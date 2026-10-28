// Room and lobby errors carry a stable `code` next to a Chinese message
// written by the server. The client cannot rely on a dictionary entry for
// every server sentence (they change with the server), so each code maps to
// a Chinese source sentence that the English dictionary below translates.
// Unknown codes fall back to a generic sentence instead of raw Chinese.

export const GENERIC_SERVER_ERROR = "房间拒绝了这个操作。";
const GENERIC_RATE_LIMIT = "RATE_LIMITED";

/** Chinese source copy for every error code the room, lobby or worker emits. */
export const SERVER_ERROR_COPY = Object.freeze({
  // HTTP entry points and rate limits (worker/index.js)
  BAD_REQUEST: "请求无效，请刷新页面后重试。",
  FORBIDDEN: "你没有权限执行这个操作。",
  UNAUTHORIZED: "房间身份已经失效，请重新加入。",
  CONFLICT: "房间已经存在。",
  RATE_LIMITED: "请求过于频繁，请稍后再试。",
  ROOM_CODE_TAKEN: "房间码已被使用，请重试建房。",
  CREATE_COMMIT_UNCERTAIN: "建房结果尚未确认；请使用“核对并恢复”重试。",
  JOIN_COMMIT_UNCERTAIN: "加入结果尚未确认；请使用“核对并恢复”重试。",
  JOIN_NOT_COMMITTED: "加入结果尚未确认。",
  PROTOCOL_UPGRADE_REQUIRED: "客户端与房间服务版本不兼容，请刷新页面。",
  INTERNAL_ERROR: "房间服务出现内部错误，请稍后重试。",
  // Game records and sign-in (worker/records.js, worker/auth.js)
  BAD_RECORD: "这盘棋谱无法保存。",
  RECORD_TOO_LARGE: "棋谱过长，无法保存。",
  RECORDS_UNAVAILABLE: "棋谱服务暂时不可用，请稍后再试。",
  RECORD_NOT_FOUND: "没有找到这盘棋谱。",
  RECORD_FORBIDDEN: "这盘棋只有对局双方能看。",
  AUTH_UNAVAILABLE: "账号服务暂时不可用。",
  NOT_FOUND: "没有这个地址。",
  // Accounts (worker/accounts.js)
  BAD_USERNAME: "用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。",
  BAD_PASSWORD: "密码要 8 到 128 个字符。",
  BAD_EMAIL: "邮箱格式不正确；不想填可以空着。",
  USERNAME_TAKEN: "这个用户名已经有人用了，换一个吧。",
  EMAIL_TAKEN: "这个邮箱已经注册过了，可以直接用它登录。",
  WRONG_LOGIN: "用户名（或邮箱）或密码不对。",
  GOOGLE_UNAVAILABLE: "暂时不能用 Google 登录。",
  // Codes by email (worker/email.js, worker/accounts.js)
  EMAIL_CODES_UNAVAILABLE: "暂时不能用邮箱验证码。",
  WRONG_CODE: "验证码不对，或者已经用过了。",
  CODE_EXPIRED: "验证码已经过期，请重新获取。",
  TOO_MANY_TRIES: "验证码试错太多次，请重新获取。",
  NOT_SIGNED_IN: "请先登录账号。",
  NEED_CURRENT_PASSWORD: "请输入当前密码（刚登录的 10 分钟内可以不填）。",
  WRONG_PASSWORD: "当前密码不对。",
  EMAIL_ALREADY_VERIFIED: "这个邮箱已经验证过了。",
  EMAIL_COOLDOWN: "请等一分钟再获取验证码。",
  EMAIL_ADDRESS_LIMIT: "这个邮箱这一小时收到的验证码太多了，请稍后再试。",
  EMAIL_DAILY_LIMIT: "今天的验证码已经发完了，请明天再试，或者用密码、Google 登录。",
  EMAIL_SEND_FAILED: "邮件暂时发不出去，请稍后再试。",
  GOOGLE_NOT_LINKED: "没有找到这个 Google 账号。",
  LAST_SIGN_IN_METHOD: "这是你现在唯一的登录方式。先设置密码或绑定邮箱，再解绑它。",
  // Room durable object (worker/BadukRoom.js)
  ROOM_NOT_FOUND: "没有找到这个房间。",
  ROOM_EXPIRED: "房间已经关闭。",
  ROOM_COMMIT_FAILED: "房间暂时无法保存，请稍后重试。",
  ROOM_RESTORE_FAILED: "房间暂时无法恢复或保存，请稍后重新连接。",
  SESSION_REPLACED: "这个席位已在另一个窗口打开，本页已停止重连。",
  UNSUPPORTED_MESSAGE: "房间无法识别这条消息，请刷新页面。",
  INVALID_JSON: "房间无法识别这条消息，请刷新页面。",
  INVALID_COMMAND: "房间无法识别这个操作，请刷新页面。",
  MESSAGE_TOO_LARGE: "这条消息太大，房间无法处理。",
  COMMAND_REJECTED: GENERIC_SERVER_ERROR,
  // Room engine (src/multiplayer/roomEngine.js)
  ALREADY_PLAYING_HERE: "你是这盘棋的对局者，不能再以旁观者或新身份进入；请直接返回你的席位。",
  ALREADY_WATCHING_HERE: "你已经在这个房间里观战，请直接返回房间；有空位时可以在房间里申请对手席位。",
  BAD_ROOM_STATE: "房间数据暂时无法读取，请稍后重新连接。",
  STALE_COMMAND: "这个操作已经过期，请按最新棋局重试。",
  STALE_GAME_STATE: "棋局已经更新，请按最新局面重试。",
  STALE_SCORING: "点目结果已经变化，请核对最新结果后重新确认。",
  STALE_UNDO_REQUEST: "悔棋申请已经变化，请按最新状态操作。",
  STALE_GAME_REQUEST: "对局邀请已经变化，请按最新邀请操作。",
  GAME_FINISHED: "本局已经结束。",
  GAME_IN_PROGRESS: "当前对局尚未结束，不能发起新棋。",
  GAME_NOT_STARTED: "棋局尚未开始。",
  GAME_TIMED_OUT: "本局已超时结束。",
  GAME_INVITATION_PENDING: "当前邀请仍在等待回应；请先取消邀请再修改。",
  ILLEGAL_MOVE: "这一手不能下。",
  NOT_YOUR_TURN: "还没有轮到你。",
  NOT_AI_TURN: "现在不是在线 AI 行棋。",
  AI_NOT_ATTACHED: "房间里没有在线 AI。",
  AI_PAUSED: "在线 AI 自对弈已暂停。",
  AI_SEAT_UNAVAILABLE: "当前白方座位不能接入 AI。",
  AI_UNDO_IS_DIRECT: "与 AI 对局时悔棋直接生效，不需要申请。",
  ALREADY_SEATED: "你已经占用了一个席位。",
  SEAT_UNAVAILABLE: "这个席位已经有人使用。",
  OPPONENT_SEAT_OCCUPIED: "白方席位已经有人使用。",
  OPPONENT_REQUIRED: "请先让对手进入房间并成为白方。",
  WAITING_FOR_OPPONENT: "请等待对手加入。",
  SPECTATOR_FULL: "观战人数已满。",
  SPECTATOR_RATE_LIMITED: "观战请求过于频繁，请稍后再试。",
  MEMBER_NOT_FOUND: "这位成员已经不在房间里。",
  OPPONENT_CONNECTED: "对方仍在线，不能判弃局。",
  ABANDONMENT_TOO_EARLY: "对方离线还不到 2 分钟，请稍后再判弃局。",
  REMOVED_FROM_ROOM: "你已被房主移出房间。",
  CHAT_RATE_LIMITED: "发言太快了，请稍等一下再发送。",
  COMMAND_RATE_LIMITED: "操作太频繁了，请稍等一下再试。",
  SCORING_TOGGLE_LIMIT: "本次点目的死子标记次数已达上限，请确认结果或继续对局。",
  UNDO_PENDING: "悔棋申请正在等待回应。",
  UNDO_UNAVAILABLE: "现在不能悔棋。",
  UNSUPPORTED_FOR_GAME: "这个棋类不支持这个操作。",
  // Chat validation shared by client and room (src/multiplayer/chat.js)
  EMPTY_CHAT: "请输入聊天内容。",
  INVALID_CHAT: "聊天内容格式不正确。",
  CHAT_TOO_LONG: "聊天内容太长，请缩短后再发送。",
  CHAT_TOO_MANY_LINES: "聊天内容行数太多，请合并后再发送。",
  CHAT_TOO_LARGE: "这条消息包含的字符过大，请缩短后再发送。",
  UNKNOWN_STICKER: "这个表情包不存在。",
  // Lobby reads (src/multiplayer/lobbyClient.js)
  LOBBY_REJECTED: "在线大厅暂时不可用。",
  LOBBY_UNREACHABLE: "暂时无法连接在线大厅。",
  // Client transport failures (src/multiplayer/roomClient.js)
  NETWORK_ERROR: "无法连接联机服务。",
  HTTP_ERROR: "联机服务暂时不可用，请稍后重试。",
  SYNC_TIMEOUT: "房间同步超时，正在重新连接。",
  ACK_TIMEOUT: "等待服务器确认超时。",
  // Gomoku and Othello AI workers (src/ai/gameAiClient.js)
  AI_SEARCH_CANCELLED: "AI 思考已取消。",
  AI_TIMEOUT: "AI 思考超时，已重新启动 AI。",
  AI_WORKER_FAILED: "AI 思考线程没有正常启动。",
  AI_UNSUPPORTED: "当前浏览器不支持后台 AI 计算。",
  AI_ENGINE_ERROR: "AI 思考时发生错误。",
  AI_ILLEGAL_MOVE: "AI 返回了不合规则的落点。",
  AI_NO_LEGAL_MOVE: "AI 找不到可以下的点。",
  AI_BAD_POSITION: "AI 无法读取当前棋局。",
});

/** English for the copy above that is not already in the main dictionary. */
export const ENGLISH_SERVER_ERRORS = Object.freeze({
  "你是这盘棋的对局者，不能再以旁观者或新身份进入；请直接返回你的席位。":
    "You are playing in this game, so you cannot also enter as a spectator or a new identity. Return to your seat instead.",
  "你是这盘棋的对局者，不能再以旁观者身份进入；请直接返回你的席位。":
    "You are playing in this game, so you cannot also enter as a spectator. Return to your seat instead.",
  "你已经在这个房间里观战，请直接返回房间；有空位时可以在房间里申请对手席位。":
    "You are already watching this room. Return to it; when a seat is free you can ask for it from inside the room.",
  "你是这盘棋的对局者，已回到你的席位。": "You are playing in this game; you are back in your seat.",
  "这盘棋谱无法保存。": "This game record could not be saved.",
  "棋谱过长，无法保存。": "This game record is too long to save.",
  "棋谱服务暂时不可用，请稍后再试。": "Game records are unavailable right now. Try again shortly.",
  "没有找到这盘棋谱。": "That game record was not found.",
  "这盘棋只有对局双方能看。": "Only the two players can see this game.",
  "账号服务暂时不可用。": "Accounts are unavailable right now.",
  "没有这个地址。": "There is nothing at this address.",
  "用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。":
    "A username has 2 to 20 characters: Chinese, English letters, digits or underscores.",
  "密码要 8 到 128 个字符。": "A password has 8 to 128 characters.",
  "邮箱格式不正确；不想填可以空着。": "That email address does not look right; you can leave it empty.",
  "这个用户名已经有人用了，换一个吧。": "That username is taken. Try another one.",
  "这个邮箱已经注册过了，可以直接用它登录。": "That email is already registered; you can sign in with it.",
  "用户名（或邮箱）或密码不对。": "The username (or email) or the password is wrong.",
  "暂时不能用 Google 登录。": "Google sign-in is not available right now.",
  "暂时不能用邮箱验证码。": "Email codes are not available right now.",
  "验证码不对，或者已经用过了。": "That code is wrong or has been used.",
  "验证码已经过期，请重新获取。": "That code has expired; ask for a new one.",
  "验证码试错太多次，请重新获取。": "Too many wrong tries; ask for a new code.",
  "请先登录账号。": "Sign in to your account first.",
  "请输入当前密码（刚登录的 10 分钟内可以不填）。": "Enter your current password (not needed within 10 minutes of signing in).",
  "当前密码不对。": "The current password is wrong.",
  "这个邮箱已经验证过了。": "That email is already confirmed.",
  "请等一分钟再获取验证码。": "Wait a minute before asking for another code.",
  "这个邮箱这一小时收到的验证码太多了，请稍后再试。": "That address got too many codes this hour; try again later.",
  "今天的验证码已经发完了，请明天再试，或者用密码、Google 登录。": "Today's codes have run out. Try again tomorrow, or sign in with a password or Google.",
  "邮件暂时发不出去，请稍后再试。": "Email cannot be sent right now; try again later.",
  "没有找到这个 Google 账号。": "That Google account was not found.",
  "这是你现在唯一的登录方式。先设置密码或绑定邮箱，再解绑它。":
    "This is your only way to sign in. Set a password or add an email before unbinding it.",
  "没有这封邮件。": "No such email.",
  "请求无效，请刷新页面后重试。": "The request was invalid. Refresh the page and try again.",
  "你没有权限执行这个操作。": "You are not allowed to do that.",
  "房间已经存在。": "That room already exists.",
  "请求过于频繁，请稍后再试。": "Too many requests. Wait a minute and try again.",
  "房间码已被使用，请重试建房。": "That room code is already taken. Try creating the room again.",
  "建房结果尚未确认；请使用“核对并恢复”重试。":
    "The room creation is not confirmed yet. Use Check and recover to retry it.",
  "加入结果尚未确认；请使用“核对并恢复”重试。":
    "The join is not confirmed yet. Use Check and recover to retry it.",
  "加入结果尚未确认。": "The join is not confirmed yet.",
  "房间服务出现内部错误，请稍后重试。": "The room service hit an internal error. Try again shortly.",
  "没有找到这个房间。": "That room was not found.",
  "房间暂时无法保存，请稍后重试。": "The room could not be saved right now. Try again shortly.",
  "房间无法识别这条消息，请刷新页面。": "The room could not read that message. Refresh the page.",
  "房间无法识别这个操作，请刷新页面。": "The room could not read that action. Refresh the page.",
  "这条消息太大，房间无法处理。": "That message is too large for the room.",
  "房间数据暂时无法读取，请稍后重新连接。": "The room data cannot be read right now. Reconnect shortly.",
  "这个操作已经过期，请按最新棋局重试。": "That action is out of date. Try again on the latest position.",
  "棋局已经更新，请按最新局面重试。": "The game has changed. Try again on the latest position.",
  "悔棋申请已经变化，请按最新状态操作。": "The undo request has changed. Respond to its latest state.",
  "对局邀请已经变化，请按最新邀请操作。": "The game invitation has changed. Respond to the latest one.",
  "本局已经结束。": "This game is already over.",
  "棋局尚未开始。": "The game has not started yet.",
  "本局已超时结束。": "This game has already ended on time.",
  "现在不是在线 AI 行棋。": "It is not the online AI's turn.",
  "房间里没有在线 AI。": "No online AI is attached to this room.",
  "在线 AI 自对弈已暂停。": "Online AI self-play is paused.",
  "与 AI 对局时悔棋直接生效，不需要申请。": "Undo against the AI takes effect directly; no request is needed.",
  "你已经占用了一个席位。": "You already hold a seat.",
  "这个席位已经有人使用。": "That seat is already taken.",
  "白方席位已经有人使用。": "The White seat is already taken.",
  "请先让对手进入房间并成为白方。": "Ask your opponent to enter the room and take White first.",
  "请等待对手加入。": "Wait for your opponent to join.",
  "观战人数已满。": "This room has no spectator places left.",
  "观战请求过于频繁，请稍后再试。": "Too many spectator requests. Try again shortly.",
  "这位成员已经不在房间里。": "That person is no longer in the room.",
  "对方仍在线，不能判弃局。": "Your opponent is still online, so the game cannot be claimed as abandoned.",
  "对方离线还不到 2 分钟，请稍后再判弃局。":
    "Your opponent has been offline for less than 2 minutes. Claim the game a little later.",
  "你已被房主移出房间。": "The host removed you from the room.",
  "只有房主可以管理房间。": "Only the host can manage the room.",
  "不能移出自己或 AI 席位。": "You cannot remove yourself or the AI seat.",
  "本局进行中，不能移出对手；请等本局结束后再操作。":
    "The game is in progress, so your opponent cannot be removed. Wait until it ends.",
  "当前没有进行中的对局。": "No game is in progress.",
  "只有对局中的一方可以判对方弃局。": "Only a player in the game can claim it as abandoned.",
  "发言太快了，请稍等一下再发送。": "You are sending messages too quickly. Wait a moment.",
  "操作太频繁了，请稍等一下再试。": "Too many actions. Wait a moment and try again.",
  "本次点目的死子标记次数已达上限，请确认结果或继续对局。":
    "Dead-stone marks for this scoring reached their limit. Confirm the result or resume play.",
  "悔棋申请正在等待回应。": "An undo request is already waiting for a response.",
  "这个棋类不支持这个操作。": "This game does not support that action.",
  "聊天内容太长，请缩短后再发送。": "That chat message is too long. Shorten it and try again.",
  "聊天内容行数太多，请合并后再发送。": "That chat message has too many lines. Combine them and try again.",
  "联机服务暂时不可用，请稍后重试。": "The online service is unavailable right now. Try again shortly.",
  "房间同步超时，正在重新连接。": "The room did not sync in time. Reconnecting.",
  "AI 思考已取消。": "The AI stopped thinking.",
  "AI 思考超时，已重新启动 AI。": "The AI took too long and was restarted.",
  "AI 返回了不合规则的落点。": "The AI returned a move that breaks the rules.",
  "AI 找不到可以下的点。": "The AI found no legal point to play.",
});

/**
 * Pick the copy to show for an error. Chinese keeps the server's own wording;
 * English keeps a message that already reads (or translates) cleanly and
 * otherwise falls back to the copy for its code, then to a generic sentence.
 */
export function errorCopy(error, {
  fallback = GENERIC_SERVER_ERROR,
  chinese = false,
  isEnglish = (text) => !/[\u3400-\u9fff\uff01-\uff60\u3000-\u303f]/u.test(text),
} = {}) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const code = typeof error?.code === "string" ? error.code : "";
  const byCode = SERVER_ERROR_COPY[code] ??
    (code.endsWith("_RATE_LIMITED") ? SERVER_ERROR_COPY[GENERIC_RATE_LIMIT] : null);
  if (chinese) return message || byCode || fallback;
  if (message && isEnglish(message)) return message;
  return byCode ?? fallback;
}
